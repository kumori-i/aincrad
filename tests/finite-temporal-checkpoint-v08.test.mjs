import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpc } from '../src/npc-state.js';
import { validateNpc } from '../src/npc-memory.js';
import { createEnvironment } from '../src/environment.js';
import { createCommunity } from '../src/social.js';
import { requestNpcAction, observeNpc } from '../src/npc.js';
import { CAVES, CAVE_EXIT } from '../src/config.js';
import { canStand } from '../src/world.js';
import { ingestMaterial, tickPhysiology, projectPhysiology } from '../src/biology.js';
import { createTemporalLedger, beginTemporalDecision, completeTemporalDecision, advanceTemporalClock, recordTemporalFeedback } from '../src/temporal-ledger.js';
import { temporalKey, trainTemporalReturns } from '../src/temporal-returns.js';
import { temporalUtf8Bytes, TEMPORAL_STORAGE } from '../src/temporal-storage.js';
import { FINITE_TEMPORAL_PROFILE, temporalCapacityFor } from '../src/temporal-capacity.js';
import { createFiniteSelector, proposeFiniteChoice } from '../scripts/lib/finite-temporal-policy.mjs';
import { FINITE_CHECKPOINT, serializeFiniteCheckpoint, restoreFiniteCheckpoint } from '../scripts/lib/finite-temporal-checkpoint.mjs';
import { FiniteTemporalDriver } from '../scripts/lib/finite-temporal-driver.mjs';

const SOURCE = 'a'.repeat(64), options = { expectedArm: 'online', expectedSourceFingerprint: SOURCE };
const copy = value => structuredClone(value);
// Reusing the immutable initial environment keeps these checkpoint probes small.
const initialEnvironment = createEnvironment(74193, { mode: 'discovery' });
const tree = initialEnvironment.ecology.plants.find(plant => plant.kind === 'apple_tree');
function fixture() {
  const n = createNpc({ mode: 'discovery' });
  n.rng = 0;
  n.discovery.temporal = createTemporalLedger({ capacityProfile: FINITE_TEMPORAL_PROFILE.name });
  return {
    state: { elapsed: 0, simulationMode: 'discovery', environment: copy(initialEnvironment), agents: [n], npc: n, community: createCommunity(), cardinal: null },
    selector: createFiniteSelector(0), driver: { senseAt: -1, epoch: 0, pending: null }, arm: 'online', sourceFingerprint: SOURCE,
  };
}
function setTime(f, at) {
  f.state.elapsed = f.state.npc.elapsed = f.state.environment.elapsed = at;
  f.state.environment.ecology.elapsed = Math.floor(at * 2) / 2;
  f.state.environment.ecology.pending = at - f.state.environment.ecology.elapsed;
  advanceTemporalClock(f.state.npc.discovery.temporal, at);
}
function withLearning() {
  const f = fixture(), m = f.state.npc.discovery.temporal;
  const seq = beginTemporalDecision(m, { at: 0, context: {}, action: { type: 'wait', seconds: 5 } });
  setTime(f, 5);
  completeTemporalDecision(m, { seq, at: 5, actionId: 1, result: { ok: true, code: 'WAITED', durationSeconds: 5 } });
  beginTemporalDecision(m, { at: 5, context: { focus: true }, action: { type: 'wait', seconds: 5 } });
  trainTemporalReturns(m.model);
  return f;
}
function raw(f = fixture()) { return JSON.parse(serializeFiniteCheckpoint(f)); }
function realDriver({ shelter = false } = {}) {
  const f = fixture(), n = f.state.npc, cave = CAVES.find(c => c.id === 'refuge');
  n.position = shelter ? { x: cave.x, y: cave.y + 55 } : [45, -45].map(dx => ({ x: tree.position.x + dx, y: tree.position.y })).find(p => canStand(p.x, p.y, 'valley'));
  return new FiniteTemporalDriver(f.state, { automatic: false });
}
function driverText(d) { return serializeFiniteCheckpoint({ state: d.state, selector: d.selector, driver: d.checkpointDriver(), arm: 'online', sourceFingerprint: SOURCE }); }
function rejectMutation(base, mutate, code) {
  const value = copy(base); mutate(value);
  const text = JSON.stringify(value), before = text;
  assert.throws(() => restoreFiniteCheckpoint(text, options), code ? error => error.code === code : undefined);
  assert.equal(text, before, 'failure retains the supplied checkpoint bytes');
}

test('finite checkpoint retains one actor, zero RNG/cursors, canonical values and the runtime capacity', () => {
  for (const f of [fixture(), withLearning()]) {
    const before = copy(f), text = serializeFiniteCheckpoint(f), wire = JSON.parse(text);
    assert.deepEqual(f, before, 'serialization never mutates live inputs');
    const restored = restoreFiniteCheckpoint(text, options), n = restored.state.npc;
    assert.equal(restored.state.agents.length, 1);
    assert.strictEqual(n, restored.state.agents[0]);
    assert.equal(n.id, 'aster');
    assert.equal(n.rng, 0);
    assert.equal(restored.selector.rng, 0);
    assert.equal(restored.selector.choices, 0);
    assert.equal(restored.driver.senseAt, -1);
    assert.deepEqual(n.discovery.temporal, f.state.npc.discovery.temporal);
    assert.equal(n.discovery.temporal.feedbackCursor, 0);
    assert.equal(n.discovery.temporal.model.updateCount, f.state.npc.discovery.temporal.model.updateCount, 'restore never trains');
    assert.strictEqual(temporalCapacityFor(n.discovery.temporal), FINITE_TEMPORAL_PROFILE);
    assert.strictEqual(temporalCapacityFor(n.discovery.temporal.model), FINITE_TEMPORAL_PROFILE);
    assert.equal(restored.pendingDisposition, null);
    if (wire.state.agents[0].discovery.temporal.data.model.rows.length) assert.equal(wire.state.agents[0].discovery.temporal.data.model.rows[0].key, 0, 'wire index zero survives');
  }
  assert.equal(TEMPORAL_STORAGE.bytes, 8 * 1024 * 1024, 'core production memory budget is unchanged');
});

test('exact idle pre-feedback continuation preserves biological ownership, learned values and next selector draws', () => {
  const f = fixture(), n = f.state.npc, m = n.discovery.temporal;
  // A focused sensor fixture, not an autonomous acquisition trial: feed a real
  // digestive input with a canonical completed personal swallow receipt.
  n.physiology.hoursSinceMeal = 12; projectPhysiology(n);
  const seq = beginTemporalDecision(m, { at: 0, context: {}, action: { type: 'sample', targetId: 'object:1' } });
  const swallowed = ingestMaterial(n, { massGrams: 30, energyKcal: 18, waterMl: 25, digestHours: 2 }, { objectId: 'object:1', actionId: 1, at: 0, source: 'sampled' });
  assert.equal(swallowed.ok, true);
  completeTemporalDecision(m, { seq, at: 0, actionId: 1, result: { ...swallowed, durationSeconds: 0 } });
  const reopened = restoreFiniteCheckpoint(serializeFiniteCheckpoint(f), options);
  assert.deepEqual(reopened.state.npc.physiology, n.physiology);
  assert.deepEqual(reopened.state.npc.discovery.temporal, m);
  for (const actor of [n, reopened.state.npc]) {
    const ledger = actor.discovery.temporal;
    for (let frame = 0; frame < 3600; frame++) {
      actor.elapsed += 1 / 60;
      const ids = new Set(actor.physiology.feedback.map(event => event.id));
      tickPhysiology(actor, 1 / 60, { hour: 8, feltTemperature: 18 });
      advanceTemporalClock(ledger, actor.elapsed);
      for (const event of actor.physiology.feedback) if (!ids.has(event.id)) recordTemporalFeedback(ledger, event, { now: actor.elapsed });
    }
    beginTemporalDecision(ledger, { at: actor.elapsed, context: {}, action: { type: 'wait', seconds: 5 } });
    trainTemporalReturns(ledger.model);
  }
  assert.ok(m.totals[0] > 0, 'real delayed sustained feedback was emitted');
  assert.deepEqual(reopened.state.npc.physiology, n.physiology);
  assert.deepEqual(reopened.state.npc.discovery.temporal, m);
  const view = { at: n.elapsed, objects: [], held: [], position: n.position, scene: n.scene, reach: 80, body: {}, senses: {} };
  const opportunity = { at: n.elapsed, choices: [{ action: { type: 'wait', seconds: 5 } }] };
  assert.deepEqual(proposeFiniteChoice(view, m, f.selector, opportunity), proposeFiniteChoice(view, reopened.state.npc.discovery.temporal, reopened.selector, opportunity));
});

test('active wait and rest checkpoints use interruption, with no invented completion or work credit', () => {
  for (const type of ['wait', 'rest', 'sleep']) {
    const f = fixture(), n = f.state.npc, request = { type, seconds: 5 };
    assert.equal(requestNpcAction(n, request, f.state.environment).ok, true);
    const seq = beginTemporalDecision(n.discovery.temporal, { at: 0, context: {}, action: request });
    f.driver.pending = { seq, action: request, previousEventId: 0 };
    const text = serializeFiniteCheckpoint(f), restored = restoreFiniteCheckpoint(text, options);
    assert.equal(n.active.request.type, type, 'serialization does not cancel the live actor');
    assert.equal(restored.state.npc.active, null);
    assert.equal(restored.driver.pending, null);
    assert.deepEqual(restored.pendingDisposition, { status: 'interrupted', interrupted: true, reason: 'RESTART_INTERRUPTED', ...f.driver.pending });
    assert.equal(restored.state.npc.discovery.temporal.receipts[0].outcome, undefined);
    assert.equal(restored.state.npc.discovery.temporal.open.reward[4], 0);
    assert.equal(restored.state.npc.memory.experience.at(-1).details.result.code, 'RESTART_INTERRUPTED');
    if (type === 'sleep') assert.equal(restored.state.npc.physiology.sleep.state, n.physiology.sleep.state, 'physical sleeping state follows the existing game contract');
    rejectMutation(JSON.parse(text), value => { value.driver.pending = null; });
    rejectMutation(JSON.parse(text), value => { delete value.state.agents[0].interrupted; });
  }
});

test('idle pending is retained only when it binds an existing authoritative outcome', () => {
  const f = fixture(), n = f.state.npc, action = { type: 'drink' };
  const result = requestNpcAction(n, action, f.state.environment);
  assert.equal(result.code, 'EMPTY_FLASK');
  const seq = beginTemporalDecision(n.discovery.temporal, { at: n.elapsed, context: {}, action });
  f.driver.pending = { seq, action, previousEventId: 0 };
  const text = serializeFiniteCheckpoint(f), restored = restoreFiniteCheckpoint(text, options);
  assert.deepEqual(restored.driver.pending, f.driver.pending);
  assert.deepEqual(restored.pendingDisposition, { status: 'pending', interrupted: false, ...f.driver.pending });
  assert.equal(restored.state.npc.discovery.temporal.receipts[0].outcome, undefined, 'the checkpoint layer does not perform completion capture');
  rejectMutation(JSON.parse(text), value => { value.state.agents[0].lastResult = null; });
});

test('raw finite caps reject histories that the permissive default validator would shrink', () => {
  const base = raw(withLearning());
  const row = base.state.agents[0].discovery.temporal.data.model.rows[0];
  const oversized = copy(base);
  oversized.state.agents[0].discovery.temporal.data.model.rows = Array.from({ length: 257 }, () => copy(row));
  assert.equal(validateNpc(oversized.state.agents[0]).discovery.temporal.model.rows.length, 1, 'default validation would discard duplicate rows');
  assert.throws(() => restoreFiniteCheckpoint(JSON.stringify(oversized), options), error => error.code === 'TEMPORAL_CAPACITY');
  const cases = [
    d => { d.model.transitions = Array.from({ length: 129 }, () => copy(d.model.transitions[0])); },
    d => { d.receipts = Array.from({ length: 385 }, () => copy(d.receipts[0])); },
    d => { d.ingestions = Array.from({ length: 65 }, () => ({})); },
    d => { d.events = Array.from({ length: 129 }, () => ({})); },
  ];
  for (const mutate of cases) rejectMutation(base, value => mutate(value.state.agents[0].discovery.temporal.data), 'TEMPORAL_CAPACITY');
  rejectMutation(base, value => { value.state.agents[0].discovery.temporal.keys = Array.from({ length: 513 }, (_, i) => temporalKey({ appearance: { shape: String(i) } }, 'wait')); }, 'TEMPORAL_CAPACITY');
  rejectMutation(base, value => {
    value.state.agents[0].discovery.temporal.keys = Array.from({ length: 200 }, (_, i) => temporalKey({ appearance: Object.fromEntries(['shape', 'color', 'texture', 'motion', 'size', 'smell'].map(key => [key, `${i}界`.padEnd(100, '界')])) }, 'wait'));
    assert.ok(temporalUtf8Bytes(value.state.agents[0].discovery.temporal.keys) > FINITE_TEMPORAL_PROFILE.contextBytes);
  }, 'TEMPORAL_CAPACITY');
});

test('malformed metadata, source/schema mismatches and two actors fail instead of reconstructing defaults', () => {
  const base = raw();
  for (const mutate of [
    value => { value.profile.name = 'large-default'; }, value => { value.profile.rows = 4096; },
    value => { delete value.profile; }, value => { value.profile = FINITE_TEMPORAL_PROFILE.name; },
    value => { value.arm = 'frozen-zero'; }, value => { value.sourceFingerprint = 'b'.repeat(64); },
    value => { value.format = 'application-save'; }, value => { value.version = 2; },
    value => { value.state.agents.push(copy(value.state.agents[0])); },
    value => { value.state.agents[0].version = 5; }, value => { value.state.agents[0].discovery.version = 2; },
    value => { value.state.agents[0].physiology.version = 2; }, value => { value.state.environment.schemaVersion = 99; },
    value => { value.state.environment.ecology.version = 99; }, value => { value.state.environment.ecology.regions.pop(); },
    value => { value.state.environment.worldRules.version = 2; }, value => { value.state.cardinal = { version: 1 }; },
  ]) rejectMutation(base, mutate);
  assert.throws(() => restoreFiniteCheckpoint(JSON.stringify(base)), /does not match/);
});

test('bad selector RNG/focus, driver proof, future chronology and dictionary references fail without cleanup', () => {
  const base = raw(withLearning()), actor = value => value.state.agents[0], memory = value => actor(value).discovery.temporal.data;
  for (const mutate of [
    value => { value.selector.rng = -1; }, value => { value.selector.rng = 0x100000000; },
    value => { value.selector.focus = { objectId: 'object:1', startedAt: 6, used: 0 }; },
    value => { value.selector.focus = { objectId: 'object:2', startedAt: 0, used: 1, parentId: 'object:1', proofSeq: 1 }; },
    value => { actor(value).rng = 1.5; }, value => { value.driver.senseAt = 6; }, value => { value.driver.epoch = 1; },
    value => { value.driver.pending = { seq: 1, action: { type: 'wait', seconds: 5 }, previousEventId: 0 }; },
    value => { memory(value).clockAt = 6; }, value => { memory(value).receipts[0].completedAt = 6; },
    value => { memory(value).model.rows[0].lastAt = 6; }, value => { memory(value).open.accountedUntil = 6; },
    value => { memory(value).model.rows[0].key = -1; }, value => { memory(value).model.rows[0].key = 999; },
    value => { memory(value).model.rows[0].q[0] = -1; },
    value => { actor(value).physiology.feedback.push({ id: 'feedback:1', at: 6, effect: 'sustained' }); },
  ]) rejectMutation(base, mutate);
});

test('whole actor gate includes ordinary memory and envelope policy state, before normalization', () => {
  const f = fixture(), base = raw(f), value = copy(base);
  value.state.agents[0].decision = 'x'.repeat(FINITE_CHECKPOINT.actorBytes);
  assert.ok(temporalUtf8Bytes(value.state.agents[0].discovery.temporal) < 1024, 'temporal payload alone is tiny');
  const text = JSON.stringify(value);
  assert.throws(() => restoreFiniteCheckpoint(text, options), error => error.code === 'FINITE_ACTOR_BUDGET');
  f.state.npc.decision = value.state.agents[0].decision;
  assert.throws(() => serializeFiniteCheckpoint(f), error => error.code === 'FINITE_ACTOR_BUDGET');
  const { state, ...metadata } = base, actor = state.agents[0];
  actor.decision = '';
  const overhead = temporalUtf8Bytes({ ...metadata, actor });
  actor.decision = 'x'.repeat(FINITE_CHECKPOINT.actorBytes - overhead + 1);
  assert.ok(temporalUtf8Bytes(actor) < FINITE_CHECKPOINT.actorBytes, 'actor alone fits');
  assert.throws(() => restoreFiniteCheckpoint(JSON.stringify(base), options), error => error.code === 'FINITE_ACTOR_BUDGET', 'selector/driver/profile metadata pushes the complete actor over the gate');
});

test('missing depleted body stores cannot become fresh reserves or health on restore', () => {
  const f = fixture(), n = f.state.npc;
  Object.assign(n.physiology, { availableEnergyKcal: 0, storedEnergyKcal: 0, health: 5 }); projectPhysiology(n);
  const base = raw(f);
  const restored = restoreFiniteCheckpoint(JSON.stringify(base), options);
  assert.deepEqual(restored.state.npc.physiology, n.physiology);
  for (const fields of [['availableEnergyKcal'], ['storedEnergyKcal'], ['health'], ['availableEnergyKcal', 'storedEnergyKcal', 'health']]) {
    rejectMutation(base, value => { for (const field of fields) delete value.state.agents[0].physiology[field]; });
  }
  rejectMutation(base, value => { delete value.state.agents[0].physiology.totals; });
  rejectMutation(base, value => { value.state.agents[0].physiology.storedEnergyKcal = -1; });
});

test('full world, body and evidence validation rejects silent drops, clamping and history slicing', () => {
  const base = raw(), actor = value => value.state.agents[0], env = value => value.state.environment;
  const before = copy(base);
  for (const mutate of [
    value => { env(value).ecology.animals[0].id = 'bad-animal'; },
    value => { delete env(value).ecology.animals[0].physiology.health; },
    value => { env(value).ecology.plants[0].id = 'bad-plant'; },
    value => { env(value).ecology.regions[0].nutrients = -1; },
    value => { delete env(value).ecology.detritus.nutrients; },
    value => { env(value).weather.kind = 'forged-weather'; },
    value => { env(value).ecology.animals[0].feelings = { relief: .2, futureAuthority: 1 }; },
    value => { actor(value).physiology.feedback.push({ id: 'feedback:1', at: 0, effect: 'malformed' }); },
    value => { actor(value).cognition.history = Array.from({ length: 13 }, (_, i) => ({ id: `plan:${i}`, goal: 'wait', status: 'completed', at: 0, reason: 'finished' })); },
    value => { actor(value).memory.experience.push({ id: 1, type: 'unknown-event', at: 0, details: {} }); },
    value => { value.state.community.messages.push({ id: 'message:1', at: 0, channel: 'invalid' }); },
  ]) rejectMutation(base, mutate);
  assert.deepEqual(base, before, 'failed restore probes never mutate their common source');
  const f = fixture(); f.state.environment.ecology.animals[0].id = 'bad-animal';
  const invalid = copy(f);
  assert.throws(() => serializeFiniteCheckpoint(f), /Environment is not canonical/);
  assert.deepEqual(f, invalid, 'failed live serialization also preserves evidence');
});

test('future observed and actual evidence clocks are rejected while explicit future schedules remain valid', () => {
  const d = realDriver(), base = JSON.parse(driverText(d)); d.dispose();
  const observedId = Object.keys(base.state.agents[0].discovery.observations)[0];
  assert.ok(observedId);
  for (const mutate of [
    value => { value.state.agents[0].discovery.observations[observedId].observedAt = 1; },
    value => { value.state.agents[0].memory.experience[0].at = 1; },
    value => { value.state.agents[0].cognition.beliefs[0].evidence[0].at = 1; },
  ]) rejectMutation(base, mutate);
  const scheduled = copy(base);
  scheduled.state.agents[0].nextDecisionAt = 20;
  const source = Object.values(scheduled.state.agents[0].memory.sources)[0]; source.retryAfter = 20;
  const restored = restoreFiniteCheckpoint(JSON.stringify(scheduled), options);
  assert.equal(restored.state.npc.nextDecisionAt, 20);
  assert.equal(restored.state.npc.memory.sources[source.id].retryAfter, 20);
});

test('object-keyed pending-sample timestamps and dialogue clocks cannot point into the future', () => {
  const base = raw();
  for (const at of [-1, 1, null, '0']) rejectMutation(base, value => { value.state.agents[0].discovery.samplesPending = { 'object:1': at }; });
  for (const at of [-61, 1, null, '0']) rejectMutation(base, value => { value.state.agents[0].discovery.lastDialogueAt = at; });
  const legitimate = copy(base);
  legitimate.state.agents[0].discovery.samplesPending = { 'object:1': 0 };
  for (const lastDialogueAt of [-60, 0]) {
    legitimate.state.agents[0].discovery.lastDialogueAt = lastDialogueAt;
    const restored = restoreFiniteCheckpoint(JSON.stringify(legitimate), options);
    assert.deepEqual(restored.state.npc.discovery.samplesPending, { 'object:1': 0 });
    assert.equal(restored.state.npc.discovery.lastDialogueAt, lastDialogueAt);
  }
  const live = fixture(); live.state.npc.discovery.samplesPending = { 'object:1': Infinity };
  assert.throws(() => serializeFiniteCheckpoint(live), /Nonfinite|pending-sample/);
});

test('real idle-pending completion rejects forged learner outcomes and timestamps', () => {
  const d = realDriver(); d.captureCompletion = () => {};
  assert.equal(d.submit({ type: 'pull', targetId: tree.id }), true);
  while (d.npc.active) d.step(1 / 60);
  const base = JSON.parse(driverText(d)), before = copy(d.npc);
  assert.ok(d.pending);
  assert.ok(restoreFiniteCheckpoint(JSON.stringify(base), options).pendingDisposition.status === 'pending');
  const changedExertion = base.state.agents[0].lastResult.exertion === 'strenuous' ? 'light' : 'strenuous';
  for (const [field, value] of [['materialId', 'object:999999'], ['ingestionId', 'ingestion:999999'], ['at', 0], ['durationSeconds', 99], ['workedSeconds', 99], ['exertion', changedExertion]]) {
    rejectMutation(base, input => { input.state.agents[0].lastResult[field] = value; });
  }
  assert.deepEqual(d.npc, before);
  d.dispose();
});

test('real shelter entry and exit epochs round-trip without normalization drift', () => {
  const d = realDriver({ shelter: true }), cave = CAVES.find(c => c.id === 'refuge');
  assert.equal(d.submit({ type: 'enter_shelter', shelterId: cave.id }), true);
  let reopened = restoreFiniteCheckpoint(driverText(d), options);
  assert.equal(reopened.state.npc.scene, cave.id);
  assert.equal(reopened.driver.epoch, d.npc.epoch);
  assert.deepEqual(reopened.state.npc.discovery.temporal, d.memory);
  assert.deepEqual(reopened.state.npc.physiology, d.npc.physiology);
  d.npc.position = { ...CAVE_EXIT }; observeNpc(d.npc, d.state.environment);
  while (d.npc.elapsed < d.npc.nextDecisionAt) d.step(1 / 60);
  assert.equal(d.submit({ type: 'exit_shelter' }), true);
  reopened = restoreFiniteCheckpoint(driverText(d), options);
  assert.equal(reopened.state.npc.scene, 'valley');
  assert.equal(reopened.driver.epoch, d.npc.epoch);
  assert.equal(reopened.driver.epoch, 2);
  d.dispose();
});

test('release and exact-item regrasp cannot restore a stale producing-focus proof', () => {
  const f = fixture(), m = f.state.npc.discovery.temporal;
  for (const [action, result] of [
    [{ type: 'pull', targetId: 'object:1' }, { ok: true, code: 'PULLED', materialId: 'object:2' }],
    [{ type: 'release', targetId: 'object:2' }, { ok: true, code: 'RELEASED' }],
    [{ type: 'grasp', targetId: 'object:2' }, { ok: true, code: 'GRASPED', materialId: 'object:2' }],
  ]) {
    const seq = beginTemporalDecision(m, { at: 0, context: {}, action });
    completeTemporalDecision(m, { seq, at: 0, actionId: seq, result });
  }
  const base = raw(f);
  rejectMutation(base, value => { value.selector.focus = { objectId: 'object:2', parentId: 'object:1', proofSeq: 1, startedAt: 0, used: 1 }; });
});

test('only the documented animal relief signal may be omitted from a valid live save', () => {
  const f = fixture(), animal = f.state.environment.ecology.animals[0]; animal.feelings = { relief: .2 };
  const before = copy(f), restored = restoreFiniteCheckpoint(serializeFiniteCheckpoint(f), options);
  assert.equal(restored.state.environment.ecology.animals[0].feelings, undefined);
  assert.deepEqual(restored.state.environment.ecology.animals[0].physiology, animal.physiology);
  assert.deepEqual(f, before);
  animal.feelings.newField = 1;
  assert.throws(() => serializeFiniteCheckpoint(f), /Environment is not canonical/);
});
