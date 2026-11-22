import * as THREE from 'three';
import { sfx } from '../audio/SoundFX';
import { damageSoldier } from '../game/damage';
import { allSoldiers, game, weaponRecoilOffset } from '../game/state';
import { net } from '../net/net';
import type { ShotTrace, Soldier, WeaponDef } from '../types';
import { updateWeaponHUD } from '../ui/hud';
import { $ } from '../util/dom';
import { weaponOf } from '../weapons/defs';
import { muzzleFlashMesh, muzzlePointLight } from '../weapons/viewmodel';
import { raycastMap } from '../world/collision';
import { damageDestructible } from './destructibles';
import { spawnBulletTracer, spawnImpactSparks } from './effects';

interface PelletHit {
  dmg: number;
  headHits: number;
  point: THREE.Vector3;
  dir: THREE.Vector3;
}

function falloffMult(w: WeaponDef, dist: number): number {
  const f = w.falloff;
  if (!f || dist <= f.start) return 1;
  const t = Math.min(1, (dist - f.start) / (f.end - f.start));
  return 1 - (1 - f.min) * t;
}

// One ray: walls first, then head sphere + body cylinder of every enemy
function traceShot(shooter: Soldier, origin: THREE.Vector3, shotDir: THREE.Vector3): ShotTrace {
  const mapHit = raycastMap(origin, shotDir, 135);
  let bestDist = mapHit.distance;
  let hitTarget: Soldier | null = null;
  let hitPoint = origin.clone().addScaledVector(shotDir, bestDist);
  let isHeadshot = false;
  let bodyPart: ShotTrace['bodyPart'] = null;

  const HEAD_RADIUS = 0.15;
  const HEAD_HEIGHT = 1.66;
  const BODY_RADIUS = 0.34;
  const BODY_TOP = 1.5;
  for (let i = 0; i < allSoldiers.length; i++) {
    const candidate = allSoldiers[i];
    if (!candidate.alive || candidate.team === shooter.team) continue;

    const cr = candidate.crouch || 0;
    const headC = new THREE.Vector3(
      candidate.pos.x,
      candidate.pos.y + HEAD_HEIGHT - 0.55 * cr,
      candidate.pos.z,
    );
    const tHead = new THREE.Vector3().subVectors(headC, origin).dot(shotDir);
    if (tHead > 0 && tHead < bestDist) {
      const pt = origin.clone().addScaledVector(shotDir, tHead);
      if (pt.distanceTo(headC) <= HEAD_RADIUS) {
        bestDist = tHead;
        hitTarget = candidate;
        hitPoint = pt;
        isHeadshot = true;
        bodyPart = 'upper';
        continue;
      }
    }

    const dx = candidate.pos.x - origin.x;
    const dz = candidate.pos.z - origin.z;
    const hLen2 = shotDir.x * shotDir.x + shotDir.z * shotDir.z;
    if (hLen2 < 1e-6) continue;
    const tBody = (dx * shotDir.x + dz * shotDir.z) / hLen2;
    if (tBody < 0 || tBody >= bestDist) continue;
    const pt = origin.clone().addScaledVector(shotDir, tBody);
    const horizDist = Math.hypot(pt.x - candidate.pos.x, pt.z - candidate.pos.z);
    if (
      horizDist <= BODY_RADIUS &&
      pt.y >= candidate.pos.y &&
      pt.y <= candidate.pos.y + BODY_TOP - 0.5 * cr
    ) {
      bestDist = tBody;
      hitTarget = candidate;
      hitPoint = pt;
      isHeadshot = false;
      // Upper torso / chest counts as “upper body and up” for high-powered rifles.
      bodyPart = pt.y >= candidate.pos.y + 0.98 - 0.48 * cr ? 'upper' : 'lower';
    }
  }
  return { mapHit, bestDist, hitTarget, hitPoint, isHeadshot, bodyPart };
}

export function fireWeapon(
  shooter: Soldier,
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  spread = 0.008,
): boolean {
  const w = weaponOf(shooter);
  if (shooter.fireCooldown > 0) return false;
  if (shooter.reloading) {
    // Shell-by-shell reloads (shotgun) can be interrupted by firing
    if (w.shell && shooter.magAmmo > 0) {
      shooter.reloading = false;
      shooter.reloadTimer = 0;
      if (shooter.isPlayer) $('reload-bar-wrap').classList.add('hidden');
    } else {
      return false;
    }
  }
  if (shooter.magAmmo <= 0) {
    startReload(shooter);
    return false;
  }

  shooter.magAmmo -= 1;
  shooter.fireCooldown = w.cooldown;

  const adsNow = shooter.isPlayer && game.isADS;
  const jitter = spread + (w.pelletSpread || 0) * (adsNow ? 0.65 : 1);

  // Muzzle origin for tracers / flash / audio
  let muzzleWorld = origin.clone().addScaledVector(dir, 0.55);
  if (shooter.isPlayer) {
    muzzleFlashMesh.getWorldPosition(muzzleWorld);
    muzzleFlashMesh.visible = true;
    muzzleFlashMesh.rotation.z = Math.random() * Math.PI;
    muzzlePointLight.intensity = 1.1;
    weaponRecoilOffset.z = 0.055 * w.kick;
    weaponRecoilOffset.pitch = 0.042 * w.kick;
    sfx.playGunshot(true, 0, shooter.weaponId);
    updateWeaponHUD();
  } else {
    const distToPlayer = shooter.pos.distanceTo(game.humanPlayer.pos);
    sfx.playGunshot(false, distToPlayer, shooter.weaponId, shooter.pos);
  }

  // Pellet loop (1 for rifles, 9 for shotgun). Damage is summed per target.
  const hits = new Map<Soldier, PelletHit>();
  for (let p = 0; p < w.pellets; p++) {
    const shotDir = dir.clone();
    shotDir.x += (Math.random() - 0.5) * jitter;
    shotDir.y += (Math.random() - 0.5) * jitter;
    shotDir.z += (Math.random() - 0.5) * jitter;
    shotDir.normalize();

    const r = traceShot(shooter, origin, shotDir);
    spawnBulletTracer(muzzleWorld, r.hitPoint, shooter.team);
    if (net.active && net.owns(shooter) && p < 3) {
      net.send({
        t: 'f',
        id: shooter.id,
        o: net.v3(muzzleWorld),
        e: net.v3(r.hitPoint),
        w: !r.hitTarget && r.mapHit.hit ? 1 : 0,
        q: p > 0 ? 1 : 0,
      });
    }

    if (r.hitTarget) {
      const dmg =
        (r.isHeadshot ? w.head : r.bodyPart === 'upper' && w.upper ? w.upper : w.dmg) *
        falloffMult(w, r.bestDist);
      let e = hits.get(r.hitTarget);
      if (!e) {
        e = { dmg: 0, headHits: 0, point: r.hitPoint, dir: shotDir };
        hits.set(r.hitTarget, e);
      }
      e.dmg += dmg;
      if (r.isHeadshot) e.headHits += 1;
    } else if (r.mapHit.hit) {
      spawnImpactSparks(r.hitPoint, false);
      if (r.mapHit.collider) damageDestructible(r.mapHit.collider, Math.max(18, w.dmg * 0.7), r.hitPoint);
    }
  }

  for (const [target, e] of hits) {
    const hs = w.pellets > 1 ? e.headHits >= 3 : e.headHits >= 1;
    damageSoldier(target, shooter, Math.max(1, Math.round(e.dmg)), e.point, e.dir, hs);
  }

  if (shooter.magAmmo === 0) {
    startReload(shooter);
  }
  return true;
}

// 11b. THROWABLES + DESTRUCTIBLE COVER

export function startReload(soldier: Soldier): void {
  const w = weaponOf(soldier);
  if (soldier.reloading || soldier.magAmmo >= w.mag || soldier.reserveAmmo <= 0) return;
  soldier.reloading = true;
  soldier.reloadTimer = w.shell ? w.shellTime : w.reload;
  soldier.reloadTotal = soldier.reloadTimer;
  if (soldier.isPlayer) {
    sfx.playReload();
    $('reload-bar-wrap').classList.remove('hidden');
  }
}

export function updateReload(soldier: Soldier, dt: number): void {
  if (!soldier.reloading) return;
  const w = weaponOf(soldier);
  soldier.reloadTimer -= dt;
  if (soldier.isPlayer) {
    const frac = THREE.MathUtils.clamp(1 - soldier.reloadTimer / (soldier.reloadTotal || w.reload), 0, 1);
    const pct = w.shell ? ((soldier.magAmmo + frac) / w.mag) * 100 : frac * 100;
    $('reload-bar').style.width = `${THREE.MathUtils.clamp(pct, 0, 100)}%`;
  }
  if (soldier.reloadTimer > 0) return;

  if (w.shell) {
    soldier.magAmmo += 1;
    soldier.reserveAmmo -= 1;
    if (soldier.isPlayer) updateWeaponHUD();
    if (soldier.magAmmo < w.mag && soldier.reserveAmmo > 0) {
      soldier.reloadTimer = w.shellTime;
      soldier.reloadTotal = w.shellTime;
      return;
    }
    soldier.reloading = false;
    if (soldier.isPlayer) $('reload-bar-wrap').classList.add('hidden');
    return;
  }

  soldier.reloading = false;
  const needed = w.mag - soldier.magAmmo;
  const take = Math.min(needed, soldier.reserveAmmo);
  soldier.magAmmo += take;
  soldier.reserveAmmo -= take;
  if (soldier.isPlayer) {
    $('reload-bar-wrap').classList.add('hidden');
    updateWeaponHUD();
  }
}

// =========================================================================
