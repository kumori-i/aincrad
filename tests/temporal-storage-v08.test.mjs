import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import {
  TEMPORAL_STORAGE, temporalUtf8Bytes, prepareTemporalStorage, admitTemporalContext,
  encodeTemporalWire, decodeTemporalWire, temporalStorageDiagnostics,
} from '../src/temporal-storage.js';
import {
  createTemporalLedger, beginTemporalDecision, advanceTemporalClock,
  completeTemporalDecision, recordTemporalFeedback, validateTemporalLedger,
} from '../src/temporal-ledger.js';
import { temporalKey, decodeTemporalKey, temporalPrediction, trainTemporalReturns } from '../src/temporal-returns.js';
import { freshState } from '../src/world.js';
import { CONFIG } from '../src/config.js';
import { writeSave, loadSave } from '../src/save.js';

// Storage and synthetic public-receipt fixtures only. These tests do not claim
// actual swallowing, physiological outcomes, autonomous learning, or survival.
const clone = value => structuredClone(value);
const jsonBytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8');
const keyCost = key => jsonBytes(key) + 1;
const FIXED_BYTES = 2 * 1024 * 1024 + 4096 * 384;
const fields = ['shape', 'color', 'texture', 'motion', 'size', 'smell'];
const knownContext = index => ({ appearance: { shape: `observed ${index}` } });
const knownKey = index => temporalKey(knownContext(index), index === 0 ? 'sample' : 'wait');
const submit = (memory, at, context = knownContext(1), action = { type: 'wait' }) =>
  beginTemporalDecision(memory, { at, context, action });

// Produce a canonical key with an exact JSON UTF-8 dictionary-entry cost.
// CJK costs three bytes per character; ASCII fills the final one/two bytes.
function sizedKey(index, desired) {
  const appearance = Object.fromEntries(fields.map(name => [name, '']));
  appearance.shape = `wide:${String(index).padStart(6, '0')}`;
  const base = keyCost(temporalKey({ appearance }, 'wait'));
  const capacity = 600 - appearance.shape.length;
  const maximum = base + 3 * capacity - 2;
  if (desired === undefined) desired = maximum;
  assert.ok(desired >= base && desired <= maximum, 'requested exact key size fits canonical fields');
  const delta = desired - base;
  let padding = '界'.repeat(Math.floor(delta / 3)) + 'x'.repeat(delta % 3);
  for (const name of fields) {
    const take = Math.min(100 - appearance[name].length, padding.length);
    appearance[name] += padding.slice(0, take); padding = padding.slice(take);
  }
  assert.equal(padding, '');
  const key = temporalKey({ appearance }, 'wait');
  assert.equal(keyCost(key), desired);
  return key;
}
let fullDictionary;
function saturatedKeys() {
  if (fullDictionary) return fullDictionary;
  const keys = Array.from({ length: 4096 }, (_, i) => knownKey(i));
  let remaining = TEMPORAL_STORAGE.bytes - FIXED_BYTES - keys.reduce((sum, key) => sum + keyCost(key), 0);
  const maximum = keyCost(sizedKey(0));
  let index = 0;
  while (remaining > 2 * maximum) {
    const key = sizedKey(index++); keys.push(key); remaining -= keyCost(key);
  }
  const firstCost = Math.floor(remaining / 2);
  keys.push(sizedKey(index++, firstCost)); remaining -= firstCost;
  const lastIndex = index;
  keys.push(sizedKey(lastIndex, remaining));
  assert.equal(FIXED_BYTES + keys.reduce((sum, key) => sum + keyCost(key), 0), TEMPORAL_STORAGE.bytes);
  fullDictionary = { keys, lastIndex, lastCost: remaining };
  return fullDictionary;
}
function saturatedLedger() { return prepareTemporalStorage(createTemporalLedger(), saturatedKeys().keys); }
function stored(initial = null) {
  let bytes = initial; const writes = [];
  return { writes, get bytes() { return bytes; }, getItem(key) { assert.equal(key, CONFIG.saveKey); return bytes; },
    setItem(key, value) { assert.equal(key, CONFIG.saveKey); writes.push(value); bytes = value; } };
}
function simpleLedger(index = 1) {
  const memory = createTemporalLedger();
  submit(memory, 0, knownContext(index)); submit(memory, 10, knownContext(index + 1));
  trainTemporalReturns(memory.model);
  return memory;
}
function gameWith(memory, second = null) {
  const state = freshState({ mode: 'discovery', populateEcology: false });
  state.elapsed = 10; state.environment.elapsed = 10;
  for (const npc of state.agents) npc.elapsed = 10;
  state.agents[0].discovery.temporal = memory;
  if (second) state.agents[1].discovery.temporal = second;
  return state;
}

for (const label of ['界漢字', '🍎🌊🙂', '"\\\\', '\ud800x\udfff']) {
  test(`wire UTF-8 measurement and lossless contextual round trip: ${JSON.stringify(label)}`, () => {
    const memory = prepareTemporalStorage(createTemporalLedger());
    const context = { appearance: Object.fromEntries(fields.map(name => [name, label.repeat(35)])) };
    const key = temporalKey(context, 'wait');
    assert.ok(decodeTemporalKey(key));
    assert.equal(temporalUtf8Bytes(key), jsonBytes(key));
    const initial = temporalStorageDiagnostics(memory).reservedBytes;
    assert.equal(initial, FIXED_BYTES);
    assert.equal(admitTemporalContext(memory, key), true);
    assert.equal(temporalStorageDiagnostics(memory).reservedBytes, initial + keyCost(key));
    const wire = encodeTemporalWire(memory);
    assert.equal(temporalUtf8Bytes(wire), jsonBytes(wire));
    assert.deepEqual(decodeTemporalWire(JSON.parse(JSON.stringify(wire))), memory);
    assert.equal(memory.model.rows.length, 0, 'dictionary retention does not require a model row');
  });
}

test('canonical truncation preserves a lone surrogate created at the public appearance boundary', () => {
  const context = { appearance: { shape: 'x'.repeat(99) + '🍎' } };
  const key = temporalKey(context, 'wait');
  assert.equal(decodeTemporalKey(key).context.appearance.shape, 'x'.repeat(99) + '\ud83c');
  const memory = createTemporalLedger();
  assert.equal(admitTemporalContext(memory, key), true);
  assert.deepEqual(decodeTemporalWire(JSON.parse(JSON.stringify(encodeTemporalWire(memory)))), memory);
  assert.equal(temporalStorageDiagnostics(memory).reservedBytes, FIXED_BYTES + keyCost(key));
});

test('dictionary admission reserves complete row growth and uses the exact UTF-8 byte boundary', () => {
  assert.equal(TEMPORAL_STORAGE.bytes, 8 * 1024 * 1024);
  assert.equal(TEMPORAL_STORAGE.dictionaryEntries, 32768);
  const { keys, lastIndex, lastCost } = saturatedKeys();
  const memory = prepareTemporalStorage(createTemporalLedger(), keys.slice(0, -1));
  const before = clone(memory.contextKeys);
  assert.equal(admitTemporalContext(memory, sizedKey(lastIndex, lastCost + 1)), false, 'one byte over is refused');
  assert.deepEqual(memory.contextKeys, before, 'no eviction or replacement on refusal');
  assert.equal(admitTemporalContext(memory, keys.at(-1)), true, 'exact remaining bytes are usable');
  assert.equal(temporalStorageDiagnostics(memory).reservedBytes, TEMPORAL_STORAGE.bytes);
  const overflows = memory.storage.overflows;
  for (const key of [keys[0], keys[4095], keys.at(-1)]) assert.equal(admitTemporalContext(memory, key), true);
  assert.equal(memory.storage.overflows, overflows, 'known contexts remain usable at saturation');
  assert.equal(admitTemporalContext(memory, temporalKey({ appearance: { shape: 'not admitted' } }, 'wait')), false);
  assert.equal(memory.storage.overflows, overflows + 1);
  assert.equal(memory.storage.saturated, true);
  assert.deepEqual(memory.contextKeys, keys);
  assert.ok(jsonBytes(encodeTemporalWire(memory)) <= TEMPORAL_STORAGE.bytes);
});

test('saturated known contexts still train and prediction/storage do not draw random numbers', () => {
  const memory = saturatedLedger(), keys = [...memory.contextKeys];
  const random = Math.random;
  Math.random = () => { throw new Error('temporal storage and learning must not draw runtime RNG'); };
  try {
    submit(memory, 0); submit(memory, 60, knownContext(2));
    const before = temporalPrediction(memory.model, knownKey(1));
    assert.equal(before.q[3], 0);
    trainTemporalReturns(memory.model);
    assert.ok(temporalPrediction(memory.model, knownKey(1)).q[3] > 0);
    const snapshot = clone(memory);
    temporalPrediction(memory.model, knownKey(3));
    encodeTemporalWire(memory); temporalStorageDiagnostics(memory);
    assert.deepEqual(memory, snapshot, 'queries and encoding are pure');
    assert.deepEqual(memory.contextKeys, keys);
    assert.equal(memory.storage.overflows, 0);
  } finally { Math.random = random; }
});

test('unknown submissions preserve chronology and swallow bindings without rewards or a known-to-known bridge', () => {
  let memory = saturatedLedger();
  const knownA = submit(memory, 0, knownContext(0), { type: 'sample', targetId: 'object:1' });
  assert.equal(completeTemporalDecision(memory, { seq: knownA, at: 0, actionId: 1,
    result: { ok: true, code: 'SWALLOWED', ingestionId: 'ingestion:1' } }), true);
  const unknown = submit(memory, 1, { appearance: { shape: 'new unknown sample' } }, { type: 'sample', targetId: 'object:2' });
  advanceTemporalClock(memory, 2);
  assert.equal(completeTemporalDecision(memory, { seq: unknown, at: 2, actionId: 2,
    result: { ok: true, code: 'SWALLOWED', ingestionId: 'ingestion:2', workedSeconds: 1, exertion: 'strenuous' } }), true);
  const feedback = (source, ingestion, at, effect = 'sustained') => ({ id: `feedback:${source}`, at, effect,
    provenance: 'sampled', ingestionId: `ingestion:${ingestion}`, objectId: `object:${ingestion}`, actionId: ingestion });
  assert.equal(recordTemporalFeedback(memory, feedback(1, 1, 2), { now: 2 }), false);
  assert.equal(recordTemporalFeedback(memory, feedback(2, 2, 2), { now: 2 }), false);
  assert.equal(memory.open.seq, unknown);
  assert.equal(memory.open.key, null); assert.equal(memory.open.unknownContext, true);
  assert.deepEqual(memory.open.reward, [0, 0, 0, 0, 0]);
  assert.deepEqual(memory.totals, [0, 0, 0]);
  assert.equal(memory.ingestions.length, 2);
  assert.deepEqual(memory.ingestions.map(i => i.channels), [1, 1], 'unowned channels are consumed once');
  assert.equal(memory.model.transitions.length, 0, 'no incoming transition targets unknown');
  const raw = clone(memory), wire = encodeTemporalWire(memory);
  assert.equal(wire.data.open.key, null);
  assert.equal(wire.data.receipts.at(-1).key, null);
  assert.deepEqual(validateTemporalLedger(raw, 2), raw, 'raw restore retains the null submission');
  memory = validateTemporalLedger(decodeTemporalWire(wire), 2);
  assert.deepEqual(memory, raw, 'wire restore retains chronology, completion, and binding proofs');
  const knownC = submit(memory, 3, knownContext(1));
  assert.equal(memory.model.transitions.length, 0, 'known A -> unknown B -> known C never bridges');
  assert.equal(recordTemporalFeedback(memory, feedback(3, 2, 4), { now: 4 }), false, 'consumed food cannot move to C');
  assert.equal(recordTemporalFeedback(memory, feedback(4, 2, 4, 'discomfort'), { now: 4 }), true, 'a new channel can belong to later known C');
  submit(memory, 5, knownContext(2));
  assert.deepEqual(memory.model.transitions.map(t => [t.seq, t.nextSeq]), [[knownC, knownC + 1]]);
  assert.equal(memory.model.transitions[0].reward[0], 0);
  assert.ok(memory.model.transitions[0].reward[2] > 0);
  assert.deepEqual(validateTemporalLedger(decodeTemporalWire(encodeTemporalWire(memory)), 5), memory);
});

test('full row and bounded proof growth fits the reserved complete actor wire budget', () => {
  const memory = saturatedLedger(), number = 9999.999999999998, at = 359999999.99999994;
  memory.model.rows = Array.from({ length: 4096 }, (_, i) => ({ key: knownKey(i), q: Array(5).fill(number), visits: 1e9, updates: 1e9, lastAt: at }));
  memory.model.transitions = Array.from({ length: 512 }, (_, i) => ({ seq: 999999000 + i, nextSeq: 999999001 + i,
    startAt: at, endAt: at, key: knownKey(i), nextKey: knownKey(i + 1), reward: Array(5).fill(number) }));
  memory.receipts = Array.from({ length: 768 }, (_, i) => ({ seq: 999999000 + i, at, key: knownKey(i), order: 1e9,
    request: { type: i === 0 ? 'sample' : 'wait', targetId: 'object:999999999', seconds: 1199.9999999999998,
      target: { x: -23999.999999999996, y: -23999.999999999996 } }, completedAt: at,
    outcome: { ok: true, code: '\ud800'.repeat(60), durationSeconds: 1199.9999999999998,
      workedSeconds: 1199.9999999999998, actionId: 1e9, ingestionId: 'ingestion:1000000000',
      materialId: 'object:999999999', exertion: 'strenuous' } }));
  memory.ingestions = Array.from({ length: 256 }, (_, i) => ({ id: `ingestion:${999999000 + i}`, objectId: 'object:999999999',
    actionId: 1e9, seq: 999999000 + i, at, channels: 7, creditBlocked: false,
    channelProof: Object.fromEntries([0, 1, 2].map(c => [c, { sourceSeq: 1e9, at }])) }));
  memory.events = Array.from({ length: 256 }, (_, i) => ({ sourceSeq: 999999000 + i, id: `feedback:${999999000 + i}`,
    ingestionId: `ingestion:${999999000 + i}`, objectId: 'object:999999999', actionId: 1e9,
    at, order: 1e9, owner: 999999000 + i, channels: 7 }));
  memory.open = { seq: 1e9, startAt: at, accountedUntil: at, key: knownKey(1), request: memory.receipts[1].request,
    order: 1e9, reward: Array(5).fill(number) };
  for (const name of ['nextSeq', 'eventOrder', 'feedbackCursor', 'rejectedEvents', 'censoredEvents']) memory[name] = 1e9;
  memory.clockAt = at; memory.totals = [1e9, 1e9, 1e9]; memory.storage.overflows = 1e9;
  const wire = encodeTemporalWire(memory);
  assert.equal(wire.data.model.rows.length, 4096);
  assert.equal(temporalStorageDiagnostics(memory).reservedBytes, TEMPORAL_STORAGE.bytes);
  assert.ok(jsonBytes(wire) <= TEMPORAL_STORAGE.bytes, 'all arrays, large numbers, and escaped completion text fit together');
  assert.deepEqual(decodeTemporalWire(wire), memory);
  // The final exact measurement is still required if callers violate a bound.
  memory.unexpectedPayload = '界'.repeat(3 * 1024 * 1024);
  assert.throws(() => encodeTemporalWire(memory), error => error.code === 'TEMPORAL_BUDGET');
});

test('wire decoding rejects noncanonical dictionaries and malformed references instead of aliasing them', () => {
  const memory = simpleLedger();
  admitTemporalContext(memory, temporalKey({ appearance: { shape: 'retained without a row' } }, 'rest'));
  const wire = encodeTemporalWire(memory);
  assert.equal(wire.data.model.rows[0].key, 0, 'integer reference zero is valid');
  assert.deepEqual(decodeTemporalWire(wire), memory);
  for (const mutate of [
    w => { w.encoding = 'unknown'; }, w => { w.version = 2; },
    w => { w.keys = null; }, w => { w.keys.push(w.keys[0]); },
    w => { w.keys[0] += ' '; }, w => { w.keys[0] = 'not a temporal key'; },
    w => { w.keys = Array(32769).fill(w.keys[0]); },
    w => { w.data.model.version = 2; },
    w => { w.data.contextKeys = []; }, w => { w.data.encoding = w.encoding; },
    w => { w.data.open.unknownContext = true; },
    w => { w.data.receipts[0].unknownContext = true; },
    w => { w.data.open = []; }, w => { w.data.model.rows = Array(4097).fill(w.data.model.rows[0]); },
    w => { w.data.receipts = Array(769).fill(w.data.receipts[0]); },
  ]) { const bad = clone(wire); mutate(bad); assert.throws(() => decodeTemporalWire(bad)); }
  for (const value of [null, undefined, false, true, '0', -1, 0.5, NaN, Infinity, wire.keys.length, Number.MAX_SAFE_INTEGER + 1]) {
    for (const target of ['row', 'transition', 'next', 'receipt', 'open']) {
      const bad = clone(wire);
      if (target === 'row') bad.data.model.rows[0].key = value;
      if (target === 'transition') bad.data.model.transitions[0].key = value;
      if (target === 'next') bad.data.model.transitions[0].nextKey = value;
      if (target === 'receipt') bad.data.receipts[0].key = value;
      if (target === 'open') bad.data.open.key = value;
      assert.throws(() => decodeTemporalWire(bad), `${target}: ${String(value)}`);
    }
  }
  const unknown = clone(wire);
  unknown.data.open.key = null; unknown.data.open.unknownContext = true;
  unknown.data.receipts.at(-1).key = null; unknown.data.receipts.at(-1).unknownContext = true;
  const decoded = decodeTemporalWire(unknown);
  assert.equal(decoded.open.key, null);
  assert.equal(decoded.receipts.at(-1).key, null);
});

test('raw migration retains every dictionary-only key and encoding never changes learned forecasts', () => {
  const memory = simpleLedger(), extra = temporalKey({ appearance: { shape: 'unused learned context' } }, 'rest');
  admitTemporalContext(memory, extra);
  const raw = clone(memory), prediction = temporalPrediction(memory.model, knownKey(1));
  const restored = validateTemporalLedger(decodeTemporalWire(encodeTemporalWire(memory)), 10);
  assert.deepEqual(restored, raw);
  assert.ok(restored.contextKeys.includes(extra));
  assert.equal(restored.model.rows.some(row => row.key === extra), false);
  assert.deepEqual(temporalPrediction(restored.model, knownKey(1)), prediction);
  const legacy = clone(memory); delete legacy.contextKeys; delete legacy.storage;
  assert.strictEqual(decodeTemporalWire(legacy), legacy, 'unpacked version-one memory remains a migration input');
  const migrated = validateTemporalLedger(legacy, 10);
  assert.deepEqual(migrated.model, memory.model);
  assert.deepEqual(migrated.contextKeys, memory.contextKeys.filter(key => key !== extra));
  assert.throws(() => prepareTemporalStorage(createTemporalLedger(), [extra, extra]));
  assert.throws(() => prepareTemporalStorage(createTemporalLedger(), null));
  const missingReference = clone(memory); missingReference.contextKeys = [extra];
  assert.throws(() => validateTemporalLedger(missingReference, 10));
  const nullDictionary = clone(memory); nullDictionary.contextKeys = null;
  assert.throws(() => validateTemporalLedger(nullDictionary, 10));
  const futureModel = clone(memory); futureModel.model.version = 2;
  assert.throws(() => validateTemporalLedger(futureModel, 10));
});

test('real save/load packs each actor independently, preserves RNG and forecasts, and versions only temporal saves', async () => {
  const first = simpleLedger(1), second = simpleLedger(20);
  admitTemporalContext(first, temporalKey({ appearance: { shape: 'first dictionary-only context' } }, 'rest'));
  const state = gameWith(first, second), storage = stored();
  state.agents[0].rng = 4294967295; state.agents[1].rng = 123456789;
  const before = clone(state.agents.map(npc => ({ rng: npc.rng, temporal: npc.discovery.temporal })));
  assert.equal(writeSave(storage, state), true);
  const disk = JSON.parse(storage.bytes);
  assert.equal(disk.version, 7);
  assert.equal(disk.npc, undefined, 'historical alias is not duplicated on disk');
  for (const actor of disk.agents) {
    assert.equal(actor.discovery.temporal.encoding, TEMPORAL_STORAGE.encoding);
    assert.ok(jsonBytes(actor.discovery.temporal) <= TEMPORAL_STORAGE.bytes);
  }
  const loaded = loadSave(storage);
  assert.equal(loaded.exists, true); assert.equal(loaded.blocked, false); assert.equal(loaded.error, null);
  assert.deepEqual(loaded.state.agents.map(npc => ({ rng: npc.rng, temporal: npc.discovery.temporal })), before);
  assert.deepEqual(state.agents.map(npc => ({ rng: npc.rng, temporal: npc.discovery.temporal })), before, 'save does not mutate live memory');
  assert.equal(state.agents[0].discovery.temporal.version, 1);
  assert.equal(state.agents[0].discovery.temporal.encoding, undefined);
  assert.equal(writeSave(storage, loaded.state), true);
  assert.deepEqual(JSON.parse(storage.bytes).agents.map(npc => npc.discovery.temporal), disk.agents.map(npc => npc.discovery.temporal));
  const plain = freshState({ mode: 'discovery', populateEcology: false }), plainStorage = stored();
  assert.equal(writeSave(plainStorage, plain), true); assert.equal(JSON.parse(plainStorage.bytes).version, 6);
  // Read the previous source when the historical checkout is present. Normal
  // single-checkout CI still exercises the current reader and all format tests.
  const previous = new URL('../../aincrad-rest/src/save.js', import.meta.url);
  if (await readFile(previous, 'utf8').then(() => true, error => error.code === 'ENOENT' ? false : Promise.reject(error))) {
    const oldReader = await import(previous.href);
    const oldStorage = stored(storage.bytes), oldLoaded = oldReader.loadSave(oldStorage);
    assert.equal(oldLoaded.blocked, true); assert.equal(oldLoaded.state.saveBlocked, true);
    assert.equal(oldReader.writeSave(oldStorage, oldLoaded.state), false);
    assert.equal(oldStorage.bytes, storage.bytes);
  }
});

test('budget-fit old raw saves migrate losslessly, while oversized or corrupt originals cannot be overwritten', () => {
  const rawState = gameWith(simpleLedger());
  const { npc, ...raw } = clone(rawState);
  const original = JSON.stringify(raw), migratedStorage = stored(original);
  const migrated = loadSave(migratedStorage);
  assert.equal(migrated.exists, true); assert.equal(migrated.blocked, false);
  assert.deepEqual(migrated.state.agents[0].discovery.temporal, raw.agents[0].discovery.temporal);
  assert.equal(writeSave(migratedStorage, migrated.state), true);
  assert.equal(JSON.parse(migratedStorage.bytes).version, 7);
  const oversized = clone(raw);
  oversized.agents[0].discovery.temporal.contextKeys = [...saturatedKeys().keys,
    temporalKey({ appearance: { shape: 'one additional key' } }, 'wait')];
  const goodWire = JSON.parse(migratedStorage.bytes);
  const conflictingRaw = clone(raw); conflictingRaw.agents[0].discovery.temporal.open.unknownContext = true;
  const nullRaw = clone(raw); nullRaw.agents[0].discovery.temporal.receipts[0].key = null;
  const partialDictionary = clone(raw); partialDictionary.agents[0].discovery.temporal.contextKeys = [];
  const nullDictionary = clone(raw); nullDictionary.agents[0].discovery.temporal.contextKeys = null;
  const futureModel = clone(raw); futureModel.agents[0].discovery.temporal.model.version = 2;
  const invalidWire = clone(goodWire); invalidWire.agents[0].discovery.temporal.keys.push(invalidWire.agents[0].discovery.temporal.keys[0]);
  const invalidReference = clone(goodWire); invalidReference.agents[0].discovery.temporal.data.open.key = '0';
  const oversizedWire = clone(goodWire); oversizedWire.agents[0].discovery.temporal.data.extra = '界'.repeat(3 * 1024 * 1024);
  for (const bad of [oversized, conflictingRaw, nullRaw, partialDictionary, nullDictionary, futureModel, invalidWire, invalidReference, oversizedWire]) {
    const bytes = JSON.stringify(bad), storage = stored(bytes);
    const result = loadSave(storage);
    assert.equal(result.exists, false); assert.equal(result.blocked, true); assert.equal(result.state.saveBlocked, true);
    assert.ok(result.error);
    assert.equal(storage.bytes, bytes, 'read failure preserves exact original storage bytes');
    assert.equal(writeSave(storage, result.state), false);
    assert.equal(storage.writes.length, 0);
    assert.equal(storage.bytes, bytes);
  }
  for (const bad of [oversized, conflictingRaw, nullRaw, partialDictionary, nullDictionary, futureModel]) {
    const existing = stored(original);
    assert.equal(writeSave(existing, { ...bad, npc: bad.agents[0] }), false);
    assert.equal(existing.writes.length, 0, 'budget and reference validation precede setItem');
    assert.equal(existing.bytes, original);
  }
});

test('pre-dictionary legacy Unicode rows exceeding the lossless union budget protect original save bytes', () => {
  const memory = createTemporalLedger();
  memory.clockAt = 10;
  memory.model.rows = Array.from({ length: 4096 }, (_, index) => ({
    key: sizedKey(index), q: [1, 2, 3, 4, 5], visits: 7, updates: 8, lastAt: 10,
  }));
  memory.model.saturated = true;
  delete memory.contextKeys; delete memory.storage;
  assert.equal('contextKeys' in memory, false, 'fixture is genuinely the pre-dictionary raw format');
  assert.ok(FIXED_BYTES + memory.model.rows.reduce((sum, row) => sum + keyCost(row.key), 0) > TEMPORAL_STORAGE.bytes);
  assert.throws(() => validateTemporalLedger(memory, 10), error => error.code === 'TEMPORAL_BUDGET',
    'valid learned rows cannot be truncated merely to make migration fit');
  const { npc, ...raw } = gameWith(memory);
  const original = JSON.stringify(raw), storage = stored(original);
  const loaded = loadSave(storage);
  assert.equal(loaded.exists, false); assert.equal(loaded.blocked, true);
  assert.equal(loaded.state.saveBlocked, true); assert.ok(loaded.error);
  assert.equal(storage.bytes, original);
  assert.equal(writeSave(storage, loaded.state), false);
  assert.equal(writeSave(storage, raw), false, 'direct save cannot silently discard oversized old learned rows');
  assert.equal(storage.writes.length, 0);
  assert.equal(storage.bytes, original);
});

test('pre-dictionary migration keeps valid replay and receipt contexts that never gained a full-table row', () => {
  const memory = createTemporalLedger();
  memory.model.rows = Array.from({ length: 4096 }, (_, index) => ({
    key: knownKey(index), q: [1, 2, 3, 4, 5], visits: 7, updates: 8, lastAt: 0,
  }));
  prepareTemporalStorage(memory);
  const a = { appearance: { shape: 'public receipt context beyond row capacity A' } };
  const b = { appearance: { shape: 'public receipt context beyond row capacity B' } };
  const aKey = temporalKey(a, 'wait'), bKey = temporalKey(b, 'wait');
  submit(memory, 0, a); submit(memory, 10, b);
  assert.equal(memory.model.rows.length, 4096);
  assert.equal(memory.model.saturated, true);
  assert.equal(memory.model.transitions.length, 1);
  assert.deepEqual(memory.model.transitions.map(t => [t.key, t.nextKey]), [[aKey, bKey]]);
  assert.equal(memory.model.rows.some(row => [aKey, bKey].includes(row.key)), false);
  const legacy = clone(memory); delete legacy.contextKeys; delete legacy.storage;
  const migrated = validateTemporalLedger(legacy, 10);
  assert.deepEqual(migrated.model, memory.model, 'migration retains forecasts and the canonical non-row replay');
  assert.deepEqual(migrated.receipts, memory.receipts);
  assert.deepEqual(migrated.open, memory.open);
  assert.equal(migrated.contextKeys.length, 4098);
  assert.ok(migrated.contextKeys.includes(aKey)); assert.ok(migrated.contextKeys.includes(bKey));
  const wire = encodeTemporalWire(migrated);
  assert.equal(wire.data.model.transitions[0].key, 4096);
  assert.equal(wire.data.model.transitions[0].nextKey, 4097);
  assert.deepEqual(validateTemporalLedger(decodeTemporalWire(wire), 10), migrated);
});
