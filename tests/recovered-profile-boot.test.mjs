import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { inspectProfileBoot, validateProfileStatus, commitPendingCopy } from '../src/recovered-profile-boot.js';

const saveKey = 'aincrad.save.v1';
const raw = '{"version":8,"source":"copied"}', candidate = '{"version":8,"migrated":true}';
const digest = createHash('sha256').update(raw).digest('hex');
const createdAt = '2026-10-16T12:00:00.000Z';
const original = { kind: 'original', phase: 'none', available: false, sourceSha256: null, createdAt: null };
const pending = { kind: 'recovered', phase: 'pending', available: true, sourceSha256: digest, createdAt };
const ready = { ...pending, phase: 'ready' };
const stage = { raw, sha256: digest, byteLength: Buffer.byteLength(raw), createdAt };
const stored = (value = null) => {
  const values = new Map(value === null ? [] : [[saveKey, value]]), writes = [];
  return { writes, getItem: key => values.get(key) ?? null,
    setItem: (key, next) => { writes.push([key, next]); values.set(key, next); } };
};
function dependencies(status, storage, overrides = {}) {
  return { profileApi: { status: async () => status, stagedRaw: async () => stage },
    getStorage: () => storage,
    loadSave: source => source.getItem(saveKey) === candidate
      ? { exists: true, error: null, state: { features: { legacyPendingPhysicalOnly: 1 } } }
      : { exists: false, error: 'Protected source', state: null },
    prepareMigration: () => ({ ok: true, candidate }),
    hashRaw: async value => createHash('sha256').update(value).digest('hex'), saveKey, ...overrides };
}

test('profile status is checked before Local Storage, and unavailable or inconsistent status stays blocked', async () => {
  let storageCalls = 0;
  const failStorage = () => { storageCalls++; throw new Error('must not read storage first'); };
  for (const api of [null, {}, { status: async () => { throw new Error('unavailable'); } },
    { status: async () => ({ ...pending, available: false }) },
    { status: async () => ({ ...pending, phase: 'invalid', available: false, reason: 'Partial copy' }) }]) {
    const result = await inspectProfileBoot(dependencies(original, null,
      { profileApi: api, getStorage: failStorage }));
    assert.equal(result.gate, 'blocked');
    assert.match(result.reason, /profile|copy|saved data/i);
  }
  assert.equal(storageCalls, 0);
  assert.match(validateProfileStatus({ ...pending, sourceSha256: 'forged' }), /invalid source/i);
  assert.match(validateProfileStatus({ ...ready, available: false }), /availability/i);
  assert.match(validateProfileStatus({ ...original, sourceSha256: digest }), /inconsistent/i);
});

test('an original protected save keeps its raw bytes and does not construct a playable world', async () => {
  const storage = stored(raw), calls = [];
  const result = await inspectProfileBoot(dependencies(original, storage, {
    loadSave: () => { calls.push('load'); return { exists: false, error: 'Incomplete proof' }; },
    prepareMigration: value => { calls.push('preflight'); assert.equal(value, raw); return { ok: true, candidate }; },
  }));
  assert.equal(result.gate, 'original-protected');
  assert.equal(result.originalRaw, raw);
  assert.deepEqual(calls, ['load', 'preflight']);
  assert.equal(storage.getItem(saveKey), raw);
  assert.deepEqual(storage.writes, []);
});

test('an invalid recovered slot does not hide or alter the original protected save', async () => {
  const invalidSlot = { ...original, phase: 'invalid', reason: 'Incomplete recovered slot' };
  const storage = stored(raw), loaded = { exists: false, error: 'Incomplete proof' };
  const result = await inspectProfileBoot(dependencies(invalidSlot, storage, {
    loadSave: () => loaded,
  }));
  assert.equal(validateProfileStatus(invalidSlot), null);
  assert.equal(result.gate, 'original-protected');
  assert.equal(result.originalRaw, raw, 'raw backup export remains available to the original screen');
  assert.equal(result.status.available, false, 'open and create copy controls must remain disabled');
  assert.equal(result.status.phase, 'invalid');
  assert.equal(storage.getItem(saveKey), raw);
  assert.deepEqual(storage.writes, []);
  assert.equal((await inspectProfileBoot(dependencies(
    { ...invalidSlot, kind: 'recovered' }, stored(), { getStorage: () => assert.fail('invalid copy read storage') }
  ))).gate, 'blocked');
});

test('a clean original profile may play only after profile validation', async () => {
  const storage = stored(), loaded = { exists: false, error: null, state: { version: 8 } };
  const result = await inspectProfileBoot(dependencies(original, storage, { loadSave: () => loaded }));
  assert.equal(result.gate, 'play');
  assert.equal(result.loaded, loaded);
  assert.deepEqual(storage.writes, []);
});

test('pending copy accepts an exact stage only while its save key is empty', async () => {
  const storage = stored();
  const result = await inspectProfileBoot(dependencies(pending, storage));
  assert.equal(result.gate, 'pending-empty');
  assert.equal(result.plan.candidate, candidate);
  assert.deepEqual(storage.writes, []);
  for (const badStage of [{ ...stage, sha256: '0'.repeat(64) },
    { ...stage, byteLength: stage.byteLength + 1 }, { ...stage, createdAt: '2026-10-17T12:00:00Z' }]) {
    const failed = await inspectProfileBoot(dependencies(pending, stored(), {
      profileApi: { status: async () => pending, stagedRaw: async () => badStage },
    }));
    assert.equal(failed.gate, 'blocked');
  }
});

test('pending replay accepts only the exact candidate with its validated migration marker', async () => {
  const exact = stored(candidate);
  const replay = await inspectProfileBoot(dependencies(pending, exact));
  assert.equal(replay.gate, 'pending-written');
  assert.deepEqual(exact.writes, []);
  assert.equal((await inspectProfileBoot(dependencies(pending, stored('{"different":true}')))).gate, 'blocked');
  const withoutMarker = await inspectProfileBoot(dependencies(pending, stored(candidate), {
    loadSave: () => ({ exists: true, error: null, state: { features: {} } }),
  }));
  assert.equal(withoutMarker.gate, 'blocked');
});

test('ready copy requires a saved world with the permanent migration marker', async () => {
  assert.equal((await inspectProfileBoot(dependencies(ready, stored()))).gate, 'blocked');
  assert.equal((await inspectProfileBoot(dependencies(ready, stored(candidate), {
    loadSave: () => ({ exists: true, error: null, state: { features: {} } }),
  }))).gate, 'blocked');
  const playable = await inspectProfileBoot(dependencies(ready, stored(candidate)));
  assert.equal(playable.gate, 'play');
  assert.equal(playable.status.kind, 'recovered');
});

test('explicit import refuses to overwrite a nonempty copy save key', async () => {
  const storage = stored(raw);
  let loaded = false, restarted = false;
  await assert.rejects(commitPendingCopy({ storage, saveKey, candidate,
    loadSave: () => { loaded = true; }, restartRecoveredCopy: async () => { restarted = true; } }),
  /no longer empty/i);
  assert.equal(storage.getItem(saveKey), raw);
  assert.deepEqual(storage.writes, []);
  assert.equal(loaded, false);
  assert.equal(restarted, false);
});

test('explicit import handles quota and failed readback without starting a world', async () => {
  let restarted = false;
  const quota = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } };
  await assert.rejects(commitPendingCopy({ storage: quota, saveKey, candidate,
    loadSave: () => assert.fail('load after quota error'),
    restartRecoveredCopy: async () => { restarted = true; } }), /QuotaExceededError/);
  const ignored = { getItem: () => null, setItem: () => {} };
  await assert.rejects(commitPendingCopy({ storage: ignored, saveKey, candidate,
    loadSave: () => assert.fail('load after failed readback'),
    restartRecoveredCopy: async () => { restarted = true; } }), /read back exactly/i);
  assert.equal(restarted, false);
});

test('explicit import leaves a written candidate paused after validation or restart failure', async () => {
  for (const failure of ['validation', 'restart']) {
    const storage = stored();
    let restarts = 0;
    await assert.rejects(commitPendingCopy({ storage, saveKey, candidate,
      loadSave: () => failure === 'validation'
        ? { exists: true, error: 'Invalid proof' }
        : { exists: true, error: null, state: { features: { legacyPendingPhysicalOnly: 1 } } },
      restartRecoveredCopy: async () => { restarts++; throw new Error('Restart failed'); },
    }), failure === 'validation' ? /Invalid proof/ : /Restart failed/);
    assert.equal(storage.getItem(saveKey), candidate, 'no rollback after a candidate write');
    assert.equal(restarts, failure === 'validation' ? 0 : 1);
  }
});

test('explicit import succeeds only after exact readback, proof load, and restart', async () => {
  const storage = stored();
  let restarted = 0;
  const result = await commitPendingCopy({ storage, saveKey, candidate,
    loadSave: source => {
      assert.equal(source.getItem(saveKey), candidate);
      return { exists: true, error: null, state: { features: { legacyPendingPhysicalOnly: 1 } } };
    }, restartRecoveredCopy: async () => { restarted++; return { ok: true }; } });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(storage.writes, [[saveKey, candidate]]);
  assert.equal(restarted, 1);
});
