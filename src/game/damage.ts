import * as THREE from 'three';
import { sfx } from '../audio/SoundFX';
import { REGEN_DELAY, REGEN_RATE } from '../config';
import { spawnDroppedRifle, spawnImpactSparks } from '../combat/effects';
import { camera } from '../core/renderer';
import { net } from '../net/net';
import { applyRagdollToSoldierRig, RAGDOLL_NODE, VerletRagdoll } from '../physics/ragdoll';
import type { Soldier } from '../types';
import {
  addKillfeedEntry,
  showHudToast,
  showSpawnProtectionStatus,
  triggerDamageDirection,
  triggerHitmarker,
} from '../ui/feedback';
import { $ } from '../util/dom';
import { randomMapId } from '../world/mapLoader';
import { fpWeaponRoot } from '../weapons/viewmodel';
import { resetFullMatch } from './match';
import { deathCam, game, matchState } from './state';

export function eliminateSoldier(
  victim: Soldier,
  killer: Soldier | null,
  hitPoint: THREE.Vector3,
  bulletDir: THREE.Vector3,
  isHeadshot: boolean,
): void {
  if (!victim.alive) return;

  victim.alive = false;
  victim.hp = 0;
  victim.respawnTimer = 5.0;
  victim.deaths += 1;
  victim.killerName = killer ? killer.name : 'ENVIRONMENT';
  if (net.active && net.owns(victim)) {
    net.send({
      t: 'k',
      v: victim.id,
      k: killer ? killer.id : -1,
      hs: isHeadshot ? 1 : 0,
      p: net.v3(hitPoint),
      d: net.v3(bulletDir),
    });
  }

  if (killer) {
    killer.kills += 1;
    if (killer.team === 'ALPHA') matchState.alphaScore += 1;
    else matchState.bravoScore += 1;
    addKillfeedEntry(killer, victim, isHeadshot);
  }

  // Stop skeletal animation mixer so Verlet ragdoll owns all bones
  if (victim.rig.mixer) {
    victim.rig.mixer.stopAllAction();
  }
  if (victim.rig.beaconMesh) {
    victim.rig.beaconMesh.visible = false;
  }

  // Detach weapon as a tumbling physics prop
  if (victim.weaponHolder) {
    const wPos = new THREE.Vector3();
    const wQuat = new THREE.Quaternion();
    victim.weaponHolder.getWorldPosition(wPos);
    victim.weaponHolder.getWorldQuaternion(wQuat);
    victim.weaponHolder.visible = false;
    victim.rig.root.scale.y = 1;
    victim.crouch = 0;
    spawnDroppedRifle(wPos, wQuat, bulletDir.clone().multiplyScalar(4.0), victim.weaponId);
  }

  // Compute dramatic bullet momentum impulse
  const impulsePower = isHeadshot ? 13.5 : 9.8;
  const impulseVec = bulletDir
    .clone()
    .multiplyScalar(impulsePower)
    .add(new THREE.Vector3(0, isHeadshot ? 4.2 : 2.8, 0));

  // Activate full 11-node Verlet Ragdoll for both AI AND Human Player!
  victim.ragdoll = new VerletRagdoll(victim.pos, victim.yaw, victim.vel, hitPoint, impulseVec);

  if (victim.isPlayer) {
    // Transition Human Player into 3rd-Person Killcam, then spectator ragdoll cam
    fpWeaponRoot.visible = false;
    game.isADS = false;
    camera.fov = matchState.baseFieldOfView;
    camera.updateProjectionMatrix();

    victim.rig.root.visible = true;
    applyRagdollToSoldierRig(victim.rig, victim.ragdoll);

    deathCam.angle = victim.yaw + Math.PI * 0.82;
    deathCam.currentPos.copy(victim.pos).add(new THREE.Vector3(0, 1.7, 0));
    deathCam.lookTarget.copy(victim.ragdoll.nodes[RAGDOLL_NODE.CHEST]);
    deathCam.killer = killer || null;
    deathCam.killcamTimer = killer ? 3.1 : 0;

    $('crosshair-container').classList.add('hidden');
    $('death-cam-overlay').classList.remove('hidden');
    $('death-killer-text').textContent = killer
      ? `KILL CAM — Eliminated by ${victim.killerName}`
      : `Eliminated by ${victim.killerName}`;
  }

  // Check Victory Condition
  if (
    !matchState.roundOver &&
    (matchState.alphaScore >= matchState.targetKills || matchState.bravoScore >= matchState.targetKills)
  ) {
    matchState.roundOver = true;
    const winner =
      matchState.alphaScore >= matchState.targetKills ? 'TEAM ALPHA VICTORY!' : 'TEAM BRAVO VICTORY!';
    showHudToast(`${winner} — Resetting Match in 5s`, 5000);
    if (!net.active || net.isHost) {
      setTimeout(() => {
        const map = randomMapId(game.currentMapId);
        if (net.active) net.send({ t: 'reset', map });
        resetFullMatch(map);
      }, 5000);
    }
  }
}

export function regenSoldier(s: Soldier, dt: number): void {
  if (!s.alive || s.hp >= s.maxHp) return;
  s.regenWait = (s.regenWait || 0) - dt;
  if (s.regenWait > 0) return;
  s.hp = Math.min(s.maxHp, s.hp + REGEN_RATE * dt);
  if (s.isPlayer) $('damage-vignette').style.opacity = s.hp < 35 ? '0.45' : '0';
}

export function damageSoldier(
  target: Soldier,
  attacker: Soldier | null,
  damage: number,
  hitPoint: THREE.Vector3,
  bulletDir: THREE.Vector3,
  isHeadshot: boolean,
  localOnly = false,
  sourcePos: THREE.Vector3 | null = null,
): void {
  if (!target.alive) return;
  // Strict Zero Friendly Fire
  if (attacker && attacker.team === target.team) return;

  // Brief spawn protection prevents immediate respawn death camping.
  if (target.spawnProtection > 0) {
    spawnImpactSparks(hitPoint, false);
    if (target.isPlayer) showSpawnProtectionStatus(Math.ceil(target.spawnProtection));
    return;
  }

  if (net.active && !net.owns(target)) {
    // Explosion simulation fans out damage to every authoritative owner;
    // non-owners must stay silent so each victim takes the hit once.
    if (localOnly) return;
    // Target simulated elsewhere: local feedback now, owner applies real damage + announces the kill
    spawnImpactSparks(hitPoint, true);
    if (attacker && attacker.isPlayer) {
      const lethal = isHeadshot || target.hp - damage <= 0;
      triggerHitmarker(lethal);
      sfx.playHitmarker(lethal);
    }
    if (attacker && net.owns(attacker)) {
      console.log('[damageSoldier] Sending hit event:', { from: attacker.id, to: target.id, dmg: damage, hs: isHeadshot, slot: net.slot, ownsAttacker: net.owns(attacker), ownsTarget: net.owns(target) });
      net.send({
        t: 'h',
        from: attacker.id,
        to: target.id,
        d: damage,
        hs: isHeadshot ? 1 : 0,
        p: net.v3(hitPoint),
        dir: net.v3(bulletDir),
      });
    } else {
      console.log('[damageSoldier] NOT sending hit event:', { attacker: attacker?.id, netActive: net.active, ownsAttacker: attacker ? net.owns(attacker) : false, ownsTarget: net.owns(target) });
    }
    return;
  }

  target.hp = Math.max(0, target.hp - damage);
  target.regenWait = REGEN_DELAY;
  spawnImpactSparks(hitPoint, true);

  if (attacker && attacker.isPlayer) {
    const spawnProtected = target.spawnProtection > 0;
    triggerHitmarker(isHeadshot || target.hp <= 0, spawnProtected);
    sfx.playHitmarker(isHeadshot || target.hp <= 0);
  }

  if (target.isPlayer) {
    sfx.playDamageTaken();
    triggerDamageDirection(sourcePos || (attacker ? attacker.pos : hitPoint));
    const vig = $('damage-vignette');
    vig.style.opacity = '0.9';
    setTimeout(() => {
      if (target.alive) vig.style.opacity = target.hp < 35 ? '0.45' : '0';
    }, 180);
  }

  if (target.hp <= 0) {
    eliminateSoldier(target, attacker, hitPoint, bulletDir, isHeadshot);
  }
}

// =========================================================================
// 12. BALLISTIC HITSCAN + CAPSULE / HEAD HITBOX DETECTION
