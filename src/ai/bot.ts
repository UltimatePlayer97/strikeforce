import * as THREE from 'three';
import type { Soldier, Team, Role, AIState } from '../types';
import { RAGDOLL_NODE } from '../types';
import { TacticalNavGraph } from '../world/navgraph';
import { hasLineOfSight, segmentClear } from '../physics/collision';
import { VerletRagdoll } from '../physics/ragdoll';
import { createWeaponInstance, fireWeapon, startReload, updateReload, canFire } from '../weapons/weapon';
import { throwGrenade, throwSmoke } from '../weapons/projectile';
import { sfx } from '../audio/sound';

const ROLE_ENGAGEMENT_RANGE: Record<Role, number> = {
  ASSAULT: 55, SMG: 35, LMG: 70, SHOTGUN: 18, SNIPER: 130
};

const ROLE_REACTION_BASE: Record<Role, number> = {
  ASSAULT: 0.22, SMG: 0.18, LMG: 0.28, SHOTGUN: 0.25, SNIPER: 0.15
};

const ROLE_ACCURACY: Record<Role, number> = {
  ASSAULT: 0.72, SMG: 0.65, LMG: 0.68, SHOTGUN: 0.85, SNIPER: 0.92
};

const SKILL_MULTIPLIERS = {
  RECRUIT: { reaction: 1.35, accuracy: 0.85, tactical: 0.8 },
  VETERAN: { reaction: 1.0, accuracy: 1.0, tactical: 1.0 },
  ELITE: { reaction: 0.75, accuracy: 1.15, tactical: 1.2 }
};

export function createBot(
  id: number,
  team: Team,
  role: Role,
  name: string,
  spawnPos: THREE.Vector3,
  spawnYaw: number,
  skill: 'RECRUIT' | 'VETERAN' | 'ELITE' = 'VETERAN'
): Soldier {
  const mult = SKILL_MULTIPLIERS[skill];
  const stats = {
    engagementRange: ROLE_ENGAGEMENT_RANGE[role] * (0.9 + Math.random() * 0.2),
    reactionTime: ROLE_REACTION_BASE[role] * mult.reaction * (0.85 + Math.random() * 0.3),
    accuracy: Math.min(0.98, ROLE_ACCURACY[role] * mult.accuracy * (0.9 + Math.random() * 0.2)),
    tacticalAwareness: mult.tactical
  };

  return {
    id,
    team,
    role,
    name,
    isHuman: false,
    isAlive: true,
    pos: spawnPos.clone(),
    vel: new THREE.Vector3(),
    yaw: spawnYaw,
    pitch: 0,
    hp: 100,
    maxHp: 100,
    armor: 0,
    weapon: createWeaponInstance(role),
    grenades: role === 'LMG' ? 1 : 2,
    smokes: role === 'SNIPER' ? 1 : (role === 'ASSAULT' ? 2 : 1),
    state: 'SPAWNING',
    stance: 'stand',
    isSprinting: false,
    isADS: false,
    ragdoll: null,
    deathTime: 0,
    killerId: null,
    path: [],
    pathIndex: 0,
    targetNode: -1,
    lastSeenEnemy: null,
    engagementRange: stats.engagementRange,
    reactionTimer: stats.reactionTime,
    shootCooldown: 0,
    reloadTimer: 0,
    networkId: null,
    lastUpdate: performance.now(),
    kills: 0,
    deaths: 0,
    // AI-specific
    _skill: skill,
    _stats: stats,
    _spawnPos: spawnPos.clone(),
    _spawnYaw: spawnYaw,
    _lastTargetPos: new THREE.Vector3(),
    _flankTarget: null as THREE.Vector3 | null,
    _holdTimer: 0,
    _pushTimer: 0,
    _lastPathRequest: 0
  } as Soldier;
}

export function updateBot(
  bot: Soldier,
  dt: number,
  allSoldiers: Soldier[],
  humanPlayer: Soldier | null,
  navGraph: TacticalNavGraph,
  currentTime: number
): void {
  if (!bot.isAlive) return;

  updateReload(bot.weapon, currentTime);

  const enemies = allSoldiers.filter(s => s.isAlive && s.team !== bot.team);
  const aliveTeammates = allSoldiers.filter(s => s.isAlive && s.team === bot.team && s !== bot);

  const visibleEnemies = enemies.filter(e => hasLineOfSight(bot.pos, e.pos));
  const closestEnemy = visibleEnemies.reduce((closest, e) => {
    const d = bot.pos.distanceTo(e.pos);
    return d < closest.dist ? { enemy: e, dist: d } : closest;
  }, { enemy: null as Soldier | null, dist: Infinity });

  bot.shootCooldown = Math.max(0, bot.shootCooldown - dt);
  bot.reactionTimer -= dt;

  if (closestEnemy.enemy) {
    bot.lastSeenEnemy = closestEnemy.enemy.pos.clone();
    bot._lastTargetPos?.copy(closestEnemy.enemy.pos);
  }

  decideState(bot, closestEnemy.enemy, visibleEnemies.length, aliveTeammates.length, currentTime);
  executeBehavior(bot, dt, closestEnemy.enemy, allSoldiers, humanPlayer, navGraph, currentTime);
  updateMovement(bot, dt, navGraph);
  updateWeapon(bot, closestEnemy.enemy, currentTime);
}

function decideState(
  bot: Soldier,
  target: Soldier | null,
  visibleCount: number,
  teammateCount: number,
  currentTime: number
): void {
  const hpRatio = bot.hp / bot.maxHp;
  const isLowHp = hpRatio < 0.35;
  const hasTarget = target !== null;
  const distToTarget = hasTarget ? bot.pos.distanceTo(target.pos) : Infinity;
  const inRange = distToTarget <= bot.engagementRange;
  const stats = bot._stats!;
  const flankTarget = bot._flankTarget;
  let holdTimer = bot._holdTimer ?? 0;

  switch (bot.state) {
    case 'SPAWNING':
      bot.state = 'HUNTING';
      break;

    case 'HUNTING':
      if (hasTarget && inRange) {
        if (Math.random() < 0.3 * stats.tacticalAwareness) {
          bot.state = 'FLANKING';
          bot._flankTarget = findFlankPosition(bot, target!);
        } else {
          bot.state = 'PUSHING';
        }
      } else if (isLowHp) {
        bot.state = 'RETREATING';
      }
      break;

    case 'FLANKING':
      if (!hasTarget || distToTarget < 8) {
        bot.state = 'PUSHING';
      } else if (flankTarget && bot.pos.distanceTo(flankTarget) < 2) {
        bot.state = 'HOLDING';
        holdTimer = 3 + Math.random() * 4;
        bot._holdTimer = holdTimer;
      }
      break;

    case 'PUSHING':
      if (!hasTarget) {
        bot.state = 'HUNTING';
      } else if (distToTarget < 6 || isLowHp) {
        bot.state = 'RETREATING';
      } else if (visibleCount > 2 && teammateCount < 2) {
        bot.state = 'HOLDING';
        holdTimer = 2 + Math.random() * 3;
        bot._holdTimer = holdTimer;
      }
      break;

    case 'HOLDING':
      holdTimer -= 1/60;
      bot._holdTimer = holdTimer;
      if (!hasTarget || holdTimer <= 0) {
        bot.state = hasTarget ? 'PUSHING' : 'HUNTING';
      } else if (isLowHp) {
        bot.state = 'RETREATING';
      }
      break;

    case 'RETREATING':
      if (hpRatio > 0.6 || !hasTarget) {
        bot.state = 'HUNTING';
      } else if (distToTarget > bot.engagementRange * 1.5) {
        bot.state = 'HUNTING';
      }
      break;

    case 'RELOADING':
      if (bot.weapon.ammo >= bot.weapon.stats.mag || !bot.weapon.isReloading) {
        bot.state = hasTarget ? 'PUSHING' : 'HUNTING';
      }
      break;
  }
}

function findFlankPosition(bot: Soldier, target: Soldier): THREE.Vector3 {
  const toTarget = target.pos.clone().sub(bot.pos).normalize();
  const right = new THREE.Vector3(-toTarget.z, 0, toTarget.x);
  const flankDir = Math.random() < 0.5 ? right : right.clone().negate();
  const flankPos = target.pos.clone().addScaledVector(flankDir, 12 + Math.random() * 8);
  flankPos.y = 0;
  return flankPos;
}

function executeBehavior(
  bot: Soldier,
  dt: number,
  target: Soldier | null,
  allSoldiers: Soldier[],
  humanPlayer: Soldier | null,
  navGraph: TacticalNavGraph,
  currentTime: number
): void {
  const moveSpeed = bot.stance === 'crouch' ? 3.2 : bot.isSprinting ? 7.5 : 5.2;
  const lastPathRequest = bot._lastPathRequest ?? 0;
  const flankTarget = bot._flankTarget;

  switch (bot.state) {
    case 'HUNTING':
    case 'PUSHING':
      if (target && currentTime - lastPathRequest > 0.5) {
        bot.path = navGraph.findPathAStar(bot.pos, target.pos);
        bot.pathIndex = 0;
        bot._lastPathRequest = currentTime;
      }
      break;

    case 'FLANKING':
      if (flankTarget && currentTime - lastPathRequest > 0.5) {
        bot.path = navGraph.findPathAStar(bot.pos, flankTarget);
        bot.pathIndex = 0;
        bot._lastPathRequest = currentTime;
      }
      break;

    case 'HOLDING':
      bot.isSprinting = false;
      bot.stance = Math.random() < 0.3 ? 'crouch' : 'stand';
      if (target) {
        const dir = target.pos.clone().sub(bot.pos);
        bot.yaw = Math.atan2(-dir.x, -dir.z);
      }
      break;

    case 'RETREATING':
      if (target) {
        const away = bot.pos.clone().sub(target.pos).normalize();
        const retreatPos = bot.pos.clone().addScaledVector(away, 20);
        if (currentTime - lastPathRequest > 0.5) {
          bot.path = navGraph.findPathAStar(bot.pos, retreatPos);
          bot.pathIndex = 0;
          bot._lastPathRequest = currentTime;
        }
        bot.isSprinting = true;
      }
      break;

    case 'RELOADING':
      break;
  }

  if (bot.weapon.ammo === 0 && !bot.weapon.isReloading && bot.weapon.reserve > 0) {
    startReload(bot.weapon, currentTime);
    bot.state = 'RELOADING';
  }
}

function updateMovement(bot: Soldier, dt: number, navGraph: TacticalNavGraph): void {
  if (bot.path.length === 0) return;

  const targetPoint = bot.path[bot.pathIndex];
  if (!targetPoint) return;

  const toTarget = targetPoint.clone().sub(bot.pos);
  toTarget.y = 0;
  const dist = toTarget.length();

  if (dist < 0.8) {
    bot.pathIndex++;
    if (bot.pathIndex >= bot.path.length) {
      bot.path = [];
      return;
    }
    return;
  }

  const desiredYaw = Math.atan2(-toTarget.x, -toTarget.z);
  const yawDiff = ((desiredYaw - bot.yaw + Math.PI) % (Math.PI * 2)) - Math.PI;
  bot.yaw += THREE.MathUtils.clamp(yawDiff, -dt * 6, dt * 6);

  const forward = new THREE.Vector3(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
  const moveSpeed = bot.stance === 'crouch' ? 3.2 : bot.isSprinting ? 7.5 : 5.2;
  bot.vel.x = forward.x * moveSpeed;
  bot.vel.z = forward.z * moveSpeed;

  bot.pos.addScaledVector(bot.vel, dt);
  const floorY = getFloorHeightAt(bot.pos.x, bot.pos.z);
  bot.pos.y = floorY + (bot.stance === 'crouch' ? 0.6 : 0);
}

function getFloorHeightAt(x: number, z: number): number {
  // This will be replaced by the actual function from physics/collision
  return 0;
}

function updateWeapon(bot: Soldier, target: Soldier | null, currentTime: number): void {
  if (!target) {
    bot.isADS = false;
    return;
  }

  const dist = bot.pos.distanceTo(target.pos);
  const inRange = dist <= bot.engagementRange;
  const hasLOS = hasLineOfSight(bot.pos, target.pos);
  const stats = bot._stats!;

  if (inRange && hasLOS && bot.shootCooldown <= 0 && bot.weapon.ammo > 0) {
    bot.isADS = bot.role === 'SNIPER' || dist > 25;
    const spread = bot.isADS ? bot.weapon.stats.adsSpread : bot.weapon.stats.spread;
    const accuracySpread = spread * (1 - stats.accuracy);

    const dir = target.pos.clone().sub(bot.pos).normalize();
    dir.y += (Math.random() - 0.5) * accuracySpread * 0.02;
    dir.x += (Math.random() - 0.5) * accuracySpread * 0.02;
    dir.z += (Math.random() - 0.5) * accuracySpread * 0.02;
    dir.normalize();

    const origin = bot.pos.clone();
    origin.y += bot.stance === 'crouch' ? 1.2 : 1.5;

    if (canFire(bot.weapon, currentTime)) {
      fireWeapon(bot.weapon, bot, origin, dir, bot.isADS ? bot.weapon.stats.adsSpread : bot.weapon.stats.spread, currentTime, false);
      bot.shootCooldown = stats.reactionTime;
    }
  } else {
    bot.isADS = false;
  }

  if (bot.weapon.ammo === 0 && bot.weapon.reserve > 0 && !bot.weapon.isReloading) {
    startReload(bot.weapon, currentTime);
    bot.state = 'RELOADING';
  }

  if (target && dist < 8 && bot.grenades > 0 && Math.random() < 0.002) {
    const dir = target.pos.clone().sub(bot.pos).normalize();
    const origin = bot.pos.clone();
    origin.y += 1.5;
    throwGrenade(bot, origin, dir);
  }

  if (target && dist > 15 && dist < 40 && bot.smokes > 0 && Math.random() < 0.001) {
    const dir = target.pos.clone().sub(bot.pos).normalize();
    const origin = bot.pos.clone();
    origin.y += 1.5;
    throwSmoke(bot, origin, dir);
  }
}

export function onBotDeath(bot: Soldier, killer: Soldier, hitPos: THREE.Vector3): void {
  bot.isAlive = false;
  bot.deathTime = performance.now() / 1000;
  bot.killerId = killer.id;

  const impulseDir = bot.pos.clone().sub(hitPos).normalize();
  impulseDir.y = 0.3;
  bot.ragdoll = new VerletRagdoll(
    bot.pos.clone(),
    bot.yaw,
    bot.vel.clone(),
    hitPos,
    impulseDir.multiplyScalar(8)
  );
}

export function respawnBot(bot: Soldier, spawnPos: THREE.Vector3, spawnYaw: number): void {
  bot.isAlive = true;
  bot.hp = bot.maxHp;
  bot.pos.copy(spawnPos);
  bot.vel.set(0, 0, 0);
  bot.yaw = spawnYaw;
  bot.pitch = 0;
  bot.weapon.ammo = bot.weapon.stats.mag;
  bot.weapon.reserve = bot.weapon.stats.reserve;
  bot.weapon.isReloading = false;
  bot.grenades = bot.role === 'LMG' ? 1 : 2;
  bot.smokes = bot.role === 'SNIPER' ? 1 : (bot.role === 'ASSAULT' ? 2 : 1);
  bot.state = 'SPAWNING';
  bot.stance = 'stand';
  bot.isSprinting = false;
  bot.isADS = false;
  bot.ragdoll = null;
  bot.path = [];
  bot.pathIndex = 0;
  bot.lastSeenEnemy = null;
  bot.reactionTimer = bot._stats?.reactionTime ?? 0.22;
  bot.shootCooldown = 0;
}