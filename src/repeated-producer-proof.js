import { NPC_RULES } from './config.js';
import { DISCOVERY_RULES } from './discovery-config.js';

const id = value => Number.isSafeInteger(value) && value > 0;
const time = value => Number.isFinite(value) && value >= 0;
const objectId = value => typeof value === 'string' && /^object:\d{1,9}$/.test(value);
const ingestionId = value => typeof value === 'string' && value.length <= 80 && /^ingestion:\d+$/.test(value);
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 80;
const kinds = new Set(['sustained', 'water relief', 'discomfort', 'no noticeable change']);
const bounded = (rows, limit) => Array.isArray(rows) && rows.length <= limit;
function unique(rows, key) {
  const index = new Map();
  for (const row of rows) {
    const value = key(row);
    index.set(value, index.has(value) ? null : row);
  }
  return index;
}

/** Pure, bounded, selection-local proof. No retention, physiology or world query. */
export function repeatedProducerProofView(npc) {
  const d = npc?.discovery, events = npc?.memory?.experience, now = npc?.elapsed;
  const unavailable = { proofFor: () => null };
  if (!time(now) || !bounded(d?.experiments, DISCOVERY_RULES.maxExperiments) ||
      !bounded(d?.effects, DISCOVERY_RULES.maxEffects) || !bounded(events, NPC_RULES.maxExperience)) return unavailable;
  const experiments = d.experiments, effects = d.effects;
  if (experiments.some(e => !e || typeof e !== 'object') || effects.some(e => !e || typeof e !== 'object') ||
      events.some(e => !e || typeof e !== 'object')) return unavailable;
  const receipts = unique(events, e => e.id), experimentIds = unique(experiments, e => e.id);
  const actions = unique(experiments, e => e.actionId);
  const samples = experiments.filter(e => e.primitive === 'sample' && e.ok === true);
  const ingestions = unique(samples, e => e.ingestionId);
  const pulls = experiments.filter(e => e.primitive === 'pull' && e.ok === true);
  const materials = unique(pulls, e => e.materialId);
  const conditions = events.filter(r => r.type === 'condition' && r.details?.code === 'DISCOVERY_EFFECT');
  const originalFeedback = unique(conditions, r => r.details?.feedback?.id);
  const effectIds = unique(effects, e => e.id), recognitions = unique(effects, e => e.proofEventId);
  const portionEffects = unique(effects, e => `${e.ingestionId}|${e.effect}`);
  const validActions = new Map();
  function actionMatches(e) {
    if (validActions.has(e)) return validActions.get(e);
    const r = receipts.get(e.actionId), a = r?.details?.action, result = r?.details?.result;
    const valid = id(e.id) && id(e.actionId) && experimentIds.get(e.id) === e && actions.get(e.actionId) === e &&
      e.ok === true && time(e.at) && e.at <= now && objectId(e.targetId) &&
      Number.isFinite(e.durationSeconds) && e.durationSeconds > 0 && text(e.code) &&
      r?.type === 'action' && r.at === e.at && a?.type === e.primitive && a.targetId === e.targetId &&
      result?.ok === true && result.code === e.code && result.durationSeconds === e.durationSeconds &&
      result.materialId === e.materialId && result.ingestionId === e.ingestionId &&
      (e.materialId === undefined || objectId(e.materialId)) &&
      (e.ingestionId === undefined || ingestionId(e.ingestionId));
    validActions.set(e, valid); return valid;
  }
  function recognized(effect, sample) {
    const r = receipts.get(effect.proofEventId), f = r?.details?.feedback;
    return text(effect.id) && effectIds.get(effect.id) === effect && id(effect.proofEventId) &&
      recognitions.get(effect.proofEventId) === effect && portionEffects.get(`${effect.ingestionId}|${effect.effect}`) === effect &&
      effect.source === 'experienced' && kinds.has(effect.effect) && objectId(effect.objectId) &&
      ingestionId(effect.ingestionId) && ingestions.get(effect.ingestionId) === sample &&
      actionMatches(sample) && sample.code === 'SWALLOWED' && sample.materialId === undefined && sample.targetId === effect.objectId &&
      sample.actionId === effect.actionId && sample.ingestionId === effect.ingestionId &&
      time(effect.at) && effect.at >= sample.at && effect.at <= now &&
      ['hunger', 'thirst', 'energy'].every(key => ['easing', 'unchanged'].includes(effect[key])) &&
      ['none', 'aching', 'hurting'].includes(effect.pain) &&
      r?.type === 'condition' && originalFeedback.get(effect.id) === r && r.id > sample.actionId && time(r.at) && r.at >= effect.at && r.at <= now &&
      r.details?.code === 'DISCOVERY_EFFECT' && f &&
      ['id', 'at', 'objectId', 'actionId', 'ingestionId', 'effect', 'hunger', 'thirst', 'energy', 'pain', 'source'].every(key => f[key] === effect[key]);
  }
  // Index plausible source ancestry as well as valid positive chains. A damaged
  // third-return adverse link cannot silently turn into permission to repeat.
  const returned = new Map();
  function rememberReturn(source, material) {
    if (!objectId(source) || !objectId(material)) return;
    if (!returned.has(source)) returned.set(source, new Set());
    returned.get(source).add(material);
  }
  for (const e of experiments) if (e.primitive === 'pull') rememberReturn(e.targetId, e.materialId);
  for (const r of events) if (r.type === 'action' && r.details?.action?.type === 'pull')
    rememberReturn(r.details.action.targetId, r.details.result?.materialId);
  const conditionFeedback = conditions.map(r => r.details.feedback).filter(Boolean);
  const chains = new Map();
  for (const effect of effects) {
    if (effect.effect !== 'sustained' || effect.hunger !== 'easing' || effect.energy !== 'easing' || effect.pain !== 'none') continue;
    const sample = ingestions.get(effect.ingestionId), acquisition = materials.get(sample?.targetId);
    if (!sample || !acquisition || !recognized(effect, sample) || !actionMatches(acquisition) ||
        acquisition.code !== 'piece_detached' || acquisition.ingestionId !== undefined ||
        acquisition.id >= sample.id || acquisition.actionId >= sample.actionId || acquisition.at > sample.at ||
        acquisition.materialId === acquisition.targetId) continue;
    const source = acquisition.targetId;
    if (!chains.has(source)) chains.set(source, []);
    chains.get(source).push({ sourceId: source, acquisitionId: acquisition.id, acquisitionActionId: acquisition.actionId,
      materialId: acquisition.materialId, sampleId: sample.id, sampleActionId: sample.actionId,
      ingestionId: sample.ingestionId, feedbackId: effect.id, recognitionId: effect.proofEventId });
  }
  const sourceProofs = new Map();
  function proofFor(technique) {
    if (technique?.confidence === 'revised' || !objectId(technique?.sourceId) || technique?.steps?.length !== 2 ||
        technique.steps[0]?.type !== 'pull' || technique.steps[0].targetId !== '$source' ||
        technique.steps[1]?.type !== 'sample' || technique.steps[1].targetId !== '$material') return null;
    const source = technique.sourceId;
    if (sourceProofs.has(source)) return sourceProofs.get(source);
    sourceProofs.set(source, null);
    const possible = chains.get(source) || [], pair = [];
    for (const chain of possible) {
      if (pair.length && ['acquisitionId', 'acquisitionActionId', 'materialId', 'sampleId', 'sampleActionId', 'ingestionId', 'feedbackId', 'recognitionId'].some(key => pair[0][key] === chain[key])) continue;
      pair.push(chain); if (pair.length === 2) break;
    }
    if (pair.length !== 2) return null;
    const sourceMaterials = returned.get(source), sourceSamples = samples.filter(e => sourceMaterials?.has(e.targetId));
    const sampleActions = new Set(sourceSamples.map(e => e.actionId)), sampleIngestions = new Set(sourceSamples.map(e => e.ingestionId));
    const relevant = e => sourceMaterials?.has(e.objectId) || sampleActions.has(e.actionId) || sampleIngestions.has(e.ingestionId);
    // These are native effect ledgers, never the separate social reports. Even
    // malformed provenance here is uncertainty, not permission or food credit.
    const adverseOrUncertain = e => relevant(e) &&
      (e.effect === 'discomfort' || !kinds.has(e.effect) || e.pain !== 'none');
    if (effects.some(adverseOrUncertain) || conditionFeedback.some(adverseOrUncertain)) return null;
    const proof = { sourceId: source, chains: pair };
    sourceProofs.set(source, proof); return proof;
  }
  return { proofFor };
}
