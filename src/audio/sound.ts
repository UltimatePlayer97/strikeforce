import * as THREE from 'three';
import type { HumanPlayer } from '../game/player';

let humanPlayerRef: HumanPlayer | null = null;

export function setHumanPlayerRef(ref: HumanPlayer | null): void {
  humanPlayerRef = ref;
}

export class SoundFX {
  private ctx: AudioContext | null = null;

  init(): void {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  playGunshot(isPlayer = true, distance = 0, kind = 'assault', pos: THREE.Vector3 | null = null): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const prof = { assault: [1, 1], smg: [0.85, 1.3], lmg: [1.1, 0.8], shotgun: [1.3, 0.6], sniper: [1.45, 0.5] }[kind] || [1, 1];
    const spatialInfo = pos && !isPlayer ? this.spatial(pos, 70) : { pan: 0, gain: 1 };
    const atten = (isPlayer ? 0.32 : Math.min(0.24, spatialInfo.gain * 0.28) * prof[0]);
    if (atten <= 0.005) return;

    const bufferSize = Math.floor(this.ctx.sampleRate * 0.14);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.028));
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime((isPlayer ? 1350 : 950) * prof[1], now);
    filter.Q.value = 0.85;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(atten, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

    noise.connect(filter);
    filter.connect(gain);
    if (isPlayer) gain.connect(this.ctx.destination);
    else this.connectSpatial(gain, pos, 70);
    noise.start(now);

    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(38, now + 0.09);
    oscGain.gain.setValueAtTime(atten * 0.8, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    osc.connect(oscGain);
    oscGain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.095);
  }

  playHitmarker(isHeadshot = false): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = isHeadshot ? 'sine' : 'triangle';
    osc.frequency.setValueAtTime(isHeadshot ? 1950 : 1200, now);
    osc.frequency.exponentialRampToValueAtTime(isHeadshot ? 2600 : 750, now + 0.065);
    gain.gain.setValueAtTime(0.24, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
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

  spatial(pos: THREE.Vector3, maxDistance: number): { pan: number; gain: number } {
    if (!pos || !humanPlayerRef) return { pan: 0, gain: 1 };
    const hp = humanPlayerRef!;
    const dx = pos.x - hp.soldier.pos.x;
    const dz = pos.z - hp.soldier.pos.z;
    const dist = Math.hypot(dx, dz);
    const forward = { x: -Math.sin(hp.soldier.yaw), z: -Math.cos(hp.soldier.yaw) };
    const right = { x: Math.cos(hp.soldier.yaw), z: -Math.sin(hp.soldier.yaw) };
    const pan = dist > 0.01 ? THREE.MathUtils.clamp((dx * right.x + dz * right.z) / dist, -1, 1) : 0;
    const gain = Math.max(0, 1 - dist / maxDistance) ** 1.35;
    return { pan, gain };
  }

  connectSpatial(node: AudioNode, pos: THREE.Vector3 | null, maxDistance: number): { pan: number; gain: number } {
    const s = this.spatial(pos!, maxDistance);
    if (typeof StereoPannerNode !== 'undefined' && this.ctx && s.pan !== 0) {
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = s.pan;
      node.connect(panner);
      panner.connect(this.ctx.destination);
      return s;
    }
    node.connect(this.ctx!.destination);
    return s;
  }

  playFootstep(pos: THREE.Vector3, intensity = 1): void {
    if (!this.ctx) return;
    const s = this.spatial(pos, 42);
    if (s.gain <= 0.01) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
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
    if (!this.ctx) return;
    const s = this.spatial(pos, 40);
    if (s.gain <= 0.01) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
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
    if (!this.ctx) return;
    const s = this.spatial(pos, 24);
    if (s.gain <= 0.01) return;
    const now = this.ctx.currentTime;
    const bufferSize = Math.floor(this.ctx.sampleRate * 0.08);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1300;
    filter.Q.value = 1.5;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.08 * s.gain, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    src.connect(filter);
    filter.connect(gain);
    this.connectSpatial(gain, pos, 24);
    src.start(now);
  }

  playSmokePop(pos: THREE.Vector3): void {
    if (!this.ctx) return;
    const s = this.spatial(pos, 34);
    if (s.gain <= 0.01) return;
    const now = this.ctx.currentTime;
    const bufferSize = Math.floor(this.ctx.sampleRate * 0.22);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.075));
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1600, now);
    filter.frequency.exponentialRampToValueAtTime(300, now + 0.22);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.2 * s.gain, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    src.connect(filter);
    filter.connect(gain);
    this.connectSpatial(gain, pos, 34);
    src.start(now);
  }

  playExplosion(pos: THREE.Vector3): void {
    if (!this.ctx) return;
    const s = this.spatial(pos, 80);
    const boom = Math.max(0.02, s.gain);
    const now = this.ctx.currentTime;
    const bufferSize = Math.floor(this.ctx.sampleRate * 0.55);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.19));
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    const low = this.ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.setValueAtTime(650, now);
    low.frequency.exponentialRampToValueAtTime(110, now + 0.52);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.48 * boom, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    noise.connect(low);
    low.connect(gain);
    this.connectSpatial(gain, pos, 80);
    noise.start(now);

    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
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
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(110, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.16);
    gain.gain.setValueAtTime(0.26, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.17);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.18);
  }
}

export const sfx = new SoundFX();