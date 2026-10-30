import test from 'node:test';
import assert from 'node:assert/strict';
import {createCharacterMessageLearner} from '../src/character-message-runtime.js';

const flat=value=>Array(48).fill(value);
const pair=()=>[flat(.1),flat(.9)];
const make=(ownerSerial=1,partnerSerial=2,restored=null)=>{
  const learner=createCharacterMessageLearner({seed:211,ownerSerial,restored});
  const token=Object.freeze({});
  learner.reconcilePartners([{token,agentId:ownerSerial===1?'mira':'aster',serial:partnerSerial}]);
  return {learner,token};
};
const serialized=value=>JSON.stringify(value);

test('sampled sender trajectory has one opaque handle and only its current partner can settle it once',()=>{
  const {learner,token}=make(),before=learner.exportPersistence();
  const sampled=learner.sampleMessage(token,flat(.1));
  assert.match(sampled.message,/^[a-z]{1,6}$/);
  assert.deepEqual(Object.keys(sampled.handle),[]);
  assert.equal(learner.sampleMessage(token,flat(.9)),null,'Weights remain frozen while a trajectory is pending');
  const pendingExport=learner.exportPersistence();
  for(let i=0;i<5;i++){
    learner.snapshot();
    assert.deepEqual(learner.exportPersistence(),pendingExport,
      'Inspection and repeated save export cannot consume RNG or train pending work');
  }
  assert.equal(learner.settleMessage({...sampled.handle},token,'match').updated,false);
  assert.equal(learner.exportPersistence().sender.updates,0);
  const settled=learner.settleMessage(sampled.handle,token,'match');
  assert.equal(settled.updated,true);
  assert(settled.logProbabilityAfter>settled.logProbabilityBefore);
  assert.equal(learner.settleMessage(sampled.handle,token,'match').updated,false);
  const after=learner.exportPersistence();
  assert.equal(after.sender.emissions,before.sender.emissions+1);
  assert.equal(after.sender.updates,before.sender.updates+1);
  assert.equal(after.sender.revision,after.sender.updates);
  assert(Math.abs(after.sender.baseline-.05)<1e-14);
  assert.notEqual(serialized(after.sender.model),serialized(before.sender.model));
  learner.dispose();
});

test('wrong partner, censor and cancellation consume no reward or baseline',()=>{
  const {learner,token}=make(),other=Object.freeze({});
  const first=learner.sampleMessage(token,flat(.3));
  const before=learner.exportPersistence().sender;
  assert.equal(learner.settleMessage(first.handle,other,'match').updated,false);
  assert.equal(serialized(learner.exportPersistence().sender.model),serialized(before.model));
  assert.equal(learner.exportPersistence().sender.baseline,0);
  const second=learner.sampleMessage(token,flat(.3));
  assert.equal(learner.settleMessage(second.handle,token,'censored').updated,false);
  const third=learner.sampleMessage(token,flat(.3));
  assert.equal(learner.cancelMessage(third.handle),true);
  assert.equal(learner.cancelMessage(third.handle),false);
  const after=learner.exportPersistence().sender;
  assert.equal(after.emissions,3);
  assert.equal(after.updates,0);
  assert.equal(after.revision,0);
  assert.equal(after.baseline,0);
  assert.equal(serialized(after.model),serialized(before.model));
  learner.dispose();
});

test('identical visible strings in distinct transactions cannot reuse the first handle',()=>{
  const initial=make(),data=initial.learner.exportPersistence();initial.learner.dispose();
  data.sender.model.bo.fill(-100);data.sender.model.bo[0]=50;data.sender.model.bo[26]=100;
  const {learner,token}=make(1,2,data);
  const first=learner.sampleMessage(token,flat(.3));
  assert.equal(first.message,'a');
  assert.equal(learner.settleMessage(first.handle,token,'match').updated,true);
  const second=learner.sampleMessage(token,flat(.3));
  assert.equal(second.message,'a');
  const pending=learner.exportPersistence().sender;
  assert.equal(learner.settleMessage(first.handle,token,'match').updated,false);
  assert.deepEqual(learner.exportPersistence().sender,pending);
  assert.equal(learner.settleMessage(second.handle,token,'mismatch').updated,true);
  assert.equal(learner.exportPersistence().sender.updates,2);
  learner.dispose();
});

test('only a unique own-crop label trains a private listener with bounded prior replay',()=>{
  const {learner,token}=make();
  const before=learner.exportPersistence().partners[0].listener;
  const untrained=learner.choose(token,'abc',pair());
  assert.equal(untrained.mode,'uniform-untrained');
  assert.deepEqual(untrained.probabilities,[.5,.5]);
  assert.equal(learner.learnDemonstration(token,'abc',pair(),flat(.5)).updated,false);
  assert.equal(learner.exportPersistence().partners[0].listener.demonstrations,0);
  for(let i=0;i<4;i++){
    const result=learner.learnDemonstration(token,i%2?'abd':'abc',pair(),i%2?flat(.9):flat(.1));
    assert.equal(result.updated,true);
    assert.equal(result.label,i%2?1:0);
    assert.equal(result.replayUsed,Math.min(i,3));
  }
  const after=learner.exportPersistence().partners[0].listener;
  assert.equal(after.demonstrations,4);
  assert.equal(after.optimizerSteps,4);
  assert.equal(after.replayUses,6);
  assert.equal(after.examples.length,4);
  assert.notEqual(serialized(after.model),serialized(before.model));
  const trained=learner.choose(token,'abc',pair());
  assert.equal(trained.mode,'model-sample');
  learner.dispose();
});

test('trained private listener scores permuted own candidates equivariantly',()=>{
  const original=make();
  original.learner.learnDemonstration(original.token,'abc',pair(),flat(.1));
  const saved=original.learner.exportPersistence();
  const forward=make(1,2,saved),reverse=make(1,2,saved);
  const a=forward.learner.choose(forward.token,'abc',pair()).probabilities;
  const b=reverse.learner.choose(reverse.token,'abc',pair().reverse()).probabilities;
  assert(Math.abs(a[0]-b[1])<1e-14);
  assert(Math.abs(a[1]-b[0])<1e-14);
  original.learner.dispose();forward.learner.dispose();reverse.learner.dispose();
});

test('actual individual owners never share sender or listener weight arrays',()=>{
  const a=make(1,2),b=make(2,1);
  const beforeB=b.learner.exportPersistence();
  const beforeA=a.learner.exportPersistence();
  assert.notDeepEqual(beforeA.sender.model,beforeB.sender.model);
  assert.notDeepEqual(beforeA.partners[0].listener.model,beforeB.partners[0].listener.model);
  a.learner.learnDemonstration(a.token,'abc',pair(),flat(.1));
  const pending=a.learner.sampleMessage(a.token,flat(.1));
  a.learner.settleMessage(pending.handle,a.token,'match');
  assert.deepEqual(b.learner.exportPersistence(),beforeB);
  a.learner.dispose();b.learner.dispose();
});

test('save copies and exact RNG continuation survive reopen without a pending handle',()=>{
  const {learner,token}=make();
  const abandoned=learner.sampleMessage(token,flat(.3));
  const exported=learner.exportPersistence();
  assert.equal(learner.cancelMessage(abandoned.handle),true);
  const next=learner.sampleMessage(token,flat(.3));
  const clone=make(1,2,exported);
  const resumed=clone.learner.sampleMessage(clone.token,flat(.3));
  assert.equal(resumed.message,next.message);
  assert.deepEqual(clone.learner.exportPersistence().sender.randomState,
    learner.exportPersistence().sender.randomState);
  assert.equal(clone.learner.settleMessage(abandoned.handle,clone.token,'match').updated,false,
    'Reopen never revives old transaction authority');
  const copy=clone.learner.exportPersistence();
  copy.sender.model.Wx[0]=999;copy.partners[0].listener.examples.push({message:'x'});
  assert.notEqual(clone.learner.exportPersistence().sender.model.Wx[0],999);
  assert.equal(clone.learner.exportPersistence().partners[0].listener.examples.length,0);
  const durable=clone.learner.exportPersistence();
  learner.dispose();clone.learner.dispose();
  assert.deepEqual(clone.learner.exportPersistence(),durable,
    'Disposal retires authority but preserves the last pure durable projection');
  assert.throws(()=>clone.learner.sampleMessage(clone.token,flat(.3)),/disposed/);
});

test('listener choice, replay update and next sender update continue exactly after restoration',()=>{
  const live=make();
  live.learner.learnDemonstration(live.token,'abc',pair(),flat(.1));
  const saved=live.learner.exportPersistence();
  const reopened=make(1,2,saved);
  const chosenLive=live.learner.choose(live.token,'abc',pair());
  const chosenReopened=reopened.learner.choose(reopened.token,'abc',pair());
  assert.deepEqual(chosenReopened,chosenLive);
  const learnedLive=live.learner.learnDemonstration(live.token,'abd',pair(),flat(.9));
  const learnedReopened=reopened.learner.learnDemonstration(reopened.token,'abd',pair(),flat(.9));
  assert.deepEqual(learnedReopened,learnedLive);
  const emittedLive=live.learner.sampleMessage(live.token,flat(.3));
  const emittedReopened=reopened.learner.sampleMessage(reopened.token,flat(.3));
  assert.equal(emittedReopened.message,emittedLive.message);
  const settledLive=live.learner.settleMessage(emittedLive.handle,live.token,'mismatch');
  const settledReopened=reopened.learner.settleMessage(emittedReopened.handle,reopened.token,'mismatch');
  assert.deepEqual(settledReopened,settledLive);
  assert.deepEqual(reopened.learner.exportPersistence(),live.learner.exportPersistence());
  live.learner.dispose();reopened.learner.dispose();
});

test('replacing the partner retires its private bank and any pending trajectory',()=>{
  const {learner,token}=make();
  learner.learnDemonstration(token,'abc',pair(),flat(.1));
  const pending=learner.sampleMessage(token,flat(.1));
  const replacement=Object.freeze({});
  learner.reconcilePartners([{token:replacement,agentId:'mira',serial:3}]);
  assert.equal(learner.settleMessage(pending.handle,token,'match').updated,false);
  const snapshot=learner.snapshot();
  assert.equal(snapshot.partnerBanks[0].partnerSerial,3);
  assert.equal(snapshot.partnerBanks[0].trained,false);
  assert.equal(snapshot.partnerBanks[0].retainedExamples,0);
  assert.equal(learner.choose(replacement,'abc',pair()).mode,'uniform-untrained');
  learner.dispose();
});

test('listener retains a strict 128-example FIFO while counting physical demonstrations separately',()=>{
  const {learner,token}=make();
  for(let i=0;i<129;i++){
    const result=learner.learnDemonstration(token,i===0?'a':'b',pair(),flat(.1));
    assert.equal(result.updated,true);
  }
  const bank=learner.exportPersistence().partners[0].listener;
  const display=learner.snapshot();
  assert.equal(bank.demonstrations,129);
  assert.equal(bank.optimizerSteps,129);
  assert.equal(bank.replayUses,1+2+126*3);
  assert.equal(bank.examples.length,128);
  assert(bank.examples.every(example=>example.message==='b'));
  assert.equal(display.uniqueDemonstrations,129);
  assert.equal(display.replayUses,bank.replayUses);
  assert.equal(display.partnerBanks[0].retainedExamples,128);
  learner.dispose();
});
