import test from 'node:test';
import assert from 'node:assert/strict';
import {
  consistentSelection,configureChoiceDiagnostics,beginChoiceDecision,traceChoice,
  beginChoiceRequest,finishChoiceRequest,completeChoiceRequest,
} from '../src/discovery-choice.js';
import {createSelectionMemory,chooseSelection} from '../src/discovery-selection.js';
import {createNpc} from '../src/npc-state.js';
import {validateNpc} from '../src/npc-memory.js';
import {decisionObservation} from '../src/controller.js';

const candidate=(score,type='pull',targetId='object:1')=>({action:{type,targetId},score,reason:'Observed candidate'});
const movement=(score,x=480)=>({action:{type:'move',target:{x,y:960}},score,reason:'Known legal route'});
const ranked=choice=>({...choice,score:.25,selection:{count:0,seconds:1,exertionRank:0,benefit:0,uncertainty:1,cost:2}});
function freeze(value){
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){
    for(const child of Object.values(value))freeze(child);
    Object.freeze(value);
  }
  return value;
}
function fixture({nomineeScore=20,moveScore=60}={}){
  const sponsor=candidate(100),nominee=candidate(nomineeScore,'sample','object:2'),move=movement(moveScore);
  const choices=[sponsor,move,nominee].sort((a,b)=>b.score-a.score);
  return {sponsor,nominee,move,choices,rank:ranked(nominee),gate:consistentSelection(choices,ranked(nominee))};
}
function traced(options){
  const npc={elapsed:12,active:null},rows=[],f=fixture(options);
  configureChoiceDiagnostics(npc,row=>rows.push(row));
  beginChoiceDecision(npc);traceChoice(npc,f.gate,f.rank);
  return {npc,rows,...f};
}

test('selection gate compares movement with the nominee original score, not its sponsor or learned score',()=>{
  const {sponsor,nominee,move,choices}=fixture();
  const model=createSelectionMemory();
  const chosen=chooseSelection(model,choices.filter(c=>c.action.type!=='move'),{},()=>.999);
  assert.notEqual(chosen,nominee);
  assert.equal(chosen.action,nominee.action);
  assert.notEqual(chosen.score,nominee.score);
  const gate=consistentSelection(choices,chosen);
  assert.equal(gate.selected,move);
  assert.equal(gate.selected.score,60);
  assert.equal(gate.sponsor,sponsor);
  assert.equal(gate.nominee,nominee);
  assert.equal(gate.nominee.score,20);
  assert.equal(gate.movement,move);
  assert.equal(gate.veto,true);
});

test('selection gate keeps a nominee whose own legacy score exceeds movement even when its learned score does not',()=>{
  const {gate,nominee}=fixture({nomineeScore:80});
  assert.equal(gate.selected,nominee);
  assert.equal(gate.selected.score,80);
  assert.equal(gate.veto,false);
});

test('movement needs a strictly greater original score; exact ties retain the nominee',()=>{
  for(const score of [60,0,-3]){
    const nominee=candidate(score,'sample','object:2'),move=movement(score),choices=[candidate(100),move,nominee];
    assert.equal(consistentSelection(choices,ranked(nominee)).selected,nominee);
    assert.equal(consistentSelection(choices,ranked(nominee)).veto,false);
    move.score=score+Number.EPSILON*Math.max(1,Math.abs(score));
    assert.equal(consistentSelection(choices,ranked(nominee)).selected,move);
  }
});

test('same-primitive targets retain distinct original candidate identities and scores',()=>{
  const first=candidate(100,'sample','object:1'),second=candidate(80,'sample','object:2');
  const last=candidate(20,'sample','object:3'),move=movement(60),choices=[first,second,move,last];
  assert.equal(consistentSelection(choices,ranked(second)).selected,second);
  const rejected=consistentSelection(choices,ranked(last));
  assert.equal(rejected.nominee,last);
  assert.equal(rejected.selected,move);
  // Even structurally identical action objects must not substitute for each other.
  const duplicate=candidate(10,'sample','object:2');
  choices.push(duplicate);
  assert.equal(consistentSelection(choices,ranked(duplicate)).nominee,duplicate);
  assert.equal(consistentSelection(choices,ranked(duplicate)).selected,move);
});

test('the best legal movement retains stable input order across tied routes',()=>{
  const sponsor=candidate(100),first=movement(60,480),second=movement(60,960),lower=movement(55,1440),nominee=candidate(20,'sample');
  const choices=[sponsor,first,second,lower,nominee],before=[...choices];
  const gate=consistentSelection(choices,ranked(nominee));
  assert.equal(gate.movement,first);
  assert.equal(gate.selected,first);
  assert.deepEqual(choices,before);
  choices.forEach((choice,i)=>assert.equal(choice,before[i]));
});

test('without a legal movement candidate the nominated object keeps its own legacy score',()=>{
  const sponsor=candidate(100),nominee=candidate(-4,'sample'),gate=consistentSelection([sponsor,nominee],ranked(nominee));
  assert.equal(gate.selected,nominee);
  assert.equal(gate.selected.score,-4);
  assert.equal(gate.movement,null);
  assert.equal(gate.veto,false);
  assert.equal(consistentSelection([],null),null);
});

test('an original movement winner bypasses nomination and remains the exact original candidate',()=>{
  const first=movement(100),choices=freeze([first,candidate(80)]);
  for(const nominee of [null,undefined,{},ranked(candidate(999)),{action:{type:'move'}}]){
    const gate=consistentSelection(choices,nominee);
    assert.equal(gate.selected,first);
    assert.equal(gate.sponsor,first);
    assert.equal(gate.movement,first);
    assert.equal(gate.nominee,null);
    assert.equal(gate.veto,false);
  }
});

test('unknown, cloned-action and movement nominees cannot borrow another candidate score',()=>{
  const {choices,nominee,move}=fixture();
  for(const invalid of [null,undefined,{},structuredClone(nominee),candidate(1000,'sample','object:99'),ranked(move)]){
    assert.throws(()=>consistentSelection(choices,invalid),/existing candidate by action identity/);
  }
  // A new ranking wrapper is expected; the action reference is the identity.
  assert.equal(consistentSelection(choices,{...nominee,score:9999}).nominee,nominee);
});

test('selection and the gate preserve candidate arrays, actions, metadata and order',()=>{
  const {choices}=fixture(),snapshot=structuredClone(choices),references=[...choices];
  freeze(choices);
  const model=createSelectionMemory(),nominee=chooseSelection(model,choices.filter(c=>c.action.type!=='move'),{},()=>.999);
  freeze(nominee);
  const gate=consistentSelection(choices,nominee);
  assert.equal(gate.selected,references[1]);
  assert.deepEqual(choices,snapshot);
  choices.forEach((choice,i)=>assert.equal(choice,references[i]));
  assert.equal(nominee.action,references[2].action);
  assert.equal(nominee.reason,references[2].reason);
});

test('gated and ungated nominations use exactly two selection RNG draws in normal and exploration phases',()=>{
  for(const phase of [0,7])for(const nomineeScore of [20,80]){
    const {choices}=fixture({nomineeScore}),options=choices.filter(c=>c.action.type!=='move');
    const base={...createSelectionMemory(),phase},gated=structuredClone(base),ungated=structuredClone(base);
    let gateDraws=0,plainDraws=0;
    const nominated=chooseSelection(gated,options,{},()=>{gateDraws++;return .999;});
    const expected=chooseSelection(ungated,options,{},()=>{plainDraws++;return .999;});
    const gate=consistentSelection(choices,nominated);
    assert.equal(gateDraws,2);
    assert.equal(plainDraws,2);
    assert.equal(nominated.action,expected.action);
    assert.equal(gate.veto,nomineeScore===20);
    assert.deepEqual(gated,ungated);
  }
});

test('the saved selection stream advances exactly twice and gating never changes actor navigation RNG',()=>{
  const step=rng=>(Math.imul(rng,1664525)+1013904223)>>>0;
  for(const phase of [0,7])for(const seed of [0,1,0xffffffff]){
    const npc=createNpc({mode:'discovery',seed:74193}),actorRng=npc.rng;
    npc.discovery.selection={...createSelectionMemory(),phase,rng:seed};
    const {choices}=fixture(),options=choices.filter(c=>c.action.type!=='move');
    const plain=structuredClone(npc.discovery.selection);
    const nominee=chooseSelection(npc.discovery.selection,options,{});
    const expected=chooseSelection(plain,options,{});
    consistentSelection(choices,nominee);
    assert.equal(nominee.action,expected.action);
    assert.equal(npc.discovery.selection.rng,step(step(seed)));
    assert.equal(npc.rng,actorRng);
    assert.deepEqual(npc.discovery.selection,plain);
  }
});

test('diagnostic callbacks receive deep copies and cannot change the scored or executed choice',()=>{
  const npc={elapsed:12,active:null},f=fixture(),before=structuredClone(f),rows=[];
  configureChoiceDiagnostics(npc,row=>{
    rows.push(structuredClone(row));
    if(row.type==='choice'){
      row.winner.action.target.x=-999;
      row.winner.legacyScore=-999;
      row.sponsor.action.targetId='object:999';
      row.nominee.action.targetId='object:998';
      row.movement.action.target.y=-888;
      row.selection.cost=9000;
    }else{
      row.action.type='sample';
      row.legacyScore=-1;
      if(row.result)row.result.code='CALLBACK_CHANGED';
    }
  });
  traceChoice(npc,f.gate,f.rank);
  beginChoiceRequest(npc,structuredClone(f.gate.selected.action));
  const active={request:structuredClone(f.gate.selected.action)};npc.active=active;
  finishChoiceRequest(npc,{ok:true,code:'STARTED'});
  const result={ok:false,code:'PRIORITY_CHANGED',durationSeconds:2};
  npc.active=null;completeChoiceRequest(npc,active,active.request,result,{id:51,at:14});
  assert.deepEqual(f,before);
  assert.equal(result.code,'PRIORITY_CHANGED');
  assert.deepEqual(active.request,f.gate.selected.action);
  assert.deepEqual(rows.map(row=>row.type),['choice','started','outcome']);
  for(const row of rows.slice(1)){
    assert.deepEqual(row.action,f.gate.selected.action);
    assert.equal(row.legacyScore,60);
    assert.equal(row.decisionId,rows[0].decisionId);
  }
});

test('diagnostic records snapshot candidate and ranking data before caller changes',()=>{
  const {npc,rows,gate,rank}=traced();
  const action=structuredClone(gate.selected.action);
  gate.selected.action.target.x=12345;gate.selected.score=-100;rank.selection.cost=999;
  assert.equal(rows[0].winner.legacyScore,60);
  assert.deepEqual(rows[0].winner.action,action);
  assert.equal(rows[0].selection.cost,2);
  beginChoiceRequest(npc,action);finishChoiceRequest(npc,{ok:false,code:'UNCONSCIOUS'});
  assert.deepEqual(rows[1].action,action);
  assert.equal(rows[1].legacyScore,60);
});

test('diagnostic setup, trace and immediate lifecycle hooks do not mutate actors, saved data or model observations',()=>{
  const npc=createNpc({mode:'discovery',seed:74193});npc.discovery.selection=createSelectionMemory();
  const observation=structuredClone(decisionObservation(npc)),saved=JSON.stringify(npc),model=structuredClone(npc.discovery.selection);
  const restoredBefore=validateNpc(JSON.parse(saved)),f=fixture(),rows=[];
  freeze(npc);
  configureChoiceDiagnostics(npc,row=>rows.push(row));
  beginChoiceDecision(npc);traceChoice(npc,f.gate,f.rank);
  beginChoiceRequest(npc,f.gate.selected.action);
  const result=freeze({ok:false,code:'UNOBSERVED_TARGET'}),event=freeze({id:73,at:0});
  completeChoiceRequest(npc,null,f.gate.selected.action,result,event);finishChoiceRequest(npc,result);
  assert.equal(JSON.stringify(npc),saved);
  assert.deepEqual(npc.discovery.selection,model);
  assert.deepEqual(decisionObservation(npc),observation);
  assert.deepEqual(validateNpc(JSON.parse(JSON.stringify(npc))),restoredBefore);
  assert.deepEqual(rows.map(row=>row.type),['choice','outcome']);
  configureChoiceDiagnostics(npc,null);
  assert.equal(JSON.stringify(npc),saved);
});

test('unconfigured, restored and disabled actors do not emit diagnostics or inherit pending decisions',()=>{
  const npc=createNpc({mode:'discovery'}),rows=[],f=fixture();
  const run=actor=>{
    beginChoiceDecision(actor);traceChoice(actor,f.gate,f.rank);beginChoiceRequest(actor,f.gate.selected.action);
    completeChoiceRequest(actor,null,f.gate.selected.action,{ok:true,code:'ARRIVED'},{id:1,at:0});
    finishChoiceRequest(actor,{ok:true,code:'ARRIVED'});
  };
  const before=JSON.stringify(npc);run(npc);assert.equal(JSON.stringify(npc),before);
  configureChoiceDiagnostics(npc,row=>rows.push(row));traceChoice(npc,f.gate,f.rank);
  run(validateNpc(JSON.parse(JSON.stringify(npc))));assert.equal(rows.length,1);
  configureChoiceDiagnostics(npc);run(npc);assert.equal(rows.length,1);
  assert.equal(JSON.stringify(npc),before);
});

test('a submitted action must match the actual winner, not its sponsor or rejected nominee',()=>{
  for(const field of ['sponsor','nominee']){
    const f=traced();
    assert.throws(()=>beginChoiceRequest(f.npc,f[field].action),/submitted choice/);
    finishChoiceRequest(f.npc,{ok:false,code:'INVALID_REQUEST'});
    assert.deepEqual(f.rows.map(row=>row.type),['choice']);
  }
  const f=traced(),wrongTarget=structuredClone(f.gate.selected.action);wrongTarget.target.x++;
  assert.throws(()=>beginChoiceRequest(f.npc,wrongTarget),/submitted choice/);
});

test('a started action must match the selected primitive and target before reporting its score',()=>{
  const f=traced();beginChoiceRequest(f.npc,f.gate.selected.action);
  f.npc.active={request:structuredClone(f.nominee.action)};
  assert.throws(()=>finishChoiceRequest(f.npc,{ok:true,code:'STARTED'}),/started action/);
  assert.deepEqual(f.rows.map(row=>row.type),['choice']);
});

test('a completed action must match its scored winner and wrong targets cannot consume the valid outcome',()=>{
  const f=traced();beginChoiceRequest(f.npc,f.gate.selected.action);
  const active={request:structuredClone(f.gate.selected.action)};f.npc.active=active;
  finishChoiceRequest(f.npc,{ok:true,code:'STARTED'});f.npc.active=null;
  const result={ok:true,code:'ARRIVED',durationSeconds:4},event={id:82,at:16};
  assert.throws(()=>completeChoiceRequest(f.npc,active,f.nominee.action,result,event),/completed action/);
  completeChoiceRequest(f.npc,active,active.request,result,event);
  assert.deepEqual(f.rows.map(row=>row.type),['choice','started','outcome']);
  assert.deepEqual(f.rows.at(-1).action,f.gate.selected.action);
  assert.equal(f.rows.at(-1).legacyScore,f.gate.selected.score);
});

test('equivalent submitted, started and completed actions match regardless of nested property order',()=>{
  const f=traced(),{x,y}=f.gate.selected.action.target;
  const submitted={target:{y,x},type:'move'},started={target:{x,y},type:'move'},completed={type:'move',target:{y,x}};
  beginChoiceRequest(f.npc,submitted);
  const active={request:started};f.npc.active=active;
  finishChoiceRequest(f.npc,{ok:true,code:'STARTED'});f.npc.active=null;
  completeChoiceRequest(f.npc,active,completed,{ok:true,code:'ARRIVED',durationSeconds:3},{id:85,at:15});
  assert.deepEqual(f.rows.map(row=>row.type),['choice','started','outcome']);
  for(const row of f.rows.slice(1)){
    assert.deepEqual(row.action,f.gate.selected.action);
    assert.equal(row.legacyScore,f.gate.selected.score);
    assert.equal(row.decisionId,f.rows[0].decisionId);
  }
});

test('immediate completion and rejection link their real action event once without a false started report',()=>{
  for(const result of [{ok:true,code:'ARRIVED'},{ok:false,code:'UNOBSERVED_TARGET'}]){
    const f=traced(),event={id:90,at:12},action=structuredClone(f.gate.selected.action);
    beginChoiceRequest(f.npc,action);
    completeChoiceRequest(f.npc,null,action,result,event);
    finishChoiceRequest(f.npc,{...result,eventId:event.id});
    completeChoiceRequest(f.npc,null,action,result,event);
    finishChoiceRequest(f.npc,result);
    assert.deepEqual(f.rows.map(row=>row.type),['choice','outcome']);
    assert.deepEqual(f.rows[1],{type:'outcome',decisionId:f.rows[0].decisionId,actionId:90,at:12,action,legacyScore:60,result:{...result,durationSeconds:0}});
  }
});

test('a rejection with no engine event is linked to its decision once without fabricating an action ID',()=>{
  const f=traced(),result={ok:false,code:'UNCONSCIOUS',details:{state:'collapsed'}};
  beginChoiceRequest(f.npc,f.gate.selected.action);finishChoiceRequest(f.npc,result);finishChoiceRequest(f.npc,result);
  assert.deepEqual(f.rows.map(row=>row.type),['choice','rejected']);
  assert.equal(f.rows[1].decisionId,f.rows[0].decisionId);
  assert.deepEqual(f.rows[1].action,f.gate.selected.action);
  assert.equal(f.rows[1].legacyScore,60);
  assert.equal('actionId' in f.rows[1],false);
  f.rows[1].result.details.state='changed';assert.equal(result.details.state,'collapsed');
});

test('later cancellation keeps the original decision and action IDs across a new decision boundary without duplicates',()=>{
  const f=traced();beginChoiceRequest(f.npc,f.gate.selected.action);
  const active={request:structuredClone(f.gate.selected.action)};f.npc.active=active;
  finishChoiceRequest(f.npc,{ok:true,code:'STARTED'});finishChoiceRequest(f.npc,{ok:true,code:'STARTED'});
  beginChoiceDecision(f.npc);f.npc.elapsed=20;f.npc.active=null;
  const result={ok:false,code:'PRIORITY_CHANGED',durationSeconds:8},event={id:101,at:20};
  completeChoiceRequest(f.npc,active,active.request,result,event);
  completeChoiceRequest(f.npc,active,active.request,result,event);
  finishChoiceRequest(f.npc,result);
  assert.deepEqual(f.rows.map(row=>row.type),['choice','started','outcome']);
  assert.deepEqual(f.rows[2],{type:'outcome',decisionId:f.rows[0].decisionId,actionId:101,at:20,action:active.request,legacyScore:60,result});
  assert.equal(f.rows[1].decisionId,f.rows[0].decisionId);
});

test('an unrelated active object cannot claim a selected action outcome even with an equal request',()=>{
  const f=traced();beginChoiceRequest(f.npc,f.gate.selected.action);
  const active={request:structuredClone(f.gate.selected.action)};f.npc.active=active;
  finishChoiceRequest(f.npc,{ok:true,code:'STARTED'});f.npc.active=null;
  const result={ok:false,code:'PRIORITY_CHANGED'},event={id:105,at:15};
  completeChoiceRequest(f.npc,structuredClone(active),active.request,result,event);
  assert.equal(f.rows.length,2);
  completeChoiceRequest(f.npc,active,active.request,result,event);
  assert.equal(f.rows.length,3);
  assert.equal(f.rows[2].actionId,event.id);
});

test('beginning another decision drops a stale unsubmitted choice without linking an unrelated request',()=>{
  const f=traced();beginChoiceDecision(f.npc);
  beginChoiceRequest(f.npc,f.nominee.action);finishChoiceRequest(f.npc,{ok:false,code:'UNCONSCIOUS'});
  completeChoiceRequest(f.npc,null,f.nominee.action,{ok:true,code:'SAMPLED'},{id:201,at:14});
  assert.deepEqual(f.rows.map(row=>row.type),['choice']);
  traceChoice(f.npc,f.gate,f.rank);beginChoiceRequest(f.npc,f.gate.selected.action);
  finishChoiceRequest(f.npc,{ok:false,code:'UNCONSCIOUS'});
  assert.equal(f.rows[1].decisionId,f.rows[0].decisionId+1);
  assert.equal(f.rows[2].decisionId,f.rows[1].decisionId);
});

test('movement bypass diagnostics omit learned nomination and retain the movement score through completion',()=>{
  const npc={elapsed:4,active:null},rows=[],move=movement(100),gate=consistentSelection([move,candidate(80)],null);
  configureChoiceDiagnostics(npc,row=>rows.push(row));traceChoice(npc,gate);
  beginChoiceRequest(npc,move.action);completeChoiceRequest(npc,null,move.action,{ok:true,code:'ARRIVED'},{id:301,at:4});
  assert.equal(rows[0].nominee,null);
  assert.equal(rows[0].veto,false);
  assert.equal('learnedScore' in rows[0],false);
  assert.equal('selection' in rows[0],false);
  assert.deepEqual(rows[0].winner,{action:move.action,legacyScore:100});
  assert.equal(rows[1].legacyScore,100);
  assert.equal(rows[1].decisionId,rows[0].decisionId);
});

test('diagnostic IDs and pending state belong to each actor and disabling drops active tracking',()=>{
  const a=traced(),b=traced({nomineeScore:80});
  assert.equal(a.rows[0].decisionId,1);assert.equal(b.rows[0].decisionId,1);
  beginChoiceRequest(a.npc,a.gate.selected.action);beginChoiceRequest(b.npc,b.gate.selected.action);
  const active={request:structuredClone(a.gate.selected.action)};a.npc.active=active;
  finishChoiceRequest(a.npc,{ok:true,code:'STARTED'});configureChoiceDiagnostics(a.npc,null);
  completeChoiceRequest(a.npc,active,active.request,{ok:false,code:'PRIORITY_CHANGED'},{id:401,at:14});
  completeChoiceRequest(b.npc,null,b.gate.selected.action,{ok:true,code:'SWALLOWED'},{id:402,at:12});
  assert.deepEqual(a.rows.map(row=>row.type),['choice','started']);
  assert.deepEqual(b.rows.map(row=>row.type),['choice','outcome']);
  assert.equal(b.rows[1].legacyScore,80);
  assert.equal(b.rows[1].actionId,402);
});
