import test from 'node:test';
import assert from 'node:assert/strict';
import {createOzarkState,loadOzarkSave,writeOzarkSave,getOzarkSaveFailure,OZARK_SAVE_KEY} from '../src/ozark-save.js';
import {createOzarkWorldGeometry} from '../src/ozark-world-geometry.js';
import {bindOzarkWorldAgent} from '../src/ozark-agent-world.js';
import {PopulationRuntime} from '../src/population.js';
import {attachVisualReferenceLearning} from '../src/visual-reference-attachment.js';
import {poolCommunicationPixels} from '../src/communication-pixels.js';
import {senseReferenceObjects} from '../src/visual-reference-perception.js';
import {initialReferenceRandomStates} from '../src/visual-reference-random.js';
import {createFreshCharacterMessages} from '../src/visual-reference-save.js';
import {installVisualReferenceFixture,visualReferenceEvidence,probeVisualReferenceReopen} from '../scripts/visual-reference-native-fixture.mjs';
import {assertStructuralRestoredHistory} from '../scripts/structural-movement-native-contract.mjs';

// Serialized renderer helpers here use synthetic pixels. Actual Canvas proof
// remains an authorized Linux/macOS CI gate.
const serialized=fn=>Function('return ('+fn.toString()+')')();
const durable=reference=>reference.learners.map(({agentId,identity,anchors,partners,counts,character})=>
  ({agentId,identity,anchors,partners,counts,character}));
const senderData=value=>value.characterMessages.learners.find(row=>row.agentId==='aster').sender;
const listenerData=value=>value.characterMessages.learners.find(row=>row.agentId==='mira').partners[0].listener;

async function setup({seed=211,responseScenario=false,ambiguityScenario=false,ambiguousSecond=false}={}){
  const geometry=createOzarkWorldGeometry(),state=createOzarkState(geometry);
  if(seed!==state.visualReference.seed){
    state.visualReference={...state.visualReference,seed,random:initialReferenceRandomStates(seed)};
    state.characterMessages=createFreshCharacterMessages(state.worldLineage,state.visualReference);
  }
  for(const actor of state.agents)bindOzarkWorldAgent(actor,geometry,state);
  const categories=new Map(senseReferenceObjects(state.agents[0],state).bindings.map((id,index)=>[id,index%2]));
  const sensor={capture(actor){
    const visible=senseReferenceObjects(actor,state);
    return new Map(visible.bindings.map((id,index)=>{
      const category=categories.get(id)??index%2;
      const changedFinalOwnView=ambiguousSecond&&actor===state.agents[1]&&state.elapsed>=13.9-1e-8;
      const pixels=Array(768).fill(changedFinalOwnView?100:actor===state.agents[0]?(category?204:26):(category?178:51));
      return [id,{features:poolCommunicationPixels(pixels),pixels,at:actor.elapsed,epoch:actor.epoch}];
    }));
  },dispose(){}};
  const reference=attachVisualReferenceLearning({state,pixelSensor:sensor,protocol:'sequence'});
  const population=new PopulationRuntime(state,{cardinal:false,experimentalDiscovery:reference.hooks});
  const step=()=>{reference.beforeTick();state.elapsed+=1/60;population.tick(1/60);reference.afterTick();};
  const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  const originalPlants=ambiguityScenario?structuredClone(state.environment.ecology.plants):null,
    originalLedger=ambiguityScenario?structuredClone(state.environment.ecology.ledger):null;
  let saved=false;
  const checkpoint=()=>{
    if(saved)return false;
    saved=true;
    return writeOzarkSave(storage,state,geometry,{referencePersistence:reference.exportPersistence()});
  };
  const fixture=await serialized(installVisualReferenceFixture)({state,populationState:population.state,reference,
    geometry,step,fixedStep:1/60,responseScenario,ambiguityScenario,auditSensor:sensor,checkpoint},
    new URL('../',import.meta.url),serialized(visualReferenceEvidence));
  if(ambiguityScenario){
    // Synthetic pixels only: the pre-action authored scene has two distinct
    // candidate classes. Native CI must establish this with actual Canvas.
    categories.set('object:501',0);categories.set('object:505',1);
  }
  return {geometry,state,sensor,reference,population,storage,fixture,originalPlants,originalLedger,
    dispose(){fixture.dispose();reference.dispose();population.dispose();}};
}

function firstPaidExchange(f){
  const {fixture}=f;
  assert.equal(fixture.status().pose,null);
  const choice=fixture.beginChoice();
  assert.match(choice.reference.latest.message,/^[a-z]{1,6}$/);
  assert.equal(choice.reference.latest.choiceMode,'uniform-untrained');
  const choiceCompleted=fixture.completeChoice();
  assert.equal(choiceCompleted.checks.choiceCompletedBeforeIndication,true);
  assert(choiceCompleted.checks.actorGesturePrediction.choice.listener.targetAbsent>=1);
  assert(choiceCompleted.checks.actorGesturePrediction.choice.sender.targetAbsent>=1);
  assert.equal(choiceCompleted.checks.actorGesturePrediction.defensiveReadPure,true);
  assert.equal(fixture.beginIndication().pose,null);
  const during=fixture.visible();
  assert(during.pose);assert.equal(during.checks.visibleCrop.actualCanvas,false);
  assert.equal(during.checks.actorGestureMemory?.paidChoiceVisibleAbsence,true);
  assert.equal(during.checks.actorGestureMemory.forward?.paidPoseObserved,true);
  assert.equal(during.checks.actorGestureMemory.forward.defensiveReadPure,true);
  assert.equal(during.checks.actorGestureMemory.controlledUnknown,true);
  assert.equal(during.checks.actorGesturePrediction.forwardMidpoint.limits.horizonTicks,30);
  const complete=fixture.completeIndication();
  assert.equal(complete.pose,null);
  assert.equal(complete.checks.actorGestureMemory.forwardEndedAsVisibleAbsence,true);
  assert.equal(complete.checks.actorGesturePrediction.forward.actualPaidPose,true);
  assert.equal(complete.checks.actorGesturePrediction.forward.defensiveReadPure,true);
  assert(complete.checks.actorGesturePrediction.forward.listener.targetPose>=1);
  assert(complete.checks.actorGesturePrediction.forward.listener.onsets>=1);
  assert.equal(complete.reference.observed,1);
  assert.equal(complete.reference.latest.listenerUpdate,true);
  assert.equal(complete.checks.listenerLearning.optimizerSteps,1);
  assert.equal(complete.checks.listenerLearning.uniqueDemonstrations,1);
  assert.equal(complete.checks.listenerLearning.actualCanvas,false);
  assert(complete.audit.length>=100);
  assert(complete.checks.payment.expectedActionEffortKcal>0);
  assert.deepEqual(complete.reference.senderFeedback,[]);
  return complete;
}

async function assertReopen(f,checkpoint){
  const {geometry,state,storage,fixture}=f;
  assert.equal(checkpoint.raw,storage.getItem(OZARK_SAVE_KEY));
  assert.equal(checkpoint.expectedRestored.agents[0].active,null);
  assert.equal(checkpoint.serializedInspectionActive.request.type,'inspect_object');
  assert.deepEqual(JSON.parse(checkpoint.raw).characterMessages,
    f.reference.exportPersistence().characterMessages,'Checkpoint retains exact private weights and RNG');
  const interrupted=fixture.interrupt();
  assert.equal(interrupted.checks.interruption.poseCleared,true);
  assert.equal(interrupted.checks.actorGestureMemory.interruptionPublicPoseAbsent,true);
  assert.equal(interrupted.checks.actorGesturePrediction.sameInstantCancellationPure,true);
  const loaded=loadOzarkSave(storage,geometry);
  assert.equal(loaded.blocked,false);
  const beforeCopy=structuredClone(loaded.state);
  const restored=attachVisualReferenceLearning({state:loaded.state,pixelSensor:f.sensor,protocol:'sequence'});
  try{
    const savedCharacters=JSON.parse(checkpoint.raw).characterMessages;
    assert.deepEqual(restored.exportPersistence().characterMessages,savedCharacters);
    assert.equal(restored.snapshot().pending,0);
    assert.deepEqual(restored.readGestureMemory(loaded.state.agents[0]).records,[]);
    assert.deepEqual(restored.readGestureMemory(loaded.state.agents[1]).records,[]);
    for(const actor of loaded.state.agents){
      const prediction=restored.readGesturePrediction(actor);
      assert.equal(prediction.pending,false);
      assert.equal(prediction.forecasts,0);
      assert.equal(prediction.validTargets,0);
      assert.equal(prediction.updates,0);
    }
    assert.deepEqual(restored.snapshot().observationEvents,[]);
    assert.deepEqual(restored.snapshot().senderFeedback,[]);
    assert.deepEqual(durable(restored.snapshot()),durable(checkpoint.report.reference));
    const probe=serialized(probeVisualReferenceReopen);
    const replay=await probe(new URL('../',import.meta.url),structuredClone(loaded.state),
      structuredClone(checkpoint.serializedActive),structuredClone(checkpoint.serializedPermit),
      {pendingKind:checkpoint.pendingKind,
        serializedInspectionActive:structuredClone(checkpoint.serializedInspectionActive),
        serializedDemonstrationActive:structuredClone(checkpoint.serializedDemonstrationActive)});
    assert.equal(replay.noRevivedAuthority,true);
    assert.equal(replay.inspectionCompletion,null);
    assert.equal(replay.inspectionPermit,null);
    assert.equal(replay.responsePermit,null);
    assert.deepEqual(loaded.state,beforeCopy,'Copy-only probe cannot mutate loaded state');
    assertStructuralRestoredHistory(JSON.parse(checkpoint.raw),visualReferenceEvidence(loaded.state));
    assert.equal(writeOzarkSave(storage,loaded.state,geometry,{referencePersistence:restored.exportPersistence()}),true);
    assert.deepEqual(JSON.parse(storage.getItem(OZARK_SAVE_KEY)).characterMessages,savedCharacters,
      'Second ordinary save must export loaded model state exactly');
    const twice=loadOzarkSave(storage,geometry);
    assert.equal(twice.blocked,false);
    const repeated=attachVisualReferenceLearning({state:twice.state,pixelSensor:f.sensor,protocol:'sequence'});
    try{
      assert.deepEqual(repeated.exportPersistence().characterMessages,savedCharacters);
      assert.deepEqual(durable(repeated.snapshot()),durable(restored.snapshot()));
      assert.equal(repeated.snapshot().pending,0);
      assert.deepEqual(repeated.snapshot().observationEvents,[]);
      for(const actor of twice.state.agents){
        const prediction=repeated.readGesturePrediction(actor);
        assert.equal(prediction.pending,false);
        assert.equal(prediction.forecasts,0);
        assert.equal(prediction.updates,0);
      }
      assertStructuralRestoredHistory(JSON.parse(storage.getItem(OZARK_SAVE_KEY)),visualReferenceEvidence(twice.state));
    }finally{repeated.dispose();}
    const wrongWorld=structuredClone(loaded.state);
    wrongWorld.environment.ecology.geometryIdentity='wrong-world';
    await assert.rejects(probe(new URL('../',import.meta.url),wrongWorld,
      checkpoint.serializedActive,checkpoint.serializedPermit,
      {pendingKind:checkpoint.pendingKind,serializedInspectionActive:checkpoint.serializedInspectionActive,
        serializedDemonstrationActive:checkpoint.serializedDemonstrationActive}),/ecology identity does not match/);
    assert.deepEqual(loaded.state,beforeCopy);
    assert.deepEqual(state.agents.map(actor=>actor.active),[null,null]);
  }finally{restored.dispose();}
}

test('serialized sequence fixture retains paid listener learning and discards a pending sampled cue (synthetic pixels)',
  {timeout:180000},async()=>{
    const f=await setup();
    try{
      const initial=f.reference.exportPersistence(),complete=firstPaidExchange(f);
      assert.notDeepEqual(listenerData(f.reference.exportPersistence()).model,listenerData(initial).model);
      assert.deepEqual(senderData(f.reference.exportPersistence()).model,senderData(initial).model);
      assert.deepEqual(f.reference.exportPersistence().visualReference,initial.visualReference,
        'Sequence exchange cannot advance the four legacy streams or relabel anchors');
      assert.equal(complete.checks.replyAvailable,true);
      f.fixture.beginResponse();
      assert(f.fixture.visibleResponse().responsePose);
      const settled=f.fixture.completeResponse();
      assert.equal(settled.reference.pending,0);
      assert.equal(settled.checks.actorGesturePrediction.reply.actualPaidPose,true);
      assert(settled.checks.actorGesturePrediction.reply.sender.targetPose>=1);
      assert(settled.checks.actorGesturePrediction.reply.sender.onsets>=1);
      assert(settled.checks.responsePayment.expectedActionEffortKcal>0);
      const before=f.reference.exportPersistence(),world=f.fixture.project();
      const audit=f.fixture.inspectAssociation().checks.modelAudit;
      assert.equal(audit.readOnly,true);
      assert.deepEqual(audit.untrained.probabilities,[.5,.5]);
      assert.deepEqual(audit.known.probabilities,audit.reversed.probabilities.slice().reverse());
      assert.deepEqual(f.reference.exportPersistence(),before);
      assert.deepEqual(f.fixture.project(),world);
      assert.equal(writeOzarkSave(f.storage,f.state,f.geometry,{referencePersistence:initial}),false);
      assert.equal(getOzarkSaveFailure(f.state),'reference-export-stale');
      assert.equal(f.storage.getItem(OZARK_SAVE_KEY),null);
      const pending=f.fixture.pendingForSave();
      assert.equal(pending.phase,'pending-save');
      assert.match(pending.checks.pendingSenderMessage.message,/^[a-z]{1,6}$/);
      assert.equal(pending.reference.latest.senderUpdate,false);
      const saved=f.fixture.checkpoint(f.storage);
      assert(saved);assert.equal(f.fixture.checkpoint(f.storage),null);
      assert.equal(saved.report.checks.actorGesturePrediction.saveExcluded,true);
      assert.equal(saved.pendingKind,'sender-demonstration');
      await assertReopen(f,saved);
    }finally{f.dispose();}
  });

test('fixed authored native vantage makes an actually paid reply ambiguous without sender training (synthetic pixels)',
  {timeout:180000},async()=>{
    const f=await setup({ambiguityScenario:true});
    try{
      const placed=f.fixture.status().checks.authoredAmbiguity;
      assert.deepEqual(placed.senderPlaced,{x:-12943,y:3595});
      assert.deepEqual(placed.listenerPlaced,{x:-12827,y:3543});
      assert.equal(placed.forwardCandidateCount,2);
      assert.deepEqual(placed.forwardCandidateIds,['object:501','object:505']);
      assert.deepEqual(placed.objectSwap.bramble,{id:'object:504',kind:'bramble',
        original:{x:-12876.9761711114,y:3676.0703545399747},
        placed:{x:-12637.114480087068,y:3800.9655602960443}});
      assert.deepEqual(placed.objectSwap.tree,{id:'object:505',kind:'apple_tree',
        original:{x:-12637.114480087068,y:3800.9655602960443},
        placed:{x:-12876.9761711114,y:3676.0703545399747}});
      const expectedPlants=structuredClone(f.originalPlants);
      expectedPlants.find(plant=>plant.id==='object:504').position=placed.objectSwap.bramble.placed;
      expectedPlants.find(plant=>plant.id==='object:505').position=placed.objectSwap.tree.placed;
      assert.deepEqual(f.state.environment.ecology.plants,expectedPlants,
        'Only positions of two existing rendered plants may change in the engineering fixture');
      assert.deepEqual(f.state.environment.ecology.ledger,f.originalLedger,'Fixture adds no resources');
      const beforeWorld=f.fixture.project(),beforeReference=f.reference.snapshot(),beforePersistence=f.reference.exportPersistence(),
        admission=f.fixture.admissionAudit();
      assert.equal(admission.actualCanvas,false);
      assert.equal(admission.sight.listenerComplete,true);
      assert.equal(admission.sight.senderComplete,true);
      assert.equal(admission.genericGates.peerFound,true);
      assert.equal(admission.validForwardCandidates,2);
      assert.equal(admission.pairCount,1);assert.equal(admission.qualifiedPairs,1);
      assert.deepEqual(admission.pairs[0].ids,['object:501','object:505']);
      assert(admission.pairs[0].ownRms>=admission.featureDistance&&
        admission.pairs[0].senderRms>=admission.featureDistance);
      assert(Object.values(admission.pure).every(Boolean));
      assert.deepEqual(f.fixture.admissionAudit(),admission,'Repeated pre-action audits cannot draw learner RNG');
      assert.deepEqual(f.fixture.project(),beforeWorld);
      assert.deepEqual(f.reference.snapshot(),beforeReference);
      assert.deepEqual(f.reference.exportPersistence(),beforePersistence);
      const original=f.reference.exportPersistence(),complete=firstPaidExchange(f);
      assert.equal(complete.reference.latest.listenerUpdate,true);
      assert.equal(complete.checks.listenerLearning.uniqueDemonstrations,1);
      f.fixture.beginResponse();
      const visible=f.fixture.visibleResponse();
      assert(visible.responsePose);
      assert.equal(visible.responseAudit.at(-1).reason,'ambiguous');
      const settled=f.fixture.completeResponse(),sender=senderData(f.reference.exportPersistence());
      assert.equal(settled.checks.actorGesturePrediction.reply.actualPaidPose,true);
      assert(settled.checks.actorGesturePrediction.reply.sender.targetPose>=1);
      assert.equal(settled.reference.latest.feedbackStatus,'censored');
      assert.equal(settled.reference.latest.feedbackReason,'response-ambiguous');
      assert.equal(settled.reference.pending,0);
      assert.equal(settled.responsePose,null);
      assert(Math.abs(settled.checks.responsePayment.canonicalWorkSeconds-1.8)<1e-7);
      assert(settled.checks.responseAmbiguity.paidVisibleSamples>=30);
      assert.equal(settled.checks.responseAmbiguity.actualSenderObservation,true);
      assert.equal(settled.checks.senderLearning.updated,false);
      assert.equal(sender.updates,0);
      assert.equal(sender.baseline,0);
      assert.deepEqual(sender.model,senderData(original).model);
      assert.equal(listenerData(f.reference.exportPersistence()).demonstrations,1);
      assert.equal(listenerData(f.reference.exportPersistence()).optimizerSteps,1);
      assert.deepEqual(settled.reference.senderFeedback,[]);
    }finally{f.dispose();}
  });

test('pre-action audit separates missing Canvas crops from below-threshold numeric pairs without sampling a message',async()=>{
  const f=await setup({ambiguityScenario:true});
  try{
    const before=f.reference.exportPersistence(),capture=f.sensor.capture;
    f.sensor.capture=actor=>actor===f.state.agents[0]?new Map():capture(actor);
    const missing=f.fixture.admissionAudit();
    assert.equal(missing.validForwardCandidates,0);
    assert.equal(missing.qualifiedPairs,0);
    assert(missing.rows.some(row=>row.numericForward&&row.senderCrop.present===false));
    assert(Object.values(missing.pure).every(Boolean));
    const pixels=Array(768).fill(77),features=poolCommunicationPixels(pixels);
    f.sensor.capture=actor=>new Map([...capture(actor)].map(([id,crop])=>[id,{...crop,pixels,features}]));
    const indistinct=f.fixture.admissionAudit();
    assert.equal(indistinct.validForwardCandidates,2);
    assert.equal(indistinct.pairCount,1);
    assert.equal(indistinct.qualifiedPairs,0);
    assert.equal(indistinct.pairs[0].ownRms,0);
    assert.equal(indistinct.pairs[0].senderRms,0);
    assert(Object.values(indistinct.pure).every(Boolean));
    assert.deepEqual(f.reference.exportPersistence(),before);
    assert.equal(f.reference.snapshot().exchanges,0);
  }finally{f.dispose();}
});

test('serialized seed-212 negative control saves a paid pending reply after a genuine mismatch update (synthetic pixels)',
  {timeout:180000},async()=>{
    const f=await setup({seed:212,responseScenario:true});
    try{
      assert.deepEqual(f.state.agents[0].position,{x:276,y:760});
      assert.deepEqual(f.state.agents[1].position,{x:230,y:960});
      assert(f.fixture.status().checks.authoredGeometry.forwardAndReverseCandidateCount>=2);
      const complete=firstPaidExchange(f);
      assert.equal(complete.reference.latest.referenceCorrect,false);
      assert.notEqual(complete.privateWitness.choice.targetId,complete.privateWitness.targetId);
      assert.equal(complete.reference.learners.find(row=>row.agentId==='mira').character.uniqueDemonstrations,1);
      const originalMessage=complete.reference.latest.message;
      f.fixture.beginResponse();
      const visible=f.fixture.visibleResponse();
      assert(visible.responsePose);assert.equal(visible.checks.responseVisible.actualCanvas,false);
      const settled=f.fixture.completeResponse();
      assert.equal(settled.checks.actorGesturePrediction.reply.actualPaidPose,true);
      assert(settled.checks.actorGesturePrediction.reply.sender.targetPose>=1);
      assert.equal(settled.reference.latest.message,originalMessage);
      assert.equal(settled.reference.latest.feedbackStatus,'mismatched');
      assert.equal(settled.reference.latest.senderUpdate,true);
      assert.equal(settled.reference.senderFeedback.length,0);
      assert.equal(settled.checks.senderFeedback.signal,'mismatch');
      assert.equal(settled.checks.senderFeedback.senderOnly,true);
      assert.equal(settled.checks.senderLearning.updates,1);
      assert(Math.abs(settled.checks.senderLearning.baseline+.05)<1e-12);
      assert.equal(settled.privateWitness.responseTargetId,complete.privateWitness.choice.targetId);
      assert(settled.checks.responsePayment.expectedActionEffortKcal>0);
      f.fixture.inspectAssociation();
      const pending=f.fixture.pendingResponseForSave();
      assert.equal(pending.phase,'pending-response-save');
      assert.equal(pending.checks.secondLabel.actualCanvas,false);
      assert.equal(pending.checks.secondLabel.updated,true);
      assert([0,1].includes(pending.checks.secondLabel.classifiedLabel));
      assert.equal(pending.checks.secondLabel.demonstrations,2);
      assert.equal(pending.checks.secondLabel.optimizerSteps,2);
      assert.equal(pending.checks.secondLabel.replayUses,1);
      assert.deepEqual(pending.checks.secondLabel.candidatePixels.map(poolCommunicationPixels),
        pending.checks.secondLabel.candidateFeatures);
      assert(pending.responsePose);
      assert.equal(pending.reference.latest.feedbackStatus,'responding');
      assert.equal(pending.reference.pending,1);
      assert.equal(pending.reference.senderFeedback.length,0);
      assert.equal(senderData(f.reference.exportPersistence()).updates,1);
      const saved=f.fixture.checkpoint(f.storage);
      assert(saved);assert.equal(saved.pendingKind,'listener-response');
      await assertReopen(f,saved);
    }finally{f.dispose();}
  });

test('second synthetic own-view ambiguity censors only listener learning before a paid pending reply',
  {timeout:180000},async()=>{
    const f=await setup({seed:212,responseScenario:true,ambiguousSecond:true});
    try{
      firstPaidExchange(f);
      f.fixture.beginResponse();f.fixture.visibleResponse();f.fixture.completeResponse();
      f.fixture.inspectAssociation();
      const before=listenerData(f.reference.exportPersistence());
      const pending=f.fixture.pendingResponseForSave(),audit=pending.checks.secondLabel,
        after=listenerData(f.reference.exportPersistence());
      assert.equal(pending.reference.latest.correction,'ambiguous-own-view');
      assert.equal(audit.actualCanvas,false);
      assert.equal(audit.updated,false);
      assert.equal(audit.classifiedLabel,null);
      assert.equal(audit.demonstrations,1);
      assert.equal(audit.optimizerSteps,1);
      assert.equal(audit.replayUses,0);
      assert.deepEqual(after.model,before.model);
      assert.deepEqual(after.examples,before.examples);
      assert.equal(after.replayState,before.replayState);
      const saved=f.fixture.checkpoint(f.storage);
      assert(saved);assert.equal(saved.pendingKind,'listener-response');
      await assertReopen(f,saved);
    }finally{f.dispose();}
  });
