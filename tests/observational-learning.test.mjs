import test from 'node:test';
import assert from 'node:assert/strict';
import modelProvider from '../desktop/model-provider.cjs';
import { decisionObservation } from '../src/controller.js';
import { beginSleep } from '../src/biology.js';
import { subscribeConsumption, consumptionDeliveryDiagnostic } from '../src/consumption-events.js';
import { CONFIG } from '../src/config.js';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { createOzarkState, writeOzarkSave, loadOzarkSave, OZARK_SAVE_KEY } from '../src/ozark-save.js';
import { bindOzarkWorldAgent } from '../src/ozark-agent-world.js';
import { PopulationRuntime } from '../src/population.js';
import { observeNpc, requestNpcAction, tickNpc } from '../src/npc.js';
import { discoveryDecision, processDiscoveryFeedback } from '../src/discovery.js';
import { observationalInquiries } from '../src/observational-learning.js';
import { retainedProofIntegrityError } from '../src/proof-retention.js';
import { retireInquiries } from '../src/observational-inquiry-state.js';
import { tickOzarkEcology } from '../src/ozark-ecology.js';
import { lookupEcologyObject } from '../src/ecology.js';

const geometry=createOzarkWorldGeometry();
function fixture(){
  let visible=true;
  const g=Object.freeze({...geometry,lineOfSight:(...args)=>visible&&geometry.lineOfSight(...args)});
  const state=createOzarkState(g),[a,b]=state.agents,e=state.environment;
  const source=e.ecology.plants.find(p=>p.kind==='apple_tree'&&p.quantity>2&&geometry.canOccupy(p.position.x+45,p.position.y,CONFIG.playerRadius));
  state.elapsed=e.elapsed=e.ecology.elapsed=60;
  for(const n of [a,b]){n.elapsed=60;n.position={x:source.position.x+45,y:source.position.y};bindOzarkWorldAgent(n,g,state);observeNpc(n,e);}
  const runtime=new PopulationRuntime(state,{cardinal:false});
  function advance(seconds){for(let t=0;t<seconds-1e-8;t+=.1){e.elapsed+=.1;state.elapsed=e.elapsed;e.ecology.elapsed=e.elapsed;for(const n of state.agents)tickNpc(n,.1,e);}}
  function finish(n,action){const result=requestNpcAction(n,action,e);if(result.code==='ACTION_STARTED')for(let i=0;n.active&&i<100;i++)advance(.1);return n.lastResult||result;}
  finish(a,{type:'pull',targetId:source.id});const item=a.inventory.items[0];assert.ok(item);
  return {state,a,b,e,runtime,source,item,advance,finish,setVisible:v=>visible=v};
}
const disk=()=>{const map=new Map();return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};};

test('witnessed real sample is uncertain; exact released remainder drives ordinary paid experiment and personal delayed revision',()=>{
  const f=fixture(),{a,b,item}=f;
  assert.equal(f.finish(a,{type:'sample',targetId:item}).ok,true);
  let q=observationalInquiries(b)[0];assert.equal(q.sourceId,item);assert.equal(q.actorId,a.id);assert.equal(q.status,'uncertain');
  assert.equal(b.discovery.effects.length,0);assert.equal(b.discovery.techniques.length,0);assert.equal(b.discovery.reports.length,0);
  assert.equal(q.at<=b.elapsed,true);
  const before=structuredClone(b.discovery.inquiries);observationalInquiries(b);assert.deepEqual(b.discovery.inquiries,before);
  // A held witnessed source is not permission to take it. Only release and a
  // subsequent genuine local sighting make the acquisition eligible.
  observeNpc(b,f.e);assert.notDeepEqual(discoveryDecision(b).action,{type:'grasp',targetId:item});
  assert.equal(f.finish(a,{type:'release',targetId:item}).ok,true);observeNpc(b,f.e);
  let decision=discoveryDecision(b);assert.deepEqual(decision.action,{type:'grasp',targetId:item});
  assert.equal(f.finish(b,decision.action).ok,true);assert.ok(b.discovery.experiments.at(-1).durationSeconds>0);
  decision=discoveryDecision(b);assert.deepEqual(decision.action,{type:'sample',targetId:item});
  assert.equal(f.finish(b,decision.action).ok,true);q=observationalInquiries(b)[0];assert.equal(q.status,'waiting');
  assert.equal(q.ownEffects.length,0);assert.equal(b.discovery.techniques.length,0);
  f.advance(100);processDiscoveryFeedback(b);q=observationalInquiries(b)[0];assert.equal(q.status,'supported');assert.ok(q.ownEffects.every(e=>e.source==='experienced'));
  assert.deepEqual(modelProvider.validateObservation(decisionObservation(b)).discovery.inquiries,observationalInquiries(b));
  assert.equal(retainedProofIntegrityError(b),null);
  const storage=disk();assert.equal(writeOzarkSave(storage,f.state,geometry),true);const loaded=loadOzarkSave(storage,geometry);assert.equal(loaded.blocked,false);assert.deepEqual(loaded.state.agents[1].discovery.inquiries,b.discovery.inquiries);
  f.runtime.dispose();
});

test('visibility and awake gates apply at consumption, no queue replays later; failed physical sampling emits nothing',()=>{
  for(const mode of ['occluded','asleep','physiological-sleep','far','failed']){
    const f=fixture();
    if(mode==='occluded')f.setVisible(false);
    if(mode==='asleep')f.b.lifecycle='COLLAPSED';
    if(mode==='physiological-sleep')beginSleep(f.b,{hours:8});
    if(mode==='far')f.b.position={x:f.a.position.x+1000,y:f.a.position.y};
    if(mode==='failed')f.finish(f.a,{type:'release',targetId:f.item});
    f.finish(f.a,{type:'sample',targetId:f.item});
    f.setVisible(true);f.b.lifecycle='AWAKE';f.b.position={...f.a.position};observeNpc(f.b,f.e);
    assert.equal(f.b.discovery.inquiries.length,0,mode);f.runtime.dispose();
  }
});

test('repeated genuine consumption does not refresh a question; malformed optional saves fail closed and legacy absence works',()=>{
  const f=fixture();f.finish(f.a,{type:'sample',targetId:f.item});const initial=structuredClone(f.b.discovery.inquiries);
  f.finish(f.a,{type:'sample',targetId:f.item});assert.deepEqual(f.b.discovery.inquiries,initial);
  const storage=disk();assert.equal(writeOzarkSave(storage,f.state,geometry),true);
  const raw=JSON.parse(storage.getItem(OZARK_SAVE_KEY));
  for(const mutate of [q=>q.at=f.b.elapsed+1,q=>q.extra=true,q=>q.attempts=[999999],q=>q.retired='yes',q=>q.sourcePosition.x=Infinity]){
    const bad=structuredClone(raw);mutate(bad.agents[1].discovery.inquiries[0]);const bytes=JSON.stringify(bad);storage.setItem(OZARK_SAVE_KEY,bytes);
    assert.equal(loadOzarkSave(storage,geometry).blocked,true);assert.equal(storage.getItem(OZARK_SAVE_KEY),bytes);
  }
  for(const n of raw.agents)delete n.discovery.inquiries;storage.setItem(OZARK_SAVE_KEY,JSON.stringify(raw));assert.equal(loadOzarkSave(storage,geometry).blocked,false);
  f.runtime.dispose();
});


test('real animal bite focuses exact source; a paid failed grasp only leads to bounded pull, never a food contradiction',()=>{
  const f=fixture(),fox=f.e.ecology.animals.find(a=>a.species==='fox');
  const plant=f.e.ecology.plants.find(p=>p.kind==='bramble'&&p.quantity>2&&geometry.canOccupy(p.position.x+45,p.position.y,CONFIG.playerRadius)&&geometry.lineOfSight({x:p.position.x+45,y:p.position.y},p.position));
  assert.ok(plant);fox.position={...plant.position};fox.homePosition={...plant.position};fox.physiology.hoursSinceMeal=12;fox.cooldownHours=0;fox.hydration=100;fox.sleepPressure=0;fox.fatigue=0;
  for(const n of [f.a,f.b])n.position={x:plant.position.x+45,y:plant.position.y};
  const quantity=plant.quantity;
  tickOzarkEcology(f.e.ecology,.5,f.e,[f.a,f.b],{},geometry);
  assert.ok(plant.quantity<quantity);const q=observationalInquiries(f.b).find(q=>q.sourceId===plant.id);assert.ok(q);assert.equal(q.actorId,fox.id);
  f.advance(.2);observeNpc(f.b,f.e);let decision=discoveryDecision(f.b);assert.deepEqual(decision.action,{type:'grasp',targetId:plant.id});
  assert.equal(f.finish(f.b,decision.action).ok,false);assert.equal(observationalInquiries(f.b).find(q=>q.sourceId===plant.id).status,'uncertain');
  observeNpc(f.b,f.e);decision=discoveryDecision(f.b);assert.deepEqual(decision.action,{type:'pull',targetId:plant.id});assert.equal(f.finish(f.b,decision.action).ok,true);
  decision=discoveryDecision(f.b);assert.equal(decision.action.type,'sample');assert.ok(f.b.inventory.items.includes(decision.action.targetId));assert.equal(f.finish(f.b,decision.action).ok,true);
  assert.equal(observationalInquiries(f.b).find(q=>q.sourceId===plant.id).status,'waiting');f.runtime.dispose();
});

test('real adverse personal feedback blocks later observed-source trial; inquiry links retire rather than replay when evidence is gone',()=>{
  const f=fixture();f.finish(f.a,{type:'sample',targetId:f.item});f.finish(f.a,{type:'release',targetId:f.item});observeNpc(f.b,f.e);
  f.finish(f.b,discoveryDecision(f.b).action);lookupEcologyObject(f.e.ecology,f.item).spoiled=true;
  f.finish(f.b,discoveryDecision(f.b).action);f.advance(100);processDiscoveryFeedback(f.b);
  assert.equal(observationalInquiries(f.b)[0].status,'contradicted');assert.equal(observationalInquiries(f.b)[0].priorAdverse,true);
  const before=structuredClone(f.b.discovery.inquiries);f.finish(f.b,{type:'release',targetId:f.item});f.finish(f.a,{type:'grasp',targetId:f.item});f.finish(f.a,{type:'sample',targetId:f.item});assert.deepEqual(f.b.discovery.inquiries,before);
  // Exercise bounded retirement directly against a copy of canonical ledgers,
  // not fake feedback: the retired marker grants no experience or action.
  const d=structuredClone(f.b.discovery);d.experiments=d.experiments.filter(e=>!d.inquiries[0].attempts.includes(e.id));retireInquiries(d);assert.equal(d.inquiries[0].retired,true);assert.deepEqual(d.inquiries[0].attempts,[]);
  f.runtime.dispose();
});


test('a broken observation listener cannot prevent a real eater receipt; prior personal adversity dominates later consumption cue',()=>{
  const f=fixture();
  const unsubscribe=subscribeConsumption(f.e.ecology,()=>{throw new Error('test observer fault');});
  // Recipient samples first, without ever observing anyone else consume.
  f.finish(f.a,{type:'release',targetId:f.item});observeNpc(f.b,f.e);f.finish(f.b,{type:'grasp',targetId:f.item});
  lookupEcologyObject(f.e.ecology,f.item).spoiled=true;
  assert.equal(f.finish(f.b,{type:'sample',targetId:f.item}).ok,true);
  assert.equal(consumptionDeliveryDiagnostic(f.e.ecology).code,'OBSERVER_FAILED');
  assert.ok(f.b.discovery.experiments.some(e=>e.primitive==='sample'&&e.ok));
  f.advance(100);processDiscoveryFeedback(f.b);assert.ok(f.b.discovery.effects.some(e=>e.effect==='discomfort'));
  assert.equal(f.b.discovery.inquiries.length,0);
  f.finish(f.b,{type:'release',targetId:f.item});observeNpc(f.a,f.e);f.finish(f.a,{type:'grasp',targetId:f.item});f.finish(f.a,{type:'sample',targetId:f.item});
  f.finish(f.a,{type:'release',targetId:f.item});observeNpc(f.b,f.e);
  assert.equal(observationalInquiries(f.b)[0].priorAdverse,true);
  assert.doesNotMatch(discoveryDecision(f.b).reason,/observed act is not proof/);
  unsubscribe();f.runtime.dispose();
});

test('urgent bodily care precedes observational experiment and pending attention expires without granting proof',()=>{
  const f=fixture();f.finish(f.a,{type:'sample',targetId:f.item});f.finish(f.a,{type:'release',targetId:f.item});observeNpc(f.b,f.e);
  f.b.physiology.stamina=5;
  assert.equal(discoveryDecision(f.b).action.type,'rest');assert.equal(f.b.discovery.inquiries[0].attempts.length,0);
  // Projection of an old unresolved observation is explicitly expired, never
  // a manufactured negative bodily finding or a new action.
  const copy=structuredClone(f.b);copy.elapsed+=301;
  const q=observationalInquiries(copy)[0];assert.equal(q.status,'expired');assert.equal(q.ownEffects.length,0);assert.match(q.deferredReason,/too old/);
  f.runtime.dispose();
});
