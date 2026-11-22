import { updateThrowableHUD, updateWeaponHUD } from '../ui/hud';
import type { Soldier } from '../types';
import { $ } from '../util/dom';
import { equipWeapon } from '../weapons/viewmodel';
import { game, loadout } from './state';

/** Swap which soldier the local human controls (offline: slot 0; online: server-assigned slot). */
export function setLocalPlayer(s: Soldier): void {
  if (game.humanPlayer === s) return;
  const old = game.humanPlayer;
  old.isPlayer = false;
  if (old.alive) old.rig.root.visible = true;
  s.isPlayer = true;
  s.rig.root.visible = !s.alive;
  game.humanPlayer = s;
  game.isADS = false;
  equipWeapon(s, loadout.selected);
  const badge = $('stance-badge');
  badge.textContent = s.name;
  badge.className =
    s.team === 'ALPHA'
      ? 'px-2 py-0.5 rounded bg-blue-500/20 border border-blue-400/30 text-[10px] font-bold text-blue-300 uppercase'
      : 'px-2 py-0.5 rounded bg-red-500/20 border border-red-400/30 text-[10px] font-bold text-red-300 uppercase';
  $('respawn-base-text').textContent = `Respawning at ${s.team === 'ALPHA' ? 'Alpha' : 'Bravo'} Base in`;
  updateWeaponHUD();
  updateThrowableHUD();
}
