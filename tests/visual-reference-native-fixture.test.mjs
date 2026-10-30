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

async function setup({seed=211,responseScenario=false,ambiguousSecond=false}={}){
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
  let saved=false;
  const checkpoint=()=>{
    if(saved)return false;
    saved=true;
    return writeOzarkSave(storage,state,geometry,{referencePersistence:reference.exportPersistence()});
  };
  const fixture=await serialized(installVisualReferenceFixture)({state,populationState:population.state,reference,
    geometry,step,fixedStep:1/60,responseScenario,auditSensor:sensor,checkpoint},
    new URL('../',import.meta.url),serialized(visualReferenceEvidence));
  return {geometry,state,sensor,reference,population,storage,fixture,
    dispose(){fixture.dispose();reference.dispose();population.dispose();}};
}

function firstPaidExchange(f){
  const {fixture}=f;
  assert.equal(fixture.status().pose,null);
  const choice=fixture.beginChoice();
  assert.match(choice.reference.latest.message,/^[a-z]{1,6}$/);
  assert.equal(choice.reference.latest.choiceMode,'uniform-untrained');
  assert.equal(fixture.completeChoice().checks.choiceCompletedBeforeIndication,true);
  assert.equal(fixture.beginIndication().pose,null);
  const during=fixture.visible();
  assert(during.pose);assert.equal(during.checks.visibleCrop.actualCanvas,false);
  const complete=fixture.completeIndication();
  assert.equal(complete.pose,null);
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
  assert.equal(fixture.interrupt().checks.interruption.poseCleared,true);
  const loaded=loadOzarkSave(storage,geometry);
  assert.equal(loaded.blocked,false);
  const beforeCopy=structuredClone(loaded.state);
  const restored=attachVisualReferenceLearning({state:loaded.state,pixelSensor:f.sensor,protocol:'sequence'});
  try{
    const savedCharacters=JSON.parse(checkpoint.raw).characterMessages;
    assert.deepEqual(restored.exportPersistence().characterMessages,savedCharacters);
    assert.equal(restored.snapshot().pending,0);
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
      if(complete.checks.replyAvailable){
        f.fixture.beginResponse();
        assert(f.fixture.visibleResponse().responsePose);
        const settled=f.fixture.completeResponse();
        assert.equal(settled.reference.pending,0);
        assert(settled.checks.responsePayment.expectedActionEffortKcal>0);
      }else{
        assert.equal(complete.reference.latest.feedbackStatus,'censored');
        assert.equal(complete.reference.latest.feedbackReason,'response-not-resolvable');
      }
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
      assert.equal(saved.pendingKind,'sender-demonstration');
      await assertReopen(f,saved);
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
