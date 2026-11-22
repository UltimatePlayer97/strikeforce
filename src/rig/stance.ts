import * as THREE from 'three';
import { CROUCH_BLEND_RATE, STANCE_CLIP_SPEED, STANCE_CROUCH_DROP } from '../config';
import type { Soldier, SoldierRig, StanceRigData } from '../types';

const _stanceDown = new THREE.Vector3(0, -1, 0);
const _stanceQA = new THREE.Quaternion();
const _stanceQB = new THREE.Quaternion();
const _stanceQC = new THREE.Quaternion();
const _stanceVA = new THREE.Vector3();
const _stanceVB = new THREE.Vector3();
const _stanceVC = new THREE.Vector3();
const _stanceVD = new THREE.Vector3();
const _stanceVE = new THREE.Vector3();
const _stanceVF = new THREE.Vector3();
const _stanceVG = new THREE.Vector3();
const _stanceUp = new THREE.Vector3(0, 1, 0);
const _stanceWeaponTilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.05);
const _stanceFlipY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

// World-space orientation a carried rifle should hold: muzzle down the model's
// forward axis, top rail up, with a slight muzzle dip.
export function rifleCarryWorldQuat(rig: SoldierRig, target: THREE.Quaternion): THREE.Quaternion {
  rig.root.getWorldQuaternion(target);
  if (!rig.isGLB) target.multiply(_stanceFlipY);
  return target.multiply(_stanceWeaponTilt);
}

export function createStanceRigData(rig: SoldierRig, clips: THREE.AnimationClip[]): StanceRigData {
  const { root, bones } = rig;
  const forward = rig.isGLB ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 0, 1);
  const data: StanceRigData = { legs: [], hips: bones.mixamorigHips || null, forward, fixedBones: [] };
  if (!data.hips) return data;

  // Bones our stance code poses but the clips may not animate must be reset each
  // frame, otherwise repeated crouch/arm poses would compound on themselves.
  const animatedNames = new Set<string>();
  for (const clip of clips || [])
    for (const track of clip.tracks) animatedNames.add(track.name.split('.')[0]);
  const trackFixedBone = (bone: THREE.Bone | undefined): void => {
    if (!bone || animatedNames.has(bone.name)) return;
    data.fixedBones.push({ bone, quat: bone.quaternion.clone(), position: bone.position.clone() });
  };
  trackFixedBone(data.hips);

  root.updateMatrixWorld(true);

  for (const side of ['Left', 'Right'] as const) {
    const hip = bones['mixamorig' + side + 'UpLeg'];
    const knee = bones['mixamorig' + side + 'Leg'];
    const ankle = bones['mixamorig' + side + 'Foot'];
    if (!hip || !knee || !ankle) continue;

    const thigh = hip.getWorldPosition(_stanceVA).distanceTo(knee.getWorldPosition(_stanceVB));
    const shin = knee.getWorldPosition(_stanceVA).distanceTo(ankle.getWorldPosition(_stanceVB));

    data.legs.push({
      hip,
      knee,
      ankle,
      thigh,
      shin,
      side,
      restFootWorld: ankle.getWorldQuaternion(new THREE.Quaternion()),
    });
    trackFixedBone(hip);
    trackFixedBone(knee);
    trackFixedBone(ankle);
  }

  for (const name of [
    'Spine1',
    'RightArm',
    'RightForeArm',
    'RightHand',
    'LeftArm',
    'LeftForeArm',
    'LeftHand',
  ]) {
    trackFixedBone(bones['mixamorig' + name]);
  }
  return data;
}

export function resetStanceBones(rig: SoldierRig): void {
  const data = rig.stance;
  if (!data || !data.fixedBones) return;
  for (const entry of data.fixedBones) {
    entry.bone.quaternion.copy(entry.quat);
    entry.bone.position.copy(entry.position);
  }
}

export function updateSoldierCrouch(s: Soldier, dt: number): void {
  const target = s.stanceTarget || 0;
  const cur = s.crouch || 0;
  if (Math.abs(target - cur) < 0.001) {
    s.crouch = target;
    return;
  }
  s.crouch = cur + (target - cur) * Math.min(1, dt * CROUCH_BLEND_RATE);
}

export function updateRigLocomotion(rig: SoldierRig, speed: number, crouch: number): void {
  const actions = rig.actions;
  if (!actions || !actions.Idle) return;

  let target = 'Idle';
  let refSpeed = 0;
  if (speed > 0.45) {
    const crouched = (crouch || 0) > 0.5;
    if (!crouched && speed > 2.6 && actions.Run) {
      target = 'Run';
      refSpeed = STANCE_CLIP_SPEED.Run;
    } else {
      target = actions.Walk ? 'Walk' : 'Idle';
      refSpeed = crouched ? STANCE_CLIP_SPEED.CrouchWalk : STANCE_CLIP_SPEED.Walk;
    }
  }

  if (rig.locomotionClip !== target) {
    const next = actions[target];
    if (next) {
      const prev = actions[rig.locomotionClip];
      next.reset();
      next.setEffectiveWeight(1);
      next.setEffectiveTimeScale(1);
      next.fadeIn(0.16).play();
      if (prev && prev !== next) prev.fadeOut(0.16);
      rig.locomotionClip = target;
    }
  }

  const act = actions[rig.locomotionClip];
  if (act) {
    const scale = refSpeed > 0 ? THREE.MathUtils.clamp(speed / refSpeed, 0.6, 1.65) : 1;
    act.setEffectiveTimeScale(scale);
  }
}

export function applyStancePose(
  rig: SoldierRig,
  crouchK: number,
  gaitSpeed: number,
  gaitPhase: number,
): void {
  const data = rig.stance;
  const k = THREE.MathUtils.clamp(crouchK || 0, 0, 1);
  if (!data || !data.legs || data.legs.length === 0 || k < 0.01) return;

  const hips = data.hips;
  const dropWorld = STANCE_CROUCH_DROP * k;
  const rootQuat = rig.root.getWorldQuaternion(_stanceQA);
  const forwardWorld = _stanceVC.copy(data.forward).applyQuaternion(rootQuat).normalize();
  const crouchStride = THREE.MathUtils.clamp((gaitSpeed || 0) / 1.6, 0, 1) * 0.4;

  // Measure the live hip-to-ankle drop before folding, so the soles keep their height
  rig.root.updateMatrixWorld(true);
  for (const leg of data.legs) {
    leg.standingGap = leg.hip.getWorldPosition(_stanceVA).y - leg.ankle.getWorldPosition(_stanceVB).y;
  }

  if (hips && hips.parent) {
    // Sink the hips down the world axis, converted into the hips' parent space
    const parentScale = Math.abs(hips.parent.getWorldScale(_stanceVA).y) || 1;
    const downLocal = _stanceVA
      .set(0, -1, 0)
      .applyQuaternion(hips.parent.getWorldQuaternion(_stanceQB).invert());
    hips.position.addScaledVector(downLocal, dropWorld / parentScale);
  }

  for (const leg of data.legs) {
    const a = leg.thigh,
      b = leg.shin;
    // Fold the knees exactly as far as the hips dropped, so the feet stay planted
    const reach = THREE.MathUtils.clamp((leg.standingGap ?? 0) - dropWorld, Math.abs(a - b) + 0.03, a + b);
    // Law of cosines: keeps the ankle planted under the hips while the knees fold
    const hipAngle = Math.acos(
      THREE.MathUtils.clamp((a * a + reach * reach - b * b) / (2 * a * reach), -1, 1),
    );
    const kneeInterior = Math.acos(
      THREE.MathUtils.clamp((a * a + b * b - reach * reach) / (2 * a * b), -1, 1),
    );
    const kneeAngle = Math.PI - kneeInterior;

    // Crouch-shuffle gait: legs still stride while moving
    const swing = Math.sin((gaitPhase || 0) + (leg.side === 'Left' ? 0 : Math.PI)) * crouchStride;
    const thighPitch = hipAngle + swing;
    const shinPitch = hipAngle - kneeAngle - swing * 0.85;

    _stanceVA
      .copy(_stanceDown)
      .multiplyScalar(Math.cos(thighPitch))
      .addScaledVector(forwardWorld, Math.sin(thighPitch))
      .normalize();
    aimRigBone(leg.hip, leg.knee, _stanceVA, k);

    _stanceVB
      .copy(_stanceDown)
      .multiplyScalar(Math.cos(shinPitch))
      .addScaledVector(forwardWorld, Math.sin(shinPitch))
      .normalize();
    aimRigBone(leg.knee, leg.ankle, _stanceVB, k);

    // Counter-rotate the foot back to its rest orientation so the sole stays flat
    leg.ankle.updateWorldMatrix(true, false);
    const ankleParent = leg.ankle.parent;
    if (!ankleParent) continue;
    const parentWorldQuat = ankleParent.getWorldQuaternion(_stanceQA);
    const rootWorldQuat = rig.root.getWorldQuaternion(_stanceQB);
    const flatLocal = parentWorldQuat.invert().multiply(rootWorldQuat.multiply(leg.restFootWorld));
    leg.ankle.quaternion.slerp(flatLocal, k);
  }
}

// Rotates a bone so its child points along a world-space direction (blended by weight)
function aimRigBone(
  bone: THREE.Object3D | undefined,
  child: THREE.Object3D | undefined,
  worldDir: THREE.Vector3,
  weight: number,
): void {
  if (!bone || !child || !bone.parent || weight <= 0.001) return;
  bone.updateWorldMatrix(true, false);
  const parentQuat = bone.parent.getWorldQuaternion(_stanceQB);
  const targetLocal = _stanceVD.copy(worldDir).applyQuaternion(parentQuat.invert()).normalize();
  const currentLocal = _stanceVE
    .copy(child.position)
    .normalize()
    .applyQuaternion(bone.quaternion)
    .normalize();
  const blended = _stanceVF.copy(currentLocal).lerp(targetLocal, weight);
  if (blended.lengthSq() < 1e-8) return;
  const delta = _stanceQC.setFromUnitVectors(currentLocal, blended.normalize());
  bone.quaternion.premultiply(delta).normalize();
}

// Rifle carry pose for AI: right elbow tucked with the forearm forward, left hand
// reaching to the handguard. Overrides the clip's arm swing so the gun stays shouldered.
export function applyCarryArmPose(rig: SoldierRig): void {
  const bones = rig.bones;
  const rArm = bones.mixamorigRightArm,
    rFore = bones.mixamorigRightForeArm,
    rHand = bones.mixamorigRightHand;
  const lArm = bones.mixamorigLeftArm,
    lFore = bones.mixamorigLeftForeArm,
    lHand = bones.mixamorigLeftHand;
  if (!rArm || !rFore || !rHand) return;

  const rootQuat = rig.root.getWorldQuaternion(_stanceQA);
  const fwd = _stanceVC
    .copy(rig.stance ? rig.stance.forward : _stanceUp)
    .applyQuaternion(rootQuat)
    .normalize();
  const right = _stanceVG.crossVectors(fwd, _stanceUp).normalize();
  const down = _stanceDown;

  _stanceVA
    .copy(down)
    .multiplyScalar(0.95)
    .addScaledVector(fwd, 0.38)
    .addScaledVector(right, 0.12)
    .normalize();
  aimRigBone(rArm, rFore, _stanceVA, 1);

  _stanceVB
    .copy(fwd)
    .multiplyScalar(0.94)
    .addScaledVector(down, 0.32)
    .addScaledVector(right, 0.12)
    .normalize();
  aimRigBone(rFore, rHand, _stanceVB, 1);

  if (!lArm || !lFore) return;
  _stanceVA
    .copy(fwd)
    .multiplyScalar(0.7)
    .addScaledVector(down, 0.55)
    .addScaledVector(right, 0.38)
    .normalize();
  aimRigBone(lArm, lFore, _stanceVA, 0.9);

  _stanceVB
    .copy(fwd)
    .multiplyScalar(0.92)
    .addScaledVector(right, 0.36)
    .addScaledVector(down, 0.1)
    .normalize();
  aimRigBone(lFore, lHand || lFore.children[0], _stanceVB, 0.9);
}

// Keeps the rifle level down the model's forward axis while the arm clip moves
export function applyWeaponStance(soldier: Soldier): void {
  const rig = soldier.rig;
  const hand = rig.bones.mixamorigRightHand;
  const holder = soldier.weaponHolder;
  if (!hand || !holder || !rig.isGLB) return;
  hand.updateWorldMatrix(true, false);
  const handWorld = hand.getWorldQuaternion(_stanceQA);
  const desired = rifleCarryWorldQuat(rig, _stanceQB);
  holder.quaternion.copy(handWorld.invert().multiply(desired));
}

export function updateSoldierRigVisual(s: Soldier, dt: number): void {
  const rig = s.rig;
  rig.root.position.copy(s.pos);
  rig.root.rotation.y = rig.isGLB ? s.yaw : s.yaw + Math.PI;
  updateSoldierCrouch(s, dt);
  const speed = Math.hypot(s.vel.x, s.vel.z);
  updateRigLocomotion(rig, speed, s.crouch);
  rig.mixer.update(dt);
  resetStanceBones(rig);
  if (s.crouch > 0.01) {
    s.gaitPhase = (s.gaitPhase || 0) + dt * speed * 4.8;
    applyStancePose(rig, s.crouch, speed, s.gaitPhase);
  }
  applyCarryArmPose(rig);
  applyWeaponStance(s);
}
