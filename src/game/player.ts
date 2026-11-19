import * as THREE from 'three';
import type { Soldier, Role, Team, GameSettings, InputState } from '../types';
import { RAGDOLL_NODE } from '../types';
import { createWeaponInstance, fireWeapon, startReload, updateReload, canFire, applyWeaponOffset, createBaseWeaponModel } from '../weapons/weapon';
import { throwGrenade, throwSmoke } from '../weapons/projectile';
import { VerletRagdoll } from '../physics/ragdoll';
import { hasLineOfSight, getFloorHeightAt, resolveCylinderCollision } from '../physics/collision';
import { getScene, getCamera } from '../renderer';
import { sfx } from '../audio/sound';
import { setHumanPlayerRef } from '../audio/sound';

export class HumanPlayer {
  static instance: HumanPlayer | null = null;

  public soldier: Soldier;
  public weaponModel: THREE.Group | null = null;
  public weaponPivot: THREE.Group;
  public cameraPivot: THREE.Group;
  public adsProgress = 0;
  public spawnProtectionTime = 0;
  public lastFootstepTime = 0;
  public lastFootstepPos = new THREE.Vector3();

  private input: InputState;
  private settings: GameSettings;
  private yaw = 0;
  private pitch = 0;
  private vel = new THREE.Vector3();
  private isGrounded = false;
  private jumpCooldown = 0;
  private stanceHeight = 1.7;
  private crouchHeight = 0.9;
  private proneHeight = 0.4;
  private currentHeight = 1.7;
  private targetHeight = 1.7;

  constructor(role: Role, team: Team, spawnPos: THREE.Vector3, spawnYaw: number, settings: GameSettings) {
    this.settings = settings;
    this.input = {
      forward: false, backward: false, left: false, right: false,
      sprint: false, jump: false, crouch: false,
      fire: false, ads: false, reload: false,
      grenade: false, smoke: false, melee: false, interact: false,
      scoreboard: false, pause: false,
      mouseDeltaX: 0, mouseDeltaY: 0
    };

    this.soldier = {
      id: 0,
      team,
      role,
      name: 'ALPHA-LEAD',
      isHuman: true,
      isAlive: true,
      pos: spawnPos.clone(),
      vel: new THREE.Vector3(),
      yaw: spawnYaw,
      pitch: 0,
      hp: 100,
      maxHp: 100,
      armor: 0,
      weapon: createWeaponInstance(role),
      grenades: 2,
      smokes: 2,
      state: 'HUNTING',
      stance: 'stand',
      isSprinting: false,
      isADS: false,
      ragdoll: null,
      deathTime: 0,
      killerId: null,
      path: [],
      pathIndex: 0,
      targetNode: -1,
      lastSeenEnemy: null,
      engagementRange: 55,
      reactionTimer: 0,
      shootCooldown: 0,
      reloadTimer: 0,
      networkId: null,
      lastUpdate: performance.now(),
      kills: 0,
      deaths: 0
    };

    this.cameraPivot = new THREE.Group();
    this.cameraPivot.position.copy(this.soldier.pos);
    this.cameraPivot.position.y += this.currentHeight;
    getScene().add(this.cameraPivot);

    // Sync camera to cameraPivot initially
    const camera = getCamera();
    camera.position.copy(this.cameraPivot.position);
    camera.rotation.copy(this.cameraPivot.rotation);
    camera.updateMatrixWorld();

    this.weaponPivot = new THREE.Group();
    this.cameraPivot.add(this.weaponPivot);

    this.createWeaponModel();
    HumanPlayer.instance = this;
    setHumanPlayerRef(this);
  }

  private createWeaponModel(): void {
    if (this.weaponModel) {
      this.weaponPivot.remove(this.weaponModel);
    }

    if (this.soldier.weapon.customModel) {
      this.weaponModel = this.soldier.weapon.customModel.clone();
      this.weaponModel.rotation.y = Math.PI;
    } else {
      this.weaponModel = createBaseWeaponModel(this.soldier.role);
    }

    applyWeaponOffset(this.soldier.role, this.weaponModel);
    this.weaponPivot.add(this.weaponModel);
  }

  setInput(input: InputState): void {
    this.input = input;
  }

  update(dt: number, allSoldiers: Soldier[], currentTime: number): void {
    if (!this.soldier.isAlive) return;

    this.updateStance(dt);
    this.updateMovement(dt);
    this.updateCamera(dt);
    this.updateWeapon(dt, allSoldiers, currentTime);
    this.updateFootsteps(dt);
    this.spawnProtectionTime = Math.max(0, this.spawnProtectionTime - dt);
  }

  private updateStance(dt: number): void {
    if (this.input.crouch) {
      this.soldier.stance = this.soldier.stance === 'prone' ? 'crouch' : 'prone';
      this.input.crouch = false; // Toggle
    }

    this.targetHeight = this.soldier.stance === 'stand' ? this.stanceHeight :
                        this.soldier.stance === 'crouch' ? this.crouchHeight : this.proneHeight;

    this.currentHeight = THREE.MathUtils.lerp(this.currentHeight, this.targetHeight, dt * 10);
    this.cameraPivot.position.y = this.soldier.pos.y + this.currentHeight;
  }

  private updateMovement(dt: number): void {
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    let moveX = 0, moveZ = 0;
    if (this.input.forward) moveZ -= 1;
    if (this.input.backward) moveZ += 1;
    if (this.input.left) moveX -= 1;
    if (this.input.right) moveX += 1;

    const moveLen = Math.hypot(moveX, moveZ);
    if (moveLen > 0) {
      moveX /= moveLen;
      moveZ /= moveLen;
    }

    this.soldier.isSprinting = this.input.sprint && moveLen > 0 && this.soldier.stance === 'stand';

    let speed = this.soldier.stance === 'prone' ? 1.2 :
                this.soldier.stance === 'crouch' ? 3.2 :
                this.soldier.isSprinting ? 7.5 : 5.2;

    this.vel.x = (forward.x * moveZ + right.x * moveX) * speed;
    this.vel.z = (forward.z * moveZ + right.z * moveX) * speed;

    if (this.input.jump && this.isGrounded && this.jumpCooldown <= 0 && this.soldier.stance !== 'prone') {
      this.vel.y = 6.8;
      this.isGrounded = false;
      this.jumpCooldown = 0.3;
    }
    this.jumpCooldown = Math.max(0, this.jumpCooldown - dt);

    this.vel.y -= 22 * dt;
    this.soldier.pos.addScaledVector(this.vel, dt);

    const floorY = getFloorHeightAt(this.soldier.pos.x, this.soldier.pos.z);
    if (this.soldier.pos.y <= floorY + this.currentHeight * 0.5) {
      this.soldier.pos.y = floorY + this.currentHeight * 0.5;
      this.vel.y = 0;
      this.isGrounded = true;
    } else {
      this.isGrounded = false;
    }

    resolveCylinderCollision(this.soldier.pos, 0.35, this.currentHeight);

    this.soldier.vel.copy(this.vel);
    this.soldier.pos.y = this.soldier.pos.y; // Sync
  }

  private updateCamera(dt: number): void {
    const { x, y } = this.consumeMouseDelta();
    this.yaw -= x;
    this.pitch = THREE.MathUtils.clamp(this.pitch - y, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);

    this.soldier.yaw = this.yaw;
    this.soldier.pitch = this.pitch;

    this.cameraPivot.rotation.set(this.pitch, this.yaw, 0);
    this.cameraPivot.position.x = this.soldier.pos.x;
    this.cameraPivot.position.z = this.soldier.pos.z;

    // Camera bob
    if (this.settings.cameraBob && this.isGrounded && (this.input.forward || this.input.backward || this.input.left || this.input.right)) {
      const bobSpeed = this.soldier.isSprinting ? 14 : 9;
      const bobAmount = this.soldier.isSprinting ? 0.06 : 0.035;
      const t = performance.now() / 1000 * bobSpeed;
      this.cameraPivot.position.y += Math.sin(t) * bobAmount;
      this.weaponPivot.rotation.z = Math.sin(t * 0.5) * 0.02;
    } else {
      this.weaponPivot.rotation.z = THREE.MathUtils.lerp(this.weaponPivot.rotation.z, 0, dt * 8);
    }

    // Sync actual camera to cameraPivot
    const camera = getCamera();
    camera.position.copy(this.cameraPivot.position);
    camera.rotation.copy(this.cameraPivot.rotation);
    camera.updateMatrixWorld();

    // ADS transition
    const targetAds = this.input.ads && this.soldier.weapon.stats.adsZoom < 1 ? 1 : 0;
    this.adsProgress = THREE.MathUtils.lerp(this.adsProgress, targetAds, dt * (1 / (this.soldier.weapon.stats.adsTime / 1000)) * 2);
    this.soldier.isADS = this.adsProgress > 0.5;
  }

  private consumeMouseDelta(): { x: number; y: number } {
    const dx = this.input.mouseDeltaX;
    const dy = this.input.mouseDeltaY;
    this.input.mouseDeltaX = 0;
    this.input.mouseDeltaY = 0;
    return { x: dx, y: dy };
  }

  private getCameraDirection(): THREE.Vector3 {
    // Compute forward direction from cameraPivot's quaternion (camera.getWorldDirection is broken)
    const dir = new THREE.Vector3(0, 0, -1);
    dir.applyQuaternion(this.cameraPivot.quaternion);
    return dir;
  }

  private updateWeapon(dt: number, allSoldiers: Soldier[], currentTime: number): void {
    updateReload(this.soldier.weapon, currentTime);

    if (this.input.reload && !this.soldier.weapon.isReloading) {
      startReload(this.soldier.weapon, currentTime);
    }

    if (this.input.fire && canFire(this.soldier.weapon, currentTime)) {
      const spread = this.soldier.isADS ? this.soldier.weapon.stats.adsSpread : this.soldier.weapon.stats.spread;
      const recoil = this.soldier.isADS ? this.soldier.weapon.stats.adsRecoil : this.soldier.weapon.stats.recoil;

      const origin = this.cameraPivot.getWorldPosition(new THREE.Vector3());
      const dir = this.getCameraDirection();

      const results = fireWeapon(this.soldier.weapon, this.soldier, origin, dir, spread, currentTime, true);

      for (const hit of results) {
        if (hit.hit && hit.target) {
          const isHeadshot = hit.headshot;
          const dmg = Math.floor(this.soldier.weapon.stats.damage * (isHeadshot ? this.soldier.weapon.stats.headshotMult : 1));
          this.applyDamage(hit.target, dmg, hit.position, isHeadshot);
          sfx.playHitmarker(isHeadshot);
        }
      }

      // Recoil
      this.pitch -= THREE.MathUtils.degToRad(recoil * 0.5);
      this.yaw += THREE.MathUtils.degToRad((Math.random() - 0.5) * recoil * 0.3);
    }

    if (this.input.grenade) {
      const origin = this.cameraPivot.getWorldPosition(new THREE.Vector3());
      const dir = this.getCameraDirection();
      throwGrenade(this.soldier, origin, dir);
      this.input.grenade = false;
    }

    if (this.input.smoke) {
      const origin = this.cameraPivot.getWorldPosition(new THREE.Vector3());
      const dir = this.getCameraDirection();
      throwSmoke(this.soldier, origin, dir);
      this.input.smoke = false;
    }
  }

  private updateFootsteps(dt: number): void {
    if (!this.isGrounded) return;
    const speed = this.vel.length();
    if (speed < 0.5) return;

    const now = performance.now() / 1000;
    const interval = this.soldier.isSprinting ? 0.3 : this.soldier.stance === 'crouch' ? 0.6 : 0.45;
    if (now - this.lastFootstepTime > interval) {
      sfx.playFootstep(this.soldier.pos, this.soldier.isSprinting ? 1.3 : 1);
      this.lastFootstepTime = now;
      this.lastFootstepPos.copy(this.soldier.pos);
    }
  }

  private applyDamage(target: Soldier, damage: number, hitPos: THREE.Vector3, isHeadshot: boolean): void {
    target.hp = Math.max(0, target.hp - damage);
    if (target.hp <= 0 && target.isAlive) {
      this.killTarget(target, hitPos, isHeadshot);
    }
  }

  private killTarget(target: Soldier, hitPos: THREE.Vector3, isHeadshot: boolean): void {
    target.isAlive = false;
    target.deathTime = performance.now() / 1000;
    target.killerId = this.soldier.id;
    this.soldier.kills++;
    target.deaths++;

    const impulseDir = target.pos.clone().sub(hitPos).normalize();
    impulseDir.y = 0.3;
    target.ragdoll = new VerletRagdoll(
      target.pos.clone(),
      target.yaw,
      target.vel.clone(),
      hitPos,
      impulseDir.multiplyScalar(8)
    );
  }

  takeDamage(amount: number, fromPos: THREE.Vector3): void {
    if (this.spawnProtectionTime > 0) return;
    this.soldier.hp = Math.max(0, this.soldier.hp - amount);
    sfx.playDamageTaken();

    if (this.soldier.hp <= 0 && this.soldier.isAlive) {
      this.die(fromPos);
    }
  }

  die(killerPos: THREE.Vector3): void {
    this.soldier.isAlive = false;
    this.soldier.deathTime = performance.now() / 1000;

    const impulseDir = this.soldier.pos.clone().sub(killerPos).normalize();
    impulseDir.y = 0.3;
    this.soldier.ragdoll = new VerletRagdoll(
      this.soldier.pos.clone(),
      this.soldier.yaw,
      this.soldier.vel.clone(),
      killerPos,
      impulseDir.multiplyScalar(10)
    );
  }

  respawn(spawnPos: THREE.Vector3, spawnYaw: number): void {
    this.soldier.isAlive = true;
    this.soldier.hp = this.soldier.maxHp;
    this.soldier.pos.copy(spawnPos);
    this.vel.set(0, 0, 0);
    this.yaw = spawnYaw;
    this.pitch = 0;
    this.soldier.yaw = spawnYaw;
    this.soldier.pitch = 0;
    this.soldier.weapon.ammo = this.soldier.weapon.stats.mag;
    this.soldier.weapon.reserve = this.soldier.weapon.stats.reserve;
    this.soldier.weapon.isReloading = false;
    this.soldier.grenades = 2;
    this.soldier.smokes = 2;
    this.soldier.stance = 'stand';
    this.currentHeight = this.stanceHeight;
    this.targetHeight = this.stanceHeight;
    this.cameraPivot.position.copy(spawnPos);
    this.cameraPivot.position.y += this.currentHeight;
    this.spawnProtectionTime = 3.0;
    this.soldier.ragdoll = null;
  }

  changeWeapon(role: Role): void {
    this.soldier.role = role;
    this.soldier.weapon = createWeaponInstance(role);
    this.createWeaponModel();
  }

  applyCustomWeapon(customData: any): void {
    if (customData.custom) {
      this.soldier.weapon.customModel = customData.custom.model.clone();
    } else if (customData.preset) {
      this.soldier.weapon.customModel = null;
    }
    this.createWeaponModel();
  }

  resetWeapon(): void {
    this.soldier.weapon.customModel = null;
    this.createWeaponModel();
  }

  getCamera(): THREE.Camera {
    return getCamera();
  }

  getCameraPivot(): THREE.Group {
    return this.cameraPivot;
  }

  getSoldier(): Soldier {
    return this.soldier;
  }

  dispose(): void {
    getScene().remove(this.cameraPivot);
    HumanPlayer.instance = null;
  }
}