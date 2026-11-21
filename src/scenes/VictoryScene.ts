import * as Phaser from 'phaser';

import { AUDIO_KEYS, playAudioCue } from '../game/core/audio';
import { getCharacterAnimationByAction, getCharacterDefinition } from '../game/hero';
import { SCENE_KEYS, type VictorySceneData } from '../game/types';
import { BaseScene } from './BaseScene';

interface VictoryOption {
  label: string;
  action: () => void;
}

interface VictoryButton {
  container: Phaser.GameObjects.Container;
  setSelected: (selected: boolean) => void;
  destroy: () => void;
}

const COLORS = {
  skyTop: '#120428',
  skyMid: '#3a0a59',
  skyHorizon: '#ff2a6d',
  floorBg: 0x090216,
  gold: '#ffd700',
  cyan: '#05d9e8',
  magenta: '#ff2a6d',
  orange: '#ff7b00',
  white: '#f8fafc',
  darkText: '#120428',
  goldNum: 0xffd700,
  cyanNum: 0x05d9e8,
  magentaNum: 0xff2a6d,
  orangeNum: 0xff7b00,
  darkFillNum: 0x120726
} as const;

const SKY_TEXTURE_KEY = 'victory-synthwave-sky';
const SPARK_TEXTURE_KEY = 'victory-spark-particle';
const CONFETTI_TEXTURE_KEY = 'victory-confetti-particle';
const HORIZON_FRACTION = 0.64;
const GRID_ROW_COUNT = 10;

export class VictoryScene extends BaseScene {
  private matchData: VictorySceneData = {
    matchConfig: {
      mode: '1v1',
      stageId: 'championship-stadium',
      p1CharacterId: 'valverde',
      p2CharacterId: 'red-brawler'
    },
    winnerPlayer: 1,
    winnerName: 'P1 VALVERDE',
    winnerCharacterId: 'valverde',
    p1Wins: 2,
    p2Wins: 0,
    roundsPlayed: 2,
    finishReason: 'K.O.'
  };

  private selectedIndex = 0;
  private buttons: VictoryButton[] = [];
  private options: VictoryOption[] = [];
  private transitioning = false;

  private gridGraphics!: Phaser.GameObjects.Graphics;
  private gridPhase = 0;
  private horizonY = 0;

  private burstEmitter?: Phaser.GameObjects.Particles.ParticleEmitter;
  private confettiEmitter?: Phaser.GameObjects.Particles.ParticleEmitter;
  private fireworkTimer?: Phaser.Time.TimerEvent;
  private spotlightGroup?: Phaser.GameObjects.Container;

  constructor() {
    super(SCENE_KEYS.Victory);
  }

  init(data?: Partial<VictorySceneData>): void {
    if (!data) {
      return;
    }

    this.matchData = {
      matchConfig: data.matchConfig ?? this.matchData.matchConfig,
      winnerPlayer: data.winnerPlayer ?? this.matchData.winnerPlayer,
      winnerName: data.winnerName ?? this.matchData.winnerName,
      winnerCharacterId: data.winnerCharacterId ?? this.matchData.winnerCharacterId,
      p1Wins: data.p1Wins ?? this.matchData.p1Wins,
      p2Wins: data.p2Wins ?? this.matchData.p2Wins,
      roundsPlayed: data.roundsPlayed ?? this.matchData.roundsPlayed,
      finishReason: data.finishReason ?? this.matchData.finishReason
    };
  }

  create(): void {
    this.buttons = [];
    this.options = [];
    this.selectedIndex = 0;
    this.transitioning = false;
    this.gridPhase = 0;

    this.markActiveScene(SCENE_KEYS.Victory);

    const { width, height, centerX } = this.cameras.main;
    this.horizonY = Math.round(height * HORIZON_FRACTION);
    this.cameras.main.setBackgroundColor(0x120428);
    this.cameras.main.fadeIn(360, 18, 4, 40);

    this.ensureParticleTextures();
    this.createBackdrop(width, height);
    this.createNeonGridFloor(width);
    this.createCelebrationSpotlights(centerX);
    this.createChampionPodium(centerX);
    this.createNeonWinnerTitle(centerX);
    this.createParticleCelebration(width, centerX);
    this.createButtons(centerX, height);
    this.registerInput();

    this.createFooterHint('← → / A D to navigate • Enter / Space to confirm • R Rematch • Esc Menu');

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.fireworkTimer?.remove(false);
      this.fireworkTimer = undefined;
      this.burstEmitter?.destroy();
      this.burstEmitter = undefined;
      this.confettiEmitter?.destroy();
      this.confettiEmitter = undefined;
      this.clearButtons();
    });
  }

  update(_time: number, delta: number): void {
    const dt = Math.min(delta, 100) / 1000;
    this.gridPhase = (this.gridPhase + dt * 0.55) % 1;
    this.drawNeonGrid();

    if (this.spotlightGroup) {
      this.spotlightGroup.rotation += dt * 0.28;
    }
  }

  private ensureParticleTextures(): void {
    if (!this.textures.exists(SPARK_TEXTURE_KEY)) {
      const graphics = this.add.graphics();
      graphics.fillStyle(0xffffff, 1);
      graphics.fillCircle(8, 8, 6);
      graphics.fillStyle(0xffffff, 0.45);
      graphics.fillCircle(8, 8, 8);
      graphics.generateTexture(SPARK_TEXTURE_KEY, 16, 16);
      graphics.destroy();
    }

    if (!this.textures.exists(CONFETTI_TEXTURE_KEY)) {
      const graphics = this.add.graphics();
      graphics.fillStyle(0xffffff, 1);
      graphics.fillRect(0, 0, 10, 6);
      graphics.generateTexture(CONFETTI_TEXTURE_KEY, 10, 6);
      graphics.destroy();
    }
  }

  private createBackdrop(width: number, height: number): void {
    if (!this.textures.exists(SKY_TEXTURE_KEY)) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = this.horizonY;
      const ctx = canvas.getContext('2d');

      if (ctx) {
        const grad = ctx.createLinearGradient(0, 0, 0, this.horizonY);
        grad.addColorStop(0, COLORS.skyTop);
        grad.addColorStop(0.55, COLORS.skyMid);
        grad.addColorStop(1, COLORS.skyHorizon);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, this.horizonY);
      }

      this.textures.addCanvas(SKY_TEXTURE_KEY, canvas);
    }

    this.add.image(0, 0, SKY_TEXTURE_KEY).setOrigin(0, 0).setDepth(-20);

    // Twinkling celebration stars in the upper sky
    for (let i = 0; i < 36; i += 1) {
      const x = Phaser.Math.Between(24, width - 24);
      const y = Phaser.Math.Between(16, Math.round(this.horizonY * 0.65));
      const size = i % 4 === 0 ? 3 : 2;
      const star = this.add
        .rectangle(x, y, size, size, i % 3 === 0 ? COLORS.goldNum : 0xffffff, Phaser.Math.FloatBetween(0.35, 0.9))
        .setDepth(-19);

      this.tweens.add({
        targets: star,
        alpha: 0.15,
        duration: Phaser.Math.Between(700, 1600),
        delay: Phaser.Math.Between(0, 900),
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut'
      });
    }

    // Dark floor below the horizon
    this.add
      .rectangle(width / 2, this.horizonY + (height - this.horizonY) / 2, width, height - this.horizonY, COLORS.floorBg, 1)
      .setDepth(-15);
  }

  private createNeonGridFloor(width: number): void {
    const accent = this.getWinnerAccentNum();
    this.add.rectangle(width / 2, this.horizonY, width, 6, accent, 0.35).setDepth(-13);
    this.add.rectangle(width / 2, this.horizonY, width, 2, COLORS.cyanNum, 0.95).setDepth(-12);

    this.gridGraphics = this.add.graphics().setDepth(-11);
    this.drawNeonGrid();
  }

  private drawNeonGrid(): void {
    const { width, height, centerX } = this.cameras.main;
    const floorHeight = height - this.horizonY;
    const graphics = this.gridGraphics;
    const accent = this.getWinnerAccentNum();

    graphics.clear();

    const vanishY = this.horizonY - 26;
    for (let col = -9; col <= 9; col += 1) {
      const topX = centerX + col * 52;
      const bottomX = centerX + col * 245;
      const tTop = (this.horizonY - vanishY) / (height - vanishY);
      const startX = Phaser.Math.Linear(topX, bottomX, tTop);

      graphics.lineStyle(4, accent, 0.14);
      graphics.lineBetween(startX, this.horizonY, bottomX, height);
      graphics.lineStyle(1.4, COLORS.cyanNum, 0.6);
      graphics.lineBetween(startX, this.horizonY, bottomX, height);
    }

    for (let row = 0; row < GRID_ROW_COUNT; row += 1) {
      const t = (row + this.gridPhase) / GRID_ROW_COUNT;
      const perspectiveY = this.horizonY + Math.pow(t, 2.2) * floorHeight;

      graphics.lineStyle(4, COLORS.cyanNum, 0.08 + t * 0.18);
      graphics.lineBetween(0, perspectiveY, width, perspectiveY);
      graphics.lineStyle(1.4 + t * 1.1, COLORS.cyanNum, 0.25 + t * 0.6);
      graphics.lineBetween(0, perspectiveY, width, perspectiveY);
    }
  }

  private createCelebrationSpotlights(centerX: number): void {
    const podiumY = 392;
    this.spotlightGroup = this.add.container(centerX, podiumY).setDepth(-14).setAlpha(0);

    const rayCount = 8;
    for (let i = 0; i < rayCount; i += 1) {
      const angle = (Math.PI * 2 * i) / rayCount;
      const rayWidth = 0.13;
      const radius = 520;
      const x1 = Math.cos(angle - rayWidth) * radius;
      const y1 = Math.sin(angle - rayWidth) * radius;
      const x2 = Math.cos(angle + rayWidth) * radius;
      const y2 = Math.sin(angle + rayWidth) * radius;
      const color = i % 2 === 0 ? COLORS.goldNum : this.getWinnerAccentNum();

      const ray = this.add.triangle(0, 0, 0, 0, x1, y1, x2, y2, color, 0.11).setOrigin(0, 0);
      this.spotlightGroup.add(ray);
    }

    this.tweens.add({
      targets: this.spotlightGroup,
      alpha: 1,
      duration: 500,
      ease: 'Sine.Out'
    });
  }

  private createChampionPodium(centerX: number): void {
    const podiumY = 408;
    const accent = this.getWinnerAccentNum();

    // Glowing podium rings on the arena floor
    const outerRing = this.add
      .ellipse(centerX, podiumY + 86, 260, 56, accent, 0.16)
      .setStrokeStyle(3, COLORS.goldNum, 0.9)
      .setDepth(4)
      .setScale(0.4)
      .setAlpha(0);

    const innerRing = this.add
      .ellipse(centerX, podiumY + 86, 180, 36, COLORS.cyanNum, 0.2)
      .setStrokeStyle(2, COLORS.cyanNum, 0.9)
      .setDepth(5)
      .setScale(0.4)
      .setAlpha(0);

    this.tweens.add({
      targets: [outerRing, innerRing],
      scale: 1,
      alpha: 1,
      duration: 460,
      ease: 'Back.Out'
    });

    this.tweens.add({
      targets: outerRing,
      scaleX: 1.07,
      scaleY: 1.09,
      duration: 1200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut'
    });

    // Render the winning fighter's animated idle sprite (with portrait fallback)
    const character = getCharacterDefinition(this.matchData.winnerCharacterId);
    const idleAnim = getCharacterAnimationByAction(character.id, 'idle');

    let championVisual: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image;

    if (this.anims.exists(idleAnim.key)) {
      const sprite = this.add
        .sprite(centerX, podiumY + 84, idleAnim.sheet.key, 0)
        .setOrigin(0.5, 1)
        .setDepth(8);

      const boxHeight = idleAnim.bounds[0]?.visual.height || 180;
      const targetHeight = 205;
      const targetScale = Phaser.Math.Clamp(targetHeight / boxHeight, 0.7, 1.55);

      sprite.play(idleAnim.key);
      sprite.setScale(0.2);
      sprite.setAlpha(0);

      this.tweens.add({
        targets: sprite,
        scale: targetScale,
        alpha: 1,
        duration: 480,
        ease: 'Back.Out',
        onComplete: () => {
          this.tweens.add({
            targets: sprite,
            y: podiumY + 76,
            duration: 1100,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.InOut'
          });
        }
      });

      championVisual = sprite;
    } else {
      const textureKey = this.textures.exists(character.portrait.key) ? character.portrait.key : character.anchorAsset.key;
      const img = this.add.image(centerX, podiumY - 14, textureKey).setOrigin(0.5).setDepth(8);
      const fitScale = Math.min(180 / Math.max(1, img.width), 180 / Math.max(1, img.height));
      img.setScale(0.2).setAlpha(0);

      this.tweens.add({
        targets: img,
        scale: fitScale,
        alpha: 1,
        duration: 480,
        ease: 'Back.Out'
      });

      championVisual = img;
    }

    // Subtle celebration aura behind the fighter
    const aura = this.add.circle(centerX, podiumY - 10, 108, accent, 0.18).setDepth(6).setScale(0.3);
    this.tweens.add({
      targets: aura,
      scale: 1.08,
      alpha: 0.08,
      duration: 1100,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut'
    });

    void championVisual;
  }

  private createNeonWinnerTitle(centerX: number): void {
    const accentHex = this.matchData.winnerPlayer === 1 ? COLORS.cyan : COLORS.magenta;
    const victoryHeaderText =
      this.matchData.finishReason === 'TIME UP' ? 'TIME UP  •  VICTORY!' : 'K.O.  •  VICTORY!';

    // Top glowing arcade kicker
    const kicker = this.add
      .text(centerX, 66, `★  ${victoryHeaderText}  ★`, {
        fontFamily: '"Silkscreen", "JetBrains Mono", monospace',
        fontSize: '20px',
        fontStyle: 'bold',
        color: COLORS.cyan,
        stroke: '#090216',
        strokeThickness: 6
      })
      .setOrigin(0.5)
      .setDepth(16)
      .setShadow(0, 0, COLORS.cyan, 12, true, true)
      .setAlpha(0)
      .setY(48);

    this.tweens.add({
      targets: kicker,
      y: 66,
      alpha: 1,
      duration: 380,
      ease: 'Cubic.Out'
    });

    const winnerHeadline = `${this.matchData.winnerName.toUpperCase()} WINS!`;

    // Back neon bloom layer (additive glow pulse)
    const neonGlow = this.add
      .text(centerX, 134, winnerHeadline, {
        fontFamily: '"Silkscreen", "Press Start 2P", Impact, "Arial Black", sans-serif',
        fontSize: '56px',
        fontStyle: 'bold italic',
        color: accentHex,
        stroke: accentHex,
        strokeThickness: 18,
        padding: { x: 24, y: 12 }
      })
      .setOrigin(0.5)
      .setDepth(15)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0)
      .setScale(1.45);

    // Crisp foreground neon headline with vertical gradient
    const neonTitle = this.add
      .text(centerX, 134, winnerHeadline, {
        fontFamily: '"Silkscreen", "Press Start 2P", Impact, "Arial Black", sans-serif',
        fontSize: '56px',
        fontStyle: 'bold italic',
        color: '#ffffff',
        stroke: '#120428',
        strokeThickness: 10,
        padding: { x: 24, y: 12 }
      })
      .setOrigin(0.5)
      .setDepth(17)
      .setShadow(0, 0, accentHex, 18, true, true)
      .setAlpha(0)
      .setScale(1.45);

    const gradient = neonTitle.context.createLinearGradient(0, 0, 0, neonTitle.height);
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(0.35, COLORS.gold);
    gradient.addColorStop(0.75, accentHex);
    gradient.addColorStop(1, COLORS.magenta);
    neonTitle.setFill(gradient);

    // Slam-in entrance animation + continuous neon sign pulse
    this.tweens.add({
      targets: neonTitle,
      scale: 1,
      alpha: 1,
      duration: 420,
      ease: 'Back.Out'
    });

    this.tweens.add({
      targets: neonGlow,
      scale: 1.02,
      alpha: 0.42,
      duration: 420,
      ease: 'Back.Out',
      onComplete: () => {
        this.tweens.add({
          targets: neonGlow,
          alpha: { from: 0.28, to: 0.58 },
          scale: { from: 1.0, to: 1.035 },
          duration: 680,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.InOut'
        });
      }
    });

    // Clean unboxed match summary below the headline
    const scoreSummary = `FINAL SCORE ${this.matchData.p1Wins} - ${this.matchData.p2Wins}  ·  ${this.matchData.roundsPlayed} ROUNDS  ·  CHAMPION`;
    const summary = this.add
      .text(centerX, 192, scoreSummary, {
        fontFamily: '"Silkscreen", "JetBrains Mono", monospace',
        fontSize: '15px',
        fontStyle: 'bold',
        color: COLORS.gold,
        stroke: '#090216',
        strokeThickness: 5
      })
      .setOrigin(0.5)
      .setDepth(16)
      .setAlpha(0);

    this.tweens.add({
      targets: summary,
      alpha: 1,
      delay: 180,
      duration: 360,
      ease: 'Sine.Out'
    });
  }

  private createParticleCelebration(width: number, centerX: number): void {
    const palette = [COLORS.goldNum, COLORS.cyanNum, COLORS.magentaNum, COLORS.orangeNum, 0xffffff];

    // Radial firework burst emitter (triggered immediately and periodically)
    this.burstEmitter = this.add
      .particles(0, 0, SPARK_TEXTURE_KEY, {
        emitting: false,
        lifespan: { min: 700, max: 1350 },
        speed: { min: 140, max: 440 },
        angle: { min: 0, max: 360 },
        scale: { start: 1.35, end: 0 },
        alpha: { start: 1, end: 0 },
        gravityY: 260,
        tint: palette,
        blendMode: Phaser.BlendModes.ADD
      })
      .setDepth(18);

    // Continuous celebratory neon confetti shower
    this.confettiEmitter = this.add
      .particles(centerX, -16, CONFETTI_TEXTURE_KEY, {
        x: { min: -width / 2 + 40, max: width / 2 - 40 },
        y: 0,
        frequency: 65,
        quantity: 2,
        lifespan: { min: 2800, max: 4200 },
        speedY: { min: 95, max: 195 },
        speedX: { min: -45, max: 45 },
        rotate: { min: 0, max: 360 },
        scale: { min: 0.85, max: 1.55 },
        alpha: { start: 0.95, end: 0.15 },
        tint: palette
      })
      .setDepth(14);

    // Opening double particle burst + shockwave flash around the champion
    this.triggerBurst(centerX, 340, 72);
    this.time.delayedCall(220, () => {
      this.triggerBurst(centerX - 240, 210, 42);
      this.triggerBurst(centerX + 240, 210, 42);
    });

    // Ongoing celebratory fireworks while viewing the Victory screen
    this.fireworkTimer = this.time.addEvent({
      delay: 950,
      loop: true,
      callback: () => {
        const fx = Phaser.Math.Between(160, width - 160);
        const fy = Phaser.Math.Between(110, 320);
        this.triggerBurst(fx, fy, 40);
      }
    });
  }

  private triggerBurst(x: number, y: number, count: number): void {
    this.burstEmitter?.explode(count, x, y);

    const ringColor = Phaser.Math.RND.pick([COLORS.goldNum, COLORS.cyanNum, COLORS.magentaNum]);
    const ring = this.add
      .circle(x, y, 16, ringColor, 0)
      .setStrokeStyle(3, ringColor, 0.95)
      .setDepth(17)
      .setBlendMode(Phaser.BlendModes.ADD);

    this.tweens.add({
      targets: ring,
      scale: 4.5,
      alpha: 0,
      duration: 460,
      ease: 'Cubic.Out',
      onComplete: () => ring.destroy()
    });
  }

  private createButtons(centerX: number, height: number): void {
    this.clearButtons();

    this.options = [
      { label: 'REMATCH', action: () => this.rematch() },
      { label: 'FIGHTERS', action: () => this.changeFighters() },
      { label: 'MAIN MENU', action: () => this.returnToMenu() }
    ];

    const buttonWidth = 240;
    const buttonHeight = 54;
    const gap = 24;
    const totalWidth = this.options.length * buttonWidth + (this.options.length - 1) * gap;
    const startX = centerX - totalWidth / 2 + buttonWidth / 2;
    const y = height - 96;

    this.options.forEach((option, index) => {
      const button = this.createSynthwaveButton({
        x: startX + index * (buttonWidth + gap),
        y,
        width: buttonWidth,
        height: buttonHeight,
        label: option.label,
        onHover: () => this.setSelection(index, true),
        onClick: () => this.confirmOption(option)
      });

      this.buttons.push(button);
    });

    this.setSelection(0, false);
  }

  private createSynthwaveButton(config: {
    x: number;
    y: number;
    width: number;
    height: number;
    label: string;
    onHover: () => void;
    onClick: () => void;
  }): VictoryButton {
    const { x, y, width, height, label, onHover, onClick } = config;

    const outerGlow = this.add
      .rectangle(0, 0, width + 10, height + 10, COLORS.cyanNum, 0.14)
      .setOrigin(0.5);

    const body = this.add
      .rectangle(0, 0, width, height, COLORS.darkFillNum, 0.88)
      .setStrokeStyle(3, COLORS.cyanNum, 0.95)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    const arrow = this.add
      .text(-width / 2 + 22, 0, '▶', {
        fontFamily: '"Silkscreen", monospace',
        fontSize: '18px',
        fontStyle: 'bold',
        color: COLORS.darkText
      })
      .setOrigin(0.5)
      .setVisible(false);

    const text = this.add
      .text(0, 0, label, {
        fontFamily: '"Silkscreen", "JetBrains Mono", monospace',
        fontSize: '20px',
        fontStyle: 'bold',
        color: COLORS.white
      })
      .setOrigin(0.5);

    const container = this.add.container(x, y, [outerGlow, body, arrow, text]).setDepth(25);

    let pulseTween: Phaser.Tweens.Tween | null = null;
    let currentSelected: boolean | null = null;

    const setSelected = (selected: boolean): void => {
      if (currentSelected === selected) {
        return;
      }
      currentSelected = selected;

      if (pulseTween) {
        pulseTween.stop();
        pulseTween = null;
      }

      if (selected) {
        outerGlow.setFillStyle(COLORS.magentaNum, 0.34);
        body.setFillStyle(COLORS.goldNum, 1);
        body.setStrokeStyle(4, COLORS.magentaNum, 1);
        text.setColor(COLORS.darkText);
        arrow.setVisible(true);
        container.setScale(1);

        pulseTween = this.tweens.add({
          targets: container,
          scale: 1.05,
          duration: 500,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.InOut'
        });
      } else {
        outerGlow.setFillStyle(COLORS.cyanNum, 0.14);
        body.setFillStyle(COLORS.darkFillNum, 0.88);
        body.setStrokeStyle(2.5, COLORS.cyanNum, 0.9);
        text.setColor(COLORS.white);
        arrow.setVisible(false);
        container.setScale(1);
      }
    };

    body.on('pointerover', onHover);
    body.on('pointerdown', onClick);

    setSelected(false);

    return {
      container,
      setSelected,
      destroy: () => {
        pulseTween?.stop();
        pulseTween = null;
        container.destroy(true);
      }
    };
  }

  private registerInput(): void {
    const keyboard = this.input.keyboard;
    if (!keyboard) {
      return;
    }

    keyboard.on('keydown-LEFT', () => this.moveSelection(-1));
    keyboard.on('keydown-A', () => this.moveSelection(-1));
    keyboard.on('keydown-UP', () => this.moveSelection(-1));
    keyboard.on('keydown-W', () => this.moveSelection(-1));

    keyboard.on('keydown-RIGHT', () => this.moveSelection(1));
    keyboard.on('keydown-D', () => this.moveSelection(1));
    keyboard.on('keydown-DOWN', () => this.moveSelection(1));
    keyboard.on('keydown-S', () => this.moveSelection(1));

    keyboard.on('keydown-ENTER', () => this.confirmOption(this.options[this.selectedIndex]));
    keyboard.on('keydown-SPACE', () => this.confirmOption(this.options[this.selectedIndex]));
    keyboard.on('keydown-R', () => this.rematch());
    keyboard.on('keydown-ESC', () => this.returnToMenu());
    keyboard.on('keydown-BACKSPACE', () => this.returnToMenu());
  }

  private moveSelection(direction: number): void {
    if (this.transitioning || this.buttons.length === 0) {
      return;
    }

    const next = Phaser.Math.Wrap(this.selectedIndex + direction, 0, this.buttons.length);
    this.setSelection(next, true);
  }

  private setSelection(index: number, playSfx = false): void {
    if (playSfx && index !== this.selectedIndex) {
      playAudioCue(this, AUDIO_KEYS.uiMove, this.app.settingsStore.getState());
    }

    this.selectedIndex = index;
    this.buttons.forEach((button, buttonIndex) => {
      button.setSelected(buttonIndex === index);
    });
  }

  private confirmOption(option?: VictoryOption): void {
    if (!option || this.transitioning) {
      return;
    }

    option.action();
  }

  private rematch(): void {
    if (this.transitioning) {
      return;
    }

    this.transitioning = true;
    playAudioCue(this, AUDIO_KEYS.uiConfirm, this.app.settingsStore.getState());
    this.scene.start(SCENE_KEYS.Match, this.matchData.matchConfig);
  }

  private changeFighters(): void {
    if (this.transitioning) {
      return;
    }

    this.transitioning = true;
    playAudioCue(this, AUDIO_KEYS.uiConfirm, this.app.settingsStore.getState());
    this.scene.start(SCENE_KEYS.CharacterSelect, {
      mode: this.matchData.matchConfig.mode,
      stageId: this.matchData.matchConfig.stageId
    });
  }

  private returnToMenu(): void {
    if (this.transitioning) {
      return;
    }

    this.transitioning = true;
    playAudioCue(this, AUDIO_KEYS.uiConfirm, this.app.settingsStore.getState());
    this.goToMenu();
  }

  private clearButtons(): void {
    this.buttons.forEach((button) => button.destroy());
    this.buttons = [];
  }

  private getWinnerAccentNum(): number {
    return this.matchData.winnerPlayer === 1 ? COLORS.cyanNum : COLORS.magentaNum;
  }
}
