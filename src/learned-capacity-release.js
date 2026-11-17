import { NPC_RULES } from './config.js';
import { DISCOVERY_RULES } from './discovery-config.js';
import { techniqueProof } from './discovery-state.js';
import { validateLedgers, adverseEffect, bounded, time, objectId } from './receipt-proof.js';

// A supplied means/end choice over this individual's retained outcomes, not
// knowledge of food kinds or a claim that the sampled item caused discomfort.
// Losing proof leaves the choice unknown; no new memory or permission persists.
export function learnedCapacityRelease(npc, candidates, { eligible = () => true, allowUntested = false } = {}) {
  const d=npc?.discovery, held=npc?.inventory?.items, receipts=npc?.memory?.experience;
  if(!time(npc?.elapsed)||!bounded(held,DISCOVERY_RULES.capacity)||held.length!==DISCOVERY_RULES.capacity||
    !bounded(receipts,NPC_RULES.maxExperience)||!bounded(d?.experiments,DISCOVERY_RULES.maxExperiments)||
    !bounded(d?.effects,DISCOVERY_RULES.maxEffects)||!Array.isArray(candidates)||!candidates.length)return null;
  const ledger=validateLedgers({now:npc.elapsed,receiptsInput:receipts,experimentsInput:d.experiments,effectsInput:d.effects});
  const paid=e=>Number.isFinite(e.durationSeconds)&&e.at>=e.durationSeconds&&
    e.durationSeconds+1e-8>=DISCOVERY_RULES.durations[e.primitive]*DISCOVERY_RULES.minimumCostMultiplier&&
    e.durationSeconds<=DISCOVERY_RULES.durations[e.primitive]+1e-8&&
    ledger.receipts.get(e.actionId)?.details?.result?.durationSeconds===e.durationSeconds;
  const effects=ledger.effects.filter(r=>r.valid&&r.sample.code==='SWALLOWED'&&
    r.sample.materialId===undefined&&r.sample.resultObjectId===undefined&&paid(r.sample));
  const acquisitions=ledger.experiments.filter(e=>e.ok&&paid(e)&&e.ingestionId===undefined&&
    e.resultObjectId===undefined&&(e.primitive==='pull'&&e.code==='piece_detached'&&e.materialId!==e.targetId||
      e.primitive==='grasp'&&e.code==='object_held'&&e.materialId===e.targetId));
  if(!candidates.some(t=>effects.some(r=>r.effect.effect==='sustained'&&acquisitions.some(a=>
    a.actionId<r.sample.actionId&&a.at+r.sample.durationSeconds<=r.sample.at+1e-8&&
    techniqueProof(t,{experiments:[a,r.sample],effects:[r.effect]})))))return null;
  // A deferred release of one identity must not conceal another personally
  // adverse held item. Eligibility can veto a candidate, never supply proof.
  const id=held.find(id=>effects.some(r=>r.effect.objectId===id&&adverseEffect(r.effect))&&eligible(id));
  if(id)return {type:'release',targetId:id};
  // An unavailable adverse item is not permission to displace a different trial.
  if(!allowUntested||new Set(held).size!==held.length||!held.every(objectId)||held.some(id=>d.effects.some(e=>e?.objectId===id&&adverseEffect(e))))return null;
  const unknown=held.find(id=>eligible(id)&&untestedHeldCustody(npc,id,ledger,acquisitions));
  return unknown?{type:'release',targetId:unknown}:null;
}

// Only an untested possession may be traded for room. This is a supplied
// opportunity-cost choice, not evidence that the possession is useless or safe.
function untestedHeldCustody(npc,id,ledger,acquisitions) {
  const d=npc.discovery,receipts=npc.memory.experience;
  if(!objectId(id)||npc.inventory.items.filter(value=>value===id).length!==1||
    Object.hasOwn(d.samplesPending||{},id)||
    d.effects.some(e=>e?.objectId===id)||
    d.experiments.some(e=>e?.primitive==='sample'&&e.targetId===id)||
    receipts.some(r=>r?.details?.action?.type==='sample'&&r.details.action.targetId===id))return false;
  const acquisition=acquisitions.filter(e=>e.materialId===id).at(-1);
  if(!acquisition)return false;
  const receipt=ledger.receipts.get(acquisition.actionId),start=receipts.indexOf(receipt);
  // Raw trailing rows must remain complete, ordered and linked, including any
  // failed handling. A missing tail cannot silently restore old custody.
  let previousId=acquisition.actionId,previousAt=acquisition.at;
  for(const r of receipts.slice(start+1)) {
    if(!Number.isSafeInteger(r?.id)||r.id!==previousId+1||!time(r.at)||r.at<previousAt||r.at>npc.elapsed)return false;
    const a=r.details?.action;
    if(r.type==='action'&&(!a||typeof a.type!=='string'))return false;
    if(r.details?.result?.materialId===id||a?.targetId===id&&(a.type!=='inspect_object'||r.details?.result?.ingestionId!==undefined))return false;
    previousId=r.id;previousAt=r.at;
  }
  if(!Number.isSafeInteger(npc.memory.nextId)||previousId!==npc.memory.nextId-1)return false;
  const index=d.experiments.indexOf(acquisition);
  if(d.experiments.some((e,i)=>(i>index||e?.actionId>acquisition.actionId||e?.at>acquisition.at)&&
    (e?.targetId===id||e?.materialId===id)&&(e.primitive!=='inspect_object'||e.ingestionId!==undefined)))return false;
  return true;
}
