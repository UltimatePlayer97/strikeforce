import * as THREE from 'three';
import { game } from '../game/state';

export type GunKind = 'assault' | 'smg' | 'lmg' | 'shotgun' | 'sniper';

interface SpatialInfo {
  pan: number;
  gain: number;
}

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

const GUN_PROFILES: Record<GunKind, [number, number]> = {
  assault: [1, 1],
  smg: [0.85, 1.3],
  lmg: [1.1, 0.8],
  shotgun: [1.3, 0.6],
  sniper: [1.45, 0.5],
};

/** Procedural Web Audio synthesizer. Zero external audio files. */
export class SoundFX {
  private ctx: AudioContext | null = null;

  init(): void {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as WebkitWindow).webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  private noiseBuffer(
    ctx: AudioContext,
    seconds: number,
    shape: (i: number, n: number, rate: number) => number,
  ): AudioBuffer {
    const size = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, size, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < size; i++) data[i] = (Math.random() * 2 - 1) * shape(i, size, ctx.sampleRate);
    return buffer;
  }

  playGunshot(
    isPlayer = true,
    _distance = 0,
    kind: GunKind = 'assault',
    pos: THREE.Vector3 | null = null,
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const prof = GUN_PROFILES[kind] || [1, 1];
    const spatialInfo: SpatialInfo = pos && !isPlayer ? this.spatial(pos, 70) : { pan: 0, gain: 1 };
    const atten = isPlayer ? 0.32 : Math.min(0.24, spatialInfo.gain * 0.28) * prof[0];
    if (atten <= 0.005) return;

    // White noise burst for propellant crack
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer(ctx, 0.14, (i, _n, rate) => Math.exp(-i / (rate * 0.028)));

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime((isPlayer ? 1350 : 950) * prof[1], now);
    filter.Q.value = 0.85;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(atten, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

    noise.connect(filter);
    filter.connect(gain);
    if (isPlayer) gain.connect(ctx.destination);
    else this.connectSpatial(gain, pos, 70);
    noise.start(now);

    // Low punch thump
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(38, now + 0.09);
    oscGain.gain.setValueAtTime(atten * 0.8, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    osc.connect(oscGain);
    oscGain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.095);
  }

  playHitmarker(isHeadshot = false): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = isHeadshot ? 'sine' : 'triangle';
    osc.frequency.setValueAtTime(isHeadshot ? 1950 : 1200, now);
    osc.frequency.exponentialRampToValueAtTime(isHeadshot ? 2600 : 750, now + 0.065);
    gain.gain.setValueAtTime(0.24, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.075);
  }

  playReload(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    [0, 0.75, 1.35].forEach((offset, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(idx === 2 ? 780 : 480, now + offset);
      gain.gain.setValueAtTime(0.11, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.06);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.065);
    });
  }

  private spatial(pos: { x: number; z: number } | null, maxDistance: number): SpatialInfo {
    if (!pos) return { pan: 0, gain: 1 };
    const hp = game.humanPlayer;
    const dx = pos.x - hp.pos.x;
    const dz = pos.z - hp.pos.z;
    const dist = Math.hypot(dx, dz);
    const right = { x: Math.cos(hp.yaw), z: -Math.sin(hp.yaw) };
    const pan = dist > 0.01 ? THREE.MathUtils.clamp((dx * right.x + dz * right.z) / dist, -1, 1) : 0;
    const gain = Math.max(0, 1 - dist / maxDistance) ** 1.35;
    return { pan, gain };
  }

  private connectSpatial(
    node: AudioNode,
    pos: { x: number; z: number } | null,
    maxDistance: number,
  ): SpatialInfo {
    const ctx = this.ctx;
    const s = this.spatial(pos, maxDistance);
    if (ctx && typeof StereoPannerNode !== 'undefined' && s.pan !== 0) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = s.pan;
      node.connect(panner);
      panner.connect(ctx.destination);
      return s;
    }
    if (ctx) node.connect(ctx.destination);
    return s;
  }

  playFootstep(pos: THREE.Vector3, intensity = 1): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const s = this.spatial(pos, 42);
    if (s.gain <= 0.01) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(85 + Math.random() * 25, now);
    osc.frequency.exponentialRampToValueAtTime(45 + Math.random() * 15, now + 0.085);
    gain.gain.setValueAtTime(0.055 * intensity * s.gain, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    osc.connect(gain);
    this.connectSpatial(gain, pos, 42);
    osc.start(now);
    osc.stop(now + 0.095);
  }

  playGrenadeBounce(pos: THREE.Vector3, intensity = 1): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const s = this.spatial(pos, 40);
    if (s.gain <= 0.01) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(210 + Math.random() * 55, now);
    gain.gain.setValueAtTime(0.085 * intensity * s.gain, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);
    osc.connect(gain);
    this.connectSpatial(gain, pos, 40);
    osc.start(now);
    osc.stop(now + 0.06);
  }

  playThrow(pos: THREE.Vector3): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const s = this.spatial(pos, 24);
    if (s.gain <= 0.01) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx, 0.08, (i, n) => 1 - i / n);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1300;
    filter.Q.value = 1.5;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.08 * s.gain, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    src.connect(filter);
    filter.connect(gain);
    this.connectSpatial(gain, pos, 24);
    src.start(now);
  }

  playSmokePop(pos: THREE.Vector3): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const s = this.spatial(pos, 34);
    if (s.gain <= 0.01) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx, 0.22, (i, _n, rate) => Math.exp(-i / (rate * 0.075)));
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1600, now);
    filter.frequency.exponentialRampToValueAtTime(300, now + 0.22);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.2 * s.gain, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    src.connect(filter);
    filter.connect(gain);
    this.connectSpatial(gain, pos, 34);
    src.start(now);
  }

  playExplosion(pos: THREE.Vector3): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const s = this.spatial(pos, 80);
    const boom = Math.max(0.02, s.gain);
    const now = ctx.currentTime;
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer(ctx, 0.55, (i, _n, rate) => Math.exp(-i / (rate * 0.19)));
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.setValueAtTime(650, now);
    low.frequency.exponentialRampToValueAtTime(110, now + 0.52);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.48 * boom, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    noise.connect(low);
    low.connect(gain);
    this.connectSpatial(gain, pos, 80);
    noise.start(now);

    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(92, now);
    osc.frequency.exponentialRampToValueAtTime(31, now + 0.45);
    oscGain.gain.setValueAtTime(0.34 * boom, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.48);
    osc.connect(oscGain);
    this.connectSpatial(oscGain, pos, 80);
    osc.start(now);
    osc.stop(now + 0.5);
  }

  playDamageTaken(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(110, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.16);
    gain.gain.setValueAtTime(0.26, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.17);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.18);
  }
}

export const sfx = new SoundFX();
