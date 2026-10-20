import test from 'node:test';
import assert from 'node:assert/strict';
import {fishingFixture,bankFor,distance} from './fixtures/finite-fishing.mjs';
import {captureEcologyFish,preflightEcologyFishCapture,interactEcologyObject,consumeEcologyMaterial,ecologyEnergy,lookupEcologyObject,senseEcology} from '../src/ecology.js';
import {aquaticStockAudit} from '../src/aquatic-state.js';
import {ECOLOGY_RULES} from '../src/ecology-config.js';
import {requestNpcAction,observeNpc,cancelNpcAction} from '../src/npc.js';
const options=f=>({actorId:f.actor.id,position:f.actor.position,scene:'valley',aim:{...f.fish.position},inventory:f.actor.inventory.items});
const energyError=e=>ecologyEnergy(e)+e.ledger.humanRemovedKcal+e.ledger.metabolizedKcal+e.ledger.decomposedKcal+e.ledger.discardedKcal-e.ledger.initialKcal-e.ledger.photosynthesisKcal-e.ledger.externalKcal;
function audit(e){assert.ok(Math.abs(energyError(e))<1e-5);for(const [key,value]of Object.entries(aquaticStockAudit(e)))if(/Error/.test(key))assert.ok(Math.abs(value)<1e-6,`${key}: ${value}`);}
function directCatch(f){const r=captureEcologyFish(f.e,f.fish.id,options(f));assert.equal(r.ok,true,JSON.stringify(r));return lookupEcologyObject(f.e,f.fish.id);}

test('direct transaction fixture: same-ID exact capture/pull/ingestion and residue have no stock creation',()=>{
 const f=fishingFixture(),before=ecologyEnergy(f.e),id=f.fish.id,next=f.e.nextId,compartments=structuredClone(f.fish),m=directCatch(f);
 assert.equal(m.id,id);assert.equal(f.e.nextId,next);assert.equal(f.e.aquatic.fish.some(x=>x.id===id),false);assert.deepEqual(f.actor.inventory.items,[id]);
 assert.equal(m.massGrams,compartments.tissue.massGrams+compartments.residue.massGrams+compartments.reserve.massGrams);assert.equal(ecologyEnergy(f.e),before);audit(f.e);
 assert.equal(captureEcologyFish(f.e,id,options(f)).ok,false);
 const whole=consumeEcologyMaterial(f.e,id,1,{actorId:'aster'});assert.equal(whole.ok,false);
 const pulled=interactEcologyObject(f.e,id,'pull',{...options(f),inventory:f.actor.inventory.items});assert.equal(pulled.ok,true,JSON.stringify(pulled));f.actor.inventory.items.push(pulled.materialId);
 const tissue=lookupEcologyObject(f.e,pulled.materialId);assert.equal(tissue.massGrams,80);assert.equal(tissue.energyKcal,80);assert.equal(tissue.waterMl,56);assert.equal(m.massGrams,120);assert.equal(m.fishTissue.massGrams,0);assert.notEqual(tissue.id,id);audit(f.e);
 assert.equal(interactEcologyObject(f.e,id,'pull',options(f)).ok,false);
 assert.equal(senseEcology(f.e,f.actor.position).some(x=>x.id===id),false);
 const bytes=JSON.stringify(tissue);assert.equal(consumeEcologyMaterial(f.e,tissue.id,.375,{actorId:'aster',accept:()=>({ok:false,code:'TOO_FULL'})}).ok,false);assert.equal(JSON.stringify(tissue),bytes);audit(f.e);
 for(const grams of [30,30,20]){const r=consumeEcologyMaterial(f.e,tissue.id,Math.min(1,grams/tissue.massGrams),{actorId:'aster',accept:()=>({ok:true})});assert.equal(r.ok,true);audit(f.e);}
 assert.equal(lookupEcologyObject(f.e,tissue.id),null);assert.equal(m.massGrams,120);assert.equal(f.e.aquatic.ledger.humanIngestedMassGrams,80);
});

test('direct transaction fixture: full material/hands, competition, forbidden ownership and interception fail atomically',()=>{
 for(const failure of ['materials','hands','aim','wet','other']){
  const f=fishingFixture();if(failure==='materials')while(f.e.materials.length<ECOLOGY_RULES.maxMaterials)f.e.materials.push({id:`fixture:${f.e.materials.length}`,scene:'valley',position:{...f.actor.position}});
  if(failure==='hands')f.actor.inventory.items=['object:999990','object:999991','object:999992','object:999993'];
  const o=options(f);if(failure==='aim')o.aim.x+=100;if(failure==='wet')o.position={...f.fish.position};if(failure==='other')o.actorId='other';
  const before=JSON.stringify(f.e),inventory=JSON.stringify(f.actor.inventory);assert.equal(captureEcologyFish(f.e,f.fish.id,o).ok,false,failure);assert.equal(JSON.stringify(f.e),before,failure);assert.equal(JSON.stringify(f.actor.inventory),inventory,failure);
 }
 const f=fishingFixture(),m=directCatch(f);for(const verb of ['grasp','pull','release'])assert.equal(interactEcologyObject(f.e,m.id,verb,{actorId:'mira',position:f.actor.position,inventory:[]}).ok,false);
 assert.equal(consumeEcologyMaterial(f.e,m.id,.1,{actorId:'mira'}).ok,false);
 const full=Array.from({length:4},(_,i)=>`object:${990000+i}`),before=JSON.stringify(f.e);assert.equal(interactEcologyObject(f.e,m.id,'pull',{actorId:'aster',position:f.actor.position,inventory:full}).ok,false);assert.equal(JSON.stringify(f.e),before);
 while(f.e.materials.length<ECOLOGY_RULES.maxMaterials)f.e.materials.push({id:`fixture:${f.e.materials.length}`,scene:'valley',position:{...f.actor.position}});const filled=JSON.stringify(f.e);assert.equal(interactEcologyObject(f.e,m.id,'pull',options(f)).ok,false);assert.equal(JSON.stringify(f.e),filled);
});

// Regression fixture selected by a recorded physical-only0..120s motion screen.
// Initial32 t=0 attempts ALL missed (retained in external evidence). At native
// time24s object715 naturally turns back within12px. No motion is altered;
// actor placement is explicit fixture exposure, not learned travel or aim.
test('native timed catch produces a real moving-target success and paid moving-target miss without freezing',()=>{
 const negative=fishingFixture(),miss=negative.action('catch');
 assert.equal(miss.result.code,'fish_missed');assert.ok(distance(miss.before.position,miss.after.position)>12);assert.ok(miss.after.metabolizedKcal>miss.before.metabolizedKcal);audit(negative.e);
 const encounter=fishingFixture({index:16});encounter.tick(24);encounter.actor.position=bankFor(encounter.geometry,encounter.fish.position);encounter.state.player={...encounter.actor.position};
 const row=encounter.action('catch');assert.equal(row.result.ok,true,JSON.stringify(row));assert.ok(distance(row.before.position,row.after.position)>0);assert.ok(row.after.metabolizedKcal>row.before.metabolizedKcal);audit(encounter.e);
 const positive={f:encounter,row};
 const f=positive.f,id=f.fish.id,whole=f.action('sample',id);assert.equal(whole.result.ok,false);
 const pull=f.action('pull',id);assert.equal(pull.result.ok,true,JSON.stringify(pull));const tissueId=pull.result.materialId;
 const sample=f.action('sample',tissueId);assert.equal(sample.result.ok,true,JSON.stringify(sample));assert.equal(f.actor.discovery.techniques.length,0,'sampling completion alone is not nourishing proof');
 f.tick(180);assert.ok(f.actor.discovery.effects.some(e=>e.objectId===tissueId));
 assert.ok(f.actor.discovery.techniques.some(t=>t.sourceId===id&&t.steps.map(x=>x.type).join(',')==='pull,sample'));
 assert.ok(f.actor.discovery.techniques.every(t=>!t.steps.some(x=>x.type==='catch')));audit(f.e);
});

test('native catch revalidates hand capacity after paid work and interrupted commands cannot complete',()=>{
 const f=fishingFixture();observeNpc(f.actor,f.state.environment);assert.equal(requestNpcAction(f.actor,{type:'catch',targetId:f.fish.id},f.state.environment).ok,true);const start=f.actor.physiology.totals.metabolizedKcal;f.actor.inventory.items=['object:999990','object:999991','object:999992','object:999993'];f.tick(4.1);assert.equal(f.actor.lastResult.ok,false);assert.ok(f.actor.physiology.totals.metabolizedKcal>start);assert.ok(f.e.aquatic.fish.includes(f.fish));
 const g=fishingFixture();observeNpc(g.actor,g.state.environment);assert.equal(requestNpcAction(g.actor,{type:'catch',targetId:g.fish.id},g.state.environment).ok,true);g.tick(.5);assert.equal(cancelNpcAction(g.actor),true);g.tick(4);assert.ok(g.e.aquatic.fish.includes(g.fish));assert.deepEqual(g.actor.inventory.items,[]);audit(g.e);
});


test('completion falsification fixtures: lost LOS, invalid water, reach, dry shore and material capacity are paid failures',()=>{
 for(const mode of ['los','invalid-water','reach','deep-actor','materials']){
  let visible=true;const f=fishingFixture({index:16,lineOfSightGate:mode==='los'?()=>visible:null});f.tick(24);f.actor.position=bankFor(f.geometry,f.fish.position);observeNpc(f.actor,f.state.environment);
  const admitted=requestNpcAction(f.actor,{type:'catch',targetId:f.fish.id},f.state.environment);assert.equal(admitted.ok,true,mode);
  const spent=f.actor.physiology.totals.metabolizedKcal;
  if(mode==='los')visible=false;
  if(mode==='invalid-water')f.fish.position={...f.actor.position};
  if(mode==='reach')f.actor.position={...f.geometry.spawn};
  if(mode==='deep-actor')f.actor.position={x:-1200,y:220};
  if(mode==='materials')while(f.e.materials.length<ECOLOGY_RULES.maxMaterials)f.e.materials.push({id:`object:${f.e.nextId++}`,scene:'valley',position:{...f.actor.position},kind:'material',materialType:'grass',heldBy:null,massGrams:1,energyKcal:0,waterMl:0,ageHours:0,spoiled:false});
  f.tick(4.1);assert.equal(f.actor.lastResult.ok,false,mode);assert.ok(f.actor.physiology.totals.metabolizedKcal>spent,mode);assert.ok(f.e.aquatic.fish.includes(f.fish),mode);assert.ok(!f.actor.inventory.items.includes(f.fish.id),mode);assert.equal(f.e.aquatic.ledger.captures,0,mode);
 }
});

test('two genuinely admitted native catches compete for one moving identity and only one commits',()=>{
 const f=fishingFixture({index:16});f.tick(24);const bank=bankFor(f.geometry,f.fish.position);
 for(const actor of f.state.agents){actor.position={...bank};observeNpc(actor,f.state.environment);assert.equal(requestNpcAction(actor,{type:'catch',targetId:f.fish.id},f.state.environment).ok,true);}
 f.tick(4.1);const owners=f.state.agents.filter(a=>a.inventory.items.includes(f.fish.id));assert.equal(owners.length,1);assert.equal(f.e.aquatic.ledger.captures,1);assert.equal(f.e.materials.filter(m=>m.id===f.fish.id).length,1);assert.equal(f.state.agents.filter(a=>a.lastResult.ok).length,1);assert.ok(f.state.agents.every(a=>a.lastResult.durationSeconds>=3.99));audit(f.e);
});

test('pull rechecks hand and material capacity after admission without subtracting tissue',()=>{
 for(const mode of ['hands','materials']){
  const f=fishingFixture(),whole=directCatch(f);observeNpc(f.actor,f.state.environment);assert.equal(requestNpcAction(f.actor,{type:'pull',targetId:whole.id},f.state.environment).ok,true);
  const initial={massGrams:whole.massGrams,energyKcal:whole.energyKcal,waterMl:whole.waterMl,tissue:structuredClone(whole.fishTissue)},spent=f.actor.physiology.totals.metabolizedKcal;
  if(mode==='hands')f.actor.inventory.items.push('object:999990','object:999991','object:999992');
  else while(f.e.materials.length<ECOLOGY_RULES.maxMaterials)f.e.materials.push({id:`object:${f.e.nextId++}`,scene:'valley',position:{...f.actor.position},kind:'material',materialType:'grass',heldBy:null,massGrams:1,energyKcal:0,waterMl:0,ageHours:0,spoiled:false});
  f.tick(5.1);assert.equal(f.actor.lastResult.ok,false,mode);assert.deepEqual({massGrams:whole.massGrams,energyKcal:whole.energyKcal,waterMl:whole.waterMl,tissue:whole.fishTissue},initial);assert.ok(f.actor.physiology.totals.metabolizedKcal>spent);assert.equal(f.e.aquatic.ledger.pulls,0);
 }
});
