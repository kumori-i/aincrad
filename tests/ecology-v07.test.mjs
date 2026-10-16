import {legacyEcology} from './legacy-save-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createEcology,validateEcology,migrateEcologyDistribution,ecologyCoverage,ecologyEnergy,tickEcology,senseEcology,lookupEcologyObject,interactEcologyObject} from '../src/ecology.js';
import {ECOLOGY_RULES,ECOLOGY_SPECIES} from '../src/ecology-config.js';
import {createWorldRules,validateWorldRules,getWorldRule,getWorldRules,applyWorldRules,WORLD_RULE_LIMITS} from '../src/world-rules.js';
import {canStandOutside,distance,waterDistance} from '../src/world.js';

const audit=e=>ecologyEnergy(e)+e.ledger.humanRemovedKcal+e.ledger.metabolizedKcal+e.ledger.decomposedKcal+e.ledger.discardedKcal-e.ledger.initialKcal-e.ledger.photosynthesisKcal-e.ledger.externalKcal;
const advance=(e,seconds,env={})=>{for(let i=0;i<seconds/.5;i++)tickEcology(e,.5,env);};
const quadrant=p=>`${p.y<0?'north':'south'}${p.x<0?'West':'East'}`;

test('regional producers cover the valley while consumers concentrate in supported habitats',()=>{
  for(const seed of [3,74193,119311]){
    const e=createEcology(seed),coverage=ecologyCoverage(e);
    assert.equal(coverage.plantRegions,49);assert.ok(coverage.animalRegions>=8&&coverage.animalRegions<49);
    assert.ok(coverage.bounds.minX<-19000&&coverage.bounds.maxX>19000&&coverage.bounds.minY<-19000&&coverage.bounds.maxY>19000);
    for(const kind of ['apple_tree','bramble','grass'])assert.equal(new Set(e.plants.filter(p=>p.kind===kind).map(p=>quadrant(p.position))).size,4,kind);
    assert.equal(new Set(e.animals.filter(a=>a.species==='rabbit').map(a=>quadrant(a.position))).size,4);
    assert.ok(coverage.species.fox<=2&&coverage.species.bobcat<=2);
    for(const p of e.plants)assert.ok(canStandOutside(p.position.x,p.position.y,10));
    for(const a of e.animals){assert.ok(canStandOutside(a.position.x,a.position.y,ECOLOGY_SPECIES[a.species].radius));assert.ok(e.plants.some(p=>p.kind==='grass'&&distance(p.position,a.position)<600));}
    assert.ok(e.plants.length<=ECOLOGY_RULES.maxPlants&&e.animals.length<=ECOLOGY_RULES.maxAnimals);
    assert.deepEqual(validateEcology(JSON.parse(JSON.stringify(e)),{seed,elapsed:0}),e);
    assert.deepEqual(createEcology(seed),e);
  }
});

test('old discovery habitats partition existing stocks once without adding objects or energy',()=>{
  const original=createEcology();original.distributionVersion=1;
  original.plants=original.plants.filter(p=>Math.abs(p.position.x)<2000&&Math.abs(p.position.y)<2000);
  original.animals=original.animals.filter(a=>Math.abs(a.position.x)<2000&&Math.abs(a.position.y)<2000);
  const source=original.plants.find(p=>p.kind==='apple_tree');
  const detached=interactEcologyObject(original,source.id,'pull',{actorId:'aster',position:source.position});assert.ok(detached.ok);
  source.quantity=0;original.ledger.initialKcal=ecologyEnergy(original);original.ledger.externalKcal=0;original.ledger.discardedKcal=0;
  const existing=JSON.parse(JSON.stringify({plants:original.plants,animals:original.animals,materials:original.materials}));
  const result=migrateEcologyDistribution(original);assert.ok(result.changed);assert.equal(result.addedPlants,0);assert.equal(result.addedAnimals,0);assert.equal(result.externalKcal,0);
  assert.equal(original.ledger.externalKcal,result.externalKcal);assert.ok(Math.abs(audit(original))<1e-6);
  for(const group of ['plants','animals','materials'])for(const object of existing[group])assert.deepEqual(original[group].find(o=>o.id===object.id),object);
  assert.equal(lookupEcologyObject(original,source.id).quantity,0);assert.equal(lookupEcologyObject(original,detached.materialId).heldBy,'aster');
  const count=original.plants.length,saved=validateEcology(JSON.parse(JSON.stringify(original)));assert.equal(saved.distributionVersion,3);
  assert.equal(migrateEcologyDistribution(saved).changed,false);assert.equal(saved.plants.length,count);
  saved.plants=[];saved.animals=[];assert.equal(migrateEcologyDistribution(saved).changed,false);assert.equal(saved.plants.length,0);
});

test('invalid remote placement never falls back to the starting area',()=>{
  const e=createEcology();e.plants[0].position={x:24000,y:24000};e.animals[0].position={x:24000,y:24000};
  assert.throws(()=>validateEcology(e),/Protected lifecycle save/);
  const plantId=e.plants[0].id,animalId=e.animals[0].id,restored=validateEcology(legacyEcology(e));
  assert.equal(lookupEcologyObject(restored,plantId),null);assert.equal(lookupEcologyObject(restored,animalId),null);
  assert.equal(restored.plants.length,e.plants.length-1);assert.equal(restored.animals.length,e.animals.length-1);
});

test('remote local sensing uses real opaque objects and excludes distant habitats',()=>{
  const e=createEcology(),remote=e.plants.find(p=>p.position.x<-19000&&p.position.y<-19000),objects=senseEcology(e,remote.position,'valley',500);
  assert.ok(objects.length>=2&&objects.some(o=>o.id===remote.id));assert.ok(objects.every(o=>distance(o.position,remote.position)<=500));
  assert.doesNotMatch(JSON.stringify(objects),/"(?:species|kind|diet|energyKcal|waterMl)"|apple|rabbit|carnivore/);
  assert.ok(!objects.some(o=>distance(o.position,{x:276,y:760})<500));
});

test('dehydrated predators navigate physical pond and lake banks instead of stalling',()=>{
  for(const point of [{x:9000,y:-6750},{x:11900,y:15100},{x:-7200,y:-6500}]){
    const e=createEcology(),cat=e.animals.find(a=>a.species==='bobcat');e.animals=[cat];e.plants=[];
    cat.position={...point};cat.homePosition={...point};cat.physiology.waterDeficitMl=600;cat.physiology.sleepPressure=0;cat.physiology.fatigue=0;
    const before=cat.physiology.waterDeficitMl;
    for(let i=0;i<360;i++){
      const old={...cat.position};tickEcology(e,.5,{settings:{hourOverride:12,weatherOverride:'clear'}});
      assert.ok(canStandOutside(cat.position.x,cat.position.y,14));assert.ok(distance(old,cat.position)<100);
    }
    assert.ok(cat.physiology.waterDeficitMl<before*.5,JSON.stringify({point,position:cat.position,waterDistance:waterDistance(cat.position.x,cat.position.y),deficit:cat.physiology.waterDeficitMl}));
    assert.ok(e.ledger.waterConsumedMl>=300);assert.ok(cat.health>90);
  }
});

test('world-rule patches are bounded atomic and revision checked without modifying agent state',()=>{
  const environment={worldRules:createWorldRules()},npc={memory:{secret:'retained'},physiology:{availableEnergyKcal:37}},npcBefore=JSON.stringify(npc);
  const before=JSON.stringify(environment);assert.equal(applyWorldRules(environment,{plantGrowthMultiplier:2,availableEnergyKcal:500}).ok,false);assert.equal(JSON.stringify(environment),before);
  assert.equal(applyWorldRules(environment,{parameter:'plantGrowthMultiplier',value:2},{expectedRevision:0}).ok,true);
  assert.equal(getWorldRule(environment,'plantGrowthMultiplier'),2);assert.equal(environment.worldRules.revision,1);
  assert.equal(applyWorldRules(environment,{plantGrowthMultiplier:3},{expectedRevision:0}).code,'WORLD_RULE_REVISION_CHANGED');
  for(const value of [NaN,Infinity,-1,100])assert.equal(applyWorldRules(environment,{plantGrowthMultiplier:value}).ok,false);
  assert.equal(applyWorldRules(environment,JSON.parse('{"__proto__": 2}')).ok,false);assert.equal(getWorldRule(environment,'toString'),undefined);
  assert.equal(JSON.stringify(npc),npcBefore);assert.deepEqual(getWorldRules(environment),environment.worldRules.values);
  assert.ok(Object.isFrozen(getWorldRules(environment)));
  const hostile={version:1,revision:3,values:{plantGrowthMultiplier:1e99,windMultiplier:NaN,extra:'script'}};
  const restored=validateWorldRules(hostile);assert.equal(restored.values.plantGrowthMultiplier,WORLD_RULE_LIMITS.plantGrowthMultiplier.max);assert.equal(restored.values.windMultiplier,1);assert.equal('extra'in restored.values,false);
});

test('Cardinal plant settings alter actual finite growth with an unchanged energy ledger',()=>{
  const base=createEcology(),plant=base.plants.find(p=>p.kind==='grass');base.plants=[plant];base.animals=[];plant.biomassGrams=700;
  const clone=JSON.parse(JSON.stringify(base));
  const control={worldRules:createWorldRules()},candidate={worldRules:createWorldRules()};assert.ok(applyWorldRules(candidate,{plantGrowthMultiplier:2}).ok);
  advance(base,120,control);advance(clone,120,candidate);
  assert.ok(clone.plants[0].biomassGrams>base.plants[0].biomassGrams+10);assert.ok(clone.ledger.photosynthesisKcal>base.ledger.photosynthesisKcal);
  const controlEnergy=ecologyEnergy(base)-base.ledger.photosynthesisKcal,candidateEnergy=ecologyEnergy(clone)-clone.ledger.photosynthesisKcal;assert.ok(Math.abs(controlEnergy-candidateEnergy)<1e-7);
  assert.equal(clone.ledger.externalKcal,0);
});

test('ecosystem transfer totals survive deaths and restoration without energy duplication',()=>{
  const e=createEcology(),rabbit=e.animals.find(a=>a.species==='rabbit'),grass=e.plants.find(p=>p.kind==='grass');e.animals=[rabbit];e.plants=[grass];rabbit.position={...grass.position};rabbit.homePosition={...grass.position};rabbit.physiology.hoursSinceMeal=12;
  advance(e,60);assert.ok(e.ledger.animalAbsorbedKcal>0);assert.ok(e.ledger.animalAbsorbedWaterMl>0);assert.ok(e.ledger.animalWaterLostMl>0);
  const absorbed=e.ledger.animalAbsorbedKcal;rabbit.physiology.health=0;rabbit.health=0;rabbit.physiology.waterDeficitMl=1300;advance(e,.5);assert.equal(e.animals.length,0);assert.ok(e.ledger.animalAbsorbedKcal>=absorbed);
  const restored=validateEcology(JSON.parse(JSON.stringify(e)));assert.equal(restored.ledger.animalAbsorbedKcal,e.ledger.animalAbsorbedKcal);assert.equal(restored.ledger.animalWaterLostMl,e.ledger.animalWaterLostMl);
});

test('Cardinal foraging range and reproduction settings change animal behavior without free food',()=>{
  const e=createEcology(),fox=e.animals.find(a=>a.species==='fox'),bramble=e.plants.find(p=>p.kind==='bramble');e.animals=[fox];e.plants=[bramble];
  fox.position={x:276,y:470};fox.homePosition={...fox.position};fox.physiology.hoursSinceMeal=12;fox.physiology.sleepPressure=0;fox.physiology.fatigue=0;bramble.position={x:880,y:700};
  const candidate=JSON.parse(JSON.stringify(e)),env={worldRules:createWorldRules()};applyWorldRules(env,{animalForagingRangeMultiplier:2});
  advance(e,.5);advance(candidate,.5,env);assert.equal(e.animals[0].targetId,null);assert.equal(candidate.animals[0].targetId,bramble.id);assert.equal(candidate.ledger.externalKcal,0);
  const colony=createEcology(),rabbits=colony.animals.filter(a=>a.species==='rabbit').slice(0,2);colony.animals=rabbits;colony.plants=colony.plants.filter(p=>p.kind==='grass').slice(0,8);
  colony.plants.forEach((p,i)=>p.position={x:240+(i%4)*30,y:470+Math.floor(i/4)*40});
  rabbits.forEach((a,i)=>{a.position={x:276+i*40,y:470};a.homePosition={...a.position};a.physiology.availableEnergyKcal=70;a.physiology.storedEnergyKcal=600;a.physiology.hoursSinceMeal=0;a.energy=100;a.lastBirthHours=-1000;});
  const blocked=JSON.parse(JSON.stringify(colony)),blockedEnv={worldRules:createWorldRules()};applyWorldRules(blockedEnv,{animalReproductionMultiplier:0});
  advance(colony,.5);advance(blocked,.5,blockedEnv);assert.ok(colony.births>0);assert.equal(blocked.births,0);assert.equal(blocked.ledger.externalKcal,0);
});
