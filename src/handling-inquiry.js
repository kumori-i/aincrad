import { cleanAppearanceCues, appearanceCuesMatch } from './peer-teaching.js';
import { DISCOVERY_RULES } from './discovery-config.js';
import { priorAdverseSource } from './observational-learning.js';

// Supplied motor analogy, not a food hypothesis or a primitive plan inventor.
// Admissions never evict. Detail/proof can retire without renewing permission.
export const HANDLING_ADMISSION_LIMIT = 64;
export const HANDLING_QUESTION_LIMIT = 16;
export const HANDLING_QUESTION = 'Grasping did not acquire this. Pulling detached something from that similar-looking source. Could pulling work here?';
const objectId = v => typeof v === 'string' && /^object:[1-9][0-9]{0,8}$/.test(v);
const positive = v => Number.isSafeInteger(v) && v > 0;
const physicalFailures = new Set(['object_still_attached','object_too_heavy','object_resists_grasp']);
const keys = ['actorId','sourceId','priorSourceId','at','cues','failedId','priorId','attemptId','state'];
export function handlingReceipt(npc, e) {
  if (!e || !positive(e.id) || !positive(e.actionId) || !objectId(e.targetId) ||
      !Number.isFinite(e.at) || e.at < e.durationSeconds || e.at > npc.elapsed ||
      !Number.isFinite(e.durationSeconds) || e.durationSeconds <= 0 || e.durationSeconds > 30) return false;
  const events = (npc.memory?.experience || []).filter(r => r.id === e.actionId);
  const r = events.length === 1 ? events[0] : null, result = r?.details?.result;
  return r?.type === 'action' && r.at === e.at && r.details.action?.type === e.primitive &&
    r.details.action?.targetId === e.targetId && result?.ok === e.ok && result.code === e.code &&
    result.durationSeconds === e.durationSeconds && result.materialId === e.materialId &&
    result.ingestionId === e.ingestionId && result.resultObjectId === e.resultObjectId &&
    result.handling?.source === 'experienced' && result.handling.activeActionSeconds === e.durationSeconds &&
    ['rising','steady'].includes(result.handling.effort);
}
const fullMotorDuration = e => e.durationSeconds+1e-8>=DISCOVERY_RULES.durations[e.primitive]*DISCOVERY_RULES.minimumCostMultiplier&&e.durationSeconds<=DISCOVERY_RULES.durations[e.primitive]+1e-8;
const failedGrasp = (npc,e) => e?.primitive === 'grasp' && e.ok === false && physicalFailures.has(e.code) &&
  e.materialId === undefined && e.ingestionId === undefined && e.resultObjectId === undefined && fullMotorDuration(e) && handlingReceipt(npc,e);
const successfulPull = (npc,e) => e?.primitive === 'pull' && e.ok === true && e.code === 'piece_detached' &&
  objectId(e.materialId) && e.materialId !== e.targetId && e.ingestionId === undefined && e.resultObjectId === undefined && fullMotorDuration(e) && handlingReceipt(npc,e);
const find = (d,id) => {const rows=d.experiments.filter(e=>e.id===id);return rows.length===1?rows[0]:null;};
// Aggregate history can veto stale evidence, never supply missing proof. A
// saved inquiry checks only history before its admission, not later handling.
function supersedingHandlingSummary(d,failed,before=Infinity){
  return ['grasp','catch'].some(type=>{
    const t=d.trials?.[`${failed.targetId}|${type}`];
    return t&&t.lastAt<before&&(t.lastAt>failed.at||t.lastAt===failed.at&&
      (type==='catch'||t.lastCode!==failed.code||t.lastOk!==false));
  });
}

function proof(npc,q,d=npc.discovery) {
  const failed=find(d,q.failedId),prior=find(d,q.priorId);
  if(!failedGrasp(npc,failed)||!successfulPull(npc,prior)||failed.id===prior.id)return false;
  const later=failed.id>prior.id?failed:prior,earlier=later===failed?prior:failed;
  return q.actorId===npc.id && failed.targetId===q.sourceId && prior.targetId===q.priorSourceId &&
    earlier.at<=later.at && later.at===q.at && !supersedingHandlingSummary(d,failed,q.at) &&
    !d.experiments.some(e=>e.targetId===q.sourceId&&
      (e.primitive==='pull'&&e.id<later.id||['grasp','catch'].includes(e.primitive)&&e.id>failed.id&&e.id<later.id));
}
export function validHandlingInquiries(d,npc) {
  const admissions=d.handlingAdmissions,rows=d.handlingQuestions;
  if(!Array.isArray(admissions)||admissions.length>HANDLING_ADMISSION_LIMIT||!admissions.every(objectId)||new Set(admissions).size!==admissions.length||
     !Array.isArray(rows)||rows.length>HANDLING_QUESTION_LIMIT||new Set(rows.map(q=>q?.sourceId)).size!==rows.length)return false;
  return rows.every(q=>{
    if(!q||typeof q!=='object'||Array.isArray(q)||Object.keys(q).length!==keys.length||keys.some(k=>!Object.hasOwn(q,k))||
      q.actorId!==npc.id||!admissions.includes(q.sourceId)||!objectId(q.priorSourceId)||q.sourceId===q.priorSourceId||
      !Number.isFinite(q.at)||q.at<0||q.at>1e10||q.at>npc.elapsed||!cleanAppearanceCues(q.cues)||
      !['pending','attempting','completed','unavailable','retired'].includes(q.state))return false;
    if(q.state==='retired')return q.failedId===null&&q.priorId===null&&q.attemptId===null;
    if(!positive(q.failedId)||!positive(q.priorId)||!proof(npc,q,d))return false;
    const first=d.experiments.filter(e=>e.primitive==='pull'&&e.targetId===q.sourceId&&e.id>Math.max(q.failedId,q.priorId)&&e.at>=q.at).sort((a,b)=>a.id-b.id)[0];
    if(q.state!=='completed')return q.attemptId===null&&(q.state==='unavailable'||!first);
    const e=find(d,q.attemptId);
    // Any actual subsequent canonical pull consumes the one trial, including an
    // access rejection. Only a measured physical detachment earns that outcome.
    return positive(q.attemptId)&&e===first&&e?.primitive==='pull'&&e.targetId===q.sourceId&&e.id>Math.max(q.failedId,q.priorId)&&e.at>=q.at;
  });
}
export function retireHandlingInquiries(npc) {
  for(const q of npc.discovery?.handlingQuestions||[])if(q.state!=='retired'&&
    (!proof(npc,q)||q.attemptId!==null&&!find(npc.discovery,q.attemptId))){
    q.state='retired';q.failedId=null;q.priorId=null;q.attemptId=null;
  }
}
export function recordHandlingOutcome(npc,e,{appearance}) {
  const d=npc.discovery;
  for(const q of d.handlingQuestions||[])if(['pending','attempting'].includes(q.state)&&e.primitive==='pull'&&e.targetId===q.sourceId&&e.id>Math.max(q.failedId,q.priorId)){q.attemptId=e.id;q.state='completed';}
  const failedNow=failedGrasp(npc,e),pulledNow=successfulPull(npc,e);
  if((!failedNow&&!pulledNow)||!validHandlingInquiries(d,npc)||d.handlingAdmissions.length>=HANDLING_ADMISSION_LIMIT)return;
  // Either personally earned outcome can supply the second half of the same
  // uncertain contrast. Admit at most one new trial per completed action.
  const failures=failedNow?[e]:[...d.experiments].reverse().filter(f=>f.id<e.id&&failedGrasp(npc,f));
  for(const failed of failures){
    if(d.handlingAdmissions.includes(failed.targetId)||npc.inventory.items.includes(failed.targetId)||
      supersedingHandlingSummary(d,failed)||
      (d.trials?.[`${failed.targetId}|pull`]?.attempts||0)>0||
      d.experiments.some(p=>p.targetId===failed.targetId&&
        (p.primitive==='pull'&&p.id<e.id||['grasp','catch'].includes(p.primitive)&&p.id>failed.id&&p.id<e.id)))continue;
    const target=appearance(failed.targetId);if(!target)continue;
    const prior=pulledNow?e:[...d.experiments].reverse().find(p=>p.id<e.id&&p.targetId!==failed.targetId&&successfulPull(npc,p)&&
      appearanceCuesMatch(appearance(p.targetId)?.cues,target.cues));
    if(!prior||prior.targetId===failed.targetId||!appearanceCuesMatch(appearance(prior.targetId)?.cues,target.cues))continue;
    const question={actorId:npc.id,sourceId:failed.targetId,priorSourceId:prior.targetId,at:e.at,cues:{...target.cues},failedId:failed.id,priorId:prior.id,attemptId:null,state:'pending'};
    if(!proof(npc,question))continue;
    d.handlingAdmissions.push(failed.targetId);d.handlingQuestions.push(question);
    if(d.handlingQuestions.length>HANDLING_QUESTION_LIMIT)d.handlingQuestions.shift();
    return;
  }
}
export function handlingExperiment(npc,{body,appearance,local,blocked}) {
  const d=npc.discovery;
  if(npc.lifecycle!=='AWAKE'||npc.active||npc.inventory.items.length>=DISCOVERY_RULES.capacity||
    ['full','overfull'].includes(body.digestion)||['winded','exhausted'].includes(body.stamina)||
    ['weary','exhausted'].includes(body.fatigue)||['sleepy','struggling to stay awake'].includes(body.sleepiness)||
    body.energy==='depleted'||['aching','hurting','severe'].includes(body.pain)||
    ['ravenous','faint with hunger'].includes(body.hunger)||['parched','desperate thirst'].includes(body.thirst)||
    body.thermal.startsWith('dangerously')||['overheated','shivering'].includes(body.thermal))return null;
  for(const q of d.handlingQuestions||[]){
    if(q.state!=='pending'||npc.elapsed-q.at>300||!proof(npc,q)||priorAdverseSource(d,q.sourceId)||priorAdverseSource(d,q.priorSourceId)||
      !local(q.sourceId)||!appearanceCuesMatch(appearance(q.sourceId)?.cues,q.cues)||
      !appearanceCuesMatch(appearance(q.priorSourceId)?.cues,q.cues)||blocked('pull',q.sourceId))continue;
    q.state='attempting'; // Selecting consumes the opportunity, even if cancelled before start.
    return {type:'pull',targetId:q.sourceId};
  }
  return null;
}
export function handlingInquiries(npc) {
  return (npc.discovery?.handlingQuestions||[]).map(q=>{
    const e=find(npc.discovery,q.attemptId);
    const status=q.state==='retired'?'retired':q.state==='completed'?
      successfulPull(npc,e)?'detached':e?.ok===false&&e.code==='nothing_detached'&&fullMotorDuration(e)&&handlingReceipt(npc,e)?'did-not-detach':'unavailable':
      q.state==='unavailable'||npc.elapsed-q.at>300?'unavailable':q.state==='attempting'?'attempting':'uncertain';
    return {sourceId:q.sourceId,priorSourceId:q.priorSourceId,at:q.at,status,question:HANDLING_QUESTION,provenance:'own handling outcomes'};
  });
}
