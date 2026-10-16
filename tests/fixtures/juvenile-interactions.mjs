import assert from 'node:assert/strict';
import {CONFIG} from '../../src/config.js';
import {createEnvironment,tickEnvironment} from '../../src/environment.js';
import {ecologyEnergy,interactEcologyObject,lookupEcologyObject,tickEcology,validateEcology} from '../../src/ecology.js';
import {canStandOutside} from '../../src/world.js';

let seedlingCache,grownCache;
function recruit(){
  const env=createEnvironment(74193,{mode:'discovery'}),e=env.ecology;
  const tree=e.plants.find(p=>p.kind==='apple_tree');
  // Explicit copied finite-source fixture: retain one historical fruit-bearing
  // tree and existing regional soil, remove the other populations, and rebase
  // the opening energy account before any tested transfer. No stock is added.
  e.animals=[];e.plants=[tree];e.ledger.initialKcal=ecologyEnergy(e);
  env.settings={hourOverride:12,weatherOverride:'rainy'};
  const openingFruitQuantity=tree.quantity;
  const pulled=interactEcologyObject(e,tree.id,'pull',{actorId:'aster',position:tree.position});
  assert.equal(pulled.ok,true);
  const material=lookupEcologyObject(e,pulled.materialId);
  const point={x:tree.position.x+45,y:tree.position.y+30};
  assert.equal(canStandOutside(point.x,point.y,10),true);
  assert.equal(interactEcologyObject(e,material.id,'release',{actorId:'aster',position:point}).ok,true);
  // Deliberate clock/age intervention only; the source keeps its real finite
  // 180 g/95 kcal/153 ml stocks and germination consumes its existing 2 g.
  e.elapsed=env.elapsed=4*CONFIG.dayRealSeconds;material.ageHours=96;
  tickEnvironment(env,.5);tickEcology(e,.5,env,[]);
  const juvenile=e.plants.find(p=>p.lifecycleStage==='juvenile');
  assert.ok(juvenile);assert.equal(juvenile.parentMaterialId,material.id);
  assert.equal(juvenile.structureMassGrams,2);assert.equal(material.massGrams,178);
  return {env,treeId:tree.id,materialId:material.id,juvenileId:juvenile.id,point,
    intervention:{copiedFiniteSource:true,seed:74193,retainedEstablishedPlants:1,retainedAnimals:0,
      clockSetSeconds:4*CONFIG.dayRealSeconds,sourceAgeSetHours:96,sourceAction:'pull then release',openingFruitQuantity,
      hourOverride:12,weatherOverride:'rainy',recruitmentStepSeconds:.5,
      growthDays:0,growthStepSeconds:CONFIG.dayRealSeconds,structuralStocksManuallyAssigned:false}};
}

/** Cached copied worlds save test time, never substitute assigned biomass for
 * growth. The grown fixture advances eight real ecology days at normal growth
 * multiplier under deliberately constant noon/rain. In this seed it reaches
 * 50.63751662303633 g, with actual soil uptake and photosynthetic input. */
export function createJuvenileFixture({grown=false}={}){
  seedlingCache??=recruit();
  if(grown&&!grownCache){
    grownCache=structuredClone(seedlingCache);
    for(let day=0;day<8;day++){
      tickEnvironment(grownCache.env,CONFIG.dayRealSeconds);
      tickEcology(grownCache.env.ecology,CONFIG.dayRealSeconds,grownCache.env,[]);
    }
    grownCache.intervention.growthDays=8;
    const juvenile=lookupEcologyObject(grownCache.env.ecology,grownCache.juvenileId);
    assert.ok(juvenile.structureMassGrams>40);
    assert.deepEqual(validateEcology(structuredClone(grownCache.env.ecology)),grownCache.env.ecology);
  }
  const snapshot=structuredClone(grown?grownCache:seedlingCache),env=snapshot.env,e=env.ecology;
  return {env,e,tree:lookupEcologyObject(e,snapshot.treeId),material:lookupEcologyObject(e,snapshot.materialId),
    juvenile:lookupEcologyObject(e,snapshot.juvenileId),point:snapshot.point,intervention:snapshot.intervention};
}
