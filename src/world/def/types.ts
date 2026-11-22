import type { MapId, Team, ZoneMode } from '../../types';

export type Vec3 = [number, number, number];
export type Vec2 = [number, number];

export const MATERIAL_IDS = [
  'ground',
  'wall',
  'crateBlue',
  'crateRed',
  'crateOlive',
  'brick',
  'stucco',
  'asphalt',
  'cityConcrete',
  'carBlue',
  'carRed',
  'carYellow',
  'catwalk',
] as const;
export type MaterialId = (typeof MATERIAL_IDS)[number];

/**
 * How a piece takes part in navigation mesh generation. This is deliberately separate from `collide` and `visual`:
 * - obstacle: solid, blocks agents (walls, crates). Its top is NEVER walkable.
 * - walkable: contributes a walkable top surface (ground, decks, floors).
 * - overhead: only constrains headroom (ceilings, bridges that are not walkable).
 * - ignore: not part of the navigation mesh at all.
 */
export type NavMode = 'obstacle' | 'walkable' | 'overhead' | 'ignore';

export type Side = 'N' | 'S' | 'E' | 'W';

export interface PieceBase {
  id?: string;
  material: MaterialId;
  tags?: string[];
  /** Render this piece. Default true. */
  visual?: boolean;
  /** Add collision geometry (movement + bullets). Default depends on kind. */
  collide?: boolean;
  /** Navigation contribution. Default depends on kind. */
  nav?: NavMode;
  /** Draw on radar. Default true for solid pieces. */
  radar?: boolean;
  /** Piece can be destroyed; collision and (dynamic) nav obstacle are removed with it. */
  destructible?: { hp: number };
}

/** Axis-aligned box described by its centre and full size. */
export interface BoxPiece extends PieceBase {
  kind: 'wall' | 'block' | 'container' | 'cover' | 'barrier' | 'vehicle' | 'fence' | 'floor' | 'ceiling' | 'window' | 'door';
  center: Vec3;
  size: Vec3;
}

export interface GroundPiece extends PieceBase {
  kind: 'ground';
  size: number;
}

export interface RampPiece extends PieceBase {
  kind: 'ramp';
  /** XZ centre of the ramp footprint. */
  center: Vec2;
  /** Footprint (x extent, z extent). */
  size: Vec2;
  height: number;
  baseY?: number;
  axis: 'x' | 'z';
  /** +1: rises towards +axis, -1: rises towards -axis. */
  dir: 1 | -1;
}

export interface StairsPiece extends PieceBase {
  kind: 'stairs';
  center: Vec2;
  size: Vec2;
  height: number;
  baseY?: number;
  axis: 'x' | 'z';
  dir: 1 | -1;
  /** Number of steps (rise per step must stay within agent climb height). */
  steps: number;
}

export interface Opening {
  side: Side;
  /** Offset of the opening centre along the wall from the wall centre. */
  offset: number;
  width: number;
  height: number;
  /** Window sill height (omit for doors). */
  sill?: number;
}

export interface BuildingPiece extends PieceBase {
  kind: 'building';
  /** XZ centre. */
  center: Vec2;
  /** Outer footprint (x extent, z extent). */
  size: Vec2;
  baseY?: number;
  /** Wall height. */
  height: number;
  wallThickness: number;
  doors?: Opening[];
  windows?: Opening[];
  /** Walkable interior floor slab (default true). */
  floor?: boolean;
  /** Ceiling/roof slab (default true). */
  roof?: boolean;
}

export type Piece = BoxPiece | GroundPiece | RampPiece | StairsPiece | BuildingPiece;

export type NavProfileId = 'soldier' | 'heavy';

export interface NavProfile {
  id: NavProfileId;
  radius: number;
  height: number;
  climb: number;
  maxSlopeDeg: number;
}

export interface OffMeshLink {
  id: string;
  kind: 'jump' | 'drop';
  from: Vec3;
  to: Vec3;
  radius: number;
  bidirectional: boolean;
}

export interface TacticalMeta {
  /** Tactical waypoints (positions only; pathfinding never uses them as a graph). */
  waypoints: Vec3[];
  /** Waypoint index lists consumed by AI decision code. */
  safe: Record<Team, number[]>;
  flank: number[];
  warehouse: number[];
  mid: number[];
  camp: number[];
  rally: number[];
}

export interface MapDefinition {
  schema: 1;
  id: MapId;
  label: string;
  zoneMode: ZoneMode;
  /** Playable boundary used by cylinder collision. */
  arenaLimit: number;
  radarHalf: number;
  /** z offset of base spawn lights. */
  lightZ: number;
  pieces: Piece[];
  spawns: Record<Team, Vec3[]>;
  tactical: TacticalMeta;
  nav: {
    profiles: NavProfileId[];
    offMeshLinks: OffMeshLink[];
  };
}
