// Isolated Stage A coordinator: importing it does not change the shipping application.
import { CONFIG } from '../../src/config.js';
import { writeSave } from '../../src/save.js';
import {
  PROTOCOL_VERSION, MAX_ID, validIdentity, validPreparedResponse, identityOf,
} from './preparation.js';

let nextInstance = 0;
const noop = () => {};

/**
 * getState returns the live plain world. createWorker returns a standard Worker.
 * isBlocked adds the load-boundary protection not carried by structured clone.
 * Timings are reported after the outer synchronous span ends; callback errors
 * cannot turn a committed write into a failed save. response-handler includes
 * its nested commit/dispatch stages: do not add those stages a second time.
 */
export function createSaveCoordinator({
  getState, storage, createWorker, isBlocked = () => false,
  onStatus = noop, onTiming = noop, now = () => performance.now(),
  setTimeout: schedule = globalThis.setTimeout.bind(globalThis),
  clearTimeout: cancel = globalThis.clearTimeout.bind(globalThis),
  timeoutMs = 30000, asyncEnabled = true, instanceId = `stage-a-${++nextInstance}`,
} = {}) {
  if (typeof getState !== 'function' || typeof storage?.setItem !== 'function') throw new TypeError('getState and storage are required');
  if (typeof instanceId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(instanceId)) throw new TypeError('Invalid instanceId');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2147483647) throw new TypeError('Invalid timeoutMs');
  let epoch = 1;
  let generation = 0;
  let sequence = 0;
  let retiredSequence = 0;
  let lastCommittedSequence = 0;
  let workerRecord = null;
  let flight = null;
  let dirty = false;
  let workerEnabled = !!asyncEnabled;
  let disposed = false;
  let status;
  let maxInFlight = 0;
  let captureCount = 0;
  let commitCount = 0;
  let timingDepth = 0;
  let metrics = [];
  const safe = (callback, value) => { try { callback(value); } catch { /* diagnostics never control persistence */ } };
  const clock = () => { try { const value = now(); return Number.isFinite(value) ? value : 0; } catch { return 0; } };
  const identity = id => ({ instance: instanceId, generation, epoch, id });
  function flushMetrics() {
    if (timingDepth || !metrics.length) return;
    const batch = metrics;
    metrics = [];
    for (const metric of batch) safe(onTiming, Object.freeze(metric));
  }
  function metric(stage, fields) {
    metrics.push({ stage, ...fields });
    flushMetrics();
  }
  function timed(stage, fields, operation) {
    const start = clock();
    timingDepth++;
    try { return operation(start); }
    finally {
      const end = clock();
      metrics.push({ stage, ...fields, start, end, durationMs: Math.max(0, end - start) });
      timingDepth--;
      flushMetrics();
    }
  }
  function publish(phase, details = {}) {
    status = Object.freeze({ phase, epoch, id: sequence || null, dirty, ...details });
    safe(onStatus, status);
  }
  function currentState() { try { return getState(); } catch { return null; } }
  function blocked(state) {
    try { return !state || !!isBlocked() || !!state.saveBlocked; } catch { return true; }
  }
  function allocateId() {
    if (sequence >= MAX_ID) return null;
    return ++sequence;
  }
  function active(record) {
    return !disposed && record === workerRecord && record.generation === generation && record.epoch === epoch;
  }
  function detachWorker() {
    const record = workerRecord;
    workerRecord = null;
    if (!record) return;
    for (const [type, handler] of Object.entries(record.handlers)) {
      try { record.worker.removeEventListener(type, handler); } catch { /* generation also guards saved callbacks */ }
    }
    try { record.worker.terminate(); } catch { /* stale callbacks are already invalid */ }
  }
  function retire(request) {
    if (flight !== request) return false;
    flight = null;
    if (request.timer !== null) {
      try { cancel(request.timer); } catch { /* token/generation still guards a late timeout */ }
      request.timer = null;
    }
    retiredSequence = Math.max(retiredSequence, request.id);
    return true;
  }
  function finished(request, ok, kind) {
    const end = clock();
    metric('end-to-end', { ...identityOf(request), start: request.started, end,
      durationMs: Math.max(0, end - request.started), ok, kind });
  }
  function invalidate() {
    if (flight) retire(flight);
    dirty = false;
    if (generation < MAX_ID) generation++;
    else workerEnabled = false;
    detachWorker();
  }
  function failInfrastructure(record, code) {
    if (!active(record)) return false;
    const request = flight;
    if (request) retire(request);
    dirty = false;
    workerEnabled = false;
    if (generation < MAX_ID) generation++;
    detachWorker();
    publish('failed', { kind: 'infrastructure', code });
    if (request) finished(request, false, 'infrastructure');
    return false;
  }
  function endRejected(request, kind, code) {
    dirty = false;
    publish(kind === 'protected' ? 'protected' : 'failed', { kind, code, id: request.id });
    finished(request, false, kind);
  }
  function release(record, request) {
    try {
      record.worker.postMessage({ type: 'release', version: PROTOCOL_VERSION, ...identityOf(request) });
      return true;
    } catch {
      failInfrastructure(record, 'release');
      return false;
    }
  }
  function handleResponse(record, response) {
    if (!active(record)) return;
    // An old admitted response cannot release or alter a newer attempt, even if
    // its remaining fields are malformed. Unknown/future identities fail closed.
    if (validIdentity(response) && response.instance === instanceId) {
      if (response.generation <= generation && response.epoch <= epoch
        && (response.generation < generation || response.epoch < epoch)) return;
      if (response.generation === generation && response.epoch === epoch && response.id <= retiredSequence) return;
    }
    const request = flight;
    if (!request || !validPreparedResponse(response) || response.instance !== instanceId
      || response.generation !== request.generation || response.epoch !== request.epoch || response.id !== request.id) {
      failInfrastructure(record, 'protocol');
      return;
    }
    metric('worker-preparation', { ...identityOf(request), durationMs: response.preparationMs });
    const shouldDrain = dirty;
    retire(request); // Before storage, status, or any user callbacks.
    if (!release(record, request)) {
      finished(request, false, 'infrastructure');
      return;
    }
    if (!response.ok) {
      endRejected(request, response.code === 'protected' ? 'protected' : 'validation', response.code);
      return;
    }
    if (!active(record) || currentState() !== request.state || blocked(request.state)
      || request.id <= lastCommittedSequence) {
      endRejected(request, blocked(request.state) ? 'protected' : 'validation', 'world-changed');
      return;
    }
    try {
      timed('commit', identityOf(request), () => storage.setItem(CONFIG.saveKey, response.text));
      commitCount++;
    } catch {
      endRejected(request, 'storage', 'storage');
      return;
    }
    lastCommittedSequence = request.id;
    // setItem is synchronous in the real host. This also prevents a diagnostic
    // storage adapter from publishing old status after it replaces the world.
    if (!active(record)) return;
    dirty = false;
    if (shouldDrain) {
      publish('pending', { kind: null, id: request.id, coalesced: true });
      finished(request, true, 'committed');
      if (active(record) && !flight) requestRoutine('coalesced');
    } else {
      publish('saved', { kind: null, id: request.id });
      finished(request, true, 'committed');
    }
  }
  function ensureWorker() {
    if (workerRecord) return workerRecord;
    if (generation >= MAX_ID) {
      workerEnabled = false;
      dirty = false;
      publish('failed', { kind: 'infrastructure', code: 'generation-exhausted' });
      return null;
    }
    generation++;
    const record = { worker: null, generation, epoch, handlers: {} };
    workerRecord = record;
    try {
      if (typeof createWorker !== 'function') throw new Error('Worker factory missing');
      record.worker = createWorker();
      if (!record.worker || ['postMessage', 'terminate', 'addEventListener', 'removeEventListener'].some(name => typeof record.worker[name] !== 'function')) throw new Error('Invalid worker');
      record.handlers.message = event => timed('response-handler', { instance: instanceId, generation: record.generation, epoch: record.epoch, id: flight?.id ?? null }, () => handleResponse(record, event.data));
      record.handlers.error = () => timed('failure-handler', { generation: record.generation, epoch: record.epoch }, () => failInfrastructure(record, 'error'));
      record.handlers.messageerror = () => timed('failure-handler', { generation: record.generation, epoch: record.epoch }, () => failInfrastructure(record, 'messageerror'));
      for (const [type, handler] of Object.entries(record.handlers)) record.worker.addEventListener(type, handler);
      return record;
    } catch {
      failInfrastructure(record, 'creation');
      return null;
    }
  }
  function synchronous(reason) {
    const state = currentState();
    const id = allocateId();
    if (disposed || !id) return false;
    if (blocked(state)) { publish('protected', { kind: 'protected', code: 'protected', reason }); return false; }
    const attemptEpoch = epoch;
    const attemptGeneration = generation;
    publish('pending', { kind: null, reason });
    // UI callbacks are contained, but may deliberately replace/dispose the world.
    if (disposed || epoch !== attemptEpoch || generation !== attemptGeneration || currentState() !== state) return false;
    if (blocked(state)) { publish('protected', { kind: 'protected', code: 'protected', reason }); return false; }
    let attemptedStorage = false;
    let storageFailed = false;
    let ok = false;
    try {
      ok = writeSave({ setItem(key, text) {
        attemptedStorage = true;
        try { return timed('commit', { ...identity(id), mode: 'synchronous' }, () => storage.setItem(key, text)); }
        catch (error) { storageFailed = true; throw error; }
      } }, state);
    } catch { ok = false; }
    retiredSequence = Math.max(retiredSequence, id);
    if (ok) {
      commitCount++;
      lastCommittedSequence = id;
      publish('saved', { kind: null, reason, id });
    } else publish('failed', { kind: storageFailed ? 'storage' : 'validation', code: attemptedStorage ? 'storage' : 'validation', reason, id });
    return ok;
  }
  function requestRoutine(reason = 'routine') {
    const stage = workerEnabled ? 'dispatch' : 'synchronous-request';
    return timed(stage, { instance: instanceId, epoch, reason }, started => {
      if (disposed) return false;
      const state = currentState();
      if (blocked(state)) {
        invalidate();
        publish('protected', { kind: 'protected', code: 'protected', reason });
        return false;
      }
      if (!workerEnabled) return synchronous(reason);
      if (flight) {
        if (state !== flight.state) {
          invalidate();
          publish('failed', { kind: 'validation', code: 'world-changed', reason });
          return false;
        }
        dirty = true;
        publish('pending', { kind: null, reason, id: flight.id });
        return true;
      }
      const record = ensureWorker();
      if (!record) return false;
      const id = allocateId();
      if (!id) return failInfrastructure(record, 'sequence-exhausted');
      const request = { ...identity(id), state, started, timer: null };
      flight = request;
      maxInFlight = Math.max(maxInFlight, 1);
      publish('pending', { kind: null, reason, id });
      // A status callback may synchronously replace/dispose the world.
      if (!active(record) || flight !== request) return false;
      const protectedAtDispatch = blocked(state);
      if (currentState() !== state || protectedAtDispatch) {
        invalidate();
        publish(protectedAtDispatch ? 'protected' : 'failed', {
          kind: protectedAtDispatch ? 'protected' : 'validation',
          code: protectedAtDispatch ? 'protected' : 'world-changed', reason,
        });
        return false;
      }
      try {
        request.timer = schedule(() => timed('failure-handler', identityOf(request), () => {
          if (active(record) && flight === request) failInfrastructure(record, 'timeout');
        }), timeoutMs);
        // Exactly one structured-clone boundary. Never eagerly clone the state.
        captureCount++;
        record.worker.postMessage({ type: 'prepare', version: PROTOCOL_VERSION,
          ...identityOf(request), blocked: false, snapshot: state });
      } catch {
        return failInfrastructure(record, 'dispatch');
      }
      return true;
    });
  }
  function saveSync(reason = 'barrier') {
    return timed('synchronous-request', { instance: instanceId, epoch, reason }, () => {
      if (disposed) return false;
      invalidate(); // Ordering is mandatory even when baseline validation/write fails.
      return synchronous(reason);
    });
  }
  function advanceEpoch(reason, announce) {
    if (disposed) return false;
    invalidate();
    if (epoch >= MAX_ID) {
      disposed = true;
      publish('failed', { kind: 'validation', code: 'epoch-exhausted', reason });
      return false;
    }
    epoch++;
    if (announce) publish('unsaved', { kind: null, reason });
    return true;
  }
  function invalidateWorld(reason = 'replacement') { return advanceEpoch(reason, true); }
  function replaceWorld(replace, reason = 'replacement') {
    if (typeof replace !== 'function') throw new TypeError('replace must synchronously replace the state reference');
    if (!advanceEpoch(reason, false)) return false;
    replace();
    const protectedState = blocked(currentState());
    publish(protectedState ? 'protected' : 'unsaved', { kind: protectedState ? 'protected' : null, reason });
    return true;
  }
  function dispose() {
    if (disposed) return;
    invalidate();
    disposed = true;
    publish('disposed', { kind: null });
  }
  const initiallyProtected = blocked(currentState());
  publish(initiallyProtected ? 'protected' : 'unsaved', { kind: initiallyProtected ? 'protected' : null, reason: 'initial' });
  const inspect = () => ({ instance: instanceId, epoch, generation, sequence, retiredSequence, lastCommittedSequence,
      inFlight: flight ? identityOf(flight) : null, dirty, workerEnabled, workerLive: !!workerRecord,
      captureCount, commitCount,
      retainedSnapshots: flight ? 1 : 0, maxInFlight, status, disposed });
  return {
    requestRoutine, saveSync, invalidateWorld, replaceWorld, dispose, inspect,
  };
}
