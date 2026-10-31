import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {CONFIG} from '../src/config.js';
import {OZARK_SAVE_KEY,createOzarkState,loadOzarkSave,writeOzarkSave,
  getOzarkSaveFailure} from '../src/ozark-save.js';
import {createOzarkWorldGeometry} from '../src/ozark-world-geometry.js';
import {bindOzarkWorldAgent} from '../src/ozark-agent-world.js';
import {PopulationRuntime} from '../src/population.js';
import {attachVisualReferenceLearning} from '../src/visual-reference-attachment.js';
import {survivalDecisionSnapshot} from '../src/survival-decision-observer.js';
import {freeHandExplorationChoice,readFreeHandObserver} from '../src/free-hand-action.js';
import {requestNpcAction} from '../src/npc.js';
import {projectCharacterPilot,validateCharacterPilotProjection}
  from '../scripts/character-ordinary-motor-v3-protocol.mjs';

const geometry=createOzarkWorldGeometry();
const storage=(raw=null)=>{const bytes=new Map(raw===null?[]:[[OZARK_SAVE_KEY,raw]]);
  return {getItem:key=>bytes.get(key)??null,setItem:(key,value)=>bytes.set(key,value)};};
let freshBytes=null;
function initialBytes(){
  if(freshBytes!==null)return freshBytes;
  const state=createOzarkState(geometry,{communicationSeed:211}),disk=storage();
  assert.equal(writeOzarkSave(disk,state,geometry),true);
  freshBytes=disk.getItem(OZARK_SAVE_KEY);
  return freshBytes;
}
function fixture({memoryEnabled=true,predictionEnabled=memoryEnabled}={}){
  const disk=storage(initialBytes()),loaded=loadOzarkSave(disk,geometry);
  assert.equal(loaded.blocked,false);
  const state=loaded.state;
  for(const actor of state.agents)bindOzarkWorldAgent(actor,geometry,state);
  // This parity fixture admits no image pair, message or synthetic feedback.
  const sensor={capture(){return new Map();},dispose(){}};
  const reference=attachVisualReferenceLearning({state,pixelSensor:sensor,protocol:'sequence',
    gestureMemoryEnabled:memoryEnabled,gesturePredictionEnabled:predictionEnabled});
  const population=new PopulationRuntime(state,{cardinal:false,communicationMode:'grounded',
    experimentalDiscovery:reference.hooks});
  function step(){
    reference.beforeTick();state.elapsed+=CONFIG.fixedStep;
    population.tick(CONFIG.fixedStep);reference.afterTick();
  }
  function save(){
    const saved=writeOzarkSave(disk,state,geometry,
      {referencePersistence:reference.exportPersistence()});
    assert.equal(saved,true,getOzarkSaveFailure(state));
    return disk.getItem(OZARK_SAVE_KEY);
  }
  function close(){reference.dispose();population.dispose();}
  return {state,disk,reference,population,step,save,close};
}
const inner=value=>JSON.stringify(value);
function survival(state){
  return state.agents.map(actor=>{
    const summary=survivalDecisionSnapshot(actor);
    return {agentId:actor.id,counters:summary.counters,gateCounts:summary.gateCounts,
      recordsRetained:summary.records.length,decisionActive:summary.active};
  });
}
async function motorProjection(f){
  // The v3 serialized allowlist reads one main-world snapshot and one passive
  // measurement. Its wall timestamp is excluded from deterministic equality.
  const q={fullSnapshot:()=>structuredClone(f.state),
    communicationMeasurementSnapshot:()=>({...f.reference.measurementSnapshot(),
      survival:survival(f.state)})};
  const source='('+projectCharacterPilot.toString().replace(
    "await import('./src/config.js')","({CONFIG:{fixedStep:1/60}})")+')()';
  const projection=await vm.runInNewContext(source,{window:{__ozarkWorld:q},
    Date,Number,Object,Reflect});
  validateCharacterPilotProjection(projection);
  delete projection.wallMs;
  return structuredClone(projection);
}
function continuation(f){
  return {world:inner(f.state),reference:inner(f.reference.exportPersistence()),
    rng:f.state.agents.map(actor=>actor.rng),saved:f.disk.getItem(OZARK_SAVE_KEY),
    actions:f.state.agents.map(actor=>actor.memory.experience.filter(row=>row.type==='action')
      .map(row=>({at:row.at,type:row.details?.action?.type,code:row.details?.result?.code})))};
}

test('v3 observer and serialized projection reads are pure before and during ordinary ticks',async()=>{
  const f=fixture();
  try{
    for(let i=0;i<12;i++)f.step();
    const baseline=continuation(f),measurement=f.reference.measurementSnapshot(),
      projected=await motorProjection(f);
    assert.equal(measurement.actors.length,2);
    assert.equal(projected.motor.version,1);
    assert.equal(projected.motor.actors.length,2);
    for(const actor of projected.motor.actors){
      assert(actor.freeHandObserver.sampleCounts.absent+
        actor.freeHandObserver.sampleCounts.pose+
        actor.freeHandObserver.sampleCounts.unknown>0);
      assert(actor.gestureMemory.retained>0);
      assert(actor.gesturePrediction.forecasts>=0);
      assert.equal(actor.gesturePrediction.limits.replayCapacity,0);
    }
    assert.equal(/"(?:weights|features|pixels|gestureRows|examples|trajectory)"/.test(
      inner(projected.motor)),false,'V3 projection exposes no private learner vectors or rows');
    for(let repeat=0;repeat<4;repeat++){
      assert.deepEqual(f.reference.measurementSnapshot(),measurement);
      assert.deepEqual(await motorProjection(f),projected);
      for(const actor of f.state.agents){
        f.reference.readGestureMemory(actor);
        f.reference.readGesturePrediction(actor);
        readFreeHandObserver(actor);
      }
      assert.deepEqual(continuation(f),baseline,
        'Repeated observer, memory and projection reads do not act, train, draw RNG or save');
    }
    assert.equal(f.disk.getItem(OZARK_SAVE_KEY),baseline.saved);
  }finally{f.close();}
});

test('gesture observer enablement preserves actions, character learners, RNG and saves through paid motor work',async()=>{
  const enabled=fixture({memoryEnabled:true}),disabled=fixture({memoryEnabled:false});
  try{
    assert.deepEqual(continuation(enabled),continuation(disabled));
    // Engineering-only clock placement supplies a due optional motor candidate
    // without fabricating a message reward or running an ordinary cohort.
    for(const f of [enabled,disabled]){
      f.state.elapsed=120;
      f.state.environment.elapsed=120;
      f.state.environment.ecology.elapsed=120;
      for(const actor of f.state.agents)actor.elapsed=120;
      const actor=f.state.agents[0],option=freeHandExplorationChoice(actor);
      assert.deepEqual(option?.action,{type:'free_hand'});
      assert.equal(requestNpcAction(actor,option.action,f.state.environment).code,'ACTION_STARTED');
    }
    for(let i=0;i<125;i++){
      enabled.step();disabled.step();
      if(i%30===0)assert.deepEqual(continuation(enabled),continuation(disabled),
        'Gesture observation cannot redirect a paid motor action or character learner');
    }
    assert.equal(enabled.state.agents[0].lastResult?.code,'FREE_HAND_MOVED');
    assert.equal(disabled.state.agents[0].lastResult?.code,'FREE_HAND_MOVED');
    assert.deepEqual(continuation(enabled),continuation(disabled));
    const enabledLife=readFreeHandObserver(enabled.state.agents[0]).lifecycle;
    const disabledLife=readFreeHandObserver(disabled.state.agents[0]).lifecycle;
    for(const life of [enabledLife,disabledLife]){
      assert.equal(life.admitted,1);
      assert.equal(life.firstPaid,1);
      assert.equal(life.completed,1);
      assert.equal(life.pending,0);
      assert(Math.abs(life.certifiedPaidSeconds-1.8)<1e-7,
        'Only authentic funded work supplies the physical duration');
    }
    assert(enabledLife.ownPoseSamples>0,
      'Accepted local sensor rows, when enabled, witness own funded motion');
    assert.equal(disabledLife.ownPoseSamples,0,
      'Disabled actor-local memory cannot fabricate accepted sensor rows');
    assert.deepEqual({...enabledLife,ownPoseSamples:0},disabledLife,
      'Gesture memory toggling cannot change physical action lifecycle counts');
    const beforeReads=continuation(enabled),projected=await motorProjection(enabled);
    assert.equal(projected.motor.actors[0].freeHandObserver.selectedAttempts,1);
    assert.deepEqual(await motorProjection(enabled),projected);
    assert.deepEqual(continuation(enabled),beforeReads,
      'Post-motion v3 projection cannot change any paid action or learner continuation');
    const observerBefore=readFreeHandObserver(enabled.state.agents[0]);
    observerBefore.lifecycle.interrupted.OTHER=999;
    observerBefore.lifecycle.rejectedAfterSelection.ACTION_BUSY=999;
    observerBefore.lifecycle.ownPoseSamples=999;
    assert.deepEqual(readFreeHandObserver(enabled.state.agents[0]).lifecycle,enabledLife,
      'Nested lifecycle snapshots are defensive and repeated reads are pure');
    assert.deepEqual(continuation(enabled),continuation(disabled));
    const active=enabled.reference.measurementSnapshot().actors[0];
    assert(active.freeHandObserver.selectedAttempts>0);
    assert(active.freeHandObserver.visibleSamples>=0);
    assert.equal(disabled.reference.readGestureMemory(disabled.state.agents[1]),null);
    assert(enabled.reference.readGestureMemory(enabled.state.agents[1]).records.length>0);
    assert.equal(enabled.save(),disabled.save(),
      'Session-only gesture observation cannot change strict saved bytes');
  }finally{enabled.close();disabled.close();}
});
