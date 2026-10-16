/** Explicit experiment-only capacity. Runtime registrations are never serialized. */
export const FINITE_TEMPORAL_PROFILE = Object.freeze({
  name: 'finite-temporal-v1', rows: 256, transitions: 128,
  contextKeys: 512, contextBytes: 256 * 1024,
  receipts: 384, ingestions: 64, events: 128,
});
const profiles = new WeakMap(), encoder = new TextEncoder();
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function fail(message) { const error = new Error(message); error.code = 'TEMPORAL_CAPACITY'; throw error; }
/** Only this exact reviewed named profile is accepted; no caller-selected limits. */
export function resolveTemporalCapacity(profile) {
  if (profile === FINITE_TEMPORAL_PROFILE.name) return FINITE_TEMPORAL_PROFILE;
  if (record(profile) && Object.keys(profile).length === Object.keys(FINITE_TEMPORAL_PROFILE).length &&
      Object.entries(FINITE_TEMPORAL_PROFILE).every(([key, value]) => Object.hasOwn(profile, key) && profile[key] === value)) return FINITE_TEMPORAL_PROFILE;
  fail('Missing or unsupported temporal capacity profile.');
}
export const temporalCapacityFor = owner => profiles.get(owner) || null;
/** Exact bytes of the JSON dictionary, including brackets, escaping and commas. */
export const temporalDictionaryBytes = keys => encoder.encode(JSON.stringify(keys)).byteLength;
function rows(value, maximum, name) {
  if (!Array.isArray(value) || value.length > maximum || Array.from(value).some(row => !record(row))) fail(`Invalid or oversized temporal ${name}.`);
  return value;
}
function vector(value, length, name) {
  if (!Array.isArray(value) || value.length !== length || Array.from(value).some(v => !Number.isFinite(v))) fail(`Invalid temporal ${name}.`);
}
/** Non-mutating raw/canonical capacity and reference check, before any permissive
 * history validator. It does not replace canonical key/chronology validation.
 * Both the current wire envelope and live, explicit-dictionary ledger are accepted.
 */
export function checkTemporalCapacity(raw, profile) {
  const limits = resolveTemporalCapacity(profile);
  if (!record(raw) || raw.version !== 1) fail('Invalid temporal capacity payload.');
  const encoded = raw.encoding !== undefined;
  if (encoded && (raw.encoding !== 'temporal-key-dictionary-v1' || !record(raw.data) || raw.data.encoding !== undefined || raw.data.contextKeys !== undefined)) fail('Invalid temporal capacity wire envelope.');
  const memory = encoded ? raw.data : raw, keys = encoded ? raw.keys : memory.contextKeys;
  if (memory.version !== 1 || !record(memory.model) || memory.model.version !== 1) fail('Invalid temporal capacity model.');
  if (!Array.isArray(keys) || keys.length > limits.contextKeys || Array.from(keys).some(key => typeof key !== 'string') || new Set(keys).size !== keys.length) fail('Invalid or oversized temporal context dictionary.');
  const dictionaryBytes = temporalDictionaryBytes(keys);
  if (dictionaryBytes > limits.contextBytes) fail('Temporal context dictionary exceeds its finite-profile UTF-8 budget.');
  const index = new Set(keys);
  const reference = (key, unknown = false) => {
    if (unknown === true) { if (key === null) return; fail('Conflicting temporal unknown-context reference.'); }
    if (encoded ? !Number.isSafeInteger(key) || key < 0 || key >= keys.length : typeof key !== 'string' || !index.has(key)) fail('Invalid temporal capacity context reference.');
  };
  for (const row of rows(memory.model.rows, limits.rows, 'model rows')) { reference(row.key); vector(row.q, 5, 'forecast'); }
  for (const row of rows(memory.model.transitions, limits.transitions, 'replay records')) { reference(row.key); reference(row.nextKey); vector(row.reward, 5, 'return'); }
  for (const row of rows(memory.receipts, limits.receipts, 'submission receipts')) reference(row.key, row.unknownContext);
  rows(memory.ingestions, limits.ingestions, 'ingestion proofs'); rows(memory.events, limits.events, 'biological events');
  if (memory.open !== null) {
    if (!record(memory.open)) fail('Invalid temporal open interval.');
    reference(memory.open.key, memory.open.unknownContext); vector(memory.open.reward, 5, 'open return');
  }
  vector(memory.totals, 3, 'biological totals');
  return { profile: limits.name, dictionaryBytes, contexts: keys.length };
}
/** Reject rather than trim. Attach to both owners so successor-row creation and
 * every ledger/storage mutation see the same limits, without a saved-schema field.
 * An experiment restore must check raw input, validate normally, then reapply.
 */
export function applyTemporalCapacity(memory, profile) {
  const limits = resolveTemporalCapacity(profile);
  if (memory?.encoding !== undefined) fail('Apply temporal capacity only to a live ledger.');
  checkTemporalCapacity(memory, limits);
  profiles.set(memory, limits); profiles.set(memory.model, limits);
  return memory;
}
