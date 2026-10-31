// Supplied local object/geometry sensing and a supplied pointing parser, NOT
// learned scene vision. No English descriptions or hidden target metadata enter
// the parser. The ordinary sensory universe excludes held/occluded objects.
import { senseEcology } from './ecology.js';
import { actorLineOfSight } from './perception.js';
import { NPC_RULES } from './config.js';
import { isSleeping } from './biology.js';
import { publicIndicationGeometry } from './discovery-actions.js';
import { ownFreeHandAction, publicFreeHandGeometry } from './free-hand-action.js';

export const REFERENCE_GEOMETRY_RULES = Object.freeze({
  segmentLength:24, coneDegrees:6, extrapolationRange:400, peerRange:250,
  sensoryCap:96, segmentSightStep:1,
});
const point=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const awake=n=>n?.lifecycle==='AWAKE'&&!isSleeping(n);
const copyGeometry=g=>Object.freeze({scene:g.scene,
  origin:Object.freeze({x:g.origin.x,y:g.origin.y}),
  tip:Object.freeze({x:g.tip.x,y:g.tip.y}),progress:g.progress});
function validGeometry(g){return !!g&&typeof g.scene==='string'&&point(g.origin)&&point(g.tip)&&
  Number.isFinite(g.progress)&&g.progress>0&&g.progress<=1&&
  Math.abs(distance(g.origin,g.tip)-REFERENCE_GEOMETRY_RULES.segmentLength)<1e-7;}

/** A fresh, read-only use of ordinary sight, with no expanded object registry.
 * An exact-cap result is conservatively incomplete: even invisible objects can
 * consume the ordinary pre-LOS budget. Bindings remain outside numeric parsing.
 */
export function senseReferenceObjects(listener,state){
  const snapshot={complete:false,reason:'listener-unavailable',at:listener?.elapsed??null,
    epoch:listener?.epoch??null,scene:listener?.scene??null,objects:[],bindings:[]};
  if(!awake(listener)||!point(listener.position)||!state?.environment?.ecology)return snapshot;
  const raw=senseEcology(state.environment.ecology,listener.position,listener.scene,NPC_RULES.visionRadius);
  if(raw.length>=REFERENCE_GEOMETRY_RULES.sensoryCap)return {...snapshot,reason:'sensory-incomplete'};
  const ids=new Set();
  for(const o of raw){
    if(o.scene!==listener.scene||!point(o.position)||distance(listener.position,o.position)>NPC_RULES.visionRadius||
      !actorLineOfSight(listener,listener.position,o.position))continue;
    if(typeof o.id!=='string'||ids.has(o.id))return {...snapshot,reason:'sensory-invalid'};
    ids.add(o.id);snapshot.bindings.push(o.id);
    snapshot.objects.push(Object.freeze({position:Object.freeze({x:o.position.x,y:o.position.y})}));
  }
  return {...snapshot,complete:true,reason:'complete'};
}

/** Only the short physical segment needs to be visible. The 400-unit search
 * direction is a mathematical extrapolation, never a visible beam or new sight.
 */
export function visibleIndicationGeometry(listener,geometry){
  if(!awake(listener)||!point(listener.position)||!validGeometry(geometry)||geometry.scene!==listener.scene)return null;
  const steps=Math.ceil(REFERENCE_GEOMETRY_RULES.segmentLength/REFERENCE_GEOMETRY_RULES.segmentSightStep);
  for(let i=0;i<=steps;i++){
    const t=i/steps,p={x:geometry.origin.x+(geometry.tip.x-geometry.origin.x)*t,
      y:geometry.origin.y+(geometry.tip.y-geometry.origin.y)*t};
    if(distance(listener.position,p)>NPC_RULES.visionRadius||!actorLineOfSight(listener,listener.position,p))return null;
  }
  return copyGeometry(geometry);
}

/** Pure numeric correspondence over the entire supplied fresh visible set.
 * Caller must reject an incomplete sensor snapshot before invoking this parser.
 * IDs, ordering, target annotations, species and private action fields are ignored.
 */
export function resolveIndication(geometry,objects){
  if(!validGeometry(geometry)||!Array.isArray(objects))return {index:null,reason:'invalid-geometry'};
  const dx=geometry.tip.x-geometry.origin.x,dy=geometry.tip.y-geometry.origin.y;
  const length=Math.hypot(dx,dy),cosine=Math.cos(REFERENCE_GEOMETRY_RULES.coneDegrees*Math.PI/180);
  let found=null;
  for(let index=0;index<objects.length;index++){
    const p=objects[index]?.position;
    if(!point(p))return {index:null,reason:'invalid-observation'};
    const x=p.x-geometry.origin.x,y=p.y-geometry.origin.y,d=Math.hypot(x,y);
    if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(d))return {index:null,reason:'invalid-observation'};
    if(d<=0||d>REFERENCE_GEOMETRY_RULES.extrapolationRange)continue;
    if((x*dx+y*dy)/(d*length)<cosine-1e-12)continue;
    if(found!==null)return {index:null,reason:'ambiguous'};
    found=index;
  }
  return found===null?{index:null,reason:'no-visible-referent'}:{index:found,reason:'resolved'};
}

/** Trusted sensory adapter, also usable for private target-blind pair preflight.
 * A hypothetical preflight geometry is never rendered or delivered as a message.
 */
export function perceiveReferenceGeometry(listener,sender,geometry,state){
  const fail=reason=>({index:null,objectId:null,reason,geometry:null,
    at:listener?.elapsed??null,epoch:listener?.epoch??null,scene:listener?.scene??null});
  if(!awake(listener)||!awake(sender)||sender===listener||listener.scene!==sender.scene||
    !point(listener.position)||!point(sender.position))return fail('peer-unavailable');
  if(distance(listener.position,sender.position)>REFERENCE_GEOMETRY_RULES.peerRange||
    !actorLineOfSight(listener,listener.position,sender.position))return fail('peer-not-visible');
  // A detached segment cannot masquerade as the visible sender's hand.
  if(!validGeometry(geometry)||geometry.scene!==sender.scene||distance(geometry.origin,sender.position)>1e-7)return fail('invalid-gesture');
  const visible=visibleIndicationGeometry(listener,geometry);
  if(!visible)return fail('gesture-not-visible');
  const snapshot=senseReferenceObjects(listener,state);
  if(!snapshot.complete)return fail(snapshot.reason);
  const result=resolveIndication(visible,snapshot.objects);
  return {...result,objectId:result.index===null?null:snapshot.bindings[result.index],geometry:visible,
    at:snapshot.at,epoch:snapshot.epoch,scene:snapshot.scene};
}

/** Actual paid observations ONLY use the same runtime projection as rendering. */
export function observeIndication(listener,sender,state){
  return perceiveReferenceGeometry(listener,sender,publicIndicationGeometry(sender),state);
}

/** Actor-local public pose sensing. This deliberately stops before object
 * resolution: neither a target binding nor the reference transaction is a
 * sensory input. A visible peer with no rendered pose is observed absence;
 * an unseen peer or partly hidden segment is unknown, never silence.
 */
export function sensePublicPeerGesture(observer,peer){
  const at=observer?.elapsed??null;
  const ownActionActive=observer?.active?1:0;
  const ownFreeHand=publicFreeHandGeometry(observer);
  const ownPosition=observer?.position;
  const ownRelative=p=>({dx:p.x-ownPosition.x,dy:p.y-ownPosition.y});
  const ownCandidate=ownFreeHand&&point(ownPosition)?{
    origin:ownRelative(ownFreeHand.origin),tip:ownRelative(ownFreeHand.tip),
    progress:ownFreeHand.progress}:null;
  const ownFreeHandPose=ownCandidate&&[
    ownCandidate.origin.dx,ownCandidate.origin.dy,
    ownCandidate.tip.dx,ownCandidate.tip.dy].every(Number.isFinite)?ownCandidate:null;
  const self={actionActive:ownActionActive,
    poseProgress:publicIndicationGeometry(observer)?.progress??ownFreeHandPose?.progress??null,
    freeHandActive:Number(ownFreeHandAction(observer)),freeHandPose:ownFreeHandPose};
  const unknown={at,visibility:'unknown',peer:null,pose:null,self};
  if(!awake(observer)||!awake(peer)||observer===peer||observer.scene!==peer.scene||
    !point(observer.position)||!point(peer.position))return unknown;
  if(distance(observer.position,peer.position)>NPC_RULES.visionRadius||
    !actorLineOfSight(observer,observer.position,peer.position))return unknown;
  const relative=p=>({dx:p.x-observer.position.x,dy:p.y-observer.position.y});
  const peerPosition=relative(peer.position);
  const publicPose=publicIndicationGeometry(peer)||publicFreeHandGeometry(peer);
  if(!publicPose)return {at,visibility:'absent',peer:peerPosition,pose:null,self};
  const visible=visibleIndicationGeometry(observer,publicPose);
  if(!visible)return {at,visibility:'unknown',peer:peerPosition,pose:null,self};
  return {at,visibility:'pose',peer:peerPosition,
    pose:{origin:relative(visible.origin),tip:relative(visible.tip),progress:visible.progress},self};
}
