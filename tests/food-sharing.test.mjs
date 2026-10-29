import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, SOCIAL_RULES } from '../src/config.js';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { OZARK_SAVE_KEY, createOzarkState, writeOzarkSave, loadOzarkSave } from '../src/ozark-save.js';
import { bindOzarkWorldAgent } from '../src/ozark-agent-world.js';
import { observeNpc, requestNpcAction, tickNpc, cancelNpcAction } from '../src/npc.js';
import { SocialCoordinator } from '../src/social.js';
import { NpcController } from '../src/controller.js';
import { lookupEcologyObject, consumeEcologyMaterial } from '../src/ecology.js';
import { retainedProofIntegrityError } from '../src/proof-retention.js';
import { recordEvent } from '../src/npc-memory.js';
import { processDiscoveryFeedback } from '../src/discovery.js';
import { tickDiscoveryAction } from '../src/discovery-actions.js';

const geometry=createOzarkWorldGeometry();
// Static stock/encounter fixture: only actor bodies/actions advance. Align the
// save envelope clock explicitly; native ecology evidence is tested separately.
function fixture({lineOfSightGate=null,communicationMode='legacy'}={}){
 const physicalGeometry=lineOfSightGate?Object.freeze({...geometry,lineOfSight:(...args)=>lineOfSightGate()&&geometry.lineOfSight(...args)}):geometry;
 const state=createOzarkState(physicalGeometry),[a,b]=state.agents,e=state.environment;
 const source=e.ecology.plants.find(p=>p.kind==='apple_tree'&&p.quantity>2&&geometry.canOccupy(p.position.x+45,p.position.y,CONFIG.playerRadius));
 assert.ok(source);state.elapsed=e.elapsed=e.ecology.elapsed=60;
 for(const n of [a,b]){n.elapsed=60;n.position={x:source.position.x+45,y:source.position.y};bindOzarkWorldAgent(n,physicalGeometry,state);observeNpc(n,e);}
 const social=new SocialCoordinator({communicationMode,getAgents:()=>state.agents,getCommunity:()=>state.community,getEnvironment:()=>e});
 const controllers=state.agents.map(n=>new NpcController(n,{environment:e,social}));
 function advance(seconds){for(let t=0;t<seconds-1e-8;t+=.1){e.elapsed+=.1;state.elapsed=e.elapsed;e.ecology.elapsed=e.elapsed;for(const n of state.agents)tickNpc(n,.1,e);}}
 function finish(n,action){const result=requestNpcAction(n,action,e);if(result.code==='ACTION_STARTED')for(let i=0;n.active&&i<100;i++)advance(.1);return n.lastResult||result;}
 assert.equal(finish(a,{type:'pull',targetId:source.id}).ok,true);
 const item=a.inventory.items[0];
 function offer(){const result=controllers[0].perform({type:'offer_food',targetId:b.id,objectId:item});assert.equal(result.code,'FOOD_OFFERED');return result.offerId;}
 return {state,a,b,e,social,controllers,item,advance,finish,offer};
}
function save(storage,state){const ok=writeOzarkSave(storage,state,geometry);if(!ok){const {npc,...raw}=state;storage.setItem(OZARK_SAVE_KEY,JSON.stringify(raw));assert.fail(loadOzarkSave(storage,geometry).error);}return ok;}
const disk=()=>{const map=new Map();return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};};

test('voluntary offer alone cannot transfer; accepted handover pays and preserves exact matter, proof and personal learning',()=>{
 const f=fixture(),{a,b,item,e,social}=f,physical=lookupEcologyObject(e.ecology,item),before=structuredClone(physical);
 const id=f.offer();assert.doesNotMatch(f.state.community.messages.at(-1).text,/object:/);assert.deepEqual(b.inventory.items,[]);assert.equal(physical.heldBy,a.id);
 assert.equal(f.controllers[1].perform({type:'accept_food',offerId:id}).code,'ACTION_STARTED');
 assert.equal(social.action(b,{type:'accept_food',offerId:id}).ok,false);
 assert.equal(physical.heldBy,a.id);f.advance(1);assert.equal(physical.heldBy,a.id);f.advance(2);
 assert.equal(physical.heldBy,b.id);assert.deepEqual(a.inventory.items,[]);assert.deepEqual(b.inventory.items,[item]);
 assert.deepEqual({...physical,heldBy:before.heldBy,position:before.position},before);
 assert.equal(b.discovery.experiments.at(-1).primitive,'grasp');assert.ok(b.discovery.experiments.at(-1).durationSeconds>=2.49);
 assert.equal(b.discovery.effects.length,0);assert.equal(b.discovery.techniques.length,0);assert.equal(b.stats.independentMeals,0);
 assert.equal(retainedProofIntegrityError(a),null);assert.equal(retainedProofIntegrityError(b),null);
 const storage=disk();assert.equal(save(storage,f.state),true);assert.equal(loadOzarkSave(storage,geometry).blocked,false);
 assert.equal(f.finish(b,{type:'sample',targetId:item}).ok,true);f.advance(100);processDiscoveryFeedback(b);
 assert.ok(b.discovery.effects.some(effect=>effect.objectId===item&&effect.effect==='sustained'));
 for(let i=0;i<220;i++)recordEvent(b,'debug',{message:'retention pressure'});
 assert.equal(retainedProofIntegrityError(b),null);assert.equal(save(storage,f.state),true);
});

test('local request is qualitative and exposes only one offered object, never private inventories',()=>{
 const f=fixture(),{a,b,social,controllers}=f;b.physiology.hoursSinceMeal=8;b.physiology.satietyHours=Math.max(0,6-8);
 assert.equal(social.foodSharing.choose(b).type,'request_food');
 const request=controllers[1].perform(social.foodSharing.choose(b));assert.equal(request.code,'FOOD_REQUESTED');
 const observed=social.observe(a).foodSharing;assert.equal(observed.requests[0].senderId,b.id);assert.match(observed.requests[0].text,/hungry/);
 assert.equal(JSON.stringify(observed).includes('inventory'),false);
 assert.equal(social.foodSharing.choose(a).type,'decline_food'); // no personal evidence yet
 assert.equal(social.action(b,{type:'request_food',targetId:a.id}).code,'REQUEST_COOLDOWN');
});

test('receiver refusal, donor withdrawal, range, sleep, capacity and cancellation fail without loss',()=>{
 for(const change of ['refuse','withdraw','range','sleep','capacity','cancel','ownership','copy','mutate','timing','los','depleted','disposed','expired','environment','donor-busy']){
  let visible=true;const f=fixture({lineOfSightGate:change==='los'?()=>visible:null}),{a,b,item,e,social}=f,id=f.offer();
  if(change==='refuse'){assert.equal(social.action(b,{type:'decline_food',offerId:id}).ok,true);assert.equal(social.action(b,{type:'accept_food',offerId:id}).ok,false);continue;}
  assert.equal(social.action(b,{type:'accept_food',offerId:id}).code,'ACTION_STARTED');
  if(change==='withdraw')assert.equal(social.action(a,{type:'decline_food',offerId:id}).ok,true);
  if(change==='range')a.position={x:a.position.x+100,y:a.position.y};
  if(change==='sleep')a.lifecycle='COLLAPSED';
  if(change==='capacity')b.inventory.items=['object:800001','object:800002','object:800003','object:800004'];
  if(change==='cancel')cancelNpcAction(b);
  if(change==='ownership')a.inventory.items=[];
  if(change==='copy')b.active=structuredClone(b.active);
  if(change==='mutate')b.active.request.targetId='object:800001';
  if(change==='timing')b.active.seconds=.1;
  if(change==='los')visible=false;
  if(change==='depleted')assert.equal(consumeEcologyMaterial(e.ecology,item,1,{actorId:a.id}).ok,true);
  if(change==='disposed')social.dispose();
  if(change==='expired')e.elapsed+=60;
  if(change==='environment')social.getEnvironment=()=>({...e});
  if(change==='donor-busy')assert.equal(requestNpcAction(a,{type:'wait',seconds:5},e).ok,true);
  f.advance(3);assert.equal(lookupEcologyObject(e.ecology,item)?.heldBy,change==='depleted'?undefined:a.id,change);
  assert.equal(b.inventory.items.includes(item),false,change);
 }
});

test('pending offers and partial paid consent do not survive a coordinator restart',()=>{
 const f=fixture(),{a,b,social,e,item}=f,id=f.offer();social.action(b,{type:'accept_food',offerId:id});f.advance(.5);
 const storage=disk();assert.equal(save(storage,f.state),true);
 const loaded=loadOzarkSave(storage,geometry);assert.equal(loaded.blocked,false);
 const restored=loaded.state;const next=new SocialCoordinator({getAgents:()=>restored.agents,getCommunity:()=>restored.community,getEnvironment:()=>restored.environment});
 assert.deepEqual(next.observe(restored.agents[1]).foodSharing,{requests:[],offers:[]});
 assert.equal(next.action(restored.agents[1],{type:'accept_food',offerId:id}).ok,false);
 assert.equal(lookupEcologyObject(restored.environment.ecology,item).heldBy,a.id);
});

test('synchronous cancellation/reentry cannot use or replay a paid transfer',()=>{
 const f=fixture(),{a,b,e,item,social}=f,id=f.offer();social.action(b,{type:'accept_food',offerId:id});const active=b.active;
 tickDiscoveryAction(b,3,e,{exert:()=>{tickDiscoveryAction(b,3,e);cancelNpcAction(b);}});
 b.active=active;tickDiscoveryAction(b,3,e);assert.equal(lookupEcologyObject(e.ecology,item).heldBy,a.id);
 assert.equal(b.inventory.items.includes(item),false);
});

test('static encounter: genuine timed aquatic acquisition transfers and returns with retained own grasp proof',async()=>{
 const {bankFor}=await import('./fixtures/finite-fishing.mjs');
 const f=fixture(),{a,b,e,social}=f;
 const fish=e.ecology.aquatic.fish.find(fish=>bankFor(geometry,fish.position));assert.ok(fish);
 const bank=bankFor(geometry,fish.position);a.position={...bank};b.position={...bank};
 observeNpc(a,e);assert.equal(f.finish(a,{type:'catch',targetId:fish.id}).ok,true);
 const id=fish.id,original=structuredClone(lookupEcologyObject(e.ecology,id)),ledger=structuredClone(e.ecology.aquatic.ledger);
 let offered=social.action(a,{type:'offer_food',targetId:b.id,objectId:id});assert.equal(offered.ok,true);
 assert.equal(social.action(b,{type:'accept_food',offerId:offered.offerId}).code,'ACTION_STARTED');f.advance(3);
 assert.equal(lookupEcologyObject(e.ecology,id).heldBy,b.id);assert.deepEqual(e.ecology.aquatic.ledger,ledger);
 assert.deepEqual({...lookupEcologyObject(e.ecology,id),heldBy:original.heldBy,position:original.position},original);
 let storage=disk();assert.equal(save(storage,f.state),true);assert.equal(loadOzarkSave(storage,geometry).blocked,false);
 for(let i=0;i<200;i++){recordEvent(a,'debug',{message:'donor retention pressure'});recordEvent(b,'debug',{message:'recipient retention pressure'});}
 offered=social.action(b,{type:'offer_food',targetId:a.id,objectId:id});assert.equal(offered.ok,true);
 assert.equal(social.action(a,{type:'accept_food',offerId:offered.offerId}).code,'ACTION_STARTED');f.advance(3);
 assert.equal(lookupEcologyObject(e.ecology,id).heldBy,a.id);assert.equal(retainedProofIntegrityError(a),null);assert.equal(retainedProofIntegrityError(b),null);
 assert.equal(save(storage,f.state),true);const restored=loadOzarkSave(storage,geometry);assert.equal(restored.blocked,false,restored.error);
 assert.equal(restored.state.agents[0].inventory.items.includes(id),true);
});

test('prepared local encounter: both live controllers complete a voluntary request and handover without forcing either idle',()=>{
 const f=fixture(),{a,b,e,social,item,controllers}=f;
 // Explicit encounter and real donor sample/feedback preparation, not a claim
 // of autonomous fishing, travel, food discovery, or long-term social living.
 assert.equal(f.finish(a,{type:'sample',targetId:item}).ok,true);f.advance(100);processDiscoveryFeedback(a);
 assert.ok(a.discovery.effects.some(effect=>effect.objectId===item&&effect.effect==='sustained'));
 b.physiology.hoursSinceMeal=8;b.physiology.satietyHours=Math.max(0,6-8);
 assert.equal(controllers[1].perform(social.foodSharing.choose(b)).code,'FOOD_REQUESTED');
 // A recent dialogue must not make a pending exchange wait for the generic
 // twelve-second conversation cadence. This is not an idle/action override.
 b.discovery.lastDialogueAt=b.elapsed;
 const before=a.physiology.totals.metabolizedKcal;
 for(let i=0;i<80&&lookupEcologyObject(e.ecology,item)?.heldBy!==b.id;i++){
   e.elapsed+=.1;f.state.elapsed=e.elapsed;e.ecology.elapsed=e.elapsed;
   for(const controller of i%2?controllers:[...controllers].reverse())controller.tick(.1);
 }
 assert.equal(lookupEcologyObject(e.ecology,item).heldBy,b.id,JSON.stringify(f.state.community.messages.slice(-6)));
 assert.ok(a.physiology.totals.metabolizedKcal>before,'donor physiology advances during cooperative attention');
 assert.equal(b.stats.independentMeals,0);assert.equal(b.discovery.effects.length,0);
 const storage=disk();assert.equal(save(storage,f.state),true);const reopened=loadOzarkSave(storage,geometry);assert.equal(reopened.blocked,false,reopened.error);
 assert.deepEqual(reopened.state.agents[1].inventory.items,b.inventory.items);
});

test('voluntary donor attention is bounded and yields to urgent needs, contact and water danger',()=>{
 for(const reason of ['urgent','contact','water','expired','locality','depleted']){
  const f=fixture(),{a,b,e,social}=f,id=f.offer();assert.equal(social.foodSharing.holding(a),true);
  if(reason==='urgent')a.physiology.waterDeficitMl=6000;
  if(reason==='depleted')assert.equal(consumeEcologyMaterial(e.ecology,f.item,1,{actorId:a.id}).ok,true);
  if(reason==='contact')recordEvent(a,'condition',{code:'CONTACT_INJURY',scene:a.scene,sourceId:'object:999999',sourcePosition:{...a.position},provenance:'experienced contact'});
  if(reason==='water'){
    const water=e.ecology.aquatic.fish.find(fish=>['shallow-water','deep-water','deep-pond'].includes(geometry.observe(fish.position).ground));assert.ok(water);
    a.position={...water.position};b.position={...water.position};
  }
  if(reason==='expired')e.elapsed+=15;
  if(reason==='locality')b.position={x:b.position.x+100,y:b.position.y};
  assert.equal(social.foodSharing.holding(a),false,reason);
  assert.equal(social.observe(b).foodSharing.offers.length,0,reason);
  assert.equal(social.action(b,{type:'accept_food',offerId:id}).ok,false,reason);
 }
});


test('grounded sharing uses supplied local motor gestures, never words or donor knowledge',()=>{
 const f=fixture({communicationMode:'grounded'}),{a,b,social,controllers,item,e}=f;
 for(const method of ['say','append','receive'])social[method]=()=>{throw Error(`forbidden language route ${method}`);};
 const beforeMessages=structuredClone(f.state.community.messages),beforeMemory=structuredClone(b.discovery);
 b.physiology.hoursSinceMeal=8;b.physiology.satietyHours=0;
 const request=controllers[1].perform({type:'request_food',targetId:a.id});assert.equal(request.code,'FOOD_REQUESTED');
 assert.deepEqual(Object.keys(social.foodSharing.observe(a).requests[0]).sort(),['gesture','id','senderId']);
 assert.equal(request.gesture.gesture,'request');assert.equal('text' in request.gesture,false);
 const id=f.offer(),observed=social.foodSharing.observe(b).offers[0];
 assert.equal(observed.gesture,'offer');assert.equal(observed.objectId,item);assert.ok(observed.appearance);
 assert.equal('text' in observed,false);assert.equal('effect' in observed,false);
 assert.deepEqual(b.discovery,beforeMemory,'gestures do not deliver semantic claims or personal evidence');
 assert.equal(controllers[1].perform({type:'accept_food',offerId:id}).code,'ACTION_STARTED');
 assert.equal(lookupEcologyObject(e.ecology,item).heldBy,a.id);f.advance(3);
 assert.equal(lookupEcologyObject(e.ecology,item).heldBy,b.id);
 assert.deepEqual(f.state.community.messages,beforeMessages);
 assert.deepEqual(social.foodSharing.gestures().map(row=>row.gesture),['request','offer','accept']);
 assert.ok(social.foodSharing.gestures().every(row=>row.provenance==='supplied-nonverbal-motor'));
 assert.equal(b.discovery.effects.length,0);assert.equal(b.discovery.techniques.length,0);
});

test('grounded withdrawal revokes consent and bounded observer gestures cannot recreate it',()=>{
 const f=fixture({communicationMode:'grounded'}),{a,b,social,e,item}=f;
 for(let i=0;i<40;i++){
   const id=f.offer();assert.equal(social.action(a,{type:'decline_food',offerId:id}).ok,true);
   assert.equal(social.action(b,{type:'accept_food',offerId:id}).ok,false);
 }
 const history=social.foodSharing.gestures();assert.equal(history.length,64);
 history[0].gesture='accept';history.length=0;
 assert.equal(social.foodSharing.gestures().length,64);
 assert.notEqual(social.foodSharing.gestures()[0].gesture,'accept');
 const id=f.offer();assert.equal(social.action(b,{type:'accept_food',offerId:id}).code,'ACTION_STARTED');
 assert.equal(social.action(a,{type:'decline_food',offerId:id}).ok,true);f.advance(3);
 assert.equal(lookupEcologyObject(e.ecology,item).heldBy,a.id);
 assert.equal(social.foodSharing.gestures().at(-1).gesture,'withdraw');
 social.dispose();assert.deepEqual(social.foodSharing.gestures(),[]);
});
