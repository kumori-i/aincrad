// Phase A: physical reference transactions, with NO associative learner or updates.
// One main-world optional channel; never owns the clock, population or bodily credit.
import { createIndicationPermit, discoveryActionCompletion, successfulDiscoveryActionCompletion, referenceGeometry } from './discovery-actions.js';
import { requestNpcIndication, cancelNpcAction } from './npc.js';
import { senseReferenceObjects, resolveIndication, visibleIndicationGeometry, observeIndication } from './visual-reference-perception.js';
import { actorLineOfSight } from './perception.js';
import { bodySignals } from './interoception.js';
import { isSleeping } from './biology.js';
import { CONFIG } from './config.js';

export const REFERENCE_LIMITS=Object.freeze({timeout:12,cooldown:12,featureDistance:.08,observationSeconds:.5,maxObservationStep:CONFIG.fixedStep,segmentLength:24,maxEvents:256});
// Observation occurs at the real step endpoint. Never backdate sight into a
// funded prefix: materially partial-funded steps cannot certify an interval.
function fullReferenceSample(at,paidSeconds,stepSeconds){return Number.isFinite(at)&&Number.isFinite(paidSeconds)&&Number.isFinite(stepSeconds)&&stepSeconds>0&&stepSeconds<=REFERENCE_LIMITS.maxObservationStep+1e-8&&Math.abs(stepSeconds-paidSeconds)<=1e-8;}
export function continuousReferenceStep(previousAt,at,paidSeconds,stepSeconds){
  const gap=at-previousAt;
  return fullReferenceSample(at,paidSeconds,stepSeconds)&&gap>0&&Math.abs(gap-stepSeconds)<=1e-8;
}
function stream(seed){let value=seed>>>0||1;return()=>{value^=value<<13;value^=value>>>17;value^=value<<5;return(value>>>0)/4294967296;};}
function rms(a,b){return Math.sqrt(a.reduce((s,x,i)=>s+(x-b[i])**2,0)/a.length);}
function awake(n){return n?.lifecycle==='AWAKE'&&!isSleeping(n);}
function urgent(n){const b=bodySignals(n);return ['ravenous','faint with hunger'].includes(b.hunger)||['parched','desperate thirst'].includes(b.thirst)||b.energy==='depleted'||b.pain==='severe';}
function identity(n){return {actor:n,epoch:n.epoch,discovery:n.discovery,physiology:n.physiology,position:{...n.position},scene:n.scene};}
function unchanged(n,w){return n===w.actor&&n.epoch===w.epoch&&n.discovery===w.discovery&&n.physiology===w.physiology&&n.scene===w.scene&&n.position.x===w.position.x&&n.position.y===w.position.y;}
function cropValid(c,n){return c&&c.epoch===n.epoch&&Number.isFinite(c.at)&&c.at<=n.elapsed&&n.elapsed-c.at<=1.1&&c.features?.length===48&&c.features.every(v=>Number.isFinite(v)&&v>=0&&v<=1)&&c.pixels?.length===768;}

export function attachVisualReferenceLearning({state,pixelSensor,seed=211}){
  if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw new TypeError('Expected uint32 seed');
  if(typeof pixelSensor?.capture!=='function')throw new TypeError('A live pixel sensor is required');
  const pairRandom=stream(seed^0x526e5),targetRandom=stream(seed^0x156a9),orderRandom=stream(seed^0x77112),choiceRandom=stream(seed^0x3986a),symbolRandom=stream(seed^0x991ba);
  const sessions=new Set(),busy=new Map(),cooldowns=new WeakMap(),actions=new WeakMap(),events=[],gates={};
  const metrics={exchanges:0,completed:0,observed:0,correct:0,censored:0,updates:0,positive:0,negative:0,relief:0,discomfort:0,effortExpiry:0};
  let disposed=false,nextId=1;
  const bump=(key)=>{gates[key]=Math.min(Number.MAX_SAFE_INTEGER,(gates[key]||0)+1);};
  function finish(t,status,reason){
    if(t.terminal)return;
    t.terminal=true;sessions.delete(t);busy.delete(t.sender);busy.delete(t.receiver);
    t.event.status=status;t.event.reason=reason;t.event.endedAt=state.elapsed;
    if(status==='observed'){metrics.completed++;metrics.observed++;if(t.selectedId===t.targetId)metrics.correct++;t.event.referenceCorrect=t.selectedId===t.targetId;t.event.demonstratedObjectId=t.observedId;}
    else{metrics.censored++;bump(`${t.stage}:${reason}`);}
    // Only this transaction's own authentic active commands can be cancelled.
    for(const [n,active]of [[t.receiver,t.choiceActive],[t.sender,t.indicationActive]])if(active&&n.active===active)cancelNpcAction(n,'REFERENCE_INTERRUPTED');
  }
  function current(t){
    if(!state.agents.includes(t.sender)||!state.agents.includes(t.receiver)||!unchanged(t.sender,t.senderIdentity)||!unchanged(t.receiver,t.receiverIdentity))return 'identity-or-position-changed';
    if(!awake(t.sender)||!awake(t.receiver))return 'not-awake';
    if(urgent(t.sender)||urgent(t.receiver))return 'body-priority';
    if(state.elapsed-t.startedAt>REFERENCE_LIMITS.timeout)return 'timeout';
    if(!actorLineOfSight(t.receiver,t.receiver.position,t.sender.position))return 'peer-occluded';
    for(const n of [t.sender,t.receiver]){
      const sensed=senseReferenceObjects(n,state);if(!sensed.complete)return 'incomplete-sight';
      for(const candidate of t.candidates){const at=sensed.bindings.indexOf(candidate.id),position=sensed.objects[at]?.position;if(!position||position.x!==candidate.position.x||position.y!==candidate.position.y)return 'candidate-changed';}
    }
    return null;
  }
  function maintain(){
    for(const t of [...sessions]){
      const invalid=current(t);if(invalid){finish(t,'censored',invalid);continue;}
      if(t.stage==='choice'&&t.choiceActive&&t.receiver.active!==t.choiceActive){
        const proof=discoveryActionCompletion(t.receiver,t.choiceActive);
        if(!proof){finish(t,'censored','choice-interrupted');continue;}
        const permit=createIndicationPermit(t.sender,t.receiver,t.choiceActive,t.targetId);
        if(!permit){finish(t,'censored','choice-not-canonical-success');continue;}
        t.permit=permit;t.stage='awaiting-indication';t.event.status=t.stage;t.event.selectedActionId=proof.eventId;
      }
      if(t.stage==='indicating'&&t.indicationActive&&t.sender.active!==t.indicationActive){
        const proof=successfulDiscoveryActionCompletion(t.sender,t.indicationActive);
        if(!proof||proof.type!=='indicate_object'||Math.abs(proof.worked-1.8)>1e-8){finish(t,'censored','indication-interrupted');continue;}
        t.event.indicationActionId=proof.eventId;
        if(t.contiguous+1e-8<REFERENCE_LIMITS.observationSeconds){finish(t,'censored','demonstration-not-observed');continue;}
        finish(t,'observed','visible-post-choice-demonstration');
      }
    }
  }
  function observePaid(t,{paidSeconds,stepSeconds,at}){
    if(t.terminal||t.stage!=='indicating'||!Number.isFinite(paidSeconds)||paidSeconds<=0)return;
    // One coarse tick or repeated callback is not sustained observation. The
    // main world's actual fixed step is 1/60 second. First sight is a baseline.
    const previousAt=t.lastPaidAt;
    const continuous=previousAt===undefined?fullReferenceSample(at,paidSeconds,stepSeconds):continuousReferenceStep(previousAt,at,paidSeconds,stepSeconds);
    t.lastPaidAt=at;
    if(!continuous){
      t.contiguous=0;t.event.observedSeconds=0;t.observedId=null;bump('observation:noncontiguous-step');return;
    }
    const invalid=current(t);if(invalid){t.contiguous=0;t.event.observedSeconds=0;finish(t,'censored',invalid);return;}
    const seen=observeIndication(t.receiver,t.sender,state);
    const id=seen?.objectId;
    const crop=id?pixelSensor.capture(t.receiver,state).get(id):null;
    if(!id||!cropValid(crop,t.receiver)){t.contiguous=0;t.event.observedSeconds=0;t.observedId=null;bump(`observation:${seen?.reason||'no-fresh-crop'}`);return;}
    if(t.observedId!==id||previousAt===undefined)t.contiguous=0;else t.contiguous+=paidSeconds;
    t.observedId=id;t.event.observedSeconds=t.contiguous;
    t.event.demonstrationPixels=crop.pixels.slice();t.event.demonstrationObservedAt=crop.at;
  }
  const hooks={
    optionalAction(receiver){
      if(disposed)return null;maintain();bump('optional');
      const existing=busy.get(receiver);
      if(existing){
        if(existing.sender===receiver&&existing.stage==='awaiting-indication'){
          const action=Object.freeze({type:'indicate_object'});actions.set(action,existing);existing.indicationRequest=action;return action;
        }
        bump('busy');return null;
      }
      if(!awake(receiver)||urgent(receiver)||receiver.active)return null;
      if(receiver.elapsed-(cooldowns.get(receiver)??-Infinity)<REFERENCE_LIMITS.cooldown){bump('cooldown');return null;}
      const sender=state.agents.find(n=>n!==receiver&&awake(n)&&!urgent(n)&&!n.active&&!busy.has(n)&&n.scene===receiver.scene&&Math.hypot(n.position.x-receiver.position.x,n.position.y-receiver.position.y)<=250&&actorLineOfSight(receiver,receiver.position,n.position));
      if(!sender){bump('no-peer');return null;}
      const own=senseReferenceObjects(receiver,state),other=senseReferenceObjects(sender,state);
      if(!own.complete||!other.complete){bump('incomplete-sight');return null;}
      const ownCrops=pixelSensor.capture(receiver,state),otherCrops=pixelSensor.capture(sender,state),candidates=[];
      for(let i=0;i<own.objects.length;i++){
        const id=own.bindings[i],j=other.bindings.indexOf(id),a=ownCrops.get(id),b=otherCrops.get(id);
        if(j<0||!cropValid(a,receiver)||!cropValid(b,sender))continue;
        const geometry=referenceGeometry(sender.position,own.objects[i].position,sender.scene,1);
        if(!geometry||!visibleIndicationGeometry(receiver,geometry))continue;
        const resolution=resolveIndication(geometry,own.objects);
        if(resolution.index!==i)continue;
        candidates.push({id,position:{...own.objects[i].position},own:a,other:b});
      }
      const pairs=[];
      for(let i=0;i<candidates.length;i++)for(let j=i+1;j<candidates.length;j++)if(rms(candidates[i].own.features,candidates[j].own.features)>=REFERENCE_LIMITS.featureDistance&&rms(candidates[i].other.features,candidates[j].other.features)>=REFERENCE_LIMITS.featureDistance)pairs.push([candidates[i],candidates[j]]);
      if(!pairs.length){bump('no-distinguishable-pair');return null;}
      // No rejection/redraw after the referent. Pair, target, order, selection and
      // arbitrary Phase-A symbol have separate RNGs; there is no learned policy.
      const pair=pairs[Math.floor(pairRandom()*pairs.length)],target=pair[Math.floor(targetRandom()*2)],ordered=orderRandom()<.5?pair.slice():pair.slice().reverse(),selected=ordered[Math.floor(choiceRandom()*2)],symbol=Math.floor(symbolRandom()*64);
      const action=Object.freeze({type:'inspect_object',targetId:selected.id});
      const event={id:nextId++,emittedAt:state.elapsed,senderId:sender.id,receiverId:receiver.id,tokens:[Math.floor(symbol/8),symbol%8],status:'choice',action:'inspect_object',reward:null,senderPixels:target.other.pixels.slice(),receiverPixels:selected.own.pixels.slice(),senderObservedAt:target.other.at,receiverObservedAt:selected.own.at,phase:'physical-reference-no-learning'};
      const t={sender,receiver,senderIdentity:identity(sender),receiverIdentity:identity(receiver),candidates:pair.map(x=>({id:x.id,position:x.position})),targetId:target.id,selectedId:selected.id,choiceRequest:action,stage:'choice',startedAt:state.elapsed,event,terminal:false,contiguous:0,observedId:null};
      sessions.add(t);busy.set(sender,t);busy.set(receiver,t);actions.set(action,t);cooldowns.set(receiver,receiver.elapsed);metrics.exchanges++;
      events.push(event);if(events.length>REFERENCE_LIMITS.maxEvents)events.shift();return action;
    },
    decision(n,decision){const t=busy.get(n);if(t&&decision.need!=='understanding')finish(t,'censored','priority-decision');},
    performOptional(n,action){
      const t=actions.get(action);if(!t||t.terminal||n!==t.sender||action!==t.indicationRequest)return null;
      t.stage='indicating';t.event.status=t.stage;
      const result=requestNpcIndication(n,t.permit,state.environment,{onPaid:work=>{try{observePaid(t,work);}catch{finish(t,'censored','observer-error');}}});
      if(result?.code!=='ACTION_STARTED'){finish(t,'censored','indication-start-rejected');return result;}
      t.indicationActive=n.active;return result;
    },
    performed(n,action,result,active){
      const t=actions.get(action);if(!t||t.terminal||n!==t.receiver||action!==t.choiceRequest)return;
      if(result?.code!=='ACTION_STARTED'||!active){finish(t,'censored','choice-start-rejected');return;}
      t.choiceActive=active;
    },
  };
  return {hooks,beforeTick(){if(!disposed)maintain();},afterTick(){if(!disposed)maintain();},censorPending(){for(const t of [...sessions])finish(t,'censored','stopped');},snapshot(){return {phase:'physical-reference-no-learning',seed,enabled:true,elapsed:state.elapsed,...metrics,pending:sessions.size,gates:{...gates},learners:[],ledger:structuredClone(events),observationEvents:structuredClone(events),latest:events.length?structuredClone(events.at(-1)):null,agents:state.agents.map(n=>({id:n.id,name:n.name,hunger:n.nourishment,thirst:n.hydration,energy:n.energy,collapses:n.stats.collapses,meals:n.stats.independentMeals,drinks:n.stats.independentDrinks})),diagnostic:{observations:metrics.observed,meanTotalVariation:0,argmaxChanged:0,interpretation:'Phase A verifies paid visible reference only. No associations, learned meanings or survival benefit.'}};},dispose(){if(disposed)return;for(const t of [...sessions])finish(t,'censored','disposed');disposed=true;pixelSensor.dispose?.();}};
}
