import test from 'node:test';
import assert from 'node:assert/strict';
import {createOzarkState} from '../src/ozark-save.js';
import {createOzarkWorldGeometry} from '../src/ozark-world-geometry.js';
import {bindOzarkWorldAgent} from '../src/ozark-agent-world.js';
import {observeNpc,requestNpcAction,tickNpc} from '../src/npc.js';
import {discoveryDecision,processDiscoveryFeedback} from '../src/discovery.js';
import {NpcController} from '../src/controller.js';
import {foodRunSnapshot} from '../src/food-run-observer.js';
import {tickEnvironment} from '../src/environment.js';
import {CONFIG} from '../src/config.js';
import {projectPhysiology} from '../src/biology.js';
import {distance} from '../src/world.js';

// An explicitly authored engineering placement with actual Ozark geometry,
// personally earned feedback and normal paid actions. This is no ordinary run.
function fixture(){
  const geometry=createOzarkWorldGeometry(),state=createOzarkState(geometry),
    actor=state.agents[0],environment=state.environment;
  const tree=environment.ecology.plants.find(plant=>plant.kind==='apple_tree'&&
    plant.quantity>2&&geometry.canOccupy(plant.position.x+45,plant.position.y,CONFIG.playerRadius));
  assert.ok(tree);
  actor.position={x:tree.position.x+45,y:tree.position.y};
  bindOzarkWorldAgent(actor,geometry,state);observeNpc(actor,environment);
  function tick(){
    tickEnvironment(environment,.1);state.elapsed=environment.elapsed;
    environment.ecology.elapsed=environment.elapsed;
    tickNpc(actor,.1,environment);processDiscoveryFeedback(actor);
  }
  function finish(action){
    const start=requestNpcAction(actor,action,environment);
    assert.equal(start.ok,true,start.code);
    for(let i=0;i<400&&actor.active;i++)tick();
    assert.equal(actor.active,null);
    return actor.lastResult;
  }
  return {actor,environment,tree,tick,finish};
}

test('earned Ozark route crosses observed reach into actual paid acquisition and sampling',()=>{
  const f=fixture(),{actor,tree,tick,finish}=f;
  const first=finish({type:'pull',targetId:tree.id}),item=first.materialId;
  assert.equal(first.ok,true);
  assert.equal(finish({type:'sample',targetId:item}).code,'SWALLOWED');
  for(let i=0;i<1000;i++)tick();
  assert.ok(actor.discovery.techniques.some(t=>t.sourceId===tree.id&&t.confidence==='tentative'));
  assert.equal(finish({type:'release',targetId:item}).ok,true);
  assert.equal(foodRunSnapshot(actor).stages.travel.selected,0,
    'Manual initial actions are not misattributed to a learned run');

  actor.position={x:6480,y:-6240};observeNpc(actor,f.environment);
  actor.physiology.hoursSinceMeal=12;actor.physiology.satietyHours=0;
  projectPhysiology(actor);
  assert.ok(distance(actor.position,tree.position)>80);
  const controller=new NpcController(actor,{environment:f.environment,deferInitialObservation:true});
  try{
    const step=()=>{
      const decision=discoveryDecision(actor,{handlingCuriosity:false});
      const started=controller.perform(decision.action);
      assert.equal(started.ok,true,started.code);
      for(let i=0;i<400&&actor.active;i++)tick();
      assert.equal(actor.active,null);
      observeNpc(actor,f.environment);
      return {decision,result:actor.lastResult};
    };
    const travel=step();
    assert.equal(travel.decision.action.type,'move');
    assert.equal(travel.result.code,'ARRIVED');
    assert.ok(distance(actor.position,tree.position)<80);
    let observed=foodRunSnapshot(actor);
    assert.equal(observed.stages.travel.selected,1);
    assert.equal(observed.stages.travel.admitted,1);
    assert.equal(observed.stages.travel.firstPaid,1);
    assert.equal(observed.stages.travel.completed,1);
    assert.equal(observed.stages.travel.reach.observed,0);

    const acquired=step();
    assert.equal(acquired.decision.action.type,'pull');
    assert.equal(acquired.result.code,'piece_detached');
    observed=foodRunSnapshot(actor);
    assert.equal(observed.stages.acquisition.reach.observed,1);
    assert.equal(observed.stages.acquisition.admitted,1);
    assert.equal(observed.stages.acquisition.firstPaid,1);
    assert.equal(observed.stages.acquisition.completed,1);

    const sampled=step();
    assert.equal(sampled.decision.action.type,'sample');
    assert.equal(sampled.result.code,'SWALLOWED');
    observed=foodRunSnapshot(actor);
    assert.equal(observed.stages.sample.reach.held,1);
    assert.equal(observed.stages.sample.admitted,1);
    assert.equal(observed.stages.sample.firstPaid,1);
    assert.equal(observed.stages.sample.completed,1);
    assert.equal(observed.pending.active,0);
    discoveryDecision(actor,{handlingCuriosity:false});
    observed=foodRunSnapshot(actor);
    assert.equal(observed.runEnds.complete,1,
      'A finished physical sample is followed by one distinct run-completion decision');
    assert.deepEqual(foodRunSnapshot(actor),observed,'Repeated reads cannot advance stages');
    assert.equal(Object.hasOwn(actor,'foodRunObserver'),false,'No observer state enters the actor');
  }finally{controller.dispose();}
});

test('an exact selected learned pull rejected before physical admission stays an unpaid rejection',()=>{
  const f=fixture(),{actor,tree,tick,finish}=f;
  const first=finish({type:'pull',targetId:tree.id});
  finish({type:'sample',targetId:first.materialId});
  for(let i=0;i<1000;i++)tick();
  finish({type:'release',targetId:first.materialId});
  actor.physiology.hoursSinceMeal=12;actor.physiology.satietyHours=0;
  projectPhysiology(actor);
  const controller=new NpcController(actor,{environment:f.environment,deferInitialObservation:true});
  try{
    const choice=discoveryDecision(actor,{handlingCuriosity:false});
    assert.equal(choice.action.type,'pull');
    actor.position={x:6480,y:-6240}; // Authored post-choice loss of reach.
    const result=controller.perform(choice.action);
    assert.equal(result.ok,false);
    assert.equal(actor.active,null);
    const observed=foodRunSnapshot(actor).stages.acquisition;
    assert.equal(observed.selected,1);
    assert.equal(observed.immediateRejected,1);
    assert.equal(observed.admitted,0);
    assert.equal(observed.firstPaid,0);
    assert.equal(observed.certifiedPaidSeconds,0);
    assert.equal(observed.completed,0);
  }finally{controller.dispose();}
});
