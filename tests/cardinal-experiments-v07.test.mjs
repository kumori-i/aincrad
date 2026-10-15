import test from 'node:test';
import assert from 'node:assert/strict';
import {freshState} from '../src/world.js';
import {PopulationRuntime} from '../src/population.js';
import {ecologyEnergy,interactEcologyObject} from '../src/ecology.js';
import {relievePhysiology} from '../src/biology.js';
import {applyWorldRules} from '../src/world-rules.js';
import {createCardinalExperiment} from '../src/cardinal-experiments.js';
import {measureCardinalWorld,compareCardinalMetrics,createCardinalMetricTracker,scoreCardinalMetrics} from '../src/cardinal-metrics.js';

const proposal=(to=2.5)=>({id:'growth:fixture',parameter:'plantGrowthMultiplier',from:1,to,reason:'Test whether depleted grass production improves without unaccounted resources.',context:'controlled grass fixture',at:0});
function fixture({humans=false}={}) {
  const state=freshState();
  if(!humans){state.agents=[];state.npc=null;}
  const ecology=state.environment.ecology,grass=ecology.plants.find(plant=>plant.kind==='grass');
  grass.biomassGrams=1200;grass.moisture=.9;ecology.plants=[grass];ecology.animals=[];ecology.materials=[];ecology.detritus.nutrients=10000;
  for(const key of Object.keys(ecology.ledger))ecology.ledger[key]=0;
  ecology.ledger.initialKcal=ecologyEnergy(ecology);
  state.environment.settings.hourOverride=14;state.environment.settings.weatherOverride='rainy';
  return state;
}
const runtimeFactory=state=>new PopulationRuntime(state,{cardinal:false});
function complete(job){let calls=0;while(!job.done&&calls++<100000)job.work({maxSteps:1024,maxMilliseconds:8});assert.ok(job.done,'bounded experiment finished');return job.result;}

test('real population engine establishes a paired grass-growth effect with a held-out comparison',()=>{
  const live=fixture(),before=structuredClone(live),job=createCardinalExperiment(live,proposal(),{runtimeFactory,horizonSeconds:900,seeds:[7,11,13],minimumGain:.01});
  const first=job.advance(6);assert.ok(first.steps>=2&&first.steps<=6);assert.equal(job.done,false);assert.deepEqual(live,before);
  const result=complete(job);
  assert.equal(result.status,'completed');assert.equal(result.recommendation,'adopt');assert.equal(result.pairs.length,3);
  assert.deepEqual(result.pairs.map(pair=>pair.role),['training','training','holdout']);
  for(const pair of result.pairs){assert.ok(pair.passed);assert.ok(pair.gain>.01);assert.equal(pair.control.seconds,900);assert.equal(pair.candidate.seconds,900);assert.ok(pair.candidate.after.resources.availableKcal>pair.control.after.resources.availableKcal);assert.ok(Math.abs(pair.candidate.ecology.balanceErrorKcal)<1e-6);assert.equal(pair.candidate.ecology.externalKcal,0);assert.equal(pair.rulesBefore.values.plantGrowthMultiplier,1);assert.equal(pair.rulesAfter.values.plantGrowthMultiplier,2.5);}
  assert.equal(result.provenance.steps,21600);assert.equal(result.provenance.cardinalDisabled,true);assert.equal(result.provenance.controlFrozen,true);
  assert.deepEqual(live,before,'neither replicas nor learned shadows change the live world');
});

test('an actual lower-growth candidate is rejected even though both worlds have no deaths',()=>{
  const result=complete(createCardinalExperiment(fixture(),proposal(.25),{runtimeFactory,horizonSeconds:900,seeds:[7,11,13]}));
  assert.equal(result.status,'completed');assert.equal(result.recommendation,'reject');assert.ok(result.pairs.every(pair=>pair.gain<0));
  assert.ok(result.pairs.every(pair=>pair.control.ecology.deaths===0&&pair.candidate.ecology.deaths===0));
});

test('unconsumed plant production cannot count as resolving a human nutrition gap',()=>{
  const result=complete(createCardinalExperiment(fixture(),{...proposal(),context:'nutrition_gap'},{runtimeFactory,horizonSeconds:900,seeds:[7,11,13]}));
  assert.equal(result.recommendation,'reject');assert.ok(result.pairs.every(pair=>pair.gain>.01));
  assert.ok(result.pairs.every(pair=>!pair.passed&&pair.reasons.includes('nutrition_gap_not_improved')));
});

test('each challenge copies identical physical state and RNG before its sole rule intervention',()=>{
  const captured=[];
  const job=createCardinalExperiment(fixture({humans:true}),proposal(),{horizonSeconds:.5,seeds:[3,5,9],runtimeFactory:(state,options)=>{
    assert.equal(options.cardinal,false);assert.equal(options.experiment,true);const copy=structuredClone(state);delete copy.environment.worldRules;captured.push({seed:options.seed,role:options.role,copy});return runtimeFactory(state);
  }});
  complete(job);assert.equal(captured.length,6);
  for(let index=0;index<captured.length;index+=2){assert.deepEqual(captured[index].copy,captured[index+1].copy);assert.equal(captured[index].role,'control');assert.equal(captured[index+1].role,'candidate');}
  assert.notEqual(captured[0].copy.agents[0].rng,captured[2].copy.agents[0].rng);
});

test('outside rescue energy and water never become independently earned food or adoption credit',()=>{
  const state=fixture({humans:true}),before=measureCardinalWorld(state);
  const actor=state.agents[0];relievePhysiology(actor,{energyKcal:500,waterMl:200});
  state.elapsed+=10;const interval=compareCardinalMetrics(before,measureCardinalWorld(state));
  assert.ok(interval.humans.assistanceKcal>0);assert.ok(interval.humans.assistanceWaterMl>0);assert.equal(interval.humans.independentAbsorbedKcal,0);assert.equal(interval.humans.nutritionRatio,0);
  const job=createCardinalExperiment(fixture({humans:true}),proposal(),{horizonSeconds:1,seeds:[2,4,8],runtimeFactory:(shadow,options)=>{
    const runtime=runtimeFactory(shadow);let first=true;
    return {tick(dt){if(first&&options.role==='candidate')for(const human of shadow.agents)relievePhysiology(human,{energyKcal:300,waterMl:100});first=false;runtime.tick(dt);},dispose(){runtime.dispose();}};
  }});
  const result=complete(job);assert.equal(result.recommendation,'reject');assert.ok(result.pairs.every(pair=>!pair.passed&&pair.reasons.includes('more_outside_assistance')));
});

test('step wrappers own the clock while raw tick wrappers receive exactly one world-clock increment',()=>{
  for(const wrapped of [false,true]){
    const result=complete(createCardinalExperiment(fixture(),proposal(),{horizonSeconds:1.1,seeds:[1,2,3],runtimeFactory:state=>{
      const runtime=runtimeFactory(state);return wrapped?{step(dt){state.elapsed+=dt;runtime.tick(dt);},dispose(){runtime.dispose();}}:runtime;
    }}));
    assert.equal(result.status,'completed');assert.ok(result.pairs.every(pair=>Math.abs(pair.control.seconds-1.1)<1e-9&&Math.abs(pair.candidate.seconds-1.1)<1e-9));
  }
});

test('unsupported actuators, stale source rules, insufficient seeds and oversized jobs fail closed',()=>{
  const cases=[{change:{parameter:'basalKcalPerDay'}},{change:{from:2}},{change:{to:99}},{options:{seeds:[1,1,2]}},{options:{maxTotalSteps:10}}];
  for(const entry of cases){let calls=0;const job=createCardinalExperiment(fixture(),{...proposal(),...entry.change},{horizonSeconds:900,seeds:[1,2,3],...entry.options,runtimeFactory:state=>{calls++;return runtimeFactory(state);}});const result=complete(job);assert.equal(result.status,'failed');assert.equal(result.recommendation,'reject');assert.equal(result.pairs.length,0);assert.equal(calls,0);}
});

test('a shadow that changes its control rules is rejected instead of claiming a frozen control',()=>{
  const result=complete(createCardinalExperiment(fixture(),proposal(),{horizonSeconds:1,seeds:[1,2,3],runtimeFactory:(state,options)=>{
    const runtime=runtimeFactory(state);let first=true;
    return {tick(dt){if(first&&options.role==='control')applyWorldRules(state.environment,{rainfallMultiplier:2});first=false;runtime.tick(dt);},dispose(){runtime.dispose();}};
  }}));
  assert.equal(result.recommendation,'reject');assert.ok(result.pairs.every(pair=>!pair.passed&&pair.reasons.includes('control_rules_changed')));
});

test('cancellation disposes both replicas and serializes an interrupted checkpoint without live copies',()=>{
  let disposed=0;
  const state=fixture(),job=createCardinalExperiment(state,proposal(),{horizonSeconds:900,runtimeFactory:shadow=>{const runtime=runtimeFactory(shadow);return {tick:dt=>runtime.tick(dt),dispose(){disposed++;runtime.dispose();}};}});
  job.advance(2);const pending=job.serialize();assert.equal(pending.status,'running');assert.equal(pending.resumable,false);assert.equal(pending.checkpoint.frame,1);assert.equal(pending.provenance.steps,2);assert.ok(pending.checkpoint.source);assert.equal('state' in pending,false);assert.equal('replicas' in pending,false);
  const result=job.cancel('Owner paused Cardinal.');assert.equal(result.status,'cancelled');assert.equal(result.recommendation,'reject');assert.equal(disposed,2);assert.equal(job.advance(20).steps,0);assert.equal(job.serialize().status,'cancelled');
});

test('frozen checkpoint provenance does not follow continued foreground time',()=>{
  const live=fixture();live.elapsed=50;const job=createCardinalExperiment(live,proposal(),{runtimeFactory,horizonSeconds:1,seeds:[1,2,3]});live.elapsed=100000;
  const result=complete(job);assert.equal(result.provenance.checkpointAt,50);assert.equal(result.provenance.completedAt,51);assert.equal(live.elapsed,100000);
});

test('private metrics distinguish insufficient intake, reserve drawdown and motion stalls',()=>{
  const state=fixture({humans:true}),tracker=createCardinalMetricTracker(state),actor=state.agents[0],before=measureCardinalWorld(state);
  actor.active={request:{type:'move'}};actor.physiology.totals.metabolizedKcal+=200;actor.physiology.storedEnergyKcal-=200;actor.physiology.totals.absorbedKcal+=10;actor.stats.criticalSeconds+=5;state.elapsed=10;
  tracker.sample(state,10);const measured=tracker.finish(state);assert.equal(measured.humans.nutritionRatio,.05);assert.equal(measured.humans.energyStoredKcal,-200);assert.equal(measured.humans.stallSeconds,10);assert.equal(measured.humans.criticalHours,5*24/3600);assert.equal(before.humans.count,2);
  const utility=scoreCardinalMetrics(measured);assert.ok(utility.score>=0&&utility.score<=1);assert.equal(utility.components.nutrition,.05);assert.equal(utility.components.practice,0);
});

test('paired resource measurements retain actual soil moisture and grass capacity',()=>{
  const state=fixture(),grass=state.environment.ecology.plants[0],metrics=measureCardinalWorld(state);
  assert.equal(metrics.resources.meanMoisture,.9);assert.equal(metrics.resources.biomassCapacityGrams,grass.capacity);assert.equal(metrics.resources.biomassFraction,1200/grass.capacity);
  const result=complete(createCardinalExperiment(state,proposal(),{runtimeFactory,horizonSeconds:.5,seeds:[1,2,3]}));
  for(const pair of result.pairs){assert.ok(pair.control.after.resources.meanMoisture>.9);assert.equal(pair.candidate.after.resources.biomassCapacityGrams,grass.capacity);assert.ok(pair.candidate.after.resources.biomassFraction>1200/grass.capacity);}
});

test('fertility control permits fewer real births but rejects additional animal mortality',()=>{
  const state=freshState();state.agents=[];state.npc=null;
  const ecology=state.environment.ecology;ecology.animals=ecology.animals.filter(animal=>animal.species==='rabbit').slice(0,2);ecology.plants=ecology.plants.filter(plant=>plant.kind==='grass').slice(0,8);ecology.materials=[];
  ecology.plants.forEach((plant,index)=>{plant.position={x:240+(index%4)*30,y:470+Math.floor(index/4)*40};});
  ecology.animals.forEach((animal,index)=>{animal.position={x:276+index*40,y:470};animal.homePosition={...animal.position};animal.physiology.availableEnergyKcal=70;animal.physiology.storedEnergyKcal=600;animal.physiology.hoursSinceMeal=0;animal.energy=100;animal.lastBirthHours=-1000;});
  for(const key of Object.keys(ecology.ledger))ecology.ledger[key]=0;ecology.ledger.initialKcal=ecologyEnergy(ecology);
  const fertility={...proposal(0),parameter:'animalReproductionMultiplier',context:'animal_habitat_pressure'};
  const result=complete(createCardinalExperiment(state,fertility,{runtimeFactory,horizonSeconds:.5,seeds:[1,2,3]}));
  for(const pair of result.pairs){assert.ok(pair.control.ecology.births>=2);assert.equal(pair.candidate.ecology.births,0);assert.ok(pair.candidate.after.animals.count<pair.control.after.animals.count);assert.ok(pair.passed);assert.equal(pair.reasons.includes('animal_population_regression'),false);}
  const failed=complete(createCardinalExperiment(state,fertility,{horizonSeconds:.5,seeds:[1,2,3],runtimeFactory:(shadow,options)=>{
    const runtime=runtimeFactory(shadow);let first=true;
    return {tick(dt){if(first&&options.role==='candidate'){const ecosystem=shadow.environment.ecology,animal=ecosystem.animals[0];for(let hit=0;hit<4;hit++)interactEcologyObject(ecosystem,animal.id,'strike',{actorId:'aster',position:animal.position,scene:animal.scene,power:4});}first=false;runtime.tick(dt);},dispose(){runtime.dispose();}};
  }}));
  assert.equal(failed.recommendation,'reject');assert.ok(failed.pairs.every(pair=>pair.reasons.includes('animal_mortality_regression')));
});
