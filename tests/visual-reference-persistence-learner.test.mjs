import test from 'node:test';
import assert from 'node:assert/strict';
import {createReferenceRandomStream,initialReferenceRandomStates} from '../src/visual-reference-random.js';
import {createVisualReferenceMemory} from '../src/visual-reference-memory.js';
import {createOzarkState} from '../src/ozark-save.js';
import {createOzarkWorldGeometry} from '../src/ozark-world-geometry.js';
import {attachVisualReferenceLearning} from '../src/visual-reference-attachment.js';

const flat=value=>Array(48).fill(value);
const commit=(memory,own)=>{
  const planned=memory.planPair(own);
  assert.equal(planned.ok,true,planned.reason);
  const outcome=memory.commitPair(planned.plan);
  assert.equal(outcome.ok,true,outcome.reason);
  return outcome.symbols;
};

test('four persisted random states continue at the exact next draw without inspection effects',()=>{
  const seed=211,initial=initialReferenceRandomStates(seed);
  for(const purpose of ['pair','target','order','choice']){
    const control=createReferenceRandomStream({seed,purpose});
    assert.equal(control.state(),initial[purpose]);
    for(let i=0;i<37;i++)control();
    const state=control.state();
    for(let i=0;i<20;i++)assert.equal(control.state(),state);
    const reopened=createReferenceRandomStream({seed,purpose,state});
    assert.equal(reopened.state(),state);
    for(let i=0;i<128;i++)assert.equal(reopened(),control());
  }
  for(const state of [-1,2**32,1.5,NaN,Infinity])
    assert.throws(()=>createReferenceRandomStream({seed,purpose:'choice',state}),TypeError);
});

test('ordered private anchors and partner evidence roundtrip without plans, aliases or hidden authority',()=>{
  const owner=createVisualReferenceMemory({symbolSeed:211,symbolIdentity:1});
  const receiver=createVisualReferenceMemory({symbolSeed:211,symbolIdentity:2});
  const ownerToken=Object.freeze({}),receiverToken=Object.freeze({});
  owner.reconcilePartners([receiverToken]);receiver.reconcilePartners([ownerToken]);
  const [first,second]=commit(owner,[flat(0),flat(.2)]);
  const [third]=commit(owner,[flat(.4),flat(.2)]);
  assert.notEqual(third,first);assert.notEqual(third,second);
  assert.equal(receiver.observe(ownerToken,first,flat(.01)).outcome,'new-exemplar');
  assert.equal(receiver.observe(ownerToken,first,flat(.01)).outcome,'support');
  assert.equal(receiver.observe(ownerToken,second,flat(.2)).outcome,'new-exemplar');
  for(const value of [.4,.6,.8])receiver.observe(ownerToken,second,flat(value));
  assert.equal(receiver.observe(ownerToken,second,flat(1)).outcome,'capacity-conflict');
  const describe=token=>token===ownerToken?{agentId:'aster',serial:1}:{agentId:'mira',serial:2};
  const ownerData=owner.exportPersistence(describe),receiverData=receiver.exportPersistence(describe);
  const ownerCopy=createVisualReferenceMemory({symbolSeed:211,symbolIdentity:1});
  const receiverCopy=createVisualReferenceMemory({symbolSeed:211,symbolIdentity:2});
  const reopenedOwnerToken=Object.freeze({}),reopenedReceiverToken=Object.freeze({});
  ownerCopy.reconcilePartners([reopenedReceiverToken]);receiverCopy.reconcilePartners([reopenedOwnerToken]);
  const stalePlan=ownerCopy.planPair([flat(.5),flat(.7)]);
  assert.equal(stalePlan.ok,true);
  ownerCopy.restorePersistence(ownerData,()=>reopenedReceiverToken);
  receiverCopy.restorePersistence(receiverData,()=>reopenedOwnerToken);
  assert.equal(ownerCopy.commitPair(stalePlan.plan).reason,'stale-plan');
  assert.deepEqual(ownerCopy.exportPersistence(token=>token===reopenedReceiverToken?{agentId:'mira',serial:2}:null),ownerData);
  assert.deepEqual(receiverCopy.exportPersistence(token=>token===reopenedOwnerToken?{agentId:'aster',serial:1}:null),receiverData);
  for(const [symbol,features] of [[first,[flat(.01),flat(.9)]],[second,[flat(.2),flat(.9)]],
      [third,[flat(.4),flat(.9)]],[63,[flat(.01),flat(.9)]]]){
    assert.deepEqual(receiverCopy.choose(reopenedOwnerToken,symbol,features),
      receiver.choose(ownerToken,symbol,features));
    assert.deepEqual(receiverCopy.choose(reopenedOwnerToken,symbol,features.slice().reverse()),
      receiver.choose(ownerToken,symbol,features.slice().reverse()));
  }
  assert.equal(receiverCopy.choose(reopenedOwnerToken,second,[flat(.2),flat(.9)]).reason,'conflicted');
  const old=commit(owner,[flat(.6),flat(.8)]),next=commit(ownerCopy,[flat(.6),flat(.8)]);
  assert.deepEqual(next,old,'The next inventory symbols follow the retained ordered anchors');
  ownerData.anchors[0].features.fill(1);receiverData.partners[0].entries[0].examples[0].fill(1);
  assert.equal(ownerCopy.snapshot().anchors[0].features[0],0);
  assert.equal(receiverCopy.snapshot().partners[0].entries[0].examples[0][0],.01);
  assert.throws(()=>receiverCopy.restorePersistence(receiverData,()=>reopenedOwnerToken),TypeError);
});

test('malformed memory restoration is atomic and never accepts a copied peer label',()=>{
  const source=createVisualReferenceMemory({symbolSeed:211,symbolIdentity:1});
  commit(source,[flat(0),flat(.2)]);
  const good=source.exportPersistence(()=>({agentId:'mira',serial:2}));
  const target=createVisualReferenceMemory({symbolSeed:211,symbolIdentity:1});
  const peer=Object.freeze({});target.reconcilePartners([peer]);
  const invalid=[
    {...good,extra:true},
    {...good,anchors:[good.anchors[0]]},
    {...good,anchors:[{...good.anchors[0],symbol:63},good.anchors[1]]},
    {...good,anchors:[{...good.anchors[0],features:flat(NaN)},good.anchors[1]]},
    {...good,anchors:[good.anchors[0],{...good.anchors[1],features:flat(.01)}]},
    {...good,partners:[{agentId:'mira',serial:2,entries:[{symbol:1,examples:[flat(.2)],support:0,conflicted:false}]}]},
  ];
  for(const data of invalid){
    assert.throws(()=>target.restorePersistence(data,()=>peer),TypeError);
    assert.equal(target.snapshot().counts.anchors,0);
  }
  target.restorePersistence(good,()=>peer);
  assert.deepEqual(target.snapshot().anchors,source.snapshot().anchors);
  const sourceReceiver=createVisualReferenceMemory();
  sourceReceiver.reconcilePartners([peer]);sourceReceiver.observe(peer,1,flat(.2));
  const receiverData=sourceReceiver.exportPersistence(()=>({agentId:'aster',serial:1}));
  const unrelated=createVisualReferenceMemory();unrelated.reconcilePartners([Object.freeze({})]);
  assert.throws(()=>unrelated.restorePersistence(receiverData,()=>peer),TypeError,
    'Textually equal but noncurrent partner objects cannot acquire retained evidence');
});

test('attachment binds retained evidence to exact live actor provenance and exports purely',()=>{
  const state=createOzarkState(createOzarkWorldGeometry());
  const sender=createVisualReferenceMemory({symbolSeed:211,symbolIdentity:1});
  const listener=createVisualReferenceMemory({symbolSeed:211,symbolIdentity:2});
  const senderToken=Object.freeze({});listener.reconcilePartners([senderToken]);
  const [known]=commit(sender,[flat(0),flat(.3)]);
  listener.observe(senderToken,known,flat(0));
  state.visualReference.learners=[
    {agentId:'aster',serial:1,...sender.exportPersistence(()=>({agentId:'mira',serial:2}))},
    {agentId:'mira',serial:2,...listener.exportPersistence(()=>({agentId:'aster',serial:1}))},
  ];
  const sensor={capture(){throw new Error('A read-only persistence path must not capture pixels');},dispose(){}};
  const attached=attachVisualReferenceLearning({state,pixelSensor:sensor});
  const saved=attached.exportPersistence();
  assert.deepEqual(saved.worldLineage,state.worldLineage);
  assert.deepEqual(saved.visualReference,state.visualReference);
  assert.equal(attached.inspectPersistedAssociation({listenerId:'mira',senderId:'aster',symbol:known,
    candidateFeatures:[flat(0),flat(.8)]}).index,0);
  assert.equal(attached.inspectPersistedAssociation({listenerId:'mira',senderId:'aster',symbol:known,
    candidateFeatures:[flat(.8),flat(0)]}).index,1);
  for(let i=0;i<10;i++){
    attached.snapshot();assert.deepEqual(attached.exportPersistence(),saved);
  }
  state.agents[0]=structuredClone(state.agents[0]);
  const stale=attached.snapshot();
  assert.deepEqual(stale.learners,[]);assert.equal(stale.diagnostic.pendingReconciliation,true);
  assert.throws(()=>attached.exportPersistence(),/reconciliation/);
  attached.beforeTick();
  const retired=attached.exportPersistence();
  assert.equal(retired.worldLineage.agents[0].serial,3);
  assert.equal(retired.worldLineage.nextSerial,4);
  assert.equal(retired.visualReference.learners[0].anchors.length,0);
  assert.equal(retired.visualReference.learners[1].partners.length,0);
  assert.equal(attached.inspectPersistedAssociation({listenerId:'mira',senderId:'aster',symbol:known,
    candidateFeatures:[flat(0),flat(.8)]}).reason,'unknown-symbol');
  attached.dispose();assert.deepEqual(attached.exportPersistence(),retired,
    'Disposal cannot erase completed individual memory or rewind the continuation');
  state.worldLineage={...retired.worldLineage,nextSerial:0x100000000};
  state.visualReference=retired.visualReference;
  state.characterMessages=retired.characterMessages;
  state.characterMessages=retired.characterMessages;
  const exhausted=attachVisualReferenceLearning({state,pixelSensor:sensor});
  state.agents[1]=structuredClone(state.agents[1]);
  assert.throws(()=>exhausted.beforeTick(),/serials are exhausted/);
  assert.deepEqual(exhausted.snapshot().learners,[]);
  assert.throws(()=>exhausted.exportPersistence(),/reconciliation/,
    'Exhaustion must block export instead of reusing an actor serial');
  exhausted.dispose();
});
