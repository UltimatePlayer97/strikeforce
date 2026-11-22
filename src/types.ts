import type * as THREE from 'three';
import type { VerletRagdoll } from './physics/ragdoll';

export type Team = 'ALPHA' | 'BRAVO';
export type MapId = 'compound' | 'shipment' | 'shoothouse' | 'blasttown' | 'downtown';
export type ZoneMode = 'COMPOUND' | 'SHIPMENT' | 'SHOOT_HOUSE' | 'BLAST_TOWN' | 'DOWNTOWN';
export type WeaponId = 'assault' | 'smg' | 'sniper' | 'shotgun' | 'lmg';
export type ThrowableType = 'grenade' | 'smoke';
export type AiSkill = 'RECRUIT' | 'VETERAN' | 'ELITE';
export type AiState = 'ADVANCE' | 'ENGAGE' | 'SEEK_COVER' | 'FLANK';
export type AiRole = 'ADVANCE' | 'SPLIT' | 'GROUP' | 'CAMP';
export type Vec3Tuple = [number, number, number];

// ---------------------------------------------------------------------------
// World / collision
// ---------------------------------------------------------------------------
export interface RadarRect {
  x: number;
  z: number;
  w: number;
  d: number;
  isPlatform?: boolean;
  isRamp?: boolean;
  destroyed?: boolean;
}

export interface Collider {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  isPlatform: boolean;
  radar?: RadarRect;
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

export interface BoxOptions {
  isPlatform?: boolean;
  hideOnRadar?: boolean;
  destructible?: boolean;
  hp?: number;
}

export interface DestructibleProp {
  id: number;
  mesh: THREE.Mesh;
  collider: Collider;
  radar: RadarRect | null;
  hp: number;
  maxHp: number;
  destroyed: boolean;
}

export interface RayHit {
  hit: boolean;
  distance: number;
  collider: Collider | null;
}

// ---------------------------------------------------------------------------
// Rigs
// ---------------------------------------------------------------------------
export type BoneMap = Record<string, THREE.Bone>;

export interface BoneRestInfo {
  restDirInParent: THREE.Vector3;
  restQuat: THREE.Quaternion;
}

export interface RigRestData {
  bones: Record<string, BoneRestInfo>;
  hipsCorrectionQuat: THREE.Quaternion | null;
}

export interface StanceLeg {
  hip: THREE.Bone;
  knee: THREE.Bone;
  ankle: THREE.Bone;
  thigh: number;
  shin: number;
  side: 'Left' | 'Right';
  restFootWorld: THREE.Quaternion;
  standingGap?: number;
}

export interface FixedBoneEntry {
  bone: THREE.Bone;
  quat: THREE.Quaternion;
  position: THREE.Vector3;
}

export interface StanceRigData {
  legs: StanceLeg[];
  hips: THREE.Bone | null;
  forward: THREE.Vector3;
  fixedBones: FixedBoneEntry[];
}

export interface SoldierRig {
  root: THREE.Object3D;
  bones: BoneMap;
  restData: RigRestData;
  mixer: THREE.AnimationMixer;
  actions: Record<string, THREE.AnimationAction>;
  beaconMesh: THREE.Mesh;
  isGLB: boolean;
  locomotionClip: string;
  stance: StanceRigData | null;
}

// ---------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------
export interface WeaponFalloff {
  start: number;
  end: number;
  min: number;
}

export interface WeaponViewSpec {
  hip: Vec3Tuple;
  ads: Vec3Tuple;
  muzzle: Vec3Tuple;
  lhand: number;
}

export interface WeaponDef {
  id: WeaponId;
  cls: string;
  role: string;
  tag: string;
  label: string;
  mag: number;
  reserve: number;
  cooldown: number;
  auto: boolean;
  dmg: number;
  upper?: number;
  head: number;
  pellets: number;
  pelletSpread: number;
  reload: number;
  shell: boolean;
  shellTime: number;
  spreadHip: number;
  spreadMove: number;
  spreadAds: number;
  speed: number;
  adsFov: number;
  adsSens: number;
  scope: boolean;
  reticle: boolean;
  kick: number;
  chScale: number;
  falloff: WeaponFalloff | null;
  botRange: number;
  botBurst: [number, number];
  botDelay: number;
  botSigma: number;
  engage: number;
  minDist: number;
  sightMul: number;
  stats: [number, number, number, number];
  hint: string;
  view?: WeaponViewSpec;
  build?: () => THREE.Group;
}

/** Sight/muzzle metadata computed when a weapon model is imported. */
export interface ImportedWeaponView {
  sight: Vec3Tuple;
  muzzle: Vec3Tuple;
  adsDist: number;
  glassR: number;
  rearOffset: number;
}

export interface NormalizeOptions {
  length?: number;
  sight?: RegExp;
  muzzle?: RegExp;
  sightYOffset?: number;
  adsDist?: number;
}

export interface WeaponPresetSource {
  path?: string;
  obj?: string;
  mtl?: string;
  embedded?: boolean;
}

export interface WeaponPreset extends NormalizeOptions {
  label: string;
  name: string;
  sources: WeaponPresetSource[];
}

// ---------------------------------------------------------------------------
// Soldiers
// ---------------------------------------------------------------------------
export interface NetRemoteState {
  pos: THREE.Vector3;
  yaw: number;
  vx: number;
  vz: number;
  t: number;
  init: boolean;
}

export interface Soldier {
  id: number;
  name: string;
  defName: string;
  team: Team;
  isPlayer: boolean;
  spawnIdx: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  pitch: number;
  hp: number;
  maxHp: number;
  spawnProtection: number;
  alive: boolean;
  respawnTimer: number;
  kills: number;
  deaths: number;
  onGround: boolean;
  regenWait?: number;

  rig: SoldierRig;
  weaponHolder: THREE.Group | null;
  ragdoll: VerletRagdoll | null;
  killerName: string;

  weaponId: WeaponId;
  reloadTotal: number;
  magAmmo: number;
  reserveAmmo: number;
  fireCooldown: number;
  reloading: boolean;
  reloadTimer: number;

  aiState: AiState;
  aiRole: AiRole | null;
  aiRoleTime: number;
  aiObjective: THREE.Vector3 | null;
  aiCampTarget: THREE.Vector3 | null;
  path: THREE.Vector3[];
  pathTimer: number;
  targetEnemy: Soldier | null;
  burstCooldown: number;
  strafeDir: number;
  strafeTimer: number;
  lastZoneName: string;

  aimTargetId: number;
  lockTime: number;
  reactTimer: number;
  burstShots: number;
  burstLen: number;
  aimHeight: number;

  crouch: number;
  stanceTarget: number;
  stanceTimer: number;
  sprinting: boolean;
  gaitPhase?: number;

  grenadeCharges: number;
  smokeCharges: number;
  grenadeCooldown: number;
  smokeCooldown: number;
  aiSmokeEscapePlanned: boolean;
  aiGrenadeTimer: number;

  footstepTimer: number;

  /** Network smoothing state for soldiers simulated on another machine. */
  _net?: NetRemoteState | null;
  /** Network alive-state mismatch debounce counter. */
  _mm?: number;
}

// ---------------------------------------------------------------------------
// Combat objects
// ---------------------------------------------------------------------------
export interface Projectile {
  id: number;
  owner: Soldier;
  type: ThrowableType;
  mesh: THREE.Object3D;
  vel: THREE.Vector3;
  fuse: number;
  alive: boolean;
  simulate: boolean;
}

/** Minimal projectile shape used when replaying remote explosions. */
export interface ProjectileLike {
  alive: boolean;
  owner: Soldier;
  type: ThrowableType;
  mesh: THREE.Object3D;
}

export interface SmokePart {
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  maxOpacity: number;
}

export interface Smoke {
  mesh: THREE.Group;
  geometry: THREE.SphereGeometry;
  parts: SmokePart[];
  radius: number;
  maxRadius: number;
  age: number;
  life: number;
}

export interface Debris {
  mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
}

export interface Tracer {
  mesh: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  endPos: THREE.Vector3;
  dir: THREE.Vector3;
  speed: number;
  life: number;
}

export interface Spark {
  mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  vel: THREE.Vector3;
  life: number;
}

export interface DroppedWeapon {
  mesh: THREE.Object3D;
  vel: THREE.Vector3;
  angVel: THREE.Vector3;
  life: number;
}

export interface Corpse {
  rig: SoldierRig;
  ragdoll: VerletRagdoll;
  age: number;
}

export interface ShotTrace {
  mapHit: RayHit;
  bestDist: number;
  hitTarget: Soldier | null;
  hitPoint: THREE.Vector3;
  isHeadshot: boolean;
  bodyPart: 'upper' | 'lower' | null;
}

// ---------------------------------------------------------------------------
// Match / settings
// ---------------------------------------------------------------------------
export interface MatchState {
  alphaScore: number;
  bravoScore: number;
  targetKills: number;
  timeRemaining: number;
  paused: boolean;
  roundOver: boolean;
  mouseSensitivity: number;
  adsSensitivity: number;
  baseFieldOfView: number;
  cameraBob: boolean;
  aiSkill: AiSkill;
}

export interface Loadout {
  selected: WeaponId;
  started: boolean;
}

export interface DeathCamState {
  angle: number;
  currentPos: THREE.Vector3;
  lookTarget: THREE.Vector3;
  killcamTimer: number;
  killer: Soldier | null;
}
