import test from 'node:test';
import assert from 'node:assert/strict';
import { createCategoryNamesScene, categoryNamesEvidence } from '../scripts/category-names-native-fixture.mjs';
const create=Function('return ('+createCategoryNamesScene.toString()+')')();
const project=Function('return ('+categoryNamesEvidence.toString()+')')();

test('serialized category fixture uses real three-tuft perception and mocked naming with exact save/reload (Node only)',{timeout:300000},async()=>{
  const scene=await create(new URL('../',import.meta.url),project),before=scene.project();
  const saved=scene.save(),raw=JSON.parse(saved.raw),actor=raw.agents.find(n=>n.id===saved.summary.actorId);
  const restored=saved.expectedRestored.agents.find(n=>n.id===actor.id);
  assert.deepEqual(saved.summary.objectIds,['object:675','object:669','object:672']);
  assert.deepEqual(restored.categoryNames,actor.categoryNames);assert.deepEqual(restored.discovery,actor.discovery);
  assert.deepEqual(scene.project(),before,'Saving/restoring must not advance the original scene');
  assert.equal(saved.summary.modelInference,'mocked; real local model never called');
  assert.equal(actor.categoryNames.own.filter(row=>row.token==='velora').length,1);
  assert.equal(saved.summary.unchangedPhysicalEvidence,true);assert.ok(saved.summary.currentSamplesBeforeSave.every(row=>row.current));
  assert.ok(saved.summary.attempts.length<=64);assert.ok(saved.summary.attempts.at(-1).accepted);
  for(const attempt of saved.summary.attempts.slice(0,-1)){assert.equal(attempt.response.token,null);assert.equal(attempt.accepted,false);}
  for(const id of saved.summary.objectIds){const row=actor.discovery.visualSamples.records.find(r=>r.objectId===id);assert.equal(row.times.length,2);assert.ok(row.times[0]<row.times[1]);assert.deepEqual(row.cues,saved.summary.cues);}
  for(const n of saved.expectedRestored.agents){const original=raw.agents.find(a=>a.id===n.id);assert.deepEqual(n.physiology,original.physiology);assert.deepEqual(n.memory,original.memory);assert.equal(n.active,null);}
  assert.equal(saved.expectedRestored.agents.find(n=>n.id===saved.summary.otherActorId).categoryNames,null);
});
