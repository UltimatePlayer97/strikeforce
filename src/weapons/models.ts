import * as THREE from 'three';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import JSZip from 'jszip';
import m4a1EmbeddedUrl from '../assets/m4a1-embedded.json?url';
import { game } from '../game/state';
import { gltfLoader } from '../rig/soldierTemplate';
import { updateWeaponHUD } from '../ui/hud';
import { $ } from '../util/dom';
import type {
  ImportedWeaponView,
  NormalizeOptions,
  Vec3Tuple,
  WeaponId,
  WeaponPreset,
  WeaponPresetSource,
} from '../types';
import { buildStockM4A1, WEAPONS } from './defs';
import { rebuildAllSoldierWeapons } from './viewmodel';

/** Union bounding box of every mesh whose own name or ancestor name matches regex. */
function boxOfNamed(root: THREE.Object3D, re: RegExp): THREE.Box3 | null {
  const box = new THREE.Box3();
  let found = false;
  root.traverse((c) => {
    if (!(c as THREE.Mesh).isMesh) return;
    let n: THREE.Object3D | null = c;
    while (n) {
      if (re.test(n.name || '')) {
        box.expandByObject(c);
        found = true;
        return;
      }
      n = n.parent;
    }
  });
  return found ? box : null;
}

// Bounding box of only the geometry groups using a material whose name matches matRe,
// restricted to meshes whose own/ancestor name matches meshRe (OBJLoader merges multi-material objects into one mesh)
function boxOfMaterial(root: THREE.Object3D, meshRe: RegExp, matRe: RegExp): THREE.Box3 | null {
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  let found = false;
  root.traverse((obj) => {
    const c = obj as THREE.Mesh;
    if (!c.isMesh) return;
    let n: THREE.Object3D | null = c;
    let inside = false;
    while (n) {
      if (meshRe.test(n.name || '')) {
        inside = true;
        break;
      }
      n = n.parent;
    }
    if (!inside) return;
    const mats: THREE.Material[] = Array.isArray(c.material) ? c.material : [c.material];
    const pos = c.geometry.attributes.position;
    const idx = c.geometry.index;
    const ranges: Array<[number, number]> = [];
    if (Array.isArray(c.material)) {
      for (const g of c.geometry.groups) {
        if (matRe.test(mats[g.materialIndex ?? 0]?.name || '')) ranges.push([g.start, g.start + g.count]);
      }
    } else if (matRe.test(mats[0]?.name || '')) {
      ranges.push([0, idx ? idx.count : pos.count]);
    }
    for (const [a, b] of ranges) {
      for (let i = a; i < b; i++) {
        v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(c.matrixWorld);
        box.expandByPoint(v);
        found = true;
      }
    }
  });
  return found ? box : null;
}

const DEFAULT_SIGHT_RE = /optic|scope|holo|red_?dot|kollimator|collimator|eotech|aimpoint|acog|reflex/i;
const DEFAULT_IRON_RE = /iron|sight/i;
const DEFAULT_MUZZLE_RE = /silencer|suppress|muzzle|barrel/i;

export function normalizeImportedWeapon(rawObj: THREE.Object3D, opts: NormalizeOptions = {}): THREE.Group {
  // Drop duplicate stacked variants (CW_M4A1 OBJ has "1_Default__*" + "2_W_Task__*" copies)
  const names: string[] = [];
  rawObj.traverse((c) => {
    if (c.name) names.push(c.name);
  });
  if (names.some((n) => n.startsWith('1_Default__')) && names.some((n) => n.startsWith('2_W_Task__'))) {
    const dupes: THREE.Object3D[] = [];
    rawObj.traverse((c) => {
      if (c.name && c.name.startsWith('1_Default__')) dupes.push(c);
    });
    dupes.forEach((c) => c.parent && c.parent.remove(c));
  }

  const wrapper = new THREE.Group();
  const pivot = new THREE.Group(); // rotate here, not on rawObj
  const box = new THREE.Box3().setFromObject(rawObj);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const scale = (opts.length || 0.78) / maxDim;

  rawObj.scale.setScalar(scale);
  rawObj.position.copy(center).multiplyScalar(-scale); // center at pivot origin

  // Orient longest axis along -Z (forward barrel direction)
  if (size.x > size.z && size.x >= size.y) {
    pivot.rotation.y = Math.PI / 2;
  }

  rawObj.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      // Weapons are small and held close to the body: skip shadow pass work.
      child.castShadow = false;
      child.receiveShadow = false;
    }
  });

  pivot.add(rawObj);
  wrapper.add(pivot);

  // ---- Auto-detect sight + muzzle so ADS aligns the sight with screen center ----
  wrapper.updateMatrixWorld(true);
  const whole = new THREE.Box3().setFromObject(wrapper);
  const wc = whole.getCenter(new THREE.Vector3());

  let sightBox = boxOfNamed(wrapper, opts.sight || DEFAULT_SIGHT_RE);
  if (!sightBox) sightBox = boxOfNamed(wrapper, DEFAULT_IRON_RE);
  let sight: Vec3Tuple;
  let glassR = 0.02;
  let rearOffset = 0.03;
  if (sightBox) {
    const sre = opts.sight || DEFAULT_SIGHT_RE;
    // Aim point = center of the optic's glass window (not the whole housing)
    const glassBox = boxOfMaterial(wrapper, sre, /glass|lens/i);
    const c = (glassBox || sightBox).getCenter(new THREE.Vector3());
    sight = [c.x, c.y + (opts.sightYOffset || 0), c.z];
    if (glassBox) {
      const d = glassBox.getSize(new THREE.Vector3());
      const dims = [d.x, d.y, d.z].sort((p, q) => q - p);
      glassR = dims[1] / 2; // ignore lens thickness
    }
    rearOffset = Math.max(0, sightBox.max.z - sight[2]);
  } else {
    // No sight found: assume rear-top of receiver
    sight = [wc.x, whole.max.y * 0.92, whole.max.z - (whole.max.z - whole.min.z) * 0.3];
  }

  const muzzleBox = boxOfNamed(wrapper, opts.muzzle || DEFAULT_MUZZLE_RE);
  const muzzle: Vec3Tuple = [
    muzzleBox ? muzzleBox.getCenter(new THREE.Vector3()).x : wc.x,
    muzzleBox ? muzzleBox.getCenter(new THREE.Vector3()).y : wc.y,
    whole.min.z,
  ];
  const view: ImportedWeaponView = { sight, muzzle, adsDist: opts.adsDist || 0, glassR, rearOffset };
  wrapper.userData.view = view;
  return wrapper;
}

// ===========================================================================
// Weapon instances
// ===========================================================================
type ClassModelId = 'assault' | 'smg' | 'sniper';
const classWeaponProtos: Record<ClassModelId, THREE.Group | null> = {
  assault: null,
  smg: null,
  sniper: null,
};
const procWeaponCache: Partial<Record<WeaponId, THREE.Group>> = {};

function cloneClassWeapon(id: WeaponId): THREE.Group | null {
  const proto = id in classWeaponProtos ? classWeaponProtos[id as ClassModelId] : null;
  return proto ? (proto.clone(true) as THREE.Group) : null;
}

export function createWeaponInstance(id: WeaponId = 'assault'): THREE.Group {
  const classWeapon = cloneClassWeapon(id);
  if (classWeapon) return classWeapon;
  if (id === 'assault') {
    return game.customWeaponPrototype
      ? (game.customWeaponPrototype.clone(true) as THREE.Group)
      : buildStockM4A1();
  }
  const def = WEAPONS[id];
  if (!def || !def.build) return buildStockM4A1();
  let cached = procWeaponCache[id];
  if (!cached) {
    cached = def.build();
    procWeaponCache[id] = cached;
  }
  return cached.clone(true) as THREE.Group;
}

export function weaponLabel(id: WeaponId): string {
  return id === 'assault' ? game.currentWeaponDisplayName : (WEAPONS[id] || WEAPONS.assault).label;
}

// ===========================================================================
// Presets (folder-based OBJ/MTL, auto sight alignment for ADS)
// Add a weapon: drop files in public/models/<id>/ and add an entry here.
//   sight  : regex matching the optic/sight node name  -> ADS centers on it
//   muzzle : regex matching the muzzle/suppressor node -> flash + tracer origin
//   sightYOffset : nudge reticle (+up / -down) in weapon units
//   length : normalized weapon length in meters
// ===========================================================================
const WEAPON_PRESETS: Record<string, WeaponPreset> = {
  m4a1: {
    label: 'M4A1 Custom (H1 Holo + Suppressor) — BASE',
    name: 'CW_M4A1_CUSTOM',
    // Uses files served from public/models/; the embedded copy is the fallback.
    sources: [{ path: 'models/', obj: 'model.obj', mtl: 'model.mtl' }, { embedded: true }],
    adsDist: 0.18,
    sight: /optic_h1|h1high|scope_h1/i,
    muzzle: /silencer/i,
    sightYOffset: 0.0,
    length: 0.78,
  },
};
export const BASE_PRESET_ID = 'm4a1';

interface ClassModelSpec {
  url: string;
  normalize: NormalizeOptions;
}

const WEAPON_CLASS_MODEL_SPECS: Partial<Record<ClassModelId, ClassModelSpec>> = {
  smg: {
    url: 'models/mp5_submachine_gun__low_poly_game_ready_3d.glb',
    normalize: { length: 0.62, sight: /scope|sight|optic|iron/i, muzzle: /silencer|suppress|muzzle|barrel/i },
  },
  sniper: {
    url: 'models/awp.glb',
    normalize: { length: 1.02, sight: /scope|soshki/i, muzzle: /silencer|suppress|muzzle|barrel/i },
  },
};

export function loadClassWeaponPrototype(id: ClassModelId): void {
  const spec = WEAPON_CLASS_MODEL_SPECS[id];
  if (!spec) return;
  gltfLoader.load(
    spec.url,
    (gltf) => {
      classWeaponProtos[id] = normalizeImportedWeapon(gltf.scene, spec.normalize);
      console.info(`${id.toUpperCase()} class model loaded from ${spec.url}`);
      rebuildAllSoldierWeapons();
    },
    undefined,
    (err) => console.warn(`Class model failed for ${id}; using built-in fallback`, err),
  );
}

function tuneWeaponMaterials(mtl: MTLLoader.MaterialCreator): void {
  for (const m of Object.values(mtl.materials) as THREE.Material[]) {
    // Optic glass must not black out the sight picture while aiming
    if (/glass|lens/i.test(m.name)) {
      m.transparent = true;
      m.opacity = 0.1;
      m.depthWrite = false;
    }
  }
}

interface EmbeddedModel {
  obj_gz: string;
  mtl: string;
  tex: Record<string, string>;
}

function hasMesh(obj: THREE.Object3D): boolean {
  let found = false;
  obj.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) found = true;
  });
  return found;
}

async function loadPresetFromSource(src: WeaponPresetSource): Promise<THREE.Group> {
  if (src.embedded) {
    const res = await fetch(m4a1EmbeddedUrl);
    const data = (await res.json()) as EmbeddedModel;
    const bin = Uint8Array.from(atob(data.obj_gz), (c) => c.charCodeAt(0));
    const objText = await new Response(
      new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip')),
    ).text();
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => data.tex[url.split('/').pop() ?? ''] || url);
    const mtl = new MTLLoader(manager).parse(data.mtl, '');
    mtl.preload();
    tuneWeaponMaterials(mtl);
    return new OBJLoader(manager).setMaterials(mtl).parse(objText);
  }
  const path = src.path ?? '';
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => (path ? path + (url.split('/').pop() ?? '') : url));
  const mtl = await new MTLLoader(manager).setPath(path).loadAsync(src.mtl ?? '');
  mtl.preload();
  tuneWeaponMaterials(mtl);
  const obj = await new OBJLoader(manager)
    .setMaterials(mtl)
    .setPath(path)
    .loadAsync(src.obj ?? '');
  // Vite's dev server answers missing files with index.html (HTTP 200), which parses
  // as an empty OBJ. Treat "no geometry" as a failed source so the next one is tried.
  if (!hasMesh(obj)) throw new Error(`No geometry in ${path}${src.obj}`);
  return obj;
}

export async function loadWeaponPreset(id: string): Promise<boolean> {
  const p = WEAPON_PRESETS[id];
  if (!p) return false;
  const badge = $('load-status-badge');
  badge.textContent = `Loading ${p.name}...`;
  for (const src of p.sources) {
    try {
      const obj = await loadPresetFromSource(src);
      game.customWeaponPrototype = normalizeImportedWeapon(obj, p);
      game.currentWeaponDisplayName = p.name;
      rebuildAllSoldierWeapons();
      updateWeaponHUD();
      badge.textContent = `Loaded: ${p.name}`;
      console.info('Weapon preset loaded from', src.embedded ? 'embedded copy' : `${src.path}${src.obj}`);
      return true;
    } catch (err) {
      console.warn('Weapon source failed, trying next:', src, err);
    }
  }
  game.customWeaponPrototype = null;
  game.currentWeaponDisplayName = 'M4A1 CARBINE';
  rebuildAllSoldierWeapons();
  updateWeaponHUD();
  badge.textContent = 'Preset load failed — stock M4A1';
  return false;
}

// ===========================================================================
// Custom .ZIP / .OBJ / .GLB upload
// ===========================================================================
function applyImportedWeapon(obj: THREE.Object3D, fileName: string, status: string): void {
  game.customWeaponPrototype = normalizeImportedWeapon(obj);
  game.currentWeaponDisplayName = fileName.replace(/\.[^/.]+$/, '').toUpperCase();
  rebuildAllSoldierWeapons();
  updateWeaponHUD();
  $('load-status-badge').textContent = `${status}${game.currentWeaponDisplayName}`;
}

async function importWeaponFile(file: File): Promise<void> {
  const badge = $('load-status-badge');
  badge.textContent = 'Importing Weapon...';
  try {
    const lowerName = file.name.toLowerCase();
    if (lowerName.endsWith('.glb') || lowerName.endsWith('.gltf')) {
      const buf = await file.arrayBuffer();
      gltfLoader.parse(buf, '', (gltf) => applyImportedWeapon(gltf.scene, file.name, 'Loaded: '));
    } else if (lowerName.endsWith('.obj')) {
      const text = await file.text();
      applyImportedWeapon(new OBJLoader().parse(text), file.name, 'Loaded: ');
    } else if (lowerName.endsWith('.zip')) {
      const zip = await JSZip.loadAsync(file);
      const entries = Object.values(zip.files).filter((f) => !f.dir);
      const blobUrls: Record<string, string> = {};

      for (const entry of entries) {
        const blob = await entry.async('blob');
        const baseName = entry.name.split('/').pop() ?? entry.name;
        blobUrls[entry.name] = URL.createObjectURL(blob);
        blobUrls[baseName] = blobUrls[entry.name];
      }

      const glbEntry = entries.find(
        (f) => f.name.toLowerCase().endsWith('.glb') || f.name.toLowerCase().endsWith('.gltf'),
      );
      const objEntry = entries.find((f) => f.name.toLowerCase().endsWith('.obj'));
      const mtlEntry = entries.find((f) => f.name.toLowerCase().endsWith('.mtl'));

      if (glbEntry) {
        const buf = await glbEntry.async('arraybuffer');
        gltfLoader.parse(buf, '', (gltf) => applyImportedWeapon(gltf.scene, file.name, 'Loaded ZIP: '));
      } else if (objEntry) {
        const manager = new THREE.LoadingManager();
        manager.setURLModifier((url) => {
          const clean = url.split('/').pop() ?? url;
          return blobUrls[url] || blobUrls[clean] || url;
        });

        const objLoader = new OBJLoader(manager);
        if (mtlEntry) {
          const mtlText = await mtlEntry.async('text');
          const materials = new MTLLoader(manager).parse(mtlText, '');
          materials.preload();
          objLoader.setMaterials(materials);
        }
        const objText = await objEntry.async('text');
        applyImportedWeapon(objLoader.parse(objText), file.name, 'Loaded ZIP: ');
      } else {
        badge.textContent = 'No .OBJ/.GLB found in ZIP';
      }
    }
  } catch (err) {
    console.error(err);
    badge.textContent = 'Import Error — Using M4A1';
  }
}

/** Wires up the armory controls (preset select, upload, reset). Call once DOM is ready. */
export function initWeaponArmoryUI(): void {
  const fileInput = $<HTMLInputElement>('weapon-file-input');
  const resetBtn = $('reset-weapon-btn');
  const presetSelect = $<HTMLSelectElement>('weapon-preset-select');

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) void importWeaponFile(file);
  });

  for (const [id, p] of Object.entries(WEAPON_PRESETS)) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = p.label;
    presetSelect.appendChild(opt);
  }
  presetSelect.addEventListener('change', () => void loadWeaponPreset(presetSelect.value));

  resetBtn.addEventListener('click', () => {
    presetSelect.value = BASE_PRESET_ID;
    void loadWeaponPreset(BASE_PRESET_ID);
  });

  // Class models: MP5 and AWP are real game assets, not procedural stand-ins.
  loadClassWeaponPrototype('smg');
  loadClassWeaponPrototype('sniper');
}
