import type { Soldier, Team, MapDef } from '../types';
import { TacticalNavGraph } from '../world/navgraph';
import * as THREE from 'three';

export interface TeamPlan {
  nodeIndex: number;
  timer: number;
  type: 'RUSH' | 'HOLD' | 'FLANK' | 'DEFEND' | 'REGROUP';
  priority: number;
}

const teamPlans: Record<Team, TeamPlan> = {
  ALPHA: { nodeIndex: -1, timer: 0, type: 'HOLD', priority: 0 },
  BRAVO: { nodeIndex: -1, timer: 0, type: 'HOLD', priority: 0 }
};

export function getTeamPlan(team: Team): TeamPlan {
  return teamPlans[team];
}

export function setTeamPlan(team: Team, plan: Partial<TeamPlan>): void {
  teamPlans[team] = { ...teamPlans[team], ...plan };
}

export function updateTeamPlans(
  alphaSoldiers: Soldier[],
  bravoSoldiers: Soldier[],
  navGraph: TacticalNavGraph,
  mapDef: MapDef,
  currentTime: number
): void {
  updateTeamPlan('ALPHA', alphaSoldiers, bravoSoldiers, navGraph, mapDef, currentTime);
  updateTeamPlan('BRAVO', bravoSoldiers, alphaSoldiers, navGraph, mapDef, currentTime);
}

function updateTeamPlan(
  team: Team,
  allies: Soldier[],
  enemies: Soldier[],
  navGraph: TacticalNavGraph,
  mapDef: MapDef,
  currentTime: number
): void {
  const plan = teamPlans[team];
  plan.timer -= 1/60;

  const aliveAllies = allies.filter(s => s.isAlive);
  const aliveEnemies = enemies.filter(s => s.isAlive);

  if (aliveAllies.length === 0) return;

  const avgPos = new THREE.Vector3();
  for (const a of aliveAllies) avgPos.add(a.pos);
  avgPos.divideScalar(aliveAllies.length);

  const lowHpCount = aliveAllies.filter(a => a.hp / a.maxHp < 0.4).length;
  const enemyCount = aliveEnemies.length;

  if (plan.timer <= 0 || plan.nodeIndex === -1) {
    const safeNodes = mapDef.safe[team];
    const flankNodes = mapDef.flank;
    const midNodes = mapDef.mid;

    let newNode: number;
    let newType: TeamPlan['type'];

    if (lowHpCount > aliveAllies.length * 0.5) {
      newType = 'DEFEND';
      newNode = safeNodes[Math.floor(Math.random() * safeNodes.length)];
    } else if (enemyCount < aliveAllies.length * 0.7) {
      newType = Math.random() < 0.6 ? 'RUSH' : 'FLANK';
      newNode = newType === 'RUSH'
        ? midNodes[Math.floor(Math.random() * midNodes.length)]
        : flankNodes[Math.floor(Math.random() * flankNodes.length)];
    } else {
      newType = 'HOLD';
      newNode = safeNodes[Math.floor(Math.random() * safeNodes.length)];
    }

    plan.nodeIndex = newNode;
    plan.type = newType;
    plan.timer = 15 + Math.random() * 20;
    plan.priority = newType === 'RUSH' ? 3 : newType === 'FLANK' ? 2 : 1;
  }

  const targetNode = navGraph.nodes[plan.nodeIndex];
  if (targetNode) {
    for (const ally of aliveAllies) {
      const stats = ally._stats;
      if (stats && stats.tacticalAwareness > 0.9) {
        const distToPlan = ally.pos.distanceTo(targetNode.pos);
        if (distToPlan > 25 && Math.random() < 0.02) {
          ally.path = navGraph.findPathAStar(ally.pos, targetNode.pos);
          ally.pathIndex = 0;
        }
      }
    }
  }
}

export function getZoneName(mapDef: MapDef, pos: THREE.Vector3): string {
  const nodeIdx = findNearestZoneNode(mapDef, pos);
  if (mapDef.camp.includes(nodeIdx)) return 'CAMP ZONE';
  if (mapDef.rally.includes(nodeIdx)) return 'RALLY POINT';
  if (mapDef.warehouse.includes(nodeIdx)) return mapDef.id === 'compound' ? 'WAREHOUSE' : 'CENTRAL';
  if (mapDef.mid.includes(nodeIdx)) return 'MID';
  if (mapDef.flank.includes(nodeIdx)) return 'FLANK';
  return 'UNKNOWN';
}

function findNearestZoneNode(mapDef: MapDef, pos: THREE.Vector3): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < mapDef.rawNodes.length; i++) {
    const node = mapDef.rawNodes[i];
    const d = Math.hypot(node[0] - pos.x, node[2] - pos.z);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}