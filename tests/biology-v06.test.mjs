import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { BIOLOGY_RULES,BIOLOGY_PROFILES,simulationSeconds } from '../src/biology-config.js';
import { createPhysiology,validatePhysiology,projectPhysiology,tickPhysiology,ingestMaterial,canIngestMaterial,ingestWater,exertPhysiology,beginSleep,wakePhysiology,harmPhysiology,isSleeping } from '../src/biology.js';
import { createNpc } from '../src/npc-state.js';
import { bodySignals,restUnsafe } from '../src/interoception.js';
import { createEnvironment,tickEnvironment } from '../src/environment.js';
import { observeNpc,requestNpcAction,tickNpc,collapseNpc,rescueNpc } from '../src/npc.js';

const comfortable={hour:10,feltTemperature:18,raining:false,sheltered:true};
const actor=(profile='human',overrides={})=>projectPhysiology({species:profile,mode:'discovery',elapsed:0,lifecycle:'AWAKE',physiology:createPhysiology(profile,overrides),feelings:{},thermal:{hot:0,cold:0,wetness:0}});
function advance(a,hours,conditions=comfortable,stepHours=.01){for(let h=0;h<hours-1e-8;h+=stepHours){const dh=Math.min(stepHours,hours-h);a.elapsed+=simulationSeconds(dh);tickPhysiology(a,simulationSeconds(dh),conditions);}}

test('fresh discovery bodies have private separate stores and no supplied food, while historical fixtures remain legacy',()=>{
  const legacy=createNpc(),a=createNpc({mode:'discovery'}),m=createNpc({id:'mira',mode:'discovery'});
  assert.equal(legacy.version,3);assert.equal(legacy.physiology,undefined);assert.equal(a.version,4);assert.equal(a.mode,'discovery');assert.deepEqual(a.inventory.items,[]);assert.equal(a.inventory.apples.length,0);assert.equal(a.discovery.techniques.length,0);
  assert.notEqual(a.physiology,m.physiology);assert.equal(a.physiology.storedEnergyKcal,BIOLOGY_PROFILES.human.initialStoredKcal);assert.equal(a.physiology.outsideAssistance.count,0);
});

test('game-hour physiology advances hours of hunger without a rapid food-meter death',()=>{
  const a=actor(),initial=a.physiology.storedEnergyKcal;advance(a,24);
  assert.equal(a.health,100);assert.ok(a.physiology.waterDeficitMl>2200&&a.physiology.waterDeficitMl<2500);assert.ok(a.physiology.storedEnergyKcal<initial);assert.equal(bodySignals(a).hunger,'ravenous');assert.ok(a.energy>15);assert.equal(a.lifecycle,'AWAKE');
  assert.equal(simulationSeconds(24),CONFIG.dayRealSeconds);assert.equal(bodySignals(a).thirst,'parched');
});

test('prolonged fasting with actual water impairs condition before exhaustion and has no fixed seven-day death',()=>{
  const a=actor();for(let day=0;day<8;day++){for(let hour=0;hour<24;hour++){assert.equal(ingestWater(a,100,{provenance:'fixture'}).ok,true);advance(a,1);}}
  assert.ok(a.physiology.condition<85);assert.ok(a.health>80);assert.ok(a.physiology.storedEnergyKcal>0);assert.equal(a.lifecycle,'AWAKE');assert.equal(a.physiology.outsideAssistance.count,0);
});

test('dehydration impairment and heat/exertion costs precede variable injury',()=>{
  const calm=actor(),hot=actor();advance(calm,24);advance(hot,24,{...comfortable,feltTemperature:33,sheltered:false});
  assert.ok(hot.physiology.waterDeficitMl>calm.physiology.waterDeficitMl);assert.ok(hot.health<calm.health);assert.ok(hot.thermal.hot>calm.thermal.hot);
  const tired=actor(),before=tired.physiology.availableEnergyKcal;exertPhysiology(tired,simulationSeconds(1),2);assert.ok(tired.physiology.availableEnergyKcal<before);assert.ok(tired.stamina<100);assert.ok(tired.fatigue>5);assert.ok(tired.physiology.totals.waterLostMl>0);
});

test('swallowing adds a finite digestive input and yields only delayed attributed qualitative effects',()=>{
  const a=actor('human',{availableEnergyKcal:300,hoursSinceMeal:9,waterDeficitMl:1000}),before=a.physiology.availableEnergyKcal;
  const input={massGrams:120,energyKcal:80,waterMl:100,digestHours:2};const outcome=ingestMaterial(a,input,{objectId:'object:42',actionId:7,provenance:'sampled',at:0});
  assert.equal(outcome.code,'SWALLOWED');assert.equal(a.physiology.availableEnergyKcal,before);assert.equal(a.physiology.feedback.length,0);assert.equal(a.physiology.stomach.length,1);
  advance(a,.1);assert.equal(a.physiology.feedback.length,0);advance(a,.1);assert.equal(a.physiology.feedback.length,1);
  const feedback=a.physiology.feedback[0];assert.equal(feedback.objectId,'object:42');assert.equal(feedback.actionId,7);assert.equal(feedback.ingestionId,outcome.ingestionId);assert.equal(feedback.effect,'sustained');
  for(const [key,value]of Object.entries(feedback))if(!['at','actionId'].includes(key))assert.equal(typeof value==='number',false,key);
  assert.equal('energyKcal' in feedback,false);assert.equal('waterMl' in feedback,false);
  advance(a,3);assert.equal(a.physiology.stomach.length,0);assert.equal(a.physiology.feedback.length,1);
});

test('material effects follow absorption, finite capacity rejects without mutation and harmful samples give discomfort',()=>{
  const a=actor();assert.equal(ingestMaterial(a,{massGrams:1500,energyKcal:100}).code,'TOO_FULL');assert.equal(a.physiology.stomach.length,0);
  const serial=JSON.stringify(a);assert.equal(canIngestMaterial(a,{massGrams:1500}).code,'TOO_FULL');assert.equal(JSON.stringify(a),serial);
  assert.equal(ingestMaterial(a,{massGrams:10,energyKcal:0,waterMl:0,toxicity:1,digestHours:.1},{objectId:'object:9',actionId:2}).ok,true);advance(a,.2);assert.ok(a.health<100);assert.equal(a.physiology.feedback[0].effect,'discomfort');
});

test('early absorbed water relief leaves room for a later sustenance observation from the same sample',()=>{
  const a=actor('human',{waterDeficitMl:1000});const swallowed=ingestMaterial(a,{massGrams:40,energyKcal:8,waterMl:30,digestHours:2},{objectId:'object:17',actionId:8});
  advance(a,.3);assert.equal(a.physiology.feedback[0].effect,'water relief');assert.equal(a.physiology.feedback.length,1);
  advance(a,.5);assert.equal(a.physiology.feedback[1].effect,'sustained');assert.equal(a.physiology.feedback[1].ingestionId,swallowed.ingestionId);assert.notEqual(a.physiology.feedback[0].id,a.physiology.feedback[1].id);
});

test('mass/energy transfers conserve input through gut, absorption, storage and metabolic loss',()=>{
  const a=actor('rabbit'),before=a.physiology.availableEnergyKcal+a.physiology.storedEnergyKcal;
  ingestMaterial(a,{massGrams:30,energyKcal:40,waterMl:15,digestHours:1});advance(a,3);
  const f=a.physiology,after=f.availableEnergyKcal+f.storedEnergyKcal+f.stomach.reduce((sum,v)=>sum+v.remainingKcal,0);
  assert.ok(Math.abs(after+f.totals.metabolizedKcal+f.totals.discardedKcal-before-40)<1e-7);assert.equal(f.totals.ingestedKcal,40);assert.equal(f.profile,'rabbit');
});

test('sleep has onset, vulnerable depth, limited arousal, recovery and inertia without free energy',()=>{
  const a=actor('human',{sleepPressure:85,fatigue:70,waterDeficitMl:100}),before=a.physiology.availableEnergyKcal;
  assert.equal(beginSleep(a,{hours:8}).ok,true);assert.equal(bodySignals(a).activity,'dozing');advance(a,.2);assert.equal(a.physiology.sleep.state,'sleeping');advance(a,1);assert.ok(a.physiology.sleep.depth>.5);
  const still=JSON.stringify(a);assert.equal(wakePhysiology(a,{kind:'sound',intensity:.1}).woke,false);assert.equal(JSON.stringify(a),still);
  assert.equal(wakePhysiology(a,{kind:'contact',intensity:1}).woke,true);assert.ok(a.physiology.sleep.inertiaHours>0);assert.equal(bodySignals(a).sleepiness,'groggy');assert.ok(a.physiology.availableEnergyKcal<before);assert.ok(a.sleepPressure<85);assert.ok(a.fatigue<70);
  assert.equal(isSleeping(a),false);assert.equal(a.physiology.outsideAssistance.count,0);
});

test('distress can awaken a sleeper while severe failure can prevent arousal and contact causes real damage',()=>{
  const a=actor('human',{waterDeficitMl:3200});beginSleep(a,{hours:8});advance(a,.2);assert.equal(isSleeping(a),false);assert.equal(a.physiology.sleep.wakeReason,'distress');
  const severe=actor('human',{health:5,waterDeficitMl:10000});beginSleep(severe,{hours:1});assert.equal(wakePhysiology(severe,{kind:'contact',intensity:1}).woke,false);
  const hurt=actor();beginSleep(hurt,{hours:1});const hit=harmPhysiology(hurt,10,{stimulus:'contact'});assert.equal(hit.damage,10);assert.equal(hit.woke,true);assert.equal(hurt.health,90);assert.equal(hurt.physiology.health,90);
});

test('body sensations remain qualitative, with independent circadian alertness and sleep state',()=>{
  const day=actor('human',{sleepPressure:62}),night=actor('human',{sleepPressure:62});tickPhysiology(day,1,{...comfortable,hour:15});tickPhysiology(night,1,{...comfortable,hour:3});assert.notEqual(bodySignals(day).sleepiness,bodySignals(night).sleepiness);
  for(const value of Object.values(bodySignals(day))){assert.equal(typeof value,'string');assert.equal(/[\d%]/.test(value),false);}
  assert.equal(bodySignals(day).digestion,'empty');assert.equal(bodySignals(day).sleep,'awake');
});

test('discovery NPC dispatcher blocks supplied food macros, permits hours of sleep and loses visual knowledge while sleeping',()=>{
  const n=createNpc({mode:'discovery'}),env=createEnvironment();env.settings.hourOverride=10;env.settings.weatherOverride='cloudy';observeNpc(n,env);
  assert.equal(requestNpcAction(n,{type:'eat'},env).code,'UNDISCOVERED_MACRO');assert.equal(requestNpcAction(n,{type:'sleep',seconds:simulationSeconds(.5)},env).code,'STARTED');
  const before=Object.keys(n.memory.cells).length;
  for(let i=0;i<60;i++){tickEnvironment(env,.25);tickNpc(n,.25,env);}
  const sensed=observeNpc(n,env);assert.deepEqual(sensed.cells,[]);assert.deepEqual(sensed.sources,[]);assert.deepEqual(sensed.objects,[]);assert.equal(Object.keys(n.memory.cells).length,before);assert.equal(isSleeping(n),true);
  wakePhysiology(n,{kind:'contact',intensity:1});tickNpc(n,.25,env);assert.equal(n.lastResult.code,'REST_INTERRUPTED');assert.equal(n.active,null);
});

test('saved physiology preserves gut evidence and unfinished sleep; no outside rescue counts as independent survival',()=>{
  const n=createNpc({mode:'discovery'});ingestMaterial(n,{massGrams:50,energyKcal:40,waterMl:20,digestHours:2},{objectId:'object:3',actionId:4});beginSleep(n,{hours:2});tickPhysiology(n,simulationSeconds(.3),comfortable);
  const restored=validatePhysiology(JSON.parse(JSON.stringify(n.physiology)),{elapsed:n.elapsed});assert.deepEqual(restored,n.physiology);assert.equal(restored.sleep.state,'sleeping');assert.equal(restored.stomach[0].actionId,4);
  n.active=null;collapseNpc(n,'fixture');n.physiology.waterDeficitMl=5000;assert.equal(rescueNpc(n).ok,true);assert.equal(n.physiology.outsideAssistance.count,1);assert.ok(n.physiology.outsideAssistance.energyKcal>0);assert.equal(n.stats.independentMeals,0);assert.equal(n.stats.independentDrinks,0);assert.equal(n.inventory.items.length,0);
});

test('invalid time is inert and game-hour integration is consistent across subdivisions',()=>{
  const a=actor(),b=actor();advance(a,8,comfortable,.01);advance(b,8,comfortable,.05);for(const key of ['availableEnergyKcal','storedEnergyKcal','waterDeficitMl','health','sleepPressure','fatigue'])assert.ok(Math.abs(a.physiology[key]-b.physiology[key])<.01,key);
  const frozen=JSON.stringify(a);tickPhysiology(a,0);tickPhysiology(a,NaN);exertPhysiology(a,-1);assert.equal(JSON.stringify(a),frozen);
  assert.equal(beginSleep(a,{hours:BIOLOGY_RULES.maximumSleepHours+1}).ok,false);assert.equal(restUnsafe(a),false);
});

test('save validation bounds remaining digestive material and scales composition when capacity clips its mass',()=>{
  const raw=createPhysiology('human');raw.stomach=[{id:'ingestion:1',originalMassGrams:2000,remainingMassGrams:2000,originalKcal:1000,remainingKcal:2000,absorbedKcal:5000,originalWaterMl:1800,remainingWaterMl:2200,absorbedWaterMl:6000,digestHours:2}];
  const f=validatePhysiology(raw),item=f.stomach[0];assert.equal(item.originalMassGrams,1400);assert.equal(item.remainingMassGrams,1400);assert.equal(item.originalKcal,700);assert.equal(item.remainingKcal,700);assert.equal(item.absorbedKcal,0);assert.equal(item.remainingWaterMl,1260);assert.equal(item.absorbedWaterMl,0);
  raw.stomach.push({...raw.stomach[0],id:'ingestion:2'});assert.equal(validatePhysiology(raw).stomach.length,1);
});
