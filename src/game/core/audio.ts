import * as Phaser from 'phaser';

import type { GameSettings } from '../types';

export type AudioCategory = 'music' | 'sfx';
type VolumeAdjustableSound = Phaser.Sound.BaseSound & {
  setVolume?: (value: number) => unknown;
  volume?: number;
};

export interface StarterAudioAsset {
  kind: 'audio';
  key: string;
  url: string;
  category: AudioCategory;
  durationSeconds?: number;
  volume: number;
  loop: boolean;
  usage: string;
}

export interface GeneratedAudioCue {
  kind: 'generated-audio';
  key: string;
  category: AudioCategory;
  frequency: number;
  durationSeconds: number;
  volume: number;
  usage: string;
}

export const AUDIO_KEYS = {
  uiConfirm: 'ui-confirm',
  uiMove: 'sfx-ui-move',
  jump: 'sfx-jump',
  lightWhoosh: 'sfx-light-whoosh',
  heavyWhoosh: 'sfx-heavy-whoosh',
  hitLight: 'sfx-hit-light',
  hitHeavy: 'sfx-hit-heavy',
  block: 'sfx-block',
  specialCharge: 'sfx-special-charge',
  specialHit: 'sfx-special-hit',
  roundBell: 'sfx-round-bell',
  ko: 'sfx-ko',
  victory: 'sfx-victory'
} as const;

export type AudioKey = (typeof AUDIO_KEYS)[keyof typeof AUDIO_KEYS];

export const STARTER_AUDIO_ASSETS: StarterAudioAsset[] = [
  audio(AUDIO_KEYS.uiConfirm, 'sfx', '/assets/audio/sfx/ui-confirm.mp3', 0.38, false, 'menu confirmation cue')
];

export const STARTER_AUDIO_CUES: GeneratedAudioCue[] = [
  cue(AUDIO_KEYS.uiMove, 'sfx', 560, 0.05, 0.16, 'menu navigation tick'),
  cue(AUDIO_KEYS.jump, 'sfx', 240, 0.13, 0.24, 'fighter jump launch'),
  cue(AUDIO_KEYS.lightWhoosh, 'sfx', 680, 0.08, 0.2, 'light attack air whoosh'),
  cue(AUDIO_KEYS.heavyWhoosh, 'sfx', 380, 0.15, 0.28, 'heavy attack air whoosh'),
  cue(AUDIO_KEYS.hitLight, 'sfx', 170, 0.12, 0.36, 'light strike impact'),
  cue(AUDIO_KEYS.hitHeavy, 'sfx', 125, 0.2, 0.44, 'heavy strike impact'),
  cue(AUDIO_KEYS.block, 'sfx', 820, 0.13, 0.3, 'guarded attack metallic clang'),
  cue(AUDIO_KEYS.specialCharge, 'sfx', 220, 0.42, 0.34, 'super meter charge swell'),
  cue(AUDIO_KEYS.specialHit, 'sfx', 140, 0.34, 0.5, 'super finisher explosive impact'),
  cue(AUDIO_KEYS.roundBell, 'sfx', 880, 0.45, 0.34, 'round start bell'),
  cue(AUDIO_KEYS.ko, 'sfx', 110, 0.65, 0.46, 'knockout dramatic impact'),
  cue(AUDIO_KEYS.victory, 'sfx', 523, 0.72, 0.34, 'match victory fanfare'),
  cue('starter-jump', 'sfx', 380, 0.08, 0.34, 'generated jump cue'),
  cue('starter-pickup', 'sfx', 720, 0.1, 0.38, 'generated pickup cue'),
  cue('starter-complete', 'sfx', 520, 0.18, 0.42, 'generated level complete cue'),
  cue('starter-deny', 'sfx', 160, 0.12, 0.28, 'generated blocked/deny cue')
];

let audioContext: AudioContext | null = null;
let noiseBuffer: AudioBuffer | null = null;

interface MatchMusicController {
  timerId: number;
  masterGain: GainNode;
  step: number;
  nextNoteTime: number;
  getSettings: () => GameSettings;
}

let matchMusic: MatchMusicController | null = null;

const MATCH_BPM = 138;
const STEP_SECONDS = 60 / MATCH_BPM / 4;

// E minor 16-bit arcade fighting riff (MIDI note numbers, null = rest).
const BASS_PATTERN: Array<number | null> = [
  40, null, 40, 40, 43, null, 45, null,
  40, null, 40, 43, 47, null, 45, 43,
  36, null, 36, 36, 38, null, 40, null,
  38, null, 38, 43, 45, null, 47, 43
];

const LEAD_PATTERN_A: Array<number | null> = [
  64, null, 67, null, 71, null, 69, 67,
  64, null, null, 62, 64, null, 67, null,
  72, null, 71, null, 69, null, 67, null,
  69, 67, 64, null, 62, null, 59, null
];

const LEAD_PATTERN_B: Array<number | null> = [
  76, null, 74, 72, 71, null, 67, null,
  69, null, 71, 72, 71, null, 67, null,
  72, null, 74, null, 76, null, 79, null,
  74, null, 71, null, 67, 69, 71, null
];

export function getEffectiveVolume(
  assetVolume: number,
  category: AudioCategory,
  settings: GameSettings
): number {
  if (settings.muted) {
    return 0;
  }

  return assetVolume * (category === 'music' ? settings.musicVolume : settings.sfxVolume);
}

export function playAudioAsset(
  scene: Phaser.Scene,
  asset: StarterAudioAsset,
  settings: GameSettings
): void {
  if (scene.sound.locked || !scene.cache.audio.exists(asset.key)) {
    return;
  }

  const volume = getEffectiveVolume(asset.volume, asset.category, settings);

  if (volume <= 0) {
    return;
  }

  scene.sound.play(asset.key, {
    loop: asset.loop,
    volume
  });
}

export function playAudioCue(scene: Phaser.Scene, key: AudioKey | string, settings: GameSettings): void {
  const asset = STARTER_AUDIO_ASSETS.find((candidate) => candidate.key === key);

  if (asset) {
    playAudioAsset(scene, asset, settings);
    return;
  }

  playGeneratedAudioCue(key, settings);
}

export function stopAudioAsset(scene: Phaser.Scene, key: string): void {
  scene.sound.stopByKey(key);
}

export function syncLoopingAudioAsset(
  scene: Phaser.Scene,
  key: AudioKey | string,
  settings: GameSettings
): void {
  const asset = STARTER_AUDIO_ASSETS.find((candidate) => candidate.key === key);

  if (!asset || !asset.loop || scene.sound.locked || !scene.cache.audio.exists(asset.key)) {
    return;
  }

  const volume = getEffectiveVolume(asset.volume, asset.category, settings);
  const existingSounds = scene.sound.getAll<VolumeAdjustableSound>(asset.key);
  const isAlreadyPlaying = existingSounds.some((sound) => sound.isPlaying);

  existingSounds.forEach((sound) => {
    if (typeof sound.setVolume === 'function') {
      sound.setVolume(volume);
      return;
    }

    sound.volume = volume;
  });

  if (!isAlreadyPlaying && volume > 0) {
    scene.sound.play(asset.key, {
      loop: true,
      volume
    });
  }
}

export function startMatchMusic(getSettings: () => GameSettings): void {
  stopMatchMusic();

  const ctx = safeAudioContext();
  if (!ctx) {
    return;
  }

  try {
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {});
    }

    const masterGain = ctx.createGain();
    const initialVolume = getEffectiveVolume(0.24, 'music', getSettings());
    masterGain.gain.setValueAtTime(Math.max(0.0001, initialVolume), ctx.currentTime);
    masterGain.connect(ctx.destination);

    const controller: MatchMusicController = {
      timerId: 0,
      masterGain,
      step: 0,
      nextNoteTime: ctx.currentTime + 0.05,
      getSettings
    };

    const scheduleAhead = (): void => {
      if (matchMusic !== controller) {
        return;
      }

      if (ctx.state === 'suspended') {
        void ctx.resume().catch(() => {});
      }

      syncMatchMusic(controller.getSettings());

      while (controller.nextNoteTime < ctx.currentTime + 0.18) {
        scheduleMusicStep(ctx, controller.masterGain, controller.step, controller.nextNoteTime);
        controller.nextNoteTime += STEP_SECONDS;
        controller.step = (controller.step + 1) % 64;
      }
    };

    controller.timerId = window.setInterval(scheduleAhead, 60);
    matchMusic = controller;
    scheduleAhead();
  } catch {
    stopMatchMusic();
  }
}

export function syncMatchMusic(settings: GameSettings): void {
  if (!matchMusic) {
    return;
  }

  const ctx = safeAudioContext();
  if (!ctx) {
    return;
  }

  const target = getEffectiveVolume(0.24, 'music', settings);
  try {
    matchMusic.masterGain.gain.setTargetAtTime(Math.max(0.0001, target), ctx.currentTime, 0.04);
  } catch {
    // Ignore audio context errors when disposed.
  }
}

export function stopMatchMusic(): void {
  if (!matchMusic) {
    return;
  }

  window.clearInterval(matchMusic.timerId);
  try {
    matchMusic.masterGain.disconnect();
  } catch {
    // Ignore disconnect errors.
  }
  matchMusic = null;
}

export function playGeneratedAudioCue(
  key: string,
  settings: GameSettings,
  providedCtx?: AudioContext
): void {
  const cueAsset = STARTER_AUDIO_CUES.find((candidate) => candidate.key === key);
  if (!cueAsset) {
    return;
  }

  const volume = getEffectiveVolume(cueAsset.volume, cueAsset.category, settings);
  if (volume <= 0) {
    return;
  }

  const audioCtx = providedCtx ?? safeAudioContext();
  if (!audioCtx) {
    return;
  }

  try {
    if (audioCtx.state === 'suspended') {
      void audioCtx.resume().catch(() => {});
    }

    const now = audioCtx.currentTime;

    switch (key) {
      case AUDIO_KEYS.uiMove:
        playTone(audioCtx, 'triangle', 540, 720, now, 0.045, volume);
        return;

      case AUDIO_KEYS.jump:
        playTone(audioCtx, 'triangle', 210, 520, now, 0.13, volume);
        return;

      case AUDIO_KEYS.lightWhoosh:
        playNoiseBurst(audioCtx, now, 0.08, volume, 1600, 650);
        return;

      case AUDIO_KEYS.heavyWhoosh:
        playNoiseBurst(audioCtx, now, 0.15, volume, 950, 280);
        playTone(audioCtx, 'triangle', 240, 110, now, 0.12, volume * 0.5);
        return;

      case AUDIO_KEYS.hitLight:
        playTone(audioCtx, 'sine', 180, 52, now, 0.11, volume);
        playNoiseBurst(audioCtx, now, 0.075, volume * 0.75, 2200, 900);
        return;

      case AUDIO_KEYS.hitHeavy:
        playTone(audioCtx, 'sine', 145, 36, now, 0.2, volume);
        playTone(audioCtx, 'sawtooth', 120, 48, now, 0.14, volume * 0.45);
        playNoiseBurst(audioCtx, now, 0.13, volume * 0.85, 1600, 420);
        return;

      case AUDIO_KEYS.block:
        playTone(audioCtx, 'triangle', 840, 620, now, 0.11, volume * 0.85);
        playTone(audioCtx, 'square', 1240, 980, now, 0.09, volume * 0.35);
        playNoiseBurst(audioCtx, now, 0.05, volume * 0.45, 3200, 1800);
        return;

      case AUDIO_KEYS.specialCharge:
        playTone(audioCtx, 'sawtooth', 190, 760, now, 0.4, volume * 0.45);
        playTone(audioCtx, 'triangle', 285, 1140, now, 0.4, volume * 0.65);
        playTone(audioCtx, 'sine', 520, 1560, now + 0.08, 0.32, volume * 0.4);
        return;

      case AUDIO_KEYS.specialHit:
        playTone(audioCtx, 'sine', 165, 32, now, 0.32, volume);
        playTone(audioCtx, 'sawtooth', 260, 72, now, 0.28, volume * 0.55);
        playTone(audioCtx, 'triangle', 520, 1040, now, 0.18, volume * 0.5);
        playNoiseBurst(audioCtx, now, 0.24, volume * 0.9, 2400, 320);
        return;

      case AUDIO_KEYS.roundBell:
        playTone(audioCtx, 'sine', 880, 880, now, 0.42, volume * 0.7);
        playTone(audioCtx, 'triangle', 1318, 1318, now, 0.36, volume * 0.4);
        playTone(audioCtx, 'sine', 1760, 1754, now, 0.28, volume * 0.25);
        return;

      case AUDIO_KEYS.ko:
        playTone(audioCtx, 'sine', 150, 28, now, 0.6, volume);
        playTone(audioCtx, 'sawtooth', 220, 55, now, 0.55, volume * 0.5);
        playTone(audioCtx, 'sawtooth', 330, 82, now + 0.05, 0.5, volume * 0.4);
        playNoiseBurst(audioCtx, now, 0.28, volume * 0.75, 1400, 240);
        return;

      case AUDIO_KEYS.victory:
        playTone(audioCtx, 'square', 523.25, 523.25, now, 0.11, volume * 0.55);
        playTone(audioCtx, 'square', 659.25, 659.25, now + 0.11, 0.11, volume * 0.55);
        playTone(audioCtx, 'square', 783.99, 783.99, now + 0.22, 0.11, volume * 0.55);
        playTone(audioCtx, 'triangle', 1046.5, 1046.5, now + 0.34, 0.38, volume * 0.85);
        playTone(audioCtx, 'sine', 523.25, 523.25, now + 0.34, 0.38, volume * 0.55);
        return;

      default:
        playTone(audioCtx, 'square', cueAsset.frequency, cueAsset.frequency, now, cueAsset.durationSeconds, volume);
    }
  } catch {
    // Ignore Web Audio failures on locked or headless contexts.
  }
}

function scheduleMusicStep(ctx: AudioContext, destination: GainNode, step: number, time: number): void {
  const step32 = step % 32;
  const isSecondBar = step >= 32;

  // Kick on beat 1 & 3 (and syncopated punch on step 10/26).
  if (step % 4 === 0 || step32 === 10 || step32 === 26) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(128, time);
    osc.frequency.exponentialRampToValueAtTime(38, time + 0.09);
    gain.gain.setValueAtTime(0.48, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
    osc.connect(gain);
    gain.connect(destination);
    osc.start(time);
    osc.stop(time + 0.11);
  }

  // Snare on backbeats.
  if (step % 8 === 4) {
    scheduleMusicNoise(ctx, destination, time, 0.09, 0.24, 1500);
  } else if (step % 2 === 1) {
    // Crisp hi-hat offbeat.
    scheduleMusicNoise(ctx, destination, time, 0.03, 0.09, 5200);
  }

  // Driving bassline.
  const bassNote = BASS_PATTERN[step32];
  if (bassNote !== null) {
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(midiToHz(bassNote), time);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(620, time);
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(0.28, time + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, time + STEP_SECONDS * 0.9);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(destination);
    osc.start(time);
    osc.stop(time + STEP_SECONDS);
  }

  // Arcade synth lead motif.
  const leadNote = isSecondBar ? LEAD_PATTERN_B[step32] : LEAD_PATTERN_A[step32];
  if (leadNote !== null) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(midiToHz(leadNote), time);
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(0.14, time + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, time + STEP_SECONDS * 1.45);
    osc.connect(gain);
    gain.connect(destination);
    osc.start(time);
    osc.stop(time + STEP_SECONDS * 1.5);
  }
}

function scheduleMusicNoise(
  ctx: AudioContext,
  destination: GainNode,
  time: number,
  duration: number,
  level: number,
  filterFreq: number
): void {
  const buffer = getNoiseBuffer(ctx);
  const src = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();

  src.buffer = buffer;
  filter.type = 'highpass';
  filter.frequency.setValueAtTime(filterFreq, time);
  gain.gain.setValueAtTime(level, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

  src.connect(filter);
  filter.connect(gain);
  gain.connect(destination);
  src.start(time);
  src.stop(time + duration + 0.01);
}

function playTone(
  ctx: AudioContext,
  type: OscillatorType,
  freqStart: number,
  freqEnd: number,
  startTime: number,
  duration: number,
  volume: number
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(20, freqStart), startTime);
  if (freqEnd !== freqStart) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), startTime + duration);
  }

  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.linearRampToValueAtTime(volume, startTime + Math.min(0.014, duration * 0.25));
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.02);
}

function playNoiseBurst(
  ctx: AudioContext,
  startTime: number,
  duration: number,
  volume: number,
  freqStart: number,
  freqEnd: number
): void {
  const src = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();

  src.buffer = getNoiseBuffer(ctx);
  filter.type = 'bandpass';
  filter.Q.value = 1.4;
  filter.frequency.setValueAtTime(freqStart, startTime);
  filter.frequency.exponentialRampToValueAtTime(Math.max(80, freqEnd), startTime + duration);

  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.linearRampToValueAtTime(volume, startTime + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  src.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  src.start(startTime);
  src.stop(startTime + duration + 0.02);
}

function getNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) {
    return noiseBuffer;
  }

  const length = Math.floor(ctx.sampleRate * 0.5);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) {
    channel[i] = Math.random() * 2 - 1;
  }

  noiseBuffer = buffer;
  return buffer;
}

function midiToHz(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

function cue(
  key: string,
  category: AudioCategory,
  frequency: number,
  durationSeconds: number,
  volume: number,
  usage: string
): GeneratedAudioCue {
  return {
    kind: 'generated-audio',
    key,
    category,
    frequency,
    durationSeconds,
    volume,
    usage
  };
}

function audio(
  key: AudioKey,
  category: AudioCategory,
  url: string,
  volume: number,
  loop: boolean,
  usage: string
): StarterAudioAsset {
  return {
    kind: 'audio',
    key,
    url,
    category,
    volume,
    loop,
    usage
  };
}

function safeAudioContext(): AudioContext | null {
  try {
    audioContext ??= new AudioContext();
    return audioContext;
  } catch {
    return null;
  }
}
