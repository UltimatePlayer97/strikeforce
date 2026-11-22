import * as THREE from 'three';
import { sfx } from '../audio/SoundFX';
import { fireWeapon, updateReload } from '../combat/hitscan';
import { lobGrenadeAtTarget, retreatSmokeEscape } from '../combat/throwables';
import { regenSoldier } from '../game/damage';
import { respawnSoldier } from '../game/match';
import { allSoldiers, game, matchState, teamGroupPlans } from '../game/state';
import { net } from '../net/net';
import { applyRagdollToSoldierRig } from '../physics/ragdoll';
import { updateSoldierRigVisual } from '../rig/stance';
import type { AiRole, AiSkill, Soldier } from '../types';
import { updateSpawnProtection } from '../ui/feedback';
import { weaponOf } from '../weapons/defs';
import { hasLineOfSight, raycastMap, resolveCylinderCollision, getFloorHeightAt } from '../world/collision';
import { MAP_DEFINITIONS } from '../world/def/maps';
import type { MapDefinition } from '../world/def/types';
import { BotNavigation } from './botNav';

interface SkillParams {
  /** 1-sigma angular error (rad) when settled & still. */
  aimSigma: number;
  /** Seconds before first shot on a new target. */
  react: number;
  /** Seconds on target until aim error reaches its floor. */
  settle: number;
  fireDelay: number;
  sightRange: number;
}

let botNav: BotNavigation | null = null;

/** One BotNavigation per loaded NavWorld; null while navigation is still being generated (direct steering fallback). */
export function getBotNavigation(): BotNavigation | null {
  const world = game.navWorld;
  if (!world) {
    botNav = null;
    return null;
  }
  if (!botNav || botNav.world !== world) botNav = new BotNavigation(world, 'soldier');
  return botNav;
}

function currentDef(): MapDefinition {
  return MAP_DEFINITIONS[game.currentMapId ?? 'compound'];
}

function waypointPosition(def: MapDefinition, index: number): THREE.Vector3 {
  const wps = def.tactical.waypoints;
  const w = wps[index] ?? wps[Math.floor(Math.random() * wps.length)];
  return new THREE.Vector3(w[0], w[1], w[2]);
}

function randomWaypoint(def: MapDefinition, indices: number[]): THREE.Vector3 {
  return waypointPosition(def, indices[Math.floor(Math.random() * indices.length)]);
}

function updateTeamGroupPlans(
  dt: number,
  def: MapDefinition = currentDef(),
): void {
  for (const team of ['ALPHA', 'BRAVO'] as const) {
    const plan = teamGroupPlans[team];
    plan.timer -= dt;
    if (plan.timer > 0 && plan.nodeIndex >= 0) continue;
    const rally = def.tactical.rally.length ? def.tactical.rally : def.tactical.mid;
    plan.nodeIndex = rally?.length ? rally[Math.floor(Math.random() * rally.length)] : 0;
    plan.timer = 17 + Math.random() * 9;
  }
}

function assignAiRole(bot: Soldier, def: MapDefinition): THREE.Vector3 {
  const t = def.tactical;
  const roll = Math.random();
  // Same per-bot weighting; role timing rotates camp/flank/group decisions.
  let role: AiRole;
  if (roll < 0.31) role = 'ADVANCE';
  else if (roll < 0.61) role = 'SPLIT';
  else if (roll < 0.87) role = 'GROUP';
  else role = 'CAMP';

  let nodeIndex: number;
  if (role === 'ADVANCE') nodeIndex = t.mid[Math.floor(Math.random() * t.mid.length)];
  else if (role === 'SPLIT') nodeIndex = t.flank[Math.floor(Math.random() * t.flank.length)];
  else if (role === 'GROUP') nodeIndex = teamGroupPlans[bot.team].nodeIndex;
  else nodeIndex = t.camp[Math.floor(Math.random() * t.camp.length)];

  if (!Number.isInteger(nodeIndex) || !t.waypoints[nodeIndex]) nodeIndex = 0;
  bot.aiRole = role;
  bot.aiRoleTime = role === 'GROUP' ? Math.max(5, teamGroupPlans[bot.team].timer) : 13 + Math.random() * 9;
  bot.aiObjective = waypointPosition(def, nodeIndex);
  bot.aiCampTarget = role === 'CAMP' ? bot.aiObjective.clone() : null;
  return bot.aiObjective;
}

function ensureAiRole(bot: Soldier): void {
  if (bot.aiRole && bot.aiObjective && bot.aiRoleTime > 0) return;
  assignAiRole(bot, currentDef());
}

function pickTacticalGoalForBot(bot: Soldier): THREE.Vector3 {
  const def = currentDef();

  if (bot.aiState === 'SEEK_COVER') {
    return randomWaypoint(def, def.tactical.safe[bot.team]);
  }

  ensureAiRole(bot);
  return (bot.aiObjective ?? bot.pos).clone();
}

function gaussRand(): number {
  let u = 0,
    v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

export function updateAIBots(dt: number): void {
  const nav = getBotNavigation();
  nav?.update(dt);
  updateTeamGroupPlans(dt);

  // aimSigma = 1-sigma angular error (rad) when settled & still. react = seconds before first shot
  // on new target. settle = seconds on target until aim error reaches its floor.
  const skillTable: Record<AiSkill, SkillParams> = {
    RECRUIT: { aimSigma: 0.02, react: 0.7, settle: 1.3, fireDelay: 0.55, sightRange: 38 },
    VETERAN: { aimSigma: 0.012, react: 0.42, settle: 0.9, fireDelay: 0.38, sightRange: 48 },
    ELITE: { aimSigma: 0.0075, react: 0.24, settle: 0.6, fireDelay: 0.26, sightRange: 56 },
  };
  const skillParams: SkillParams = skillTable[matchState.aiSkill] || skillTable.VETERAN;

  for (let i = 0; i < allSoldiers.length; i++) {
    const bot = allSoldiers[i];
    if (bot.isPlayer) continue;
    if (net.active && !net.owns(bot)) {
      net.updateRemote(bot, dt);
      continue;
    }

    // Dead AI Bot -> Update 11-node Verlet Ragdoll & 5s Respawn Timer
    if (!bot.alive) {
      nav?.remove(bot);
      bot.respawnTimer -= dt;
      if (bot.ragdoll) {
        bot.ragdoll.step(dt);
        applyRagdollToSoldierRig(bot.rig, bot.ragdoll);
      }
      if (bot.respawnTimer <= 0) {
        respawnSoldier(bot);
      }
      continue;
    }

    bot.fireCooldown = Math.max(0, bot.fireCooldown - dt);
    bot.burstCooldown = Math.max(0, bot.burstCooldown - dt);
    bot.aiRoleTime = Math.max(0, (bot.aiRoleTime || 0) - dt);
    if (bot.aiRoleTime <= 0) {
      bot.aiRole = null;
      bot.aiObjective = null;
      bot.aiCampTarget = null;
      bot.pathTimer = 0;
    }
    bot.grenadeCooldown = Math.max(0, (bot.grenadeCooldown || 0) - dt);
    bot.smokeCooldown = Math.max(0, (bot.smokeCooldown || 0) - dt);
    updateSpawnProtection(bot, dt);
    bot.pathTimer -= dt;
    bot.strafeTimer -= dt;
    if (bot.strafeTimer <= 0) {
      bot.strafeDir *= -1;
      bot.strafeTimer = 1.2 + Math.random() * 1.8;
    }
    updateReload(bot, dt);
    regenSoldier(bot, dt);

    // 1. Scan for Nearest Visible Enemy with Clear Line-of-Sight
    let nearestEnemy: Soldier | null = null;
    const bw = weaponOf(bot);
    let nearestDist = skillParams.sightRange * (bw.sightMul || 1);
    const botEye = bot.pos.clone().add(new THREE.Vector3(0, 1.52 - 0.42 * (bot.crouch || 0), 0));

    for (let j = 0; j < allSoldiers.length; j++) {
      const other = allSoldiers[j];
      if (!other.alive || other.team === bot.team) continue;
      const dist = bot.pos.distanceTo(other.pos);
      if (dist < nearestDist) {
        const enemyChest = other.pos.clone().add(new THREE.Vector3(0, 1.32, 0));
        if (hasLineOfSight(botEye, enemyChest)) {
          nearestDist = dist;
          nearestEnemy = other;
        }
      }
    }
    bot.targetEnemy = nearestEnemy;

    // 2. Tactical State Transition
    if (bot.hp < 35 && nearestEnemy) {
      bot.aiState = 'SEEK_COVER';
    } else if (nearestEnemy) {
      bot.aiState = 'ENGAGE';
    } else {
      bot.aiState = bot.aiRole === 'SPLIT' ? 'FLANK' : 'ADVANCE';
    }

    // 2b. Stance & gait: sprint on long open approaches, crouch in standoff fights
    const enemyDistNow = nearestEnemy ? bot.pos.distanceTo(nearestEnemy.pos) : Infinity;

    // Low-HP smoke escape: only a rare, pre-spawn-planned minority burns their smoke.
    if (
      nearestEnemy &&
      bot.hp < 35 &&
      bot.smokeCharges > 0 &&
      bot.smokeCooldown <= 0 &&
      bot.aiSmokeEscapePlanned
    ) {
      retreatSmokeEscape(bot, nearestEnemy);
      bot.aiSmokeEscapePlanned = false;
    }

    // Occasionally lob a grenade at a visible target or into the approach lane.
    if (
      nearestEnemy &&
      bot.grenadeCharges > 0 &&
      bot.grenadeCooldown <= 0 &&
      enemyDistNow > 5.5 &&
      enemyDistNow < 23
    ) {
      if (Math.random() < dt * (bot.hp < 40 ? 0.18 : 0.09)) {
        lobGrenadeAtTarget(bot, nearestEnemy);
      }
    }
    const campHold = bot.aiRole === 'CAMP' && bot.aiObjective && bot.pos.distanceTo(bot.aiObjective) < 1.8;
    if (campHold) {
      bot.stanceTarget = 1;
    } else if (!nearestEnemy) {
      bot.stanceTarget = 0;
    } else {
      // CAMP role holds a corner: crouched, lethal, not glued to the crosshair chase loop.
      if (bot.aiRole === 'CAMP' && bot.aiObjective && bot.pos.distanceTo(bot.aiObjective) < 1.8) {
        bot.stanceTarget = 1;
      } else {
        bot.stanceTimer -= dt;
        if (bot.stanceTimer <= 0) {
          bot.stanceTimer = 1.8 + Math.random() * 2.2;
          const hurt = bot.hp < 40;
          // Hysteresis keeps bots from bobbing up and down at the range boundary
          const standoff = enemyDistNow > (bot.stanceTarget > 0.5 ? 10 : 14);
          bot.stanceTarget = standoff || hurt ? 1 : 0;
        }
      }
    }
    const crouched = bot.stanceTarget > 0.5;
    const goalDist = bot.path.length
      ? Math.hypot(bot.path[bot.path.length - 1].x - bot.pos.x, bot.path[bot.path.length - 1].z - bot.pos.z)
      : 0;
    bot.sprinting = !nearestEnemy && !crouched && !bot.reloading && goalDist > 9;

    // 3. Route request. Tactical layer picks a goal; the navmesh crowd owns the route.
    const crouchedNow = bot.stanceTarget > 0.5;
    const walkGait = (bot.sprinting ? 7.6 : crouchedNow ? 1.55 : 5.6) * bw.speed;
    if (nav) {
      if (bot.aiState === 'ENGAGE' && nearestEnemy) {
        nav.hold(bot);
      } else if (bot.pathTimer <= 0 || !nav.isFollowing(bot)) {
        bot.pathTimer = 1.1 + Math.random() * 0.7;
        const result = nav.setGoal(bot, pickTacticalGoalForBot(bot));
        if (result === 'ok') {
          bot.path = nav.corners(bot).map((c) => new THREE.Vector3(c.x, c.y, c.z));
        } else {
          // Blocked / unreachable objective: drop it, pick another next tick.
          bot.aiRoleTime = 0;
          bot.aiRole = null;
          bot.aiObjective = null;
          bot.pathTimer = 0.25;
        }
      }
    } else if (bot.pathTimer <= 0 || bot.path.length === 0) {
      // Navigation not available yet (worker still generating): steer straight at the objective.
      bot.pathTimer = 1.1 + Math.random() * 0.7;
      bot.path = [pickTacticalGoalForBot(bot)];
    }

    // 4. Compute Steering Direction
    const moveDir = new THREE.Vector3();
    let traversing: { x: number; y: number; z: number } | null = null;
    let navMoving = false;

    if (bot.aiState === 'ENGAGE' && nearestEnemy) {
      const toEnemy = new THREE.Vector3().subVectors(nearestEnemy.pos, bot.pos);
      toEnemy.y = 0;
      const dist = toEnemy.length() || 1;
      toEnemy.divideScalar(dist);
      const strafeVec = new THREE.Vector3(-toEnemy.z * bot.strafeDir, 0, toEnemy.x * bot.strafeDir);

      if (dist > bw.engage) {
        moveDir.addScaledVector(toEnemy, 0.75).addScaledVector(strafeVec, 0.55);
      } else if (dist < bw.minDist) {
        moveDir.addScaledVector(toEnemy, -0.55).addScaledVector(strafeVec, 0.85);
      } else {
        moveDir.copy(strafeVec);
      }
    } else if (nav) {
      const steer = nav.steer(bot, walkGait);
      if (steer.offMesh && steer.offMeshPos) traversing = steer.offMeshPos;
      else if (steer.moving) {
        moveDir.set(steer.x, 0, steer.z);
        navMoving = true;
      }
    } else if (bot.path.length > 0) {
      const wp = bot.path[0];
      const toWp = new THREE.Vector3(wp.x - bot.pos.x, 0, wp.z - bot.pos.z);
      const wpDist = toWp.length();
      if (wpDist < 1.15) {
        bot.path.shift();
      } else {
        moveDir.copy(toWp.divideScalar(wpDist));
      }
      // Whisker avoidance only for the no-navmesh fallback.
      if (moveDir.lengthSq() > 0.001) {
        const whiskerOrigin = bot.pos.clone().add(new THREE.Vector3(0, 0.85, 0));
        const up = new THREE.Vector3(0, 1, 0);
        const left = moveDir.clone().applyAxisAngle(up, 0.52);
        const right = moveDir.clone().applyAxisAngle(up, -0.52);
        const hitCenter = raycastMap(whiskerOrigin, moveDir, 1.45);
        const hitLeft = raycastMap(whiskerOrigin, left, 1.35);
        const hitRight = raycastMap(whiskerOrigin, right, 1.35);
        if (hitCenter.hit || hitLeft.hit || hitRight.hit) {
          moveDir.applyAxisAngle(up, (hitLeft.distance > hitRight.distance ? 1 : -1) * 0.85);
        }
      }
    }

    // Separation from nearby living soldiers so bots don't stack
    for (let j = 0; j < allSoldiers.length; j++) {
      if (i === j || !allSoldiers[j].alive) continue;
      const other = allSoldiers[j];
      const dx = bot.pos.x - other.pos.x;
      const dz = bot.pos.z - other.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.01 && d < 1.35) {
        const push = (1.35 - d) / 1.35;
        moveDir.x += (dx / d) * push * 0.9;
        moveDir.z += (dz / d) * push * 0.9;
      }
    }

    // Gait speeds matched to the Walk/Run clip stride speed so feet do not slide
    let gait;
    if (bot.sprinting) gait = 7.6;
    else if (crouched) gait = 1.55;
    else if (bot.aiState === 'ENGAGE') gait = nearestEnemy && enemyDistNow > bw.engage ? 5.2 : 3.1;
    else gait = 5.6;
    const speed = gait * bw.speed;
    if (moveDir.lengthSq() > 0.001) {
      moveDir.normalize();
      bot.vel.x = moveDir.x * speed;
      bot.vel.z = moveDir.z * speed;
      bot.footstepTimer = (bot.footstepTimer || 0) - dt * (bot.sprinting ? 2.45 : 1.55);
      if (bot.footstepTimer <= 0) {
        sfx.playFootstep(bot.pos.clone(), bot.sprinting ? 1.1 : 0.75);
        bot.footstepTimer = 1;
      }
    } else {
      bot.vel.x = 0;
      bot.vel.z = 0;
    }

    if (traversing) {
      // Off-mesh link (drop / jump): the crowd animates the agent, the body mirrors it and skips collision.
      bot.pos.set(traversing.x, traversing.y, traversing.z);
      bot.vel.set(0, 0, 0);
      bot.onGround = false;
    } else {
      // Gravity & Map Collision
      bot.vel.y -= 21.0 * dt;
      bot.pos.addScaledVector(bot.vel, dt);
      resolveCylinderCollision(bot.pos, 0.42, 1.8);

      const floorY = getFloorHeightAt(bot.pos.x, bot.pos.z, bot.pos.y + 0.35);
      if (bot.pos.y <= floorY) {
        bot.pos.y = floorY;
        bot.vel.y = 0;
        bot.onGround = true;
      }
    }

    // Stuck detection / recovery + crowd resync
    if (nav) {
      const fix = nav.afterMove(bot, dt, navMoving);
      if (fix.action === 'abandon') {
        bot.aiRoleTime = 0;
        bot.aiRole = null;
        bot.aiObjective = null;
        bot.pathTimer = 0;
      } else if (fix.action === 'relocated' && fix.relocateTo) {
        bot.pos.set(fix.relocateTo.x, fix.relocateTo.y, fix.relocateTo.z);
        bot.vel.set(0, 0, 0);
        bot.pathTimer = 0;
      }
    }

    // 6. Smooth Yaw Rotation (Look at targetEnemy when engaging, else look along movement)
    let desiredYaw = bot.yaw;
    if (nearestEnemy) {
      desiredYaw = Math.atan2(-(nearestEnemy.pos.x - bot.pos.x), -(nearestEnemy.pos.z - bot.pos.z));
    } else if (moveDir.lengthSq() > 0.01) {
      desiredYaw = Math.atan2(-moveDir.x, -moveDir.z);
    }

    // Shortest angular interpolation
    let angleDiff = desiredYaw - bot.yaw;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
    bot.yaw += angleDiff * Math.min(1, dt * 7.0);

    // Update Rig Transform & Stance Animation
    updateSoldierRigVisual(bot, dt);

    // 7. Realistic burst fire: reaction delay, settling aim, gaussian error, recoil climb
    if (nearestEnemy) {
      if (bot.aimTargetId !== nearestEnemy.id) {
        bot.aimTargetId = nearestEnemy.id;
        bot.lockTime = 0;
        bot.reactTimer = skillParams.react * (0.7 + Math.random() * 0.6);
        bot.burstShots = 0;
        bot.aimHeight = 0.9 + Math.random() * 0.3; // belly..upper chest, never head
      } else {
        bot.lockTime += dt;
        bot.reactTimer -= dt;
      }
    } else {
      bot.aimTargetId = -1;
      bot.lockTime = 0;
    }

    if (
      nearestEnemy &&
      nearestDist <= bw.botRange &&
      Math.abs(angleDiff) < 0.14 &&
      bot.reactTimer <= 0 &&
      bot.burstCooldown <= 0 &&
      !bot.reloading
    ) {
      // Aim lower torso, not chest/head -> error spreads over body, few headshots
      const aimPoint = nearestEnemy.pos
        .clone()
        .add(new THREE.Vector3(0, (bot.aimHeight || 1.05) - 0.4 * (nearestEnemy.crouch || 0), 0));
      const aimDir = aimPoint.sub(botEye).normalize();

      const settle = 1 + 1.6 * Math.max(0, 1 - bot.lockTime / skillParams.settle);
      const enemySpeed = Math.hypot(nearestEnemy.vel.x, nearestEnemy.vel.z);
      const ownSpeed = Math.hypot(bot.vel.x, bot.vel.z);
      const sigma =
        skillParams.aimSigma *
        bw.botSigma *
        settle *
        (1 + enemySpeed * 0.07 + ownSpeed * 0.05) *
        (1 + bot.burstShots * 0.12);

      const yawErr = gaussRand() * sigma;
      const pitchErr = gaussRand() * sigma * 0.8 + bot.burstShots * 0.0012; // slight recoil climb
      const worldUp = new THREE.Vector3(0, 1, 0);
      aimDir.applyAxisAngle(worldUp, yawErr);
      const rightAxis = new THREE.Vector3().crossVectors(aimDir, worldUp).normalize();
      aimDir.applyAxisAngle(rightAxis, pitchErr);

      if (fireWeapon(bot, botEye, aimDir, 0)) {
        bot.burstShots += 1;
        if (bot.burstShots >= bot.burstLen) {
          bot.burstShots = 0;
          bot.burstLen = bw.botBurst[0] + Math.floor(Math.random() * (bw.botBurst[1] - bw.botBurst[0] + 1));
          bot.burstCooldown = (skillParams.fireDelay + Math.random() * 0.45) * bw.botDelay;
        }
      }
    }
  }
}

// =========================================================================
// 15. TACTICAL HUD, 2D RADAR MINIMAP, HITMARKER & SCOREBOARD
