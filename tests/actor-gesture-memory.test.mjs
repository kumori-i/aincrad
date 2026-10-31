import test from 'node:test';
import assert from 'node:assert/strict';
import {CONFIG} from '../src/config.js';
import {createOzarkState,writeOzarkSave,loadOzarkSave} from '../src/ozark-save.js';
import {createOzarkWorldGeometry} from '../src/ozark-world-geometry.js';
import {bindOzarkWorldAgent} from '../src/ozark-agent-world.js';
import {observeNpc,requestNpcAction,tickNpc,cancelNpcAction} from '../src/npc.js';
import {attachVisualReferenceLearning} from '../src/visual-reference-attachment.js';
import {createActorGestureMemory} from '../src/actor-gesture-memory.js';
import {sensePublicPeerGesture,senseReferenceObjects} from '../src/visual-reference-perception.js';
import {publicIndicationGeometry} from '../src/discovery-actions.js';

const geometry=createOzarkWorldGeometry();
function fixture({enabled=true,listenerSight=null,state=createOzarkState(geometry,{communicationSeed:211})}={}){
  const [sender,listener]=state.agents;
  const listenerWorld=listenerSight?Object.freeze({...geometry,
    lineOfSight:(from,to)=>listenerSight(from,to,geometry.lineOfSight)}):geometry;
  for(const actor of state.agents){
    bindOzarkWorldAgent(actor,actor===listener?listenerWorld:geometry,state);
    observeNpc(actor,state.environment);
  }
  const categories=new Map(senseReferenceObjects(sender,state).bindings.map((id,index)=>[id,index%2]));
  const pixelSensor={capture(actor){
    const sight=senseReferenceObjects(actor,state);
    return new Map(sight.bindings.map((id,index)=>{
      const value=(categories.get(id)??index%2)?.8:.1;
      return [id,{features:Array(48).fill(value),pixels:Array(768).fill(Math.round(value*255)),
        at:actor.elapsed,epoch:actor.epoch}];
    }));
  },dispose(){}};
  const attachment=attachVisualReferenceLearning({state,pixelSensor,protocol:'sequence',gestureMemoryEnabled:enabled});
  const step=()=>{
    attachment.beforeTick();state.elapsed+=CONFIG.fixedStep;
    for(const actor of state.agents)tickNpc(actor,CONFIG.fixedStep,state.environment);
    attachment.afterTick();
  };
  const advance=seconds=>{for(let i=0;i<Math.round(seconds/CONFIG.fixedStep);i++)step();};
  const start=()=>{
    const choice=attachment.hooks.optionalAction(listener);
    assert.equal(choice?.type,'inspect_object');
    const result=requestNpcAction(listener,choice,state.environment);
    attachment.hooks.performed(listener,choice,result,listener.active);
    assert.equal(result.code,'ACTION_STARTED');
    advance(2);
    const indication=attachment.hooks.optionalAction(sender);
    assert.equal(indication?.type,'indicate_object');
    assert.equal(attachment.hooks.performOptional(sender,indication).code,'ACTION_STARTED');
  };
  return {state,sender,listener,attachment,pixelSensor,step,advance,start};
}

test('bounded local rows distinguish unknown, visible absence and uninterrupted visible time',()=>{
  const memory=createActorGestureMemory({capacity:3,ttlSeconds:1});
  const sample=(at,visibility)=>({at,visibility,
    peer:visibility==='unknown'?null:{dx:3,dy:4},pose:null,
    self:{actionActive:0,poseProgress:null}});
  assert.equal(memory.record(sample(0,'unknown')),true);
  memory.record(sample(CONFIG.fixedStep,'absent'));
  memory.record(sample(2*CONFIG.fixedStep,'absent'));
  let rows=memory.read(2*CONFIG.fixedStep).records;
  assert.equal(rows[1].continuousVisible,false,'An unseen first interval cannot imply visible silence');
  assert.equal(rows[2].continuousVisible,true);
  assert.equal(rows[2].continuousAbsenceSeconds,CONFIG.fixedStep);
  rows[2].peer.dx=999;
  assert.equal(memory.read(2*CONFIG.fixedStep).records[2].peer.dx,3);
  assert.equal(memory.record(sample(2*CONFIG.fixedStep,'unknown')),false,'Repeated clock reads are not new evidence');
  memory.record(sample(3*CONFIG.fixedStep,'unknown'));
  assert.equal(memory.read(3*CONFIG.fixedStep).overflows,1);
  for(let i=4;i<40;i++)memory.record(sample(i*CONFIG.fixedStep,'absent'));
  const bounded=memory.read(39*CONFIG.fixedStep).records.at(-1);
  assert(bounded.visibleSeconds<=2*CONFIG.fixedStep+1e-8);
  assert(bounded.continuousAbsenceSeconds<=2*CONFIG.fixedStep+1e-8);
  memory.record(sample(.9,'absent'));
  assert.equal(memory.read(.9).records.at(-1).continuousVisible,false,'A missed frame interrupts visibility');
  memory.record(sample(2.1,'absent'));
  const expired=memory.read(2.1);
  assert.equal(expired.records.length,1);
  assert.equal(expired.records[0].visibleSeconds,0);
  assert(expired.expirations>=1);
  memory.clear();assert.deepEqual(memory.read(2.1).records,[]);
  assert.throws(()=>memory.record({...sample(2,'pose'),pose:{origin:{dx:0,dy:0},tip:{dx:1,dy:0},progress:NaN}}),/Invalid/);
});

test('real paid public indication enters only the listener’s numeric local view',()=>{
  const f=fixture();
  try{
    f.step();
    assert.equal(f.attachment.readGestureMemory(f.listener).records.at(-1).visibility,'absent');
    f.start();f.advance(.25);
    const pose=publicIndicationGeometry(f.sender);
    assert(pose&&pose.progress>0,'The ordinary action has paid for a rendered pose');
    const received=f.attachment.readGestureMemory(f.listener).records.at(-1);
    const own=f.attachment.readGestureMemory(f.sender).records.at(-1);
    assert.equal(received.visibility,'pose');
    assert.equal(received.continuousVisible,true);
    assert.equal(received.pose.progress,pose.progress);
    assert(Math.abs(received.pose.tip.dx-(pose.tip.x-f.listener.position.x))<1e-8);
    assert.equal(received.self.actionActive,0);
    assert.equal(own.visibility,'absent');
    assert.equal(own.self.actionActive,1);
    assert(own.self.poseProgress>0);
    assert(!JSON.stringify(received).includes(f.sender.active.request.targetId),
      'A numeric pose row must not carry the private object binding');
    const copy=f.attachment.readGestureMemory(f.listener);
    copy.records.at(-1).pose.tip.dx=999;copy.records.length=0;
    assert.notEqual(f.attachment.readGestureMemory(f.listener).records.at(-1).pose.tip.dx,999);
    f.advance(1.75);
    const last=f.attachment.readGestureMemory(f.listener).records.at(-1);
    assert.equal(last.visibility,'absent','A finished pose is no longer public');
    assert(last.continuousVisible,'The visible pose-to-absence transition was observed');
    assert.equal(f.attachment.snapshot().observed,1);
  }finally{f.attachment.dispose();}
});

test('peer occlusion and a partly hidden paid segment are unknown, and break continuity',()=>{
  let hiddenPeer=false,hiddenSegment=null;
  const f=fixture({listenerSight:(from,to,ordinary)=>{
    if(hiddenPeer&&Math.hypot(to.x-f.sender.position.x,to.y-f.sender.position.y)<1e-8)return false;
    if(hiddenSegment&&Math.hypot(to.x-hiddenSegment.x,to.y-hiddenSegment.y)<1e-8)return false;
    return ordinary(from,to);
  }});
  try{
    f.start();f.advance(.15);
    assert.equal(f.attachment.readGestureMemory(f.listener).records.at(-1).visibility,'pose');
    const pose=publicIndicationGeometry(f.sender);
    assert(pose);
    // The segment is checked at integer positions; its midpoint is a sampled point.
    hiddenSegment={x:(pose.origin.x+pose.tip.x)/2,y:(pose.origin.y+pose.tip.y)/2};
    f.step();
    let row=f.attachment.readGestureMemory(f.listener).records.at(-1);
    assert.equal(row.visibility,'unknown');assert(row.peer);
    hiddenSegment=null;f.step();
    row=f.attachment.readGestureMemory(f.listener).records.at(-1);
    assert.equal(row.visibility,'pose');assert.equal(row.continuousVisible,false);
    hiddenPeer=true;f.step();
    row=f.attachment.readGestureMemory(f.listener).records.at(-1);
    assert.equal(row.visibility,'unknown');assert.equal(row.peer,null);
    hiddenPeer=false;f.step();
    row=f.attachment.readGestureMemory(f.listener).records.at(-1);
    assert.equal(row.visibility,'absent','The ordinary transaction was interrupted by lost peer sight');
    assert.equal(row.continuousVisible,false);
    assert.equal(sensePublicPeerGesture(f.listener,{...f.sender,scene:'other'}).visibility,'unknown');
  }finally{f.attachment.dispose();}
});

test('generic visible absence uses ordinary sight rather than the narrower reference-admission radius',()=>{
  const f=fixture({listenerSight:()=>true});
  try{
    f.sender.position={x:f.listener.position.x+300,y:f.listener.position.y};
    const sensed=sensePublicPeerGesture(f.listener,f.sender);
    assert.equal(sensed.visibility,'absent','A clearly seen peer at 300 units has no public pose');
    assert.equal(sensed.peer.dx,300);
    f.sender.position={x:f.listener.position.x+401,y:f.listener.position.y};
    assert.equal(sensePublicPeerGesture(f.listener,f.sender).visibility,'unknown');
  }finally{f.attachment.dispose();}
});

test('an unavailable local observer cannot certify a peer pose or absence',()=>{
  const f=fixture();
  try{
    f.listener.lifecycle='COLLAPSED';
    assert.equal(sensePublicPeerGesture(f.listener,f.sender).visibility,'unknown');
    f.listener.lifecycle='AWAKE';f.listener.position.x=NaN;
    assert.equal(sensePublicPeerGesture(f.listener,f.sender).visibility,'unknown');
  }finally{f.attachment.dispose();}
});

test('interrupted actions, identity changes, censor, disposal and reopen erase only session gesture evidence',()=>{
  const f=fixture();
  try{
    f.start();f.advance(.15);
    const before=f.attachment.exportPersistence();
    assert(f.attachment.readGestureMemory(f.listener).records.some(row=>row.visibility==='pose'));
    cancelNpcAction(f.sender,'TEST_INTERRUPTION');f.step();
    assert.equal(f.attachment.readGestureMemory(f.listener).records.at(-1).visibility,'absent');
    const values=new Map(),storage={getItem:key=>values.get(key)??null,
      setItem:(key,value)=>values.set(key,value)};
    f.state.environment.elapsed=f.state.elapsed;f.state.environment.ecology.elapsed=f.state.elapsed;
    assert.equal(writeOzarkSave(storage,f.state,geometry,{referencePersistence:before}),true);
    const reopened=loadOzarkSave(storage,geometry);
    assert.equal(reopened.blocked,false);
    const reopenedAttachment=fixture({state:reopened.state}).attachment;
    assert.deepEqual(reopenedAttachment.readGestureMemory(reopened.state.agents[1]).records,[]);
    reopenedAttachment.dispose();
    f.sender.epoch++;
    assert.equal(f.attachment.readGestureMemory(f.listener),null,'A stale epoch fails closed before reconciliation');
    f.attachment.beforeTick();
    assert.deepEqual(f.attachment.readGestureMemory(f.listener).records,[]);
    f.step();
    f.listener.discovery=structuredClone(f.listener.discovery);
    assert.equal(f.attachment.readGestureMemory(f.sender),null,'A replaced peer cannot leak old rows');
    f.attachment.beforeTick();
    assert.deepEqual(f.attachment.readGestureMemory(f.sender).records,[]);
    f.step();f.attachment.censorPending();
    assert.deepEqual(f.attachment.readGestureMemory(f.sender).records,[]);
  }finally{f.attachment.dispose();}
  assert.equal(f.attachment.readGestureMemory(f.listener),null);
});

test('hostile observer copies and repeated reads cannot change action, RNG or learner continuation',()=>{
  const original=createOzarkState(geometry,{communicationSeed:211});
  const comparison=createOzarkState(geometry,{communicationSeed:211});
  for(const key of ['worldLineage','visualReference','characterMessages'])
    comparison[key]=structuredClone(original[key]);
  const a=fixture({state:original}),b=fixture({enabled:false,state:comparison});
  try{
    for(let i=0;i<12;i++){a.step();b.step();}
    a.start();b.start();
    for(let i=0;i<130;i++){
      a.step();b.step();
      const snapshot=a.attachment.readGestureMemory(a.listener);
      if(snapshot.records.length){snapshot.records.at(-1).self.actionActive=99;snapshot.records.length=0;}
      const observer=a.attachment.measurementSnapshot();
      if(observer?.events.length){observer.events[0].referenceCorrect=false;observer.events[0].targetId='hostile';}
    }
    const replyA=a.attachment.hooks.optionalAction(a.listener);
    const replyB=b.attachment.hooks.optionalAction(b.listener);
    assert.equal(replyA?.type,'indicate_object');assert.equal(replyB?.type,'indicate_object');
    assert.equal(a.attachment.hooks.performOptional(a.listener,replyA).code,'ACTION_STARTED');
    assert.equal(b.attachment.hooks.performOptional(b.listener,replyB).code,'ACTION_STARTED');
    for(let i=0;i<130;i++){a.step();b.step();a.attachment.readGestureMemory(a.sender);}
    assert.equal(a.attachment.measurementSnapshot().counts.senderUpdates,1,
      'Both listeners and the sender have now taken an authentic update path');
    assert.deepEqual(a.attachment.exportPersistence(),b.attachment.exportPersistence(),
      'Private memory cannot draw RNG or alter either learned model');
    assert.deepEqual(a.attachment.measurementSnapshot(),b.attachment.measurementSnapshot());
    assert.deepEqual(a.state,b.state,'Ordinary action and body state are unchanged');
    assert.equal(b.attachment.readGestureMemory(b.listener),null);
  }finally{a.attachment.dispose();b.attachment.dispose();}
});

test('a failed passive sight query discards gesture rows without stopping existing learning',()=>{
  let fail=false;
  const f=fixture({listenerSight:(from,to,ordinary)=>{
    if(fail)throw new Error('synthetic sight failure');
    return ordinary(from,to);
  }});
  try{
    f.step();assert.equal(f.attachment.readGestureMemory(f.listener).records.length,1);
    const before=f.attachment.exportPersistence();
    fail=true;
    assert.doesNotThrow(()=>f.attachment.afterTick());
    assert.deepEqual(f.attachment.readGestureMemory(f.listener).records,[]);
    assert.deepEqual(f.attachment.exportPersistence(),before);
  }finally{f.attachment.dispose();}
});
