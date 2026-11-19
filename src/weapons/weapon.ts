import * as THREE from 'three';
import type { WeaponStats, WeaponInstance, Role, HitResult, Soldier } from '../types';
import { getScene, getCamera } from '../renderer';
import { hasLineOfSight, raycastMap } from '../physics/collision';
import { sfx } from '../audio/sound';

export const WEAPON_STATS: Record<Role, WeaponStats> = {
  ASSAULT: {
    name: 'M4A1 CARBINE', kind: 'ASSAULT',
    damage: 26, headshotMult: 2.6, rpm: 780,
    spread: 1.15, adsSpread: 0.22,
    recoil: 0.55, adsRecoil: 0.18,
    mag: 30, reserve: 180, reloadMs: 2300,
    range: 75, drop: 0.0018, penetration: 0.55,
    adsZoom: 0.65, adsTime: 180,
    modelOffset: { x: 0.24, y: -0.18, z: -0.55 }
  },
  SMG: {
    name: 'MP5 SUBMACHINE', kind: 'SMG',
    damage: 19, headshotMult: 2.3, rpm: 850,
    spread: 1.45, adsSpread: 0.35,
    recoil: 0.38, adsRecoil: 0.12,
    mag: 32, reserve: 192, reloadMs: 2000,
    range: 40, drop: 0.0032, penetration: 0.38,
    adsZoom: 0.72, adsTime: 130,
    modelOffset: { x: 0.22, y: -0.16, z: -0.48 }
  },
  LMG: {
    name: 'M249 SAW', kind: 'LMG',
    damage: 29, headshotMult: 2.4, rpm: 720,
    spread: 1.75, adsSpread: 0.32,
    recoil: 0.72, adsRecoil: 0.25,
    mag: 100, reserve: 300, reloadMs: 4800,
    range: 95, drop: 0.0014, penetration: 0.72,
    adsZoom: 0.58, adsTime: 260,
    modelOffset: { x: 0.28, y: -0.22, z: -0.72 }
  },
  SHOTGUN: {
    name: 'M1014 TACTICAL', kind: 'SHOTGUN',
    damage: 13, headshotMult: 1.8, rpm: 180,
    spread: 5.2, adsSpread: 2.8,
    recoil: 1.55, adsRecoil: 0.65,
    mag: 7, reserve: 42, reloadMs: 3200,
    range: 22, drop: 0.0065, penetration: 0.22,
    adsZoom: 0.8, adsTime: 160,
    modelOffset: { x: 0.26, y: -0.2, z: -0.6 }
  },
  SNIPER: {
    name: 'M110 SASS', kind: 'SNIPER',
    damage: 78, headshotMult: 3.2, rpm: 220,
    spread: 0.08, adsSpread: 0.01,
    recoil: 1.05, adsRecoil: 0.22,
    mag: 10, reserve: 40, reloadMs: 3000,
    range: 180, drop: 0.0006, penetration: 0.95,
    adsZoom: 0.18, adsTime: 220,
    modelOffset: { x: 0.3, y: -0.24, z: -0.85 }
  }
};

export function createWeaponInstance(role: Role): WeaponInstance {
  const stats = WEAPON_STATS[role];
  return {
    stats,
    ammo: stats.mag,
    reserve: stats.reserve,
    isReloading: false,
    reloadEndTime: 0,
    lastFireTime: 0,
    fireMode: 'auto',
    burstCount: 0,
    customModel: null
  };
}

export function canFire(weapon: WeaponInstance, now: number): boolean {
  if (weapon.isReloading) return false;
  if (weapon.ammo <= 0) return false;
  const rpm = weapon.stats.rpm;
  const minInterval = 60 / rpm; // seconds per shot
  return now - weapon.lastFireTime >= minInterval;
}

export function fireWeapon(
  weapon: WeaponInstance,
  shooter: Soldier,
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  spread: number,
  now: number,
  isPlayer: boolean
): HitResult[] {
  const results: HitResult[] = [];
  const stats = weapon.stats;
  const pellets = stats.kind === 'SHOTGUN' ? 8 : 1;

  for (let p = 0; p < pellets; p++) {
    const pelletDir = direction.clone();
    if (spread > 0) {
      const spreadRad = THREE.MathUtils.degToRad(spread);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * spreadRad;
      const offset = new THREE.Vector3(
        Math.sin(phi) * Math.cos(theta),
        Math.sin(phi) * Math.sin(theta),
        Math.cos(phi)
      );
      pelletDir.add(offset).normalize();
    }

    const rayOrigin = origin.clone();
    const maxDist = stats.range;
    let currentOrigin = rayOrigin;
    let currentDir = pelletDir;
    let remainingDist = maxDist;
    let penetrationLeft = stats.penetration;
    let hitSomething = false;

    while (remainingDist > 0 && penetrationLeft > 0) {
      const hit = raycastMap(currentOrigin, currentDir, remainingDist);
      if (!hit.hit) break;

      const hitPoint = currentOrigin.clone().addScaledVector(currentDir, hit.distance);
      hitSomething = true;

      const targets = getPotentialTargets(shooter, hitPoint, 0.5);
      let bestTarget: Soldier | null = null;
      let bestDist = Infinity;

      for (const target of targets) {
        if (target === shooter || !target.isAlive) continue;
        const d = target.pos.distanceTo(hitPoint);
        if (d < bestDist) {
          bestDist = d;
          bestTarget = target;
        }
      }

      if (bestTarget && bestDist < 0.75) {
        const isHeadshot = hitPoint.y > bestTarget.pos.y + 1.2;
        const dmg = Math.floor(stats.damage * (isHeadshot ? stats.headshotMult : 1));
        results.push({ hit: true, distance: hit.distance, headshot: isHeadshot, target: bestTarget, position: hitPoint });
        penetrationLeft -= 0.35;
      } else if (hit.collider) {
        results.push({ hit: true, distance: hit.distance, headshot: false, target: null, position: hitPoint });
        penetrationLeft -= hit.collider.isPlatform ? 0.15 : 0.5;
      } else {
        results.push({ hit: true, distance: hit.distance, headshot: false, target: null, position: hitPoint });
        break;
      }

      remainingDist -= hit.distance;
      currentOrigin = hitPoint.clone().addScaledVector(currentDir, 0.1);
    }

    if (!hitSomething) {
      results.push({ hit: false, distance: maxDist, headshot: false, target: null, position: rayOrigin.clone().addScaledVector(pelletDir, maxDist) });
    }
  }

  weapon.ammo--;
  weapon.lastFireTime = now;

  sfx.playGunshot(isPlayer, 0, stats.kind, isPlayer ? null : shooter.pos);

  return results;
}

export function startReload(weapon: WeaponInstance, now: number): boolean {
  if (weapon.isReloading) return false;
  if (weapon.ammo >= weapon.stats.mag) return false;
  if (weapon.reserve <= 0) return false;

  weapon.isReloading = true;
  weapon.reloadEndTime = now + weapon.stats.reloadMs / 1000;
  sfx.playReload();
  return true;
}

export function updateReload(weapon: WeaponInstance, now: number): void {
  if (weapon.isReloading && now >= weapon.reloadEndTime) {
    const needed = weapon.stats.mag - weapon.ammo;
    const taken = Math.min(needed, weapon.reserve);
    weapon.ammo += taken;
    weapon.reserve -= taken;
    weapon.isReloading = false;
  }
}

export function getReloadProgress(weapon: WeaponInstance, now: number): number {
  if (!weapon.isReloading) return 1;
  const total = weapon.stats.reloadMs;
  const elapsed = now - (weapon.reloadEndTime - total);
  return Math.min(1, Math.max(0, elapsed / total));
}

let targetFinder: (shooter: Soldier, position: THREE.Vector3, radius: number) => Soldier[] = () => [];

function getPotentialTargets(shooter: Soldier, position: THREE.Vector3, radius: number): Soldier[] {
  return targetFinder(shooter, position, radius);
}

export function setTargetFinder(fn: (shooter: Soldier, position: THREE.Vector3, radius: number) => Soldier[]): void {
  targetFinder = fn;
}

export function createBaseWeaponModel(role: Role): THREE.Group {
  const group = new THREE.Group();
  const stats = WEAPON_STATS[role];
  const mat = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.3, metalness: 0.7 });
  const matDark = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.25, metalness: 0.8 });

  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.11, 0.38), mat);
  receiver.position.set(0, 0, -0.12);
  receiver.castShadow = true;
  group.add(receiver);

  const barrelLen = stats.kind === 'SNIPER' ? 0.55 : stats.kind === 'LMG' ? 0.48 : stats.kind === 'SHOTGUN' ? 0.38 : 0.34;
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.02, barrelLen, 12), matDark);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0, 0.05 + barrelLen / 2);
  barrel.castShadow = true;
  group.add(barrel);

  if (stats.kind !== 'SNIPER' && stats.kind !== 'SHOTGUN') {
    const handguard = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.18, 12), mat);
    handguard.rotation.x = Math.PI / 2;
    handguard.position.set(0, 0, 0.12);
    handguard.castShadow = true;
    group.add(handguard);
  }

  if (stats.kind === 'LMG') {
    const bipod = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.18), matDark);
    bipod.position.set(0, -0.07, 0.22);
    bipod.castShadow = true;
    group.add(bipod);
    const boxMag = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.22, 0.16), mat);
    boxMag.position.set(0, -0.2, -0.22);
    boxMag.castShadow = true;
    group.add(boxMag);
  } else if (stats.kind === 'SHOTGUN') {
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.32, 8), matDark);
    tube.rotation.x = Math.PI / 2;
    tube.position.set(0, -0.035, -0.02);
    tube.castShadow = true;
    group.add(tube);
  } else {
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.08), mat);
    mag.position.set(0, -0.15, -0.2);
    mag.castShadow = true;
    group.add(mag);
  }

  if (stats.kind === 'SNIPER') {
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.22, 12), matDark);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.11, -0.12);
    scope.castShadow = true;
    group.add(scope);
    const scopeLens = new THREE.Mesh(new THREE.CircleGeometry(0.028, 16), new THREE.MeshBasicMaterial({ color: 0x0a1628 }));
    scopeLens.position.set(0, 0.112, -0.22);
    scopeLens.rotation.x = -Math.PI / 2;
    group.add(scopeLens);
  }

  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.18), mat);
  stock.position.set(0, -0.02, -0.38);
  stock.castShadow = true;
  group.add(stock);

  const pistolGrip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.06), mat);
  pistolGrip.position.set(0, -0.18, -0.18);
  pistolGrip.rotation.x = -0.25;
  pistolGrip.castShadow = true;
  group.add(pistolGrip);

  return group;
}

export function applyWeaponOffset(role: Role, target: THREE.Object3D): void {
  const stats = WEAPON_STATS[role];
  if (stats.modelOffset) {
    target.position.set(stats.modelOffset.x, stats.modelOffset.y, stats.modelOffset.z);
  }
}