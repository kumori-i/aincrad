import { NPC_RULES } from './config.js';
import { DISCOVERY_RULES } from './discovery-config.js';
import { objectId, validCaptureExperiment } from './discovery-state.js';
import { matchingFinishedMaterial } from './discovery-completion.js';
import { matchingResultObject } from './discovery-result-object.js';

const positive = n => Number.isSafeInteger(n) && n > 0;
const time = n => Number.isFinite(n) && n >= 0;
const rows = value => Array.isArray(value) ? value : [];
const ingestion = id => typeof id === 'string' && /^ingestion:[1-9][0-9]*$/.test(id);

// Inspect raw claims BEFORE filtering or compaction can turn two origins into
// one. A normal experiment/action pair is one claim; an orphan is not authority.
export function extractionOriginError(npc) {
  const experiments = rows(npc?.discovery?.experiments), events = rows(npc?.memory?.experience);
  if (experiments.length > DISCOVERY_RULES.maxExperiments + 1 || events.length > NPC_RULES.maxExperience + 2)
    return 'malformed-extraction-origin';
  const byAction = new Map(), byMaterial = new Map();
  const claim = (actionId, targetId, result, at, kind) => {
    if (!positive(actionId) || !objectId(targetId) || !objectId(result.materialId) ||
        targetId === result.materialId || result.code !== 'piece_detached' || !time(at) ||
        result.ingestionId !== undefined || result.finishedMaterial !== undefined || result.resultObjectId !== undefined)
      return 'malformed-extraction-origin';
    const prior = byAction.get(actionId), signature = JSON.stringify([targetId, result.materialId, at, result.code]);
    if (prior && (prior.signature !== signature || prior.kinds.has(kind))) return 'ambiguous-extraction-origin';
    if (byMaterial.has(result.materialId) && byMaterial.get(result.materialId) !== actionId)
      return 'ambiguous-extraction-origin';
    const value = prior || { signature, kinds: new Set() };value.kinds.add(kind);
    byAction.set(actionId, value);byMaterial.set(result.materialId, actionId);
    return null;
  };
  for (const e of experiments) if (e?.primitive === 'pull' && e.ok === true) {
    const error = claim(e.actionId, e.targetId, e, e.at, 'experiment');if (error) return error;
    const paired = events.filter(r => r?.id === e.actionId);
    if (paired.some(r => r.type !== 'action' || r.details?.action?.type !== 'pull' || r.details?.result?.ok !== true))
      return 'ambiguous-extraction-origin';
  }
  for (const r of events) if (r?.type === 'action' && r.details?.action?.type === 'pull' && r.details?.result?.ok === true) {
    const error = claim(r.id, r.details.action.targetId, r.details.result, r.at, 'receipt');if (error) return error;
    if (experiments.some(e => e?.actionId === r.id && (e.primitive !== 'pull' || e.ok !== true)))
      return 'ambiguous-extraction-origin';
  }
  return null;
}
function unique(rows, key) {
  const map = new Map();
  for (const row of rows) {if (!positive(row?.[key]) || map.has(row[key])) return null;map.set(row[key], row);}
  return map;
}
function context(npc) {
  if (!time(npc?.elapsed) || extractionOriginError(npc)) return null;
  const experiments = rows(npc.discovery?.experiments), events = rows(npc.memory?.experience);
  const byAction = unique(experiments, 'actionId'), byExperiment = unique(experiments, 'id'), byEvent = unique(events, 'id');
  return byAction && byExperiment && byEvent ? { experiments, events, byAction, byEvent } : null;
}
function matched(npc, e, r) {
  const action = r?.details?.action, result = r?.details?.result;
  return positive(e?.id) && positive(e.actionId) && r?.id === e.actionId &&
    time(e.at) && e.at <= npc.elapsed && r.at === e.at && r.type === 'action' &&
    action?.type === e.primitive && action.targetId === e.targetId && objectId(e.targetId) &&
    e.ok === true && result?.ok === true && result.code === e.code &&
    result.materialId === e.materialId && result.ingestionId === e.ingestionId &&
    matchingFinishedMaterial(e,r) && matchingResultObject(e,r) && validCaptureExperiment(e,r);
}
function origins(npc, c) {
  return c.experiments.filter(e => e.primitive === 'pull' && e.code === 'piece_detached' &&
    objectId(e.materialId) && e.targetId !== e.materialId && matched(npc,e,c.byEvent.get(e.actionId)))
    .sort((a,b) => a.actionId-b.actionId);
}
export function ownExtractionOrigins(npc) {
  const c=context(npc);return c ? origins(npc,c) : [];
}
function acquiredMaterial(r, id) {
  const a=r?.details?.action, result=r?.details?.result;
  return r?.type === 'action' && result?.ok === true &&
    (a?.type === 'pull' && result.materialId === id ||
     ['grasp','catch'].includes(a?.type) && a.targetId === id);
}
function harmfulAcquisition(npc, c, sample) {
  // Receipt order, not array order or discovery IDs (which also allocate reports).
  // Either side claiming acquisition participates. A corrupted newer receipt
  // must not disappear from consideration and resurrect an older valid pull.
  const candidates = new Set(c.events.filter(r => r.id < sample.actionId && acquiredMaterial(r,sample.targetId)).map(r=>r.id));
  for (const e of c.experiments) if (e.actionId < sample.actionId && acquiredMaterial({type:'action',details:{
    action:{type:e.primitive,targetId:e.targetId},result:e}},sample.targetId)) candidates.add(e.actionId);
  const latest = [...candidates].sort((a,b)=>a-b).at(-1), receipt=c.byEvent.get(latest);
  if (!receipt || sample.actionId-receipt.id+1 > NPC_RULES.maxExperience) return null;
  let previous=-Infinity;
  for (let id=receipt.id;id<=sample.actionId;id++) {
    const r=c.byEvent.get(id);
    if (!r || !time(r.at) || r.at < previous || r.at > npc.elapsed) return null;
    previous=r.at;
  }
  const acquired=c.byAction.get(receipt.id);
  if (!matched(npc,acquired,receipt) || acquired.id >= sample.id || acquired.at > sample.at) return null;
  if (acquired.primitive === 'pull') return acquired.code === 'piece_detached' && objectId(acquired.materialId) ? acquired : null;
  if (acquired.primitive === 'grasp') return acquired.code === 'object_held' ? acquired : null;
  if (acquired.primitive === 'catch') return acquired.code === 'object_caught' ? acquired : null;
  return null;
}
function recognizedDiscomfort(npc,c,effect) {
  if (effect?.effect !== 'discomfort' || effect.source !== 'experienced' || !time(effect.at) || effect.at > npc.elapsed ||
      !ingestion(effect.ingestionId) || !positive(effect.actionId) || !objectId(effect.objectId)) return null;
  if (c.experiments.filter(e=>e.primitive==='sample' && e.ingestionId===effect.ingestionId).length !== 1) return null;
  const sample=c.byAction.get(effect.actionId), proof=c.byEvent.get(effect.proofEventId), f=proof?.details?.feedback;
  if (!matched(npc,sample,c.byEvent.get(effect.actionId)) || sample.primitive !== 'sample' || sample.code !== 'SWALLOWED' ||
      sample.targetId !== effect.objectId || sample.ingestionId !== effect.ingestionId || effect.at < sample.at ||
      proof?.type !== 'condition' || !time(proof.at) || proof.at < effect.at || proof.at > npc.elapsed ||
      proof.id <= sample.actionId || proof.details?.code !== 'DISCOVERY_EFFECT' ||
      f?.id !== effect.id || f.ingestionId !== effect.ingestionId || f.actionId !== effect.actionId ||
      f.objectId !== effect.objectId || f.effect !== effect.effect || f.source !== 'experienced' || f.at !== effect.at) return null;
  return sample;
}

// This actor's own retained origin and own recognized harm only. No ecology,
// category, peer/private-donor proof, or new numerical food observation.
export function experiencedFoodSourceCaution(npc, id) {
  if (!objectId(id) || !rows(npc?.inventory?.items).includes(id)) return false;
  // Without own recognized discomfort no retained receipt chain can authorize
  // this caution. Avoid indexing harmless histories on every eligible item.
  if (!rows(npc.discovery?.effects).some(e=>e?.effect==='discomfort' && e.source==='experienced')) return false;
  const c=context(npc);if (!c) return false;
  const origin=origins(npc,c).find(e=>e.materialId===id);if (!origin) return false;
  const effects=rows(npc.discovery?.effects);
  for (const effect of effects) {
    if (effects.filter(e=>e?.id===effect?.id).length !== 1 || effects.filter(e=>
      e?.effect==='discomfort' && e.ingestionId===effect?.ingestionId).length !== 1) continue;
    const sample=recognizedDiscomfort(npc,c,effect);if (!sample) continue;
    const acquired=harmfulAcquisition(npc,c,sample);
    if (acquired?.primitive===origin.primitive && acquired.targetId===origin.targetId) return true;
  }
  return false;
}
