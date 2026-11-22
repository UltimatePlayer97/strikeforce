import * as THREE from 'three';
import type { MaterialId } from './def/types';

export function createGridTexture(baseHex: string, lineHex: string, repeat = 20): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = lineHex;
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, 256, 256);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(128, 0);
  ctx.lineTo(128, 256);
  ctx.moveTo(0, 128);
  ctx.lineTo(256, 128);
  ctx.stroke();
  // Subtle concrete speckle
  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  for (let i = 0; i < 180; i++) {
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  return tex;
}

interface MaterialSpec {
  base: string;
  line: string;
  repeat: number;
  roughness: number;
  metalness: number;
}

const SPECS: Record<MaterialId, MaterialSpec> = {
  ground: { base: '#2a3342', line: '#394559', repeat: 26, roughness: 0.88, metalness: 0.08 },
  wall: { base: '#475569', line: '#334155', repeat: 3, roughness: 0.78, metalness: 0.12 },
  crateBlue: { base: '#1d4ed8', line: '#1e3a8a', repeat: 1, roughness: 0.55, metalness: 0.35 },
  crateRed: { base: '#b91c1c', line: '#7f1d1d', repeat: 1, roughness: 0.55, metalness: 0.35 },
  crateOlive: { base: '#3f6212', line: '#365314', repeat: 1, roughness: 0.65, metalness: 0.25 },
  brick: { base: '#7f3f35', line: '#4a241f', repeat: 5, roughness: 0.86, metalness: 0.04 },
  stucco: { base: '#b7a27a', line: '#6f6045', repeat: 4, roughness: 0.9, metalness: 0.03 },
  asphalt: { base: '#161b22', line: '#39404c', repeat: 12, roughness: 0.94, metalness: 0.05 },
  cityConcrete: { base: '#374151', line: '#1f2937', repeat: 7, roughness: 0.88, metalness: 0.12 },
  carBlue: { base: '#1e3a8a', line: '#111827', repeat: 1, roughness: 0.38, metalness: 0.62 },
  carRed: { base: '#7f1d1d', line: '#111827', repeat: 1, roughness: 0.38, metalness: 0.62 },
  carYellow: { base: '#92400e', line: '#111827', repeat: 1, roughness: 0.38, metalness: 0.62 },
  catwalk: { base: '#64748b', line: '#94a3b8', repeat: 4, roughness: 0.45, metalness: 0.65 },
};

export type MaterialSet = Record<MaterialId, THREE.MeshStandardMaterial>;

/** Materials are created per loaded map and disposed (with their textures) when the map unloads. */
export function createMaterialSet(needed?: Iterable<MaterialId>): Partial<MaterialSet> {
  const out: Partial<MaterialSet> = {};
  const ids = needed ? new Set(needed) : new Set(Object.keys(SPECS) as MaterialId[]);
  for (const id of ids) {
    const s = SPECS[id];
    out[id] = new THREE.MeshStandardMaterial({
      map: createGridTexture(s.base, s.line, s.repeat),
      roughness: s.roughness,
      metalness: s.metalness,
    });
  }
  return out;
}

export function disposeMaterialSet(set: Partial<MaterialSet>): void {
  for (const m of Object.values(set)) {
    if (!m) continue;
    m.map?.dispose();
    m.dispose();
  }
}
