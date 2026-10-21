import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { ECOLOGY_RULES as R } from '../src/ecology-config.js';
import { AQUATIC_RULES as A } from '../src/aquatic-config.js';
import { aquaticError, aquaticStockAudit, aquaticEnergy, aquaticFoodEnergy } from '../src/aquatic-state.js';
import { seedAquaticEcology, tickAquaticEcology, captureAquaticFish, pullAquaticTissue, decayAquaticMaterial } from '../src/aquatic-ecology.js';

// Fast deterministic real signed-water fixture. This is physics evidence, not
// an autonomous controller result or proof of native desktop persistence.
const geometry={bounds:{minX:-500,maxX:500,minY:-500,maxY:500},
 profile:{cellPixels:1,currentMaxSpeed:0},
 sample(x){return {surfaceWaterDistance:1000,sinkholePondDistance:x};},
 classify(x){return {reason:x>10?'dry-ground':'shallow-water'};},lineOfSight(){return true;}};
function fresh(){
 const e={nextId:1,seed:23,elapsed:0,plants:[],animals:[],materials:[],births:0,deaths:0,
  detritus:{massGrams:0,energyKcal:0},ledger:{birthTransferredKcal:0,photosynthesisKcal:0,metabolizedKcal:0,humanRemovedKcal:0,discardedKcal:0}};
 seedAquaticEcology(e,geometry);return e;
}
function deposit(e){return (mass,kcal)=>{
 const retained=Math.min(mass,Math.max(0,R.maxDetritus-e.detritus.massGrams)),fraction=mass>0?retained/mass:1;
 e.detritus.massGrams+=retained;e.detritus.energyKcal+=kcal*fraction;e.ledger.discardedKcal+=kcal*(1-fraction);
};}
function advance(e,hours){const seconds=hours*CONFIG.dayRealSeconds/24;tickAquaticEcology(e,seconds,geometry,{deposit:deposit(e)});e.elapsed+=seconds;}
function audit(e){
 assert.equal(aquaticError(e,geometry),null);
 for(const error of Object.values(aquaticStockAudit(e)))assert.ok(Math.abs(error)<.00002,`stock error ${error}`);
 const held=e.materials.reduce((n,m)=>n+m.energyKcal,0);
 const balance=aquaticEnergy(e)+aquaticFoodEnergy(e)+held+e.detritus.energyKcal+e.ledger.metabolizedKcal+e.ledger.discardedKcal-e.aquatic.ledger.initialKcal-e.ledger.photosynthesisKcal;
 assert.ok(Math.abs(balance)<.00002,`global energy error ${balance}`);
 assert.ok(e.aquatic.fish.length<=A.maxLiveFish);
 assert.ok(e.aquatic.origins.length<=A.maxLiveFish+R.maxMaterials);
}

const generations=fresh();
test('renewable local feeding, paid growth and parent-funded births survive lifespan turnover',()=>{
 assert.equal(generations.aquatic.fish.length,8);
 assert.equal(aquaticFoodEnergy(generations),0);
 const initialIds=new Set(generations.aquatic.initialIds);
 for(let h=0;h<1000;h+=20){advance(generations,20);audit(generations);}
 assert.ok(generations.aquatic.ledger.fedKcal>0);
 assert.ok(generations.aquatic.ledger.growthTransferredKcal>0);
 assert.ok(generations.aquatic.ledger.births>0);
 assert.ok(generations.aquatic.ledger.naturalDeaths>0);
 assert.ok(generations.aquatic.fish.length>0);
 assert.ok(generations.aquatic.fish.every(f=>!initialIds.has(f.id)),'initial cohort must die, not live forever');
 assert.ok(generations.aquatic.fish.some(f=>f.tissue.massGrams>A.tissue.massGrams*A.birthFraction),'offspring grow by paid transfers');
});

test('fixed-step batching and persisted continuation are deterministic, with no catch-up on restore',()=>{
 const e=fresh(),same=structuredClone(e);
 tickAquaticEcology(e,20,geometry,{deposit:deposit(e)});
 for(let i=0;i<40;i++)tickAquaticEcology(same,.5,geometry,{deposit:deposit(same)});
 assert.deepEqual(e,same);
 const reopened=JSON.parse(JSON.stringify(e)),snapshot=structuredClone(reopened);
 assert.deepEqual(reopened,snapshot);
 advance(e,1);advance(reopened,1);assert.deepEqual(e,reopened);audit(e);
});

test('food capacity limits imported production and extinction never spontaneously recruits fish',()=>{
 const e=fresh();
 for(const f of [...e.aquatic.fish])assert.equal(captureAquaticFish(e,f.id,'aster',f.position).ok,true);
 const nextId=e.nextId;advance(e,40);audit(e);
 assert.equal(e.aquatic.fish.length,0);assert.equal(e.nextId,nextId);
 assert.equal(aquaticFoodEnergy(e),e.aquatic.patches.length*A.foodCapacityKcal);
 const produced=e.aquatic.ledger.primaryProducedKcal;advance(e,40);
 assert.equal(e.aquatic.ledger.primaryProducedKcal,produced);assert.equal(e.aquatic.ledger.births,0);audit(e);
});

test('local food cannot be eaten through a blocked path; starvation exports real corpses',()=>{
 const e=fresh(),blocked={...geometry,lineOfSight(){return false;}};
 tickAquaticEcology(e,81*CONFIG.dayRealSeconds/24,blocked,{deposit:deposit(e)});
 assert.equal(e.aquatic.fish.length,0);assert.equal(e.aquatic.ledger.naturalDeaths,8);
 assert.equal(e.aquatic.ledger.fedKcal,0);assert.equal(e.materials.length,8);audit(e);
});

test('spawned fish retain exact provenance through capture, pulling, and terminal decay',()=>{
 // The fixture above has completed its ordinary lifecycle; this test never
 // grants knowledge, creates acquisition receipts, or claims native capture.
 const e=structuredClone(generations),f=e.aquatic.fish[0];assert.ok(f);
 const before=structuredClone(f),id=f.id;
 assert.equal(captureAquaticFish(e,id,'aster',f.position).ok,true);
 const m=e.materials.find(m=>m.id===id);assert.deepEqual(m.fishTissue,before.tissue);
 const pulled=pullAquaticTissue(e,m,'aster',m.position);assert.equal(pulled.ok,true);audit(e);
 const source=e.aquatic.origins.find(o=>o.id===id);assert.ok(source);
 const owner={id:'aster',position:m.position,inventory:{items:[id,pulled.materialId]}};
 for(const material of e.materials.filter(m=>m.originFishId===id)){material.ageHours=72;decayAquaticMaterial(e,material,CONFIG.dayRealSeconds*6,[owner],deposit(e));}
 assert.deepEqual(owner.inventory.items,[]);advance(e,.01);assert.equal(e.aquatic.origins.some(o=>o.id===id),false);audit(e);
});

test('strict restoration rejects malformed production, hidden food, lifecycle counters, and juvenile duplication',()=>{
 const e=fresh();advance(e,.1);
 for(const mutate of [
  x=>x.aquatic.ledger.fedKcal++,x=>x.aquatic.ledger.primaryProducedKcal++,
  x=>x.aquatic.patches[0].food.energyKcal++,x=>x.aquatic.patches[0].food.massGrams=-1,
  x=>x.aquatic.fish[0].ageHours++,x=>x.aquatic.fish[0].fedKcal++,
  x=>x.aquatic.ledger.birthTransferredKcal++,x=>x.aquatic.fish[0].tissue.massGrams++,
  x=>x.aquatic.origins[0].tissueLimitGrams--,
 ]){const invalid=structuredClone(e);mutate(invalid);assert.notEqual(aquaticError(invalid,geometry),null);}
});

test('declared modest harvest remains finite and does not replace the captured individual',()=>{
 const e=fresh(),captured=[];
 // Predeclared fixture pressure: one largest available fish per100 body-hours,
 // for400 hours. This is not autonomous selection, a sustainable-yield
 // calibration, or an assertion that any arbitrary harvest rate is safe.
 for(let h=100;h<=400;h+=100){
  advance(e,100);audit(e);
  const f=[...e.aquatic.fish].sort((a,b)=>b.tissue.massGrams-a.tissue.massGrams||a.id.localeCompare(b.id))[0];
  assert.ok(f);captured.push(f.id);
  assert.equal(captureAquaticFish(e,f.id,'aster',f.position).ok,true);audit(e);
 }
 assert.equal(e.aquatic.ledger.captures,4);assert.ok(e.aquatic.fish.length>0);
 assert.ok(e.aquatic.ledger.births>0);
 assert.ok(captured.every(id=>!e.aquatic.fish.some(f=>f.id===id)));
});
