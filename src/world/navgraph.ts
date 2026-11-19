import * as THREE from 'three';
import type { NavNode, NavEdge, MapDef } from '../types';
import { segmentClear, hasLineOfSight } from '../physics/collision';

const _segDiff = new THREE.Vector3();
const _segDir = new THREE.Vector3();
const _segRight = new THREE.Vector3();
const _segA = new THREE.Vector3();
const _segB = new THREE.Vector3();

export class TacticalNavGraph {
  nodes: NavNode[] = [];
  adj: NavEdge[][] = [];

  constructor(rawCoords: number[][]) {
    this.buildNodes(rawCoords);
    this.validateAndConnectEdges();
  }

  buildNodes(rawCoords: number[][]): void {
    this.nodes = rawCoords.map((c, idx) => ({
      id: idx,
      pos: new THREE.Vector3(c[0], c[1], c[2])
    }));
    this.adj = this.nodes.map(() => []);
  }

  segmentClear(p1: THREE.Vector3, p2: THREE.Vector3, clearanceRadius = 0.52): boolean {
    return segmentClear(p1, p2, clearanceRadius);
  }

  validateAndConnectEdges(): void {
    const maxLinkDist = 17.5;
    for (let i = 0; i < this.nodes.length; i++) {
      for (let j = i + 1; j < this.nodes.length; j++) {
        const a = this.nodes[i].pos;
        const b = this.nodes[j].pos;
        const d = a.distanceTo(b);
        if (d <= maxLinkDist && this.segmentClear(a, b, 0.5)) {
          this.adj[i].push({ to: j, cost: d });
          this.adj[j].push({ to: i, cost: d });
        }
      }
    }
  }

  findNearestNode(pos: THREE.Vector3, checkClear = true): number {
    const nodes = this.nodes;
    let bestCheap = Infinity;
    let bestIdx = 0;

    for (let i = 0; i < nodes.length; i++) {
      const nPos = nodes[i].pos;
      const score = Math.hypot(nPos.x - pos.x, nPos.z - pos.z) + Math.abs(nPos.y - pos.y) * 3.0;
      if (score < bestCheap) {
        bestCheap = score;
        bestIdx = i;
      }
    }
    if (!checkClear) return bestIdx;

    let bestScore = Infinity;
    for (let i = 0; i < nodes.length; i++) {
      const nPos = nodes[i].pos;
      const cheap = Math.hypot(nPos.x - pos.x, nPos.z - pos.z) + Math.abs(nPos.y - pos.y) * 3.0;
      if (cheap > bestCheap + 12) continue;
      const clearBonus = this.segmentClear(pos, nPos, 0.35) ? 0 : 12;
      const score = cheap + clearBonus;
      if (score < bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  findPathAStar(startPos: THREE.Vector3, goalPos: THREE.Vector3, nodeCongestion: Float32Array | null = null): THREE.Vector3[] {
    const startIdx = this.findNearestNode(startPos);
    const goalIdx = this.findNearestNode(goalPos);

    if (startIdx === goalIdx) {
      return [goalPos.clone()];
    }

    const nCount = this.nodes.length;
    const gScore = new Float32Array(nCount).fill(Infinity);
    const fScore = new Float32Array(nCount).fill(Infinity);
    const cameFrom = new Int32Array(nCount).fill(-1);
    const closed = new Uint8Array(nCount);
    const openSet = new Set<number>([startIdx]);

    gScore[startIdx] = 0;
    fScore[startIdx] = this.nodes[startIdx].pos.distanceTo(this.nodes[goalIdx].pos);

    while (openSet.size > 0) {
      let current = -1;
      let lowestF = Infinity;
      for (const idx of openSet) {
        if (fScore[idx] < lowestF) {
          lowestF = fScore[idx];
          current = idx;
        }
      }

      if (current === goalIdx) {
        const rawPoints: THREE.Vector3[] = [];
        let curr = current;
        while (curr !== -1) {
          rawPoints.push(this.nodes[curr].pos.clone());
          curr = cameFrom[curr];
        }
        rawPoints.reverse();
        rawPoints.push(goalPos.clone());
        return this.smoothPath(startPos, rawPoints);
      }

      openSet.delete(current);
      closed[current] = 1;

      const neighbors = this.adj[current];
      for (let i = 0; i < neighbors.length; i++) {
        const edge = neighbors[i];
        const next = edge.to;
        if (closed[next]) continue;

        const congestionPenalty = nodeCongestion ? (nodeCongestion[next] || 0) * 6.5 : 0;
        const tentativeG = gScore[current] + edge.cost + congestionPenalty;

        if (tentativeG < gScore[next]) {
          cameFrom[next] = current;
          gScore[next] = tentativeG;
          fScore[next] = tentativeG + this.nodes[next].pos.distanceTo(this.nodes[goalIdx].pos);
          openSet.add(next);
        }
      }
    }

    return [goalPos.clone()];
  }

  smoothPath(startPos: THREE.Vector3, waypoints: THREE.Vector3[]): THREE.Vector3[] {
    if (waypoints.length <= 2) return waypoints;
    const smoothed: THREE.Vector3[] = [];
    let anchor = startPos.clone();
    let idx = 0;

    while (idx < waypoints.length) {
      let furthest = idx;
      for (let look = waypoints.length - 1; look > idx; look--) {
        if (this.segmentClear(anchor, waypoints[look], 0.5)) {
          furthest = look;
          break;
        }
      }
      smoothed.push(waypoints[furthest]);
      anchor = waypoints[furthest];
      idx = furthest + 1;
    }
    return smoothed;
  }
}

export function createNavGraph(mapDef: MapDef): TacticalNavGraph {
  return new TacticalNavGraph(mapDef.rawNodes);
}