import * as THREE from 'three';
import { sfx } from '../audio/SoundFX';
import { camera, canvas } from '../core/renderer';
import { activeSpawns } from '../game/spawns';
import { game, keys, loadout, matchState } from '../game/state';
import type { AiSkill, WeaponId } from '../types';
import { $, storage } from '../util/dom';
import { isWeaponId, WEAPONS } from '../weapons/defs';
import { equipWeapon } from '../weapons/viewmodel';

function nearOwnSpawn(): boolean {
  const hp = game.humanPlayer;
  const spawns = activeSpawns(hp.team);
  const sp = spawns[hp.spawnIdx % spawns.length];
  return Math.hypot(hp.pos.x - sp.x, hp.pos.z - sp.z) < 7;
}

export function renderLoadout(note?: string): void {
  const loadoutGrid = $('loadout-grid');
  const loadoutNote = $('loadout-note');
  const equipped = game.humanPlayer.weaponId === loadout.selected;
  const text =
    note !== undefined
      ? note
      : equipped
        ? `Equipped: ${WEAPONS[loadout.selected].cls}`
        : `Next respawn: ${WEAPONS[loadout.selected].cls}`;
  loadoutNote.textContent = text;
  loadoutGrid.innerHTML = '';
  for (const w of Object.values(WEAPONS)) {
    const sel = w.id === loadout.selected;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className =
      'text-left rounded-xl p-2.5 border transition ' +
      (sel
        ? 'bg-sky-500/20 border-sky-400 ring-1 ring-sky-400/60'
        : 'bg-slate-800/70 border-slate-700 hover:bg-slate-700/70');
    const bars = ['DMG', 'ROF', 'RNG', 'MOB']
      .map(
        (lbl, i) =>
          `<div class="flex items-center gap-1.5"><span class="w-6 text-[9px] font-bold text-slate-400">${lbl}</span>` +
          `<div class="flex-1 h-1 rounded bg-slate-900 overflow-hidden"><div class="h-full ${sel ? 'bg-sky-400' : 'bg-slate-400'}" style="width:${w.stats[i] * 20}%"></div></div></div>`,
      )
      .join('');
    btn.innerHTML =
      `<div class="text-[11px] font-extrabold tracking-wider ${sel ? 'text-sky-300' : 'text-white'}">${w.cls}</div>` +
      `<div class="text-[10px] text-slate-400 mb-1.5">${w.role}</div>` +
      `<div class="space-y-1">${bars}</div>` +
      `<div class="mono text-[10px] text-slate-300 mt-1.5">${w.mag} / ${w.reserve}</div>`;
    btn.addEventListener('click', () => selectLoadout(w.id));
    loadoutGrid.appendChild(btn);
  }
}

function selectLoadout(id: WeaponId): void {
  loadout.selected = id;
  storage.set('sf_loadout', id);
  if (game.humanPlayer.weaponId !== id && (!loadout.started || (game.humanPlayer.alive && nearOwnSpawn()))) {
    equipWeapon(game.humanPlayer, id);
  }
  renderLoadout();
}

function startDeploy(): void {
  const menuOverlay = $('menu-overlay');
  const hudLayer = $('hud-layer');
  if (!loadout.started) {
    loadout.started = true;
    if (game.humanPlayer.weaponId !== loadout.selected) equipWeapon(game.humanPlayer, loadout.selected);
  }
  try {
    sfx.init();
  } catch (err) {
    console.error('sfx.init failed', err);
  }
  try {
    const p: Promise<void> | undefined = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
    if (p && p.catch) {
      p.catch((err: unknown) => {
        // Browser blocks re-lock ~1s after ESC. Retry once.
        console.warn('pointer lock rejected, retry', err);
        setTimeout(() => {
          try {
            canvas.requestPointerLock();
          } catch {
            /* ignore */
          }
        }, 1100);
      });
    }
  } catch (err) {
    console.error('requestPointerLock threw', err);
  }
  // Fallback: if lock never arrives, still start game (no mouse look until lock)
  setTimeout(() => {
    if (document.pointerLockElement !== canvas) {
      menuOverlay.classList.add('hidden');
      hudLayer.classList.remove('hidden');
      matchState.paused = false;
    }
  }, 1500);
  $('deploy-btn').textContent = 'RESUME COMBAT';
}

function loadSavedSettings(): void {
  const sensSlider = $<HTMLInputElement>('sens-slider');
  const adsSensSlider = $<HTMLInputElement>('ads-sens-slider');
  const fovSlider = $<HTMLInputElement>('fov-slider');
  const cameraBobToggle = $<HTMLInputElement>('camera-bob-toggle');

  matchState.mouseSensitivity = parseFloat(storage.get('sf_sens') || '1');
  matchState.adsSensitivity = parseFloat(storage.get('sf_ads_sens') || '1');
  matchState.baseFieldOfView = THREE.MathUtils.clamp(parseFloat(storage.get('sf_fov') || '75'), 60, 100);
  matchState.cameraBob = storage.get('sf_camera_bob') !== '0';
  sensSlider.value = String(matchState.mouseSensitivity);
  adsSensSlider.value = String(matchState.adsSensitivity);
  fovSlider.value = String(matchState.baseFieldOfView);
  cameraBobToggle.checked = matchState.cameraBob;
  $('sens-val').textContent = matchState.mouseSensitivity.toFixed(2);
  $('ads-sens-val').textContent = matchState.adsSensitivity.toFixed(2);
  $('fov-val').textContent = String(matchState.baseFieldOfView);
}

/** Restores the saved class selection (call before the roster is created). */
export function restoreSavedLoadout(): void {
  const saved = storage.get('sf_loadout');
  if (isWeaponId(saved)) loadout.selected = saved;
}

/** Wires up menu, settings, loadout and pointer-lock handling. Call once DOM is ready. */
export function initMenu(): void {
  const menuOverlay = $('menu-overlay');
  const hudLayer = $('hud-layer');
  const sensSlider = $<HTMLInputElement>('sens-slider');
  const adsSensSlider = $<HTMLInputElement>('ads-sens-slider');
  const fovSlider = $<HTMLInputElement>('fov-slider');
  const cameraBobToggle = $<HTMLInputElement>('camera-bob-toggle');
  const aiSkillSelect = $<HTMLSelectElement>('ai-skill-select');

  loadSavedSettings();

  sensSlider.addEventListener('input', () => {
    matchState.mouseSensitivity = parseFloat(sensSlider.value);
    $('sens-val').textContent = matchState.mouseSensitivity.toFixed(2);
    storage.set('sf_sens', String(matchState.mouseSensitivity));
  });

  adsSensSlider.addEventListener('input', () => {
    matchState.adsSensitivity = parseFloat(adsSensSlider.value);
    $('ads-sens-val').textContent = matchState.adsSensitivity.toFixed(2);
    storage.set('sf_ads_sens', String(matchState.adsSensitivity));
  });

  fovSlider.addEventListener('input', () => {
    matchState.baseFieldOfView = parseInt(fovSlider.value, 10);
    $('fov-val').textContent = String(matchState.baseFieldOfView);
    camera.fov = matchState.baseFieldOfView;
    camera.updateProjectionMatrix();
    storage.set('sf_fov', String(matchState.baseFieldOfView));
  });

  cameraBobToggle.addEventListener('change', () => {
    matchState.cameraBob = cameraBobToggle.checked;
    storage.set('sf_camera_bob', matchState.cameraBob ? '1' : '0');
  });

  aiSkillSelect.addEventListener('change', () => {
    matchState.aiSkill = aiSkillSelect.value as AiSkill;
  });

  $('deploy-btn').addEventListener('click', startDeploy);

  // Enter = deploy when menu open (button may sit below fold on short windows)
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    const tag = document.activeElement?.tagName;
    if (
      e.code === 'Enter' &&
      matchState.paused &&
      !menuOverlay.classList.contains('hidden') &&
      tag !== 'INPUT' &&
      tag !== 'SELECT'
    ) {
      e.preventDefault();
      startDeploy();
    }
  });

  document.addEventListener('pointerlockerror', () => {
    console.warn('pointerlockerror');
    setTimeout(() => {
      try {
        canvas.requestPointerLock();
      } catch {
        /* ignore */
      }
    }, 1100);
  });

  // Click canvas while paused = deploy too
  canvas.addEventListener('click', () => {
    if (matchState.paused && document.pointerLockElement !== canvas) startDeploy();
  });

  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === canvas;
    if (!locked) {
      matchState.paused = true;
      for (const k in keys) keys[k] = false;
      game.isMouseDown = false;
      game.isADS = false;
      $('ads-vignette').style.opacity = '0';
      menuOverlay.classList.remove('hidden');
      renderLoadout();
    } else {
      matchState.paused = false;
      menuOverlay.classList.add('hidden');
      hudLayer.classList.remove('hidden');
    }
  });
}
