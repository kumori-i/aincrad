/** Controlled offline evaluation; no language-model service or paid inference is called. */
import { writeFile } from 'node:fs/promises';
import { CONFIG } from '../src/config.js';
import { createNpc } from '../src/npc-state.js';
import { NpcController } from '../src/controller.js';
import { observeNpc } from '../src/npc.js';
import { waterSource } from '../src/resources.js';
import { canStandOutside } from '../src/world.js';
import { recordEvent } from '../src/npc-memory.js';

const seeds=[74193,3,11,29,47,103,211,509];
const seconds=300,transferSeconds=120,dt=CONFIG.fixedStep;
let transferSource;
for(let row=6;row<20;row++){const source=waterSource(`river:east:${row}`);if(source&&canStandOutside(source.x+150,source.y)){transferSource=source;break;}}
if(!transferSource)throw new Error('No safe changed starting condition found.');
function run(learning,seed){
  const npc=createNpc({preset:'accelerated',learning,seed});
  const controller=new NpcController(npc);
  for(let t=0;t<seconds;t+=dt)controller.tick(dt);
  const initial={...npc.stats},initialSkills=npc.memory.skills.length;
  // An explicitly tagged evaluation setup, not rescue and not NPC-accessible fast travel.
  npc.position={x:transferSource.x+150,y:transferSource.y};npc.hydration=50;npc.flask.water=0;npc.flask.provenance=null;
  npc.lifecycle='AWAKE';npc.lifecycleAt=npc.elapsed;npc.active=null;npc.skillRun=null;npc.epoch++;controller.cancel();
  recordEvent(npc,'debug',{setting:'matched transfer starting condition',value:npc.position,provenance:'evaluation setup'});
  observeNpc(npc);const transferAt=npc.elapsed;
  for(let t=0;t<transferSeconds;t+=dt)controller.tick(dt);
  const transferFirst=npc.memory.experience.find(e=>e.type==='action'&&e.at>=transferAt&&e.details.result?.independent);
  return {seed,learning,initial:{independentDrinks:initial.independentDrinks,collections:initial.collections,collapses:initial.collapses,rescues:initial.rescues,invalidActions:initial.invalidActions,repeatedInvalid:initial.repeatedInvalid,timeToFirstWater:initial.firstWaterAt,skills:initialSkills},transfer:{independentDrinks:npc.stats.independentDrinks-initial.independentDrinks,collapses:npc.stats.collapses-initial.collapses,rescues:npc.stats.rescues-initial.rescues,invalidActions:npc.stats.invalidActions-initial.invalidActions,repeatedInvalid:npc.stats.repeatedInvalid-initial.repeatedInvalid,timeToFirstWater:transferFirst?transferFirst.at-transferAt:null,skillUses:npc.stats.skillUses-initial.skillUses},finalSkills:npc.memory.skills.map(s=>({id:s.id,status:s.status,successes:s.successes,failures:s.failures}))};
}
const trials=[];
for(const seed of seeds){trials.push({withLearning:run(true,seed),withoutLearning:run(false,seed)});console.log(`Completed matched trial ${seed}.`);}
function aggregate(key){
  const rows=trials.map(t=>t[key]),mean=(stage,metric)=>rows.reduce((n,r)=>n+r[stage][metric],0)/rows.length;
  return {initialIndependentDrinks:mean('initial','independentDrinks'),initialCollapses:mean('initial','collapses'),initialRescues:mean('initial','rescues'),initialRepeatedInvalid:mean('initial','repeatedInvalid'),transferIndependentDrinks:mean('transfer','independentDrinks'),transferCollapses:mean('transfer','collapses'),transferSkillUses:mean('transfer','skillUses')};
}
const summary={withLearning:aggregate('withLearning'),withoutLearning:aggregate('withoutLearning')};
const result={version:'0.2.0',worldSeed:CONFIG.seed,controller:'offline tabular experiential learner (not a language model and not a scripted survival mock)',liveInferenceTested:false,modelConfiguration:null,preset:'accelerated',trialCount:seeds.length,simulationSeconds:seconds,transferSeconds,timestep:dt,transferStartingPosition:{x:transferSource.x+150,y:transferSource.y},independentSuccessDefinition:'ordinary collected-water drinking giving at least 15 hydration; at most one credited success per fill',summary,trials,limitations:['Fixed matched world geometry; the controller RNG seeds vary.','These are controlled offline trials; they do not establish performance for a live language model.','The transfer is an explicit evaluation setup at the same safe position for both conditions, never a rescue teleport.','No guarantee that each successive attempt improves.']};
await writeFile(new URL('../docs/npc-evaluation.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
