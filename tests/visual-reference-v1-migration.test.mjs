import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createOzarkWorldGeometry} from '../src/ozark-world-geometry.js';
import {createOzarkState,loadOzarkSave,writeOzarkSave,OZARK_SAVE_KEY} from '../src/ozark-save.js';
import {validateCharacterPersistence} from '../src/visual-reference-save.js';
import {markVisualReferenceAttached} from '../src/visual-reference-save-registration.js';
import {createCharacterMessageLearner} from '../src/character-message-runtime.js';
import {attachVisualReferenceLearning} from '../src/visual-reference-attachment.js';

const provenance=JSON.parse(readFileSync(new URL('./fixtures/visual-reference-v1-actual-paid-save.provenance.json',
  import.meta.url),'utf8'));
const archived=gunzipSync(readFileSync(new URL('./fixtures/visual-reference-v1-actual-paid-save.json.gz',
  import.meta.url))).toString('utf8');
const sha256=value=>createHash('sha256').update(value).digest('hex');
const geometry=createOzarkWorldGeometry();
function storage(initial){
  const items=new Map([[OZARK_SAVE_KEY,initial]]);let writes=0;
  return {getItem:key=>items.get(key)??null,setItem(key,value){writes++;items.set(key,value);},
    writes:()=>writes};
}

test('authentic paid v1 save migrates in memory without rewriting old bytes or evidence',()=>{
  assert.equal(provenance.sourceCommit,'c3531d221acbb6a3613499949b91b134251c679b');
  assert.equal(Buffer.byteLength(archived),provenance.bytes);
  assert.equal(sha256(archived),provenance.sha256);
  const old=JSON.parse(archived),disk=storage(archived);
  assert.deepEqual(old.features,{plantLifecycle:1,finiteAquatic:2,worldStructures:1},
    'The authentic archived bytes predate the mandatory character feature marker');
  assert.equal(old.visualReference.version,1);
  assert.equal(Object.hasOwn(old,'characterMessages'),false);
  assert.deepEqual(old.visualReference.random,provenance.oldRandom);
  assert.deepEqual(old.visualReference.learners.map(row=>row.anchors.length),provenance.legacyAnchorCounts);
  assert.deepEqual(old.visualReference.learners.map(row=>row.partners.length),provenance.legacyPartnerCounts);
  assert.equal(old.visualReference.learners[1].partners[0].entries[0].examples.length,1);
  assert(old.agents.every(actor=>actor.active===null));
  for(const [agentId,type,code] of [
    ['mira','inspect_object','OBJECT_OBSERVED'],['aster','indicate_object','OBJECT_INDICATED']]){
    const actor=old.agents.find(row=>row.id===agentId);
    assert(actor?.memory.experience.some(row=>row.type==='action'&&
      row.details?.action?.type===type&&row.details?.result?.code===code&&
      row.details.result.ok===true),`${agentId} must retain its actual paid ${type} receipt`);
  }
  const migrated=loadOzarkSave(disk,geometry);
  assert.equal(migrated.blocked,false,migrated.error);
  assert.equal(disk.writes(),0,'Opening existing v1 data is read-only');
  assert.equal(disk.getItem(OZARK_SAVE_KEY),archived,'Every occupied v1 byte survives load');
  assert.equal(migrated.state.worldLineage.version,2);
  assert.deepEqual(migrated.state.features,
    {plantLifecycle:1,finiteAquatic:2,worldStructures:1,characterMessages:2});
  assert.deepEqual({...migrated.state.worldLineage,version:1},old.worldLineage);
  assert.deepEqual(migrated.state.visualReference,old.visualReference,
    'Anchors, examples, and all four legacy RNG states remain unchanged');
  assert.equal(migrated.state.characterMessages.version,2);
  for(const row of migrated.state.characterMessages.learners){
    assert.equal(row.sender.updates,0);
    assert.equal(row.sender.emissions,0);
    assert.equal(row.partners[0].listener.demonstrations,0);
    assert.deepEqual(row.partners[0].listener.examples,[],
      'Legacy examples cannot become recurrent training examples');
  }
  assert.deepEqual(validateCharacterPersistence({worldLineage:old.worldLineage,
    visualReference:old.visualReference},{allowV1Migration:true}),
    {worldLineage:migrated.state.worldLineage,visualReference:old.visualReference,
      characterMessages:migrated.state.characterMessages});
  assert.equal(writeOzarkSave(disk,migrated.state,geometry),true);
  const stored=JSON.parse(disk.getItem(OZARK_SAVE_KEY));
  assert.deepEqual(stored.features,migrated.state.features);
  assert.deepEqual({...stored.worldLineage,version:1},old.worldLineage);
  assert.deepEqual(stored.visualReference,old.visualReference);
  assert.deepEqual(stored.characterMessages,migrated.state.characterMessages);
  const reopened=loadOzarkSave(disk,geometry);
  assert.equal(reopened.blocked,false,reopened.error);
  assert.deepEqual(reopened.state.characterMessages,migrated.state.characterMessages);
  assert.deepEqual(reopened.state.visualReference.random,provenance.oldRandom);
});

test('a marked v2 save with all three learner sections removed blocks without replacing bytes',()=>{
  const disk=storage(null),state=createOzarkState(geometry);
  assert.equal(writeOzarkSave(disk,state,geometry),true);
  const complete=JSON.parse(disk.getItem(OZARK_SAVE_KEY));
  assert.equal(complete.features.characterMessages,2);
  for(const field of ['worldLineage','visualReference','characterMessages'])
    delete complete[field];
  const bytes=JSON.stringify(complete);disk.setItem(OZARK_SAVE_KEY,bytes);
  const opened=loadOzarkSave(disk,geometry);
  assert.equal(opened.blocked,true);
  assert.equal(opened.state,null);
  assert.equal(writeOzarkSave(disk,state,geometry),false);
  assert.equal(disk.getItem(OZARK_SAVE_KEY),bytes);
});

test('the writer cannot serialize a historical feature triple as a current marked save',()=>{
  const disk=storage(null),state=createOzarkState(geometry);
  assert.equal(writeOzarkSave(disk,state,geometry),true);
  const occupied=disk.getItem(OZARK_SAVE_KEY);
  state.features={plantLifecycle:1,finiteAquatic:2,worldStructures:1};
  for(const field of ['worldLineage','visualReference','characterMessages'])
    delete state[field];
  assert.equal(writeOzarkSave(disk,state,geometry),false);
  assert.equal(disk.getItem(OZARK_SAVE_KEY),occupied);
});

test('malformed migrated v2 saves protect every occupied byte',()=>{
  const disk=storage(archived),migrated=loadOzarkSave(disk,geometry);
  assert.equal(migrated.blocked,false,migrated.error);
  assert.equal(writeOzarkSave(disk,migrated.state,geometry),true);
  const good=JSON.parse(disk.getItem(OZARK_SAVE_KEY));
  const corruptions=[
    row=>{row.characterMessages=null;},
    row=>{row.characterMessages.version=3;},
    row=>{row.characterMessages.worldId='other-world';},
    row=>{row.characterMessages.random.order=-1;},
    row=>{row.characterMessages.learners[0].sender.model.Wx[0]=null;},
    row=>{row.characterMessages.learners[0].sender.model.Wx.push(0);},
    row=>{row.characterMessages.learners[1].partners[0].serial++;},
  ];
  for(const [index,mutate] of corruptions.entries()){
    const damaged=structuredClone(good);mutate(damaged);
    const bytes=JSON.stringify(damaged);disk.setItem(OZARK_SAVE_KEY,bytes);
    const opened=loadOzarkSave(disk,geometry);
    assert.equal(opened.blocked,true,`case ${index}`);
    assert.equal(opened.state,null);
    assert.equal(writeOzarkSave(disk,migrated.state,geometry),false,`case ${index}`);
    assert.equal(disk.getItem(OZARK_SAVE_KEY),bytes,`case ${index} remains byte-exact`);
  }
});

test('v2 lineage marker blocks missing character section and crossed version pairs',()=>{
  const disk=storage(archived),migrated=loadOzarkSave(disk,geometry);
  assert.equal(migrated.blocked,false,migrated.error);
  assert.equal(writeOzarkSave(disk,migrated.state,geometry),true);
  const complete=JSON.parse(disk.getItem(OZARK_SAVE_KEY));
  assert.equal(complete.worldLineage.version,2);
  assert.equal(complete.visualReference.version,1);
  const cases=[
    row=>{delete row.characterMessages;},
    row=>{delete row.characterMessages;row.worldLineage.version=1;},
    row=>{row.characterMessages={version:2};},
    row=>{row.worldLineage.version=1;},
    row=>{row.worldLineage.version=3;},
    row=>{row.features={plantLifecycle:1,finiteAquatic:2,worldStructures:1};},
  ];
  for(const [index,change] of cases.entries()){
    const row=structuredClone(complete);change(row);
    const bytes=JSON.stringify(row);disk.setItem(OZARK_SAVE_KEY,bytes);
    const opened=loadOzarkSave(disk,geometry);
    assert.equal(opened.blocked,true,`v2 marker case ${index}`);
    assert.equal(writeOzarkSave(disk,migrated.state,geometry),false,`v2 marker case ${index}`);
    assert.equal(disk.getItem(OZARK_SAVE_KEY),bytes,`v2 marker case ${index} remains exact`);
  }
  const old=JSON.parse(archived);
  old.characterMessages=complete.characterMessages;
  const crossed=JSON.stringify(old);disk.setItem(OZARK_SAVE_KEY,crossed);
  assert.equal(loadOzarkSave(disk,geometry).blocked,true,'v1 lineage cannot contain a v2 section');
  assert.equal(disk.getItem(OZARK_SAVE_KEY),crossed);
});

test('an attached migrated v1 world exports v2 without changing earned legacy memory',()=>{
  const disk=storage(archived),opened=loadOzarkSave(disk,geometry),old=JSON.parse(archived);
  assert.equal(opened.blocked,false,opened.error);
  const sensor={capture(){throw new Error('Migration/export must not capture pixels');},dispose(){}};
  const learner=attachVisualReferenceLearning({state:opened.state,pixelSensor:sensor});
  const current=learner.exportPersistence();
  assert.deepEqual({...current.worldLineage,version:1},old.worldLineage);
  assert.deepEqual(current.visualReference,old.visualReference);
  assert.deepEqual(current.characterMessages,opened.state.characterMessages);
  assert.equal(writeOzarkSave(disk,opened.state,geometry,{referencePersistence:current}),true);
  learner.dispose();
  const reopened=loadOzarkSave(disk,geometry);
  assert.equal(reopened.blocked,false,reopened.error);
  assert.deepEqual(reopened.state.visualReference,old.visualReference);
  const second=attachVisualReferenceLearning({state:reopened.state,pixelSensor:sensor});
  assert.deepEqual(second.exportPersistence(),current);
  second.dispose();
});

test('saved v2 numeric states continue with the exact next message, choice and updates',()=>{
  const disk=storage(archived),loaded=loadOzarkSave(disk,geometry);
  assert.equal(loaded.blocked,false,loaded.error);
  const state=loaded.state,seed=state.visualReference.seed;
  const aToken=Object.freeze({}),mToken=Object.freeze({});
  const aster=createCharacterMessageLearner({seed,ownerSerial:state.worldLineage.agents[0].serial,
    restored:state.characterMessages.learners[0]});
  const mira=createCharacterMessageLearner({seed,ownerSerial:state.worldLineage.agents[1].serial,
    restored:state.characterMessages.learners[1]});
  aster.reconcilePartners([{token:mToken,agentId:'mira',serial:state.worldLineage.agents[1].serial}]);
  mira.reconcilePartners([{token:aToken,agentId:'aster',serial:state.worldLineage.agents[0].serial}]);
  const own=Array.from({length:48},(_,i)=>.1+i/1000),candidates=[Array(48).fill(0),Array(48).fill(.5)];
  const first=aster.sampleMessage(mToken,own);
  assert.match(first.message,/^[a-z]{1,6}$/);
  mira.choose(aToken,first.message,candidates);
  assert.equal(mira.learnDemonstration(aToken,first.message,candidates,candidates[0]).updated,true);
  assert.equal(aster.settleMessage(first.handle,mToken,'mismatch').updated,true);
  const current=()=>({worldLineage:state.worldLineage,visualReference:state.visualReference,
    characterMessages:{...state.characterMessages,learners:[
      {agentId:'aster',serial:state.worldLineage.agents[0].serial,...aster.exportPersistence()},
      {agentId:'mira',serial:state.worldLineage.agents[1].serial,...mira.exportPersistence()}]}});
  markVisualReferenceAttached(state,current);
  const before=current();
  assert.equal(writeOzarkSave(disk,state,geometry,{referencePersistence:before}),true);
  const savedBytes=disk.getItem(OZARK_SAVE_KEY),reopened=loadOzarkSave(disk,geometry);
  assert.equal(reopened.blocked,false,reopened.error);
  assert.equal(disk.getItem(OZARK_SAVE_KEY),savedBytes,'Reading does not advance or rewrite the checkpoint');
  assert.deepEqual(reopened.state.visualReference,state.visualReference);
  assert.deepEqual(reopened.state.characterMessages,before.characterMessages);
  const a2=createCharacterMessageLearner({seed,ownerSerial:reopened.state.worldLineage.agents[0].serial,
    restored:reopened.state.characterMessages.learners[0]});
  const m2=createCharacterMessageLearner({seed,ownerSerial:reopened.state.worldLineage.agents[1].serial,
    restored:reopened.state.characterMessages.learners[1]});
  const a2Token=Object.freeze({}),m2Token=Object.freeze({});
  a2.reconcilePartners([{token:m2Token,agentId:'mira',serial:reopened.state.worldLineage.agents[1].serial}]);
  m2.reconcilePartners([{token:a2Token,agentId:'aster',serial:reopened.state.worldLineage.agents[0].serial}]);
  const next=aster.sampleMessage(mToken,own),repeated=a2.sampleMessage(m2Token,own);
  assert.equal(repeated.message,next.message,'The next emitted string continues exactly');
  assert.deepEqual(m2.choose(a2Token,repeated.message,candidates),
    mira.choose(aToken,next.message,candidates),'The listener choice and RNG continue exactly');
  assert.deepEqual(m2.learnDemonstration(a2Token,repeated.message,candidates,candidates[1]),
    mira.learnDemonstration(aToken,next.message,candidates,candidates[1]),
    'The next replay draw and listener update continue exactly');
  assert.deepEqual(a2.settleMessage(repeated.handle,m2Token,'match'),
    aster.settleMessage(next.handle,mToken,'match'),'The next sender update continues exactly');
  assert.deepEqual(a2.exportPersistence(),aster.exportPersistence());
  assert.deepEqual(m2.exportPersistence(),mira.exportPersistence());
});
