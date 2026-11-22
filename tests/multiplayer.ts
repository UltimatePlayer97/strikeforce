import * as THREE from 'three';
import { beforeAll, vi } from 'vitest';

// Mock browser globals
export class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = MockWebSocket.CONNECTING;
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  url: string;
  private sendQueue: string[] = [];

  constructor(url: string) {
    this.url = url;
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.(new Event('open'));
    }, 0);
  }

  send(data: string): void {
    this.sendQueue.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new CloseEvent('close'));
  }

  simulateMessage(data: string): void {
    if (this.readyState === MockWebSocket.OPEN && this.onmessage) {
      this.onmessage(new MessageEvent('message', { data }));
    }
  }

  getSentMessages(): string[] {
    return [...this.sendQueue];
  }

  clearSentMessages(): void {
    this.sendQueue = [];
  }
}

export class MockRTCDataChannel {
  label: string;
  ordered: boolean;
  maxRetransmits: number | null;
  readyState: RTCDataChannelState = 'connecting';
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  private sendQueue: string[] = [];
  private _peer: MockRTCDataChannel | null = null;

  constructor(label: string, options?: RTCDataChannelInit) {
    this.label = label;
    this.ordered = options?.ordered ?? true;
    this.maxRetransmits = options?.maxRetransmits ?? null;
  }

  send(data: string): void {
    this.sendQueue.push(data);
    if (this._peer && this.readyState === 'open') {
      setTimeout(() => this._peer!.simulateMessage(data), 0);
    }
  }

  close(): void {
    this.readyState = 'closed';
    this.onclose?.(new Event('close'));
  }

  simulateMessage(data: string): void {
    if (this.readyState === 'open' && this.onmessage) {
      this.onmessage(new MessageEvent('message', { data }));
    }
  }

  getSentMessages(): string[] {
    return [...this.sendQueue];
  }

  clearSentMessages(): void {
    this.sendQueue = [];
  }

  setPeer(peer: MockRTCDataChannel): void {
    this._peer = peer;
  }
}

export class MockRTCPeerConnection {
  connectionState: RTCPeerConnectionState = 'new';
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  onicecandidate: ((ev: RTCPeerConnectionIceEvent) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  ondatachannel: ((ev: RTCDataChannelEvent) => void) | null = null;
  private dataChannels: MockRTCDataChannel[] = [];
  private iceCandidates: RTCIceCandidateInit[] = [];

  constructor() {}

  createDataChannel(label: string, options?: RTCDataChannelInit): MockRTCDataChannel {
    const channel = new MockRTCDataChannel(label, options);
    this.dataChannels.push(channel);
    setTimeout(() => {
      channel.readyState = 'open';
      channel.onopen?.(new Event('open'));
    }, 0);
    return channel;
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    this.localDescription = { type: 'offer', sdp: 'mock-offer' };
    return this.localDescription;
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    this.localDescription = { type: 'answer', sdp: 'mock-answer' };
    return this.localDescription;
  }

  async setLocalDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = desc;
  }

  async setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = desc;
    if (desc.type === 'offer') {
      const channel = this.createDataChannel('events');
      channel.readyState = 'open';
      this.ondatachannel?.(new RTCDataChannelEvent('datachannel', { channel }));
      const channel2 = this.createDataChannel('state', { ordered: false, maxRetransmits: 0 });
      channel2.readyState = 'open';
      this.ondatachannel?.(new RTCDataChannelEvent('datachannel', { channel: channel2 }));
    }
  }

  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    this.iceCandidates.push(candidate);
  }

  getDataChannels(): MockRTCDataChannel[] {
    return this.dataChannels;
  }

  close(): void {
    this.connectionState = 'closed';
    this.onconnectionstatechange?.();
  }
}

// Assign to globalThis for the application code
globalThis.WebSocket = MockWebSocket as any;
globalThis.RTCPeerConnection = MockRTCPeerConnection as any;
globalThis.RTCDataChannel = MockRTCDataChannel as any;
globalThis.RTCIceCandidate = class MockRTCIceCandidate {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
  constructor(init: RTCIceCandidateInit) {
    this.candidate = init.candidate || '';
    this.sdpMid = init.sdpMid ?? null;
    this.sdpMLineIndex = init.sdpMLineIndex ?? null;
  }
} as any;
globalThis.RTCSessionDescription = class MockRTCSessionDescription {
  type: RTCSdpType;
  sdp: string;
  constructor(init: RTCSessionDescriptionInit) {
    this.type = init.type;
    this.sdp = init.sdp || '';
  }
} as any;

// Mock performance.now
let mockTime = 0;
globalThis.performance = {
  now: () => mockTime,
} as any;

export function advanceTime(ms: number): void {
  mockTime += ms;
}

export function resetTime(): void {
  mockTime = 0;
}

// Mock Three.js MathUtils
if (!THREE.MathUtils) {
  (THREE as any).MathUtils = {
    clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
    lerp: (start: number, end: number, alpha: number) => start + (end - start) * alpha,
  };
}

// Mock DOM
globalThis.document = {
  createElement: () => ({
    classList: { add: () => {}, remove: () => {}, toggle: () => {} },
    style: {},
    appendChild: () => {},
    remove: () => {},
  }),
  getElementById: () => null,
  querySelector: () => null,
  body: { appendChild: () => {}, removeChild: () => {} },
} as any;

globalThis.window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  navigator: { clipboard: { writeText: async () => {} } },
  location: { href: 'http://localhost', search: '', pathname: '/' },
} as any;

// Mock localStorage
const mockStorage = new Map<string, string>();
globalThis.localStorage = {
  getItem: (key: string) => mockStorage.get(key) || null,
  setItem: (key: string, value: string) => mockStorage.set(key, value),
  removeItem: (key: string) => mockStorage.delete(key),
  clear: () => mockStorage.clear(),
} as any;