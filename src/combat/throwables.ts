import * as THREE from 'three';
import { sfx } from '../audio/SoundFX';
import { GRENADE_LAUNCH_SPEED, SMOKE_LAUNCH_SPEED, THROW_GRAVITY } from '../config';
import { camera, scene } from '../core/renderer';
import { damageSoldier } from '../game/damage';
import {
  activeDebris,
  activeProjectiles,
  activeSmokes,
  allSoldiers,
  game,
} from '../game/state';
import { net } from '../net/net';
import type { Projectile, ProjectileLike, Smoke, Soldier, ThrowableType } from '../types';
import { shakeScreenFromExplosion } from '../ui/feedback';
import { updateThrowableHUD } from '../ui/hud';
import { getFloorHeightAt, raycastMap } from '../world/collision';
import { queryColliders } from '../world/collisionWorld';
import { damageDestructiblesInRadius, spawnDebris } from './destructibles';
import { spawnSparkBurst } from './effects';

function createGrenadeMesh(): THREE.Group {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0x33413a, roughness: 0.68, metalness: 0.35 }),
  );
  body.scale.set(1, 1.25, 1);
  const band = new THREE.Mesh(
    new THREE.TorusGeometry(0.155, 0.025, 6, 18),
    new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.34, metalness: 0.9 }),
  );
  band.rotation.x = Math.PI / 2;
  group.add(body, band);
  return group;
}

function createSmokeCanisterMesh(): THREE.Group {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.13, 0.13, 0.22, 14, 1),
    new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.36, metalness: 0.86 }),
  );
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.145, 0.13, 0.055, 14, 1),
    new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.28, metalness: 0.9 }),
  );
  cap.position.y = 0.14;
  group.add(body, cap);
  return group;
}

function netSendThrowable(payload: Record<string, unknown>): void {
  if (!net.active) return;
  net.send(Object.assign({ t: 'g' }, payload));
}

function spawnThrowable(
  owner: Soldier,
  type: ThrowableType,
  origin: THREE.Vector3,
  velocity: THREE.Vector3,
  fuse = 2.2,
): Projectile {
  const mesh = type === 'smoke' ? createSmokeCanisterMesh() : createGrenadeMesh();
  mesh.position.copy(origin);
  scene.add(mesh);
  const projectile = {
    id: game.projectileIdCounter++,
    owner,
    type,
    mesh,
    vel: velocity.clone(),
    fuse,
    alive: true,
    simulate: !net.active || net.owns(owner),
  };
  activeProjectiles.push(projectile);
  sfx.playThrow(origin);
  return projectile;
}

export function spawnThrowerViewProjectile(
  owner: Soldier,
  type: ThrowableType,
  origin: THREE.Vector3,
  velocity: THREE.Vector3,
): Projectile | undefined {
  spawnThrowable(owner, type, origin, velocity, 5.0);
  const p = activeProjectiles[activeProjectiles.length - 1];
  if (p) p.simulate = false;
  return p;
}

function solvePlayerThrowable(origin: THREE.Vector3, type: ThrowableType): THREE.Vector3 {
  // Target the point under the crosshair. Low-arc ballistic solution keeps the toss
  // accurate without turning it into a charged rocket shot.
  const cameraDir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const rayHit = raycastMap(camera.position, cameraDir, 24);
  const targetDistance = rayHit.hit ? rayHit.distance : 21;
  const target = camera.position.clone().addScaledVector(cameraDir, targetDistance);
  const launchSpeed = type === 'smoke' ? SMOKE_LAUNCH_SPEED : GRENADE_LAUNCH_SPEED;
  const horizontal = new THREE.Vector3(target.x - origin.x, 0, target.z - origin.z);
  let horizontalDistance = horizontal.length();
  if (horizontalDistance < 0.35) {
    horizontal.set(-Math.sin(game.humanPlayer.yaw), 0, -Math.cos(game.humanPlayer.yaw));
    horizontalDistance = 0.35;
  } else {
    horizontal.normalize();
  }

  const dy = target.y - origin.y;
  horizontalDistance = Math.max(
    0.35,
    Math.min(horizontalDistance, ((launchSpeed * launchSpeed) / THROW_GRAVITY) * 0.96),
  );
  const disc =
    launchSpeed * launchSpeed * launchSpeed * launchSpeed -
    THROW_GRAVITY *
      (THROW_GRAVITY * horizontalDistance * horizontalDistance + 2 * dy * launchSpeed * launchSpeed);
  let angle;
  if (disc > 0) {
    // Lower of the two possible trajectories; still lofted, not flat or mortar-high.
    const root = Math.sqrt(disc);
    angle = Math.atan((launchSpeed * launchSpeed - root) / (THROW_GRAVITY * horizontalDistance));
  } else {
    angle = THREE.MathUtils.degToRad(44);
  }
  angle = THREE.MathUtils.clamp(angle, THREE.MathUtils.degToRad(8), THREE.MathUtils.degToRad(58));
  return horizontal.multiplyScalar(Math.cos(angle) * launchSpeed).setY(Math.sin(angle) * launchSpeed);
}

export function throwThrowable(
  owner: Soldier,
  type: ThrowableType,
  direction: THREE.Vector3,
  extraPitch = 0,
): boolean {
  if (type === 'grenade' && owner.grenadeCharges <= 0) return false;
  if (type === 'smoke' && owner.smokeCharges <= 0) return false;
  if (type === 'grenade' && owner.grenadeCooldown > 0) return false;
  if (type === 'smoke' && owner.smokeCooldown > 0) return false;

  const dir = direction.clone().normalize();
  const origin = owner.pos
    .clone()
    .add(new THREE.Vector3(0, 1.35, 0))
    .addScaledVector(dir, 0.62);
  const velocity = owner.isPlayer
    ? solvePlayerThrowable(origin, type)
    : dir
        .clone()
        .multiplyScalar(type === 'smoke' ? 10.5 : 13.5)
        .setY(type === 'smoke' ? 5.5 : 4.8 + extraPitch);
  if (type === 'grenade') owner.grenadeCharges -= 1;
  else owner.smokeCharges -= 1;
  if (type === 'grenade') owner.grenadeCooldown = 1.2;
  else owner.smokeCooldown = 1.2;
  const projectile = spawnThrowable(owner, type, origin, velocity, type === 'smoke' ? 1.55 : 2.05);
  netSendThrowable({
    k: 'throw',
    w: type,
    id: owner.id,
    o: net.v3(origin),
    v: net.v3(velocity),
    f: +projectile.fuse.toFixed(2),
  });
  if (owner.isPlayer) updateThrowableHUD();
  return true;
}

export function lobGrenadeAtTarget(owner: Soldier, target: Soldier | null): boolean {
  if (!target) return false;
  const toEnemy = target.pos.clone().sub(owner.pos);
  toEnemy.y = 0;
  const flat = toEnemy.clone().normalize();
  const dist = toEnemy.length();
  const origin = owner.pos
    .clone()
    .add(new THREE.Vector3(0, 1.35, 0))
    .addScaledVector(flat, 0.62);
  const velocity = flat.multiplyScalar(Math.min(11, Math.max(6.2, dist * 0.5)));
  velocity.y += 4.2;
  owner.grenadeCharges -= 1;
  owner.grenadeCooldown = 4.0;
  const projectile = spawnThrowable(owner, 'grenade', origin, velocity, 2.05);
  netSendThrowable({
    k: 'throw',
    w: 'grenade',
    id: owner.id,
    o: net.v3(origin),
    v: net.v3(velocity),
    f: +projectile.fuse.toFixed(2),
  });
  return true;
}

export function retreatSmokeEscape(bot: Soldier, target: Soldier | null): boolean {
  if (!target) return false;
  const away = bot.pos.clone().sub(target.pos);
  away.y = 0;
  if (away.lengthSq() < 0.05) away.set(Math.random() - 0.5, 0, Math.random() - 0.5);
  away.normalize();
  // Nudge sideways so the smoke lands between bot and gunfire, not at its own feet.
  away.x += (Math.random() - 0.5) * 0.62;
  away.z += (Math.random() - 0.5) * 0.62;
  away.normalize();
  if (bot.smokeCharges <= 0 || bot.smokeCooldown > 0) return false;
  bot.smokeCharges -= 1;
  bot.smokeCooldown = 7.5;
  const origin = bot.pos
    .clone()
    .add(new THREE.Vector3(0, 1.35, 0))
    .addScaledVector(away, 0.62);
  const velocity = away.multiplyScalar(7.0);
  velocity.y += 3.1;
  const smoke = spawnThrowable(bot, 'smoke', origin, velocity, 1.0);
  netSendThrowable({
    k: 'throw',
    w: 'smoke',
    id: bot.id,
    o: net.v3(origin),
    v: net.v3(velocity),
    f: +smoke.fuse.toFixed(2),
  });
  return true;
}

function resolveProjectileBoxCollision(p: Projectile): void {
  const nearBoxes = queryColliders(
    p.mesh.position.x - 0.8,
    p.mesh.position.x + 0.8,
    p.mesh.position.z - 0.8,
    p.mesh.position.z + 0.8,
  );
  for (const box of nearBoxes) {
    const radius = 0.16;
    if (p.mesh.position.y + radius < box.minY || p.mesh.position.y - radius > box.maxY) continue;
    const closestX = THREE.MathUtils.clamp(p.mesh.position.x, box.minX, box.maxX);
    const closestZ = THREE.MathUtils.clamp(p.mesh.position.z, box.minZ, box.maxZ);
    const dx = p.mesh.position.x - closestX;
    const dz = p.mesh.position.z - closestZ;
    const distSq = dx * dx + dz * dz;
    if (distSq >= radius * radius) continue;
    const dist = Math.sqrt(Math.max(distSq, 0.0001));
    if (dist > 0.0001) {
      p.mesh.position.x += (dx / dist) * (radius - dist);
      p.mesh.position.z += (dz / dist) * (radius - dist);
      const inv = 1 / dist;
      const nx = dx * inv;
      const nz = dz * inv;
      const along = p.vel.x * nx + p.vel.z * nz;
      if (along < 0) {
        p.vel.x -= 1.7 * along * nx;
        p.vel.z -= 1.7 * along * nz;
        p.vel.x *= 0.72;
        p.vel.z *= 0.72;
        sfx.playGrenadeBounce(p.mesh.position, 0.8);
      }
    } else {
      const penLeft = Math.abs(p.mesh.position.x - box.minX);
      const penRight = Math.abs(box.maxX - p.mesh.position.x);
      const penTop = Math.abs(p.mesh.position.z - box.minZ);
      const penBottom = Math.abs(box.maxZ - p.mesh.position.z);
      const minPen = Math.min(penLeft, penRight, penTop, penBottom);
      if (minPen === penLeft) {
        p.mesh.position.x = box.minX - radius;
        p.vel.x = -Math.abs(p.vel.x) * 0.72;
      } else if (minPen === penRight) {
        p.mesh.position.x = box.maxX + radius;
        p.vel.x = Math.abs(p.vel.x) * 0.72;
      } else if (minPen === penTop) {
        p.mesh.position.z = box.minZ - radius;
        p.vel.z = -Math.abs(p.vel.z) * 0.72;
      } else {
        p.mesh.position.z = box.maxZ + radius;
        p.vel.z = Math.abs(p.vel.z) * 0.72;
      }
      sfx.playGrenadeBounce(p.mesh.position, 0.8);
    }
  }
}

export function explodeProjectile(p: ProjectileLike | Projectile | null, fromNetwork = false): void {
  if (!p) return;
  p.alive = false;
  const center = p.mesh.position.clone();
  const attacker = p.owner;
  if (p.mesh.parent) p.mesh.parent.remove(p.mesh);
  const blastRadius = 5.7;
  const blastDamage = 105;
  // Damage authoritative owners only. Each client owns its slice of the soldier roster.
  for (const soldier of allSoldiers) {
    if (!soldier.alive || soldier.team === attacker.team) continue;
    if (net.active && !net.owns(soldier)) continue;
    const dist = soldier.pos.distanceTo(center);
    if (dist > blastRadius) continue;
    const falloff = 1 - dist / blastRadius;
    const damage = Math.max(18, Math.round(blastDamage * (0.28 + falloff * 0.72)));
    const hitPoint = soldier.pos.clone().add(new THREE.Vector3(0, 1.15, 0));
    const shotDir = hitPoint.clone().sub(center).normalize();
    damageSoldier(soldier, attacker, damage, hitPoint, shotDir, false, true, center);
  }
  damageDestructiblesInRadius(center, blastRadius + 0.65, 135);
  spawnDebris(center, 22, 0.19, 10);
  sfx.playExplosion(center);
  shakeScreenFromExplosion(center, 1);
  spawnSparkBurst(center, 0xf97316, 18);
  if (!fromNetwork) {
    netSendThrowable({ k: 'explode', w: 'grenade', id: attacker.id, p: net.v3(center) });
  }
}

export function deploySmokeProjectile(p: ProjectileLike | Projectile | null, fromNetwork = false): void {
  if (!p) return;
  p.alive = false;
  const center = p.mesh.position.clone();
  center.y = Math.max(0.55, center.y);
  if (p.mesh.parent) p.mesh.parent.remove(p.mesh);
  activateSmokeScreen(center, 6.1, 8.5);
  if (!fromNetwork) {
    netSendThrowable({ k: 'smoke', w: 'smoke', id: p.owner.id, p: net.v3(center) });
  }
}

function activateSmokeScreen(center: THREE.Vector3, radius = 5.2, lifetime = 8.5): void {
  while (activeSmokes.length >= 4) {
    const old = activeSmokes.shift();
    disposeSmoke(old);
  }

  const group = new THREE.Group();
  group.position.copy(center);
  group.scale.setScalar(0.5);
  const sharedGeometry = new THREE.SphereGeometry(1, 18, 12);
  // Dense core gives real visual occlusion. Shells add a soft, slightly translucent edge.
  const core = new THREE.Mesh(
    sharedGeometry,
    new THREE.MeshBasicMaterial({
      color: 0x59636a,
      transparent: true,
      opacity: 0.985,
      depthWrite: true,
      side: THREE.DoubleSide,
    }),
  );
  core.renderOrder = 1;
  const innerShoulder = new THREE.Mesh(
    sharedGeometry,
    new THREE.MeshBasicMaterial({
      color: 0x748188,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  innerShoulder.scale.setScalar(1.08);
  innerShoulder.renderOrder = 2;
  const outerEdge = new THREE.Mesh(
    sharedGeometry,
    new THREE.MeshBasicMaterial({
      color: 0x9aa6ad,
      transparent: true,
      opacity: 0.13,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  outerEdge.scale.setScalar(1.22);
  outerEdge.renderOrder = 3;
  group.add(core, innerShoulder, outerEdge);
  scene.add(group);
  activeSmokes.push({
    mesh: group,
    geometry: sharedGeometry,
    parts: [
      { mesh: core, maxOpacity: 0.985 },
      { mesh: innerShoulder, maxOpacity: 0.28 },
      { mesh: outerEdge, maxOpacity: 0.13 },
    ],
    radius,
    maxRadius: radius,
    age: 0,
    life: lifetime,
  });
  sfx.playSmokePop(center);
}

function disposeSmoke(smoke: Smoke | undefined): void {
  if (!smoke) return;
  if (smoke.mesh.parent) smoke.mesh.parent.remove(smoke.mesh);
  if (smoke.geometry) smoke.geometry.dispose();
  for (const part of smoke.parts) part.mesh.material.dispose();
}

export function updateActiveSmokes(dt: number): void {
  for (let i = activeSmokes.length - 1; i >= 0; i--) {
    const smoke = activeSmokes[i];
    smoke.age += dt;
    const grow = Math.min(1, smoke.age / 0.75);
    smoke.radius = smoke.maxRadius * (0.55 + 0.45 * grow);
    const fadeIn = THREE.MathUtils.clamp(smoke.age / 0.45, 0.25, 1);
    const fadeOut = THREE.MathUtils.clamp((smoke.life - smoke.age) / 1.2, 0, 1);
    smoke.mesh.scale.setScalar(smoke.radius);
    for (const part of smoke.parts) part.mesh.material.opacity = part.maxOpacity * fadeIn * fadeOut;
    if (smoke.age >= smoke.life) {
      disposeSmoke(smoke);
      activeSmokes.splice(i, 1);
    }
  }
}

export function updateProjectiles(dt: number): void {
  for (let i = activeProjectiles.length - 1; i >= 0; i--) {
    const p = activeProjectiles[i];
    if (!p.alive) {
      activeProjectiles.splice(i, 1);
      continue;
    }

    if (p.simulate) {
      p.vel.y -= THROW_GRAVITY * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.rotation.x += dt * 3.5;
      p.mesh.rotation.y += dt * 4.7;
      resolveProjectileBoxCollision(p);
      const floorY = getFloorHeightAt(p.mesh.position.x, p.mesh.position.z, p.mesh.position.y + 0.13);
      if (p.mesh.position.y <= floorY + 0.13) {
        p.mesh.position.y = floorY + 0.13;
        if (Math.abs(p.vel.y) > 1.0)
          sfx.playGrenadeBounce(p.mesh.position, Math.min(1.2, Math.abs(p.vel.y) / 7));
        p.vel.x *= 0.72;
        p.vel.z *= 0.72;
        p.vel.y = Math.abs(p.vel.y) * 0.42;
        if (Math.abs(p.vel.y) < 0.9) p.vel.y = 0;
      }
      p.fuse -= dt;
      if (p.fuse <= 0) {
        if (p.type === 'smoke') deploySmokeProjectile(p, false);
        else explodeProjectile(p, false);
        activeProjectiles.splice(i, 1);
        continue;
      }
    } else {
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.rotation.x += dt * 3.5;
      p.mesh.rotation.y += dt * 4.7;
      p.fuse -= dt;
      if (p.fuse <= 0) {
        if (p.mesh.parent) p.mesh.parent.remove(p.mesh);
        activeProjectiles.splice(i, 1);
        continue;
      }
    }
  }
}

export function updateDebris(dt: number): void {
  for (let i = activeDebris.length - 1; i >= 0; i--) {
    const d = activeDebris[i];
    d.life -= dt;
    d.vel.y -= 18.5 * dt;
    d.mesh.position.addScaledVector(d.vel, dt);
    d.mesh.rotation.x += d.spin.x * dt;
    d.mesh.rotation.y += d.spin.y * dt;
    d.mesh.rotation.z += d.spin.z * dt;
    const floorY = getFloorHeightAt(d.mesh.position.x, d.mesh.position.z, d.mesh.position.y + 0.15);
    if (d.mesh.position.y <= floorY + 0.08) {
      d.mesh.position.y = floorY + 0.08;
      d.vel.y = Math.abs(d.vel.y) * 0.35;
      d.vel.x *= 0.64;
      d.vel.z *= 0.64;
    }
    if (d.life <= 0) {
      if (d.mesh.parent) d.mesh.parent.remove(d.mesh);
      d.mesh.geometry.dispose();
      d.mesh.material.dispose();
      activeDebris.splice(i, 1);
    }
  }
}

export function clearThrowableVisuals(): void {
  for (const p of activeProjectiles) if (p.mesh.parent) p.mesh.parent.remove(p.mesh);
  activeProjectiles.length = 0;
  for (const s of activeSmokes) {
    disposeSmoke(s);
  }
  activeSmokes.length = 0;
  for (const d of activeDebris) {
    if (d.mesh.parent) d.mesh.parent.remove(d.mesh);
    d.mesh.geometry.dispose();
    d.mesh.material.dispose();
  }
  activeDebris.length = 0;
}
