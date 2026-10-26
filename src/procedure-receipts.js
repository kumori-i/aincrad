import { DISCOVERY_RULES } from './discovery-config.js';
import { validateLedgers, knownPrimitive, time, objectId, ingestionId, bounded, adverseEffect } from './receipt-proof.js';
// Descriptive timing/effort projections only; never runtime action authority.
export const PROCEDURE_RECEIPT_LIMITS = Object.freeze({
  receipts: 400, experiments: DISCOVERY_RULES.maxExperiments, effects: 64,
});
const L = PROCEDURE_RECEIPT_LIMITS;
const text = (value, max = 80) => typeof value === 'string' ? value.slice(0, max) : null;
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) freeze(value[key]);
    Object.freeze(value);
  }
  return value;
}
function timing(receipt, experimentId = null) {
  const result = receipt?.details?.result, action = receipt?.details?.action;
  if (receipt?.type !== 'action' || typeof result?.ok !== 'boolean' ||
      !Number.isFinite(result.durationSeconds) || result.durationSeconds <= 0 || result.durationSeconds > 30) return null;
  return { actionId: receipt.id, experimentId, type: action.type,
    targetId: objectId(action.targetId) ? action.targetId : null, ok: result.ok,
    code: text(result.code, 60), at: receipt.at, activeActionSeconds: result.durationSeconds };
}
function effort(receipt, experimentId) {
  const handling = receipt?.details?.result?.handling, action = receipt?.details?.action;
  if (!handling || typeof handling !== 'object' || Array.isArray(handling) ||
      !knownPrimitive(action?.type) || handling.source !== 'experienced' ||
      !['rising', 'steady'].includes(handling.effort) ||
      !Number.isFinite(handling.activeActionSeconds) || handling.activeActionSeconds <= 0 || handling.activeActionSeconds > 30) return null;
  return { actionId: receipt.id, experimentId, type: action.type, targetId: action.targetId,
    ok: receipt.details.result.ok, code: text(receipt.details.result.code, 60), at: receipt.at,
    activeActionSeconds: handling.activeActionSeconds, effort: handling.effort, source: 'experienced' };
}
function continuity(acquisition, sample, receipts) {
  const start = acquisition.actionId, end = sample.actionId;
  if (end <= start || end - start > L.receipts || acquisition.at > sample.at) return false;
  for (let eventId = start + 1; eventId < end; eventId++) {
    const receipt = receipts.get(eventId);
    if (!receipt || !time(receipt.at) || receipt.at < acquisition.at || receipt.at > sample.at) return false;
    const action = receipt.type === 'action' ? receipt.details?.action : null;
    if (action && (([sample.targetId, acquisition.targetId].includes(action.targetId) &&
        ['release', 'grasp', 'strike', 'catch'].includes(action.type)) || receipt.details?.result?.materialId === sample.targetId)) return false;
  }
  return true;
}

export { validateLedgers, timing, effort, continuity, freeze, time, objectId, ingestionId, bounded, adverseEffect };
