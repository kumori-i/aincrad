// A remembered place can motivate one optional walk, never a handling macro.
import {ozarkAgentWorld,ozarkPersistentWorldAgent} from './ozark-agent-world.js';
import {successfulDiscoveryActionCompletion} from './discovery-actions.js';
import {bodySignals} from './interoception.js';
const states=new WeakMap(),budgets=new WeakMap(),evidence=new WeakMap(),offers=new WeakMap(),requests=new WeakMap(),walks=new WeakMap(),issued=new WeakSet();
export const REVISIT_LIMITS=Object.freeze({places:16,admissions:16,age:300,cooldown:20,seconds:8,distance:480});
export const REVISIT_REASON='I handled something at this remembered place. I can walk part of the known route to look again; it may no longer be there.';
export function validRevisitSpent(value){return Array.isArray(value)&&value.length<=REVISIT_LIMITS.admissions&&new Set(value).size===value.length&&value.every(id=>typeof id==='string'&&/^object:[1-9][0-9]{0,8}$/.test(id));}
const primitives=new Set(['grasp','pull','strike','catch']);
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const same=(n,s)=>s&&s.id===n.id&&s.epoch===n.epoch&&s.memory===n.memory&&s.discovery===n.discovery&&s.physiology===n.physiology&&s.scene===n.scene&&s.world===ozarkAgentWorld(n)&&s.ecology===s.environment.ecology&&n.elapsed>=s.at;
function safe(n){const b=bodySignals(n);return n.lifecycle==='AWAKE'&&b.overall==='settled'&&!['full','overfull'].includes(b.digestion)&&!['winded','exhausted'].includes(b.stamina)&&!['weary','exhausted'].includes(b.fatigue)&&!['sleepy','struggling to stay awake','groggy'].includes(b.sleepiness)&&b.energy!=='depleted'&&b.pain==='none'&&!['hungry','ravenous','faint with hunger'].includes(b.hunger)&&b.thirst==='quenched'&&!['overheated','shivering','dangerously hot','dangerously cold'].includes(b.thermal);}
function state(n,environment){
 let s=states.get(n);if(!same(n,s)||environment&&s.environment!==environment){states.delete(n);s=null;}
 if(!s&&environment&&ozarkPersistentWorldAgent(n)){
  if(n.discovery.revisitSpent!==undefined&&!validRevisitSpent(n.discovery.revisitSpent))return null;
  if(!budgets.has(n))budgets.set(n,{used:new Set(n.discovery.revisitSpent||[]),lastAt:-Infinity});
  for(const id of n.discovery.revisitSpent||[])if(budgets.get(n).used.size<REVISIT_LIMITS.admissions)budgets.get(n).used.add(id);
  s={id:n.id,epoch:n.epoch,memory:n.memory,discovery:n.discovery,physiology:n.physiology,scene:n.scene,world:ozarkAgentWorld(n),environment,ecology:environment.ecology,at:n.elapsed,sights:new Map(),places:new Map(),budget:budgets.get(n)};states.set(n,s);
 }
 if(s){if(n.discovery.revisitSpent!==undefined&&!validRevisitSpent(n.discovery.revisitSpent))return null;for(const id of n.discovery.revisitSpent||[])if(s.budget.used.size<REVISIT_LIMITS.admissions)s.budget.used.add(id);}
 return s;
}
// The only identity lookup is supplied by actual ordinary perception, never by
// the remote-place chooser. Absence from sight is not evidence of destruction.
export function observeRevisit(n,observation,environment,lookup){
 const s=state(n,environment);if(!s)return;
 for(const o of observation.objects||[]){
  const identity=lookup(o.id),old=s.places.get(o.id);
  if(old&&(old.identity!==identity||identity?.heldBy!=null||distance(old.position,o.position)>1))old.phase='retired';
  s.sights.set(o.id,{identity,position:{...o.position},at:n.elapsed,owner:identity?.heldBy??null});
 }
 while(s.sights.size>128)s.sights.delete(s.sights.keys().next().value);
}
export function startRevisitEvidence(n,active,environment,physical){
 const s=state(n,environment),sight=s?.sights.get(active.request.targetId);
 if(!sight||!primitives.has(active.request.type)||sight.owner!==null||sight.identity!==physical||n.elapsed-sight.at>2||sight.at>n.elapsed)return;
 evidence.set(active,{n,s,identity:physical,id:active.request.targetId,position:{...sight.position},seenAt:sight.at});
}
export function finishRevisitEvidence(n,active,eventId){
 const p=evidence.get(active);evidence.delete(active);if(!p||p.n!==n||state(n)!==p.s)return;
 const proof=successfulDiscoveryActionCompletion(n,active),e=n.discovery.experiments.find(e=>e.actionId===eventId),receipt=n.memory.experience.find(e=>e.id===eventId);
 if(!proof||proof.eventId!==eventId||proof.targetId!==p.id||!(proof.worked>0)||!e||!receipt||!e.ok||e.targetId!==p.id||e.primitive!==proof.type||receipt.type!=='action'||receipt.details?.action?.targetId!==p.id||receipt.details?.action?.type!==proof.type||receipt.details?.result?.ok!==true||receipt.details.result.code!==e.code)return;
 const latest=p.s.sights.get(p.id);if(!latest||latest.identity!==p.identity||distance(latest.position,p.position)>1||latest.owner!==null)return;
 // No renewal by subsequent handling. Detail eviction never removes used IDs.
 if(p.s.places.has(p.id)||p.s.budget.used.has(p.id))return;
 p.s.places.set(p.id,{...p,experiment:e,receipt,at:n.elapsed,phase:'ready',experimentBytes:JSON.stringify(e),receiptBytes:JSON.stringify(receipt)});
 while(p.s.places.size>REVISIT_LIMITS.places)p.s.places.delete(p.s.places.keys().next().value);
}
function proofIntact(n,p){return n.discovery.experiments.includes(p.experiment)&&n.memory.experience.includes(p.receipt)&&JSON.stringify(p.experiment)===p.experimentBytes&&JSON.stringify(p.receipt)===p.receiptBytes;}
export function revisitChoice(n,{route,routeLength}){
 const s=state(n);if(!s||n.active||!safe(n)||s.budget.used.size>=REVISIT_LIMITS.admissions||n.elapsed-s.budget.lastAt<REVISIT_LIMITS.cooldown)return null;
 let best=null;
 for(const p of s.places.values()){
  const seen=s.sights.get(p.id),age=n.elapsed-p.at,d=distance(n.position,p.position);
  if(n.inventory.items.includes(p.id)||p.phase!=='ready'||s.budget.used.has(p.id)||age<REVISIT_LIMITS.cooldown||age>REVISIT_LIMITS.age||n.elapsed-(seen?.at??p.seenAt)<8||d<=80||d>900||!proofIntact(n,p))continue;
  const action=route(p.position);if(!action||action.type!=='move')continue;
  const length=routeLength(action.target);if(!Number.isFinite(length)||length<=0||length>REVISIT_LIMITS.distance)continue;
  // Supplied curiosity prior for this unanswered, one-use place question.
  // Prior handling earns the association; it is not reward or repeat credit.
  const score=5-(d+length)/1500;
  if(!best||score>best.score){best={action,score,reason:REVISIT_REASON};offers.set(action,{n,s,p,target:{...action.target},at:n.elapsed,length,origin:{...n.position}});}
 }return best;
}
export function issueRevisit(n,action){
 const o=offers.get(action);if(!o||o.n!==n||state(n)!==o.s||o.p.phase!=='ready'||n.elapsed<o.at||n.elapsed-o.at>1||!safe(n)||!proofIntact(n,o.p)||o.s.budget.used.has(o.p.id)||o.s.budget.used.size>=REVISIT_LIMITS.admissions)return false;
 offers.delete(action);o.p.phase='issued';requests.set(action,o);issued.add(action);return true;
}
export function forwardRevisit(n,raw,normalized){
 const o=requests.get(raw);if(!o){if(issued.has(raw)&&normalized&&typeof normalized==='object')issued.add(normalized);return;}requests.delete(raw);
 if(normalized&&typeof normalized==='object')issued.add(normalized);
 if(o.n===n&&normalized?.type==='move'&&normalized.target?.x===o.target.x&&normalized.target?.y===o.target.y){requests.set(normalized,o);issued.add(normalized);}else o.p.phase='retired';
}
// Recognition survives consumption. Exact replay must not silently become an
// unguarded ordinary move; independently authored moves remain ordinary moves.
export function consumeRevisit(n,raw){
 const o=requests.get(raw);requests.delete(raw);
 if(!o)return issued.has(raw)?{valid:false}:null;
 // A recognizable owner dispatch is spent even if its evidence/scope/time has
 // expired. Cross-actor reuse cannot write either actor's exclusions.
 if(o.n!==n||o.s.id!==n.id||budgets.get(n)!==o.s.budget||!n.discovery||n.discovery.revisitSpent!==undefined&&!validRevisitSpent(n.discovery.revisitSpent)){o.p.phase='retired';return {valid:false};}
 const current=state(n),budget=o.s.budget;
 for(const id of n.discovery.revisitSpent||[])if(budget.used.size<REVISIT_LIMITS.admissions)budget.used.add(id);
 if(budget.used.has(o.p.id)||budget.used.size>=REVISIT_LIMITS.admissions){o.p.phase='retired';return {valid:false};}
 o.valid=current===o.s&&o.p.phase==='issued'&&n.elapsed>=o.at&&n.elapsed-o.at<=1&&n.elapsed-budget.lastAt>=REVISIT_LIMITS.cooldown&&proofIntact(n,o.p);
 o.p.phase=o.valid?'unavailable':'retired';budget.used.add(o.p.id);n.discovery.revisitSpent=[...budget.used];budget.lastAt=n.elapsed;return o;
}
export function validRevisit(n,o,request,environment){return !o||o.valid&&o.p.phase==='unavailable'&&o.n===n&&state(n)===o.s&&o.s.environment===environment&&safe(n)&&proofIntact(n,o.p)&&n.elapsed>=o.at&&n.elapsed-o.at<=1&&distance(n.position,o.origin)<1e-8&&request?.type==='move'&&request.target?.x===o.target.x&&request.target?.y===o.target.y;}
export function revisitRouteValid(n,o,route){return !o||route.reduce((sum,p,i)=>sum+distance(i?route[i-1]:n.position,p),0)<=REVISIT_LIMITS.distance;}
export function bindRevisit(n,o,active){if(!o)return;o.p.phase='walking';o.startedAt=n.elapsed;walks.set(active,o);active.expiresAt=Math.min(active.expiresAt,n.elapsed+REVISIT_LIMITS.seconds);}
export function revisitActiveValid(n,active,environment){const o=walks.get(active);return !o||o.n===n&&state(n)===o.s&&environment===o.s.environment&&safe(n)&&proofIntact(n,o.p)&&o.p.phase==='walking'&&active.request.type==='move'&&active.request.target?.x===o.target.x&&active.request.target?.y===o.target.y&&active.travelled<=REVISIT_LIMITS.distance&&n.elapsed>=o.startedAt&&n.elapsed<=o.startedAt+REVISIT_LIMITS.seconds;}
export function finishRevisit(n,active,result){const o=walks.get(active);if(o?.n===n){o.p.phase=result.ok?'walk-complete':'unavailable';walks.delete(active);}}
export function revisitStatus(n){const s=states.get(n);if(!same(n,s))return null;return structuredClone({admissions:s.budget.used.size,places:[...s.places.values()].map(p=>({sourceId:p.id,position:p.position,seenAt:p.seenAt,at:p.at,actionId:p.receipt.id,phase:p.phase}))});}
