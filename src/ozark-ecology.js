import { publishConsumption } from './consumption-events.js';
import { describeEcologyObject } from './ecology.js';
// The fresh Ozark ecosystem uses the same finite object, physiology, and
// transfer records as the historical valley. Its geography is selected only
// by the saved Ozark identity and the authoritative full-map geometry.
import { CONFIG } from './config.js';
import { ECOLOGY_RULES as R, ECOLOGY_SPECIES as SPECIES, ECOLOGY_MATERIALS as MATERIALS } from './ecology-config.js';
import { BIOLOGY_PROFILES } from './biology-config.js';
import { createPhysiology, validatePhysiology, tickPhysiology, exertPhysiology, ingestMaterial, beginSleep, isSleeping, wakePhysiology } from './biology.js';
import { freshPlantLifecycle, freshMaterialLifecycle, freshLifecycleLedger, lifecycleError, lifecycleRestorationError } from './plant-lifecycle-state.js';
import { JUVENILE_RULES as J, seedTransfer, juvenileGrowth, juvenileLoss } from './plant-lifecycle.js';
import { getWorldRule } from './world-rules.js';
import { environmentConditions } from './environment.js';
import { aquaticEnabled, aquaticEnergy, aquaticFoodEnergy, seedAquaticEcology, tickAquaticEcology, decayAquaticMaterial } from './aquatic-ecology.js';
import { aquaticError } from './aquatic-state.js';

const GRID = R.habitatGridSize;
const STEP = R.stepSeconds;
const ID = /^object:([1-9][0-9]{0,8})$/;
const ECOLOGY_FIELDS = new Set(['version','distributionVersion','ozarkEcologyVersion','geometryIdentity',
  'ozarkRegionBounds','regionalVersion','seed','elapsed','pending','nextId','plants','animals',
  'materials','detritus','ledger','lifecycle','births','deaths','regions','aquatic']);
const PLANT_FIELDS = new Set(['id','kind','scene','position','capacity','quantity','biomassGrams',
  'moisture','stage','growth','seasonIndex','fallHours','ageDays','lifecycleStage',
  'structureMassGrams','structureKcal','structureWaterMl','recruitedAt','parentMaterialId']);
const ANIMAL_FIELDS = new Set(['id','species','scene','position','physiology','health','energy',
  'hydration','nourishment','stamina','fatigue','sleepPressure','thermal','bodyMode',
  'activity','ageDays','structureKcal','lastBirthHours','targetId','targetPosition',
  'targetKind','homePosition','lastAttackAt','cooldownHours','bornAt','direction',
  'actionHours','feelings']);
const MATERIAL_FIELDS = new Set(['id','kind','materialType','scene','position','heldBy',
  'massGrams','energyKcal','waterMl','createdAt','ageHours','spoiled','digestHours',
  'toxicity','seedOpportunity','nextGerminationAt','fishOrigin','originFishId','fishTissue']);
const geometries = new WeakMap();
const finite = value => Number.isFinite(value);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const gameDays = seconds => seconds / CONFIG.dayRealSeconds;
const gameHours = seconds => gameDays(seconds) * 24;
const ledger = () => ({initialKcal:0,photosynthesisKcal:0,humanRemovedKcal:0,metabolizedKcal:0,decomposedKcal:0,discardedKcal:0,birthTransferredKcal:0,externalKcal:0,waterConsumedMl:0,animalAbsorbedKcal:0,animalAbsorbedWaterMl:0,animalWaterLostMl:0,discardedDetritusMassGrams:0});
const hash = (x, y, seed) => {
  let n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ seed;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};

function requireGeometry(geometry) {
  const bounds = geometry?.bounds;
  if (typeof geometry?.profile?.identity !== 'string' || !geometry.profile.identity ||
      !bounds || !['minX','maxX','minY','maxY'].every(key => finite(bounds[key])) ||
      bounds.minX >= bounds.maxX || bounds.minY >= bounds.maxY ||
      typeof geometry.sample !== 'function' || typeof geometry.classify !== 'function' ||
      typeof geometry.advance !== 'function' || typeof geometry.lineOfSight !== 'function') {
    throw new TypeError('Ozark ecology requires the authoritative full-map geometry');
  }
  return geometry;
}

export function bindOzarkEcology(ecology, geometry) {
  requireGeometry(geometry);
  if (ecology?.ozarkEcologyVersion !== 1 || ecology.geometryIdentity !== geometry.profile.identity) {
    throw new TypeError('Ozark ecology identity does not match its geometry');
  }
  geometries.set(ecology, geometry);
  return ecology;
}

export function geometryForOzarkEcology(ecology) { return geometries.get(ecology) || null; }

function boundsOf(geometry) {
  const b = geometry.bounds;
  // The margin allows all actor and producer radii to be classified without
  // evaluating a sampler outside its approved rectangle.
  return {minX:b.minX+80,maxX:b.maxX-80,minY:b.minY+80,maxY:b.maxY-80};
}
function regionIndex(bounds, point) {
  const col = clamp(Math.floor((point.x-bounds.minX)/(bounds.maxX-bounds.minX)*GRID),0,GRID-1);
  const row = clamp(Math.floor((point.y-bounds.minY)/(bounds.maxY-bounds.minY)*GRID),0,GRID-1);
  return row*GRID+col;
}
export function ozarkRegionAt(ecology, point) {
  if (!ecology?.ozarkRegionBounds || !point || !finite(point.x) || !finite(point.y)) return null;
  return ecology.regions?.[regionIndex(ecology.ozarkRegionBounds,point)] || null;
}
function waterDistance(geometry, point) {
  const site = geometry.sample(point.x,point.y), scale=geometry.profile.cellPixels;
  return Math.min(site.surfaceWaterDistance,
    site.sinkholePondDistance == null ? Infinity : site.sinkholePondDistance)*scale;
}
function drySite(geometry, point, radius=10) {
  return finite(point?.x) && finite(point?.y) &&
    geometry.classify(point.x,point.y,radius).reason === 'dry-ground';
}
function walkingSite(geometry,point,radius=10) {
  return finite(point?.x) && finite(point?.y) && geometry.classify(point.x,point.y,radius).walkable;
}
function siteClimate(site) {
  const moisture=clamp(site.moisture,0,1),light=clamp(site.light,0,1),canopy=clamp(site.canopy,0,1);
  return {moisture,light,canopy,productivity:clamp((.48+moisture*.72)*(.3+light*.7),.15,1.2)};
}
function suitable(kind, site) {
  if (site.habitat==='river-channel' || site.habitat==='sinkhole-basin') return false;
  const {moisture,light}=siteClimate(site);
  if (kind==='grass') return moisture>.17 && light>.27;
  if (kind==='bramble') return moisture>.31 && light>.24;
  return kind==='apple_tree' && moisture>.4 && light>.34 && site.substrate!=='thin-limestone';
}
function chooseSites(geometry, bounds, col, row, seed) {
  const width=(bounds.maxX-bounds.minX)/GRID,height=(bounds.maxY-bounds.minY)/GRID;
  const out=[];
  for(let y=0;y<8;y++)for(let x=0;x<8;x++){
    const p={x:bounds.minX+(col+(x+.2+hash(x+col*31,y+row*17,seed)*.6)/8)*width,
      y:bounds.minY+(row+(y+.2+hash(x+col*13,y+row*47,seed^1949)*.6)/8)*height};
    if(!drySite(geometry,p,16))continue;
    const site=geometry.sample(p.x,p.y);
    if(!suitable('grass',site))continue;
    out.push({point:p,site,rank:hash(x+col*83,y+row*41,seed^3299)});
  }
  return out.sort((a,b)=>a.rank-b.rank);
}
function nextId(ecology) { return `object:${ecology.nextId++}`; }
function plant(ecology,kind,point,site,index) {
  if(ecology.plants.length>=R.maxPlants || !suitable(kind,site))return null;
  const climate=siteClimate(site),capacity=kind==='grass'?R.grassCapacityGrams:kind==='apple_tree'?10:28;
  const season=(R.startSeasonDay+ecology.elapsed/CONFIG.dayRealSeconds)%R.yearDays;
  const ripe=season >= (kind==='apple_tree'?65:40) && season < (kind==='apple_tree'?85:95);
  const count=kind==='grass'||!ripe?0:Math.round(capacity*(.55+hash(index,8,ecology.seed)*.35));
  const record={id:nextId(ecology),kind,scene:'valley',position:{...point},capacity,quantity:count,
    biomassGrams:kind==='grass'?capacity*(.7+hash(index,9,ecology.seed)*.2):0,moisture:climate.moisture,
    stage:kind==='grass'?'green':ripe?'ripe':'bare',growth:0,seasonIndex:0,fallHours:0,
    ageDays:kind==='apple_tree'?2000:400,...freshPlantLifecycle()};
  ecology.plants.push(record);return record;
}
function animal(ecology,species,point,{juvenile=false,energyKcal,structureKcal}={}) {
  const rules=SPECIES[species];
  if(!rules || ecology.animals.length>=R.maxAnimals ||
      ecology.animals.filter(a=>a.species===species).length>=rules.maxPopulation ||
      !drySite(geometryForOzarkEcology(ecology),point,rules.radius))return null;
  const capacity=BIOLOGY_PROFILES[species].availableCapacityKcal;
  const physiology=createPhysiology(species,{availableEnergyKcal:energyKcal===undefined?rules.initialReserveKcal*.4:Math.min(capacity,energyKcal),storedEnergyKcal:energyKcal===undefined?rules.initialReserveKcal*.6:Math.max(0,energyKcal-capacity)});
  const record={id:nextId(ecology),species,scene:'valley',position:{...point},physiology,health:100,
    energy:80,hydration:100,nourishment:80,stamina:100,fatigue:0,sleepPressure:0,
    thermal:{hot:0,cold:0,wetness:0},bodyMode:'awake',activity:'idle',ageDays:juvenile?0:60,
    structureKcal:structureKcal??rules.structureKcal,lastBirthHours:gameHours(ecology.elapsed)-rules.birthIntervalDays*24,
    targetId:null,targetPosition:null,targetKind:null,homePosition:{...point},lastAttackAt:-100,cooldownHours:0,bornAt:ecology.elapsed,
    direction:hash(ecology.nextId,44,ecology.seed)*Math.PI*2,actionHours:0};
  ecology.animals.push(record);return record;
}
function segmentClear(geometry, from, to, radius) {
  const steps=Math.max(1,Math.ceil(distance(from,to)/12));
  for(let i=1;i<=steps;i++){
    const p={x:from.x+(to.x-from.x)*i/steps,y:from.y+(to.y-from.y)*i/steps};
    if(!geometry.classify(p.x,p.y,radius).walkable)return false;
  }
  return true;
}
function localBank(geometry, from, maxRange) {
  const d0=waterDistance(geometry,from);
  if(d0<=65 && d0>=12)return {...from};
  if(d0<=0||d0>maxRange+80)return null;
  let nearest=null,best=Infinity;
  for(let i=0;i<24;i++){
    const angle=i*Math.PI/12,dx=Math.cos(angle),dy=Math.sin(angle);
    for(let radius=40;radius<=maxRange+40;radius+=40){
      const water={x:from.x+dx*radius,y:from.y+dy*radius};
      if(water.x<geometry.bounds.minX+30||water.x>geometry.bounds.maxX-30||
          water.y<geometry.bounds.minY+30||water.y>geometry.bounds.maxY-30)break;
      if(waterDistance(geometry,water)>0)continue;
      let low=Math.max(0,radius-40),high=radius;
      for(let turn=0;turn<12;turn++){
        const middle=(low+high)/2,p={x:from.x+dx*middle,y:from.y+dy*middle};
        if(waterDistance(geometry,p)>34)low=middle;else high=middle;
      }
      const bank={x:from.x+dx*low,y:from.y+dy*low};
      if(distance(from,bank)<best&&drySite(geometry,bank,10)&&
          geometry.lineOfSight(from,bank)&&segmentClear(geometry,from,bank,10)){
        nearest=bank;best=distance(from,bank);
      }
      break;
    }
  }
  return nearest;
}
function regionsFor(geometry,bounds,seed) {
  const rows=[];
  for(let row=0;row<GRID;row++)for(let col=0;col<GRID;col++){
    const center={x:bounds.minX+(col+.5)*(bounds.maxX-bounds.minX)/GRID,
      y:bounds.minY+(row+.5)*(bounds.maxY-bounds.minY)/GRID};
    const site=geometry.sample(center.x,center.y),climate=siteClimate(site),capacity=Math.round(125000+climate.moisture*80000+climate.canopy*35000);
    const initial=Math.round(capacity*(.18+climate.moisture*.48));
    rows.push({id:`region:${col}:${row}`,nutrients:0,massGrams:0,energyKcal:0,
      initialNutrients:0,uptakeNutrients:0,mineralizedNutrients:0,
      initialMassGrams:0,initialEnergyKcal:0,depositedMassGrams:0,depositedKcal:0,decayedMassGrams:0,decomposedKcal:0,
      soilWaterMl:initial,soilWaterCapacityMl:capacity,initialWaterMl:initial,
      rainMl:0,seepageMl:0,runoffOutMl:0,evaporationMl:0,uptakeMl:0});
  }
  return rows;
}
function distributeSoil(ecology) {
  const rows=ecology.regions,per=Math.floor(ecology.detritus.nutrients/rows.length);
  let left=ecology.detritus.nutrients;
  for(const row of rows){row.nutrients=per;row.initialNutrients=per;left-=per;}
  rows.at(-1).nutrients+=left;rows.at(-1).initialNutrients+=left;
}
function energy(ecology){
  return ecology.plants.reduce((sum,p)=>sum+(p.kind==='grass'?p.biomassGrams*R.grassKcalPerGram:p.quantity*MATERIALS[p.kind==='apple_tree'?'apple':'berry'].energyKcal)+(p.structureKcal||0),0)+
    ecology.animals.reduce((sum,a)=>sum+a.structureKcal+a.physiology.availableEnergyKcal+a.physiology.storedEnergyKcal+a.physiology.stomach.reduce((v,s)=>v+s.remainingKcal,0),0)+
    ecology.materials.reduce((sum,m)=>sum+m.energyKcal,0)+ecology.detritus.energyKcal+aquaticEnergy(ecology)+aquaticFoodEnergy(ecology);
}

/** Fresh-only placement; no locations, nutrition or water routes enter actors. */
export function createOzarkEcology(geometry,seed=CONFIG.seed,elapsed=0,{finiteAquatic=true}={}) {
  requireGeometry(geometry);
  if(!Number.isInteger(seed)||seed<0||seed>0xffffffff||!finite(elapsed)||elapsed<0)throw new RangeError('Invalid Ozark ecology seed or clock');
  const bounds=boundsOf(geometry),ecology={version:R.version,distributionVersion:R.distributionVersion,
    ozarkEcologyVersion:1,geometryIdentity:geometry.profile.identity,ozarkRegionBounds:bounds,
    regionalVersion:1,seed,elapsed,pending:0,nextId:1,plants:[],animals:[],materials:[],
    detritus:{massGrams:0,nutrients:2500,energyKcal:0},ledger:ledger(),lifecycle:freshLifecycleLedger(),births:0,deaths:0,
    regions:regionsFor(geometry,bounds,seed)};
  bindOzarkEcology(ecology,geometry);
  for(let row=0;row<GRID;row++)for(let col=0;col<GRID;col++){
    const selected=chooseSites(geometry,bounds,col,row,seed);
    for(const [index,candidate] of selected.slice(0,8).entries()){
      const n=(row*GRID+col)*8+index;
      plant(ecology,'grass',candidate.point,candidate.site,n);
      if(index<2)plant(ecology,'bramble',candidate.point,candidate.site,1000+n);
      if(index===2)plant(ecology,'apple_tree',candidate.point,candidate.site,2000+n);
    }
  }
  // Locate independent water-side communities from the physical surface.
  // Bank searches are generation-only and never become an inhabitant route.
  const wetCandidates=[];
  for(let y=bounds.minY+200;y<bounds.maxY-200;y+=400)
    for(let x=bounds.minX+200;x<bounds.maxX-200;x+=400){
      const point={x,y};if(!drySite(geometry,point,16))continue;
      const water=waterDistance(geometry,point);
      if(water>30&&water<420)wetCandidates.push({point,rank:hash(x,y,seed^55121)});
    }
  wetCandidates.sort((a,b)=>a.rank-b.rank);
  const clusters=[];
  for(const candidate of wetCandidates){
    if(clusters.length>=22)break;
    if(clusters.some(other=>distance(other,candidate.point)<900))continue;
    const bank=localBank(geometry,candidate.point,440);
    if(!bank)continue;
    const grasses=[];
    for(let n=0;n<12;n++){
      const angle=n*2.399963229728653,radius=45+Math.sqrt(n/12)*170;
      const p={x:bank.x+Math.cos(angle)*radius,y:bank.y+Math.sin(angle)*radius};
      if(!drySite(geometry,p,16)||!segmentClear(geometry,bank,p,10))continue;
      const site=geometry.sample(p.x,p.y);
      if(n<9){const grown=plant(ecology,'grass',p,site,4000+clusters.length*12+n);if(grown)grasses.push(grown);}
      else plant(ecology,n===9?'bramble':'apple_tree',p,site,6000+clusters.length*12+n);
    }
    if(grasses.length<2)continue;
    clusters.push(candidate.point);
    for(const grass of grasses.slice(0,2))animal(ecology,'rabbit',grass.position);
  }
  // The inhabited starts, including the player's view, receive locally
  // visible producers. These are ordinary finite stocks with no learned food
  // identity, supplied meal, or route hint.
  for(const [index,spawn] of [...Object.values(geometry.agentSpawns||{}),geometry.spawn].entries()){
    for(let n=0;n<10;n++){
      const angle=n*2.399963229728653,radius=85+Math.sqrt(n/10)*225;
      const p={x:spawn.x+Math.cos(angle)*radius,y:spawn.y+Math.sin(angle)*radius};
      if(!drySite(geometry,p,16))continue;
      const site=geometry.sample(p.x,p.y);
      plant(ecology,n<7?'grass':n<9?'bramble':'apple_tree',p,site,8000+index*10+n);
    }
  }
  for(const [index,point] of clusters.entries()){
    if(index%8!==0)continue;
    const nearbyPrey=ecology.animals.filter(a=>a.species==='rabbit'&&distance(a.position,point)<1200);
    if(nearbyPrey.length>=2){
      const origin=nearbyPrey[0].position;
      const p=[50,75,100].flatMap(radius=>Array.from({length:12},(_,step)=>({
        x:origin.x+Math.cos(step*Math.PI/6)*radius,
        y:origin.y+Math.sin(step*Math.PI/6)*radius,
      }))).find(candidate=>drySite(geometry,candidate,index%12===0?SPECIES.fox.radius:SPECIES.bobcat.radius)&&
        segmentClear(geometry,origin,candidate,10));
      if(p)animal(ecology,index%12===0?'fox':'bobcat',p);
    }
  }
  ecology.detritus.nutrients=Math.max(2500,ecology.plants.length*34);
  distributeSoil(ecology);
  // Append only after all old land objects, preserving their global IDs.
  if(finiteAquatic)seedAquaticEcology(ecology,geometry);
  ecology.ledger.initialKcal=energy(ecology);
  return ecology;
}

function exactBounds(a,b) { return a && Object.keys(b).every(key=>a[key]===b[key]) && Object.keys(a).length===Object.keys(b).length; }
function validNumber(value,low=0,high=1e12){return finite(value)&&value>=low&&value<=high;}
function validateRows(ecology,geometry){
  const canonical=regionsFor(geometry,ecology.ozarkRegionBounds,ecology.seed),rows=ecology.regions;
  if(!Array.isArray(rows)||rows.length!==GRID*GRID)throw new Error('Protected Ozark ecology: incomplete regions');
  const fields=['nutrients','massGrams','energyKcal','initialNutrients','uptakeNutrients','mineralizedNutrients',
    'initialMassGrams','initialEnergyKcal','depositedMassGrams','depositedKcal','decayedMassGrams','decomposedKcal',
    'soilWaterMl','soilWaterCapacityMl','initialWaterMl','rainMl','seepageMl','runoffOutMl','evaporationMl','uptakeMl'];
  for(let i=0;i<rows.length;i++){
    const row=rows[i],base=canonical[i];
    if(!row||row.id!==base.id || Object.keys(row).length!==fields.length+1 ||
        fields.some(key=>!validNumber(row[key])) || row.soilWaterCapacityMl!==base.soilWaterCapacityMl ||
        row.initialWaterMl!==base.initialWaterMl || row.soilWaterMl>row.soilWaterCapacityMl+1e-7)
      throw new Error('Protected Ozark ecology: invalid region stock');
    const waterIn=row.initialWaterMl+row.rainMl+row.seepageMl;
    const waterOut=row.soilWaterMl+row.runoffOutMl+row.evaporationMl+row.uptakeMl;
    const tolerance=1e-6+1e-9*Math.max(waterIn,waterOut);
    if(Math.abs(waterIn-waterOut)>tolerance ||
        Math.abs(row.nutrients+row.uptakeNutrients-row.initialNutrients-row.mineralizedNutrients)>tolerance ||
        Math.abs(row.massGrams+row.decayedMassGrams-row.initialMassGrams-row.depositedMassGrams)>tolerance ||
        Math.abs(row.energyKcal+row.decomposedKcal-row.initialEnergyKcal-row.depositedKcal)>tolerance)
      throw new Error('Protected Ozark ecology: unbalanced region');
  }
  for(const [field,sum] of [['nutrients','nutrients'],['massGrams','massGrams'],['energyKcal','energyKcal']]){
    const regional=rows.reduce((value,row)=>value+row[field],0),total=ecology.detritus[sum];
    if(Math.abs(regional-total)>1e-6+1e-9*Math.max(regional,total))
      throw new Error('Protected Ozark ecology: aggregate stock differs from regions');
  }
}

/** Strict new-world restoration. Invalid stock or identity is never repaired. */
export function validateOzarkEcology(raw,geometry,{seed=CONFIG.seed,elapsed=0,finiteAquatic=aquaticEnabled(raw)}={}) {
  requireGeometry(geometry);
  if(!raw||typeof raw!=='object'||raw.version!==R.version||raw.distributionVersion!==R.distributionVersion||
      raw.ozarkEcologyVersion!==1||raw.geometryIdentity!==geometry.profile.identity||raw.regionalVersion!==1||
      !exactBounds(raw.ozarkRegionBounds,boundsOf(geometry))||!Number.isInteger(raw.seed)||raw.seed!==seed||
      !validNumber(raw.elapsed,0,CONFIG.dayRealSeconds*100000)||
      Math.abs(raw.elapsed+raw.pending-elapsed)>1e-7+1e-10*Math.max(raw.elapsed,elapsed)||
      !validNumber(raw.pending,0,STEP)||!Number.isSafeInteger(raw.nextId)||raw.nextId<1||raw.nextId>1e9||
      !validNumber(raw.births,0,1e7)||!validNumber(raw.deaths,0,1e7)||
      Object.keys(raw).some(key=>!ECOLOGY_FIELDS.has(key))||
      !raw.detritus||Object.keys(raw.detritus).length!==3||
      !['massGrams','nutrients','energyKcal'].every(key=>validNumber(raw.detritus[key],0,key==='energyKcal'?1e9:500000))||
      !raw.ledger||Object.keys(raw.ledger).length!==Object.keys(ledger()).length||
      Object.keys(ledger()).some(key=>!validNumber(raw.ledger[key]))||
      !Array.isArray(raw.plants)||!Array.isArray(raw.animals)||!Array.isArray(raw.materials))
    throw new Error('Protected Ozark ecology: unsupported or incomplete envelope');
  if(raw.plants.some(o=>Object.keys(o).some(key=>!PLANT_FIELDS.has(key)))||
      raw.animals.some(o=>Object.keys(o).some(key=>!ANIMAL_FIELDS.has(key)))||
      raw.materials.some(o=>Object.keys(o).some(key=>!MATERIAL_FIELDS.has(key))))
    throw new Error('Protected Ozark ecology: unsupported object field');
  const fishError=aquaticError(raw,geometry,{enabled:finiteAquatic});if(fishError)throw new Error(`Protected Ozark ecology: ${fishError}`);
  const lifeError=lifecycleError(raw);if(lifeError)throw new Error(`Protected Ozark ecology: ${lifeError}`);
  validateRows(raw,geometry);
  const objects=[...raw.plants,...raw.animals,...raw.materials];
  if(objects.some(o=>{
    const match=ID.exec(o.id);if(!match||Number(match[1])>=raw.nextId||o.scene!=='valley')return true;
    const radius=o.species?SPECIES[o.species]?.radius:10;
    // Producers and wildlife live on dry passable ground. A hand-held object
    // may be released while its carrier swims or climbs; that occupied
    // footprint remains valid and must survive the next save verbatim.
    return !radius||(o.kind==='material'||o.kind==='carcass'||o.kind==='fish_specimen'
      ? !geometry.canOccupy(o.position?.x,o.position?.y,radius)
      : o.species?!walkingSite(geometry,o.position,radius):!drySite(geometry,o.position,radius));
  }))throw new Error('Protected Ozark ecology: invalid object position');
  for(const a of raw.animals){
    if(!SPECIES[a.species]||!validNumber(a.structureKcal,0,SPECIES[a.species].structureKcal)||
        !a.homePosition||!drySite(geometry,a.homePosition,SPECIES[a.species].radius)||
        a.targetPosition&&(!finite(a.targetPosition.x)||!finite(a.targetPosition.y))||
        !a.physiology||a.physiology.profile!==a.species)
      throw new Error('Protected Ozark ecology: invalid animal');
    const canonical=validatePhysiology(a.physiology,{profile:a.species,elapsed:raw.elapsed});
    if(JSON.stringify(canonical)!==JSON.stringify(a.physiology))
      throw new Error('Protected Ozark ecology: altered animal physiology');
  }
  const L=raw.ledger,closing=energy(raw)+L.humanRemovedKcal+L.metabolizedKcal+
    L.decomposedKcal+L.discardedKcal,opening=L.initialKcal+L.photosynthesisKcal+L.externalKcal;
  if(Math.abs(closing-opening)>1e-5+1e-8*Math.max(closing,opening))
    throw new Error('Protected Ozark ecology: unbalanced energy');
  const copy=structuredClone(raw);
  for(const a of copy.animals){delete a.feelings;a.actionHours=0;}
  const continuity=lifecycleRestorationError(raw,copy);
  if(continuity)throw new Error(`Protected Ozark ecology: ${continuity}`);
  bindOzarkEcology(copy,geometry);
  return copy;
}

function addDetritus(e,mass,calories,position){
  const accepted=Math.min(Math.max(0,mass),Math.max(0,R.maxDetritus-e.detritus.massGrams));
  const retained=mass>0?Math.min(Math.max(0,calories),calories*accepted/mass):Math.max(0,calories);
  e.detritus.massGrams+=accepted;e.detritus.energyKcal+=retained;
  e.ledger.discardedKcal+=Math.max(0,calories-retained);
  e.ledger.discardedDetritusMassGrams+=Math.max(0,mass-accepted);
  const row=ozarkRegionAt(e,position);
  if(row){row.massGrams+=accepted;row.energyKcal+=retained;row.depositedMassGrams+=accepted;row.depositedKcal+=retained;}
}
function addMaterial(e,type,position,{massGrams,energyKcal,waterMl,kind='material'}={}){
  const def=MATERIALS[type],mass=massGrams??def.massGrams,energy=energyKcal??def.energyKcal,water=waterMl??def.waterMl;
  if(e.materials.length>=R.maxMaterials||!position){e.ledger.discardedKcal+=energy;addDetritus(e,mass,0,position);return null;}
  const material={id:nextId(e),kind,materialType:type,scene:'valley',position:{...position},heldBy:null,
    massGrams:mass,energyKcal:energy,waterMl:water,createdAt:e.elapsed,ageHours:0,spoiled:false,
    digestHours:def.digestHours,toxicity:def.toxicity||0,...freshMaterialLifecycle(type==='apple'&&kind==='material',e.elapsed)};
  e.materials.push(material);return material;
}
function plantWaterAndSoil(e,p,wantedGrams,waterPerGram){
  const row=ozarkRegionAt(e,p.position),nutrients=Math.max(0,wantedGrams*.004),water=Math.max(0,wantedGrams*waterPerGram);
  if(!row||nutrients===0)return 0;
  const fraction=Math.min(1,row.nutrients/nutrients,e.detritus.nutrients/nutrients,water?row.soilWaterMl/water:1);
  const admitted=wantedGrams*clamp(fraction,0,1),soil=admitted*.004,usedWater=admitted*waterPerGram;
  row.nutrients-=soil;row.uptakeNutrients+=soil;e.detritus.nutrients-=soil;
  row.soilWaterMl-=usedWater;row.uptakeMl+=usedWater;
  return admitted;
}
function growJuvenile(e,p,days,sun,climate,multiplier){
  const row=ozarkRegionAt(e,p.position);
  const current={massGrams:p.structureMassGrams,energyKcal:p.structureKcal,waterMl:p.structureWaterMl};
  const crowding=e.plants.filter(other=>other!==p&&other.kind==='apple_tree'&&distance(other.position,p.position)<64).length;
  const plan=juvenileGrowth(current,{days,moisture:p.moisture,daylight:sun,
    productivity:climate.productivity/(1+crowding*.5),multiplier,soilNutrients:row?.nutrients??0});
  if(plan?.input.massGrams>0){
    const admitted=plantWaterAndSoil(e,p,plan.input.massGrams,J.growthWaterMlPerGram);
    const calories=admitted*J.growthKcalPerGram,water=admitted*J.growthWaterMlPerGram;
    current.massGrams+=admitted;current.energyKcal+=calories;current.waterMl+=water;
    e.lifecycle.growthMassGrams+=admitted;e.lifecycle.growthKcal+=calories;
    e.lifecycle.growthWaterMl+=water;e.lifecycle.nutrientUptake+=admitted*J.nutrientsPerGram;
    e.ledger.photosynthesisKcal+=calories;
  }
  const loss=juvenileLoss(current,{days,moisture:p.moisture});
  if(loss?.lost.massGrams>0){
    addDetritus(e,loss.lost.massGrams,loss.lost.energyKcal,p.position);
    e.lifecycle.lostMassGrams+=loss.lost.massGrams;e.lifecycle.lostKcal+=loss.lost.energyKcal;
    e.lifecycle.releasedWaterMl+=loss.lost.waterMl;
  }
  const remaining=loss?.remaining??current;
  p.structureMassGrams=remaining.massGrams;p.structureKcal=remaining.energyKcal;p.structureWaterMl=remaining.waterMl;
  p.quantity=0;p.capacity=0;p.growth=0;p.fallHours=0;
  p.stage=p.structureMassGrams<20?'seedling':'juvenile';
  if(loss?.terminal){e.lifecycle.deadJuveniles++;return true;}
  return false;
}
function recruitmentPoint(e,m,geometry){
  const candidates=[{...m.position}];
  for(const radius of [12,24])for(let a=0;a<8;a++)candidates.push({
    x:m.position.x+Math.cos(a*Math.PI/4)*radius,
    y:m.position.y+Math.sin(a*Math.PI/4)*radius,
  });
  return candidates.find(point=>drySite(geometry,point,10)&&waterDistance(geometry,point)>=12&&
    suitable('apple_tree',geometry.sample(point.x,point.y))&&
    !e.plants.some(plant=>plant.kind==='apple_tree'&&distance(plant.position,point)<
      (plant.lifecycleStage==='juvenile'?24:32)))||null;
}
function recruitJuveniles(e,geometry){
  const due=e.materials.filter(m=>m.seedOpportunity&&m.massGrams>=J.seedMassGrams&&
    !m.heldBy&&m.scene==='valley'&&m.ageHours>=J.germinationAgeHours&&m.nextGerminationAt<=e.elapsed)
    .sort((a,b)=>a.nextGerminationAt-b.nextGerminationAt||Number(a.id.slice(7))-Number(b.id.slice(7))).slice(0,4);
  for(const m of due){
    const transfer=seedTransfer(m);if(!transfer)continue;
    e.lifecycle.attempts++;m.nextGerminationAt=e.elapsed+CONFIG.dayRealSeconds/2;
    if(e.plants.length>=R.maxPlants||e.nextId>=1e9){e.lifecycle.capacityBlockedAttempts++;continue;}
    const point=recruitmentPoint(e,m,geometry);
    if(!point){e.lifecycle.placementBlockedAttempts++;continue;}
    const stock=transfer.transferred,site=geometry.sample(point.x,point.y);
    e.plants.push({id:nextId(e),kind:'apple_tree',scene:'valley',position:point,
      capacity:0,quantity:0,biomassGrams:0,moisture:site.moisture,stage:'seedling',growth:0,
      seasonIndex:Math.floor((R.startSeasonDay+e.elapsed/CONFIG.dayRealSeconds)/R.yearDays),
      fallHours:0,ageDays:0,lifecycleStage:'juvenile',structureMassGrams:stock.massGrams,
      structureKcal:stock.energyKcal,structureWaterMl:stock.waterMl,recruitedAt:e.elapsed,parentMaterialId:m.id});
    Object.assign(m,transfer.remaining,{seedOpportunity:false,nextGerminationAt:null});
    e.lifecycle.seededPlants++;e.lifecycle.transferredMassGrams+=stock.massGrams;
    e.lifecycle.transferredKcal+=stock.energyKcal;e.lifecycle.transferredWaterMl+=stock.waterMl;
    if(m.massGrams===0&&m.energyKcal===0&&m.waterMl===0)e.materials.splice(e.materials.indexOf(m),1);
  }
}
function waterStep(e,dt,environment,geometry){
  const days=gameDays(dt),rain=(environment?.settings?.weatherOverride||environment?.weather?.kind)==='rainy'?getWorldRule(environment,'rainfallMultiplier'):0;
  for(let i=0;i<e.regions.length;i++){
    const row=e.regions[i],col=i%GRID,rr=Math.floor(i/GRID),b=e.ozarkRegionBounds;
    const center={x:b.minX+(col+.5)*(b.maxX-b.minX)/GRID,y:b.minY+(rr+.5)*(b.maxY-b.minY)/GRID};
    const site=geometry.sample(center.x,center.y),distanceToWater=Math.max(0,waterDistance(geometry,center));
    const rainfall=row.soilWaterCapacityMl*.075*days*rain;
    const seepage=row.soilWaterCapacityMl*.032*days*Math.exp(-distanceToWater/650);
    row.rainMl+=rainfall;row.seepageMl+=seepage;row.soilWaterMl+=rainfall+seepage;
    const evaporation=Math.min(row.soilWaterMl,row.soilWaterCapacityMl*(.014+(1-site.canopy)*.01)*days);
    row.soilWaterMl-=evaporation;row.evaporationMl+=evaporation;
    const runoff=Math.max(0,row.soilWaterMl-row.soilWaterCapacityMl);
    row.soilWaterMl-=runoff;row.runoffOutMl+=runoff;
  }
}
function growPlants(e,dt,environment,geometry){
  const day=gameDays(dt),hour=(CONFIG.startHour+gameHours(e.elapsed))%24,sun=hour>=6&&hour<=19?1:.08;
  const season=(R.startSeasonDay+e.elapsed/CONFIG.dayRealSeconds/getWorldRule(environment,'seasonLengthMultiplier'))%R.yearDays;
  const seasonIndex=Math.floor((R.startSeasonDay+e.elapsed/CONFIG.dayRealSeconds/getWorldRule(environment,'seasonLengthMultiplier'))/R.yearDays);
  const growthMultiplier=getWorldRule(environment,'plantGrowthMultiplier'),yieldMultiplier=getWorldRule(environment,'fruitYieldMultiplier');
  waterStep(e,dt,environment,geometry);
  const dead=[];
  for(const p of e.plants){
    const site=siteClimate(geometry.sample(p.position.x,p.position.y)),row=ozarkRegionAt(e,p.position);
    p.ageDays+=day;p.moisture=clamp((row.soilWaterMl/row.soilWaterCapacityMl)*site.moisture*1.3,0,1);
    if(p.lifecycleStage==='juvenile'){
      if(growJuvenile(e,p,day,sun,site,growthMultiplier))dead.push(p);
      continue;
    }
    if(p.kind==='grass'){
      const before=p.biomassGrams,wanted=Math.min((row.nutrients/.004),R.grassGrowthGramsPerDay*growthMultiplier*site.productivity*day*sun*(.15+p.moisture*.85)*Math.max(.03,p.biomassGrams/p.capacity)*(1-p.biomassGrams/p.capacity));
      p.biomassGrams=Math.min(p.capacity,p.biomassGrams+plantWaterAndSoil(e,p,wanted,R.grassWaterPerGram));
      e.ledger.photosynthesisKcal+=(p.biomassGrams-before)*R.grassKcalPerGram;
      if(p.moisture<.1){const loss=p.biomassGrams*day*.06;p.biomassGrams-=loss;addDetritus(e,loss,loss*R.grassKcalPerGram,p.position);}
      p.stage=p.moisture<.2?'dry':'green';continue;
    }
    if(seasonIndex!==p.seasonIndex){p.seasonIndex=seasonIndex;p.growth=0;p.fallHours=0;}
    const start=p.kind==='apple_tree'?65:40,end=p.kind==='apple_tree'?85:95;
    if(season>=start&&season<end){
      p.stage='ripe';p.growth=Math.min(100,p.growth+day*sun*p.moisture*site.productivity*(p.kind==='apple_tree'?.13:10)*growthMultiplier*yieldMultiplier);
      const material=MATERIALS[p.kind==='apple_tree'?'apple':'berry'];
      const wanted=Math.min(Math.floor(p.growth),p.capacity-p.quantity);
      if(wanted>0){
        const nutrientCost=material.massGrams*.004,waterCost=material.waterMl;
        let admitted=Math.min(wanted,Math.floor(Math.min(row.nutrients,e.detritus.nutrients)/nutrientCost),
          Math.floor(row.soilWaterMl/waterCost));
        while(admitted>0&&(row.nutrients<admitted*nutrientCost||
          e.detritus.nutrients<admitted*nutrientCost||row.soilWaterMl<admitted*waterCost))admitted--;
        if(admitted>0){
          const nutrients=admitted*nutrientCost,water=admitted*waterCost;
          row.nutrients-=nutrients;row.uptakeNutrients+=nutrients;e.detritus.nutrients-=nutrients;
          row.soilWaterMl-=water;row.uptakeMl+=water;
          p.quantity+=admitted;p.growth-=admitted;
          e.ledger.photosynthesisKcal+=admitted*material.energyKcal;
        }
      }
    }else if(season<start&&season>=start-12)p.stage=season<start-8?'flowering':'growing';
    else p.stage='bare';
    if(p.quantity){p.fallHours+=gameHours(dt);const fallAt=season>end?12:R.fruitFallDays*24;
      if(p.fallHours>=fallAt){p.fallHours%=fallAt;p.quantity--;
        const candidate={x:p.position.x+25,y:p.position.y+20};
        addMaterial(e,p.kind==='apple_tree'?'apple':'berry',drySite(geometry,candidate)?candidate:p.position);}}
  }
  for(const p of dead)e.plants.splice(e.plants.indexOf(p),1);
}
function nearby(e,point,radius){return [...e.plants,...e.animals,...e.materials].filter(o=>!o.heldBy&&distance(o.position,point)<=radius);}
function animalFood(e,a,environment){
  const sight=SPECIES[a.species].sight*getWorldRule(environment,'animalForagingRangeMultiplier');
  const sources=nearby(e,a.position,sight).filter(o=>{
    if(a.species==='rabbit')return o.kind==='grass'&&o.biomassGrams>12;
    if(a.species==='bobcat')return o.kind==='carcass'&&o.massGrams>10||o.species==='rabbit';
    return o.species==='rabbit'||o.kind==='bramble'&&o.quantity>0||o.kind==='material'&&['apple','berry','flesh'].includes(o.materialType)&&o.massGrams>10;
  }).filter(o=>o!==a);
  sources.sort((x,y)=>distance(x.position,a.position)-distance(y.position,a.position));
  return sources[0]||null;
}
function bite(e,a,target){
  // Exact historical diets: new material kinds never inherit a land diet.
  const allowed=a.species==='rabbit'?target.kind==='grass':a.species==='bobcat'?target.kind==='carcass'&&target.materialType==='flesh':target.kind==='bramble'||target.kind==='material'&&['apple','berry','flesh'].includes(target.materialType);
  if(target.species||!allowed)return false;
  const rules=SPECIES[a.species],grams=rules.biteGrams;
  let mass,energy,water;
  if(target.kind==='grass'){
    mass=Math.min(grams,target.biomassGrams);energy=mass*R.grassKcalPerGram;water=mass*R.grassWaterPerGram;
  }else if(target.kind==='bramble'||target.kind==='apple_tree'){
    if(target.quantity<=0)return false;
    const def=MATERIALS[target.kind==='bramble'?'berry':'apple'];mass=def.massGrams;energy=def.energyKcal;water=def.waterMl;
  }else{
    mass=Math.min(grams,target.massGrams);const fraction=mass/target.massGrams;
    energy=target.energyKcal*fraction;water=target.waterMl*fraction;
  }
  if(!mass)return false;
  const witnessedSource=describeEcologyObject(e,target.id);
  const ingestion=ingestMaterial(a,{massGrams:mass,energyKcal:energy,waterMl:water,digestHours:a.species==='rabbit'?2:3,toxicity:target.spoiled?.08:0},{objectId:target.id,source:'instinct'});
  if(ingestion?.ok!==true)return false;
  if(target.kind==='grass')target.biomassGrams-=mass;
  else if(target.kind==='bramble'||target.kind==='apple_tree')target.quantity--;
  else{target.massGrams-=mass;target.energyKcal-=energy;target.waterMl-=water;
    if(target.massGrams<.1){e.ledger.discardedKcal+=target.energyKcal;e.materials.splice(e.materials.indexOf(target),1);}}
  a.cooldownHours=rules.biteHours;e.ledger.waterConsumedMl+=water;
  publishConsumption(e,a,witnessedSource);
  return true;
}
function animalDeath(e,a){
  if(!e.animals.includes(a))return;
  const calories=a.structureKcal+a.physiology.availableEnergyKcal+a.physiology.storedEnergyKcal+
    a.physiology.stomach.reduce((sum,row)=>sum+row.remainingKcal,0);
  const mass=calories/MATERIALS.flesh.energyKcal*MATERIALS.flesh.massGrams;
  addMaterial(e,'flesh',a.position,{kind:'carcass',massGrams:mass,energyKcal:calories,waterMl:mass*.7});
  e.animals.splice(e.animals.indexOf(a),1);e.deaths++;
}
function decideAnimal(e,a,environment,agents,geometry){
  const rules=SPECIES[a.species],needWater=a.hydration<60;
  if(isSleeping(a)){
    if(a.hydration<35||a.energy<20)wakePhysiology(a,{kind:'distress',strength:.9});
    else{a.activity='sleeping';a.targetId=null;a.targetPosition=null;return;}
  }
  const threat=agents.find(h=>h.scene==='valley'&&distance(h.position,a.position)<65);
  if(a.species==='rabbit'&&threat){
    const dx=a.position.x-threat.position.x,dy=a.position.y-threat.position.y,norm=Math.hypot(dx,dy)||1;
    const target={x:a.position.x+dx/norm*180,y:a.position.y+dy/norm*180};
    a.activity='fleeing';a.targetId=null;a.targetKind='flee';a.targetPosition=drySite(geometry,target,rules.radius)?target:null;return;
  }
  if(needWater){
    const bank=localBank(geometry,a.position,rules.sight);
    if(bank&&distance(bank,a.position)<Math.max(18,rules.radius+8)&&waterDistance(geometry,a.position)<=65){
      const drank=Math.min(40,a.physiology.waterDeficitMl);
      a.physiology.waterDeficitMl-=drank;a.activity='drinking';a.targetPosition=null;e.ledger.waterConsumedMl+=drank;return;
    }
    a.activity=bank?'moving':'resting';a.targetId=null;a.targetKind='water';a.targetPosition=bank;return;
  }
  if(a.sleepPressure>75||a.fatigue>80){beginSleep(a,{hours:Math.min(4,rules.sleepHours)});a.activity='sleeping';a.targetId=null;a.targetPosition=null;return;}
  const hungry=a.energy<70||a.physiology.hoursSinceMeal>6;
  if(hungry){const food=animalFood(e,a,environment);
    if(food){a.targetId=food.id;a.targetPosition={...food.position};a.targetKind='source';
      a.activity=distance(a.position,food.position)<=rules.radius+25&&!food.species?'feeding':food.species?'chasing':'moving';return;}}
  if(a.stamina<30){a.activity='resting';a.targetId=null;a.targetPosition=null;return;}
  if(!hungry&&(Math.floor(gameHours(e.elapsed)/2)+Number(a.id.slice(7)))%3!==0){
    a.activity='resting';a.targetId=null;a.targetPosition=null;a.targetKind=null;return;
  }
  const home=a.homePosition,angle=a.direction+=hash(Math.floor(e.elapsed),Number(a.id.slice(7)),e.seed)*.8-.4;
  const target=distance(a.position,home)>rules.sight*1.3?home:{x:a.position.x+Math.cos(angle)*120,y:a.position.y+Math.sin(angle)*120};
  a.activity='moving';a.targetId=null;a.targetKind='wander';a.targetPosition=drySite(geometry,target,rules.radius)?{...target}:null;
}
function moveAnimal(a,dt,geometry){
  const target=a.targetPosition;if(!target)return 0;
  const d=distance(a.position,target);if(d<3)return 0;
  const before={...a.position},speed=SPECIES[a.species].speed/CONFIG.walkSpeed;
  // The geometry owns swept collision, water contact and current. A resisted
  // attempt spends time without teleporting to a generator's chosen bank.
  geometry.advance(a.position,target.x-a.position.x,target.y-a.position.y,Math.min(dt*speed,d/CONFIG.walkSpeed),false);
  // The geometry uses the player's ten-pixel sweep. A bobcat has a larger
  // footprint, so keep the last valid position if that sweep was too narrow.
  if(!walkingSite(geometry,a.position,SPECIES[a.species].radius))a.position=before;
  return distance(before,a.position);
}
function reproduce(e,a,environment,geometry){
  const rules=SPECIES[a.species],p=a.physiology,rate=getWorldRule(environment,'animalReproductionMultiplier');
  if(rate<=0||a.ageDays<rules.juvenileDays||e.animals.length>=R.maxAnimals||
      e.animals.filter(o=>o.species===a.species).length>=rules.maxPopulation||
      gameHours(e.elapsed)-a.lastBirthHours<rules.birthIntervalDays*24/rate||a.hydration<70||a.energy<70||
      p.availableEnergyKcal+p.storedEnergyKcal<rules.birthKcal+rules.initialReserveKcal*.2)return;
  const mate=e.animals.find(o=>o!==a&&o.species===a.species&&o.ageDays>=rules.juvenileDays&&distance(o.position,a.position)<220);
  if(!mate)return;
  const point={x:a.position.x+30,y:a.position.y+20};
  if(!drySite(geometry,point,rules.radius))return;
  const local=nearby(e,a.position,rules.sight);
  if(a.species==='rabbit'){
    const grasses=local.filter(o=>o.kind==='grass'&&o.biomassGrams>100);
    if(grasses.length<3||local.filter(o=>o.species==='rabbit').length>=grasses.length)return;
  }else if(local.filter(o=>o.species==='rabbit').length<4)return;
  const debit=rules.birthKcal,taken=Math.min(p.availableEnergyKcal,debit);
  p.availableEnergyKcal-=taken;p.storedEnergyKcal-=debit-taken;
  const child=animal(e,a.species,point,{juvenile:true,energyKcal:debit*.25,structureKcal:debit*.75});
  if(!child){p.availableEnergyKcal+=taken;p.storedEnergyKcal+=debit-taken;return;}
  a.lastBirthHours=gameHours(e.elapsed);e.births++;e.ledger.birthTransferredKcal+=debit;
}
function tickAnimals(e,dt,environment,agents,callbacks,geometry){
  for(const a of [...e.animals]){
    if(!e.animals.includes(a))continue;
    a.ageDays+=gameDays(dt);a.cooldownHours=Math.max(0,a.cooldownHours-gameHours(dt));
    decideAnimal(e,a,environment,agents,geometry);
    const totals=a.physiology.totals,before={metabolizedKcal:totals.metabolizedKcal,discardedKcal:totals.discardedKcal,
      absorbedKcal:totals.absorbedKcal,absorbedWaterMl:totals.absorbedWaterMl,waterLostMl:totals.waterLostMl};
    const condition=environmentConditions({...environment,ecology:e,elapsed:e.elapsed},a);
    tickPhysiology(a,dt,condition,{activity:a.activity==='sleeping'?'sleeping':
      ['moving','fleeing','chasing'].includes(a.activity)?'walking':a.activity==='resting'?'resting':'awake'});
    if(a.health<=0||a.physiology.health<=0){animalDeath(e,a);}
    else if(['moving','fleeing','chasing'].includes(a.activity)){
      const moved=moveAnimal(a,dt,geometry);
      if(moved>0)exertPhysiology(a,dt*moved/Math.max(1,SPECIES[a.species].speed*dt),a.activity==='chasing'?2.5:1);
    }
    if(e.animals.includes(a)){
      const target=[...e.plants,...e.animals,...e.materials].find(o=>o.id===a.targetId);
      if(a.activity==='feeding'&&target&&a.cooldownHours===0&&distance(a.position,target.position)<30)bite(e,a,target);
      if(a.activity==='chasing'&&target?.species&&e.elapsed-a.lastAttackAt>=1.5&&
          distance(a.position,target.position)<SPECIES[a.species].radius+SPECIES[target.species].radius+10){
        a.lastAttackAt=e.elapsed;target.physiology.health=Math.max(0,target.physiology.health-SPECIES[a.species].huntDamage);
        target.health=target.physiology.health;wakePhysiology(target,{kind:'contact',strength:1});
        if(target.health<=0)animalDeath(e,target);
      }
      reproduce(e,a,environment,geometry);
    }
    e.ledger.metabolizedKcal+=Math.max(0,totals.metabolizedKcal-before.metabolizedKcal);
    e.ledger.discardedKcal+=Math.max(0,totals.discardedKcal-before.discardedKcal);
    e.ledger.animalAbsorbedKcal+=Math.max(0,totals.absorbedKcal-before.absorbedKcal);
    e.ledger.animalAbsorbedWaterMl+=Math.max(0,totals.absorbedWaterMl-before.absorbedWaterMl);
    e.ledger.animalWaterLostMl+=Math.max(0,totals.waterLostMl-before.waterLostMl);
  }
}
function materialStep(e,dt,agents){
  for(const m of [...e.materials]){
    if(decayAquaticMaterial(e,m,dt,agents,(mass,kcal,point)=>addDetritus(e,mass,kcal,point)))continue;
    m.ageHours+=gameHours(dt);m.spoiled=m.ageHours>=MATERIALS[m.materialType].spoilDays*24;
    if(m.spoiled){const fraction=Math.min(1,gameHours(dt)/(R.materialDecayDays*24));
      const mass=m.massGrams*fraction,calories=m.energyKcal*fraction;
      const location=m.heldBy?agents.find(a=>a.id===m.heldBy)?.position||m.position:m.position;
      m.massGrams-=mass;m.energyKcal-=calories;m.waterMl*=1-fraction;addDetritus(e,mass,calories,location);}
    if(m.massGrams<.1){const location=m.heldBy?agents.find(a=>a.id===m.heldBy)?.position||m.position:m.position;
      addDetritus(e,m.massGrams,m.energyKcal,location);e.materials.splice(e.materials.indexOf(m),1);
      // V10 saves require exact ownership in both directions even while the
      // carrier is idle/asleep. Preserve the untouched V9 cleanup behavior.
      if(aquaticEnabled(e))for(const actor of agents)if(Array.isArray(actor.inventory?.items))actor.inventory.items=actor.inventory.items.filter(id=>id!==m.id);
    }
  }
  recruitJuveniles(e,geometryForOzarkEcology(e));
  const fraction=gameDays(dt)/10;
  for(const row of e.regions){
    const mass=row.massGrams*fraction,calories=row.energyKcal*fraction;
    row.massGrams-=mass;row.energyKcal-=calories;
    row.decayedMassGrams+=mass;row.decomposedKcal+=calories;
    const nutrient=Math.min(Math.max(0,500000-e.detritus.nutrients),mass*.004);
    row.nutrients+=nutrient;row.mineralizedNutrients+=nutrient;e.detritus.nutrients+=nutrient;
    e.detritus.massGrams-=mass;e.detritus.energyKcal-=calories;e.ledger.decomposedKcal+=calories;
  }
}

/** One finite half-second ecology step per shared unpaused simulation clock. */
export function tickOzarkEcology(ecology,dt,environment={},agents=[],callbacks={},geometry=geometryForOzarkEcology(ecology)) {
  requireGeometry(geometry);
  if(ecology?.geometryIdentity!==geometry.profile.identity)throw new TypeError('Ozark ecology geometry changed');
  bindOzarkEcology(ecology,geometry);
  if(!finite(dt)||dt<=0)return;
  ecology.pending+=Math.min(dt,CONFIG.dayRealSeconds*7);
  while(ecology.pending>=STEP){ecology.pending-=STEP;ecology.elapsed+=STEP;
    growPlants(ecology,STEP,environment,geometry);
    tickAnimals(ecology,STEP,environment,agents,callbacks,geometry);
    materialStep(ecology,STEP,agents);
    tickAquaticEcology(ecology,STEP,geometry,{deposit:(mass,kcal,point)=>addDetritus(ecology,mass,kcal,point)});
  }
}

/** Private coverage evidence; positions and species never enter agent senses. */
export function ozarkEcologyCoverage(ecology) {
  const occupied=new Set(),quadrants={northWest:0,northEast:0,southWest:0,southEast:0};
  for(const object of [...ecology.plants,...ecology.animals]){
    occupied.add(regionIndex(ecology.ozarkRegionBounds,object.position));
    quadrants[`${object.position.y<0?'north':'south'}${object.position.x<0?'West':'East'}`]++;
  }
  return {regions:GRID*GRID,occupiedRegions:occupied.size,plants:ecology.plants.length,
    animals:ecology.animals.length,fish:ecology.aquatic?.fish.length||0,initialFish:ecology.aquatic?.initialCount||0,quadrants};
}
