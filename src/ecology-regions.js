import { CONFIG, PONDS } from './config.js';
import { ECOLOGY_RULES as R } from './ecology-config.js';
import { forestAmount, ridgeValue, waterDistance, riverX, LAKE } from './world.js';

const finite = value => Number.isFinite(value) ? value : 0;
const clamp = (value, low, high) => Math.max(low, Math.min(high, finite(value)));
const count = R.habitatGridSize;
const cell = R.habitatExtent * 2 / (count - 1);

/** Engine-only geographical descriptors, not a map/food oracle for inhabitants.
 * Terrain is fixed by the world module; seeds vary populations and weather.
 * Elevation is a ridge proxy, not a hydrological/elevation simulation. */
export function habitatConditions(position, model=0) {
  const {x, y} = position;
  const water = Math.max(0, waterDistance(x, y));
  const woodland = forestAmount(x, y);
  const elevation = clamp(ridgeValue(x, y), 0, 1);
  const north = clamp(-y / R.habitatExtent, -1, 1);
  const temperatureOffsetC = -3 * elevation - 2 * north;
  if (model === 1) {
    // A deterministic site proxy shared by growth, placement and drawing.
    // The fixed water bodies are boundaries, not a simulated water volume.
    const bankInfluence=Math.exp(-water/1350);
    const slopePotential=clamp(elevation*.72+Math.min(water,6500)/6500*.28,0,1);
    const moisture=clamp(.19+bankInfluence*.57+woodland*.17+north*.045-slopePotential*.16,.07,.94);
    const kind=water<430?'riparian':elevation>.3||north>.58?'cool_upland'
      :woodland>.53&&moisture>.37?'woodland':moisture<.33?'dry_meadow':'meadow';
    return {kind,waterDistance:water,woodland,elevation,temperatureOffsetC,moisture,
      slopePotential,bankInfluence,productivity:clamp((.56+moisture*.72)*(1-elevation*.55),.23,1.22)};
  }
  const moisture = clamp(.24 + Math.exp(-water / 1600) * .53 + woodland * .2 + north * .035 - elevation * .12, .12, .95);
  const kind = water < 500 ? 'riparian' : elevation > .35 || north > .58 ? 'cool_upland'
    : woodland > .54 ? 'woodland' : moisture < .34 ? 'dry_meadow' : 'meadow';
  return {kind, waterDistance:water, woodland, elevation, temperatureOffsetC, moisture,
    productivity:clamp((.65 + moisture * .6) * (1 - elevation * .5), .3, 1.2)};
}

export function plantSuitability(kind,position,model=0) {
  const site=habitatConditions(position,model);
  return kind==='grass'||kind==='bramble'&&site.moisture>.32||kind==='apple_tree'&&site.moisture>.4&&site.temperatureOffsetC>-2.5;
}

export function regionIndex(position) {
  const col = clamp(Math.floor((position.x + R.habitatExtent + cell / 2) / cell), 0, count - 1);
  const row = clamp(Math.floor((position.y + R.habitatExtent + cell / 2) / cell), 0, count - 1);
  return row * count + col;
}
export function regionAt(ecology, position, scene='valley') {
  // Cave material stays in the compatibility detritus remainder; it cannot
  // fertilize a remote valley merely because local coordinates overlap.
  return scene === 'valley' ? ecology.regions?.[regionIndex(position)] || null : null;
}

const centerAt=index=>({x:-R.habitatExtent+(index%count)*cell,
  y:-R.habitatExtent+Math.floor(index/count)*cell});
const regionId=index=>`region:${index%count}:${Math.floor(index/count)}`;

/** Coarse, fixed-geography drainage proxy. Sampling the whole cell plus each
 * pond and river path prevents a small water body from vanishing because it
 * missed the region center. Edges always descend in (potential, region ID) order. */
function makeRunoffGraph(){
  const rows=Array.from({length:count*count},(_,index)=>{
    const center=centerAt(index);let nearest=Infinity,hasFixedWater=false;
    for(let iy=0;iy<=10;iy++)for(let ix=0;ix<=10;ix++){
      const x=center.x+(ix/10-.5)*cell,y=center.y+(iy/10-.5)*cell,d=waterDistance(x,y);
      nearest=Math.min(nearest,Math.max(0,d));if(d<=0)hasFixedWater=true;
    }
    for(const pond of PONDS)if(regionIndex(pond)===index){nearest=0;hasFixedWater=true;}
    if(regionIndex(LAKE)===index){nearest=0;hasFixedWater=true;}
    for(let y=-CONFIG.halfSize;y<=CONFIG.halfSize;y+=350){
      if(regionIndex({x:riverX(y),y})===index){nearest=0;hasFixedWater=true;break;}
    }
    const elevation=clamp(ridgeValue(center.x,center.y),0,1);
    return {id:regionId(index),index,center,nearestWater:nearest,hasFixedWater,
      potential:elevation*2400+nearest};
  });
  return Object.freeze(rows.map((row,index)=>{
    let downstream=null;
    if(!row.hasFixedWater){
      const x=index%count,y=Math.floor(index/count);
      for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]]){
        const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=count||ny>=count)continue;
        const other=rows[ny*count+nx];
        if(other.potential<row.potential-1e-9||(Math.abs(other.potential-row.potential)<=1e-9&&other.id<row.id)){
          if(!downstream||other.potential<downstream.potential-1e-9||Math.abs(other.potential-downstream.potential)<=1e-9&&other.id<downstream.id)downstream=other;
        }
      }
    }
    return Object.freeze({id:row.id,index,center:Object.freeze(row.center),nearestWater:row.nearestWater,
      potential:row.potential,hasFixedWater:row.hasFixedWater,
      to:downstream?downstream.id:row.hasFixedWater?'fixed-water':`model-outlet:${row.id}`});
  }));
}
// world.js imports environment.js, which imports this file. Build only after
// all modules have initialized to avoid evaluating fixed geometry in the cycle.
let runoffGraph,runoffOrder,downstreamIndex;
export function regionRunoffGraph(){
  if(!runoffGraph){
    runoffGraph=makeRunoffGraph();
    runoffOrder=Object.freeze([...runoffGraph].sort((a,b)=>b.potential-a.potential||b.id.localeCompare(a.id)).map(r=>r.index));
    downstreamIndex=Object.freeze(runoffGraph.map(r=>r.to.startsWith('region:')?runoffGraph.findIndex(v=>v.id===r.to):-1));
  }
  return runoffGraph;
}

const waterCapacity=index=>{
  const site=habitatConditions(centerAt(index),1);
  return Math.round(150000+site.woodland*65000+site.moisture*45000);
};
const waterFields=index=>{
  const capacity=waterCapacity(index),site=habitatConditions(centerAt(index),1);
  const initial=Math.round(capacity*(.22+site.moisture*.47));
  return {soilWaterMl:initial,soilWaterCapacityMl:capacity,initialWaterMl:initial,
    rainMl:0,seepageMl:0,runoffInMl:0,runoffOutMl:0,evaporationMl:0,uptakeMl:0};
};

/** Regions partition, rather than duplicate, the compatibility aggregate. */
export function createRegions(detritus, plants=[], model=0) {
  const rows = Array.from({length:count * count}, (_, index) => {
    const col=index % count, row=Math.floor(index/count);
    const center=centerAt(index);
    const habitat=habitatConditions(center,model);
    return {id:`region:${col}:${row}`, nutrients:0, massGrams:0, energyKcal:0,
      initialNutrients:0, uptakeNutrients:0, mineralizedNutrients:0,
      initialMassGrams:0, initialEnergyKcal:0, depositedMassGrams:0, depositedKcal:0, decayedMassGrams:0, decomposedKcal:0,
      ...(model===1?waterFields(index):{}),
      weight:.5+habitat.moisture+plants.filter(p=>regionIndex(p.position)===index).length*.12};
  });
  const total=rows.reduce((sum,r)=>sum+r.weight,0);
  let nutrientLeft=finite(detritus.nutrients), massLeft=finite(detritus.massGrams), energyLeft=finite(detritus.energyKcal);
  for (let i=0;i<rows.length;i++) {
    const r=rows[i], fraction=r.weight/total;
    r.nutrients=i===rows.length-1?nutrientLeft:finite(detritus.nutrients)*fraction;
    r.massGrams=i===rows.length-1?massLeft:finite(detritus.massGrams)*fraction;
    r.energyKcal=i===rows.length-1?energyLeft:finite(detritus.energyKcal)*fraction;
    nutrientLeft-=r.nutrients;massLeft-=r.massGrams;energyLeft-=r.energyKcal;
    r.initialNutrients=r.nutrients;r.initialMassGrams=r.massGrams;r.initialEnergyKcal=r.energyKcal;delete r.weight;
  }
  return rows;
}

/** Migration redistributes existing stocks only; no refill, objects or energy. */
export function initializeRegions(ecology) {
  if (ecology.regionalVersion === 1 && Array.isArray(ecology.regions) && ecology.regions.length === count*count) {
    if(ecology.ecosystemModelVersion===1)validateWaterRows(ecology.regions);
    return false;
  }
  ecology.regionalVersion=1;
  ecology.regions=createRegions(ecology.detritus,ecology.plants,ecology.ecosystemModelVersion===1?1:0);
  return true;
}

const waterKeys=['soilWaterMl','soilWaterCapacityMl','initialWaterMl','rainMl','seepageMl','runoffInMl','runoffOutMl','evaporationMl','uptakeMl'];
const waterTolerance=(a,b)=>Math.max(1e-6,Math.max(Math.abs(a),Math.abs(b))*1e-10);
function validateWaterRows(rows){
  if(!Array.isArray(rows)||rows.length!==count*count)throw new Error('Protected connected ecology save: incomplete regional water');
  const graph=regionRunoffGraph(),upstream=Array(rows.length).fill(0);
  for(let i=0;i<rows.length;i++){
    const row=rows[i],initial=waterFields(i);
    if(!row||row.id!==regionId(i))throw new Error('Protected connected ecology save: invalid region identity');
    for(const key of waterKeys)if(!Number.isFinite(row[key])||row[key]<0||row[key]>1e12)throw new Error(`Protected connected ecology save: invalid ${key}`);
    if(row.soilWaterCapacityMl!==initial.soilWaterCapacityMl||row.initialWaterMl!==initial.initialWaterMl||row.soilWaterMl>row.soilWaterCapacityMl+waterTolerance(row.soilWaterMl,row.soilWaterCapacityMl))throw new Error('Protected connected ecology save: invalid water capacity');
    const closing=row.soilWaterMl+row.runoffOutMl+row.evaporationMl+row.uptakeMl;
    const opening=row.initialWaterMl+row.rainMl+row.seepageMl+row.runoffInMl;
    if(Math.abs(closing-opening)>waterTolerance(closing,opening))throw new Error('Protected connected ecology save: unbalanced regional water');
    const to=graph[i].to;if(to.startsWith('region:'))upstream[downstreamIndex[i]]+=row.runoffOutMl;
  }
  for(let i=0;i<rows.length;i++)if(Math.abs(rows[i].runoffInMl-upstream[i])>waterTolerance(rows[i].runoffInMl,upstream[i]))throw new Error('Protected connected ecology save: unbalanced runoff transfer');
}

export function validateRegions(raw, ecology) {
  // This path validates an existing regional world. Only the explicit legacy
  // migration may distribute aggregate stocks. Missing v3 data stays empty.
  const connected=ecology.ecosystemModelVersion===1;
  if(connected)validateWaterRows(raw.regions);
  const canonical=createRegions({nutrients:0,massGrams:0,energyKcal:0},[],connected?1:0);
  const unique=new Map();
  for (const row of (Array.isArray(raw.regions)&&raw.regionalVersion===1?raw.regions:[]).slice(0,count*count)) if(row && !unique.has(row.id)) unique.set(row.id,row);
  const remaining={nutrients:ecology.detritus.nutrients,massGrams:ecology.detritus.massGrams,energyKcal:ecology.detritus.energyKcal};
  ecology.regionalVersion=1;
  ecology.regions=canonical.map(base=>{
    const saved=unique.get(base.id)||{};
    for(const key of Object.keys(remaining)) {
      base[key]=finite(saved[key])>=0&&finite(saved[key])<=remaining[key]+1e-7?finite(saved[key]):clamp(saved[key],0,remaining[key]);remaining[key]=Math.max(0,remaining[key]-base[key]);
    }
    for(const key of ['initialNutrients','uptakeNutrients','mineralizedNutrients','initialMassGrams','initialEnergyKcal','depositedMassGrams','depositedKcal','decayedMassGrams','decomposedKcal'])base[key]=clamp(saved[key],0,1e12);
    if(connected)for(const key of waterKeys)base[key]=saved[key];
    return base;
  });
  // An unassigned remainder stays unassigned. Damaged/missing regions never
  // receive fresh soil, and caves may legitimately hold unassigned detritus.
}

export function consumeSoil(ecology, position, wanted) {
  const region=regionAt(ecology,position), available=region?region.nutrients:ecology.regionalVersion===1?0:ecology.detritus.nutrients;
  const taken=Math.min(Math.max(0,finite(wanted)),Math.max(0,available),ecology.detritus.nutrients);
  ecology.detritus.nutrients=Math.max(0,ecology.detritus.nutrients-taken);
  if(region){region.nutrients=Math.max(0,region.nutrients-taken);region.uptakeNutrients+=taken;}
  return taken;
}

/** One accounting interval is an in-game day (CONFIG.dayRealSeconds). Inputs
 * are named weather/boundary sources; fixed river/lake/pond volume is outside
 * this ledger. Excess travels once in acyclic downstream order. */
export function advanceRegionalWater(ecology, dtSeconds, {rainfall=0,seepage=1,evaporation=1}={}) {
  if(ecology?.ecosystemModelVersion!==1||!Number.isFinite(dtSeconds)||dtSeconds<=0)return;
  const rows=ecology.regions;
  if(!Array.isArray(rows)||rows.length!==count*count)throw new Error('Connected ecology requires complete regional water');
  const graph=regionRunoffGraph(),days=Math.min(dtSeconds,CONFIG.dayRealSeconds*7)/CONFIG.dayRealSeconds;
  const rainRate=clamp(rainfall,0,4),seepRate=clamp(seepage,0,4),evapRate=clamp(evaporation,0,4);
  for(let i=0;i<rows.length;i++){
    const row=rows[i],g=graph[i],capacity=row.soilWaterCapacityMl;
    const rain=capacity*.075*days*rainRate;
    const seep=capacity*.032*days*seepRate*Math.exp(-g.nearestWater/650);
    row.rainMl+=rain;row.seepageMl+=seep;row.soilWaterMl+=rain+seep;
    const site=habitatConditions(g.center,1);
    const evap=Math.min(row.soilWaterMl,capacity*(.014+(1-site.woodland)*.01)*days*evapRate);
    row.soilWaterMl-=evap;row.evaporationMl+=evap;
  }
  for(const i of runoffOrder){
    const row=rows[i],overflow=Math.max(0,row.soilWaterMl-row.soilWaterCapacityMl);
    if(overflow<=0)continue;
    row.soilWaterMl-=overflow;row.runoffOutMl+=overflow;
    const next=downstreamIndex[i];
    if(next>=0){rows[next].soilWaterMl+=overflow;rows[next].runoffInMl+=overflow;}
  }
}

/** The closed soil account ends here. Material/body water is accounted by its
 * existing machinery and must not be conflated with this regional debit. */
export function consumeRegionalWater(ecology,position,wantedMl){
  if(ecology?.ecosystemModelVersion!==1)return 0;
  const region=regionAt(ecology,position);
  if(!region)return 0;
  const taken=Math.min(Math.max(0,finite(wantedMl)),Math.max(0,region.soilWaterMl));
  region.soilWaterMl-=taken;region.uptakeMl+=taken;
  return taken;
}

/** Atomic local admission: neither water nor nutrients are spent unless the
 * same fraction of the requested plant growth can receive both resources. */
export function consumeConnectedGrowth(ecology,position,wantedNutrients,wantedWaterMl){
  if(ecology?.ecosystemModelVersion!==1)return {fraction:0,nutrients:0,waterMl:0};
  const region=regionAt(ecology,position),nutrients=Math.max(0,finite(wantedNutrients)),water=Math.max(0,finite(wantedWaterMl));
  if(!region||(!nutrients&&!water))return {fraction:0,nutrients:0,waterMl:0};
  const availableNutrients=Math.min(Math.max(0,region.nutrients),Math.max(0,finite(ecology.detritus?.nutrients)));
  const fraction=Math.min(1,nutrients?availableNutrients/nutrients:1,water?Math.max(0,region.soilWaterMl)/water:1);
  if(fraction<=0)return {fraction:0,nutrients:0,waterMl:0};
  const admittedNutrients=nutrients?consumeSoil(ecology,position,nutrients*fraction):0;
  const admittedWater=water?consumeRegionalWater(ecology,position,water*fraction):0;
  return {fraction,nutrients:admittedNutrients,waterMl:admittedWater};
}

export function regionalWaterAudit(ecology){
  const rows=ecology?.ecosystemModelVersion===1?ecology.regions||[]:[];
  const graph=regionRunoffGraph();
  const errors=rows.map(row=>row.soilWaterMl+row.runoffOutMl+row.evaporationMl+row.uptakeMl
    -row.initialWaterMl-row.rainMl-row.seepageMl-row.runoffInMl);
  const outletExportMl=rows.reduce((sum,row,i)=>sum+(graph[i]?.to.startsWith('region:')?0:row.runoffOutMl),0);
  const stockMl=rows.reduce((sum,row)=>sum+row.soilWaterMl,0);
  const capacityMl=rows.reduce((sum,row)=>sum+row.soilWaterCapacityMl,0);
  const initialMl=rows.reduce((sum,row)=>sum+row.initialWaterMl,0);
  const rainMl=rows.reduce((sum,row)=>sum+row.rainMl,0);
  const seepageMl=rows.reduce((sum,row)=>sum+row.seepageMl,0);
  const evaporationMl=rows.reduce((sum,row)=>sum+row.evaporationMl,0);
  const uptakeMl=rows.reduce((sum,row)=>sum+row.uptakeMl,0);
  return {version:rows.length?1:0,regions:rows.length,stockMl,capacityMl,initialMl,rainMl,seepageMl,
    evaporationMl,uptakeMl,outletExportMl,
    maxRegionalWaterError:errors.reduce((max,error)=>Math.max(max,Math.abs(error)),0),
    waterBalanceError:stockMl+evaporationMl+uptakeMl+outletExportMl-initialMl-rainMl-seepageMl,
    dryRegions:rows.filter(row=>row.soilWaterMl<=1e-9).map(row=>row.id)};
}

export function regionalResourceAudit(ecology) {
  const rows=ecology.regions||[];
  return {version:ecology.regionalVersion||0, regions:rows.length,
    maxRegionalMassError:rows.reduce((max,r)=>Math.max(max,Math.abs(r.massGrams+r.decayedMassGrams-r.initialMassGrams-r.depositedMassGrams)),0),
    maxRegionalEnergyError:rows.reduce((max,r)=>Math.max(max,Math.abs(r.energyKcal+r.decomposedKcal-r.initialEnergyKcal-r.depositedKcal)),0),
    maxRegionalSoilError:rows.reduce((max,r)=>Math.max(max,Math.abs(r.nutrients+r.uptakeNutrients-r.initialNutrients-r.mineralizedNutrients)),0),
    soilBalanceError:rows.reduce((sum,r)=>sum+r.nutrients+r.uptakeNutrients-r.initialNutrients-r.mineralizedNutrients,0),
    unassigned:Object.fromEntries(['nutrients','massGrams','energyKcal'].map(key=>[key,finite(ecology.detritus?.[key])-rows.reduce((sum,r)=>sum+r[key],0)])),
    depletedRegions:rows.filter(r=>r.nutrients<.001).map(r=>r.id)};
}
