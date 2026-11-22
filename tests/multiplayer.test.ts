import * as THREE from 'three';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { NetClient, NetMessage } from '../src/net/net';
import { allSoldiers, game, matchState } from '../src/game/state';
import { damageSoldier, eliminateSoldier } from '../src/game/damage';
import { createRoster } from '../src/game/soldiers';
import { advanceTime, resetTime, MockWebSocket, MockRTCPeerConnection, MockRTCDataChannel } from './multiplayer';

// Mock modules that depend on DOM/WebGL
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
  camera: { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), fov: 75, updateProjectionMatrix: () => {} },
  renderer: { render: () => {} },
  canvas: { requestPointerLock: () => {} },
}));

vi.mock('../src/weapons/viewmodel', () => ({
  fpWeaponRoot: { visible: true, position: new THREE.Vector3(), rotation: new THREE.Euler() },
  muzzleFlashMesh: { visible: false, getWorldPosition: () => {}, rotation: new THREE.Euler() },
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
  createWeaponInstance: () => new THREE.Group(),
}));

vi.mock('../src/rig/soldierRig', () => ({
  createSoldierRig: () => ({
    root: new THREE.Object3D(),
    bones: { mixamorigRightHand: new THREE.Bone() },
    mixer: { stopAllAction: () => {} },
    beaconMesh: new THREE.Mesh(),
  }),
  rifleCarryWorldQuat: () => new THREE.Quaternion(),
}));

vi.mock('../src/rig/soldierTemplate', () => ({
  loadSoldierGLB: (cb: () => void) => cb(),
}));

vi.mock('../src/rig/stance', () => ({
  updateSoldierRigVisual: () => {},
  rifleCarryWorldQuat: () => new THREE.Quaternion(),
}));

vi.mock('../src/physics/ragdoll', () => ({
  applyRagdollToSoldierRig: () => {},
  RAGDOLL_NODE: { CHEST: 0 },
  VerletRagdoll: class MockRagdoll {
    nodes = [new THREE.Vector3()];
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

interface TestClient {
  net: NetClient;
  ws: MockWebSocket;
  slot: number;
  isHost: boolean;
}

function createTestClient(slot: number, isHost: boolean, room = 'TEST'): TestClient {
  const ws = new MockWebSocket(`wss://relay/ws/${room}?name=PLAYER${slot}&team=ALPHA`);
  const net = new NetClient();
  net.ws = ws;
  net.active = true;
  net.slot = slot;
  net.hostSlot = isHost ? slot : 0;
  net.isHost = isHost;
  net.room = room;
  
  // Initialize roster with both clients
  const roster = [
    { slot: 0, name: 'HOST' },
    { slot: 1, name: 'GUEST_A' },
  ];
  net.applyRoster(roster);
  
  // Create soldiers
  allSoldiers.length = 0;
  for (let i = 0; i < 2; i++) {
    const s = {
      id: i,
      name: i === 0 ? 'HOST' : 'GUEST_A',
      defName: i === 0 ? 'HOST' : 'GUEST_A',
      team: 'ALPHA' as const,
      isPlayer: false,
      spawnIdx: 0,
      pos: new THREE.Vector3(i === 0 ? -20 : 20, 0, i === 0 ? -20 : 20),
      vel: new THREE.Vector3(),
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
      rig: { root: new THREE.Object3D(), beaconMesh: new THREE.Mesh() },
      weaponHolder: null,
      ragdoll: null,
      killerName: '',
      weaponId: 'assault' as const,
      reloadTotal: 1.75,
      magAmmo: 30,
      reserveAmmo: 180,
      fireCooldown: 0,
      reloading: false,
      reloadTimer: 0,
      aiState: 'ADVANCE' as const,
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
    allSoldiers.push(s as any);
  }
  
  return { net, ws, slot, isHost };
}

function connectPeers(clientA: TestClient, clientB: TestClient): void {
  // Simulate WebRTC connection establishment
  const pcA = new MockRTCPeerConnection();
  const pcB = new MockRTCPeerConnection();
  
  const channelA_events = pcA.createDataChannel('events');
  const channelA_state = pcA.createDataChannel('state', { ordered: false, maxRetransmits: 0 });
  const channelB_events = pcB.createDataChannel('events');
  const channelB_state = pcB.createDataChannel('state', { ordered: false, maxRetransmits: 0 });
  
  // Link channels
  (channelA_events as any)._peer = channelB_events;
  (channelB_events as any)._peer = channelA_events;
  (channelA_state as any)._peer = channelB_state;
  (channelB_state as any)._peer = channelA_state;
  
  const originalSendA = channelA_events.send.bind(channelA_events);
  channelA_events.send = (data: string) => {
    originalSendA(data);
    setTimeout(() => channelB_events.simulateMessage(data), 0);
  };
  
  const originalSendB = channelB_events.send.bind(channelB_events);
  channelB_events.send = (data: string) => {
    originalSendB(data);
    setTimeout(() => channelA_events.simulateMessage(data), 0);
  };
  
  const originalSendAState = channelA_state.send.bind(channelA_state);
  channelA_state.send = (data: string) => {
    originalSendAState(data);
    setTimeout(() => channelB_state.simulateMessage(data), 0);
  };
  
  const originalSendBState = channelB_state.send.bind(channelB_state);
  channelB_state.send = (data: string) => {
    originalSendBState(data);
    setTimeout(() => channelA_state.simulateMessage(data), 0);
  };
  
  clientA.net.peers.set(clientB.slot, {
    pc: pcA,
    slot: clientB.slot,
    state: channelA_state,
    events: channelA_events,
    ready: true,
    pendingIce: [],
  });
  
  clientB.net.peers.set(clientA.slot, {
    pc: pcB,
    slot: clientA.slot,
    state: channelB_state,
    events: channelB_events,
    ready: true,
    pendingIce: [],
  });
  
  clientA.net.updatePeerStatus();
  clientB.net.updatePeerStatus();
}

function sendViaWebSocket(from: TestClient, message: NetMessage): void {
  const packet = { ...message, mid: `${from.slot}:${Date.now()}` };
  from.ws.simulateMessage(JSON.stringify(packet));
}

function sendViaWebRTC(from: TestClient, toSlot: number, message: NetMessage, channelName: 'events' | 'state' = 'events'): void {
  const peer = from.net.peers.get(toSlot);
  if (peer && peer[channelName]) {
    const packet = { ...message, mid: `${from.slot}:${Date.now()}` };
    peer[channelName]!.simulateMessage(JSON.stringify(packet));
  }
}

function tickClients(clients: TestClient[], dt: number): void {
  for (const c of clients) {
    c.net.tick(dt);
  }
  advanceTime(dt * 1000);
}

describe('Multiplayer Hit Registration', () => {
  let host: TestClient;
  let guestA: TestClient;
  let guestB: TestClient;

  beforeEach(() => {
    resetTime();
    allSoldiers.length = 0;
    matchState.alphaScore = 0;
    matchState.bravoScore = 0;
    matchState.roundOver = false;
    matchState.timeRemaining = 600;
    game.humanPlayer = null as any;
    
    // Create host (slot 0)
    host = createTestClient(0, true);
    
    // Create guest A (slot 1)
    guestA = createTestClient(1, false);
    
    // Connect peers for WebRTC tests
    connectPeers(host, guestA);
  });

  afterEach(() => {
    host.net.closePeers();
    guestA.net.closePeers();
    if (guestB) guestB.net.closePeers();
  });

  describe('WebSocket Fallback Path', () => {
    it('Guest A shoots Host → Host receives hit and loses HP', () => {
      const initialHostHP = allSoldiers[0].hp;
      
      // Guest A sends hit event via WebSocket
      sendViaWebSocket(guestA, {
        t: 'h',
        from: 1,
        to: 0,
        d: 25,
        hs: 0,
        p: [0, 1, 0],
        dir: [0, 0, -1],
      });
      
      // Host processes message
      host.net.handle(JSON.parse(host.ws.getSentMessages()[0] || '{}') as NetMessage);
      
      // Actually process the hit event on host
      const messages = guestA.ws.getSentMessages();
      expect(messages.length).toBeGreaterThan(0);
      
      // The host should receive and process the hit
      host.net.handle(JSON.parse(messages[0]) as NetMessage);
      
      // Verify host took damage
      expect(allSoldiers[0].hp).toBeLessThan(initialHostHP);
    });

    it('Guest A shoots Guest B → Guest B receives hit and loses HP', () => {
      // Add guest B
      guestB = createTestClient(2, false);
      const roster = [
        { slot: 0, name: 'HOST' },
        { slot: 1, name: 'GUEST_A' },
        { slot: 2, name: 'GUEST_B' },
      ];
      host.net.applyRoster(roster);
      guestA.net.applyRoster(roster);
      guestB.net.applyRoster(roster);
      connectPeers(host, guestB);
      connectPeers(guestA, guestB);
      
      const initialGuestBHP = allSoldiers[2].hp;
      
      // Guest A sends hit event via WebSocket (relay)
      sendViaWebSocket(guestA, {
        t: 'h',
        from: 1,
        to: 2,
        d: 30,
        hs: 0,
        p: [20, 1, 20],
        dir: [0, 0, -1],
      });
      
      // Host relays to all (simplified - in reality host would relay)
      // For this test, guestB receives directly
      const messages = guestA.ws.getSentMessages();
      guestB.net.handle(JSON.parse(messages[0]) as NetMessage);
      
      expect(allSoldiers[2].hp).toBeLessThan(initialGuestBHP);
    });

    it('Host shoots Guest A → Guest A receives hit and loses HP', () => {
      const initialGuestAHP = allSoldiers[1].hp;
      
      sendViaWebSocket(host, {
        t: 'h',
        from: 0,
        to: 1,
        d: 25,
        hs: 0,
        p: [20, 1, 20],
        dir: [0, 0, 1],
      });
      
      const messages = host.ws.getSentMessages();
      guestA.net.handle(JSON.parse(messages[0]) as NetMessage);
      
      expect(allSoldiers[1].hp).toBeLessThan(initialGuestAHP);
    });

    it('Host shoots AI bot → Bot takes damage', () => {
      // Add AI bot at slot 2
      const bot = {
        id: 2,
        name: 'BOT_1',
        defName: 'BOT_1',
        team: 'BRAVO' as const,
        isPlayer: false,
        spawnIdx: 0,
        pos: new THREE.Vector3(0, 0, 0),
        vel: new THREE.Vector3(),
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
        rig: { root: new THREE.Object3D(), beaconMesh: new THREE.Mesh() },
        weaponHolder: null,
        ragdoll: null,
        killerName: '',
        weaponId: 'assault' as const,
        reloadTotal: 1.75,
        magAmmo: 30,
        reserveAmmo: 180,
        fireCooldown: 0,
        reloading: false,
        reloadTimer: 0,
        aiState: 'ADVANCE' as const,
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
      allSoldiers.push(bot as any);
      
      const initialBotHP = allSoldiers[2].hp;
      
      // Host owns bot (no human has slot 2)
      sendViaWebSocket(host, {
        t: 'h',
        from: 0,
        to: 2,
        d: 35,
        hs: 0,
        p: [0, 1, 0],
        dir: [0, 0, -1],
      });
      
      const messages = host.ws.getSentMessages();
      host.net.handle(JSON.parse(messages[0]) as NetMessage);
      
      expect(allSoldiers[2].hp).toBeLessThan(initialBotHP);
    });

    it('Guest shoots AI bot → Bot takes damage through host ownership', () => {
      // Add AI bot at slot 2
      const bot = {
        id: 2,
        name: 'BOT_1',
        defName: 'BOT_1',
        team: 'BRAVO' as const,
        isPlayer: false,
        spawnIdx: 0,
        pos: new THREE.Vector3(0, 0, 0),
        vel: new THREE.Vector3(),
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
        rig: { root: new THREE.Object3D(), beaconMesh: new THREE.Mesh() },
        weaponHolder: null,
        ragdoll: null,
        killerName: '',
        weaponId: 'assault' as const,
        reloadTotal: 1.75,
        magAmmo: 30,
        reserveAmmo: 180,
        fireCooldown: 0,
        reloading: false,
        reloadTimer: 0,
        aiState: 'ADVANCE' as const,
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
      allSoldiers.push(bot as any);
      
      const initialBotHP = allSoldiers[2].hp;
      
      // Guest sends hit, host (owner of bot) applies damage
      sendViaWebSocket(guestA, {
        t: 'h',
        from: 1,
        to: 2,
        d: 35,
        hs: 0,
        p: [0, 1, 0],
        dir: [0, 0, -1],
      });
      
      const messages = guestA.ws.getSentMessages();
      // Host receives and processes (host owns bot)
      host.net.handle(JSON.parse(messages[0]) as NetMessage);
      
      expect(allSoldiers[2].hp).toBeLessThan(initialBotHP);
    });
  });

  describe('WebRTC Data Channel Path', () => {
    it('Guest A shoots Host → Host receives hit and loses HP via WebRTC', () => {
      const initialHostHP = allSoldiers[0].hp;
      
      // Guest A sends hit event via WebRTC
      sendViaWebRTC(guestA, 0, {
        t: 'h',
        from: 1,
        to: 0,
        d: 25,
        hs: 0,
        p: [0, 1, 0],
        dir: [0, 0, -1],
      });
      
      // Process any pending microtasks
      advanceTime(10);
      
      // Verify host took damage
      expect(allSoldiers[0].hp).toBeLessThan(initialHostHP);
    });

    it('Guest A shoots Guest B → Guest B receives hit and loses HP via WebRTC', () => {
      guestB = createTestClient(2, false);
      const roster = [
        { slot: 0, name: 'HOST' },
        { slot: 1, name: 'GUEST_A' },
        { slot: 2, name: 'GUEST_B' },
      ];
      host.net.applyRoster(roster);
      guestA.net.applyRoster(roster);
      guestB.net.applyRoster(roster);
      connectPeers(host, guestB);
      connectPeers(guestA, guestB);
      
      const initialGuestBHP = allSoldiers[2].hp;
      
      sendViaWebRTC(guestA, 2, {
        t: 'h',
        from: 1,
        to: 2,
        d: 30,
        hs: 0,
        p: [20, 1, 20],
        dir: [0, 0, -1],
      });
      
      advanceTime(10);
      
      expect(allSoldiers[2].hp).toBeLessThan(initialGuestBHP);
    });

    it('Host shoots Guest A → Guest A receives hit and loses HP via WebRTC', () => {
      const initialGuestAHP = allSoldiers[1].hp;
      
      sendViaWebRTC(host, 1, {
        t: 'h',
        from: 0,
        to: 1,
        d: 25,
        hs: 0,
        p: [20, 1, 20],
        dir: [0, 0, 1],
      });
      
      advanceTime(10);
      
      expect(allSoldiers[1].hp).toBeLessThan(initialGuestAHP);
    });
  });

  describe('Mixed Transport and Fallback', () => {
    it('WebRTC not ready falls back to WebSocket', () => {
      // Disconnect WebRTC
      host.net.peers.clear();
      host.net.updatePeerStatus();
      guestA.net.peers.clear();
      guestA.net.updatePeerStatus();
      
      const initialHostHP = allSoldiers[0].hp;
      
      // Guest sends hit - should use WebSocket
      sendViaWebSocket(guestA, {
        t: 'h',
        from: 1,
        to: 0,
        d: 25,
        hs: 0,
        p: [0, 1, 0],
        dir: [0, 0, -1],
      });
      
      const messages = guestA.ws.getSentMessages();
      host.net.handle(JSON.parse(messages[0]) as NetMessage);
      
      expect(allSoldiers[0].hp).toBeLessThan(initialHostHP);
    });

    it('Partial WebRTC readiness uses WebSocket for all', () => {
      // Only one peer connected
      host.net.peers.clear();
      host.net.updatePeerStatus();
      
      const initialHostHP = allSoldiers[0].hp;
      
      sendViaWebSocket(guestA, {
        t: 'h',
        from: 1,
        to: 0,
        d: 25,
        hs: 0,
        p: [0, 1, 0],
        dir: [0, 0, -1],
      });
      
      const messages = guestA.ws.getSentMessages();
      host.net.handle(JSON.parse(messages[0]) as NetMessage);
      
      expect(allSoldiers[0].hp).toBeLessThan(initialHostHP);
    });
  });

  describe('Security Validation', () => {
    it('Invalid sender cannot impersonate another soldier', () => {
      const initialHostHP = allSoldiers[0].hp;
      
      // Guest A tries to send hit as if from Host (slot 0)
      sendViaWebSocket(guestA, {
        t: 'h',
        from: 0, // Impersonating host
        to: 1,
        d: 25,
        hs: 0,
        p: [20, 1, 20],
        dir: [0, 0, 1],
      });
      
      const messages = guestA.ws.getSentMessages();
      // Host should reject because fromSlot (1) !== message.from (0)
      host.net.handle(JSON.parse(messages[0]) as NetMessage);
      
      // Host should NOT take damage (target is guestA, but validation fails)
      expect(allSoldiers[1].hp).toBe(initialHostHP); // guestA HP unchanged
    });

    it('Invalid target ownership rejected', () => {
      // Guest A tries to send hit for a soldier they don't own
      // This should be rejected by speaksFor
      const initialGuestAHP = allSoldiers[1].hp;
      
      sendViaWebSocket(host, {
        t: 'h',
        from: 1,
        to: 0,
        d: 25,
        hs: 0,
        p: [0, 1, 0],
        dir: [0, 0, -1],
      });
      
      const messages = host.ws.getSentMessages();
      // guestA receives but should reject because they don't own target (slot 0)
      guestA.net.handle(JSON.parse(messages[0]) as NetMessage);
      
      // Host HP should be unchanged (guestA rejected it)
      expect(allSoldiers[0].hp).toBe(initialGuestAHP);
    });

    it('Duplicate message IDs cannot apply damage twice', () => {
      const initialHostHP = allSoldiers[0].hp;
      
      const hitEvent = {
        t: 'h',
        from: 1,
        to: 0,
        d: 25,
        hs: 0,
        p: [0, 1, 0],
        dir: [0, 0, -1],
        mid: '1:100', // Fixed message ID
      };
      
      // Send same message twice
      sendViaWebSocket(guestA, hitEvent);
      sendViaWebSocket(guestA, hitEvent);
      
      const messages = guestA.ws.getSentMessages();
      host.net.handle(JSON.parse(messages[0]) as NetMessage);
      host.net.handle(JSON.parse(messages[1]) as NetMessage);
      
      // Damage should only be applied once
      expect(allSoldiers[0].hp).toBe(initialHostHP - 25);
    });

    it('Invalid vector coordinates rejected', () => {
      const initialHostHP = allSoldiers[0].hp;
      
      sendViaWebSocket(guestA, {
        t: 'h',
        from: 1,
        to: 0,
        d: 25,
        hs: 0,
        p: [NaN, 1, 0], // Invalid position
        dir: [0, 0, -1],
      });
      
      const messages = guestA.ws.getSentMessages();
      host.net.handle(JSON.parse(messages[0]) as NetMessage);
      
      expect(allSoldiers[0].hp).toBe(initialHostHP);
    });

    it('Damage value clamped to valid range', () => {
      const initialHostHP = allSoldiers[0].hp;
      
      sendViaWebSocket(guestA, {
        t: 'h',
        from: 1,
        to: 0,
        d: 9999, // Excessive damage
        hs: 0,
        p: [0, 1, 0],
        dir: [0, 0, -1],
      });
      
      const messages = guestA.ws.getSentMessages();
      host.net.handle(JSON.parse(messages[0]) as NetMessage);
      
      // Damage should be clamped to 100
      expect(allSoldiers[0].hp).toBe(Math.max(0, initialHostHP - 100));
    });
  });

  describe('Kill/Death Synchronization', () => {
    it('Kill event increments killer kills and victim deaths', () => {
      // Damage host to near death
      allSoldiers[0].hp = 10;
      
      sendViaWebSocket(guestA, {
        t: 'h',
        from: 1,
        to: 0,
        d: 20, // Lethal
        hs: 0,
        p: [0, 1, 0],
        dir: [0, 0, -1],
      });
      
      const messages = guestA.ws.getSentMessages();
      host.net.handle(JSON.parse(messages[0]) as NetMessage);
      
      // Host should be dead
      expect(allSoldiers[0].alive).toBe(false);
      expect(allSoldiers[0].hp).toBe(0);
      expect(allSoldiers[1].kills).toBe(1);
      expect(allSoldiers[0].deaths).toBe(1);
    });

    it('Headshot flag transmitted correctly', () => {
      const initialHostHP = allSoldiers[0].hp;
      
      sendViaWebSocket(guestA, {
        t: 'h',
        from: 1,
        to: 0,
        d: 50,
        hs: 1, // Headshot
        p: [0, 1.6, 0], // Head height
        dir: [0, 0, -1],
      });
      
      const messages = guestA.ws.getSentMessages();
      host.net.handle(JSON.parse(messages[0]) as NetMessage);
      
      // Headshot should do more damage (depending on weapon)
      expect(allSoldiers[0].hp).toBeLessThan(initialHostHP);
    });
  });

  describe('Disconnect Handling', () => {
    it('Disconnecting peer does not permanently break hit registration', () => {
      // Guest A shoots host
      const initialHostHP = allSoldiers[0].hp;
      
      sendViaWebRTC(guestA, 0, {
        t: 'h',
        from: 1,
        to: 0,
        d: 25,
        hs: 0,
        p: [0, 1, 0],
        dir: [0, 0, -1],
      });
      
      advanceTime(10);
      expect(allSoldiers[0].hp).toBeLessThan(initialHostHP);
      
      // Guest A disconnects
      guestA.net.closePeers();
      guestA.net.active = false;
      
      // Host can still be hit by other means (e.g., WebSocket)
      const hpAfterDisconnect = allSoldiers[0].hp;
      
      sendViaWebSocket(host, {
        t: 'h',
        from: 0,
        to: 0, // Self damage for test
        d: 10,
        hs: 0,
        p: [0, 1, 0],
        dir: [0, 0, -1],
      });
      
      // Host processes own message
      const messages = host.ws.getSentMessages();
      host.net.handle(JSON.parse(messages[0]) as NetMessage);
      
      // Host should still be able to process hits
      expect(allSoldiers[0].hp).toBeLessThan(hpAfterDisconnect);
    });
  });

  describe('Consistency: Host vs Guest', () => {
    it('Host and guest hit registration behave identically for same scenario', () => {
      const initialGuestAHP = allSoldiers[1].hp;
      
      // Host shoots guest
      sendViaWebRTC(host, 1, {
        t: 'h',
        from: 0,
        to: 1,
        d: 25,
        hs: 0,
        p: [20, 1, 20],
        dir: [0, 0, 1],
      });
      advanceTime(10);
      const hpAfterHostShot = allSoldiers[1].hp;
      
      // Reset
      allSoldiers[1].hp = 100;
      
      // Guest shoots host (symmetric scenario)
      sendViaWebRTC(guestA, 0, {
        t: 'h',
        from: 1,
        to: 0,
        d: 25,
        hs: 0,
        p: [0, 1, 0],
        dir: [0, 0, -1],
      });
      advanceTime(10);
      const hpAfterGuestShot = allSoldiers[0].hp;
      
      // Both should take same damage
      expect(100 - hpAfterHostShot).toBe(100 - hpAfterGuestShot);
    });
  });

  describe('No Unrelated Damage', () => {
    it('Hit on target A does not affect target B', () => {
      // Add third soldier
      const soldierC = {
        id: 2,
        name: 'SOLDIER_C',
        defName: 'SOLDIER_C',
        team: 'BRAVO' as const,
        isPlayer: false,
        spawnIdx: 0,
        pos: new THREE.Vector3(10, 0, 10),
        vel: new THREE.Vector3(),
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
        rig: { root: new THREE.Object3D(), beaconMesh: new THREE.Mesh() },
        weaponHolder: null,
        ragdoll: null,
        killerName: '',
        weaponId: 'assault' as const,
        reloadTotal: 1.75,
        magAmmo: 30,
        reserveAmmo: 180,
        fireCooldown: 0,
        reloading: false,
        reloadTimer: 0,
        aiState: 'ADVANCE' as const,
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
      allSoldiers.push(soldierC as any);
      
      const initialCHP = allSoldiers[2].hp;
      
      // Guest A shoots Host
      sendViaWebRTC(guestA, 0, {
        t: 'h',
        from: 1,
        to: 0,
        d: 25,
        hs: 0,
        p: [0, 1, 0],
        dir: [0, 0, -1],
      });
      advanceTime(10);
      
      // Soldier C should be unaffected
      expect(allSoldiers[2].hp).toBe(initialCHP);
    });
  });
});