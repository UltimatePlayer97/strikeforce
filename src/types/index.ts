import * as THREE from 'three';

// =========================================================================
// CORE TYPES
// =========================================================================

export type Team = 'ALPHA' | 'BRAVO';
export type Role = 'ASSAULT' | 'SMG' | 'LMG' | 'SHOTGUN' | 'SNIPER';
export type AIState = 'SPAWNING' | 'HUNTING' | 'FLANKING' | 'PUSHING' | 'HOLDING' | 'RETREATING' | 'RELOADING';
export type GameState = 'MENU' | 'DEPLOYING' | 'PLAYING' | 'PAUSED' | 'ROUND_END' | 'MATCH_END';
export type MapId = 'compound' | 'shipment' | 'shoothouse' | 'blasttown' | 'downtown';

export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

// =========================================================================
// MAP & NAVIGATION
// =========================================================================

export interface AABB {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  isPlatform?: boolean;
  radar?: RadarEntry;
}

export interface RadarEntry {
  x: number;
  z: number;
  w: number;
  d: number;
  isPlatform?: boolean;
  isRamp?: boolean;
}

export interface Ramp {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  yStart: number;
  yEnd: number;
  axis: 'x' | 'z';
}

export interface MapDef {
  id: MapId;
  label: string;
  arenaLimit: number;
  radarHalf: number;
  zoneMode: string;
  lightZ: number;
  build: () => void;
  rawNodes: number[][];
  safe: { ALPHA: number[]; BRAVO: number[] };
  flank: number[];
  warehouse: number[];
  mid: number[];
  camp: number[];
  rally: number[];
}

export interface NavNode {
  id: number;
  pos: THREE.Vector3;
}

export interface NavEdge {
  to: number;
  cost: number;
}

// =========================================================================
// WEAPONS & COMBAT
// =========================================================================

export interface WeaponStats {
  name: string;
  kind: Role;
  damage: number;
  headshotMult: number;
  rpm: number;
  spread: number;
  adsSpread: number;
  recoil: number;
  adsRecoil: number;
  mag: number;
  reserve: number;
  reloadMs: number;
  range: number;
  drop: number;
  penetration: number;
  adsZoom: number;
  adsTime: number;
  modelOffset?: { x: number; y: number; z: number };
}

export interface HitResult {
  hit: boolean;
  distance: number;
  headshot: boolean;
  target: Soldier | null;
  position: THREE.Vector3;
}

export interface ThrowableState {
  type: 'grenade' | 'smoke';
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  owner: Soldier;
  timer: number;
  id: number;
}

export interface SmokeCloud {
  mesh: THREE.Mesh;
  position: THREE.Vector3;
  radius: number;
  startTime: number;
  life: number;
}

export interface DebrisPiece {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  angularVel: THREE.Vector3;
}

export interface InputState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  sprint: boolean;
  jump: boolean;
  crouch: boolean;
  fire: boolean;
  ads: boolean;
  reload: boolean;
  grenade: boolean;
  smoke: boolean;
  melee: boolean;
  interact: boolean;
  scoreboard: boolean;
  pause: boolean;
  mouseDeltaX: number;
  mouseDeltaY: number;
}

// =========================================================================
// SOLDIER & RAGDOLL
// =========================================================================

export interface Soldier {
  id: number;
  team: Team;
  role: Role;
  name: string;
  isHuman: boolean;
  isAlive: boolean;

  // Position & movement
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  pitch: number;

  // Health & combat
  hp: number;
  maxHp: number;
  armor: number;

  // Weapon
  weapon: WeaponInstance;
  grenades: number;
  smokes: number;

  // State
  state: AIState;
  stance: 'stand' | 'crouch' | 'prone';
  isSprinting: boolean;
  isADS: boolean;

  // Ragdoll
  ragdoll: VerletRagdoll | null;
  deathTime: number;
  killerId: number | null;

  // AI
  path: THREE.Vector3[];
  pathIndex: number;
  targetNode: number;
  lastSeenEnemy: THREE.Vector3 | null;
  engagementRange: number;
  reactionTimer: number;
  shootCooldown: number;
  reloadTimer: number;

  // Network
  networkId: string | null;
  lastUpdate: number;

  // Stats
  kills: number;
  deaths: number;

  // AI internal (added dynamically)
  _skill?: 'RECRUIT' | 'VETERAN' | 'ELITE';
  _stats?: {
    engagementRange: number;
    reactionTime: number;
    accuracy: number;
    tacticalAwareness: number;
  };
  _spawnPos?: THREE.Vector3;
  _spawnYaw?: number;
  _lastTargetPos?: THREE.Vector3;
  _flankTarget?: THREE.Vector3 | null;
  _holdTimer?: number;
  _pushTimer?: number;
  _lastPathRequest?: number;
  _deathProcessed?: boolean;
}

export interface WeaponInstance {
  stats: WeaponStats;
  ammo: number;
  reserve: number;
  isReloading: boolean;
  reloadEndTime: number;
  lastFireTime: number;
  fireMode: 'auto' | 'semi' | 'burst';
  burstCount: number;
  customModel: THREE.Group | null;
}

export interface VerletRagdoll {
  nodes: THREE.Vector3[];
  prevNodes: THREE.Vector3[];
  age: number;
  boneLinks: number[][];
  minLinks: number[][];
  step: (dt: number) => void;
  applyImpulse: (hitPoint: THREE.Vector3, impulseVec: THREE.Vector3) => void;
  getBonePositions: () => { head: THREE.Vector3; chest: THREE.Vector3; pelvis: THREE.Vector3; lHand: THREE.Vector3; rHand: THREE.Vector3; lFoot: THREE.Vector3; rFoot: THREE.Vector3 };
}

// =========================================================================
// NETWORKING
// =========================================================================

export interface NetworkMessage {
  type: string;
  senderId: string;
  timestamp: number;
  data: unknown;
}

export interface PlayerState {
  id: string;
  name: string;
  team: Team;
  role: Role;
  pos: Vector3Like;
  yaw: number;
  pitch: number;
  hp: number;
  isAlive: boolean;
  weapon: string;
  ammo: number;
  kills: number;
  deaths: number;
}

export interface GameSnapshot {
  timestamp: number;
  players: Map<string, PlayerState>;
  projectiles: ThrowableState[];
  smokes: SmokeCloud[];
  scores: { ALPHA: number; BRAVO: number };
  matchTime: number;
}

// =========================================================================
// UI & HUD
// =========================================================================

export interface KillfeedEntry {
  killer: string;
  victim: string;
  weapon: string;
  headshot: boolean;
  time: number;
  isLocal: boolean;
}

export interface RadarZone {
  name: string;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  team: Team | 'NEUTRAL';
}

// =========================================================================
// SETTINGS
// =========================================================================

export interface GameSettings {
  sensitivity: number;
  adsSensitivity: number;
  fov: number;
  cameraBob: boolean;
  aiSkill: 'RECRUIT' | 'VETERAN' | 'ELITE';
  masterVolume: number;
  sfxVolume: number;
}

// =========================================================================
// CONSTANTS
// =========================================================================

export const RAGDOLL_NODE = {
  PELVIS: 0, CHEST: 1, HEAD: 2,
  L_ELBOW: 3, L_HAND: 4, R_ELBOW: 5, R_HAND: 6,
  L_KNEE: 7, L_FOOT: 8, R_KNEE: 9, R_FOOT: 10
} as const;

export const ROLE_NAMES: Record<Role, string> = {
  ASSAULT: 'ASSAULT',
  SMG: 'SMG',
  LMG: 'LMG',
  SHOTGUN: 'SHOTGUN',
  SNIPER: 'SNIPER'
};

export const TEAM_COLORS: Record<Team, string> = {
  ALPHA: '#3b82f6',
  BRAVO: '#ef4444'
};