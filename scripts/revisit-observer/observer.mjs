// Instrumented copies only. No observer is registered by game code.
const state=new WeakMap();
const handling=new Set(['grasp','pull','strike','catch']);
const point=p=>Number.isFinite(p?.x)&&Number.isFinite(p?.y)?{x:p.x,y:p.y}:null;
const scope=n=>({actor:n.id,epoch:n.epoch,scene:n.scene,at:n.elapsed});
export function attach(n,{maxRows=4096,maxBytes=2**21,world=null}={}){
 if(state.has(n)||!Number.isInteger(maxRows)||maxRows<1||maxRows>65536||!Number.isInteger(maxBytes)||maxBytes<128||maxBytes>2**24)throw Error('observer bounds');
 state.set(n,{rows:[],maxRows,maxBytes,bytes:0,seq:0,gap:null,identities:new WeakMap(),nextIdentity:0,sights:new Map(),epoch:n.epoch,scene:n.scene,memory:n.memory,discovery:n.discovery,physiology:n.physiology,world,environment:world?.environment,ecology:world?.environment?.ecology,lineage:world?.worldLineage,incarnation:world?.worldLineage?.agents?.find(a=>a.agentId===n.id)?.serial});
}
function run(n,f){
 const s=state.get(n);if(!s||s.gap)return;
 try{
  if(n.memory!==s.memory||n.discovery!==s.discovery||n.physiology!==s.physiology||s.world&&(s.world.environment!==s.environment||s.environment.ecology!==s.ecology||s.world.worldLineage!==s.lineage||!s.world.agents.includes(n)||s.lineage.agents.find(a=>a.agentId===n.id)?.serial!==s.incarnation)){s.gap={...scope(n),after:s.seq,reason:"scope-replacement"};return;}
  if(s.epoch!==n.epoch||s.scene!==n.scene){s.sights.clear();s.epoch=n.epoch;s.scene=n.scene;}
  f(s);
 }catch{s.gap={...scope(n),after:s.seq,reason:'observer-error'};}
}
function emit(n,s,kind,data){
 const row={...scope(n),serial:s.seq+1,kind,...data};
 const bytes=new TextEncoder().encode(JSON.stringify(row)).length+1;
 if(s.rows.length>=s.maxRows||s.bytes+bytes>s.maxBytes){s.gap={...scope(n),after:s.seq,reason:'observer-overflow'};return;}
 s.rows.push(row);s.bytes+=bytes;s.seq++;
}
export function observedObject(n,o,identity){
 run(n,s=>{
  if(typeof o.id!=='string'||!identity||typeof identity!=='object')return;
  let key=s.identities.get(identity);if(!key){key=++s.nextIdentity;s.identities.set(identity,key);}
  const p=point(o.position);if(!p)return;
  const previous=s.sights.get(o.id);
  if(!previous&&s.sights.size>=2048){s.gap={...scope(n),after:s.seq,reason:'sight-index-overflow'};return;}
  s.sights.set(o.id,{key,at:n.elapsed,position:p,held:identity.heldBy!=null});
  if(previous?.watched){s.sights.get(o.id).watched=true;emit(n,s,'watch-sight',{source:o.id,key,position:p,actorPosition:point(n.position),held:identity.heldBy!=null});s.sights.get(o.id).serial=s.gap?null:s.seq;}
 });
}
export function completedHandling(n,work,completion,result,witness){
 run(n,s=>{
  if(!handling.has(work.request.type)||!(work.worked>0)||!Number.isInteger(completion?.eventId))return;
  const qualified=witness?.eventId===completion.eventId&&witness?.type===work.request.type&&witness?.targetId===work.request.targetId&&witness?.worked===work.worked;
  const source=work.request.targetId,key=s.identities.get(work.sourceIdentity)??null,sight=s.sights.get(source);
  // Start-time sight must be captured separately; a completion-time sight cannot replace it.
  const start=starts.get(work);
  if(start?.key===key&&sight)sight.watched=true;
  emit(n,s,'handling',{source,key,type:work.request.type,receipt:completion.eventId,paid:work.worked,qualified,ok:result.ok===true,code:result.code,startedAt:work.startedAt,sight:start??null,successor:typeof result.resultObjectId==='string'?result.resultObjectId:null});
 });
}
const starts=new WeakMap();
export function startedHandling(n,work){
 run(n,s=>{
  if(!handling.has(work.request.type))return;
  const key=s.identities.get(work.sourceIdentity),sight=s.sights.get(work.request.targetId);
  if(sight&&!sight.held&&key===sight.key&&n.elapsed>=sight.at&&n.elapsed-sight.at<=2)starts.set(work,{key,at:sight.at,position:sight.position,serial:sight.serial??null});
 });
}
export function revisitPhase(n,phase,source,goal,target,receipt=null,paid=null,distance=null,code=null){
 run(n,s=>emit(n,s,'revisit',{phase,source,goal:point(goal),target:point(target),receipt,paid,distance,code}));
}
export function drain(n){
 const s=state.get(n);if(!s)throw Error('observer not attached');
 const rows=s.rows;s.rows=[];s.bytes=0;return {rows,gap:s.gap?{...s.gap}:null};
}
const paidMoves=new WeakMap(),bound=new WeakMap();
export function markBound(n,active,source,goal,target){
 run(n,s=>{
  const link={source,goal:point(goal),target:point(target),id:s.seq+1};
  bound.set(active,link);s.active=link;
  emit(n,s,'bound',{...link});
 });
}
export function paidMove(n,active,p){
 const s=state.get(n);if(!s||s.gap||!bound.has(active)||!p)return;
 paidMoves.set(active,{seconds:p.seconds,propelled:p.propelled});
}
export function moveCompletion(n,active,event,result){
 run(n,s=>{
  const link=bound.get(active);if(!link)return;
  const paid=paidMoves.get(active);
  emit(n,s,'move-completion',{...link,receipt:event.id,ok:result.ok===true,code:result.code,paid:paid?.seconds??null,propelled:paid?.propelled??null,position:point(n.position)});
  bound.delete(active);s.finished=link;s.active=null;
 });
}
export function samplePose(n,tick){
 run(n,s=>{
  if(!Number.isSafeInteger(tick)||tick!==(s.lastTick??-1)+1)throw Error('nonconsecutive observer tick');
  s.lastTick=tick;
  emit(n,s,'pose',{tick,position:point(n.position),active:s.active?.id??s.finished?.id??null,lifecycle:n.lifecycle});
  s.finished=null;
 });
}
export const BODY_NUMERIC_FIELDS=Object.freeze(['fuel','storedFuel','hydration','waterDeficit','health','injury','fatigue','sleep','absorbedKcal','metabolizedKcal','risk','warningSeconds','criticalSeconds','collapses']);
export function bodyProjection(n){
  const p=n.physiology,t=p?.totals,stats=n.stats;
  const values={fuel:p?.availableEnergyKcal,storedFuel:p?.storedEnergyKcal,hydration:n.hydration,waterDeficit:p?.waterDeficitMl,
   health:n.health,injury:stats?.injuries,fatigue:p?.fatigue,sleep:p?.sleepPressure,absorbedKcal:t?.absorbedKcal,
   metabolizedKcal:t?.metabolizedKcal,risk:n.riskCost,warningSeconds:stats?.warningSeconds,criticalSeconds:stats?.criticalSeconds,collapses:stats?.collapses};
  return {lifecycle:n.lifecycle,mode:n.bodyMode,active:n.active?.request?.type??null,...values};
}
export function sampleBody(n,tick){
 run(n,s=>{
  const values=bodyProjection(n);
  const missing=BODY_NUMERIC_FIELDS.filter(k=>!Number.isFinite(values[k]));
  if(missing.length){s.gap={...scope(n),after:s.seq,reason:'missing-body-fields',fields:missing};return;}
  emit(n,s,'body',{tick,...values});
 });
}
// Caller supplies only the product's detached public diagnostic projection.
export function sampleSequence(n,tick,status){
 run(n,s=>{
  const copied=status===null?null:structuredClone(status);
  const serialized=JSON.stringify(copied);
  if(serialized.length>2**17)throw Error('sequence status exceeds bound');
  if(s.previousSequence===serialized)return;
  s.previousSequence=serialized;
  emit(n,s,'sequence',{tick,status:copied});
 });
}
export function actionReceipt(n,event,request,result){
 run(n,s=>{
  if(event?.type!=='action'||!Number.isSafeInteger(event.id))throw Error('missing canonical receipt');
  const id=x=>typeof x==='string'?x:null;
  emit(n,s,'receipt',{receipt:event.id,type:id(request?.type),target:id(request?.targetId),ok:result.ok===true,code:id(result.code),
   output:id(result.materialId)??id(result.resultObjectId),successor:id(result.resultObjectId),duration:Number.isFinite(result.durationSeconds)?result.durationSeconds:null});
 });
}
