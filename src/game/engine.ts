import { initRenderer, getRenderer, getScene, getCamera, setCameraFov } from '../renderer';
import { initHUD, showHUD, hideHUD, updateHUD, showHitmarker, showDamageDirection, showDamageVignette, setADS, setScope, showDeathCam, hideDeathCam, updateDeathTimer, showSpawnProtection, hideSpawnProtection, addKillfeedEntry, updateRadar, setNetworkStatus } from '../ui/hud';
import { initMenu, showMenu, hideMenu, setMenuDeployText, setLoadoutNote, updateMultiplayerStatus } from '../ui/menu';
import { showScoreboard, hideScoreboard, updateScoreboard } from '../ui/scoreboard';
import { InputManager } from '../input';
import type { InputState } from '../types';
import { MatchManager } from './match';
import { HumanPlayer } from './player';
import type { Soldier, Role, Team, GameSettings, GameState } from '../types';
import { sfx } from '../audio/sound';
import { WebRTCManager } from '../network/webrtc';
import type { WebRTCConfig } from '../network/webrtc';
import { NetworkSync } from '../network/sync';
import type { NetworkMessage } from '../types';

let matchManager: MatchManager | null = null;
let inputManager: InputManager | null = null;
let humanPlayer: HumanPlayer | null = null;
let lastTime = 0;
let animationFrameId: number | null = null;
let currentState: GameState = 'MENU';
let isMultiplayer = false;
let webRTCManager: WebRTCManager | null = null;
let networkSync: NetworkSync | null = null;

const defaultSettings: GameSettings = {
  sensitivity: 1.0,
  adsSensitivity: 1.0,
  fov: 75,
  cameraBob: true,
  aiSkill: 'VETERAN',
  masterVolume: 1.0,
  sfxVolume: 1.0
};

let currentSettings = { ...defaultSettings };
let currentRole: Role = 'ASSAULT';

function startGame(): void {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  initRenderer(canvas);
  initHUD();
  initMenu({
    onDeploy: handleDeploy,
    onSettingsChange: handleSettingsChange,
    onWeaponChange: handleWeaponChange,
    onWeaponReset: handleWeaponReset,
    onMultiplayerNew: handleMultiplayerNew,
    onMultiplayerJoin: handleMultiplayerJoin,
    onMultiplayerLeave: handleMultiplayerLeave,
    onMultiplayerCopy: handleMultiplayerCopy
  });

  inputManager = new InputManager(currentSettings);
  inputManager.onPause(() => togglePause());
  inputManager.onScoreboard((show) => {
    if (show) showScoreboard(); else hideScoreboard();
  });

  // Expose for debugging
  (window as any).game = {
    getMatchManager: () => matchManager,
    getHumanPlayer: () => humanPlayer,
    getInputManager: () => inputManager,
    getSettings: () => currentSettings
  };

  showMenu();
  animate(0);
}

function handleDeploy(role: Role): void {
  currentRole = role;
  if (matchManager && matchManager.getState() === 'PLAYING') {
    // Hot-swap weapon
    humanPlayer?.changeWeapon(role);
  } else {
    startMatch(role);
  }
}

async function startMatch(role: Role): Promise<void> {
  hideMenu();
  showHUD();

  // Request pointer lock for mouse look
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  try {
    canvas.requestPointerLock();
  } catch {}

  matchManager = new MatchManager({
    maxScore: 30,
    roundTime: 600,
    mapRotation: true
  });

  matchManager.onStateChange = handleStateChange;
  matchManager.onScoreChange = (alpha, bravo) => {
    // Update handled in HUD update
  };
  matchManager.onMatchEnd = handleMatchEnd;
  matchManager.onMapChange = handleMapChange;
  matchManager.onPlayerDeath = handlePlayerDeath;
  matchManager.onPlayerRespawn = handlePlayerRespawn;

  await matchManager.start(role, currentSettings);
  humanPlayer = matchManager.getHumanPlayer();
  sfx.init();
}

function handleStateChange(state: GameState): void {
  currentState = state;
  switch (state) {
    case 'PAUSED':
      showMenu();
      hideHUD();
      setMenuDeployText('CLICK TO RESUME — ' + getTeamPrefix());
      break;
    case 'PLAYING':
      hideMenu();
      showHUD();
      break;
    case 'MATCH_END':
      showMenu();
      hideHUD();
      break;
  }
}

function handleMatchEnd(winner: Team): void {
  const won = winner === 'ALPHA';
  setMenuDeployText(won ? 'VICTORY — CLICK FOR NEXT MATCH' : 'DEFEAT — CLICK FOR NEXT MATCH');
  setLoadoutNote(won ? 'Team Alpha wins the match!' : 'Team Bravo wins the match!');
}

async function handleMapChange(mapId: string): Promise<void> {
  if (matchManager) {
    await matchManager.startNextMatch(currentRole, currentSettings);
  }
}

function handlePlayerDeath(victim: Soldier, killer: Soldier): void {
  const isLocal = victim.isHuman;
  const killerName = killer.name;
  const victimName = victim.name;

  if (isLocal) {
    showDeathCam(killerName, 5);
  }

  addKillfeedEntry({
    killer: killer.isHuman ? 'YOU' : killerName,
    victim: victim.isHuman ? 'YOU' : victimName,
    weapon: killer.weapon.stats.name,
    headshot: false, // Would need to track this
    time: Date.now(),
    isLocal: killer.isHuman
  });

  matchManager?.registerKill(killer, victim);
}

function handlePlayerRespawn(player: Soldier): void {
  if (player.isHuman) {
    showSpawnProtection(3);
    setTimeout(hideSpawnProtection, 3000);
  }
}

function handleSettingsChange(settings: Partial<GameSettings>): void {
  currentSettings = { ...currentSettings, ...settings };
  inputManager?.updateSettings(settings);
  if (settings.fov) setCameraFov(settings.fov);
  if (humanPlayer) {
    // Apply settings to human player
  }
}

function handleWeaponChange(role: Role, customData: any): void {
  currentRole = role;
  if (humanPlayer) {
    if (customData.custom) {
      humanPlayer.applyCustomWeapon(customData);
    } else if (customData.preset) {
      humanPlayer.changeWeapon(role);
    }
  }
}

function handleWeaponReset(): void {
  if (humanPlayer) {
    humanPlayer.resetWeapon();
  }
}

async function handleMultiplayerNew(relayUrl: string, name: string, room: string, team: Team): Promise<void> {
  await connectMultiplayer(relayUrl, name, room, team, true);
}

async function handleMultiplayerJoin(relayUrl: string, name: string, room: string, team: Team): Promise<void> {
  await connectMultiplayer(relayUrl, name, room, team, false);
}

async function connectMultiplayer(relayUrl: string, name: string, room: string, team: Team, isHost: boolean): Promise<void> {
  const config: WebRTCConfig = {
    relayUrl,
    roomCode: room,
    playerName: name,
    team
  };

  webRTCManager = new WebRTCManager(config);
  networkSync = new NetworkSync(webRTCManager);

  webRTCManager.onMessage((msg: NetworkMessage) => {
    // Handle network messages
  });

  try {
    await webRTCManager.connect();
    isMultiplayer = true;
    updateMultiplayerStatus(true, room, []);
    setLoadoutNote(`Connected to room ${room} as ${name}`);
  } catch (e) {
    console.error('Multiplayer connection failed:', e);
    updateMultiplayerStatus(false);
    setLoadoutNote('Connection failed');
  }
}

function handleMultiplayerLeave(): void {
  if (webRTCManager) {
    webRTCManager.disconnect();
    webRTCManager = null;
    networkSync = null;
    isMultiplayer = false;
    updateMultiplayerStatus(false);
    setLoadoutNote('Disconnected');
  }
}

function handleMultiplayerCopy(): void {
  if (webRTCManager) {
    const roomCode = (document.getElementById('mp-room') as HTMLInputElement).value;
    const url = `${window.location.origin}?room=${roomCode}`;
    navigator.clipboard.writeText(url);
    setLoadoutNote('Invite link copied!');
  }
}

function togglePause(): void {
  if (matchManager) {
    if (matchManager.getState() === 'PLAYING') {
      matchManager.pause();
    } else if (matchManager.getState() === 'PAUSED') {
      matchManager.resume();
    }
  }
}

function getTeamPrefix(): string {
  return currentRole === 'ASSAULT' ? 'ALPHA-LEAD' : 'BRAVO-LEAD';
}

function animate(time: number): void {
  animationFrameId = requestAnimationFrame(animate);

  const deltaTime = Math.min((time - lastTime) / 1000, 1/30);
  lastTime = time;

  if (matchManager && matchManager.getState() === 'PLAYING') {
    const input = inputManager?.getState() || {} as InputState;
    humanPlayer?.setInput(input);

    matchManager.update(deltaTime);

    updateHUD(
      humanPlayer!.soldier,
      matchManager.getScores().alpha,
      matchManager.getScores().bravo,
      matchManager.getMatchTime(),
      matchManager.getSoldiers()
    );

    updateRadar(humanPlayer!.soldier, matchManager.getSoldiers(), matchManager.getCurrentMap());
    updateScoreboard(
      matchManager.getSoldiers().filter(s => s.team === 'ALPHA'),
      matchManager.getSoldiers().filter(s => s.team === 'BRAVO'),
      matchManager.getScores().alpha,
      matchManager.getScores().bravo
    );

    if (isMultiplayer && networkSync) {
      networkSync.sendStateUpdate(humanPlayer!.soldier);
      networkSync.interpolateRemotePlayers(time);
    }
  }

  getRenderer().render(getScene(), getCamera());
}

function handleResize(): void {
  // Handled by renderer
}

window.addEventListener('resize', handleResize);

// Export for debugging
(window as any).game = {
  getMatchManager: () => matchManager,
  getHumanPlayer: () => humanPlayer,
  getSettings: () => currentSettings
};

export { startGame };