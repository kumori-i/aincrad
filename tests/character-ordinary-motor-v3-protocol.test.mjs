import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {createOzarkState} from '../src/ozark-save.js';
import {createOzarkWorldGeometry} from '../src/ozark-world-geometry.js';
import {initializeFreeHandSession} from '../src/free-hand-action.js';
import {attachVisualReferenceLearning} from '../src/visual-reference-attachment.js';
import {survivalDecisionSnapshot} from '../src/survival-decision-observer.js';
import {
  CHARACTER_ORDINARY_PILOT_PROTOCOL as V1,
  projectCharacterPilot as projectV1,
  validateCharacterPilotProjection as validateV1,
} from '../scripts/character-ordinary-pilot-protocol.mjs';
import {
  CHARACTER_ORDINARY_PILOT_PROTOCOL as P,
  guardFreshCharacterMotorPilot,projectCharacterPilot,
  validateCharacterPilotProjection,createCharacterPilotTracker,
} from '../scripts/character-ordinary-motor-v3-protocol.mjs';
import {generatedCharacterPilotObserver,installCharacterPilotObserver}
  from '../scripts/prepare-character-ordinary-motor-v3.mjs';

const clone=value=>structuredClone(value);
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const mutate=(value,change)=>{const copy=clone(value);change(copy);return copy;};
let fresh;
function source(){
  if(fresh)return fresh;
  const state=createOzarkState(createOzarkWorldGeometry(),{communicationSeed:P.communicationSeed});
  for(const actor of state.agents)initializeFreeHandSession(actor);
  const learning=attachVisualReferenceLearning({state,
    pixelSensor:{capture(){throw Error('Passive projection called pixel capture');}},
    protocol:'sequence'});
  const survival=state.agents.map(actor=>{
    const snapshot=survivalDecisionSnapshot(actor);
    return {agentId:actor.id,counters:snapshot.counters,gateCounts:snapshot.gateCounts,
      recordsRetained:snapshot.records.length,decisionActive:snapshot.active};
  });
  fresh={world:clone(state),measurement:{...learning.measurementSnapshot(),survival},
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
  return vm.runInNewContext('('+guardFreshCharacterMotorPilot.toString()+')('+JSON.stringify(P)+')',
    renderer(input,options).context);
}
async function runProjection(input=source(),project=projectCharacterPilot){
  const code='('+project.toString().replace("await import('./src/config.js')",
    'await Promise.resolve({CONFIG:{fixedStep:1/60}})')+')()';
  return vm.runInNewContext(code,renderer(input).context);
}
const BASE_PROJECTION=clone(await runProjection());

test('v3 is a distinct once-only identity with unchanged v1 physical and evidence limits',()=>{
  const changed=['id','activationRef','receiptRef','workflow'];
  assert.deepEqual(Object.keys(P),Object.keys(V1));
  for(const key of Object.keys(V1)){
    if(changed.includes(key))assert.notEqual(P[key],V1[key],key);
    else assert.deepEqual(P[key],V1[key],key);
  }
  assert.equal(P.id,'ordinary-character-motor-observation-v3');
  assert.equal(P.activationRef,'experiments/character-motor-observation-v3-once');
  assert.equal(P.receiptRef,'experiments/character-motor-observation-v3-receipt');
  assert.equal(P.workflow,'Ordinary character-motor observation v3 — approved once');
  assert(Object.isFrozen(P));
});

test('self-contained renderer guard requires an untrained zero motor and predictor start',()=>{
  const original=source(),before=hash(original),ready=runGuard(original);
  assert.equal(ready.ready,true);
  assert.deepEqual(Array.from(ready.individuals,row=>row.id),['aster','mira']);
  assert.equal(hash(original),before);
  for(const change of [
    s=>{s.measurement.actors[0].freeHandObserver.decisionChecks=1;},
    s=>{s.measurement.actors[0].freeHandObserver.nextEligibleAt=0;},
    s=>{s.measurement.actors[1].freeHandObserver.sampleCounts.absent=1;},
    s=>{s.measurement.actors[0].gestureMemory.retained=1;},
    s=>{s.measurement.actors[1].gesturePrediction.forecasts=1;},
    s=>{s.measurement.actors[1].gesturePrediction.scores.model.brier=.1;},
    s=>{s.world.agents[0].active={request:{type:'free_hand'}};},
    s=>{s.world.characterMessages.learners[0].sender.updates=1;},
    s=>{s.measurement.counts.emissions=1;},
  ])assert.throws(()=>runGuard(mutate(original,change)),/guard/);
  assert.throws(()=>runGuard(original,{storageLength:1}),/profile/);
  assert.throws(()=>runGuard(original,{fixture:{owner:true}}),/clock/);
});

test('one coherent renderer read preserves exact v1 base and exports fixed allowlisted sidecar',async()=>{
  const input=source(),before=hash(input);
  let worldReads=0,measurementReads=0;
  const {q,context}=renderer(input);
  q.fullSnapshot=()=>{worldReads++;return clone(input.world);};
  q.communicationMeasurementSnapshot=()=>{measurementReads++;return clone(input.measurement);};
  const code='('+projectCharacterPilot.toString().replace("await import('./src/config.js')",
    'await Promise.resolve({CONFIG:{fixedStep:1/60}})')+')()';
  const actual=await vm.runInNewContext(code,context);
  assert.equal(worldReads,1);assert.equal(measurementReads,1);
  validateCharacterPilotProjection(actual);
  const {motor,...base}=actual;
  validateV1(base);
  const prior=await runProjection(input,projectV1);
  assert.deepEqual(clone({...base,wallMs:0}),clone({...prior,wallMs:0}));
  assert.equal(motor.version,1);assert.equal(motor.actors.length,2);
  assert.equal(motor.actors[0].freeHandObserver.nextEligibleAt,120);
  assert.equal(motor.actors[0].gestureMemory.retained,0);
  assert.equal(motor.actors[0].gesturePrediction.forecasts,0);
  assert.equal(hash(input),before);
  assert(Buffer.byteLength(JSON.stringify(actual),'utf8')<P.maxIpcBytes);
  assert(!/"(?:weights|pixels|trajectory|targetId|objectId|privateRows|rngState)"/.test(
    JSON.stringify(actual)));
  const hostile=mutate(input,s=>{
    s.measurement.actors[0].freeHandObserver.hiddenObjectId='object:501';
    s.measurement.actors[0].gestureMemory.privateRows=[{pose:[1,2]}];
    s.measurement.actors[0].gesturePrediction.weights=[900];
  });
  const filtered=await runProjection(hostile);
  assert.deepEqual(clone({...filtered,wallMs:0}),clone({...actual,wallMs:0}));
});

test('host validator rejects omitted, oversized, privileged and contradictory motor fields',()=>{
  const base=BASE_PROJECTION;validateCharacterPilotProjection(base);
  for(const change of [
    s=>{delete s.motor.actors[0].freeHandObserver.sampleCounts;},
    s=>{s.motor.actors[0].freeHandObserver.weights=[1];},
    s=>{s.motor.actors[0].freeHandObserver.decisionChecks=NaN;},
    s=>{s.motor.actors[0].freeHandObserver.eligibleDecisions=1;},
    s=>{s.motor.actors[0].freeHandObserver.selectedAttempts=1;},
    s=>{s.motor.actors[0].freeHandObserver.visibleSamples=1;},
    s=>{s.motor.actors[0].freeHandObserver.sampleCounts.pose=Number.MAX_SAFE_INTEGER;},
    s=>{s.motor.actors[1].gestureMemory.retained=769;},
    s=>{s.motor.actors[1].gestureMemory.limits.ttlSeconds=13;},
    s=>{s.motor.actors[1].gestureMemory.records=[{pose:[1,2]}];},
    s=>{s.motor.actors[0].gesturePrediction.pending=true;},
    s=>{s.motor.actors[0].gesturePrediction.scores.model.logLoss=-1;},
    s=>{s.motor.actors[0].gesturePrediction.scoresByTarget.pose.model.brier=.1;},
    s=>{s.motor.actors[0].gesturePrediction.limits.horizonTicks=29;},
    s=>{s.motor.actors[0].identity=3;},
    s=>{s.motor.actors[0].epoch=1;},
    s=>{s.motor.extra=true;},
    s=>{s.actorSecret=true;},
  ])assert.throws(()=>validateCharacterPilotProjection(mutate(base,change)));
});

test('actual generated native helper source executes the frozen v1 and v3 validator chain',()=>{
  const generated=generatedCharacterPilotObserver(),install='('+
    installCharacterPilotObserver.toString()+')';
  assert(generated.includes(install));
  const captured=generated.replace(install,
    '(function(_context,helpers){globalThis.generatedHelpers=helpers;})');
  const context={process:{env:{AINCRAD_CHARACTER_MOTOR_V3_CONTEXT:'{}'}}};
  vm.runInNewContext(captured,context,{timeout:2000});
  const validate=context.generatedHelpers?.validateCharacterPilotProjection;
  assert.equal(typeof validate,'function');
  const valid=clone(BASE_PROJECTION);
  assert.equal(validate(valid),valid);
  assert.throws(()=>validate(mutate(valid,s=>{
    s.motor.actors[0].freeHandObserver.eligibleDecisions=1;
  })),/Invalid free-hand observer/);
  assert.throws(()=>validate(mutate(valid,s=>{
    s.counts.criticCorrect=1;
  })),/Invalid character measurement counters/);
});

test('identity reconciliation hides all motor fields without dropping base coverage',()=>{
  const hidden=mutate(source(),s=>{
    s.measurement.identityPendingReconciliation=true;
    s.measurement.pending=null;s.measurement.actors=[];
  });
  return runProjection(hidden).then(projected=>{
    validateCharacterPilotProjection(projected);
    assert.equal(projected.motor.actors.length,2);
    for(const actor of projected.motor.actors){
      assert.equal(actor.identity,null);
      assert.equal(actor.freeHandObserver,null);
      assert.equal(actor.gestureMemory,null);
      assert.equal(actor.gesturePrediction,null);
    }
    assert.equal(projected.identityPendingReconciliation,true);
  });
});

function sample(elapsed=0){
  const row=clone(BASE_PROJECTION);row.elapsed=elapsed;row.wallMs=Date.now();
  row.clocks={environment:elapsed,ecology:elapsed,pending:0};
  for(const actor of row.actors)actor.elapsed=elapsed;
  return row;
}

test('tracker preserves v1 denominators and accepts TTL retention loss without a reset',()=>{
  const tracker=createCharacterPilotTracker();
  const first=sample();
  let status=tracker.ingest(first);
  assert.equal(status.accuracy.defined,false);
  assert.equal(status.motor.actors[0].ratios.selectionsPerEligible.defined,false);
  const next=sample(2),a=next.motor.actors[0];
  a.freeHandObserver.decisionChecks=2;a.freeHandObserver.eligibleDecisions=1;
  a.freeHandObserver.selectedAttempts=1;a.freeHandObserver.sampleCounts.pose=2;
  a.freeHandObserver.visibleSamples=2;
  a.gestureMemory.retained=2;
  status=tracker.ingest(next);
  assert.equal(status.motor.actors[0].ratios.selectionsPerEligible.rate,1);
  assert.equal(status.motor.actors[0].visibleSamples,2);
  const expired=clone(next);expired.elapsed=14;expired.clocks={environment:14,ecology:14,pending:0};
  expired.actors.forEach(actor=>actor.elapsed=14);
  expired.motor.actors[0].gestureMemory.retained=0;
  expired.motor.actors[0].gestureMemory.expirations=2;
  status=tracker.ingest(expired);
  assert.equal(status.motor.actors[0].visibility.pose,2);
  assert.equal(status.motor.coverage.sessionResets.gestureMemory,0);
  assert.throws(()=>tracker.ingest(mutate(expired,s=>{
    s.motor.actors[0].freeHandObserver.selectedAttempts=0;
  })),/regressed/);
});

test('prediction targets and visibility censors keep their own prospective denominators',()=>{
  const tracker=createCharacterPilotTracker();
  const row=sample(1),a=row.motor.actors[0];
  a.freeHandObserver.sampleCounts={unknown:10,absent:8,pose:2};
  a.gesturePrediction.forecasts=3;a.gesturePrediction.validTargets=1;
  a.gesturePrediction.updates=1;a.gesturePrediction.censoredUnknown=1;
  a.gesturePrediction.pending=true;a.gesturePrediction.targetPose=1;
  a.gesturePrediction.onsets=1;
  for(const [key,brier,logLoss] of [['model',.25,.69],
    ['prior',.36,.91],['persistence',.81,2.3]]){
    a.gesturePrediction.scores[key]={brier,logLoss};
    a.gesturePrediction.scoresByTarget.pose[key]={brier,logLoss};
  }
  let status=tracker.ingest(row);
  assert.equal(status.accuracy.defined,false);
  assert.equal(status.motor.actors[0].prediction.validTargets,1);
  assert.equal(status.motor.actors[0].prediction.censoredUnknown,1);
  assert.equal(status.motor.actors[0].ratios.validTargetsPerForecast.denominator,3);
  assert.equal(status.motor.actors[0].ratios.validTargetsPerForecast.rate,1/3);
  const gap=clone(row);gap.elapsed=2;gap.clocks={environment:2,ecology:2,pending:0};
  gap.actors.forEach(actor=>actor.elapsed=2);
  gap.motor.actors[0].gesturePrediction.censoredGap=1;
  gap.motor.actors[0].gesturePrediction.pending=false;
  status=tracker.ingest(gap);
  assert.equal(status.motor.actors[0].prediction.censoredGap,1);
  assert.throws(()=>tracker.ingest(mutate(gap,s=>{
    s.motor.actors[0].gesturePrediction.scores.model.brier=.2;
    s.motor.actors[0].gesturePrediction.scoresByTarget.pose.model.brier=.2;
  })),/Motor score regressed/);
});

test('tracker segments all three metrics at explicit local resets and detects epoch/identity gaps',()=>{
  const tracker=createCharacterPilotTracker();
  const before=sample(1),a=before.motor.actors[0];
  a.freeHandObserver.decisionChecks=3;a.freeHandObserver.eligibleDecisions=1;
  a.freeHandObserver.selectedAttempts=1;a.freeHandObserver.sampleCounts.absent=3;
  a.gestureMemory.overflows=2;
  a.gesturePrediction.forecasts=1;a.gesturePrediction.pending=true;
  tracker.ingest(before);
  const reset=sample(2),fresh=reset.motor.actors[0];
  fresh.epoch=1;reset.actors[0].epoch=1;
  fresh.freeHandObserver.sessionResets=1;
  fresh.gestureMemory.sessionResets=1;
  fresh.gesturePrediction.sessionResets=1;
  let status=tracker.ingest(reset);
  assert.equal(status.motor.coverage.epochChanges,1);
  assert.deepEqual(status.motor.coverage.sessionResets,
    {freeHandObserver:1,gestureMemory:1,gesturePrediction:1});
  const unexplained=sample(2);
  unexplained.actors[0].epoch=1;unexplained.motor.actors[0].epoch=1;
  const detector=createCharacterPilotTracker();detector.ingest(before);
  assert.throws(()=>detector.ingest(unexplained),/without local reset evidence/);
  assert.throws(()=>createCharacterPilotTracker().ingest(mutate(before,s=>{
    s.motor.actors[0].gesturePrediction.pending=false;
  })),/Invalid gesture-predictor summary/);
  const stale=sample(3);stale.identityPendingReconciliation=true;stale.pending=null;
  stale.actors.forEach(actor=>{actor.identity=null;actor.character=null;});
  stale.motor.actors.forEach(actor=>{actor.identity=null;actor.freeHandObserver=null;
    actor.gestureMemory=null;actor.gesturePrediction=null;});
  status=tracker.ingest(stale);
  assert.equal(status.motor.coverage.identityUnavailableProjections,1);
  const replaced=sample(4);replaced.actors[0].identity=3;
  replaced.actors[1].character.partnerBanks[0].partnerSerial=3;
  replaced.motor.actors[0].identity=3;
  status=tracker.ingest(replaced);
  assert.equal(status.motor.coverage.identityChanges,1);
});
