import test from 'node:test';
import assert from 'node:assert/strict';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { createOzarkState } from '../src/ozark-save.js';
import { bindOzarkWorldAgent } from '../src/ozark-agent-world.js';
import { bindOzarkEcology } from '../src/ozark-ecology.js';
import { observeNpc, requestNpcAction, tickNpc } from '../src/npc.js';
import { NpcController } from '../src/controller.js';
import { processDiscoveryFeedback } from '../src/discovery.js';
import { projectPhysiology } from '../src/biology.js';
import { foodRunSnapshot, setFoodRunObserverEnabled } from '../src/food-run-observer.js';

test('food-run observer enabled and disabled produce identical paid world, actor, learner and RNG states', () => {
  // The setup earns a real personal technique from paid actions and delayed
  // bodily feedback. Placement is an engineered fixture, not an ordinary run.
  const geometryA=createOzarkWorldGeometry(),geometryB=createOzarkWorldGeometry();
  const template=createOzarkState(geometryA,{communicationSeed:211});
  const actor=template.agents[0];
  const source=template.environment.ecology.plants.find(plant =>
    plant.kind==='apple_tree' && plant.quantity>0 &&
    geometryA.canOccupy(plant.position.x+45,plant.position.y,11));
  assert.ok(source,'a real stocked and reachable plant is available');
  actor.position={x:source.position.x+45,y:source.position.y};
  bindOzarkWorldAgent(actor,geometryA,template);
  observeNpc(actor,template.environment);
  assert.ok(actor.discovery.observations[source.id],'the actor sees the real source');
  const paid=request => {
    assert.equal(requestNpcAction(actor,request,template.environment).code,'ACTION_STARTED');
    for(let i=0;i<1000 && actor.active;i++)tickNpc(actor,1/60,template.environment);
    assert.equal(actor.active,null);
    assert.equal(actor.lastResult.ok,true);
  };
  paid({type:'pull',targetId:source.id});
  const firstMaterial=actor.inventory.items[0];
  paid({type:'sample',targetId:firstMaterial});
  for(let i=0;i<6000 && actor.discovery.techniques.length===0;i++){
    tickNpc(actor,1/60,template.environment);
    processDiscoveryFeedback(actor);
  }
  assert.ok(actor.discovery.techniques.some(t => t.sourceId===source.id));
  paid({type:'release',targetId:firstMaterial});
  actor.physiology.hoursSinceMeal=9;
  actor.physiology.satietyHours=0;
  actor.physiology.waterDeficitMl=0;
  projectPhysiology(actor);
  actor.nextDecisionAt=actor.elapsed;

  const clone=geometry => {
    const state=structuredClone(template);
    bindOzarkEcology(state.environment.ecology,geometry);
    for(const n of state.agents)bindOzarkWorldAgent(n,geometry,state);
    return state;
  };
  const enabled=clone(geometryA),disabled=clone(geometryB);
  assert.equal(setFoodRunObserverEnabled(disabled.agents[0],false),true);
  const left=new NpcController(enabled.agents[0],{environment:enabled.environment});
  const right=new NpcController(disabled.agents[0],{environment:disabled.environment});
  try{
    assert.deepEqual(enabled,disabled);
    const priorExperiments=enabled.agents[0].discovery.experiments.length;
    let ticks=0;
    for(;ticks<1000;ticks++){
      left.tick(1/60);
      right.tick(1/60);
      if(ticks%60===0)assert.deepEqual(enabled,disabled);
      if(enabled.agents[0].discovery.experiments.slice(priorExperiments).some(e =>
        e.primitive==='sample' && e.ok))break;
    }
    assert.ok(ticks<1000,'the second real paid pull and sample complete');
    assert.deepEqual(enabled,disabled,'all world, actor, learner and RNG bytes match');
    assert.deepEqual(enabled.agents[0].discovery.experiments.slice(priorExperiments)
      .map(e => e.primitive),['pull','sample']);
    const observed=foodRunSnapshot(enabled.agents[0]);
    for(const stage of ['acquisition','sample']){
      const row=observed.stages[stage];
      assert.equal(row.selected,1);
      assert.equal(row.admitted,1);
      assert.equal(row.firstPaid,1);
      assert.equal(row.completed,1);
      assert.ok(row.certifiedPaidSeconds>0);
      assert.equal(foodRunSnapshot(disabled.agents[0]).stages[stage].selected,0);
    }
    assert.equal(observed.stages.acquisition.reach.observed,1);
    assert.equal(observed.stages.sample.reach.held,1);
  }finally{
    left.dispose();
    right.dispose();
  }
});
