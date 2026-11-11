// Fixed Stage A module worker. No storage, URLs, eval, networking, or nested workers.
import {
  PROTOCOL_VERSION, PreparationError, prepareSave, validPrepareRequest,
  validReleaseRequest, identityOf, sameIdentity,
} from './preparation.js';

export function createPreparationWorker({ send, close = () => {}, now = () => performance.now() }) {
  let retained = null;
  let closed = false;
  let maxRetained = 0;
  const clock = () => { const value = now(); return Number.isFinite(value) ? value : 0; };
  function failClosed() {
    retained = null;
    closed = true;
    close();
    return false;
  }
  function handleMessage(message) {
    if (closed) return false;
    if (validReleaseRequest(message)) {
      if (!retained || !sameIdentity(retained, message)) return failClosed();
      retained = null;
      return true;
    }
    if (!validPrepareRequest(message) || retained) return failClosed();
    const identity = identityOf(message);
    const started = clock();
    let result;
    try {
      result = { ok: true, ...prepareSave(message.snapshot, { blocked: message.blocked }) };
    } catch (error) {
      result = { ok: false, code: error instanceof PreparationError ? error.code : 'validation' };
    }
    const preparationMs = Math.max(0, clock() - started);
    retained = { ...identity, ...result };
    maxRetained = Math.max(maxRetained, 1);
    try {
      send({ type: 'prepared', version: PROTOCOL_VERSION, ...identity, ...result, preparationMs });
    } catch {
      return failClosed();
    }
    return true;
  }
  return {
    handleMessage,
    dispose: failClosed,
    inspect: () => ({ closed, retainedCount: retained ? 1 : 0, retainedTextCount: retained?.ok ? 1 : 0, maxRetained }),
  };
}

if (typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope) {
  const handler = createPreparationWorker({ send: value => globalThis.postMessage(value), close: () => globalThis.close() });
  globalThis.addEventListener('message', event => handler.handleMessage(event.data));
  globalThis.addEventListener('messageerror', () => handler.dispose());
}
