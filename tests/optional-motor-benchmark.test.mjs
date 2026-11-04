import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpc } from '../src/npc-state.js';
import { createEnvironment } from '../src/environment.js';
import { createEcology } from '../src/ecology.js';
import { observeNpc, requestNpcAction, tickNpc, cancelNpcAction } from '../src/npc.js';
import { discoveryDecision } from '../src/discovery.js';
import { optionalMotorFeatures, rankOptionalMotorChoices } from '../src/optional-motor-features.js';
import { createOptionalMotorModel, optionalMotorProbability,
  updateOptionalMotorModel } from '../src/optional-motor-core.js';

// Authored engineering geometry, fixed before outcomes. This is not an
// ordinary run, a seed search, a food label, or a new production policy.
function fixture(ids=['object:1','object:4']){
  const actor=createNpc({mode:'discovery',seed:74193});
  const environment=createEnvironment({seed:74193});
  environment.ecology=createEcology(74193);
  environment.ecology.plants=environment.ecology.plants.filter(p=>ids.includes(p.id));
  environment.ecology.animals=[];environment.ecology.materials=[];
  actor.position={x:400,y:1080};observeNpc(actor,environment);
  return {actor,environment};
}

function paidTrial(actor,environment,action){
  const frozen=optionalMotorFeatures(actor,{action});
  const beforeKcal=actor.physiology.totals.metabolizedKcal;
  const beforeId=actor.memory.experience.at(-1)?.id??0;
  const admission=requestNpcAction(actor,action,environment);
  if(admission.code!=='ACTION_STARTED')return {status:'admission-censored',code:admission.code};
  const active=actor.active;
  assert.ok(active&&active.request.type===action.type&&active.request.targetId===action.targetId);
  for(let i=0;i<700&&actor.active;i++)tickNpc(actor,.05,environment);
  assert.equal(actor.active,null,'the fixed engineering action reached a terminal state');
  const result=actor.lastResult;
  const event=actor.memory.experience.find(row=>row.id===result?.eventId);
  const experiment=actor.discovery.experiments.find(row=>row.actionId===result?.eventId);
  const complete=!!frozen&&result?.eventId>beforeId&&event?.type==='action'&&
    event.details.action?.type===action.type&&event.details.action?.targetId===action.targetId&&
    experiment?.primitive===action.type&&experiment.targetId===action.targetId&&
    experiment.code===result.code&&experiment.ok===result.ok&&
    result.durationSeconds>=active.seconds-1e-8&&result.durationSeconds<=active.seconds+1e-8;
  observeNpc(actor,environment);
  return {status:complete?'paid-complete':'completion-censored',code:result?.code,
    owner:actor,actionId:result?.eventId,
    ...(complete?{outcome:result.ok?1:0,features:frozen}:{}),
    paidSeconds:result?.durationSeconds??0,
    metabolizedKcal:actor.physiology.totals.metabolizedKcal-beforeKcal,
    action:{...action}};
}

function trainer(owner){
  let model=createOptionalMotorModel(),all={n:0,yes:0},byType=new Map();
  const rows=[],trained=new Set();
  const learn=trial=>{
    assert.equal(trial.status,'paid-complete');
    assert.equal(trial.owner,owner,'another actor cannot train this local model');
    assert.ok(Number.isInteger(trial.actionId)&&trial.actionId>0);
    assert.equal(trained.has(trial.actionId),false,'one paid receipt trains at most once');
    trained.add(trial.actionId);
    const type=trial.action.type,prior=byType.get(type)??{n:0,yes:0};
    model=updateOptionalMotorModel(model,trial.features,trial.outcome).model;
    all={n:all.n+1,yes:all.yes+trial.outcome};
    byType.set(type,{n:prior.n+1,yes:prior.yes+trial.outcome});
  };
  const observe=(trial,train=true)=>{
    assert.equal(trial.status,'paid-complete');
    assert.equal(trial.owner,owner,'another actor cannot train this local model');
    if(train)assert.equal(trained.has(trial.actionId),false,
      'one paid receipt trains at most once');
    const type=trial.action.type,prior=byType.get(type)??{n:0,yes:0};
    const modelBefore=optionalMotorProbability(model,trial.features);
    const pooledBefore=(all.yes+1)/(all.n+2);
    const typeBefore=(prior.yes+1)/(prior.n+2);
    rows.push({type,targetClass:'opaque',outcome:trial.outcome,
      probability:modelBefore,pooled:pooledBefore,primitivePrior:typeBefore,
      paidSeconds:trial.paidSeconds,metabolizedKcal:trial.metabolizedKcal});
    if(train)learn(trial);
    return modelBefore;
  };
  return {observe,learn,rows,get model(){return model;},get count(){return all.n;}};
}

test('actor-owned paid warm-up supports only narrow held-out motor prediction and a costed one-step comparison',()=>{
  const {actor,environment}=fixture(),learning=trainer(actor);
  // The first object's trials are authored exploration. The second object is
  // held out until after its predictions are frozen; neither ID is a feature.
  const grassGrasp=paidTrial(actor,environment,{type:'grasp',targetId:'object:4'});
  const grassPull=paidTrial(actor,environment,{type:'pull',targetId:'object:4'});
  assert.deepEqual([grassGrasp.outcome,grassPull.outcome],[0,1]);
  learning.observe(grassGrasp);learning.observe(grassPull);
  const appleGraspFeatures=optionalMotorFeatures(actor,{action:{type:'grasp',targetId:'object:1'}});
  const applePullFeatures=optionalMotorFeatures(actor,{action:{type:'pull',targetId:'object:1'}});
  const heldoutBefore=[optionalMotorProbability(learning.model,appleGraspFeatures),
    optionalMotorProbability(learning.model,applePullFeatures)];
  assert.ok(heldoutBefore[0]<.5&&heldoutBefore[1]>.5,
    'Only primitive-level motor evidence transfers to the different object');
  const appleGrasp=paidTrial(actor,environment,{type:'grasp',targetId:'object:1'});
  const applePull=paidTrial(actor,environment,{type:'pull',targetId:'object:1'});
  assert.deepEqual([appleGrasp.outcome,applePull.outcome],[0,1]);
  // Freeze both held-out scores before fitting either result. This is a
  // controlled evaluation holdout, separate from the warm-up prequential rows.
  assert.equal(learning.observe(appleGrasp,false),heldoutBefore[0]);
  assert.equal(learning.observe(applePull,false),heldoutBefore[1]);
  learning.learn(appleGrasp);learning.learn(applePull);
  assert.equal(learning.count,4);
  assert.equal(actor.discovery.techniques.length,0,'a detached piece is not nutritional proof');
  assert.equal(actor.discovery.effects.length,0);

  // Match the actor/world/RNG at the optional boundary. Each branch executes
  // only its own chosen action; divergent later futures are not compared.
  const authoredActor=structuredClone(actor),learnedActor=structuredClone(actor);
  const authoredEnvironment=structuredClone(environment);
  const learnedEnvironment=structuredClone(environment);
  const authored=discoveryDecision(authoredActor,{handlingCuriosity:false});
  let inspected=0,chosenIndex=null;
  const learned=discoveryDecision(learnedActor,{handlingCuriosity:false,
    chooseOptional:choices=>{
      inspected=choices.length;
      chosenIndex=rankOptionalMotorChoices(learnedActor,choices,learning.model,learning.count);
      return chosenIndex;
    }});
  assert.ok(inspected>0&&inspected<=64&&chosenIndex!==null);
  assert.equal(authoredActor.rng,learnedActor.rng,
    'numeric ranking consumes no extra policy RNG before physical divergence');
  const authoredResult=paidTrial(authoredActor,authoredEnvironment,authored.action);
  const learnedResult=paidTrial(learnedActor,learnedEnvironment,learned.action);
  assert.equal(authoredResult.status,'paid-complete');
  assert.equal(learnedResult.status,'paid-complete');
  assert.ok(authoredResult.metabolizedKcal>0&&learnedResult.metabolizedKcal>0);
  const brier=(rows,field)=>rows.reduce((sum,row)=>sum+(row[field]-row.outcome)**2,0)/rows.length;
  const summary={fixedSeed:74193,trainingExamples:learning.count,heldoutBefore,
    warmupBrier:{model:brier(learning.rows.slice(0,2),'probability'),
      pooled:brier(learning.rows.slice(0,2),'pooled'),
      primitivePrior:brier(learning.rows.slice(0,2),'primitivePrior')},
    heldoutBrier:{model:brier(learning.rows.slice(2),'probability'),
      pooled:brier(learning.rows.slice(2),'pooled'),
      primitivePrior:brier(learning.rows.slice(2),'primitivePrior'),
      noUpdate:.25},
    authored:{action:authored.action.type,ok:authoredResult.outcome,
      paidSeconds:authoredResult.paidSeconds,kcal:authoredResult.metabolizedKcal},
    prototype:{action:learned.action.type,ok:learnedResult.outcome,
      paidSeconds:learnedResult.paidSeconds,kcal:learnedResult.metabolizedKcal}};
  assert.ok([...Object.values(summary.warmupBrier),...Object.values(summary.heldoutBrier)]
    .every(Number.isFinite));
  console.log('OPTIONAL_MOTOR_ENGINEERING_BENCHMARK',JSON.stringify(summary));
});

test('finite stock reversal is learned only from this actor’s later fully paid failures',()=>{
  const {actor,environment}=fixture(['object:1']),learning=trainer(actor);
  for(let i=0;i<6;i++){
    const pull=paidTrial(actor,environment,{type:'pull',targetId:'object:1'});
    assert.equal(pull.status,'paid-complete');assert.equal(pull.outcome,1);
    learning.observe(pull);
    const held=actor.inventory.items.at(-1);
    assert.equal(paidTrial(actor,environment,{type:'release',targetId:held}).status,'paid-complete');
  }
  assert.equal(environment.ecology.plants[0].quantity,0);
  const fixed=optionalMotorFeatures(actor,{action:{type:'pull',targetId:'object:1'}});
  const before=optionalMotorProbability(learning.model,fixed);
  for(let i=0;i<4;i++){
    const empty=paidTrial(actor,environment,{type:'pull',targetId:'object:1'});
    assert.equal(empty.status,'paid-complete');assert.equal(empty.code,'nothing_detached');
    assert.equal(empty.outcome,0);learning.observe(empty);
  }
  assert.ok(optionalMotorProbability(learning.model,fixed)<before);
  assert.equal(actor.discovery.effects.length,0,'no food outcome was invented');
});

test('admission refusal and partial priority cancellation are censored, with no copied actor model',()=>{
  const {actor,environment}=fixture(['object:1']),learning=trainer(actor);
  const refused=paidTrial(actor,environment,{type:'sample',targetId:'object:1'});
  assert.equal(refused.status,'admission-censored');
  const frozen=optionalMotorFeatures(actor,{action:{type:'pull',targetId:'object:1'}});
  const before=optionalMotorProbability(learning.model,frozen);
  assert.equal(requestNpcAction(actor,{type:'pull',targetId:'object:1'},environment).code,'ACTION_STARTED');
  tickNpc(actor,.1,environment);
  assert.equal(cancelNpcAction(actor,'PRIORITY_CHANGED'),true);
  assert.equal(actor.lastResult.code,'PRIORITY_CHANGED');
  assert.ok(actor.lastResult.durationSeconds<5);
  assert.equal(learning.count,0);
  assert.equal(optionalMotorProbability(learning.model,frozen),before);
  const otherActor=fixture(['object:1']).actor,other=trainer(otherActor);
  const paid=paidTrial(actor,environment,{type:'grasp',targetId:'object:1'});
  learning.observe(paid);
  assert.equal(other.count,0);
  assert.equal(optionalMotorProbability(other.model,paid.features),.5);
  assert.throws(()=>learning.observe(paid),/at most once/);
  assert.throws(()=>other.observe(paid),/another actor/);
});
