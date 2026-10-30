import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createOzarkWorldGeometry,OZARK_WORLD_PROFILE} from '../src/ozark-world-geometry.js';
import {createOzarkState,loadOzarkSave,writeOzarkSave,OZARK_SAVE_KEY} from '../src/ozark-save.js';
import {prepareFreshWorld} from '../src/world-reset.js';

const geometry=createOzarkWorldGeometry();
const archivedV1=gunzipSync(readFileSync(new URL('./fixtures/visual-reference-v1-actual-paid-save.json.gz',
  import.meta.url))).toString('utf8');

function storage(initial=null){
  const values=new Map();if(initial!==null)values.set(OZARK_SAVE_KEY,initial);
  let writes=0;
  return {getItem:key=>values.get(key)??null,setItem(key,value){writes++;values.set(key,value);},writes:()=>writes};
}

function withCommunicationEntropy(seeds,run){
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'crypto');
  const original=globalThis.crypto,secureDraw=original.getRandomValues.bind(original);
  let draws=0;
  Object.defineProperty(globalThis,'crypto',{configurable:true,value:{
    getRandomValues(view){
      if(view instanceof Uint32Array&&view.length===1){
        assert(draws<seeds.length,'Unexpected fresh communication seed request');
        view[0]=seeds[draws++];return view;
      }
      return secureDraw(view);
    },
  }});
  try{const result=run();assert.equal(draws,seeds.length,'One independent seed draw per fresh world');return result;}
  finally{Object.defineProperty(globalThis,'crypto',descriptor);}
}

function comparableEnvelope(state){
  const copy=structuredClone({worldLineage:state.worldLineage,visualReference:state.visualReference,
    characterMessages:state.characterMessages});
  copy.worldLineage.instanceId='<world>';
  copy.visualReference.worldId='<world>';
  copy.characterMessages.worldId='<world>';
  return copy;
}

test('explicit communication seeds reproduce private numeric starts without changing physical world',()=>{
  const first=createOzarkState(geometry,{communicationSeed:211});
  const same=createOzarkState(geometry,{communicationSeed:211});
  const other=createOzarkState(geometry,{communicationSeed:212});
  assert.equal(first.environment.seed,OZARK_WORLD_PROFILE.seed);
  assert.deepEqual(first.environment,other.environment);
  assert.deepEqual(first.agents,other.agents);
  assert.notEqual(first.worldLineage.instanceId,same.worldLineage.instanceId);
  assert.deepEqual(comparableEnvelope(first),comparableEnvelope(same));
  assert.notDeepEqual(first.visualReference.random,other.visualReference.random);
  assert.notDeepEqual(first.characterMessages.random,other.characterMessages.random);
  for(let index=0;index<2;index++){
    const left=first.characterMessages.learners[index],right=other.characterMessages.learners[index];
    assert.notDeepEqual(left.sender.model,right.sender.model);
    assert.notEqual(left.sender.randomState,right.sender.randomState);
    assert.notDeepEqual(left.partners[0].listener.model,right.partners[0].listener.model);
    assert.notEqual(left.partners[0].listener.choiceState,right.partners[0].listener.choiceState);
    assert.notEqual(left.partners[0].listener.replayState,right.partners[0].listener.replayState);
  }
  for(const seed of [-1,0x100000000,1.5,NaN,null,'211'])
    assert.throws(()=>createOzarkState(geometry,{communicationSeed:seed}),/symbol seed/);
});

test('ordinary fresh creation draws a new communication seed for each world',()=>{
  const [first,second]=withCommunicationEntropy([0x12345678,0x87654321],()=>[
    createOzarkState(geometry),createOzarkState(geometry)]);
  assert.deepEqual([first.visualReference.seed,second.visualReference.seed],[0x12345678,0x87654321]);
  assert.notEqual(first.worldLineage.instanceId,second.worldLineage.instanceId);
  assert.notDeepEqual(first.characterMessages.learners[0].sender.model,
    second.characterMessages.learners[0].sender.model);
});

test('empty-slot injection is exact; occupied reopen keeps authored valid weights, replay, baseline and RNG',()=>{
  const disk=storage();
  const fresh=loadOzarkSave(disk,geometry,{communicationSeed:0x12345678});
  assert.equal(fresh.exists,false);assert.equal(fresh.blocked,false);
  assert.equal(disk.writes(),0);
  const character=fresh.state.characterMessages;
  const sender=character.learners[0].sender,listener=character.learners[1].partners[0].listener;
  sender.model.Wx[0]+=.001;sender.baseline=.2;sender.revision=1;sender.emissions=1;sender.updates=1;
  sender.randomState=(sender.randomState+1)>>>0;
  listener.model.Wh[0]+=.001;listener.demonstrations=1;listener.optimizerSteps=1;
  listener.choiceState=(listener.choiceState+1)>>>0;
  listener.replayState=(listener.replayState+1)>>>0;
  listener.examples=[{message:'abc',candidates:[Array(48).fill(.2),Array(48).fill(.8)],label:0}];
  assert.equal(writeOzarkSave(disk,fresh.state,geometry),true);
  const bytes=disk.getItem(OZARK_SAVE_KEY),before=JSON.parse(bytes);
  const reopened=withCommunicationEntropy([],()=>loadOzarkSave(disk,geometry,{communicationSeed:212}));
  assert.equal(reopened.blocked,false,reopened.error);
  assert.equal(reopened.state.visualReference.seed,0x12345678);
  assert.deepEqual(reopened.state.characterMessages,before.characterMessages);
  assert.deepEqual(reopened.state.visualReference,before.visualReference);
  assert.equal(disk.getItem(OZARK_SAVE_KEY),bytes);
  assert.equal(disk.writes(),1,'Opening never writes storage');
});

test('confirmed reset creates a fresh untrained envelope and can take an explicit fixture seed',()=>{
  const previous=createOzarkState(geometry,{communicationSeed:211});
  previous.agents[0].rescuePresentation='quiet';
  previous.characterMessages.learners[0].sender.model.Wx[0]+=.1;
  previous.characterMessages.learners[0].sender.emissions=1;
  previous.characterMessages.learners[0].sender.updates=1;
  previous.characterMessages.learners[0].sender.revision=1;
  previous.characterMessages.learners[0].sender.baseline=.2;
  const fixed=JSON.parse(prepareFreshWorld(geometry,previous,{communicationSeed:212}));
  assert.equal(fixed.visualReference.seed,212);
  assert.equal(fixed.environment.seed,OZARK_WORLD_PROFILE.seed);
  assert.equal(fixed.agents[0].rescuePresentation,'quiet');
  assert(fixed.characterMessages.learners.every(row=>row.sender.emissions===0&&row.sender.updates===0&&
    row.sender.revision===0&&row.sender.baseline===0&&row.partners[0].listener.demonstrations===0&&
    row.partners[0].listener.examples.length===0));
  assert(fixed.visualReference.learners.every(row=>row.anchors.length===0&&row.partners.length===0));
  assert.equal(previous.visualReference.seed,211);
  const automatic=withCommunicationEntropy([0x31415926],()=>JSON.parse(prepareFreshWorld(geometry,previous)));
  assert.equal(automatic.visualReference.seed,0x31415926);
  assert.notEqual(automatic.worldLineage.instanceId,previous.worldLineage.instanceId);
});

test('actual paid v1 save and absent-extension fallback retain their historical seed rules',()=>{
  const disk=storage(archivedV1),old=JSON.parse(archivedV1);
  const migrated=withCommunicationEntropy([],()=>loadOzarkSave(disk,geometry,{communicationSeed:212}));
  assert.equal(migrated.blocked,false,migrated.error);
  assert.equal(migrated.state.visualReference.seed,old.visualReference.seed);
  assert.deepEqual(migrated.state.visualReference,old.visualReference);
  assert.equal(disk.getItem(OZARK_SAVE_KEY),archivedV1);
  assert.equal(disk.writes(),0);
  const blank=storage(),current=createOzarkState(geometry,{communicationSeed:212});
  assert.equal(writeOzarkSave(blank,current,geometry),true);
  const preExtension=JSON.parse(blank.getItem(OZARK_SAVE_KEY));
  delete preExtension.worldLineage;delete preExtension.visualReference;delete preExtension.characterMessages;
  delete preExtension.features.characterMessages;
  const bytes=JSON.stringify(preExtension);blank.setItem(OZARK_SAVE_KEY,bytes);
  const writes=blank.writes();
  const opened=withCommunicationEntropy([],()=>loadOzarkSave(blank,geometry,{communicationSeed:212}));
  assert.equal(opened.blocked,false,opened.error);
  assert.equal(opened.state.visualReference.seed,211,'Absent historical envelope keeps deterministic fallback');
  assert.equal(opened.state.characterMessages.learners[0].sender.updates,0);
  assert.equal(blank.getItem(OZARK_SAVE_KEY),bytes);assert.equal(blank.writes(),writes);
});

test('explicit seed cannot make malformed occupied bytes load or permit overwrite',()=>{
  const disk=storage(),live=createOzarkState(geometry,{communicationSeed:211});
  assert.equal(writeOzarkSave(disk,live,geometry),true);
  const good=JSON.parse(disk.getItem(OZARK_SAVE_KEY));
  for(const change of [
    row=>{row.visualReference.seed=-1;},
    row=>{row.characterMessages.learners[0].sender.model.Wx[0]=null;},
    row=>{row.characterMessages.worldId='wrong-world';},
    row=>{delete row.characterMessages;},
  ]){
    const damaged=structuredClone(good);change(damaged);
    const bytes=JSON.stringify(damaged);disk.setItem(OZARK_SAVE_KEY,bytes);
    const writes=disk.writes();
    const opened=withCommunicationEntropy([],()=>loadOzarkSave(disk,geometry,{communicationSeed:212}));
    assert.equal(opened.blocked,true);assert.equal(opened.state,null);
    assert.equal(writeOzarkSave(disk,live,geometry),false);
    assert.equal(disk.getItem(OZARK_SAVE_KEY),bytes);assert.equal(disk.writes(),writes);
  }
});
