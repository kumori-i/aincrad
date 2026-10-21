import {observeNpc,requestNpcAction,tickNpc} from '../src/npc.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createPhysiology,ingestMaterial} from '../src/biology.js';
import {CONFIG} from '../src/config.js';
import {ECOLOGY_RULES as R} from '../src/ecology-config.js';
import {createEnvironment,tickEnvironment} from '../src/environment.js';
import {tickEcology,interactEcologyObject,consumeEcologyMaterial,ecologyEnergy,ecologyLifecycleAudit,validateEcology,renderEcology,senseEcology} from '../src/ecology.js';
import {freshState,canStandOutside} from '../src/world.js';
import {regionAt,plantSuitability,regionalResourceAudit} from '../src/ecology-regions.js';
import {freshPlantLifecycle,PLANT_FIELDS,MATERIAL_FIELDS,lifecycleError} from '../src/plant-lifecycle-state.js';
import {measureCardinalWorld} from '../src/cardinal-metrics.js';

const clone=structuredClone,near=(a,b,eps=1e-8)=>assert.ok(Math.abs(a-b)<=eps,`${a} != ${b}`);
const storage=()=>{let bytes=null,writes=0;return {getItem:()=>bytes,setItem:(_,v)=>{bytes=v;writes++;},get bytes(){return bytes;},get writes(){return writes;}};};
function fixture(){
 const env=createEnvironment(74193,{mode:'discovery'}),e=env.ecology,tree=e.plants.find(p=>p.kind==='apple_tree');
 e.animals=[];e.plants=[tree];e.ledger.initialKcal=ecologyEnergy(e);env.settings={hourOverride:12,weatherOverride:'clear'};
 const r=interactEcologyObject(e,tree.id,'pull',{actorId:'aster',position:tree.position});assert.equal(r.ok,true);
 const material=e.materials.find(m=>m.id===r.materialId),point={x:tree.position.x+45,y:tree.position.y+30};assert.equal(canStandOutside(point.x,point.y,10),true);
 assert.equal(interactEcologyObject(e,material.id,'release',{actorId:'aster',position:point}).ok,true);
 return {env,e,tree,material,point};
}
// Explicit copied-world age/clock intervention. No stock or chemistry is added.
function aged(f){f.e.elapsed=f.env.elapsed=CONFIG.dayRealSeconds*4;f.material.ageHours=96;return f;}
function step(f,dt=.5){tickEnvironment(f.env,dt);tickEcology(f.e,dt,f.env,[]);}
function balances(e){const a=ecologyLifecycleAudit(e);for(const k of ['massErrorGrams','energyErrorKcal','waterErrorMl'])near(a[k],0);near(e.ledger.initialKcal+e.ledger.photosynthesisKcal+e.ledger.externalKcal-ecologyEnergy(e)-e.ledger.humanRemovedKcal-e.ledger.metabolizedKcal-e.ledger.decomposedKcal-e.ledger.discardedKcal,0);assert.equal(lifecycleError(e),null);}
function asState(f){const state=freshState({connectedEcology:false});state.environment=f.env;state.elapsed=f.e.elapsed;return state;}
function legacy(raw){raw.version=6;delete raw.features;delete raw.environment.ecology.lifecycle;for(const p of raw.environment.ecology.plants)for(const k of PLANT_FIELDS)delete p[k];for(const m of raw.environment.ecology.materials)for(const k of MATERIAL_FIELDS)delete m[k];return raw;}

test('a real finite apple detachment transfers two grams into one fruitless juvenile locally',()=>{
 const f=aged(fixture()),before=clone(f.material),energy=ecologyEnergy(f.e);step(f);
 const p=f.e.plants.find(p=>p.lifecycleStage==='juvenile');assert.ok(p);assert.equal(p.parentMaterialId,before.id);assert.equal(p.structureMassGrams,2);assert.equal(p.quantity,0);assert.equal(p.capacity,0);
 near(p.structureKcal+f.material.energyKcal,before.energyKcal);near(p.structureWaterMl+f.material.waterMl,before.waterMl);near(p.structureMassGrams+f.material.massGrams,before.massGrams);near(ecologyEnergy(f.e),energy);
 assert.ok(Math.hypot(p.position.x-f.point.x,p.position.y-f.point.y)<=24);assert.equal(canStandOutside(p.position.x,p.position.y,10),true);assert.equal(f.material.seedOpportunity,false);assert.equal(f.material.nextGerminationAt,null);balances(f.e);
 for(let i=0;i<10;i++)step(f);assert.equal(f.e.lifecycle.seededPlants,1);
});
test('held, young, cave and underweight material do not germinate or consume an attempt',()=>{
 for(const setup of [f=>{f.material.heldBy='aster';},f=>{f.material.ageHours=0;},f=>{f.material.scene='amber';},f=>{f.material.massGrams=1;f.material.energyKcal=0;f.material.waterMl=0;}]){
  const f=aged(fixture());setup(f);const old=clone(f.material);step(f);assert.equal(f.e.lifecycle.seededPlants,0);assert.equal(f.e.lifecycle.attempts,0);assert.equal(f.material.massGrams,old.massGrams);
 }
});
test('full plant capacity defers a saved attempt without consuming material',()=>{
 const f=aged(fixture());while(f.e.plants.length<R.maxPlants)f.e.plants.push({...clone(f.tree),id:`object:${f.e.nextId++}`});
 const before=clone(f.material);step(f);assert.equal(f.e.plants.length,R.maxPlants);assert.equal(f.material.massGrams,before.massGrams);assert.equal(f.e.lifecycle.capacityBlockedAttempts,1);const deadline=f.material.nextGerminationAt;step(f);assert.equal(f.e.lifecycle.attempts,1);assert.equal(f.material.nextGerminationAt,deadline);
 const restored=validateEcology(clone(f.e));assert.equal(restored.materials[0].nextGerminationAt,deadline);
});
test('unsuitable geography cannot relocate a seed more than the bounded local search',()=>{
 const f=aged(fixture());let point=null;
 for(let y=-20000;y<20000&&!point;y+=1000)for(let x=-20000;x<20000;x+=1000)if(canStandOutside(x,y,40)&&!plantSuitability('apple_tree',{x,y})&&!plantSuitability('apple_tree',{x:x+24,y:y+24})){point={x,y};break;}
 assert.ok(point);f.material.position=point;step(f);assert.equal(f.e.lifecycle.seededPlants,0);assert.equal(f.e.lifecycle.placementBlockedAttempts,1);assert.deepEqual(f.material.position,point);assert.equal(f.material.massGrams,180);
});
test('night and exhausted local soil prohibit juvenile growth without borrowing another region',()=>{
 const f=aged(fixture());step(f);const p=f.e.plants.find(p=>p.lifecycleStage==='juvenile'),region=regionAt(f.e,p.position);f.env.settings.hourOverride=0;let mass=p.structureMassGrams;step(f);assert.equal(p.structureMassGrams,mass);
 f.env.settings.hourOverride=12;f.e.detritus.nutrients-=region.nutrients;region.uptakeNutrients+=region.nutrients;region.nutrients=0;step(f);assert.equal(p.structureMassGrams,mass);assert.ok(f.e.regions.some(r=>r.nutrients>0));balances(f.e);
});
test('growth uses actual aggregate-limited regional admission and accounts all inputs',()=>{
 const f=aged(fixture());step(f);const p=f.e.plants.find(p=>p.lifecycleStage==='juvenile'),before=p.structureMassGrams;f.e.detritus.nutrients=1e-8;const region=regionAt(f.e,p.position),soil=region.nutrients;step(f);
 near(p.structureMassGrams-before,1e-8/.004,1e-12);near(soil-region.nutrients,1e-8,1e-10);near(f.e.lifecycle.nutrientUptake,1e-8,1e-15);balances(f.e);
});
test('Cardinal total includes structure while available food and grass exclude it',()=>{
 const f=aged(fixture()),state=asState(f),before=measureCardinalWorld(state);step(f);state.elapsed=f.e.elapsed;const after=measureCardinalWorld(state),p=f.e.plants.find(p=>p.lifecycleStage==='juvenile');
 near(after.ecology.remainingKcal,before.ecology.remainingKcal);near(before.resources.availableKcal-after.resources.availableKcal,p.structureKcal);assert.equal(after.resources.biomassGrams,before.resources.biomassGrams);near(after.ecology.balanceErrorKcal,0);balances(f.e);
});
test('one drought step sends losses to local finite detritus including overflow',()=>{
 const f=aged(fixture());step(f);const p=f.e.plants.find(p=>p.lifecycleStage==='juvenile');p.moisture=0;const before=p.structureMassGrams;f.e.detritus.massGrams=R.maxDetritus;step(f);assert.ok(p.structureMassGrams<before);assert.ok(f.e.ledger.discardedDetritusMassGrams>0);assert.ok(f.e.lifecycle.releasedWaterMl>0);balances(f.e);
});
test('split input steps, zero-duration pause and save continuation preserve a germination boundary',()=>{
 const a=aged(fixture()),b={env:clone(a.env)};b.e=b.env.ecology;const before=clone(a.e);tickEcology(a.e,0,a.env,[]);assert.deepEqual(a.e,before);
 step(a,.5);step(b,.25);step(b,.25);assert.deepEqual(a.e,b.e);
 const c={env:clone(a.env)};c.e=c.env.ecology=validateEcology(c.env.ecology);for(let i=0;i<40;i++){step(a);step(c);}assert.deepEqual(c.e,a.e);balances(a.e);
});
test('juvenile appearances are public qualitative shapes and rendering remains read-only',()=>{
 const f=aged(fixture());step(f);const p=f.e.plants.find(p=>p.lifecycleStage==='juvenile'),before=clone(f.e),publicRow=senseEcology(f.e,p.position,'valley',100).find(o=>o.id===p.id),sprite=renderEcology(f.e).find(o=>o.id===p.id);
 assert.match(publicRow.appearance.shape,/stem/);assert.equal(publicRow.structureKcal,undefined);assert.equal(publicRow.seedOpportunity,undefined);assert.equal(sprite.stage,'seedling');assert.equal(sprite.quantity,0);assert.deepEqual(f.e,before);
});







test('real partial ingestion leaves a conserved source remainder, including sub-tenth-gram germination remainder',()=>{
 for(const remainder of [90,2.05,2,1.99]){
  const f=fixture(),body={physiology:createPhysiology('human')};
  assert.ok(interactEcologyObject(f.e,f.material.id,'grasp',{actorId:'aster',position:f.point}).ok);
  const sampled=consumeEcologyMaterial(f.e,f.material.id,(180-remainder)/180,{actorId:'aster',accept:portion=>ingestMaterial(body,portion,{objectId:f.material.id})});
  assert.equal(sampled.ok,true);assert.equal(sampled.ingestion.ok,true);
  assert.ok(interactEcologyObject(f.e,f.material.id,'release',{actorId:'aster',position:f.point}).ok);
  const before=clone(f.material);aged(f);step(f);const child=f.e.plants.find(p=>p.lifecycleStage==='juvenile'),source=f.e.materials.find(m=>m.id===before.id);
  if(remainder<2){assert.equal(child,undefined);assert.equal(f.e.lifecycle.attempts,0);assert.equal(source.massGrams,before.massGrams);}
  else{assert.ok(child);near(child.structureMassGrams,2);near(child.structureMassGrams+(source?.massGrams??0),before.massGrams);near(child.structureKcal+(source?.energyKcal??0),before.energyKcal);near(child.structureWaterMl+(source?.waterMl??0),before.waterMl);if(remainder>2)assert.ok(source);else assert.equal(source,undefined);}
  near(body.physiology.stomach[0].originalKcal,f.e.ledger.humanRemovedKcal);balances(f.e);
 }
});
test('natural fruit drop debits its source and creates the only new seed opportunity',()=>{
 const f=fixture();f.e.materials=[];f.e.ledger.initialKcal=ecologyEnergy(f.e);const fruit=f.tree.quantity;
 // Copied-world threshold fixture: advance the existing fall clock only.
 f.tree.fallHours=R.fruitFallDays*24-.001;step(f);assert.equal(f.tree.quantity,fruit-1);assert.equal(f.e.materials.length,1);
 const m=f.e.materials[0];assert.equal(m.heldBy,null);assert.equal(m.massGrams,180);assert.equal(m.seedOpportunity,true);assert.equal(m.createdAt,f.e.elapsed);assert.equal(m.nextGerminationAt,f.e.elapsed+CONFIG.dayRealSeconds*4);
 f.material=m;f.point={...m.position};aged(f);step(f);assert.equal(f.e.lifecycle.seededPlants,1);balances(f.e);
});
test('actual terminal juvenile removal accounts exact remaining stocks once',()=>{
 const f=aged(fixture());step(f);const p=f.e.plants.find(p=>p.lifecycleStage==='juvenile'),region=regionAt(f.e,p.position);
 // Explicit near-terminal copied fixture. Prior loss is put into its actual
 // local detritus and all diagnostic accounts, not silently removed.
 const fraction=.100000001/p.structureMassGrams;
 for(const [field,counter] of [['structureMassGrams','lostMassGrams'],['structureKcal','lostKcal'],['structureWaterMl','releasedWaterMl']]){
  const lost=p[field]*(1-fraction);p[field]-=lost;f.e.lifecycle[counter]+=lost;
  if(field==='structureMassGrams'){f.e.detritus.massGrams+=lost;region.massGrams+=lost;region.depositedMassGrams+=lost;}
  if(field==='structureKcal'){f.e.detritus.energyKcal+=lost;region.energyKcal+=lost;region.depositedKcal+=lost;}
 }
 p.moisture=0;const before=clone(p),lost=clone(f.e.lifecycle);step(f);assert.equal(f.e.plants.some(v=>v.id===p.id),false);assert.equal(f.e.lifecycle.deadJuveniles,1);
 near(f.e.lifecycle.lostMassGrams-lost.lostMassGrams,before.structureMassGrams);near(f.e.lifecycle.lostKcal-lost.lostKcal,before.structureKcal);near(f.e.lifecycle.releasedWaterMl-lost.releasedWaterMl,before.structureWaterMl);balances(f.e);
 const restored=validateEcology(clone(f.e));assert.equal(restored.lifecycle.deadJuveniles,1);step(f);assert.equal(f.e.lifecycle.deadJuveniles,1);balances(f.e);
});
test('four-attempt bound has deterministic deadline/ID order and a freed cap retries after reopen',()=>{
 const f=fixture();for(let i=0;i<5;i++){const result=interactEcologyObject(f.e,f.tree.id,'pull',{actorId:'aster',position:f.tree.position});assert.ok(result.ok);assert.ok(interactEcologyObject(f.e,result.materialId,'release',{actorId:'aster',position:f.point}).ok);}
 f.e.elapsed=f.env.elapsed=CONFIG.dayRealSeconds*4;for(const m of f.e.materials){m.ageHours=96;m.nextGerminationAt=f.e.elapsed;}
 while(f.e.plants.length<R.maxPlants)f.e.plants.push({...clone(f.tree),id:`object:${f.e.nextId++}`});
 const ids=f.e.materials.map(m=>m.id).sort((a,b)=>Number(a.slice(7))-Number(b.slice(7))),mass=f.e.materials.map(m=>m.massGrams),due=f.e.elapsed;
 f.e.materials.reverse();step(f);assert.equal(f.e.lifecycle.attempts,4);assert.equal(f.e.lifecycle.capacityBlockedAttempts,4);
 assert.deepEqual(f.e.materials.filter(m=>m.nextGerminationAt>due).map(m=>m.id).sort(),ids.slice(0,4).sort());step(f);assert.equal(f.e.lifecycle.attempts,6);assert.equal(f.e.lifecycle.capacityBlockedAttempts,6);assert.deepEqual(f.e.materials.map(m=>m.massGrams).sort(),mass.sort());
 const e=validateEcology(clone(f.e)),target=e.materials.find(m=>m.id===ids[0]),deadline=target.nextGerminationAt;
 e.plants.pop();f.e=f.env.ecology=e;f.e.elapsed=f.env.elapsed=deadline-1;step(f);assert.equal(e.lifecycle.attempts,6);step(f);assert.equal(e.lifecycle.seededPlants,1);assert.equal(e.plants.length,R.maxPlants);assert.equal(target.seedOpportunity,false);assert.equal(target.massGrams,178);
});



test('actual juvenile growth contributes only structural total and photosynthetic input, never available food',()=>{
 const f=aged(fixture());step(f);f.tree.quantity=0;f.tree.growth=0;f.e.ledger.initialKcal=ecologyEnergy(f.e);const state=asState(f),before=measureCardinalWorld(state),photo=f.e.ledger.photosynthesisKcal;
 for(let i=0;i<100;i++)step(f);state.elapsed=f.e.elapsed;const after=measureCardinalWorld(state),growth=f.e.ledger.photosynthesisKcal-photo;
 assert.ok(growth>0);near(after.ecology.remainingKcal-before.ecology.remainingKcal,growth);assert.equal(after.resources.availableKcal,before.resources.availableKcal);assert.equal(after.resources.biomassGrams,before.resources.biomassGrams);balances(f.e);
});

test('exact new material coordinates remain allowlisted without retaining nested payloads',()=>{
 const f=fixture();f.material.position.extra={large:'untrusted'};const restored=validateEcology(clone(f.e));assert.deepEqual(restored.materials[0].position,{x:f.material.position.x,y:f.material.position.y});
});
