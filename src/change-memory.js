import {sensedEnvironment} from './interoception.js';
import {successfulDiscoveryActionCompletion} from './discovery-actions.js';
import {lookupEcologyObject} from './ecology.js';
// Personally observed comparisons, never action authority or utility credit.
// No shared receipt/experiment allocation and no hard proof-retention owner.
const states=new WeakMap(),bindings=new WeakMap();
export function bindChangeMemory(n,state){const lineage=state?.worldLineage,actor=lineage?.agents?.find(a=>a.agentId===n.id);if(!lineage||!actor)return;const b=bindings.get(n);if(b&&(b.worldId!==lineage.instanceId||b.incarnation!==actor.serial||b.state!==state))states.delete(n);bindings.set(n,{worldId:lineage.instanceId,incarnation:actor.serial,state});}
export const CHANGE_MEMORY_LIMIT=16;
const WINDOW=2;
const plain=x=>x&&typeof x==='object'&&!Array.isArray(x);
const exact=(x,keys)=>plain(x)&&Object.keys(x).sort().join('|')===[...keys].sort().join('|');
const number=x=>Number.isFinite(x)&&x>=0&&x<=1e10;
const integer=x=>Number.isSafeInteger(x)&&x>0;
const id=x=>typeof x==='string'&&/^object:[1-9][0-9]{0,8}$/.test(x);
const point=x=>exact(x,['x','y'])&&Number.isFinite(x.x)&&Number.isFinite(x.y)&&Math.abs(x.x)<24000&&Math.abs(x.y)<24000;
const copy=x=>structuredClone(x);
const bytes=x=>JSON.stringify(x);
const fields=['position','motion','appearance','count'];
const environmentSample=e=>Object.fromEntries(['timeOfDay','weather','shade'].map(k=>[k,e?.[k]??'unknown']));
function sample(n,o,environment){return {environment:environmentSample(environment),at:n.elapsed,actorPosition:{...n.position},position:{...o.position},motion:o.motion??null,appearance:copy(o.appearance),count:o.count??null};}
function validSample(s){return exact(s,['environment','at','actorPosition',...fields])&&exact(s.environment,['timeOfDay','weather','shade'])&&['night','dawn','morning','afternoon','evening','unknown'].includes(s.environment.timeOfDay)&&['clear','cloudy','rainy','windy','unknown'].includes(s.environment.weather)&&['shaded','exposed','unknown'].includes(s.environment.shade)&&number(s.at)&&point(s.actorPosition)&&point(s.position)&&(s.motion===null||typeof s.motion==='string'&&s.motion.length<=80)&&plain(s.appearance)&&Object.keys(s.appearance).every(k=>['shape','color','texture','motion','sound','size','smell','details'].includes(k)&&typeof s.appearance[k]==='string'&&s.appearance[k].length<=100)&&(s.count===null||Number.isInteger(s.count)&&s.count>=0&&s.count<=1000);}
function changes(a,b){return fields.filter(k=>bytes(a[k])!==bytes(b[k]));}
function outcome(a,b,sameTarget=true){return {relation:sameTarget?'same-target':'successor',motion:b.motion,appearance:copy(b.appearance),count:b.count,displacement:sameTarget?{x:b.position.x-a.position.x,y:b.position.y-a.position.y}:null};}
function validOutcome(o){return exact(o,['relation','motion','appearance','count','displacement'])&&['same-target','successor'].includes(o.relation)&&(o.relation==='successor'?o.displacement===null:exact(o.displacement,['x','y'])&&Object.values(o.displacement).every(v=>Number.isFinite(v)&&Math.abs(v)<48000))&&validSample({at:0,actorPosition:{x:0,y:0},position:{x:0,y:0},environment:{timeOfDay:'unknown',weather:'unknown',shade:'unknown'},motion:o.motion,appearance:o.appearance,count:o.count});}
function ref(row,d,experience){const e=d.experiments.find(e=>e.id===row.experimentId&&e.actionId===row.actionId),r=experience.find(r=>r.id===row.actionId);return e&&r?.type==='action'&&r.details?.action?.targetId===e.targetId&&r.details.action.type===e.primitive&&r.at===e.at&&r.details.result?.code===e.code&&r.details.result.ok===e.ok&&e.durationSeconds>0?e:null;}
export function validChangeMemory(m,n,d=n?.discovery,experience=n?.memory?.experience){
 if(!exact(m,['version','ownerId','worldId','incarnation','nextSerial','rows'])||m.version!==1||typeof m.worldId!=='string'||!/^[-a-zA-Z0-9]+$/.test(m.worldId)||!integer(m.incarnation)||m.ownerId!==n?.id||!integer(m.nextSerial)||!Array.isArray(m.rows)||m.rows.length>CHANGE_MEMORY_LIMIT||!d||!Array.isArray(experience))return false;
 let prior=0;const actions=new Set(),experiments=new Set();
 for(const r of m.rows){
  if(!exact(r,['serial','epoch','predictionResult','experimentId','actionId','startedAt','completedAt','dispatchPosition','dispatchEnvironment','afterTargetId','before','after','state','changes','prediction'])||!Number.isSafeInteger(r.epoch)||r.epoch<0||r.epoch>n.epoch||!integer(r.serial)||r.serial<=prior||r.serial>=m.nextSerial||!integer(r.experimentId)||!integer(r.actionId)||!point(r.dispatchPosition)||!exact(r.dispatchEnvironment,['timeOfDay','weather','shade'])||!number(r.startedAt)||!number(r.completedAt)||r.startedAt>r.completedAt||r.completedAt>n.elapsed||!validSample(r.before)||r.before.at>r.startedAt||r.startedAt-r.before.at>WINDOW||!Array.isArray(r.changes)||!['comparable','missing','interposed','replaced','self-moved','environment-changed','interrupted'].includes(r.state))return false;
  if(!validSample({...r.before,actorPosition:r.dispatchPosition,environment:r.dispatchEnvironment}))return false;
  const e=ref(r,d,experience);if(!e||actions.has(r.actionId)||experiments.has(r.experimentId)||r.completedAt-r.startedAt+1e-8<e.durationSeconds||e.at!==r.completedAt||r.afterTargetId!==(e.materialId??e.resultObjectId??e.targetId))return false;
  actions.add(r.actionId);experiments.add(r.experimentId);
  if(['missing','interposed','replaced'].includes(r.state)&&r.after!==null)return false;
  if(r.state==='self-moved'&&(!r.after||bytes(r.before.actorPosition)===bytes(r.dispatchPosition)&&bytes(r.dispatchPosition)===bytes(r.after.actorPosition)))return false;
  if(r.state==='environment-changed'&&(!r.after||bytes(r.before.environment)===bytes(r.dispatchEnvironment)&&bytes(r.dispatchEnvironment)===bytes(r.after.environment)))return false;
  if(r.after!==null&&(!validSample(r.after)||r.after.at<=r.completedAt||r.after.at>r.completedAt+WINDOW||r.after.at>n.elapsed))return false;
  if(r.state==='comparable'){if(!e.ok||!r.after||bytes(r.before.actorPosition)!==bytes(r.dispatchPosition)||bytes(r.dispatchPosition)!==bytes(r.after.actorPosition)||bytes(r.before.environment)!==bytes(r.dispatchEnvironment)||bytes(r.dispatchEnvironment)!==bytes(r.after.environment)||bytes(r.changes)!==bytes(changes(r.before,r.after)))return false;}else if(r.changes.length)return false;
  const p=r.prediction;if(p!==null){if(!exact(p,['at','support','outcome'])||p.at!==r.startedAt||!Array.isArray(p.support)||p.support.length!==2||new Set(p.support).size!==2||!p.support.every(x=>integer(x)&&x<r.serial)||!validOutcome(p.outcome))return false;}
  const expected=r.prediction===null||r.state!=='comparable'?'unknown':bytes(r.prediction.outcome)===bytes(outcome(r.before,r.after,r.afterTargetId===e.targetId))?'matched':'mismatched';if(r.predictionResult!==expected)return false;
  prior=r.serial;
 }
 return true;
}
const intact=(n,s)=>s&&s.id===n.id&&s.epoch===n.epoch&&s.memory===n.memory&&s.discovery===n.discovery&&s.physiology===n.physiology&&s.scene===n.scene;
function scope(n,environment){
 let s=states.get(n);
 if(s&&(!intact(n,s)||s.environment!==environment||s.ecology!==environment.ecology)){states.delete(n);s=null;}
 if(!s){s={id:n.id,epoch:n.epoch,memory:n.memory,discovery:n.discovery,physiology:n.physiology,scene:n.scene,environment,ecology:environment.ecology,sights:new Map(),support:new Map(),pending:null};states.set(n,s);}return s;
}
function append(n,s,p,after,state){
 const e=n.discovery.experiments.find(e=>e.actionId===p.actionId);if(!e||!p.before)return;
 let m=n.discovery.changeMemory;const binding=bindings.get(n);if(m&&(!validChangeMemory(m,n)||m.worldId!==binding?.worldId||m.incarnation!==binding?.incarnation))return;
 if(!m){const b=bindings.get(n);if(!b)return;m=n.discovery.changeMemory={version:1,ownerId:n.id,worldId:b.worldId,incarnation:b.incarnation,nextSerial:1,rows:[]};}
 if(m.nextSerial>=Number.MAX_SAFE_INTEGER)return;
 const observed=state==='comparable'?changes(p.before,after):[];
 const row={serial:m.nextSerial++,epoch:n.epoch,predictionResult:p.prediction===null||state!=='comparable'?'unknown':bytes(p.prediction.outcome)===bytes(outcome(p.before,after,(p.postId??p.targetId)===p.targetId))?'matched':'mismatched',experimentId:e.id,actionId:e.actionId,startedAt:p.startedAt,completedAt:e.at,dispatchPosition:copy(p.dispatchPosition),dispatchEnvironment:copy(p.dispatchEnvironment),afterTargetId:p.postId??p.targetId,before:copy(p.before),after:after?copy(after):null,state,changes:observed,prediction:copy(p.prediction)};
 m.rows.push(row);if(m.rows.length>CHANGE_MEMORY_LIMIT)m.rows.shift();
 s.support.set(row.serial,{row,bytes:bytes(row),identity:p.identity,owner:p.owner,type:e.primitive,targetId:e.targetId});
 for(const serial of s.support.keys())if(!m.rows.some(r=>r.serial===serial))s.support.delete(serial);
}
// Called only from observeNpc's actual ordinary perception batch, not result refreshes.
export function observeChangeMemory(n,observation,environment,identityOf){
 const s=scope(n,environment),visible=new Map();
 for(const o of observation.objects||[]){if(!id(o.id)||!point(o.position))continue;const physical=identityOf(o.id);if(!physical)continue;
  const sight={sample:sample(n,o,observation.environment),identity:physical,owner:physical.heldBy??null};if(!validSample(sight.sample))continue;visible.set(o.id,sight);
  for(const [serial,b]of s.support)if(b.targetId===o.id&&(b.identity!==physical||b.owner!==sight.owner))s.support.delete(serial);
 }
 const p=s.pending;
 if(p){
  const sight=visible.get(p.postId??p.targetId);
  if(sight&&(sight.identity!==(p.postIdentity??p.identity)||sight.owner!==(p.actionId?p.postOwner:p.owner))){if(p.actionId)append(n,s,p,null,'replaced');s.pending=null;}
  else if(p.actionId&&n.elapsed>p.completedAt){
   if(n.elapsed>p.completedAt+WINDOW){append(n,s,p,null,'missing');s.pending=null;}
   else if(sight){const state=p.interrupted||!p.proven?'interrupted':p.dispatchConfound??(bytes(sight.sample.actorPosition)!==bytes(p.before.actorPosition)?'self-moved':bytes(sight.sample.environment)!==bytes(p.before.environment)?'environment-changed':'comparable');append(n,s,p,sight.sample,state);s.pending=null;}
  }
 }
 s.sights=visible;
}
export function interruptChangeMemory(n){
 const s=states.get(n);if(!s?.pending)return;if(!intact(n,s)){states.delete(n);return;}
 const p=s.pending;
 // A rejected/interposed request does not stop the already paid action. Keep
 // its capture tainted until its own canonical completion, never invent a
 // receipt for the rejected request or silently recover older concordance.
 if(!p.actionId&&n.active===p.active){p.interrupted=true;return;}
 if(p.actionId)append(n,s,p,null,'interposed');s.pending=null;
}
// Dispatch consumes no permit and changes neither request nor policy.
export function startChangeMemory(n,active,environment,physical){
 const s=scope(n,environment);interruptChangeMemory(n);
 const before=s.sights.get(active.request.targetId);if(!before||before.identity!==physical||before.owner!==(physical.heldBy??null)||n.elapsed-before.sample.at>WINDOW||before.sample.at>n.elapsed)return;
 const dispatchPosition={...n.position},dispatchEnvironment=environmentSample(sensedEnvironment(n));
 const dispatchConfound=bytes(dispatchPosition)!==bytes(before.sample.actorPosition)?'self-moved':bytes(dispatchEnvironment)!==bytes(before.sample.environment)?'environment-changed':null;
 let prediction=null;const m=n.discovery.changeMemory;
 if(!dispatchConfound&&m&&validChangeMemory(m,n)){
  const candidates=m.rows.filter(row=>{const b=s.support.get(row.serial);return b&&b.row===row&&b.bytes===bytes(row)&&b.identity===physical&&b.owner===before.owner&&b.type===active.request.type&&row.completedAt<n.elapsed&&bytes(row.before.appearance)===bytes(before.sample.appearance)&&bytes(row.before.environment)===bytes(before.sample.environment)&&row.before.motion===before.sample.motion&&row.before.count===before.sample.count;}).slice(-2);
  if(candidates.length===2&&candidates.every(r=>r.state==='comparable'&&r.after.at<n.elapsed)&&bytes(outcome(candidates[0].before,candidates[0].after,candidates[0].afterTargetId===active.request.targetId))===bytes(outcome(candidates[1].before,candidates[1].after,candidates[1].afterTargetId===active.request.targetId)))prediction={at:n.elapsed,support:candidates.map(r=>r.serial),outcome:outcome(candidates[0].before,candidates[0].after,candidates[0].afterTargetId===active.request.targetId)};
 }
 s.pending={active,dispatchPosition,dispatchEnvironment,dispatchConfound,identity:physical,owner:before.owner,targetId:active.request.targetId,before:copy(before.sample),startedAt:n.elapsed,prediction,actionId:null};
}
export function finishChangeMemory(n,active,eventId,result){
 const old=states.get(n);if(!old)return;const s=scope(n,old.environment),p=s.pending;if(!p||p.active!==active)return;
 const e=n.discovery.experiments.find(e=>e.actionId===eventId);if(!e||e.targetId!==p.targetId||e.primitive!==active.request.type||e.at!==n.elapsed||!(e.durationSeconds>0)){s.pending=null;return;}
 p.actionId=eventId;p.completedAt=n.elapsed;p.interrupted=!!p.interrupted||result.ok!==true;
 const proof=successfulDiscoveryActionCompletion(n,active);p.proven=!!proof&&proof.eventId===eventId&&proof.type===e.primitive&&proof.targetId===e.targetId&&proof.worked===e.durationSeconds;
 // Canonical result supplies only the identity to seek; the actual public
 // post-sample still must arrive from a later ordinary perception batch.
 p.postId=e.materialId??e.resultObjectId??e.targetId;
 p.postIdentity=lookupEcologyObject(s.ecology,p.postId);
 p.postOwner=p.postIdentity?.heldBy??null;
 if(!p.postIdentity){append(n,s,p,null,'missing');s.pending=null;}
}
export function retireChangeCustody(n,id){const s=states.get(n);if(!intact(n,s))return;for(const [serial,b]of s.support)if(b.targetId===id)s.support.delete(serial);if(s.pending&&(s.pending.targetId===id||s.pending.postId===id))interruptChangeMemory(n);}
export function pruneChangeMemory(n){const m=n.discovery?.changeMemory;if(!m||!Array.isArray(m.rows))return;m.rows=m.rows.filter(r=>ref(r,n.discovery,n.memory.experience));const s=states.get(n);if(s)for(const serial of s.support.keys())if(!m.rows.some(r=>r.serial===serial))s.support.delete(serial);}
export function changeMemoryStatus(n){const s=states.get(n);return {memory:copy(n.discovery?.changeMemory??null),pending:intact(n,s)&&s.pending?{startedAt:s.pending.startedAt,targetId:s.pending.targetId,prediction:copy(s.pending.prediction)}:null};}
