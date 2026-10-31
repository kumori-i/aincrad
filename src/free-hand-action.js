// A target-free, physically paid motor experiment. Its public trace is a pose,
// never a request, object pointer, reference permit, or communicative reward.
import { fundNpcEffort, npcWorkAllowance } from './npc-effort-funding.js';
import { bodySignals } from './interoception.js';
import { isSleeping, exertPhysiology } from './biology.js';
import { ozarkPersistentWorldAgent } from './ozark-agent-world.js';

export const FREE_HAND_RULES=Object.freeze({seconds:1.8,effort:.25,length:24,
  cooldownSeconds:120,curiosityScore:2.5});
const actions=new WeakMap(),currentActions=new WeakMap(),settled=new WeakSet(),
  ticking=new WeakSet(),sessions=new WeakMap(),histories=new WeakMap();
const boundedAdd=n=>Math.min(Number.MAX_SAFE_INTEGER,n+1);
const INTERRUPT_CODES=Object.freeze(['PRIORITY_CHANGED','ACTION_TIMEOUT',
  'CONTACT_ESCAPE','REFERENCE_INTERRUPTED']);
const blankLifecycle=()=>({admitted:0,firstPaid:0,certifiedPaidSeconds:0,
  completed:0,rejectedAfterSelection:{ACTION_BUSY:0,PRIORITY_CHANGED:0},
  interrupted:{PRIORITY_CHANGED:0,ACTION_TIMEOUT:0,CONTACT_ESCAPE:0,
    REFERENCE_INTERRUPTED:0,OTHER:0},unavailable:0,ownPoseSamples:0});
const copyLifecycle=life=>({...life,rejectedAfterSelection:{...life.rejectedAfterSelection},
  interrupted:{...life.interrupted}});
function history(npc){
  let h=histories.get(npc);
  if(!h){
    h={epoch:npc.epoch,discovery:npc.discovery,physiology:npc.physiology,
      decisionChecks:0,sessionResets:0,sessionCreated:false,saturated:false};
    histories.set(npc,h);
  }else if(h.epoch!==npc.epoch||h.discovery!==npc.discovery||
      h.physiology!==npc.physiology){
    // Observer checks belong to the current individual. A later real motor
    // session, if any, separately records the session reset.
    h.epoch=npc.epoch;h.discovery=npc.discovery;h.physiology=npc.physiology;
    h.decisionChecks=0;
  }
  return h;
}
const bumpHistory=(h,key)=>{
  h[key]=boundedAdd(h[key]);
  if(h[key]===Number.MAX_SAFE_INTEGER)h.saturated=true;
};
const bump=(session,key)=>{
  session[key]=boundedAdd(session[key]);
  if(session[key]===Number.MAX_SAFE_INTEGER)session.history.saturated=true;
};
const bumpLife=(s,key)=>{
  s.lifecycle[key]=boundedAdd(s.lifecycle[key]);
  if(s.lifecycle[key]===Number.MAX_SAFE_INTEGER)s.history.saturated=true;
};
const bumpLifeCode=(s,group,code)=>{
  const slot=s.lifecycle[group];slot[code]=boundedAdd(slot[code]);
  if(slot[code]===Number.MAX_SAFE_INTEGER)s.history.saturated=true;
};
const addPaid=(s,seconds)=>{
  s.lifecycle.certifiedPaidSeconds=Math.min(Number.MAX_SAFE_INTEGER,
    s.lifecycle.certifiedPaidSeconds+seconds);
  if(s.lifecycle.certifiedPaidSeconds===Number.MAX_SAFE_INTEGER)s.history.saturated=true;
};

function session(npc){
  const prior=sessions.get(npc);
  if(prior&&prior.epoch===npc.epoch&&prior.discovery===npc.discovery&&
    prior.physiology===npc.physiology)return prior;
  const h=history(npc);
  if(h.sessionCreated)bumpHistory(h,'sessionResets');
  else h.sessionCreated=true;
  const next={epoch:npc.epoch,discovery:npc.discovery,physiology:npc.physiology,
    readyAt:npc.elapsed+FREE_HAND_RULES.cooldownSeconds,attempts:0,
    eligibleDecisions:0,selectedAttempts:0,visibleSamples:0,
    sampleCounts:{unknown:0,absent:0,pose:0},lifecycle:blankLifecycle(),
    lastRecordedAt:-Infinity,history:h};
  sessions.set(npc,next);return next;
}

/** Starting or reopening an individual gives the motor experiment a fresh
 * delay. This is session-only scheduling; no motor authority is serialized. */
export function initializeFreeHandSession(npc){
  if(!npc||!Number.isFinite(npc.elapsed))throw new TypeError('Expected actor time');
  session(npc);
}
export function disposeFreeHandSession(npc){
  const active=currentActions.get(npc);
  if(active){noteFreeHandTerminal(npc,active,null);settled.add(active);}
  currentActions.delete(npc);
  sessions.delete(npc);
  const h=histories.get(npc);
  if(h)h.decisionChecks=0;
}

/** The same qualitative body signals that can preempt a reference exchange
 * also protect this lower-priority optional movement. */
export function freeHandBodySafe(npc){
  if(npc?.lifecycle!=='AWAKE'||isSleeping(npc))return false;
  const b=bodySignals(npc);
  return b.overall!=='urgent'&&b.overall!=='unconscious'&&
    !['ravenous','faint with hunger'].includes(b.hunger)&&
    !['parched','desperate thirst'].includes(b.thirst)&&
    b.energy!=='depleted'&&b.pain!=='severe'&&
    !['sleepy','struggling to stay awake'].includes(b.sleepiness)&&
    !['winded','exhausted'].includes(b.stamina);
}

/** An authored curiosity candidate, evaluated only after ordinary care and
 * reference opportunities. No extra RNG draw or learned reward selects it. */
export function freeHandExplorationChoice(npc){
  if(!ozarkPersistentWorldAgent(npc))return null;
  bumpHistory(history(npc),'decisionChecks');
  if(npc.mode!=='discovery'||npc.active||
    !freeHandBodySafe(npc))return null;
  const s=session(npc);
  if(npc.elapsed+1e-8<s.readyAt)return null;
  bump(s,'eligibleDecisions');
  return {action:{type:'free_hand'},score:FREE_HAND_RULES.curiosityScore/(1+s.attempts),
    reason:'I can try a small movement of my own hand and observe what happens.'};
}

function ownerIntact(npc,w){
  return !!w&&w.actor===npc&&w.epoch===npc.epoch&&
    w.discovery===npc.discovery&&w.physiology===npc.physiology;
}
/** One observer-only terminal witness. A changed owner or lost action is
 * unknown, never a completed movement or a fabricated interruption receipt. */
function noteFreeHandTerminal(npc,active,result){
  const w=active&&actions.get(active);
  if(!w||w.actor!==npc||w.observerTerminal)return false;
  w.observerTerminal=true;
  const s=w.observerSession;
  if(!ownerIntact(npc,w)||currentActions.get(npc)!==active||
    active.request!==w.request||!result||typeof result!=='object'){
    bumpLife(s,'unavailable');return true;
  }
  if(result.ok===true&&result.code==='FREE_HAND_MOVED'&&
    w.worked+1e-8>=FREE_HAND_RULES.seconds){bumpLife(s,'completed');return true;}
  if(result.ok===false){
    bumpLifeCode(s,'interrupted',INTERRUPT_CODES.includes(result.code)?result.code:'OTHER');
    return true;
  }
  bumpLife(s,'unavailable');return true;
}
function valid(npc,active,w){
  return ownerIntact(npc,w)&&npc.active===active&&currentActions.get(npc)===active&&
    active?.kind==='free-hand'&&active.request===w.request&&
    active.seconds===FREE_HAND_RULES.seconds&&
    w.scene===npc.scene&&npc.position?.x===w.origin.x&&npc.position?.y===w.origin.y&&
    npc.lifecycle==='AWAKE'&&!isSleeping(npc)&&!settled.has(active);
}

/** Own efference is available before payment, but only for the private current
 * action; a copied command or a changed individual cannot supply it. */
export function recognizedFreeHandAction(npc){
  const active=npc?.active,w=active&&actions.get(active);
  return ownerIntact(npc,w)&&currentActions.get(npc)===active&&
    active.request===w.request&&!settled.has(active);
}
export function ownFreeHandAction(npc){
  const active=npc?.active;
  return !!active&&valid(npc,active,actions.get(active));
}

/** Rendering and sensing consume this identical funded world-space segment. */
export function publicFreeHandGeometry(npc){
  const active=npc?.active,w=active&&actions.get(active);
  if(!valid(npc,active,w)||!(w.worked>0))return null;
  return Object.freeze({scene:w.scene,
    origin:Object.freeze({x:w.origin.x,y:w.origin.y}),
    tip:Object.freeze({x:w.origin.x,y:w.origin.y-FREE_HAND_RULES.length}),
    progress:Math.min(1,w.worked/FREE_HAND_RULES.seconds)});
}

export function freeHandPaidSeconds(npc,active){
  const w=active&&actions.get(active);
  return w?.actor===npc?w.worked:0;
}
export function retireFreeHandAction(npc,active,result=null){
  if(actions.get(active)?.actor===npc){noteFreeHandTerminal(npc,active,result);settled.add(active);}
  const current=currentActions.get(npc);
  if(current){noteFreeHandTerminal(npc,current,current===active?result:null);
    settled.add(current);currentActions.delete(npc);}
}

/** A valid selection spends its rate budget before physical admission. */
export function requestFreeHandAction(npc,raw){
  if(!raw||typeof raw!=='object'||Object.keys(raw).length!==1||raw.type!=='free_hand'||
    !ozarkPersistentWorldAgent(npc)||npc.mode!=='discovery')return {ok:false,code:'INVALID_FREE_HAND'};
  const s=session(npc);
  if(npc.elapsed+1e-8<s.readyAt)return {ok:false,code:'FREE_HAND_COOLDOWN'};
  s.readyAt=npc.elapsed+FREE_HAND_RULES.cooldownSeconds;
  bump(s,'attempts');
  bump(s,'selectedAttempts');
  if(npc.active){bumpLifeCode(s,'rejectedAfterSelection','ACTION_BUSY');
    return {ok:false,code:'ACTION_BUSY'};}
  if(!freeHandBodySafe(npc)){bumpLifeCode(s,'rejectedAfterSelection','PRIORITY_CHANGED');
    return {ok:false,code:'PRIORITY_CHANGED'};}
  const request=Object.freeze({type:'free_hand'});
  const active={kind:'free-hand',request,startedAt:npc.elapsed,
    expiresAt:npc.elapsed+npcWorkAllowance(FREE_HAND_RULES.seconds,FREE_HAND_RULES.effort),
    seconds:FREE_HAND_RULES.seconds,worked:0,startPosition:{...npc.position},
    startScene:npc.scene,startRisk:npc.riskCost||0};
  npc.active=active;
  currentActions.set(npc,active);
  actions.set(active,{actor:npc,epoch:npc.epoch,discovery:npc.discovery,
    physiology:npc.physiology,scene:npc.scene,origin:{...npc.position},
    startedAt:npc.elapsed,deadline:active.expiresAt,elapsed:0,worked:0,request,
    observerSession:s,observerTerminal:false});
  bumpLife(s,'admitted');
  return {ok:true,code:'ACTION_STARTED'};
}

/** One ordinary funded slice. No raw action counters or elapsed time certify
 * work, and a synchronous cancellation cannot credit its unreturned slice. */
export function tickFreeHandAction(npc,dt,{complete,exert=exertPhysiology}={}){
  const active=npc?.active;
  if(active?.kind!=='free-hand'||!Number.isFinite(dt)||dt<=0)return false;
  const w=actions.get(active);
  if(!w||w.actor!==npc){
    const prior=currentActions.get(npc);
    if(prior){noteFreeHandTerminal(npc,prior,null);
      settled.add(prior);currentActions.delete(npc);}
    if(npc.active===active)npc.active=null;return false;
  }
  if(ticking.has(active))return false;
  if(settled.has(active)){
    noteFreeHandTerminal(npc,active,null);
    if(currentActions.get(npc)===active)currentActions.delete(npc);
    if(npc.active===active)npc.active=null;return false;
  }
  ticking.add(active);
  try{
    // A replacement individual cannot inherit even an interrupted outcome
    // from a predecessor's private physical witness.
    if(!ownerIntact(npc,w)){
      noteFreeHandTerminal(npc,active,null);
      settled.add(active);currentActions.delete(npc);
      if(npc.active===active)npc.active=null;return true;
    }
    if(!recognizedFreeHandAction(npc)){
      noteFreeHandTerminal(npc,active,null);
      settled.add(active);currentActions.delete(npc);npc.active=null;return true;
    }
    const end=(ok,code)=>{
      noteFreeHandTerminal(npc,active,{ok,code});
      settled.add(active);
      if(npc.active===active)complete?.(npc,w.request,{ok,code,durationSeconds:w.worked});
      return true;
    };
    if(!valid(npc,active,w)||!freeHandBodySafe(npc))return end(false,'PRIORITY_CHANGED');
    const elapsedBefore=Math.max(w.elapsed,Math.max(0,npc.elapsed-w.startedAt-dt));
    w.elapsed=Math.max(w.elapsed+dt,npc.elapsed-w.startedAt);
    const remaining=Math.max(0,w.deadline-w.startedAt-elapsedBefore);
    const requested=Math.min(dt,remaining,Math.max(0,FREE_HAND_RULES.seconds-w.worked));
    let paid;
    try{paid=fundNpcEffort(npc,requested,FREE_HAND_RULES.effort,exert).paidSeconds;}
    catch(error){noteFreeHandTerminal(npc,active,null);settled.add(active);throw error;}
    if(npc.active!==active||settled.has(active)){
      // A reentrant hook may replace the command without using the normal
      // cancellation helper. Its unreturned slice cannot certify progress,
      // and the old private witness must never be reattached later.
      noteFreeHandTerminal(npc,active,null);
      settled.add(active);
      if(currentActions.get(npc)===active)currentActions.delete(npc);
      return true;
    }
    if(!ownerIntact(npc,w)){
      noteFreeHandTerminal(npc,active,null);
      settled.add(active);currentActions.delete(npc);npc.active=null;return true;
    }
    if(!recognizedFreeHandAction(npc)){
      noteFreeHandTerminal(npc,active,null);
      settled.add(active);currentActions.delete(npc);npc.active=null;return true;
    }
    if(!valid(npc,active,w))return end(false,'PRIORITY_CHANGED');
    const firstPaid=w.worked===0&&paid>0;
    w.worked+=paid;active.worked=w.worked;
    if(firstPaid)bumpLife(w.observerSession,'firstPaid');
    if(paid>0)addPaid(w.observerSession,paid);
    if(!freeHandBodySafe(npc))return end(false,'PRIORITY_CHANGED');
    if(w.worked+1e-8>=FREE_HAND_RULES.seconds)return end(true,'FREE_HAND_MOVED');
    if(w.elapsed+1e-9>=w.deadline-w.startedAt)return end(false,'ACTION_TIMEOUT');
    return true;
  }finally{ticking.delete(active);}
}

/** Called only after the actor-local memory accepted one new sensor row.
 * These observer counts never participate in policy, reward or prediction. */
export function noteFreeHandRecordedSample(observer,peer,sample){
  if(!['unknown','absent','pose'].includes(sample?.visibility)||
    sample.at!==observer?.elapsed)return false;
  const s=session(observer);
  if(sample.at<=s.lastRecordedAt)return false;
  s.lastRecordedAt=sample.at;
  const kind=sample.visibility;
  s.sampleCounts[kind]=boundedAdd(s.sampleCounts[kind]);
  if(s.sampleCounts[kind]===Number.MAX_SAFE_INTEGER)s.history.saturated=true;
  const own=observer?.active,w=own&&actions.get(own);
  if(sample.self?.freeHandPose&&ownerIntact(observer,w)&&
    currentActions.get(observer)===own&&!settled.has(own)&&w.worked>0)
    bumpLife(s,'ownPoseSamples');
  if(kind==='pose'&&publicFreeHandGeometry(peer)){bump(s,'visibleSamples');return true;}
  return false;
}
export function readFreeHandObserver(npc){
  const s=sessions.get(npc),history=histories.get(npc);
  const currentHistory=history&&history.epoch===npc?.epoch&&
    history.discovery===npc?.discovery&&history.physiology===npc?.physiology;
  const decisionChecks=currentHistory?history.decisionChecks:0;
  if(!s||s.epoch!==npc.epoch||s.discovery!==npc.discovery||
    s.physiology!==npc.physiology)return {decisionChecks,eligibleDecisions:0,
      selectedAttempts:0,visibleSamples:0,sampleCounts:{unknown:0,absent:0,pose:0},
      lifecycle:{...blankLifecycle(),pending:0},
      sessionResets:history?.sessionResets??0,saturated:history?.saturated??false,
      nextEligibleAt:null};
  const active=currentActions.get(npc),w=active&&actions.get(active);
  const pending=Number(ownerIntact(npc,w)&&npc.active===active&&
    !settled.has(active)&&!w.observerTerminal);
  return {decisionChecks,eligibleDecisions:s.eligibleDecisions,
    selectedAttempts:s.selectedAttempts,visibleSamples:s.visibleSamples,
    sampleCounts:{...s.sampleCounts},lifecycle:{...copyLifecycle(s.lifecycle),pending},
    sessionResets:s.history.sessionResets,
    saturated:s.history.saturated,nextEligibleAt:s.readyAt};
}
