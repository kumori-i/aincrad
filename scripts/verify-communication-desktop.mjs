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
// Stored legacy settings cannot reactivate inference in the grounded main world.
await writeFile(join(profile,'agent-model.json'),JSON.stringify({enabled:true,endpoint:'http://127.0.0.1:1/v1',model:'native-no-inference-expected'}));
const application = await canonicalApplicationRoot(output);
const built = await buildApplication(application);
const context = { output, profile, application, sourceIdentity: nativeSourceIdentity(root), sourceFingerprint: built.sourceFingerprint };
const harness = join(output, 'runner.cjs');
const phases = ['exercise', 'reopen', 'reset'];

// Runs in Electron main. Real application owns protocol, profile and security.
function installNativeRunner(context, captureWithReadiness, waitForCaptureFrames) {
  const { app, session, ipcMain } = require('electron');
  const modelRequests={decide:0,name:0};
  const register=ipcMain.handle.bind(ipcMain);
  ipcMain.handle=(channel,handler)=>register(channel,(...args)=>{if(channel==='aincrad:model-decide')modelRequests.decide++;if(channel==='aincrad:model-name')modelRequests.name++;return handler(...args);});
  const assert = require('node:assert/strict');
  const fs = require('node:fs/promises'), path = require('node:path');
  const phase = process.argv.find(arg => arg.startsWith('--phase='))?.slice(8);
  assert(['exercise', 'reopen', 'reset'].includes(phase));
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
    assert.equal(await evaluate(win, "!document.getElementById('npc-panel').classList.contains('hidden') && document.getElementById('npc-panel').dataset.journalTab==='conversation'"), false);
    const beforeBoundary=await evaluate(win,'window.__ozarkWorld.fullSnapshot()');
    const boundary=await evaluate(win,'window.__ozarkWorld.communicationBoundaryProbe()');
    assert.equal(boundary.mode,'grounded');
    for(const attempt of [...boundary.attempts,boundary.human])assert.equal(attempt.code,'LEGACY_LANGUAGE_DISABLED');
    assert.deepEqual(await evaluate(win,'window.__ozarkWorld.fullSnapshot()'),beforeBoundary,'Native main rejects legacy attempts without adopting messages or knowledge');
    const learning = () => evaluate(win, 'window.__ozarkWorld.communicationSnapshot()');
    const disclosure = () => evaluate(win, "document.getElementById('journal-messages').textContent");

    if (phase === 'reset') {
      assert((await learning()).elapsed > 0, 'Reset starts from a real saved running world');
      await evaluate(win, 'window.__ozarkWorld.start();window.__ozarkWorld.pause()');
      await click(win, 'reset-world'); await waitFor(win, "document.getElementById('reset-dialog').open");
      await capture(win, 'reset-confirmation.png');
      await evaluate(win, "document.getElementById('reset-acknowledge').checked=true;document.getElementById('reset-acknowledge').dispatchEvent(new Event('change'))");
      let timer, listener;
      const reloaded = new Promise(resolve => { listener = resolve; win.webContents.once('did-finish-load', listener); });
      try {
        await click(win, 'reset-confirm').catch(error => {
          // A successful reset can destroy this evaluation context before it resolves.
          // Still require the independently observed did-finish-load below.
          if (!/context|destroyed|navigation/i.test(error.message)) throw error;
        });
        await Promise.race([reloaded, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Reset reload timed out')), 60000); })]);
      } finally { clearTimeout(timer); win.webContents.removeListener('did-finish-load', listener); }
      await waitFor(win, 'Boolean(window.__ozarkWorld)');
      const world = await evaluate(win, 'window.__ozarkWorld.fullSnapshot()');
      assert.equal(world.elapsed, 0, 'Explicit reset creates fresh ordinary world');
      for (const agent of world.agents) { assert.equal(agent.elapsed, 0); assert.equal(agent.discovery.experiments.length, 0); assert.equal(agent.discovery.effects.length, 0); }
      const fresh = await learning(); assert(fresh);
      assert.equal(fresh.elapsed, 0); assert.equal(fresh.exchanges, 0); assert.equal(fresh.updates, 0); assert.equal(fresh.pending, 0, 'Reset clears communication pending credit');
      for (const learner of fresh.learners) assert.deepEqual(learner.current, learner.initial, 'Reset creates fresh communication model fingerprints');
      await evaluate(win, 'window.__ozarkWorld.start();window.__ozarkWorld.pause()');
      await click(win, 'open-communication');
      await capture(win, 'reset-fresh-inspector.png');
      await fs.writeFile(path.join(context.output, 'reset-checkpoint.json'), JSON.stringify({ world, learning: fresh }, null, 2));
      return;
    }
    if (phase === 'reopen') {
      const previous = JSON.parse(await fs.readFile(path.join(context.output, 'ordinary-checkpoint.json'), 'utf8'));
      assert.equal(await raw(win), previous.raw, 'Independent reopen preserves exact ordinary bytes');
      assert.equal(await evaluate(win, 'window.__ozarkWorld.snapshot().started'), false);
      const fresh = await learning(); assert(fresh, 'Main-world learner attaches before start');
      assert.equal(fresh.elapsed, previous.learning.elapsed, 'Main clock resumes saved time, not experiment time');
      assert.equal(fresh.exchanges, 0); assert.equal(fresh.updates, 0); assert.equal(fresh.pending, 0);
      for (const learner of fresh.learners) assert.deepEqual(learner.current, learner.initial, 'Communication weights restart without old traces');
      await evaluate(win, 'window.__ozarkWorld.start();window.__ozarkWorld.pause()');
      await click(win, 'open-communication'); await waitFor(win, "!document.getElementById('npc-panel').classList.contains('hidden') && document.getElementById('npc-panel').dataset.journalTab==='conversation'");
      assert.match(await disclosure(), /Communication weights restart on app reopen/);
      await capture(win, 'independent-reopen.png'); return;
    }
    assert.equal(await raw(win), null, 'Disposable profile starts empty');
    await evaluate(win, 'window.__ozarkWorld.start();window.__ozarkWorld.pause();window.__ozarkWorld.save()');
    const before = await raw(win); assert(before && JSON.parse(before));
    const ordinary = await evaluate(win, 'window.__ozarkWorld.snapshot()'); assert(ordinary.paused);
    const beforeLearning = await learning(); assert(beforeLearning);
    await click(win, 'open-communication'); await waitFor(win, "!document.getElementById('npc-panel').classList.contains('hidden') && document.getElementById('npc-panel').dataset.journalTab==='conversation'");
    assert.deepEqual(await learning(), beforeLearning, 'Opening inspector preserves pending credit, RNG and models');
    assert.match(await disclosure(), /Bodies and memories save locally.*Communication weights restart on app reopen/);
    assert.equal(await evaluate(win, "document.getElementById('journal-form').classList.contains('hidden')"), true);
    assert.equal(await evaluate(win, "document.getElementById('communication-dialog').open"), false, 'Shortcut uses the same NPC panel, not a second modal');
    await evaluate(win, "document.querySelector('#journal-messages [data-learning-diagnostics] summary').click()");
    assert.equal(await evaluate(win, "document.querySelector('#journal-messages [data-learning-diagnostics]').open"),true);
    await delay(1200);
    assert.equal(await evaluate(win, "document.querySelector('#journal-messages [data-learning-diagnostics]').open"),true,'Same-tab diagnostics stays expanded across observer refreshes');
    await capture(win, 'ready.png');
    escape(win);
    await waitFor(win, "!window.__ozarkWorld.snapshot().paused");
    await waitFor(win, "window.__ozarkWorld.snapshot().elapsed>=2");
    assert.equal(await evaluate(win, "document.querySelector('#journal-messages [data-learning-diagnostics]').open"),true,'Running main-world updates preserve expanded diagnostics');
    await capture(win, 'running.png');
    // Cross the normal autosave interval while the one real world advances.
    await delay(10500);
    assert.notEqual(await raw(win), before, 'Inspector does not suppress ordinary autosave writes');
    const running = await evaluate(win, 'window.__ozarkWorld.snapshot()');
    assert(running.elapsed > ordinary.elapsed, 'Main world advances while inspector is open');
    assert(await evaluate(win, 'window.__ozarkWorld.communicationSnapshot().elapsed === window.__ozarkWorld.snapshot().elapsed'), 'Inspector and world report the same clock');
    escape(win); await waitFor(win, "window.__ozarkWorld.snapshot().paused");
    await delay(350); const frozen = await evaluate(win, 'window.__ozarkWorld.snapshot().elapsed');
    await delay(1000); assert.equal(await evaluate(win, 'window.__ozarkWorld.snapshot().elapsed'), frozen);
    assert.equal(await evaluate(win, 'window.__ozarkWorld.snapshot().paused'), true, 'Native Escape pauses the one main world');
    await click(win, 'open-communication');
    const retained = await learning();
    await evaluate(win, "document.getElementById('npc-select').value='mira';document.getElementById('npc-select').dispatchEvent(new Event('change'))");
    assert.deepEqual(await learning(), retained, 'Follow selection cannot change learning');
    assert.equal(await evaluate(win, 'window.__ozarkWorld.save()'), true, 'Normal save works while inspector is open');
    const checkpoint = await raw(win);
    await click(win, 'close-npc');
    assert.equal(await evaluate(win, "!document.getElementById('npc-panel').classList.contains('hidden') && document.getElementById('npc-panel').dataset.journalTab==='conversation'"), false);
    assert.equal(await evaluate(win, 'window.__ozarkWorld.snapshot().paused'), true);
    assert.deepEqual(await learning(), retained, 'Closing inspector preserves main learners');
    await capture(win, 'closed-to-world-pause.png');
    for (let i = 0; i < 2; i++) {
      await click(win, 'open-communication');
      assert.deepEqual(await learning(), retained, 'Inspector reopen retains learning rather than creating agents');
      await click(win, 'close-npc');
    }
    await click(win, 'open-communication');
    assert.equal(await raw(win), checkpoint, 'Paused inspector leaves the ordinary save unchanged');
    await fs.writeFile(path.join(context.output, 'ordinary-checkpoint.json'), JSON.stringify({ raw: checkpoint, learning: retained, ordinary: await evaluate(win, 'window.__ozarkWorld.snapshot()') }, null, 2));
    await capture(win, 'paused-inspector-before-close.png');
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
        await run(win); assert.deepEqual(modelRequests,{decide:0,name:0},'Main never requests legacy model dialogue or naming'); await session.defaultSession.flushStorageData();
        const closing = new Promise(resolve => win.once('closed', () => { closed = true; resolve(); }));
        win.close(); await closing; assert(win.isDestroyed());
        await fs.writeFile(path.join(context.output, phase + '-result.json'), JSON.stringify({ passed: true, nativeExecutionPerformed: true, modelRequests, screenshots, events }, null, 2));
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
  const prepared = { ...context, harness, harnessSha256, phases, nativeExecutionPerformed: false, sandboxBypassFlags: [], excludedCoverage: ['Screenshots require visual inspection.', 'This validates main-world inspector integration and save behavior, not learned survival benefit.'] };
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
    const result = { passed: true, nativeExecutionPerformed: true, ...context, harnessSha256, processIds, phases, exactOrdinaryBytesPreservedAfterIndependentReopen: true, explicitResetVerified: true, visualInspection: 'required', excludedCoverage: prepared.excludedCoverage };
    await writeFile(join(output, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
  }
} finally {
  if (closed) {
    const archive = await archiveNativeProfile(profile, join(output, 'profile-evidence'));
    await writeFile(join(output, 'profile-evidence.json'), JSON.stringify({ archive, nativeExecutionPerformed: nativeProcessesStarted > 0, copiedAfterProcessesClosed: nativeProcessesStarted > 0 }, null, 2));
    await rm(temporary, { recursive: true, force: true });
  }
}
