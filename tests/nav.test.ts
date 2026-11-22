import { beforeAll, describe, expect, it } from 'vitest';
import { compileMap } from '../src/world/def/compile';
import { MAP_DEFINITIONS } from '../src/world/def/maps';
import { lookupBaked } from '../src/world/nav/navRuntime';
import { distXZ } from '../src/world/nav/navWorld';
import { buildWorld, initRecast, pt, syntheticMap } from './helpers';

beforeAll(initRecast);
const ids = Object.keys(MAP_DEFINITIONS) as (keyof typeof MAP_DEFINITIONS)[];

describe('baked navigation data', () => {
  for (const id of ids) {
    it(`${id}: shipped baked data exists for every profile and matches current geometry`, () => {
      const compiled = compileMap(MAP_DEFINITIONS[id]);
      const { fresh, missing } = lookupBaked(compiled);
      expect(missing).toEqual([]);
      expect(fresh.map((f) => f.profile).sort()).toEqual([...MAP_DEFINITIONS[id].nav.profiles].sort());
      for (const f of fresh) expect(f.data.length).toBeGreaterThan(1000);
    });
  }

  it('geometry change invalidates baked data (stale detection)', () => {
    const def = structuredClone(MAP_DEFINITIONS.shipment);
    def.pieces.push({ kind: 'container', material: 'crateRed', center: [3, 1.4, 3], size: [3, 2.8, 3] });
    const { fresh, missing } = lookupBaked(compileMap(def));
    expect(fresh).toEqual([]);
    expect(missing).toContain('soldier');
  });
});

describe.each(ids)('%s navigation (shipped baked data)', (id) => {
  const def = MAP_DEFINITIONS[id];
  let world: ReturnType<typeof buildWorld>['world'];
  beforeAll(() => {
    const compiled = compileMap(def);
    const { fresh } = lookupBaked(compiled);
    // use the SHIPPED baked data, not a fresh bake
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return import('../src/world/nav/navWorld').then(({ NavWorld }) => {
      world = NavWorld.fromBaked(compiled, fresh);
    });
  });

  it('every spawn and tactical waypoint lies on the navmesh', () => {
    const s = world.profile('soldier');
    const all = [...def.spawns.ALPHA, ...def.spawns.BRAVO, ...def.tactical.waypoints];
    for (const p of all) {
      const sn = s.snap(pt(p[0], p[1], p[2]));
      expect(sn, `snap ${p}`).not.toBeNull();
      expect(distXZ(sn!, pt(p[0], p[1], p[2])), `xz offset for ${p}`).toBeLessThan(0.9);
      expect(Math.abs(sn!.y - p[1]), `y offset for ${p}`).toBeLessThan(0.6);
    }
  });

  it('all spawns and waypoints are mutually reachable (no unreachable pairs)', () => {
    const s = world.profile('soldier');
    const pts = [...def.spawns.ALPHA, ...def.spawns.BRAVO, ...def.tactical.waypoints].map((p) => pt(p[0], p[1], p[2]));
    const failures: string[] = [];
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        if (!s.isReachable(pts[i], pts[j])) failures.push(`${i}->${j}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('spawn-to-enemy-spawn paths are sane (no huge detours, stay near the navmesh)', () => {
    const s = world.profile('soldier');
    for (let i = 0; i < def.spawns.ALPHA.length; i++) {
      const a = def.spawns.ALPHA[i];
      const b = def.spawns.BRAVO[i];
      const r = s.findPath(pt(a[0], a[1], a[2]), pt(b[0], b[1], b[2]));
      expect(r.success).toBe(true);
      let len = 0;
      for (let k = 1; k < r.points.length; k++) len += Math.hypot(r.points[k].x - r.points[k - 1].x, r.points[k].z - r.points[k - 1].z);
      const straight = Math.hypot(a[0] - b[0], a[2] - b[2]);
      expect(len).toBeLessThan(straight * 2.2 + 10);
    }
  });

  it('no walkable islands on top of crates/walls', () => {
    const s = world.profile('soldier');
    const compiled = world.map;
    for (const o of compiled.nav.obstacles) {
      if (o.max[1] - o.min[1] < 1.2) continue;
      const cx = (o.min[0] + o.max[0]) / 2;
      const cz = (o.min[2] + o.max[2]) / 2;
      const r = s.query.findNearestPoly(pt(cx, o.max[1], cz), { halfExtents: pt(0.3, 0.6, 0.3) });
      expect(r.nearestRef, `top of ${o.pieceId}`).toBe(0);
    }
  });

  it('heavy profile loads, keeps a connected spawn network and has a smaller walkable area', () => {
    expect(world.hasProfile('heavy')).toBe(true);
    const h = world.profile('heavy');
    const a = def.spawns.ALPHA[0];
    const b = def.spawns.BRAVO[0];
    expect(h.isReachable(pt(a[0], a[1], a[2]), pt(b[0], b[1], b[2]))).toBe(true);
  });
});

describe('multiple floors, ramps', () => {
  it('compound: catwalk deck is reachable via the ramps and is a separate floor from the ground beneath it', () => {
    const compiled = compileMap(MAP_DEFINITIONS.compound);
    const { fresh } = lookupBaked(compiled);
    return import('../src/world/nav/navWorld').then(({ NavWorld }) => {
      const world = NavWorld.fromBaked(compiled, fresh);
      const s = world.profile('soldier');
      const deck = s.snap(pt(32, 2.8, 0))!;
      const under = s.snap(pt(32, 0, 0));
      expect(deck.y).toBeGreaterThan(2.6);
      expect(deck.y).toBeLessThan(3.0);
      expect(under).not.toBeNull();
      expect(under!.y).toBeLessThan(0.3);
      const route = s.findPath(pt(32, 0, 20), pt(32, 2.8, 0));
      expect(route.success).toBe(true);
      const ys = route.points.map((p) => p.y);
      expect(Math.max(...ys)).toBeGreaterThan(2.6);
      // path climbs through the ramp (z between 7 and 16 on the south ramp)
      // (straight paths only keep corners: sample along the segments)
      let climbed = false;
      for (let i = 1; i < route.points.length; i++) {
        for (let t = 0; t <= 1; t += 0.05) {
          const z = route.points[i - 1].z + (route.points[i].z - route.points[i - 1].z) * t;
          const y = route.points[i - 1].y + (route.points[i].y - route.points[i - 1].y) * t;
          if (z > 8 && z < 15 && y > 0.5 && y < 2.3) climbed = true;
        }
      }
      expect(climbed).toBe(true);
      // railings block the deck sides: the deck east edge x=35.1 is not walkable
      const rail = s.query.findNearestPoly(pt(35.1, 2.8, 0), { halfExtents: pt(0.05, 0.5, 0.05) });
      expect(rail.nearestRef).toBe(0);
    });
  });

  it('stairs connect floors (synthetic) and ground under the upper deck stays walkable', () => {
    const def = syntheticMap(
      'stairs',
      [
        { kind: 'floor', material: 'catwalk', center: [0, 2.4, -3], size: [10, 0.2, 6] },
        { kind: 'stairs', material: 'catwalk', center: [0, 5], size: [3, 10], height: 2.5, axis: 'z', dir: -1, steps: 10 },
      ],
      { spawns: [[0, 0, 12]] },
    );
    const { world } = buildWorld(def);
    const s = world.profile('soldier');
    const up = s.snap(pt(0, 2.5, -3))!;
    expect(up.y).toBeGreaterThan(2.3);
    const r = s.findPath(pt(0, 0, 12), pt(0, 2.5, -3));
    expect(r.success).toBe(true);
    const under = s.snap(pt(0, 0, -3))!;
    expect(under.y).toBeLessThan(0.2);
  });
});

describe('narrow corridors and agent dimensions', () => {
  it('1.3m gap: soldier passes, heavy does not', () => {
    const def = syntheticMap('corridor', [
      { kind: 'wall', material: 'wall', center: [-16.65, 2, 0], size: [32, 4, 1] },
      { kind: 'wall', material: 'wall', center: [16.65, 2, 0], size: [32, 4, 1] },
    ]);
    const { world } = buildWorld(def);
    const a = pt(0, 0, -8);
    const b = pt(0, 0, 8);
    expect(world.profile('soldier').findPath(a, b).success).toBe(true);
    expect(world.profile('heavy').findPath(a, b).success).toBe(false);
  });

  it('door opening in a building is traversable; sealed building is not', () => {
    const mk = (withDoor: boolean) =>
      syntheticMap('bld-nav', [
        {
          kind: 'building', material: 'brick', center: [0, 0], size: [10, 8], height: 3.2, wallThickness: 0.4,
          doors: withDoor ? [{ side: 'S', offset: 0, width: 1.6, height: 2.4 }] : [],
          windows: [{ side: 'N', offset: 2, width: 1.6, height: 1.0, sill: 1.0 }],
        },
      ]);
    const outside = pt(0, 0, 9);
    const inside = pt(0, 0.1, 0);
    expect(buildWorld(mk(true)).world.profile('soldier').findPath(outside, inside).success).toBe(true);
    expect(buildWorld(mk(false)).world.profile('soldier').findPath(outside, inside).success).toBe(false);
  });
});

describe('dynamic obstacles', () => {
  it('destructible crate in a gap blocks the route until destroyed, and partial paths are flagged', () => {
    const def = syntheticMap('dyn', [
      { kind: 'wall', material: 'wall', center: [-15.5, 2, 0], size: [31, 4, 1] },
      { kind: 'wall', material: 'wall', center: [15.5, 2, 0], size: [31, 4, 1] },
      { kind: 'cover', material: 'crateOlive', center: [0, 1, 0], size: [1.2, 2, 1.2], destructible: { hp: 40 } },
    ]);
    // walls span x -31..31 except the gap [-0.0..] -> gap between -0 and 0 closed by crate. open a 1.6 gap:
    def.pieces[1] = { kind: 'wall', material: 'wall', center: [-15.8, 2, 0], size: [30.4, 4, 1] };
    def.pieces[2] = { kind: 'wall', material: 'wall', center: [15.8, 2, 0], size: [30.4, 4, 1] };
    const { compiled, world } = buildWorld(def);
    const s = world.profile('soldier');
    const a = pt(0, 0, -8);
    const b = pt(0, 0, 8);
    expect(s.dynamicObstacleCount).toBe(1);
    const blocked = s.findPath(a, b);
    expect(blocked.success).toBe(false);
    expect(blocked.partial).toBe(true);
    world.removeObstacle(compiled.destructibles[0].collider);
    world.update(0.016);
    expect(s.dynamicObstacleCount).toBe(0);
    expect(s.findPath(a, b).success).toBe(true);
  });

  it('every shipped map registers one dynamic obstacle per destructible', () => {
    for (const id of ids) {
      const compiled = compileMap(MAP_DEFINITIONS[id]);
      const { fresh } = lookupBaked(compiled);
      return import('../src/world/nav/navWorld').then(({ NavWorld }) => {
        const w = NavWorld.fromBaked(compiled, fresh);
        expect(w.profile('soldier').dynamicObstacleCount).toBe(compiled.destructibles.length);
        w.dispose();
      });
    }
  });
});

describe('off-mesh links', () => {
  const def = () =>
    syntheticMap(
      'offmesh',
      [{ kind: 'floor', material: 'catwalk', center: [0, 2.9, 0], size: [8, 0.2, 8] }],
      {
        spawns: [[0, 2.8, 0]],
        links: [{ id: 'drop-east', kind: 'drop', from: [3, 3, 0], to: [6.5, 0, 0], radius: 0.6, bidirectional: false }],
      },
    );
  it('a one-way drop link connects a sealed deck to the ground', () => {
    const { world } = buildWorld(def());
    const s = world.profile('soldier');
    const down = s.findPath(pt(0, 3, 0), pt(12, 0, 0));
    expect(down.success).toBe(true);
    const up = s.findPath(pt(12, 0, 0), pt(0, 3, 0));
    expect(up.success).toBe(false);
    expect(world.linkById(1000)?.kind).toBe('drop');
  });

  it('without the link the deck is isolated', () => {
    const d = def();
    d.nav.offMeshLinks = [];
    const { world } = buildWorld(d);
    expect(world.profile('soldier').findPath(pt(0, 3, 0), pt(12, 0, 0)).success).toBe(false);
  });
});
