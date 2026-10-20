import { recordAquaticCaptureFailure } from './aquatic-ecology.js';
import { CONFIG } from './config.js';
import { ozarkAgentWorld,ozarkFiniteAquaticAgent } from './ozark-agent-world.js';
import { DISCOVERY_RULES } from './discovery-config.js';
import { objectId } from './discovery-state.js';
import { distance } from './world.js';
import { actorLineOfSight } from './perception.js';
import { lookupEcologyObject,describeEcologyObject,interactEcologyObject,consumeEcologyMaterial,captureEcologyFish,preflightEcologyFishCapture } from './ecology.js';
import { ingestMaterial,exertPhysiology,isSleeping } from './biology.js';
import { rememberDirectDiscoveryObject,recentDiscoveryAim } from './discovery.js';

export function primitiveDuration(npc,type){
  const practice=npc.discovery?.practice?.[type]?.successes||0;
  return DISCOVERY_RULES.durations[type]*(DISCOVERY_RULES.minimumCostMultiplier+(1-DISCOVERY_RULES.minimumCostMultiplier)*Math.exp(-practice/DISCOVERY_RULES.practiceScale));
}
// Action identity belongs to this runtime only; saves interrupt active commands.
const ticking = new WeakSet(), settled = new WeakSet();
// Runtime-only witnesses. Restarted/copied active commands have no measured
// work witness, and neither old receipts nor primitive constants can supply one.
const handlingWitnesses = new WeakMap(), catchWitnesses = new WeakMap();
export function takeDiscoveryActionFeedback(npc,active){
  // Completion or interruption consumes the interception witness too. Merely
  // reattaching the original command object cannot revive cancelled work.
  const capture=catchWitnesses.get(active);
  if(capture?.actor===npc){catchWitnesses.delete(active);settled.add(active);}
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
function catchCheck(npc,request,environment,aim){
  if(!ozarkFiniteAquaticAgent(npc))return {ok:false,code:'INVALID_PRIMITIVE'};
  if(npc.lifecycle!=='AWAKE'||isSleeping(npc))return {ok:false,code:'UNCONSCIOUS'};
  const geometry=ozarkAgentWorld(npc);
  if(npc.scene!=='valley'||geometry?.classify(npc.position.x,npc.position.y,CONFIG.playerRadius).reason!=='dry-ground')return {ok:false,code:'SHORE_REQUIRED'};
  if(!aim)return {ok:false,code:'FRESH_OBSERVATION_REQUIRED'};
  return preflightEcologyFishCapture(environment.ecology,request.targetId,{
    actorId:npc.id,position:{...npc.position},scene:npc.scene,aim,inventory:npc.inventory.items});
}
/** Physical commands are anatomical operations, never edible-object shortcuts. */
export function requestDiscoveryAction(npc,raw,environment={},options={}){
  const request=raw&&DISCOVERY_RULES.allPrimitives.includes(raw.type)&&objectId(raw.targetId)?{type:raw.type,targetId:raw.targetId}:null;
  if(!request||request.type==='catch'&&!ozarkFiniteAquaticAgent(npc))return done(options.complete,npc,{type:'observe'},{ok:false,code:'INVALID_PRIMITIVE'});
  if(npc.lifecycle!=='AWAKE'||isSleeping(npc))return {ok:false,code:'UNCONSCIOUS'};
  if(npc.active)return {ok:false,code:'ACTION_BUSY'};
  const check=allowed(npc,request.targetId,environment,request.type==='inspect_object');if(!check.ok)return done(options.complete,npc,request,check);
  if(['sample','release'].includes(request.type)&&check.physical.heldBy!==npc.id)return done(options.complete,npc,request,{ok:false,code:'NOT_HELD'});
  if(['grasp','pull','catch'].includes(request.type)&&(npc.inventory.items?.length||0)>=DISCOVERY_RULES.capacity)return done(options.complete,npc,request,{ok:false,code:'HANDS_FULL'});
  const aim=request.type==='catch'?recentDiscoveryAim(npc,request.targetId):null;
  if(request.type==='catch'){const capture=catchCheck(npc,request,environment,aim);if(!capture.ok)return done(options.complete,npc,request,capture);}
  const seconds=primitiveDuration(npc,request.type);
  npc.active={kind:'interaction',request,startedAt:npc.elapsed,expiresAt:npc.elapsed+seconds+.05,seconds,worked:0,startPosition:{...npc.position},startScene:npc.scene,startRisk:npc.riskCost||0};
  if(request.type==='catch')catchWitnesses.set(npc.active,{actor:npc,discovery:npc.discovery,physiology:npc.physiology,
    targetId:request.targetId,scene:npc.scene,aim:{...aim},seconds,worked:0});
  if(Number.isFinite(npc.physiology?.fatigue)&&Number.isFinite(npc.physiology?.stamina))
    handlingWitnesses.set(npc.active,{actor:npc,physiology:npc.physiology,discovery:npc.discovery,
      type:request.type,targetId:request.targetId,seconds,
      fatigue:npc.physiology.fatigue,stamina:npc.physiology.stamina,worked:0});
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
    // A throwing or synchronously cancelling hook cannot certify its current
    // work slice. Prior returned slices remain available to interruption receipts.
    const witness=handlingWitnesses.get(active);
    if(witness&&npc.active===active)witness.worked+=worked;
    const captureWitness=catchWitnesses.get(active);
    if(captureWitness&&npc.active===active)captureWitness.worked+=worked;
    // A hook may cancel or replace work. It cannot authorize the captured action.
    if(npc.active!==active){settled.add(active);return true;}
    if(active.worked+1e-8<active.seconds)return true;
    // Retire before validation, effects or callbacks; even a throwing callback
    // cannot replay this physical completion. Keep its context until completion.
    settled.add(active);terminal=true;
    const request=active.request;
    if(captureWitness&&request.type!=='catch'){
      recordAquaticCaptureFailure(environment.ecology,{miss:false});
      done(options.complete,npc,{type:'catch',targetId:captureWitness.targetId},{ok:false,code:'CATCH_INTERRUPTED',durationSeconds:active.worked},active);return true;
    }
    const check=allowed(npc,request.targetId,environment,request.type==='inspect_object');
    if(!check.ok){if(request.type==='catch')recordAquaticCaptureFailure(environment.ecology,{miss:false});done(options.complete,npc,request,{...check,durationSeconds:active.worked},active);return true;}
    let result;
    if(request.type==='catch'){
      const witness=catchWitnesses.get(active);
      if(!witness||witness.actor!==npc||witness.discovery!==npc.discovery||witness.physiology!==npc.physiology||
        witness.targetId!==request.targetId||witness.scene!==npc.scene||witness.seconds!==active.seconds||
        Math.abs(witness.worked-witness.seconds)>1e-8){
        result={ok:false,code:'CATCH_INTERRUPTED'};
      }else{
        const capture=catchCheck(npc,request,environment,witness.aim);
        const response=capture.ok?captureEcologyFish(environment.ecology,request.targetId,{
          actorId:npc.id,position:{...npc.position},scene:npc.scene,aim:{...witness.aim},inventory:npc.inventory.items}):capture;
        result={ok:response?.ok===true,code:response?.code||'CATCH_MISSED',...(objectId(response?.materialId)?{materialId:response.materialId}:{})};
        if(result.ok){const object=describeEcologyObject(environment.ecology,request.targetId,{actorId:npc.id});if(object)rememberDirectDiscoveryObject(npc,object);}
      }
    }else if(request.type==='inspect_object'){
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
      const response=interactEcologyObject(environment.ecology,request.targetId,request.type,{actorId:npc.id,position:{...npc.position},scene:npc.scene,power:1,amount:.02,inventory:npc.inventory.items});
      const materialId=response?.materialId||response?.material?.id;
      result={ok:response?.ok===true,code:response?.code||'NO_CHANGE',...(objectId(materialId)?{materialId}:{})};
      if(result.ok&&['grasp','pull'].includes(request.type)){
        const id=materialId||request.targetId;if(!npc.inventory.items.includes(id))npc.inventory.items.push(id);
        const object=describeEcologyObject(environment.ecology,id,{actorId:npc.id});if(object)rememberDirectDiscoveryObject(npc,object);
      }
      if(result.ok&&request.type==='pull'&&ozarkFiniteAquaticAgent(npc)){const source=describeEcologyObject(environment.ecology,request.targetId,{actorId:npc.id});if(source)rememberDirectDiscoveryObject(npc,source);}
      if(result.ok&&request.type==='release')npc.inventory.items=npc.inventory.items.filter(id=>id!==request.targetId);
    }
    // Swallowing a final portion may exhaust the globally persisted held material.
    npc.inventory.items=npc.inventory.items.filter(id=>lookupEcologyObject(environment.ecology,id)?.heldBy===npc.id);
    if(request.type==='catch'&&!result.ok)recordAquaticCaptureFailure(environment.ecology,{miss:result.code==='fish_missed'});
    done(options.complete,npc,request,{...result,durationSeconds:active.worked},active);return true;
  }finally{
    ticking.delete(active);
    if(terminal||npc.active!==active){handlingWitnesses.delete(active);catchWitnesses.delete(active);}
    if(terminal&&npc.active===active)npc.active=null;
  }
}
