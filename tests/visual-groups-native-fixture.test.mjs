import test from 'node:test';
import assert from 'node:assert/strict';
import { createVisualGroupsScene, visualGroupsEvidence } from '../scripts/visual-groups-native-fixture.mjs';
const create=Function('return ('+createVisualGroupsScene.toString()+')')();
const project=Function('return ('+visualGroupsEvidence.toString()+')')();

test('serialized visual group fixture uses ordinary sensed samples and exact passive reload (Node preparation only)',{timeout:300000},async()=>{
  const scene=await create(new URL('../',import.meta.url),project),before=scene.project();
  const saved=scene.save(),raw=JSON.parse(saved.raw),actor=raw.agents.find(n=>n.id===saved.summary.actorId);
  const restored=saved.expectedRestored.agents.find(n=>n.id===actor.id);
  assert.deepEqual(restored.discovery.visualSamples,actor.discovery.visualSamples);
  assert.deepEqual(scene.project(),before,'Save/restore fixture cannot sense or advance original scene');
  assert.equal(saved.summary.objectIds.length,2);assert.equal(new Set(saved.summary.objectIds).size,2);
  for(const id of saved.summary.objectIds){
    const row=actor.discovery.visualSamples.records.find(r=>r.objectId===id);
    assert.equal(row.times.length,2);assert.ok(row.times[0]<row.times[1]);
  }
  assert.deepEqual(saved.expectedRestored.clocks,{environmentElapsed:raw.environment.elapsed,ecologyElapsed:raw.environment.ecology.elapsed,ecologyPending:raw.environment.ecology.pending});
  for(const n of saved.expectedRestored.agents){
    const original=raw.agents.find(a=>a.id===n.id);assert.deepEqual(n.physiology,original.physiology);assert.deepEqual(n.memory,original.memory);assert.equal(n.active,null);
  }
});
