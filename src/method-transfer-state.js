/** A bounded, non-evicting admission ledger, not experience or proficiency.
 * Saturation disables new cross-source trials, never bodily care or discovery. */
export const METHOD_TRIAL_LIMIT=64;
const objectId=v=>typeof v==='string'&&/^object:[1-9][0-9]{0,8}$/.test(v);
const fields=['senderId','sourceObjectId','acquisition'];
export function validMethodTrials(rows,npcId){
  return Array.isArray(rows)&&rows.length<=METHOD_TRIAL_LIMIT&&rows.every(r=>r&&typeof r==='object'&&!Array.isArray(r)&&
    Object.keys(r).length===3&&Object.keys(r).every(k=>fields.includes(k))&&['aster','mira'].includes(r.senderId)&&r.senderId!==npcId&&
    objectId(r.sourceObjectId)&&['pull','grasp'].includes(r.acquisition))&&new Set(rows.map(methodTrialKey)).size===rows.length;
}
export const methodTrialKey=r=>`${r.senderId}|${r.sourceObjectId}|${r.acquisition}`;
export function admitMethodTrial(discovery,senderId,sourceObjectId,acquisition){
  const row={senderId,sourceObjectId,acquisition},rows=discovery.methodTrials;
  if(!validMethodTrials(rows)||!validMethodTrials([row])||rows.length>=METHOD_TRIAL_LIMIT||rows.some(r=>methodTrialKey(r)===methodTrialKey(row)))return false;
  rows.push(row);return true;
}
