import test from 'node:test';
import assert from 'node:assert/strict';
import { createTemporalLedger, beginTemporalDecision, advanceTemporalClock, completeTemporalDecision, recordTemporalFeedback } from '../src/temporal-ledger.js';
import { createReusableOutcomeModel, updatePhysicalReceipt, updatePhysicalInterval, updateExposure } from '../scripts/lib/reusable-outcome-model.mjs';
import { temporalContext, temporalIntegral } from '../src/temporal-returns.js';
import { createReusableOutcomeSensor, observeReusableMaterials, observeReusableSubmission, observeReusableCompletion,
  snapshotReusableFeedback, recordReusableFeedback, advanceReusableSensor, beforeReusableProofEviction,
  noteReusableNativeClock, reusableMaterialSupport, reusableCandidateFeatures, validateReusableOutcomeSensor } from '../scripts/lib/reusable-outcome-sensor.mjs';

// Synthetic public-ledger contract regressions only; no physical assay or autonomy.
const appearance = { shape: 'round', color: 'red', texture: 'smooth', motion: 'still', size: 'small', smell: 'sweet' };
const clone = x => structuredClone(x);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
function fixture(ids = ['object:1']) {
  const memory = createTemporalLedger({ capacityProfile: 'finite-temporal-v1' });
  const sensor = createReusableOutcomeSensor();
  const f = { memory, sensor, at: 0, nextAction: 1, nextIngestion: 1, nextFeedback: 1, labels: [],
    view: { at: 0, held: [...ids], capacity: 2, body: { hunger: 'hungry', thirst: 'thirsty', digestion: 'empty' },
      objects: ids.map(id => ({ id, appearance: clone(appearance), count: 4, observedAt: 0 })) } };
  observeReusableMaterials(sensor, { view: f.view, observationAt: 0, observedIds: ids });
  return f;
}
function at(f, time) {
  f.at = time; f.view.at = time;
  if (f.memory.clockAt < time) advanceTemporalClock(f.memory, time);
}
function push(f, labels) { f.labels.push(labels); return labels; }
function begin(f, action) {
  const context = temporalContext({ body: f.view.body, appearance: f.view.objects.find(o => o.id === action.targetId)?.appearance,
    relation: action.targetId ? f.view.held.includes(action.targetId) ? 'held' : 'reach' : 'unknown', heldCount: f.view.held.length });
  const seq = beginTemporalDecision(f.memory, { at: f.at, action, context });
  push(f, observeReusableSubmission(f.sensor, { memory: f.memory, seq, view: clone(f.view) }));
  return seq;
}
function complete(f, seq, { duration = 1, result = { ok: true, code: 'DONE' } } = {}) {
  const receipt = f.memory.receipts.find(r => r.seq === seq);
  at(f, receipt.at + duration);
  assert.equal(completeTemporalDecision(f.memory, { seq, at: f.at, actionId: f.nextAction++, result: { durationSeconds: duration, workedSeconds: duration, ...result } }), true);
  return push(f, observeReusableCompletion(f.sensor, { memory: f.memory, seq, view: clone(f.view) }));
}
function swallow(f, id = 'object:1') {
  const seq = begin(f, { type: 'sample', targetId: id });
  complete(f, seq, { result: { ok: true, code: 'SWALLOWED', ingestionId: `ingestion:${f.nextIngestion++}` } });
  return f.memory.ingestions.at(-1);
}
function event(f, ingestion, age, fields = { effect: 'sustained' }, number = f.nextFeedback++) {
  at(f, ingestion.at + age);
  const e = { id: `feedback:${number}`, at: f.at, provenance: 'sampled', ingestionId: ingestion.id,
    objectId: ingestion.objectId, actionId: ingestion.actionId, ...fields };
  const before = snapshotReusableFeedback(f.memory, e);
  const owned = recordTemporalFeedback(f.memory, e, { now: f.at });
  const labels = push(f, recordReusableFeedback(f.sensor, { before, memory: f.memory, event: e, now: f.at }));
  return { e, before, owned, labels };
}
function risk(f, channel) { return f.labels.flatMap(l => l.exposureUpdates).flatMap(x => x.increments).filter(i => i.channel === channel).reduce((a, i) => a + i.riskSeconds, 0); }
function events(f, channel) { return f.labels.flatMap(l => l.exposureUpdates).flatMap(x => x.increments).filter(i => i.channel === channel).reduce((a, i) => a + i.events, 0); }
function support(f, id = 'object:1') { return reusableMaterialSupport(f.sensor, { memory: f.memory, view: f.view, objectId: id }); }
function observe(f, ids, app = null) {
  for (const o of f.view.objects) if (ids.includes(o.id)) { o.observedAt = f.at; if (app) o.appearance = clone(app); }
  observeReusableMaterials(f.sensor, { view: f.view, observationAt: f.at, observedIds: ids });
}

test('valid unowned proof supervises once without any reward or reward owner', () => {
  const f = fixture(), i = swallow(f); f.memory.open = null;
  const totals = clone(f.memory.totals), result = event(f, i, 30);
  assert.equal(result.owned, false); assert.deepEqual(f.memory.totals, totals); assert.equal(f.memory.events.length, 0);
  assert.deepEqual(f.sensor.totals, [1, 0, 0]); assert.equal(events(f, 'F'), 1); close(risk(f, 'F'), 30);
  assert.equal(f.sensor.events[0].rewardOwned, false);
  const raw = JSON.stringify(f.sensor);
  push(f, recordReusableFeedback(f.sensor, { before: result.before, memory: f.memory, event: result.e, now: f.at }));
  assert.equal(JSON.stringify(f.sensor), raw); assert.equal(events(f, 'F'), 1);
});

test('combined benefit closes F/W only; later H has independent real risk and timestamp', () => {
  const f = fixture(), i = swallow(f);
  event(f, i, 45, { effect: 'sustained', thirst: 'easing' });
  assert.deepEqual(f.memory.totals, [1, 1, 0]);
  at(f, i.at + 180); push(f, advanceReusableSensor(f.sensor, { memory: f.memory, at: f.at }));
  event(f, i, 600, { effect: 'discomfort' });
  assert.deepEqual(f.sensor.totals, [1, 1, 1]);
  close(risk(f, 'F'), 45); close(risk(f, 'W'), 45); close(risk(f, 'H'), 600);
  assert.equal(f.sensor.events.at(-1).at, i.at + 600);
  const positive = f.labels.flatMap(l => l.exposureUpdates).flatMap(x => x.increments).filter(x => x.events);
  assert.deepEqual(positive.map(x => [x.channel, x.bin]), [['F', 0], ['W', 0], ['H', 2]]);
  const previous = JSON.stringify(f.sensor); push(f, advanceReusableSensor(f.sensor, { memory: f.memory, at: f.at }));
  assert.equal(JSON.stringify(f.sensor), previous);
});

for (const [age, bin] of [[45, 0], [180, 1], [600, 2]]) test(`event endpoint ${age} uses interval ${bin} with positive risk`, () => {
  const f = fixture(), i = swallow(f); const result = event(f, i, age);
  const rows = result.labels.exposureUpdates.flatMap(x => x.increments);
  assert.equal(rows.find(x => x.events).bin, bin);
  assert.ok(rows.filter(x => x.channel === 'F' && x.bin === bin).reduce((a, x) => a + x.riskSeconds, 0) > 0);
  close(risk(f, 'F'), age);
});

test('global and ingestion credit blocks prevent labels even when ledger installs a proof', () => {
  for (const global of [true, false]) {
    const f = fixture(), i = swallow(f);
    if (global) f.memory.creditBlocked = true; else i.creditBlocked = true;
    const result = event(f, i, 30);
    assert.equal(result.owned, false); assert.equal(events(f, 'F'), 0); assert.equal(risk(f, 'H'), 0);
    assert.equal(f.sensor.exposures[0].censored, 7);
    assert.equal(i.channels, global ? 0 : 1);
  }
});

test('lost canonical swallow receipt cannot supervise and does not fabricate survival', () => {
  const f = fixture(), i = swallow(f); f.memory.receipts = [];
  event(f, i, 30);
  assert.deepEqual(f.sensor.totals, [0, 0, 0]); assert.equal(risk(f, 'H'), 0); assert.equal(f.sensor.exposures[0].censored, 7);
});

test('future callback rejection consumes dedup cursor and censors instead of adding risk', () => {
  const f = fixture(), i = swallow(f); at(f, 10);
  const e = { id: 'feedback:1', at: 11, provenance: 'sampled', ingestionId: i.id, objectId: i.objectId, actionId: i.actionId, effect: 'sustained' };
  const before = snapshotReusableFeedback(f.memory, e);
  assert.equal(recordTemporalFeedback(f.memory, e, { now: 10 }), false);
  push(f, recordReusableFeedback(f.sensor, { before, memory: f.memory, event: e, now: 10 }));
  assert.equal(f.sensor.feedbackCursor, 1); assert.equal(risk(f, 'F'), 0); assert.equal(events(f, 'F'), 0);
  assert.equal(f.sensor.exposures[0].censored, 7);
});

test('zero-age report preserves ledger handling but stops unsupported rate prediction', () => {
  const f = fixture(), i = swallow(f); const result = event(f, i, 0);
  assert.equal(result.owned, true); assert.deepEqual(f.memory.totals, [1, 0, 0]);
  assert.equal(f.sensor.integrityFailure, 'zero-age-event'); assert.equal(events(f, 'F'), 0);
  assert.equal(risk(f, 'F'), 0); assert.equal(f.sensor.exposures[0].censored, 7);
});

test('competing pending ingestions keep bindings and channel risk independent', () => {
  const f = fixture(['object:1', 'object:2']), first = swallow(f, 'object:1'), second = swallow(f, 'object:2');
  event(f, second, 30, { thirst: 'easing' }); event(f, first, 45);
  assert.deepEqual(f.sensor.exposures.map(e => e.admitted), [1, 2]);
  assert.deepEqual(f.sensor.events.map(e => e.ingestionId), [second.id, first.id]);
  assert.equal(support(f, 'object:1').W, false); assert.equal(support(f, 'object:2').F, false);
  assert.equal(events(f, 'F'), 1); assert.equal(events(f, 'W'), 1);
  close(risk(f, 'H'), 45 + 44);
});

test('flush before proof eviction includes only truly covered time and censors open channels', () => {
  const f = fixture(), i = swallow(f); event(f, i, 20);
  at(f, i.at + 40);
  push(f, beforeReusableProofEviction(f.sensor, { memory: f.memory, at: f.at, receiptSeqs: [i.seq] }));
  f.memory.receipts = []; f.memory.ingestions = [];
  at(f, i.at + 100); push(f, advanceReusableSensor(f.sensor, { memory: f.memory, at: f.at }));
  close(risk(f, 'F'), 20); close(risk(f, 'W'), 40); close(risk(f, 'H'), 40);
  assert.deepEqual(f.sensor.exposures[0].riskThroughAt, [i.at + 20, i.at + 40, i.at + 40]);
  assert.equal(f.sensor.exposures[0].censored, 6); assert.equal(support(f).F, false);
});

test('native-clock notes are O(1) factual coverage and same-clock reopen never trains', () => {
  const f = fixture(), i = swallow(f); at(f, i.at + 10); noteReusableNativeClock(f.sensor, { at: f.at });
  const raw = clone(f.sensor), restored = validateReusableOutcomeSensor(raw, { memory: f.memory, view: f.view, at: f.at, continuous: true });
  assert.deepEqual(restored, raw); assert.equal(restored.updateSequence, raw.updateSequence); close(risk(f, 'H'), 0);
  f.sensor = restored; push(f, advanceReusableSensor(f.sensor, { memory: f.memory, at: f.at }));
  close(risk(f, 'H'), 10);
  const unchanged = clone(f.sensor); push(f, advanceReusableSensor(f.sensor, { memory: f.memory, at: f.at })); assert.deepEqual(f.sensor, unchanged);
});

test('unproved reopen gap censors every remaining channel with no zero or training update', () => {
  const f = fixture(), i = swallow(f); event(f, i, 20);
  const raw = clone(f.sensor); at(f, f.at + 10);
  f.sensor = validateReusableOutcomeSensor(raw, { memory: f.memory, view: f.view, at: f.at });
  assert.equal(f.sensor.updateSequence, raw.updateSequence); assert.equal(f.sensor.exposures[0].censored, 6);
  const labels = advanceReusableSensor(f.sensor, { memory: f.memory, at: f.at });
  assert.deepEqual(labels, { exposureUpdates: [], receiptUpdates: [], intervalUpdates: [] });
});

test('F/W support is exact, channel-specific and independent from need or count', () => {
  const f = fixture(['object:1', 'object:2']), i = swallow(f); event(f, i, 30, { thirst: 'easing' });
  assert.equal(support(f).F, false); assert.equal(support(f).W, true); assert.equal(support(f, 'object:2').W, false);
  f.view.body.hunger = 'content'; f.view.objects[0].count = 1; observe(f, ['object:1', 'object:2']);
  assert.equal(support(f).W, true); assert.equal(support(f).generation, 0);
  f.view.held = []; observe(f, ['object:1', 'object:2']); assert.equal(support(f).W, true);
  f.view.held = ['object:1']; observe(f, ['object:1', 'object:2']); assert.equal(support(f).W, true);
});

test('missing visibility is unknown; current fresh same-state proof is explicit; observed change invalidates old generation', () => {
  const f = fixture(), i = swallow(f); event(f, i, 30);
  observe(f, []); assert.equal(support(f).F, false); assert.equal(support(f).unknown, true);
  at(f, f.at + 1); observe(f, ['object:1']); assert.equal(support(f).F, true);
  at(f, f.at + 1); observe(f, ['object:1'], { ...appearance, smell: 'sharp' }); assert.equal(support(f).F, false); assert.equal(support(f).generation, 1);
  at(f, f.at + 1); observe(f, ['object:1'], appearance); assert.equal(support(f).F, false); assert.equal(support(f).generation, 2);
});

test('feature builder ignores nuisance/history but retains relevant actual operation work', () => {
  const f = fixture(), action = { type: 'sample', targetId: 'object:1' };
  const first = reusableCandidateFeatures(f.sensor, { memory: f.memory, view: f.view, action });
  const strike = begin(f, { type: 'strike', targetId: 'object:1' }); complete(f, strike);
  const afterStrike = reusableCandidateFeatures(f.sensor, { memory: f.memory, view: f.view, action });
  assert.equal(afterStrike.workBand, first.workBand);
  swallow(f);
  const afterSample = reusableCandidateFeatures(f.sensor, { memory: f.memory, view: f.view, action });
  assert.equal(afterSample.workBand, '1'); assert.equal(afterSample.freeSlotBand, '1');
  const before = JSON.stringify(f); for (let n = 0; n < 10; n++) reusableCandidateFeatures(f.sensor, { memory: f.memory, view: f.view, action });
  assert.equal(JSON.stringify(f), before);
});

test('physical and cost receipts count independently and never receive old-exposure F/W/H', () => {
  const f = fixture(), i = swallow(f); const wait = begin(f, { type: 'wait', seconds: 20 });
  complete(f, wait, { duration: 20 }); event(f, i, 30);
  const next = begin(f, { type: 'wait', seconds: 1 });
  const labels = f.labels.at(-1); assert.equal(labels.intervalUpdates.length, 1);
  close(labels.intervalUpdates[0].T, temporalIntegral(0, 30));
  assert.deepEqual(Object.keys(labels.intervalUpdates[0]).sort(), ['E', 'T', 'at', 'features', 'sequence']);
  assert.equal(f.labels.flatMap(l => l.receiptUpdates).length, 2);
  assert.deepEqual(observeReusableSubmission(f.sensor, { memory: f.memory, seq: next, view: f.view }), { exposureUpdates: [], receiptUpdates: [], intervalUpdates: [] });
});

test('unknown context interval cannot fabricate a zero cost target', () => {
  const f = fixture(); const first = begin(f, { type: 'wait' }); complete(f, first);
  f.memory.open.unknownContext = true; f.memory.open.key = null;
  begin(f, { type: 'wait' }); assert.equal(f.labels.at(-1).intervalUpdates.length, 0);
});

test('source-production identity never inherits a material benefit', () => {
  const f = fixture(['object:1', 'object:2']); f.view.held = ['object:2'];
  const pull = begin(f, { type: 'pull', targetId: 'object:1' });
  complete(f, pull, { result: { ok: true, code: 'MATERIAL_PRODUCED', materialId: 'object:2' } });
  const i = swallow(f, 'object:2'); event(f, i, 30);
  assert.equal(support(f, 'object:2').F, true); assert.equal(support(f, 'object:1').F, false);
  const effects = f.labels.flatMap(l => l.receiptUpdates)[0].effects; assert.equal(effects.output, true); assert.equal(effects.held, true);
});

test('bounded >400 decisions preserve durable cursors despite receipt and event eviction', () => {
  const f = fixture(); let oldEvent;
  for (let n = 0; n < 410; n++) {
    const i = swallow(f); const result = event(f, i, 1); oldEvent ||= result;
  }
  assert.equal(f.sensor.receipts.length, 384); assert.equal(f.sensor.exposures.length, 64); assert.equal(f.sensor.events.length, 64);
  assert.equal(f.memory.receipts.length, 384); assert.equal(f.memory.ingestions.length, 64);
  assert.deepEqual(f.sensor.totals, [410, 0, 0]); assert.equal(f.sensor.feedbackCursor, 410);
  const raw = clone(f.sensor); f.sensor = validateReusableOutcomeSensor(raw, { memory: f.memory, view: f.view, at: f.at, continuous: true });
  const before = JSON.stringify(f.sensor);
  recordReusableFeedback(f.sensor, { before: oldEvent.before, memory: f.memory, event: oldEvent.e, now: f.at });
  assert.equal(JSON.stringify(f.sensor), before); assert.equal(f.sensor.feedbackCursor, 410);
});

test('strict restore rejects extra executable fields, invalid numbers, forged masks and oversized data', () => {
  const f = fixture(), i = swallow(f); event(f, i, 30);
  const raw = clone(f.sensor), restore = value => validateReusableOutcomeSensor(value, { memory: f.memory, view: f.view, at: f.at, continuous: true });
  assert.deepEqual(restore(raw), raw);
  for (const change of [x => { x.code = 'arbitrary'; }, x => { x.clockAt = NaN; }, x => { x.exposures[0].admitted = 3; },
    x => { x.exposures[0].channelProof[0].sourceSeq = 999; }, x => { x.exposures[0].appearance.hiddenKind = 'food'; },
    x => { x.receipts = Array.from({ length: 385 }, () => x.receipts[0]); }, x => { x.receipts[0].features.operation = 'execute'; }, x => { x.exposures.extra = 'unlisted'; },
    x => { delete x.exposures[0].riskThroughAt[1]; }, x => { delete x.totals[1]; }]) {
    const altered = clone(raw); change(altered); assert.throws(() => restore(altered), /Reusable sensor:/);
  }
});

test('opaque ID bijection changes bindings only; numerical labels are bit-identical', () => {
  const make = id => { const f = fixture([id]); const i = swallow(f, id); event(f, i, 45); return f; };
  const a = make('object:1'), b = make('object:987654');
  assert.deepEqual(a.labels, b.labels); assert.deepEqual(support(a, 'object:1'), support(b, 'object:987654'));
  assert.notDeepEqual(a.sensor.events, b.sensor.events);
});


test('all sensor batches feed model atomically with exact finite endpoint rates', () => {
  const f = fixture(), i = swallow(f);
  event(f, i, 45, { effect: 'sustained', thirst: 'easing' });
  event(f, i, 600, { effect: 'discomfort' });
  begin(f, { type: 'wait' });
  const model = createReusableOutcomeModel();
  for (const labels of f.labels) {
    for (const row of labels.receiptUpdates) updatePhysicalReceipt(model, row);
    for (const row of labels.intervalUpdates) updatePhysicalInterval(model, row);
    for (const row of labels.exposureUpdates) updateExposure(model, row);
  }
  assert.equal(model.cursors.exposure.sequence, f.sensor.updateSequence);
  const before = JSON.stringify(model);
  for (const labels of f.labels) for (const row of labels.exposureUpdates) updateExposure(model, row);
  assert.equal(JSON.stringify(model), before);
});

test('frozen numerical control still acquires identical factual channel support', () => {
  const online = fixture(), frozen = fixture();
  const a = swallow(online), b = swallow(frozen);
  const m = createReusableOutcomeModel(), fixed = createReusableOutcomeModel();
  for (const f of [online, frozen]) {
    const target = f === online ? m : fixed;
    for (const labels of f.labels) {
      for (const row of labels.receiptUpdates) updatePhysicalReceipt(target, row);
      for (const row of labels.exposureUpdates) updateExposure(target, row);
    }
  }
  const checkpoint = JSON.stringify(fixed);
  const learned = event(online, a, 30), ignored = event(frozen, b, 30);
  for (const row of learned.labels.exposureUpdates) updateExposure(m, row);
  assert.deepEqual(online.sensor, frozen.sensor); assert.deepEqual(learned.labels, ignored.labels);
  assert.equal(support(online).F, true); assert.equal(support(frozen).F, true);
  assert.equal(JSON.stringify(fixed), checkpoint); assert.notEqual(JSON.stringify(m), checkpoint);
});

test('missed callback censors only its own channel and never recreates its label', () => {
  const f = fixture(), i = swallow(f); at(f, i.at + 30);
  const e = { id: 'feedback:1', at: f.at, provenance: 'sampled', ingestionId: i.id, objectId: i.objectId, actionId: i.actionId, effect: 'sustained' };
  recordTemporalFeedback(f.memory, e, { now: f.at });
  push(f, advanceReusableSensor(f.sensor, { memory: f.memory, at: f.at }));
  assert.equal(f.sensor.exposures[0].censored, 1); assert.equal(events(f, 'F'), 0);
  close(risk(f, 'F'), 0); close(risk(f, 'H'), 30);
  event(f, i, 60, { effect: 'discomfort' }, 2);
  assert.equal(events(f, 'H'), 1); close(risk(f, 'H'), 60);
});

test('action-local cached refresh is unknown until a genuine observation batch', () => {
  const f = fixture(), i = swallow(f); event(f, i, 30);
  const seq = begin(f, { type: 'inspect_object', targetId: 'object:1' });
  f.view.objects[0].observedAt = f.at + 1;
  complete(f, seq);
  assert.equal(support(f).F, false); assert.equal(f.sensor.materials[0].known, false);
  assert.deepEqual(validateReusableOutcomeSensor(f.sensor, { memory: f.memory, view: f.view, at: f.at, continuous: true }), f.sensor);
  observe(f, ['object:1']); assert.equal(support(f).F, true);
});


test('restore cross-checks event chronology/identity, admission totals and durable open risk watermark', () => {
  const f = fixture(), i = swallow(f); event(f, i, 30);
  const raw = clone(f.sensor), restore = value => validateReusableOutcomeSensor(value, { memory: f.memory, view: f.view, at: f.at, continuous: true });
  for (const change of [x => { x.events[0].at = 0; }, x => { x.events[0].ingestionId = 'ingestion:999'; },
    x => { x.totals[0] = 0; }, x => { x.exposures[0].riskThroughAt[2] = i.at; },
    x => { x.lastRiskAt = i.at; x.exposures[0].riskThroughAt[1] = i.at; x.exposures[0].riskThroughAt[2] = i.at; }]) {
    const altered = clone(raw); change(altered); assert.throws(() => restore(altered), /Reusable sensor:/);
  }
  at(f, f.at + 10); noteReusableNativeClock(f.sensor, { at: f.at });
  const reopened = validateReusableOutcomeSensor(f.sensor, { memory: f.memory, view: f.view, at: f.at, continuous: true });
  assert.equal(reopened.clockAt, 41); assert.equal(reopened.lastRiskAt, 31);
  const labels = advanceReusableSensor(reopened, { memory: f.memory, at: f.at });
  close(labels.exposureUpdates.flatMap(x => x.increments).filter(x => x.channel === 'H').reduce((a, x) => a + x.riskSeconds, 0), 10);
});

test('restore rejects accessor and proxy graphs without invoking payload code', () => {
  const f = fixture(), i = swallow(f); event(f, i, 30);
  let calls = 0;
  for (const target of ['clock', 'nested', 'proxy']) {
    const raw = clone(f.sensor);
    if (target === 'clock') Object.defineProperty(raw, 'clockAt', { enumerable: true, get() { calls++; return f.at; } });
    if (target === 'nested') Object.defineProperty(raw.exposures[0].appearance, 'shape', { enumerable: true, get() { calls++; return 'round'; } });
    const input = target === 'proxy' ? new Proxy(raw, { ownKeys(t) { calls++; return Reflect.ownKeys(t); } }) : raw;
    assert.throws(() => validateReusableOutcomeSensor(input, { memory: f.memory, view: f.view, at: f.at, continuous: true }), /Reusable sensor:/);
    assert.equal(calls, 0);
  }
});


test('evicted relevant work is unknown rather than an invented zero-work target', () => {
  const f = fixture(), action = { type: 'sample', targetId: 'object:1' }; swallow(f);
  assert.equal(reusableCandidateFeatures(f.sensor, { memory: f.memory, view: f.view, action }).workBand, '1');
  for (let n = 0; n < 385; n++) { const seq = begin(f, { type: 'wait' }); complete(f, seq); }
  assert.equal(f.memory.receipts.some(r => r.request.type === 'sample'), false);
  assert.equal(f.memory.historyCensored, true);
  assert.equal(reusableCandidateFeatures(f.sensor, { memory: f.memory, view: f.view, action }).workBand, 'unknown');
});

test('full 128-event cap retains only provable diagnostics and cursor survives event eviction', () => {
  const f = fixture(); let oldest;
  for (let n = 0; n < 64; n++) {
    const i = swallow(f); oldest ||= event(f, i, 1);
    if (n) event(f, i, 1);
    event(f, i, 2, { thirst: 'easing' }); event(f, i, 3, { effect: 'discomfort' });
  }
  assert.equal(f.sensor.exposures.length, 64); assert.equal(f.sensor.events.length, 128);
  assert.deepEqual(f.sensor.totals, [64, 64, 64]); assert.equal(f.sensor.feedbackCursor, 192);
  const restored = validateReusableOutcomeSensor(f.sensor, { memory: f.memory, view: f.view, at: f.at, continuous: true });
  assert.deepEqual(restored, f.sensor);
  const before = JSON.stringify(restored);
  recordReusableFeedback(restored, { before: oldest.before, memory: f.memory, event: oldest.e, now: f.at });
  assert.equal(JSON.stringify(restored), before);
});
