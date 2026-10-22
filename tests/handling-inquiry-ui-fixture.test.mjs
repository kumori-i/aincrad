import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHandlingInquiryUiFixture, continueHandlingInquiryUiFixture, verifyInterruptedHandlingUiFixture, presentHandlingInquiryUi } from '../scripts/handling-inquiry-ui-fixture.mjs';
import { loadOzarkSave, writeOzarkSave } from '../src/ozark-save.js';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { handlingInquiries } from '../src/handling-inquiry.js';

const serialized = fn => (0, eval)(`(${fn.toString()})`);
const base = new URL('../', import.meta.url).href;
function storageFor(fixture) {
  const rows = new Map([[fixture.saveKey, fixture.raw]]);
  return { getItem: key => rows.get(key) ?? null, setItem: (key, value) => rows.set(key, value) };
}

test('native handling fixture preserves paid personal failure, uncertain UI data and one selected pull without sampling', async () => {
  assert.equal(typeof serialized(presentHandlingInquiryUi), 'function');
  const pending = await serialized(createHandlingInquiryUiFixture)(base), summary = pending.summary;
  assert.equal(pending.saveKey, 'aincrad.world.v2');
  assert.notEqual(summary.sourceObjectId, summary.targetObjectId);
  assert.equal(summary.inquiry.status, 'uncertain');
  assert.equal(summary.inquiry.provenance, 'own handling outcomes');
  for (const outcome of [summary.priorPull, summary.failedGrasp]) {
    assert.ok(outcome.after.elapsed > outcome.before.elapsed);
    assert.ok(outcome.after.metabolizedKcal > outcome.before.metabolizedKcal);
    assert.equal(outcome.result.handling.source, 'experienced');
  }
  assert.equal(summary.failedGrasp.result.ok, false);
  assert.equal(summary.failedGrasp.after.targetQuantity, summary.failedGrasp.before.targetQuantity);
  const storage = storageFor(pending), geometry = createOzarkWorldGeometry();
  const before = loadOzarkSave(storage, geometry); assert.equal(before.blocked, false, before.error);
  assert.equal(handlingInquiries(before.state.agents[0])[0].status, 'uncertain');
  const completed = await serialized(continueHandlingInquiryUiFixture)(base, storage);
  assert.equal(completed.summary.inquiry.status, 'detached');
  assert.equal(completed.summary.decision.action.targetId, summary.targetObjectId);
  assert.equal(completed.summary.decision.action.type, 'pull');
  assert.ok(completed.summary.after.elapsed > completed.summary.before.elapsed);
  assert.ok(completed.summary.after.metabolizedKcal > completed.summary.before.metabolizedKcal);
  assert.equal(completed.summary.after.targetQuantity, completed.summary.before.targetQuantity - 1);
  assert.equal(completed.summary.after.held, completed.summary.before.held + 1);
  assert.equal(completed.summary.after.experimentCount, completed.summary.before.experimentCount + 1);
  const reopened = loadOzarkSave(storage, geometry); assert.equal(reopened.blocked, false, reopened.error);
  const actor = reopened.state.agents[0];
  assert.equal(actor.active, null);
  assert.equal(handlingInquiries(actor)[0].status, 'detached');
  assert.equal(actor.discovery.experiments.some(e => e.primitive === 'sample'), false);
  assert.deepEqual(actor.discovery.effects, []); assert.deepEqual(actor.discovery.techniques, []);
  assert.equal(reopened.state.elapsed, completed.summary.elapsed);
});

test('native handling interruption checkpoint cannot complete or replay after reopen and fresh sight', async () => {
  const pending = await serialized(createHandlingInquiryUiFixture)(base), storage = storageFor(pending);
  const interrupted = await serialized(continueHandlingInquiryUiFixture)(base, storage, 'interrupt'), summary = interrupted.summary;
  assert.equal(summary.inquiry.status, 'attempting');
  assert.equal(summary.interrupted, true);
  assert.equal(summary.after.elapsed, summary.before.elapsed + .5);
  assert.ok(summary.after.metabolizedKcal > summary.before.metabolizedKcal);
  assert.equal(summary.after.targetQuantity, summary.before.targetQuantity);
  assert.equal(summary.after.held, summary.before.held);
  assert.equal(summary.after.experimentCount, summary.before.experimentCount);
  const bytes = storage.getItem(pending.saveKey);
  const verified = await serialized(verifyInterruptedHandlingUiFixture)(base, storage);
  assert.equal(verified.noReplayAfterFreshObservation, true);
  assert.equal(verified.interruptedOnce, true);
  assert.equal(verified.inquiry.status, 'unavailable');
  assert.equal(verified.elapsed, summary.elapsed);
  assert.equal(verified.targetQuantity, summary.after.targetQuantity);
  assert.equal(verified.metabolizedKcal, summary.after.metabolizedKcal);
  assert.equal(storage.getItem(pending.saveKey), bytes, 'Verification must not rewrite current bytes');
  const geometry = createOzarkWorldGeometry(), loaded = loadOzarkSave(storage, geometry);
  assert.equal(loaded.blocked, false, loaded.error);
  assert.equal(writeOzarkSave(storage, loaded.state, geometry), true);
  const second = loadOzarkSave(storage, geometry); assert.equal(second.blocked, false, second.error);
  assert.equal(second.state.agents[0].memory.experience.filter(e => e.details?.result?.code === 'RESTART_INTERRUPTED').length, 1);
  assert.equal(handlingInquiries(second.state.agents[0])[0].status, 'unavailable');
});

test('handling native coverage extends the existing isolated sandboxed harness, not an application route', () => {
  const source = readFileSync(new URL('../scripts/verify-aquatic-desktop.mjs', import.meta.url), 'utf8');
  for (const phrase of ['createHandlingInquiryUiFixture', 'continueHandlingInquiryUiFixture', 'verifyInterruptedHandlingUiFixture',
    'presentHandlingInquiryUi', 'handling-write', 'handling-reopen', 'handling-completed-reopen', 'handling-interrupted-write', 'handling-interrupted-reopen',
    'handling-pending.png', 'handling-completed.png', 'handling-interrupted.png', 'handling-result.json',
    'method-tested-reopen', 'social-reopen', 'prefs.sandbox,true', 'installEmptyCurrentSlot']) assert.ok(source.includes(phrase), phrase);
});
