import test from 'node:test';
import assert from 'node:assert/strict';
import {CONFIG} from '../src/config.js';
import {createOzarkState,writeOzarkSave,loadOzarkSave} from '../src/ozark-save.js';
import {createOzarkWorldGeometry} from '../src/ozark-world-geometry.js';
import {bindOzarkWorldAgent} from '../src/ozark-agent-world.js';
import {observeNpc,requestNpcAction,tickNpc,cancelNpcAction} from '../src/npc.js';
import {attachVisualReferenceLearning} from '../src/visual-reference-attachment.js';
import {createActorGestureMemory} from '../src/actor-gesture-memory.js';
import {actorGesturePredictionFeatures} from '../src/actor-gesture-predictor.js';
import {sensePublicPeerGesture,senseReferenceObjects,observeIndication} from '../src/visual-reference-perception.js';
import {publicIndicationGeometry} from '../src/discovery-actions.js';
import {FREE_HAND_RULES,initializeFreeHandSession,publicFreeHandGeometry} from '../src/free-hand-action.js';

const geometry=createOzarkWorldGeometry();
function fixture({enabled=true,predictionEnabled=true,listenerSight=null,
  state=createOzarkState(geometry,{communicationSeed:211})}={}){
  const [sender,listener]=state.agents;
  const listenerWorld=listenerSight?Object.freeze({...geometry,
    lineOfSight:(from,to)=>listenerSight(from,to,geometry.lineOfSight)}):geometry;
  for(const actor of state.agents){
    bindOzarkWorldAgent(actor,actor===listener?listenerWorld:geometry,state);
    observeNpc(actor,state.environment);
  }
  const categories=new Map(senseReferenceObjects(sender,state).bindings.map((id,index)=>[id,index%2]));
  const pixelSensor={capture(actor){
    const sight=senseReferenceObjects(actor,state);
    return new Map(sight.bindings.map((id,index)=>{
      const value=(categories.get(id)??index%2)?.8:.1;
      return [id,{features:Array(48).fill(value),pixels:Array(768).fill(Math.round(value*255)),
        at:actor.elapsed,epoch:actor.epoch}];
    }));
  },dispose(){}};
  const attachment=attachVisualReferenceLearning({state,pixelSensor,protocol:'sequence',
    gestureMemoryEnabled:enabled,gesturePredictionEnabled:predictionEnabled});
  const step=()=>{
    attachment.beforeTick();state.elapsed+=CONFIG.fixedStep;
    for(const actor of state.agents)tickNpc(actor,CONFIG.fixedStep,state.environment);
    attachment.afterTick();
  };
  const advance=seconds=>{for(let i=0;i<Math.round(seconds/CONFIG.fixedStep);i++)step();};
  const start=()=>{
    const choice=attachment.hooks.optionalAction(listener);
    assert.equal(choice?.type,'inspect_object');
    const result=requestNpcAction(listener,choice,state.environment);
    attachment.hooks.performed(listener,choice,result,listener.active);
    assert.equal(result.code,'ACTION_STARTED');
    advance(2);
    const indication=attachment.hooks.optionalAction(sender);
    assert.equal(indication?.type,'indicate_object');
    assert.equal(attachment.hooks.performOptional(sender,indication).code,'ACTION_STARTED');
  };
  return {state,sender,listener,attachment,pixelSensor,step,advance,start};
}

test('bounded local rows distinguish unknown, visible absence and uninterrupted visible time',()=>{
  const memory=createActorGestureMemory({capacity:3,ttlSeconds:1});
  const sample=(at,visibility)=>({at,visibility,
    peer:visibility==='unknown'?null:{dx:3,dy:4},pose:null,
    self:{actionActive:0,poseProgress:null,freeHandActive:0,freeHandPose:null}});
  assert.equal(memory.record(sample(0,'unknown')),true);
  assert.deepEqual(memory.summary(),{retained:1,overflows:0,expirations:0,
    limits:{capacity:3,ttlSeconds:1},sessionResets:0,saturated:false});
  memory.record(sample(CONFIG.fixedStep,'absent'));
  memory.record(sample(2*CONFIG.fixedStep,'absent'));
  let rows=memory.read(2*CONFIG.fixedStep).records;
  assert.equal(rows[1].continuousVisible,false,'An unseen first interval cannot imply visible silence');
  assert.equal(rows[2].continuousVisible,true);
  assert.equal(rows[2].continuousAbsenceSeconds,CONFIG.fixedStep);
  rows[2].peer.dx=999;
  assert.equal(memory.read(2*CONFIG.fixedStep).records[2].peer.dx,3);
  assert.equal(memory.record(sample(2*CONFIG.fixedStep,'unknown')),false,'Repeated clock reads are not new evidence');
  memory.record(sample(3*CONFIG.fixedStep,'unknown'));
  assert.equal(memory.read(3*CONFIG.fixedStep).overflows,1);
  for(let i=4;i<40;i++)memory.record(sample(i*CONFIG.fixedStep,'absent'));
  const bounded=memory.read(39*CONFIG.fixedStep).records.at(-1);
  assert(bounded.visibleSeconds<=2*CONFIG.fixedStep+1e-8);
  assert(bounded.continuousAbsenceSeconds<=2*CONFIG.fixedStep+1e-8);
  memory.record(sample(.9,'absent'));
  assert.equal(memory.read(.9).records.at(-1).continuousVisible,false,'A missed frame interrupts visibility');
  memory.record(sample(2.1,'absent'));
  const expired=memory.read(2.1);
  assert.equal(expired.records.length,1);
  assert.equal(expired.records[0].visibleSeconds,0);
  assert(expired.expirations>=1);
  memory.clear();assert.deepEqual(memory.read(2.1).records,[]);
  assert.deepEqual(memory.summary(),{retained:0,overflows:0,expirations:0,
    limits:{capacity:3,ttlSeconds:1},sessionResets:1,saturated:false});
  memory.clear();assert.equal(memory.summary().sessionResets,2);
  assert.throws(()=>memory.record({...sample(2,'pose'),pose:{origin:{dx:0,dy:0},tip:{dx:1,dy:0},progress:NaN}}),/Invalid/);
  const motor=sample(2.2,'absent');
  motor.self={actionActive:1,poseProgress:.5,freeHandActive:1,
    freeHandPose:{origin:{dx:0,dy:0},tip:{dx:0,dy:-24},progress:.5}};
  assert.equal(memory.record(motor),true);
  motor.self.freeHandPose.tip.dy=999;
  const recorded=memory.read(2.2).records.at(-1);
  assert.equal(recorded.self.freeHandPose.tip.dy,-24);
  recorded.self.freeHandPose.tip.dy=999;
  assert.equal(memory.read(2.2).records.at(-1).self.freeHandPose.tip.dy,-24);
  assert.throws(()=>memory.record({...sample(2.3,'absent'),self:{...motor.self,
    freeHandActive:0}}),/Invalid/);
});

test('real paid public indication enters only the listener’s numeric local view',()=>{
  const f=fixture();
  try{
    f.step();
    assert.equal(f.attachment.readGestureMemory(f.listener).records.at(-1).visibility,'absent');
    f.start();f.advance(.25);
    const pose=publicIndicationGeometry(f.sender);
    assert(pose&&pose.progress>0,'The ordinary action has paid for a rendered pose');
    const received=f.attachment.readGestureMemory(f.listener).records.at(-1);
    const own=f.attachment.readGestureMemory(f.sender).records.at(-1);
    assert.equal(received.visibility,'pose');
    assert.equal(received.continuousVisible,true);
    assert.equal(received.pose.progress,pose.progress);
    assert(Math.abs(received.pose.tip.dx-(pose.tip.x-f.listener.position.x))<1e-8);
    assert.equal(received.self.actionActive,0);
    assert.equal(own.visibility,'absent');
    assert.equal(own.self.actionActive,1);
    assert(own.self.poseProgress>0);
    assert(!JSON.stringify(received).includes(f.sender.active.request.targetId),
      'A numeric pose row must not carry the private object binding');
    const copy=f.attachment.readGestureMemory(f.listener);
    copy.records.at(-1).pose.tip.dx=999;copy.records.length=0;
    assert.notEqual(f.attachment.readGestureMemory(f.listener).records.at(-1).pose.tip.dx,999);
    f.advance(1.75);
    const last=f.attachment.readGestureMemory(f.listener).records.at(-1);
    assert.equal(last.visibility,'absent','A finished pose is no longer public');
    assert(last.continuousVisible,'The visible pose-to-absence transition was observed');
    assert.equal(f.attachment.snapshot().observed,1);
  }finally{f.attachment.dispose();}
});

test('funded target-free hand motion is public numeric pose but never an object indication',()=>{
  let hidden=null;
  const f=fixture({listenerSight:(_,to,ordinary)=>ordinary(_,to)&&
    (!hidden||Math.hypot(to.x-hidden.x,to.y-hidden.y)>1e-8)});
  try{
    // This source fixture advances the eligibility clock only; the gesture
    // itself must still complete through ordinary funded NPC ticks.
    initializeFreeHandSession(f.sender);
    f.state.elapsed=FREE_HAND_RULES.cooldownSeconds;
    for(const actor of f.state.agents)actor.elapsed=f.state.elapsed;
    f.state.environment.elapsed=f.state.elapsed;
    f.state.environment.ecology.elapsed=f.state.elapsed;
    assert.equal(requestNpcAction(f.sender,{type:'free_hand'},f.state.environment).code,'ACTION_STARTED');
    assert.equal(publicFreeHandGeometry(f.sender),null,'Admission has not paid for a visible segment');
    f.advance(.25);
    const publicPose=publicFreeHandGeometry(f.sender);
    assert(publicPose&&publicPose.progress>0);
    assert.equal(publicIndicationGeometry(f.sender),null);
    const received=f.attachment.readGestureMemory(f.listener).records.at(-1);
    const own=f.attachment.readGestureMemory(f.sender).records.at(-1);
    const ownCounts=()=>f.attachment.measurementSnapshot().actors.find(
      row=>row.id===f.sender.id).freeHandObserver;
    assert.equal(received.visibility,'pose');
    assert.deepEqual(Object.keys(received.pose).sort(),['origin','progress','tip']);
    assert.equal(received.pose.tip.dx,publicPose.tip.x-f.listener.position.x);
    assert.equal(received.self.freeHandActive,0,'Peer action identity is not a sensory feature');
    assert.equal(own.visibility,'absent');
    assert.equal(own.self.freeHandActive,1);
    assert.equal(own.self.freeHandPose.progress,publicPose.progress);
    assert.equal(own.self.freeHandPose.tip.dx,publicPose.tip.x-f.sender.position.x);
    assert(ownCounts().lifecycle.ownPoseSamples>0,
      'Only accepted actor-local funded pose rows count own motion sight');
    assert.equal(ownCounts().lifecycle.admitted,1);
    assert.equal(ownCounts().lifecycle.firstPaid,1);
    assert.equal(ownCounts().lifecycle.pending,1);
    const counts=()=>f.attachment.measurementSnapshot().actors.find(row=>row.id===f.listener.id).freeHandObserver;
    const seen=counts();
    assert(seen.visibleSamples>0,'Only actual locally visible funded samples are counted');
    assert(seen.sampleCounts.pose>=seen.visibleSamples);
    assert.equal(seen.sampleCounts.unknown,0);
    assert.deepEqual(counts(),seen,'Repeated observer reads cannot count a new sighting');
    const copiedCounts=counts();copiedCounts.sampleCounts.pose=999;
    assert.notEqual(counts().sampleCounts.pose,999);
    const copiedOwn=ownCounts();copiedOwn.lifecycle.interrupted.OTHER=999;
    copiedOwn.lifecycle.ownPoseSamples=999;
    assert.notEqual(ownCounts().lifecycle.interrupted.OTHER,999);
    assert.notEqual(ownCounts().lifecycle.ownPoseSamples,999);
    assert.deepEqual(actorGesturePredictionFeatures(own).slice(-4),[
      1,publicPose.progress,
      (publicPose.tip.x-publicPose.origin.x)/24,
      (publicPose.tip.y-publicPose.origin.y)/24]);
    assert.equal(observeIndication(f.listener,f.sender,f.state).reason,'invalid-gesture',
      'The target-free pose cannot enter the object reference parser');
    const copied=f.attachment.readGestureMemory(f.sender);
    copied.records.at(-1).self.freeHandPose.tip.dx=999;
    assert.notEqual(f.attachment.readGestureMemory(f.sender).records.at(-1).self.freeHandPose.tip.dx,999);
    hidden={x:(publicPose.origin.x+publicPose.tip.x)/2,
      y:(publicPose.origin.y+publicPose.tip.y)/2};
    f.step();
    const occluded=f.attachment.readGestureMemory(f.listener).records.at(-1);
    assert.equal(occluded.visibility,'unknown');
    assert(occluded.peer,'The peer remains visible although the paid segment is not');
    assert.equal(counts().visibleSamples,seen.visibleSamples,'Occlusion is not a visible pose sample');
    assert.equal(counts().sampleCounts.unknown,seen.sampleCounts.unknown+1);
    hidden=null;
    cancelNpcAction(f.sender,'TEST_INTERRUPTION');f.step();
    assert.equal(ownCounts().lifecycle.interrupted.OTHER,1);
    assert.equal(ownCounts().lifecycle.pending,0);
    assert.equal(ownCounts().lifecycle.completed,0);
    assert.equal(publicFreeHandGeometry(f.sender),null);
    assert.equal(f.attachment.readGestureMemory(f.listener).records.at(-1).visibility,'absent');
    assert.equal(counts().visibleSamples,seen.visibleSamples,'Visible absence is not a motion sample');
    assert.equal(counts().sampleCounts.absent,seen.sampleCounts.absent+1);
  }finally{f.attachment.dispose();}
});

test('measurement exposes bounded local summaries and frozen score totals without rows or weights',()=>{
  const f=fixture();
  try{
    f.step();
    const before=structuredClone(f.state),first=f.attachment.measurementSnapshot(),
      actor=first.actors.find(row=>row.id===f.listener.id),
      local=f.attachment.readGestureMemory(f.listener),
      prediction=f.attachment.readGesturePrediction(f.listener);
    assert.deepEqual(actor.gestureMemory,{retained:local.records.length,
      overflows:local.overflows,expirations:local.expirations,
      limits:local.limits,sessionResets:0,saturated:false});
    assert.deepEqual(actor.gesturePrediction,prediction);
    assert.equal(actor.gesturePrediction.forecasts,1);
    assert(!Object.hasOwn(actor.gesturePrediction,'weights'));
    assert(!Object.hasOwn(actor.gestureMemory,'records'));
    actor.gestureMemory.limits.capacity=1;
    actor.gesturePrediction.scores.model.brier=999;
    actor.freeHandObserver.sampleCounts.absent=999;
    const again=f.attachment.measurementSnapshot().actors.find(row=>row.id===f.listener.id);
    assert.equal(again.gestureMemory.limits.capacity,768);
    assert.notEqual(again.gesturePrediction.scores.model.brier,999);
    assert.notEqual(again.freeHandObserver.sampleCounts.absent,999);
    assert.deepEqual(f.state,before,'Repeated summary reads cannot alter the world');
  }finally{f.attachment.dispose();}
});

test('future local pose targets settle only after 30 actual consecutive main-world samples',()=>{
  const f=fixture();
  try{
    assert.equal(f.attachment.readGesturePrediction(f.listener).forecasts,0);
    f.step();
    let prediction=f.attachment.readGesturePrediction(f.listener);
    assert.equal(prediction.pending,true);
    assert.equal(prediction.validTargets,0);
    for(let i=0;i<29;i++)f.step();
    assert.equal(f.attachment.readGesturePrediction(f.listener).validTargets,0,
      'The current frame and the first 29 future frames cannot label a forecast');
    f.step();
    prediction=f.attachment.readGesturePrediction(f.listener);
    assert.equal(prediction.validTargets,1);
    assert.equal(prediction.targetAbsent,1);
    assert.equal(prediction.updates,1);
    f.start();
    const before=f.attachment.readGesturePrediction(f.listener);
    f.advance(.6);
    prediction=f.attachment.readGesturePrediction(f.listener);
    assert(prediction.targetPose>before.targetPose,
      'A later personally visible paid public pose supplies a future target');
    assert.equal(prediction.updates,prediction.validTargets);
    assert(!('weights' in prediction)&&!('features' in prediction),
      'The actor-local readout is aggregate, not a model or partner-data export');
    const saved=JSON.stringify(f.attachment.exportPersistence());
    prediction.scores.model.brier=999;
    prediction.limits.horizonTicks=0;
    assert.notEqual(f.attachment.readGesturePrediction(f.listener).scores.model.brier,999);
    assert.equal(f.attachment.readGesturePrediction(f.listener).limits.horizonTicks,30);
    assert.equal(JSON.stringify(f.attachment.exportPersistence()),saved,
      'Prediction inspection cannot alter durable character or RNG state');
  }finally{f.attachment.dispose();}
});

test('live actor-local unknown sight censors a pending forecast without labeling silence',()=>{
  let hidden=false;
  const f=fixture({listenerSight:(from,to,ordinary)=>hidden?false:ordinary(from,to)});
  try{
    f.step();
    assert.equal(f.attachment.readGesturePrediction(f.listener).pending,true);
    hidden=true;f.step();
    const censored=f.attachment.readGesturePrediction(f.listener);
    assert.equal(f.attachment.readGestureMemory(f.listener).records.at(-1).visibility,'unknown');
    assert.equal(censored.censoredUnknown,1);
    assert.equal(censored.validTargets,0);
    assert.equal(censored.updates,0);
    assert.equal(censored.targetAbsent,0,'Unknown sight must never be a negative target');
    hidden=false;f.step();
    for(let i=0;i<30;i++)f.step();
    const visible=f.attachment.readGesturePrediction(f.listener);
    assert.equal(visible.targetAbsent,1,'Only restored continuous sight can label visible absence');
    assert.equal(visible.updates,1);
  }finally{f.attachment.dispose();}
});

test('peer occlusion and a partly hidden paid segment are unknown, and break continuity',()=>{
  let hiddenPeer=false,hiddenSegment=null;
  const f=fixture({listenerSight:(from,to,ordinary)=>{
    if(hiddenPeer&&Math.hypot(to.x-f.sender.position.x,to.y-f.sender.position.y)<1e-8)return false;
    if(hiddenSegment&&Math.hypot(to.x-hiddenSegment.x,to.y-hiddenSegment.y)<1e-8)return false;
    return ordinary(from,to);
  }});
  try{
    f.start();f.advance(.15);
    assert.equal(f.attachment.readGestureMemory(f.listener).records.at(-1).visibility,'pose');
    const pose=publicIndicationGeometry(f.sender);
    assert(pose);
    // The segment is checked at integer positions; its midpoint is a sampled point.
    const beforeOcclusion=f.attachment.readGesturePrediction(f.listener);
    assert.equal(beforeOcclusion.pending,true);
    hiddenSegment={x:(pose.origin.x+pose.tip.x)/2,y:(pose.origin.y+pose.tip.y)/2};
    f.step();
    let row=f.attachment.readGestureMemory(f.listener).records.at(-1);
    assert.equal(row.visibility,'unknown');assert(row.peer);
    let prediction=f.attachment.readGesturePrediction(f.listener);
    assert.equal(prediction.censoredUnknown,beforeOcclusion.censoredUnknown+1);
    assert.equal(prediction.validTargets,beforeOcclusion.validTargets,
      'A partly hidden paid segment cannot become a future absence label');
    hiddenSegment=null;f.step();
    row=f.attachment.readGestureMemory(f.listener).records.at(-1);
    assert.equal(row.visibility,'pose');assert.equal(row.continuousVisible,false);
    hiddenPeer=true;f.step();
    row=f.attachment.readGestureMemory(f.listener).records.at(-1);
    assert.equal(row.visibility,'unknown');assert.equal(row.peer,null);
    prediction=f.attachment.readGesturePrediction(f.listener);
    assert.equal(prediction.censoredUnknown,beforeOcclusion.censoredUnknown+2);
    hiddenPeer=false;f.step();
    row=f.attachment.readGestureMemory(f.listener).records.at(-1);
    assert.equal(row.visibility,'absent','The ordinary transaction was interrupted by lost peer sight');
    assert.equal(row.continuousVisible,false);
    assert.equal(sensePublicPeerGesture(f.listener,{...f.sender,scene:'other'}).visibility,'unknown');
  }finally{f.attachment.dispose();}
});

test('generic visible absence uses ordinary sight rather than the narrower reference-admission radius',()=>{
  const f=fixture({listenerSight:()=>true});
  try{
    f.sender.position={x:f.listener.position.x+300,y:f.listener.position.y};
    const sensed=sensePublicPeerGesture(f.listener,f.sender);
    assert.equal(sensed.visibility,'absent','A clearly seen peer at 300 units has no public pose');
    assert.equal(sensed.peer.dx,300);
    f.sender.position={x:f.listener.position.x+401,y:f.listener.position.y};
    assert.equal(sensePublicPeerGesture(f.listener,f.sender).visibility,'unknown');
  }finally{f.attachment.dispose();}
});

test('an unavailable local observer cannot certify a peer pose or absence',()=>{
  const f=fixture();
  try{
    f.listener.lifecycle='COLLAPSED';
    assert.equal(sensePublicPeerGesture(f.listener,f.sender).visibility,'unknown');
    f.listener.lifecycle='AWAKE';f.listener.position.x=NaN;
    assert.equal(sensePublicPeerGesture(f.listener,f.sender).visibility,'unknown');
  }finally{f.attachment.dispose();}
});

test('interrupted actions, identity changes, censor, disposal and reopen erase only session gesture evidence',()=>{
  const f=fixture();
  try{
    f.start();f.advance(.15);
    const before=f.attachment.exportPersistence();
    assert(f.attachment.readGestureMemory(f.listener).records.some(row=>row.visibility==='pose'));
    cancelNpcAction(f.sender,'TEST_INTERRUPTION');f.step();
    assert.equal(f.attachment.readGestureMemory(f.listener).records.at(-1).visibility,'absent');
    const values=new Map(),storage={getItem:key=>values.get(key)??null,
      setItem:(key,value)=>values.set(key,value)};
    f.state.environment.elapsed=f.state.elapsed;f.state.environment.ecology.elapsed=f.state.elapsed;
    assert.equal(writeOzarkSave(storage,f.state,geometry,{referencePersistence:before}),true);
    const reopened=loadOzarkSave(storage,geometry);
    assert.equal(reopened.blocked,false);
    const reopenedAttachment=fixture({state:reopened.state}).attachment;
    assert.deepEqual(reopenedAttachment.readGestureMemory(reopened.state.agents[1]).records,[]);
    assert.equal(reopenedAttachment.readGesturePrediction(reopened.state.agents[1]).forecasts,0);
    reopenedAttachment.dispose();
    f.sender.epoch++;
    assert.equal(f.attachment.readGestureMemory(f.listener),null,'A stale epoch fails closed before reconciliation');
    f.attachment.beforeTick();
    assert.deepEqual(f.attachment.readGestureMemory(f.listener).records,[]);
    assert.equal(f.attachment.readGesturePrediction(f.listener).validTargets,0);
    f.step();
    f.listener.discovery=structuredClone(f.listener.discovery);
    assert.equal(f.attachment.readGestureMemory(f.sender),null,'A replaced peer cannot leak old rows');
    f.attachment.beforeTick();
    assert.deepEqual(f.attachment.readGestureMemory(f.sender).records,[]);
    assert.equal(f.attachment.readGesturePrediction(f.sender).forecasts,0);
    f.step();f.attachment.censorPending();
    assert.deepEqual(f.attachment.readGestureMemory(f.sender).records,[]);
    assert.equal(f.attachment.readGesturePrediction(f.sender).forecasts,0);
  }finally{f.attachment.dispose();}
  assert.equal(f.attachment.readGestureMemory(f.listener),null);
  assert.equal(f.attachment.readGesturePrediction(f.listener),null);
});

test('hostile observer copies and repeated reads cannot change action, RNG or learner continuation',()=>{
  const original=createOzarkState(geometry,{communicationSeed:211});
  const comparison=createOzarkState(geometry,{communicationSeed:211});
  const predictorDisabled=createOzarkState(geometry,{communicationSeed:211});
  for(const state of [comparison,predictorDisabled])
    for(const key of ['worldLineage','visualReference','characterMessages'])
      state[key]=structuredClone(original[key]);
  const a=fixture({state:original}),b=fixture({enabled:false,state:comparison}),
    c=fixture({predictionEnabled:false,state:predictorDisabled}),all=[a,b,c];
  try{
    for(let i=0;i<12;i++)for(const f of all)f.step();
    for(const f of all)f.start();
    for(let i=0;i<130;i++){
      for(const f of all)f.step();
      const snapshot=a.attachment.readGestureMemory(a.listener);
      if(snapshot.records.length){snapshot.records.at(-1).self.actionActive=99;snapshot.records.length=0;}
      const prediction=a.attachment.readGesturePrediction(a.listener);
      if(prediction){prediction.scores.model.logLoss=999;prediction.pending=false;}
      const observer=a.attachment.measurementSnapshot();
      if(observer?.events.length){observer.events[0].referenceCorrect=false;observer.events[0].targetId='hostile';}
    }
    for(const f of all){
      const reply=f.attachment.hooks.optionalAction(f.listener);
      assert.equal(reply?.type,'indicate_object');
      assert.equal(f.attachment.hooks.performOptional(f.listener,reply).code,'ACTION_STARTED');
    }
    for(let i=0;i<130;i++){for(const f of all)f.step();a.attachment.readGestureMemory(a.sender);}
    assert.equal(a.attachment.measurementSnapshot().counts.senderUpdates,1,
      'Both listeners and the sender have now taken an authentic update path');
    const establishedMeasurement=snapshot=>({...snapshot,
      actors:snapshot.actors.map(({freeHandObserver,gestureMemory,gesturePrediction,...actor})=>actor)});
    for(const f of [b,c]){
      assert.deepEqual(a.attachment.exportPersistence(),f.attachment.exportPersistence(),
        'Private prediction cannot draw RNG or alter either learned model');
      assert.deepEqual(establishedMeasurement(a.attachment.measurementSnapshot()),
        establishedMeasurement(f.attachment.measurementSnapshot()),
        'All established character, body and transaction measurements remain equal');
      assert.equal(f.attachment.measurementSnapshot().actors[0].freeHandObserver.selectedAttempts,0);
      assert.deepEqual(a.state,f.state,'Ordinary action and body state are unchanged');
    }
    assert.equal(b.attachment.readGestureMemory(b.listener),null);
    assert.equal(c.attachment.readGesturePrediction(c.listener),null);
    assert(c.attachment.readGestureMemory(c.listener).records.length>0,
      'The disabled predictor comparison still retains the original gesture memory');
    assert(a.attachment.readGesturePrediction(a.listener).validTargets>0);
  }finally{for(const f of all)f.attachment.dispose();}
});

test('a failed passive sight query discards gesture rows without stopping existing learning',()=>{
  let fail=false;
  const f=fixture({listenerSight:(from,to,ordinary)=>{
    if(fail)throw new Error('synthetic sight failure');
    return ordinary(from,to);
  }});
  try{
    f.step();assert.equal(f.attachment.readGestureMemory(f.listener).records.length,1);
    assert.equal(f.attachment.readGesturePrediction(f.listener).pending,true);
    const before=f.attachment.exportPersistence();
    fail=true;
    assert.doesNotThrow(()=>f.attachment.afterTick());
    assert.deepEqual(f.attachment.readGestureMemory(f.listener).records,[]);
    assert.equal(f.attachment.readGesturePrediction(f.listener).forecasts,0);
    assert.deepEqual(f.attachment.exportPersistence(),before);
  }finally{f.attachment.dispose();}
});
