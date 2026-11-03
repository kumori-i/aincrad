/** Controlled player-to-agent word and point demonstration in the actual sandboxed app.
 * The authored positions are engineering geometry, not an ordinary encounter. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApplication } from './build.mjs';
import { CONFIG } from '../src/config.js';
import { advancePlayerLessonFixedSteps } from './player-lesson-fixed-steps.mjs';
import { verifyPlayerLessonCaptureProgress } from './player-lesson-capture-contract.mjs';
import { captureWithReadiness, waitForCaptureFrames } from './native-capture-readiness.mjs';
import { nativeSourceIdentity, captureNativeChild, archiveNativeProfile,
  currentRouteSnapshot } from './carcass-native-contract.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const prepareOnly = process.argv.includes('--prepare-only');
assert.ok(process.argv.slice(2).every(arg => arg === '--prepare-only'), 'Only --prepare-only is supported');
if (!prepareOnly && !['linux', 'darwin'].includes(process.platform))
  throw new Error('Player-lesson native QA supports Linux and macOS only.');
if (!prepareOnly && process.getuid?.() === 0)
  throw new Error('Player-lesson native QA requires an unprivileged runtime; sandbox bypass is prohibited.');
if (!prepareOnly && process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY)
  throw new Error('Player-lesson native QA requires a display and window manager.');

// Serialized into the renderer in the authoring process. Only positions are
// authored before any time or action; all later resource and body changes go
// through the actual player UI and ordinary fixed-step simulation.
async function authorPlayerLessonScene(moduleBase) {
  const use = name => import(new URL('src/' + name + '.js', moduleBase).href);
  const { CONFIG } = await use('config');
  const { createOzarkWorldGeometry } = await use('ozark-world-geometry');
  const { createOzarkState, writeOzarkSave, OZARK_SAVE_KEY } = await use('ozark-save');
  const { bindOzarkWorldAgent } = await use('ozark-agent-world');
  const { referenceGeometry } = await use('discovery-actions');
  const { perceiveReferenceGeometry } = await use('visual-reference-perception');
  const { createPlayerLessonController } = await use('player-lesson-action');
  const { createCommunicationPixelSensor } = await use('communication-pixels');
  const geometry = createOzarkWorldGeometry();
  const state = createOzarkState(geometry, { communicationSeed: 211 });
  // Preserve fixed agent spawns: moving an actor at time zero would make its
  // first real observations violate the strict spawn-reach evidence boundary.
  const point = {x:276,y:620};
  state.player = {...point};
  if (!geometry.canOccupy(point.x,point.y,CONFIG.playerRadius))
    throw new Error('Declared player point is not occupiable');
  const source = state.environment.ecology.plants.find(row=>row.id==='object:671');
  for (const actor of state.agents) {
    const spawn=geometry.agentSpawns[actor.id];
    if(actor.position.x!==spawn.x||actor.position.y!==spawn.y)
      throw new Error('Fresh actor departed its fixed spawn before time or action');
    bindOzarkWorldAgent(actor,geometry,state);
  }
  // Prospectively fixed existing instances: one apple and one bramble receive
  // paid labels; a different instance of each is only read for evaluation.
  const trainedBramble=state.environment.ecology.plants.find(row=>row.id==='object:677');
  const heldApple=state.environment.ecology.plants.find(row=>row.id==='object:679');
  const heldBramble=state.environment.ecology.plants.find(row=>row.id==='object:670');
  if (source?.kind!=='apple_tree'||trainedBramble?.kind!=='bramble'||heldApple?.kind!=='apple_tree'||
      heldBramble?.kind!=='bramble'||[source,trainedBramble,heldApple,heldBramble].some(row=>
        row.stage!=='ripe'||row.quantity<=3))
    throw new Error('Prospective distinct existing plant instances changed');
  // Existing objects only; fixed authored geometry, not selected by pixel score.
  source.position={x:180,y:540};
  trainedBramble.position={x:380,y:620};
  heldApple.position={x:140,y:700};
  heldBramble.position={x:380,y:730};
  const ids=[source.id,trainedBramble.id,heldApple.id,heldBramble.id];
  const sender={id:'player',lifecycle:'AWAKE',scene:'valley',position:point};
  for (const target of [source,trainedBramble]) {
    const pose=referenceGeometry(point,target.position,'valley',.5);
    const result=perceiveReferenceGeometry(state.agents[0],sender,pose,state);
    if (result.reason!=='resolved'||result.objectId!==target.id)
      throw new Error('Ordinary parser sight is not unique for '+target.id+': '+result.reason);
  }
  const sensor=createCommunicationPixelSensor(document);
  const cropLengths=ids.map(id=>{
    const crop=sensor.captureVisible(state.agents[0],state,id);
    if (crop?.features?.length!==48||crop?.pixels?.length!==768||
        crop.features.some(value=>!Number.isFinite(value)))
      throw new Error('Recipient lacks genuine Canvas crop for '+id);
    return crop.features.length;
  });
  sensor.dispose();
  const controller=createPlayerLessonController({state,geometry,
    pixelSensor:{captureVisible:()=>null},getLineage:()=>state.worldLineage,onLessons:()=>{}});
  const options=controller.visibleOptions().map(row=>row.targetId);
  controller.dispose();
  if (![source.id,trainedBramble.id].every(id=>options.includes(id)))
    throw new Error('Both training targets must occur in the genuine UI selector');
  if (localStorage.getItem(OZARK_SAVE_KEY) !== null)
    throw new Error('Disposable profile was not empty');
  if (!writeOzarkSave(localStorage,state,geometry))
    throw new Error('Authored current-world save failed validation');
  const raw = localStorage.getItem(OZARK_SAVE_KEY);
  if (!raw) throw new Error('Authored save was not retained');
  return {raw,sourceId:source.id,brambleId:trainedBramble.id,
    heldoutAppleId:heldApple.id,heldoutBrambleId:heldBramble.id,
    sourcePosition:{...source.position},point,recipientPosition:{...state.agents[0].position},agentPositions:state.agents.map(actor=>({id:actor.id,position:{...actor.position}})),sourceQuantity:source.quantity,
    recipientId:state.agents[0].id,parserReasons:['resolved','resolved'],cropLengths,
    fixtureDisclosure:'Fresh normal Ozark ecology with physical seed 74193 and communication seed 211. Aster and Mira retain their original fixed spawns. Only the player and four existing plant positions are authored before time or action: player (276,620), training apple object:671 (180,540), training bramble object:677 (380,620), held-out apple object:679 (140,700), held-out bramble object:670 (380,730). The authored plants are separated from the player to keep their crowns off the avatar and short pointing segment. The player is initially outside Mira’s ordinary peer-gesture range; Aster resolves both trained points uniquely. No resource, pixel, label, body outcome, action, or learner is injected. This is authored engineering geometry, not an ordinary encounter or evidence of language emergence.'};
}
const outputRoot = resolve(process.env.AINCRAD_PLAYER_LESSON_QA_OUTPUT || join(root, 'test-results/player-lesson-desktop'));
await mkdir(outputRoot, { recursive: true });
const output = await mkdtemp(join(outputRoot, 'run-'));
const temporary = await mkdtemp(join(tmpdir(), 'player-lesson-'));
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
const authorScene = ${authorPlayerLessonScene.toString()};
const currentRouteSnapshot = ${currentRouteSnapshot.toString()};
const captureWithReadiness = ${captureWithReadiness.toString()};
const advancePlayerLessonFixedSteps = ${advancePlayerLessonFixedSteps.toString()};
const verifyPlayerLessonCaptureProgress = ${verifyPlayerLessonCaptureProgress.toString()};
const FIXED_STEP = ${JSON.stringify(CONFIG.fixedStep)};
let running = false, closeObserved = false, allowQuit = false;
const rendererEvents = [], closeEvents = [];
const deadline = setTimeout(() => { console.error('Player-lesson native QA timed out: ' + phase); app.exit(1); }, 300000);
app.on('will-quit', event => { if (!allowQuit) { event.preventDefault(); return; }
  if (!closeObserved) process.exitCode = 1;
  else console.log('PLAYER_LESSON_NATIVE_WILL_QUIT ' + phase);
});
async function evaluate(win, source) { return win.webContents.executeJavaScript(source); }
async function waitFor(win, expression) {
  for (let i = 0; i < 400; i++) {
    try { if (await evaluate(win, expression)) return; } catch {}
    const saveFailure=await evaluate(win,'window.__ozarkWorld?.saveFailure?.()').catch(()=>null);
    if(saveFailure?.validation)throw new Error('Native live save validation failed: '+JSON.stringify(saveFailure));
    await delay(50);
  }
  throw new Error('Native condition missing: ' + expression);
}
async function clickButton(win, id, {allowDisabled=false,settleMs=60}={}) {
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
  if(settleMs)await delay(settleMs);
}
function fixedStepExpression(seconds) {
  return '('+advancePlayerLessonFixedSteps.toString()+')(window.__ozarkWorld.step,'+
    FIXED_STEP+','+JSON.stringify(seconds)+')';
}
async function stepSeconds(win,seconds) { return evaluate(win,fixedStepExpression(seconds)); }
async function driveUntil(win, predicate, maxSteps = 100) {
  for (let i = 0; i < maxSteps; i++) {
    const reached = await evaluate(win, '(() => {if(!'+fixedStepExpression(.1)+')throw new Error("Fixed step refused");return (' + predicate + ');})()');
    if (reached) return i + 1;
  }
  throw new Error('Paid action did not reach expected state: ' + predicate);
}
function readLessonCaptureState() {
  const s=window.__ozarkWorld.fullSnapshot();
  return {elapsed:s.elapsed,at:performance.now(),paused:window.__ozarkWorld.snapshot().paused,
    active:window.__ozarkWorld.playerLessonSnapshot().active,
    asterExamples:s.playerLessons.agents.find(row=>row.agentId==='aster').examples.length,
    miraExamples:s.playerLessons.agents.find(row=>row.agentId==='mira').examples.length,
    metabolizedKcal:s.playerFood.physiology.totals.metabolizedKcal,
    status:document.getElementById('player-lesson-status').textContent,
    nearby:document.getElementById('player-food-nearby').textContent};
}
async function captureLessonState(win) {
  return evaluate(win,'('+readLessonCaptureState.toString()+')()');
}
async function prepareCapture(win) {
  const ui=await evaluate(win,'(() => {const panel=document.getElementById("player-food-panel");' +
    'const status=document.getElementById("player-lesson-status");' +
    'const nearby=document.getElementById("player-food-nearby");' +
    'if(!panel||!status||!nearby||getComputedStyle(panel).display==="none"||' +
    '!status.textContent||!nearby.textContent)throw new Error("Food HUD is not visible for capture");' +
    'const r=panel.getBoundingClientRect();if(r.width<=0||r.height<=0||r.left<0||r.top<0||' +
    'r.right>innerWidth||r.bottom>innerHeight)throw new Error("Food HUD is outside viewport");' +
    'return {status:status.textContent,nearby:nearby.textContent,rect:{x:r.x,y:r.y,width:r.width,height:r.height}};})()');
  const readiness=await evaluate(win,'(' + ${JSON.stringify(waitForCaptureFrames.toString())} + ')()');
  await delay(100);
  return {ui,readiness};
}
async function capture(win, name, {paidPose=false,prepared=null,before=null}={}) {
  // For the timed paid frame, all asset/viewport readiness occurred BEFORE the
  // trusted start; before is the atomic post-step/post-draw witness. No further
  // renderer IPC or sleep may sit between that witness and capturePage().
  const preparation=prepared ?? await prepareCapture(win);
  const ui=paidPose&&before?{...preparation.ui,status:before.status,nearby:before.nearby}:preparation.ui;
  let witness=null,attempt=0;
  const {png,metadata} = await captureWithReadiness({
    maxAttempts:paidPose?1:4,
    prepare:async()=>++attempt===1?preparation.readiness:(await prepareCapture(win)).readiness,
    capture:async()=>{
      if(!paidPose)return win.webContents.capturePage();
      witness={before:before ?? await captureLessonState(win)};
      const image=await win.webContents.capturePage();
      witness.after=await captureLessonState(win);
      return image;
    },
    retain:async(bytes,attempt)=>{const prefix=path.join(context.output,name+'.attempt-'+attempt.attempt);
      if(bytes!==undefined)await fs.writeFile(prefix+'.png',bytes);
      await fs.writeFile(prefix+'.json',JSON.stringify({phase,name,...attempt,paidPoseWitness:witness},null,2));},
  });
  assert.ok(png.length>10000,'Actual native world screenshot must be nonempty');
  await fs.writeFile(path.join(context.output,name),png);
  if(paidPose)witness.progress=verifyPlayerLessonCaptureProgress(witness.before,witness.after);
  if(paidPose)await fs.writeFile(path.join(context.output,name+'.paid-pose.json'),JSON.stringify(witness,null,2));
  return {file:name,bytes:png.length,width:metadata.width,height:metadata.height,
    captureAttempts:metadata.attempt,ui,paidPoseWitness:witness};
}
async function captureJournal(win,name) {
  const ui=await evaluate(win,'(() => {const panel=document.getElementById("npc-panel");' +
    'const list=document.getElementById("journal-messages");' +
    'if(!panel||panel.classList.contains("hidden")||!list||' +
    '!list.querySelector("[data-player-lesson-word=nava]")||' +
    '!list.querySelector("[data-player-lesson-word=movo]"))' +
    'throw new Error("Player word rows missing from visible Learning journal");' +
    'const r=list.getBoundingClientRect();if(r.width<=0||r.height<=0)' +
    'throw new Error("Learning journal has no visible area");' +
    'const heading=Array.from(list.querySelectorAll("h3")).find(row=>' +
    'row.textContent==="Player word examples (separate from character messages)");' +
    'if(!heading)throw new Error("Player word section heading missing");' +
    'heading.scrollIntoView({block:"start"});' +
    'const all=list.textContent,at=all.indexOf(heading.textContent);' +
    'return {text:all.slice(at,at+1400),' +
    'rect:{x:r.x,y:r.y,width:r.width,height:r.height}};})()');
  assert.ok(ui.text.includes('Player word examples (separate from character messages)'));
  assert.match(ui.text,/nava · 1 own-image example/);
  assert.match(ui.text,/movo · 1 own-image example/);
  assert.match(ui.text,/This session, [0-9]+ completed own-image examples/);
  const {png,metadata}=await captureWithReadiness({
    prepare:async()=>{const readiness=await evaluate(win,'(' + ${JSON.stringify(waitForCaptureFrames.toString())} + ')()');
      await delay(100);return readiness;},
    capture:()=>win.webContents.capturePage(),
    retain:async(bytes,attempt)=>{const prefix=path.join(context.output,name+'.attempt-'+attempt.attempt);
      if(bytes!==undefined)await fs.writeFile(prefix+'.png',bytes);
      await fs.writeFile(prefix+'.json',JSON.stringify({phase,name,...attempt},null,2));},
  });
  assert.ok(png.length>10000);
  await fs.writeFile(path.join(context.output,name),png);
  return {file:name,bytes:png.length,width:metadata.width,height:metadata.height,
    captureAttempts:metadata.attempt,ui};
}
async function openLessonJournal(win) {
  await clickButton(win,'open-npc');
  await clickButton(win,'npc-tab-conversation');
  await waitFor(win,'Boolean(document.querySelector("#journal-messages [data-player-lesson-word=nava]"))&&' +
    'Boolean(document.querySelector("#journal-messages [data-player-lesson-word=movo]"))');
}
function assertCurrentRoute(route) {
  assert.equal(route.url,'aincrad://app/index.html?test=1');
  assert.equal(route.hook,true);assert.equal(route.chooserPresent,false);
  assert.equal(route.retiredWorldBridge,false);assert.equal(route.retiredProfileBridge,false);
  assert.equal(route.snapshot?.blocked,false);assert.equal(route.snapshot?.started,false);
  assert.deepEqual(route.snapshot?.features,{
    plantLifecycle:1,finiteAquatic:2,worldStructures:1,
    characterMessages:2,playerFood:1,playerLessons:1,
  });
}
async function assertLessonBankShape(win, {empty=false}={}) {
  const {bank,lineage}=await evaluate(win,'(() => {const s=window.__ozarkWorld.fullSnapshot();' +
    'return {bank:s.playerLessons,lineage:s.worldLineage};})()');
  assert.deepEqual(Object.keys(bank).sort(),['agents','version','worldId']);
  assert.equal(bank.version,1);
  assert.equal(bank.worldId,lineage.instanceId);
  assert.equal(bank.agents.length,2);
  for(let i=0;i<2;i++){
    assert.deepEqual(Object.keys(bank.agents[i]).sort(),['agentId','examples','serial']);
    assert.equal(bank.agents[i].agentId,lineage.agents[i].agentId);
    assert.equal(bank.agents[i].serial,lineage.agents[i].serial);
    assert.ok(Array.isArray(bank.agents[i].examples));
    if(empty)assert.deepEqual(bank.agents[i].examples,[],
      'Fresh or authored pre-action bank must contain no word lessons');
  }
}
async function authorPhase(win) {
  assert.equal(await evaluate(win,"localStorage.getItem('aincrad.world.v2')"),null);
  const authored=await evaluate(win,'(' + authorScene.toString() + ')(document.baseURI)');
  await fs.writeFile(path.join(context.output,'authored.json'),JSON.stringify(authored,null,2));
  await session.defaultSession.flushStorageData();
}
async function trustedTypeWord(win, word) {
  await clickButton(win,'player-lesson-word');
  assert.equal(await evaluate(win,'document.activeElement?.id'),'player-lesson-word');
  await evaluate(win,'(() => {const input=document.getElementById("player-lesson-word");' +
    'window.__lessonWordAbort?.abort();window.__lessonWordAbort=new AbortController();' +
    'window.__lessonWordTrace=[];for(const type of ["keydown","keyup","beforeinput","input"])' +
    'input.addEventListener(type,event=>{const rows=window.__lessonWordTrace;' +
    'rows.push({type:event.type,key:event.key,inputType:event.inputType,trusted:event.isTrusted,' +
    'value:input.value,start:input.selectionStart,end:input.selectionEnd});if(rows.length>96)rows.shift();},' +
    '{signal:window.__lessonWordAbort.signal});})()');
  const inspect=()=>evaluate(win,'(() => {const p=document.getElementById("player-lesson-word");return ' +
    '{value:p.value,start:p.selectionStart,end:p.selectionEnd,focused:document.activeElement===p,' +
    'events:window.__lessonWordTrace};})()');
  const before=await inspect();
  assert.ok(before.value.length<=6 && before.focused);
  // Clicking can place the caret anywhere. Backspace AND Delete remove the
  // visible bounded text on either side without platform select-all shortcuts.
  for(let i=0;i<before.value.length;i++)for(const keyCode of ['Backspace','Delete']) {
    win.webContents.sendInputEvent({type:'keyDown',keyCode});
    win.webContents.sendInputEvent({type:'keyUp',keyCode});
  }
  const cleared=await inspect();
  await fs.appendFile(path.join(context.output,phase+'-word-input.jsonl'),
    JSON.stringify({word,stage:'cleared',before,after:cleared})+'\\n');
  assert.equal(cleared.value,'','Trusted deletion must empty the real field before typing');
  assert.equal(cleared.focused,true);
  if(before.value.length>0)for(const key of ['Backspace','Delete'])assert.ok(
    cleared.events.some(event=>event.type==='keydown'&&event.key===key&&event.trusted),
    'Deletion must arrive as a real trusted native key: '+key);
  for (const letter of word)win.webContents.sendInputEvent({type:'char',keyCode:letter});
  const typed=await inspect();
  await fs.appendFile(path.join(context.output,phase+'-word-input.jsonl'),
    JSON.stringify({word,stage:'typed',after:typed})+'\\n');
  assert.equal(typed.value,word,'Actual native input must contain the complete requested word');
  assert.ok(typed.events.some(event=>event.type==='input'&&event.trusted&&event.value===word),
    'Typed word must arrive through trusted native input');
}
async function targetDiagnostic(win, step) {
  const row=await evaluate(win,'(() => { const p=document.getElementById("player-lesson-target");' +
    'return {value:p.value,disabled:p.disabled,options:Array.from(p.options,o=>({value:o.value,text:o.textContent})),' +
    'activeElement:document.activeElement?.id,focused:document.hasFocus(),hidden:document.hidden,' +
    'world:(()=>{const s=window.__ozarkWorld.snapshot();return {elapsed:s.elapsed,started:s.started,paused:s.paused,blocked:s.blocked,saveStatus:s.saveStatus};})(),' +
    'events:window.__lessonInputTrace||[],saveFailure:window.__ozarkWorld.saveFailure?.()};})()');
  await fs.appendFile(path.join(context.output,phase+'-target-selection.jsonl'),
    JSON.stringify({step,at:Date.now(),...row})+'\\n');
  return row;
}
async function trustedChooseTarget(win, sourceId) {
  await evaluate(win,'(() => { if(window.__lessonInputTrace)return;' +
    'const rows=window.__lessonInputTrace=[];let sequence=0;' +
    'for(const name of ["focus","blur","focusin","focusout","change","keydown","keypress","keyup"])' +
    'window.addEventListener(name,event=>{const p=document.getElementById("player-lesson-target");' +
    'rows.push({sequence:++sequence,type:event.type,key:event.key,target:event.target?.id,trusted:event.isTrusted,' +
    'value:p.value,disabled:p.disabled,focused:document.hasFocus(),at:performance.now()});' +
    'if(rows.length>128)rows.shift();},true);})()');
  const before=await targetDiagnostic(win,'before-Tab');
  const index=before.options.findIndex(row=>row.value===sourceId);
  assert.ok(index>0&&index<=12,'Declared real source must be present in the visible UI selector');
  // Tab from the actual typed input focuses the closed select. Clicking would
  // open an OS popup whose keyboard events may not reach webContents on Linux.
  assert.equal(await evaluate(win,'document.activeElement?.id'),'player-lesson-word');
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab'});
  win.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab'});
  await targetDiagnostic(win,'after-Tab');
  assert.equal(await evaluate(win,'document.activeElement?.id'),'player-lesson-target');
  // Mac arrows open an OS popup rather than stepping a closed select. Printable
  // typeahead cycles visible option labels on both hosts, without opening it.
  // Chromium HTMLSelectElement uses kMatchPrefix|kCycleFirstChar and resets the
  // typeahead session on blur; trustedTypeWord supplied that blur before Tab.
  const letter=before.options[index].text.trim().charAt(0).toLowerCase();
  assert.match(letter,/^[a-z]$/,'Target label must expose a printable initial');
  let current=await targetDiagnostic(win,'before-typeahead');
  for(let i=0;i<before.options.length;i++){
    const sequence=current.events.at(-1)?.sequence ?? 0;
    win.webContents.sendInputEvent({type:'char',keyCode:letter});
    current=await targetDiagnostic(win,'after-typeahead-'+i);
    assert.ok(current.events.some(event=>event.sequence>sequence&&event.type==='keypress'&&
      event.key.toLowerCase()===letter&&event.target==='player-lesson-target'&&event.trusted),
      'Printable input must arrive as a new trusted DOM keypress');
    assert.equal(current.activeElement,'player-lesson-target');
    assert.equal(current.disabled,false);
    const selected=current.options.find(row=>row.value===current.value);
    assert.ok(selected?.text.trim().toLowerCase().startsWith(letter),
      'Each trusted character must select a matching visible label');
    if(current.value===sourceId)break;
  }
  assert.equal(current.value,sourceId,'Bounded visible-label cycling must reach the requested source');
  // Commit by tabbing away, without Return opening a closed native popup.
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab'});
  win.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab'});
  await targetDiagnostic(win,'after-commit-Tab');
  await waitFor(win,'document.getElementById("player-lesson-target").value===' + JSON.stringify(sourceId));
  await targetDiagnostic(win,'selected');
}
async function trustedLesson(win, word, sourceId) {
  await trustedTypeWord(win,word);
  await trustedChooseTarget(win,sourceId);
  await waitFor(win,'!document.getElementById("player-lesson-say").disabled');
  await clickButton(win,'player-lesson-say');
  const active = await evaluate(win,'window.__ozarkWorld.playerLessonSnapshot().active');
  assert.equal(active?.word,word,'Trusted Say and point button starts the selected literal word');
  assert.equal(active.seconds,1.8);
  return active;
}
function examplesOf(state, agentId) {
  return state.playerLessons.agents.find(row=>row.agentId===agentId).examples;
}
async function actPhase(win) {
  const authored=JSON.parse(await fs.readFile(path.join(context.output,'authored.json'),'utf8'));
  assert.equal(await evaluate(win,"localStorage.getItem('aincrad.world.v2')"),authored.raw);
  const original=await evaluate(win,'window.__ozarkWorld.fullSnapshot()');
  assert.deepEqual(original.player,authored.point);
  assert.deepEqual(original.agents.map(({id,position})=>({id,position})),authored.agentPositions);
  assert.deepEqual(original.agents.find(row=>row.id===authored.recipientId).position,authored.recipientPosition);
  assert.equal(original.environment.ecology.plants.find(row=>row.id===authored.sourceId).quantity,authored.sourceQuantity);
  assert.equal(examplesOf(original,'aster').length,0);
  assert.equal(examplesOf(original,'mira').length,0);
  assert.equal(await evaluate(win,'window.__ozarkWorld.start()'),true);
  const beforeCharacter=await evaluate(win,'window.__ozarkWorld.fullSnapshot().characterMessages');
  await trustedTypeWord(win,'nava');
  await trustedChooseTarget(win,authored.sourceId);
  await waitFor(win,'!document.getElementById("player-lesson-say").disabled');
  // Do slow viewport/asset preparation before the timed action exists.
  const posePreparation=await prepareCapture(win);
  await clickButton(win,'player-lesson-say',{settleMs:0});
  // One renderer turn does admission inspection, exact paid ticks, actual draw
  // readiness, and the before-capture witness. The ordinary clock stays live.
  const early=await evaluate(win,'(async () => {const first=window.__ozarkWorld.playerLessonSnapshot().active;' +
    'if(!'+fixedStepExpression(.1)+')throw new Error("Fixed step refused");' +
    'await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));' +
    'return {first,capture:('+readLessonCaptureState.toString()+')(),' +
    'disabled:document.getElementById("player-lesson-say").disabled};})()');
  const first=early.first,paid=early.capture.active;
  assert.equal(first?.word,'nava','Trusted Say and point button starts the selected literal word');
  assert.equal(first.seconds,1.8);
  assert.ok(paid?.worked>0 && paid.worked<paid.seconds,'The public point requires actual partial paid work');
  assert.equal(early.disabled,true);
  assert.equal(early.capture.nearby,'Pointing at a visible object. Food actions can resume afterward.');
  assert.deepEqual(rendererEvents,[],'Main-loop HUD refresh and renderer remain error-free during paid point');
  assert.equal(early.capture.asterExamples,0,'A partial point does not teach');
  assert.ok(early.capture.metabolizedKcal>original.playerFood.physiology.totals.metabolizedKcal);
  const poseImage=await capture(win,'01-paid-player-point.png',
    {paidPose:true,prepared:posePreparation,before:early.capture});
  assert.deepEqual(rendererEvents,[],'Paid public-pose screenshot must not hide a renderer failure');
  await driveUntil(win,'window.__ozarkWorld.playerLessonSnapshot().active===null',40);
  const learned=await evaluate(win,'window.__ozarkWorld.fullSnapshot()');
  const own=examplesOf(learned,'aster');
  assert.equal(own.length,1,'Aster must earn one own-Canvas example after complete visible point');
  assert.equal(own[0].word,'nava');
  assert.equal(own[0].features.length,48);
  assert.ok(own[0].features.every(value=>Number.isFinite(value)&&value>=0&&value<=1));
  assert.equal(examplesOf(learned,'mira').length,0,'An unseen agent must not receive a copied example');
  assert.deepEqual(learned.characterMessages,beforeCharacter,
    'Player word lessons cannot update Aster-Mira sequence sender or listener');
  assert.equal(learned.environment.ecology.plants.find(row=>row.id===authored.sourceId).quantity,authored.sourceQuantity,
    'Pointing cannot consume a fruit');
  assert.match(await evaluate(win,'document.getElementById("player-lesson-status").textContent'),/tentative own-image link/);
  // Second literal label, same genuine paid input and recipient own sensor.
  const second=await trustedLesson(win,'movo',authored.brambleId);
  // Test disabled repeat on the separate second action, never spend the short
  // first screenshot window on a second click and its IPC/settling round trips.
  await clickButton(win,'player-lesson-say',{allowDisabled:true});
  const repeat=await evaluate(win,'window.__ozarkWorld.playerLessonSnapshot().active');
  for(const key of ['word','seconds','startedAt','expiresAt'])assert.equal(repeat?.[key],second[key]);
  assert.ok(repeat.worked>=second.worked && repeat.worked<repeat.seconds);
  await driveUntil(win,'window.__ozarkWorld.playerLessonSnapshot().active===null',40);
  const twice=await evaluate(win,'window.__ozarkWorld.fullSnapshot()');
  const learnedRows=examplesOf(twice,'aster');
  assert.deepEqual(learnedRows.map(row=>row.word),['nava','movo']);
  assert.equal(examplesOf(twice,'mira').length,0);
  assert.deepEqual(twice.characterMessages,beforeCharacter);
  // Evaluation only: these are fresh real Canvas crops from distinct existing
  // instances. IDs select audit crops, not distinct feature inputs by fiat.
  // The original paid crop's 48 pooled features are the learner's comparison;
  // object IDs never enter a learner update.
  const heldout=await evaluate(win,'(async () => {' +
    'const state=window.__ozarkWorld.fullSnapshot();' +
    'const sensorModule=await import("./src/communication-pixels.js");' +
    'const bankModule=await import("./src/player-lesson-bank.js");' +
    'const geometryModule=await import("./src/ozark-world-geometry.js");' +
    'const bindingModule=await import("./src/ozark-agent-world.js");' +
    'const geometry=geometryModule.createOzarkWorldGeometry();' +
    'for(const npc of state.agents)bindingModule.bindOzarkWorldAgent(npc,geometry,state);' +
    'const sensor=sensorModule.createCommunicationPixelSensor(document);' +
    'const actor=state.agents.find(row=>row.id==="aster");' +
    'const bank=state.playerLessons.agents.find(row=>row.agentId==="aster").examples;' +
    'const swapped=bank.map(row=>({...row,word:row.word==="nava"?"movo":"nava"}));' +
    'const ids=[' + JSON.stringify(authored.heldoutAppleId) + ',' + JSON.stringify(authored.heldoutBrambleId) + '];' +
    'const rows=ids.map(id=>{const crop=sensor.captureVisible(actor,state,id);' +
    'if(!crop||crop.features.length!==48||crop.pixels.length!==768)throw new Error("Held-out real Canvas crop missing: "+id);' +
    'const distances=bank.map(example=>Math.sqrt(example.features.reduce((sum,value,index)=>' +
    'sum+(value-crop.features[index])**2,0)/48));' +
    'const exactTrainingFeatureMatches=bank.filter(example=>' +
    'example.features.every((value,index)=>value===crop.features[index])).length;' +
    'return {id,featuresLength:crop.features.length,observedAt:crop.observedAt,' +
    'nearestTrainingRms:Math.min(...distances),exactTrainingFeatureMatches,' +
    'actual:bankModule.predictPlayerWord(bank,crop.features),' +
    'shuffled:bankModule.predictPlayerWord(swapped,crop.features)};});sensor.dispose();return rows;})()');
  assert.deepEqual(heldout.map(row=>row.id),[authored.heldoutAppleId,authored.heldoutBrambleId]);
  for(const row of heldout){
    assert.equal(row.featuresLength,48);
    assert.ok(Number.isFinite(row.nearestTrainingRms) && row.nearestTrainingRms>=0);
    assert.ok(Number.isInteger(row.exactTrainingFeatureMatches) &&
      row.exactTrainingFeatureMatches>=0 && row.exactTrainingFeatureMatches<=learnedRows.length);
    if(row.exactTrainingFeatureMatches>0)assert.equal(row.nearestTrainingRms,0);
    assert.equal(row.actual.labels,2);
    assert.equal(row.shuffled.labels,2);
    assert.deepEqual([row.actual.nearestRms,row.actual.runnerRms],
      [row.shuffled.nearestRms,row.shuffled.runnerRms]);
    if(row.actual.status==='predicted')
      assert.notEqual(row.actual.word,row.shuffled.word,'Fixed swapped-word control reverses a prediction');
  }
  const exactTrainingInputRows=heldout.filter(row=>row.exactTrainingFeatureMatches>0).length;
  await fs.writeFile(path.join(context.output,'heldout-evaluation.json'),
    JSON.stringify({rows:heldout,uniformChance:.5,exactTrainingInputRows,
      nonIdenticalTrainingInputRows:heldout.length-exactTrainingInputRows,
      comparison:'Exact equality and RMS use the 48 pooled numeric features retained by the learner, not full pixel arrays.',
      trainedIds:[authored.sourceId,authored.brambleId],
      heldoutIds:[authored.heldoutAppleId,authored.heldoutBrambleId],
      disclosure:'Two real paid examples on existing apple/bramble instances; fresh own-Canvas crops on different existing object IDs. Different IDs can yield identical 48-feature inputs. Exact input matches are counted, and the fixed swapped-word control and chance 1/2 are descriptive. No held-out outcome is used to choose or train an action.'},null,2));
  await openLessonJournal(win);
  const journalImage=await captureJournal(win,'02-player-word-learning-journal.png');
  assert.deepEqual((await evaluate(win,'window.__ozarkWorld.fullSnapshot()')).playerLessons,
    twice.playerLessons,'Journal reads and screenshots cannot add examples');
  await clickButton(win,'close-npc');
  assert.deepEqual(rendererEvents,[],'Learning journal did not hide a renderer failure');
  const savedBank=structuredClone(twice.playerLessons);
  assert.equal(await evaluate(win,'window.__ozarkWorld.save()'),true);
  const learnedRaw=await evaluate(win,"localStorage.getItem('aincrad.world.v2')");
  assert.deepEqual(JSON.parse(learnedRaw).playerLessons,savedBank);
  // A second paid point has no durable authority. Save while it is pending.
  await trustedLesson(win,'tomi',authored.sourceId);
  const pendingSave=await evaluate(win,'(() => {const w=window.__ozarkWorld;' +
    'const stepped='+fixedStepExpression(.1)+';const pending=w.playerLessonSnapshot().active;' +
    'return {stepped,pending,saved:w.save(),raw:localStorage.getItem("aincrad.world.v2"),' +
    'pauseSequence:window.__lessonInputTrace.at(-1)?.sequence??0};})()');
  const {pending,raw:pendingRaw,pauseSequence}=pendingSave;
  assert.equal(pendingSave.stepped,true);assert.equal(pendingSave.saved,true);
  assert.ok(pending?.worked>0 && pending?.worked<1.8);
  assert.deepEqual(JSON.parse(pendingRaw).playerLessons,savedBank,
    'An incomplete point persists no lesson or pending authority');
  assert.equal(pendingRaw.includes('tomi'),false,'Pending word is absent from saved bytes');
  // A running checkpoint is not the final close save: beforeunload saves again.
  // Use the real pause control to cancel pending authority and stabilize time.
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'ESC'});
  win.webContents.sendInputEvent({type:'keyUp',keyCode:'ESC'});
  await waitFor(win,'window.__ozarkWorld.snapshot().paused');
  const closeCheckpoint=await evaluate(win,'(() => {const w=window.__ozarkWorld;' +
    'return {paused:w.snapshot().paused,active:w.playerLessonSnapshot().active,saved:w.save(),' +
    'raw:localStorage.getItem("aincrad.world.v2"),world:w.fullSnapshot(),events:window.__lessonInputTrace};})()');
  assert.ok(closeCheckpoint.events.some(event=>event.sequence>pauseSequence&&event.type==='keydown'&&
    event.key==='Escape'&&event.trusted),'Pause must follow a real trusted Escape key');
  assert.equal(closeCheckpoint.paused,true);assert.equal(closeCheckpoint.active,null);
  assert.equal(closeCheckpoint.saved,true);
  const raw=closeCheckpoint.raw;
  assert.deepEqual(JSON.parse(raw).playerLessons,savedBank);
  assert.equal(raw.includes('tomi'),false);
  await delay(200);
  assert.deepEqual(await evaluate(win,'window.__ozarkWorld.fullSnapshot()'),closeCheckpoint.world,
    'The real pause keeps the final close checkpoint stable');
  await session.defaultSession.flushStorageData();
  await fs.writeFile(path.join(context.output,'act-checkpoint.json'),JSON.stringify({raw,pendingRaw,closeCheckpoint,authored,
    savedBank,learnedRaw,poseImage,journalImage,paidSeconds:pending.worked},null,2));
}
async function reopenPhase(win) {
  const checkpoint=JSON.parse(await fs.readFile(path.join(context.output,'act-checkpoint.json'),'utf8'));
  assert.equal(await evaluate(win,"localStorage.getItem('aincrad.world.v2')"),checkpoint.raw);
  const opened=await evaluate(win,'window.__ozarkWorld.fullSnapshot()');
  assert.deepEqual(opened.playerLessons,checkpoint.savedBank,
    'Completed own-image example resumes exactly; pending second point does not');
  assert.equal(await evaluate(win,'window.__ozarkWorld.playerLessonSnapshot().active'),null);
  assert.equal(await evaluate(win,'window.__ozarkWorld.start()'),true);
  const reads=await evaluate(win,'(() => {const w=window.__ozarkWorld,before=w.fullSnapshot();' +
    'const a=w.playerLessonSnapshot();try{a.active={word:"forged"}}catch{}' +
    'const b=w.playerLessonSnapshot();return {before,after:w.fullSnapshot(),active:b.active};})()');
  assert.equal(reads.active,null);
  assert.deepEqual(reads.after,reads.before,
    'Repeated lesson reads in one JS turn cannot train or mutate the world');
  await openLessonJournal(win);
  const reopenedJournal=await captureJournal(win,'03-reopened-player-word-journal.png');
  assert.match(reopenedJournal.ui.text,/This session, 0 completed own-image examples/,
    'Reopened session diagnostic counters are fresh while examples remain durable');
  await clickButton(win,'close-npc');
  assert.deepEqual((await evaluate(win,'window.__ozarkWorld.fullSnapshot()')).playerLessons,
    checkpoint.savedBank);
  // A native focus transfer cancels paid work but does not pause simulation.
  await trustedLesson(win,'sela',checkpoint.authored.sourceId);
  assert.equal(await stepSeconds(win,.1),true);
  assert.ok((await evaluate(win,'window.__ozarkWorld.playerLessonSnapshot().active'))?.worked>0);
  const {BrowserWindow}=require('electron');
  const focusSink=new BrowserWindow({width:100,height:100,show:true,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true,webSecurity:true}});
  await focusSink.loadURL('about:blank');
  focusSink.focus();
  await waitFor(win,'window.__ozarkWorld.playerLessonSnapshot().active===null');
  assert.equal(await evaluate(win,'window.__ozarkWorld.snapshot().paused'),false,
    'Focus loss cancels only the action, not the running world');
  const elapsed=await evaluate(win,'window.__ozarkWorld.fullSnapshot().elapsed');
  assert.equal(await stepSeconds(win,.2),true);
  assert.ok(await evaluate(win,'window.__ozarkWorld.fullSnapshot().elapsed')>elapsed,
    'The world advances while the native window is unfocused');
  const canceled=await evaluate(win,'window.__ozarkWorld.fullSnapshot()');
  assert.deepEqual(canceled.playerLessons,checkpoint.savedBank,'A canceled point adds no lesson');
  focusSink.close();win.focus();
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'ESC'});
  win.webContents.sendInputEvent({type:'keyUp',keyCode:'ESC'});
  await waitFor(win,'window.__ozarkWorld.snapshot().paused');
  await evaluate(win,"document.getElementById('pause-panel').classList.add('hidden')");
  const frozen=await evaluate(win,'window.__ozarkWorld.fullSnapshot()');
  const screenshot=await capture(win,'02-reopened-player-lessons.png');
  assert.deepEqual(await evaluate(win,'window.__ozarkWorld.fullSnapshot()'),frozen);
  await fs.writeFile(path.join(context.output,'result.json'),JSON.stringify({passed:true,
    nativeExecutionPerformed:true,sourceIdentity:context.sourceIdentity,
    sourceFingerprint:context.sourceFingerprint,
    trustedTypedInput:true,actualPaidPublicPoint:true,ownCanvasExample:true,
    paidPoseScreenshot:{status:'pending-independent-pixel-review',file:checkpoint.poseImage.file,
      progress:checkpoint.poseImage.paidPoseWitness.progress},
    noCharacterReward:true,exactSaveReopen:true,pendingCancel:true,
    persistenceScope:'Mid-action save excludes pending authority; trusted Escape cancels it before a stable paused normal-close checkpoint is reopened byte-for-byte. A live pending action is not carried across native close.',
    nativeFocusCancellation:true,worldContinuedUnfocused:true,
    heldoutEvaluation:JSON.parse(await fs.readFile(path.join(context.output,'heldout-evaluation.json'),'utf8')),
    screenshots:[checkpoint.poseImage,checkpoint.journalImage,reopenedJournal,screenshot],fixtureDisclosure:checkpoint.authored.fixtureDisclosure,
    scope:'Controlled authored positions and actual sandboxed Electron UI/Canvas actions. One individual made two tentative raw-word image examples. Different object IDs may produce identical pooled feature inputs; exact matches and a fixed shuffled-word control are reported descriptively. No autonomous vocabulary, robust category transfer, ordinary encounter rate or survival benefit is established.'},null,2));
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
      await assertLessonBankShape(win,{empty:phase!=='reopen'});
      await ({author:authorPhase,act:actPhase,reopen:reopenPhase}[phase])(win);
      await closeNormally(win);
    }catch(error){
      console.error(error);const failure={phase,error:String(error?.stack||error),rendererEvents};
      try{failure.live=await evaluate(win,'({world:window.__ozarkWorld?.fullSnapshot(),saveFailure:window.__ozarkWorld?.saveFailure?.()})');
        failure.target=await targetDiagnostic(win,'failure');}
      catch(diagnosticError){failure.diagnosticError=String(diagnosticError);}
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
      assert.ok(result.stdout.includes('PLAYER_LESSON_NATIVE_WILL_QUIT ' + phase));
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
