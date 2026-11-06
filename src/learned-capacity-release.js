import { NPC_RULES } from './config.js';
import { DISCOVERY_RULES } from './discovery-config.js';
import { techniqueProof } from './discovery-state.js';
import { validateLedgers, adverseEffect, bounded, time } from './receipt-proof.js';

// A supplied means/end choice over this individual's retained outcomes, not
// knowledge of food kinds or a claim that the sampled item caused discomfort.
// Losing proof leaves the choice unknown; no new memory or permission persists.
export function learnedCapacityRelease(npc, candidates) {
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
  const id=held.find(id=>effects.some(r=>r.effect.objectId===id&&adverseEffect(r.effect)));
  return id?{type:'release',targetId:id}:null;
}
