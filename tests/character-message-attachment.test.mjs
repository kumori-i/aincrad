import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {CONFIG} from '../src/config.js';
import {createOzarkState,writeOzarkSave,loadOzarkSave} from '../src/ozark-save.js';
import {createOzarkWorldGeometry} from '../src/ozark-world-geometry.js';
import {bindOzarkWorldAgent} from '../src/ozark-agent-world.js';
import {observeNpc,requestNpcAction,tickNpc,cancelNpcAction,collapseNpc} from '../src/npc.js';
import {attachVisualReferenceLearning} from '../src/visual-reference-attachment.js';
import {successfulDiscoveryActionCompletion,referenceGeometry,publicIndicationGeometry,discoveryActionPaidSeconds} from '../src/discovery-actions.js';
import {senseReferenceObjects,visibleIndicationGeometry,resolveIndication,observeIndication} from '../src/visual-reference-perception.js';
import {npcEffortCost} from '../src/npc-effort-funding.js';
import {lookupEcologyObject} from '../src/ecology.js';
import {createFreshCharacterMessages} from '../src/visual-reference-save.js';
import {initialReferenceRandomStates} from '../src/visual-reference-random.js';

const geometry=createOzarkWorldGeometry();
const modelCopy=model=>Object.fromEntries(Object.entries(model).map(([name,values])=>[name,values.slice()]));
const senderData=(attachment,id='aster')=>attachment.exportPersistence().characterMessages.learners.find(row=>row.agentId===id).sender;
const listenerData=(attachment,id='mira')=>attachment.exportPersistence().characterMessages.learners.find(row=>row.agentId===id).partners[0].listener;

function fixture({seed=211,listenerOffset=0,attach=attachVisualReferenceLearning,senderLineOfSight=null}={}){
  const state=createOzarkState(geometry),[sender,listener]=state.agents;
  if(seed!==state.visualReference.seed){
    state.visualReference={...state.visualReference,seed,random:initialReferenceRandomStates(seed)};
    state.characterMessages=createFreshCharacterMessages(state.worldLineage,state.visualReference);
  }
  const senderWorld=senderLineOfSight?Object.freeze({...geometry,
    lineOfSight:(from,to)=>senderLineOfSight(from,to,geometry.lineOfSight)}):geometry;
  for(const actor of state.agents){bindOzarkWorldAgent(actor,actor===sender?senderWorld:geometry,state);observeNpc(actor,state.environment);}
  const categories=new Map(senseReferenceObjects(sender,state).bindings.map((id,index)=>[id,index%2]));
  const pixelSensor={listenerOffset,senderOverrides:new Map(),suppressSender:false,
    capture(actor){
      if(actor===sender&&this.suppressSender)return new Map();
      const visible=senseReferenceObjects(actor,state);
      return new Map(visible.bindings.map((id,index)=>{
        const category=categories.get(id)??index%2;
        const base=actor===sender?(category?.9:.1):(category?.7:.2)+this.listenerOffset;
        const value=actor===sender?(this.senderOverrides.get(id)??base):base;
        return [id,{features:Array(48).fill(value),pixels:Array(768).fill(Math.round(value*255)),
          at:actor.elapsed,epoch:actor.epoch}];
      }));
    },dispose(){}};
  const attachment=attach({state,pixelSensor,seed,protocol:'sequence'});
  const step=()=>{
    attachment.beforeTick();state.elapsed+=CONFIG.fixedStep;
    for(const actor of state.agents)tickNpc(actor,CONFIG.fixedStep,state.environment);
    attachment.afterTick();
  };
  const advance=seconds=>{for(let i=0;i<Math.round(seconds/CONFIG.fixedStep);i++)step();};
  function completeBeforeAfterTick(actor){
    const active=actor.active;
    assert.equal(active?.kind,'interaction');
    let ticks=0;
    while(actor.active===active&&active.worked+CONFIG.fixedStep+1e-8<active.seconds){
      step();
      assert(++ticks<180,'Paid action must finish within its bounded duration');
    }
    assert.equal(actor.active,active,'The final physical tick has not yet run');
    attachment.beforeTick();state.elapsed+=CONFIG.fixedStep;
    for(const member of state.agents)tickNpc(member,CONFIG.fixedStep,state.environment);
    assert.notEqual(actor.active,active,'The physical action finished before afterTick');
    const proof=successfulDiscoveryActionCompletion(actor,active);
    assert(proof&&Number.isSafeInteger(proof.eventId)&&proof.eventId>0,
      'The original actor has an authentic non-consuming success receipt');
    assert.equal(proof.type,active.request.type);
    assert.equal(proof.targetId,active.request.targetId);
    assert(Math.abs(proof.worked-active.seconds)<1e-8);
    return {active,proof};
  }
  function begin(){
    const action=attachment.hooks.optionalAction(listener);
    assert.equal(action?.type,'inspect_object');
    const result=requestNpcAction(listener,action,state.environment);
    attachment.hooks.performed(listener,action,result,listener.active);
    assert.equal(result.code,'ACTION_STARTED');
    return action;
  }
  function demonstrate(){
    const observedBefore=attachment.snapshot().observed;
    advance(2);
    const action=attachment.hooks.optionalAction(sender);
    assert.equal(action?.type,'indicate_object');
    assert.equal(attachment.hooks.performOptional(sender,action).code,'ACTION_STARTED');
    advance(2);
    assert.equal(attachment.snapshot().observed,observedBefore+1);
  }
  function beginResponse(){
    const action=attachment.hooks.optionalAction(listener);
    assert.equal(action?.type,'indicate_object');
    assert.equal(attachment.hooks.performOptional(listener,action).code,'ACTION_STARTED');
  }
  const event=()=>attachment.snapshot().observationEvents[0];
  function respond(signal='match'){
    beginResponse();
    const selected=listener.active.request.targetId;
    const intendedValue=event().senderPixels[0]/255;
    pixelSensor.senderOverrides.set(selected,signal==='match'?intendedValue:(intendedValue>.5?.1:.9));
    advance(2);
    return attachment.snapshot();
  }
  return {state,sender,listener,pixelSensor,attachment,step,advance,completeBeforeAfterTick,begin,demonstrate,
    beginResponse,respond,event};
}

test('sequence emission and paid own-view demonstration update only the private listener bank',()=>{
  const f=fixture(),legacy=structuredClone(f.state.visualReference);
  const senderBefore=senderData(f.attachment),listenerBefore=listenerData(f.attachment);
  f.begin();
  const emitted=f.event();
  assert.match(emitted.message,/^[a-z]{1,6}$/);
  assert.equal(emitted.choiceMode,'uniform-untrained');
  assert.equal(emitted.phase,'private-character-message');
  assert.equal(emitted.senderUpdate,false);
  assert.equal(emitted.listenerUpdate,false);
  f.demonstrate();
  const done=f.event(),senderAfter=senderData(f.attachment),listenerAfter=listenerData(f.attachment);
  assert.equal(done.listenerUpdate,true);
  assert.equal(done.senderUpdate,false);
  assert.equal(done.selectedActionId>0,true,'Canonical paid inspection completed');
  assert.equal(listenerAfter.demonstrations,1);
  assert.equal(listenerAfter.optimizerSteps,1);
  assert.equal(listenerAfter.examples.length,1);
  assert.equal(listenerAfter.examples[0].message,emitted.message);
  assert.deepEqual(senderAfter.model,senderBefore.model,'A listener demonstration cannot update sender weights');
  assert.notDeepEqual(listenerAfter.model,listenerBefore.model);
  assert.deepEqual(f.attachment.exportPersistence().visualReference,legacy,
    'New sequence exchanges do not rewrite anchors, examples or four legacy streams');
  f.attachment.dispose();
});

test('passive ordinary measurement separates optional checks, feasible pairs, paid receipts and critic denominator',()=>{
  const f=fixture({seed:212}),before=f.attachment.exportPersistence();
  f.listener.active={request:{type:'rest'}};
  assert.equal(f.attachment.hooks.optionalAction(f.listener),null);
  let measure=f.attachment.measurementSnapshot();
  assert.equal(measure.counts.optionalChecks,1);
  assert.equal(measure.counts.feasibleOpportunities,0);
  assert.equal(measure.counts.emissions,0);
  assert.deepEqual(f.attachment.exportPersistence(),before,'A rejected observer opportunity draws no model or policy RNG');
  f.listener.active=null;
  f.begin();
  measure=f.attachment.measurementSnapshot();
  assert.equal(measure.counts.optionalChecks,2);
  assert.equal(measure.admissionGates.optional,2);
  assert.equal(measure.admissionGateKeysOmitted,0);
  assert.equal(measure.counts.feasibleOpportunities,1);
  assert.equal(measure.counts.emissions,1);
  assert.equal(measure.counts.paidInspectionStarts,1);
  assert.equal(measure.counts.paidInspectionCompletions,0);
  assert.equal(measure.counts.canonicalDemonstrations,0);
  assert.equal(measure.events.length,1);
  assert.equal(measure.events[0].message,f.event().message);
  assert.equal(measure.events[0].senderPixels,undefined);
  assert.equal(measure.events[0].targetId,undefined);
  assert.equal(typeof measure.events[0].bodyAtEmission.sender.hunger,'string');
  f.demonstrate();
  measure=f.attachment.measurementSnapshot();
  assert.equal(measure.counts.paidInspectionCompletions,1);
  assert.equal(measure.counts.canonicalDemonstrations,1);
  assert.equal(measure.counts.criticCorrect,0,'Seed 212 makes a wrong original paid choice');
  assert.equal(measure.counts.validListenerDemonstrations,1);
  assert.equal(measure.counts.listenerOptimizerSteps,1);
  assert.equal(measure.counts.listenerReplayUses,0);
  assert.equal(measure.counts.originalCensors,0);
  assert.equal(measure.counts.responseCensors,0);
  assert.equal(measure.counts.emissions,f.attachment.snapshot().exchanges);
  assert.equal(measure.counts.canonicalDemonstrations,f.attachment.snapshot().observed);
  assert.equal(measure.counts.criticCorrect,f.attachment.snapshot().correct);
  f.respond('mismatch');
  measure=f.attachment.measurementSnapshot();
  assert.equal(measure.counts.visualMismatches,1);
  assert.equal(measure.counts.visualMatches,0);
  assert.equal(measure.counts.paidReplyStarts,1);
  assert.equal(measure.counts.paidReplyCompletions,1);
  assert.equal(measure.counts.senderUpdates,1);
  assert.equal(measure.counts.responseCensors,0);
  assert.equal(measure.events[0].feedbackStatus,'mismatched');
  f.attachment.dispose();
});

test('first failed peer gate is observer-only and leaves a later paid choice unchanged',()=>{
  const f=fixture(),before=f.attachment.exportPersistence(),world=structuredClone(f.state);
  f.sender.active={request:{type:'rest'}};
  assert.equal(f.attachment.hooks.optionalAction(f.listener),null);
  f.sender.active=null;
  const measured=f.attachment.measurementSnapshot();
  assert.equal(measured.counts.optionalChecks,1);
  assert.equal(measured.admissionGates['no-peer'],1);
  assert.equal(measured.admissionGates['no-peer:active'],1);
  assert.deepEqual(f.attachment.exportPersistence(),before,'A rejected peer check draws no policy RNG');
  assert.deepEqual(f.state,world,'The diagnostic does not change the world');
  assert.equal(f.attachment.hooks.optionalAction(f.listener)?.type,'inspect_object',
    'A subsequent ordinary choice remains available');
  f.attachment.dispose();
});

test('one-way reverse geometry permits a real paid reply, then sender-local ambiguity censors feedback',()=>{
  const f=fixture(),senderSight=senseReferenceObjects(f.sender,f.state),
    receiverSight=senseReferenceObjects(f.listener,f.state);
  assert(senderSight.complete&&receiverSight.complete);
  const oneWay=receiverSight.bindings.flatMap((id,index)=>{
    const senderIndex=senderSight.bindings.indexOf(id);
    if(senderIndex<0)return [];
    const position=receiverSight.objects[index].position,
      forward=referenceGeometry(f.sender.position,position,f.sender.scene,1);
    if(!forward||!visibleIndicationGeometry(f.listener,forward)||
        resolveIndication(forward,receiverSight.objects).index!==index)return [];
    const reverse=referenceGeometry(f.listener.position,position,f.listener.scene,1);
    return reverse&&visibleIndicationGeometry(f.sender,reverse)&&
      resolveIndication(reverse,senderSight.objects).reason==='ambiguous'?[id]:[];
  }).slice(0,2);
  assert.equal(oneWay.length,2,'The declared initial engineering geometry has two ambiguous reverse bearings');
  const capture=f.pixelSensor.capture.bind(f.pixelSensor);
  f.pixelSensor.capture=actor=>{
    const crops=capture(actor);
    for(const [id,crop]of crops){
      const index=oneWay.indexOf(id);
      if(index<0){crops.delete(id);continue;}
      const value=index===0?.2:.8;
      crops.set(id,{...crop,features:Array(48).fill(value),pixels:Array(768).fill(value*255)});
    }
    return crops;
  };
  const choice=f.begin();
  const senderBefore=senderData(f.attachment),listenerBefore=listenerData(f.attachment),
    randomBefore=f.attachment.exportPersistence().characterMessages.random;
  f.demonstrate();
  const event=f.event(),measured=f.attachment.measurementSnapshot(),
    causes=Object.entries(measured.admissionGates).filter(([key])=>key.startsWith('response-preflight:'));
  assert.equal(event.status,'observed');
  assert.equal(event.feedbackStatus,'awaiting-response');
  assert.equal(event.listenerUpdate,true);
  assert.equal(event.senderUpdate,false);
  assert.equal(measured.counts.validListenerDemonstrations,1);
  assert.equal(measured.counts.paidReplyStarts,0);
  assert.equal(measured.counts.responseCensors,0);
  assert.equal(causes.length,0,'Hypothetical sender-view resolution supplies no character-reply gate');
  assert.equal(f.attachment.snapshot().pending,1);
  const effortBefore=f.listener.physiology.totals.metabolizedKcal;
  f.beginResponse();
  const active=f.listener.active;
  assert.equal(active.seconds,1.8);
  assert.equal(active.request.targetId,choice.targetId,'Reply is bound to the original paid inspection');
  assert.equal(publicIndicationGeometry(f.listener),null,'An unfunded reply has no public pose');
  f.advance(.6);
  assert(publicIndicationGeometry(f.listener));
  assert.equal(observeIndication(f.sender,f.listener,f.state).reason,'ambiguous',
    'Only the sender observes the actual funded public gesture');
  assert(discoveryActionPaidSeconds(f.listener,active)>=.6-1e-8);
  assert.equal(f.event().feedbackStatus,'responding');
  assert.equal(f.event().senderUpdate,false);
  f.advance(1.4);
  const proof=successfulDiscoveryActionCompletion(f.listener,active),done=f.attachment.measurementSnapshot();
  assert.equal(proof?.type,'indicate_object');
  assert.equal(proof?.targetId,active.request.targetId);
  assert(Math.abs(proof.worked-1.8)<1e-8);
  assert.equal(publicIndicationGeometry(f.listener),null);
  assert.equal(f.event().feedbackStatus,'censored');
  assert.equal(f.event().feedbackReason,'response-ambiguous');
  assert.equal(f.event().responseActionId,proof.eventId);
  assert.equal(done.counts.paidReplyStarts,1);
  assert.equal(done.counts.paidReplyCompletions,1);
  assert.equal(done.counts.responseCensors,1);
  assert.equal(done.counts.senderUpdates,0);
  assert.equal(done.counts.visualMatches+done.counts.visualMismatches,0);
  assert.equal(done.admissionGates['response:response-ambiguous'],1);
  assert.equal(f.attachment.snapshot().pending,0);
  assert(f.listener.physiology.totals.metabolizedKcal-effortBefore>=npcEffortCost(1.8,.25)-1e-8);
  assert.deepEqual(senderData(f.attachment).model,senderBefore.model);
  assert.equal(senderData(f.attachment).baseline,senderBefore.baseline);
  assert.equal(senderData(f.attachment).revision,senderBefore.revision);
  assert.equal(senderData(f.attachment).updates,senderBefore.updates);
  assert.deepEqual(f.attachment.exportPersistence().characterMessages.random,randomBefore);
  assert.notDeepEqual(listenerData(f.attachment).model,listenerBefore.model);
  assert.equal(listenerData(f.attachment).demonstrations,1);
  assert.equal(listenerData(f.attachment).optimizerSteps,1);
  f.attachment.afterTick();f.attachment.afterTick();
  assert.equal(f.attachment.measurementSnapshot().counts.paidReplyCompletions,1);
  assert.equal(senderData(f.attachment).updates,0,'Repeated maintenance cannot replay the censored response');
  f.attachment.dispose();
});

function nonPairDistractorFixture(options={}){
  // Fixed engineering geometry: these two ordinary objects each have a
  // uniquely readable forward and reverse bearing before a third object is
  // moved into Aster's live reply sight. The third object is never a candidate
  // or a listener label. This does not reconstruct an ordinary pilot event.
  const f=fixture({seed:211,...options}),pair=['object:666','object:673'];
  const senderSight=senseReferenceObjects(f.sender,f.state),listenerSight=senseReferenceObjects(f.listener,f.state);
  for(const id of pair){
    const senderIndex=senderSight.bindings.indexOf(id),listenerIndex=listenerSight.bindings.indexOf(id);
    assert(senderIndex>=0&&listenerIndex>=0);
    const position=senderSight.objects[senderIndex].position,
      forward=referenceGeometry(f.sender.position,position,f.sender.scene,1),
      reverse=referenceGeometry(f.listener.position,position,f.listener.scene,1);
    assert.equal(resolveIndication(forward,listenerSight.objects).index,listenerIndex);
    assert.equal(resolveIndication(reverse,senderSight.objects).index,senderIndex);
  }
  const capture=f.pixelSensor.capture.bind(f.pixelSensor);
  f.pixelSensor.capture=actor=>{
    const crops=capture(actor);
    for(const [id,crop] of crops){
      const index=pair.indexOf(id);
      if(index<0){crops.delete(id);continue;}
      const value=index===0?.2:.8;
      crops.set(id,{...crop,features:Array(48).fill(value),pixels:Array(768).fill(value*255)});
    }
    return crops;
  };
  const choice=f.begin();f.demonstrate();f.beginResponse();
  const selected=lookupEcologyObject(f.state.environment.ecology,choice.targetId),
    distractor=lookupEcologyObject(f.state.environment.ecology,'object:231'),
    original={...distractor.position};
  assert(!pair.includes(distractor.id));
  const inject=()=>{
    Object.assign(distractor.position,{x:f.listener.position.x+.85*(selected.position.x-f.listener.position.x),
      y:f.listener.position.y+.85*(selected.position.y-f.listener.position.y)});
    assert(senseReferenceObjects(f.sender,f.state).bindings.includes(distractor.id));
  };
  const remove=()=>Object.assign(distractor.position,original);
  return {...f,choice,inject,remove};
}

test('a non-pair sender sight distractor cannot reuse an earlier unique reply crop',()=>{
  const f=nonPairDistractorFixture(),before=senderData(f.attachment),listenerBefore=listenerData(f.attachment);
  f.advance(1.2);
  assert.equal(observeIndication(f.sender,f.listener,f.state).reason,'resolved');
  f.inject();f.advance(.8);
  assert.equal(f.event().feedbackStatus,'censored');
  assert.equal(f.event().feedbackReason,'response-ambiguous');
  assert.equal(f.event().senderUpdate,false);
  assert.deepEqual(senderData(f.attachment),before);
  assert.deepEqual(listenerData(f.attachment),listenerBefore);
  assert.equal(f.attachment.measurementSnapshot().counts.paidReplyCompletions,1);
  f.attachment.dispose();
});

test('a short final ambiguous interval cannot claim a continuous ambiguity witness',()=>{
  const f=nonPairDistractorFixture(),before=senderData(f.attachment);
  f.advance(1.5);f.inject();f.advance(.5);
  assert.equal(f.event().feedbackStatus,'censored');
  assert.equal(f.event().feedbackReason,'response-not-observed');
  assert.deepEqual(senderData(f.attachment),before);
  f.attachment.dispose();
});

test('a one-step sender sight break resets the otherwise long paid ambiguity interval',()=>{
  let hidden=false,blocked=null;
  const f=nonPairDistractorFixture({senderLineOfSight:(from,to,ordinary)=>
    hidden&&blocked&&Math.hypot(to.x-blocked.x,to.y-blocked.y)<1e-8?false:ordinary(from,to)}),
    senderBefore=senderData(f.attachment);
  f.inject();f.advance(1.4);
  const gesture=publicIndicationGeometry(f.listener);
  assert(gesture);
  blocked={x:(gesture.origin.x+gesture.tip.x)/2,y:(gesture.origin.y+gesture.tip.y)/2};
  hidden=true;f.step();
  assert.equal(observeIndication(f.sender,f.listener,f.state).reason,'gesture-not-visible');
  hidden=false;f.advance(.4);
  assert.equal(f.event().feedbackStatus,'censored');
  assert.equal(f.event().feedbackReason,'response-not-observed');
  assert.deepEqual(senderData(f.attachment),senderBefore);
  assert.equal(f.attachment.measurementSnapshot().counts.paidReplyCompletions,1);
  f.attachment.dispose();
});

test('a final fresh unique interval after paid ambiguity can settle the original sender trajectory',()=>{
  const f=nonPairDistractorFixture(),before=senderData(f.attachment);
  f.inject();f.advance(.6);
  assert.equal(observeIndication(f.sender,f.listener,f.state).reason,'ambiguous');
  f.remove();
  assert.equal(observeIndication(f.sender,f.listener,f.state).reason,'resolved');
  const intended=f.event().senderPixels[0]/255;
  f.pixelSensor.senderOverrides.set(f.choice.targetId,intended);
  f.advance(1.4);
  assert.equal(f.event().feedbackStatus,'matched');
  assert.equal(senderData(f.attachment).updates,before.updates+1);
  assert.equal(listenerData(f.attachment).demonstrations,1);
  f.attachment.dispose();
});

test('urgent care, deadline and missing fresh crop retire a paid ambiguous reply without credit',()=>{
  for(const ending of ['urgent','deadline','missing-crop']){
    const f=nonPairDistractorFixture(),senderBefore=senderData(f.attachment),
      listenerBefore=listenerData(f.attachment),active=f.listener.active;
    f.inject();f.advance(.6);
    assert.equal(observeIndication(f.sender,f.listener,f.state).reason,'ambiguous');
    if(ending==='urgent'){
      f.sender.physiology.waterDeficitMl=2000;
      f.attachment.beforeTick();
    }else if(ending==='deadline'){
      f.state.elapsed=f.event().emittedAt+12+CONFIG.fixedStep;
      f.attachment.beforeTick();
    }else{
      f.remove();f.pixelSensor.suppressSender=true;f.advance(1.4);
    }
    assert.equal(f.event().feedbackStatus,'censored',ending);
    assert.equal(f.event().feedbackReason,ending==='urgent'?'body-priority':
      ending==='deadline'?'timeout':'response-not-observed',ending);
    assert.equal(f.attachment.snapshot().pending,0,ending);
    assert.equal(f.attachment.measurementSnapshot().counts.senderUpdates,0,ending);
    assert.deepEqual(senderData(f.attachment),senderBefore,ending);
    assert.deepEqual(listenerData(f.attachment),listenerBefore,ending);
    assert.equal(f.listener.active,null,ending);
    assert.equal(successfulDiscoveryActionCompletion(f.listener,active)?.type,
      ending==='missing-crop'?'indicate_object':undefined,ending);
    f.attachment.dispose();
  }
});

test('ambiguous own-view label and interrupted reply stay outside the wrong-choice and sender-update counts',()=>{
  const ambiguous=fixture();ambiguous.begin();ambiguous.pixelSensor.listenerOffset=.09;ambiguous.demonstrate();
  const unclear=ambiguous.attachment.measurementSnapshot();
  assert.equal(unclear.counts.canonicalDemonstrations,1);
  assert.equal(unclear.counts.criticCorrect,Number(ambiguous.event().referenceCorrect));
  assert.equal(unclear.counts.ambiguousListenerLabels,1);
  assert.equal(unclear.counts.validListenerDemonstrations,0);
  assert.equal(unclear.counts.listenerReplayUses,0);
  ambiguous.attachment.dispose();

  const interrupted=fixture();interrupted.begin();interrupted.demonstrate();interrupted.beginResponse();
  cancelNpcAction(interrupted.listener,'TEST_INTERRUPTION');interrupted.advance(2);
  const measure=interrupted.attachment.measurementSnapshot();
  assert.equal(measure.counts.canonicalDemonstrations,1);
  assert.equal(measure.counts.validListenerDemonstrations,1);
  assert.equal(measure.counts.responseCensors,1);
  assert.equal(measure.counts.originalCensors,0);
  assert.equal(measure.counts.paidReplyStarts,1);
  assert.equal(measure.counts.paidReplyCompletions,0);
  assert.equal(measure.counts.senderUpdates,0);
  assert(measure.reasons.some(row=>row.kind==='response'&&row.reason==='response-interrupted'));
  interrupted.attachment.dispose();
});

test('an interrupted paid inspection is an attempt, not a completed choice or wrong critic result',()=>{
  const f=fixture();f.begin();f.advance(.3);
  cancelNpcAction(f.listener,'TEST_INTERRUPTION');f.step();
  const measure=f.attachment.measurementSnapshot();
  assert.equal(measure.counts.paidInspectionStarts,1);
  assert.equal(measure.counts.paidInspectionCompletions,0);
  assert.equal(measure.counts.paidInspectionOutcomeUnavailable,0);
  assert.equal(measure.counts.originalCensors,1);
  assert.equal(measure.counts.canonicalDemonstrations,0);
  assert.equal(measure.counts.criticCorrect,0);
  assert(measure.reasons.some(row=>row.kind==='original'&&row.reason==='choice-interrupted'));
  f.attachment.dispose();
});

for(const kind of ['inspection','reply'])for(const ending of ['priority','invalid-current'])
  test(`a completed paid ${kind} counts once before ${ending} censors learning`,()=>{
    const f=fixture();f.begin();
    if(kind==='reply'){f.demonstrate();f.beginResponse();}
    const senderBefore=senderData(f.attachment),listenerBefore=listenerData(f.attachment);
    const {active,proof}=f.completeBeforeAfterTick(f.listener);
    assert.equal(proof.type,kind==='inspection'?'inspect_object':'indicate_object');
    assert.equal(proof.targetId,active.request.targetId);
    if(ending==='priority')f.attachment.hooks.decision(f.listener,{need:'water'});
    else{f.listener.position.x+=1;f.attachment.afterTick();}
    const key=kind==='inspection'?'paidInspectionCompletions':'paidReplyCompletions';
    const unknown=kind==='inspection'?'paidInspectionOutcomeUnavailable':'paidReplyOutcomeUnavailable';
    let measure=f.attachment.measurementSnapshot();
    assert.equal(measure.counts[key],1,'The physical success receipt is counted before terminal censorship');
    assert.equal(measure.counts[unknown],0);
    assert.equal(measure.counts.originalCensors,kind==='inspection'?1:0);
    assert.equal(measure.counts.responseCensors,kind==='reply'?1:0);
    assert.equal(measure.counts.canonicalDemonstrations,kind==='reply'?1:0);
    assert.equal(measure.counts.validListenerDemonstrations,kind==='reply'?1:0);
    assert.equal(measure.counts.senderUpdates,0);
    assert(measure.reasons.some(row=>row.kind===(kind==='inspection'?'original':'response')&&
      row.reason===(ending==='priority'?'priority-decision':'identity-or-position-changed')));
    assert.deepEqual(senderData(f.attachment),senderBefore,'Censoring cannot settle a sender trajectory');
    assert.deepEqual(listenerData(f.attachment),listenerBefore,'The completed action cannot add a second listener update');
    f.attachment.afterTick();f.attachment.beforeTick();f.attachment.censorPending();
    f.attachment.dispose();f.attachment.dispose();
    measure=f.attachment.measurementSnapshot();
    assert.equal(measure.counts[key],1,'Repeated reconciliation and disposal never recount the receipt');
    assert.equal(measure.counts[unknown],0);
  });

test('owner replacement after a proven completion retains the original receipt once',()=>{
  const f=fixture();f.begin();
  const {active}=f.completeBeforeAfterTick(f.listener);
  assert(successfulDiscoveryActionCompletion(f.listener,active));
  f.state.agents[1]={...f.listener};
  f.attachment.beforeTick();f.attachment.afterTick();
  const measure=f.attachment.measurementSnapshot();
  assert.equal(measure.counts.paidInspectionCompletions,1);
  assert.equal(measure.counts.paidInspectionOutcomeUnavailable,0);
  assert.equal(measure.counts.originalCensors,1);
  assert.equal(measure.counts.canonicalDemonstrations,0);
  assert.equal(measure.eventsRetired,1);
  assert.deepEqual(measure.events,[]);
  f.attachment.dispose();
});

test('owner replacement without an authentic receipt records uncertainty, not a fabricated completion',()=>{
  const f=fixture();f.begin();
  const active=f.listener.active;
  f.advance(.3);
  assert.equal(successfulDiscoveryActionCompletion(f.listener,active),null);
  f.state.agents[1]={...f.listener};
  assert.equal(successfulDiscoveryActionCompletion(f.state.agents[1],active),null,
    'A copied actor cannot inherit the old action witness');
  f.attachment.beforeTick();f.attachment.afterTick();f.attachment.censorPending();
  const measure=f.attachment.measurementSnapshot();
  assert.equal(measure.counts.paidInspectionStarts,1);
  assert.equal(measure.counts.paidInspectionCompletions,0);
  assert.equal(measure.counts.paidInspectionOutcomeUnavailable,1);
  assert.equal(measure.counts.canonicalDemonstrations,0);
  assert.equal(measure.counts.originalCensors,1);
  assert.equal(measure.eventsRetired,1);
  f.attachment.dispose();
  assert.equal(f.attachment.measurementSnapshot().counts.paidInspectionOutcomeUnavailable,1);
});

for(const kind of ['inspection','reply'])
  test(`an epoch change after completed ${kind} work makes its outcome unavailable`,()=>{
    const f=fixture();f.begin();
    if(kind==='reply'){f.demonstrate();f.beginResponse();}
    const {active}=f.completeBeforeAfterTick(f.listener);
    assert(successfulDiscoveryActionCompletion(f.listener,active));
    f.listener.epoch++;
    assert.equal(successfulDiscoveryActionCompletion(f.listener,active),null,
      'The raw completed work cannot certify success after the owner epoch changes');
    f.attachment.afterTick();f.attachment.beforeTick();
    const measure=f.attachment.measurementSnapshot();
    const completed=kind==='inspection'?'paidInspectionCompletions':'paidReplyCompletions';
    const unknown=kind==='inspection'?'paidInspectionOutcomeUnavailable':'paidReplyOutcomeUnavailable';
    assert.equal(measure.counts[completed],0);
    assert.equal(measure.counts[unknown],1);
    assert.equal(measure.counts.originalCensors,kind==='inspection'?1:0);
    assert.equal(measure.counts.responseCensors,kind==='reply'?1:0);
    assert.equal(measure.counts.senderUpdates,0);
    f.attachment.dispose();
    assert.equal(f.attachment.measurementSnapshot().counts[unknown],1);
  });

for(const kind of ['inspection','reply'])
  test(`disposal immediately after physical ${kind} completion counts its receipt once`,()=>{
    const f=fixture();f.begin();
    if(kind==='reply'){f.demonstrate();f.beginResponse();}
    const {active}=f.completeBeforeAfterTick(f.listener);
    assert(successfulDiscoveryActionCompletion(f.listener,active));
    f.attachment.dispose();f.attachment.dispose();
    const measure=f.attachment.measurementSnapshot();
    const completed=kind==='inspection'?'paidInspectionCompletions':'paidReplyCompletions';
    const unknown=kind==='inspection'?'paidInspectionOutcomeUnavailable':'paidReplyOutcomeUnavailable';
    assert.equal(measure.counts[completed],1);
    assert.equal(measure.counts[unknown],0);
    assert.equal(measure.counts.originalCensors,kind==='inspection'?1:0);
    assert.equal(measure.counts.responseCensors,kind==='reply'?1:0);
    assert.equal(measure.counts.senderUpdates,0);
  });

test('a second physical demonstration counts one new experience and prior replay separately',()=>{
  const f=fixture();f.begin();f.demonstrate();f.respond('match');
  f.pixelSensor.senderOverrides.clear();f.advance(12.2);
  f.begin();f.demonstrate();
  const measure=f.attachment.measurementSnapshot(),bank=listenerData(f.attachment);
  assert.equal(measure.counts.validListenerDemonstrations,2);
  assert.equal(measure.counts.listenerOptimizerSteps,2);
  assert.equal(measure.counts.listenerReplayUses,1);
  assert.equal(bank.demonstrations,2);
  assert.equal(bank.replayUses,1);
  assert.equal(bank.examples.length,2);
  assert.equal(measure.events.at(-1).listenerReplayUses,1);
  f.attachment.dispose();
});

test('authentic paid match and mismatch update only the sampled sender once',()=>{
  const causal=[];
  for(const signal of ['match','mismatch']){
    const f=fixture();f.begin();f.demonstrate();
    const before=senderData(f.attachment),listenerBefore=listenerData(f.attachment);
    const snapshot=f.respond(signal),after=senderData(f.attachment),listenerAfter=listenerData(f.attachment);
    assert.equal(snapshot.pending,0);
    assert.equal(f.event().feedbackStatus,signal==='match'?'matched':'mismatched');
    assert.equal(f.event().senderUpdate,true);
    assert.equal(after.updates,before.updates+1);
    assert.equal(after.revision,before.revision+1);
    assert(Math.abs(after.baseline-(signal==='match'?.05:-.05))<1e-12);
    assert.notDeepEqual(after.model,before.model);
    assert.deepEqual(listenerAfter,listenerBefore,'A sender response cannot train the listener again');
    causal.push({message:f.event().message,critic:f.event().referenceCorrect,
      listener:listenerAfter.model,sender:after.model});
    assert.deepEqual(f.attachment.takeSenderFeedback(f.sender),[],
      'The weak legacy feedback tuple cannot authorize a second sequence update');
    f.advance(.5);
    assert.deepEqual(senderData(f.attachment),after,'Terminal callbacks cannot repeat an update');
    f.attachment.dispose();
  }
  assert.equal(causal[0].message,causal[1].message);
  assert.equal(causal[0].critic,causal[1].critic,
    'The same observer critic result coexists with opposite sender-local outcomes');
  assert.deepEqual(causal[0].listener,causal[1].listener);
  assert.notDeepEqual(causal[0].sender,causal[1].sender);
});

test('a wrong original paid choice still earns listener correction, then a sender-local mismatch',()=>{
  const f=fixture({seed:212});f.begin();
  const originallyInspected=f.listener.active.request.targetId;
  f.demonstrate();
  assert.equal(f.event().referenceCorrect,false);
  assert.equal(f.event().listenerUpdate,true);
  assert.notEqual(originallyInspected,f.event().demonstratedObjectId);
  const learned=listenerData(f.attachment);
  f.beginResponse();
  assert.equal(f.listener.active.request.targetId,originallyInspected,
    'The reply remains bound to the original choice, not the correction');
  f.advance(2);
  assert.equal(f.event().feedbackStatus,'mismatched');
  assert.equal(f.event().senderUpdate,true);
  assert.deepEqual(listenerData(f.attachment),learned);
  f.attachment.dispose();
});

test('observer correctness and diagnostic object ID cannot become numeric learning inputs',async()=>{
  const source=await readFile(new URL('../src/visual-reference-attachment.js',import.meta.url),'utf8');
  const critic='t.event.referenceCorrect=t.selectedId===t.targetId;';
  const diagnostic='t.event.demonstratedObjectId=t.observedId;';
  assert(source.includes(critic)&&source.includes(diagnostic));
  const isolated=source.replaceAll(critic,'t.event.referenceCorrect=!(t.selectedId===t.targetId);')
    .replaceAll(diagnostic,"t.event.demonstratedObjectId='observer-intervention';")
    .replace(/from '(\.\/[^']+)'/g,(_all,path)=>
      `from '${new URL(path,new URL('../src/visual-reference-attachment.js',import.meta.url)).href}'`);
  const {attachVisualReferenceLearning:intervened}=await import(
    `data:text/javascript;base64,${Buffer.from(isolated).toString('base64')}`);
  const rows=[];
  for(const attach of [attachVisualReferenceLearning,intervened]){
    const f=fixture({attach});f.begin();f.demonstrate();f.respond('match');
    rows.push({critic:f.event().referenceCorrect,diagnostic:f.event().demonstratedObjectId,
      models:f.attachment.exportPersistence().characterMessages});
    f.attachment.dispose();
  }
  assert.notEqual(rows[0].critic,rows[1].critic);
  assert.notEqual(rows[0].diagnostic,rows[1].diagnostic);
  assert.deepEqual(rows[0].models.random,rows[1].models.random);
  assert.deepEqual(rows[0].models.learners,rows[1].models.learners,
    'Only unchanged authentic own-view crops and sampled decisions reach the numeric learners');
});

test('ambiguous final own crop censors listener label without training either model',()=>{
  const f=fixture(),senderBefore=senderData(f.attachment),listenerBefore=listenerData(f.attachment);
  f.begin();f.pixelSensor.listenerOffset=.09;f.demonstrate();
  const done=f.event(),senderAfter=senderData(f.attachment),listenerAfter=listenerData(f.attachment);
  assert.equal(done.listenerUpdate,false);
  assert.equal(listenerAfter.demonstrations,0);
  assert.deepEqual(listenerAfter.model,listenerBefore.model);
  assert.deepEqual(senderAfter.model,senderBefore.model);
  f.attachment.dispose();
});

test('response interruption after a valid demonstration retains listener learning and cancels sender authority',()=>{
  for(const ending of ['cancel','collapse','priority','dispose']){
    const f=fixture();f.begin();f.demonstrate();f.beginResponse();
    const senderBefore=senderData(f.attachment),listenerBefore=listenerData(f.attachment);
    f.advance(.2);
    if(ending==='cancel')cancelNpcAction(f.listener,'TEST_INTERRUPTION');
    if(ending==='collapse')collapseNpc(f.listener,'TEST_INTERRUPTION');
    if(ending==='priority')f.attachment.hooks.decision(f.listener,{need:'water'});
    if(ending==='dispose')f.attachment.dispose();
    if(ending!=='dispose')f.advance(2);
    const snapshot=f.attachment.snapshot();
    assert.equal(snapshot.observationEvents[0]?.senderUpdate,false,ending);
    if(ending!=='dispose'){
      assert.equal(snapshot.pending,0,ending);
      assert.deepEqual(senderData(f.attachment).model,senderBefore.model,ending);
      assert.deepEqual(listenerData(f.attachment),listenerBefore,ending);
      f.attachment.dispose();
    }
  }
});

test('timeout and owner/partner identity boundaries retire a pending sequence without a sender update',()=>{
  for(const ending of ['timeout','sender-collapse','partner-discovery','partner-physiology','partner-actor']){
    const f=fixture();f.begin();f.demonstrate();
    const before=senderData(f.attachment);
    if(ending==='timeout')f.advance(8.1);
    if(ending==='sender-collapse')collapseNpc(f.sender,'TEST_SENDER_EPOCH');
    if(ending==='partner-discovery')f.listener.discovery=structuredClone(f.listener.discovery);
    if(ending==='partner-physiology')f.listener.physiology=structuredClone(f.listener.physiology);
    if(ending==='partner-actor')f.state.agents[1]={...f.listener};
    if(ending!=='timeout')f.attachment.beforeTick();
    const snapshot=f.attachment.snapshot();
    assert.equal(snapshot.pending,0,ending);
    assert.equal(snapshot.observationEvents[0]?.senderUpdate??false,false,ending);
    assert.deepEqual(senderData(f.attachment).model,before.model,ending);
    assert.equal(senderData(f.attachment).updates,0,ending);
    if(ending==='sender-collapse')assert.equal(listenerData(f.attachment).demonstrations,1,
      'The continuing listener retains its earned own-view learning');
    if(ending.startsWith('partner-')){
      assert.equal(snapshot.learners.find(row=>row.agentId==='mira').character.partnerBanks[0].trained,false,
        'A replacement individual begins with an untrained partner bank');
      const measure=f.attachment.measurementSnapshot();
      assert.equal(measure.counts.emissions,1,'Aggregate session totals survive row retirement');
      assert.equal(measure.eventsRetired,1,'An old incarnation cannot appear under a reused name');
      assert.deepEqual(measure.events,[]);
    }
    f.attachment.dispose();
  }
});

test('pending sender trajectory is absent after strict save/reopen; completed listener example survives',()=>{
  const f=fixture();f.begin();f.demonstrate();f.beginResponse();f.advance(.2);
  const persisted=f.attachment.exportPersistence(),values=new Map();
  const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  f.state.environment.elapsed=f.state.elapsed;f.state.environment.ecology.elapsed=f.state.elapsed;
  assert.equal(writeOzarkSave(storage,f.state,geometry,{referencePersistence:persisted}),true);
  const reopened=loadOzarkSave(storage,geometry);
  assert.equal(reopened.blocked,false);
  const [sender,listener]=reopened.state.agents;
  for(const actor of reopened.state.agents){bindOzarkWorldAgent(actor,geometry,reopened.state);observeNpc(actor,reopened.state.environment);}
  const sensor={capture(actor){const visible=senseReferenceObjects(actor,reopened.state);
    return new Map(visible.bindings.map(id=>[id,{features:Array(48).fill(.2),pixels:Array(768).fill(51),
      at:actor.elapsed,epoch:actor.epoch}]));},dispose(){}};
  const restored=attachVisualReferenceLearning({state:reopened.state,pixelSensor:sensor,protocol:'sequence'});
  assert.equal(restored.snapshot().pending,0);
  assert.deepEqual(restored.snapshot().observationEvents,[]);
  assert.equal(restored.measurementSnapshot().counts.emissions,0,'Session-only measurement restarts on reopen');
  assert.equal(restored.measurementSnapshot().counts.validListenerDemonstrations,0);
  assert.deepEqual(restored.measurementSnapshot().events,[]);
  assert.equal(listenerData(restored).demonstrations,1);
  assert.equal(senderData(restored).updates,0);
  assert.equal(senderData(restored).emissions,1);
  restored.afterTick();
  assert.equal(senderData(restored).updates,0);
  assert.deepEqual(restored.takeSenderFeedback(sender),[]);
  assert.equal(listener.id,'mira');
  restored.dispose();f.attachment.dispose();
});

test('repeated snapshot, legacy feedback reads and strict saves cannot draw or train pending models',()=>{
  const f=fixture();f.sender.active={request:{type:'rest'}};
  assert.equal(f.attachment.hooks.optionalAction(f.listener),null);
  f.sender.active=null;f.begin();
  const before=f.attachment.exportPersistence().characterMessages,world=structuredClone(f.state);
  const values=new Map(),storage={getItem:key=>values.get(key)??null,
    setItem:(key,value)=>values.set(key,value)};
  for(let i=0;i<3;i++){
    const snapshot=f.attachment.snapshot();
    const measurement=f.attachment.measurementSnapshot();
    assert.equal(measurement.counts.emissions,1);
    measurement.counts.emissions=999;
    measurement.admissionGates.optional=999;
    measurement.admissionGates['no-peer:active']=999;
    measurement.events[0].message='forged';
    measurement.actors[0].body.hunger='forged';
    assert.equal(f.attachment.measurementSnapshot().events[0].message,snapshot.latest.message,
      'The compact measurement is a defensive copy');
    assert.notEqual(f.attachment.measurementSnapshot().admissionGates.optional,999);
    assert.equal(f.attachment.measurementSnapshot().admissionGates['no-peer:active'],1);
    assert.equal(snapshot.pending,1);
    assert.deepEqual(f.attachment.takeSenderFeedback(f.sender),[]);
    const exportNow=f.attachment.exportPersistence();
    assert.deepEqual(exportNow.characterMessages,before);
    assert.equal(writeOzarkSave(storage,f.state,geometry,{referencePersistence:exportNow}),true);
    assert.deepEqual(f.attachment.exportPersistence().characterMessages,before);
  }
  assert.deepEqual(f.state,world,'Observer projections and saves cannot mutate the running world');
  f.attachment.censorPending();
  assert.equal(f.attachment.snapshot().pending,0);
  assert.deepEqual(senderData(f.attachment).model,before.learners[0].sender.model);
  f.attachment.dispose();
});

test('disabling only passive measurement preserves full world, model, replay and RNG continuation',async()=>{
  const source=await readFile(new URL('../src/visual-reference-attachment.js',import.meta.url),'utf8');
  const declaration="const measurement=protocol==='sequence'?createCharacterCommunicationMeasurement({eventRows:REFERENCE_LIMITS.maxEvents}):null;";
  assert(source.includes(declaration),'The observer-only source intervention must match the exact declaration');
  const isolated=source.replace(declaration,'const measurement=null;')
    .replaceAll('measurement.count(','measurement?.count(')
    .replace(/from '(\.\/[^']+)'/g,(_all,path)=>
      `from '${new URL(path,new URL('../src/visual-reference-attachment.js',import.meta.url)).href}'`);
  const {attachVisualReferenceLearning:withoutMeasurement}=await import(
    `data:text/javascript;base64,${Buffer.from(isolated).toString('base64')}`);
  const normalizeWorldId=value=>{
    const copy=structuredClone(value),worldId=copy.worldLineage.instanceId;
    const walk=node=>{
      if(!node||typeof node!=='object')return;
      for(const [key,part] of Object.entries(node)){
        if((key==='instanceId'||key==='worldId')&&part===worldId)node[key]='same-world';
        else walk(part);
      }
    };
    walk(copy);return copy;
  };
  const rows=[];
  for(const attach of [attachVisualReferenceLearning,withoutMeasurement]){
    const f=fixture({attach});
    f.sender.active={request:{type:'rest'}};
    assert.equal(f.attachment.hooks.optionalAction(f.listener),null);
    f.sender.active=null;
    f.begin();f.demonstrate();f.respond('mismatch');
    const first=f.attachment.snapshot().latest;
    assert.equal(first.feedbackStatus,'mismatched');
    f.pixelSensor.senderOverrides.clear();f.advance(12.2);f.begin();
    const second=f.attachment.snapshot().latest;
    rows.push({worldId:f.state.worldLineage.instanceId,
      messages:[first.message,second.message],
      outcomes:[first.listenerUpdate,first.senderUpdate,first.feedbackStatus],
      state:normalizeWorldId(f.state),
      persistence:normalizeWorldId(f.attachment.exportPersistence())});
    f.attachment.dispose();
  }
  assert.notEqual(rows[0].worldId,rows[1].worldId,'Fresh fixture worlds retain independent lineages');
  for(const key of ['messages','outcomes','state','persistence'])
    assert.deepEqual(rows[0][key],rows[1][key],`${key} must not depend on passive measurement`);
});
