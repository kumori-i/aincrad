import test from 'node:test';
import assert from 'node:assert/strict';
import { createPeerTeachingUiFixture, presentPeerTeachingUi } from '../scripts/peer-teaching-ui-fixture.mjs';
import { loadOzarkSave } from '../src/ozark-save.js';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';

test('native teaching UI fixture contains earned sender proof and reloadable naive recipient testimony', async () => {
  // A renderer receives these same self-contained functions via serialization.
  const create = (0, eval)(`(${createPeerTeachingUiFixture.toString()})`);
  assert.equal(typeof (0, eval)(`(${presentPeerTeachingUi.toString()})`), 'function');
  const fixture = await create(new URL('../', import.meta.url).href);
  assert.equal(fixture.saveKey, 'aincrad.world.v2');
  assert.equal(fixture.summary.version, 12);
  assert.deepEqual(fixture.summary.features, { plantLifecycle: 1, finiteAquatic: 2, worldStructures: 1, characterMessages: 2 });
  assert.ok(fixture.summary.after.at > fixture.summary.before.at);
  assert.ok(fixture.summary.after.metabolizedKcal > fixture.summary.before.metabolizedKcal);
  assert.equal(fixture.summary.after.sourceQuantity, fixture.summary.before.sourceQuantity - 1);
  const loaded = loadOzarkSave({ getItem: key => key === fixture.saveKey ? fixture.raw : null }, createOzarkWorldGeometry());
  assert.equal(loaded.blocked, false, loaded.error);
  assert.equal(loaded.state.selectedAgentId, 'mira');
  assert.equal(loaded.state.elapsed, fixture.summary.elapsed);
  const [sender, receiver] = loaded.state.agents;
  assert.equal(sender.discovery.techniques.length, 1);
  assert.equal(receiver.discovery.experiments.length, 0);
  assert.equal(receiver.discovery.effects.length, 0);
  assert.equal(receiver.discovery.techniques.length, 0);
  assert.deepEqual(receiver.discovery.reports.find(row => row.teaching), fixture.summary.report);
  assert.deepEqual(loaded.state.community.messages.find(row=>row.id===fixture.summary.message.id), fixture.summary.message);
  assert.deepEqual(receiver.discovery.reports.find(row=>row.id===fixture.summary.humanReport.id).proposed,[]);
  assert.equal(fixture.summary.humanReport.hint.code,'unsupported');
  assert.match(fixture.summary.humanReply,/No physical steps proposed/);
  assert.ok(loaded.state.community.messages.some(row=>row.text===fixture.summary.humanReply));
  assert.equal(fixture.summary.report.status, 'unverified');
  assert.equal(fixture.summary.report.cursor, 0);
  assert.deepEqual(fixture.summary.report.evidence, []);
  assert.deepEqual(fixture.summary.report.proposed.map(step => step.type), ['pull', 'sample']);
});


test('native main acceptance inspects learned stream and archival provenance, never reenables English', () => {
  const source=presentPeerTeachingUi.toString();
  assert.match(source,/stage === 'learning'/);
  assert.match(source,/Observer annotations, not agent speech/);
  assert.match(source,/Archived teaching leaked into live learned communication/);
  assert.match(source,/English communication disabled/);
  assert.match(source,/archival and inert/);
  assert.doesNotMatch(source,/Missing actual sender message/);
});
