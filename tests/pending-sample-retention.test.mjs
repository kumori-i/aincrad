import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, NPC_RULES } from '../src/config.js';
import { DISCOVERY_RULES } from '../src/discovery-config.js';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { createOzarkState } from '../src/ozark-save.js';
import { bindOzarkWorldAgent } from '../src/ozark-agent-world.js';
import { bindOzarkEcology } from '../src/ozark-ecology.js';
import { observeNpc, requestNpcAction, tickNpc, cancelNpcAction } from '../src/npc.js';
import { processDiscoveryFeedback, discoveryDecision } from '../src/discovery.js';
import { projectPhysiology } from '../src/biology.js';
import { bodySignals } from '../src/interoception.js';
import { lookupEcologyObject } from '../src/ecology.js';
import { retainedProofIntegrityError } from '../src/proof-retention.js';
import { recordEvent } from '../src/npc-events.js';
import { pendingSampleRetention } from '../src/pending-sample-retention.js';

const geometry=createOzarkWorldGeometry(), clone=structuredClone;
let prepared;

// Bounded authored current-world encounter, not an autonomous trial. Setup
// chooses an existing tree and legal local position. The normal actuator funds
// and completes pulling and sampling; no action receipt or result is supplied.
// Ecology stays static while the ordinary actor and digestive clocks advance.
function build() {
  const state=createOzarkState(geometry,{communicationSeed:211});
  const n=state.agents[0],env=state.environment;
  state.elapsed=env.elapsed=env.ecology.elapsed=60;
  bindOzarkEcology(env.ecology,geometry);
  for(const actor of state.agents){actor.elapsed=60;bindOzarkWorldAgent(actor,geometry,state);}
  const source=env.ecology.plants.find(p=>p.kind==='apple_tree'&&p.quantity>2&&
    geometry.canOccupy(p.position.x+45,p.position.y,CONFIG.playerRadius)&&
    geometry.lineOfSight({x:p.position.x+45,y:p.position.y},p.position));
  assert.ok(source);n.position={x:source.position.x+45,y:source.position.y};observeNpc(n,env);
  const tick=()=>{
    state.elapsed=env.elapsed=env.ecology.elapsed=env.elapsed+.1;
    for(const actor of state.agents)tickNpc(actor,.1,env);
    processDiscoveryFeedback(n);
  };
  const pay=action=>{
    assert.equal(requestNpcAction(n,action,env).code,'ACTION_STARTED');
    for(let i=0;n.active&&i<400;i++)tick();
    assert.equal(n.active,null);assert.equal(n.lastResult.ok,true,JSON.stringify(n.lastResult));
    return clone(n.lastResult);
  };
  const id=pay({type:'pull',targetId:source.id}).materialId;
  const before=clone(lookupEcologyObject(env.ecology,id));
  const sampled=pay({type:'sample',targetId:id});
  assert.equal(retainedProofIntegrityError(n),null);
  return {state,n,env,id,sourceId:source.id,before,sampled,pay,tick};
}
function fixture() {
  prepared||=build();
  return {n:clone(prepared.n),id:prepared.id,sourceId:prepared.sourceId};
}
const retained=f=>pendingSampleRetention(f.n,f.id);
const sample=f=>f.n.discovery.experiments.findLast(e=>e.primitive==='sample'&&e.targetId===f.id);
const receipt=f=>f.n.memory.experience.find(e=>e.id===sample(f).actionId);
function decisionFixture() {
  const f=fixture();
  bindOzarkWorldAgent(f.n,geometry,{...prepared.state,agents:[f.n]});
  Object.assign(f.n.physiology,{satietyHours:4,hoursSinceMeal:1,availableEnergyKcal:2000,
    waterDeficitMl:0,sleepPressure:10,fatigue:5,stamina:100});
  f.n.thermal.hot=f.n.thermal.cold=0;projectPhysiology(f.n);observeNpc(f.n,prepared.env);
  return f;
}
function optionalChoices(f) {
  let captured=null;
  discoveryDecision(f.n,{handlingCuriosity:false,chooseOptional:choices=>{
    captured=clone(choices);return choices.findIndex(c=>c.action.type==='inspect_object'&&c.action.targetId===f.id);
  }});
  assert.ok(captured,'ordinary optional candidate menu must be reached');
  return captured.map(c=>c.action);
}

// Explicit ledger-contract controls below add matched recognition rows to an
// actually paid sample. These are synthetic provenance tests, not bodily
// findings or learned-behavior claims.
function recognition(f,kind='sustained',sampleRow=sample(f)) {
  const at=f.n.elapsed+.1;
  const effect={id:`contract-feedback:${sampleRow.actionId}`,at,objectId:sampleRow.targetId,
    actionId:sampleRow.actionId,ingestionId:sampleRow.ingestionId,effect:kind,
    source:'experienced',hunger:'unchanged',thirst:'unchanged',energy:'unchanged',pain:'none'};
  if(kind==='sustained'){effect.hunger='easing';effect.energy='easing';}
  if(kind==='water relief')effect.thirst='easing';
  if(kind==='discomfort')effect.pain='aching';
  const event={id:f.n.memory.nextId++,at,type:'condition',details:{code:'DISCOVERY_EFFECT',feedback:clone(effect)}};
  effect.proofEventId=event.id;
  f.n.memory.experience.push(event);f.n.discovery.effects.push(effect);f.n.elapsed=at;
  return {effect,event};
}

test('a real paid partial sample supplies a pure, exact held-item retention reason',()=>{
  const f=fixture(),before=JSON.stringify(f.n),s=sample(f);
  assert.equal(prepared.sampled.code,'SWALLOWED');
  assert.equal(prepared.before.massGrams-lookupEcologyObject(prepared.env.ecology,f.id).massGrams,30);
  assert.ok(s.durationSeconds>0);assert.equal(s.ingestionId,prepared.sampled.ingestionId);
  assert.equal(retained(f),true);assert.equal(JSON.stringify(f.n),before);
  assert.equal(pendingSampleRetention(f.n,f.sourceId),false,'sampling a piece does not protect its source');
  assert.equal(pendingSampleRetention(f.n,'object:999999999'),false);
});

test('retention reads neither private physiology nor object knowledge',()=>{
  const f=fixture();
  delete f.n.discovery.observations;delete f.n.discovery.techniques;
  Object.defineProperty(f.n,'physiology',{get(){throw new Error('private physiology read');}});
  assert.equal(retained(f),true);
});

for(const [name,mutate] of [
  ['no held item',f=>{f.n.inventory.items=[];}],
  ['duplicated held identity',f=>{f.n.inventory.items.push(f.id);}],
  ['missing pending marker',f=>{delete f.n.discovery.samplesPending[f.id];}],
  ['pending marker without an experiment',f=>{f.n.discovery.experiments=[];}],
  ['evicted action receipt',f=>{const id=sample(f).actionId;f.n.memory.experience=f.n.memory.experience.filter(e=>e.id!==id);}],
  ['evicted sample experiment',f=>{f.n.discovery.experiments=f.n.discovery.experiments.filter(e=>e!==sample(f));}],
  ['future pending marker',f=>{f.n.discovery.samplesPending[f.id]=f.n.elapsed+1;}],
  ['negative pending marker',f=>{f.n.discovery.samplesPending[f.id]=-1;}],
  ['nonfinite pending marker',f=>{f.n.discovery.samplesPending[f.id]=NaN;}],
  ['mismatched pending timestamp',f=>{f.n.discovery.samplesPending[f.id]-=.1;}],
  ['future sample pair',f=>{sample(f).at=receipt(f).at=f.n.elapsed+1;f.n.discovery.samplesPending[f.id]=sample(f).at;}],
  ['failed sample',f=>{sample(f).ok=receipt(f).details.result.ok=false;}],
  ['impossible success code',f=>{sample(f).code=receipt(f).details.result.code='object_held';}],
  ['missing ingestion identity',f=>{delete receipt(f).details.result.ingestionId;delete sample(f).ingestionId;}],
  ['mismatched ingestion identity',f=>{receipt(f).details.result.ingestionId='ingestion:99999';}],
  ['mismatched target identity',f=>{receipt(f).details.action.targetId=f.sourceId;}],
  ['mismatched receipt time',f=>{receipt(f).at+=.01;}],
  ['duplicate sample',f=>{f.n.discovery.experiments.push(clone(sample(f)));}],
  ['duplicate action receipt',f=>{f.n.memory.experience.push(clone(receipt(f)));}],
  ['invalid duplicate ingestion experiment',f=>{f.n.discovery.experiments.push({...clone(sample(f)),id:9999,actionId:9999,code:'invalid'});}],
  ['invalid duplicate ingestion receipt',f=>{const r=clone(receipt(f));r.id=9999;r.details.action.targetId=f.sourceId;f.n.memory.experience.push(r);}],
  ['newer unlinked sample experiment',f=>{f.n.discovery.experiments.push({...clone(sample(f)),id:9999,actionId:9999,ingestionId:'ingestion:9999'});}],
  ['newer unlinked sample receipt',f=>{const r=clone(receipt(f));r.id=9999;r.details.result.ingestionId='ingestion:9999';f.n.memory.experience.push(r);}],
  ['newer undated sample row',f=>{f.n.discovery.experiments.push({primitive:'sample',targetId:f.id,ok:true});}],
  ['newer undated sample receipt',f=>{f.n.memory.experience.push({type:'action',details:{action:{type:'sample',targetId:f.id},result:{ok:true}}});}],
  ['zero paid work',f=>{sample(f).durationSeconds=receipt(f).details.result.durationSeconds=0;}],
  ['insufficient paid work',f=>{sample(f).durationSeconds=receipt(f).details.result.durationSeconds=1;}],
  ['excessive paid work',f=>{sample(f).durationSeconds=receipt(f).details.result.durationSeconds=99;}],
  ['mismatched paid work',f=>{receipt(f).details.result.durationSeconds=.1;}],
  ['finished material despite held claim',f=>{sample(f).finishedMaterial=receipt(f).details.result.finishedMaterial=true;}],
  ['unexpected sample material result',f=>{sample(f).materialId=receipt(f).details.result.materialId=f.id;}],
  ['invalid elapsed time',f=>{f.n.elapsed=Infinity;}],
  ['oversized experiment ledger',f=>{while(f.n.discovery.experiments.length<=DISCOVERY_RULES.maxExperiments)f.n.discovery.experiments.push({});}],
  ['oversized receipt ledger',f=>{while(f.n.memory.experience.length<=NPC_RULES.maxExperience)f.n.memory.experience.push({});}],
  ['oversized effect ledger',f=>{while(f.n.discovery.effects.length<=DISCOVERY_RULES.maxEffects)f.n.discovery.effects.push({});}],
])test(`pending retention requires provenance: ${name}`,()=>{const f=fixture();mutate(f);assert.equal(retained(f),false);});

test('the wait expires at the existing finite boundary, without clearing any pending evidence',()=>{
  const f=fixture(),at=f.n.discovery.samplesPending[f.id];
  f.n.elapsed=at+DISCOVERY_RULES.feedbackWaitSeconds-1e-6;assert.equal(retained(f),true);
  f.n.elapsed=at+DISCOVERY_RULES.feedbackWaitSeconds;assert.equal(retained(f),false);
  f.n.elapsed+=10000;assert.equal(retained(f),false);assert.equal(f.n.discovery.samplesPending[f.id],at);
});

for(const kind of ['sustained','water relief','discomfort','no noticeable change'])
  test(`valid recognized ${kind} ends the wait even if the marker remains`,()=>{
    const f=fixture();recognition(f,kind);assert.equal(retained(f),false);
  });

for(const [name,mutate] of [
  ['evicted recognition receipt',(f,r)=>{f.n.memory.experience=f.n.memory.experience.filter(e=>e!==r.event);}],
  ['future effect',(f,r)=>{r.effect.at=r.event.details.feedback.at=r.event.at=f.n.elapsed+1;}],
  ['future recognition',(f,r)=>{r.event.at=f.n.elapsed+1;}],
  ['effect before sample',(f,r)=>{r.effect.at=r.event.details.feedback.at=sample(f).at-1;}],
  ['foreign provenance',(_f,r)=>{r.effect.source=r.event.details.feedback.source='peer';}],
  ['mismatched effect ingestion',(_f,r)=>{r.effect.ingestionId='ingestion:99999';}],
  ['mismatched recognition',(_f,r)=>{r.event.details.feedback.energy='unchanged';}],
  ['duplicate effect',(f,r)=>{f.n.discovery.effects.push(clone(r.effect));}],
  ['duplicate recognition',(f,r)=>{f.n.memory.experience.push(clone(r.event));}],
])test(`invalid feedback cannot end an otherwise valid pending wait: ${name}`,()=>{
  const f=fixture(),r=recognition(f);mutate(f,r);assert.equal(retained(f),true);
});

test('older recognized feedback cannot end a newer personally sampled portion wait',()=>{
  const f=build(),first=sample(f);
  f.pay({type:'sample',targetId:f.id});
  recognition(f,'water relief',first);
  assert.notEqual(sample(f).ingestionId,first.ingestionId);assert.equal(retained(f),true);
});

test('an incomplete newer sample cannot revive an older stale marker',()=>{
  const f=build(),first=sample(f);
  f.pay({type:'sample',targetId:f.id});
  const newer=sample(f);
  f.n.discovery.samplesPending[f.id]=first.at;
  f.n.memory.experience=f.n.memory.experience.filter(e=>e.id!==newer.actionId);
  assert.equal(retained(f),false);
});

test('a later paid but cancelled sample does not erase the earlier pending portion',()=>{
  const f=build();
  assert.equal(requestNpcAction(f.n,{type:'sample',targetId:f.id},f.env).code,'ACTION_STARTED');
  f.tick();cancelNpcAction(f.n,'PRIORITY_CHANGED');
  assert.equal(f.n.lastResult.ok,false);assert.ok(f.n.lastResult.durationSeconds>0);
  assert.equal(retained(f),true);
});

test('the optional menu preserves only the exact pending item and still permits inspection',()=>{
  const f=decisionFixture(),actions=optionalChoices(f);
  assert.equal(retained(f),true);
  assert.ok(actions.some(a=>a.type==='inspect_object'&&a.targetId===f.id));
  for(const type of ['release','pull','strike'])
    assert.ok(!actions.some(a=>a.type===type&&a.targetId===f.id),type);
  for(const type of ['pull','strike'])
    assert.ok(actions.some(a=>a.type===type&&a.targetId===f.sourceId),`${type} on source stays eligible`);
  assert.ok(!actions.some(a=>a.type==='sample'&&a.targetId===f.id),'retention does not authorize another bite');
});

test('expired or evicted pending proof does not permanently remove optional manipulation',()=>{
  for(const mode of ['expired','evicted']) {
    const f=decisionFixture();
    if(mode==='expired')f.n.elapsed=f.n.discovery.samplesPending[f.id]+DISCOVERY_RULES.feedbackWaitSeconds;
    else {const id=sample(f).actionId;f.n.memory.experience=f.n.memory.experience.filter(r=>r.id!==id);}
    observeNpc(f.n,prepared.env);
    const actions=optionalChoices(f);
    for(const type of ['release','pull','strike'])
      assert.ok(actions.some(a=>a.type===type&&a.targetId===f.id),`${mode}: ${type}`);
  }
});

for(const [care,configure,expected] of [
  ['water',n=>{n.physiology.waterDeficitMl=4000;n.flask.water=.5;},'drink'],
  ['rest',n=>{n.physiology.stamina=8;n.physiology.fatigue=80;},'rest'],
  ['sleep',n=>{n.physiology.sleepPressure=95;},'sleep'],
])test(`pending retention leaves earlier ${care} care available`,()=>{
  const f=decisionFixture();configure(f.n);projectPhysiology(f.n);
  assert.equal(retained(f),true);
  let optional=false;
  const result=discoveryDecision(f.n,{chooseOptional:()=>{optional=true;return 0;}});
  assert.equal(result.action.type,expected);assert.equal(optional,false);
});

test('ordinary memory compaction retains the pending paid pair and direct release remains physically available',()=>{
  const f=build();
  for(let i=0;i<NPC_RULES.maxExperience+4;i++)recordEvent(f.n,'condition',{code:'RETENTION_PRESSURE_FIXTURE'});
  assert.ok(f.n.discovery.experiments.some(e=>e.primitive==='sample'&&e.targetId===f.id));
  assert.equal(retainedProofIntegrityError(f.n),null);
  assert.equal(retained(f),true);
  // Optional policy retention never becomes a physical action prohibition.
  assert.equal(f.pay({type:'release',targetId:f.id}).code,'object_released');
  assert.ok(!f.n.inventory.items.includes(f.id));
});

for(const hours of [9,20])test(`food seeking defers same-source reacquisition while its new held trial awaits feedback (${hours} hours appetite)`,()=>{
  const f=build();
  for(let i=0;i<1500&&!f.n.discovery.effects.some(e=>e.objectId===f.id&&e.effect==='sustained');i++)f.tick();
  assert.ok(f.n.discovery.techniques.some(t=>t.sourceId===f.sourceId));
  f.pay({type:'release',targetId:f.id});
  const next=f.pay({type:'pull',targetId:f.sourceId}).materialId;
  f.pay({type:'sample',targetId:next});
  Object.assign(f.n.physiology,{satietyHours:0,hoursSinceMeal:hours,availableEnergyKcal:2000,
    waterDeficitMl:0,sleepPressure:10,fatigue:5,stamina:100});
  f.n.thermal.hot=f.n.thermal.cold=0;projectPhysiology(f.n);observeNpc(f.n,f.env);
  assert.equal(bodySignals(f.n).hunger,hours===9?'hungry':'ravenous');
  assert.equal(pendingSampleRetention(f.n,next),true);
  const choice=discoveryDecision(f.n,{handlingCuriosity:false,chooseOptional:choices=>
    choices.findIndex(c=>c.action.type==='inspect_object'&&c.action.targetId===next)});
  assert.notDeepEqual(choice.action,{type:'pull',targetId:f.sourceId},
    'An unresolved retained trial must not start another learned acquisition of the same source');
  assert.equal(f.n.discovery.run,null);
  for(let i=0;i<1500&&!f.n.discovery.effects.some(e=>e.objectId===next&&e.effect==='sustained');i++)f.tick();
  assert.ok(f.n.discovery.effects.some(e=>e.objectId===next&&e.effect==='sustained'));
  Object.assign(f.n.physiology,{satietyHours:0,hoursSinceMeal:hours});projectPhysiology(f.n);observeNpc(f.n,f.env);
  assert.deepEqual(discoveryDecision(f.n).action,{type:'sample',targetId:next},
    'Actual feedback reopens use of the held item rather than deadlocking food care');
});

test('urgent hunger can reacquire after finishing a repeatedly supported material even while its final portion is pending',()=>{
  const f=build();
  const positives=()=>new Set(f.n.discovery.effects.filter(e=>e.objectId===f.id&&e.effect==='sustained').map(e=>e.ingestionId)).size;
  for(let i=0;i<1500&&positives()<1;i++)f.tick();
  f.pay({type:'sample',targetId:f.id});
  for(let i=0;i<1500&&positives()<2;i++)f.tick();
  assert.equal(positives(),2);
  for(let i=0;i<10&&f.n.inventory.items.includes(f.id);i++)f.pay({type:'sample',targetId:f.id});
  assert.equal(f.n.inventory.items.includes(f.id),false);
  assert.ok(f.n.discovery.samplesPending[f.id]>0);
  Object.assign(f.n.physiology,{satietyHours:0,hoursSinceMeal:20,availableEnergyKcal:2000,
    waterDeficitMl:0,sleepPressure:10,fatigue:5,stamina:100});
  f.n.thermal.hot=f.n.thermal.cold=0;projectPhysiology(f.n);observeNpc(f.n,f.env);
  assert.deepEqual(discoveryDecision(f.n).action,{type:'pull',targetId:f.sourceId});
});
