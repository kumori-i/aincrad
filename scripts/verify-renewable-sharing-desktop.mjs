/** Isolated, sandbox-preserving native renewal and consensual food handoff QA.
 * This harness is physical capability evidence, never autonomous survival proof. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApplication } from './build.mjs';
import { captureNativeChild, archiveNativeProfile, currentRouteSnapshot, assertCurrentRoute,
  installEmptyCurrentSlot } from './carcass-native-contract.mjs';
import { createRenewableSharingFixture } from './renewable-sharing-native-fixture.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const prepareOnly = process.argv.includes('--prepare-only');
if (!prepareOnly && process.getuid?.() === 0)
  throw new Error('Native QA requires an unprivileged runtime; sandbox bypass is prohibited.');
if (!prepareOnly && process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY)
  throw new Error('Native QA requires a supported display (CI: Xvfb and a window manager).');
const outputRoot = resolve(process.env.AINCRAD_RENEWABLE_QA_OUTPUT || join(root, 'test-results/renewable-sharing-desktop'));
await mkdir(outputRoot, { recursive: true });
const output = await mkdtemp(join(outputRoot, 'run-'));
const temporary = await mkdtemp(join(tmpdir(), 'rs-'));
const profile = join(temporary, 'profile');
await mkdir(profile);
const isolated = join(output, 'isolated-state');
for (const name of ['home', 'config', 'cache']) await mkdir(join(isolated, name), { recursive: true });
const built = await buildApplication();
const context = { root, output, profile, sourceFingerprint: built.sourceFingerprint };
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
let running = false, closeObserved = false, allowQuit = false;
const rendererEvents = [], closeEvents = [];
const deadline = setTimeout(() => { console.error('Renewable native QA timed out: ' + phase); app.exit(1); }, 600000);
app.on('will-quit', event => {
  if (!allowQuit) { event.preventDefault(); return; }
  if (!closeObserved) process.exitCode = 1;
  else console.log('RENEWABLE_NATIVE_WILL_QUIT ' + phase);
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
async function writePhase(win) {
  assert.equal(await win.webContents.executeJavaScript("localStorage.getItem('aincrad.world.v2')"), null);
  const fixture = await win.webContents.executeJavaScript('(' + ${JSON.stringify(createRenewableSharingFixture.toString())} + ')(document.baseURI)');
  const stored = JSON.parse(fixture.raw);
  assert.equal(stored.version, 12);
  assert.equal(stored.features.finiteAquatic, 2);
  assert.equal(fixture.summary.renewalVerified, true);
  assert.equal(fixture.summary.timedHandoffVerified, true);
  await win.webContents.executeJavaScript('(' + installEmptyCurrentSlot.toString() + ')(localStorage,' + JSON.stringify({key:fixture.saveKey,inputRaw:fixture.raw}) + ')');
  await fs.writeFile(path.join(context.output, 'checkpoint.json'), JSON.stringify(fixture, null, 2));
  await session.defaultSession.flushStorageData();
  console.log('PASS: sandboxed renderer executed ordinary renewal and consensual timed handoff APIs.');
}
async function reopenPhase(win) {
  const expected = JSON.parse(await fs.readFile(path.join(context.output, 'checkpoint.json'), 'utf8'));
  const bytes = await win.webContents.executeJavaScript("localStorage.getItem('aincrad.world.v2')");
  assert.equal(bytes, expected.raw, 'Separate process must read exact closed-process disk bytes');
  const stored = JSON.parse(bytes);
  const snapshot = await win.webContents.executeJavaScript('window.__ozarkWorld.fullSnapshot()');
  assert.equal(snapshot.elapsed, stored.elapsed, 'Closed time must not advance');
  assert.deepEqual(snapshot.environment.ecology, stored.environment.ecology, 'Renewal ledger and population must survive unchanged');
  for (const actor of stored.agents) {
    const actual = snapshot.agents.find(row => row.id === actor.id);
    assert.ok(actual);
    for (const field of ['inventory', 'physiology', 'discovery'])
      assert.deepEqual(actual[field], actor[field], 'Recipient ownership and personal evidence must persist: ' + actor.id + ' ' + field);
  }
  const transfer = expected.summary.transfer;
  const material = snapshot.environment.ecology.materials.find(row => row.id === transfer.materialId);
  assert.equal(material.heldBy, transfer.receiverId);
  assert.ok(snapshot.agents.find(row => row.id === transfer.receiverId).inventory.items.includes(transfer.materialId));
  assert.ok(!snapshot.agents.find(row => row.id === transfer.senderId).inventory.items.includes(transfer.materialId));
  const pending = expected.summary.pendingConsent;
  assert.equal(snapshot.environment.ecology.materials.find(row => row.id === pending.materialId).heldBy, pending.senderId);
  const restartedConsent = await win.webContents.executeJavaScript('(' + (async function (offerId, receiverId) {
    const {loadOzarkSave} = await import('./src/ozark-save.js');
    const {createOzarkWorldGeometry} = await import('./src/ozark-world-geometry.js');
    const {SocialCoordinator} = await import('./src/social.js');
    const loaded = loadOzarkSave(localStorage, createOzarkWorldGeometry());
    if (loaded.blocked) throw new Error(loaded.error);
    const state = loaded.state;
    const social = new SocialCoordinator({getAgents:()=>state.agents,getCommunity:()=>state.community,getEnvironment:()=>state.environment});
    const receiver = state.agents.find(row => row.id === receiverId);
    return {observed:social.observe(receiver).foodSharing, attempt:social.action(receiver,{type:'accept_food',offerId})};
  }).toString() + ')(' + JSON.stringify(pending.offerId) + ',' + JSON.stringify(pending.receiverId) + ')');
  assert.deepEqual(restartedConsent.observed, {requests:[],offers:[]});
  assert.equal(restartedConsent.attempt.ok, false, 'Restart cannot recover transient offer authority');
  // Start only to expose the real restored world, then pause immediately.
  assert.equal(await win.webContents.executeJavaScript("window.__ozarkWorld.start(); window.dispatchEvent(new KeyboardEvent('keydown',{code:'Escape'})); window.__ozarkWorld.snapshot().paused"), true);
  const before = await win.webContents.executeJavaScript('window.__ozarkWorld.fullSnapshot()');
  await delay(700);
  assert.deepEqual(await win.webContents.executeJavaScript('window.__ozarkWorld.fullSnapshot()'), before, 'Paused render cannot mutate renewal or ownership');
  await win.webContents.executeJavaScript("document.getElementById('pause-panel').classList.add('hidden')");
  const screenshots = [await capture(win, '01-restored-food-handoff.png')];
  const conversation = await win.webContents.executeJavaScript('(' + (function (expectedText, receiverId, senderId) {
    const panel = document.getElementById('npc-panel');
    if (panel.classList.contains('hidden')) document.getElementById('open-npc').click();
    const select = document.getElementById('npc-select'); select.value = receiverId;
    select.dispatchEvent(new Event('change', {bubbles:true}));
    document.getElementById('npc-tab-conversation').click();
    const entry = [...document.querySelectorAll('#journal-messages .journal-entry')]
      .find(node => node.dataset.sender === senderId && node.querySelector('p')?.textContent === expectedText);
    if (!entry) throw new Error('Actual saved food offer missing from recipient conversation');
    entry.scrollIntoView({block:'center'});
    return {text:entry.textContent,character:document.getElementById('npc-name').textContent};
  }).toString() + ')(' + JSON.stringify(expected.summary.transfer.offer.message.text) + ',' + JSON.stringify(transfer.receiverId) + ',' + JSON.stringify(transfer.senderId) + ')');
  screenshots.push(await capture(win, '02-restored-food-offer-conversation.png'));
  assert.equal(await win.webContents.executeJavaScript('window.__ozarkWorld.preview("shore")'), true);
  screenshots.push(await capture(win, '03-restored-renewable-watershed.png'));
  assert.deepEqual(await win.webContents.executeJavaScript('window.__ozarkWorld.fullSnapshot()'), before, 'Camera previews must remain read-only');
  await fs.writeFile(path.join(context.output, 'result.json'), JSON.stringify({passed:true,
    sourceFingerprint:context.sourceFingerprint, twoIndependentElectronProcesses:true,
    exactDiskBytesAcrossClosedProcess:true, noClosedTimeProgression:true, sandboxPreferencesVerified:true,
    renewalLedgerAndPopulationPreserved:true, recipientOwnershipPreserved:true, personalProofUnchanged:true,
    pendingOfferAuthorityDiscarded:true, restartedConsent,
    pauseAndPreviewReadOnly:true, summary:expected.summary, screenshots, conversation,
    fixtureDisclosure:expected.summary.fixtureDisclosure}, null, 2));
  console.log('PASS: native separate-process reopen retained renewal, ownership and distinct personal evidence.');
}
async function closeNormally(win) {
  await session.defaultSession.flushStorageData(); await delay(250);
  const closed = new Promise(resolve => win.once('closed', () => {
    closeObserved = true; closeEvents.push('closed'); resolve();
  }));
  win.once('close', () => closeEvents.push('close')); win.close(); await closed;
  assert.deepEqual(closeEvents, ['close', 'closed']); assert.equal(win.isDestroyed(), true);
  await fs.writeFile(path.join(context.output, phase + '-close.json'), JSON.stringify({phase, events:closeEvents, destroyed:true}, null, 2));
  console.log('RENEWABLE_NATIVE_CLOSED ' + phase);
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
        nodeIntegration:prefs.nodeIntegration,contextIsolation:prefs.contextIsolation,sandbox:prefs.sandbox,webSecurity:prefs.webSecurity}, null, 2));
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
  sourceFingerprint:built.sourceFingerprint,nativeExecutionPerformed:false,sandboxBypassFlags:[]},null,2));
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
    assert.ok(result.stdout.includes('RENEWABLE_NATIVE_CLOSED '+phase));
    assert.ok(result.stdout.includes('RENEWABLE_NATIVE_WILL_QUIT '+phase));
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
