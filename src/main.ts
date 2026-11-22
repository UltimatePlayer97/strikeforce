import './styles/main.css';

import { initControls } from './input/controls';
import { startLoop } from './game/loop';
import { createRoster } from './game/soldiers';
import { loadMap } from './world/mapLoader';
import { initNetUI } from './ui/lobby';
import { initMenu, renderLoadout, restoreSavedLoadout } from './ui/menu';
import { updateWeaponHUD } from './ui/hud';
import { BASE_PRESET_ID, initWeaponArmoryUI, loadWeaponPreset } from './weapons/models';
import { initAdsReticle, rebuildAllSoldierWeapons } from './weapons/viewmodel';
import { randomMapId } from './world/mapLoader';
import { initNavigation } from './world/nav/navRuntime';
import { initNavDebug } from './world/nav/navDebug';

async function bootstrap(): Promise<void> {
  // Recast WASM must be ready before any map (navmesh) loads.
  await initNavigation();
  restoreSavedLoadout();

  // Pick one random legal map for this session; full-match resets alternate-random.
  loadMap(randomMapId());

  createRoster();

  initWeaponArmoryUI();
  initNetUI();
  initControls();
  initNavDebug();
  initMenu();
  initAdsReticle();

  // Initialize loadout UI + default weapons on viewmodel and soldiers
  renderLoadout();
  rebuildAllSoldierWeapons();
  updateWeaponHUD();
  void loadWeaponPreset(BASE_PRESET_ID); // base model = premade M4A1 w/ H1 sight

  startLoop();
}

void bootstrap();
