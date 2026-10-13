/** Matched, deterministic multi-need trials. No language-model endpoint is called. */
import {writeFile} from 'node:fs/promises';
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {CONFIG,NPC_PRESETS,NPC_RULES,ENV_RULES} from '../src/config.js';
import {createNpc} from '../src/npc-state.js';
import {NpcController} from '../src/controller.js';
import {createEnvironment,tickEnvironment} from '../src/environment.js';
import {shelterSource} from '../src/resources.js';
import {canStand,distance} from '../src/world.js';
import {recordEvent} from '../src/npc-memory.js';

const seeds=[74193,3],dt=CONFIG.fixedStep;
const scenarios=[
 {id:'ordinary',seconds:600,description:'Fresh pond-side start; actual clock and seeded weather; finite food stocks.'},
 {id:'hot-afternoon',seconds:240,hour:14,weather:'clear',nearRefuge:true,description:'Matched evaluation start near a locally visible refuge and apple patch, with empty inventory and flask; clear afternoon.'},
 {id:'cold-windy-night',seconds:240,hour:4,weather:'windy',nearRefuge:true,description:'Matched evaluation start near a locally visible refuge and apple patch; cold windy night.'},
 {id:'depleted-food',seconds:300,depletedFood:true,description:'All finite apple patches unavailable for the evaluation window. A deliberate impossible-food boundary, not a survival-success scenario.'},
 {id:'unavailable-starting-water',seconds:300,unavailableWater:true,description:'Starting pond unavailable; existing river/lake sources remain physical alternatives; finite food and weather remain active.'},
];
function run(scenario,seed,learning){
 const npc=createNpc({seed,learning}),env=createEnvironment(seed);
 if(scenario.hour!==undefined)env.settings.hourOverride=scenario.hour;
 if(scenario.weather)env.settings.weatherOverride=scenario.weather;
 if(scenario.nearRefuge){const cave=shelterSource('refuge');let position;for(const [dx,dy]of[[0,160],[-100,160],[100,160],[0,100]]){const p={x:cave.x+dx,y:cave.y+dy};if(canStand(p.x,p.y)){position=p;break;}}if(!position)throw new Error('No physical refuge test approach');npc.position=position;recordEvent(npc,'debug',{provenance:'matched evaluation setup',setting:'starting position',value:position});}
 if(scenario.depletedFood)for(const stock of env.foodStocks){stock.stock=0;stock.renewAt=100000;}
 if(scenario.unavailableWater)env.unavailableSources=Array.from({length:8},(_,i)=>`pond:spring:${i}`);
 const controller=new NpcController(npc,{environment:env}),initial={...npc.position};let travel=0,shelteredSeconds=0,minimumHydration=100,minimumNourishment=100,maximumStrain=0;
 for(let frame=0;frame<Math.round(scenario.seconds/dt);frame++){
   const before={position:{...npc.position},scene:npc.scene};tickEnvironment(env,dt);controller.tick(dt);
   if(before.scene===npc.scene)travel+=distance(before.position,npc.position);
   if(npc.scene!=='valley')shelteredSeconds+=dt;
   minimumHydration=Math.min(minimumHydration,npc.hydration);minimumNourishment=Math.min(minimumNourishment,npc.nourishment);maximumStrain=Math.max(maximumStrain,npc.thermal.hot,npc.thermal.cold);
 }
 controller.dispose();
 return {seed,learning,start:initial,seconds:scenario.seconds,stats:{...npc.stats},riskCost:npc.riskCost,travel:Math.round(travel),shelteredSeconds,minimumHydration,minimumNourishment,maximumStrain,final:{scene:npc.scene,position:{...npc.position},hydration:npc.hydration,nourishment:npc.nourishment,health:npc.health},discovered:{water:Object.keys(npc.memory.sources).length,food:Object.keys(npc.memory.foods).length,shelters:Object.keys(npc.memory.shelters).length},skills:npc.memory.skills.map(s=>({id:s.id,status:s.status,recognition:s.recognition,successes:s.successes,failures:s.failures})),remainingEvidence:npc.memory.experience.length};
}
function summary(trials){const means={};for(const name of ['independentDrinks','independentMeals','warningSeconds','criticalSeconds','injuries','collapses','rescues','invalidActions','repeatedInvalid','skillUses'])means[name]=trials.reduce((sum,t)=>sum+t.stats[name],0)/trials.length;for(const name of ['riskCost','travel','shelteredSeconds'])means[name]=trials.reduce((sum,t)=>sum+t[name],0)/trials.length;return means;}
if(!isMainThread){
 const {scenario,seed}=workerData;
 parentPort.postMessage({scenarioId:scenario.id,withLearning:run(scenario,seed,true),withoutLearning:run(scenario,seed,false)});
}else{
 const jobs=scenarios.flatMap(scenario=>seeds.map(seed=>({scenario,seed}))),completed=[];let nextJob=0;
 async function workerLoop(){while(nextJob<jobs.length){const job=jobs[nextJob++],began=Date.now();const trial=await new Promise((resolve,reject)=>{const worker=new Worker(new URL(import.meta.url),{workerData:job});worker.once('message',resolve);worker.once('error',reject);worker.once('exit',code=>{if(code!==0)reject(new Error(`Evaluation worker exited ${code}`));});});completed.push(trial);console.log(`${job.scenario.id} seed ${job.seed} (${Math.round((Date.now()-began)/1000)}s): learned meals ${trial.withLearning.stats.independentMeals}, drinks ${trial.withLearning.stats.independentDrinks}, collapses ${trial.withLearning.stats.collapses}; control collapses ${trial.withoutLearning.stats.collapses}.`);}}
 await Promise.all(Array.from({length:Math.min(4,jobs.length)},()=>workerLoop()));
 const results=scenarios.map(scenario=>{const trials=seeds.map(seed=>completed.find(t=>t.scenarioId===scenario.id&&t.withLearning.seed===seed)).map(({withLearning,withoutLearning})=>({withLearning,withoutLearning}));return {...scenario,summary:{withLearning:summary(trials.map(t=>t.withLearning)),withoutLearning:summary(trials.map(t=>t.withoutLearning))},trials};});
const output={version:CONFIG.version,worldSeed:CONFIG.seed,controller:'offline factored experiential learner with supplied physiology, action affordances, navigation and bounded recognition templates',liveInferenceTested:false,modelConfiguration:null,timestep:dt,seeds,workerConcurrency:4,pairedTrialsPerScenario:seeds.length,normalRules:NPC_PRESETS.normal,bodyRules:NPC_RULES,environmentRules:ENV_RULES,independentSuccessDefinition:'ordinary collected water/food consumption giving at least 15 useful reserve points; water at most once per fill, apple at most once per collected item',control:'Same body, affordances and physiological priorities; no retained past terrain/resources/routes, action values, temporal learning or procedures. Current local observations remain available.',scenarios:results,limitations:['Only two matched seeds per scenario; these are functional probes, not statistical evidence of general reliability.','Matched fixed world geometry; controller RNG and weather seeds vary.','The hot/night trials deliberately start near a locally visible refuge and food; they do not establish that an untrained agent can discover a distant cave in time.','Food-depleted trials deliberately have no food during the evaluation window; eventual harm is an expected boundary.','Offline results do not establish live Ollama behavior or language-model weight training.','Procedures use supplied water/food/shelter recognition templates; arbitrary skill invention is not implemented.','No convergence guarantee or claim that each successive attempt improves.']};
await writeFile(new URL('../docs/npc-evaluation.json',import.meta.url),JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify(results.map(r=>({scenario:r.id,summary:r.summary})),null,2));

}
