import * as THREE from 'three';
import { sfx } from '../audio/SoundFX';
import { fireWeapon, updateReload } from '../combat/hitscan';
import { camera } from '../core/renderer';
import { applyRagdollToSoldierRig, RAGDOLL_NODE } from '../physics/ragdoll';
import { updateSpawnProtection } from '../ui/feedback';
import { $ } from '../util/dom';
import { weaponOf } from '../weapons/defs';
import { fpWeaponRoot, muzzleFlashMesh, muzzlePointLight, weaponView } from '../weapons/viewmodel';
import { getFloorHeightAt, raycastMap, resolveCylinderCollision } from '../world/collision';
import { regenSoldier } from './damage';
import { respawnSoldier } from './match';
import { deathCam, game, keys, matchState, weaponRecoilOffset } from './state';

export function updateHumanPlayer(dt: number): void {
  if (!game.humanPlayer.alive) {
    // Orbiting 3rd-Person Death Cam watching human player's Verlet ragdoll!
    game.humanPlayer.respawnTimer -= dt;
    $('death-timer-text').textContent = `${Math.max(0, game.humanPlayer.respawnTimer).toFixed(1)}s`;

    if (game.humanPlayer.ragdoll) {
      game.humanPlayer.ragdoll.step(dt);
      applyRagdollToSoldierRig(game.humanPlayer.rig, game.humanPlayer.ragdoll);

      const chestPos = game.humanPlayer.ragdoll.nodes[RAGDOLL_NODE.CHEST];
      deathCam.killcamTimer = Math.max(0, deathCam.killcamTimer - dt);
      if (deathCam.killcamTimer > 0 && deathCam.killer) {
        const killerForward = new THREE.Vector3(
          -Math.sin(deathCam.killer.yaw),
          0,
          -Math.cos(deathCam.killer.yaw),
        );
        const shoulder = new THREE.Vector3(Math.cos(deathCam.killer.yaw), 0, -Math.sin(deathCam.killer.yaw));
        const desiredCam = deathCam.killer.pos
          .clone()
          .add(new THREE.Vector3(0, 1.42, 0))
          .addScaledVector(killerForward, -2.35)
          .addScaledVector(shoulder, 0.78);
        const camDir = new THREE.Vector3().subVectors(desiredCam, deathCam.killer.pos);
        const camDist = camDir.length() || 1;
        camDir.divideScalar(camDist);
        const wallCheck = raycastMap(
          deathCam.killer.pos.clone().add(new THREE.Vector3(0, 1.35, 0)),
          camDir,
          camDist,
        );
        if (wallCheck.hit)
          desiredCam
            .copy(deathCam.killer.pos)
            .add(new THREE.Vector3(0, 1.2, 0))
            .addScaledVector(camDir, Math.max(0.7, wallCheck.distance - 0.25));
        deathCam.currentPos.lerp(desiredCam, Math.min(1, dt * 9));
        deathCam.lookTarget.lerp(chestPos, Math.min(1, dt * 12));
        camera.position.copy(deathCam.currentPos);
        camera.lookAt(deathCam.lookTarget);
      } else {
        deathCam.angle += dt * 0.45;
        const orbitRadius = 3.2;
        const desiredCam = new THREE.Vector3(
          chestPos.x + Math.sin(deathCam.angle) * orbitRadius,
          chestPos.y + 1.45,
          chestPos.z + Math.cos(deathCam.angle) * orbitRadius,
        );

        // Prevent death cam from clipping inside walls
        const camDir = new THREE.Vector3().subVectors(desiredCam, chestPos);
        const camDist = camDir.length();
        camDir.divideScalar(camDist);
        const wallCheck = raycastMap(chestPos, camDir, camDist);
        if (wallCheck.hit) {
          desiredCam.copy(chestPos).addScaledVector(camDir, Math.max(0.7, wallCheck.distance - 0.35));
        }

        deathCam.currentPos.lerp(desiredCam, Math.min(1, dt * 8));
        deathCam.lookTarget.lerp(chestPos, Math.min(1, dt * 10));
        camera.position.copy(deathCam.currentPos);
        camera.lookAt(deathCam.lookTarget);
        if (deathCam.killer)
          $('death-killer-text').textContent = `Spectating — eliminated by ${game.humanPlayer.killerName}`;
      }
    }

    if (game.humanPlayer.respawnTimer <= 0) {
      respawnSoldier(game.humanPlayer);
    }
    return;
  }

  game.humanPlayer.fireCooldown = Math.max(0, game.humanPlayer.fireCooldown - dt);
  game.humanPlayer.grenadeCooldown = Math.max(0, (game.humanPlayer.grenadeCooldown || 0) - dt);
  game.humanPlayer.smokeCooldown = Math.max(0, (game.humanPlayer.smokeCooldown || 0) - dt);
  updateSpawnProtection(game.humanPlayer, dt);
  updateReload(game.humanPlayer, dt);
  regenSoldier(game.humanPlayer, dt);

  // Movement Input
  const forward = new THREE.Vector3(-Math.sin(game.humanPlayer.yaw), 0, -Math.cos(game.humanPlayer.yaw));
  const right = new THREE.Vector3(Math.cos(game.humanPlayer.yaw), 0, -Math.sin(game.humanPlayer.yaw));

  const moveInput = new THREE.Vector3();
  if (keys['KeyW'] || keys['ArrowUp']) moveInput.add(forward);
  if (keys['KeyS'] || keys['ArrowDown']) moveInput.sub(forward);
  if (keys['KeyD'] || keys['ArrowRight']) moveInput.add(right);
  if (keys['KeyA'] || keys['ArrowLeft']) moveInput.sub(right);

  const isMoving = moveInput.lengthSq() > 0.001;
  if (isMoving) moveInput.normalize();

  // Crouch (hold C). Stand-up blocked while something is overhead.
  const wantCrouch = !!keys['KeyC'];
  let crouchTarget = wantCrouch ? 1 : 0;
  if (!wantCrouch && (game.humanPlayer.crouch || 0) > 0.05) {
    const headRay = raycastMap(
      new THREE.Vector3(game.humanPlayer.pos.x, game.humanPlayer.pos.y + 1.0, game.humanPlayer.pos.z),
      new THREE.Vector3(0, 1, 0),
      0.85,
    );
    if (headRay.hit) crouchTarget = 1;
  }
  game.humanPlayer.crouch = THREE.MathUtils.lerp(
    game.humanPlayer.crouch || 0,
    crouchTarget,
    Math.min(1, dt * 11),
  );
  const crouchK = game.humanPlayer.crouch;
  const isCrouched = crouchK > 0.5;

  const isSprinting =
    (keys['ShiftLeft'] || keys['ShiftRight']) &&
    isMoving &&
    !game.isADS &&
    !game.humanPlayer.reloading &&
    !isCrouched;
  if (isMoving && game.humanPlayer.onGround) {
    game.humanPlayer.footstepTimer = (game.humanPlayer.footstepTimer || 0) - dt * (isSprinting ? 2.45 : 1.55);
    if (game.humanPlayer.footstepTimer <= 0) {
      sfx.playFootstep(game.humanPlayer.pos, isCrouched ? 0.45 : isSprinting ? 1.25 : 0.9);
      game.humanPlayer.footstepTimer = 1;
    }
  }
  const pw = weaponOf(game.humanPlayer);
  const moveSpeed =
    (isSprinting ? 10.6 : game.isADS ? 4.8 : 7.4) *
    pw.speed *
    (game.isADS && pw.scope ? 0.6 : 1) *
    (1 - 0.45 * crouchK);

  game.humanPlayer.vel.x = moveInput.x * moveSpeed;
  game.humanPlayer.vel.z = moveInput.z * moveSpeed;

  // Jump & Gravity
  if (keys['Space'] && game.humanPlayer.onGround && !isCrouched) {
    game.humanPlayer.vel.y = 7.8;
    game.humanPlayer.onGround = false;
  }
  game.humanPlayer.vel.y -= 21.0 * dt;

  game.humanPlayer.pos.addScaledVector(game.humanPlayer.vel, dt);
  resolveCylinderCollision(game.humanPlayer.pos, 0.42, 1.8 - 0.6 * crouchK);

  const floorY = getFloorHeightAt(
    game.humanPlayer.pos.x,
    game.humanPlayer.pos.z,
    game.humanPlayer.pos.y + 0.35,
  );
  if (game.humanPlayer.pos.y <= floorY) {
    game.humanPlayer.pos.y = floorY;
    game.humanPlayer.vel.y = 0;
    game.humanPlayer.onGround = true;
  } else {
    game.humanPlayer.onGround = false;
  }

  // First-Person Eye Camera Transform
  const eyeHeight = 1.65 - 0.6 * crouchK;
  camera.position.set(game.humanPlayer.pos.x, game.humanPlayer.pos.y + eyeHeight, game.humanPlayer.pos.z);
  if (game.screenShake > 0) {
    const shakeTime = performance.now() * 0.052;
    camera.position.x += Math.sin(shakeTime * 1.31) * game.screenShake;
    camera.position.y += Math.cos(shakeTime * 1.73) * game.screenShake * 0.62;
    game.screenShake = Math.max(0, game.screenShake - dt * 0.42);
  }
  const euler = new THREE.Euler(
    game.humanPlayer.pitch + weaponRecoilOffset.pitch * 0.45,
    game.humanPlayer.yaw,
    0,
    'YXZ',
  );
  camera.quaternion.setFromEuler(euler);

  // Smooth ADS FOV Zoom
  const baseFov = matchState.baseFieldOfView || 75;
  const targetFov = game.isADS ? pw.adsFov : isSprinting ? Math.min(105, baseFov + 5) : baseFov;
  camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, Math.min(1, dt * 14));
  camera.updateProjectionMatrix();

  // Viewmodel Position (Hipfire vs Centered Holographic ADS + Bobbing + Reload Tilt)
  const bobScale = matchState.cameraBob ? 1 : 0;
  if (isMoving && game.humanPlayer.onGround && bobScale) {
    game.bobTimer += dt * (isSprinting ? 13 : 8.5);
  } else if (bobScale) {
    game.bobTimer += dt * 1.5;
  }

  const bobX = isMoving ? Math.cos(game.bobTimer * 0.5) * (game.isADS ? 0.002 : 0.011) * bobScale : 0;
  const bobY = isMoving
    ? Math.abs(Math.sin(game.bobTimer)) * (game.isADS ? 0.002 : 0.012) * bobScale
    : Math.sin(game.bobTimer) * 0.002 * bobScale;

  const targetWeaponPos = game.isADS ? weaponView.ads : weaponView.hip; // ads auto-aligned to sight

  weaponRecoilOffset.z = THREE.MathUtils.lerp(weaponRecoilOffset.z, 0, Math.min(1, dt * 16));
  weaponRecoilOffset.pitch = THREE.MathUtils.lerp(weaponRecoilOffset.pitch, 0, Math.min(1, dt * 14));

  fpWeaponRoot.position.lerp(
    new THREE.Vector3(
      targetWeaponPos.x + bobX,
      targetWeaponPos.y - bobY,
      targetWeaponPos.z + weaponRecoilOffset.z,
    ),
    Math.min(1, dt * 16),
  );

  const reloadRoll = game.humanPlayer.reloading
    ? Math.sin((1 - game.humanPlayer.reloadTimer / (game.humanPlayer.reloadTotal || 1.75)) * Math.PI) * 0.55
    : 0;
  const sprintPitch = isSprinting ? -0.26 : 0;
  fpWeaponRoot.rotation.set(
    weaponRecoilOffset.pitch + sprintPitch - reloadRoll * 0.4,
    isSprinting ? 0.35 : 0,
    reloadRoll,
  );

  // Decay Muzzle Flash
  if (muzzleFlashMesh.visible) {
    muzzlePointLight.intensity = Math.max(0, muzzlePointLight.intensity - dt * 24);
    if (muzzlePointLight.intensity <= 0.1) muzzleFlashMesh.visible = false;
  }

  // Dynamic Crosshair Spread
  const spreadPx = game.isADS
    ? 4
    : (isSprinting ? 22 : isMoving ? 15 : 9) * pw.chScale + weaponRecoilOffset.z * 140;
  $('ch-top').style.transform = `translateY(${-spreadPx}px)`;
  $('ch-bottom').style.transform = `translateY(${spreadPx}px)`;
  $('ch-left').style.transform = `translateX(${-spreadPx}px)`;
  $('ch-right').style.transform = `translateX(${spreadPx}px)`;
  $('crosshair-container').style.opacity = game.isADS ? '0.25' : '1';

  // Full-auto: hold LMB. Semi / bolt / pump: one shot per click (180ms click buffer)
  const nowMs = performance.now();
  let wantsShot = pw.auto ? game.isMouseDown : game.pendingShotTime > 0 && nowMs - game.pendingShotTime < 180;
  if (isSprinting) {
    wantsShot = false;
    game.pendingShotTime = 0;
  } // no firing while sprinting
  if (wantsShot && !matchState.paused) {
    const shootDir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const spread =
      (game.isADS ? pw.spreadAds : isMoving ? pw.spreadMove : pw.spreadHip) * (1 - 0.3 * crouchK);
    if (fireWeapon(game.humanPlayer, camera.position.clone(), shootDir, spread)) game.pendingShotTime = 0;
  }
}

// =========================================================================
// 14. AI BOT TACTICAL BRAIN (A* GRAPH PATHFINDING + WHISKER AVOIDANCE)
// =========================================================================
