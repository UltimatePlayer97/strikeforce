import * as THREE from 'three';
import { getFloorHeightAt } from '../world/collision';
import { queryColliders } from '../world/collisionWorld';
import type { SoldierRig } from '../types';

/*
  11 Anatomical Verlet Nodes:
  0: pelvis   1: chest    2: head
  3: lElbow   4: lHand    5: rElbow   6: rHand
  7: lKnee    8: lFoot    9: rKnee    10: rFoot
*/
export const RAGDOLL_NODE = {
  PELVIS: 0,
  CHEST: 1,
  HEAD: 2,
  L_ELBOW: 3,
  L_HAND: 4,
  R_ELBOW: 5,
  R_HAND: 6,
  L_KNEE: 7,
  L_FOOT: 8,
  R_KNEE: 9,
  R_FOOT: 10,
} as const;

export class VerletRagdoll {
  nodes: THREE.Vector3[] = [];
  prevNodes: THREE.Vector3[] = [];
  age = 0;
  private readonly boneLinks: ReadonlyArray<readonly [number, number, number]>;
  private readonly minLinks: ReadonlyArray<readonly [number, number, number]>;

  constructor(
    worldPos: THREE.Vector3,
    yaw: number,
    initialVel: THREE.Vector3 = new THREE.Vector3(),
    impulsePos: THREE.Vector3 | null = null,
    impulseVec: THREE.Vector3 | null = null,
  ) {
    const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

    const makePt = (up: number, rOff: number, fOff: number): THREE.Vector3 => {
      return worldPos
        .clone()
        .add(new THREE.Vector3(0, up, 0))
        .addScaledVector(right, rOff)
        .addScaledVector(forward, fOff);
    };

    // Standing anatomical bind pose matching Soldier skeleton proportions
    const initPositions = [
      makePt(0.94, 0.0, 0.0), // 0: pelvis
      makePt(1.38, 0.0, 0.02), // 1: chest
      makePt(1.68, 0.0, 0.03), // 2: head
      makePt(1.22, -0.26, 0.06), // 3: lElbow
      makePt(1.06, -0.22, 0.24), // 4: lHand
      makePt(1.22, 0.26, 0.08), // 5: rElbow
      makePt(1.1, 0.18, 0.28), // 6: rHand
      makePt(0.52, -0.11, 0.02), // 7: lKnee
      makePt(0.08, -0.12, 0.0), // 8: lFoot
      makePt(0.52, 0.11, 0.02), // 9: rKnee
      makePt(0.08, 0.12, 0.0), // 10: rFoot
    ];

    const dt = 1 / 60;
    for (let i = 0; i < initPositions.length; i++) {
      const p = initPositions[i];
      this.nodes.push(p.clone());
      // Encode initial velocity via prevNodes
      const prev = p.clone().addScaledVector(initialVel, -dt);
      this.prevNodes.push(prev);
    }

    // Primary skeletal bone distance constraints
    this.boneLinks = [
      [0, 1, 0.44], // pelvis - chest
      [1, 2, 0.3], // chest - head
      [1, 3, 0.31], // chest - lElbow
      [3, 4, 0.28], // lElbow - lHand
      [1, 5, 0.31], // chest - rElbow
      [5, 6, 0.28], // rElbow - rHand
      [0, 7, 0.43], // pelvis - lKnee
      [7, 8, 0.44], // lKnee - lFoot
      [0, 9, 0.43], // pelvis - rKnee
      [9, 10, 0.44], // rKnee - rFoot
    ];

    // Minimum-distance anatomical posture constraints (prevents unnatural self-folding)
    this.minLinks = [
      [0, 2, 0.64], // pelvis <-> head min length
      [7, 9, 0.2], // knees apart
      [3, 5, 0.36], // elbows apart
      [1, 7, 0.56], // chest <-> lKnee
      [1, 9, 0.56], // chest <-> rKnee
      [0, 8, 0.52], // pelvis <-> lFoot
      [0, 10, 0.52], // pelvis <-> rFoot
    ];

    if (impulseVec) {
      this.applyImpulse(impulsePos || this.nodes[1], impulseVec);
    }
  }

  applyImpulse(hitPoint: THREE.Vector3, impulseVec: THREE.Vector3): void {
    const dt = 1 / 60;
    for (let i = 0; i < this.nodes.length; i++) {
      const dist = this.nodes[i].distanceTo(hitPoint);
      const weight = Math.exp(-dist * 1.65);
      // Shift prevNodes backward to inject instantaneous linear impulse
      this.prevNodes[i].addScaledVector(impulseVec, -dt * (0.35 + 0.95 * weight));
    }
  }

  step(dt: number): void {
    const clampedDt = Math.min(dt, 0.033);
    const substeps = 3;
    const subDt = clampedDt / substeps;
    const gravityY = -22.0;
    const damping = 0.992;

    for (let s = 0; s < substeps; s++) {
      // 1. Verlet integration
      for (let i = 0; i < this.nodes.length; i++) {
        const curr = this.nodes[i];
        const prev = this.prevNodes[i];

        const vx = (curr.x - prev.x) * damping;
        const vy = (curr.y - prev.y) * damping;
        const vz = (curr.z - prev.z) * damping;

        prev.copy(curr);
        curr.x += vx;
        curr.y += vy + gravityY * subDt * subDt;
        curr.z += vz;
      }

      // 2. Iterative Constraint Solver (6 passes per substep)
      for (let iter = 0; iter < 6; iter++) {
        // Exact bone lengths
        for (let l = 0; l < this.boneLinks.length; l++) {
          const [idxA, idxB, restLen] = this.boneLinks[l];
          const a = this.nodes[idxA];
          const b = this.nodes[idxB];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dz = b.z - a.z;
          const dist = Math.hypot(dx, dy, dz) || 0.0001;
          const diff = (dist - restLen) / dist;
          const corr = diff * 0.5;
          a.x += dx * corr;
          a.y += dy * corr;
          a.z += dz * corr;
          b.x -= dx * corr;
          b.y -= dy * corr;
          b.z -= dz * corr;
        }

        // Anti-collapse minimum distances
        for (let m = 0; m < this.minLinks.length; m++) {
          const [idxA, idxB, minLen] = this.minLinks[m];
          const a = this.nodes[idxA];
          const b = this.nodes[idxB];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dz = b.z - a.z;
          const dist = Math.hypot(dx, dy, dz) || 0.0001;
          if (dist < minLen) {
            const diff = (dist - minLen) / dist;
            const corr = diff * 0.45;
            a.x += dx * corr;
            a.y += dy * corr;
            a.z += dz * corr;
            b.x -= dx * corr;
            b.y -= dy * corr;
            b.z -= dz * corr;
          }
        }

        // 3. World Ground, Ramps & 3D Map AABB Obstacle Collision
        for (let i = 0; i < this.nodes.length; i++) {
          const p = this.nodes[i];
          const prev = this.prevNodes[i];
          const nodeRadius = i === 2 ? 0.13 : 0.09;

          // Arena bounds
          p.x = THREE.MathUtils.clamp(p.x, -48.5, 48.5);
          p.z = THREE.MathUtils.clamp(p.z, -48.5, 48.5);

          // Floor & Ramp height collision
          const floorY = getFloorHeightAt(p.x, p.z, p.y + 0.3);
          if (p.y < floorY + nodeRadius) {
            p.y = floorY + nodeRadius;
            // Ground friction
            prev.x = THREE.MathUtils.lerp(prev.x, p.x, 0.24);
            prev.z = THREE.MathUtils.lerp(prev.z, p.z, 0.24);
          }

          // Map Wall / Crate AABB Pushout
          const nearColliders = queryColliders(
            p.x - nodeRadius - 0.6,
            p.x + nodeRadius + 0.6,
            p.z - nodeRadius - 0.6,
            p.z + nodeRadius + 0.6,
          );
          for (let c = 0; c < nearColliders.length; c++) {
            const b = nearColliders[c];
            if (
              p.x > b.minX - nodeRadius &&
              p.x < b.maxX + nodeRadius &&
              p.y > b.minY - nodeRadius &&
              p.y < b.maxY + nodeRadius &&
              p.z > b.minZ - nodeRadius &&
              p.z < b.maxZ + nodeRadius
            ) {
              const penMinX = Math.abs(p.x - (b.minX - nodeRadius));
              const penMaxX = Math.abs(b.maxX + nodeRadius - p.x);
              const penMaxY = Math.abs(b.maxY + nodeRadius - p.y);
              const penMinZ = Math.abs(p.z - (b.minZ - nodeRadius));
              const penMaxZ = Math.abs(b.maxZ + nodeRadius - p.z);

              const minPen = Math.min(penMinX, penMaxX, penMaxY, penMinZ, penMaxZ);
              if (minPen === penMaxY) {
                p.y = b.maxY + nodeRadius;
                prev.x = THREE.MathUtils.lerp(prev.x, p.x, 0.25);
                prev.z = THREE.MathUtils.lerp(prev.z, p.z, 0.25);
              } else if (minPen === penMinX) {
                p.x = b.minX - nodeRadius;
              } else if (minPen === penMaxX) {
                p.x = b.maxX + nodeRadius;
              } else if (minPen === penMinZ) {
                p.z = b.minZ - nodeRadius;
              } else {
                p.z = b.maxZ + nodeRadius;
              }
            }
          }
        }
      }
    }
    this.age += clampedDt;
  }
}

// Retargets the 11 Verlet ragdoll nodes directly onto a Soldier rig's bones
const _tmpVecA = new THREE.Vector3();
const _tmpVecB = new THREE.Vector3();
const _tmpVecC = new THREE.Vector3();
const _tmpQuatA = new THREE.Quaternion();
const _tmpQuatB = new THREE.Quaternion();
const _tmpMat4 = new THREE.Matrix4();

export function applyRagdollToSoldierRig(rigData: SoldierRig, ragdoll: VerletRagdoll): void {
  const { root, bones, restData } = rigData;
  const n = ragdoll.nodes;

  // Ensure root container sits at world origin with identity transform while ragdolling
  root.position.set(0, 0, 0);
  root.rotation.set(0, 0, 0);
  root.updateMatrixWorld(true);

  const hips = bones.mixamorigHips;
  if (!hips || !hips.parent) return;

  // 1. Place Hips at Pelvis node in hips.parent local space
  const pelvisLocal = hips.parent.worldToLocal(n[RAGDOLL_NODE.PELVIS].clone());
  hips.position.copy(pelvisLocal);

  // Compute torso world orientation basis (Up = pelvis->chest, Right = lKnee->rKnee)
  const upWorld = _tmpVecA.subVectors(n[RAGDOLL_NODE.CHEST], n[RAGDOLL_NODE.PELVIS]).normalize();
  const rightRaw = _tmpVecB.subVectors(n[RAGDOLL_NODE.R_KNEE], n[RAGDOLL_NODE.L_KNEE]);
  if (rightRaw.lengthSq() < 1e-5) rightRaw.set(1, 0, 0);
  rightRaw.normalize();
  const fwdWorld = _tmpVecC.crossVectors(rightRaw, upWorld).normalize();
  const rightWorld = new THREE.Vector3().crossVectors(upWorld, fwdWorld).normalize();

  _tmpMat4.makeBasis(rightWorld, upWorld, fwdWorld);
  const targetHipsWorldQuat = _tmpQuatA.setFromRotationMatrix(_tmpMat4);

  const parentWorldQuat = hips.parent.getWorldQuaternion(_tmpQuatB);
  hips.quaternion.copy(parentWorldQuat).invert().multiply(targetHipsWorldQuat);
  if (restData.hipsCorrectionQuat) {
    hips.quaternion.multiply(restData.hipsCorrectionQuat);
  }
  hips.updateMatrixWorld(true);

  // Helper to align a bone along targetWorldDir from its stored rest bone direction
  const alignBone = (boneName: string, fromNodeIdx: number, toNodeIdx: number): void => {
    const bone = bones[boneName];
    const info = restData.bones[boneName];
    if (!bone || !bone.parent || !info) return;

    const targetWorldDir = _tmpVecA.subVectors(n[toNodeIdx], n[fromNodeIdx]);
    if (targetWorldDir.lengthSq() < 1e-6) return;
    targetWorldDir.normalize();

    // Convert desired world bone direction into bone.parent's local space
    const pWorldQuat = bone.parent.getWorldQuaternion(_tmpQuatA);
    const targetLocalDir = targetWorldDir.clone().applyQuaternion(pWorldQuat.clone().invert()).normalize();

    const rotDelta = _tmpQuatB.setFromUnitVectors(info.restDirInParent, targetLocalDir);
    bone.quaternion.copy(rotDelta).multiply(info.restQuat);
    bone.updateMatrixWorld(true);
  };

  // Hierarchical top-down limb retargeting
  alignBone('mixamorigSpine1', RAGDOLL_NODE.PELVIS, RAGDOLL_NODE.CHEST);
  alignBone('mixamorigHead', RAGDOLL_NODE.CHEST, RAGDOLL_NODE.HEAD);

  alignBone('mixamorigLeftArm', RAGDOLL_NODE.CHEST, RAGDOLL_NODE.L_ELBOW);
  alignBone('mixamorigLeftForeArm', RAGDOLL_NODE.L_ELBOW, RAGDOLL_NODE.L_HAND);

  alignBone('mixamorigRightArm', RAGDOLL_NODE.CHEST, RAGDOLL_NODE.R_ELBOW);
  alignBone('mixamorigRightForeArm', RAGDOLL_NODE.R_ELBOW, RAGDOLL_NODE.R_HAND);

  alignBone('mixamorigLeftUpLeg', RAGDOLL_NODE.PELVIS, RAGDOLL_NODE.L_KNEE);
  alignBone('mixamorigLeftLeg', RAGDOLL_NODE.L_KNEE, RAGDOLL_NODE.L_FOOT);

  alignBone('mixamorigRightUpLeg', RAGDOLL_NODE.PELVIS, RAGDOLL_NODE.R_KNEE);
  alignBone('mixamorigRightLeg', RAGDOLL_NODE.R_KNEE, RAGDOLL_NODE.R_FOOT);
}

// =========================================================================
// 7. SOLDIER RIG BUILDER (GLTF Soldier.glb + Articulated Fallback Rig)
