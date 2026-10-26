import { extractionOriginError } from '../src/food-source-caution.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createLearningCycleFixture} from './fixtures/learning-cycle-native.mjs';
import {createOzarkWorldGeometry} from '../src/ozark-world-geometry.js';
import {loadOzarkSave} from '../src/ozark-save.js';
import {observationalInquiries} from '../src/observational-learning.js';

// Execute precisely the serialized function used by the sandboxed renderer.
const fixture = Function('return ('+createLearningCycleFixture.toString()+')')();
for (const control of ['observed','no-observation','occluded','nonconsumption']) {
  test(`learning cycle ${control}: staged behavioral preparation, not native evidence`,{timeout:300000},async()=>{
    const result=await fixture(new URL('../',import.meta.url),{control});
    assert.equal(result.summary.passed,true);
    if(control!=='observed')return;
    const {summary,raw,saveKey}=result,stored=JSON.parse(raw);
    assert.equal(summary.choiceAblation.nextActionDiffers,true);
    assert.equal(summary.choiceAblation.choices[0].action.targetId,summary.materialId);
    assert.notDeepEqual(summary.choiceAblation.choices[0].action,summary.choiceAblation.choices[1].action);
    const loaded=loadOzarkSave({getItem:key=>key===saveKey?raw:null},createOzarkWorldGeometry());
    assert.equal(loaded.blocked,false,loaded.error);
    // Strict on-disk boundary must reject explicit malformed completion metadata,
    // not silently canonicalize it away on otherwise real paid sample receipts.
    for(const invalid of [false,null,0,'true']){
      const changed=structuredClone(stored),actor=changed.agents.find(a=>a.id===summary.receiverId);
      const sample=actor.discovery.experiments.find(e=>e.primitive==='sample'&&e.ok);
      assert.ok(sample);sample.finishedMaterial=invalid;
      actor.memory.experience.find(e=>e.id===sample.actionId).details.result.finishedMaterial=invalid;
      const bytes=JSON.stringify(changed),disk={getItem:key=>key===saveKey?bytes:null};
      assert.equal(loadOzarkSave(disk,createOzarkWorldGeometry()).blocked,true);
      assert.equal(disk.getItem(saveKey),bytes);
    }
    for(const orphan of [false,true]){
      const changed=structuredClone(stored),actor=changed.agents.find(a=>a.id===summary.senderId);
      const origin=actor.discovery.experiments.find(e=>e.primitive==='pull'&&e.ok);
      assert.ok(origin);assert.equal(extractionOriginError(actor),null);
      const duplicate=structuredClone(origin),receipt=structuredClone(actor.memory.experience.find(e=>e.id===origin.actionId));
      duplicate.id=actor.discovery.nextId++;duplicate.actionId=actor.memory.nextId++;duplicate.at=actor.elapsed;
      receipt.id=duplicate.actionId;receipt.at=actor.elapsed;
      if(!orphan)actor.discovery.experiments.push(duplicate);actor.memory.experience.push(receipt);
      assert.equal(extractionOriginError(actor),'ambiguous-extraction-origin');
      const bytes=JSON.stringify(changed),disk={getItem:key=>key===saveKey?bytes:null};
      assert.equal(loadOzarkSave(disk,createOzarkWorldGeometry()).blocked,true);
      assert.equal(disk.getItem(saveKey),bytes,'strict rejection must preserve original current-slot bytes');
    }
    const receiver=loaded.state.agents.find(a=>a.id===summary.receiverId);
    const before=stored.agents.find(a=>a.id===summary.receiverId);
    assert.equal(receiver.active,null);
    assert.deepEqual(receiver.inventory,before.inventory);
    assert.deepEqual(receiver.physiology,before.physiology);
    assert.deepEqual(receiver.discovery.effects,before.discovery.effects);
    assert.deepEqual(receiver.discovery.experiments,before.discovery.experiments);
    const completed=observationalInquiries(receiver).find(q=>q.sourceId===summary.materialId);
    assert.equal(completed.status,'supported');
    assert.ok(completed.ownEffects.every(e=>e.source==='experienced'));
    const pending=observationalInquiries(receiver).find(q=>q.sourceId===summary.interrupted.materialId);
    assert.equal(pending.status,'retired');
    assert.equal(receiver.discovery.experiments.length,summary.interrupted.experiments);
    assert.ok(receiver.inventory.items.includes(summary.interrupted.materialId));
    assert.deepEqual(loaded.state.environment.ecology,stored.environment.ecology);
    // The same paid attributed action/effect chain must survive old schema-12
    // appetite migration, including the pending physical portion on restart.
    const historical=structuredClone(stored);
    for(const actor of historical.agents)delete actor.physiology.satietyHours;
    const oldBytes=JSON.stringify(historical);
    const migrated=loadOzarkSave({getItem:key=>key===saveKey?oldBytes:null},createOzarkWorldGeometry());
    assert.equal(migrated.blocked,false,migrated.error);
    for(let i=0;i<stored.agents.length;i++){
      const prior=loaded.state.agents[i],current=migrated.state.agents[i];
      assert.deepEqual(current.discovery.effects,prior.discovery.effects);
      assert.deepEqual(current.discovery.experiments,prior.discovery.experiments);
      assert.deepEqual(current.memory.experience,prior.memory.experience);
      const {satietyHours,...physical}=current.physiology;
      const {satietyHours:priorSatiety,...priorPhysical}=prior.physiology;
      assert.deepEqual(physical,priorPhysical);
      assert.equal(satietyHours,Math.max(0,Math.min(6,6-historical.agents[i].physiology.hoursSinceMeal)));
    }

  });
}
