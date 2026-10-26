/** Targeted sandboxed three-process combined food/funding/save regression.
 * Controlled physical sample and speech; not autonomous survival evidence. */
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
  currentRouteSnapshot, assertCurrentRoute } from './carcass-native-contract.mjs';
import { combinedFoodEvidence, createCombinedFoodScene, presentCombinedFoodUi, probeCombinedFoodRestore, canonicalCombinedFoodCheckpoint } from './combined-food-native-fixture.mjs';
import { assertStructuralRestoredHistory } from './structural-movement-native-contract.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const prepareOnly = process.argv.includes('--prepare-only');
assert.ok(process.argv.slice(2).every(arg => arg === '--prepare-only'), 'Only --prepare-only is supported');
if (!prepareOnly && !['linux','darwin'].includes(process.platform))
  throw new Error('Native combined food/funding QA supports Linux and macOS only.');
if (!prepareOnly && process.getuid?.() === 0)
  throw new Error('Native combined food/funding QA requires an unprivileged runtime; sandbox bypass is prohibited.');
if (!prepareOnly && process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY)
  throw new Error('Native combined food/funding QA requires a supported display (CI: Xvfb and a window manager).');
const outputRoot = resolve(process.env.AINCRAD_COMBINED_FOOD_QA_OUTPUT || join(root, 'test-results/combined-food-desktop'));
await mkdir(outputRoot, { recursive: true });
const output = await mkdtemp(join(outputRoot, 'run-'));
const temporary = await mkdtemp(join(tmpdir(), 'combined-food-'));
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
const evidence = ${combinedFoodEvidence.toString()};
const assertHistory = ${assertStructuralRestoredHistory.toString()};
function assertPhysical(stored, actual, beforeSave) {
  assert.deepEqual(actual.stocks,{plants:stored.environment.ecology.plants,materials:stored.environment.ecology.materials,ledger:stored.environment.ecology.ledger},'Actual app preserves raw finite stocks');
  assert.equal(actual.elapsed,stored.elapsed);
  assert.deepEqual(actual.clocks,{environmentElapsed:stored.environment.elapsed,ecologyElapsed:stored.environment.ecology.elapsed,ecologyPending:stored.environment.ecology.pending});
  for(const prior of stored.agents){const next=actual.agents.find(n=>n.id===prior.id);
    for(const key of ['physiology','inventory','flask'])assert.deepEqual(next[key],prior[key],'Actual app preserves raw '+prior.id+' '+key);
  }
  if(beforeSave){
    assert.deepEqual({elapsed:actual.elapsed,...actual.clocks},beforeSave.clocks,'Raw/app clocks equal measured pre-save clocks');
    assert.deepEqual(actual.stocks,beforeSave.stocks,'Raw/app stocks equal measured pre-save stocks');
    for(const prior of beforeSave.agents){const next=actual.agents.find(n=>n.id===prior.id);
      for(const key of ['physiology','inventory','flask'])assert.deepEqual(next[key],prior[key],'Actual app preserves measured pre-save '+prior.id+' '+key);
    }
  }
}

let running = false, closeObserved = false, allowQuit = false;
const closeEvents = [], rendererEvents = [];
const deadline = setTimeout(() => { console.error('Combined food/funding native QA timed out: ' + phase); app.exit(1); }, 300000);
app.on('will-quit', event => {
  if (!allowQuit) { event.preventDefault(); return; }
  if (!closeObserved) process.exitCode = 1;
  else console.log('COMBINED_FOOD_NATIVE_WILL_QUIT ' + phase);
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
async function writePhase(win) {
  assert.equal(await win.webContents.executeJavaScript("localStorage.getItem('aincrad.world.v2')"),null);
  const fixture=await win.webContents.executeJavaScript('(async()=>{const scene=await (' + ${JSON.stringify(createCombinedFoodScene.toString())} + ')(document.baseURI,(' + ${JSON.stringify(combinedFoodEvidence.toString())} + '));return scene.save(localStorage);})()');
  await fs.writeFile(path.join(context.output,'checkpoint.json'),JSON.stringify(fixture,null,2));
  await session.defaultSession.flushStorageData();
}
async function exercisePhase(win) {
  const fixture=JSON.parse(await fs.readFile(path.join(context.output,'checkpoint.json'),'utf8'));
  const bytes=await win.webContents.executeJavaScript("localStorage.getItem('aincrad.world.v2')");
  assert.equal(bytes,fixture.raw,'Independent process reads exact original bytes');
  const restored=await snapshot(win);
  assert.deepEqual(restored,fixture.expectedRestored,'Reopening preserves food, paid debits and interruption without success');
  assertHistory(JSON.parse(bytes),restored);
  assertPhysical(JSON.parse(bytes),restored,phase==='exercise'?fixture.physicalBeforeSave:expected.physicalBeforeSave);
  const summary=phase==='exercise'?fixture.summary:expected.summary;
  assert.ok(Math.abs(summary.checkpointToSavedStateSeconds-.2)<1e-7);
  assert.ok(Math.abs(restored.elapsed-summary.whole.at-summary.checkpointToSavedStateSeconds)<1e-7,'Actual screenshot state delta equals measured0.2 seconds');
  assert.equal(summary.pausedProjectionUnchanged,true);
  const probe=await win.webContents.executeJavaScript('(' + ${JSON.stringify(probeCombinedFoodRestore.toString())} + ')(document.baseURI,' + JSON.stringify(bytes) + ',' + JSON.stringify(fixture.summary) + ')');
  assert.equal(probe.noCopiedActionReplay,true);
  const canonical=await win.webContents.executeJavaScript('(' + ${JSON.stringify(canonicalCombinedFoodCheckpoint.toString())} + ')((' + evidence.toString() + '))');
  assert.equal(canonical.originalRaw,bytes);assert.equal(canonical.fullLiveStateUnchanged,true);
  assert.deepEqual(canonical.canonicalEvidence,restored,'Explicit canonical checkpoint retains exact restored physical/history evidence');
  await fs.writeFile(path.join(context.output,'canonical-checkpoint.json'),JSON.stringify(canonical,null,2));
  const ui=await win.webContents.executeJavaScript('(' + ${JSON.stringify(presentCombinedFoodUi.toString())} + ')(' + JSON.stringify(fixture.summary) + ')');
  assert.equal(ui.readOnly,true);
  await waitFor(win,'window.__ozarkWorld.detailReady()');
  const screenshot=await capture(win,'01-actual-app-reopened-food-funding.png');
  const waterUi=await win.webContents.executeJavaScript('(' + ${JSON.stringify(presentCombinedFoodUi.toString())} + ')(' + JSON.stringify({...fixture.summary,actorId:fixture.summary.partialActorId}) + ')');
  assert.equal(waterUi.foodSatisfaction,'0.0 / 100');assert.equal(waterUi.renderingReadOnly,true);
  assert.equal(waterUi.selectionSaved,true);assert.equal(waterUi.selectionOnlySelectedAgentId,true);
  const waterRaw=await win.webContents.executeJavaScript("localStorage.getItem('aincrad.world.v2')");
  const waterScreenshot=await capture(win,'02-actual-app-water-only-actor.png');
  await win.webContents.executeJavaScript('(' + ${JSON.stringify(presentCombinedFoodUi.toString())} + ')(' + JSON.stringify(fixture.summary) + ')');
  assert.deepEqual(await snapshot(win),restored,'Reselection and read-only rendering preserve full projected state');
  assert.equal(await win.webContents.executeJavaScript("localStorage.getItem('aincrad.world.v2')"),canonical.raw,'Reselecting original actor restores exact canonical baseline bytes');
  await fs.writeFile(path.join(context.output,'selector-transitions.json'),JSON.stringify({canonicalRaw:canonical.raw,waterRaw,restoredRaw:canonical.raw,onlySelectedAgentIdChanged:true},null,2));
  assert.equal(await win.webContents.executeJavaScript('window.__ozarkWorld.save()'),true);
  const raw=await win.webContents.executeJavaScript("localStorage.getItem('aincrad.world.v2')");
  assert.equal(raw,canonical.raw,'Final checkpoint save is idempotent');
  await fs.writeFile(path.join(context.output,'after-checkpoint.json'),JSON.stringify({raw,expectedRestored:restored,ui,summary:fixture.summary,physicalBeforeSave:fixture.physicalBeforeSave,waterUi,screenshots:[screenshot,waterScreenshot]},null,2));
  await session.defaultSession.flushStorageData();
}
async function verifyPhase(win) {
  const expected=JSON.parse(await fs.readFile(path.join(context.output,'after-checkpoint.json'),'utf8'));
  const bytes=await win.webContents.executeJavaScript("localStorage.getItem('aincrad.world.v2')");
  assert.equal(bytes,expected.raw,'Third process reads exact saved bytes');
  const restored=await snapshot(win);assert.deepEqual(restored,expected.expectedRestored);
  assertHistory(JSON.parse(bytes),restored);
  assertPhysical(JSON.parse(bytes),restored,phase==='exercise'?fixture.physicalBeforeSave:expected.physicalBeforeSave);
  const summary=phase==='exercise'?fixture.summary:expected.summary;
  assert.ok(Math.abs(summary.checkpointToSavedStateSeconds-.2)<1e-7);
  assert.ok(Math.abs(restored.elapsed-summary.whole.at-summary.checkpointToSavedStateSeconds)<1e-7,'Actual screenshot state delta equals measured0.2 seconds');
  assert.equal(summary.pausedProjectionUnchanged,true);
  const probe=await win.webContents.executeJavaScript('(' + ${JSON.stringify(probeCombinedFoodRestore.toString())} + ')(document.baseURI,' + JSON.stringify(bytes) + ',' + JSON.stringify(expected.summary) + ')');
  assert.equal(probe.noCopiedActionReplay,true);
  const ui=await win.webContents.executeJavaScript('(' + ${JSON.stringify(presentCombinedFoodUi.toString())} + ')(' + JSON.stringify(expected.summary) + ')');
  assert.equal(ui.readOnly,true);
  await waitFor(win,'window.__ozarkWorld.detailReady()');
  const screenshot=await capture(win,'03-independently-reopened-food-funding.png');
  assert.deepEqual(await snapshot(win),restored);
  await fs.writeFile(path.join(context.output,'result.json'),JSON.stringify({passed:true,nativeExecutionPerformed:true,
    sourceIdentity:context.sourceIdentity,sourceFingerprint:context.sourceFingerprint,
    exactClocksStocksHistoryAndDebits:true,noClosedTimeProgression:true,reloadDoesNotReplayPaidWork:true,decodedByteWitnessProbe:true,readOnlyBeforeAfterRendering:true,pausedNoDecayDuringRendering:true,selectorSaveTransitionsVerified:true,originalRestartNormalizationVerified:true,checkpointToCaptureStateSeconds:expected.summary.checkpointToSavedStateSeconds,
    screenshots:[...expected.screenshots,screenshot],fixtureDisclosure:expected.summary.fixtureDisclosure,nativeCoverage:expected.summary.nativeCoverage,
    scope:'Controlled real whole/partial food and water actions, zero/partial funding, actual app save/reopen and exact physiology panel. Detached decoded-byte probe verifies no regenerated runtime witnesses. Not autonomous foraging or survival evidence.'},null,2));
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
  console.log('COMBINED_FOOD_NATIVE_CLOSED '+phase);
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
      assert.ok(result.stdout.includes('COMBINED_FOOD_NATIVE_CLOSED '+phase));
      assert.ok(result.stdout.includes('COMBINED_FOOD_NATIVE_WILL_QUIT '+phase));
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
