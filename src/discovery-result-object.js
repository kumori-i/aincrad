// Optional, witnessed physical successor identity. This is never acquisition or
// nutrition evidence. Historical absence stays absent; malformed presence fails.
const has = (row, key) => row != null && Object.hasOwn(row, key);
const canonicalObjectId = value => typeof value === 'string' && /^object:[1-9][0-9]{0,8}$/.test(value);
export function validResultObjectRow(primitive, targetId, result) {
  if (!has(result, 'resultObjectId')) return true;
  return primitive === 'strike' && result.ok === true && result.code === 'object_stopped_moving' &&
    canonicalObjectId(targetId) && canonicalObjectId(result.resultObjectId) && result.resultObjectId !== targetId &&
    !has(result, 'materialId') && !has(result, 'ingestionId');
}
export function matchingResultObject(experiment, receipt) {
  const result = receipt?.details?.result, action = receipt?.details?.action;
  const left = has(experiment, 'resultObjectId'), right = has(result, 'resultObjectId');
  if (!left && !right) return true;
  return left && right && validResultObjectRow(experiment.primitive, experiment.targetId, experiment) &&
    validResultObjectRow(action?.type, action?.targetId, result) && receipt.type === 'action' &&
    Number.isSafeInteger(experiment.id) && experiment.id > 0 &&
    Number.isSafeInteger(experiment.actionId) && experiment.actionId > 0 && receipt.id === experiment.actionId &&
    Number.isFinite(experiment.at) && experiment.at >= 0 && receipt.at === experiment.at &&
    action.type === experiment.primitive && action.targetId === experiment.targetId &&
    result.ok === experiment.ok && result.code === experiment.code && result.resultObjectId === experiment.resultObjectId;
}
