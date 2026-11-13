/* Opt-in, ephemeral observation only. No policy or save-state fields are added. */
const observers=new WeakMap(),owners=new WeakMap();
let sessions=0;
const copy=value=>structuredClone(value);
// Only bounded own data fields are captured. No authored text, crops, gesture
// trajectories, model payloads, inventory, or arbitrary nested result objects.
function scalar(object,key){
  const value=object&&Object.getOwnPropertyDescriptor(object,key)?.value;
  return typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)?value:
    typeof value==='string'&&value.length<=96?value:undefined;
}
function fields(object,keys){const out={};for(const key of keys){const value=scalar(object,key);if(value!==undefined)out[key]=value;}return out;}
function actionMetadata(action){
  if(!action)return null;
  const out=fields(action,['type','targetId','sourceId','seconds','duration']);
  const target=Object.getOwnPropertyDescriptor(action,'target')?.value;
  if(target)out.target=fields(target,['x','y']);
  return out;
}
function outcomeMetadata(result){return result?fields(result,['ok','code','eventId','durationSeconds','distance','materialId','ingestionId','finishedMaterial']):null;}
export function hasActionProvenance(n){return observers.has(n);}

const position=n=>({scene:n.scene,position:{x:n.position?.x,y:n.position?.y},at:n.elapsed,epoch:n.epoch});
function emit(s,row){
  try{const detached=copy({...row,recordSequence:++s.records});if(s.buffer.length>=s.capacity){s.dropped++;return;}s.buffer.push(detached);}
  catch{s.errors++;}
}
function censor(n,s,reason){
  if(!s.active)return;
  const {active,token}=s.active;owners.delete(active);s.active=null;s.censored++;
  emit(s,{kind:'censored',token,reason,end:position(n)});
}
function reconcile(n,s){if(s.active&&(n.active!==s.active.active||n.epoch!==s.active.epoch||n.discovery!==s.active.discovery||n.physiology!==s.active.physiology))censor(n,s,'active identity or epoch changed without captured completion');}
export function enableActionProvenance(n,{capacity=256}={}){
  if(observers.has(n))throw new Error('observer already enabled');
  if(!Number.isInteger(capacity)||capacity<1||capacity>4096)throw new Error('invalid capacity');
  const s={session:`capture-${++sessions}`,capacity,buffer:[],requests:0,records:0,dropped:0,errors:0,censored:0,pending:[],suppressed:0,active:null};observers.set(n,s);
  if(n.active)emit(s,{kind:'unlinked-active',reason:'capture began after action admission',at:n.elapsed,epoch:n.epoch});
  return s.session;
}
export function beginActionRequest(n,raw){
  const s=observers.get(n);if(!s)return null;
  try{reconcile(n,s);if(s.pending.length>=16){s.errors++;s.suppressed++;return {s,suppressed:true};}const scope={s,token:{session:s.session,actor:n.id,epoch:n.epoch,sequence:++s.requests},before:n.active,completed:false,epoch:n.epoch,discovery:n.discovery,physiology:n.physiology};s.pending.push(scope);emit(s,{kind:'request',token:scope.token,requestCapture:'raw request deliberately not inspected',start:position(n)});return scope;}
  catch{s.errors++;return null;}
}
export function endActionRequest(n,scope,result,threw=false){
  if(!scope)return;const s=observers.get(n);if(s!==scope.s)return;
  if(scope.suppressed){s.suppressed--;return;}
  try{
    const index=s.pending.lastIndexOf(scope);if(index<0){s.errors++;return;}s.pending.splice(index,1);
    const active=n.active,successfulStart=scalar(result,'ok')===true&&['STARTED','ACTION_STARTED'].includes(scalar(result,'code'));
    const admitted=successfulStart&&!owners.has(active)&&!threw&&!scope.completed&&scope.epoch===n.epoch&&scope.discovery===n.discovery&&scope.physiology===n.physiology&&active&&active!==scope.before;
    if(admitted){if(s.active)censor(n,s,'new action replaced captured action');owners.set(active,{s,token:scope.token,actor:n,epoch:n.epoch,discovery:n.discovery,physiology:n.physiology});s.active={active,token:scope.token,epoch:n.epoch,discovery:n.discovery,physiology:n.physiology};}
    emit(s,{kind:'dispatch-return',token:scope.token,result:outcomeMetadata(result),threw,admitted:!!admitted,synchronousCompletion:scope.completed,normalizedRequest:admitted?actionMetadata(active.request):null,route:admitted&&Array.isArray(active.route)?{length:active.route.length,index:active.index,endpoint:fields(active.route.at(-1),['x','y'])}:null});
  }catch{s.errors++;}
}
export function recordActionCompletion(n,active,request,result,event){
  const s=observers.get(n);if(!s)return;
  try{
    const owner=active&&owners.get(active);let token=null;
    if(owner&&(owner.epoch!==n.epoch||owner.discovery!==n.discovery||owner.physiology!==n.physiology)){censor(n,s,'completion crossed actor epoch or identity');}
    else if(owner&&owner.s===s&&owner.actor===n){token=owner.token;owners.delete(active);if(s.active?.active===active)s.active=null;}
    else if(!active){const pending=s.pending.at(-1);if(pending&&!pending.completed&&!s.suppressed&&!pending.before&&pending.epoch===n.epoch&&pending.discovery===n.discovery&&pending.physiology===n.physiology){pending.completed=true;token=pending.token;}}
    emit(s,{kind:'completion',token,link:token?'exact-active-or-synchronous-request':'unresolved-entry-path',request:actionMetadata(request),result:outcomeMetadata(result),eventId:scalar(event,'id')??null,end:position(n),route:active&&Array.isArray(active.route)?{length:active.route.length,index:active.index,endpoint:fields(active.route.at(-1),['x','y'])}:null,arrival:scalar(result,'code')==='ARRIVED'?{reported:true,position:fields(n.position,['x','y']),scene:n.scene}:null});
  }catch{s.errors++;}
}
export function drainActionProvenance(n,session=null){
  const s=observers.get(n);if(!s||session!==null&&session!==s.session)return null;reconcile(n,s);
  const output={schemaVersion:1,metadataOnly:true,session:s.session,rows:s.buffer.splice(0),counters:{requests:s.requests,records:s.records,dropped:s.dropped,errors:s.errors,censored:s.censored},activeToken:s.active?copy(s.active.token):null};return output;
}
export function disposeActionProvenance(n,session=null){const s=observers.get(n);if(!s||session!==null&&session!==s.session)return null;censor(n,s,'capture disposed with unfinished action');const out=drainActionProvenance(n);observers.delete(n);return out;}
