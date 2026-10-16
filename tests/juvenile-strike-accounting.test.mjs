import test from 'node:test';
import assert from 'node:assert/strict';
import {CONFIG} from '../src/config.js';
import {ECOLOGY_RULES as R,ECOLOGY_MATERIALS as MATERIALS} from '../src/ecology-config.js';
import {ecologyEnergy,ecologyLifecycleAudit,interactEcologyObject,lookupEcologyObject,renderEcology,senseEcology,tickEcology,validateEcology} from '../src/ecology.js';
import {regionAt,regionalResourceAudit} from '../src/ecology-regions.js';
import {tickEnvironment} from '../src/environment.js';
import {lifecycleError} from '../src/plant-lifecycle-state.js';
import {juvenileStrikeLoss} from '../src/plant-lifecycle.js';
import {measureCardinalWorld} from '../src/cardinal-metrics.js';
import {observeNpc,requestNpcAction,tickNpc} from '../src/npc.js';
import {freshState,canStandOutside} from '../src/world.js';
import {writeSave,loadSave} from '../src/save.js';
import {createJuvenileFixture} from './fixtures/juvenile-interactions.mjs';

const clone=structuredClone;
const near=(actual,expected,epsilon=1e-8)=>assert.ok(Math.abs(actual-expected)<=epsilon,`${actual} != ${expected}`);
const stock=p=>({massGrams:p.structureMassGrams,energyKcal:p.structureKcal,waterMl:p.structureWaterMl});
const strike=(f,p=f.juvenile,power=1)=>interactEcologyObject(f.e,p.id,'strike',{actorId:'aster',position:p.position,power});
const step=(f,dt=.5)=>{tickEnvironment(f.env,dt);tickEcology(f.e,dt,f.env,[]);};
const mass=e=>e.detritus.massGrams+e.materials.reduce((sum,m)=>sum+m.massGrams,0)+e.plants.reduce((sum,p)=>sum+p.structureMassGrams+(p.kind==='grass'?p.biomassGrams:p.quantity*MATERIALS[p.kind==='apple_tree'?'apple':'berry'].massGrams),0);
function audit(e){
  const life=ecologyLifecycleAudit(e),regional=regionalResourceAudit(e);
  for(const key of ['massErrorGrams','energyErrorKcal','waterErrorMl'])near(life[key],0);
  for(const key of ['maxRegionalMassError','maxRegionalEnergyError','maxRegionalSoilError','soilBalanceError'])near(regional[key],0);
  near(e.ledger.initialKcal+e.ledger.photosynthesisKcal+e.ledger.externalKcal-ecologyEnergy(e)-e.ledger.humanRemovedKcal-e.ledger.metabolizedKcal-e.ledger.decomposedKcal-e.ledger.discardedKcal,0);
  assert.equal(lifecycleError(e),null);
  return regional;
}
function asState(f){
  const state=freshState({populateEcology:false,connectedEcology:false});state.environment=f.env;state.elapsed=f.e.elapsed;
  const actor=state.agents[0];actor.position={...f.juvenile.position};actor.elapsed=f.e.elapsed;
  observeNpc(actor,f.env);return state;
}
function complete(state){
  const actor=state.agents[0];for(let i=0;i<1000&&actor.active;i++)tickNpc(actor,1/60,state.environment);
  assert.equal(actor.active,null);return actor.lastResult;
}
function disk(){let bytes=null;return{getItem:()=>bytes,setItem:(_,value)=>{bytes=value;},get bytes(){return bytes;}};}
function reopen(state){const storage=disk();assert.equal(writeSave(storage,state),true);const result=loadSave(storage);assert.equal(result.blocked,false,result.error);assert.equal(JSON.parse(storage.bytes).version,8);return result.state;}
function secondJuvenile(f){
  const pulled=interactEcologyObject(f.e,f.tree.id,'pull',{actorId:'aster',position:f.tree.position});assert.equal(pulled.ok,true);
  const material=lookupEcologyObject(f.e,pulled.materialId),point={x:f.point.x+40,y:f.point.y};assert.equal(canStandOutside(point.x,point.y,10),true);
  assert.equal(interactEcologyObject(f.e,material.id,'release',{actorId:'aster',position:point}).ok,true);
  // A second explicit age/clock intervention admits another real finite fruit;
  // it does not clone or assign a structural stock or recruitment provenance.
  f.e.elapsed=f.env.elapsed=material.nextGerminationAt;material.ageHours=96;step(f);
  const child=f.e.plants.find(p=>p.parentMaterialId===material.id);assert.ok(child);return child;
}
function setCapacityFixture(f,room){
  // Deliberate copied-world opening-litter capacity fixture. Added opening stock
  // is recorded in initial mass/kcal accounts, rather than credited to a strike.
  // Seventeen grams and 3.4 kcal are unassigned compatibility litter. Existing
  // soil is unassigned by moving seven units out of one regional partition.
  const e=f.e,openingUnassigned=regionalResourceAudit(e).unassigned,added=R.maxDetritus-room-e.detritus.massGrams,remote=e.regions.find(r=>r!==regionAt(e,f.juvenile.position));
  assert.ok(added>17);e.detritus.massGrams+=added;e.detritus.energyKcal+=added*.2;e.ledger.initialKcal+=added*.2;
  remote.massGrams+=added-17;remote.initialMassGrams+=added-17;
  remote.energyKcal+=(added-17)*.2;remote.initialEnergyKcal+=(added-17)*.2;
  remote.nutrients-=7;remote.initialNutrients-=7;
  audit(e);return openingUnassigned;
}

test('fixture recruits from a finite identified source and genuinely grows beyond forty grams',()=>{
  const seed=createJuvenileFixture(),grown=createJuvenileFixture({grown:true});
  assert.equal(seed.juvenile.parentMaterialId,seed.material.id);assert.equal(seed.material.massGrams,178);
  near(seed.juvenile.structureKcal+seed.material.energyKcal,95);near(seed.juvenile.structureWaterMl+seed.material.waterMl,153);
  assert.equal(seed.tree.quantity+1,seed.intervention.openingFruitQuantity);
  assert.equal(grown.juvenile.parentMaterialId,grown.material.id);assert.equal(grown.material.seedOpportunity,false);
  assert.equal(grown.juvenile.id,seed.juvenile.id);assert.ok(grown.juvenile.structureMassGrams>40);
  near(grown.juvenile.structureMassGrams-seed.juvenile.structureMassGrams,grown.e.lifecycle.growthMassGrams);
  near(grown.e.lifecycle.growthKcal,grown.e.lifecycle.growthMassGrams*.5);
  near(grown.e.lifecycle.nutrientUptake,grown.e.lifecycle.growthMassGrams*.004);
  assert.equal(grown.intervention.growthDays,8);assert.equal(grown.intervention.sourceAgeSetHours,96);
  assert.equal(grown.intervention.structuralStocksManuallyAssigned,false);audit(seed.e);audit(grown.e);
});

test('nonterminal strike conserves mass, energy and water through local litter without a soil refund',()=>{
  const f=createJuvenileFixture({grown:true}),p=f.juvenile,before=clone(f.e),original=stock(p),plan=juvenileStrikeLoss(original);
  const state=asState(f),metrics=measureCardinalWorld(state),region=regionAt(f.e,p.position),oldRegion=clone(region),oldAudit=audit(f.e),totalMass=mass(f.e);
  const outcome=strike(f);assert.deepEqual(outcome,{ok:true,code:'object_damaged',targetId:p.id});
  assert.equal(lookupEcologyObject(f.e,p.id),p);assert.deepEqual(stock(p),plan.remaining);assert.deepEqual(p.position,before.plants.find(v=>v.id===p.id).position);
  assert.equal(p.parentMaterialId,f.material.id);assert.equal(p.stage,'juvenile');
  assert.deepEqual(f.material,before.materials.find(m=>m.id===f.material.id));assert.deepEqual(f.tree,before.plants.find(v=>v.id===f.tree.id));
  assert.deepEqual(f.e.materials,before.materials);assert.deepEqual(f.e.plants.filter(v=>v.id!==p.id),before.plants.filter(v=>v.id!==p.id));
  near(mass(f.e),totalMass);near(ecologyEnergy(f.e),ecologyEnergy(before));
  near(f.e.detritus.massGrams-before.detritus.massGrams,10);near(f.e.detritus.energyKcal-before.detritus.energyKcal,plan.lost.energyKcal);
  near(region.massGrams-oldRegion.massGrams,10);near(region.energyKcal-oldRegion.energyKcal,plan.lost.energyKcal);
  near(region.depositedMassGrams-oldRegion.depositedMassGrams,10);near(region.depositedKcal-oldRegion.depositedKcal,plan.lost.energyKcal);
  assert.equal(f.e.detritus.nutrients,before.detritus.nutrients);assert.equal(region.nutrients,oldRegion.nutrients);
  for(const key of ['nutrientUptake','growthMassGrams','growthKcal','growthWaterMl'])assert.equal(f.e.lifecycle[key],before.lifecycle[key]);
  assert.equal(f.e.ledger.photosynthesisKcal,before.ledger.photosynthesisKcal);
  near(f.e.lifecycle.lostMassGrams-before.lifecycle.lostMassGrams,10);near(f.e.lifecycle.lostKcal-before.lifecycle.lostKcal,plan.lost.energyKcal);near(f.e.lifecycle.releasedWaterMl-before.lifecycle.releasedWaterMl,plan.lost.waterMl);
  for(const row of f.e.regions)if(row.id!==region.id)assert.deepEqual(row,before.regions.find(r=>r.id===row.id));
  const afterAudit=audit(f.e);for(const key of Object.keys(oldAudit.unassigned))near(afterAudit.unassigned[key],oldAudit.unassigned[key]);
  const after=measureCardinalWorld(state);assert.equal(after.resources.availableKcal,metrics.resources.availableKcal);assert.equal(after.resources.biomassGrams,metrics.resources.biomassGrams);assert.equal(after.resources.fruitUnits,metrics.resources.fruitUnits);near(after.ecology.remainingKcal,metrics.ecology.remainingKcal);
  assert.deepEqual(Object.keys(f.e.lifecycle),Object.keys(before.lifecycle));assert.deepEqual(Object.keys(p),Object.keys(before.plants.find(v=>v.id===p.id)));
});

test('partly full and full detritus retain only proportional kcal and count every discarded exit',()=>{
  for(const grown of [false,true])for(const room of [0,.5]){
    const f=createJuvenileFixture({grown}),openingUnassigned=setCapacityFixture(f,room);
    const p=f.juvenile,plan=juvenileStrikeLoss(stock(p)),before=clone(f.e),region=regionAt(f.e,p.position),oldRegion=clone(region),oldAudit=audit(f.e),totalMass=mass(f.e),energy=ecologyEnergy(f.e);
    assert.equal(strike(f).code,grown?'object_damaged':'object_broken');
    const retained=plan.lost.energyKcal*room/plan.lost.massGrams;
    near(f.e.detritus.massGrams-before.detritus.massGrams,room);near(f.e.detritus.energyKcal-before.detritus.energyKcal,retained);
    near(region.massGrams-oldRegion.massGrams,room);near(region.energyKcal-oldRegion.energyKcal,retained);
    near(f.e.ledger.discardedDetritusMassGrams-before.ledger.discardedDetritusMassGrams,plan.lost.massGrams-room);
    near(f.e.ledger.discardedKcal-before.ledger.discardedKcal,plan.lost.energyKcal-retained);
    near(mass(f.e)+f.e.ledger.discardedDetritusMassGrams-before.ledger.discardedDetritusMassGrams,totalMass);
    near(ecologyEnergy(f.e)+f.e.ledger.discardedKcal-before.ledger.discardedKcal,energy);
    near(f.e.lifecycle.lostMassGrams-before.lifecycle.lostMassGrams,plan.lost.massGrams);near(f.e.lifecycle.lostKcal-before.lifecycle.lostKcal,plan.lost.energyKcal);near(f.e.lifecycle.releasedWaterMl-before.lifecycle.releasedWaterMl,plan.lost.waterMl);
    assert.equal(f.e.detritus.nutrients,before.detritus.nutrients);assert.equal(region.nutrients,oldRegion.nutrients);
    const afterAudit=audit(f.e);for(const key of Object.keys(oldAudit.unassigned))near(afterAudit.unassigned[key],oldAudit.unassigned[key]);
    near(oldAudit.unassigned.massGrams,openingUnassigned.massGrams+17);near(oldAudit.unassigned.energyKcal,openingUnassigned.energyKcal+3.4);near(oldAudit.unassigned.nutrients,openingUnassigned.nutrients+7);
  }
});

test('strike resolves one exact nearby juvenile, never its finite source or established neighbor',()=>{
  const f=createJuvenileFixture(),other=secondJuvenile(f),before=clone(f.e),id=f.juvenile.id;
  assert.ok(Math.hypot(other.position.x-f.juvenile.position.x,other.position.y-f.juvenile.position.y)<85);
  assert.equal(strike(f).code,'object_broken');assert.equal(lookupEcologyObject(f.e,id),null);
  assert.equal(lookupEcologyObject(f.e,other.id),other);assert.deepEqual(other,before.plants.find(p=>p.id===other.id));
  assert.deepEqual(f.e.materials,before.materials);assert.deepEqual(f.tree,before.plants.find(p=>p.id===f.tree.id));
  const unchanged=clone(f.e);assert.equal(strike(f,f.tree).code,'object_struck');assert.deepEqual(f.e,unchanged);
  assert.equal(interactEcologyObject(f.e,f.material.id,'strike',{actorId:'aster',position:f.material.position}).code,'object_struck');assert.deepEqual(f.e,unchanged);
  assert.equal(interactEcologyObject(f.e,id,'strike',{actorId:'aster',position:other.position}).code,'object_missing');assert.deepEqual(f.e,unchanged);audit(f.e);
});

test('invalid and zero power, missing provenance, wrong scene and remote strikes cannot change stock',()=>{
  const f=createJuvenileFixture({grown:true}),before=clone(f.e);
  for(const power of [NaN,Infinity,-Infinity,-1,'1',null]){assert.equal(strike(f,f.juvenile,power).ok,false);assert.deepEqual(f.e,before);}
  assert.equal(strike(f,f.juvenile,0).code,'object_struck');assert.deepEqual(f.e,before);
  for(const args of [{scene:'amber',position:f.juvenile.position},{position:{x:f.juvenile.position.x+R.reach+1,y:f.juvenile.position.y}}]){
    assert.equal(interactEcologyObject(f.e,f.juvenile.id,'strike',{actorId:'aster',...args}).code,'object_out_of_reach');assert.deepEqual(f.e,before);
  }
  for(const change of [p=>p.parentMaterialId=null,p=>p.recruitedAt=null,p=>p.parentMaterialId=p.id]){
    const copy=createJuvenileFixture();change(copy.juvenile);const unchanged=clone(copy.e);assert.equal(strike(copy).code,'object_struck');assert.deepEqual(copy.e,unchanged);
  }
});

test('terminal removal invalidates both ID and spatial indexes once and keeps qualitative feedback',()=>{
  const f=createJuvenileFixture(),p=f.juvenile,source=clone(f.material),before=stock(p),index=senseEcology(f.e,p.position);
  assert.ok(index.some(o=>o.id===p.id));assert.equal(lookupEcologyObject(f.e,p.id),p);
  const result=strike(f);assert.deepEqual(result,{ok:true,code:'object_broken',targetId:p.id});
  assert.equal(lookupEcologyObject(f.e,p.id),null);assert.equal(senseEcology(f.e,p.position).some(o=>o.id===p.id),false);assert.equal(renderEcology(f.e).some(o=>o.id===p.id),false);
  assert.deepEqual(f.material,source);assert.equal(f.e.lifecycle.deadJuveniles,1);
  assert.equal(f.e.lifecycle.lostMassGrams,before.massGrams);assert.equal(f.e.lifecycle.lostKcal,before.energyKcal);assert.equal(f.e.lifecycle.releasedWaterMl,before.waterMl);
  const dead=clone(f.e);for(let n=0;n<3;n++)assert.equal(strike(f).code,'object_missing');assert.deepEqual(f.e,dead);audit(f.e);
  assert.deepEqual(validateEcology(clone(f.e)),f.e);
});

test('remaining mass drives the visible stage and repeated direct interactions exhaust finite structure',()=>{
  const f=createJuvenileFixture({grown:true}),p=f.juvenile,initial=stock(p),before=clone(f.e),energy=ecologyEnergy(f.e);
  assert.equal(strike(f,p,4).code,'object_damaged');assert.equal(p.stage,'seedling');assert.equal(p.structureMassGrams,initial.massGrams-40);
  const publicRow=senseEcology(f.e,p.position).find(o=>o.id===p.id);assert.match(publicRow.appearance.shape,/small stem/);
  const text=JSON.stringify(publicRow);for(const hidden of ['structureKcal','structureMassGrams','nutrient','edible','useful','parentMaterialId'])assert.equal(text.includes(hidden),false);
  let hits=1;while(lookupEcologyObject(f.e,p.id)){assert.ok(strike(f).ok);assert.ok(++hits<10);}
  near(f.e.lifecycle.lostMassGrams-before.lifecycle.lostMassGrams,initial.massGrams);near(f.e.lifecycle.lostKcal-before.lifecycle.lostKcal,initial.energyKcal);near(f.e.lifecycle.releasedWaterMl-before.lifecycle.releasedWaterMl,initial.waterMl);
  assert.equal(f.e.lifecycle.deadJuveniles-before.lifecycle.deadJuveniles,1);near(ecologyEnergy(f.e),energy);audit(f.e);
});

test('strike deposits become soil only during the existing later local decomposition rule',()=>{
  const hit=createJuvenileFixture(),control=createJuvenileFixture(),region=regionAt(hit.e,hit.juvenile.position),before=clone(region);
  strike(hit);assert.equal(region.nutrients,before.nutrients);assert.equal(region.mineralizedNutrients,before.mineralizedNutrients);
  // Night suppresses growth in both copied worlds, isolating the litter delta.
  hit.env.settings.hourOverride=control.env.settings.hourOverride=0;step(hit);step(control);
  const controlRegion=regionAt(control.e,control.juvenile.position),fraction=.5/CONFIG.dayRealSeconds/10;
  near(region.mineralizedNutrients-controlRegion.mineralizedNutrients,2*fraction*.004,1e-12);
  near(region.nutrients-controlRegion.nutrients,2*fraction*.004,1e-9);near(hit.e.detritus.nutrients-control.e.detritus.nutrients,2*fraction*.004,1e-9);
  assert.ok(region.mineralizedNutrients>before.mineralizedNutrients);audit(hit.e);audit(control.e);
});

test('shared drought loss defers array removals so the next recruited juvenile still grows',()=>{
  const f=createJuvenileFixture(),other=secondJuvenile(f),p=f.juvenile;
  assert.equal(strike(f,p,(p.structureMassGrams-.100000001)/10).code,'object_damaged');p.moisture=0;
  f.env.settings.weatherOverride='clear';const nextMass=other.structureMassGrams,priorDead=f.e.lifecycle.deadJuveniles;step(f);
  assert.equal(lookupEcologyObject(f.e,p.id),null);assert.ok(other.structureMassGrams>nextMass);assert.equal(f.e.lifecycle.deadJuveniles,priorDead+1);
  const released=f.e.lifecycle.lostMassGrams;step(f);assert.equal(f.e.lifecycle.lostMassGrams,released);audit(f.e);
});

test('checkpoint before strike completion reopens undamaged and interrupts rather than replaying work',()=>{
  const f=createJuvenileFixture({grown:true}),state=asState(f),actor=state.agents[0],before=clone(f.e);
  assert.equal(requestNpcAction(actor,{type:'strike',targetId:f.juvenile.id},f.env).ok,true);tickNpc(actor,1/60,f.env);
  assert.ok(actor.active);assert.deepEqual(f.e,before);
  const restored=reopen(state),reopened=restored.agents[0];assert.equal(reopened.active,null);assert.deepEqual(restored.environment.ecology,before);
  assert.ok(reopened.memory.experience.some(e=>e.details.result?.code==='RESTART_INTERRUPTED'));
  for(let i=0;i<300;i++)tickNpc(reopened,1/60,restored.environment);assert.deepEqual(restored.environment.ecology,before);
  assert.equal(requestNpcAction(reopened,{type:'strike',targetId:f.juvenile.id},restored.environment).ok,true);assert.equal(complete(restored).code,'object_damaged');
  near(lookupEcologyObject(restored.environment.ecology,f.juvenile.id).structureMassGrams,f.juvenile.structureMassGrams-10);audit(restored.environment.ecology);
});

test('completed damaged and dead checkpoints retain exact stocks, counters and action provenance across repeat reopen',()=>{
  for(const grown of [false,true]){
    const f=createJuvenileFixture({grown}),state=asState(f),actor=state.agents[0],id=f.juvenile.id;
    assert.equal(requestNpcAction(actor,{type:'strike',targetId:id},f.env).ok,true);assert.equal(complete(state).code,grown?'object_damaged':'object_broken');
    const event=clone(actor.memory.experience.find(e=>e.id===actor.lastResult.eventId)),physical=clone(f.e);
    assert.deepEqual(event.details.action,{type:'strike',targetId:id});assert.equal(event.details.result.ok,true);
    let restored=reopen(state);for(let pass=0;pass<2;pass++){
      assert.deepEqual(restored.environment.ecology,physical);assert.deepEqual(restored.agents[0].memory.experience.find(e=>e.id===event.id),event);assert.equal(restored.agents[0].active,null);
      audit(restored.environment.ecology);restored=reopen(restored);
    }
    // Matching independently reopened checkpoints continue deterministically.
    const control=reopen(state);for(const world of [control,restored]){
      const npc=world.agents[0];observeNpc(npc,world.environment);
      const admitted=requestNpcAction(npc,{type:'strike',targetId:id},world.environment);
      if(grown){assert.equal(admitted.ok,true);assert.equal(complete(world).code,'object_damaged');}
      else assert.equal(admitted.ok,false);
      tickEnvironment(world.environment,.5);tickEcology(world.environment.ecology,.5,world.environment,[]);
    }
    assert.deepEqual(restored.environment.ecology,control.environment.ecology);audit(restored.environment.ecology);
  }
});
