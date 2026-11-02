import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { createOzarkState, loadOzarkSave, writeOzarkSave, OZARK_SAVE_KEY } from '../src/ozark-save.js';
import { referenceGeometry } from '../src/discovery-actions.js';
import { perceiveReferenceGeometry, senseReferenceObjects } from '../src/visual-reference-perception.js';
import { createPlayerLessonController } from '../src/player-lesson-action.js';
import { bindOzarkWorldAgent } from '../src/ozark-agent-world.js';

const ids = Object.freeze({ apple:'object:671', bramble:'object:677',
  heldApple:'object:679', heldBramble:'object:670' });
const player = Object.freeze({ x:48.12560981287811, y:873.8769379168397 });

function authorPhysicalScene() {
  const geometry=createOzarkWorldGeometry();
  const state=createOzarkState(geometry,{communicationSeed:211});
  state.player={...player};
  state.agents[0].position={...player};
  state.agents[1].position={x:1000,y:900};
  for(const actor of state.agents)bindOzarkWorldAgent(actor,geometry,state);
  state.environment.ecology.plants.find(row=>row.id===ids.heldApple).position=
    {x:232.9015163151354,y:797.3402514438216};
  state.environment.ecology.plants.find(row=>row.id===ids.heldBramble).position=
    {x:128.1256098128781,y:873.8769379168397};
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
      "sendInputEvent({type:'char'", "sendInputEvent({type:'keyDown',keyCode:'ArrowDown'",
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
    ])assert.ok(runner.includes(token),'Missing native contract: '+token);
    const acted=runner.split('async function actPhase(win) {')[1]
      ?.split('async function reopenPhase(win) {')[0];
    assert.ok(acted);
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
