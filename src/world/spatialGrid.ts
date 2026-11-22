import type { Collider } from '../types';

/**
 * Uniform XZ grid for static + removable colliders. Replaces linear scans in movement, ballistics, LOS and ragdoll.
 * Colliders are inserted in every cell their XZ footprint touches; queries dedupe with a per-query stamp.
 */
export class SpatialGrid {
  private readonly cells = new Map<number, Collider[]>();
  private readonly stamps = new Map<Collider, number>();
  private stamp = 1;

  constructor(readonly cellSize = 6) {}

  private key(cx: number, cz: number): number {
    return (cx + 4096) * 8192 + (cz + 4096);
  }

  private cellRange(minX: number, maxX: number, minZ: number, maxZ: number): [number, number, number, number] {
    const s = this.cellSize;
    return [Math.floor(minX / s), Math.floor(maxX / s), Math.floor(minZ / s), Math.floor(maxZ / s)];
  }

  get size(): number {
    return this.stamps.size;
  }

  insert(c: Collider): void {
    const [x0, x1, z0, z1] = this.cellRange(c.minX, c.maxX, c.minZ, c.maxZ);
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const k = this.key(x, z);
        let list = this.cells.get(k);
        if (!list) this.cells.set(k, (list = []));
        list.push(c);
      }
    }
    this.stamps.set(c, 0);
  }

  remove(c: Collider): void {
    if (!this.stamps.delete(c)) return;
    const [x0, x1, z0, z1] = this.cellRange(c.minX, c.maxX, c.minZ, c.maxZ);
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const k = this.key(x, z);
        const list = this.cells.get(k);
        if (!list) continue;
        const i = list.indexOf(c);
        if (i >= 0) list.splice(i, 1);
        if (list.length === 0) this.cells.delete(k);
      }
    }
  }

  clear(): void {
    this.cells.clear();
    this.stamps.clear();
  }

  /** Colliders whose XZ footprint touches the AABB (unique, unordered). Fills and returns `out`. */
  queryAABB(minX: number, maxX: number, minZ: number, maxZ: number, out: Collider[]): Collider[] {
    out.length = 0;
    const st = ++this.stamp;
    const [x0, x1, z0, z1] = this.cellRange(minX, maxX, minZ, maxZ);
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const list = this.cells.get(this.key(x, z));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const c = list[i];
          if (this.stamps.get(c) === st) continue;
          this.stamps.set(c, st);
          out.push(c);
        }
      }
    }
    return out;
  }

  /**
   * Visit candidate colliders along a ray in front-to-back cell order (2D DDA over XZ).
   * `visit` returns the current best hit distance; traversal stops once the next cell starts beyond it.
   */
  traceRay(
    ox: number,
    oz: number,
    dx: number,
    dz: number,
    maxDist: number,
    visit: (c: Collider) => number,
  ): void {
    const s = this.cellSize;
    let cx = Math.floor(ox / s);
    let cz = Math.floor(oz / s);
    const stepX = dx > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = Math.abs(dx) < 1e-9 ? Infinity : s / Math.abs(dx);
    const tDeltaZ = Math.abs(dz) < 1e-9 ? Infinity : s / Math.abs(dz);
    let tMaxX = Math.abs(dx) < 1e-9 ? Infinity : ((dx > 0 ? (cx + 1) * s - ox : ox - cx * s) || 0) / Math.abs(dx);
    let tMaxZ = Math.abs(dz) < 1e-9 ? Infinity : ((dz > 0 ? (cz + 1) * s - oz : oz - cz * s) || 0) / Math.abs(dz);
    const st = ++this.stamp;
    let best = maxDist;
    let t = 0;
    for (let guard = 0; guard < 4096 && t <= best; guard++) {
      const list = this.cells.get(this.key(cx, cz));
      if (list) {
        for (let i = 0; i < list.length; i++) {
          const c = list[i];
          if (this.stamps.get(c) === st) continue;
          this.stamps.set(c, st);
          const b = visit(c);
          if (b < best) best = b;
        }
      }
      if (tMaxX < tMaxZ) {
        t = tMaxX;
        tMaxX += tDeltaX;
        cx += stepX;
      } else {
        t = tMaxZ;
        tMaxZ += tDeltaZ;
        cz += stepZ;
      }
      if (t > best) break;
    }
  }
}
