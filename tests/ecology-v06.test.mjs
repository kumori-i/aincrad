import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, CAVE_SPAWN } from '../src/config.js';
import { createEnvironment,tickEnvironment } from '../src/environment.js';
import { createPhysiology,beginSleep,isSleeping,ingestMaterial } from '../src/biology.js';
import { createEcology,validateEcology,tickEcology,senseEcology,describeEcologyObject,renderEcology,lookupEcologyObject,interactEcologyObject,consumeEcologyMaterial,ecologyEnergy } from '../src/ecology.js';
import { ECOLOGY_RULES } from '../src/ecology-config.js';

const context=(p,actorId='aster')=>({actorId,position:{...p.position},scene:p.scene});
function advance(e,seconds,agents=[],callbacks={},weather='cloudy'){const env=createEnvironment();env.elapsed=e.elapsed;env.settings.weatherOverride=weather;for(let left=seconds;left>0;left-=.5){const dt=Math.min(left,.5);tickEnvironment(env,dt);tickEcology(e,dt,env,agents,callbacks);}return env;}
function audit(e){const ledger=e.ledger;return ecologyEnergy(e)+ledger.humanRemovedKcal+ledger.metabolizedKcal+ledger.decomposedKcal+ledger.discardedKcal-ledger.initialKcal-ledger.photosynthesisKcal-ledger.externalKcal;}
function resetBudget(e){for(const key of Object.keys(e.ledger))e.ledger[key]=0;e.ledger.initialKcal=ecologyEnergy(e);}

test('public ecology observations carry opaque appearance without a nutrition or diet oracle',()=>{
  const e=createEcology(),objects=senseEcology(e,{x:400,y:1100},'valley',1000);assert.ok(objects.length>3);
  for(const o of objects){assert.match(o.id,/^object:\d+$/);assert.deepEqual(Object.keys(o).sort(),['appearance','count','id','motion','position','scene']);assert.ok(o.appearance.shape);}
  const publicText=JSON.stringify(objects);assert.doesNotMatch(publicText,/"(?:species|kind|diet|edible|food|energyKcal|nutrition|waterMl)"/);assert.doesNotMatch(publicText,/apple|rabbit|herbivore|omnivore|carnivore/);
  assert.equal(senseEcology(undefined,{x:0,y:0}).length,0);assert.equal(renderEcology(undefined).length,0);
});
test('finite seasonal fruit requires physical detachment and does not use the old ten-minute refill',()=>{
  const e=createEcology(),p=e.plants.find(p=>p.kind==='apple_tree'),count=p.quantity;e.animals=[];resetBudget(e);
  assert.equal(interactEcologyObject(e,p.id,'grasp',context(p)).code,'object_still_attached');
  assert.equal(interactEcologyObject(e,p.id,'pull',{...context(p),position:{x:p.position.x+500,y:p.position.y}}).ok,false);
  for(let n=0;n<count;n++)assert.ok(interactEcologyObject(e,p.id,'pull',context(p)).ok);
  assert.equal(p.quantity,0);assert.equal(interactEcologyObject(e,p.id,'pull',context(p)).ok,false);
  advance(e,600);assert.equal(p.quantity,0);assert.ok(Math.abs(audit(e))<1e-6);
});
test('held sampling, ownership and failed swallowing are atomic finite transfers',()=>{
  const e=createEcology(),p=e.plants.find(p=>p.kind==='apple_tree'),pull=interactEcologyObject(e,p.id,'pull',context(p)),m=lookupEcologyObject(e,pull.materialId);
  const before=JSON.stringify(m),ledger=e.ledger.humanRemovedKcal;
  assert.equal(consumeEcologyMaterial(e,m.id,.2,{actorId:'mira'}).ok,false);
  const rejected=consumeEcologyMaterial(e,m.id,.2,{actorId:'aster',accept:()=>({ok:false,code:'TOO_FULL'})});assert.equal(rejected.code,'TOO_FULL');assert.equal(JSON.stringify(m),before);assert.equal(e.ledger.humanRemovedKcal,ledger);
  const actor={physiology:createPhysiology('human')},portion=consumeEcologyMaterial(e,m.id,.2,{actorId:'aster',accept:v=>ingestMaterial(actor,v,{objectId:m.id})});
  assert.ok(portion.ok);assert.ok(portion.ingestion.ok);assert.equal(actor.physiology.stomach[0].remainingKcal,portion.material.energyKcal);assert.equal(e.ledger.humanRemovedKcal-ledger,portion.material.energyKcal);assert.ok(Math.abs(audit(e))<1e-7);
  assert.equal(describeEcologyObject(e,m.id,{actorId:'mira'}),null);assert.ok(describeEcologyObject(e,m.id,{actorId:'aster'}));
});
test('held materials can be released in a cave and persist without duplication',()=>{
  const e=createEcology(),p=e.plants.find(p=>p.kind==='bramble'),pull=interactEcologyObject(e,p.id,'pull',context(p));
  assert.ok(interactEcologyObject(e,pull.materialId,'release',{actorId:'aster',position:{...CAVE_SPAWN},scene:'refuge'}).ok);
  const restored=validateEcology(JSON.parse(JSON.stringify(e)),{seed:e.seed,elapsed:e.elapsed});
  assert.equal(lookupEcologyObject(restored,pull.materialId).scene,'refuge');assert.ok(senseEcology(restored,CAVE_SPAWN,'refuge',100).some(o=>o.id===pull.materialId));
  assert.equal(senseEcology(restored,p.position,'valley',200).some(o=>o.id===pull.materialId),false);
});
test('grazing removes real biomass and digestion supplies rabbit energy',()=>{
  const e=createEcology(),a=e.animals.find(a=>a.species==='rabbit'),g=e.plants.find(p=>p.kind==='grass');e.animals=[a];e.plants=[g];a.position={...g.position};a.homePosition={...g.position};a.physiology.hoursSinceMeal=12;
  const biomass=g.biomassGrams;resetBudget(e);advance(e,60);
  assert.ok(g.biomassGrams<biomass);assert.ok(a.physiology.totals.ingestedKcal>0);assert.ok(a.physiology.totals.absorbedKcal>0);assert.ok(Math.abs(audit(e))<1e-6);
});
test('bobcats pursue to contact and consume a single finite carcass',()=>{
  const e=createEcology(),cat=e.animals.find(a=>a.species==='bobcat'),prey=e.animals.find(a=>a.species==='rabbit');e.animals=[cat,prey];e.plants=[];
  cat.position={x:276,y:470};cat.homePosition={...cat.position};cat.physiology.hoursSinceMeal=16;
  prey.position={x:306,y:470};prey.homePosition={...prey.position};prey.physiology.stamina=0;prey.stamina=0;
  resetBudget(e);advance(e,12);assert.equal(e.deaths,1);assert.equal(e.animals.length,1);assert.equal(e.materials.filter(m=>m.kind==='carcass').length,1);assert.ok(cat.physiology.totals.ingestedKcal>0);assert.ok(Math.abs(audit(e))<1e-6);
});
test('foxes eat plant material and can hunt mammals when alternatives are unavailable',()=>{
  const e=createEcology(),fox=e.animals.find(a=>a.species==='fox'),bramble=e.plants.find(p=>p.kind==='bramble');e.animals=[fox];e.plants=[bramble];fox.position={...bramble.position};fox.homePosition={...bramble.position};fox.physiology.hoursSinceMeal=15;
  const count=bramble.quantity;resetBudget(e);advance(e,40);assert.ok(bramble.quantity<count);assert.ok(fox.physiology.totals.ingestedKcal>0);
  const prey=createEcology().animals.find(a=>a.species==='rabbit');prey.id='object:999';prey.position={x:306,y:470};prey.physiology.stamina=0;prey.stamina=0;
  fox.position={x:276,y:470};fox.physiology.hoursSinceMeal=25;fox.physiology.stomach=[];e.animals.push(prey);e.plants=[];e.materials=[];resetBudget(e);advance(e,18);
  assert.equal(e.deaths,1);assert.ok(e.materials.some(m=>m.kind==='carcass'));assert.ok(Math.abs(audit(e))<1e-6);
});
test('sleep is stationary and deprivation can wake an animal without providing energy',()=>{
  const e=createEcology(),a=e.animals.find(a=>a.species==='rabbit');e.animals=[a];e.plants=[];
  assert.ok(beginSleep(a,{hours:3}).ok);const position={...a.position},before=a.physiology.availableEnergyKcal+a.physiology.storedEnergyKcal;advance(e,40);
  assert.ok(isSleeping(a));assert.deepEqual(a.position,position);assert.ok(a.physiology.availableEnergyKcal+a.physiology.storedEnergyKcal<before);
  a.physiology.waterDeficitMl=150;advance(e,.5);assert.equal(isSleeping(a),false);assert.ok(a.physiology.sleep.inertiaHours>0);assert.equal(a.physiology.outsideAssistance.count,0);
});
test('dangerous contact wakes and wounds humans while divine collapse creates no edible body',()=>{
  const e=createEcology(),cat=e.animals.find(a=>a.species==='bobcat');e.animals=[cat];e.plants=[];cat.position={x:276,y:470};cat.physiology.availableEnergyKcal=0;cat.physiology.storedEnergyKcal=0;cat.energy=0;cat.physiology.hoursSinceMeal=30;
  const human={id:'aster',scene:'valley',position:{x:286,y:470},lifecycle:'AWAKE'},hits=[],wakes=[];
  advance(e,3,[human],{harm:(actor,event)=>hits.push({actor,event}),wake:(actor,event)=>wakes.push({actor,event})});assert.ok(hits.length>0);assert.ok(wakes.length>0);assert.ok(hits.every(h=>h.event.damage>0&&h.event.damage<=ECOLOGY_RULES.maxHumanAttackDamage));
  human.lifecycle='COLLAPSED';const count=hits.length;advance(e,4,[human],{harm:(_,event)=>hits.push(event)});assert.equal(hits.length,count);assert.equal(e.materials.some(m=>m.kind==='carcass'),false);
});
test('births transfer a finite maternal reserve rather than creating food energy',()=>{
  const e=createEcology(),rabbits=e.animals.filter(a=>a.species==='rabbit').slice(0,2);e.animals=rabbits;e.plants=e.plants.filter(p=>p.kind==='grass').slice(0,8);e.plants.forEach((p,i)=>{p.position={x:240+(i%4)*30,y:470+Math.floor(i/4)*40};});
  for(let i=0;i<2;i++){const a=rabbits[i];a.position={x:276+i*40,y:470};a.homePosition={...a.position};a.physiology.availableEnergyKcal=70;a.physiology.storedEnergyKcal=600;a.physiology.hoursSinceMeal=0;a.energy=100;a.lastBirthHours=-1000;}
  resetBudget(e);advance(e,.5);assert.ok(e.births>0);assert.ok(e.ledger.birthTransferredKcal>0);assert.ok(e.animals.length<=ECOLOGY_RULES.maxAnimals);assert.ok(Math.abs(audit(e))<1e-6);
});
test('death and decomposition transfer bounded tissue to detritus and soil nutrients',()=>{
  const e=createEcology(),a=e.animals[0];e.animals=[a];e.plants=[];a.physiology.availableEnergyKcal=0;a.physiology.storedEnergyKcal=0;a.physiology.health=.001;a.health=.001;
  resetBudget(e);advance(e,.5);assert.equal(e.deaths,1);assert.equal(e.animals.length,0);const corpse=e.materials.find(m=>m.kind==='carcass');assert.ok(corpse);
  corpse.ageHours=24*20;const nutrients=e.detritus.nutrients;advance(e,60);assert.ok(e.detritus.massGrams>0);assert.ok(e.ledger.decomposedKcal>0);assert.ok(e.detritus.nutrients>nutrients);assert.ok(Math.abs(audit(e))<1e-6);
});
test('validation bounds hostile data and preserves valid ecosystem state',()=>{
  const e=createEcology();assert.deepEqual(validateEcology(JSON.parse(JSON.stringify(e)),{seed:e.seed,elapsed:e.elapsed}),e);
  const p=e.plants[0],pull=interactEcologyObject(e,p.id,'pull',context(p));lookupEcologyObject(e,pull.materialId).energyKcal=1e12;e.animals[0].species='dragon';e.materials[0].script='eval(1)';e.plants.push({...e.plants[0]});
  const restored=validateEcology(e);assert.ok(!restored.animals.some(a=>a.species==='dragon'));assert.ok(lookupEcologyObject(restored,pull.materialId).energyKcal<=95);assert.equal('script'in restored.materials[0],false);assert.equal(new Set(restored.plants.map(p=>p.id)).size,restored.plants.length);
});
test('two game weeks of a grazing colony remain bounded and conserve the ecological energy budget',()=>{
  const e=createEcology(),rabbits=e.animals.filter(a=>a.species==='rabbit').slice(0,2),plants=e.plants.slice(0,6);e.animals=rabbits;e.plants=plants;
  rabbits.forEach((a,i)=>{a.position={...plants[2+i].position};a.homePosition={...a.position};});resetBudget(e);advance(e,CONFIG.dayRealSeconds*14,[],{},null);
  assert.ok(e.animals.length>=2&&e.animals.length<=ECOLOGY_RULES.maxAnimals);assert.ok(rabbits.every(a=>e.animals.includes(a)&&a.health>70&&a.physiology.totals.ingestedKcal>500));assert.ok(e.animals.every(a=>a.health>0));assert.ok(e.plants.every(p=>p.biomassGrams>=0&&p.quantity>=0));assert.ok(e.materials.length<=ECOLOGY_RULES.maxMaterials);assert.ok(Math.abs(audit(e))<1e-5);assert.ok(e.ledger.photosynthesisKcal>0);
});
