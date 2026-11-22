import * as THREE from 'three';
import type { WeaponDef, WeaponId } from '../types';

// ===========================================================================
// PBR M4A1 stock carbine (procedural fallback when no model is loaded)
// ===========================================================================
export function buildStockM4A1(): THREE.Group {
  const gun = new THREE.Group();

  const receiverMat = new THREE.MeshStandardMaterial({ color: 0x1e242b, roughness: 0.36, metalness: 0.82 });
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x11161d, roughness: 0.28, metalness: 0.9 });
  const tanRailMat = new THREE.MeshStandardMaterial({ color: 0x786855, roughness: 0.55, metalness: 0.35 });
  const opticGlassMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.32,
    side: THREE.DoubleSide,
  });
  const reticleMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });

  // Upper & Lower Receiver
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.088, 0.26), receiverMat);
  receiver.position.set(0, 0.01, 0);
  gun.add(receiver);

  // SOPMOD Buttstock
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.105, 0.2), tanRailMat);
  stock.position.set(0, -0.005, 0.22);
  gun.add(stock);

  // Pistol Grip
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.11, 0.052), tanRailMat);
  grip.position.set(0, -0.075, 0.075);
  grip.rotation.x = 0.28;
  gun.add(grip);

  // Curved 30-rd STANAG Magazine
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.16, 0.068), receiverMat);
  mag.position.set(0, -0.095, -0.045);
  mag.rotation.x = -0.18;
  gun.add(mag);

  // Quad-Rail Handguard
  const handguard = new THREE.Mesh(new THREE.BoxGeometry(0.056, 0.064, 0.27), tanRailMat);
  handguard.position.set(0, 0.018, -0.255);
  gun.add(handguard);

  // Angled Foregrip
  const foregrip = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.055, 0.075), receiverMat);
  foregrip.position.set(0, -0.032, -0.25);
  foregrip.rotation.x = -0.35;
  gun.add(foregrip);

  // Fluted Barrel & Flash Hider
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.22, 12), barrelMat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.022, -0.47);
  gun.add(barrel);

  const muzzleBrake = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.048, 12), barrelMat);
  muzzleBrake.rotation.x = Math.PI / 2;
  muzzleBrake.position.set(0, 0.022, -0.59);
  gun.add(muzzleBrake);

  // Holographic EOTech Reflex Sight (Aligned with ADS eye line!)
  const opticHood = new THREE.Mesh(new THREE.BoxGeometry(0.056, 0.054, 0.078), receiverMat);
  opticHood.position.set(0, 0.082, -0.01);
  gun.add(opticHood);

  const opticLens = new THREE.Mesh(new THREE.PlaneGeometry(0.042, 0.038), opticGlassMat);
  opticLens.position.set(0, 0.084, -0.01);
  gun.add(opticLens);

  // Glowing Red Holo Dot + Ring
  const holoDot = new THREE.Mesh(new THREE.CircleGeometry(0.0022, 12), reticleMat);
  holoDot.position.set(0, 0.084, -0.009);
  gun.add(holoDot);

  const holoRing = new THREE.Mesh(new THREE.RingGeometry(0.0085, 0.0102, 20), reticleMat);
  holoRing.position.set(0, 0.084, -0.009);
  gun.add(holoRing);

  // Side Tactical PEQ Laser Box
  const peq = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.032, 0.085), tanRailMat);
  peq.position.set(0.042, 0.026, -0.31);
  gun.add(peq);

  return gun;
}

// =========================================================================
// 8b. LOADOUT SYSTEM: 5 CLASSES (ASSAULT = custom M4A1 blueprint above)
//   stats   = [damage, fire rate, range, mobility] 1-5 (menu bars only)
//   falloff = { start, end, min }: damage mult slides 1 -> min between start..end metres
//   bot*    = AI tuning (engage range, burst length, delay mult, aim error mult)

// ===========================================================================
// Loadout classes (ASSAULT = custom M4A1 blueprint above)
//   stats   = [damage, fire rate, range, mobility] 1-5 (menu bars only)
//   falloff = { start, end, min }: damage mult slides 1 -> min between start..end metres
//   bot*    = AI tuning (engage range, burst length, delay mult, aim error mult)
// ===========================================================================
const GM = {
  dark: new THREE.MeshStandardMaterial({ color: 0x1e242b, roughness: 0.38, metalness: 0.8 }),
  black: new THREE.MeshStandardMaterial({ color: 0x0f1318, roughness: 0.3, metalness: 0.9 }),
  tan: new THREE.MeshStandardMaterial({ color: 0x786855, roughness: 0.55, metalness: 0.35 }),
  olive: new THREE.MeshStandardMaterial({ color: 0x4a5340, roughness: 0.6, metalness: 0.3 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x6b4426, roughness: 0.7, metalness: 0.08 }),
  glass: new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.18,
    side: THREE.DoubleSide,
    depthWrite: false,
  }),
  red: new THREE.MeshBasicMaterial({ color: 0xef4444 }),
};

function gBox(
  g: THREE.Group,
  mat: THREE.Material,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  rx = 0,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.x = rx;
  m.castShadow = false;
  m.receiveShadow = false;
  g.add(m);
  return m;
}
function gCyl(
  g: THREE.Group,
  mat: THREE.Material,
  r1: number,
  r2: number,
  len: number,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, len, 12), mat);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  m.castShadow = false;
  m.receiveShadow = false;
  g.add(m);
  return m;
}
// Hollow window frame (4 thin bars) so the ADS sight picture is never blocked
function gSightFrame(
  g: THREE.Group,
  mat: THREE.Material,
  cx: number,
  cy: number,
  cz: number,
  w: number,
  h: number,
  depth: number,
  t = 0.004,
): void {
  gBox(g, mat, w, t, depth, cx, cy + h / 2 - t / 2, cz);
  gBox(g, mat, w, t, depth, cx, cy - h / 2 + t / 2, cz);
  gBox(g, mat, t, h, depth, cx - w / 2 + t / 2, cy, cz);
  gBox(g, mat, t, h, depth, cx + w / 2 - t / 2, cy, cz);
}
function gSightGlass(g: THREE.Group, cx: number, cy: number, cz: number, w: number, h: number): void {
  const lens = new THREE.Mesh(new THREE.PlaneGeometry(w, h), GM.glass);
  lens.position.set(cx, cy, cz);
  g.add(lens);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0022, 12), GM.red);
  dot.position.set(cx, cy, cz + 0.0005);
  g.add(dot);
}

function buildSMG(): THREE.Group {
  const g = new THREE.Group();
  gBox(g, GM.dark, 0.05, 0.08, 0.3, 0, 0.01, -0.02); // receiver
  gBox(g, GM.black, 0.03, 0.05, 0.17, 0, 0.012, 0.23); // collapsed stock
  gBox(g, GM.black, 0.044, 0.07, 0.02, 0, 0.0, 0.32); // butt pad
  gBox(g, GM.tan, 0.04, 0.11, 0.05, 0, -0.075, 0.07, 0.28); // grip
  gBox(g, GM.dark, 0.032, 0.18, 0.045, 0, -0.125, -0.06); // long straight mag
  gBox(g, GM.tan, 0.05, 0.055, 0.15, 0, 0.012, -0.245); // handguard
  gBox(g, GM.dark, 0.034, 0.05, 0.05, 0, -0.04, -0.24, -0.3); // foregrip stub
  gCyl(g, GM.black, 0.01, 0.01, 0.1, 0, 0.02, -0.37); // barrel
  gCyl(g, GM.black, 0.019, 0.019, 0.17, 0, 0.02, -0.46); // suppressor
  gBox(g, GM.black, 0.04, 0.02, 0.07, 0, 0.06, -0.02); // reflex base
  gSightFrame(g, GM.black, 0, 0.088, -0.02, 0.044, 0.04, 0.05);
  gSightGlass(g, 0, 0.088, -0.02, 0.036, 0.032);
  return g;
}

function buildSniper(): THREE.Group {
  const g = new THREE.Group();
  gBox(g, GM.dark, 0.05, 0.085, 0.32, 0, 0.01, 0); // receiver
  gBox(g, GM.olive, 0.046, 0.1, 0.28, 0, -0.012, 0.29); // stock
  gBox(g, GM.olive, 0.04, 0.035, 0.14, 0, 0.055, 0.27); // cheek riser
  gBox(g, GM.black, 0.05, 0.11, 0.02, 0, -0.01, 0.44); // recoil pad
  gBox(g, GM.olive, 0.04, 0.11, 0.05, 0, -0.078, 0.09, 0.28); // grip
  gBox(g, GM.dark, 0.034, 0.075, 0.075, 0, -0.075, -0.05); // mag
  gBox(g, GM.olive, 0.052, 0.05, 0.26, 0, 0.008, -0.27); // handguard
  gCyl(g, GM.black, 0.011, 0.013, 0.62, 0, 0.022, -0.56); // long barrel
  gCyl(g, GM.black, 0.019, 0.019, 0.075, 0, 0.022, -0.905); // muzzle brake
  gBox(g, GM.black, 0.006, 0.006, 0.12, -0.024, -0.03, -0.42); // bipod legs (folded)
  gBox(g, GM.black, 0.006, 0.006, 0.12, 0.024, -0.03, -0.42);
  gBox(g, GM.black, 0.06, 0.012, 0.012, 0.045, 0.02, 0.07); // bolt handle
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 8), GM.black);
  knob.position.set(0.078, 0.02, 0.07);
  g.add(knob);
  gCyl(g, GM.black, 0.022, 0.022, 0.3, 0, 0.098, -0.02); // scope tube
  gCyl(g, GM.black, 0.032, 0.026, 0.07, 0, 0.098, -0.19); // objective bell
  gCyl(g, GM.black, 0.027, 0.03, 0.05, 0, 0.098, 0.15); // eyepiece
  gBox(g, GM.dark, 0.02, 0.04, 0.03, 0, 0.065, -0.1); // mounts
  gBox(g, GM.dark, 0.02, 0.04, 0.03, 0, 0.065, 0.07);
  return g;
}

function buildShotgun(): THREE.Group {
  const g = new THREE.Group();
  gBox(g, GM.dark, 0.05, 0.08, 0.26, 0, 0.012, 0); // receiver
  gBox(g, GM.wood, 0.046, 0.11, 0.25, 0, -0.012, 0.25); // stock
  gBox(g, GM.black, 0.05, 0.115, 0.02, 0, -0.012, 0.38); // pad
  gBox(g, GM.wood, 0.04, 0.1, 0.05, 0, -0.07, 0.08, 0.28); // grip
  gCyl(g, GM.black, 0.017, 0.017, 0.52, 0, 0.03, -0.39); // barrel
  gCyl(g, GM.dark, 0.014, 0.014, 0.44, 0, -0.005, -0.36); // mag tube
  gBox(g, GM.wood, 0.062, 0.05, 0.17, 0, -0.003, -0.26); // pump forend
  gCyl(g, GM.black, 0.021, 0.021, 0.03, 0, 0.03, -0.66); // muzzle
  gBox(g, GM.red, 0.006, 0.026, 0.006, 0, 0.066, -0.64); // front bead
  gBox(g, GM.black, 0.03, 0.016, 0.03, 0, 0.056, 0.03); // rear base
  gSightFrame(g, GM.black, 0, 0.066, 0.03, 0.03, 0.03, 0.01, 0.006); // ghost ring
  return g;
}

function buildLMG(): THREE.Group {
  const g = new THREE.Group();
  gBox(g, GM.dark, 0.06, 0.1, 0.38, 0, 0.01, 0); // receiver
  gBox(g, GM.dark, 0.07, 0.03, 0.22, 0, 0.075, -0.04); // feed cover
  gBox(g, GM.olive, 0.09, 0.11, 0.13, 0, -0.105, -0.03); // ammo box
  gBox(g, GM.olive, 0.05, 0.11, 0.24, 0, -0.01, 0.31); // stock
  gBox(g, GM.black, 0.052, 0.12, 0.02, 0, -0.01, 0.44); // pad
  gBox(g, GM.tan, 0.04, 0.11, 0.05, 0, -0.08, 0.1, 0.28); // grip
  gBox(g, GM.tan, 0.066, 0.07, 0.26, 0, 0.012, -0.32); // shroud
  gCyl(g, GM.black, 0.014, 0.016, 0.34, 0, 0.02, -0.62); // heavy barrel
  gCyl(g, GM.black, 0.022, 0.022, 0.07, 0, 0.02, -0.82); // flash hider
  gBox(g, GM.black, 0.008, 0.008, 0.16, -0.032, -0.035, -0.52); // bipod legs (folded)
  gBox(g, GM.black, 0.008, 0.008, 0.16, 0.032, -0.035, -0.52);
  gBox(g, GM.black, 0.04, 0.02, 0.07, 0, 0.1, 0.04); // optic base
  gSightFrame(g, GM.black, 0, 0.128, 0.04, 0.044, 0.04, 0.05);
  gSightGlass(g, 0, 0.128, 0.04, 0.036, 0.032);
  return g;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  assault: {
    id: 'assault',
    cls: 'ASSAULT',
    role: 'Assault Rifle',
    tag: 'M4A1',
    label: 'M4A1 CARBINE',
    mag: 30,
    reserve: 180,
    cooldown: 0.095,
    auto: true,
    dmg: 29,
    head: 42,
    pellets: 1,
    pelletSpread: 0,
    reload: 1.75,
    shell: false,
    shellTime: 0,
    spreadHip: 0.011,
    spreadMove: 0.022,
    spreadAds: 0.0025,
    speed: 1.0,
    adsFov: 48,
    adsSens: 0.62,
    scope: false,
    reticle: true,
    kick: 1.0,
    chScale: 1.0,
    falloff: null,
    botRange: 70,
    botBurst: [3, 6],
    botDelay: 1.0,
    botSigma: 1.0,
    engage: 18,
    minDist: 8,
    sightMul: 1,
    stats: [3, 3, 4, 3],
    hint: '[LMB] Fire (auto) &bull; [RMB] ADS &bull; [R] Reload',
  },
  smg: {
    id: 'smg',
    cls: 'SMG',
    role: 'Submachine Gun',
    tag: 'SMG',
    label: 'VESPER-9 SMG',
    mag: 32,
    reserve: 192,
    cooldown: 0.07,
    auto: true,
    dmg: 22,
    head: 33,
    pellets: 1,
    pelletSpread: 0,
    reload: 1.5,
    shell: false,
    shellTime: 0,
    spreadHip: 0.016,
    spreadMove: 0.028,
    spreadAds: 0.005,
    speed: 1.1,
    adsFov: 58,
    adsSens: 0.8,
    scope: false,
    reticle: true,
    kick: 0.7,
    chScale: 1.1,
    falloff: { start: 14, end: 38, min: 0.6 },
    botRange: 40,
    botBurst: [4, 8],
    botDelay: 0.8,
    botSigma: 1.15,
    engage: 13,
    minDist: 5,
    sightMul: 1,
    stats: [2, 5, 2, 5],
    hint: '[LMB] Fire (auto) &bull; [RMB] ADS &bull; [R] Reload &bull; Fast + mobile, weak at range',
    view: { hip: [0.17, -0.16, -0.34], ads: [0, -0.088, -0.2], muzzle: [0, 0.02, -0.57], lhand: -0.23 },
    build: buildSMG,
  },
  sniper: {
    id: 'sniper',
    cls: 'SNIPER',
    role: 'Bolt-Action Sniper',
    tag: 'SNIPER',
    label: 'LONGSHOT SNIPER',
    mag: 5,
    reserve: 30,
    cooldown: 1.2,
    auto: false,
    dmg: 70,
    upper: 100,
    head: 115,
    pellets: 1,
    pelletSpread: 0,
    reload: 3.2,
    shell: false,
    shellTime: 0,
    spreadHip: 0.07,
    spreadMove: 0.11,
    spreadAds: 0.0006,
    speed: 0.9,
    adsFov: 14,
    adsSens: 0.22,
    scope: true,
    reticle: false,
    kick: 3.2,
    chScale: 2.0,
    falloff: null,
    botRange: 110,
    botBurst: [1, 1],
    botDelay: 0.5,
    botSigma: 1.6,
    engage: 38,
    minDist: 20,
    sightMul: 1.7,
    stats: [5, 1, 5, 2],
    hint: '[LMB] Fire (bolt) &bull; [RMB] Scope &bull; [R] Reload &bull; Chest and head are 1-shot; legs need more',
    view: { hip: [0.18, -0.17, -0.46], ads: [0, -0.098, -0.2], muzzle: [0, 0.022, -0.95], lhand: -0.28 },
    build: buildSniper,
  },
  shotgun: {
    id: 'shotgun',
    cls: 'SHOTGUN',
    role: 'Pump Shotgun',
    tag: 'SHOTGUN',
    label: 'BREACHER 12G',
    mag: 6,
    reserve: 36,
    cooldown: 0.8,
    auto: false,
    dmg: 13,
    head: 17,
    pellets: 9,
    pelletSpread: 0.085,
    reload: 0.55,
    shell: true,
    shellTime: 0.55,
    spreadHip: 0.011,
    spreadMove: 0.02,
    spreadAds: 0.004,
    speed: 1.0,
    adsFov: 60,
    adsSens: 0.85,
    scope: false,
    reticle: false,
    kick: 2.4,
    chScale: 2.2,
    falloff: { start: 6, end: 20, min: 0.12 },
    botRange: 20,
    botBurst: [1, 2],
    botDelay: 0.5,
    botSigma: 0.9,
    engage: 8,
    minDist: 2.5,
    sightMul: 1,
    stats: [5, 2, 1, 4],
    hint: '[LMB] Fire (pump) &bull; [RMB] ADS &bull; [R] Load shells (fire to interrupt)',
    view: { hip: [0.18, -0.17, -0.4], ads: [0, -0.066, -0.25], muzzle: [0, 0.03, -0.7], lhand: -0.26 },
    build: buildShotgun,
  },
  lmg: {
    id: 'lmg',
    cls: 'LMG',
    role: 'Light Machine Gun',
    tag: 'LMG',
    label: 'HAMMER LMG',
    mag: 100,
    reserve: 200,
    cooldown: 0.085,
    auto: true,
    dmg: 24,
    head: 35,
    pellets: 1,
    pelletSpread: 0,
    reload: 4.6,
    shell: false,
    shellTime: 0,
    spreadHip: 0.02,
    spreadMove: 0.035,
    spreadAds: 0.0045,
    speed: 0.82,
    adsFov: 56,
    adsSens: 0.7,
    scope: false,
    reticle: true,
    kick: 1.25,
    chScale: 1.3,
    falloff: { start: 35, end: 95, min: 0.72 },
    botRange: 62,
    botBurst: [6, 12],
    botDelay: 1.1,
    botSigma: 1.25,
    engage: 24,
    minDist: 10,
    sightMul: 1,
    stats: [3, 4, 3, 1],
    hint: '[LMB] Fire (auto) &bull; [RMB] ADS &bull; [R] Reload &bull; 100 rnds, slow + heavy',
    view: { hip: [0.19, -0.18, -0.45], ads: [0, -0.128, -0.28], muzzle: [0, 0.02, -0.86], lhand: -0.3 },
    build: buildLMG,
  },
};

export function weaponOf(s: { weaponId: WeaponId }): WeaponDef {
  return WEAPONS[s.weaponId] || WEAPONS.assault;
}

export function isWeaponId(id: string | null | undefined): id is WeaponId {
  return !!id && id in WEAPONS;
}

const BOT_LOADOUT_POOL: ReadonlyArray<readonly [WeaponId, number]> = [
  ['assault', 30],
  ['smg', 22],
  ['lmg', 14],
  ['shotgun', 17],
  ['sniper', 17],
];

export function pickBotLoadout(): WeaponId {
  let r = Math.random() * 100;
  for (const [id, wt] of BOT_LOADOUT_POOL) {
    r -= wt;
    if (r < 0) return id;
  }
  return 'assault';
}
