// Stage A only. The shipping save implementation remains the sole schema/guard authority.
import { CONFIG } from '../../src/config.js';
import { writeSave } from '../../src/save.js';

export const PROTOCOL_VERSION = 1;
export const MAX_PREPARED_BYTES = 64 * 1024 * 1024;
export const MAX_ID = Number.MAX_SAFE_INTEGER;
export const PREPARATION_ERROR_CODES = Object.freeze(['protected', 'validation', 'too-large']);
const IDENTITY_KEYS = ['instance', 'generation', 'epoch', 'id'];

export class PreparationError extends Error {
  constructor(code) {
    super(`Save preparation rejected: ${code}`);
    this.name = 'PreparationError';
    this.code = code;
  }
}

export function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Reflect.ownKeys(value);
  return actual.length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
export function validId(value) {
  return Number.isSafeInteger(value) && value >= 1 && value <= MAX_ID;
}
export function validIdentity(value) {
  return !!value && typeof value.instance === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value.instance)
    && ['generation', 'epoch', 'id'].every(key => validId(value[key]));
}
export function identityOf(value) {
  return Object.fromEntries(IDENTITY_KEYS.map(key => [key, value[key]]));
}
export function sameIdentity(a, b) {
  return IDENTITY_KEYS.every(key => a[key] === b[key]);
}
export function validPrepareRequest(value) {
  return exactKeys(value, ['type', 'version', ...IDENTITY_KEYS, 'blocked', 'snapshot'])
    && value.type === 'prepare' && value.version === PROTOCOL_VERSION && validIdentity(value)
    && typeof value.blocked === 'boolean' && value.snapshot !== null
    && typeof value.snapshot === 'object' && !Array.isArray(value.snapshot);
}
export function validReleaseRequest(value) {
  return exactKeys(value, ['type', 'version', ...IDENTITY_KEYS])
    && value.type === 'release' && value.version === PROTOCOL_VERSION && validIdentity(value);
}

// Count UTF-8 without allocating an additional full-size encoded buffer. Unpaired
// surrogates encode as replacement characters, like TextEncoder/structured clone.
export function utf8ByteLength(text) {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length
      && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

export function prepareSave(state, { blocked = false } = {}) {
  if (blocked || state?.saveBlocked) throw new PreparationError('protected');
  let text;
  let calls = 0;
  let accepted = false;
  try {
    accepted = writeSave({ setItem(key, value) {
      calls++;
      if (key !== CONFIG.saveKey || typeof value !== 'string') throw new Error('Invalid stable save sink');
      text = value;
    } }, state);
  } catch {
    throw new PreparationError('validation');
  }
  if (!accepted || calls !== 1 || !text) throw new PreparationError('validation');
  if (text.length > MAX_PREPARED_BYTES) throw new PreparationError('too-large');
  const bytes = utf8ByteLength(text);
  if (bytes > MAX_PREPARED_BYTES) throw new PreparationError('too-large');
  return { text, bytes };
}

// Deliberately bounded transport checks, not a second semantic save validator.
// The renderer does not JSON.parse or re-encode the returned canonical text.
export function validPreparedResponse(value) {
  if (!value || typeof value !== 'object' || value.type !== 'prepared'
    || value.version !== PROTOCOL_VERSION || !validIdentity(value)
    || typeof value.ok !== 'boolean' || !Number.isFinite(value.preparationMs)
    || value.preparationMs < 0) return false;
  const common = ['type', 'version', ...IDENTITY_KEYS, 'ok', 'preparationMs'];
  if (!value.ok) return exactKeys(value, [...common, 'code']) && PREPARATION_ERROR_CODES.includes(value.code);
  return exactKeys(value, [...common, 'text', 'bytes'])
    && typeof value.text === 'string' && value.text.length > 0 && value.text.length <= MAX_PREPARED_BYTES
    && Number.isSafeInteger(value.bytes) && value.bytes >= value.text.length
    && value.bytes <= 3 * value.text.length && value.bytes <= MAX_PREPARED_BYTES;
}
