import { extractionOriginError, ownExtractionOrigins } from './food-source-caution.js';
import { matchingFinishedMaterial } from './discovery-completion.js';
import { retireHandlingInquiries } from './handling-inquiry.js';
import { retireInquiries } from './observational-inquiry-state.js';
import { endFoodRun } from './food-run-observer.js';
import { matchingResultObject } from './discovery-result-object.js';
import { CAVES, NPC_RULES } from './config.js';
import { BIOLOGY_PROFILES, BIOLOGY_RULES } from './biology-config.js';
import { DISCOVERY_RULES } from './discovery-config.js';
import { cleanSensoryObject, deriveDiscoveryPractice, objectId, discoveryAcquires, validCaptureExperiment } from './discovery-state.js';

// These are derived obligations, not additional persisted buffers. A biological
// feedback append must finish its own FIFO trim before entering this module.
const pendingLimit = BIOLOGY_RULES.maxDigestiveInputs + BIOLOGY_RULES.maxFeedback;
export const PROOF_RETENTION_BOUNDS = Object.freeze({
  pending: pendingLimit,
  experiments: pendingLimit + DISCOVERY_RULES.maxEffects + 3 * DISCOVERY_RULES.capacity + 1,
  experience: DISCOVERY_RULES.maxExperiments + pendingLimit + DISCOVERY_RULES.maxEffects + 1 + 1 + CAVES.length + 2,
  stagedExperiments: pendingLimit + DISCOVERY_RULES.maxEffects + 3 * DISCOVERY_RULES.capacity + 2,
  stagedExperience: DISCOVERY_RULES.maxExperiments + pendingLimit + DISCOVERY_RULES.maxEffects + 1 + 1 + CAVES.length + 3,
  scannedExperiments: DISCOVERY_RULES.maxExperiments + 1,
  scannedExperience: NPC_RULES.maxExperience + 2,
  owners: DISCOVERY_RULES.maxEffects + 1 + DISCOVERY_RULES.maxTechniques + 1 + DISCOVERY_RULES.maxReports + 1 + NPC_RULES.maxSkills + pendingLimit,
  heldObservations: DISCOVERY_RULES.capacity,
});
if (PROOF_RETENTION_BOUNDS.stagedExperiments > DISCOVERY_RULES.maxExperiments ||
    PROOF_RETENTION_BOUNDS.stagedExperience > NPC_RULES.maxExperience ||
    DISCOVERY_RULES.capacity > DISCOVERY_RULES.maxObjects) throw new Error('Unsupported effect-proof retention bounds');

const positiveId = value => Number.isInteger(value) && value > 0;
const ingestionId = value => typeof value === 'string' && /^ingestion:\d+$/.test(value);
export const LEGACY_PHYSICAL_PROVENANCE = 'legacy-sampled-unproven';
export const LEGACY_UNKNOWN_PHYSICAL_PROVENANCE = 'legacy-physical-unknown';
const effectsAllowed = new Set(['sustained', 'water relief', 'discomfort', 'no noticeable change']);
const time = value => Number.isFinite(value) && value >= 0;
const array = value => Array.isArray(value) ? value : [];
const numericId = value => typeof value === 'number' ? value : Number(String(value ?? '').match(/(\d+)$/)?.[1] || 0);
const canonicalSuffix = (value, prefix) => {
  if (typeof value !== 'string' || !value.startsWith(`${prefix}:`)) return null;
  const suffix = value.slice(prefix.length + 1);
  if (!/^[1-9]\d*$/.test(suffix)) return null;
  const id = Number(suffix);
  return Number.isSafeInteger(id) ? id : null;
};
const bounded = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const ordinaryTime = value => bounded(value, 0, 3600 * 100000);
const originalPlans = new WeakMap();

function uniqueIndex(rows, key) {
  const index = new Map();
  for (const row of rows) {
    const id = row?.[key];
    if (!positiveId(id) || index.has(id)) return null;
    index.set(id, row);
  }
  return index;
}

// Keep the existing action/sample cross-check exact. In particular, an action
// with the same target or result text is not a substitute for the original ID.
function validExperiment(experiment, receipt) {
  return matchingResultObject(experiment,receipt) && matchingFinishedMaterial(experiment,receipt) && positiveId(experiment?.id) && positiveId(experiment.actionId) && time(experiment.at) &&
    DISCOVERY_RULES.allPrimitives.includes(experiment.primitive) && objectId(experiment.targetId) &&
    validCaptureExperiment(experiment,receipt) && receipt?.type === 'action' && receipt.at === experiment.at &&
    receipt.details?.action?.type === experiment.primitive && receipt.details.action.targetId === experiment.targetId &&
    receipt.details.result?.ok === experiment.ok && typeof experiment.ok === 'boolean' &&
    receipt.details.result?.code === experiment.code &&
    (receipt.details.result?.materialId || undefined) === (experiment.materialId || undefined) &&
    (receipt.details.result?.ingestionId || undefined) === (experiment.ingestionId || undefined);
}
function matchingSample(effect, samples) {
  const sample = samples.get(effect?.actionId);
  return objectId(effect?.objectId) && positiveId(effect.actionId) && ingestionId(effect.ingestionId) &&
    effectsAllowed.has(effect.effect) && time(effect.at) && sample?.primitive === 'sample' && sample.ok &&
    sample.targetId === effect.objectId && sample.ingestionId === effect.ingestionId && effect.at >= sample.at ? sample : null;
}
function conditionMatches(effect, receipt) {
  const feedback = receipt?.details?.feedback;
  return receipt?.type === 'condition' && time(receipt.at) && receipt.at >= effect.at &&
    receipt.details?.code === 'DISCOVERY_EFFECT' &&
    feedback?.id === effect.id && feedback.ingestionId === effect.ingestionId && feedback.actionId === effect.actionId &&
    feedback.effect === effect.effect && feedback.objectId === effect.objectId && feedback.source === 'experienced' &&
    feedback.at === effect.at;
}
function feedbackMatches(effect, feedback) {
  return feedback?.id === effect.id && feedback.ingestionId === effect.ingestionId && feedback.actionId === effect.actionId &&
    feedback.effect === effect.effect && feedback.objectId === effect.objectId && feedback.provenance === 'sampled' && feedback.at === effect.at;
}
function indexes(npc) {
  const experience = array(npc.memory?.experience), experiments = array(npc.discovery?.experiments);
  if (experience.length > PROOF_RETENTION_BOUNDS.scannedExperience || experiments.length > PROOF_RETENTION_BOUNDS.scannedExperiments) return null;
  const events = uniqueIndex(experience, 'id'), byId = uniqueIndex(experiments, 'id'), byAction = uniqueIndex(experiments, 'actionId');
  if (!events || !byId || !byAction) return null;
  const valid = new Map(experiments.filter(e => validExperiment(e, events.get(e.actionId))).map(e => [e.id, e]));
  return { events, experimentsByAction: byAction, valid, samples: new Map([...valid.values()].map(e => [e.actionId, e])) };
}

function legacyPhysicalReceipt(row, id, receipt, index, npc, stomach) {
  return objectId(row?.objectId) && ingestionId(id) && positiveId(row?.actionId) && time(row.at) &&
    receipt?.id === row.actionId && receipt.type === 'action' && time(receipt.at) &&
    receipt.details?.action?.type === 'sample' && receipt.details.action.targetId === row.objectId &&
    receipt.details?.result?.ok === true && receipt.details.result.code === 'SWALLOWED' &&
    receipt.details.result.ingestionId === id && (stomach ? receipt.at === row.at : receipt.at <= row.at) &&
    !index.experimentsByAction.has(row.actionId) &&
    !array(npc.discovery?.experiments).some(experiment => experiment?.ingestionId === id) &&
    !array(npc.discovery?.effects).some(effect => effect?.ingestionId === id || effect?.actionId === row.actionId);
}

// A migrated stomach may retain previously seen, original "sampled" feedback.
// Every related row still has to describe that same physical action. Unseen
// feedback must carry the non-learning marker; a seen row never reopens.
function legacyFeedbackError(npc, index) {
  const stomach = array(npc.physiology?.stomach).filter(row => row?.provenance === LEGACY_PHYSICAL_PROVENANCE);
  const feedback = array(npc.physiology?.feedback), seen = new Set(array(npc.discovery?.seenFeedback));
  const unseenMarked = feedback.filter(row => row?.provenance === LEGACY_PHYSICAL_PROVENANCE && !seen.has(row?.id));
  if (!stomach.length && !unseenMarked.length) return null;
  const ids = new Set();
  for (const row of feedback) {
    if (typeof row?.id !== 'string' || !/^feedback:\d+$/.test(row.id) || ids.has(row.id)) return 'malformed-proof-input';
    ids.add(row.id);
  }
  const ingestions = new Set();
  for (const portion of stomach) {
    if (ingestions.has(portion.id)) return 'malformed-proof-input';
    ingestions.add(portion.id);
  }
  // After digestion removes the stomach row, its unseen feedback remains a
  // pending physical owner. It must still agree with every related seen row.
  const anchors = [
    ...stomach.map(row => ({ id: row.id, actionId: row.actionId, objectId: row.objectId, firstAt: row.at })),
    ...unseenMarked.map(row => ({ id: row.ingestionId, actionId: row.actionId,
      objectId: row.objectId, firstAt: index.events.get(row.actionId)?.at })),
  ];
  for (const anchor of anchors) {
    for (const row of feedback.filter(f => f?.ingestionId === anchor.id || f?.actionId === anchor.actionId)) {
      if (row.ingestionId !== anchor.id || row.actionId !== anchor.actionId ||
          row.objectId !== anchor.objectId || !time(row.at) || !time(anchor.firstAt) || row.at < anchor.firstAt ||
          (seen.has(row.id) ? !['sampled', LEGACY_PHYSICAL_PROVENANCE].includes(row.provenance) :
            row.provenance !== LEGACY_PHYSICAL_PROVENANCE)) return 'incomplete-pending-provenance';
    }
  }
  return null;
}

// The explicit legacy recovery preflight may mark an old digestive portion
// whose action and experiment have both rotated out. That marker is an inert
// physical owner, never a substitute for an action receipt. Check all marked
// feedback, including seen rows, so a later seen-cursor rollover cannot turn
// an old sampled label back into a learning input.
function unknownPhysicalError(npc, index) {
  const physiology = npc.physiology;
  const stomach = array(physiology?.stomach), feedback = array(physiology?.feedback);
  const markedStomach = stomach.filter(row => row?.provenance === LEGACY_UNKNOWN_PHYSICAL_PROVENANCE);
  const markedFeedback = feedback.filter(row => row?.provenance === LEGACY_UNKNOWN_PHYSICAL_PROVENANCE);
  if (!markedStomach.length && !markedFeedback.length) return null;
  const profile = Object.hasOwn(BIOLOGY_PROFILES, physiology?.profile) ?
    BIOLOGY_PROFILES[physiology.profile] : null;
  if (!profile || !Number.isSafeInteger(physiology?.nextId) || physiology.nextId < 1 ||
      physiology.nextId > 1e9 || !Number.isSafeInteger(npc.memory?.nextId) ||
      npc.memory.nextId < 1 || !ordinaryTime(npc.elapsed) ||
      stomach.length > BIOLOGY_RULES.maxDigestiveInputs || feedback.length > BIOLOGY_RULES.maxFeedback)
    return 'malformed-proof-input';
  const bodyRanges = {
    availableEnergyKcal: profile.availableCapacityKcal, storedEnergyKcal: profile.storedCapacityKcal,
    waterDeficitMl: profile.bodyWaterMl, health: 100, condition: 100, stamina: 100,
    fatigue: 100, sleepPressure: 100, hoursSinceMeal: 24 * 100000,
    awakeHours: 24 * 100000, starvationHours: 24 * 100000,
  };
  if (!bounded(physiology.clockHours, 0, 24 * 100000) ||
      !Object.entries(bodyRanges).every(([key, max]) => bounded(physiology[key], 0, max)) ||
      !bounded(physiology.circadianAlertness, -1, 1) ||
      !['awake', 'onset', 'sleeping'].includes(physiology.sleep?.state) ||
      !bounded(physiology.sleep?.hours, 0, BIOLOGY_RULES.maximumSleepHours) ||
      !bounded(physiology.sleep?.remainingHours, 0, BIOLOGY_RULES.maximumSleepHours) ||
      !bounded(physiology.sleep?.depth, 0, 1) ||
      !bounded(physiology.sleep?.inertiaHours, 0, 2) ||
      !['ingestedKcal', 'ingestedWaterMl', 'absorbedKcal', 'absorbedWaterMl',
        'metabolizedKcal', 'waterLostMl', 'discardedKcal', 'discardedWaterMl']
        .every(key => bounded(physiology.totals?.[key], 0, 1e12)) ||
      !bounded(physiology.outsideAssistance?.energyKcal, 0, 1e12) ||
      !bounded(physiology.outsideAssistance?.waterMl, 0, 1e12) ||
      !Number.isSafeInteger(physiology.outsideAssistance?.count) ||
      !bounded(physiology.outsideAssistance.count, 0, 1e9)) return 'malformed-proof-input';
  const mass = stomach.reduce((sum, row) => sum + row?.remainingMassGrams, 0);
  if (!Number.isFinite(mass) || mass > profile.stomachCapacityGrams + 1e-8)
    return 'malformed-proof-input';
  const stomachIds = new Set(), stomachActions = new Set(), feedbackIds = new Set();
  for (const row of stomach) {
    const number = canonicalSuffix(row?.id, 'ingestion');
    if (number === null || number >= physiology.nextId || stomachIds.has(number) ||
        Number.isSafeInteger(row?.actionId) && stomachActions.has(row.actionId))
      return 'malformed-proof-input';
    stomachIds.add(number);
    if (Number.isSafeInteger(row?.actionId)) stomachActions.add(row.actionId);
  }
  for (const row of feedback) {
    const number = canonicalSuffix(row?.id, 'feedback');
    const source = canonicalSuffix(row?.ingestionId, 'ingestion');
    if (number === null || number >= physiology.nextId || feedbackIds.has(number) ||
        source === null || source >= physiology.nextId)
      return 'malformed-proof-input';
    feedbackIds.add(number);
  }
  const identities = new Map(), actions = new Map();
  const effects = array(npc.discovery?.effects), experiments = array(npc.discovery?.experiments);
  const conflict = (id, actionId) =>
    index.events.has(actionId) || array(npc.memory?.experience).some(event =>
      event?.details?.result?.ingestionId === id) ||
    experiments.some(experiment => experiment?.actionId === actionId || experiment?.ingestionId === id) ||
    effects.some(effect => effect?.actionId === actionId || effect?.ingestionId === id);
  const identify = (id, actionId, object) => {
    const ingestion = canonicalSuffix(id, 'ingestion');
    const objectNumber = canonicalSuffix(object, 'object');
    if (ingestion === null || ingestion >= physiology.nextId || objectNumber === null ||
        !objectId(object) || !Number.isSafeInteger(actionId) || actionId < 1 ||
        actionId >= npc.memory.nextId || conflict(id, actionId)) return false;
    const prior = identities.get(id), actionOwner = actions.get(actionId);
    if (prior && (prior.actionId !== actionId || prior.objectId !== object) ||
        actionOwner && actionOwner !== id) return false;
    identities.set(id, { actionId, objectId: object });
    actions.set(actionId, id);
    return true;
  };
  for (const row of markedStomach) {
    if (!identify(row.id, row.actionId, row.objectId) || !ordinaryTime(row.at) || row.at > npc.elapsed ||
        !bounded(row.originalMassGrams, 0, profile.stomachCapacityGrams) ||
        !bounded(row.remainingMassGrams, 0, row.originalMassGrams) || row.remainingMassGrams <= 0 ||
        !bounded(row.originalKcal, 0, 50000) || !bounded(row.remainingKcal, 0, row.originalKcal) ||
        !bounded(row.absorbedKcal, 0, row.originalKcal) ||
        row.remainingKcal + row.absorbedKcal > row.originalKcal + 1e-8 ||
        !bounded(row.originalWaterMl, 0, 20000) ||
        !bounded(row.remainingWaterMl, 0, row.originalWaterMl) ||
        !bounded(row.absorbedWaterMl, 0, row.originalWaterMl) ||
        row.remainingWaterMl + row.absorbedWaterMl > row.originalWaterMl + 1e-8 ||
        !bounded(row.harm, 0, 100) || !bounded(row.toxicity, 0, 1) ||
        !bounded(row.digestHours, .05, 24) || !bounded(row.elapsedHours, 0, 24) ||
        !['feedbackSent', 'waterFeedbackSent', 'sustenanceFeedbackSent'].every(key => typeof row[key] === 'boolean'))
      return 'incomplete-pending-provenance';
  }
  // Once a portion has finished, an unseen feedback item may be its only
  // persisted owner. Its action time is no longer known, so check chronology
  // from the available anchor and between feedback rows without inventing it.
  const lastFeedbackAt = new Map();
  for (const row of markedFeedback) {
    const feedbackNumber = canonicalSuffix(row?.id, 'feedback');
    if (feedbackNumber === null || feedbackNumber >= physiology.nextId ||
        effects.some(effect => effect?.id === row.id) ||
        !identify(row.ingestionId, row.actionId, row.objectId) ||
        !ordinaryTime(row.at) || row.at > npc.elapsed || !effectsAllowed.has(row.effect) ||
        !['easing', 'unchanged'].includes(row.hunger) ||
        !['easing', 'unchanged'].includes(row.thirst) ||
        !['easing', 'unchanged'].includes(row.energy) ||
        !['none', 'aching', 'hurting'].includes(row.pain))
      return 'incomplete-pending-provenance';
    const anchor = markedStomach.find(portion => portion.id === row.ingestionId);
    if (anchor && row.at < anchor.at || row.at < (lastFeedbackAt.get(row.ingestionId) ?? 0))
      return 'incomplete-pending-provenance';
    lastFeedbackAt.set(row.ingestionId, row.at);
  }
  for (const [id, { actionId, objectId: object }] of identities) {
    // Any other physical owner sharing either identity must be the same
    // marked row; aliases and stale sampled feedback are not admissible.
    if (stomach.some(row => row?.provenance !== LEGACY_UNKNOWN_PHYSICAL_PROVENANCE &&
        (row?.id === id || row?.actionId === actionId)) ||
        feedback.some(row => (row?.ingestionId === id || row?.actionId === actionId) &&
          (row.provenance !== LEGACY_UNKNOWN_PHYSICAL_PROVENANCE ||
           row.ingestionId !== id || row.actionId !== actionId || row.objectId !== object)))
      return 'incomplete-pending-provenance';
  }
  return null;
}

/** Read-only durability inspection; never treats the separate physiology queue
 * as a replacement for an original recognition receipt. The receipt's outer
 * time may be later than the embedded feedback time (e.g. recognition on wake). */
export function retainedEffectProofError(npc) {
  if (npc?.mode !== 'discovery') return null;
  const rows = array(npc.discovery?.effects);
  if (rows.length > DISCOVERY_RULES.maxEffects + 1) return 'malformed-proof-input';
  const index = indexes(npc);
  if (!index) return 'malformed-proof-input';
  const identities = new Set();
  for (const effect of rows) {
    if (typeof effect?.id !== 'string' || !effect.id || identities.has(effect.id)) return 'malformed-proof-input';
    identities.add(effect.id);
    if (!matchingSample(effect, index.samples)) return 'incomplete-learned-provenance';
    if (!conditionMatches(effect, index.events.get(effect.proofEventId))) {
      return array(npc.physiology?.feedback).some(f => feedbackMatches(effect, f)) ?
        'queue-dependent-learned-provenance' : 'incomplete-learned-provenance';
    }
  }
  return null;
}

/** Inspect the raw actor before the save validator can discard a held item or
 * a pending portion. This does not retire optional reports or learned routines. */
export function retainedProofIntegrityError(npc) {
  const effectError = retainedEffectProofError(npc);
  if (effectError || npc?.mode !== 'discovery') return effectError;
  // The live planner may inspect one staged completion and two linked events.
  // A persisted save has no such transaction: validators slice to the ordinary
  // caps, so accepting staged arrays here could erase their oldest proof.
  if (!Array.isArray(npc.discovery?.experiments) || !Array.isArray(npc.discovery?.effects) ||
      !Array.isArray(npc.memory?.experience) ||
      npc.discovery.experiments.length > DISCOVERY_RULES.maxExperiments ||
      npc.discovery.effects.length > DISCOVERY_RULES.maxEffects ||
      npc.memory.experience.length > NPC_RULES.maxExperience ||
      Object.keys(npc.discovery.observations || {}).length > DISCOVERY_RULES.maxObjects ||
      array(npc.discovery.reports).length > DISCOVERY_RULES.maxReports ||
      array(npc.discovery.techniques).length > DISCOVERY_RULES.maxTechniques ||
      array(npc.memory.skills).length > NPC_RULES.maxSkills ||
      array(npc.physiology?.stomach).length > BIOLOGY_RULES.maxDigestiveInputs ||
      array(npc.physiology?.feedback).length > BIOLOGY_RULES.maxFeedback)
    return 'uncommitted-proof-retirement';
  const originError = extractionOriginError(npc);
  if (originError) return originError;
  const index = indexes(npc);
  if (!index) return 'malformed-proof-input';
  // Validate raw optional relations before any canonicalizer can erase malformed
  // presence. Ordinary bundle retirement removes the receipt and experiment.
  if (npc.discovery.experiments.some(e => Object.hasOwn(e, 'resultObjectId') &&
      !matchingResultObject(e, index.events.get(e.actionId))) ||
      npc.memory.experience.some(r => r.details?.result && Object.hasOwn(r.details.result, 'resultObjectId') &&
      !matchingResultObject(index.experimentsByAction.get(r.id), r)))
    return 'invalid-result-object-relation';
  const finishes = npc.discovery.experiments.filter(e => Object.hasOwn(e, 'finishedMaterial'));
  if (finishes.some(e => !matchingFinishedMaterial(e, index.events.get(e.actionId))) ||
      new Set(finishes.map(e => e.targetId)).size !== finishes.length ||
      new Set(finishes.map(e => e.ingestionId)).size !== finishes.length ||
      npc.memory.experience.some(r => r.details?.result && Object.hasOwn(r.details.result, 'finishedMaterial') &&
      !matchingFinishedMaterial(index.experimentsByAction.get(r.id), r)))
    return 'invalid-finished-material-relation';
  const feedbackError = legacyFeedbackError(npc, index);
  if (feedbackError) return feedbackError;
  const unknownError = unknownPhysicalError(npc, index);
  if (unknownError) return unknownError;
  const seen = new Set(array(npc.discovery?.seenFeedback));
  const pending = [...array(npc.physiology?.stomach).map(row => ({ row, stomach: true })),
    ...array(npc.physiology?.feedback).filter(row => !seen.has(row?.id)).map(row => ({ row, stomach: false }))];
  if (pending.length > pendingLimit) return 'malformed-proof-input';
  const identities = new Map();
  for (const { row, stomach } of pending) {
    if (row?.provenance === LEGACY_UNKNOWN_PHYSICAL_PROVENANCE) continue;
    if (!positiveId(row?.actionId) && !['sampled', LEGACY_PHYSICAL_PROVENANCE].includes(row?.provenance)) continue;
    const id = stomach ? row?.id : row?.ingestionId;
    if (!ingestionId(id) || !positiveId(row?.actionId) || !time(row.at)) return 'incomplete-pending-provenance';
    const receipt = index.events.get(row.actionId);
    if (receipt?.type !== 'action' || receipt.details?.result?.ok !== true ||
        receipt.details.result.ingestionId !== id ||
        (stomach ? receipt.at !== row.at : receipt.at > row.at)) return 'incomplete-pending-provenance';
    const identity = `${row.actionId}|${row.objectId ?? ''}|${row.provenance ?? ''}`;
    if (identities.has(id) && identities.get(id) !== identity) return 'malformed-proof-input';
    identities.set(id, identity);
    if (row.provenance === LEGACY_PHYSICAL_PROVENANCE &&
        !legacyPhysicalReceipt(row, id, receipt, index, npc, stomach)) return 'incomplete-pending-provenance';
    if (row.provenance === 'sampled') {
      const sample = index.samples.get(row.actionId);
      if (!sample || sample.primitive !== 'sample' || !sample.ok ||
          sample.targetId !== row.objectId || sample.ingestionId !== id) return 'incomplete-pending-provenance';
    }
  }
  const held = array(npc.inventory?.items);
  if (held.length > DISCOVERY_RULES.capacity || new Set(held).size !== held.length) return 'malformed-proof-input';
  for (const id of held) {
    const observation = npc.discovery?.observations?.[id];
    if (!objectId(id) || observation?.id !== id || !cleanSensoryObject(observation) ||
        ![...index.valid.values()].some(e => discoveryAcquires(e,id)))
      return 'incomplete-held-provenance';
  }
  if (npc.flask?.fillEventId != null) {
    const fill = index.events.get(npc.flask.fillEventId);
    if (fill?.type !== 'action' || fill.details?.action?.type !== 'fill_flask' ||
        fill.details?.result?.ok !== true) return 'incomplete-physical-provenance';
  }
  return null;
}

/** Select only existing genuine observations. Selection reserves at most four
 * held identities, then uses recency; survivor insertion order stays unchanged. */
export function retainHeldObservations(npc, observations = npc.discovery?.observations || {}) {
  const entries = Object.entries(observations).filter(([id, observation]) => id === observation?.id && cleanSensoryObject(observation));
  const held = new Set(array(npc.inventory?.items).filter(objectId).slice(0, DISCOVERY_RULES.capacity));
  const selected = new Set(entries.filter(([id]) => held.has(id)).map(([id]) => id));
  const recent = entries.map((entry, order) => ({ entry, order })).sort((a, b) =>
    b.entry[1].observedAt - a.entry[1].observedAt || a.order - b.order);
  for (const { entry: [id] } of recent) {
    if (selected.size >= DISCOVERY_RULES.maxObjects) break;
    selected.add(id);
  }
  return Object.fromEntries(entries.filter(([id]) => selected.has(id)));
}

function retirement(owner, reason) {
  return { kind: owner.kind, id: owner.row.id, index: owner.index, reason };
}
function ownerTime(owner) {
  if (time(owner.row.at)) return owner.row.at;
  const earned = array(owner.row.validation).find(v => time(v?.at));
  return earned?.at ?? 0;
}
const ownerOrder = (a, b) => a.priority - b.priority || ownerTime(a) - ownerTime(b) || numericId(a.row.id) - numericId(b.row.id) || a.index - b.index;

/** Pure bounded planning. Only synchronous completed links belong here. Pass
 * the one completed action and, if necessary, its one nested bookkeeping event
 * as stagingEventIds; never invoke between ingestion and action registration. */
export function planProofRetention(npc, { stagingEventIds = [] } = {}) {
  const d = npc?.discovery, m = npc?.memory;
  const source = { experience: array(m?.experience), experiments: array(d?.experiments), effects: array(d?.effects),
    reports: array(d?.reports), techniques: array(d?.techniques), skills: array(m?.skills), observations: d?.observations || {} };
  const diagnostics = { scannedExperiments: Math.min(source.experiments.length, PROOF_RETENTION_BOUNDS.scannedExperiments),
    scannedExperience: Math.min(source.experience.length, PROOF_RETENTION_BOUNDS.scannedExperience),
    pending: 0, hardExperiments: 0, hardExperience: 0, owners: 0, retirements: 0, closureChecks: 0,
    keptExperiments: 0, keptExperience: 0, removedExperiments: 0, removedExperience: 0 };
  const fail = reason => ({ ok: false, reason, diagnostics });
  const shaped = rows => rows.every(row => row && typeof row === 'object' && !Array.isArray(row));
  if (npc?.mode !== 'discovery') return fail('not-discovery');
  if (!d || !m || ['experiments','effects','reports','techniques'].some(k => !Array.isArray(d[k])) ||
      !Array.isArray(m.experience) || !Array.isArray(m.skills) || !Array.isArray(stagingEventIds) ||
      ![source.experience,source.experiments,source.effects,source.reports,source.techniques,source.skills].every(shaped) ||
      stagingEventIds.length > 2 || source.experiments.length > PROOF_RETENTION_BOUNDS.scannedExperiments ||
      source.experience.length > PROOF_RETENTION_BOUNDS.scannedExperience || source.effects.length > DISCOVERY_RULES.maxEffects + 1 ||
      source.reports.length > DISCOVERY_RULES.maxReports + 1 || source.techniques.length > DISCOVERY_RULES.maxTechniques + 1 ||
      source.skills.length > NPC_RULES.maxSkills || array(npc.physiology?.stomach).length > BIOLOGY_RULES.maxDigestiveInputs ||
      array(npc.physiology?.feedback).length > BIOLOGY_RULES.maxFeedback || array(npc.inventory?.items).length > DISCOVERY_RULES.capacity)
    return fail('malformed-proof-input');
  const originError = extractionOriginError(npc);
  if (originError) return fail(originError);
  const index = indexes(npc);
  if (!index) return fail('malformed-proof-input');
  const finishes = npc.discovery.experiments.filter(e => Object.hasOwn(e, 'finishedMaterial'));
  if (finishes.some(e => !matchingFinishedMaterial(e, index.events.get(e.actionId))) ||
      new Set(finishes.map(e => e.targetId)).size !== finishes.length ||
      new Set(finishes.map(e => e.ingestionId)).size !== finishes.length ||
      npc.memory.experience.some(r => r.details?.result && Object.hasOwn(r.details.result, 'finishedMaterial') &&
      !matchingFinishedMaterial(index.experimentsByAction.get(r.id), r)))
    return fail('invalid-finished-material-relation');
  const feedbackError = legacyFeedbackError(npc, index);
  if (feedbackError) return fail(feedbackError);
  const unknownError = unknownPhysicalError(npc, index);
  if (unknownError) return fail(unknownError);
  const { events, valid, samples } = index;
  const retainedEffects = source.effects.slice(-DISCOVERY_RULES.maxEffects), effectsBySample = new Map();
  const effectIds = new Set();
  const hardExperiments = new Set(), hardEvents = new Set(), retirements = [], owners = [];
  const keepExperiment = (experiment, experiments = hardExperiments, experience = hardEvents) => {
    experiments.add(experiment.id); experience.add(experiment.actionId);
  };
  for (const effect of retainedEffects) {
    if (typeof effect?.id !== 'string' || !effect.id || effectIds.has(effect.id)) return fail('malformed-proof-input');
    effectIds.add(effect.id);
    const sample = matchingSample(effect, samples);
    if (!sample) return fail('incomplete-learned-provenance');
    if (!conditionMatches(effect, events.get(effect.proofEventId))) return fail(
      array(npc.physiology?.feedback).some(f => feedbackMatches(effect, f)) ? 'queue-dependent-learned-provenance' : 'incomplete-learned-provenance');
    keepExperiment(sample); hardEvents.add(effect.proofEventId);
    const matching = effectsBySample.get(sample.id) || []; matching.push(effect); effectsBySample.set(sample.id, matching);
  }
  for (let i = 0; i < source.effects.length - retainedEffects.length; i++)
    retirements.push(retirement({ kind: 'effect', row: source.effects[i], index: i }, 'effect-fifo'));

  // The stomach and unseen FIFO feedback own exact ingestion identities. The
  // per-object behavioural marker and elapsed waiting period are irrelevant.
  const pending = new Map(), pendingSamples = new Map(), seen = new Set(array(d.seenFeedback));
  const pendingInputs = [...array(npc.physiology?.stomach).map(row => ({ row, stomach: true })),
    ...array(npc.physiology?.feedback).filter(row => !seen.has(row?.id)).map(row => ({ row, stomach: false }))];
  for (const { row, stomach } of pendingInputs) {
    const id = stomach ? row?.id : row?.ingestionId;
    if (row?.provenance === LEGACY_UNKNOWN_PHYSICAL_PROVENANCE) {
      const identity = `${id}|${row.actionId}|${row.objectId}|${row.provenance}`;
      if (pending.has(id) && pending.get(id) !== identity) return fail('malformed-proof-input');
      pending.set(id, identity);
      continue;
    }
    // Historic non-action inputs do not manufacture a memory obligation.
    if (!positiveId(row?.actionId) && !['sampled', LEGACY_PHYSICAL_PROVENANCE].includes(row?.provenance)) continue;
    if (!ingestionId(id) || !positiveId(row?.actionId)) return fail('incomplete-pending-provenance');
    const receipt = events.get(row.actionId), result = receipt?.details?.result;
    if (receipt?.type !== 'action' || result?.ok !== true || result.ingestionId !== id ||
        !time(row.at) || (stomach ? receipt.at !== row.at : receipt.at > row.at)) return fail('incomplete-pending-provenance');
    const identity = `${id}|${row.actionId}|${row.objectId ?? ''}|${row.provenance ?? ''}`;
    if (pending.has(id) && pending.get(id) !== identity) return fail('malformed-proof-input');
    pending.set(id, identity); hardEvents.add(receipt.id);
    if (row.provenance === LEGACY_PHYSICAL_PROVENANCE &&
        !legacyPhysicalReceipt(row, id, receipt, index, npc, stomach)) return fail('incomplete-pending-provenance');
    if (row.provenance === 'sampled') {
      const sample = samples.get(row.actionId);
      if (!sample || sample.primitive !== 'sample' || !sample.ok || sample.targetId !== row.objectId || sample.ingestionId !== id)
        return fail('incomplete-pending-provenance');
      keepExperiment(sample); pendingSamples.set(id, sample);
    }
  }
  diagnostics.pending = pending.size;
  if (pending.size > pendingLimit) return fail('malformed-proof-input');

  const acquisitions = [...valid.values()].filter(e => e.ok && ['pull','grasp','catch'].includes(e.primitive));
  const acquired = (id, before = null) => acquisitions.filter(e =>
    discoveryAcquires(e,id) &&
    (!before || e.id < before.id && e.at <= before.at)).at(-1);
  const observations = retainHeldObservations(npc, source.observations);
  const held = new Set(array(npc.inventory?.items));
  if (held.size !== array(npc.inventory?.items).length) return fail('malformed-proof-input');
  for (const id of held) {
    const acquisition = acquired(id);
    if (!objectId(id) || !observations[id] || !acquisition) return fail('incomplete-held-provenance');
    keepExperiment(acquisition);
  }
  // Informational extraction origins are distinct from latest motor ownership.
  // Four recent origins survive dropping/handing away; held origins survive
  // displacement from that finite recent set. At most eight additional pairs.
  const origins = ownExtractionOrigins(npc).map(origin => valid.get(origin.id))
    .filter(Boolean).sort((a,b) => b.actionId-a.actionId);
  for (const origin of origins.filter((row,i) => i < DISCOVERY_RULES.capacity || held.has(row.materialId)))
    keepExperiment(origin);
  if (npc.flask?.fillEventId != null) {
    const fill = events.get(npc.flask.fillEventId);
    if (fill?.type !== 'action' || fill.details?.action?.type !== 'fill_flask' || fill.details?.result?.ok !== true)
      return fail('incomplete-physical-provenance');
    hardEvents.add(fill.id);
  }
  const rest = source.experience.filter(e => e.type === 'action' && ['rest','sleep'].includes(e.details?.action?.type)).at(-1);
  if (rest) hardEvents.add(rest.id);
  for (const shelter of CAVES) {
    const entry = source.experience.filter(e => e.type === 'action' && e.details?.action?.type === 'enter_shelter' &&
      e.details.action.shelterId === shelter.id && e.details.result?.ok === true).at(-1);
    if (entry) hardEvents.add(entry.id);
  }
  for (const id of stagingEventIds) {
    if (!positiveId(id) || !events.has(id)) return fail('malformed-staging');
    hardEvents.add(id);
    const experiment = samples.get(id); if (experiment) keepExperiment(experiment);
  }
  if (new Set(stagingEventIds).size !== stagingEventIds.length || stagingEventIds.filter(id => samples.has(id)).length > 1)
    return fail('malformed-staging');
  diagnostics.hardExperiments = hardExperiments.size; diagnostics.hardExperience = hardEvents.size;
  if (hardExperiments.size > PROOF_RETENTION_BOUNDS.experiments || hardEvents.size > PROOF_RETENTION_BOUNDS.experience)
    return fail('unsupported-hard-closure');

  const addOwner = (kind, row, order, priority, experimentIds = [], eventIds = [], supported = true) => {
    const owner = { kind, row, index: order, priority, experiments: new Set(), experience: new Set(), active: supported };
    for (const id of experimentIds) { const experiment = valid.get(id); if (!experiment) owner.active = false; else keepExperiment(experiment, owner.experiments, owner.experience); }
    for (const id of eventIds) { if (!events.has(id)) owner.active = false; else owner.experience.add(id); }
    owners.push(owner);
    if (!owner.active) retirements.push(retirement(owner, 'unsupported-owner'));
    return owner;
  };
  for (const [i, report] of source.reports.entries()) {
    const evidence = array(report?.evidence), proposed = array(report?.proposed);
    if (evidence.length > 12 || proposed.length > 6) return fail('malformed-proof-input');
    const supported = proposed.every(step => observations[step?.targetId]) &&
      (report.status !== 'supported' || evidence.some(id => effectsBySample.get(id)?.some(e => e.effect === 'sustained'))) &&
      (report.status !== 'contradicted' || evidence.some(id => valid.get(id)?.ok === false || effectsBySample.get(id)?.some(e => e.effect === 'discomfort')));
    addOwner('report', report, i, 0, evidence, [], supported);
  }
  for (const [i, skill] of source.skills.entries()) {
    const supporting = array(skill?.supportingExperience), validation = array(skill?.validation);
    if (supporting.length > 36 || validation.length > 16) return fail('malformed-proof-input');
    addOwner('skill', skill, i, 1, [], [...supporting, ...validation.map(v => v.eventId)], supporting.length >= 2);
  }
  for (const [i, technique] of source.techniques.entries()) {
    const evidence = array(technique?.evidence), steps = array(technique?.steps);
    if (evidence.length > 16) return fail('malformed-proof-input');
    const supported = objectId(technique?.sourceId) && steps.length === 2 && steps[0]?.targetId === '$source' &&
      steps[1]?.type === 'sample' && steps[1]?.targetId === '$material' && evidence.some(id => {
        const sample = valid.get(id);
        return sample?.primitive === 'sample' && sample.ok && effectsBySample.get(id)?.some(e => e.effect === 'sustained') &&
          evidence.some(acquisitionId => { const acquisition = valid.get(acquisitionId); return acquisition?.ok &&
            acquisition.id < sample.id && acquisition.at <= sample.at && acquisition.targetId === technique.sourceId &&
            steps[0]?.type === acquisition.primitive && (acquisition.primitive === 'pull' && acquisition.materialId === sample.targetId ||
              acquisition.primitive === 'grasp' && acquisition.targetId === sample.targetId); });
      });
    // An older witness may have gone missing while a second complete chain
    // remains. Keep that same learned owner with only its still genuine rows.
    const survivingEvidence = evidence.filter(id => valid.has(id));
    const row = survivingEvidence.length === evidence.length ? technique : { ...technique, evidence: survivingEvidence };
    addOwner('technique', row, i, 2, survivingEvidence, [], Boolean(supported));
  }
  let optionalIndex = 0;
  for (const sample of pendingSamples.values()) {
    const acquisition = acquired(sample.targetId, sample);
    if (acquisition) addOwner('acquisition', acquisition, optionalIndex++, 3, [acquisition.id]);
  }
  diagnostics.owners = owners.length + source.effects.length;
  if (diagnostics.owners > PROOF_RETENTION_BOUNDS.owners) return fail('malformed-proof-input');
  const closure = () => {
    diagnostics.closureChecks++;
    const experiments = new Set(hardExperiments), experience = new Set(hardEvents);
    for (const owner of owners) if (owner.active) {
      for (const id of owner.experiments) experiments.add(id);
      for (const id of owner.experience) experience.add(id);
    }
    return { experiments, experience };
  };
  let selected = closure();
  for (const owner of owners.filter(o => o.active &&
    (o.kind !== 'report' || o.row.cursor > 0 || o.experiments.size || o.experience.size)).sort(ownerOrder)) {
    if (selected.experiments.size <= DISCOVERY_RULES.maxExperiments && selected.experience.size <= NPC_RULES.maxExperience) break;
    owner.active = false; retirements.push(retirement(owner, 'capacity')); selected = closure();
  }
  if (selected.experiments.size > DISCOVERY_RULES.maxExperiments || selected.experience.size > NPC_RULES.maxExperience)
    return fail('unsupported-hard-closure');

  // The remaining budget retains newest unowned complete experiment/action
  // bundles, then newest detail rows. Rejected bundle receipts are not resurrected
  // as arbitrary history; shared independently-owned receipts remain protected.
  for (let i = source.experiments.length - 1; i >= 0; i--) {
    const experiment = source.experiments[i];
    if (!valid.has(experiment.id) || selected.experiments.has(experiment.id)) continue;
    if (selected.experiments.size < DISCOVERY_RULES.maxExperiments &&
        (selected.experience.has(experiment.actionId) || selected.experience.size < NPC_RULES.maxExperience))
      keepExperiment(experiment, selected.experiments, selected.experience);
  }
  const omittedReceipts = new Set(source.experiments.filter(e => !selected.experiments.has(e.id)).map(e => e.actionId));
  for (let i = source.experience.length - 1; i >= 0 && selected.experience.size < NPC_RULES.maxExperience; i--) {
    const event = source.experience[i]; if (!omittedReceipts.has(event.id)) selected.experience.add(event.id);
  }
  const keptOwners = kind => new Set(owners.filter(o => o.kind === kind && o.active).map(o => o.index));
  const reports = keptOwners('report'), techniques = keptOwners('technique'), skills = keptOwners('skill');
  const kept = { experience: source.experience.filter(e => selected.experience.has(e.id)),
    experiments: source.experiments.filter(e => selected.experiments.has(e.id)), effects: retainedEffects,
    reports: source.reports.filter((_, i) => reports.has(i)),
    techniques: owners.filter(o => o.kind === 'technique' && techniques.has(o.index)).map(o => o.row),
    skills: source.skills.filter((_, i) => skills.has(i)), observations };
  Object.assign(diagnostics, { retirements: retirements.length, keptExperiments: kept.experiments.length,
    keptExperience: kept.experience.length, removedExperiments: source.experiments.length - kept.experiments.length,
    removedExperience: source.experience.length - kept.experience.length });
  const plan = { ok: true, reason: retirements.length ? 'owners-retired' : 'retained', kept, retirements, diagnostics };
  originalPlans.set(plan, { npc, source });
  return plan;
}

/** One synchronous commit. Does not allocate an event ID, change physical state,
 * create observations, or cancel an already-started action. */
export function applyProofRetention(npc, plan) {
  if (!plan?.ok) return false;
  const original = originalPlans.get(plan);
  if (original?.npc !== npc || npc.memory.experience !== original.source.experience || npc.discovery.experiments !== original.source.experiments)
    return false;
  const { kept } = plan;
  // Trials are optional summaries. Once both their observation and last
  // matching experiment have retired, drop them in this same proof commit.
  // Prepare the entire derived update before changing any retained array.
  const retainedTrials = new Set(kept.experiments.map(e => `${e.targetId}|${e.primitive}`));
  const trials = npc.discovery.trials || {};
  let nextTrials = null;
  for (const key of Object.keys(trials)) {
    const [id, type] = key.split('|');
    if (key !== `${id}|${type}` || !objectId(id) || !DISCOVERY_RULES.allPrimitives.includes(type) ||
        kept.observations[id] || retainedTrials.has(key)) continue;
    nextTrials ??= { ...trials };
    delete nextTrials[key];
  }
  const nextPractice = nextTrials && deriveDiscoveryPractice(kept.experiments, nextTrials);
  npc.memory.experience = kept.experience; npc.memory.skills = kept.skills;
  for (const key of ['experiments','effects','reports','techniques','observations']) npc.discovery[key] = kept[key];
  retireInquiries(npc.discovery);
  retireHandlingInquiries(npc);
  if (nextTrials) { npc.discovery.trials = nextTrials; npc.discovery.practice = nextPractice; }
  if (npc.discovery.run && !kept.techniques.some(t => t.id === npc.discovery.run.techniqueId)) {
    endFoodRun(npc, npc.discovery.run, 'proof-retired');
    npc.discovery.run = null;
  }
  originalPlans.delete(plan);
  return true;
}
export function compactProofRetention(npc, options) {
  const plan = planProofRetention(npc, options);
  if (plan.ok) applyProofRetention(npc, plan);
  return plan;
}
