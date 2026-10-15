import test from 'node:test';
import assert from 'node:assert/strict';
import {createNpc} from '../src/npc-state.js';
import {createEnvironment} from '../src/environment.js';
import {freshState} from '../src/world.js';
import {regionalHabitatAnchors} from '../src/ecology.js';
import {PopulationRuntime} from '../src/population.js';
import {NpcController,decisionObservation} from '../src/controller.js';
import {discoveryDecision} from '../src/discovery.js';
import {collapseNpc} from '../src/npc.js';
import {validateNpc} from '../src/npc-memory.js';
import {configureSelection,createSelectionMemory,chooseSelection,selectionPolicy} from '../src/discovery-selection.js';
import {consistentSelection,configureChoiceDiagnostics,choiceDiagnosticStatus} from '../src/discovery-choice.js';

let seedState;
function state(){
  if(!seedState){
    const s=freshState({mode:'legacy'});s.simulationMode='discovery';s.environment=createEnvironment(74193,{mode:'discovery'});s.cardinal=null;
    const n=createNpc({id:'aster',mode:'discovery',seed:74193}),p=regionalHabitatAnchors().find(p=>p.key==='pond:north');n.position={x:p.x,y:p.y};s.agents=[n];s.npc=n;seedState=s;
  }
  return structuredClone(seedState);
}
function runtime(s){return new PopulationRuntime(s,{cardinal:false,discoverySelection:'learned'});}
function step(s,r){s.elapsed+=1/60;r.tick(1/60);}

test('real controller trace on/off preserves full world, body, RNG and observations through movement vetoes',()=>{
  const a=state(),b=state(),ra=runtime(a),rb=runtime(b),rows=[];
  configureChoiceDiagnostics(b.npc,row=>{rows.push(structuredClone(row));if(row.winner)row.winner.action.type='ignored callback mutation';if(row.action)row.action.type='ignored callback mutation';});
  const events=new Map();
  for(let i=0;i<60*60;i++){
    step(a,ra);step(b,rb);
    for(const e of b.npc.memory.experience)if(e.type==='action')events.set(e.id,structuredClone(e));
    if(i%60===0){assert.deepEqual(a,b);assert.deepEqual(decisionObservation(a.npc),decisionObservation(b.npc));}
  }
  assert.deepEqual(a,b);assert.equal(choiceDiagnosticStatus(b.npc).error,null);
  const choices=new Map(rows.filter(e=>e.type==='choice').map(e=>[e.decisionId,e]));assert.ok([...choices.values()].some(e=>e.veto));
  assert.ok(rows.some(e=>e.type==='outcome'&&e.action.type==='move'));
  for(const e of rows.filter(e=>e.type==='outcome')){
    const choice=choices.get(e.decisionId),actual=events.get(e.actionId);assert.ok(choice);assert.ok(actual);
    assert.deepEqual(e.action,choice.winner.action);assert.deepEqual(e.action,actual.details.action);assert.equal(e.legacyScore,choice.winner.legacyScore);assert.equal(e.result.code,actual.details.result.code);
    if(choice.veto){assert.equal(e.action.type,'move');assert.ok(choice.movement.legacyScore>choice.nominee.legacyScore);}
  }
  ra.dispose();rb.dispose();
});

test('throwing choice sink cannot suppress a real controller submission or change simulation',()=>{
  const a=state(),b=state(),ra=runtime(a),rb=runtime(b);let calls=0;
  configureChoiceDiagnostics(b.npc,()=>{calls++;throw Error('Test sink failure');});
  for(let i=0;i<600;i++){step(a,ra);step(b,rb);}
  assert.equal(calls,1);assert.deepEqual(a,b);assert.equal(choiceDiagnosticStatus(b.npc).error.eventType,'choice');
  assert.equal(choiceDiagnosticStatus(b.npc).error.message,'Test sink failure');ra.dispose();rb.dispose();
});

test('throwing outcome sink cannot interrupt authoritative collapse cleanup',()=>{
  const a=state(),b=state(),ca=new NpcController(a.npc,{environment:a.environment,discoverySelection:'learned'}),cb=new NpcController(b.npc,{environment:b.environment,discoverySelection:'learned'});
  configureChoiceDiagnostics(b.npc,row=>{if(row.type==='outcome')throw Error('Collapse sink failure');});
  ca.tick(1/60);cb.tick(1/60);assert.ok(a.npc.active);assert.deepEqual(a,b);
  a.npc.health=0;b.npc.health=0;
  collapseNpc(a.npc,'test injury');assert.doesNotThrow(()=>collapseNpc(b.npc,'test injury'));
  assert.equal(b.npc.lifecycle,'COLLAPSED');assert.equal(b.npc.stats.collapses,1);assert.deepEqual(a,b);
  assert.equal(choiceDiagnosticStatus(b.npc).error.eventType,'outcome');ca.dispose();cb.dispose();
});

test('zero-record movement veto keeps nomination phase and RNG across JSON reopen and runtime reconfiguration',()=>{
  for(const phase of [0,7])for(const choices of [0,1e9]){
    const n=createNpc({mode:'discovery',seed:74193});n.discovery.selection={...createSelectionMemory(),phase,choices};configureSelection(n,'learned');
    const options=[{score:10,action:{type:'strike',targetId:'object:1'}},{score:6,action:{type:'move',target:{x:480,y:960}}},{score:1,action:{type:'inspect_object',targetId:'object:2'}}];
    const first=chooseSelection(selectionPolicy(n,{}).model,options.filter(c=>c.action.type!=='move'),{},()=>phase===7?0:.999),gate=consistentSelection(options,first);
    assert.equal(gate.veto,true);assert.deepEqual(n.discovery.selection.records,[]);
    const reopened=validateNpc(JSON.parse(JSON.stringify(n)));assert.equal(selectionPolicy(reopened,{}),null);configureSelection(reopened,'learned');
    assert.deepEqual(reopened.discovery.selection,n.discovery.selection);
    const nextA=chooseSelection(selectionPolicy(n,{}).model,options.filter(c=>c.action.type!=='move'));
    const nextB=chooseSelection(selectionPolicy(reopened,{}).model,options.filter(c=>c.action.type!=='move'));
    assert.deepEqual(nextA,nextB);assert.deepEqual(reopened.discovery.selection,n.discovery.selection);assert.equal(reopened.rng,n.rng);
  }
});


test('real post-veto work evidence and next nomination survive reopen with the online mode reapplied',()=>{
  const s=state(),r=runtime(s),rows=[];configureChoiceDiagnostics(s.npc,row=>rows.push(row));let completed=null;
  for(let i=0;i<120*60&&!completed;i++){
    step(s,r);
    completed=rows.find(e=>e.type==='outcome'&&rows.some(c=>c.type==='choice'&&c.decisionId===e.decisionId&&c.veto));
  }
  assert.ok(completed);assert.equal(s.npc.active,null);assert.ok(s.npc.discovery.selection.records.length>0);
  const n=s.npc,reopened=validateNpc(JSON.parse(JSON.stringify(n)));configureSelection(reopened,'learned');
  assert.deepEqual(reopened.discovery.selection,n.discovery.selection);
  const before=[],after=[];configureChoiceDiagnostics(n,x=>before.push(x));configureChoiceDiagnostics(reopened,x=>after.push(x));
  assert.deepEqual(discoveryDecision(reopened),discoveryDecision(n));assert.deepEqual(after,before);
  assert.deepEqual(reopened.discovery.selection,n.discovery.selection);assert.equal(reopened.rng,n.rng);r.dispose();
});
