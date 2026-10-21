import test from 'node:test';
import assert from 'node:assert/strict';
import { AQUATIC_RULES as A } from '../src/aquatic-config.js';
import { CONFIG } from '../src/config.js';
import { seedAquaticEcology, tickAquaticEcology } from '../src/aquatic-ecology.js';
import { aquaticError, aquaticStockAudit } from '../src/aquatic-state.js';
const geometry={bounds:{minX:-500,maxX:500,minY:-500,maxY:500},profile:{cellPixels:1,currentMaxSpeed:0},sample(x){return {surfaceWaterDistance:1000,sinkholePondDistance:x};},classify(x){return {reason:x>10?'dry-ground':'shallow-water'};},lineOfSight(){return true;}};
const fresh=(habitat=geometry)=>{const e={nextId:1,seed:23,elapsed:0,plants:[],animals:[],materials:[],births:0,deaths:0,detritus:{massGrams:0,energyKcal:0},ledger:{birthTransferredKcal:0,photosynthesisKcal:0,metabolizedKcal:0,humanRemovedKcal:0,discardedKcal:0}};seedAquaticEcology(e,habitat);return e;};
const tick=(e,seconds=.5)=>tickAquaticEcology(e,seconds,geometry,{deposit:(mass,kcal)=>{e.detritus.massGrams+=mass;e.detritus.energyKcal+=kcal;}});

test('birth allocation refuses exhausted IDs without debiting parent body or duplicating stock',()=>{
 const e=fresh();
 // Reach the threshold through real production, feeding and paid metabolism.
 tick(e,(A.birthIntervalHours-.01)*CONFIG.dayRealSeconds/24);
 assert.equal(e.aquatic.ledger.births,0);
 let before;
 while(e.aquatic.ledger.births===0){before=structuredClone(e);tick(e);}
 const noHabitat=structuredClone(before),bodyBefore=noHabitat.aquatic.fish.map(f=>({tissue:{...f.tissue},residue:{...f.residue}}));
 const dry={...geometry,sample(){return {surfaceWaterDistance:1000,sinkholePondDistance:1000};}};
 tickAquaticEcology(noHabitat,.5,dry,{deposit:()=>assert.fail('full adults do not grow or die in this half-second')});
 assert.equal(noHabitat.aquatic.ledger.births,0);assert.equal(noHabitat.nextId,before.nextId);
 assert.deepEqual(noHabitat.aquatic.fish.map(f=>({tissue:f.tissue,residue:f.residue})),bodyBefore);
 const blocked=structuredClone(before);blocked.nextId=1e9;const next=blocked.nextId;
 const bodies=blocked.aquatic.fish.map(f=>({id:f.id,tissue:{...f.tissue},residue:{...f.residue}}));
 tick(blocked);
 assert.equal(blocked.nextId,next);assert.equal(blocked.aquatic.ledger.births,0);assert.equal(blocked.births,0);
 assert.deepEqual(blocked.aquatic.fish.map(f=>({id:f.id,tissue:f.tissue,residue:f.residue})),bodies);
 assert.equal(aquaticError(blocked,geometry),null);
 for(const error of Object.values(aquaticStockAudit(blocked)))assert.ok(Math.abs(error)<.00002);
 assert.ok(e.aquatic.ledger.births>0);
 const offspring=e.aquatic.fish.filter(f=>!e.aquatic.initialIds.includes(f.id));
 assert.ok(offspring.every(f=>f.ageHours===0));
 assert.ok(offspring.every(f=>f.tissue.massGrams===A.tissue.massGrams*A.birthFraction));
 assert.equal(aquaticError(e,geometry),null);
});

test('per-population feeding is not allocated solely by fish array order',()=>{
 const a=fresh(),b=structuredClone(a);b.aquatic.fish.reverse();
 tick(a,60);tick(b,60);
 const stocks=e=>e.aquatic.fish.map(f=>({id:f.id,reserve:f.reserve.energyKcal,fed:f.fedKcal})).sort((x,y)=>x.id.localeCompare(y.id));
 const first=stocks(a),second=stocks(b);
 for(let i=0;i<first.length;i++){assert.equal(first[i].id,second[i].id);assert.ok(Math.abs(first[i].fed-second[i].fed)<1e-8);assert.ok(Math.abs(first[i].reserve-second[i].reserve)<1e-8);}
});

test('naturally populated live cap refuses further recruitment without parent structural loss',()=>{
 const wide={...geometry,bounds:{...geometry.bounds,minY:-3000,maxY:3000}},e=fresh(wide);
 // Real fresh seeding in a longer water band, not fabricated mature fish.
 assert.equal(e.aquatic.initialCount,32);
 const advance=seconds=>tickAquaticEcology(e,seconds,wide,{deposit:(mass,kcal)=>{e.detritus.massGrams+=mass;e.detritus.energyKcal+=kcal;}});
 advance((2*A.birthIntervalHours-.01)*CONFIG.dayRealSeconds/24);
 assert.equal(e.aquatic.fish.length,A.maxLiveFish);
 const count=e.aquatic.ledger.births,next=e.nextId,bodies=new Map(e.aquatic.fish.map(f=>[f.id,f.tissue.massGrams]));
 advance(.02*CONFIG.dayRealSeconds/24);
 assert.ok(e.aquatic.fish.some(f=>f.ageHours-f.lastBirthHours>=A.birthIntervalHours&&f.tissue.massGrams>=A.tissue.massGrams*.99&&f.reserve.energyKcal>=A.reserve.energyKcal*.75),'at least one funded adult must actually be due');
 assert.equal(e.aquatic.ledger.births,count);assert.equal(e.nextId,next);
 for(const f of e.aquatic.fish)assert.ok(f.tissue.massGrams>=bodies.get(f.id)-1e-8);
 assert.equal(aquaticError(e,wide),null);
 for(const error of Object.values(aquaticStockAudit(e)))assert.ok(Math.abs(error)<.00002);
});
