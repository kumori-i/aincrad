// Private visual associations grounded only in canonical observed demonstrations.
// One main-world optional channel; never owns the clock, population or bodily credit.
import { createIndicationPermit, createListenerResponsePermit, retireIndicationPermit, discoveryActionCompletion, successfulDiscoveryActionCompletion, referenceGeometry } from './discovery-actions.js';
import { requestNpcIndication, cancelNpcAction } from './npc.js';
import { senseReferenceObjects, resolveIndication, visibleIndicationGeometry, observeIndication } from './visual-reference-perception.js';
import { actorLineOfSight } from './perception.js';
import { bodySignals } from './interoception.js';
import { isSleeping } from './biology.js';
import { CONFIG } from './config.js';
import { createVisualReferenceMemory } from './visual-reference-memory.js';
import { createReferenceRandomStream, initialReferenceRandomStates, REFERENCE_RANDOM_PROTOCOL } from './visual-reference-random.js';
import { validateReferencePersistence } from './visual-reference-save.js';
import { markVisualReferenceAttached } from './visual-reference-save-registration.js';

export const REFERENCE_LIMITS=Object.freeze({timeout:12,cooldown:12,featureDistance:.08,observationSeconds:.5,maxObservationStep:CONFIG.fixedStep,segmentLength:24,maxEvents:256});
export const SENDER_FEEDBACK_LIMITS=Object.freeze({match:.04,mismatch:.08,maxPending:16});
// Observation occurs at the real step endpoint. Never backdate sight into a
// funded prefix: materially partial-funded steps cannot certify an interval.
function fullReferenceSample(at,paidSeconds,stepSeconds){return Number.isFinite(at)&&Number.isFinite(paidSeconds)&&Number.isFinite(stepSeconds)&&stepSeconds>0&&stepSeconds<=REFERENCE_LIMITS.maxObservationStep+1e-8&&Math.abs(stepSeconds-paidSeconds)<=1e-8;}
export function continuousReferenceStep(previousAt,at,paidSeconds,stepSeconds){
  const gap=at-previousAt;
  return fullReferenceSample(at,paidSeconds,stepSeconds)&&gap>0&&Math.abs(gap-stepSeconds)<=1e-8;
}
function rms(a,b){return Math.sqrt(a.reduce((s,x,i)=>s+(x-b[i])**2,0)/a.length);}
function awake(n){return n?.lifecycle==='AWAKE'&&!isSleeping(n);}
function urgent(n){const b=bodySignals(n);return ['ravenous','faint with hunger'].includes(b.hunger)||['parched','desperate thirst'].includes(b.thirst)||b.energy==='depleted'||b.pain==='severe';}
function identity(n){return {actor:n,epoch:n.epoch,discovery:n.discovery,physiology:n.physiology,position:{...n.position},scene:n.scene};}
function unchanged(n,w){return n===w.actor&&n.epoch===w.epoch&&n.discovery===w.discovery&&n.physiology===w.physiology&&n.scene===w.scene&&n.position.x===w.position.x&&n.position.y===w.position.y;}
function cropValid(c,n){return c&&c.epoch===n.epoch&&Number.isFinite(c.at)&&c.at<=n.elapsed&&n.elapsed-c.at<=1.1&&c.features?.length===48&&c.features.every(v=>Number.isFinite(v)&&v>=0&&v<=1)&&c.pixels?.length===768;}

export function attachVisualReferenceLearning({state,pixelSensor,seed=state?.visualReference?.seed??211}){
  if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw new TypeError('Expected uint32 seed');
  if(typeof pixelSensor?.capture!=='function')throw new TypeError('A live pixel sensor is required');
  // The save codec verifies both sides of the world/individual lineage before
  // any new opaque token is issued. Only data crosses this boundary.
  const restored=validateReferencePersistence(state?.worldLineage,state?.visualReference);
  if(restored.visualReference.seed!==seed)throw new TypeError('Reference symbol seed differs from the saved world');
  const worldId=restored.worldLineage.instanceId,savedRandom=restored.visualReference.random;
  const pairRandom=createReferenceRandomStream({seed,purpose:'pair',state:savedRandom.pair}),
    targetRandom=createReferenceRandomStream({seed,purpose:'target',state:savedRandom.target}),
    orderRandom=createReferenceRandomStream({seed,purpose:'order',state:savedRandom.order});
  // Keep the exact fresh-stream seam used by the existing forced-choice unit
  // harness. Both paths start at the saved continuation state without a draw.
  const choiceRandom=savedRandom.choice===initialReferenceRandomStates(seed).choice?
    createReferenceRandomStream({seed,purpose:'choice'}):
    createReferenceRandomStream({seed,purpose:'choice',state:savedRandom.choice});
  const sessions=new Set(),busy=new Map(),cooldowns=new WeakMap(),actions=new WeakMap(),events=[],gates={},identities=new Map(),correctionRights=new WeakSet(),feedbackByActor=new Map();
  const metrics={exchanges:0,completed:0,observed:0,correct:0,censored:0,updates:0,positive:0,negative:0,relief:0,discomfort:0,effortExpiry:0,opportunities:0,anchorsAllocated:0,matchedChoices:0,exploratoryChoices:0,correctionAttempts:0,evidenceAdditions:0,supportUpdates:0,conflicts:0,correctionAbstentions:0,feedbackMatched:0,feedbackMismatched:0,feedbackCensored:0};
  let disposed=false,nextId=1,nextIdentity=restored.worldLineage.nextSerial,
    auditReaderIssued=false,auditEnabled=false,auditRecord=null;
  const bump=(key)=>{gates[key]=Math.min(Number.MAX_SAFE_INTEGER,(gates[key]||0)+1);};
  // Identity is object provenance, not a reusable actor name or bodily epoch.
  // Ordinary collapse/rescue/recovery retains memory but cancels transactions.
  function currentIdentities(){
    if(!Array.isArray(state.agents)||state.agents.length!==identities.size)return false;
    const present=new Set(state.agents),seen=new Set();
    if(present.size!==state.agents.length)return false;
    for(const actor of state.agents){
      const entry=identities.get(actor);
      if(!entry||seen.has(actor.id)||entry.agentId!==actor.id||
          entry.discovery!==actor.discovery||entry.physiology!==actor.physiology)return false;
      seen.add(actor.id);
    }
    return true;
  }
  function requireCurrentIdentities(){
    if(!currentIdentities())throw new Error('Reference identities need a normal runtime reconciliation before export');
  }
  function syncIdentities(){
    if(!Array.isArray(state.agents)||state.agents.length!==2||
        new Set(state.agents.map(actor=>actor?.id)).size!==2||
        state.agents.some(actor=>!['aster','mira'].includes(actor?.id)))
      throw new TypeError('Reference actors no longer match this world');
    const present=new Set(state.agents);
    const retiredIds=new Set();
    for(const [actor,entry]of identities)if(!present.has(actor)||entry.agentId!==actor.id||
        entry.discovery!==actor.discovery||entry.physiology!==actor.physiology){
      retiredIds.add(entry.agentId);identities.delete(actor);feedbackByActor.delete(actor);
    }
    // Session rows carry names, not durable incarnation keys. Do not show a
    // retired person's events as the replacement person's conversation.
    if(retiredIds.size){
      feedbackByActor.clear();
      for(let index=events.length-1;index>=0;index--)
        if(retiredIds.has(events[index].senderId)||retiredIds.has(events[index].receiverId))events.splice(index,1);
      auditRecord=null;
    }
    for(const actor of state.agents)if(!identities.has(actor)){
      if(nextIdentity>0xffffffff)throw new RangeError('Reference actor serials are exhausted');
      const serial=nextIdentity++;
      identities.set(actor,{token:Object.freeze({}),agentId:actor.id,serial,discovery:actor.discovery,physiology:actor.physiology,
        epoch:actor.epoch,memory:createVisualReferenceMemory({symbolSeed:seed,symbolIdentity:serial})});
    }
    // Completed response samples are session evidence. Bodily interruption
    // erases them without erasing personally acquired associations.
    for(const [actor,entry]of identities)if(entry.epoch!==actor.epoch){feedbackByActor.clear();entry.epoch=actor.epoch;}
    for(const [actor,entry]of identities)entry.memory.reconcilePartners([...identities].filter(([other])=>other!==actor).map(([,other])=>other.token));
  }
  const originalActors=new Map(state.agents.map(actor=>[actor.id,actor]));
  if(originalActors.size!==2||!['aster','mira'].every(id=>originalActors.has(id)))
    throw new TypeError('Reference actors do not match the saved world');
  for(const saved of restored.worldLineage.agents){
    const actor=originalActors.get(saved.agentId);
    identities.set(actor,{token:Object.freeze({}),agentId:saved.agentId,serial:saved.serial,
      discovery:actor.discovery,physiology:actor.physiology,epoch:actor.epoch,
      memory:createVisualReferenceMemory({symbolSeed:seed,symbolIdentity:saved.serial})});
  }
  for(const [actor,entry]of identities)
    entry.memory.reconcilePartners([...identities].filter(([other])=>other!==actor).map(([,other])=>other.token));
  const byId=new Map([...identities].map(([actor,entry])=>[actor.id,entry]));
  for(const saved of restored.visualReference.learners){
    const owner=byId.get(saved.agentId);
    owner.memory.restorePersistence({anchors:saved.anchors,partners:saved.partners},(agentId,serial)=>{
      const partner=byId.get(agentId);
      return partner?.serial===serial&&partner!==owner?partner.token:null;
    });
  }
  markVisualReferenceAttached(state,exportPersistence);
  function clearDemonstration(t){
    t.contiguous=0;t.event.observedSeconds=0;t.observedId=null;t.demonstration=null;
    delete t.event.demonstrationPixels;delete t.event.demonstrationObservedAt;
  }
  function clearResponse(t){t.responseContiguous=0;t.responseObservedId=null;t.responseCrop=null;}
  function correct(t){
    if(!correctionRights.delete(t))return;
    metrics.correctionAttempts++;
    // No target identity, critic correctness, sender pixels or bodily outcome
    // crosses this boundary. This is the listener's own final visible crop.
    const outcome=t.receiverMemory.memory.observe(t.senderMemory.token,t.symbol,t.demonstration.features);
    t.event.correction=outcome.outcome;
    if(outcome.added){metrics.evidenceAdditions++;metrics.updates++;}
    else if(outcome.support)metrics.supportUpdates++;
    else if(outcome.outcome==='capacity-conflict')metrics.conflicts++;
    else metrics.correctionAbstentions++;
  }
  function finishResponse(t,status,reason,crop=null){
    if(t.terminal)return;
    retireIndicationPermit(t.responsePermit);
    t.terminal=true;sessions.delete(t);busy.delete(t.sender);busy.delete(t.receiver);
    t.event.feedbackStatus=status;t.event.feedbackReason=reason;t.event.endedAt=state.elapsed;
    if(crop){
      const signal=status==='matched'?'match':'mismatch';
      const row=Object.freeze({eventId:t.event.id,symbol:t.symbol,signal,
        features:Object.freeze(crop.features.slice()),at:crop.at});
      const queue=feedbackByActor.get(t.sender)||[];
      queue.push(row);if(queue.length>SENDER_FEEDBACK_LIMITS.maxPending)queue.shift();
      feedbackByActor.set(t.sender,queue);
      metrics[status==='matched'?'feedbackMatched':'feedbackMismatched']++;
    }else{feedbackByActor.clear();metrics.feedbackCensored++;bump(`response:${reason}`);}
    clearResponse(t);t.responsePermit=null;
    if(t.responseActive&&t.receiver.active===t.responseActive)
      cancelNpcAction(t.receiver,'REFERENCE_INTERRUPTED');
  }
  function finish(t,status,reason){
    if(t.terminal)return;
    if(t.demonstrationCompleted){finishResponse(t,'censored',reason);return;}
    retireIndicationPermit(t.permit);
    t.terminal=true;sessions.delete(t);busy.delete(t.sender);busy.delete(t.receiver);
    t.event.status=status;t.event.reason=reason;t.event.endedAt=state.elapsed;
    if(status==='observed'){metrics.completed++;metrics.observed++;if(t.selectedId===t.targetId)metrics.correct++;t.event.referenceCorrect=t.selectedId===t.targetId;t.event.demonstratedObjectId=t.observedId;correct(t);if(auditEnabled&&!auditRecord)auditRecord=t;}
    else{feedbackByActor.clear();clearDemonstration(t);metrics.censored++;bump(`${t.stage}:${reason}`);}
    // Only this transaction's own authentic active commands can be cancelled.
    for(const [n,active]of [[t.receiver,t.choiceActive],[t.sender,t.indicationActive],[t.receiver,t.responseActive]])if(active&&n.active===active)cancelNpcAction(n,'REFERENCE_INTERRUPTED');
  }
  function completeDemonstration(t){
    if(t.demonstrationCompleted||t.terminal)return;
    t.demonstrationCompleted=true;metrics.completed++;metrics.observed++;
    // Only the observer's diagnostics can see this critic comparison.
    if(t.selectedId===t.targetId)metrics.correct++;
    t.event.referenceCorrect=t.selectedId===t.targetId;
    t.event.demonstratedObjectId=t.observedId;t.event.status='observed';t.event.reason='visible-post-choice-demonstration';
    correct(t);
    if(auditEnabled&&!auditRecord)auditRecord=t;
    // Reply visibility is checked only after the listener has earned its own
    // example. It must not remove an otherwise valid original pair, target,
    // or choice from the ordinary exchange.
    const selected=t.candidates.find(candidate=>candidate.id===t.selectedId);
    const senderSight=senseReferenceObjects(t.sender,state);
    const senderIndex=senderSight.bindings.indexOf(t.selectedId);
    const reply=selected&&referenceGeometry(t.receiver.position,selected.position,t.receiver.scene,1);
    if(!senderSight.complete||senderIndex<0||!reply||!visibleIndicationGeometry(t.sender,reply)||
        resolveIndication(reply,senderSight.objects).index!==senderIndex){
      finishResponse(t,'censored','response-not-resolvable');return;
    }
    t.responsePermit=createListenerResponsePermit(t.receiver,t.sender,t.indicationActive);
    if(!t.responsePermit){finishResponse(t,'censored','response-not-authorized');return;}
    t.stage='awaiting-response';t.event.feedbackStatus='awaiting-response';
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
    syncIdentities();
    for(const t of [...sessions]){
      const invalid=current(t);if(invalid){finish(t,'censored',invalid);continue;}
      if(t.stage==='choice'&&t.choiceActive&&t.receiver.active!==t.choiceActive){
        const proof=discoveryActionCompletion(t.receiver,t.choiceActive);
        if(!proof||proof.type!=='inspect_object'||proof.targetId!==t.selectedId){finish(t,'censored','choice-interrupted');continue;}
        const permit=createIndicationPermit(t.sender,t.receiver,t.choiceActive,t.targetId);
        if(!permit){finish(t,'censored','choice-not-canonical-success');continue;}
        t.permit=permit;t.stage='awaiting-indication';t.event.status=t.stage;t.event.selectedActionId=proof.eventId;
      }
      if(t.stage==='indicating'&&t.indicationActive&&t.sender.active!==t.indicationActive){
        const proof=successfulDiscoveryActionCompletion(t.sender,t.indicationActive);
        if(!proof||proof.type!=='indicate_object'||Math.abs(proof.worked-1.8)>1e-8){finish(t,'censored','indication-interrupted');continue;}
        t.event.indicationActionId=proof.eventId;
        if(t.contiguous+1e-8<REFERENCE_LIMITS.observationSeconds){finish(t,'censored','demonstration-not-observed');continue;}
        if(!t.demonstration||t.demonstration.epoch!==t.receiver.epoch||Math.abs(t.demonstration.at-t.receiver.elapsed)>REFERENCE_LIMITS.maxObservationStep+1e-8){finish(t,'censored','stale-demonstration');continue;}
        correctionRights.add(t);
        completeDemonstration(t);
      }
      if(t.stage==='responding'&&t.responseActive&&t.receiver.active!==t.responseActive){
        const proof=successfulDiscoveryActionCompletion(t.receiver,t.responseActive);
        if(!proof||proof.type!=='indicate_object'||Math.abs(proof.worked-1.8)>1e-8){finish(t,'censored','response-interrupted');continue;}
        t.event.responseActionId=proof.eventId;
        if(t.responseContiguous+1e-8<REFERENCE_LIMITS.observationSeconds){finish(t,'censored','response-not-observed');continue;}
        const crop=t.responseCrop;
        if(!crop||crop.epoch!==t.sender.epoch||Math.abs(crop.at-t.sender.elapsed)>REFERENCE_LIMITS.maxObservationStep+1e-8){finish(t,'censored','stale-response');continue;}
        const distance=rms(t.intendedFeatures,crop.features);
        if(distance<=SENDER_FEEDBACK_LIMITS.match)
          finishResponse(t,'matched','sender-local-visual-match',crop);
        else if(distance>=SENDER_FEEDBACK_LIMITS.mismatch)
          finishResponse(t,'mismatched','sender-local-visual-mismatch',crop);
        else finish(t,'censored','response-visual-gray-zone');
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
      clearDemonstration(t);bump('observation:noncontiguous-step');return;
    }
    const invalid=current(t);if(invalid){clearDemonstration(t);finish(t,'censored',invalid);return;}
    const seen=observeIndication(t.receiver,t.sender,state);
    const id=seen?.objectId;
    const crop=id?pixelSensor.capture(t.receiver,state).get(id):null;
    if(!id||!cropValid(crop,t.receiver)){clearDemonstration(t);bump(`observation:${seen?.reason||'no-fresh-crop'}`);return;}
    if(t.observedId!==id||previousAt===undefined)clearDemonstration(t);else t.contiguous+=paidSeconds;
    t.observedId=id;t.event.observedSeconds=t.contiguous;
    t.demonstration=Object.freeze({features:Object.freeze(crop.features.slice()),at:crop.at,epoch:crop.epoch});
    t.event.demonstrationPixels=crop.pixels.slice();t.event.demonstrationObservedAt=crop.at;
  }
  function observeResponsePaid(t,{paidSeconds,stepSeconds,at}){
    if(t.terminal||t.stage!=='responding'||!Number.isFinite(paidSeconds)||paidSeconds<=0)return;
    const previousAt=t.lastResponsePaidAt;
    const continuous=previousAt===undefined?fullReferenceSample(at,paidSeconds,stepSeconds):continuousReferenceStep(previousAt,at,paidSeconds,stepSeconds);
    t.lastResponsePaidAt=at;
    if(!continuous){clearResponse(t);bump('response:noncontiguous-step');return;}
    const invalid=current(t);if(invalid){clearResponse(t);finish(t,'censored',invalid);return;}
    // The chosen inspection target is actuator-only. The original sender gets
    // only the listener's visible pose and a fresh crop from its own sensor.
    const seen=observeIndication(t.sender,t.receiver,state);
    const id=seen?.objectId;
    const crop=id?pixelSensor.capture(t.sender,state).get(id):null;
    if(!id||!cropValid(crop,t.sender)||Math.abs(crop.at-t.sender.elapsed)>REFERENCE_LIMITS.maxObservationStep+1e-8){
      clearResponse(t);bump(`response:${seen?.reason||'no-fresh-crop'}`);return;
    }
    if(t.responseObservedId!==id||previousAt===undefined)clearResponse(t);
    else t.responseContiguous+=paidSeconds;
    t.responseObservedId=id;
    t.responseCrop=Object.freeze({features:Object.freeze(crop.features.slice()),at:crop.at,epoch:crop.epoch});
  }
  // Trusted fresh-profile engineering installer only. This cannot make a
  // decision, train memory, select a favorable event or alter any random stream.
  function createNativeAssociationAuditReader(){
    if(disposed||auditReaderIssued)return null;
    auditReaderIssued=true;auditEnabled=true;let consumed=false;
    return ()=>{
      if(consumed)return null;consumed=true;auditEnabled=false;
      const t=auditRecord;auditRecord=null;
      if(!t||disposed||current(t)||identities.get(t.sender)!==t.senderMemory||identities.get(t.receiver)!==t.receiverMemory)return null;
      const sight=senseReferenceObjects(t.receiver,state);
      if(!sight.complete||!t.auditOrder?.every(id=>sight.bindings.includes(id)))return null;
      const captures=pixelSensor.capture(t.receiver,state),views=t.auditOrder.map(id=>captures.get(id));
      if(views.some(c=>!cropValid(c,t.receiver)||Math.abs(c.at-t.receiver.elapsed)>1e-8))return null;
      const own=views.map(c=>Object.freeze(c.features.slice()));
      const known=t.receiverMemory.memory.choose(t.senderMemory.token,t.symbol,own);
      const reversed=t.receiverMemory.memory.choose(t.senderMemory.token,t.symbol,own.slice().reverse());
      let absent=null;
      for(let symbol=0;symbol<64;symbol++){
        const choice=t.receiverMemory.memory.choose(t.senderMemory.token,symbol,own);
        if(choice.reason==='unknown-symbol'){absent={symbol,choice};break;}
      }
      return structuredClone({scope:'post-demonstration same-scene current-view retrieval diagnostic; not a policy action',
        viewSource:'fresh-listener-current-canvas',eventId:t.event.id,at:t.receiver.elapsed,symbol:t.symbol,
        candidateViews:views.map(c=>({at:c.at,features:c.features.slice(),pixels:c.pixels.slice()})),
        demonstration:{at:t.demonstration.at,features:t.demonstration.features.slice()},
        known,reversed,absent});
    };
  }
  const hooks={
    optionalAction(receiver){
      if(disposed)return null;maintain();bump('optional');metrics.opportunities++;
      const existing=busy.get(receiver);
      if(existing){
        if(existing.sender===receiver&&existing.stage==='awaiting-indication'){
          const action=Object.freeze({type:'indicate_object'});actions.set(action,existing);existing.indicationRequest=action;return action;
        }
        if(existing.receiver===receiver&&existing.stage==='awaiting-response'){
          const action=Object.freeze({type:'indicate_object'});actions.set(action,existing);existing.responseRequest=action;return action;
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
      const senderMemory=identities.get(sender),receiverMemory=identities.get(receiver),pairs=[];
      for(let i=0;i<candidates.length;i++)for(let j=i+1;j<candidates.length;j++){
        const pair=[candidates[i],candidates[j]];
        if(rms(pair[0].own.features,pair[1].own.features)<REFERENCE_LIMITS.featureDistance||rms(pair[0].other.features,pair[1].other.features)<REFERENCE_LIMITS.featureDistance)continue;
        // Pure preflight includes BOTH alternatives and consumes no RNG.
        const preflight=senderMemory.memory.planPair(pair.map(c=>c.other.features));
        if(preflight.ok)pairs.push({pair,plan:preflight.plan});else bump(`sender:${preflight.reason}`);
      }
      if(!pairs.length){bump('no-feasible-distinguishable-pair');return null;}
      const planned=pairs[Math.floor(pairRandom()*pairs.length)],pair=planned.pair;
      const committed=senderMemory.memory.commitPair(planned.plan);
      if(!committed.ok){bump(`sender:${committed.reason}`);return null;}
      metrics.anchorsAllocated+=committed.allocated;
      // Both encountered anchors commit before the uniform referent; no redraw.
      const targetIndex=Math.floor(targetRandom()*2),target=pair[targetIndex],symbol=committed.symbols[targetIndex];
      const ordered=orderRandom()<.5?pair.slice():pair.slice().reverse();
      const choice=receiverMemory.memory.choose(senderMemory.token,symbol,ordered.map(c=>c.own.features));
      const confident=choice.index===0||choice.index===1;
      const selected=ordered[confident?choice.index:Math.floor(choiceRandom()*2)];
      if(confident)metrics.matchedChoices++;else metrics.exploratoryChoices++;
      bump(`choice:${choice.reason}`);
      const action=Object.freeze({type:'inspect_object',targetId:selected.id});
      const event={id:nextId++,emittedAt:state.elapsed,senderId:sender.id,receiverId:receiver.id,tokens:[Math.floor(symbol/8),symbol%8],status:'choice',action:'inspect_object',reward:null,senderPixels:target.other.pixels.slice(),receiverPixels:selected.own.pixels.slice(),senderObservedAt:target.other.at,receiverObservedAt:selected.own.at,phase:'private-visual-association',choiceMode:confident?'association-match':'uniform-exploration',choiceReason:choice.reason};
      const t={sender,receiver,senderMemory,receiverMemory,symbol,senderIdentity:identity(sender),receiverIdentity:identity(receiver),candidates:pair.map(x=>({id:x.id,position:x.position})),auditOrder:auditEnabled?ordered.map(c=>c.id):null,targetId:target.id,selectedId:selected.id,intendedFeatures:Object.freeze(target.other.features.slice()),choiceRequest:action,stage:'choice',startedAt:state.elapsed,event,terminal:false,contiguous:0,observedId:null,responseContiguous:0,responseObservedId:null};
      sessions.add(t);busy.set(sender,t);busy.set(receiver,t);actions.set(action,t);cooldowns.set(receiver,receiver.elapsed);metrics.exchanges++;
      events.push(event);if(events.length>REFERENCE_LIMITS.maxEvents)events.shift();return action;
    },
    decision(n,decision){const t=busy.get(n);if(t&&decision.need!=='understanding')finish(t,'censored','priority-decision');},
    performOptional(n,action){
      const t=actions.get(action);if(!t||t.terminal)return null;
      if(n===t.sender&&action===t.indicationRequest&&t.stage==='awaiting-indication'){
        t.stage='indicating';t.event.status=t.stage;
        const result=requestNpcIndication(n,t.permit,state.environment,{onPaid:work=>{try{observePaid(t,work);}catch{finish(t,'censored','observer-error');}}});
        if(result?.code!=='ACTION_STARTED'){finish(t,'censored','indication-start-rejected');return result;}
        t.indicationActive=n.active;return result;
      }
      if(n===t.receiver&&action===t.responseRequest&&t.stage==='awaiting-response'){
        t.stage='responding';t.event.feedbackStatus=t.stage;
        const result=requestNpcIndication(n,t.responsePermit,state.environment,{onPaid:work=>{try{observeResponsePaid(t,work);}catch{finish(t,'censored','response-observer-error');}}});
        if(result?.code!=='ACTION_STARTED'){finish(t,'censored','response-start-rejected');return result;}
        t.responseActive=n.active;return result;
      }
      return null;
    },
    performed(n,action,result,active){
      const t=actions.get(action);if(!t||t.terminal||n!==t.receiver||action!==t.choiceRequest)return;
      if(result?.code!=='ACTION_STARTED'||!active){finish(t,'censored','choice-start-rejected');return;}
      t.choiceActive=active;
    },
  };
  function exportPersistence(){
    requireCurrentIdentities();
    const byToken=new Map([...identities].map(([,entry])=>[entry.token,entry]));
    const actors=['aster','mira'].map(id=>state.agents.find(actor=>actor.id===id));
    const agents=actors.map(actor=>({agentId:actor.id,serial:identities.get(actor).serial}));
    return {
      worldLineage:{version:1,instanceId:worldId,nextSerial:nextIdentity,agents},
      visualReference:{version:1,worldId,seed,protocol:REFERENCE_RANDOM_PROTOCOL,
        random:{pair:pairRandom.state(),target:targetRandom.state(),
          order:orderRandom.state(),choice:choiceRandom.state()},
        learners:actors.map(actor=>{
          const owner=identities.get(actor);
          return {agentId:actor.id,serial:owner.serial,...owner.memory.exportPersistence(token=>{
            const partner=byToken.get(token);
            if(!partner||partner===owner)throw new TypeError('Reference partner identity is stale');
            return {agentId:partner.agentId,serial:partner.serial};
          })};
        })},
    };
  }
  function inspectPersistedAssociation({listenerId,senderId,symbol,candidateFeatures}={}){
    requireCurrentIdentities();
    if(disposed||listenerId===senderId)return null;
    const listener=[...identities].find(([actor])=>actor.id===listenerId)?.[1];
    const sender=[...identities].find(([actor])=>actor.id===senderId)?.[1];
    if(!listener||!sender)return null;
    return listener.memory.choose(sender.token,symbol,candidateFeatures);
  }
  // A future sender policy can consume only its own bounded visual feedback.
  // No critic result, listener crop, object identity or bodily reward is here.
  function takeSenderFeedback(sender){
    if(disposed||!currentIdentities()||[...identities].some(([actor,entry])=>entry.epoch!==actor.epoch)){
      feedbackByActor.clear();return [];
    }
    if(!identities.has(sender))return [];
    const pending=feedbackByActor.get(sender)||[];feedbackByActor.delete(sender);
    return pending.map(({symbol,signal,features,at})=>({symbol,signal,features:features.slice(),at}));
  }
  return {hooks,createNativeAssociationAuditReader,exportPersistence,inspectPersistedAssociation,takeSenderFeedback,
    beforeTick(){if(!disposed)maintain();},afterTick(){if(!disposed)maintain();},
    censorPending(){for(const t of [...sessions])finish(t,'censored','stopped');feedbackByActor.clear();},
    snapshot(){const stale=!currentIdentities(),feedbackCurrent=!stale&&[...identities].every(([actor,entry])=>entry.epoch===actor.epoch);return {phase:'private-visual-association',seed,enabled:!disposed,elapsed:state.elapsed,...metrics,pending:stale?0:sessions.size,gates:{...gates},senderFeedback:feedbackCurrent?structuredClone([...feedbackByActor.values()].flat().map(({eventId,signal,features,at})=>({eventId,signal,features,at}))):[],learners:stale?[]:[...identities].map(([actor,entry])=>({agentId:actor.id,identity:entry.serial,...entry.memory.snapshot()})),ledger:stale?[]:structuredClone(events),observationEvents:stale?[]:structuredClone(events),latest:stale||!events.length?null:structuredClone(events.at(-1)),agents:state.agents.map(n=>({id:n.id,name:n.name,hunger:n.nourishment,thirst:n.hydration,energy:n.energy,collapses:n.stats.collapses,meals:n.stats.independentMeals,drinks:n.stats.independentDrinks})),diagnostic:{observations:metrics.observed,pendingReconciliation:stale,interpretation:stale?'Actor identity changed; private learner display waits for normal runtime reconciliation.':'Private supplied-metric exemplar associations, corrected only by paid observed demonstrations. Sender feedback is transient local visual similarity, not critic correctness. Retained examples are not autonomous language, abstraction or survival-benefit evidence.'}};},
    dispose(){if(disposed)return;for(const t of [...sessions])finish(t,'censored','disposed');feedbackByActor.clear();disposed=true;pixelSensor.dispose?.();}};
}
