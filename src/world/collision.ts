import * as THREE from 'three';
import { activeSmokes, game, mapRamps } from '../game/state';
import type { Collider, RayHit, Smoke } from '../types';
import { colliderGrid, queryColliders } from './collisionWorld';

export function getFloorHeightAt(x: number, z: number, currentFootY = 0): number {
  let floorY = 0;

  // Check ramps first
  for (let i = 0; i < mapRamps.length; i++) {
    const r = mapRamps[i];
    if (x >= r.minX - 0.15 && x <= r.maxX + 0.15 && z >= r.minZ - 0.15 && z <= r.maxZ + 0.15) {
      let t = 0;
      if (r.axis === 'z') {
        t = THREE.MathUtils.clamp((z - r.minZ) / (r.maxZ - r.minZ), 0, 1);
      } else {
        t = THREE.MathUtils.clamp((x - r.minX) / (r.maxX - r.minX), 0, 1);
      }
      const rampY = THREE.MathUtils.lerp(r.yStart, r.yEnd, t);
      if (rampY > floorY && currentFootY >= rampY - 0.65) {
        floorY = rampY;
      }
    }
  }

  // Check top surfaces of boxes / platforms
  const near = queryColliders(x - 0.1, x + 0.1, z - 0.1, z + 0.1);
  for (let i = 0; i < near.length; i++) {
    const b = near[i];
    if (x >= b.minX - 0.1 && x <= b.maxX + 0.1 && z >= b.minZ - 0.1 && z <= b.maxZ + 0.1) {
      if (b.maxY > floorY && currentFootY >= b.maxY - 0.45) {
        floorY = b.maxY;
      }
    }
  }
  return floorY;
}

export function resolveCylinderCollision(pos: THREE.Vector3, radius: number, height: number): void {
  // Keep inside arena bounds
  pos.x = THREE.MathUtils.clamp(pos.x, -game.arenaLimit, game.arenaLimit);
  pos.z = THREE.MathUtils.clamp(pos.z, -game.arenaLimit, game.arenaLimit);

  const reach = radius + 0.6;
  const near = queryColliders(pos.x - reach, pos.x + reach, pos.z - reach, pos.z + reach);
  for (let i = 0; i < near.length; i++) {
    const b = near[i];
    // Skip if character is cleanly above or below this box
    if (pos.y >= b.maxY - 0.25 || pos.y + height <= b.minY + 0.05) continue;

    const closestX = THREE.MathUtils.clamp(pos.x, b.minX, b.maxX);
    const closestZ = THREE.MathUtils.clamp(pos.z, b.minZ, b.maxZ);
    const dx = pos.x - closestX;
    const dz = pos.z - closestZ;
    const distSq = dx * dx + dz * dz;

    if (distSq < radius * radius) {
      const dist = Math.sqrt(distSq);
      if (dist > 0.0001) {
        const push = radius - dist;
        pos.x += (dx / dist) * push;
        pos.z += (dz / dist) * push;
      } else {
        // Inside box center fallback
        const penLeft = Math.abs(pos.x - b.minX);
        const penRight = Math.abs(b.maxX - pos.x);
        const penTop = Math.abs(pos.z - b.minZ);
        const penBottom = Math.abs(b.maxZ - pos.z);
        const minPen = Math.min(penLeft, penRight, penTop, penBottom);
        if (minPen === penLeft) pos.x = b.minX - radius;
        else if (minPen === penRight) pos.x = b.maxX + radius;
        else if (minPen === penTop) pos.z = b.minZ - radius;
        else pos.z = b.maxZ + radius;
      }
    }
  }
}

/** Ray vs AABB slab intersection (unrolled: this is the hottest loop in AI + ballistics). */
export function intersectRayAABB(
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  box: Collider,
  maxDist: number,
): number | null {
  let tmin = 0;
  let tmax = maxDist;

  // X slab
  if (dir.x > -1e-7 && dir.x < 1e-7) {
    if (origin.x < box.minX || origin.x > box.maxX) return null;
  } else {
    const ood = 1.0 / dir.x;
    let t1 = (box.minX - origin.x) * ood;
    let t2 = (box.maxX - origin.x) * ood;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }

  // Y slab
  if (dir.y > -1e-7 && dir.y < 1e-7) {
    if (origin.y < box.minY || origin.y > box.maxY) return null;
  } else {
    const ood = 1.0 / dir.y;
    let t1 = (box.minY - origin.y) * ood;
    let t2 = (box.maxY - origin.y) * ood;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }

  // Z slab
  if (dir.z > -1e-7 && dir.z < 1e-7) {
    if (origin.z < box.minZ || origin.z > box.maxZ) return null;
  } else {
    const ood = 1.0 / dir.z;
    let t1 = (box.minZ - origin.z) * ood;
    let t2 = (box.maxZ - origin.z) * ood;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }

  return tmin;
}

export interface SmokeHit {
  hit: boolean;
  distance: number;
  smoke?: Smoke;
}

export function raycastSmoke(origin: THREE.Vector3, dir: THREE.Vector3, maxDist = 140): SmokeHit {
  for (let i = 0; i < activeSmokes.length; i++) {
    const smoke = activeSmokes[i];
    const center = smoke.mesh.position;
    const offset = origin.clone().sub(center);
    const b = 2 * offset.dot(dir);
    const c = offset.lengthSq() - smoke.radius * smoke.radius;
    const discriminant = b * b - 4 * c;
    if (discriminant < 0) continue;
    const t = (-b - Math.sqrt(discriminant)) * 0.5;
    if (t > 0 && t < maxDist) return { hit: true, distance: t, smoke };
  }
  return { hit: false, distance: maxDist };
}

export function raycastMap(origin: THREE.Vector3, dir: THREE.Vector3, maxDist = 140): RayHit {
  let closest = maxDist;
  let hit = false;
  let collider: Collider | null = null;
  colliderGrid.traceRay(origin.x, origin.z, dir.x, dir.z, closest, (box) => {
    const t = intersectRayAABB(origin, dir, box, closest);
    if (t !== null && t < closest) {
      closest = t;
      hit = true;
      collider = box;
    }
    return closest;
  });
  // Also check ground plane y = 0
  if (dir.y < -1e-5 && origin.y > 0) {
    const tGround = -origin.y / dir.y;
    if (tGround > 0 && tGround < closest) {
      closest = tGround;
      hit = true;
      collider = null;
    }
  }
  return { hit, distance: closest, collider };
}

const _losDir = new THREE.Vector3();

export function hasLineOfSight(posA: THREE.Vector3, posB: THREE.Vector3): boolean {
  const dir = _losDir.subVectors(posB, posA);
  const dist = dir.length();
  if (dist < 0.05) return true;
  dir.divideScalar(dist);
  if (raycastSmoke(posA, dir, dist).hit) return false;
  const res = raycastMap(posA, dir, dist - 0.15);
  return !res.hit;
}

export function aabbDistanceToPoint(box: Collider, point: THREE.Vector3): number {
  const dx = Math.max(box.minX - point.x, 0, point.x - box.maxX);
  const dy = Math.max(box.minY - point.y, 0, point.y - box.maxY);
  const dz = Math.max(box.minZ - point.z, 0, point.z - box.maxZ);
  return Math.hypot(dx, dy, dz);
}
