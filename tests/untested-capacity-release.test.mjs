import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { createOzarkState, writeOzarkSave, loadOzarkSave, getOzarkSaveValidationFailure } from '../src/ozark-save.js';
import { bindOzarkWorldAgent } from '../src/ozark-agent-world.js';
import { bindOzarkEcology } from '../src/ozark-ecology.js';
import { observeNpc, requestNpcAction, tickNpc, cancelNpcAction } from '../src/npc.js';
import { discoveryDecision, processDiscoveryFeedback } from '../src/discovery.js';
import { NpcController } from '../src/controller.js';
import { projectPhysiology } from '../src/biology.js';
import { bodySignals } from '../src/interoception.js';
import { lookupEcologyObject } from '../src/ecology.js';
import { learnedCapacityRelease } from '../src/learned-capacity-release.js';
import { retainedProofIntegrityError } from '../src/proof-retention.js';

const geometry = createOzarkWorldGeometry();
const clone = structuredClone;
const close = (a,b) => assert.ok(Math.abs(a-b)<1e-7, `${a} differs from ${b}`);
import { pendingSampleRetention } from '../src/pending-sample-retention.js';

function attach(state) {
  const n=state.agents[0],env=state.environment;
  bindOzarkEcology(env.ecology,geometry);
  for(const actor of state.agents)bindOzarkWorldAgent(actor,geometry,state);
  const clock=()=>{state.elapsed=env.elapsed=env.ecology.elapsed=env.elapsed+.1;};
  const tick=()=>{clock();for(const actor of state.agents)tickNpc(actor,.1,env);processDiscoveryFeedback(n);};
  const settle=()=>{for(let i=0;n.active&&i<400;i++)tick();assert.equal(n.active,null);return n.lastResult;};
  const pay=action=>{assert.equal(requestNpcAction(n,action,env).code,'ACTION_STARTED',JSON.stringify(action));const result=settle();assert.equal(result.ok,true,JSON.stringify(result));return result;};
  const until=predicate=>{for(let i=0;!predicate()&&i<1500;i++)tick();assert.ok(predicate(),'personal delayed effect is required');};
  const at=id=>{const p=lookupEcologyObject(env.ecology,id);n.position={x:p.position.x+45,y:p.position.y};observeNpc(n,env);};
  const appetite=(hours=20)=>{n.physiology.hoursSinceMeal=hours;n.physiology.satietyHours=0;n.physiology.waterDeficitMl=0;projectPhysiology(n);};
  return {state,n,env,clock,tick,settle,pay,until,at,appetite};
}

let prepared;
function fixture({tracked=false}={}){
 if(!prepared){prepared=build();}
 const state=tracked?Object.assign(createOzarkState(geometry,{communicationSeed:211}),clone(prepared.state)):clone(prepared.state);
 const f=attach(state);Object.assign(f,{good:prepared.good,unknown:prepared.unknown,positive:prepared.positive});observeNpc(f.n,f.env);return f;
}
function build(){
const state=createOzarkState(geometry,{communicationSeed:211});
state.elapsed=state.environment.elapsed=state.environment.ecology.elapsed=60;
for(const [i,n] of state.agents.entries()){n.elapsed=60;n.rng=211+i;}
const f=attach(state),trees=f.env.ecology.plants.filter(p=>p.kind==='apple_tree'&&p.quantity>5);
let good,bystander;
outer:for(const a of trees)for(const b of trees){const gap=Math.hypot(a.position.x-b.position.x,a.position.y-b.position.y);
 if(gap>120&&gap<260&&[a,b].every(p=>geometry.canOccupy(p.position.x+45,p.position.y,CONFIG.playerRadius)&&geometry.lineOfSight({x:p.position.x+45,y:p.position.y},p.position))){good=a.id;bystander=b.id;break outer;}}
assert.ok(good);f.at(good);
const positive=f.pay({type:'pull',targetId:good}).materialId;
f.pay({type:'sample',targetId:positive});
f.until(()=>f.n.discovery.effects.some(e=>e.objectId===positive&&e.effect==='sustained'));
f.appetite();
assert.deepEqual(discoveryDecision(f.n).action,{type:'sample',targetId:positive});
// Explicit fixture-controlled release, not an autonomous disposal decision.
f.pay({type:'release',targetId:positive});
f.at(bystander);const unknown=[];for(let i=0;i<4;i++)unknown.push(f.pay({type:'pull',targetId:bystander}).materialId);
f.pay({type:'sample',targetId:unknown[0]});
f.at(good);f.appetite();
assert.equal(f.n.inventory.items.length,4);
assert.equal(pendingSampleRetention(f.n,unknown[0]),true);
assert.equal(retainedProofIntegrityError(f.n),null);
return {state:clone(f.state),good,unknown,positive};}
const release=f=>learnedCapacityRelease(f.n,f.n.discovery.techniques.filter(t=>t.sourceId===f.good),{allowUntested:true});
const only=f=>learnedCapacityRelease(f.n,f.n.discovery.techniques.filter(t=>t.sourceId===f.good),{allowUntested:true,eligible:id=>id===f.unknown[1]});

test('full hands choose a paid untested release, preserve pending trial, then pull the earned source',()=>{
 const f=fixture(),pending=f.unknown[0],before=f.n.physiology.totals.metabolizedKcal;
 const choice=discoveryDecision(f.n);assert.deepEqual(choice.action,{type:'release',targetId:f.unknown[1]});assert.equal(choice.need,'food');
 const result=f.pay(choice.action);assert.ok(result.durationSeconds>0);assert.ok(f.n.physiology.totals.metabolizedKcal>before);
 assert.ok(f.n.inventory.items.includes(pending));assert.equal(pendingSampleRetention(f.n,pending),true);
 observeNpc(f.n,f.env);const next=discoveryDecision(f.n);assert.deepEqual(next.action,{type:'pull',targetId:f.good});
 f.pay(next.action);assert.equal(f.n.inventory.items.length,4);
 assert.equal(retainedProofIntegrityError(f.n),null);
});

test('pending and personally beneficial held items are not fallback candidates',()=>{
 const f=fixture();assert.equal(learnedCapacityRelease(f.n,f.n.discovery.techniques,{allowUntested:true,eligible:id=>id===f.unknown[0]}),null);
 f.pay({type:'release',targetId:f.unknown[1]});f.pay({type:'grasp',targetId:f.positive});observeNpc(f.n,f.env);
 assert.equal(learnedCapacityRelease(f.n,f.n.discovery.techniques,{allowUntested:true,eligible:id=>id===f.positive}),null);
 assert.deepEqual(discoveryDecision(f.n).action,{type:'sample',targetId:f.positive});
});

for(const [name,mutate] of [
 ['missing acquisition receipt',f=>{const e=f.n.discovery.experiments.find(e=>e.materialId===f.unknown[1]);f.n.memory.experience=f.n.memory.experience.filter(r=>r.id!==e.actionId);}],
 ['duplicate acquisition',f=>{f.n.discovery.experiments.push(clone(f.n.discovery.experiments.find(e=>e.materialId===f.unknown[1])));}],
 ['missing last receipt',f=>{f.n.memory.experience.pop();}],
 ['malformed tail',f=>{f.n.memory.experience.push({});}],
 ['unlinked later release',f=>{f.n.discovery.experiments.push({id:999,actionId:999,at:f.n.elapsed,primitive:'release',targetId:f.unknown[1]});}],
 ['unlinked sample',f=>{f.n.discovery.experiments.push({primitive:'sample',targetId:f.unknown[1]});}],
 ['pending marker',f=>{f.n.discovery.samplesPending[f.unknown[1]]=f.n.elapsed;}],
 ['positive water effect',f=>{f.n.discovery.effects.push({objectId:f.unknown[1],effect:'water relief'});}],
 ['duplicate held identity',f=>{f.n.inventory.items[3]=f.unknown[1];}],
 ['duplicate other held identity',f=>{f.n.inventory.items[3]=f.unknown[0];}],
 ['invalid other held identity',f=>{f.n.inventory.items[3]='invented';}],
 ['missing source technique',f=>{f.n.discovery.techniques=[];}],
 ['missing source recognition',f=>{f.n.discovery.effects=[];}],
])test(`fallback fails closed: ${name}`,()=>{const f=fixture();mutate(f);assert.equal(only(f),null);});

test('recent explicit release and regrasp requires fresh custody and no invented benefit',()=>{
 const f=fixture(),id=f.unknown[1];f.pay({type:'release',targetId:id});assert.equal(only(f),null);
 f.pay({type:'grasp',targetId:id});assert.deepEqual(only(f),{type:'release',targetId:id});
});

test('food ablation, water and rest retain priority',()=>{
 const f=fixture();assert.notEqual(discoveryDecision(f.n,{foodLearning:false}).need,'food');
 const water=fixture();water.n.physiology.waterDeficitMl=4000;water.n.flask.water=.5;projectPhysiology(water.n);assert.equal(discoveryDecision(water.n).action.type,'drink');
 const rest=fixture();rest.appetite(10);rest.n.physiology.stamina=8;rest.n.physiology.fatigue=80;assert.equal(discoveryDecision(rest.n).action.type,'rest');
});

test('full hands can approach on observed ground without releasing until locally seen',()=>{
 const f=fixture(),held=clone(f.n.inventory.items),source=lookupEcologyObject(f.env.ecology,f.good);
 f.n.position={x:source.position.x+160,y:source.position.y};observeNpc(f.n,f.env);f.appetite(10);
 const choice=discoveryDecision(f.n);assert.equal(choice.action.type,'move');assert.equal(choice.need,'food');assert.deepEqual(f.n.inventory.items,held);assert.equal(f.n.discovery.run,null);
 f.at(f.good);assert.equal(discoveryDecision(f.n).action.type,'release');
});


test('all sampled or pending possessions prohibit the untested fallback',()=>{
 const f=fixture();for(const id of f.unknown.slice(1))f.pay({type:'sample',targetId:id});observeNpc(f.n,f.env);
 assert.equal(release(f),null);assert.notEqual(discoveryDecision(f.n).action.type,'release');
});

test('unavailable source and absent observed route cannot trigger capacity travel or release',()=>{
 for(const condition of ['bare','no-route']){
  const f=fixture(),source=lookupEcologyObject(f.env.ecology,f.good);f.n.position={x:source.position.x+160,y:source.position.y};observeNpc(f.n,f.env);f.appetite(10);
  if(condition==='bare')f.n.discovery.observations[f.good].count=0;
  else f.n.memory.cells={};
  const choice=discoveryDecision(f.n);assert.notEqual(choice.need,'food',condition);assert.notEqual(choice.action.type,'release',condition);
 }
});

test('care and food ablation interrupt a full-hands approach without a retained run',()=>{
 const f=fixture(),source=lookupEcologyObject(f.env.ecology,f.good);f.n.position={x:source.position.x+160,y:source.position.y};observeNpc(f.n,f.env);f.appetite(10);
 assert.equal(discoveryDecision(f.n).need,'food');assert.equal(f.n.discovery.run,null);
 assert.notEqual(discoveryDecision(f.n,{foodLearning:false}).need,'food');
 f.n.physiology.waterDeficitMl=4000;f.n.flask.water=.5;projectPhysiology(f.n);assert.equal(discoveryDecision(f.n).action.type,'drink');assert.equal(f.n.inventory.items.length,4);
});

test('current save roundtrip retains custody but requires renewed local sight before release',()=>{
 const f=fixture({tracked:true}),bytes=new Map(),storage={getItem:k=>bytes.get(k)??null,setItem:(k,v)=>bytes.set(k,v)};
 assert.equal(writeOzarkSave(storage,f.state,geometry),true,JSON.stringify(getOzarkSaveValidationFailure(f.state)));
 const loaded=loadOzarkSave(storage,geometry);assert.equal(loaded.blocked,false,loaded.error);const reopened=attach(loaded.state);
 assert.deepEqual(reopened.n.inventory,f.n.inventory);assert.deepEqual(reopened.n.physiology,f.n.physiology);
 assert.notEqual(discoveryDecision(reopened.n).action.type,'release');observeNpc(reopened.n,reopened.env);
 assert.deepEqual(discoveryDecision(reopened.n).action,{type:'release',targetId:f.unknown[1]});
});
