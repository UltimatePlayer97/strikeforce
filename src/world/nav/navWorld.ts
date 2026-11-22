import {
  Crowd,
  CrowdAgent,
  importTileCache,
  NavMesh,
  NavMeshQuery,
  TileCache,
  type BoxObstacle,
  type CrowdAgentParams,
} from '@recast-navigation/core';
import type { CompiledCollider, CompiledMap } from '../def/compile';
import { NAV_PROFILES } from '../def/profiles';
import type { NavProfile, NavProfileId } from '../def/types';
import { createMeshProcess, linkUserId, type BakedNav } from './bake';
import { effectiveRadius } from './navConfig';

export interface NavPoint {
  x: number;
  y: number;
  z: number;
}

export interface NavPathResult {
  success: boolean;
  /** Path ends noticeably short of the goal (blocked / unreachable). */
  partial: boolean;
  points: NavPoint[];
}

const SNAP_HALF: NavPoint = { x: 1.5, y: 1.2, z: 1.5 };
const SNAP_HALF_WIDE: NavPoint = { x: 4, y: 2.5, z: 4 };
/** Path end further than this (xz) from the requested goal counts as partial. */
const PARTIAL_TOLERANCE = 1.25;

export function distXZ(a: NavPoint, b: NavPoint): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** One navmesh + tile cache for a single agent profile, with its own crowd. */
export class NavMeshInstance {
  readonly query: NavMeshQuery;
  private crowd: Crowd | null = null;
  private readonly dynamic = new Map<CompiledCollider, BoxObstacle>();
  private dirty = false;

  constructor(
    readonly profile: NavProfile,
    readonly navMesh: NavMesh,
    readonly tileCache: TileCache,
  ) {
    this.query = new NavMeshQuery(navMesh);
  }

  /** Snap to the closest walkable surface. Returns null if nothing is near (e.g. inside a wall). */
  snap(p: NavPoint, wide = false): NavPoint | null {
    const r = this.query.findClosestPoint(p, { halfExtents: wide ? SNAP_HALF_WIDE : SNAP_HALF });
    if (!r.success || !r.polyRef) {
      return wide ? null : this.snap(p, true);
    }
    return { x: r.point.x, y: r.point.y, z: r.point.z };
  }

  findPath(from: NavPoint, to: NavPoint): NavPathResult {
    const a = this.snap(from);
    const b = this.snap(to);
    if (!a || !b) return { success: false, partial: true, points: [] };
    const res = this.query.computePath(a, b, { halfExtents: SNAP_HALF });
    if (!res.success || res.path.length === 0) return { success: false, partial: true, points: [] };
    const points = res.path.map((v) => ({ x: v.x, y: v.y, z: v.z }));
    const last = points[points.length - 1];
    const partial = distXZ(last, b) > PARTIAL_TOLERANCE || Math.abs(last.y - b.y) > 1.5;
    return { success: !partial, partial, points };
  }

  isReachable(from: NavPoint, to: NavPoint): boolean {
    return this.findPath(from, to).success;
  }

  /** Random walkable point within radius of `center` (or null). */
  randomPointNear(center: NavPoint, radius: number): NavPoint | null {
    const c = this.snap(center);
    if (!c) return null;
    const r = this.query.findRandomPointAroundCircle(c, radius, { halfExtents: SNAP_HALF });
    return r.success ? { x: r.randomPoint.x, y: r.randomPoint.y, z: r.randomPoint.z } : null;
  }

  // ---- dynamic obstacles (destructible props) ---------------------------------------------------------------
  addBoxObstacle(c: CompiledCollider): void {
    if (this.dynamic.has(c)) return;
    const pad = effectiveRadius(this.profile);
    const lo = c.minY - this.profile.height + 0.1;
    const hi = c.maxY - 0.1;
    const res = this.tileCache.addBoxObstacle(
      { x: (c.minX + c.maxX) / 2, y: (lo + hi) / 2, z: (c.minZ + c.maxZ) / 2 },
      { x: (c.maxX - c.minX) / 2 + pad, y: (hi - lo) / 2, z: (c.maxZ - c.minZ) / 2 + pad },
      0,
    );
    if (res.success && res.obstacle) {
      this.dynamic.set(c, res.obstacle as BoxObstacle);
      this.dirty = true;
    }
  }

  removeBoxObstacle(c: CompiledCollider): boolean {
    const ob = this.dynamic.get(c);
    if (!ob) return false;
    this.tileCache.removeObstacle(ob);
    this.dynamic.delete(c);
    this.dirty = true;
    return true;
  }

  get dynamicObstacleCount(): number {
    return this.dynamic.size;
  }

  /** Applies pending obstacle changes (bounded work per call so it can run every frame). */
  flush(maxIterations = 4): boolean {
    if (!this.dirty) return true;
    let upToDate = false;
    for (let i = 0; i < maxIterations && !upToDate; i++) upToDate = this.tileCache.update(this.navMesh).upToDate;
    if (upToDate) this.dirty = false;
    return upToDate;
  }

  // ---- crowd ------------------------------------------------------------------------------------------------
  getCrowd(maxAgents = 64): Crowd {
    if (!this.crowd) this.crowd = new Crowd(this.navMesh, { maxAgents, maxAgentRadius: this.profile.radius + 0.2 });
    return this.crowd;
  }

  addAgent(p: NavPoint, overrides: Partial<CrowdAgentParams> = {}): CrowdAgent | null {
    const crowd = this.getCrowd();
    const snapped = this.snap(p) ?? p;
    const agent = crowd.addAgent(snapped, {
      radius: this.profile.radius,
      height: this.profile.height,
      maxAcceleration: 40,
      maxSpeed: 6,
      collisionQueryRange: this.profile.radius * 10,
      pathOptimizationRange: this.profile.radius * 20,
      separationWeight: 1.5,
      // anticipate turn | obstacle avoidance | separation | optimize visibility | optimize topology
      updateFlags: 1 | 2 | 4 | 8 | 16,
      obstacleAvoidanceType: 3,
      queryFilterType: 0,
      ...overrides,
    });
    return agent ? agent : null;
  }

  update(dt: number): void {
    this.flush();
    if (this.crowd && dt > 0) this.crowd.update(Math.min(dt, 0.1));
  }

  dispose(): void {
    this.crowd?.destroy();
    this.crowd = null;
    this.query.destroy();
    this.tileCache.destroy();
    this.navMesh.destroy();
    this.dynamic.clear();
  }
}

/** All navigation state for the loaded map: one instance per agent profile. */
export class NavWorld {
  private readonly instances = new Map<NavProfileId, NavMeshInstance>();
  constructor(readonly map: CompiledMap) {}

  static fromBaked(map: CompiledMap, baked: BakedNav[]): NavWorld {
    const world = new NavWorld(map);
    for (const b of baked) {
      const imported = importTileCache(b.data, createMeshProcess(map.def.nav.offMeshLinks));
      const inst = new NavMeshInstance(NAV_PROFILES[b.profile], imported.navMesh, imported.tileCache);
      world.instances.set(b.profile, inst);
      // Destructible props are not part of the baked geometry: they are removable obstacles.
      for (const d of map.destructibles) inst.addBoxObstacle(d.collider);
      let guard = 0;
      while (!inst.flush(8) && guard++ < 64);
    }
    return world;
  }

  profile(id: NavProfileId = 'soldier'): NavMeshInstance {
    const inst = this.instances.get(id);
    if (!inst) throw new Error(`nav profile ${id} not loaded for ${this.map.def.id}`);
    return inst;
  }

  hasProfile(id: NavProfileId): boolean {
    return this.instances.has(id);
  }

  get profiles(): NavProfileId[] {
    return [...this.instances.keys()];
  }

  removeObstacle(collider: CompiledCollider): void {
    for (const i of this.instances.values()) i.removeBoxObstacle(collider);
  }

  update(dt: number): void {
    for (const i of this.instances.values()) i.update(dt);
  }

  /** Off-mesh link metadata lookup from a Detour user id. */
  linkById(userId: number): { index: number; kind: 'jump' | 'drop' } | null {
    const links = this.map.def.nav.offMeshLinks;
    for (let i = 0; i < links.length; i++) if (linkUserId(i) === userId) return { index: i, kind: links[i].kind };
    return null;
  }

  dispose(): void {
    for (const i of this.instances.values()) i.dispose();
    this.instances.clear();
  }
}
