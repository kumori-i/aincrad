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
import {lookupEcologyObject} from '../src/ecology.js';

const geometry=createOzarkWorldGeometry();
function fixture({attach=attachVisualReferenceLearning,reverseTicks=false}={}){
  const state=createOzarkState(geometry,{communicationSeed:211}),[sender,listener]=state.agents;
  for(const actor of state.agents){bindOzarkWorldAgent(actor,geometry,state);observeNpc(actor,state.environment);}
  const categories=new Map(senseReferenceObjects(sender,state).bindings.map((id,index)=>[id,index%2]));
  const pixelSensor={suppressedSender:false,listenerOffset:0,senderOverrides:new Map(),
    capture(actor){
      if(actor===sender&&this.suppressedSender)return new Map();
      const visible=senseReferenceObjects(actor,state);
      return new Map(visible.bindings.map((id,index)=>{
        const category=categories.get(id)??index%2;
        const base=actor===sender?(category?.9:.1):(category?.7:.2)+this.listenerOffset;
        const value=actor===sender?(this.senderOverrides.get(id)??base):base;
        return [id,{features:Array(48).fill(value),pixels:Array(768).fill(Math.round(value*255)),at:actor.elapsed,epoch:actor.epoch}];
      }));
    },dispose(){}};
  const attachment=attach({state,pixelSensor,seed:211});
  const step=()=>{
    attachment.beforeTick();state.elapsed+=CONFIG.fixedStep;
    for(const actor of reverseTicks?[...state.agents].reverse():state.agents)tickNpc(actor,CONFIG.fixedStep,state.environment);
    attachment.afterTick();
  };
  const advance=seconds=>{for(let index=0;index<Math.round(seconds/CONFIG.fixedStep);index++)step();};
  function begin(){
    const action=attachment.hooks.optionalAction(listener);
    assert.equal(action?.type,'inspect_object');
    const result=requestNpcAction(listener,action,state.environment);
    attachment.hooks.performed(listener,action,result,listener.active);
    assert.equal(result.code,'ACTION_STARTED');
    return action;
  }
  function demonstrate(){
    advance(2);
    const action=attachment.hooks.optionalAction(sender);
    assert.equal(action?.type,'indicate_object');
    assert.equal(attachment.hooks.performOptional(sender,action).code,'ACTION_STARTED');
    advance(2);
    const snapshot=attachment.snapshot();
    assert.equal(snapshot.observed,1,'The original listener own-view correction remains intact');
    assert.equal(snapshot.learners.find(row=>row.agentId===listener.id).counts.examples,1);
    return action;
  }
  function beginResponse(){
    const action=attachment.hooks.optionalAction(listener);
    assert.equal(action?.type,'indicate_object');
    assert.equal(attachment.hooks.performOptional(listener,action).code,'ACTION_STARTED');
    return action;
  }
  const event=()=>attachment.snapshot().observationEvents[0];
  const intendedValue=()=>pixelSensor.capture(sender).get(event().demonstratedObjectId).features[0];
  const respondWith=value=>{
    const selected=listener.active?.request?.targetId;
    // Caller starts the response first, then sets the only sender-local crop
    // that can be interpreted from the listener's public physical pose.
    assert.ok(selected);
    pixelSensor.senderOverrides.set(selected,value);
    advance(2);
    return attachment.snapshot();
  };
  return {state,sender,listener,pixelSensor,attachment,step,advance,begin,demonstrate,beginResponse,respondWith,event,intendedValue};
}

test('a fully paid visible listener response gives one sender-local match sample',()=>{
  const f=fixture();f.begin();f.demonstrate();
  assert.deepEqual(f.attachment.snapshot().senderFeedback,[]);
  f.beginResponse();const intended=f.intendedValue(),selected=f.listener.active.request.targetId;
  const snapshot=f.respondWith(intended);
  assert.equal(snapshot.pending,0);
  assert.equal(snapshot.senderFeedback.length,1);
  assert.equal(snapshot.senderFeedback[0].signal,'match');
  assert.deepEqual(snapshot.senderFeedback[0].features,f.pixelSensor.capture(f.sender).get(selected).features);
  assert.equal(snapshot.senderFeedback[0].eventId,snapshot.observationEvents[0].id);
  assert.equal(snapshot.observationEvents[0].feedbackStatus,'matched');
  assert.equal(snapshot.observationEvents[0].reward,null,'Visual comparison is not bodily reward');
  assert.equal(snapshot.learners.find(row=>row.agentId===f.listener.id).counts.examples,1);
  f.advance(1);
  assert.deepEqual(f.attachment.snapshot().senderFeedback,snapshot.senderFeedback,'Terminal callbacks cannot double credit');
  assert.deepEqual(f.attachment.takeSenderFeedback(f.listener),[],'The other actor cannot consume sender evidence');
  const consumed=f.attachment.takeSenderFeedback(f.sender);
  assert.deepEqual(Object.keys(consumed[0]).sort(),['at','features','signal','symbol'],
    'The future policy input contains no target identity, correctness bit, listener crop or event metadata');
  assert.equal(consumed[0].signal,'match');
  assert.deepEqual(consumed[0].features,snapshot.senderFeedback[0].features);
  assert.deepEqual(f.attachment.takeSenderFeedback(f.sender),[],'A feedback sample is consumed only once');
  f.attachment.dispose();
});

test('a dissimilar sender crop yields mismatch, while a gray crop yields no learning sample',()=>{
  for(const outcome of ['mismatch','gray']){
    const f=fixture();f.begin();f.demonstrate();f.beginResponse();
    const intended=f.intendedValue();
    const value=outcome==='mismatch'?(intended>.5?.1:.9):intended+(intended>.5?-.06:.06);
    const snapshot=f.respondWith(value);
    assert.equal(snapshot.pending,0);
    assert.equal(snapshot.observationEvents[0].feedbackStatus,outcome==='mismatch'?'mismatched':'censored');
    assert.equal(snapshot.senderFeedback.length,outcome==='mismatch'?1:0);
    if(outcome==='mismatch')assert.equal(snapshot.senderFeedback[0].signal,'mismatch');
    assert.equal(snapshot.learners.find(row=>row.agentId===f.listener.id).counts.examples,1,
      'A response outcome cannot erase the listener own-view demonstration');
    f.attachment.dispose();
  }
});

test('receiver crop changes cannot alter the sender feedback input',()=>{
  const runs=[];
  for(const listenerOffset of [0,.09]){
    const f=fixture();f.begin();f.demonstrate();f.beginResponse();
    const intended=f.intendedValue();f.pixelSensor.listenerOffset=listenerOffset;
    const snapshot=f.respondWith(intended);
    runs.push(snapshot.senderFeedback);
    f.attachment.dispose();
  }
  assert.deepEqual(runs[0],runs[1]);
});

test('critic correctness cannot determine the feedback signal when sender sight is fixed',async()=>{
  const source=await readFile(new URL('../src/visual-reference-attachment.js',import.meta.url),'utf8');
  const seam="createReferenceRandomStream({seed,purpose:'choice'})";
  assert.equal(source.split(seam).length-1,1);
  const results=[];
  for(const forced of [.25,.75]){
    const isolated=source.replace(seam,`(()=>${forced})`).replace(/from '(\.\/[^']+)'/g,
      (_all,path)=>`from '${new URL(path,new URL('../src/visual-reference-attachment.js',import.meta.url)).href}'`);
    const {attachVisualReferenceLearning:attach}=await import(`data:text/javascript;base64,${Buffer.from(isolated).toString('base64')}`);
    const f=fixture({attach});f.begin();f.demonstrate();f.beginResponse();
    const snapshot=f.respondWith(f.intendedValue());
    results.push({critic:snapshot.observationEvents[0].referenceCorrect,signal:snapshot.senderFeedback[0]?.signal});
    f.attachment.dispose();
  }
  assert.deepEqual(results.map(row=>row.critic).sort(),[false,true]);
  assert.deepEqual(results.map(row=>row.signal),['match','match'],
    'Both physical-choice branches receive the same signal from the same sender-local crop');
});

test('an original wrong inspected choice naturally returns a sender-visible mismatch after correction',async()=>{
  const source=await readFile(new URL('../src/visual-reference-attachment.js',import.meta.url),'utf8');
  const seam="createReferenceRandomStream({seed,purpose:'choice'})";
  assert.equal(source.split(seam).length-1,1);
  let verified=false;
  for(const forced of [.25,.75]){
    const isolated=source.replace(seam,`(()=>${forced})`).replace(/from '(\.\/[^']+)'/g,
      (_all,path)=>`from '${new URL(path,new URL('../src/visual-reference-attachment.js',import.meta.url)).href}'`);
    const {attachVisualReferenceLearning:attach}=await import(`data:text/javascript;base64,${Buffer.from(isolated).toString('base64')}`);
    const f=fixture({attach}),initialChoice=f.begin();
    const originallyInspectedId=initialChoice.targetId;
    f.demonstrate();
    if(f.event().referenceCorrect){f.attachment.dispose();continue;}
    assert.notEqual(originallyInspectedId,f.event().demonstratedObjectId);
    assert.equal(f.attachment.snapshot().learners.find(row=>row.agentId===f.listener.id).counts.examples,1,
      'The listener has already learned its own corrective demonstration');
    f.beginResponse();
    assert.equal(f.listener.active.request.targetId,originallyInspectedId,
      'The paid reply is bound to the original inspected choice, not the corrected referent');
    const originalCrop=f.pixelSensor.capture(f.sender).get(originallyInspectedId).features;
    const intendedCrop=f.pixelSensor.capture(f.sender).get(f.event().demonstratedObjectId).features;
    assert.notDeepEqual(originalCrop,intendedCrop);
    f.advance(2);
    const snapshot=f.attachment.snapshot();
    assert.equal(snapshot.observationEvents[0].feedbackStatus,'mismatched');
    assert.equal(snapshot.senderFeedback[0].signal,'mismatch');
    assert.deepEqual(snapshot.senderFeedback[0].features,originalCrop);
    assert.deepEqual(f.attachment.takeSenderFeedback(f.sender).map(({signal,features})=>({signal,features})),
      [{signal:'mismatch',features:originalCrop}]);
    verified=true;f.attachment.dispose();break;
  }
  assert.equal(verified,true,'Both fixed exploration branches must include a wrong original choice');
});

test('missing, ambiguous and interrupted responses produce no positive or negative sample',()=>{
  for(const ending of ['missing','ambiguous','cancel','collapse','replacement','dispose']){
    const f=fixture();f.begin();f.demonstrate();f.beginResponse();
    if(ending==='missing')f.pixelSensor.suppressedSender=true;
    if(ending==='ambiguous'){
      const selected=f.listener.active.request.targetId,target=f.event().demonstratedObjectId;
      const third=senseReferenceObjects(f.sender,f.state).bindings.find(id=>id!==selected&&id!==target);
      assert.ok(third);
      const p=lookupEcologyObject(f.state.environment.ecology,selected).position;
      Object.assign(lookupEcologyObject(f.state.environment.ecology,third).position,{x:p.x,y:p.y});
    }
    if(ending==='cancel'){f.advance(.25);cancelNpcAction(f.listener,'TEST_INTERRUPTION');}
    else if(ending==='collapse'){f.advance(.25);collapseNpc(f.listener,'TEST_INTERRUPTION');}
    else if(ending==='replacement')f.listener.physiology=structuredClone(f.listener.physiology);
    else if(ending==='dispose')f.attachment.dispose();
    if(ending!=='dispose')f.advance(2);
    const snapshot=f.attachment.snapshot();
    assert.deepEqual(snapshot.senderFeedback,[],ending+' must not train the sender');
    assert.equal(snapshot.positive,0);assert.equal(snapshot.negative,0);
    if(ending!=='replacement')assert.equal(snapshot.learners.find(row=>row.agentId===f.listener.id).counts.examples,1);
    f.attachment.dispose();
  }
});

test('a pending response is absent after save/reopen and cannot revive feedback authority',()=>{
  const f=fixture();f.begin();f.demonstrate();f.beginResponse();f.advance(.2);
  const persisted=f.attachment.exportPersistence(),values=new Map();
  const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  // This unit fixture advances both NPCs directly; align the ordinary world
  // clocks before exercising the strict whole-world save validator.
  f.state.environment.elapsed=f.state.elapsed;
  f.state.environment.ecology.elapsed=f.state.elapsed;
  assert.equal(writeOzarkSave(storage,f.state,geometry,{referencePersistence:persisted}),true);
  const reopened=loadOzarkSave(storage,geometry);
  assert.equal(reopened.blocked,false);
  for(const actor of reopened.state.agents){bindOzarkWorldAgent(actor,geometry,reopened.state);observeNpc(actor,reopened.state.environment);}
  const sensor={capture(actor){const visible=senseReferenceObjects(actor,reopened.state);return new Map(visible.bindings.map(id=>[id,
    {features:Array(48).fill(.2),pixels:Array(768).fill(51),at:actor.elapsed,epoch:actor.epoch}]));}};
  const restored=attachVisualReferenceLearning({state:reopened.state,pixelSensor:sensor});
  const snapshot=restored.snapshot();
  assert.equal(snapshot.pending,0);assert.deepEqual(snapshot.senderFeedback,[]);
  assert.deepEqual(snapshot.observationEvents,[]);
  assert.equal(snapshot.learners.find(row=>row.agentId==='mira').counts.examples,1);
  restored.afterTick();assert.deepEqual(restored.snapshot().senderFeedback,[]);
  restored.dispose();f.attachment.dispose();
});

test('reversing candidate slots with the same selected object leaves sender feedback unchanged',async()=>{
  const source=await readFile(new URL('../src/visual-reference-attachment.js',import.meta.url),'utf8');
  const orderSeam="createReferenceRandomStream({seed,purpose:'order',state:savedRandom.order})";
  const choiceSeam="createReferenceRandomStream({seed,purpose:'choice'})";
  assert.equal(source.split(orderSeam).length-1,1);
  assert.equal(source.split(choiceSeam).length-1,1);
  const rows=[];
  for(const [order,choice] of [[.25,.25],[.75,.75]]){
    const isolated=source.replace(orderSeam,`(()=>${order})`).replace(choiceSeam,`(()=>${choice})`)
      .replace(/from '(\.\/[^']+)'/g,(_all,path)=>`from '${new URL(path,new URL('../src/visual-reference-attachment.js',import.meta.url)).href}'`);
    const {attachVisualReferenceLearning:attach}=await import(`data:text/javascript;base64,${Buffer.from(isolated).toString('base64')}`);
    const f=fixture({attach}),originalChoice=f.begin();
    f.demonstrate();f.beginResponse();f.advance(2);
    const snapshot=f.attachment.snapshot();
    rows.push({selectedId:originalChoice.targetId,demonstratedId:f.event().demonstratedObjectId,
      critic:f.event().referenceCorrect,signal:snapshot.senderFeedback[0]?.signal,
      features:snapshot.senderFeedback[0]?.features});
    f.attachment.dispose();
  }
  assert.deepEqual(rows[0],rows[1],
    'The same physical selection, target and sender-local view must yield the same feedback after slot reversal');
  assert.ok(['match','mismatch'].includes(rows[0].signal));
});

test('a miswired performed hook cannot turn a different paid inspection into response authority',()=>{
  const f=fixture();
  const requested=f.attachment.hooks.optionalAction(f.listener);
  assert.equal(requested?.type,'inspect_object');
  const other=senseReferenceObjects(f.listener,f.state).bindings.find(id=>id!==requested.targetId&&
    f.listener.discovery.observations[id]&&
    Math.hypot(lookupEcologyObject(f.state.environment.ecology,id).position.x-f.listener.position.x,
      lookupEcologyObject(f.state.environment.ecology,id).position.y-f.listener.position.y)<=400);
  assert.ok(other);
  const result=requestNpcAction(f.listener,{type:'inspect_object',targetId:other},f.state.environment);
  assert.equal(result.code,'ACTION_STARTED');
  f.attachment.hooks.performed(f.listener,requested,result,f.listener.active);
  f.advance(2);
  const snapshot=f.attachment.snapshot();
  assert.equal(snapshot.censored,1);
  assert.equal(snapshot.observed,0);
  assert.deepEqual(snapshot.senderFeedback,[]);
  assert.notEqual(f.attachment.hooks.optionalAction(f.sender)?.type,'indicate_object',
    'The sender cannot gain a corrective permit from an unrelated paid target');
  f.attachment.dispose();
});

test('waiting and active response timeouts or urgent decisions censor feedback without erasing listener learning',()=>{
  for(const stage of ['waiting','active'])for(const ending of ['timeout','priority']){
    const f=fixture();f.begin();f.demonstrate();
    if(ending==='timeout')f.advance(stage==='active'?7.4:8.1);
    if(stage==='active'){
      f.beginResponse();
      if(ending==='priority')f.advance(.25);
      else f.advance(.7);
    }
    if(ending==='priority')f.attachment.hooks.decision(f.listener,{need:'water'});
    const snapshot=f.attachment.snapshot();
    assert.equal(snapshot.pending,0,`${stage} ${ending} retires the session`);
    assert.equal(snapshot.observationEvents[0].feedbackStatus,'censored');
    assert.deepEqual(snapshot.senderFeedback,[],`${stage} ${ending} gives no visual reward or penalty`);
    assert.equal(snapshot.learners.find(row=>row.agentId===f.listener.id).counts.examples,1,
      `${stage} ${ending} retains the earlier canonical own-view association`);
    assert.equal(f.listener.active,null,`${stage} ${ending} cancels any active response action`);
    f.attachment.dispose();
  }
});

test('the other actor collapsing immediately hides and retires an unconsumed sender sample',()=>{
  const f=fixture();f.begin();f.demonstrate();f.beginResponse();
  const learned=f.respondWith(f.intendedValue());
  assert.equal(learned.senderFeedback.length,1);
  const associations=learned.learners;
  collapseNpc(f.listener,'TEST_COLLAPSE_AFTER_RESPONSE');
  assert.deepEqual(f.attachment.snapshot().senderFeedback,[],
    'A read-only snapshot cannot expose evidence across a new bodily epoch before maintenance');
  assert.deepEqual(f.attachment.takeSenderFeedback(f.sender),[],
    'The sender cannot consume a sample after the responding actor collapses');
  assert.deepEqual(f.attachment.snapshot().learners,associations,
    'Completed listener associations survive an ordinary collapse boundary');
  f.attachment.beforeTick();
  assert.deepEqual(f.attachment.snapshot().senderFeedback,[]);
  f.attachment.dispose();
});
