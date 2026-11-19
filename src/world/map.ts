import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  groundMat, wallMat, crateBlueMat, crateRedMat, crateOliveMat,
  brickMat, stuccoMat, asphaltMat, cityConcreteMat,
  carBlueMat, carRedMat, carYellowMat, catwalkMat
} from '../renderer/materials';
import type { AABB, Ramp, RadarEntry, MapDef } from '../types';
import { getFloorHeightAt, resolveCylinderCollision } from '../physics/collision';
import { getScene } from '../renderer';

const mapGroup = new THREE.Group();

const mapColliders: AABB[] = [];
const destructibleProps: DestructibleProp[] = [];
let destructiblePropId = 1;
const mapRamps: Ramp[] = [];
const radarWalls: RadarEntry[] = [];

let currentMapId: string | null = null;
let arenaLimit = 48.2;
let radarHalfExtent = 52;
let zoneMode = 'COMPOUND';

const teamGroupPlans = {
  ALPHA: { nodeIndex: -1, timer: 0 },
  BRAVO: { nodeIndex: -1, timer: 0 }
};

interface DestructibleProp {
  id: number;
  mesh: THREE.Mesh;
  collider: AABB;
  radar: RadarEntry | null;
  hp: number;
  maxHp: number;
  destroyed: boolean;
}

export function getMapGroup(): THREE.Group { return mapGroup; }
export function getMapColliders(): AABB[] { return mapColliders; }
export function getDestructibleProps(): DestructibleProp[] { return destructibleProps; }
export function getMapRamps(): Ramp[] { return mapRamps; }
export function getRadarWalls(): RadarEntry[] { return radarWalls; }
export function getCurrentMapId(): string | null { return currentMapId; }
export function getArenaLimit(): number { return arenaLimit; }
export function getRadarHalfExtent(): number { return radarHalfExtent; }
export function getZoneMode(): string { return zoneMode; }
export function getTeamGroupPlans(): typeof teamGroupPlans { return teamGroupPlans; }

export function resetTeamGroupPlans(): void {
  teamGroupPlans.ALPHA = { nodeIndex: -1, timer: 0 };
  teamGroupPlans.BRAVO = { nodeIndex: -1, timer: 0 };
}

function addGround(size: number): void {
  const groundMesh = new THREE.Mesh(new THREE.BoxGeometry(size, 1, size), groundMat);
  groundMesh.position.set(0, -0.5, 0);
  groundMesh.receiveShadow = true;
  mapGroup.add(groundMesh);
}

function addBoxObstacle(
  x: number, y: number, z: number,
  w: number, h: number, d: number,
  mat: THREE.Material = wallMat,
  options: { isPlatform?: boolean; hideOnRadar?: boolean; destructible?: boolean; hp?: number } = {}
): AABB {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mapGroup.add(mesh);

  const box: AABB = {
    minX: x - w / 2,
    maxX: x + w / 2,
    minY: y - h / 2,
    maxY: y + h / 2,
    minZ: z - d / 2,
    maxZ: z + d / 2,
    isPlatform: Boolean(options.isPlatform)
  };
  mapColliders.push(box);

  if (!options.hideOnRadar) {
    const radarEntry: RadarEntry = { x: box.minX, z: box.minZ, w, d, isPlatform: box.isPlatform };
    box.radar = radarEntry;
    radarWalls.push(radarEntry);
  }

  if (options.destructible) {
    mesh.material = mat.clone ? mat.clone() : mat;
    const prop: DestructibleProp = {
      id: destructiblePropId++,
      mesh,
      collider: box,
      radar: box.radar || null,
      hp: options.hp || 50,
      maxHp: options.hp || 50,
      destroyed: false
    };
    mesh.name = `destructible-${prop.id}`;
    mesh.userData.destructibleId = prop.id;
    destructibleProps.push(prop);
  }
  return box;
}

function addRamp(x: number, z: number, w: number, d: number, height: number, axis: 'x' | 'z', dirSign: number): void {
  const length = axis === 'z' ? d : w;
  const angle = Math.atan2(height, length);
  const hyp = Math.hypot(length, height);

  const geo = axis === 'z'
    ? new THREE.BoxGeometry(w, 0.28, hyp)
    : new THREE.BoxGeometry(hyp, 0.28, d);
  const mesh = new THREE.Mesh(geo, catwalkMat);
  mesh.position.set(x, height / 2 - 0.1, z);
  if (axis === 'z') {
    mesh.rotation.x = dirSign > 0 ? -angle : angle;
  } else {
    mesh.rotation.z = dirSign > 0 ? angle : -angle;
  }
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mapGroup.add(mesh);

  const ramp: Ramp = {
    minX: x - w / 2,
    maxX: x + w / 2,
    minZ: z - d / 2,
    maxZ: z + d / 2,
    yStart: dirSign > 0 ? 0 : height,
    yEnd: dirSign > 0 ? height : 0,
    axis
  };
  mapRamps.push(ramp);
  radarWalls.push({ x: ramp.minX, z: ramp.minZ, w, d, isRamp: true });
}

// =========================================================================
// MAP BUILDERS
// =========================================================================

function buildCompoundMap(): void {
  addGround(104);
  // Perimeter Compound Walls
  addBoxObstacle(0, 4, -50, 102, 8, 2, wallMat);
  addBoxObstacle(0, 4, 50, 102, 8, 2, wallMat);
  addBoxObstacle(-50, 4, 0, 2, 8, 102, wallMat);
  addBoxObstacle(50, 4, 0, 2, 8, 102, wallMat);

  // ALPHA SPAWN BASE (South)
  addBoxObstacle(-12, 1.3, 35, 6, 2.6, 1.4, crateBlueMat);
  addBoxObstacle(12, 1.3, 35, 6, 2.6, 1.4, crateBlueMat);
  addBoxObstacle(0, 0.65, 31, 7, 1.3, 1.2, wallMat);
  addBoxObstacle(-22, 2.2, 38, 3, 4.4, 8, wallMat);
  addBoxObstacle(22, 2.2, 38, 3, 4.4, 8, wallMat);

  // BRAVO SPAWN BASE (North)
  addBoxObstacle(-12, 1.3, -35, 6, 2.6, 1.4, crateRedMat);
  addBoxObstacle(12, 1.3, -35, 6, 2.6, 1.4, crateRedMat);
  addBoxObstacle(0, 0.65, -31, 7, 1.3, 1.2, wallMat);
  addBoxObstacle(-22, 2.2, -38, 3, 4.4, 8, wallMat);
  addBoxObstacle(22, 2.2, -38, 3, 4.4, 8, wallMat);

  // Central Courtyard & Tactical Cover
  addBoxObstacle(0, 2.2, 0, 4.4, 4.4, 4.4, wallMat);
  addBoxObstacle(-9.5, 0.85, 11, 4.5, 1.7, 1.4, crateOliveMat, { destructible: true, hp: 45 });
  addBoxObstacle(9.5, 0.85, 11, 4.5, 1.7, 1.4, crateOliveMat, { destructible: true, hp: 45 });
  addBoxObstacle(-9.5, 0.85, -11, 4.5, 1.7, 1.4, crateOliveMat, { destructible: true, hp: 45 });
  addBoxObstacle(9.5, 0.85, -11, 4.5, 1.7, 1.4, crateOliveMat, { destructible: true, hp: 45 });
  addBoxObstacle(-15, 2.2, 0, 2.6, 4.4, 5.5, wallMat);
  addBoxObstacle(15, 2.2, 0, 2.6, 4.4, 5.5, wallMat);

  // West Flanking Alley
  addBoxObstacle(-24, 2.4, 15, 2.2, 4.8, 12, wallMat);
  addBoxObstacle(-24, 2.4, -15, 2.2, 4.8, 12, wallMat);
  addBoxObstacle(-37, 1.4, 20, 6.5, 2.8, 3.2, crateBlueMat, { destructible: true, hp: 65 });
  addBoxObstacle(-37, 1.4, -20, 6.5, 2.8, 3.2, crateRedMat, { destructible: true, hp: 65 });
  addBoxObstacle(-39, 2.0, 0, 4.2, 4.0, 4.2, crateOliveMat);
  addBoxObstacle(-29, 0.75, 0, 3.2, 1.5, 1.4, wallMat);

  // East Warehouse & Elevated Overlook Catwalk
  addBoxObstacle(23, 2.6, 21, 1.8, 5.2, 8, wallMat);
  addBoxObstacle(23, 2.6, 7.5, 1.8, 5.2, 7, wallMat);
  addBoxObstacle(23, 2.6, -7.5, 1.8, 5.2, 7, wallMat);
  addBoxObstacle(23, 2.6, -21, 1.8, 5.2, 8, wallMat);
  addBoxObstacle(39, 1.3, 14, 4.5, 2.6, 3.2, crateOliveMat, { destructible: true, hp: 65 });
  addBoxObstacle(39, 1.3, -14, 4.5, 2.6, 3.2, crateOliveMat, { destructible: true, hp: 65 });

  addBoxObstacle(32, 2.65, 0, 6.5, 0.3, 14, catwalkMat, { isPlatform: true });
  addBoxObstacle(28.9, 3.2, 0, 0.25, 0.85, 13.6, catwalkMat, { hideOnRadar: true });
  addBoxObstacle(35.1, 3.2, 0, 0.25, 0.85, 13.6, catwalkMat, { hideOnRadar: true });
  addRamp(32, 11.5, 5.6, 9.0, 2.8, 'z', -1);
  addRamp(32, -11.5, 5.6, 9.0, 2.8, 'z', +1);
}

function buildShipmentMap(): void {
  addGround(58);
  addBoxObstacle(0, 2.5, -28, 54, 5, 2, wallMat);
  addBoxObstacle(0, 2.5, 28, 54, 5, 2, wallMat);
  addBoxObstacle(-28, 2.5, 0, 2, 5, 54, wallMat);
  addBoxObstacle(28, 2.5, 0, 2, 5, 54, wallMat);

  addBoxObstacle(-13, 1.4, 18, 7.5, 2.8, 3.4, crateBlueMat);
  addBoxObstacle(13, 1.4, 18, 7.5, 2.8, 3.4, crateBlueMat);
  addBoxObstacle(-5, 1.4, 21.5, 4.8, 2.8, 3.2, crateOliveMat);
  addBoxObstacle(5, 1.4, 21.5, 4.8, 2.8, 3.2, crateOliveMat);
  addBoxObstacle(0, 0.72, 13.5, 8.5, 1.44, 1.5, wallMat);

  addBoxObstacle(-13, 1.4, -18, 7.5, 2.8, 3.4, crateRedMat);
  addBoxObstacle(13, 1.4, -18, 7.5, 2.8, 3.4, crateRedMat);
  addBoxObstacle(-5, 1.4, -21.5, 4.8, 2.8, 3.2, crateOliveMat);
  addBoxObstacle(5, 1.4, -21.5, 4.8, 2.8, 3.2, crateOliveMat);
  addBoxObstacle(0, 0.72, -13.5, 8.5, 1.44, 1.5, wallMat);

  addBoxObstacle(0, 1.45, 0, 6.2, 2.9, 6.2, crateBlueMat);
  addBoxObstacle(0, 4.05, 0, 5.0, 2.3, 5.0, crateOliveMat, { hideOnRadar: true });

  addBoxObstacle(-11, 1.4, 7, 10.5, 2.8, 3.4, crateRedMat);
  addBoxObstacle(11, 1.4, -7, 10.5, 2.8, 3.4, crateBlueMat);
  addBoxObstacle(-11, 1.4, -7, 4.5, 2.8, 3.4, crateOliveMat);
  addBoxObstacle(11, 1.4, 7, 4.5, 2.8, 3.4, crateOliveMat);

  addBoxObstacle(-5.5, 0.72, 12, 5.0, 1.44, 1.45, wallMat, { hideOnRadar: true });
  addBoxObstacle(5.5, 0.72, -12, 5.0, 1.44, 1.45, wallMat, { hideOnRadar: true });
  addBoxObstacle(-4.5, 0.85, 5.8, 3.3, 1.7, 1.35, crateOliveMat, { destructible: true, hp: 45 });
  addBoxObstacle(4.5, 0.85, -5.8, 3.3, 1.7, 1.35, crateOliveMat, { destructible: true, hp: 45 });
  addBoxObstacle(-20, 0.85, 3, 3.0, 1.7, 3.0, crateBlueMat, { destructible: true, hp: 45 });
  addBoxObstacle(20, 0.85, -3, 3.0, 1.7, 3.0, crateRedMat, { destructible: true, hp: 45 });

  addBoxObstacle(-17, 1.4, -8, 3.6, 2.8, 8.0, crateOliveMat);
  addBoxObstacle(17, 1.4, 8, 3.6, 2.8, 8.0, crateOliveMat);
  addBoxObstacle(-23, 2.25, 9, 3.5, 4.5, 4.0, wallMat);
  addBoxObstacle(23, 2.25, -9, 3.5, 4.5, 4.0, wallMat);

  addBoxObstacle(-17, 1.15, 17, 4.0, 2.3, 2.2, crateRedMat, { destructible: true, hp: 55 });
  addBoxObstacle(17, 1.15, -17, 4.0, 2.3, 2.2, crateBlueMat, { destructible: true, hp: 55 });
  addBoxObstacle(-8, 1.15, -2, 2.4, 2.3, 2.4, crateBlueMat, { destructible: true, hp: 55 });
  addBoxObstacle(8, 1.15, 2, 2.4, 2.3, 2.4, crateRedMat, { destructible: true, hp: 55 });
}

function buildShootHouse(): void {
  addGround(58);
  addBoxObstacle(0, 2.5, -28, 54, 5, 2, wallMat);
  addBoxObstacle(0, 2.5, 28, 54, 5, 2, wallMat);
  addBoxObstacle(-28, 2.5, 0, 2, 5, 54, wallMat);
  addBoxObstacle(28, 2.5, 0, 2, 5, 54, wallMat);

  addBoxObstacle(-13, 1.15, 18, 4.6, 2.3, 2.4, carYellowMat, { destructible: true, hp: 60 });
  addBoxObstacle(13, 1.15, 18, 4.6, 2.3, 2.4, carYellowMat, { destructible: true, hp: 60 });
  addBoxObstacle(-5.6, 0.72, 13.5, 3.2, 1.44, 1.45, wallMat);
  addBoxObstacle(5.6, 0.72, 13.5, 3.2, 1.44, 1.45, wallMat);

  addBoxObstacle(-13, 1.15, -18, 4.6, 2.3, 2.4, carYellowMat, { destructible: true, hp: 60 });
  addBoxObstacle(13, 1.15, -18, 4.6, 2.3, 2.4, carYellowMat, { destructible: true, hp: 60 });
  addBoxObstacle(-5.6, 0.72, -13.5, 3.2, 1.44, 1.45, wallMat);
  addBoxObstacle(5.6, 0.72, -13.5, 3.2, 1.44, 1.45, wallMat);

  addBoxObstacle(-4.75, 2.5, 9, 4.5, 5, 1.8, brickMat);
  addBoxObstacle(4.75, 2.5, 9, 4.5, 5, 1.8, brickMat);
  addBoxObstacle(-4.75, 2.5, -9, 4.5, 5, 1.8, brickMat);
  addBoxObstacle(4.75, 2.5, -9, 4.5, 5, 1.8, brickMat);
  addBoxObstacle(-6, 2.5, -5.2, 1.8, 5, 7.4, brickMat);
  addBoxObstacle(-6, 2.5, 5.2, 1.8, 5, 7.4, brickMat);
  addBoxObstacle(6, 2.5, -5.2, 1.8, 5, 7.4, brickMat);
  addBoxObstacle(6, 2.5, 5.2, 1.8, 5, 7.4, brickMat);

  addBoxObstacle(-3.6, 2.2, -3, 4.8, 4.4, 1.5, brickMat);
  addBoxObstacle(3.6, 2.2, 3, 4.8, 4.4, 1.5, brickMat);

  addBoxObstacle(-18.5, 1.15, 8, 5.0, 2.3, 2.5, carBlueMat, { destructible: true, hp: 70 });
  addBoxObstacle(18.5, 1.15, -8, 5.0, 2.3, 2.5, carRedMat, { destructible: true, hp: 70 });
  addBoxObstacle(-15, 1.15, -16, 5.6, 2.3, 2.5, carRedMat, { destructible: true, hp: 70 });
  addBoxObstacle(15, 1.15, 16, 5.6, 2.3, 2.5, carBlueMat, { destructible: true, hp: 70 });

  addBoxObstacle(-20, 0.85, 2, 2.8, 1.7, 2.8, crateOliveMat, { destructible: true, hp: 45 });
  addBoxObstacle(20, 0.85, -2, 2.8, 1.7, 2.8, crateOliveMat, { destructible: true, hp: 45 });
  addBoxObstacle(-11, 1.15, -1, 2.4, 2.3, 2.4, crateBlueMat, { destructible: true, hp: 55 });
  addBoxObstacle(11, 1.15, 1, 2.4, 2.3, 2.4, crateRedMat, { destructible: true, hp: 55 });
}

function buildBlastTown(): void {
  addGround(62);
  addBoxObstacle(0, 2.5, -31, 60, 5, 2, stuccoMat);
  addBoxObstacle(0, 2.5, 31, 60, 5, 2, stuccoMat);
  addBoxObstacle(-31, 2.5, 0, 2, 5, 60, stuccoMat);
  addBoxObstacle(31, 2.5, 0, 2, 5, 60, stuccoMat);

  addBoxObstacle(-16, 2.2, 11, 12.5, 4.4, 8.5, brickMat);
  addBoxObstacle(16, 2.2, -11, 12.5, 4.4, 8.5, brickMat);

  addBoxObstacle(-20, 1.1, -0.5, 5.2, 2.2, 2.2, stuccoMat, { hideOnRadar: true });
  addBoxObstacle(20, 1.1, 0.5, 5.2, 2.2, 2.2, stuccoMat, { hideOnRadar: true });
  addBoxObstacle(-6, 3.25, 11, 5, 0.7, 0.2, cityConcreteMat, { hideOnRadar: true });
  addBoxObstacle(6, 3.25, -11, 5, 0.7, 0.2, cityConcreteMat, { hideOnRadar: true });

  addBoxObstacle(-4.3, 1.2, 0, 5.2, 2.4, 3.8, carYellowMat, { destructible: true, hp: 85 });
  addBoxObstacle(4.3, 1.2, 0, 5.2, 2.4, 3.8, carYellowMat, { destructible: true, hp: 85 });
  addBoxObstacle(-5.5, 0.72, 6.5, 3.2, 1.44, 1.3, wallMat, { hideOnRadar: true });
  addBoxObstacle(5.5, 0.72, -6.5, 3.2, 1.44, 1.3, wallMat, { hideOnRadar: true });

  addBoxObstacle(-21, 1.0, -13, 3.8, 2, 2.3, carBlueMat, { destructible: true, hp: 60 });
  addBoxObstacle(21, 1.0, 13, 3.8, 2, 2.3, carRedMat, { destructible: true, hp: 60 });

  addBoxObstacle(-16, 1.15, 23, 4.2, 2.3, 2.3, carBlueMat, { destructible: true, hp: 60 });
  addBoxObstacle(16, 1.15, 23, 4.2, 2.3, 2.3, carRedMat, { destructible: true, hp: 60 });
  addBoxObstacle(-16, 1.15, -23, 4.2, 2.3, 2.3, carRedMat, { destructible: true, hp: 60 });
  addBoxObstacle(16, 1.15, -23, 4.2, 2.3, 2.3, carBlueMat, { destructible: true, hp: 60 });
}

function buildDowntown(): void {
  addGround(88);
  addBoxObstacle(0, 3, -44, 86, 6, 2, cityConcreteMat);
  addBoxObstacle(0, 3, 44, 86, 6, 2, cityConcreteMat);
  addBoxObstacle(-44, 3, 0, 2, 6, 86, cityConcreteMat);
  addBoxObstacle(44, 3, 0, 2, 6, 86, cityConcreteMat);

  addBoxObstacle(-19, 1.4, 35, 7, 2.8, 3.2, cityConcreteMat);
  addBoxObstacle(19, 1.4, 35, 7, 2.8, 3.2, cityConcreteMat);
  addBoxObstacle(-19, 1.4, -35, 7, 2.8, 3.2, cityConcreteMat);
  addBoxObstacle(19, 1.4, -35, 7, 2.8, 3.2, cityConcreteMat);

  addBoxObstacle(-22, 2.4, 23, 13, 4.8, 1.8, cityConcreteMat);
  addBoxObstacle(22, 2.4, 23, 13, 4.8, 1.8, cityConcreteMat);
  addBoxObstacle(-22, 2.4, -23, 13, 4.8, 1.8, cityConcreteMat);
  addBoxObstacle(22, 2.4, -23, 13, 4.8, 1.8, cityConcreteMat);

  addBoxObstacle(0, 1.9, 0, 8.5, 3.8, 8.5, cityConcreteMat);
  addBoxObstacle(-10, 1.1, 4, 4.8, 2.2, 3.2, carBlueMat, { destructible: true, hp: 65 });
  addBoxObstacle(10, 1.1, -4, 4.8, 2.2, 3.2, carRedMat, { destructible: true, hp: 65 });

  addBoxObstacle(-26, 1.8, 10, 5.5, 3.6, 10, brickMat);
  addBoxObstacle(26, 1.8, -10, 5.5, 3.6, 10, brickMat);

  addBoxObstacle(-14, 0.72, 15, 5, 1.44, 1.3, wallMat);
  addBoxObstacle(14, 0.72, -15, 5, 1.44, 1.3, wallMat);
  addBoxObstacle(-28, 1.3, -8, 4.3, 2.6, 4.3, crateOliveMat, { destructible: true, hp: 70 });
  addBoxObstacle(28, 1.3, 8, 4.3, 2.6, 4.3, crateOliveMat, { destructible: true, hp: 70 });
}

export const MAP_DEFS: Record<string, MapDef> = {
  compound: {
    id: 'compound', label: 'COMPOUND', arenaLimit: 48.2, radarHalf: 52, zoneMode: 'COMPOUND', lightZ: 40,
    build: buildCompoundMap,
    rawNodes: [
      [0, 0, 42], [-14, 0, 42], [14, 0, 42],
      [-6, 0, 34], [6, 0, 34], [-18, 0, 30], [18, 0, 30],
      [-16, 0, 21], [-5, 0, 21], [5, 0, 21], [16, 0, 21],
      [0, 0, 15], [-16, 0, 12],
      [-6, 0, 7], [6, 0, 7], [-10, 0, 0], [10, 0, 0],
      [-6, 0, -7], [6, 0, -7], [0, 0, -15], [16, 0, 12],
      [-31, 0, 34], [-31, 0, 22], [-43, 0, 10],
      [-33, 0, 0], [-43, 0, -10], [-31, 0, -22],
      [20, 0, 27], [26, 0, 27], [20, 0, 14], [20, 0, 0],
      [20, 0, -14], [26, 0, -27], [20, 0, -27],
      [42, 0, 20], [42, 0, 0], [42, 0, -20],
      [32, 0, 17.5], [32, 1.4, 11.5], [32, 2.8, 5.5], [32, 2.8, -5.5],
      [32, 1.4, -11.5], [32, 0, -17.5],
      [-16, 0, -12], [16, 0, -12],
      [-16, 0, -21], [-5, 0, -21], [5, 0, -21], [16, 0, -21],
      [-6, 0, -34], [6, 0, -34], [0, 0, -42], [-14, 0, -42], [14, 0, -42], [-31, 0, -34]
    ],
    safe: { ALPHA: [3, 4, 7, 10, 21], BRAVO: [49, 50, 45, 48, 26] },
    flank: [21, 22, 23, 24, 25, 26],
    warehouse: [27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42],
    mid: [9, 10, 13, 14, 15, 17, 18, 19, 20, 43, 44, 45, 46, 47, 48],
    camp: [21, 26, 33, 48],
    rally: [19, 20, 44, 45, 47]
  },
  shipment: {
    id: 'shipment', label: 'SHIPMENT', arenaLimit: 25.7, radarHalf: 28, zoneMode: 'SHIPMENT', lightZ: 18,
    build: buildShipmentMap,
    rawNodes: [
      [-23, 0, 20], [0, 0, 20], [23, 0, 20],
      [-20, 0, 10], [-10, 0, 12], [0, 0, 10.5], [10, 0, 12], [20, 0, 10],
      [-20, 0, 1], [-8, 0, 5], [8, 0, 5], [20, 0, 1],
      [-14, 0, -3], [0, 0, 7], [0, 0, -7], [14, 0, -3],
      [-20, 0, -10], [-10, 0, -12], [0, 0, -10.5], [10, 0, -12], [20, 0, -10],
      [-23, 0, -20], [0, 0, -20], [23, 0, -20]
    ],
    safe: { ALPHA: [0, 1, 2, 3, 5, 7], BRAVO: [16, 17, 18, 19, 20, 21, 22, 23] },
    flank: [3, 8, 12, 16, 21],
    warehouse: [2, 7, 11, 15, 20, 23],
    mid: [4, 6, 9, 10, 12, 13, 14, 15, 17, 18, 19],
    camp: [0, 2, 21, 23],
    rally: [5, 9, 10, 13, 14]
  },
  shoothouse: {
    id: 'shoothouse', label: 'SHOOT HOUSE', arenaLimit: 25.7, radarHalf: 28, zoneMode: 'SHOOT_HOUSE', lightZ: 20,
    build: buildShootHouse,
    rawNodes: [
      [-22, 0, 21], [0, 0, 22], [22, 0, 21],
      [-22, 0, 9], [-12, 0, 13], [12, 0, 13], [22, 0, 9],
      [-22, 0, 0], [-13, 0, 4], [-11, 0, -8], [0, 0, 8], [0, 0, 0], [0, 0, -8], [11, 0, -8], [13, 0, 4], [22, 0, 0],
      [-22, 0, -9], [-12, 0, -13], [12, 0, -13], [22, 0, -9],
      [-22, 0, -21], [0, 0, -22], [22, 0, -21]
    ],
    safe: { ALPHA: [0, 1, 2, 4, 5], BRAVO: [16, 18, 19, 20, 21] },
    flank: [3, 6, 7, 14, 15, 16, 18, 21],
    warehouse: [4, 5, 8, 9, 11, 14],
    mid: [3, 5, 7, 8, 10, 11, 12, 13, 15],
    camp: [0, 2, 6, 14, 17, 21],
    rally: [5, 10, 11, 12, 15]
  },
  blasttown: {
    id: 'blasttown', label: 'BLAST TOWN', arenaLimit: 28.7, radarHalf: 31, zoneMode: 'BLAST_TOWN', lightZ: 22,
    build: buildBlastTown,
    rawNodes: [
      [-24, 0, 23], [-11, 0, 21], [0, 0, 23], [11, 0, 21], [24, 0, 23],
      [-24, 0, 8], [-23, 0, 10], [0, 0, 13], [12, 0, 13], [24, 0, 8],
      [-24, 0, -3], [-13, 0, 3], [0, 0, 5], [0, 0, -5], [7, 0, -3], [18, 0, -5], [24, 0, -3],
      [-24, 0, -13], [-23, 0, -13], [0, 0, -15], [8, 0, -18], [24, 0, -13],
      [-24, 0, -23], [0, 0, -23], [24, 0, -23],
      [-12, 0, 23], [12, 0, 23], [-12, 0, -23], [12, 0, -23],
      [-24, 0, -18], [-12, 0, -18], [24, 0, -18], [12, 0, -18]
    ],
    safe: { ALPHA: [0, 1, 2, 3, 4, 6, 8], BRAVO: [18, 20, 21, 22, 23, 24] },
    flank: [5, 10, 11, 16, 17, 18, 22],
    warehouse: [6, 8, 12, 14, 18, 20],
    mid: [1, 3, 7, 12, 13, 14, 18, 19, 20],
    camp: [0, 4, 17, 24],
    rally: [7, 12, 14]
  },
  downtown: {
    id: 'downtown', label: 'DOWNTOWN', arenaLimit: 41.8, radarHalf: 44, zoneMode: 'DOWNTOWN', lightZ: 35,
    build: buildDowntown,
    rawNodes: [
      [-31, 0, 33], [-15, 0, 27], [0, 0, 33], [15, 0, 27], [31, 0, 33],
      [-31, 0, 16], [-15, 0, 17], [0, 0, 18], [15, 0, 17], [31, 0, 16],
      [-31, 0, 0], [-14, 0, 0], [0, 0, 10], [14, 0, 0], [31, 0, 0],
      [-31, 0, -16], [-15, 0, -17], [0, 0, -18], [15, 0, -17], [31, 0, -16],
      [-31, 0, -33], [-15, 0, -27], [0, 0, -33], [15, 0, -27], [31, 0, -33]
    ],
    safe: { ALPHA: [0, 1, 2, 3, 4, 7, 8], BRAVO: [16, 20, 21, 22, 23, 24] },
    flank: [5, 9, 10, 14, 15, 19],
    warehouse: [1, 3, 7, 8, 11, 12, 17, 19, 21, 23],
    mid: [6, 8, 11, 12, 13, 16, 17, 18],
    camp: [0, 4, 20, 24],
    rally: [7, 8, 12]
  }
};

export function clearStaticMap(): void {
  for (const child of [...mapGroup.children]) {
    mapGroup.remove(child);
    child.traverse((o) => { if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose(); });
  }
  mapColliders.length = 0;
  destructibleProps.length = 0;
  destructiblePropId = 1;
  mapRamps.length = 0;
  radarWalls.length = 0;
}

export function randomMapId(excludeId: string | null = null): string {
  const ids = Object.keys(MAP_DEFS);
  let id = ids[Math.floor(Math.random() * ids.length)];
  if (ids.length > 1 && id === excludeId) {
    id = ids[(ids.indexOf(id) + 1) % ids.length];
  }
  return id;
}

export function loadMap(mapId: string | null = null): { id: string; def: MapDef } {
  const id = mapId && MAP_DEFS[mapId] ? mapId : randomMapId();
  const def = MAP_DEFS[id];
  currentMapId = id;
  arenaLimit = def.arenaLimit;
  radarHalfExtent = def.radarHalf;
  zoneMode = def.zoneMode;
  clearStaticMap();
  resetTeamGroupPlans();
  def.build();
  mergeStaticMapGeometry();
  
  // Add mapGroup to scene (lazy init - scene now exists)
  const scene = getScene();
  console.log('[Map] loadMap: scene=', scene, 'mapGroup children=', mapGroup.children.length);
  scene.add(mapGroup);
  
  return { id, def };
}

function mergeStaticMapGeometry(): void {
  const byMaterial = new Map<THREE.Material, { geo: THREE.BufferGeometry; cast: boolean; receive: boolean }[]>();
  const oldMeshes: THREE.Mesh[] = [];
  mapGroup.traverse((o) => {
    const obj = o as THREE.Mesh;
    if (obj.isMesh && obj.geometry && !Array.isArray(obj.material) && !obj.userData.destructibleId) oldMeshes.push(obj);
  });

  for (const mesh of oldMeshes) {
    mesh.updateMatrixWorld(true);
    const geo = mesh.geometry.clone();
    for (const key of Object.keys(geo.attributes)) {
      if (key !== 'position' && key !== 'normal' && key !== 'uv') geo.deleteAttribute(key);
    }
    geo.applyMatrix4(mesh.matrixWorld);
    const mat = mesh.material as THREE.Material;
    if (!byMaterial.has(mat)) byMaterial.set(mat, []);
    byMaterial.get(mat)!.push({ geo, cast: mesh.castShadow, receive: mesh.receiveShadow });
  }

  for (const mesh of oldMeshes) {
    mesh.parent && mesh.parent.remove(mesh);
    mesh.geometry.dispose();
  }

  for (const [material, parts] of byMaterial) {
    const merged = mergeGeometries(parts.map((p) => p.geo), false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = parts.some((p) => p.cast);
    mesh.receiveShadow = parts.some((p) => p.receive);
    mapGroup.add(mesh);
    parts.forEach((p) => p.geo.dispose());
  }
}

// TacticalNavGraph is imported by the engine, not here to avoid circular deps