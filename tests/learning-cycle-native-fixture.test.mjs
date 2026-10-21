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
  });
}
