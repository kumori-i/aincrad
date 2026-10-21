/** Strict additive aquatic schema; no restoring, repair, or fresh allocation. */
import { ECOLOGY_RULES as R } from './ecology-config.js';
import { AQUATIC_RULES as A, AQUATIC_STOCK_FIELDS as STOCK, AQUATIC_LEDGER_FIELDS as BASE_LEDGER, AQUATIC_RENEWAL_LEDGER_FIELDS } from './aquatic-config.js';
const LEDGER=[...BASE_LEDGER,...AQUATIC_RENEWAL_LEDGER_FIELDS];
const own=(o,k)=>!!o&&Object.hasOwn(o,k);
const finite=n=>Number.isFinite(n)&&n>=0&&n<=1e12;
const id=x=>typeof x==='string'&&/^object:[1-9][0-9]{0,8}$/.test(x);
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>own(o,k));
const tolerance=(...v)=>1e-7+1e-10*Math.max(1,...v.map(Math.abs));
const close=(a,b)=>Math.abs(a-b)<=tolerance(a,b);
const below=(a,b)=>a<=b+tolerance(a,b);
const STOCK_KEYS=['massGrams','energyKcal','waterMl'];
export const AQUATIC_MATERIAL_FIELDS=Object.freeze(['fishOrigin','originFishId','fishTissue']);
export const aquaticEnabled=e=>e?.aquatic?.version===2;
/** Conservative whole-footprint containment using native signed water only. */
export function aquaticHabitat(geometry,position){
 const b=geometry?.bounds,p=position,r=A.radius;
 if(!b||!Number.isFinite(p?.x)||!Number.isFinite(p?.y)||p.x-r<b.minX||p.x+r>b.maxX||p.y-r<b.minY||p.y+r>b.maxY||typeof geometry.sample!=='function')return null;
 const site=geometry.sample(p.x,p.y),scale=geometry.profile.cellPixels;
 const surface=site.surfaceWaterDistance*scale,pond=site.sinkholePondDistance==null?Infinity:site.sinkholePondDistance*scale;
 const depth=-Math.min(surface,pond);
 if(!Number.isFinite(depth)||depth<A.minInsidePixels+r||depth>A.maxInsidePixels-r)return null;
 return {waterKind:surface<=pond?'surface':'pond',insidePixels:depth};
}
export const isAquaticMaterial=m=>m?.materialType==='fish_body'||m?.materialType==='fish_tissue'||m?.kind==='fish_specimen';
export function hasAquaticPayload(e){return own(e,'aquatic')||own(e,'fish')||own(e,'aquaticLedger')||own(e,'finiteAquaticVersion')||['plants','animals','materials'].some(key=>(Array.isArray(e?.[key])?e[key]:[]).some(o=>isAquaticMaterial(o)||o?.kind==='fish'||o?.phenotype===A.phenotype||o?.species===A.phenotype||AQUATIC_MATERIAL_FIELDS.some(k=>own(o,k))));}
export function freshAquaticState(){return {version:2,fish:[],patches:[],origins:[],initialCount:0,acceptedPatches:0,initialIds:[],ledger:Object.fromEntries(LEDGER.map(k=>[k,0]))};}
export const aquaticEnergy=e=>(e?.aquatic?.fish||[]).reduce((n,f)=>n+f.tissue.energyKcal+f.residue.energyKcal+f.reserve.energyKcal,0);
export const aquaticFoodEnergy=e=>(e?.aquatic?.patches||[]).reduce((n,p)=>n+p.food.energyKcal,0);
export const fishStock=f=>Object.fromEntries(STOCK.map(k=>[k,f.tissue[k]+f.residue[k]+f.reserve[k]]));
export function aquaticStockAudit(e){
 const l=e?.aquatic?.ledger;
 if(!l)return {massErrorGrams:0,energyErrorKcal:0,waterErrorMl:0};
 const stocks=[...(e.aquatic.patches||[]).map(p=>p.food),...(e.aquatic.fish||[]).map(fishStock),...(e.materials||[]).filter(isAquaticMaterial)];
 const sum=k=>stocks.reduce((n,m)=>n+m[k],0);
 return {massErrorGrams:sum('massGrams')+l.humanIngestedMassGrams+l.detritusTransferredMassGrams+l.overflowLostMassGrams+l.respirationMassGrams-l.initialMassGrams-l.primaryProducedMassGrams,
  energyErrorKcal:sum('energyKcal')+l.humanIngestedKcal+l.detritusTransferredKcal+l.overflowLostKcal+l.metabolizedKcal-l.initialKcal-l.primaryProducedKcal,
  waterErrorMl:sum('waterMl')+l.humanIngestedWaterMl+l.detritusTransferredWaterMl+l.overflowLostWaterMl+l.releasedWaterMl-l.initialWaterMl-l.primaryProducedWaterMl};
}
function stockError(stock,base){
 if(!exact(stock,STOCK_KEYS)||STOCK.some(k=>!finite(stock[k])||!below(stock[k],base[k])))return true;
 return !close(stock.energyKcal*base.massGrams,stock.massGrams*base.energyKcal)||!close(stock.waterMl*base.massGrams,stock.massGrams*base.waterMl);
}
/** Material bounds also ensure the residue is an actual mixture of the fixed
 * structural stock and whatever reserve remained, proportionally decayed. */
export function aquaticMaterialError(m){
 if(!isAquaticMaterial(m))return AQUATIC_MATERIAL_FIELDS.some(k=>own(m,k))?'Aquatic origin on unrelated matter':null;
 if(m.fishOrigin!==A.phenotype||!id(m.originFishId)||m.seedOpportunity!==false||m.nextGerminationAt!==null||m.digestHours!==A.digestHours||m.toxicity!==A.toxicity)return 'Invalid aquatic material origin';
 if(STOCK.some(k=>!finite(m[k]))||!below(m.waterMl,m.massGrams))return 'Invalid aquatic material stock';
 if(m.kind==='material'&&m.materialType==='fish_tissue'){
  if(own(m,'fishTissue')||m.id===m.originFishId||stockError(Object.fromEntries(STOCK.map(k=>[k,m[k]])),A.tissue))return 'Invalid detached fish tissue';
 }else if(m.kind==='fish_specimen'&&m.materialType==='fish_body'){
  if(m.id!==m.originFishId||stockError(m.fishTissue,A.tissue))return 'Invalid whole fish tissue';
  const mass=m.massGrams-m.fishTissue.massGrams,energy=m.energyKcal-m.fishTissue.energyKcal,water=m.waterMl-m.fishTissue.waterMl;
  const reserve=(energy-.3*mass)/1.7,structure=mass-reserve;
  if(mass<0||energy<0||water<0||reserve<-tolerance(mass)||structure<-tolerance(mass)||!below(reserve,20)||!below(structure,100)||!close(water,.6*structure+.5*reserve))return 'Invalid retained fish residue';
 }else return 'Invalid fish material kind';
 return null;
}
/** Position is checked by the same signed-band predicate used during motion. */
export function aquaticError(e,geometry,{enabled=aquaticEnabled(e)}={}){
 if(!enabled)return hasAquaticPayload(e)?'Aquatic payload is forbidden in this save mode':null;
 const q=e?.aquatic;
 if(!exact(q,['version','fish','patches','origins','initialCount','acceptedPatches','initialIds','ledger'])||q.version!==2||!Array.isArray(q.fish)||q.fish.length>A.maxLiveFish||!Number.isSafeInteger(q.initialCount)||q.initialCount<0||q.initialCount>A.maxInitialFish||!Number.isSafeInteger(q.acceptedPatches)||q.acceptedPatches<0||q.acceptedPatches>q.initialCount||q.initialCount>q.acceptedPatches*A.fishPerPatch||!Array.isArray(q.initialIds)||q.initialIds.length!==q.initialCount||new Set(q.initialIds).size!==q.initialCount||q.initialIds.some(x=>!id(x)||Number(x.slice(7))>=e.nextId))return 'Invalid aquatic envelope';
 const l=q.ledger,counters=[...BASE_LEDGER.slice(15),'births'];
 if(!exact(l,LEDGER)||LEDGER.some(k=>!finite(l[k]))||counters.some(k=>!Number.isSafeInteger(l[k]))||l.captures+l.naturalDeaths+q.fish.length!==q.initialCount+l.births||l.captureAttempts<l.captures+l.captureMisses+l.captureFailures)return 'Invalid aquatic accounting';
 if(!close(l.initialMassGrams,q.initialCount*200)||!close(l.initialKcal,q.initialCount*150)||!close(l.initialWaterMl,q.initialCount*126)||!close(l.respirationMassGrams,l.metabolizedKcal/2)||!close(l.releasedWaterMl,l.metabolizedKcal/4))return 'Invalid aquatic endowment or reserve export';
 if(!close(l.humanIngestedKcal,l.humanIngestedMassGrams*A.tissue.energyKcal/A.tissue.massGrams)||!close(l.humanIngestedWaterMl,l.humanIngestedMassGrams*A.tissue.waterMl/A.tissue.massGrams))return 'Invalid human fish export';
 if(!Number.isSafeInteger(e.births)||e.births<l.births||!below(l.birthTransferredKcal,e.ledger?.birthTransferredKcal)||!Number.isSafeInteger(e.deaths)||e.deaths<l.captures+l.naturalDeaths||!e.ledger||!below(l.metabolizedKcal,e.ledger.metabolizedKcal)||!below(l.humanIngestedKcal,e.ledger.humanRemovedKcal)||!below(l.overflowLostKcal,e.ledger.discardedKcal))return 'Aquatic and global ledgers disagree';
 if(!close(l.primaryProducedMassGrams,l.primaryProducedKcal/2)||!close(l.primaryProducedWaterMl,l.primaryProducedKcal/4)||!below(l.primaryProducedKcal,e.ledger.photosynthesisKcal))return 'Invalid aquatic primary production';
 if(!Array.isArray(q.patches)||q.patches.length!==q.acceptedPatches||q.patches.some(p=>!exact(p,['position','food'])||!exact(p.position,['x','y'])||!aquaticHabitat(geometry,p.position)||stockError(p.food,{massGrams:A.foodCapacityKcal/2,energyKcal:A.foodCapacityKcal,waterMl:A.foodCapacityKcal/4})))return 'Invalid aquatic food patch';
 if(!Array.isArray(q.origins)||q.origins.length>A.maxLiveFish+R.maxMaterials||q.origins.some(o=>!exact(o,['id','tissueLimitGrams'])||!id(o.id)||Number(o.id.slice(7))>=e.nextId||!finite(o.tissueLimitGrams)||!below(o.tissueLimitGrams,A.tissue.massGrams))||new Set(q.origins.map(o=>o.id)).size!==q.origins.length)return 'Invalid aquatic origins';
 const foodKcal=aquaticFoodEnergy(e),live=q.fish;
 if(!close(foodKcal+l.fedKcal,l.primaryProducedKcal)||!below(live.reduce((n,f)=>n+f.fedKcal,0),l.fedKcal)||!below(live.reduce((n,f)=>n+f.spentKcal,0),l.metabolizedKcal)||!below(live.reduce((n,f)=>n+f.growthReserveKcal,0),l.growthTransferredKcal*464/110)||!below(live.reduce((n,f)=>n+f.birthReserveKcal,0),l.birthTransferredKcal)||!below(l.births*(110*.99+30)*A.birthFraction,l.birthTransferredKcal)||!below(l.birthTransferredKcal,l.births*150*A.birthFraction)||!below(l.growthTransferredKcal*464/110,l.initialKcal+l.fedKcal))return 'Invalid aquatic lifecycle transfers';
 if(q.origins.some(o=>!q.initialIds.includes(o.id)&&(l.births===0||Number(o.id.slice(7))<=Math.max(0,...q.initialIds.map(x=>Number(x.slice(7)))))))return 'Invalid recruited fish origin';
 const seen=new Set(),origins=new Map(q.origins.map(o=>[o.id,o])),whole=new Set(),tissueByOrigin=new Map();
 for(const o of [...(e.plants||[]),...(e.animals||[]),...(e.materials||[]),...q.fish]){if(!id(o?.id)||seen.has(o.id)||Number(o.id.slice(7))>=e.nextId)return 'Invalid or duplicate aquatic object identity';seen.add(o.id);}
 const fishFields=['id','kind','phenotype','scene','position','tissue','residue','reserve','direction','phaseSeconds','rngState','ageHours','spentMassGrams','spentKcal','releasedWaterMl','initialReserveKcal','fedKcal','growthReserveKcal','birthReserveKcal','lastBirthHours'];
 for(const f of q.fish){
  if(!exact(f,fishFields)||f.kind!=='fish'||f.phenotype!==A.phenotype||f.scene!=='valley'||!origins.has(f.id)||!exact(f.position,['x','y'])||!Number.isFinite(f.position.x)||!Number.isFinite(f.position.y)||stockError(f.tissue,A.tissue)||stockError(f.residue,A.residue)||stockError(f.reserve,A.reserve)||f.reserve.energyKcal<=0||!Number.isFinite(f.direction)||f.direction<0||f.direction>=Math.PI*2||!Number.isFinite(f.phaseSeconds)||f.phaseSeconds<0||f.phaseSeconds>=A.cruiseSeconds+A.dartSeconds||!Number.isSafeInteger(f.rngState)||f.rngState<1||f.rngState>0xffffffff||!finite(f.ageHours)||f.ageHours>=A.lifespanHours||!close(f.spentKcal,f.ageHours*(A.maintenanceKcalPerHour+A.swimmingKcalPerHour))||!finite(f.spentMassGrams)||!finite(f.spentKcal)||!finite(f.releasedWaterMl)||!close(f.spentMassGrams,f.spentKcal/2)||!close(f.releasedWaterMl,f.spentKcal/4)||!['initialReserveKcal','fedKcal','growthReserveKcal','birthReserveKcal','lastBirthHours'].every(k=>finite(f[k]))||f.initialReserveKcal>A.reserve.energyKcal||f.lastBirthHours>f.ageHours||!close(f.reserve.energyKcal+f.spentKcal+f.growthReserveKcal+f.birthReserveKcal,f.initialReserveKcal+f.fedKcal)||!close(f.tissue.massGrams,origins.get(f.id).tissueLimitGrams)||!close(f.tissue.massGrams/A.tissue.massGrams,f.residue.massGrams/A.residue.massGrams))return 'Invalid live fish';
  if(!aquaticHabitat(geometry,f.position))return 'Fish is outside the modeled littoral band';
  whole.add(f.id);tissueByOrigin.set(f.id,f.tissue.massGrams);
 }
 for(const m of e.materials||[]){
  const error=aquaticMaterialError(m);if(error)return error;
  if(!isAquaticMaterial(m))continue;
  if(!origins.has(m.originFishId))return 'Unknown fish provenance';
  if(m.kind==='fish_specimen'){if(whole.has(m.originFishId))return 'Duplicate whole fish';whole.add(m.originFishId);}
  tissueByOrigin.set(m.originFishId,(tissueByOrigin.get(m.originFishId)||0)+(m.kind==='fish_specimen'?m.fishTissue.massGrams:m.massGrams));
 }
 if([...tissueByOrigin].some(([id,n])=>!below(n,origins.get(id).tissueLimitGrams)))return 'Duplicated fish tissue';
 if(Object.values(aquaticStockAudit(e)).some(n=>Math.abs(n)>tolerance(l.initialMassGrams+l.primaryProducedMassGrams,l.initialKcal+l.primaryProducedKcal,l.initialWaterMl+l.primaryProducedWaterMl)))return 'Aquatic stocks disagree';
 return null;
}
