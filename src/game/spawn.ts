import * as THREE from 'three';
import type { Soldier, Team, MapDef } from '../types';
import { getMapColliders } from '../world/map';
import { getFloorHeightAt, hasLineOfSight } from '../physics/collision';

export function findSafeSpawnPosition(
  team: Team,
  mapDef: MapDef,
  avoidPlayers: Soldier[] = [],
  maxAttempts = 50
): { position: THREE.Vector3; yaw: number } {
  const safeNodes = mapDef.safe[team];
  const spawnIndices = [...safeNodes].sort(() => Math.random() - 0.5);

  for (const nodeIdx of spawnIndices) {
    const node = mapDef.rawNodes[nodeIdx];
    const pos = new THREE.Vector3(node[0], node[1] + 1.5, node[2]);
    const floorY = getFloorHeightAt(pos.x, pos.z);
    pos.y = Math.max(pos.y, floorY + 1.5);

    // Check collision
    let valid = true;
    const colliders = getMapColliders();
    for (const c of colliders) {
      if (pos.x >= c.minX - 0.5 && pos.x <= c.maxX + 0.5 &&
          pos.z >= c.minZ - 0.5 && pos.z <= c.maxZ + 0.5 &&
          pos.y + 1.7 >= c.minY && pos.y <= c.maxY) {
        valid = false;
        break;
      }
    }

    // Check distance from other players
    if (valid) {
      for (const player of avoidPlayers) {
        if (player.isAlive && player.pos.distanceTo(pos) < 4) {
          valid = false;
          break;
        }
      }
    }

    // Check line of sight to enemies
    if (valid) {
      const enemies = avoidPlayers.filter(p => p.isAlive && p.team !== team);
      let hasLOS = false;
      for (const enemy of enemies) {
        if (hasLineOfSight(pos, enemy.pos)) {
          hasLOS = true;
          break;
        }
      }
      // Prefer spawns without direct LOS to enemies
      if (!hasLOS || Math.random() < 0.3) {
        const yaw = team === 'ALPHA' ? Math.PI : 0;
        return { position: pos, yaw };
      }
    }
  }

  // Fallback
  const fallbackIdx = safeNodes[0];
  const node = mapDef.rawNodes[fallbackIdx];
  const pos = new THREE.Vector3(node[0], node[1] + 1.5, node[2]);
  const yaw = team === 'ALPHA' ? Math.PI : 0;
  return { position: pos, yaw };
}

export function findSpawnForBot(
  bot: Soldier,
  mapDef: MapDef,
  allSoldiers: Soldier[]
): { position: THREE.Vector3; yaw: number } {
  const team = bot.team;
  const avoidPlayers = allSoldiers.filter(s => s.isAlive && s !== bot);
  return findSafeSpawnPosition(team, mapDef, avoidPlayers);
}