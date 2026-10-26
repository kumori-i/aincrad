import { DISCOVERY_RULES } from './discovery-config.js';
import { validateLedgers, adverseEffect } from './receipt-proof.js';

/** Bounded retained testimony, never personal effects or executable advice. */
export const FOOD_WARNING_WINDOW_SECONDS = 900;
const actors = new Set(['aster', 'mira']);
const objectId = v => typeof v === 'string' && /^object:[1-9]\d{0,8}$/.test(v);
const token = v => typeof v === 'string' && /^[a-zA-Z0-9:_\-.]{1,80}$/.test(v);
const time = v => Number.isFinite(v) && v >= 0 && v <= 3600 * 100000;
const id = v => Number.isSafeInteger(v) && v > 0;
const plain = v => v && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const keys = (v, required, optional = []) => plain(v) && required.every(k => Object.hasOwn(v,k)) && Reflect.ownKeys(v).every(k => required.includes(k) || optional.includes(k));
const same = (a,b) => Object.is(a,b) || plain(a) && plain(b) && Reflect.ownKeys(a).length===Reflect.ownKeys(b).length && Reflect.ownKeys(a).every(k=>Object.hasOwn(b,k)&&same(a[k],b[k]));
const effectKeys = ['id','at','objectId','actionId','ingestionId','effect','hunger','thirst','energy','pain','source'];
function validEffect(e, proof = true) {
  return keys(e, [...effectKeys, ...(proof ? ['proofEventId'] : [])]) && token(e.id) && time(e.at) && objectId(e.objectId) && id(e.actionId) &&
    typeof e.ingestionId === 'string' && /^ingestion:\d{1,16}$/.test(e.ingestionId) &&
    ['sustained','water relief','discomfort','no noticeable change'].includes(e.effect) &&
    ['hunger','thirst','energy'].every(k => ['easing','unchanged'].includes(e[k])) &&
    ['none','aching','hurting'].includes(e.pain) && e.source === 'experienced' && (!proof || id(e.proofEventId));
}
function validExperiment(e, type) {
  const extra = type === 'sample' ? 'ingestionId' : 'materialId';
  return keys(e,['id','at','primitive','targetId','ok','code','durationSeconds','actionId',extra]) &&
    id(e.id) && id(e.actionId) && time(e.at) && e.primitive === type && objectId(e.targetId) && e.ok === true &&
    token(e.code) && Number.isFinite(e.durationSeconds) && e.durationSeconds > 0 && e.durationSeconds <= 30 &&
    (type === 'sample' ? typeof e.ingestionId === 'string' && /^ingestion:\d{1,16}$/.test(e.ingestionId) : objectId(e.materialId));
}
function validActionReceipt(r,e) {
  const extra = e.primitive === 'sample' ? 'ingestionId' : 'materialId';
  return keys(r,['id','type','at','details']) && r.id === e.actionId && r.type === 'action' && r.at === e.at &&
    keys(r.details,['action','result']) && keys(r.details.action,['type','targetId']) &&
    keys(r.details.result,['ok','code','durationSeconds',extra]) && r.details.result.durationSeconds === e.durationSeconds;
}
function validRecognition(r,e) {
  return keys(r,['id','type','at','details']) && id(r.id) && time(r.at) && r.type === 'condition' &&
    keys(r.details,['code','feedback']) && r.details.code === 'DISCOVERY_EFFECT' && validEffect(r.details.feedback,false) &&
    effectKeys.every(k => r.details.feedback[k] === e[k]);
}
/** Reject unknown fields rather than silently normalizing active caution. */
export function cleanFoodWarning(raw) {
  if (!keys(raw,['version','senderId','materialId','receivedAt','sample','experience','sampleReceipt','recognitionReceipt'],['source']) ||
      raw.version !== 1 || !actors.has(raw.senderId) || !objectId(raw.materialId) || !time(raw.receivedAt) ||
      !validExperiment(raw.sample,'sample') || !validEffect(raw.experience) || !adverseEffect(raw.experience) ||
      raw.sample.targetId !== raw.materialId || !validActionReceipt(raw.sampleReceipt,raw.sample) || !validRecognition(raw.recognitionReceipt,raw.experience)) return null;
  const experiments = [raw.sample], receipts = [raw.sampleReceipt,raw.recognitionReceipt];
  if (Object.hasOwn(raw,'source')) {
    const s=raw.source;
    if (!keys(s,['experiment','receipt']) || !validExperiment(s.experiment,'pull') || !validActionReceipt(s.receipt,s.experiment) ||
        s.experiment.materialId !== raw.materialId || s.experiment.targetId === raw.materialId ||
        s.experiment.id >= raw.sample.id || s.experiment.actionId >= raw.sample.actionId || s.experiment.at > raw.sample.at) return null;
    experiments.push(s.experiment); receipts.push(s.receipt);
  }
  const verified=validateLedgers({now:raw.receivedAt,receiptsInput:receipts,experimentsInput:experiments,effectsInput:[raw.experience]});
  if (verified.experiments.length !== experiments.length || !verified.effects[0]?.valid) return null;
  return structuredClone(raw);
}
function copiedExperiment(e) {
  return Object.fromEntries(['id','at','primitive','targetId','ok','code','durationSeconds','actionId',e.primitive==='sample'?'ingestionId':'materialId'].map(k=>[k,e[k]]));
}
function copiedReceipt(e) {
  const extra=e.primitive==='sample'?'ingestionId':'materialId';
  return {id:e.actionId,type:'action',at:e.at,details:{action:{type:e.primitive,targetId:e.targetId},result:{ok:true,code:e.code,durationSeconds:e.durationSeconds,[extra]:e[extra]}}};
}
/** Generation alone consults the speaker's own canonical receipts; no ecology. */
export function canonicalAdverseWarning(npc,effectId,receivedAt=npc.elapsed) {
  const d=npc?.discovery, receipts=npc?.memory?.experience;
  if (!actors.has(npc?.id) || !time(npc.elapsed) || !time(receivedAt) || !d || !Array.isArray(receipts) || receipts.length>400 ||
      !Array.isArray(d.experiments) || d.experiments.length>DISCOVERY_RULES.maxExperiments || !Array.isArray(d.effects) || d.effects.length>64) return null;
  if (!d.effects.some(e=>e?.id===effectId&&adverseEffect(e))) return null;
  const verified=validateLedgers({now:npc.elapsed,receiptsInput:receipts,experimentsInput:d.experiments,effectsInput:d.effects});
  const row=verified.effects.find(r=>r.valid && r.effect.id===effectId && adverseEffect(r.effect));
  if (!row || verified.receipts.get(row.sample.actionId)?.details?.result?.durationSeconds!==row.sample.durationSeconds) return null;
  const source=verified.experiments.filter(e=>e.ok && e.primitive==='pull' && e.materialId===row.sample.targetId && e.id<row.sample.id && e.actionId<row.sample.actionId && e.at<=row.sample.at && verified.receipts.get(e.actionId)?.details?.result?.durationSeconds===e.durationSeconds);
  // A repeated/ambiguous production claim cannot establish an origin.
  const origin=source.length===1?source[0]:null;
  const experience=Object.fromEntries([...effectKeys,'proofEventId'].map(k=>[k,row.effect[k]]));
  const warning={version:1,senderId:npc.id,materialId:row.sample.targetId,receivedAt,
    sample:copiedExperiment(row.sample),experience,sampleReceipt:copiedReceipt(row.sample),
    recognitionReceipt:{id:row.recognition.id,type:'condition',at:row.recognition.at,details:{code:'DISCOVERY_EFFECT',feedback:Object.fromEntries(effectKeys.map(k=>[k,row.effect[k]]))}},
    ...(origin?{source:{experiment:copiedExperiment(origin),receipt:copiedReceipt(origin)}}:{})};
  return cleanFoodWarning(warning);
}
export function foodWarningText(warning) {
  return `After sampling ${warning.materialId}, I later felt discomfort. ${warning.source?`I personally pulled that material from ${warning.source.experiment.targetId}. `:''}I would avoid that exact material for now. The timing does not establish the cause; other exposures may be involved. This is my experience, not proof about similar things.`;
}
export function validFoodWarningMessage(message,now=Infinity) {
  if (message?.warning === undefined) return true;
  const w=cleanFoodWarning(message.warning);
  return !!w && message.channel==='peer' && message.senderId===w.senderId && actors.has(message.recipientId) &&
    message.recipientId!==message.senderId && message.offline===true && !message.model && !message.teaching &&
    typeof message.id==='string' && /^message:[1-9]\d{0,15}$/.test(message.id) && time(message.at) && message.at<=now && message.at>=w.recognitionReceipt.at && message.at===w.receivedAt && message.text===foodWarningText(w);
}
export function validFoodWarningMessages(rows,now,limit) {
  if (!Array.isArray(rows)) return false;
  const warnings=rows.filter(m=>m?.warning!==undefined);
  return !warnings.length || rows.length<=limit && warnings.every(m=>validFoodWarningMessage(m,now)&&rows.filter(other=>other?.id===m.id).length===1);
}
export function validFoodWarningReport(report,npc) {
  const w=cleanFoodWarning(report?.warning);
  if (!w || !actors.has(npc?.id) || npc.id===w.senderId || w.receivedAt>npc.elapsed ||
      report.sourceId!==w.senderId || report.channel!=='peer' || report.objectId!==w.materialId ||
      report.status!=='unverified' || report.cursor!==0 || report.proposed?.length!==0 || report.evidence?.length!==0 || report.teaching ||
      report.text!==foodWarningText(w)) return false;
  const heard=(npc.social?.heard||[]).filter(m=>m.id===report.messageId);
  return heard.length===1 && validFoodWarningMessage(heard[0]) && heard[0].recipientId===npc.id &&
    heard[0].senderId===report.sourceId && heard[0].at===report.at && same(heard[0].warning,w);
}
export function validFoodWarningReports(npc) {
  const reports=npc?.discovery?.reports;
  if (!Array.isArray(reports) || reports.length>24) return false;
  const warnings=reports.filter(r=>r.warning!==undefined);
  return new Set(warnings.map(r=>r.messageId)).size===warnings.length && warnings.every(r=>validFoodWarningReport(r,npc)&&reports.filter(other=>other.id===r.id||other.messageId===r.messageId).length===1);
}
/** Losing the bounded heard receipt retires authority, but preserves prose. */
export function retireUnheardFoodWarnings(npc) {
  const heard=new Set((npc.social?.heard||[]).map(m=>m.id));
  for (const report of npc.discovery?.reports||[]) if (report.warning && !heard.has(report.messageId)) delete report.warning;
}
export function receivedMaterialCaution(npc,materialId) {
  if (!npc?.inventory?.items?.includes(materialId) || !npc.discovery?.observations?.[materialId]) return null;
  return npc.discovery.reports.find(report=>report.warning?.materialId===materialId && validFoodWarningReport(report,npc) &&
    npc.elapsed-report.warning.receivedAt>=0 && npc.elapsed-report.warning.receivedAt<FOOD_WARNING_WINDOW_SECONDS) || null;
}
