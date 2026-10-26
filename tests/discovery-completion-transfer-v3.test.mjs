import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpc } from '../src/npc-state.js';
import { createEnvironment,tickEnvironment } from '../src/environment.js';
import { tickEcology,lookupEcologyObject } from '../src/ecology.js';
import { requestNpcAction,tickNpc,observeNpc } from '../src/npc.js';
import { canStand } from '../src/world.js';
import { projectPhysiology } from '../src/biology.js';
import { processDiscoveryFeedback,discoveryDecision } from '../src/discovery.js';
import { recordEvent } from '../src/npc-memory.js';
import { createCommunity,SocialCoordinator } from '../src/social.js';
import { witnessedMaterialCompletion } from '../src/discovery-completion.js';

function fixture(){
  const n=createNpc({id:'aster',mode:'discovery',seed:74193}),peer=createNpc({id:'mira',mode:'discovery',seed:74203}),e=createEnvironment(74193,{mode:'discovery'}),source=e.ecology.plants.find(p=>p.kind==='apple_tree'&&p.quantity>0);
  n.position=[{x:source.position.x+45,y:source.position.y},{x:source.position.x-45,y:source.position.y}].find(p=>canStand(p.x,p.y,'valley'));peer.position={...n.position};
  n.physiology.availableEnergyKcal=700;n.physiology.hoursSinceMeal=12;n.physiology.satietyHours=0;projectPhysiology(n);
  for(const actor of[n,peer])observeNpc(actor,e);
  const community=createCommunity(),social=new SocialCoordinator({getAgents:()=>[n,peer],getCommunity:()=>community,getEnvironment:()=>e});return{n,peer,e,source,social};
}
function tick(f,seconds=1/60){for(let i=0;i<Math.ceil(seconds*60);i++){
  tickEnvironment(f.e,1/60);tickEcology(f.e.ecology,1/60,f.e,[f.n,f.peer]);
  for(const n of[f.n,f.peer]){tickNpc(n,1/60,f.e);processDiscoveryFeedback(n,{recordEffect:effect=>recordEvent(n,'condition',{code:'DISCOVERY_EFFECT',feedback:effect})});}
}}
function act(f,n,action){assert.equal(requestNpcAction(n,action,f.e).code,'ACTION_STARTED');for(let i=0;i<1200&&n.active;i++)tick(f);assert.equal(n.active,null);assert.equal(n.lastResult.ok,true);return n.lastResult;}
function supported(){const f=fixture();act(f,f.n,{type:'pull',targetId:f.source.id});f.id=f.n.inventory.items[0];for(let count=1;count<=2;count++){
  act(f,f.n,{type:'sample',targetId:f.id});for(let i=0;i<24000&&new Set(f.n.discovery.effects.filter(e=>e.objectId===f.id&&e.effect==='sustained').map(e=>e.ingestionId)).size<count;i++)tick(f);
}return f;}
const carePull=(f,decision)=>decision.need==='food'&&decision.action.type==='pull'&&decision.action.targetId===f.source.id;

test('actual consented paid handover of a supported partial piece is not a consumed-piece witness',()=>{
  const f=supported();act(f,f.n,{type:'sample',targetId:f.id});
  const last=f.n.discovery.experiments.at(-1),piece=lookupEcologyObject(f.e.ecology,f.id),mass=piece.massGrams,kcal=piece.energyKcal,ingested=f.n.physiology.totals.ingestedKcal;
  const offer=f.social.action(f.n,{type:'offer_food',targetId:f.peer.id,objectId:f.id});assert.equal(offer.code,'FOOD_OFFERED');
  assert.equal(f.social.action(f.peer,{type:'accept_food',offerId:offer.offerId}).code,'ACTION_STARTED');
  for(let i=0;i<1200&&f.peer.active;i++)tick(f);
  assert.equal(f.peer.active,null);assert.equal(piece.heldBy,f.peer.id);assert.ok(f.peer.inventory.items.includes(f.id));assert.ok(!f.n.inventory.items.includes(f.id));
  assert.equal(piece.massGrams,mass);assert.equal(piece.energyKcal,kcal);assert.equal(f.n.physiology.totals.ingestedKcal,ingested);
  assert.equal(last.finishedMaterial,undefined);assert.equal(witnessedMaterialCompletion(f.n,last),false);
  assert.equal(carePull(f,discoveryDecision(f.n)),false);assert.equal(f.peer.discovery.effects.length,0);
  f.social.dispose();
});

test('actual ecology decay of a disclosed near-terminal remnant cannot manufacture a finish receipt',()=>{
  const f=supported();act(f,f.n,{type:'sample',targetId:f.id});const last=f.n.discovery.experiments.at(-1),piece=lookupEcologyObject(f.e.ecology,f.id);
  // Explicit near-retirement physical fixture to bound this unit's runtime, NOT
  // ordinary feeding evidence. Removed setup matter is put into detritus; no
  // actor receives it, and all subsequent retirement uses ordinary ecology.
  const terminalMass=.10000001,ratio=terminalMass/piece.massGrams;
  const removedMass=piece.massGrams-terminalMass,removedEnergy=piece.energyKcal*(1-ratio);
  f.e.ecology.detritus.massGrams+=removedMass;f.e.ecology.detritus.energyKcal+=removedEnergy;
  piece.massGrams=terminalMass;piece.energyKcal*=ratio;piece.waterMl*=ratio;piece.ageHours=12*24;piece.spoiled=true;
  const before=f.n.physiology.totals.ingestedKcal;
  tick(f,1);assert.equal(lookupEcologyObject(f.e.ecology,f.id),null);
  act(f,f.n,{type:'inspect_object',targetId:f.source.id});assert.ok(!f.n.inventory.items.includes(f.id));
  assert.equal(f.n.physiology.totals.ingestedKcal,before);assert.equal(last.finishedMaterial,undefined);
  assert.equal(witnessedMaterialCompletion(f.n,last),false);assert.equal(carePull(f,discoveryDecision(f.n)),false);
  f.social.dispose();
});
