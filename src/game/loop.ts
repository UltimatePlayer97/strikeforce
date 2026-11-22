import { updateBallisticsAndProps } from '../combat/effects';
import { camera, renderer, scene } from '../core/renderer';
import { net } from '../net/net';
import { updateAIBots } from '../ai/bots';
import { updateNavDebug } from '../world/nav/navDebug';
import { updateHUD } from '../ui/hud';
import { updateViewmodelClipAndReticle } from '../weapons/viewmodel';
import { updateHumanPlayer } from './player';
import { matchState } from './state';

const MAX_STEP = 0.05;
/** Cap on catch-up so a long stall can't freeze the tab with a huge burst of steps. */
const MAX_CATCHUP = 0.25;

let lastTime = performance.now();

function simulate(dt: number): void {
  updateHumanPlayer(dt);
  updateAIBots(dt);
  updateBallisticsAndProps(dt);
  updateHUD(dt);
  updateNavDebug(dt);
  net.tick(dt);
}

/** Runs the sim in <= MAX_STEP slices so physics stays stable after throttled/late ticks. */
function simulateElapsed(elapsed: number): void {
  let remaining = Math.min(elapsed, MAX_CATCHUP);
  while (remaining > 1e-4) {
    const dt = Math.min(remaining, MAX_STEP);
    simulate(dt);
    remaining -= dt;
  }
}

function animate(now: number): void {
  requestAnimationFrame(animate);
  const elapsed = (now - lastTime) / 1000;
  lastTime = now;

  if (!matchState.paused) {
    simulate(Math.min(elapsed, MAX_STEP));
  } else {
    // Online there is no pause: keep simulating + syncing while the menu is open
    if (net.active) simulate(Math.min(elapsed, MAX_STEP));
    // Gentle orbital preview of the compound while on the Deploy / Pause screen
    const previewAngle = now * 0.00018;
    camera.position.set(Math.sin(previewAngle) * 34, 18, Math.cos(previewAngle) * 34);
    camera.lookAt(0, 2, 0);
  }

  updateViewmodelClipAndReticle();
  renderer.render(scene, camera);
}

/**
 * Browsers stop requestAnimationFrame (and clamp main-thread timers to ~1 Hz) in hidden tabs,
 * which froze the room whenever its host tabbed out. Worker timers aren't throttled the same
 * way, so while the tab is hidden and a room is active a worker drives the simulation instead.
 */
function startBackgroundTicker(): void {
  let worker: Worker;
  try {
    const src = 'setInterval(function(){postMessage(0)},16)';
    worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  } catch {
    return;
  }
  worker.onmessage = () => {
    if (!document.hidden || !net.active) return;
    const now = performance.now();
    const elapsed = (now - lastTime) / 1000;
    lastTime = now;
    simulateElapsed(elapsed);
  };
}

export function startLoop(): void {
  lastTime = performance.now();
  startBackgroundTicker();
  requestAnimationFrame(animate);
}
