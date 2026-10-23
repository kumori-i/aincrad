/** Targeted sandboxed three-process naming follow-up/save regression.
 * Controlled paid encounter; ordinary population ticks must produce the protocol. */
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
import { namingFollowupEvidence, createNamingFollowupScene, presentNamingFollowupScene, checkNamingFollowupReload } from './naming-followup-native-fixture.mjs';
import { presentNamingUi } from './naming-ui-fixture.mjs';
import { assertStructuralRestoredHistory } from './structural-movement-native-contract.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const prepareOnly = process.argv.includes('--prepare-only');
assert.ok(process.argv.slice(2).every(arg => arg === '--prepare-only'), 'Only --prepare-only is supported');
if (!prepareOnly && process.getuid?.() === 0)
  throw new Error('Native naming follow-up QA requires an unprivileged runtime; sandbox bypass is prohibited.');
if (!prepareOnly && process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY)
  throw new Error('Native naming follow-up QA requires a supported display (CI: Xvfb and a window manager).');
const outputRoot = resolve(process.env.AINCRAD_NAMING_FOLLOWUP_QA_OUTPUT || join(root, 'test-results/naming-followup-desktop'));
await mkdir(outputRoot, { recursive: true });
const output = await mkdtemp(join(outputRoot, 'run-'));
const temporary = await mkdtemp(join(tmpdir(), 'naming-followup-'));
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
const evidence = ${namingFollowupEvidence.toString()};
const assertHistory = ${assertStructuralRestoredHistory.toString()};
let running = false, closeObserved = false, allowQuit = false;
const closeEvents = [], rendererEvents = [];
const deadline = setTimeout(() => { console.error('Naming follow-up native QA timed out: ' + phase); app.exit(1); }, 300000);
app.on('will-quit', event => {
  if (!allowQuit) { event.preventDefault(); return; }
  if (!closeObserved) process.exitCode = 1;
  else console.log('NAMING_FOLLOWUP_NATIVE_WILL_QUIT ' + phase);
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
  assert.equal(await win.webContents.executeJavaScript("localStorage.getItem('aincrad.world.v2')"), null);
  const create = 'window.__namingFollowupScene = await (' + ${JSON.stringify(createNamingFollowupScene.toString())} + ')(document.baseURI,(' + ${JSON.stringify(namingFollowupEvidence.toString())} + ')); true';
  const show = async (label,file) => {
    assert.equal((await win.webContents.executeJavaScript('(' + ${JSON.stringify(presentNamingFollowupScene.toString())} + ')(' + JSON.stringify(label) + ')')).readOnly,true);
    const before=await win.webContents.executeJavaScript('window.__namingFollowupScene.project()');
    const screenshot=await capture(win,file);
    assert.deepEqual(await win.webContents.executeJavaScript('window.__namingFollowupScene.project()'),before,'Capture readiness cannot advance controlled scene');
    return screenshot;
  };
  await win.webContents.executeJavaScript('(async()=>{' + create + '})()');
  const grounded=await win.webContents.executeJavaScript('window.__namingFollowupScene.ground()');
  assert.equal(grounded.status,'heard-grounded');assert.equal(grounded.opportunityCount,1);
  const screenshots=[await show('Controlled paid encounter: ordinary runtime introduced a locally grounded name.','01-live-grounded-name.png')];
  const completed=await win.webContents.executeJavaScript('window.__namingFollowupScene.advance()');
  assert.equal(completed.status,'confirmed');assert.ok(completed.confirmation);
  screenshots.push(await show('Ordinary follow-up turns completed independent reference confirmation. No body hold.','02-live-confirmed-reference.png'));
  const success=await win.webContents.executeJavaScript('window.__namingFollowupScene.save()');
  await fs.writeFile(path.join(context.output,'completed-encounter.json'),JSON.stringify(success,null,2));
  await win.webContents.executeJavaScript('window.__namingFollowupScene.dispose()');
  await win.webContents.executeJavaScript('(async()=>{' + create + '})()');
  await win.webContents.executeJavaScript('window.__namingFollowupScene.ground()');
  const interrupted=await win.webContents.executeJavaScript('window.__namingFollowupScene.advance({interrupt:true})');
  assert.equal(interrupted.status,'heard-grounded');assert.equal(interrupted.confirmation,null);assert.equal(interrupted.pending,1);
  screenshots.push(await show('Second controlled encounter: real word-only request interrupted before selection/confirmation.','03-interrupted-reference-request.png'));
  const fixture=await win.webContents.executeJavaScript('window.__namingFollowupScene.save(localStorage)');
  assert.equal(fixture.summary.pendingAtSave,1);assert.equal(fixture.summary.opportunitiesAtSave,1);
  await fs.writeFile(path.join(context.output,'checkpoint.json'),JSON.stringify({...fixture,screenshots},null,2));
  await session.defaultSession.flushStorageData();
}
async function exercisePhase(win) {
  const fixture=JSON.parse(await fs.readFile(path.join(context.output,'checkpoint.json'),'utf8'));
  const bytes=await win.webContents.executeJavaScript("localStorage.getItem('aincrad.world.v2')");
  assert.equal(bytes,fixture.raw,'Independent process must read exact original disk bytes');
  const restored=await snapshot(win);
  assert.deepEqual(restored,fixture.expectedRestored,'Actual app restores exact physical/lexical state, without a restored pending protocol');
  assertHistory(JSON.parse(bytes),restored);
  const replay=await win.webContents.executeJavaScript('(' + ${JSON.stringify(checkNamingFollowupReload.toString())} + ')(document.baseURI,' + JSON.stringify(bytes) + ')');
  assert.equal(replay.noReplayAfterFreshSight,true);assert.equal(replay.opportunityCount,0);assert.equal(replay.pendingCount,0);
  assert.deepEqual(await snapshot(win),restored,'Independent decoded-actor test cannot mutate actual app state');
  const ui=await win.webContents.executeJavaScript('(' + ${JSON.stringify(presentNamingUi.toString())} + ')(' + JSON.stringify(fixture.summary) + ')');
  assert.equal(ui.status,'heard-grounded');assert.equal(ui.readOnly,true);
  await waitFor(win,'window.__ozarkWorld.detailReady()');
  const screenshot=await capture(win,'04-actual-app-reopened-grounded-journal.png');
  assert.deepEqual(await snapshot(win),restored,'Reopened journal rendering is read-only');
  assert.equal(await win.webContents.executeJavaScript('window.__ozarkWorld.save()'),true);
  const raw=await win.webContents.executeJavaScript("localStorage.getItem('aincrad.world.v2')");
  await fs.writeFile(path.join(context.output,'after-checkpoint.json'),JSON.stringify({raw,expectedRestored:restored,replay,ui,
    screenshots:[...fixture.screenshots,screenshot],summary:fixture.summary},null,2));
  await session.defaultSession.flushStorageData();
}
async function verifyPhase(win) {
  const expected=JSON.parse(await fs.readFile(path.join(context.output,'after-checkpoint.json'),'utf8'));
  const bytes=await win.webContents.executeJavaScript("localStorage.getItem('aincrad.world.v2')");
  assert.equal(bytes,expected.raw,'Third process must read exact saved naming bytes');
  const restored=await snapshot(win);assert.deepEqual(restored,expected.expectedRestored);
  assertHistory(JSON.parse(bytes),restored);
  const listener=restored.agents.find(n=>n.id===expected.summary.actorId);
  const binding=listener.lexicon.heard.find(r=>r.speakerId===expected.summary.speakerId&&r.objectId===expected.summary.sourceObjectId);
  assert.equal(binding.confirmation,null,'Repeated reopen must not fabricate confirmation');
  const ui=await win.webContents.executeJavaScript('(' + ${JSON.stringify(presentNamingUi.toString())} + ')(' + JSON.stringify(expected.summary) + ')');
  assert.equal(ui.status,'heard-grounded');assert.equal(ui.readOnly,true);
  await waitFor(win,'window.__ozarkWorld.detailReady()');
  const screenshot=await capture(win,'05-independently-reopened-no-replay.png');
  assert.deepEqual(await snapshot(win),restored,'Third-process rendering is read-only');
  await fs.writeFile(path.join(context.output,'result.json'),JSON.stringify({passed:true,nativeExecutionPerformed:false,
    sourceIdentity:context.sourceIdentity,sourceFingerprint:context.sourceFingerprint,
    ordinaryPopulationDroveProtocol:true,liveIndependentConfirmation:true,requestInterruptedBeforeConfirmation:true,
    exactClocksLexiconsAndExistingHistory:true,noClosedTimeProgression:true,noDuplicateInterruptionOrConfirmation:true,
    readOnlyBeforeAfterRendering:true,replayCheck:expected.replay,screenshots:[...expected.screenshots,screenshot],
    fixtureDisclosure:expected.summary.fixtureDisclosure,
    scope:'Controlled paid encounter with ordinary runtime follow-up turns. Actual app save/reopen and grounded journal evidence, plus independent decoded-actor no-replay testing. Not deliberate shared attention, spontaneous language or survival.'},null,2));
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
  console.log('NAMING_FOLLOWUP_NATIVE_CLOSED '+phase);
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
      assert.ok(result.stdout.includes('NAMING_FOLLOWUP_NATIVE_CLOSED '+phase));
      assert.ok(result.stdout.includes('NAMING_FOLLOWUP_NATIVE_WILL_QUIT '+phase));
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
