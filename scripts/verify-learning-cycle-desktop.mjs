/** Isolated native observation-led learning QA. Staged encounters are not autonomous survival proof. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApplication } from './build.mjs';
import { nativeSourceIdentity, captureNativeChild, archiveNativeProfile, currentRouteSnapshot, assertCurrentRoute,
  installEmptyCurrentSlot } from './carcass-native-contract.mjs';
import { createLearningCycleFixture } from '../tests/fixtures/learning-cycle-native.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const prepareOnly = process.argv.includes('--prepare-only');
if (!prepareOnly && !['linux','darwin'].includes(process.platform))
  throw new Error('Native learning QA supports Linux and macOS only.');
if (!prepareOnly && process.getuid?.() === 0)
  throw new Error('Native QA requires an unprivileged runtime; sandbox bypass is prohibited.');
if (!prepareOnly && process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY)
  throw new Error('Native QA requires a supported display (CI: Xvfb and a window manager).');
const outputRoot = resolve(process.env.AINCRAD_LEARNING_QA_OUTPUT || join(root, 'test-results/learning-cycle-desktop'));
await mkdir(outputRoot, { recursive: true });
const output = await mkdtemp(join(outputRoot, 'run-'));
const temporary = await mkdtemp(join(tmpdir(), 'lc-'));
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
const phase = process.argv.find(arg => arg.startsWith('--phase=')).slice(8);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const currentRouteSnapshot = ${currentRouteSnapshot.toString()};
const assertCurrentRoute = ${assertCurrentRoute.toString()};
const installEmptyCurrentSlot = ${installEmptyCurrentSlot.toString()};
let running = false, closeObserved = false, allowQuit = false, quitRequests = 0;
const rendererEvents = [], closeEvents = [];
const deadline = setTimeout(() => { console.error('Learning cycle native QA timed out: ' + phase); app.exit(1); }, 600000);
app.on('will-quit', event => {
  quitRequests++;
  if (!allowQuit) { event.preventDefault(); return; }
  if (!closeObserved) process.exitCode = 1;
  else console.log('LEARNING_NATIVE_WILL_QUIT ' + phase);
});
async function waitFor(win, expression) {
  for (let i = 0; i < 500; i++) {
    try { if (await win.webContents.executeJavaScript(expression)) return; } catch {}
    await delay(50);
  }
  throw new Error('Missing native hook: ' + expression);
}
async function capture(win, name) {
  await waitFor(win, 'window.__ozarkWorld.detailReady()');
  await delay(100);
  const image = await win.webContents.capturePage(), png = image.toPNG();
  assert.ok(png.length > 10000);
  await fs.writeFile(path.join(context.output, name), png);
  return { file: name, bytes: png.length, ...image.getSize() };
}
// Current app projection contract; historical staged action evidence is unchanged.
function assertSatietyUi(rendered, actor) {
  assert.equal(rendered.label,'Satiety');
  assert.equal(rendered.tooltip,'Satiety is modeled appetite duration, not stomach fullness or stored energy.');
  assert.equal(rendered.hidden,false);
  assert.equal(rendered.foodText,actor.nourishment.toFixed(1)+' / 100');
  assert.ok(Math.abs(rendered.foodValue-actor.nourishment)<1e-8);
  assert.equal(rendered.energyText,actor.energy.toFixed(1));
}
async function writePhase(win) {
  assert.equal(await win.webContents.executeJavaScript("localStorage.getItem('aincrad.world.v2')"), null);
  const fixture = await win.webContents.executeJavaScript('(' + ${JSON.stringify(createLearningCycleFixture.toString())} + ')(document.baseURI)');
  const stored = JSON.parse(fixture.raw);
  assert.equal(stored.version, 12);
  assert.equal(stored.features.finiteAquatic, 2);
  assert.equal(fixture.summary.passed, true);
  assert.equal(fixture.summary.completed.status, 'supported');
  assert.equal(fixture.summary.choiceAblation.nextActionDiffers, true);
  assert.ok(fixture.summary.interrupted);
  await win.webContents.executeJavaScript('(' + installEmptyCurrentSlot.toString() + ')(localStorage,' + JSON.stringify({key:fixture.saveKey,inputRaw:fixture.raw}) + ')');
  await fs.writeFile(path.join(context.output, 'checkpoint.json'), JSON.stringify(fixture, null, 2));
  await session.defaultSession.flushStorageData();
  console.log('PASS: sandboxed renderer executed witnessed consumption, inquiry-selected paid actions and own feedback.');
}
async function reopenPhase(win) {
  const expected = JSON.parse(await fs.readFile(path.join(context.output, 'checkpoint.json'), 'utf8'));
  const bytes = await win.webContents.executeJavaScript("localStorage.getItem('aincrad.world.v2')");
  assert.equal(bytes, expected.raw, 'Separate process must read exact closed-process disk bytes');
  const stored = JSON.parse(bytes);
  const snapshot = await win.webContents.executeJavaScript('window.__ozarkWorld.fullSnapshot()');
  assert.equal(snapshot.elapsed, stored.elapsed, 'Closed time must not advance');
  assert.deepEqual(snapshot.environment.ecology, stored.environment.ecology, 'Renewal ledger and population must survive unchanged');
  const receiver = snapshot.agents.find(row => row.id === expected.summary.receiverId);
  const savedReceiver = stored.agents.find(row => row.id === expected.summary.receiverId);
  for (const field of ['inventory','physiology']) assert.deepEqual(receiver[field], savedReceiver[field]);
  for (const field of ['experiments','effects','techniques']) assert.deepEqual(receiver.discovery[field], savedReceiver.discovery[field]);
  const interrupted = expected.summary.interrupted;
  assert.equal(receiver.active, null, 'Reload must interrupt pending action');
  assert.equal(receiver.discovery.experiments.length, interrupted.experiments, 'Reload cannot invent a completion receipt');
  assert.ok(receiver.inventory.items.includes(interrupted.materialId));
  assert.equal(snapshot.environment.ecology.materials.find(row=>row.id===interrupted.materialId).heldBy, receiver.id);
  assert.equal(snapshot.environment.ecology.plants.find(row=>row.id===expected.summary.sourceId).quantity, interrupted.sourceQuantity);
  const restoredInquiry = receiver.discovery.inquiries.find(row=>row.sourceId===interrupted.materialId);
  assert.equal(restoredInquiry.retired, true, 'Interrupted inquiry cannot restart its action');
  const completed = receiver.discovery.inquiries.find(row=>row.sourceId===expected.summary.materialId);
  assert.ok(completed && completed.attempts.length >= 2);
  // Start only to expose the real restored world, then pause immediately.
  assert.equal(await win.webContents.executeJavaScript("window.__ozarkWorld.start(); window.dispatchEvent(new KeyboardEvent('keydown',{code:'Escape'})); window.__ozarkWorld.snapshot().paused"), true);
  const before = await win.webContents.executeJavaScript('window.__ozarkWorld.fullSnapshot()');
  await delay(700);
  assert.deepEqual(await win.webContents.executeJavaScript('window.__ozarkWorld.fullSnapshot()'), before, 'Paused render cannot mutate inquiry evidence or ownership');
  await win.webContents.executeJavaScript("document.getElementById('pause-panel').classList.add('hidden')");
  const screenshots = [await capture(win, '01-restored-learning-world.png')];
  const journal = await win.webContents.executeJavaScript('(' + (function (receiverId) {
    if (document.getElementById('npc-panel').classList.contains('hidden')) document.getElementById('open-npc').click();
    const select = document.getElementById('npc-select'); select.value = receiverId;
    select.dispatchEvent(new Event('change', {bubbles:true}));
    document.getElementById('npc-tab-character').click();
    document.getElementById('npc-discovery-details').open = true;
    const knowledge = document.getElementById('npc-object-knowledge');
    knowledge.scrollIntoView({block:'center'});
    return {text:knowledge.textContent, rows:[...knowledge.querySelectorAll('[data-inquiry-source]')].map(row=>({sourceId:row.dataset.inquirySource,status:row.dataset.inquiryStatus,text:row.textContent}))};
  }).toString() + ')(' + JSON.stringify(receiver.id) + ')');
  assert.ok(journal.rows.some(row=>row.sourceId===expected.summary.materialId && row.status==='supported'));
  assert.ok(journal.rows.some(row=>row.sourceId===interrupted.materialId && row.status==='retired'));
  assert.ok(journal.text.includes('Could a small sample from this exact source ease my hunger?'));
  screenshots.push(await capture(win, '02-restored-learning-inquiries.png'));
  const foodSatisfactionUI = [];
  for (const actor of snapshot.agents) {
    await win.webContents.executeJavaScript('(' + (function (actorId) {
      const select=document.getElementById('npc-select');select.value=actorId;
      select.dispatchEvent(new Event('change',{bubbles:true}));
      const toggle=document.getElementById('npc-numeric-debug');
      toggle.closest('details').open=true;toggle.checked=true;
      toggle.dispatchEvent(new Event('change',{bubbles:true}));
      document.getElementById('npc-condition').scrollIntoView({block:'center'});
    }).toString() + ')(' + JSON.stringify(actor.id) + ')');
    await waitFor(win, "document.getElementById('npc-nourishment-value').textContent === " + JSON.stringify(actor.nourishment.toFixed(1)+' / 100') + " && document.getElementById('npc-energy-debug').textContent === " + JSON.stringify(actor.energy.toFixed(1)));
    const rendered=await win.webContents.executeJavaScript('(' + (function () {
      const value=document.getElementById('npc-nourishment-value'),label=value.parentElement;
      return {label:label.firstChild.textContent.trim(),tooltip:label.title,
        foodText:value.textContent,foodValue:document.getElementById('npc-nourishment').value,
        energyText:document.getElementById('npc-energy-debug').textContent,
        hidden:document.getElementById('npc-condition').classList.contains('hidden')};
    }).toString() + ')()');
    assertSatietyUi(rendered,actor);
    foodSatisfactionUI.push({actorId:actor.id,...rendered});
    screenshots.push(await capture(win,'03-food-satisfaction-'+actor.id+'.png'));
  }

  await win.webContents.executeJavaScript('(' + (function (actorId) {
    const select=document.getElementById('npc-select');select.value=actorId;
    select.dispatchEvent(new Event('change',{bubbles:true}));
  }).toString() + ')(' + JSON.stringify(before.selectedAgentId) + ')');
  assert.deepEqual(await win.webContents.executeJavaScript('window.__ozarkWorld.fullSnapshot()'), before, 'Journal inspection must remain read-only');
  await fs.writeFile(path.join(context.output, 'result.json'), JSON.stringify({passed:true,
    sourceFingerprint:context.sourceFingerprint, twoIndependentElectronProcesses:true,
    exactDiskBytesAcrossClosedProcess:true, noClosedTimeProgression:true, sandboxPreferencesVerified:true,
    sameStateInquiryAblationChangesNextAction:true, inquirySelectedPaidActions:true, witnessedNotPersonalProof:true, ownFeedbackPreserved:true,
    interruptedWorkNotReplayed:true, heldSuccessorPreserved:true, noDuplicateSourceDebit:true,
    pauseAndJournalReadOnly:true, summary:expected.summary, screenshots, journal, foodSatisfactionUI,
    fixtureDisclosure:expected.summary.fixtureDisclosure}, null, 2));
  console.log('PASS: native separate-process reopen retained inquiry evidence and interrupted unfinished work.');
}
async function closeNormally(win) {
  const saved = await win.webContents.executeJavaScript("if(window.__ozarkWorld.snapshot().started)window.__ozarkWorld.save(); localStorage.getItem('aincrad.world.v2')");
  await session.defaultSession.flushStorageData(); await delay(250);
  const closed = new Promise(resolve => win.once('closed', () => {
    closeObserved = true; closeEvents.push('closed'); resolve();
  }));
  win.once('close', () => closeEvents.push('close')); win.close(); await closed;
  assert.deepEqual(closeEvents, ['close', 'closed']); assert.equal(win.isDestroyed(), true);
  await fs.writeFile(path.join(context.output, phase + '-close.json'), JSON.stringify({phase, events:closeEvents, destroyed:true}, null, 2));
  console.log('LEARNING_NATIVE_CLOSED ' + phase);
  if (process.platform === 'darwin') {
    // Exercise production macOS retention and activation before explicit quit.
    // No preventDefault branch may mask an unexpected quit request here.
    await delay(350);
    assert.equal(quitRequests, 0, 'Closing the last macOS window must not request quit');
    const { BrowserWindow, Menu } = require('electron');
    assert.equal(BrowserWindow.getAllWindows().length, 0);
    const menu = Menu.getApplicationMenu();
    const roles = menu.items.flatMap(item => item.submenu?.items.map(child => child.role) || []);
    assert.ok(roles.includes('quit')); assert.ok(roles.includes('close'));
    const opened = new Promise(resolve => app.once('browser-window-created', (_event, next) => {
      next.webContents.once('did-finish-load', () => resolve(next));
    }));
    app.emit('activate');
    const reopened = await opened;
    await waitFor(reopened, 'Boolean(window.__ozarkWorld)');
    const prefs = reopened.webContents.getLastWebPreferences();
    assert.equal(prefs.sandbox, true); assert.equal(prefs.contextIsolation, true); assert.equal(prefs.nodeIntegration, false);
    assert.equal(await reopened.webContents.executeJavaScript("localStorage.getItem('aincrad.world.v2')"), saved);
    assert.equal(await reopened.webContents.executeJavaScript('window.__ozarkWorld.snapshot().elapsed'), JSON.parse(saved).elapsed);
    const closedAgain = new Promise(resolve => reopened.once('closed', resolve));
    reopened.close(); await closedAgain;
    assert.equal(quitRequests, 0);
    await fs.writeFile(path.join(context.output, phase + '-mac-lifecycle.json'), JSON.stringify({
      lastWindowRetainsApp:true, activationRecreatesSandboxedWindow:true, exactSavedBytes:true,
      noClosedTimeProgression:true, quitAndCloseMenuRoles:true, quitRequestsBeforeExplicitQuit:quitRequests,
      sourceIdentity:context.sourceIdentity,platform:process.platform,arch:process.arch,electron:process.versions.electron},null,2));
  }
  clearTimeout(deadline); allowQuit = true; app.quit();
}
app.on('browser-window-created', (_event, win) => {
  win.webContents.on('console-message', (_event, ...details) => rendererEvents.push({kind:'console',details}));
  win.webContents.on('did-fail-load', (_event, ...details) => rendererEvents.push({kind:'load-failure',details}));
  win.webContents.on('render-process-gone', (_event, details) => rendererEvents.push({kind:'renderer-gone',details}));
  win.webContents.once('did-finish-load', async () => {
    if (running) return; running = true;
    try {
      const prefs = win.webContents.getLastWebPreferences();
      assert.equal(prefs.nodeIntegration, false); assert.equal(prefs.contextIsolation, true);
      assert.equal(prefs.sandbox, true); assert.equal(prefs.webSecurity, true);
      assert.equal(process.argv.includes('--no-sandbox'), false);
      assert.equal(process.argv.includes('--disable-setuid-sandbox'), false);
      await fs.writeFile(path.join(context.output, phase + '-sandbox.json'), JSON.stringify({
        sourceIdentity:context.sourceIdentity,platform:process.platform,arch:process.arch,electron:process.versions.electron,nodeIntegration:prefs.nodeIntegration,contextIsolation:prefs.contextIsolation,sandbox:prefs.sandbox,webSecurity:prefs.webSecurity}, null, 2));
      await waitFor(win, 'Boolean(window.__ozarkWorld)');
      assert.equal(await win.webContents.executeJavaScript("import('./src/build-info.js').then(module => module.BUILD_SOURCE_FINGERPRINT)"), context.sourceFingerprint,
        'Native renderer must match the exact built source fingerprint');
      const boot = await win.webContents.executeJavaScript('(' + currentRouteSnapshot.toString() + ')(window,document)');
      assertCurrentRoute(boot);
      await fs.writeFile(path.join(context.output, phase + '-current-boot.json'), JSON.stringify(boot, null, 2));
      await ({write:writePhase,reopen:reopenPhase}[phase])(win);
      await closeNormally(win);
    } catch (error) {
      console.error(error);
      const evidence = {phase,error:String(error?.stack || error),rendererEvents};
      try { evidence.url = win.webContents.getURL();
        await fs.writeFile(path.join(context.output, phase + '-failure.png'), (await win.webContents.capturePage()).toPNG());
      } catch (failure) { evidence.captureError = String(failure); }
      await fs.writeFile(path.join(context.output, phase + '-failure.json'), JSON.stringify(evidence,null,2));
      clearTimeout(deadline); app.exit(1);
    }
  });
});
require(path.join(context.root, 'dist/desktop/main.cjs'));
`);
await writeFile(join(output, 'prepared.json'), JSON.stringify({output,harness,
  sourceIdentity:nativeSourceIdentity(root), sourceFingerprint:built.sourceFingerprint,nativeExecutionPerformed:false,sandboxBypassFlags:[]},null,2));
if (prepareOnly) console.log(JSON.stringify({output,harness,nativeExecutionPerformed:false}));
else {
  const electron = createRequire(import.meta.url)('electron');
  for (const phase of ['write', 'reopen']) {
    const flags = [harness, '--test', `--test-profile=${profile}`, `--phase=${phase}`];
    if (process.platform === 'linux') flags.push('--disable-gpu');
    const env = {...process.env,TMPDIR:temporary,TMP:temporary,TEMP:temporary,HOME:join(isolated,'home'),
      XDG_CONFIG_HOME:join(isolated,'config'),XDG_CACHE_HOME:join(isolated,'cache')};
    delete env.ELECTRON_RUN_AS_NODE;
    nativeProcessesClosed = false;
    const result = await captureNativeChild(spawn,electron,flags,{cwd:root,stdio:['ignore','pipe','pipe'],env},
      bytes=>process.stdout.write(bytes),bytes=>process.stderr.write(bytes));
    nativeProcessesClosed = true;
    if (!result.spawnError) nativeProcessesStarted++;
    await writeFile(join(output, phase + '-process.json'),JSON.stringify({code:result.code,signal:result.signal,
      spawnError:result.spawnError?String(result.spawnError):null,processCloseObserved:true},null,2));
    await writeFile(join(output,phase+'-stdout.txt'),result.stdout);
    await writeFile(join(output,phase+'-stderr.txt'),result.stderr);
    if(result.spawnError) throw result.spawnError;
    assert.deepEqual({code:result.code,signal:result.signal},{code:0,signal:null},`Native ${phase} failed; retained evidence: ${output}`);
    assert.ok(result.stdout.includes('LEARNING_NATIVE_CLOSED '+phase));
    assert.ok(result.stdout.includes('LEARNING_NATIVE_WILL_QUIT '+phase));
  }
  const report = JSON.parse(await readFile(join(output,'result.json'),'utf8'));
  Object.assign(report,{nativeExecutionPerformed:true,actualNativeCloseEvents:true,actualNativeWillQuitEvents:true});
  await writeFile(join(output,'result.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}
} finally {
  let preserved = false;
  if (nativeProcessesClosed) try {
    const archive = await archiveNativeProfile(profile,join(output,'profile-evidence'));
    await writeFile(join(output,'profile-evidence.json'),JSON.stringify({runtimeProfile:profile,
      copiedAfterProcessesClosed:nativeProcessesStarted>0,nativeExecutionPerformed:nativeProcessesStarted>0,archive},null,2));
    preserved = true;
  } catch(error) { console.error('Profile preservation failed; original retained at '+temporary,error); process.exitCode=1; }
  if(preserved) await rm(temporary,{recursive:true,force:true,maxRetries:3,retryDelay:100}).catch(error=>{
    console.error('Disposable profile cleanup failed: '+temporary,error);process.exitCode=1;
  });
}
