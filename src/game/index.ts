import './core.js';

/** Entry point for the original STRIKEFORCE runtime. */
export function startGame(): void {
  const canvas = document.getElementById('game-canvas');

  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('STRIKEFORCE: required #game-canvas element was not found.');
  }

  // The original runtime assigns its animation loop to window.onload.
  // Module scripts execute before the load event, so the browser invokes it.
  // This fallback covers development environments where this module is loaded
  // after the document has already completed.
  if (document.readyState === 'complete' && typeof window.onload === 'function') {
    window.onload.call(window, new Event('load'));
  }
}
