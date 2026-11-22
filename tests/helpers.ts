import { init } from '@recast-navigation/core';
import { compileMap, type CompiledMap } from '../src/world/def/compile';
import type { MapDefinition, Piece, Vec3 } from '../src/world/def/types';
import { bakeNav } from '../src/world/nav/bake';
import { NavWorld } from '../src/world/nav/navWorld';

export async function initRecast(): Promise<void> {
  await init();
}

/** Minimal synthetic map for feature tests (stairs, corridors, off-mesh links, ...). */
export function syntheticMap(
  id: string,
  pieces: Piece[],
  opts: { links?: MapDefinition['nav']['offMeshLinks']; spawns?: Vec3[]; profiles?: ('soldier' | 'heavy')[] } = {},
): MapDefinition {
  const sp = opts.spawns ?? [[0, 0, 0]];
  return {
    schema: 1,
    id: id as MapDefinition['id'],
    label: id,
    zoneMode: 'COMPOUND',
    arenaLimit: 30,
    radarHalf: 32,
    lightZ: 10,
    pieces: [{ kind: 'ground', material: 'ground', size: 64 }, ...pieces],
    spawns: { ALPHA: sp, BRAVO: sp },
    tactical: { waypoints: sp, safe: { ALPHA: [0], BRAVO: [0] }, flank: [0], warehouse: [0], mid: [0], camp: [0], rally: [0] },
    nav: { profiles: opts.profiles ?? ['soldier', 'heavy'], offMeshLinks: opts.links ?? [] },
  };
}

export function buildWorld(def: MapDefinition): { compiled: CompiledMap; world: NavWorld } {
  const compiled = compileMap(def);
  const baked = def.nav.profiles.map((p) => bakeNav(compiled, p));
  return { compiled, world: NavWorld.fromBaked(compiled, baked) };
}

export const pt = (x: number, y: number, z: number) => ({ x, y, z });
