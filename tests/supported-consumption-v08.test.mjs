import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpc } from '../src/npc-state.js';
import { createEnvironment, tickEnvironment } from '../src/environment.js';
import { tickEcology, lookupEcologyObject, interactEcologyObject } from '../src/ecology.js';
import { requestNpcAction, tickNpc, observeNpc } from '../src/npc.js';
import { canStand } from '../src/world.js';
import { processDiscoveryFeedback, discoveryDecision } from '../src/discovery.js';
import { ingestMaterial, projectPhysiology } from '../src/biology.js';
import { validateNpc, recordEvent } from '../src/npc-memory.js';

function fixture(kind='apple_tree'){
  const n=createNpc({mode:'discovery',seed:74193}),e=createEnvironment(74193,{mode:'discovery'}),plant=e.ecology.plants.find(p=>p.kind===kind&&p.quantity>0);
  n.position=[{x:plant.position.x+45,y:plant.position.y},{x:plant.position.x-45,y:plant.position.y},{x:plant.position.x,y:plant.position.y+45}].find(p=>canStand(p.x,p.y,'valley'));assert.ok(n.position);
  // Explicit appetite and waning-energy fixtures isolate learned sampling opportunity.
  n.physiology.hoursSinceMeal=12;n.physiology.satietyHours=0;n.physiology.availableEnergyKcal=700;projectPhysiology(n);observeNpc(n,e);return{n,e,plant};
}
function tick(f,seconds=1/60){for(let i=0;i<Math.ceil(seconds*60);i++){tickEnvironment(f.e,1/60);tickEcology(f.e.ecology,1/60,f.e,[f.n]);tickNpc(f.n,1/60,f.e);processDiscoveryFeedback(f.n,{recordEffect:effect=>recordEvent(f.n,'condition',{code:'DISCOVERY_EFFECT',feedback:effect})});}}
function act(f,action){const r=requestNpcAction(f.n,action,f.e);if(r.code==='ACTION_STARTED')for(let i=0;i<1200&&f.n.active;i++)tick(f);assert.equal(f.n.active,null);return f.n.lastResult||r;}
function positives(f,id=f.id){return new Set(f.n.discovery.effects.filter(e=>e.objectId===id&&e.effect==='sustained').map(e=>e.ingestionId));}
function awaitPositives(f,count){for(let i=0;i<24000&&positives(f).size<count;i++)tick(f);assert.equal(positives(f).size,count);}
let first,second;
function learned(count=2){
  if(!first){const f=fixture();assert.equal(act(f,{type:'pull',targetId:f.plant.id}).ok,true);f.id=f.n.inventory.items[0];assert.equal(act(f,{type:'sample',targetId:f.id}).ok,true);awaitPositives(f,1);first=structuredClone(f);assert.equal(act(f,{type:'sample',targetId:f.id}).ok,true);awaitPositives(f,2);second=structuredClone(f);}
  return structuredClone(count===1?first:second);
}
function pendingThird(){const f=learned();assert.equal(act(f,{type:'sample',targetId:f.id}).ok,true);return f;}

test('two distinct same-material benefits support physical repeated intake without clearing pending identity',()=>{
  const f=pendingThird(),{n,e,id}=f,pending=n.discovery.samplesPending[id],m=lookupEcologyObject(e.ecology,id),mass=m.massGrams,removed=e.ecology.ledger.humanRemovedKcal,ingested=n.physiology.totals.ingestedKcal;
  assert.equal(positives(f).size,2);assert.deepEqual(discoveryDecision(n).action,{type:'sample',targetId:id});
  assert.equal(n.discovery.samplesPending[id],pending);assert.equal(act(f,{type:'sample',targetId:id}).ok,true);
  assert.equal(m.massGrams,mass-30);assert.ok(Math.abs(e.ecology.ledger.humanRemovedKcal-removed-95/6)<1e-10);assert.ok(Math.abs(n.physiology.totals.ingestedKcal-ingested-95/6)<1e-10);
  assert.ok(n.discovery.samplesPending[id]>pending);assert.ok(n.physiology.stomach.length>=4,'real digestion remains pending');
});

test('one benefit, water relief and duplicate events from one ingestion do not count as two trials',()=>{
  const f=learned(1);assert.equal(act(f,{type:'sample',targetId:f.id}).ok,true);tick(f,2);
  assert.ok(f.n.discovery.effects.some(e=>e.effect==='water relief'));const positive=f.n.discovery.effects.find(e=>e.effect==='sustained');
  f.n.discovery.effects.push({...positive,id:'duplicate-test-event'});assert.equal(positives(f).size,1);
  for(let i=0;i<12;i++)assert.notDeepEqual(discoveryDecision(f.n).action,{type:'sample',targetId:f.id});
});

test('unmatched and missing provenance conservatively restore cautious waiting',()=>{
  for(const damage of ['action','ingestion','missing']){
    const f=pendingThird(),effects=f.n.discovery.effects.filter(e=>e.effect==='sustained'),last=effects.at(-1);
    if(damage==='action')last.actionId+=10000;else if(damage==='ingestion')last.ingestionId='ingestion:999999';else f.n.discovery.experiments=f.n.discovery.experiments.filter(e=>e.ingestionId!==last.ingestionId);
    assert.notDeepEqual(discoveryDecision(f.n).action,{type:'sample',targetId:f.id});
    const restored=validateNpc(JSON.parse(JSON.stringify(f.n)));assert.notDeepEqual(discoveryDecision(restored).action,{type:'sample',targetId:f.id});
  }
});

test('a new piece from a supported source remains cautious',()=>{
  const f=learned();assert.ok(f.n.discovery.techniques.some(t=>t.sourceId===f.plant.id&&t.confidence==='supported'));
  assert.equal(act(f,{type:'release',targetId:f.id}).ok,true);assert.equal(act(f,{type:'pull',targetId:f.plant.id}).ok,true);const next=f.n.inventory.items[0];assert.notEqual(next,f.id);
  assert.equal(act(f,{type:'sample',targetId:next}).ok,true);assert.equal(positives(f,next).size,0);
  for(let i=0;i<12;i++)assert.notDeepEqual(discoveryDecision(f.n).action,{type:'sample',targetId:next});
});

test('two different pieces from one source do not combine into same-piece support',()=>{
  const f=learned(1);assert.equal(act(f,{type:'release',targetId:f.id}).ok,true);assert.equal(act(f,{type:'pull',targetId:f.plant.id}).ok,true);f.id=f.n.inventory.items[0];
  assert.equal(act(f,{type:'sample',targetId:f.id}).ok,true);awaitPositives(f,1);assert.ok(f.n.discovery.techniques.some(t=>t.confidence==='supported'));
  assert.equal(act(f,{type:'sample',targetId:f.id}).ok,true);assert.equal(positives(f).size,1);assert.notDeepEqual(discoveryDecision(f.n).action,{type:'sample',targetId:f.id});
});

test('warm food-association ablation keeps cautious waiting despite retained positive evidence',()=>{
  const f=pendingThird(),pending=f.n.discovery.samplesPending[f.id];
  for(let i=0;i<12;i++)assert.notDeepEqual(discoveryDecision(f.n,{foodLearning:false}).action,{type:'sample',targetId:f.id});
  assert.equal(positives(f).size,2);assert.equal(f.n.discovery.samplesPending[f.id],pending);
});

test('current save restoration retains supported repetition and the latest overlapping pending sample',()=>{
  const f=pendingThird(),restored=validateNpc(JSON.parse(JSON.stringify(f.n)));assert.deepEqual(discoveryDecision(restored).action,{type:'sample',targetId:f.id});
  assert.equal(restored.discovery.samplesPending[f.id],f.n.discovery.samplesPending[f.id]);const pending=restored.discovery.samplesPending[f.id];f.n=restored;
  tick(f,3);assert.equal(f.n.discovery.samplesPending[f.id],pending,'older second-portion water relief cannot clear the third portion');
});

test('supported repetition still respects sensed fullness and actual bounded swallowing refusal',()=>{
  const full=pendingThird();assert.equal(ingestMaterial(full.n,{massGrams:800,energyKcal:0,waterMl:0,digestHours:24},{provenance:'explicit body capacity fixture'}).ok,true);assert.notEqual(discoveryDecision(full.n).action.type,'sample');
  const f=pendingThird();while(f.n.physiology.stomach.length<24)assert.equal(ingestMaterial(f.n,{massGrams:1,energyKcal:0,waterMl:0,digestHours:24},{provenance:'explicit input-count fixture'}).ok,true);
  assert.deepEqual(discoveryDecision(f.n).action,{type:'sample',targetId:f.id});const m=lookupEcologyObject(f.e.ecology,f.id),before=m.massGrams;
  assert.equal(act(f,{type:'sample',targetId:f.id}).code,'TOO_FULL');assert.equal(m.massGrams,before);assert.notEqual(discoveryDecision(f.n).action.type,'sample');
});

test('finite repeated consumption exhausts one held piece without adding food',()=>{
  const f=pendingThird(),initialRemoved=f.e.ecology.ledger.humanRemovedKcal,initialIngested=f.n.physiology.totals.ingestedKcal;
  let swallows=0;while(f.n.inventory.items.includes(f.id)){assert.deepEqual(discoveryDecision(f.n).action,{type:'sample',targetId:f.id});assert.equal(act(f,{type:'sample',targetId:f.id}).ok,true);assert.ok(++swallows<=3);}
  assert.equal(swallows,3);assert.equal(lookupEcologyObject(f.e.ecology,f.id),null);assert.ok(Math.abs(f.e.ecology.ledger.humanRemovedKcal-initialRemoved-47.5)<1e-10);assert.ok(Math.abs(f.n.physiology.totals.ingestedKcal-initialIngested-47.5)<1e-10);
  assert.equal(requestNpcAction(f.n,{type:'sample',targetId:f.id},f.e).code,'OBJECT_GONE');
});

test('a naturally small berry ends with a five-gram portion before two outcomes can support held reuse',()=>{
  const f=fixture('bramble');assert.equal(act(f,{type:'pull',targetId:f.plant.id}).ok,true);f.id=f.n.inventory.items[0];assert.equal(lookupEcologyObject(f.e.ecology,f.id).massGrams,35);
  assert.equal(act(f,{type:'sample',targetId:f.id}).ok,true);assert.equal(lookupEcologyObject(f.e.ecology,f.id).massGrams,5);awaitPositives(f,1);
  assert.equal(act(f,{type:'sample',targetId:f.id}).ok,true);assert.ok(!f.n.inventory.items.includes(f.id));awaitPositives(f,2);
  assert.equal(lookupEcologyObject(f.e.ecology,f.id),null);assert.ok(Math.abs(f.n.physiology.totals.ingestedKcal-19)<1e-10);assert.notDeepEqual(discoveryDecision(f.n).action,{type:'sample',targetId:f.id});
});

test('delayed discomfort from a new portion disconfirms its evidenced chain without calling nourishment false',()=>{
  const f=learned(),m=lookupEcologyObject(f.e.ecology,f.id);m.ageHours=12*24;m.spoiled=true; // Explicit aged-material surprise fixture, unchanged engine chemistry.
  assert.equal(act(f,{type:'sample',targetId:f.id}).ok,true);const hurtSample=f.n.discovery.experiments.at(-1);
  for(let i=0;i<24000&&!f.n.discovery.effects.some(e=>e.objectId===f.id&&e.effect==='discomfort');i++)tick(f);
  assert.ok(f.n.discovery.effects.some(e=>e.objectId===f.id&&e.effect==='discomfort'));assert.ok(positives(f).size>=2);
  const t=f.n.discovery.techniques.find(t=>t.sourceId===f.plant.id);assert.equal(t.confidence,'revised');assert.ok(t.evidence.includes(hurtSample.id));
  f.n.physiology.satietyHours=4;f.n.physiology.availableEnergyKcal=700;projectPhysiology(f.n); // Energy-driven care cannot erase delayed adverse evidence.
  assert.notDeepEqual(discoveryDecision(f.n).action,{type:'sample',targetId:f.id});const restored=validateNpc(JSON.parse(JSON.stringify(f.n)));assert.equal(restored.discovery.techniques.find(t=>t.sourceId===f.plant.id).confidence,'revised');
});


test('release and regrasp revise the actually attributed item chain without blanket revision of its old source',()=>{
  const f=learned();assert.equal(act(f,{type:'release',targetId:f.id}).ok,true);assert.equal(act(f,{type:'grasp',targetId:f.id}).ok,true);
  const m=lookupEcologyObject(f.e.ecology,f.id);m.ageHours=12*24;m.spoiled=true;assert.equal(act(f,{type:'sample',targetId:f.id}).ok,true);
  for(let i=0;i<24000&&!f.n.discovery.effects.some(e=>e.objectId===f.id&&e.effect==='discomfort');i++)tick(f);
  assert.ok(f.n.discovery.effects.some(e=>e.objectId===f.id&&e.effect==='discomfort'));
  assert.equal(f.n.discovery.techniques.find(t=>t.sourceId===f.id&&t.steps[0].type==='grasp').confidence,'revised');
  assert.equal(f.n.discovery.techniques.find(t=>t.sourceId===f.plant.id).confidence,'supported','a later held-item chain is not blanket proof that the original source changed');
  assert.notDeepEqual(discoveryDecision(f.n).action,{type:'sample',targetId:f.id});
  assert.equal(validateNpc(JSON.parse(JSON.stringify(f.n))).discovery.techniques.find(t=>t.sourceId===f.id).confidence,'revised');
});

test('older pending nourishment cannot silently undo experienced source disconfirmation',()=>{
  const n=createNpc({mode:'discovery',seed:74193}),e=createEnvironment(74193,{mode:'discovery'}),animal=e.ecology.animals[0];n.position={...animal.position};
  // Controlled negative fixture: ordinary finite animal stock, engine strike
  // conversion and spoil chemistry. No source recipe is inserted into memory.
  for(let i=0;i<4;i++)interactEcologyObject(e.ecology,animal.id,'strike',{actorId:n.id,position:n.position,power:4});
  const source=e.ecology.materials.find(m=>m.kind==='carcass');assert.ok(source);source.ageHours=3*24;source.spoiled=true;n.physiology.hoursSinceMeal=12;n.physiology.satietyHours=0;n.physiology.availableEnergyKcal=700;projectPhysiology(n);observeNpc(n,e);
  const f={n,e};assert.equal(act(f,{type:'pull',targetId:source.id}).ok,true);f.id=n.inventory.items[0];
  assert.equal(act(f,{type:'sample',targetId:f.id}).ok,true);awaitPositives(f,1);assert.equal(act(f,{type:'sample',targetId:f.id}).ok,true);awaitPositives(f,2);
  assert.equal(act(f,{type:'sample',targetId:f.id}).ok,true);const pendingAt=n.discovery.samplesPending[f.id];
  for(let i=0;i<24000&&!n.discovery.effects.some(e=>e.effect==='discomfort');i++)tick(f);const harmAt=n.elapsed;assert.ok(n.discovery.effects.some(e=>e.effect==='discomfort'));assert.ok(harmAt>pendingAt);
  assert.equal(n.discovery.techniques[0].confidence,'revised');awaitPositives(f,3);assert.ok(n.elapsed>harmAt);
  assert.equal(n.discovery.techniques[0].confidence,'revised');assert.notDeepEqual(discoveryDecision(n).action,{type:'pull',targetId:source.id});
  assert.equal(validateNpc(JSON.parse(JSON.stringify(n))).discovery.techniques[0].confidence,'revised');
});
