import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {createOzarkState} from '../src/ozark-save.js';
import {createOzarkWorldGeometry} from '../src/ozark-world-geometry.js';
import {attachVisualReferenceLearning} from '../src/visual-reference-attachment.js';
import {survivalDecisionSnapshot} from '../src/survival-decision-observer.js';
import {CHARACTER_ORDINARY_PILOT_PROTOCOL as P,CHARACTER_PILOT_COUNT_KEYS,
  readCharacterPilotClock,guardFreshCharacterPilot,projectCharacterPilot,
  validateCharacterPilotClock,validateCharacterPilotProjection,
  createCharacterPilotSchedule,createCharacterPilotTracker,
  createCharacterPilotBudget,boundedCharacterPilotTerminal
} from '../scripts/character-ordinary-pilot-protocol.mjs';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
let fresh=null;
function freshSource(){
  if(fresh)return fresh;
  const state=createOzarkState(createOzarkWorldGeometry(),{communicationSeed:P.communicationSeed});
  const learning=attachVisualReferenceLearning({state,
    pixelSensor:{capture(){throw new Error('Passive observer called pixel capture');}},
    protocol:'sequence'});
  const survival=state.agents.map(actor=>{
    const snapshot=survivalDecisionSnapshot(actor);
    return {agentId:actor.id,counters:snapshot.counters,gateCounts:snapshot.gateCounts,
      recordsRetained:snapshot.records.length,decisionActive:snapshot.active};
  });
  fresh={world:structuredClone(state),measurement:{...learning.measurementSnapshot(),survival},
    reference:learning.snapshot()};
  learning.dispose();
  return fresh;
}
function renderer(source=freshSource(),{storageLength=0,saved=null,speed='1',fixture=null,
  route='aincrad://app/index.html?test=1'}={}){
  const q={snapshot:()=>({version:source.world.version,features:source.world.features,
      elapsed:source.world.elapsed,started:false,paused:false,blocked:false}),
    fullSnapshot:()=>structuredClone(source.world),
    communicationSnapshot:()=>structuredClone(source.reference),
    communicationMeasurementSnapshot:()=>structuredClone(source.measurement),
    referenceFixtureState:()=>fixture};
  const context={window:{__ozarkWorld:q,location:{href:route},
      localStorage:{length:storageLength,getItem:()=>saved}},
    document:{getElementById:()=>({value:speed})},Date,Number,Object,Reflect};
  return {q,context};
}
function runGuard(source=freshSource(),options){
  return vm.runInNewContext('('+guardFreshCharacterPilot.toString()+')('+JSON.stringify(P)+')',
    renderer(source,options).context);
}
async function runProjection(source=freshSource()){
  const code='('+projectCharacterPilot.toString().replace(
    "await import('./src/config.js')","({CONFIG:{fixedStep:1/60}})")+')()';
  return vm.runInNewContext(code,renderer(source).context);
}
const copy=value=>structuredClone(value);
function moved(source,mutate){const result=copy(source);mutate(result);return result;}

test('prospective constants declare one bounded ordinary trajectory',()=>{
  assert.equal(P.worldSeed,74193);assert.equal(P.communicationSeed,211);
  assert.equal(P.fixedStep,1/60);assert.equal(P.speed,1);
  assert.equal(P.targetSeconds,1200);assert.equal(P.pollWallMs,1000);
  assert.equal(P.detailSeconds,10);assert.equal(P.wallLimitMs,30*60*1000);
  assert.equal(P.structuredBytes,32*1024*1024);
  assert.equal(P.terminalReserveBytes,256*1024);
  assert.equal(P.mediaBytes,16*1024*1024);assert.equal(P.maxIpcBytes,256*1024);
  assert.equal(P.stopGraceMs,5000);assert.equal(P.platform,'linux');
  assert.equal(P.architecture,'x64');
  assert.equal(P.activationRef,'experiments/character-ordinary-pilot-v1-once');
  assert.equal(P.receiptRef,'experiments/character-ordinary-pilot-v1-receipt');
  assert.equal(CHARACTER_PILOT_COUNT_KEYS.length,21);
});

test('serialized fresh guard and projection observe actual untrained world without mutation',async()=>{
  const source=freshSource(),before=hash(source);
  const ready=runGuard(source);assert.equal(ready.ready,true);
  assert.deepEqual(Array.from(ready.individuals,row=>row.id),['aster','mira']);
  const projection=await runProjection(source);validateCharacterPilotProjection(projection);
  assert.equal(hash(source),before);assert.equal(projection.elapsed,0);
  assert.equal(projection.actors[0].character.partnerBanks[0].trained,false);
  assert.equal(projection.actors[1].character.partnerBanks[0].retainedExamples,0);
  assert.equal(projection.actors[0].body.health,100);
  assert.equal(projection.counts.optionalChecks,0);
  assert(Buffer.byteLength(JSON.stringify(projection),'utf8')<P.maxIpcBytes);
  assert(!/"(?:features|pixels|weights|anchors|rngState|trajectory|referenceCorrectness)"/.test(
    JSON.stringify(projection)));
  fresh.projection=copy(projection);
});

test('fresh guard rejects occupied, altered, trained and fixture-owned starts',()=>{
  const source=freshSource();
  assert.throws(()=>runGuard(source,{storageLength:1}),/profile/);
  assert.throws(()=>runGuard(source,{saved:'{}'}),/profile/);
  assert.throws(()=>runGuard(source,{speed:'2'}),/clock/);
  assert.throws(()=>runGuard(source,{fixture:{owner:true}}),/clock/);
  assert.throws(()=>runGuard(source,{route:'aincrad:\/\/app\/index.html'}),/route/);
  for(const mutate of [
    s=>{s.world.environment.seed=74194;},
    s=>{s.world.visualReference.seed=212;},
    s=>{s.world.characterMessages.learners[0].sender.updates=1;},
    s=>{s.world.visualReference.learners[0].anchors.push({});},
    s=>{s.measurement.counts.emissions=1;},
    s=>{s.measurement.actors[0].character.partnerBanks[0].trained=true;},
    s=>{s.measurement.phase=null;},
    s=>{s.measurement.limits.eventRows=255;},
    s=>{s.reference.enabled=false;},
  ])assert.throws(()=>runGuard(moved(source,mutate)),/guard/);
});

test('serialized clock pauses exactly once on first target crossing and validates Date.now',()=>{
  const state={elapsed:0,started:false,paused:false,blocked:false};let pauses=0;
  const q={snapshot:()=>({...state}),pause(){pauses++;state.paused=true;},
    referenceFixtureState:()=>null};
  const context={window:{__ozarkWorld:q},document:{getElementById:()=>({value:'1'})},Date,Number};
  const read=stopAt=>vm.runInNewContext('('+readCharacterPilotClock.toString()+')('+stopAt+')',context);
  validateCharacterPilotClock(read('null'),{started:false});
  state.started=true;state.elapsed=1199.5;
  validateCharacterPilotClock(read('1200'));assert.equal(pauses,0);
  state.elapsed=1200.25;const first=read('1200');validateCharacterPilotClock(first);
  assert.equal(first.threshold,true);assert.equal(first.pausedElapsed,1200.25);
  assert(first.observedWallMs>1e12);assert.equal(pauses,1);
  const repeated=read('1200');validateCharacterPilotClock(repeated);
  assert.equal(repeated.threshold,false);assert.equal(pauses,1);
  assert.throws(()=>validateCharacterPilotClock({...first,speed:2}),/clock/);
  assert.throws(()=>validateCharacterPilotClock({...first,fixtureOwned:true}),/clock/);
  assert.throws(()=>validateCharacterPilotClock({...first,threshold:false,paused:false,
    pausedElapsed:null}),/clock/);
  assert.throws(()=>validateCharacterPilotClock({...first,
    pausedElapsed:first.elapsed-1/60}),/clock/);
  assert.throws(()=>validateCharacterPilotClock({...first,observedWallMs:Infinity}),/clock/);
});

test('host rejects hidden nested fields, malformed counts, identities and event payloads',()=>{
  const base=freshSource().projection;validateCharacterPilotProjection(base);
  const bad=[
    s=>{s.worldSeed=74194;},
    s=>{s.counts.emissions=NaN;},
    s=>{s.counts.criticCorrect=1;},
    s=>{s.actors[0].body.pixels=[1,2,3];},
    s=>{s.actors[0].totals.ingestedKcal=Infinity;},
    s=>{s.actors[0].stats.independentMeals=0.5;},
    s=>{s.actors[0].survival.counters.begun='1';},
    s=>{s.actors[0].survival.gateCounts['bad key']=1;},
    s=>{s.actors[0].character.partnerBanks[0].weights=[1];},
    s=>{s.actors[1].identity=3;},
    s=>{s.player.body.features=[1];},
    s=>{s.eventsRetained=1;},
    s=>{s.reasons=[{kind:'original',stage:'choice',reason:'bad',count:1,pixels:[]}];},
    s=>{s.counts.optionalChecks=1;s.counts.feasibleOpportunities=1;
      s.counts.emissions=1;s.eventsRetained=1;s.events=[{
        id:1,emittedAt:0,endedAt:null,senderId:'aster',receiverId:'mira',
        message:'tree',action:'inspect_object',choiceMode:'uniform-exploration',
        status:'choice',reason:null,correction:null,feedbackStatus:null,
        feedbackReason:null,referenceCorrect:null,listenerReplayUses:null,
        listenerUpdate:false,senderUpdate:false,selectedActionId:null,
        indicationActionId:null,responseActionId:null,features:[0,1]}];},
  ];
  for(const mutate of bad)assert.throws(()=>validateCharacterPilotProjection(
    moved(base,mutate)));
});

test('reconciled replacements retain private bank lineage; transient loss is explicit',async()=>{
  const previous=freshSource().projection;
  const replaced=moved(previous,s=>{
    s.actors[0].identity=3;s.actors[1].identity=4;
    s.actors[0].character.partnerBanks[0].partnerSerial=4;
    s.actors[1].character.partnerBanks[0].partnerSerial=3;
  });
  validateCharacterPilotProjection(replaced);
  assert.throws(()=>validateCharacterPilotProjection(moved(replaced,s=>{
    s.actors[0].character.partnerBanks[0].partnerSerial=2;
  })),/actor/);
  const staleSource=moved(freshSource(),s=>{
    s.measurement.identityPendingReconciliation=true;
    s.measurement.pending=null;s.measurement.actors=[];s.measurement.events=[];
    s.measurement.eventsRetained=1;
    s.measurement.counts.optionalChecks=1;
    s.measurement.counts.feasibleOpportunities=1;
    s.measurement.counts.emissions=1;
  });
  const hidden=await runProjection(staleSource);
  validateCharacterPilotProjection(hidden);
  assert.equal(hidden.pending,null);assert.equal(hidden.eventsRetained,1);
  assert.deepEqual(hidden.events,[]);
  assert.equal(hidden.actors[0].identity,null);
  assert.equal(hidden.actors[0].character,null);
  const tracker=createCharacterPilotTracker();
  tracker.ingest(sample(0,[event(1)],{optionalChecks:1,feasibleOpportunities:1,
    emissions:1}));
  const status=tracker.ingest(hidden);
  assert.equal(status.coverage.identityPendingReconciliation,true);
  assert.equal(status.coverage.identityHiddenRows,1);
  assert.equal(status.coverage.missingTerminalOnIdentityGap,1);
  assert.equal(status.pendingObserved,null);
  assert.equal(status.accuracy.defined,false);
});

test('wall slots and simulation detail windows skip missed samples without catch-up',()=>{
  const schedule=createCharacterPilotSchedule({startWallMs:100});
  assert.deepEqual(schedule.poll(1099),{due:false,slot:0,missedWallSlots:0,waitMs:1});
  assert.deepEqual(schedule.poll(1100),{due:true,slot:1,missedWallSlots:0,waitMs:0});
  assert.deepEqual(schedule.poll(4600),{due:true,slot:4,missedWallSlots:2,waitMs:0});
  assert.equal(schedule.poll(4600).due,false);
  assert.deepEqual(schedule.detail(0),{due:true,missedSimulationWindows:0});
  assert.equal(schedule.detail(9.99).due,false);
  assert.deepEqual(schedule.detail(31),{due:true,missedSimulationWindows:2});
  assert.deepEqual(schedule.detail(31.1,{terminal:true}),
    {due:true,missedSimulationWindows:0});
  assert.equal(schedule.snapshot().missedWallSlots,2);
  assert.equal(schedule.snapshot().missedSimulationWindows,2);
  assert.throws(()=>schedule.detail(30),/simulation time/);
});

function event(id,{status='choice',feedbackStatus=null,endedAt=null,
  referenceCorrect=null,listenerUpdate=false,senderUpdate=false}={}){
  return {id,emittedAt:0,endedAt,senderId:'aster',receiverId:'mira',message:'lvfvty',
    action:'inspect_object',choiceMode:'uniform-exploration',status,reason:null,
    correction:null,feedbackStatus,feedbackReason:null,referenceCorrect,
    listenerReplayUses:null,listenerUpdate,senderUpdate,
    selectedActionId:null,indicationActionId:null,responseActionId:null};
}
function sample(elapsed,events,counts={}){
  const row=copy(freshSource().projection);row.elapsed=elapsed;row.wallMs=Date.now();
  row.clocks={environment:elapsed,ecology:elapsed,pending:0};
  row.actors.forEach(actor=>{actor.elapsed=elapsed;});
  row.events=events;row.eventsRetained=events.length;
  Object.assign(row.counts,counts);return row;
}
test('tracker keeps physical denominators, qualified 50% reference and retained gaps distinct',()=>{
  const tracker=createCharacterPilotTracker();
  let row=tracker.ingest(sample(0,[]));
  assert.equal(row.accuracy.defined,false);assert.equal(row.accuracy.rate,null);
  assert.equal(row.accuracy.reference,0.5);
  row=tracker.ingest(sample(1,[event(1)],{optionalChecks:1,feasibleOpportunities:1,
    emissions:1}));assert.equal(row.changes.length,1);
  row=tracker.ingest(sample(10,[event(1,{status:'observed',feedbackStatus:'awaiting-response',
    referenceCorrect:true,listenerUpdate:true})],{
    optionalChecks:1,feasibleOpportunities:1,emissions:1,
    paidInspectionStarts:1,paidInspectionCompletions:1,
    canonicalDemonstrations:1,criticCorrect:1,validListenerDemonstrations:1,
    listenerOptimizerSteps:1}));
  assert.equal(row.accuracy.numerator,1);assert.equal(row.accuracy.denominator,1);
  assert.equal(row.accuracy.rate,1);assert.match(row.accuracy.referenceQualification,
    /conditional on a canonical demonstration/);
  assert.equal(row.pendingObserved,1);
  const terminal=sample(20,[event(1,{status:'observed',feedbackStatus:'matched',endedAt:20,
    referenceCorrect:true,listenerUpdate:true,senderUpdate:true})],{
    optionalChecks:1,feasibleOpportunities:1,emissions:1,
    paidInspectionStarts:1,paidInspectionCompletions:1,
    canonicalDemonstrations:1,criticCorrect:1,validListenerDemonstrations:1,
    listenerOptimizerSteps:1,paidReplyStarts:1,paidReplyCompletions:1,
    visualMatches:1,senderUpdates:1});
  row=tracker.ingest(terminal);assert.equal(row.pendingObserved,0);
  assert.equal(row.ratios.senderUpdatesPerReply.rate,1);
  assert.equal(tracker.ingest(terminal).changes.length,0);
  const next=sample(30,[event(3)],{...terminal.counts,optionalChecks:2,
    feasibleOpportunities:2,emissions:2});next.eventsEvicted=1;
  row=tracker.ingest(next);assert.deepEqual(row.gaps,[{from:2,to:2}]);
  assert.equal(row.coverage.missingIds,1);assert.equal(row.coverage.eventsEvicted,1);
  assert.equal(row.pendingObserved,1);
  assert.throws(()=>tracker.ingest(sample(29,[])),/regressed/);
});

test('UTF8 records, media and final reserve obey whole-byte caps with immutable cause',()=>{
  const budget=createCharacterPilotBudget({structuredBytes:100,mediaBytes:10,
    terminalReserveBytes:20});
  const first=budget.record({word:'☃'});
  assert(first.ok);assert.equal(first.bytes,Buffer.byteLength(first.line,'utf8'));
  assert(!budget.reserve('structured',81-first.bytes,{wallMs:1}));
  assert.equal(budget.snapshot().firstCause.reason,'structured-cap');
  assert.equal(budget.snapshot().used.structured,first.bytes);
  assert(budget.reserve('structured',100-first.bytes,{terminal:true}));
  assert(!budget.reserve('structured',1,{terminal:true,wallMs:2}));
  assert(!budget.reserve('media',11,{wallMs:3}));
  budget.stop('wall-cap',4);assert.equal(budget.snapshot().firstCause.reason,'structured-cap');
  assert.equal(budget.snapshot().causes.length,3);
  for(let i=0;i<30;i++)budget.stop('error-'+i,i);
  assert(budget.snapshot().additionalErrors.length<=16);
  const huge={type:'result',complete:true,terminal:{projection:{elapsed:1200,
    events:['☃'.repeat(100000)]}},budget:budget.snapshot()};
  const final=boundedCharacterPilotTerminal(huge);
  assert.equal(final.complete,false);assert.equal(final.terminalTruncated,true);
  assert(Buffer.byteLength(JSON.stringify(final)+'\n','utf8')<=192*1024);
});
