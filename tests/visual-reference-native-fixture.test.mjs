import test from 'node:test';
import assert from 'node:assert/strict';
import {createOzarkState,loadOzarkSave,writeOzarkSave,getOzarkSaveFailure,OZARK_SAVE_KEY} from '../src/ozark-save.js';
import {createOzarkWorldGeometry} from '../src/ozark-world-geometry.js';
import {bindOzarkWorldAgent} from '../src/ozark-agent-world.js';
import {PopulationRuntime} from '../src/population.js';
import {attachVisualReferenceLearning} from '../src/visual-reference-attachment.js';
import {poolCommunicationPixels} from '../src/communication-pixels.js';
import {senseReferenceObjects} from '../src/visual-reference-perception.js';
import {installVisualReferenceFixture,visualReferenceEvidence,probeVisualReferenceReopen} from '../scripts/visual-reference-native-fixture.mjs';
import {assertStructuralRestoredHistory} from '../scripts/structural-movement-native-contract.mjs';
const serialized=fn=>Function('return ('+fn.toString()+')')();
const durable=reference=>reference.learners.map(({agentId,identity,anchors,partners,counts})=>
  ({agentId,identity,anchors,partners,counts}));

test('serialized native fixture exercises real population/action/time lifecycle (synthetic sensor; not native or pixel evidence)',{timeout:180000},async()=>{
  const geometry=createOzarkWorldGeometry(),state=createOzarkState(geometry);
  for(const n of state.agents)bindOzarkWorldAgent(n,geometry,state);
  const sensor={capture(n){const s=senseReferenceObjects(n,state);return new Map(s.bindings.map((id,i)=>{const pixels=Array(768).fill(i%2?204:26);return [id,{features:poolCommunicationPixels(pixels),pixels,at:n.elapsed,epoch:n.epoch}];}));},dispose(){}};
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
    assert.equal(writeOzarkSave(storage,state,geometry,{referencePersistence:exportBeforeCorrection}),false,
      'A completed own-view correction cannot be replaced by a cached pre-correction export');
    assert.equal(getOzarkSaveFailure(state),'reference-export-stale');
    assert.equal(storage.getItem(OZARK_SAVE_KEY),null);
    assert(complete.checks.payment.expectedActionEffortKcal>0);assert(complete.audit.length>=100);
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
    }finally{twiceReference.dispose();}
    const wrongWorld=structuredClone(reopened);wrongWorld.environment.ecology.geometryIdentity='wrong-world';
    await assert.rejects(probe(new URL('../',import.meta.url),wrongWorld,checkpoint.serializedActive,checkpoint.serializedPermit),/ecology identity does not match/);
    assert.deepEqual(fixture.project(),original);
    }finally{reopenedReference.dispose();}
  }finally{fixture.dispose();reference.dispose();population.dispose();}
});
