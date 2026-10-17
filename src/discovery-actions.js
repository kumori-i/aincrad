import { DISCOVERY_RULES } from './discovery-config.js';
import { objectId } from './discovery-state.js';
import { distance } from './world.js';
import { actorLineOfSight } from './perception.js';
import { lookupEcologyObject,describeEcologyObject,interactEcologyObject,consumeEcologyMaterial } from './ecology.js';
import { ingestMaterial,exertPhysiology,isSleeping } from './biology.js';
import { rememberDirectDiscoveryObject } from './discovery.js';

export function primitiveDuration(npc,type){
  const practice=npc.discovery?.practice?.[type]?.successes||0;
  return DISCOVERY_RULES.durations[type]*(DISCOVERY_RULES.minimumCostMultiplier+(1-DISCOVERY_RULES.minimumCostMultiplier)*Math.exp(-practice/DISCOVERY_RULES.practiceScale));
}
// Action identity belongs to this runtime only; saves interrupt active commands.
const ticking = new WeakSet(), settled = new WeakSet();
const done=(complete,npc,request,result,active)=>complete?complete(npc,request,result,undefined,active?.startPosition,active?.startScene):result;
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
  return {ok:true,code:'ACTION_STARTED'};
}
export function tickDiscoveryAction(npc,dt,environment={},options={}){
  const active=npc.active;if(active?.kind!=='interaction'||!Number.isFinite(dt)||dt<=0)return false;
  if(ticking.has(active))return false;
  if(settled.has(active)){if(npc.active===active)npc.active=null;return false;}
  ticking.add(active);let terminal=false;
  try{
    const worked=Math.min(dt,Math.max(0,active.seconds-active.worked));active.worked+=worked;
    try{(options.exert||exertPhysiology)(npc,worked,DISCOVERY_RULES.effort[active.request.type]);}
    catch(error){settled.add(active);terminal=true;throw error;}
    // A hook may cancel or replace work. It cannot authorize the captured action.
    if(npc.active!==active){settled.add(active);return true;}
    if(active.worked+1e-8<active.seconds)return true;
    // Retire before validation, effects or callbacks; even a throwing callback
    // cannot replay this physical completion. Keep its context until completion.
    settled.add(active);terminal=true;
    const request=active.request,check=allowed(npc,request.targetId,environment,request.type==='inspect_object');
    if(!check.ok){done(options.complete,npc,request,{...check,durationSeconds:active.worked},active);return true;}
    let result;
    if(request.type==='inspect_object'){
      const object=describeEcologyObject(environment.ecology,request.targetId,{actorId:npc.id});
      if(object)rememberDirectDiscoveryObject(npc,object);
      result=object?{ok:true,code:'OBJECT_OBSERVED'}:{ok:false,code:'OBJECT_GONE'};
    }else if(request.type==='sample'){
      // A synchronous authoritative transfer commits finite matter only after swallowing succeeds.
      const fraction=Math.min(1,DISCOVERY_RULES.sampleGrams/Math.max(.001,check.physical.massGrams||0));
      const material=consumeEcologyMaterial(environment.ecology,request.targetId,fraction,{actorId:npc.id,accept:portion=>ingestMaterial(npc,portion,{objectId:request.targetId,actionId:npc.memory?.nextId||0,provenance:'sampled',at:npc.elapsed})});
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
    done(options.complete,npc,request,{...result,durationSeconds:active.worked},active);return true;
  }finally{
    ticking.delete(active);
    if(terminal&&npc.active===active)npc.active=null;
  }
}
