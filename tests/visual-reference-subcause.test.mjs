import test from 'node:test';
import assert from 'node:assert/strict';
import {createNpc} from '../src/npc-state.js';
import {OZARK_WORLD_PROFILE} from '../src/ozark-world-geometry.js';
import {bindOzarkWorldAgent} from '../src/ozark-agent-world.js';
import {findReferencePeer,reverseReferenceFailure} from '../src/visual-reference-attachment.js';

function peerFixture(visible=true){
  const sender=createNpc({id:'aster',mode:'discovery'}),receiver=createNpc({id:'mira',mode:'discovery'});
  sender.position={x:20,y:0};receiver.position={x:0,y:0};
  const state={geometryIdentity:OZARK_WORLD_PROFILE.identity,agents:[sender,receiver]};
  let sightCalls=0;
  const geometry={profile:OZARK_WORLD_PROFILE,sample(){return{};},classify(){return{walkable:true};},
    canOccupy(){return true;},advance(){throw Error('Peer diagnostic cannot advance the world');},
    lineOfSight(){sightCalls++;return visible;}};
  bindOzarkWorldAgent(receiver,geometry,state);
  return {sender,receiver,busy:new Map(),sightCalls:()=>sightCalls};
}

test('peer subcause is the first failed existing predicate, with no later sight query',()=>{
  const cases=[
    ['not-awake',f=>{f.sender.lifecycle='COLLAPSED';}],
    ['urgent',f=>{f.sender.physiology.health=20;}],
    ['active',f=>{f.sender.active={request:{type:'rest'}};}],
    ['busy',f=>{f.busy.set(f.sender,{});}],
    ['other-scene',f=>{f.sender.scene='other';}],
    ['too-far',f=>{f.sender.position={x:251,y:0};}],
    ['occluded',()=>{},false],
  ];
  for(const [expected,change,visible=true]of cases){
    const f=peerFixture(visible);change(f);
    assert.deepEqual(findReferencePeer([f.sender,f.receiver],f.receiver,f.busy),
      {sender:undefined,firstFailure:expected},expected);
    assert.equal(f.sightCalls(),expected==='occluded'?1:0,expected);
  }
  const missing=peerFixture();
  assert.deepEqual(findReferencePeer([missing.receiver],missing.receiver,missing.busy),
    {sender:undefined,firstFailure:'missing'});
  assert.equal(missing.sightCalls(),0);
  const ordered=peerFixture(false);
  ordered.sender.physiology.health=20;ordered.sender.active={request:{type:'rest'}};
  assert.equal(findReferencePeer([ordered.sender,ordered.receiver],ordered.receiver,ordered.busy).firstFailure,
    'urgent','An earlier bodily predicate prevents later active and sight predicates from being read');
  assert.equal(ordered.sightCalls(),0);
  const eligible=peerFixture();
  assert.deepEqual(findReferencePeer([eligible.sender,eligible.receiver],eligible.receiver,eligible.busy),
    {sender:eligible.sender,firstFailure:null});
  assert.equal(eligible.sightCalls(),1);
});

test('reverse subcause classifies each failed existing check without observing later checks',()=>{
  const cases=[
    ['sender-sight-incomplete',{complete:false,objects:[]},0,{},true,null,0,0],
    ['selected-absent',{complete:true,objects:[]},-1,{},true,null,0,0],
    ['reverse-geometry-unavailable',{complete:true,objects:[]},0,null,true,null,0,0],
    ['reverse-gesture-invisible',{complete:true,objects:[]},0,{},false,null,1,0],
    ['reverse-ambiguous',{complete:true,objects:[]},0,{},true,{index:null,reason:'ambiguous'},1,1],
    ['reverse-no-referent',{complete:true,objects:[]},0,{},true,{index:null,reason:'no-visible-referent'},1,1],
    ['reverse-other-referent',{complete:true,objects:[]},0,{},true,{index:1,reason:'resolved'},1,1],
    ['reverse-invalid-resolution',{complete:true,objects:[]},0,{},true,{index:null,reason:'invalid-observation'},1,1],
    [null,{complete:true,objects:[]},0,{},true,{index:0,reason:'resolved'},1,1],
  ];
  for(const [expected,sight,index,reply,shown,resolution,visibleCalls,resolveCalls]of cases){
    let saw=0,parsed=0;
    const actual=reverseReferenceFailure({},sight,index,reply,
      ()=>{saw++;return shown;},()=>{parsed++;return resolution;});
    assert.equal(actual,expected,expected??'success');
    assert.equal(saw,visibleCalls,expected??'success');
    assert.equal(parsed,resolveCalls,expected??'success');
  }
});
