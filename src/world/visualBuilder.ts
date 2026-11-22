import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CompiledMap, VisualPart } from './def/compile';
import type { MaterialId } from './def/types';
import { createMaterialSet, disposeMaterialSet, type MaterialSet } from './materials';

export interface BuiltVisual {
  group: THREE.Group;
  /** Individually meshed destructible props, by destructible index. */
  destructibleMeshes: Map<number, THREE.Mesh>;
  stats: { drawCalls: number; instancedMeshes: number; instances: number; mergedMeshes: number };
  dispose(): void;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);

function partMatrix(p: VisualPart): THREE.Matrix4 {
  _e.set(p.rot?.[0] ?? 0, p.rot?.[1] ?? 0, p.rot?.[2] ?? 0);
  _q.setFromEuler(_e);
  _p.set(p.center[0], p.center[1], p.center[2]);
  return _m.compose(_p, _q, _s);
}

/**
 * Builds render geometry from VisualParts only (collision and navigation are never derived from it).
 *  - repeated props (same size+material, >=2) -> InstancedMesh
 *  - everything else static -> merged per material
 *  - destructibles keep their own mesh + cloned material (damage tint)
 */
export function buildVisual(map: CompiledMap): BuiltVisual {
  const group = new THREE.Group();
  group.name = `map-visual-${map.def.id}`;
  const needed = new Set<MaterialId>(map.visual.map((v) => v.material));
  const mats = createMaterialSet(needed) as MaterialSet;
  const ownedGeometries: THREE.BufferGeometry[] = [];
  const ownedMaterials: THREE.Material[] = [];
  const destructibleMeshes = new Map<number, THREE.Mesh>();
  const stats = { drawCalls: 0, instancedMeshes: 0, instances: 0, mergedMeshes: 0 };

  const instanceGroups = new Map<string, VisualPart[]>();
  const merge = new Map<MaterialId, VisualPart[]>();
  for (const part of map.visual) {
    if (part.destructibleIndex !== undefined) {
      const geo = new THREE.BoxGeometry(...part.size);
      ownedGeometries.push(geo);
      const mat = mats[part.material].clone();
      ownedMaterials.push(mat);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(...part.center);
      mesh.castShadow = part.castShadow;
      mesh.receiveShadow = part.receiveShadow;
      group.add(mesh);
      destructibleMeshes.set(part.destructibleIndex, mesh);
      stats.drawCalls++;
      continue;
    }
    if (part.instanceable) {
      const key = `${part.material}|${part.size.join(',')}`;
      let list = instanceGroups.get(key);
      if (!list) instanceGroups.set(key, (list = []));
      list.push(part);
    } else {
      let list = merge.get(part.material);
      if (!list) merge.set(part.material, (list = []));
      list.push(part);
    }
  }

  // Instance groups with a single member are cheaper merged.
  for (const [key, list] of instanceGroups) {
    if (list.length >= 2) continue;
    instanceGroups.delete(key);
    const m = list[0].material;
    const bucket = merge.get(m) ?? [];
    bucket.push(list[0]);
    merge.set(m, bucket);
  }

  for (const list of instanceGroups.values()) {
    const first = list[0];
    const geo = new THREE.BoxGeometry(...first.size);
    ownedGeometries.push(geo);
    const mesh = new THREE.InstancedMesh(geo, mats[first.material], list.length);
    list.forEach((p, i) => mesh.setMatrixAt(i, partMatrix(p)));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.frustumCulled = false; // instances are spread over the whole arena
    group.add(mesh);
    stats.instancedMeshes++;
    stats.instances += list.length;
    stats.drawCalls++;
  }

  for (const [material, list] of merge) {
    const geos = list.map((p) => {
      const g = new THREE.BoxGeometry(...p.size);
      g.applyMatrix4(partMatrix(p));
      return g;
    });
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    ownedGeometries.push(merged);
    const mesh = new THREE.Mesh(merged, mats[material]);
    mesh.castShadow = list.some((p) => p.castShadow);
    mesh.receiveShadow = list.some((p) => p.receiveShadow);
    group.add(mesh);
    stats.mergedMeshes++;
    stats.drawCalls++;
  }

  return {
    group,
    destructibleMeshes,
    stats,
    dispose() {
      group.removeFromParent();
      for (const g of ownedGeometries) g.dispose();
      for (const m of ownedMaterials) m.dispose();
      disposeMaterialSet(mats);
      destructibleMeshes.clear();
    },
  };
}
