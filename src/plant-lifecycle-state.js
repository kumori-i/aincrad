/** Bounded additive lifecycle schema. Old plants acquire no inferred wood and
 * old materials acquire no seed opportunity. This is an engine/save contract. */
import { CONFIG, CAVES } from './config.js';
import { ECOLOGY_RULES as R, ECOLOGY_MATERIALS as MATERIALS } from './ecology-config.js';
import { aquaticMaterialError, aquaticEnabled, isAquaticMaterial } from './aquatic-state.js';
import { JUVENILE_RULES as J } from './plant-lifecycle.js';
export const PLANT_FIELDS = Object.freeze(['lifecycleStage','structureMassGrams','structureKcal','structureWaterMl','recruitedAt','parentMaterialId']);
export const MATERIAL_FIELDS = Object.freeze(['seedOpportunity','nextGerminationAt']);
export const LIFE_COUNTERS = Object.freeze(['seededPlants','deadJuveniles','attempts','capacityBlockedAttempts','placementBlockedAttempts','transferredMassGrams','transferredKcal','transferredWaterMl','growthMassGrams','growthKcal','growthWaterMl','nutrientUptake','lostMassGrams','lostKcal','releasedWaterMl']);
const integerCounters = LIFE_COUNTERS.slice(0,5);
const own=(o,k)=>!!o&&Object.hasOwn(o,k);
const valid=n=>Number.isFinite(n)&&n>=0&&n<=1e12;
const id=x=>typeof x==='string'&&/^object:[1-9][0-9]{0,8}$/.test(x);
export const stockTolerance = (...values) => 128 * Number.EPSILON * Math.max(1,...values.map(Math.abs));
// Cumulative sums may have many individually bounded floating-point updates.
const balanceTolerance=(...values)=>1e-7+stockTolerance(...values);
const below=(a,b)=>a<=b+stockTolerance(a,b);
const bounded=(v,lo,hi)=>Number.isFinite(v)&&v>=lo-stockTolerance(v,lo)&&below(v,hi);
const point=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&Math.abs(p.x)<=CONFIG.halfSize-100&&Math.abs(p.y)<=CONFIG.halfSize-100;
const scenes=new Set(['valley',...CAVES.map(c=>c.id)]);
export function freshPlantLifecycle(){return {lifecycleStage:'established',structureMassGrams:0,structureKcal:0,structureWaterMl:0,recruitedAt:null,parentMaterialId:null};}
export function freshLifecycleLedger(){return {version:1,...Object.fromEntries(LIFE_COUNTERS.map(k=>[k,0]))};}
export function freshMaterialLifecycle(seed=false,elapsed=0){return {seedOpportunity:seed,nextGerminationAt:seed?elapsed+J.germinationAgeHours/24*CONFIG.dayRealSeconds:null};}
export function hasLifecyclePayload(e){return own(e,'lifecycle')||(Array.isArray(e?.plants)?e.plants:[]).some(p=>PLANT_FIELDS.some(k=>own(p,k))||['seedling','juvenile'].includes(p?.stage))||(Array.isArray(e?.materials)?e.materials:[]).some(m=>MATERIAL_FIELDS.some(k=>own(m,k)));}
export function lifecycleStockAudit(e){
 const l=e.lifecycle, plants=e.plants.filter(p=>p.lifecycleStage==='juvenile');
 const sum=k=>plants.reduce((v,p)=>v+p[k],0);
 return {juveniles:plants.length,massErrorGrams:sum('structureMassGrams')+l.lostMassGrams-l.transferredMassGrams-l.growthMassGrams,
 energyErrorKcal:sum('structureKcal')+l.lostKcal-l.transferredKcal-l.growthKcal,
 waterErrorMl:sum('structureWaterMl')+l.releasedWaterMl-l.transferredWaterMl-l.growthWaterMl};
}
/** No permissive repair here: missing new metadata protects the original save.
 * Roundoff inside a scale-relative 128-ULP envelope is preserved verbatim; it
 * is never replaced by zero, clipped, or interpreted as new physical input. */
export function lifecycleError(e){
 if(!e||e.version!==R.version||!e.lifecycle||e.lifecycle.version!==1||!Array.isArray(e.plants)||!Array.isArray(e.materials)||!Array.isArray(e.animals))return 'Missing lifecycle schema';
 if(e.plants.length>R.maxPlants||e.materials.length>R.maxMaterials||e.animals.length>R.maxAnimals)return 'Ecology capacity exceeded';
 if(!valid(e.elapsed))return 'Invalid ecology clock';
 const l=e.lifecycle;
 if(Object.keys(l).some(k=>k!=='version'&&!LIFE_COUNTERS.includes(k)))return 'Unsupported lifecycle field';
 if(LIFE_COUNTERS.some(k=>!own(l,k)||!valid(l[k]))||integerCounters.some(k=>!Number.isSafeInteger(l[k])))return 'Invalid lifecycle accounting';
 const seen=new Set(),parents=new Set();
 for(const o of [...e.plants,...e.materials,...e.animals,...(Array.isArray(e.aquatic?.fish)?e.aquatic.fish:[])]){if(!id(o?.id)||seen.has(o.id))return 'Invalid or duplicate object identity';seen.add(o.id);}
 for(const p of e.plants){
  const capacity=p.lifecycleStage==='juvenile'?0:p.kind==='grass'?R.grassCapacityGrams:p.kind==='apple_tree'?10:28;
  if(p.scene!=='valley'||!point(p.position)||p.capacity!==capacity||!Number.isSafeInteger(p.quantity)||p.quantity<0||p.quantity>(p.kind==='grass'?0:capacity)||!bounded(p.biomassGrams,0,p.kind==='grass'?capacity:0)||!bounded(p.moisture,0,1)||!bounded(p.growth,0,100)||!Number.isSafeInteger(p.seasonIndex)||p.seasonIndex<0||p.seasonIndex>100000||!bounded(p.fallHours,0,R.fruitFallDays*24)||!bounded(p.ageDays,0,100000))return 'Invalid retained plant';
  if(PLANT_FIELDS.some(k=>!own(p,k))||!['established','juvenile'].includes(p.lifecycleStage))return 'Missing plant lifecycle fields';
  if(!['grass','apple_tree','bramble'].includes(p.kind)||!['structureMassGrams','structureKcal','structureWaterMl'].every(k=>valid(p[k]))||!below(p.structureWaterMl,p.structureMassGrams))return 'Invalid structural stock';
  if(p.lifecycleStage==='established'){
   if(!['green','dry','bare','flowering','growing','ripe'].includes(p.stage)||p.structureMassGrams!==0||p.structureKcal!==0||p.structureWaterMl!==0||p.recruitedAt!==null||p.parentMaterialId!==null)return 'Historical structure was invented';
  }else if(p.kind!=='apple_tree'||p.quantity!==0||p.capacity!==0||p.biomassGrams!==0||!['seedling','juvenile'].includes(p.stage)||p.structureMassGrams<=0||!below(p.structureMassGrams,J.maxMassGrams)||!below(p.structureKcal,p.structureMassGrams*Math.max(J.growthKcalPerGram,MATERIALS.apple.energyKcal/MATERIALS.apple.massGrams))||!valid(p.recruitedAt)||p.recruitedAt>e.elapsed||!id(p.parentMaterialId)||p.parentMaterialId===p.id)return 'Invalid juvenile';
  if(p.lifecycleStage==='juvenile'){if(parents.has(p.parentMaterialId))return 'Duplicate seed transfer';parents.add(p.parentMaterialId);}
 }
 for(const m of e.materials){
  const def=MATERIALS[m.materialType],cap=m.kind==='carcass'?30000:def?.massGrams;
  if(!def||!['material','carcass','fish_specimen'].includes(m.kind)||!scenes.has(m.scene)||!point(m.position)||!bounded(m.massGrams,0,cap)||!bounded(m.energyKcal,0,m.kind==='carcass'?m.massGrams*1.5:def.energyKcal*m.massGrams/def.massGrams)||!bounded(m.waterMl,0,m.massGrams)||!bounded(m.createdAt,0,e.elapsed)||!bounded(m.ageHours,0,100000)||typeof m.spoiled!=='boolean'||![null,'aster','mira'].includes(m.heldBy)||(m.kind==='carcass'&&m.heldBy!==null))return 'Invalid retained material';
  const fishError=aquaticMaterialError(m);if(fishError)return fishError;
  if(isAquaticMaterial(m)&&!aquaticEnabled(e))return 'Fish material outside aquatic mode';
  if(MATERIAL_FIELDS.some(k=>!own(m,k))||typeof m.seedOpportunity!=='boolean')return 'Missing material lifecycle fields';
  if(m.seedOpportunity){if(parents.has(m.id)||m.kind!=='material'||m.materialType!=='apple'||!valid(m.createdAt)||!valid(m.nextGerminationAt)||m.nextGerminationAt<m.createdAt||m.nextGerminationAt>e.elapsed+J.germinationAgeHours/24*CONFIG.dayRealSeconds+stockTolerance(e.elapsed))return 'Invalid seed opportunity';}
  else if(m.nextGerminationAt!==null)return 'Consumed seed has a pending attempt';
 }
 const a=lifecycleStockAudit(e);
 if(l.seededPlants-l.deadJuveniles!==a.juveniles||l.attempts<l.seededPlants+l.capacityBlockedAttempts+l.placementBlockedAttempts)return 'Lifecycle counts disagree';
 if(Math.abs(a.massErrorGrams)>balanceTolerance(l.transferredMassGrams,l.growthMassGrams,l.lostMassGrams)||Math.abs(a.energyErrorKcal)>balanceTolerance(l.transferredKcal,l.growthKcal,l.lostKcal)||Math.abs(a.waterErrorMl)>balanceTolerance(l.transferredWaterMl,l.growthWaterMl,l.releasedWaterMl))return 'Lifecycle stocks disagree';
 if(Math.abs(l.nutrientUptake-l.growthMassGrams*J.nutrientsPerGram)>balanceTolerance(l.nutrientUptake)||Math.abs(l.growthKcal-l.growthMassGrams*J.growthKcalPerGram)>balanceTolerance(l.growthKcal)||Math.abs(l.growthWaterMl-l.growthMassGrams*J.growthWaterMlPerGram)>balanceTolerance(l.growthWaterMl))return 'Lifecycle inputs disagree';
 return null;
}

/** New-format physical stocks must survive the existing allowlisted reader.
 * Compare only fields that reader actually retains. Unknown executable/text
 * fields are still discarded. Animal actionHours and feelings.relief are
 * pre-existing transient projections, not persistent stock or provenance.
 * Legacy inputs never take this strict path. Numeric roundoff is preserved by
 * the stock reader above; this comparison does not repair, round or invent it.
 */
export function lifecycleRestorationError(raw,canonical){
 const path=[];
 // Construct diagnostic text only on rejection, rather than allocating a full
 // path and testing a regular expression for every retained physical scalar.
 const location=()=>`ecology${path.map(k=>typeof k==='number'?`[${k}]`:`.${k}`).join('')}`;
 const compare=(a,b)=>{
  if(b===null||typeof b!=='object')return a===b?null:`Changed physical field ${location()}`;
  if(!a||typeof a!=='object'||Array.isArray(a)!==Array.isArray(b))return `Missing physical field ${location()}`;
  if(Array.isArray(b)){
   if(a.length!==b.length)return `Changed physical count ${location()}`;
   for(let i=0;i<b.length;i++){path.push(i);const error=compare(a[i],b[i]);path.pop();if(error)return error;}
  }else for(const key of Object.keys(b)){
   if(path.length===2&&path[0]==='animals'&&typeof path[1]==='number'&&key==='actionHours')continue;
   path.push(key);const error=compare(a[key],b[key]);path.pop();if(error)return error;
  }
  return null;
 };
 return compare(raw,canonical);
}
