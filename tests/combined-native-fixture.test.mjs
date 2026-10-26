import test from 'node:test';
import assert from 'node:assert/strict';
import {createCombinedFoodScene,combinedFoodEvidence,probeCombinedFoodRestore} from '../scripts/combined-food-native-fixture.mjs';
const serialized=fn=>Function('return ('+fn.toString()+')')();
test('serialized combined native fixture has actual paid food, finite water, funding and reload evidence (Node preparation only)',{timeout:120000},async()=>{
  const scene=await serialized(createCombinedFoodScene)(new URL('../',import.meta.url),serialized(combinedFoodEvidence));
  const before=scene.project(),saved=scene.save(),raw=JSON.parse(saved.raw),summary=saved.summary;
  assert.deepEqual(scene.project(),before);
  assert.ok(Math.abs(summary.checkpointToSavedStateSeconds-.2)<1e-7);assert.equal(summary.pausedProjectionUnchanged,true);
  assert.deepEqual(saved.physicalBeforeSave.stocks,saved.expectedRestored.stocks);
  for(const prior of saved.physicalBeforeSave.agents){const next=saved.expectedRestored.agents.find(n=>n.id===prior.id);for(const key of ['physiology','inventory','flask'])assert.deepEqual(next[key],prior[key]);}
  assert.ok(Math.abs(summary.whole.ingestedKcal-95)<1e-8);assert.ok(Math.abs(summary.partial.ingestedKcal-95/6)<1e-8);
  assert.equal(summary.water.startingFlaskLitres,.5);assert.equal(summary.water.ingestedKcal,0);assert.equal(summary.water.satietyHours,0);
  assert.equal(summary.zero.paidSeconds,0);assert.ok(Math.abs(summary.partialWork.paidSeconds-.05)<1e-8);
  const prior=raw.agents.find(n=>n.id===summary.partialActorId),restored=saved.expectedRestored.agents.find(n=>n.id===prior.id);
  assert.equal(prior.interrupted,true);assert.equal(restored.active,null);assert.deepEqual(restored.physiology,prior.physiology);
  assert.deepEqual(restored.inventory,prior.inventory);assert.deepEqual(restored.memory.experience.slice(0,prior.memory.experience.length),prior.memory.experience);
  assert.equal(restored.memory.experience.at(-1).details.result.code,'RESTART_INTERRUPTED');
  assert.equal(restored.memory.experience.at(-1).details.result.ok,false);
  const probe=await serialized(probeCombinedFoodRestore)(new URL('../',import.meta.url),saved.raw,summary);
  assert.deepEqual(probe,{decodedByteProbe:true,noPaymentWitness:true,noCompletionWitness:true,noCopiedActionReplay:true});
});
