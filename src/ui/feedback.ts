import * as THREE from 'three';
import { game } from '../game/state';
import type { Soldier } from '../types';
import { WEAPONS } from '../weapons/defs';
import { $ } from '../util/dom';

// ---------------------------------------------------------------------------
// HUD toast
// ---------------------------------------------------------------------------
let toastTimeout: ReturnType<typeof setTimeout> | undefined;

export function showHudToast(msg: string, duration = 2600): void {
  const el = $('hud-toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => el.classList.add('hidden'), duration);
}

// ---------------------------------------------------------------------------
// Spawn protection badge
// ---------------------------------------------------------------------------
export function showSpawnProtectionStatus(seconds = 3): void {
  $('spawn-protection-badge').classList.remove('hidden');
  $('spawn-protection-time').textContent = `${Math.max(0, seconds).toFixed(1)}s`;
}

export function hideSpawnProtectionStatus(): void {
  $('spawn-protection-badge').classList.add('hidden');
}

export function updateSpawnProtection(soldier: Soldier | null, dt: number): void {
  if (!soldier || !soldier.alive) return;
  soldier.spawnProtection = Math.max(0, (soldier.spawnProtection || 0) - dt);
  if (!soldier.isPlayer) return;
  if (soldier.spawnProtection > 0) showSpawnProtectionStatus(soldier.spawnProtection);
  else hideSpawnProtectionStatus();
}

// ---------------------------------------------------------------------------
// Damage direction indicator + explosion shake
// ---------------------------------------------------------------------------
let damageDirectionTimer = 0;

export function triggerDamageDirection(sourcePos: THREE.Vector3 | null): void {
  const hp = game.humanPlayer;
  if (!hp || !sourcePos || damageDirectionTimer > 0.35) damageDirectionTimer = 0.35;
  damageDirectionTimer = Math.max(damageDirectionTimer, 0.62);
  if (!sourcePos) return;
  const dx = sourcePos.x - hp.pos.x;
  const dz = sourcePos.z - hp.pos.z;
  const forwardDot = dx * -Math.sin(hp.yaw) + dz * -Math.cos(hp.yaw);
  const rightDot = dx * Math.cos(hp.yaw) + dz * -Math.sin(hp.yaw);
  const angle = (Math.atan2(rightDot, forwardDot) * 180) / Math.PI;
  $('damage-direction-spin').style.transform = `rotate(${angle.toFixed(1)}deg)`;
  $('damage-direction').style.opacity = '1';
}

export function updateDamageDirection(dt: number): void {
  if (damageDirectionTimer <= 0) return;
  damageDirectionTimer -= dt;
  if (damageDirectionTimer <= 0) {
    $('damage-direction').style.opacity = '0';
  }
}

export function shakeScreenFromExplosion(worldPos: THREE.Vector3 | null, power = 1): void {
  if (!worldPos) return;
  const dist = game.humanPlayer?.pos ? game.humanPlayer.pos.distanceTo(worldPos) : 999;
  const proximity = Math.max(0, 1 - dist / 19);
  game.screenShake = Math.max(game.screenShake, proximity * 0.22 * power);
}

// ---------------------------------------------------------------------------
// Killfeed + hitmarker
// ---------------------------------------------------------------------------
export function addKillfeedEntry(killer: Soldier, victim: Soldier, isHeadshot: boolean): void {
  const killfeedEl = $('killfeed');
  const row = document.createElement('div');
  row.className =
    'glass-hud rounded-lg px-3 py-1.5 text-xs font-bold flex items-center gap-1.5 shadow-lg transition-opacity duration-300';
  const kColor = killer.team === 'ALPHA' ? 'text-blue-400' : 'text-red-400';
  const vColor = victim.team === 'ALPHA' ? 'text-blue-400' : 'text-red-400';

  row.innerHTML = `
    <span class="${kColor}">${killer.name}</span>
    <span class="text-slate-400 text-[10px]">[${(WEAPONS[killer.weaponId] || WEAPONS.assault).tag}${isHeadshot ? ' &bull; HEADSHOT' : ''}]</span>
    <span class="${vColor}">${victim.name}</span>
  `;
  killfeedEl.prepend(row);
  while (killfeedEl.children.length > 5) {
    killfeedEl.removeChild(killfeedEl.lastChild as ChildNode);
  }
  setTimeout(() => {
    row.style.opacity = '0';
    setTimeout(() => row.remove(), 320);
  }, 4500);
}

let hitmarkerTimer: ReturnType<typeof setTimeout> | undefined;

export function triggerHitmarker(isKillOrHeadshot: boolean, isSpawnProtected = false): void {
  const hitmarkerEl = $('hitmarker');
  if (isSpawnProtected) {
    hitmarkerEl.style.color = '#60a5fa'; // blue for spawn protection
  } else {
    hitmarkerEl.style.color = isKillOrHeadshot ? '#ef4444' : '#ffffff';
  }
  hitmarkerEl.style.opacity = '1';
  clearTimeout(hitmarkerTimer);
  hitmarkerTimer = setTimeout(() => {
    hitmarkerEl.style.opacity = '0';
  }, 110);
}
