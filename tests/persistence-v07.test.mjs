import {legacySave} from './legacy-save-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { freshState } from '../src/world.js';
import { ecologyEnergy } from '../src/ecology.js';
import { createEnvironment, environmentConditions, tickEnvironment } from '../src/environment.js';
import { applyWorldRules } from '../src/world-rules.js';
import { PopulationRuntime } from '../src/population.js';


function storage(){const entries=new Map();return{getItem:key=>entries.get(key)??null,setItem:(key,value)=>entries.set(key,value)};}










test('rainfall settings change deterministic weather, and never advance time themselves',()=>{
  const dry=createEnvironment(3,{mode:'discovery'}),wet=createEnvironment(3,{mode:'discovery'});applyWorldRules(dry,{rainfallMultiplier:0});applyWorldRules(wet,{rainfallMultiplier:2.5});
  let dryRain=0,wetRain=0;for(let i=0;i<80;i++){tickEnvironment(dry,240);tickEnvironment(wet,240);dryRain+=dry.weather.kind==='rainy';wetRain+=wet.weather.kind==='rainy';}
  assert.equal(dryRain,0);assert.ok(wetRain>0);assert.equal(dry.elapsed,wet.elapsed);
});





test('shadow population has no Cardinal and no background work; ordinary population observes the shared clock once',()=>{
  const state=freshState(),runtime=new PopulationRuntime(state,{cardinal:false});assert.equal(runtime.cardinal,null);const c=JSON.stringify(state.cardinal);assert.equal(runtime.workCardinal(8),null);
  for(let i=0;i<60;i++){state.elapsed+=1/60;runtime.tick(1/60);}assert.ok(Math.abs(state.environment.elapsed-1)<1e-8);assert.equal(JSON.stringify(state.cardinal),c);runtime.dispose();
  const live=freshState(),liveRuntime=new PopulationRuntime(live);assert.ok(liveRuntime.cardinal);for(let i=0;i<60;i++){live.elapsed+=1/60;liveRuntime.tick(1/60);}assert.ok(Math.abs(live.environment.elapsed-1)<1e-8);assert.ok(live.cardinal.observations.length>0);const frozen=JSON.stringify(live);liveRuntime.tick(0);liveRuntime.tick(NaN);assert.equal(JSON.stringify(live),frozen);liveRuntime.dispose();assert.equal(liveRuntime.workCardinal(8),null);
});
