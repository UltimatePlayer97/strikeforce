import * as THREE from 'three';
import type { AABB, Ramp } from '../types';
import { getMapColliders, getMapRamps, getArenaLimit } from '../world/map';

const _segDiff = new THREE.Vector3();
const _segDir = new THREE.Vector3();
const _segRight = new THREE.Vector3();
const _segA = new THREE.Vector3();
const _segB = new THREE.Vector3();
const _losDir = new THREE.Vector3();

export function getFloorHeightAt(x: number, z: number, currentFootY = 0): number {
  const mapRamps = getMapRamps();
  const mapColliders = getMapColliders();
  let floorY = 0;

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

  for (let i = 0; i < mapColliders.length; i++) {
    const b = mapColliders[i];
    if (x >= b.minX - 0.1 && x <= b.maxX + 0.1 && z >= b.minZ - 0.1 && z <= b.maxZ + 0.1) {
      if (b.maxY > floorY && currentFootY >= b.maxY - 0.45) {
        floorY = b.maxY;
      }
    }
  }
  return floorY;
}

export function resolveCylinderCollision(pos: THREE.Vector3, radius: number, height: number): void {
  const arenaLimit = getArenaLimit();
  pos.x = THREE.MathUtils.clamp(pos.x, -arenaLimit, arenaLimit);
  pos.z = THREE.MathUtils.clamp(pos.z, -arenaLimit, arenaLimit);

  const mapColliders = getMapColliders();
  for (let i = 0; i < mapColliders.length; i++) {
    const b = mapColliders[i];
    if (pos.y >= b.maxY - 0.25 || pos.y + height <= b.minY + 0.05) continue;

    const closestX = THREE.MathUtils.clamp(pos.x, b.minX, b.maxX);
    const closestZ = THREE.MathUtils.clamp(pos.z, b.minZ, b.maxZ);
    const dx = pos.x - closestX;
    const dz = pos.z - closestZ;
    const distSq = dx * dx + dz * dz;

    if (distSq < radius * radius) {
      const dist = Math.sqrt(distSq);
      if (dist > 0.0001) {
        const push = (radius - dist);
        pos.x += (dx / dist) * push;
        pos.z += (dz / dist) * push;
      } else {
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

export function intersectRayAABB(origin: THREE.Vector3, dir: THREE.Vector3, box: AABB, maxDist: number): number | null {
  let tmin = 0;
  let tmax = maxDist;

  if (dir.x > -1e-7 && dir.x < 1e-7) {
    if (origin.x < box.minX || origin.x > box.maxX) return null;
  } else {
    const ood = 1.0 / dir.x;
    let t1 = (box.minX - origin.x) * ood;
    let t2 = (box.maxX - origin.x) * ood;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }

  if (dir.y > -1e-7 && dir.y < 1e-7) {
    if (origin.y < box.minY || origin.y > box.maxY) return null;
  } else {
    const ood = 1.0 / dir.y;
    let t1 = (box.minY - origin.y) * ood;
    let t2 = (box.maxY - origin.y) * ood;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }

  if (dir.z > -1e-7 && dir.z < 1e-7) {
    if (origin.z < box.minZ || origin.z > box.maxZ) return null;
  } else {
    const ood = 1.0 / dir.z;
    let t1 = (box.minZ - origin.z) * ood;
    let t2 = (box.maxZ - origin.z) * ood;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }

  return tmin;
}

export function raycastMap(origin: THREE.Vector3, dir: THREE.Vector3, maxDist = 140): { hit: boolean; distance: number; collider: AABB | null } {
  const mapColliders = getMapColliders();
  let closest = maxDist;
  let hit = false;
  let collider: AABB | null = null;

  for (let i = 0; i < mapColliders.length; i++) {
    const box = mapColliders[i];
    const t = intersectRayAABB(origin, dir, box, closest);
    if (t !== null && t < closest) {
      closest = t;
      hit = true;
      collider = box;
    }
  }

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

export function hasLineOfSight(posA: THREE.Vector3, posB: THREE.Vector3, checkSmoke = true): boolean {
  const dir = _losDir.subVectors(posB, posA);
  const dist = dir.length();
  if (dist < 0.05) return true;
  dir.divideScalar(dist);

  if (checkSmoke && raycastSmoke(posA, dir, dist).hit) return false;
  const res = raycastMap(posA, dir, dist - 0.15);
  return !res.hit;
}

function raycastSmoke(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): { hit: boolean; distance: number; smoke: SmokeCloud | null } {
  const activeSmokes = getActiveSmokes();
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
  return { hit: false, distance: maxDist, smoke: null };
}

interface SmokeCloud {
  mesh: THREE.Mesh;
  position: THREE.Vector3;
  radius: number;
  startTime: number;
  life: number;
}

let activeSmokesRef: SmokeCloud[] = [];

export function setActiveSmokesRef(ref: SmokeCloud[]): void {
  activeSmokesRef = ref;
}

export function getActiveSmokes(): SmokeCloud[] {
  return activeSmokesRef;
}

export function segmentClear(p1: THREE.Vector3, p2: THREE.Vector3, clearanceRadius = 0.52): boolean {
  if (Math.abs(p1.y - p2.y) > 1.75) return false;

  const diff = _segDiff.subVectors(p2, p1);
  const dist = diff.length();
  if (dist < 0.01) return true;
  const dir = _segDir.copy(diff).divideScalar(dist);
  const right = _segRight.set(-dir.z, 0, dir.x).normalize();

  for (let hi = 0; hi < 2; hi++) {
    const h = hi === 0 ? 0.75 : 1.45;
    for (let oi = -1; oi <= 1; oi++) {
      const off = oi * clearanceRadius;
      _segA.copy(p1).addScaledVector(right, off);
      _segA.y += h;
      _segB.copy(p2).addScaledVector(right, off);
      _segB.y += h;
      if (!hasLineOfSight(_segA, _segB)) return false;
    }
  }
  return true;
}