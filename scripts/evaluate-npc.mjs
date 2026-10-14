/** Matched, deterministic two-character probes; no language-model endpoint is called. */
import {writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {CONFIG,NPC_PRESETS,NPC_RULES,ENV_RULES,BODY_RULES,SOCIAL_RULES} from '../src/config.js';
import {createNpc} from '../src/npc-state.js';
import {createEnvironment} from '../src/environment.js';
import {PopulationRuntime} from '../src/population.js';
import {shelterSource} from '../src/resources.js';
import {freshState,canStand,distance} from '../src/world.js';
import {recordEvent} from '../src/npc-memory.js';

const DEFAULT_SEEDS=[74193,3],dt=CONFIG.fixedStep;
const SCENARIOS=[
  {id:'ordinary',seconds:900,description:'Two fresh pond-side characters; actual clock, seeded weather, finite shared food, and the 600-second food renewal cycle.'},
  {id:'hot-afternoon',seconds:300,hour:14,weather:'clear',nearRefuge:true,description:'Both characters begin near locally visible refuge and apples, with empty inventory/flasks; clear hot afternoon. This tests using known refuge, not discovering a distant cave.'},
  {id:'cold-windy-night',seconds:300,hour:4,weather:'windy',nearRefuge:true,description:'Both characters begin near locally visible refuge and apples, with empty inventory/flasks; cold windy night.'},
  {id:'unanswered-journal',seconds:300,pendingQuestions:true,description:'One bounded setup question per character is submitted to the journal. No human message or answer is injected; bodies and autonomous activity must continue.'},
  {id:'depleted-food',seconds:300,depletedFood:true,description:'Every finite apple patch is unavailable throughout this window. Harm is an expected impossible-food boundary, not a survival-success scenario.'},
];

function options(){
  const result={seeds:DEFAULT_SEEDS,scenarios:SCENARIOS,learning:[true,false],workers:4,output:fileURLToPath(new URL('../docs/npc-evaluation.json',import.meta.url)),diagnostics:null};
  const args=process.argv.slice(2);
  for(let index=0;index<args.length;index++){
    const flag=args[index],value=args[++index];if(value===undefined)throw new Error(`Missing value for ${flag}`);
    if(flag==='--scenario'){const ids=value.split(',');result.scenarios=SCENARIOS.filter(s=>ids.includes(s.id));if(result.scenarios.length!==ids.length)throw new Error('Unknown or repeated scenario');}
    else if(flag==='--seed'){const seeds=value.split(',').map(Number);if(!seeds.length||seeds.some(s=>!Number.isInteger(s)||s<0||s>4294967295))throw new Error('Seeds must be uint32 integers');result.seeds=[...new Set(seeds)];}
    else if(flag==='--learning'){if(!['on','off','both'].includes(value))throw new Error('Learning must be on, off, or both');result.learning=value==='both'?[true,false]:[value==='on'];}
    else if(flag==='--workers'){const workers=Number(value);if(!Number.isInteger(workers)||workers<1||workers>4)throw new Error('Workers must be 1 through 4');result.workers=workers;}
    else if(flag==='--output')result.output=resolve(value);
    else if(flag==='--diagnostics')result.diagnostics=resolve(value);
    else throw new Error(`Unknown argument ${flag}`);
  }
  return result;
}

function metric(npc){return {start:{scene:npc.scene,position:{...npc.position}},travel:0,shelteredSeconds:0,restSeconds:0,sleepSeconds:0,movingSeconds:0,minimumHydration:npc.hydration,minimumNourishment:npc.nourishment,minimumHealth:npc.health,minimumEnergy:npc.energy,minimumStamina:npc.stamina,maximumFatigue:npc.fatigue,maximumSleepPressure:npc.sleepPressure,maximumStrain:0,outcomeCodes:{},plans:{completed:0,interrupted:0,goalVerified:0},restOutcomes:{rested:0,slept:0,unsafe:0,interrupted:0},lastEventId:0,seenPlans:new Set()};}
function collectEvents(npc,m){
  if(npc.memory.nextId-1===m.lastEventId)return;
  for(let index=npc.memory.experience.length-1;index>=0;index--){
    const event=npc.memory.experience[index];if(event.id<=m.lastEventId)break;
    const code=event.details?.result?.code||event.details?.code;
    if(code)m.outcomeCodes[code]=(m.outcomeCodes[code]||0)+1;
    if(code==='RESTED')m.restOutcomes.rested++;
    if(code==='SLEPT')m.restOutcomes.slept++;
    if(code==='UNSAFE_TO_REST')m.restOutcomes.unsafe++;
    if(code==='REST_INTERRUPTED')m.restOutcomes.interrupted++;
  }
  m.lastEventId=npc.memory.nextId-1;
}
function collectPlans(npc,m){
  for(const plan of npc.cognition?.history||[]){
    if(m.seenPlans.has(plan.id))continue;m.seenPlans.add(plan.id);
    if(plan.status==='completed'){m.plans.completed++;if(!/broader goal still requires verification/.test(plan.reason||''))m.plans.goalVerified++;}
    else if(plan.status==='interrupted')m.plans.interrupted++;
  }
}

function run(scenario,seed,learning,diagnostics){
  const state=freshState();state.agents=['aster','mira'].map(id=>createNpc({id,seed,learning}));state.npc=state.agents[0];state.environment=createEnvironment(seed);
  const env=state.environment;
  if(scenario.hour!==undefined)env.settings.hourOverride=scenario.hour;
  if(scenario.weather)env.settings.weatherOverride=scenario.weather;
  if(scenario.nearRefuge){
    const cave=shelterSource('refuge');
    for(const [index,npc] of state.agents.entries()){
      const approaches=[[index?40:0,160],[-100,160],[100,160],[0,100]],position=approaches.map(([x,y])=>({x:cave.x+x,y:cave.y+y})).find(p=>canStand(p.x,p.y));
      if(!position)throw new Error('No physical refuge test approach');npc.position=position;recordEvent(npc,'debug',{provenance:'matched evaluation setup',setting:'starting position',value:position});
    }
  }
  if(scenario.depletedFood)for(const stock of env.foodStocks){stock.stock=0;stock.renewAt=100000;}
  const runtime=new PopulationRuntime(state);
  if(scenario.nearRefuge)for(const npc of state.agents){if(!npc.memory.exploration.origin||distance(npc.memory.exploration.origin,npc.position)>1)throw new Error('Fresh refuge fixture retained an unrelated exploration origin');}
  if(scenario.pendingQuestions)for(const npc of state.agents){const asked=runtime.social.action(npc,{type:'ask_human',text:'Do apples return after they are gone? I will continue caring for myself while you are away.',topic:'evaluation:apple-renewal',offline:true});if(!asked.ok)throw new Error(`Setup question failed: ${asked.code}`);}
  const metrics=new Map(state.agents.map(n=>[n.id,metric(n)])),messages=new Map(),snapshots=[];
  let messageCursor=0;
  for(let frame=0;frame<Math.round(scenario.seconds/dt);frame++){
    const before=state.agents.map(n=>({position:{...n.position},scene:n.scene}));
    state.elapsed+=dt;runtime.tick(dt);
    for(const [index,npc]of state.agents.entries()){
      const m=metrics.get(npc.id);if(before[index].scene===npc.scene)m.travel+=distance(before[index].position,npc.position);
      if(npc.scene!=='valley')m.shelteredSeconds+=dt;
      if(npc.bodyMode==='resting')m.restSeconds+=dt;
      if(npc.bodyMode==='sleeping')m.sleepSeconds+=dt;
      if(npc.active?.request.type==='move')m.movingSeconds+=dt;
      m.minimumHydration=Math.min(m.minimumHydration,npc.hydration);m.minimumNourishment=Math.min(m.minimumNourishment,npc.nourishment);m.minimumHealth=Math.min(m.minimumHealth,npc.health);
      m.minimumEnergy=Math.min(m.minimumEnergy,npc.energy);m.minimumStamina=Math.min(m.minimumStamina,npc.stamina);m.maximumFatigue=Math.max(m.maximumFatigue,npc.fatigue);m.maximumSleepPressure=Math.max(m.maximumSleepPressure,npc.sleepPressure);m.maximumStrain=Math.max(m.maximumStrain,npc.thermal.hot,npc.thermal.cold);
      collectEvents(npc,m);collectPlans(npc,m);
    }
    if(state.community.nextId!==messageCursor){for(const message of state.community.messages)messages.set(message.id,{...message});messageCursor=state.community.nextId;}
    if(diagnostics&&(frame+1)%Math.round(60/dt)===0)snapshots.push({seconds:Math.round(state.elapsed),agents:state.agents.map(n=>({id:n.id,scene:n.scene,position:{...n.position},hydration:n.hydration,nourishment:n.nourishment,health:n.health,energy:n.energy,stamina:n.stamina,knownFood:Object.keys(n.memory.foods).length,plan:n.cognition?.plan?structuredClone(n.cognition.plan):null,decision:n.decision}))});
  }
  runtime.dispose();
  const seenMessages=[...messages.values()];
  const agents=state.agents.map(npc=>{
    const {lastEventId,seenPlans,...m}=metrics.get(npc.id),beliefs=npc.cognition?.beliefs||[],own=seenMessages.filter(message=>message.senderId===npc.id);
    return {id:npc.id,...m,travel:Math.round(m.travel),stats:{...npc.stats},riskCost:npc.riskCost,final:{elapsed:npc.elapsed,scene:npc.scene,position:{...npc.position},lifecycle:npc.lifecycle,hydration:npc.hydration,nourishment:npc.nourishment,health:npc.health,energy:npc.energy,stamina:npc.stamina,fatigue:npc.fatigue,sleepPressure:npc.sleepPressure,inventory:npc.inventory.apples.length,water:npc.flask.water,decision:npc.decision,plan:npc.cognition?.plan?{id:npc.cognition.plan.id,status:npc.cognition.plan.status,goal:npc.cognition.plan.goal,outcome:npc.cognition.plan.outcome}:null},discovered:{water:Object.keys(npc.memory.sources).length,food:Object.keys(npc.memory.foods).length,shelters:Object.keys(npc.memory.shelters).length,cells:Object.keys(npc.memory.cells).length},beliefs:{total:beliefs.length,observed:beliefs.filter(b=>b.source==='observed').length,reported:beliefs.filter(b=>b.source==='reported').length,verified:beliefs.filter(b=>b.status==='verified'||b.status==='corroborated').length,contradicted:beliefs.filter(b=>b.status==='contradicted').length,knowledgeGained:npc.cognition?.knowledgeGained||0},communication:{peerMessages:own.filter(m=>m.channel==='peer').length,journalMessages:own.filter(m=>m.channel==='journal').length,questions:own.filter(m=>m.kind==='question').length,replies:own.filter(m=>m.kind==='answer').length,notes:state.community.notes.filter(n=>n.authorId===npc.id).length,pendingQuestion:state.community.questions[npc.id]?.status==='pending'},skills:npc.memory.skills.map(s=>({id:s.id,status:s.status,recognition:s.recognition,successes:s.successes,failures:s.failures})),remainingEvidence:npc.memory.experience.length};
  });
  return {scenarioId:scenario.id,seed,learning,seconds:scenario.seconds,worldElapsed:state.elapsed,environmentElapsed:env.elapsed,sharedClockAligned:Math.abs(state.elapsed-env.elapsed)<1e-7&&state.agents.every(n=>Math.abs(n.elapsed-env.elapsed)<1e-7),agents,communication:{messages:seenMessages.length,peer:seenMessages.filter(m=>m.channel==='peer').length,journal:seenMessages.filter(m=>m.channel==='journal').length,questions:seenMessages.filter(m=>m.kind==='question').length,humanMessages:seenMessages.filter(m=>m.senderId==='human').length,replies:seenMessages.filter(m=>m.kind==='answer').length,notes:state.community.notes.length},foodStocks:env.foodStocks.map(s=>({...s})),...(diagnostics?{diagnosticData:{agents:state.agents,community:state.community,snapshots}}:{})};
}

function summary(trials){
  const agents=trials.flatMap(trial=>trial.agents),means={characters:agents.length,trials:trials.length,allClocksAligned:trials.every(t=>t.sharedClockAligned)};
  for(const name of ['independentDrinks','independentMeals','warningSeconds','criticalSeconds','injuries','collapses','rescues','invalidActions','repeatedInvalid','skillUses'])means[name]=agents.reduce((sum,n)=>sum+n.stats[name],0)/agents.length;
  for(const name of ['riskCost','travel','shelteredSeconds','restSeconds','sleepSeconds'])means[name]=agents.reduce((sum,n)=>sum+n[name],0)/agents.length;
  means.plansCompleted=agents.reduce((sum,n)=>sum+n.plans.completed,0);means.plansVerified=agents.reduce((sum,n)=>sum+n.plans.goalVerified,0);means.plansInterrupted=agents.reduce((sum,n)=>sum+n.plans.interrupted,0);
  for(const name of ['peer','journal','questions','humanMessages','replies','notes'])means[name]=trials.reduce((sum,t)=>sum+t.communication[name],0);
  return means;
}

if(!isMainThread){
  const {scenario,seed,learning,diagnostics}=workerData;parentPort.postMessage(run(scenario,seed,learning,diagnostics));
}else{
  const selected=options(),jobs=selected.scenarios.flatMap(scenario=>selected.seeds.flatMap(seed=>selected.learning.map(learning=>({scenario,seed,learning,diagnostics:Boolean(selected.diagnostics)})))),completed=[];let nextJob=0;
  if(selected.diagnostics)await mkdir(selected.diagnostics,{recursive:true});
  async function workerLoop(){
    while(nextJob<jobs.length){
      const job=jobs[nextJob++],began=Date.now();
      const trial=await new Promise((resolve,reject)=>{const worker=new Worker(new URL(import.meta.url),{workerData:job});worker.once('message',resolve);worker.once('error',reject);worker.once('exit',code=>{if(code!==0)reject(new Error(`Evaluation worker exited ${code}`));});});
      if(trial.diagnosticData){const file=resolve(selected.diagnostics,`${trial.scenarioId}-${trial.seed}-${trial.learning?'learned':'control'}.json`);await writeFile(file,JSON.stringify(trial,null,2)+'\n');delete trial.diagnosticData;}
      completed.push(trial);
      console.log(`${completed.length}/${jobs.length} ${job.scenario.id} seed ${job.seed} learning ${job.learning?'on':'off'} (${Math.round((Date.now()-began)/1000)}s): ${trial.agents.map(n=>`${n.id} meals ${n.stats.independentMeals}, drinks ${n.stats.independentDrinks}, collapses ${n.stats.collapses}, critical ${Math.round(n.stats.criticalSeconds)}s, verified plans ${n.plans.goalVerified}`).join('; ')}.`);
    }
  }
  await Promise.all(Array.from({length:Math.min(selected.workers,jobs.length)},()=>workerLoop()));
  const scenarios=selected.scenarios.map(scenario=>{const trials=selected.seeds.map(seed=>({seed,...Object.fromEntries(selected.learning.map(learning=>[learning?'withLearning':'withoutLearning',completed.find(t=>t.scenarioId===scenario.id&&t.seed===seed&&t.learning===learning)]))}));return {...scenario,summary:Object.fromEntries(selected.learning.map(learning=>[learning?'withLearning':'withoutLearning',summary(completed.filter(t=>t.scenarioId===scenario.id&&t.learning===learning))])),trials};});
  const output={version:CONFIG.version,worldSeed:CONFIG.seed,characters:['aster','mira'],controller:'Offline experiential controller, concurrent supplied drives, bounded persistent plans, grounded beliefs, and local conversation rules',liveInferenceTested:false,modelConfiguration:null,timestep:dt,seeds:selected.seeds,learningModes:selected.learning,workerConcurrency:selected.workers,pairedTrialsPerScenario:selected.learning.length===2?selected.seeds.length:0,trialCount:jobs.length,summaryDefinition:'Survival, risk, travel and duration summaries are per-character means. Plan and communication summaries are totals over the selected trials.',normalRules:NPC_PRESETS.normal,bodyRules:NPC_RULES,energyRules:BODY_RULES,environmentRules:ENV_RULES,socialRules:SOCIAL_RULES,sensorArchitecture:'Engine reserves and fatigue are quantitative. Both offline decisions and model observations receive categorical bodily signals. Peer observations contain only visible appearance and remembered dialogue. Exact metrics below are developer measurements.',priors:'Physiology, action affordances, categorical sensory vocabulary, motivation names, bounded recognition templates, navigation, exploration/preparation strategies, and offline dialogue rules are programmed priors. Beliefs and useful outcomes accumulate from actual observations; this does not train LLM weights.',independentSuccessDefinition:'Ordinary collected water/food consumption giving at least 15 useful reserve points; water credited at most once per fill and apple at most once per collected item.',control:'Same two bodies, current local observations, qualitative drives, planning, social protocol and resources; learning=false disables retained low-level terrain/resource/action values/temporal learning/procedures. Cognitive and conversation data are still present; this is not a memory-free agent or a full ablation of the v0.5 architecture.',scenarios,limitations:['Two matched seeds per scenario are functional probes, not statistical evidence of general reliability.','Fixed world geometry; character RNG and weather seeds vary.','Near-refuge hot/night fixtures do not establish discovery of a distant cave before distress.','Unanswered-journal fixtures inject initial questions to test nonblocking behavior; other conversation is produced by the offline controller. No human responses are injected.','Food-depleted trials intentionally lack food; eventual harm is expected.','900-second ordinary trials cross one resource renewal; they do not establish indefinite survival or a complete one-hour day.','No live Ollama inference, neural-brain simulation, LLM weight learning, arbitrary skill invention, or civilization emergence is established by these probes.','Conversation in these trials is supplied offline dialogue; configured Ollama can produce language and plans but must be tested separately.','The learning-disabled control retains higher-level cognitive/social machinery, so comparisons cannot attribute differences to every individual new subsystem.']};
  await mkdir(dirname(selected.output),{recursive:true});await writeFile(selected.output,JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify(scenarios.map(s=>({scenario:s.id,summary:s.summary})),null,2));
}
