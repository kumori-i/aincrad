import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {CONFIG} from '../src/config.js';
import {createOzarkState,writeOzarkSave,loadOzarkSave} from '../src/ozark-save.js';
import {createOzarkWorldGeometry} from '../src/ozark-world-geometry.js';
import {bindOzarkWorldAgent} from '../src/ozark-agent-world.js';
import {observeNpc,requestNpcAction,tickNpc,cancelNpcAction,collapseNpc} from '../src/npc.js';
import {attachVisualReferenceLearning} from '../src/visual-reference-attachment.js';
import {senseReferenceObjects} from '../src/visual-reference-perception.js';
import {createFreshCharacterMessages} from '../src/visual-reference-save.js';
import {initialReferenceRandomStates} from '../src/visual-reference-random.js';

const geometry=createOzarkWorldGeometry();
const modelCopy=model=>Object.fromEntries(Object.entries(model).map(([name,values])=>[name,values.slice()]));
const senderData=(attachment,id='aster')=>attachment.exportPersistence().characterMessages.learners.find(row=>row.agentId===id).sender;
const listenerData=(attachment,id='mira')=>attachment.exportPersistence().characterMessages.learners.find(row=>row.agentId===id).partners[0].listener;

function fixture({seed=211,listenerOffset=0,attach=attachVisualReferenceLearning}={}){
  const state=createOzarkState(geometry),[sender,listener]=state.agents;
  if(seed!==state.visualReference.seed){
    state.visualReference={...state.visualReference,seed,random:initialReferenceRandomStates(seed)};
    state.characterMessages=createFreshCharacterMessages(state.worldLineage,state.visualReference);
  }
  for(const actor of state.agents){bindOzarkWorldAgent(actor,geometry,state);observeNpc(actor,state.environment);}
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
  return {state,sender,listener,pixelSensor,attachment,step,advance,begin,demonstrate,
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
  assert.equal(measure.counts.originalCensors,1);
  assert.equal(measure.counts.canonicalDemonstrations,0);
  assert.equal(measure.counts.criticCorrect,0);
  assert(measure.reasons.some(row=>row.kind==='original'&&row.reason==='choice-interrupted'));
  f.attachment.dispose();
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
  const f=fixture();f.begin();
  const before=f.attachment.exportPersistence().characterMessages,world=structuredClone(f.state);
  const values=new Map(),storage={getItem:key=>values.get(key)??null,
    setItem:(key,value)=>values.set(key,value)};
  for(let i=0;i<3;i++){
    const snapshot=f.attachment.snapshot();
    const measurement=f.attachment.measurementSnapshot();
    assert.equal(measurement.counts.emissions,1);
    measurement.counts.emissions=999;
    measurement.admissionGates.optional=999;
    measurement.events[0].message='forged';
    measurement.actors[0].body.hunger='forged';
    assert.equal(f.attachment.measurementSnapshot().events[0].message,snapshot.latest.message,
      'The compact measurement is a defensive copy');
    assert.notEqual(f.attachment.measurementSnapshot().admissionGates.optional,999);
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
