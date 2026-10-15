import { CONFIG } from './config.js';
import { ECOLOGY_RULES as R } from './ecology-config.js';
import { forestAmount, ridgeValue, waterDistance } from './world.js';

const finite = value => Number.isFinite(value) ? value : 0;
const clamp = (value, low, high) => Math.max(low, Math.min(high, finite(value)));
const count = R.habitatGridSize;
const cell = R.habitatExtent * 2 / (count - 1);

/** Engine-only geographical descriptors, not a map/food oracle for inhabitants.
 * Terrain is fixed by the world module; seeds vary populations and weather.
 * Elevation is a ridge proxy, not a hydrological/elevation simulation. */
export function habitatConditions(position) {
  const {x, y} = position;
  const water = Math.max(0, waterDistance(x, y));
  const woodland = forestAmount(x, y);
  const elevation = clamp(ridgeValue(x, y), 0, 1);
  const north = clamp(-y / R.habitatExtent, -1, 1);
  const temperatureOffsetC = -3 * elevation - 2 * north;
  const moisture = clamp(.24 + Math.exp(-water / 1600) * .53 + woodland * .2 + north * .035 - elevation * .12, .12, .95);
  const kind = water < 500 ? 'riparian' : elevation > .35 || north > .58 ? 'cool_upland'
    : woodland > .54 ? 'woodland' : moisture < .34 ? 'dry_meadow' : 'meadow';
  return {kind, waterDistance:water, woodland, elevation, temperatureOffsetC, moisture,
    productivity:clamp((.65 + moisture * .6) * (1 - elevation * .5), .3, 1.2)};
}

export function plantSuitability(kind,position) {
  const site=habitatConditions(position);
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

/** Regions partition, rather than duplicate, the compatibility aggregate. */
export function createRegions(detritus, plants=[]) {
  const rows = Array.from({length:count * count}, (_, index) => {
    const col=index % count, row=Math.floor(index/count);
    const center={x:-R.habitatExtent + col * cell, y:-R.habitatExtent + row * cell};
    const habitat=habitatConditions(center);
    return {id:`region:${col}:${row}`, nutrients:0, massGrams:0, energyKcal:0,
      initialNutrients:0, uptakeNutrients:0, mineralizedNutrients:0,
      initialMassGrams:0, initialEnergyKcal:0, depositedMassGrams:0, depositedKcal:0, decayedMassGrams:0, decomposedKcal:0,
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
  if (ecology.regionalVersion === 1 && Array.isArray(ecology.regions) && ecology.regions.length === count*count) return false;
  ecology.regionalVersion=1;
  ecology.regions=createRegions(ecology.detritus,ecology.plants);
  return true;
}

export function validateRegions(raw, ecology) {
  // This path validates an existing regional world. Only the explicit legacy
  // migration may distribute aggregate stocks. Missing v3 data stays empty.
  const canonical=createRegions({nutrients:0,massGrams:0,energyKcal:0});
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
