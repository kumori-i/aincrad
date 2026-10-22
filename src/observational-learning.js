import { NPC_RULES } from './config.js';
import { DISCOVERY_RULES } from './discovery-config.js';
import { isSleeping } from './biology.js';
import { actorLineOfSight } from './perception.js';
import { distance } from './world.js';
import { INQUIRY_LIMIT } from './observational-inquiry-state.js';

// Called synchronously at the physical consumption boundary, not later from
// an activity label. Recognition time uses the observer's own body clock.
export function witnessConsumption(npc, event, rememberObject) {
  if (npc.mode !== 'discovery' || npc.lifecycle !== 'AWAKE' || isSleeping(npc) || event.actorId === npc.id || event.scene !== npc.scene || event.source.scene !== npc.scene) return;
  if ([event.actorPosition, event.source.position].some(p => distance(npc.position,p)>NPC_RULES.visionRadius || !actorLineOfSight(npc,npc.position,p))) return;
  const d = npc.discovery;
  if ((d.inquiries || []).some(q => q.sourceId === event.source.id)) return;
  rememberObject(npc, event.source);
  d.inquiries ||= [];
  d.inquiries.push({ sourceId:event.source.id, actorId:event.actorId, at:npc.elapsed,
    actorPosition:{...event.actorPosition}, sourcePosition:{...event.source.position}, attempts:[], retired:false });
  if (d.inquiries.length > INQUIRY_LIMIT) d.inquiries.shift();
}
export function priorAdverseSource(d,sourceId) {
  if(d.techniques.some(t=>t.sourceId===sourceId&&t.confidence==='revised'))return true;
  return d.effects.some(effect=>(effect.effect==='discomfort'||['aching','hurting'].includes(effect.pain))&&
    (effect.objectId===sourceId||d.experiments.some(sample=>sample.primitive==='sample'&&sample.ok&&sample.actionId===effect.actionId&&sample.ingestionId===effect.ingestionId&&
      d.experiments.some(acquired=>acquired.ok&&acquired.targetId===sourceId&&acquired.id<sample.id&&(acquired.primitive==='pull'&&acquired.materialId===sample.targetId||acquired.primitive==='grasp'&&acquired.targetId===sample.targetId)))));
}
export function observationalInquiries(npc) {
  const d = npc.discovery;
  return (d?.inquiries || []).map(q => {
    const ownAttempts = q.attempts.map(id=>d.experiments.find(e=>e.id===id)).filter(Boolean);
    const samples = ownAttempts.filter(e=>e.primitive==='sample' && e.ok);
    const ownEffects = d.effects.filter(e=>samples.some(s=>s.actionId===e.actionId && s.ingestionId===e.ingestionId && s.targetId===e.objectId));
    const adverse = ownEffects.some(e=>e.effect==='discomfort' || ['aching','hurting'].includes(e.pain));
    const status = q.retired ? 'retired' : adverse ? 'contradicted' : ownEffects.some(e=>e.effect==='sustained') ? 'supported' : ownEffects.length ? 'inconclusive' : samples.length ? 'waiting' : ownAttempts.some(e=>e.primitive==='sample') || ownAttempts.filter(e=>['grasp','pull'].includes(e.primitive)&&!e.ok).length===2 ? 'unavailable' : npc.elapsed-q.at>300 ? 'expired' : 'uncertain';
    const priorAdverse=priorAdverseSource(d,q.sourceId);
    const deferredReason=priorAdverse?'My earlier personal feedback from this source was adverse.':
      status==='waiting'?'A real sample is still awaiting personal feedback.':
      status==='unavailable'?'The bounded physical attempt did not provide an available sample; benefit remains untested.':
      status==='expired'?'This observation is too old to guide a new experiment.':
      status==='retired'?'The unfinished trial was retired; missing or interrupted evidence cannot restart it.':null;
    return {...q, deferredReason, question:'Could a small sample from this exact source ease my hunger?', status,
      provenance:'witnessed consumption', priorAdverse, ownAttempts:ownAttempts.map(e=>({...e})), ownEffects:ownEffects.map(e=>({...e}))};
  });
}
// A supplied, bounded generic experiment scaffold, not an invented recipe.
// Attention is sequential and only uses locally recognized exact identities.
export function observationalExperiment(npc, { body, eligible, blocked, currentlySeen }) {
  if (['full','overfull'].includes(body.digestion) || ['winded','exhausted'].includes(body.stamina) || body.energy==='depleted' || ['aching','hurting','severe'].includes(body.pain)) return null;
  for (const q of observationalInquiries(npc)) {
    if (npc.elapsed-q.at>300) continue;
    if (q.status === 'waiting') return null;
    if (q.status !== 'uncertain' || q.priorAdverse) continue;
    const acquired=q.ownAttempts.find(e=>e.ok && ['grasp','pull'].includes(e.primitive));
    if (acquired) {
      const id=acquired.primitive==='grasp'?acquired.targetId:acquired.materialId;
      if (npc.inventory.items.includes(id) && eligible(id)) return {type:'sample',targetId:id};
      continue;
    }
    if(npc.inventory.items.length>=DISCOVERY_RULES.capacity)continue;
    const o=npc.discovery.observations[q.sourceId];
    if(!o || o.observedAt<=q.at || !currentlySeen(q.sourceId) || o.scene!==npc.scene || npc.elapsed-o.observedAt>2 || distance(npc.position,o.position)>DISCOVERY_RULES.reach || !actorLineOfSight(npc,npc.position,o.position))continue;
    const type=['grasp','pull'].find(type=>!q.ownAttempts.some(e=>e.primitive===type));
    if(type && !blocked(type,q.sourceId))return {type,targetId:q.sourceId};
  }
  return null;
}
