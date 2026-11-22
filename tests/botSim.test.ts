import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { BotNavigation, type NavBody } from '../src/ai/botNav';
import { getFloorHeightAt, resolveCylinderCollision } from '../src/world/collision';
import { installCollision, removeCollider } from '../src/world/collisionWorld';
import { game } from '../src/game/state';
import { compileMap, type CompiledMap } from '../src/world/def/compile';
import { MAP_DEFINITIONS } from '../src/world/def/maps';
import { lookupBaked } from '../src/world/nav/navRuntime';
import { NavWorld, distXZ } from '../src/world/nav/navWorld';
import { buildWorld, initRecast, pt, syntheticMap } from './helpers';

beforeAll(initRecast);

class Body implements NavBody {
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  goals = 0;
  stuckAbandons = 0;
  constructor(public id: number, p: THREE.Vector3) {
    this.pos.copy(p);
  }
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Kinematic bot step mirroring updateAIBots: crowd steering, gravity, real collision, separation, stuck handling. */
function stepBodies(nav: BotNavigation, bodies: Body[], dt: number, onTraverse?: () => void): void {
  nav.update(dt);
  for (const b of bodies) {
    const s = nav.steer(b, 5.6);
    const dir = new THREE.Vector3(s.x, 0, s.z);
    for (const o of bodies) {
      if (o === b) continue;
      const dx = b.pos.x - o.pos.x;
      const dz = b.pos.z - o.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.01 && d < 1.35) {
        dir.x += (dx / d) * ((1.35 - d) / 1.35) * 0.9;
        dir.z += (dz / d) * ((1.35 - d) / 1.35) * 0.9;
      }
    }
    if (s.offMesh && s.offMeshPos) {
      onTraverse?.();
      b.pos.set(s.offMeshPos.x, s.offMeshPos.y, s.offMeshPos.z);
      b.vel.set(0, 0, 0);
    } else {
      if (dir.lengthSq() > 1e-6) dir.normalize();
      b.vel.x = dir.x * 5.6;
      b.vel.z = dir.z * 5.6;
      b.vel.y -= 21 * dt;
      b.pos.addScaledVector(b.vel, dt);
      resolveCylinderCollision(b.pos, 0.42, 1.8);
      const floor = getFloorHeightAt(b.pos.x, b.pos.z, b.pos.y + 0.35);
      if (b.pos.y <= floor) {
        b.pos.y = floor;
        b.vel.y = 0;
      }
    }
    const fix = nav.afterMove(b, dt, s.moving);
    if (fix.action === 'abandon') b.stuckAbandons++;
    if (fix.action === 'relocated' && fix.relocateTo) b.pos.set(fix.relocateTo.x, fix.relocateTo.y, fix.relocateTo.z);
  }
}

function loadShipped(id: keyof typeof MAP_DEFINITIONS): { compiled: CompiledMap; world: NavWorld } {
  const compiled = compileMap(MAP_DEFINITIONS[id]);
  game.arenaLimit = MAP_DEFINITIONS[id].arenaLimit;
  installCollision(compiled);
  return { compiled, world: NavWorld.fromBaked(compiled, lookupBaked(compiled).fresh) };
}

describe.each(Object.keys(MAP_DEFINITIONS) as (keyof typeof MAP_DEFINITIONS)[])('%s: 12 simultaneous bots', (id) => {
  it('navigate between tactical points using real collision, reach goals and never leave the navmesh', () => {
    const { compiled, world } = loadShipped(id);
    const def = compiled.def;
    const nav = new BotNavigation(world, 'soldier');
    const rand = rng(1234 + id.length);
    const bodies: Body[] = [];
    for (let i = 0; i < 6; i++) {
      const a = def.spawns.ALPHA[i];
      const b = def.spawns.BRAVO[i];
      bodies.push(new Body(i * 2, new THREE.Vector3(a[0], a[1], a[2])), new Body(i * 2 + 1, new THREE.Vector3(b[0], b[1], b[2])));
    }
    const pickGoal = (): { x: number; y: number; z: number } => {
      const w = def.tactical.waypoints[Math.floor(rand() * def.tactical.waypoints.length)];
      return pt(w[0], w[1], w[2]);
    };
    let unreachable = 0;
    const dt = 0.05;
    const SIM_SECONDS = 150;
    for (let step = 0; step < SIM_SECONDS / dt; step++) {
      for (const b of bodies) {
        if (!nav.isFollowing(b) || nav.distanceToGoal(b) < 1.6) {
          if (nav.isFollowing(b) && nav.distanceToGoal(b) < 1.6) b.goals++;
          if (nav.setGoal(b, pickGoal()) === 'unreachable') unreachable++;
        }
      }
      stepBodies(nav, bodies, dt);
    }
    const goals = bodies.map((b) => b.goals);
    // every bot completed multiple legs
    expect(Math.min(...goals), `goals per bot ${goals}`).toBeGreaterThanOrEqual(3);
    expect(unreachable).toBe(0);
    // nobody ended up off the navmesh / inside geometry
    const s = world.profile('soldier');
    for (const b of bodies) {
      const sn = s.snap(b.pos)!;
      expect(distXZ(sn, b.pos), `body ${b.id} off mesh at ${b.pos.toArray()}`).toBeLessThan(1.5);
    }
    // stuck handling must be rare on shipped maps
    expect(nav.stats.relocations).toBeLessThanOrEqual(2);
    console.log(`[sim] ${id}: goals/bot min=${Math.min(...goals)} avg=${(goals.reduce((a, b) => a + b, 0) / goals.length).toFixed(1)} stats=${JSON.stringify(nav.stats)}`);
    world.dispose();
  });
});

describe('blocked routes and recovery', () => {
  const gapMap = () =>
    syntheticMap(
      'gap',
      [
        { kind: 'wall', material: 'wall', center: [-15.8, 2, 0], size: [30.4, 4, 1] },
        { kind: 'wall', material: 'wall', center: [15.8, 2, 0], size: [30.4, 4, 1] },
        { kind: 'cover', material: 'crateOlive', center: [0, 1, 0], size: [1.2, 2, 1.2], destructible: { hp: 40 } },
      ],
      { spawns: [[0, 0, -8]] },
    );

  it('unreachable goal is reported without moving the bot, then succeeds once the blocker is destroyed', () => {
    const def = gapMap();
    const { compiled, world } = buildWorld(def);
    game.arenaLimit = def.arenaLimit;
    installCollision(compiled);
    const nav = new BotNavigation(world, 'soldier');
    const b = new Body(1, new THREE.Vector3(0, 0, -8));
    expect(nav.setGoal(b, pt(0, 0, 8))).toBe('unreachable');
    expect(nav.stats.unreachableGoals).toBe(1);
    // destroy the crate: collision + nav obstacle both go away
    removeCollider(compiled.destructibles[0].collider);
    world.removeObstacle(compiled.destructibles[0].collider);
    world.update(0.016);
    expect(nav.setGoal(b, pt(0, 0, 8))).toBe('ok');
    for (let i = 0; i < 400 && nav.distanceToGoal(b) > 1.2; i++) stepBodies(nav, [b], 0.05);
    expect(b.pos.z).toBeGreaterThan(6.5);
    expect(Math.abs(b.pos.x)).toBeLessThan(1);
  });

  it('a bot that cannot move escalates: resync, detour, abandon, relocate', () => {
    const def = syntheticMap('stuck', [], { spawns: [[0, 0, 0]] });
    const { world } = buildWorld(def);
    game.arenaLimit = def.arenaLimit;
    installCollision(compileMap(def));
    const nav = new BotNavigation(world, 'soldier');
    const b = new Body(1, new THREE.Vector3(0, 0, 0));
    expect(nav.setGoal(b, pt(20, 0, 0))).toBe('ok');
    const actions: string[] = [];
    for (let i = 0; i < 300; i++) {
      nav.update(0.05);
      const s = nav.steer(b, 5.6);
      const fix = nav.afterMove(b, 0.05, s.moving); // body pinned: never moves
      if (fix.action !== 'none') actions.push(fix.action);
      // like the tactical layer: after an abandon, a new objective is assigned
      if (fix.action === 'abandon') nav.setGoal(b, pt(20, 0, 0));
    }
    expect(actions.slice(0, 3)).toEqual(['resynced', 'detour', 'abandon']);
    expect(actions).toContain('relocated');
    expect(nav.stats.stuckEvents).toBeGreaterThanOrEqual(4);
  });

  it('bot teleported far from its crowd agent is resynchronised instead of walking through walls', () => {
    const def = syntheticMap('resync', [], { spawns: [[0, 0, 0]] });
    const { world } = buildWorld(def);
    game.arenaLimit = def.arenaLimit;
    installCollision(compileMap(def));
    const nav = new BotNavigation(world, 'soldier');
    const b = new Body(1, new THREE.Vector3(0, 0, 0));
    nav.setGoal(b, pt(15, 0, 0));
    for (let i = 0; i < 20; i++) stepBodies(nav, [b], 0.05);
    b.pos.set(-10, 0, 10); // e.g. knocked away / respawned
    stepBodies(nav, [b], 0.05);
    expect(nav.stats.resyncs).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < 300 && nav.distanceToGoal(b) > 1.2; i++) stepBodies(nav, [b], 0.05);
    expect(distXZ(b.pos, pt(15, 0, 0))).toBeLessThan(1.6);
  });
});

describe('off-mesh traversal', () => {
  it('a bot drops from a sealed deck to the ground through the link', () => {
    const def = syntheticMap(
      'drop',
      [{ kind: 'floor', material: 'catwalk', center: [0, 2.9, 0], size: [8, 0.2, 8] }],
      { spawns: [[0, 3, 0]], links: [{ id: 'd', kind: 'drop', from: [3, 3, 0], to: [6.5, 0, 0], radius: 0.6, bidirectional: false }] },
    );
    const { compiled, world } = buildWorld(def);
    game.arenaLimit = def.arenaLimit;
    installCollision(compiled);
    const nav = new BotNavigation(world, 'soldier');
    const b = new Body(1, new THREE.Vector3(0, 3, 0));
    expect(nav.setGoal(b, pt(12, 0, 0))).toBe('ok');
    let traversed = 0;
    for (let i = 0; i < 600 && nav.distanceToGoal(b) > 1.3; i++) stepBodies(nav, [b], 0.05, () => traversed++);
    expect(traversed).toBeGreaterThan(0);
    expect(distXZ(b.pos, pt(12, 0, 0))).toBeLessThan(1.5);
    expect(b.pos.y).toBeLessThan(0.5);
  });
});
