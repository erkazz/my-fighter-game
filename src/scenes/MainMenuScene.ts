import * as Phaser from 'phaser';

import { GAME_TAGLINE, GAME_TITLE } from '../game/constants';
import { AUDIO_KEYS, playAudioCue } from '../game/core/audio';
import { SCENE_KEYS } from '../game/types';
import { BaseScene } from './BaseScene';

interface MenuOption {
  label: string;
  action: () => void;
}

interface FloatingEmber {
  rect: Phaser.GameObjects.Rectangle;
  baseX: number;
  speedY: number;
  swayAmp: number;
  swayFreq: number;
  phase: number;
}

interface SynthwaveButton {
  container: Phaser.GameObjects.Container;
  setSelected: (selected: boolean) => void;
  destroy: () => void;
}

const COLORS = {
  skyTop: '#1a0b2e',
  skyMid: '#5b0e5c',
  magenta: '#ff2a6d',
  orange: '#ff7b00',
  gold: '#ffd700',
  cyan: '#05d9e8',
  floorBg: 0x0b031a,
  darkText: '#1a0b2e',
  lightText: '#f8fafc',
  goldNum: 0xffd700,
  magentaNum: 0xff2a6d,
  cyanNum: 0x05d9e8,
  darkFillNum: 0x120726
} as const;

const HORIZON_FRACTION = 0.6;
const SKY_TEXTURE_KEY = 'synthwave-menu-sky';
const SUN_TEXTURE_KEY = 'synthwave-menu-sun';
const GRID_ROW_COUNT = 12;

export class MainMenuScene extends BaseScene {
  private selectedIndex = 0;
  private buttons: SynthwaveButton[] = [];
  private options: MenuOption[] = [];

  private gridGraphics!: Phaser.GameObjects.Graphics;
  private gridPhase = 0;
  private horizonY = 0;
  private embers: FloatingEmber[] = [];

  constructor() {
    super(SCENE_KEYS.MainMenu);
  }

  create(): void {
    this.buttons = [];
    this.options = [];
    this.embers = [];
    this.gridPhase = 0;
    this.selectedIndex = 0;

    this.markActiveScene(SCENE_KEYS.MainMenu);

    const { width, height } = this.cameras.main;
    this.horizonY = Math.round(height * HORIZON_FRACTION);
    this.cameras.main.setBackgroundColor(0x1a0b2e);

    this.createSynthwaveBackdrop(width, height);
    this.createRetroSun(width);
    this.createSkylineSilhouettes(width);
    this.createNeonFloor(width, height);
    this.createFloatingEmbers(width, height);
    this.createArcadeTitle(width);
    this.renderMenu();

    this.registerInput();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.clearButtons();
      this.embers = [];
      this.selectedIndex = 0;
      this.options = [];
    });

    this.createFooterHint('▲▼ / W S to navigate • Enter / Space to confirm');
  }

  update(time: number, delta: number): void {
    const dt = Math.min(delta, 100) / 1000;
    this.gridPhase = (this.gridPhase + dt * 0.65) % 1;
    this.drawNeonGrid();

    const { height } = this.cameras.main;
    const elapsed = time / 1000;

    for (const ember of this.embers) {
      ember.rect.y -= ember.speedY * dt;
      ember.rect.x = ember.baseX + Math.sin(elapsed * ember.swayFreq + ember.phase) * ember.swayAmp;

      if (ember.rect.y < -12) {
        ember.rect.y = height + 12;
        ember.baseX = Phaser.Math.Between(30, this.cameras.main.width - 30);
      }
    }
  }

  private createSynthwaveBackdrop(width: number, height: number): void {
    if (!this.textures.exists(SKY_TEXTURE_KEY)) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = this.horizonY;
      const ctx = canvas.getContext('2d');

      if (ctx) {
        const gradient = ctx.createLinearGradient(0, 0, 0, this.horizonY);
        gradient.addColorStop(0, COLORS.skyTop);
        gradient.addColorStop(0.45, COLORS.skyMid);
        gradient.addColorStop(0.82, COLORS.magenta);
        gradient.addColorStop(1, COLORS.orange);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, this.horizonY);
      }

      this.textures.addCanvas(SKY_TEXTURE_KEY, canvas);
    }

    this.add.image(0, 0, SKY_TEXTURE_KEY).setOrigin(0, 0).setDepth(-20);

    // Subtle twinkling stars in the deep purple upper sky
    for (let i = 0; i < 42; i += 1) {
      const x = Phaser.Math.Between(20, width - 20);
      const y = Phaser.Math.Between(14, Math.round(this.horizonY * 0.52));
      const size = i % 5 === 0 ? 3 : 2;
      const star = this.add.rectangle(x, y, size, size, 0xffffff, Phaser.Math.FloatBetween(0.35, 0.85)).setDepth(-19);

      this.tweens.add({
        targets: star,
        alpha: 0.15,
        duration: Phaser.Math.Between(900, 2200),
        delay: Phaser.Math.Between(0, 1400),
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut'
      });
    }

    // Dark floor base below the horizon
    this.add
      .rectangle(width / 2, this.horizonY + (height - this.horizonY) / 2, width, height - this.horizonY, COLORS.floorBg, 1)
      .setDepth(-15);
  }

  private createRetroSun(width: number): void {
    const radius = 165;
    const sunSize = radius * 2 + 16;

    if (!this.textures.exists(SUN_TEXTURE_KEY)) {
      const canvas = document.createElement('canvas');
      canvas.width = sunSize;
      canvas.height = sunSize;
      const ctx = canvas.getContext('2d');

      if (ctx) {
        const cx = sunSize / 2;
        const cy = sunSize / 2;

        // Draw golden -> orange -> hot pink sun disc
        const sunGrad = ctx.createLinearGradient(0, cy - radius, 0, cy + radius);
        sunGrad.addColorStop(0, COLORS.gold);
        sunGrad.addColorStop(0.48, COLORS.orange);
        sunGrad.addColorStop(1, COLORS.magenta);

        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fillStyle = sunGrad;
        ctx.fill();

        // Horizontal scanline cutouts near the lower half of the sun
        ctx.globalCompositeOperation = 'destination-out';
        const cutouts = [
          { yRatio: 0.12, h: 4 },
          { yRatio: 0.25, h: 6 },
          { yRatio: 0.39, h: 8 },
          { yRatio: 0.54, h: 11 },
          { yRatio: 0.71, h: 14 },
          { yRatio: 0.88, h: 16 }
        ];

        for (const cut of cutouts) {
          const y = cy + radius * cut.yRatio;
          ctx.fillRect(0, y, sunSize, cut.h);
        }

        ctx.globalCompositeOperation = 'source-over';
      }

      this.textures.addCanvas(SUN_TEXTURE_KEY, canvas);
    }

    const sunY = this.horizonY - 26;
    const outerGlow = this.add.circle(width / 2, sunY, radius + 34, COLORS.magentaNum, 0.22).setDepth(-18);
    const innerGlow = this.add.circle(width / 2, sunY, radius + 12, COLORS.goldNum, 0.18).setDepth(-18);

    this.tweens.add({
      targets: [outerGlow, innerGlow],
      scale: 1.07,
      alpha: 0.12,
      duration: 2400,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut'
    });

    this.add.image(width / 2, sunY, SUN_TEXTURE_KEY).setOrigin(0.5).setDepth(-17);
  }

  private createSkylineSilhouettes(width: number): void {
    const skyline = this.add.graphics().setDepth(-16);
    skyline.fillStyle(0x130624, 0.92);

    let x = 0;
    const heights = [34, 62, 46, 86, 52, 98, 40, 72, 108, 48, 66, 92, 42, 76, 54, 88, 38];
    let index = 0;

    while (x < width) {
      const buildingW = 48 + ((index * 19) % 44);
      const buildingH = heights[index % heights.length];
      skyline.fillRect(x, this.horizonY - buildingH, buildingW + 2, buildingH);
      x += buildingW;
      index += 1;
    }
  }

  private createNeonFloor(width: number, height: number): void {
    // Horizon glowing laser seam
    this.add.rectangle(width / 2, this.horizonY, width, 6, COLORS.cyanNum, 0.35).setDepth(-13);
    this.add.rectangle(width / 2, this.horizonY, width, 2, COLORS.cyanNum, 0.95).setDepth(-12);

    // Horizon pink accent wash
    this.add
      .rectangle(width / 2, this.horizonY + 28, width, 56, COLORS.magentaNum, 0.12)
      .setDepth(-14);

    // Persistent Graphics layer redrawn every frame for the scrolling neon grid
    this.gridGraphics = this.add.graphics().setDepth(-11);
    void height;
    this.drawNeonGrid();
  }

  private drawNeonGrid(): void {
    const { width, height, centerX } = this.cameras.main;
    const floorHeight = height - this.horizonY;
    const graphics = this.gridGraphics;

    graphics.clear();

    // Perspective vertical rays fanning out from the vanishing point
    const vanishY = this.horizonY - 24;
    for (let col = -9; col <= 9; col += 1) {
      const topX = centerX + col * 52;
      const bottomX = centerX + col * 245;
      const tTop = (this.horizonY - vanishY) / (height - vanishY);
      const startX = Phaser.Math.Linear(topX, bottomX, tTop);

      graphics.lineStyle(5, COLORS.cyanNum, 0.16);
      graphics.lineBetween(startX, this.horizonY, bottomX, height);
      graphics.lineStyle(1.6, COLORS.cyanNum, 0.72);
      graphics.lineBetween(startX, this.horizonY, bottomX, height);
    }

    // Scrolling horizontal grid lines accelerating toward the viewer
    for (let row = 0; row < GRID_ROW_COUNT; row += 1) {
      const t = (row + this.gridPhase) / GRID_ROW_COUNT;
      const perspectiveY = this.horizonY + Math.pow(t, 2.25) * floorHeight;
      const glowAlpha = 0.08 + t * 0.22;
      const lineAlpha = 0.3 + t * 0.65;

      graphics.lineStyle(5, COLORS.cyanNum, glowAlpha);
      graphics.lineBetween(0, perspectiveY, width, perspectiveY);
      graphics.lineStyle(1.5 + t * 1.2, COLORS.cyanNum, lineAlpha);
      graphics.lineBetween(0, perspectiveY, width, perspectiveY);
    }
  }

  private createFloatingEmbers(width: number, height: number): void {
    const palette = [COLORS.goldNum, COLORS.magentaNum, COLORS.cyanNum];

    for (let i = 0; i < 28; i += 1) {
      const baseX = Phaser.Math.Between(30, width - 30);
      const y = Phaser.Math.Between(30, height - 20);
      const size = Phaser.Math.Between(3, 6);
      const color = palette[i % palette.length];
      const rect = this.add
        .rectangle(baseX, y, size, size, color, Phaser.Math.FloatBetween(0.35, 0.85))
        .setDepth(-8);

      this.tweens.add({
        targets: rect,
        alpha: 0.15,
        scale: 1.4,
        duration: Phaser.Math.Between(900, 1900),
        delay: Phaser.Math.Between(0, 1000),
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut'
      });

      this.embers.push({
        rect,
        baseX,
        speedY: Phaser.Math.FloatBetween(26, 64),
        swayAmp: Phaser.Math.FloatBetween(8, 22),
        swayFreq: Phaser.Math.FloatBetween(1.1, 2.4),
        phase: Phaser.Math.FloatBetween(0, Math.PI * 2)
      });
    }
  }

  private createArcadeTitle(width: number): void {
    const centerX = width / 2;

    const title = this.add
      .text(centerX, 118, GAME_TITLE, {
        fontFamily: '"Silkscreen", "Press Start 2P", Impact, "Arial Black", sans-serif',
        fontSize: '72px',
        fontStyle: 'bold italic',
        color: '#ffffff',
        stroke: COLORS.skyTop,
        strokeThickness: 12,
        padding: { x: 16, y: 10 }
      })
      .setOrigin(0.5)
      .setDepth(10)
      .setShadow(6, 8, '#090214', 10, true, true);

    const gradient = title.context.createLinearGradient(0, 0, 0, title.height);
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(0.38, COLORS.gold);
    gradient.addColorStop(0.76, COLORS.orange);
    gradient.addColorStop(1, COLORS.magenta);
    title.setFill(gradient);

    const subtitle = this.add
      .text(centerX, 188, `★  ${GAME_TAGLINE}  ★`, {
        fontFamily: '"Silkscreen", "JetBrains Mono", monospace',
        fontSize: '20px',
        fontStyle: 'bold',
        color: COLORS.cyan,
        stroke: '#0b031a',
        strokeThickness: 6
      })
      .setOrigin(0.5)
      .setDepth(10)
      .setShadow(0, 0, COLORS.cyan, 10, true, true);

    this.tweens.add({
      targets: subtitle,
      alpha: 0.45,
      scale: 1.04,
      duration: 850,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut'
    });
  }

  private renderMenu(): void {
    this.clearButtons();

    const playOption: MenuOption = { label: 'PLAY', action: () => this.scene.start(SCENE_KEYS.ModeSelect) };
    const settingsOption: MenuOption = { label: 'SETTINGS', action: () => this.scene.start(SCENE_KEYS.Settings) };
    this.options = [playOption, settingsOption];

    const buttonHeight = 62;
    const verticalGap = 20;
    const startY = 446;

    this.options.forEach((option, index) => {
      const y = startY + index * (buttonHeight + verticalGap);
      const button = this.createSynthwaveButton({
        x: this.cameras.main.centerX,
        y,
        width: 360,
        height: buttonHeight,
        label: option.label,
        onClick: () => this.confirmOption(option),
        onHover: () => this.setSelection(index, true)
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
    onClick: () => void;
    onHover: () => void;
  }): SynthwaveButton {
    const { x, y, width, height, label, onClick, onHover } = config;

    const outerGlow = this.add
      .rectangle(0, 0, width + 10, height + 10, COLORS.cyanNum, 0.14)
      .setOrigin(0.5);

    const body = this.add
      .rectangle(0, 0, width, height, COLORS.darkFillNum, 0.86)
      .setStrokeStyle(3, COLORS.cyanNum, 0.95)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    const arrow = this.add
      .text(-width / 2 + 28, 0, '▶', {
        fontFamily: '"Silkscreen", monospace',
        fontSize: '22px',
        fontStyle: 'bold',
        color: COLORS.darkText
      })
      .setOrigin(0.5)
      .setVisible(false);

    const text = this.add
      .text(0, 0, label, {
        fontFamily: '"Silkscreen", "JetBrains Mono", monospace',
        fontSize: '24px',
        fontStyle: 'bold',
        color: COLORS.lightText
      })
      .setOrigin(0.5);

    const container = this.add.container(x, y, [outerGlow, body, arrow, text]).setDepth(20);

    let pulseTween: Phaser.Tweens.Tween | null = null;
    let isCurrentlySelected = false;

    const setSelected = (selected: boolean): void => {
      if (isCurrentlySelected === selected && pulseTween !== null) {
        return;
      }
      isCurrentlySelected = selected;

      if (pulseTween) {
        pulseTween.stop();
        pulseTween = null;
      }

      if (selected) {
        outerGlow.setFillStyle(COLORS.magentaNum, 0.32);
        body.setFillStyle(COLORS.goldNum, 1);
        body.setStrokeStyle(4, COLORS.magentaNum, 1);
        text.setColor(COLORS.darkText);
        arrow.setVisible(true);
        container.setScale(1);

        pulseTween = this.tweens.add({
          targets: container,
          scale: 1.045,
          duration: 520,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.InOut'
        });
      } else {
        outerGlow.setFillStyle(COLORS.cyanNum, 0.14);
        body.setFillStyle(COLORS.darkFillNum, 0.86);
        body.setStrokeStyle(2.5, COLORS.cyanNum, 0.9);
        text.setColor(COLORS.lightText);
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

    const keyUp = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.UP);
    const keyDown = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN);
    const keyW = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    const keyS = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S);
    const keyEnter = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
    const keySpace = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    keyUp.on('down', () => this.moveSelection(-1));
    keyW.on('down', () => this.moveSelection(-1));
    keyDown.on('down', () => this.moveSelection(1));
    keyS.on('down', () => this.moveSelection(1));
    keyEnter.on('down', () => this.confirmOption(this.options[this.selectedIndex]));
    keySpace.on('down', () => this.confirmOption(this.options[this.selectedIndex]));
  }

  private moveSelection(direction: number): void {
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

  private clearButtons(): void {
    this.buttons.forEach((button) => {
      button.destroy();
    });
    this.buttons = [];
  }

  private confirmOption(option?: MenuOption): void {
    if (!option) {
      return;
    }

    playAudioCue(this, AUDIO_KEYS.uiConfirm, this.app.settingsStore.getState());
    option.action();
  }
}
