import test from 'node:test';
import assert from 'node:assert/strict';
import { createMethodTransferUiFixture, completeMethodTransferUiFixture, presentMethodTransferUi } from '../scripts/method-transfer-ui-fixture.mjs';
import { loadOzarkSave } from '../src/ozark-save.js';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';

test('native method fixture serializes, hears cross-source report, reopens, then pays for own personal proof',async()=>{
  const base=new URL('../',import.meta.url).href;
  const create=(0,eval)(`(${createMethodTransferUiFixture.toString()})`),complete=(0,eval)(`(${completeMethodTransferUiFixture.toString()})`);
  assert.equal(typeof (0,eval)(`(${presentMethodTransferUi.toString()})`),'function');
  const heard=await create(base),rows=new Map([[heard.saveKey,heard.raw]]),storage={getItem:k=>rows.get(k)??null,setItem:(k,v)=>rows.set(k,v)};
  assert.notEqual(heard.summary.sourceObjectId,heard.summary.targetObjectId);
  assert.equal(heard.summary.report.status,'unverified');
  const tested=await complete(base,storage);
  assert.equal(tested.summary.report.status,'supported');
  assert.equal(tested.summary.report.evidence.length,2);
  assert.ok(tested.summary.after.elapsed>tested.summary.before.elapsed);
  assert.ok(tested.summary.after.metabolizedKcal>tested.summary.before.metabolizedKcal);
  assert.equal(tested.summary.after.sourceQuantity,tested.summary.before.sourceQuantity-1);
  const reopened=loadOzarkSave(storage,createOzarkWorldGeometry());assert.equal(reopened.blocked,false,reopened.error);
  assert.deepEqual(reopened.state.agents[1].discovery.reports.find(r=>r.id===tested.summary.report.id),tested.summary.report);
});
