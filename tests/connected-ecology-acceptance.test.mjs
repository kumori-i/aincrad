import test from 'node:test';
import assert from 'node:assert/strict';
import {CONFIG, PONDS} from '../src/config.js';
import {ECOLOGY_MATERIALS as MATERIALS, ECOLOGY_RULES as R, ECOLOGY_SPECIES as SPECIES} from '../src/ecology-config.js';
import {createEcology, ecologyCoverage, ecologyEnergy, interactEcologyObject, senseEcology, tickEcology} from '../src/ecology.js';

import {advanceRegionalWater, consumeConnectedGrowth, habitatConditions, plantSuitability,
  regionAt, regionIndex, regionRunoffGraph, regionalResourceAudit, regionalWaterAudit} from '../src/ecology-regions.js';
import {canStandOutside, distance, freshState, waterDistance} from '../src/world.js';

// Chosen before inspecting results. The latter pair is held out from fixture design.
const developmentSeeds=[7919,104729],heldoutSeeds=[130363,155921];
const seeds=[...developmentSeeds,...heldoutSeeds];
const connected=seed=>createEcology(seed,0,{connectedEcology:true});
const near=(actual,expected,label,tolerance=1e-7)=>assert.ok(Math.abs(actual-expected)<=tolerance,
  `${label}: expected ${expected}, received ${actual}`);
const waterBalance=e=>{
  const audit=regionalWaterAudit(e);
  near(audit.maxRegionalWaterError,0,'largest regional water residual',1e-6);
  near(audit.waterBalanceError,0,'whole soil-water residual',1e-6);
  for(const region of e.regions){
    assert.ok(region.soilWaterMl>=0&&region.soilWaterMl<=region.soilWaterCapacityMl+1e-7,region.id);
    near(region.initialWaterMl+region.rainMl+region.seepageMl+region.runoffInMl,
      region.soilWaterMl+region.runoffOutMl+region.evaporationMl+region.uptakeMl,
      `${region.id} named water inputs and outputs`,1e-6);
  }
  return audit;
};
const energyBalance=e=>{
  const l=e.ledger,inputs=l.initialKcal+l.photosynthesisKcal+l.externalKcal;
  const outputs=ecologyEnergy(e)+l.humanRemovedKcal+l.metabolizedKcal+l.decomposedKcal+l.discardedKcal;
  near(outputs,inputs,'ecological energy inputs and outputs',1e-6);
};
const storage=(initial=null)=>{
  let bytes=initial,writes=0;
  return {getItem:key=>key===CONFIG.saveKey?bytes:null,
    setItem:(key,value)=>{assert.equal(key,CONFIG.saveKey);bytes=value;writes++;},
    get bytes(){return bytes;},get writes(){return writes;}};
};

test('predeclared development and held-out seeds keep deterministic geography, placements and caps',()=>{
  const graph=regionRunoffGraph();
  assert.equal(graph.length,R.habitatGridSize**2);
  assert.equal(new Set(graph.map(row=>row.id)).size,graph.length);
  const byId=new Map(graph.map(row=>[row.id,row]));
  assert.ok(graph.some(row=>row.hasFixedWater));
  for(const pond of PONDS)assert.equal(graph[regionIndex(pond)].hasFixedWater,true,`small pond ${pond.id} is sampled`);
  for(const row of graph){
    assert.ok(Number.isFinite(row.potential)&&Number.isFinite(row.nearestWater));
    const visited=new Set();let current=row;
    while(byId.has(current.to)){
      assert.ok(!visited.has(current.id),`runoff loop at ${current.id}`);visited.add(current.id);
      const downstream=byId.get(current.to);
      assert.ok(downstream.potential<current.potential-1e-9||
        Math.abs(downstream.potential-current.potential)<=1e-9&&downstream.id<current.id,
      `${current.id} must descend in (potential, region ID) order`);
      current=downstream;
    }
    assert.ok(current.to==='fixed-water'||current.to===`model-outlet:${current.id}`,current.to);
    if(current.to==='fixed-water')assert.equal(current.hasFixedWater,true);
  }
  for(const seed of seeds){
    const e=connected(seed),second=connected(seed),coverage=ecologyCoverage(e);
    assert.deepEqual(e,second,`seed ${seed} exact initial ecology`);
    assert.equal(e.ecosystemModelVersion,1);
    assert.equal(e.regions.length,graph.length);
    assert.ok(e.plants.length<=R.maxPlants-32,`seed ${seed} leaves recruitment capacity`);
    assert.ok(e.animals.length<=R.maxAnimals);
    assert.equal(coverage.plantRegions,49,`seed ${seed} starts vegetation across the 49-region map`);
    assert.ok(Object.values(coverage.quadrants).every(value=>value>0));
    assert.ok(coverage.species.rabbit>0&&coverage.species.fox>0&&coverage.species.bobcat>0);
    for(const [species,n] of Object.entries(coverage.species))assert.ok(n<=SPECIES[species].maxPopulation);
    for(const plant of e.plants){
      assert.equal(canStandOutside(plant.position.x,plant.position.y,10),true,plant.id);
      assert.equal(plantSuitability(plant.kind,plant.position,1),true,plant.id);
      assert.ok(habitatConditions(plant.position,1).productivity>0);
    }
    for(const animal of e.animals){
      assert.equal(canStandOutside(animal.position.x,animal.position.y,SPECIES[animal.species].radius),true,animal.id);
      assert.ok(waterDistance(animal.position.x,animal.position.y)<=SPECIES[animal.species].sight,
        `${seed}/${animal.id} starts within physical sight of water`);
    }
    waterBalance(e);
  }
});

test('controlled seven-day rainfall traverses each runoff edge once and reconciles local and outlet water',()=>{
  const e=connected(developmentSeeds[0]),graph=regionRunoffGraph(),byId=new Map(graph.map((row,index)=>[row.id,index]));
  const before=waterBalance(e);
  advanceRegionalWater(e,CONFIG.dayRealSeconds*7,{rainfall:4,seepage:0,evaporation:0});
  const after=waterBalance(e);
  assert.ok(after.rainMl>before.rainMl&&e.regions.some(row=>row.runoffOutMl>0));
  assert.equal(after.seepageMl,before.seepageMl);
  assert.equal(after.evaporationMl,before.evaporationMl);
  for(const [index,node] of graph.entries()){
    const row=e.regions[index];
    if(node.to.startsWith('region:')){
      const target=e.regions[byId.get(node.to)];
      assert.ok(target.runoffInMl>=row.runoffOutMl-1e-6);
    }else if(node.to==='fixed-water'||node.to.startsWith('model-outlet:')){
      assert.ok(row.runoffOutMl>=0);
    }
  }
  const edgeTransfers=e.regions.reduce((sum,row,index)=>sum+(graph[index].to.startsWith('region:')?row.runoffOutMl:0),0);
  near(e.regions.reduce((sum,row)=>sum+row.runoffInMl,0),edgeTransfers,'internal transfers',1e-6);
});

test('same-region water and nutrients admit only their joint finite fraction',()=>{
  const e=connected(developmentSeeds[1]),grass=e.plants.find(p=>p.kind==='grass');
  const local=regionAt(e,grass.position),remote=e.regions.find(row=>row!==local);
  const otherBefore={nutrients:remote.nutrients,water:remote.soilWaterMl};
  const wantedNutrients=local.nutrients*2,wantedWater=local.soilWaterMl*4;
  const before={nutrients:local.nutrients,water:local.soilWaterMl,aggregate:e.detritus.nutrients};
  const result=consumeConnectedGrowth(e,grass.position,wantedNutrients,wantedWater);
  near(result.fraction,.25,'limiting water fraction',1e-12);
  near(result.nutrients,wantedNutrients*.25,'same-region nutrient debit',1e-7);
  near(result.waterMl,wantedWater*.25,'same-region water debit',1e-7);
  near(before.nutrients-local.nutrients,result.nutrients,'local nutrient stock',1e-7);
  near(before.water-local.soilWaterMl,result.waterMl,'local water stock',1e-7);
  near(before.aggregate-e.detritus.nutrients,result.nutrients,'aggregate nutrient stock',1e-7);
  assert.deepEqual({nutrients:remote.nutrients,water:remote.soilWaterMl},otherBefore);
  const nutrientsAfter=local.nutrients;
  assert.deepEqual(consumeConnectedGrowth(e,grass.position,1,1),{fraction:0,nutrients:0,waterMl:0});
  assert.equal(local.nutrients,nutrientsAfter,'no nutrient spent after local water reaches zero');
  waterBalance(e);
  near(regionalResourceAudit(e).soilBalanceError,0,'regional nutrient account',1e-6);
});

test('with rainfall and seepage disabled a nominally wet but empty-soil site cannot grow',()=>{
  const origin=connected(heldoutSeeds[0]);
  const grass=origin.plants.find(p=>p.kind==='grass'&&habitatConditions(p.position,1).moisture>.5&&
    p.biomassGrams<p.capacity-20);
  assert.ok(grass,'a productive wet grass site exists');
  const fertileOther=origin.regions.find(row=>row!==regionAt(origin,grass.position)&&row.nutrients>0);
  assert.ok(fertileOther,'another region remains fertile');
  const make=()=>{
    const e=structuredClone(origin);e.plants=[e.plants.find(p=>p.id===grass.id)];e.animals=[];
    e.ledger.initialKcal=ecologyEnergy(e);
    return e;
  };
  const dry=make(),wet=make(),dryRegion=regionAt(dry,grass.position),wetRegion=regionAt(wet,grass.position);
  dryRegion.soilWaterMl=0;dryRegion.initialWaterMl=0;
  const environment={settings:{hourOverride:12,weatherOverride:'clear'},
    regionalWaterInputs:{rainfall:0,seepage:0,evaporation:0}};
  const initial=grass.biomassGrams,dryUptake=dryRegion.uptakeNutrients;
  tickEcology(dry,.5,environment,[]);tickEcology(wet,.5,environment,[]);
  assert.ok(habitatConditions(grass.position,1).moisture>.5);
  assert.ok(dry.plants[0].biomassGrams<=initial,'dry stock has no photosynthetic gain');
  assert.equal(dryRegion.uptakeMl,0);
  assert.equal(dryRegion.uptakeNutrients,dryUptake,'dry plant cannot spend soil nutrients');
  assert.ok(wet.plants[0].biomassGrams>initial,'matched wet control grows');
  assert.ok(wetRegion.uptakeMl>0&&wetRegion.uptakeNutrients>0);
  assert.equal(dry.regions.find(row=>row.id===fertileOther.id).nutrients,fertileOther.nutrients);
  waterBalance(dry);waterBalance(wet);
  near(regionalResourceAudit(dry).soilBalanceError,0,'dry regional nutrient account',1e-6);
  near(regionalResourceAudit(wet).soilBalanceError,0,'wet regional nutrient account',1e-6);
  energyBalance(dry);energyBalance(wet);
});

test('a real detached apple uses reserved plant headroom for local seedling recruitment',()=>{
  const e=connected(heldoutSeeds[1]);
  assert.ok(R.maxPlants-e.plants.length>=32);
  const tree=e.plants.find(p=>p.kind==='apple_tree'&&p.quantity>0&&
    canStandOutside(p.position.x+45,p.position.y+30,10)&&
    waterDistance(p.position.x+45,p.position.y+30)>=12&&
    plantSuitability('apple_tree',{x:p.position.x+45,y:p.position.y+30},1));
  assert.ok(tree,'fruiting parent with a real locally suitable release point');
  e.animals=[];
  const originalCount=e.plants.length,originalEnergy=ecologyEnergy(e),position={x:tree.position.x+45,y:tree.position.y+30};
  const pulled=interactEcologyObject(e,tree.id,'pull',{actorId:'aster',position:tree.position});
  assert.equal(pulled.ok,true);
  assert.equal(interactEcologyObject(e,pulled.materialId,'release',{actorId:'aster',position}).ok,true);
  const source=e.materials.find(m=>m.id===pulled.materialId),sourceBefore={mass:source.massGrams,kcal:source.energyKcal,water:source.waterMl};
  e.elapsed=CONFIG.dayRealSeconds*4;source.ageHours=96;source.nextGerminationAt=e.elapsed;
  tickEcology(e,.5,{settings:{hourOverride:12,weatherOverride:'clear'},
    regionalWaterInputs:{rainfall:0,seepage:0,evaporation:0}},[]);
  const child=e.plants.find(p=>p.parentMaterialId===source.id);
  assert.ok(child,'a genuine material event recruits one juvenile');
  assert.equal(e.plants.length,originalCount+1);
  assert.equal(child.lifecycleStage,'juvenile');
  assert.equal(child.quantity,0);
  assert.ok(distance(child.position,position)<=24);
  assert.equal(source.seedOpportunity,false);
  near(child.structureMassGrams+source.massGrams,sourceBefore.mass,'mass transfer',1e-7);
  near(child.structureKcal+source.energyKcal,sourceBefore.kcal,'energy transfer',1e-7);
  near(child.structureWaterMl+source.waterMl,sourceBefore.water,'material water transfer',1e-7);
  assert.ok(ecologyEnergy(e)>=originalEnergy-1e-6,'seed transfer does not destroy ecology energy');
  waterBalance(e);
});

test('a thirsty animal reaches only a seen bank by paid collision-checked steps, then drinks',()=>{
  const e=connected(developmentSeeds[0]),rabbit=e.animals.find(a=>a.species==='rabbit'),pond=PONDS.find(p=>p.id==='meadow');
  e.animals=[rabbit];e.plants=[];
  rabbit.position={x:pond.x+pond.rx+130,y:pond.y};rabbit.homePosition={...rabbit.position};
  rabbit.hydration=0;rabbit.physiology.waterDeficitMl=900;
  assert.ok(canStandOutside(rabbit.position.x,rabbit.position.y,SPECIES.rabbit.radius));
  const start={...rabbit.position},deficit=rabbit.physiology.waterDeficitMl;
  let bank=null,totalTravel=0;
  for(let step=0;step<20&&e.ledger.waterConsumedMl===0;step++){
    const prior={...rabbit.position};
    tickEcology(e,.5,{settings:{hourOverride:12,weatherOverride:'clear'}},[]);
    const moved=distance(prior,rabbit.position);totalTravel+=moved;
    assert.ok(moved<=SPECIES.rabbit.speed*.5+1e-6,'every movement spends one physical step');
    assert.equal(canStandOutside(rabbit.position.x,rabbit.position.y,SPECIES.rabbit.radius),true);
    if(step===0){
      bank={...rabbit.targetPosition};
      assert.ok(distance(start,bank)<=SPECIES.rabbit.sight,'bank was locally observable');
      assert.ok(waterDistance(bank.x,bank.y)>=SPECIES.rabbit.radius+2&&waterDistance(bank.x,bank.y)<=60);
      assert.ok(canStandOutside(bank.x,bank.y,SPECIES.rabbit.radius));
    }
  }
  assert.ok(totalTravel>0&&distance(start,rabbit.position)>0,'the animal actually traveled');
  assert.ok(e.ledger.waterConsumedMl>0&&rabbit.physiology.waterDeficitMl<deficit);
  assert.ok(waterDistance(rabbit.position.x,rabbit.position.y)<=65);
  assert.equal(rabbit.activity,'drinking');
  waterBalance(e);
});

test('an unseen bank supplies no secret destination and no water during bounded search',()=>{
  const e=connected(developmentSeeds[1]),rabbit=e.animals.find(a=>a.species==='rabbit');
  e.animals=[rabbit];e.plants=[];
  rabbit.position={x:15000,y:3000};rabbit.homePosition={...rabbit.position};
  rabbit.hydration=0;rabbit.physiology.waterDeficitMl=900;
  const start={...rabbit.position},deficit=rabbit.physiology.waterDeficitMl;
  assert.ok(waterDistance(start.x,start.y)>SPECIES.rabbit.sight*3);
  for(let step=0;step<20;step++){
    const prior={...rabbit.position};
    tickEcology(e,.5,{settings:{hourOverride:12,weatherOverride:'clear'}},[]);
    assert.ok(distance(prior,rabbit.position)<=SPECIES.rabbit.speed*.5+1e-6);
    assert.ok(canStandOutside(rabbit.position.x,rabbit.position.y,SPECIES.rabbit.radius));
    assert.ok(rabbit.targetPosition&&distance(prior,rabbit.targetPosition)<=SPECIES.rabbit.sight*.45+1e-6,
      'search target stays within bounded local probe');
  }
  assert.equal(e.ledger.waterConsumedMl,0);
  assert.ok(rabbit.physiology.waterDeficitMl>deficit,'dehydration still accrues when search fails');
  assert.ok(distance(start,rabbit.position)>0&&waterDistance(rabbit.position.x,rabbit.position.y)>65);
  waterBalance(e);
});

test('observed finite grass is grazed, depletion gives no meal, and actual prey prompts predation',()=>{
  const e=connected(heldoutSeeds[0]),rabbit=e.animals.find(a=>a.species==='rabbit'),cat=e.animals.find(a=>a.species==='bobcat');
  const grass=e.plants.find(p=>p.kind==='grass');
  e.animals=[rabbit];e.plants=[grass];rabbit.position={...grass.position};rabbit.homePosition={...grass.position};
  rabbit.physiology.hoursSinceMeal=12;
  const seen=senseEcology(e,rabbit.position,'valley',SPECIES.rabbit.sight);
  assert.ok(seen.some(row=>row.id===grass.id));
  const startingBiomass=grass.biomassGrams;
  for(let step=0;step<120;step++)tickEcology(e,.5,{settings:{hourOverride:12,weatherOverride:'clear'}},[]);
  assert.ok(grass.biomassGrams<startingBiomass);
  assert.ok(rabbit.physiology.totals.ingestedKcal>0&&rabbit.physiology.totals.absorbedKcal>0);
  const ingested=rabbit.physiology.totals.ingestedKcal;
  grass.biomassGrams=0;rabbit.physiology.hoursSinceMeal=12;rabbit.physiology.stomach=[];
  for(let step=0;step<8;step++)tickEcology(e,.5,{settings:{hourOverride:12,weatherOverride:'clear'}},[]);
  assert.equal(rabbit.physiology.totals.ingestedKcal,ingested,'depleted forage supplies no new meal');
  // A separate controlled encounter excludes detached meat and other forage.
  e.animals=[cat,rabbit];e.plants=[];e.materials=[];
  cat.position={x:276,y:470};cat.homePosition={...cat.position};cat.physiology.hoursSinceMeal=16;
  rabbit.position={x:306,y:470};rabbit.homePosition={...rabbit.position};rabbit.physiology.stamina=0;rabbit.stamina=0;
  assert.ok(senseEcology(e,cat.position,'valley',SPECIES.bobcat.sight).some(row=>row.id===rabbit.id));
  for(let step=0;step<24;step++)tickEcology(e,.5,{settings:{hourOverride:12,weatherOverride:'clear'}},[]);
  assert.equal(e.deaths,1,'predator had to close on actual prey');
  assert.ok(e.materials.some(material=>material.kind==='carcass'));
  assert.ok(cat.physiology.totals.ingestedKcal>0);
  waterBalance(e);
});

test('a connected-world rabbit carcass returns mass and nutrients only at its actual death site',()=>{
  const e=connected(heldoutSeeds[1]),rabbit=e.animals.find(a=>a.species==='rabbit');
  e.animals=[rabbit];e.plants=[];
  e.ledger.initialKcal=ecologyEnergy(e);
  const local=regionAt(e,rabbit.position),before=e.regions.map(row=>({nutrients:row.nutrients,mass:row.massGrams}));
  for(let strike=0;strike<4;strike++){
    const result=interactEcologyObject(e,rabbit.id,'strike',{actorId:'aster',position:rabbit.position,power:4});
    assert.equal(result.ok,true);
  }
  assert.equal(e.deaths,1);
  assert.equal(e.animals.length,0);
  const carcass=e.materials.find(row=>row.kind==='carcass');
  assert.ok(carcass);
  assert.deepEqual(carcass.position,rabbit.position,'carcass remains at actual death coordinates');
  carcass.ageHours=MATERIALS.flesh.spoilDays*24;
  for(let step=0;step<120;step++)tickEcology(e,.5,{settings:{hourOverride:12,weatherOverride:'clear'},
    regionalWaterInputs:{rainfall:0,seepage:0,evaporation:0}},[]);
  const localIndex=e.regions.indexOf(local);
  assert.ok(local.massGrams>before[localIndex].mass);
  assert.ok(local.nutrients>before[localIndex].nutrients);
  assert.ok(local.mineralizedNutrients>0);
  for(const [index,row] of e.regions.entries())if(row!==local){
    near(row.massGrams,before[index].mass,`${row.id} nonlocal carcass mass`,1e-7);
    near(row.nutrients,before[index].nutrients,`${row.id} nonlocal carcass nutrients`,1e-7);
  }
  near(regionalResourceAudit(e).soilBalanceError,0,'carcass nutrient account',1e-6);
  near(regionalResourceAudit(e).maxRegionalMassError,0,'carcass mass account',1e-6);
  energyBalance(e);
  waterBalance(e);
});


