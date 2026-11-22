import type { Collider, Ramp, RadarRect } from '../../types';
import type {
  BoxPiece,
  BuildingPiece,
  MapDefinition,
  MaterialId,
  NavMode,
  Opening,
  Piece,
  RampPiece,
  StairsPiece,
  Vec3,
} from './types';

/**
 * Pure (no THREE, no DOM) compilation of a MapDefinition into three SEPARATE products:
 *  - visual parts   (what is rendered)
 *  - collision      (what blocks movement / bullets / LOS)
 *  - navigation     (what feeds the navmesh generator)
 * Because it is pure it runs identically in the browser, a worker, the bake script and tests.
 */

export interface VisualPart {
  /** Box centre + size. */
  center: Vec3;
  size: Vec3;
  /** Euler rotation (x,y,z) applied to the box (ramps). */
  rot?: Vec3;
  material: MaterialId;
  castShadow: boolean;
  receiveShadow: boolean;
  /** Eligible for instancing when >=2 parts share size+material. */
  instanceable: boolean;
  pieceId: string;
  /** Set for destructible pieces: they keep their own mesh. */
  destructibleIndex?: number;
}

export interface CompiledCollider extends Collider {
  pieceId: string;
}

export interface CompiledDestructible {
  index: number;
  hp: number;
  collider: CompiledCollider;
  visual: VisualPart;
}

export interface NavBox {
  min: Vec3;
  max: Vec3;
  pieceId: string;
  /** Destructible pieces are NOT baked: they are added as removable tile-cache obstacles. */
  dynamic: boolean;
}

export interface NavSlab {
  /** Walkable box: top face walkable. */
  min: Vec3;
  max: Vec3;
  pieceId: string;
}

export interface NavRampSurface {
  /** Four corners of a sloped quad, CCW seen from above. */
  corners: [Vec3, Vec3, Vec3, Vec3];
  pieceId: string;
}

export interface CompiledMap {
  def: MapDefinition;
  visual: VisualPart[];
  colliders: CompiledCollider[];
  ramps: Ramp[];
  radar: RadarRect[];
  destructibles: CompiledDestructible[];
  nav: {
    /** Flat walkable ground quads (centre extents). */
    ground: { half: number }[];
    slabs: NavSlab[];
    ramps: NavRampSurface[];
    /** Stepped stair tops as boxes: each is a walkable slab. */
    obstacles: NavBox[];
    overhead: NavBox[];
  };
}

const EPS = 1e-6;

interface KindDefaults {
  collide: boolean;
  nav: NavMode;
  radar: boolean;
  visual: boolean;
  shadow: boolean;
  instanceable: boolean;
}

const KIND_DEFAULTS: Record<string, KindDefaults> = {
  wall: { collide: true, nav: 'obstacle', radar: true, visual: true, shadow: true, instanceable: false },
  block: { collide: true, nav: 'obstacle', radar: true, visual: true, shadow: true, instanceable: false },
  container: { collide: true, nav: 'obstacle', radar: true, visual: true, shadow: true, instanceable: true },
  cover: { collide: true, nav: 'obstacle', radar: true, visual: true, shadow: true, instanceable: true },
  barrier: { collide: true, nav: 'obstacle', radar: true, visual: true, shadow: true, instanceable: true },
  vehicle: { collide: true, nav: 'obstacle', radar: true, visual: true, shadow: true, instanceable: true },
  fence: { collide: true, nav: 'obstacle', radar: true, visual: true, shadow: true, instanceable: false },
  floor: { collide: true, nav: 'walkable', radar: true, visual: true, shadow: true, instanceable: false },
  ceiling: { collide: true, nav: 'overhead', radar: false, visual: true, shadow: true, instanceable: false },
  window: { collide: false, nav: 'ignore', radar: false, visual: true, shadow: false, instanceable: false },
  door: { collide: false, nav: 'ignore', radar: false, visual: true, shadow: true, instanceable: false },
};

export function pieceId(piece: Piece, index: number): string {
  return piece.id ?? `${piece.kind}-${index}`;
}

class Compiler {
  readonly visual: VisualPart[] = [];
  readonly colliders: CompiledCollider[] = [];
  readonly ramps: Ramp[] = [];
  readonly radar: RadarRect[] = [];
  readonly destructibles: CompiledDestructible[] = [];
  readonly navGround: { half: number }[] = [];
  readonly navSlabs: NavSlab[] = [];
  readonly navRamps: NavRampSurface[] = [];
  readonly navObstacles: NavBox[] = [];
  readonly navOverhead: NavBox[] = [];

  addBox(
    piece: {
      material: MaterialId;
      visual?: boolean;
      collide?: boolean;
      nav?: NavMode;
      radar?: boolean;
      destructible?: { hp: number };
    },
    kind: string,
    id: string,
    center: Vec3,
    size: Vec3,
    platform = false,
  ): void {
    const d = KIND_DEFAULTS[kind];
    const visual = piece.visual ?? d.visual;
    const collide = piece.collide ?? d.collide;
    const nav = piece.nav ?? d.nav;
    const radar = piece.radar ?? d.radar;
    const [x, y, z] = center;
    const [w, h, dp] = size;
    const min: Vec3 = [x - w / 2, y - h / 2, z - dp / 2];
    const max: Vec3 = [x + w / 2, y + h / 2, z + dp / 2];

    let collider: CompiledCollider | null = null;
    if (collide) {
      collider = {
        minX: min[0],
        maxX: max[0],
        minY: min[1],
        maxY: max[1],
        minZ: min[2],
        maxZ: max[2],
        isPlatform: platform,
        pieceId: id,
      };
      this.colliders.push(collider);
      if (radar) {
        const entry: RadarRect = { x: min[0], z: min[2], w, d: dp, isPlatform: platform };
        collider.radar = entry;
        this.radar.push(entry);
      }
    }

    let visualPart: VisualPart | null = null;
    if (visual) {
      visualPart = {
        center: [x, y, z],
        size: [w, h, dp],
        material: piece.material,
        castShadow: d.shadow,
        receiveShadow: true,
        instanceable: d.instanceable && !piece.destructible,
        pieceId: id,
      };
      this.visual.push(visualPart);
    }

    const dynamic = Boolean(piece.destructible);
    if (nav === 'obstacle') this.navObstacles.push({ min, max, pieceId: id, dynamic });
    else if (nav === 'walkable') this.navSlabs.push({ min, max, pieceId: id });
    else if (nav === 'overhead') this.navOverhead.push({ min, max, pieceId: id, dynamic: false });

    if (piece.destructible) {
      if (!collider || !visualPart) throw new Error(`destructible piece ${id} needs visual + collision`);
      const index = this.destructibles.length;
      visualPart.destructibleIndex = index;
      this.destructibles.push({ index, hp: piece.destructible.hp, collider, visual: visualPart });
    }
  }

  addRamp(p: RampPiece, id: string): void {
    const [cx, cz] = p.center;
    const [w, d] = p.size;
    const baseY = p.baseY ?? 0;
    const length = p.axis === 'z' ? d : w;
    const angle = Math.atan2(p.height, length);
    const hyp = Math.hypot(length, p.height);
    const yStart = p.dir > 0 ? baseY : baseY + p.height;
    const yEnd = p.dir > 0 ? baseY + p.height : baseY;

    // Visual: the original rotated 0.28 thick slab.
    const rot: Vec3 =
      p.axis === 'z' ? [p.dir > 0 ? -angle : angle, 0, 0] : [0, 0, p.dir > 0 ? angle : -angle];
    const size: Vec3 = p.axis === 'z' ? [w, 0.28, hyp] : [hyp, 0.28, d];
    if (p.visual ?? true) {
      this.visual.push({
        center: [cx, baseY + p.height / 2 - 0.1, cz],
        size,
        rot,
        material: p.material,
        castShadow: true,
        receiveShadow: true,
        instanceable: false,
        pieceId: id,
      });
    }

    if (p.collide ?? true) {
      this.ramps.push({
        minX: cx - w / 2,
        maxX: cx + w / 2,
        minZ: cz - d / 2,
        maxZ: cz + d / 2,
        yStart,
        yEnd,
        axis: p.axis,
      });
      if (p.radar ?? true) this.radar.push({ x: cx - w / 2, z: cz - d / 2, w, d, isRamp: true });
    }

    // Nav: walkable sloped quad. Corners ordered so the normal points up (+y).
    const x0 = cx - w / 2;
    const x1 = cx + w / 2;
    const z0 = cz - d / 2;
    const z1 = cz + d / 2;
    const yAt = (t: number): number => yStart + (yEnd - yStart) * t;
    let corners: [Vec3, Vec3, Vec3, Vec3];
    if (p.axis === 'z') {
      // height varies with z: t=0 at z0, t=1 at z1
      corners = [
        [x0, yAt(0), z0],
        [x0, yAt(1), z1],
        [x1, yAt(1), z1],
        [x1, yAt(0), z0],
      ];
    } else {
      corners = [
        [x0, yAt(0), z0],
        [x0, yAt(0), z1],
        [x1, yAt(1), z1],
        [x1, yAt(1), z0],
      ];
    }
    if ((p.nav ?? 'walkable') === 'walkable') this.navRamps.push({ corners, pieceId: id });
  }

  addStairs(p: StairsPiece, id: string): void {
    const [cx, cz] = p.center;
    const [w, d] = p.size;
    const baseY = p.baseY ?? 0;
    const length = p.axis === 'z' ? d : w;
    const run = length / p.steps;
    const rise = p.height / p.steps;
    for (let i = 0; i < p.steps; i++) {
      // step i is the (i+1)-th from the low end
      const stepTop = baseY + rise * (i + 1);
      const along = -length / 2 + run * (i + 0.5);
      const signed = p.dir > 0 ? along : -along;
      const sx = p.axis === 'x' ? cx + signed : cx;
      const sz = p.axis === 'z' ? cz + signed : cz;
      const sizeX = p.axis === 'x' ? run : w;
      const sizeZ = p.axis === 'z' ? run : d;
      const thickness = stepTop - baseY;
      const center: Vec3 = [sx, baseY + thickness / 2, sz];
      const size: Vec3 = [sizeX, thickness, sizeZ];
      // each step: solid box (movement steps up <= rise), walkable top, not on radar individually
      this.addBox(
        { material: p.material, visual: p.visual, collide: p.collide, nav: p.nav ?? 'walkable', radar: false },
        'floor',
        `${id}#${i}`,
        center,
        size,
        true,
      );
    }
    if ((p.radar ?? true) && (p.collide ?? true)) this.radar.push({ x: cx - w / 2, z: cz - d / 2, w, d, isRamp: true });
  }

  addBuilding(p: BuildingPiece, id: string): void {
    const [cx, cz] = p.center;
    const [w, d] = p.size;
    const baseY = p.baseY ?? 0;
    const t = p.wallThickness;
    const h = p.height;
    const openings: Record<'N' | 'S' | 'E' | 'W', Opening[]> = { N: [], S: [], E: [], W: [] };
    for (const o of p.doors ?? []) openings[o.side].push({ ...o, sill: 0 });
    for (const o of p.windows ?? []) openings[o.side].push({ ...o, sill: o.sill ?? 1.0 });

    const common = { material: p.material, radar: p.radar };
    const wallRun = (
      side: 'N' | 'S' | 'E' | 'W',
      centerX: number,
      centerZ: number,
      length: number,
      alongX: boolean,
    ): void => {
      const ops = [...openings[side]].sort((a, b) => a.offset - b.offset);
      // slice the wall into solid segments between openings
      let cursor = -length / 2;
      let seg = 0;
      const emit = (from: number, to: number, y0: number, y1: number, tag: string): void => {
        if (to - from < EPS || y1 - y0 < EPS) return;
        const mid = (from + to) / 2;
        const bx = alongX ? centerX + mid : centerX;
        const bz = alongX ? centerZ : centerZ + mid;
        this.addBox(
          common,
          'wall',
          `${id}/${side}${tag}${seg++}`,
          [bx, baseY + (y0 + y1) / 2, bz],
          alongX ? [to - from, y1 - y0, t] : [t, y1 - y0, to - from],
        );
      };
      for (const o of ops) {
        const o0 = o.offset - o.width / 2;
        const o1 = o.offset + o.width / 2;
        emit(cursor, o0, 0, h, 'w');
        const sill = o.sill ?? 0;
        if (sill > 0) emit(o0, o1, 0, sill, 's'); // below window: solid
        emit(o0, o1, Math.min(o.height + sill, h), h, 'l'); // lintel
        cursor = o1;
        if (sill > 0) {
          // glass pane = visual only
          const mid = (o0 + o1) / 2;
          this.addBox(
            { material: 'catwalk', collide: false, nav: 'ignore', radar: false },
            'window',
            `${id}/${side}-glass${seg++}`,
            [alongX ? centerX + mid : centerX, baseY + sill + o.height / 2, alongX ? centerZ : centerZ + mid],
            alongX ? [o.width, o.height, t * 0.3] : [t * 0.3, o.height, o.width],
          );
        }
      }
      emit(cursor, length / 2, 0, h, 'w');
    };

    wallRun('N', cx, cz - d / 2 + t / 2, w, true);
    wallRun('S', cx, cz + d / 2 - t / 2, w, true);
    wallRun('W', cx - w / 2 + t / 2, cz, d - 2 * t, false);
    wallRun('E', cx + w / 2 - t / 2, cz, d - 2 * t, false);

    if (p.floor ?? true) {
      this.addBox(
        { material: 'asphalt' as MaterialId, radar: false },
        'floor',
        `${id}/floor`,
        [cx, baseY + 0.05, cz],
        [w - 2 * t, 0.1, d - 2 * t],
      );
    }
    if (p.roof ?? true) {
      this.addBox(common, 'ceiling', `${id}/roof`, [cx, baseY + h + 0.15, cz], [w, 0.3, d]);
    }
  }
}

export function compileMap(def: MapDefinition): CompiledMap {
  const c = new Compiler();
  def.pieces.forEach((piece, index) => {
    const id = pieceId(piece, index);
    switch (piece.kind) {
      case 'ground': {
        c.navGround.push({ half: piece.size / 2 });
        c.visual.push({
          center: [0, -0.5, 0],
          size: [piece.size, 1, piece.size],
          material: piece.material,
          castShadow: false,
          receiveShadow: true,
          instanceable: false,
          pieceId: id,
        });
        break;
      }
      case 'ramp':
        c.addRamp(piece, id);
        break;
      case 'stairs':
        c.addStairs(piece, id);
        break;
      case 'building':
        c.addBuilding(piece, id);
        break;
      default: {
        const box = piece as BoxPiece;
        const platform = box.kind === 'floor';
        c.addBox(box, box.kind, id, box.center, box.size, platform);
      }
    }
  });

  return {
    def,
    visual: c.visual,
    colliders: c.colliders,
    ramps: c.ramps,
    radar: c.radar,
    destructibles: c.destructibles,
    nav: {
      ground: c.navGround,
      slabs: c.navSlabs,
      ramps: c.navRamps,
      obstacles: c.navObstacles,
      overhead: c.navOverhead,
    },
  };
}

/** Typed + semantic validation. Returns a list of human readable problems (empty = valid). */
export function validateMapDefinition(def: MapDefinition): string[] {
  const errors: string[] = [];
  const fin = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v);
  const vec3 = (v: unknown): boolean => Array.isArray(v) && v.length === 3 && v.every(fin);
  if (def.schema !== 1) errors.push(`schema must be 1 (got ${String(def.schema)})`);
  if (!def.id) errors.push('missing id');
  if (!def.label) errors.push('missing label');
  if (!fin(def.arenaLimit) || def.arenaLimit <= 0) errors.push('arenaLimit must be > 0');
  if (!fin(def.radarHalf) || def.radarHalf <= 0) errors.push('radarHalf must be > 0');
  if (!def.pieces.some((p) => p.kind === 'ground')) errors.push('map needs at least one ground piece');
  const ids = new Set<string>();
  def.pieces.forEach((p, i) => {
    const id = pieceId(p, i);
    if (ids.has(id)) errors.push(`duplicate piece id ${id}`);
    ids.add(id);
    if ('center' in p) {
      const ok = p.kind === 'ramp' || p.kind === 'stairs' || p.kind === 'building' ? p.center.length === 2 && p.center.every(fin) : vec3(p.center);
      if (!ok) errors.push(`${id}: bad center`);
    }
    if ('size' in p && p.kind !== 'ground') {
      const arr = p.size as number[];
      if (!arr.every((v) => fin(v) && v > 0)) errors.push(`${id}: size must be positive finite`);
    }
    if (p.kind === 'stairs' && (p.steps < 2 || p.height / p.steps > 0.25)) {
      errors.push(`${id}: stair rise ${(p.height / p.steps).toFixed(2)} exceeds step-up limit 0.25`);
    }
    if (p.destructible && (p.collide === false || p.visual === false)) {
      errors.push(`${id}: destructible piece must have visual + collision`);
    }
    if (p.kind === 'building') {
      for (const o of [...(p.doors ?? []), ...(p.windows ?? [])]) {
        const len = o.side === 'N' || o.side === 'S' ? p.size[0] : p.size[1];
        if (Math.abs(o.offset) + o.width / 2 > len / 2 - p.wallThickness) errors.push(`${id}: opening exceeds wall`);
        if (o.height + (o.sill ?? 0) > p.height) errors.push(`${id}: opening taller than wall`);
      }
    }
  });
  for (const team of ['ALPHA', 'BRAVO'] as const) {
    if (!def.spawns[team]?.length) errors.push(`no ${team} spawns`);
    else def.spawns[team].forEach((s, i) => !vec3(s) && errors.push(`${team} spawn ${i} invalid`));
  }
  const wp = def.tactical.waypoints;
  if (!wp.length) errors.push('no tactical waypoints');
  wp.forEach((v, i) => !vec3(v) && errors.push(`waypoint ${i} invalid`));
  const lists: [string, number[]][] = [
    ['flank', def.tactical.flank],
    ['warehouse', def.tactical.warehouse],
    ['mid', def.tactical.mid],
    ['camp', def.tactical.camp],
    ['rally', def.tactical.rally],
    ['safe.ALPHA', def.tactical.safe.ALPHA],
    ['safe.BRAVO', def.tactical.safe.BRAVO],
  ];
  for (const [name, list] of lists) {
    if (!list.length) errors.push(`tactical.${name} empty`);
    for (const i of list) if (!Number.isInteger(i) || i < 0 || i >= wp.length) errors.push(`tactical.${name}: bad index ${i}`);
  }
  for (const link of def.nav.offMeshLinks) {
    if (!vec3(link.from) || !vec3(link.to)) errors.push(`offMeshLink ${link.id}: bad endpoints`);
  }
  if (!def.nav.profiles.includes('soldier')) errors.push('nav.profiles must include soldier');
  return errors;
}
