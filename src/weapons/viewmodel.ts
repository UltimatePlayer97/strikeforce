import * as THREE from 'three';
import { camera } from '../core/renderer';
import { allSoldiers, game } from '../game/state';
import type { ImportedWeaponView, Soldier, WeaponId } from '../types';
import { updateWeaponHUD } from '../ui/hud';
import { $ } from '../util/dom';
import { WEAPONS, weaponOf } from './defs';
import { createWeaponInstance } from './models';

/** Eye-to-sight distance in ADS; larger = rear of receiver/stock stays out of view. */
const ADS_SIGHT_DIST = 0.18;

// First-Person Viewmodel Weapon + Tactical Gloved Arms
export const fpWeaponRoot = new THREE.Group();
camera.add(fpWeaponRoot);

const fpWeaponMeshHolder = new THREE.Group();
fpWeaponRoot.add(fpWeaponMeshHolder);

// Stylized tactical gloved hands holding the rifle
const sleeveMat = new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.7 });
const gloveMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.55 });

const leftArmMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.036, 0.24, 4, 8), sleeveMat);
leftArmMesh.position.set(-0.08, -0.09, -0.14);
leftArmMesh.rotation.set(1.18, 0.25, -0.35);
fpWeaponRoot.add(leftArmMesh);

const leftHandMesh = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.055, 0.075), gloveMat);
leftHandMesh.position.set(-0.015, -0.035, -0.25);
fpWeaponRoot.add(leftHandMesh);

const rightArmMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.038, 0.22, 4, 8), sleeveMat);
rightArmMesh.position.set(0.09, -0.12, 0.14);
rightArmMesh.rotation.set(1.25, -0.15, 0.2);
fpWeaponRoot.add(rightArmMesh);

// Muzzle flash star
export const muzzleFlashMesh = new THREE.Mesh(
  new THREE.OctahedronGeometry(0.036, 0),
  new THREE.MeshBasicMaterial({ color: 0xfef08a, transparent: true, opacity: 0.4, depthWrite: false }),
);
muzzleFlashMesh.position.set(0, 0.022, -0.63);
muzzleFlashMesh.visible = false;
fpWeaponRoot.add(muzzleFlashMesh);

export const muzzlePointLight = new THREE.PointLight(0xfbbf24, 0, 8);
muzzlePointLight.position.set(0, 0.05, -0.68);
fpWeaponRoot.add(muzzlePointLight);

/** Per-weapon viewmodel placement. ADS pulls the weapon's sight onto screen center. */
export const weaponView = {
  hip: new THREE.Vector3(0.18, -0.17, -0.34),
  ads: new THREE.Vector3(0.0, -0.084, -0.25), // stock procedural M4A1 default
  adsDist: 0, // eye-to-sight distance (0 = no custom sight)
  glassR: 0.02, // sight window radius (world units) -> reticle ring size
  clipDepth: 0, // viewmodel clip depth in ADS: hides gun body behind the sight
};

const adsClipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
const _clipFwd = new THREE.Vector3();
const _clipPos = new THREE.Vector3();

function applyWeaponView(): void {
  const id: WeaponId = game.humanPlayer.weaponId || 'assault';
  const def = WEAPONS[id] || WEAPONS.assault;

  // Left hand slides along the handguard per weapon
  const lh = id !== 'assault' && def.view ? def.view.lhand : -0.25;
  leftHandMesh.position.z = lh;
  leftArmMesh.position.z = -0.14 + (lh + 0.25);

  if (id !== 'assault' && def.view) {
    const pv = def.view;
    weaponView.adsDist = 0;
    weaponView.clipDepth = 0;
    weaponView.hip.set(pv.hip[0], pv.hip[1], pv.hip[2]);
    weaponView.ads.set(pv.ads[0], pv.ads[1], pv.ads[2]);
    muzzleFlashMesh.position.set(pv.muzzle[0], pv.muzzle[1], pv.muzzle[2] - 0.03);
    muzzlePointLight.position.set(pv.muzzle[0], pv.muzzle[1] + 0.03, pv.muzzle[2] - 0.08);
    return;
  }

  weaponView.hip.set(0.18, -0.17, -0.34);
  const v = game.customWeaponPrototype?.userData?.view as ImportedWeaponView | undefined;
  if (!v) {
    weaponView.adsDist = 0;
    weaponView.clipDepth = 0;
    weaponView.ads.set(0.0, -0.084, -0.25);
    muzzleFlashMesh.position.set(0, 0.022, -0.63);
    muzzlePointLight.position.set(0, 0.05, -0.68);
    return;
  }
  const [sx, sy, sz] = v.sight;
  const adsD = v.adsDist || ADS_SIGHT_DIST;
  weaponView.adsDist = adsD;
  weaponView.glassR = v.glassR;
  weaponView.clipDepth = Math.max(0, adsD - v.rearOffset - 0.004);
  weaponView.ads.set(-sx, -sy, -adsD - sz);
  muzzleFlashMesh.position.set(v.muzzle[0], v.muzzle[1], v.muzzle[2] - 0.03);
  muzzlePointLight.position.set(v.muzzle[0], v.muzzle[1] + 0.02, v.muzzle[2] - 0.08);
}

export function rebuildPlayerViewmodel(): void {
  applyWeaponView();
  fpWeaponMeshHolder.clear();
  const id: WeaponId = game.humanPlayer.weaponId || 'assault';
  const fpGun = createWeaponInstance(id);
  if (id === 'assault' && game.customWeaponPrototype) {
    // Own materials for the viewmodel so ADS clipping never touches soldier guns
    fpGun.traverse((obj) => {
      const c = obj as THREE.Mesh;
      if (!c.isMesh) return;
      const clip = (m: THREE.Material): THREE.Material => {
        const k = m.clone();
        k.clippingPlanes = [adsClipPlane];
        return k;
      };
      c.material = Array.isArray(c.material) ? c.material.map(clip) : clip(c.material);
    });
  }
  fpWeaponMeshHolder.add(fpGun);
}

export function rebuildAllSoldierWeapons(): void {
  rebuildPlayerViewmodel();
  for (const soldier of allSoldiers) {
    if (soldier.weaponHolder) {
      soldier.weaponHolder.clear();
      const w = createWeaponInstance(soldier.weaponId);
      w.scale.setScalar(1.08);
      soldier.weaponHolder.add(w);
    }
  }
}

/** Give a soldier a class: refills ammo, swaps 3rd-person model (+ viewmodel for local player). */
export function equipWeapon(soldier: Soldier, requestedId: WeaponId): void {
  const id: WeaponId = WEAPONS[requestedId] ? requestedId : 'assault';
  const w = WEAPONS[id];
  soldier.weaponId = id;
  soldier.magAmmo = w.mag;
  soldier.reserveAmmo = w.reserve;
  soldier.reloading = false;
  soldier.reloadTimer = 0;
  soldier.reloadTotal = w.reload;
  soldier.fireCooldown = 0;
  soldier.burstShots = 0;
  soldier.burstLen = w.botBurst[0];
  if (soldier.weaponHolder) {
    soldier.weaponHolder.clear();
    const m = createWeaponInstance(id);
    m.scale.setScalar(1.08);
    soldier.weaponHolder.add(m);
  }
  if (soldier === game.humanPlayer) {
    rebuildPlayerViewmodel();
    $('reload-bar-wrap').classList.add('hidden');
    updateWeaponHUD();
  }
}

// ---------------------------------------------------------------------------
// ADS reticle + scope overlay + viewmodel clipping (per frame)
// ---------------------------------------------------------------------------
let adsReticle: HTMLDivElement | null = null;
let adsRingEl: SVGCircleElement | null = null;

/** HUD crosshair turns into a holo ring+dot sized to the sight window. */
export function initAdsReticle(): void {
  adsReticle = document.createElement('div');
  adsReticle.id = 'ads-reticle';
  adsReticle.style.cssText =
    'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:none;pointer-events:none;';
  adsReticle.innerHTML =
    '<svg id="ads-reticle-svg" width="120" height="120" viewBox="-60 -60 120 120" style="overflow:visible">' +
    '<circle id="ads-ring" r="30" fill="none" stroke="#ff2a2a" stroke-width="1.6" opacity="0.6"/>' +
    '<circle r="2.4" fill="#ff2a2a" style="filter:drop-shadow(0 0 3px #ff2a2a)"/>' +
    '</svg>';
  $('hud-layer').appendChild(adsReticle);
  adsRingEl = adsReticle.querySelector<SVGCircleElement>('#ads-ring');
}

export function updateViewmodelClipAndReticle(): void {
  const hp = game.humanPlayer;
  const wd = weaponOf(hp);
  const scopeOverlayEl = $('scope-overlay');
  const crosshairEl = $('crosshair-container');
  const scoped = !!(wd.scope && game.isADS && hp.alive && camera.fov < wd.adsFov + 18);
  scopeOverlayEl.style.opacity = scoped ? '1' : '0';
  if (hp.alive) fpWeaponRoot.visible = !scoped;

  // ADS blend 0..1 from how far the viewmodel has moved hip -> ads
  const total = weaponView.hip.distanceTo(weaponView.ads) || 1;
  const blend = THREE.MathUtils.clamp(1 - fpWeaponRoot.position.distanceTo(weaponView.ads) / total, 0, 1);

  if (weaponView.clipDepth > 0) {
    camera.getWorldDirection(_clipFwd);
    camera.getWorldPosition(_clipPos);
    adsClipPlane.setFromNormalAndCoplanarPoint(
      _clipFwd,
      _clipPos.addScaledVector(_clipFwd, blend * weaponView.clipDepth),
    );
  }

  const showRet = game.isADS && hp.alive && blend > 0.6 && wd.reticle && !scoped;
  if (adsReticle) adsReticle.style.display = showRet ? 'block' : 'none';
  if (showRet && adsRingEl) {
    const halfFov = THREE.MathUtils.degToRad(camera.fov) / 2;
    const dist = weaponView.adsDist || 0.3;
    const pxR = weaponView.adsDist
      ? (weaponView.glassR / dist / Math.tan(halfFov)) * (window.innerHeight / 2)
      : 16;
    adsRingEl.setAttribute('r', String(THREE.MathUtils.clamp(pxR * 0.8, 10, 55)));
    crosshairEl.style.opacity = '0';
  }
  if (scoped) crosshairEl.style.opacity = '0';
}
