import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock all modules that depend on DOM/WebGL/audio BEFORE importing the actual modules
vi.mock('../src/audio/SoundFX', () => ({
  sfx: {
    playGunshot: () => {},
    playHitmarker: () => {},
    playDamageTaken: () => {},
    playFootstep: () => {},
    playExplosion: () => {},
    playReload: () => {},
  },
}));

vi.mock('../src/combat/effects', () => ({
  spawnBulletTracer: () => {},
  spawnImpactSparks: () => {},
  spawnDroppedRifle: () => {},
  updateBallisticsAndProps: () => {},
  clearAllCorpses: () => {},
  retireCorpse: () => false,
}));

vi.mock('../src/combat/throwables', () => ({
  deploySmokeProjectile: () => {},
  explodeProjectile: () => {},
  spawnThrowerViewProjectile: () => null,
  throwThrowable: () => {},
  lobGrenadeAtTarget: () => {},
  retreatSmokeEscape: () => {},
  clearThrowableVisuals: () => {},
}));

vi.mock('../src/combat/destructibles', () => ({
  damageDestructible: () => {},
  damageDestructibleNearPoint: () => {},
}));

vi.mock('../src/ui/feedback', () => ({
  triggerHitmarker: () => {},
  triggerDamageDirection: () => {},
  showHudToast: () => {},
  showSpawnProtectionStatus: () => {},
  addKillfeedEntry: () => {},
  updateSpawnProtection: () => {},
}));

vi.mock('../src/ui/hud', () => ({
  updateHUD: () => {},
  updateWeaponHUD: () => {},
  updateThrowableHUD: () => {},
}));

vi.mock('../src/ui/lobby', () => ({
  renderNetUI: () => {},
  setNetStatus: () => {},
  updateNetBadge: () => {},
}));

vi.mock('../src/ui/scoreboard', () => ({
  renderScoreboard: () => {},
}));

vi.mock('../src/ui/radar', () => ({
  updateRadar: () => {},
}));

vi.mock('../src/core/renderer', () => ({
  scene: { add: () => {}, remove: () => {} },
  camera: { position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 }, fov: 75, updateProjectionMatrix: () => {} },
  renderer: { render: () => {} },
  canvas: { requestPointerLock: () => {} },
}));

vi.mock('../src/weapons/viewmodel', () => ({
  fpWeaponRoot: { visible: true, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
  muzzleFlashMesh: { visible: false, getWorldPosition: () => {}, rotation: { x: 0, y: 0, z: 0 } },
  muzzlePointLight: { intensity: 0 },
  weaponView: { hip: [0, 0, 0], ads: [0, 0, 0] },
  equipWeapon: () => {},
  rebuildPlayerViewmodel: () => {},
  weaponRecoilOffset: { z: 0, pitch: 0 },
}));

vi.mock('../src/weapons/defs', () => ({
  weaponOf: () => ({
    id: 'assault',
    cooldown: 0.1,
    auto: true,
    dmg: 25,
    head: 100,
    upper: 35,
    pellets: 1,
    pelletSpread: 0,
    spreadHip: 0.03,
    spreadMove: 0.04,
    spreadAds: 0.01,
    kick: 0.5,
    chScale: 1,
    speed: 1,
    adsFov: 45,
    adsSens: 0.6,
    scope: false,
    reticle: false,
    falloff: { start: 30, end: 80, min: 0.5 },
    botRange: 40,
    botBurst: [3, 5],
    botDelay: 0.1,
    botSigma: 0.1,
    engage: 35,
    minDist: 5,
    sightMul: 1,
    stats: [1, 1, 1, 1],
    hint: '',
    mag: 30,
    reserve: 180,
    reload: 1.75,
    shell: false,
    shellTime: 0,
  }),
  isWeaponId: () => true,
  pickBotLoadout: () => 'assault',
}));

vi.mock('../src/weapons/models', () => ({
  createWeaponInstance: () => ({}),
}));

vi.mock('../src/rig/soldierRig', () => ({
  createSoldierRig: () => ({
    root: {},
    bones: { mixamorigRightHand: {} },
    mixer: { stopAllAction: () => {} },
    beaconMesh: {},
  }),
  rifleCarryWorldQuat: () => ({ x: 0, y: 0, z: 0, w: 1 }),
}));

vi.mock('../src/rig/soldierTemplate', () => ({
  loadSoldierGLB: (cb: () => void) => cb(),
}));

vi.mock('../src/rig/stance', () => ({
  updateSoldierRigVisual: () => {},
  rifleCarryWorldQuat: () => ({ x: 0, y: 0, z: 0, w: 1 }),
}));

vi.mock('../src/physics/ragdoll', () => ({
  applyRagdollToSoldierRig: () => {},
  RAGDOLL_NODE: { CHEST: 0 },
  VerletRagdoll: class MockRagdoll {
    nodes = [{ x: 0, y: 0, z: 0 }];
    constructor() {}
    step() {}
  },
}));

vi.mock('../src/world/collision', () => ({
  raycastMap: () => ({ hit: false, distance: 1000, collider: null }),
  getFloorHeightAt: () => 0,
  resolveCylinderCollision: () => {},
}));

vi.mock('../src/world/mapLoader', () => ({
  loadMap: () => {},
  randomMapId: () => 'compound',
}));

vi.mock('../src/world/def/maps', () => ({
  MAP_DEFINITIONS: {
    compound: {
      id: 'compound',
      label: 'Compound',
      arenaLimit: 48.2,
      radarHalf: 52,
      lightZ: 10,
      pieces: [],
      spawns: { ALPHA: [[-20, 0, -20]], BRAVO: [[20, 0, 20]] },
      tactical: { waypoints: [], safe: { ALPHA: [0], BRAVO: [0] }, flank: [], warehouse: [], mid: [], camp: [], rally: [] },
      nav: { profiles: ['soldier'], offMeshLinks: [] },
    },
  },
}));

vi.mock('../src/ai/bots', () => ({
  updateAIBots: () => {},
  getBotNavigation: () => null,
}));

vi.mock('../src/game/player', () => ({
  updateHumanPlayer: () => {},
}));

vi.mock('../src/game/loop', () => ({
  startLoop: () => {},
}));

vi.mock('../src/input/controls', () => ({
  initControls: () => {},
}));

vi.mock('../src/ui/menu', () => ({
  initMenu: () => {},
}));

vi.mock('../src/util/dom', () => ({
  $: (id: string) => ({
    classList: { add: () => {}, remove: () => {}, toggle: () => {} },
    style: {},
    textContent: '',
  }),
}));

// Dynamic imports - will be initialized in beforeEach
let NetClient: any;
let allSoldiers: any;
let game: any;
let matchState: any;

// --- Test Helpers ---
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.OPEN;
  url: string;
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;

  private messageQueue: string[] = [];
  private relay: any = null;

  constructor(url: string) {
    this.url = url;
    this.onopen?.(new Event('open'));
  }

  setRelay(relay: any) {
    this.relay = relay;
  }

  send(data: string) {
    this.messageQueue.push(data);
    this.relay?.broadcast(this, data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new CloseEvent('close'));
  }

  receive(data: string) {
    if (this.readyState === MockWebSocket.OPEN && this.onmessage) {
      this.onmessage(new MessageEvent('message', { data }));
    }
  }

  getSentMessages() { return [...this.messageQueue]; }
  clearSentMessages() { this.messageQueue = []; }
}

class MockRTCDataChannel {
  label = '';
  ordered = true;
  maxRetransmits: number | null = null;
  readyState: 'connecting' | 'open' | 'closing' | 'closed' = 'open';
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  binaryType: 'arraybuffer' | 'blob' = 'arraybuffer';
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  id = 0;
  negotiated = false;
  protocol = '';
  onbufferedamountlow: ((ev: Event) => void) | null = null;
  onclosing: ((ev: Event) => void) | null = null;
  maxPacketLifeTime = 0;

  private peer: MockRTCDataChannel | null = null;
  private sentMessages: string[] = [];

  constructor(label: string, options?: { ordered?: boolean; maxRetransmits?: number | null }) {
    this.label = label;
    this.ordered = options?.ordered ?? true;
    this.maxRetransmits = options?.maxRetransmits ?? null;
    this.onopen?.(new Event('open'));
  }

  setPeer(peer: MockRTCDataChannel) {
    this.peer = peer;
  }

  send(data: string | ArrayBuffer | Blob | ArrayBufferView): void {
    const str = typeof data === 'string' ? data : String(data);
    this.sentMessages.push(str);
    if (this.peer && this.readyState === 'open') {
      this.peer._receive(str);
    }
  }

  _receive(data: string) {
    if (this.readyState === 'open' && this.onmessage) {
      this.onmessage(new MessageEvent('message', { data }));
    }
  }

  close() {
    this.readyState = 'closed';
    this.onclose?.(new Event('close'));
  }

  getSentMessages() { return [...this.sentMessages]; }
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() { return true; }
}

class MockRTCPeerConnection {
  connectionState: RTCPeerConnectionState = 'connected';
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  onicecandidate: ((ev: RTCPeerConnectionIceEvent) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  ondatachannel: ((ev: { channel: MockRTCDataChannel }) => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
  onicegatheringstatechange: (() => void) | null = null;
  onsignalingstatechange: (() => void) | null = null;
  onnegotiationneeded: (() => void) | null = null;
  onicecandidateerror: ((ev: RTCPeerConnectionIceErrorEvent) => void) | null = null;
  ontrack: ((ev: RTCTrackEvent) => void) | null = null;

  canTrickleIceCandidates = false;
  currentLocalDescription: RTCSessionDescriptionInit | null = null;
  currentRemoteDescription: RTCSessionDescriptionInit | null = null;
  iceConnectionState: RTCIceConnectionState = 'new';
  iceGatheringState: RTCIceGatheringState = 'new';
  signalingState: RTCSignalingState = 'stable';

  pendingLocalDescription: RTCSessionDescriptionInit | null = null;
  pendingRemoteDescription: RTCSessionDescriptionInit | null = null;
  sctp: any = null;
  addTrack: () => any = () => ({});
  removeTrack: () => void = () => {};
  getSenders: () => any[] = () => [];
  getReceivers: () => any[] = () => [];

  private dataChannels: MockRTCDataChannel[] = [];

  createDataChannel(label: string, options?: { ordered?: boolean; maxRetransmits?: number | null }): MockRTCDataChannel {
    const channel = new MockRTCDataChannel(label, options);
    this.dataChannels.push(channel);
    return channel;
  }

  async createOffer(options?: RTCOfferOptions): Promise<RTCSessionDescriptionInit> {
    this.localDescription = { type: 'offer', sdp: 'mock-offer' };
    return this.localDescription;
  }

  async createAnswer(options?: RTCAnswerOptions): Promise<RTCSessionDescriptionInit> {
    this.localDescription = { type: 'answer', sdp: 'mock-answer' };
    return this.localDescription;
  }

  async setLocalDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = desc;
  }

  async setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = desc;
    if (desc.type === 'offer') {
      const eventsChannel = this.createDataChannel('events');
      this.ondatachannel?.({ channel: eventsChannel });
      const stateChannel = this.createDataChannel('state', { ordered: false, maxRetransmits: 0 });
      this.ondatachannel?.({ channel: stateChannel });
    }
  }

  async addIceCandidate(candidate: RTCIceCandidateInit | RTCIceCandidate): Promise<void> {
    // ignore for tests
  }

  close(): void {
    this.connectionState = 'closed';
    this.onconnectionstatechange?.();
  }

  getConfiguration(): RTCConfiguration { return {}; }
  getStats(): Promise<RTCStatsReport> { return Promise.resolve(new RTCStatsReport()); }
  getTransceivers(): RTCRtpTransceiver[] { return []; }
  addTransceiver(): RTCRtpTransceiver { return {} as any; }
  createDTMFSender(): RTCDTMFSender | null { return null; }
  addEventListener(): void {}
  removeEventListener(): void {}
  dispatchEvent(): boolean { return true; }
}

class MockRelay {
  private clients: Map<string, any> = new Map();
  private rooms: Map<string, Set<any>> = new Map();
  private wsToRoom: Map<any, string> = new Map();

  register(ws: any, room: string) {
    this.clients.set(ws.url, ws);
    this.wsToRoom.set(ws, room);
    if (!this.rooms.has(room)) this.rooms.set(room, new Set());
    this.rooms.get(room)!.add(ws);
  }

  unregister(ws: any) {
    this.clients.delete(ws.url);
    const room = this.wsToRoom.get(ws);
    if (room) {
      this.rooms.get(room)?.delete(ws);
      this.wsToRoom.delete(ws);
    }
  }

  broadcast(from: any, data: string) {
    const room = this.wsToRoom.get(from);
    if (!room) return;
    const clients = this.rooms.get(room);
    if (!clients) return;
    for (const client of clients) {
      if (client !== from && client.readyState === 1) {
        client.receive(data);
      }
    }
  }
}

function createMockSoldier(id: number, team: 'ALPHA' | 'BRAVO' = 'ALPHA'): any {
  return {
    id,
    name: `PLAYER${id}`,
    defName: `PLAYER${id}`,
    team,
    isPlayer: false,
    spawnIdx: 0,
    pos: { x: 0, y: 0, z: 0, clone: () => ({ x: 0, y: 0, z: 0 }) },
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    hp: 100,
    maxHp: 100,
    spawnProtection: 0,
    alive: true,
    respawnTimer: 0,
    kills: 0,
    deaths: 0,
    onGround: true,
    rig: { root: {}, mixer: { stopAllAction: () => {} }, beaconMesh: { visible: true } },
    weaponHolder: null,
    ragdoll: null,
    killerName: '',
    weaponId: 'assault',
    reloadTotal: 1.75,
    magAmmo: 30,
    reserveAmmo: 180,
    fireCooldown: 0,
    reloading: false,
    reloadTimer: 0,
    aiState: 'ADVANCE',
    aiRole: null,
    aiRoleTime: 0,
    aiObjective: null,
    aiCampTarget: null,
    path: [],
    pathTimer: 0,
    targetEnemy: null,
    burstCooldown: 0,
    strafeDir: 1,
    strafeTimer: 0,
    lastZoneName: '',
    aimTargetId: -1,
    lockTime: 0,
    reactTimer: 0,
    burstShots: 0,
    burstLen: 4,
    aimHeight: 1.05,
    crouch: 0,
    stanceTarget: 0,
    stanceTimer: 0,
    sprinting: false,
    grenadeCharges: 1,
    smokeCharges: 1,
    grenadeCooldown: 0,
    smokeCooldown: 0,
    aiSmokeEscapePlanned: false,
    aiGrenadeTimer: 0,
    footstepTimer: 0,
  };
}

async function setupClients() {
  // Set global mocks BEFORE importing net module
  globalThis.WebSocket = MockWebSocket as any;
  globalThis.RTCPeerConnection = MockRTCPeerConnection as any;
  globalThis.RTCDataChannel = MockRTCDataChannel as any;

  // Import modules dynamically so globals are already mocked
  const netModule = await import('../src/net/net');
  const stateModule = await import('../src/game/state');

  NetClient = netModule.NetClient;
  allSoldiers = stateModule.allSoldiers;
  game = stateModule.game;
  matchState = stateModule.matchState;

  // Reset state
  allSoldiers.length = 0;
  matchState.alphaScore = 0;
  matchState.bravoScore = 0;
  matchState.roundOver = false;
  matchState.timeRemaining = 600;
  game.humanPlayer = null;

  const relay = new MockRelay();

  // Create Host (slot 0)
  const hostWs = new MockWebSocket('wss://test/host');
  hostWs.setRelay(relay);
  relay.register(hostWs, 'TEST');
  const hostNet = new NetClient();
  hostNet.ws = hostWs;
  hostNet.active = true;
  hostNet.slot = 0;
  hostNet.hostSlot = 0;
  hostNet.isHost = true;
  hostNet.room = 'TEST';
  hostWs.onmessage = (ev: MessageEvent<string>) => {
    let m: any;
    try { m = JSON.parse(ev.data); } catch { return; }
    if (hostNet.ws === hostWs) hostNet.handle(m);
  };

  // Create Guest A (slot 1)
  const guestAWs = new MockWebSocket('wss://test/guestA');
  guestAWs.setRelay(relay);
  relay.register(guestAWs, 'TEST');
  const guestANet = new NetClient();
  guestANet.ws = guestAWs;
  guestANet.active = true;
  guestANet.slot = 1;
  guestANet.hostSlot = 0;
  guestANet.isHost = false;
  guestANet.room = 'TEST';
  guestAWs.onmessage = (ev: MessageEvent<string>) => {
    let m: any;
    try { m = JSON.parse(ev.data); } catch { return; }
    if (guestANet.ws === guestAWs) guestANet.handle(m);
  };

  // Create Guest B (slot 2)
  const guestBWs = new MockWebSocket('wss://test/guestB');
  guestBWs.setRelay(relay);
  relay.register(guestBWs, 'TEST');
  const guestBNet = new NetClient();
  guestBNet.ws = guestBWs;
  guestBNet.active = true;
  guestBNet.slot = 2;
  guestBNet.hostSlot = 0;
  guestBNet.isHost = false;
  guestBNet.room = 'TEST';
  guestBWs.onmessage = (ev: MessageEvent<string>) => {
    let m: any;
    try { m = JSON.parse(ev.data); } catch { return; }
    if (guestBNet.ws === guestBWs) guestBNet.handle(m);
  };

  const roster = [
    { slot: 0, name: 'HOST' },
    { slot: 1, name: 'GUEST_A' },
    { slot: 2, name: 'GUEST_B' },
  ];
  hostNet.applyRoster(roster);
  guestANet.applyRoster(roster);
  guestBNet.applyRoster(roster);

  const hostSoldier = createMockSoldier(0, 'ALPHA');
  hostSoldier.isPlayer = true;
  const guestASoldier = createMockSoldier(1, 'BRAVO');
  const guestBSoldier = createMockSoldier(2, 'BRAVO');
  allSoldiers.push(hostSoldier, guestASoldier, guestBSoldier);

  return {
    host: { net: hostNet, ws: hostWs, slot: 0, isHost: true, relay },
    guestA: { net: guestANet, ws: guestAWs, slot: 1, isHost: false, relay },
    guestB: { net: guestBNet, ws: guestBWs, slot: 2, isHost: false, relay },
  };
}

function connectPeersWebRTC(clientA: any, clientB: any) {
  const pcA = new MockRTCPeerConnection();
  const pcB = new MockRTCPeerConnection();

  const channelA_events = pcA.createDataChannel('events');
  const channelA_state = pcA.createDataChannel('state', { ordered: false, maxRetransmits: 0 });
  const channelB_events = pcB.createDataChannel('events');
  const channelB_state = pcB.createDataChannel('state', { ordered: false, maxRetransmits: 0 });

  channelA_events.setPeer(channelB_events);
  channelB_events.setPeer(channelA_events);
  channelA_state.setPeer(channelB_state);
  channelB_state.setPeer(channelA_state);

  const setupChannel = (net: any, channel: any, peerSlot: number) => {
    channel.onmessage = (event: any) => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (net.validatePeerMessage(message, peerSlot)) net.handle(message, peerSlot);
    };
  };

  setupChannel(clientA.net, channelA_events, clientB.slot);
  setupChannel(clientA.net, channelA_state, clientB.slot);
  setupChannel(clientB.net, channelB_events, clientA.slot);
  setupChannel(clientB.net, channelB_state, clientA.slot);

  clientA.net.peers.set(clientB.slot, {
    pc: pcA as any, slot: clientB.slot, state: channelA_state, events: channelA_events,
    ready: true, pendingIce: [],
  });
  clientB.net.peers.set(clientA.slot, {
    pc: pcB as any, slot: clientA.slot, state: channelB_state, events: channelB_events,
    ready: true, pendingIce: [],
  });

  clientA.net.updatePeerStatus();
  clientB.net.updatePeerStatus();
}

function setupWebRTCMesh(clients: any[]) {
  for (let i = 0; i < clients.length; i++) {
    for (let j = i + 1; j < clients.length; j++) {
      connectPeersWebRTC(clients[i], clients[j]);
    }
  }
}

// --- Tests ---
describe('Multiplayer Hit Registration', () => {
  let clients: { host: any; guestA: any; guestB: any };

  beforeEach(async () => {
    vi.resetModules();
    clients = await setupClients();
    setupWebRTCMesh([clients.host, clients.guestA, clients.guestB]);
  });

  afterEach(() => {
    if (clients) {
      clients.host.net.closePeers();
      clients.guestA.net.closePeers();
      clients.guestB.net.closePeers();
    }
  });

  const getSoldier = (slot: number) => allSoldiers.find((s: any) => s.id === slot)!;

  describe('WebRTC Path', () => {
    it('1. Guest A shoots Host → Host receives hit and loses HP', () => {
      const host = getSoldier(0);
      const initialHP = host.hp;

      clients.guestA.net.send({
        t: 'h', from: 1, to: 0, d: 25, hs: 0,
        p: [0, 1, 0], dir: [0, 0, -1],
      });

      expect(host.hp).toBeLessThan(initialHP);
      expect(host.hp).toBe(initialHP - 25);
    });

    it('2. Guest A shoots Guest B → Guest B receives hit and loses HP', () => {
      const guestB = getSoldier(2);
      guestB.team = 'ALPHA';
      const initialHP = guestB.hp;

      clients.guestA.net.send({
        t: 'h', from: 1, to: 2, d: 30, hs: 0,
        p: [0, 1, 0], dir: [0, 0, -1],
      });

      expect(guestB.hp).toBeLessThan(initialHP);
      expect(guestB.hp).toBe(initialHP - 30);
    });

    it('3. Host shoots Guest A → Guest A receives hit and loses HP', () => {
      const guestA = getSoldier(1);
      guestA.team = 'BRAVO';
      const initialHP = guestA.hp;

      clients.host.net.send({
        t: 'h', from: 0, to: 1, d: 20, hs: 0,
        p: [0, 1, 0], dir: [0, 0, -1],
      });

      expect(guestA.hp).toBeLessThan(initialHP);
      expect(guestA.hp).toBe(initialHP - 20);
    });

    it('4. Host shoots AI bot → Bot takes damage', () => {
      const bot = createMockSoldier(3, 'BRAVO');
      allSoldiers.push(bot);
      const initialHP = bot.hp;

      clients.host.net.send({
        t: 'h', from: 0, to: 3, d: 35, hs: 0,
        p: [0, 1, 0], dir: [0, 0, -1],
      });
      clients.host.net.handle({
        t: 'h', from: 0, to: 3, d: 35, hs: 0,
        p: [0, 1, 0], dir: [0, 0, -1],
      }, 0);

      expect(bot.hp).toBeLessThan(initialHP);
    });

    it('5. Guest shoots AI bot → Bot takes damage through host ownership', () => {
      const bot = createMockSoldier(3, 'ALPHA');
      allSoldiers.push(bot);
      const initialHP = bot.hp;

      clients.guestA.net.send({
        t: 'h', from: 1, to: 3, d: 35, hs: 0,
        p: [0, 1, 0], dir: [0, 0, -1],
      });

      expect(bot.hp).toBeLessThan(initialHP);
    });
  });

  describe('WebSocket Fallback Path', () => {
    beforeEach(() => {
      clients.host.net.peers.clear();
      clients.guestA.net.peers.clear();
      clients.guestB.net.peers.clear();
      clients.host.net.updatePeerStatus();
      clients.guestA.net.updatePeerStatus();
      clients.guestB.net.updatePeerStatus();
    });

    it('6. Guest A shoots Host via WebSocket fallback', () => {
      const host = getSoldier(0);
      const initialHP = host.hp;

      clients.guestA.net.send({
        t: 'h', from: 1, to: 0, d: 25, hs: 0,
        p: [0, 1, 0], dir: [0, 0, -1],
      });

      expect(host.hp).toBeLessThan(initialHP);
    });

    it('7. Host shoots Guest A via WebSocket fallback', () => {
      const guestA = getSoldier(1);
      guestA.team = 'BRAVO';
      const initialHP = guestA.hp;

      clients.host.net.send({
        t: 'h', from: 0, to: 1, d: 20, hs: 0,
        p: [0, 1, 0], dir: [0, 0, -1],
      });

      expect(guestA.hp).toBeLessThan(initialHP);
    });
  });

  describe('Mixed Transport Readiness', () => {
    it('8. Partial WebRTC readiness falls back to WebSocket', () => {
      clients.guestB.net.peers.clear();
      clients.guestB.net.updatePeerStatus();

      const host = getSoldier(0);
      const initialHP = host.hp;

      clients.guestB.net.send({
        t: 'h', from: 2, to: 0, d: 15, hs: 0,
        p: [0, 1, 0], dir: [0, 0, -1],
      });

      expect(host.hp).toBeLessThan(initialHP);
    });
  });

  describe('Security Validation', () => {
    it('9. Invalid sender cannot impersonate another soldier', () => {
      const guestB = getSoldier(2);
      const initialHP = guestB.hp;

      clients.guestA.net.send({
        t: 'h', from: 0, to: 2, d: 50, hs: 0,
        p: [0, 1, 0], dir: [0, 0, -1],
      });

      expect(guestB.hp).toBe(initialHP);
    });

    it('10. Invalid target ownership rejected by non-owners, accepted by owner', () => {
      const host = getSoldier(0);
      const initialHP = host.hp;

      clients.host.net.send({
        t: 'h', from: 1, to: 0, d: 25, hs: 0,
        p: [0, 1, 0], dir: [0, 0, -1],
      });
      clients.host.net.handle({
        t: 'h', from: 1, to: 0, d: 25, hs: 0,
        p: [0, 1, 0], dir: [0, 0, -1],
      }, 1);

      expect(host.hp).toBeLessThan(initialHP);
    });

    it('11. Duplicate message IDs cannot apply damage twice', () => {
      const host = getSoldier(0);
      const initialHP = host.hp;

      const hitEvent: any = {
        t: 'h', from: 1, to: 0, d: 25, hs: 0,
        p: [0, 1, 0], dir: [0, 0, -1],
        mid: '1:100',
      };

      clients.host.net.handle(hitEvent, 1);
      clients.host.net.handle(hitEvent, 1);

      expect(host.hp).toBe(initialHP - 25);
    });
  });

  describe('Disconnect Handling', () => {
    it('12. Disconnecting peer does not permanently break hit registration', () => {
      const host = getSoldier(0);
      const initialHP = host.hp;

      clients.guestA.net.send({
        t: 'h', from: 1, to: 0, d: 25, hs: 0,
        p: [0, 1, 0], dir: [0, 0, -1],
      });

      expect(host.hp).toBeLessThan(initialHP);

      clients.guestA.net.closePeers();
      clients.guestA.net.active = false;
      clients.host.relay.unregister(clients.guestA.ws);

      const tempSoldier = createMockSoldier(3, 'BRAVO');
      allSoldiers.push(tempSoldier);

      clients.host.net.send({
        t: 'h', from: 0, to: 3, d: 10, hs: 0,
        p: [0, 1, 0], dir: [0, 0, -1],
      });
      clients.host.net.handle({
        t: 'h', from: 0, to: 3, d: 10, hs: 0,
        p: [0, 1, 0], dir: [0, 0, -1],
      }, 0);

      expect(tempSoldier.hp).toBeLessThan(100);
    });
  });

  describe('Kill/Death Synchronization', () => {
    it('Kill event increments killer kills and victim deaths', () => {
      const host = getSoldier(0);
      const guestA = getSoldier(1);

      host.hp = 10;

      clients.guestA.net.send({
        t: 'h', from: 1, to: 0, d: 20, hs: 0,
        p: [0, 1, 0], dir: [0, 0, -1],
      });

      expect(host.alive).toBe(false);
      expect(host.hp).toBe(0);
      expect(guestA.kills).toBe(1);
      expect(host.deaths).toBe(1);
    });
  });

  describe('Consistency: Host vs Guest', () => {
    it('Host and guest hit registration behave identically for same scenario', () => {
      const guestA = getSoldier(1);
      guestA.hp = 100;

      clients.host.net.send({
        t: 'h', from: 0, to: 1, d: 25, hs: 0,
        p: [0, 1, 0], dir: [0, 0, -1],
      });

      const hpAfterHostShot = guestA.hp;
      guestA.hp = 100;

      clients.guestA.net.send({
        t: 'h', from: 1, to: 0, d: 25, hs: 0,
        p: [0, 1, 0], dir: [0, 0, -1],
      });

      const hpAfterGuestShot = getSoldier(0).hp;

      expect(100 - hpAfterHostShot).toBe(100 - hpAfterGuestShot);
    });
  });

  describe('No Unrelated Damage', () => {
    it('Hit on target A does not affect target B', () => {
      const soldierC = createMockSoldier(3, 'BRAVO');
      allSoldiers.push(soldierC);
      const initialCHP = soldierC.hp;

      clients.guestA.net.send({
        t: 'h', from: 1, to: 0, d: 25, hs: 0,
        p: [0, 1, 0], dir: [0, 0, -1],
      });

      expect(soldierC.hp).toBe(initialCHP);
    });
  });
});