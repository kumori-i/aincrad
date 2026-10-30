import { OZARK_SAVE_KEY, createOzarkState, writeOzarkSave, loadOzarkSave } from './ozark-save.js';

// Preparation does not touch storage or authorize ordinary save writes. Only
// known presentation preferences survive; test conditions and learning overrides
// belong to the old world, not the user's application/model configuration.
export function prepareFreshWorld(geometry, previous = null, {communicationSeed} = {}) {
  const fresh = createOzarkState(geometry, {communicationSeed});
  for (const actor of fresh.agents) {
    const preference = previous?.agents?.find(old => old.id === actor.id)?.rescuePresentation;
    if (preference === 'quiet' || preference === 'divine') actor.rescuePresentation = preference;
  }
  // The existing strict codec runs against an isolated in-memory slot only.
  // Do not grant the fresh state an expectation for the occupied live slot.
  let raw = null;
  const isolated = { getItem: () => raw, setItem: (_key, value) => { raw = value; } };
  if (!writeOzarkSave(isolated, fresh, geometry)) throw new Error('The fresh world could not be validated.');
  // Exercise the actual next-start decoder before replacing any active bytes.
  if (loadOzarkSave(isolated, geometry).blocked) throw new Error('The fresh world could not be reopened.');
  return raw;
}

// Single synchronous replacement: never removeItem/clear or rollback over a
// possible newer save. Supported desktop profiles have a single-instance lock.
// localStorage has atomic setItem, not a cross-process compare-and-swap API.
export function replaceActiveWorld(storage, expected, freshRaw) {
  let attempted = false;
  try {
    if (storage.getItem(OZARK_SAVE_KEY) !== expected)
      return { ok: false, status: 'changed', attempted };
    attempted = true;
    storage.setItem(OZARK_SAVE_KEY, freshRaw);
    const actual = storage.getItem(OZARK_SAVE_KEY);
    if (actual === freshRaw) return { ok: true, status: 'replaced', attempted };
    return { ok: false, status: actual === expected ? 'preserved' : 'uncertain', attempted };
  } catch {
    // Even a write exception is not a reason to assert preservation without
    // readback; custom storage or interrupted backends may have committed.
    try {
      const actual = storage.getItem(OZARK_SAVE_KEY);
      return { ok: false, status: actual === expected ? 'preserved' : 'uncertain', attempted };
    } catch { return { ok: false, status: 'uncertain', attempted }; }
  }
}

export const resetOutcomeMessage = result => result.ok ?
  'The active world was replaced. Opening your fresh world…' : result.status === 'changed' ?
  'The saved world changed after confirmation opened. Nothing was replaced. Reload and review the current save before trying again.' : result.status === 'preserved' ?
  'Reset failed. Readback confirms the original stored world is still present. Reload before trying again.' :
  'Reset could not be verified. The stored world may have changed. Play and saving are stopped; reload to inspect it. Do not assume the old save was preserved or deleted.';
