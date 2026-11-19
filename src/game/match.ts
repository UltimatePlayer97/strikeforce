import type { Soldier, Team, MapId, MapDef, GameState, Role } from '../types';
import { MAP_DEFS } from '../world/map';
import { loadMap, getCurrentMapId } from '../world/map';
import { createNavGraph } from '../world/navgraph';
import { HumanPlayer } from './player';
import { createBot, updateBot, respawnBot, onBotDeath } from '../ai/bot';
import { updateTeamPlans, getTeamPlan, getZoneName } from '../ai/team';
import { updateProjectiles, updateSmokes, updateDebris, clearProjectiles, clearSmokes, clearDebris, getActiveProjectiles, getActiveSmokes } from '../weapons/projectile';
import { getScene } from '../renderer';
import { VerletRagdoll } from '../physics/ragdoll';
import { hasLineOfSight } from '../physics/collision';
import * as THREE from 'three';

export interface MatchConfig {
  maxScore: number;
  roundTime: number;
  mapRotation: boolean;
}

export class MatchManager {
  private config: MatchConfig;
  private state: GameState = 'MENU';
  private alphaScore = 0;
  private bravoScore = 0;
  private matchTime = 0;
  private roundStartTime = 0;
  private currentMapId: MapId = 'compound';
  private currentMapDef: MapDef;
  private navGraph: any;
  private soldiers: Soldier[] = [];
  private humanPlayer: HumanPlayer | null = null;
  private botIdCounter = 1;
  private lastTime = 0;
  private isRunning = false;

  // Callbacks
  onStateChange?: (state: GameState) => void;
  onScoreChange?: (alpha: number, bravo: number) => void;
  onMatchEnd?: (winner: Team) => void;
  onMapChange?: (mapId: MapId) => void;
  onPlayerDeath?: (victim: Soldier, killer: Soldier) => void;
  onPlayerRespawn?: (player: Soldier) => void;

  constructor(config: MatchConfig = { maxScore: 30, roundTime: 600, mapRotation: true }) {
    this.config = config;
    this.currentMapDef = MAP_DEFS[this.currentMapId];
  }

  async start(role: Role, settings: any): Promise<void> {
    this.state = 'DEPLOYING';
    this.onStateChange?.(this.state);

    const { id, def } = loadMap(this.currentMapId);
    this.currentMapId = id as MapId;
    this.currentMapDef = def;
    this.navGraph = createNavGraph(def);

    this.spawnAllSoldiers(role, settings);

    this.state = 'PLAYING';
    this.onStateChange?.(this.state);
    this.roundStartTime = performance.now() / 1000;
    this.matchTime = this.config.roundTime;
    this.isRunning = true;
  }

  private spawnAllSoldiers(humanRole: Role, settings: any): void {
    this.soldiers = [];
    this.botIdCounter = 1;

    const def = this.currentMapDef;
    const alphaSpawns = def.safe.ALPHA;
    const bravoSpawns = def.safe.BRAVO;

    // Human player
    const humanSpawnIdx = alphaSpawns[Math.floor(Math.random() * alphaSpawns.length)];
    const humanSpawnNode = def.rawNodes[humanSpawnIdx];
    const humanSpawnPos = new THREE.Vector3(humanSpawnNode[0], humanSpawnNode[1] + 1, humanSpawnNode[2]);
    const humanSpawnYaw = Math.PI; // Facing north

    this.humanPlayer = new HumanPlayer(humanRole, 'ALPHA', humanSpawnPos, humanSpawnYaw, settings);
    this.humanPlayer.soldier.id = 0;
    this.humanPlayer.soldier.name = 'ALPHA-LEAD';
    this.soldiers.push(this.humanPlayer.soldier);

    // AI Bots - 5 more Alpha, 6 Bravo
    const roles: Soldier['role'][] = ['ASSAULT', 'SMG', 'LMG', 'SHOTGUN', 'SNIPER'];
    const alphaNames = ['ALPHA-2', 'ALPHA-3', 'ALPHA-4', 'ALPHA-5', 'ALPHA-6'];
    const bravoNames = ['BRAVO-1', 'BRAVO-2', 'BRAVO-3', 'BRAVO-4', 'BRAVO-5', 'BRAVO-6'];

    // Alpha bots
    for (let i = 0; i < 5; i++) {
      const spawnIdx = alphaSpawns[(humanSpawnIdx + i + 1) % alphaSpawns.length];
      const spawnNode = def.rawNodes[spawnIdx];
      const spawnPos = new THREE.Vector3(spawnNode[0], spawnNode[1] + 1, spawnNode[2]);
      const spawnYaw = Math.PI + (Math.random() - 0.5) * 0.5;

      const role = roles[Math.floor(Math.random() * roles.length)];
      const bot = createBot(
        this.botIdCounter++,
        'ALPHA',
        role,
        alphaNames[i],
        spawnPos,
        spawnYaw,
        settings.aiSkill
      );
      this.soldiers.push(bot);
    }

    // Bravo bots
    for (let i = 0; i < 6; i++) {
      const spawnIdx = bravoSpawns[i % bravoSpawns.length];
      const spawnNode = def.rawNodes[spawnIdx];
      const spawnPos = new THREE.Vector3(spawnNode[0], spawnNode[1] + 1, spawnNode[2]);
      const spawnYaw = (Math.random() - 0.5) * 0.5;

      const role = roles[Math.floor(Math.random() * roles.length)];
      const bot = createBot(
        this.botIdCounter++,
        'BRAVO',
        role,
        bravoNames[i],
        spawnPos,
        spawnYaw,
        settings.aiSkill
      );
      this.soldiers.push(bot);
    }
  }

  update(deltaTime: number): void {
    if (!this.isRunning) return;

    const currentTime = performance.now() / 1000;
    this.matchTime = Math.max(0, this.config.roundTime - (currentTime - this.roundStartTime));

    // Update human player
    if (this.humanPlayer) {
      this.humanPlayer.update(deltaTime, this.soldiers, currentTime);
    }

    // Update bots
    for (const soldier of this.soldiers) {
      if (!soldier.isHuman && soldier.isAlive) {
        updateBot(soldier, deltaTime, this.soldiers, this.humanPlayer?.soldier || null, this.navGraph, currentTime);
      }
    }

    // Update projectiles, smokes, debris
    updateProjectiles(deltaTime, this.soldiers);
    updateSmokes(deltaTime);
    updateDebris(deltaTime);

    // Update ragdolls
    for (const soldier of this.soldiers) {
      if (soldier.ragdoll) {
        soldier.ragdoll.step(deltaTime);
        if (soldier.ragdoll.age > 15) {
          // Clean up old ragdolls
          soldier.ragdoll = null;
        }
      }
    }

    // Check deaths
    this.checkDeaths(currentTime);

    // Update team plans
    updateTeamPlans(
      this.soldiers.filter(s => s.team === 'ALPHA'),
      this.soldiers.filter(s => s.team === 'BRAVO'),
      this.navGraph,
      this.currentMapDef,
      currentTime
    );

    // Check win conditions
    this.checkWinCondition();

    // Handle respawns
    this.handleRespawns(currentTime);
  }

  private checkDeaths(currentTime: number): void {
    for (const soldier of this.soldiers) {
      if (!soldier.isAlive && soldier.deathTime > 0 && !soldier._deathProcessed) {
        soldier._deathProcessed = true;
        const killer = this.soldiers.find(s => s.id === soldier.killerId);
        if (killer) {
          this.onPlayerDeath?.(soldier, killer);
        }
      }
    }
  }

  private handleRespawns(currentTime: number): void {
    for (const soldier of this.soldiers) {
      if (!soldier.isAlive && soldier.deathTime > 0) {
        const respawnDelay = soldier.isHuman ? 5 : 3 + Math.random() * 4;
        if (currentTime - soldier.deathTime >= respawnDelay) {
          this.respawnSoldier(soldier);
        }
      }
    }
  }

  private respawnSoldier(soldier: Soldier): void {
    const def = this.currentMapDef;
    const spawns = def.safe[soldier.team];
    const spawnIdx = spawns[Math.floor(Math.random() * spawns.length)];
    const spawnNode = def.rawNodes[spawnIdx];
    const spawnPos = new THREE.Vector3(spawnNode[0], spawnNode[1] + 1, spawnNode[2]);
    const spawnYaw = soldier.team === 'ALPHA' ? Math.PI : 0;

    if (soldier.isHuman) {
      this.humanPlayer?.respawn(spawnPos, spawnYaw);
    } else {
      respawnBot(soldier, spawnPos, spawnYaw);
    }
    soldier._deathProcessed = false;
    this.onPlayerRespawn?.(soldier);
  }

  private checkWinCondition(): void {
    if (this.alphaScore >= this.config.maxScore) {
      this.endMatch('ALPHA');
    } else if (this.bravoScore >= this.config.maxScore) {
      this.endMatch('BRAVO');
    } else if (this.matchTime <= 0) {
      const winner = this.alphaScore > this.bravoScore ? 'ALPHA' : this.bravoScore > this.alphaScore ? 'BRAVO' : 'ALPHA';
      this.endMatch(winner);
    }
  }

  registerKill(killer: Soldier, victim: Soldier): void {
    if (killer.team === 'ALPHA') this.alphaScore++;
    else this.bravoScore++;
    this.onScoreChange?.(this.alphaScore, this.bravoScore);
  }

  private endMatch(winner: Team): void {
    this.isRunning = false;
    this.state = 'MATCH_END';
    this.onStateChange?.(this.state);
    this.onMatchEnd?.(winner);

    // Rotate map for next match
    if (this.config.mapRotation) {
      this.rotateMap();
    }
  }

  private rotateMap(): void {
    const mapIds: MapId[] = ['compound', 'shipment', 'shoothouse', 'blasttown', 'downtown'];
    const currentIndex = mapIds.indexOf(this.currentMapId);
    const nextIndex = (currentIndex + 1) % mapIds.length;
    this.currentMapId = mapIds[nextIndex];
    this.onMapChange?.(this.currentMapId);
  }

  async startNextMatch(role: Role, settings: any): Promise<void> {
    this.alphaScore = 0;
    this.bravoScore = 0;
    this.onScoreChange?.(0, 0);

    // Clean up
    clearProjectiles();
    clearSmokes();
    clearDebris();

    if (this.humanPlayer) {
      this.humanPlayer.dispose();
    }

    // Remove all soldier meshes
    for (const soldier of this.soldiers) {
      // Cleanup would happen here
    }

    await this.start(role, settings);
  }

  pause(): void {
    if (this.state === 'PLAYING') {
      this.state = 'PAUSED';
      this.onStateChange?.(this.state);
    }
  }

  resume(): void {
    if (this.state === 'PAUSED') {
      this.state = 'PLAYING';
      this.onStateChange?.(this.state);
    }
  }

  getState(): GameState {
    return this.state;
  }

  getScores(): { alpha: number; bravo: number } {
    return { alpha: this.alphaScore, bravo: this.bravoScore };
  }

  getMatchTime(): number {
    return this.matchTime;
  }

  getCurrentMap(): MapDef {
    return this.currentMapDef;
  }

  getSoldiers(): Soldier[] {
    return this.soldiers;
  }

  getHumanPlayer(): HumanPlayer | null {
    return this.humanPlayer;
  }

  getNavGraph(): any {
    return this.navGraph;
  }

  getZoneName(pos: THREE.Vector3): string {
    return getZoneName(this.currentMapDef, pos);
  }
}