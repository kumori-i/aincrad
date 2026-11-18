// Experimental next-relief-test preference. These private runtime witnesses are
// not saved, rewards, energy estimates or evidence of equal nutritional yield.
import { takeProcedureActionWitness } from './discovery-actions.js';
import { takeProcedureMovementWitness } from './npc.js';
import { procedureFeedbackWitness } from './biology.js';
import { bodySignals } from './interoception.js';
import { ozarkAgentWorld, ozarkPersistentWorldAgent } from './ozark-agent-world.js';
import { DISCOVERY_RULES } from './discovery-config.js';
const states=new WeakMap();
// Opt-in observer sink. Policy never reads these snapshots or their contents.
const diagnosticObservers=new WeakSet(),diagnosticSnapshots=new WeakMap();
export function setProcedureDiagnostics(npc,enabled){
  if(enabled)diagnosticObservers.add(npc);else {diagnosticObservers.delete(npc);diagnosticSnapshots.delete(npc);}
}
export function procedureEligibilityDiagnostics(npc){
  const d=diagnosticSnapshots.get(npc);
  if(!d||d.id!==npc.id||d.scene!==npc.scene||d.memory!==npc.memory||d.world!==ozarkAgentWorld(npc)||npc.elapsed<d.at||d.discovery!==npc.discovery||d.physiology!==npc.physiology||d.epoch!==npc.epoch||d.state&&!same(npc,d.state))return null;
  return d.snapshot;
}
function diagnosticSink(npc,s,candidates){
  if(!diagnosticObservers.has(npc))return null;
  try {
    const gates=[];
    return {gate(index,reason,counts){try{if(counts?.firstUnreliable)Object.freeze(counts.firstUnreliable);gates.push(Object.freeze({index,reason,...counts}));}catch{}},finish(reason,prefixLength=0){try{
      const serial=(diagnosticSnapshots.get(npc)?.snapshot.serial??0)+1;
      diagnosticSnapshots.set(npc,{state:s,id:npc.id,scene:npc.scene,memory:npc.memory,world:ozarkAgentWorld(npc),at:npc.elapsed,discovery:npc.discovery,physiology:npc.physiology,epoch:npc.epoch,
        snapshot:Object.freeze({serial,at:npc.elapsed,candidateCount:candidates.length,prefixLength,reason,
          evaluation:'Only reached gates are recorded; all absent downstream gates and later candidates were not evaluated.',gates:Object.freeze(gates)})});
    }catch{}}};
  }catch{return null;}
}
const median=values=>{const sorted=[...values].sort((a,b)=>a-b),i=Math.floor(sorted.length/2);return sorted.length%2?sorted[i]:(sorted[i-1]+sorted[i])/2;};
const key=(source,type)=>`${source}|${type}`;
// Planned walking context, not incidental 'awake' versus 'walking' activity.
// Only qualitative signals already available to the actor are compared.
export function procedureWalkingContext(npc){
  const b=bodySignals(npc),slow=['winded','exhausted'].includes(b.stamina)||b.fatigue==='exhausted'||b.energy==='depleted'||b.sleepiness==='groggy';
  return `walk:${slow?'slowed':'ordinary'}:${b.wetness}`;
}
function same(n,s){return s&&s.id===n.id&&s.epoch===n.epoch&&s.scene===n.scene&&s.memory===n.memory&&s.discovery===n.discovery&&s.physiology===n.physiology&&s.world===ozarkAgentWorld(n)&&s.environment.ecology===s.ecology&&n.elapsed>=s.at;}
function state(n,environment){
  let s=states.get(n);
  if(s&&(!same(n,s)||environment&&s.environment!==environment)){states.delete(n);s=null;}
  if(!s&&environment&&ozarkPersistentWorldAgent(n)){s={id:n.id,epoch:n.epoch,scene:n.scene,memory:n.memory,discovery:n.discovery,physiology:n.physiology,world:ozarkAgentWorld(n),environment,ecology:environment.ecology,at:n.elapsed,movement:[],motor:new Map(),acquired:new Map(),pending:new Map(),resolved:new Map(),methods:new Map(),intent:null,lastChoice:null};states.set(n,s);}
  if(s)s.at=n.elapsed;return s;
}
function bounded(map,limit){while(map.size>limit)map.delete(map.keys().next().value);}
// Scope loss only revokes private authority; it never supplies an outcome.
export function retireProcedureHistory(npc){states.delete(npc);diagnosticSnapshots.delete(npc);}
export function receiveProcedureMovement(npc,token){
  const p=takeProcedureMovementWitness(npc,token);if(!p)return;
  const s=state(npc,p.environment);if(!s)return;
  for(const a of s.acquired.values())a.uncertain=true; // Interposed travel is not this held-item minimal prefix.
  // Failures and paid zero-progress are NOT dropped to create an optimistic
  // pace. They mark the forecast unknown until ordinary bounded forgetting.
  s.movement.push(Object.freeze({seconds:p.seconds,propelled:p.propelled,context:p.context,uncertain:!p.ok||p.contextChanged||!(p.propelled>0)}));s.movement=s.movement.slice(-8);
  if(s.intent&&p.run===s.intent.run){s.intent.spent+=p.seconds;s.intent.phase='reassess';}
}
// Revocation grants no learning authority. Call only after actual physical
// custody changes; a failed sharing attempt leaves the donor evidence intact.
export function retireProcedureCustody(npc,materialId){
  const s=state(npc);if(!s)return;
  s.acquired.delete(materialId);
  for(const [id,pending] of s.pending)if(pending.materialId===materialId)s.pending.delete(id);
}
// Only negative lifecycle reconciliation. The caller uses current actual
// sensory observations, never an all-world existence probe during selection.
export function retireObservedProcedureSource(npc,objectId,physicalIdentity,environment){
  const s=state(npc);if(!s||!physicalIdentity||s.environment!==environment)return;
  const changedSource=p=>p.sourceId===objectId&&p.sourceIdentity!==physicalIdentity;
  const changedMaterial=(p,id)=>id===objectId&&p.materialIdentity!==physicalIdentity;
  const retired=new Set();
  for(const [k,method] of s.methods){
    if(k.startsWith(`${objectId}|`)&&method.sourceIdentity!==physicalIdentity||method.episodes.some(e=>e.materialId===objectId&&e.material!==physicalIdentity)){s.methods.delete(k);retired.add(k);}
  }
  for(const [id,acquisition] of s.acquired)if(changedSource(acquisition)||changedMaterial(acquisition,id)){s.acquired.delete(id);retired.add(acquisition.key);}
  for(const [id,pending] of s.pending)if(changedSource(pending)||changedMaterial(pending,pending.materialId)){s.pending.delete(id);retired.add(pending.key);}
  for(const [id,resolved] of s.resolved)if(retired.has(resolved.key)||resolved.episode.materialId===objectId&&resolved.episode.material!==physicalIdentity)s.resolved.delete(id);
  if(s.intent&&retired.has(s.intent.key))s.intent.phase='yield';
}
export function receiveProcedureAction(npc,token){
  const p=takeProcedureActionWitness(npc,token);if(!p)return;
  const s=state(npc,p.environment);if(!s)return;
  if(s.intent&&p.run===s.intent.run){s.intent.spent+=p.seconds;s.intent.phase=p.ok?'reassess':'interrupted';}
  if(!p.sharing&&!p.identityChanged){const k=key(p.motorContext,p.type),history=s.motor.get(k)||[];history.push(Object.freeze({seconds:p.seconds,effort:p.effort,uncertain:p.uncertain}));s.motor.set(k,history.slice(-8));bounded(s.motor,16);}
  if(p.sharing||p.identityChanged){s.acquired.delete(p.targetId);for(const [id,pending] of s.pending)if(pending.materialId===p.targetId)s.pending.delete(id);if(p.identityChanged){s.methods.delete(key(p.targetId,'pull'));s.methods.delete(key(p.targetId,'grasp'));}return;}
  if(p.type==='release'&&p.ok){s.acquired.delete(p.targetId);for(const [id,pending] of s.pending)if(pending.materialId===p.targetId)s.pending.delete(id);return;}
  if(p.type==='sample'&&(!p.ok||p.uncertain)){const a=s.acquired.get(p.targetId);if(a)a.uncertain=true;return;}
  if(['pull','grasp'].includes(p.type)&&p.ok&&!p.uncertain&&p.materialId&&!p.sharing&&p.materialIdentity){
    const k=key(p.targetId,p.type),old=s.methods.get(k);
    if(old&&old.sourceIdentity!==p.sourceIdentity)s.methods.delete(k);
    s.acquired.set(p.materialId,{key:k,sourceId:p.targetId,type:p.type,sourceIdentity:p.sourceIdentity,materialIdentity:p.materialIdentity,acquisition:token,seconds:p.seconds,at:p.at,needs:p.needs,effort:p.effort});bounded(s.acquired,16);return;
  }
  if(p.type!=='sample'||!p.ok||!p.ingestion){const a=s.acquired.get(p.targetId);if(a)a.uncertain=true;return;}
  const a=s.acquired.get(p.targetId);s.acquired.delete(p.targetId);
  if(!a||a.materialIdentity!==p.sourceIdentity)return;
  s.pending.set(p.ingestion,{...a,seconds:a.seconds+p.seconds,effort:a.effort==='rising'||p.effort==='rising'?'rising':'steady',sampledAt:p.at,phase:'await',materialId:p.targetId});bounded(s.pending,4);
  if(s.intent?.key===a.key){s.intent.phase='await';s.intent.ingestion=p.ingestion;}
}
export function reassessProcedureOutcomes(npc){
  const s=state(npc);if(!s)return;
  for(const event of npc.physiology.feedback||[]){
    const proof=procedureFeedbackWitness(npc,event),resolved=proof&&s.resolved.get(proof.identity);
    if(resolved&&proof.effect==='discomfort'){
      const method=s.methods.get(resolved.key),i=method?.episodes.indexOf(resolved.episode)??-1;
      if(i>=0)method.episodes[i]=Object.freeze({...resolved.episode,effect:'discomfort',pain:proof.pain});
      s.resolved.delete(proof.identity);
    }
    const p=proof&&s.pending.get(proof.identity);
    if(!p||proof.objectId!==p.materialId||proof.at<p.sampledAt)continue;
    if(!['sustained','discomfort','no noticeable change'].includes(proof.effect))continue;
    s.pending.delete(proof.identity);
    const old=s.methods.get(p.key),method=old?.sourceIdentity===p.sourceIdentity?old:{sourceIdentity:p.sourceIdentity,episodes:[]};
    const episode=Object.freeze({acquisition:p.acquisition,material:p.materialIdentity,materialId:p.materialId,seconds:p.seconds,uncertain:p.uncertain,needs:p.needs,effort:p.effort,delay:proof.at-p.sampledAt,effect:proof.effect,hunger:proof.hunger,energy:proof.energy,pain:proof.pain});method.episodes.push(episode);
    s.resolved.set(proof.identity,{key:p.key,episode});bounded(s.resolved,16);method.episodes=method.episodes.slice(-4);
    s.methods.set(p.key,method);bounded(s.methods,16);
    if(s.intent?.ingestion===proof.identity)s.intent.phase='resolved';
  }
  if(s.intent&&s.intent.phase!=='await'&&s.intent.phase!=='resolved'&&npc.discovery.run!==s.intent.run)s.intent.phase='yield';
}
export function intendProcedure(npc,run){
  const s=state(npc),t=npc.discovery.techniques.find(t=>t.id===run?.techniqueId);if(!s||!run||!t)return;
  if(s.intent?.run===run)return;
  s.intent={run,key:key(t.sourceId,t.steps[0]?.type),startedAt:run.startedAt,deadline:run.startedAt+90,spent:0,phase:'execute'};
}
function quote(npc,s,t,routeLength,diagnostics,index){
  const details={sourceId:t.sourceId,primitive:t.steps[0]?.type};
  const fail=(reason,counts)=>{diagnostics?.gate(index,reason,{...details,...counts});return null;};
  const method=s.methods.get(key(t.sourceId,t.steps[0]?.type)),episodes=method?.episodes;
  if(!episodes)return fail('outcome-missing');
  if(episodes.length<2)return fail('outcome-not-repeated',{episodes:episodes.length});
  const unreliable=episodes.find(e=>e.uncertain||e.effect!=='sustained'||e.energy!=='easing'||e.pain!=='none');
  if(unreliable)return fail('outcome-unreliable',{episodes:episodes.length,firstUnreliable:{uncertain:!!unreliable.uncertain,effect:unreliable.effect,energy:unreliable.energy,pain:unreliable.pain}});
  const body=bodySignals(npc),relevant=episodes.every(e=>body.energy!=='steady'?e.energy==='easing':body.hunger!=='content'&&e.hunger==='easing');
  if(!relevant)return fail('body-not-relevant');
  const acquire=s.motor.get(key(procedureWalkingContext(npc),t.steps[0]?.type)),sample=s.motor.get(key(procedureWalkingContext(npc),'sample'));
  if(!acquire||!sample)return fail('motor-context-missing');
  if(acquire.length<2||sample.length<2)return fail('motor-not-repeated',{acquire:acquire.length,sample:sample.length});
  if([...acquire,...sample].some(m=>m.uncertain))return fail('motor-unreliable',{acquire:acquire.length,sample:sample.length});
  const handling=median(acquire.map(m=>m.seconds))+median(sample.map(m=>m.seconds));
  const length=routeLength(t);if(!Number.isFinite(length)||length<0)return fail('route-unavailable');
  const movement=s.movement.filter(m=>m.context===procedureWalkingContext(npc));
  if(length>0&&!movement.length)return fail('movement-context-missing');
  if(length>0&&movement.some(m=>m.uncertain))return fail('movement-unreliable',{movement:movement.length});
  diagnostics?.gate(index,'quoted',details);
  const approach=length?length*median(movement.map(m=>m.seconds/m.propelled)):0;
  return Object.freeze({sourceId:t.sourceId,handling,approach,seconds:approach+handling,routeLength:length,effort:[...acquire,...sample].some(m=>m.effort==='rising')?'rising':'steady',unknownResidual:true});
}
/** Stable known prefix only. A missing component is a barrier, not permission
 * to leapfrog unknown methods. No RNG, deadlines, eligibility or care edits. */
export function orderProcedureCandidates(npc,candidates,routeLength){
  reassessProcedureOutcomes(npc);const s=state(npc);
  const diagnostics=diagnosticSink(npc,s,candidates);
  if(!s){diagnostics?.finish('no-state');return candidates;}
  if(candidates.length<2){diagnostics?.finish('less-than-two');return candidates;}
  if(npc.inventory.items.length>=DISCOVERY_RULES.capacity){diagnostics?.finish('full-capacity');return candidates;}
  const prefix=[],failures=candidates[0].failures;
  for(const technique of candidates){
    if(technique.failures!==failures){diagnostics?.gate(prefix.length,'failure-barrier');break;}
    const estimate=quote(npc,s,technique,routeLength,diagnostics,prefix.length);if(!estimate)break;
    if(prefix.length&&prefix[0].estimate.effort!==estimate.effort){diagnostics?.gate(prefix.length,'effort-barrier');break;}
    prefix.push({technique,estimate});
  }
  const sorted=[...prefix].sort((a,b)=>a.estimate.seconds-b.estimate.seconds);
  s.lastChoice=Object.freeze({at:npc.elapsed,before:Object.freeze(prefix.map(x=>x.technique.sourceId)),after:Object.freeze(sorted.map(x=>x.technique.sourceId)),quotes:Object.freeze(prefix.map(x=>x.estimate))});
  diagnostics?.finish(sorted.length<2?'insufficient-known-prefix':'ordered-known-prefix',prefix.length);
  return sorted.length<2?candidates:[...sorted.map(x=>x.technique),...candidates.slice(sorted.length)];
}
// Read-only diagnostic copies, never issuer authority or policy inputs.
export function procedureCycleStatus(npc){const s=states.get(npc);if(!same(npc,s))return null;return Object.freeze({methods:s.methods.size,pending:s.pending.size,movement:s.movement.length,intent:s.intent?Object.freeze({phase:s.intent.phase,deadline:s.intent.deadline,spent:s.intent.spent}):null,choice:s.lastChoice});}
