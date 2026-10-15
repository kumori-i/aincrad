import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTemporalLedger, beginTemporalDecision, advanceTemporalClock,
  completeTemporalDecision, recordTemporalFeedback, validateTemporalLedger,
} from '../src/temporal-ledger.js';
import { temporalKey, temporalIntegral, trainTemporalReturns } from '../src/temporal-returns.js';

// Synthetic public receipts isolate ledger mathematics and persistence. They are
// not engine evidence, autonomous behavior, food-learning success, or physiology.
const BETA = Math.log(2) / 300;
const discount = seconds => Math.exp(-BETA * seconds);
const integral = (from, to, rate = 1) => rate * (Math.exp(-BETA * from) - Math.exp(-BETA * to)) / (60 * BETA);
const clone = value => JSON.parse(JSON.stringify(value));
const context = { body: { hunger: 'hungry', thirst: 'thirsty' }, relation: 'held', heldCount: 1 };
function close(actual, expected, label = 'value') {
  assert.ok(Math.abs(actual - expected) <= 1e-11 * Math.max(1, Math.abs(expected)), `${label}: ${actual} != ${expected}`);
}
function submit(memory, at, type = 'wait', extra = {}) {
  return beginTemporalDecision(memory, { at, context, action: { type, ...extra } });
}
function swallow(memory, { at = memory.clockAt, index = 1, targetId = `object:${index}` } = {}) {
  const seq = submit(memory, at, 'sample', { targetId });
  assert.equal(completeTemporalDecision(memory, {
    seq, at, actionId: index,
    result: { ok: true, code: 'SWALLOWED', durationSeconds: 0, ingestionId: `ingestion:${index}`, materialId: targetId },
  }), true);
  return { seq, ingestionId: `ingestion:${index}`, objectId: targetId, actionId: index };
}
function feedback(binding, sourceSeq, at, extra = {}) {
  return { id: `feedback:${sourceSeq}`, at, provenance: 'sampled', ingestionId: binding.ingestionId,
    objectId: binding.objectId, actionId: binding.actionId, effect: 'sustained', ...extra };
}
function roundTrip(memory, elapsed = memory.clockAt) {
  return validateTemporalLedger(clone(memory), elapsed);
}
function positiveFixture({ closed = false } = {}) {
  const memory = createTemporalLedger(), binding = swallow(memory);
  assert.equal(recordTemporalFeedback(memory, feedback(binding, 1, 1), { now: 1 }), true);
  if (closed) submit(memory, 2);
  return { memory, binding };
}
function positiveReplay(memory) {
  return memory.model.transitions.filter(t => t.reward.slice(0, 3).some(v => v > 0));
}
function assertCanonicalOrder(rows, key, label) {
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i - 1][key] < rows[i][key], `${label} must have strictly increasing ${key}`);
    assert.ok(rows[i - 1].at <= rows[i].at, `${label} must have nondecreasing time`);
    assert.ok(rows[i - 1].order < rows[i].order, `${label} must have strictly increasing event order`);
  }
}

test('combined ingestion messages admit each F/W/H channel once without erasing earlier harm', () => {
  let memory = createTemporalLedger();
  const binding = swallow(memory);
  assert.equal(recordTemporalFeedback(memory, feedback(binding, 1, 10, { effect: 'water relief', thirst: 'easing' }), { now: 10 }), true);
  assert.equal(recordTemporalFeedback(memory, feedback(binding, 2, 20, { effect: 'discomfort', thirst: 'easing' }), { now: 20 }), true);
  assert.equal(recordTemporalFeedback(memory, feedback(binding, 3, 30, { thirst: 'easing' }), { now: 30 }), true);
  assert.deepEqual(memory.totals, [1, 1, 1]);
  assert.deepEqual(memory.events.map(e => e.channels), [2, 4, 1]);
  assert.equal(memory.ingestions[0].channels, 7);
  assert.equal(recordTemporalFeedback(memory, feedback(binding, 4, 30, { thirst: 'easing' }), { now: 30 }), false);
  memory = roundTrip(memory);
  assert.equal(recordTemporalFeedback(memory, feedback(binding, 5, 31, { effect: 'discomfort', thirst: 'easing' }), { now: 31 }), false);
  assert.deepEqual(memory.totals, [1, 1, 1]);
  close(memory.open.reward[0], discount(30), 'F at its actual report time');
  close(memory.open.reward[1], discount(10), 'W at its actual report time');
  close(memory.open.reward[2], discount(20), 'H remains after later benefit');
});

test('source cursor survives 270 events, payload eviction, old replay and an unproved late channel', () => {
  let memory = createTemporalLedger(), oldest;
  for (let i = 1; i <= 270; i++) {
    const binding = swallow(memory, { index: i, at: i });
    const event = feedback(binding, i, i);
    if (i === 1) oldest = event;
    assert.equal(recordTemporalFeedback(memory, event, { now: i }), true);
  }
  assert.equal(memory.feedbackCursor, 270);
  assert.deepEqual(memory.totals, [270, 0, 0]);
  assert.ok(memory.events.length <= 256);
  assert.ok(memory.ingestions.length <= 256);
  assert.ok(!memory.ingestions.some(i => i.id === oldest.ingestionId));
  assert.ok(!memory.model.transitions.some(t => t.seq === 1), 'evicted ingestion proof censors its dependent segment');
  const model = clone(memory.model), before = clone(memory.totals);
  memory = roundTrip(memory);
  assert.equal(recordTemporalFeedback(memory, oldest, { now: 270 }), false);
  assert.deepEqual(memory.model, model, 'old replay never adds a visit or update');
  const censored = memory.censoredEvents;
  assert.equal(recordTemporalFeedback(memory, { ...oldest, id: 'feedback:271', at: 271, effect: 'discomfort' }, { now: 271 }), false);
  assert.ok(memory.censoredEvents > censored, 'unproved late credit is explicitly censored');
  assert.equal(memory.feedbackCursor, 271);
  memory = roundTrip(memory);
  advanceTemporalClock(memory, 300);
  assert.equal(recordTemporalFeedback(memory, { ...oldest, at: 300 }, { now: 300 }), false);
  assert.deepEqual(memory.totals, before);
});

test('future feedback is consumed as rejected history and cannot resurrect after two reopens', () => {
  let memory = createTemporalLedger();
  const binding = swallow(memory), event = feedback(binding, 1, 100);
  assert.equal(recordTemporalFeedback(memory, event, { now: 0 }), false);
  assert.equal(memory.feedbackCursor, 1);
  assert.equal(memory.events.length, 0);
  memory = roundTrip(memory);
  advanceTemporalClock(memory, 100);
  assert.equal(recordTemporalFeedback(memory, event, { now: 100 }), false);
  memory = roundTrip(memory);
  assert.equal(recordTemporalFeedback(memory, event, { now: 100 }), false);
  assert.deepEqual(memory.totals, [0, 0, 0]);
  assert.deepEqual(memory.open.reward.slice(0, 3), [0, 0, 0]);
});

test('feedback before the first submission stays unowned rather than rewarding the first action', () => {
  const memory = createTemporalLedger();
  const event = feedback({ ingestionId: 'ingestion:1', objectId: 'object:1', actionId: 1 }, 1, 5);
  assert.equal(recordTemporalFeedback(memory, event, { now: 5 }), false);
  const binding = swallow(memory, { at: 5 });
  assert.equal(recordTemporalFeedback(memory, { ...feedback(binding, 1, 5) }, { now: 5 }), false);
  submit(memory, 10);
  assert.deepEqual(memory.totals, [0, 0, 0]);
  assert.deepEqual(memory.model.transitions[0].reward.slice(0, 3), [0, 0, 0]);
});

test('malformed source identifiers never authorize credit or poison a valid monotone cursor', () => {
  for (const id of [undefined, null, '', 'feedback:no', 'feedback:-1', 'feedback:0', 'feedback:1.5', 'feedback:1000000001', 'instruction:1']) {
    const memory = createTemporalLedger(), binding = swallow(memory);
    assert.equal(recordTemporalFeedback(memory, feedback(binding, 1, 0, { id }), { now: 0 }), false, String(id));
    assert.equal(memory.feedbackCursor, 0);
    assert.deepEqual(memory.totals, [0, 0, 0]);
    assert.equal(memory.events.length, 0);
  }
});

test('a rejected source record still advances admission and old or reordered records stay rejected', () => {
  const memory = createTemporalLedger(), binding = swallow(memory);
  assert.equal(recordTemporalFeedback(memory, feedback(binding, 1, 1, { actionId: 999 }), { now: 1 }), false);
  assert.equal(memory.feedbackCursor, 1);
  assert.equal(recordTemporalFeedback(memory, feedback(binding, 1, 1), { now: 1 }), false);
  assert.equal(recordTemporalFeedback(memory, feedback(binding, 3, 3), { now: 3 }), true);
  assert.equal(recordTemporalFeedback(memory, feedback(binding, 2, 3, { effect: 'discomfort' }), { now: 3 }), false);
  assert.deepEqual(memory.totals, [1, 0, 0]);
});

test('zero-work refusals and successful non-work actions create no E and no success reward', () => {
  const memory = createTemporalLedger();
  for (const [type, result] of [
    ['sample', { ok: false, code: 'TOO_FULL', durationSeconds: 0, exertion: 'strenuous' }],
    ['grasp', { ok: false, code: 'OUT_OF_REACH', durationSeconds: 0 }],
    ['inspect_object', { ok: true, code: 'INSPECTED', durationSeconds: 0 }],
  ]) {
    const seq = submit(memory, 0, type, { targetId: 'object:1' });
    assert.equal(completeTemporalDecision(memory, { seq, at: 0, actionId: seq, result }), true);
    assert.deepEqual(memory.open.reward, [0, 0, 0, 0, 0]);
  }
  assert.deepEqual(memory.totals, [0, 0, 0]);
  assert.equal(memory.ingestions.length, 0);
});

test('ordinal work integrates only the actually worked portion, including worked physical failure', () => {
  for (const [exertion, rate] of [['light', 1 / 3], ['moderate', 2 / 3], ['strenuous', 1]]) {
    const memory = createTemporalLedger(), seq = submit(memory, 10, 'strike', { targetId: 'object:1' });
    advanceTemporalClock(memory, 70);
    assert.equal(completeTemporalDecision(memory, { seq, at: 70, actionId: 1,
      result: { ok: false, code: 'NO_VISIBLE_EFFECT', durationSeconds: 30, exertion } }), true);
    const work = memory.open.reward[4];
    close(work, integral(30, 60, rate), exertion);
    assert.equal(completeTemporalDecision(memory, { seq, at: 70, actionId: 1,
      result: { ok: true, code: 'DONE', durationSeconds: 30, exertion } }), false, 'duplicate completion is idempotent');
    close(memory.open.reward[4], work);
    submit(memory, 130);
    close(memory.model.transitions[0].reward[3], integral(0, 120), 'elapsed includes waiting');
    close(memory.model.transitions[0].reward[4], work, 'waiting is never worked time');
    assert.deepEqual(memory.model.transitions[0].reward.slice(0, 3), [0, 0, 0]);
  }
});

test('work with no sensed exertion label is unknown rather than fabricated E', () => {
  const memory = createTemporalLedger(), seq = submit(memory, 0, 'pull', { targetId: 'object:1' });
  advanceTemporalClock(memory, 30);
  completeTemporalDecision(memory, { seq, at: 30, actionId: 1, result: { ok: true, code: 'DONE', durationSeconds: 30 } });
  submit(memory, 60);
  close(memory.model.transitions[0].reward[3], integral(0, 60));
  assert.equal(memory.model.transitions[0].reward[4], 0);
});

test('all elapsed intervals and all five reward channels keep analytical discount composition', () => {
  const memory = createTemporalLedger(), binding = swallow(memory, { at: 20 });
  recordTemporalFeedback(memory, feedback(binding, 1, 50, { thirst: 'easing' }), { now: 50 });
  const seq = submit(memory, 80, 'strike', { targetId: 'object:1' });
  advanceTemporalClock(memory, 110);
  completeTemporalDecision(memory, { seq, at: 110, actionId: 2,
    result: { ok: true, code: 'NO_VISIBLE_EFFECT', durationSeconds: 15, exertion: 'moderate' } });
  recordTemporalFeedback(memory, feedback(binding, 2, 140, { effect: 'discomfort' }), { now: 140 });
  submit(memory, 200, 'rest');
  advanceTemporalClock(memory, 320);
  submit(memory, 320, 'say');
  const [a, b, c] = memory.model.transitions;
  close(a.reward[0], discount(30)); close(a.reward[1], discount(30));
  close(b.reward[2], discount(60)); close(b.reward[4], integral(15, 30, 2 / 3));
  close(a.reward[3] + discount(60) * b.reward[3] + discount(180) * c.reward[3], integral(0, 300), 'T splitting');
  close(discount(60) * b.reward[4], integral(75, 90, 2 / 3), 'E translation');
  close(discount(60) * b.reward[2], discount(120), 'H translation');
  assert.equal(memory.model.updateCount, 0, 'submission bookkeeping never silently runs training');
});

test('equal-timestamp feedback uses immutable before/after submission order and survives reopen', () => {
  let memory = createTemporalLedger();
  const first = swallow(memory), second = swallow(memory, { index: 2, at: 0 });
  assert.equal(recordTemporalFeedback(memory, feedback(first, 1, 10), { now: 10 }), true);
  const oldOwner = memory.open.seq;
  const newOwner = submit(memory, 10, 'rest');
  assert.equal(recordTemporalFeedback(memory, feedback(second, 2, 10, { effect: 'discomfort' }), { now: 10 }), true);
  const before = memory.events.find(e => e.sourceSeq === 1), after = memory.events.find(e => e.sourceSeq === 2);
  assert.equal(before.owner, oldOwner); assert.equal(after.owner, newOwner);
  assert.ok(before.order < memory.open.order && memory.open.order < after.order);
  memory = roundTrip(memory);
  assert.equal(memory.events.find(e => e.sourceSeq === 1).owner, oldOwner);
  assert.equal(memory.events.find(e => e.sourceSeq === 2).owner, newOwner);
  submit(memory, 20, 'observe');
  assert.ok(memory.model.transitions.find(t => t.seq === oldOwner).reward[0] > 0);
  assert.equal(memory.model.transitions.find(t => t.seq === oldOwner).reward[2], 0);
  assert.equal(memory.model.transitions.find(t => t.seq === newOwner).reward[0], 0);
  assert.equal(memory.model.transitions.find(t => t.seq === newOwner).reward[2], 1);
});

test('open-interval reopen adds no update, event or work and continued timing equals uninterrupted timing', () => {
  const memory = createTemporalLedger(), binding = swallow(memory);
  recordTemporalFeedback(memory, feedback(binding, 1, 10), { now: 10 });
  const seq = submit(memory, 20, 'strike', { targetId: 'object:1' });
  advanceTemporalClock(memory, 35);
  completeTemporalDecision(memory, { seq, at: 35, actionId: 2,
    result: { ok: true, code: 'NO_VISIBLE_EFFECT', durationSeconds: 15, exertion: 'light' } });
  recordTemporalFeedback(memory, feedback(binding, 2, 40, { effect: 'discomfort' }), { now: 40 });
  trainTemporalReturns(memory.model);
  const reopened = roundTrip(memory);
  assert.deepEqual(reopened, memory, 'reopen is an identity on valid canonical state');
  assert.deepEqual(roundTrip(reopened), reopened, 'repeated reopen has no training side effect');
  for (const candidate of [memory, reopened]) {
    advanceTemporalClock(candidate, 100);
    submit(candidate, 100, 'rest');
  }
  assert.deepEqual(reopened, memory);
});

test('persistent learned rows survive more than 800 decisions and both replay/proof eviction', () => {
  let { memory } = positiveFixture({ closed: true });
  trainTemporalReturns(memory.model);
  const key = temporalKey(context, 'sample'), learned = clone(memory.model.rows.find(row => row.key === key));
  assert.ok(learned.q[0] > 0);
  for (let i = 3; i <= 805; i++) {
    submit(memory, i, 'wait');
    if (i === 450) memory = roundTrip(memory);
  }
  assert.ok(memory.receipts.length <= 768);
  assert.ok(memory.model.transitions.length <= 512);
  assert.ok(!memory.receipts.some(r => r.seq === 1));
  assert.ok(!memory.model.transitions.some(t => t.seq === 1));
  assert.deepEqual(memory.model.rows.find(row => row.key === key), learned);
  const reopened = roundTrip(memory);
  assert.deepEqual(reopened.model.rows.find(row => row.key === key), learned);
  assert.equal(reopened.model.updateCount, memory.model.updateCount);
  assert.equal(reopened.nextSeq, memory.nextSeq);
  assert.equal(reopened.feedbackCursor, memory.feedbackCursor);
});

test('restore strips non-food instructions and hidden metadata at every canonical nesting level', () => {
  const { memory } = positiveFixture({ closed: true });
  const raw = clone(memory), forbidden = 'DO_NOT_RETAIN_PRIVATE_PAYLOAD';
  raw.instructions = forbidden; raw.hiddenPhysiology = { energy: forbidden };
  raw.model.instructions = forbidden;
  raw.model.rows[0].instructions = forbidden;
  raw.model.transitions[0].recipe = forbidden;
  raw.receipts[0].instructions = forbidden;
  raw.receipts[0].request.script = forbidden;
  raw.receipts[0].outcome.hiddenNutrition = forbidden;
  raw.ingestions[0].species = forbidden;
  raw.events[0].instructions = forbidden;
  raw.events[0].hiddenMetadata = { expectedOutcome: forbidden };
  raw.open.instructions = forbidden;
  const restored = roundTrip(raw);
  assert.ok(!JSON.stringify(restored).includes(forbidden), 'all restored objects use explicit field allowlists');
  assert.equal(restored.events.length, 1, 'sanitization retains otherwise valid public evidence');
  assert.equal(restored.open.seq, memory.open.seq);
});

test('unmatched ingestion/action receipts cannot leave positive replay or open reward after restore', () => {
  for (const closed of [false, true]) for (const mutation of ['action', 'ingestion', 'outcome', 'request', 'missing']) {
    const { memory } = positiveFixture({ closed });
    trainTemporalReturns(memory.model);
    const raw = clone(memory), rows = clone(raw.model.rows);
    if (mutation === 'action') raw.receipts[0].outcome.actionId = 999;
    if (mutation === 'ingestion') raw.receipts[0].outcome.ingestionId = 'ingestion:999';
    if (mutation === 'outcome') raw.receipts[0].outcome.code = 'REFUSED';
    if (mutation === 'request') raw.receipts[0].request.targetId = 'object:999';
    if (mutation === 'missing') raw.receipts = raw.receipts.slice(1);
    const restored = roundTrip(raw);
    assert.equal(restored.events.length, 0, `${mutation}: event has no canonical swallow proof`);
    assert.equal(positiveReplay(restored).length, 0, `${mutation}: unsupported replay must be censored`);
    assert.ok(!restored.open || restored.open.reward.slice(0, 3).every(v => v === 0), `${mutation}: unsupported open reward must be censored`);
    assert.deepEqual(restored.model.rows, rows, `${mutation}: learned parameters are not erased with bad replay`);
  }
});

test('future saved feedback is dropped with its reward and stays ineligible at its formerly future time', () => {
  let { memory, binding } = positiveFixture();
  const raw = clone(memory);
  raw.events[0].at = 100;
  memory = validateTemporalLedger(raw, 1);
  assert.equal(memory.events.length, 0);
  assert.ok(!memory.open || memory.open.reward[0] === 0, 'a future event cannot survive as cached reward');
  assert.equal(memory.feedbackCursor, 1);
  advanceTemporalClock(memory, 100);
  assert.equal(recordTemporalFeedback(memory, feedback(binding, 1, 100), { now: 100 }), false);
  memory = roundTrip(memory);
  assert.equal(recordTemporalFeedback(memory, feedback(binding, 1, 100), { now: 100 }), false);
  assert.equal(memory.events.length, 0);
});

test('restored event ownership cannot be reassigned to an earlier interval', () => {
  const memory = createTemporalLedger(), binding = swallow(memory);
  const actualOwner = submit(memory, 10, 'rest');
  recordTemporalFeedback(memory, feedback(binding, 1, 15), { now: 15 });
  submit(memory, 20, 'wait');
  const raw = clone(memory);
  raw.events[0].owner = binding.seq;
  const restored = roundTrip(raw);
  assert.ok(restored.events.every(e => e.owner === actualOwner), 'wrong-owner source payload must be discarded or canonically repaired');
  assert.ok(restored.model.transitions.filter(t => t.seq === binding.seq).every(t => t.reward[0] === 0));
});

test('restored equal-time owner is checked against submission order rather than timestamp alone', () => {
  const memory = createTemporalLedger(), binding = swallow(memory);
  recordTemporalFeedback(memory, feedback(binding, 1, 10), { now: 10 });
  const laterOwner = submit(memory, 10, 'rest');
  const raw = clone(memory);
  raw.events[0].owner = laterOwner;
  const restored = roundTrip(raw);
  assert.ok(restored.events.every(e => e.owner === binding.seq), 'event preceded the equal-time rest submission');
});

test('duplicate restored source records cannot add another event or channel', () => {
  const { memory } = positiveFixture();
  const raw = clone(memory);
  raw.events.push({ ...raw.events[0], channels: 2 });
  raw.ingestions[0].channels |= 2;
  const restored = roundTrip(raw);
  assert.ok(restored.events.length <= 1);
  assert.equal(new Set(restored.events.map(e => e.sourceSeq)).size, restored.events.length);
});

test('two distinct source records cannot claim the same ingestion/channel after restore', () => {
  const { memory } = positiveFixture();
  const raw = clone(memory);
  raw.feedbackCursor = 2;
  raw.eventOrder++;
  raw.events.push({ ...raw.events[0], id: 'feedback:2', sourceSeq: 2, order: raw.eventOrder });
  const restored = roundTrip(raw);
  for (const ingestion of restored.ingestions) {
    let channels = 0;
    for (const event of restored.events.filter(e => e.ingestionId === ingestion.id)) {
      assert.equal(channels & event.channels, 0, 'per-ingestion channel masks are disjoint across accepted source records');
      channels |= event.channels;
    }
  }
});

test('reordered saved source and submission arrays restore only canonical order', () => {
  const memory = createTemporalLedger(), binding = swallow(memory);
  recordTemporalFeedback(memory, feedback(binding, 1, 1, { effect: 'water relief', thirst: 'easing' }), { now: 1 });
  submit(memory, 2, 'rest');
  recordTemporalFeedback(memory, feedback(binding, 2, 3), { now: 3 });
  submit(memory, 4, 'wait');
  recordTemporalFeedback(memory, feedback(binding, 3, 5, { effect: 'discomfort' }), { now: 5 });
  const raw = clone(memory);
  raw.events.reverse(); raw.receipts.reverse();
  const restored = roundTrip(raw);
  assertCanonicalOrder(restored.events, 'sourceSeq', 'feedback');
  assertCanonicalOrder(restored.receipts, 'seq', 'submissions');
});

test('replay cannot invent successor requests or retain transitions without actual submission proof', () => {
  for (const mutation of ['missing predecessor', 'missing successor', 'changed successor', 'changed start', 'changed end']) {
    const { memory } = positiveFixture({ closed: true }), raw = clone(memory);
    if (mutation === 'missing predecessor') raw.receipts = raw.receipts.slice(1);
    if (mutation === 'missing successor') raw.receipts = raw.receipts.slice(0, 1);
    if (mutation === 'changed successor') raw.model.transitions[0].nextKey = temporalKey(context, 'sleep');
    if (mutation === 'changed start') raw.model.transitions[0].startAt = 0.5;
    if (mutation === 'changed end') raw.model.transitions[0].endAt = 1.5;
    const restored = roundTrip(raw);
    assert.equal(restored.model.transitions.length, 0, `${mutation}: unmatched transition must be censored`);
  }
});

test('duplicate canonical submission proof cannot mint another ingestion or reset channel eligibility', () => {
  const { memory, binding } = positiveFixture({ closed: true }), raw = clone(memory);
  raw.receipts.push(clone(raw.receipts[0]));
  raw.ingestions.push({ ...raw.ingestions[0], channels: 0 });
  const restored = roundTrip(raw);
  assert.equal(restored.receipts.filter(r => r.seq === binding.seq).length, 1);
  assert.equal(restored.ingestions.filter(i => i.id === binding.ingestionId).length, 1);
  assert.equal(recordTemporalFeedback(restored, feedback(binding, 2, 2), { now: 2 }), false);
  assert.deepEqual(restored.totals, [1, 0, 0]);
});

test('invalid numeric state is bounded and zero-valued valid counters survive restore', () => {
  const { memory } = positiveFixture();
  const raw = clone(memory);
  raw.totals = [NaN, -1, Infinity];
  raw.rejectedEvents = -1; raw.censoredEvents = Infinity;
  raw.open.reward = [0, 0, 0, 0, 0];
  const restored = validateTemporalLedger(raw, 1);
  assert.deepEqual(restored.totals, [0, 0, 0]);
  assert.equal(restored.rejectedEvents, 0); assert.equal(restored.censoredEvents, 0);
  assert.ok(JSON.stringify(restored).length < 8 * 1024 * 1024);
  const empty = roundTrip(createTemporalLedger());
  assert.equal(empty.clockAt, 0); assert.equal(empty.feedbackCursor, 0); assert.equal(empty.eventOrder, 0);
  assert.deepEqual(empty.totals, [0, 0, 0]);
});

test('event-payload eviction retains ingestion masks and admits only its genuinely unseen late channel', () => {
  let memory = createTemporalLedger(), oldest;
  for (let i = 1; i <= 129; i++) {
    const binding = swallow(memory, { index: i, at: i });
    if (i === 1) oldest = binding;
    assert.equal(recordTemporalFeedback(memory, feedback(binding, 2 * i - 1, i), { now: i }), true);
    assert.equal(recordTemporalFeedback(memory, feedback(binding, 2 * i, i, { effect: 'water relief', thirst: 'easing' }), { now: i }), true);
  }
  assert.equal(memory.events.length, 256);
  assert.equal(memory.ingestions.length, 129, 'mask proof survives shorter event-payload retention');
  assert.ok(!memory.events.some(e => e.ingestionId === oldest.ingestionId));
  assert.equal(memory.ingestions.find(i => i.id === oldest.ingestionId).channels, 3);
  memory = roundTrip(memory);
  assert.equal(recordTemporalFeedback(memory, feedback(oldest, 259, 130, { thirst: 'easing' }), { now: 130 }), false);
  assert.equal(recordTemporalFeedback(memory, feedback(oldest, 260, 131, { effect: 'discomfort' }), { now: 131 }), true);
  assert.deepEqual(memory.totals, [129, 129, 1]);
  memory = roundTrip(memory);
  assert.equal(recordTemporalFeedback(memory, feedback(oldest, 261, 132, { effect: 'discomfort' }), { now: 132 }), false);
  assert.deepEqual(memory.totals, [129, 129, 1]);
});

test('missing or corrupt source-order state cannot resurrect previously rejected future history', () => {
  for (const cursor of [undefined, null, -1, 'not a cursor', NaN]) {
    const { memory, binding } = positiveFixture();
    const future = feedback(binding, 2, 100, { effect: 'discomfort' });
    assert.equal(recordTemporalFeedback(memory, future, { now: 1 }), false);
    const raw = clone(memory);
    if (cursor === undefined) delete raw.feedbackCursor; else raw.feedbackCursor = cursor;
    let restored = validateTemporalLedger(raw, 1);
    advanceTemporalClock(restored, 100);
    assert.equal(recordTemporalFeedback(restored, future, { now: 100 }), false,
      `${String(cursor)}: incomplete source-order metadata must fail closed`);
    assert.deepEqual(restored.totals, [1, 0, 0]);
    const rows = clone(restored.model.rows);
    restored = roundTrip(restored);
    assert.equal(restored.creditBlocked, true, 'credit block is durable rather than healed by serializing its new cursor');
    assert.equal(recordTemporalFeedback(restored, { ...future, id: 'feedback:3' }, { now: 100 }), false);
    assert.deepEqual(restored.totals, [1, 0, 0]);
    assert.deepEqual(restored.model.rows, rows);
  }
});

test('restore rejects feedback chronology inconsistent with authoritative source and emission order', () => {
  for (const mutation of ['time', 'order']) {
    const memory = createTemporalLedger(), binding = swallow(memory);
    recordTemporalFeedback(memory, feedback(binding, 1, 1, { effect: 'water relief', thirst: 'easing' }), { now: 1 });
    recordTemporalFeedback(memory, feedback(binding, 2, 2), { now: 2 });
    const raw = clone(memory);
    if (mutation === 'time') {
      raw.events[1].at = 0.5;
      raw.ingestions[0].channelProof[0].at = 0.5;
    } else raw.events[1].order = raw.events[0].order;
    const restored = roundTrip(raw);
    assertCanonicalOrder(restored.events, 'sourceSeq', `inconsistent ${mutation}`);
  }
});

test('submission sequence cap fails closed without reusing a prior decision after reopen', () => {
  let memory = createTemporalLedger();
  memory.nextSeq = 1e9 - 1;
  assert.equal(submit(memory, 0), 1e9 - 1);
  assert.equal(memory.nextSeq, 1e9);
  const before = clone(memory);
  assert.throws(() => submit(memory, 1), RangeError);
  assert.deepEqual(memory, before, 'exhausted submission leaves existing experience untouched');
  memory = roundTrip(memory);
  assert.equal(memory.nextSeq, 1e9);
  assert.throws(() => submit(memory, 1), RangeError);
  assert.deepEqual(memory.receipts, before.receipts);
});

test('event-order cap cannot create work, feedback, elapsed time or a wrapped submission', () => {
  let memory = createTemporalLedger();
  memory.eventOrder = 1e9 - 2;
  const binding = swallow(memory);
  assert.equal(recordTemporalFeedback(memory, feedback(binding, 1, 0), { now: 0 }), true);
  assert.equal(memory.eventOrder, 1e9);
  const before = clone(memory);
  assert.throws(() => advanceTemporalClock(memory, 1), RangeError);
  assert.deepEqual(memory, before);
  assert.throws(() => submit(memory, 1), RangeError);
  assert.deepEqual(memory, before);
  assert.throws(() => recordTemporalFeedback(memory, feedback(binding, 2, 0, { effect: 'discomfort' }), { now: 0 }), RangeError);
  assert.deepEqual(memory.totals, [1, 0, 0]);
  assert.deepEqual(memory.events, before.events);
  assert.deepEqual(memory.open.reward, before.open.reward);
  assert.equal(memory.feedbackCursor, 2, 'examined source remains consumed despite exhausted event order');
  memory = roundTrip(memory);
  assert.equal(memory.eventOrder, 1e9);
  assert.equal(recordTemporalFeedback(memory, feedback(binding, 2, 0, { effect: 'discomfort' }), { now: 0 }), false);
  assert.deepEqual(memory.totals, [1, 0, 0]);
});

test('source cursor accepts its last bounded value once and never wraps on larger identifiers', () => {
  let memory = createTemporalLedger();
  const binding = swallow(memory);
  assert.equal(recordTemporalFeedback(memory, feedback(binding, 1e9, 0), { now: 0 }), true);
  assert.equal(memory.feedbackCursor, 1e9);
  assert.equal(recordTemporalFeedback(memory, feedback(binding, 1e9 + 1, 0, { effect: 'discomfort' }), { now: 0 }), false);
  assert.equal(memory.feedbackCursor, 1e9);
  memory = roundTrip(memory);
  assert.equal(recordTemporalFeedback(memory, feedback(binding, 1e9, 0), { now: 0 }), false);
  assert.equal(recordTemporalFeedback(memory, feedback(binding, 1, 0, { effect: 'discomfort' }), { now: 0 }), false);
  assert.deepEqual(memory.totals, [1, 0, 0]);
});


test('restore cannot skip an actual intermediate successor submission', () => {
  const memory = createTemporalLedger();
  submit(memory, 0, 'wait'); submit(memory, 1, 'rest'); submit(memory, 2, 'observe');
  const raw = clone(memory), t = raw.model.transitions[0], last = raw.receipts[2];
  Object.assign(t, { nextSeq: last.seq, nextKey: last.key, endAt: last.at, reward: [0, 0, 0, temporalIntegral(0, 2), 0] });
  const restored = roundTrip(raw);
  assert.ok(!restored.model.transitions.some(t => t.seq === 1), 'existence of both endpoints does not prove adjacency');
});

test('incomplete ingestion channel proofs cannot restore consumed-channel eligibility', () => {
  for (const mutation of ['missing', 'future', 'negative', 'mask']) {
    const { memory, binding } = positiveFixture(), raw = clone(memory);
    if (mutation === 'missing') delete raw.ingestions[0].channelProof[0];
    if (mutation === 'future') raw.ingestions[0].channelProof[0].at = 100;
    if (mutation === 'negative') raw.ingestions[0].channelProof[0].at = -1;
    if (mutation === 'mask') delete raw.ingestions[0].channels;
    let restored = roundTrip(raw);
    assert.equal(restored.ingestions[0].creditBlocked, true);
    assert.equal(recordTemporalFeedback(restored, feedback(binding, 2, 2), { now: 2 }), false);
    restored = roundTrip(restored, 2);
    assert.equal(recordTemporalFeedback(restored, feedback(binding, 3, 3), { now: 3 }), false);
    assert.deepEqual(restored.totals, [1, 0, 0]);
  }
});

test('proof eviction censors an affected open interval before it can become replay', () => {
  const memory = createTemporalLedger(), bindings = [];
  for (let i = 1; i <= 129; i++) bindings.push(swallow(memory, { index: i, at: i }));
  const owner = submit(memory, 130, 'rest');
  bindings.forEach((binding, i) => {
    recordTemporalFeedback(memory, feedback(binding, 2 * i + 1, 130), { now: 130 });
    recordTemporalFeedback(memory, feedback(binding, 2 * i + 2, 130, { effect: 'water relief', thirst: 'easing' }), { now: 130 });
  });
  assert.equal(memory.events.length, 256);
  assert.equal(memory.open, null, 'missing reward proof makes the entire current interval untrainable');
  const restored = roundTrip(memory);
  assert.equal(restored.open, null);
  submit(memory, 131); submit(restored, 131);
  assert.ok(!memory.model.transitions.some(t => t.seq === owner));
  assert.deepEqual(restored.model, memory.model);
  trainTemporalReturns(memory.model); trainTemporalReturns(restored.model);
  assert.deepEqual(restored.model, memory.model);
});

test('source and ingestion identifiers are canonical bounded positive integers', () => {
  for (const suffix of ['0', '01', '0001', '1'.repeat(100001), '0'.repeat(100000) + '1', '1000000001']) {
    const memory = createTemporalLedger(), binding = swallow(memory);
    assert.equal(recordTemporalFeedback(memory, feedback(binding, 1, 0, { id: `feedback:${suffix}` }), { now: 0 }), false);
    assert.equal(memory.feedbackCursor, 0);
    const raw = clone(memory);
    raw.receipts[0].outcome.ingestionId = raw.ingestions[0].id = `ingestion:${suffix}`;
    const restored = roundTrip(raw);
    assert.equal(restored.ingestions.length, 0);
    assert.ok(JSON.stringify(restored).length < 5000);
  }
});


test('unowned matched feedback consumes channel eligibility without assigning it to a later action', () => {
  let memory = createTemporalLedger();
  const binding = swallow(memory);
  memory.open = null; // A canonical interval has been censored after dependency eviction.
  assert.equal(recordTemporalFeedback(memory, feedback(binding, 1, 1, { effect: 'water relief', thirst: 'easing' }), { now: 1 }), false);
  assert.equal(memory.ingestions[0].channels, 2);
  assert.deepEqual(memory.totals, [0, 0, 0]);
  memory = roundTrip(memory);
  const owner = submit(memory, 2);
  assert.equal(recordTemporalFeedback(memory, feedback(binding, 2, 3, { effect: 'discomfort', thirst: 'easing' }), { now: 3 }), true);
  assert.equal(memory.events[0].owner, owner);
  assert.equal(memory.events[0].channels, 4, 'combined old water relief cannot become new water reward');
  assert.deepEqual(memory.totals, [0, 0, 1]);
});
