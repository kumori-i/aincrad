import test from 'node:test';
import assert from 'node:assert/strict';
import { createStructuralMovementFixture, structuralMovementEvidence } from
  '../scripts/structural-movement-native-fixture.mjs';
import { CONFIG } from '../src/config.js';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { loadOzarkSave, writeOzarkSave, OZARK_SAVE_KEY } from '../src/ozark-save.js';

// Preparation is shared, but every load uses an independent in-memory slot.
// Reconstruct both exports exactly as the Electron harness embeds them: any
// accidental module-scope dependency must fail here rather than in a renderer.
const createSerialized = Function('return (' + createStructuralMovementFixture.toString() + ')')();
const projectSerialized = Function('return (' + structuralMovementEvidence.toString() + ')')();
let fixturePromise;
const fixture = () => fixturePromise ??= createSerialized(new URL('../', import.meta.url));
const geometry = createOzarkWorldGeometry();
const oldCoordinate = { x: 527.9482587463335, y: 3120.0000031694867 };
const actions = actor => actor.memory.experience.filter(event => event.type === 'action');
const interruptions = actor => actions(actor).filter(event =>
  event.details.result.code === 'RESTART_INTERRUPTED');
const near = (actual, expected, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
function disk(raw) {
  const values = new Map([[OZARK_SAVE_KEY, raw]]);
  return { getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value) };
}

test('serialized native fixture contains a genuine paid failure and unfinished move, not learned recovery (Node preparation only)', { timeout: 300000 }, async () => {
  const prepared = await fixture(), { summary } = prepared;
  const stored = JSON.parse(prepared.raw), actor = stored.agents.find(row => row.id === 'aster');
  assert.equal(prepared.saveKey, OZARK_SAVE_KEY);
  assert.equal(stored.version, 12);
  assert.equal(stored.features.finiteAquatic, 2);
  assert.ok(stored.environment.ecology.aquatic.fish.length > 0);
  assert.match(summary.fixtureDisclosure, /Synthetic initial placement/);
  assert.match(summary.fixtureDisclosure, /No clock or physiology injection/);
  assert.match(summary.fixtureDisclosure, /No .*learned recovery/);
  assert.deepEqual(summary.oldCoordinate, oldCoordinate);
  assert.deepEqual(stored.player, oldCoordinate);
  assert.equal(geometry.canOccupy(stored.player.x, stored.player.y, CONFIG.playerRadius), true);
  assert.deepEqual(stored.playerBody, { wetness: 0, effort: 0, stamina: 100, health: 100 });
  assert.equal(stored.distance, 0, 'synthetic placement is not counted as travelled distance');
  assert.equal(summary.failedAdmission.code, 'STARTED');
  assert.deepEqual(summary.failedRequest, { type: 'move', target: { x: 560, y: 3120 } });
  assert.equal(actions(actor).length, 1);
  assert.deepEqual(actions(actor)[0], summary.failedReceipt);
  const { result, startPosition, position, action } = summary.failedReceipt.details;
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ROUTE_BLOCKED');
  assert.equal(result.movement.progress, 'negligible');
  assert.equal(result.movement.effort, 'rising');
  assert.deepEqual(startPosition, oldCoordinate);
  assert.deepEqual(action, summary.failedRequest);
  assert.deepEqual(position, summary.failureAfter.position);
  assert.equal(position.x, oldCoordinate.x);
  assert.ok(position.y < oldCoordinate.y, 'preserve actual nonzero microunit movement');
  near(position.y, oldCoordinate.y, 1e-5);
  assert.ok(result.distance > 0 && result.distance < 1e-5);
  near(result.durationSeconds, summary.failedSteps * CONFIG.fixedStep);
  near(summary.failureAfter.at - summary.failureBefore.at, result.durationSeconds);
  assert.ok(summary.failureAfter.physiology.totals.metabolizedKcal >
    summary.failureBefore.physiology.totals.metabolizedKcal);
  assert.ok(Object.keys(actor.memory.blockedEdges).length > 0);
  assert.equal(summary.pendingActorId, 'aster');
  assert.equal(summary.pendingAdmission.code, 'STARTED');
  assert.deepEqual(summary.pendingRequest, { type: 'move', target: { x: 480, y: 3120 } });
  assert.deepEqual(summary.pendingActive.request, summary.pendingRequest);
  assert.deepEqual(summary.pendingBefore.position, summary.failureAfter.position);
  assert.deepEqual(summary.pendingActive.startPosition, summary.failureAfter.position);
  near(summary.partialPaidSeconds, CONFIG.fixedStep);
  assert.ok(summary.pendingActive.attemptedDistance > 0);
  assert.ok(summary.pendingActive.travelled > 0);
  assert.ok(actor.position.x < summary.failureAfter.position.x);
  assert.deepEqual(actor.position, summary.sourcePosition);
  assert.equal(actor.interrupted, true);
  assert.equal(actor.active, null, 'disk stores interruption, not a resumable action');
  assert.ok(actor.physiology.totals.metabolizedKcal >
    summary.pendingBefore.physiology.totals.metabolizedKcal);
  for (const npc of stored.agents) {
    assert.deepEqual(npc.memory.skills, []);
    assert.deepEqual(npc.discovery.techniques, []);
    assert.deepEqual(npc.discovery.experiments, []);
    assert.deepEqual(npc.discovery.effects, []);
    assert.equal(npc.stats.independentMeals, 0);
    assert.ok(actions(npc).every(event => event.details.result.ok === false));
  }
});

test('all preparation clocks and bodies advance together without stale finite ecology', { timeout: 300000 }, async () => {
  const { raw, summary } = await fixture(), stored = JSON.parse(raw);
  assert.equal(summary.preparationSeconds, 16);
  near(stored.elapsed, summary.preparationSeconds +
    summary.failedSteps * CONFIG.fixedStep + summary.partialPaidSeconds);
  assert.equal(stored.elapsed, stored.environment.elapsed);
  assert.equal(summary.clock.elapsed, stored.elapsed);
  assert.equal(summary.clock.environmentElapsed, stored.environment.elapsed);
  assert.equal(summary.clock.ecologyElapsed, stored.environment.ecology.elapsed);
  assert.equal(summary.clock.ecologyPending, stored.environment.ecology.pending);
  near(stored.environment.ecology.elapsed + stored.environment.ecology.pending, stored.elapsed);
  assert.ok(stored.environment.ecology.elapsed > 0);
  for (const npc of stored.agents) {
    assert.equal(npc.elapsed, stored.elapsed);
    const before = summary.initialPhysiology.find(row => row.id === npc.id).physiology;
    assert.ok(npc.physiology.totals.metabolizedKcal > before.totals.metabolizedKcal);
    assert.ok(npc.physiology.totals.waterLostMl > before.totals.waterLostMl);
    assert.deepEqual(summary.clock.agents.find(row => row.id === npc.id),
      { id: npc.id, elapsed: npc.elapsed });
  }
});

test('real restore cancels exactly once while preserving failed history, physical position and all paid body changes', { timeout: 300000 }, async () => {
  const prepared = await fixture(), storage = disk(prepared.raw);
  const stored = JSON.parse(prepared.raw), loaded = loadOzarkSave(storage, geometry);
  assert.equal(loaded.blocked, false, loaded.error);
  assert.equal(loaded.exists, true);
  assert.deepEqual(projectSerialized(loaded.state), prepared.expectedRestored);
  assert.deepEqual(structuralMovementEvidence(loaded.state), prepared.expectedRestored);
  assert.deepEqual(JSON.parse(JSON.stringify(prepared.expectedRestored)), prepared.expectedRestored,
    'native checkpoints must preserve the evidence projection exactly through JSON');
  const detached = projectSerialized(loaded.state);
  assert.deepEqual(detached.clocks, { environmentElapsed: stored.environment.elapsed,
    ecologyElapsed: stored.environment.ecology.elapsed,
    ecologyPending: stored.environment.ecology.pending });
  for (const field of ['environmentElapsed', 'ecologyElapsed', 'ecologyPending']) {
    const changed = structuredClone(loaded.state);
    if (field === 'environmentElapsed') changed.environment.elapsed++;
    else changed.environment.ecology[field === 'ecologyElapsed' ? 'elapsed' : 'pending']++;
    assert.notDeepEqual(projectSerialized(changed), prepared.expectedRestored,
      `Paused rendering clock assertions must detect ${field} changes`);
  }
  detached.clocks.ecologyPending++;
  detached.player.x++;
  detached.agents[0].memory.experience.length = 0;
  assert.deepEqual(projectSerialized(loaded.state), prepared.expectedRestored,
    'read-only evidence projections cannot alias or mutate live state');
  assert.equal(storage.getItem(OZARK_SAVE_KEY), prepared.raw, 'reading must not rewrite source bytes');
  assert.deepEqual(loaded.state.player, oldCoordinate);
  assert.deepEqual(loaded.state.playerBody, stored.playerBody);
  assert.equal(loaded.state.elapsed, stored.elapsed);
  assert.equal(loaded.state.distance, stored.distance);
  assert.deepEqual(loaded.state.environment, stored.environment);
  for (const npc of loaded.state.agents) {
    const before = stored.agents.find(row => row.id === npc.id);
    assert.equal(npc.active, null);
    for (const field of ['position', 'elapsed', 'physiology', 'discovery'])
      assert.deepEqual(npc[field], before[field], `${npc.id}: ${field}`);
    for (const field of ['blockedEdges', 'skills', 'values', 'features', 'effects', 'lessons'])
      assert.deepEqual(npc.memory[field], before.memory[field], `${npc.id}: memory.${field}`);
    if (npc.id === prepared.summary.pendingActorId) {
      assert.deepEqual(npc.memory.experience.slice(0, -1), before.memory.experience);
      assert.equal(interruptions(npc).length, 1);
      const cancellation = interruptions(npc)[0];
      assert.equal(cancellation.at, stored.elapsed);
      assert.deepEqual(cancellation.details.action, { type: 'wait' },
        'coarse interruption marker must not fabricate a completed move identity');
      assert.deepEqual(cancellation.details.result, { ok: false, code: 'RESTART_INTERRUPTED' });
      assert.deepEqual(cancellation.details.startPosition, before.position);
      assert.equal(actions(npc).length, actions(before).length + 1);
      assert.deepEqual(actions(npc)[0], prepared.summary.failedReceipt);
    } else assert.deepEqual(npc.memory, before.memory);
    assert.ok(actions(npc).every(event => event.details.result.ok === false));
  }
  assert.equal(writeOzarkSave(storage, loaded.state, geometry), true);
  const reopened = loadOzarkSave(storage, geometry);
  assert.equal(reopened.blocked, false, reopened.error);
  assert.deepEqual(projectSerialized(reopened.state), prepared.expectedRestored);
  assert.equal(interruptions(reopened.state.agents.find(row => row.id === 'aster')).length, 1);
});
