// Credit is a private link to canonical personal action and ingestion receipts.
// A message is never inserted into discovery effects, techniques, or proofs.
import { discoveryActionPaidSeconds, discoveryActionCompletion } from './discovery-actions.js';

export function canonicalCommunicationEffect(npc,effect) {
  if(!effect || !Number.isFinite(effect.at) || effect.at<0 || effect.at>npc.elapsed || !['sustained','water relief','discomfort'].includes(effect.effect) || effect.source!=='experienced' || !npc.discovery.effects.includes(effect))return false;
  const sample=npc.discovery.experiments.find(e=>e.ok && e.primitive==='sample' && e.actionId===effect.actionId && e.targetId===effect.objectId && e.ingestionId===effect.ingestionId && e.at<=effect.at);
  const action=sample&&npc.memory.experience.find(e=>e.id===sample.actionId && e.type==='action' && e.at===sample.at && e.details?.action?.type==='sample' && e.details.action.targetId===sample.targetId && e.details.result?.ok===true && e.details.result.ingestionId===sample.ingestionId);
  const proof=npc.memory.experience.find(e=>e.id===effect.proofEventId);
  const f=proof?.details?.feedback;
  return !!action && proof?.type==='condition' && proof.details.code==='DISCOVERY_EFFECT' && Number.isFinite(proof.at) && proof.at>=effect.at && proof.at<=npc.elapsed &&
    f?.id===effect.id && f.objectId===effect.objectId && f.actionId===effect.actionId && f.ingestionId===effect.ingestionId && f.effect===effect.effect && f.at===effect.at && f.source==='experienced' && ['hunger','thirst','energy','pain'].every(key=>f[key]===effect[key]);
}

export function createCommunicationCredit(npc,action,active,eventFloor,horizon=60) {
  if(!active || npc.active!==active || active.kind!=='interaction' || active.request.type!==action.type || active.request.targetId!==action.targetId) return null;
  return {npc,discovery:npc.discovery,physiology:npc.physiology,epoch:npc.epoch,action:{type:action.type,targetId:action.targetId},active,eventFloor,at:npc.elapsed,deadline:npc.elapsed+horizon,paidSeconds:0,selected:null,ingestion:null,effects:new Set(),values:[],settled:false};
}

export function pollCommunicationCredit(pending,{stop=false}={}) {
  if(!pending || pending.settled)return null;
  const p=pending,n=p.npc;
  p.paidSeconds=Math.max(p.paidSeconds,discoveryActionPaidSeconds(n,p.active));
  if(stop || n.discovery!==p.discovery || n.physiology!==p.physiology || n.epoch!==p.epoch || n.lifecycle!=='AWAKE') {
    p.settled=true;return {status:'interrupted',reward:null,paidSeconds:p.paidSeconds,attributedEffects:0};
  }
  if(!p.selected) {
    const witness=discoveryActionCompletion(n,p.active);
    const e=witness&&witness.type===p.action.type&&witness.targetId===p.action.targetId&&n.discovery.experiments.find(e=>e.actionId===witness.eventId && e.actionId>=p.eventFloor && e.at>=p.at && e.primitive===p.action.type && e.targetId===p.action.targetId);
    const event=e&&n.memory.experience.find(x=>x.id===e.actionId && x.type==='action' && x.details?.action?.type===e.primitive && x.details.action.targetId===e.targetId && x.at===e.at && x.details.result?.ok===e.ok && x.details.result.materialId===e.materialId && Math.abs((x.details.result.durationSeconds||0)-p.paidSeconds)<1e-6);
    if(event && n.active!==p.active)p.selected=e;
    else if(n.active!==p.active){p.settled=true;return {status:'interrupted',reward:null,paidSeconds:p.paidSeconds,attributedEffects:0};}
  }
  if(p.selected?.ok && !p.ingestion) {
    // Only the first eligible own sample is attributed. Inspect/release/strike
    // cannot invent parent-to-descendant material lineage.
    const selected=p.selected;
    const material=p.action.type==='sample'?p.action.targetId:['grasp','pull','catch'].includes(p.action.type)?selected.materialId || (p.action.type==='grasp'?selected.targetId:null):null;
    if(material) {
      const samples=n.discovery.experiments.filter(e=>e.ok && e.primitive==='sample' && e.targetId===material && e.ingestionId && e.actionId>=selected.actionId && e.at>=selected.at && e.at<=p.deadline).sort((a,b)=>a.actionId-b.actionId);
      const sample=p.action.type==='sample'?samples.find(e=>e.actionId===selected.actionId):samples[0];
      if(sample)p.ingestion={actionId:sample.actionId,ingestionId:sample.ingestionId,objectId:material};
    }
  }
  if(p.ingestion)for(const effect of n.discovery.effects) {
    if(p.effects.has(effect.id) || effect.at>p.deadline || effect.at<p.at || effect.actionId!==p.ingestion.actionId || effect.ingestionId!==p.ingestion.ingestionId || effect.objectId!==p.ingestion.objectId || !canonicalCommunicationEffect(n,effect))continue;
    p.effects.add(effect.id);p.values.push(effect.effect==='discomfort'?-1:effect.effect==='sustained'?1:effect.effect==='water relief'?.5:0);
  }
  if(n.elapsed<p.deadline)return null;
  p.settled=true;
  const benefit=p.values.includes(-1)?-1:Math.max(0,...p.values),cost=Math.min(.1,.02*p.paidSeconds/5);
  return {status:p.effects.size?'attributed':'expired',reward:Math.max(-1,Math.min(1,benefit-cost)),benefit,cost,paidSeconds:p.paidSeconds,attributedEffects:p.effects.size,ingestion:p.ingestion?{...p.ingestion}:null};
}
