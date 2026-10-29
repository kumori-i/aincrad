import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {CONFIG} from '../src/config.js';
import {createOzarkState} from '../src/ozark-save.js';
import {createOzarkWorldGeometry} from '../src/ozark-world-geometry.js';
import {bindOzarkWorldAgent} from '../src/ozark-agent-world.js';
import {observeNpc,requestNpcAction,tickNpc,cancelNpcAction} from '../src/npc.js';
import {tickDiscoveryAction} from '../src/discovery-actions.js';
import {discoveryDecision} from '../src/discovery.js';
import {attachVisualReferenceLearning,continuousReferenceStep} from '../src/visual-reference-attachment.js';
import {senseReferenceObjects} from '../src/visual-reference-perception.js';
const geometry=createOzarkWorldGeometry();
function fixture(seed=211,{reverseTicks=false}={}){
  const state=createOzarkState(geometry);
  for(const n of state.agents){bindOzarkWorldAgent(n,geometry,state);observeNpc(n,state.environment);}
  // Deliberately synthetic crops test transaction authority, not visual learning.
  const pixelSensor={suppressed:false,capture(n){if(this.suppressed)return new Map();const s=senseReferenceObjects(n,state);return new Map(s.bindings.map((id,i)=>[id,{features:Array(48).fill(i%2?.8:.1),pixels:Array(768).fill(i%2?204:26),at:n.elapsed,epoch:n.epoch}]));},dispose(){}};
  const attachment=attachVisualReferenceLearning({state,pixelSensor,seed});
  const step=()=>{attachment.beforeTick();state.elapsed+=CONFIG.fixedStep;for(const n of reverseTicks?state.agents.slice().reverse():state.agents)tickNpc(n,CONFIG.fixedStep,state.environment);attachment.afterTick();};
  const advance=seconds=>{for(let i=0;i<Math.round(seconds/CONFIG.fixedStep);i++)step();};
  const begin=()=>{const receiver=state.agents[1],action=attachment.hooks.optionalAction(receiver);assert.equal(action?.type,'inspect_object');const result=requestNpcAction(receiver,action,state.environment);attachment.hooks.performed(receiver,action,result,receiver.active);assert.equal(result.code,'ACTION_STARTED');return {receiver,sender:state.agents[0],action};};
  const indicate=sender=>{const action=attachment.hooks.optionalAction(sender);assert.equal(action?.type,'indicate_object');const result=attachment.hooks.performOptional(sender,action);assert.equal(result.code,'ACTION_STARTED');return action;};
  return {state,attachment,pixelSensor,step,advance,begin,indicate};
}
test('paid post-choice indication yields observation but absolutely no association update or bodily reward',()=>{
  const f=fixture(),{sender}=f.begin();
  assert.equal(f.attachment.snapshot().observationEvents[0].status,'choice');
  f.advance(2);assert.equal(f.attachment.snapshot().observationEvents[0].status,'awaiting-indication');
  f.indicate(sender);f.advance(2);
  const s=f.attachment.snapshot();assert.equal(s.observed,1);assert.equal(s.pending,0);assert.equal(s.updates,0);assert.deepEqual(s.learners,[]);assert.equal(s.positive,0);assert.equal(s.negative,0);assert.equal(s.observationEvents[0].reward,null);assert.ok(s.observationEvents[0].observedSeconds>=.5);
  assert.ok(Number.isInteger(s.observationEvents[0].selectedActionId));assert.ok(Number.isInteger(s.observationEvents[0].indicationActionId));
  assert.equal(typeof s.observationEvents[0].referenceCorrect,'boolean');
  f.advance(1);assert.equal(f.attachment.snapshot().observed,1,'terminal callbacks cannot duplicate observation');f.attachment.dispose();
});
test('interrupted listener choice cannot authorize any later indication',()=>{
  const f=fixture(),{receiver,sender}=f.begin();f.advance(.3);cancelNpcAction(receiver,'TEST_INTERRUPTION');f.step();
  assert.equal(f.attachment.snapshot().censored,1);assert.equal(f.attachment.snapshot().observed,0);assert.notEqual(f.attachment.hooks.optionalAction(sender)?.type,'indicate_object');f.attachment.dispose();
});
test('replacement actor with same ID cannot inherit pending reference authority',()=>{
  const f=fixture();f.begin();f.state.agents[1]=structuredClone(f.state.agents[1]);f.attachment.beforeTick();
  assert.equal(f.attachment.snapshot().pending,0);assert.equal(f.attachment.snapshot().censored,1);assert.equal(f.attachment.snapshot().updates,0);f.attachment.dispose();
});
test('priority decision and dispose censor instead of pretending failed language learning',()=>{
  const f=fixture(),{receiver}=f.begin();f.attachment.hooks.decision(receiver,{need:'water'});assert.equal(receiver.active,null);assert.equal(f.attachment.snapshot().censored,1);f.attachment.dispose();f.attachment.dispose();assert.equal(f.attachment.snapshot().censored,1);assert.equal(f.attachment.snapshot().negative,0);
});
test('ordinary body-care decision returns before the new optional action hook',()=>{
  const f=fixture(),n=f.state.agents[0];n.physiology.waterDeficitMl=2000;n.flask.water=100;let called=false;
  const decision=discoveryDecision(n,{optionalAction(){called=true;return {type:'indicate_object'};}});
  assert.equal(called,false);assert.equal(decision.need,'water');f.attachment.dispose();
});
test('main attaches only reference channel; historical bodily-credit experiment remains unchanged',async()=>{
  const main=await readFile(new URL('../src/ozark-world-main.js',import.meta.url),'utf8');assert.match(main,/attachVisualReferenceLearning/);assert.doesNotMatch(main,/attachCommunicationLearning/);
  const historical=await readFile(new URL('../src/communication-experiment.js',import.meta.url),'utf8');assert.match(historical,/attachCommunicationLearning/);
});

test('lost fresh sight near completion cannot reuse earlier paid observation',()=>{
  const f=fixture(),{sender}=f.begin();f.advance(2);f.indicate(sender);f.advance(1.4);
  assert.ok(f.attachment.snapshot().observationEvents[0].observedSeconds>=.5);
  f.pixelSensor.suppressed=true;f.advance(.5);
  const s=f.attachment.snapshot();assert.equal(s.observed,0);assert.equal(s.censored,1);assert.equal(s.updates,0);f.attachment.dispose();
});

test('one coarse paid tick cannot stand in for sustained visible indication',()=>{
  const f=fixture(),{sender}=f.begin();f.advance(2);f.indicate(sender);
  f.state.elapsed+=2;sender.elapsed+=2;tickDiscoveryAction(sender,2,f.state.environment);cancelNpcAction(sender,'COARSE_TEST_END');f.attachment.afterTick();
  const s=f.attachment.snapshot();assert.equal(s.observed,0);assert.equal(s.updates,0);assert.equal(s.censored,1);assert.ok(s.gates['observation:noncontiguous-step']>=1);f.attachment.dispose();
});

test('a sensor exception during paid indication retires only the reference channel',()=>{
  const f=fixture(),{sender}=f.begin();f.advance(2);f.indicate(sender);
  f.pixelSensor.capture=()=>{throw new Error('test observer failure');};
  assert.doesNotThrow(()=>f.step());assert.equal(sender.active,null);
  const s=f.attachment.snapshot();assert.equal(s.censored,1);assert.equal(s.observed,0);assert.equal(s.updates,0);f.attachment.dispose();
});

test('a missed sub-cap sample or partially unfunded interval breaks continuity',()=>{
  assert.equal(continuousReferenceStep(.1,.3,.1,.1),false,'missing .1s cannot be counted despite gap under .25');
  assert.equal(continuousReferenceStep(.1,.2,.05,.1),false,'partial funding does not certify whole interval');
  assert.equal(continuousReferenceStep(.1,.1,.1,.1),false,'duplicate sample');
  assert.equal(continuousReferenceStep(.1,.1+CONFIG.fixedStep,CONFIG.fixedStep,CONFIG.fixedStep),true);
  assert.equal(continuousReferenceStep(undefined,CONFIG.fixedStep,CONFIG.fixedStep,CONFIG.fixedStep),false,'first sample establishes baseline only');
  assert.equal(continuousReferenceStep(.1,.1+2*CONFIG.fixedStep,CONFIG.fixedStep,CONFIG.fixedStep),false,'one missing main step');
  assert.equal(continuousReferenceStep(1.8-CONFIG.fixedStep,1.8,.005,CONFIG.fixedStep),false,'no backdated sight for partially funded final step');
  assert.equal(continuousReferenceStep(1.8-CONFIG.fixedStep,1.8,CONFIG.fixedStep-1e-10,CONFIG.fixedStep),true,'floating residual only');
});

test('opposite actor iteration order still observes only post-choice paid fixed-step geometry',()=>{
  const f=fixture(211,{reverseTicks:true}),{sender}=f.begin();f.advance(2);f.indicate(sender);
  f.step();assert.equal(f.attachment.snapshot().observationEvents[0].observedSeconds,0,'first sample only');
  f.advance(2);const s=f.attachment.snapshot();assert.equal(s.observed,1);assert.equal(s.updates,0);f.attachment.dispose();
});
for(const [unseenSeconds,expected] of [[1.25,1],[1.3,0]])test(`trailing observation window after ${unseenSeconds}s unseen work respects first-sample baseline`,()=>{
  const f=fixture(),{sender}=f.begin();f.advance(2);f.indicate(sender);
  f.pixelSensor.suppressed=true;f.advance(unseenSeconds);f.pixelSensor.suppressed=false;f.advance(2-unseenSeconds);
  const s=f.attachment.snapshot();assert.equal(s.observed,expected);assert.equal(s.censored,1-expected);assert.equal(s.updates,0);f.attachment.dispose();
});
