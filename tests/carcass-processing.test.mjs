import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnvironment } from '../src/environment.js';
import { validateNpc } from '../src/npc-memory.js';
import { createNpc } from '../src/npc-state.js';
import { observeNpc, requestNpcAction, tickNpc, cancelNpcAction } from '../src/npc.js';
import { interactEcologyObject, lookupEcologyObject, ecologyEnergy, consumeEcologyMaterial, tickEcology } from '../src/ecology.js';
import { ECOLOGY_RULES as R } from '../src/ecology-config.js';
import { canStand } from '../src/world.js';
import { lineOfSight } from '../src/perception.js';
import { requestDiscoveryAction, tickDiscoveryAction } from '../src/discovery-actions.js';
import { processDiscoveryFeedback } from '../src/discovery.js';
import { validateDiscoveryMemory } from '../src/discovery-state.js';
import { matchingResultObject, validResultObjectRow } from '../src/discovery-result-object.js';
import { retainedProofIntegrityError, planProofRetention, applyProofRetention } from '../src/proof-retention.js';
import { validateLedgers } from '../src/procedure-receipts.js';
import { createProcedureExperience } from '../src/procedure-experience.js';
const near=(a,b,t=1e-7)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`), clone=structuredClone;
// Isolated structural fixtures: no animal movement/ecology ticking. Timed action
// costs and physiology are real, but these are explicitly NOT hunting evidence.
function fixture({carcass=true}={}) {
  const env=createEnvironment(74193,{mode:'discovery'}),e=env.ecology,
    animal=e.animals.find(a=>a.species==='rabbit'),n=createNpc({mode:'discovery',seed:74193});
  n.position=[0,20,-20,40,-40].flatMap(x=>[0,20,-20].map(y=>({x:animal.position.x+x,y:animal.position.y+y})))
    .find(p=>canStand(p.x,p.y,'valley')&&lineOfSight(p,animal.position));assert.ok(n.position);
  e.plants=[];e.animals=[animal];e.materials=[];e.ledger.initialKcal=ecologyEnergy(e);
  let source=animal;
  if(carcass){for(let i=0;i<15;i++)interactEcologyObject(e,animal.id,'strike',{actorId:n.id,position:n.position,power:1});source=e.materials[0];}
  observeNpc(n,env);return{env,e,n,animal,source};
}
const physical=(f,verb='pull',extra={})=>interactEcologyObject(f.e,f.source.id,verb,{actorId:f.n.id,position:f.n.position,...extra});
function finish(f,type='pull',targetId=f.source.id){const start=requestNpcAction(f.n,{type,targetId},f.env);assert.equal(start.code,'ACTION_STARTED');for(let i=0;f.n.active&&i<200;i++)tickNpc(f.n,.1,f.env);assert.equal(f.n.active,null);return f.n.lastResult;}
function audit(e){near(e.ledger.initialKcal+e.ledger.photosynthesisKcal+e.ledger.externalKcal,ecologyEnergy(e)+e.ledger.humanRemovedKcal+e.ledger.metabolizedKcal+e.ledger.decomposedKcal+e.ledger.discardedKcal);}
function fill(f){while(f.e.materials.length<R.maxMaterials)f.e.materials.push({...clone(f.source),id:`object:${f.e.nextId++}`,kind:'material',heldBy:null});}
test('full material capacity refusal is entire-ecology atomic, repeated, even for a final source',()=>{
 for(const mass of [100,150]){const f=fixture();f.source.massGrams=mass;fill(f);const before=clone(f.e);
  for(let i=0;i<3;i++){assert.equal(physical(f).code,'object_limit');assert.deepEqual(f.e,before);}
  f.e.materials.pop();const old=f.source.massGrams;assert.equal(physical(f).ok,true);assert.equal(f.source.massGrams,Math.max(0,old-100));
 }
});
test('invalid allocator, stock, owner, scene, destination and reach do not mutate physical operation',()=>{
 const changes=[f=>f.e.nextId=0,f=>f.e.nextId=1e9,f=>f.e.nextId=NaN,f=>f.e.nextId=1.5,f=>f.e.nextId=Number(f.source.id.split(':')[1]),
  f=>f.source.massGrams=NaN,f=>f.source.massGrams=.5,f=>f.source.energyKcal=-1,f=>f.source.waterMl=Infinity,
  f=>f.source.heldBy='mira',f=>f.source.scene='amber',f=>f.n.position={x:f.n.position.x+1000,y:f.n.position.y},
  f=>{f.source.position={x:Infinity,y:0};f.n.position={x:0,y:0};}];
 for(const change of changes){const f=fixture();change(f);const before=clone(f.e);assert.equal(physical(f).ok,false);assert.deepEqual(f.e,before);}
});
test('partial and final pulls partition finite stock, inherited spoilage, age and terminal detritus overflow',()=>{
 for(const mass of [100,100.5,200,250])for(const capped of [false,true]){const f=fixture();Object.assign(f.source,{massGrams:mass,energyKcal:mass*1.7,waterMl:mass*.7,ageHours:13,spoiled:true});if(capped)f.e.detritus.massGrams=R.maxDetritus;f.e.ledger.initialKcal=ecologyEnergy(f.e);
  const before=clone(f.source);while(lookupEcologyObject(f.e,f.source.id)){const result=physical(f);assert.equal(result.ok,true);const piece=lookupEcologyObject(f.e,result.materialId);assert.equal(piece.heldBy,'aster');assert.equal(piece.ageHours,13);assert.equal(piece.spoiled,true);near(piece.energyKcal/piece.massGrams,1.7);near(piece.waterMl/piece.massGrams,.7);audit(f.e);}
  const pieces=f.e.materials.reduce((n,m)=>n+m.massGrams,0);near(pieces,Math.floor(before.massGrams/100)*100+(before.massGrams%100>=1?before.massGrams%100:0));
 }
});
test('late full hands, lost reach and vanished target refuse after actual paid handling',()=>{
 for(const change of ['hands','reach','gone']){const f=fixture();assert.equal(requestNpcAction(f.n,{type:'pull',targetId:f.source.id},f.env).code,'ACTION_STARTED');tickNpc(f.n,.2,f.env);
  if(change==='hands')f.n.inventory.items=['object:900001','object:900002','object:900003','object:900004'];
  if(change==='reach')f.n.position.x+=1000;if(change==='gone')f.e.materials=[];
  const before=clone(f.e),cost=f.n.physiology.totals.metabolizedKcal;while(f.n.active)tickNpc(f.n,.1,f.env);
  assert.equal(f.n.lastResult.ok,false);assert.equal(f.n.lastResult.code,{hands:'HANDS_FULL',reach:'OUT_OF_REACH',gone:'OBJECT_GONE'}[change]);assert.ok(f.n.lastResult.handling.activeActionSeconds>0);assert.ok(f.n.physiology.totals.metabolizedKcal>cost);assert.deepEqual(f.e,before);
 }
});
test('cancel, throwing/reentrant callbacks and repeated ticks cannot replay transfer or successor observation',()=>{
 const f=fixture(),before=clone(f.e);requestNpcAction(f.n,{type:'pull',targetId:f.source.id},f.env);tickNpc(f.n,.2,f.env);cancelNpcAction(f.n);assert.deepEqual(f.e,before);
 for(const kind of ['throw-exert','cancel-exert','throw-complete']){const q=fixture();requestDiscoveryAction(q.n,{type:'pull',targetId:q.source.id},q.env);const active=q.n.active,old=clone(q.e);
  const opts=kind==='throw-exert'?{exert(){throw Error('hook');}}:kind==='cancel-exert'?{exert(){q.n.active=null;}}:{complete(){assert.equal(tickDiscoveryAction(q.n,10,q.env),false);throw Error('hook');}};
  if(kind==='cancel-exert')tickDiscoveryAction(q.n,10,q.env,opts);else assert.throws(()=>tickDiscoveryAction(q.n,10,q.env,opts),/hook/);
  if(kind!=='throw-complete')assert.deepEqual(q.e,old);const after=clone(q.e);q.n.active=active;tickDiscoveryAction(q.n,10,q.env);assert.deepEqual(q.e,after);
 }
});
test('full-health power-one structure needs fifteen contacts and successor is exact, public and unheld',()=>{
 const f=fixture({carcass:false});for(let i=1;i<=15;i++){const r=physical(f,'strike');assert.equal(r.code,i===15?'object_stopped_moving':'object_recoiled');assert.equal(Object.hasOwn(r,'resultObjectId'),i===15);if(i===15)assert.equal(r.resultObjectId,f.e.materials[0].id);}
 assert.equal(physical(f,'strike').code,'object_missing');assert.equal(f.e.materials[0].heldBy,null);audit(f.e);
 const q=fixture({carcass:false});q.animal.health=q.animal.physiology.health=7;const r=finish(q,'strike');assert.equal(r.resultObjectId,q.e.materials[0].id);assert.equal(r.materialId,undefined);assert.deepEqual(q.n.inventory.items,[]);
 const sensory=q.n.discovery.observations[r.resultObjectId];assert.ok(sensory);for(const key of ['species','energyKcal','massGrams','waterMl','materialType'])assert.equal(sensory[key],undefined);
 assert.equal(q.n.discovery.experiments.at(-1).resultObjectId,r.resultObjectId);assert.equal(q.n.discovery.techniques.length,0);assert.equal(q.n.discovery.foodDiscoveries,0);assert.equal(q.n.stats.independentMeals,0);assert.equal(retainedProofIntegrityError(q.n),null);
 const mira=createNpc({id:'mira',mode:'discovery'});mira.position={...q.n.position};observeNpc(mira,q.env);assert.ok(mira.discovery.observations[r.resultObjectId]);assert.deepEqual(mira.discovery.experiments,[]);
 assert.equal(finish(q,'grasp',r.resultObjectId).code,'object_too_heavy');assert.equal(requestNpcAction(q.n,{type:'sample',targetId:r.resultObjectId},q.env).code,'NOT_HELD');
});
test('capped terminal death still occurs without a phantom successor or held material',()=>{
 const f=fixture({carcass:false});const template={id:'object:1',kind:'material',materialType:'flesh',scene:'valley',position:{...f.animal.position},massGrams:1,energyKcal:1,waterMl:1};while(f.e.materials.length<R.maxMaterials)f.e.materials.push({...template,id:`object:${f.e.nextId++}`});f.e.ledger.initialKcal=ecologyEnergy(f.e);f.animal.health=f.animal.physiology.health=7;
 const r=finish(f,'strike');assert.equal(r.code,'object_stopped_moving');assert.equal(Object.hasOwn(r,'resultObjectId'),false);assert.equal(f.e.animals.length,0);assert.equal(f.e.materials.length,R.maxMaterials);assert.deepEqual(f.n.inventory.items,[]);audit(f.e);
});
test('real exact-carcass pull and sample learn only that processing chain after delayed effect',()=>{
 const f=fixture({carcass:false});f.animal.health=f.animal.physiology.health=7;const killed=finish(f,'strike');const pulled=finish(f,'pull',killed.resultObjectId);finish(f,'sample',pulled.materialId);
 assert.equal(f.n.discovery.techniques.length,0);for(let i=0;i<1200;i++)tickNpc(f.n,.1,f.env);processDiscoveryFeedback(f.n);
 assert.equal(f.n.discovery.techniques.length,1);const t=f.n.discovery.techniques[0];assert.equal(t.sourceId,killed.resultObjectId);assert.deepEqual(t.steps.map(s=>s.type),['pull','sample']);assert.ok(!t.evidence.includes(f.n.discovery.experiments.find(e=>e.primitive==='strike').id));
 assert.equal(createProcedureExperience(f.n).episodes[0].acquisition.targetId,killed.resultObjectId);
 const stock=clone(f.e);assert.throws(()=>consumeEcologyMaterial(f.e,pulled.materialId,1,{actorId:'aster',accept(){throw Error('gut');}}),/gut/);assert.deepEqual(f.e,stock);
 assert.equal(consumeEcologyMaterial(f.e,pulled.materialId,1,{actorId:'aster',accept:()=>({ok:false,code:'TOO_FULL'})}).ok,false);assert.deepEqual(f.e,stock);
});
test('raw optional relation rejects malformed, one-sided, wrong action and acquisition identities, absent remains valid',()=>{
 const f=fixture({carcass:false});f.animal.health=f.animal.physiology.health=7;finish(f,'strike');const e=f.n.discovery.experiments.at(-1),r=f.n.memory.experience.find(r=>r.id===e.actionId);assert.equal(matchingResultObject(e,r),true);
 const mutations=[(e,r)=>e.resultObjectId=null,(e,r)=>r.details.result.resultObjectId='',(e,r)=>e.resultObjectId=0,(e,r)=>e.resultObjectId='object:0',(e,r)=>e.resultObjectId='object:01',(e,r)=>e.resultObjectId='object:1000000000',(e,r)=>e.resultObjectId=e.targetId,(e,r)=>delete e.resultObjectId,(e,r)=>delete r.details.result.resultObjectId,(e,r)=>e.resultObjectId='object:999999',(e,r)=>{e.primitive=r.details.action.type='pull';},(e,r)=>{e.ok=r.details.result.ok=false;},(e,r)=>{e.materialId=r.details.result.materialId=null;},(e,r)=>{e.ingestionId=r.details.result.ingestionId='';},(e,r)=>r.id++, (e,r)=>e.at++];
 for(const mutate of mutations){const n=clone(f.n),x=n.discovery.experiments.at(-1),y=n.memory.experience.find(r=>r.id===x.actionId);mutate(x,y);assert.equal(matchingResultObject(x,y),false);assert.equal(validateDiscoveryMemory(n.discovery,n).experiments.length,0);assert.equal(validateLedgers({now:n.elapsed,receiptsInput:n.memory.experience,experimentsInput:n.discovery.experiments,effectsInput:[]}).experiments.length,0);assert.ok(retainedProofIntegrityError(n));}
 const old=clone(f.n);delete old.discovery.experiments[0].resultObjectId;delete old.memory.experience.find(x=>x.type==='action').details.result.resultObjectId;assert.equal(retainedProofIntegrityError(old),null);assert.equal(validateDiscoveryMemory(old.discovery,old).experiments.length,1);assert.equal(validResultObjectRow('strike','object:1',{}),true);
});
test('ordinary bounded retirement removes terminal identity pair without pinning a hunt',()=>{
 const f=fixture({carcass:false});f.animal.health=f.animal.physiology.health=7;const r=finish(f,'strike'),event=f.n.lastResult.eventId;
 for(let i=0;i<170;i++)finish(f,'inspect_object',r.resultObjectId);
 assert.equal(f.n.discovery.experiments.some(e=>e.actionId===event),false);assert.equal(f.n.memory.experience.some(e=>e.id===event),false);assert.equal(retainedProofIntegrityError(f.n),null);const plan=planProofRetention(f.n);assert.equal(plan.ok,true);assert.equal(applyProofRetention(f.n,plan),true);
});

test('cancelled originals and copied/reloaded active objects cannot resume strike or processing',()=>{
 for(const type of ['strike','pull'])for(const copied of [false,true]){const f=fixture({carcass:type==='pull'});if(type==='strike')f.animal.health=f.animal.physiology.health=7;
  requestNpcAction(f.n,{type,targetId:f.source.id},f.env);tickNpc(f.n,.25,f.env);const active=copied?clone(f.n.active):f.n.active;
  cancelNpcAction(f.n);const before=clone(f.e),observations=clone(f.n.discovery.observations),events=f.n.memory.experience.length;f.n.active=active;tickNpc(f.n,5,f.env);
  assert.equal(f.n.active,null);assert.deepEqual(f.e,before);assert.deepEqual(f.n.discovery.observations,observations);assert.equal(f.n.memory.experience.length,events);
 }
});

test('raw receipt acquisition fields cannot disappear through bounded compaction and become valid links',()=>{
 const f=fixture({carcass:false});f.animal.health=f.animal.physiology.health=7;finish(f,'strike');
 const r=f.n.memory.experience.find(e=>e.type==='action');r.details.result={ok:true,code:'object_stopped_moving',resultObjectId:f.n.lastResult.resultObjectId};
 for(let i=0;i<21;i++)r.details.result[`padding${i}`]=0;r.details.result.materialId=null;
 assert.equal(matchingResultObject(f.n.discovery.experiments[0],r),false);assert.equal(validateNpc(clone(f.n)).discovery.experiments.length,0);
});

test('terminal strike callback failure cannot replay successor or direct observation',()=>{
 const f=fixture({carcass:false});f.animal.health=f.animal.physiology.health=7;
 requestDiscoveryAction(f.n,{type:'strike',targetId:f.source.id},f.env);const active=f.n.active;let calls=0;
 assert.throws(()=>tickDiscoveryAction(f.n,10,f.env,{complete(n,request,result){calls++;assert.equal(result.resultObjectId,f.e.materials[0].id);throw Error('terminal callback');}}),/terminal callback/);
 const physical=clone(f.e),observed=clone(f.n.discovery.observations);assert.ok(observed[f.e.materials[0].id]);
 f.n.active=active;assert.equal(tickDiscoveryAction(f.n,10,f.env),false);assert.equal(calls,1);assert.deepEqual(f.e,physical);assert.deepEqual(f.n.discovery.observations,observed);
});

test('natural death and later local sight do not fabricate an actor causal result',()=>{
 const f=fixture({carcass:false});f.animal.health=f.animal.physiology.health=0;f.animal.physiology.waterDeficitMl=1000;const prior=clone(f.n.discovery.experiments);
 tickEcology(f.e,.5,f.env,[f.n]);const carcass=f.e.materials.find(m=>m.kind==='carcass');assert.ok(carcass);
 assert.deepEqual(f.n.discovery.experiments,prior);observeNpc(f.n,f.env);assert.ok(f.n.discovery.observations[carcass.id]);assert.deepEqual(f.n.discovery.experiments,prior);assert.equal(f.n.discovery.techniques.length,0);
});
