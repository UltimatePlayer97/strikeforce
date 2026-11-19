import * as THREE from 'three';
import { RAGDOLL_NODE } from '../types';
import type { VerletRagdoll as VerletRagdollType } from '../types';
import { getFloorHeightAt, resolveCylinderCollision } from './collision';

export class VerletRagdoll implements VerletRagdollType {
  nodes: THREE.Vector3[] = [];
  prevNodes: THREE.Vector3[] = [];
  age = 0;
  boneLinks: number[][] = [];
  minLinks: number[][] = [];

  constructor(
    worldPos: THREE.Vector3,
    yaw: number,
    initialVel: THREE.Vector3 = new THREE.Vector3(),
    impulsePos: THREE.Vector3 | null = null,
    impulseVec: THREE.Vector3 | null = null
  ) {
    const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

    const makePt = (up: number, rOff: number, fOff: number): THREE.Vector3 => {
      return worldPos.clone()
        .add(new THREE.Vector3(0, up, 0))
        .addScaledVector(right, rOff)
        .addScaledVector(forward, fOff);
    };

    const initPositions: THREE.Vector3[] = [
      makePt(0.94,  0.00,  0.00), // pelvis
      makePt(1.38,  0.00,  0.02), // chest
      makePt(1.68,  0.00,  0.03), // head
      makePt(1.22, -0.26,  0.06), // lElbow
      makePt(1.06, -0.22,  0.24), // lHand
      makePt(1.22,  0.26,  0.08), // rElbow
      makePt(1.10,  0.18,  0.28), // rHand
      makePt(0.52, -0.11,  0.02), // lKnee
      makePt(0.08, -0.12,  0.00), // lFoot
      makePt(0.52,  0.11,  0.02), // rKnee
      makePt(0.08,  0.12,  0.00)  // rFoot
    ];

    const dt = 1 / 60;
    for (let i = 0; i < initPositions.length; i++) {
      const p = initPositions[i];
      this.nodes.push(p.clone());
      const prev = p.clone().addScaledVector(initialVel, -dt);
      this.prevNodes.push(prev);
    }

    this.boneLinks = [
      [RAGDOLL_NODE.PELVIS, RAGDOLL_NODE.CHEST, 0.44],
      [RAGDOLL_NODE.CHEST, RAGDOLL_NODE.HEAD, 0.30],
      [RAGDOLL_NODE.CHEST, RAGDOLL_NODE.L_ELBOW, 0.31],
      [RAGDOLL_NODE.L_ELBOW, RAGDOLL_NODE.L_HAND, 0.28],
      [RAGDOLL_NODE.CHEST, RAGDOLL_NODE.R_ELBOW, 0.31],
      [RAGDOLL_NODE.R_ELBOW, RAGDOLL_NODE.R_HAND, 0.28],
      [RAGDOLL_NODE.PELVIS, RAGDOLL_NODE.L_KNEE, 0.43],
      [RAGDOLL_NODE.L_KNEE, RAGDOLL_NODE.L_FOOT, 0.44],
      [RAGDOLL_NODE.PELVIS, RAGDOLL_NODE.R_KNEE, 0.43],
      [RAGDOLL_NODE.R_KNEE, RAGDOLL_NODE.R_FOOT, 0.44]
    ];

    this.minLinks = [
      [RAGDOLL_NODE.PELVIS, RAGDOLL_NODE.HEAD, 0.64],
      [RAGDOLL_NODE.L_KNEE, RAGDOLL_NODE.R_KNEE, 0.20],
      [RAGDOLL_NODE.L_ELBOW, RAGDOLL_NODE.R_ELBOW, 0.36],
      [RAGDOLL_NODE.CHEST, RAGDOLL_NODE.L_KNEE, 0.56],
      [RAGDOLL_NODE.CHEST, RAGDOLL_NODE.R_KNEE, 0.56],
      [RAGDOLL_NODE.PELVIS, RAGDOLL_NODE.L_FOOT, 0.52],
      [RAGDOLL_NODE.PELVIS, RAGDOLL_NODE.R_FOOT, 0.52]
    ];

    if (impulseVec) {
      this.applyImpulse(impulsePos || this.nodes[RAGDOLL_NODE.CHEST], impulseVec);
    }
  }

  applyImpulse(hitPoint: THREE.Vector3, impulseVec: THREE.Vector3): void {
    const dt = 1 / 60;
    for (let i = 0; i < this.nodes.length; i++) {
      const dist = this.nodes[i].distanceTo(hitPoint);
      const weight = Math.exp(-dist * 1.65);
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
      for (let i = 0; i < this.nodes.length; i++) {
        const vel = this.nodes[i].clone().sub(this.prevNodes[i]).multiplyScalar(damping);
        this.prevNodes[i].copy(this.nodes[i]);
        this.nodes[i].add(vel);
        this.nodes[i].y += gravityY * subDt * subDt;
      }

      for (let iter = 0; iter < 6; iter++) {
        for (const [a, b, len] of this.boneLinks) {
          const pa = this.nodes[a];
          const pb = this.nodes[b];
          const diff = pa.clone().sub(pb);
          const dist = diff.length();
          if (dist > 0.0001) {
            const correction = diff.multiplyScalar((dist - len) / dist * 0.5);
            pa.sub(correction);
            pb.add(correction);
          }
        }
        for (const [a, b, minLen] of this.minLinks) {
          const pa = this.nodes[a];
          const pb = this.nodes[b];
          const diff = pa.clone().sub(pb);
          const dist = diff.length();
          if (dist < minLen && dist > 0.0001) {
            const correction = diff.multiplyScalar((minLen - dist) / dist * 0.5);
            pa.add(correction);
            pb.sub(correction);
          }
        }
      }

      for (let i = 0; i < this.nodes.length; i++) {
        if (i === RAGDOLL_NODE.L_FOOT || i === RAGDOLL_NODE.R_FOOT) {
          const floorY = getFloorHeightAt(this.nodes[i].x, this.nodes[i].z);
          if (this.nodes[i].y < floorY + 0.02) {
            this.nodes[i].y = floorY + 0.02;
            this.prevNodes[i].y = this.nodes[i].y;
          }
        }
        resolveCylinderCollision(this.nodes[i], i === RAGDOLL_NODE.HEAD ? 0.14 : 0.1, 0.3);
      }
    }
    this.age += dt;
  }

  getBonePositions(): {
    head: THREE.Vector3;
    chest: THREE.Vector3;
    pelvis: THREE.Vector3;
    lHand: THREE.Vector3;
    rHand: THREE.Vector3;
    lFoot: THREE.Vector3;
    rFoot: THREE.Vector3;
  } {
    return {
      head: this.nodes[RAGDOLL_NODE.HEAD].clone(),
      chest: this.nodes[RAGDOLL_NODE.CHEST].clone(),
      pelvis: this.nodes[RAGDOLL_NODE.PELVIS].clone(),
      lHand: this.nodes[RAGDOLL_NODE.L_HAND].clone(),
      rHand: this.nodes[RAGDOLL_NODE.R_HAND].clone(),
      lFoot: this.nodes[RAGDOLL_NODE.L_FOOT].clone(),
      rFoot: this.nodes[RAGDOLL_NODE.R_FOOT].clone()
    };
  }
}