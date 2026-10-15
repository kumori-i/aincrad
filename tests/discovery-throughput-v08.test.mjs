import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpc } from '../src/npc-state.js';
import { createEnvironment, tickEnvironment } from '../src/environment.js';
import { requestNpcAction, tickNpc, observeNpc } from '../src/npc.js';
import { canStand } from '../src/world.js';
import { discoveryDecision, processDiscoveryFeedback } from '../src/discovery.js';
import { ingestMaterial, canIngestMaterial, projectPhysiology } from '../src/biology.js';
import { bodySignals } from '../src/interoception.js';
import { lookupEcologyObject, tickEcology } from '../src/ecology.js';
import { NpcController } from '../src/controller.js';
import { validateNpc } from '../src/npc-memory.js';

function fixture() {
  const n=createNpc({mode:'discovery',seed:74193}),e=createEnvironment(74193,{mode:'discovery'});
  const plant=e.ecology.plants.find(p=>p.kind==='apple_tree');
  n.position=[{x:plant.position.x+45,y:plant.position.y},{x:plant.position.x-45,y:plant.position.y},{x:plant.position.x,y:plant.position.y+45},{x:plant.position.x,y:plant.position.y-45}].find(p=>canStand(p.x,p.y,'valley'));
  assert.ok(n.position);observeNpc(n,e);return {n,e,plant};
}
function finish(n,e,action) {
  const result=requestNpcAction(n,action,e);
  if(result.code==='ACTION_STARTED')for(let i=0;i<1000&&n.active;i++)tickNpc(n,1/60,e);
  assert.equal(n.active,null);return n.lastResult||result;
}
function tick(n,e,seconds){for(let i=0;i<Math.ceil(seconds*60);i++){tickNpc(n,1/60,e);processDiscoveryFeedback(n);}}
function learnedFixture() {
  const f=fixture(),{n,e,plant}=f;assert.equal(finish(n,e,{type:'pull',targetId:plant.id}).ok,true);
  f.id=n.inventory.items[0];assert.equal(finish(n,e,{type:'sample',targetId:f.id}).ok,true);tick(n,e,90);
  assert.ok(n.discovery.techniques.length);return f;
}
function fillEntrySlots(n) {
  // Explicit synthetic body fixture isolates the bounded input queue from mass.
  // No application stock or nutrition parameter is modified.
  while(n.physiology.stomach.length<24)assert.equal(ingestMaterial(n,{massGrams:1,energyKcal:0,waterMl:0,digestHours:24},{provenance:'test fixture'}).ok,true);
  assert.equal(canIngestMaterial(n,{massGrams:30}).code,'TOO_FULL');
  assert.equal(bodySignals(n).digestion,'settled');
}
function hunger(n,hours=8){n.physiology.hoursSinceMeal=hours;n.physiology.waterDeficitMl=250;projectPhysiology(n);}

test('ordinary learned consumption respects a recent swallowing refusal and retries after the existing cooldown',()=>{
  const {n,e,id}=learnedFixture();fillEntrySlots(n);hunger(n);
  assert.deepEqual(discoveryDecision(n).action,{type:'sample',targetId:id});
  const material=lookupEcologyObject(e.ecology,id),before={mass:material.massGrams,kcal:material.energyKcal,removed:e.ecology.ledger.humanRemovedKcal};
  assert.equal(finish(n,e,{type:'sample',targetId:id}).code,'TOO_FULL');
  assert.deepEqual({mass:material.massGrams,kcal:material.energyKcal,removed:e.ecology.ledger.humanRemovedKcal},before);
  const refusalAt=n.elapsed;for(let i=0;i<8;i++)assert.notEqual(discoveryDecision(n).action.type,'sample');
  assert.equal(n.discovery.techniques[0].failures,0);
  tick(n,e,60);hunger(n);n.discovery.run=null;
  assert.ok(n.elapsed-refusalAt>=60);assert.deepEqual(discoveryDecision(n).action,{type:'sample',targetId:id});
});

test('urgent learned food does not repeatedly override needed sleep after TOO_FULL',()=>{
  const {n,e,id}=learnedFixture();fillEntrySlots(n);hunger(n,20);n.physiology.fatigue=80;n.physiology.sleepPressure=90;projectPhysiology(n);
  assert.equal(discoveryDecision(n).action.type,'sample');assert.equal(finish(n,e,{type:'sample',targetId:id}).code,'TOO_FULL');
  assert.equal(discoveryDecision(n).action.type,'sleep');
});

test('a learned sequence defers blocked sampling without declaring the source disproved',()=>{
  const {n,e,id}=learnedFixture();fillEntrySlots(n);hunger(n);
  const t=n.discovery.techniques[0];n.discovery.run={techniqueId:t.id,cursor:1,materialId:id,awaiting:false,startedAt:n.elapsed};
  assert.equal(discoveryDecision(n).action.type,'sample');assert.equal(finish(n,e,{type:'sample',targetId:id}).code,'TOO_FULL');
  assert.equal(t.failures,0);assert.equal(n.discovery.run,null);
  n.discovery.run={techniqueId:t.id,cursor:1,materialId:id,awaiting:false,startedAt:n.elapsed};
  assert.notEqual(discoveryDecision(n).action.type,'sample');assert.equal(n.discovery.run.awaiting,false);
});

test('an observed body-capacity refusal also gates another held item and generic exploration',()=>{
  const {n,e,id,plant}=learnedFixture();assert.equal(finish(n,e,{type:'pull',targetId:plant.id}).ok,true);const other=n.inventory.items.find(x=>x!==id);assert.ok(other);
  fillEntrySlots(n);hunger(n);assert.equal(finish(n,e,{type:'sample',targetId:id}).code,'TOO_FULL');
  n.discovery.effects=[];n.discovery.techniques=[];n.discovery.run=null;
  for(let i=0;i<20;i++)assert.notEqual(discoveryDecision(n).action.type,'sample');
});

test('later water feedback from an older real apple portion cannot release a newer portion wait',()=>{
  const {n,e,plant}=fixture();hunger(n,20);n.physiology.waterDeficitMl=500;
  assert.equal(finish(n,e,{type:'pull',targetId:plant.id}).ok,true);const id=n.inventory.items[0];assert.equal(finish(n,e,{type:'sample',targetId:id}).ok,true);
  const first=n.discovery.experiments.at(-1);
  for(let i=0;i<6000&&!n.discovery.effects.some(x=>x.effect==='sustained');i++)tick(n,e,1/60);
  assert.ok(n.discovery.effects.some(x=>x.effect==='sustained'));
  assert.deepEqual(discoveryDecision(n).action,{type:'sample',targetId:id});assert.equal(finish(n,e,{type:'sample',targetId:id}).ok,true);
  const second=n.discovery.experiments.at(-1),pending=n.discovery.samplesPending[id];assert.ok(second.at>first.at);
  for(let i=0;i<6000&&!n.discovery.effects.some(x=>x.effect==='water relief'&&x.ingestionId===first.ingestionId);i++)tick(n,e,1/60);
  assert.ok(n.discovery.effects.some(x=>x.effect==='water relief'&&x.ingestionId===first.ingestionId));
  assert.equal(n.discovery.samplesPending[id],pending);
  const decision=discoveryDecision(n);assert.notDeepEqual(decision.action,{type:'sample',targetId:id});
  for(let i=0;i<6000&&!n.discovery.effects.some(x=>x.effect==='sustained'&&x.ingestionId===second.ingestionId);i++)tick(n,e,1/60);
  assert.ok(n.discovery.effects.some(x=>x.effect==='sustained'&&x.ingestionId===second.ingestionId));assert.equal(n.discovery.samplesPending[id],undefined);
});


test('positive food-association ablation leaves perception, navigation and pre-feedback behavior intact',()=>{
  const {n,e,plant}=fixture();hunger(n,8);finish(n,e,{type:'pull',targetId:plant.id});finish(n,e,{type:'sample',targetId:n.inventory.items[0]});
  const control=structuredClone(n),controlEnv=structuredClone(e),a=new NpcController(n,{environment:e}),b=new NpcController(control,{environment:controlEnv,discoveryFoodLearning:false});
  let feedback=false;
  for(let i=0;i<6000;i++){
    a.tick(1/60);b.tick(1/60);
    assert.deepEqual(control.memory.cells,n.memory.cells);assert.deepEqual(control.memory.blockedEdges,n.memory.blockedEdges);assert.deepEqual(control.discovery.observations,n.discovery.observations);
    assert.deepEqual(control.discovery.practice,n.discovery.practice);assert.deepEqual(control.discovery.trials,n.discovery.trials);
    assert.deepEqual(control.physiology,n.physiology);
    if(n.discovery.effects.some(x=>x.effect==='sustained')){feedback=true;break;}
    assert.deepEqual(control.active,n.active);assert.equal(control.rng,n.rng);assert.equal(control.decision,n.decision);
  }
  assert.ok(feedback);assert.ok(n.discovery.techniques.length>0);assert.equal(control.discovery.techniques.length,0);assert.ok(control.discovery.effects.some(x=>x.effect==='sustained'),'raw bodily evidence remains available for diagnostic measurement');
  assert.equal(control.learning,true,'legacy perception/navigation learning was not disabled');a.dispose();b.dispose();
});

test('a warm ablation suppresses stored food-technique use without erasing learned memory or persistence',()=>{
  const {n,id}=learnedFixture();hunger(n);const before=structuredClone(n.discovery.techniques);
  assert.deepEqual(discoveryDecision(n).action,{type:'sample',targetId:id});
  n.discovery.run={techniqueId:before[0].id,cursor:1,materialId:id,awaiting:false,startedAt:n.elapsed};
  const control=discoveryDecision(n,{foodLearning:false});assert.notEqual(control.need,'food');assert.equal(n.discovery.run,null);assert.deepEqual(n.discovery.techniques,before);
  const restored=validateNpc(JSON.parse(JSON.stringify(n)));assert.equal(restored.discovery.techniques.length,before.length);
  assert.equal(new NpcController(restored).discoveryFoodLearning,true,'evaluation switch is not a saved character setting');
});


test('a depleted learned source obeys the same failure cooldown as a generic trial',()=>{
  const {n,e,id,plant}=learnedFixture();finish(n,e,{type:'release',targetId:id});
  while(plant.quantity>=1){assert.equal(finish(n,e,{type:'pull',targetId:plant.id}).ok,true);assert.equal(finish(n,e,{type:'release',targetId:n.inventory.items[0]}).ok,true);}
  hunger(n);n.discovery.run=null;const t=n.discovery.techniques.find(t=>t.sourceId===plant.id);const failures=t.failures;
  assert.deepEqual(discoveryDecision(n).action,{type:'pull',targetId:plant.id});assert.equal(finish(n,e,{type:'pull',targetId:plant.id}).code,'nothing_detached');assert.equal(t.failures,failures+1);
  for(let i=0;i<8;i++)assert.notDeepEqual(discoveryDecision(n).action,{type:'pull',targetId:plant.id});
  tick(n,e,61);hunger(n);n.discovery.run=null;
  assert.deepEqual(discoveryDecision(n).action,{type:'pull',targetId:plant.id});
});

test('a successful learned acquisition is not mistaken for a cooldown after save restoration',()=>{
  const {n,e,id,plant}=learnedFixture();finish(n,e,{type:'release',targetId:id});hunger(n);
  assert.deepEqual(discoveryDecision(n).action,{type:'pull',targetId:plant.id});assert.equal(finish(n,e,{type:'pull',targetId:plant.id}).ok,true);
  const acquired=n.inventory.items[0];finish(n,e,{type:'release',targetId:acquired});n.discovery.run=null;hunger(n);
  const key=`${plant.id}|pull`;assert.equal(n.discovery.trials[key].lastOk,true);
  const restored=validateNpc(JSON.parse(JSON.stringify(n)));assert.equal(restored.discovery.trials[key].lastOk,true);
  assert.ok(restored.elapsed-restored.discovery.trials[key].lastAt<60);
  assert.deepEqual(discoveryDecision(restored).action,{type:'pull',targetId:plant.id});
});

test('legacy trial metadata recovers only a matching last result, not an older retained failure',()=>{
  const {n,e,plant}=fixture();assert.equal(finish(n,e,{type:'pull',targetId:plant.id}).ok,true);
  const key=`${plant.id}|pull`,raw=JSON.parse(JSON.stringify(n));delete raw.discovery.trials[key].lastOk;
  const recovered=validateNpc(raw);assert.equal(recovered.discovery.trials[key].lastOk,true);
  // A legacy aggregate newer than its available evidence has an unknown result.
  // Its code is not interpreted as an edibility or success lookup table.
  raw.discovery.trials[key].lastAt+=1;raw.discovery.trials[key].lastCode='nothing_detached';
  const unknown=validateNpc(raw);assert.equal(unknown.discovery.trials[key].lastOk,undefined);
  assert.equal(unknown.discovery.trials[key].lastAt,raw.discovery.trials[key].lastAt);
  const withoutAggregates=JSON.parse(JSON.stringify(n));delete withoutAggregates.discovery.trials;
  assert.equal(validateNpc(withoutAggregates).discovery.trials[key].lastOk,true);
});

test('a body refusal still gates other items after its detailed record rotates out',()=>{
  const {n,e,id,plant}=learnedFixture();finish(n,e,{type:'pull',targetId:plant.id});const other=n.inventory.items.find(x=>x!==id);assert.ok(other);
  // Protect the bounded log with actual inspections of the other held material.
  for(let i=0;i<180;i++)assert.equal(finish(n,e,{type:'inspect_object',targetId:other}).ok,true);
  fillEntrySlots(n);assert.equal(finish(n,e,{type:'sample',targetId:id}).code,'TOO_FULL');
  assert.equal(finish(n,e,{type:'release',targetId:id}).ok,true);
  assert.equal(finish(n,e,{type:'inspect_object',targetId:other}).ok,true);
  assert.ok(!n.discovery.experiments.some(x=>x.code==='TOO_FULL'));
  assert.equal(n.discovery.trials[`${id}|sample`].lastOk,false);
  for(let i=0;i<20;i++)assert.notEqual(discoveryDecision(n).action.type,'sample');
  const restored=validateNpc(JSON.parse(JSON.stringify(n)));
  assert.equal(restored.discovery.trials[`${id}|sample`].lastOk,false);
  for(let i=0;i<20;i++)assert.notEqual(discoveryDecision(restored).action.type,'sample');
});

test('a real source failure survives a fully protected detail log and both current and legacy save restoration',()=>{
  const {n,e,plant}=fixture();
  const advance=()=>{tickEnvironment(e,1/60);tickEcology(e.ecology,1/60,e,[n]);tickNpc(n,1/60,e);processDiscoveryFeedback(n);};
  const act=action=>{const started=requestNpcAction(n,action,e);assert.equal(started.code,'ACTION_STARTED');for(let i=0;i<2000&&n.active;i++)advance();assert.equal(n.active,null);return n.lastResult;};
  assert.equal(act({type:'pull',targetId:plant.id}).ok,true);const tasted=n.inventory.items[0];assert.equal(act({type:'sample',targetId:tasted}).ok,true);
  for(let i=0;i<6000&&!n.discovery.techniques.length;i++)advance();assert.ok(n.discovery.techniques.length);
  assert.equal(act({type:'release',targetId:tasted}).ok,true);
  while(plant.quantity>0){assert.equal(act({type:'pull',targetId:plant.id}).ok,true);assert.equal(act({type:'release',targetId:n.inventory.items[0]}).ok,true);}
  const other=e.ecology.materials.find(m=>m.id!==tasted&&!m.heldBy&&Math.hypot(m.position.x-n.position.x,m.position.y-n.position.y)<=80);assert.ok(other);observeNpc(n,e);
  assert.equal(act({type:'grasp',targetId:other.id}).ok,true);
  for(let i=0;i<180;i++)assert.equal(act({type:'inspect_object',targetId:other.id}).ok,true);
  for(let i=0;i<18000&&bodySignals(n).hunger==='content';i++)advance();
  assert.notEqual(bodySignals(n).hunger,'content');assert.equal(plant.quantity,0);assert.equal(n.discovery.experiments.length,160);
  const d=n.discovery,proof=new Set(d.techniques.flatMap(t=>t.evidence));
  assert.ok(d.experiments.every(x=>proof.has(x.id)||n.inventory.items.includes(x.targetId)||n.inventory.items.includes(x.materialId)||d.samplesPending[x.targetId]!==undefined||d.samplesPending[x.materialId]!==undefined));
  assert.deepEqual(discoveryDecision(n).action,{type:'pull',targetId:plant.id});assert.equal(act({type:'pull',targetId:plant.id}).code,'nothing_detached');
  assert.ok(!d.experiments.some(x=>x.targetId===plant.id&&x.code==='nothing_detached'),'new failure is actually absent from the protected detail log');
  const key=`${plant.id}|pull`;assert.equal(d.trials[key].lastOk,false);assert.equal(d.trials[key].lastAt,n.elapsed);
  const raw=JSON.parse(JSON.stringify(n)),restored=validateNpc(raw);delete raw.discovery.trials[key].lastOk;const legacy=validateNpc(raw);
  for(const state of [n,restored,legacy]){assert.equal(state.discovery.trials[key].lastOk,false);for(let i=0;i<8;i++)assert.notDeepEqual(discoveryDecision(state).action,{type:'pull',targetId:plant.id});}
});
