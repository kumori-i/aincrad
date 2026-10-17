import test from 'node:test';
import assert from 'node:assert/strict';
import { freshState } from '../../src/world.js';
import { writeSave, loadSave } from '../../src/save.js';
import { CONFIG } from '../../src/config.js';
import { createSaveCoordinator } from './coordinator.js';
import { prepareSave } from './preparation.js';

class Timers {
  next = 1;
  live = new Map();
  history = new Map();
  set = callback => { const id = this.next++; this.live.set(id, callback); this.history.set(id, callback); return id; };
  clear = id => { this.live.delete(id); };
  fire(id) { this.live.delete(id); this.history.get(id)?.(); }
}
class FakeWorker {
  handlers = new Map();
  capturedHandlers = new Map();
  prepares = [];
  originalSources = [];
  releases = [];
  terminated = false;
  failDispatch = false;
  failRelease = false;
  addEventListener(type, callback) { this.handlers.set(type, callback); this.capturedHandlers.set(type, callback); }
  removeEventListener(type, callback) { if (this.handlers.get(type) === callback) this.handlers.delete(type); }
  postMessage(message) {
    if (message.type === 'prepare') {
      if (this.failDispatch) throw new Error('clone failure');
      this.originalSources.push(message.snapshot);
      this.prepares.push(structuredClone(message));
    } else {
      if (this.failRelease) throw new Error('release failure');
      this.releases.push(structuredClone(message));
    }
  }
  terminate() { this.terminated = true; }
  emit(type, data, stale = false) { (stale ? this.capturedHandlers : this.handlers).get(type)?.({ data }); }
  response(index = 0, overrides = {}) {
    const { instance, generation, epoch, id, snapshot } = this.prepares[index];
    return { type: 'prepared', version: 1, instance, generation, epoch, id, ok: true, ...prepareSave(snapshot), preparationMs: 2, ...overrides };
  }
}
function setup(t, options = {}) {
  let state = options.state ?? freshState({ mode: 'legacy' });
  let protectedFlag = false;
  let storageFails = false;
  let clock = 0;
  const timers = new Timers();
  const workers = [];
  const statuses = [];
  const timings = [];
  const writes = [];
  let disk = 'existing bytes';
  const coordinator = createSaveCoordinator({
    getState: () => state,
    storage: { setItem(key, text) {
      options.beforeStorage?.(coordinator);
      assert.equal(key, CONFIG.saveKey);
      if (storageFails) throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
      writes.push(text); disk = text;
    } },
    createWorker: () => { const worker = new FakeWorker(); workers.push(worker); options.configureWorker?.(worker); return worker; },
    isBlocked: () => protectedFlag,
    onStatus: value => { statuses.push(value); options.onStatus?.(value); },
    onTiming: value => { timings.push(value); options.onTiming?.(value); },
    now: () => ++clock,
    setTimeout: timers.set,
    clearTimeout: timers.clear,
    instanceId: 'coordinator-test',
    ...options.coordinator,
  });
  t.after(() => { coordinator.dispose(); assert.equal(timers.live.size, 0, 'no timers remain'); });
  return { coordinator, timers, workers, statuses, timings, writes,
    state: () => state, setState: value => { state = value; },
    setBlocked: value => { protectedFlag = value; },
    setStorageFails: value => { storageFails = value; }, disk: () => disk,
  };
}
function success(h, index = 0, worker = h.workers[0]) { worker.emit('message', worker.response(index)); }
function baseline(state) { let result; assert.equal(writeSave({ setItem(_key, text) { result = text; } }, state), true); return result; }

test('fresh status is unsaved and a coherent once-captured response commits exact canonical bytes', t => {
  const h = setup(t);
  const state = h.state();
  assert.equal(h.coordinator.inspect().status.phase, 'unsaved');
  assert.equal(h.coordinator.requestRoutine(), true);
  const worker = h.workers[0];
  assert.equal(worker.originalSources[0], state, 'postMessage receives live source directly without eager clone');
  assert.equal(worker.prepares.length, 1);
  const expected = baseline(state);
  state.selectedAgentId = 'mira';
  success(h);
  assert.deepEqual(h.writes, [expected]);
  assert.equal(h.coordinator.inspect().status.phase, 'saved');
  assert.equal(h.coordinator.inspect().retainedSnapshots, 0);
  assert.equal(worker.releases.length, 1);
  assert.equal(h.timers.live.size, 0);
});

test('request storm retains one capture plus one dirty bit and drains exactly one fresh snapshot', t => {
  const h = setup(t);
  h.coordinator.requestRoutine();
  for (let i = 0; i < 1000; i++) h.coordinator.requestRoutine('storm');
  h.state().selectedAgentId = 'mira';
  assert.equal(h.workers[0].prepares.length, 1);
  assert.equal(h.coordinator.inspect().retainedSnapshots, 1);
  assert.equal(h.coordinator.inspect().dirty, true);
  success(h);
  assert.equal(h.writes.length, 1);
  assert.equal(h.workers[0].prepares.length, 2);
  assert.equal(h.coordinator.inspect().status.phase, 'pending');
  assert.equal(h.statuses.some(status => status.phase === 'saved'), false);
  success(h, 1);
  assert.equal(h.writes.length, 2);
  assert.notEqual(h.writes[0], h.writes[1]);
  assert.equal(JSON.parse(h.writes[1]).selectedAgentId, 'mira');
  assert.equal(h.coordinator.inspect().maxInFlight, 1);
  assert.equal(h.coordinator.inspect().captureCount, 2);
  assert.equal(h.coordinator.inspect().status.phase, 'saved');
});

test('retired same-time duplicate cannot release or update a later request, including a malformed duplicate', t => {
  const h = setup(t, { coordinator: { now: () => 1 } });
  h.coordinator.requestRoutine();
  const old = h.workers[0].response();
  success(h);
  h.coordinator.requestRoutine();
  const before = h.coordinator.inspect();
  const statusCount = h.statuses.length;
  h.workers[0].emit('message', old);
  h.workers[0].emit('message', { ...old, text: '', version: 999, extra: true });
  assert.deepEqual(h.coordinator.inspect(), before);
  assert.equal(h.statuses.length, statusCount);
  assert.equal(h.workers[0].releases.length, 1);
  success(h, 1);
  assert.equal(h.writes.length, 2);
});

for (const reason of ['new', 'load', 'reset']) test(`${reason} invalidates epoch before replacing state; stale callbacks cannot affect the new world`, t => {
  const h = setup(t);
  h.coordinator.requestRoutine();
  const oldWorker = h.workers[0];
  const oldResponse = oldWorker.response();
  const oldEpoch = h.coordinator.inspect().epoch;
  const oldTimer = [...h.timers.live.keys()][0];
  const next = freshState({ mode: 'legacy' }); next.selectedAgentId = 'mira';
  h.coordinator.replaceWorld(() => {
    assert.ok(h.coordinator.inspect().epoch > oldEpoch);
    assert.equal(oldWorker.terminated, true);
    h.setState(next);
  }, reason);
  h.coordinator.requestRoutine();
  const before = h.coordinator.inspect();
  for (const type of ['message', 'error', 'messageerror']) oldWorker.emit(type, oldResponse, true);
  h.timers.fire(oldTimer);
  assert.deepEqual(h.coordinator.inspect(), before);
  assert.equal(h.writes.length, 0);
  success(h, 0, h.workers[1]);
  assert.equal(JSON.parse(h.disk()).selectedAgentId, 'mira');
});

test('unannounced state-reference replacement refuses an old prepared record', t => {
  const h = setup(t);
  h.coordinator.requestRoutine();
  h.setState(freshState({ mode: 'legacy' }));
  success(h);
  assert.equal(h.writes.length, 0);
  assert.equal(h.coordinator.inspect().status.code, 'world-changed');
  assert.equal(h.coordinator.inspect().dirty, false);
});

for (const mode of ['explicit', 'state-property']) test(`non-enumerable/source protection (${mode}) rejects before capture and rechecks at commit`, t => {
  const state = freshState({ mode: 'legacy' });
  if (mode === 'state-property') Object.defineProperty(state, 'saveBlocked', { configurable: true, value: true, enumerable: false });
  const h = setup(t, { state });
  if (mode === 'explicit') h.setBlocked(true);
  if (mode === 'state-property') assert.equal(h.coordinator.inspect().status.phase, 'protected');
  assert.equal(h.coordinator.requestRoutine(), false);
  assert.equal(h.workers.length, 0);
  assert.equal(h.coordinator.saveSync(), false);
  if (mode === 'explicit') h.setBlocked(false); else delete state.saveBlocked;
  h.coordinator.requestRoutine();
  if (mode === 'explicit') h.setBlocked(true); else Object.defineProperty(state, 'saveBlocked', { value: true, enumerable: false });
  success(h);
  assert.equal(h.writes.length, 0);
  assert.equal(h.disk(), 'existing bytes');
  assert.equal(h.coordinator.inspect().status.phase, 'protected');
});

for (const reason of ['manual', 'unload', 'reload', 'pagehide']) test(`${reason} synchronous barrier invalidates pending work before writing current state`, t => {
  const h = setup(t);
  h.coordinator.requestRoutine();
  const worker = h.workers[0];
  const reply = worker.response();
  h.state().selectedAgentId = 'mira';
  h.coordinator.requestRoutine();
  assert.equal(h.coordinator.saveSync(reason), true);
  assert.equal(worker.terminated, true);
  assert.equal(h.coordinator.inspect().dirty, false);
  assert.equal(h.timers.live.size, 0);
  const count = h.statuses.length;
  worker.emit('message', reply, true);
  worker.emit('error', null, true);
  assert.equal(h.statuses.length, count);
  assert.equal(h.writes.length, 1);
  assert.equal(h.disk(), baseline(h.state()));
});

test('failed barrier still invalidates old work and preserves old disk, later cancelled-close routine may create fresh worker', t => {
  const h = setup(t);
  h.coordinator.requestRoutine();
  const worker = h.workers[0]; const response = worker.response();
  h.setStorageFails(true);
  assert.equal(h.coordinator.saveSync('unload'), false);
  assert.equal(h.coordinator.inspect().status.kind, 'storage');
  worker.emit('message', response, true);
  assert.equal(h.disk(), 'existing bytes');
  h.setStorageFails(false);
  assert.equal(h.coordinator.requestRoutine('cancelled-close'), true);
  assert.equal(h.workers.length, 2);
  success(h, 0, h.workers[1]);
  assert.equal(h.writes.length, 1);
});

for (const type of ['error', 'messageerror', 'timeout']) test(`${type} clears dirty work, retains disk and latches worker off until a later independent synchronous request`, t => {
  const h = setup(t);
  h.coordinator.requestRoutine(); h.coordinator.requestRoutine();
  const worker = h.workers[0]; const old = worker.response();
  if (type === 'timeout') h.timers.fire([...h.timers.live.keys()][0]); else worker.emit(type);
  assert.equal(h.coordinator.inspect().workerEnabled, false);
  assert.equal(h.coordinator.inspect().status.kind, 'infrastructure');
  assert.equal(h.coordinator.inspect().dirty, false);
  assert.equal(h.coordinator.inspect().retainedSnapshots, 0);
  assert.equal(h.writes.length, 0);
  assert.equal(h.disk(), 'existing bytes');
  worker.emit('message', old, true);
  const count = h.statuses.length;
  worker.emit(type, null, true);
  assert.equal(h.statuses.length, count);
  assert.equal(h.coordinator.requestRoutine('next-autosave'), true);
  assert.equal(h.writes.length, 1);
  assert.equal(h.workers.length, 1);
  assert.equal(h.coordinator.inspect().status.phase, 'saved');
});

for (const [name, change] of [
  ['extra key', { extra: true }], ['future ID', { id: 2 }], ['missing identity', { id: undefined }],
  ['future epoch', { epoch: 2 }], ['future generation', { generation: 2 }], ['wrong instance', { instance: 'other' }],
  ['wrong version', { version: 2 }], ['nonboolean outcome', { ok: 1 }], ['empty text', { text: '' }],
  ['implausible byte count', { bytes: 1 }], ['nonfinite timing', { preparationMs: Infinity }],
]) test(`malformed current response (${name}) fails closed without automatic fallback`, t => {
  const h = setup(t);
  h.coordinator.requestRoutine(); h.coordinator.requestRoutine();
  h.workers[0].emit('message', h.workers[0].response(0, change));
  assert.equal(h.coordinator.inspect().workerEnabled, false);
  assert.equal(h.coordinator.inspect().status.code, 'protocol');
  assert.equal(h.coordinator.inspect().dirty, false);
  assert.equal(h.writes.length, 0);
  assert.equal(h.timers.live.size, 0);
});

for (const code of ['validation', 'protected', 'too-large']) test(`worker ${code} rejection clears coalescing without disabling guards or draining retries`, t => {
  const h = setup(t);
  h.coordinator.requestRoutine(); h.coordinator.requestRoutine();
  const { text, bytes, ...response } = h.workers[0].response();
  h.workers[0].emit('message', { ...response, ok: false, code });
  assert.equal(h.coordinator.inspect().workerEnabled, true);
  assert.equal(h.coordinator.inspect().dirty, false);
  assert.equal(h.workers[0].prepares.length, 1);
  assert.equal(h.writes.length, 0);
  assert.equal(h.coordinator.inspect().status.code, code);
  h.coordinator.requestRoutine('later-independent');
  success(h, 1);
  assert.equal(h.writes.length, 1);
});

test('quota rejection retires first and never announces success or drains dirty work', t => {
  let retiredDuringCommit;
  const h = setup(t, { beforeStorage: coordinator => { retiredDuringCommit = coordinator.inspect().inFlight === null; } });
  h.coordinator.requestRoutine(); h.coordinator.requestRoutine();
  h.setStorageFails(true); success(h);
  assert.equal(retiredDuringCommit, true);
  assert.equal(h.coordinator.inspect().status.kind, 'storage');
  assert.equal(h.coordinator.inspect().dirty, false);
  assert.equal(h.coordinator.inspect().workerEnabled, true);
  assert.equal(h.statuses.some(status => status.phase === 'saved'), false);
  assert.equal(h.workers[0].prepares.length, 1);
  assert.equal(h.disk(), 'existing bytes');
  h.setStorageFails(false);
  h.coordinator.requestRoutine('later-independent'); success(h, 1);
  assert.equal(h.writes.length, 1);
});

test('creation, dispatch and release errors are infrastructure, with no same-frame synchronous write', t => {
  for (const kind of ['creation', 'dispatch', 'release']) {
    const h = setup(t, {
      coordinator: kind === 'creation' ? { createWorker() { throw new Error('disabled'); } } : {},
      configureWorker: worker => { worker.failDispatch = kind === 'dispatch'; worker.failRelease = kind === 'release'; },
    });
    h.coordinator.requestRoutine();
    if (kind === 'release') success(h);
    assert.equal(h.coordinator.inspect().status.kind, 'infrastructure');
    assert.equal(h.coordinator.inspect().workerEnabled, false);
    assert.equal(h.writes.length, 0);
    assert.equal(h.timers.live.size, 0);
    assert.equal(h.coordinator.requestRoutine('later'), true);
    assert.equal(h.writes.length, 1);
  }
});

test('development-disabled worker path and later infrastructure fallback both preserve validation/protection guards', t => {
  const h = setup(t, { coordinator: { asyncEnabled: false } });
  assert.equal(h.coordinator.requestRoutine(), true);
  assert.equal(h.workers.length, 0);
  const disk = h.disk();
  for (const state of [{ version: 7 }, { version: 99 }, loadSave({ getItem: () => '{bad' }).state]) {
    h.coordinator.replaceWorld(() => h.setState(state));
    assert.equal(h.coordinator.requestRoutine(), false);
    assert.equal(h.disk(), disk);
  }
});

test('dispose detaches and guards all late callbacks; diagnostic failures do not alter saved success', t => {
  const h = setup(t, { onTiming() { throw new Error('diagnostic failure'); }, onStatus() { throw new Error('UI failure'); } });
  h.coordinator.requestRoutine();
  const worker = h.workers[0]; const response = worker.response();
  success(h);
  assert.equal(h.coordinator.inspect().status.phase, 'saved');
  h.coordinator.requestRoutine();
  const timer = [...h.timers.live.keys()][0];
  h.coordinator.dispose();
  const count = h.statuses.length;
  for (const type of ['message', 'error', 'messageerror']) worker.emit(type, response, true);
  h.timers.fire(timer);
  assert.equal(h.statuses.length, count);
  assert.equal(h.coordinator.requestRoutine(), false);
  assert.equal(h.coordinator.saveSync(), false);
  assert.equal(h.writes.length, 1);
});

test('all response validation, status, release and commit are within whole-handler timing; diagnostics are out of band', t => {
  const h = setup(t);
  h.coordinator.requestRoutine(); success(h);
  const dispatch = h.timings.find(row => row.stage === 'dispatch');
  const response = h.timings.find(row => row.stage === 'response-handler');
  const commit = h.timings.find(row => row.stage === 'commit');
  const worker = h.timings.find(row => row.stage === 'worker-preparation');
  const total = h.timings.find(row => row.stage === 'end-to-end');
  assert.ok(dispatch && response && commit && worker && total);
  assert.ok(commit.start >= response.start && commit.end <= response.end);
  assert.ok(response.durationMs >= commit.durationMs);
  assert.equal(worker.durationMs, 2);
  assert.equal(total.ok, true);
  assert.equal(commit.id, total.id);
});

test('late timeout from an already retired request cannot fail a newer request on the same worker', t => {
  const h = setup(t);
  h.coordinator.requestRoutine();
  const timer = [...h.timers.live.keys()][0];
  success(h);
  h.coordinator.requestRoutine();
  const before = h.coordinator.inspect();
  h.timers.fire(timer);
  assert.deepEqual(h.coordinator.inspect(), before);
  success(h, 1);
  assert.equal(h.writes.length, 2);
});

test('same-clock lifecycle barriers never deduplicate a later mutation', t => {
  const h = setup(t, { coordinator: { now: () => 0 } });
  assert.equal(h.coordinator.saveSync('beforeunload'), true);
  h.state().selectedAgentId = 'mira';
  assert.equal(h.coordinator.saveSync('pagehide'), true);
  assert.equal(h.writes.length, 2);
  assert.notEqual(h.writes[0], h.writes[1]);
  assert.equal(JSON.parse(h.writes[1]).selectedAgentId, 'mira');
});

test('stale epoch and generation payload received by current worker cannot release its pending capture', t => {
  const h = setup(t);
  h.coordinator.requestRoutine();
  const response = h.workers[0].response();
  h.coordinator.replaceWorld(() => h.setState(freshState({ mode: 'legacy' })));
  h.coordinator.requestRoutine();
  const current = h.workers[1];
  const before = h.coordinator.inspect();
  current.emit('message', { ...response, text: '', extra: true });
  assert.deepEqual(h.coordinator.inspect(), before);
  assert.equal(current.releases.length, 0);
  success(h, 0, current);
});

test('trusted worker arbitrary nonempty text is transport-accepted, explicitly not semantic Byzantine detection', t => {
  const h = setup(t);
  h.coordinator.requestRoutine();
  h.workers[0].emit('message', h.workers[0].response(0, { text: 'trusted text', bytes: 12 }));
  assert.equal(h.disk(), 'trusted text');
  assert.equal(h.coordinator.inspect().status.phase, 'saved');
});

test('protection changed by the pending callback is rechecked immediately before postMessage and sync write', t => {
  for (const asyncEnabled of [true, false]) {
    let h;
    h = setup(t, { coordinator: { asyncEnabled }, onStatus(status) {
      if (status.phase === 'pending') h.setBlocked(true);
    } });
    assert.equal(h.coordinator.requestRoutine(), false);
    assert.equal(h.coordinator.inspect().status.phase, 'protected');
    assert.equal(h.writes.length, 0);
    assert.equal(h.workers[0]?.prepares.length ?? 0, 0);
  }
});

test('new world status is emitted only after state replacement, allowing a truthful protected-load label', t => {
  let h;
  let replacementHappened = false;
  const observations = [];
  h = setup(t, { onStatus(status) {
    if (status.reason === 'protected-load') observations.push(replacementHappened);
  } });
  const protectedState = freshState({ mode: 'legacy' });
  Object.defineProperty(protectedState, 'saveBlocked', { value: true, enumerable: false });
  h.coordinator.replaceWorld(() => { h.setState(protectedState); replacementHappened = true; }, 'protected-load');
  assert.deepEqual(observations, [true]);
  assert.equal(h.coordinator.inspect().status.phase, 'protected');
  assert.equal(h.coordinator.requestRoutine(), false);
  assert.equal(h.writes.length, 0);
});
