import test from 'node:test';import assert from 'node:assert/strict';
import {createOzarkWorldGeometry} from '../src/ozark-world-geometry.js';
import {createOzarkState,writeOzarkSave,loadOzarkSave,getOzarkSaveValidationFailure} from '../src/ozark-save.js';
import {bindOzarkWorldAgent} from '../src/ozark-agent-world.js';
import {observeNpc,requestNpcAction,tickNpc,cancelNpcAction} from '../src/npc.js';
import {processDiscoveryFeedback,discoveryDecision,freshMethodAppearance} from '../src/discovery.js';
import {bodySignals} from '../src/interoception.js';import {projectPhysiology} from '../src/biology.js';
import {motorRecallStatus,motorRecallExperiment,receiveMotorRecallWitness,MOTOR_RECALL_REASON} from '../src/motor-recall.js';
import {NpcController} from '../src/controller.js';
const geometry=createOzarkWorldGeometry();
function fixture({train=true,read=false}={}){
 const state=createOzarkState(geometry),n=state.agents[0],e=state.environment;state.agents.forEach(a=>bindOzarkWorldAgent(a,geometry,state));
 const source=e.ecology.plants.find(p=>p.kind==='grass');source.position={x:400,y:720};n.position={...source.position};
 const comfortable=()=>{Object.assign(n.physiology,{availableEnergyKcal:1300,satietyHours:3,waterDeficitMl:0,stamina:90,fatigue:10,sleepPressure:10});projectPhysiology(n);observeNpc(n,e);};comfortable();
 const advance=seconds=>{for(let t=0;t<seconds-1e-8;t+=.25){if(read)motorRecallStatus(n);state.elapsed+=Math.min(.25,seconds-t);e.elapsed=e.ecology.elapsed=state.elapsed;for(const actor of state.agents)tickNpc(actor,Math.min(.25,seconds-t),e);processDiscoveryFeedback(n,{foodLearning:false});}};
 const finish=request=>{const admitted=requestNpcAction(n,request,e);for(let i=0;i<200&&n.active;i++)advance(.25);assert.equal(n.active,null);return admitted.ok?n.lastResult:admitted;};
 const choose=(overrides={})=>motorRecallExperiment(n,{body:bodySignals(n),local:id=>!!freshMethodAppearance(n,id)&&Math.hypot(n.position.x-n.discovery.observations[id].position.x,n.position.y-n.discovery.observations[id].position.y)<=80,blocked:()=>false,...overrides});
 if(train){assert.equal(finish({type:'pull',targetId:source.id}).code,'piece_detached');assert.equal(finish({type:'release',targetId:n.inventory.items.at(-1)}).code,'object_released');assert.equal(finish({type:'grasp',targetId:source.id}).code,'object_still_attached');comfortable();}
 return {state,n,e,source,finish,advance,choose,comfortable};
}
test('actual paid grass consequence recalled without ingestion, effects or food technique',()=>{
 const f=fixture();assert.equal(motorRecallStatus(f.n).questions[0].phase,'ready');assert.equal(f.n.discovery.effects.length,0);assert.equal(f.n.physiology.totals.ingestedKcal,0);assert.equal(f.n.discovery.techniques.length,0);
 const before={stock:f.source.biomassGrams,time:f.n.elapsed,energy:f.n.physiology.totals.metabolizedKcal};
 const request=f.choose();assert.deepEqual(request,{type:'pull',targetId:f.source.id});assert.equal(f.choose(),null);assert.equal(f.finish(request).code,'piece_detached');
 assert.equal(motorRecallStatus(f.n).questions[0].phase,'detached');assert.ok(f.source.biomassGrams<before.stock);assert.ok(f.n.elapsed>before.time);assert.ok(f.n.physiology.totals.metabolizedKcal>before.energy);assert.equal(f.n.inventory.items.length,1);assert.equal(f.n.discovery.techniques.length,0);assert.equal(f.n.discovery.effects.length,0);assert.equal(f.n.physiology.totals.ingestedKcal,0);assert.equal(f.choose(),null);
});
test('ordinary controller preserves one-use request with food learning disabled',()=>{
 const f=fixture(),c=new NpcController(f.n,{environment:f.e}),decision=discoveryDecision(f.n,{foodLearning:false});assert.equal(decision.reason,MOTOR_RECALL_REASON);assert.equal(c.perform(decision.action).code,'ACTION_STARTED');while(f.n.active)f.advance(.25);assert.equal(motorRecallStatus(f.n).questions[0].phase,'detached');c.dispose();
});
test('fabricated tokens and cloned records cannot supply private proof',()=>{
 const f=fixture({train:false});receiveMotorRecallWitness(f.n,{});assert.equal(motorRecallStatus(f.n),null);
 const g=fixture();Object.assign(f.n,{discovery:structuredClone(g.n.discovery),memory:structuredClone(g.n.memory)});assert.equal(f.choose(),null);
});
test('interrupting selection or paid action consumes opportunity',()=>{
 for(const dispatch of [false,true]){const f=fixture(),request=f.choose();if(dispatch){assert.equal(requestNpcAction(f.n,request,f.e).code,'ACTION_STARTED');f.advance(.25);cancelNpcAction(f.n,'test interruption');}assert.equal(f.choose(),null);assert.notEqual(motorRecallStatus(f.n).questions[0].phase,'ready');}
});
test('cloned and mutated selected requests do not count as recalled execution',()=>{
 const f=fixture(),request=f.choose();assert.equal(f.finish({...request}).code,'piece_detached');assert.equal(motorRecallStatus(f.n).questions[0].phase,'retired');assert.equal(f.choose(),null);
 const g=fixture(),r=g.choose();r.type='grasp';assert.equal(g.finish(r).code,'MOTOR_RECALL_STALE');assert.equal(g.n.active,null);
});
test('identity replacement before dispatch and during paid work rejects recall',()=>{
 for(const started of [false,true]){const f=fixture(),r=f.choose();if(started){assert.equal(requestNpcAction(f.n,r,f.e).code,'ACTION_STARTED');f.advance(.25);}
 const index=f.e.ecology.plants.indexOf(f.source),replacement={...f.source};f.e.ecology.plants=f.e.ecology.plants.map((p,i)=>i===index?replacement:p);
 if(started){f.advance(.25);assert.equal(f.n.lastResult.code,'MOTOR_RECALL_STALE');}else assert.equal(f.finish(r).code,'MOTOR_RECALL_STALE');
 assert.equal(replacement.biomassGrams,f.source.biomassGrams);assert.equal(f.choose(),null);
 }
});
test('later contradictory pull cancels ready method; depleted source remains dispatcher outcome',()=>{
 const f=fixture();f.source.biomassGrams=0;assert.equal(f.finish({type:'pull',targetId:f.source.id}).code,'nothing_detached');assert.equal(f.choose(),null);
 const g=fixture();g.source.biomassGrams=0;const r=g.choose();assert.ok(r,'No hidden stock oracle in recall selection');assert.equal(g.finish(r).code,'nothing_detached');assert.equal(g.choose(),null);
});
test('care and local observation gates defer without fabricated success',()=>{
 const f=fixture();assert.equal(f.choose({body:{...bodySignals(f.n),thirst:'desperate thirst'}}),null);assert.equal(f.choose({local:()=>false}),null);assert.equal(f.choose({blocked:()=>true}),null);assert.equal(motorRecallStatus(f.n).questions[0].phase,'ready');assert.ok(f.choose());
});
test('scope replacement invalidates pending selection',()=>{
 for(const key of ['memory','discovery','physiology']){const f=fixture();f.n[key]=structuredClone(f.n[key]);assert.equal(f.choose(),null);assert.equal(motorRecallStatus(f.n),null);}
 const f=fixture();f.n.epoch++;assert.equal(f.choose(),null);
});
test('observer reads are detached and cannot consume or expire permission',()=>{
 const f=fixture(),before=structuredClone(f.n),status=motorRecallStatus(f.n);for(let i=0;i<20;i++)assert.deepEqual(motorRecallStatus(f.n),status);assert.deepEqual(f.n,before);assert.ok(Object.isFrozen(status.questions[0]));assert.throws(()=>status.questions[0].phase='fake');assert.ok(f.choose());
});

// Changes below remain controlled authored-action tests, not an ordinary cohort.
test('urgent care between selection and dispatch or during work revokes recall',()=>{
 for(const started of [false,true]){const f=fixture(),r=f.choose();if(started){assert.equal(requestNpcAction(f.n,r,f.e).code,'ACTION_STARTED');f.advance(.25);}
  f.n.physiology.waterDeficitMl=5000;projectPhysiology(f.n);
  if(started){f.advance(.25);assert.equal(f.n.active,null);assert.equal(f.n.lastResult.code,'MOTOR_RECALL_STALE');}else assert.equal(f.finish(r).code,'MOTOR_RECALL_STALE');
  f.comfortable();assert.equal(f.choose(),null);
 }
});
test('partial grasp and interrupted pull cannot establish a private motor contrast',()=>{
 const f=fixture({train:false});requestNpcAction(f.n,{type:'pull',targetId:f.source.id},f.e);f.advance(.25);cancelNpcAction(f.n);f.finish({type:'grasp',targetId:f.source.id});assert.equal(f.choose(),null);
 const g=fixture({train:false});g.finish({type:'pull',targetId:g.source.id});g.finish({type:'release',targetId:g.n.inventory.items.at(-1)});requestNpcAction(g.n,{type:'grasp',targetId:g.source.id},g.e);g.advance(.25);cancelNpcAction(g.n);assert.equal(g.choose(),null);
});
test('busy/full hands/access rejection do not invent a completed grasp failure',()=>{
 const f=fixture({train:false});f.finish({type:'pull',targetId:f.source.id});
 const old=f.n.position;f.n.position={x:1000,y:1000};assert.equal(f.finish({type:'grasp',targetId:f.source.id}).ok,false);f.n.position=old;assert.equal(f.choose(),null);
 f.n.inventory.items=['object:111','object:112','object:113','object:114'];assert.equal(requestNpcAction(f.n,{type:'grasp',targetId:f.source.id},f.e).code,'HANDS_FULL');assert.equal(f.choose(),null);
});
test('scope change during actual work cannot certify recalled detachment',()=>{
 for(const key of ['memory','discovery','physiology','epoch']){const f=fixture(),r=f.choose();requestNpcAction(f.n,r,f.e);f.advance(.25);f.n[key]=key==='epoch'?f.n[key]+1:structuredClone(f.n[key]);f.advance(.25);assert.equal(f.n.active,null);assert.equal(motorRecallStatus(f.n),null);}
});
test('observer on/off produces identical ordinary paid outcomes and RNG',()=>{
 const a=fixture(),b=fixture({read:true});a.finish(a.choose());b.finish(b.choose());assert.deepEqual(a.n,b.n);assert.deepEqual(motorRecallStatus(a.n),motorRecallStatus(b.n));
});
test('save and reload retain public evidence but never reconstruct recall authority',()=>{
 const f=fixture();let raw=null;const disk={getItem:()=>raw,setItem:(_key,value)=>{raw=value;}};
 assert.equal(writeOzarkSave(disk,f.state,geometry),true,JSON.stringify(getOzarkSaveValidationFailure(f.state)));const opened=loadOzarkSave(disk,geometry);assert.equal(opened.blocked,false);
 const n=opened.state.agents[0];assert.ok(n.discovery.experiments.length>0);assert.equal(motorRecallStatus(n),null);
 assert.equal(motorRecallExperiment(n,{body:bodySignals(n),local:()=>true,blocked:()=>false}),null);
});
test('detail/method eviction does not renew exact-source admission',()=>{
 const f=fixture(),original=f.source;f.finish(f.choose());f.finish({type:'release',targetId:f.n.inventory.items.at(-1)});
 const sources=f.e.ecology.plants.filter(p=>p.kind==='grass'&&p!==original).slice(0,16);assert.equal(sources.length,16);
 for(const source of sources){source.position={x:400,y:720};f.e.ecology.plants=[...f.e.ecology.plants];f.comfortable();assert.equal(f.finish({type:'pull',targetId:source.id}).code,'piece_detached');assert.equal(f.finish({type:'release',targetId:f.n.inventory.items.at(-1)}).code,'object_released');assert.equal(f.finish({type:'grasp',targetId:source.id}).code,'object_still_attached');}
 let status=motorRecallStatus(f.n);assert.equal(status.admissions,17);assert.equal(status.questions.length,16);assert.ok(status.questions.every(q=>q.sourceId!==original.id));
 f.comfortable();f.finish({type:'pull',targetId:original.id});f.finish({type:'release',targetId:f.n.inventory.items.at(-1)});f.finish({type:'grasp',targetId:original.id});
 status=motorRecallStatus(f.n);assert.equal(status.admissions,17);assert.ok(status.questions.every(q=>q.sourceId!==original.id));
});

test('environment wrapper replacement rejects exact-source recall even with shared ecology',()=>{
 for(const active of [false,true]){const f=fixture(),r=f.choose(),other={...f.e};
  if(active){requestNpcAction(f.n,r,f.e);f.advance(.25);tickNpc(f.n,.25,other);assert.equal(f.n.active,null);assert.equal(f.n.lastResult.code,'MOTOR_RECALL_STALE');}
  else assert.equal(requestNpcAction(f.n,r,other).code,'MOTOR_RECALL_STALE');
  assert.equal(f.choose(),null);
 }
});

test('epoch retirement clears private proof but never refunds the live actor admission budget',()=>{
 const f=fixture();f.choose();f.n.epoch++;assert.equal(f.choose(),null);f.comfortable();
 f.finish({type:'pull',targetId:f.source.id});f.finish({type:'release',targetId:f.n.inventory.items.at(-1)});f.finish({type:'grasp',targetId:f.source.id});
 assert.equal(motorRecallStatus(f.n).admissions,1);assert.equal(motorRecallStatus(f.n).questions.length,0);assert.equal(f.choose(),null);
});
