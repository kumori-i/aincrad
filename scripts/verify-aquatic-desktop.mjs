/** Native, isolated two-process aquatic QA. Manual local bank exposure is a
 * fixture, not autonomous travel or policy evidence. All catches, processing,
 * sampling, biology and learned evidence use the normal timed native APIs. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApplication } from './build.mjs';
import { captureNativeChild, archiveNativeProfile, currentRouteSnapshot, assertCurrentRoute, installEmptyCurrentSlot } from './carcass-native-contract.mjs';

import { createPeerTeachingUiFixture, presentPeerTeachingUi } from './peer-teaching-ui-fixture.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const outputRoot = process.env.AINCRAD_AQUATIC_QA_OUTPUT ?
  resolve(process.env.AINCRAD_AQUATIC_QA_OUTPUT) : resolve(root, 'test-results/aquatic-desktop');
const prepareOnly = process.argv.includes('--prepare-only');
if (!prepareOnly && process.getuid?.() === 0) throw new Error('Native aquatic QA needs an unprivileged supported desktop runtime; disabling the Chromium sandbox is not permitted.');
if (!prepareOnly && process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY)
  throw new Error('Native aquatic QA needs a desktop display (for CI: Xvfb with a window manager); headless Chromium does not establish native blur/minimize behavior.');
await mkdir(outputRoot, { recursive: true });
const output = await mkdtemp(join(outputRoot, 'run-'));
const isolated = join(output, 'isolated-state');
for (const name of ['home', 'config', 'cache'])
  await mkdir(join(isolated, name), { recursive: true });
const built = await buildApplication();
// The desktop guard requires the actual test profile inside the child's OS
// temp root. Keep both the profile and Chromium's Unix socket root short.
const temporary = await mkdtemp(join(tmpdir(), 'aq-'));
const profile = join(temporary, 'profile');
const socialProfile = join(temporary, 'social-profile');
const context = { root, output, profile, socialProfile, sourceFingerprint: built.sourceFingerprint };
try {
await mkdir(profile, { recursive: true });
await mkdir(socialProfile, { recursive: true });

async function setupFixture() {
  const { createOzarkWorldGeometry } = await import('./src/ozark-world-geometry.js');
  const { createOzarkState, writeOzarkSave } = await import('./src/ozark-save.js');
  const { bindOzarkWorldAgent } = await import('./src/ozark-agent-world.js');
  const { observeNpc, requestNpcAction, tickNpc } = await import('./src/npc.js');
  const { processDiscoveryFeedback } = await import('./src/discovery.js');
  const { tickEnvironment } = await import('./src/environment.js');
  const { tickOzarkEcology } = await import('./src/ozark-ecology.js');
  const { measureCardinalWorld } = await import('./src/cardinal-metrics.js');
  const { OzarkWorldRenderer } = await import('./src/ozark-world-renderer.js');
  const { CONFIG } = await import('./src/config.js');
  const geometry = createOzarkWorldGeometry(), state = createOzarkState(geometry);
  const ecology = state.environment.ecology, actor = state.agents[0];
  for (const human of state.agents) bindOzarkWorldAgent(human, geometry, state);
  const tick = seconds => {
    for (let passed = 0; passed < seconds - 1e-9; passed += CONFIG.fixedStep) {
      const dt = Math.min(CONFIG.fixedStep, seconds - passed);
      tickEnvironment(state.environment, dt);
      tickOzarkEcology(ecology, dt, state.environment, state.agents);
      for (const human of state.agents) {
        tickNpc(human, dt, state.environment);
        processDiscoveryFeedback(human);
      }
      state.elapsed = state.environment.elapsed;
    }
  };
  // Real 120s warm-up: no distant observation at time zero, no changed fish
  // heading, reserve, phase, physiology, coefficient, or forced interception.
  tick(120);
  const bankFor = position => {
    for (let r = 15; r <= 80; r += 2) for (let k = 0; k < 64; k++) {
      const a = k * Math.PI / 32;
      const p = { x: position.x + Math.cos(a) * r, y: position.y + Math.sin(a) * r };
      if (geometry.classify(p.x, p.y, CONFIG.playerRadius).reason === 'dry-ground' &&
          geometry.lineOfSight(p, position)) return p;
    }
    return null;
  };
  const expose = fish => {
    const bank = bankFor(fish.position);
    if (!bank) return false;
    actor.position = { ...bank }; state.player = { ...bank };
    observeNpc(actor, state.environment);
    return true;
  };
  const action = (type, id) => {
    observeNpc(actor, state.environment);
    const target = ecology.aquatic.fish.find(row => row.id === id);
    const before = { at: actor.elapsed, spentKcal: actor.physiology.totals.metabolizedKcal,
      position: target ? { ...target.position } : null };
    const admission = requestNpcAction(actor, { type, targetId: id }, state.environment);
    if (admission.ok) for (let n = 0; n < 2000 && actor.active; n++) tick(CONFIG.fixedStep);
    if (actor.active) throw new Error('Timed action did not settle');
    return { type, targetId: id, admission, result: structuredClone(actor.lastResult), before,
      after: { at: actor.elapsed, spentKcal: actor.physiology.totals.metabolizedKcal,
        position: target ? { ...target.position } : null } };
  };
  const canvas = document.createElement('canvas');
  canvas.id = 'aquatic-native-scene';
  Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', zIndex: '9998' });
  document.body.append(canvas);
  const caption = document.createElement('div');
  Object.assign(caption.style, { position: 'fixed', top: '18px', left: '18px', zIndex: '9999',
    background: '#18362ee8', color: '#f4e4be', font: '18px monospace', padding: '14px' });
  document.body.append(caption);
  const renderer = new OzarkWorldRenderer(canvas, geometry);
  renderer.targetZoom = 3;
  const draw = label => { renderer.draw(state); if (label) caption.textContent = label; };
  const settleDraw = async () => {
    for (let frame = 0; frame < 120; frame++) {
      draw();
      if (!renderer.pendingChunks.size) { draw(); return true; }
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    throw new Error('Bounded renderer detail refinement did not settle');
  };
  const fish = ecology.aquatic.fish.find(expose);
  if (!fish) throw new Error('No real shallow-water fish with a dry bank');
  draw('Finite fishing: actual live stock. Local bank exposure is a test fixture.');
  window.__aquaticQa = { state, ecology, actor, geometry, tick, expose, action, draw, settleDraw,
    save: () => writeOzarkSave(localStorage, state, geometry), metrics: () => measureCardinalWorld(state),
    observe: () => observeNpc(actor, state.environment), request: (type, id) =>
      requestNpcAction(actor, { type, targetId: id }, state.environment) };
  return { initialCount: ecology.aquatic.initialCount, warmedSeconds: state.elapsed, firstFish: fish.id };
}

async function acquire() {
  const q = window.__aquaticQa, attempts = [];
  for (const id of [...q.ecology.aquatic.initialIds]) {
    const fish = q.ecology.aquatic.fish.find(row => row.id === id);
    if (!fish || !q.expose(fish)) continue;
    const attempt = q.action('catch', id); attempts.push(attempt);
    if (attempt.admission.ok && attempt.result?.ok) {
      q.specimenId = id;
      q.draw('Paid catch completed: same-identity whole specimen is actually held.');
      return { attempts, specimenId: id };
    }
  }
  throw new Error('No successful interception in the bounded native attempt protocol: ' + JSON.stringify(attempts));
}

async function processSpecimen() {
  const q = window.__aquaticQa;
  const pull = q.action('pull', q.specimenId);
  if (!pull.result?.ok) throw new Error('Native paid pull failed: ' + JSON.stringify(pull));
  q.tissueId = pull.result.materialId;
  q.draw('Paid pull completed: held raw tissue and bare structural residue both remain.');
  return { pull, tissueId: q.tissueId };
}

async function checkpoint() {
  const q = window.__aquaticQa;
  const sample = q.action('sample', q.tissueId);
  if (!sample.result?.ok) throw new Error('Native sample failed: ' + JSON.stringify(sample));
  const preFeedback = q.actor.discovery.techniques.length;
  q.tick(60);
  const effects = q.actor.discovery.effects.filter(row => row.objectId === q.tissueId);
  const technique = q.actor.discovery.techniques.find(row => row.sourceId === q.specimenId &&
    row.steps.map(step => step.type).join(',') === 'pull,sample');
  if (!technique || !effects.some(row => row.effect === 'sustained'))
    throw new Error('No real delayed exact-specimen effect: ' + JSON.stringify({ effects, techniques: q.actor.discovery.techniques }));
  const second = q.action('sample', q.tissueId);
  if (!second.result?.ok) throw new Error('Second native sample failed');
  const tissue = q.ecology.materials.find(row => row.id === q.tissueId);
  if (!tissue || Math.abs(tissue.massGrams - 20) > 1e-8) throw new Error('Partial tissue must remain finite at 20g');
  // Interrupt an actually admitted catch after a paid half-second. No action
  // witness is serialized and no capture can complete while the process closes.
  const next = q.ecology.aquatic.fish.find(fish => q.expose(fish));
  if (!next) throw new Error('No live target for interruption checkpoint');
  q.observe();
  const pending = q.request('catch', next.id);
  if (!pending.ok) throw new Error('Could not admit interrupted native catch: ' + JSON.stringify(pending));
  q.tick(.5);
  if (q.actor.active?.request.type !== 'catch') throw new Error('Interrupted catch settled too early');
  if (!q.save()) throw new Error('Native current-world checkpoint did not pass strict save validation');
  q.draw('Checkpoint: bare residue, 20g tissue, real pending ingestion, learned exact proof, interrupted catch.');
  return { raw: localStorage.getItem('aincrad.world.v2'),
    specimenId: q.specimenId,
    tissueId: q.tissueId, interruptedTarget: next.id, sample, second, preFeedback,
    effects, technique, metrics: q.metrics() };
}

const harness = join(output, 'runner.cjs');
await writeFile(harness, `
const { app, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const context = ${JSON.stringify(context)};
const phase = process.argv.find(arg => arg.startsWith('--phase=')).slice(8);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let running = false, closeObserved = false, allowQuit = false;
const closeEvents = [], rendererEvents = [];
const currentRouteSnapshot = ${currentRouteSnapshot.toString()};
const assertCurrentRoute = ${assertCurrentRoute.toString()};
const installEmptyCurrentSlot = ${installEmptyCurrentSlot.toString()};
app.on('will-quit', event => {
  if (!allowQuit) { event.preventDefault(); return; }
  if (!closeObserved) { console.error('Missing actual native window closed event'); process.exitCode = 1; }
  else console.log('AQUATIC_NATIVE_WILL_QUIT ' + phase);
});
async function closeNormally(win) {
  await session.defaultSession.flushStorageData(); await delay(250);
  const closed = new Promise(resolve => win.once('closed', () => {
    closeObserved = true; closeEvents.push('closed'); resolve();
  }));
  win.once('close', () => closeEvents.push('close')); win.close(); await closed;
  assert.deepEqual(closeEvents, ['close', 'closed']); assert.equal(win.isDestroyed(), true);
  await fs.writeFile(path.join(context.output, phase + '-close.json'),
    JSON.stringify({ events:closeEvents, destroyed:win.isDestroyed(), phase }, null, 2));
  console.log('AQUATIC_NATIVE_CLOSED ' + phase);
  clearTimeout(deadline); allowQuit = true; app.quit();
}
async function captureFailure(win, error) {
  const evidence = { phase, error:String(error?.stack || error), rendererEvents };
  try { evidence.url = win.webContents.getURL();
    evidence.document = await win.webContents.executeJavaScript(
      '({url:location.href,title:document.title,text:document.body?.innerText?.slice(0,12000),' +
      'ozarkHook:Boolean(window.__ozarkWorld)})');
  } catch (failure) { evidence.documentError=String(failure); }
  await fs.writeFile(path.join(context.output, phase + '-failure.json'), JSON.stringify(evidence,null,2));
  try { await fs.writeFile(path.join(context.output, phase + '-failure.png'),
    (await win.webContents.capturePage()).toPNG()); } catch {}
}
async function assertCurrentBoot(win) {
  await waitFor(win,'Boolean(window.__ozarkWorld)');
  const current = await win.webContents.executeJavaScript('(' + currentRouteSnapshot.toString() + ')(window,document)');
  assertCurrentRoute(current);
  await fs.writeFile(path.join(context.output,phase + '-current-boot.json'),JSON.stringify(current,null,2));
}
const deadline = setTimeout(() => { console.error('Aquatic native QA timed out in ' + phase); app.exit(1); }, 600000);
async function waitFor(win, expression) {
 for (let n = 0; n < 500; n++) { try { if (await win.webContents.executeJavaScript(expression)) return; } catch {} await delay(50); }
 throw new Error('Missing native hook: ' + expression);
}
async function capture(win, name) {
 await win.webContents.executeJavaScript('window.__aquaticQa?.settleDraw?.()');
 await delay(100); const image = await win.webContents.capturePage(), png = image.toPNG();
 assert.ok(png.length > 10000); await fs.writeFile(path.join(context.output, name), png);
 return { file: path.join(context.output, name), bytes: png.length, ...image.getSize() };
}
async function writePhase(win) {
 await assertCurrentBoot(win);
 assert.equal(await win.webContents.executeJavaScript("localStorage.getItem('aincrad.world.v2')"), null,'Only an empty disposable slot can receive the fixture');
 const setup = await win.webContents.executeJavaScript('(' + ${JSON.stringify(setupFixture.toString())} + ')()');
 const screenshots = [await capture(win, '01-live-fish.png')];
 const caught = await win.webContents.executeJavaScript('(' + ${JSON.stringify(acquire.toString())} + ')()');
 assert.ok(caught.attempts.some(row => row.result.ok && row.after.spentKcal > row.before.spentKcal));
 screenshots.push(await capture(win, '02-held-whole-specimen.png'));
 const pulled = await win.webContents.executeJavaScript('(' + ${JSON.stringify(processSpecimen.toString())} + ')()');
 screenshots.push(await capture(win, '03-held-tissue-bare-residue.png'));
 const saved = await win.webContents.executeJavaScript('(' + ${JSON.stringify(checkpoint.toString())} + ')()');
 assert.equal(JSON.parse(saved.raw).version, 12);
 assert.equal(saved.preFeedback, 0);
 screenshots.push(await capture(win, '04-partial-pending-checkpoint.png'));
 await fs.writeFile(path.join(context.output, 'checkpoint.json'), JSON.stringify({ setup, caught, pulled, saved, screenshots }, null, 2));
 await session.defaultSession.flushStorageData(); await delay(300);
 console.log('PASS: actual Electron paid moving capture, pull, two samples, delayed exact proof and isolated disk write.');
}
async function reopenPhase(win) {
 await assertCurrentBoot(win);
 const expected = JSON.parse(await fs.readFile(path.join(context.output, 'checkpoint.json'), 'utf8'));
 const bytes = await win.webContents.executeJavaScript("localStorage.getItem('aincrad.world.v2')");
 assert.equal(bytes, expected.saved.raw, 'A separate process must read the exact previously written disk bytes');
 const reopened = await win.webContents.executeJavaScript('window.__ozarkWorld.snapshot()');
 assert.equal(reopened.blocked, false); assert.equal(reopened.started, false);
 const stored = JSON.parse(expected.saved.raw);
 assert.equal(reopened.elapsed, stored.elapsed, 'Closed time must not advance the simulation');
 const restore = await win.webContents.executeJavaScript(\`(async()=>{
   const {loadOzarkSave}=await import('./src/ozark-save.js');
   const {createOzarkWorldGeometry}=await import('./src/ozark-world-geometry.js');
   const loaded=loadOzarkSave(localStorage,createOzarkWorldGeometry());
   if(loaded.blocked)throw new Error(loaded.error);return structuredClone(loaded.state);
 })()\`);
 assert.deepEqual(restore.environment.ecology, stored.environment.ecology);
 assert.deepEqual(restore.agents[0].inventory, stored.agents[0].inventory);
 assert.deepEqual(restore.agents[0].physiology.stomach, stored.agents[0].physiology.stomach);
 assert.deepEqual(restore.agents[0].discovery.experiments, stored.agents[0].discovery.experiments);
 assert.deepEqual(restore.agents[0].discovery.effects, stored.agents[0].discovery.effects);
 assert.deepEqual(restore.agents[0].discovery.techniques, stored.agents[0].discovery.techniques);
 assert.equal(restore.agents[0].active, null);
 assert.equal(restore.agents[0].memory.experience.filter(e=>e.details?.result?.code==='RESTART_INTERRUPTED').length, 1);
 assert.ok(restore.environment.ecology.aquatic.fish.some(row=>row.id===expected.saved.interruptedTarget));
 assert.equal(restore.environment.ecology.materials.find(row=>row.id===expected.saved.tissueId).massGrams, 20);
 assert.equal(restore.environment.ecology.materials.find(row=>row.id===expected.saved.specimenId).fishTissue.massGrams, 0);
 assert.equal(await win.webContents.executeJavaScript("window.__ozarkWorld.start(); window.dispatchEvent(new KeyboardEvent('keydown',{code:'Escape'})); window.__ozarkWorld.snapshot().paused"), true);
 const pauseBefore = await win.webContents.executeJavaScript("window.__ozarkWorld.save(); localStorage.getItem('aincrad.world.v2')");
 await delay(700);
 const pauseAfter = await win.webContents.executeJavaScript("window.__ozarkWorld.save(); localStorage.getItem('aincrad.world.v2')");
 assert.deepEqual(JSON.parse(pauseAfter).environment.ecology, JSON.parse(pauseBefore).environment.ecology);
 assert.equal(JSON.parse(pauseAfter).elapsed, JSON.parse(pauseBefore).elapsed);
 await win.webContents.executeJavaScript("document.getElementById('pause-panel').classList.add('hidden')");
 const reopenedScreenshot = await capture(win, '05-native-reopened.png');
 const previewBefore = await win.webContents.executeJavaScript('window.__ozarkWorld.fullSnapshot()');
 const landscapeScreenshots = [];
 for (const name of ['spawn','forest','glade','shore']) {
   assert.equal(await win.webContents.executeJavaScript('window.__ozarkWorld.preview(' + JSON.stringify(name) + ')'),true);
   await waitFor(win,'window.__ozarkWorld.detailReady()');
   landscapeScreenshots.push(await capture(win,'landscape-' + name + '.png'));
   assert.deepEqual(await win.webContents.executeJavaScript('window.__ozarkWorld.fullSnapshot()'),previewBefore,'View-only preview cannot teleport actors, advance time or alter saves');
 }
 for (const hour of [8,12,17,23]) {
   assert.equal(await win.webContents.executeJavaScript('window.__ozarkWorld.preview("forest",' + hour + ')'),true);
   await waitFor(win,'window.__ozarkWorld.detailReady()');
   landscapeScreenshots.push(await capture(win,'landscape-forest-hour-' + hour + '.png'));
   assert.deepEqual(await win.webContents.executeJavaScript('window.__ozarkWorld.fullSnapshot()'),previewBefore);
 }
 assert.equal(await win.webContents.executeJavaScript('window.__ozarkWorld.preview(null)'),true);
 await win.webContents.executeJavaScript("window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyM'}))");
 landscapeScreenshots.push(await capture(win,'landscape-atlas.png'));
 await win.webContents.executeJavaScript("window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyM'}))");
 await win.webContents.executeJavaScript("window.dispatchEvent(new KeyboardEvent('keydown',{code:'Escape'}))");
 const beforeBlur = await win.webContents.executeJavaScript('window.__ozarkWorld.snapshot().elapsed');
 let blurEvents=0,minimizeEvents=0,hideEvents=0;
 win.on('blur',()=>blurEvents++);win.on('minimize',()=>minimizeEvents++);win.on('hide',()=>hideEvents++);
 win.focus(); await delay(150); win.blur(); await delay(500);
 const afterBlur = await win.webContents.executeJavaScript('window.__ozarkWorld.snapshot().elapsed');
 assert.ok(afterBlur>beforeBlur, 'Unpaused clock must continue after blur request');
 assert.ok(blurEvents>0 && !win.isFocused(), 'Native blur must be observed, not merely requested');
 win.minimize(); await delay(250); const minimized=win.isMinimized();
 assert.ok(minimizeEvents>0 && minimized, 'Native minimize must be observed on a supported window manager');
 win.hide();await delay(700);
 assert.ok(hideEvents>0 && !win.isVisible(), 'Native hidden state must be observed');
 const afterHidden = await win.webContents.executeJavaScript('window.__ozarkWorld.snapshot().elapsed');
 assert.ok(afterHidden>afterBlur, 'Unpaused clock must continue while hidden/minimize requested');
 win.restore();win.show();win.focus();
 await win.webContents.executeJavaScript("window.dispatchEvent(new KeyboardEvent('keydown',{code:'Escape'})); window.__ozarkWorld.save()");
 const final = JSON.parse(await win.webContents.executeJavaScript("localStorage.getItem('aincrad.world.v2')"));
 assert.ok(final.environment.ecology.aquatic.ledger.metabolizedKcal > stored.environment.ecology.aquatic.ledger.metabolizedKcal);
 const report={passed:true,twoIndependentElectronProcesses:true,exactDiskBytesAcrossClosedProcess:true,
   noClosedTimeProgression:true,sandboxPreferencesVerified:true,partialTissueGrams:20,bareResiduePreserved:true,pendingIngestionPreserved:true,
   exactSpecimenLearnedProofPreserved:true,interruptedCatchCancelledOnce:true,escapePauseFreezesFishAndClock:true,
   background:{nativeBlurVerified:true,blurEvents,nativeMinimizeVerified:true,minimizeEvents,minimized,hideEvents,
     hiddenClockAdvanced:afterHidden-afterBlur,blurClockAdvanced:afterBlur-beforeBlur},
   sourceFingerprint:context.sourceFingerprint,profile:context.profile,
   landscapeDisclosure:'Paused render-only camera and sun-hour previews; no actor teleport, saved time override or physics mutation.',
   fixtureDisclosure:'Manual bank exposure after real 120s warm-up; actual timed primitives and moving ecology. Not autonomous travel or policy proof.',
   nativeAttempts:expected.caught.attempts,metrics:expected.saved.metrics,
   screenshots:[...expected.screenshots,reopenedScreenshot,...landscapeScreenshots]};
 await fs.writeFile(path.join(context.output,'result.json'),JSON.stringify(report,null,2));
 await session.defaultSession.flushStorageData();
 console.log('PASS: native closed-process reopen, partial matter, physiology/proof, interrupted catch, pause and background clock.');
}
async function socialWritePhase(win) {
 await assertCurrentBoot(win);
 assert.equal(await win.webContents.executeJavaScript("localStorage.getItem('aincrad.world.v2')"),null);
 const fixture=await win.webContents.executeJavaScript('(' + ${JSON.stringify(createPeerTeachingUiFixture.toString())} + ')(document.baseURI)');
 assert.equal(fixture.saveKey,'aincrad.world.v2'); assert.equal(JSON.parse(fixture.raw).version,12);
 await win.webContents.executeJavaScript('(' + installEmptyCurrentSlot.toString() + ')(localStorage,' + JSON.stringify({key:fixture.saveKey,inputRaw:fixture.raw}) + ')');
 await fs.writeFile(path.join(context.output,'social-checkpoint.json'),JSON.stringify(fixture,null,2));
}
async function socialReopenPhase(win) {
 await assertCurrentBoot(win);
 const expected=JSON.parse(await fs.readFile(path.join(context.output,'social-checkpoint.json'),'utf8'));
 assert.equal(await win.webContents.executeJavaScript("localStorage.getItem('aincrad.world.v2')"),expected.raw);
 const present = async stage => {
   const evidence = await win.webContents.executeJavaScript('(' + ${JSON.stringify(presentPeerTeachingUi.toString())} + ')(' + JSON.stringify(stage) + ',' + JSON.stringify(expected.summary) + ')');
   await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
   return evidence;
 };
 const journal=await present('conversation');
 const screenshots=[await capture(win,'social-journal.png')];
 const knowledge=await present('knowledge');
 screenshots.push(await capture(win,'social-taught-knowledge.png'));
 const snapshot=await win.webContents.executeJavaScript('window.__ozarkWorld.fullSnapshot()');
 const receiver=snapshot.agents.find(actor=>actor.id==='mira');
 assert.equal(receiver.discovery.techniques.length,0,'Testimony cannot create personal proficiency');
 assert.equal(receiver.discovery.effects.length,0,'Testimony cannot fabricate bodily feedback');
 assert.ok(receiver.discovery.reports.some(row=>row.teaching));
 assert.equal(snapshot.elapsed,expected.summary.elapsed,'UI inspection cannot advance the encounter');
 assert.equal(await win.webContents.executeJavaScript('window.__ozarkWorld.snapshot().started'),false);
 assert.equal(await win.webContents.executeJavaScript('window.__ozarkWorld.save()'),true);
 await fs.writeFile(path.join(context.output,'social-result.json'),JSON.stringify({passed:true,
   sourceFingerprint:context.sourceFingerprint,version:snapshot.version,screenshots,journal,knowledge,
   currentFormatCloseReopen:true,ownProofNotInvented:true,summary:expected.summary,
   fixtureDisclosure:'Manual local encounter. Sender earned a procedure through paid actions and delayed bodily feedback, then actual controller speech delivered an attributed untried report. This is not autonomous survival or travel evidence.'},null,2));
}
app.on('browser-window-created',(_event,win)=>{
 win.webContents.on('console-message',(_event,...details)=>rendererEvents.push({kind:'console',details}));
 win.webContents.on('did-fail-load',(_event,errorCode,errorDescription,validatedURL)=>rendererEvents.push({kind:'load-failure',errorCode,errorDescription,validatedURL}));
 win.webContents.on('render-process-gone',(_event,details)=>rendererEvents.push({kind:'renderer-gone',details}));
 win.webContents.once('did-finish-load',async()=>{
  if(running)return;running=true;
  try {
   const prefs=win.webContents.getLastWebPreferences();
   assert.equal(prefs.nodeIntegration,false); assert.equal(prefs.contextIsolation,true);
   assert.equal(prefs.sandbox,true); assert.equal(prefs.webSecurity,true);
   assert.equal(process.argv.includes('--no-sandbox'),false);
   assert.equal(process.argv.includes('--disable-setuid-sandbox'),false);
   await fs.writeFile(path.join(context.output,phase+'-sandbox.json'),JSON.stringify({
    nodeIntegration:prefs.nodeIntegration,contextIsolation:prefs.contextIsolation,
    sandbox:prefs.sandbox,webSecurity:prefs.webSecurity},null,2));
   await ({write:writePhase,reopen:reopenPhase,'social-write':socialWritePhase,'social-reopen':socialReopenPhase}[phase])(win); await closeNormally(win);
  } catch(error) {
   console.error(error); try { await captureFailure(win,error); } catch(failure) { console.error('Failure capture:',failure); }
   clearTimeout(deadline); app.exit(1);
  }
 });
});
require(path.join(context.root,'dist/desktop/main.cjs'));
`);
await writeFile(join(output, 'prepared.json'), JSON.stringify({output,harness,sourceFingerprint:built.sourceFingerprint,nativeExecutionPerformed:false,sandboxBypassFlags:[]},null,2));
if (prepareOnly) console.log(JSON.stringify({output,harness,nativeExecutionPerformed:false}));
else {
const electron = createRequire(import.meta.url)('electron');
for (const phase of ['write', 'reopen', 'social-write', 'social-reopen']) {
  const phaseProfile=phase.startsWith('social-')?socialProfile:profile;
  const flags = [harness, '--test', `--test-profile=${phaseProfile}`, `--phase=${phase}`];
  if (process.platform === 'linux') flags.push('--disable-gpu');
  const env = { ...process.env, TMPDIR: temporary, TMP: temporary, TEMP: temporary, HOME: join(isolated, 'home'),
    XDG_CONFIG_HOME: join(isolated, 'config'), XDG_CACHE_HOME: join(isolated, 'cache') }; delete env.ELECTRON_RUN_AS_NODE;
  const { code, signal, stdout, stderr, spawnError } = await captureNativeChild(
    spawn, electron, flags, {cwd:root,stdio:['ignore','pipe','pipe'],env},
    bytes=>process.stdout.write(bytes),bytes=>process.stderr.write(bytes));
  await writeFile(join(output, phase+'-process.json'),JSON.stringify({code,signal,
    spawnError:spawnError?String(spawnError):null,processCloseObserved:true},null,2));
  await writeFile(join(output, phase+'-stdout.txt'),stdout);
  await writeFile(join(output, phase+'-stderr.txt'),stderr);
  if(spawnError)throw spawnError;
  assert.deepEqual({code,signal},{code:0,signal:null},`Native ${phase} failed; evidence retained at ${output}`);
  assert.ok(stdout.includes('AQUATIC_NATIVE_CLOSED '+phase));
  assert.ok(stdout.includes('AQUATIC_NATIVE_WILL_QUIT '+phase));

}
const report=JSON.parse(await readFile(join(output,'result.json'),'utf8'));
const socialReport=JSON.parse(await readFile(join(output,'social-result.json'),'utf8'));
assert.equal(socialReport.passed,true);
Object.assign(report,{socialTeaching:socialReport,actualNativeCloseEvents:true,actualNativeWillQuitEvents:true,nativeExecutionPerformed:true});
await writeFile(join(output,'result.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
}
} finally {
  // Copy useful profile evidence only after the native children close. Do not
  // follow Chromium socket symlinks or copy special files into CI artifacts.
  // If preservation fails, retain the original scratch profile for diagnosis.
  const profileEvidence = join(output, 'profile-evidence');
  let preserved = false;
  try {
    const archive = await archiveNativeProfile(profile, profileEvidence);
    const socialArchive = await archiveNativeProfile(socialProfile, join(output,'social-profile-evidence'));
    await writeFile(join(output, 'profile-evidence.json'), JSON.stringify({ runtimeProfile: profile,
      evidenceDirectory: profileEvidence, copiedAfterProcessesClosed: !prepareOnly, nativeExecutionPerformed: !prepareOnly, archive, socialArchive,
      omittedEntries: 'symlinks and nonregular files' }, null, 2));
    preserved = true;
  } catch (error) {
    console.error(`Could not preserve profile evidence; original retained at ${temporary}:`, error);
    process.exitCode = 1; // Do not mask an original native failure.
  }
  if (preserved) await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(error => {
    console.error(`Could not clean disposable runtime temp ${temporary}; profile evidence is at ${profileEvidence}:`, error);
    process.exitCode = 1;
  });
}
