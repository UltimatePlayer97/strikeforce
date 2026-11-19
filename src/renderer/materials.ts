import * as THREE from 'three';

function createGridTexture(baseHex: string, lineHex: string, repeat = 20): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = lineHex;
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, 256, 256);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(128, 0); ctx.lineTo(128, 256);
  ctx.moveTo(0, 128); ctx.lineTo(256, 128);
  ctx.stroke();
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

export const groundMat = new THREE.MeshStandardMaterial({
  map: createGridTexture('#2a3342', '#394559', 26),
  roughness: 0.88,
  metalness: 0.08
});

export const wallMat = new THREE.MeshStandardMaterial({
  map: createGridTexture('#475569', '#334155', 3),
  roughness: 0.78,
  metalness: 0.12
});

export const crateBlueMat = new THREE.MeshStandardMaterial({
  map: createGridTexture('#1d4ed8', '#1e3a8a', 1),
  roughness: 0.55,
  metalness: 0.35
});

export const crateRedMat = new THREE.MeshStandardMaterial({
  map: createGridTexture('#b91c1c', '#7f1d1d', 1),
  roughness: 0.55,
  metalness: 0.35
});

export const crateOliveMat = new THREE.MeshStandardMaterial({
  map: createGridTexture('#3f6212', '#365314', 1),
  roughness: 0.65,
  metalness: 0.25
});

export const brickMat = new THREE.MeshStandardMaterial({
  map: createGridTexture('#7f3f35', '#4a241f', 5),
  roughness: 0.86,
  metalness: 0.04
});

export const stuccoMat = new THREE.MeshStandardMaterial({
  map: createGridTexture('#b7a27a', '#6f6045', 4),
  roughness: 0.9,
  metalness: 0.03
});

export const asphaltMat = new THREE.MeshStandardMaterial({
  map: createGridTexture('#161b22', '#39404c', 12),
  roughness: 0.94,
  metalness: 0.05
});

export const cityConcreteMat = new THREE.MeshStandardMaterial({
  map: createGridTexture('#374151', '#1f2937', 7),
  roughness: 0.88,
  metalness: 0.12
});

export const carBlueMat = new THREE.MeshStandardMaterial({
  map: createGridTexture('#1e3a8a', '#111827', 1),
  roughness: 0.38,
  metalness: 0.62
});

export const carRedMat = new THREE.MeshStandardMaterial({
  map: createGridTexture('#7f1d1d', '#111827', 1),
  roughness: 0.38,
  metalness: 0.62
});

export const carYellowMat = new THREE.MeshStandardMaterial({
  map: createGridTexture('#92400e', '#111827', 1),
  roughness: 0.38,
  metalness: 0.62
});

export const catwalkMat = new THREE.MeshStandardMaterial({
  map: createGridTexture('#64748b', '#94a3b8', 4),
  roughness: 0.45,
  metalness: 0.65
});

export const materials = {
  ground: groundMat,
  wall: wallMat,
  crateBlue: crateBlueMat,
  crateRed: crateRedMat,
  crateOlive: crateOliveMat,
  brick: brickMat,
  stucco: stuccoMat,
  asphalt: asphaltMat,
  cityConcrete: cityConcreteMat,
  carBlue: carBlueMat,
  carRed: carRedMat,
  carYellow: carYellowMat,
  catwalk: catwalkMat
};