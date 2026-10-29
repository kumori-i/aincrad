import test from 'node:test';
import assert from 'node:assert/strict';
import {createCommunicationExperiment} from '../src/communication-experiment.js';
import {createOzarkWorldGeometry} from '../src/ozark-world-geometry.js';
import {createOzarkState} from '../src/ozark-save.js';
import {bindOzarkWorldAgent} from '../src/ozark-agent-world.js';
import {PopulationRuntime} from '../src/population.js';
import {discoveryDecision} from '../src/discovery.js';
import {projectPhysiology} from '../src/biology.js';

const geometry=createOzarkWorldGeometry();
function sensor(){return {calls:0,disposals:0,capture(){this.calls++;return new Map();},dispose(){this.disposals++;}};}
function experiment(options={}){return createCommunicationExperiment({geometry,pixelSensor:sensor(),...options});}

test('ephemeral experiment never reads or writes browser storage; restart is fresh',()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage');let accesses=0;
  Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){accesses++;throw Error('ordinary save forbidden');}});
  try{
    const first=experiment();first.state.agents[0].discovery.effects.push({id:'old-session-only'});first.tick(.1);first.dispose();
    const restarted=experiment();assert.equal(restarted.state.elapsed,0);assert.equal(restarted.snapshot().exchanges,0);assert.equal(restarted.snapshot().updates,0);assert.deepEqual(restarted.snapshot().learners.map(l=>l.initial),first.snapshot().learners.map(l=>l.initial));for(const l of restarted.snapshot().learners)assert.deepEqual(l.current,l.initial);
    for(const n of restarted.state.agents){assert.equal(n.discovery.effects.length,0);assert.equal(n.discovery.experiments.length,0);}
    assert.equal(accesses,0);assert.notEqual(first.state,restarted.state);restarted.dispose();
  }finally{if(descriptor)Object.defineProperty(globalThis,'localStorage',descriptor);else delete globalThis.localStorage;}
});

test('historical legacy empty sensor preserves equivalent seeded survival runtime without experimental hook',()=>{
  const seed=411,exp=experiment({seed}),state=createOzarkState(geometry);
  for(const [i,n]of state.agents.entries()){n.seed=n.rng=(seed^(i?0x9e3779b9:0x15a4e35))>>>0;bindOzarkWorldAgent(n,geometry,state);}
  const baseline=new PopulationRuntime(state,{cardinal:false,communicationMode:'legacy'});
  try{
    for(let i=0;i<24;i++){exp.tick(.25);state.elapsed+=.25;baseline.tick(.25);}
    assert.deepEqual(exp.state.agents,state.agents);assert.deepEqual(exp.state.environment,state.environment);
    assert.equal(exp.snapshot().exchanges,0);assert.equal(exp.snapshot().updates,0);
  }finally{exp.dispose();baseline.dispose();}
});

test('bounded tick, snapshots, stop and sensor disposal remain inert after disposal',()=>{
  const pixels=sensor(),exp=experiment({pixelSensor:pixels});
  for(const dt of [0,-1,NaN,Infinity])exp.tick(dt);assert.equal(exp.state.elapsed,0);assert.equal(pixels.calls,0);
  exp.tick(500);assert.equal(exp.state.elapsed,.25);
  const snap=exp.snapshot();snap.agents[0].hunger=-500;snap.diagnostic.observations=900;assert.notEqual(exp.snapshot().agents[0].hunger,-500);assert.equal(exp.snapshot().diagnostic.observations,0);
  exp.state.elapsed=1799.9;exp.tick(500);assert.equal(exp.state.elapsed,1800);assert.equal(exp.snapshot().limitReached,true);
  const before=exp.snapshot();exp.tick(.25);assert.deepEqual(exp.snapshot(),before);
  exp.dispose();exp.dispose();assert.equal(pixels.disposals,1);const calls=pixels.calls;exp.tick(1);assert.equal(pixels.calls,calls);assert.equal(exp.runtime.disposed,true);assert.equal(exp.snapshot().pending,0);
});

test('urgent thirst and sleep remain upstream of optional communication decisions',()=>{
  const exp=experiment();try{
    const n=exp.state.agents[0];let calls=0;const options={chooseOptional(){calls++;return 0;}};
    n.physiology.waterDeficitMl=1000;n.flask.water=200;projectPhysiology(n);
    assert.equal(discoveryDecision(n,options).action.type,'drink');assert.equal(calls,0);
    n.physiology.waterDeficitMl=0;n.physiology.sleepPressure=95;n.physiology.fatigue=80;projectPhysiology(n);
    assert.ok(['sleep','rest'].includes(discoveryDecision(n,options).action.type));assert.equal(calls,0);
  }finally{exp.dispose();}
});

test('numeric sensor fixture offers no meaning or source before personal experience',()=>{
  // Engineering-only synthetic RGB; not a learned behavior or real pixel evaluation.
  const fixture={capture(n){return new Map(Object.keys(n.discovery.observations).map(id=>[id,{features:Array(48).fill(.5),pixels:Array(768).fill(127),at:n.elapsed,epoch:n.epoch}]));}};
  const exp=experiment({pixelSensor:fixture});try{
    const n=exp.state.agents[0],bridge=exp.runtime.controller(n.id).experimentalDiscovery;
    assert.equal(bridge.choose(n,[{action:{type:'pull',targetId:'object:1'}},{action:{type:'sample',targetId:'object:2'}}]),null);
    assert.equal(exp.snapshot().exchanges,0);assert.equal(exp.snapshot().updates,0);
  }finally{exp.dispose();}
});

for(const enabled of [true,false])test(`scripted physical source drives paid credit without copied experience (channel ${enabled?'on':'erased'})`,async()=>{
  // Wiring fixture only: supplied numeric images and scripted placement/actions.
  // It measures causal plumbing, never autonomous acquisition or learned survival.
  const {requestNpcAction,tickNpc,observeNpc}=await import('../src/npc.js');
  const {processDiscoveryFeedback}=await import('../src/discovery.js');
  const {recordEvent}=await import('../src/npc-memory.js');
  const numeric={paused:false,capture(n,state){if(this.paused)return new Map();return new Map([...state.environment.ecology.plants,...state.environment.ecology.materials].map(o=>[o.id,{features:Array(48).fill(.5),pixels:Array(768).fill(127),at:n.elapsed,epoch:n.epoch}]));}};
  const exp=experiment({pixelSensor:numeric,enabled});
  try{
    const [sender,receiver]=exp.state.agents,env=exp.state.environment;
    const plant=env.ecology.plants.find(p=>p.kind==='apple_tree'&&p.quantity>0&&[-45,45].some(dx=>geometry.canOccupy(p.position.x+dx,p.position.y)));
    assert.ok(plant);const dx=[-45,45].find(dx=>geometry.canOccupy(plant.position.x+dx,plant.position.y));
    for(const n of [sender,receiver]){n.position={x:plant.position.x+dx,y:plant.position.y};n.nextDecisionAt=1e9;observeNpc(n,env);}
    function advance(n,seconds){for(let i=0;i<Math.ceil(seconds*4);i++){tickNpc(n,.25,env);processDiscoveryFeedback(n,{recordEffect:e=>recordEvent(n,'condition',{code:'DISCOVERY_EFFECT',feedback:e})});}}
    function act(n,action){assert.equal(requestNpcAction(n,action,env).code,'ACTION_STARTED');for(let i=0;i<100&&n.active;i++)advance(n,.25);assert.equal(n.lastResult.ok,true);}
    act(sender,{type:'pull',targetId:plant.id});const source=sender.inventory.items[0];exp.tick(.01);
    act(sender,{type:'sample',targetId:source});numeric.paused=true;exp.tick(.01);numeric.paused=false;advance(sender,60);exp.tick(.01);
    assert.ok(sender.discovery.effects.length>0);
    act(receiver,{type:'pull',targetId:plant.id});const target=receiver.inventory.items[0];exp.tick(.01);
    const bridge=exp.runtime.controller(receiver.id).experimentalDiscovery;
    const choices=[{action:{type:'sample',targetId:target}},{action:{type:'inspect_object',targetId:target}}];
    const originalEffects=receiver.discovery.effects.length,index=bridge.choose(receiver,choices);assert.ok(Number.isInteger(index));assert.equal(receiver.discovery.effects.length,originalEffects);
    const action=choices[index].action,result=requestNpcAction(receiver,action,env);bridge.performed(receiver,action,result,receiver.active);
    assert.equal(exp.snapshot().pending,1);assert.equal(result.code,'ACTION_STARTED');
    advance(receiver,65);exp.tick(.01);
    const snapshot=exp.snapshot();assert.equal(snapshot.pending,0);assert.equal(snapshot.updates,1);assert.equal(snapshot.exchanges,1);assert.ok(['attributed','expired'].includes(snapshot.latest.status));assert.ok(receiver.discovery.experiments.some(e=>e.primitive===action.type&&e.targetId===target&&e.durationSeconds>0));
    assert.equal(snapshot.ledger.length,1);assert.ok(snapshot.ledger[0].paidSeconds>0);assert.ok(snapshot.ledger[0].selectedActionId>0);assert.equal(snapshot.learners[0].current.senderUpdates,1);assert.equal(snapshot.learners[1].current.receiverUpdates,1);assert.notEqual(snapshot.learners[0].current.sender.fingerprint,snapshot.learners[0].initial.sender.fingerprint);assert.notEqual(snapshot.learners[1].current.receiver.fingerprint,snapshot.learners[1].initial.receiver.fingerprint);
    assert.ok(snapshot.diagnostic.observations>0);if(!enabled){assert.equal(snapshot.diagnostic.meanTotalVariation,0);assert.equal(snapshot.diagnostic.argmaxChanged,0);assert.match(snapshot.diagnostic.interpretation,/constant.message/i);}
    const latest=snapshot.latest;latest.tokens[0]=999;latest.senderPixels[0]=999;assert.notEqual(exp.snapshot().latest.tokens[0],999);assert.notEqual(exp.snapshot().latest.senderPixels[0],999);
    const second=bridge.choose(receiver,choices);assert.ok(Number.isInteger(second));const next=choices[second].action;const admission=requestNpcAction(receiver,next,env);bridge.performed(receiver,next,admission,receiver.active);assert.equal(exp.snapshot().pending,1);sender.epoch++;exp.tick(.01);assert.equal(exp.snapshot().ledger.at(-1).reward,null);exp.dispose();assert.equal(exp.snapshot().pending,0);assert.equal(exp.snapshot().censored,1);assert.equal(exp.snapshot().updates,1);assert.equal(exp.snapshot().latest.reward,null);
  }finally{exp.dispose();}
});
