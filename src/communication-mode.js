/** Runtime authority, never serialized or read from agent/community/provider data.
 * Legacy is explicit historical-fixture support, not a user-selectable mode. */
const modes = new WeakMap();
export function communicationMode(value) { return value === 'legacy' ? 'legacy' : 'grounded'; }
export function bindCommunicationMode(actor, mode = 'grounded') {
  const selected = communicationMode(mode), previous = modes.get(actor);
  if (previous && previous !== selected) throw new Error('COMMUNICATION_MODE_IMMUTABLE');
  modes.set(actor, selected);
  return selected;
}
export function legacyCommunication(actor) { return modes.get(actor) === 'legacy'; }
export function defineCommunicationMode(runtime, mode = 'grounded') {
  const selected = communicationMode(mode);
  Object.defineProperty(runtime, 'communicationMode', {value:selected, enumerable:true});
  return selected;
}
