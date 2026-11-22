import * as THREE from 'three';
import { NavMeshHelper } from '@recast-navigation/three';
import { scene } from '../../core/renderer';
import { getBotNavigation } from '../../ai/bots';
import { allSoldiers, game } from '../../game/state';
import type { NavWorld } from './navWorld';

/**
 * In-game navigation debugging. Toggle with F3 (or load the page with ?navdebug).
 * Shows: navmesh polygons, bot route corners, dynamic obstacle count and nav stats in the console via window.__nav.
 */
let enabled = false;
let helper: NavMeshHelper | null = null;
let helperFor: NavWorld | null = null;
let lines: THREE.LineSegments | null = null;
let lineBuf = new Float32Array(0);
let rebuildTimer = 0;

function disposeHelper(): void {
  if (helper) {
    helper.removeFromParent();
    helper.navMeshGeometry.dispose();
    helper.navMeshMaterial.dispose();
    helper = null;
  }
  helperFor = null;
}

function disposeLines(): void {
  if (lines) {
    lines.removeFromParent();
    lines.geometry.dispose();
    (lines.material as THREE.Material).dispose();
    lines = null;
  }
}

export function setNavDebug(on: boolean): void {
  enabled = on;
  if (!on) {
    disposeHelper();
    disposeLines();
  }
}

export function isNavDebugEnabled(): boolean {
  return enabled;
}

export function initNavDebug(): void {
  if (new URLSearchParams(location.search).has('navdebug')) enabled = true;
  window.addEventListener('keydown', (e) => {
    if (e.code === 'F3') {
      e.preventDefault();
      setNavDebug(!enabled);
    }
  });
  (window as unknown as Record<string, unknown>).__nav = {
    toggle: () => setNavDebug(!enabled),
    stats: () => getBotNavigation()?.stats ?? null,
    world: () => game.navWorld,
  };
}

/** Call once per rendered frame. Cheap when disabled. */
export function updateNavDebug(dt: number): void {
  if (!enabled) return;
  const world = game.navWorld;
  if (!world) return;
  const mesh = world.profile('soldier');

  if (helperFor !== world) {
    disposeHelper();
    helper = new NavMeshHelper(mesh.navMesh, {
      navMeshMaterial: new THREE.MeshBasicMaterial({
        color: 0x22c55e,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    });
    helper.position.y = 0.06;
    scene.add(helper);
    helperFor = world;
  }
  rebuildTimer -= dt;
  if (rebuildTimer <= 0 && helper) {
    rebuildTimer = 0.5;
    // Destroyed props change the navmesh; refresh the debug view.
    helper.update();
  }

  const nav = getBotNavigation();
  if (!nav) return;
  const pts: number[] = [];
  for (const s of allSoldiers) {
    if (s.isPlayer || !s.alive) continue;
    const c = nav.corners(s);
    let px = s.pos.x;
    let py = s.pos.y + 0.2;
    let pz = s.pos.z;
    for (const q of c) {
      pts.push(px, py, pz, q.x, q.y + 0.2, q.z);
      px = q.x;
      py = q.y + 0.2;
      pz = q.z;
    }
  }
  if (!lines) {
    lines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xfacc15, depthTest: false }),
    );
    lines.frustumCulled = false;
    lines.renderOrder = 999;
    scene.add(lines);
  }
  if (lineBuf.length < pts.length) lineBuf = new Float32Array(pts.length * 2);
  lineBuf.set(pts);
  lines.geometry.setAttribute('position', new THREE.BufferAttribute(lineBuf, 3));
  lines.geometry.setDrawRange(0, pts.length / 3);
}
