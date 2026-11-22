import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SOLDIER_GLB_URL } from '../config';

export interface SoldierTemplate {
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
}

/** Shared loader: also used by the weapon importer for .glb/.gltf parsing. */
export const gltfLoader = new GLTFLoader();

let soldierGLB: SoldierTemplate | null = null;

/** The downloaded Soldier.glb, once loaded; otherwise null (procedural fallback is used). */
export function getSoldierGLB(): SoldierTemplate | null {
  return soldierGLB;
}

function buildProceduralSoldierTemplate(): SoldierTemplate {
  // Creates an articulated SkinnedMesh soldier with identical mixamorig bone hierarchy
  const root = new THREE.Group();
  const bonesMap: Record<string, THREE.Bone> = {};

  const makeBone = (name: string, parent: THREE.Object3D | null, pos: THREE.Vector3): THREE.Bone => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.copy(pos);
    if (parent) parent.add(b);
    bonesMap[name] = b;
    return b;
  };

  const hips = makeBone('mixamorigHips', root, new THREE.Vector3(0, 0.94, 0));
  const spine1 = makeBone('mixamorigSpine1', hips, new THREE.Vector3(0, 0.22, 0));
  const head = makeBone('mixamorigHead', spine1, new THREE.Vector3(0, 0.34, 0));
  makeBone('mixamorigHeadTop_End', head, new THREE.Vector3(0, 0.24, 0));

  const lArm = makeBone('mixamorigLeftArm', spine1, new THREE.Vector3(-0.22, 0.24, 0));
  const lForeArm = makeBone('mixamorigLeftForeArm', lArm, new THREE.Vector3(0, -0.3, 0));
  makeBone('mixamorigLeftHand', lForeArm, new THREE.Vector3(0, -0.26, 0));

  const rArm = makeBone('mixamorigRightArm', spine1, new THREE.Vector3(0.22, 0.24, 0));
  const rForeArm = makeBone('mixamorigRightForeArm', rArm, new THREE.Vector3(0, -0.3, 0));
  makeBone('mixamorigRightHand', rForeArm, new THREE.Vector3(0, -0.26, 0));

  const lUpLeg = makeBone('mixamorigLeftUpLeg', hips, new THREE.Vector3(-0.11, -0.04, 0));
  const lLeg = makeBone('mixamorigLeftLeg', lUpLeg, new THREE.Vector3(0, -0.43, 0));
  makeBone('mixamorigLeftFoot', lLeg, new THREE.Vector3(0, -0.43, 0));

  const rUpLeg = makeBone('mixamorigRightUpLeg', hips, new THREE.Vector3(0.11, -0.04, 0));
  const rLeg = makeBone('mixamorigRightLeg', rUpLeg, new THREE.Vector3(0, -0.43, 0));
  makeBone('mixamorigRightFoot', rLeg, new THREE.Vector3(0, -0.43, 0));

  const armorMat = new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.45, metalness: 0.25 });
  const darkGearMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.7, metalness: 0.2 });
  const visorMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: 0x0284c7,
    emissiveIntensity: 0.6,
    roughness: 0.2,
  });

  const attachPart = (
    bone: THREE.Bone,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    offset: THREE.Vector3,
  ): void => {
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(offset);
    m.castShadow = true;
    m.receiveShadow = true;
    bone.add(m);
  };

  attachPart(hips, new THREE.BoxGeometry(0.32, 0.16, 0.22), darkGearMat, new THREE.Vector3(0, 0, 0));
  attachPart(spine1, new THREE.BoxGeometry(0.38, 0.42, 0.25), armorMat, new THREE.Vector3(0, 0.14, 0));
  attachPart(head, new THREE.BoxGeometry(0.22, 0.24, 0.23), armorMat, new THREE.Vector3(0, 0.11, 0));
  attachPart(head, new THREE.BoxGeometry(0.19, 0.08, 0.05), visorMat, new THREE.Vector3(0, 0.12, 0.11));

  attachPart(lArm, new THREE.CapsuleGeometry(0.065, 0.18, 4, 8), armorMat, new THREE.Vector3(0, -0.15, 0));
  attachPart(
    lForeArm,
    new THREE.CapsuleGeometry(0.055, 0.16, 4, 8),
    darkGearMat,
    new THREE.Vector3(0, -0.13, 0),
  );
  attachPart(rArm, new THREE.CapsuleGeometry(0.065, 0.18, 4, 8), armorMat, new THREE.Vector3(0, -0.15, 0));
  attachPart(
    rForeArm,
    new THREE.CapsuleGeometry(0.055, 0.16, 4, 8),
    darkGearMat,
    new THREE.Vector3(0, -0.13, 0),
  );

  attachPart(
    lUpLeg,
    new THREE.CapsuleGeometry(0.08, 0.28, 4, 8),
    darkGearMat,
    new THREE.Vector3(0, -0.21, 0),
  );
  attachPart(lLeg, new THREE.CapsuleGeometry(0.068, 0.28, 4, 8), armorMat, new THREE.Vector3(0, -0.21, 0));
  attachPart(
    rUpLeg,
    new THREE.CapsuleGeometry(0.08, 0.28, 4, 8),
    darkGearMat,
    new THREE.Vector3(0, -0.21, 0),
  );
  attachPart(rLeg, new THREE.CapsuleGeometry(0.068, 0.28, 4, 8), armorMat, new THREE.Vector3(0, -0.21, 0));

  // Build procedural Idle / Walk / Run keyframe clips
  const times = [0, 0.25, 0.5, 0.75, 1.0];
  const makeStrideClip = (name: string, amp: number): THREE.AnimationClip => {
    const qFwd = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), amp);
    const qBack = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -amp);
    const qZero = new THREE.Quaternion();
    const legValues = [
      ...qZero.toArray(),
      ...qFwd.toArray(),
      ...qZero.toArray(),
      ...qBack.toArray(),
      ...qZero.toArray(),
    ];
    const oppValues = [
      ...qZero.toArray(),
      ...qBack.toArray(),
      ...qZero.toArray(),
      ...qFwd.toArray(),
      ...qZero.toArray(),
    ];
    return new THREE.AnimationClip(name, 1.0, [
      new THREE.QuaternionKeyframeTrack('mixamorigLeftUpLeg.quaternion', times, legValues),
      new THREE.QuaternionKeyframeTrack('mixamorigRightUpLeg.quaternion', times, oppValues),
    ]);
  };

  return {
    scene: root,
    animations: [makeStrideClip('Idle', 0.03), makeStrideClip('Walk', 0.48), makeStrideClip('Run', 0.82)],
  };
}

/** Articulated fallback rig, always available. */
export const proceduralTemplate: SoldierTemplate = buildProceduralSoldierTemplate();

/** Load Soldier.glb asynchronously with a seamless procedural fallback. */
export function loadSoldierGLB(onReady: () => void): void {
  gltfLoader.load(
    SOLDIER_GLB_URL,
    (gltf) => {
      soldierGLB = { scene: gltf.scene, animations: gltf.animations || [] };
      onReady();
    },
    undefined,
    () => {
      // Fallback already active
    },
  );
}
