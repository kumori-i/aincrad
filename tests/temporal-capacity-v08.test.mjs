import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import {
  FINITE_TEMPORAL_PROFILE as PROFILE, applyTemporalCapacity, checkTemporalCapacity,
  resolveTemporalCapacity, temporalCapacityFor, temporalDictionaryBytes,
} from '../src/temporal-capacity.js';
import {
  createTemporalLedger, beginTemporalDecision, completeTemporalDecision,
  recordTemporalFeedback, validateTemporalLedger,
} from '../src/temporal-ledger.js';
import {
  TEMPORAL_LIMITS, temporalKey, temporalPrediction, trainTemporalReturns,
} from '../src/temporal-returns.js';
import {
  TEMPORAL_STORAGE, prepareTemporalStorage, admitTemporalContext,
  encodeTemporalWire, temporalStorageDiagnostics,
} from '../src/temporal-storage.js';

// Capacity and canonical public-receipt fixtures only, not evidence of autonomous
// physical acquisition, swallowing, survival, or real biological benefit.
const clone = value => structuredClone(value);
const bytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8');
const context = i => ({ appearance: { shape: `observed ${i}` } });
const key = (i, type = 'wait') => temporalKey(context(i), type);
const fresh = () => createTemporalLedger({ capacityProfile: PROFILE.name });
const submit = (memory, at, i = 0, action = { type: 'wait' }) => beginTemporalDecision(memory, { at, context: context(i), action });
function swallow(memory, id, at = id - 1) {
  const seq = submit(memory, at, id, { type: 'sample', targetId: `object:${id}` });
  assert.equal(completeTemporalDecision(memory, { seq, at, actionId: id,
    result: { ok: true, code: 'SWALLOWED', ingestionId: `ingestion:${id}` } }), true);
  return seq;
}
const feedback = (source, ingestion, at, channel = 0) => ({ id: `feedback:${source}`, at,
  provenance: 'sampled', ingestionId: `ingestion:${ingestion}`, objectId: `object:${ingestion}`,
  actionId: ingestion, ...(channel === 1 ? { thirst: 'easing' } : { effect: channel === 2 ? 'discomfort' : 'sustained' }) });
function restore(memory) {
  const wire = JSON.parse(JSON.stringify(encodeTemporalWire(memory)));
  checkTemporalCapacity(wire, PROFILE.name);
  const result = validateTemporalLedger(wire, memory.clockAt);
  assert.equal(temporalCapacityFor(result), null, 'ordinary validation never infers an experimental profile');
  checkTemporalCapacity(result, PROFILE.name);
  applyTemporalCapacity(result, PROFILE.name);
  return result;
}

test('finite profile is exact, explicit, immutable and runtime-only; PR7 defaults stay unchanged', () => {
  assert.deepEqual(PROFILE, { name: 'finite-temporal-v1', rows: 256, transitions: 128,
    contextKeys: 512, contextBytes: 262144, receipts: 384, ingestions: 64, events: 128 });
  assert.equal(Object.isFrozen(PROFILE), true);
  assert.equal(resolveTemporalCapacity(PROFILE.name), PROFILE);
  assert.equal(resolveTemporalCapacity(clone(PROFILE)), PROFILE);
  for (const invalid of [undefined, null, 'finite-temporal-v2', {}, { name: PROFILE.name },
    { ...PROFILE, rows: 257 }, { ...PROFILE, extra: 1 }]) {
    const memory = createTemporalLedger(), before = clone(memory);
    assert.throws(() => applyTemporalCapacity(memory, invalid), { code: 'TEMPORAL_CAPACITY' });
    assert.deepEqual(memory, before); assert.equal(temporalCapacityFor(memory), null);
  }
  const memory = createTemporalLedger(), before = clone(memory);
  assert.strictEqual(applyTemporalCapacity(memory, PROFILE.name), memory);
  assert.deepEqual(memory, before, 'profile application adds no persistent field or saturation flag');
  assert.strictEqual(temporalCapacityFor(memory), PROFILE);
  assert.strictEqual(temporalCapacityFor(memory.model), PROFILE);
  assert.equal(temporalCapacityFor(clone(memory)), null);
  assert.equal(JSON.stringify(encodeTemporalWire(memory)).includes(PROFILE.name), false);
  assert.equal(TEMPORAL_LIMITS.rows, 4096); assert.equal(TEMPORAL_LIMITS.transitions, 512);
  assert.equal(TEMPORAL_STORAGE.dictionaryEntries, 32768); assert.equal(TEMPORAL_STORAGE.bytes, 8388608);
  const ordinary = createTemporalLedger();
  for (let i = 0; i < 401; i++) submit(ordinary, i, i);
  assert.equal(ordinary.model.rows.length, 401);
  assert.equal(ordinary.model.transitions.length, 400);
  assert.equal(ordinary.receipts.length, 401);
  assert.equal(temporalCapacityFor(ordinary), null);
});

test('all current and successor row creation respects 256 durable rows, including after reopen', () => {
  let memory = fresh();
  for (let i = 0; i < 256; i++) submit(memory, i, i);
  assert.equal(memory.model.rows.length, 256);
  assert.equal(temporalPrediction(memory.model, key(255)).known, false, 'actual successor has no visit until its interval closes');
  submit(memory, 256, 256);
  assert.equal(memory.model.rows.length, 256);
  assert.equal(temporalPrediction(memory.model, key(255)).known, true);
  assert.equal(temporalPrediction(memory.model, key(256)).known, false, 'successor cannot exceed row cap');
  assert.equal(memory.model.saturated, true);
  submit(memory, 257, 257);
  assert.equal(temporalPrediction(memory.model, key(256)).known, false, 'a later current interval cannot create an overflow row');
  trainTemporalReturns(memory.model);
  const durable = clone(memory.model.rows[0]);
  for (let i = 258; i < 410; i++) submit(memory, i, 255);
  assert.equal(memory.model.transitions.length, 128);
  assert.equal(memory.receipts.length, 384);
  assert.equal(memory.model.historyCensored, true); assert.equal(memory.historyCensored, true);
  assert.deepEqual(memory.model.rows[0], durable, 'old rows do not rotate out with replay or proof receipts');
  memory = restore(memory);
  assert.deepEqual(memory.model.rows[0], durable);
  submit(memory, 410, 900); submit(memory, 411, 255);
  assert.equal(memory.model.rows.length, 256); assert.equal(memory.model.transitions.length, 128);
  assert.equal(temporalPrediction(memory.model, key(900)).known, false);
  const visits = temporalPrediction(memory.model, key(255)).visits;
  submit(memory, 412, 255);
  assert.equal(temporalPrediction(memory.model, key(255)).visits, visits + 1, 'retained keys and rows remain useful after saturation');
  checkTemporalCapacity(memory, PROFILE.name);
});

test('512-key count cap preserves retained keys; lookup, encoding and diagnostics never spend capacity', () => {
  const memory = fresh();
  for (let i = 0; i < 512; i++) assert.equal(admitTemporalContext(memory, key(i)), true);
  const before = clone(memory);
  for (let i = 0; i < 3; i++) {
    temporalPrediction(memory.model, key(1000)); temporalKey(context(1000), 'wait');
    encodeTemporalWire(memory); temporalStorageDiagnostics(memory); checkTemporalCapacity(memory, PROFILE.name);
  }
  assert.deepEqual(memory, before);
  assert.equal(admitTemporalContext(memory, key(512)), false);
  assert.equal(memory.contextKeys.length, 512); assert.equal(memory.storage.overflows, 1);
  assert.equal(admitTemporalContext(memory, key(0)), true);
  assert.equal(admitTemporalContext(memory, key(511)), true);
  assert.equal(memory.storage.overflows, 1);
  submit(memory, 0, 0); submit(memory, 1, 512); submit(memory, 2, 1);
  assert.equal(memory.receipts[1].key, null); assert.equal(memory.receipts[1].unknownContext, true);
  assert.equal(memory.model.transitions.length, 0, 'no known-to-known replay bridge crosses a refused dictionary context');
  submit(memory, 3, 2);
  assert.deepEqual(memory.model.transitions.map(t => [t.seq, t.nextSeq]), [[3, 4]]);
  assert.deepEqual(restore(memory), memory);
});

const fields = ['shape', 'color', 'texture', 'motion', 'size', 'smell'];
const keyCost = value => bytes(value) + 1;
function sizedKey(index, desired) {
  const appearance = Object.fromEntries(fields.map(name => [name, '']));
  appearance.shape = `wide:${String(index).padStart(6, '0')}`;
  const base = keyCost(temporalKey({ appearance }, 'wait'));
  const maximum = base + 3 * (600 - appearance.shape.length) - 2;
  desired ??= maximum;
  assert.ok(desired >= base && desired <= maximum);
  const delta = desired - base;
  let padding = '界'.repeat(Math.floor(delta / 3)) + 'x'.repeat(delta % 3);
  for (const name of fields) {
    const take = Math.min(100 - appearance[name].length, padding.length);
    appearance[name] += padding.slice(0, take); padding = padding.slice(take);
  }
  assert.equal(padding, '');
  const result = temporalKey({ appearance }, 'wait'); assert.equal(keyCost(result), desired);
  return result;
}
function byteBoundary() {
  const keys = [], maximum = keyCost(sizedKey(0));
  let remaining = PROFILE.contextBytes - 1, index = 0;
  while (remaining > 2 * maximum) { const k = sizedKey(index++); keys.push(k); remaining -= keyCost(k); }
  const half = Math.floor(remaining / 2); keys.push(sizedKey(index++, half)); remaining -= half;
  keys.push(sizedKey(index, remaining));
  assert.ok(keys.length < PROFILE.contextKeys); assert.equal(bytes(keys), PROFILE.contextBytes);
  return { keys, last: index, cost: remaining };
}

test('dictionary byte admission is exact UTF-8 JSON at 256 KiB, never UTF-16 size or reservation approximation', () => {
  const { keys, last, cost } = byteBoundary(), memory = fresh();
  prepareTemporalStorage(memory, keys.slice(0, -1));
  const before = clone(memory.contextKeys);
  assert.equal(admitTemporalContext(memory, sizedKey(last, cost + 1)), false, 'one byte beyond the true JSON dictionary is rejected');
  assert.deepEqual(memory.contextKeys, before);
  assert.equal(admitTemporalContext(memory, keys.at(-1)), true, 'exact byte boundary is usable');
  assert.equal(temporalDictionaryBytes(memory.contextKeys), 262144);
  assert.equal(temporalStorageDiagnostics(memory).dictionaryBytes, 262144);
  assert.ok(JSON.stringify(memory.contextKeys).length < 262144);
  assert.equal(admitTemporalContext(memory, keys[0]), true);
  assert.equal(admitTemporalContext(memory, key(9999)), false);
  assert.equal(checkTemporalCapacity(encodeTemporalWire(memory), PROFILE.name).dictionaryBytes, 262144);
  const snapshot = clone(memory);
  for (const bad of [[...keys, key(9999)], [...keys.slice(0, -1), sizedKey(last, cost + 1)]]) {
    assert.throws(() => prepareTemporalStorage(memory, bad));
    assert.deepEqual(memory, snapshot, 'failed profile migration leaves original data intact');
  }
  for (const label of ['界漢字', '🍎🌊🙂', '"\\', '\ud800x\udfff']) {
    const m = fresh(), k = temporalKey({ appearance: { shape: label.repeat(35) } }, 'wait');
    assert.equal(admitTemporalContext(m, k), true);
    assert.equal(temporalStorageDiagnostics(m).dictionaryBytes, bytes([k]));
    assert.equal(temporalDictionaryBytes(m.contextKeys), bytes(m.contextKeys));
  }
});

test('ingestion eviction at 64 censors both closed and open dependents without resetting cursors or credit', () => {
  let memory = fresh();
  for (let i = 1; i <= 64; i++) swallow(memory, i);
  assert.equal(recordTemporalFeedback(memory, feedback(1, 1, 63)), true);
  const closedOwner = memory.open.seq;
  const seq = submit(memory, 64, 65, { type: 'sample', targetId: 'object:65' });
  assert.equal(recordTemporalFeedback(memory, feedback(2, 1, 64, 1)), true);
  const durable = clone(memory.model.rows);
  assert.ok(memory.model.transitions.some(t => t.seq === closedOwner));
  assert.equal(completeTemporalDecision(memory, { seq, at: 64, actionId: 65,
    result: { ok: true, code: 'SWALLOWED', ingestionId: 'ingestion:65' } }), true);
  assert.equal(memory.ingestions.length, 64); assert.equal(memory.ingestions[0].id, 'ingestion:2');
  assert.equal(memory.open, null, 'open interval depending on the lost ingestion cannot survive');
  assert.equal(memory.model.transitions.some(t => t.seq === closedOwner), false);
  assert.equal(memory.events.length, 0); assert.deepEqual(memory.model.rows, durable);
  assert.deepEqual(memory.totals, [1, 1, 0]); assert.equal(memory.feedbackCursor, 2);
  assert.equal(recordTemporalFeedback(memory, feedback(2, 1, 64, 1)), false);
  assert.equal(recordTemporalFeedback(memory, feedback(3, 1, 64, 2)), false);
  submit(memory, 65, 0);
  assert.equal(recordTemporalFeedback(memory, feedback(4, 2, 65)), true);
  memory = restore(memory);
  assert.equal(memory.ingestions.find(i => i.id === 'ingestion:2').channels, 1);
  assert.equal(memory.feedbackCursor, 4);
  assert.equal(recordTemporalFeedback(memory, feedback(4, 2, 65)), false);
  assert.equal(recordTemporalFeedback(memory, feedback(5, 2, 65)), false, 'new event ID cannot re-credit an already consumed channel');
  assert.equal(recordTemporalFeedback(memory, feedback(6, 2, 65, 2)), true);
  assert.deepEqual(memory.totals, [2, 1, 1]);
});

for (const closed of [false, true]) test(`128-event eviction censors the ${closed ? 'closed' : 'open'} owner and preserves exact-once masks`, () => {
  let memory = fresh();
  for (let i = 1; i <= 43; i++) swallow(memory, i);
  const owner = submit(memory, 43, 0);
  assert.equal(recordTemporalFeedback(memory, feedback(1, 1, 43)), true);
  if (closed) submit(memory, 44, 0);
  const at = closed ? 44 : 43;
  let source = 1;
  for (let i = 1; i <= 43; i++) for (let channel = i === 1 ? 1 : 0; channel < 3; channel++) {
    assert.equal(recordTemporalFeedback(memory, feedback(++source, i, at, channel)), true);
  }
  assert.equal(source, 129); assert.equal(memory.events.length, 128);
  assert.equal(memory.events[0].sourceSeq, 2); assert.equal(memory.feedbackCursor, 129);
  assert.equal(memory.model.transitions.some(t => t.seq === owner), false);
  assert.equal(memory.open?.seq ?? null, closed ? owner + 1 : null);
  assert.equal(memory.ingestions.every(i => i.channels === 7), true);
  assert.deepEqual(memory.totals, [43, 43, 43]);
  memory = restore(memory);
  assert.equal(memory.events.length, 128); assert.equal(memory.feedbackCursor, 129);
  const totals = clone(memory.totals);
  assert.equal(recordTemporalFeedback(memory, feedback(1, 1, at)), false);
  assert.equal(recordTemporalFeedback(memory, feedback(130, 1, at)), false);
  assert.deepEqual(memory.totals, totals, 'event payload eviction never restores channel eligibility');
});

test('384-receipt eviction removes ingestion dependencies, censors delayed closed replay and retains durable rows', () => {
  let memory = fresh(); swallow(memory, 1, 0);
  submit(memory, 1, 0); assert.equal(recordTemporalFeedback(memory, feedback(1, 1, 1)), true);
  for (let at = 2; at < 384; at++) submit(memory, at, 0);
  assert.equal(memory.receipts.length, 384); assert.equal(memory.ingestions.length, 1);
  assert.equal(recordTemporalFeedback(memory, feedback(2, 1, 383, 1)), true);
  const owner = memory.open.seq, durable = clone(memory.model.rows[0]);
  submit(memory, 384, 0);
  assert.equal(memory.receipts.length, 384); assert.equal(memory.receipts[0].seq, 2);
  assert.equal(memory.ingestions.length, 0); assert.equal(memory.events.length, 0);
  assert.equal(memory.model.transitions.some(t => t.seq === owner), false);
  assert.equal(memory.model.transitions.length, 127, 'censored interval is not replaced by a zero-return record');
  assert.deepEqual(memory.model.rows[0], durable);
  assert.equal(memory.feedbackCursor, 2); assert.deepEqual(memory.totals, [1, 1, 0]);
  assert.equal(recordTemporalFeedback(memory, feedback(3, 1, 384, 2)), false);
  memory = restore(memory);
  assert.equal(memory.feedbackCursor, 3); assert.equal(memory.ingestions.length, 0);
  assert.equal(memory.model.rows.length, 2); assert.equal(memory.open.seq, 385);
});

test('capacity-refused sample intervals still consume channel masks and cannot donate their reward later', () => {
  let memory = fresh();
  admitTemporalContext(memory, key(1, 'sample'));
  for (let i = 0; i < 511; i++) admitTemporalContext(memory, key(i));
  swallow(memory, 1, 0);
  swallow(memory, 2, 1);
  assert.equal(memory.open.unknownContext, true);
  assert.equal(recordTemporalFeedback(memory, feedback(1, 1, 1)), false);
  assert.equal(recordTemporalFeedback(memory, feedback(2, 2, 1)), false);
  assert.deepEqual(memory.ingestions.map(i => i.channels), [1, 1]);
  assert.deepEqual(memory.open.reward, [0, 0, 0, 0, 0]);
  memory = restore(memory); submit(memory, 2, 0);
  assert.equal(recordTemporalFeedback(memory, feedback(3, 2, 2)), false);
  assert.equal(recordTemporalFeedback(memory, feedback(4, 2, 2, 2)), true);
  submit(memory, 3, 1);
  assert.equal(memory.model.transitions.length, 1);
  assert.equal(memory.model.transitions[0].reward[0], 0);
  assert.equal(memory.model.transitions[0].reward[2], 1);
});

function populated() {
  const memory = fresh(); swallow(memory, 1, 0);
  recordTemporalFeedback(memory, feedback(1, 1, 0)); submit(memory, 1, 0);
  return memory;
}
const oversize = [
  ['rows', memory => { memory.model.rows = Array(257).fill(memory.model.rows[0]); }],
  ['replay', memory => { memory.model.transitions = Array(129).fill(memory.model.transitions[0]); }],
  ['receipts', memory => { memory.receipts = Array(385).fill(memory.receipts[0]); }],
  ['ingestions', memory => { memory.ingestions = Array(65).fill(memory.ingestions[0]); }],
  ['events', memory => { memory.events = Array(129).fill(memory.events[0]); }],
];
for (const [name, mutate] of oversize) test(`strict raw and live ${name} checks reject before permissive validation can drop/slice, without mutation`, () => {
  const live = clone(populated()); mutate(live);
  const before = clone(live);
  assert.throws(() => applyTemporalCapacity(live, PROFILE.name), { code: 'TEMPORAL_CAPACITY' });
  assert.equal(temporalCapacityFor(live), null); assert.equal(temporalCapacityFor(live.model), null);
  assert.throws(() => checkTemporalCapacity(live, PROFILE.name), { code: 'TEMPORAL_CAPACITY' });
  assert.deepEqual(live, before);
  const wire = encodeTemporalWire(populated()); mutate(wire.data);
  const wireBefore = clone(wire);
  assert.throws(() => checkTemporalCapacity(wire, PROFILE.name), { code: 'TEMPORAL_CAPACITY' });
  assert.deepEqual(wire, wireBefore);
  const profiled = populated(); mutate(profiled);
  assert.throws(() => encodeTemporalWire(profiled), { code: 'TEMPORAL_CAPACITY' });
});

test('strict dictionary/reference/profile checks reject malformed or oversized live and encoded inputs atomically', () => {
  const { keys, last, cost } = byteBoundary();
  for (const encoded of [false, true]) for (const badKeys of [
    Array.from({ length: 513 }, (_, i) => key(i)),
    [...keys.slice(0, -1), sizedKey(last, cost + 1)],
    [key(1), key(1)], null, [null], Array(1),
  ]) {
    const memory = encoded ? encodeTemporalWire(fresh()) : clone(fresh());
    memory[encoded ? 'keys' : 'contextKeys'] = badKeys;
    const before = clone(memory);
    assert.throws(() => checkTemporalCapacity(memory, PROFILE.name), { code: 'TEMPORAL_CAPACITY' });
    if (!encoded) assert.throws(() => applyTemporalCapacity(memory, PROFILE.name), { code: 'TEMPORAL_CAPACITY' });
    assert.deepEqual(memory, before);
  }
  const good = populated();
  for (const mutate of [
    m => { m.model.rows[0].q = Array(6).fill(0); },
    m => { m.model.transitions[0].reward = Array(6).fill(0); },
    m => { m.open.reward = Array(6).fill(0); },
    m => { m.totals = Array(4).fill(0); },
    m => { m.receipts[0].key = null; },
    m => { m.open.unknownContext = true; },
    m => { m.contextKeys = []; },
    m => { m.open = []; },
    m => { m.events = Array(1); },
  ]) {
    const bad = clone(good); mutate(bad);
    assert.throws(() => checkTemporalCapacity(bad, PROFILE.name), { code: 'TEMPORAL_CAPACITY' });
  }
  const wire = encodeTemporalWire(good);
  for (const invalid of [-1, 0.5, wire.keys.length, null, '0']) {
    const bad = clone(wire); bad.data.model.rows[0].key = invalid;
    assert.throws(() => checkTemporalCapacity(bad, PROFILE.name), { code: 'TEMPORAL_CAPACITY' });
  }
  assert.throws(() => applyTemporalCapacity(wire, PROFILE.name), { code: 'TEMPORAL_CAPACITY' });
  const memory = fresh(), snapshot = clone(memory);
  assert.throws(() => prepareTemporalStorage(memory, Array.from({ length: 513 }, (_, i) => key(i))));
  assert.deepEqual(memory, snapshot);
});
