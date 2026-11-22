import * as THREE from 'three';
import { throwThrowable } from '../combat/throwables';
import { startReload } from '../combat/hitscan';
import { canvas } from '../core/renderer';
import { deathCam, game, keys, matchState } from '../game/state';
import { renderScoreboard } from '../ui/scoreboard';
import { $ } from '../util/dom';
import { weaponOf } from '../weapons/defs';

/** Registers keyboard/mouse listeners. Call once after the DOM is ready. */
export function initControls(): void {
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (!matchState.paused) keys[e.code] = true;
    if (e.code === 'Tab') {
      e.preventDefault();
      renderScoreboard();
      $('scoreboard-overlay').classList.remove('hidden');
    }
    if (e.code === 'KeyR' && game.humanPlayer.alive && !matchState.paused) {
      startReload(game.humanPlayer);
    }
    if (
      (e.code === 'KeyG' || e.code === 'KeyF') &&
      game.humanPlayer.alive &&
      !matchState.paused &&
      !e.repeat
    ) {
      const isGrenade = e.code === 'KeyG';
      const type = isGrenade ? 'grenade' : 'smoke';
      const yaw = game.humanPlayer.yaw;
      const throwDirection = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      throwThrowable(game.humanPlayer, type, throwDirection);
    }
  });

  window.addEventListener('keyup', (e: KeyboardEvent) => {
    keys[e.code] = false;
    if (e.code === 'Tab') {
      $('scoreboard-overlay').classList.add('hidden');
    }
  });

  window.addEventListener('mousedown', (e: MouseEvent) => {
    if (matchState.paused) return;
    if (e.button === 0) {
      game.isMouseDown = true;
      game.pendingShotTime = performance.now();
    }
    if (e.button === 2 && game.humanPlayer.alive) {
      game.isADS = true;
      $('ads-vignette').style.opacity = '1';
    }
  });

  window.addEventListener('mouseup', (e: MouseEvent) => {
    if (e.button === 0) game.isMouseDown = false;
    if (e.button === 2) {
      game.isADS = false;
      $('ads-vignette').style.opacity = '0';
    }
  });

  window.addEventListener('contextmenu', (e: Event) => e.preventDefault());

  window.addEventListener('mousemove', (e: MouseEvent) => {
    if (matchState.paused || document.pointerLockElement !== canvas) return;
    const sens =
      0.0021 *
      matchState.mouseSensitivity *
      (game.isADS ? weaponOf(game.humanPlayer).adsSens * matchState.adsSensitivity : 1.0);
    if (game.humanPlayer.alive) {
      game.humanPlayer.yaw -= e.movementX * sens;
      game.humanPlayer.pitch = THREE.MathUtils.clamp(
        game.humanPlayer.pitch - e.movementY * sens,
        -Math.PI * 0.46,
        Math.PI * 0.46,
      );
    } else {
      // Allow player to orbit the 3rd-person ragdoll death camera with mouse!
      deathCam.angle -= e.movementX * sens * 1.3;
    }
  });
}
