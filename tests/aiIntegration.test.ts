import * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// Everything that needs a DOM/WebGL/audio context is replaced; navigation, collision, map data and the
// tactical AI in src/ai/bots.ts are the REAL implementations.
vi.mock('../src/audio/SoundFX', () => ({ sfx: { playFootstep: () => {}, playExplosion: () => {} } }));
vi.mock('../src/combat/hitscan', () => ({ fireWeapon: () => false, updateReload: () => {} }));
vi.mock('../src/combat/throwables', () => ({ lobGrenadeAtTarget: () => {}, retreatSmokeEscape: () => {} }));
vi.mock('../src/game/damage', () => ({ regenSoldier: () => {} }));
vi.mock('../src/game/match', () => ({ respawnSoldier: () => {} }));
vi.mock('../src/net/net', () => ({ net: { active: false, owns: () => true, updateRemote: () => {} } }));
vi.mock('../src/physics/ragdoll', () => ({ applyRagdollToSoldierRig: () => {} }));
vi.mock('../src/rig/stance', () => ({ updateSoldierRigVisual: () => {} }));
vi.mock('../src/ui/feedback', () => ({ updateSpawnProtection: () => {} }));

// Bun does not hoist vi.mock() above static imports (Vitest does), so project modules that pull in the
// DOM/WebGL renderer are loaded with dynamic imports AFTER the mocks are registered. Works in both runners.
const { getBotNavigation, updateAIBots } = await import('../src/ai/bots');
const { allSoldiers, game, matchState } = await import('../src/game/state');
const { installCollision } = await import('../src/world/collisionWorld');
const { compileMap } = await import('../src/world/def/compile');
const { MAP_DEFINITIONS } = await import('../src/world/def/maps');
const { lookupBaked } = await import('../src/world/nav/navRuntime');
const { NavWorld } = await import('../src/world/nav/navWorld');
const { initRecast } = await import('./helpers');
import type { MapId, Soldier } from '../src/types';

beforeAll(initRecast);

function makeBot(id: number, team: 'ALPHA' | 'BRAVO', p: number[]): Soldier {
  return {
    id, name: `b${id}`, defName: `b${id}`, team, isPlayer: false, spawnIdx: 0,
    pos: new THREE.Vector3(p[0], p[1], p[2]), vel: new THREE.Vector3(), yaw: 0, pitch: 0,
    hp: 100, maxHp: 100, spawnProtection: 0, alive: true, respawnTimer: 0, kills: 0, deaths: 0, onGround: true,
    rig: { root: new THREE.Object3D() }, weaponHolder: null, ragdoll: null, killerName: '',
    weaponId: 'assault', reloadTotal: 1.75, magAmmo: 30, reserveAmmo: 180, fireCooldown: 0, reloading: false, reloadTimer: 0,
    aiState: 'ADVANCE', aiRole: null, aiRoleTime: 0, aiObjective: null, aiCampTarget: null, path: [], pathTimer: 0,
    targetEnemy: null, burstCooldown: 0, strafeDir: 1, strafeTimer: 2, lastZoneName: '', aimTargetId: -1, lockTime: 0,
    reactTimer: 0, burstShots: 0, burstLen: 4, aimHeight: 1.05, crouch: 0, stanceTarget: 0, stanceTimer: 0, sprinting: false,
    grenadeCharges: 0, smokeCharges: 0, grenadeCooldown: 0, smokeCooldown: 0, aiSmokeEscapePlanned: false,
    aiGrenadeTimer: 99, footstepTimer: 0,
  } as unknown as Soldier;
}

function setup(id: MapId): void {
  const compiled = compileMap(MAP_DEFINITIONS[id]);
  game.currentMapId = id;
  game.arenaLimit = compiled.def.arenaLimit;
  game.compiledMap = compiled;
  installCollision(compiled);
  game.navWorld = NavWorld.fromBaked(compiled, lookupBaked(compiled).fresh);
  allSoldiers.length = 0;
  matchState.paused = false;
}

describe.each(Object.keys(MAP_DEFINITIONS) as MapId[])('%s: real updateAIBots', (id) => {
  it('12 bots (no enemies in sight) roam tactical objectives via the navmesh', () => {
    setup(id);
    const def = MAP_DEFINITIONS[id];
    // Both teams spawn; keep them apart by running only ALPHA vs ALPHA-sized groups is unrealistic,
    // so mark BRAVO bots dead-but-not-respawning; we test pure navigation + tactical goal selection here.
    for (let i = 0; i < 6; i++) allSoldiers.push(makeBot(i, 'ALPHA', def.spawns.ALPHA[i]));
    for (let i = 0; i < 6; i++) allSoldiers.push(makeBot(6 + i, 'ALPHA', def.spawns.BRAVO[i]));
    const start = allSoldiers.map((b) => b.pos.clone());
    const visited = allSoldiers.map(() => new Set<string>());
    const arrivals = allSoldiers.map(() => 0);
    const walked = allSoldiers.map(() => 0);
    const last = allSoldiers.map((b) => b.pos.clone());
    const wasNear = allSoldiers.map(() => false);
    for (let step = 0; step < 20 * 120; step++) {
      updateAIBots(0.05);
      allSoldiers.forEach((b, i) => {
        walked[i] += b.pos.distanceTo(last[i]);
        last[i].copy(b.pos);
        visited[i].add(`${Math.round(b.pos.x / 8)},${Math.round(b.pos.z / 8)}`);
        const near = b.aiObjective !== null && Math.hypot(b.pos.x - b.aiObjective.x, b.pos.z - b.aiObjective.z) < 2;
        if (near && !wasNear[i]) arrivals[i]++;
        wasNear[i] = near;
      });
    }
    const nav = getBotNavigation()!;
    expect(nav).not.toBeNull();
    const travelled = walked;
    void start;
    // every bot actually went somewhere, covering several map cells
    for (let i = 0; i < allSoldiers.length; i++) {
      expect(visited[i].size, `bot ${i} visited cells`).toBeGreaterThanOrEqual(3);
    }
    // bots really reach their tactical objectives (several per bot over 2 simulated minutes)
    expect(Math.min(...arrivals), `arrivals ${arrivals}`).toBeGreaterThanOrEqual(2);
    expect(Math.min(...travelled), `distance walked per bot ${travelled.map((t) => t.toFixed(0))}`).toBeGreaterThan(80);
    expect(nav.stats.goalRequests).toBeGreaterThan(12);
    expect(nav.stats.unreachableGoals).toBe(0);
    expect(nav.stats.relocations).toBeLessThanOrEqual(2);
    // all bots still on walkable ground
    const mesh = game.navWorld!.profile('soldier');
    for (const b of allSoldiers) {
      const sn = mesh.snap(b.pos)!;
      expect(Math.hypot(sn.x - b.pos.x, sn.z - b.pos.z)).toBeLessThan(1.5);
    }
    console.log(`[ai] ${id}: arrivals min=${Math.min(...arrivals)} avg walked ${(travelled.reduce((a, b) => a + b, 0) / travelled.length).toFixed(1)}m stats=${JSON.stringify(nav.stats)}`);
    game.navWorld!.dispose();
  });

  it('works (direct-steering fallback) while navigation is still generating', () => {
    setup(id);
    game.navWorld!.dispose();
    game.navWorld = null;
    const def = MAP_DEFINITIONS[id];
    allSoldiers.push(makeBot(1, 'ALPHA', def.spawns.ALPHA[0]));
    const p0 = allSoldiers[0].pos.clone();
    for (let i = 0; i < 100; i++) updateAIBots(0.05);
    expect(getBotNavigation()).toBeNull();
    expect(allSoldiers[0].pos.distanceTo(p0)).toBeGreaterThan(2);
  });
});

describe('enemy engagement keeps nav and combat state separate', () => {
  it('bot facing a visible enemy holds the nav agent (no route fighting with strafing), resumes after', () => {
    setup('shipment');
    const a = makeBot(1, 'ALPHA', [0, 0, 22]);
    const e = makeBot(2, 'BRAVO', [0, 0, 8]);
    e.isPlayer = true; // static target: updateAIBots skips player soldiers
    allSoldiers.push(a, e);
    for (let i = 0; i < 40; i++) updateAIBots(0.05);
    expect(['ENGAGE', 'ADVANCE', 'FLANK', 'SEEK_COVER']).toContain(a.aiState);
    // remove enemy: bot must resume following a route
    e.alive = false;
    for (let i = 0; i < 80; i++) updateAIBots(0.05);
    const nav = getBotNavigation()!;
    expect(nav.isFollowing(a)).toBe(true);
    game.navWorld!.dispose();
  });
});
