/** Bounded physical/accounting diagnostics, never agent survival or forest
 * succession evidence. All reductions/interventions are explicit in output. */
import assert from 'node:assert/strict';
import {writeFile,mkdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {CONFIG} from '../src/config.js';
import {ECOLOGY_RULES as R} from '../src/ecology-config.js';
import {createEnvironment,tickEnvironment} from '../src/environment.js';
import {tickEcology,ecologyEnergy,ecologyLifecycleAudit,validateEcology} from '../src/ecology.js';
import {regionalResourceAudit} from '../src/ecology-regions.js';
import {freshState} from '../src/world.js';
import {PopulationRuntime} from '../src/population.js';
import {validateSave,writeSave} from '../src/save.js';
const out=new URL('../test-results/plant-lifecycle/',import.meta.url);await mkdir(out,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex'),sources={};
for(const file of ['src/ecology.js','src/plant-lifecycle.js','src/plant-lifecycle-state.js','src/save.js','src/world.js','src/cardinal-metrics.js','scripts/evaluate-plant-lifecycle.mjs'])sources[file]=sha(await readFile(new URL('../'+file,import.meta.url)));
const report={version:1,startedAt:new Date().toISOString(),sources,node:process.version,platform:process.platform,cases:[],limits:['No autonomous foraging or migration claim','No hydrological mass balance','Cloud CPU measurements do not establish laptop performance']};
const persist=()=>writeFile(new URL('result.json',out),JSON.stringify(report,null,2)+'\n');await persist();
function persistentEcology(e){const copy=structuredClone(e);for(const a of copy.animals){if(a.feelings){assert.deepEqual(Object.keys(a.feelings),['relief']);delete a.feelings;}}return copy;}
function audit(e){const l=e.ledger,result={lifecycle:ecologyLifecycleAudit(e),regional:regionalResourceAudit(e),energyErrorKcal:l.initialKcal+l.photosynthesisKcal+l.externalKcal-ecologyEnergy(e)-l.humanRemovedKcal-l.metabolizedKcal-l.decomposedKcal-l.discardedKcal};assert.ok(Math.abs(result.energyErrorKcal)<1e-6);for(const k of ['massErrorGrams','energyErrorKcal','waterErrorMl'])assert.ok(Math.abs(result.lifecycle[k])<1e-7);return result;}
try{
 // Native 1/60 input steps, unchanged age/fall/season/weather clocks after a
 // declared population reduction. Run past 6-day fall plus 4-day germination.
 const env=createEnvironment(CONFIG.seed,{mode:'discovery'}),e=env.ecology,tree=e.plants.find(p=>p.kind==='apple_tree');e.plants=[tree];e.animals=[];e.ledger.initialKcal=ecologyEnergy(e);
 const initial={fruit:tree.quantity,energyKcal:ecologyEnergy(e),soil:e.detritus.nutrients},start=performance.now();let firstDrop=null,firstRecruit=null;
 const frames=Math.ceil((CONFIG.dayRealSeconds*10+2)*60);
 for(let i=0;i<frames;i++){tickEnvironment(env,1/60);tickEcology(e,1/60,env,[]);if(firstDrop===null&&e.materials.length)firstDrop={at:e.elapsed,id:e.materials[0].id,createdAt:e.materials[0].createdAt};if(firstRecruit===null&&e.lifecycle.seededPlants)firstRecruit={at:e.elapsed,parentId:e.plants.find(p=>p.lifecycleStage==='juvenile').parentMaterialId};}
 assert.ok(firstDrop&&firstRecruit);assert.equal(firstDrop.id,firstRecruit.parentId);assert.ok(firstRecruit.at-firstDrop.at>=CONFIG.dayRealSeconds*4-.5);assert.deepEqual(validateEcology(structuredClone(e)),e);
 report.cases.push({name:'one-tree-native-clock',passed:true,interventions:{retainFirstExistingAppleOnly:true,animalsRemoved:true,initialEnergyRebasedAfterReduction:true,ageOrFallClockChanges:false,weatherOverrides:false,bodiesPresent:false},initial,frames,dt:1/60,elapsed:e.elapsed,environmentElapsed:env.elapsed,firstDrop,firstRecruit,wallMs:performance.now()-start,...audit(e)});await persist();
 // Full layout geometry only. No animals, accelerated due clocks and finite
 // untouched fruit stocks; opportunities are serviced in bounded batches.
 const full=createEnvironment(CONFIG.seed,{mode:'discovery'}),f=full.ecology;f.animals=[];f.ledger.initialKcal=ecologyEnergy(f);const initialPlants=f.plants.length;
 const apples=f.plants.filter(p=>p.kind==='apple_tree');for(const p of apples)p.fallHours=R.fruitFallDays*24-.001;
 tickEnvironment(full,.5);tickEcology(f,.5,full,[]);const dropped=f.materials.map(m=>({id:m.id,position:{...m.position},massGrams:m.massGrams}));
 f.elapsed+=CONFIG.dayRealSeconds*4;full.elapsed=f.elapsed;for(const m of f.materials)m.ageHours=96;
 const attempts=[];for(let i=0;i<Math.ceil(dropped.length/4);i++){const before=f.lifecycle.attempts;tickEnvironment(full,.5);tickEcology(f,.5,full,[]);attempts.push(f.lifecycle.attempts-before);}
 assert.ok(attempts.every(n=>n<=4));assert.equal(f.lifecycle.seededPlants,dropped.length);const children=f.plants.filter(p=>p.lifecycleStage==='juvenile');
 const displacement=children.map(p=>{const m=dropped.find(m=>m.id===p.parentMaterialId);return Math.hypot(p.position.x-m.position.x,p.position.y-m.position.y);});assert.ok(displacement.every(d=>d<=24));
 report.cases.push({name:'full-layout-accelerated-placement',passed:true,interventions:{animalsRemoved:true,initialEnergyRebasedAfterReduction:true,appleFallHours:R.fruitFallDays*24-.001,elapsedJumpGameDays:4,materialAgeHours:96},initialPlants,dropped:dropped.length,attempts,finalPlants:f.plants.length,maxDisplacement:Math.max(...displacement),...audit(f)});await persist();
 // Normal full-population 15-minute gameplay continuation, with save validation
 // at 60-second intervals. Cardinal is explicitly off for bounded test work.
 const state=freshState();state.cardinal.mode='off';const runtime=new PopulationRuntime(state),timings=[],startLive=performance.now();let checks=0;
 for(let frame=0;frame<900*60;frame++){state.elapsed+=1/60;runtime.tick(1/60);if((frame+1)%3600===0){const start=performance.now();const saved=validateSave(state,{restoring:false});timings.push(performance.now()-start);assert.deepEqual(saved.environment.ecology,persistentEcology(state.environment.ecology));checks++;}}
 let bytes=0;assert.equal(writeSave({setItem:(_key,value)=>{bytes=Buffer.byteLength(value);}},state),true);runtime.dispose();timings.sort((a,b)=>a-b);
 report.cases.push({name:'full-world-native-save-continuation',passed:true,interventions:{cardinalMode:'off'},seconds:900,dt:1/60,saveChecks:checks,omittedPreExistingTransientFields:['animals[].feelings.relief'],saveValidationP50Ms:timings[Math.floor(timings.length*.5)],saveValidationP95Ms:timings[Math.ceil(timings.length*.95)-1],saveValidationMaxMs:timings.at(-1),saveBytes:bytes,wallMs:performance.now()-startLive,...audit(state.environment.ecology)});
 report.passed=true;report.maxRssKiB=process.resourceUsage().maxRSS;report.finishedAt=new Date().toISOString();await persist();console.log(JSON.stringify(report,null,2));
}catch(error){report.passed=false;report.error=String(error.stack||error);report.finishedAt=new Date().toISOString();await persist();throw error;}
