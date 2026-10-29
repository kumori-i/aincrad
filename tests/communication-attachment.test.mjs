import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {attachCommunicationLearning} from '../src/communication-attachment.js';
import {createCommunicationExperiment} from '../src/communication-experiment.js';
import {createCommunicationExperiment as frozenExperiment} from './fixtures/communication-experiment-v1.js';
import {createOzarkWorldGeometry} from '../src/ozark-world-geometry.js';
import {createOzarkState,writeOzarkSave,loadOzarkSave,OZARK_SAVE_KEY} from '../src/ozark-save.js';
import {bindOzarkWorldAgent} from '../src/ozark-agent-world.js';
import {PopulationRuntime} from '../src/population.js';
import {requestNpcAction,tickNpc,observeNpc,collapseNpc,rescueNpc} from '../src/npc.js';
import {processDiscoveryFeedback} from '../src/discovery.js';
import {recordEvent} from '../src/npc-memory.js';
const geometry=createOzarkWorldGeometry();
const empty=()=>({capture:()=>new Map()});
function numeric(){return {paused:false,capture(n,state){if(this.paused)return new Map();return new Map([...state.environment.ecology.plants,...state.environment.ecology.materials].map(o=>[o.id,{features:Array(48).fill(.5),pixels:Array(768).fill(127),at:n.elapsed,epoch:n.epoch}]));}};}
function attached({diagnostics=true}={}){
  const state=createOzarkState(geometry);
  for(const [i,n]of state.agents.entries()){n.seed=n.rng=(211^(i?0x9e3779b9:0x15a4e35))>>>0;bindOzarkWorldAgent(n,geometry,state);}
  const pixelSensor=numeric(),learning=attachCommunicationLearning({state,pixelSensor,diagnostics});
  const runtime=new PopulationRuntime(state,{cardinal:false,experimentalDiscovery:learning.hooks});
  return {state,runtime,pixelSensor,learning,tick(dt){learning.beforeTick();state.elapsed+=dt;runtime.tick(dt);learning.afterTick();},snapshot:()=>learning.snapshot(),dispose(){learning.dispose();runtime.dispose();}};
}
function helpers(exp){
  const [sender,receiver]=exp.state.agents,env=exp.state.environment;
  const plant=env.ecology.plants.find(p=>p.kind==='apple_tree'&&p.quantity>0&&[-45,45].some(dx=>geometry.canOccupy(p.position.x+dx,p.position.y)));
  const dx=[-45,45].find(dx=>geometry.canOccupy(plant.position.x+dx,plant.position.y));
  for(const n of [sender,receiver]){n.position={x:plant.position.x+dx,y:plant.position.y};n.nextDecisionAt=1e9;observeNpc(n,env);}
  function advance(n,seconds){for(let i=0;i<Math.ceil(seconds*4);i++){tickNpc(n,.25,env);processDiscoveryFeedback(n,{recordEffect:e=>recordEvent(n,'condition',{code:'DISCOVERY_EFFECT',feedback:e})});}}
  function act(n,action){assert.equal(requestNpcAction(n,action,env).code,'ACTION_STARTED');for(let i=0;i<100&&n.active;i++)advance(n,.25);assert.equal(n.lastResult.ok,true);}
  function source(){act(sender,{type:'pull',targetId:plant.id});const item=sender.inventory.items[0];exp.tick(.01);act(sender,{type:'sample',targetId:item});exp.pixelSensor.paused=true;exp.tick(.01);exp.pixelSensor.paused=false;advance(sender,60);exp.tick(.01);}
  function choices(){act(receiver,{type:'pull',targetId:plant.id});const target=receiver.inventory.items[0];exp.tick(.01);return [{action:{type:'sample',targetId:target}},{action:{type:'inspect_object',targetId:target}}];}
  return {sender,receiver,env,advance,act,source,choices};
}
function legacyShape(snapshot){const {gates,relief,discomfort,effortExpiry,limitReached,observationEvents,...rest}=snapshot;return rest;}
function scenario(factory,options={}){
  const pixelSensor=numeric(),exp=factory({geometry,pixelSensor,...options});exp.pixelSensor??=pixelSensor;
  try{
    const h=helpers(exp);h.source();const choices=h.choices(),bridge=exp.runtime.controller(h.receiver.id).experimentalDiscovery;
    const selected=bridge.choose(h.receiver,choices);assert.ok(Number.isInteger(selected));const action=choices[selected].action;
    bridge.performed(h.receiver,action,requestNpcAction(h.receiver,action,h.env),h.receiver.active);
    h.advance(h.receiver,65);exp.tick(.01);
    // Inspection itself must not mutate policies, pending receipts or survival RNG.
    const first=exp.snapshot();for(let i=0;i<5;i++)assert.deepEqual(exp.snapshot(),first);
    return {state:structuredClone(exp.state),snapshot:legacyShape(first),gates:first.gates};
  }finally{exp.dispose();}
}
test('extracted finite wrapper preserves frozen protocol actions, physical states, receipts, RNG and weights',()=>{
  for(const enabled of [true,false]){
    const old=scenario(frozenExperiment,{enabled}),current=scenario(createCommunicationExperiment,{enabled});
    assert.deepEqual(current.state,old.state);assert.deepEqual(current.snapshot,old.snapshot);
  }
});
test('passive gate diagnostics on/off preserve exact paid actions, states, RNG, receipts and models',()=>{
  const on=scenario(()=>attached({diagnostics:true})),off=scenario(()=>attached({diagnostics:false}));
  assert.deepEqual(on.state,off.state);assert.deepEqual(on.snapshot,off.snapshot);
  assert.ok(on.gates.eligible>0);assert.ok(Object.values(off.gates).every(x=>x===0));
});
test('attachment never owns clock, survival seed, runtime or save and is not capped at 1800 seconds',()=>{
  const state=createOzarkState(geometry);for(const n of state.agents)bindOzarkWorldAgent(n,geometry,state);
  const before=structuredClone(state),learning=attachCommunicationLearning({state,pixelSensor:empty()});
  assert.deepEqual(state,before);assert.equal(learning.runtime,undefined);assert.equal(learning.tick,undefined);
  const runtime=new PopulationRuntime(state,{cardinal:false,experimentalDiscovery:learning.hooks});
  state.elapsed=1801;const actorTime=state.agents.map(n=>n.elapsed);
  learning.beforeTick();assert.equal(state.elapsed,1801);state.elapsed+=.25;runtime.tick(.25);learning.afterTick();
  assert.equal(state.elapsed,1801.25);state.agents.forEach((n,i)=>assert.equal(n.elapsed,actorTime[i]+.25));
  learning.dispose();assert.equal(runtime.disposed,false);runtime.dispose();
});
test('ordinary save schema remains unchanged and reopened communication weights are fresh',()=>{
  const state=createOzarkState(geometry);for(const n of state.agents)bindOzarkWorldAgent(n,geometry,state);
  const learning=attachCommunicationLearning({state,pixelSensor:empty()}),runtime=new PopulationRuntime(state,{cardinal:false,experimentalDiscovery:learning.hooks});
  const values=new Map(),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
  try{
    learning.beforeTick();state.elapsed+=.25;runtime.tick(.25);learning.afterTick();
    assert.equal(writeOzarkSave(storage,state,geometry),true);
    const bytes=values.get(OZARK_SAVE_KEY);assert.doesNotMatch(bytes,/communication|senderUpdates|receiverUpdates/);
    const loaded=loadOzarkSave(storage,geometry);assert.equal(loaded.blocked,false);assert.equal(loaded.state.elapsed,state.elapsed);
    const resumed=attachCommunicationLearning({state:loaded.state,pixelSensor:empty()});
    for(const l of resumed.snapshot().learners)assert.deepEqual(l.current,l.initial);
    resumed.dispose();
  }finally{learning.dispose();runtime.dispose();}
});
test('attachment primes existing personally proven histories without rebinding them to new crops',()=>{
  const exp=attached();try{
    const h=helpers(exp);h.source();assert.ok(exp.snapshot().gates.sources>0);
    const resumed=attachCommunicationLearning({state:exp.state,pixelSensor:numeric()});
    resumed.beforeTick();resumed.afterTick();
    assert.ok(h.sender.discovery.effects.length>0);assert.equal(resumed.snapshot().gates.sources,0);assert.equal(resumed.snapshot().agents[0].samples,0);
    assert.equal(resumed.hooks.choose(h.receiver,[{action:{type:'sample',targetId:'object:1'}},{action:{type:'pull',targetId:'object:2'}}]),null);
    for(const l of resumed.snapshot().learners)assert.deepEqual(l.current,l.initial);
    resumed.dispose();
  }finally{exp.dispose();}
});
for(const change of ['epoch','actor','discovery','physiology'])test(`identity boundary ${change} censors pending credit and cannot rebind old effect`,()=>{
  const exp=attached();try{
    const h=helpers(exp);h.source();const choices=h.choices(),bridge=exp.learning.hooks;
    const sourceCount=exp.snapshot().gates.sources;
    const index=bridge.choose(h.receiver,choices),action=choices[index].action;
    bridge.performed(h.receiver,action,requestNpcAction(h.receiver,action,h.env),h.receiver.active);assert.equal(exp.snapshot().pending,1);
    if(change==='epoch')h.sender.epoch++;
    else if(change==='actor')exp.state.agents[0]=structuredClone(h.sender);
    else h.sender[change]=structuredClone(h.sender[change]);
    assert.equal(bridge.choose(h.receiver,choices),null);assert.equal(exp.snapshot().pending,0);assert.equal(exp.snapshot().censored,1);assert.equal(exp.snapshot().updates,0);
    exp.learning.beforeTick();exp.learning.afterTick();assert.equal(bridge.choose(h.receiver,choices),null);
    assert.equal(exp.snapshot().gates.sources,sourceCount);assert.equal(exp.snapshot().ledger.at(-1).reward,null);
  }finally{exp.dispose();}
});
test('main has one tick owner, guarded optional attachment and unrestricted ordinary save during inspection',async()=>{
  const source=await readFile(new URL('../src/ozark-world-main.js',import.meta.url),'utf8');
  assert.equal((source.match(/population\.tick\(dt\)/g)||[]).length,1);
  assert.match(source,/communicate\('beforeTick'\);\s*state.elapsed \+= dt;\s*state.distance \+= motion.distance;\s*population.tick\(dt\);\s*communicate\('afterTick'\)/);
  assert.match(source,/if \(resetHeld \|\| resetRetired \|\| loaded.blocked \|\| !state\) return false/);
  assert.doesNotMatch(source,/createCommunicationExperiment|1800|n\.rng\s*=/);
  assert.match(source,/catch \{ stopCommunication\(\); return null; \}/);
});

test('frozen protocol fixture is exactly PR60 source except import relocation',async()=>{
  const source=(await readFile(new URL('./fixtures/communication-experiment-v1.js',import.meta.url),'utf8')).replaceAll("from '../../src/","from './").replace("from './legacy-population.js'", "from './population.js'");
  assert.equal(createHash('sha256').update(source).digest('hex'),'3bf1086a32361291371771d8561cc5bb20eb738375cda210b9b16a8bbcbeab2a');
});

test('trained individual retains learning across scene epochs and real collapse/recovery, but a new actor is fresh',()=>{
  const exp=attached();try{
    const h=helpers(exp);h.source();const choices=h.choices(),bridge=exp.learning.hooks;
    const index=bridge.choose(h.receiver,choices),action=choices[index].action;
    bridge.performed(h.receiver,action,requestNpcAction(h.receiver,action,h.env),h.receiver.active);
    h.advance(h.receiver,65);exp.tick(.01);
    assert.equal(exp.snapshot().updates,1);
    const learned=exp.snapshot().learners[0].current;
    assert.notDeepEqual(learned,exp.snapshot().learners[0].initial);
    // Adapter boundary fixture: scene changes increment epoch, not identity.
    const scene=h.sender.scene;h.sender.scene='scene-boundary-fixture';h.sender.epoch++;
    exp.learning.beforeTick();assert.deepEqual(exp.snapshot().learners[0].current,learned);
    h.sender.scene=scene;h.sender.epoch++;exp.learning.beforeTick();
    for(const key of ['discovery','physiology']){h.sender[key]=structuredClone(h.sender[key]);exp.learning.beforeTick();assert.deepEqual(exp.snapshot().learners[0].current,learned);}
    assert.equal(collapseNpc(h.sender,'controlled attachment lifecycle fixture'),true);
    exp.learning.afterTick();assert.deepEqual(exp.snapshot().learners[0].current,learned);
    assert.equal(rescueNpc(h.sender).ok,true);exp.learning.afterTick();
    for(let i=0;i<2000&&h.sender.lifecycle!=='AWAKE';i++){h.advance(h.sender,.25);exp.learning.afterTick();}
    assert.equal(h.sender.lifecycle,'AWAKE');assert.deepEqual(exp.snapshot().learners[0].current,learned);
    exp.state.agents[0]=structuredClone(h.sender);exp.learning.beforeTick();
    const fresh=exp.snapshot().learners[0];assert.deepEqual(fresh.current,fresh.initial);assert.notDeepEqual(fresh.current,learned);
    assert.equal(bridge.choose(h.receiver,choices),null,'A replaced individual cannot reuse old personal source');
  }finally{exp.dispose();}
});
test('unperformed selection is visibly censored on identity change and does not update either model',()=>{
  const exp=attached();try{
    const h=helpers(exp);h.source();const choices=h.choices();assert.ok(Number.isInteger(exp.learning.hooks.choose(h.receiver,choices)));
    h.receiver.epoch++;exp.learning.beforeTick();const snapshot=exp.snapshot();
    assert.equal(snapshot.latest.status,'interrupted');assert.equal(snapshot.latest.reward,null);assert.equal(snapshot.censored,1);assert.equal(snapshot.updates,0);
  }finally{exp.dispose();}
});

test('disposing an unperformed selection reports a censored outcome without training',()=>{
  const exp=attached();try{
    const h=helpers(exp);h.source();assert.ok(Number.isInteger(exp.learning.hooks.choose(h.receiver,h.choices())));
    exp.dispose();const snapshot=exp.snapshot();assert.equal(snapshot.latest.status,'interrupted');assert.equal(snapshot.latest.reward,null);assert.equal(snapshot.censored,1);assert.equal(snapshot.updates,0);assert.equal(snapshot.ledger.at(-1).reward,null);
  }finally{exp.dispose();}
});
test('observer emission keeps copied crops and one identity through interruption without changing policies',()=>{
  const exp=attached();try{
    const h=helpers(exp);h.source();const choices=h.choices(),bridge=exp.runtime.controller(h.receiver.id).experimentalDiscovery;
    const selected=bridge.choose(h.receiver,choices);assert.ok(Number.isInteger(selected));
    const initial=exp.snapshot(),row=initial.observationEvents.at(-1);assert.equal(row.status,'selected');assert.equal(row.id,initial.exchanges);assert.equal(row.senderPixels.length,768);
    const pristine=structuredClone(row);row.senderPixels[0]=999;row.tokens[0]=999;
    assert.deepEqual(exp.snapshot().observationEvents.at(-1),pristine,'Snapshot cannot edit retained emission');
    for(let i=0;i<4;i++)exp.snapshot();assert.deepEqual(exp.snapshot().learners,initial.learners,'Observer refresh cannot train policies');
    bridge.performed(h.receiver,{type:'rest'},null,null);
    const ended=exp.snapshot().observationEvents.at(-1);assert.equal(ended.id,pristine.id);assert.equal(ended.status,'interrupted');assert.deepEqual(ended.senderPixels,pristine.senderPixels);assert.deepEqual(ended.receiverPixels,pristine.receiverPixels);assert.equal(ended.reward,null);
  }finally{exp.dispose();}
});
