// A target-free, physically paid motor experiment. Its public trace is a pose,
// never a request, object pointer, reference permit, or communicative reward.
import { fundNpcEffort, npcWorkAllowance } from './npc-effort-funding.js';
import { bodySignals } from './interoception.js';
import { isSleeping, exertPhysiology } from './biology.js';
import { ozarkPersistentWorldAgent } from './ozark-agent-world.js';

export const FREE_HAND_RULES=Object.freeze({seconds:1.8,effort:.25,length:24,
  cooldownSeconds:120,curiosityScore:2.5});
const actions=new WeakMap(),currentActions=new WeakMap(),settled=new WeakSet(),
  ticking=new WeakSet(),sessions=new WeakMap();
const boundedAdd=n=>Math.min(Number.MAX_SAFE_INTEGER,n+1);

function session(npc){
  const prior=sessions.get(npc);
  if(prior&&prior.epoch===npc.epoch&&prior.discovery===npc.discovery&&
    prior.physiology===npc.physiology)return prior;
  const next={epoch:npc.epoch,discovery:npc.discovery,physiology:npc.physiology,
    readyAt:npc.elapsed+FREE_HAND_RULES.cooldownSeconds,attempts:0,
    eligibleDecisions:0,selectedAttempts:0,visibleSamples:0,lastVisibleAt:-Infinity};
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
  if(active)settled.add(active);
  currentActions.delete(npc);
  sessions.delete(npc);
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
  if(!ozarkPersistentWorldAgent(npc)||npc.mode!=='discovery'||npc.active||
    !freeHandBodySafe(npc))return null;
  const s=session(npc);
  if(npc.elapsed+1e-8<s.readyAt)return null;
  s.eligibleDecisions=boundedAdd(s.eligibleDecisions);
  return {action:{type:'free_hand'},score:FREE_HAND_RULES.curiosityScore/(1+s.attempts),
    reason:'I can try a small movement of my own hand and observe what happens.'};
}

function ownerIntact(npc,w){
  return !!w&&w.actor===npc&&w.epoch===npc.epoch&&
    w.discovery===npc.discovery&&w.physiology===npc.physiology;
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
export function retireFreeHandAction(npc,active){
  if(actions.get(active)?.actor===npc)settled.add(active);
  const current=currentActions.get(npc);
  if(current){settled.add(current);currentActions.delete(npc);}
}

/** A valid selection spends its rate budget before physical admission. */
export function requestFreeHandAction(npc,raw){
  if(!raw||typeof raw!=='object'||Object.keys(raw).length!==1||raw.type!=='free_hand'||
    !ozarkPersistentWorldAgent(npc)||npc.mode!=='discovery')return {ok:false,code:'INVALID_FREE_HAND'};
  const s=session(npc);
  if(npc.elapsed+1e-8<s.readyAt)return {ok:false,code:'FREE_HAND_COOLDOWN'};
  s.readyAt=npc.elapsed+FREE_HAND_RULES.cooldownSeconds;
  s.attempts=boundedAdd(s.attempts);
  s.selectedAttempts=boundedAdd(s.selectedAttempts);
  if(npc.active)return {ok:false,code:'ACTION_BUSY'};
  if(!freeHandBodySafe(npc))return {ok:false,code:'PRIORITY_CHANGED'};
  const request=Object.freeze({type:'free_hand'});
  const active={kind:'free-hand',request,startedAt:npc.elapsed,
    expiresAt:npc.elapsed+npcWorkAllowance(FREE_HAND_RULES.seconds,FREE_HAND_RULES.effort),
    seconds:FREE_HAND_RULES.seconds,worked:0,startPosition:{...npc.position},
    startScene:npc.scene,startRisk:npc.riskCost||0};
  npc.active=active;
  currentActions.set(npc,active);
  actions.set(active,{actor:npc,epoch:npc.epoch,discovery:npc.discovery,
    physiology:npc.physiology,scene:npc.scene,origin:{...npc.position},
    startedAt:npc.elapsed,deadline:active.expiresAt,elapsed:0,worked:0,request});
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
    if(prior){settled.add(prior);currentActions.delete(npc);}
    if(npc.active===active)npc.active=null;return false;
  }
  if(ticking.has(active))return false;
  if(settled.has(active)){
    if(currentActions.get(npc)===active)currentActions.delete(npc);
    if(npc.active===active)npc.active=null;return false;
  }
  ticking.add(active);
  try{
    // A replacement individual cannot inherit even an interrupted outcome
    // from a predecessor's private physical witness.
    if(!ownerIntact(npc,w)){
      settled.add(active);currentActions.delete(npc);
      if(npc.active===active)npc.active=null;return true;
    }
    if(!recognizedFreeHandAction(npc)){
      settled.add(active);currentActions.delete(npc);npc.active=null;return true;
    }
    const end=(ok,code)=>{
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
    catch(error){settled.add(active);throw error;}
    if(npc.active!==active||settled.has(active)){
      // A reentrant hook may replace the command without using the normal
      // cancellation helper. Its unreturned slice cannot certify progress,
      // and the old private witness must never be reattached later.
      settled.add(active);
      if(currentActions.get(npc)===active)currentActions.delete(npc);
      return true;
    }
    if(!ownerIntact(npc,w)){
      settled.add(active);currentActions.delete(npc);npc.active=null;return true;
    }
    if(!recognizedFreeHandAction(npc)){
      settled.add(active);currentActions.delete(npc);npc.active=null;return true;
    }
    if(!valid(npc,active,w))return end(false,'PRIORITY_CHANGED');
    w.worked+=paid;active.worked=w.worked;
    if(!freeHandBodySafe(npc))return end(false,'PRIORITY_CHANGED');
    if(w.worked+1e-8>=FREE_HAND_RULES.seconds)return end(true,'FREE_HAND_MOVED');
    if(w.elapsed+1e-9>=w.deadline-w.startedAt)return end(false,'ACTION_TIMEOUT');
    return true;
  }finally{ticking.delete(active);}
}

/** Observer-only sampled counts. They never participate in admission, policy,
 * rewards or prediction; repeated reads do not count observations. */
export function noteFreeHandVisibleSample(observer,peer,sample){
  if(sample?.visibility!=='pose'||sample.at!==observer?.elapsed||
    !publicFreeHandGeometry(peer))return false;
  const s=session(observer);
  if(sample.at<=s.lastVisibleAt)return false;
  s.lastVisibleAt=sample.at;s.visibleSamples=boundedAdd(s.visibleSamples);return true;
}
export function readFreeHandObserver(npc){
  const s=sessions.get(npc);
  if(!s||s.epoch!==npc.epoch||s.discovery!==npc.discovery||
    s.physiology!==npc.physiology)return {eligibleDecisions:0,selectedAttempts:0,
      visibleSamples:0,nextEligibleAt:null};
  return {eligibleDecisions:s.eligibleDecisions,selectedAttempts:s.selectedAttempts,
    visibleSamples:s.visibleSamples,nextEligibleAt:s.readyAt};
}
