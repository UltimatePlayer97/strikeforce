import { allSoldiers, game, matchState } from '../game/state';
import { weaponOf } from '../weapons/defs';
import { weaponLabel } from '../weapons/models';
import { $ } from '../util/dom';
import { updateDamageDirection } from './feedback';
import { drawRadarMinimap, getZoneName } from './radar';

export function updateThrowableHUD(): void {
  $('grenade-count').textContent = String(game.humanPlayer.grenadeCharges ?? 0);
  $('smoke-count').textContent = String(game.humanPlayer.smokeCharges ?? 0);
}

export function updateWeaponHUD(): void {
  const hp = game.humanPlayer;
  $('weapon-name-hud').textContent = weaponLabel(hp.weaponId);
  const hintEl = $('ammo-hint');
  const hw = weaponOf(hp);
  if (hintEl.dataset.w !== hw.id) {
    hintEl.innerHTML = hw.hint;
    hintEl.dataset.w = hw.id;
  }
  $('ammo-mag').textContent = String(hp.magAmmo);
  $('ammo-reserve').textContent = String(hp.reserveAmmo);
  updateThrowableHUD();
}

export function updateHUD(dt: number): void {
  matchState.timeRemaining = Math.max(0, matchState.timeRemaining - dt);
  const mins = Math.floor(matchState.timeRemaining / 60);
  const secs = Math.floor(matchState.timeRemaining % 60);
  $('match-timer').textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  $('alpha-score').textContent = String(matchState.alphaScore);
  $('bravo-score').textContent = String(matchState.bravoScore);
  $('zone-label').textContent = getZoneName(game.humanPlayer.pos);

  // HP Bar
  const hp = Math.ceil(game.humanPlayer.hp);
  $('hp-value').textContent = String(hp);
  const hpBar = $('hp-bar');
  hpBar.style.width = `${hp}%`;
  if (hp > 50) {
    hpBar.className = 'h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-150';
  } else if (hp > 25) {
    hpBar.className = 'h-full bg-gradient-to-r from-amber-500 to-yellow-400 transition-all duration-150';
  } else {
    hpBar.className = 'h-full bg-gradient-to-r from-red-600 to-rose-500 transition-all duration-150';
  }

  // Alive team pips
  $('alpha-pips').innerHTML = allSoldiers
    .filter((s) => s.team === 'ALPHA')
    .map((s) => `<span class="w-2.5 h-1.5 rounded-sm ${s.alive ? 'bg-blue-400' : 'bg-slate-700'}"></span>`)
    .join('');
  $('bravo-pips').innerHTML = allSoldiers
    .filter((s) => s.team === 'BRAVO')
    .map((s) => `<span class="w-2.5 h-1.5 rounded-sm ${s.alive ? 'bg-red-400' : 'bg-slate-700'}"></span>`)
    .join('');

  drawRadarMinimap();
  updateDamageDirection(dt);
}
