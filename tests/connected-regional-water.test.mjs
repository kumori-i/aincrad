import test from 'node:test';
import assert from 'node:assert/strict';
import {CONFIG, PONDS} from '../src/config.js';
import {createRegions, habitatConditions, plantSuitability, regionAt, regionRunoffGraph,
  advanceRegionalWater, consumeRegionalWater, consumeConnectedGrowth, regionalWaterAudit,
  validateRegions} from '../src/ecology-regions.js';

const near=(a,b,tolerance=1e-6)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} != ${b}`);
const clone=structuredClone;
function fixture(){
  const detritus={nutrients:5000,massGrams:0,energyKcal:0};
  return {ecosystemModelVersion:1,regionalVersion:1,detritus,
    regions:createRegions(detritus,[],1)};
}

test('connected site is deterministic while omitted model keeps exact legacy output',()=>{
  const positions=[{x:360,y:1080},{x:15500,y:-16000},{x:-4000,y:-6500}];
  for(const p of positions){
    assert.deepEqual(habitatConditions(p),habitatConditions(p,0));
    assert.deepEqual(habitatConditions(p,1),habitatConditions(p,1));
    assert.equal(plantSuitability('grass',p),plantSuitability('grass',p,0));
    assert.ok(habitatConditions(p,1).moisture>=0&&habitatConditions(p,1).moisture<=1);
  }
  const pond=PONDS[0],nearBank={x:pond.x+pond.rx+50,y:pond.y};
  assert.ok(habitatConditions(nearBank,1).bankInfluence>habitatConditions({x:18000,y:18000},1).bankInfluence);
});

test('all 49 proxy runoff routes descend to fixed water or a named model outlet',()=>{
  const graph=regionRunoffGraph();assert.equal(graph.length,49);
  assert.deepEqual(graph,regionRunoffGraph());
  assert.ok(graph.some(r=>r.to==='fixed-water'));
  const ids=new Set(graph.map(r=>r.id));assert.equal(ids.size,49);
  for(const origin of graph){
    let row=origin,steps=0;
    while(row.to.startsWith('region:')){
      const next=graph.find(r=>r.id===row.to);assert.ok(next);
      assert.ok(next.potential<row.potential||next.potential===row.potential&&next.id<row.id);
      row=next;assert.ok(++steps<49);
    }
    assert.ok(row.to==='fixed-water'||row.to.startsWith('model-outlet:'));
  }
});

test('rain, seepage, evaporation, runoff and uptake close each local and total soil-water account',()=>{
  const e=fixture(),before=clone(e.regions),site=PONDS[0];
  advanceRegionalWater(e,CONFIG.dayRealSeconds*7,{rainfall:4,seepage:1,evaporation:1});
  assert.ok(e.regions.some(r=>r.runoffOutMl>0));
  assert.ok(e.regions.some(r=>r.runoffInMl>0));
  const taken=consumeRegionalWater(e,site,850);assert.ok(taken>0&&taken<=850);
  const audit=regionalWaterAudit(e);
  near(audit.maxRegionalWaterError,0);near(audit.waterBalanceError,0);
  assert.ok(audit.outletExportMl>0);
  assert.ok(e.regions.every((r,i)=>r.soilWaterMl>=0&&r.soilWaterMl<=r.soilWaterCapacityMl&&r.initialWaterMl===before[i].initialWaterMl));
  const loaded={ecosystemModelVersion:1,detritus:clone(e.detritus)};
  validateRegions(e,loaded);assert.deepEqual(loaded.regions,e.regions);
  for(const mutate of [r=>{r.soilWaterMl=null;},r=>{r.soilWaterMl=r.soilWaterCapacityMl+1;},r=>{r.runoffInMl+=1;}]){
    const bad=clone(e);mutate(bad.regions[0]);
    assert.throws(()=>validateRegions(bad,{ecosystemModelVersion:1,detritus:clone(e.detritus)}),/Protected connected ecology save/);
  }
});

test('zero local soil water stops growth despite a wet nominal site and fertile neighbors',()=>{
  const e=fixture(),site={x:PONDS[0].x+PONDS[0].rx+50,y:PONDS[0].y};
  const row=regionAt(e,site);assert.ok(row&&row.nutrients>0);
  const beforeNutrients=row.nutrients,totalBefore=e.detritus.nutrients,openingWater=row.soilWaterMl;
  row.soilWaterMl=0;row.uptakeMl+=openingWater;
  const result=consumeConnectedGrowth(e,site,.5,120);
  assert.deepEqual(result,{fraction:0,nutrients:0,waterMl:0});
  assert.equal(row.nutrients,beforeNutrients);assert.equal(e.detritus.nutrients,totalBefore);
  assert.ok(e.regions.some(other=>other!==row&&other.soilWaterMl>0&&other.nutrients>0));
  advanceRegionalWater(e,CONFIG.dayRealSeconds,{rainfall:0,seepage:0,evaporation:0});
  assert.equal(row.soilWaterMl,0);
  near(regionalWaterAudit(e).waterBalanceError,0);
  advanceRegionalWater(e,CONFIG.dayRealSeconds,{rainfall:1,seepage:0,evaporation:0});
  const admitted=consumeConnectedGrowth(e,site,.5,120);
  assert.ok(admitted.fraction>0&&admitted.fraction<=1);
  near(admitted.nutrients,.5*admitted.fraction);near(admitted.waterMl,120*admitted.fraction);
  near(regionalWaterAudit(e).maxRegionalWaterError,0);
});

test('historical regional validation does not require or create water fields',()=>{
  const detritus={nutrients:10,massGrams:0,energyKcal:0},raw={regionalVersion:1,regions:createRegions(detritus)};
  const restored={detritus:clone(detritus)};validateRegions(raw,restored);
  assert.equal(restored.regions.length,49);
  assert.ok(restored.regions.every(r=>!Object.hasOwn(r,'soilWaterMl')));
});
