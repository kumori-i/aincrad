import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpc } from '../src/npc-state.js';
import { discoveryDecision } from '../src/discovery.js';
import { FiniteTemporalDriver } from '../scripts/lib/finite-temporal-driver.mjs';
import { temporalUtf8Bytes } from '../src/temporal-storage.js';
import { admitTemporalContext } from '../src/temporal-storage.js';
import { temporalKey } from '../src/temporal-returns.js';
import { createTemporalLedger, beginTemporalDecision, completeTemporalDecision, advanceTemporalClock, recordTemporalFeedback } from '../src/temporal-ledger.js';
import { createReusableOutcomeModel, updatePhysicalReceipt } from '../scripts/lib/reusable-outcome-model.mjs';
import { createReusableOutcomeSensor, observeReusableMaterials, observeReusableSubmission, observeReusableCompletion,
  advanceReusableSensor, snapshotReusableFeedback, recordReusableFeedback } from '../scripts/lib/reusable-outcome-sensor.mjs';
import { createReusablePredictionState, createReusablePredictionFixture, ReusablePredictionFixture,
  REUSABLE_FIXTURE, serializeReusablePredictionCheckpoint, restoreReusablePredictionCheckpoint,
  reopenReusablePredictionFixture, reusablePredictionActorBytes, reusableActorBytes,
  reusablePredictionActorEnvelope, reusableCombinedDictionaryBudget } from '../scripts/lib/reusable-prediction-fixture.mjs';

const SOURCE = 'd'.repeat(64), DT = REUSABLE_FIXTURE.nativeStepSeconds, copy = x => structuredClone(x);
// These are small integration/serialization checks, not outcome assays or gates.
// There is no ingestion, delayed-harm intervention, autonomous episode or benchmark.
const initial = createReusablePredictionState();
function fixture(options = {}) {
  const state = copy(initial.state); state.npc = state.agents[0];
  return new ReusablePredictionFixture(state, { sourceFingerprint: SOURCE, ...options });
}
function advanceAll(drivers, predicate) {
  for (let frame = 0; predicate() && frame < 4000; frame++) for (const driver of drivers) driver.step(DT);
  assert.equal(Boolean(predicate()), false, 'short fixture reached the physical boundary');
}
function actAll(drivers, action) {
  advanceAll(drivers, () => drivers[0].npc.elapsed < drivers[0].npc.nextDecisionAt);
  for (const d of drivers) assert.equal(d.submit(action), true);
  advanceAll(drivers, () => drivers[0].pending !== null);
  for (const d of drivers) assert.equal(d.pending, null);
}
function evidence(f) { return copy({ state: f.state, selector: f.selector, driver: f.checkpointDriver(), model: f.model, sensor: f.sensor }); }
function actorInput(f) { return { actor: f.npc, selector: f.selector, driver: f.checkpointDriver(), model: f.model, sensor: f.sensor, admission: f.admission,
  sourceFingerprint: SOURCE, predictionArm: f.predictionArm, sensorEnabled: f.sensorEnabled }; }
function rejectMutation(text, mutate) {
  const raw = JSON.parse(text); mutate(raw); const corrupt = JSON.stringify(raw), before = corrupt;
  assert.throws(() => restoreReusablePredictionCheckpoint(corrupt, { expectedSourceFingerprint: SOURCE }));
  assert.equal(corrupt, before, 'failed validation preserves the supplied source bytes');
}

test('fixed single-actor setup preserves default body, first source and first collision-valid approach', () => {
  const { state, owner } = initial, defaultNpc = createNpc({ id: 'aster', mode: 'discovery', seed: 74193 });
  assert.equal(state.agents.length, 1); assert.equal(state.cardinal, null); assert.equal(state.environment.seed, 74193);
  assert.deepEqual(state.npc.physiology, defaultNpc.physiology);
  assert.equal(owner.sourceId, state.environment.ecology.plants.find(p => p.kind === 'apple_tree' && p.quantity > 0).id);
  assert.deepEqual(owner.approach, owner.approaches.find(p => p.collisionValid));
  assert.equal(owner.approach.inReach, true); assert.equal(owner.approach.lineOfSight, true);
  assert.deepEqual(state.npc.position, owner.approach.position); assert.deepEqual(owner.bodyOverrides, {});
  const f = createReusablePredictionFixture({ sourceFingerprint: SOURCE });
  try { assert.equal(f.owner.sourceId, owner.sourceId); assert.equal(f.automatic, false); assert.equal(f.arm, 'frozen-zero'); }
  finally { f.dispose(); }
});

test('sensor on/off and existing frozen driver have byte-identical native physical behavior for fixed scripts', () => {
  const enabled = fixture(), disabled = fixture({ sensorEnabled: false }), referenceState = copy(initial.state);
  referenceState.npc = referenceState.agents[0];
  const reference = new FiniteTemporalDriver(referenceState, { automatic: false, arm: 'frozen-zero' });
  const all = [enabled, disabled, reference];
  try {
    for (const action of [{ type: 'inspect_object', targetId: initial.owner.sourceId }, { type: 'wait', seconds: .25 }, { type: 'strike', targetId: initial.owner.sourceId }]) {
      actAll(all, action);
      assert.equal(JSON.stringify(enabled.state), JSON.stringify(disabled.state));
      assert.equal(JSON.stringify(enabled.state), JSON.stringify(reference.state));
      assert.deepEqual(enabled.selector, reference.selector);
    }
    assert.ok(enabled.model.rows.length); assert.equal(disabled.model.rows.length, 0);
    assert.equal(enabled.memory.model.updateCount, 0); assert.equal(enabled.sensor.exposures.length, 0);
    assert.equal(enabled.sensor.clockAt, enabled.npc.elapsed);
    assert.equal(enabled.sensor.observationAt, enabled.controller.senseAt);
    assert.ok(enabled.predictionTimings.native.length); assert.ok(enabled.predictionTimings.batches.length);
  } finally { all.forEach(d => d.dispose()); }
});

test('guarded proposals spend no submission, cost interval or sensor update; genuine scheduler delay is retained', () => {
  const f = fixture();
  try {
    const receipt = f.act({ type: 'wait', seconds: .25 });
    assert.equal(f.model.cursors.interval.sequence, 0);
    assert.equal(f.sensor.receipts[0].interval, false);
    const after = evidence(f);
    assert.equal(f.submit({ type: 'wait', seconds: .25 }), false);
    assert.deepEqual(evidence(f), after);
    while (f.npc.elapsed < f.npc.nextDecisionAt) f.step(DT);
    assert.equal(f.model.cursors.interval.sequence, 0, 'elapsed waiting alone never closes an action interval');
    assert.equal(f.submit({ type: 'wait', seconds: .25 }), true);
    const next = f.memory.receipts.at(-1);
    assert.ok(next.at - receipt.completedAt >= .65 - 1e-10);
    assert.equal(f.model.cursors.interval.sequence, receipt.seq);
    assert.equal(f.sensor.receipts[0].interval, true);
    const closed = f.memory.model.transitions.find(t => t.seq === receipt.seq);
    const parent = f.model.rows.find(r => r.type === 'physical' && r.T.n);
    assert.equal(parent.T.sum, closed.reward[3]); assert.equal(parent.E.sum, closed.reward[4]);
    const pending = evidence(f); assert.equal(f.submit({ type: 'wait', seconds: .25 }), false); assert.deepEqual(evidence(f), pending);
  } finally { f.dispose(); }
});

test('cached observation and immutable root predictions do not observe, tick, change RNG or alter factual evidence', () => {
  const f = fixture();
  try {
    f.step(); const before = evidence(f), preview = discoveryDecision(copy(f.npc), { foodLearning: false, ordinaryProposal: true });
    assert.ok(preview.ordinary);
    const a = f.candidateSnapshot(), b = f.candidateSnapshot();
    assert.deepEqual(a, b); assert.deepEqual(a.candidates.map(c => c.action), preview.ordinary.choices.map(c => c.action));
    assert.ok(Object.isFrozen(a)); assert.ok(Object.isFrozen(a.view.objects));
    assert.deepEqual(f.observe(), a.view);
    assert.deepEqual(f.predict(a, f.model, { draws: a.draws }), f.predict(b, f.model, { draws: b.draws }));
    assert.deepEqual(evidence(f), before);
    assert.equal(f.selector.choices, 0); assert.equal(a.previewSelector.choices, 1);
    assert.equal(a.draws.length, 4); assert.throws(() => { a.candidates[0].action.type = 'sample'; }, TypeError);
    for (const row of f.model.keys) assert.ok(!row.includes('object:'));
  } finally { f.dispose(); }
});

test('frozen prediction parameters continue identical physical receipts and factual sensor bookkeeping', () => {
  const online = fixture(), frozen = fixture();
  try {
    actAll([online, frozen], { type: 'wait', seconds: .25 });
    actAll([online, frozen], { type: 'inspect_object', targetId: initial.owner.sourceId });
    const fixed = frozen.freezeParameters();
    actAll([online, frozen], { type: 'wait', seconds: .25 });
    assert.deepEqual(frozen.model, fixed); assert.notDeepEqual(online.model, fixed);
    assert.deepEqual(frozen.sensor, online.sensor); assert.deepEqual(frozen.npc, online.npc);
    const snapshot = online.candidateSnapshot();
    assert.deepEqual(frozen.predict(snapshot, fixed), online.predict(snapshot, fixed));
  } finally { online.dispose(); frozen.dispose(); }
});

test('matched four-draw snapshots use declared draw zero for new focus and preserve valid current focus', () => {
  const f = fixture();
  try {
    f.step(); const before = evidence(f), draws = [.999999, .5, .5, .5];
    const snapshot = f.candidateSnapshot({ draws }), view = snapshot.view;
    const eligible = view.objects.filter(o => view.held.includes(o.id) || o.scene === view.scene &&
      view.at - o.observedAt < 8 && Math.hypot(view.position.x - o.position.x, view.position.y - o.position.y) <= view.reach);
    assert.ok(eligible.length); assert.equal(snapshot.previewSelector.focus.objectId, eligible.at(-1).id);
    assert.deepEqual(snapshot.draws, draws); assert.deepEqual(evidence(f), before);
    assert.deepEqual(f.candidateSnapshot({ draws }), snapshot);
    f.selector.focus = { objectId: eligible[0].id, startedAt: f.npc.elapsed, used: 3 };
    const focused = evidence(f), preserved = f.candidateSnapshot({ draws });
    assert.deepEqual(preserved.previewSelector.focus, { ...f.selector.focus, used: 4 });
    assert.deepEqual(evidence(f), focused);
    assert.throws(() => f.candidateSnapshot({ draws: [.5, .5, .5] }));
    assert.throws(() => f.candidateSnapshot({ draws: [1, .5, .5, .5] }));
  } finally { f.dispose(); }
});

test('strict checkpoint is pure, counts whole actor, preserves open sensor watermarks and resumes without updates', () => {
  const f = fixture(); let reopened;
  try {
    f.act({ type: 'inspect_object', targetId: initial.owner.sourceId }); f.stepFrames(7);
    const before = evidence(f), text = f.serializeCheckpoint(), bytes = reusablePredictionActorBytes(text);
    assert.deepEqual(evidence(f), before); assert.ok(bytes <= 1024 * 1024);
    const raw = JSON.parse(text), direct = reusablePredictionActorEnvelope(actorInput(f));
    // The full checkpoint uses canonical ordinary save fields. Its raw-actor
    // admission also counts this exact helper result before canonicalization.
    assert.equal(reusableActorBytes(actorInput(f)), temporalUtf8Bytes(direct));
    assert.ok(bytes > temporalUtf8Bytes(raw.model) + temporalUtf8Bytes(raw.sensor));
    const decoded = restoreReusablePredictionCheckpoint(text, { expectedSourceFingerprint: SOURCE });
    assert.deepEqual(decoded.model, f.model); assert.deepEqual(decoded.sensor, f.sensor);
    reopened = reopenReusablePredictionFixture(text, { expectedSourceFingerprint: SOURCE });
    assert.deepEqual(reopened.model, f.model); assert.deepEqual(reopened.sensor, f.sensor);
    assert.deepEqual(reopened.npc.physiology, f.npc.physiology);
    f.stepFrames(11); reopened.stepFrames(11);
    assert.deepEqual(reopened.sensor, f.sensor); assert.deepEqual(reopened.model, f.model);
    assert.deepEqual(reopened.npc.physiology, f.npc.physiology);
    assert.equal(reopened.memory.model.updateCount, 0);
  } finally { f.dispose(); reopened?.dispose(); }
});

test('interrupted restart retains incomplete command and does not fabricate effect, cost, work or completion', () => {
  const f = fixture(); let reopened;
  try {
    assert.equal(f.submit({ type: 'strike', targetId: initial.owner.sourceId }), true); f.stepFrames(12);
    const seq = f.pending.seq, model = copy(f.model), sensor = copy(f.sensor), text = f.checkpoint();
    reopened = reopenReusablePredictionFixture(text, { expectedSourceFingerprint: SOURCE });
    assert.equal(reopened.npc.active, null); assert.equal(reopened.pending, null); assert.equal(reopened.memory.open, null);
    assert.equal(reopened.memory.receipts.find(r => r.seq === seq).outcome, undefined);
    assert.deepEqual(reopened.model, model); assert.deepEqual(reopened.sensor, sensor);
    assert.ok(reopened.npc.memory.experience.some(e => e.details.result?.code === 'RESTART_INTERRUPTED'));
    reopened.act({ type: 'wait', seconds: .25 });
    assert.equal(reopened.model.cursors.interval.sequence, 0);
    assert.equal(reopened.sensor.receipts.find(r => r.seq === seq).completed, false);
  } finally { f.dispose(); reopened?.dispose(); }
});

test('corrupt checkpoint fields, source, clocks, model counts and oversized actor are rejected without replacing source', () => {
  const f = fixture();
  try {
    f.act({ type: 'wait', seconds: .25 }); const text = serializeReusablePredictionCheckpoint(f);
    rejectMutation(text, raw => { raw.version = 2; });
    rejectMutation(text, raw => { raw.extra = true; });
    rejectMutation(text, raw => { raw.finite.sourceFingerprint = 'e'.repeat(64); });
    rejectMutation(text, raw => { raw.sensor.clockAt = raw.finite.state.elapsed + 1; });
    rejectMutation(text, raw => { raw.model.rows[0].receipts = -1; });
    rejectMutation(text, raw => { raw.sensor.executable = 'anything'; });
    rejectMutation(text, raw => { raw.finite.state.agents[0].decision = 'x'.repeat(1024 * 1024); });
    assert.throws(() => restoreReusablePredictionCheckpoint(text, { expectedSourceFingerprint: SOURCE, expectedPredictionArm: 'frozen' }), /mismatch/);
    const bad = copy(f.model); bad.rows[0].receipts = -1; f.model = bad;
    assert.throws(() => f.checkpoint()); assert.deepEqual(f.model, bad);
  } finally { f.dispose(); }
});

test('disabled sensor checkpoint preserves an empty model at the actual saved native clock', () => {
  const f = fixture({ sensorEnabled: false }); let reopened;
  try {
    f.act({ type: 'wait', seconds: .25 });
    assert.equal(f.sensor.clockAt, f.npc.elapsed);
    reopened = reopenReusablePredictionFixture(f.checkpoint(), { expectedSourceFingerprint: SOURCE });
    assert.equal(reopened.sensorEnabled, false); assert.deepEqual(reopened.sensor, f.sensor); assert.deepEqual(reopened.model, f.model);
  } finally { f.dispose(); reopened?.dispose(); }
});

function fillDictionary(memory, size) {
  for (let i = 0; memory.contextKeys.length < size; i++) {
    assert.equal(admitTemporalContext(memory, temporalKey({ appearance: { shape: `capacity fixture ${i}` } }, 'wait')), true);
  }
}

test('combined dictionary admission rejects before a physical request without spending old cursors, RNG or evidence', () => {
  const f = fixture();
  try {
    fillDictionary(f.memory, 512);
    const before = evidence(f);
    assert.equal(f.submit({ type: 'wait', seconds: .25 }), false);
    assert.deepEqual(evidence(f), before); assert.equal(f.npc.active, null);
    assert.equal(f.admission.deniedSubmissions, 1); assert.equal(f.admission.lastDenial.keys, 513);
    const raw = JSON.parse(f.checkpoint());
    assert.deepEqual(raw.admission, f.admission);
    assert.equal(reusableCombinedDictionaryBudget({ memory: f.memory, model: f.model }).keys, 512);
  } finally { f.dispose(); }
});

test('combined numerical-cap denial retains actual sensor facts and prior parameters; existing-key labels still update', () => {
  const f = fixture();
  try {
    f.act({ type: 'wait', seconds: .25 }, { context: {} });
    assert.equal(f.model.keys.length, 5);
    assert.equal(admitTemporalContext(f.memory, temporalKey({}, 'inspect_object')), true);
    fillDictionary(f.memory, 507);
    assert.equal(reusableCombinedDictionaryBudget({ memory: f.memory, model: f.model }).keys, 512);
    const inspect = f.act({ type: 'inspect_object', targetId: initial.owner.sourceId }, { context: {} });
    assert.equal(f.sensor.receipts.find(r => r.seq === inspect.seq).completed, true);
    assert.equal(f.model.cursors.receipt.sequence, 1);
    assert.equal(f.model.keys.length, 5); assert.equal(f.admission.deniedBatches, 1);
    const wait = f.act({ type: 'wait', seconds: .25 }, { context: {} });
    assert.equal(f.model.cursors.receipt.sequence, wait.seq);
    assert.equal(f.model.keys.length, 5); assert.equal(f.admission.deniedBatches, 2);
    assert.equal(f.sensor.receipts.find(r => r.seq === inspect.seq).interval, true);
    const decoded = restoreReusablePredictionCheckpoint(f.checkpoint(), { expectedSourceFingerprint: SOURCE });
    assert.deepEqual(decoded.sensor, f.sensor); assert.deepEqual(decoded.model, f.model); assert.deepEqual(decoded.admission, f.admission);
    assert.equal(reusableCombinedDictionaryBudget({ memory: f.memory, model: f.model }).keys, 512);
  } finally { f.dispose(); }
});

test('combined dictionary helper counts both real arrays and denies aggregate bytes or entries without deduplication', () => {
  const old = ['one', 'two'], newer = ['one'];
  const measured = reusableCombinedDictionaryBudget({ memory: { contextKeys: old }, model: { keys: newer } });
  assert.equal(measured.keys, 3);
  assert.equal(measured.dictionaryBytes, temporalUtf8Bytes(old) + temporalUtf8Bytes(newer));
  assert.throws(() => reusableCombinedDictionaryBudget({ memory: { contextKeys: Array.from({ length: 512 }, (_, i) => String(i)) }, model: { keys: ['new'] } }), e => e.code === 'REUSABLE_COMBINED_CAPACITY');
  assert.throws(() => reusableCombinedDictionaryBudget({ memory: { contextKeys: ['é'.repeat(70000)] }, model: { keys: ['é'.repeat(70000)] } }), e => e.code === 'REUSABLE_COMBINED_CAPACITY');
});

// Adversarial numerical-admission contracts use only synthetic public ledger
// facts. They never step a world, inject physical feedback, or count as assays.
function syntheticNumerical(arm = 'online') {
  const f = Object.create(ReusablePredictionFixture.prototype);
  Object.assign(f, { npc: { elapsed: 0, discovery: { temporal: createTemporalLedger({ capacityProfile: 'finite-temporal-v1' }) } },
    sensor: createReusableOutcomeSensor(), model: createReusableOutcomeModel(), predictionArm: arm, sensorEnabled: true,
    admission: { deniedSubmissions: 0, deniedBatches: 0, lastDenial: null, exposures: [] }, reservedContextKey: null,
    sink: null, now: () => 0, predictionTimings: { native: [], batches: [], decisions: [] } });
  f.view = { at: 0, held: ['object:1'], capacity: 4, body: { hunger: 'hungry', thirst: 'thirsty', digestion: 'empty' },
    objects: [{ id: 'object:1', appearance: { shape: 'round', color: 'red', texture: 'smooth', motion: 'still', size: 'small', smell: 'sweet' }, count: 4, observedAt: 0 }] };
  observeReusableMaterials(f.sensor, { view: f.view, observationAt: 0, observedIds: ['object:1'] });
  return f;
}
function syntheticAt(f, at) { f.npc.elapsed = f.view.at = at; advanceTemporalClock(f.memory, at); }
function syntheticBegin(f, type = 'sample') {
  const seq = beginTemporalDecision(f.memory, { at: f.npc.elapsed, action: { type, targetId: 'object:1' }, context: {} });
  f.applyLabels(observeReusableSubmission(f.sensor, { memory: f.memory, seq, view: copy(f.view) })); return seq;
}
function syntheticComplete(f, seq, at, swallow = true) {
  syntheticAt(f, at);
  completeTemporalDecision(f.memory, { seq, at, actionId: seq, result: { ok: true, code: swallow ? 'SWALLOWED' : 'OBJECT_OBSERVED',
    ...(swallow ? { ingestionId: `ingestion:${seq}` } : {}), durationSeconds: at - f.memory.receipts.find(r => r.seq === seq).at } });
  return observeReusableCompletion(f.sensor, { memory: f.memory, seq, view: copy(f.view) });
}
function syntheticEvent(f, at, effect = 'sustained') {
  syntheticAt(f, at); const ing = f.memory.ingestions[0];
  const event = { id: `feedback:${f.memory.feedbackCursor + 1}`, at, provenance: 'sampled', ingestionId: ing.id,
    objectId: ing.objectId, actionId: ing.actionId, effect };
  const before = snapshotReusableFeedback(f.memory, event); recordTemporalFeedback(f.memory, event, { now: at });
  f.applyLabels(recordReusableFeedback(f.sensor, { before, memory: f.memory, event, now: at }));
}
function exposureParent(f) { return f.model.rows.find(r => r.type === 'exposure' && f.model.keys[r.key] === '["e"]'); }

test('mixed-label capacity denial cannot erase an existing exposure risk denominator', () => {
  const f = syntheticNumerical(), seq = syntheticBegin(f);
  f.applyLabels(syntheticComplete(f, seq, 1));
  syntheticAt(f, 2); const inspect = syntheticBegin(f, 'inspect_object');
  fillDictionary(f.memory, 512 - f.model.keys.length);
  const physical = syntheticComplete(f, inspect, 10, false);
  const risk = advanceReusableSensor(f.sensor, { memory: f.memory, at: 10 });
  f.applyLabels({ receiptUpdates: physical.receiptUpdates, intervalUpdates: [], exposureUpdates: risk.exposureUpdates });
  assert.equal(f.admission.deniedBatches, 1);
  assert.equal(exposureParent(f).cells[2][0].riskSeconds, 9);
  assert.equal(f.admission.exposures[0].admitted, true); assert.equal(f.admission.exposures[0].censored, 0);
  syntheticEvent(f, 31);
  assert.equal(exposureParent(f).cells[0][0].riskSeconds, 30);
  assert.equal(exposureParent(f).cells[0][0].events, 1);
  assert.equal(exposureParent(f).cells[2][0].riskSeconds, 30);
});

test('denied ingestion birth never creates risk/event-only parameter rows later', () => {
  const f = syntheticNumerical(), seq = syntheticBegin(f);
  fillDictionary(f.memory, 507);
  f.applyLabels(syntheticComplete(f, seq, 1));
  assert.equal(exposureParent(f), undefined); assert.equal(f.admission.exposures[0].admitted, false);
  assert.equal(f.admission.exposures[0].censored, 7);
  const model = copy(f.model);
  syntheticEvent(f, 31);
  assert.deepEqual(f.model, model); assert.deepEqual(f.sensor.totals, [1, 0, 0]);
  assert.equal(f.memory.ingestions[0].channels, 1);
});

test('an omitted numerical risk interval permanently suppresses its later event even after admission becomes available', () => {
  const f = syntheticNumerical(), seq = syntheticBegin(f);
  f.applyLabels(syntheticComplete(f, seq, 1));
  syntheticAt(f, 10); const risk = advanceReusableSensor(f.sensor, { memory: f.memory, at: 10 });
  const admit = f.admitNumericalLabel;
  f.admitNumericalLabel = () => false; // Isolate the fail-closed consumer contract.
  f.applyLabels(risk); f.admitNumericalLabel = admit;
  assert.equal(f.admission.exposures[0].censored, 7);
  syntheticEvent(f, 31);
  assert.equal(exposureParent(f).ingestions, 1);
  assert.equal(exposureParent(f).cells[0][0].events, 0); assert.equal(exposureParent(f).cells[0][0].riskSeconds, 0);
  assert.deepEqual(f.sensor.totals, [1, 0, 0]); assert.equal(f.memory.ingestions[0].channels, 1);
});

test('numerical denial and frozen parameters leave identical factual exposure support and proofs', () => {
  const online = syntheticNumerical(), frozen = syntheticNumerical('frozen');
  for (const f of [online, frozen]) {
    const seq = syntheticBegin(f); fillDictionary(f.memory, 507);
    f.applyLabels(syntheticComplete(f, seq, 1)); syntheticEvent(f, 31);
  }
  assert.deepEqual(online.sensor, frozen.sensor);
  assert.deepEqual(online.memory.ingestions, frozen.memory.ingestions);
  assert.deepEqual(online.memory.totals, frozen.memory.totals);
  assert.ok(online.admission.deniedBatches); assert.equal(frozen.admission.deniedBatches, 0);
});

test('trusted live numerical admission reports duplicate receipt labels as unadmitted without replacing snapshot', () => {
  const f = syntheticNumerical(), seq = syntheticBegin(f, 'inspect_object');
  const labels = syntheticComplete(f, seq, 1, false);
  f.applyLabels(labels); const model = f.model;
  assert.equal(Object.isFrozen(model), true); assert.equal(f.modelSession.snapshot(), model);
  assert.equal(f.admitNumericalLabel(updatePhysicalReceipt, labels.receiptUpdates[0]), false);
  assert.equal(f.model, model); assert.equal(f.admission.deniedBatches, 0);
});
