/** Targeted sandboxed three-process structural-departure/save regression.
 * Test-driver movement is physical capability evidence, not learned recovery. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApplication } from './build.mjs';
import { nativeSourceIdentity, captureNativeChild, archiveNativeProfile,
  currentRouteSnapshot, assertCurrentRoute, installEmptyCurrentSlot } from './carcass-native-contract.mjs';
import { createStructuralMovementFixture, structuralMovementEvidence } from './structural-movement-native-fixture.mjs';
import { assertStructuralPlayerStep, assertStructuralRestoredHistory,
  runStructuralPlayerSteps } from './structural-movement-native-contract.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const prepareOnly = process.argv.includes('--prepare-only');
assert.ok(process.argv.slice(2).every(arg => arg === '--prepare-only'), 'Only --prepare-only is supported');
if (!prepareOnly && process.getuid?.() === 0)
  throw new Error('Native movement QA requires an unprivileged runtime; sandbox bypass is prohibited.');
if (!prepareOnly && process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY)
  throw new Error('Native movement QA requires a supported display (CI: Xvfb and a window manager).');
const outputRoot = resolve(process.env.AINCRAD_MOVEMENT_QA_OUTPUT || join(root, 'test-results/structural-movement-desktop'));
await mkdir(outputRoot, { recursive: true });
const output = await mkdtemp(join(outputRoot, 'run-'));
const temporary = await mkdtemp(join(tmpdir(), 'mv-'));
const profile = join(temporary, 'profile');
await mkdir(profile);
const isolated = join(output, 'isolated-state');
for (const name of ['home', 'config', 'cache']) await mkdir(join(isolated, name), { recursive: true });
const built = await buildApplication();
const context = { root, output, profile, sourceIdentity: nativeSourceIdentity(root), sourceFingerprint: built.sourceFingerprint };
const harness = join(output, 'runner.cjs');
let nativeProcessesClosed = true, nativeProcessesStarted = 0;
try {
  await writeFile(harness, `
const { app, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const context = ${JSON.stringify(context)};
const phase = process.argv.find(arg => arg.startsWith('--phase='))?.slice(8);
assert.ok(['write','exercise','verify'].includes(phase));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const currentRouteSnapshot = ${currentRouteSnapshot.toString()};
const assertCurrentRoute = ${assertCurrentRoute.toString()};
const installEmptyCurrentSlot = ${installEmptyCurrentSlot.toString()};
const evidence = ${structuralMovementEvidence.toString()};
const assertStep = ${assertStructuralPlayerStep.toString()};
const assertHistory = ${assertStructuralRestoredHistory.toString()};
let running = false, closeObserved = false, allowQuit = false;
const closeEvents = [], rendererEvents = [];
const deadline = setTimeout(() => { console.error('Structural native QA timed out: ' + phase); app.exit(1); }, 300000);
app.on('will-quit', event => {
  if (!allowQuit) { event.preventDefault(); return; }
  if (!closeObserved) process.exitCode = 1;
  else console.log('MOVEMENT_NATIVE_WILL_QUIT ' + phase);
});
async function waitFor(win, expression) {
  for (let i = 0; i < 600; i++) {
    try { if (await win.webContents.executeJavaScript(expression)) return; } catch {}
    await delay(50);
  }
  throw new Error('Missing native condition: ' + expression);
}
async function capture(win, name) {
  await waitFor(win, 'window.__ozarkWorld.detailReady()');
  await delay(100);
  const image = await win.webContents.capturePage(), png = image.toPNG();
  assert.ok(png.length > 10000, 'Actual native world screenshot must be nonempty');
  await fs.writeFile(path.join(context.output, name), png);
  return {file:name,bytes:png.length,...image.getSize()};
}
const snapshot = win => win.webContents.executeJavaScript('(' + evidence.toString() + ')(window.__ozarkWorld.fullSnapshot())');
async function startPaused(win) {
  const before = await snapshot(win);
  assert.equal(await win.webContents.executeJavaScript("window.__ozarkWorld.start(); window.__ozarkWorld.pause(); window.__ozarkWorld.preview(null); document.getElementById('pause-panel').classList.add('hidden'); window.__ozarkWorld.snapshot().paused"), true);
  assert.deepEqual(await snapshot(win), before, 'Starting, pausing and camera framing cannot advance the fixture');
}
async function writePhase(win) {
  assert.equal(await win.webContents.executeJavaScript("localStorage.getItem('aincrad.world.v2')"), null);
  const fixture = await win.webContents.executeJavaScript('(' + ${JSON.stringify(createStructuralMovementFixture.toString())} + ')(document.baseURI)');
  const stored = JSON.parse(fixture.raw);
  assert.deepEqual(stored.player, fixture.summary.oldCoordinate);
  assert.equal(fixture.summary.failedReceipt.details.result.code, 'ROUTE_BLOCKED');
  assert.ok(fixture.summary.partialPaidSeconds > 0);
  assert.equal(stored.agents.find(actor => actor.id === fixture.summary.pendingActorId).interrupted, true);
  await win.webContents.executeJavaScript('(' + installEmptyCurrentSlot.toString() + ')(localStorage,' + JSON.stringify({key:fixture.saveKey,inputRaw:fixture.raw}) + ')');
  await fs.writeFile(path.join(context.output, 'checkpoint.json'), JSON.stringify(fixture, null, 2));
  await session.defaultSession.flushStorageData();
}
async function exercisePhase(win) {
  const fixture = JSON.parse(await fs.readFile(path.join(context.output, 'checkpoint.json'), 'utf8'));
  const bytes = await win.webContents.executeJavaScript("localStorage.getItem('aincrad.world.v2')");
  assert.equal(bytes, fixture.raw, 'Independent process must read exact original disk bytes');
  const restored = await snapshot(win);
  assert.deepEqual(restored, fixture.expectedRestored, 'Native restore must preserve exact player, clocks, body and history');
  assertHistory(JSON.parse(bytes), restored);
  await startPaused(win);
  const screenshots = [await capture(win, '01-restored-old-coordinate.png')];
  assert.deepEqual(await snapshot(win), restored, 'Before rendering is read-only');
  const blocked = await win.webContents.executeJavaScript('(' + ${JSON.stringify(runStructuralPlayerSteps.toString())} + ')(1,1)');
  assert.equal(blocked.length, 1); assertStep(blocked[0], 1, 0);
  const retreat = await win.webContents.executeJavaScript('(' + ${JSON.stringify(runStructuralPlayerSteps.toString())} + ')(-1,1)');
  assert.equal(retreat.length, 1); assertStep(retreat[0], -1, 2.5);
  await win.webContents.executeJavaScript("document.getElementById('pause-panel').classList.add('hidden'); window.__ozarkWorld.preview(null)");
  const firstRetreat = await snapshot(win);
  screenshots.push(await capture(win, '02-paid-one-frame-retreat.png'));
  assert.deepEqual(await snapshot(win), firstRetreat, 'After rendering is read-only');
  // Eleven further ordinary frames make the same paid retreat visible at
  // normal world scale. No position assignment or shortcut is involved.
  const continued = await win.webContents.executeJavaScript('(' + ${JSON.stringify(runStructuralPlayerSteps.toString())} + ')(-1,11)');
  assert.equal(continued.length, 11); for (const step of continued) assertStep(step, -1, 2.5);
  await win.webContents.executeJavaScript("document.getElementById('pause-panel').classList.add('hidden'); window.__ozarkWorld.preview(null)");
  const after = await snapshot(win);
  assert.ok(Math.abs(after.player.x - (fixture.summary.oldCoordinate.x - 30)) < 1e-9);
  assert.ok(Math.abs(after.elapsed - restored.elapsed - 13 / 60) < 1e-9);
  screenshots.push(await capture(win, '03-paid-twelve-frame-retreat.png'));
  assert.deepEqual(await snapshot(win), after, 'Paused checkpoint rendering cannot advance clocks or evidence');
  assert.equal(await win.webContents.executeJavaScript('window.__ozarkWorld.save()'), true);
  const saved = await win.webContents.executeJavaScript('(' + (async function (project) {
    const {loadOzarkSave} = await import('./src/ozark-save.js');
    const {createOzarkWorldGeometry} = await import('./src/ozark-world-geometry.js');
    const raw = localStorage.getItem('aincrad.world.v2');
    const loaded = loadOzarkSave({getItem:key=>key==='aincrad.world.v2'?raw:null}, createOzarkWorldGeometry());
    if (loaded.blocked) throw new Error(loaded.error);
    return {raw,expectedRestored:project(loaded.state)};
  }).toString() + ')(' + evidence.toString() + ')');
  await fs.writeFile(path.join(context.output, 'after-checkpoint.json'), JSON.stringify({
    ...saved,after,restored,blocked,retreat,continued,screenshots,fixtureDisclosure:fixture.summary.fixtureDisclosure}, null, 2));
  await session.defaultSession.flushStorageData();
}
async function verifyPhase(win) {
  const expected = JSON.parse(await fs.readFile(path.join(context.output, 'after-checkpoint.json'), 'utf8'));
  const bytes = await win.webContents.executeJavaScript("localStorage.getItem('aincrad.world.v2')");
  assert.equal(bytes, expected.raw, 'Third process must read exact saved-after-retreat bytes');
  const restored = await snapshot(win);
  assert.deepEqual(restored, expected.expectedRestored);
  assertHistory(JSON.parse(bytes), restored);
  assert.deepEqual(restored.player, expected.after.player);
  assert.equal(restored.elapsed, expected.after.elapsed, 'No closed-time progression');
  await startPaused(win);
  const screenshot = await capture(win, '04-independently-reopened-retreat.png');
  assert.deepEqual(await snapshot(win), restored, 'Reopened render must remain read-only');
  await fs.writeFile(path.join(context.output, 'result.json'), JSON.stringify({passed:true,
    nativeExecutionPerformed:false,sourceIdentity:context.sourceIdentity,sourceFingerprint:context.sourceFingerprint,
    exactOldCoordinateRestored:true,paidTowardTrunkBlocked:true,ordinaryOneFrameRetreat:2.5,
    twelveFrameRetreat:30,totalPaidSeconds:13/60,exactSavedAfterRetreatRestored:true,
    exactClocksAndExistingHistory:true,unfinishedMovesCancelledWithoutCompletion:true,
    noClosedTimeProgression:true,readOnlyBeforeAfterRendering:true,
    screenshots:[...expected.screenshots,screenshot],fixtureDisclosure:expected.fixtureDisclosure,
    scope:'Controlled physical movement and disk persistence only; not learned recovery or the earlier changed-controller-trajectory trial.'},null,2));
}
async function closeNormally(win) {
  if (await win.webContents.executeJavaScript('window.__ozarkWorld.snapshot().started'))
    assert.equal(await win.webContents.executeJavaScript('window.__ozarkWorld.save()'), true);
  await session.defaultSession.flushStorageData(); await delay(250);
  const closed = new Promise(resolve => win.once('closed', () => {
    closeObserved = true; closeEvents.push('closed'); resolve();
  }));
  win.once('close', () => closeEvents.push('close')); win.close(); await closed;
  assert.deepEqual(closeEvents, ['close','closed']); assert.equal(win.isDestroyed(), true);
  await fs.writeFile(path.join(context.output, phase+'-close.json'), JSON.stringify({phase,events:closeEvents,destroyed:true},null,2));
  console.log('MOVEMENT_NATIVE_CLOSED '+phase);
  clearTimeout(deadline); allowQuit = true; app.quit();
}
app.on('browser-window-created', (_event, win) => {
  win.webContents.on('console-message', (_event,...details) => rendererEvents.push({kind:'console',details}));
  win.webContents.on('did-fail-load', (_event,...details) => rendererEvents.push({kind:'load-failure',details}));
  win.webContents.on('render-process-gone', (_event,details) => rendererEvents.push({kind:'renderer-gone',details}));
  win.webContents.once('did-finish-load', async () => {
    if (running) return; running = true;
    try {
      const prefs = win.webContents.getLastWebPreferences();
      assert.equal(prefs.nodeIntegration,false); assert.equal(prefs.contextIsolation,true);
      assert.equal(prefs.sandbox,true); assert.equal(prefs.webSecurity,true);
      assert.equal(process.argv.includes('--no-sandbox'),false);
      assert.equal(process.argv.includes('--disable-setuid-sandbox'),false);
      await fs.writeFile(path.join(context.output,phase+'-sandbox.json'),JSON.stringify({
        sourceIdentity:context.sourceIdentity,platform:process.platform,arch:process.arch,electron:process.versions.electron,pid:process.pid,
        nodeIntegration:prefs.nodeIntegration,contextIsolation:prefs.contextIsolation,sandbox:prefs.sandbox,webSecurity:prefs.webSecurity},null,2));
      await waitFor(win,'Boolean(window.__ozarkWorld)');
      assertCurrentRoute(await win.webContents.executeJavaScript('('+currentRouteSnapshot.toString()+')(window,document)'));
      assert.equal(await win.webContents.executeJavaScript("import('./src/build-info.js').then(module=>module.BUILD_SOURCE_FINGERPRINT)"),context.sourceFingerprint);
      await ({write:writePhase,exercise:exercisePhase,verify:verifyPhase}[phase])(win);
      await closeNormally(win);
    } catch (error) {
      console.error(error); const failure={phase,error:String(error?.stack||error),rendererEvents};
      try { failure.url=win.webContents.getURL(); await fs.writeFile(path.join(context.output,phase+'-failure.png'),(await win.webContents.capturePage()).toPNG()); }
      catch (captureError) { failure.captureError=String(captureError); }
      await fs.writeFile(path.join(context.output,phase+'-failure.json'),JSON.stringify(failure,null,2));
      clearTimeout(deadline); app.exit(1);
    }
  });
});
// Production scheme registration must remain synchronous, before app ready.
require(path.join(context.root,'dist/desktop/main.cjs'));
`);
  await writeFile(join(output,'prepared.json'),JSON.stringify({output,harness,sourceIdentity:context.sourceIdentity,
    sourceFingerprint:built.sourceFingerprint,nativeExecutionPerformed:false,sandboxBypassFlags:[],phases:['write','exercise','verify']},null,2));
  if (prepareOnly) console.log(JSON.stringify({output,harness,nativeExecutionPerformed:false}));
  else {
    const electron = createRequire(import.meta.url)('electron');
    for (const phase of ['write','exercise','verify']) {
      const flags=[harness,'--test',`--test-profile=${profile}`,`--phase=${phase}`];
      if (process.platform === 'linux') flags.push('--disable-gpu');
      const env={...process.env,TMPDIR:temporary,TMP:temporary,TEMP:temporary,HOME:join(isolated,'home'),
        XDG_CONFIG_HOME:join(isolated,'config'),XDG_CACHE_HOME:join(isolated,'cache')}; delete env.ELECTRON_RUN_AS_NODE;
      nativeProcessesClosed=false;
      const result=await captureNativeChild(spawn,electron,flags,{cwd:root,stdio:['ignore','pipe','pipe'],env},
        bytes=>process.stdout.write(bytes),bytes=>process.stderr.write(bytes));
      nativeProcessesClosed=true; if(!result.spawnError) nativeProcessesStarted++;
      await writeFile(join(output,phase+'-process.json'),JSON.stringify({code:result.code,signal:result.signal,
        spawnError:result.spawnError?String(result.spawnError):null,processCloseObserved:true},null,2));
      await writeFile(join(output,phase+'-stdout.txt'),result.stdout);
      await writeFile(join(output,phase+'-stderr.txt'),result.stderr);
      if(result.spawnError) throw result.spawnError;
      assert.deepEqual({code:result.code,signal:result.signal},{code:0,signal:null},`Native ${phase} failed; evidence: ${output}`);
      assert.ok(result.stdout.includes('MOVEMENT_NATIVE_CLOSED '+phase));
      assert.ok(result.stdout.includes('MOVEMENT_NATIVE_WILL_QUIT '+phase));
    }
    const processIds = await Promise.all(['write','exercise','verify'].map(async phase =>
      JSON.parse(await readFile(join(output,phase+'-sandbox.json'),'utf8')).pid));
    assert.ok(processIds.every(pid=>Number.isInteger(pid)&&pid>0));
    assert.equal(new Set(processIds).size,3,'Each save/reopen phase must run in an independent Electron process');
    const report=JSON.parse(await readFile(join(output,'result.json'),'utf8'));
    Object.assign(report,{nativeExecutionPerformed:true,threeIndependentElectronProcesses:true,processIds,
      actualNativeCloseEvents:true,actualNativeWillQuitEvents:true});
    await writeFile(join(output,'result.json'),JSON.stringify(report,null,2)); console.log(JSON.stringify(report));
  }
} finally {
  let preserved=false;
  if(nativeProcessesClosed) try {
    const archive=await archiveNativeProfile(profile,join(output,'profile-evidence'));
    await writeFile(join(output,'profile-evidence.json'),JSON.stringify({runtimeProfile:profile,
      copiedAfterProcessesClosed:nativeProcessesStarted>0,nativeExecutionPerformed:nativeProcessesStarted>0,archive},null,2));
    preserved=true;
  } catch(error) { console.error('Profile preservation failed; original retained at '+temporary,error); process.exitCode=1; }
  if(preserved) await rm(temporary,{recursive:true,force:true,maxRetries:3,retryDelay:100}).catch(error=>{
    console.error('Disposable profile cleanup failed: '+temporary,error); process.exitCode=1;
  });
}
