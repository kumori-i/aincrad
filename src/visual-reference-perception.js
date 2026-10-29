// Supplied local object/geometry sensing and a supplied pointing parser, NOT
// learned scene vision. No English descriptions or hidden target metadata enter
// the parser. The ordinary sensory universe excludes held/occluded objects.
import { senseEcology } from './ecology.js';
import { actorLineOfSight } from './perception.js';
import { NPC_RULES } from './config.js';
import { isSleeping } from './biology.js';
import { publicIndicationGeometry } from './discovery-actions.js';

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
