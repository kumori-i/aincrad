// A bounded question about one's own producing action, never a source-benefit
// fact or a clean procedure/cost prefix. No state or authority survives reload.
import { takeProducerActionWitness } from './discovery-actions.js';
import { procedureFeedbackWitness } from './biology.js';
import { ozarkAgentWorld,ozarkPersistentWorldAgent } from './ozark-agent-world.js';
import { DISCOVERY_RULES } from './discovery-config.js';
import { priorAdverseSource } from './observational-learning.js';
const states=new WeakMap(),requests=new WeakMap(),permits=new WeakMap(),actions=new WeakMap();
const LIMIT=16,ADMISSIONS=64;
export const PRODUCER_QUESTION='Pulling this source produced a piece whose later sample brought relief. Could a new piece do so?';
const bounded=map=>{while(map.size>LIMIT)map.delete(map.keys().next().value);};
function same(n,s){return s&&s.id===n.id&&s.epoch===n.epoch&&s.memory===n.memory&&s.discovery===n.discovery&&s.physiology===n.physiology&&s.scene===n.scene&&s.world===ozarkAgentWorld(n)&&s.environment.ecology===s.ecology&&n.elapsed>=s.at;}
function state(n,environment){let s=states.get(n);if(s&&(!same(n,s)||environment&&environment!==s.environment)){states.delete(n);s=null;}if(!s&&environment&&ozarkPersistentWorldAgent(n)){s={id:n.id,epoch:n.epoch,memory:n.memory,discovery:n.discovery,physiology:n.physiology,scene:n.scene,world:ozarkAgentWorld(n),environment,ecology:environment.ecology,at:n.elapsed,origins:new Map(),pending:new Map(),resolved:new Map(),admitted:new Set(),questions:new Map()};states.set(n,s);}if(s){s.at=n.elapsed;for(const [id,o]of s.origins)if(n.elapsed-o.at>300)s.origins.delete(id);for(const [id,p]of s.pending)if(n.elapsed-p.at>300)s.pending.delete(id);}return s;}
export function retireProducerHistory(n){states.delete(n);}
export function retireProducerCustody(n,id){const s=state(n);if(!s)return;s.origins.delete(id);for(const map of [s.pending,s.resolved])for(const [k,p]of map)if(p.materialId===id)map.delete(k);for(const q of s.questions.values())if(q.materialId===id||q.priorMaterialId===id)q.phase='retired';}
export function retireObservedProducerSource(n,id,identity,environment){const s=state(n);if(!s||s.environment!==environment||!identity)return;for(const [k,o]of s.origins)if(o.sourceId===id&&o.sourceIdentity!==identity||k===id&&o.materialIdentity!==identity)s.origins.delete(k);for(const q of s.questions.values())if(q.sourceId===id&&q.sourceIdentity!==identity||q.materialId===id&&q.materialIdentity!==identity||q.priorMaterialId===id&&q.priorMaterialIdentity!==identity)q.phase='retired';for(const map of [s.pending,s.resolved])for(const [k,p]of map)if(p.origin.sourceId===id&&p.origin.sourceIdentity!==identity||p.materialId===id&&p.origin.materialIdentity!==identity)map.delete(k);}
// Selection consumes the trial before dispatch. Rejection cannot preserve a
// reusable permit. Only the original request object can bind a real action.
export function forwardProducerRequest(n,raw,normalized){const own=requests.get(raw);if(!own)return;requests.delete(raw);const expected=own.phase==='pull-issued'?{type:'pull',targetId:own.q.sourceId}:{type:'sample',targetId:own.q.materialId};if(own.n===n&&state(n)===own.s&&raw.type===expected.type&&raw.targetId===expected.targetId&&normalized?.type===expected.type&&normalized.targetId===expected.targetId)requests.set(normalized,own);else own.q.phase='unavailable';}
export function consumeProducerRequest(n,raw){const own=requests.get(raw);requests.delete(raw);if(!own)return null;const s=state(n);if(s!==own.s||own.n!==n||own.q.phase!==own.phase||n.elapsed>=own.q.deadline)return null;own.q.phase='unavailable';const token=Object.freeze({});permits.set(token,own);return token;}
export function bindProducerAction(n,token,active){const own=permits.get(token);permits.delete(token);if(!own||own.n!==n||state(n)!==own.s||n.elapsed>=own.q.deadline||active.request.type!==(own.phase==='pull-issued'?'pull':'sample')||active.request.targetId!==(own.phase==='pull-issued'?own.q.sourceId:own.q.materialId))return Infinity;own.q.phase=own.phase==='pull-issued'?'pulling':'sampling';actions.set(active,own);return own.q.deadline;}
export function receiveProducerAction(n,token){
 const p=takeProducerActionWitness(n,token);if(!p)return;const s=state(n,p.environment);if(!s)return;
 const own=actions.get(p.active);actions.delete(p.active);
 if(!own)for(const q of s.questions.values())if(['ready','pull-issued'].includes(q.phase)&&p.type==='pull'&&p.targetId===q.sourceId||['sample-ready','sample-issued'].includes(q.phase)&&p.type==='sample'&&p.targetId===q.materialId)q.phase='unavailable';
 if(own?.s===s){const q=own.q;if(n.elapsed>q.deadline||!p.ok||p.uncertain||p.identityChanged||p.sharing)q.phase='retired';else if(q.phase==='pulling'&&p.type==='pull'&&p.targetId===q.sourceId&&p.sourceIdentity===q.sourceIdentity&&p.materialId&&p.materialIdentity){q.materialId=p.materialId;q.materialIdentity=p.materialIdentity;q.phase='sample-ready';}else if(q.phase==='sampling'&&p.type==='sample'&&p.targetId===q.materialId&&p.sourceIdentity===q.materialIdentity&&p.ingestion){q.ingestion=p.ingestion;q.phase='waiting';}else q.phase='retired';}
 if(p.sharing||p.identityChanged){retireProducerCustody(n,p.targetId);return;}
 // Release may retain an uncertain production association, but never the
 // custody/continuation permission of a newly selected inquiry.
 if(p.type==='release'){for(const q of s.questions.values())if(q.materialId===p.targetId)q.phase='retired';return;}
 if(!p.ok||p.uncertain){if(p.type==='sample')s.origins.delete(p.targetId);return;}
 if(p.type==='pull'&&p.materialId&&p.materialIdentity&&p.sourceIdentity){s.origins.set(p.materialId,{sourceId:p.targetId,sourceIdentity:p.sourceIdentity,materialIdentity:p.materialIdentity,at:p.at});bounded(s.origins);}
 if(p.type==='sample'&&p.ingestion){const origin=s.origins.get(p.targetId);if(origin&&origin.materialIdentity===p.sourceIdentity){s.pending.set(p.ingestion,{origin,materialId:p.targetId,at:p.at});bounded(s.pending);}}
}
export function reassessProducerInquiries(n){const s=state(n);if(!s)return;for(const event of n.physiology.feedback||[]){const proof=procedureFeedbackWitness(n,event);if(!proof)continue;for(const q of s.questions.values())if((q.ingestion===proof.identity||q.motivation===proof.identity||q.priorMaterialId===proof.objectId||q.materialId===proof.objectId)&&proof.effect==='discomfort')q.phase='retired';const p=s.pending.get(proof.identity)||s.resolved.get(proof.identity);if(!p||p.materialId!==proof.objectId||proof.at<p.at)continue;if(proof.effect==='discomfort'){s.origins.delete(p.materialId);if(s.admitted.size<ADMISSIONS)s.admitted.add(p.origin.sourceId);for(const q of s.questions.values())if(q.sourceId===p.origin.sourceId)q.phase='retired';s.pending.delete(proof.identity);s.resolved.delete(proof.identity);continue;}if(!['sustained','no noticeable change'].includes(proof.effect))continue;s.pending.delete(proof.identity);s.resolved.set(proof.identity,p);bounded(s.resolved);if(proof.effect!=='sustained'||proof.energy!=='easing'||proof.pain!=='none'||s.admitted.has(p.origin.sourceId)||s.admitted.size>=ADMISSIONS)continue;s.admitted.add(p.origin.sourceId);s.questions.set(p.origin.sourceId,{sourceId:p.origin.sourceId,sourceIdentity:p.origin.sourceIdentity,priorMaterialId:p.materialId,priorMaterialIdentity:p.origin.materialIdentity,motivation:proof.identity,at:n.elapsed,deadline:n.elapsed+90,phase:'ready'});bounded(s.questions);}
 for(const q of s.questions.values()){if(q.phase==='waiting'){const effect=(n.physiology.feedback||[]).map(e=>procedureFeedbackWitness(n,e)).find(p=>p?.identity===q.ingestion&&['sustained','discomfort','no noticeable change'].includes(p.effect));if(effect)q.phase=effect.effect==='discomfort'?'retired':'complete';}if(n.elapsed>=q.deadline&&!['waiting','complete','retired'].includes(q.phase))q.phase='retired';}
}
export function producerExperiment(n,{body,local,eligible,blocked}){
 reassessProducerInquiries(n);const s=state(n);if(!s)return null;
 if(n.lifecycle!=='AWAKE'||n.active||['full','overfull'].includes(body.digestion)||['winded','exhausted'].includes(body.stamina)||['weary','exhausted'].includes(body.fatigue)||['sleepy','struggling to stay awake'].includes(body.sleepiness)||body.energy==='depleted'||['aching','hurting','severe'].includes(body.pain)||['ravenous','faint with hunger'].includes(body.hunger)||['parched','desperate thirst'].includes(body.thirst)||body.thermal.startsWith('dangerously')||['overheated','shivering'].includes(body.thermal))return null;
 for(const q of s.questions.values()){
  if(priorAdverseSource(n.discovery,q.sourceId)||priorAdverseSource(n.discovery,q.priorMaterialId)){q.phase='retired';continue;}
  if(q.phase==='ready'&&n.discovery.techniques.some(t=>t.sourceId===q.sourceId&&t.steps[0]?.type==='pull'&&t.confidence!=='revised')){q.phase='retired';continue;}
  let request;if(q.phase==='ready'){if(n.inventory.items.length>=DISCOVERY_RULES.capacity||!local(q.sourceId)||blocked('pull',q.sourceId))continue;request={type:'pull',targetId:q.sourceId};q.phase='pull-issued';}
  else if(q.phase==='sample-ready'){if(!n.inventory.items.includes(q.materialId)){q.phase='retired';continue;}if(!eligible(q.materialId)||blocked('sample',q.materialId))continue;request={type:'sample',targetId:q.materialId};q.phase='sample-issued';}
  if(request){requests.set(request,{n,s,q,phase:q.phase});return request;}
 }
 return null;
}
export function producerInquiryStatus(n){const s=states.get(n);if(!same(n,s))return null;return Object.freeze({admissions:s.admitted.size,origins:s.origins.size,pending:s.pending.size,questions:Object.freeze([...s.questions.values()].map(q=>Object.freeze({sourceId:q.sourceId,priorMaterialId:q.priorMaterialId,materialId:q.materialId??null,at:q.at,deadline:q.deadline,phase:q.phase})))});}
