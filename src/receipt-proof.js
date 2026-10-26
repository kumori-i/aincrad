import { matchingFinishedMaterial } from './discovery-completion.js';
import { matchingResultObject } from './discovery-result-object.js';
import { validCaptureExperiment } from './discovery-state.js';
// Shared pure provenance checks over bounded retained receipt inputs.
// No action selection, experience projection, mutation or inference of cause.
const primitives = new Set(['inspect_object', 'grasp', 'release', 'pull', 'sample', 'strike', 'catch']);
const effectKinds = new Set(['sustained', 'water relief', 'discomfort', 'no noticeable change']);
const shortString = (value, max = 80) => typeof value === 'string' && value.length <= max;
const knownPrimitive = value => shortString(value, 32) && primitives.has(value);
const knownEffect = value => shortString(value, 32) && effectKinds.has(value);
const adverseEffect = effect => effect?.effect === 'discomfort' || ['aching', 'hurting'].includes(effect?.pain);
const id = value => Number.isSafeInteger(value) && value > 0;
const time = value => Number.isFinite(value) && value >= 0;
const objectId = value => typeof value === 'string' && value.length <= 16 && /^object:\d{1,9}$/.test(value);
const ingestionId = value => typeof value === 'string' && value.length <= 80 && /^ingestion:\d+$/.test(value);
const bounded = (value, max) => Array.isArray(value) && value.length <= max;
// Ambiguous IDs cannot establish a witness, even when one duplicate looks valid.
function index(rows, key) {
  const result = new Map();
  for (const row of rows) {
    const value = row?.[key];
    if (id(value)) result.set(value, result.has(value) ? null : row);
  }
  return result;
}
function matchesExperiment(e, receipt, now) {
  const action = receipt?.details?.action, result = receipt?.details?.result;
  return matchingResultObject(e,receipt) && matchingFinishedMaterial(e,receipt) && id(e?.id) && id(e.actionId) && time(e.at) && e.at <= now &&
    knownPrimitive(e.primitive) && objectId(e.targetId) && typeof e.ok === 'boolean' &&
    validCaptureExperiment(e,receipt) && receipt?.type === 'action' && receipt.at === e.at && knownPrimitive(action?.type) && action.type === e.primitive &&
    objectId(action.targetId) && action.targetId === e.targetId && result?.ok === e.ok &&
    shortString(result.code, 60) && shortString(e.code, 60) && result.code === e.code &&
    (!result.materialId || objectId(result.materialId)) && (!e.materialId || objectId(e.materialId)) &&
    (!result.ingestionId || ingestionId(result.ingestionId)) && (!e.ingestionId || ingestionId(e.ingestionId)) &&
    (result.materialId || undefined) === (e.materialId || undefined) &&
    (result.ingestionId || undefined) === (e.ingestionId || undefined);
}
function recognizedEffect(effect, sample, receipt, now) {
  const feedback = receipt?.details?.feedback;
  return knownEffect(effect?.effect) && typeof effect.id === 'string' && effect.id.length <= 80 &&
    objectId(effect.objectId) && ingestionId(effect.ingestionId) && effect.source === 'experienced' &&
    ['hunger', 'thirst', 'energy'].every(key => ['easing', 'unchanged'].includes(effect[key])) &&
    ['none', 'aching', 'hurting'].includes(effect.pain) &&
    sample?.primitive === 'sample' && sample.ok && sample.targetId === effect.objectId &&
    sample.actionId === effect.actionId && sample.ingestionId === effect.ingestionId &&
    time(effect.at) && effect.at >= sample.at && effect.at <= now &&
    receipt?.type === 'condition' && receipt.id > sample.actionId && time(receipt.at) && receipt.at >= effect.at && receipt.at <= now &&
    receipt.details?.code === 'DISCOVERY_EFFECT' && shortString(feedback?.id) && feedback.id === effect.id &&
    objectId(feedback.objectId) && feedback.objectId === effect.objectId && feedback.actionId === effect.actionId &&
    ingestionId(feedback.ingestionId) && feedback.ingestionId === effect.ingestionId && knownEffect(feedback.effect) && feedback.effect === effect.effect &&
    feedback.source === 'experienced' && feedback.at === effect.at &&
    ['hunger', 'thirst', 'energy', 'pain'].every(key => feedback[key] === effect[key]);
}
function validateLedgers({ now, receiptsInput, experimentsInput, effectsInput }) {
    const receipts = index(receiptsInput, 'id'), experimentIds = index(experimentsInput, 'id'),
      experimentActions = index(experimentsInput, 'actionId'), experiments = [];
    for (const e of experimentsInput) {
      if (id(e?.id) && id(e.actionId) && experimentIds.get(e.id) === e && experimentActions.get(e.actionId) === e && matchesExperiment(e, receipts.get(e.actionId), now)) experiments.push(e);
    }
    experiments.sort((a, b) => a.actionId - b.actionId);
    const samples = new Map(), ingestions = new Map();
    for (const e of experiments) if (e.primitive === 'sample' && e.ok && ingestionId(e.ingestionId)) {
      samples.set(e.actionId, e);
      ingestions.set(e.ingestionId, ingestions.has(e.ingestionId) ? null : e);
    }
    const effectIds = new Map(), effectChains = new Map();
    const chainKey = effect => ingestionId(effect?.ingestionId) && knownEffect(effect?.effect) ? `${effect.ingestionId}|${effect.effect}` : null;
    for (const effect of effectsInput) {
      if (shortString(effect?.id)) effectIds.set(effect.id, effectIds.has(effect.id) ? null : effect);
      const key = chainKey(effect);
      if (key) effectChains.set(key, effectChains.has(key) ? null : effect);
    }
    const effects = effectsInput.map(effect => {
      const sample = id(effect?.actionId) ? samples.get(effect.actionId) : null,
        recognition = id(effect?.proofEventId) ? receipts.get(effect.proofEventId) : null;
      return { effect, sample, recognition, valid: shortString(effect?.id) && effectIds.get(effect.id) === effect &&
        effectChains.get(chainKey(effect)) === effect && ingestionId(effect?.ingestionId) && ingestions.get(effect.ingestionId) === sample && recognizedEffect(effect, sample, recognition, now) };
    });
    return { receipts, experiments, effects };
}

export { validateLedgers, knownPrimitive, time, objectId, ingestionId, bounded, adverseEffect };
