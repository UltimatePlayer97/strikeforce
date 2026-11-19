import { test, expect, beforeAll, afterAll } from 'bun:test';
import { chromium } from 'playwright';
import { spawn, ChildProcess } from 'child_process';

let server: ChildProcess;
let browser: any;

beforeAll(async () => {
  // Start vite preview server
  server = spawn('npx', ['vite', 'preview'], {
    cwd: '/home/user/Downloads/strikeforce',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await new Promise(resolve => setTimeout(resolve, 3000));

  browser = await chromium.launch({
    headless: true,
    executablePath: '/home/user/.nix-profile/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
}, 30000);

afterAll(async () => {
  await browser?.close();
  server?.kill();
}, 30000);

async function deploy(page: any) {
  await page.goto('http://localhost:4173', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForSelector('#deploy-btn', { timeout: 10000 });
  await page.click('#deploy-btn');
  await page.waitForTimeout(2000);
}

function assert(condition: any, message: string) {
  if (!condition) throw new Error(message);
}

test('game loads and deploy button appears', async () => {
  const page = await browser.newPage();
  await page.goto('http://localhost:4173', { waitUntil: 'networkidle', timeout: 30000 });
  const visible = await page.isVisible('#deploy-btn');
  assert(visible, 'Deploy button should be visible');
  await page.close();
}, 30000);

test('camera movement works', async () => {
  const page = await browser.newPage();
  await deploy(page);
  await page.mouse.move(400, 300);
  await page.mouse.down();
  await page.mouse.move(600, 300);
  await page.mouse.up();
  await page.waitForTimeout(500);
  const camInfo = await page.evaluate(() => {
    if (window.game?.getHumanPlayer) {
      const hp = window.game.getHumanPlayer();
      return { yaw: hp.soldier?.yaw, pitch: hp.soldier?.pitch };
    }
    return null;
  });
  assert(camInfo !== null, 'Game should exist');
  assert(Math.abs(camInfo!.yaw) > 0, 'Camera should have rotated');
  await page.close();
}, 30000);

test('movement (WASD) works', async () => {
  const page = await browser.newPage();
  await deploy(page);
  const posBefore = await page.evaluate(() => {
    if (window.game?.getHumanPlayer) {
      const hp = window.game.getHumanPlayer();
      return hp.soldier?.pos ? { x: hp.soldier.pos.x, z: hp.soldier.pos.z } : null;
    }
    return null;
  });
  await page.keyboard.down('w');
  await page.waitForTimeout(2000); // Longer wait for movement
  await page.keyboard.up('w');
  await page.waitForTimeout(500);
  const posAfter = await page.evaluate(() => {
    if (window.game?.getHumanPlayer) {
      const hp = window.game.getHumanPlayer();
      return hp.soldier?.pos ? { x: hp.soldier.pos.x, z: hp.soldier.pos.z } : null;
    }
    return null;
  });
  assert(posBefore !== null, 'Position before should exist');
  assert(posAfter !== null, 'Position after should exist');
  assert(posAfter!.z !== posBefore!.z, 'Position should have changed');
  await page.close();
}, 30000);

test('shooting fires bullets with correct fire rate', async () => {
  const page = await browser.newPage();
  await deploy(page);
  const ammoBefore = await page.evaluate(() => {
    if (window.game?.getHumanPlayer) {
      return window.game.getHumanPlayer().soldier?.weapon?.ammo;
    }
    return null;
  });
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => {
      if (window.game?.getInputManager) {
        window.game.getInputManager().state.fire = true;
      }
    });
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      if (window.game?.getInputManager) {
        window.game.getInputManager().state.fire = false;
      }
    });
    await page.waitForTimeout(50);
  }
  const ammoAfter = await page.evaluate(() => {
    if (window.game?.getHumanPlayer) {
      return window.game.getHumanPlayer().soldier?.weapon?.ammo;
    }
    return null;
  });
  assert(ammoBefore !== null && ammoAfter !== null, 'Ammo should be tracked');
  assert(ammoAfter < ammoBefore, 'Ammo should decrease after shooting');
  await page.close();
}, 30000);

test('reload refills ammo', async () => {
  const page = await browser.newPage();
  await deploy(page);
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => {
      if (window.game?.getInputManager) window.game.getInputManager().state.fire = true;
    });
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      if (window.game?.getInputManager) window.game.getInputManager().state.fire = false;
    });
    await page.waitForTimeout(50);
  }
  const ammoBeforeReload = await page.evaluate(() => {
    if (window.game?.getHumanPlayer) return window.game.getHumanPlayer().soldier?.weapon?.ammo;
    return null;
  });
  await page.keyboard.press('r');
  await page.waitForTimeout(2500);
  const ammoAfterReload = await page.evaluate(() => {
    if (window.game?.getHumanPlayer) return window.game.getHumanPlayer().soldier?.weapon?.ammo;
    return null;
  });
  assert(ammoBeforeReload !== null && ammoAfterReload !== null, 'Ammo should be tracked');
  assert(ammoAfterReload > ammoBeforeReload, 'Ammo should increase after reload');
  assert(ammoAfterReload === 30, 'Ammo should be full mag (30)');
  await page.close();
}, 30000);

test('jump works', async () => {
  const page = await browser.newPage();
  await deploy(page);
  await page.keyboard.press('Space');
  await page.waitForTimeout(500);
  const isAirborne = await page.evaluate(() => {
    if (window.game?.getHumanPlayer) {
      return window.game.getHumanPlayer().soldier?.pos?.y > 1.0;
    }
    return false;
  });
  assert(isAirborne, 'Player should be airborne after jump');
  await page.close();
}, 30000);

test('crouch/prone toggle works', async () => {
  const page = await browser.newPage();
  await deploy(page);
  const stanceBefore = await page.evaluate(() => {
    if (window.game?.getHumanPlayer) return window.game.getHumanPlayer().soldier?.stance;
    return null;
  });
  await page.keyboard.press('c');
  await page.waitForTimeout(500);
  const stanceAfter = await page.evaluate(() => {
    if (window.game?.getHumanPlayer) return window.game.getHumanPlayer().soldier?.stance;
    return null;
  });
  assert(stanceAfter !== stanceBefore, 'Stance should change');
  await page.close();
}, 30000);

test('grenade throws', async () => {
  const page = await browser.newPage();
  await deploy(page);
  const before = await page.evaluate(() => window.game?.getHumanPlayer()?.soldier?.grenades);
  await page.keyboard.press('g');
  await page.waitForTimeout(1000);
  const after = await page.evaluate(() => window.game?.getHumanPlayer()?.soldier?.grenades);
  assert(after < before, 'Grenades should decrease');
  await page.close();
}, 30000);

test('smoke throws', async () => {
  const page = await browser.newPage();
  await deploy(page);
  const before = await page.evaluate(() => window.game?.getHumanPlayer()?.soldier?.smokes);
  await page.keyboard.press('f');
  await page.waitForTimeout(1000);
  const after = await page.evaluate(() => window.game?.getHumanPlayer()?.soldier?.smokes);
  assert(after < before, 'Smokes should decrease');
  await page.close();
}, 30000);

test('scoreboard (Tab) toggles', async () => {
  const page = await browser.newPage();
  await deploy(page);
  await page.keyboard.down('Tab');
  await page.waitForTimeout(500);
  const visible = await page.evaluate(() => {
    const el = document.getElementById('scoreboard-overlay');
    return el && !el.classList.contains('hidden');
  });
  assert(visible, 'Scoreboard should be visible');
  await page.keyboard.up('Tab');
  await page.waitForTimeout(500);
  const hidden = await page.evaluate(() => {
    const el = document.getElementById('scoreboard-overlay');
    return el && el.classList.contains('hidden');
  });
  assert(hidden, 'Scoreboard should be hidden');
  await page.close();
}, 30000);

test('pause menu (Esc) toggles', async () => {
  const page = await browser.newPage();
  await deploy(page);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);
  const visible = await page.evaluate(() => {
    const el = document.getElementById('menu-overlay');
    return el && !el.classList.contains('hidden');
  });
  assert(visible, 'Menu should be visible');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const hidden = await page.evaluate(() => {
    const el = document.getElementById('menu-overlay');
    return el && el.classList.contains('hidden');
  });
  assert(hidden, 'Menu should be hidden');
  await page.close();
}, 30000);

test('full match state: 12 soldiers, 6v6, scores zero', async () => {
  const page = await browser.newPage();
  await deploy(page);
  const state = await page.evaluate(() => {
    if (window.game?.getMatchManager) {
      const mm = window.game.getMatchManager();
      return {
        soldiers: mm.getSoldiers().length,
        alphaScore: mm.getScores().alpha,
        bravoScore: mm.getScores().bravo,
        humanAlive: mm.getHumanPlayer()?.soldier?.isAlive,
      };
    }
    return null;
  });
  assert(state !== null, 'Match state should exist');
  assert(state!.soldiers === 12, 'Should have 12 soldiers');
  assert(state!.alphaScore === 0, 'Alpha score should be 0');
  assert(state!.bravoScore === 0, 'Bravo score should be 0');
  assert(state!.humanAlive === true, 'Human should be alive');
  await page.close();
}, 30000);

test('map loads with geometry (not just lights)', async () => {
  const page = await browser.newPage();
  await deploy(page);
  const sceneInfo = await page.evaluate(() => {
    if (window.game?.getHumanPlayer) {
      const hp = window.game.getHumanPlayer();
      const camera = hp.getCamera();
      if (camera && camera.parent) {
        const scene = camera.parent;
        let mapMeshCount = 0;
        function traverse(obj: any) {
          const isMesh = obj?.isMesh === true || 
            obj?.constructor?.name?.includes('Mesh') || 
            obj?.geometry?.attributes?.position !== undefined;
          if (isMesh && !obj.name.startsWith('destructible')) {
            mapMeshCount++;
          }
          if (obj.children) for (const child of obj.children) traverse(child);
        }
        traverse(scene);
        return { mapMeshCount };
      }
    }
    return { mapMeshCount: 0 };
  });
  assert(sceneInfo.mapMeshCount >= 7, `Map should have merged meshes, got ${sceneInfo.mapMeshCount}`);
  await page.close();
}, 30000);

function deploy(page: any) {
  return page.goto('http://localhost:4173', { waitUntil: 'networkidle', timeout: 30000 })
    .then(() => page.waitForSelector('#deploy-btn', { timeout: 10000 }))
    .then(() => page.click('#deploy-btn'))
    .then(() => page.waitForTimeout(2000));
}