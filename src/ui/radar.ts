import * as THREE from 'three';
import { allSoldiers, game, radarWalls } from '../game/state';
import { $ } from '../util/dom';

const radarCanvas = $<HTMLCanvasElement>('radar-canvas');
let radarCtx2d: CanvasRenderingContext2D | null = null;

function getCtx(): CanvasRenderingContext2D {
  if (!radarCtx2d) {
    const ctx = radarCanvas.getContext('2d');
    if (!ctx) throw new Error('Radar 2D context unavailable');
    radarCtx2d = ctx;
  }
  return radarCtx2d;
}

export function getZoneName(pos: THREE.Vector3): string {
  if (game.zoneMode === 'SHOOT_HOUSE') {
    if (pos.z > 14) return 'ALPHA RANGE';
    if (pos.z < -14) return 'BRAVO RANGE';
    if (Math.abs(pos.x) > 14) return 'RANGE ALLEY';
    return 'SHOOT HOUSE';
  }
  if (game.zoneMode === 'BLAST_TOWN') {
    if (pos.z > 16) return 'ALPHA BLOCK';
    if (pos.z < -16) return 'BRAVO BLOCK';
    if (Math.abs(pos.x) > 18) return 'SIDE ALLEY';
    return 'BLAST TOWN';
  }
  if (game.zoneMode === 'DOWNTOWN') {
    if (pos.z > 25) return 'ALPHA DOWNTOWN';
    if (pos.z < -25) return 'BRAVO DOWNTOWN';
    if (Math.abs(pos.x) > 27) return 'CITY ALLEY';
    return 'CITY PLAZA';
  }
  if (game.zoneMode === 'SHIPMENT') {
    if (pos.z > 14) return 'ALPHA SPAWN';
    if (pos.z < -14) return 'BRAVO SPAWN';
    if (Math.abs(pos.x) > 14) return pos.x > 0 ? 'EAST CONTAINERS' : 'WEST CONTAINERS';
    return 'CONTAINER CROWN';
  }
  if (pos.z > 28) return 'ALPHA BASE';
  if (pos.z < -28) return 'BRAVO BASE';
  if (pos.x < -23) return 'WEST ALLEY';
  if (pos.x > 22 && pos.y > 1.8) return 'OVERLOOK CATWALK';
  if (pos.x > 22) return 'EAST WAREHOUSE';
  return 'COURTYARD';
}

export function drawRadarMinimap(): void {
  const radarCtx = getCtx();
  const w = radarCanvas.width;
  const h = radarCanvas.height;
  radarCtx.clearRect(0, 0, w, h);

  const scale = w / (game.radarHalfExtent * 2);
  const toRadarX = (wx: number): number => (wx + game.radarHalfExtent) * scale;
  const toRadarY = (wz: number): number => (wz + game.radarHalfExtent) * scale;

  // Subtle tactical grid
  radarCtx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
  radarCtx.lineWidth = 1;
  const gridStep = game.radarHalfExtent > 40 ? 20 : 10;
  for (let g = -game.radarHalfExtent; g <= game.radarHalfExtent; g += gridStep) {
    const p = (g + game.radarHalfExtent) * scale;
    radarCtx.beginPath();
    radarCtx.moveTo(p, 0);
    radarCtx.lineTo(p, h);
    radarCtx.stroke();
    radarCtx.beginPath();
    radarCtx.moveTo(0, p);
    radarCtx.lineTo(w, p);
    radarCtx.stroke();
  }

  // Draw Map Walls, Cover & Elevated Ramps
  for (const wall of radarWalls) {
    if (wall.destroyed) continue;
    if (wall.isRamp) radarCtx.fillStyle = 'rgba(245, 158, 11, 0.35)';
    else if (wall.isPlatform) radarCtx.fillStyle = 'rgba(148, 163, 184, 0.42)';
    else radarCtx.fillStyle = 'rgba(100, 116, 139, 0.55)';
    radarCtx.fillRect(toRadarX(wall.x), toRadarY(wall.z), wall.w * scale, wall.d * scale);
  }

  // Player View Cone
  const px = toRadarX(game.humanPlayer.pos.x);
  const py = toRadarY(game.humanPlayer.pos.z);
  if (game.humanPlayer.alive) {
    const lookAngle = -game.humanPlayer.yaw - Math.PI / 2;
    radarCtx.fillStyle = 'rgba(56, 189, 248, 0.16)';
    radarCtx.beginPath();
    radarCtx.moveTo(px, py);
    radarCtx.arc(px, py, 26, lookAngle - 0.55, lookAngle + 0.55);
    radarCtx.closePath();
    radarCtx.fill();
  }

  // Draw All 12 Operators (Blue Allies, Red Enemies, Grey X for Ragdoll KIA)
  for (const s of allSoldiers) {
    const sx = toRadarX(s.pos.x);
    const sy = toRadarY(s.pos.z);

    if (!s.alive) {
      radarCtx.strokeStyle = s.team === 'ALPHA' ? 'rgba(96,165,250,0.45)' : 'rgba(248,113,113,0.45)';
      radarCtx.lineWidth = 1.5;
      radarCtx.beginPath();
      radarCtx.moveTo(sx - 2.5, sy - 2.5);
      radarCtx.lineTo(sx + 2.5, sy + 2.5);
      radarCtx.moveTo(sx + 2.5, sy - 2.5);
      radarCtx.lineTo(sx - 2.5, sy + 2.5);
      radarCtx.stroke();
      continue;
    }

    radarCtx.beginPath();
    radarCtx.arc(sx, sy, s.isPlayer ? 4.2 : 3.2, 0, Math.PI * 2);
    radarCtx.fillStyle = s.isPlayer ? '#38bdf8' : s.team === 'ALPHA' ? '#3b82f6' : '#ef4444';
    radarCtx.fill();
    if (s.isPlayer) {
      radarCtx.strokeStyle = '#ffffff';
      radarCtx.lineWidth = 1.4;
      radarCtx.stroke();
    }
  }
}
