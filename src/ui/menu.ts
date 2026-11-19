import type { GameSettings, Role, Team } from '../types';
import { WEAPON_PRESETS } from '../weapons/custom';
import { loadCustomWeapon, resetToBaseWeapon, applyCustomWeapon } from '../weapons/custom';
import { createWeaponInstance, WEAPON_STATS } from '../weapons/weapon';

interface MenuCallbacks {
  onDeploy: (role: Role) => void;
  onSettingsChange: (settings: Partial<GameSettings>) => void;
  onWeaponChange: (role: Role, customData: any) => void;
  onWeaponReset: () => void;
  onMultiplayerNew: (relayUrl: string, name: string, room: string, team: Team) => void;
  onMultiplayerJoin: (relayUrl: string, name: string, room: string, team: Team) => void;
  onMultiplayerLeave: () => void;
  onMultiplayerCopy: () => void;
}

let callbacks: MenuCallbacks | null = null;
let currentRole: Role = 'ASSAULT';
let currentSettings: GameSettings = {
  sensitivity: 1.0,
  adsSensitivity: 1.0,
  fov: 75,
  cameraBob: true,
  aiSkill: 'VETERAN',
  masterVolume: 1.0,
  sfxVolume: 1.0
};

export function initMenu(cb: MenuCallbacks): void {
  callbacks = cb;
  setupEventListeners();
  populateLoadoutGrid();
  populateWeaponPresets();
}

function setupEventListeners(): void {
  // Loadout buttons
  document.getElementById('loadout-grid')!.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-role]');
    if (btn) {
      currentRole = btn.getAttribute('data-role') as Role;
      updateLoadoutSelection();
      callbacks?.onDeploy(currentRole);
    }
  });

  // Settings sliders
  const sensSlider = document.getElementById('sens-slider') as HTMLInputElement;
  const adsSensSlider = document.getElementById('ads-sens-slider') as HTMLInputElement;
  const fovSlider = document.getElementById('fov-slider') as HTMLInputElement;

  sensSlider.addEventListener('input', () => {
    currentSettings.sensitivity = parseFloat(sensSlider.value);
    updateSliderValue('sens-val', sensSlider.value);
    callbacks?.onSettingsChange({ sensitivity: currentSettings.sensitivity });
  });

  adsSensSlider.addEventListener('input', () => {
    currentSettings.adsSensitivity = parseFloat(adsSensSlider.value);
    updateSliderValue('ads-sens-val', adsSensSlider.value);
    callbacks?.onSettingsChange({ adsSensitivity: currentSettings.adsSensitivity });
  });

  fovSlider.addEventListener('input', () => {
    currentSettings.fov = parseInt(fovSlider.value, 10);
    updateSliderValue('fov-val', fovSlider.value);
    callbacks?.onSettingsChange({ fov: currentSettings.fov });
  });

  const cameraBobToggle = document.getElementById('camera-bob-toggle') as HTMLInputElement;
  cameraBobToggle.addEventListener('change', () => {
    currentSettings.cameraBob = cameraBobToggle.checked;
    callbacks?.onSettingsChange({ cameraBob: currentSettings.cameraBob });
  });

  const aiSkillSelect = document.getElementById('ai-skill-select') as HTMLSelectElement;
  aiSkillSelect.addEventListener('change', () => {
    currentSettings.aiSkill = aiSkillSelect.value as GameSettings['aiSkill'];
    callbacks?.onSettingsChange({ aiSkill: currentSettings.aiSkill });
  });

  // Weapon preset select
  const weaponPresetSelect = document.getElementById('weapon-preset-select') as HTMLSelectElement;
  weaponPresetSelect.addEventListener('change', () => {
    const presetId = weaponPresetSelect.value;
    if (presetId && callbacks) {
      const preset = WEAPON_PRESETS.find(p => p.id === presetId);
      if (preset) {
        currentRole = preset.role;
        updateLoadoutSelection();
        callbacks.onWeaponChange(preset.role, { preset: preset.id });
      }
    }
  });

  // Weapon file upload
  const weaponFileInput = document.getElementById('weapon-file-input') as HTMLInputElement;
  weaponFileInput.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file && callbacks) {
      const customData = await loadCustomWeapon(file);
      if (customData) {
        callbacks.onWeaponChange(currentRole, { custom: customData });
      }
    }
    weaponFileInput.value = '';
  });

  // Reset weapon
  document.getElementById('reset-weapon-btn')!.addEventListener('click', () => {
    callbacks?.onWeaponReset();
  });

  // Multiplayer
  document.getElementById('mp-new-btn')!.addEventListener('click', () => {
    const relayUrl = (document.getElementById('mp-relay') as HTMLInputElement).value;
    const name = (document.getElementById('mp-name') as HTMLInputElement).value || `OPERATOR-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
    const room = (document.getElementById('mp-room') as HTMLInputElement).value || generateRoomCode();
    const team = (document.getElementById('mp-team') as HTMLSelectElement).value as Team;
    callbacks?.onMultiplayerNew(relayUrl, name, room, team);
  });

  document.getElementById('mp-join-btn')!.addEventListener('click', () => {
    const relayUrl = (document.getElementById('mp-relay') as HTMLInputElement).value;
    const name = (document.getElementById('mp-name') as HTMLInputElement).value || `OPERATOR-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
    const room = (document.getElementById('mp-room') as HTMLInputElement).value;
    const team = (document.getElementById('mp-team') as HTMLSelectElement).value as Team;
    if (room) callbacks?.onMultiplayerJoin(relayUrl, name, room, team);
  });

  document.getElementById('mp-leave-btn')!.addEventListener('click', () => {
    callbacks?.onMultiplayerLeave();
  });

  document.getElementById('mp-copy-btn')!.addEventListener('click', () => {
    callbacks?.onMultiplayerCopy();
  });

  // Deploy button
  document.getElementById('deploy-btn')!.addEventListener('click', () => {
    callbacks?.onDeploy(currentRole);
  });
}

function populateLoadoutGrid(): void {
  const grid = document.getElementById('loadout-grid')!;
  const roles: Role[] = ['ASSAULT', 'SMG', 'LMG', 'SHOTGUN', 'SNIPER'];

  grid.innerHTML = roles.map(role => {
    const stats = WEAPON_STATS[role];
    return `
      <button type="button" data-role="${role}" class="loadout-btn group relative p-3 rounded-xl bg-slate-800/50 border border-slate-700 hover:border-sky-500/50 hover:bg-slate-700/50 transition-all text-left">
        <div class="text-xs font-extrabold tracking-wider text-slate-400 uppercase">${role}</div>
        <div class="mt-1 text-sm font-bold text-white group-hover:text-sky-300">${stats.name}</div>
        <div class="mt-2 grid grid-cols-4 gap-1 text-[10px] text-slate-500">
          <span>DMG ${stats.damage}</span>
          <span>RPM ${stats.rpm}</span>
          <span>MAG ${stats.mag}</span>
          <span>RNG ${stats.range}m</span>
        </div>
        <div class="absolute inset-0 border-2 border-transparent group-hover:border-sky-500/50 rounded-xl pointer-events-none"></div>
      </button>
    `;
  }).join('');

  updateLoadoutSelection();
}

function updateLoadoutSelection(): void {
  document.querySelectorAll('.loadout-btn').forEach(btn => {
    const role = btn.getAttribute('data-role');
    if (role === currentRole) {
      btn.classList.add('border-sky-500', 'bg-sky-500/10');
      btn.classList.remove('border-slate-700', 'bg-slate-800/50');
    } else {
      btn.classList.remove('border-sky-500', 'bg-sky-500/10');
      btn.classList.add('border-slate-700', 'bg-slate-800/50');
    }
  });
}

function populateWeaponPresets(): void {
  const select = document.getElementById('weapon-preset-select') as HTMLSelectElement;
  select.innerHTML = '<option value="">Select Preset...</option>' +
    WEAPON_PRESETS.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
}

function updateSliderValue(id: string, value: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = parseFloat(value).toFixed(2);
}

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export function showMenu(): void {
  document.getElementById('menu-overlay')!.classList.remove('hidden');
  document.getElementById('hud-layer')!.classList.add('hidden');
}

export function hideMenu(): void {
  document.getElementById('menu-overlay')!.classList.add('hidden');
  document.getElementById('hud-layer')!.classList.remove('hidden');
}

export function setMenuDeployText(text: string): void {
  (document.getElementById('deploy-btn') as HTMLButtonElement).textContent = text;
}

export function setLoadoutNote(text: string): void {
  (document.getElementById('loadout-note') as HTMLElement).textContent = text;
}

export function updateMultiplayerStatus(connected: boolean, roomCode?: string, peers?: any[]): void {
  const statusEl = document.getElementById('mp-status')!;
  const connectedEl = document.getElementById('mp-connected')!;
  const rosterEl = document.getElementById('mp-roster')!;

  if (connected) {
    statusEl.textContent = 'Connected';
    statusEl.className = 'text-[11px] font-semibold text-emerald-300';
    connectedEl.classList.remove('hidden');
    if (roomCode) {
      (document.getElementById('mp-room') as HTMLInputElement).value = roomCode;
    }
    if (peers) {
      rosterEl.innerHTML = peers.map(p => `<div class="flex items-center gap-2"><span class="w-2 h-2 rounded-full ${p.team === 'ALPHA' ? 'bg-blue-400' : 'bg-red-400'}"></span><span>${p.name}</span><span class="text-slate-500 ml-auto">${p.kills}/${p.deaths}</span></div>`).join('');
    }
  } else {
    statusEl.textContent = 'Offline';
    statusEl.className = 'text-[11px] font-semibold text-slate-400';
    connectedEl.classList.add('hidden');
    (document.getElementById('mp-room') as HTMLInputElement).value = '';
    rosterEl.innerHTML = '';
  }
}

export function getCurrentRole(): Role {
  return currentRole;
}

export function getCurrentSettings(): GameSettings {
  return { ...currentSettings };
}