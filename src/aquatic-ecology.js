/** Finite water-contained physical population. No births, food, growth,
 * immigration, catch RNG, fallback placement or replenishment exists here. */
import { CONFIG } from './config.js';
import { ECOLOGY_RULES as R } from './ecology-config.js';
import { AQUATIC_RULES as A, AQUATIC_STOCK_FIELDS as STOCK } from './aquatic-config.js';
import { aquaticEnabled, aquaticHabitat, aquaticEnergy, aquaticStockAudit, aquaticError, freshAquaticState, fishStock, isAquaticMaterial } from './aquatic-state.js';
export { aquaticEnabled, aquaticHabitat, aquaticEnergy, aquaticStockAudit, aquaticError };
const revisions=new WeakMap();
export const aquaticRevision=e=>revisions.get(e)||0;
const changed=e=>revisions.set(e,aquaticRevision(e)+1);
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const TAU=2*Math.PI;
const angle=a=>((a%TAU)+TAU)%TAU;
const hours=seconds=>seconds/CONFIG.dayRealSeconds*24;
const stock=s=>Object.fromEntries(STOCK.map(k=>[k,s[k]]));
const portion=(s,fraction)=>Object.fromEntries(STOCK.map(k=>[k,s[k]*fraction]));
const hash=(x,y,seed)=>{let n=Math.imul(x|0,374761393)^Math.imul(y|0,668265263)^seed;n=Math.imul(n^(n>>>13),1274126177);return(n^(n>>>16))>>>0;};
function random(f){let n=f.rngState;n^=n<<13;n^=n>>>17;n^=n<<5;f.rngState=(n>>>0)||1;return f.rngState/4294967296;}
function inside(g,p,margin=0){const b=g?.bounds;return b&&Number.isFinite(p?.x)&&Number.isFinite(p?.y)&&p.x-margin>=b.minX&&p.x+margin<=b.maxX&&p.y-margin>=b.minY&&p.y+margin<=b.maxY;}
function signedWater(g,p){
 if(!inside(g,p))return null;
 const site=g.sample(p.x,p.y),scale=g.profile.cellPixels;
 const surface=site.surfaceWaterDistance*scale,pond=site.sinkholePondDistance==null?Infinity:site.sinkholePondDistance*scale;
 return surface<=pond?{kind:'surface',distance:surface,site}:{kind:'pond',distance:pond,site};
}
function bankFor(g,p){
 for(let r=20;r<=A.shoreReach;r+=10)for(let i=0;i<24;i++){
  const q={x:p.x+Math.cos(i*TAU/24)*r,y:p.y+Math.sin(i*TAU/24)*r};
  if(inside(g,q,A.currentReferenceRadius)&&g.classify(q.x,q.y,A.currentReferenceRadius).reason==='dry-ground'&&g.lineOfSight(q,p))return q;
 }
 return null;
}
function gradient(g,p){
 if(!inside(g,p,2))return null;
 const x=(signedWater(g,{x:p.x+2,y:p.y}).distance-signedWater(g,{x:p.x-2,y:p.y}).distance)/4;
 const y=(signedWater(g,{x:p.x,y:p.y+2}).distance-signedWater(g,{x:p.x,y:p.y-2}).distance)/4;
 const norm=Math.hypot(x,y);return Number.isFinite(norm)&&norm>.1?{x:x/norm,y:y/norm}:null;
}
/** All candidate points derive from actual native signed edges. Ranking uses
 * only the saved seed. The bank witness is generation-only and discarded. */
export function seedAquaticEcology(e,geometry){
 if(Object.hasOwn(e,'aquatic'))throw new Error('Aquatic stock can only be initialized once');
 e.aquatic=freshAquaticState();
 const b=geometry.bounds,candidates=[];
 for(let y=b.minY+A.scanPixels;y<b.maxY-A.scanPixels;y+=A.scanPixels)for(let x=b.minX+A.scanPixels;x<b.maxX-A.scanPixels;x+=A.scanPixels){
  const p={x,y},water=signedWater(geometry,p);
  if(!Number.isFinite(water.distance)||Math.abs(water.distance)>A.scanPixels)continue;
  let q=p;
  for(let turn=0;turn<3;turn++){
   const signed=signedWater(geometry,q),normal=gradient(geometry,q);if(!signed||!normal)break;
   q={x:q.x-normal.x*(signed.distance+20),y:q.y-normal.y*(signed.distance+20)};
   if(!inside(geometry,q,4))break;
  }
  if(aquaticHabitat(geometry,q))candidates.push({point:q,rank:hash(x,y,e.seed^0x71f15)});
 }
 candidates.sort((a,b)=>a.rank-b.rank||a.point.y-b.point.y||a.point.x-b.point.x);
 const patches=[];
 for(const candidate of candidates){
  if(e.aquatic.fish.length>=A.maxInitialFish||e.nextId>=1e9)break;
  if(patches.some(p=>distance(p,candidate.point)<A.patchSeparation)||!bankFor(geometry,candidate.point))continue;
  const normal=gradient(geometry,candidate.point);if(!normal)continue;
  let count=0;
  for(const offset of [-9,-3,3,9]){
   if(e.aquatic.fish.length>=A.maxInitialFish||e.nextId>=1e9)break;
   const p={x:candidate.point.x-normal.y*offset,y:candidate.point.y+normal.x*offset};
   if(!aquaticHabitat(geometry,p)||!bankFor(geometry,p))continue;
   const objectId=`object:${e.nextId++}`,rng=hash(Math.round(p.x),Math.round(p.y),e.seed^e.nextId)||1;
   const fish={id:objectId,kind:'fish',phenotype:A.phenotype,scene:'valley',position:p,
    tissue:stock(A.tissue),residue:stock(A.residue),reserve:stock(A.reserve),
    direction:(rng/4294967296)*TAU,phaseSeconds:0,rngState:rng,ageHours:0,
    spentMassGrams:0,spentKcal:0,releasedWaterMl:0};
   e.aquatic.fish.push(fish);e.aquatic.initialIds.push(objectId);count++;
  }
  if(count)patches.push(candidate.point);
 }
 const q=e.aquatic;q.initialCount=q.fish.length;q.acceptedPatches=patches.length;
 q.ledger.initialMassGrams=q.initialCount*200;q.ledger.initialKcal=q.initialCount*150;q.ledger.initialWaterMl=q.initialCount*126;
 changed(e);return {initialCount:q.initialCount,acceptedPatches:q.acceptedPatches,unplaced:A.maxInitialFish-q.initialCount};
}
function wholeSpecimen(e,f,heldBy=null,position=f.position){
 return {id:f.id,kind:'fish_specimen',materialType:'fish_body',scene:f.scene,position:{...position},heldBy,
  ...fishStock(f),fishTissue:stock(f.tissue),fishOrigin:A.phenotype,originFishId:f.id,
  createdAt:e.elapsed,ageHours:0,spoiled:false,digestHours:A.digestHours,toxicity:A.toxicity,
  seedOpportunity:false,nextGerminationAt:null};
}
/** The caller supplies the paid actor/observation/inventory checks. This
 * synchronous stock operation has no callback or partial-mutating failure. */
export function captureAquaticFish(e,id,actorId,position){
 const f=e?.aquatic?.fish?.find(f=>f.id===id);
 if(!aquaticEnabled(e)||!f)return {ok:false,code:'object_missing',targetId:id};
 if(!['aster','mira'].includes(actorId)||!Number.isFinite(position?.x)||!Number.isFinite(position?.y))return {ok:false,code:'invalid_actor',targetId:id};
 if(e.materials.length>=R.maxMaterials)return {ok:false,code:'object_limit',targetId:id};
 const specimen=wholeSpecimen(e,f,actorId,position);
 e.aquatic.fish.splice(e.aquatic.fish.indexOf(f),1);e.materials.push(specimen);
 e.aquatic.ledger.captureAttempts++;e.aquatic.ledger.captures++;e.deaths++;changed(e);
 return {ok:true,code:'object_caught',targetId:id,materialId:id,material:{id}};
}
export function recordAquaticCaptureFailure(e,{miss=false}={}){if(aquaticEnabled(e)){e.aquatic.ledger.captureAttempts++;e.aquatic.ledger[miss?'captureMisses':'captureFailures']++;}}
export function pullAquaticTissue(e,specimen,actorId,position,maxGrams=A.pullMaxGrams){
 const m=typeof specimen==='string'?e.materials.find(o=>o.id===specimen):specimen,id=m?.id;
 if(!aquaticEnabled(e)||!e.materials.includes(m)||m?.kind!=='fish_specimen'||m.heldBy!==actorId||!['aster','mira'].includes(actorId))return {ok:false,code:'object_not_held',targetId:id};
 if(e.materials.length>=R.maxMaterials||!Number.isSafeInteger(e.nextId)||e.nextId<1||e.nextId>=1e9)return {ok:false,code:'object_limit',targetId:id};
 if(!Number.isFinite(maxGrams)||maxGrams<=0||!Number.isFinite(position?.x)||!Number.isFinite(position?.y))return {ok:false,code:'nothing_detached',targetId:id};
 const mass=Math.min(A.pullMaxGrams,maxGrams,m.fishTissue.massGrams);
 if(mass<=0)return {ok:false,code:'nothing_detached',targetId:id};
 const detached=portion(m.fishTissue,mass/m.fishTissue.massGrams),materialId=`object:${e.nextId}`;
 const tissue={id:materialId,kind:'material',materialType:'fish_tissue',scene:m.scene,position:{...position},heldBy:actorId,
  ...detached,fishOrigin:A.phenotype,originFishId:m.originFishId,createdAt:e.elapsed,ageHours:m.ageHours,spoiled:m.spoiled,
  digestHours:A.digestHours,toxicity:A.toxicity,seedOpportunity:false,nextGerminationAt:null};
 for(const key of STOCK){m.fishTissue[key]-=detached[key];m[key]-=detached[key];}
 e.nextId++;e.materials.push(tissue);e.aquatic.ledger.pulls++;changed(e);
 return {ok:true,code:'piece_detached',targetId:id,materialId,material:{id:materialId}};
}
function addExport(e,prefix,s){const l=e.aquatic.ledger;l[`${prefix}MassGrams`]+=s.massGrams;l[`${prefix}Kcal`]+=s.energyKcal;l[`${prefix}WaterMl`]+=s.waterMl;}
export function recordAquaticIngestion(e,m,s){if(aquaticEnabled(e)&&isAquaticMaterial(m)){addExport(e,'humanIngested',s);e.aquatic.ledger.ingestions++;}}
/** Caller separately charges global discardedKcal. This records ONLY the
 * provenance boundary, including the final tiny unswallowed fraction. */
export function recordAquaticDiscard(e,m,s){if(aquaticEnabled(e)&&isAquaticMaterial(m)){addExport(e,'overflowLost',s);e.aquatic.ledger.cleanupTransfers++;}}
function toDetritus(e,s,position,deposit){
 const admitted=Math.min(s.massGrams,Math.max(0,R.maxDetritus-e.detritus.massGrams)),fraction=s.massGrams>0?admitted/s.massGrams:1;
 const retained=portion(s,fraction),overflow=Object.fromEntries(STOCK.map(k=>[k,s[k]-retained[k]]));
 // deposit owns global/regional detritus and global overflow. In the fish
 // provenance ledger detritus is an export, never a second global loss.
 deposit(s.massGrams,s.energyKcal,position);addExport(e,'detritusTransferred',retained);addExport(e,'overflowLost',overflow);
}
function naturalDeath(e,f,deposit){
 if(!e.aquatic.fish.includes(f))return;
 if(e.materials.length<R.maxMaterials)e.materials.push(wholeSpecimen(e,f));
 else toDetritus(e,fishStock(f),f.position,deposit);
 e.aquatic.fish.splice(e.aquatic.fish.indexOf(f),1);e.aquatic.ledger.naturalDeaths++;e.deaths++;changed(e);
}
function swim(e,f,seconds,g){
 let left=seconds;
 while(left>1e-12){
  const dart=f.phaseSeconds>=A.cruiseSeconds,end=dart?A.cruiseSeconds+A.dartSeconds:A.cruiseSeconds;
  const duration=Math.min(left,end-f.phaseSeconds),speed=dart?A.dartPixelsPerSecond:A.cruisePixelsPerSecond;
  const maximumCurrent=Number.isFinite(g.profile.currentMaxSpeed)?g.profile.currentMaxSpeed:0;
  const steps=Math.max(1,Math.ceil((speed+maximumCurrent)*duration/A.sweptStepPixels)),dt=duration/steps;
  for(let step=0;step<steps;step++){
   const water=signedWater(g,f.position);let cx=0,cy=0;
   if(water?.kind==='surface'&&water.site.currentDirection){
    const depth=Math.max(0,(A.currentReferenceRadius-water.distance)/g.profile.depthSpan);
    const current=maximumCurrent*Math.min(1,depth/g.profile.wadeMaxDepthProxy);
    if(Number.isFinite(current)){cx=water.site.currentDirection.x*current;cy=water.site.currentDirection.y*current;}
   }
   const proposed={x:f.position.x+(Math.cos(f.direction)*speed+cx)*dt,y:f.position.y+(Math.sin(f.direction)*speed+cy)*dt};
   if(aquaticHabitat(g,proposed)){f.position=proposed;changed(e);}
   else f.direction=angle(f.direction+Math.PI+(random(f)-.5)*.5);
  }
  f.phaseSeconds+=duration;left-=duration;
  if(f.phaseSeconds>=end-1e-12){f.phaseSeconds=end===A.cruiseSeconds?A.cruiseSeconds:0;f.direction=angle(f.direction+(random(f)-.5)*Math.PI);}
 }
}
export function tickAquaticEcology(e,dt,geometry,{deposit}={}){
 if(!aquaticEnabled(e)||!Number.isFinite(dt)||dt<=0)return;
 if(typeof deposit!=='function')throw new TypeError('Aquatic tick requires regional detritus accounting');
 for(const f of [...e.aquatic.fish]){
  const availableSeconds=f.reserve.energyKcal/(A.maintenanceKcalPerHour+A.swimmingKcalPerHour)/24*CONFIG.dayRealSeconds;
  const active=Math.min(dt,availableSeconds),cost=Math.min(f.reserve.energyKcal,hours(dt)*(A.maintenanceKcalPerHour+A.swimmingKcalPerHour));
  if(active>0&&aquaticHabitat(geometry,f.position))swim(e,f,active,geometry);
  const debit=portion(f.reserve,f.reserve.energyKcal>0?cost/f.reserve.energyKcal:1);
  for(const k of STOCK)f.reserve[k]-=debit[k];
  f.spentMassGrams+=debit.massGrams;f.spentKcal+=debit.energyKcal;f.releasedWaterMl+=debit.waterMl;f.ageHours+=hours(active);
  e.aquatic.ledger.respirationMassGrams+=debit.massGrams;e.aquatic.ledger.metabolizedKcal+=debit.energyKcal;e.aquatic.ledger.releasedWaterMl+=debit.waterMl;e.ledger.metabolizedKcal+=debit.energyKcal;
  if(f.reserve.energyKcal<=0)naturalDeath(e,f,deposit);
 }
}
/** Called only by the native material clock. Returns true when handled. */
export function decayAquaticMaterial(e,m,dt,agents,deposit){
 if(!aquaticEnabled(e)||!isAquaticMaterial(m))return false;
 m.ageHours+=hours(dt);m.spoiled=m.ageHours>=A.spoilDays*24;
 const position=m.heldBy?agents.find(a=>a.id===m.heldBy)?.position||m.position:m.position;
 if(m.spoiled){
  const fraction=Math.min(1,hours(dt)/(R.materialDecayDays*24)),lost=portion(m,fraction);
  for(const key of STOCK){m[key]-=lost[key];if(m.kind==='fish_specimen')m.fishTissue[key]*=1-fraction;}
  toDetritus(e,lost,position,deposit);e.aquatic.ledger.decayTransfers++;
 }
 if(m.massGrams<.1){toDetritus(e,stock(m),position,deposit);e.materials.splice(e.materials.indexOf(m),1);
  // Ownership is physical state, not a sensory update. Decay can finish while
  // an owner is asleep; clear its inventory immediately so a same-tick save
  // cannot retain a dangling held ID until the next action dispatcher call.
  for(const actor of agents)if(Array.isArray(actor.inventory?.items))actor.inventory.items=actor.inventory.items.filter(id=>id!==m.id);
  e.aquatic.ledger.cleanupTransfers++;changed(e);}
 return true;
}
