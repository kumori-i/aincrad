import test from 'node:test';
import assert from 'node:assert/strict';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { OZARK_SAVE_KEY, createOzarkState, loadOzarkSave } from '../src/ozark-save.js';
import { prepareFreshWorld, replaceActiveWorld, resetOutcomeMessage } from '../src/world-reset.js';

const geometry = createOzarkWorldGeometry();
const fresh = prepareFreshWorld(geometry);
function fixture(raw = '{broken') {
  const values = new Map([[OZARK_SAVE_KEY, raw], ['preferences', 'keep'], ['aincrad.save.v1', 'legacy']]);
  const writes = [];
  return { values, writes, getItem: key => values.get(key) ?? null,
    setItem(key, value) { writes.push([key, value]); values.set(key, value); } };
}

test('fresh canonical reset clears progress and test overrides, preserves only presentation preferences', () => {
  const previous = createOzarkState(geometry);
  previous.elapsed = 42;
  previous.agents[0].rescuePresentation = 'quiet';
  previous.agents[0].learning = false;
  previous.environment.settings.hourOverride = 22;
  previous.environment.settings.weatherOverride = 'rainy';
  const raw = prepareFreshWorld(geometry, previous);
  const state = loadOzarkSave(fixture(raw), geometry).state;
  const baseline = JSON.parse(fresh);
  assert.equal(state.elapsed, 0);
  assert.equal(state.distance, 0);
  assert.equal(state.agents[0].rescuePresentation, 'quiet');
  assert.equal(state.agents[0].learning, baseline.agents[0].learning);
  assert.deepEqual(state.environment.settings, baseline.environment.settings);
  for (const actor of state.agents) assert.equal(actor.memory.experience.length, 0);
  assert.deepEqual(state.community, baseline.community);
  assert.equal(previous.elapsed, 42);
});

test('one active-key replacement supports invalid, empty and absent old bytes without touching other storage', () => {
  for (const old of ['{broken', '', null]) {
    const disk = fixture(old);
    assert.deepEqual(replaceActiveWorld(disk, old, fresh), { ok: true, status: 'replaced', attempted: true });
    assert.deepEqual(disk.writes, [[OZARK_SAVE_KEY, fresh]]);
    assert.equal(disk.values.get('preferences'), 'keep');
    assert.equal(disk.values.get('aincrad.save.v1'), 'legacy');
    assert.equal(loadOzarkSave(disk, geometry).blocked, false);
  }
});

test('stale confirmation never replaces a newer save', () => {
  const disk = fixture('newer');
  assert.deepEqual(replaceActiveWorld(disk, 'older', fresh), { ok: false, status: 'changed', attempted: false });
  assert.equal(disk.writes.length, 0);
  assert.equal(disk.getItem(OZARK_SAVE_KEY), 'newer');
});

test('quota/write failure preserves old bytes and reports verified preservation', () => {
  const disk = fixture(); disk.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); };
  const result = replaceActiveWorld(disk, '{broken', fresh);
  assert.deepEqual(result, { ok: false, status: 'preserved', attempted: true });
  assert.match(resetOutcomeMessage(result), /Readback confirms/);
});

test('read failure never writes and uncertainty is not called preservation', () => {
  let writes = 0;
  const disk = { getItem() { throw new Error('read'); }, setItem() { writes++; } };
  const result = replaceActiveWorld(disk, 'old', fresh);
  assert.deepEqual(result, { ok: false, status: 'uncertain', attempted: false });
  assert.equal(writes, 0);
  assert.match(resetOutcomeMessage(result), /Do not assume/);
});

test('write-then-throw and unreadable readback cannot claim old save survived', () => {
  const disk = fixture('old');
  disk.setItem = (key, value) => { disk.values.set(key, value); throw new Error('after write'); };
  assert.deepEqual(replaceActiveWorld(disk, 'old', fresh), { ok: false, status: 'uncertain', attempted: true });
  assert.equal(disk.values.get(OZARK_SAVE_KEY), fresh);
  const other = fixture('old'); let reads = 0;
  other.getItem = key => { if (++reads > 1) throw new Error('readback'); return other.values.get(key); };
  assert.deepEqual(replaceActiveWorld(other, 'old', fresh), { ok: false, status: 'uncertain', attempted: true });
  assert.equal(other.writes.length, 1);
});

test('readback mismatch never rolls back over a third-party value', () => {
  const disk = fixture('old');
  disk.setItem = key => { disk.writes.push(key); disk.values.set(key, 'third-party'); };
  assert.deepEqual(replaceActiveWorld(disk, 'old', fresh), { ok: false, status: 'uncertain', attempted: true });
  assert.equal(disk.values.get(OZARK_SAVE_KEY), 'third-party');
  assert.equal(disk.writes.length, 1);
});

test('silent refused write is reported preserved only after matching readback', () => {
  const disk = fixture('old'); disk.setItem = () => {};
  assert.deepEqual(replaceActiveWorld(disk, 'old', fresh), { ok: false, status: 'preserved', attempted: true });
});

test('disposed old population rejects a delayed provider result without reviving actions', async () => {
  const { PopulationRuntime } = await import('../src/population.js');
  let resolve, cancels = 0;
  const state = createOzarkState(geometry);
  const runtime = new PopulationRuntime(state, { cardinal: false, providerFactory: () => ({
    kind: 'local-model', decide: () => new Promise(done => { resolve = done; }), cancel: () => { cancels++; },
  }) });
  const controller = runtime.controller('aster');
  controller.decide(); assert(controller.pending);
  runtime.dispose();
  const snapshot = JSON.stringify(state);
  resolve({ action: { type: 'wait', seconds: 5 }, reason: 'obsolete response' });
  await new Promise(done => setImmediate(done));
  assert.equal(controller.pending, null); assert.equal(controller.readyDecision, null);
  assert.equal(runtime.disposed, true); assert.equal(cancels, 2);
  runtime.tick(.25); assert.equal(JSON.stringify(state), snapshot);
});

test('current backup recovery reproduces valid bytes and never repairs invalid bytes', async () => {
  const { createRequire } = await import('node:module');
  const { createHash } = await import('node:crypto');
  const { decodeCurrentWorldBackup } = createRequire(import.meta.url)('../desktop/raw-save-backup.cjs');
  for (const original of [fresh, '{invalid', '']) {
    const bytes = Buffer.from(original, 'utf16le');
    const record = { format: 'aincrad.current-world-raw-backup.v1', saveKey: OZARK_SAVE_KEY,
      encoding: 'utf16le', contents: 'exact-stored-value-not-unsaved-state',
      byteLength: bytes.length, codeUnits: original.length,
      sha256: createHash('sha256').update(bytes).digest('hex'), rawBase64: bytes.toString('base64') };
    const restored = fixture(decodeCurrentWorldBackup(record).raw);
    assert.equal(restored.getItem(OZARK_SAVE_KEY), original);
    assert.equal(loadOzarkSave(restored, geometry).blocked, original !== fresh);
    assert.equal(restored.getItem(OZARK_SAVE_KEY), original, 'Recovery validation never changes bytes');
  }
});
