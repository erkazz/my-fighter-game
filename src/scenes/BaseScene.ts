import * as Phaser from 'phaser';

import { getAppContext } from '../game/context';
import type { AppContext } from '../game/context';
import { SCENE_KEYS, type SceneKey } from '../game/types';

export abstract class BaseScene extends Phaser.Scene {
  protected get app(): AppContext {
    return getAppContext();
  }

  protected markActiveScene(sceneKey: SceneKey): void {
    this.app.debugStore.patchState({ activeScene: sceneKey });
  }

  protected createMenuAtmosphere(accentColor = 0x38bdf8): void {
    const { width, height, centerX } = this.cameras.main;

    // Deep midnight horizon bands
    this.add.rectangle(centerX, height * 0.25, width, height * 0.5, 0x070d1f, 0.9).setDepth(-10);
    this.add.rectangle(centerX, height * 0.78, width, height * 0.44, 0x0b1228, 0.95).setDepth(-10);

    // Subtle stadium/arcade spotlight wash at center
    const halo = this.add.circle(centerX, height * 0.44, 340, accentColor, 0.07).setDepth(-9);
    const innerHalo = this.add.circle(centerX, height * 0.44, 190, accentColor, 0.08).setDepth(-9);

    this.tweens.add({
      targets: [halo, innerHalo],
      scale: 1.08,
      alpha: 0.04,
      duration: 2800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut'
    });

    // Retro perspective horizon grid along the lower floor
    const grid = this.add.graphics().setDepth(-8);
    const horizonY = Math.round(height * 0.7);
    grid.lineStyle(1, accentColor, 0.16);
    grid.lineBetween(0, horizonY, width, horizonY);

    for (let row = 1; row <= 5; row += 1) {
      const y = horizonY + row * row * 8.5;
      if (y < height) {
        grid.lineStyle(1, accentColor, 0.08 + row * 0.015);
        grid.lineBetween(0, y, width, y);
      }
    }

    for (let col = -6; col <= 6; col += 1) {
      const topX = centerX + col * 95;
      const bottomX = centerX + col * 240;
      grid.lineStyle(1, accentColor, 0.1);
      grid.lineBetween(topX, horizonY, bottomX, height);
    }

    // Floating ambient embers
    for (let i = 0; i < 20; i += 1) {
      const x = Phaser.Math.Between(40, width - 40);
      const y = Phaser.Math.Between(40, height - 40);
      const size = Phaser.Math.Between(2, 4);
      const particle = this.add
        .rectangle(x, y, size, size, i % 3 === 0 ? 0xfacc15 : accentColor, Phaser.Math.FloatBetween(0.2, 0.55))
        .setDepth(-7);

      this.tweens.add({
        targets: particle,
        y: y - Phaser.Math.Between(24, 70),
        alpha: { from: 0.12, to: 0.6 },
        duration: Phaser.Math.Between(2400, 4400),
        delay: Phaser.Math.Between(0, 1200),
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut'
      });
    }
  }

  protected createHeading(title: string, subtitle: string): void {
    const { centerX } = this.cameras.main;

    this.add
      .text(centerX, 52, title, {
        color: '#f8fafc',
        fontFamily: 'monospace',
        fontStyle: 'bold',
        fontSize: '36px',
        stroke: '#020617',
        strokeThickness: 5
      })
      .setOrigin(0.5);

    this.add.rectangle(centerX, 78, 220, 2, 0x38bdf8, 0.65);

    if (subtitle) {
      this.add
        .text(centerX, 100, subtitle, {
          color: '#cbd5e1',
          fontFamily: 'monospace',
          fontSize: '16px'
        })
        .setOrigin(0.5);
    }
  }

  protected createFooterHint(text: string): void {
    const { centerX, height } = this.cameras.main;

    this.add
      .text(centerX, height - 28, text, {
        color: '#94a3b8',
        fontFamily: 'monospace',
        fontSize: '14px'
      })
      .setOrigin(0.5)
      .setDepth(100);
  }

  protected goToMenu(): void {
    this.scene.start(SCENE_KEYS.MainMenu);
  }
}
