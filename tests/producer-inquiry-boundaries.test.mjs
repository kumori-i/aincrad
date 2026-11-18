import test from 'node:test';
import assert from 'node:assert/strict';
import {createOzarkWorldGeometry} from '../src/ozark-world-geometry.js';
import {createOzarkState} from '../src/ozark-save.js';
import {bindOzarkEcology} from '../src/ozark-ecology.js';
import {bindOzarkWorldAgent} from '../src/ozark-agent-world.js';
import {observeNpc,requestNpcAction,tickNpc,cancelNpcAction} from '../src/npc.js';
import {processDiscoveryFeedback} from '../src/discovery.js';
import {exertPhysiology,projectPhysiology} from '../src/biology.js';
import {bodySignals} from '../src/interoception.js';
import {lookupEcologyObject} from '../src/ecology.js';
import {producerExperiment,producerInquiryStatus,receiveProducerAction,reassessProducerInquiries,retireProducerCustody} from '../src/producer-inquiry.js';
import {tickDiscoveryAction} from '../src/discovery-actions.js';
import {SocialCoordinator} from '../src/social.js';
import {NpcController} from '../src/controller.js';
const geometry=createOzarkWorldGeometry();
// Independent authored encounter. Physical actions, ingestion and feedback are
// genuine; this is boundary verification, not an ordinary learning trial.
function fixture({cloneFeedback=false,cancelSample=false,toxic=false}={}){
 const state=createOzarkState(geometry,{communicationSeed:88101}),n=state.agents[0],e=state.environment;
 bindOzarkEcology(e.ecology,geometry);const source=e.ecology.plants.find(p=>p.kind==='apple_tree');
 Object.assign(source,{position:{x:400,y:720},quantity:4});n.position={...source.position};bindOzarkWorldAgent(n,geometry,state);observeNpc(n,e);
 const needs=()=>{Object.assign(n.physiology,{availableEnergyKcal:700,waterDeficitMl:0,stamina:90,fatigue:10,sleepPressure:10,satietyHours:1.5});projectPhysiology(n);};needs();
 const advance=seconds=>{for(let t=0;t<seconds-1e-8;t+=.25){tickNpc(n,Math.min(.25,seconds-t),e);if(cloneFeedback)n.physiology.feedback=n.physiology.feedback.map(x=>({...x}));processDiscoveryFeedback(n);}};
 const finish=request=>{const admitted=requestNpcAction(n,request,e);for(let i=0;i<120&&n.active;i++)advance(.25);assert.equal(n.active,null);return n.lastResult??admitted;};
 assert.equal(finish({type:'pull',targetId:source.id}).code,'piece_detached');const item=n.inventory.items.at(-1);
 assert.equal(finish({type:'release',targetId:item}).code,'object_released');
 assert.equal(finish({type:'grasp',targetId:item}).code,'object_held');
 if(toxic)lookupEcologyObject(e.ecology,item).toxicity=.3;
 if(cancelSample){requestNpcAction(n,{type:'sample',targetId:item},e);advance(.25);assert.equal(cancelNpcAction(n),true);}
 assert.equal(finish({type:'sample',targetId:item}).code,'SWALLOWED');advance(100);
 if(n.inventory.items.includes(item))assert.equal(finish({type:'release',targetId:item}).code,'object_released');needs();
 const choose=(body=bodySignals(n),overrides={})=>producerExperiment(n,{body,local:()=>true,eligible:()=>true,blocked:()=>false,...overrides});
 return {state,n,e,source,item,advance,finish,needs,choose};
}

test('producer hypotheses require original personal feedback, not copied feedback or cancelled prefix',()=>{
 for(const options of [{cloneFeedback:true},{cancelSample:true},{toxic:true}]){
  const f=fixture(options);assert.equal(f.choose(),null,JSON.stringify(options));
  if(options.toxic)assert.ok((producerInquiryStatus(f.n)?.questions??[]).every(q=>q.phase==='retired'),'later adverse feedback may retire a formerly admitted question');
  else assert.equal(producerInquiryStatus(f.n)?.admissions??0,0,JSON.stringify(options));
 }
});

test('care, capacity and locality defer without refreshing or consuming the question',()=>{
 const f=fixture();let status=producerInquiryStatus(f.n);assert.equal(status.admissions,1);const question=status.questions[0],body=bodySignals(f.n);
 for(const change of [{digestion:'full'},{stamina:'winded'},{fatigue:'weary'},{sleepiness:'sleepy'},{energy:'depleted'},{pain:'aching'},{hunger:'ravenous'},{thirst:'parched'},{thermal:'shivering'}]){
  assert.equal(f.choose({...body,...change}),null);assert.deepEqual(producerInquiryStatus(f.n).questions,[question]);
 }
 const items=f.n.inventory.items;f.n.inventory.items=['a','b','c','d'];assert.equal(f.choose(),null);f.n.inventory.items=items;
 assert.equal(f.choose(body,{local:()=>false}),null);assert.equal(f.choose(body,{blocked:()=>true}),null);assert.deepEqual(producerInquiryStatus(f.n).questions,[question]);
 f.advance(question.deadline-f.n.elapsed+.25);assert.equal(f.choose(),null);assert.equal(producerInquiryStatus(f.n).questions[0].phase,'retired');
});

test('fake witnesses, copied actor state and restored public evidence cannot issue a producer question',()=>{
 const f=fixture();assert.equal(producerInquiryStatus(f.n).admissions,1);const before=producerInquiryStatus(f.n);
 receiveProducerAction(f.n,{type:'pull',sourceId:f.source.id,ok:true});assert.deepEqual(producerInquiryStatus(f.n),before);
 const clonedState=structuredClone(f.state),clone=clonedState.agents.find(n=>n.id===f.n.id);bindOzarkEcology(clonedState.environment.ecology,geometry);bindOzarkWorldAgent(clone,geometry,clonedState);assert.equal(producerInquiryStatus(clone),null);
 reassessProducerInquiries(clone);assert.equal(producerExperiment(clone,{body:bodySignals(clone),local:()=>true,eligible:()=>true,blocked:()=>false}),null);
 const peer=f.state.agents[1];bindOzarkWorldAgent(peer,geometry,f.state);peer.physiology.feedback=f.n.physiology.feedback.map(x=>({...x}));reassessProducerInquiries(peer);assert.equal(producerInquiryStatus(peer),null);
 peer.physiology.feedback=[];peer.position={...f.source.position};Object.assign(peer.physiology,{availableEnergyKcal:700,waterDeficitMl:0,satietyHours:1.5});projectPhysiology(peer);observeNpc(peer,f.e);
 const advancePeer=seconds=>{for(let t=0;t<seconds;t+=.25){tickNpc(peer,.25,f.e);processDiscoveryFeedback(peer);}};
 for(const type of ['grasp','sample']){requestNpcAction(peer,{type,targetId:f.item},f.e);for(let i=0;i<120&&peer.active;i++)advancePeer(.25);assert.equal(peer.lastResult.ok,true);}
 advancePeer(100);assert.ok(peer.physiology.feedback.some(x=>x.effect==='sustained'));assert.equal(producerInquiryStatus(peer).admissions,0,'own relief from a peer-produced piece supplies no own producing action');
});

test('scope replacement and actual observed identity replacement retire rather than restore authority',()=>{
 for(const kind of ['epoch','memory','discovery','physiology','elapsed','source']){
  const f=fixture();assert.equal(producerInquiryStatus(f.n).admissions,1);
  if(kind==='source'){
   f.e.ecology.plants=f.e.ecology.plants.map(p=>p===f.source?structuredClone(p):p);observeNpc(f.n,f.e);
   assert.equal(f.choose(),null);assert.equal(producerInquiryStatus(f.n).questions[0].phase,'retired');continue;
  }
  const prior=f.n[kind];f.n[kind]=kind==='epoch'?prior+1:kind==='elapsed'?-1:{};reassessProducerInquiries(f.n);f.n[kind]=prior;
  assert.equal(producerInquiryStatus(f.n),null);assert.equal(f.choose(),null);
 }
});

test('selected question is one-use and cancelled paid acquisition cannot continue or retry',()=>{
 const f=fixture();const request=f.choose();assert.deepEqual(request,{type:'pull',targetId:f.source.id});assert.equal(f.choose(),null);
 requestNpcAction(f.n,request,f.e);f.advance(.25);assert.ok(f.n.active);assert.equal(cancelNpcAction(f.n),true);
 assert.equal(producerInquiryStatus(f.n).questions[0].phase,'retired');assert.equal(f.choose(),null);
 receiveProducerAction(f.n,{ok:true,materialId:f.item});assert.equal(f.choose(),null);
});

test('custody revocation removes pending producer links, while public copies grant no replacement',()=>{
 const f=fixture();const request=f.choose();assert.ok(request);assert.equal(f.finish(request).code,'piece_detached');const material=f.n.inventory.items.at(-1);
 assert.equal(producerInquiryStatus(f.n).questions[0].phase,'sample-ready');retireProducerCustody(f.n,material);
 assert.equal(f.choose(),null);assert.equal(producerInquiryStatus(f.n).questions[0].phase,'retired');
});

test('care delays sample continuation within its original deadline; cancellation retires it',()=>{
 const f=fixture(),request=f.choose(),deadline=producerInquiryStatus(f.n).questions[0].deadline;
 assert.equal(f.finish(request).code,'piece_detached');assert.equal(producerInquiryStatus(f.n).questions[0].phase,'sample-ready');
 assert.equal(f.choose({...bodySignals(f.n),thirst:'parched'}),null);f.advance(10);f.needs();
 assert.equal(producerInquiryStatus(f.n).questions[0].deadline,deadline);
 const sample=f.choose();assert.equal(sample.type,'sample');requestNpcAction(f.n,sample,f.e);assert.ok(f.n.active);assert.ok(f.n.active.expiresAt<=deadline);
 f.advance(.25);assert.equal(cancelNpcAction(f.n),true);assert.equal(f.choose(),null);assert.equal(producerInquiryStatus(f.n).questions[0].phase,'retired');
});

test('cloned selected request is ordinary work, not a reusable inquiry continuation permit',()=>{
 const f=fixture(),request=f.choose();assert.ok(request);
 assert.equal(f.finish({...request}).code,'piece_detached');
 assert.equal(producerInquiryStatus(f.n).questions[0].phase,'unavailable');assert.equal(f.choose(),null);
});


test('preflight refusal and request mutation consume the selected one-shot permission',()=>{
 for(const mode of ['range','mutated-target','mutated-type']){
  const f=fixture(),request=f.choose();assert.ok(request);const admissions=producerInquiryStatus(f.n).admissions;
  if(mode==='range')f.n.position={x:f.n.position.x+400,y:f.n.position.y};
  if(mode==='mutated-target')request.targetId=f.item;
  if(mode==='mutated-type')request.type='inspect_object';
  const result=requestNpcAction(f.n,request,f.e);
  if(mode==='range')assert.equal(result.ok,false);
  for(let i=0;i<120&&f.n.active;i++)f.advance(.25);
  assert.equal(producerInquiryStatus(f.n).questions[0].phase,'unavailable',mode);
  assert.equal(f.choose(),null);assert.equal(producerInquiryStatus(f.n).admissions,admissions);
 }
});

test('reentrant paid-work cancellation cannot turn a retired inquiry into completed acquisition',()=>{
 const f=fixture(),request=f.choose();assert.equal(requestNpcAction(f.n,request,f.e).code,'ACTION_STARTED');
 const active=f.n.active;let called=0;
 tickDiscoveryAction(f.n,.25,f.e,{exert:(n,seconds,effort)=>{called++;exertPhysiology(n,seconds,effort);assert.equal(cancelNpcAction(n),true);tickDiscoveryAction(n,.25,f.e);}});
 assert.equal(called,1);assert.notEqual(f.n.active,active);assert.equal(producerInquiryStatus(f.n).questions[0].phase,'retired');assert.equal(f.choose(),null);
});

test('real voluntary paid handoff of original or trial material retires donor inquiry without granting receiver provenance',()=>{
 for(const kind of ['original','trial']){
 const f=fixture();
 if(kind==='trial'){const request=f.choose();assert.equal(f.finish(request).code,'piece_detached');}
 else assert.equal(f.finish({type:'grasp',targetId:f.item}).code,'object_held');
 const material=f.n.inventory.items.at(-1),peer=f.state.agents[1];peer.position={...f.n.position};peer.elapsed=f.n.elapsed;bindOzarkWorldAgent(peer,geometry,f.state);observeNpc(peer,f.e);
 const social=new SocialCoordinator({communicationMode:'grounded',getAgents:()=>f.state.agents,getCommunity:()=>f.state.community,getEnvironment:()=>f.e});
 const donor=new NpcController(f.n,{environment:f.e,social}),receiver=new NpcController(peer,{environment:f.e,social});
 try{
  const offer=donor.perform({type:'offer_food',targetId:peer.id,objectId:material});assert.equal(offer.code,'FOOD_OFFERED');
  assert.equal(receiver.perform({type:'accept_food',offerId:offer.offerId}).code,'ACTION_STARTED');
  for(let i=0;i<120&&peer.active;i++){tickNpc(peer,.25,f.e);processDiscoveryFeedback(peer);}
  assert.equal(peer.active,null);assert.equal(lookupEcologyObject(f.e.ecology,material).heldBy,peer.id);
  assert.equal(producerInquiryStatus(f.n).questions[0].phase,'retired');assert.equal(f.choose(),null);
  assert.equal(producerInquiryStatus(peer)?.admissions??0,0);
 }finally{social.dispose();}
 }
});


test('observed identity replacement of the motivating material retires an already admitted question',()=>{
 const f=fixture();assert.equal(producerInquiryStatus(f.n).questions[0].phase,'ready');
 const physical=lookupEcologyObject(f.e.ecology,f.item);assert.ok(physical);
 const entry=Object.entries(f.e.ecology).find(([,v])=>Array.isArray(v)&&v.includes(physical));assert.ok(entry);
 const replacement=structuredClone(physical);f.e.ecology[entry[0]]=entry[1].map(o=>o===physical?replacement:o);
 assert.equal(lookupEcologyObject(f.e.ecology,f.item),replacement);
 const observed=observeNpc(f.n,f.e);assert.ok(observed.objects.some(o=>o.id===f.item),'replacement actually enters personal perception');
 assert.equal(producerInquiryStatus(f.n).questions[0].phase,'retired');assert.equal(f.choose(),null);
});

test('evicting bounded question details cannot renew a genuinely admitted producer opportunity',()=>{
 const f=fixture(),sources=f.e.ecology.plants.filter(p=>p.kind==='apple_tree'&&p!==f.source).slice(0,16);assert.equal(sources.length,16);
 const learn=source=>{
  Object.assign(source,{position:{...f.n.position},quantity:4});observeNpc(f.n,f.e);f.needs();
  assert.equal(f.finish({type:'pull',targetId:source.id}).code,'piece_detached');const item=f.n.inventory.items.at(-1);
  assert.equal(f.finish({type:'release',targetId:item}).code,'object_released');
  assert.equal(f.finish({type:'grasp',targetId:item}).code,'object_held');
  assert.equal(f.finish({type:'sample',targetId:item}).code,'SWALLOWED');f.advance(100);
  if(f.n.inventory.items.includes(item))assert.equal(f.finish({type:'release',targetId:item}).code,'object_released');f.needs();
 };
 for(const source of sources)learn(source);
 let status=producerInquiryStatus(f.n);assert.equal(status.admissions,17);assert.equal(status.questions.length,16);assert.ok(status.questions.every(q=>q.sourceId!==f.source.id));
 learn(f.source);status=producerInquiryStatus(f.n);assert.equal(status.admissions,17);assert.equal(status.questions.length,16);assert.ok(status.questions.every(q=>q.sourceId!==f.source.id),'fresh genuine evidence cannot rearm evicted admission');
});
