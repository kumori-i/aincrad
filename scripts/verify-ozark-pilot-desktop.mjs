/** Actual Electron input/render and zero-save QA in a disposable profile. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApplication } from './build.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
await buildApplication();
const directory = await mkdtemp(join(tmpdir(), 'aincrad-ozark-pilot-'));
const output = resolve(root, 'test-results/ozark-pilot-desktop');
await mkdir(output, { recursive: true });
const context = { root, directory, output };
const harness = join(directory, 'runner.cjs');
await writeFile(harness, `
const { app, session } = require('electron');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const context = ${JSON.stringify(context)};
const phase = process.argv.find(arg => arg.startsWith('--phase='))?.slice(8);
let handled = false;
const timeout = setTimeout(() => { console.error('Ozark pilot native QA timed out'); app.exit(1); }, 60000);
const digest = raw => createHash('sha256').update(raw).digest('hex');
const page = (win, fn) => win.webContents.executeJavaScript('(' + fn.toString() + ')()');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const snapshot = win => win.webContents.executeJavaScript('window.__ozarkPilot.snapshot()');
async function holdUntil(win, keyCode, predicate, label, timeoutMs = 9000) {
  const deadline = Date.now() + timeoutMs;
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
  try {
    while (Date.now() < deadline) {
      await delay(80);
      const current = await snapshot(win);
      if (predicate(current)) return current;
    }
    throw new Error('Native pilot input did not reach ' + label + ': ' +
      JSON.stringify(await snapshot(win)));
  } finally {
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
  }
}

app.on('browser-window-created', (_event, win) => {
  win.webContents.on('did-finish-load', async () => {
    if (handled) return;
    handled = true;
    try {
      for (let i = 0; i < 120; i++) {
        if (await win.webContents.executeJavaScript('Boolean(window.__ozarkPilot)')) break;
        await delay(50);
      }
      assert.equal(await win.webContents.executeJavaScript('Boolean(window.__ozarkPilot)'), true);
      assert.equal(await win.webContents.executeJavaScript('typeof window.__aincrad'), 'undefined');
      const expectedPath = path.join(context.directory, 'expected-hash.txt');
      if (phase === 'seed') {
        const raw = await page(win, async function seedPage() {
          const { CONFIG } = await import('./src/config.js');
          const { freshState } = await import('./src/world.js');
          const value = JSON.stringify(freshState());
          localStorage.setItem(CONFIG.saveKey, value);
          return value;
        });
        await fs.writeFile(expectedPath, digest(raw) + '\\n');
        await session.defaultSession.flushStorageData();
        console.log('PASS: seeded a synthetic legacy save only in the disposable profile.');
      } else {
        const expected = (await fs.readFile(expectedPath, 'utf8')).trim();
        const before = await page(win, async function readSave() {
          const { CONFIG } = await import('./src/config.js');
          return localStorage.getItem(CONFIG.saveKey);
        });
        assert.equal(digest(before), expected, 'pilot startup changed synthetic legacy save bytes');
        if (phase === 'walk') {
          const started = await page(win, function startPilot() {
            const calls = [];
            for (const name of ['setItem', 'removeItem', 'clear']) {
              const original = Storage.prototype[name];
              Storage.prototype[name] = function (...args) {
                calls.push(name);
                return original.apply(this, args);
              };
            }
            window.__pilotStorageCalls = calls;
            window.__ozarkPilot.start();
            return window.__ozarkPilot.snapshot();
          });
          assert.equal(started.started, true);
          assert.match(started.profileIdentity, /^sha256:[a-f0-9]{64}$/);
          win.focus();
          win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'D' });
          await delay(700);
          win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'D' });
          const moved = await snapshot(win);
          assert.ok(moved.player.x > started.player.x + 10, 'native right input did not move the player');
          let autonomous = null;
          for (let index = 0; index < 90; index += 1) {
            const current = await snapshot(win);
            if (current.agent?.actionEvents >= 1) { autonomous = current; break; }
            await delay(80);
          }
          assert.ok(autonomous, 'Aster did not complete an autonomous action in the native pilot');
          assert.equal(autonomous.agent.lastResult.action, 'move');
          assert.equal(autonomous.agent.lastResult.movement?.footing, 'shallow-water');
          assert.ok(autonomous.agent.wetness > 0, 'the native agent did not experience wading');
          const beforeAsterFrame = (await snapshot(win)).renderFrame;
          await page(win, function watchAster() {
            document.getElementById('npc-short').click();
          });
          assert.equal((await snapshot(win)).cameraTarget, 'aster');
          let centeredOnAster = null;
          for (let index = 0; index < 100; index += 1) {
            const current = await snapshot(win);
            if (current.renderFrame > beforeAsterFrame &&
                Math.hypot(current.renderCamera.x - current.agent.position.x,
                  current.renderCamera.y - current.agent.position.y) < 20) {
              centeredOnAster = current;
              break;
            }
            await delay(80);
          }
          assert.ok(centeredOnAster, 'Aster camera never rendered at their physical position');
          await fs.writeFile(path.join(context.output, 'aster-autonomous-wade.png'),
            (await win.webContents.capturePage()).toPNG());
          await page(win, function followPlayer() {
            document.getElementById('npc-short').click();
          });
          assert.equal((await snapshot(win)).cameraTarget, 'player');
          await fs.writeFile(path.join(context.output, 'walking-corridor.png'),
            (await win.webContents.capturePage()).toPNG());
          const bank = await holdUntil(win, 'A', current =>
            current.player.x <= -1220, 'the main-channel bank');
          assert.equal(bank.observation.ground, 'dry-land');
          const shallow = await holdUntil(win, 'W', current =>
            current.observation.ground === 'shallow-water' &&
            current.player.y <= 270, 'shallow main-channel water');
          assert.equal(shallow.observation.currentCue, 'downstream');
          assert.ok(shallow.wetness > 0, 'wading did not make the player wet');
          assert.ok(shallow.effort > 0, 'wading did not add effort');
          await delay(120);
          await fs.writeFile(path.join(context.output, 'wading-shallow-channel.png'),
            (await win.webContents.capturePage()).toPNG());
          const exited = await holdUntil(win, 'S', current =>
            current.observation.ground === 'dry-land' &&
            current.player.y >= 340, 'dry ground after leaving the channel');
          assert.ok(exited.player.y > shallow.player.y + 40,
            'native south input did not leave shallow water');
          assert.ok(exited.wetness > 0, 'wetness did not persist immediately after exit');
          assert.ok(exited.effort > 0, 'wading effort did not persist immediately after exit');
          await win.webContents.executeJavaScript("window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW',key:'w'}));window.dispatchEvent(new Event('blur')); ");
          const stopped = await snapshot(win);
          await delay(250);
          const afterBlur = await snapshot(win);
          assert.deepEqual(afterBlur.player, stopped.player, 'blur did not clear held pilot input');
          assert.equal(afterBlur.started, true);
          assert.equal(await win.webContents.executeJavaScript('window.__pilotStorageCalls.length'), 0,
            'pilot used browser storage after startup');
          await fs.writeFile(path.join(context.output, 'result.json'), JSON.stringify({
            passed: true, isolatedProfile: true, nativeInput: true, inputClearedOnBlur: true,
            shallowWaterEnteredAndExited: true, wetnessAndEffortObserved: true,
            qualitativeCurrentObserved: true, zeroPilotStorageCalls: true,
            autonomousAgentWaded: true, agentCameraWorked: true,
            exactLegacySaveBytesPreserved: true,
            profileIdentity: afterBlur.profileIdentity, start: started.player,
            afterInput: moved.player, bank: bank.player, shallow: shallow.player,
            afterExit: exited.player, shallowObservation: shallow.observation,
            shallowWetness: shallow.wetness, shallowEffort: shallow.effort,
            afterExitWetness: exited.wetness, afterExitEffort: exited.effort,
            agentWadingReceipt: autonomous.agent.lastResult.movement,
          }, null, 2) + '\\n');
          console.log('PASS: native walking, shallow-water entry and exit, wetness/effort, current cue, screenshots, and zero storage calls.');
        }
        const after = await page(win, async function readSaveAgain() {
          const { CONFIG } = await import('./src/config.js');
          return localStorage.getItem(CONFIG.saveKey);
        });
        assert.equal(digest(after), expected, 'pilot changed synthetic legacy save bytes');
        await session.defaultSession.flushStorageData();
        if (phase === 'reopen') console.log('PASS: exact synthetic legacy save bytes persisted across pilot restart.');
      }
      clearTimeout(timeout);
      app.quit();
    } catch (error) {
      console.error(error);
      clearTimeout(timeout);
      app.exit(1);
    }
  });
});
require(path.join(context.root, 'dist/desktop/main.cjs'));
`);

const electron = createRequire(import.meta.url)('electron');
for (const phase of ['seed', 'walk', 'reopen']) {
  const flags = [harness, '--test', `--test-profile=${join(directory, 'profile')}`,
    '--test-ozark-pilot', `--phase=${phase}`];
  if (process.platform === 'linux') flags.push('--ozone-platform=headless', '--disable-gpu');
  if (process.getuid?.() === 0) flags.push('--no-sandbox');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const code = await new Promise((resolve, reject) => {
    const child = spawn(electron, flags, { cwd: root, stdio: 'inherit', env });
    child.on('error', reject);
    child.on('exit', (code, signal) => resolve({ code, signal }));
  });
  assert.deepEqual(code, { code: 0, signal: null },
    `Native ${phase} failed; isolated artifacts retained at ${directory}`);
}
const result = JSON.parse(await readFile(join(output, 'result.json'), 'utf8'));
assert.equal(result.passed, true);
console.log(JSON.stringify({ ...result,
  walkingScreenshot: join(output, 'walking-corridor.png'),
  wadingScreenshot: join(output, 'wading-shallow-channel.png'),
  agentScreenshot: join(output, 'aster-autonomous-wade.png'),
}, null, 2));
