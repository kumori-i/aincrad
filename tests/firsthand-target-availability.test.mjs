import test from 'node:test';
import assert from 'node:assert/strict';
import {CONFIG} from '../src/config.js';
import {createNpc} from '../src/npc-state.js';
import {createEnvironment} from '../src/environment.js';
import {canStand, freshState} from '../src/world.js';
import {observeNpc, requestNpcAction, tickNpc} from '../src/npc.js';
import {senseEcology} from '../src/ecology.js';
import {projectPhysiology} from '../src/biology.js';
import {discoveryDecision, processDiscoveryFeedback, recordDiscoveryClaim,
  recordDiscoveryReport} from '../src/discovery.js';
import {NpcController} from '../src/controller.js';
import {validateNpc} from '../src/npc-memory.js';
import {writeSave, loadSave} from '../src/save.js';

// All objects and initial stock come from the deterministic public world. The
// positive-stock branch below is explicitly synthetic and is not a growth test.
const seed=74193;
const storage=()=>{const rows=new Map();return {getItem:key=>rows.get(key)??null,setItem:(key,value)=>rows.set(key,value)};};
function advance(n,e,seconds){for(let i=0;i<Math.ceil(seconds/.25);i++){tickNpc(n,.25,e);processDiscoveryFeedback(n);}}
function finish(n,e,action){
  const started=requestNpcAction(n,action,e);
  if(started.code==='ACTION_STARTED')for(let i=0;i<100&&n.active;i++)tickNpc(n,.25,e);
  assert.equal(n.active,null,'bounded physical action');
  return n.lastResult||started;
}
function hungry(n){n.physiology.hoursSinceMeal=20;n.physiology.waterDeficitMl=250;projectPhysiology(n);}
function fixture(){
  const n=createNpc({mode:'discovery',seed}),e=createEnvironment(seed,{mode:'discovery'});
  const plant=e.ecology.plants.find(p=>p.kind==='apple_tree'&&p.quantity>2);
  assert.ok(plant,'real initial finite fruit');
  n.position=[{x:plant.position.x+45,y:plant.position.y},{x:plant.position.x-45,y:plant.position.y},
    {x:plant.position.x,y:plant.position.y+45},{x:plant.position.x,y:plant.position.y-45}]
    .find(p=>canStand(p.x,p.y,'valley'));
  assert.ok(n.position);observeNpc(n,e);
  return {n,e,plant};
}
function learned(){
  const f=fixture(),{n,e,plant}=f;
  assert.equal(finish(n,e,{type:'pull',targetId:plant.id}).code,'piece_detached');
  f.materialId=n.inventory.items[0];
  assert.equal(finish(n,e,{type:'sample',targetId:f.materialId}).ok,true);
  for(let i=0;i<360&&!n.discovery.techniques.length;i++){tickNpc(n,.25,e);processDiscoveryFeedback(n);}
  assert.ok(n.discovery.techniques.some(t=>t.sourceId===plant.id),'experienced sustained effect');
  return f;
}
function depleted(){
  const f=learned(),{n,e,plant}=f;
  assert.equal(finish(n,e,{type:'release',targetId:f.materialId}).ok,true);
  while(plant.quantity>0){
    assert.equal(finish(n,e,{type:'pull',targetId:plant.id}).ok,true);
    assert.equal(finish(n,e,{type:'release',targetId:n.inventory.items[0]}).ok,true);
  }
  observeNpc(n,e);hungry(n);n.discovery.run=null;
  assert.equal(n.discovery.observations[plant.id].count,0);
  assert.deepEqual(discoveryDecision(n).action,{type:'pull',targetId:plant.id},'one physical check of depleted source');
  assert.equal(finish(n,e,{type:'pull',targetId:plant.id}).code,'nothing_detached');
  return f;
}
const sourcePull=(decision,id)=>decision.action.type==='pull'&&decision.action.targetId===id;

test('a bare fruiting plant reports zero visible stock without revealing nutrition',()=>{
  const {n,e,plant}=depleted();
  const sensed=senseEcology(e.ecology,n.position,'valley').find(o=>o.id===plant.id);
  assert.equal(sensed?.count,0);assert.equal(n.discovery.observations[plant.id].count,0);
  for(const hidden of ['kind','quantity','energyKcal','waterMl','edible','renewAt'])
    assert.equal(Object.hasOwn(sensed,hidden),false,hidden);
  const reopened=validateNpc(JSON.parse(JSON.stringify(n)));
  assert.equal(reopened.discovery.observations[plant.id].count,0);
});

test('a genuine depletion stays gated through old-save restoration, testimony and manual checks',()=>{
  const {n,e,plant}=depleted(),key=`${plant.id}|pull`,failedAt=n.discovery.trials[key].lastAt;
  const technique=n.discovery.techniques.find(t=>t.sourceId===plant.id),proof=structuredClone(technique.evidence);
  advance(n,e,61);hungry(n);observeNpc(n,e);
  for(let i=0;i<8;i++)assert.equal(sourcePull(discoveryDecision(n),plant.id),false,'time alone cannot reopen');
  const note=recordDiscoveryClaim(n,{objectId:plant.id,effect:'sustained'},
    {sourceId:'mira',channel:'note',messageId:'note:depleted'});
  assert.equal(note?.status,'unverified');assert.deepEqual(note?.proposed,[]);
  const advice=recordDiscoveryReport(n,`pull ${plant.id}`,{sourceId:'human',messageId:'message:depleted'});
  assert.deepEqual(advice?.proposed,[{type:'pull',targetId:plant.id}]);
  for(let i=0;i<8;i++)assert.equal(sourcePull(discoveryDecision(n),plant.id),false,'words cannot become sight');
  assert.equal(finish(n,e,{type:'pull',targetId:plant.id}).code,'nothing_detached',
    'manual bodily action remains possible');
  assert.deepEqual(technique.evidence,proof);assert.ok(n.discovery.trials[key].lastAt>failedAt);

  const raw=JSON.parse(JSON.stringify(n));delete raw.discovery.trials[key].lastOk;
  const restored=validateNpc(raw);
  assert.equal(restored.discovery.trials[key].lastOk,false,'matching action receipt recovers old trial metadata');
  assert.equal(sourcePull(discoveryDecision(restored),plant.id),false);
  const world=freshState({connectedEcology:false});world.environment=e;world.agents[0]=n;world.npc=n;world.elapsed=n.elapsed;
  const disk=storage();assert.equal(writeSave(disk,world),true,'isolated save writes');
  const loaded=loadSave(disk);assert.equal(loaded.blocked,false,loaded.error);
  assert.equal(loaded.state.agents[0].discovery.observations[plant.id].count,0);
  assert.equal(sourcePull(discoveryDecision(loaded.state.agents[0]),plant.id),false);
  assert.ok(loaded.state.agents[0].discovery.techniques.some(t=>t.sourceId===plant.id),
    'learned place and effect remain retained');
});

test('same-tick and forged sightings cannot reopen; a later direct positive sighting can',()=>{
  const {n,e,plant}=depleted(),key=`${plant.id}|pull`,failure=n.discovery.trials[key].lastAt;
  const failures=n.discovery.trials[key].failures;
  plant.quantity=1; // Synthetic visible regrowth state; no interval claim.
  observeNpc(n,e);assert.equal(n.discovery.observations[plant.id].observedAt,failure);
  assert.equal(sourcePull(discoveryDecision(n),plant.id),false,
    'a sighting with the failure timestamp cannot establish later availability');

  const forged=JSON.parse(JSON.stringify(n));
  forged.discovery.observations[plant.id].count=7;
  forged.discovery.observations[plant.id].observedAt=n.elapsed+.25;
  forged.elapsed=n.elapsed+.25;
  const reopened=validateNpc(forged);
  assert.equal(sourcePull(discoveryDecision(reopened),plant.id),false,
    'saved observation fields alone have no live firsthand witness');
  advance(n,e,.25);hungry(n);observeNpc(n,e);
  assert.ok(n.discovery.observations[plant.id].observedAt>failure);
  assert.deepEqual(discoveryDecision(n).action,{type:'pull',targetId:plant.id},
    'later direct sighting can reopen without a fixed return timer');
  assert.equal(n.discovery.trials[key].failures,failures,'availability does not erase failures');

  plant.quantity=0;
  assert.equal(finish(n,e,{type:'pull',targetId:plant.id}).code,'nothing_detached');
  assert.equal(sourcePull(discoveryDecision(n),plant.id),false,
    'a repeated physical failure supersedes the earlier positive sighting');
  plant.quantity=1;
  observeNpc(n,e);
  assert.equal(sourcePull(discoveryDecision(n),plant.id),false,'same-tick resighting is still ambiguous');
  advance(n,e,.25);hungry(n);
  observeNpc(n,e);assert.equal(n.discovery.observations[plant.id].count,1);
  assert.deepEqual(discoveryDecision(n).action,{type:'pull',targetId:plant.id});
});

test('historical high failure counts and revised harm remain gates despite visible stock',()=>{
  const {n,e,plant,materialId}=learned();
  assert.equal(finish(n,e,{type:'release',targetId:materialId}).ok,true);
  hungry(n);observeNpc(n,e);
  const raw=JSON.parse(JSON.stringify(n)),source=raw.discovery.techniques.find(t=>t.sourceId===plant.id);
  source.failures=source.successes+9; // Historical reasons cannot be attributed safely.
  const old=validateNpc(raw);observeNpc(old,e);
  const count=old.discovery.techniques.find(t=>t.sourceId===plant.id).failures;
  assert.equal(count,source.failures);
  const oldDecision=discoveryDecision(old);
  assert.notEqual(oldDecision.need,'food','a historical count is not forgiven by a visible source');
  assert.equal(old.discovery.run,null);

  source.failures=0;source.confidence='revised';
  const harmed=validateNpc(raw);observeNpc(harmed,e);
  assert.equal(harmed.discovery.techniques.find(t=>t.sourceId===plant.id).confidence,'revised');
  const harmedDecision=discoveryDecision(harmed);
  assert.notEqual(harmedDecision.need,'food','visible stock never overrides experienced aversion');
  assert.equal(harmed.discovery.run,null);
});

test('an unmatched legacy scarcity code pauses retries without inventing a proved failure',()=>{
  const {n,e,plant}=depleted(),key=`${plant.id}|pull`;
  const raw=JSON.parse(JSON.stringify(n));
  raw.elapsed+=61;
  raw.discovery.trials[key].lastAt+=1;
  delete raw.discovery.trials[key].lastOk;
  const restored=validateNpc(raw);
  assert.equal(restored.discovery.trials[key].lastOk,undefined,
    'a newer aggregate has no matching result receipt');
  assert.equal(sourcePull(discoveryDecision(restored),plant.id),false,
    'uncertainty does not authorize another depleted pull');
  assert.equal(restored.discovery.trials[key].lastOk,undefined,'the gate does not rewrite proof');
  e.ecology.plants.find(p=>p.id===plant.id).quantity=1; // Synthetic positive stock.
  observeNpc(restored,e);
  assert.ok(restored.discovery.observations[plant.id].observedAt>restored.discovery.trials[key].lastAt);
  hungry(restored);
  assert.deepEqual(discoveryDecision(restored).action,{type:'pull',targetId:plant.id});
  assert.equal(restored.discovery.trials[key].lastOk,undefined);
});

test('an absent consumed ID does not recover from a timer, note, or a replacement ID',()=>{
  const {n,e,plant,materialId}=learned();
  assert.equal(finish(n,e,{type:'release',targetId:materialId}).ok,true);hungry(n);
  assert.deepEqual(discoveryDecision(n).action,{type:'pull',targetId:plant.id});
  e.ecology.plants.splice(e.ecology.plants.indexOf(plant),1); // Synthetic removal, never saved.
  assert.equal(finish(n,e,{type:'pull',targetId:plant.id}).code,'OBJECT_GONE');
  advance(n,e,61);hungry(n);observeNpc(n,e);
  recordDiscoveryClaim(n,{objectId:plant.id,effect:'sustained'},
    {sourceId:'mira',channel:'note',messageId:'note:gone'});
  for(let i=0;i<8;i++)assert.notEqual(discoveryDecision(n).action.targetId,plant.id);
  assert.equal(finish(n,e,{type:'pull',targetId:plant.id}).code,'OBJECT_GONE',
    'manual action still reports the physical result');
  const replacement={...plant,id:`object:${e.ecology.nextId++}`,quantity:1};
  e.ecology.plants.push(replacement);observeNpc(n,e);
  assert.ok(n.discovery.observations[replacement.id],'replacement must be directly seen');
  assert.ok(n.discovery.techniques.every(t=>t.sourceId!==replacement.id),
    'a new physical identity does not inherit old learned food proof');
  assert.notEqual(discoveryDecision(n).action.targetId,plant.id);
});

test('bounded headless controller avoids 120 seconds of depleted retries, then sees a synthetic regrowth branch',()=>{
  const {n,e,plant}=depleted(),afterFailure=structuredClone(n),branchWorld=structuredClone(e);
  const start=n.elapsed,prior=n.memory.experience.at(-1)?.id||0;
  const controller=new NpcController(n,{environment:e});
  for(let i=0;i<480;i++)controller.tick(.25);
  controller.dispose();
  assert.ok(n.elapsed-start>=119.99&&n.elapsed-start<=120.01,'bounded 120 simulated seconds');
  const repeated=n.memory.experience.filter(row=>row.id>prior&&row.type==='action'&&
    row.details.action?.type==='pull'&&row.details.action.targetId===plant.id);
  assert.equal(repeated.length,0,'no autonomous depleted-target pull loop');

  const source=branchWorld.ecology.plants.find(p=>p.id===plant.id);
  assert.equal(source.quantity,0);
  advance(afterFailure,branchWorld,61);hungry(afterFailure);
  source.quantity=1; // Explicit synthetic positive-stock branch, not simulated regrowth.
  observeNpc(afterFailure,branchWorld);
  assert.equal(afterFailure.discovery.observations[plant.id].count,1);
  assert.deepEqual(discoveryDecision(afterFailure).action,{type:'pull',targetId:plant.id});
});
