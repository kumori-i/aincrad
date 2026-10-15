import { CONFIG, PONDS, CAVES, CAVE_SPAWN } from './config.js';
import { ECOLOGY_RULES as R, ECOLOGY_SPECIES as SPECIES, ECOLOGY_MATERIALS as MATERIALS } from './ecology-config.js';
import { hash, distance, canStandOutside, canStandCave, waterDistance, riverX, riverWidth, LAKE } from './world.js';
import { environmentConditions } from './environment.js';
import { createPhysiology, validatePhysiology, tickPhysiology, exertPhysiology, ingestMaterial, beginSleep, wakePhysiology, isSleeping } from './biology.js';
import { BIOLOGY_PROFILES } from './biology-config.js';
import { getWorldRule } from './world-rules.js';

const finite = (v,f=0) => Number.isFinite(v)?v:f;
const clamp = (v,lo,hi) => Math.max(lo,Math.min(hi,finite(v,lo)));
const hours = seconds => seconds / CONFIG.dayRealSeconds * 24;
const positionOf = actor => actor?.position || actor;
const idPattern = /^object:[1-9][0-9]{0,8}$/;
const speciesNames = Object.keys(SPECIES);
const materialNames = Object.keys(MATERIALS);
const activities = ['idle','moving','fleeing','chasing','feeding','drinking','resting','sleeping'];
const emptyLedger = () => ({initialKcal:0,photosynthesisKcal:0,humanRemovedKcal:0,metabolizedKcal:0,decomposedKcal:0,discardedKcal:0,birthTransferredKcal:0,externalKcal:0,waterConsumedMl:0,animalAbsorbedKcal:0,animalAbsorbedWaterMl:0,animalWaterLostMl:0});
const nextId = e => `object:${e.nextId++}`;
// Runtime indexes are rebuilt on restoration and never serialized. Local animal
// queries remain proportional to their habitat rather than the whole valley.
const indexes=new WeakMap(),navigation=new WeakMap();
const cellKey=(o)=>`${o.scene}:${Math.floor(o.position.x/R.spatialCell)}:${Math.floor(o.position.y/R.spatialCell)}`;
function invalidateIndex(e){indexes.delete(e);}
function buildIndex(e){
  const index={ids:new Map(),cells:new Map(),species:{},elapsed:e.elapsed,plants:e.plants,animals:e.animals,materials:e.materials,lengths:[e.plants.length,e.animals.length,e.materials.length]};
  for(const o of [...e.plants,...e.animals,...e.materials]){
    index.ids.set(o.id,o);const key=cellKey(o);if(!index.cells.has(key))index.cells.set(key,new Set());index.cells.get(key).add(o);
    if(o.species)index.species[o.species]=(index.species[o.species]||0)+1;
  }
  indexes.set(e,index);return index;
}
function indexFor(e){const i=indexes.get(e);return i&&i.elapsed===e.elapsed&&i.plants===e.plants&&i.animals===e.animals&&i.materials===e.materials&&i.lengths[0]===e.plants.length&&i.lengths[1]===e.animals.length&&i.lengths[2]===e.materials.length?i:buildIndex(e);}
function nearby(e,point,scene,radius){
  const i=indexFor(e),out=[];
  for(let y=Math.floor((point.y-radius)/R.spatialCell);y<=Math.floor((point.y+radius)/R.spatialCell);y++)for(let x=Math.floor((point.x-radius)/R.spatialCell);x<=Math.floor((point.x+radius)/R.spatialCell);x++)
    for(const o of i.cells.get(`${scene}:${x}:${y}`)||[])if(distance(o.position,point)<=radius)out.push(o);
  return out;
}
function movedInIndex(e,o,oldKey){const i=indexes.get(e);if(!i)return;const key=cellKey(o);if(key!==oldKey){i.cells.get(oldKey)?.delete(o);if(!i.cells.has(key))i.cells.set(key,new Set());i.cells.get(key).add(o);}}
function safePoint(x,y,radius=10) {
  if(!Number.isFinite(x)||!Number.isFinite(y))return null;
  x=clamp(x,-CONFIG.halfSize+100,CONFIG.halfSize-100);y=clamp(y,-CONFIG.halfSize+100,CONFIG.halfSize-100);
  if(canStandOutside(x,y,radius))return{x,y};
  for(let ring=1;ring<32;ring++)for(let a=0;a<12;a++){
    const px=x+Math.cos(a*Math.PI/6)*ring*22,py=y+Math.sin(a*Math.PI/6)*ring*22;
    if(canStandOutside(px,py,radius))return{x:px,y:py};
  }
  // A failed placement remains absent. Teleporting distant habitats to the
  // starting village was the cause of the old clustering defect.
  return null;
}
function plant(e,kind,p,index) {
  if(e.plants.length>=R.maxPlants||!p)return null;
  const point=safePoint(p.x,p.y);if(!point)return null;
  const capacity=kind==='grass'?R.grassCapacityGrams:kind==='apple_tree'?10:28;
  const absoluteSeason=R.startSeasonDay+e.elapsed/CONFIG.dayRealSeconds,seasonDay=absoluteSeason%R.yearDays,start=kind==='apple_tree'?65:40,end=kind==='apple_tree'?85:95;
  const ripe=seasonDay>=start&&seasonDay<end;
  const count=kind==='grass'||!ripe?0:Math.round(capacity*(.55+hash(index,8,e.seed)*.35));
  const out={id:nextId(e),kind,scene:'valley',position:point,capacity,quantity:count,
    biomassGrams:kind==='grass'?capacity*(.7+hash(index,9,e.seed)*.2):0,moisture:.65,
    stage:kind==='grass'?'green':ripe?'ripe':seasonDay>=start-12&&seasonDay<start?seasonDay<start-8?'flowering':'growing':'bare',growth:0,seasonIndex:Math.floor(absoluteSeason/R.yearDays),fallHours:0,ageDays:kind==='apple_tree'?2000:400};
  e.plants.push(out);invalidateIndex(e);return out;
}
function animal(e,species,p,elapsed=0,{juvenile=false,energyKcal,structureKcal}={}){
  if(e.animals.length>=R.maxAnimals||!p)return null;
  const rules=SPECIES[species],pos=safePoint(p.x,p.y,rules.radius);
  if(!pos)return null;
  const capacity=BIOLOGY_PROFILES[species].availableCapacityKcal;
  const body=createPhysiology(species,{availableEnergyKcal:energyKcal===undefined?rules.initialReserveKcal*.4:Math.min(capacity,energyKcal),storedEnergyKcal:energyKcal===undefined?rules.initialReserveKcal*.6:Math.max(0,energyKcal-capacity)});
  const out={id:nextId(e),species,scene:'valley',position:pos,physiology:body,health:100,
    energy:80,hydration:100,nourishment:80,stamina:100,fatigue:0,sleepPressure:0,
    thermal:{hot:0,cold:0,wetness:0},bodyMode:'awake',activity:'idle',ageDays:juvenile?0:60,
    structureKcal:structureKcal ?? rules.structureKcal,lastBirthHours:hours(elapsed)-rules.birthIntervalDays*24,
    targetId:null,targetPosition:null,targetKind:null,homePosition:{...pos},lastAttackAt:-100,cooldownHours:0,bornAt:elapsed,
    direction:hash(e.nextId,44,e.seed)*Math.PI*2,actionHours:0};
  e.animals.push(out);invalidateIndex(e);return out;
}
/** Deterministic strata cover the whole walkable valley, including remote edges. */
function habitatAnchors(seed){
  const anchors=[{key:'starter',x:360,y:1080}];
  for(let row=0;row<R.habitatGridSize;row++)for(let col=0;col<R.habitatGridSize;col++){
    const x=-R.habitatExtent+col*(R.habitatExtent*2/(R.habitatGridSize-1)),y=-R.habitatExtent+row*(R.habitatExtent*2/(R.habitatGridSize-1));
    let best=null,score=Infinity;
    // Water-aware within each stratum; never collapse a remote region into a
    // central pond. Grazers also obtain water from their local moist plants.
    for(let n=0;n<20;n++){
      const angle=hash(col*31+n,row*17+11,seed)*Math.PI*2,range=n===0?0:hash(col*17+n,row*29+3,seed)*1100;
      const p=safePoint(x+Math.cos(angle)*range,y+Math.sin(angle)*range,16);if(!p)continue;
      const value=waterDistance(p.x,p.y)+distance(p,{x,y})*.3;
      if(value<score){best=p;score=value;}
    }
    if(best)anchors.push({key:`region:${col}:${row}`,...best});
  }
  for(const pond of PONDS){const p=safePoint(pond.x-pond.rx-130,pond.y+140,16);if(p)anchors.push({key:`pond:${pond.id}`,...p});}
  return anchors;
}
function seedHabitat(e,p,index,{animals=true}={}){
  const beforePlants=e.plants.length,beforeAnimals=e.animals.length;
  plant(e,'apple_tree',p,index);plant(e,'bramble',{x:p.x+130,y:p.y+90},index+100);
  for(let n=0;n<4;n++)plant(e,'grass',{x:p.x+(n%2?160:-120),y:p.y+(n<2?160:-145)},index*4+n);
  if(animals){
    for(let n=0;n<2;n++)animal(e,'rabbit',{x:p.x-90+n*160,y:p.y+180},e.elapsed);
    if(index>0&&index%4===0)animal(e,'fox',{x:p.x+260,y:p.y+130},e.elapsed);
    const [,col,row]=p.key?.split(':')||[],catHabitat=p.key==='pond:oldwood'||Number(row)%2===1&&[1,5].includes(Number(col));
    if(catHabitat)animal(e,'bobcat',{x:p.x-270,y:p.y-200},e.elapsed);
  }
  return{plants:e.plants.length-beforePlants,animals:e.animals.length-beforeAnimals};
}
/** Authoritative starting ecosystem. Tree/animal labels remain private to the engine. */
export function createEcology(seed=CONFIG.seed,elapsed=0) {
  const e={version:R.version,distributionVersion:R.distributionVersion,seed:Number.isInteger(seed)?seed>>>0:CONFIG.seed,elapsed:Math.max(0,finite(elapsed)),pending:0,nextId:1,
    plants:[],animals:[],materials:[],detritus:{massGrams:0,nutrients:2500,energyKcal:0},ledger:emptyLedger(),births:0,deaths:0};
  const anchors=habitatAnchors(e.seed);anchors.forEach((p,i)=>seedHabitat(e,p,i));
  e.detritus.nutrients=Math.max(2500,anchors.length*180);
  e.ledger.initialKcal=ecologyEnergy(e);return e;
}
/** One-time additive v0.6 migration. Existing objects, depletion and bodies are untouched. */
export function migrateEcologyDistribution(e,version=R.distributionVersion){
  if(!e||version!==R.distributionVersion||(e.distributionVersion||1)>=version)return{changed:false,addedPlants:0,addedAnimals:0,externalKcal:0};
  const before=ecologyEnergy(e);let addedPlants=0,addedAnimals=0,addedSoilNutrients=0;
  for(const [i,p]of habitatAnchors(e.seed).entries()){
    // Existing populated habitats are preserved, including depleted fruit trees.
    if(e.plants.some(o=>distance(o.position,p)<1500))continue;
    const added=seedHabitat(e,p,i);addedPlants+=added.plants;addedAnimals+=added.animals;
    if(added.plants){const nutrients=Math.min(180,500000-e.detritus.nutrients);e.detritus.nutrients+=nutrients;addedSoilNutrients+=nutrients;}
  }
  const externalKcal=Math.max(0,ecologyEnergy(e)-before);e.ledger.externalKcal+=externalKcal;e.distributionVersion=version;
  invalidateIndex(e);return{changed:true,addedPlants,addedAnimals,externalKcal,addedSoilNutrients};
}
/** Read-only engine coverage audit, never part of an inhabitant's observation. */
export function ecologyCoverage(e){
  const grid=R.habitatGridSize,cell=R.habitatExtent*2/(grid-1),region=p=>`${Math.floor((p.x+R.habitatExtent+cell/2)/cell)},${Math.floor((p.y+R.habitatExtent+cell/2)/cell)}`;
  const plants=e?.plants||[],animals=e?.animals||[],objects=[...plants,...animals],quadrants={northWest:0,northEast:0,southWest:0,southEast:0};
  for(const o of objects)quadrants[`${o.position.y<0?'north':'south'}${o.position.x<0?'West':'East'}`]++;
  return{distributionVersion:e?.distributionVersion||1,regions:grid*grid,occupiedRegions:new Set(objects.map(o=>region(o.position))).size,plantRegions:new Set(plants.map(o=>region(o.position))).size,animalRegions:new Set(animals.map(o=>region(o.position))).size,quadrants,
    bounds:objects.length?{minX:Math.min(...objects.map(o=>o.position.x)),maxX:Math.max(...objects.map(o=>o.position.x)),minY:Math.min(...objects.map(o=>o.position.y)),maxY:Math.max(...objects.map(o=>o.position.y))}:null,
    plants:plants.length,animals:animals.length,species:Object.fromEntries(speciesNames.map(s=>[s,animals.filter(a=>a.species===s).length]))};
}
function plantEnergy(p){return p.kind==='grass'?p.biomassGrams*R.grassKcalPerGram:p.quantity*(p.kind==='apple_tree'?MATERIALS.apple.energyKcal:MATERIALS.berry.energyKcal);}
function bodyEnergy(p){return Math.max(0,finite(p?.availableEnergyKcal))+Math.max(0,finite(p?.storedEnergyKcal))+(p?.stomach||[]).reduce((n,v)=>n+Math.max(0,finite(v.remainingKcal)),0);}
/** An engine audit, never an agent observation. Transfers are counted once. */
export function ecologyEnergy(e) {
  return (e.plants||[]).reduce((n,p)=>n+plantEnergy(p),0)+(e.animals||[]).reduce((n,a)=>n+a.structureKcal+bodyEnergy(a.physiology),0)+
    (e.materials||[]).reduce((n,m)=>n+m.energyKcal,0)+finite(e.detritus?.energyKcal);
}
export function lookupEcologyObject(e,id) {
  if(!e || typeof id!=='string' || !idPattern.test(id))return null;
  return indexFor(e).ids.get(id)||null;
}
function appearance(o){
  if(o.species){
    const s=o.species;
    return {shape:s==='rabbit'?'small furry body with long ears':s==='bobcat'?'stocky furry body with a short tail':'slender furry body with a long bushy tail',color:s==='rabbit'?'brown-grey':s==='bobcat'?'mottled brown':'russet and pale',texture:'fur',sound:o.activity==='chasing'?'rapid footfalls':o.activity==='sleeping'?'quiet breathing':'soft rustling'};
  }
  if(o.kind==='apple_tree')return{shape:'branching trunk with a leafy crown',color:o.stage==='flowering'?'green and pale blossoms':'brown and green',texture:'rough bark',details:o.quantity?'round red-green growths among leaves':o.stage==='growing'?'small green growths among leaves':'bare branches among leaves'};
  if(o.kind==='bramble')return{shape:'low tangled stems',color:'green and purple',texture:'prickly stems',details:o.quantity?'small purple clusters':'leaves and stems'};
  if(o.kind==='grass')return{shape:'tuft of narrow blades',color:o.moisture<.2?'yellow-green':'green',texture:'fibrous',details:o.biomassGrams<100?'closely cropped':'dense blades'};
  if(o.kind==='carcass')return{shape:'still furry body',color:'brown and dark red',texture:'fur and exposed soft tissue',smell:o.spoiled?'sharp and unpleasant':'strong'};
  const m=MATERIALS[o.materialType]||MATERIALS.grass;
  return{shape:m.shape,color:m.color,texture:m.texture,smell:o.spoiled?'sharp and unpleasant':m.smell};
}
function publicObject(o){return{id:o.id,scene:o.scene,position:{...o.position},appearance:appearance(o),
  motion:o.species?(['moving','fleeing','chasing'].includes(o.activity)?'moving':o.activity==='sleeping'?'still with slow breathing':'still'):'still',
  count:o.species?1:o.kind==='grass'?Math.floor(o.biomassGrams/45):Math.max(1,Math.ceil(o.quantity ?? o.massGrams/100))};}
/** Sensory data contains no diet, food, calorie, species or edibility labels. */
export function senseEcology(e,position,scene='valley',radius=400) {
  if(!e||!position||!Number.isFinite(position.x)||!Number.isFinite(position.y))return[];
  const r=clamp(radius,0,1200);
  return nearby(e,position,scene,r).filter(o=>!o.heldBy).sort((a,b)=>distance(a.position,position)-distance(b.position,position)).slice(0,96).map(publicObject);
}
export function describeEcologyObject(e,id,{actorId}={}) {
  const o=lookupEcologyObject(e,id);if(!o||o.heldBy&&o.heldBy!==actorId)return null;return publicObject(o);
}
/** Private visual-only projection; controllers must use senseEcology instead. */
export function renderEcology(e,scene='valley') {
  if(!e)return[];
  return [...e.plants,...e.animals,...e.materials].filter(o=>o.scene===scene&&!o.heldBy).map(o=>({id:o.id,kind:o.species||o.kind,scene:o.scene,position:{...o.position},x:o.position.x,y:o.position.y,
    stage:o.stage|| (o.spoiled?'spoiled':'fresh'),quantity:o.quantity??1,biomass:o.biomassGrams,biomassRatio:o.kind==='grass'?clamp(o.biomassGrams/o.capacity,0,1):undefined,
    facing:o.species?{x:Math.cos(o.direction),y:Math.sin(o.direction)}:undefined,
    activity:o.activity||'idle',sleeping:o.species?isSleeping(o):false,shape:appearance(o).shape,color:appearance(o).color}));
}
function addDetritus(e,mass,energy){e.detritus.massGrams=Math.min(R.maxDetritus,e.detritus.massGrams+Math.max(0,mass));e.detritus.energyKcal+=Math.max(0,energy);}
function addMaterial(e,type,pos,{massGrams,energyKcal,waterMl,heldBy=null,kind='material'}={}) {
  const def=MATERIALS[type];
  if(e.materials.length>=R.maxMaterials||!pos){e.ledger.discardedKcal+=Math.max(0,finite(energyKcal,def.energyKcal));addDetritus(e,finite(massGrams,def.massGrams),0);return null;}
  const m={id:nextId(e),kind,materialType:type,scene:'valley',position:{...pos},heldBy,
    massGrams:Math.max(0,finite(massGrams,def.massGrams)),energyKcal:Math.max(0,finite(energyKcal,def.energyKcal)),waterMl:Math.max(0,finite(waterMl,def.waterMl)),
    createdAt:e.elapsed,ageHours:0,spoiled:false,digestHours:def.digestHours,toxicity:def.toxicity||0};
  e.materials.push(m);invalidateIndex(e);return m;
}
function detached(e,p,actorId){
  if(p.kind==='apple_tree'||p.kind==='bramble'){
    if(p.quantity<=0)return null;p.quantity--;
    return addMaterial(e,p.kind==='apple_tree'?'apple':'berry',p.position,{heldBy:actorId});
  }
  if(p.kind==='grass'){
    const amount=Math.min(MATERIALS.grass.massGrams,p.biomassGrams);if(amount<1)return null;
    p.biomassGrams-=amount;
    // Human digestion cannot access the cellulose energy rabbits obtain.
    const energy=amount*R.grassKcalPerGram;
    e.ledger.discardedKcal+=energy;
    return addMaterial(e,'grass',p.position,{heldBy:actorId,massGrams:amount,energyKcal:0,waterMl:amount*MATERIALS.grass.waterMl/MATERIALS.grass.massGrams});
  }
  return null;
}
function removeMaterial(e,m){const i=e.materials.indexOf(m);if(i>=0){e.materials.splice(i,1);invalidateIndex(e);}}
function death(e,a){
  if(!e.animals.includes(a))return;
  const energy=a.structureKcal+bodyEnergy(a.physiology),mass=energy/MATERIALS.flesh.energyKcal*MATERIALS.flesh.massGrams;
  addMaterial(e,'flesh',a.position,{kind:'carcass',massGrams:mass,energyKcal:energy,waterMl:mass*.7});
  e.animals.splice(e.animals.indexOf(a),1);e.deaths++;invalidateIndex(e);
}
/** Engine interaction. Reach and ownership are checked again at completion. */
export function interactEcologyObject(e,id,verb,{actorId,position,scene='valley',power=1,amount=.02}={}){
  const o=lookupEcologyObject(e,id);
  if(!o)return{ok:false,code:'object_missing'};
  if(!['aster','mira'].includes(actorId)||!position||!Number.isFinite(position.x)||!Number.isFinite(position.y)||!['valley',...CAVES.map(c=>c.id)].includes(scene)||(scene!==o.scene||distance(position,o.position)>R.reach)&&o.heldBy!==actorId)return{ok:false,code:'object_out_of_reach'};
  if(o.heldBy&&o.heldBy!==actorId)return{ok:false,code:'object_held_elsewhere'};
  if(verb==='inspect_object')return{ok:true,code:'object_observed',targetId:id,object:publicObject(o)};
  if(verb==='grasp'){
    if(o.species)return{ok:false,code:'object_resists_grasp',targetId:id};
    if(o.kind!=='material'&&o.kind!=='carcass')return{ok:false,code:'object_still_attached',targetId:id};
    if(o.kind==='carcass')return{ok:false,code:'object_too_heavy',targetId:id};
    o.heldBy=actorId;return{ok:true,code:'object_held',targetId:id,materialId:id,material:{id}};
  }
  if(verb==='release'){
    if(o.heldBy!==actorId)return{ok:false,code:'object_not_held'};
    o.heldBy=null;o.position={...position};o.scene=scene;invalidateIndex(e);return{ok:true,code:'object_released',targetId:id};
  }
  if(verb==='pull'){
    if(o.species)return{ok:false,code:'object_resists_pull',targetId:id};
    if(o.kind==='carcass'){
      const grams=Math.min(100,o.massGrams),fraction=grams/o.massGrams;
      if(grams<1)return{ok:false,code:'nothing_detached',targetId:id};
      const m=addMaterial(e,'flesh',o.position,{heldBy:actorId,massGrams:grams,energyKcal:o.energyKcal*fraction,waterMl:o.waterMl*fraction});
      o.massGrams-=grams;o.energyKcal*=1-fraction;o.waterMl*=1-fraction;if(o.massGrams<1){addDetritus(e,o.massGrams,o.energyKcal);removeMaterial(e,o);}
      if(!m)return{ok:false,code:'object_limit',targetId:id};m.spoiled=o.spoiled;m.ageHours=o.ageHours;
      return{ok:true,code:'piece_detached',targetId:id,materialId:m.id,material:{id:m.id}};
    }
    const m=detached(e,o,actorId);
    return m?{ok:true,code:'piece_detached',targetId:id,materialId:m.id,material:{id:m.id}}:{ok:false,code:'nothing_detached',targetId:id};
  }
  if(verb==='strike'){
    if(o.species){
      o.physiology.health=Math.max(0,o.physiology.health-clamp(power,0,4)*7);o.health=o.physiology.health;
      wakePhysiology(o,{kind:'contact',strength:1});o.activity='fleeing';o.targetId=null;
      o.targetPosition=safePoint(o.position.x+(o.position.x-position.x)*4,o.position.y+(o.position.y-position.y)*4,SPECIES[o.species].radius);
      if(o.health<=0)death(e,o);
      return{ok:true,code:o.health<=0?'object_stopped_moving':'object_recoiled',targetId:id};
    }
    return{ok:true,code:'object_struck',targetId:id};
  }
  return{ok:false,code:'unknown_primitive',targetId:id};
}
/** A finite held portion; nutrition is returned only to authoritative biology. */
export function consumeEcologyMaterial(e,id,amount=.02,{actorId,accept}={}){
  const m=lookupEcologyObject(e,id);
  if(!m||m.kind!=='material'||m.heldBy!==actorId)return{ok:false,code:'object_not_held'};
  const fraction=clamp(amount,.001,1),energyKcal=m.energyKcal*fraction,waterMl=m.waterMl*fraction,massGrams=m.massGrams*fraction;
  const material={energyKcal,waterMl,massGrams,digestHours:m.digestHours,toxicity:m.toxicity+(m.spoiled?.3:0),objectId:m.id};
  const ingestion=typeof accept==='function'?accept({...material}):null;
  if(ingestion&&ingestion.ok!==true)return{ok:false,code:ingestion.code||'cannot_swallow',ingestion};
  m.energyKcal-=energyKcal;m.waterMl-=waterMl;m.massGrams-=massGrams;e.ledger.humanRemovedKcal+=energyKcal;
  if(m.massGrams<.1){e.ledger.discardedKcal+=m.energyKcal;removeMaterial(e,m);}
  return{ok:true,code:'object_sampled',material,materialId:id,remaining:!!lookupEcologyObject(e,id),...(ingestion?{ingestion}:{})};
}
function season(e,environment){const absolute=R.startSeasonDay+e.elapsed/CONFIG.dayRealSeconds/getWorldRule(environment,'seasonLengthMultiplier');return{day:absolute%R.yearDays,index:Math.floor(absolute/R.yearDays)};}
function growPlants(e,dt,environment){
  const day=hours(dt)/24,s=season(e,environment),weather=environment?.settings?.weatherOverride||environment?.weather?.kind||'clear';
  const growthMultiplier=getWorldRule(environment,'plantGrowthMultiplier'),yieldMultiplier=getWorldRule(environment,'fruitYieldMultiplier');
  const hour=(CONFIG.startHour+hours(e.elapsed))%24,sun=hour>=6&&hour<=19?1:.08;
  const rain=weather==='rainy'?getWorldRule(environment,'rainfallMultiplier'):0;
  for(const p of e.plants){
    p.ageDays+=day;p.moisture=clamp(p.moisture+day*(rain>0?.42*rain:-.06),0,1);
    if(p.kind==='grass'){
      const before=p.biomassGrams,growth=Math.min(e.detritus.nutrients/.004,R.grassGrowthGramsPerDay*growthMultiplier*day*sun*(.15+p.moisture*.85)*Math.max(.03,p.biomassGrams/p.capacity)*(1-p.biomassGrams/p.capacity));
      p.biomassGrams=Math.min(p.capacity,p.biomassGrams+Math.max(0,growth));e.detritus.nutrients=Math.max(0,e.detritus.nutrients-(p.biomassGrams-before)*.004);
      e.ledger.photosynthesisKcal+=(p.biomassGrams-before)*R.grassKcalPerGram;
      if(p.moisture<.1){const lost=p.biomassGrams*day*.06;p.biomassGrams-=lost;addDetritus(e,lost,lost*R.grassKcalPerGram);}
      p.stage=p.moisture<.2?'dry':'green';continue;
    }
    const start=p.kind==='apple_tree'?65:40,end=p.kind==='apple_tree'?85:95;
    if(s.index!==p.seasonIndex){p.seasonIndex=s.index;p.growth=0;p.fallHours=0;}
    if(s.day>=start&&s.day<end){
      p.stage='ripe';p.growth+=day*sun*p.moisture*(p.kind==='apple_tree'?.13:10)*growthMultiplier*yieldMultiplier;
      if(p.growth>=1&&p.quantity<p.capacity){const added=Math.min(Math.floor(p.growth),p.capacity-p.quantity);p.quantity+=added;p.growth-=added;e.ledger.photosynthesisKcal+=added*(p.kind==='apple_tree'?95:19);}
    }else if(s.day<start&&s.day>=start-12){p.stage=s.day<start-8?'flowering':'growing';}
    else p.stage='bare';
    if(p.quantity){
      p.fallHours+=hours(dt);
      const fallAt=(s.day>end?12:R.fruitFallDays*24);
      if(p.fallHours>=fallAt){p.fallHours%=fallAt;p.quantity--;const def=MATERIALS[p.kind==='apple_tree'?'apple':'berry'];
        addMaterial(e,p.kind==='apple_tree'?'apple':'berry',safePoint(p.position.x+45,p.position.y+30),{energyKcal:def.energyKcal});}
    }
  }
}
function nearest(list,a,predicate=()=>true,radius=Infinity){let best=null,d=radius;for(const o of list){if(o===a||o.scene!==a.scene||!predicate(o))continue;const n=distance(a.position,o.position);if(n<d){d=n;best=o;}}return best;}
function clearSegment(from,to,radius){
  const length=distance(from,to),steps=Math.max(1,Math.ceil(length/16));
  for(let i=1;i<=steps;i++)if(!canStandOutside(from.x+(to.x-from.x)*i/steps,from.y+(to.y-from.y)*i/steps,radius))return false;
  return true;
}
/** All candidates must be genuine dry drinking banks, not displaced by a
 * generic placement search. Includes the lake that the old controller omitted. */
function waterBank(a){
  const radius=SPECIES[a.species].radius,candidates=[];
  const add=p=>{const d=waterDistance(p.x,p.y);if(d>=radius+2&&d<=60&&canStandOutside(p.x,p.y,radius))candidates.push(p);};
  for(const pond of [...PONDS,LAKE]){
    const nearAngle=Math.atan2((a.position.y-pond.y)/pond.ry,(a.position.x-pond.x)/pond.rx);
    for(let n=0;n<24;n++){
      const angle=nearAngle+(n?Math.ceil(n/2)*(n%2?1:-1)*Math.PI/12:0),cos=Math.cos(angle),sin=Math.sin(angle);
      // Terrain's actual shoreline has a wavy lake edge. Bracket its dry side
      // using the authoritative distance function instead of an ellipse guess.
      let lo=.75,hi=1.3;
      for(let j=0;j<12;j++){const mid=(lo+hi)/2;if(waterDistance(pond.x+cos*pond.rx*mid,pond.y+sin*pond.ry*mid)<radius+18)lo=mid;else hi=mid;}
      add({x:pond.x+cos*pond.rx*hi,y:pond.y+sin*pond.ry*hi});
    }
  }
  const preferred=a.position.x>=riverX(a.position.y)?1:-1;
  for(let n=0;n<15;n++){
    const y=clamp(a.position.y+(n?Math.ceil(n/2)*(n%2?1:-1)*160:0),-21500,21500);
    for(const side of [preferred,-preferred])add({x:riverX(y)+side*(riverWidth(y)+radius+20),y});
  }
  candidates.sort((p,q)=>distance(a.position,p)-distance(a.position,q));
  return candidates[0]||null;
}
/** Bounded local A*: routes around trees and shore obstacles. It grants no
 * teleportation or human knowledge and replans as new terrain is approached. */
function localRoute(from,destination,radius){
  const grid=64,reach=12,maxNodes=80,dir=[[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
  const length=distance(from,destination),projected=length>640?{x:from.x+(destination.x-from.x)*640/length,y:from.y+(destination.y-from.y)*640/length}:destination;
  const goal=safePoint(projected.x,projected.y,radius);if(!goal)return[];
  const nodes=new Map(),open=[],standing=new Map(),edges=new Map(),point=(x,y)=>({x:from.x+x*grid,y:from.y+y*grid}),key=(x,y)=>`${x},${y}`;
  const stand=(id,p)=>{if(!standing.has(id))standing.set(id,canStandOutside(p.x,p.y,radius));return standing.get(id);};
  const start={x:0,y:0,g:0,f:distance(from,goal),parent:null};nodes.set('0,0',start);open.push(start);let best=start,visited=0;
  while(open.length&&visited++<maxNodes){
    let index=0;for(let i=1;i<open.length;i++)if(open[i].f<open[index].f)index=i;
    const node=open.splice(index,1)[0];if(node.closed)continue;node.closed=true;
    const p=point(node.x,node.y),remaining=distance(p,goal);
    if(remaining<distance(point(best.x,best.y),goal))best=node;
    if(remaining<70&&clearSegment(p,goal,radius)){best=node;break;}
    for(const [dx,dy]of dir){
      const x=node.x+dx,y=node.y+dy;if(Math.abs(x)>reach||Math.abs(y)>reach)continue;
      const to=point(x,y),id=key(x,y),g=node.g+grid*Math.hypot(dx,dy),old=nodes.get(id);if(old&&old.g<=g)continue;
      if(!stand(id,to))continue;
      const edge=[key(node.x,node.y),id].sort().join('>');if(!edges.has(edge))edges.set(edge,clearSegment(p,to,radius));if(!edges.get(edge))continue;
      const next={x,y,g,f:g+distance(to,goal)*1.05,parent:node};nodes.set(id,next);open.push(next);
    }
  }
  if(best===start||length-distance(point(best.x,best.y),destination)<16)return[];
  const route=[];for(let node=best;node.parent;node=node.parent)route.push(point(node.x,node.y));route.reverse();
  if(distance(route.at(-1),goal)<70&&clearSegment(route.at(-1),goal,radius))route.push({...goal});
  return route;
}
function travel(a,destination,dt,stopDistance=0,elapsed=0){
  if(!destination)return 0;
  const p=a.position,startX=p.x,startY=p.y,radius=SPECIES[a.species].radius,total=distance(p,destination);if(total<Math.max(3,stopDistance))return 0;
  let nav=navigation.get(a),target=destination;
  if(nav&&distance(nav.goal,destination)>100){navigation.delete(a);nav=null;}
  if(nav&&nav.failed){if(elapsed>=nav.retryAt){navigation.delete(a);nav=null;}}
  else if(nav){
    while(nav.index<nav.route.length&&distance(p,nav.route[nav.index])<12)nav.index++;
    if(nav.index>=nav.route.length||nav.stalled>2){navigation.delete(a);nav=null;}
    else target=nav.route[nav.index];
  }
  if(!nav){
    const look=Math.min(75,total),ahead={x:p.x+(destination.x-p.x)*look/total,y:p.y+(destination.y-p.y)*look/total};
    if(!clearSegment(p,ahead,radius)){
      const route=localRoute(p,destination,radius);
      if(route.length){nav={goal:{...destination},route,index:0,stalled:0,at:elapsed};navigation.set(a,nav);target=route[0];}
      else{nav={goal:{...destination},route:[],failed:true,retryAt:elapsed+4};navigation.set(a,nav);}
    }
  }
  const dx=target.x-p.x,dy=target.y-p.y,len=Math.hypot(dx,dy);if(len<.001)return 0;
  const bodyFactor=clamp((a.stamina??100)/100,.35,1),speed=SPECIES[a.species].speed*bodyFactor;
  const move=Math.min(speed*dt,Math.max(0,len-(target===destination?stopDistance:0))),steps=Math.max(1,Math.ceil(move/12));let moved=0;
  for(let i=0;i<steps;i++){
    const vx=dx/len*move/steps,vy=dy/len*move/steps,x=p.x,y=p.y;
    if(canStandOutside(p.x+vx,p.y,radius))p.x+=vx;
    if(canStandOutside(p.x,p.y+vy,radius))p.y+=vy;
    if(Math.hypot(p.x-x,p.y-y)<move/steps*.2){
      const side=Number(a.id.split(':')[1])%2?1:-1;
      for(const angle of [side*Math.PI/3,-side*Math.PI/3,side*Math.PI/2,-side*Math.PI/2]){
        const cos=Math.cos(angle),sin=Math.sin(angle),rx=vx*cos-vy*sin,ry=vx*sin+vy*cos;
        if(canStandOutside(p.x+rx,p.y+ry,radius)){p.x+=rx;p.y+=ry;break;}
      }
    }
    moved+=Math.hypot(p.x-x,p.y-y);
  }
  if(nav&&!nav.failed)nav.stalled=moved<move*.2?nav.stalled+dt:0;
  if(moved>0)a.direction=Math.atan2(p.y-startY,p.x-startX);
  return moved;
}
function consumeForAnimal(e,a,source,grams){
  let energy=0,water=0,mass=0;
  if(source.kind==='grass'){
    mass=Math.min(grams,source.biomassGrams);energy=mass*R.grassKcalPerGram;water=mass*R.grassWaterPerGram;
  }else if(source.kind==='apple_tree'||source.kind==='bramble'){
    if(source.quantity<=0)return false;
    const def=MATERIALS[source.kind==='apple_tree'?'apple':'berry'];energy=def.energyKcal;water=def.waterMl;mass=def.massGrams;
  }else{
    if(source.heldBy||source.massGrams<.1)return false;
    mass=Math.min(grams,source.massGrams);const f=mass/source.massGrams;energy=source.energyKcal*f;water=source.waterMl*f;
  }
  if(mass<=0)return false;
  const accepted=ingestMaterial(a,{energyKcal:energy,waterMl:water,massGrams:mass,digestHours:a.species==='rabbit'?2:3,toxicity:source.spoiled?.08:0},{objectId:source.id,source:'instinct'});
  if(accepted?.ok!==true)return false;
  if(source.kind==='grass')source.biomassGrams-=mass;
  else if(source.kind==='apple_tree'||source.kind==='bramble')source.quantity--;
  else {source.massGrams-=mass;source.energyKcal-=energy;source.waterMl-=water;if(source.massGrams<.1){e.ledger.discardedKcal+=source.energyKcal;removeMaterial(e,source);}}
  a.cooldownHours=SPECIES[a.species].biteHours;e.ledger.waterConsumedMl+=water;return true;
}
function selectFood(e,a,environment){
  const rules=SPECIES[a.species],sight=rules.sight*getWorldRule(environment,'animalForagingRangeMultiplier'),local=nearby(e,a.position,a.scene,sight),availablePlants=p=>p.kind==='grass'?p.biomassGrams>10:p.quantity>0;
  const availableMaterials=m=>!m.heldBy&&m.massGrams>1&&(a.species==='rabbit'?m.materialType!=='flesh':a.species==='bobcat'?m.materialType==='flesh':m.materialType!=='grass');
  const detachedFood=nearest(local,a,o=>o.materialType&&availableMaterials(o),sight);
  if(a.species==='bobcat')return detachedFood;
  const growingFood=nearest(local,a,p=>['grass','apple_tree','bramble'].includes(p.kind)&&availablePlants(p)&&(a.species==='rabbit'?p.kind==='grass':p.kind!=='grass'),sight);
  if(!growingFood)return detachedFood;if(!detachedFood)return growingFood;return distance(a.position,growingFood.position)<distance(a.position,detachedFood.position)?growingFood:detachedFood;
}
function decide(e,a,agents,callbacks,environment){
  const rules=SPECIES[a.species],p=a.physiology,sight=rules.sight*getWorldRule(environment,'animalForagingRangeMultiplier'),local=nearby(e,a.position,a.scene,sight),threat=nearest(local,a,b=>b.species&&rules.diet==='herbivore'&&b.species!=='rabbit'&&b.activity!=='sleeping',rules.sight*.65);
  const humanThreat=agents.find(h=>h.scene===a.scene&&distance(a.position,h.position)<65);
  if(threat||humanThreat&&a.species==='rabbit'){
    const source=threat||humanThreat,sp=positionOf(source);wakePhysiology(a,{kind:'sound',strength:.9});a.activity='fleeing';a.targetId=null;
    a.targetPosition={x:clamp(a.position.x+(a.position.x-sp.x)*3,-22000,22000),y:clamp(a.position.y+(a.position.y-sp.y)*3,-22000,22000)};a.targetKind='flee';return;
  }
  if(isSleeping(a)){
    if((a.hydration??100)<35||(a.energy??100)<20)wakePhysiology(a,{kind:'distress',strength:.9});
    else{a.activity='sleeping';a.targetId=null;return;}
  }
  if((a.hydration??100)<60){
    if(waterDistance(a.position.x,a.position.y)<=65){const drank=Math.min(40,p.waterDeficitMl);p.waterDeficitMl-=drank;a.activity='drinking';a.targetPosition=null;e.ledger.waterConsumedMl+=drank;return;}
    if(a.targetKind!=='water'||!a.targetPosition||distance(a.position,a.targetPosition)<5||waterDistance(a.targetPosition.x,a.targetPosition.y)>60)a.targetPosition=waterBank(a);
    a.activity='moving';a.targetId=null;a.targetKind='water';return;
  }
  if(((a.sleepPressure??0)>75||(a.fatigue??0)>80)&&(a.energy??100)>12){beginSleep(a,{hours:Math.min(4,rules.sleepHours),at:e.elapsed});a.activity='sleeping';a.targetId=null;a.targetPosition=null;a.targetKind=null;return;}
  const hungry=(a.energy??100)<20||finite(p.hoursSinceMeal)>6||finite(p.storedEnergyKcal)<BIOLOGY_PROFILES[a.species].storedCapacityKcal*.92;
  if(hungry){
    const source=selectFood(e,a,environment);
    if(source){a.targetId=source.id;a.targetPosition={...source.position};a.targetKind='source';a.activity=distance(a.position,source.position)<=28?'feeding':'moving';return;}
    if(a.species!=='rabbit'){
      const prey=nearest(local,a,b=>b.species==='rabbit',sight);
      if(prey){a.targetId=prey.id;a.targetPosition={...prey.position};a.activity='chasing';return;}
      // Only an extremely depleted predator without another local source risks contact.
      const victim=agents.find(h=>h.scene===a.scene&&h.lifecycle==='AWAKE'&&distance(a.position,h.position)<160);
      if(victim&&(a.energy??100)<15){a.targetId=victim.id;a.targetPosition={...victim.position};a.activity='chasing';return;}
    }
  }
  if((a.sleepPressure??0)>60||(a.fatigue??0)>70){beginSleep(a,{hours:Math.min(3,rules.sleepHours),at:e.elapsed});a.activity='sleeping';a.targetId=null;a.targetPosition=null;return;}
  if((a.stamina??100)<30){a.activity='resting';a.targetId=null;a.targetPosition=null;return;}
  if(!hungry&&Math.floor(hours(e.elapsed)/2)%3!==0){a.activity='resting';a.targetId=null;a.targetPosition=null;a.targetKind=null;return;}
  if(!a.targetPosition||distance(a.position,a.targetPosition)<15||a.targetKind!=='wander'){
    a.direction+=hash(Math.floor(e.elapsed),Number(a.id.split(':')[1]),e.seed)*2-1;
    const home=a.homePosition||a.position,range=a.species==='rabbit'?500:1800;
    a.targetPosition=distance(a.position,home)>range?{...home}:{x:clamp(a.position.x+Math.cos(a.direction)*140,-22000,22000),y:clamp(a.position.y+Math.sin(a.direction)*140,-22000,22000)};
  }
  a.activity='moving';a.targetId=null;a.targetKind='wander';
}
function reproduce(e,a,environment){
  const rules=SPECIES[a.species],p=a.physiology,multiplier=getWorldRule(environment,'animalReproductionMultiplier');
  if(multiplier<=0||a.ageDays<rules.juvenileDays||e.animals.length>=R.maxAnimals||(indexFor(e).species[a.species]||0)>=rules.maxPopulation||
    hours(e.elapsed)-a.lastBirthHours<rules.birthIntervalDays*24/multiplier||(a.hydration??100)<70||(a.energy??100)<70||finite(p.availableEnergyKcal)+finite(p.storedEnergyKcal)<rules.birthKcal+rules.initialReserveKcal*.2)return;
  const local=nearby(e,a.position,a.scene,rules.sight*1.3),mate=nearest(local,a,b=>b.species===a.species&&b.ageDays>=rules.juvenileDays,220);
  if(!mate||a.activity==='chasing'||a.activity==='fleeing')return;
  // Reproductive condition also depends on the local habitat. A full stomach
  // alone cannot support another consumer in a depleted patch.
  if(a.species==='rabbit'){
    const grass=local.filter(v=>v.kind==='grass'&&distance(v.position,a.position)<rules.sight*1.2);
    const dailyProduction=grass.reduce((sum,v)=>sum+R.grassGrowthGramsPerDay*getWorldRule(environment,'plantGrowthMultiplier')*.25*.54*v.moisture*R.grassKcalPerGram*Math.min(1,v.biomassGrams/(v.capacity*.5)),0);
    const expectedCost=BIOLOGY_PROFILES.rabbit.basalKcalPerDay+BIOLOGY_PROFILES.rabbit.walkingKcalPerHour*8;
    const capacity=Math.floor(dailyProduction/expectedCost);
    if(local.filter(v=>v.species==='rabbit').length>=capacity)return;
  }else if(local.filter(v=>v.species==='rabbit'&&distance(v.position,a.position)<rules.sight).length<4)return;
  const childPosition=safePoint(a.position.x+35,a.position.y+20,rules.radius);if(!childPosition)return;
  const available=finite(p.availableEnergyKcal),debit=rules.birthKcal;
  p.availableEnergyKcal=Math.max(0,available-debit);p.storedEnergyKcal=Math.max(0,finite(p.storedEnergyKcal)-Math.max(0,debit-available));
  const reserve=debit*.25,structure=debit-reserve;
  animal(e,a.species,childPosition,e.elapsed,{juvenile:true,energyKcal:reserve,structureKcal:structure});
  a.lastBirthHours=hours(e.elapsed);e.births++;e.ledger.birthTransferredKcal+=debit;
}
function simulationStep(e,dt,environment,agents,callbacks){
  e.elapsed+=dt;growPlants(e,dt,environment);buildIndex(e);
  for(const a of [...e.animals]){
    if(indexFor(e).ids.get(a.id)!==a)continue;
    a.ageDays+=hours(dt)/24;a.cooldownHours=Math.max(0,a.cooldownHours-hours(dt));
    decide(e,a,agents,callbacks,environment);
    const prior=finite(a.physiology?.totals?.metabolizedKcal),discarded=finite(a.physiology?.totals?.discardedKcal);
    const absorbed=finite(a.physiology?.totals?.absorbedKcal),absorbedWater=finite(a.physiology?.totals?.absorbedWaterMl),waterLost=finite(a.physiology?.totals?.waterLostMl);
    const condition=environmentConditions({...environment,elapsed:e.elapsed},a);
    // Fur changes cold exposure without removing weather, wetness or water costs.
    if(condition.feltTemperature<14)condition.feltTemperature+=Math.min(12,14-condition.feltTemperature);
    tickPhysiology(a,dt,condition,{activity:a.activity==='sleeping'?'sleeping':['moving','fleeing','chasing'].includes(a.activity)?a.activity==='moving'?'walking':'running':a.activity==='resting'?'resting':'awake'});
    e.ledger.animalAbsorbedKcal+=Math.max(0,finite(a.physiology?.totals?.absorbedKcal)-absorbed);e.ledger.animalAbsorbedWaterMl+=Math.max(0,finite(a.physiology?.totals?.absorbedWaterMl)-absorbedWater);e.ledger.animalWaterLostMl+=Math.max(0,finite(a.physiology?.totals?.waterLostMl)-waterLost);
    e.ledger.discardedKcal+=Math.max(0,finite(a.physiology?.totals?.discardedKcal)-discarded);
    if(a.health<=0||a.physiology.health<=0){e.ledger.metabolizedKcal+=Math.max(0,finite(a.physiology?.totals?.metabolizedKcal)-prior);death(e,a);continue;}
    if(['moving','fleeing','chasing'].includes(a.activity)){
      const target=lookupEcologyObject(e,a.targetId),victim=a.activity==='chasing'?(target?.species?target:agents.find(h=>h.id===a.targetId)):null;
      const stopDistance=victim?SPECIES[a.species].radius+(victim.species?SPECIES[victim.species].radius:10):0;
      const oldKey=cellKey(a),moved=travel(a,a.targetPosition,dt,stopDistance,e.elapsed);movedInIndex(e,a,oldKey);
      if(moved>0){const lost=finite(a.physiology?.totals?.waterLostMl);exertPhysiology(a,dt*(moved/Math.max(1,SPECIES[a.species].speed*dt)),a.activity==='moving'?1:2.5);e.ledger.animalWaterLostMl+=Math.max(0,finite(a.physiology?.totals?.waterLostMl)-lost);}
    }
    e.ledger.metabolizedKcal+=Math.max(0,finite(a.physiology?.totals?.metabolizedKcal)-prior);
    const target=lookupEcologyObject(e,a.targetId);
    if(a.activity==='feeding'&&target&&a.cooldownHours===0&&distance(a.position,target.position)<30)consumeForAnimal(e,a,target,SPECIES[a.species].biteGrams);
    if(a.activity==='chasing'&&e.elapsed-a.lastAttackAt>=1.5){
      const victim=target?.species?target:agents.find(h=>h.id===a.targetId&&h.scene===a.scene&&h.lifecycle==='AWAKE');
      if(victim&&distance(a.position,victim.position)<SPECIES[a.species].radius+12){
        a.lastAttackAt=e.elapsed;
        if(victim.species){victim.physiology.health=Math.max(0,victim.physiology.health-SPECIES[a.species].huntDamage);victim.health=victim.physiology.health;wakePhysiology(victim,{kind:'contact',strength:1});if(victim.health<=0)death(e,victim);}
        else{const dx=victim.position.x-a.position.x,dy=victim.position.y-a.position.y,norm=Math.hypot(dx,dy);
          const event={damage:Math.min(R.maxHumanAttackDamage,SPECIES[a.species].huntDamage*.25),reason:'animal-contact',sourceId:a.id,stimulus:'contact',direction:norm?{x:dx/norm,y:dy/norm}:{x:-Math.cos(a.direction),y:-Math.sin(a.direction)}};
          callbacks.wake?.(victim,{kind:'contact',intensity:1,strength:1,sourceId:a.id});callbacks.harm?.(victim,event);}
      }
    }
    reproduce(e,a,environment);
  }
  for(const m of [...e.materials]){
    m.ageHours+=hours(dt);m.spoiled=m.ageHours>=MATERIALS[m.materialType].spoilDays*24;
    if(m.spoiled){const f=Math.min(1,hours(dt)/(R.materialDecayDays*24)),mass=m.massGrams*f,energy=m.energyKcal*f;m.massGrams-=mass;m.energyKcal-=energy;m.waterMl*=1-f;addDetritus(e,mass,energy);}
    if(m.massGrams<.1){addDetritus(e,m.massGrams,m.energyKcal);removeMaterial(e,m);}
  }
  const decay=Math.min(e.detritus.energyKcal,e.detritus.energyKcal*hours(dt)/(24*10));
  const decayedMass=e.detritus.massGrams*hours(dt)/(24*10);e.detritus.massGrams=Math.max(0,e.detritus.massGrams-decayedMass);
  e.detritus.energyKcal-=decay;e.ledger.decomposedKcal+=decay;e.detritus.nutrients=Math.min(500000,e.detritus.nutrients+decayedMass*.004);
}
/** Called exactly once by the runtime. Bodies, motion and resources share this clock. */
export function tickEcology(e,dt,environment={},agents=[],callbacks={}){
  if(!e||!Number.isFinite(dt)||dt<=0)return;
  e.pending+=Math.min(dt,CONFIG.dayRealSeconds*7);
  while(e.pending>=R.stepSeconds){e.pending-=R.stepSeconds;simulationStep(e,R.stepSeconds,environment,agents,callbacks);}
}
/** Bounded data-only disk restoration; no arbitrary species, scripts or nutrition. */
export function validateEcology(raw,{seed=CONFIG.seed,elapsed=0}={}){
  if(!raw||raw.version!==R.version)return createEcology(seed,elapsed);
  const out={version:R.version,distributionVersion:raw.distributionVersion===R.distributionVersion?R.distributionVersion:1,seed:Number.isInteger(raw.seed)?raw.seed>>>0:seed,elapsed:clamp(raw.elapsed,0,CONFIG.dayRealSeconds*100000),pending:clamp(raw.pending,0,R.stepSeconds),nextId:1,
    plants:[],animals:[],materials:[],detritus:{massGrams:clamp(raw.detritus?.massGrams,0,R.maxDetritus),nutrients:clamp(raw.detritus?.nutrients,0,500000),energyKcal:clamp(raw.detritus?.energyKcal,0,1e9)},ledger:emptyLedger(),births:clamp(Math.floor(raw.births),0,1e7),deaths:clamp(Math.floor(raw.deaths),0,1e7)};
  const seen=new Set(),acceptId=id=>typeof id==='string'&&idPattern.test(id)&&!seen.has(id),position=(o,radius=10)=>safePoint(o?.position?.x,o?.position?.y,radius);
  const add=(list,o)=>{seen.add(o.id);out.nextId=Math.max(out.nextId,Number(o.id.split(':')[1])+1);list.push(o);};
  for(const p of (Array.isArray(raw.plants)?raw.plants:[]).slice(0,R.maxPlants)){
    if(!acceptId(p?.id)||!['grass','apple_tree','bramble'].includes(p.kind))continue;
    const point=position(p);if(!point)continue;
    const cap=p.kind==='grass'?R.grassCapacityGrams:p.kind==='apple_tree'?10:28;
    add(out.plants,{id:p.id,kind:p.kind,scene:'valley',position:point,capacity:cap,quantity:Math.floor(clamp(p.quantity,0,p.kind==='grass'?0:cap)),biomassGrams:clamp(p.biomassGrams,0,p.kind==='grass'?cap:0),moisture:clamp(p.moisture,0,1),stage:['green','dry','bare','flowering','growing','ripe'].includes(p.stage)?p.stage:'bare',growth:clamp(p.growth,0,100),seasonIndex:clamp(Math.floor(p.seasonIndex),0,100000),fallHours:clamp(p.fallHours,0,R.fruitFallDays*24),ageDays:clamp(p.ageDays,0,100000)});
  }
  for(const a of (Array.isArray(raw.animals)?raw.animals:[]).slice(0,R.maxAnimals)){
    if(!acceptId(a?.id)||!speciesNames.includes(a.species))continue;
    const species=a.species,profile=SPECIES[species];
    const point=position(a,profile.radius);if(!point)continue;
    add(out.animals,{id:a.id,species,scene:'valley',position:point,physiology:validatePhysiology(a.physiology,{profile:species,elapsed:out.elapsed}),health:clamp(a.health,0,100),energy:clamp(a.energy,0,100),hydration:clamp(a.hydration,0,100),nourishment:clamp(a.nourishment,0,100),stamina:clamp(a.stamina,0,100),fatigue:clamp(a.fatigue,0,100),sleepPressure:clamp(a.sleepPressure,0,100),thermal:{hot:clamp(a.thermal?.hot,0,100),cold:clamp(a.thermal?.cold,0,100),wetness:clamp(a.thermal?.wetness,0,100)},bodyMode:['awake','resting','sleeping','dozing'].includes(a.bodyMode)?a.bodyMode:'awake',activity:activities.includes(a.activity)?a.activity:'idle',ageDays:clamp(a.ageDays,0,10000),structureKcal:clamp(a.structureKcal,0,profile.structureKcal),lastBirthHours:clamp(a.lastBirthHours,-2000,hours(out.elapsed)),targetId:idPattern.test(a.targetId)?a.targetId:['aster','mira'].includes(a.targetId)?a.targetId:null,targetKind:['water','source','flee','wander'].includes(a.targetKind)?a.targetKind:null,homePosition:(a.homePosition&&Number.isFinite(a.homePosition.x)&&Number.isFinite(a.homePosition.y)?safePoint(a.homePosition.x,a.homePosition.y,profile.radius):null)||{...point},targetPosition:a.targetPosition&&Number.isFinite(a.targetPosition.x)&&Number.isFinite(a.targetPosition.y)?{x:clamp(a.targetPosition.x,-22000,22000),y:clamp(a.targetPosition.y,-22000,22000)}:null,lastAttackAt:clamp(a.lastAttackAt,-100,out.elapsed),cooldownHours:clamp(a.cooldownHours,0,1),bornAt:clamp(a.bornAt,0,out.elapsed),direction:clamp(a.direction,-100000,100000),actionHours:0});
  }
  for(const m of (Array.isArray(raw.materials)?raw.materials:[]).slice(0,R.maxMaterials)){
    if(!acceptId(m?.id)||!materialNames.includes(m.materialType)||!['material','carcass'].includes(m.kind))continue;
    const def=MATERIALS[m.materialType],cap=m.kind==='carcass'?30000:def.massGrams;
    const mass=clamp(m.massGrams,0,cap),maxEnergy=m.kind==='carcass'?mass*1.5:def.energyKcal*mass/def.massGrams;
    const scene=CAVES.some(c=>c.id===m.scene)?m.scene:'valley';
    const point=scene==='valley'?position(m):canStandCave(m.position?.x,m.position?.y)?{...m.position}:{...CAVE_SPAWN};
    if(!point)continue;
    add(out.materials,{id:m.id,kind:m.kind,materialType:m.materialType,scene,position:point,heldBy:m.kind==='material'&&['aster','mira'].includes(m.heldBy)?m.heldBy:null,massGrams:mass,energyKcal:clamp(m.energyKcal,0,maxEnergy),waterMl:clamp(m.waterMl,0,mass),createdAt:clamp(m.createdAt,0,out.elapsed),ageHours:clamp(m.ageHours,0,100000),spoiled:!!m.spoiled,digestHours:def.digestHours,toxicity:def.toxicity||0});
  }
  for(const k of Object.keys(out.ledger))out.ledger[k]=clamp(raw.ledger?.[k],0,1e12);
  out.nextId=Math.max(out.nextId,Math.floor(clamp(raw.nextId,1,1e9)));return out;
}
