import { clearAllCorpses, retireCorpse } from '../combat/effects';
import { clearThrowableVisuals } from '../combat/throwables';
import { scene } from '../core/renderer';
import { net } from '../net/net';
import { createSoldierRig } from '../rig/soldierRig';
import type { Soldier } from '../types';
import { showHudToast, showSpawnProtectionStatus } from '../ui/feedback';
import { updateThrowableHUD, updateWeaponHUD } from '../ui/hud';
import { $ } from '../util/dom';
import { pickBotLoadout, weaponOf } from '../weapons/defs';
import { fpWeaponRoot, rebuildPlayerViewmodel } from '../weapons/viewmodel';
import { loadMap, randomMapId } from '../world/mapLoader';
import { MAP_DEFINITIONS } from '../world/def/maps';
import { attachWeaponToSoldierRig } from './soldiers';
import { activeSpawns } from './spawns';
import { allSoldiers, game, loadout, matchState } from './state';

export function respawnSoldier(soldier: Soldier, isFullReset = false): void {
  const spawns = activeSpawns(soldier.team);
  const spawn = spawns[soldier.spawnIdx % spawns.length].clone();

  const retiredAsCorpse = isFullReset ? false : retireCorpse(soldier);
  soldier.pos.copy(spawn);
  soldier.vel.set(0, 0, 0);
  soldier.yaw = soldier.team === 'ALPHA' ? 0 : Math.PI;
  soldier.pitch = 0;
  soldier.hp = 100;
  soldier.regenWait = 0;
  soldier.spawnProtection = 3.0;
  soldier.crouch = 0;
  soldier.stanceTarget = 0;
  soldier.sprinting = false;
  soldier.grenadeCharges = 1;
  soldier.smokeCharges = 1;
  soldier.grenadeCooldown = 0;
  soldier.smokeCooldown = 0;
  soldier.aiSmokeEscapePlanned = Math.random() < 0.08;
  soldier.aiGrenadeTimer = 1.2 + Math.random() * 2.0;
  soldier.aiRole = null;
  soldier.aiRoleTime = 0;
  soldier.aiObjective = null;
  soldier.aiCampTarget = null;
  soldier.footstepTimer = 0;
  soldier.alive = true;
  soldier.respawnTimer = 0;
  soldier.ragdoll = null;
  if (soldier.isPlayer) showSpawnProtectionStatus(soldier.spawnProtection);
  if (soldier.isPlayer) soldier.weaponId = loadout.selected;
  else if (!net.active || net.owns(soldier)) soldier.weaponId = pickBotLoadout();
  {
    const rw = weaponOf(soldier);
    soldier.magAmmo = rw.mag;
    soldier.reserveAmmo = rw.reserve;
    soldier.reloadTotal = rw.reload;
    soldier.fireCooldown = 0;
    soldier.burstLen = rw.botBurst[0];
  }
  soldier.reloading = false;
  soldier.reloadTimer = 0;
  soldier.path = [];
  soldier.targetEnemy = null;
  soldier.aimTargetId = -1;
  soldier.lockTime = 0;
  soldier.reactTimer = 0;
  soldier.burstShots = 0;
  if (soldier._net) soldier._net.init = false;
  if (net.active && !isFullReset && net.owns(soldier)) net.send({ t: 'r', id: soldier.id });

  // Rebuild clean rig pose (old ragdoll rig stays in world as corpse)
  if (!retiredAsCorpse) scene.remove(soldier.rig.root);
  soldier.rig = createSoldierRig(soldier.team);
  soldier.rig.root.position.copy(soldier.pos);
  soldier.rig.root.rotation.y = soldier.yaw;
  soldier.rig.root.visible = !soldier.isPlayer;
  scene.add(soldier.rig.root);
  soldier.weaponHolder = attachWeaponToSoldierRig(soldier.rig, soldier.weaponId);
  if (soldier.isPlayer) updateThrowableHUD();

  if (soldier.isPlayer) {
    rebuildPlayerViewmodel();
    fpWeaponRoot.visible = true;
    $('crosshair-container').classList.remove('hidden');
    $('death-cam-overlay').classList.add('hidden');
    updateWeaponHUD();
  }
}

export function resetFullMatch(preferredMapId: string | null = null): void {
  const nextMap = preferredMapId || randomMapId(game.currentMapId);
  if (nextMap !== game.currentMapId) loadMap(nextMap);

  matchState.alphaScore = 0;
  matchState.bravoScore = 0;
  matchState.timeRemaining = 600;
  matchState.roundOver = false;
  clearAllCorpses();
  clearThrowableVisuals();
  for (const s of allSoldiers) {
    s.kills = 0;
    s.deaths = 0;
    respawnSoldier(s, true);
  }
  const mapName = MAP_DEFINITIONS[game.currentMapId ?? 'compound']?.label || 'STRIKEFORCE';
  showHudToast(`NEW MATCH — ${mapName}`, 2500);
}
