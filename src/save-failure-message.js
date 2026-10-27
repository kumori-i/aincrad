// Fixed labels only. Storage exceptions and world contents never become UI text.
const labels = Object.freeze({
  'untracked-state': 'this session is not authorized to replace the current save',
  'stored-value-changed': 'the stored world differs from this session’s expected saved value',
  'live-validation': 'the live world failed strict save validation',
  'serialization': 'the live world could not be serialized',
  'save-too-large': 'the serialized world exceeds the supported save size',
  'storage-read': 'the current stored world could not be read (storage access)',
  'quota-write': 'the storage write reported a quota limit; the stored result was not verified',
  'storage-write': 'the storage write failed; the stored result was not verified',
  'readback-verification': 'the storage write could not be verified by readback',
});
export function saveFailureMessage(code) {
  return `World not saved: ${Object.hasOwn(labels, code) ? labels[code] : 'the save could not be verified'}. Play is paused; no automatic reset or cleanup was performed.`;
}
