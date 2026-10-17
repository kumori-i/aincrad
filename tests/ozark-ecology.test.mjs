import test from 'node:test';
import assert from 'node:assert/strict';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { createOzarkEcology, validateOzarkEcology, tickOzarkEcology,
  ozarkEcologyCoverage, ozarkRegionAt } from '../src/ozark-ecology.js';
import { createEnvironment, tickEnvironment, environmentConditions, dailyTemperature } from '../src/environment.js';
import { ecologyEnergy, senseEcology, interactEcologyObject } from '../src/ecology.js';
import { lifecycleStockAudit } from '../src/plant-lifecycle-state.js';
import { createOzarkState, loadOzarkSave, writeOzarkSave } from '../src/ozark-save.js';
import { JUVENILE_RULES as J } from '../src/plant-lifecycle.js';
import { ECOLOGY_RULES as R, ECOLOGY_SPECIES as SPECIES } from '../src/ecology-config.js';

const geometry=createOzarkWorldGeometry();
const disk=()=>{const bytes=new Map();return {getItem:key=>bytes.get(key)??null,
  setItem:(key,value)=>bytes.set(key,value)};};
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const audit=e=>ecologyEnergy(e)+e.ledger.humanRemovedKcal+e.ledger.metabolizedKcal+
  e.ledger.decomposedKcal+e.ledger.discardedKcal-e.ledger.initialKcal-
  e.ledger.photosynthesisKcal-e.ledger.externalKcal;
const durable=e=>{const copy=structuredClone(e);for(const animal of copy.animals){
  delete animal.feelings;animal.actionHours=0;
}return copy;};

test('fresh whole-map Ozark ecology is finite, deterministic, local, and physically placed',()=>{
  const e=createOzarkEcology(geometry),same=createOzarkEcology(geometry);
  assert.deepEqual(same,e);
  const coverage=ozarkEcologyCoverage(e);
  assert.equal(coverage.occupiedRegions,49);
  assert.ok(coverage.plants>500&&coverage.plants<=R.maxPlants);
  assert.ok(coverage.animals>40&&coverage.animals<=R.maxAnimals);
  assert.deepEqual(new Set(e.animals.map(a=>a.species)),new Set(['rabbit','fox','bobcat']));
  assert.ok(Object.values(coverage.quadrants).every(value=>value>0));
  for(const p of e.plants)assert.equal(geometry.classify(p.position.x,p.position.y,10).reason,'dry-ground');
  for(const a of e.animals)assert.equal(geometry.classify(a.position.x,a.position.y,SPECIES[a.species].radius).reason,'dry-ground');
  for(const [name,spawn] of [['player',geometry.spawn],...Object.entries(geometry.agentSpawns)]){
    const sensed=senseEcology(e,spawn,'valley',400);
    assert.ok(sensed.length>=3,`${name} has local ordinary producers`);
    assert.ok(sensed.every(o=>distance(o.position,spawn)<=400));
    assert.doesNotMatch(JSON.stringify(sensed),/"(?:species|kind|diet|energyKcal|waterMl)"/);
  }
  assert.ok(Math.abs(audit(e))<1e-7);
  assert.deepEqual(validateOzarkEcology(structuredClone(e),geometry,{seed:e.seed,elapsed:0}),e);
});

test('finite growth, wildlife, regional water and fractional clock restore exactly',()=>{
  const e=createOzarkEcology(geometry),env=createEnvironment(e.seed,{mode:'discovery',populate:false});
  env.ecology=e;
  for(let i=0;i<120;i++){tickEnvironment(env,.5);tickOzarkEcology(e,.5,env,[]);}
  tickEnvironment(env,.25);tickOzarkEcology(e,.25,env,[]);
  assert.equal(e.elapsed,60);assert.equal(e.pending,.25);
  assert.ok(Math.abs(audit(e))<1e-5);
  for(const row of e.regions){
    const inWater=row.initialWaterMl+row.rainMl+row.seepageMl;
    const outWater=row.soilWaterMl+row.runoffOutMl+row.evaporationMl+row.uptakeMl;
    assert.ok(Math.abs(inWater-outWater)<1e-5);
  }
  for(const a of e.animals)assert.ok(geometry.classify(a.position.x,a.position.y,SPECIES[a.species].radius).walkable);
  assert.deepEqual(validateOzarkEcology(structuredClone(e),geometry,{seed:e.seed,elapsed:env.elapsed}),durable(e));
});

test('Ozark climate samples the real canopy and elevation; old-world branch stays separate',()=>{
  const e=createOzarkEcology(geometry),env=createEnvironment(e.seed,{mode:'discovery',populate:false});
  env.ecology=e;
  const point={x:3600,y:-7400},site=geometry.sample(point.x,point.y);
  assert.ok(site.canopy>=.58&&site.light<.55);
  const condition=environmentConditions(env,{position:point,scene:'valley'});
  assert.equal(condition.shade,true);
  assert.ok(Math.abs(condition.airTemperature-(dailyTemperature(8)-2*site.elevation/1200))<1e-9);
  const old=environmentConditions({...env,ecology:null},{position:point,scene:'valley'});
  assert.notEqual(condition.airTemperature,old.airTemperature);
});

test('forged identity, energy, region water and dry-ground producers fail closed',()=>{
  const e=createOzarkEcology(geometry);
  const cases=[
    raw=>{raw.geometryIdentity='sha256:'+'0'.repeat(64);},
    raw=>{raw.plants[0].position={x:-1200,y:220};},
    raw=>{raw.plants[0].biomassGrams+=20;},
    raw=>{raw.regions[0].soilWaterMl+=200;},
    raw=>{raw.pending=.25;},
  ];
  for(const change of cases){const raw=structuredClone(e);change(raw);
    assert.throws(()=>validateOzarkEcology(raw,geometry,{seed:e.seed,elapsed:0}),/Protected Ozark ecology/);}
});

test('pull, swimming release, wildlife recoil, and write/load preserve exact stock',()=>{
  const state=createOzarkState(geometry),e=state.environment.ecology;
  const source=e.plants.find(p=>p.kind==='apple_tree'&&p.quantity>0);
  assert.ok(source);
  const before=ecologyEnergy(e);
  const pulled=interactEcologyObject(e,source.id,'pull',{actorId:'aster',position:source.position});
  assert.equal(pulled.ok,true);
  const material=e.materials.find(m=>m.id===pulled.materialId);
  assert.equal(material.heldBy,'aster');
  const water={x:-1200,y:220};
  assert.equal(geometry.classify(water.x,water.y).walkable,false);
  assert.equal(geometry.canOccupy(water.x,water.y),true);
  state.agents[0].position={...water};
  const released=interactEcologyObject(e,material.id,'release',{actorId:'aster',position:water});
  assert.equal(released.ok,true);
  assert.deepEqual(material.position,water);
  const rabbit=e.animals.find(a=>a.species==='rabbit');
  const struck=interactEcologyObject(e,rabbit.id,'strike',{actorId:'mira',position:rabbit.position,power:1});
  assert.equal(struck.ok,true);
  assert.ok(!rabbit.targetPosition||geometry.classify(rabbit.targetPosition.x,rabbit.targetPosition.y,SPECIES.rabbit.radius).reason==='dry-ground');
  assert.ok(Math.abs(ecologyEnergy(e)-before)<1e-7);
  assert.ok(Math.abs(audit(e))<1e-7);
  const storage=disk();
  assert.equal(writeOzarkSave(storage,state,geometry),true);
  const reopened=loadOzarkSave(storage,geometry);
  assert.equal(reopened.blocked,false,reopened.error);
  assert.deepEqual(reopened.state.environment.ecology.materials.find(m=>m.id===material.id),material);
  assert.deepEqual(reopened.state.environment.ecology.animals.find(a=>a.id===rabbit.id).physiology,rabbit.physiology);
});

test('walker may wade while fauna remains saveable and invalid releases are rejected before mutation',()=>{
  const e=createOzarkEcology(geometry),a=e.animals.find(a=>a.species==='rabbit');
  let shallow=null;
  for(let y=-13000;y<13000&&!shallow;y+=80)for(let x=-18000;x<18000;x+=80)
    if(geometry.classify(x,y,SPECIES.rabbit.radius).reason==='shallow-water'){
      shallow={x,y};break;
    }
  assert.ok(shallow);
  a.position=shallow;
  assert.deepEqual(validateOzarkEcology(structuredClone(e),geometry,{seed:e.seed,elapsed:0}),e);
  const source=e.plants.find(p=>p.kind==='apple_tree'&&p.quantity>0);
  const pulled=interactEcologyObject(e,source.id,'pull',{actorId:'aster',position:source.position});
  assert.equal(pulled.ok,true);
  const m=e.materials.find(m=>m.id===pulled.materialId),old={...m.position};
  const refused=interactEcologyObject(e,m.id,'release',{actorId:'aster',position:{x:19000,y:0}});
  assert.equal(refused.ok,false);
  assert.equal(m.heldBy,'aster');assert.deepEqual(m.position,old);
});

test('held spoiled material decays into its carrier region rather than its origin',()=>{
  const e=createOzarkEcology(geometry),env=createEnvironment(e.seed,{mode:'discovery',populate:false});env.ecology=e;
  const source=e.plants.find(p=>p.kind==='apple_tree'&&p.quantity>0);
  const pulled=interactEcologyObject(e,source.id,'pull',{actorId:'aster',position:source.position});
  assert.equal(pulled.ok,true);
  const m=e.materials.find(m=>m.id===pulled.materialId),origin=ozarkRegionAt(e,source.position);
  const destination=e.plants.find(p=>ozarkRegionAt(e,p.position)!==origin);
  assert.ok(destination);
  const remote=ozarkRegionAt(e,destination.position),beforeOrigin=origin.depositedMassGrams,
    beforeRemote=remote.depositedMassGrams;
  m.ageHours=12*24;
  tickEnvironment(env,.5);
  tickOzarkEcology(e,.5,env,[{id:'aster',position:destination.position,scene:'valley'}]);
  assert.equal(origin.depositedMassGrams,beforeOrigin);
  assert.ok(remote.depositedMassGrams>beforeRemote);
  assert.ok(Math.abs(audit(e))<1e-5);
  assert.deepEqual(validateOzarkEcology(structuredClone(e),geometry,{seed:e.seed,elapsed:env.elapsed}),durable(e));
});

test('local apple seed recruitment transfers existing stock and retains lifecycle accounting',()=>{
  const e=createOzarkEcology(geometry),env=createEnvironment(e.seed,{mode:'discovery',populate:false});env.ecology=e;
  const source=e.plants.find(p=>p.kind==='apple_tree'&&p.quantity>0);
  const pulled=interactEcologyObject(e,source.id,'pull',{actorId:'aster',position:source.position});
  assert.equal(pulled.ok,true);
  const m=e.materials.find(m=>m.id===pulled.materialId);
  const point=e.plants.map(p=>p.position).find(p=>{
    const site=geometry.sample(p.x,p.y);
    return geometry.classify(p.x,p.y).reason==='dry-ground'&&site.moisture>.4&&site.light>.34&&
      site.substrate!=='thin-limestone'&&
      e.plants.every(other=>other.kind!=='apple_tree'||distance(other.position,p)>=35);
  });
  assert.ok(point);
  assert.equal(interactEcologyObject(e,m.id,'release',{actorId:'aster',position:point}).ok,true);
  // Advance only this aged-material fixture to the due instant; the runtime
  // then performs the real local transfer and one physical half-second step.
  e.elapsed=J.germinationAgeHours/24*3600;env.elapsed=e.elapsed;m.ageHours=J.germinationAgeHours;
  const prior=ecologyEnergy(e),mass=m.massGrams;
  tickEnvironment(env,.5);tickOzarkEcology(e,.5,env,[]);
  const child=e.plants.find(p=>p.parentMaterialId===m.id);
  assert.ok(child);assert.equal(child.lifecycleStage,'juvenile');
  assert.equal(child.recruitedAt,e.elapsed);
  assert.equal(m.seedOpportunity,false);assert.equal(m.massGrams,mass-J.seedMassGrams);
  assert.equal(e.lifecycle.seededPlants,1);
  assert.ok(Math.abs(ecologyEnergy(e)-prior-e.ledger.photosynthesisKcal+e.ledger.metabolizedKcal+e.ledger.decomposedKcal+e.ledger.discardedKcal)<1e-5);
  tickEnvironment(env,.5);tickOzarkEcology(e,.5,env,[]);
  assert.ok(e.lifecycle.growthMassGrams>0);
  const stock=lifecycleStockAudit(e);
  assert.ok(Math.abs(stock.massErrorGrams)<1e-7&&Math.abs(stock.energyErrorKcal)<1e-7);
  assert.deepEqual(validateOzarkEcology(structuredClone(e),geometry,{seed:e.seed,elapsed:env.elapsed}),durable(e));
});
