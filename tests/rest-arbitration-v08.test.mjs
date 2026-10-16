import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpc } from '../src/npc-state.js';
import { createEnvironment,tickEnvironment } from '../src/environment.js';
import { tickEcology,lookupEcologyObject } from '../src/ecology.js';
import { requestNpcAction,tickNpc,observeNpc,cancelNpcAction } from '../src/npc.js';
import { discoveryDecision,processDiscoveryFeedback } from '../src/discovery.js';
import { recordEvent,validateNpc } from '../src/npc-memory.js';
import { projectPhysiology,ingestMaterial } from '../src/biology.js';
import { bodySignals,restUnsafe } from '../src/interoception.js';
import { canStand,freshState,distance } from '../src/world.js';
import { NPC_RULES,CONFIG } from '../src/config.js';
import { writeSave,loadSave } from '../src/save.js';
import { shelterSource } from '../src/resources.js';
import { PopulationRuntime } from '../src/population.js';

let empty,earned;
function fixture(learn=false){
  if(!empty){const n=createNpc({mode:'discovery',seed:74193}),e=createEnvironment(74193,{mode:'discovery'}),plant=e.ecology.plants.find(x=>x.kind==='apple_tree'&&x.quantity>0);n.position=[{x:plant.position.x+45,y:plant.position.y},{x:plant.position.x-45,y:plant.position.y}].find(p=>canStand(p.x,p.y,'valley'));assert.ok(n.position);observeNpc(n,e);empty={n,e,plant};}
  if(learn&&!earned){const f=structuredClone(empty);f.n.physiology.hoursSinceMeal=12;projectPhysiology(f.n);assert.equal(act(f,{type:'pull',targetId:f.plant.id}).ok,true);f.id=f.n.inventory.items[0];for(let k=1;k<=2;k++){assert.equal(act(f,{type:'sample',targetId:f.id}).ok,true);for(let i=0;i<24000&&positiveCount(f)<k;i++)tick(f);assert.equal(positiveCount(f),k);}earned=f;}
  return structuredClone(learn?earned:empty);
}
function positiveCount(f){return new Set(f.n.discovery.effects.filter(x=>x.effect==='sustained'&&x.objectId===f.id).map(x=>x.ingestionId)).size;}
function tick(f,seconds=1/60){for(let i=0;i<Math.ceil(seconds*60);i++){tickEnvironment(f.e,1/60);tickEcology(f.e.ecology,1/60,f.e,[f.n]);tickNpc(f.n,1/60,f.e);processDiscoveryFeedback(f.n,{recordEffect:effect=>recordEvent(f.n,'condition',{code:'DISCOVERY_EFFECT',feedback:effect})});if(Math.round(f.n.elapsed*60)%60===0)observeNpc(f.n,f.e);}}
function act(f,action){const r=requestNpcAction(f.n,action,f.e);for(let i=0;i<120000&&f.n.active;i++)tick(f);assert.equal(f.n.active,null);return f.n.lastResult||r;}
function depleted(f,{available=40,stored=84000}={}){
  // Explicit physiological test checkpoint; learned evidence and finite material
  // come from real preceding actions. This is not an autonomous survival claim.
  Object.assign(f.n.physiology,{availableEnergyKcal:available,storedEnergyKcal:stored,fatigue:80,sleepPressure:90,hoursSinceMeal:12,waterDeficitMl:250});projectPhysiology(f.n);
}
function refuse(f,type='sleep'){const r=act(f,{type,seconds:5});assert.equal(r.code,'UNSAFE_TO_REST');return r;}
const restful=action=>['rest','sleep'].includes(action.type);

test('actual rest refusal defers both rest primitives without spending recovery energy on novelty',()=>{
  const f=fixture();depleted(f);assert.equal(discoveryDecision(f.n).action.type,'sleep');const failed=refuse(f,'rest');
  for(let i=0;i<10;i++)assert.deepEqual(discoveryDecision(f.n).action,{type:'wait',seconds:5});
  const before=f.n.physiology.availableEnergyKcal;assert.equal(act(f,discoveryDecision(f.n).action).code,'WAITED');assert.ok(f.n.physiology.availableEnergyKcal>before);assert.equal(f.n.lastResult.action,'wait');assert.equal(discoveryDecision(f.n).action.type,'wait');
  assert.ok(f.n.memory.experience.some(e=>e.id===failed.eventId));assert.equal(f.n.discovery.experiments.length,0);
});

test('irrelevant or worsening sensations do not erase a recent failure, but retry remains bounded',()=>{
  const f=fixture();depleted(f);refuse(f);f.n.physiology.stamina=1;f.n.physiology.fatigue=99;f.n.physiology.sleepPressure=99;f.n.feelings.relief=1;projectPhysiology(f.n);
  assert.equal(discoveryDecision(f.n).action.type,'wait');tick(f,60.05);assert.ok(restful(discoveryDecision(f.n).action));assert.equal(refuse(f).code,'UNSAFE_TO_REST');assert.equal(discoveryDecision(f.n).action.type,'wait');
});

test('real improvement in urgency reopens rest before the cooldown while energy still feels depleted',()=>{
  const f=fixture();depleted(f,{available:111.8});refuse(f);assert.equal(bodySignals(f.n).overall,'urgent');tick(f,2);
  assert.equal(bodySignals(f.n).energy,'depleted');assert.equal(bodySignals(f.n).overall,'distressed');assert.equal(restUnsafe(f.n),false);const d=discoveryDecision(f.n);assert.ok(restful(d.action));assert.equal(requestNpcAction(f.n,d.action,f.e).code,'STARTED');cancelNpcAction(f.n);
});

test('earned held food can precede rest after a refusal and still pays finite swallowing and digestion costs',()=>{
  const f=fixture(true);depleted(f);refuse(f);const m=lookupEcologyObject(f.e.ecology,f.id),mass=m.massGrams,energy=f.n.physiology.totals.ingestedKcal,spent=f.n.physiology.totals.metabolizedKcal;
  assert.deepEqual(discoveryDecision(f.n).action,{type:'sample',targetId:f.id});assert.equal(act(f,discoveryDecision(f.n).action).code,'SWALLOWED');assert.equal(m.massGrams,mass-30);assert.ok(Math.abs(f.n.physiology.totals.ingestedKcal-energy-95/6)<1e-9);assert.ok(f.n.physiology.totals.metabolizedKcal>spent);assert.ok(f.n.physiology.stomach.length>0);assert.equal(f.n.physiology.outsideAssistance.count,0);
  while(f.n.inventory.items.includes(f.id))assert.equal(act(f,discoveryDecision(f.n).action).code,'SWALLOWED');
  // Exhausting this piece does not fabricate another one. The next action must
  // actually acquire material from the source whose outcome was experienced.
  assert.equal(lookupEcologyObject(f.e.ecology,f.id),null);assert.deepEqual(discoveryDecision(f.n).action,{type:'pull',targetId:f.plant.id});
});

test('rest care preserves positive-association ablation and actual swallowing refusal across targets',()=>{
  const f=fixture(true);depleted(f);refuse(f);assert.equal(discoveryDecision(f.n,{foodLearning:false}).action.type,'wait');
  // Explicit zero-energy queue fixture isolates the real digestive entry bound.
  while(f.n.physiology.stomach.length<24)assert.equal(ingestMaterial(f.n,{massGrams:1,energyKcal:0,waterMl:0,digestHours:24},{provenance:'test fixture'}).ok,true);
  assert.equal(act(f,{type:'sample',targetId:f.id}).code,'TOO_FULL');assert.equal(discoveryDecision(f.n).action.type,'wait');
});

test('latest actual rest outcome survives unrelated real action rotation and ordinary save validation',()=>{
  const f=fixture();depleted(f);const refused=refuse(f);for(let i=0;i<NPC_RULES.maxExperience+10;i++)assert.equal(act(f,{type:'observe'}).ok,true);
  assert.equal(f.n.memory.experience.length,NPC_RULES.maxExperience);assert.ok(f.n.memory.experience.some(e=>e.id===refused.eventId));assert.equal(f.n.lastResult.action,'observe');
  const restored=validateNpc(JSON.parse(JSON.stringify(f.n)));assert.equal(discoveryDecision(restored).action.type,'wait');
  tick(f,370);assert.equal(restUnsafe(f.n),false);assert.equal(act(f,{type:'rest',seconds:5}).code,'RESTED');const success=f.n.lastResult.eventId;
  for(let i=0;i<NPC_RULES.maxExperience+10;i++)act(f,{type:'observe'});
  assert.ok(f.n.memory.experience.some(e=>e.id===success));assert.ok(restful(discoveryDecision(validateNpc(JSON.parse(JSON.stringify(f.n)))).action));
});

test('missing legacy body snapshots conservatively defer for a finite interval without inventing a cause',()=>{
  const f=fixture();depleted(f);const r=refuse(f),raw=JSON.parse(JSON.stringify(f.n));delete raw.memory.experience.find(e=>e.id===r.eventId).details.result.body;f.n=validateNpc(raw);
  assert.equal(discoveryDecision(f.n).action.type,'wait');tick(f,60.05);assert.ok(restful(discoveryDecision(f.n).action));
});

test('no known food, empty gut and no stores cannot be mistaken for recovered energy after waiting',()=>{
  const f=fixture();depleted(f,{available:0,stored:0});refuse(f);const starting=f.n.elapsed;
  while(f.n.elapsed-starting<120){const d=discoveryDecision(f.n);assert.ok(d.action.type==='wait'||restful(d.action));act(f,d.action);}
  assert.equal(f.n.physiology.availableEnergyKcal,0);assert.equal(f.n.physiology.totals.ingestedKcal,0);assert.equal(f.n.discovery.techniques.length,0);assert.equal(f.n.physiology.outsideAssistance.count,0);assert.equal(restUnsafe(f.n),true);assert.ok(f.n.physiology.health<100);
});

test('save and reopen retain the refused-rest context after a successful unrelated action',()=>{
  const f=fixture();depleted(f);const failed=refuse(f);act(f,{type:'wait',seconds:1});const state=freshState({mode:'legacy'});state.simulationMode='discovery';state.environment=f.e;state.agents=[f.n];state.npc=f.n;state.elapsed=f.n.elapsed;state.cardinal=null;
  const map=new Map(),store={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};assert.equal(writeSave(store,state),true);const saved=JSON.parse(store.getItem(CONFIG.saveKey)),loaded=loadSave(store);assert.equal(loaded.blocked,false);const n=loaded.state.agents[0];
  assert.equal(n.elapsed,f.n.elapsed);assert.equal(n.physiology.availableEnergyKcal,f.n.physiology.availableEnergyKcal);assert.ok(n.memory.experience.some(e=>e.id===failed.eventId));assert.equal(discoveryDecision(n).action.type,'wait');assert.equal(saved.agents[0].discovery.restDeferral,undefined,'No new executable or independent timer field is saved.');
});

test('an exhausted source still cools down during depleted rest care',()=>{
  const f=fixture(true);while(f.plant.quantity>=1){assert.equal(act(f,{type:'pull',targetId:f.plant.id}).ok,true);const extra=f.n.inventory.items.find(id=>id!==f.id);assert.ok(extra);assert.equal(act(f,{type:'release',targetId:extra}).ok,true);}
  assert.equal(act(f,{type:'release',targetId:f.id}).ok,true);depleted(f);refuse(f);
  const action=discoveryDecision(f.n).action;assert.deepEqual(action,{type:'pull',targetId:f.plant.id});assert.equal(act(f,action).code,'nothing_detached');assert.equal(discoveryDecision(f.n).action.type,'wait');assert.equal(f.plant.quantity,0);
});

test('earned source care uses an actually observed route and cannot acquire food remotely',()=>{
  const f=fixture(true);assert.equal(act(f,{type:'release',targetId:f.id}).ok,true);
  const origin={...f.n.position},destinations=[{x:origin.x+160,y:origin.y},{x:origin.x-160,y:origin.y},{x:origin.x,y:origin.y+160},{x:origin.x,y:origin.y-160}].filter(p=>canStand(p.x,p.y,'valley'));
  let walked=false;for(const target of destinations){const result=act(f,{type:'move',target});if(result.ok&&distance(f.n.position,f.plant.position)>100){walked=true;break;}}assert.ok(walked);observeNpc(f.n,f.e);depleted(f);refuse(f);
  const before={quantity:f.plant.quantity,position:{...f.n.position},spent:f.n.physiology.totals.metabolizedKcal};const decision=discoveryDecision(f.n);assert.equal(decision.action.type,'move');assert.equal(decision.need,'food');assert.equal(f.n.inventory.items.length,0);assert.equal(f.plant.quantity,before.quantity);
  const result=act(f,decision.action);assert.ok(result.ok);assert.ok(distance(f.n.position,f.plant.position)<distance(before.position,f.plant.position));assert.ok(f.n.physiology.totals.metabolizedKcal>before.spent);assert.equal(f.n.inventory.items.length,0);
  const unknown=structuredClone(f.n);delete unknown.discovery.observations[f.plant.id];unknown.discovery.run=null;assert.equal(discoveryDecision(unknown).action.type,'wait');
});


test('actual deprivation interruption of a started rest also defers a repeated request',()=>{
  const f=fixture();depleted(f,{available:113,stored:0});assert.equal(restUnsafe(f.n),false);const result=act(f,{type:'rest',seconds:5});assert.equal(result.code,'REST_INTERRUPTED');assert.ok(result.durationSeconds>0&&result.durationSeconds<5);assert.equal(discoveryDecision(f.n).action.type,'wait');
});

test('observed thermal refuge stays ahead of depleted rest care and held food',()=>{
  const f=fixture(true),refuge=shelterSource('refuge');
  // Explicit encounter start beside a real entrance, followed by actual local
  // observation and authoritative entry; not an autonomous relocation claim.
  f.n.position={x:refuge.x,y:refuge.y};observeNpc(f.n,f.e);depleted(f);f.n.thermal.hot=80;refuse(f);
  const decision=discoveryDecision(f.n);assert.deepEqual(decision.action,{type:'enter_shelter',shelterId:refuge.id});assert.equal(decision.need,'thermal');assert.equal(act(f,decision.action).code,'ENTERED_SHELTER');assert.equal(f.n.scene,refuge.id);
});

test('actual predator contact preempts depleted rest care through an observed escape route',()=>{
  const f=fixture(true),n=f.n,predator=f.e.ecology.animals.find(x=>x.species==='bobcat');const near=[{x:n.position.x+18,y:n.position.y},{x:n.position.x-18,y:n.position.y},{x:n.position.x,y:n.position.y+18}].find(p=>canStand(p.x,p.y,'valley'));assert.ok(near);
  // Controlled physical encounter, matching the existing contact regression:
  // no alternate prey, one depleted predator. This is not ecological migration.
  predator.position={...near};Object.assign(predator.physiology,{availableEnergyKcal:10,storedEnergyKcal:0,waterDeficitMl:0,hoursSinceMeal:12});projectPhysiology(predator);f.e.ecology.animals=[predator];f.e.ecology.plants=[];
  observeNpc(n,f.e);depleted(f);refuse(f);const state=freshState({mode:'legacy'});state.simulationMode='discovery';state.environment=f.e;state.agents=[n];state.npc=n;state.elapsed=n.elapsed;state.cardinal=null;const runtime=new PopulationRuntime(state,{cardinal:false});
  const start={...n.position},spent=n.physiology.totals.metabolizedKcal;for(let i=0;i<240;i++){state.elapsed+=1/60;runtime.tick(1/60);}runtime.dispose();
  const injury=n.memory.experience.find(e=>e.type==='condition'&&e.details.code==='CONTACT_INJURY');assert.ok(injury);assert.equal(injury.details.provenance,'experienced contact');assert.equal(discoveryDecision(n).need,'safety');assert.ok(distance(start,n.position)>1);assert.ok(n.physiology.totals.metabolizedKcal>spent);assert.equal(n.physiology.outsideAssistance.count,0);
});


test('malformed restored rest sensations cannot crash or invent a recovery',()=>{
  const f=fixture();depleted(f);const r=refuse(f);
  for(const thermal of [1,[],{},null,'dangerously invented']){
    const raw=JSON.parse(JSON.stringify(f.n));raw.memory.experience.find(e=>e.id===r.eventId).details.result.body.thermal=thermal;
    const n=validateNpc(raw);assert.equal(discoveryDecision(n).action.type,'wait');
  }
});

test('missing legacy scene does not invent a thermal improvement and future rest events cannot block indefinitely',()=>{
  const f=fixture();depleted(f);f.n.thermal.hot=80;const r=refuse(f),raw=JSON.parse(JSON.stringify(f.n)),event=raw.memory.experience.find(e=>e.id===r.eventId);
  delete event.details.scene;const n=validateNpc(raw);n.memory.shelters={};
  // Other care can still proceed; the malformed scene alone does not reopen rest.
  assert.equal(restful(discoveryDecision(n).action),false);
  const future=fixture();depleted(future);const failed=refuse(future);future.n.memory.experience.find(e=>e.id===failed.eventId).at=future.n.elapsed+600;
  assert.ok(restful(discoveryDecision(future.n).action));
});


test('an actual unfinished acquired piece receives one cautious trial after transient run loss and reopen',()=>{
  const f=fixture(true);depleted(f);refuse(f);assert.equal(act(f,{type:'pull',targetId:f.plant.id}).ok,true);const id=f.n.inventory.items.find(x=>x!==f.id);assert.ok(id);
  // The old supported piece is still held. A real new acquisition must not be
  // stranded behind it, nor have its source evidence promoted to item safety.
  f.n=validateNpc(JSON.parse(JSON.stringify(f.n)));assert.equal(f.n.discovery.run,null);
  assert.equal(f.n.discovery.effects.some(e=>e.objectId===id),false);const d=discoveryDecision(f.n);assert.deepEqual(d.action,{type:'sample',targetId:id});
  assert.equal(act(f,d.action).code,'SWALLOWED');assert.ok(f.n.discovery.samplesPending[id]!==undefined);assert.equal(f.n.discovery.effects.some(e=>e.objectId===id),false);
  assert.notDeepEqual(discoveryDecision(f.n).action,{type:'sample',targetId:id});
  const ablated=structuredClone(f.n);assert.equal(discoveryDecision(ablated,{foodLearning:false}).action.type,'wait');
});

test('unfinished care requires the exact earned acquisition and respects physical fullness',()=>{
  const f=fixture(true);depleted(f);refuse(f);assert.equal(act(f,{type:'pull',targetId:f.plant.id}).ok,true);const id=f.n.inventory.items.find(x=>x!==f.id);assert.ok(id);
  const noProof=structuredClone(f.n);noProof.discovery.experiments=noProof.discovery.experiments.filter(e=>e.materialId!==id);assert.notDeepEqual(discoveryDecision(noProof).action,{type:'sample',targetId:id});
  const revised=structuredClone(f.n);revised.discovery.techniques.forEach(t=>t.confidence='revised');assert.notDeepEqual(discoveryDecision(revised).action,{type:'sample',targetId:id});
  while(f.n.physiology.stomach.length<24)assert.equal(ingestMaterial(f.n,{massGrams:1,energyKcal:0,waterMl:0,digestHours:24},{provenance:'test fixture'}).ok,true);
  assert.equal(act(f,{type:'sample',targetId:id}).code,'TOO_FULL');assert.equal(discoveryDecision(f.n).action.type,'wait');
});

test('nearby learned source wins over an older remote source even when navigation evidence is absent',()=>{
  const f=fixture(true);assert.equal(act(f,{type:'release',targetId:f.id}).ok,true);assert.equal(act(f,{type:'move',target:{x:515,y:1150}}).ok,true);observeNpc(f.n,f.e);
  const bramble=f.e.ecology.plants.find(p=>p.id==='object:2');assert.ok(bramble);assert.equal(act(f,{type:'pull',targetId:bramble.id}).ok,true);const berry=f.n.inventory.items[0];assert.equal(act(f,{type:'sample',targetId:berry}).ok,true);
  for(let i=0;i<24000&&!f.n.discovery.techniques.some(t=>t.sourceId===bramble.id);i++)tick(f);assert.ok(f.n.discovery.techniques.some(t=>t.sourceId===bramble.id));
  if(f.n.inventory.items.includes(berry))assert.equal(act(f,{type:'release',targetId:berry}).ok,true);depleted(f);refuse(f);
  const raw=JSON.parse(JSON.stringify(f.n));raw.memory.cells={};f.n=validateNpc(raw);assert.ok(distance(f.n.position,bramble.position)<=80);assert.ok(distance(f.n.position,f.plant.position)>80);
  assert.deepEqual(discoveryDecision(f.n).action,{type:'pull',targetId:bramble.id});
});

test('ordinary hunger tries a second earned source when the first has no observed route',()=>{
  const f=fixture(true),apple=f.plant;
  assert.equal(act(f,{type:'release',targetId:f.id}).ok,true);
  assert.equal(act(f,{type:'move',target:{x:515,y:1150}}).ok,true);observeNpc(f.n,f.e);
  const bramble=f.e.ecology.plants.find(p=>p.id==='object:2');assert.ok(bramble);
  assert.equal(act(f,{type:'pull',targetId:bramble.id}).ok,true);
  const firstBerry=f.n.inventory.items[0];assert.equal(act(f,{type:'sample',targetId:firstBerry}).ok,true);
  for(let i=0;i<24000&&!f.n.discovery.techniques.some(t=>t.sourceId===bramble.id);i++)tick(f);
  assert.ok(f.n.discovery.techniques.some(t=>t.sourceId===bramble.id));
  if(f.n.inventory.items.includes(firstBerry))assert.equal(act(f,{type:'release',targetId:firstBerry}).ok,true);
  f.n.physiology.hoursSinceMeal=8;projectPhysiology(f.n);
  // A real failed continuation gives the nearby source one failure. The remote
  // earned source then ranks first, even though it has no observed route.
  assert.deepEqual(discoveryDecision(f.n).action,{type:'pull',targetId:bramble.id});
  assert.equal(act(f,{type:'pull',targetId:bramble.id}).ok,true);
  const portion=f.n.inventory.items[0],next=discoveryDecision(f.n);
  assert.deepEqual(next.action,{type:'sample',targetId:portion});
  assert.equal(act(f,{type:'release',targetId:portion}).ok,true);
  assert.equal(act(f,next.action).code,'NOT_HELD');
  const learned=f.n.discovery.techniques.find(t=>t.sourceId===bramble.id);
  assert.equal(learned.failures,1);
  const raw=JSON.parse(JSON.stringify(f.n));raw.memory.cells={};f.n=validateNpc(raw);
  assert.ok(distance(f.n.position,bramble.position)<=80);
  assert.ok(distance(f.n.position,apple.position)>80);
  const urgent=validateNpc(raw);urgent.physiology.hoursSinceMeal=17;projectPhysiology(urgent);
  assert.deepEqual(discoveryDecision(urgent).action,{type:'pull',targetId:bramble.id},'urgent nearby learned care retains its existing priority');
  const noAlternative=validateNpc(raw);delete noAlternative.discovery.observations[bramble.id];
  const withoutSource=discoveryDecision(noAlternative);
  assert.notEqual(withoutSource.need,'food','no observed viable alternative does not invent learned care');
  assert.notDeepEqual(withoutSource.action,{type:'pull',targetId:apple.id},'an unobserved route cannot acquire remote food');
  const failures=()=>f.n.discovery.techniques.find(t=>t.sourceId===bramble.id).failures;
  const before={apple:apple.quantity,bramble:bramble.quantity,failures:failures()};
  const chosen=discoveryDecision(f.n);
  assert.deepEqual(chosen.action,{type:'pull',targetId:bramble.id});
  assert.equal(chosen.need,'food');
  assert.deepEqual({apple:apple.quantity,bramble:bramble.quantity,failures:failures()},before);
});


test('severe pain with depletion and no observed relief does not authorize costly novelty',()=>{
  const f=fixture();depleted(f);f.n.physiology.health=20;projectPhysiology(f.n);assert.equal(bodySignals(f.n).pain,'severe');refuse(f);
  assert.deepEqual(discoveryDecision(f.n).action,{type:'wait',seconds:5});const spent=f.n.physiology.totals.metabolizedKcal;
  assert.equal(act(f,discoveryDecision(f.n).action).code,'WAITED');assert.ok(f.n.physiology.totals.metabolizedKcal>spent);assert.equal(f.n.discovery.experiments.length,0);
});
