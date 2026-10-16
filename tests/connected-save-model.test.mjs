import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { freshState } from '../src/world.js';
import { loadSave, validateSave, writeSave } from '../src/save.js';
import { advanceRegionalWater, regionalWaterAudit } from '../src/ecology-regions.js';

const clone=value=>structuredClone(value);
function storage(initial=null){
  let bytes=initial,writes=0;
  return {getItem:key=>key===CONFIG.saveKey?bytes:null,
    setItem:(key,value)=>{assert.equal(key,CONFIG.saveKey);bytes=value;writes++;},
    get bytes(){return bytes;},get writes(){return writes;}};
}

test('fresh discovery marker and finite regional water survive two exact disk reopenings',()=>{
  const state=freshState(),ecology=state.environment.ecology;
  assert.equal(state.features.connectedEcology,1);
  assert.equal(ecology.ecosystemModelVersion,1);
  assert.equal(ecology.regions.length,49);
  assert.ok(ecology.regions.every(region=>Number.isFinite(region.soilWaterMl)&&
    region.soilWaterMl>=0&&region.soilWaterMl<=region.soilWaterCapacityMl));
  advanceRegionalWater(ecology,30,{rainfall:2});
  assert.ok(ecology.regions.some(region=>region.rainMl>0));
  assert.ok(Math.abs(regionalWaterAudit(ecology).waterBalanceError)<1e-6);
  const disk=storage();assert.equal(writeSave(disk,state),true);
  const first=loadSave(disk);
  assert.equal(first.blocked,false);
  assert.equal(first.state.features.connectedEcology,1);
  assert.deepEqual(first.state.environment.ecology,ecology);
  assert.equal(writeSave(disk,first.state),true);
  const second=loadSave(disk);
  assert.equal(second.blocked,false);
  assert.deepEqual(second.state.environment.ecology,ecology);
});

test('historical discovery restores unmarked with exact ecological stocks and identities',()=>{
  const state=freshState({connectedEcology:false}),ecology=state.environment.ecology;
  assert.equal(Object.hasOwn(state.features,'connectedEcology'),false);
  assert.equal(Object.hasOwn(ecology,'ecosystemModelVersion'),false);
  ecology.regions[0].nutrients-=0.5;
  ecology.regions[0].uptakeNutrients+=0.5;
  ecology.detritus.nutrients-=0.5;
  state.elapsed=state.environment.elapsed=ecology.elapsed=18.5;
  const before=clone(ecology),disk=storage();
  assert.equal(writeSave(disk,state),true);
  for(let i=0;i<2;i++){
    const opened=loadSave(disk);
    assert.equal(opened.blocked,false);
    assert.equal(Object.hasOwn(opened.state.features,'connectedEcology'),false);
    assert.equal(Object.hasOwn(opened.state.environment.ecology,'ecosystemModelVersion'),false);
    assert.deepEqual(opened.state.environment.ecology,before);
    assert.equal(writeSave(disk,opened.state),true);
  }
  const direct=validateSave(clone(state));
  assert.equal(Object.hasOwn(direct.features,'connectedEcology'),false);
});

test('mismatched or malformed connected metadata protects original save bytes',()=>{
  const base=clone(freshState());
  const edits=[
    world=>{delete world.features.connectedEcology;},
    world=>{world.features.connectedEcology=2;},
    world=>{delete world.environment.ecology.ecosystemModelVersion;},
    world=>{world.environment.ecology.ecosystemModelVersion=2;},
    world=>{delete world.features.connectedEcology;delete world.environment.ecology.ecosystemModelVersion;},
    world=>{world.environment.ecology.regions[0].soilWaterMl=null;},
    world=>{world.environment.ecology.regions[0].soilWaterMl=Number.MAX_VALUE;},
  ];
  for(const [index,edit] of edits.entries()){
    const candidate=clone(base);edit(candidate);
    const original=JSON.stringify(candidate),disk=storage(original),opened=loadSave(disk);
    assert.equal(opened.blocked,true,`candidate ${index}`);
    assert.ok(opened.error,`candidate ${index} explains protection`);
    assert.equal(writeSave(disk,opened.state),false,`candidate ${index}`);
    assert.equal(disk.bytes,original,`candidate ${index} retains bytes`);
    assert.equal(disk.writes,0);
  }
});
