import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { createOzarkState, loadOzarkSave, writeOzarkSave, getOzarkSaveValidationFailure, OZARK_SAVE_KEY } from '../src/ozark-save.js';
import { referenceGeometry } from '../src/discovery-actions.js';
import { perceiveReferenceGeometry, senseReferenceObjects } from '../src/visual-reference-perception.js';
import { createPlayerLessonController } from '../src/player-lesson-action.js';
import { bindOzarkWorldAgent } from '../src/ozark-agent-world.js';
import { PopulationRuntime } from '../src/population.js';
import { CONFIG } from '../src/config.js';
import { tickPhysiology } from '../src/biology.js';
import { environmentConditions } from '../src/environment.js';
import { createPlayerFoodController } from '../src/player-food.js';

const ids = Object.freeze({ apple:'object:671', bramble:'object:677',
  heldApple:'object:679', heldBramble:'object:670' });
const player = Object.freeze({ x:276, y:620 });

function authorPhysicalScene() {
  const geometry=createOzarkWorldGeometry();
  const state=createOzarkState(geometry,{communicationSeed:211});
  state.player={...player};
  for(const actor of state.agents)bindOzarkWorldAgent(actor,geometry,state);
  for(const [id,position] of Object.entries({
    [ids.apple]:{x:180,y:540},[ids.bramble]:{x:380,y:620},
    [ids.heldApple]:{x:140,y:700},[ids.heldBramble]:{x:380,y:730},
  }))state.environment.ecology.plants.find(row=>row.id===id).position=position;
  return {state,geometry};
}

test('engineered existing plant instances have unique ordinary trained gestures and untrained visible evaluation crops', () => {
  const {state,geometry}=authorPhysicalScene();
  const plants=state.environment.ecology.plants;
  for(const [id,kind] of [[ids.apple,'apple_tree'],[ids.bramble,'bramble'],
    [ids.heldApple,'apple_tree'],[ids.heldBramble,'bramble']]) {
    const plant=plants.find(row=>row.id===id);
    assert.equal(plant.kind,kind);
    assert.equal(plant.stage,'ripe');
    assert.ok(plant.quantity>3);
  }
  const sender={id:'player',lifecycle:'AWAKE',scene:'valley',position:player};
  const sight=senseReferenceObjects(state.agents[0],state);
  assert.equal(sight.complete,true);
  for(const id of Object.values(ids))assert.ok(sight.bindings.includes(id));
  for(const id of [ids.apple,ids.bramble]) {
    const source=plants.find(row=>row.id===id);
    const resolved=perceiveReferenceGeometry(state.agents[0],sender,
      referenceGeometry(player,source.position,'valley',.5),state);
    assert.deepEqual([resolved.reason,resolved.objectId],['resolved',id]);
    assert.equal(perceiveReferenceGeometry(state.agents[1],sender,
      referenceGeometry(player,source.position,'valley',.5),state).reason,'peer-not-visible');
  }
  const controller=createPlayerLessonController({state,geometry,
    pixelSensor:{captureVisible:()=>null},getLineage:()=>state.worldLineage,onLessons:()=>{}});
  const options=controller.visibleOptions().map(row=>row.targetId);
  assert.ok(options.includes(ids.apple));assert.ok(options.includes(ids.bramble));
  controller.dispose();
  const saved=new Map(),storage={getItem:key=>saved.get(key)??null,
    setItem:(key,value)=>saved.set(key,value)};
  assert.equal(writeOzarkSave(storage,state,geometry),true);
  const loaded=loadOzarkSave(storage,geometry);
  assert.equal(loaded.blocked,false,loaded.error);
  assert.equal(loaded.state.environment.ecology.plants.find(row=>row.id===ids.heldApple).position.x,
    plants.find(row=>row.id===ids.heldApple).position.x);
  assert.equal(loaded.state.environment.ecology.plants.find(row=>row.id===ids.heldBramble).position.x,
    plants.find(row=>row.id===ids.heldBramble).position.x);
  assert.equal(JSON.parse(saved.get(OZARK_SAVE_KEY)).features.playerLessons,1);
});

test('prepare-only generates a sandboxed trusted-input and real Canvas close/reopen runner without launching Electron', async () => {
  const output=await mkdtemp(join(tmpdir(),'player-lesson-prepare-'));
  let passed=false;
  try {
    const command=spawnSync(process.execPath,['scripts/verify-player-lesson-desktop.mjs','--prepare-only'],
      {encoding:'utf8',timeout:120000,
        env:{...process.env,AINCRAD_PLAYER_LESSON_QA_OUTPUT:output}});
    assert.equal(command.status,0,command.stderr);
    const prepared=JSON.parse(command.stdout.trim());
    const manifest=JSON.parse(await readFile(join(prepared.output,'prepared.json'),'utf8'));
    assert.equal(manifest.nativeExecutionPerformed,false);
    assert.deepEqual(manifest.sandboxBypassFlags,[]);
    assert.deepEqual(manifest.phases,['author','act','reopen']);
    assert.ok(manifest.sourceIdentity && manifest.sourceFingerprint);
    await assert.rejects(access(join(prepared.output,'result.json')));
    for(const phase of manifest.phases)
      await assert.rejects(access(join(prepared.output,phase+'-sandbox.json')));
    const syntax=spawnSync(process.execPath,['--check',prepared.harness],{encoding:'utf8'});
    assert.equal(syntax.status,0,syntax.stderr);
    const runner=await readFile(prepared.harness,'utf8');
    for(const token of [
      'getLastWebPreferences()', 'assert.equal(prefs.sandbox,true)',
      "sendInputEvent({type:'mouseDown'", "sendInputEvent({type:'mouseUp'",
      "sendInputEvent({type:'char'", "sendInputEvent({type:'keyDown',keyCode:'Tab'",
      'Pointing at a visible object. Food actions can resume afterward.',
      "assert.deepEqual(rendererEvents,[]",'01-paid-player-point.png',
      'captureWithReadiness({','sensor.captureVisible(actor,state,id)',
      'bankModule.predictPlayerWord(bank,crop.features)',
      'bankModule.predictPlayerWord(swapped,crop.features)',
      'exactTrainingFeatureMatches','nearestTrainingRms',
      'exactTrainingInputRows','nonIdenticalTrainingInputRows',
      'uniformChance:.5','exactSaveReopen:true','nativeFocusCancellation:true',
      'No autonomous vocabulary', 'No resource, pixel, label, body outcome',
      'bindOzarkWorldAgent(actor,geometry,state)',
      'bindingModule.bindOzarkWorldAgent(npc,geometry,state)',
      "phase+'-target-selection.jsonl'", 'after-Tab', 'before-typeahead', 'after-typeahead-', 'after-commit-Tab',
      'event.isTrusted', 'window.__ozarkWorld.saveFailure', 'Native live save validation failed:',
      'failure.live=', 'authored.agentPositions',
      'advancePlayerLessonFixedSteps', 'fixedStepExpression(.1)',
      'verifyPlayerLessonCaptureProgress', 'paidPoseWitness', 'captureLessonState',
      "paidPoseScreenshot:{status:'pending-independent-pixel-review'",
    ])assert.ok(runner.includes(token),'Missing native contract: '+token);
    const evaluateSource=runner.slice(runner.indexOf('async function evaluate('),
      runner.indexOf('async function waitFor(')).trim();
    assert.ok(evaluateSource.includes('replace(/\\s+/g'),
      'The generated runner must normalize whitespace, not the letter s');
    const nativeEvaluate=runInNewContext('('+evaluateSource+')',{Error,String});
    assert.equal(await nativeEvaluate({webContents:{executeJavaScript:async()=>42}},'6*7','read result'),42);
    await assert.rejects(nativeEvaluate({webContents:{executeJavaScript:async()=>{
      throw new Error('Script failed to execute');
    }}},'x'.repeat(300),'arm disabled-repeat click trace'),
    /Native renderer expression failed \[arm disabled-repeat click trace\]: Error: Script failed to execute/);
    await assert.rejects(nativeEvaluate({webContents:{executeJavaScript:async()=>{
      throw new Error('Script failed to execute');
    }}},'x'.repeat(300)),error=>error.message.includes('x'.repeat(120)) &&
      !error.message.includes('x'.repeat(121)),
    'Unlabelled renderer exceptions retain a bounded expression prefix');
    assert.match(runner,/PLAYER_LESSON_RENDERER_EVENTS/);
    assert.match(runner,/rendererEvents\.slice\(-16\)/,
      'Failure stderr must retain a bounded renderer console/error tail');
    const acted=runner.split('async function actPhase(win) {')[1]
      ?.split('async function reopenPhase(win) {')[0];
    assert.ok(acted);
    const headingAssertion=runner.split('\n').find(line=>line.includes("assert.ok(ui.text.includes('Player word examples (separate from character messages)'))"));
    assert.ok(headingAssertion,'Generated journal heading check must retain literal parentheses');
    const checkHeading=new Function('assert','ui',headingAssertion);
    checkHeading(assert,{text:'Player word examples (separate from character messages) nava'});
    assert.throws(()=>checkHeading(assert,{text:'Player word examples separate from character messages'}));
    assert.ok(acted.indexOf('const posePreparation=await prepareCapture(win)')<acted.indexOf("settleMs:0"));
    assert.ok(acted.indexOf('const poseImage=')<acted.indexOf("await trustedLesson(win,'movo'"),
      'Disabled-repeat input must not consume the first paid screenshot window');
    assert.match(acted,/trustedLesson\(win,'movo',authored\.brambleId,\{repeatImmediately:true\}\)/);
    assert.doesNotMatch(acted,/allowDisabled:true/,
      'A repeat cannot re-check the enabled state after the first paid action expires');
    for(const token of ['window.__lessonRepeatClicks=[]','},{capture:true});button.addEventListener("click"',
      "phase+'-disabled-repeat.json'",
      "assert.equal(result.clicks.length,1"])
      assert.ok(runner.includes(token),'Missing real disabled-repeat witness: '+token);
    const reopened=runner.split('async function reopenPhase(win) {')[1]
      ?.split('async function closeNormally(win) {')[0];
    assert.ok(reopened);
    const focusSteps=["show:false,webPreferences:","await focusSink.loadURL('about:blank')",
      "await trustedLesson(win,'sela'",'const partial=await evaluate(win,',
      'focusSink.show()','focusSink.focus()','await waitFor(win,'];
    for(const step of focusSteps)assert.ok(reopened.includes(step),
      'Missing native focus cancellation step: '+step);
    for(let i=1;i<focusSteps.length;i++)assert.ok(
      reopened.indexOf(focusSteps[i])>reopened.indexOf(focusSteps[i-1]),
      'The sandboxed focus sink must load hidden before paid work and transfer focus immediately afterward');
    const paidStart=reopened.indexOf("await trustedLesson(win,'sela'");
    const focusTransfer=reopened.indexOf('focusSink.focus()',paidStart);
    assert.doesNotMatch(reopened.slice(paidStart,focusTransfer),
      /focusSink\.loadURL\(|new BrowserWindow\(/,
      'No asynchronous window construction or load may consume the paid point interval');
    assert.match(reopened.slice(paidStart,focusTransfer),
      /partial\?\.worked>0&&partial\.worked<partial\.seconds/,
      'The focus transfer must start during certified partial paid work');
    const witness=reopened.match(/const stoppedStatus=([^\n]+);\s*await waitFor\(win,([\s\S]*?)\);/);
    assert.ok(witness,'The focus fixture must wait for an interrupted-action witness');
    const stoppedStatus=runInNewContext(witness[1]);
    const witnessExpression=runInNewContext(witness[2],{stoppedStatus});
    const observed=(active,status)=>runInNewContext(witnessExpression,{
      window:{__ozarkWorld:{playerLessonSnapshot:()=>({active})}},
      document:{getElementById:()=>({textContent:status})},
    });
    assert.equal(observed(null,stoppedStatus),true);
    assert.equal(observed(null,'The paid point ended. A character made a tentative own-image link.'),false,
      'Natural completion must not masquerade as focus cancellation');
    assert.equal(observed({worked:.1},stoppedStatus),false);
    const worldMain=await readFile('src/ozark-world-main.js','utf8');
    assert.match(worldMain,/function cancelPlayerLesson\(reason\) \{[\s\S]*?text\('player-lesson-status',\s*'The point stopped\. Time and effort already spent remain spent; no word association was added\.'/,
      'The witness must be emitted by the actual runtime cancellation path');

    assert.doesNotMatch(runner,/__ozarkWorld\.step\(\.(?:1|2)\)/,
      'Batched durations must use integer fixed ticks, never subtraction tails');
    assert.doesNotMatch(acted,/createPlayerLessonController\(|learnPlayerLesson\(|\.start\('nava'|\.onLessons\(/,
      'Actual lesson phase cannot inject a label or bypass paid UI');
    assert.doesNotMatch(acted,/crop\.features\s*=|features:\s*Array\(/,
      'Actual evaluation cannot inject synthetic sensor features');
    assert.match(runner,/assert\.equal\(prefs\.webSecurity,true\)/);
    const preservation=JSON.parse(await readFile(join(prepared.output,'profile-evidence.json'),'utf8'));
    assert.equal(preservation.nativeExecutionPerformed,false);
    assert.equal(preservation.copiedAfterProcessesClosed,false);
    passed=true;
  } finally {
    if(passed)await rm(output,{recursive:true,force:true});
    else console.error('Failed player-lesson preparation retained at '+output);
  }
});

test('native duplicate probe sends two real click pairs without a second IPC or timer', async () => {
  const source=await readFile('scripts/verify-player-lesson-desktop.mjs','utf8');
  const helper=source.slice(source.indexOf('async function clickButton('),
    source.indexOf('function fixedStepExpression(')).trim();
  const events=[];
  let evaluations=0,delays=0,clock=0;
  const clickButton=runInNewContext('('+helper+')',{
    JSON,evaluate:async()=>{evaluations++;clock+=8;return {x:42,y:17};},
    delay:async()=>{delays++;clock+=8;},
  });
  const win={webContents:{focus:()=>{},sendInputEvent:event=>events.push({event,clock})}};
  await clickButton(win,'player-lesson-say',{settleMs:0,repeatImmediately:true});
  assert.equal(evaluations,1,'The button box is read before either native press');
  assert.equal(delays,0,'The repeat cannot wait for the 1.8-second action to finish');
  assert.deepEqual(events.map(({event})=>event.type),
    ['mouseMove','mouseDown','mouseUp','mouseDown','mouseUp']);
  assert.ok(events.every(row=>row.clock===8),'No renderer round trip can separate the presses');
  for(const {event} of events.slice(1))assert.equal(event.clickCount,1,
    'The two ordinary mouse presses must not become one double-click command');
});

test('native workflow is separate, bounded and inert on experiment refs', async () => {
  const workflow=await readFile('.github/workflows/player-lesson-native.yml','utf8');
  assert.match(workflow,/macos-latest, ubuntu-22\.04/);
  assert.match(workflow,/scripts\/verify-player-lesson-desktop\.mjs/);
  assert.match(workflow,/test-results\/player-lesson-desktop\//);
  assert.match(workflow,/xvfb-run -a bash -c 'openbox/);
  assert.doesNotMatch(workflow,/on:\s*\n\s*create:/);
  assert.doesNotMatch(workflow,/workflow_dispatch:/);
  assert.doesNotMatch(workflow,/refs\/experiments\//);
  assert.doesNotMatch(workflow,/npm run check/,'No duplicate full-suite invocation in native job');
});


test('authored fixture stays strictly saveable across ordinary fixed steps and autosave horizon',()=>{
  const {state,geometry}=authorPhysicalScene();
  for(const actor of state.agents)assert.deepEqual(actor.position,geometry.agentSpawns[actor.id],
    'Authored agent teleports can create unreachable observations on the first tick');
  const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  const population=new PopulationRuntime(state,{cardinal:false});
  const foodController=createPlayerFoodController(state,geometry);
  try {
    for(let i=0;i<=900;i++) {
      const dt=CONFIG.fixedStep,body=state.playerBody,food=state.playerFood.physiology;
      body.wetness=Math.max(0,body.wetness-dt*2);
      body.effort=Math.max(0,body.effort-dt*.025);
      body.stamina=Math.min(100,body.stamina+dt*1.2);
      state.elapsed+=dt;
      food.health=body.health;food.stamina=body.stamina;
      const actor={id:'player',species:'human',position:state.player,scene:'valley',
        elapsed:state.elapsed,physiology:food,thermal:{hot:0,cold:0,wetness:body.wetness}};
      tickPhysiology(actor,dt,environmentConditions(state.environment,
        {position:state.player,scene:'valley',thermal:actor.thermal}));
      body.health=food.health;food.stamina=body.stamina;
      foodController.tick(dt);body.health=food.health;body.stamina=food.stamina;
      population.tick(dt);foodController.reconcileHeld();
      if(i%60===0) {
        assert.equal(writeOzarkSave(storage,state,geometry),true,'Strict save after step '+i);
        const reopened=loadOzarkSave(storage,geometry);
        assert.equal(reopened.blocked,false,reopened.error);
      }
    }
    assert.ok(state.elapsed>15);
    assert.deepEqual(state.playerLessons.agents.map(row=>row.examples),[[],[]]);
  } finally { foodController.dispose();population.dispose(); }
});


test('time-zero NPC teleport is rejected after its first genuine terrain observation',()=>{
  const {state,geometry}=authorPhysicalScene();
  state.agents[0].position={x:48.12560981287811,y:873.8769379168397};
  state.agents[1].position={x:1000,y:900};
  const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  assert.equal(writeOzarkSave(storage,state,geometry),true,'A pre-observation authored save alone misses this failure');
  const bytes=values.get(OZARK_SAVE_KEY);
  const population=new PopulationRuntime(state,{cardinal:false});
  try {
    state.elapsed+=CONFIG.fixedStep;population.tick(CONFIG.fixedStep);
    assert.equal(writeOzarkSave(storage,state,geometry),false);
    assert.match(getOzarkSaveValidationFailure(state)?.message,/aster has invalid Ozark terrain or legacy-site memory/);
    assert.equal(values.get(OZARK_SAVE_KEY),bytes,'Strict failure protects prior bytes');
  } finally { population.dispose(); }
});

test('trusted target navigation uses closed-select label cycling and checks every actual keypress',async()=>{
  const {runInNewContext}=await import('node:vm');
  const source=await readFile('scripts/verify-player-lesson-desktop.mjs','utf8');
  const navigation=source.slice(source.indexOf('async function trustedChooseTarget('),
    source.indexOf('async function trustedLesson('));
  assert.doesNotMatch(navigation,/clickButton\(|keyCode:'(?:ArrowDown|Down|Home|Return)'|\.value\s*=(?!=)|dispatchEvent/);
  const options=[{value:'',text:'Choose a visible object'},
    {value:'object:671',text:'Ripe · 40 away'},
    {value:'object:677',text:'Ripe · 64 away'},
    {value:'object:679',text:'Small · 90 away'}];
  let focused='player-lesson-word',selected=1,sequence=0;
  const events=[],inputs=[],steps=[];
  const win={webContents:{sendInputEvent(input){
    inputs.push(input);
    const type=input.type==='char'?'keypress':input.type==='keyDown'?'keydown':'keyup';
    events.push({sequence:++sequence,type,key:input.keyCode,target:focused,trusted:true});
    if(input.type==='keyDown'&&input.keyCode==='Tab')
      focused=focused==='player-lesson-word'?'player-lesson-target':'player-lesson-say';
    if(focused==='player-lesson-target'&&input.type==='char'){
      for(let offset=1;offset<=options.length;offset++){
        const candidate=(selected+offset)%options.length;
        if(options[candidate].text.toLowerCase().startsWith(input.keyCode)){
          selected=candidate;break;
        }
      }
    }
  }}};
  let expected='object:677';
  const context={assert,evaluate:async(_win,expression)=>expression==='document.activeElement?.id'?focused:undefined,
    targetDiagnostic:async(_win,step)=>{steps.push({step,value:options[selected].value});
      return {options,value:options[selected].value,activeElement:focused,disabled:false,
        events:events.map(row=>({...row}))};},
    waitFor:async()=>assert.equal(options[selected].value,expected)};
  runInNewContext(navigation+';this.choose=trustedChooseTarget;',context);
  await context.choose(win,expected);
  assert.deepEqual(inputs.map(row=>row.keyCode),['Tab','Tab','r','Tab','Tab']);
  assert.equal(focused,'player-lesson-say');
  // Repeat from an already selected target: native cycling must wrap through
  // the other duplicate label and back, never assign the desired DOM value.
  focused='player-lesson-word';inputs.length=0;steps.length=0;
  await context.choose(win,expected);
  assert.deepEqual(steps.filter(row=>row.step.startsWith('after-typeahead-')).map(row=>row.value),
    ['object:671','object:677']);
  // A new visible initial is sourced from the label, not an object identity.
  focused='player-lesson-word';expected='object:679';inputs.length=0;
  await context.choose(win,expected);
  assert.equal(inputs.find(row=>row.type==='char').keyCode,'s');
  // Modelled selection alone cannot pass when the transport emits an invalid key.
  focused='player-lesson-word';
  const send=win.webContents.sendInputEvent;
  win.webContents.sendInputEvent=input=>{send(input);if(input.type==='char')events.at(-1).key='';};
  await assert.rejects(context.choose(win,expected),/trusted DOM keypress/);
  focused='player-lesson-word';selected=1;expected='object:677';let attempts=0;
  win.webContents.sendInputEvent=input=>{const prior=selected;send(input);
    if(input.type==='char'){selected=prior;attempts++;}};
  await assert.rejects(context.choose(win,expected),/Bounded visible-label cycling/);
  assert.equal(attempts,options.length,'A stuck real selection fails within one bounded cycle');
});


test('preprepared paid capture has no renderer IPC or readiness sleep before capturePage',async()=>{
  const {runInNewContext}=await import('node:vm');
  const source=await readFile('scripts/verify-player-lesson-desktop.mjs','utf8');
  const captureSource=source.slice(source.indexOf('async function capture(win, name,'),
    source.indexOf('async function captureJournal('));
  const calls=[],png=Buffer.alloc(11000),before={status:'paid',nearby:'pointing'},after={};
  const context={assert,phase:'act',context:{output:'/evidence'},path:{join:(...parts)=>parts.join('/')},
    fs:{writeFile:async()=>{}},prepareCapture:async()=>{throw new Error('Late readiness');},
    captureLessonState:async()=>{calls.push('after-state');return after;},
    verifyPlayerLessonCaptureProgress:(a,b)=>{assert.equal(a,before);assert.equal(b,after);return {pngVisualReviewRequired:true};},
    captureWithReadiness:async({prepare,capture,retain,maxAttempts})=>{
      assert.equal(maxAttempts,1,'Do not reuse an old paid witness across screenshot retries');
      await prepare();const image=await capture();assert.equal(image,'native-image');
      await retain(png,{attempt:1});return {png,metadata:{attempt:1,width:1280,height:900}};
    }};
  runInNewContext(captureSource+';this.capturePaid=capture;',context);
  const win={webContents:{capturePage:async()=>{calls.push('capture-page');return 'native-image';}}};
  const result=await context.capturePaid(win,'paid.png',{paidPose:true,
    prepared:{ui:{rect:{width:100}},readiness:{readyState:'complete'}},before});
  assert.deepEqual(calls,['capture-page','after-state']);
  assert.equal(result.paidPoseWitness.before,before);
  assert.equal(result.ui.status,'paid');
});

// Exercise the extracted native editing driver; this models ordinary text
// editing semantics, not successful OS dispatch or actual desktop execution.
async function wordEditingFixture({value='abcdef',caret=0,stuckDelete=false,stuckTyping=false,
  trustedKeys=true,trustedTyping=true}={}) {
  const {createContext,runInContext}=await import('node:vm');
  const source=await readFile('scripts/verify-player-lesson-desktop.mjs','utf8');
  const driver=source.slice(source.indexOf('async function trustedTypeWord('),
    source.indexOf('async function targetDiagnostic('));
  assert.doesNotMatch(driver,/selectAll|modifiers:|\.value\s*=(?!=)|\.select\(|setSelectionRange|dispatchEvent/);
  const handlers=[],inputs=[],diagnostics=[],logs=[],delays=[];
  const input={id:'player-lesson-word',value,selectionStart:caret,selectionEnd:caret,disabled:false,
    addEventListener(type,listener,options){handlers.push({type,listener,signal:options?.signal});}};
  const document={activeElement:null,hasFocus:()=>true,
    getElementById:id=>id==='player-lesson-word'?input:null};
  const emit=(type,properties={})=>{
    for(const row of handlers)if(row.type===type&&!row.signal?.aborted)
      row.listener({type,isTrusted:['keydown','keyup'].includes(type)?trustedKeys:
        properties.inputType==='insertText'?trustedTyping:true,...properties});
  };
  function edit(inputType,letter='') {
    emit('beforeinput',{inputType});
    const before=input.value;
    let start=input.selectionStart,end=input.selectionEnd;
    if(start===end&&inputType==='deleteContentBackward')start=Math.max(0,start-1);
    if(start===end&&inputType==='deleteContentForward')end=Math.min(input.value.length,end+1);
    if(inputType==='insertText') {
      if(stuckTyping)return;
      letter=letter.slice(0,6-(input.value.length-(end-start)));
    } else if(stuckDelete)return;
    input.value=input.value.slice(0,start)+letter+input.value.slice(end);
    input.selectionStart=input.selectionEnd=start+letter.length;
    if(input.value!==before)emit('input',{inputType});
  }
  const win={webContents:{sendInputEvent(event){
    inputs.push(event);
    if(event.type==='keyDown'){
      emit('keydown',{key:event.keyCode});
      if(event.keyCode==='Backspace')edit('deleteContentBackward');
      else if(event.keyCode==='Delete')edit('deleteContentForward');
    }else if(event.type==='keyUp')emit('keyup',{key:event.keyCode});
    else if(event.type==='char')edit('insertText',event.keyCode);
  }}};
  const context=createContext({assert,document,window:{},AbortController,
    performance:{now:()=>inputs.length},delay:async ms=>delays.push(ms),
    console:{log:message=>logs.push(message)},
    phase:'act',context:{output:'/isolated'},path:{join:(...parts)=>parts.join('/')},
    fs:{appendFile:async(file,bytes)=>{assert.equal(file,'/isolated/act-word-input.jsonl');
      diagnostics.push(JSON.parse(bytes.slice(0,bytes.lastIndexOf('}')+1)));}},
    clickButton:async(_win,id)=>{assert.equal(id,'player-lesson-word');document.activeElement=input;},
  });
  context.evaluate=async(_win,expression)=>runInContext(expression,context);
  runInContext(driver+';this.typeWord=trustedTypeWord;',context);
  return {input,inputs,diagnostics,logs,delays,type:word=>context.typeWord(win,word)};
}

test('trusted word editing clears both sides of start/middle/end carets and types all six characters',async()=>{
  for(const caret of [0,3,6]){
    const fixture=await wordEditingFixture({caret});
    await fixture.type('uvwxyz');
    assert.equal(fixture.input.value,'uvwxyz');
    assert.equal(fixture.inputs.filter(row=>row.type==='keyDown').length,12);
    assert.deepEqual(fixture.inputs.filter(row=>row.type==='keyDown').map(row=>row.keyCode),
      Array.from({length:6},()=>['Backspace','Delete']).flat());
    assert.deepEqual(fixture.inputs.filter(row=>row.type==='char').map(row=>row.keyCode),Array.from('uvwxyz'));
    assert.deepEqual(fixture.diagnostics.map(row=>row.stage),['cleared','typed']);
    const [cleared,typed]=fixture.diagnostics;
    assert.equal(cleared.before.start,caret);assert.equal(cleared.before.end,caret);
    assert.equal(cleared.before.value,'abcdef');assert.equal(cleared.after.value,'');
    assert.equal(typed.after.value,'uvwxyz');assert.equal(typed.after.focused,true);
    assert.ok(typed.after.events.some(row=>row.type==='input'&&row.inputType==='insertText'&&row.trusted));
    assert.ok(typed.after.events.some(row=>row.type==='keydown'&&row.key==='Delete'&&row.trusted));
    assert.ok(typed.after.events.length<=96);
    // A later request starts from existing text; aborted listeners cannot append
    // duplicate rows or restore the previous word's diagnostic buffer.
    fixture.input.selectionStart=fixture.input.selectionEnd=2;
    await fixture.type('tomi');
    assert.equal(fixture.input.value,'tomi');
    assert.equal(fixture.diagnostics.at(-1).after.events.filter(row=>row.type==='input'&&row.inputType==='insertText').length,4);
  }
});

test('trusted word editing rejects stuck deletion before typing and records stuck typed input',async()=>{
  const deletion=await wordEditingFixture({caret:3,stuckDelete:true});
  await assert.rejects(deletion.type('tomi'),/Trusted deletion must empty/);
  assert.equal(deletion.inputs.some(row=>row.type==='char'),false);
  assert.deepEqual(deletion.delays,[50,50,50,50],
    'Failure observation waits briefly without replaying any native key');
  assert.equal(deletion.logs.length,1);
  const clearDiagnostic=JSON.parse(deletion.logs[0].replace('PLAYER_LESSON_WORD_CLEAR_DIAGNOSTIC ',''));
  assert.equal(clearDiagnostic.before.value,'abcdef');
  assert.deepEqual(clearDiagnostic.observations.map(row=>row.stage),
    ['immediate','after-50','after-100','after-150','after-200']);
  assert.ok(clearDiagnostic.observations.every(row=>row.value==='abcdef'&&
    row.focused===true&&row.windowFocused===true&&row.disabled===false));
  assert.equal(deletion.inputs.filter(row=>row.type==='keyDown').length,12,
    'The diagnostic cannot repeat a failed deletion');
  assert.equal(deletion.diagnostics.length,1);
  assert.equal(deletion.diagnostics[0].after.value,'abcdef');
  const typing=await wordEditingFixture({caret:0,stuckTyping:true});
  await assert.rejects(typing.type('tomi'),/Actual native input must contain/);
  assert.deepEqual(typing.diagnostics.map(row=>row.stage),['cleared','typed']);
  assert.equal(typing.diagnostics[1].after.value,'');
});

test('trusted word editing refuses a correct field value without trusted native event evidence',async()=>{
  const deletion=await wordEditingFixture({caret:3,trustedKeys:false});
  await assert.rejects(deletion.type('tomi'),/Deletion must arrive as a real trusted native key/);
  assert.equal(deletion.input.value,'');
  assert.equal(deletion.inputs.some(row=>row.type==='char'),false);
  const typing=await wordEditingFixture({value:'',trustedTyping:false});
  await assert.rejects(typing.type('tomi'),/Typed word must arrive through trusted native input/);
  assert.equal(typing.input.value,'tomi','A matching value is insufficient without the actual trusted event');
  assert.equal(typing.diagnostics.at(-1).stage,'typed');
});

test('close checkpoint uses trusted pause and retained pending bytes; read purity is checked in one renderer turn',async()=>{
  const {runInNewContext}=await import('node:vm');
  const source=await readFile('scripts/verify-player-lesson-desktop.mjs','utf8');
  const act=source.slice(source.indexOf('async function actPhase('),source.indexOf('async function reopenPhase('));
  assert.match(act,/const pendingSave=await evaluate/);
  assert.match(act,/const \{pending,raw:pendingRaw,pauseSequence\}=pendingSave/);
  assert.match(act,/event\.key==='Escape'&&event\.trusted/);
  assert.match(act,/pendingRaw\.includes\('tomi'\),false/);
  assert.match(act,/sendInputEvent\(\{type:'keyDown',keyCode:'ESC'\}\)/);
  assert.ok(act.indexOf("keyCode:'ESC'")<act.indexOf('const closeCheckpoint='));
  assert.match(act,/assert\.equal\(closeCheckpoint\.paused,true\);assert\.equal\(closeCheckpoint\.active,null\)/);
  assert.match(act,/const raw=closeCheckpoint\.raw/);
  assert.match(act,/JSON\.stringify\(\{raw,pendingRaw,closeCheckpoint,authored/);
  const reopen=source.slice(source.indexOf('async function reopenPhase('));
  assert.match(reopen,/persistenceScope:'Mid-action save excludes pending authority; trusted Escape/);
  assert.match(reopen,/A live pending action is not carried across native close/);
  assert.match(reopen,/localStorage\.getItem\('aincrad\.world\.v2'\).*checkpoint\.raw/);
  const readAssertion=reopen.slice(reopen.indexOf('  const reads=await evaluate('),
    reopen.indexOf('  await openLessonJournal('));
  assert.ok(readAssertion);
  const world={elapsed:7,playerLessons:{agents:[]}};
  let evaluations=0,reads=0;
  const context={assert,evaluate:async(_win,expression)=>{
    evaluations++;
    const result=runInNewContext(expression,{window:{__ozarkWorld:{
      fullSnapshot:()=>structuredClone(world),
      playerLessonSnapshot:()=>{reads++;return {active:null};},
    }}});
    // Ordinary time may advance between IPC turns, not inside this atomic read.
    world.elapsed++;
    return result;
  },win:{}};
  await runInNewContext('(async()=>{'+readAssertion+'})()',context);
  assert.equal(evaluations,1);assert.equal(reads,2);assert.equal(world.elapsed,8);
});
