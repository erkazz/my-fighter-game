import * as Phaser from 'phaser';

import { FIGHTING_UI_ATLAS_TEXTURE_KEY } from './fightingUiAtlas';

/** Render depth for combat VFX: above fighters, below the HUD. */
const VFX_DEPTH = 90;

/** Tint/spark colour keyed to the kind of impact. */
export type VfxColor = 'red' | 'gold' | 'blue';

const SPARK_FRAME: Record<VfxColor, string> = {
  red: 'icon-hit-red',
  gold: 'icon-hit-gold',
  blue: 'icon-hit-blue'
};

const FLASH_TINT: Record<VfxColor, number> = {
  red: 0xff5a5a,
  gold: 0xffd24a,
  blue: 0x7ec8ff
};

/**
 * Spawns a short-lived hit spark (an atlas impact icon) at a contact point that
 * pops in, scales up, and fades out. Used when an attack connects.
 * @param scene - The owning scene.
 * @param x - World x of the contact point.
 * @param y - World y of the contact point.
 * @param color - Spark colour (red clean hit, blue blocked, gold finisher).
 * @param scale - Peak display scale of the spark (default 1).
 */
export function spawnHitSpark(
  scene: Phaser.Scene,
  x: number,
  y: number,
  color: VfxColor = 'red',
  scale = 1
): void {
  if (scene.textures.exists(FIGHTING_UI_ATLAS_TEXTURE_KEY)) {
    const frame = SPARK_FRAME[color];
    const spark = scene.add
      .image(x, y, FIGHTING_UI_ATLAS_TEXTURE_KEY, frame)
      .setDepth(VFX_DEPTH)
      .setScrollFactor(1)
      .setScale(0.2 * scale)
      .setAngle(Phaser.Math.Between(-30, 30))
      .setAlpha(1);

    scene.tweens.add({
      targets: spark,
      scale: scale,
      alpha: 0,
      duration: 220,
      ease: 'Cubic.Out',
      onComplete: () => spark.destroy()
    });
  }

  spawnImpactFlash(scene, x, y, color, 34 * scale);

  const particleCount = scale >= 1.4 ? 12 : 7;
  const tint = FLASH_TINT[color];

  for (let i = 0; i < particleCount; i += 1) {
    const angle = (Math.PI * 2 * i) / particleCount + Phaser.Math.FloatBetween(-0.25, 0.25);
    const distance = Phaser.Math.Between(28, 72) * scale;
    const size = Phaser.Math.Between(4, 9);
    const shard = scene.add
      .rectangle(x, y, size, size, i % 2 === 0 ? tint : 0xffffff, 0.95)
      .setDepth(VFX_DEPTH + 1)
      .setScrollFactor(1)
      .setAngle(Phaser.Math.RadToDeg(angle));

    scene.tweens.add({
      targets: shard,
      x: x + Math.cos(angle) * distance,
      y: y + Math.sin(angle) * distance,
      scale: 0.2,
      alpha: 0,
      duration: Phaser.Math.Between(180, 290),
      ease: 'Cubic.Out',
      onComplete: () => shard.destroy()
    });
  }
}

/**
 * Spawns an expanding ring flash at a point that fades as it grows.
 * @param scene - The owning scene.
 * @param x - World x of the flash centre.
 * @param y - World y of the flash centre.
 * @param color - Flash tint.
 * @param radius - Peak radius in world pixels.
 */
export function spawnImpactFlash(
  scene: Phaser.Scene,
  x: number,
  y: number,
  color: VfxColor,
  radius = 40
): void {
  const ring = scene.add
    .circle(x, y, radius * 0.3, FLASH_TINT[color], 0.55)
    .setDepth(VFX_DEPTH - 1)
    .setScrollFactor(1);

  scene.tweens.add({
    targets: ring,
    scale: 2.4,
    alpha: 0,
    duration: 260,
    ease: 'Cubic.Out',
    onComplete: () => ring.destroy()
  });

  if (radius >= 48) {
    const shockwave = scene.add
      .circle(x, y, radius * 0.35, FLASH_TINT[color], 0)
      .setStrokeStyle(3, FLASH_TINT[color], 0.9)
      .setDepth(VFX_DEPTH - 1)
      .setScrollFactor(1);

    scene.tweens.add({
      targets: shockwave,
      scale: 3.1,
      alpha: 0,
      duration: 320,
      ease: 'Cubic.Out',
      onComplete: () => shockwave.destroy()
    });
  }
}

/**
 * Spawns a special-move charge burst around a fighter: concentric rings that
 * collapse inward and rising energy motes, telegraphing the wind-up.
 * @param scene - The owning scene.
 * @param x - World x of the fighter's centre.
 * @param y - World y of the fighter's centre (roughly mid-body).
 * @param color - Aura colour.
 */
export function spawnChargeAura(scene: Phaser.Scene, x: number, y: number, color: VfxColor = 'gold'): void {
  const tint = FLASH_TINT[color];

  for (let index = 0; index < 3; index += 1) {
    const ring = scene.add
      .circle(x, y, 18, tint, 0)
      .setStrokeStyle(4, tint, 0.9)
      .setDepth(VFX_DEPTH - 1)
      .setScrollFactor(1)
      .setScale(1.7);

    scene.tweens.add({
      targets: ring,
      scale: 0.2,
      alpha: 0,
      delay: index * 110,
      duration: 420,
      ease: 'Sine.In',
      onComplete: () => ring.destroy()
    });
  }

  for (let index = 0; index < 10; index += 1) {
    const offsetX = Phaser.Math.Between(-56, 56);
    const startY = y + Phaser.Math.Between(10, 65);
    const mote = scene.add
      .rectangle(x + offsetX, startY, 5, 10, index % 2 === 0 ? tint : 0xffffff, 0.9)
      .setDepth(VFX_DEPTH - 1)
      .setScrollFactor(1);

    scene.tweens.add({
      targets: mote,
      y: startY - Phaser.Math.Between(70, 125),
      alpha: 0,
      scaleY: 1.6,
      delay: index * 32,
      duration: 420,
      ease: 'Quad.Out',
      onComplete: () => mote.destroy()
    });
  }
}
