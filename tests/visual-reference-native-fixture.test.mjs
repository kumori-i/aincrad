import test from 'node:test';
import assert from 'node:assert/strict';
import {createOzarkState,loadOzarkSave,writeOzarkSave,getOzarkSaveFailure,OZARK_SAVE_KEY} from '../src/ozark-save.js';
import {createOzarkWorldGeometry} from '../src/ozark-world-geometry.js';
import {bindOzarkWorldAgent} from '../src/ozark-agent-world.js';
import {PopulationRuntime} from '../src/population.js';
import {attachVisualReferenceLearning} from '../src/visual-reference-attachment.js';
import {poolCommunicationPixels} from '../src/communication-pixels.js';
import {senseReferenceObjects,observeIndication} from '../src/visual-reference-perception.js';
import {createReferenceRandomStream,initialReferenceRandomStates} from '../src/visual-reference-random.js';
import {installVisualReferenceFixture,visualReferenceEvidence,probeVisualReferenceReopen} from '../scripts/visual-reference-native-fixture.mjs';
import {assertStructuralRestoredHistory} from '../scripts/structural-movement-native-contract.mjs';
const serialized=fn=>Function('return ('+fn.toString()+')')();
const durable=reference=>reference.learners.map(({agentId,identity,anchors,partners,counts})=>
  ({agentId,identity,anchors,partners,counts}));

test('fixed negative-control stream arithmetic makes the first seed-212 exploration choose the other candidate',()=>{
  const target=Math.floor(createReferenceRandomStream({seed:212,purpose:'target'})()*2);
  const forward=createReferenceRandomStream({seed:212,purpose:'order'})()<.5;
  const slot=Math.floor(createReferenceRandomStream({seed:212,purpose:'choice'})()*2);
  const selected=forward?slot:1-slot;
  assert.deepEqual({target,forward,slot,selected},{target:0,forward:true,slot:1,selected:1});
  assert.notEqual(selected,target);
});

test('serialized native fixture exercises paid sender response and reopen lifecycle (synthetic sensor; not native or pixel evidence)',{timeout:180000},async()=>{
  const geometry=createOzarkWorldGeometry(),state=createOzarkState(geometry);
  for(const n of state.agents)bindOzarkWorldAgent(n,geometry,state);
  const sensor={capture(n){const s=senseReferenceObjects(n,state);return new Map(s.bindings.map((id,i)=>{
    // Deliberately distinct own views prove that sender feedback cannot copy
    // the listener demonstration. This is a synthetic contract, not Canvas evidence.
    const pixels=Array(768).fill(n===state.agents[0]?(i%2?204:26):(i%2?178:51));
    return [id,{features:poolCommunicationPixels(pixels),pixels,at:n.elapsed,epoch:n.epoch}];}));},dispose(){}};
  const reference=attachVisualReferenceLearning({state,pixelSensor:sensor});
  const exportBeforeCorrection=reference.exportPersistence();
  const population=new PopulationRuntime(state,{cardinal:false,experimentalDiscovery:reference.hooks});
  const step=()=>{reference.beforeTick();state.elapsed+=1/60;population.tick(1/60);reference.afterTick();};
  const values=new Map(),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};let saved=false;
  const checkpoint=()=>{if(saved)return false;saved=true;return writeOzarkSave(storage,state,geometry,
    {referencePersistence:reference.exportPersistence()});};
  const fixture=await serialized(installVisualReferenceFixture)({state,populationState:population.state,reference,geometry,step,fixedStep:1/60,auditSensor:sensor,checkpoint,auditAssociation:reference.createNativeAssociationAuditReader()},new URL('../',import.meta.url),serialized(visualReferenceEvidence));
  try{
    assert.equal(fixture.status().pose,null);
    fixture.beginChoice();const choice=fixture.completeChoice();assert.equal(choice.checks.choiceCompletedBeforeIndication,true);
    fixture.beginIndication();const during=fixture.visible();assert(during.pose);assert.equal(during.checks.visibleCrop.actualCanvas,false);
    const complete=fixture.completeIndication();assert.equal(complete.reference.observed,1);assert.equal(complete.reference.updates,1);assert.equal(complete.reference.evidenceAdditions,1);assert.equal(complete.pose,null);
    assert.equal(complete.reference.pending,1);assert.equal(complete.reference.latest.feedbackStatus,'awaiting-response');
    assert.deepEqual(complete.reference.senderFeedback,[],'Listener association precedes sender feedback');
    assert.equal(writeOzarkSave(storage,state,geometry,{referencePersistence:exportBeforeCorrection}),false,
      'A completed own-view correction cannot be replaced by a cached pre-correction export');
    assert.equal(getOzarkSaveFailure(state),'reference-export-stale');
    assert.equal(storage.getItem(OZARK_SAVE_KEY),null);
    assert(complete.checks.payment.expectedActionEffortKcal>0);assert(complete.audit.length>=100);
    const startedResponse=fixture.beginResponse();assert.equal(startedResponse.responsePose,null);
    assert.deepEqual(startedResponse.reference.senderFeedback,[],'Starting an unpaid response gives no signal');
    const duringResponse=fixture.visibleResponse();assert(duringResponse.responsePose);
    assert.equal(duringResponse.checks.responseVisible.actualCanvas,false);
    assert(duringResponse.responseAudit.length>=23);assert.deepEqual(duringResponse.reference.senderFeedback,[]);
    const responded=fixture.completeResponse();assert.equal(responded.responsePose,null);assert.equal(responded.reference.pending,0);
    assert.equal(responded.reference.senderFeedback.length,1);assert(responded.responseAudit.length>=100);
    assert.equal(responded.checks.senderFeedback.senderOnly,true);
    assert.deepEqual(responded.checks.senderFeedback.features,responded.checks.senderFeedback.senderObservedFeatures);
    assert.notDeepEqual(responded.checks.senderFeedback.features,responded.checks.senderFeedback.listenerComparisonFeatures,
      'Synthetic differing listener view cannot be copied into sender feedback');
    assert(responded.checks.responsePayment.expectedActionEffortKcal>0);
    const beforeAudit=fixture.project(),beforeMemory=reference.snapshot();
    const audit=fixture.inspectAssociation().checks.retrievalDiagnostic;
    assert.equal(audit.readOnly,true);assert.deepEqual(audit.eligibleDistributions.absent,[.5,.5]);
    assert.notDeepEqual(audit.eligibleDistributions.known,audit.eligibleDistributions.absent);
    assert.deepEqual(audit.eligibleDistributions.reversed,audit.eligibleDistributions.known.slice().reverse());
    assert.deepEqual(fixture.project(),beforeAudit);assert.deepEqual(reference.snapshot(),beforeMemory);
    fixture.pendingForSave();const checkpoint=fixture.checkpoint(storage);assert(checkpoint);assert.equal(fixture.checkpoint(storage),null);
    assert.equal(checkpoint.raw,storage.getItem(OZARK_SAVE_KEY));assert.equal(checkpoint.expectedRestored.agents[0].active,null);
    assert.deepEqual(durable(checkpoint.report.reference),durable(beforeMemory));
    const interrupted=fixture.interrupt();assert.equal(interrupted.checks.interruption.poseCleared,true);
    const original=fixture.project();
    const reopened=loadOzarkSave(storage,geometry).state,reopenedBefore=structuredClone(reopened);
    const reopenedReference=attachVisualReferenceLearning({state:reopened,pixelSensor:sensor});
    try{
      const retained=reopenedReference.snapshot();
      assert.deepEqual(durable(retained),durable(checkpoint.report.reference),'Actual own-view association survives independent load');
      assert.equal(retained.pending,0);assert.equal(retained.correctionAttempts,0);assert.equal(retained.updates,0);
      assert.deepEqual(retained.observationEvents,[],'Reopen cannot replay a correction or restore event authority');
      assert.deepEqual(retained.senderFeedback,[],'Sender feedback is session evidence and cannot survive reopen');
      const observed=checkpoint.report.reference.observationEvents.find(event=>event.status==='observed');
      assert(observed);
      const base={listenerId:observed.receiverId,senderId:observed.senderId},candidates=audit.candidateViews.map(view=>view.features);
      const beforeQuery=reopenedReference.snapshot();
      assert.deepEqual(reopenedReference.inspectPersistedAssociation({...base,symbol:audit.symbol,candidateFeatures:candidates}),audit.known);
      assert.deepEqual(reopenedReference.inspectPersistedAssociation({...base,symbol:audit.symbol,candidateFeatures:candidates.slice().reverse()}),audit.reversed);
      assert.deepEqual(reopenedReference.inspectPersistedAssociation({...base,symbol:audit.absent.symbol,candidateFeatures:candidates}),audit.absent.choice);
      assert.deepEqual(reopenedReference.snapshot(),beforeQuery,'Read-only retained-memory retrieval cannot train');
      assert.deepEqual(reopened,reopenedBefore,'Restoring private memory cannot modify world state');
    // Native fullSnapshot plus IPC produces detached data, not loadOzarkSave's
    // runtime-bound ecology. Exercise that exact boundary, including both reopens.
    const probe=serialized(probeVisualReferenceReopen);
    const replay=await probe(new URL('../',import.meta.url),structuredClone(reopened),structuredClone(checkpoint.serializedActive),structuredClone(checkpoint.serializedPermit));
    assert.equal(replay.noRevivedAuthority,true);assert.deepEqual(reopened,reopenedBefore,'Copy-only diagnostic cannot mutate restored main state');
    assertStructuralRestoredHistory(JSON.parse(checkpoint.raw),visualReferenceEvidence(reopened));
    assert.equal(writeOzarkSave(storage,reopened,geometry,{referencePersistence:reopenedReference.exportPersistence()}),true,
      'Actual restored state remains strictly saveable after diagnostic');
    const twice=loadOzarkSave(storage,geometry).state;
    assert.deepEqual(visualReferenceEvidence(twice),visualReferenceEvidence(reopened),'Second reopen cannot duplicate interruption or change history');
    assertStructuralRestoredHistory(JSON.parse(storage.getItem(OZARK_SAVE_KEY)),visualReferenceEvidence(twice));
    assert.equal((await probe(new URL('../',import.meta.url),structuredClone(twice),structuredClone(checkpoint.serializedActive),structuredClone(checkpoint.serializedPermit))).noRevivedAuthority,true);
    const twiceReference=attachVisualReferenceLearning({state:twice,pixelSensor:sensor});
    try{
      assert.deepEqual(durable(twiceReference.snapshot()),durable(retained),'Second reopen retains exactly the same individual association');
      assert.equal(twiceReference.snapshot().correctionAttempts,0,'Second reopen cannot duplicate correction');
      assert.deepEqual(twiceReference.snapshot().senderFeedback,[],'Repeated reopen cannot revive sender feedback');
    }finally{twiceReference.dispose();}
    const wrongWorld=structuredClone(reopened);wrongWorld.environment.ecology.geometryIdentity='wrong-world';
    await assert.rejects(probe(new URL('../',import.meta.url),wrongWorld,checkpoint.serializedActive,checkpoint.serializedPermit),/ecology identity does not match/);
    assert.deepEqual(fixture.project(),original);
    }finally{reopenedReference.dispose();}
  }finally{fixture.dispose();reference.dispose();population.dispose();}
});

test('serialized negative-control fixture saves a paid pending listener response after an observed wrong choice (synthetic crops; not native Canvas proof)',{timeout:180000},async()=>{
  const geometry=createOzarkWorldGeometry(),state=createOzarkState(geometry);
  state.visualReference={...state.visualReference,seed:212,random:initialReferenceRandomStates(212)};
  for(const actor of state.agents)bindOzarkWorldAgent(actor,geometry,state);
  const sensor={capture(actor){const visible=senseReferenceObjects(actor,state);return new Map(visible.bindings.map((id,index)=>{
    const pixels=Array(768).fill(actor===state.agents[0]?(index%2?204:26):(index%2?178:51));
    return [id,{features:poolCommunicationPixels(pixels),pixels,at:actor.elapsed,epoch:actor.epoch}];}));},dispose(){}};
  const reference=attachVisualReferenceLearning({state,pixelSensor:sensor});
  const population=new PopulationRuntime(state,{cardinal:false,experimentalDiscovery:reference.hooks});
  const step=()=>{reference.beforeTick();state.elapsed+=1/60;population.tick(1/60);reference.afterTick();};
  const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};let saved=false;
  const checkpoint=()=>{if(saved)return false;saved=true;return writeOzarkSave(storage,state,geometry,
    {referencePersistence:reference.exportPersistence()});};
  const fixture=await serialized(installVisualReferenceFixture)({state,populationState:population.state,reference,geometry,step,fixedStep:1/60,responseScenario:true,
    auditSensor:sensor,checkpoint,auditAssociation:reference.createNativeAssociationAuditReader()},new URL('../',import.meta.url),serialized(visualReferenceEvidence));
  try{
    assert.deepEqual(state.agents[0].position,{x:276,y:760},'Engineering placement does not move Aster');
    assert.deepEqual(state.agents[1].position,{x:230,y:960},'The dedicated response profile declares Mira’s authored position');
    assert(fixture.status().checks.authoredGeometry.forwardAndReverseCandidateCount>=2);
    fixture.beginChoice();fixture.completeChoice();fixture.beginIndication();fixture.visible();
    const corrected=fixture.completeIndication();
    assert.equal(corrected.reference.latest.referenceCorrect,false,'Seed 212 deliberately makes the first original choice wrong');
    assert.notEqual(corrected.privateWitness.choice.targetId,corrected.privateWitness.targetId);
    const firstListener=corrected.reference.learners.find(row=>row.agentId==='mira');
    assert.equal(firstListener.counts.examples,1,
      'The listener acquired the correction before it responds');
    const firstEntry=structuredClone(firstListener.partners[0].entries[0]);
    fixture.beginResponse();
    try{fixture.visibleResponse();}catch(error){assert.fail(`${error.message}; sender perception: ${observeIndication(state.agents[0],state.agents[1],state).reason}`);}
    const responded=fixture.completeResponse();
    assert.equal(responded.reference.latest.feedbackStatus,'mismatched');
    assert.equal(responded.reference.senderFeedback[0].signal,'mismatch');
    assert.equal(responded.privateWitness.responseTargetId,corrected.privateWitness.choice.targetId,
      'The native fixture reply must indicate the original paid choice after learning');
    assert.notEqual(responded.privateWitness.responseTargetId,corrected.privateWitness.targetId);
    fixture.inspectAssociation();
    const pending=fixture.pendingResponseForSave();
    assert.equal(pending.phase,'pending-response-save');assert(pending.responsePose);
    assert.equal(pending.reference.latest.feedbackStatus,'responding');
    assert.equal(pending.reference.pending,1);
    assert.equal(pending.reference.senderFeedback.length,1,'Partial second response earns no second sample');
    assert(pending.reference.learners.find(row=>row.agentId==='mira').partners.some(partner=>partner.entries.some(entry=>
      entry.symbol===firstEntry.symbol&&entry.examples.some(example=>JSON.stringify(example)===JSON.stringify(firstEntry.examples[0])))),
    'The first completed own-view example survives the second pending response');
    assert.equal(pending.checks.pendingResponse.originalInspectedId,pending.privateWitness.responseTargetId);
    const savedCheckpoint=fixture.checkpoint(storage);
    assert(savedCheckpoint);assert.equal(savedCheckpoint.pendingKind,'listener-response');
    assert.equal(savedCheckpoint.raw,storage.getItem(OZARK_SAVE_KEY));
    assert.equal(savedCheckpoint.serializedActive.request.type,'indicate_object');
    assert.deepEqual(durable(savedCheckpoint.report.reference),durable(pending.reference));
    const interrupted=fixture.interrupt();assert.equal(interrupted.checks.interruption.pendingKind,'listener-response');
    assert.equal(interrupted.checks.interruption.poseCleared,true);
    assert.deepEqual(interrupted.reference.senderFeedback,[]);
    const reopened=loadOzarkSave(storage,geometry);assert.equal(reopened.blocked,false);
    const restored=attachVisualReferenceLearning({state:reopened.state,pixelSensor:sensor});
    try{
      const snapshot=restored.snapshot();
      assert.equal(snapshot.pending,0);assert.deepEqual(snapshot.senderFeedback,[]);
      assert.equal(snapshot.feedbackMatched+snapshot.feedbackMismatched,0,
        'Independent reopen cannot credit either completed or pending response a second time');
      assert.deepEqual(snapshot.observationEvents,[]);
      assert.deepEqual(durable(snapshot),durable(savedCheckpoint.report.reference),
        'Earlier completed association survives a mid-response independent load');
      const probe=serialized(probeVisualReferenceReopen);
      const replay=await probe(new URL('../',import.meta.url),structuredClone(reopened.state),
        structuredClone(savedCheckpoint.serializedActive),structuredClone(savedCheckpoint.serializedPermit),
        {pendingKind:savedCheckpoint.pendingKind,serializedDemonstrationActive:structuredClone(savedCheckpoint.serializedDemonstrationActive)});
      assert.equal(replay.noRevivedAuthority,true);
      assert.equal(writeOzarkSave(storage,reopened.state,geometry,{referencePersistence:restored.exportPersistence()}),true);
      const twice=loadOzarkSave(storage,geometry).state;
      const twiceReference=attachVisualReferenceLearning({state:twice,pixelSensor:sensor});
      try{
        assert.deepEqual(durable(twiceReference.snapshot()),durable(snapshot));
        assert.equal(twiceReference.snapshot().pending,0);
        assert.deepEqual(twiceReference.snapshot().senderFeedback,[],'Second reopen cannot produce a second feedback event');
        assert.equal(twiceReference.snapshot().feedbackMatched+twiceReference.snapshot().feedbackMismatched,0);
      }finally{twiceReference.dispose();}
    }finally{restored.dispose();}
  }finally{fixture.dispose();reference.dispose();population.dispose();}
});
