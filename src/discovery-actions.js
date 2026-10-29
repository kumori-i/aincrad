import { fundNpcEffort, npcWorkAllowance, captureNpcRunDeadline, expireNpcRun } from './npc-effort-funding.js';
import { registerMaterialCompletion } from './discovery-completion.js';
import { publishConsumption } from './consumption-events.js';
import { recordAquaticCaptureFailure } from './aquatic-ecology.js';
import { CONFIG } from './config.js';
import { ozarkAgentWorld,ozarkFiniteAquaticAgent } from './ozark-agent-world.js';
import { DISCOVERY_RULES } from './discovery-config.js';
import { objectId } from './discovery-state.js';
import { distance } from './world.js';
import { actorLineOfSight } from './perception.js';
import { lookupEcologyObject,describeEcologyObject,interactEcologyObject,consumeEcologyMaterial,captureEcologyFish,preflightEcologyFishCapture,transferEcologyMaterial } from './ecology.js';
import { ingestMaterial,exertPhysiology,isSleeping } from './biology.js';
import { rememberDirectDiscoveryObject,recentDiscoveryAim } from './discovery.js';

export function primitiveDuration(npc,type){
  const practice=npc.discovery?.practice?.[type]?.successes||0;
  return DISCOVERY_RULES.durations[type]*(DISCOVERY_RULES.minimumCostMultiplier+(1-DISCOVERY_RULES.minimumCostMultiplier)*Math.exp(-practice/DISCOVERY_RULES.practiceScale));
}
// Action identity belongs to this runtime only; saves interrupt active commands.
const ticking = new WeakSet(), settled = new WeakSet();
const actionActors = new WeakMap();
const paidWork = new WeakMap();
const completedWork = new WeakMap(), successfulActions = new WeakMap();
const completedInspections = new WeakMap(), issuedInspections = new WeakSet();
const indicationPermits = new WeakMap(), indications = new WeakMap();
const INDICATION_SECONDS=1.8, INDICATION_EFFORT=.25, INDICATION_LENGTH=24;
/** Pure geometric construction for private actuator preflight; no visibility
 * or target-identity authority is implied by constructing a segment. */
export function referenceGeometry(origin,targetPosition,scene,progress=0){
  if(!origin||!targetPosition||![origin.x,origin.y,targetPosition.x,targetPosition.y].every(Number.isFinite))return null;
  const length=distance(origin,targetPosition);if(!(length>0))return null;
  return Object.freeze({scene,origin:Object.freeze({x:origin.x,y:origin.y}),tip:Object.freeze({
    x:origin.x+INDICATION_LENGTH*(targetPosition.x-origin.x)/length,
    y:origin.y+INDICATION_LENGTH*(targetPosition.y-origin.y)/length}),progress});
}
/** Runtime-only post-choice authority. Neither saved receipts nor copied actions
 * can issue a permit, and one completed inspection can issue at most one. */
export function createIndicationPermit(sender,receiver,active,targetId){
  const proof=active&&completedInspections.get(active);
  if(!sender||!receiver||!proof||issuedInspections.has(active)||sender===receiver||!objectId(targetId)||
    proof.actor!==receiver||proof.epoch!==receiver.epoch||proof.discovery!==receiver.discovery||
    proof.physiology!==receiver.physiology||receiver.elapsed<proof.at||receiver.elapsed-proof.at>12)return null;
  issuedInspections.add(active);
  const permit=Object.freeze({});
  indicationPermits.set(permit,{sender,receiver,targetId,senderEpoch:sender.epoch,receiverEpoch:receiver.epoch,
    senderDiscovery:sender.discovery,senderPhysiology:sender.physiology,receiverDiscovery:receiver.discovery,
    receiverPhysiology:receiver.physiology,at:sender.elapsed});
  return permit;
}
function indicationValid(npc,active,w,environment){
  if(!w||w.actor!==npc||npc.epoch!==w.epoch||npc.discovery!==w.discovery||npc.physiology!==w.physiology||
    npc.lifecycle!=='AWAKE'||isSleeping(npc)||w.receiver.epoch!==w.receiverEpoch||w.receiver.discovery!==w.receiverDiscovery||w.receiver.physiology!==w.receiverPhysiology||npc.scene!==w.scene||distance(npc.position,w.origin)>1e-8||
    active.request.type!=='indicate_object'||active.request.targetId!==w.targetId||active.seconds!==INDICATION_SECONDS)return false;
  const target=lookupEcologyObject(environment.ecology,w.targetId);
  return !!target&&!target.heldBy&&target.scene===w.scene&&distance(target.position,w.targetPosition)<1e-8&&
    distance(npc.position,target.position)<=400&&actorLineOfSight(npc,npc.position,target.position);
}
/** A fixed-length physical pose, not a target identity or endpoint. Both the
 * renderer and the listener's sensory adapter consume this exact projection. */
export function publicIndicationGeometry(npc){
  const active=npc?.active,w=active&&indications.get(active),work=active&&paidWork.get(active);
  if(!w||!work||actionActors.get(active)!==npc||settled.has(active)||!(work.worked>0)||!indicationValid(npc,active,w,w.environment))return null;
  return Object.freeze({scene:w.scene,origin:Object.freeze({x:w.origin.x,y:w.origin.y}),tip:Object.freeze({x:w.tip.x,y:w.tip.y}),progress:Math.min(1,work.worked/INDICATION_SECONDS)});
}
export function requestDiscoveryIndication(npc,permit,environment,options={}){
  const p=permit&&indicationPermits.get(permit);
  if(!p||p.sender!==npc)return {ok:false,code:'INVALID_INDICATION_PERMIT'};
  indicationPermits.delete(permit);
  if(npc.epoch!==p.senderEpoch||npc.discovery!==p.senderDiscovery||npc.physiology!==p.senderPhysiology||
    p.receiver.epoch!==p.receiverEpoch||p.receiver.discovery!==p.receiverDiscovery||p.receiver.physiology!==p.receiverPhysiology||
    npc.elapsed<p.at||npc.elapsed-p.at>12)return {ok:false,code:'INDICATION_INTERRUPTED'};
  const target=lookupEcologyObject(environment.ecology,p.targetId),length=target&&distance(npc.position,target.position);
  if(!target||target.heldBy||!length)return {ok:false,code:'INDICATION_TARGET_UNAVAILABLE'};
  const {origin,tip}=referenceGeometry(npc.position,target.position,npc.scene);
  const indication={actor:npc,epoch:npc.epoch,discovery:npc.discovery,physiology:npc.physiology,
    environment,receiver:p.receiver,receiverEpoch:p.receiverEpoch,receiverDiscovery:p.receiverDiscovery,receiverPhysiology:p.receiverPhysiology,targetId:p.targetId,targetPosition:{...target.position},scene:npc.scene,origin,tip,onPaid:options.onPaid};
  return requestDiscoveryAction(npc,{type:'indicate_object',targetId:p.targetId},environment,{...options,indication,indicationAuthority:indicationAuthority});
}
const indicationAuthority=Symbol('runtime indication');
// Read-only private witness; weak keys retain no completed actors or actions.
export function discoveryActionCompletion(npc,active){
  return active&&actionActors.get(active)===npc?completedWork.get(active)||null:null;
}
export function successfulDiscoveryActionCompletion(npc,active){
  const owner=active&&successfulActions.get(active);
  return owner&&owner.epoch===npc?.epoch&&owner.discovery===npc.discovery&&owner.physiology===npc.physiology?discoveryActionCompletion(npc,active):null;
}
const sharedGrasps = new WeakMap();
// The action's public counters and elapsed clock are not proof of paid work.
// Cancellation can consume this witness while a new hook slice is unreturned.
export function discoveryActionPaidSeconds(npc,active){
  return active&&actionActors.get(active)===npc?paidWork.get(active)?.worked||completedWork.get(active)?.worked||0:0;
}
export function retireDiscoveryAction(npc,active){
  if(active&&actionActors.get(active)===npc)settled.add(active);
}
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
  const work=active&&actionActors.get(active)===npc?paidWork.get(active):null;
  const identityIntact=work&&work.epoch===npc.epoch&&work.discovery===npc.discovery&&work.physiology===npc.physiology,completedAt=npc.elapsed;
  const completion=complete?complete(npc,request,result,undefined,active?.startPosition,active?.startScene):result;
  const sameOwner=identityIntact&&work.epoch===npc.epoch&&work.discovery===npc.discovery&&work.physiology===npc.physiology&&npc.elapsed===completedAt;
  if(sameOwner&&Number.isInteger(completion?.eventId)&&work.request.type==='inspect_object'&&result.ok===true&&work.worked+1e-8>=work.seconds)
    completedInspections.set(active,{actor:npc,epoch:npc.epoch,discovery:npc.discovery,physiology:npc.physiology,at:npc.elapsed});
  if(work&&Number.isInteger(completion?.eventId)){
    completedWork.set(active,Object.freeze({eventId:completion.eventId,worked:work.worked,type:work.request.type,targetId:work.request.targetId}));
    if(sameOwner&&result.ok===true&&work.worked+1e-8>=work.seconds)successfulActions.set(active,{epoch:work.epoch,discovery:work.discovery,physiology:work.physiology});
  }
  return completion;
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
/** Only the coordinator can supply the runtime closure; action text/save data
 * cannot carry consent. The receiver pays the ordinary grasp duration/effort. */
export function requestSharedDiscoveryGrasp(npc,donor,targetId,environment,consent,options={}){
  const sharing={donor,targetId,consent,actor:npc,environment,discovery:npc.discovery,physiology:npc.physiology};
  return requestDiscoveryAction(npc,{type:'grasp',targetId},environment,{...options,sharing});
}
function sharedCheck(npc,request,environment,sharing){
  if(!sharing||sharing.actor!==npc||sharing.environment!==environment||sharing.discovery!==npc.discovery||sharing.physiology!==npc.physiology||sharing.request&&sharing.request!==request||request.type!=='grasp'||request.targetId!==sharing.targetId||
      typeof sharing.consent!=='function'||!sharing.consent())return {ok:false,code:'SHARING_INTERRUPTED'};
  const physical=lookupEcologyObject(environment.ecology,request.targetId);
  if(!physical||physical.heldBy!==sharing.donor.id||!sharing.donor.inventory.items.includes(request.targetId))
    return {ok:false,code:'TRANSFER_OWNERSHIP_CHANGED'};
  return {ok:true,physical};
}
/** Physical commands are anatomical operations, never edible-object shortcuts. */
export function requestDiscoveryAction(npc,raw,environment={},options={}){
  const indication=options.indicationAuthority===indicationAuthority?options.indication:null;
  const request=raw&&(DISCOVERY_RULES.allPrimitives.includes(raw.type)||indication&&raw.type==='indicate_object')&&objectId(raw.targetId)?{type:raw.type,targetId:raw.targetId}:null;
  if(!request||request.type==='catch'&&!ozarkFiniteAquaticAgent(npc))return done(options.complete,npc,{type:'observe'},{ok:false,code:'INVALID_PRIMITIVE'});
  if(npc.lifecycle!=='AWAKE'||isSleeping(npc))return {ok:false,code:'UNCONSCIOUS'};
  if(npc.active)return {ok:false,code:'ACTION_BUSY'};
  const check=options.sharing?sharedCheck(npc,request,environment,options.sharing):allowed(npc,request.targetId,environment,request.type==='inspect_object'||!!indication);if(!check.ok)return done(options.complete,npc,request,check);
  if(['sample','release'].includes(request.type)&&check.physical.heldBy!==npc.id)return done(options.complete,npc,request,{ok:false,code:'NOT_HELD'});
  if(['grasp','pull','catch'].includes(request.type)&&(npc.inventory.items?.length||0)>=DISCOVERY_RULES.capacity)return done(options.complete,npc,request,{ok:false,code:'HANDS_FULL'});
  const aim=request.type==='catch'?recentDiscoveryAim(npc,request.targetId):null;
  if(request.type==='catch'){const capture=catchCheck(npc,request,environment,aim);if(!capture.ok)return done(options.complete,npc,request,capture);}
  const seconds=indication?INDICATION_SECONDS:primitiveDuration(npc,request.type),effort=indication?INDICATION_EFFORT:DISCOVERY_RULES.effort[request.type];
  npc.active={kind:'interaction',request,startedAt:npc.elapsed,expiresAt:npc.elapsed+npcWorkAllowance(seconds,effort),seconds,worked:0,startPosition:{...npc.position},startScene:npc.scene,startRisk:npc.riskCost||0};
  actionActors.set(npc.active,npc);
  npc.active.expiresAt=Math.min(npc.active.expiresAt,captureNpcRunDeadline(npc,request,npc.active));
  paidWork.set(npc.active,{epoch:npc.epoch,discovery:npc.discovery,physiology:npc.physiology,seconds,effort,worked:0,elapsed:0,startedAt:npc.elapsed,deadline:npc.active.expiresAt,request:{...request}});
  if(indication)indications.set(npc.active,indication);
  if(options.sharing){options.sharing.request=request;options.sharing.seconds=seconds;sharedGrasps.set(npc.active,options.sharing);}
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
  if(actionActors.get(active)!==npc){if(npc.active===active)npc.active=null;return false;}
  if(ticking.has(active))return false;
  if(settled.has(active)){if(npc.active===active)npc.active=null;return false;}
  ticking.add(active);let terminal=false;
  try{
    const work=paidWork.get(active);
    if(!work)return false;
    const indication=indications.get(active);
    if(indication&&!indicationValid(npc,active,indication,environment)){
      settled.add(active);terminal=true;
      done(options.complete,npc,work.request,{ok:false,code:'INDICATION_INTERRUPTED',durationSeconds:work.worked},active);return true;
    }
    const sharingNow=sharedGrasps.get(active);
    if(sharingNow&&!sharedCheck(npc,active.request,environment,sharingNow).ok){
      settled.add(active);terminal=true;
      done(options.complete,npc,active.request,{ok:false,code:'SHARING_INTERRUPTED',durationSeconds:work.worked},active);return true;
    }
    const elapsedBefore=Math.max(work.elapsed,Math.max(0,npc.elapsed-work.startedAt-dt));
    work.elapsed=Math.max(work.elapsed+dt,npc.elapsed-work.startedAt);
    const remaining=Math.max(0,work.deadline-work.startedAt-elapsedBefore);
    const requested=Math.min(dt,remaining,Math.max(0,work.seconds-work.worked));
    let worked;
    try{worked=fundNpcEffort(npc,requested,work.effort,options.exert||exertPhysiology).paidSeconds;}
    catch(error){settled.add(active);terminal=true;throw error;}
    // A throwing or synchronously cancelling hook cannot certify its current
    // work slice. Prior returned slices remain available to interruption receipts.
    const witness=handlingWitnesses.get(active);
    const valid=npc.active===active&&active.request.type===work.request.type&&active.request.targetId===work.request.targetId&&
      (!witness||witness.physiology===npc.physiology&&witness.discovery===npc.discovery);
    if(witness&&valid)witness.worked+=worked;
    const captureWitness=catchWitnesses.get(active);
    if(captureWitness&&valid)captureWitness.worked+=worked;
    if(npc.active!==active){settled.add(active);return true;}
    if(valid)work.worked+=worked;
    active.worked=work.worked;
    if(indication&&valid&&worked>0){
      const geometry=publicIndicationGeometry(npc);
      if(!geometry){settled.add(active);terminal=true;done(options.complete,npc,work.request,{ok:false,code:'INDICATION_INTERRUPTED',durationSeconds:work.worked},active);return true;}
      // Sight is sampled only at the current world-state endpoint, never
      // backdated to an inferred funded prefix. The observer must reject a
      // materially partially funded step as proof of continuous perception.
      try{indication.onPaid?.(Object.freeze({geometry,paidSeconds:worked,at:npc.elapsed,stepSeconds:dt}));}
      catch(error){settled.add(active);terminal=true;done(options.complete,npc,work.request,{ok:false,code:'INDICATION_OBSERVER_FAILED',durationSeconds:work.worked},active);throw error;}
      if(npc.active!==active||settled.has(active)){settled.add(active);return true;}
      if(!indicationValid(npc,active,indication,environment)){settled.add(active);terminal=true;done(options.complete,npc,work.request,{ok:false,code:'INDICATION_INTERRUPTED',durationSeconds:work.worked},active);return true;}
    }
    if(work.worked+1e-8<work.seconds){
      if(work.elapsed+1e-9<work.deadline-work.startedAt)return true;
      settled.add(active);terminal=true;
      expireNpcRun(npc,active,work.startedAt+work.elapsed);
      if(active.request.type==='catch')recordAquaticCaptureFailure(environment.ecology,{miss:false});
      done(options.complete,npc,active.request,{ok:false,code:'ACTION_TIMEOUT',durationSeconds:work.worked},active);return true;
    }
    // Retire before validation, effects or callbacks; even a throwing callback
    // cannot replay this physical completion. Keep its context until completion.
    settled.add(active);terminal=true;
    const request=active.request;
    if(captureWitness&&request.type!=='catch'){
      recordAquaticCaptureFailure(environment.ecology,{miss:false});
      done(options.complete,npc,{type:'catch',targetId:captureWitness.targetId},{ok:false,code:'CATCH_INTERRUPTED',durationSeconds:active.worked},active);return true;
    }
    const sharing=sharedGrasps.get(active);
    const measured=handlingWitnesses.get(active);
    if(sharing&&(!measured||active.seconds!==sharing.seconds||measured.seconds!==sharing.seconds||Math.abs(measured.worked-sharing.seconds)>1e-8)){done(options.complete,npc,request,{ok:false,code:'SHARING_INTERRUPTED'},active);return true;}
    const check=sharing?sharedCheck(npc,request,environment,sharing):allowed(npc,request.targetId,environment,request.type==='inspect_object'||!!indication);
    if(!check.ok){if(request.type==='catch')recordAquaticCaptureFailure(environment.ecology,{miss:false});done(options.complete,npc,request,{...check,durationSeconds:active.worked},active);return true;}
    if(['grasp','pull','catch'].includes(request.type)&&(npc.inventory.items?.length||0)>=DISCOVERY_RULES.capacity){
      if(request.type==='catch')recordAquaticCaptureFailure(environment.ecology,{miss:false});
      done(options.complete,npc,request,{ok:false,code:'HANDS_FULL',durationSeconds:active.worked},active);return true;
    }
    let result;
    if(indication){
      result={ok:true,code:'OBJECT_INDICATED'};
    }else if(request.type==='catch'){
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
      const witnessedSource=describeEcologyObject(environment.ecology,request.targetId,{actorId:npc.id});
      if(witnessedSource)witnessedSource.position={...npc.position};
      const fraction=Math.min(1,DISCOVERY_RULES.sampleGrams/Math.max(.001,check.physical.massGrams||0));
      const material=consumeEcologyMaterial(environment.ecology,request.targetId,fraction,{actorId:npc.id,accept:portion=>ingestMaterial(npc,portion,{objectId:request.targetId,actionId:npc.memory?.nextId||0,provenance:'sampled',at:npc.elapsed})});
      if(!material?.ok)result={ok:false,code:material?.code||'CANNOT_SAMPLE'};
      else {
        const ingestion=material.ingestion;
        result={ok:ingestion.ok===true,code:ingestion.code||'SWALLOWED',delayed:ingestion.delayed===true,...(ingestion.ingestionId?{ingestionId:ingestion.ingestionId}:{}),...(ingestion.ok===true&&material.remaining===false?{finishedMaterial:true}:{})};
        if(result.ok){publishConsumption(environment.ecology,npc,witnessedSource);npc.discovery.samplesPending[request.targetId]=npc.elapsed;npc.presentation.eatUntil=npc.elapsed+2;}
      }
    }else {
      const response=sharing?transferEcologyMaterial(environment.ecology,request.targetId,sharing.donor,npc):interactEcologyObject(environment.ecology,request.targetId,request.type,{actorId:npc.id,position:{...npc.position},scene:npc.scene,power:1,amount:.02,inventory:npc.inventory.items});
      const materialId=response?.materialId||response?.material?.id;
      result={ok:response?.ok===true,code:response?.code||'NO_CHANGE',...(objectId(materialId)?{materialId}:{}),...(objectId(response?.resultObjectId)?{resultObjectId:response.resultObjectId}:{})};
      if(result.ok&&result.resultObjectId){
        const object=describeEcologyObject(environment.ecology,result.resultObjectId,{actorId:npc.id});
        if(object)rememberDirectDiscoveryObject(npc,object);
      }
      if(result.ok&&['grasp','pull'].includes(request.type)){
        const id=materialId||request.targetId;if(!npc.inventory.items.includes(id))npc.inventory.items.push(id);
        const object=describeEcologyObject(environment.ecology,id,{actorId:npc.id});if(object)rememberDirectDiscoveryObject(npc,object);
      }
      if(result.ok&&request.type==='pull'&&ozarkFiniteAquaticAgent(npc)){const source=describeEcologyObject(environment.ecology,request.targetId,{actorId:npc.id});if(source)rememberDirectDiscoveryObject(npc,source);}
      if(result.ok&&request.type==='release')npc.inventory.items=npc.inventory.items.filter(id=>id!==request.targetId);
    }
    // Swallowing a final portion may exhaust the globally persisted held material.
    if(!indication)npc.inventory.items=npc.inventory.items.filter(id=>lookupEcologyObject(environment.ecology,id)?.heldBy===npc.id);
    if(request.type==='catch'&&!result.ok)recordAquaticCaptureFailure(environment.ecology,{miss:result.code==='fish_missed'});
    const completion=done(options.complete,npc,request,{...result,durationSeconds:active.worked},active);
    if(result.finishedMaterial===true&&completion?.eventId)registerMaterialCompletion(npc,{
      targetId:request.targetId,actionId:completion.eventId,ingestionId:result.ingestionId,at:npc.elapsed});
    return true;
  }finally{
    ticking.delete(active);
    if(terminal||npc.active!==active){handlingWitnesses.delete(active);catchWitnesses.delete(active);sharedGrasps.delete(active);indications.delete(active);paidWork.delete(active);}
    if(terminal&&npc.active===active)npc.active=null;
  }
}
