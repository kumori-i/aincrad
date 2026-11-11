import test from 'node:test';
import assert from 'node:assert/strict';
import { freshState } from '../../src/world.js';
import { loadSave, validateSave, writeSave } from '../../src/save.js';
import { CONFIG } from '../../src/config.js';
import { requestNpcAction } from '../../src/npc.js';
import {
  MAX_PREPARED_BYTES, PROTOCOL_VERSION, PreparationError, prepareSave,
  utf8ByteLength, validPrepareRequest, validPreparedResponse, validReleaseRequest,
} from './preparation.js';
import { createPreparationWorker } from './worker.js';

const identity = { instance: 'test', generation: 1, epoch: 1, id: 1 };
const request = (snapshot, extra = {}) => ({ type: 'prepare', version: PROTOCOL_VERSION, ...identity, blocked: false, snapshot, ...extra });
const release = extra => ({ type: 'release', version: PROTOCOL_VERSION, ...identity, ...extra });
function canonical(state) {
  let text;
  assert.equal(writeSave({ setItem(key, value) { assert.equal(key, CONFIG.saveKey); text = value; } }, state), true);
  return text;
}
function frozen(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) frozen(child, seen);
  return Object.freeze(value);
}

test('preparation produces exact stable v8 bytes and restart state, without mutating even frozen input', () => {
  const state = freshState();
  const before = structuredClone(state);
  const baseline = canonical(state);
  frozen(state);
  const result = prepareSave(state);
  assert.equal(result.text, baseline);
  assert.equal(result.bytes, new TextEncoder().encode(baseline).length);
  assert.deepEqual(state, before);
  assert.deepEqual(validateSave(JSON.parse(result.text)), validateSave(JSON.parse(baseline)));
});

test('legacy v1-v6 inputs use exactly the shipping migration and guard path', () => {
  for (const version of [1, 2, 3, 4, 5, 6]) {
    const state = { version, simulationMode: 'legacy', scene: 'valley', elapsed: 40, selectedAgentId: 'mira' };
    assert.equal(prepareSave(state).text, canonical(state));
  }
});

test('protected/future/research/malformed lifecycle sources are rejected instead of freshened', () => {
  const badLifecycle = freshState();
  badLifecycle.features.plantLifecycle = 2;
  const temporal = freshState();
  temporal.agents[0].discovery.temporal = { version: 1 };
  const regional = freshState();
  regional.environment.ecology.regionalVersion = 9;
  for (const state of [{ version: 7 }, { version: 99 }, badLifecycle, temporal, regional, null]) {
    assert.throws(() => prepareSave(state), error => error instanceof PreparationError && error.code === 'validation');
  }
  const protectedState = freshState({ mode: 'legacy' });
  Object.defineProperty(protectedState, 'saveBlocked', { value: true, enumerable: false });
  assert.equal(structuredClone(protectedState).saveBlocked, undefined);
  assert.throws(() => prepareSave(protectedState), { code: 'protected' });
  assert.throws(() => prepareSave(structuredClone(protectedState), { blocked: true }), { code: 'protected' });
  const loaded = loadSave({ getItem: () => '{invalid' });
  assert.throws(() => prepareSave(loaded.state), { code: 'protected' });
});

test('real active sleep actions and source clocks remain untouched with baseline restart semantics', () => {
  const state = freshState({ mode: 'legacy' });
  const actor = state.agents[0];
  assert.equal(requestNpcAction(actor, { type: 'sleep', seconds: 8 }, state.environment).code, 'STARTED');
  const before = structuredClone(state);
  const active = actor.active;
  const prepared = prepareSave(state);
  assert.equal(prepared.text, canonical(state));
  assert.equal(actor.active, active);
  assert.deepEqual(state, before);
  assert.deepEqual(validateSave(JSON.parse(prepared.text)), validateSave(JSON.parse(canonical(state))));
});

test('UTF-8 measurement matches TextEncoder for BMP, astral and unpaired surrogates', () => {
  for (const text of ['', 'ASCII', 'é中', '🌲🦊', '\ud800', '\udc00', 'a\ud800x\udc00z']) {
    assert.equal(utf8ByteLength(text), new TextEncoder().encode(text).length);
  }
});

test('transport allowlists, identities and byte bounds are exact but intentionally not semantic JSON validation', () => {
  const good = { type: 'prepared', version: 1, ...identity, ok: true, text: 'arbitrary trusted-worker text', bytes: 29, preparationMs: 0 };
  good.bytes = good.text.length;
  assert.equal(validPreparedResponse(good), true);
  for (const change of [
    { text: '' }, { bytes: 0 }, { bytes: 1.5 }, { bytes: good.text.length - 1 },
    { bytes: good.text.length * 3 + 1 }, { preparationMs: -1 }, { preparationMs: Infinity },
    { preparationMs: NaN }, { ok: 1 }, { version: 2 }, { id: Number.MAX_SAFE_INTEGER + 1 },
    { epoch: 0 }, { generation: -1 }, { instance: 'bad space' }, { extra: true },
  ]) assert.equal(validPreparedResponse({ ...good, ...change }), false, JSON.stringify(change));
  assert.equal(validPreparedResponse({ ...good, text: 'x'.repeat(MAX_PREPARED_BYTES + 1), bytes: MAX_PREPARED_BYTES + 1 }), false);
  assert.equal(validPreparedResponse({ ...good, text: 'x'.repeat(MAX_PREPARED_BYTES), bytes: MAX_PREPARED_BYTES }), true);
  const failure = { type: 'prepared', version: 1, ...identity, ok: false, code: 'validation', preparationMs: 0 };
  assert.equal(validPreparedResponse(failure), true);
  assert.equal(validPreparedResponse({ ...failure, code: 'arbitrary-message' }), false);
  assert.equal(validPreparedResponse({ ...failure, text: 'hidden result' }), false);
  assert.equal(validPrepareRequest(request({ version: 1 })), true);
  assert.equal(validPrepareRequest(request({ version: 1 }, { blocked: 0 })), false);
  assert.equal(validPrepareRequest(request({ version: 1 }, { url: 'https://example.invalid' })), false);
  assert.equal(validReleaseRequest(release()), true);
  assert.equal(validReleaseRequest(release({ snapshot: {} })), false);
});

test('worker retains exactly one result until exact release, then accepts the next capture', () => {
  const replies = [];
  let clock = 0;
  const worker = createPreparationWorker({ send: value => replies.push(value), now: () => ++clock });
  const state = freshState({ mode: 'legacy' });
  assert.equal(worker.handleMessage(request(state)), true);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].text, canonical(state));
  assert.equal(validPreparedResponse(replies[0]), true);
  assert.deepEqual(worker.inspect(), { closed: false, retainedCount: 1, retainedTextCount: 1, maxRetained: 1 });
  assert.equal(worker.handleMessage(release()), true);
  assert.equal(worker.inspect().retainedCount, 0);
  assert.equal(worker.handleMessage(request(state, { id: 2 })), true);
  assert.equal(worker.handleMessage(release({ id: 2 })), true);
  worker.dispose();
  assert.equal(worker.inspect().retainedCount, 0);
});

test('worker explicitly transports protection and validation failures without leaking exception strings', () => {
  for (const [snapshot, blocked, code] of [[{ version: 7 }, false, 'validation'], [{ version: 1 }, true, 'protected']]) {
    const replies = [];
    const worker = createPreparationWorker({ send: value => replies.push(value) });
    worker.handleMessage(request(snapshot, { blocked }));
    assert.equal(replies[0].code, code);
    assert.equal(replies[0].ok, false);
    assert.equal('text' in replies[0], false);
    assert.equal(worker.inspect().retainedTextCount, 0);
    worker.handleMessage(release());
    assert.equal(worker.inspect().retainedCount, 0);
  }
});

test('worker fails closed for unallowlisted commands, overlapping capture and mismatched release', () => {
  for (const makeMessages of [
    () => [{ type: 'fetch', url: 'https://example.invalid' }],
    () => [request({ version: 1 }, { extra: true })],
    () => [request({ version: 1 }), request({ version: 1 }, { id: 2 })],
    () => [request({ version: 1 }), release({ id: 2 })],
    () => [release()],
  ]) {
    let closed = 0;
    const worker = createPreparationWorker({ send() {}, close() { closed++; } });
    for (const message of makeMessages()) worker.handleMessage(message);
    assert.equal(closed, 1);
    assert.equal(worker.inspect().closed, true);
    assert.equal(worker.inspect().retainedCount, 0);
    assert.equal(worker.handleMessage(request({ version: 1 })), false);
  }
});
