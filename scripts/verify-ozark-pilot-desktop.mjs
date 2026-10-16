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
          const moved = await win.webContents.executeJavaScript('window.__ozarkPilot.snapshot()');
          assert.ok(moved.player.x > started.player.x + 10, 'native right input did not move the player');
          await win.webContents.executeJavaScript("window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW',key:'w'}));window.dispatchEvent(new Event('blur')); ");
          const stopped = await win.webContents.executeJavaScript('window.__ozarkPilot.snapshot()');
          await delay(250);
          const afterBlur = await win.webContents.executeJavaScript('window.__ozarkPilot.snapshot()');
          assert.deepEqual(afterBlur.player, stopped.player, 'blur did not clear held pilot input');
          assert.equal(afterBlur.started, true);
          assert.equal(await win.webContents.executeJavaScript('window.__pilotStorageCalls.length'), 0,
            'pilot used browser storage after startup');
          await fs.writeFile(path.join(context.output, 'walking-corridor.png'),
            (await win.webContents.capturePage()).toPNG());
          await fs.writeFile(path.join(context.output, 'result.json'), JSON.stringify({
            passed: true, isolatedProfile: true, nativeInput: true, inputClearedOnBlur: true,
            zeroPilotStorageCalls: true, exactLegacySaveBytesPreserved: true,
            profileIdentity: afterBlur.profileIdentity, start: started.player,
            afterInput: moved.player, observation: afterBlur.observation,
          }, null, 2) + '\\n');
          console.log('PASS: native pilot input, rendered screenshot, and zero storage calls.');
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
console.log(JSON.stringify({ ...result, screenshot: join(output, 'walking-corridor.png') }, null, 2));
