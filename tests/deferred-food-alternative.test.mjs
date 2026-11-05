import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpc } from '../src/npc-state.js';
import { createEnvironment } from '../src/environment.js';
import { requestNpcAction, tickNpc, observeNpc } from '../src/npc.js';
import { canStand } from '../src/world.js';
import { discoveryDecision, processDiscoveryFeedback } from '../src/discovery.js';
import { ingestMaterial, projectPhysiology } from '../src/biology.js';

// Authored mechanism fixture, not autonomous acquisition or a survival trial.
// Positioning and hunger are supplied; all food/technique evidence is earned
// through paid operations and ordinary delayed digestion on unchanged main.
// These cases cover completion/refusal retirement, not the eligibility-blocked
// branch, connected navigation, alternative-source recovery or autonomous survival.
// Setup uses standalone legacy geometry and authored placements at two sources.
function tick(f,seconds) { for(let i=0;i<Math.ceil(seconds*60);i++){tickNpc(f.n,1/60,f.e);processDiscoveryFeedback(f.n);} }
function act(f,action,{immediateRefusal=null}={}) {
  const before=f.n.elapsed,spent=f.n.physiology.totals.metabolizedKcal;
  const admission=requestNpcAction(f.n,action,f.e);
  if(immediateRefusal){
    assert.equal(admission.code,immediateRefusal);assert.equal(admission.ok,false);
    assert.equal(f.n.active,null);assert.equal(f.n.elapsed,before);
    return admission;
  }
  assert.equal(admission.code,'ACTION_STARTED');assert.equal(admission.ok,true);
  assert.ok(f.n.active);
  for(let i=0;i<1200&&f.n.active;i++)tick(f,1/60);
  assert.equal(f.n.active,null);assert.ok(f.n.elapsed>before);
  assert.ok(f.n.physiology.totals.metabolizedKcal>spent);
  return f.n.lastResult;
}
function approach(f,plant){
  f.n.position=[{x:plant.position.x+45,y:plant.position.y},{x:plant.position.x-45,y:plant.position.y},{x:plant.position.x,y:plant.position.y+45},{x:plant.position.x,y:plant.position.y-45}].find(p=>canStand(p.x,p.y,'valley'));
  assert.ok(f.n.position);observeNpc(f.n,f.e);
}
function hungry(n){n.physiology.hoursSinceMeal=8;n.physiology.satietyHours=0;n.physiology.waterDeficitMl=250;projectPhysiology(n);}
function fixture(){
  const f={n:createNpc({mode:'discovery',seed:74193}),e:createEnvironment(74193,{mode:'discovery'})};
  const plants=f.e.ecology.plants.filter(p=>p.kind==='apple_tree'&&p.quantity>0).slice(0,2);assert.equal(plants.length,2);
  assert.notEqual(plants[0].id,plants[1].id);
  for(const plant of plants){
    approach(f,plant);assert.equal(act(f,{type:'pull',targetId:plant.id}).ok,true);
    const id=f.n.inventory.items[0];assert.equal(act(f,{type:'sample',targetId:id}).ok,true);tick(f,90);
    assert.ok(f.n.discovery.techniques.some(t=>t.sourceId===plant.id));
    assert.equal(act(f,{type:'release',targetId:id}).ok,true);
  }
  assert.equal(new Set(f.n.discovery.techniques.filter(t=>plants.some(p=>p.id===t.sourceId)).map(t=>t.sourceId)).size,2);
  hungry(f.n);observeNpc(f.n,f.e);
  const choice=discoveryDecision(f.n).action;assert.equal(choice.type,'pull');
  assert.equal(act(f,choice).ok,true);assert.equal(f.n.discovery.run.cursor,1);
  f.material=f.n.discovery.run.materialId;return f;
}
test('completed paid learned sample advances its run and next decision retires that run',()=>{
  const f=fixture(),choice=discoveryDecision(f.n).action;
  assert.deepEqual(choice,{type:'sample',targetId:f.material});assert.equal(act(f,choice).ok,true);
  assert.equal(f.n.discovery.run.cursor,2);
  const completedRun=f.n.discovery.run;
  discoveryDecision(f.n);assert.notEqual(f.n.discovery.run,completedRun);
  assert.ok(!f.n.discovery.run||f.n.discovery.run.cursor===0);
});
test('paid capacity refusal after selection clears the run and next decision does not sample',()=>{
  const f=fixture(),choice=discoveryDecision(f.n).action;
  assert.equal(choice.type,'sample');
  while(f.n.physiology.stomach.length<24)assert.equal(ingestMaterial(f.n,{massGrams:1,energyKcal:0,waterMl:0,digestHours:24},{provenance:'authored capacity fixture'}).ok,true);
  assert.equal(act(f,choice).code,'TOO_FULL');assert.equal(f.n.discovery.run,null);
  assert.notEqual(discoveryDecision(f.n).action.type,'sample');
});
test('paid release after sample selection causes immediate NOT_HELD refusal and clears the run',()=>{
  const f=fixture(),choice=discoveryDecision(f.n).action;
  assert.equal(choice.type,'sample');assert.equal(act(f,{type:'release',targetId:f.material}).ok,true);
  assert.equal(act(f,choice,{immediateRefusal:'NOT_HELD'}).ok,false);assert.equal(f.n.discovery.run,null);
});
