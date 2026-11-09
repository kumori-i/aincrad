import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { createOzarkState, writeOzarkSave, loadOzarkSave, getOzarkSaveValidationFailure } from '../src/ozark-save.js';
import { bindOzarkWorldAgent } from '../src/ozark-agent-world.js';
import { bindOzarkEcology } from '../src/ozark-ecology.js';
import { observeNpc, requestNpcAction, tickNpc, cancelNpcAction } from '../src/npc.js';
import { discoveryDecision, processDiscoveryFeedback } from '../src/discovery.js';
import { NpcController } from '../src/controller.js';
import { projectPhysiology } from '../src/biology.js';
import { bodySignals } from '../src/interoception.js';
import { lookupEcologyObject } from '../src/ecology.js';
import { learnedCapacityRelease } from '../src/learned-capacity-release.js';
import { retainedProofIntegrityError } from '../src/proof-retention.js';

const geometry = createOzarkWorldGeometry();
const clone = structuredClone;
const close = (a,b) => assert.ok(Math.abs(a-b)<1e-7, `${a} differs from ${b}`);
let prepared;

// Bounded authored encounter, not autonomous travel, a natural cohort or native
// persistence proof. Setup chooses two existing trees and legal local exposures,
// ages one detached portion to the existing spoiled state and supplies final
// appetite. No toxicity coefficient, action result or evidence is invented.
// Ecology is held static; both actor clocks, funded work and digestion advance.
function build() {
  const state = createOzarkState(geometry, {communicationSeed:211});
  state.elapsed = state.environment.elapsed = state.environment.ecology.elapsed = 60;
  for (const n of state.agents) {n.elapsed=60;bindOzarkWorldAgent(n,geometry,state);}
  const f = attach(state), trees=f.env.ecology.plants.filter(p=>p.kind==='apple_tree'&&p.quantity>5);
  outer: for (const a of trees) for (const b of trees) {
    const gap=Math.hypot(a.position.x-b.position.x,a.position.y-b.position.y);
    if(gap>120&&gap<260&&[a,b].every(p=>geometry.canOccupy(p.position.x+45,p.position.y,CONFIG.playerRadius)&&
      geometry.lineOfSight({x:p.position.x+45,y:p.position.y},p.position))) {
      f.goodId=a.id;f.badId=b.id;break outer;
    }
  }
  assert.ok(f.goodId);
  f.at(f.goodId);
  f.safeId=f.pay({type:'pull',targetId:f.goodId}).materialId;
  f.pay({type:'sample',targetId:f.safeId});
  f.until(()=>f.n.discovery.effects.some(e=>e.objectId===f.safeId&&e.effect==='sustained'));
  f.pay({type:'release',targetId:f.safeId});
  f.at(f.badId);
  f.harmId=f.pay({type:'pull',targetId:f.badId}).materialId;
  const aged=lookupEcologyObject(f.env.ecology,f.harmId);
  aged.spoiled=true;aged.ageHours=12*24;
  f.pay({type:'sample',targetId:f.harmId});
  f.until(()=>f.n.discovery.effects.some(e=>e.objectId===f.harmId&&e.effect==='discomfort'));
  for(let i=0;i<3;i++)f.pay({type:'pull',targetId:f.badId});
  f.at(f.goodId);f.appetite();
  assert.equal(f.n.inventory.items.length,4);
  assert.equal(retainedProofIntegrityError(f.n),null);
  return {state:clone(state),goodId:f.goodId,badId:f.badId,safeId:f.safeId,harmId:f.harmId};
}
function attach(state) {
  const n=state.agents[0],env=state.environment;
  bindOzarkEcology(env.ecology,geometry);
  for(const actor of state.agents)bindOzarkWorldAgent(actor,geometry,state);
  const clock=()=>{state.elapsed=env.elapsed=env.ecology.elapsed=env.elapsed+.1;};
  const tick=()=>{clock();for(const actor of state.agents)tickNpc(actor,.1,env);processDiscoveryFeedback(n);};
  const settle=()=>{for(let i=0;n.active&&i<400;i++)tick();assert.equal(n.active,null);return n.lastResult;};
  const pay=action=>{assert.equal(requestNpcAction(n,action,env).code,'ACTION_STARTED',JSON.stringify(action));const result=settle();assert.equal(result.ok,true,JSON.stringify(result));return result;};
  const until=predicate=>{for(let i=0;!predicate()&&i<1500;i++)tick();assert.ok(predicate(),'personal delayed effect is required');};
  const at=id=>{const p=lookupEcologyObject(env.ecology,id);n.position={x:p.position.x+45,y:p.position.y};observeNpc(n,env);};
  const appetite=(hours=20)=>{n.physiology.hoursSinceMeal=hours;n.physiology.satietyHours=0;n.physiology.waterDeficitMl=0;projectPhysiology(n);};
  return {state,n,env,clock,tick,settle,pay,until,at,appetite};
}
function fixture({tracked=false}={}) {
  prepared ||= build();
  // Most controls only need an identical in-memory evidence snapshot. The save
  // test retains a fresh state's tracking. Copies never restore action authority.
  const state=tracked?Object.assign(createOzarkState(geometry,{communicationSeed:211}),clone(prepared.state)):clone(prepared.state);
  const f={...attach(state),...Object.fromEntries(['goodId','badId','safeId','harmId'].map(k=>[k,prepared[k]]))};
  observeNpc(f.n,f.env);
  return f;
}
const candidates=f=>f.n.discovery.techniques.filter(t=>t.sourceId===f.goodId);
const release=f=>learnedCapacityRelease(f.n,candidates(f));
const harm=f=>f.n.discovery.effects.find(e=>e.objectId===f.harmId&&e.effect==='discomfort');
const foodRelease=decision=>decision.need==='food'&&decision.action?.type==='release';
function earnedAcquisition(f) {
  const experiment=f.n.discovery.experiments.find(e=>e.primitive==='pull'&&e.targetId===f.goodId);
  return {experiment,receipt:f.n.memory.experience.find(e=>e.id===experiment.actionId)};
}
function ordinaryChoice(f,controller) {
  for(let i=0;!f.n.active&&i<30;i++) {
    f.clock();
    for(const peer of f.state.agents)if(peer!==f.n)tickNpc(peer,.1,f.env);
    controller.tick(.1);
  }
  assert.ok(f.n.active,'ordinary controller should start a physical action');
  return clone(f.n.active.request);
}

test('ordinary full-hands controller pays one exact adverse release, then earned acquisition and an ordinary new sample',()=>{
  const f=fixture(),n=f.n,decisions=[];
  const physical=lookupEcologyObject(f.env.ecology,f.harmId),before={mass:physical.massGrams,energy:physical.energyKcal,water:physical.waterMl,cost:n.physiology.totals.metabolizedKcal};
  assert.equal(bodySignals(n).hunger,'ravenous');
  assert.deepEqual(release(f),{type:'release',targetId:f.harmId});
  const controller=new NpcController(n,{environment:f.env,experimentalDiscovery:{decision:(_n,result)=>decisions.push(clone(result))}});
  try {
    assert.deepEqual(ordinaryChoice(f,controller),{type:'release',targetId:f.harmId});
    assert.equal(decisions[0].need,'food');assert.equal(n.discovery.run,null);
    const released=f.settle();assert.equal(released.code,'object_released');
    assert.ok(released.durationSeconds>0);assert.ok(n.physiology.totals.metabolizedKcal>before.cost);
    assert.equal(physical.heldBy,null);assert.equal(n.inventory.items.length,3);
    close(physical.massGrams,before.mass);close(physical.energyKcal,before.energy);close(physical.waterMl,before.water);
    const good=lookupEcologyObject(f.env.ecology,f.goodId),stock=good.quantity;
    assert.deepEqual(ordinaryChoice(f,controller),{type:'pull',targetId:f.goodId});
    const acquired=f.settle();assert.equal(acquired.code,'piece_detached');assert.equal(good.quantity,stock-1);
    assert.equal(n.inventory.items.length,4);assert.ok(!n.discovery.effects.some(e=>e.objectId===acquired.materialId));
    assert.deepEqual(ordinaryChoice(f,controller),{type:'sample',targetId:acquired.materialId});
    const sampled=f.settle();assert.equal(sampled.code,'SWALLOWED');
    assert.ok(!n.discovery.effects.some(e=>e.ingestionId===sampled.ingestionId),'detachment and swallowing do not invent benefit');
    f.until(()=>n.discovery.effects.some(e=>e.ingestionId===sampled.ingestionId&&e.effect==='sustained'));
    assert.equal(retainedProofIntegrityError(n),null);
    assert.equal(decisions.filter(foodRelease).length,1);
  } finally {controller.dispose();}
});

test('helper is pure, drops only personally sampled adverse identity, and does not generalize to sibling pieces',()=>{
  const f=fixture(),before=JSON.stringify(f.n);
  assert.deepEqual(release(f),{type:'release',targetId:f.harmId});assert.equal(JSON.stringify(f.n),before);
  f.pay({type:'release',targetId:f.harmId});f.at(f.badId);f.pay({type:'pull',targetId:f.badId});f.at(f.goodId);
  assert.equal(f.n.inventory.items.length,4);assert.equal(release(f),null,'same-source caution is not direct held-item discard evidence');
});

test('release eligibility only vetoes personally proven identities and cannot authorize a sibling',()=>{
  const f=fixture(),before=JSON.stringify(f.n),checked=[];
  assert.equal(learnedCapacityRelease(f.n,candidates(f),{eligible:id=>{checked.push(id);return false;}}),null);
  assert.deepEqual(checked,[f.harmId],'unknown siblings are not offered as proven release candidates');
  assert.equal(learnedCapacityRelease(f.n,candidates(f),{eligible:id=>id!==f.harmId}),null);
  assert.equal(JSON.stringify(f.n),before);
});

for(const [name,mutate] of [
  ['missing sample experiment',f=>{const h=harm(f);f.n.discovery.experiments=f.n.discovery.experiments.filter(e=>e.actionId!==h.actionId);}],
  ['missing sample receipt',f=>{const h=harm(f);f.n.memory.experience=f.n.memory.experience.filter(e=>e.id!==h.actionId);}],
  ['evicted recognition receipt',f=>{const h=harm(f);f.n.memory.experience=f.n.memory.experience.filter(e=>e.id!==h.proofEventId);}],
  ['foreign effect provenance',f=>{harm(f).source='peer';}],
  ['borrowed isolated effect',f=>{f.n.discovery.effects=[clone(harm(f))];f.n.discovery.experiments=[];f.n.memory.experience=[];}],
  ['duplicate effect',f=>{f.n.discovery.effects.push(clone(harm(f)));}],
  ['duplicate recognition',f=>{f.n.memory.experience.push(clone(f.n.memory.experience.find(e=>e.id===harm(f).proofEventId)));}],
  ['duplicate sample',f=>{f.n.discovery.experiments.push(clone(f.n.discovery.experiments.find(e=>e.actionId===harm(f).actionId)));}],
  ['future feedback',f=>{harm(f).at=f.n.elapsed+1;}],
  ['zero paid sample',f=>{const h=harm(f);f.n.discovery.experiments.find(e=>e.actionId===h.actionId).durationSeconds=0;f.n.memory.experience.find(e=>e.id===h.actionId).details.result.durationSeconds=0;}],
  ['invented technique support',f=>{candidates(f)[0].evidence=[];}],
  ['unpaid acquisition',f=>{const {experiment:e,receipt:r}=earnedAcquisition(f);e.durationSeconds=r.details.result.durationSeconds=0;}],
  ['oversized acquisition duration',f=>{const {experiment:e,receipt:r}=earnedAcquisition(f);e.durationSeconds=r.details.result.durationSeconds=999;}],
  ['mismatched acquisition duration',f=>{earnedAcquisition(f).receipt.details.result.durationSeconds=.1;}],
  ['impossible acquisition success code',f=>{const {experiment:e,receipt:r}=earnedAcquisition(f);e.code=r.details.result.code='object_released';}],
  ['inverted acquisition receipt order',f=>{const {experiment:e,receipt:r}=earnedAcquisition(f);const id=Math.max(...f.n.memory.experience.map(row=>row.id))+1;e.actionId=r.id=id;}],
  ['overlapping paid acquisition and sample',f=>{const {experiment:e,receipt:r}=earnedAcquisition(f);const sample=f.n.discovery.experiments.find(row=>row.primitive==='sample'&&row.targetId===f.safeId);e.at=r.at=sample.at;}],
  ['missing positive recognition',f=>{const positive=f.n.discovery.effects.find(e=>e.objectId===f.safeId&&e.effect==='sustained');f.n.memory.experience=f.n.memory.experience.filter(e=>e.id!==positive.proofEventId);}],
])test(`capacity release fails closed for ${name}`,()=>{const f=fixture();mutate(f);assert.equal(release(f),null);});

test('a full inventory alone, absent appetite or an unavailable local earned source cannot authorize food release',()=>{
  for(const condition of ['no-technique','not-local','missing-view','stale-view','not-hungry','ablated']) {
    const f=fixture();
    if(condition==='no-technique')f.n.discovery.techniques=[];
    if(condition==='not-local')f.at(f.badId);
    if(condition==='missing-view')delete f.n.discovery.observations[f.goodId];
    if(condition==='stale-view')for(let i=0;i<90;i++)f.tick();
    if(condition==='not-hungry'){f.n.physiology.satietyHours=4;projectPhysiology(f.n);}
    const d=discoveryDecision(f.n,{foodLearning:condition!=='ablated'});
    assert.equal(foodRelease(d),false,condition);
  }
  const f=fixture();f.pay({type:'release',targetId:f.n.inventory.items.at(-1)});
  assert.equal(release(f),null);assert.equal(discoveryDecision(f.n).action.type,'pull');
});

test('usable held food wins over discarding an adverse item',()=>{
  const f=fixture();f.pay({type:'release',targetId:f.n.inventory.items.at(-1)});
  // The previously tolerated piece is physically still where it was dropped.
  observeNpc(f.n,f.env);f.pay({type:'grasp',targetId:f.safeId});f.appetite();
  assert.equal(f.n.inventory.items.length,4);
  assert.deepEqual(discoveryDecision(f.n).action,{type:'sample',targetId:f.safeId});
});

test('urgent water and ordinary restorative needs retain priority; urgent earned food retains its existing position',()=>{
  const water=fixture();water.n.physiology.waterDeficitMl=4000;water.n.flask.water=.5;projectPhysiology(water.n);
  assert.equal(discoveryDecision(water.n).action.type,'drink');
  const rest=fixture();rest.appetite(10);rest.n.physiology.stamina=8;rest.n.physiology.fatigue=80;
  assert.equal(discoveryDecision(rest.n).action.type,'rest');
  const sleep=fixture();sleep.appetite(10);sleep.n.physiology.sleepPressure=95;
  assert.equal(discoveryDecision(sleep.n).action.type,'sleep');
  const urgent=fixture();urgent.n.physiology.stamina=8;urgent.n.physiology.fatigue=80;
  assert.equal(foodRelease(discoveryDecision(urgent.n)),true,'same existing urgent-food-before-rest ordering');
});

test('cancelled paid release keeps the exact object and no unfinished food run, without an immediate release retry',()=>{
  const f=fixture(),n=f.n,choice=discoveryDecision(n),before=clone(lookupEcologyObject(f.env.ecology,f.harmId));
  assert.equal(foodRelease(choice),true);
  assert.equal(requestNpcAction(n,choice.action,f.env).code,'ACTION_STARTED');f.tick();
  cancelNpcAction(n,'PRIORITY_CHANGED');
  assert.ok(n.lastResult.durationSeconds>0);assert.equal(n.inventory.items.length,4);assert.equal(n.discovery.run,null);
  assert.deepEqual(lookupEcologyObject(f.env.ecology,f.harmId),before);
  assert.equal(foodRelease(discoveryDecision(n)),false);
});

test('a cancelled first adverse release does not hide a second eligible held identity',()=>{
  const f=fixture(),n=f.n;
  const second=n.inventory.items.find(id=>id!==f.harmId);
  const material=lookupEcologyObject(f.env.ecology,second);
  // The same authored spoilage setup as build(), followed by real funded
  // sampling and delayed recognition, not a supplied adverse effect.
  material.spoiled=true;material.ageHours=12*24;
  const swallowed=f.pay({type:'sample',targetId:second});
  f.until(()=>n.discovery.effects.some(e=>e.ingestionId===swallowed.ingestionId&&e.effect==='discomfort'));
  f.at(f.goodId);f.appetite();
  assert.equal(retainedProofIntegrityError(n),null);
  assert.deepEqual(discoveryDecision(n).action,{type:'release',targetId:f.harmId});
  assert.equal(requestNpcAction(n,{type:'release',targetId:f.harmId},f.env).code,'ACTION_STARTED');
  f.tick();cancelNpcAction(n,'PRIORITY_CHANGED');
  assert.equal(n.inventory.items.length,4);
  const decision=discoveryDecision(n);
  assert.equal(decision.need,'food');
  assert.deepEqual(decision.action,{type:'release',targetId:second});
  assert.equal(f.pay(decision.action).code,'object_released');
  assert.ok(n.inventory.items.includes(f.harmId),'cancelled identity remains held');
  assert.equal(n.inventory.items.length,3);
  const acquireDecision=discoveryDecision(n);
  assert.deepEqual(acquireDecision.action,{type:'pull',targetId:f.goodId});
  const acquired=f.pay(acquireDecision.action);
  assert.equal(acquired.code,'piece_detached');
  const sampleDecision=discoveryDecision(n);
  assert.deepEqual(sampleDecision.action,{type:'sample',targetId:acquired.materialId});
  assert.equal(f.pay(sampleDecision.action).code,'SWALLOWED');
  assert.equal(retainedProofIntegrityError(n),null);
});

test('current save roundtrip preserves paid adverse evidence without executing a release while closed',()=>{
  const f=fixture({tracked:true}),bytes=new Map(),storage={getItem:k=>bytes.get(k)??null,setItem:(k,v)=>bytes.set(k,v)};
  assert.equal(writeOzarkSave(storage,f.state,geometry),true,JSON.stringify(getOzarkSaveValidationFailure(f.state)));
  const prior={inventory:clone(f.n.inventory),body:clone(f.n.physiology),harm:clone(harm(f))};
  const loaded=loadOzarkSave(storage,geometry);assert.equal(loaded.blocked,false,loaded.error);
  const reopened={...attach(loaded.state),goodId:f.goodId,badId:f.badId,safeId:f.safeId,harmId:f.harmId};
  assert.deepEqual(reopened.n.inventory,prior.inventory);assert.deepEqual(reopened.n.physiology,prior.body);assert.deepEqual(harm(reopened),prior.harm);
  assert.equal(foodRelease(discoveryDecision(reopened.n)),false,'a saved view is not a new local sighting');
  observeNpc(reopened.n,reopened.env);
  assert.equal(foodRelease(discoveryDecision(reopened.n)),true);
});

test('a genuinely earned grasp sequence requires its exact same-object acquisition identity',()=>{
  const f=fixture();
  f.pay({type:'release',targetId:f.n.inventory.items.at(-1)});
  observeNpc(f.n,f.env);
  f.pay({type:'grasp',targetId:f.safeId});
  const acquisition=f.n.discovery.experiments.at(-1);
  const sample=f.pay({type:'sample',targetId:f.safeId});
  f.until(()=>f.n.discovery.effects.some(e=>e.ingestionId===sample.ingestionId&&e.effect==='sustained'));
  const technique=f.n.discovery.techniques.find(t=>t.sourceId===f.safeId&&t.steps[0].type==='grasp');
  assert.ok(technique,'the real grasp/sample/feedback chain earned its own technique');
  f.pay({type:'release',targetId:f.safeId});f.at(f.badId);f.pay({type:'pull',targetId:f.badId});f.at(f.goodId);
  assert.deepEqual(learnedCapacityRelease(f.n,[technique]),{type:'release',targetId:f.harmId});
  for(const kind of ['contradictory','absent']) {
    const n=clone(f.n),e=n.discovery.experiments.find(e=>e.id===acquisition.id),r=n.memory.experience.find(r=>r.id===e.actionId);
    if(kind==='contradictory')e.materialId=r.details.result.materialId=f.harmId;
    else {delete e.materialId;delete r.details.result.materialId;}
    assert.equal(learnedCapacityRelease(n,[n.discovery.techniques.find(t=>t.id===technique.id)]),null,kind);
  }
});

test('reopening during a partly paid release preserves ownership and cannot finish or replay that work',()=>{
  const f=fixture({tracked:true}),bytes=new Map(),storage={getItem:k=>bytes.get(k)??null,setItem:(k,v)=>bytes.set(k,v)};
  const choice=discoveryDecision(f.n);assert.equal(foodRelease(choice),true);
  assert.equal(requestNpcAction(f.n,choice.action,f.env).code,'ACTION_STARTED');f.tick();
  const before={inventory:clone(f.n.inventory),body:clone(f.n.physiology),material:clone(lookupEcologyObject(f.env.ecology,f.harmId))};
  assert.equal(writeOzarkSave(storage,f.state,geometry),true,JSON.stringify(getOzarkSaveValidationFailure(f.state)));
  const loaded=loadOzarkSave(storage,geometry);assert.equal(loaded.blocked,false,loaded.error);
  const reopened={...attach(loaded.state),goodId:f.goodId,badId:f.badId,safeId:f.safeId,harmId:f.harmId};
  assert.equal(reopened.n.active,null);assert.equal(reopened.n.discovery.run,null);
  assert.deepEqual(reopened.n.inventory,before.inventory);assert.deepEqual(reopened.n.physiology,before.body);
  assert.deepEqual(lookupEcologyObject(reopened.env.ecology,f.harmId),before.material);
  assert.ok(reopened.n.memory.experience.some(r=>r.details.result?.code==='RESTART_INTERRUPTED'));
  // The existing disk codec strips action identity and records a generic
  // interruption. A later fresh choice is allowed, but pays entirely new work.
  observeNpc(reopened.n,reopened.env);
  const fresh=discoveryDecision(reopened.n);assert.equal(foodRelease(fresh),true);
  assert.equal(requestNpcAction(reopened.n,fresh.action,reopened.env).code,'ACTION_STARTED');
  assert.equal(reopened.n.active.worked,0);
  reopened.tick();assert.ok(reopened.n.active,'the old paid slice cannot finish this fresh action');
  assert.equal(lookupEcologyObject(reopened.env.ecology,f.harmId).heldBy,reopened.n.id);
});
