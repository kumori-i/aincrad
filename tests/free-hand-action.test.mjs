import test from 'node:test';
import assert from 'node:assert/strict';
import {createOzarkState,writeOzarkSave,loadOzarkSave} from '../src/ozark-save.js';
import {createOzarkWorldGeometry} from '../src/ozark-world-geometry.js';
import {bindOzarkWorldAgent} from '../src/ozark-agent-world.js';
import {requestNpcAction,tickNpc,observeNpc,cancelNpcAction} from '../src/npc.js';
import {NpcController} from '../src/controller.js';
import {discoveryDecision} from '../src/discovery.js';
import {cognitiveAction} from '../src/cognition.js';
import {observeIndication} from '../src/visual-reference-perception.js';
import {publicIndicationGeometry} from '../src/discovery-actions.js';
import {npcEffortCost,npcWorkAllowance} from '../src/npc-effort-funding.js';
import {exertPhysiology} from '../src/biology.js';
import {bodySignals} from '../src/interoception.js';
import {FREE_HAND_RULES,initializeFreeHandSession,
  freeHandBodySafe,freeHandExplorationChoice,tickFreeHandAction,
  ownFreeHandAction,publicFreeHandGeometry,freeHandPaidSeconds,requestFreeHandAction,
  readFreeHandObserver} from '../src/free-hand-action.js';

const geometry=createOzarkWorldGeometry();
const near=(actual,expected,label)=>assert.ok(Math.abs(actual-expected)<1e-8,
  `${label}: ${actual} versus ${expected}`);
const emptyLifecycle=()=>({admitted:0,firstPaid:0,certifiedPaidSeconds:0,
  completed:0,rejectedAfterSelection:{ACTION_BUSY:0,PRIORITY_CHANGED:0},
  interrupted:{PRIORITY_CHANGED:0,ACTION_TIMEOUT:0,CONTACT_ESCAPE:0,
    REFERENCE_INTERRUPTED:0,OTHER:0},unavailable:0,ownPoseSamples:0,pending:0});
function fixture(){
  const state=createOzarkState(geometry,{communicationSeed:211});
  for(const npc of state.agents){
    bindOzarkWorldAgent(npc,geometry,state);
    observeNpc(npc,state.environment);
    initializeFreeHandSession(npc);
  }
  const [actor,peer]=state.agents;
  const ready=()=>{actor.elapsed=120;assert.ok(freeHandExplorationChoice(actor));};
  const advance=(seconds,who=actor)=>{for(let i=0;i<Math.round(seconds/.1);i++)
    tickNpc(who,.1,state.environment);};
  return {state,actor,peer,ready,advance};
}

test('fresh delay and attempted-admission budget are actor-local, bounded and independent of RNG',()=>{
  const f=fixture(),other=f.peer,initial=f.actor.rng,peerBefore=readFreeHandObserver(other);
  assert.equal(freeHandExplorationChoice(f.actor),null);
  f.actor.elapsed=119.99;
  assert.equal(freeHandExplorationChoice(f.actor),null);
  f.ready();
  assert.equal(f.actor.rng,initial);
  const first=freeHandExplorationChoice(f.actor);
  assert.deepEqual(first.action,{type:'free_hand'});
  assert.equal(first.score,FREE_HAND_RULES.curiosityScore);
  const before=readFreeHandObserver(f.actor);
  assert.equal(before.eligibleDecisions,2);
  assert.equal(before.decisionChecks,4,'Every persistent-actor choice check is counted');
  assert.deepEqual(before.sampleCounts,{unknown:0,absent:0,pose:0});
  assert.equal(before.sessionResets,0);
  assert.equal(before.saturated,false);
  assert.equal(requestNpcAction(f.actor,{type:'free_hand'},f.state.environment).code,'ACTION_STARTED');
  assert.equal(readFreeHandObserver(f.actor).selectedAttempts,1);
  assert.deepEqual(readFreeHandObserver(f.actor).lifecycle,
    {...emptyLifecycle(),admitted:1,pending:1});
  cancelNpcAction(f.actor,'PRIORITY_CHANGED');
  assert.deepEqual(readFreeHandObserver(f.actor).lifecycle,
    {...emptyLifecycle(),admitted:1,interrupted:{...emptyLifecycle().interrupted,PRIORITY_CHANGED:1}});
  assert.equal(freeHandExplorationChoice(f.actor),null);
  f.actor.elapsed=239.99;assert.equal(freeHandExplorationChoice(f.actor),null);
  f.actor.elapsed=240;
  assert.equal(freeHandExplorationChoice(f.actor).score,FREE_HAND_RULES.curiosityScore/2);
  const continuing=readFreeHandObserver(f.actor);
  initializeFreeHandSession(f.actor);
  assert.deepEqual(readFreeHandObserver(f.actor),continuing,
    'Reattaching a controller to the same individual cannot shorten its cooldown');
  f.actor.epoch++;
  initializeFreeHandSession(f.actor);
  assert.deepEqual(readFreeHandObserver(f.actor),{decisionChecks:0,eligibleDecisions:0,
    selectedAttempts:0,visibleSamples:0,sampleCounts:{unknown:0,absent:0,pose:0},
    lifecycle:emptyLifecycle(),
    sessionResets:1,saturated:false,nextEligibleAt:360});
  assert.equal(freeHandExplorationChoice(f.actor),null,'A new incarnation starts another full delay');
  f.actor.elapsed=360;assert.ok(freeHandExplorationChoice(f.actor));
  f.actor.epoch++;initializeFreeHandSession(f.actor);
  assert.equal(readFreeHandObserver(f.actor).sessionResets,2,
    'A second live incarnation reset is visible without durable state');
  assert.equal(readFreeHandObserver(f.actor).nextEligibleAt,480);
  assert.deepEqual(readFreeHandObserver(other),peerBefore,'Partner does not inherit rate state');
  assert.equal(f.actor.rng,initial,'Motor eligibility and selection draw no RNG');
});

test('target-free admission rejects object bindings and spends a due attempt on urgent rejection',()=>{
  const f=fixture();f.ready();
  assert.equal(cognitiveAction(f.actor,{type:'free_hand',targetId:'object:501'}),null);
  assert.equal(requestNpcAction(f.actor,{type:'free_hand',targetId:'object:501'},f.state.environment).code,
    'INVALID_FREE_HAND');
  assert.equal(readFreeHandObserver(f.actor).selectedAttempts,0);
  f.actor.physiology.waterDeficitMl=4000;
  assert.equal(freeHandBodySafe(f.actor),false);
  const checks=readFreeHandObserver(f.actor).decisionChecks;
  assert.equal(freeHandExplorationChoice(f.actor),null);
  assert.equal(readFreeHandObserver(f.actor).decisionChecks,checks+1,
    'An urgent body can reject an exact decision-boundary check');
  assert.equal(requestNpcAction(f.actor,{type:'free_hand'},f.state.environment).code,'PRIORITY_CHANGED');
  assert.equal(readFreeHandObserver(f.actor).selectedAttempts,1);
  assert.deepEqual(readFreeHandObserver(f.actor).lifecycle,
    {...emptyLifecycle(),rejectedAfterSelection:{ACTION_BUSY:0,PRIORITY_CHANGED:1}});
  f.actor.physiology.waterDeficitMl=250;
  assert.equal(requestNpcAction(f.actor,{type:'free_hand'},f.state.environment).code,'FREE_HAND_COOLDOWN');
  assert.equal(f.actor.active,null);
});

test('a selected busy actor has a counted rejection but no admitted or paid motion',()=>{
  const f=fixture();f.ready();
  const busy={kind:'wait',request:{type:'wait',seconds:1}};
  f.actor.active=busy;
  assert.deepEqual(requestFreeHandAction(f.actor,{type:'free_hand'}),
    {ok:false,code:'ACTION_BUSY'});
  assert.equal(f.actor.active,busy);
  assert.deepEqual(readFreeHandObserver(f.actor).lifecycle,
    {...emptyLifecycle(),rejectedAfterSelection:{ACTION_BUSY:1,PRIORITY_CHANGED:0}});
  assert.equal(readFreeHandObserver(f.actor).selectedAttempts,1);
});

test('personally sensed flowing current withholds the optional motion and a stale admission spends its budget',()=>{
  const f=fixture();f.actor.position={x:-1200,y:240};f.actor.elapsed=120;
  const local=geometry.observe(f.actor.position);
  assert.equal(local.ground,'shallow-water');
  assert.equal(local.currentCue,'downstream','Only the existing actor-local qualitative cue is used');
  const before=JSON.stringify(f.state),rng=f.actor.rng;
  for(let i=0;i<3;i++)assert.equal(freeHandExplorationChoice(f.actor),null);
  assert.equal(JSON.stringify(f.state),before,'Current-footing checks cannot modify durable state');
  assert.equal(f.actor.rng,rng,'Current-footing checks do not select through RNG');
  assert.deepEqual(readFreeHandObserver(f.actor),{decisionChecks:3,eligibleDecisions:0,
    selectedAttempts:0,visibleSamples:0,sampleCounts:{unknown:0,absent:0,pose:0},
    lifecycle:emptyLifecycle(),sessionResets:0,saturated:false,nextEligibleAt:120});
  f.actor.position={x:276,y:760};
  const staleCandidate=freeHandExplorationChoice(f.actor);
  assert.deepEqual(staleCandidate?.action,{type:'free_hand'});
  f.actor.position={x:-1200,y:240};
  const rejected=requestNpcAction(f.actor,staleCandidate.action,f.state.environment);
  assert.deepEqual(rejected,{ok:false,code:'PRIORITY_CHANGED'},
    'A copied or stale command cannot bypass fresh local footing at admission');
  assert.equal(JSON.stringify(f.state),before);
  assert.equal(f.actor.rng,rng);
  assert.equal(f.actor.active,null);
  assert.equal(publicFreeHandGeometry(f.actor),null);
  assert.equal(readFreeHandObserver(f.actor).selectedAttempts,1);
  assert.deepEqual(readFreeHandObserver(f.actor).lifecycle,
    {...emptyLifecycle(),rejectedAfterSelection:{ACTION_BUSY:0,PRIORITY_CHANGED:1}});
  f.actor.position={x:276,y:760};f.actor.elapsed=239.99;
  assert.equal(freeHandExplorationChoice(f.actor),null,
    'Rejected attempted admission cannot reset its 120-second rate budget');
  f.actor.elapsed=240;
  assert.equal(freeHandExplorationChoice(f.actor)?.action.type,'free_hand');
});

test('ordinary controller tick pays on dry ground but a newly unsafe body still preempts before payment',()=>{
  for(const boundary of ['dry','thirst-threshold']){
    const f=fixture();f.actor.elapsed=120;
    if(boundary==='thirst-threshold')f.actor.physiology.waterDeficitMl=1749.995;
    const controller=new NpcController(f.actor,{environment:f.state.environment,
      deferInitialObservation:true}),position={...f.actor.position},epoch=f.actor.epoch,
      discovery=f.actor.discovery,physiology=f.actor.physiology;
    assert.equal(freeHandBodySafe(f.actor),true);
    if(boundary==='thirst-threshold')assert.equal(bodySignals(f.actor).thirst,'thirsty');
    assert.equal(controller.perform({type:'free_hand'}).code,'ACTION_STARTED');
    const active=f.actor.active;
    controller.tick(1/60);
    assert.deepEqual(f.actor.position,position);
    assert.equal(f.actor.epoch,epoch);
    assert.equal(f.actor.discovery,discovery);
    assert.equal(f.actor.physiology,physiology);
    const life=readFreeHandObserver(f.actor).lifecycle;
    if(boundary==='dry'){
      assert.equal(f.actor.active,active);
      assert.equal(life.firstPaid,1);
      near(life.certifiedPaidSeconds,1/60,'Dry ground first funded controller slice');
      assert.equal(life.interrupted.PRIORITY_CHANGED,0);
    }else{
      assert.equal(bodySignals(f.actor).thirst,'parched');
      assert.equal(freeHandBodySafe(f.actor),false);
      assert.equal(f.actor.active,null);
      assert.equal(f.actor.lastResult.code,'PRIORITY_CHANGED');
      assert.equal(life.firstPaid,0);
      assert.equal(life.certifiedPaidSeconds,0);
      assert.equal(life.interrupted.PRIORITY_CHANGED,1);
    }
    controller.dispose();
  }
});

test('observer checks do not initialize a motor cooldown before an unsafe actor becomes safe',()=>{
  const state=createOzarkState(geometry,{communicationSeed:211}),actor=state.agents[0];
  bindOzarkWorldAgent(actor,geometry,state);observeNpc(actor,state.environment);
  actor.elapsed=120;actor.physiology.waterDeficitMl=4000;
  const rng=actor.rng;
  assert.equal(freeHandExplorationChoice(actor),null);
  assert.deepEqual(readFreeHandObserver(actor),{decisionChecks:1,eligibleDecisions:0,
    selectedAttempts:0,visibleSamples:0,sampleCounts:{unknown:0,absent:0,pose:0},
    lifecycle:emptyLifecycle(),
    sessionResets:0,saturated:false,nextEligibleAt:null});
  actor.physiology.waterDeficitMl=250;actor.elapsed=130;
  assert.equal(freeHandExplorationChoice(actor),null,
    'The first safe check starts the original 120-second motor delay');
  assert.equal(readFreeHandObserver(actor).nextEligibleAt,250);
  assert.equal(readFreeHandObserver(actor).decisionChecks,2);
  actor.elapsed=250;
  assert.equal(freeHandExplorationChoice(actor)?.action.type,'free_hand');
  assert.equal(actor.rng,rng);
});

test('real funded action has exact duration, effort debit and no ecology object trial',()=>{
  const f=fixture();f.ready();
  const beforeEnergy=f.actor.physiology.availableEnergyKcal;
  const beforeMetabolized=f.actor.physiology.totals.metabolizedKcal;
  const beforeExperiments=f.actor.discovery.experiments.length;
  const beforeValues=structuredClone(f.actor.memory.values);
  const charged=[];
  assert.equal(requestNpcAction(f.actor,{type:'free_hand'},f.state.environment).code,'ACTION_STARTED');
  assert.deepEqual(readFreeHandObserver(f.actor).lifecycle,
    {...emptyLifecycle(),admitted:1,pending:1});
  const active=f.actor.active;
  near(active.seconds,1.8,'Fixed paid duration');
  near(active.expiresAt-active.startedAt,npcWorkAllowance(1.8,.25),'Fixed work deadline');
  assert.equal(ownFreeHandAction(f.actor),true);
  assert.equal(publicFreeHandGeometry(f.actor),null,'Unpaid intent is not a public pose');
  tickFreeHandAction(f.actor,1.8,{exert(n,seconds,effort){
    charged.push({seconds,effort});exertPhysiology(n,seconds,effort);
  },complete(n,request,result){n.lastResult=result;n.active=null;}});
  assert.deepEqual(charged,[{seconds:1.8,effort:.25}]);
  assert.equal(f.actor.lastResult.code,'FREE_HAND_MOVED');
  near(f.actor.lastResult.durationSeconds,1.8,'Certified paid work');
  near(beforeEnergy-f.actor.physiology.availableEnergyKcal,npcEffortCost(1.8,.25),
    'Actual available-energy debit');
  near(f.actor.physiology.totals.metabolizedKcal-beforeMetabolized,npcEffortCost(1.8,.25),
    'Actual recorded metabolism');
  assert.equal(f.actor.discovery.experiments.length,beforeExperiments);
  assert.deepEqual(f.actor.memory.values,beforeValues);
  assert.equal(publicIndicationGeometry(f.actor),null);
  assert.equal(publicFreeHandGeometry(f.actor),null);
  assert.equal(ownFreeHandAction(f.actor),false);
  assert.equal(freeHandPaidSeconds(f.actor,active),1.8);
  assert.deepEqual(readFreeHandObserver(f.actor).lifecycle,
    {...emptyLifecycle(),admitted:1,firstPaid:1,certifiedPaidSeconds:1.8,completed:1});
});

test('ordinary ticks render only funded motion and never resolve it as an object pointer',()=>{
  const f=fixture();f.ready();
  assert.equal(requestNpcAction(f.actor,{type:'free_hand'},f.state.environment).code,'ACTION_STARTED');
  const active=f.actor.active;
  f.advance(.1);
  assert.equal(readFreeHandObserver(f.actor).lifecycle.firstPaid,1);
  near(readFreeHandObserver(f.actor).lifecycle.certifiedPaidSeconds,.1,'First certified slice');
  const pose=publicFreeHandGeometry(f.actor);
  assert.ok(pose);
  near(pose.progress,.1/1.8,'Paid pose progress');
  near(Math.hypot(pose.tip.x-pose.origin.x,pose.tip.y-pose.origin.y),24,'Public segment');
  assert.equal(Object.isFrozen(pose)&&Object.isFrozen(pose.origin)&&Object.isFrozen(pose.tip),true);
  assert.equal(publicIndicationGeometry(f.actor),null);
  assert.equal(observeIndication(f.peer,f.actor,f.state).reason,'invalid-gesture');
  f.advance(1.7);
  assert.equal(f.actor.lastResult.code,'FREE_HAND_MOVED');
  near(f.actor.lastResult.durationSeconds,1.8,'Ordinary completion paid time');
  assert.equal(f.actor.active,null);
  assert.equal(publicFreeHandGeometry(f.actor),null);
  assert.equal(f.actor.discovery.experiments.length,0);
  assert.equal(f.actor.discovery.practice.free_hand,undefined);
  assert.equal(readFreeHandObserver(f.actor).lifecycle.completed,1);
  near(readFreeHandObserver(f.actor).lifecycle.certifiedPaidSeconds,1.8,
    'Ordinary tick observer counts only certified work');
  assert.equal(Object.keys(f.actor.discovery.trials).some(key=>key.endsWith('|free_hand')),false);
  assert.equal(f.actor.memory.experience.some(e=>e.details?.action?.type==='free_hand'&&
    e.details?.result?.ok===true),true);
  f.actor.active=structuredClone(active);
  f.advance(.1);
  assert.equal(f.actor.active,null,'A copied completed command cannot resume');
  assert.equal(readFreeHandObserver(f.actor).lifecycle.completed,1,
    'Replayed command cannot duplicate authentic completion');
});

test('partial work, urgent care, actor drift and identity replacement cancel without free completion',()=>{
  for(const boundary of ['urgent','drift','epoch','physiology','discovery']){
    const f=fixture();f.ready();
    assert.equal(requestNpcAction(f.actor,{type:'free_hand'},f.state.environment).code,'ACTION_STARTED');
    f.advance(.2);
    const active=f.actor.active,paid=freeHandPaidSeconds(f.actor,active);
    assert.ok(paid>0&&publicFreeHandGeometry(f.actor));
    assert.equal(readFreeHandObserver(f.actor).lifecycle.firstPaid,1);
    near(readFreeHandObserver(f.actor).lifecycle.certifiedPaidSeconds,paid,
      `${boundary} certified work before cancellation`);
    if(boundary==='urgent')f.actor.physiology.waterDeficitMl=4000;
    if(boundary==='drift')f.actor.position.x+=1;
    if(boundary==='epoch')f.actor.epoch++;
    if(boundary==='physiology')f.actor.physiology=structuredClone(f.actor.physiology);
    if(boundary==='discovery')f.actor.discovery=structuredClone(f.actor.discovery);
    if(boundary!=='urgent')assert.equal(publicFreeHandGeometry(f.actor),null,
      `${boundary} cannot keep an authenticated public pose`);
    f.advance(.1);
    assert.equal(f.actor.active,null);
    if(['epoch','physiology','discovery'].includes(boundary)){
      assert.equal(f.actor.lastResult,null,
        `${boundary} replacement cannot inherit the old actor's action receipt`);
    }else{
      assert.notEqual(f.actor.lastResult.code,'FREE_HAND_MOVED');
      near(f.actor.lastResult.durationSeconds,paid,`${boundary} preserves previously paid work`);
    }
    assert.equal(publicFreeHandGeometry(f.actor),null);
    const lifecycle=readFreeHandObserver(f.actor).lifecycle;
    assert.equal(lifecycle.completed,0,`${boundary} is never a completion`);
    assert.equal(lifecycle.pending,0,`${boundary} retires pending observer authority`);
    if(boundary==='urgent'||boundary==='drift')
      assert.equal(lifecycle.interrupted.PRIORITY_CHANGED,1,
        `${boundary} has one authentic interruption`);
  }
});

test('unfunded slices cannot fabricate pose, and timeout retains zero paid seconds',()=>{
  const f=fixture();f.ready();
  requestNpcAction(f.actor,{type:'free_hand'},f.state.environment);
  const active=f.actor.active;
  for(let i=0;i<24;i++){
    f.actor.elapsed+=.25;
    tickFreeHandAction(f.actor,.25,{exert(){},complete(n,request,result){n.lastResult=result;n.active=null;}});
    assert.equal(publicFreeHandGeometry(f.actor),null);
  }
  assert.equal(f.actor.lastResult.code,'ACTION_TIMEOUT');
  assert.equal(f.actor.lastResult.durationSeconds,0);
  assert.equal(freeHandPaidSeconds(f.actor,active),0);
  assert.deepEqual(readFreeHandObserver(f.actor).lifecycle,
    {...emptyLifecycle(),admitted:1,
      interrupted:{...emptyLifecycle().interrupted,ACTION_TIMEOUT:1}});
});

test('copied, interrupted and disposed action objects cannot grant fresh physical work',()=>{
  const f=fixture();f.ready();requestNpcAction(f.actor,{type:'free_hand'},f.state.environment);
  f.advance(.1);
  const original=f.actor.active,copy=structuredClone(original);
  f.actor.active=copy;
  assert.equal(ownFreeHandAction(f.actor),false);
  assert.equal(publicFreeHandGeometry(f.actor),null);
  f.advance(.1);
  assert.equal(f.actor.active,null);
  assert.equal(readFreeHandObserver(f.actor).lifecycle.unavailable,1,
    'A copied active object loses the private witness without a fabricated interruption');
  f.actor.active=original;
  f.advance(.1);
  assert.equal(f.actor.active,null,'Old work cannot revive after copied action was ticked');
  assert.equal(readFreeHandObserver(f.actor).lifecycle.unavailable,1,
    'Revival cannot duplicate the unavailable witness');

  const g=fixture();g.ready();requestNpcAction(g.actor,{type:'free_hand'},g.state.environment);
  g.advance(.1);
  const controller=new NpcController(g.actor,{environment:g.state.environment,deferInitialObservation:true});
  // Constructor starts a fresh policy session; disposal must also retire live authority.
  controller.dispose();
  assert.equal(g.actor.active,null);
  assert.equal(publicFreeHandGeometry(g.actor),null);
  assert.equal(g.actor.lastResult.code,'PRIORITY_CHANGED');
  assert.deepEqual(readFreeHandObserver(g.actor),
    {decisionChecks:0,eligibleDecisions:0,selectedAttempts:0,visibleSamples:0,
      sampleCounts:{unknown:0,absent:0,pose:0},lifecycle:emptyLifecycle(),
      sessionResets:0,saturated:false,
      nextEligibleAt:null});
});

test('reentrant exert detachment or replacement retires old authority without crediting its unreturned slice',()=>{
  for(const replace of [false,true]){
    const f=fixture();f.ready();
    assert.equal(requestNpcAction(f.actor,{type:'free_hand'},f.state.environment).code,'ACTION_STARTED');
    const original=f.actor.active;
    const before=f.actor.physiology.availableEnergyKcal;
    tickFreeHandAction(f.actor,.1,{exert:exertPhysiology});
    near(freeHandPaidSeconds(f.actor,original),.1,'First returned slice is certified');
    const replacement=replace?{kind:'wait',request:{type:'wait',seconds:1},
      startedAt:f.actor.elapsed,expiresAt:f.actor.elapsed+1}:null;
    tickFreeHandAction(f.actor,.1,{exert(n,seconds,effort){
      assert.equal(effort,.25);
      n.active=replacement;
      exertPhysiology(n,seconds,effort);
    }});
    assert.equal(f.actor.active,replacement,
      'The stale motor completion cannot overwrite another active action');
    near(before-f.actor.physiology.availableEnergyKcal,npcEffortCost(.2,.25),
      'Both physically charged slices remain paid');
    near(freeHandPaidSeconds(f.actor,original),.1,
      'The unreturned reentrant slice is never certified as motor work');
    assert.equal(original.worked,.1);
    assert.equal(publicFreeHandGeometry(f.actor),null);
    assert.equal(ownFreeHandAction(f.actor),false);
    f.actor.active=original;
    tickFreeHandAction(f.actor,.1,{exert:exertPhysiology});
    assert.equal(f.actor.active,null,'Reattaching retired private authority cannot resume');
    near(freeHandPaidSeconds(f.actor,original),.1,
      'Revival attempt cannot charge or certify another slice');
    assert.equal(f.actor.lastResult,null,'No completion receipt is fabricated');
    const lifecycle=readFreeHandObserver(f.actor).lifecycle;
    assert.equal(lifecycle.unavailable,1,'Reentrant replacement loses one observer witness');
    assert.equal(lifecycle.completed,0);
    near(lifecycle.certifiedPaidSeconds,.1,'Reentrant unreturned work is not certified');
  }
});

test('cancelling a copied free-hand command fabricates no action receipt and retires the original',()=>{
  const f=fixture();f.ready();
  requestNpcAction(f.actor,{type:'free_hand'},f.state.environment);
  f.advance(.1);
  const original=f.actor.active,certified=freeHandPaidSeconds(f.actor,original);
  const beforeEvents=f.actor.memory.experience.length,beforeResult=f.actor.lastResult;
  f.actor.active=structuredClone(original);
  assert.equal(cancelNpcAction(f.actor,'PRIORITY_CHANGED'),true);
  assert.equal(f.actor.active,null);
  assert.equal(f.actor.memory.experience.length,beforeEvents,
    'A copied command cannot acquire an interruption receipt');
  assert.equal(f.actor.lastResult,beforeResult);
  f.actor.active=original;
  f.advance(.1);
  assert.equal(f.actor.active,null,'Original authority was retired with the copied command');
  assert.equal(f.actor.memory.experience.length,beforeEvents);
  near(freeHandPaidSeconds(f.actor,original),certified,
    'No later slice can be certified through the retired original');
  assert.equal(readFreeHandObserver(f.actor).lifecycle.unavailable,1);
});

test('disposal after legitimate drift or urgent care records previously paid work exactly once',()=>{
  for(const boundary of ['drift','urgent']){
    const f=fixture();
    const controller=new NpcController(f.actor,{environment:f.state.environment,
      deferInitialObservation:true});
    f.ready();
    requestNpcAction(f.actor,{type:'free_hand'},f.state.environment);
    f.advance(.2);
    const active=f.actor.active,paid=freeHandPaidSeconds(f.actor,active);
    const events=f.actor.memory.experience.length;
    if(boundary==='drift')f.actor.position.x+=1;
    else f.actor.physiology.waterDeficitMl=4000;
    controller.dispose();
    assert.equal(f.actor.active,null);
    assert.equal(publicFreeHandGeometry(f.actor),null);
    assert.equal(f.actor.lastResult.code,'PRIORITY_CHANGED');
    near(f.actor.lastResult.durationSeconds,paid,`${boundary} retains paid seconds`);
    assert.equal(f.actor.memory.experience.length,events+1);
    assert.equal(f.actor.memory.experience.at(-1).details.action.type,'free_hand');
    controller.dispose();
    assert.equal(f.actor.memory.experience.length,events+1,
      'Repeated disposal cannot duplicate the paid interruption');
  }
});

test('pending paid motion saves no authority and reopening resets only its session clock',()=>{
  const f=fixture();f.ready();requestNpcAction(f.actor,{type:'free_hand'},f.state.environment);
  f.advance(.2);
  assert.ok(publicFreeHandGeometry(f.actor));
  f.state.elapsed=Math.max(...f.state.agents.map(n=>n.elapsed));
  f.peer.elapsed=f.state.elapsed;
  f.state.environment.elapsed=f.state.elapsed;
  f.state.environment.ecology.elapsed=f.state.elapsed;
  const values=new Map(),storage={getItem:key=>values.get(key)??null,
    setItem:(key,value)=>values.set(key,value)};
  assert.equal(writeOzarkSave(storage,f.state,geometry),true);
  const reopened=loadOzarkSave(storage,geometry);
  assert.equal(reopened.blocked,false);
  const restored=reopened.state.agents[0];
  bindOzarkWorldAgent(restored,geometry,reopened.state);
  new NpcController(restored,{environment:reopened.state.environment,deferInitialObservation:true});
  assert.equal(restored.active,null);
  assert.equal(publicFreeHandGeometry(restored),null);
  assert.equal(ownFreeHandAction(restored),false);
  assert.equal(freeHandExplorationChoice(restored),null);
  restored.elapsed+=120;
  assert.ok(freeHandExplorationChoice(restored),'Reopened actor waits another 120 simulation seconds');
  assert.equal(readFreeHandObserver(restored).selectedAttempts,0);
  assert.deepEqual(readFreeHandObserver(restored).lifecycle,emptyLifecycle(),
    'Reopen cannot restore paid authority or session-only lifecycle counts');
});

test('optional exploration sees free hand only after care and reference choices',()=>{
  const f=fixture();
  const initial=JSON.stringify(f.state),rng=f.actor.rng;
  for(let i=0;i<3;i++)assert.equal(freeHandExplorationChoice(f.actor),null);
  assert.equal(JSON.stringify(f.state),initial);
  assert.equal(f.actor.rng,rng,'Ineligible reads leave ordinary RNG unchanged');
  f.actor.elapsed=120;
  f.actor.physiology.waterDeficitMl=4000;
  assert.equal(freeHandExplorationChoice(f.actor),null);
  const care=discoveryDecision(f.actor);
  assert.notEqual(care.action.type,'free_hand');
  f.actor.physiology.waterDeficitMl=250;
  const reference=discoveryDecision(f.actor,{optionalAction:()=>({type:'inspect_object',
    targetId:Object.keys(f.actor.discovery.observations)[0]})});
  assert.equal(reference.action.type,'inspect_object','Existing reference opportunity stays first');
  assert.ok(freeHandExplorationChoice(f.actor),'Safe optional phase can offer the neutral motor');
  f.actor.memory.cells={};f.actor.discovery.observations={};
  assert.equal(discoveryDecision(f.actor).action.type,'free_hand',
    'The ordinary choice sorter can select the authored motor trial when other curiosity is absent');
});

test('ineligible motor reads preserve ordinary actor, ecology, action and RNG continuation',()=>{
  const a=fixture(),b=fixture();
  for(let i=0;i<5;i++){
    assert.equal(freeHandExplorationChoice(a.actor),null);
    assert.deepEqual(readFreeHandObserver(a.actor),
      {decisionChecks:i+1,eligibleDecisions:0,selectedAttempts:0,
        visibleSamples:0,sampleCounts:{unknown:0,absent:0,pose:0},
        lifecycle:emptyLifecycle(),
        sessionResets:0,saturated:false,nextEligibleAt:120});
    a.advance(.1);b.advance(.1);
  }
  a.actor.elapsed=120;b.actor.elapsed=120;
  assert.ok(freeHandExplorationChoice(a.actor),
    'An eligible option can be observed without becoming a selected action');
  a.advance(.1);b.advance(.1);
  assert.equal(readFreeHandObserver(a.actor).selectedAttempts,0);
  assert.deepEqual(a.actor,b.actor);
  assert.deepEqual(a.peer,b.peer);
  assert.deepEqual(a.state.environment,b.state.environment);
  assert.equal(a.actor.rng,b.actor.rng);
  assert.deepEqual(a.actor.memory.values,b.actor.memory.values);
});

test('current-footing exclusion preserves saved bytes and ordinary continuation, then reopens empty',()=>{
  const a=fixture(),b=fixture();
  for(const f of [a,b]){
    f.actor.position={x:-1200,y:240};
    f.state.elapsed=120;f.state.environment.elapsed=120;
    f.state.environment.ecology.elapsed=120;
    for(const actor of f.state.agents)actor.elapsed=120;
  }
  const values=new Map(),storage={getItem:key=>values.get(key)??null,
    setItem:(key,value)=>values.set(key,value)};
  assert.equal(writeOzarkSave(storage,a.state,geometry),true);
  const original=values.values().next().value,body=JSON.stringify(a.state),rng=a.actor.rng;
  for(let i=0;i<4;i++){
    assert.equal(freeHandExplorationChoice(a.actor),null);
    const read=readFreeHandObserver(a.actor);
    assert.equal(read.eligibleDecisions,0);
    read.lifecycle.rejectedAfterSelection.PRIORITY_CHANGED=900;
    assert.equal(readFreeHandObserver(a.actor).lifecycle.rejectedAfterSelection.PRIORITY_CHANGED,0);
  }
  assert.equal(JSON.stringify(a.state),body);
  assert.equal(a.actor.rng,rng);
  assert.equal(writeOzarkSave(storage,a.state,geometry),true);
  assert.equal(values.values().next().value,original,
    'Repeated actor-local current checks and defensive observer reads cannot write learning or RNG');
  a.advance(.1);b.advance(.1);
  assert.deepEqual(a.actor,b.actor);
  assert.deepEqual(a.peer,b.peer);
  assert.deepEqual(a.state.environment,b.state.environment);
  const reopened=loadOzarkSave({getItem:()=>original},geometry);
  assert.equal(reopened.blocked,false);
  const restored=reopened.state.agents[0];
  bindOzarkWorldAgent(restored,geometry,reopened.state);
  const controller=new NpcController(restored,{environment:reopened.state.environment,
    deferInitialObservation:true});
  assert.equal(readFreeHandObserver(restored).decisionChecks,0);
  assert.equal(readFreeHandObserver(restored).selectedAttempts,0);
  assert.deepEqual(readFreeHandObserver(restored).lifecycle,emptyLifecycle());
  assert.equal(readFreeHandObserver(restored).nextEligibleAt,240);
  assert.equal(freeHandExplorationChoice(restored),null);
  restored.position={x:276,y:760};restored.elapsed=240;
  assert.equal(freeHandExplorationChoice(restored)?.action.type,'free_hand');
  controller.dispose();
});
