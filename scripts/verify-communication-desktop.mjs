/** Isolated native UI acceptance. --prepare-only creates artifacts, never native evidence. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { buildApplication } from './build.mjs';
import { captureWithReadiness, waitForCaptureFrames } from './native-capture-readiness.mjs';
import { canonicalApplicationRoot, nativeSourceIdentity, captureNativeChild, archiveNativeProfile } from './carcass-native-contract.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const prepareOnly = process.argv.includes('--prepare-only');
assert(process.argv.slice(2).every(arg => arg === '--prepare-only'), 'Only --prepare-only is supported');
if (!prepareOnly) {
  assert(['linux', 'darwin'].includes(process.platform), 'Linux/macOS only');
  assert(process.getuid?.() !== 0, 'Native QA requires an unprivileged sandboxed runtime');
  assert(process.platform !== 'linux' || process.env.DISPLAY || process.env.WAYLAND_DISPLAY, 'Authorized supported display required');
}
const outputRoot = resolve(process.env.AINCRAD_COMMUNICATION_QA_OUTPUT || join(root, 'test-results/communication-native'));
await mkdir(outputRoot, { recursive: true });
const output = await mkdtemp(join(outputRoot, 'run-'));
const temporary = await mkdtemp(join(tmpdir(), 'aincrad-communication-'));
const profile = join(temporary, 'profile');
for (const name of ['profile', 'home', 'config', 'cache']) await mkdir(join(temporary, name));
const application = await canonicalApplicationRoot(output);
const built = await buildApplication(application);
const context = { output, profile, application, sourceIdentity: nativeSourceIdentity(root), sourceFingerprint: built.sourceFingerprint };
const harness = join(output, 'runner.cjs');
const phases = ['exercise', 'reopen'];

// Runs in Electron main. Real application owns protocol, profile and security.
function installNativeRunner(context, captureWithReadiness, waitForCaptureFrames) {
  const { app, session } = require('electron');
  const assert = require('node:assert/strict');
  const fs = require('node:fs/promises'), path = require('node:path');
  const phase = process.argv.find(arg => arg.startsWith('--phase='))?.slice(8);
  assert(['exercise', 'reopen'].includes(phase));
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  let activeWindow, running = false, allowQuit = false, closed = false, stage = 'initializing';
  const screenshots = [], events = [];
  const deadline = setTimeout(() => { console.error('Native communication deadline at ' + stage); app.exit(1); }, 180000);
  app.on('will-quit', event => { if (!allowQuit) event.preventDefault(); else { assert(closed); console.log('COMMUNICATION_NATIVE_WILL_QUIT ' + phase); } });
  const evaluate = (win, code) => { stage = code.slice(0, 140); return win.webContents.executeJavaScript(code); };
  async function waitFor(win, expression) {
    for (let i = 0; i < 1000; i++) { if (await evaluate(win, expression)) return; await delay(50); }
    throw new Error('Condition missing: ' + expression);
  }
  async function capture(win, name) {
    const { png, metadata } = await captureWithReadiness({
      prepare: async () => { const value = await evaluate(win, '(' + waitForCaptureFrames.toString() + ')()'); await delay(100); return value; },
      capture: () => win.webContents.capturePage(),
      retain: async (bytes, attempt) => { const prefix = path.join(context.output, name + '.attempt-' + attempt.attempt); if (bytes) await fs.writeFile(prefix + '.png', bytes); await fs.writeFile(prefix + '.json', JSON.stringify(attempt, null, 2)); },
    });
    assert(png.length > 10000); await fs.writeFile(path.join(context.output, name), png); screenshots.push({ name, ...metadata });
  }
  const raw = win => evaluate(win, "localStorage.getItem('aincrad.world.v2')");
  const click = (win, id) => evaluate(win, 'document.getElementById(' + JSON.stringify(id) + ').click()');
  function escape(win) { win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'ESC' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'ESC' }); }
  async function run(win) {
    await waitFor(win, 'Boolean(window.__ozarkWorld)');
    assert.equal(await evaluate(win, 'location.href'), 'aincrad://app/index.html?test=1');
    assert.equal(await evaluate(win, "document.getElementById('communication-dialog').open"), false);
    if (phase === 'reopen') {
      const previous = JSON.parse(await fs.readFile(path.join(context.output, 'ordinary-checkpoint.json'), 'utf8'));
      assert.equal(await raw(win), previous.raw, 'Independent reopen preserves exact ordinary bytes');
      assert.equal(await evaluate(win, 'window.__ozarkWorld.snapshot().started'), false);
      await capture(win, 'independent-reopen.png'); return;
    }
    assert.equal(await raw(win), null, 'Disposable profile starts empty');
    await evaluate(win, 'window.__ozarkWorld.start();window.__ozarkWorld.pause();window.__ozarkWorld.save()');
    const before = await raw(win); assert(before && JSON.parse(before));
    const ordinary = await evaluate(win, 'window.__ozarkWorld.snapshot()'); assert(ordinary.paused);
    await click(win, 'open-communication'); await waitFor(win, "document.getElementById('communication-dialog').open");
    await capture(win, 'ready.png');
    await click(win, 'communication-start');
    await waitFor(win, "document.getElementById('communication-status').textContent.startsWith('Running')");
    await waitFor(win, "parseInt(document.getElementById('communication-elapsed').textContent,10)>=2");
    await capture(win, 'running.png');
    // Cross the ordinary autosave interval while a real experiment advances.
    await delay(10500);
    assert.equal(await raw(win), before, 'Active experiment prevents ordinary autosave writes');
    assert.equal((await evaluate(win, 'window.__ozarkWorld.snapshot()')).elapsed, ordinary.elapsed, 'Ordinary world stays frozen');
    escape(win); await waitFor(win, "document.getElementById('communication-status').textContent.startsWith('Experiment paused')");
    await delay(350); const frozen = await evaluate(win, "document.getElementById('communication-elapsed').textContent");
    await delay(1000); assert.equal(await evaluate(win, "document.getElementById('communication-elapsed').textContent"), frozen);
    assert.equal(await evaluate(win, 'window.__ozarkWorld.snapshot().paused'), true, 'Native Escape never resumes ordinary world');
    await click(win, 'communication-stop');
    await evaluate(win, "document.getElementById('communication-enabled').checked=false;document.getElementById('communication-seed').value='2';document.getElementById('communication-start').click();document.getElementById('communication-start').click()");
    await waitFor(win, "document.getElementById('communication-status').textContent.includes('constant-message control')");
    await waitFor(win, "parseInt(document.getElementById('communication-elapsed').textContent,10)>=1");
    assert(Number.parseInt(await evaluate(win, "document.getElementById('communication-elapsed').textContent"), 10) < 10, 'Restart starts fresh time');
    await capture(win, 'constant-control.png');
    await click(win, 'communication-close');
    assert.equal(await evaluate(win, "document.getElementById('communication-dialog').open"), false);
    assert.equal(await evaluate(win, 'window.__ozarkWorld.snapshot().paused'), true);
    assert.equal(await raw(win), before, 'Closing experiment preserves ordinary bytes');
    await capture(win, 'closed-to-ordinary-pause.png');
    await click(win, 'open-communication');
    assert.match(await evaluate(win, "document.getElementById('communication-status').textContent"), /^Ready/);
    assert.equal(await evaluate(win, "parseInt(document.getElementById('communication-elapsed').textContent,10)"), 0, 'Modal reopen does not restore experiment');
    await click(win, 'communication-start');
    await waitFor(win, "document.getElementById('communication-status').textContent.startsWith('Running')");
    await fs.writeFile(path.join(context.output, 'ordinary-checkpoint.json'), JSON.stringify({ raw: before, ordinary }, null, 2));
    assert.equal(await raw(win), before, 'Native app closes while experiment active without replacing ordinary save');
  }
  app.on('browser-window-created', (_event, win) => {
    activeWindow = win;
    win.webContents.on('console-message', (_event, ...details) => events.push({ console: details }));
    win.webContents.once('did-finish-load', async () => {
      if (running) return; running = true;
      try {
        const prefs = win.webContents.getLastWebPreferences();
        assert.equal(prefs.nodeIntegration, false); assert.equal(prefs.contextIsolation, true); assert.equal(prefs.sandbox, true); assert.equal(prefs.webSecurity, true);
        assert(!process.argv.includes('--no-sandbox')); assert(!process.argv.includes('--disable-setuid-sandbox'));
        await fs.writeFile(path.join(context.output, phase + '-host.json'), JSON.stringify({ platform: process.platform, arch: process.arch, pid: process.pid, electron: process.versions.electron, ...context }, null, 2));
        await run(win); await session.defaultSession.flushStorageData();
        const closing = new Promise(resolve => win.once('closed', () => { closed = true; resolve(); }));
        win.close(); await closing; assert(win.isDestroyed());
        await fs.writeFile(path.join(context.output, phase + '-result.json'), JSON.stringify({ passed: true, nativeExecutionPerformed: true, screenshots, events }, null, 2));
        console.log('COMMUNICATION_NATIVE_CLOSED ' + phase); clearTimeout(deadline); allowQuit = true; app.quit();
      } catch (error) {
        console.error(error); clearTimeout(deadline);
        const failureDeadline = setTimeout(() => app.exit(1), 5000);
        try {
          await fs.writeFile(path.join(context.output, phase + '-failure.json'), JSON.stringify({ stage, error: String(error.stack || error), events }, null, 2));
          if (activeWindow && !activeWindow.isDestroyed()) await fs.writeFile(path.join(context.output, phase + '-failure.png'), (await activeWindow.webContents.capturePage()).toPNG());
        } finally { clearTimeout(failureDeadline); app.exit(1); }
      }
    });
  });
  require(path.join(context.application, 'desktop/main.cjs'));
}
let closed = true, nativeProcessesStarted = 0;
try {
  await writeFile(harness, '(' + installNativeRunner.toString() + ')(' + JSON.stringify(context) + ',' + captureWithReadiness.toString() + ',' + waitForCaptureFrames.toString() + ');\n');
  const harnessSha256 = createHash('sha256').update(await readFile(harness)).digest('hex');
  const prepared = { ...context, harness, harnessSha256, phases, nativeExecutionPerformed: false, sandboxBypassFlags: [], excludedCoverage: ['Screenshots require visual inspection.', 'This validates UI/isolation, not learned survival benefit.'] };
  await writeFile(join(output, 'prepared.json'), JSON.stringify(prepared, null, 2));
  if (prepareOnly) console.log(JSON.stringify(prepared));
  else {
    const electron = createRequire(import.meta.url)('electron');
    for (const phase of phases) {
      const flags = [harness, '--test', '--test-profile=' + profile, '--phase=' + phase];
      if (process.platform === 'linux') flags.push('--disable-gpu');
      const env = { ...process.env, TMPDIR: temporary, TMP: temporary, TEMP: temporary, HOME: join(temporary, 'home'), XDG_CONFIG_HOME: join(temporary, 'config'), XDG_CACHE_HOME: join(temporary, 'cache') }; delete env.ELECTRON_RUN_AS_NODE;
      closed = false;
      const result = await captureNativeChild(spawn, electron, flags, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env }, bytes => process.stdout.write(bytes), bytes => process.stderr.write(bytes));
      closed = true; if (!result.spawnError) nativeProcessesStarted++;
      await writeFile(join(output, phase + '-stdout.txt'), result.stdout); await writeFile(join(output, phase + '-stderr.txt'), result.stderr);
      await writeFile(join(output, phase + '-process.json'), JSON.stringify({ code: result.code, signal: result.signal, spawnError: String(result.spawnError || ''), processCloseObserved: true }, null, 2));
      if (result.spawnError) throw result.spawnError;
      assert.equal(result.code, 0); assert.equal(result.signal, null);
      assert(result.stdout.includes('COMMUNICATION_NATIVE_CLOSED ' + phase)); assert(result.stdout.includes('COMMUNICATION_NATIVE_WILL_QUIT ' + phase));
    }
    const processIds = await Promise.all(phases.map(async phase => JSON.parse(await readFile(join(output, phase + '-host.json'), 'utf8')).pid));
    assert.equal(new Set(processIds).size, phases.length);
    const result = { passed: true, nativeExecutionPerformed: true, ...context, harnessSha256, processIds, phases, exactOrdinaryBytesPreservedAfterIndependentReopen: true, visualInspection: 'required', excludedCoverage: prepared.excludedCoverage };
    await writeFile(join(output, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
  }
} finally {
  if (closed) {
    const archive = await archiveNativeProfile(profile, join(output, 'profile-evidence'));
    await writeFile(join(output, 'profile-evidence.json'), JSON.stringify({ archive, nativeExecutionPerformed: nativeProcessesStarted > 0, copiedAfterProcessesClosed: nativeProcessesStarted > 0 }, null, 2));
    await rm(temporary, { recursive: true, force: true });
  }
}
