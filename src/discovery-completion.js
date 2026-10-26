import { DISCOVERY_RULES } from './discovery-config.js';

const has = (row, key) => row != null && Object.hasOwn(row, key);
const objectId = value => typeof value === 'string' && /^object:[1-9][0-9]{0,8}$/.test(value);
const ingestionId = value => typeof value === 'string' && /^ingestion:[1-9][0-9]*$/.test(value);
const positiveId = value => Number.isSafeInteger(value) && value > 0;

// An optional qualitative last-mouthful receipt, never safety or food knowledge.
export function validFinishedMaterialRow(primitive, targetId, result) {
  if (!has(result, 'finishedMaterial')) return true;
  return result.finishedMaterial === true && primitive === 'sample' &&
    objectId(targetId) && result.ok === true && result.code === 'SWALLOWED' &&
    ingestionId(result.ingestionId) && !has(result, 'materialId') && !has(result, 'resultObjectId');
}
export function matchingFinishedMaterial(experiment, receipt) {
  const result = receipt?.details?.result, action = receipt?.details?.action;
  const left = has(experiment, 'finishedMaterial'), right = has(result, 'finishedMaterial');
  if (!left && !right) return true;
  return left && right && validFinishedMaterialRow(experiment.primitive, experiment.targetId, experiment) &&
    validFinishedMaterialRow(action?.type, action?.targetId, result) && receipt.type === 'action' &&
    positiveId(experiment.id) && positiveId(experiment.actionId) && receipt.id === experiment.actionId &&
    Number.isFinite(experiment.at) && experiment.at >= 0 && receipt.at === experiment.at &&
    action.type === experiment.primitive && action.targetId === experiment.targetId &&
    result.ingestionId === experiment.ingestionId && result.ok === experiment.ok && result.code === experiment.code;
}

// Saves/clones cannot recreate this measured runtime authority. In particular,
// inventory absence may mean transfer/decay, and is NOT proof of consumption.
const completions = new WeakMap();
function current(npc) {
  let rows = completions.get(npc) || [];
  rows = rows.filter(row => row.physiology === npc.physiology && row.discovery === npc.discovery &&
    row.epoch === npc.epoch && Number.isFinite(npc.elapsed) && row.at <= npc.elapsed &&
    npc.elapsed - row.at < DISCOVERY_RULES.feedbackWaitSeconds);
  completions.set(npc, rows);
  return rows;
}
export function registerMaterialCompletion(npc, proof) {
  if (!npc || !proof) return false;
  const experiment = npc.discovery?.experiments?.find(e => e.actionId === proof.actionId);
  const receipt = npc.memory?.experience?.find(e => e.id === proof.actionId);
  if (!experiment?.finishedMaterial || !matchingFinishedMaterial(experiment, receipt) ||
    experiment.targetId !== proof.targetId || experiment.ingestionId !== proof.ingestionId ||
    experiment.at !== proof.at || proof.at !== npc.elapsed) return false;
  const rows = current(npc);
  if (rows.some(row => row.actionId === proof.actionId || row.targetId === proof.targetId)) return false;
  rows.push({...proof, physiology:npc.physiology, discovery:npc.discovery, epoch:npc.epoch});
  completions.set(npc, rows.slice(-16));
  return true;
}
export function witnessedMaterialCompletion(npc, experiment) {
  if (!experiment?.finishedMaterial || !matchingFinishedMaterial(experiment,
    npc.memory?.experience?.find(e => e.id === experiment.actionId))) return false;
  return current(npc).some(row => row.targetId === experiment.targetId && row.actionId === experiment.actionId &&
    row.ingestionId === experiment.ingestionId && row.at === experiment.at);
}
