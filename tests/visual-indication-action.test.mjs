import test from 'node:test';
import assert from 'node:assert/strict';
import {createOzarkState,writeOzarkSave,loadOzarkSave} from '../src/ozark-save.js';
import {createOzarkWorldGeometry} from '../src/ozark-world-geometry.js';
import {bindOzarkWorldAgent} from '../src/ozark-agent-world.js';
import {requestNpcAction,requestNpcIndication,tickNpc,observeNpc,cancelNpcAction} from '../src/npc.js';
import {createIndicationPermit,createListenerResponsePermit,retireIndicationPermit,publicIndicationGeometry,discoveryActionCompletion,discoveryActionPaidSeconds,successfulDiscoveryActionCompletion,tickDiscoveryAction} from '../src/discovery-actions.js';
import {npcEffortCost} from '../src/npc-effort-funding.js';
import {exertPhysiology} from '../src/biology.js';
import {lookupEcologyObject} from '../src/ecology.js';
import {senseReferenceObjects} from '../src/visual-reference-perception.js';
const geometry=createOzarkWorldGeometry();
function fixture(){
  const state=createOzarkState(geometry),[sender,receiver]=state.agents,environment=state.environment;
  for(const n of state.agents){bindOzarkWorldAgent(n,geometry,state);observeNpc(n,environment);}
  const targetId=Object.keys(sender.discovery.observations).find(id=>receiver.discovery.observations[id]&&Math.hypot(lookupEcologyObject(environment.ecology,id).position.x-sender.position.x,lookupEcologyObject(environment.ecology,id).position.y-sender.position.y)>24);
  assert.ok(targetId);
  const advance=(n,seconds)=>{for(let i=0;i<Math.ceil(seconds*10);i++)tickNpc(n,.1,environment);};
  function permit(){
    assert.equal(requestNpcAction(receiver,{type:'inspect_object',targetId},environment).code,'ACTION_STARTED');
    const selected=receiver.active;advance(receiver,2);assert.equal(receiver.lastResult.ok,true);
    return {permit:createIndicationPermit(sender,receiver,selected,targetId),selected};
  }
  return {state,sender,receiver,environment,targetId,advance,permit};
}
test('indication requires successful paid post-choice authority and is not a raw primitive',()=>{
  const f=fixture();
  assert.equal(createIndicationPermit(f.sender,f.receiver,{},f.targetId),null);
  assert.equal(requestNpcAction(f.sender,{type:'indicate_object',targetId:f.targetId},f.environment).ok,false);
  assert.equal(requestNpcIndication(f.sender,{},f.environment).code,'INVALID_INDICATION_PERMIT');
  requestNpcAction(f.receiver,{type:'inspect_object',targetId:f.targetId},f.environment);const active=f.receiver.active;
  assert.equal(createIndicationPermit(f.sender,f.receiver,active,f.targetId),null);
  f.advance(f.receiver,.2);cancelNpcAction(f.receiver);
  assert.equal(createIndicationPermit(f.sender,f.receiver,active,f.targetId),null);
});
test('canonical indication pays fixed duration and emits only copied fixed-length physical geometry',()=>{
  const f=fixture(),{permit,selected}=f.permit(),seen=[];
  assert.ok(permit);assert.equal(createIndicationPermit(f.sender,f.receiver,selected,f.targetId),null);
  assert.equal(requestNpcIndication(f.sender,{...permit},f.environment).ok,false);
  const inventory=structuredClone(f.sender.inventory),experiments=f.sender.discovery.experiments.length;
  assert.equal(requestNpcIndication(f.sender,permit,f.environment,{onPaid:event=>{seen.push(event);assert.deepEqual(event.geometry,publicIndicationGeometry(f.sender));}}).code,'ACTION_STARTED');
  const active=f.sender.active;assert.equal(active.seconds,1.8);assert.equal(publicIndicationGeometry(f.sender),null);
  f.advance(f.sender,2);
  assert.equal(f.sender.lastResult.code,'OBJECT_INDICATED');
  assert.ok(Math.abs(discoveryActionCompletion(f.sender,active).worked-1.8)<1e-8);
  assert.ok(Math.abs(seen.reduce((sum,e)=>sum+e.paidSeconds,0)-1.8)<1e-8);
  assert.deepEqual(Object.keys(seen[0].geometry).sort(),['origin','progress','scene','tip']);
  for(const {geometry:g} of seen){assert.ok(Math.abs(Math.hypot(g.tip.x-g.origin.x,g.tip.y-g.origin.y)-24)<1e-8);assert.ok(Object.isFrozen(g)&&Object.isFrozen(g.origin)&&Object.isFrozen(g.tip));}
  assert.deepEqual(f.sender.inventory,inventory);assert.equal(f.sender.discovery.experiments.length,experiments);
  assert.equal(publicIndicationGeometry(f.sender),null);assert.equal(requestNpcIndication(f.sender,permit,f.environment).ok,false);
});
test('interruption preserves partial paid cost but retires pose, copied and original active commands',()=>{
  const f=fixture(),{permit}=f.permit();requestNpcIndication(f.sender,permit,f.environment);const active=f.sender.active;
  f.advance(f.sender,.3);assert.ok(publicIndicationGeometry(f.sender));cancelNpcAction(f.sender,'PRIORITY_CHANGED');
  assert.ok(Math.abs(f.sender.lastResult.durationSeconds-.3)<1e-8);assert.equal(publicIndicationGeometry(f.sender),null);
  f.sender.active=structuredClone(active);f.advance(f.sender,.1);assert.equal(f.sender.active,null);
  f.sender.active=active;f.advance(f.sender,.1);assert.equal(f.sender.active,null);
  assert.equal(discoveryActionCompletion(f.sender,active),null);
});
test('moving target or actor and changing target metadata cannot redirect an authenticated pose',()=>{
  for(const change of ['target','actor','request']){
    const f=fixture(),{permit}=f.permit();requestNpcIndication(f.sender,permit,f.environment);f.advance(f.sender,.1);
    if(change==='target')lookupEcologyObject(f.environment.ecology,f.targetId).position.x+=1;
    if(change==='actor')f.sender.position.x+=1;
    if(change==='request')f.sender.active.request.targetId='object:999999';
    assert.equal(publicIndicationGeometry(f.sender),null);f.advance(f.sender,.1);
    assert.equal(f.sender.lastResult.code,'INDICATION_INTERRUPTED');assert.equal(f.sender.active,null);
  }
});
test('onPaid cancellation and observer exceptions never create a successful indication',()=>{
  for(const throwing of [false,true]){
    const f=fixture(),{permit}=f.permit();let calls=0;
    requestNpcIndication(f.sender,permit,f.environment,{onPaid(){calls++;if(throwing)throw Error('observer');cancelNpcAction(f.sender,'PRIORITY_CHANGED');}});const active=f.sender.active;
    if(throwing)assert.throws(()=>f.advance(f.sender,.1),/observer/);else f.advance(f.sender,.1);
    assert.equal(calls,1);assert.equal(f.sender.lastResult.ok,false);assert.equal(publicIndicationGeometry(f.sender),null);
    assert.equal(f.sender.active,null);assert.ok(discoveryActionPaidSeconds(f.sender,active)<=.1+1e-8);
  }
});
test('epoch replacement and elapsed permits cannot authorize a gesture',()=>{
  for(const change of ['sender','receiver','elapsed']){
    const f=fixture(),{permit}=f.permit();
    if(change==='elapsed')f.sender.elapsed+=13;else f[change].epoch++;
    assert.equal(requestNpcIndication(f.sender,permit,f.environment).code,'INDICATION_INTERRUPTED');assert.equal(f.sender.active,null);
  }
});
test('ordinary save/reopen preserves inert indication history but never paid pose or permit authority',()=>{
  const f=fixture(),{permit}=f.permit(),values=new Map(),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
  requestNpcIndication(f.sender,permit,f.environment);const active=f.sender.active;f.advance(f.sender,2);
  f.state.elapsed=Math.max(...f.state.agents.map(n=>n.elapsed));f.environment.elapsed=f.state.elapsed;f.environment.ecology.elapsed=f.state.elapsed;

  assert.equal(writeOzarkSave(storage,f.state,geometry),true);
  const restored=loadOzarkSave(storage,geometry);assert.equal(restored.blocked,false);
  const [sender,receiver]=restored.state.agents;
  assert.equal(sender.active,null);assert.equal(publicIndicationGeometry(sender),null);
  assert.equal(createIndicationPermit(sender,receiver,active,f.targetId),null);
  assert.equal(requestNpcIndication(sender,permit,restored.state.environment).ok,false);
  assert.equal(sender.memory.experience.some(e=>e.details?.action?.type==='indicate_object'),true);
});

test('full paid work with failed final physical validation never produces successful completion proof',()=>{
  const f=fixture(),{permit}=f.permit();
  requestNpcIndication(f.sender,permit,f.environment,{onPaid({geometry:g}){if(g.progress>=1-1e-8)lookupEcologyObject(f.environment.ecology,f.targetId).position.x+=1;}});
  const active=f.sender.active;f.advance(f.sender,2);
  assert.ok(Math.abs(discoveryActionCompletion(f.sender,active).worked-1.8)<1e-8);
  assert.equal(f.sender.lastResult.ok,false);assert.equal(successfulDiscoveryActionCompletion(f.sender,active),null);
  assert.equal(successfulDiscoveryActionCompletion(f.receiver,active),null);
});

test('gesture uses .25 funded effort and unfunded slices cannot create visible pose or observation',()=>{
  for(const funded of [true,false]){
    const f=fixture(),{permit}=f.permit();let observed=0,charged=0;
    requestNpcIndication(f.sender,permit,f.environment,{onPaid(){observed++;}});const active=f.sender.active;
    if(!funded){Object.assign(f.sender.physiology,{availableEnergyKcal:0,storedEnergyKcal:0});f.sender.physiology.stomach=[];}
    tickDiscoveryAction(f.sender,.1,f.environment,{exert(n,seconds,effort){charged++;assert.equal(effort,.25);exertPhysiology(n,seconds,effort);}});
    assert.equal(observed,funded?1:0);assert.equal(charged,funded?1:0);
    assert.equal(!!publicIndicationGeometry(f.sender),funded);
    assert.ok(Math.abs(discoveryActionPaidSeconds(f.sender,active)-(funded?.1:0))<1e-8);
    cancelNpcAction(f.sender);
  }
});
test('saving a live paid gesture cannot restore an active pose, listener proof or permit',()=>{
  const f=fixture(),{permit}=f.permit(),values=new Map(),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
  f.advance(f.sender,2);requestNpcIndication(f.sender,permit,f.environment);const original=f.sender.active;f.advance(f.sender,.2);f.advance(f.receiver,.2);
  f.state.elapsed=Math.max(...f.state.agents.map(n=>n.elapsed));f.environment.elapsed=f.state.elapsed;f.environment.ecology.elapsed=f.state.elapsed;
  assert.ok(publicIndicationGeometry(f.sender));

  assert.equal(writeOzarkSave(storage,f.state,geometry),true);
  const loaded=loadOzarkSave(storage,geometry);assert.equal(loaded.blocked,false);
  assert.equal(loaded.state.agents[0].active,null);assert.equal(publicIndicationGeometry(loaded.state.agents[0]),null);
  assert.equal(successfulDiscoveryActionCompletion(loaded.state.agents[0],original),null);
  assert.equal(requestNpcIndication(loaded.state.agents[0],permit,loaded.state.environment).ok,false);
});

test('completion callback reset cannot certify old paid work for a replacement identity',()=>{
  for(const field of ['epoch','discovery','physiology']){
    const f=fixture();requestNpcAction(f.receiver,{type:'inspect_object',targetId:f.targetId},f.environment);const active=f.receiver.active;
    tickDiscoveryAction(f.receiver,active.seconds,f.environment,{complete(n){if(field==='epoch')n.epoch++;else n[field]=structuredClone(n[field]);n.active=null;return {eventId:99,ok:true};}});
    assert.equal(createIndicationPermit(f.sender,f.receiver,active,f.targetId),null);
    assert.equal(successfulDiscoveryActionCompletion(f.receiver,active),null);
  }
});

test('paid observations use current step endpoints and expose partial funding without inferred past sight',()=>{
  const f=fixture(),{permit}=f.permit(),events=[];
  requestNpcIndication(f.sender,permit,f.environment,{onPaid:e=>events.push(e)});
  for(let i=0;i<8;i++)tickNpc(f.sender,.25,f.environment);
  assert.equal(events.length,8);
  for(let i=0;i<events.length;i++){assert.equal(events[i].at,(i+1)*.25);assert.equal(events[i].stepSeconds,.25);}
  assert.ok(Math.abs(events.at(-1).paidSeconds-.05)<1e-8);
  assert.equal(events.at(-1).at,2,'final partial work does not backdate the observed world state');
  assert.ok(events.at(-1).stepSeconds-events.at(-1).paidSeconds>.19);
  const g=fixture(),authorization=g.permit(),partial=[];
  requestNpcIndication(g.sender,authorization.permit,g.environment,{onPaid:e=>partial.push(e)});
  Object.assign(g.sender.physiology,{availableEnergyKcal:npcEffortCost(.1,.25),storedEnergyKcal:0});g.sender.physiology.stomach=[];
  g.sender.elapsed+=.25;tickDiscoveryAction(g.sender,.25,g.environment);
  g.sender.physiology.availableEnergyKcal=1;g.sender.elapsed+=.25;tickDiscoveryAction(g.sender,.25,g.environment);
  assert.equal(partial.length,2);assert.equal(partial[0].at,.25);assert.equal(partial[1].at,.5);
  assert.equal(partial[0].stepSeconds,.25);assert.ok(Math.abs(partial[0].paidSeconds-.1)<1e-8);
  assert.ok(partial[0].stepSeconds-partial[0].paidSeconds>.14,'partial funding is explicit and cannot certify whole-step sight');
  assert.ok(Math.abs(partial[1].paidSeconds-partial[1].stepSeconds)<1e-8);
  cancelNpcAction(g.sender);
  const h=fixture(),auth=h.permit(),fixed=[];
  requestNpcIndication(h.sender,auth.permit,h.environment,{onPaid:e=>fixed.push(e)});
  for(let i=0;i<108;i++)tickNpc(h.sender,1/60,h.environment);
  assert.equal(h.sender.lastResult.code,'OBJECT_INDICATED');assert.equal(fixed.length,108);
  for(const e of fixed){assert.ok(Math.abs(e.paidSeconds-e.stepSeconds)<1e-8);assert.equal(e.stepSeconds,1/60);}
});

function completedDemonstration(f,demonstratedId=f.targetId){
  assert.equal(requestNpcAction(f.receiver,{type:'inspect_object',targetId:f.targetId},f.environment).code,'ACTION_STARTED');
  const inspection=f.receiver.active;
  f.advance(f.receiver,2);
  assert.ok(successfulDiscoveryActionCompletion(f.receiver,inspection));
  const permit=createIndicationPermit(f.sender,f.receiver,inspection,demonstratedId);
  assert.ok(permit);
  assert.equal(requestNpcIndication(f.sender,permit,f.environment).code,'ACTION_STARTED');
  const demonstration=f.sender.active;
  f.advance(f.sender,2);
  assert.ok(successfulDiscoveryActionCompletion(f.sender,demonstration));
  return {inspection,demonstration};
}

test('listener response needs the linked, completed paid demonstration and its own one-use permit',()=>{
  const f=fixture();
  assert.equal(createListenerResponsePermit(f.receiver,f.sender,{}),null);
  assert.equal(requestNpcAction(f.receiver,{type:'inspect_object',targetId:f.targetId},f.environment).code,'ACTION_STARTED');
  const inspection=f.receiver.active;
  f.advance(f.receiver,2);
  const correction=createIndicationPermit(f.sender,f.receiver,inspection,f.targetId);
  assert.ok(correction);
  assert.equal(requestNpcIndication(f.sender,correction,f.environment).code,'ACTION_STARTED');
  const demonstration=f.sender.active;
  assert.equal(createListenerResponsePermit(f.receiver,f.sender,demonstration),null,'Unfinished demonstration has no response authority');
  f.advance(f.sender,2);
  const response=createListenerResponsePermit(f.receiver,f.sender,demonstration);
  assert.ok(response);
  assert.equal(createListenerResponsePermit(f.receiver,f.sender,demonstration),null,'One demonstration issues one response permit');
  assert.equal(requestNpcIndication(f.sender,response,f.environment).code,'INVALID_INDICATION_PERMIT','The speaker cannot use the listener permit');
  assert.equal(requestNpcIndication(f.receiver,{...response},f.environment).code,'INVALID_INDICATION_PERMIT','Copied authority is inert');
  assert.equal(requestNpcIndication(f.receiver,response,f.environment).code,'ACTION_STARTED');
  const active=f.receiver.active;
  assert.equal(active.request.type,'indicate_object');
  assert.equal(active.request.targetId,f.targetId,'The response points to the listener inspected object');
  assert.equal(active.seconds,1.8);
  assert.equal(publicIndicationGeometry(f.receiver),null,'Unpaid response has no public pose');
  f.advance(f.receiver,2);
  assert.equal(f.receiver.lastResult.code,'OBJECT_INDICATED');
  assert.ok(Math.abs(successfulDiscoveryActionCompletion(f.receiver,active).worked-1.8)<1e-8);
  assert.equal(publicIndicationGeometry(f.receiver),null);
  assert.equal(requestNpcIndication(f.receiver,response,f.environment).code,'INVALID_INDICATION_PERMIT');
});

test('listener response uses its inspected referent even when the sender demonstrated another object',()=>{
  const f=fixture();
  const common=senseReferenceObjects(f.receiver,f.state).bindings;
  const other=common.find(id=>id!==f.targetId&&f.sender.discovery.observations[id]&&
    Math.hypot(lookupEcologyObject(f.environment.ecology,id).position.x-f.sender.position.x,
      lookupEcologyObject(f.environment.ecology,id).position.y-f.sender.position.y)<=400);
  assert.ok(other,'Expected a second mutually observed local object');
  const {demonstration}=completedDemonstration(f,other);
  const response=createListenerResponsePermit(f.receiver,f.sender,demonstration);
  assert.ok(response);
  assert.equal(requestNpcIndication(f.receiver,response,f.environment).code,'ACTION_STARTED');
  assert.equal(f.receiver.active.request.targetId,f.targetId,'The listener response follows its own canonical inspection');
  cancelNpcAction(f.receiver,'TEST_END');
});

test('interrupted, stale or reopened demonstrations cannot issue a listener response',()=>{
  for(const change of ['cancel','epoch','discovery','physiology','reopen']){
    const f=fixture();
    assert.equal(requestNpcAction(f.receiver,{type:'inspect_object',targetId:f.targetId},f.environment).code,'ACTION_STARTED');
    const inspection=f.receiver.active;f.advance(f.receiver,2);
    const correction=createIndicationPermit(f.sender,f.receiver,inspection,f.targetId);
    assert.equal(requestNpcIndication(f.sender,correction,f.environment).code,'ACTION_STARTED');
    const demonstration=f.sender.active;
    if(change==='cancel'){
      f.advance(f.sender,.3);cancelNpcAction(f.sender,'TEST_INTERRUPTION');
      assert.equal(createListenerResponsePermit(f.receiver,f.sender,demonstration),null);
      continue;
    }
    f.advance(f.sender,2);
    if(change==='epoch')f.receiver.epoch++;
    if(change==='discovery')f.receiver.discovery=structuredClone(f.receiver.discovery);
    if(change==='physiology')f.receiver.physiology=structuredClone(f.receiver.physiology);
    if(change==='reopen'){
      const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
      f.state.elapsed=Math.max(...f.state.agents.map(n=>n.elapsed));
      f.environment.elapsed=f.state.elapsed;f.environment.ecology.elapsed=f.state.elapsed;
      assert.equal(writeOzarkSave(storage,f.state,geometry),true);
      const loaded=loadOzarkSave(storage,geometry);
      assert.equal(loaded.blocked,false);
      const [sender,listener]=loaded.state.agents;
      assert.equal(createListenerResponsePermit(listener,sender,demonstration),null);
      continue;
    }
    assert.equal(createListenerResponsePermit(f.receiver,f.sender,demonstration),null,change+' must retire the original actor provenance');
  }
});

test('listener response pays normal indication effort and partial work cannot complete it',()=>{
  const f=fixture(),{demonstration}=completedDemonstration(f);
  const response=createListenerResponsePermit(f.receiver,f.sender,demonstration);
  assert.ok(response);
  let charged=0,observed=0;
  assert.equal(requestNpcIndication(f.receiver,response,f.environment,{onPaid(){observed++;}}).code,'ACTION_STARTED');
  const active=f.receiver.active;
  tickDiscoveryAction(f.receiver,.1,f.environment,{exert(n,seconds,effort){charged++;assert.equal(effort,.25);exertPhysiology(n,seconds,effort);}});
  assert.equal(charged,1);assert.equal(observed,1);
  assert.ok(publicIndicationGeometry(f.receiver));
  assert.ok(discoveryActionPaidSeconds(f.receiver,active)>0);
  cancelNpcAction(f.receiver,'TEST_INTERRUPTION');
  assert.equal(successfulDiscoveryActionCompletion(f.receiver,active),null);
  assert.equal(publicIndicationGeometry(f.receiver),null);
  assert.equal(requestNpcIndication(f.receiver,response,f.environment).code,'INVALID_INDICATION_PERMIT');
});

test('listener response permit requires peer visibility at issuance and request',()=>{
  const f=fixture(),{demonstration}=completedDemonstration(f);
  const original={...f.receiver.position};
  f.receiver.position.x+=300;
  assert.equal(createListenerResponsePermit(f.receiver,f.sender,demonstration),null,
    'An out-of-range listener cannot mint response authority');
  Object.assign(f.receiver.position,original);
  const response=createListenerResponsePermit(f.receiver,f.sender,demonstration);
  assert.ok(response,'Visibility restoration permits the still-live completed chain');
  f.sender.position.x+=300;
  assert.equal(requestNpcIndication(f.receiver,response,f.environment).code,'INDICATION_INTERRUPTED',
    'Peer visibility is checked again when the physical gesture starts');
  f.sender.position.x-=300;
  assert.equal(requestNpcIndication(f.receiver,response,f.environment).code,'INVALID_INDICATION_PERMIT',
    'A rejected response permit cannot revive after the peer returns');
});

test('paid response pose disappears if its peer leaves sight, and revocation retires unused authority',()=>{
  const f=fixture(),{demonstration}=completedDemonstration(f);
  const response=createListenerResponsePermit(f.receiver,f.sender,demonstration);
  assert.ok(response);
  assert.equal(requestNpcIndication(f.receiver,response,f.environment).code,'ACTION_STARTED');
  const active=f.receiver.active;
  f.advance(f.receiver,.2);
  assert.ok(publicIndicationGeometry(f.receiver));
  f.sender.position.x+=300;
  assert.equal(publicIndicationGeometry(f.receiver),null);
  f.advance(f.receiver,.1);
  assert.equal(f.receiver.lastResult.code,'INDICATION_INTERRUPTED');
  assert.equal(successfulDiscoveryActionCompletion(f.receiver,active),null);
  f.sender.position.x-=300;
  assert.equal(publicIndicationGeometry(f.receiver),null);
  const g=fixture(),proof=completedDemonstration(g),unused=createListenerResponsePermit(g.receiver,g.sender,proof.demonstration);
  assert.ok(unused);
  retireIndicationPermit(unused);
  assert.equal(requestNpcIndication(g.receiver,unused,g.environment).code,'INVALID_INDICATION_PERMIT',
    'Cancelling a session retires even its never-started reply permit');
});

test('a fresh demonstration cannot revive an inspection after its original choice deadline',()=>{
  const f=fixture(),{permit}=f.permit();
  // Direct action-unit clocks place a genuine later demonstration near the
  // original inspection deadline. The demonstration itself remains fresh.
  f.advance(f.sender,10);
  assert.equal(requestNpcIndication(f.sender,permit,f.environment).code,'ACTION_STARTED');
  const demonstration=f.sender.active;
  f.advance(f.sender,2);
  assert.ok(successfulDiscoveryActionCompletion(f.sender,demonstration));
  f.advance(f.receiver,13);
  assert.equal(createListenerResponsePermit(f.receiver,f.sender,demonstration),null,
    'The old inspected choice cannot gain a fresh reply right from a later paid cue');
});
