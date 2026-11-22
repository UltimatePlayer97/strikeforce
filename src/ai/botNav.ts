import type { CrowdAgent } from '@recast-navigation/core';
import type { NavProfileId } from '../world/def/types';
import { distXZ, type NavMeshInstance, type NavPoint, type NavWorld } from '../world/nav/navWorld';

/**
 * Pathfinding / path-following adapter between tactical AI and the navmesh crowd.
 * Tactical code decides WHERE to go (a goal point); this module decides HOW (corridor, avoidance, stuck recovery).
 * It has no knowledge of roles, weapons or combat, and no dependency on DOM/renderer so it is unit-testable.
 */

export interface NavBody {
  id: number;
  pos: NavPoint;
}

export type GoalResult = 'ok' | 'unreachable' | 'no-agent';
export type StuckAction = 'none' | 'resynced' | 'detour' | 'abandon' | 'relocated';

export interface SteerResult {
  /** Normalised XZ direction (zero when idle). */
  x: number;
  z: number;
  moving: boolean;
  /** True while the body is crossing an off-mesh link (jump/drop): position is driven by the crowd. */
  offMesh: boolean;
  /** Valid while offMesh: where the body should be placed. */
  offMeshPos: NavPoint | null;
}

interface AgentState {
  agent: CrowdAgent;
  goal: NavPoint | null;
  holding: boolean;
  lastSpeed: number;
  progressRef: NavPoint;
  progressTime: number;
  stuckLevel: number;
  stuckCooldown: number;
}

export interface NavStats {
  goalRequests: number;
  unreachableGoals: number;
  resyncs: number;
  stuckEvents: number;
  detours: number;
  abandoned: number;
  relocations: number;
  offMeshTraversals: number;
}

const ARRIVE_DIST = 0.9;
const RESYNC_DIST = 1.3;
const STUCK_WINDOW = 1.1;
const STUCK_MIN_PROGRESS = 0.3;

export class BotNavigation {
  private readonly agents = new Map<number, AgentState>();
  readonly stats: NavStats = {
    goalRequests: 0,
    unreachableGoals: 0,
    resyncs: 0,
    stuckEvents: 0,
    detours: 0,
    abandoned: 0,
    relocations: 0,
    offMeshTraversals: 0,
  };
  private readonly mesh: NavMeshInstance;

  constructor(
    readonly world: NavWorld,
    readonly profile: NavProfileId = 'soldier',
  ) {
    this.mesh = world.profile(profile);
  }

  /** Advance the crowd once per frame, BEFORE bots read their steering. */
  update(dt: number): void {
    this.world.update(dt);
  }

  private ensure(body: NavBody): AgentState | null {
    let st = this.agents.get(body.id);
    if (st) return st;
    const agent = this.mesh.addAgent(body.pos);
    if (!agent) return null;
    st = {
      agent,
      goal: null,
      holding: false,
      lastSpeed: -1,
      progressRef: { ...body.pos },
      progressTime: 0,
      stuckLevel: 0,
      stuckCooldown: 0,
    };
    this.agents.set(body.id, st);
    return st;
  }

  has(body: NavBody): boolean {
    return this.agents.has(body.id);
  }

  remove(body: NavBody): void {
    const st = this.agents.get(body.id);
    if (!st) return;
    this.mesh.getCrowd().removeAgent(st.agent);
    this.agents.delete(body.id);
  }

  /**
   * Request a path to `goal`. Returns 'unreachable' (without touching the current route) if the goal is not on
   * the navmesh or the corridor does not reach it, so the tactical layer can pick another objective.
   */
  setGoal(body: NavBody, goal: NavPoint): GoalResult {
    this.stats.goalRequests++;
    const st = this.ensure(body);
    if (!st) return 'no-agent';
    const route = this.mesh.findPath(body.pos, goal);
    if (!route.success) {
      this.stats.unreachableGoals++;
      return 'unreachable';
    }
    const snapped = route.points[route.points.length - 1];
    st.goal = snapped;
    st.holding = false;
    st.agent.requestMoveTarget(snapped);
    return 'ok';
  }

  /** Stop following the route (combat strafing etc.). The agent stays glued to the body. */
  hold(body: NavBody): void {
    const st = this.agents.get(body.id);
    if (!st) return;
    if (!st.holding) {
      st.holding = true;
      st.agent.resetMoveTarget();
    }
    st.agent.teleport(body.pos);
    st.progressRef = { ...body.pos };
    st.progressTime = 0;
  }

  /** True while the body has an active (non-held) route. */
  isFollowing(body: NavBody): boolean {
    const st = this.agents.get(body.id);
    return Boolean(st && st.goal && !st.holding);
  }

  goalOf(body: NavBody): NavPoint | null {
    return this.agents.get(body.id)?.goal ?? null;
  }

  /** Remaining straight-line distance to the goal (XZ), Infinity when there is no goal. */
  distanceToGoal(body: NavBody): number {
    const g = this.agents.get(body.id)?.goal;
    return g ? distXZ(body.pos, g) : Infinity;
  }

  /** Corners of the current corridor, for debug rendering. */
  corners(body: NavBody): NavPoint[] {
    const st = this.agents.get(body.id);
    return st ? st.agent.corners().map((c) => ({ x: c.x, y: c.y, z: c.z })) : [];
  }

  agentPosition(body: NavBody): NavPoint | null {
    const st = this.agents.get(body.id);
    if (!st) return null;
    const p = st.agent.position();
    return { x: p.x, y: p.y, z: p.z };
  }

  /** Steering direction for this frame. `speed` is the gait the body will actually move at. */
  steer(body: NavBody, speed: number): SteerResult {
    const idle: SteerResult = { x: 0, z: 0, moving: false, offMesh: false, offMeshPos: null };
    const st = this.agents.get(body.id);
    if (!st || !st.goal || st.holding) return idle;
    // Arrived: stand still instead of jittering around the goal point.
    if (distXZ(body.pos, st.goal) < ARRIVE_DIST) return idle;
    if (Math.abs(speed - st.lastSpeed) > 0.25) {
      st.lastSpeed = speed;
      st.agent.updateParameters({ maxSpeed: speed });
    }

    if (st.agent.state() === 2) {
      // DT_CROWDAGENT_STATE_OFFMESH: the crowd animates the agent along the link; the body mirrors it.
      const p = st.agent.position();
      return { x: 0, z: 0, moving: true, offMesh: true, offMeshPos: { x: p.x, y: p.y, z: p.z } };
    }

    const p = st.agent.position();
    const v = st.agent.velocity();
    let dx = v.x;
    let dz = v.z;
    const vlen = Math.hypot(dx, dz);
    if (vlen > 0.05) {
      dx /= vlen;
      dz /= vlen;
    } else {
      const t = st.agent.nextTargetInPath();
      dx = t.x - body.pos.x;
      dz = t.z - body.pos.z;
      const l = Math.hypot(dx, dz);
      if (l < 0.2) return idle;
      dx /= l;
      dz /= l;
    }
    // Pull the body towards the agent so both stay on the same corridor.
    const px = p.x - body.pos.x;
    const pz = p.z - body.pos.z;
    dx += px * 0.6;
    dz += pz * 0.6;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return idle;
    return { x: dx / len, z: dz / len, moving: true, offMesh: false, offMeshPos: null };
  }

  /**
   * Call after the body has been moved + collided this frame. Keeps the crowd agent in sync with the body and
   * detects/recovers from being stuck. Returns what the tactical layer must react to.
   */
  afterMove(body: NavBody, dt: number, wasMoving: boolean): { action: StuckAction; relocateTo?: NavPoint } {
    const st = this.agents.get(body.id);
    if (!st || !st.goal || st.holding) return { action: 'none' };

    if (st.agent.state() === 2) {
      if (st.progressTime >= 0) this.stats.offMeshTraversals++;
      st.progressTime = -1; // flag: in traversal
      return { action: 'none' };
    }
    if (st.progressTime < 0) st.progressTime = 0;

    const ap = st.agent.position();
    if (distXZ(ap, body.pos) > RESYNC_DIST) {
      this.stats.resyncs++;
      st.agent.teleport(body.pos);
      st.agent.requestMoveTarget(st.goal);
    }

    if (st.stuckCooldown > 0) st.stuckCooldown -= dt;
    if (!wasMoving || distXZ(body.pos, st.goal) < 1.0) {
      st.progressRef = { ...body.pos };
      st.progressTime = 0;
      st.stuckLevel = 0;
      return { action: 'none' };
    }

    st.progressTime += dt;
    if (distXZ(body.pos, st.progressRef) >= STUCK_MIN_PROGRESS) {
      st.progressRef = { ...body.pos };
      st.progressTime = 0;
      st.stuckLevel = Math.max(0, st.stuckLevel - 1);
      return { action: 'none' };
    }
    if (st.progressTime < STUCK_WINDOW || st.stuckCooldown > 0) return { action: 'none' };

    // Stuck: escalate recovery.
    this.stats.stuckEvents++;
    st.progressTime = 0;
    st.progressRef = { ...body.pos };
    st.stuckCooldown = 0.4;
    st.stuckLevel++;

    if (st.stuckLevel === 1) {
      st.agent.teleport(body.pos);
      st.agent.requestMoveTarget(st.goal);
      this.stats.resyncs++;
      return { action: 'resynced' };
    }
    if (st.stuckLevel === 2) {
      const via = this.mesh.randomPointNear(body.pos, 3.5);
      if (via) {
        this.stats.detours++;
        st.agent.teleport(body.pos);
        st.agent.requestMoveTarget(via);
        return { action: 'detour' };
      }
    }
    if (st.stuckLevel === 3) {
      this.stats.abandoned++;
      st.goal = null;
      st.agent.resetMoveTarget();
      return { action: 'abandon' };
    }
    // Last resort: put the body back on the navmesh.
    const snapped = this.mesh.snap(body.pos, true);
    st.stuckLevel = 0;
    if (snapped) {
      this.stats.relocations++;
      st.agent.teleport(snapped);
      return { action: 'relocated', relocateTo: snapped };
    }
    return { action: 'abandon' };
  }

  get agentCount(): number {
    return this.agents.size;
  }

  clear(): void {
    for (const st of this.agents.values()) this.mesh.getCrowd().removeAgent(st.agent);
    this.agents.clear();
  }
}
