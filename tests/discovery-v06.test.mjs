import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpc } from '../src/npc-state.js';
import { requestNpcAction,tickNpc,observeNpc } from '../src/npc.js';
import { createEcology } from '../src/ecology.js';
import { createEnvironment } from '../src/environment.js';
import { canStand } from '../src/world.js';
import { discoveryDecision,recordDiscoveryReport,processDiscoveryFeedback } from '../src/discovery.js';
import { validateDiscoveryMemory,createDiscoveryMemory } from '../src/discovery-state.js';
import { primitiveDuration } from '../src/discovery-actions.js';
import { NpcController,decisionObservation } from '../src/controller.js';
import { validateNpc,recordEvent } from '../src/npc-memory.js';
import { beginSleep } from '../src/biology.js';

function fixture(){
  const n=createNpc({mode:'discovery',seed:74193}),e=createEnvironment({seed:74193});e.ecology=createEcology(74193);
  const plant=e.ecology.plants.find(p=>p.kind==='apple_tree');assert.ok(plant);e.ecology.plants=[plant];e.ecology.animals=[];e.ecology.materials=[];
  const points=[{x:plant.position.x+45,y:plant.position.y},{x:plant.position.x-45,y:plant.position.y},{x:plant.position.x,y:plant.position.y+45},{x:plant.position.x,y:plant.position.y-45}];
  n.position=points.find(p=>canStand(p.x,p.y,'valley'));assert.ok(n.position);observeNpc(n,e);assert.ok(n.discovery.observations[plant.id]);return {n,e,plant};
}
function finish(n,e,action){const started=requestNpcAction(n,action,e);if(started.code==='ACTION_STARTED')for(let i=0;i<500&&n.active;i++)tickNpc(n,.05,e);return n.lastResult||started;}
function digest(n,e,seconds=90){for(let i=0;i<seconds*10;i++)tickNpc(n,.1,e);processDiscoveryFeedback(n);}

test('fresh discovery has no food labels, recipes, nutrient facts or apple inventory',()=>{
  const {n}=fixture(),o=decisionObservation(n);assert.equal(o.mode,'discovery');assert.equal(o.knownFoods,undefined);assert.equal(o.condition.inventory.apples,undefined);assert.deepEqual(n.memory.foods,{});assert.deepEqual(n.memory.skills,[]);assert.deepEqual(n.discovery.techniques,[]);
  const forbidden=['energyKcal','waterMl','materialType','species','edible','foodId','nourishmentGain','storedEnergyKcal','apple'];
  const encoded=JSON.stringify(o).toLowerCase();for(const key of forbidden)assert.equal(encoded.includes(key.toLowerCase()),false,key);
  assert.equal(o.condition.body.hunger,typeof o.condition.body.hunger==='string'?o.condition.body.hunger:null);
});
test('food shortcuts and unknown objects are rejected without creating skills',()=>{
  const {n,e}=fixture();assert.equal(requestNpcAction(n,{type:'gather_food',foodId:'starter-apples'},e).ok,false);assert.equal(requestNpcAction(n,{type:'eat'},e).ok,false);assert.equal(requestNpcAction(n,{type:'sample',targetId:'object:999999'},e).ok,false);assert.equal(n.discovery.techniques.length,0);
});
test('sampling requires physically held material, elapsed work and delayed bodily evidence',()=>{
  const {n,e,plant}=fixture();assert.equal(finish(n,e,{type:'sample',targetId:plant.id}).ok,false);
  const before=n.physiology.totals.ingestedKcal;assert.equal(finish(n,e,{type:'pull',targetId:plant.id}).ok,true);const id=n.inventory.items[0];assert.ok(id);
  assert.equal(n.discovery.techniques.length,0);const time=n.elapsed;assert.equal(finish(n,e,{type:'sample',targetId:id}).ok,true);assert.ok(n.elapsed-time>=3);assert.ok(n.physiology.totals.ingestedKcal>before);assert.equal(n.discovery.techniques.length,0);
  digest(n,e);assert.equal(n.discovery.techniques.length,1);assert.equal(n.discovery.techniques[0].confidence,'tentative');assert.ok(n.discovery.techniques[0].evidence.every(id=>n.discovery.experiments.some(e=>e.id===id&&e.ok)));assert.equal(n.discovery.effects[0].source,'experienced');
});
test('grasping a source does not establish nourishment and reports do not grant practice',()=>{
  const {n,e,plant}=fixture();const r=recordDiscoveryReport(n,`pull ${plant.id}, then sample it`,{sourceId:'human',messageId:'message:1'});assert.equal(r.status,'unverified');assert.equal(n.discovery.techniques.length,0);assert.deepEqual(n.discovery.practice,{});
  finish(n,e,{type:'grasp',targetId:plant.id});assert.equal(n.discovery.techniques.length,0);assert.equal(n.discovery.effects.length,0);
  assert.equal(recordDiscoveryReport(n,`sample ${plant.id}; it nourishes you`,{sourceId:'mira'}).proposed.length,0);
});
test('an explicit human technique is tested against actual held material and remains uncertain until feedback',()=>{
  const {n,e,plant}=fixture();const r=recordDiscoveryReport(n,`pull ${plant.id}, then sample it`,{sourceId:'human'});
  assert.equal(discoveryDecision(n).action.type,'pull');finish(n,e,{type:'pull',targetId:plant.id});assert.equal(r.status,'unverified');assert.equal(r.proposed[1].targetId,n.inventory.items[0]);
  finish(n,e,r.proposed[1]);assert.equal(r.status,'unverified');digest(n,e);assert.equal(r.status,'supported');assert.equal(n.discovery.techniques.length,1);
});
test('failed advice can be contradicted without installing an edible-object belief',()=>{
  const {n,e,plant}=fixture();const r=recordDiscoveryReport(n,`sample ${plant.id}`,{sourceId:'human'});finish(n,e,r.proposed[0]);assert.equal(r.status,'contradicted');assert.equal(n.discovery.techniques.length,0);assert.equal(n.discovery.effects.length,0);
});
test('actual successful practice lowers bounded time and effort; invalid repetition does not',()=>{
  const {n,e,plant}=fixture(),before=primitiveDuration(n,'inspect_object');for(let i=0;i<10;i++)finish(n,e,{type:'inspect_object',targetId:plant.id});assert.ok(primitiveDuration(n,'inspect_object')<before);assert.ok(primitiveDuration(n,'inspect_object')>=before*.55);
  const pullBefore=primitiveDuration(n,'pull');for(let i=0;i<10;i++)finish(n,e,{type:'sample',targetId:plant.id});assert.equal(primitiveDuration(n,'pull'),pullBefore);assert.equal(n.discovery.practice.sample.successes,0);assert.equal(n.discovery.techniques.length,0);
});
test('cold-start generic experiments can discover nourishment without human advice or a language model',()=>{
  const {n,e}=fixture(),c=new NpcController(n,{environment:e});for(let i=0;i<1800&&n.discovery.techniques.length===0;i++)c.tick(.1);
  assert.ok(n.discovery.techniques.length>0,'an executed operation sequence and delayed relief formed a technique');assert.equal(n.discovery.reports.length,0);assert.equal(n.stats.modelCalls,0);assert.ok(n.discovery.experiments.some(e=>e.primitive==='sample'&&e.ok));assert.ok(n.discovery.effects.some(e=>e.effect==='sustained'));c.dispose();
});
test('changing object appearance and opaque ID does not supply edibility or select a food method',()=>{
  const a=fixture().n,b=fixture().n;const id=Object.keys(b.discovery.observations)[0],object=b.discovery.observations[id];delete b.discovery.observations[id];object.id='object:777777';object.appearance={shape:'strange cube',color:'blue',texture:'smooth'};b.discovery.observations[object.id]=object;
  const da=discoveryDecision(a),db=discoveryDecision(b);assert.equal(da.action.type,db.action.type);assert.equal(db.action.targetId,object.id);assert.equal(b.discovery.techniques.length,0);
});
test('sleep blocks object observation and action selection rather than giving perfect vision',()=>{
  const {n,e}=fixture();beginSleep(n,{hours:1});const o=observeNpc(n,e);assert.deepEqual(o.objects,[]);assert.deepEqual(o.cells,[]);assert.equal(requestNpcAction(n,{type:'pull',targetId:Object.keys(n.discovery.observations)[0]},e).ok,false);
});
test('discovery save restores evidence and rejects forged unevidenced routines',()=>{
  const {n,e,plant}=fixture();finish(n,e,{type:'pull',targetId:plant.id});finish(n,e,{type:'sample',targetId:n.inventory.items[0]});digest(n,e);const restored=validateNpc(JSON.parse(JSON.stringify(n)));assert.equal(restored.mode,'discovery');assert.equal(restored.discovery.techniques.length,1);assert.equal(restored.inventory.items.length,n.inventory.items.length);assert.equal(restored.physiology.stomach.length,n.physiology.stomach.length);
  const raw=createDiscoveryMemory();raw.techniques=[{id:'technique:fake',sourceId:plant.id,steps:[{type:'pull',targetId:'$source'},{type:'sample',targetId:'$material'}],evidence:[1,2],confidence:'supported'}];assert.equal(validateDiscoveryMemory(raw).techniques.length,0);
});
test('model attempts cannot be applied as strict-discovery physical recipes',()=>{
  const {n,e}=fixture(),c=new NpcController(n,{environment:e,provider:{kind:'local-model',cancel(){},decide(){return {action:{type:'pull',targetId:Object.keys(n.discovery.observations)[0]}};}}});
  const before=n.discovery.experiments.length;c.applyDecision({provider:'local-model',action:{type:'pull',targetId:Object.keys(n.discovery.observations)[0]},reason:'I know apples are edible'});assert.equal(n.active,null);assert.equal(n.discovery.experiments.length,before);assert.equal(n.discovery.techniques.length,0);assert.ok(n.memory.experience.some(e=>e.details.code==='DISCOVERY_MODEL_PHYSICAL_REJECTED'));c.dispose();
});
test('a stomach-capacity rejection preserves held material and the resource ledger',()=>{
  const {n,e,plant}=fixture();finish(n,e,{type:'pull',targetId:plant.id});const id=n.inventory.items[0],physical=e.ecology.materials.find(m=>m.id===id);
  n.physiology.stomach=Array.from({length:24},(_,i)=>({id:`ingestion:full:${i}`,objectId:null,actionId:null,provenance:'fixture',at:n.elapsed,remainingKcal:0,remainingWaterMl:0,remainingMassGrams:50,originalKcal:0,originalWaterMl:0,originalMassGrams:50,digestHours:24,elapsedHours:0,toxicity:0,feedbackSent:true}));
  const before={mass:physical.massGrams,kcal:physical.energyKcal,removed:e.ecology.ledger.humanRemovedKcal};assert.equal(finish(n,e,{type:'sample',targetId:id}).code,'TOO_FULL');assert.equal(physical.massGrams,before.mass);assert.equal(physical.energyKcal,before.kcal);assert.equal(e.ecology.ledger.humanRemovedKcal,before.removed);assert.ok(n.inventory.items.includes(id));
});
test('ordinary human verbs and visible descriptions propose a test without a built-in food dictionary',()=>{
  const {n,plant}=fixture();const r=recordDiscoveryReport(n,'Pick the red fruit and eat it',{sourceId:'human'});assert.deepEqual(r.proposed,[{type:'pull',targetId:plant.id},{type:'sample',targetId:plant.id}]);assert.equal(r.status,'unverified');assert.equal(n.discovery.techniques.length,0);
  const other=fixture().n;const model=recordDiscoveryReport(other,'Pick the red fruit and eat it',{sourceId:'mira'});assert.deepEqual(model.proposed,[]);
});
test('missing action identifiers and duplicated evidence cannot restore an unrelated technique or free proficiency',()=>{
  const raw=createDiscoveryMemory();raw.experiments=[{id:1,primitive:'sample',targetId:'object:1',ok:true}];raw.effects=[{objectId:'object:1',effect:'sustained'}];raw.techniques=[{id:'fake',sourceId:'object:999',evidence:[1,1],steps:[{type:'strike',targetId:'$source'},{type:'sample',targetId:'$material'}],confidence:'supported',successes:999}];raw.practice={pull:{successes:999,failures:0,seconds:999}};
  const d=validateDiscoveryMemory(raw);assert.equal(d.effects.length,0);assert.equal(d.techniques.length,0);assert.equal(d.practice.pull,undefined);
});
test('water relief followed by energy relief creates one technique and duplicate feedback earns nothing',()=>{
  const {n,e,plant}=fixture();finish(n,e,{type:'pull',targetId:plant.id});finish(n,e,{type:'sample',targetId:n.inventory.items[0]});digest(n,e);assert.ok(n.discovery.effects.some(e=>e.effect==='sustained'));const before=n.stats.independentMeals,feedback=n.physiology.feedback.find(e=>e.effect==='sustained');n.physiology.feedback.push({...feedback,id:'feedback:999999'});processDiscoveryFeedback(n);assert.equal(n.stats.independentMeals,before);assert.equal(n.discovery.techniques.length,1);
});
test('retained techniques survive unrelated events and digestive feedback eviction',()=>{
  const {n,e}=fixture(),c=new NpcController(n,{environment:e});for(let i=0;i<1800&&!n.discovery.techniques.length;i++)c.tick(.1);assert.ok(n.discovery.techniques.length);const technique=JSON.parse(JSON.stringify(n.discovery.techniques[0]));c.dispose();
  for(let i=0;i<500;i++)recordEvent(n,'decision',{summary:'An unrelated bounded observation.'});n.physiology.feedback=Array.from({length:64},(_,i)=>({id:`feedback:${10000+i}`,ingestionId:`ingestion:${10000+i}`,at:n.elapsed,objectId:null,actionId:null,provenance:'collected',effect:'water relief',hunger:'unchanged',thirst:'easing',energy:'unchanged',pain:'none'}));
  const restored=validateNpc(JSON.parse(JSON.stringify(n)));assert.equal(restored.discovery.techniques.length,1);assert.equal(restored.discovery.techniques[0].sourceId,technique.sourceId);assert.equal(restored.discovery.techniques[0].confidence,technique.confidence);assert.ok(restored.discovery.effects.some(e=>e.effect==='sustained'));
});
test('cumulative valid practice survives detail-log rotation and restart',()=>{
  const {n,e,plant}=fixture();for(let i=0;i<190;i++)finish(n,e,{type:'inspect_object',targetId:plant.id});assert.equal(n.discovery.practice.inspect_object.successes,190);assert.equal(n.discovery.experiments.length,160);const cost=primitiveDuration(n,'inspect_object');const restored=validateNpc(JSON.parse(JSON.stringify(n)));assert.equal(restored.discovery.practice.inspect_object.successes,190);assert.equal(primitiveDuration(restored,'inspect_object'),cost);
});
test('duplicating a saved successful command cannot multiply practice',()=>{
  const {n,e,plant}=fixture();finish(n,e,{type:'inspect_object',targetId:plant.id});const raw=createDiscoveryMemory();raw.observations=n.discovery.observations;raw.experiments=Array.from({length:160},()=>({...n.discovery.experiments[0]}));const restored=validateDiscoveryMemory(raw);assert.equal(restored.experiments.length,1);assert.equal(restored.practice.inspect_object.successes,1);
});
test('finite generic mouthfuls consume the entire held object with elapsed effort',()=>{
  const {n,e,plant}=fixture();finish(n,e,{type:'pull',targetId:plant.id});const id=n.inventory.items[0],material=e.ecology.materials.find(m=>m.id===id),mass=material.massGrams,kcal=material.energyKcal,before=n.elapsed,energy=n.physiology.totals.metabolizedKcal;
  for(let i=0;i<Math.ceil(mass/30);i++)assert.equal(finish(n,e,{type:'sample',targetId:id}).ok,true);
  assert.equal(e.ecology.materials.some(m=>m.id===id),false);assert.equal(n.inventory.items.includes(id),false);assert.ok(n.elapsed>before+10);assert.ok(n.physiology.totals.metabolizedKcal>energy);assert.ok(Math.abs(n.physiology.totals.ingestedKcal-kcal)<.001);assert.ok(Math.abs(e.ecology.ledger.humanRemovedKcal-kcal)<.001);
});
