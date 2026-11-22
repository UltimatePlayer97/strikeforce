import * as THREE from 'three';
import { getPositionsAndIndices } from '@recast-navigation/three';
import type { CompiledMap, NavBox } from '../def/compile';

/**
 * Navigation geometry is built from the compiled map, NOT from visual meshes.
 * Categories:
 *  - ground / walkable slabs / ramps: upward faces -> walkable.
 *  - obstacles: closed volume whose TOP face is flipped to face down, plus a low "lid" over the footprint.
 *    The flipped top + lid make the footprint non-walkable (no headroom) and, crucially, guarantee that the
 *    top of a crate/wall never becomes a walkable island that bots could be sent to.
 *  - overhead: underside only (ceilings): provides headroom constraints without a walkable roof.
 * Destructible obstacles are excluded; they become removable tile-cache obstacles at runtime.
 */

class TriSoup {
  readonly pos: number[] = [];
  readonly idx: number[] = [];
  tri(a: number[], b: number[], c: number[]): void {
    const i = this.pos.length / 3;
    this.pos.push(...a, ...b, ...c);
    this.idx.push(i, i + 1, i + 2);
  }
  quad(a: number[], b: number[], c: number[], d: number[]): void {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }
  /** Four vertical side faces (steep -> never walkable). */
  sides(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]);
    this.quad([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]);
    this.quad([x1, y0, z1], [x0, y0, z1], [x0, y1, z1], [x1, y1, z1]);
    this.quad([x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1]);
  }
  /** Face pointing up (walkable). */
  up(x0: number, x1: number, y: number, z0: number, z1: number): void {
    this.quad([x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0]);
  }
  /** Face pointing down (solid underside / unwalkable). */
  down(x0: number, x1: number, y: number, z0: number, z1: number): void {
    this.quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]);
  }
  toMesh(name: string): THREE.Mesh {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setIndex(this.idx);
    const m = new THREE.Mesh(g);
    m.name = name;
    return m;
  }
}

/** Height above a box base at which the footprint lid sits when the box stands on a surface. */
const LID_OFFSET = 0.06;
const GROUNDED_MAX_Y = 0.5;

function addObstacle(soup: TriSoup, b: NavBox): void {
  const [x0, y0, z0] = b.min;
  const [x1, y1, z1] = b.max;
  soup.sides(x0, y0, z0, x1, y1, z1);
  soup.down(x0, x1, y1, z0, z1); // flipped top
  soup.down(x0, x1, y0 < GROUNDED_MAX_Y ? y0 + LID_OFFSET : y0, z0, z1); // lid / underside
}

export function buildNavMeshes(map: CompiledMap): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];

  const walk = new TriSoup();
  for (const g of map.nav.ground) walk.up(-g.half, g.half, 0, -g.half, g.half);
  for (const s of map.nav.slabs) {
    walk.up(s.min[0], s.max[0], s.max[1], s.min[2], s.max[2]);
    walk.down(s.min[0], s.max[0], s.min[1], s.min[2], s.max[2]);
    walk.sides(s.min[0], s.min[1], s.min[2], s.max[0], s.max[1], s.max[2]);
  }
  for (const r of map.nav.ramps) walk.quad(r.corners[0], r.corners[1], r.corners[2], r.corners[3]);
  meshes.push(walk.toMesh('nav-walkable'));

  const obs = new TriSoup();
  for (const b of map.nav.obstacles) if (!b.dynamic) addObstacle(obs, b);
  meshes.push(obs.toMesh('nav-obstacles'));

  const over = new TriSoup();
  for (const b of map.nav.overhead) {
    over.down(b.min[0], b.max[0], b.min[1], b.min[2], b.max[2]);
    over.sides(b.min[0], b.min[1], b.min[2], b.max[0], b.max[1], b.max[2]);
  }
  meshes.push(over.toMesh('nav-overhead'));
  return meshes;
}

export interface NavGeometry {
  positions: Float32Array;
  indices: Uint32Array;
}

export function buildNavGeometry(map: CompiledMap): NavGeometry {
  const meshes = buildNavMeshes(map).filter((m) => (m.geometry.getIndex()?.count ?? 0) > 0);
  const [positions, indices] = getPositionsAndIndices(meshes);
  for (const m of meshes) m.geometry.dispose();
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) };
}
