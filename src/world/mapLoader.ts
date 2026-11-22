import { alphaBaseLight, bravoBaseLight, scene } from '../core/renderer';
import { destructibleProps, game, teamGroupPlans } from '../game/state';
import type { MapId } from '../types';
import { clearCollision, installCollision } from './collisionWorld';
import { compileMap, validateMapDefinition, type CompiledMap } from './def/compile';
import { MAP_DEFINITIONS } from './def/maps';
import { loadNavigation, type NavLoadResult } from './nav/navRuntime';
import { bakeNavInWorker } from './nav/navWorkerClient';
import type { NavWorld } from './nav/navWorld';
import { buildVisual, type BuiltVisual } from './visualBuilder';

/**
 * The single entry point for loading a map. Every map goes through the same pipeline:
 *   MapDefinition (data) -> validate -> compile -> { collision | visual | navigation } -> tactical metadata
 * Nothing here is map specific.
 */

const compiledCache = new Map<MapId, CompiledMap>();
let currentVisual: BuiltVisual | null = null;
let loadToken = 0;

export function getCompiledMap(id: MapId): CompiledMap {
  let compiled = compiledCache.get(id);
  if (!compiled) {
    const def = MAP_DEFINITIONS[id];
    const errors = validateMapDefinition(def);
    if (errors.length) throw new Error(`invalid map definition "${id}":\n  ${errors.join('\n  ')}`);
    compiled = compileMap(def);
    compiledCache.set(id, compiled);
  }
  return compiled;
}

export function randomMapId(excludeId: MapId | null = null): MapId {
  const ids = Object.keys(MAP_DEFINITIONS) as MapId[];
  let id = ids[Math.floor(Math.random() * ids.length)];
  if (ids.length > 1 && id === excludeId) {
    id = ids[(ids.indexOf(id) + 1) % ids.length];
  }
  return id;
}

function resetTeamGroupPlans(): void {
  for (const team of ['ALPHA', 'BRAVO'] as const) {
    teamGroupPlans[team].nodeIndex = -1;
    teamGroupPlans[team].timer = 0;
  }
}

/** Releases render, collision and navigation resources of the current map (geometry, materials, textures, wasm). */
export function unloadMap(): void {
  loadToken++;
  game.navWorld?.dispose();
  game.navWorld = null;
  game.compiledMap = null;
  currentVisual?.dispose();
  currentVisual = null;
  clearCollision();
}

export interface LoadMapInfo {
  id: MapId;
  nav: NavLoadResult;
}
export let lastLoadInfo: LoadMapInfo | null = null;

function attachNavigation(compiled: CompiledMap, token: number): NavLoadResult {
  const nav = loadNavigation(compiled, (map, profile) => bakeNavInWorker(map.def, profile));
  if (nav.world) {
    game.navWorld = nav.world;
  } else {
    console.warn(
      `[nav] baked navigation for "${compiled.def.id}" is missing/stale (${nav.regenerated.join(', ')}); ` +
        'regenerating in a worker. Run `npm run nav:bake` to refresh baked data.',
    );
    nav.ready
      .then((world: NavWorld) => {
        if (token !== loadToken) {
          world.dispose();
          return;
        }
        game.navWorld = world;
      })
      .catch((e: unknown) => console.error('[nav] regeneration failed; bots fall back to direct steering', e));
  }
  return nav;
}

/** Accepts any string (network messages) and falls back to a random legal map. */
export function loadMap(mapId: string | null = null): MapId {
  const id: MapId = mapId !== null && mapId in MAP_DEFINITIONS ? (mapId as MapId) : randomMapId();
  unloadMap();
  const token = loadToken;
  const compiled = getCompiledMap(id);
  const def = compiled.def;

  game.currentMapId = id;
  game.compiledMap = compiled;
  game.arenaLimit = def.arenaLimit;
  game.radarHalfExtent = def.radarHalf;
  game.zoneMode = def.zoneMode;
  resetTeamGroupPlans();

  // 1. collision (separate from rendering)
  installCollision(compiled);

  // 2. visuals (separate from collision/navigation)
  const visual = buildVisual(compiled);
  scene.add(visual.group);
  currentVisual = visual;

  // 3. destructible props: render mesh + collider bound together
  for (const d of compiled.destructibles) {
    const mesh = visual.destructibleMeshes.get(d.index);
    if (!mesh) continue;
    const prop = {
      id: game.destructiblePropId++,
      mesh,
      collider: d.collider,
      radar: d.collider.radar ?? null,
      hp: d.hp,
      maxHp: d.hp,
      destroyed: false,
    };
    mesh.name = `destructible-${prop.id}`;
    mesh.userData.destructibleId = prop.id;
    destructibleProps.push(prop);
  }

  // 4. navigation (baked tile cache, or worker regeneration when stale)
  const nav = attachNavigation(compiled, token);
  lastLoadInfo = { id, nav };

  const label = document.getElementById('map-name-label');
  if (label) label.textContent = def.label;
  alphaBaseLight.position.set(0, 5.5, def.lightZ);
  bravoBaseLight.position.set(0, 5.5, -def.lightZ);
  return id;
}
