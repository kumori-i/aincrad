/** Targeted sandboxed three-process controller-selected movement recovery/save regression.
 * Controlled first walk; recovery choice must come from the ordinary controller. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApplication } from './build.mjs';
import { captureWithReadiness, waitForCaptureFrames } from './native-capture-readiness.mjs';
import { nativeSourceIdentity, captureNativeChild, archiveNativeProfile,
  currentRouteSnapshot, assertCurrentRoute, installEmptyCurrentSlot } from './carcass-native-contract.mjs';
import { structuralMovementEvidence } from './structural-movement-native-fixture.mjs';
import { createMovementRecoveryScene, presentMovementRecoveryScene, checkMovementRecoveryReload } from './movement-recovery-native-fixture.mjs';
import { assertStructuralRestoredHistory } from './structural-movement-native-contract.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const prepareOnly = process.argv.includes('--prepare-only');
assert.ok(process.argv.slice(2).every(arg => arg === '--prepare-only'), 'Only --prepare-only is supported');
if (!prepareOnly && process.getuid?.() === 0)
  throw new Error('Native movement QA requires an unprivileged runtime; sandbox bypass is prohibited.');
if (!prepareOnly && process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY)
  throw new Error('Native movement QA requires a supported display (CI: Xvfb and a window manager).');
const outputRoot = resolve(process.env.AINCRAD_RECOVERY_QA_OUTPUT || join(root, 'test-results/movement-recovery-desktop'));
await mkdir(outputRoot, { recursive: true });
const output = await mkdtemp(join(outputRoot, 'run-'));
const temporary = await mkdtemp(join(tmpdir(), 'recovery-'));
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
const assertHistory = ${assertStructuralRestoredHistory.toString()};
let running = false, closeObserved = false, allowQuit = false;
const closeEvents = [], rendererEvents = [];
const deadline = setTimeout(() => { console.error('Recovery native QA timed out: ' + phase); app.exit(1); }, 300000);
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
const captureWithReadiness = ${captureWithReadiness.toString()};
async function capture(win, name) {
  const {png,metadata}=await captureWithReadiness({
    prepare:async()=>{
      const readiness=await win.webContents.executeJavaScript('(' + ${JSON.stringify(waitForCaptureFrames.toString())} + ')()');
      await delay(100);return readiness;
    },
    capture:()=>win.webContents.capturePage(),
    retain:async(bytes,attempt)=>{
      const prefix=path.join(context.output,name+'.attempt-'+attempt.attempt);
      if(bytes!==undefined)await fs.writeFile(prefix+'.png',bytes);
      await fs.writeFile(prefix+'.json',JSON.stringify({phase,name,...attempt},null,2));
    },
  });
  assert.ok(png.length>10000,'Actual native world screenshot must be nonempty');
  await fs.writeFile(path.join(context.output,name),png);
  return{file:name,bytes:png.length,width:metadata.width,height:metadata.height,captureAttempts:metadata.attempt};
}
const snapshot = win => win.webContents.executeJavaScript('(' + evidence.toString() + ')(window.__ozarkWorld.fullSnapshot())');
async function startPaused(win) {
  const before = await snapshot(win);
  assert.equal(await win.webContents.executeJavaScript("window.__ozarkWorld.start(); window.__ozarkWorld.pause(); window.__ozarkWorld.preview(null); document.getElementById('pause-panel').classList.add('hidden'); window.__ozarkWorld.snapshot().paused"), true);
  assert.deepEqual(await snapshot(win), before, 'Starting, pausing and camera framing cannot advance the fixture');
}
async function writePhase(win) {
  assert.equal(await win.webContents.executeJavaScript("localStorage.getItem('aincrad.world.v2')"), null);
  const create = 'window.__movementRecoveryScene = await (' + ${JSON.stringify(createMovementRecoveryScene.toString())} + ')(document.baseURI); true';
  const show = async (label,file) => {
    assert.equal((await win.webContents.executeJavaScript('(' + ${JSON.stringify(presentMovementRecoveryScene.toString())} + ')(' + JSON.stringify(label) + ')')).readOnly,true);
    return capture(win,file);
  };
  await win.webContents.executeJavaScript('(async()=>{' + create + '})()');
  const screenshots=[await show('Controlled forest encounter: initial placement, before the first paid walk.','01-before-walk.png')];
  const blocked=await win.webContents.executeJavaScript('window.__movementRecoveryScene.blocked()');
  assert.equal(blocked.failedReceipt.details.result.code,'ROUTE_BLOCKED');
  screenshots.push(await show('Actual paid walk met resistance. No escape has been granted.','02-blocked-walk.png'));
  const admitted=await win.webContents.executeJavaScript('window.__movementRecoveryScene.admit()');
  assert.equal(admitted.decision.details.provider,'discovery-learner');
  assert.equal(admitted.request.duration,.75);
  const completed=await win.webContents.executeJavaScript('window.__movementRecoveryScene.advance()');
  assert.equal(completed.lastResult.code,'ARRIVED');assert.ok(completed.lastResult.distance>9);
  screenshots.push(await show('Controller-selected short retreat: actual paid movement, not guaranteed escape.','03-controller-paid-retreat.png'));
  const success=await win.webContents.executeJavaScript('window.__movementRecoveryScene.save()');
  await fs.writeFile(path.join(context.output,'completed-encounter.json'),JSON.stringify(success,null,2));
  await win.webContents.executeJavaScript('window.__movementRecoveryScene.dispose()');
  await win.webContents.executeJavaScript('(async()=>{' + create + '})()');
  await win.webContents.executeJavaScript('window.__movementRecoveryScene.blocked(); window.__movementRecoveryScene.admit(); window.__movementRecoveryScene.advance({interrupt:true})');
  screenshots.push(await show('Second controlled encounter: controller retreat interrupted after one paid tick.','04-paid-interruption.png'));
  const fixture=await win.webContents.executeJavaScript('window.__movementRecoveryScene.save(localStorage)');
  assert.equal(JSON.parse(fixture.raw).agents[0].interrupted,true);
  assert.ok(fixture.summary.after.agents[0].active.attemptedDistance>0);
  await fs.writeFile(path.join(context.output,'checkpoint.json'),JSON.stringify({...fixture,screenshots},null,2));
  await session.defaultSession.flushStorageData();
}
async function exercisePhase(win) {
  const fixture=JSON.parse(await fs.readFile(path.join(context.output,'checkpoint.json'),'utf8'));
  const bytes=await win.webContents.executeJavaScript("localStorage.getItem('aincrad.world.v2')");
  assert.equal(bytes,fixture.raw,'Independent process must read exact original disk bytes');
  const restored=await snapshot(win);
  assert.deepEqual(restored,fixture.expectedRestored,'Actual app restores exact paid state and one interruption');
  assertHistory(JSON.parse(bytes),restored);
  const replay=await win.webContents.executeJavaScript('(' + ${JSON.stringify(checkMovementRecoveryReload.toString())} + ')(document.baseURI,' + JSON.stringify(bytes) + ',' + JSON.stringify(fixture.summary.recoveryRequest) + ')');
  assert.equal(replay.proposed,null);assert.equal(replay.admission.code,'UNOBSERVED_TARGET');
  assert.deepEqual(await snapshot(win),restored,'Independent admission check cannot mutate actual app state');
  await startPaused(win);await waitFor(win,'window.__ozarkWorld.detailReady()');
  const screenshot=await capture(win,'05-actual-app-reopened-interruption.png');
  assert.deepEqual(await snapshot(win),restored,'Reopened rendering is read-only');
  assert.equal(await win.webContents.executeJavaScript('window.__ozarkWorld.save()'),true);
  const raw=await win.webContents.executeJavaScript("localStorage.getItem('aincrad.world.v2')");
  await fs.writeFile(path.join(context.output,'after-checkpoint.json'),JSON.stringify({raw,expectedRestored:restored,replay,screenshots:[...fixture.screenshots,screenshot],fixtureDisclosure:fixture.summary.fixtureDisclosure},null,2));
  await session.defaultSession.flushStorageData();
}
async function verifyPhase(win) {
  const expected=JSON.parse(await fs.readFile(path.join(context.output,'after-checkpoint.json'),'utf8'));
  const bytes=await win.webContents.executeJavaScript("localStorage.getItem('aincrad.world.v2')");
  assert.equal(bytes,expected.raw,'Third process must read exact saved interruption bytes');
  const restored=await snapshot(win);assert.deepEqual(restored,expected.expectedRestored);
  assertHistory(JSON.parse(bytes),restored);
  assert.equal(restored.agents[0].memory.experience.filter(e=>e.type==='action'&&e.details.result?.code==='RESTART_INTERRUPTED').length,1);
  await startPaused(win);await waitFor(win,'window.__ozarkWorld.detailReady()');
  const screenshot=await capture(win,'06-independently-reopened-once.png');
  assert.deepEqual(await snapshot(win),restored,'Third-process rendering is read-only');
  await fs.writeFile(path.join(context.output,'result.json'),JSON.stringify({passed:true,nativeExecutionPerformed:false,
    sourceIdentity:context.sourceIdentity,sourceFingerprint:context.sourceFingerprint,
    ordinaryControllerSelectedRecovery:true,paidRecoveryArrived:true,paidRecoveryInterrupted:true,
    exactClocksAndExistingHistory:true,unfinishedMovesCancelledWithoutCompletion:true,
    noClosedTimeProgression:true,noDuplicateInterruption:true,readOnlyBeforeAfterRendering:true,
    replayCheck:expected.replay,screenshots:[...expected.screenshots,screenshot],fixtureDisclosure:expected.fixtureDisclosure,
    scope:'Controlled initial encounter with a real ordinary-controller recovery choice and paid result. Actual app save/reopen preservation, plus an independent decoded-actor replay rejection in the same sandboxed renderer. Not general escape or survival.'},null,2));
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
