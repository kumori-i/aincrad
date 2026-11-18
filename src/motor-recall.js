// Supplied exact-source motor retrieval scaffold, not food knowledge or a planner.
// Only live paid actuator witnesses establish a method; saved rows are inert.
import {takeMotorRecallWitness} from './discovery-actions.js';
import {ozarkAgentWorld,ozarkPersistentWorldAgent} from './ozark-agent-world.js';
import {bodySignals} from './interoception.js';
import {DISCOVERY_RULES} from './discovery-config.js';
import {HANDLING_ADMISSION_LIMIT,HANDLING_QUESTION_LIMIT} from './handling-inquiry.js';
import {priorAdverseSource} from './observational-learning.js';
const budgets=new WeakMap(),states=new WeakMap(),requests=new WeakMap(),permits=new WeakMap(),actions=new WeakMap();
const failures=new Set(['object_still_attached','object_too_heavy','object_resists_grasp']);
export const MOTOR_RECALL_REASON='Grasping did not acquire this source. My own earlier pull detached a piece here. I can try that operation once more; the result is uncertain.';
const bounded=map=>{while(map.size>HANDLING_QUESTION_LIMIT)map.delete(map.keys().next().value);};
const safeBody=body=>!(['full','overfull'].includes(body.digestion)||['winded','exhausted'].includes(body.stamina)||['weary','exhausted'].includes(body.fatigue)||['sleepy','struggling to stay awake'].includes(body.sleepiness)||body.energy==='depleted'||['aching','hurting','severe'].includes(body.pain)||['ravenous','faint with hunger'].includes(body.hunger)||['parched','desperate thirst'].includes(body.thirst)||body.thermal.startsWith('dangerously')||['overheated','shivering'].includes(body.thermal));
const same=(n,s)=>s&&s.id===n.id&&s.epoch===n.epoch&&s.memory===n.memory&&s.discovery===n.discovery&&s.physiology===n.physiology&&s.scene===n.scene&&s.world===ozarkAgentWorld(n)&&s.environment.ecology===s.ecology&&n.elapsed>=s.at;
function state(n,environment){let s=states.get(n);if(s&&(!same(n,s)||environment&&s.environment!==environment)){states.delete(n);s=null;}if(!s&&environment&&ozarkPersistentWorldAgent(n)){if(!budgets.has(n))budgets.set(n,new Set());s={id:n.id,epoch:n.epoch,memory:n.memory,discovery:n.discovery,physiology:n.physiology,scene:n.scene,world:ozarkAgentWorld(n),environment,ecology:environment.ecology,at:n.elapsed,methods:new Map(),admitted:budgets.get(n),questions:new Map()};states.set(n,s);}if(s)s.at=n.elapsed;return s;}
export function retireMotorRecallHistory(n){states.delete(n);}
export function retireMotorRecallSource(n,id){const s=state(n);if(!s)return;s.methods.delete(id);const q=s.questions.get(id);if(q)q.phase='retired';}
export function observeMotorRecallSource(n,id,identity,environment){const s=state(n);if(!s||s.environment!==environment)return;const m=s.methods.get(id),q=s.questions.get(id);if(m&&m.identity!==identity||q&&q.identity!==identity)retireMotorRecallSource(n,id);}
export function receiveMotorRecallWitness(n,token){
 const p=takeMotorRecallWitness(n,token);if(!p)return;const s=state(n,p.environment);if(!s)return;
 const own=actions.get(p.active);actions.delete(p.active);
 if(own)own.q.phase=p.ok&&!p.uncertain&&!p.identityChanged&&!p.sharing&&p.sourceIdentity===own.q.identity&&p.code==='piece_detached'&&p.materialId&&p.materialIdentity?'detached':'unavailable';
 if(p.sharing||p.identityChanged){retireMotorRecallSource(n,p.targetId);return;}
 if(p.type==='pull'){
  const q=s.questions.get(p.targetId);if(q&&!own&&['ready','issued'].includes(q.phase))q.phase='retired';
  // Any later contradictory/interrupted pull revokes old consequence retrieval.
  if(!p.ok||p.uncertain||p.code!=='piece_detached'||!p.materialId||!p.materialIdentity||p.materialId===p.targetId){s.methods.delete(p.targetId);return;}
  s.methods.set(p.targetId,{identity:p.sourceIdentity,at:p.at});bounded(s.methods);return;
 }
 if(p.type!=='grasp'||p.ok||p.uncertain||!failures.has(p.code)||!p.sourceIdentity||p.materialId||p.ingestion)return;
 const method=s.methods.get(p.targetId);
 if(!method||method.identity!==p.sourceIdentity||method.at>=p.at||p.at-method.at>300||s.admitted.has(p.targetId)||s.admitted.size>=HANDLING_ADMISSION_LIMIT)return;
 s.admitted.add(p.targetId);s.questions.set(p.targetId,{sourceId:p.targetId,identity:p.sourceIdentity,priorAt:method.at,at:p.at,deadline:p.at+300,phase:'ready'});bounded(s.questions);
}
export function motorRecallExperiment(n,{body,local,blocked}){
 const s=state(n);if(!s)return null;
 if(n.lifecycle!=='AWAKE'||n.active||n.inventory.items.length>=DISCOVERY_RULES.capacity||
 !safeBody(body))return null;
 for(const q of s.questions.values()){
  if(q.phase!=='ready')continue;
  if(n.elapsed>=q.deadline||priorAdverseSource(n.discovery,q.sourceId)){q.phase='retired';continue;}
  if(!local(q.sourceId)||n.inventory.items.includes(q.sourceId)||blocked('pull',q.sourceId))continue;
  q.phase='issued';const request={type:'pull',targetId:q.sourceId};requests.set(request,{n,s,q});return request;
 }
 return null;
}
export function forwardMotorRecallRequest(n,raw,normalized){const own=requests.get(raw);if(!own)return;requests.delete(raw);if(own.n===n&&state(n)===own.s&&raw.type==='pull'&&raw.targetId===own.q.sourceId&&normalized?.type==='pull'&&normalized.targetId===own.q.sourceId)requests.set(normalized,own);else own.q.phase='unavailable';}
export function consumeMotorRecallRequest(n,raw){const own=requests.get(raw);requests.delete(raw);if(!own)return null;const valid=own.n===n&&state(n)===own.s&&own.q.phase==='issued'&&n.elapsed<own.q.deadline&&raw.type==='pull'&&raw.targetId===own.q.sourceId;own.q.phase='unavailable';const permit=Object.freeze({});permits.set(permit,{...own,valid});return permit;}
export function motorRecallPermitValid(n,permit,physical,environment){if(!permit)return true;const own=permits.get(permit);return !!own&&own.valid&&own.n===n&&own.s.environment===environment&&n.lifecycle==='AWAKE'&&state(n)===own.s&&safeBody(bodySignals(n))&&n.elapsed<own.q.deadline&&physical===own.q.identity;}
export function motorRecallActiveValid(n,active,physical,environment){const own=actions.get(active);if(!own)return true;return own.n===n&&own.s.environment===environment&&n.lifecycle==='AWAKE'&&state(n)===own.s&&safeBody(bodySignals(n))&&n.elapsed<own.q.deadline&&active.request.type==='pull'&&active.request.targetId===own.q.sourceId&&physical()===own.q.identity;}
export function bindMotorRecallAction(n,permit,active,physical,environment){const own=permits.get(permit);permits.delete(permit);if(!own||!own.valid||own.n!==n||own.s.environment!==environment||state(n)!==own.s||physical!==own.q.identity||n.elapsed>=own.q.deadline||active.request.type!=='pull'||active.request.targetId!==own.q.sourceId)return Infinity;own.q.phase='pulling';actions.set(active,own);return own.q.deadline;}
// Detached read-only observer. Reading cannot expire, admit or consume anything.
export function motorRecallStatus(n){const s=states.get(n);if(!same(n,s))return null;return Object.freeze({admissions:s.admitted.size,methods:s.methods.size,questions:Object.freeze([...s.questions.values()].map(q=>Object.freeze({sourceId:q.sourceId,priorAt:q.priorAt,at:q.at,deadline:q.deadline,phase:q.phase})))});}
