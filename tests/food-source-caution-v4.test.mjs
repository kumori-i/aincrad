import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpc } from '../src/npc-state.js';
import { createEnvironment,tickEnvironment } from '../src/environment.js';
import { tickEcology,lookupEcologyObject,interactEcologyObject } from '../src/ecology.js';
import { requestNpcAction,tickNpc,observeNpc } from '../src/npc.js';
import { projectPhysiology } from '../src/biology.js';
import { processDiscoveryFeedback,discoveryDecision } from '../src/discovery.js';
import { recordEvent } from '../src/npc-memory.js';
import { createCommunity,SocialCoordinator } from '../src/social.js';
import { extractionOriginError,ownExtractionOrigins,experiencedFoodSourceCaution } from '../src/food-source-caution.js';

const STEP=1/60, copy=structuredClone;
function fixture(){
  const n=createNpc({id:'aster',mode:'discovery',seed:74193}),peer=createNpc({id:'mira',mode:'discovery',seed:74203}),e=createEnvironment(74193,{mode:'discovery'});
  const animal=e.ecology.animals[0];n.position={...animal.position};peer.position={...n.position};
  n.physiology.availableEnergyKcal=700;n.physiology.hoursSinceMeal=12;n.physiology.satietyHours=0;projectPhysiology(n);
  // Explicit finite fixture assistance, NOT paid hunting or autonomous survival.
  let source;for(let i=0;i<4;i++){const r=interactEcologyObject(e.ecology,animal.id,'strike',{actorId:n.id,position:n.position,power:4});if(r.resultObjectId)source=lookupEcologyObject(e.ecology,r.resultObjectId);}
  assert.equal(source.kind,'carcass');source.ageHours=72;source.spoiled=true;
  for(const actor of[n,peer])observeNpc(actor,e);
  const community=createCommunity(),social=new SocialCoordinator({getAgents:()=>[n,peer],getCommunity:()=>community,getEnvironment:()=>e});
  return {n,peer,e,source,social};
}
function tick(f){tickEnvironment(f.e,STEP);tickEcology(f.e.ecology,STEP,f.e,[f.n,f.peer]);for(const n of[f.n,f.peer]){
  tickNpc(n,STEP,f.e);processDiscoveryFeedback(n,{recordEffect:effect=>recordEvent(n,'condition',{code:'DISCOVERY_EFFECT',feedback:effect})});}}
function act(f,action,n=f.n){assert.equal(requestNpcAction(n,action,f.e).code,'ACTION_STARTED');for(let i=0;i<1800&&n.active;i++)tick(f);assert.equal(n.active,null);assert.equal(n.lastResult.ok,true);return n.lastResult;}
function until(f,predicate){for(let i=0;i<24000&&!predicate();i++)tick(f);assert.ok(predicate());}
const discomfort=f=>f.n.discovery.effects.some(e=>e.objectId===f.a&&e.effect==='discomfort');
function twoPieces(){const f=fixture();act(f,{type:'pull',targetId:f.source.id});f.a=f.n.inventory.items[0];
  for(let count=1;count<=2;count++){act(f,{type:'sample',targetId:f.a});until(f,()=>new Set(f.n.discovery.effects.filter(e=>e.objectId===f.a&&e.effect==='sustained').map(e=>e.ingestionId)).size>=count);}
  assert.equal(discomfort(f),false);while(f.n.inventory.items.includes(f.a))act(f,{type:'sample',targetId:f.a});
  act(f,{type:'pull',targetId:f.source.id});f.b=f.n.inventory.items[0];assert.equal(discomfort(f),false);
  until(f,()=>discomfort(f));return f;
}
let earned;
function evidence(){if(!earned){const f=twoPieces();earned={n:copy(f.n),a:f.a,b:f.b,sourceId:f.source.id};f.social.dispose();}return copy(earned);}
const caution=f=>experiencedFoodSourceCaution(f.n,f.b);

test('actual paid two-piece delayed harm cautions the held successor without erasing physical inputs',()=>{
  const f=evidence(),before=JSON.stringify(f.n);assert.equal(extractionOriginError(f.n),null);assert.equal(caution(f),true);
  assert.equal(JSON.stringify(f.n),before,'query is pure');assert.ok(ownExtractionOrigins(f.n).some(e=>e.materialId===f.b));
  for(const foodLearning of[true,false])for(let i=0;i<12;i++){const decision=discoveryDecision(f.n,{foodLearning});assert.ok(!(decision.action?.type==='sample'&&decision.action.targetId===f.b));}
});

test('retained origin survives actual release/regrasp and consented handover-back, never copying donor knowledge',()=>{
  const f=twoPieces();assert.equal(caution(f),true);act(f,{type:'release',targetId:f.b});assert.equal(caution(f),false);
  act(f,{type:'grasp',targetId:f.b});assert.equal(caution(f),true);
  const handover=(from,to)=>{const offer=f.social.action(from,{type:'offer_food',targetId:to.id,objectId:f.b});assert.equal(offer.code,'FOOD_OFFERED');assert.equal(f.social.action(to,{type:'accept_food',offerId:offer.offerId}).code,'ACTION_STARTED');until(f,()=>!to.active);assert.ok(to.inventory.items.includes(f.b));};
  handover(f.n,f.peer);assert.equal(experiencedFoodSourceCaution(f.peer,f.b),false);assert.equal(caution(f),false);
  handover(f.peer,f.n);assert.equal(caution(f),true);
  const firstHarm=f.n.discovery.effects.find(e=>e.objectId===f.a&&e.effect==='discomfort').at;
  until(f,()=>f.n.discovery.effects.some(e=>e.objectId===f.a&&e.effect==='sustained'&&e.at>firstHarm));
  assert.equal(caution(f),true,'actual later positive feedback cannot erase earlier recognized harm');f.social.dispose();
});

for(const [name,mutate] of[
  ['missing original condition',f=>{const x=f.n.discovery.effects.find(e=>e.objectId===f.a&&e.effect==='discomfort');f.n.memory.experience=f.n.memory.experience.filter(r=>r.id!==x.proofEventId);}],
  ['missing harmful sample receipt',f=>{const x=f.n.discovery.effects.find(e=>e.objectId===f.a&&e.effect==='discomfort');f.n.memory.experience=f.n.memory.experience.filter(r=>r.id!==x.actionId);}],
  ['borrowed effect',f=>{for(const x of f.n.discovery.effects)x.source='peer';}],
  ['duplicate effect',f=>{const x=f.n.discovery.effects.find(e=>e.effect==='discomfort');f.n.discovery.effects.push(copy(x));}],
  ['generic revision alone',f=>{f.n.discovery.effects=[];f.n.discovery.techniques.push({sourceId:f.sourceId,confidence:'revised'});}],
  ['missing successor origin',f=>{const origin=ownExtractionOrigins(f.n).find(e=>e.materialId===f.b);f.n.discovery.experiments=f.n.discovery.experiments.filter(e=>e!==origin);}],
  ['transformed identity',f=>{f.n.inventory.items=f.n.inventory.items.map(id=>id===f.b?'object:999999':id);f.b='object:999999';}],
  ['other source',f=>{const origin=ownExtractionOrigins(f.n).find(e=>e.materialId===f.b);origin.targetId='object:999999';f.n.memory.experience.find(r=>r.id===origin.actionId).details.action.targetId=origin.targetId;}],
])test(`no source conclusion from ${name}`,()=>{const f=evidence();mutate(f);assert.equal(caution(f),false);});

test('effect array ordering cannot erase retained adverse evidence',()=>{const f=evidence();f.n.discovery.effects.reverse();assert.equal(caution(f),true);});

test('ambiguous own extraction cannot become unique by filtering an orphan claim',()=>{
  const f=evidence(),origin=ownExtractionOrigins(f.n).find(e=>e.materialId===f.b),r=copy(f.n.memory.experience.find(e=>e.id===origin.actionId));
  r.id=f.n.memory.nextId++;f.n.memory.experience.push(r);
  assert.equal(extractionOriginError(f.n),'ambiguous-extraction-origin');assert.deepEqual(ownExtractionOrigins(f.n),[]);assert.equal(caution(f),false);
  r.details.action.targetId='object:999999';assert.equal(extractionOriginError(f.n),'ambiguous-extraction-origin');
});

test('single orphan is not origin authority; paired extraction counts once',()=>{
  const f=evidence();assert.equal(extractionOriginError(f.n),null);const origin=ownExtractionOrigins(f.n).find(e=>e.materialId===f.b);
  f.n.discovery.experiments=f.n.discovery.experiments.filter(e=>e!==origin);assert.equal(extractionOriginError(f.n),null);assert.equal(caution(f),false);
});

test('harm after actual regrasp is not attributed to the old source, including after receipt rotation',()=>{
  const f=fixture();act(f,{type:'pull',targetId:f.source.id});f.a=f.n.inventory.items[0];act(f,{type:'release',targetId:f.a});act(f,{type:'grasp',targetId:f.a});
  const grasp=f.n.discovery.experiments.at(-1);act(f,{type:'sample',targetId:f.a});act(f,{type:'pull',targetId:f.source.id});f.b=f.n.inventory.items.find(id=>id!==f.a);until(f,()=>discomfort(f));
  assert.equal(caution(f),false);
  for(const corruption of['failed','wrong-target']){
    const changed=copy({n:f.n,b:f.b}),r=changed.n.memory.experience.find(e=>e.id===grasp.actionId);
    if(corruption==='failed')r.details.result.ok=false;else r.details.action.targetId='object:999999';
    assert.equal(caution(changed),false,`newer ${corruption} receipt cannot resurrect the old pull`);
  }
  f.n.discovery.experiments=f.n.discovery.experiments.filter(e=>e.actionId!==grasp.actionId);assert.equal(caution(f),false,'receipt survives but matching experiment gone');
  f.n.memory.experience=f.n.memory.experience.filter(e=>e.id!==grasp.actionId);assert.equal(caution(f),false,'gap blocks resurrection of old extraction');f.social.dispose();
});

test('duplicate, missing, future or out-of-order memory interval entries cannot grant attribution',()=>{
  const base=evidence(),effect=base.n.discovery.effects.find(e=>e.objectId===base.a&&e.effect==='discomfort'),sample=base.n.discovery.experiments.find(e=>e.actionId===effect.actionId),origin=ownExtractionOrigins(base.n).find(e=>e.materialId===base.a);
  const middle=base.n.memory.experience.find(r=>r.id>origin.actionId&&r.id<sample.actionId);
  for(const kind of['duplicate','missing','future','backwards']){const f=copy(base),r=f.n.memory.experience.find(r=>r.id===(middle?.id||sample.actionId));
    if(kind==='duplicate')f.n.memory.experience.push(copy(r));if(kind==='missing')f.n.memory.experience=f.n.memory.experience.filter(e=>e!==r);
    if(kind==='future')r.at=f.n.elapsed+1;if(kind==='backwards')r.at=-1;
    assert.equal(caution(f),false,kind);
  }
});
