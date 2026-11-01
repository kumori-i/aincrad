// Session-only measurements of personally selected food runs. These witnesses
// never authorize an action, enter a save, or provide a policy/learner input.
export const FOOD_RUN_STAGES=Object.freeze(['travel','acquisition','sample']);
export const FOOD_RUN_REACH=Object.freeze(['observed','held','unknown']);
export const FOOD_RUN_END_REASONS=Object.freeze([
  'action-failed','expired','unavailable','complete','no-target',
  'availability-blocked','no-route','identity-loss','contact-escape','ablation','other',
]);
export const FOOD_RUN_OBSERVER_LIMITS=Object.freeze({counter:2147483647,paidSeconds:1e9});
const stages=new Set(FOOD_RUN_STAGES),reaches=new Set(FOOD_RUN_REACH),reasons=new Set(FOOD_RUN_END_REASONS);
const primitives=new Set(['inspect_object','grasp','release','pull','strike','catch','indicate_object']);
const interruptions=new Set(['PRIORITY_CHANGED','CONTACT_ESCAPE','ACTION_TIMEOUT','REFERENCE_INTERRUPTED','DISCOVERY_INTERRUPTED']);
const rejectionCodes=Object.freeze(['INVALID_REQUEST','UNOBSERVED_TARGET','NO_KNOWN_ROUTE','OUT_OF_REACH',
  'OBJECT_GONE','ACTION_BUSY','OTHER']);
const interruptionCodes=Object.freeze(['PRIORITY_CHANGED','ACTION_TIMEOUT','CONTACT_ESCAPE','REFERENCE_INTERRUPTED','OTHER']);
const states=new WeakMap(),runOwners=new WeakMap(),disabled=new WeakSet();
const limit=FOOD_RUN_OBSERVER_LIMITS;
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
const own=(value,key)=>{if(!plain(value))return undefined;const d=Object.getOwnPropertyDescriptor(value,key);return d&&Object.hasOwn(d,'value')?d.value:undefined;};
const identity=actor=>{
  const epoch=own(actor,'epoch'),discovery=own(actor,'discovery'),physiology=own(actor,'physiology');
  return Number.isSafeInteger(epoch)&&plain(discovery)&&plain(physiology)?{epoch,discovery,physiology}:null;
};
const same=(a,b)=>a&&b&&a.epoch===b.epoch&&a.discovery===b.discovery&&a.physiology===b.physiology;
const stageRow=()=>({selected:0,reach:{observed:0,held:0,unknown:0},normalized:0,
  substituted:0,normalizationRejected:0,admitted:0,immediateRejected:0,
  instantCompleted:0,firstPaid:0,certifiedPaidSeconds:0,completed:0,failed:0,
  interrupted:0,unavailable:0,
  rejectionReasons:Object.fromEntries(rejectionCodes.map(x=>[x,0])),
  interruptionReasons:Object.fromEntries(interruptionCodes.map(x=>[x,0]))});
const fresh=id=>({...id,stages:Object.fromEntries(FOOD_RUN_STAGES.map(x=>[x,stageRow()])),
  runEnds:Object.fromEntries(FOOD_RUN_END_REASONS.map(x=>[x,0])),
  pending:null,currentRun:null,sessionResets:0,sessionLosses:0,saturated:false});
function bump(s,row,key){if(row[key]<limit.counter)row[key]++;if(row[key]>=limit.counter)s.saturated=true;}
function lose(s){const choice=s.pending;if(!choice)return;choice.status='retired';bump(s,s.stages[choice.stage],'unavailable');bump(s,s,'sessionLosses');s.pending=null;}
function state(actor,create=false){
  if(!plain(actor)||disabled.has(actor))return null;
  const id=identity(actor);if(!id)return null;
  let s=states.get(actor);
  if(s&&!same(s,id)){
    if(!create)return null;
    const prior=s,lost=Number(Boolean(prior.pending));if(prior.pending)prior.pending.status='retired';
    s=fresh(id);s.sessionResets=Math.min(limit.counter,prior.sessionResets+1);
    s.sessionLosses=Math.min(limit.counter,prior.sessionLosses+lost);
    s.saturated=prior.saturated||s.sessionResets>=limit.counter||s.sessionLosses>=limit.counter;
    states.set(actor,s);
  }
  if(!s&&create){s=fresh(id);states.set(actor,s);}
  return s;
}
function signature(action,stage){
  const type=own(action,'type');
  if(stage==='travel'){
    const target=own(action,'target'),x=own(target,'x'),y=own(target,'y');
    return type==='move'&&Number.isFinite(x)&&Number.isFinite(y)?{type,x,y}:null;
  }
  const targetId=own(action,'targetId');
  if(typeof targetId!=='string'||!/^object:\d{1,9}$/.test(targetId)||
      stage==='sample'&&type!=='sample'||stage==='acquisition'&&!primitives.has(type))return null;
  return {type,targetId};
}
const matches=(a,b)=>a&&b&&a.type===b.type&&
  (a.type==='move'?a.x===b.x&&a.y===b.y:a.targetId===b.targetId);
function owned(s,actor,choice){return choice&&choice.actor===actor&&same(s,choice)&&s.pending===choice&&
  runOwners.get(choice.run)?.actor===actor&&
  (!runOwners.get(choice.run)?.ended||choice.status==='admitted'||choice.status==='normalized');}
function retire(s,choice){choice.status='retired';if(s.pending===choice)s.pending=null;}

/** The exact selected request object is the only observer-side dispatch key. */
export function markFoodRunChoice(actor,run,action,stage,{reach='unknown'}={}){try{
  const s=state(actor,true),sig=signature(action,stage);
  if(!s||!plain(run)||!sig||!stages.has(stage)||!reaches.has(reach)||own(s.discovery,'run')!==run)return false;
  let owner=runOwners.get(run);
  if(owner&&(!same(owner,s)||owner.actor!==actor||owner.ended))return false;
  if(s.currentRun&&s.currentRun!==run){
    const old=runOwners.get(s.currentRun);if(old&&!old.ended){old.ended=true;bump(s,s.runEnds,'unavailable');}
    lose(s);
  }
  if(s.pending)lose(s);
  if(!owner){owner={actor,...identity(actor),ended:false};runOwners.set(run,owner);}
  s.currentRun=run;
  const choice={actor,run,...identity(actor),stage,raw:action,signature:sig,normalized:null,
    active:null,status:'selected',firstPaid:false};
  s.pending=choice;bump(s,s.stages[stage],'selected');bump(s,s.stages[stage].reach,reach);
  return true;
}catch{return false;}}

/** A normalized copy must match the exact raw request, type and coordinates/target. */
export function normalizeFoodRunChoice(actor,raw,normalized){try{
  const s=state(actor,true),choice=s?.pending;if(!owned(s,actor,choice)||choice.status!=='selected')return false;
  if(choice.raw!==raw){bump(s,s.stages[choice.stage],'substituted');retire(s,choice);return false;}
  const sig=signature(normalized,choice.stage);
  if(!matches(choice.signature,sig)){bump(s,s.stages[choice.stage],'normalizationRejected');retire(s,choice);return false;}
  choice.normalized=normalized;choice.status='normalized';bump(s,s.stages[choice.stage],'normalized');return true;
}catch{return false;}}

/** Called after ordinary admission; repeated dispatch cannot reattach authority. */
export function dispatchFoodRunChoice(actor,raw,result,active){try{
  const s=state(actor,true),choice=s?.pending;
  if(!owned(s,actor,choice))return false;
  if(choice.raw!==raw){bump(s,s.stages[choice.stage],'substituted');retire(s,choice);return false;}
  if(choice.status==='selected'){
    bump(s,s.stages[choice.stage],'normalizationRejected');retire(s,choice);return false;
  }
  if(choice.status!=='normalized')return false;
  const row=s.stages[choice.stage],ok=own(result,'ok'),code=own(result,'code');
  if(typeof ok!=='boolean'||typeof code!=='string') {lose(s);return false;}
  // A synchronous physical preflight can end the run inside complete() before
  // the controller receives its negative result. It cannot authorize work.
  if(runOwners.get(choice.run)?.ended){
    if(ok||active){lose(s);return false;}
    bump(s,row,'immediateRejected');bump(s,row.rejectionReasons,
      rejectionCodes.includes(code)?code:'OTHER');retire(s,choice);return true;
  }
  if(ok&&code===(choice.stage==='travel'?'STARTED':'ACTION_STARTED')&&active&&
    own(actor,'active')===active&&matches(choice.signature,signature(own(active,'request'),choice.stage))){
    choice.active=active;choice.status='admitted';bump(s,row,'admitted');return true;
  }
  if(ok&&!active&&choice.stage==='travel'&&code==='ARRIVED'){
    bump(s,row,'instantCompleted');retire(s,choice);return true;
  }
  if(!ok){bump(s,row,'immediateRejected');bump(s,row.rejectionReasons,
    rejectionCodes.includes(code)?code:'OTHER');retire(s,choice);return true;}
  lose(s);return false;
}catch{return false;}}

/** Caller passes only a returned, certified paid slice for this exact active action. */
export function noteFoodRunPaid(actor,active,seconds){try{
  const s=state(actor,true),choice=s?.pending;
  if(!owned(s,actor,choice)||choice.status!=='admitted'||choice.active!==active||
    runOwners.get(choice.run)?.ended||own(actor,'active')!==active||
    !Number.isFinite(seconds)||seconds<=0||seconds>12)return false;
  const row=s.stages[choice.stage];
  if(!choice.firstPaid){choice.firstPaid=true;bump(s,row,'firstPaid');}
  row.certifiedPaidSeconds=Math.min(limit.paidSeconds,row.certifiedPaidSeconds+seconds);
  if(row.certifiedPaidSeconds===limit.paidSeconds)s.saturated=true;
  return true;
}catch{return false;}}

/** One terminal result consumes the exact admitted active witness. */
export function finishFoodRunAction(actor,active,request,result){try{
  const s=state(actor,true),choice=s?.pending;
  if(!owned(s,actor,choice)||choice.status!=='admitted'||choice.active!==active||
    own(actor,'active')!==active||
    !matches(choice.signature,signature(request,choice.stage)))return false;
  const row=s.stages[choice.stage],ok=own(result,'ok'),code=own(result,'code');
  if(typeof ok!=='boolean'||typeof code!=='string'){lose(s);return false;}
  if(ok)bump(s,row,'completed');else{
    bump(s,row,'failed');if(interruptions.has(code)){
      bump(s,row,'interrupted');bump(s,row.interruptionReasons,
        interruptionCodes.includes(code)?code:'OTHER');
    }
  }
  retire(s,choice);return true;
}catch{return false;}}

/** Run ending and physical action ending are separate observations. */
export function endFoodRun(actor,run,reason){try{
  const s=state(actor,true);if(!s||!plain(run)||!reasons.has(reason))return false;
  let owner=runOwners.get(run);
  if(!owner){if(own(s.discovery,'run')!==run)return false;owner={actor,...identity(actor),ended:false};runOwners.set(run,owner);}
  if(owner.actor!==actor||!same(owner,s)||owner.ended)return false;
  owner.ended=true;bump(s,s.runEnds,reason);
  if(s.currentRun===run)s.currentRun=null;
  // A deadline may end the intention while its paid action still has a valid
  // terminal receipt. Keep that active witness until completion or loss.
  if(s.pending?.run===run&&!['admitted','normalized'].includes(s.pending.status))lose(s);
  return true;
}catch{return false;}}

function copy(s){return {version:1,limits:{...limit},stages:Object.fromEntries(FOOD_RUN_STAGES.map(k=>[k,{...s.stages[k],reach:{...s.stages[k].reach},
  rejectionReasons:{...s.stages[k].rejectionReasons},interruptionReasons:{...s.stages[k].interruptionReasons}}])),
  runEnds:{...s.runEnds},pending:{selected:Number(s.pending?.status==='selected'||s.pending?.status==='normalized'),
    active:Number(s.pending?.status==='admitted')},sessionResets:s.sessionResets,
  sessionLosses:s.sessionLosses,saturated:s.saturated};}
export function foodRunSnapshot(actor){try{
  const s=state(actor),id=identity(actor);
  if(s)return copy(s);
  const projected=fresh(id||{epoch:null,discovery:null,physiology:null}),stale=plain(actor)?states.get(actor):null;
  if(stale&&id&&!same(stale,id)){
    projected.sessionResets=Math.min(limit.counter,stale.sessionResets+1);
    projected.sessionLosses=Math.min(limit.counter,stale.sessionLosses+Number(Boolean(stale.pending)));
    projected.saturated=stale.saturated||projected.sessionResets>=limit.counter||
      projected.sessionLosses>=limit.counter;
  }
  return copy(projected);
}catch{return copy(fresh({epoch:null,discovery:null,physiology:null}));}}
export function disposeFoodRunObserver(actor){try{
  const s=state(actor,true);if(!s)return null;
  if(s.pending)lose(s);
  if(s.currentRun){const owner=runOwners.get(s.currentRun);if(owner&&!owner.ended){owner.ended=true;bump(s,s.runEnds,'identity-loss');}}
  s.currentRun=null;bump(s,s,'sessionResets');const summary=copy(s);states.delete(actor);return summary;
}catch{return null;}}
/** Test seam: disabling observation changes no agent state or randomness. */
export function setFoodRunObserverEnabled(actor,enabled){try{
  if(!plain(actor)||typeof enabled!=='boolean')return false;
  if(!enabled){disposeFoodRunObserver(actor);disabled.add(actor);}else disabled.delete(actor);
  return true;
}catch{return false;}}
