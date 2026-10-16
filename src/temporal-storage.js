/** Lossless, bounded wire storage for optional experimental learner memory.
 * Dictionary indices are serialization references, never policy features.
 */
import { decodeTemporalKey } from './temporal-returns.js';
import { temporalCapacityFor,checkTemporalCapacity } from './temporal-capacity.js';
export const TEMPORAL_STORAGE = Object.freeze({ bytes: 8 * 1024 * 1024, metadataReservation: 2 * 1024 * 1024, rowReservation: 384, rows: 4096, dictionaryEntries: 32768, encoding: 'temporal-key-dictionary-v1' });
const encoder = new TextEncoder(), caches = new WeakMap();
const fixedReservation = TEMPORAL_STORAGE.metadataReservation + TEMPORAL_STORAGE.rows * TEMPORAL_STORAGE.rowReservation;
export const temporalUtf8Bytes = value => encoder.encode(JSON.stringify(value)).byteLength;
const keyBytes = key => temporalUtf8Bytes(key) + 1; // Includes dictionary comma, conservatively even for the first entry.
function fail(message, code = 'TEMPORAL_STORAGE') { const error = new Error(message); error.code = code; throw error; }
function validKey(key) { return typeof key === 'string' && decodeTemporalKey(key); }
function referencedKeys(memory) {
  return [...(memory.model?.rows || []).map(r => r.key), ...(memory.model?.transitions || []).flatMap(t => [t.key, t.nextKey]), ...(memory.receipts || []).map(r => r.key), memory.open?.key].filter(k => typeof k === 'string');
}
function dictionary(keys, limits = null) {
  if (!Array.isArray(keys) || keys.length > (limits?.contextKeys ?? TEMPORAL_STORAGE.dictionaryEntries)) fail('Unsupported temporal context dictionary.');
  const index = new Map(); let reservedBytes = fixedReservation;
  for (const key of keys) {
    if (!validKey(key) || index.has(key)) fail('Invalid or duplicate temporal context dictionary key.');
    index.set(key, index.size); reservedBytes += keyBytes(key);
  }
  if (reservedBytes > TEMPORAL_STORAGE.bytes) fail('Temporal memory exceeds its reserved 8 MiB wire budget; original data must be preserved.', 'TEMPORAL_BUDGET');
  const dictionaryBytes = keys.length ? 1 + reservedBytes - fixedReservation : 2;
  if (limits && dictionaryBytes > limits.contextBytes) fail('Temporal context dictionary exceeds its finite-profile UTF-8 budget.', 'TEMPORAL_CAPACITY');
  return { index, reservedBytes, dictionaryBytes, length: keys.length };
}
/** Restoration-only migration includes keys that outlived row admission. */
export function prepareTemporalStorage(memory, savedKeys = undefined) {
  if (savedKeys !== undefined && !Array.isArray(savedKeys)) fail('Invalid temporal context dictionary.');
  const keys = savedKeys === undefined ? [] : [...savedKeys];
  // Validate saved entries once. Only newly referenced legacy keys need decoding.
  const limits = temporalCapacityFor(memory), cache = dictionary(keys, limits);
  for (const key of referencedKeys(memory)) if (!cache.index.has(key)) {
    if (savedKeys !== undefined) fail('Temporal proof references a context missing from its explicit dictionary.');
    if (!validKey(key)) fail('Invalid referenced temporal context.');
    const bytes = keyBytes(key);
    if (cache.length >= (limits?.contextKeys ?? TEMPORAL_STORAGE.dictionaryEntries) || limits && cache.dictionaryBytes + bytes - (cache.length ? 0 : 1) > limits.contextBytes || cache.reservedBytes + bytes > TEMPORAL_STORAGE.bytes) fail('Temporal memory exceeds its reserved 8 MiB wire budget; original data must be preserved.', 'TEMPORAL_BUDGET');
    cache.dictionaryBytes += bytes - (cache.length ? 0 : 1);
    cache.index.set(key, cache.length++); cache.reservedBytes += bytes; keys.push(key);
  }
  memory.contextKeys = keys;
  memory.storage = { saturated: memory.storage?.saturated === true, overflows: Number.isSafeInteger(memory.storage?.overflows) && memory.storage.overflows >= 0 ? Math.min(1e9, memory.storage.overflows) : 0 };
  caches.set(memory, cache); return memory;
}
function cacheFor(memory) {
  let cache = caches.get(memory);
  if (!cache || cache.length !== memory.contextKeys?.length) {
    cache = dictionary(memory.contextKeys || [], temporalCapacityFor(memory)); caches.set(memory, cache);
  }
  return cache;
}
/** Only actual context submission may spend capacity. Existing keys stay admitted. */
export function admitTemporalContext(memory, key) {
  if (!validKey(key)) fail('Invalid submitted temporal context.');
  const cache = cacheFor(memory), limits = temporalCapacityFor(memory);
  if (cache.index.has(key)) return true;
  const bytes = keyBytes(key);
  if (cache.index.size >= (limits?.contextKeys ?? TEMPORAL_STORAGE.dictionaryEntries) || limits && cache.dictionaryBytes + bytes - (cache.length ? 0 : 1) > limits.contextBytes || cache.reservedBytes + bytes > TEMPORAL_STORAGE.bytes) {
    memory.storage.saturated = true; memory.storage.overflows = Math.min(1e9, memory.storage.overflows + 1); return false;
  }
  cache.dictionaryBytes += bytes - (cache.length ? 0 : 1);
  cache.index.set(key, cache.index.size); cache.reservedBytes += bytes;
  memory.contextKeys.push(key); cache.length++; return true;
}
export function temporalStorageDiagnostics(memory) {
  const cache = cacheFor(memory), limits = temporalCapacityFor(memory);
  return { limitBytes: TEMPORAL_STORAGE.bytes, reservedBytes: cache.reservedBytes, contexts: cache.length, saturated: memory.storage?.saturated === true, overflows: memory.storage?.overflows || 0, ...(limits ? { profile: limits.name, dictionaryBytes: cache.dictionaryBytes, dictionaryLimitBytes: limits.contextBytes, contextLimit: limits.contextKeys } : {}) };
}
function reference(index, key, unknown = false) {
  if (unknown === true) { if (key === null) return null; fail('Unknown temporal context has a conflicting reference.'); }
  if (typeof key !== 'string' || !index.has(key)) fail('Temporal proof references an unadmitted context.');
  return index.get(key);
}
/** Called after canonical validation. Does not admit, train, evict or mutate. */
export function encodeTemporalWire(memory) {
  const limits = temporalCapacityFor(memory);
  if (limits) checkTemporalCapacity(memory, limits);
  // Cached keys were canonicalized at admission/restore. A cheap identity scan
  // detects external mutation without repeatedly decoding thousands of strings.
  let cache = caches.get(memory);
  if (!cache || cache.length !== memory.contextKeys?.length || memory.contextKeys.some((key, i) => cache.index.get(key) !== i)) cache = dictionary(memory.contextKeys || [], limits);
  const { contextKeys, ...rest } = memory;
  const model = { ...memory.model,
    rows: memory.model.rows.map(r => ({ ...r, key: reference(cache.index, r.key) })),
    transitions: memory.model.transitions.map(t => ({ ...t, key: reference(cache.index, t.key), nextKey: reference(cache.index, t.nextKey) })),
  };
  const data = { ...rest, model,
    receipts: memory.receipts.map(r => ({ ...r, key: reference(cache.index, r.key, r.unknownContext) })),
    open: memory.open ? { ...memory.open, key: reference(cache.index, memory.open.key, memory.open.unknownContext) } : null,
  };
  const packed = { version: 1, encoding: TEMPORAL_STORAGE.encoding, keys: [...contextKeys], data };
  if (temporalUtf8Bytes(packed) > TEMPORAL_STORAGE.bytes) fail('Temporal reservation invariant failed; refusing to overwrite the save.', 'TEMPORAL_BUDGET');
  return packed;
}
function boundedRows(value, maximum, name) {
  if (!Array.isArray(value) || value.length > maximum || Array.from(value).some(v => !v || typeof v !== 'object' || Array.isArray(v))) fail(`Invalid temporal ${name}.`);
  return value;
}
/** Strict envelope decoding precedes permissive old-history validation. */
export function decodeTemporalWire(raw) {
  if (!raw || raw.version !== 1) fail('Unsupported temporal memory version.');
  if ((raw.encoding === undefined ? raw : raw.data)?.model?.version !== 1) fail('Unsupported temporal predictor version.');
  if (raw.encoding === undefined) {
    // Check contradiction before permissive history normalization can erase it.
    for (const row of [...(Array.isArray(raw.receipts) ? raw.receipts : []), raw.open].filter(Boolean)) {
      if ((row.key === null) !== (row.unknownContext === true)) fail('Conflicting raw temporal unknown-context reference.');
    }
    return raw;
  }
  if (raw.encoding !== TEMPORAL_STORAGE.encoding || !raw.data || raw.data.version !== 1 || raw.data.encoding !== undefined || raw.data.contextKeys !== undefined) fail('Unsupported temporal wire encoding.');
  if (temporalUtf8Bytes(raw) > TEMPORAL_STORAGE.bytes) fail('Temporal wire data exceeds 8 MiB; original save is preserved.', 'TEMPORAL_BUDGET');
  dictionary(raw.keys);
  const resolve = (index, unknown = false) => {
    if (unknown === true) { if (index === null) return null; fail('Unknown temporal context has a conflicting reference.'); }
    if (!Number.isSafeInteger(index) || index < 0 || index >= raw.keys.length) fail('Invalid temporal dictionary reference.');
    return raw.keys[index];
  };
  const d = raw.data;
  boundedRows(d.ingestions, 256, 'ingestion receipts'); boundedRows(d.events, 256, 'events');
  return { ...d, contextKeys: [...raw.keys], model: { ...d.model,
    rows: boundedRows(d.model?.rows, 4096, 'model rows').map(r => ({ ...r, key: resolve(r.key) })),
    transitions: boundedRows(d.model?.transitions, 512, 'replay records').map(t => ({ ...t, key: resolve(t.key), nextKey: resolve(t.nextKey) })),
  }, receipts: boundedRows(d.receipts, 768, 'submission receipts').map(r => ({ ...r, key: resolve(r.key, r.unknownContext) })),
  open: d.open === null ? null : d.open && typeof d.open === 'object' && !Array.isArray(d.open) ? { ...d.open, key: resolve(d.open.key, d.open.unknownContext) } : fail('Invalid temporal open interval.') };
}
