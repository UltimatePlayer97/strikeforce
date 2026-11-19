import * as THREE from 'three';
import type { Soldier, Team, KillfeedEntry } from '../types';
import { getRadarHalfExtent, getZoneMode, getMapColliders, getMapRamps, getDestructibleProps, getRadarWalls } from '../world/map';
import { getActiveSmokes } from '../weapons/projectile';
import { hasLineOfSight } from '../physics/collision';

interface HUDElements {
  hudLayer: HTMLElement;
  crosshairContainer: HTMLElement;
  hitmarkerWrap: HTMLElement;
  hitmarker: HTMLElement;
  hpValue: HTMLElement;
  hpBar: HTMLElement;
  stanceBadge: HTMLElement;
  weaponNameHud: HTMLElement;
  ammoMag: HTMLElement;
  ammoReserve: HTMLElement;
  reloadBarWrap: HTMLElement;
  reloadBar: HTMLElement;
  grenadeCount: HTMLElement;
  smokeCount: HTMLElement;
  alphaScore: HTMLElement;
  bravoScore: HTMLElement;
  alphaPips: HTMLElement;
  bravoPips: HTMLElement;
  matchTimer: HTMLElement;
  killfeed: HTMLElement;
  mapNameLabel: HTMLElement;
  zoneLabel: HTMLElement;
  radarCanvas: HTMLCanvasElement;
  damageVignette: HTMLElement;
  adsVignette: HTMLElement;
  scopeOverlay: HTMLElement;
  deathCamOverlay: HTMLElement;
  deathKillerText: HTMLElement;
  deathTimerText: HTMLElement;
  spawnProtectionBadge: HTMLElement;
  spawnProtectionTime: HTMLElement;
  damageDirection: HTMLElement;
  damageDirectionSpin: HTMLElement;
  hudToast: HTMLElement;
  netBadge: HTMLElement;
}

let elements: HUDElements | null = null;
let radarCtx: CanvasRenderingContext2D | null = null;

export function initHUD(): HUDElements {
  const els: HUDElements = {
    hudLayer: document.getElementById('hud-layer')!,
    crosshairContainer: document.getElementById('crosshair-container')!,
    hitmarkerWrap: document.getElementById('hitmarker-wrap')!,
    hitmarker: document.getElementById('hitmarker') as HTMLElement,
    hpValue: document.getElementById('hp-value')!,
    hpBar: document.getElementById('hp-bar')!,
    stanceBadge: document.getElementById('stance-badge')!,
    weaponNameHud: document.getElementById('weapon-name-hud')!,
    ammoMag: document.getElementById('ammo-mag')!,
    ammoReserve: document.getElementById('ammo-reserve')!,
    reloadBarWrap: document.getElementById('reload-bar-wrap')!,
    reloadBar: document.getElementById('reload-bar')!,
    grenadeCount: document.getElementById('grenade-count')!,
    smokeCount: document.getElementById('smoke-count')!,
    alphaScore: document.getElementById('alpha-score')!,
    bravoScore: document.getElementById('bravo-score')!,
    alphaPips: document.getElementById('alpha-pips')!,
    bravoPips: document.getElementById('bravo-pips')!,
    matchTimer: document.getElementById('match-timer')!,
    killfeed: document.getElementById('killfeed')!,
    mapNameLabel: document.getElementById('map-name-label')!,
    zoneLabel: document.getElementById('zone-label')!,
    radarCanvas: document.getElementById('radar-canvas') as HTMLCanvasElement,
    damageVignette: document.getElementById('damage-vignette')!,
    adsVignette: document.getElementById('ads-vignette')!,
    scopeOverlay: document.getElementById('scope-overlay')!,
    deathCamOverlay: document.getElementById('death-cam-overlay')!,
    deathKillerText: document.getElementById('death-killer-text')!,
    deathTimerText: document.getElementById('death-timer-text')!,
    spawnProtectionBadge: document.getElementById('spawn-protection-badge')!,
    spawnProtectionTime: document.getElementById('spawn-protection-time')!,
    damageDirection: document.getElementById('damage-direction')!,
    damageDirectionSpin: document.getElementById('damage-direction-spin')!,
    hudToast: document.getElementById('hud-toast')!,
    netBadge: document.getElementById('net-badge')!
  };

  radarCtx = els.radarCanvas.getContext('2d')!;
  elements = els;

  return els;
}

export function getHUDElements(): HUDElements | null {
  return elements;
}

export function showHUD(): void {
  if (elements) elements.hudLayer.classList.remove('hidden');
}

export function hideHUD(): void {
  if (elements) elements.hudLayer.classList.add('hidden');
}

export function updateHUD(player: Soldier, alphaScore: number, bravoScore: number, matchTime: number, allSoldiers: Soldier[]): void {
  if (!elements) return;

  elements.hpValue.textContent = Math.max(0, Math.ceil(player.hp)).toString();
  elements.hpBar.style.width = `${Math.max(0, player.hp / player.maxHp * 100)}%`;

  const stanceText = player.stance === 'crouch' ? 'CROUCH' : player.stance === 'prone' ? 'PRONE' : 'STAND';
  elements.stanceBadge.textContent = `${player.team}-${player.name} • ${stanceText}`;

  elements.weaponNameHud.textContent = player.weapon.stats.name;
  elements.ammoMag.textContent = player.weapon.ammo.toString();
  elements.ammoReserve.textContent = player.weapon.reserve.toString();

  if (player.weapon.isReloading) {
    elements.reloadBarWrap.classList.remove('hidden');
    const progress = (performance.now() - (player.weapon.reloadEndTime - player.weapon.stats.reloadMs)) / player.weapon.stats.reloadMs;
    elements.reloadBar.style.width = `${Math.min(100, progress * 100)}%`;
  } else {
    elements.reloadBarWrap.classList.add('hidden');
  }

  elements.grenadeCount.textContent = player.grenades.toString();
  elements.smokeCount.textContent = player.smokes.toString();

  elements.alphaScore.textContent = alphaScore.toString();
  elements.bravoScore.textContent = bravoScore.toString();

  updateTeamPips(elements.alphaPips, allSoldiers.filter(s => s.team === 'ALPHA'));
  updateTeamPips(elements.bravoPips, allSoldiers.filter(s => s.team === 'BRAVO'));

  const minutes = Math.floor(matchTime / 60);
  const seconds = Math.floor(matchTime % 60);
  elements.matchTimer.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function updateTeamPips(container: HTMLElement, soldiers: Soldier[]): void {
  container.innerHTML = '';
  for (const s of soldiers) {
    const pip = document.createElement('div');
    pip.className = `w-1.5 h-1.5 rounded-full ${s.isAlive ? 'bg-green-400' : 'bg-red-500'}`;
    if (!s.isHuman) pip.classList.add('opacity-60');
    container.appendChild(pip);
  }
}

export function showHitmarker(headshot = false): void {
  if (!elements) return;
  elements.hitmarker.style.color = headshot ? '#ef4444' : '#22c55e';
  elements.hitmarker.classList.remove('opacity-0');
  setTimeout(() => elements!.hitmarker.classList.add('opacity-0'), 75);
}

export function showDamageDirection(angle: number): void {
  if (!elements) return;
  elements.damageDirectionSpin.style.transform = `rotate(${angle}deg)`;
  elements.damageDirection.classList.remove('opacity-0');
  setTimeout(() => elements!.damageDirection.classList.add('opacity-0'), 800);
}

export function showDamageVignette(intensity: number): void {
  if (!elements) return;
  elements.damageVignette.style.opacity = intensity.toString();
  setTimeout(() => { elements!.damageVignette.style.opacity = '0'; }, 300);
}

export function setADS(active: boolean): void {
  if (!elements) return;
  elements.adsVignette.style.opacity = active ? '1' : '0';
  elements.crosshairContainer.style.opacity = active ? '0.3' : '1';
}

export function setScope(active: boolean): void {
  if (!elements) return;
  elements.scopeOverlay.style.opacity = active ? '1' : '0';
}

export function showDeathCam(killerName: string, respawnTime: number): void {
  if (!elements) return;
  elements.deathKillerText.textContent = `Eliminated by ${killerName}`;
  elements.deathTimerText.textContent = `${respawnTime.toFixed(1)}s`;
  elements.deathCamOverlay.classList.remove('hidden');
}

export function hideDeathCam(): void {
  if (!elements) return;
  elements.deathCamOverlay.classList.add('hidden');
}

export function updateDeathTimer(time: number): void {
  if (!elements) return;
  elements.deathTimerText.textContent = `${time.toFixed(1)}s`;
}

export function showSpawnProtection(time: number): void {
  if (!elements) return;
  elements.spawnProtectionBadge.classList.remove('hidden');
  elements.spawnProtectionTime.textContent = time.toFixed(1);
}

export function hideSpawnProtection(): void {
  if (!elements) return;
  elements.spawnProtectionBadge.classList.add('hidden');
}

export function showToast(message: string): void {
  if (!elements) return;
  elements.hudToast.textContent = message;
  elements.hudToast.classList.remove('hidden');
  setTimeout(() => elements!.hudToast.classList.add('hidden'), 3000);
}

export function addKillfeedEntry(entry: KillfeedEntry): void {
  if (!elements) return;
  const div = document.createElement('div');
  div.className = `glass-hud rounded-lg px-2 py-1 text-[11px] font-mono ${entry.isLocal ? 'text-emerald-300' : 'text-slate-200'}`;
  div.innerHTML = `<span class="font-bold ${entry.killer === 'YOU' ? 'text-sky-400' : entry.killer.startsWith('BRAVO') ? 'text-red-400' : 'text-blue-400'}">${entry.killer}</span> ${entry.headshot ? '<span class="text-amber-400">⟐</span> ' : ''}<span class="font-bold ${entry.victim === 'YOU' ? 'text-sky-400' : entry.victim.startsWith('BRAVO') ? 'text-red-400' : 'text-blue-400'}">${entry.victim}</span> <span class="text-slate-500">[${entry.weapon}]</span>`;
  elements.killfeed.prepend(div);
  while (elements.killfeed.children.length > 8) elements.killfeed.lastChild?.remove();
}

export function updateRadar(player: Soldier, allSoldiers: Soldier[], mapDef: any): void {
  if (!radarCtx || !elements) return;

  const ctx = radarCtx;
  const size = elements.radarCanvas.width;
  const half = getRadarHalfExtent();
  const center = size / 2;
  const scale = center / half;

  ctx.clearRect(0, 0, size, size);

  ctx.fillStyle = '#0a1220';
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = '#1e2a44';
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, size, size);

  // Draw map walls
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 1.5;
  for (const wall of getRadarWalls()) {
    const x = (wall.x + half) * scale;
    const z = (half - (wall.z + wall.d)) * scale;
    const w = wall.w * scale;
    const h = wall.d * scale;
    if (wall.isPlatform) ctx.strokeStyle = '#64748b';
    else if (wall.isRamp) ctx.strokeStyle = '#475569';
    ctx.strokeRect(x, z, w, h);
    ctx.strokeStyle = '#334155';
  }

  // Draw destructible props
  for (const prop of getDestructibleProps()) {
    if (prop.destroyed) continue;
    if (!prop.radar) continue;
    const hpRatio = prop.hp / prop.maxHp;
    ctx.fillStyle = hpRatio > 0.6 ? '#22c55e' : hpRatio > 0.3 ? '#facc15' : '#ef4444';
    ctx.globalAlpha = 0.7;
    const x = (prop.radar.x + half) * scale;
    const z = (half - (prop.radar.z + prop.radar.d)) * scale;
    ctx.fillRect(x, z, prop.radar.w * scale, prop.radar.d * scale);
    ctx.globalAlpha = 1;
  }

  // Draw teammates
  for (const s of allSoldiers) {
    if (!s.isAlive) continue;
    const relX = (s.pos.x - player.pos.x) * scale;
    const relZ = (player.pos.z - s.pos.z) * scale;
    const dist = Math.hypot(relX, relZ);
    if (dist > center) continue;

    const x = center + relX;
    const y = center + relZ;

    if (s.team === player.team) {
      ctx.fillStyle = s.team === 'ALPHA' ? '#3b82f6' : '#ef4444';
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
      if (!s.isHuman) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    } else if (hasLineOfSight(player.pos, s.pos)) {
      ctx.fillStyle = s.team === 'ALPHA' ? '#3b82f6' : '#ef4444';
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Draw player
  ctx.fillStyle = '#22c55e';
  ctx.beginPath();
  ctx.arc(center, center, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Draw player direction
  ctx.strokeStyle = '#22c55e';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(center, center);
  ctx.lineTo(
    center + Math.sin(-player.yaw) * 12,
    center + Math.cos(-player.yaw) * 12
  );
  ctx.stroke();

  // Zone label
  if (elements.zoneLabel) {
    elements.zoneLabel.textContent = getZoneMode();
  }
}



export function setNetworkStatus(connected: boolean, peerCount: number): void {
  if (!elements) return;
  if (connected) {
    elements.netBadge.classList.remove('hidden');
    elements.netBadge.textContent = `P2P • ${peerCount + 1}/12`;
  } else {
    elements.netBadge.classList.add('hidden');
  }
}