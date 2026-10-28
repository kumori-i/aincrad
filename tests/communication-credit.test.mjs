import test from 'node:test';
import assert from 'node:assert/strict';
import {createNpc} from '../src/npc-state.js';
import {createEnvironment} from '../src/environment.js';
import {requestNpcAction,tickNpc,observeNpc} from '../src/npc.js';
import {canStand} from '../src/world.js';
import {processDiscoveryFeedback} from '../src/discovery.js';
import {recordEvent} from '../src/npc-memory.js';
import {canonicalCommunicationEffect,createCommunicationCredit,pollCommunicationCredit} from '../src/communication-credit.js';

function fixture(){
  const n=createNpc({mode:'discovery',seed:74193}),e=createEnvironment(74193,{mode:'discovery'});
  const plant=e.ecology.plants.find(p=>p.kind==='apple_tree'&&p.quantity>0);
  n.position=[{x:plant.position.x+45,y:plant.position.y},{x:plant.position.x-45,y:plant.position.y}].find(p=>canStand(p.x,p.y,'valley'));
  assert.ok(n.position);observeNpc(n,e);return {n,e,plant};
}
function tick(f,p){tickNpc(f.n,1/60,f.e);processDiscoveryFeedback(f.n,{recordEffect:effect=>recordEvent(f.n,'condition',{code:'DISCOVERY_EFFECT',feedback:effect})});return p?pollCommunicationCredit(p):null;}
function start(f,type,targetId,horizon=60){const action={type,targetId};assert.equal(requestNpcAction(f.n,action,f.e).code,'ACTION_STARTED');const p=createCommunicationCredit(f.n,action,f.n.active,f.n.memory.nextId,horizon);assert.ok(p);return p;}
function finish(f,p){let result;for(let i=0;i<1200&&f.n.active;i++)result=tick(f,p)||result;assert.equal(f.n.active,null);assert.equal(f.n.lastResult.ok,true);return result;}
function prepared(){const f=fixture();const p=start(f,'pull',f.plant.id);finish(f);return {...f,material:f.n.inventory.items[0],pull:p};}
function settled(f,p){let result;for(let i=0;i<4000&&!p.settled;i++)result=tick(f,p)||result;assert.ok(result);return result;}
function sampleFixture(){const f=prepared(),p=start(f,'sample',f.material);finish(f,p);return {f,p};}
function effectFor(n,sample,kind='sustained',at=n.elapsed){
  const effect={id:`test:${n.memory.nextId}`,at,objectId:sample.targetId,actionId:sample.actionId,ingestionId:sample.ingestionId,effect:kind,source:'experienced'};
  const proof=recordEvent(n,'condition',{code:'DISCOVERY_EFFECT',feedback:{...effect}});effect.proofEventId=proof.id;n.discovery.effects.push(effect);return effect;
}

test('actual paid sample and delayed physiology receipt yield canonical bounded credit',()=>{
  const {f,p}=sampleFixture();assert.equal(p.settled,false,'completion must not be censored by losing the last work slice');
  const result=settled(f,p);assert.equal(result.status,'attributed');assert.ok(result.reward>0&&result.reward<1);assert.ok(result.cost>0);assert.ok(result.paidSeconds>0);
  const effect=f.n.discovery.effects.find(e=>e.ingestionId===result.ingestion.ingestionId);assert.equal(canonicalCommunicationEffect(f.n,effect),true);
  assert.equal(pollCommunicationCredit(p),null,'settles once');
});

test('canonical receipt rejects copied foreign, hearsay and altered links',()=>{
  const {f,p}=sampleFixture();settled(f,p);const effect=f.n.discovery.effects[0];assert.ok(effect);
  assert.equal(canonicalCommunicationEffect(f.n,{...effect}),false);assert.equal(canonicalCommunicationEffect(fixture().n,effect),false);
  for(const mutate of [e=>e.source='heard',e=>e.actionId+=999,e=>e.ingestionId='wrong',e=>e.objectId='object:999999',e=>e.proofEventId+=999,e=>e.at+=1,e=>e.effect='discomfort',e=>e.hunger='forged',e=>e.thirst='forged',e=>e.energy='forged',e=>e.pain='forged',e=>e.at=Infinity]){
    const backup={...effect};mutate(effect);assert.equal(canonicalCommunicationEffect(f.n,effect),false);Object.assign(effect,backup);
  }
  const receipt=f.n.memory.experience.find(e=>e.id===effect.actionId);const at=receipt.at;receipt.at+=1;assert.equal(canonicalCommunicationEffect(f.n,effect),false,'action timestamp must match sample');receipt.at=at;
});

test('discomfort dominates early benefit and only settles at the horizon',()=>{
  const {f,p}=sampleFixture();const sample=f.n.discovery.experiments.find(e=>e.actionId===p.selected?.actionId);assert.ok(sample);
  effectFor(f.n,sample,'sustained');assert.equal(pollCommunicationCredit(p),null);
  effectFor(f.n,sample,'discomfort');assert.equal(pollCommunicationCredit(p),null);
  const result=settled(f,p);assert.equal(result.benefit,-1);assert.equal(result.reward,-1);
});

test('inspection with no ingestion expires with cost, unrelated bodily outcomes are not credit',()=>{
  const f=prepared(),p=start(f,'inspect_object',f.material);finish(f,p);
  const other=start(f,'sample',f.material);finish(f);const result=settled(f,p);
  assert.equal(result.status,'expired');assert.equal(result.attributedEffects,0);assert.equal(result.ingestion,null);assert.equal(result.reward,-result.cost);assert.ok(result.cost>0);pollCommunicationCredit(other,{stop:true});
});

test('epoch, physiology, discovery, death and explicit stop censor rather than punish',()=>{
  for(const change of [n=>n.epoch++,n=>n.physiology={...n.physiology},n=>n.discovery={...n.discovery},n=>n.lifecycle='DEAD',null]){
    const f=fixture(),p=start(f,'pull',f.plant.id);tick(f,p);change?.(f.n);const r=pollCommunicationCredit(p,{stop:change===null});
    assert.equal(r.status,'interrupted');assert.equal(r.reward,null);assert.equal(pollCommunicationCredit(p),null);
  }
});

test('acquisition credits exact acquired material and only its first subsequent sample',()=>{
  const f=fixture(),p=start(f,'pull',f.plant.id);finish(f,p);const material=f.n.inventory.items[0];
  start(f,'sample',material);finish(f,p);const first=p.ingestion;assert.ok(first);
  start(f,'sample',material);finish(f,p);const second=f.n.discovery.experiments.filter(e=>e.primitive==='sample').at(-1);
  effectFor(f.n,second,'discomfort');assert.equal(pollCommunicationCredit(p),null);assert.deepEqual(p.ingestion,first);
  const result=settled(f,p);assert.ok(result.reward>0,'later sample discomfort must not be attributed');assert.equal(result.ingestion.objectId,material);assert.notEqual(material,f.plant.id);
});

test('old and out-of-horizon effects never earn reward',()=>{
  const {f,p}=sampleFixture();const sample=f.n.discovery.experiments.find(e=>e.actionId===p.selected?.actionId);assert.ok(sample);
  effectFor(f.n,sample,'discomfort',p.deadline+1);effectFor(f.n,sample,'discomfort',p.at-1);
  const result=settled(f,p);assert.ok(result.reward>0);
});

test('copied active commands and unrelated receipts cannot impersonate paid completion',()=>{
  const f=prepared(),action={type:'sample',targetId:f.material};
  assert.equal(requestNpcAction(f.n,action,f.e).code,'ACTION_STARTED');
  const real=f.n.active,copy={...real,request:{...real.request}};
  f.n.active=copy;const p=createCommunicationCredit(f.n,action,copy,f.n.memory.nextId);assert.ok(p);
  f.n.active=real;finish(f);const r=pollCommunicationCredit(p);assert.equal(r.status,'interrupted');assert.equal(r.reward,null);
});

test('material receipt mutation and same-type later actions cannot stand in for selected completion',()=>{
  for(const mutate of [e=>e.materialId='object:999999',e=>e.actionId+=999]){
    const f=fixture(),p=start(f,'pull',f.plant.id);finish(f);const acquired=f.n.discovery.experiments.at(-1);mutate(acquired);
    const r=pollCommunicationCredit(p);assert.equal(r.status,'interrupted');assert.equal(r.reward,null);
  }
  const f=prepared(),p=start(f,'inspect_object',f.material);finish(f);f.n.discovery.experiments=f.n.discovery.experiments.filter(e=>e.primitive!=='inspect_object');
  start(f,'inspect_object',f.material);finish(f);const r=pollCommunicationCredit(p);assert.equal(r.status,'interrupted');
});

test('foreign material samples do not become acquisition reward',()=>{
  const f=fixture(),p=start(f,'pull',f.plant.id);finish(f,p);const chosen=f.n.inventory.items[0];
  start(f,'pull',f.plant.id);finish(f,p);const other=f.n.inventory.items.find(id=>id!==chosen);assert.ok(other);
  start(f,'sample',other);finish(f,p);const result=settled(f,p);
  assert.equal(result.ingestion,null);assert.equal(result.status,'expired');assert.equal(result.reward,-result.cost);
});

test('forged public work counters cannot increase authoritative action cost',()=>{
  const f=fixture(),p=start(f,'pull',f.plant.id);tick(f,p);const before=p.paidSeconds;
  p.active.worked=999;p.active.seconds=999;
  pollCommunicationCredit(p);assert.equal(p.paidSeconds,before);
  const r=pollCommunicationCredit(p,{stop:true});assert.equal(r.reward,null);assert.equal(r.paidSeconds,before);
});
