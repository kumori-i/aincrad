import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {createOzarkState} from '../src/ozark-save.js';
import {createOzarkWorldGeometry} from '../src/ozark-world-geometry.js';
import {initializeFreeHandSession} from '../src/free-hand-action.js';
import {attachVisualReferenceLearning} from '../src/visual-reference-attachment.js';
import {foodRunSnapshot,markFoodRunChoice} from '../src/food-run-observer.js';
import {ingestMaterial,tickPhysiology,relievePhysiology} from '../src/biology.js';
import {survivalDecisionSnapshot} from '../src/survival-decision-observer.js';
import {validateCharacterPilotProjection as validateV1}
  from '../scripts/character-ordinary-pilot-protocol.mjs';
import {CHARACTER_ORDINARY_PILOT_PROTOCOL as V4,
  projectCharacterPilot as projectV4,
  validateCharacterPilotProjection as validateV4}
  from '../scripts/character-ordinary-motor-v4-protocol.mjs';
import {CHARACTER_ORDINARY_PILOT_PROTOCOL as P,
  guardFreshCharacterFoodRunPilot,projectCharacterPilot,
  validateCharacterPilotProjection,createCharacterPilotTracker}
  from '../scripts/character-ordinary-food-run-v5-protocol.mjs';

const clone=value=>structuredClone(value);
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const change=(value,edit)=>{const row=clone(value);edit(row);return row;};
let fresh;
function source(){
  if(fresh)return fresh;
  const state=createOzarkState(createOzarkWorldGeometry(),
    {communicationSeed:P.communicationSeed});
  for(const actor of state.agents)initializeFreeHandSession(actor);
  const learning=attachVisualReferenceLearning({state,
    pixelSensor:{capture(){throw Error('Passive projection called pixel capture');}},
    protocol:'sequence'});
  const survival=state.agents.map(actor=>{
    const snapshot=survivalDecisionSnapshot(actor);
    return {agentId:actor.id,counters:snapshot.counters,gateCounts:snapshot.gateCounts,
      recordsRetained:snapshot.records.length,decisionActive:snapshot.active};
  });
  fresh={world:clone(state),measurement:{...learning.measurementSnapshot(),survival,
    foodRuns:state.agents.map(actor=>({agentId:actor.id,...foodRunSnapshot(actor)}))},
  reference:learning.snapshot()};
  learning.dispose();
  return fresh;
}
function renderer(input=source(),{route='aincrad://app/index.html?test=1',
  storageLength=0,saved=null,speed='1',fixture=null}={}){
  const q={snapshot:()=>({version:input.world.version,features:input.world.features,
      elapsed:input.world.elapsed,started:false,paused:false,blocked:false}),
    fullSnapshot:()=>clone(input.world),
    communicationMeasurementSnapshot:()=>clone(input.measurement),
    communicationSnapshot:()=>clone(input.reference),
    referenceFixtureState:()=>fixture};
  return {q,context:{window:{__ozarkWorld:q,location:{href:route},
      localStorage:{length:storageLength,getItem:()=>saved}},
    document:{getElementById:()=>({value:speed})},Date,Number,Object,Reflect}};
}
function runGuard(input=source(),options){
  // Match the native renderer boundary: only the V5 guard text crosses.
  const code='('+guardFreshCharacterFoodRunPilot.toString()+')('+JSON.stringify(P)+')';
  return vm.runInNewContext(code,renderer(input,options).context);
}
async function runProjection(input=source(),project=projectCharacterPilot){
  const code='('+project.toString().replace("await import('./src/config.js')",
    'await Promise.resolve({CONFIG:{fixedStep:1/60}})')+')()';
  return vm.runInNewContext(code,renderer(input).context);
}
const BASE=clone(await runProjection());
function sample(elapsed=0){
  const row=clone(BASE);row.elapsed=elapsed;row.wallMs=Date.now();
  row.clocks={environment:elapsed,ecology:elapsed,pending:0};
  for(const actor of row.actors)actor.elapsed=elapsed;
  return row;
}

test('v5 has a separate once-only identity and unchanged v4 physical/evidence limits',()=>{
  const changed=['id','activationRef','receiptRef','workflow'];
  assert.deepEqual(Object.keys(P),Object.keys(V4));
  for(const key of Object.keys(V4))
    if(changed.includes(key))assert.notEqual(P[key],V4[key],key);
    else assert.deepEqual(P[key],V4[key],key);
  assert.equal(P.id,'ordinary-character-food-run-lifecycle-v5');
  assert.equal(P.activationRef,'experiments/character-food-run-lifecycle-v5-once');
  assert.equal(P.receiptRef,'experiments/character-food-run-lifecycle-v5-receipt');
  assert(Object.isFrozen(P));
});

test('serialized fresh guard delegates v4 and requires exact zero food and stomach state',()=>{
  const original=source(),before=hash(original),ready=runGuard(original);
  assert.equal(ready.ready,true);
  assert.deepEqual(Array.from(ready.individuals,row=>row.id),['aster','mira']);
  assert.equal(hash(original),before);
  for(const edit of [
    s=>{s.measurement.foodRuns[0].stages.travel.selected=1;},
    s=>{s.measurement.foodRuns[0].runEnds['proof-retired']=1;},
    s=>{s.measurement.foodRuns[1].sessionLosses=1;},
    s=>{s.measurement.foodRuns[1].pending.active=1;},
    s=>{s.measurement.foodRuns[0].hiddenTargetId='object:42';},
    s=>{s.world.agents[0].physiology.stomach.push({remainingKcal:1});},
    s=>{s.world.agents[0].physiology.totals.ingestedKcal=1;},
    s=>{s.world.agents[0].physiology.totals.absorbedKcal=1;},
    s=>{s.world.agents[0].physiology.totals.metabolizedKcal=1;},
    s=>{s.world.agents[0].physiology.totals.discardedKcal=1;},
    s=>{s.world.agents[0].physiology.outsideAssistance.count=1;},
  ])assert.throws(()=>runGuard(change(original,edit)),/food-run guard/);
  assert.throws(()=>runGuard(original,{storageLength:1}),/profile/);
});

test('one coherent renderer read preserves v4 fields and allowlists only food aggregates',async()=>{
  const input=source(),before=hash(input),{q,context}=renderer(input);
  let worldReads=0,measurementReads=0;
  q.fullSnapshot=()=>{worldReads++;return clone(input.world);};
  q.communicationMeasurementSnapshot=()=>{measurementReads++;return clone(input.measurement);};
  const code='('+projectCharacterPilot.toString().replace("await import('./src/config.js')",
    'await Promise.resolve({CONFIG:{fixedStep:1/60}})')+')()';
  const actual=await vm.runInNewContext(code,context);
  assert.equal(worldReads,1);assert.equal(measurementReads,1);
  validateCharacterPilotProjection(actual);
  const {food,...base}=actual;validateV4(base);
  const prior=await runProjection(input,projectV4);
  assert.deepEqual(clone({...base,wallMs:0}),clone({...prior,wallMs:0}));
  assert.equal(food.version,1);assert.equal(food.foodKeysOmitted,0);
  assert.equal(food.identityUnavailableActors,0);
  assert.deepEqual(food.actors.map(row=>row.id),['aster','mira']);
  assert.equal(food.actors[0].energy.pendingKcal,0);
  assert.equal(food.actors[0].energy.discardedKcal,0);
  assert.equal(food.actors[0].foodRun.runEnds['proof-retired'],0);
  assert.equal(hash(input),before);
  assert(Buffer.byteLength(JSON.stringify(actual),'utf8')<P.maxIpcBytes);
  assert(!/"(?:weights|pixels|trajectory|targetId|objectId|privateRows|rngState|stomach)"/.test(
    JSON.stringify(food)));
  const hostile=change(input,s=>{
    s.measurement.foodRuns[0].hiddenTargetId='object:501';
    s.measurement.foodRuns[0].stages.travel.privateRoute=[1,2];
    s.world.agents[0].physiology.stomach=[];
  });
  const filtered=await runProjection(hostile);
  assert.deepEqual(clone({...filtered,wallMs:0}),clone({...actual,wallMs:0}));
});

test('the real observer mark projects a selected unpaid route without inventing work',async()=>{
  const input=clone(source()),actor=input.world.agents[0],
    run={techniqueId:'technique:1',cursor:0,startedAt:0};
  actor.discovery.run=run;
  assert.equal(markFoodRunChoice(actor,run,{type:'move',target:{x:45,y:0}},
    'travel',{reach:'observed'}),true);
  input.measurement.foodRuns[0]={agentId:actor.id,...foodRunSnapshot(actor)};
  const projected=await runProjection(input);
  validateCharacterPilotProjection(projected);
  const observed=projected.food.actors[0].foodRun;
  assert.equal(observed.stages.travel.selected,1);
  assert.equal(observed.stages.travel.reach.observed,1);
  assert.equal(observed.pending.selected,1);
  assert.equal(observed.stages.travel.admitted,0);
  assert.equal(observed.stages.travel.firstPaid,0);
  assert.equal(observed.stages.travel.completed,0);
});

test('host rejects omitted, private, contradictory and nonfinite food fields',()=>{
  validateCharacterPilotProjection(BASE);
  for(const edit of [
    s=>{delete s.food.actors[0].foodRun.stages.travel;},
    s=>{s.food.foodKeysOmitted=1;},
    s=>{s.food.identityUnavailableActors=1;},
    s=>{s.food.actors[0].foodRun.hiddenTargetId='object:501';},
    s=>{s.food.actors[0].foodRun.stages.travel.reach.observed=1;},
    s=>{s.food.actors[0].foodRun.stages.travel.selected=1;},
    s=>{s.food.actors[0].foodRun.stages.sample.instantCompleted=1;},
    s=>{s.food.actors[0].foodRun.pending.active=2;},
    s=>{s.food.actors[0].foodRun.runEnds['proof-retired']=-1;},
    s=>{s.food.actors[0].foodRun.stages.travel.certifiedPaidSeconds=Infinity;},
    s=>{s.food.actors[0].foodRun.sessionLosses=2147483647;},
    s=>{s.food.actors[0].energy.pendingKcal=1;},
    s=>{s.food.actors[0].energy.discardedKcal=NaN;},
    s=>{s.food.actors[0].energy.stomach=[{remainingKcal:3}];},
    s=>{s.food.actors[0].identity=99;},
    s=>{s.food.extra=true;},
    s=>{s.extraPrivate=true;},
  ])assert.throws(()=>validateCharacterPilotProjection(change(BASE,edit)));
  const missing=change(source(),s=>{delete s.measurement.foodRuns[0].stages.travel.selected;});
  return runProjection(missing).then(row=>{
    assert.equal(row.food.foodKeysOmitted,1);
    assert.throws(()=>validateCharacterPilotProjection(row));
  });
});

test('serialized validator needs only the frozen V1/V4 aliases and no module closure',()=>{
  const code='const CHARACTER_ORDINARY_PILOT_PROTOCOL='+JSON.stringify(P)+';'+
    'const validateV1Projection='+validateV1.toString()+';'+
    'const validateV4Projection='+validateV4.toString()+';'+
    'const validate='+validateCharacterPilotProjection.toString()+';'+
    'validate('+JSON.stringify(BASE)+');true';
  assert.equal(vm.runInNewContext(code,{Number,Object,Array,Math}),true);
  const hostile=change(BASE,s=>{s.food.actors[0].foodRun.runEnds['proof-retired']=-1;});
  assert.throws(()=>vm.runInNewContext(code.replace(JSON.stringify(BASE),
    JSON.stringify(hostile)),{Number,Object,Array,Math}),/Invalid food-run summary/);
});

test('stage denominators and kcal partition describe completed physical work separately',()=>{
  const tracker=createCharacterPilotTracker();tracker.ingest(sample());
  const row=sample(10),run=row.food.actors[0].foodRun,stage=run.stages.acquisition;
  stage.selected=1;stage.reach.observed=1;stage.normalized=1;
  stage.admitted=1;stage.firstPaid=1;stage.certifiedPaidSeconds=1.8;
  stage.completed=1;run.runEnds.complete=1;
  const energy=row.food.actors[0].energy;
  Object.assign(energy,{ingestedKcal:10,absorbedKcal:6,discardedKcal:1,pendingKcal:3});
  row.actors[0].totals.ingestedKcal=10;row.actors[0].totals.absorbedKcal=6;
  row.actors[0].body.availableEnergyKcal+=6;
  validateCharacterPilotProjection(row);
  const status=tracker.ingest(row),observed=status.food.actors[0].stages.acquisition;
  assert.deepEqual(observed.ratios.admissionsPerSelected,
    {numerator:1,denominator:1,defined:true,rate:1});
  assert.equal(observed.ratios.firstPaidPerAdmitted.rate,1);
  assert.equal(observed.ratios.completionsPerAdmitted.rate,1);
  assert.equal(status.food.actors[0].energy.pendingKcal,3);
  assert.equal(status.food.actors[0].runEnds.complete,1);
  assert.throws(()=>tracker.ingest(change(row,s=>{
    s.elapsed=20;s.clocks.environment=20;s.clocks.ecology=20;
    s.actors.forEach(actor=>{actor.elapsed=20;});
    s.food.actors[0].foodRun.runEnds.complete=0;
  })),/Food run end regressed/);
  assert.throws(()=>validateCharacterPilotProjection(change(row,s=>{
    s.food.actors[0].energy.pendingKcal=2;
  })),/partition/);
});

test('actual digestion and reserve mobilization reconcile; actual rescue is disclosed',async()=>{
  const input=clone(source()),actor=input.world.agents[0];
  // Start below the bodily mobilization threshold; no observer controls diet.
  actor.physiology.availableEnergyKcal=100;
  const first=clone(await runProjection(input));
  const tracker=createCharacterPilotTracker();tracker.ingest(first);
  const swallowed=ingestMaterial(actor,
    {massGrams:30,energyKcal:20,waterMl:0,digestHours:.05},
    {source:'isolated bodily accounting fixture'});
  assert.equal(swallowed.ok,true);
  tickPhysiology(actor,10,{hour:8,feltTemperature:18});
  input.world.elapsed=10;input.world.environment.elapsed=10;
  input.world.environment.ecology.elapsed=10;
  input.world.agents.forEach(row=>{row.elapsed=10;});
  const digested=clone(await runProjection(input));
  validateCharacterPilotProjection(digested);
  assert(digested.food.actors[0].energy.absorbedKcal>0);
  assert(actor.physiology.storedEnergyKcal<first.actors[0].body.storedEnergyKcal,
    'actual physiology mobilized reserve into available energy');
  assert.equal(tracker.ingest(digested).food.coverage.energyReserveChecksSkippedForRescue,0);
  const assistance=relievePhysiology(actor,{energyKcal:100,waterMl:0});
  assert(assistance.energyKcal>0);
  actor.stats.rescues++;
  input.world.elapsed=20;input.world.environment.elapsed=20;
  input.world.environment.ecology.elapsed=20;
  input.world.agents.forEach(row=>{row.elapsed=20;});
  const rescued=clone(await runProjection(input));
  validateCharacterPilotProjection(rescued);
  assert.equal(tracker.ingest(rescued).food.coverage.energyReserveChecksSkippedForRescue,1);
});

test('session reset and stale identity mark uncertainty without inventing a finish',()=>{
  const tracker=createCharacterPilotTracker(),pending=sample(1),
    a=pending.food.actors[0].foodRun;
  a.stages.travel.selected=1;a.stages.travel.reach.observed=1;
  a.pending.selected=1;
  tracker.ingest(pending);
  const reset=sample(2),food=reset.food.actors[0];
  reset.actors[0].epoch=1;reset.motor.actors[0].epoch=1;food.epoch=1;
  reset.motor.actors[0].freeHandObserver.sessionResets=1;
  reset.motor.actors[0].gestureMemory.sessionResets=1;
  reset.motor.actors[0].gesturePrediction.sessionResets=1;
  food.foodRun.sessionResets=1;food.foodRun.sessionLosses=1;
  const status=tracker.ingest(reset);
  assert.equal(status.food.coverage.epochChanges,1);
  assert.equal(status.food.coverage.sessionResets,1);
  assert.equal(status.food.coverage.sessionLosses,1);
  assert.equal(status.food.coverage.lastObservedPendingBeforeSessionLoss,1);
  assert.equal(status.food.actors[0].stages.travel.completed,0);
  const stale=sample(3);stale.identityPendingReconciliation=true;stale.pending=null;
  stale.actors.forEach(actor=>{actor.identity=null;actor.character=null;});
  stale.motor.actors.forEach(actor=>{actor.identity=null;
    actor.freeHandObserver=null;actor.gestureMemory=null;actor.gesturePrediction=null;});
  stale.food.identityUnavailableActors=2;
  stale.food.actors.forEach(actor=>{actor.identity=null;actor.foodRun=null;actor.energy=null;});
  validateCharacterPilotProjection(stale);
  assert.equal(tracker.ingest(stale).food.coverage.identityUnavailableActors,2);
  assert.throws(()=>validateCharacterPilotProjection(change(stale,s=>{
    s.food.actors[0].foodRun=clone(BASE.food.actors[0].foodRun);
  })),/Stale food-run identity leaked/);
});
