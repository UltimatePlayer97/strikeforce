import * as THREE from 'three';
import { getScene } from '../renderer';
import type { ThrowableState, SmokeCloud, DebrisPiece, Soldier } from '../types';
import { getFloorHeightAt, resolveCylinderCollision } from '../physics/collision';
import { VerletRagdoll } from '../physics/ragdoll';
import { sfx } from '../audio/sound';

const THROW_GRAVITY = 13.5;
const GRENADE_LAUNCH_SPEED = 15.2;
const SMOKE_LAUNCH_SPEED = 15.5;

let projectileIdCounter = 1;

const activeProjectiles: ThrowableState[] = [];
const activeSmokes: SmokeCloud[] = [];
const activeDebris: DebrisPiece[] = [];

export function getActiveProjectiles(): ThrowableState[] { return activeProjectiles; }
export function getActiveSmokes(): SmokeCloud[] { return activeSmokes; }
export function getActiveDebris(): DebrisPiece[] { return activeDebris; }

export function throwGrenade(owner: Soldier, origin: THREE.Vector3, direction: THREE.Vector3): void {
  if (owner.grenades <= 0) return;
  owner.grenades--;

  const velocity = direction.clone().multiplyScalar(GRENADE_LAUNCH_SPEED);
  velocity.y += 5.5;

  const projectile: ThrowableState = {
    type: 'grenade',
    position: origin.clone(),
    velocity,
    owner,
    timer: 3.8,
    id: projectileIdCounter++
  };
  activeProjectiles.push(projectile);
  sfx.playThrow(origin);
}

export function throwSmoke(owner: Soldier, origin: THREE.Vector3, direction: THREE.Vector3): void {
  if (owner.smokes <= 0) return;
  owner.smokes--;

  const velocity = direction.clone().multiplyScalar(SMOKE_LAUNCH_SPEED);
  velocity.y += 5.8;

  const projectile: ThrowableState = {
    type: 'smoke',
    position: origin.clone(),
    velocity,
    owner,
    timer: 1.2,
    id: projectileIdCounter++
  };
  activeProjectiles.push(projectile);
  sfx.playThrow(origin);
}

export function updateProjectiles(dt: number, soldiers: Soldier[]): void {
  for (let i = activeProjectiles.length - 1; i >= 0; i--) {
    const p = activeProjectiles[i];
    p.timer -= dt;
    p.velocity.y -= THROW_GRAVITY * dt;
    p.position.addScaledVector(p.velocity, dt);

    const floorY = getFloorHeightAt(p.position.x, p.position.z);
    if (p.position.y <= floorY + 0.08) {
      p.position.y = floorY + 0.08;
      if (p.velocity.y < -1) {
        p.velocity.y = Math.abs(p.velocity.y) * 0.35;
        if (p.type === 'grenade') sfx.playGrenadeBounce(p.position);
      } else {
        p.velocity.y = 0;
      }
      p.velocity.x *= 0.6;
      p.velocity.z *= 0.6;
    }

    resolveCylinderCollision(p.position, 0.06, 0.12);

    if (p.timer <= 0) {
      if (p.type === 'grenade') {
        explodeGrenade(p.position, p.owner, soldiers);
      } else {
        deploySmoke(p.position);
      }
      activeProjectiles.splice(i, 1);
    }
  }
}

function explodeGrenade(position: THREE.Vector3, owner: Soldier, soldiers: Soldier[]): void {
  const radius = 6.5;
  const damage = 95;

  for (const soldier of soldiers) {
    if (!soldier.isAlive || soldier === owner) continue;
    const dist = soldier.pos.distanceTo(position);
    if (dist < radius) {
      const dmg = Math.floor(damage * (1 - dist / radius));
      applyDamage(soldier, dmg, owner, position, false);
    }
  }

  createExplosionDebris(position);
  sfx.playExplosion(position);
}

function deploySmoke(position: THREE.Vector3): void {
  const geometry = new THREE.SphereGeometry(1, 16, 12);
  const material = new THREE.MeshBasicMaterial({
    color: 0x888888,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(position);
  mesh.position.y = 0.5;
  getScene().add(mesh);

  const smoke: SmokeCloud = {
    mesh,
    position: position.clone(),
    radius: 4.2,
    startTime: performance.now() / 1000,
    life: 22
  };
  activeSmokes.push(smoke);
  sfx.playSmokePop(position);
}

function createExplosionDebris(position: THREE.Vector3): void {
  const count = 12 + Math.floor(Math.random() * 8);
  for (let i = 0; i < count; i++) {
    const geo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(0.08, 0.3, 0.25 + Math.random() * 0.15),
      roughness: 0.85,
      metalness: 0.15
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(position);
    mesh.position.y += 0.5;
    getScene().add(mesh);

    const debris: DebrisPiece = {
      mesh,
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * 14,
        Math.random() * 10 + 4,
        (Math.random() - 0.5) * 14
      ),
      life: 3.5,
      angularVel: new THREE.Vector3(
        (Math.random() - 0.5) * 18,
        (Math.random() - 0.5) * 18,
        (Math.random() - 0.5) * 18
      )
    };
    activeDebris.push(debris);
  }
}

export function updateSmokes(dt: number): void {
  const now = performance.now() / 1000;
  for (let i = activeSmokes.length - 1; i >= 0; i--) {
    const smoke = activeSmokes[i];
    const age = now - smoke.startTime;
    if (age >= smoke.life) {
      getScene().remove(smoke.mesh);
      smoke.mesh.geometry.dispose();
      (smoke.mesh.material as THREE.Material).dispose();
      activeSmokes.splice(i, 1);
    } else {
      const progress = age / smoke.life;
      smoke.mesh.scale.setScalar(0.3 + progress * 2.2);
      (smoke.mesh.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - progress * 0.7);
    }
  }
}

export function updateDebris(dt: number): void {
  for (let i = activeDebris.length - 1; i >= 0; i--) {
    const d = activeDebris[i];
    d.life -= dt;
    d.velocity.y -= 22 * dt;
    d.mesh.position.addScaledVector(d.velocity, dt);
    d.mesh.rotation.x += d.angularVel.x * dt;
    d.mesh.rotation.y += d.angularVel.y * dt;
    d.mesh.rotation.z += d.angularVel.z * dt;

    const floorY = getFloorHeightAt(d.mesh.position.x, d.mesh.position.z);
    if (d.mesh.position.y <= floorY + 0.05) {
      d.mesh.position.y = floorY + 0.05;
      d.velocity.y = Math.abs(d.velocity.y) * 0.2;
      d.velocity.x *= 0.7;
      d.velocity.z *= 0.7;
    }

    if (d.life <= 0) {
      getScene().remove(d.mesh);
      d.mesh.geometry.dispose();
      (d.mesh.material as THREE.Material).dispose();
      activeDebris.splice(i, 1);
    }
  }
}

export function clearProjectiles(): void {
  activeProjectiles.length = 0;
}

export function clearSmokes(): void {
  for (const s of activeSmokes) {
    getScene().remove(s.mesh);
    s.mesh.geometry.dispose();
    (s.mesh.material as THREE.Material).dispose();
  }
  activeSmokes.length = 0;
}

export function clearDebris(): void {
  for (const d of activeDebris) {
    getScene().remove(d.mesh);
    d.mesh.geometry.dispose();
    (d.mesh.material as THREE.Material).dispose();
  }
  activeDebris.length = 0;
}

function applyDamage(target: Soldier, damage: number, attacker: Soldier, hitPos: THREE.Vector3, isHeadshot: boolean): void {
  target.hp = Math.max(0, target.hp - damage);
  if (target.hp <= 0 && target.isAlive) {
    killSoldier(target, attacker, hitPos, isHeadshot);
  }
}

function killSoldier(victim: Soldier, killer: Soldier, hitPos: THREE.Vector3, isHeadshot: boolean): void {
  victim.isAlive = false;
  victim.deathTime = performance.now() / 1000;
  victim.killerId = killer.id;
  killer.kills++;
  victim.deaths++;

  const impulseDir = victim.pos.clone().sub(hitPos).normalize();
  impulseDir.y = 0.3;
  victim.ragdoll = new VerletRagdoll(
    victim.pos.clone(),
    victim.yaw,
    victim.vel.clone(),
    hitPos,
    impulseDir.multiplyScalar(8)
  );
}