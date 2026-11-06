import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { createOzarkState, writeOzarkSave, loadOzarkSave, OZARK_SAVE_KEY } from '../src/ozark-save.js';
import { bindOzarkWorldAgent } from '../src/ozark-agent-world.js';
import { observeNpc, requestNpcAction, tickNpc, cancelNpcAction } from '../src/npc.js';
import { NpcController } from '../src/controller.js';
import { discoveryDecision, freshMethodAppearance } from '../src/discovery.js';
import { handlingInquiries, recordHandlingOutcome, validHandlingInquiries, retireHandlingInquiries } from '../src/handling-inquiry.js';
import { retainedProofIntegrityError } from '../src/proof-retention.js';
const geometry=createOzarkWorldGeometry();
// Bounded authored encounter, not autonomous acquisition or a survival study.
// Placement and initial clocks are supplied. Geometry, physical actions,
// effort, source stock, personal receipts, and perception are unmodified.
function pair(state){
  const plants=state.environment.ecology.plants.filter(p=>p.kind==='apple_tree'&&p.quantity>2);
  for(const source of plants)for(const target of plants){
    const gap=Math.hypot(source.position.x-target.position.x,source.position.y-target.position.y);
    const a={x:source.position.x+45,y:source.position.y},b={x:target.position.x+45,y:target.position.y};
    if(gap>120&&gap<260&&[a,b].every(p=>geometry.canOccupy(p.x,p.y,CONFIG.playerRadius))&&
      geometry.lineOfSight(b,source.position)&&geometry.lineOfSight(b,target.position)&&
      geometry.lineOfSight(a,source.position)&&geometry.lineOfSight(a,target.position))return {source,target};
  }assert.fail('No fixed two-source encounter');
}
function fixture({order='reverse',beforePull=()=>{},prepare=true}={}){
  const state=createOzarkState(geometry,{communicationSeed:211}),env=state.environment,actor=state.agents[0],{source,target}=pair(state);
  state.elapsed=env.elapsed=env.ecology.elapsed=60;
  for(const n of state.agents){n.elapsed=60;bindOzarkWorldAgent(n,geometry,state);}
  const advance=()=>{state.elapsed=env.elapsed=env.ecology.elapsed=env.elapsed+.1;for(const n of state.agents)tickNpc(n,.1,env);};
  const settle=()=>{for(let i=0;actor.active&&i<120;i++)advance();assert.equal(actor.active,null);return actor.lastResult;};
  const finish=action=>{assert.equal(requestNpcAction(actor,action,env).code,'ACTION_STARTED');return settle();};
  const at=p=>{actor.position={x:p.position.x+45,y:p.position.y};observeNpc(actor,env);};
  const f={state,env,actor,source,target,advance,settle,finish,at};
  const grasp=()=>{at(target);assert.equal(finish({type:'grasp',targetId:target.id}).code,'object_still_attached');};
  const pull=()=>{at(source);beforePull(f);const r=finish({type:'pull',targetId:source.id});assert.equal(r.code,'piece_detached');assert.equal(finish({type:'release',targetId:r.materialId}).code,'object_released');};
  if(prepare){if(order==='forward'){pull();grasp();}else{grasp();pull();}at(target);}
  return {...f,grasp,pull};
}
const storage=()=>{const map=new Map();return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};};

test('either evidence order supports one ordinary-controller paid target trial, without food inference',()=>{
  const rows=[];
  for(const order of ['forward','reverse']){
    const f=fixture({order}),n=f.actor,q=n.discovery.handlingQuestions[0];
    assert.ok(q);assert.equal(q.sourceId,f.target.id);assert.equal(q.priorSourceId,f.source.id);
    const failed=n.discovery.experiments.find(e=>e.id===q.failedId),pulled=n.discovery.experiments.find(e=>e.id===q.priorId);
    assert.equal(q.at,Math.max(failed.at,pulled.at));assert.equal(validHandlingInquiries(n.discovery,n),true);
    rows.push({at:n.elapsed,cost:n.physiology.totals.metabolizedKcal,source:f.source.id,target:f.target.id});
    for(let i=0;i<8;i++)f.advance();observeNpc(n,f.env);
    const before={at:n.elapsed,cost:n.physiology.totals.metabolizedKcal,stock:f.target.quantity,held:n.inventory.items.length};
    const controller=new NpcController(n,{environment:f.env});
    try{controller.tick(.1);assert.deepEqual(n.active?.request,{type:'pull',targetId:f.target.id});f.settle();}
    finally{controller.dispose();}
    assert.equal(n.lastResult.code,'piece_detached');assert.ok(n.elapsed>before.at+4);
    assert.ok(n.physiology.totals.metabolizedKcal>before.cost);assert.equal(f.target.quantity,before.stock-1);assert.equal(n.inventory.items.length,before.held+1);
    assert.equal(handlingInquiries(n)[0].status,'detached');assert.equal(n.discovery.handlingAdmissions.length,1);
    assert.ok(!n.discovery.experiments.some(e=>e.primitive==='sample'));assert.deepEqual(n.discovery.effects,[]);assert.deepEqual(n.discovery.techniques,[]);
    assert.equal(retainedProofIntegrityError(n),null);
  }
  assert.deepEqual({...rows[0],cost:0},{...rows[1],cost:0},'same encounter and paid duration, only experience order differs');
  assert.ok(Math.abs(rows[0].cost-rows[1].cost)<1e-9,'equal metabolic cost up to floating-point summation');
});

test('new pull cannot borrow missing personal proof, stale sight, mismatched appearance, or another actor',()=>{
  for(const scenario of ['missing','missing-handling','foreign','stale','different']){
    const f=fixture({beforePull:f=>{
      const n=f.actor,failed=n.discovery.experiments.find(e=>e.primitive==='grasp'),receipt=n.memory.experience.find(r=>r.id===failed.actionId);
      if(scenario==='missing')n.memory.experience=n.memory.experience.filter(r=>r!==receipt);
      if(scenario==='missing-handling')delete receipt.details.result.handling;
      if(scenario==='foreign'){n.discovery.experiments=[];n.discovery.trials={};}
      if(scenario==='stale')for(let i=0;i<90;i++)f.advance();
      if(scenario==='different')n.discovery.observations[f.target.id].appearance.color='different';
    }});
    assert.deepEqual(f.actor.discovery.handlingQuestions,[],scenario);
    assert.deepEqual(f.state.agents[1].discovery.handlingQuestions,[]);
  }
});

test('a prior target pull or superseding target handling outcome blocks reverse admission',()=>{
  const f=fixture({prepare:false});f.grasp();f.at(f.target);
  const own=f.finish({type:'pull',targetId:f.target.id});assert.equal(own.code,'piece_detached');
  f.finish({type:'release',targetId:own.materialId});f.pull();
  assert.deepEqual(f.actor.discovery.handlingQuestions,[],'pull on target was already attempted');
  // Corruption/aggregate controls exercise rejection, not successful-learning claims.
  for(const primitive of ['grasp','catch'])for(const delay of [0,.01]){
    const f=fixture({beforePull:f=>{
      const n=f.actor,failed=n.discovery.experiments.find(e=>e.primitive==='grasp');
      n.discovery.trials[`${f.target.id}|${primitive}`]={attempts:1,successes:1,failures:0,seconds:2,lastAt:failed.at+delay,lastCode:'object_held',lastOk:true};
    }});
    assert.deepEqual(f.actor.discovery.handlingQuestions,[],primitive);
  }
});

test('reverse-order pending/completed/interrupted inquiry saves retain chronology and one-shot authority',()=>{
  for(const stage of ['pending','completed','interrupted']){
    const f=fixture(),n=f.actor,disk=storage();
    if(stage!=='pending'){
      const choice=discoveryDecision(n);assert.equal(choice.action.type,'pull');
      if(stage==='completed')f.finish(choice.action);
      else{assert.equal(requestNpcAction(n,choice.action,f.env).code,'ACTION_STARTED');f.advance();cancelNpcAction(n,'PRIORITY_CHANGED');}
    }
    assert.equal(writeOzarkSave(disk,f.state,geometry),true,f.state.saveError);
    const saved=disk.getItem(OZARK_SAVE_KEY),loaded=loadOzarkSave(disk,geometry);
    assert.equal(loaded.blocked,false,loaded.error);assert.equal(validHandlingInquiries(loaded.state.agents[0].discovery,loaded.state.agents[0]),true);
    assert.equal(handlingInquiries(loaded.state.agents[0])[0].status,stage==='pending'?'uncertain':stage==='completed'?'detached':'unavailable');
    const raw=JSON.parse(saved),q=raw.agents[0].discovery.handlingQuestions[0];
    q.at=raw.agents[0].discovery.experiments.find(e=>e.id===q.failedId).at;
    const corrupt=JSON.stringify(raw);disk.setItem(OZARK_SAVE_KEY,corrupt);
    assert.equal(loadOzarkSave(disk,geometry).blocked,true);assert.equal(disk.getItem(OZARK_SAVE_KEY),corrupt);
  }
});

test('proof retirement does not renew admission, and urgent recovery stays prior',()=>{
  const f=fixture(),n=f.actor,q=n.discovery.handlingQuestions[0];
  n.physiology.stamina=8;n.physiology.fatigue=80;
  assert.equal(discoveryDecision(n).need,'rest');assert.equal(q.state,'pending');
  const prior=n.discovery.experiments.find(e=>e.id===q.priorId);
  n.discovery.experiments=n.discovery.experiments.filter(e=>e.id!==q.failedId);
  retireHandlingInquiries(n);assert.equal(q.state,'retired');
  recordHandlingOutcome(n,prior,{appearance:id=>freshMethodAppearance(n,id)});
  assert.equal(n.discovery.handlingQuestions.length,1);assert.deepEqual(n.discovery.handlingAdmissions,[f.target.id]);
  assert.equal(validHandlingInquiries(n.discovery,n),true);
});


test('reverse saved proof rejects aggregate-only pre-admission supersession but preserves later handling',()=>{
  const f=fixture(),n=f.actor,q=n.discovery.handlingQuestions[0],disk=storage();
  assert.equal(writeOzarkSave(disk,f.state,geometry),true);
  const saved=disk.getItem(OZARK_SAVE_KEY),failed=n.discovery.experiments.find(e=>e.id===q.failedId);
  for(const primitive of ['grasp','catch']){
    const raw=JSON.parse(saved),actor=raw.agents[0],d=actor.discovery;
    d.trials[`${f.target.id}|${primitive}`]={attempts:2,successes:1,failures:1,seconds:2.5,lastAt:failed.at+.1,lastCode:'object_held',lastOk:true};
    assert.equal(validHandlingInquiries(d,actor),false,'summary inside causal interval invalidates historical proof');
    const broken=JSON.stringify(raw);disk.setItem(OZARK_SAVE_KEY,broken);
    assert.equal(loadOzarkSave(disk,geometry).blocked,true);assert.equal(disk.getItem(OZARK_SAVE_KEY),broken);
    d.trials[`${f.target.id}|${primitive}`].lastAt=q.at;
    assert.equal(validHandlingInquiries(d,actor),true,'same-time later command cannot retrospectively invalidate admission');
  }
  // An actual later target handling action is ordinary history, not a rewrite
  // of what was known when this pending question was admitted.
  assert.equal(f.finish({type:'grasp',targetId:f.target.id}).code,'object_still_attached');
  assert.equal(validHandlingInquiries(n.discovery,n),true);
  disk.setItem(OZARK_SAVE_KEY,saved);
  assert.equal(writeOzarkSave(disk,f.state,geometry),true);
  assert.equal(loadOzarkSave(disk,geometry).blocked,false);
});
