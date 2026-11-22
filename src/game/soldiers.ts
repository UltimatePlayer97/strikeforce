import * as THREE from 'three';
import { scene } from '../core/renderer';
import { createSoldierRig } from '../rig/soldierRig';
import { rifleCarryWorldQuat } from '../rig/stance';
import { loadSoldierGLB } from '../rig/soldierTemplate';
import type { SoldierRig, Soldier, Team, WeaponId } from '../types';
import { pickBotLoadout } from '../weapons/defs';
import { createWeaponInstance } from '../weapons/models';
import { equipWeapon } from '../weapons/viewmodel';
import { activeSpawns } from './spawns';
import { allSoldiers, game, loadout } from './state';

export function attachWeaponToSoldierRig(rig: SoldierRig, weaponId: WeaponId = 'assault'): THREE.Group {
  const weaponHolder = new THREE.Group();
  const rifle = createWeaponInstance(weaponId);
  rifle.scale.setScalar(1.08);
  weaponHolder.add(rifle);

  const rHand = rig.bones.mixamorigRightHand;
  if (rHand) {
    // Account for Mixamo 0.01 armature scale if GLB is loaded
    if (rig.isGLB) {
      weaponHolder.scale.setScalar(95);
      // Seat the grip inside the fist and point the muzzle down the model's forward axis
      weaponHolder.position.set(0, 6, 2);
      rig.root.updateMatrixWorld(true);
      const handWorld = rHand.getWorldQuaternion(new THREE.Quaternion());
      weaponHolder.quaternion.copy(
        handWorld.invert().multiply(rifleCarryWorldQuat(rig, new THREE.Quaternion())),
      );
    } else {
      weaponHolder.position.set(0, -0.05, 0.16);
    }
    rHand.add(weaponHolder);
  } else {
    weaponHolder.position.set(0.22, 1.15, 0.25);
    rig.root.add(weaponHolder);
  }
  return weaponHolder;
}

export function createOperator(
  id: number,
  name: string,
  team: Team,
  isPlayer: boolean,
  spawnIdx: number,
): Soldier {
  const spawn = activeSpawns(team)[spawnIdx % 6].clone();
  const rig = createSoldierRig(team);
  rig.root.position.copy(spawn);
  rig.root.visible = !isPlayer; // Hidden while player is alive in 1st-person; shown on ragdoll death!
  scene.add(rig.root);

  const weaponHolder = attachWeaponToSoldierRig(rig);

  return {
    id,
    name,
    defName: name,
    team,
    isPlayer,
    spawnIdx,
    pos: spawn.clone(),
    vel: new THREE.Vector3(),
    yaw: team === 'ALPHA' ? 0 : Math.PI,
    pitch: 0,
    hp: 100,
    maxHp: 100,
    spawnProtection: 3.0,
    alive: true,
    respawnTimer: 0,
    kills: 0,
    deaths: 0,
    onGround: true,

    // Rig & articulated ragdoll state
    rig,
    weaponHolder,
    ragdoll: null,
    killerName: '',

    // Weapon state
    weaponId: 'assault',
    reloadTotal: 1.75,
    magAmmo: 30,
    reserveAmmo: 180,
    fireCooldown: 0,
    reloading: false,
    reloadTimer: 0,

    // AI tactical depth: coordinated push, flank split, group rally, or corner hold.
    aiState: 'ADVANCE',
    aiRole: null,
    aiRoleTime: 0,
    aiObjective: null,
    aiCampTarget: null,
    path: [],
    pathTimer: Math.random() * 0.6,
    targetEnemy: null,
    burstCooldown: Math.random() * 0.8,
    strafeDir: Math.random() < 0.5 ? -1 : 1,
    strafeTimer: 1.5 + Math.random() * 2.0,
    lastZoneName: 'ALPHA BASE',

    // AI aim model state
    aimTargetId: -1,
    lockTime: 0,
    reactTimer: 0,
    burstShots: 0,
    burstLen: 4,
    aimHeight: 1.05,

    // Stance / gait state (crouch blend 0..1 drives the procedural crouch pose)
    crouch: 0,
    stanceTarget: 0,
    stanceTimer: 0,
    sprinting: false,

    // Grenade & smoke carry: one each per spawn.
    // AI smoke usage is deliberately rare, even for retreats.
    grenadeCharges: 1,
    smokeCharges: 1,
    grenadeCooldown: 0,
    smokeCooldown: 0,
    aiSmokeEscapePlanned: Math.random() < 0.08,
    aiGrenadeTimer: 1.5 + Math.random() * 2.0,

    // Footstep cadence for spatial audio
    footstepTimer: 0,
  };
}

/** 12-operator 6v6 roster: human ALPHA-LEAD + 5 ALPHA AI + 6 BRAVO AI. */
export function createRoster(): void {
  game.humanPlayer = createOperator(0, 'ALPHA-LEAD', 'ALPHA', true, 0);
  allSoldiers.push(game.humanPlayer);
  for (let i = 1; i < 6; i++) {
    allSoldiers.push(createOperator(i, `ALPHA-${i}`, 'ALPHA', false, i));
  }
  for (let i = 0; i < 6; i++) {
    allSoldiers.push(createOperator(6 + i, `BRAVO-${i + 1}`, 'BRAVO', false, i));
  }

  // Initial loadouts: player = saved class, bots = random mix
  equipWeapon(game.humanPlayer, loadout.selected);
  for (const bs of allSoldiers) if (!bs.isPlayer) equipWeapon(bs, pickBotLoadout());

  // Upgrade soldier meshes once Soldier.glb finishes loading asynchronously
  loadSoldierGLB(() => {
    for (const s of allSoldiers) {
      if (!s.alive) continue;
      scene.remove(s.rig.root);
      s.rig = createSoldierRig(s.team);
      s.rig.root.position.copy(s.pos);
      s.rig.root.rotation.y = s.yaw;
      s.rig.root.visible = !s.isPlayer;
      scene.add(s.rig.root);
      s.weaponHolder = attachWeaponToSoldierRig(s.rig, s.weaponId);
    }
  });
}
