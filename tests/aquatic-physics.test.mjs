import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { ECOLOGY_RULES as R } from '../src/ecology-config.js';
import { AQUATIC_RULES as A } from '../src/aquatic-config.js';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { createOzarkEcology, validateOzarkEcology, tickOzarkEcology, ozarkRegionAt } from '../src/ozark-ecology.js';
import { aquaticError, aquaticStockAudit, aquaticMaterialError, hasAquaticPayload, fishStock } from '../src/aquatic-state.js';
import { aquaticHabitat, aquaticRevision, seedAquaticEcology, captureAquaticFish, pullAquaticTissue, tickAquaticEcology, decayAquaticMaterial, recordAquaticDiscard } from '../src/aquatic-ecology.js';
import { ecologyEnergy, consumeEcologyMaterial } from '../src/ecology.js';
const geometry=createOzarkWorldGeometry();
const base=createOzarkEcology(geometry);
const fresh=()=>structuredClone(base);
const fields=['massGrams','energyKcal','waterMl'];
const zero=()=>({massGrams:0,energyKcal:0,waterMl:0});
const balance=e=>ecologyEnergy(e)+e.ledger.humanRemovedKcal+e.ledger.metabolizedKcal+e.ledger.decomposedKcal+e.ledger.discardedKcal-e.ledger.initialKcal-e.ledger.photosynthesisKcal-e.ledger.externalKcal;
const audit=e=>{for(const n of Object.values(aquaticStockAudit(e)))assert.ok(Math.abs(n)<1e-7,`${n} fish closure`);assert.ok(Math.abs(balance(e))<1e-7,`${balance(e)} global closure`);};
const deposit=e=>(mass,calories,position)=>{
 const admitted=Math.min(mass,Math.max(0,R.maxDetritus-e.detritus.massGrams)),energy=mass?calories*admitted/mass:calories,row=ozarkRegionAt(e,position);
 e.detritus.massGrams+=admitted;e.detritus.energyKcal+=energy;e.ledger.discardedKcal+=calories-energy;e.ledger.discardedDetritusMassGrams+=mass-admitted;
 if(row){row.massGrams+=admitted;row.energyKcal+=energy;row.depositedMassGrams+=admitted;row.depositedKcal+=energy;}
};
const caught=e=>{const f=e.aquatic.fish[0],id=f.id;assert.equal(captureAquaticFish(e,id,'aster',geometry.agentSpawns.aster).ok,true);return e.materials.find(m=>m.id===id);};
// Explicit isolated low-level fixtures, not native capture/discovery evidence.
function reserveFixture(e,f,kcal){
 const fraction=kcal/f.reserve.energyKcal,spent=Object.fromEntries(fields.map(k=>[k,f.reserve[k]*(1-fraction)]));
 for(const k of fields)f.reserve[k]*=fraction;
 f.spentMassGrams+=spent.massGrams;f.spentKcal+=spent.energyKcal;f.releasedWaterMl+=spent.waterMl;f.ageHours+=spent.energyKcal/(A.maintenanceKcalPerHour+A.swimmingKcalPerHour);
 e.aquatic.ledger.respirationMassGrams+=spent.massGrams;e.aquatic.ledger.metabolizedKcal+=spent.energyKcal;e.aquatic.ledger.releasedWaterMl+=spent.waterMl;e.ledger.metabolizedKcal+=spent.energyKcal;
}
function straightWater({pond=false,dry=false,noBank=false}={}){
 return {bounds:{minX:-500,maxX:500,minY:-500,maxY:500},profile:{cellPixels:1,depthSpan:100,currentMaxSpeed:28,wadeMaxDepthProxy:.5},
  sample(x){return {surfaceWaterDistance:dry?200:pond?1000:x,sinkholePondDistance:pond?x:null,currentDirection:!dry&&!pond?{x:0,y:1}:null};},
  classify(x){return {walkable:true,reason:!noBank&&x>10?'dry-ground':'shallow-water'};},lineOfSight(){return true;}};
}

test('renewal retains fixed adult compartments and physical capture coefficients',()=>{
 assert.ok(Object.isFrozen(A));assert.ok(Object.isFrozen(A.tissue));
 assert.deepEqual(A.tissue,{massGrams:80,energyKcal:80,waterMl:56});
 assert.deepEqual(A.residue,{massGrams:100,energyKcal:30,waterMl:60});
 assert.deepEqual(A.reserve,{massGrams:20,energyKcal:40,waterMl:10});
 assert.equal(A.maintenanceKcalPerHour,.25);assert.equal(A.swimmingKcalPerHour,.25);
 assert.equal(A.cruisePixelsPerSecond,6);assert.equal(A.dartPixelsPerSecond,18);
 assert.equal(A.cruiseSeconds,3);assert.equal(A.dartSeconds,1);assert.equal(A.sweptStepPixels,2);
});

test('fresh seeding is deterministic, bounded, signed-water contained, and appended after unchanged land IDs',()=>{
 const same=createOzarkEcology(geometry),old=createOzarkEcology(geometry,base.seed,0,{finiteAquatic:false});
 assert.deepEqual(same,base);assert.equal(base.aquatic.initialCount,32);assert.equal(base.aquatic.acceptedPatches,8);
 assert.deepEqual(base.plants,old.plants);assert.deepEqual(base.animals,old.animals);assert.deepEqual(base.materials,old.materials);
 const oldProjection=structuredClone(base);delete oldProjection.aquatic;oldProjection.nextId=old.nextId;oldProjection.ledger.initialKcal-=base.aquatic.initialCount*150;assert.deepEqual(oldProjection,old);
 assert.equal(base.aquatic.fish[0].id,`object:${old.nextId}`);assert.equal(base.nextId,old.nextId+32);
 for(const f of base.aquatic.fish){assert.ok(aquaticHabitat(geometry,f.position));assert.deepEqual(fishStock(f),{massGrams:200,energyKcal:150,waterMl:126});
  let bank=false;for(let radius=20;radius<=80&&!bank;radius+=10)for(let n=0;n<24;n++){
   const p={x:f.position.x+radius*Math.cos(n*Math.PI/12),y:f.position.y+radius*Math.sin(n*Math.PI/12)};
   if(geometry.classify(p.x,p.y,10).reason==='dry-ground'&&geometry.lineOfSight(p,f.position)){bank=true;break;}
  }assert.equal(bank,true,'generation required a real dry visible bank');
 }
 audit(base);assert.deepEqual(validateOzarkEcology(base,geometry,{seed:base.seed,elapsed:0,finiteAquatic:true}),base);
 assert.equal(hasAquaticPayload(old),false);assert.deepEqual(validateOzarkEcology(old,geometry,{seed:old.seed,elapsed:0,finiteAquatic:false}),old);
});

test('unusable water or missing bank produces fewer fish without replacement terrain or fallback placement',()=>{
 for(const options of [{dry:true},{noBank:true}]){
  const e={nextId:1,seed:23};const g=straightWater(options),before=JSON.stringify(g.bounds);
  assert.equal(seedAquaticEcology(e,g).initialCount,0);assert.equal(e.nextId,1);assert.equal(JSON.stringify(g.bounds),before);
  assert.throws(()=>seedAquaticEcology(e,g),/only be initialized once/);
 }
});

test('walkability alone is not fish habitat, and all footprint margins obey the 5–35 px band',()=>{
 const g=straightWater();assert.equal(aquaticHabitat(g,{x:0,y:0}),null);assert.equal(aquaticHabitat(g,{x:20,y:0}),null);
 assert.equal(aquaticHabitat(g,{x:-7.99,y:0}),null);assert.equal(aquaticHabitat(g,{x:-32.01,y:0}),null);
 assert.ok(aquaticHabitat(g,{x:-8,y:0}));assert.ok(aquaticHabitat(g,{x:-32,y:0}));
 assert.equal(aquaticHabitat(g,{x:-20,y:499}),null);
});

test('motion pays finite reserve even at barriers, stays contained, and restores deterministically',()=>{
 const e=fresh(),before=structuredClone(e.aquatic),initialRevision=aquaticRevision(e);
 for(let n=0;n<120;n++){tickAquaticEcology(e,.5,geometry,{deposit:deposit(e)});for(const f of e.aquatic.fish)assert.ok(aquaticHabitat(geometry,f.position));}
 assert.ok(e.aquatic.fish.some((f,i)=>JSON.stringify(f.position)!==JSON.stringify(before.fish[i].position)));
 assert.ok(aquaticRevision(e)>initialRevision);assert.ok(e.aquatic.ledger.metabolizedKcal>0);audit(e);
 const reopened=structuredClone(e);for(let n=0;n<20;n++){tickAquaticEcology(e,.5,geometry,{deposit:deposit(e)});tickAquaticEcology(reopened,.5,geometry,{deposit:deposit(reopened)});}
 assert.deepEqual(e.aquatic,reopened.aquatic);audit(e);
 const f=e.aquatic.fish[0];f.position={x:-8,y:0};f.direction=0;const reserve=f.reserve.energyKcal;
 tickAquaticEcology(e,.5,straightWater(),{deposit:deposit(e)});
 assert.ok(f.reserve.energyKcal<reserve);assert.ok(aquaticHabitat(straightWater(),f.position));
});

test('surface current uses native direction and fixed radius proxy; internal ponds have no invented drift',()=>{
 const surface=fresh(),pond=fresh();for(const e of [surface,pond]){for(const f of e.aquatic.fish){f.position={x:-20,y:0};f.direction=Math.PI/2;}}
 tickAquaticEcology(surface,.1,straightWater(),{deposit:deposit(surface)});tickAquaticEcology(pond,.1,straightWater({pond:true}),{deposit:deposit(pond)});
 assert.ok(Math.abs(surface.aquatic.fish[0].position.y-2.28)<1e-9);assert.ok(Math.abs(pond.aquatic.fish[0].position.y-.6)<1e-9);
});

test('capture and pull transfer exact finite compartments with the same body ID and no bonus matter',()=>{
 const e=fresh(),before=ecologyEnergy(e),f=e.aquatic.fish[0],id=f.id,m=caught(e);
 assert.equal(m.id,id);assert.equal(m.originFishId,id);assert.equal(e.aquatic.fish.some(o=>o.id===id),false);
 assert.equal(m.massGrams,200);assert.equal(m.energyKcal,150);assert.equal(m.waterMl,126);assert.deepEqual(m.fishTissue,A.tissue);
 assert.equal(captureAquaticFish(e,id,'mira',m.position).ok,false);
 const result=pullAquaticTissue(e,m,'aster',m.position),tissue=e.materials.find(m=>m.id===result.materialId);
 assert.equal(result.ok,true);assert.notEqual(tissue.id,id);assert.equal(tissue.originFishId,id);assert.deepEqual(Object.fromEntries(fields.map(k=>[k,tissue[k]])),A.tissue);
 assert.deepEqual(m.fishTissue,zero());assert.equal(m.massGrams,120);assert.equal(m.energyKcal,70);assert.equal(m.waterMl,70);
 assert.equal(pullAquaticTissue(e,m,'aster',m.position).ok,false);assert.equal(pullAquaticTissue(e,m,'mira',m.position).ok,false);
 assert.equal(ecologyEnergy(e),before);audit(e);assert.equal(aquaticError(e,geometry,{habitat:aquaticHabitat}),null);
});

test('material capacity refusals are atomic for capture and destructive pull',()=>{
 const e=fresh(),m=caught(e);while(e.materials.length<R.maxMaterials)e.materials.push({id:`fixture:${e.materials.length}`});
 let snapshot=JSON.stringify(e),f=e.aquatic.fish[0];assert.equal(captureAquaticFish(e,f.id,'mira',f.position).ok,false);assert.equal(JSON.stringify(e),snapshot);
 assert.equal(pullAquaticTissue(e,m,'aster',m.position).ok,false);assert.equal(JSON.stringify(e),snapshot);
});

test('full gut leaves exact held tissue stock, actual ingestion and final cleanup close all three ledgers',()=>{
 const e=fresh(),m=caught(e),result=pullAquaticTissue(e,m,'aster',m.position),tissue=e.materials.find(m=>m.id===result.materialId),before=structuredClone(tissue);
 const refused=consumeEcologyMaterial(e,tissue.id,.375,{actorId:'aster',accept:()=>({ok:false,code:'STOMACH_FULL'})});
 assert.equal(refused.ok,false);assert.deepEqual(tissue,before);audit(e);
 for(const mass of [30,30,20]){const portion=mass/tissue.massGrams;assert.equal(consumeEcologyMaterial(e,tissue.id,portion,{actorId:'aster',accept:()=>({ok:true})}).ok,true);audit(e);}
 assert.equal(e.materials.some(o=>o.id===tissue.id),false);assert.equal(e.aquatic.ledger.humanIngestedMassGrams,80);
 const cleanup={massGrams:.01,energyKcal:.01,waterMl:.007};
 // Separate explicit last-fraction API contract. Keep the test stock unchanged
 // by pairing a modeled remaining portion and its cleanup export.
 m.massGrams+=cleanup.massGrams;m.energyKcal+=cleanup.energyKcal;m.waterMl+=cleanup.waterMl;
 e.aquatic.ledger.humanIngestedMassGrams-=cleanup.massGrams;e.aquatic.ledger.humanIngestedKcal-=cleanup.energyKcal;e.aquatic.ledger.humanIngestedWaterMl-=cleanup.waterMl;e.ledger.humanRemovedKcal-=cleanup.energyKcal;
 recordAquaticDiscard(e,m,cleanup);for(const k of fields)m[k]-=cleanup[k];e.ledger.discardedKcal+=cleanup.energyKcal;audit(e);
});

test('reserve exhaustion creates unowned whole matter at its actual position without replenishment',()=>{
 const e=fresh(),f=e.aquatic.fish[0];reserveFixture(e,f,.001);audit(e);
 tickAquaticEcology(e,.5,geometry,{deposit:deposit(e)});
 const m=e.materials.find(m=>m.id===f.id);assert.ok(m);assert.equal(m.heldBy,null);assert.deepEqual(m.position,f.position);assert.equal(m.massGrams,180);assert.equal(m.energyKcal,110);assert.equal(m.waterMl,116);
 assert.equal(e.aquatic.ledger.naturalDeaths,1);assert.equal(e.aquatic.fish.length,31);audit(e);
 const snapshot=JSON.stringify(e);tickAquaticEcology(e,0,geometry,{deposit:deposit(e)});assert.equal(JSON.stringify(e),snapshot);
});

test('natural death at full material cap goes to regional detritus, including overflow',()=>{
 for(const fullDetritus of [false,true]){
  const e=fresh(),f=e.aquatic.fish[0];reserveFixture(e,f,.001);
  while(e.materials.length<R.maxMaterials)e.materials.push({id:`fixture:${e.materials.length}`,energyKcal:0});
  if(fullDetritus)e.detritus.massGrams=R.maxDetritus;
  tickAquaticEcology(e,.5,geometry,{deposit:deposit(e)});
  assert.equal(e.materials.some(m=>m.id===f.id),false);assert.equal(e.aquatic.ledger.naturalDeaths,1);
  assert.equal(e.aquatic.ledger[fullDetritus?'overflowLostMassGrams':'detritusTransferredMassGrams'],180);
  audit(e);
 }
});

test('decay proportionally reduces removable tissue and final residue, recording all provenance transfers',()=>{
 const e=fresh(),m=caught(e);m.ageHours=A.spoilDays*24;
 decayAquaticMaterial(e,m,CONFIG.dayRealSeconds,[],deposit(e));assert.equal(m.spoiled,true);
 for(const k of fields)assert.ok(Math.abs(m.fishTissue[k]-A.tissue[k]*5/6)<1e-9);
 audit(e);assert.equal(aquaticMaterialError(m),null);
 decayAquaticMaterial(e,m,CONFIG.dayRealSeconds*6,[],deposit(e));assert.equal(e.materials.includes(m),false);assert.equal(e.aquatic.ledger.detritusTransferredMassGrams,200);audit(e);
});

test('strict restoration rejects malformed compartments, duplicate IDs, impossible habitat, provenance and legacy contamination',()=>{
 const changes=[e=>e.aquatic.fish[0].reserve.energyKcal++,e=>e.aquatic.fish[0].position={...geometry.agentSpawns.aster},e=>e.aquatic.fish[0].id=e.plants[0].id,e=>e.aquatic.ledger.initialMassGrams++,e=>e.aquatic.fish[0].rngState=0,e=>e.aquatic.fish[0].unknown=true,e=>e.aquatic.initialIds[0]='object:9999999'];
 for(const change of changes){const e=fresh();change(e);assert.throws(()=>validateOzarkEcology(e,geometry,{seed:e.seed,elapsed:0,finiteAquatic:true}),/Protected Ozark ecology/);}
 assert.throws(()=>validateOzarkEcology(base,geometry,{seed:base.seed,elapsed:0,finiteAquatic:false}),/forbidden/);
 const e=fresh(),m=caught(e);m.fishTissue.waterMl++;assert.throws(()=>validateOzarkEcology(e,geometry,{seed:e.seed,elapsed:0}),/fish tissue/);
});

test('native ecology clock includes aquatic energy, fractional pause and exact restoration',()=>{
 const e=fresh();tickOzarkEcology(e,.25,{},[],{},geometry);assert.deepEqual(e.aquatic,base.aquatic);
 tickOzarkEcology(e,.25,{},[],{},geometry);assert.ok(e.aquatic.ledger.metabolizedKcal>0);audit(e);
 const restored=validateOzarkEcology(e,geometry,{seed:e.seed,elapsed:.5,finiteAquatic:true});assert.deepEqual(restored.aquatic,e.aquatic);
});

test('terminal decay immediately removes the actual sleeping owner inventory reference',()=>{
 const e=fresh(),m=caught(e),owner={id:'aster',bodyMode:'sleeping',position:{...m.position},inventory:{items:[m.id]}};
 m.ageHours=A.spoilDays*24;decayAquaticMaterial(e,m,CONFIG.dayRealSeconds*6,[owner],deposit(e));
 assert.deepEqual(owner.inventory.items,[]);assert.equal(e.materials.includes(m),false);audit(e);
});

test('capture preserves each remaining reserve gram, kcal and water rather than resetting the body',()=>{
 const e=fresh(),f=e.aquatic.fish[0];reserveFixture(e,f,7);
 const before=fishStock(f),m=caught(e);
 assert.deepEqual(Object.fromEntries(fields.map(k=>[k,m[k]])),before);
 assert.equal(m.massGrams,183.5);assert.equal(m.energyKcal,117);assert.equal(m.waterMl,117.75);
 assert.equal(e.deaths,1);assert.equal(e.aquatic.ledger.captures,1);audit(e);
});

test('all fish can die; primary food renewal never respawns extinct individuals',()=>{
 const e=fresh();for(const f of e.aquatic.fish)reserveFixture(e,f,.001);
 tickAquaticEcology(e,.5,geometry,{deposit:deposit(e)});
 assert.equal(e.aquatic.fish.length,0);assert.equal(e.aquatic.ledger.naturalDeaths,32);assert.equal(e.materials.length,32);
 const snapshot=JSON.stringify({fish:e.aquatic.fish,origins:e.aquatic.origins,initialIds:e.aquatic.initialIds}),next=e.nextId,produced=e.aquatic.ledger.primaryProducedKcal;
 for(let n=0;n<120;n++)tickAquaticEcology(e,.5,geometry,{deposit:deposit(e)});
 assert.equal(JSON.stringify({fish:e.aquatic.fish,origins:e.aquatic.origins,initialIds:e.aquatic.initialIds}),snapshot);assert.equal(e.nextId,next);
 assert.equal(e.aquatic.ledger.births,0);assert.ok(e.aquatic.ledger.primaryProducedKcal>produced);
 for(const patch of e.aquatic.patches)assert.ok(patch.food.energyKcal>=0&&patch.food.energyKcal<=A.foodCapacityKcal);audit(e);
 for(const m of e.materials)assert.equal(aquaticMaterialError(m),null);
});
