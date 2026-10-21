/** Strict additive aquatic schema; no restoring, repair, or fresh allocation. */
import { AQUATIC_RULES as A, AQUATIC_STOCK_FIELDS as STOCK, AQUATIC_LEDGER_FIELDS as LEDGER } from './aquatic-config.js';
const own=(o,k)=>!!o&&Object.hasOwn(o,k);
const finite=n=>Number.isFinite(n)&&n>=0&&n<=1e12;
const id=x=>typeof x==='string'&&/^object:[1-9][0-9]{0,8}$/.test(x);
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>own(o,k));
const tolerance=(...v)=>1e-7+128*Number.EPSILON*Math.max(1,...v.map(Math.abs));
const close=(a,b)=>Math.abs(a-b)<=tolerance(a,b);
const below=(a,b)=>a<=b+tolerance(a,b);
const STOCK_KEYS=['massGrams','energyKcal','waterMl'];
export const AQUATIC_MATERIAL_FIELDS=Object.freeze(['fishOrigin','originFishId','fishTissue']);
export const aquaticEnabled=e=>e?.aquatic?.version===1;
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
export function freshAquaticState(){return {version:1,fish:[],initialCount:0,acceptedPatches:0,initialIds:[],ledger:Object.fromEntries(LEDGER.map(k=>[k,0]))};}
export const aquaticEnergy=e=>(e?.aquatic?.fish||[]).reduce((n,f)=>n+f.tissue.energyKcal+f.residue.energyKcal+f.reserve.energyKcal,0);
export const fishStock=f=>Object.fromEntries(STOCK.map(k=>[k,f.tissue[k]+f.residue[k]+f.reserve[k]]));
export function aquaticStockAudit(e){
 const l=e?.aquatic?.ledger;
 if(!l)return {massErrorGrams:0,energyErrorKcal:0,waterErrorMl:0};
 const stocks=[...(e.aquatic.fish||[]).map(fishStock),...(e.materials||[]).filter(isAquaticMaterial)];
 const sum=k=>stocks.reduce((n,m)=>n+m[k],0);
 return {massErrorGrams:sum('massGrams')+l.humanIngestedMassGrams+l.detritusTransferredMassGrams+l.overflowLostMassGrams+l.respirationMassGrams-l.initialMassGrams,
  energyErrorKcal:sum('energyKcal')+l.humanIngestedKcal+l.detritusTransferredKcal+l.overflowLostKcal+l.metabolizedKcal-l.initialKcal,
  waterErrorMl:sum('waterMl')+l.humanIngestedWaterMl+l.detritusTransferredWaterMl+l.overflowLostWaterMl+l.releasedWaterMl-l.initialWaterMl};
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
 if(!exact(q,['version','fish','initialCount','acceptedPatches','initialIds','ledger'])||q.version!==1||!Array.isArray(q.fish)||q.fish.length>A.maxLiveFish||!Number.isSafeInteger(q.initialCount)||q.initialCount<0||q.initialCount>A.maxInitialFish||!Number.isSafeInteger(q.acceptedPatches)||q.acceptedPatches<0||q.acceptedPatches>q.initialCount||q.initialCount>q.acceptedPatches*A.fishPerPatch||!Array.isArray(q.initialIds)||q.initialIds.length!==q.initialCount||new Set(q.initialIds).size!==q.initialCount||q.initialIds.some(x=>!id(x)||Number(x.slice(7))>=e.nextId))return 'Invalid aquatic envelope';
 const l=q.ledger,counters=LEDGER.slice(15);
 if(!exact(l,LEDGER)||LEDGER.some(k=>!finite(l[k]))||counters.some(k=>!Number.isSafeInteger(l[k]))||l.captures+l.naturalDeaths+q.fish.length!==q.initialCount||l.captureAttempts<l.captures+l.captureMisses+l.captureFailures)return 'Invalid aquatic accounting';
 if(!close(l.initialMassGrams,q.initialCount*200)||!close(l.initialKcal,q.initialCount*150)||!close(l.initialWaterMl,q.initialCount*126)||!close(l.respirationMassGrams,l.metabolizedKcal/2)||!close(l.releasedWaterMl,l.metabolizedKcal/4)||!below(l.metabolizedKcal,q.initialCount*40))return 'Invalid aquatic endowment or reserve export';
 if(!below(l.humanIngestedMassGrams,q.initialCount*A.tissue.massGrams)||!close(l.humanIngestedKcal,l.humanIngestedMassGrams*A.tissue.energyKcal/A.tissue.massGrams)||!close(l.humanIngestedWaterMl,l.humanIngestedMassGrams*A.tissue.waterMl/A.tissue.massGrams))return 'Invalid human fish export';
 if(!Number.isSafeInteger(e.deaths)||e.deaths<l.captures+l.naturalDeaths||!e.ledger||!below(l.metabolizedKcal,e.ledger.metabolizedKcal)||!below(l.humanIngestedKcal,e.ledger.humanRemovedKcal)||!below(l.overflowLostKcal,e.ledger.discardedKcal))return 'Aquatic and global ledgers disagree';
 const seen=new Set(),origins=new Set(q.initialIds),whole=new Set(),tissueByOrigin=new Map();
 for(const o of [...(e.plants||[]),...(e.animals||[]),...(e.materials||[]),...q.fish]){if(!id(o?.id)||seen.has(o.id)||Number(o.id.slice(7))>=e.nextId)return 'Invalid or duplicate aquatic object identity';seen.add(o.id);}
 const fishFields=['id','kind','phenotype','scene','position','tissue','residue','reserve','direction','phaseSeconds','rngState','ageHours','spentMassGrams','spentKcal','releasedWaterMl'];
 for(const f of q.fish){
  if(!exact(f,fishFields)||f.kind!=='fish'||f.phenotype!==A.phenotype||f.scene!=='valley'||!origins.has(f.id)||!exact(f.position,['x','y'])||!Number.isFinite(f.position.x)||!Number.isFinite(f.position.y)||stockError(f.tissue,A.tissue)||stockError(f.residue,A.residue)||stockError(f.reserve,A.reserve)||!STOCK.every(k=>f.tissue[k]===A.tissue[k]&&f.residue[k]===A.residue[k])||f.reserve.energyKcal<=0||!Number.isFinite(f.direction)||f.direction<0||f.direction>=Math.PI*2||!Number.isFinite(f.phaseSeconds)||f.phaseSeconds<0||f.phaseSeconds>=A.cruiseSeconds+A.dartSeconds||!Number.isSafeInteger(f.rngState)||f.rngState<1||f.rngState>0xffffffff||!finite(f.ageHours)||!close(f.spentKcal,f.ageHours*(A.maintenanceKcalPerHour+A.swimmingKcalPerHour))||!finite(f.spentMassGrams)||!finite(f.spentKcal)||!finite(f.releasedWaterMl)||!close(f.spentMassGrams+f.reserve.massGrams,A.reserve.massGrams)||!close(f.spentKcal+f.reserve.energyKcal,A.reserve.energyKcal)||!close(f.releasedWaterMl+f.reserve.waterMl,A.reserve.waterMl))return 'Invalid live fish';
  if(!aquaticHabitat(geometry,f.position))return 'Fish is outside the modeled littoral band';
  whole.add(f.id);tissueByOrigin.set(f.id,f.tissue.massGrams);
 }
 const liveSpent=q.fish.reduce((n,f)=>n+f.spentKcal,0),pastMetabolism=l.metabolizedKcal-liveSpent;
 if(pastMetabolism+tolerance(pastMetabolism)<l.naturalDeaths*A.reserve.energyKcal||!below(pastMetabolism,(l.naturalDeaths+l.captures)*A.reserve.energyKcal))return 'Fish mortality and metabolism disagree';
 for(const m of e.materials||[]){
  const error=aquaticMaterialError(m);if(error)return error;
  if(!isAquaticMaterial(m))continue;
  if(!origins.has(m.originFishId))return 'Unknown fish provenance';
  if(m.kind==='fish_specimen'){if(whole.has(m.originFishId))return 'Duplicate whole fish';whole.add(m.originFishId);}
  tissueByOrigin.set(m.originFishId,(tissueByOrigin.get(m.originFishId)||0)+(m.kind==='fish_specimen'?m.fishTissue.massGrams:m.massGrams));
 }
 if([...tissueByOrigin.values()].some(n=>!below(n,A.tissue.massGrams)))return 'Duplicated fish tissue';
 if(Object.values(aquaticStockAudit(e)).some(n=>Math.abs(n)>tolerance(l.initialMassGrams,l.initialKcal,l.initialWaterMl)))return 'Aquatic stocks disagree';
 return null;
}
