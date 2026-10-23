import test from 'node:test';
import assert from 'node:assert/strict';
import { createMovementRecoveryScene, checkMovementRecoveryReload } from '../scripts/movement-recovery-native-fixture.mjs';
const create = Function('return ('+createMovementRecoveryScene.toString()+')')();
const replay = Function('return ('+checkMovementRecoveryReload.toString()+')')();
const base = new URL('../',import.meta.url);

test('serialized controller fixture pays for completion and unfinished recovery; reload cannot restore authority (Node preparation only)',{timeout:300000},async()=>{
  for(const interrupt of [false,true]){
    const scene=await create(base);
    try{
      assert.equal(scene.blocked().failedReceipt.details.result.code,'ROUTE_BLOCKED');
      const admitted=scene.admit();assert.equal(admitted.decision.details.provider,'discovery-learner');
      const outcome=scene.advance({interrupt});
      assert.ok(outcome.at>admitted.at);assert.ok(outcome.position.y<admitted.position.y);
      if(interrupt){assert.ok(outcome.active.attemptedDistance>0);assert.ok(outcome.active.travelled>0);}
      else{assert.equal(outcome.lastResult.code,'ARRIVED');assert.ok(outcome.lastResult.distance>9);}
      const saved=scene.save(),stored=JSON.parse(saved.raw),restored=saved.expectedRestored;
      assert.equal(stored.agents[0].interrupted===true,interrupt);
      assert.equal(restored.elapsed,scene.state.elapsed);
      assert.equal(restored.clocks.environmentElapsed,scene.state.environment.elapsed);
      assert.equal(restored.clocks.ecologyElapsed,scene.state.environment.ecology.elapsed);
      assert.equal(restored.clocks.ecologyPending,scene.state.environment.ecology.pending);
      assert.deepEqual(restored.agents[0].physiology,scene.actor.physiology);
      assert.deepEqual(restored.agents[0].position,scene.actor.position);
      assert.equal(restored.agents[0].active,null);
      const interruptions=restored.agents[0].memory.experience.filter(e=>e.type==='action'&&e.details.result?.code==='RESTART_INTERRUPTED');
      assert.equal(interruptions.length,interrupt?1:0);
      const rejected=await replay(base,saved.raw,admitted.request);
      assert.equal(rejected.proposed,null);assert.equal(rejected.admission.code,'UNOBSERVED_TARGET');
      assert.equal(rejected.physicalStatePreserved,true);
    }finally{scene.dispose();}
  }
});
