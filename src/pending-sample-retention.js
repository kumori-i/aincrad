import { NPC_RULES } from './config.js';
import { DISCOVERY_RULES } from './discovery-config.js';
import { validateLedgers, bounded, time, objectId, ingestionId } from './receipt-proof.js';

// A bounded reason to postpone optional disturbance of one still-held trial,
// not knowledge of its safety, benefit or remaining physical contents. This
// reads retained personal receipts only; no digestive state or new memory is
// consulted. Missing proof leaves the optional choice unknown, not protected.
export function pendingSampleRetention(npc, targetId) {
  const d=npc?.discovery, held=npc?.inventory?.items, receipts=npc?.memory?.experience;
  const pending=d?.samplesPending;
  if(!time(npc?.elapsed)||!objectId(targetId)||
    !bounded(held,DISCOVERY_RULES.capacity)||held.filter(id=>id===targetId).length!==1||
    !pending||!Object.hasOwn(pending,targetId)||!time(pending[targetId])||
    pending[targetId]>npc.elapsed||npc.elapsed-pending[targetId]>=DISCOVERY_RULES.feedbackWaitSeconds||
    !bounded(receipts,NPC_RULES.maxExperience)||
    !bounded(d?.experiments,DISCOVERY_RULES.maxExperiments)||
    !bounded(d?.effects,DISCOVERY_RULES.maxEffects))return false;
  const ledger=validateLedgers({now:npc.elapsed,receiptsInput:receipts,
    experimentsInput:d.experiments,effectsInput:d.effects});
  const samples=ledger.experiments.filter(e=>e.primitive==='sample'&&e.ok&&e.targetId===targetId);
  const sample=samples.at(-1);
  if(!sample||sample.at!==pending[targetId]||sample.code!=='SWALLOWED'||
    !ingestionId(sample.ingestionId)||sample.materialId!==undefined||
    sample.resultObjectId!==undefined||sample.finishedMaterial!==undefined||
    d.experiments.filter(e=>e?.ingestionId===sample.ingestionId).length!==1||
    receipts.filter(r=>r?.details?.result?.ingestionId===sample.ingestionId).length!==1||
    !Number.isFinite(sample.durationSeconds)||sample.at+1e-8<sample.durationSeconds||
    sample.durationSeconds+1e-8<DISCOVERY_RULES.durations.sample*DISCOVERY_RULES.minimumCostMultiplier||
    sample.durationSeconds>DISCOVERY_RULES.durations.sample+1e-8||
    ledger.receipts.get(sample.actionId)?.details?.result?.durationSeconds!==sample.durationSeconds)return false;
  // Filtering malformed rows must not resurrect an older completed trial.
  // A later valid failed attempt leaves the earlier swallowed portion pending;
  // a later successful or unlinked attempt makes an older marker insufficient.
  const sampleIndex=d.experiments.indexOf(sample), receiptIndex=receipts.indexOf(ledger.receipts.get(sample.actionId));
  if(d.experiments.some((e,i)=>e?.primitive==='sample'&&e.targetId===targetId&&
      (i>sampleIndex||e.id>sample.id||e.actionId>sample.actionId||e.at>sample.at)&&
      (!ledger.experiments.includes(e)||e.ok))||
    receipts.some((r,i)=>r?.details?.action?.type==='sample'&&r.details.action.targetId===targetId&&
      (i>receiptIndex||r.id>sample.actionId||r.at>sample.at)&&
      !ledger.experiments.some(e=>e.actionId===r.id&&e.primitive==='sample'&&e.ok===false)))return false;
  // A stale per-object marker cannot reopen an already recognized portion.
  // Feedback from an older portion cannot end this newer portion's wait.
  return !ledger.effects.some(row=>row.valid&&row.sample===sample);
}
