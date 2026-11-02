import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  FOOD_RUN_STAGES,FOOD_RUN_REACH,FOOD_RUN_END_REASONS,
  markFoodRunChoice,normalizeFoodRunChoice,dispatchFoodRunChoice,
  noteFoodRunPaid,finishFoodRunAction,endFoodRun,foodRunSnapshot,
  disposeFoodRunObserver,setFoodRunObserverEnabled,
} from '../src/food-run-observer.js';

function fixture(){const run={cursor:0},actor={epoch:1,discovery:{run},physiology:{},active:null,rng:17};return {actor,run};}
function begin(actor,run,stage='travel',reach='unknown'){
  const raw=stage==='travel'?{type:'move',target:{x:80,y:0}}:
    {type:stage==='sample'?'sample':'pull',targetId:'object:4'};
  assert.equal(markFoodRunChoice(actor,run,raw,stage,{reach}),true);
  const normalized=structuredClone(raw);
  assert.equal(normalizeFoodRunChoice(actor,raw,normalized),true);
  const active={request:structuredClone(normalized)};actor.active=active;
  assert.equal(dispatchFoodRunChoice(actor,raw,{ok:true,code:stage==='travel'?'STARTED':'ACTION_STARTED'},active),true);
  return {raw,normalized,active};
}

test('exact selected travel admits once, records certified work once, then consumes one terminal',()=>{
  const {actor,run}=fixture(),{raw,active}=begin(actor,run,'travel','observed');
  assert.equal(dispatchFoodRunChoice(actor,raw,{ok:true,code:'STARTED'},active),false);
  assert.equal(noteFoodRunPaid(actor,active,.2),true);
  assert.equal(noteFoodRunPaid(actor,active,.3),true);
  const before=foodRunSnapshot(actor);
  assert.equal(before.stages.travel.selected,1);assert.equal(before.stages.travel.reach.observed,1);
  assert.equal(before.stages.travel.admitted,1);assert.equal(before.stages.travel.firstPaid,1);
  assert.equal(before.stages.travel.certifiedPaidSeconds,.5);assert.deepEqual(before.pending,{selected:0,active:1});
  assert.equal(finishFoodRunAction(actor,active,{type:'move',target:{x:80,y:0}},{ok:true,code:'ARRIVED'}),true);
  assert.equal(finishFoodRunAction(actor,active,active.request,{ok:true,code:'ARRIVED'}),false);
  assert.equal(noteFoodRunPaid(actor,active,.1),false);
  assert.equal(foodRunSnapshot(actor).stages.travel.completed,1);
  assert.deepEqual(foodRunSnapshot(actor).pending,{selected:0,active:0});
});

test('physically admitted acquisition and sample have separate stage and reach counts',()=>{
  const {actor,run}=fixture();let work=begin(actor,run,'acquisition','observed');
  noteFoodRunPaid(actor,work.active,1.8);
  assert.equal(finishFoodRunAction(actor,work.active,work.active.request,{ok:true,code:'piece_detached'}),true);
  actor.active=null;work=begin(actor,run,'sample','held');
  noteFoodRunPaid(actor,work.active,.25);
  assert.equal(finishFoodRunAction(actor,work.active,work.active.request,{ok:true,code:'SWALLOWED'}),true);
  assert.equal(endFoodRun(actor,run,'complete'),true);
  assert.equal(endFoodRun(actor,run,'complete'),false);
  const s=foodRunSnapshot(actor);
  assert.equal(s.stages.acquisition.completed,1);assert.equal(s.stages.sample.completed,1);
  assert.equal(s.stages.sample.reach.held,1);assert.equal(s.runEnds.complete,1);
  assert.equal(JSON.stringify(s).includes('object:4'),false);
});

test('copied selection, recovery substitution and changed normalized target never attach',()=>{
  for(const kind of ['copied','substituted','changed']){
    const {actor,run}=fixture(),raw={type:'move',target:{x:80,y:0}};
    assert.equal(markFoodRunChoice(actor,run,raw,'travel'),true);
    const candidate=kind==='copied'?structuredClone(raw):
      kind==='substituted'?{type:'move',target:{x:0,y:80}}:raw;
    const normalized=kind==='changed'?{type:'move',target:{x:81,y:0}}:structuredClone(candidate);
    assert.equal(normalizeFoodRunChoice(actor,candidate,normalized),false);
    assert.equal(dispatchFoodRunChoice(actor,candidate,{ok:true,code:'STARTED'},null),false);
    const s=foodRunSnapshot(actor).stages.travel;
    assert.equal(s.admitted,0);assert.equal(s.substituted,kind==='changed'?0:1);
    assert.equal(s.normalizationRejected,kind==='changed'?1:0);
  }
});

test('synchronous rejection and no-work arrival remain distinct from paid admission',()=>{
  for(const code of ['NO_KNOWN_ROUTE','OBJECT_GONE']){
    const {actor,run}=fixture(),stage=code==='NO_KNOWN_ROUTE'?'travel':'acquisition';
    const raw=stage==='travel'?{type:'move',target:{x:80,y:0}}:{type:'pull',targetId:'object:4'};
    markFoodRunChoice(actor,run,raw,stage);normalizeFoodRunChoice(actor,raw,structuredClone(raw));
    assert.equal(dispatchFoodRunChoice(actor,raw,{ok:false,code},null),true);
    const row=foodRunSnapshot(actor).stages[stage];assert.equal(row.immediateRejected,1);
    assert.equal(row.rejectionReasons[code],1);assert.equal(row.admitted,0);
  }
  const {actor,run}=fixture(),raw={type:'move',target:{x:80,y:0}};
  markFoodRunChoice(actor,run,raw,'travel');normalizeFoodRunChoice(actor,raw,structuredClone(raw));
  assert.equal(dispatchFoodRunChoice(actor,raw,{ok:true,code:'ARRIVED'},null),true);
  assert.equal(foodRunSnapshot(actor).stages.travel.instantCompleted,1);
  assert.equal(foodRunSnapshot(actor).stages.travel.firstPaid,0);
});

test('synchronous primitive preflight may end run before controller dispatches its negative result',()=>{
  const {actor,run}=fixture(),raw={type:'pull',targetId:'object:4'};
  assert.equal(markFoodRunChoice(actor,run,raw,'acquisition',{reach:'observed'}),true);
  assert.equal(normalizeFoodRunChoice(actor,raw,structuredClone(raw)),true);
  assert.equal(endFoodRun(actor,run,'action-failed'),true);
  actor.discovery.run=null;
  assert.equal(dispatchFoodRunChoice(actor,raw,{ok:false,code:'OBJECT_GONE'},null),true);
  assert.equal(dispatchFoodRunChoice(actor,raw,{ok:false,code:'OBJECT_GONE'},null),false);
  const row=foodRunSnapshot(actor).stages.acquisition;
  assert.equal(row.immediateRejected,1);assert.equal(row.rejectionReasons.OBJECT_GONE,1);
  assert.equal(row.admitted,0);assert.equal(row.firstPaid,0);

  const other=fixture(),copy={type:'pull',targetId:'object:4'};
  markFoodRunChoice(other.actor,other.run,copy,'acquisition');
  normalizeFoodRunChoice(other.actor,copy,structuredClone(copy));
  endFoodRun(other.actor,other.run,'action-failed');
  const forgedActive={request:structuredClone(copy)};other.actor.active=forgedActive;
  assert.equal(dispatchFoodRunChoice(other.actor,copy,{ok:true,code:'ACTION_STARTED'},forgedActive),false);
  assert.equal(foodRunSnapshot(other.actor).stages.acquisition.admitted,0);
});

test('ended run leaves only its admitted terminal witness, never fresh paid authority',()=>{
  const {actor,run}=fixture(),{active}=begin(actor,run);
  assert.equal(noteFoodRunPaid(actor,active,.1),true);
  assert.equal(endFoodRun(actor,run,'expired'),true);
  assert.equal(noteFoodRunPaid(actor,active,.1),false);
  assert.equal(finishFoodRunAction(actor,active,active.request,{ok:false,code:'ACTION_TIMEOUT'}),true);
  const row=foodRunSnapshot(actor).stages.travel;
  assert.equal(row.failed,1);assert.equal(row.interrupted,1);
  assert.equal(row.interruptionReasons.ACTION_TIMEOUT,1);assert.equal(foodRunSnapshot(actor).runEnds.expired,1);
});

test('wrong actor, stale active, invalid paid slices, and copied terminal cannot claim a run',()=>{
  const {actor,run}=fixture(),{active}=begin(actor,run,'acquisition');
  const other=fixture().actor;other.active=active;
  for(const value of [0,-1,NaN,Infinity,13])assert.equal(noteFoodRunPaid(actor,active,value),false);
  assert.equal(noteFoodRunPaid(other,active,.1),false);
  assert.equal(finishFoodRunAction(other,active,active.request,{ok:true,code:'piece_detached'}),false);
  assert.equal(finishFoodRunAction(actor,structuredClone(active),active.request,{ok:true,code:'piece_detached'}),false);
  assert.equal(finishFoodRunAction(actor,active,{type:'pull',targetId:'object:5'},{ok:true,code:'piece_detached'}),false);
  assert.equal(foodRunSnapshot(actor).stages.acquisition.firstPaid,0);
  assert.equal(finishFoodRunAction(actor,active,active.request,{ok:false,code:'PRIORITY_CHANGED'}),true);
  assert.equal(foodRunSnapshot(actor).stages.acquisition.interruptionReasons.PRIORITY_CHANGED,1);
});

test('identity change projects loss without mutating on read; next session starts clean',()=>{
  const {actor,run}=fixture();begin(actor,run);
  actor.epoch++;
  const first=foodRunSnapshot(actor),second=foodRunSnapshot(actor);
  assert.deepEqual(first,second);assert.equal(first.sessionLosses,1);
  assert.equal(first.sessionResets,1);assert.equal(first.stages.travel.selected,0);
  assert.equal(noteFoodRunPaid(actor,actor.active,.1),false);
  assert.equal(foodRunSnapshot(actor).sessionLosses,1);
  const next={cursor:0};actor.discovery.run=next;assert.equal(markFoodRunChoice(actor,next,{type:'move',target:{x:80,y:0}},'travel'),true);
  assert.equal(foodRunSnapshot(actor).stages.travel.selected,1);
});

test('identity reset and read-only projection carry exact saturation at a small fixed bound',async()=>{
  const source=await readFile(new URL('../src/food-run-observer.js',import.meta.url),'utf8');
  assert.equal(source.split('counter:2147483647').length-1,1);
  const bounded=await import(`data:text/javascript;base64,${Buffer.from(
    source.replace('counter:2147483647','counter:2')).toString('base64')}`);
  const actor={epoch:1,discovery:{run:null},physiology:{},active:null};
  const mark=()=>{const run={};actor.discovery.run=run;
    assert.equal(bounded.markFoodRunChoice(actor,run,{type:'move',target:{x:80,y:0}},'travel'),true);};
  mark();actor.epoch=2;actor.discovery={run:null};mark();
  assert.equal(bounded.foodRunSnapshot(actor).sessionResets,1);
  actor.epoch=3;actor.discovery={run:null};
  const projected=bounded.foodRunSnapshot(actor);
  assert.equal(projected.sessionResets,2);assert.equal(projected.sessionLosses,2);
  assert.equal(projected.saturated,true);
  assert.deepEqual(bounded.foodRunSnapshot(actor),projected,'read-only projection is repeatable');
  mark();const actual=bounded.foodRunSnapshot(actor);
  assert.equal(actual.sessionResets,2);assert.equal(actual.sessionLosses,2);
  assert.equal(actual.saturated,true);
  actor.epoch=4;actor.discovery={run:null};mark();
  assert.equal(bounded.foodRunSnapshot(actor).sessionResets,2);
  assert.equal(bounded.foodRunSnapshot(actor).saturated,true);
});

test('disposal returns defensive loss summary, then reattach and reopen are fresh',()=>{
  const {actor,run}=fixture();begin(actor,run);
  const final=disposeFoodRunObserver(actor);
  assert.equal(final.stages.travel.unavailable,1);assert.equal(final.sessionLosses,1);
  assert.equal(final.sessionResets,1);assert.equal(final.runEnds['identity-loss'],1);
  final.stages.travel.reach.unknown=999;
  assert.equal(foodRunSnapshot(actor).stages.travel.selected,0);
  const reopened=fixture().actor;assert.equal(foodRunSnapshot(reopened).stages.travel.selected,0);
});

test('a route-missing run can end before any selected action; snapshots are defensive and pure',()=>{
  const {actor,run}=fixture(),before=structuredClone(actor);
  assert.equal(endFoodRun(actor,run,'no-route'),true);
  assert.equal(endFoodRun(actor,run,'no-route'),false);
  const first=foodRunSnapshot(actor),second=foodRunSnapshot(actor);
  assert.deepEqual(first,second);assert.deepEqual(actor,before);
  assert.equal(first.runEnds['no-route'],1);assert.equal(first.stages.travel.selected,0);
  first.runEnds['no-route']=99;first.stages.travel.reach.unknown=99;
  assert.equal(foodRunSnapshot(actor).runEnds['no-route'],1);
  assert.equal(foodRunSnapshot(actor).stages.travel.reach.unknown,0);
});

test('unmarked terminal needs a live run at the hook; fixed other reason is available',()=>{
  const left=fixture();left.actor.discovery.run=null;
  assert.equal(endFoodRun(left.actor,left.run,'no-route'),false);
  assert.equal(foodRunSnapshot(left.actor).runEnds['no-route'],0);
  const right=fixture();
  assert.equal(endFoodRun(right.actor,right.run,'other'),true);
  assert.equal(foodRunSnapshot(right.actor).runEnds.other,1);
});

test('an unrecognized success cannot be misreported as physical admission or completion',()=>{
  const {actor,run}=fixture(),raw={type:'move',target:{x:80,y:0}};
  markFoodRunChoice(actor,run,raw,'travel');normalizeFoodRunChoice(actor,raw,structuredClone(raw));
  const active={request:structuredClone(raw)};actor.active=active;
  assert.equal(dispatchFoodRunChoice(actor,raw,{ok:true,code:'FAKE_STARTED'},active),false);
  const row=foodRunSnapshot(actor).stages.travel;
  assert.equal(row.admitted,0);assert.equal(row.completed,0);assert.equal(row.unavailable,1);
});

test('diagnostic accepts the same object ID spelling as production validation',()=>{
  const {actor,run}=fixture(),raw={type:'pull',targetId:'object:000'};
  assert.equal(markFoodRunChoice(actor,run,raw,'acquisition'),true);
  assert.equal(normalizeFoodRunChoice(actor,raw,structuredClone(raw)),true);
  const active={request:structuredClone(raw)};actor.active=active;
  assert.equal(dispatchFoodRunChoice(actor,raw,{ok:true,code:'ACTION_STARTED'},active),true);
  assert.equal(finishFoodRunAction(actor,active,active.request,{ok:true,code:'piece_detached'}),true);
});

test('disabled observer leaves actor, RNG, and learner unchanged; hostile calls are inert',()=>{
  const {actor,run}=fixture(),before=structuredClone(actor);
  assert.equal(setFoodRunObserverEnabled(actor,false),true);
  assert.equal(markFoodRunChoice(actor,run,{type:'move',target:{x:80,y:0}},'travel'),false);
  assert.deepEqual(actor,before);assert.equal(foodRunSnapshot(actor).stages.travel.selected,0);
  assert.equal(setFoodRunObserverEnabled(actor,true),true);
  for(const fn of [markFoodRunChoice,normalizeFoodRunChoice,dispatchFoodRunChoice,
    noteFoodRunPaid,finishFoodRunAction,endFoodRun,foodRunSnapshot,disposeFoodRunObserver])
    assert.doesNotThrow(()=>fn(new Proxy({}, {getPrototypeOf(){throw Error('hostile');}})));
  assert.deepEqual(FOOD_RUN_STAGES,['travel','acquisition','sample']);
  assert.deepEqual(FOOD_RUN_REACH,['observed','held','unknown']);
  assert.ok(FOOD_RUN_END_REASONS.includes('no-route'));
});
