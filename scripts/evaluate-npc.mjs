/** Controlled offline evaluation; no language-model service or paid inference is called. */
import { writeFile } from 'node:fs/promises';
import { CONFIG, NPC_PRESETS } from '../src/config.js';
import { createNpc } from '../src/npc-state.js';
import { NpcController } from '../src/controller.js';
import { observeNpc } from '../src/npc.js';
import { waterSource } from '../src/resources.js';
import { canStandOutside } from '../src/world.js';
import { recordEvent } from '../src/npc-memory.js';
import { tileKey } from '../src/perception.js';

const seeds=[74193,3,11,29,47,103,211,509];
const seconds=300,transferSeconds=120,dt=CONFIG.fixedStep;
let transferSource;
for(let row=6;row<20;row++){const source=waterSource(`river:east:${row}`);if(source&&canStandOutside(source.x+150,source.y)){transferSource=source;break;}}
if(!transferSource)throw new Error('No safe changed starting condition found.');
function simulate(controller,duration){
  const npc=controller.npc,recent=[],targets=new Set();let arrivals=0,revisited=0;
  for(let frame=0;frame<Math.round(duration/dt);frame++){
    const previous=npc.lastResult?.eventId;controller.tick(dt);
    if(npc.lastResult?.eventId===previous||npc.lastResult?.action!=='move'||npc.lastResult?.code!=='ARRIVED')continue;
    const event=npc.memory.experience.find(e=>e.id===npc.lastResult.eventId);
    if(event?.details.action.sourceId)continue;
    const target=tileKey(npc.position);arrivals++;if(recent.includes(target))revisited++;
    recent.push(target);if(recent.length>12)recent.shift();targets.add(target);
  }
  return {explorationArrivals:arrivals,revisitedExplorationTargets:revisited,distinctExplorationTargets:targets.size};
}
function run(learning,seed,preset){
  const npc=createNpc({preset,learning,seed}),controller=new NpcController(npc);
  const exploration=simulate(controller,seconds);
  const initial={...npc.stats},initialSkills=npc.memory.skills.length;
  // An explicitly tagged evaluation setup, not rescue and not NPC-accessible fast travel.
  npc.position={x:transferSource.x+150,y:transferSource.y};npc.hydration=50;npc.flask.water=0;npc.flask.provenance=null;
  npc.lifecycle='AWAKE';npc.lifecycleAt=npc.elapsed;npc.active=null;npc.skillRun=null;npc.navigationAnchor=null;npc.epoch++;controller.cancel();
  recordEvent(npc,'debug',{setting:'matched transfer starting condition',value:npc.position,provenance:'evaluation setup'});
  observeNpc(npc);const transferAt=npc.elapsed;
  const transferExploration=simulate(controller,transferSeconds);
  const transferFirst=npc.memory.experience.find(e=>e.type==='action'&&e.at>=transferAt&&e.details.result?.independent);
  return {seed,learning,initial:{independentDrinks:initial.independentDrinks,collections:initial.collections,collapses:initial.collapses,rescues:initial.rescues,invalidActions:initial.invalidActions,repeatedInvalid:initial.repeatedInvalid,timeToFirstWater:initial.firstWaterAt,skills:initialSkills,skillUses:initial.skillUses,...exploration},transfer:{independentDrinks:npc.stats.independentDrinks-initial.independentDrinks,collapses:npc.stats.collapses-initial.collapses,rescues:npc.stats.rescues-initial.rescues,invalidActions:npc.stats.invalidActions-initial.invalidActions,repeatedInvalid:npc.stats.repeatedInvalid-initial.repeatedInvalid,timeToFirstWater:transferFirst?transferFirst.at-transferAt:null,skillUses:npc.stats.skillUses-initial.skillUses,...transferExploration},finalSkills:npc.memory.skills.map(s=>({id:s.id,status:s.status,successes:s.successes,failures:s.failures}))};
}
function summarize(trials,key){
  const rows=trials.map(t=>t[key]),mean=(stage,metric)=>rows.reduce((n,r)=>n+r[stage][metric],0)/rows.length;
  return {initialIndependentDrinks:mean('initial','independentDrinks'),initialCollections:mean('initial','collections'),initialCollapses:mean('initial','collapses'),initialRescues:mean('initial','rescues'),initialRepeatedInvalid:mean('initial','repeatedInvalid'),initialSkillUses:mean('initial','skillUses'),initialRevisitedExplorationTargets:mean('initial','revisitedExplorationTargets'),initialDistinctExplorationTargets:mean('initial','distinctExplorationTargets'),transferIndependentDrinks:mean('transfer','independentDrinks'),transferCollapses:mean('transfer','collapses'),transferSkillUses:mean('transfer','skillUses')};
}
const results={};
for(const preset of ['normal','accelerated']){
  const trials=[];
  for(const seed of seeds){trials.push({withLearning:run(true,seed,preset),withoutLearning:run(false,seed,preset)});console.log(`Completed ${preset} matched trial ${seed}.`);}
  results[preset]={preset,rules:NPC_PRESETS[preset],summary:{withLearning:summarize(trials,'withLearning'),withoutLearning:summarize(trials,'withoutLearning')},trials};
}
const result={version:CONFIG.version,worldSeed:CONFIG.seed,controller:'offline tabular experiential learner (not a language model and not a scripted survival mock)',liveInferenceTested:false,modelConfiguration:null,preset:'accelerated',trialCount:seeds.length,simulationSeconds:seconds,transferSeconds,timestep:dt,transferStartingPosition:{x:transferSource.x+150,y:transferSource.y},independentSuccessDefinition:'ordinary collected-water drinking giving at least 15 hydration; at most one credited success per fill',revisitedTargetDefinition:'a completed exploration movement ending in one of the previous 12 exploration arrival tiles; source approaches are excluded',summary:results.accelerated.summary,trials:results.accelerated.trials,normal:results.normal,limitations:['Fixed matched world geometry; the controller RNG seeds vary.','These are controlled offline trials; they do not establish performance for a live language model.','The initial expedition origin and action affordances are infrastructure supplied to both conditions. Persistent values, procedural skills, past terrain, failed routes and visit histories are disabled in the control.','The transfer is an explicit evaluation setup at the same safe position for both conditions, never a rescue teleport.','A revisit may be justified by obstacles or returning to another frontier; it is not by itself proof of aimless circling.','No guarantee that each successive attempt improves.']};
await writeFile(new URL('../docs/npc-evaluation.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({normal:results.normal.summary,accelerated:results.accelerated.summary},null,2));
