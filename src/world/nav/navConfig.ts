import type { TileCacheGeneratorConfig } from '@recast-navigation/generators';
import type { NavProfile } from '../def/types';

/** Bump when generation parameters or geometry rules change: invalidates every baked navmesh. */
export const NAV_BAKE_VERSION = 3;

export const NAV_CELL_SIZE = 0.15;
export const NAV_CELL_HEIGHT = 0.05;

export function profileToConfig(p: NavProfile): Partial<TileCacheGeneratorConfig> {
  return {
    cs: NAV_CELL_SIZE,
    ch: NAV_CELL_HEIGHT,
    tileSize: 64,
    borderSize: 0,
    walkableSlopeAngle: p.maxSlopeDeg,
    walkableRadius: Math.ceil(p.radius / NAV_CELL_SIZE),
    walkableHeight: Math.ceil(p.height / NAV_CELL_HEIGHT),
    walkableClimb: Math.floor(p.climb / NAV_CELL_HEIGHT + 1e-6),
    mergeRegionArea: 20,
    maxSimplificationError: 1.3,
    maxVertsPerPoly: 6,
    detailSampleDist: 6,
    detailSampleMaxError: 1,
    expectedLayersPerTile: 4,
    maxObstacles: 512,
  };
}

/** Radius actually carved by erosion (rounded up to whole cells). Dynamic obstacles are inflated by this. */
export function effectiveRadius(p: NavProfile): number {
  return Math.ceil(p.radius / NAV_CELL_SIZE) * NAV_CELL_SIZE;
}
