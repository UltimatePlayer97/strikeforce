import { init } from '@recast-navigation/core';
import type { CompiledMap } from '../def/compile';
import { BAKED_NAV } from '../def/maps/nav/baked.generated';
import type { NavProfileId } from '../def/types';
import { bakeNav, navHash, unpackBaked, type BakedNav } from './bake';
import { NAV_BAKE_VERSION } from './navConfig';
import { NavWorld } from './navWorld';

let initPromise: Promise<void> | null = null;

/** Loads the Recast WASM module once. Must resolve before any NavWorld is created. */
export function initNavigation(): Promise<void> {
  initPromise ??= init();
  return initPromise;
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export interface BakedLookup {
  fresh: BakedNav[];
  /** Profiles with missing / stale baked data. */
  missing: NavProfileId[];
}

/** Returns baked data whose hash matches the CURRENT map geometry; everything else is reported as missing. */
export function lookupBaked(map: CompiledMap): BakedLookup {
  const fresh: BakedNav[] = [];
  const missing: NavProfileId[] = [];
  for (const profile of map.def.nav.profiles) {
    const b64 = BAKED_NAV[map.def.id]?.[profile];
    if (b64) {
      const baked = unpackBaked(fromBase64(b64), map.def.id, profile);
      if (baked.version === NAV_BAKE_VERSION && baked.hash === navHash(map, profile)) {
        fresh.push(baked);
        continue;
      }
    }
    missing.push(profile);
  }
  return { fresh, missing };
}

export type NavLoadSource = 'baked' | 'regenerated';

export interface NavLoadResult {
  /** Present immediately when every profile has fresh baked data. */
  world: NavWorld | null;
  source: NavLoadSource;
  /** Resolves when generation (worker) finished; resolves to the same world otherwise. */
  ready: Promise<NavWorld>;
  /** Profiles that had to be regenerated because baked data was missing or stale. */
  regenerated: NavProfileId[];
}

export type BakeFn = (map: CompiledMap, profile: NavProfileId) => Promise<BakedNav>;

/**
 * Preferred path: instantiate from baked data synchronously. If data is missing/stale the profiles are regenerated
 * via `bake` (a Web Worker in the browser) so the main thread never blocks, and the stale result is never used.
 */
export function loadNavigation(map: CompiledMap, bake: BakeFn): NavLoadResult {
  const { fresh, missing } = lookupBaked(map);
  if (missing.length === 0) {
    const world = NavWorld.fromBaked(map, fresh);
    return { world, source: 'baked', ready: Promise.resolve(world), regenerated: [] };
  }
  const ready = Promise.all(missing.map((p) => bake(map, p))).then((generated) =>
    NavWorld.fromBaked(map, [...fresh, ...generated]),
  );
  return { world: null, source: 'regenerated', ready, regenerated: missing };
}

/** Synchronous in-thread bake for tests / tooling. */
export const bakeInline: BakeFn = (map, profile) => Promise.resolve(bakeNav(map, profile));
