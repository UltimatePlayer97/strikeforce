import * as THREE from 'three';
import { CORPSE_SETTLE_TIME, MAX_CORPSES } from '../config';
import { scene } from '../core/renderer';
import { activeSparks, activeTracers, corpses, droppedWeapons } from '../game/state';
import { applyRagdollToSoldierRig } from '../physics/ragdoll';
import type { Soldier, Team, WeaponId } from '../types';
import { createWeaponInstance } from '../weapons/models';
import { getFloorHeightAt } from '../world/collision';
import { updateActiveSmokes, updateDebris, updateProjectiles } from './throwables';

export function spawnBulletTracer(startPos: THREE.Vector3, endPos: THREE.Vector3, team: Team): void {
  const color = team === 'ALPHA' ? 0x38bdf8 : 0xf87171;
  const dist = startPos.distanceTo(endPos);
  if (dist < 0.2) return;

  const geo = new THREE.CylinderGeometry(0.018, 0.018, Math.min(dist, 4.5), 6);
  geo.rotateX(Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
  const mesh = new THREE.Mesh(geo, mat);

  const dir = new THREE.Vector3().subVectors(endPos, startPos).normalize();
  mesh.position.copy(startPos).addScaledVector(dir, Math.min(dist, 4.5) * 0.5);
  mesh.lookAt(endPos);
  scene.add(mesh);

  activeTracers.push({
    mesh,
    endPos: endPos.clone(),
    dir,
    speed: 185,
    life: 0.28,
  });
}

export function spawnImpactSparks(pos: THREE.Vector3, isBlood = false): void {
  const color = isBlood ? 0xdc2626 : 0xfbbf24;
  for (let i = 0; i < 6; i++) {
    const spark = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.05, 0.05),
      new THREE.MeshBasicMaterial({ color }),
    );
    spark.position.copy(pos);
    scene.add(spark);
    activeSparks.push({
      mesh: spark,
      vel: new THREE.Vector3((Math.random() - 0.5) * 7, Math.random() * 5 + 1.5, (Math.random() - 0.5) * 7),
      life: 0.28,
    });
  }
}

export function spawnSparkBurst(pos: THREE.Vector3, color = 0xfbbf24, count = 12): void {
  for (let i = 0; i < count; i++) {
    const spark = new THREE.Mesh(
      new THREE.BoxGeometry(
        0.055 + Math.random() * 0.035,
        0.055 + Math.random() * 0.035,
        0.055 + Math.random() * 0.035,
      ),
      new THREE.MeshBasicMaterial({ color }),
    );
    spark.position.copy(pos);
    scene.add(spark);
    activeSparks.push({
      mesh: spark,
      vel: new THREE.Vector3(
        (Math.random() - 0.5) * 11,
        Math.random() * 6.5 + 0.5,
        (Math.random() - 0.5) * 11,
      ),
      life: 0.32 + Math.random() * 0.24,
    });
  }
}

export function spawnDroppedRifle(
  worldPos: THREE.Vector3,
  worldQuat: THREE.Quaternion,
  impulseVel: THREE.Vector3,
  weaponId: WeaponId = 'assault',
): void {
  const mesh = createWeaponInstance(weaponId);
  mesh.position.copy(worldPos);
  mesh.quaternion.copy(worldQuat);
  scene.add(mesh);

  droppedWeapons.push({
    mesh,
    vel: impulseVel.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, 3.2, (Math.random() - 0.5) * 3)),
    angVel: new THREE.Vector3(
      (Math.random() - 0.5) * 14,
      (Math.random() - 0.5) * 14,
      (Math.random() - 0.5) * 14,
    ),
    life: 60.0,
  });
}

// Persistent corpses: up to MAX_CORPSES ragdolls stay in world after respawn
export function retireCorpse(soldier: Soldier): boolean {
  if (!soldier.rig || !soldier.ragdoll) return false;
  corpses.push({ rig: soldier.rig, ragdoll: soldier.ragdoll, age: 0 });
  while (corpses.length > MAX_CORPSES) {
    const old = corpses.shift();
    if (!old) break;
    scene.remove(old.rig.root);
    old.rig.mixer.stopAllAction();
  }
  return true;
}

export function clearAllCorpses(): void {
  for (const c of corpses) scene.remove(c.rig.root);
  corpses.length = 0;
}

function updateCorpses(dt: number): void {
  for (const c of corpses) {
    if (c.age >= CORPSE_SETTLE_TIME) continue;
    c.age += dt;
    c.ragdoll.step(dt);
    applyRagdollToSoldierRig(c.rig, c.ragdoll);
  }
}

export function updateBallisticsAndProps(dt: number): void {
  updateCorpses(dt);
  updateProjectiles(dt);
  updateActiveSmokes(dt);
  updateDebris(dt);
  // Tracers
  for (let i = activeTracers.length - 1; i >= 0; i--) {
    const t = activeTracers[i];
    t.life -= dt;
    t.mesh.position.addScaledVector(t.dir, t.speed * dt);
    t.mesh.material.opacity = Math.max(0, t.life / 0.28);
    if (t.life <= 0) {
      scene.remove(t.mesh);
      t.mesh.geometry.dispose();
      t.mesh.material.dispose();
      activeTracers.splice(i, 1);
    }
  }

  // Sparks
  for (let i = activeSparks.length - 1; i >= 0; i--) {
    const s = activeSparks[i];
    s.life -= dt;
    s.vel.y -= 18 * dt;
    s.mesh.position.addScaledVector(s.vel, dt);
    if (s.life <= 0) {
      scene.remove(s.mesh);
      s.mesh.geometry.dispose();
      s.mesh.material.dispose();
      activeSparks.splice(i, 1);
    }
  }

  // Dropped Tumbling Weapons
  for (let i = droppedWeapons.length - 1; i >= 0; i--) {
    const w = droppedWeapons[i];
    w.life -= dt;
    w.vel.y -= 20 * dt;
    w.mesh.position.addScaledVector(w.vel, dt);
    w.mesh.rotation.x += w.angVel.x * dt;
    w.mesh.rotation.y += w.angVel.y * dt;
    w.mesh.rotation.z += w.angVel.z * dt;

    const floorY = getFloorHeightAt(w.mesh.position.x, w.mesh.position.z, w.mesh.position.y + 0.2);
    if (w.mesh.position.y < floorY + 0.08) {
      w.mesh.position.y = floorY + 0.08;
      w.vel.y = Math.abs(w.vel.y) * 0.25;
      w.vel.x *= 0.65;
      w.vel.z *= 0.65;
      w.angVel.multiplyScalar(0.55);
    }

    if (w.life <= 0) {
      scene.remove(w.mesh);
      droppedWeapons.splice(i, 1);
    }
  }
}

// =========================================================================
// 10. 12-OPERATOR 6v6 ROSTER (HUMAN ALPHA-LEAD + 5 ALPHA AI + 6 BRAVO AI)
