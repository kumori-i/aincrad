import test from 'node:test';
import assert from 'node:assert/strict';
import { createRenewableSharingFixture } from '../scripts/renewable-sharing-native-fixture.mjs';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { loadOzarkSave, OZARK_SAVE_KEY } from '../src/ozark-save.js';
import { SocialCoordinator } from '../src/social.js';

test('native fixture exercises real renewal and paid transfer, roundtrips their state, and drops pending consent (Node preparation, not native evidence)', {timeout:300000}, async () => {
  // The native runner serializes this exact function into its isolated renderer.
  // Reconstruct it here as well so accidental module-scope dependencies fail.
  const serialized = Function('return (' + createRenewableSharingFixture.toString() + ')')();
  const fixture = await serialized(new URL('../', import.meta.url));
  const { summary } = fixture, stored = JSON.parse(fixture.raw);
  assert.equal(fixture.saveKey, OZARK_SAVE_KEY);
  assert.equal(fixture.saveKey, 'aincrad.world.v2');
  assert.equal(stored.version, 12);
  assert.equal(stored.features.finiteAquatic, 2);
  assert.equal(summary.renewalVerified, true);
  assert.equal(summary.timedHandoffVerified, true);
  assert.equal(summary.groundedGesturesVerified, true);
  assert.deepEqual(summary.gestures.map(row=>row.gesture),['offer','accept','offer']);
  assert.equal(summary.transfer.offer.message, undefined);
  assert.equal(stored.community.messages.length,0);
  assert.equal(summary.reproductionExercised, false);
  assert.equal(summary.growthExercised, false);
  assert.ok(summary.aquatic.final.primaryProducedKcal > summary.aquatic.initial.primaryProducedKcal);
  assert.ok(summary.aquatic.final.fedKcal > summary.aquatic.initial.fedKcal);
  for (const error of Object.values(summary.aquatic.audit)) assert.ok(Math.abs(error) < 1e-5);
  assert.ok(summary.transfer.after.at - summary.transfer.before.at >= 2.49);
  assert.ok(summary.transfer.after.metabolizedKcal > summary.transfer.before.metabolizedKcal);
  const storage = { getItem: key => key === fixture.saveKey ? fixture.raw : null };
  const loaded = loadOzarkSave(storage, createOzarkWorldGeometry());
  assert.equal(loaded.blocked, false);
  assert.equal(loaded.state.elapsed, stored.elapsed);
  assert.deepEqual(loaded.state.environment.ecology, stored.environment.ecology);
  for (const actor of stored.agents) {
    const actual = loaded.state.agents.find(row => row.id === actor.id);
    for (const field of ['inventory', 'physiology', 'discovery'])
      assert.deepEqual(actual[field], actor[field], actor.id + ' ' + field);
  }
  const { materialId, senderId, receiverId } = summary.transfer;
  const sender = loaded.state.agents.find(row => row.id === senderId);
  const receiver = loaded.state.agents.find(row => row.id === receiverId);
  const feedback = summary.transfer.foodFeedback;
  assert.equal(feedback.ingestionId, summary.transfer.sampled.ingestionId);
  assert.equal(feedback.independentMeals, 1);
  assert.equal(feedback.pendingCleared, true);
  assert.equal(sender.discovery.samplesPending[materialId], undefined);
  assert.ok(sender.discovery.experiments.some(row => row.id === feedback.pullExperimentId &&
    row.actionId === summary.transfer.acquired.eventId && row.materialId === materialId));
  assert.ok(sender.discovery.experiments.some(row => row.id === feedback.sampleExperimentId &&
    row.actionId === summary.transfer.sampled.eventId && row.ingestionId === feedback.ingestionId));
  assert.ok(sender.discovery.effects.some(row => row.id === feedback.effectId && row.effect === 'sustained' &&
    row.actionId === summary.transfer.sampled.eventId && row.ingestionId === feedback.ingestionId));
  assert.ok(sender.discovery.techniques.some(row => row.id === feedback.techniqueId &&
    row.confidence === feedback.confidence && row.successes === feedback.successes &&
    row.evidence.includes(feedback.pullExperimentId) && row.evidence.includes(feedback.sampleExperimentId)));
  assert.equal(loaded.state.environment.ecology.materials.find(row => row.id === materialId).heldBy, receiverId);
  assert.equal(sender.inventory.items.includes(materialId), false);
  assert.equal(receiver.inventory.items.includes(materialId), true);
  assert.equal(receiver.discovery.effects.length, 0);
  assert.equal(receiver.discovery.techniques.length, 0);
  assert.equal(receiver.stats.independentMeals, 0);
  const pending = summary.pendingConsent;
  assert.equal(loaded.state.environment.ecology.materials.find(row => row.id === pending.materialId).heldBy, pending.senderId);
  const social = new SocialCoordinator({getAgents:()=>loaded.state.agents,getCommunity:()=>loaded.state.community,
    getEnvironment:()=>loaded.state.environment});
  const pendingReceiver = loaded.state.agents.find(row => row.id === pending.receiverId);
  assert.deepEqual(social.foodSharing.gestures(),[],'Observer history does not persist or recreate consent');
  assert.deepEqual(social.observe(pendingReceiver).foodSharing, {requests:[],offers:[]});
  assert.equal(social.action(pendingReceiver, {type:'accept_food',offerId:pending.offerId}).ok, false);
});
