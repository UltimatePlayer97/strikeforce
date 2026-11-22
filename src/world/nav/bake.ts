import { exportTileCache, TileCacheMeshProcess, type OffMeshConnectionParams } from '@recast-navigation/core';
import { generateTileCache } from '@recast-navigation/generators';
import type { CompiledMap } from '../def/compile';
import { NAV_PROFILES } from '../def/profiles';
import type { NavProfileId, OffMeshLink } from '../def/types';
import { buildNavGeometry } from './navGeometry';
import { NAV_BAKE_VERSION, profileToConfig } from './navConfig';

/** Poly flag: walkable. Off-mesh jump/drop links use the same flag; the traversal code distinguishes by user id. */
export const NAV_FLAG_WALK = 1;
export const NAV_AREA_GROUND = 0;

function fnv1a(parts: ArrayLike<number>, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  const f = new Float32Array(1);
  const u = new Uint32Array(f.buffer);
  for (let i = 0; i < parts.length; i++) {
    f[0] = parts[i];
    h ^= u[0];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Hash of everything that influences the baked result: geometry, links, profile and bake version. */
export function navHash(map: CompiledMap, profile: NavProfileId): string {
  const geo = buildNavGeometry(map);
  const p = NAV_PROFILES[profile];
  let h = fnv1a(geo.positions);
  h = fnv1a(Float32Array.from(geo.indices), h);
  const links = map.def.nav.offMeshLinks.flatMap((l) => [...l.from, ...l.to, l.radius, l.bidirectional ? 1 : 0]);
  h = fnv1a(links, h);
  h = fnv1a([p.radius, p.height, p.climb, p.maxSlopeDeg, NAV_BAKE_VERSION], h);
  return h.toString(16).padStart(8, '0');
}

/** Stable numeric user id for an off-mesh link (index in the map definition). */
export function linkUserId(index: number): number {
  return 1000 + index;
}

export function toOffMeshParams(links: OffMeshLink[]): OffMeshConnectionParams[] {
  return links.map((l, i) => ({
    startPosition: { x: l.from[0], y: l.from[1], z: l.from[2] },
    endPosition: { x: l.to[0], y: l.to[1], z: l.to[2] },
    radius: l.radius,
    bidirectional: l.bidirectional,
    area: NAV_AREA_GROUND,
    flags: NAV_FLAG_WALK,
    userId: linkUserId(i),
  }));
}

/** Mesh process shared by bake and runtime import so both produce identical polys, flags and links. */
export function createMeshProcess(links: OffMeshLink[]): TileCacheMeshProcess {
  const params = toOffMeshParams(links);
  return new TileCacheMeshProcess((createParams, polyAreas, polyFlags) => {
    for (let i = 0; i < createParams.polyCount(); i++) {
      polyAreas.set(i, NAV_AREA_GROUND);
      polyFlags.set(i, NAV_FLAG_WALK);
    }
    if (params.length) createParams.setOffMeshConnections(params);
  });
}

export interface BakedNav {
  mapId: string;
  profile: NavProfileId;
  hash: string;
  version: number;
  /** exportTileCache() bytes (tile layers; obstacles are re-applied at load). */
  data: Uint8Array;
  stats: { triangles: number; bytes: number; ms: number };
}

/** Requires `init()` from @recast-navigation/core to have completed. */
export function bakeNav(map: CompiledMap, profileId: NavProfileId): BakedNav {
  const profile = NAV_PROFILES[profileId];
  const t0 = performance.now();
  const geo = buildNavGeometry(map);
  const result = generateTileCache(geo.positions, geo.indices, {
    ...profileToConfig(profile),
    tileCacheMeshProcess: createMeshProcess(map.def.nav.offMeshLinks),
  });
  if (!result.success) throw new Error(`nav bake failed for ${map.def.id}/${profileId}: ${result.error}`);
  const data = exportTileCache(result.navMesh, result.tileCache);
  result.tileCache.destroy();
  result.navMesh.destroy();
  return {
    mapId: map.def.id,
    profile: profileId,
    hash: navHash(map, profileId),
    version: NAV_BAKE_VERSION,
    data,
    stats: { triangles: geo.indices.length / 3, bytes: data.length, ms: performance.now() - t0 },
  };
}

// ---- Binary container: small header + payload so baked files are self describing -------------------------------
const MAGIC = 0x4e41564d; // 'NAVM'

export function packBaked(b: BakedNav): Uint8Array {
  const hash = new TextEncoder().encode(b.hash);
  const out = new Uint8Array(4 + 4 + 1 + hash.length + b.data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, MAGIC);
  dv.setUint32(4, b.version);
  dv.setUint8(8, hash.length);
  out.set(hash, 9);
  out.set(b.data, 9 + hash.length);
  return out;
}

export function unpackBaked(bytes: Uint8Array, mapId: string, profile: NavProfileId): BakedNav {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0) !== MAGIC) throw new Error('not a baked navmesh');
  const version = dv.getUint32(4);
  const hl = dv.getUint8(8);
  const hash = new TextDecoder().decode(bytes.subarray(9, 9 + hl));
  const data = bytes.slice(9 + hl);
  return { mapId, profile, hash, version, data, stats: { triangles: 0, bytes: data.length, ms: 0 } };
}
