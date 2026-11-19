import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import JSZip from 'jszip';
import type { WeaponInstance, Role } from '../types';
import type { Material } from 'three';

const gltfLoader = new GLTFLoader();
const objLoader = new OBJLoader();
const mtlLoader = new MTLLoader();

const DEFAULT_OFFSETS = { x: 0.24, y: -0.18, z: -0.55 };

export interface CustomWeaponData {
  model: THREE.Group;
  animations: Map<string, THREE.AnimationClip>;
  offsets: { x: number; y: number; z: number };
}

function normalizeWeaponModel(rawModel: THREE.Object3D, rotationY = Math.PI): THREE.Group {
  rawModel.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      const mesh = obj as THREE.Mesh;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (mesh.material) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((m) => {
          const stdMat = m as THREE.MeshStandardMaterial;
          stdMat.metalness = 0.7;
          stdMat.roughness = 0.3;
        });
      }
    }
  });

  const box = new THREE.Box3().setFromObject(rawModel);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  rawModel.position.sub(center);

  const wrapper = new THREE.Group();
  wrapper.add(rawModel);

  const maxDim = Math.max(size.x, size.y, size.z);
  const scale = maxDim > 0 ? 0.6 / maxDim : 1;
  wrapper.scale.setScalar(scale);
  wrapper.rotation.y = rotationY;

  return wrapper;
}

export async function loadCustomWeapon(
  file: File,
  rotationY = Math.PI
): Promise<CustomWeaponData | null> {
  const ext = file.name.toLowerCase().split('.').pop();
  try {
    if (ext === 'zip') return await loadFromZip(file, rotationY);
    if (ext === 'glb' || ext === 'gltf') return await loadGLTF(file, rotationY);
    if (ext === 'obj') return await loadOBJ(file, rotationY);
    throw new Error('Unsupported format');
  } catch (e) {
    console.error('Custom weapon load failed:', e);
    return null;
  }
}

async function loadFromZip(
  file: File,
  rotationY = Math.PI
): Promise<CustomWeaponData | null> {
  const zip = await JSZip.loadAsync(file);
  let glbFile: JSZip.JSZipObject | null = null;
  let objFile: JSZip.JSZipObject | null = null;
  let mtlFile: JSZip.JSZipObject | null = null;
  let textureFiles: JSZip.JSZipObject[] = [];

  for (const [name, entry] of Object.entries(zip.files)) {
    const lower = name.toLowerCase();
    if (lower.endsWith('.glb') || lower.endsWith('.gltf')) glbFile = entry;
    else if (lower.endsWith('.obj')) objFile = entry;
    else if (lower.endsWith('.mtl')) mtlFile = entry;
    else if (/\.(png|jpg|jpeg|webp)$/i.test(lower)) textureFiles.push(entry);
  }

  if (glbFile) {
    const arrayBuffer = await glbFile.async('arraybuffer');
    return await loadGLTFBuffer(arrayBuffer, rotationY);
  }
  if (objFile) {
    const objText = await objFile.async('text');
    let mtlText: string | null = null;
    if (mtlFile) mtlText = await mtlFile.async('text');
    const textures = new Map<string, THREE.Texture>();
    for (const texFile of textureFiles) {
      const blob = await texFile.async('blob');
      const url = URL.createObjectURL(blob);
      textures.set(texFile.name, new THREE.TextureLoader().load(url));
    }
    return await loadOBJData(objText, mtlText, textures, rotationY);
  }
  throw new Error('No supported model in ZIP');
}

async function loadGLTF(
  file: File,
  rotationY = Math.PI
): Promise<CustomWeaponData | null> {
  const arrayBuffer = await file.arrayBuffer();
  return await loadGLTFBuffer(arrayBuffer, rotationY);
}

async function loadGLTFBuffer(
  buffer: ArrayBuffer,
  rotationY = Math.PI
): Promise<CustomWeaponData> {
  const gltf = await gltfLoader.parseAsync(buffer, '');
  const animations = new Map<string, THREE.AnimationClip>();
  for (const clip of gltf.animations) animations.set(clip.name, clip);

  const model = normalizeWeaponModel(gltf.scene, rotationY);

  return { model, animations, offsets: { ...DEFAULT_OFFSETS } };
}

async function loadOBJ(
  file: File,
  rotationY = Math.PI
): Promise<CustomWeaponData | null> {
  const text = await file.text();
  return await loadOBJData(text, null, new Map(), rotationY);
}

async function loadOBJData(
  objText: string,
  mtlText: string | null,
  textures: Map<string, THREE.Texture>,
  rotationY = Math.PI
): Promise<CustomWeaponData> {
  if (mtlText) {
    const materials = mtlLoader.parse(mtlText, '');
    materials.preload();
    objLoader.setMaterials(materials);
  }

  const object = objLoader.parse(objText);
  const model = normalizeWeaponModel(object, rotationY);

  return { model, animations: new Map(), offsets: { ...DEFAULT_OFFSETS } };
}

export function applyCustomWeapon(weapon: WeaponInstance, customData: CustomWeaponData): void {
  weapon.customModel = customData.model;
  if (weapon.stats.modelOffset) {
    customData.model.position.set(
      weapon.stats.modelOffset.x,
      weapon.stats.modelOffset.y,
      weapon.stats.modelOffset.z
    );
  }
}

export function resetToBaseWeapon(weapon: WeaponInstance, role: Role): void {
  weapon.customModel = null;
}

export const WEAPON_PRESETS = [
  { id: 'm4a1', name: 'M4A1 Carbine (Base)', role: 'ASSAULT' as Role },
  { id: 'hk416', name: 'HK416', role: 'ASSAULT' as Role },
  { id: 'ak74', name: 'AK-74', role: 'ASSAULT' as Role },
  { id: 'scar', name: 'SCAR-L', role: 'ASSAULT' as Role },
  { id: 'aug', name: 'Steyr AUG', role: 'ASSAULT' as Role },
  { id: 'g36', name: 'G36C', role: 'ASSAULT' as Role },
  { id: 'famas', name: 'FAMAS', role: 'ASSAULT' as Role },
  { id: 'tavor', name: 'IWI Tavor', role: 'ASSAULT' as Role }
];
