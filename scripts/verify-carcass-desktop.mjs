/** Actual sandboxed Electron disk close/reopen for three explicit synthetic
 * carcass checkpoints. Never launch against a real profile. --prepare-only
 * builds/checks inputs and writes the native runner without launching it.
 * Native execution must occur in a supported environment, not as a workaround
 * for a prior socket or sandbox denial. No --no-sandbox fallback is provided. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApplication } from './build.mjs';
import { createCarcassDiskFixture } from '../tests/fixtures/carcass-encounter.mjs';
import { canonicalApplicationRoot, captureNativeChild, archiveNativeProfile, installEmptySlots, ordinaryRouteSnapshot, assertOrdinaryRoute } from './carcass-native-contract.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2), prepareOnly = args.includes('--prepare-only');
const flags = args.filter(arg => arg !== '--prepare-only');
assert.ok(flags.length === 0 || flags.length === 2 && flags[0] === '--output',
  'Usage: node scripts/verify-carcass-desktop.mjs [--prepare-only] [--output <directory>]');
const scratch = await mkdtemp(join(tmpdir(), 'ac-h1-'));
const output = flags.length ? resolve(flags[1]) : join(scratch, 'evidence');
await mkdir(output, { recursive: true });
const requestedAppRoot = join(scratch, 'app');
const appRoot = await canonicalApplicationRoot(scratch), built = await buildApplication(appRoot);
const fixturePaths = {};
for (const stage of ['relation', 'pulled', 'processing']) {
  const fixture = createCarcassDiskFixture(stage);
  fixturePaths[stage] = join(scratch, `${stage}.json`);
  await writeFile(fixturePaths[stage], JSON.stringify(fixture));
  await writeFile(join(output, `${stage}-fixture.json`), JSON.stringify(fixture, null, 2) + '\n');
  await writeFile(join(output, `${stage}-input-save.json`), fixture.raw + '\n');
}
const context = { root, scratch, output, requestedAppRoot, appRoot, fixturePaths,
  sourceFingerprint: built.sourceFingerprint };
const harness = join(scratch, 'run.cjs');
await writeFile(harness, `
const { app, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const context = ${JSON.stringify(context)};
const phase = process.argv.find(arg => arg.startsWith('--phase='))?.slice(8);
const stage = process.argv.find(arg => arg.startsWith('--stage='))?.slice(8);
const digest = raw => createHash('sha256').update(raw).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const oldKey = 'aincrad.save.v1', key = 'aincrad.ozark.v1';
const oldSentinel = JSON.stringify({ syntheticH1OriginalSlot: 'preserve-exactly' });
let running = false, closeObserved = false, allowQuit = false;
const events = [], rendererEvents = [];
const installEmptySlots = ${installEmptySlots.toString()};
const ordinaryRouteSnapshot = ${ordinaryRouteSnapshot.toString()};
const assertOrdinaryRoute = ${assertOrdinaryRoute.toString()};
const timeout = setTimeout(() => {
  console.error('Carcass native QA timed out: ' + stage + '/' + phase);
  app.exit(1);
}, 120000);
app.on('will-quit', event => {
  // The production window-all-closed handler may request quit immediately.
  // Finish durable close-event evidence first, then explicitly permit quit.
  if (!allowQuit) { event.preventDefault(); return; }
  if (!closeObserved) { console.error('Missing actual window closed event'); process.exitCode = 1; }
  else console.log('H1_NATIVE_WILL_QUIT ' + stage + '/' + phase);
});

async function captureFailure(win, error) {
  const evidence = { stage, phase, error: String(error?.stack || error),
    url: win.webContents.getURL(), rendererEvents, appPathEvidence };
  try { evidence.document = await win.webContents.executeJavaScript(
    '({url:location.href,title:document.title,text:document.body?.innerText?.slice(0,12000),' +
    'playHook:Boolean(window.__aincrad),ozarkHook:Boolean(window.__ozarkWorld)})'); }
  catch (failure) { evidence.documentError = String(failure); }
  try { evidence.ordinary = await win.webContents.executeJavaScript(
    '(' + ordinaryRouteSnapshot.toString() + ')(window,document)'); }
  catch (failure) { evidence.ordinaryError = String(failure); }
  await fs.writeFile(path.join(context.output, stage + '-' + phase + '-failure.json'),
    JSON.stringify(evidence, null, 2));
  try { await fs.writeFile(path.join(context.output, stage + '-' + phase + '-failure.png'),
    (await win.webContents.capturePage()).toPNG()); } catch {}
}

async function waitFor(win, expression, label) {
  for (let i = 0; i < 400; i++) {
    try { if (await win.webContents.executeJavaScript(expression)) return; }
    catch { /* Deliberate native route navigation replaces the old frame. */ }
    await delay(50);
  }
  throw new Error('Timed out waiting for ' + label);
}

async function closeNormally(win) {
  await session.defaultSession.flushStorageData();
  await delay(250);
  const closed = new Promise(resolve => win.once('closed', () => {
    closeObserved = true; events.push('closed'); resolve();
  }));
  win.once('close', () => events.push('close'));
  win.close();
  await closed;
  assert.deepEqual(events, ['close', 'closed'], 'Actual native close and closed events must occur');
  assert.equal(win.isDestroyed(), true);
  await fs.writeFile(path.join(context.output, stage + '-' + phase + '-close.json'),
    JSON.stringify({ events, destroyed: win.isDestroyed(), phase, stage }, null, 2));
  console.log('H1_NATIVE_CLOSED ' + stage + '/' + phase);
  clearTimeout(timeout); allowQuit = true; app.quit();
}

app.on('browser-window-created', (_event, win) => {
  win.webContents.on('console-message', (_event, ...details) => {
    rendererEvents.push({ kind: 'console', details });
  });
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    rendererEvents.push({ kind: 'load-failure', errorCode, errorDescription, validatedURL });
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    rendererEvents.push({ kind: 'renderer-gone', details });
  });
  win.webContents.on('did-finish-load', async () => {
    if (running) return; running = true;
    try {
      const prefs = win.webContents.getLastWebPreferences();
      assert.equal(prefs.nodeIntegration, false);
      assert.equal(prefs.contextIsolation, true);
      assert.equal(prefs.sandbox, true);
      assert.equal(prefs.webSecurity, true);
      assert.equal(process.argv.includes('--no-sandbox'), false);
      assert.equal(process.argv.includes('--disable-setuid-sandbox'), false);
      await waitFor(win, 'Boolean(window.__aincrad) || ' +
        '(document.getElementById(\"recovery-panel\") && ' +
        '!document.getElementById(\"recovery-panel\").classList.contains(\"hidden\") && ' +
        'Boolean(document.getElementById(\"recovery-diagnosis\")?.textContent))',
        'ordinary bootstrap or protected recovery');
      const ordinary = await win.webContents.executeJavaScript(
        '(' + ordinaryRouteSnapshot.toString() + ')(window,document)');
      assertOrdinaryRoute(ordinary, phase);
      await fs.writeFile(path.join(context.output, stage + '-' + phase + '-ordinary-boot.json'),
        JSON.stringify(ordinary, null, 2));
      assert.match(win.webContents.getURL(), /^aincrad:\\/\\/app\\/index\\.html\\?test=1$/);
      const fixture = JSON.parse(await fs.readFile(context.fixturePaths[stage], 'utf8'));
      if (phase === 'write') {
        // Processing starts from the valid completed-relation save, then does
        // real paid timed handling inside this sandboxed Electron renderer.
        // A Node-canonicalized interrupted marker alone would be insufficient.
        const inputRaw = stage === 'processing' ? JSON.parse(await fs.readFile(
          context.fixturePaths.relation, 'utf8')).raw : fixture.raw;
        let installed = await win.webContents.executeJavaScript(
          '(' + installEmptySlots.toString() + ')(localStorage,' +
          JSON.stringify({ key, oldKey, oldSentinel, inputRaw }) + ')');
        if (stage === 'processing') {
          const native = await win.webContents.executeJavaScript(
            '(async()=>{' +
            'const {CONFIG}=await import("./src/config.js");' +
            'const {createOzarkWorldGeometry}=await import("./src/ozark-world-geometry.js");' +
            'const {loadOzarkSave,writeOzarkSave,OZARK_SAVE_KEY}=await import("./src/ozark-save.js");' +
            'const {bindOzarkWorldAgent}=await import("./src/ozark-agent-world.js");' +
            'const {requestNpcAction,tickNpc}=await import("./src/npc.js");' +
            'const {tickEnvironment}=await import("./src/environment.js");' +
            'const {processDiscoveryFeedback}=await import("./src/discovery.js");' +
            'const geometry=createOzarkWorldGeometry(),loaded=loadOzarkSave(localStorage,geometry);' +
            'if(loaded.blocked)throw new Error(loaded.error);const state=loaded.state,actor=state.agents[0];' +
            'for(const npc of state.agents)bindOzarkWorldAgent(npc,geometry,state);' +
            'const before=actor.physiology.totals.metabolizedKcal;' +
            'const admission=requestNpcAction(actor,{type:"pull",targetId:' + JSON.stringify(fixture.carcassId) + '},state.environment);' +
            'if(admission.code!=="ACTION_STARTED")throw new Error(JSON.stringify(admission));' +
            'for(let i=0;i<Math.round(.5/CONFIG.fixedStep);i++){' +
            'state.elapsed+=CONFIG.fixedStep;tickEnvironment(state.environment,CONFIG.fixedStep);' +
            'state.environment.ecology.elapsed=state.environment.elapsed;' +
            'for(const npc of state.agents){tickNpc(npc,CONFIG.fixedStep,state.environment);processDiscoveryFeedback(npc);}}' +
            'if(!(actor.active?.worked>0&&actor.active.worked<actor.active.seconds))throw new Error("Native pull was not still active");' +
            'const activeBeforeWrite=structuredClone(actor.active),cost=actor.physiology.totals.metabolizedKcal-before;' +
            'if(!(cost>0))throw new Error("Native active handling was not paid");' +
            'if(!writeOzarkSave(localStorage,state,geometry))throw new Error("Native active checkpoint write failed");' +
            'const raw=localStorage.getItem(OZARK_SAVE_KEY),restored=loadOzarkSave(localStorage,geometry);' +
            'if(restored.blocked)throw new Error(restored.error);' +
            'return {raw,expectedRestored:JSON.parse(JSON.stringify(restored.state)),activeBeforeWrite,cost,admission};})()');
          assert.ok(native.activeBeforeWrite.worked > 0 &&
            native.activeBeforeWrite.worked < native.activeBeforeWrite.seconds);
          assert.ok(native.cost > 0);
          Object.assign(fixture, { raw: native.raw, expectedRestored: native.expectedRestored,
            activeBeforeWrite: native.activeBeforeWrite,
            nativeProcessingPreparation: { admission: native.admission,
              paidMetabolizedKcal: native.cost, workedSeconds: native.activeBeforeWrite.worked,
              preparedInSandboxedElectron: true, ecologyHeldStaticForSyntheticPreparation: true } });
          installed = native.raw;
          await fs.writeFile(context.fixturePaths[stage], JSON.stringify(fixture));
          await fs.writeFile(path.join(context.output, stage + '-fixture.json'), JSON.stringify(fixture, null, 2));
          await fs.writeFile(path.join(context.output, stage + '-input-save.json'), fixture.raw);
          await fs.writeFile(path.join(context.output, stage + '-native-active-work.json'),
            JSON.stringify(fixture.nativeProcessingPreparation, null, 2));
        }
        assert.equal(installed, fixture.raw);
        await fs.writeFile(path.join(context.output, stage + '-write.json'),
          JSON.stringify({ passed: true, installedSha256: digest(installed),
            bytes: installed.length, sourceFingerprint: context.sourceFingerprint,
            fixture: fixture.fixture }, null, 2));
        await closeNormally(win); return;
      }
      assert.equal(phase, 'read');
      const persisted = await win.webContents.executeJavaScript(
        '({raw:localStorage.getItem(' + JSON.stringify(key) + '),old:localStorage.getItem(' + JSON.stringify(oldKey) + ')})');
      assert.equal(persisted.raw, fixture.raw, 'Disk bytes must survive an actual process exit exactly');
      assert.equal(persisted.old, oldSentinel);
      await fs.writeFile(path.join(context.output, stage + '-reopened-save.json'), persisted.raw);
      const navigated = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Native Ozark route did not load')), 30000);
        win.webContents.once('did-finish-load', () => { clearTimeout(timer); resolve(); });
      });
      // The invoking frame can be replaced before its JS promise resolves.
      // Require the actual destination URL/hook below, not that old-frame reply.
      void win.webContents.executeJavaScript("void window.aincradWorld.open('ozark'); true")
        .catch(error => rendererEvents.push({ kind: 'world-switch-frame', error: String(error) }));
      await navigated;
      await waitFor(win, 'Boolean(window.__ozarkWorld)', 'Ozark runtime hook');
      assert.match(win.webContents.getURL(), /^aincrad:\\/\\/app\\/index\\.html\\?test=1&ozarkWorld=1$/);
      const actual = await win.webContents.executeJavaScript('window.__ozarkWorld.snapshot()');
      assert.equal(actual.blocked, false); assert.equal(actual.started, false);
      assert.equal(actual.elapsed, fixture.expectedRestored.elapsed);
      assert.equal(actual.geometryIdentity, fixture.expectedRestored.geometryIdentity);
      assert.deepEqual(actual.player, fixture.expectedRestored.player);
      assert.deepEqual(actual.playerBody, fixture.expectedRestored.playerBody);
      for (const actor of actual.agents) {
        const expected = fixture.expectedRestored.agents.find(row => row.id === actor.id);
        for (const field of ['position', 'elapsed', 'memory', 'discovery', 'physiology'])
          assert.deepEqual(actor[field], expected[field], 'Actual runtime changed ' + actor.id + '/' + field);
      }
      const actor = actual.agents.find(row => row.id === 'aster');
      const strike = actor.memory.experience.find(row => row.id === fixture.strike.id);
      const experiment = actor.discovery.experiments.find(row => row.actionId === fixture.strike.id);
      assert.equal(strike.details.action.targetId, fixture.targetId);
      assert.equal(strike.details.result.resultObjectId, fixture.carcassId);
      assert.equal(experiment.resultObjectId, fixture.carcassId);
      assert.equal(Object.hasOwn(strike.details.result, 'materialId'), false);
      assert.ok(actor.discovery.observations[fixture.carcassId]);
      assert.deepEqual(actor.discovery.techniques, []);
      await delay(600);
      assert.deepEqual(await win.webContents.executeJavaScript('window.__ozarkWorld.snapshot()'), actual,
        'Closed/unstarted time must not advance the checkpoint');
      const checkpoint = await win.webContents.executeJavaScript(
        '(async()=>{const {BUILD_SOURCE_FINGERPRINT}=await import("./src/build-info.js");' +
        'if(!window.__ozarkWorld.start())throw new Error("start failed");' +
        'window.dispatchEvent(new KeyboardEvent("keydown",{code:"Escape"}));' +
        'if(!window.__ozarkWorld.snapshot().paused)throw new Error("pause failed");' +
        'if(!window.__ozarkWorld.save())throw new Error("save failed");' +
        'return {fingerprint:BUILD_SOURCE_FINGERPRINT,snapshot:window.__ozarkWorld.snapshot(),raw:localStorage.getItem(' + JSON.stringify(key) + ')};})()');
      assert.equal(checkpoint.fingerprint, context.sourceFingerprint);
      assert.equal(checkpoint.snapshot.elapsed, actual.elapsed);
      const disk = JSON.parse(checkpoint.raw), expected = fixture.expectedRestored;
      await fs.writeFile(path.join(context.output, stage + '-runtime-checkpoint.json'), checkpoint.raw);
      assert.equal(disk.version, 9); assert.deepEqual(disk.features, { plantLifecycle: 1 });
      assert.deepEqual(disk.environment, expected.environment, 'Finite ecology, clocks, stocks, IDs and ownership must survive the runtime load/save');
      const savedActor = disk.agents.find(row => row.id === 'aster');
      assert.equal(savedActor.active, null);
      const carcass = disk.environment.ecology.materials.find(row => row.id === fixture.carcassId);
      assert.ok(carcass?.massGrams > 0); assert.equal(carcass.heldBy, null);
      const successfulPulls = savedActor.memory.experience.filter(row => row.type === 'action' &&
        row.details.action?.type === 'pull' && row.details.result?.ok);
      if (stage === 'pulled') {
        assert.equal(successfulPulls.length, 1);
        assert.ok(savedActor.inventory.items.includes(fixture.materialId));
        const piece = disk.environment.ecology.materials.find(row => row.id === fixture.materialId);
        assert.equal(piece.heldBy, 'aster'); assert.ok(piece.massGrams > 0);
      } else {
        assert.equal(successfulPulls.length, 0); assert.equal(savedActor.inventory.items.length, 0);
      }
      const interrupted = savedActor.memory.experience.filter(row => row.details.result?.code === 'RESTART_INTERRUPTED');
      assert.equal(interrupted.length, stage === 'processing' ? 1 : 0);
      if (stage === 'processing') {
        assert.ok(fixture.activeBeforeWrite.worked > 0);
        assert.equal(disk.environment.ecology.nextId, fixture.initialNextId + 1,
          'Interrupted work must not allocate the uncompleted piece');
      }
      await delay(600);
      const afterPause = await win.webContents.executeJavaScript('window.__ozarkWorld.snapshot()');
      assert.deepEqual(afterPause.agents, checkpoint.snapshot.agents, 'Paused rendering changes no actor evidence or body');
      assert.equal(afterPause.elapsed, checkpoint.snapshot.elapsed);
      const pausedDisk = await win.webContents.executeJavaScript(
        '(() => { if(!window.__ozarkWorld.save())throw new Error("paused save failed");' +
        'return {raw:localStorage.getItem(' + JSON.stringify(key) + '),old:localStorage.getItem(' + JSON.stringify(oldKey) + ')};})()');
      assert.equal(pausedDisk.old, oldSentinel);
      assert.deepEqual(JSON.parse(pausedDisk.raw), disk,
        'Paused rendering must preserve full stocks, ledger, next ID and actor state, not only counts');
      await fs.writeFile(path.join(context.output, stage + '-paused-save.json'), pausedDisk.raw);
      const png = (await win.webContents.capturePage()).toPNG();
      assert.ok(png.length > 10000, 'Actual Electron screenshot is nonempty');
      await fs.writeFile(path.join(context.output, stage + '.png'), png);
      await fs.writeFile(path.join(context.output, stage + '-read.json'), JSON.stringify({
        passed: true, stage, sourceFingerprint: checkpoint.fingerprint,
        exactDiskBytesAfterClosedProcess: true, actualRuntimeEvidenceEqual: true,
        exactEcologyOnResave: true, noClosedOrPausedProgress: true,
        terminalRelationPreserved: true, originalSlotProtectedOnBoot: true, successfulPulls: successfulPulls.length,
        restartInterruptedReceipts: interrupted.length, sandboxPreserved: true,
        nativeProcessingPreparation: fixture.nativeProcessingPreparation || null,
        screenshotBytes: png.length, rawBeforeSha256: digest(persisted.raw),
        rawAfterSha256: digest(checkpoint.raw), fixture: fixture.fixture,
      }, null, 2));
      await closeNormally(win);
    } catch (error) {
      console.error(error);
      try { await captureFailure(win, error); } catch (failure) { console.error('Failure capture:', failure); }
      clearTimeout(timeout); app.exit(1);
    }
  });
});
// Keep production scheme registration synchronous, before Electron is ready.
// This preflight reports both the requested alias and actual canonical app.
const fsSync = require('node:fs');
const mainPath = require.resolve(path.join(context.appRoot, 'desktop', 'main.cjs'));
const rendererRoot = path.resolve(path.dirname(mainPath), '..', 'renderer');
const requestedMainPath = require.resolve(path.join(context.requestedAppRoot, 'desktop', 'main.cjs'));
const requestedRendererRoot = path.resolve(path.dirname(requestedMainPath), '..', 'renderer');
const assetPath = fsSync.realpathSync.native(path.join(rendererRoot, 'index.html'));
const assetRelative = path.relative(rendererRoot, assetPath);
const requestedAssetRelative = path.relative(requestedRendererRoot, assetPath);
const appPathEvidence = { requestedAppRoot: context.requestedAppRoot, appRoot: context.appRoot,
  mainPath, rendererRoot, assetPath, assetRelative, requestedMainPath,
  requestedRendererRoot, requestedAssetRelative,
  requestedProtocolWouldReject: requestedAssetRelative.startsWith('..'),
  protocolWouldReject: assetRelative.startsWith('..') };
try {
  fsSync.writeFileSync(path.join(context.output, stage + '-' + phase + '-app-path.json'),
    JSON.stringify(appPathEvidence, null, 2));
  assert.equal(appPathEvidence.protocolWouldReject, false,
    'Harness application root must satisfy the unchanged native asset containment guard');
  require(mainPath);
} catch (error) { console.error(error); clearTimeout(timeout); app.exit(1); }
`);
await writeFile(join(output, 'generated-runner.cjs'), await readFile(harness));

const prepared = { status: prepareOnly ? 'prepared-not-executed' : 'pending',
  scratch, output, harness, sourceFingerprint: built.sourceFingerprint,
  syntheticFixtureStages: Object.keys(fixturePaths),
  sandboxBypassFlags: [], nativeExecutionPerformed: false,
  harnessSha256: createHash('sha256').update(await readFile(harness)).digest('hex') };
await writeFile(join(output, 'prepared.json'), JSON.stringify(prepared, null, 2) + '\n');
if (prepareOnly) console.log(JSON.stringify(prepared));
else {
  assert.notEqual(process.getuid?.(), 0,
    'Run Electron as an ordinary user with a working Chromium sandbox; root has no bypass fallback.');
  const electron = createRequire(import.meta.url)('electron');
  for (const stage of Object.keys(fixturePaths)) for (const phase of ['write', 'read']) {
    const profile = join(scratch, 'p-' + Object.keys(fixturePaths).indexOf(stage));
    const launch = [harness, '--test', '--test-profile=' + profile,
      '--stage=' + stage, '--phase=' + phase];
    if (process.platform === 'linux') launch.push('--ozone-platform=headless', '--disable-gpu');
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const { code, signal, stdout, stderr, spawnError } = await captureNativeChild(
      spawn, electron, launch, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env },
      bytes => process.stdout.write(bytes), bytes => process.stderr.write(bytes));
    await writeFile(join(output, stage + '-' + phase + '-process.json'),
      JSON.stringify({ code, signal, spawnError: spawnError ? String(spawnError) : null,
        processCloseObserved: true }, null, 2));
    await writeFile(join(output, stage + '-' + phase + '-stdout.txt'), stdout);
    await writeFile(join(output, stage + '-' + phase + '-stderr.txt'), stderr);
    // Preserve the real synthetic profile only after its process exits, also on
    // failure. Fixtures alone are not evidence of Chromium disk persistence.
    try {
      const archive = await archiveNativeProfile(profile, join(output, stage + '-' + phase + '-profile'));
      await writeFile(join(output, stage + '-' + phase + '-profile-copy.json'), JSON.stringify(archive, null, 2));
    } catch (error) {
      await writeFile(join(output, stage + '-' + phase + '-profile-copy-error.txt'), String(error));
      if (code === 0 && !spawnError) throw error;
    }
    if (spawnError) throw spawnError;
    assert.equal(code, 0, stage + '/' + phase + ' exited unsuccessfully; evidence retained at ' + output);
    assert.ok(stdout.includes('H1_NATIVE_CLOSED ' + stage + '/' + phase));
    assert.ok(stdout.includes('H1_NATIVE_WILL_QUIT ' + stage + '/' + phase));
  }
  const reports = await Promise.all(Object.keys(fixturePaths).map(async stage =>
    JSON.parse(await readFile(join(output, stage + '-read.json'), 'utf8'))));
  const result = { passed: true, nativeExecutionPerformed: true,
    sixIndependentProcesses: true, isolatedProfiles: true, actualCloseEvents: true,
    sourceFingerprint: built.sourceFingerprint, reports };
  await writeFile(join(output, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ passed: true, output,
    sourceFingerprint: built.sourceFingerprint }));
}
