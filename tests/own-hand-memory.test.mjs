import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpc } from '../src/npc-state.js';
import { createEnvironment, tickEnvironment } from '../src/environment.js';
import { requestNpcAction, tickNpc, observeNpc, cancelNpcAction } from '../src/npc.js';
import { requestDiscoveryAction, tickDiscoveryAction } from '../src/discovery-actions.js';
import { bodySignals } from '../src/interoception.js';
import { exertPhysiology, projectPhysiology } from '../src/biology.js';
import { lookupEcologyObject } from '../src/ecology.js';
import { canStand } from '../src/world.js';
import { lineOfSight } from '../src/perception.js';
import { discoveryDecision, processDiscoveryFeedback } from '../src/discovery.js';

const clone=structuredClone;
function hungry(n){Object.assign(n.physiology,{hoursSinceMeal:10,waterDeficitMl:0,availableEnergyKcal:1000,storedEnergyKcal:1000,stamina:100,fatigue:0,sleepPressure:0});projectPhysiology(n);}
function fixture(){
  const n=createNpc({mode:'discovery',seed:74193}),e=createEnvironment(74193,{mode:'discovery'});
  const plant=e.ecology.plants.find(p=>p.kind==='apple_tree');
  n.position=[[45,0],[-45,0],[0,45],[0,-45]].map(([x,y])=>({x:plant.position.x+x,y:plant.position.y+y})).find(p=>canStand(p.x,p.y,'valley')&&lineOfSight(p,plant.position));
  assert.ok(n.position);hungry(n);observeNpc(n,e);return {n,e,plant};
}
function tick(f,seconds=.1){for(let left=seconds;left>1e-9;){const dt=Math.min(.1,left);tickEnvironment(f.e,dt);tickNpc(f.n,dt,f.e);processDiscoveryFeedback(f.n);left-=dt;}}
function act(f,type,targetId=f.plant.id){assert.equal(requestNpcAction(f.n,{type,targetId},f.e).code,'ACTION_STARTED');for(let i=0;f.n.active&&i<500;i++)tick(f);assert.equal(f.n.active,null);return f.n.lastResult;}
function heldFixture(){const f=fixture();assert.equal(act(f,'pull').ok,true);f.id=f.n.inventory.items[0];return f;}
function expected(n,id,after){return {source:'experienced',actorId:n.id,targetId:id,before:'held',after};}

// Written before implementation. All positive sensing here uses real native
// request/tick/completion; body conditioning only isolates the contract.
test('native sampling records target-only partial and final hand observations on original receipts',()=>{
  const f=heldFixture(),{n,id}=f;let partial=0,final=0;
  for(let i=0;i<12&&n.inventory.items.includes(id);i++){
    const before=n.memory.nextId,ingestions=n.physiology.nextId,result=act(f,'sample',id);
    assert.equal(result.code,'SWALLOWED');assert.ok(result.durationSeconds>0);assert.ok(result.handling.activeActionSeconds>0);
    const after=n.inventory.items.includes(id)?'held':'not-held';assert.deepEqual(result.ownHand,expected(n,id,after));
    const event=n.memory.experience.find(e=>e.id===result.eventId),experiment=n.discovery.experiments.find(e=>e.actionId===result.eventId);
    assert.deepEqual(event.details.result.ownHand,result.ownHand);assert.equal(experiment.ownHand,undefined);
    assert.equal(experiment.ingestionId,result.ingestionId);assert.ok(result.eventId>=before);assert.ok(n.physiology.nextId>ingestions);
    if(after==='held')partial++;else final++;
  }
  assert.ok(partial>0);assert.equal(final,1);assert.equal(lookupEcologyObject(f.e.ecology,id),null);
});

test('rejected and cancelled sample cannot manufacture a hand observation',()=>{
  const f=heldFixture(),{n,id}=f;assert.equal(requestNpcAction(n,{type:'sample',targetId:id},f.e).code,'ACTION_STARTED');tick(f,.1);cancelNpcAction(n);
  assert.equal(n.lastResult.ok,false);assert.equal(n.lastResult.ownHand,undefined);
  assert.equal(act(f,'release',id).ok,true);const refused=requestNpcAction(n,{type:'sample',targetId:id},f.e);assert.equal(refused.ok,false);assert.equal(n.lastResult.ownHand,undefined);
});

test('missing pre-contact and copied or changed active context cannot certify native hand state',()=>{
  for(const mode of ['pre-contact','copy','epoch','discovery','physiology','request']){
    const f=heldFixture(),{n,id}=f;assert.equal(requestNpcAction(n,{type:'sample',targetId:id},f.e).code,'ACTION_STARTED');
    if(mode==='pre-contact')n.inventory.items=[];
    if(mode==='copy')n.active=clone(n.active);
    if(mode==='epoch')n.epoch++;
    if(mode==='discovery')n.discovery=clone(n.discovery);
    if(mode==='physiology')n.physiology=clone(n.physiology);
    if(mode==='request')n.active.request={...n.active.request};
    for(let i=0;n.active&&i<500;i++)tick(f);
    assert.equal(n.lastResult.ownHand,undefined,mode);
  }
});

test('release and unrelated inventory pruning do not become sample hand claims',()=>{
  const f=heldFixture(),{n,id}=f;const release=act(f,'release',id);assert.equal(release.ownHand,undefined);assert.equal(act(f,'grasp',id).ok,true);
  n.inventory.items.push('object:999999');const result=act(f,'sample',id);assert.deepEqual(result.ownHand,expected(n,id,'held'));
  assert.equal(n.inventory.items.includes('object:999999'),false);assert.equal(Object.values(result.ownHand).includes('object:999999'),false);
});

import { ownHandReplayView, OWN_HAND_LIMITS } from '../src/own-hand-memory.js';
import { learnOutcome, validateNpc } from '../src/npc-memory.js';
import { rememberDirectDiscoveryObject } from '../src/discovery.js';
const suspended=(n,id)=>ownHandReplayView(n).suspended.has(id);
function consumeAll(f){let result;for(let i=0;i<12&&f.n.inventory.items.includes(f.id);i++)result=act(f,'sample',f.id);assert.equal(f.n.inventory.items.includes(f.id),false);return result;}
function finalReady(){const f=heldFixture();while(lookupEcologyObject(f.e.ecology,f.id).massGrams>30)act(f,'sample',f.id);return f;}

test('only new native completion creates runtime eligibility; copies and field-only history do not',()=>{
  const f=heldFixture(),result=consumeAll(f);assert.equal(suspended(f.n,f.id),true);
  const copy=clone(f.n);assert.equal(suspended(copy,f.id),false);assert.deepEqual(copy.lastResult.ownHand,result.ownHand);
  const restored=validateNpc(f.n);assert.equal(suspended(restored,f.id),false);
  assert.deepEqual(restored.memory.experience.find(e=>e.id===result.eventId).details.result.ownHand,result.ownHand);
  f.n.epoch++;assert.equal(suspended(f.n,f.id),true,'completed factual origin does not depend on current epoch');
});

test('a throwing completion cannot leave an unused native token for later receipt replay',()=>{
  const f=finalReady();let captured;
  assert.equal(requestDiscoveryAction(f.n,{type:'sample',targetId:f.id},f.e).code,'ACTION_STARTED');
  assert.throws(()=>tickDiscoveryAction(f.n,10,f.e,{complete(n,request,result){captured=result;throw new Error('deliberate completion failure');}}),/deliberate/);
  assert.ok(captured.ownHand);assert.equal(suspended(f.n,f.id),false);
  learnOutcome(f.n,{type:'sample',targetId:f.id},captured,null,{...f.n.position});
  assert.equal(suspended(f.n,f.id),false,'descriptive result cannot resurrect an abandoned completion token');
});

test('native token cannot be lent to a changed ingestion identity at original receipt linking',()=>{
  const f=finalReady();
  assert.equal(requestDiscoveryAction(f.n,{type:'sample',targetId:f.id},f.e).code,'ACTION_STARTED');
  tickDiscoveryAction(f.n,10,f.e,{complete(n,request,result){result.ingestionId='ingestion:999999';learnOutcome(n,request,result,null,{...n.position});}});
  assert.equal(suspended(f.n,f.id),false);
});

function origin(n,result=n.lastResult){return {event:n.memory.experience.find(e=>e.id===result.eventId),experiment:n.discovery.experiments.find(e=>e.actionId===result.eventId)};}
function pending(n){return n.physiology.stomach.map(p=>({id:p.id,objectId:p.objectId,actionId:p.actionId,at:p.at,provenance:p.provenance,originalMassGrams:p.originalMassGrams,digestHours:p.digestHours}));}
function earnedExact(){
  const f=heldFixture();act(f,'release',f.id);act(f,'grasp',f.id);const result=consumeAll(f);
  for(let i=0;i<1200&&(!f.n.discovery.techniques.some(t=>t.sourceId===f.id)||f.n.elapsed-(f.n.discovery.samplesPending[f.id]??-Infinity)<45);i++)tick(f);
  assert.ok(f.n.discovery.techniques.some(t=>t.sourceId===f.id));hungry(f.n);return {...f,result};
}

test('native origin is bound to expected original event and experiment identities',()=>{
  for(const field of ['action','experiment','time']){
    const f=finalReady();requestDiscoveryAction(f.n,{type:'sample',targetId:f.id},f.e);
    tickDiscoveryAction(f.n,10,f.e,{complete(n,request,result){if(field==='action')n.memory.nextId++;if(field==='experiment')n.discovery.nextId++;if(field==='time')n.elapsed++;learnOutcome(n,request,result,null,{...n.position});}});
    assert.equal(suspended(f.n,f.id),false,field);
  }
});

test('retired, replaced, malformed, ambiguous or coherently retargeted original proof becomes unknown permanently',()=>{
  const changes={
    retiredEvent:(n,o)=>{n.memory.experience=n.memory.experience.filter(e=>e!==o.event);},
    retiredExperiment:(n,o)=>{n.discovery.experiments=n.discovery.experiments.filter(e=>e!==o.experiment);},
    replacedEvent:(n,o)=>{n.memory.experience[n.memory.experience.indexOf(o.event)]=clone(o.event);},
    replacedExperiment:(n,o)=>{n.discovery.experiments[n.discovery.experiments.indexOf(o.experiment)]=clone(o.experiment);},
    duplicateEvent:(n,o)=>n.memory.experience.push(clone(o.event)),
    duplicateAction:(n,o)=>n.discovery.experiments.push({...clone(o.experiment),id:n.discovery.nextId++}),
    duplicateIngestion:(n,o)=>{const e={...clone(o.experiment),id:n.discovery.nextId++,actionId:n.memory.nextId++};n.discovery.experiments.push(e);n.memory.experience.push({...clone(o.event),id:e.actionId});},
    target:(n,o)=>{o.experiment.targetId=o.event.details.action.targetId='object:999999';},
    time:(n,o)=>{o.experiment.at=o.event.at=n.elapsed+1;},
    schema:(n,o)=>{o.event.details.result.ownHand.globalAbsence=true;},
    actor:(n)=>{n.id='mira';},
    memory:(n)=>{n.memory=clone(n.memory);},
    discovery:(n)=>{n.discovery=clone(n.discovery);},
    physiology:(n)=>{n.physiology=clone(n.physiology);},
  };
  for(const [name,change]of Object.entries(changes)){
    const f=heldFixture();const result=consumeAll(f),o=origin(f.n,result),old={memory:f.n.memory,discovery:f.n.discovery,physiology:f.n.physiology,id:f.n.id},events=[...f.n.memory.experience],experiments=[...f.n.discovery.experiments],eventCopy=clone(o.event),experimentCopy=clone(o.experiment);
    assert.equal(suspended(f.n,f.id),true,name);change(f.n,o);assert.equal(suspended(f.n,f.id),false,name);
    Object.assign(f.n,old);Object.assign(o.event,eventCopy);Object.assign(o.experiment,experimentCopy);f.n.memory.experience=events;f.n.discovery.experiments=experiments;
    assert.equal(suspended(f.n,f.id),false,`${name}: no historical resurrection`);
  }
});

test('strictly later firsthand sight clears, while saved, same-time and other-target sightings do not',()=>{
  const f=heldFixture();consumeAll(f);const n=f.n,o=clone(n.discovery.observations[f.id]);
  n.discovery.observations[f.id]={...o,observedAt:n.elapsed+1};assert.equal(suspended(n,f.id),true,'saved visual assignment is not a runtime sight');
  rememberDirectDiscoveryObject(n,o);assert.equal(suspended(n,f.id),true,'same timestamp is not later');
  n.elapsed++;rememberDirectDiscoveryObject(n,{...o,id:'object:999999'});assert.equal(suspended(n,f.id),true);
  rememberDirectDiscoveryObject(n,o);assert.equal(suspended(n,f.id),false);delete n.discovery.observations[f.id];assert.equal(suspended(n,f.id),false);
});

test('only valid later same-ID completion resolvers clear, never failed or other-target receipts',()=>{
  // Constructed resolver rows exercise the original linking seam, not physical
  // reappearance of consumed matter or an autonomous recovery claim.
  for(const type of ['grasp','inspect_object','release','sample']){
    const f=heldFixture();consumeAll(f);const n=f.n,old=origin(n),gut=pending(n);n.elapsed++;
    const code={grasp:'object_held',inspect_object:'OBJECT_OBSERVED',release:'object_released',sample:'SWALLOWED'}[type];
    const value={ok:true,code,durationSeconds:2,...(type==='grasp'?{materialId:f.id}:{}),...(type==='sample'?{ingestionId:'ingestion:999999'}:{})};
    learnOutcome(n,{type,targetId:'object:999998'},{...value,materialId:undefined,...(type==='sample'?{ingestionId:'ingestion:999998'}:{})},null,{...n.position});assert.equal(suspended(n,f.id),true,type);
    learnOutcome(n,{type,targetId:f.id},{...value,ok:false},null,{...n.position});assert.equal(suspended(n,f.id),true,type);
    learnOutcome(n,{type,targetId:f.id},value,null,{...n.position});assert.equal(suspended(n,f.id),false,type);
    n.discovery.experiments=n.discovery.experiments.filter(e=>e.id<=old.experiment.id);n.memory.experience=n.memory.experience.filter(e=>e.id<=old.event.id);
    assert.ok(n.memory.experience.includes(old.event));assert.deepEqual(pending(n),gut);assert.equal(suspended(n,f.id),false,'resolver retirement cannot expose an older negative');
  }
});

test('delayed own relief creates an exact-item lesson without reconstructing a cleared negative after owner retirement',()=>{
  const f=heldFixture();act(f,'release',f.id);act(f,'grasp',f.id);act(f,'sample',f.id);
  for(let i=0;i<1200&&!f.n.discovery.techniques.some(t=>t.sourceId===f.id);i++)tick(f);
  assert.ok(f.n.discovery.techniques.some(t=>t.sourceId===f.id));
  const result=consumeAll(f),n=f.n,o=origin(n,result),gut=pending(n),discoveries=n.discovery.foodDiscoveries;
  assert.equal(suspended(n,f.id),true);assert.ok(gut.some(p=>p.id===result.ingestionId));
  n.elapsed++;learnOutcome(n,{type:'inspect_object',targetId:f.id},{ok:true,code:'OBJECT_OBSERVED',durationSeconds:1.8},null,{...n.position});assert.equal(suspended(n,f.id),false);
  n.discovery.experiments=n.discovery.experiments.filter(e=>e.id<=o.experiment.id);n.memory.experience=n.memory.experience.filter(e=>e.id<=o.event.id);n.discovery.techniques=[];
  assert.ok(n.memory.experience.includes(o.event));assert.deepEqual(o.event.details.result.ownHand,expected(n,f.id,'not-held'));assert.deepEqual(pending(n),gut);
  for(let i=0;i<1200&&!n.discovery.techniques.some(t=>t.sourceId===f.id);i++)tick(f);
  assert.ok(n.discovery.foodDiscoveries>discoveries);assert.ok(n.discovery.techniques.some(t=>t.sourceId===f.id),'new recognition recreates optional technique from actual pending physiology');
  assert.ok(n.memory.experience.includes(o.event));assert.equal(suspended(n,f.id),false);assert.ok(n.discovery.effects.some(e=>e.objectId===f.id&&e.effect==='sustained'));
});

test('earned exact-item replay is suspended at admission and continuation without changing food evidence or pending identities',()=>{
  const f=earnedExact(),n=f.n,control=clone(n),t=n.discovery.techniques.find(t=>t.sourceId===f.id),evidence=clone(n.discovery),gut=pending(n);
  assert.equal(suspended(n,f.id),true);assert.equal(discoveryDecision(control).action.type,'grasp',JSON.stringify({choice:discoveryDecision(clone(n)),body:bodySignals(n),position:n.position,observation:n.discovery.observations[f.id]}));assert.equal(control.discovery.run?.techniqueId,t.id);
  const choice=discoveryDecision(n);assert.notDeepEqual(choice.action,{type:'grasp',targetId:f.id});assert.equal(n.discovery.run,null);
  assert.deepEqual(n.discovery.techniques,evidence.techniques);assert.deepEqual(n.discovery.effects,evidence.effects);assert.deepEqual(pending(n),gut);
  n.discovery.run={techniqueId:t.id,cursor:0,materialId:null,awaiting:false,startedAt:n.elapsed,preparation:{phase:'approach'}};
  discoveryDecision(n);assert.equal(n.discovery.run,null,'continuation/preparation must revalidate the live exact-ID gate');assert.deepEqual(n.discovery.techniques,evidence.techniques);
});

test('link-then-throw retains one genuine origin, but completion reentry cannot mint another',()=>{
  const f=finalReady();requestDiscoveryAction(f.n,{type:'sample',targetId:f.id},f.e);const active=f.n.active;let first;
  assert.throws(()=>tickDiscoveryAction(f.n,10,f.e,{complete(n,request,result){
    first=learnOutcome(n,request,result,null,{...n.position});assert.equal(tickDiscoveryAction(n,10,f.e),false);throw new Error('after original linking');
  }}),/after original linking/);
  assert.equal(suspended(f.n,f.id),true);assert.equal(f.n.memory.experience.filter(e=>e.id===first.id).length,1);
  f.n.active=active;assert.equal(tickDiscoveryAction(f.n,10,f.e),false);assert.equal(f.n.active,null);assert.equal(suspended(f.n,f.id),true);
});

test('throwing or cancelling exertion cannot emit own-hand data or a negative gate',()=>{
  for(const mode of ['throw','cancel','replace']){
    const f=finalReady();requestDiscoveryAction(f.n,{type:'sample',targetId:f.id},f.e);let result;
    const run=()=>tickDiscoveryAction(f.n,10,f.e,{exert(n,dt,effort){exertPhysiology(n,dt,effort);if(mode==='throw')throw Error('exert failed');if(mode==='cancel')cancelNpcAction(n);else n.active=clone(n.active);},complete(n,request,r){result=r;}});
    if(mode==='throw')assert.throws(run,/exert failed/);else run();assert.equal(result?.ownHand,undefined);assert.equal(suspended(f.n,f.id),false);assert.ok(lookupEcologyObject(f.e.ecology,f.id));
  }
});

test('own-hand suspension does not hide a separately earned producer lesson or change ablated and ordinary exploration choices',()=>{
  const f=heldFixture();act(f,'sample',f.id);act(f,'release',f.id);act(f,'grasp',f.id);consumeAll(f);
  for(let i=0;i<1200&&(f.n.discovery.techniques.length<2||f.n.elapsed-(f.n.discovery.samplesPending[f.id]??-Infinity)<45);i++)tick(f);
  hungry(f.n);assert.ok(f.n.discovery.techniques.some(t=>t.sourceId===f.id&&t.steps[0].type==='grasp'));assert.ok(f.n.discovery.techniques.some(t=>t.sourceId===f.plant.id&&t.steps[0].type==='pull'));
  assert.equal(suspended(f.n,f.id),true);assert.deepEqual(discoveryDecision(f.n).action,{type:'pull',targetId:f.plant.id});
  f.n.discovery.run=null;const ablated=clone(f.n);assert.deepEqual(discoveryDecision(f.n,{foodLearning:false}),discoveryDecision(ablated,{foodLearning:false}));assert.equal(f.n.rng,ablated.rng);
  f.n.discovery.techniques=[];f.n.discovery.run=null;const ordinary=clone(f.n);assert.deepEqual(discoveryDecision(f.n),discoveryDecision(ordinary));assert.equal(f.n.rng,ordinary.rng);
});

import { certifyNativeOwnHand, recordOwnHandResolution, retireNativeOwnHand } from '../src/own-hand-memory.js';
import { actionReceipt } from './fixtures/discovery-candidates/contract-actor.mjs';
function syntheticGates(count){
  // Synthetic bounded-ledger contract input only, never a learning trajectory.
  const n=createNpc({mode:'discovery'});n.elapsed=1000;
  for(let i=1;i<=count;i++){
    const targetId=`object:${i}`,e={id:i,actionId:i,at:i,primitive:'sample',targetId,ok:true,code:'SWALLOWED',durationSeconds:3.5,ingestionId:`ingestion:${i}`},event=actionReceipt(e),hand=expected(n,targetId,'not-held');
    n.elapsed=i;event.details.result.ownHand=hand;n.discovery.experiments.push(e);n.memory.experience.push(event);
    certifyNativeOwnHand(n,hand,{ingestionId:e.ingestionId,actionId:i,experimentId:i});recordOwnHandResolution(n,event.details.action,event.details.result,event,e);retireNativeOwnHand(hand);
  }
  n.elapsed=1000;n.discovery.nextId=count+1;n.memory.nextId=count+1;return n;
}

test('bounded runtime eviction means unknown, and old retained negative receipts never recreate evicted gates',()=>{
  const n=syntheticGates(OWN_HAND_LIMITS.gates+1),view=ownHandReplayView(n);
  assert.equal(view.suspended.size,128);assert.equal(view.suspended.has('object:1'),false);assert.equal(view.suspended.has('object:129'),true);
  assert.ok(n.memory.experience.find(e=>e.id===1).details.result.ownHand);assert.equal(ownHandReplayView(n).suspended.has('object:1'),false);
  assert.equal(ownHandReplayView(clone(n)).suspended.size,0);
  while(n.discovery.experiments.length<=OWN_HAND_LIMITS.experiments)n.discovery.experiments.push({...n.discovery.experiments.at(-1),id:n.discovery.nextId++,actionId:n.memory.nextId++});
  assert.equal(ownHandReplayView(n).suspended.size,0);n.discovery.experiments=n.discovery.experiments.slice(0,128);assert.equal(ownHandReplayView(n).suspended.size,0);
});

import { recordDiscoveryReport } from '../src/discovery.js';
import { freshState } from '../src/world.js';
import { writeSave, loadSave } from '../src/save.js';
import { createOzarkState, writeOzarkSave, loadOzarkSave } from '../src/ozark-save.js';
import { bindOzarkWorldAgent } from '../src/ozark-agent-world.js';
import { geometry, act as ozarkAct, tick as ozarkTick, place } from './fixtures/capacity-preparation.mjs';

test('reported operation remains an unverified ordinary test, not a resolver or suppressed exact learned replay',()=>{
  const f=earnedExact();f.n.discovery.techniques=[];recordDiscoveryReport(f.n,`grasp ${f.id}`,{sourceId:'human'});
  assert.equal(suspended(f.n,f.id),true);assert.deepEqual(discoveryDecision(f.n).action,{type:'grasp',targetId:f.id});assert.equal(suspended(f.n,f.id),true);
});

test('legacy write/load preserves descriptive completion and pending physiology but never restores runtime gates or active witnesses',()=>{
  const f=heldFixture(),result=consumeAll(f),gut=pending(f.n),bytes=new Map(),disk={getItem:key=>bytes.get(key)??null,setItem:(key,value)=>bytes.set(key,value)};
  const state=freshState({connectedEcology:false});state.environment=f.e;state.elapsed=f.n.elapsed;state.agents[0]=state.npc=f.n;
  assert.equal(suspended(f.n,f.id),true);assert.equal(writeSave(disk,state),true);const loaded=loadSave(disk);assert.equal(loaded.blocked,false,loaded.error);
  const n=loaded.state.npc;assert.equal(suspended(n,f.id),false);assert.deepEqual(pending(n),gut);assert.deepEqual(origin(n,result).event.details.result.ownHand,result.ownHand);
  const active=heldFixture();requestNpcAction(active.n,{type:'sample',targetId:active.id},active.e);tick(active,.1);const command=active.n.active;
  const mid=freshState({connectedEcology:false});mid.environment=active.e;mid.elapsed=active.n.elapsed;mid.agents[0]=mid.npc=active.n;
  assert.equal(writeSave(disk,mid),true);const restart=loadSave(disk);assert.equal(restart.blocked,false);assert.equal(restart.state.npc.active,null);
  assert.equal(restart.state.npc.memory.experience.find(e=>e.details.result?.code==='RESTART_INTERRUPTED').details.result.ownHand,undefined);
  restart.state.npc.active=clone(command);tickNpc(restart.state.npc,10,restart.state.environment);assert.equal(restart.state.npc.lastResult.ownHand,undefined);assert.equal(suspended(restart.state.npc,active.id),false);
});

test('strict Ozark saves retain completed sensor bytes and physical pending identities while reload intentionally returns unknown',()=>{
  const state=createOzarkState(geometry);for(const n of state.agents)bindOzarkWorldAgent(n,geometry,state);
  const f={state,n:state.npc,e:state.environment},source=f.e.ecology.plants.find(p=>p.id==='object:683');ozarkTick(f,20);place(f,{x:source.position.x+20,y:source.position.y});hungry(f.n);
  assert.equal(ozarkAct(f,{type:'pull',targetId:source.id}).ok,true);const id=f.n.inventory.items[0];let result;
  for(let i=0;i<10&&f.n.inventory.items.includes(id);i++)result=ozarkAct(f,{type:'sample',targetId:id});assert.equal(result.ownHand.after,'not-held');assert.equal(suspended(f.n,id),true);
  const gut=pending(f.n),bytes=new Map(),disk={getItem:key=>bytes.get(key)??null,setItem:(key,value)=>bytes.set(key,value)};assert.equal(writeOzarkSave(disk,state,geometry),true,loadOzarkSave({getItem:()=>JSON.stringify({...state,npc:undefined})},geometry).error);
  let opened;for(let i=0;i<3;i++){opened=loadOzarkSave(disk,geometry);assert.equal(opened.blocked,false,opened.error);assert.deepEqual(origin(opened.state.npc,result).event.details.result.ownHand,result.ownHand);assert.deepEqual(pending(opened.state.npc),gut);assert.equal(suspended(opened.state.npc,id),false);assert.equal(writeOzarkSave(disk,opened.state,geometry),true);}
  const old=opened.state;delete origin(old.npc,result).event.details.result.ownHand;delete old.npc.lastResult.ownHand;assert.equal(writeOzarkSave(disk,old,geometry),true);const legacy=loadOzarkSave(disk,geometry);assert.equal(legacy.blocked,false);assert.equal(origin(legacy.state.npc,result).event.details.result.ownHand,undefined);assert.equal(suspended(legacy.state.npc,id),false);
});

test('later native partial or unknown sample clears permanently rather than searching back to old negative history',()=>{
  for(const unknown of [false,true]){
    const f=finalReady(),material=clone(lookupEcologyObject(f.e.ecology,f.id));consumeAll(f);const old=origin(f.n);assert.equal(suspended(f.n,f.id),true);
    // Deliberate counterfactual resolver fixture: reintroduce the same ID under
    // engine ownership solely to exercise a later native observation boundary.
    // This is not a possible natural recovery claim or conserved world trial.
    material.massGrams=60;material.heldBy=f.n.id;f.e.ecology.materials.push(material);f.n.inventory.items.push(f.id);
    assert.equal(requestNpcAction(f.n,{type:'sample',targetId:f.id},f.e).code,'ACTION_STARTED');if(unknown)f.n.active=clone(f.n.active);
    for(let i=0;f.n.active&&i<100;i++)tick(f);assert.equal(f.n.lastResult.code,'SWALLOWED');assert.equal(f.n.lastResult.ownHand?.after,unknown?undefined:'held');assert.equal(suspended(f.n,f.id),false);
    f.n.discovery.experiments=f.n.discovery.experiments.filter(e=>e.id<=old.experiment.id);f.n.memory.experience=f.n.memory.experience.filter(e=>e.id<=old.event.id);assert.equal(suspended(f.n,f.id),false);
  }
});

test('full-hand exact-item replay is blocked before any preparatory release despite retained legal donor handling',()=>{
  const f=earnedExact(),n=f.n;for(let i=0;i<4;i++){assert.equal(act(f,'pull').ok,true);const id=n.inventory.items.at(-1);assert.equal(act(f,'release',id).ok,true);assert.equal(act(f,'grasp',id).ok,true);}
  hungry(n);assert.equal(n.inventory.items.length,4);assert.equal(suspended(n,f.id),true);
  // Existing legacy local-footing seam; a controlled current sensory record,
  // not a policy geometry query or a claim about remembered remote safety.
  n.memory.cells['fixture-footing']={...n.position,scene:n.scene,terrain:'dry-ground',walkable:true,observedAt:n.elapsed};
  const control=clone(n),held=[...n.inventory.items],techniques=clone(n.discovery.techniques);assert.equal(discoveryDecision(control).action.type,'release');
  const decision=discoveryDecision(n);assert.notEqual(decision.action.type,'release');assert.equal(n.discovery.run,null);assert.deepEqual(n.inventory.items,held);assert.deepEqual(n.discovery.techniques,techniques);
});
