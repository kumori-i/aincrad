import { CONFIG, PONDS, CAVES, CAVE_SPAWN } from './config.js';
import { ECOLOGY_RULES as R, ECOLOGY_SPECIES as SPECIES, ECOLOGY_MATERIALS as MATERIALS } from './ecology-config.js';
import { hash, distance, canStandOutside, canStandCave, waterDistance, riverX, riverWidth, LAKE } from './world.js';
import { environmentConditions } from './environment.js';
import { createPhysiology, validatePhysiology, tickPhysiology, exertPhysiology, ingestMaterial, beginSleep, wakePhysiology, isSleeping } from './biology.js';
import { BIOLOGY_PROFILES } from './biology-config.js';
import { getWorldRule } from './world-rules.js';
import { habitatConditions, plantSuitability, initializeRegions, validateRegions, regionAt, consumeSoil, advanceRegionalWater, consumeConnectedGrowth } from './ecology-regions.js';
import { buildHabitatCorridors, sampleCorridor } from './ecology-corridors.js';
import { JUVENILE_RULES as J, seedTransfer, juvenileGrowth, juvenileLoss, juvenileStrikeLoss } from './plant-lifecycle.js';
import { freshPlantLifecycle, freshMaterialLifecycle, freshLifecycleLedger, lifecycleError, hasLifecyclePayload, PLANT_FIELDS, MATERIAL_FIELDS, stockTolerance, lifecycleStockAudit, lifecycleRestorationError } from './plant-lifecycle-state.js';
import { geometryForOzarkEcology } from './ozark-ecology.js';

const finite = (v,f=0) => Number.isFinite(v)?v:f;
const clamp = (v,lo,hi) => Math.max(lo,Math.min(hi,finite(v,lo)));
const hours = seconds => seconds / CONFIG.dayRealSeconds * 24;
const positionOf = actor => actor?.position || actor;
// Preserve floating-point stock roundoff rather than manufacturing a transfer
// during restoration; materially out-of-bound values retain legacy clipping.
const stockClamp=(v,lo,hi)=>Number.isFinite(v)&&v>=lo-stockTolerance(v,lo)&&v<=hi+stockTolerance(v,hi)?v:clamp(v,lo,hi);
const idPattern = /^object:[1-9][0-9]{0,8}$/;
const speciesNames = Object.keys(SPECIES);
const materialNames = Object.keys(MATERIALS);
const activities = ['idle','moving','fleeing','chasing','feeding','drinking','resting','sleeping'];
const emptyLedger = () => ({initialKcal:0,photosynthesisKcal:0,humanRemovedKcal:0,metabolizedKcal:0,decomposedKcal:0,discardedKcal:0,birthTransferredKcal:0,externalKcal:0,waterConsumedMl:0,animalAbsorbedKcal:0,animalAbsorbedWaterMl:0,animalWaterLostMl:0,discardedDetritusMassGrams:0});
const nextId = e => `object:${e.nextId++}`;
// Runtime indexes are rebuilt on restoration and never serialized. Local animal
// queries remain proportional to their habitat rather than the whole valley.
const indexes=new WeakMap(),navigation=new WeakMap(),plantSites=new WeakMap();
const siteModel=e=>e?.ecosystemModelVersion===1?1:0;
function plantConditions(e,p){
  const model=siteModel(e),saved=plantSites.get(p);if(saved&&saved.x===p.position.x&&saved.y===p.position.y&&saved.model===model)return saved.site;
  const site=habitatConditions(p.position,model);plantSites.set(p,{x:p.position.x,y:p.position.y,model,site});return site;
}
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
function plantRecord(e,kind,point,index,id) {
  const capacity=kind==='grass'?R.grassCapacityGrams:kind==='apple_tree'?10:28;
  const absoluteSeason=R.startSeasonDay+e.elapsed/CONFIG.dayRealSeconds,seasonDay=absoluteSeason%R.yearDays,start=kind==='apple_tree'?65:40,end=kind==='apple_tree'?85:95;
  const ripe=seasonDay>=start&&seasonDay<end;
  const count=kind==='grass'||!ripe?0:Math.round(capacity*(.55+hash(index,8,e.seed)*.35));
  return {id,kind,scene:'valley',position:point,capacity,quantity:count,
    biomassGrams:kind==='grass'?capacity*(.7+hash(index,9,e.seed)*.2):0,moisture:habitatConditions(point,siteModel(e)).moisture,
    stage:kind==='grass'?'green':ripe?'ripe':seasonDay>=start-12&&seasonDay<start?seasonDay<start-8?'flowering':'growing':'bare',growth:0,seasonIndex:Math.floor(absoluteSeason/R.yearDays),fallHours:0,ageDays:kind==='apple_tree'?2000:400,...freshPlantLifecycle()};
}
function plant(e,kind,p,index) {
  if(e.plants.length>=R.maxPlants-(siteModel(e)?32:0)||!p)return null;
  const point=safePoint(p.x,p.y);if(!point||!plantSuitability(kind,point,siteModel(e)))return null;
  const out=plantRecord(e,kind,point,index,nextId(e));
  e.plants.push(out);invalidateIndex(e);return out;
}
function animal(e,species,p,elapsed=0,{juvenile=false,energyKcal,structureKcal}={}){
  if(e.animals.length>=R.maxAnimals||!p||e.animals.filter(a=>a.species===species).length>=SPECIES[species].maxPopulation)return null;
  const rules=SPECIES[species],pos=safePoint(p.x,p.y,rules.radius);
  // Initial communities must see real water. Offspring inherit normal local
  // birth rules after their parents move; capacity never fabricates a route.
  if(!pos||siteModel(e)&&!juvenile&&waterDistance(pos.x,pos.y)>rules.sight*.95)return null;
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
/** Hydric refuges are geography, not the characters' spawn or a food oracle. */
export function regionalHabitatAnchors(model=0){
  const anchors=[{key:'pond:spring',...safePoint(360,1080,16),grass:10,rabbits:4}];
  for(const pond of PONDS.filter(p=>p.id!=='spring')){
    const point=safePoint(pond.x-pond.rx-130,pond.y+140,16);
    if(point)anchors.push({key:`pond:${pond.id}`,...point,grass:10,rabbits:4});
  }
  // A connected, productive western lakeshore supports a larger prey community.
  // It is remote from both human starts. Each stock is still individually finite.
  for(let n=0;n<5;n++){
    const y=-7300+n*400;
    let x=-7200+(n%2)*110;
    if(model===1){
      // Locate this section of the actual wavy shoreline, then remain dry.
      // The old fixed anchors remain unchanged in historical expeditions.
      let outside=LAKE.x-LAKE.rx*1.5,inside=LAKE.x;
      for(let j=0;j<18;j++){
        const mid=(outside+inside)/2;
        if(waterDistance(mid,y)>130)outside=mid;else inside=mid;
      }
      x=outside;
    }
    const point=safePoint(x,y,16);
    if(point)anchors.push({key:`lake:west:${n}`,...point,grass:30,rabbits:14});
  }
  for(const [n,y]of [-18000,-12000,10500,19000].entries()){
    const point=safePoint(riverX(y)+(n%2?1:-1)*(riverWidth(y)+200),y,16);
    if(point)anchors.push({key:`river:${n}`,...point,grass:8,rabbits:3});
  }
  return anchors;
}

function seedRegionalWorld(e){
  const anchors=regionalHabitatAnchors(siteModel(e));
  for(const [index,p]of anchors.entries()){
    const site=habitatConditions(p,siteModel(e)),apple=site.moisture>.4&&site.temperatureOffsetC>-2.5;
    // Keep one individual of each eligible producer, with variable grass density.
    if(apple)plant(e,'apple_tree',p,index);
    plant(e,'bramble',{x:p.x+110,y:p.y+70},index+100);
    if(site.moisture>.6)plant(e,'bramble',{x:p.x-100,y:p.y+70},index+200);
    const grassCount=siteModel(e)?Math.round(p.grass*clamp(site.productivity,.45,1.25)):p.grass;
    for(let n=0;n<grassCount;n++){
      const angle=n*2.399963229728653,radius=70+Math.sqrt(n/grassCount)*230;
      plant(e,'grass',{x:p.x+Math.cos(angle)*radius,y:p.y+Math.sin(angle)*radius},index*40+n);
    }
    // Actual reachable local production, not a fixed pair in every map cell.
    const grasses=e.plants.filter(o=>o.kind==='grass'&&distance(o.position,p)<380);
    const daily=grasses.reduce((sum,g)=>sum+R.grassGrowthGramsPerDay*.25*.54*(.15+g.moisture*.85)*habitatConditions(g.position,siteModel(e)).productivity*R.grassKcalPerGram,0);
    const demand=BIOLOGY_PROFILES.rabbit.basalKcalPerDay+BIOLOGY_PROFILES.rabbit.walkingKcalPerHour*8;
    const count=Math.min(p.rabbits,Math.floor(daily/demand*.8));
    for(let n=0;n<count;n++){
      const angle=n*2.399963229728653,radius=65+Math.sqrt(n/Math.max(1,count))*130;
      animal(e,'rabbit',{x:p.x+Math.cos(angle)*radius,y:p.y+Math.sin(angle)*radius},e.elapsed);
    }
  }
  // Drier/high regions have lower-density, different producer communities.
  // They are not forced to contain water-dependent consumers or all fruit types.
  for(const [index,p]of habitatAnchors(e.seed).filter(p=>p.key.startsWith('region:')).entries()){
    if(e.plants.some(o=>distance(o.position,p)<450))continue;
    const site=habitatConditions(p,siteModel(e));
    plant(e,'grass',p,1000+index);
    plant(e,site.kind==='woodland'||site.kind==='riparian'?'bramble':'grass',{x:p.x+120,y:p.y+90},1100+index);
    if(site.kind==='woodland'&&site.moisture>.42)plant(e,'apple_tree',{x:p.x-110,y:p.y+80},1200+index);
  }
  const corridors=buildHabitatCorridors(anchors),corridorGrass=[];
  for(const [index,route]of corridors.entries())for(const [step,p]of sampleCorridor(route.points,siteModel(e)?380:300).entries()){
    if(e.plants.some(o=>distance(o.position,p)<130))continue;
    const seedIndex=2000+index*200+step,grass=plant(e,'grass',p,seedIndex);
    if(grass)corridorGrass.push({grass,seedIndex});
    const site=habitatConditions(p,siteModel(e));
    if(step%4===0&&site.moisture>.38)plant(e,'bramble',{x:p.x+45,y:p.y+35},5000+index*200+step);
  }
  // Exchange a few corridor grasses for fruiting plants at physically suitable
  // remote sites. The existing corridor stays vegetated, counts and IDs stay
  // fixed, and none of the hydric grasses that budget initial prey are touched.
  const fruit=e.plants.filter(p=>p.kind==='bramble'||p.kind==='apple_tree').map(p=>p.position),chosen=[];
  for(let n=0;n<3;n++){
    let best=null,bestGap=600;
    for(const candidate of corridorGrass){
      const p=candidate.grass.position;
      if(chosen.some(point=>distance(point,p)<700)||anchors.some(anchor=>distance(anchor,p)<450)||!plantSuitability('bramble',p,siteModel(e)))continue;
      const gap=Math.min(...fruit.map(point=>distance(point,p)));
      if(gap>bestGap){best=candidate;bestGap=gap;}
    }
    if(!best)break;
    const old=best.grass,replacement=plantRecord(e,'bramble',old.position,best.seedIndex,old.id);
    e.plants[e.plants.indexOf(old)]=replacement;fruit.push(replacement.position);chosen.push(replacement.position);
    corridorGrass.splice(corridorGrass.indexOf(best),1);
  }
  if(chosen.length)invalidateIndex(e);
  // Reserve the reachable birth-energy budget once across carnivores. This is
  // a conservative placement screen, not evidence of realized reproduction.
  const lake=anchors.find(a=>a.key==='lake:west:2');
  if(lake){
    const prey=e.animals.filter(a=>a.species==='rabbit'&&distance(a.position,lake)<1500);
    let surplus=prey.length*SPECIES.rabbit.birthKcal/SPECIES.rabbit.birthIntervalDays*.9;
    for(const [i,species]of ['bobcat','fox'].entries()){
      const body=BIOLOGY_PROFILES[species],demand=body.basalKcalPerDay+body.walkingKcalPerHour*8;
      if(surplus<demand)continue;
      const placed=animal(e,species,{x:lake.x+180+i*80,y:lake.y+80},e.elapsed);
      if(placed)surplus-=demand;
    }
  }
}

/** Read-only geographical evidence. Routes are never supplied to inhabitants. */
export function ecologyHabitatAudit(e){
  const anchors=regionalHabitatAnchors(siteModel(e)),routes=buildHabitatCorridors(anchors);
  return {anchors:anchors.map(p=>({key:p.key,position:{x:p.x,y:p.y},conditions:habitatConditions(p,siteModel(e)),
    plants:e.plants.filter(o=>distance(o.position,p)<400).length,
    rabbits:e.animals.filter(a=>a.species==='rabbit'&&distance(a.position,p)<450).length})),
    habitatKinds:[...new Set(e.plants.map(p=>habitatConditions(p.position,siteModel(e)).kind))].sort(),
    corridors:routes.map(r=>({from:r.from,to:r.to,length:r.length,points:r.points.map(p=>({...p}))})),failures:routes.failures||[]};
}

/** Authoritative starting ecosystem. Tree/animal labels remain private to the engine. */
export function createEcology(seed=CONFIG.seed,elapsed=0,{connectedEcology=false}={}) {
  const e={version:R.version,distributionVersion:R.distributionVersion,seed:Number.isInteger(seed)?seed>>>0:CONFIG.seed,elapsed:Math.max(0,finite(elapsed)),pending:0,nextId:1,
    ...(connectedEcology?{ecosystemModelVersion:1}:{}),plants:[],animals:[],materials:[],detritus:{massGrams:0,nutrients:2500,energyKcal:0},ledger:emptyLedger(),lifecycle:freshLifecycleLedger(),births:0,deaths:0};
  seedRegionalWorld(e);
  e.detritus.nutrients=Math.max(2500,e.plants.length*34);
  initializeRegions(e);
  e.ledger.initialKcal=ecologyEnergy(e);return e;
}
/** One-time stock partition. Old worlds keep their exact existing ecology. */
export function migrateEcologyDistribution(e,version=R.distributionVersion){
  if(!e||version!==R.distributionVersion||(e.distributionVersion||1)>=version)return{changed:false,addedPlants:0,addedAnimals:0,externalKcal:0};
  initializeRegions(e);e.distributionVersion=version;
  return{changed:true,addedPlants:0,addedAnimals:0,externalKcal:0,addedSoilNutrients:0};
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
function plantEnergy(p){return (p.kind==='grass'?p.biomassGrams*R.grassKcalPerGram:p.quantity*(p.kind==='apple_tree'?MATERIALS.apple.energyKcal:MATERIALS.berry.energyKcal))+finite(p.structureKcal);}
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
  if(o.lifecycleStage==='juvenile')return{shape:o.stage==='seedling'?'small stem with a few leaves':'slender branching stem with leaves',color:o.moisture<.1?'yellow-green and brown':'green and brown',texture:o.stage==='seedling'?'soft stem':'thin bark',details:'leaves above the ground'};
  if(o.kind==='apple_tree')return{shape:'branching trunk with a leafy crown',color:o.stage==='flowering'?'green and pale blossoms':'brown and green',texture:'rough bark',details:o.quantity?'round red-green growths among leaves':o.stage==='growing'?'small green growths among leaves':'bare branches among leaves'};
  if(o.kind==='bramble')return{shape:'low tangled stems',color:'green and purple',texture:'prickly stems',details:o.quantity?'small purple clusters':'leaves and stems'};
  if(o.kind==='grass')return{shape:'tuft of narrow blades',color:o.moisture<.2?'yellow-green':'green',texture:'fibrous',details:o.biomassGrams<100?'closely cropped':'dense blades'};
  if(o.kind==='carcass')return{shape:'still furry body',color:'brown and dark red',texture:'fur and exposed soft tissue',smell:o.spoiled?'sharp and unpleasant':'strong'};
  const m=MATERIALS[o.materialType]||MATERIALS.grass;
  return{shape:m.shape,color:m.color,texture:m.texture,smell:o.spoiled?'sharp and unpleasant':m.smell};
}
function publicObject(o){return{id:o.id,scene:o.scene,position:{...o.position},appearance:appearance(o),
  motion:o.species?(['moving','fleeing','chasing'].includes(o.activity)?'moving':o.activity==='sleeping'?'still with slow breathing':'still'):'still',
  count:o.species?1:o.kind==='grass'?Math.floor(o.biomassGrams/45):o.kind==='apple_tree'||o.kind==='bramble'?Math.max(0,Math.ceil(o.quantity)):Math.max(1,Math.ceil(o.quantity ?? o.massGrams/100))};}
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
    stage:o.stage|| (o.spoiled?'spoiled':'fresh'),structureRatio:o.lifecycleStage==='juvenile'?clamp(o.structureMassGrams/J.maxMassGrams,0,1):undefined,quantity:o.quantity??1,biomass:o.biomassGrams,biomassRatio:o.kind==='grass'?clamp(o.biomassGrams/o.capacity,0,1):undefined,
    moistureRatio:siteModel(e)&&['grass','apple_tree','bramble'].includes(o.kind)?clamp(o.moisture,0,1):undefined,
    facing:o.species?{x:Math.cos(o.direction),y:Math.sin(o.direction)}:undefined,
    activity:o.activity||'idle',sleeping:o.species?isSleeping(o):false,shape:appearance(o).shape,color:appearance(o).color}));
}
function addDetritus(e,mass,energy,position,scene='valley'){
  mass=Math.max(0,mass);energy=Math.max(0,energy);
  const admitted=Math.min(mass,Math.max(0,R.maxDetritus-e.detritus.massGrams));
  const retained=mass>0?Math.min(energy,energy*admitted/mass):energy;
  e.detritus.massGrams+=admitted;e.detritus.energyKcal+=retained;e.ledger.discardedKcal+=energy-retained;
  e.ledger.discardedDetritusMassGrams=(e.ledger.discardedDetritusMassGrams||0)+mass-admitted;
  const region=position?regionAt(e,position,scene):null;
  if(region){region.massGrams+=admitted;region.energyKcal+=retained;region.depositedMassGrams+=admitted;region.depositedKcal+=retained;}
}
function addMaterial(e,type,pos,{massGrams,energyKcal,waterMl,heldBy=null,kind='material'}={}) {
  const def=MATERIALS[type];
  if(e.materials.length>=R.maxMaterials||!pos){e.ledger.discardedKcal+=Math.max(0,finite(energyKcal,def.energyKcal));addDetritus(e,finite(massGrams,def.massGrams),0,pos);return null;}
  const m={id:nextId(e),kind,materialType:type,scene:'valley',position:{...pos},heldBy,
    massGrams:Math.max(0,finite(massGrams,def.massGrams)),energyKcal:Math.max(0,finite(energyKcal,def.energyKcal)),waterMl:Math.max(0,finite(waterMl,def.waterMl)),
    createdAt:e.elapsed,ageHours:0,spoiled:false,digestHours:def.digestHours,toxicity:def.toxicity||0,...freshMaterialLifecycle(type==='apple'&&kind==='material',e.elapsed)};
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
    const ozark=geometryForOzarkEcology(e);
    if(e.ozarkEcologyVersion===1&&(!ozark||scene!=='valley'||
        !ozark.canOccupy(position.x,position.y,CONFIG.playerRadius)))
      return{ok:false,code:'object_out_of_reach',targetId:id};
    o.heldBy=null;o.position={...position};o.scene=scene;invalidateIndex(e);return{ok:true,code:'object_released',targetId:id};
  }
  if(verb==='pull'){
    if(o.species)return{ok:false,code:'object_resists_pull',targetId:id};
    if(o.kind==='carcass'){
      const grams=Math.min(100,o.massGrams),fraction=grams/o.massGrams;
      if(grams<1)return{ok:false,code:'nothing_detached',targetId:id};
      const m=addMaterial(e,'flesh',o.position,{heldBy:actorId,massGrams:grams,energyKcal:o.energyKcal*fraction,waterMl:o.waterMl*fraction});
      o.massGrams-=grams;o.energyKcal*=1-fraction;o.waterMl*=1-fraction;if(o.massGrams<1){addDetritus(e,o.massGrams,o.energyKcal,o.position,o.scene);removeMaterial(e,o);}
      if(!m)return{ok:false,code:'object_limit',targetId:id};m.spoiled=o.spoiled;m.ageHours=o.ageHours;
      return{ok:true,code:'piece_detached',targetId:id,materialId:m.id,material:{id:m.id}};
    }
    const m=detached(e,o,actorId);
    return m?{ok:true,code:'piece_detached',targetId:id,materialId:m.id,material:{id:m.id}}:{ok:false,code:'nothing_detached',targetId:id};
  }
  if(verb==='strike'){
    if(o.lifecycleStage==='juvenile'&&o.kind==='apple_tree'&&Number.isFinite(o.recruitedAt)&&o.recruitedAt>=0&&o.recruitedAt<=e.elapsed&&idPattern.test(o.parentMaterialId)&&o.parentMaterialId!==o.id){
      const loss=juvenileStrikeLoss({massGrams:o.structureMassGrams,energyKcal:o.structureKcal,waterMl:o.structureWaterMl},{power});
      if(!loss)return{ok:false,code:'invalid_power',targetId:id};
      if(loss.lost.massGrams===0)return{ok:true,code:'object_struck',targetId:id};
      if(commitJuvenileLoss(e,o,loss)){
        e.plants.splice(e.plants.indexOf(o),1);invalidateIndex(e);
      }
      return{ok:true,code:loss.terminal?'object_broken':'object_damaged',targetId:id};
    }
    if(o.species){
      const ozark=geometryForOzarkEcology(e);
      if(e.ozarkEcologyVersion===1&&!ozark)return{ok:false,code:'geometry_unavailable',targetId:id};
      o.physiology.health=Math.max(0,o.physiology.health-clamp(power,0,4)*7);o.health=o.physiology.health;
      wakePhysiology(o,{kind:'contact',strength:1});o.activity='fleeing';o.targetId=null;
      const ox=o.position.x-position.x,oy=o.position.y-position.y;
      if(ozark){
        o.targetPosition=[4,2,1].map(scale=>({x:o.position.x+ox*scale,y:o.position.y+oy*scale}))
          .find(point=>ozark.classify(point.x,point.y,SPECIES[o.species].radius).reason==='dry-ground')||null;
      }else o.targetPosition=safePoint(o.position.x+ox*4,o.position.y+oy*4,SPECIES[o.species].radius);
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
  const hour=Number.isFinite(environment?.settings?.hourOverride)?environment.settings.hourOverride:(CONFIG.startHour+hours(e.elapsed))%24,sun=hour>=6&&hour<=19?1:.08;
  const rain=weather==='rainy'?getWorldRule(environment,'rainfallMultiplier'):0,dead=[];
  // Explicit boundary inputs are useful for controlled copied-world fixtures;
  // ordinary worlds use their weather and the declared seepage/evaporation rates.
  if(siteModel(e))advanceRegionalWater(e,dt,{rainfall:environment?.regionalWaterInputs?.rainfall??rain,
    seepage:environment?.regionalWaterInputs?.seepage??1,evaporation:environment?.regionalWaterInputs?.evaporation??1});
  for(const p of e.plants){
    const site=e.regionalVersion===1?plantConditions(e,p):null;
    p.ageDays+=day;
    if(siteModel(e)){
      const region=regionAt(e,p.position),saturation=region?region.soilWaterMl/region.soilWaterCapacityMl:0;
      p.moisture=clamp(saturation*clamp((site?.moisture??0)*1.3,.15,1),0,1);
    }else p.moisture=clamp(p.moisture+day*((rain>0?.42*rain:-.06)+(site?(site.moisture-p.moisture)*.35:0)),0,1);
    if(p.lifecycleStage==='juvenile'){
      if(growJuvenile(e,p,day,sun===1?1:0,site,growthMultiplier))dead.push(p);continue;
    }
    if(p.kind==='grass'){
      const before=p.biomassGrams,growth=Math.min((regionAt(e,p.position)?.nutrients??e.detritus.nutrients)/.004,R.grassGrowthGramsPerDay*growthMultiplier*(site?.productivity??1)*day*sun*(.15+p.moisture*.85)*Math.max(.03,p.biomassGrams/p.capacity)*(1-p.biomassGrams/p.capacity));
      const added=siteModel(e)?growth*consumeConnectedGrowth(e,p.position,Math.max(0,growth)*.004,Math.max(0,growth)*R.grassWaterPerGram).fraction:consumeSoil(e,p.position,Math.max(0,growth)*.004)/.004;
      p.biomassGrams=Math.min(p.capacity,p.biomassGrams+added);
      e.ledger.photosynthesisKcal+=(p.biomassGrams-before)*R.grassKcalPerGram;
      if(p.moisture<.1){const lost=p.biomassGrams*day*.06;p.biomassGrams-=lost;addDetritus(e,lost,lost*R.grassKcalPerGram,p.position);}
      p.stage=p.moisture<.2?'dry':'green';continue;
    }
    const start=p.kind==='apple_tree'?65:40,end=p.kind==='apple_tree'?85:95;
    if(s.index!==p.seasonIndex){p.seasonIndex=s.index;p.growth=0;p.fallHours=0;}
    if(s.day>=start&&s.day<end){
      p.stage='ripe';p.growth=Math.min(1,p.growth+day*sun*p.moisture*(site?.productivity??1)*(p.kind==='apple_tree'?.13:10)*growthMultiplier*yieldMultiplier);
      if(p.growth>=1&&p.quantity<p.capacity){
        const material=MATERIALS[p.kind==='apple_tree'?'apple':'berry'],cost=material.massGrams*.004;
        const soil=regionAt(e,p.position)?.nutrients??e.detritus.nutrients;
        const region=regionAt(e,p.position);
        const waterLimit=siteModel(e)?Math.floor(((region?.soilWaterMl??0)+1e-10)/material.waterMl):Infinity;
        const wanted=Math.min(Math.floor(p.growth),p.capacity-p.quantity,Math.floor((soil+1e-10)/cost),waterLimit);
        if(wanted>0){
          const added=siteModel(e)?Math.floor(wanted*consumeConnectedGrowth(e,p.position,wanted*cost,wanted*material.waterMl).fraction+1e-9):wanted;
          if(!siteModel(e))consumeSoil(e,p.position,added*cost);
          p.quantity+=added;p.growth-=added;e.ledger.photosynthesisKcal+=added*material.energyKcal;
        }
      }
    }else if(s.day<start&&s.day>=start-12){p.stage=s.day<start-8?'flowering':'growing';}
    else p.stage='bare';
    if(p.quantity){
      p.fallHours+=hours(dt);
      const fallAt=(s.day>end?12:R.fruitFallDays*24);
      if(p.fallHours>=fallAt){p.fallHours%=fallAt;p.quantity--;const def=MATERIALS[p.kind==='apple_tree'?'apple':'berry'];
        addMaterial(e,p.kind==='apple_tree'?'apple':'berry',safePoint(p.position.x+45,p.position.y+30),{energyKcal:def.energyKcal});}
    }
  }
  if(dead.length){for(const p of dead)e.plants.splice(e.plants.indexOf(p),1);invalidateIndex(e);}
}
/** Juveniles have no fruit or retroactive mature biomass. All structural input
 * is explicit; actual local soil admission, not requested demand, funds growth. */
function growJuvenile(e,p,days,daylight,site,multiplier){
  const current={massGrams:p.structureMassGrams,energyKcal:p.structureKcal,waterMl:p.structureWaterMl};
  const region=regionAt(e,p.position),crowding=nearby(e,p.position,'valley',64).filter(o=>o!==p&&o.kind==='apple_tree').length;
  const growth=juvenileGrowth(current,{days,moisture:p.moisture,daylight,productivity:(site?.productivity??0)/(1+crowding*.5),multiplier,soilNutrients:region?.nutrients??0});
  if(growth&&growth.nutrientCost>0){
    const admission=siteModel(e)?consumeConnectedGrowth(e,p.position,growth.nutrientCost,growth.input.massGrams*J.growthWaterMlPerGram):null;
    const taken=admission?admission.nutrients:consumeSoil(e,p.position,growth.nutrientCost),g=admission?growth.input.massGrams*admission.fraction:Math.min(growth.input.massGrams,taken/J.nutrientsPerGram);
    const energy=g*J.growthKcalPerGram,water=g*J.growthWaterMlPerGram;
    current.massGrams+=g;current.energyKcal+=energy;current.waterMl+=water;
    e.lifecycle.growthMassGrams+=g;e.lifecycle.growthKcal+=energy;e.lifecycle.growthWaterMl+=water;e.lifecycle.nutrientUptake+=taken;
    e.ledger.photosynthesisKcal+=energy;
  }
  const loss=juvenileLoss(current,{days,moisture:p.moisture});
  return commitJuvenileLoss(e,p,loss??{lost:{massGrams:0,energyKcal:0,waterMl:0},remaining:current,terminal:false});
}
/** Shared conservative stock exit for drought and strikes. This does not remove
 * a plant: growth defers removals until its iteration ends; interactions remove
 * the exact target immediately. Neither path refunds soil on contact. */
function commitJuvenileLoss(e,p,loss){
  if(loss.lost.massGrams>0){
    addDetritus(e,loss.lost.massGrams,loss.lost.energyKcal,p.position,p.scene);
    e.lifecycle.lostMassGrams+=loss.lost.massGrams;e.lifecycle.lostKcal+=loss.lost.energyKcal;e.lifecycle.releasedWaterMl+=loss.lost.waterMl;
  }
  const remaining=loss.remaining;
  p.structureMassGrams=remaining.massGrams;p.structureKcal=remaining.energyKcal;p.structureWaterMl=remaining.waterMl;
  p.quantity=0;p.capacity=0;p.growth=0;p.fallHours=0;p.stage=p.structureMassGrams<20?'seedling':'juvenile';
  if(loss.terminal){e.lifecycle.deadJuveniles++;return true;}return false;
}
function recruitmentPoint(e,m){
  const candidates=[{...m.position}];
  for(const radius of [12,24])for(let a=0;a<8;a++)candidates.push({x:m.position.x+Math.cos(a*Math.PI/4)*radius,y:m.position.y+Math.sin(a*Math.PI/4)*radius});
  return candidates.find(p=>canStandOutside(p.x,p.y,10)&&waterDistance(p.x,p.y)>=12&&plantSuitability('apple_tree',p,siteModel(e))&&
    !nearby(e,p,'valley',32).some(o=>o.kind==='apple_tree'&&distance(o.position,p)<(o.lifecycleStage==='juvenile'?24:32)))||null;
}
/** At most four due attempts per ecology step, fixed order and 12-game-hour
 * retry. Attempts never move the source or consume it without a viable plant. */
function recruitJuveniles(e){
  if(e.regionalVersion!==1)return;
  const due=e.materials.filter(m=>m.seedOpportunity&&m.massGrams>=J.seedMassGrams&&!m.heldBy&&m.scene==='valley'&&m.ageHours>=J.germinationAgeHours&&m.nextGerminationAt<=e.elapsed)
    .sort((a,b)=>a.nextGerminationAt-b.nextGerminationAt||Number(a.id.slice(7))-Number(b.id.slice(7))).slice(0,4);
  for(const m of due){
    const transfer=seedTransfer(m);if(!transfer)continue;
    e.lifecycle.attempts++;m.nextGerminationAt=e.elapsed+CONFIG.dayRealSeconds/2;
    if(e.plants.length>=R.maxPlants||e.nextId>=1e9){e.lifecycle.capacityBlockedAttempts++;continue;}
    const point=recruitmentPoint(e,m);if(!point){e.lifecycle.placementBlockedAttempts++;continue;}
    // No mature constructor, fresh fruit, global soil, or distant safePoint.
    const stock=transfer.transferred,site=habitatConditions(point,siteModel(e)),s=season(e,{});
    const p={id:nextId(e),kind:'apple_tree',scene:'valley',position:point,capacity:0,quantity:0,biomassGrams:0,moisture:site.moisture,
      stage:'seedling',growth:0,seasonIndex:s.index,fallHours:0,ageDays:0,lifecycleStage:'juvenile',structureMassGrams:stock.massGrams,
      structureKcal:stock.energyKcal,structureWaterMl:stock.waterMl,recruitedAt:e.elapsed,parentMaterialId:m.id};
    Object.assign(m,transfer.remaining,{seedOpportunity:false,nextGerminationAt:null});e.plants.push(p);
    e.lifecycle.seededPlants++;e.lifecycle.transferredMassGrams+=stock.massGrams;e.lifecycle.transferredKcal+=stock.energyKcal;e.lifecycle.transferredWaterMl+=stock.waterMl;
    // Preserve every positive remainder; ordinary material decay owns its later fate.
    if(m.massGrams===0&&m.energyKcal===0&&m.waterMl===0)removeMaterial(e,m);invalidateIndex(e);
  }
}
/** Owner-only finite structural accounting; never an inhabitant food hint. */
export function ecologyLifecycleAudit(e){return {...lifecycleStockAudit(e),...e.lifecycle,capacity:R.maxPlants,freePlantSlots:Math.max(0,R.maxPlants-e.plants.length)};}
function nearest(list,a,predicate=()=>true,radius=Infinity){let best=null,d=radius;for(const o of list){if(o===a||o.scene!==a.scene||!predicate(o))continue;const n=distance(a.position,o.position);if(n<d){d=n;best=o;}}return best;}
function clearSegment(from,to,radius){
  const length=distance(from,to),steps=Math.max(1,Math.ceil(length/16));
  for(let i=1;i<=steps;i++)if(!canStandOutside(from.x+(to.x-from.x)*i/steps,from.y+(to.y-from.y)*i/steps,radius))return false;
  return true;
}
/** All candidates must be genuine dry drinking banks, not displaced by a
 * generic placement search. Includes the lake that the old controller omitted. */
function waterBank(a,model=0){
  const radius=SPECIES[a.species].radius,candidates=[],sight=SPECIES[a.species].sight;
  const add=p=>{if(model&&distance(a.position,p)>sight)return;const d=waterDistance(p.x,p.y);if(d>=radius+2&&d<=60&&canStandOutside(p.x,p.y,radius))candidates.push(p);};
  for(const pond of [...PONDS,LAKE]){
    if(model&&distance(a.position,pond)>sight+Math.max(pond.rx,pond.ry)+60)continue;
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
    const y=clamp(a.position.y+(n?Math.ceil(n/2)*(n%2?1:-1)*(model?sight/7:160):0),-21500,21500);
    for(const side of [preferred,-preferred])add({x:riverX(y)+side*(riverWidth(y)+radius+20),y});
  }
  candidates.sort((p,q)=>distance(a.position,p)-distance(a.position,q));
  return candidates[0]||null;
}
/** With no bank in sight, an animal can only probe a bounded physical route. */
function waterSearch(a,e){
  const radius=SPECIES[a.species].radius,reach=SPECIES[a.species].sight*.45,id=Number(a.id.slice(7));
  for(let n=0;n<12;n++){
    const angle=(hash(Math.floor(e.elapsed/4)+n,id,e.seed)*2+n/12)*Math.PI;
    const p={x:a.position.x+Math.cos(angle)*reach,y:a.position.y+Math.sin(angle)*reach};
    if(canStandOutside(p.x,p.y,radius)&&clearSegment(a.position,p,radius))return p;
  }
  return null;
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
    if(a.targetKind!=='water'||!a.targetPosition||distance(a.position,a.targetPosition)<5||(!siteModel(e)&&waterDistance(a.targetPosition.x,a.targetPosition.y)>60))a.targetPosition=waterBank(a,siteModel(e))||(siteModel(e)?waterSearch(a,e):null);
    a.activity=a.targetPosition?'moving':'resting';a.targetId=null;a.targetKind='water';return;
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
    if(m.spoiled){const f=Math.min(1,hours(dt)/(R.materialDecayDays*24)),mass=m.massGrams*f,energy=m.energyKcal*f;m.massGrams-=mass;m.energyKcal-=energy;m.waterMl*=1-f;addDetritus(e,mass,energy,m.heldBy?agents.find(a=>a.id===m.heldBy)?.position||m.position:m.position,m.heldBy?agents.find(a=>a.id===m.heldBy)?.scene||m.scene:m.scene);}
    if(m.massGrams<.1){addDetritus(e,m.massGrams,m.energyKcal,m.heldBy?agents.find(a=>a.id===m.heldBy)?.position||m.position:m.position,m.heldBy?agents.find(a=>a.id===m.heldBy)?.scene||m.scene:m.scene);removeMaterial(e,m);}
  }
  recruitJuveniles(e);
  const fraction=hours(dt)/(24*10),decay=e.detritus.energyKcal*fraction,decayedMass=e.detritus.massGrams*fraction;
  e.detritus.massGrams=Math.max(0,e.detritus.massGrams-decayedMass);e.detritus.energyKcal=Math.max(0,e.detritus.energyKcal-decay);e.ledger.decomposedKcal+=decay;
  if(e.regionalVersion===1){
    for(const region of e.regions){
      const mass=region.massGrams*fraction,energy=region.energyKcal*fraction;
      const nutrients=Math.min(Math.max(0,500000-e.detritus.nutrients),mass*.004);
      region.massGrams=Math.max(0,region.massGrams-mass);region.energyKcal=Math.max(0,region.energyKcal-energy);
      region.nutrients+=nutrients;region.mineralizedNutrients+=nutrients;e.detritus.nutrients+=nutrients;
      region.decayedMassGrams+=mass;region.decomposedKcal+=energy;
    }
  }else e.detritus.nutrients=Math.min(500000,e.detritus.nutrients+decayedMass*.004);
}
/** Called exactly once by the runtime. Bodies, motion and resources share this clock. */
export function tickEcology(e,dt,environment={},agents=[],callbacks={}){
  if(!e||!Number.isFinite(dt)||dt<=0)return;
  e.pending+=Math.min(dt,CONFIG.dayRealSeconds*7);
  while(e.pending>=R.stepSeconds){e.pending-=R.stepSeconds;simulationStep(e,R.stepSeconds,environment,agents,callbacks);}
}
/** Bounded data-only disk restoration; no arbitrary species, scripts or nutrition. */
export function validateEcology(raw,{seed=CONFIG.seed,elapsed=0,connectedEcology=false}={}){
  const lifecyclePresent=hasLifecyclePayload(raw);
  if(connectedEcology&&raw?.ecosystemModelVersion!==1)throw new Error('Protected connected ecology save: missing model marker');
  if(!connectedEcology&&raw?.ecosystemModelVersion!=null)throw new Error('Protected connected ecology save: unexpected model marker');
  if(lifecyclePresent&&raw.version!==R.version)throw new Error('Protected lifecycle save: unsupported ecology version');
  if(!raw||raw.version!==R.version)return createEcology(seed,elapsed);
  if(lifecyclePresent){const error=lifecycleError(raw);if(error)throw new Error(`Protected lifecycle save: ${error}`);
    // Plants and animals are checked by the canonical reader below; its exact
    // retained-field comparison rejects any relocation, deletion or species repair.
    // Materials preserve producer coordinates directly, so need this one check.
    if(raw.materials.some(m=>m.scene==='valley'?![10,CONFIG.playerRadius,...speciesNames.map(name=>SPECIES[name].radius)].some(radius=>canStandOutside(m.position.x,m.position.y,radius)):!canStandCave(m.position.x,m.position.y)))throw new Error('Protected lifecycle save: invalid retained object position or species');
  }
  const out={version:R.version,distributionVersion:[1,2,3].includes(raw.distributionVersion)?raw.distributionVersion:1,seed:Number.isInteger(raw.seed)?raw.seed>>>0:seed,elapsed:clamp(raw.elapsed,0,CONFIG.dayRealSeconds*100000),pending:clamp(raw.pending,0,R.stepSeconds),nextId:1,
    ...(connectedEcology?{ecosystemModelVersion:1}:{}),plants:[],animals:[],materials:[],detritus:{massGrams:clamp(raw.detritus?.massGrams,0,R.maxDetritus),nutrients:clamp(raw.detritus?.nutrients,0,500000),energyKcal:clamp(raw.detritus?.energyKcal,0,1e9)},ledger:emptyLedger(),lifecycle:lifecyclePresent?{...raw.lifecycle}:freshLifecycleLedger(),births:clamp(Math.floor(raw.births),0,1e7),deaths:clamp(Math.floor(raw.deaths),0,1e7)};
  const seen=new Set(),acceptId=id=>typeof id==='string'&&idPattern.test(id)&&!seen.has(id),position=(o,radius=10)=>safePoint(o?.position?.x,o?.position?.y,radius);
  const add=(list,o)=>{seen.add(o.id);out.nextId=Math.max(out.nextId,Number(o.id.split(':')[1])+1);list.push(o);};
  for(const p of (Array.isArray(raw.plants)?raw.plants:[]).slice(0,R.maxPlants)){
    if(!acceptId(p?.id)||!['grass','apple_tree','bramble'].includes(p.kind))continue;
    const point=position(p);if(!point)continue;
    const cap=p.lifecycleStage==='juvenile'?0:p.kind==='grass'?R.grassCapacityGrams:p.kind==='apple_tree'?10:28;
    add(out.plants,{id:p.id,kind:p.kind,scene:'valley',position:point,capacity:cap,quantity:Math.floor(clamp(p.quantity,0,p.kind==='grass'?0:cap)),biomassGrams:clamp(p.biomassGrams,0,p.kind==='grass'?cap:0),moisture:clamp(p.moisture,0,1),stage:['green','dry','bare','flowering','growing','ripe','seedling','juvenile'].includes(p.stage)?p.stage:'bare',growth:clamp(p.growth,0,100),seasonIndex:clamp(Math.floor(p.seasonIndex),0,100000),fallHours:clamp(p.fallHours,0,R.fruitFallDays*24),ageDays:clamp(p.ageDays,0,100000),...(lifecyclePresent?Object.fromEntries(PLANT_FIELDS.map(k=>[k,p[k]])):freshPlantLifecycle())});
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
    // A carcass or detached flesh inherits the actual animal position, which
    // need not clear the generic placement radius. New-format positions were
    // checked against the real producer clearances above and remain exact.
    const point=lifecyclePresent?{x:m.position.x,y:m.position.y}:scene==='valley'?position(m):canStandCave(m.position?.x,m.position?.y)?{...m.position}:{...CAVE_SPAWN};
    if(!point)continue;
    add(out.materials,{id:m.id,kind:m.kind,materialType:m.materialType,scene,position:point,heldBy:m.kind==='material'&&['aster','mira'].includes(m.heldBy)?m.heldBy:null,massGrams:mass,energyKcal:stockClamp(m.energyKcal,0,maxEnergy),waterMl:stockClamp(m.waterMl,0,mass),createdAt:clamp(m.createdAt,0,out.elapsed),ageHours:clamp(m.ageHours,0,100000),spoiled:!!m.spoiled,digestHours:def.digestHours,toxicity:def.toxicity||0,...(lifecyclePresent?Object.fromEntries(MATERIAL_FIELDS.map(k=>[k,m[k]])):freshMaterialLifecycle())});
  }
  for(const k of Object.keys(out.ledger))out.ledger[k]=stockClamp(raw.ledger?.[k],0,1e12);
  out.nextId=Math.max(out.nextId,Math.floor(clamp(raw.nextId,1,1e9)));
  if(out.distributionVersion===3||raw.regionalVersion===1)validateRegions(raw,out);
  if(lifecyclePresent){const error=lifecycleRestorationError(raw,out);if(error)throw new Error(`Protected lifecycle save: ${error}`);}
  return out;
}
