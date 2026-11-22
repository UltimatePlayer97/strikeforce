import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import type { BoneMap, RigRestData, SoldierRig, Team } from '../types';
import { createStanceRigData } from './stance';
import { getSoldierGLB, proceduralTemplate } from './soldierTemplate';

const REST_BONE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['mixamorigSpine1', 'mixamorigHead'],
  ['mixamorigHead', 'mixamorigHeadTop_End'],
  ['mixamorigLeftArm', 'mixamorigLeftForeArm'],
  ['mixamorigLeftForeArm', 'mixamorigLeftHand'],
  ['mixamorigRightArm', 'mixamorigRightForeArm'],
  ['mixamorigRightForeArm', 'mixamorigRightHand'],
  ['mixamorigLeftUpLeg', 'mixamorigLeftLeg'],
  ['mixamorigLeftLeg', 'mixamorigLeftFoot'],
  ['mixamorigRightUpLeg', 'mixamorigRightLeg'],
  ['mixamorigRightLeg', 'mixamorigRightFoot'],
];

function captureRigRestData(root: THREE.Object3D, bones: BoneMap): RigRestData {
  root.position.set(0, 0, 0);
  root.rotation.set(0, 0, 0);
  root.updateMatrixWorld(true);

  const restData: RigRestData = { bones: {}, hipsCorrectionQuat: null };

  for (const [bName, childName] of REST_BONE_PAIRS) {
    const b = bones[bName];
    if (!b || !b.parent) continue;
    const child: THREE.Object3D | undefined = bones[childName] || b.children[0];
    const bWorld = b.getWorldPosition(new THREE.Vector3());
    let cWorld: THREE.Vector3;
    if (child) {
      cWorld = child.getWorldPosition(new THREE.Vector3());
    } else {
      cWorld = bWorld.clone().add(new THREE.Vector3(0, 0.2, 0));
    }
    const dirWorld = cWorld.sub(bWorld);
    if (dirWorld.lengthSq() < 1e-6) dirWorld.set(0, 1, 0);
    dirWorld.normalize();

    const pWorldQuat = b.parent.getWorldQuaternion(new THREE.Quaternion());
    const restDirInParent = dirWorld.applyQuaternion(pWorldQuat.clone().invert()).normalize();
    restData.bones[bName] = {
      restDirInParent,
      restQuat: b.quaternion.clone(),
    };
  }

  // Capture hips initial world orientation relative to standing world axes
  const hips = bones.mixamorigHips;
  if (hips) {
    restData.hipsCorrectionQuat = hips.getWorldQuaternion(new THREE.Quaternion());
  }
  return restData;
}

export function createSoldierRig(team: Team): SoldierRig {
  const glb = getSoldierGLB();
  const useGLB = Boolean(glb);
  const template = glb ?? proceduralTemplate;
  const sourceScene = template.scene;
  const sourceClips = template.animations;

  const root = SkeletonUtils.clone(sourceScene);
  const teamColor = team === 'ALPHA' ? new THREE.Color(0x2563eb) : new THREE.Color(0xdc2626);
  const trimColor = team === 'ALPHA' ? new THREE.Color(0x60a5fa) : new THREE.Color(0xf87171);

  const bones: BoneMap = {};
  root.traverse((obj) => {
    if ((obj as THREE.Bone).isBone) {
      // Soldier.glb exports mixamo bones as "mixamorig:Hips"; normalize the map key so
      // weapon sockets, ragdoll retargeting and stance poses work on both rigs.
      bones[obj.name.replace('mixamorig:', 'mixamorig')] = obj as THREE.Bone;
    }
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // Skinned vertices are driven by bones while ragdoll retargeting leaves the root
      // at world origin, so the geometry's stale bounding sphere can be off-screen.
      // Never frustum-cull a skinned body or its corpse may disappear for good.
      if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) mesh.frustumCulled = false;
      // Clone material so each soldier has independent team tinting
      if (mesh.material) {
        const material = (mesh.material as THREE.Material).clone() as THREE.MeshStandardMaterial;
        mesh.material = material;
        if (material.color) {
          material.color.lerp(teamColor, 0.55);
        }
        if (material.emissive) {
          material.emissive.copy(trimColor);
          material.emissiveIntensity = 0.14;
        }
      }
    }
  });

  // Add glowing team shoulder/helmet beacon strip for crisp friend-or-foe silhouette readability
  const beaconGeo = new THREE.BoxGeometry(0.18, 0.05, 0.18);
  const beaconMat = new THREE.MeshStandardMaterial({
    color: trimColor,
    emissive: teamColor,
    emissiveIntensity: 0.9,
  });
  const beaconMesh = new THREE.Mesh(beaconGeo, beaconMat);
  beaconMesh.position.set(0, 1.88, 0);
  root.add(beaconMesh);

  const restData = captureRigRestData(root, bones);

  const mixer = new THREE.AnimationMixer(root);
  const actions: Record<string, THREE.AnimationAction> = {};
  for (const clip of sourceClips) {
    actions[clip.name] = mixer.clipAction(clip);
  }
  if (actions.Idle) actions.Idle.play();

  const rig: SoldierRig = {
    root,
    bones,
    restData,
    mixer,
    actions,
    beaconMesh,
    isGLB: useGLB,
    locomotionClip: 'Idle',
    stance: null,
  };
  rig.stance = createStanceRigData(rig, sourceClips);
  return rig;
}
