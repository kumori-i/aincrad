import { bodySignals } from './interoception.js';

// Diagnostic only. The single pull/drain slot belongs to a controller, never an
// actor, save, event stream or policy. No callback runs at the decision seam.
const captures = new WeakMap();
const PHASE = 'before-discoveryDecision';
export const DISCOVERY_CANDIDATE_LIMITS = Object.freeze({
  receipts: 400, experiments: 160, effects: 64, techniques: 24, held: 4,
  stomach: 24, rowsPerCandidate: 16,
});
const L = DISCOVERY_CANDIDATE_LIMITS;
const primitives = new Set(['inspect_object', 'grasp', 'release', 'pull', 'sample', 'strike']);
const effectKinds = new Set(['sustained', 'water relief', 'discomfort', 'no noticeable change']);
const shortString = (value, max = 80) => typeof value === 'string' && value.length <= max;
const knownPrimitive = value => shortString(value, 32) && primitives.has(value);
const knownEffect = value => shortString(value, 32) && effectKinds.has(value);
const adverseEffect = effect => effect?.effect === 'discomfort' || ['aching', 'hurting'].includes(effect?.pain);
const id = value => Number.isSafeInteger(value) && value > 0;
const time = value => Number.isFinite(value) && value >= 0;
const text = (value, max = 80) => typeof value === 'string' ? value.slice(0, max) : null;
const objectId = value => typeof value === 'string' && value.length <= 16 && /^object:\d{1,9}$/.test(value);
const ingestionId = value => typeof value === 'string' && value.length <= 80 && /^ingestion:\d+$/.test(value);
const bounded = (value, max) => Array.isArray(value) && value.length <= max;
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) freeze(value[key]);
    Object.freeze(value);
  }
  return value;
}
function unavailable(reason) {
  return freeze({ version: 1, phase: PHASE, status: 'unavailable', reason, candidates: [] });
}
export function setDiscoveryCandidateCapture(controller, enabled) {
  captures.delete(controller);
  if (enabled === true && controller.disposed !== true) captures.set(controller, { snapshot: null });
}
export function takeDiscoveryCandidateSnapshot(controller) {
  const slot = captures.get(controller);
  if (!slot) return null;
  const snapshot = slot.snapshot;
  slot.snapshot = null;
  return snapshot;
}
export function disposeDiscoveryCandidateCapture(controller) { captures.delete(controller); }
export function captureDiscoveryCandidates(controller, npc) {
  const slot = captures.get(controller);
  if (!slot) return; // Disabled: no actor read, projection, indexing or allocation.
  slot.snapshot = collectDiscoveryCandidateSnapshot(npc, { foodLearning: controller.discoveryFoodLearning !== false });
}

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
  return id(e?.id) && id(e.actionId) && time(e.at) && e.at <= now &&
    knownPrimitive(e.primitive) && objectId(e.targetId) && typeof e.ok === 'boolean' &&
    receipt?.type === 'action' && receipt.at === e.at && knownPrimitive(action?.type) && action.type === e.primitive &&
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
function observation(observations, targetId) {
  if (!objectId(targetId)) return null;
  const raw = observations?.[targetId];
  if (raw?.id !== targetId) return null;
  const appearance = {};
  for (const key of ['shape', 'color', 'texture', 'motion', 'sound', 'size', 'smell', 'details']) {
    if (typeof raw.appearance?.[key] === 'string') appearance[key] = raw.appearance[key].slice(0, 100);
  }
  // A remembered visual identity is not a current availability certificate.
  return { id: targetId, scene: text(raw.scene, 50), observedAt: time(raw.observedAt) ? raw.observedAt : null, appearance };
}
function timing(receipt, experimentId = null) {
  const result = receipt?.details?.result, action = receipt?.details?.action;
  if (receipt?.type !== 'action' || typeof result?.ok !== 'boolean' ||
      !Number.isFinite(result.durationSeconds) || result.durationSeconds <= 0) return null;
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
        ['release', 'grasp', 'strike'].includes(action.type)) || receipt.details?.result?.materialId === sample.targetId)) return false;
  }
  return true;
}
function qualitativeBody(npc) {
  const signals = bodySignals(npc), body = {};
  for (const key of ['hunger', 'thirst', 'thermal', 'energy', 'stamina', 'fatigue', 'sleepiness',
    'pain', 'wetness', 'overall', 'activity', 'digestion', 'sleep', 'relief']) {
    if (typeof signals[key] === 'string') body[key] = signals[key].slice(0, 60);
  }
  return body;
}
function missingCosts() {
  return ['current-availability', 'route', 'future-relief', 'remaining-procedure-work',
    'completion-latency', 'experienced-effort', 'future-effort', 'future-harm', 'retired-evidence-coverage'];
}
function rowSummary(rows) {
  return { rows: rows.slice(0, L.rowsPerCandidate), retainedCount: rows.length,
    truncated: rows.length > L.rowsPerCandidate };
}
function witnesses(rows, key) { return [...new Set(rows.map(row => row[key]).filter(value => value !== null && value !== undefined))]; }
function refusal(receipt, experimentId = null) {
  const action = receipt?.details?.action, result = receipt?.details?.result;
  return receipt?.type === 'action' && result?.ok === false ? { actionId: receipt.id, experimentId,
    type: action.type, targetId: objectId(action.targetId) ? action.targetId : null,
    code: text(result.code, 60), at: receipt.at } : null;
}
function alternative(type, receipts, now) {
  const actions = [], refusals = [];
  for (const receipt of receipts.values()) {
    if (!receipt || !time(receipt.at) || receipt.at > now || receipt.details?.action?.type !== type) continue;
    const row = timing(receipt), rejected = refusal(receipt);
    if (row) actions.push(row);
    if (rejected) refusals.push(rejected);
  }
  actions.sort((a, b) => a.actionId - b.actionId);
  refusals.sort((a, b) => a.actionId - b.actionId);
  const observedTiming = rowSummary(actions), observedRefusals = rowSummary(refusals);
  return { id: type, intent: type === 'rest' ? 'rest locally' : 'wait for further observation',
    needTargets: type === 'rest' ? ['fatigue'] : [], procedure: null, continuation: null,
    nextOperation: { type }, identity: null, availability: 'unknown', route: 'not-applicable',
    pending: false, adverse: refusals.length > 0, observedTiming, observedRefusals,
    observedEffort: rowSummary([]), observedEffects: rowSummary([]), pendingEvidence: rowSummary([]),
    support: { actionIds: witnesses([...observedTiming.rows, ...observedRefusals.rows], 'actionId'), experimentIds: [], ingestionIds: [], recognitionIds: [] },
    missingCosts: missingCosts().filter(cost => cost !== 'route'),
  };
}
function foodCandidate(technique, context) {
  const { d, now, receipts, experiments, effects, held, observations, run, foodLearning } = context;
  const sourceId = technique.sourceId, acquisitionType = technique.steps[0].type;
  const acquisitions = experiments.filter(e => e.ok && e.primitive === acquisitionType && e.targetId === sourceId);
  const materialIds = new Set(acquisitionType === 'grasp' ? [sourceId] : []);
  for (const acquired of acquisitions) if (objectId(acquired.materialId)) materialIds.add(acquired.materialId);
  for (const targetId of materialIds) context.coveredMaterials.add(targetId);
  const relevant = experiments.filter(e => e.targetId === sourceId && e.primitive === acquisitionType || e.primitive === 'sample' && materialIds.has(e.targetId));
  const samples = relevant.filter(e => e.primitive === 'sample' && e.ok && ingestionId(e.ingestionId));
  const timings = [], efforts = [], refusals = [];
  for (const e of relevant) {
    const receipt = receipts.get(e.actionId), row = timing(receipt, e.id), felt = effort(receipt, e.id), rejected = refusal(receipt, e.id);
    if (row) timings.push(row);
    if (felt) efforts.push(felt);
    if (rejected) refusals.push(rejected);
  }
  timings.sort((a, b) => a.actionId - b.actionId);
  efforts.sort((a, b) => a.actionId - b.actionId);
  const observed = [], positive = new Set();
  let adverse = false, unlinkedEffects = 0, unlinkedAdverseEffects = 0;
  for (const { effect, sample, recognition, valid } of effects) {
    if (!objectId(effect?.objectId) || !materialIds.has(effect.objectId)) continue;
    if (!valid) { unlinkedEffects++; if (adverseEffect(effect)) unlinkedAdverseEffects++; continue; }
    const acquired = acquisitions.filter(e => e.id < sample.id && e.actionId < sample.actionId && e.at <= sample.at &&
      (acquisitionType === 'grasp' ? e.targetId === sample.targetId : e.materialId === sample.targetId)).at(-1);
    const intact = !!acquired && continuity(acquired, sample, receipts);
    if (adverseEffect(effect)) adverse = true;
    if (effect.effect === 'sustained' && intact) positive.add(effect.ingestionId);
    observed.push({ effect: effect.effect, objectId: effect.objectId, ingestionId: effect.ingestionId,
      actionId: sample.actionId, experimentId: sample.id, recognitionId: recognition.id,
      acquisitionActionId: acquired?.actionId ?? null, acquisitionExperimentId: acquired?.id ?? null,
      sourceContinuity: intact ? 'retained-direct-chain' : 'unknown',
      effectAt: effect.at, recognizedAt: recognition.at, feedbackDelaySeconds: recognition.at - sample.at,
      hunger: effect.hunger === 'easing' ? 'easing' : 'unchanged',
      thirst: effect.thirst === 'easing' ? 'easing' : 'unchanged',
      energy: effect.energy === 'easing' ? 'easing' : 'unchanged',
      pain: ['none', 'aching', 'hurting'].includes(effect.pain) ? effect.pain : 'unknown' });
  }
  // Keep contradictory witness details visible even when the row cap is hit.
  observed.sort((a, b) => Number(adverseEffect(b)) - Number(adverseEffect(a)) ||
    a.actionId - b.actionId || a.recognitionId - b.recognitionId);
  const pendingRows = [], pendingObjects = new Set([sourceId, ...materialIds]);
  for (const sample of samples) {
    const recognized = effects.some(row => row.valid && row.sample.actionId === sample.actionId);
    if (!recognized) pendingRows.push({ objectId: sample.targetId, actionId: sample.actionId,
      experimentId: sample.id, ingestionId: sample.ingestionId, since: sample.at, status: 'unresolved-retained-sample' });
  }
  // This map can legitimately exceed the persisted bound. Never enumerate it.
  for (const targetId of pendingObjects) {
    const since = d.samplesPending?.[targetId];
    if (time(since) && since <= now && !pendingRows.some(row => row.objectId === targetId && row.since === since)) {
      pendingRows.push({ objectId: targetId, actionId: null, experimentId: null, ingestionId: null, since, status: 'pending-marker' });
    }
  }
  const continuation = run?.techniqueId === technique.id ? {
    cursor: Number.isInteger(run.cursor) && run.cursor >= 0 && run.cursor <= 2 ? run.cursor : null,
    materialId: objectId(run.materialId) ? run.materialId : null, awaiting: run.awaiting === true,
  } : null;
  const cursor = continuation ? continuation.cursor : 0, step = cursor === null ? null : technique.steps[cursor];
  const nextOperation = step ? { type: step.type, targetId: step.targetId === '$source' ? sourceId : continuation?.materialId ?? null } : null;
  const observedTiming = rowSummary(timings), observedEffort = rowSummary(efforts), observedEffects = rowSummary(observed), observedRefusals = rowSummary(refusals);
  const copiedWitnesses = [...observedTiming.rows, ...observedEffort.rows, ...observedEffects.rows, ...observedRefusals.rows];
  return { id: `food:${technique.id}`, intent: 'repeat retained food procedure', needTargets: ['hunger'], policyEnabled: foodLearning,
    procedure: { id: technique.id, sourceId, steps: technique.steps.map(step => ({ type: step.type, targetId: step.targetId })) },
    continuation, nextOperation,
    identity: { source: observation(observations, sourceId), heldMaterialIds: held.filter(targetId => materialIds.has(targetId)) },
    availability: 'unknown', route: 'unknown', pending: pendingRows.length > 0, adverse,
    observedTiming, observedEffort, observedEffects, observedRefusals, pendingEvidence: rowSummary(pendingRows),
    retainedSourceSupport: { status: positive.size ? 'observed-direct-chain' : 'unknown', ingestionCount: positive.size },
    support: { actionIds: [...new Set([...witnesses(copiedWitnesses, 'actionId'), ...witnesses(observedEffects.rows, 'acquisitionActionId')])],
      experimentIds: [...new Set([...witnesses(copiedWitnesses, 'experimentId'), ...witnesses(observedEffects.rows, 'acquisitionExperimentId')])],
      ingestionIds: witnesses(observedEffects.rows, 'ingestionId'), recognitionIds: witnesses(observedEffects.rows, 'recognitionId') },
    evidenceGaps: { unlinkedEffects, unlinkedAdverseEffects, sourceContinuityUnknown: observed.some(row => row.sourceContinuity === 'unknown') },
    // Valid retained rows cannot certify complete history: unmatched/retired
    // records can be absent before this projection, so coverage stays unknown.
    missingCosts: missingCosts(),
  };
}

function retainedEffectsCoverage(effects, coveredMaterials) {
  const rows = [];
  for (const { effect, valid } of effects) {
    if (valid && coveredMaterials.has(effect.objectId)) continue;
    rows.push({ status: valid ? 'unassigned' : 'unverified', effect: knownEffect(effect?.effect) ? effect.effect : 'unknown',
      pain: ['none', 'aching', 'hurting'].includes(effect?.pain) ? effect.pain : 'unknown',
      effectId: text(effect?.id), objectId: objectId(effect?.objectId) ? effect.objectId : null,
      ingestionId: ingestionId(effect?.ingestionId) ? effect.ingestionId : null,
      actionId: id(effect?.actionId) ? effect.actionId : null, recognitionId: id(effect?.proofEventId) ? effect.proofEventId : null });
  }
  rows.sort((a, b) => Number(adverseEffect(b)) - Number(adverseEffect(a)) ||
    (a.actionId ?? 0) - (b.actionId ?? 0) || String(a.effectId).localeCompare(String(b.effectId)) ||
    JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return { scannedCount: effects.length, unverifiedCount: rows.filter(row => row.status === 'unverified').length,
    unassignedCount: rows.filter(row => row.status === 'unassigned').length,
    uncertainAdverseCount: rows.filter(adverseEffect).length, ...rowSummary(rows) };
}

/** A copied, deeply frozen diagnostic envelope, never a proposed policy choice. */
export function collectDiscoveryCandidateSnapshot(npc, { foodLearning = true } = {}) {
  try {
    const d = npc?.discovery, receiptsInput = npc?.memory?.experience, heldInput = npc?.inventory?.items;
    if (npc?.mode !== 'discovery' || !d || !time(npc.elapsed)) return unavailable('invalid-discovery-state');
    // Check every input array before indexing or walking any of its contents.
    if (!bounded(receiptsInput, L.receipts) || !bounded(d.experiments, L.experiments) ||
        !bounded(d.effects, L.effects) || !bounded(d.techniques, L.techniques) || !bounded(heldInput, L.held)) {
      return unavailable('input-bounds');
    }
    // Only the official qualitative API may traverse digestive contents.
    if (npc.physiology && !bounded(npc.physiology.stomach, L.stomach)) return unavailable('body-signal-bounds');
    const now = npc.elapsed, receipts = index(receiptsInput, 'id'), experimentIds = index(d.experiments, 'id'),
      experimentActions = index(d.experiments, 'actionId'), experiments = [];
    for (const e of d.experiments) {
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
    for (const effect of d.effects) {
      if (shortString(effect?.id)) effectIds.set(effect.id, effectIds.has(effect.id) ? null : effect);
      const key = chainKey(effect);
      if (key) effectChains.set(key, effectChains.has(key) ? null : effect);
    }
    const effects = d.effects.map(effect => {
      const sample = id(effect?.actionId) ? samples.get(effect.actionId) : null,
        recognition = id(effect?.proofEventId) ? receipts.get(effect.proofEventId) : null;
      return { effect, sample, recognition, valid: shortString(effect?.id) && effectIds.get(effect.id) === effect &&
        effectChains.get(chainKey(effect)) === effect && ingestionId(effect?.ingestionId) && ingestions.get(effect.ingestionId) === sample && recognizedEffect(effect, sample, recognition, now) };
    });
    const held = heldInput.filter(objectId), observations = d.observations;
    foodLearning = foodLearning !== false;
    const context = { d, now, receipts, experiments, effects, held, observations, run: d.run, foodLearning, coveredMaterials: new Set() };
    const candidates = [], techniqueIds = new Map();
    for (const technique of d.techniques) {
      const key = technique?.id;
      if (typeof key === 'string' && key.length <= 80) techniqueIds.set(key, techniqueIds.has(key) ? null : technique);
    }
    let omittedTechniques = 0;
    // Historical counters and technique.evidence are deliberately never read.
    // Only the bounded canonical ledgers above supply observations.
    for (const technique of d.techniques) {
      if (!technique || typeof technique.id !== 'string' || technique.id.length > 80 || techniqueIds.get(technique.id) !== technique ||
          !objectId(technique.sourceId) || technique.effect !== 'sustained' || !bounded(technique.steps, 2) || technique.steps.length !== 2 ||
          !['pull', 'grasp'].includes(technique.steps[0]?.type) || technique.steps[0].targetId !== '$source' ||
          technique.steps[1]?.type !== 'sample' || technique.steps[1].targetId !== '$material') { omittedTechniques++; continue; }
      candidates.push(foodCandidate(technique, context));
    }
    candidates.sort((a, b) => a.id.localeCompare(b.id));
    candidates.push(alternative('rest', receipts, now), alternative('wait', receipts, now));
    return freeze({ version: 1, phase: PHASE, status: 'captured', actorId: text(npc.id),
      actorEpoch: Number.isSafeInteger(npc.epoch) ? npc.epoch : null, observedAt: now,
      foodLearning, body: qualitativeBody(npc), heldObservations: held.map(targetId => observation(observations, targetId)).filter(Boolean),
      omittedTechniques, retainedEffectsCoverage: retainedEffectsCoverage(effects, context.coveredMaterials), candidates });
  } catch {
    // Observer faults are reported only to the opt-in diagnostic reader.
    return unavailable('observer-error');
  }
}
