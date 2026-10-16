import {legacySave,legacyEcology} from './legacy-save-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CONFIG, CAVE_SPAWN} from '../src/config.js';
import {ECOLOGY_RULES as R, ECOLOGY_MATERIALS as MATERIALS, ECOLOGY_SPECIES as SPECIES} from '../src/ecology-config.js';
import {createEcology, validateEcology, migrateEcologyDistribution, tickEcology, senseEcology, ecologyEnergy, interactEcologyObject, consumeEcologyMaterial, lookupEcologyObject} from '../src/ecology.js';
import {createRegions, habitatConditions, regionAt, consumeSoil, regionalResourceAudit} from '../src/ecology-regions.js';
import {beginSleep, ingestMaterial} from '../src/biology.js';
import {freshState, canStandOutside} from '../src/world.js';
import {validateSave, loadSave, writeSave} from '../src/save.js';
import {SocialCoordinator} from '../src/social.js';

// Local accounting/structure fixtures, not multi-day survival trials.
// Gate: residual <= max(1e-6 units, 1e-9 * ledger throughput).
const clone = value => structuredClone(value);
const near = (actual, expected, tolerance=1e-6, label='') => assert.ok(Math.abs(actual-expected)<=tolerance,
  `${label}: expected ${expected}, received ${actual}, tolerance ${tolerance}`);
let pristine;
const freshEcology = () => clone(pristine ??= createEcology(CONFIG.seed));
const fields = ['nutrients', 'massGrams', 'energyKcal'];
const sumRegions = (e, key) => e.regions.reduce((sum, r) => sum+r[key], 0);
// Independently reconstruct inventory; do not trust the production kcal audit.
function independentEnergy(e) {
  const plants=e.plants.reduce((sum,p)=>sum+(p.kind==='grass'?p.biomassGrams*.35:p.quantity*(p.kind==='apple_tree'?95:19)),0);
  const animals=e.animals.reduce((sum,a)=>sum+a.structureKcal+a.physiology.availableEnergyKcal+a.physiology.storedEnergyKcal
    +a.physiology.stomach.reduce((n,meal)=>n+meal.remainingKcal,0),0);
  return plants+animals+e.materials.reduce((sum,m)=>sum+m.energyKcal,0)+e.detritus.energyKcal;
}
function checkEnergy(e) {
  const l=e.ledger,input=l.initialKcal+l.photosynthesisKcal+l.externalKcal;
  const output=independentEnergy(e)+l.humanRemovedKcal+l.metabolizedKcal+l.decomposedKcal+l.discardedKcal;
  near(output,input,Math.max(1e-6,1e-9*(input+output)),'independent kcal balance');
  near(ecologyEnergy(e),independentEnergy(e),1e-6,'production inventory');
}
function checkRegionalBalance(e) {
  for(const r of e.regions){
    for(const [input,output,unit]of [
      [r.initialNutrients+r.mineralizedNutrients,r.nutrients+r.uptakeNutrients,'nutrients'],
      [r.initialMassGrams+r.depositedMassGrams,r.massGrams+r.decayedMassGrams,'grams'],
      [r.initialEnergyKcal+r.depositedKcal,r.energyKcal+r.decomposedKcal,'kcal'],
    ])near(output,input,Math.max(1e-6,1e-9*(input+output)),`${r.id} ${unit}`);
    for(const field of fields)assert.ok(Number.isFinite(r[field])&&r[field]>=0);
  }
  const audit=regionalResourceAudit(e);near(audit.soilBalanceError,0);
  for(const key of ['maxRegionalMassError','maxRegionalEnergyError','maxRegionalSoilError'])near(audit[key],0);
  for(const field of fields)assert.ok(sumRegions(e,field)<=e.detritus[field]+1e-6);
}
function resetBudget(e){for(const key of Object.keys(e.ledger))e.ledger[key]=0;e.ledger.initialKcal=independentEnergy(e);}
function fixture({plants=[],animals=[]}={}){
  const e=freshEcology();e.plants=clone(plants);e.animals=clone(animals);e.materials=[];e.elapsed=0;e.pending=0;
  e.detritus={nutrients:0,massGrams:0,energyKcal:0};e.regions=createRegions(e.detritus,e.plants);resetBudget(e);return e;
}
function putSoil(e,position,nutrients){const r=regionAt(e,position);assert.ok(r);e.detritus.nutrients+=nutrients;r.nutrients+=nutrients;r.initialNutrients+=nutrients;return r;}
function tick(e,seconds=.5,agents=[]){for(let left=seconds;left>1e-10;left-=.5)tickEcology(e,Math.min(left,.5),{settings:{weatherOverride:'clear'}},agents);}
function separatePlants(kind){
  const e=freshEcology(),first=e.plants.find(p=>p.kind===kind);
  const second=e.plants.find(p=>p.kind===kind&&regionAt(e,p.position).id!==regionAt(e,first.position).id);
  assert.ok(first&&second,`two regions with ${kind}`);return[first,second];
}
function pull(e,p,actorId='aster'){
  const result=interactEcologyObject(e,p.id,'pull',{actorId,position:p.position,scene:p.scene});assert.ok(result.ok,result.code);
  return lookupEcologyObject(e,result.materialId);
}

test('regional layout is deterministic, bounded, suitable and different across five actual habitats',()=>{
  const e=freshEcology();assert.equal(e.distributionVersion,3);assert.equal(e.regionalVersion,1);
  assert.deepEqual(createEcology(CONFIG.seed),e);assert.equal(e.regions.length,R.habitatGridSize**2);
  assert.ok(e.plants.length<=R.maxPlants&&e.animals.length<=R.maxAnimals);
  const profiles=new Map();
  for(const p of e.plants){
    assert.ok(canStandOutside(p.position.x,p.position.y,10),p.id);
    const site=habitatConditions(p.position);near(p.moisture,site.moisture,1e-12,p.id);
    assert.ok(site.productivity>=.3&&site.productivity<=1.2);
    if(p.kind==='apple_tree')assert.ok(site.moisture>.4&&site.temperatureOffsetC>-2.5,`unsuitable apple ${p.id}`);
    if(p.kind==='bramble')assert.ok(site.moisture>.32,`unsuitable bramble ${p.id}`);
    const profile=profiles.get(site.kind)||{count:0,moisture:0,grass:0,bramble:0,apple_tree:0};
    profile.count++;profile.moisture+=site.moisture;profile[p.kind]++;profiles.set(site.kind,profile);
  }
  assert.deepEqual([...profiles.keys()].sort(),['cool_upland','dry_meadow','meadow','riparian','woodland']);
  const signatures=[...profiles.values()].map(p=>JSON.stringify([p.grass/p.count,p.bramble/p.count,p.apple_tree/p.count,p.moisture/p.count]));
  assert.equal(new Set(signatures).size,5,'habitats must not repeat a single producer/moisture profile');
  assert.ok(profiles.get('riparian').moisture/profiles.get('riparian').count>profiles.get('dry_meadow').moisture/profiles.get('dry_meadow').count+.2);
  assert.equal(profiles.get('dry_meadow').apple_tree,0);
  for(const a of e.animals)assert.ok(canStandOutside(a.position.x,a.position.y,SPECIES[a.species].radius));
  for(const field of fields)near(sumRegions(e,field),e.detritus[field]);checkRegionalBalance(e);checkEnergy(e);
});

test('grass cannot borrow remote soil and debits exactly .004 nutrient units per new gram',()=>{
  const e=fixture({plants:separatePlants('grass')}),[dry,fertile]=e.plants;
  for(const p of e.plants){p.biomassGrams=500;p.moisture=.7;}
  putSoil(e,fertile.position,.001);resetBudget(e);tick(e,10);
  assert.equal(dry.biomassGrams,500);near(fertile.biomassGrams-500,.001/.004,1e-9);
  assert.equal(regionAt(e,fertile.position).nutrients,0);near(regionAt(e,fertile.position).uptakeNutrients,.001,1e-12);
  assert.equal(e.detritus.nutrients,0);assert.equal(e.ledger.externalKcal,0);checkRegionalBalance(e);checkEnergy(e);
});
for(const [kind,type]of [['apple_tree','apple'],['bramble','berry']])test(`${kind} requires a whole fruit's local nutrient cost without remote borrowing`,()=>{
  const e=fixture({plants:separatePlants(kind)}),[starved,fertile]=e.plants,cost=MATERIALS[type].massGrams*.004;
  for(const p of e.plants){p.quantity=0;p.growth=1;p.moisture=.7;}
  putSoil(e,starved.position,cost/2);putSoil(e,fertile.position,cost);resetBudget(e);tick(e);
  assert.equal(starved.quantity,0);assert.equal(starved.growth,1);assert.equal(fertile.quantity,1);
  near(regionAt(e,fertile.position).uptakeNutrients,cost,1e-12);near(regionAt(e,starved.position).nutrients,cost/2,1e-12);
  assert.equal(regionAt(e,starved.position).uptakeNutrients,0);near(e.detritus.nutrients,cost/2,1e-12);
  near(e.ledger.photosynthesisKcal,MATERIALS[type].energyKcal,1e-12);checkRegionalBalance(e);checkEnergy(e);
});

test('direct soil uptake remains finite and local despite a fertile compatibility aggregate',()=>{
  const [a,b]=separatePlants('grass'),e=fixture(),r=putSoil(e,a.position,2);putSoil(e,b.position,7);
  assert.equal(consumeSoil(e,a.position,-10),0);assert.equal(consumeSoil(e,a.position,20),2);assert.equal(consumeSoil(e,a.position,1),0);
  assert.equal(r.nutrients,0);assert.equal(r.uptakeNutrients,2);assert.equal(regionAt(e,b.position).nutrients,7);assert.equal(e.detritus.nutrients,7);
  checkRegionalBalance(e);checkEnergy(e);
});

test('local decomposition mineralizes finite mass and dissipates calories without remote fertilization',()=>{
  const e=fixture(),r=regionAt(e,separatePlants('grass')[0].position);
  // Explicit initial litter: 1,000 g dry grass, 350 kcal, no available soil.
  e.detritus.massGrams=r.massGrams=r.initialMassGrams=1000;
  e.detritus.energyKcal=r.energyKcal=r.initialEnergyKcal=350;resetBudget(e);
  const f=.5/(CONFIG.dayRealSeconds*10);tick(e);
  near(r.nutrients,1000*f*.004,1e-12);near(r.mineralizedNutrients,r.nutrients,1e-12);near(r.massGrams,1000*(1-f),1e-12);
  near(e.ledger.decomposedKcal,350*f,1e-12);assert.equal(e.ledger.photosynthesisKcal,0);
  assert.ok(e.regions.filter(other=>other!==r).every(other=>other.nutrients===0&&other.massGrams===0));checkRegionalBalance(e);checkEnergy(e);
});

for(const mode of ['held in valley','released in valley','held in cave','released in cave'])test(`material decay follows physical destination when ${mode}`,()=>{
  const [source,destination]=separatePlants('apple_tree'),e=fixture({plants:[source]}),m=pull(e,e.plants[0]);
  const originalPosition=clone(m.position),sourceId=regionAt(e,source.position).id;e.plants=[];
  const inCave=mode.endsWith('cave'),released=mode.startsWith('released');
  const actor={id:'aster',position:inCave?{...CAVE_SPAWN}:{...destination.position},scene:inCave?'refuge':'valley'};
  if(released)assert.ok(interactEcologyObject(e,m.id,'release',{...actor,actorId:actor.id}).ok);
  else assert.deepEqual(m.position,originalPosition,'held source coordinates deliberately remain stale');
  m.ageHours=MATERIALS.apple.spoilDays*24;resetBudget(e);const massBefore=m.massGrams;tick(e,60,[actor]);
  const shedMass=massBefore-m.massGrams;assert.ok(shedMass>0);
  const original=e.regions.find(r=>r.id===sourceId);assert.equal(original.massGrams,0);assert.equal(original.nutrients,0);
  if(inCave){
    assert.equal(regionAt(e,actor.position,actor.scene),null);assert.ok(e.regions.every(r=>r.massGrams===0&&r.nutrients===0));
    assert.equal(e.detritus.nutrients,0);assert.ok(regionalResourceAudit(e).unassigned.massGrams>0);
  }else{
    const target=regionAt(e,destination.position);assert.ok(target.massGrams>0&&target.nutrients>0);
    near(target.massGrams+target.mineralizedNutrients/.004,shedMass,1e-9);
    assert.ok(e.regions.filter(r=>r!==target).every(r=>r.massGrams===0&&r.nutrients===0));
    for(const field of fields)near(regionalResourceAudit(e).unassigned[field],0,1e-9);
  }
  checkRegionalBalance(e);checkEnergy(e);
});

test('carcass energy stays finite and its decay fertilizes only the actual death region',()=>{
  const e=fixture({animals:[freshEcology().animals.find(a=>a.species==='rabbit')]}),a=e.animals[0],r=regionAt(e,a.position);
  for(let i=0;i<4;i++)assert.ok(interactEcologyObject(e,a.id,'strike',{actorId:'aster',position:a.position,scene:'valley',power:4}).ok);
  assert.equal(e.animals.length,0);assert.equal(e.deaths,1);const m=e.materials[0];assert.equal(m.kind,'carcass');checkEnergy(e);
  m.ageHours=MATERIALS.flesh.spoilDays*24;tick(e,30);assert.ok(r.massGrams>0&&r.nutrients>0);
  assert.ok(e.regions.filter(other=>other!==r).every(other=>other.massGrams===0&&other.nutrients===0));checkRegionalBalance(e);checkEnergy(e);
});

function migrationFixture(version,{empty=false}={}){
  const state=freshState({connectedEcology:false}),original=freshEcology(),fruit=original.plants.find(p=>p.kind==='apple_tree');
  const grass=original.plants.find(p=>p.kind==='grass'),rabbit=original.animals.find(a=>a.species==='rabbit');
  state.environment.ecology=fixture({plants:[fruit,grass],animals:[rabbit]});
  const e=state.environment.ecology,[aster,mira]=state.agents;state.elapsed=state.environment.elapsed=e.elapsed=123.5;
  aster.elapsed=mira.elapsed=state.elapsed;
  if(empty){e.plants=[];e.animals=[];e.materials=[];}
  else{
    const held=pull(e,e.plants[0]);aster.inventory.items.push(held.id);
    assert.ok(consumeEcologyMaterial(e,held.id,.25,{actorId:aster.id,accept:p=>ingestMaterial(aster,p,{objectId:held.id,actionId:7})}).ok);
    assert.ok(beginSleep(aster,{hours:3.25}).ok);aster.physiology.outsideAssistance={energyKcal:321,waterMl:98,count:2};
    e.plants[0].quantity=0;e.plants[1].biomassGrams=17.25;
    const animal=e.animals[0];assert.ok(beginSleep(animal,{hours:2}).ok);animal.physiology.availableEnergyKcal=11.25;animal.physiology.storedEnergyKcal=43.75;
    const victim=clone(rabbit);victim.id=`object:${e.nextId++}`;e.animals.push(victim);
    for(let i=0;i<4;i++)assert.ok(interactEcologyObject(e,victim.id,'strike',{actorId:'mira',position:victim.position,scene:victim.scene,power:4}).ok);
    const social=new SocialCoordinator({getAgents:()=>state.agents,getCommunity:()=>state.community,getEnvironment:()=>state.environment});
    social.postHuman('A remembered report remains unverified.','mira');
    assert.ok(social.action(mira,{type:'write_note',title:'Existing field record',text:'This object was inspected before the migration.',beliefIds:[]}).ok);
    e.detritus={nutrients:13.125,massGrams:89.5,energyKcal:31.25};e.regions=createRegions(e.detritus,e.plants);
  }
  resetBudget(e);
  if(!empty){
    e.ledger.externalKcal=17;e.ledger.initialKcal-=17;
    state.cardinal.diagnoses.push({id:'cardinal:diagnosis:1',at:120,code:'PRIOR_PROBE',severity:'info',summary:'A recorded pre-migration observation.',evidence:{stock:17.25}});
  }
  // Canonicalize first, then downgrade only the representation/migration markers.
  const canonical=legacySave(validateSave(state,{restoring:false}));canonical.environment.ecology.distributionVersion=version;
  delete canonical.environment.ecology.regionalVersion;delete canonical.environment.ecology.regions;return canonical;
}
function preserved(e){const {distributionVersion,regionalVersion,regions,...existing}=legacyEcology(structuredClone(e));return existing;}
for(const version of [1,2]){
  test(`distribution v${version} migration preserves exact objects, bodies, depletion and authored evidence`,()=>{
    const old=migrationFixture(version),before=clone(old),rawText=JSON.stringify(old);
    const migrated=validateSave(old,{restoring:false}),e=migrated.environment.ecology;
    assert.equal(JSON.stringify(old),rawText);assert.equal(e.distributionVersion,3);assert.equal(e.regionalVersion,1);
    assert.deepEqual(preserved(e),preserved(before.environment.ecology));assert.deepEqual(migrated.agents,before.agents);
    assert.deepEqual(migrated.community,before.community);assert.deepEqual(migrated.cardinal,before.cardinal);assert.equal(migrated.elapsed,before.elapsed);
    for(const field of fields)near(sumRegions(e,field),before.environment.ecology.detritus[field]);
    const once=clone(e);assert.equal(migrateEcologyDistribution(e).changed,false);assert.deepEqual(e,once);
    assert.deepEqual(validateSave(migrated,{restoring:false}).environment.ecology,once);checkRegionalBalance(e);checkEnergy(e);
    const directory=mkdtempSync(join(tmpdir(),'aincrad-regional-populated-')),path=join(directory,'save.json');
    const disk=()=>({getItem:()=>readFileSync(path,'utf8'),setItem:(_key,value)=>writeFileSync(path,value)});
    try{
      writeFileSync(path,JSON.stringify(before));const first=loadSave(disk());assert.equal(first.blocked,false);
      assert.equal(writeSave(disk(),first.state),true);const reopened=loadSave(disk());assert.equal(reopened.blocked,false);
      assert.deepEqual(reopened.state.environment.ecology,once);
      assert.deepEqual(reopened.state.agents,migrated.agents);assert.deepEqual(reopened.state.community,migrated.community);
      assert.deepEqual(reopened.state.cardinal,migrated.cardinal);
    }finally{rmSync(directory,{recursive:true,force:true});}
  });
  test(`zero-stock distribution v${version} stays empty through migration and file close/reopen`,()=>{
    const old=migrationFixture(version,{empty:true}),directory=mkdtempSync(join(tmpdir(),'aincrad-regional-save-')),path=join(directory,'save.json');
    const disk=()=>({getItem:()=>readFileSync(path,'utf8'),setItem:(_key,value)=>writeFileSync(path,value)});
    try{
      writeFileSync(path,JSON.stringify(old));const first=loadSave(disk());assert.equal(first.blocked,false);assert.equal(first.exists,true);
      const e=first.state.environment.ecology;assert.deepEqual(e.plants,[]);assert.deepEqual(e.animals,[]);assert.deepEqual(e.materials,[]);
      assert.deepEqual(e.detritus,{nutrients:0,massGrams:0,energyKcal:0});assert.ok(e.regions.every(r=>fields.every(key=>r[key]===0)));
      const once=clone(e);assert.equal(writeSave(disk(),first.state),true);const reopened=loadSave(disk());assert.equal(reopened.blocked,false);
      assert.deepEqual(reopened.state.environment.ecology,once);tick(reopened.state.environment.ecology,60);
      assert.deepEqual(reopened.state.environment.ecology.detritus,e.detritus);assert.equal(reopened.state.environment.ecology.plants.length,0);
      checkRegionalBalance(reopened.state.environment.ecology);checkEnergy(reopened.state.environment.ecology);
    }finally{rmSync(directory,{recursive:true,force:true});}
  });
}

test('private regional diagnostics never enter local sensory objects',()=>{
  const e=freshEcology(),source=e.plants[0],before=senseEcology(e,source.position,'valley',600);assert.ok(before.length>0);
  for(const object of before)assert.deepEqual(Object.keys(object).sort(),['appearance','count','id','motion','position','scene']);
  assert.doesNotMatch(JSON.stringify(before),/"(?:regions|regionalVersion|nutrients|initialNutrients|uptakeNutrients|mineralizedNutrients|productivity|waterDistance|prey|corridors|species|kind|energyKcal)"/);
  e.regions.forEach(r=>{r.nutrients=0;r.initialNutrients=12345;});assert.deepEqual(senseEcology(e,source.position,'valley',600),before);
  assert.ok(before.every(o=>Math.hypot(o.position.x-source.position.x,o.position.y-source.position.y)<=600));
});

test('regional sanitizer is bounded and allowlisted without refilling missing or corrupt local stocks',()=>{
  const e=fixture(),source=separatePlants('grass')[0];putSoil(e,source.position,5);const raw=clone(e);
  raw.regions[0].script='do not execute';raw.regions[0].nutrients=1e50;raw.regions[1].nutrients=-100;
  raw.regions.push(...Array.from({length:500},()=>({id:'untrusted:extra',nutrients:1e99,script:'discard'})));
  assert.throws(()=>validateEcology(raw),/Protected lifecycle save/);
  const restored=validateEcology(legacyEcology(raw));assert.equal(restored.regions.length,R.habitatGridSize**2);
  assert.equal(new Set(restored.regions.map(r=>r.id)).size,restored.regions.length);
  assert.ok(restored.regions.every(r=>Number.isFinite(r.nutrients)&&r.nutrients>=0));assert.ok(sumRegions(restored,'nutrients')<=5);
  assert.doesNotMatch(JSON.stringify(restored.regions),/script|untrusted/);
  const missing=clone(e);missing.regions=[];assert.throws(()=>validateEcology(missing),/Protected lifecycle save/);const empty=validateEcology(legacyEcology(missing));
  assert.equal(sumRegions(empty,'nutrients'),0);assert.equal(regionalResourceAudit(empty).unassigned.nutrients,5);
});

test('future regional rules preserve original save bytes and prohibit automatic writes',()=>{
  for(const field of ['regionalVersion','distributionVersion']){
    const raw=migrationFixture(2,{empty:true});raw.environment.ecology[field]=99;
    const text=JSON.stringify(raw),values=new Map([[CONFIG.saveKey,text]]),store={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
    const result=loadSave(store);assert.equal(result.blocked,true);assert.ok(result.error);
    assert.equal(writeSave(store,result.state),false);assert.equal(writeSave(store,raw),false);assert.equal(store.getItem(CONFIG.saveKey),text);
  }
});

test('oversized valid ecology saves are protected rather than truncating historical objects or regions',()=>{
  for(const [key,limit]of [['plants',R.maxPlants],['animals',R.maxAnimals],['materials',R.maxMaterials],['regions',R.habitatGridSize**2]]){
    const raw=migrationFixture(2),e=raw.environment.ecology;
    if(key==='regions'){e.regionalVersion=1;e.regions=createRegions(e.detritus,e.plants);}
    const sample=clone(e[key][0]);e[key]=Array.from({length:limit+1},(_,i)=>({...clone(sample),id:key==='regions'?`region:extra:${i}`:`object:${100000+i}`}));
    const text=JSON.stringify(raw),values=new Map([[CONFIG.saveKey,text]]),store={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
    const result=loadSave(store);assert.equal(result.blocked,true,`${key} must retain source save when the new bound is exceeded`);
    assert.equal(writeSave(store,result.state),false);assert.equal(store.getItem(CONFIG.saveKey),text);
  }
});


test('detritus capacity loss is explicit and conserves independent material mass and calories',()=>{
  const e=fixture({plants:[separatePlants('apple_tree')[0]]}),material=pull(e,e.plants[0]);e.plants=[];
  material.heldBy=null;material.ageHours=MATERIALS.apple.spoilDays*24;
  const r=regionAt(e,material.position);
  e.detritus.massGrams=r.massGrams=r.initialMassGrams=R.maxDetritus;
  resetBudget(e);const mass=material.massGrams,energy=material.energyKcal;tick(e);
  const lostMass=mass-material.massGrams,lostEnergy=energy-material.energyKcal;
  near(e.ledger.discardedDetritusMassGrams,lostMass,1e-9);near(e.ledger.discardedKcal,lostEnergy,1e-9);
  near(e.detritus.massGrams+r.decayedMassGrams+material.massGrams+e.ledger.discardedDetritusMassGrams,R.maxDetritus+mass,1e-8);
  assert.ok(e.detritus.massGrams<R.maxDetritus);assert.equal(r.depositedMassGrams,0);
  checkRegionalBalance(e);checkEnergy(e);
});

test('legacy v1/v2 saves retain legacy rules, prior body and depleted stock without regional seeding',()=>{
  for(const version of [1,2]){
    const raw=freshState({mode:'legacy'});legacySave(raw,version);raw.elapsed=raw.environment.elapsed=123;
    raw.agents[0].hydration=57;raw.agents[0].memory.lessons.push({at:120,verified:'A prior learned routine.',hypothesis:'A possible alternative.'});
    for(const entry of raw.environment.foodStocks){entry.stock=0;entry.renewAt=3600;}
    const restored=validateSave(raw,{restoring:false});assert.equal(restored.simulationMode,'legacy');
    assert.equal(restored.environment.ecology,undefined);assert.equal(restored.cardinal.mode,'observe');
    assert.equal(restored.agents[0].hydration,57);assert.deepEqual(restored.agents[0].memory.lessons,raw.agents[0].memory.lessons);
    assert.ok(restored.environment.foodStocks.every(entry=>entry.stock===0));
  }
});

for(const [name,damage]of [
  ['deleted regions',e=>{delete e.regions;}],['null regions',e=>{e.regions=null;}],
  ['deleted regional version',e=>{delete e.regionalVersion;}],['null regional version',e=>{e.regionalVersion=null;}],
])test(`damaged v3 ${name} cannot refill depleted local soil and is blocked on disk`,()=>{
  const [local,remote]=separatePlants('grass'),fruit=separatePlants('apple_tree')[0];
  const e=fixture({plants:[local,fruit]});e.plants[0].biomassGrams=500;e.plants[0].moisture=.7;e.plants[1].quantity=0;e.plants[1].growth=1;
  assert.equal(regionAt(e,local.position).id,regionAt(e,fruit.position).id);
  putSoil(e,remote.position,100);resetBudget(e);damage(e);
  assert.throws(()=>validateEcology(e),/Protected lifecycle save/);
  const restored=validateEcology(legacyEcology(clone(e)));assert.equal(restored.regionalVersion,1);
  assert.equal(regionAt(restored,local.position).nutrients,0);assert.equal(sumRegions(restored,'nutrients'),0);
  assert.equal(regionalResourceAudit(restored).unassigned.nutrients,100);tick(restored,10);
  assert.equal(restored.plants[0].biomassGrams,500);assert.equal(restored.plants[1].quantity,0);
  assert.equal(restored.detritus.nutrients,100);checkRegionalBalance(restored);checkEnergy(restored);
  const raw=migrationFixture(2,{empty:true});raw.environment.ecology=e;
  const text=JSON.stringify(raw),values=new Map([[CONFIG.saveKey,text]]),store={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
  const result=loadSave(store);assert.equal(result.blocked,true);assert.equal(writeSave(store,result.state),false);
  assert.equal(writeSave(store,raw),false);assert.equal(store.getItem(CONFIG.saveKey),text);
});
