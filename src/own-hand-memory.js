import { NPC_RULES } from './config.js';
import { DISCOVERY_RULES } from './discovery-config.js';
import { objectId } from './discovery-state.js';

// Descriptive receipt data may survive saving. Eligibility never does: only an
// original native completion token can populate this actor-instance WeakMap.
const nativeObservations=new WeakMap(), runtime=new WeakMap();
export const OWN_HAND_LIMITS=Object.freeze({gates:DISCOVERY_RULES.maxObjects,
  experiments:DISCOVERY_RULES.maxExperiments,experience:NPC_RULES.maxExperience});
const positive=value=>Number.isInteger(value)&&value>0;
const ingestion=value=>typeof value==='string'&&/^ingestion:\d+$/.test(value);
const time=(value,npc)=>Number.isFinite(value)&&value>=0&&value<=npc.elapsed;
export function ownHandAfter(value,npc,targetId){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='actorId,after,before,source,targetId'||
    value.source!=='experienced'||value.actorId!==npc.id||value.targetId!==targetId||
    value.before!=='held'||!['held','not-held'].includes(value.after))return null;
  return value.after;
}
// Called only by the native sample seam, after its separate continuity witness.
// Copying/serializing the descriptive object cannot copy this one-use token.
export function certifyNativeOwnHand(npc,value,identity){
  nativeObservations.set(value,{actor:npc,discovery:npc.discovery,physiology:npc.physiology,
    memory:npc.memory,epoch:npc.epoch,at:npc.elapsed,actorId:npc.id,targetId:value.targetId,after:value.after,...identity});
}
export function retireNativeOwnHand(value){if(value)nativeObservations.delete(value);}
function stateFor(npc){
  const state=runtime.get(npc);
  if(state&&(state.discovery!==npc.discovery||state.physiology!==npc.physiology||
    state.memory!==npc.memory||state.actorId!==npc.id)){runtime.delete(npc);return null;}
  return state;
}
function unique(rows,key){
  const out=new Map();
  for(const row of rows){if(!positive(row?.[key])||out.has(row[key]))return null;out.set(row[key],row);}
  return out;
}
function evidenceIndex(npc,staged=false){
  const experiments=npc.discovery?.experiments,experience=npc.memory?.experience;
  if(!Array.isArray(experiments)||!Array.isArray(experience)||
    experiments.length>OWN_HAND_LIMITS.experiments+(staged?1:0)||
    experience.length>OWN_HAND_LIMITS.experience+(staged?2:0))return null;
  const byId=unique(experiments,'id'),byAction=unique(experiments,'actionId'),events=unique(experience,'id');
  if(!byId||!byAction||!events)return null;
  const ingestions=new Map(),valid=new Map();
  for(const e of experiments){
    if(e.primitive==='sample'&&e.ok&&ingestion(e.ingestionId))
      ingestions.set(e.ingestionId,ingestions.has(e.ingestionId)?null:e);
    const event=events.get(e.actionId),action=event?.details?.action,result=event?.details?.result;
    if(time(e.at,npc)&&e.at===event?.at&&event.type==='action'&&objectId(e.targetId)&&
      DISCOVERY_RULES.primitives.includes(e.primitive)&&action?.type===e.primitive&&action.targetId===e.targetId&&
      e.ok===true&&result?.ok===true&&result.code===e.code&&e.durationSeconds>0&&
      Number.isFinite(e.durationSeconds)&&result.durationSeconds===e.durationSeconds&&
      result.materialId===e.materialId&&result.ingestionId===e.ingestionId&&
      (e.primitive!=='grasp'||e.materialId===undefined||e.materialId===e.targetId))valid.set(e.id,e);
  }
  return {byId,byAction,events,valid,ingestions,scannedExperiments:experiments.length,scannedExperience:experience.length};
}
function samplePair(index,e){return index.valid.get(e.id)===e&&e.primitive==='sample'&&
  e.code==='SWALLOWED'&&ingestion(e.ingestionId)&&index.ingestions.get(e.ingestionId)===e;}
function originRetained(npc,index,gate){
  const e=gate.experiment,event=gate.event;
  return index.byId.get(e.id)===e&&index.events.get(event.id)===event&&
    e.id===gate.experimentId&&e.actionId===gate.actionId&&e.at===gate.at&&e.ingestionId===gate.ingestionId&&e.targetId===gate.targetId&&
    samplePair(index,e)&&event.details.result.ownHand===gate.hand&&
    ownHandAfter(gate.hand,npc,gate.targetId)==='not-held';
}
/** Original action/experiment linking seam. No history scan may create a gate. */
export function recordOwnHandResolution(npc,action,result,event,experiment){
  const token=result.ownHand&&nativeObservations.get(result.ownHand);
  if(token)nativeObservations.delete(result.ownHand);
  let state=stateFor(npc);
  if(!token&&!state?.gates.size)return;
  const index=evidenceIndex(npc,true);
  if(!index){runtime.delete(npc);return;}
  if(index.events.get(event.id)!==event||index.valid.get(experiment.id)!==experiment||
    experiment.actionId!==event.id||experiment.targetId!==action.targetId)return;
  const sample=samplePair(index,experiment),resolver=sample||
    action.type==='grasp'&&result.code==='object_held'||
    action.type==='inspect_object'&&result.code==='OBJECT_OBSERVED'||
    action.type==='release'&&result.code==='object_released';
  const prior=state?.gates.get(action.targetId);
  if(prior&&resolver&&experiment.id>prior.experimentId&&event.id>prior.actionId&&event.at>=prior.at)
    state.gates.delete(action.targetId);
  const witnessed=sample&&token?.actor===npc&&token.discovery===npc.discovery&&token.physiology===npc.physiology&&
    token.memory===npc.memory&&token.actorId===npc.id&&token.epoch===npc.epoch&&token.at===event.at&&
    token.ingestionId===experiment.ingestionId&&token.actionId===event.id&&token.experimentId===experiment.id&&
    token.targetId===action.targetId&&token.after==='not-held'&&
    ownHandAfter(result.ownHand,npc,action.targetId)==='not-held'&&
    ownHandAfter(event.details.result.ownHand,npc,action.targetId)==='not-held';
  if(!witnessed)return;
  if(!state){state={actorId:npc.id,discovery:npc.discovery,physiology:npc.physiology,memory:npc.memory,gates:new Map()};runtime.set(npc,state);}
  state.gates.delete(action.targetId);
  state.gates.set(action.targetId,{targetId:action.targetId,event,experiment,hand:event.details.result.ownHand,
    actionId:event.id,experimentId:experiment.id,ingestionId:experiment.ingestionId,at:event.at});
  if(state.gates.size>OWN_HAND_LIMITS.gates)state.gates.delete(state.gates.keys().next().value);
}
/** Called only from the existing genuine direct-perception seam. */
export function resolveOwnHandSight(npc,object){
  const state=stateFor(npc),gate=state?.gates.get(object.id);
  if(gate&&object.scene===npc.scene&&time(object.observedAt,npc)&&object.observedAt>gate.at)
    state.gates.delete(object.id);
}
/** Bounded decision-local validation. Missing origins are forgotten, not rebuilt. */
export function ownHandReplayView(npc){
  const suspended=new Set(),diagnostics={scannedExperiments:0,scannedExperience:0,checkedGates:0};
  const state=stateFor(npc);if(!state?.gates.size)return {suspended,diagnostics};
  const index=evidenceIndex(npc);
  if(!index){runtime.delete(npc);return {suspended,diagnostics};}
  Object.assign(diagnostics,{scannedExperiments:index.scannedExperiments,scannedExperience:index.scannedExperience});
  for(const [id,gate] of state.gates){diagnostics.checkedGates++;
    if(originRetained(npc,index,gate))suspended.add(id);else state.gates.delete(id);
  }
  return {suspended,diagnostics};
}
