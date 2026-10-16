import {legacySave} from './legacy-save-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { freshState } from '../src/world.js';
import { ecologyEnergy } from '../src/ecology.js';
import { createEnvironment, environmentConditions, tickEnvironment } from '../src/environment.js';
import { applyWorldRules } from '../src/world-rules.js';
import { PopulationRuntime } from '../src/population.js';
import { validateSave, writeSave, loadSave } from '../src/save.js';

function storage(){const entries=new Map();return{getItem:key=>entries.get(key)??null,setItem:(key,value)=>entries.set(key,value)};}
function saveData(state){const store=storage();assert.equal(writeSave(store,state),true);return{store,data:JSON.parse(store.getItem(CONFIG.saveKey))};}

test('new worlds save one canonical supervisor and validated world rules without copying agent memories',()=>{
  const state=freshState();assert.equal(state.version,8);assert.equal(state.cardinal.version,1);assert.equal(state.cardinal.mode,'adaptive');assert.equal(state.environment.worldRules.version,1);
  const {store,data}=saveData(state);assert.equal('npc' in data,false);assert.equal('worldRules' in data,false);assert.equal('cardinal' in data.environment,false);assert.ok(data.cardinal);assert.ok(data.environment.worldRules);
  const restored=loadSave(store).state;assert.equal(restored.cardinal.mode,'adaptive');assert.deepEqual(restored.agents[0].discovery,state.agents[0].discovery);assert.notEqual(restored.cardinal,restored.agents[0].discovery);
});

test('old discovery worlds gain regional stocks without replacing materials, identities or evidence',()=>{
  const raw=freshState({connectedEcology:false});legacySave(raw,5);delete raw.cardinal;delete raw.environment.worldRules;raw.environment.schemaVersion=2;raw.environment.ecology.distributionVersion=1;
  const ecology=raw.environment.ecology;
  ecology.plants=ecology.plants.filter(p=>Math.hypot(p.position.x-276,p.position.y-760)<5000);
  ecology.animals=ecology.animals.filter(a=>Math.hypot(a.position.x-276,a.position.y-760)<5000);
  const oldPlantCount=ecology.plants.length;assert.ok(oldPlantCount>0);
  // Retaining a real, depleted existing object verifies migration never
  // replaces or repopulates the existing ecosystem around the two inhabitants.
  const plant=ecology.plants.find(p=>p.kind==='bramble')||ecology.plants[0];plant.quantity=0;const oldId=plant.id;ecology.ledger.initialKcal=ecologyEnergy(ecology);
  const npcBefore=structuredClone(raw.agents[0]);const migrated=validateSave(raw,{restoring:false});
  assert.equal(migrated.version,8);assert.equal(migrated.environment.ecology.distributionVersion,3);assert.equal(migrated.environment.ecology.plants.find(p=>p.id===oldId).quantity,0);
  assert.equal(migrated.environment.ecology.plants.length,oldPlantCount);assert.equal(migrated.environment.ecology.ledger.externalKcal,0);
  assert.equal(migrated.cardinal.mode,'adaptive');assert.deepEqual(migrated.agents[0].discovery,npcBefore.discovery);assert.equal(migrated.agents[0].id,npcBefore.id);assert.equal(migrated.npc,migrated.agents[0]);
  const first=structuredClone(migrated.environment.ecology);const again=validateSave(migrated,{restoring:false});assert.deepEqual(again.environment.ecology,first);
});

test('historical worlds remain legacy under observation rather than automatic rule experiments',()=>{
  const raw=freshState({mode:'legacy'});legacySave(raw,4);delete raw.cardinal;const migrated=validateSave(raw);
  assert.equal(migrated.simulationMode,'legacy');assert.equal(migrated.environment.ecology,undefined);assert.equal(migrated.cardinal.mode,'observe');
  migrated.cardinal.mode='adaptive';assert.equal(validateSave(migrated).cardinal.mode,'observe');
});

test('world settings affect actual local weather and survive restart without entering agent memories',()=>{
  const state=freshState(),env=state.environment,point={position:{x:5000,y:0},scene:'valley'};env.settings.hourOverride=14;env.settings.weatherOverride='windy';
  const before=environmentConditions(env,point);const memory=structuredClone(state.agents[0].discovery);
  assert.equal(applyWorldRules(env,{temperatureOffsetC:3,windMultiplier:2}).ok,true);const after=environmentConditions(env,point);assert.equal(after.airTemperature,before.airTemperature+3);assert.equal(after.wind,before.wind*2);
  const {store}=saveData(state),restored=loadSave(store).state;assert.equal(restored.environment.worldRules.revision,1);assert.deepEqual(environmentConditions(restored.environment,point),after);assert.deepEqual(restored.agents[0].discovery,memory);
  env.settings.weatherOverride='rainy';assert.equal(applyWorldRules(env,{rainfallMultiplier:0}).ok,true);assert.equal(environmentConditions(env,point).raining,false);
  assert.equal(environmentConditions(env,{...point,scene:'refuge'}).feltTemperature,18,'cave refuge retains temperate shelter');
});

test('rainfall settings change deterministic weather, and never advance time themselves',()=>{
  const dry=createEnvironment(3,{mode:'discovery'}),wet=createEnvironment(3,{mode:'discovery'});applyWorldRules(dry,{rainfallMultiplier:0});applyWorldRules(wet,{rainfallMultiplier:2.5});
  let dryRain=0,wetRain=0;for(let i=0;i<80;i++){tickEnvironment(dry,240);tickEnvironment(wet,240);dryRain+=dry.weather.kind==='rainy';wetRain+=wet.weather.kind==='rainy';}
  assert.equal(dryRain,0);assert.ok(wetRain>0);assert.equal(dry.elapsed,wet.elapsed);
});

test('unsupported nested supervisor, rules, environment and distribution versions preserve disk data',()=>{
  for(const change of [s=>s.cardinal.version=99,s=>s.environment.worldRules.version=99,s=>s.environment.schemaVersion=99,s=>s.environment.ecology.distributionVersion=99]){
    const raw=freshState();change(raw);const store=storage(),text=JSON.stringify(raw);store.setItem(CONFIG.saveKey,text);const result=loadSave(store);assert.equal(result.blocked,true);assert.equal(writeSave(store,result.state),false);assert.equal(writeSave(store,raw),false);assert.equal(store.getItem(CONFIG.saveKey),text);
  }
});

test('restart interrupts unfinished experiments while retaining proposed changes without fabricating results',()=>{
  const state=freshState(),c=state.cardinal;c.proposals.push({id:'cardinal:proposal:1',at:0,parameter:'plantGrowthMultiplier',from:1,to:1.25,reason:'test',context:'nutrition',status:'running',origin:'automatic'});c.pending={id:'cardinal:experiment:2',proposalId:'cardinal:proposal:1',startedAt:0,progress:.3};c.status='experimenting';c.nextId=3;
  const {store,data}=saveData(state);assert.equal(data.cardinal.pending.progress,.3);const restored=loadSave(store).state;assert.equal(restored.cardinal.pending,null);assert.equal(restored.cardinal.proposals[0].status,'interrupted');assert.deepEqual(restored.cardinal.experiments,[]);assert.deepEqual(restored.cardinal.interventions,[]);assert.equal(restored.environment.worldRules.values.plantGrowthMultiplier,1);
});

test('shadow population has no Cardinal and no background work; ordinary population observes the shared clock once',()=>{
  const state=freshState(),runtime=new PopulationRuntime(state,{cardinal:false});assert.equal(runtime.cardinal,null);const c=JSON.stringify(state.cardinal);assert.equal(runtime.workCardinal(8),null);
  for(let i=0;i<60;i++){state.elapsed+=1/60;runtime.tick(1/60);}assert.ok(Math.abs(state.environment.elapsed-1)<1e-8);assert.equal(JSON.stringify(state.cardinal),c);runtime.dispose();
  const live=freshState(),liveRuntime=new PopulationRuntime(live);assert.ok(liveRuntime.cardinal);for(let i=0;i<60;i++){live.elapsed+=1/60;liveRuntime.tick(1/60);}assert.ok(Math.abs(live.environment.elapsed-1)<1e-8);assert.ok(live.cardinal.observations.length>0);const frozen=JSON.stringify(live);liveRuntime.tick(0);liveRuntime.tick(NaN);assert.equal(JSON.stringify(live),frozen);liveRuntime.dispose();assert.equal(liveRuntime.workCardinal(8),null);
});
