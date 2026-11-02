/** Controlled player-to-agent food demonstration in the actual sandboxed app.
 * The authored positions are engineering geometry, not an ordinary encounter. */
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
  currentRouteSnapshot } from './carcass-native-contract.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const prepareOnly = process.argv.includes('--prepare-only');
assert.ok(process.argv.slice(2).every(arg => arg === '--prepare-only'), 'Only --prepare-only is supported');
if (!prepareOnly && !['linux', 'darwin'].includes(process.platform))
  throw new Error('Player-food native QA supports Linux and macOS only.');
if (!prepareOnly && process.getuid?.() === 0)
  throw new Error('Player-food native QA requires an unprivileged runtime; sandbox bypass is prohibited.');
if (!prepareOnly && process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY)
  throw new Error('Player-food native QA requires a display and window manager.');

// Serialized into the renderer in the authoring process. Only positions are
// authored before any time or action; all later resource and body changes go
// through the actual player UI and ordinary fixed-step simulation.
async function authorPlayerFoodScene(moduleBase) {
  const use = name => import(new URL('src/' + name + '.js', moduleBase).href);
  const { CONFIG } = await use('config');
  const { createOzarkWorldGeometry } = await use('ozark-world-geometry');
  const { createOzarkState, writeOzarkSave, OZARK_SAVE_KEY } = await use('ozark-save');
  const { createPlayerFoodController } = await use('player-food');
  const geometry = createOzarkWorldGeometry();
  const state = createOzarkState(geometry, { communicationSeed: 211 });
  const plants = state.environment.ecology.plants.filter(plant =>
    plant.kind === 'apple_tree' && plant.quantity > 3 && plant.stage === 'ripe');
  plants.sort((a, b) => Math.hypot(a.position.x - 276, a.position.y - 760) -
    Math.hypot(b.position.x - 276, b.position.y - 760));
  let source = null, point = null;
  for (const plant of plants) {
    for (let index = 0; index < 16; index++) {
      const angle = index * Math.PI / 8;
      const candidate = { x: plant.position.x + 48 * Math.cos(angle),
        y: plant.position.y + 48 * Math.sin(angle) };
      if (geometry.canOccupy(candidate.x, candidate.y, CONFIG.playerRadius) &&
          geometry.lineOfSight(candidate, plant.position)) {
        source = plant; point = candidate; break;
      }
    }
    if (source) break;
  }
  if (!source) throw new Error('No authentic visible ripe apple-tree engineering site');
  state.player = { ...point };
  state.agents[0].position = { ...point };
  const firstOption = createPlayerFoodController(state, geometry).visibleOptions()[0];
  if (firstOption?.targetId !== source.id || !firstOption.actions.includes('pull'))
    throw new Error('Authored source is not the first real visible food option');
  if (localStorage.getItem(OZARK_SAVE_KEY) !== null) throw new Error('Disposable profile was not empty');
  if (!writeOzarkSave(localStorage, state, geometry)) throw new Error('Authored current-world save failed validation');
  const raw = localStorage.getItem(OZARK_SAVE_KEY);
  if (!raw) throw new Error('Authored save was not retained');
  return { raw, sourceId: source.id, sourcePosition: { ...source.position },
    point, sourceQuantity: source.quantity, playerId: 'player', witnessId: state.agents[0].id,
    fixtureDisclosure: 'Fresh normal Ozark ecology with physical seed 74193 and communication seed 211. Player and Aster are placed together near an existing ripe apple tree before time or action. No food, crop, body outcome, learner state, action, or reward is injected. The later UI actions and agent observation are physical; this is not an ordinary encounter.' };
}

const outputRoot = resolve(process.env.AINCRAD_PLAYER_FOOD_QA_OUTPUT || join(root, 'test-results/player-food-desktop'));
await mkdir(outputRoot, { recursive: true });
const output = await mkdtemp(join(outputRoot, 'run-'));
const temporary = await mkdtemp(join(tmpdir(), 'player-food-'));
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
assert.ok(['author', 'act', 'reopen'].includes(phase));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const authorScene = ${authorPlayerFoodScene.toString()};
const currentRouteSnapshot = ${currentRouteSnapshot.toString()};
const captureWithReadiness = ${captureWithReadiness.toString()};
let running = false, closeObserved = false, allowQuit = false;
const rendererEvents = [], closeEvents = [];
const deadline = setTimeout(() => { console.error('Player-food native QA timed out: ' + phase); app.exit(1); }, 300000);
app.on('will-quit', event => { if (!allowQuit) { event.preventDefault(); return; }
  if (!closeObserved) process.exitCode = 1;
  else console.log('PLAYER_FOOD_NATIVE_WILL_QUIT ' + phase);
});
async function evaluate(win, source) { return win.webContents.executeJavaScript(source); }
async function waitFor(win, expression) {
  for (let i = 0; i < 400; i++) {
    try { if (await evaluate(win, expression)) return; } catch {}
    await delay(50);
  }
  throw new Error('Native condition missing: ' + expression);
}
async function clickButton(win, id, {allowDisabled=false}={}) {
  const box = await evaluate(win, '(() => { const button=document.getElementById(' + JSON.stringify(id) + ');' +
    'if(!button||' + (allowDisabled?'false':'button.disabled') + '||button.getClientRects().length!==1)throw new Error("Food button unavailable: ' + id + '");' +
    'button.scrollIntoView({block:"nearest"});const rect=button.getBoundingClientRect();' +
    'const x=Math.round(rect.left+rect.width/2),y=Math.round(rect.top+rect.height/2);' +
    'if(x<0||y<0||x>=innerWidth||y>=innerHeight||!button.contains(document.elementFromPoint(x,y)))' +
    'throw new Error("Food button is outside or obscured: ' + id + '");return {x,y};})()');
  win.webContents.focus();
  win.webContents.sendInputEvent({type:'mouseMove',x:box.x,y:box.y});
  win.webContents.sendInputEvent({type:'mouseDown',button:'left',x:box.x,y:box.y,clickCount:1});
  win.webContents.sendInputEvent({type:'mouseUp',button:'left',x:box.x,y:box.y,clickCount:1});
  await delay(60);
}
async function driveUntil(win, predicate, maxSteps = 100) {
  for (let i = 0; i < maxSteps; i++) {
    const reached = await evaluate(win, '(() => {if(!window.__ozarkWorld.step(.1))throw new Error("Fixed step refused");return (' + predicate + ');})()');
    if (reached) return i + 1;
  }
  throw new Error('Paid action did not reach expected state: ' + predicate);
}
async function capture(win, name) {
  const ui=await evaluate(win,'(() => {const panel=document.getElementById("player-food-panel");' +
    'const status=document.getElementById("player-food-status");' +
    'const nearby=document.getElementById("player-food-nearby");' +
    'if(!panel||!status||!nearby||getComputedStyle(panel).display==="none"||' +
    '!status.textContent||!nearby.textContent)throw new Error("Food HUD is not visible for capture");' +
    'const r=panel.getBoundingClientRect();if(r.width<=0||r.height<=0||r.left<0||r.top<0||' +
    'r.right>innerWidth||r.bottom>innerHeight)throw new Error("Food HUD is outside viewport");' +
    'return {status:status.textContent,nearby:nearby.textContent,rect:{x:r.x,y:r.y,width:r.width,height:r.height}};})()');
  const {png,metadata} = await captureWithReadiness({
    prepare:async()=>{const readiness=await evaluate(win,'(' + ${JSON.stringify(waitForCaptureFrames.toString())} + ')()');
      await delay(100);return readiness;},
    capture:()=>win.webContents.capturePage(),
    retain:async(bytes,attempt)=>{const prefix=path.join(context.output,name+'.attempt-'+attempt.attempt);
      if(bytes!==undefined)await fs.writeFile(prefix+'.png',bytes);
      await fs.writeFile(prefix+'.json',JSON.stringify({phase,name,...attempt},null,2));},
  });
  assert.ok(png.length>10000,'Actual native world screenshot must be nonempty');
  await fs.writeFile(path.join(context.output,name),png);
  return {file:name,bytes:png.length,width:metadata.width,height:metadata.height,
    captureAttempts:metadata.attempt,ui};
}
function assertCurrentRoute(route) {
  assert.equal(route.url,'aincrad://app/index.html?test=1');
  assert.equal(route.hook,true);assert.equal(route.chooserPresent,false);
  assert.equal(route.retiredWorldBridge,false);assert.equal(route.retiredProfileBridge,false);
  assert.equal(route.snapshot?.blocked,false);assert.equal(route.snapshot?.started,false);
  assert.equal(route.snapshot?.features?.characterMessages,2);
  assert.equal(route.snapshot?.features?.playerFood,1);
}
async function authorPhase(win) {
  assert.equal(await evaluate(win,"localStorage.getItem('aincrad.world.v2')"),null);
  const authored=await evaluate(win,'(' + authorScene.toString() + ')(document.baseURI)');
  await fs.writeFile(path.join(context.output,'authored.json'),JSON.stringify(authored,null,2));
  await session.defaultSession.flushStorageData();
}
async function actPhase(win) {
  const authored=JSON.parse(await fs.readFile(path.join(context.output,'authored.json'),'utf8'));
  assert.equal(await evaluate(win,"localStorage.getItem('aincrad.world.v2')"),authored.raw);
  const original=await evaluate(win,'window.__ozarkWorld.fullSnapshot()');
  assert.deepEqual(original.player,authored.point);
  assert.deepEqual(original.agents.find(n=>n.id===authored.witnessId).position,authored.point);
  assert.equal(original.environment.ecology.plants.find(p=>p.id===authored.sourceId).quantity,authored.sourceQuantity);
  const reads=await evaluate(win,'(() => {const first=window.__ozarkWorld.playerFoodSnapshot();' +
    'const second=window.__ozarkWorld.playerFoodSnapshot();' +
    'try{first.held.push("object:999");}catch{}' +
    'return {second,third:window.__ozarkWorld.playerFoodSnapshot()};})()');
  assert.deepEqual(reads.second,reads.third,'Actor-local food readout is defensive');
  assert.deepEqual(await evaluate(win,'window.__ozarkWorld.fullSnapshot()'),original,
    'Repeated readout cannot move resources or train a learner');
  assert.equal(await evaluate(win,'window.__ozarkWorld.start()'),true);
  // Eating without a held portion is unavailable through the same trusted UI.
  await clickButton(win,'player-food-taste',{allowDisabled:true});
  assert.equal(await evaluate(win,'window.__ozarkWorld.playerFoodSnapshot().active'),null);
  assert.equal(await evaluate(win,'window.__ozarkWorld.fullSnapshot().playerFood.physiology.totals.ingestedKcal'),
    original.playerFood.physiology.totals.ingestedKcal);
  await waitFor(win,"!document.getElementById('player-food-gather').disabled");
  await clickButton(win,'player-food-gather');
  // Repeated trusted input to a disabled button cannot admit another action.
  const firstAction=await evaluate(win,'window.__ozarkWorld.playerFoodSnapshot()');
  assert.equal(firstAction.active?.type,'pull');
  const firstStock=await evaluate(win,'window.__ozarkWorld.fullSnapshot().environment.ecology.plants.find(p=>p.id===' +
    JSON.stringify(authored.sourceId) + ').quantity');
  assert.equal(await evaluate(win,"document.getElementById('player-food-gather').disabled"),true,
    'Gather must be disabled while its first paid action remains active');
  await clickButton(win,'player-food-gather',{allowDisabled:true});
  const afterRepeatedClick=await evaluate(win,'window.__ozarkWorld.playerFoodSnapshot()');
  assert.deepEqual(afterRepeatedClick.held,firstAction.held,
    'A disabled repeated click cannot transfer another portion');
  for(const key of ['type','targetId','seconds','startedAt','expiresAt'])
    assert.equal(afterRepeatedClick.active?.[key],firstAction.active[key],
      'A disabled repeated click cannot replace or reschedule the paid action: '+key);
  assert.ok(afterRepeatedClick.active.worked>=firstAction.active.worked &&
    afterRepeatedClick.active.worked<=afterRepeatedClick.active.seconds,
  'The same paid action may advance while the native click is delivered');
  assert.equal(await evaluate(win,'window.__ozarkWorld.fullSnapshot().environment.ecology.plants.find(p=>p.id===' +
    JSON.stringify(authored.sourceId) + ').quantity'),firstStock,
  'A disabled repeated click cannot take an extra fruit before the paid pull completes');
  await driveUntil(win,'window.__ozarkWorld.fullSnapshot().playerFood.inventory.items.length===1');
  const gathered=await evaluate(win,'window.__ozarkWorld.fullSnapshot()');
  assert.ok(gathered.playerFood.physiology.totals.metabolizedKcal>
    original.playerFood.physiology.totals.metabolizedKcal,'Paid pull must debit actual metabolism');
  assert.ok(gathered.playerFood.physiology.availableEnergyKcal<
    original.playerFood.physiology.availableEnergyKcal,'Paid pull must debit available energy');
  assert.ok(gathered.playerBody.stamina<original.playerBody.stamina,
    'Paid pull must debit avatar stamina despite main-loop rest recovery');
  assert.equal(gathered.playerBody.stamina,gathered.playerFood.physiology.stamina);
  const materialId=gathered.playerFood.inventory.items[0];
  const material=gathered.environment.ecology.materials.find(m=>m.id===materialId);
  assert.equal(material?.materialType,'apple','The authored real apple tree must yield a real apple');
  assert.equal(material.heldBy,'player');
  assert.equal(gathered.environment.ecology.plants.find(p=>p.id===authored.sourceId).quantity,authored.sourceQuantity-1);
  const beforeTaste=gathered.playerFood.physiology.totals.ingestedKcal;
  await waitFor(win,"!document.getElementById('player-food-taste').disabled");
  await clickButton(win,'player-food-taste');
  await driveUntil(win,'window.__ozarkWorld.fullSnapshot().playerFood.physiology.totals.ingestedKcal>' + beforeTaste);
  const tasted=await evaluate(win,'window.__ozarkWorld.fullSnapshot()');
  const inquiry=tasted.agents.find(n=>n.id===authored.witnessId).discovery.inquiries.find(q=>q.sourceId===materialId);
  assert.ok(inquiry,'Aster must personally see the completed player swallow');
  assert.equal(inquiry.actorId,'player');
  assert.equal(inquiry.attempts.length,0,'Witness does not inherit a paid self-trial');
  assert.equal(inquiry.retired,false);
  assert.ok(tasted.environment.ecology.materials.find(m=>m.id===materialId).massGrams<material.massGrams);
  assert.equal(tasted.playerFood.inventory.items.length,1);
  await waitFor(win,"!document.getElementById('player-food-drop').disabled");
  await clickButton(win,'player-food-drop');
  await driveUntil(win,'window.__ozarkWorld.fullSnapshot().playerFood.inventory.items.length===0');
  const dropped=await evaluate(win,'window.__ozarkWorld.fullSnapshot()');
  assert.equal(dropped.environment.ecology.materials.find(m=>m.id===materialId).heldBy,null);
  assert.ok(dropped.agents.find(n=>n.id===authored.witnessId).discovery.inquiries.some(q=>q.sourceId===materialId));
  // A second action is interrupted after a certified partial step. No second
  // fruit may appear merely because the player pauses and saves.
  await waitFor(win,"!document.getElementById('player-food-gather').disabled");
  await clickButton(win,'player-food-gather');
  assert.equal(await evaluate(win,'window.__ozarkWorld.step(.1)'),true);
  const beforeCancel=await evaluate(win,'window.__ozarkWorld.fullSnapshot()');
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'ESC'});
  win.webContents.sendInputEvent({type:'keyUp',keyCode:'ESC'});
  await waitFor(win,'window.__ozarkWorld.snapshot().paused');
  assert.deepEqual((await evaluate(win,'window.__ozarkWorld.fullSnapshot()')).playerFood.inventory,beforeCancel.playerFood.inventory);
  assert.equal(await evaluate(win,'window.__ozarkWorld.save()'),true);
  const raw=await evaluate(win,"localStorage.getItem('aincrad.world.v2')");
  await session.defaultSession.flushStorageData();
  await evaluate(win,"document.getElementById('pause-panel').classList.add('hidden')");
  const beforeCapture=await evaluate(win,'window.__ozarkWorld.fullSnapshot()');
  const screenshot=await capture(win,'01-player-food-demo-world.png');
  const final=await evaluate(win,'window.__ozarkWorld.fullSnapshot()');
  assert.deepEqual(final,beforeCapture,'Canvas capture cannot create food or learning');
  assert.equal(await evaluate(win,"localStorage.getItem('aincrad.world.v2')"),raw,
    'Canvas capture cannot rewrite the exact saved bytes');
  await fs.writeFile(path.join(context.output,'act-checkpoint.json'),JSON.stringify({raw,authored,
    materialId,inquiry,initialPlantQuantity:authored.sourceQuantity,
    final,ingestedKcal:final.playerFood.physiology.totals.ingestedKcal,screenshots:[screenshot]},null,2));
}
async function reopenPhase(win) {
  const checkpoint=JSON.parse(await fs.readFile(path.join(context.output,'act-checkpoint.json'),'utf8'));
  assert.equal(await evaluate(win,"localStorage.getItem('aincrad.world.v2')"),checkpoint.raw);
  const opened=await evaluate(win,'window.__ozarkWorld.fullSnapshot()');
  assert.deepEqual(opened.playerFood,checkpoint.final.playerFood,'No duplicate swallow, holding or pending action after reopening');
  assert.deepEqual(opened.environment.ecology,checkpoint.final.environment.ecology,'Finite food stocks and ledger resume exactly');
  assert.deepEqual(opened.agents.map(n=>n.discovery.inquiries),checkpoint.final.agents.map(n=>n.discovery.inquiries));
  assert.equal(opened.playerFood.inventory.items.length,0);
  assert.equal(opened.playerFood.physiology.totals.ingestedKcal,checkpoint.ingestedKcal);
  assert.equal(await evaluate(win,'window.__ozarkWorld.playerFoodSnapshot().active'),null);
  assert.equal(await evaluate(win,'window.__ozarkWorld.start()'),true);
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'ESC'});
  win.webContents.sendInputEvent({type:'keyUp',keyCode:'ESC'});
  await waitFor(win,'window.__ozarkWorld.snapshot().paused');
  await evaluate(win,"document.getElementById('pause-panel').classList.add('hidden')");
  const before=await evaluate(win,'window.__ozarkWorld.fullSnapshot()');
  const screenshot=await capture(win,'02-reopened-player-food-world.png');
  assert.deepEqual(await evaluate(win,'window.__ozarkWorld.fullSnapshot()'),before,'Rendering cannot create learning or consume food');
  await fs.writeFile(path.join(context.output,'result.json'),JSON.stringify({passed:true,nativeExecutionPerformed:true,
    sourceIdentity:context.sourceIdentity,sourceFingerprint:context.sourceFingerprint,
    actualTrustedPlayerInput:true,realFruitAndBodyDebit:true,uncertainPlayerWitness:true,
    noCopiedAgentProof:true,repeatAndPauseNoDuplicate:true,exactSaveReopen:true,
    screenshots:[...checkpoint.screenshots,screenshot],fixtureDisclosure:checkpoint.authored.fixtureDisclosure,
    scope:'Controlled player UI fruit handling and one agent-visible swallow in actual sandboxed Electron. The inquiry is uncertain; native proof does not claim autonomous recipient trial, learned category transfer, ordinary encounter rate or survival benefit.'},null,2));
}
async function closeNormally(win) {
  await session.defaultSession.flushStorageData();await delay(200);
  const closed=new Promise(resolve=>win.once('closed',()=>{closeObserved=true;closeEvents.push('closed');resolve();}));
  win.once('close',()=>closeEvents.push('close'));win.close();await closed;
  assert.deepEqual(closeEvents,['close','closed']);assert.equal(win.isDestroyed(),true);
  await fs.writeFile(path.join(context.output,phase+'-close.json'),JSON.stringify({phase,events:closeEvents,destroyed:true},null,2));
  clearTimeout(deadline);allowQuit=true;app.quit();
}
app.on('browser-window-created',(_event,win)=>{
  win.webContents.on('console-message',(_event,...details)=>rendererEvents.push({kind:'console',details}));
  win.webContents.on('did-fail-load',(_event,...details)=>rendererEvents.push({kind:'load-failure',details}));
  win.webContents.on('render-process-gone',(_event,details)=>rendererEvents.push({kind:'renderer-gone',details}));
  win.webContents.once('did-finish-load',async()=>{
    if(running)return;running=true;
    try {
      const prefs=win.webContents.getLastWebPreferences();
      assert.equal(prefs.nodeIntegration,false);assert.equal(prefs.contextIsolation,true);
      assert.equal(prefs.sandbox,true);assert.equal(prefs.webSecurity,true);
      assert.equal(process.argv.includes('--no-sandbox'),false);
      assert.equal(process.argv.includes('--disable-setuid-sandbox'),false);
      await fs.writeFile(path.join(context.output,phase+'-sandbox.json'),JSON.stringify({
        sourceIdentity:context.sourceIdentity,platform:process.platform,arch:process.arch,electron:process.versions.electron,
        nodeIntegration:prefs.nodeIntegration,contextIsolation:prefs.contextIsolation,sandbox:prefs.sandbox,webSecurity:prefs.webSecurity},null,2));
      await waitFor(win,'Boolean(window.__ozarkWorld)');
      assert.equal(await evaluate(win,"import('./src/build-info.js').then(m=>m.BUILD_SOURCE_FINGERPRINT)"),context.sourceFingerprint);
      assertCurrentRoute(await evaluate(win,'('+currentRouteSnapshot.toString()+')(window,document)'));
      await ({author:authorPhase,act:actPhase,reopen:reopenPhase}[phase])(win);
      await closeNormally(win);
    }catch(error){
      console.error(error);const failure={phase,error:String(error?.stack||error),rendererEvents};
      try{failure.url=win.webContents.getURL();await fs.writeFile(path.join(context.output,phase+'-failure.png'),(await win.webContents.capturePage()).toPNG());}
      catch(captureError){failure.captureError=String(captureError);}
      await fs.writeFile(path.join(context.output,phase+'-failure.json'),JSON.stringify(failure,null,2));
      clearTimeout(deadline);app.exit(1);
    }
  });
});
require(path.join(context.root,'dist/desktop/main.cjs'));
`);
  await writeFile(join(output, 'prepared.json'), JSON.stringify({ output, harness,
    phases: ['author', 'act', 'reopen'], sourceIdentity: context.sourceIdentity,
    sourceFingerprint: built.sourceFingerprint, nativeExecutionPerformed: false,
    sandboxBypassFlags: [] }, null, 2));
  if (prepareOnly) console.log(JSON.stringify({ output, harness, nativeExecutionPerformed: false }));
  else {
    const electron = createRequire(import.meta.url)('electron');
    for (const phase of ['author', 'act', 'reopen']) {
      const flags = [harness, '--test', `--test-profile=${profile}`, `--phase=${phase}`];
      if (process.platform === 'linux') flags.push('--disable-gpu');
      const env = { ...process.env, TMPDIR: temporary, TMP: temporary, TEMP: temporary,
        HOME: join(isolated, 'home'), XDG_CONFIG_HOME: join(isolated, 'config'),
        XDG_CACHE_HOME: join(isolated, 'cache') };
      delete env.ELECTRON_RUN_AS_NODE;
      nativeProcessesClosed = false;
      const result = await captureNativeChild(spawn, electron, flags,
        { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env },
        bytes => process.stdout.write(bytes), bytes => process.stderr.write(bytes));
      nativeProcessesClosed = true;
      if (!result.spawnError) nativeProcessesStarted++;
      await writeFile(join(output, phase + '-process.json'), JSON.stringify({
        code: result.code, signal: result.signal, spawnError: result.spawnError ? String(result.spawnError) : null,
        processCloseObserved: true }, null, 2));
      await writeFile(join(output, phase + '-stdout.txt'), result.stdout);
      await writeFile(join(output, phase + '-stderr.txt'), result.stderr);
      if (result.spawnError) throw result.spawnError;
      assert.deepEqual({code:result.code,signal:result.signal},{code:0,signal:null},
        `Native ${phase} failed; retained evidence: ${output}`);
      assert.ok(result.stdout.includes('PLAYER_FOOD_NATIVE_WILL_QUIT ' + phase));
    }
    const report = JSON.parse(await readFile(join(output, 'result.json'), 'utf8'));
    console.log(JSON.stringify(report));
  }
} finally {
  let preserved = false;
  if (nativeProcessesClosed) try {
    const archive = await archiveNativeProfile(profile, join(output, 'profile-evidence'));
    await writeFile(join(output, 'profile-evidence.json'), JSON.stringify({ runtimeProfile: profile,
      copiedAfterProcessesClosed: nativeProcessesStarted > 0,
      nativeExecutionPerformed: nativeProcessesStarted > 0, archive }, null, 2));
    preserved = true;
  } catch (error) {
    console.error('Profile preservation failed; original retained at ' + temporary, error);
    process.exitCode = 1;
  }
  if (preserved) await rm(temporary, {recursive:true,force:true,maxRetries:3,retryDelay:100}).catch(error=>{
    console.error('Disposable profile cleanup failed: ' + temporary, error);process.exitCode=1;
  });
}
