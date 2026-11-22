import * as THREE from 'three';
import type { Team } from '../types';
import { MAP_DEFINITIONS } from '../world/def/maps';
import { game } from './state';

const cache = new Map<string, THREE.Vector3[]>();

/** Spawn points come from the loaded map definition (data), never from per-map code. */
export function activeSpawns(team: Team): THREE.Vector3[] {
  const id = game.currentMapId ?? 'compound';
  const key = `${id}:${team}`;
  let list = cache.get(key);
  if (!list) {
    const def = MAP_DEFINITIONS[id] ?? MAP_DEFINITIONS.compound;
    list = def.spawns[team].map((s) => new THREE.Vector3(s[0], s[1], s[2]));
    cache.set(key, list);
  }
  return list;
}
