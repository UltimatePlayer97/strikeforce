import * as THREE from 'three';
import type {
  AiSkill,
  Collider,
  Corpse,
  DeathCamState,
  Debris,
  DestructibleProp,
  DroppedWeapon,
  Loadout,
  MapId,
  MatchState,
  Projectile,
  RadarRect,
  Ramp,
  Smoke,
  Soldier,
  Spark,
  Team,
  Tracer,
  ZoneMode,
} from '../types';
import type { CompiledMap } from '../world/def/compile';
import type { NavWorld } from '../world/nav/navWorld';

// ---------------------------------------------------------------------------
// Shared world registries (mutated in place, never reassigned)
// ---------------------------------------------------------------------------
export const mapColliders: Collider[] = [];
export const mapRamps: Ramp[] = [];
export const radarWalls: RadarRect[] = [];
export const destructibleProps: DestructibleProp[] = [];

export const activeProjectiles: Projectile[] = [];
export const activeSmokes: Smoke[] = [];
export const activeDebris: Debris[] = [];
export const activeTracers: Tracer[] = [];
export const activeSparks: Spark[] = [];
export const droppedWeapons: DroppedWeapon[] = [];
export const corpses: Corpse[] = [];

export const allSoldiers: Soldier[] = [];

export const teamGroupPlans: Record<Team, { nodeIndex: number; timer: number }> = {
  ALPHA: { nodeIndex: -1, timer: 0 },
  BRAVO: { nodeIndex: -1, timer: 0 },
};

// ---------------------------------------------------------------------------
// Input + viewmodel transient state
// ---------------------------------------------------------------------------
export const keys: Record<string, boolean> = {};
export const weaponRecoilOffset = { z: 0, pitch: 0 };

// ---------------------------------------------------------------------------
// Match / settings
// ---------------------------------------------------------------------------
export const matchState: MatchState = {
  alphaScore: 0,
  bravoScore: 0,
  targetKills: 30,
  timeRemaining: 600,
  paused: true,
  roundOver: false,
  mouseSensitivity: 1.0,
  adsSensitivity: 1.0,
  baseFieldOfView: 75,
  cameraBob: true,
  aiSkill: 'VETERAN' as AiSkill,
};

export const loadout: Loadout = { selected: 'assault', started: false };

/** 3rd-Person Killcam/Spectator State for the human player. */
export const deathCam: DeathCamState = {
  angle: 0,
  currentPos: new THREE.Vector3(),
  lookTarget: new THREE.Vector3(),
  killcamTimer: 0,
  killer: null,
};

// ---------------------------------------------------------------------------
// Scalar game state. ES module bindings can't be reassigned from other
// modules, so everything that used to be a top-level `let` lives here.
// ---------------------------------------------------------------------------
class GameState {
  /** The soldier the local human controls. Assigned during roster creation. */
  humanPlayer!: Soldier;

  currentMapId: MapId | null = null;
  /** Playable boundary used by resolveCylinderCollision. */
  arenaLimit = 48.2;
  radarHalfExtent = 52;
  zoneMode: ZoneMode = 'COMPOUND';
  /** Compiled (pure data) form of the loaded map: colliders, nav inputs, destructibles. */
  compiledMap: CompiledMap | null = null;
  /** Navigation meshes for the loaded map. Null while being (re)generated in the worker. */
  navWorld: NavWorld | null = null;

  isMouseDown = false;
  isADS = false;
  /** Click buffer for semi-auto / bolt / pump weapons. */
  pendingShotTime = 0;
  bobTimer = 0;
  screenShake = 0;

  customWeaponPrototype: THREE.Group | null = null;
  currentWeaponDisplayName = 'M4A1 CARBINE';

  destructiblePropId = 1;
  projectileIdCounter = 1;
}

export const game = new GameState();

export function getNavWorld(): NavWorld | null {
  return game.navWorld;
}
