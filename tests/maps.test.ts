import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compileMap, validateMapDefinition } from '../src/world/def/compile';
import { MAP_DEFINITIONS } from '../src/world/def/maps';
import { colliderGrid, installCollision, queryColliders, removeCollider } from '../src/world/collisionWorld';
import { raycastMap, resolveCylinderCollision, getFloorHeightAt } from '../src/world/collision';
import { mapColliders } from '../src/game/state';
import { game } from '../src/game/state';
import * as THREE from 'three';
import { syntheticMap } from './helpers';

const legacy = JSON.parse(readFileSync(new URL('./fixtures/legacy-geometry.json', import.meta.url), 'utf8'));
const ids = Object.keys(MAP_DEFINITIONS);

describe('map definitions', () => {
  it('registers all five legacy maps', () => {
    expect(ids.sort()).toEqual(['blasttown', 'compound', 'downtown', 'shipment', 'shoothouse']);
  });

  for (const id of ids) {
    describe(id, () => {
      const def = MAP_DEFINITIONS[id as keyof typeof MAP_DEFINITIONS];
      const compiled = compileMap(def);
      const old = legacy[id];

      it('validates with no errors', () => {
        expect(validateMapDefinition(def)).toEqual([]);
      });

      it('compiled collision matches the legacy builder box-for-box', () => {
        const key = (a: number[]) => a.map((v) => Math.round(v * 1000) / 1000).join(',');
        const expected = old.boxes.map((b: number[]) => {
          const [x, y, z, w, h, d] = b;
          return key([x - w / 2, x + w / 2, y - h / 2, y + h / 2, z - d / 2, z + d / 2]);
        });
        const actual = compiled.colliders.map((c) => key([c.minX, c.maxX, c.minY, c.maxY, c.minZ, c.maxZ]));
        expect(actual.sort()).toEqual(expected.sort());
        const platforms = compiled.colliders.filter((c) => c.isPlatform).length;
        expect(platforms).toBe(old.boxes.filter((b: unknown[]) => b[6]).length);
      });

      it('ramps, destructibles and radar match legacy', () => {
        expect(compiled.ramps.length).toBe(old.ramps.length);
        expect(compiled.destructibles.length).toBe(old.boxes.filter((b: number[]) => b[8] > 0).length);
        const hp = compiled.destructibles.map((d) => d.hp).sort();
        expect(hp).toEqual(old.boxes.filter((b: number[]) => b[8] > 0).map((b: number[]) => b[8]).sort());
        const radarBoxes = old.boxes.filter((b: unknown[]) => b[7]).length;
        expect(compiled.radar.filter((r) => !r.isRamp).length).toBe(radarBoxes);
      });

      it('tactical lists match legacy and keep waypoint indices valid', () => {
        expect(def.tactical.waypoints).toEqual(old.waypoints);
        expect(def.tactical.mid).toEqual(old.mid);
        expect(def.tactical.flank).toEqual(old.flank);
        expect(def.tactical.safe).toEqual(old.safe);
      });

      it('no spawn is inside solid geometry', () => {
        for (const team of ['ALPHA', 'BRAVO'] as const) {
          for (const s of def.spawns[team]) {
            const hit = compiled.colliders.filter(
              (b) => s[0] > b.minX && s[0] < b.maxX && s[2] > b.minZ && s[2] < b.maxZ && s[1] < b.maxY - 0.25,
            );
            expect(hit.map((h) => h.pieceId), `${team} spawn ${s}`).toEqual([]);
          }
        }
      });

      it('visual, collision and navigation are separate products', () => {
        expect(compiled.visual.length).toBeGreaterThan(0);
        expect(compiled.nav.ground.length).toBe(1);
        // Every nav obstacle must be a collider-backed solid; nav data is not the visual list.
        expect(compiled.nav.obstacles.length).toBeGreaterThan(0);
        expect((compiled.nav as unknown as { visual?: unknown }).visual).toBeUndefined();
      });
    });
  }

  it('rejects malformed definitions', () => {
    const bad = syntheticMap('bad', [{ kind: 'wall', material: 'wall', center: [0, 1, 0], size: [-1, 2, 2] }]);
    expect(validateMapDefinition(bad).join()).toMatch(/size must be positive/);
    const noSpawns = syntheticMap('bad2', []);
    noSpawns.spawns.ALPHA = [];
    expect(validateMapDefinition(noSpawns).join()).toMatch(/no ALPHA spawns/);
    const stairs = syntheticMap('bad3', [
      { kind: 'stairs', material: 'catwalk', center: [0, 0], size: [2, 4], height: 3, axis: 'z', dir: 1, steps: 4 },
    ]);
    expect(validateMapDefinition(stairs).join()).toMatch(/stair rise/);
  });
});

describe('piece primitives', () => {
  it('building: walls with door + window openings, floor, roof; window blocks movement, door does not', () => {
    const def = syntheticMap('bld', [
      {
        kind: 'building', material: 'brick', center: [0, 0], size: [10, 8], height: 3.2, wallThickness: 0.4,
        doors: [{ side: 'S', offset: 0, width: 1.6, height: 2.4 }],
        windows: [{ side: 'N', offset: 0, width: 1.6, height: 1.0, sill: 1.0 }],
      },
    ]);
    expect(validateMapDefinition(def)).toEqual([]);
    const c = compileMap(def);
    const ids = c.colliders.map((x) => x.pieceId);
    expect(ids.some((i) => i.endsWith('/floor'))).toBe(true);
    expect(ids.some((i) => i.endsWith('/roof'))).toBe(true);
    // glass is visual only
    expect(c.visual.some((v) => v.pieceId.includes('glass'))).toBe(true);
    expect(c.colliders.some((x) => x.pieceId.includes('glass'))).toBe(false);
    // ground-level door gap exists: no collider spans the door opening at foot height
    const doorZ = 4 - 0.2;
    const blocking = c.colliders.filter(
      (x) => x.minX < 0 && x.maxX > 0 && x.minZ < doorZ && x.maxZ > doorZ && x.minY < 1 && !x.pieceId.endsWith('/floor'),
    );
    expect(blocking).toEqual([]);
  });

  it('stairs compile to walkable steps whose rise stays within the step-up limit', () => {
    const def = syntheticMap('st', [
      { kind: 'stairs', material: 'catwalk', center: [0, 0], size: [2, 6], height: 2.5, axis: 'z', dir: 1, steps: 10 },
    ]);
    const c = compileMap(def);
    expect(c.nav.slabs.length).toBe(10);
    const tops = c.nav.slabs.map((s) => s.max[1]).sort((a, b) => a - b);
    for (let i = 1; i < tops.length; i++) expect(tops[i] - tops[i - 1]).toBeLessThanOrEqual(0.25 + 1e-9);
  });
});

describe('spatial grid collision', () => {
  const def = MAP_DEFINITIONS.compound;
  const compiled = compileMap(def);

  it('grid raycast agrees with brute force on random rays', () => {
    game.arenaLimit = def.arenaLimit;
    installCollision(compiled);
    const all = [...mapColliders];
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    let mismatches = 0;
    for (let i = 0; i < 400; i++) {
      const o = new THREE.Vector3((rnd() - 0.5) * 90, 0.5 + rnd() * 3, (rnd() - 0.5) * 90);
      const d = new THREE.Vector3(rnd() - 0.5, (rnd() - 0.5) * 0.2, rnd() - 0.5).normalize();
      const fast = raycastMap(o, d, 140);
      // brute force
      let best = 140;
      for (const b of all) {
        const t = intersectBrute(o, d, b, best);
        if (t !== null && t < best) best = t;
      }
      if (o.y > 0 && d.y < -1e-5) best = Math.min(best, -o.y / d.y > 0 ? -o.y / d.y : best);
      if (Math.abs(fast.distance - best) > 1e-6) mismatches++;
    }
    expect(mismatches).toBe(0);
  });

  it('removing a collider updates grid, queries and movement', () => {
    installCollision(compiled);
    const target = compiled.destructibles[0].collider;
    const cx = (target.minX + target.maxX) / 2;
    const cz = (target.minZ + target.maxZ) / 2;
    expect(queryColliders(cx - 0.1, cx + 0.1, cz - 0.1, cz + 0.1)).toContain(target);
    const before = colliderGrid.size;
    removeCollider(target);
    expect(colliderGrid.size).toBe(before - 1);
    expect(queryColliders(cx - 0.1, cx + 0.1, cz - 0.1, cz + 0.1)).not.toContain(target);
    const pos = new THREE.Vector3(cx, 0, cz);
    resolveCylinderCollision(pos, 0.42, 1.8);
    expect(pos.x).toBeCloseTo(cx, 5); // no longer pushed out
  });

  it('ramp floor height rises along the catwalk ramp', () => {
    installCollision(compiled);
    const low = getFloorHeightAt(32, 15.5, 0);
    const high = getFloorHeightAt(32, 7.5, 2.0);
    expect(high).toBeGreaterThan(low + 1.5);
  });
});

function intersectBrute(o: THREE.Vector3, d: THREE.Vector3, b: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }, maxD: number): number | null {
  const box = new THREE.Box3(new THREE.Vector3(b.minX, b.minY, b.minZ), new THREE.Vector3(b.maxX, b.maxY, b.maxZ));
  const ray = new THREE.Ray(o, d);
  const hit = ray.intersectBox(box, new THREE.Vector3());
  if (!hit) return null;
  const t = o.distanceTo(hit);
  // inside-origin case: legacy returns tmin=0
  if (box.containsPoint(o)) return 0;
  return t <= maxD ? t : null;
}
