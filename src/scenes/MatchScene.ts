import * as Phaser from 'phaser';

import {
  AUDIO_KEYS,
  playAudioCue,
  startMatchMusic,
  stopMatchMusic,
  syncMatchMusic
} from '../game/core/audio';
import { Fighter, NEUTRAL_FIGHTER_INPUT, type FighterInput } from '../game/fighter';
import { getCharacterDefinition } from '../game/hero';
import { MatchHud } from '../game/matchHud';
import { getStageDefinition } from '../game/stageConfig';
import { playSuperCutIn } from '../game/superCutIn';
import { SCENE_KEYS, type MatchConfig, type VictorySceneData } from '../game/types';
import { spawnHitSpark, spawnImpactFlash, type VfxColor } from '../game/vfx';
import { BaseScene } from './BaseScene';

const EDGE_MARGIN = 170;
const DEPTH_FRONT = 8;
const DEPTH_BACK = 5;

// Fraction of the gap from the screen centre each fighter occupies at spawn.
const SPAWN_OFFSET_FRACTION = 0.18;
// How quickly the camera eases toward the fighters' midpoint (0..1 per frame).
const CAMERA_LERP = 0.14;

const ROUNDS_TO_WIN = 2;
// Seconds on the round clock. When it expires the fighter with more health wins
// (a tie is a draw and replays the round).
const ROUND_SECONDS = 60;
const HUD_DEPTH = 100;
const BANNER_DEPTH = 200;

/** The match's high-level state, driving input gating and the HUD. */
type MatchPhase = 'intro' | 'fighting' | 'roundEnd' | 'matchOver';

interface PlayerKeys {
  left: Phaser.Input.Keyboard.Key;
  right: Phaser.Input.Keyboard.Key;
  crouch: Phaser.Input.Keyboard.Key;
  block: Phaser.Input.Keyboard.Key;
  jump: Phaser.Input.Keyboard.Key;
  light: Phaser.Input.Keyboard.Key;
  heavy: Phaser.Input.Keyboard.Key;
  special: Phaser.Input.Keyboard.Key;
}

interface SoccerBallProjectile {
  sprite: Phaser.GameObjects.Image;
  attacker: Fighter;
  defender: Fighter;
  facing: 1 | -1;
  vx: number;
  vy: number;
  trailElapsed: number;
}

/**
 * The versus match: two fighters spawn facing each other and fight a best-of-3
 * (first to {@link ROUNDS_TO_WIN} rounds). Each round runs a "ROUND n / FIGHT!"
 * intro, then live combat — attack boxes vs hurtboxes drive damage, hitstun,
 * knockback, and a knockdown on KO. When the match is decided a game-over
 * overlay offers a rematch or a return to the main menu. P1 is always human;
 * P2 is human in 1v1 or a simple CPU in 1vCPU.
 */
export class MatchScene extends BaseScene {
  private config: MatchConfig = {
    mode: '1v1',
    stageId: 'rooftop-twilight',
    p1CharacterId: '',
    p2CharacterId: ''
  };

  private p1!: Fighter;
  private p2!: Fighter;
  private p1Keys!: PlayerKeys;
  private p2Keys!: PlayerKeys;
  private cpu?: CpuController;

  private phase: MatchPhase = 'intro';
  private roundNumber = 1;
  private p1Wins = 0;
  private p2Wins = 0;

  private spawnX1 = 0;
  private spawnX2 = 0;

  private stageWorldWidth = 0;
  private maxScroll = 0;

  private hud!: MatchHud;
  private banner!: Phaser.GameObjects.Text;
  private roundTimeMs = ROUND_SECONDS * 1000;
  private hitstopMs = 0;
  private p1Combo = 0;
  private p2Combo = 0;
  private chargeBalls = new Map<Fighter, Phaser.GameObjects.Image>();
  private projectiles: SoccerBallProjectile[] = [];

  constructor() {
    super(SCENE_KEYS.Match);
  }

  init(data: MatchConfig): void {
    if (data) {
      this.config = data;
    }
  }

  create(): void {
    this.cpu = undefined;
    this.phase = 'intro';
    this.roundNumber = 1;
    this.p1Wins = 0;
    this.p2Wins = 0;
    this.hitstopMs = 0;
    this.p1Combo = 0;
    this.p2Combo = 0;

    this.markActiveScene(SCENE_KEYS.Match);
    this.cameras.main.setBackgroundColor(0x05070d);

    this.buildStage();
    this.spawnFighters();
    this.registerKeys();
    this.createControlsLegend();

    this.hud = new MatchHud(this, {
      mode: this.config.mode,
      p1CharacterId: this.config.p1CharacterId,
      p2CharacterId: this.config.p2CharacterId,
      roundsToWin: ROUNDS_TO_WIN,
      depth: HUD_DEPTH
    });
    this.hud.slideIn();

    this.banner = this.add
      .text(this.cameras.main.centerX, this.cameras.main.centerY - 40, '', {
        color: '#f8fafc',
        fontFamily: 'monospace',
        fontSize: '64px',
        stroke: '#020617',
        strokeThickness: 8
      })
      .setOrigin(0.5)
      .setDepth(BANNER_DEPTH)
      .setScrollFactor(0)
      .setAlpha(0);

    if (this.config.mode === '1vcpu') {
      this.cpu = new CpuController();
    }

    this.startRound();
    startMatchMusic(() => this.app.settingsStore.getState());
    const unsubscribeAudio = this.app.settingsStore.subscribe((settings) => {
      syncMatchMusic(settings);
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      unsubscribeAudio();
      stopMatchMusic();
      this.clearSpecialProps();
      this.p1?.destroy();
      this.p2?.destroy();
      this.hud?.destroy();
    });
  }

  /**
   * Per-frame loop: feeds both fighters their input (only while fighting),
   * keeps them facing each other, resolves hits, checks for a KO, and redraws
   * the HUD.
   * @param time - Phaser clock time in ms.
   * @param delta - Milliseconds since the previous frame.
   */
  update(time: number, delta: number): void {
    if (this.hitstopMs > 0) {
      this.hitstopMs = Math.max(0, this.hitstopMs - delta);
      return;
    }

    const seconds = delta / 1000;
    const fighting = this.phase === 'fighting';

    const p1Input = fighting ? this.readKeys(this.p1Keys) : { ...NEUTRAL_FIGHTER_INPUT };
    const p2Input = fighting
      ? this.cpu
        ? this.cpu.update(time, this.p2.x, this.p1.x, this.p1.isAttacking, this.p2.isMeterReady)
        : this.readKeys(this.p2Keys)
      : { ...NEUTRAL_FIGHTER_INPUT };

    // Crouching (and crouch-block) is disabled for now: defense is simply
    // block-or-not. The geometric guard-box model still resolves blocks via the
    // standing guard box; the crouch/low path stays in the code but unused.
    p1Input.crouch = false;
    p2Input.crouch = false;

    this.p1.faceToward(this.p2.x);
    this.p2.faceToward(this.p1.x);

    if (fighting) {
      if (isActing(p1Input)) {
        this.p1.setDepthBase(DEPTH_FRONT);
        this.p2.setDepthBase(DEPTH_BACK);
      } else if (isActing(p2Input)) {
        this.p2.setDepthBase(DEPTH_FRONT);
        this.p1.setDepthBase(DEPTH_BACK);
      }
    }

    this.p1.update(seconds, p1Input);
    this.p2.update(seconds, p2Input);

    if (!this.p2.isInHitstun) {
      this.p1Combo = 0;
    }
    if (!this.p1.isInHitstun) {
      this.p2Combo = 0;
    }

    this.updateCamera(false);

    if (fighting) {
      this.resolveCombat();
      this.updateProjectiles(seconds);
      this.checkForKnockout();

      if (this.phase === 'fighting') {
        this.tickRoundTimer(delta);
        this.hud.applyHealth(this.p1.health01, this.p2.health01);
      }
    }

    this.hud.setMeter(this.p1.meter01, this.p2.meter01);
    this.hud.setTime(Math.ceil(this.roundTimeMs / 1000));
    this.hud.updateWins(this.p1Wins, this.p2Wins);
  }

  /**
   * Checks both directions for a connecting hit and applies damage/block this
   * frame. A swing only lands once thanks to the attacker's connect flag.
   */
  private resolveCombat(): void {
    this.tryHit(this.p1, this.p2);
    this.tryHit(this.p2, this.p1);
  }

  /**
   * Resolves a single attacker -> defender interaction for the current frame.
   * Blocking is purely geometric: the hit is guarded when the attack box
   * overlaps the defender's active guard box (from its block pose).
   * @param attacker - The fighter whose attack box is tested.
   * @param defender - The fighter whose hurtbox is tested.
   */
  private tryHit(attacker: Fighter, defender: Fighter): void {
    if (defender.isDefeated) {
      return;
    }

    const attack = attacker.getActiveAttack();
    if (!attack) {
      return;
    }

    const hurt = defender.getHurtRect();
    if (!hurt || !Phaser.Geom.Intersects.RectangleToRectangle(attack.rect, hurt)) {
      return;
    }

    const guard = defender.getGuardRect();
    const blocked = guard !== null && Phaser.Geom.Intersects.RectangleToRectangle(attack.rect, guard);
    const isSpecial = attack.profile.kind === 'special';
    const finisher = attack.finisher && !blocked;
    const isCounter = !blocked && defender.isAttacking;
    const isCritical = !blocked && attacker.characterId === 'valverde' && Math.random() < 0.18;

    const comboCount = blocked ? 0 : this.advanceCombo(attacker, defender);
    const comboScale = comboCount <= 1 ? 1 : Math.max(0.6, 1 - (comboCount - 1) * 0.1);

    // The combo finisher launches harder and stuns longer than a regular hit.
    let profile = finisher
      ? { ...attack.profile, knockback: attack.profile.knockback * 1.75, hitstun: attack.profile.hitstun * 1.35 }
      : { ...attack.profile };

    if (isCounter) {
      profile = {
        ...profile,
        damage: Math.round(profile.damage * 1.25),
        knockback: Math.round(profile.knockback * 1.15),
        hitstun: Math.round(profile.hitstun * 1.2)
      };
    }

    if (isCritical) {
      profile = {
        ...profile,
        damage: Math.round(profile.damage * 1.4),
        knockback: Math.round(profile.knockback * 1.2),
        hitstun: Math.round(profile.hitstun * 1.12)
      };
    }

    if (!blocked && comboScale < 1) {
      profile = {
        ...profile,
        damage: Math.max(2, Math.round(profile.damage * comboScale))
      };
    }

    defender.applyHit(profile, attacker.facingDirection, blocked);
    defender.flashHit(blocked);
    attacker.markAttackConnected();
    attacker.registerOffense(blocked, isSpecial);
    defender.registerDefense(blocked);

    if (isCounter) {
      attacker.gainMeter(5);
    }

    this.spawnHitFx(
      attack.rect,
      hurt,
      blocked,
      isSpecial,
      finisher,
      attack.profile.kind === 'low',
      attacker.characterId === 'valverde' && attack.profile.kind === 'low',
      isCritical,
      isCounter
    );

    if (!blocked) {
      this.hitstopMs = finisher || isCritical ? 90 : isCounter || attack.profile.kind === 'low' ? 62 : 34;
    }

    const head = defender.getHeadPoint();
    if (isCritical) {
      this.spawnCombatCallout(head.x, head.y - 26, 'CRITICAL!', '#facc15');
    } else if (isCounter) {
      this.spawnCombatCallout(head.x, head.y - 26, 'COUNTER!', '#38bdf8');
    }

    if (comboCount >= 2) {
      this.spawnComboPopup(attacker, comboCount);
    }
  }

  private advanceCombo(attacker: Fighter, defender: Fighter): number {
    const continuing = defender.isInHitstun;
    if (attacker === this.p1) {
      this.p1Combo = continuing ? this.p1Combo + 1 : 1;
      return this.p1Combo;
    }
    this.p2Combo = continuing ? this.p2Combo + 1 : 1;
    return this.p2Combo;
  }

  /**
   * Spawns the impact spark and camera shake for a connecting hit, scaled up for
   * special hits and the combo finisher.
   */
  private spawnHitFx(
    attackRect: Phaser.Geom.Rectangle,
    hurtRect: Phaser.Geom.Rectangle,
    blocked: boolean,
    isSpecial: boolean,
    finisher: boolean,
    isHeavy: boolean,
    isPowerKick: boolean,
    isCritical: boolean,
    isCounter = false
  ): void {
    const sparkX = (Phaser.Geom.Rectangle.GetCenter(attackRect).x + Phaser.Geom.Rectangle.GetCenter(hurtRect).x) / 2;
    const sparkY = (Phaser.Geom.Rectangle.GetCenter(attackRect).y + Phaser.Geom.Rectangle.GetCenter(hurtRect).y) / 2;

    const color: VfxColor = blocked ? 'blue' : finisher || isCritical || isPowerKick || isCounter ? 'gold' : 'red';
    const sparkScale = finisher || isCritical ? 1.65 : isPowerKick || isCounter ? 1.3 : isSpecial ? 1.1 : 0.9;
    spawnHitSpark(this, sparkX, sparkY, color, sparkScale);

    const settings = this.app.settingsStore.getState();
    if (blocked) {
      playAudioCue(this, AUDIO_KEYS.block, settings);
      this.cameras.main.shake(55, 0.0028);
    } else if (finisher || isCritical) {
      playAudioCue(this, AUDIO_KEYS.specialHit, settings);
      this.cameras.main.flash(isCritical ? 95 : 120, 255, 224, 120, false);
      this.cameras.main.shake(isCritical ? 190 : 200, isCritical ? 0.011 : 0.01);
    } else if (isPowerKick || isCounter) {
      playAudioCue(this, AUDIO_KEYS.hitHeavy, settings);
      spawnImpactFlash(this, sparkX, sparkY, isCounter ? 'blue' : 'gold', 48);
      this.cameras.main.shake(145, 0.008);
    } else if (isSpecial || isHeavy) {
      playAudioCue(this, AUDIO_KEYS.hitHeavy, settings);
      this.cameras.main.shake(isSpecial ? 100 : 115, 0.0065);
    } else {
      playAudioCue(this, AUDIO_KEYS.hitLight, settings);
      this.cameras.main.shake(80, 0.004);
    }
  }

  private spawnCombatCallout(x: number, y: number, text: string, color: string): void {
    const label = this.add
      .text(x, y, text, {
        color,
        fontFamily: 'monospace',
        fontStyle: 'bold',
        fontSize: '25px',
        stroke: '#020617',
        strokeThickness: 6
      })
      .setOrigin(0.5)
      .setDepth(BANNER_DEPTH - 5)
      .setScale(0.6);

    this.tweens.add({
      targets: label,
      y: y - 54,
      scale: 1.15,
      alpha: 0,
      duration: 680,
      ease: 'Cubic.Out',
      onComplete: () => label.destroy()
    });
  }

  private spawnComboPopup(attacker: Fighter, count: number): void {
    const cam = this.cameras.main;
    const isP1 = attacker === this.p1;
    const x = isP1 ? 156 : cam.width - 156;
    const y = 176;

    const comboText = this.add
      .text(x, y, `${count} HITS!`, {
        color: isP1 ? '#38bdf8' : '#ff2a6d',
        fontFamily: '"Silkscreen", monospace',
        fontStyle: 'bold italic',
        fontSize: '28px',
        stroke: '#020617',
        strokeThickness: 6
      })
      .setOrigin(0.5)
      .setDepth(HUD_DEPTH + 5)
      .setScrollFactor(0)
      .setScale(0.65);

    this.tweens.add({
      targets: comboText,
      scale: 1.1,
      y: y - 16,
      alpha: 0,
      duration: 760,
      ease: 'Cubic.Out',
      onComplete: () => comboText.destroy()
    });
  }

  /** Ends the round when either fighter is knocked out. */
  private checkForKnockout(): void {
    if (this.p1.isDefeated) {
      this.endRound(2);
    } else if (this.p2.isDefeated) {
      this.endRound(1);
    }
  }

  /**
   * Counts the round clock down while fighting. When it reaches zero the round
   * is decided on remaining health (a tie replays the round as a draw).
   * @param delta - Milliseconds since the previous frame.
   */
  private tickRoundTimer(delta: number): void {
    this.roundTimeMs = Math.max(0, this.roundTimeMs - delta);

    if (this.roundTimeMs <= 0) {
      this.resolveTimeOut();
    }
  }

  /** Decides a timed-out round by comparing remaining health. */
  private resolveTimeOut(): void {
    const p1 = this.p1.health01;
    const p2 = this.p2.health01;

    if (p1 > p2) {
      this.endRound(1, 'TIME UP', '#facc15');
    } else if (p2 > p1) {
      this.endRound(2, 'TIME UP', '#facc15');
    } else {
      this.drawRound();
    }
  }

  /** Handles a drawn round (timeout with equal health): replays the round. */
  private drawRound(): void {
    if (this.phase !== 'fighting') {
      return;
    }

    this.phase = 'roundEnd';
    this.showBanner('DRAW', '#e2e8f0', 1.1);
    this.time.delayedCall(1100, () => this.startRound());
  }

  /**
   * Places the chosen stage fit to the viewport height, anchored at world x=0,
   * and sets up the scrollable world. The stage's on-screen width becomes the
   * world width; the camera is bounded to it so it can scroll horizontally and
   * stop at the stage ends (producing corners).
   */
  private buildStage(): void {
    const cam = this.cameras.main;
    const stage = getStageDefinition(this.config.stageId);
    const source = this.textures.get(stage.key).getSourceImage();
    const scale = cam.height / (source.height || stage.height);
    this.stageWorldWidth = (source.width || stage.width) * scale;
    this.maxScroll = Math.max(0, this.stageWorldWidth - cam.width);

    this.add.image(0, 0, stage.key).setOrigin(0, 0).setScale(scale).setDepth(0);
    this.buildStageAtmosphere(stage.id, cam.width, cam.height);
    cam.setBounds(0, 0, this.stageWorldWidth, cam.height);
  }

  private buildStageAtmosphere(stageId: string, viewWidth: number, viewHeight: number): void {
    // Subtle top/bottom stage framing bands so HUD and fighters pop sharply.
    this.add
      .rectangle(viewWidth / 2, 34, viewWidth, 68, 0x020617, 0.24)
      .setScrollFactor(0)
      .setDepth(2);
    this.add
      .rectangle(viewWidth / 2, viewHeight - 24, viewWidth, 48, 0x020617, 0.32)
      .setScrollFactor(0)
      .setDepth(2);

    if (stageId === 'championship-stadium') {
      const leftBeam = this.add
        .triangle(0, 0, 0, 0, 320, viewHeight, -120, viewHeight, 0xe0f2fe, 0.055)
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setDepth(1);
      const rightBeam = this.add
        .triangle(viewWidth, 0, 0, 0, 120, viewHeight, -320, viewHeight, 0xfef08a, 0.05)
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setDepth(1);

      this.tweens.add({
        targets: leftBeam,
        alpha: 0.02,
        angle: 5,
        duration: 3200,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut'
      });
      this.tweens.add({
        targets: rightBeam,
        alpha: 0.02,
        angle: -5,
        duration: 3600,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut'
      });
    }

    const particleColors =
      stageId === 'championship-stadium'
        ? [0xfef08a, 0xe0f2fe, 0xffffff]
        : stageId === 'rooftop-sunset'
          ? [0xfb923c, 0xfacc15, 0xfda4af]
          : [0x38bdf8, 0xc084fc, 0xfef08a];

    for (let i = 0; i < 18; i += 1) {
      const x = Phaser.Math.Between(30, Math.max(viewWidth, Math.round(this.stageWorldWidth)) - 30);
      const y = Phaser.Math.Between(90, Math.round(viewHeight * 0.8));
      const size = Phaser.Math.Between(2, 4);
      const mote = this.add
        .rectangle(x, y, size, size, particleColors[i % particleColors.length], Phaser.Math.FloatBetween(0.25, 0.55))
        .setDepth(2);

      this.tweens.add({
        targets: mote,
        y: y - Phaser.Math.Between(35, 95),
        x: x + Phaser.Math.Between(-25, 25),
        alpha: { from: 0.15, to: 0.65 },
        duration: Phaser.Math.Between(2600, 4800),
        delay: Phaser.Math.Between(0, 1500),
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut'
      });
    }
  }

  /** Spawns P1 (left, facing right) and P2 (right, facing left). */
  private spawnFighters(): void {
    const cam = this.cameras.main;
    const stage = getStageDefinition(this.config.stageId);
    const groundY = Math.round(cam.height * stage.groundFraction);
    const minX = EDGE_MARGIN;
    const maxX = this.stageWorldWidth - EDGE_MARGIN;
    const center = this.stageWorldWidth / 2;
    this.spawnX1 = Math.round(center - cam.width * SPAWN_OFFSET_FRACTION);
    this.spawnX2 = Math.round(center + cam.width * SPAWN_OFFSET_FRACTION);

    this.p1 = new Fighter({
      scene: this,
      app: this.app,
      characterId: this.config.p1CharacterId,
      x: this.spawnX1,
      groundY,
      facing: 1,
      minX,
      maxX,
      depth: DEPTH_FRONT,
      onSpecialStart: (fighter) => {
        playSuperCutIn(this, { characterId: fighter.characterId, side: 'left' });
        this.handleSpecialCharge(fighter);
      },
      onSpecialExecute: (fighter) => this.handleSpecialExecute(fighter, this.p2)
    });

    this.p2 = new Fighter({
      scene: this,
      app: this.app,
      characterId: this.config.p2CharacterId,
      x: this.spawnX2,
      groundY,
      facing: -1,
      minX,
      maxX,
      depth: DEPTH_BACK,
      onSpecialStart: (fighter) => {
        playSuperCutIn(this, { characterId: fighter.characterId, side: 'right' });
        this.handleSpecialCharge(fighter);
      },
      onSpecialExecute: (fighter) => this.handleSpecialExecute(fighter, this.p1)
    });
  }

  private handleSpecialCharge(fighter: Fighter): void {
    if (fighter.characterId !== 'valverde' || !this.textures.exists('soccer-ball')) {
      return;
    }

    this.chargeBalls.get(fighter)?.destroy();

    const startX = fighter.x + fighter.facingDirection * 64;
    const startY = fighter.groundBaseY - 40;
    const targetY = fighter.groundBaseY - 96;

    const ball = this.add
      .image(startX, startY, 'soccer-ball')
      .setDepth(DEPTH_FRONT + 4)
      .setScale(0.25);

    this.chargeBalls.set(fighter, ball);

    this.tweens.add({
      targets: ball,
      y: targetY,
      scale: 0.95,
      angle: fighter.facingDirection * 360,
      duration: 340,
      ease: 'Back.Out'
    });

    this.time.delayedCall(1200, () => {
      if (this.chargeBalls.get(fighter) === ball) {
        this.chargeBalls.delete(fighter);
        ball.destroy();
      }
    });

    spawnImpactFlash(this, startX, targetY, 'blue', 44);
  }

  private handleSpecialExecute(attacker: Fighter, defender: Fighter): void {
    if (attacker.characterId !== 'valverde' || !this.textures.exists('soccer-ball')) {
      return;
    }

    // Fast release so close and mid-range opponents cannot easily slip under or past the volley.
    this.time.delayedCall(105, () => {
      const chargeBall = this.chargeBalls.get(attacker);
      if (chargeBall) {
        chargeBall.destroy();
        this.chargeBalls.delete(attacker);
      }

      if (this.phase !== 'fighting' || attacker.isDefeated) {
        return;
      }

      const originX = attacker.x + attacker.facingDirection * 42;
      const originY = attacker.groundBaseY - 92;
      const head = defender.getHeadPoint();
      const forwardDx = Math.max(70, (head.x - originX) * attacker.facingDirection) * attacker.facingDirection;
      const dy = head.y - originY;
      const dist = Math.hypot(forwardDx, dy) || 1;
      const speed = 1560;

      const ball = this.add
        .image(originX, originY, 'soccer-ball')
        .setDepth(DEPTH_FRONT + 5)
        .setScale(1.1);

      playAudioCue(this, AUDIO_KEYS.hitHeavy, this.app.settingsStore.getState());
      spawnImpactFlash(this, originX, originY, 'gold', 62);
      this.cameras.main.shake(95, 0.0055);

      this.projectiles.push({
        sprite: ball,
        attacker,
        defender,
        facing: attacker.facingDirection,
        vx: (forwardDx / dist) * speed,
        vy: (dy / dist) * speed,
        trailElapsed: 0
      });
    });
  }

  private updateProjectiles(seconds: number): void {
    if (this.projectiles.length === 0) {
      return;
    }

    const cam = this.cameras.main;
    const settings = this.app.settingsStore.getState();
    const remaining: SoccerBallProjectile[] = [];

    for (const proj of this.projectiles) {
      // Gentle homing curve toward the defender's head while approaching them.
      if (!proj.defender.isDefeated && (proj.defender.x - proj.sprite.x) * proj.facing > -12) {
        const targetHead = proj.defender.getHeadPoint();
        const dx = Math.max(60, (targetHead.x - proj.sprite.x) * proj.facing) * proj.facing;
        const dy = targetHead.y - proj.sprite.y;
        const dist = Math.hypot(dx, dy) || 1;
        const speed = Math.hypot(proj.vx, proj.vy) || 1560;
        const desiredVx = (dx / dist) * speed;
        const desiredVy = (dy / dist) * speed;
        const steer = Math.min(1, seconds * 10);
        proj.vx = Phaser.Math.Linear(proj.vx, desiredVx, steer);
        proj.vy = Phaser.Math.Linear(proj.vy, desiredVy, steer);
      }

      proj.sprite.x += proj.vx * seconds;
      proj.sprite.y += proj.vy * seconds;
      proj.sprite.angle += proj.facing * 1500 * seconds;
      proj.trailElapsed += seconds;

      if (proj.trailElapsed >= 0.014) {
        proj.trailElapsed = 0;
        const trail = this.add
          .circle(proj.sprite.x, proj.sprite.y, 16, 0xfacc15, 0.5)
          .setDepth(DEPTH_FRONT + 4);
        this.tweens.add({
          targets: trail,
          scale: 0.2,
          alpha: 0,
          duration: 160,
          onComplete: () => trail.destroy()
        });
      }

      const offScreen =
        proj.sprite.x < -100 ||
        proj.sprite.x > this.stageWorldWidth + 100 ||
        proj.sprite.y < -120 ||
        proj.sprite.y > cam.height + 80;
      if (offScreen) {
        proj.sprite.destroy();
        continue;
      }

      if (proj.defender.isDefeated) {
        remaining.push(proj);
        continue;
      }

      const ballRect = new Phaser.Geom.Rectangle(proj.sprite.x - 28, proj.sprite.y - 28, 56, 56);
      const hurt = proj.defender.getHurtRect();
      if (!hurt || !Phaser.Geom.Intersects.RectangleToRectangle(ballRect, hurt)) {
        remaining.push(proj);
        continue;
      }

      const guard = proj.defender.getGuardRect();
      const blocked = guard !== null && Phaser.Geom.Intersects.RectangleToRectangle(ballRect, guard);
      const isCritical = !blocked && Math.random() < 0.28;
      const baseProfile = proj.attacker.getCombatProfile('special');
      const profile = isCritical
        ? {
            ...baseProfile,
            damage: Math.round(baseProfile.damage * 1.4),
            knockback: Math.round(baseProfile.knockback * 1.2),
            hitstun: Math.round(baseProfile.hitstun * 1.15)
          }
        : baseProfile;

      proj.defender.applyHit(profile, proj.facing, blocked, blocked ? 9 : undefined);
      proj.defender.flashHit(blocked);
      proj.defender.registerDefense(blocked);

      const head = proj.defender.getHeadPoint();
      const hitX = blocked ? proj.sprite.x : head.x;
      const hitY = blocked ? proj.sprite.y : head.y;

      if (blocked) {
        proj.attacker.gainMeter(10);
        spawnHitSpark(this, hitX, hitY, 'blue', 1.4);
        playAudioCue(this, AUDIO_KEYS.block, settings);
        this.cameras.main.shake(115, 0.0055);
        this.spawnCombatCallout(hitX, hitY - 24, 'GUARD CRUSH!', '#38bdf8');
      } else {
        proj.attacker.gainMeter(25);
        this.hitstopMs = isCritical ? 110 : 85;
        spawnHitSpark(this, hitX, hitY, 'gold', isCritical ? 2.25 : 1.95);
        playAudioCue(this, AUDIO_KEYS.specialHit, settings);
        this.cameras.main.flash(isCritical ? 180 : 140, 255, 224, 120, false);
        this.cameras.main.shake(isCritical ? 270 : 220, isCritical ? 0.016 : 0.013);
        if (isCritical) {
          this.spawnCombatCallout(hitX, hitY - 28, 'CRITICAL!', '#facc15');
        }
      }

      // Ricochet upward off the opponent's head/guard and fade out cleanly.
      const bounceSprite = proj.sprite;
      this.tweens.add({
        targets: bounceSprite,
        x: bounceSprite.x - proj.facing * 120,
        y: bounceSprite.y - 190,
        angle: bounceSprite.angle - proj.facing * 480,
        scale: 0.7,
        alpha: 0,
        duration: 420,
        ease: 'Cubic.Out',
        onComplete: () => bounceSprite.destroy()
      });
    }

    this.projectiles = remaining;
  }

  private clearSpecialProps(): void {
    this.chargeBalls.forEach((ball) => ball.destroy());
    this.chargeBalls.clear();
    this.projectiles.forEach((proj) => proj.sprite.destroy());
    this.projectiles = [];
  }

  /**
   * Group-camera tracking: scrolls horizontally to keep both fighters framed
   * around their midpoint, clamped to the stage ends (so it stops at corners),
   * then turns the visible screen edges into movement walls for both fighters.
   * This is what produces the "camera locks until one fighter relents" feel —
   * neither fighter can walk off-screen, so they can only separate as far as the
   * screen is wide.
   * @param snap - When true, jumps to the target scroll instantly (round start)
   *   instead of easing toward it.
   */
  private updateCamera(snap: boolean): void {
    const cam = this.cameras.main;
    const viewWidth = cam.width;
    const midpoint = (this.p1.x + this.p2.x) / 2;
    const targetScroll = Phaser.Math.Clamp(midpoint - viewWidth / 2, 0, this.maxScroll);
    const scrollX = snap ? targetScroll : Phaser.Math.Linear(cam.scrollX, targetScroll, CAMERA_LERP);

    cam.setScroll(scrollX, 0);

    const leftWall = scrollX + EDGE_MARGIN;
    const rightWall = scrollX + viewWidth - EDGE_MARGIN;
    this.p1.setHorizontalBounds(leftWall, rightWall);
    this.p2.setHorizontalBounds(leftWall, rightWall);
  }

  /** Registers the two keyboard control schemes plus the menu shortcut. */
  private registerKeys(): void {
    const keyboard = this.input.keyboard;
    if (!keyboard) {
      throw new Error('MatchScene requires keyboard input');
    }

    const codes = Phaser.Input.Keyboard.KeyCodes;
    this.p1Keys = {
      left: keyboard.addKey(codes.A),
      right: keyboard.addKey(codes.D),
      crouch: keyboard.addKey(codes.S),
      block: keyboard.addKey(codes.C),
      jump: keyboard.addKey(codes.W),
      light: keyboard.addKey(codes.F),
      heavy: keyboard.addKey(codes.G),
      special: keyboard.addKey(codes.V)
    };

    this.p2Keys = {
      left: keyboard.addKey(codes.LEFT),
      right: keyboard.addKey(codes.RIGHT),
      crouch: keyboard.addKey(codes.DOWN),
      block: keyboard.addKey(codes.FORWARD_SLASH),
      jump: keyboard.addKey(codes.UP),
      light: keyboard.addKey(codes.COMMA),
      heavy: keyboard.addKey(codes.PERIOD),
      special: keyboard.addKey(codes.L)
    };

    keyboard.on('keydown-ESC', () => this.goToMenu());
    keyboard.on('keydown-BACKSPACE', () => this.goToMenu());
  }

  /**
   * Reads a control scheme into a fighter input snapshot. Held keys map to held
   * inputs; jump/light/heavy use edge detection so they fire once per press.
   * @param keys - The player's resolved keys.
   */
  private readKeys(keys: PlayerKeys): FighterInput {
    return {
      left: keys.left.isDown,
      right: keys.right.isDown,
      crouch: keys.crouch.isDown,
      block: keys.block.isDown,
      jump: Phaser.Input.Keyboard.JustDown(keys.jump),
      light: Phaser.Input.Keyboard.JustDown(keys.light),
      heavy: Phaser.Input.Keyboard.JustDown(keys.heavy),
      special: Phaser.Input.Keyboard.JustDown(keys.special)
    };
  }

  /** Draws the control legend at the bottom of the screen. */
  private createControlsLegend(): void {
    const { centerX, height } = this.cameras.main;
    const p1 = 'P1: WASD • F light • G heavy • C block • V special';
    const p2 = this.config.mode === '1vcpu' ? 'P2: CPU' : 'P2: Arrows • , light • . heavy • / block • L special';

    this.add
      .text(centerX, height - 22, `${p1}      ${p2}      Esc Menu`, {
        color: '#cbd5f5',
        fontFamily: 'monospace',
        fontSize: '12px',
        backgroundColor: 'rgba(2, 6, 23, 0.6)',
        padding: { x: 10, y: 5 }
      })
      .setOrigin(0.5)
      .setDepth(HUD_DEPTH)
      .setScrollFactor(0);
  }

  /** Resets both fighters to their corners and runs the round intro. */
  private startRound(): void {
    this.clearSpecialProps();
    this.hitstopMs = 0;
    this.p1Combo = 0;
    this.p2Combo = 0;
    this.phase = 'intro';
    this.roundTimeMs = ROUND_SECONDS * 1000;

    const fullMin = EDGE_MARGIN;
    const fullMax = this.stageWorldWidth - EDGE_MARGIN;
    this.p1.setHorizontalBounds(fullMin, fullMax);
    this.p2.setHorizontalBounds(fullMin, fullMax);

    this.p1.resetForRound(this.spawnX1, 1);
    this.p2.resetForRound(this.spawnX2, -1);
    this.p1.setDepthBase(DEPTH_FRONT);
    this.p2.setDepthBase(DEPTH_BACK);
    this.updateCamera(true);
    this.hud.animateFill();
    this.hud.updateWins(this.p1Wins, this.p2Wins);

    this.showBanner(`ROUND ${this.roundNumber}`, '#f8fafc');

    this.time.delayedCall(900, () => {
      if (this.phase !== 'intro') {
        return;
      }

      this.showBanner('FIGHT!', '#facc15', 1.15);
      playAudioCue(this, AUDIO_KEYS.roundBell, this.app.settingsStore.getState());
      this.phase = 'fighting';
      this.p1.setFrozen(false);
      this.p2.setFrozen(false);

      this.time.delayedCall(650, () => this.hideBanner());
    });
  }

  /**
   * Concludes the current round, tallies the win, and either advances to the
   * next round or ends the match.
   * @param winner - Which player won (1 or 2).
   * @param bannerText - The banner to show (defaults to a knockout).
   * @param bannerColor - The banner colour.
   */
  private endRound(winner: 1 | 2, bannerText = 'K.O.', bannerColor = '#f43f5e'): void {
    if (this.phase !== 'fighting') {
      return;
    }

    this.phase = 'roundEnd';

    if (winner === 1) {
      this.p1Wins += 1;
    } else {
      this.p2Wins += 1;
    }

    const winnerName =
      winner === 1
        ? `P1 ${getCharacterDefinition(this.config.p1CharacterId).label}`
        : `${this.config.mode === '1vcpu' ? 'CPU' : 'P2'} ${getCharacterDefinition(this.config.p2CharacterId).label}`;
    this.showBanner(bannerText, bannerColor, 1.2);
    playAudioCue(
      this,
      bannerText === 'K.O.' ? AUDIO_KEYS.ko : AUDIO_KEYS.roundBell,
      this.app.settingsStore.getState()
    );

    this.time.delayedCall(1100, () => {
      const matchOver = this.p1Wins >= ROUNDS_TO_WIN || this.p2Wins >= ROUNDS_TO_WIN;

      if (matchOver) {
        const finishReason: VictorySceneData['finishReason'] = bannerText === 'TIME UP' ? 'TIME UP' : 'K.O.';
        this.endMatch(winner, winnerName, finishReason);
      } else {
        this.roundNumber += 1;
        this.startRound();
      }
    });
  }

  /**
   * Transitions to the celebratory VictoryScene once the match is decided.
   * @param winnerPlayer - Winning player slot (1 or 2).
   * @param winnerName - Display name of the match winner.
   * @param finishReason - How the final round ended.
   */
  private endMatch(
    winnerPlayer: 1 | 2,
    winnerName: string,
    finishReason: VictorySceneData['finishReason']
  ): void {
    this.phase = 'matchOver';
    this.hideBanner();
    playAudioCue(this, AUDIO_KEYS.victory, this.app.settingsStore.getState());
    this.cameras.main.flash(260, 255, 224, 130, false);

    const winnerCharacterId =
      winnerPlayer === 1 ? this.config.p1CharacterId : this.config.p2CharacterId;

    const victoryData: VictorySceneData = {
      matchConfig: { ...this.config },
      winnerPlayer,
      winnerName,
      winnerCharacterId,
      p1Wins: this.p1Wins,
      p2Wins: this.p2Wins,
      roundsPlayed: this.roundNumber,
      finishReason
    };

    this.time.delayedCall(420, () => {
      this.cameras.main.fadeOut(320, 18, 4, 40);
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
        this.scene.start(SCENE_KEYS.Victory, victoryData);
      });
    });
  }

  /**
   * Shows the centre banner with a short pop-in tween.
   * @param text - The banner text.
   * @param color - The text colour.
   * @param peakScale - The scale to settle at (default 1).
   */
  private showBanner(text: string, color: string, peakScale = 1): void {
    this.banner.setText(text).setColor(color).setScale(0.6).setAlpha(0);
    this.tweens.add({ targets: this.banner, alpha: 1, scale: peakScale, duration: 260, ease: 'Back.Out' });
  }

  /** Fades the centre banner out. */
  private hideBanner(): void {
    this.tweens.add({ targets: this.banner, alpha: 0, duration: 300 });
  }
}

/**
 * Whether an input represents the fighter actively doing something (moving,
 * jumping, or attacking) this frame — used to decide who draws in front.
 * @param input - The fighter input snapshot to test.
 */
function isActing(input: FighterInput): boolean {
  return input.left || input.right || input.jump || input.light || input.heavy;
}

/**
 * Spacing-aware CPU opponent: closes distance when far, exchanges pokes/kicks in
 * strike range, guards incoming attacks reactively, and fires specials when ready.
 */
class CpuController {
  private nextDecisionAt = 0;
  private holdUntil = 0;
  private moveDir = 0;
  private holdBlock = false;

  update(
    timeMs: number,
    cpuX: number,
    opponentX: number,
    opponentAttacking: boolean,
    meterReady: boolean
  ): FighterInput {
    const input: FighterInput = { ...NEUTRAL_FIGHTER_INPUT };

    if (timeMs >= this.nextDecisionAt) {
      this.decide(timeMs, cpuX, opponentX, opponentAttacking, meterReady, input);
      this.nextDecisionAt = timeMs + Phaser.Math.Between(260, 560);
    }

    if (timeMs < this.holdUntil) {
      if (this.moveDir < 0) {
        input.left = true;
      } else if (this.moveDir > 0) {
        input.right = true;
      }
      input.block = input.block || this.holdBlock;
    } else {
      this.moveDir = 0;
      this.holdBlock = false;
    }

    return input;
  }

  private decide(
    timeMs: number,
    cpuX: number,
    opponentX: number,
    opponentAttacking: boolean,
    meterReady: boolean,
    input: FighterInput
  ): void {
    const dx = opponentX - cpuX;
    const distance = Math.abs(dx);
    const towardDir = dx >= 0 ? 1 : -1;
    const roll = Math.random();

    // Defensive reaction when opponent swings in close range
    if (opponentAttacking && distance < 220 && roll < 0.55) {
      this.moveDir = 0;
      this.holdBlock = true;
      this.holdUntil = timeMs + Phaser.Math.Between(280, 460);
      return;
    }

    // Fire special when meter is ready and inside tactical range
    if (meterReady && distance < 420 && roll < 0.42) {
      input.special = true;
      return;
    }

    // Approach if too far to strike
    if (distance > 195) {
      this.holdBlock = false;
      this.moveDir = roll < 0.85 ? towardDir : -towardDir;
      this.holdUntil = timeMs + Phaser.Math.Between(260, 480);
      if (roll > 0.9) {
        input.jump = true;
      }
      return;
    }

    // In close/mid strike range: mix light pokes, heavy kicks, spacing, and guards
    if (roll < 0.34) {
      input.light = true;
      return;
    }
    if (roll < 0.62) {
      input.heavy = true;
      return;
    }
    if (roll < 0.74) {
      this.moveDir = 0;
      this.holdBlock = true;
      this.holdUntil = timeMs + Phaser.Math.Between(260, 420);
      return;
    }
    if (roll < 0.88) {
      this.holdBlock = false;
      this.moveDir = distance < 105 ? -towardDir : towardDir;
      this.holdUntil = timeMs + Phaser.Math.Between(220, 380);
      return;
    }

    input.jump = true;
    this.holdBlock = false;
    this.moveDir = towardDir;
    this.holdUntil = timeMs + 320;
  }
}
