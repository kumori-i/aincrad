import { NPC_RULES } from './config.js';
import { clamp } from './world.js';
import { planProofRetention, applyProofRetention } from './proof-retention.js';

// Ephemeral transaction state is never serialized and never allocates an event ID.
const transactions=new WeakMap();
export function proofRetentionDiagnostic(npc){return npc?.proofRetentionError||null;}
function retain(npc,stagingEventIds=[]){
  const plan=planProofRetention(npc,{stagingEventIds});
  if(!plan.ok){
    Object.defineProperty(npc,'proofRetentionError',{value:plan.reason||'INCOMPLETE_PROOF',enumerable:false,configurable:true});
    return false;
  }
  applyProofRetention(npc,plan);
  return true;
}
export function withProofTransaction(npc,operation){
  if(npc.mode!=='discovery')return operation();
  const existing=transactions.get(npc);
  if(existing)return operation();
  const transaction={eventIds:[]};transactions.set(npc,transaction);
  try{return operation();}
  finally{transactions.delete(npc);retain(npc,transaction.eventIds);}
}
export function compact(value,depth=0){
  if(depth>5)return null;
  if(typeof value==='string')return value.slice(0,600);
  if(typeof value==='number')return Number.isFinite(value)?clamp(value,-1e12,1e12):null;
  if(typeof value==='boolean'||value===null)return value;
  if(Array.isArray(value))return value.slice(0,24).map(v=>compact(v,depth+1));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!['__proto__','constructor','prototype'].includes(k)).slice(0,24).map(([k,v])=>[k.slice(0,60),compact(v,depth+1)]));
  return null;
}
function legacyRecordEvent(npc,type,details={}){
  const event={id:npc.memory.nextId++,at:npc.elapsed,type,details:compact(details)};
  npc.memory.experience.push(event);
  if(npc.memory.experience.length>NPC_RULES.maxExperience){
    // One actual rest outcome survives unrelated action/detail rotation. Keeping
    // a later success also prevents an older failure from resurfacing on reopen.
    const restOutcome=npc.mode==='discovery'?npc.memory.experience.filter(e=>e.type==='action'&&['rest','sleep'].includes(e.details.action?.type)).at(-1)?.id:null;
    const protectedIds=new Set([restOutcome,...npc.memory.skills.flatMap(s=>s.supportingExperience),...(npc.inventory?.apples||[]).map(a=>a.eventId),...(npc.discovery?.experiments||[]).map(e=>e.actionId),...(npc.discovery?.effects||[]).map(e=>e.proofEventId),npc.flask.fillEventId,...Object.keys(npc.memory.shelters||{}).map(id=>npc.memory.experience.filter(e=>e.details.action?.type==='enter_shelter'&&e.details.action.shelterId===id&&e.details.result?.ok).at(-1)?.id)].filter(Number.isInteger));
    const removable=npc.memory.experience.findIndex(e=>!protectedIds.has(e.id));
    npc.memory.experience.splice(removable<0?0:removable,1);
  }
  return event;
}

export function recordEvent(npc,type,details={}){
  if(npc.mode!=='discovery')return legacyRecordEvent(npc,type,details);
  const transaction=transactions.get(npc);
  // Normal completion may produce its action and one skill record. A callback
  // cannot grow a deferred event queue or consume an unbounded ID suffix.
  if(transaction&&transaction.eventIds.length>=2)throw new Error('PROOF_STAGING_LIMIT');
  const event={id:npc.memory.nextId++,at:npc.elapsed,type,details:compact(details)};
  npc.memory.experience.push(event);
  if(transaction)transaction.eventIds.push(event.id);
  else retain(npc,[event.id]);
  return event;
}
