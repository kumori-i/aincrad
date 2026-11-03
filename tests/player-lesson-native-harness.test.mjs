import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    const acted=runner.split('async function actPhase(win) {')[1]
      ?.split('async function reopenPhase(win) {')[0];
    assert.ok(acted);
    const headingAssertion=runner.split('\n').find(line=>line.includes("assert.ok(ui.text.includes('Player word examples (separate from character messages)'))"));
    assert.ok(headingAssertion,'Generated journal heading check must retain literal parentheses');
    const checkHeading=new Function('assert','ui',headingAssertion);
    checkHeading(assert,{text:'Player word examples (separate from character messages) nava'});
    assert.throws(()=>checkHeading(assert,{text:'Player word examples separate from character messages'}));
    assert.ok(acted.indexOf('const posePreparation=await prepareCapture(win)')<acted.indexOf("settleMs:0"));
    assert.ok(acted.indexOf('const poseImage=')<acted.indexOf('const repeat='),
      'Disabled-repeat IPC must not consume the first paid screenshot window');

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
