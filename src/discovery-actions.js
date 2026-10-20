import { DISCOVERY_RULES } from './discovery-config.js';
import { objectId } from './discovery-state.js';
import { distance } from './world.js';
import { actorLineOfSight } from './perception.js';
import { lookupEcologyObject,describeEcologyObject,interactEcologyObject,consumeEcologyMaterial } from './ecology.js';
import { ingestMaterial,exertPhysiology,isSleeping } from './biology.js';
import { rememberDirectDiscoveryObject } from './discovery.js';
import { certifyNativeOwnHand, retireNativeOwnHand } from './own-hand-memory.js';

export function primitiveDuration(npc,type){
  const practice=npc.discovery?.practice?.[type]?.successes||0;
  return DISCOVERY_RULES.durations[type]*(DISCOVERY_RULES.minimumCostMultiplier+(1-DISCOVERY_RULES.minimumCostMultiplier)*Math.exp(-practice/DISCOVERY_RULES.practiceScale));
}
// Action identity belongs to this runtime only; saves interrupt active commands.
const ticking = new WeakSet(), settled = new WeakSet();
// Runtime-only witnesses. Restarted/copied active commands have no measured
// work witness, and neither old receipts nor primitive constants can supply one.
const handlingWitnesses = new WeakMap();
// A separate sensor witness adds no work or nutrition knowledge to handling.
const ownHandWitnesses = new WeakMap();
function ownHandWitness(npc,active){
  const witness=ownHandWitnesses.get(active),handling=handlingWitnesses.get(active);
  if(!witness||witness.actor!==npc||witness.actorId!==npc.id||npc.active!==active||
    npc.epoch!==witness.epoch||npc.discovery!==witness.discovery||npc.physiology!==witness.physiology||
    active.request!==witness.request||active.request.type!=='sample'||active.request.targetId!==witness.targetId||
    active.seconds!==witness.seconds||!handling||handling.worked!==active.worked){ownHandWitnesses.delete(active);return null;}
  return witness;
}
export function takeDiscoveryActionFeedback(npc,active){
  const witness=handlingWitnesses.get(active);
  if(!witness||witness.actor!==npc)return null;
  handlingWitnesses.delete(active);
  const f=npc.physiology;
  if(npc.active!==active||f!==witness.physiology||npc.discovery!==witness.discovery||
    active.request?.type!==witness.type||active.request?.targetId!==witness.targetId||
    !(witness.worked>0)||witness.worked>witness.seconds+1e-8||
    !Number.isFinite(f?.fatigue)||!Number.isFinite(f?.stamina))return null;
  // Same net bodily trend as movement.effort, not a calorie estimate. Steady
  // includes saturation/recovery and never means that the action was free.
  return {source:'experienced',activeActionSeconds:witness.worked,
    effort:f.fatigue>witness.fatigue+1e-9||f.stamina<witness.stamina-1e-9?'rising':'steady'};
}
const done=(complete,npc,request,result,active)=>{
  const handling=takeDiscoveryActionFeedback(npc,active);
  if(handling)result={...result,handling};
  return complete?complete(npc,request,result,undefined,active?.startPosition,active?.startScene):result;
};
function allowed(npc,id,environment,inspection=false){
  if(!objectId(id)||!npc.discovery?.observations?.[id]&&!npc.inventory?.items?.includes(id))return {ok:false,code:'UNKNOWN_OBJECT'};
  const physical=lookupEcologyObject(environment.ecology,id);if(!physical)return {ok:false,code:'OBJECT_GONE'};
  if(physical.heldBy===npc.id)return {ok:true,physical};
  if(physical.heldBy)return {ok:false,code:'HELD_BY_ANOTHER'};
  if(physical.scene!==npc.scene)return {ok:false,code:'OTHER_SCENE'};
  const position=physical.position||physical;
  if(distance(npc.position,position)>(inspection?400:DISCOVERY_RULES.reach))return {ok:false,code:inspection?'OUT_OF_VIEW':'OUT_OF_REACH'};
  if(!actorLineOfSight(npc,npc.position,position))return {ok:false,code:'INTERACTION_BLOCKED'};
  return {ok:true,physical};
}
/** Physical commands are anatomical operations, never edible-object shortcuts. */
export function requestDiscoveryAction(npc,raw,environment={},options={}){
  const request=raw&&DISCOVERY_RULES.primitives.includes(raw.type)&&objectId(raw.targetId)?{type:raw.type,targetId:raw.targetId}:null;
  if(!request)return done(options.complete,npc,{type:'observe'},{ok:false,code:'INVALID_PRIMITIVE'});
  if(npc.lifecycle!=='AWAKE'||isSleeping(npc))return {ok:false,code:'UNCONSCIOUS'};
  if(npc.active)return {ok:false,code:'ACTION_BUSY'};
  const check=allowed(npc,request.targetId,environment,request.type==='inspect_object');if(!check.ok)return done(options.complete,npc,request,check);
  if(['sample','release'].includes(request.type)&&check.physical.heldBy!==npc.id)return done(options.complete,npc,request,{ok:false,code:'NOT_HELD'});
  if(['grasp','pull'].includes(request.type)&&(npc.inventory.items?.length||0)>=DISCOVERY_RULES.capacity)return done(options.complete,npc,request,{ok:false,code:'HANDS_FULL'});
  const seconds=primitiveDuration(npc,request.type);
  npc.active={kind:'interaction',request,startedAt:npc.elapsed,expiresAt:npc.elapsed+seconds+.05,seconds,worked:0,startPosition:{...npc.position},startScene:npc.scene,startRisk:npc.riskCost||0};
  if(Number.isFinite(npc.physiology?.fatigue)&&Number.isFinite(npc.physiology?.stamina))
    handlingWitnesses.set(npc.active,{actor:npc,physiology:npc.physiology,discovery:npc.discovery,
      type:request.type,targetId:request.targetId,seconds,
      fatigue:npc.physiology.fatigue,stamina:npc.physiology.stamina,worked:0});
  if(request.type==='sample'&&handlingWitnesses.has(npc.active))ownHandWitnesses.set(npc.active,
    {actor:npc,actorId:npc.id,request:npc.active.request,targetId:request.targetId,epoch:npc.epoch,
      discovery:npc.discovery,physiology:npc.physiology,seconds});
  return {ok:true,code:'ACTION_STARTED'};
}
export function tickDiscoveryAction(npc,dt,environment={},options={}){
  const active=npc.active;if(active?.kind!=='interaction'||!Number.isFinite(dt)||dt<=0)return false;
  if(ticking.has(active))return false;
  if(settled.has(active)){if(npc.active===active)npc.active=null;return false;}
  ticking.add(active);let terminal=false,handObservation=null;
  try{
    const worked=Math.min(dt,Math.max(0,active.seconds-active.worked));active.worked+=worked;
    try{(options.exert||exertPhysiology)(npc,worked,DISCOVERY_RULES.effort[active.request.type]);}
    catch(error){settled.add(active);terminal=true;throw error;}
    // A throwing or synchronously cancelling hook cannot certify its current
    // work slice. Prior returned slices remain available to interruption receipts.
    const witness=handlingWitnesses.get(active);
    if(witness&&npc.active===active)witness.worked+=worked;
    if(ownHandWitnesses.has(active))ownHandWitness(npc,active);
    // A hook may cancel or replace work. It cannot authorize the captured action.
    if(npc.active!==active){settled.add(active);return true;}
    if(active.worked+1e-8<active.seconds)return true;
    // Retire before validation, effects or callbacks; even a throwing callback
    // cannot replay this physical completion. Keep its context until completion.
    settled.add(active);terminal=true;
    const request=active.request,check=allowed(npc,request.targetId,environment,request.type==='inspect_object');
    if(!check.ok){done(options.complete,npc,request,{...check,durationSeconds:active.worked},active);return true;}
    let result,handBefore=false,sampleActionId;
    if(request.type==='inspect_object'){
      const object=describeEcologyObject(environment.ecology,request.targetId,{actorId:npc.id});
      if(object)rememberDirectDiscoveryObject(npc,object);
      result=object?{ok:true,code:'OBJECT_OBSERVED'}:{ok:false,code:'OBJECT_GONE'};
    }else if(request.type==='sample'){
      const hand=ownHandWitness(npc,active);
      handBefore=Boolean(hand&&active.worked>0&&active.worked+1e-8>=hand.seconds&&
        npc.inventory.items.includes(request.targetId)&&check.physical.heldBy===npc.id);
      // A synchronous authoritative transfer commits finite matter only after swallowing succeeds.
      const fraction=Math.min(1,DISCOVERY_RULES.sampleGrams/Math.max(.001,check.physical.massGrams||0));
      sampleActionId=npc.memory?.nextId||0;
      const material=consumeEcologyMaterial(environment.ecology,request.targetId,fraction,{actorId:npc.id,accept:portion=>ingestMaterial(npc,portion,{objectId:request.targetId,actionId:sampleActionId,provenance:'sampled',at:npc.elapsed})});
      if(!material?.ok)result={ok:false,code:material?.code||'CANNOT_SAMPLE'};
      else {
        const ingestion=material.ingestion;
        result={ok:ingestion.ok===true,code:ingestion.code||'SWALLOWED',delayed:ingestion.delayed===true,...(ingestion.ingestionId?{ingestionId:ingestion.ingestionId}:{})};
        if(result.ok){npc.discovery.samplesPending[request.targetId]=npc.elapsed;npc.presentation.eatUntil=npc.elapsed+2;}
      }
    }else {
      const response=interactEcologyObject(environment.ecology,request.targetId,request.type,{actorId:npc.id,position:{...npc.position},scene:npc.scene,power:1,amount:.02});
      const materialId=response?.materialId||response?.material?.id;
      result={ok:response?.ok===true,code:response?.code||'NO_CHANGE',...(objectId(materialId)?{materialId}:{})};
      if(result.ok&&['grasp','pull'].includes(request.type)){
        const id=materialId||request.targetId;if(!npc.inventory.items.includes(id))npc.inventory.items.push(id);
        const object=describeEcologyObject(environment.ecology,id,{actorId:npc.id});if(object)rememberDirectDiscoveryObject(npc,object);
      }
      if(result.ok&&request.type==='release')npc.inventory.items=npc.inventory.items.filter(id=>id!==request.targetId);
    }
    // Swallowing a final portion may exhaust the globally persisted held material.
    npc.inventory.items=npc.inventory.items.filter(id=>lookupEcologyObject(environment.ecology,id)?.heldBy===npc.id);
    if(handBefore&&ownHandWitness(npc,active)&&result.ok&&result.code==='SWALLOWED'&&/^ingestion:\d+$/.test(result.ingestionId)){
      result.ownHand={source:'experienced',actorId:npc.id,targetId:request.targetId,before:'held',
        after:npc.inventory.items.includes(request.targetId)?'held':'not-held'};
      handObservation=result.ownHand;
      certifyNativeOwnHand(npc,handObservation,{ingestionId:result.ingestionId,actionId:sampleActionId,experimentId:npc.discovery.nextId});
    }
    done(options.complete,npc,request,{...result,durationSeconds:active.worked},active);return true;
  }finally{
    retireNativeOwnHand(handObservation);
    ticking.delete(active);
    if(terminal||npc.active!==active)handlingWitnesses.delete(active);
    if(terminal||npc.active!==active)ownHandWitnesses.delete(active);
    if(terminal&&npc.active===active)npc.active=null;
  }
}
