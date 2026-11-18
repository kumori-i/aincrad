// New reconstruction: own paid A -> actual fresh output -> paid B.
// Exact persistent-source feasibility only, not utility, food or a hunting plan.
import {takeConnectedSequenceWitness} from './discovery-actions.js';
import {ozarkAgentWorld,ozarkPersistentWorldAgent} from './ozark-agent-world.js';
import {bodySignals} from './interoception.js';
import {procedureWalkingContext} from './procedure-cycle.js';
import {describeEcologyObject} from './ecology.js';
const states=new WeakMap(),budgets=new WeakMap(),requests=new WeakMap(),permits=new WeakMap(),actions=new WeakMap();
const followups=new Set(['grasp','pull','strike','release']);
export const CONNECTED_SEQUENCE_REASON='My own earlier handling of a new piece from this same source had a physical result. I can test that next operation again; usefulness is unknown.';
function safe(n){
 const b=bodySignals(n);
 return n.lifecycle==='AWAKE'&&!['full','overfull'].includes(b.digestion)&&!['winded','exhausted'].includes(b.stamina)&&!['weary','exhausted'].includes(b.fatigue)&&!['sleepy','struggling to stay awake'].includes(b.sleepiness)&&b.energy!=='depleted'&&!['aching','hurting','severe'].includes(b.pain)&&!['ravenous','faint with hunger'].includes(b.hunger)&&!['parched','desperate thirst'].includes(b.thirst)&&!['overheated','shivering','dangerously hot','dangerously cold'].includes(b.thermal);
}
const same=(n,s)=>s&&s.id===n.id&&s.epoch===n.epoch&&s.memory===n.memory&&s.discovery===n.discovery&&s.physiology===n.physiology&&s.scene===n.scene&&s.world===ozarkAgentWorld(n)&&s.environment.ecology===s.ecology&&n.elapsed>=s.at;
function state(n,environment){
 let s=states.get(n);
 if(s&&(!same(n,s)||environment&&environment!==s.environment)){states.delete(n);s=null;}
 if(!s&&environment&&ozarkPersistentWorldAgent(n)){
  if(!budgets.has(n))budgets.set(n,new Set());
  s={id:n.id,epoch:n.epoch,memory:n.memory,discovery:n.discovery,physiology:n.physiology,scene:n.scene,world:ozarkAgentWorld(n),environment,ecology:environment.ecology,at:n.elapsed,methods:new Map(),pending:null,question:null,admitted:budgets.get(n)};
  states.set(n,s);
 }
 if(s)s.at=n.elapsed;return s;
}
const key=p=>JSON.stringify([p.sourceId,p.primitive,p.code,p.outputKind]);
const cues=o=>o?JSON.stringify(o.appearance):null;
export function retireConnectedSequence(n){states.delete(n);}
export function interruptConnectedSequence(n){
 const s=state(n);if(!s)return;
 if(s.pending)s.pending.uncertain=true;
 if(s.question&&['ready','issued','working'].includes(s.question.phase))s.question.phase='retired';
}
// Negative evidence may revoke authority; it can never manufacture learning.
export function noteConnectedSequenceRequest(n,raw){
 const s=state(n);if(s?.pending&&(raw?.targetId!==s.pending.outputId||!followups.has(raw?.type)))interruptConnectedSequence(n);
}
export function observeConnectedSequence(n,id,physical,environment){
 const s=state(n);if(!s||s.environment!==environment)return;
 for(const[k,m]of s.methods)if(m.sourceId===id&&m.identity!==physical)s.methods.delete(k);
 if(s.pending&&(s.pending.sourceId===id&&s.pending.sourceIdentity!==physical||s.pending.outputId===id&&s.pending.outputIdentity!==physical))s.pending.uncertain=true;
 if(s.question&&(s.question.sourceId===id&&s.question.sourceIdentity!==physical||s.question.outputId===id&&s.question.outputIdentity!==physical))s.question.phase='retired';
}
export function receiveConnectedSequence(n,token){
 const p=takeConnectedSequenceWitness(n,token);if(!p)return;
 const s=state(n,p.environment);if(!s)return;
 const own=actions.get(p.active);actions.delete(p.active);
 if(own)own.q.phase=own.q.phase==='working'&&p.ok&&!p.uncertain&&!p.sharing&&!p.identityChanged?'completed':'unavailable';
 if(!own&&s.question&&['ready','issued'].includes(s.question.phase)&&p.targetId===s.question.outputId)s.question.phase='retired';
 const prior=s.pending;s.pending=null;
 if(prior){
  const k=key(prior),existing=s.methods.get(k);
  const matched=p.targetId===prior.outputId&&p.sourceIdentity===prior.outputIdentity&&followups.has(p.type);
  const episode=Object.freeze({outputId:prior.outputId,firstType:prior.primitive,firstCode:prior.code,firstAt:prior.at,nextAt:p.at,type:p.type,code:p.code,outputCues:prior.outputCues,context:prior.context,seconds:prior.seconds+p.seconds,firstEffort:prior.effort,nextEffort:p.effort,costCoverage:'A-and-next-handling-only',interposed:!!prior.uncertain,uncertain:!!prior.uncertain||!matched||!p.ok||p.uncertain||p.sharing||p.identityChanged||p.motorContext!==prior.context||p.sourceOwnerAtStart!==prior.owner||p.targetStartCues!==prior.outputCues||p.targetEndCues!==prior.outputCues||p.at>prior.at+30});
  const method=existing?.identity===prior.sourceIdentity?existing:{sourceId:prior.sourceId,identity:prior.sourceIdentity,episodes:[]};
  method.episodes.push(episode);method.episodes=method.episodes.slice(-4);s.methods.set(k,method);
  while(s.methods.size>16)s.methods.delete(s.methods.keys().next().value);
 }
 if(p.ok&&!p.uncertain&&!p.sharing&&!p.identityChanged&&p.outputId&&p.outputId!==p.targetId&&p.outputIdentity&&p.sourceSurvives){
  const pending={sourceId:p.targetId,sourceIdentity:p.sourceIdentity,primitive:p.type,code:p.code,outputKind:p.outputKind,outputId:p.outputId,outputIdentity:p.outputIdentity,outputCues:p.outputCues,owner:p.outputOwner,context:p.motorContext,at:p.at,seconds:p.seconds,effort:p.effort,uncertain:false};
  s.pending=pending;
  const m=s.methods.get(key(pending)),es=m?.identity===p.sourceIdentity?m.episodes:[];
  if(es.length>=2&&new Set(es.map(e=>e.outputId)).size>=2&&es.every(e=>!e.uncertain&&e.type===es[0].type&&e.code===es[0].code&&e.outputCues===pending.outputCues&&e.context===pending.context)&&!s.admitted.has(p.targetId)&&s.admitted.size<64){
   s.admitted.add(p.targetId);s.question={...pending,type:es[0].type,deadline:p.at+30,phase:'ready',episodes:es.length};
  }
 }
}
// Only an already eligible ordinary option may receive the supplied +1 bias.
export function preferConnectedSequence(n,choices){
 const s=state(n),q=s?.question;if(!q||q.phase!=='ready'||n.active||!safe(n))return null;
 if(n.elapsed>=q.deadline){q.phase='retired';return null;}
 if(cues(n.discovery.observations[q.outputId])!==q.outputCues||procedureWalkingContext(n)!==q.context)return null;
 return choices.find(c=>c.action.type===q.type&&c.action.targetId===q.outputId)||null;
}
export function issueConnectedSequence(n,candidate){
 const s=state(n),q=s?.question;
 if(!q||q.phase!=='ready'||!safe(n)||n.elapsed>=q.deadline||candidate.type!==q.type||candidate.targetId!==q.outputId||procedureWalkingContext(n)!==q.context||cues(n.discovery.observations[q.outputId])!==q.outputCues)return false;
 q.phase='issued';requests.set(candidate,{n,s,q});return true;
}
export function forwardConnectedSequence(n,raw,normalized){
 const own=requests.get(raw);if(!own)return;requests.delete(raw);
 if(own.n===n&&state(n)===own.s&&raw.type===own.q.type&&raw.targetId===own.q.outputId&&normalized?.type===raw.type&&normalized.targetId===raw.targetId)requests.set(normalized,own);else own.q.phase='unavailable';
}
export function consumeConnectedSequence(n,raw){
 const own=requests.get(raw);requests.delete(raw);if(!own)return null;
 const valid=own.n===n&&state(n)===own.s&&own.q.phase==='issued'&&raw.type===own.q.type&&raw.targetId===own.q.outputId;
 own.q.phase='unavailable';const permit=Object.freeze({});permits.set(permit,{...own,valid});return permit;
}
function valid(n,own,physical,source,environment){
 return own&&own.valid&&own.n===n&&state(n)===own.s&&own.s.environment===environment&&safe(n)&&n.elapsed<own.q.deadline&&physical===own.q.outputIdentity&&source===own.q.sourceIdentity&&physical.heldBy===own.q.owner&&procedureWalkingContext(n)===own.q.context&&cues(describeEcologyObject(environment.ecology,own.q.outputId,{actorId:n.id}))===own.q.outputCues;
}
export function connectedSequencePermitValid(n,permit,physical,source,environment){return !permit||!!valid(n,permits.get(permit),physical,source,environment);}
export function bindConnectedSequence(n,permit,active,physical,source,environment){
 const own=permits.get(permit);permits.delete(permit);if(!valid(n,own,physical,source,environment))return Infinity;
 own.q.phase='working';actions.set(active,own);return own.q.deadline;
}
export function connectedSequenceActiveValid(n,active,lookup,environment){
 const own=actions.get(active);return !own||own.q.phase==='working'&&!!valid(n,own,lookup(own.q.outputId),lookup(own.q.sourceId),environment)&&active.request.type===own.q.type&&active.request.targetId===own.q.outputId;
}
export function connectedSequenceSource(n,permit){return permits.get(permit)?.q.sourceId??null;}
// Detached pure reads: no expiry, RNG, admission or permission issuance.
export function connectedSequenceStatus(n){
 const s=states.get(n);if(!same(n,s))return null;
 return Object.freeze({admissions:s.admitted.size,methods:s.methods.size,episodes:Object.freeze([...s.methods.values()].flatMap(m=>m.episodes.map(e=>Object.freeze({...e,sourceId:m.sourceId})))),question:s.question?Object.freeze({sourceId:s.question.sourceId,outputId:s.question.outputId,type:s.question.type,phase:s.question.phase,at:s.question.at,deadline:s.question.deadline}):null});
}
