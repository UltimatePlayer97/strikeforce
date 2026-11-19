import type { GameSettings } from '../types';

export interface InputState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  sprint: boolean;
  jump: boolean;
  crouch: boolean;
  fire: boolean;
  ads: boolean;
  reload: boolean;
  grenade: boolean;
  smoke: boolean;
  melee: boolean;
  interact: boolean;
  scoreboard: boolean;
  pause: boolean;
  mouseDeltaX: number;
  mouseDeltaY: number;
}

export class InputManager {
  private state: InputState = {
    forward: false, backward: false, left: false, right: false,
    sprint: false, jump: false, crouch: false,
    fire: false, ads: false, reload: false,
    grenade: false, smoke: false, melee: false, interact: false,
    scoreboard: false, pause: false,
    mouseDeltaX: 0, mouseDeltaY: 0
  };

  private settings: GameSettings;
  private pointerLocked = false;
  private onPauseCallback: (() => void) | null = null;
  private onScoreboardCallback: ((show: boolean) => void) | null = null;

  constructor(settings: GameSettings) {
    this.settings = settings;
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    document.addEventListener('keydown', this.onKeyDown.bind(this));
    document.addEventListener('keyup', this.onKeyUp.bind(this));
    document.addEventListener('mousedown', this.onMouseDown.bind(this));
    document.addEventListener('mouseup', this.onMouseUp.bind(this));
    document.addEventListener('mousemove', this.onMouseMove.bind(this));
    document.addEventListener('contextmenu', (e) => e.preventDefault());

    // Pointer lock
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    canvas.addEventListener('click', () => {
      if (!this.pointerLocked) {
        try {
          canvas.requestPointerLock();
        } catch {}
      }
    });

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === canvas;
    });
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.repeat) return;

    switch (e.code) {
      case 'KeyW': this.state.forward = true; break;
      case 'KeyS': this.state.backward = true; break;
      case 'KeyA': this.state.left = true; break;
      case 'KeyD': this.state.right = true; break;
      case 'ShiftLeft': this.state.sprint = true; break;
      case 'Space': this.state.jump = true; break;
      case 'KeyC': this.state.crouch = true; break;
      case 'KeyR': this.state.reload = true; break;
      case 'KeyG': this.state.grenade = true; break;
      case 'KeyF': this.state.smoke = true; break;
      case 'KeyE': this.state.interact = true; break;
      case 'KeyV': this.state.melee = true; break;
      case 'Tab': this.state.scoreboard = true; this.onScoreboardCallback?.(true); break;
      case 'Escape': this.state.pause = true; this.onPauseCallback?.(); break;
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    switch (e.code) {
      case 'KeyW': this.state.forward = false; break;
      case 'KeyS': this.state.backward = false; break;
      case 'KeyA': this.state.left = false; break;
      case 'KeyD': this.state.right = false; break;
      case 'ShiftLeft': this.state.sprint = false; break;
      case 'Space': this.state.jump = false; break;
      case 'KeyC': this.state.crouch = false; break;
      case 'KeyR': this.state.reload = false; break;
      case 'KeyG': this.state.grenade = false; break;
      case 'KeyF': this.state.smoke = false; break;
      case 'KeyE': this.state.interact = false; break;
      case 'KeyV': this.state.melee = false; break;
      case 'Tab': this.state.scoreboard = false; this.onScoreboardCallback?.(false); break;
      case 'Escape': this.state.pause = false; break;
    }
  }

  private onMouseDown(e: MouseEvent): void {
    if (e.button === 0) this.state.fire = true;
    if (e.button === 2) this.state.ads = true;
  }

  private onMouseUp(e: MouseEvent): void {
    if (e.button === 0) this.state.fire = false;
    if (e.button === 2) this.state.ads = false;
  }

  private onMouseMove(e: MouseEvent): void {
    if (this.pointerLocked) {
      this.state.mouseDeltaX = e.movementX * this.settings.sensitivity * 0.002;
      this.state.mouseDeltaY = e.movementY * this.settings.sensitivity * 0.002;
    }
  }

  getState(): Readonly<InputState> {
    return this.state;
  }

  consumeMouseDelta(): { x: number; y: number } {
    const dx = this.state.mouseDeltaX;
    const dy = this.state.mouseDeltaY;
    this.state.mouseDeltaX = 0;
    this.state.mouseDeltaY = 0;
    return { x: dx, y: dy };
  }

  isPointerLocked(): boolean {
    return this.pointerLocked;
  }

  requestPointerLock(): void {
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    try {
      canvas.requestPointerLock();
    } catch {}
  }

  exitPointerLock(): void {
    document.exitPointerLock();
  }

  updateSettings(settings: Partial<GameSettings>): void {
    this.settings = { ...this.settings, ...settings };
  }

  onPause(callback: () => void): void {
    this.onPauseCallback = callback;
  }

  onScoreboard(callback: (show: boolean) => void): void {
    this.onScoreboardCallback = callback;
  }

  reset(): void {
    this.state = {
      forward: false, backward: false, left: false, right: false,
      sprint: false, jump: false, crouch: false,
      fire: false, ads: false, reload: false,
      grenade: false, smoke: false, melee: false, interact: false,
      scoreboard: false, pause: false,
      mouseDeltaX: 0, mouseDeltaY: 0
    };
  }
}