import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {CONFIG} from '../src/config.js';
import {createOzarkState} from '../src/ozark-save.js';
import {createOzarkWorldGeometry} from '../src/ozark-world-geometry.js';
import {bindOzarkWorldAgent} from '../src/ozark-agent-world.js';
import {observeNpc,requestNpcAction,tickNpc,cancelNpcAction,collapseNpc,rescueNpc} from '../src/npc.js';
import {tickDiscoveryAction} from '../src/discovery-actions.js';
import {discoveryDecision} from '../src/discovery.js';
import {attachVisualReferenceLearning,continuousReferenceStep} from '../src/visual-reference-attachment.js';
import {senseReferenceObjects} from '../src/visual-reference-perception.js';
const geometry=createOzarkWorldGeometry();
function fixture(seed=211,{reverseTicks=false,differentViews=false}={}){
  const state=createOzarkState(geometry);
  for(const n of state.agents){bindOzarkWorldAgent(n,geometry,state);observeNpc(n,state.environment);}
  // Deliberately synthetic crops test transaction authority, not visual learning.
  const syntheticCategories=new Map(senseReferenceObjects(state.agents[0],state).bindings.map((id,i)=>[id,i%2]));
  const pixelSensor={suppressed:false,listenerOffset:0,capture(n){if(this.suppressed)return new Map();const s=senseReferenceObjects(n,state);return new Map(s.bindings.map((id,i)=>{const category=syntheticCategories.get(id)??i%2;const v=differentViews?(n===state.agents[0]?(category?.9:.1):(category?.7:.2)+this.listenerOffset):(i%2?.8:.1);return [id,{features:Array(48).fill(v),pixels:Array(768).fill(Math.round(v*255)),at:n.elapsed,epoch:n.epoch}];}));},dispose(){}};
  const attachment=attachVisualReferenceLearning({state,pixelSensor,seed});
  const step=()=>{attachment.beforeTick();state.elapsed+=CONFIG.fixedStep;for(const n of reverseTicks?state.agents.slice().reverse():state.agents)tickNpc(n,CONFIG.fixedStep,state.environment);attachment.afterTick();};
  const advance=seconds=>{for(let i=0;i<Math.round(seconds/CONFIG.fixedStep);i++)step();};
  const begin=()=>{const receiver=state.agents[1],action=attachment.hooks.optionalAction(receiver);assert.equal(action?.type,'inspect_object');const result=requestNpcAction(receiver,action,state.environment);attachment.hooks.performed(receiver,action,result,receiver.active);assert.equal(result.code,'ACTION_STARTED');return {receiver,sender:state.agents[0],action};};
  const indicate=sender=>{const action=attachment.hooks.optionalAction(sender);assert.equal(action?.type,'indicate_object');const result=attachment.hooks.performOptional(sender,action);assert.equal(result.code,'ACTION_STARTED');return action;};
  return {state,attachment,pixelSensor,step,advance,begin,indicate};
}
test('paid post-choice indication adds one own-view association and never bodily reward',()=>{
  const f=fixture(),{sender}=f.begin();
  assert.equal(f.attachment.snapshot().observationEvents[0].status,'choice');
  f.advance(2);assert.equal(f.attachment.snapshot().observationEvents[0].status,'awaiting-indication');
  f.indicate(sender);f.advance(2);
  const s=f.attachment.snapshot();assert.equal(s.observed,1);assert.equal(s.pending,0);assert.equal(s.updates,1);assert.equal(s.correctionAttempts,1);assert.equal(s.evidenceAdditions,1);assert.equal(s.learners.find(l=>l.agentId==='mira').counts.examples,1);assert.equal(s.positive,0);assert.equal(s.negative,0);assert.equal(s.observationEvents[0].reward,null);assert.ok(s.observationEvents[0].observedSeconds>=.5);
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
  f.advance(2);const s=f.attachment.snapshot();assert.equal(s.observed,1);assert.equal(s.updates,1);f.attachment.dispose();
});
for(const [unseenSeconds,expected] of [[1.25,1],[1.3,0]])test(`trailing observation window after ${unseenSeconds}s unseen work respects first-sample baseline`,()=>{
  const f=fixture(),{sender}=f.begin();f.advance(2);f.indicate(sender);
  f.pixelSensor.suppressed=true;f.advance(unseenSeconds);f.pixelSensor.suppressed=false;f.advance(2-unseenSeconds);
  const s=f.attachment.snapshot();assert.equal(s.observed,expected);assert.equal(s.censored,1-expected);assert.equal(s.updates,expected);f.attachment.dispose();
});


test('association memory survives real collapse rescue recovery but replacement retires partner meaning',()=>{
  const f=fixture(),{sender,receiver}=f.begin();f.advance(2);f.indicate(sender);f.advance(2);
  const before=f.attachment.snapshot().learners;
  assert.equal(before.find(l=>l.agentId===receiver.id).counts.examples,1);
  const discovery=sender.discovery,physiology=sender.physiology;
  collapseNpc(sender,'explicit test');f.attachment.beforeTick();
  assert.equal(sender.lifecycle,'COLLAPSED');
  assert.equal(rescueNpc(sender).ok,true);assert.equal(sender.lifecycle,'RECOVERING');
  for(let i=0;i<1200&&sender.lifecycle==='RECOVERING';i++)f.step();
  assert.equal(sender.lifecycle,'AWAKE');assert.equal(sender.discovery,discovery);assert.equal(sender.physiology,physiology);
  const after=f.attachment.snapshot().learners;
  assert.deepEqual(after,before,'Bodily epoch changes retain exactly the same private memories');
  sender.discovery=structuredClone(sender.discovery);f.attachment.beforeTick();
  const replaced=f.attachment.snapshot().learners;
  assert.notEqual(replaced.find(l=>l.agentId===sender.id).identity,before.find(l=>l.agentId===sender.id).identity);
  assert.equal(replaced.find(l=>l.agentId===sender.id).counts.anchors,0);
  assert.equal(replaced.find(l=>l.agentId===receiver.id).counts.examples,0,'Old sender token cannot bind reused textual name');
  f.attachment.dispose();
});

test('copied inspector state cannot alter exemplars; new attachment begins with no inherited memory',()=>{
  const f=fixture(),{sender}=f.begin();f.advance(2);f.indicate(sender);f.advance(2);
  const original=f.attachment.snapshot();const copy=f.attachment.snapshot();
  copy.learners[0].anchors[0].features.fill(.777);copy.learners[1].partners.length=0;
  assert.deepEqual(f.attachment.snapshot(),original);
  f.attachment.dispose();
  const fresh=attachVisualReferenceLearning({state:f.state,pixelSensor:f.pixelSensor,seed:211});
  assert.equal(fresh.snapshot().learners.every(l=>l.counts.anchors===0&&l.counts.examples===0),true);
  assert.equal(fresh.snapshot().updates,0);fresh.dispose();
});


test('wrong initial choice learns only listener demonstration features, retrieves later, and consumes no-op corrections once',()=>{
  // This declared seed exercises the incorrect-choice unit-test branch, not a
  // selected autonomous outcome or a learning-performance measurement.
  const f=fixture(8192,{differentViews:true}),first=f.begin(),oldChoice=first.receiver.active;
  const selectedCrop=f.pixelSensor.capture(first.receiver).get(first.action.targetId).features.slice();
  f.advance(2);f.pixelSensor.listenerOffset=.01;
  const oldIndication=f.indicate(first.sender);f.advance(2);
  let s=f.attachment.snapshot(),event=s.observationEvents[0];
  assert.equal(event.referenceCorrect,false,'Fixture must test corrective rather than selected-object association');
  const demonstrated=f.pixelSensor.capture(first.receiver).get(event.demonstratedObjectId).features;
  const senderFeatures=f.pixelSensor.capture(first.sender).get(event.demonstratedObjectId).features;
  const entry=s.learners.find(l=>l.agentId===first.receiver.id).partners[0].entries[0];
  assert.deepEqual(entry.examples[0],demonstrated);
  assert.notDeepEqual(entry.examples[0],senderFeatures);assert.notDeepEqual(entry.examples[0],selectedCrop);
  const unchanged=()=>({corrections:f.attachment.snapshot().correctionAttempts,adds:f.attachment.snapshot().evidenceAdditions,support:f.attachment.snapshot().supportUpdates});
  let counts=unchanged();f.attachment.hooks.performed(first.receiver,first.action,{code:'ACTION_STARTED'},oldChoice);
  assert.equal(f.attachment.hooks.performOptional(first.sender,oldIndication),null);
  f.attachment.afterTick();f.attachment.afterTick();assert.deepEqual(unchanged(),counts);
  let supportSeen=false,matchedSeen=false;
  for(let attempt=0;attempt<4&&!supportSeen;attempt++){
    f.advance(12);const next=f.begin();const before=f.attachment.snapshot().latest;
    if(before.choiceMode==='association-match')matchedSeen=true;
    f.advance(2);const indication=f.indicate(next.sender);f.advance(2);
    s=f.attachment.snapshot();supportSeen=s.supportUpdates>0;
    if(supportSeen){assert.equal(s.latest.correction,'support');counts=unchanged();f.attachment.hooks.performOptional(next.sender,indication);f.attachment.afterTick();assert.deepEqual(unchanged(),counts);}
  }
  assert.equal(matchedSeen,true,'Existing learned own-view symbol must drive a later actual action');
  assert.equal(supportSeen,true,'Repeated own demonstration adds support without another exemplar');
  assert.equal(f.attachment.snapshot().evidenceAdditions<=2,true);f.attachment.dispose();
});

for(const replacement of ['actor','physiology'])test(`${replacement} replacement retires private anchors and partner bindings despite same text ID`,()=>{
  const f=fixture(),{sender,receiver}=f.begin();f.advance(2);f.indicate(sender);f.advance(2);
  const before=f.attachment.snapshot().learners,oldIdentity=before.find(l=>l.agentId===sender.id).identity;
  assert.equal(before.find(l=>l.agentId===receiver.id).counts.examples,1);
  if(replacement==='actor')f.state.agents[0]=structuredClone(sender);
  else sender.physiology=structuredClone(sender.physiology);
  f.attachment.beforeTick();const after=f.attachment.snapshot().learners;
  assert.notEqual(after.find(l=>l.agentId===sender.id).identity,oldIdentity);
  assert.equal(after.find(l=>l.agentId===sender.id).counts.anchors,0);
  assert.equal(after.find(l=>l.agentId===receiver.id).counts.examples,0);
  f.attachment.dispose();
});

test('QA current-view audit is one-use, pure, target-free and cannot change the next real RNG-dependent choice',()=>{
  const audited=fixture(),control=fixture(),read=audited.attachment.createNativeAssociationAuditReader();
  assert.equal(audited.attachment.createNativeAssociationAuditReader(),null);
  for(const f of [audited,control]){const {sender}=f.begin();f.advance(2);f.indicate(sender);f.advance(2);}
  const before=audited.attachment.snapshot(),world=structuredClone(audited.state),proof=read();
  assert.equal(proof.viewSource,'fresh-listener-current-canvas');assert.equal(proof.at,audited.state.agents[1].elapsed);
  assert.equal(proof.candidateViews.every(c=>c.at===proof.at),true);
  assert.equal(proof.known.reason,'unique-match');assert.equal(proof.reversed.index,1-proof.known.index);
  assert.equal(proof.absent.choice.index,null);assert.equal(proof.absent.choice.reason,'unknown-symbol');
  assert.equal('targetId' in proof,false);assert.equal('referenceCorrect' in proof,false);
  assert.deepEqual(audited.attachment.snapshot(),before);assert.deepEqual(audited.state,world);
  assert.equal(read(),null);assert.deepEqual(audited.attachment.snapshot(),control.attachment.snapshot());
  for(const f of [audited,control])f.advance(12);
  const a=audited.begin(),b=control.begin();assert.deepEqual(a.action,b.action);
  assert.deepEqual(audited.attachment.snapshot(),control.attachment.snapshot(),'Reading controls cannot consume policy RNG or support counts');
  audited.attachment.dispose();control.attachment.dispose();
});

test('QA audit consumes unavailable attempt and never falls back to saved or occluded views',()=>{
  const f=fixture(),read=f.attachment.createNativeAssociationAuditReader();assert.equal(read(),null);
  const {sender}=f.begin();f.advance(2);f.indicate(sender);f.advance(2);assert.equal(read(),null);f.attachment.dispose();
  const g=fixture(),reader=g.attachment.createNativeAssociationAuditReader(),started=g.begin();g.advance(2);g.indicate(started.sender);g.advance(2);
  g.pixelSensor.suppressed=true;const before=g.attachment.snapshot();assert.equal(reader(),null);
  g.pixelSensor.suppressed=false;assert.equal(reader(),null);assert.deepEqual(g.attachment.snapshot(),before);g.attachment.dispose();
});
