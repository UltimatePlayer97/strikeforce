import { destructibleProps, game, mapColliders, mapRamps, radarWalls } from '../game/state';
import type { Collider } from '../types';
import type { CompiledMap } from './def/compile';
import { SpatialGrid } from './spatialGrid';

/** Single owner of the live collision data. The legacy arrays in game/state stay as flat views. */
export const colliderGrid = new SpatialGrid(6);

export function clearCollision(): void {
  mapColliders.length = 0;
  mapRamps.length = 0;
  radarWalls.length = 0;
  destructibleProps.length = 0;
  colliderGrid.clear();
  game.destructiblePropId = 1;
}

/** Fill collision registries (colliders, ramps, radar) from a compiled map. Visual + destructible props are separate. */
export function installCollision(map: CompiledMap): void {
  clearCollision();
  for (const c of map.colliders) {
    mapColliders.push(c);
    colliderGrid.insert(c);
  }
  for (const r of map.ramps) mapRamps.push(r);
  for (const r of map.radar) radarWalls.push(r);
}

export function removeCollider(c: Collider): void {
  const i = mapColliders.indexOf(c);
  if (i >= 0) mapColliders.splice(i, 1);
  colliderGrid.remove(c);
}

const _scratch: Collider[] = [];
/** Reusable-buffer AABB query: result is only valid until the next call. */
export function queryColliders(minX: number, maxX: number, minZ: number, maxZ: number): Collider[] {
  return colliderGrid.queryAABB(minX, maxX, minZ, maxZ, _scratch);
}
