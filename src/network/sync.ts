import type { NetworkMessage, PlayerState, GameSnapshot, Soldier, Team, Role } from '../types';
import { WebRTCManager } from './webrtc';
import * as THREE from 'three';

export interface SyncedEntity {
  id: string;
  type: 'player' | 'bot' | 'projectile' | 'smoke' | 'debris';
  data: any;
  timestamp: number;
}

export class NetworkSync {
  private manager: WebRTCManager;
  localPlayer: Soldier | null = null;
  remotePlayers: Map<string, Soldier> = new Map();
  pendingSnapshots: GameSnapshot[] = [];
  lastSnapshotTime = 0;
  snapshotInterval = 50; // 20Hz
  interpolationDelay = 100; // ms

  constructor(manager: WebRTCManager) {
    this.manager = manager;
    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.manager.onMessage((msg) => this.handleMessage(msg));
    this.manager.onPlayerJoin((player) => this.handlePlayerJoin(player));
    this.manager.onPlayerLeave((id) => this.handlePlayerLeave(id));
    this.manager.onSnapshot((snapshot) => this.handleSnapshot(snapshot));
  }

  private handleMessage(msg: NetworkMessage): void {
    switch (msg.type) {
      case 'state-update':
        this.applyStateUpdate(msg.data as PlayerState);
        break;
      case 'fire':
        this.handleRemoteFire(msg.data);
        break;
      case 'reload':
        this.handleRemoteReload(msg.data);
        break;
      case 'throw':
        this.handleRemoteThrow(msg.data);
        break;
      case 'damage':
        this.handleRemoteDamage(msg.data);
        break;
      case 'death':
        this.handleRemoteDeath(msg.data);
        break;
      case 'respawn':
        this.handleRemoteRespawn(msg.data);
        break;
    }
  }

  private handlePlayerJoin(player: PlayerState): void {
    // Create remote soldier representation
    console.log('Player joined:', player.name, player.team);
  }

  private handlePlayerLeave(playerId: string): void {
    this.remotePlayers.delete(playerId);
    console.log('Player left:', playerId);
  }

  private handleSnapshot(snapshot: GameSnapshot): void {
    this.pendingSnapshots.push(snapshot);
    // Keep only recent snapshots for interpolation
    const cutoff = Date.now() - this.interpolationDelay - 500;
    while (this.pendingSnapshots.length > 0 && this.pendingSnapshots[0].timestamp < cutoff) {
      this.pendingSnapshots.shift();
    }
  }

  private applyStateUpdate(state: PlayerState): void {
    let remote = this.remotePlayers.get(state.id);
    if (!remote) {
      // Create new remote player
      remote = this.createRemoteSoldier(state);
      this.remotePlayers.set(state.id, remote);
    }

    // Interpolate position
    remote.pos.lerp(new THREE.Vector3(state.pos.x, state.pos.y, state.pos.z), 0.3);
    remote.yaw = THREE.MathUtils.lerp(remote.yaw, state.yaw, 0.3);
    remote.pitch = THREE.MathUtils.lerp(remote.pitch, state.pitch, 0.3);
    remote.hp = state.hp;
    remote.isAlive = state.isAlive;
    remote.weapon.ammo = state.ammo;
    remote.kills = state.kills;
    remote.deaths = state.deaths;
  }

  private createRemoteSoldier(state: PlayerState): Soldier {
    return {
      id: parseInt(state.id.split('_')[1] || '0', 10),
      team: state.team,
      role: state.role,
      name: state.name,
      isHuman: true,
      isAlive: state.isAlive,
      pos: new THREE.Vector3(state.pos.x, state.pos.y, state.pos.z),
      vel: new THREE.Vector3(),
      yaw: state.yaw,
      pitch: state.pitch,
      hp: state.hp,
      maxHp: 100,
      armor: 0,
      weapon: {
        stats: { name: state.weapon, kind: state.role } as any,
        ammo: state.ammo,
        reserve: 0,
        isReloading: false,
        reloadEndTime: 0,
        lastFireTime: 0,
        fireMode: 'auto',
        burstCount: 0,
        customModel: null
      },
      grenades: 0,
      smokes: 0,
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
      engagementRange: 50,
      reactionTimer: 0,
      shootCooldown: 0,
      reloadTimer: 0,
      networkId: state.id,
      lastUpdate: Date.now(),
      kills: state.kills,
      deaths: state.deaths
    };
  }

  private handleRemoteFire(data: any): void {
    // Handle remote player firing
  }

  private handleRemoteReload(data: any): void {
    // Handle remote player reloading
  }

  private handleRemoteThrow(data: any): void {
    // Handle remote player throwing grenade/smoke
  }

  private handleRemoteDamage(data: any): void {
    // Handle remote player taking damage
  }

  private handleRemoteDeath(data: any): void {
    // Handle remote player death
  }

  private handleRemoteRespawn(data: any): void {
    // Handle remote player respawn
  }

  sendStateUpdate(player: Soldier): void {
    const now = Date.now();
    if (now - this.lastSnapshotTime < this.snapshotInterval) return;
    this.lastSnapshotTime = now;

    const state: PlayerState = {
      id: player.networkId || this.manager.getLocalPlayerId(),
      name: player.name,
      team: player.team,
      role: player.role,
      pos: { x: player.pos.x, y: player.pos.y, z: player.pos.z },
      yaw: player.yaw,
      pitch: player.pitch,
      hp: player.hp,
      isAlive: player.isAlive,
      weapon: player.weapon.stats.name,
      ammo: player.weapon.ammo,
      kills: player.kills,
      deaths: player.deaths
    };

    this.manager.broadcast({
      type: 'state-update',
      senderId: this.manager.getLocalPlayerId(),
      timestamp: now,
      data: state
    });
  }

  sendFire(origin: THREE.Vector3, direction: THREE.Vector3, weapon: string): void {
    this.manager.broadcast({
      type: 'fire',
      senderId: this.manager.getLocalPlayerId(),
      timestamp: Date.now(),
      data: { origin, direction, weapon }
    });
  }

  sendReload(): void {
    this.manager.broadcast({
      type: 'reload',
      senderId: this.manager.getLocalPlayerId(),
      timestamp: Date.now(),
      data: {}
    });
  }

  sendThrow(type: 'grenade' | 'smoke', origin: THREE.Vector3, direction: THREE.Vector3): void {
    this.manager.broadcast({
      type: 'throw',
      senderId: this.manager.getLocalPlayerId(),
      timestamp: Date.now(),
      data: { type, origin, direction }
    });
  }

  sendDamage(targetId: string, damage: number, hitPos: THREE.Vector3): void {
    this.manager.broadcast({
      type: 'damage',
      senderId: this.manager.getLocalPlayerId(),
      timestamp: Date.now(),
      data: { targetId, damage, hitPos }
    });
  }

  sendDeath(killerId: string, victimId: string): void {
    this.manager.broadcast({
      type: 'death',
      senderId: this.manager.getLocalPlayerId(),
      timestamp: Date.now(),
      data: { killerId, victimId }
    });
  }

  sendRespawn(spawnPos: THREE.Vector3, spawnYaw: number): void {
    this.manager.broadcast({
      type: 'respawn',
      senderId: this.manager.getLocalPlayerId(),
      timestamp: Date.now(),
      data: { spawnPos, spawnYaw }
    });
  }

  interpolateRemotePlayers(currentTime: number): void {
    const targetTime = currentTime - this.interpolationDelay;
    const snapshots = this.pendingSnapshots;

    if (snapshots.length < 2) return;

    let before: GameSnapshot | null = null;
    let after: GameSnapshot | null = null;

    for (let i = 0; i < snapshots.length - 1; i++) {
      if (snapshots[i].timestamp <= targetTime && snapshots[i + 1].timestamp >= targetTime) {
        before = snapshots[i];
        after = snapshots[i + 1];
        break;
      }
    }

    if (!before || !after) return;

    const t = (targetTime - before.timestamp) / (after.timestamp - before.timestamp);

    for (const [id, state] of after.players) {
      const beforeState = before.players.get(id);
      if (!beforeState) continue;

      const remote = this.remotePlayers.get(id);
      if (!remote) continue;

      const interpPos = new THREE.Vector3().lerpVectors(
        new THREE.Vector3(beforeState.pos.x, beforeState.pos.y, beforeState.pos.z),
        new THREE.Vector3(state.pos.x, state.pos.y, state.pos.z),
        t
      );
      remote.pos.copy(interpPos);
      remote.yaw = THREE.MathUtils.lerp(beforeState.yaw, state.yaw, t);
      remote.pitch = THREE.MathUtils.lerp(beforeState.pitch, state.pitch, t);
    }
  }

  getRemotePlayers(): Map<string, Soldier> {
    return this.remotePlayers;
  }
}