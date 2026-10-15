/** Actual offline Cardinal/engine probes. No food advice, model or fabricated result. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {CONFIG} from '../src/config.js';
import {freshState,canStand} from '../src/world.js';
import {createEnvironment} from '../src/environment.js';
import {createNpc} from '../src/npc-state.js';
import {PopulationRuntime} from '../src/population.js';
import {CardinalRuntime,createCardinal} from '../src/cardinal.js';
import {CARDINAL_RULES} from '../src/cardinal-config.js';
import {createCardinalExperiment} from '../src/cardinal-experiments.js';
import {measureCardinalWorld,compareCardinalMetrics} from '../src/cardinal-metrics.js';
import {ecologyCoverage,ecologyEnergy} from '../src/ecology.js';
import {getWorldRules,applyWorldRules,WORLD_RULE_LIMITS} from '../src/world-rules.js';
import {decisionObservation} from '../src/controller.js';
import {validateSave} from '../src/save.js';

const MODULES=['config','build-info','world','world-rules','environment','population','biology-config','biology','ecology-config','ecology','npc-state','npc','controller','discovery-config','discovery-state','discovery','discovery-actions','npc-memory','perception','navigation','cognition','social','interoception','save','cardinal-config','cardinal-state','cardinal','cardinal-experiments','cardinal-metrics'];
const ADAPTIVE_CONFIG=Object.freeze({observationSeconds:2,minHistorySeconds:6,experimentIntervalSeconds:12,experimentHorizonSeconds:30,monitoringSeconds:15,shadowBudget:8});
const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const invariantState=state=>hash({agents:state.agents,community:state.community,ecology:state.environment.ecology,elapsed:state.elapsed});
const round=value=>Math.round(value*1000)/1000;
async function fingerprint(){const modules={};for(const name of MODULES)modules[name+'.js']=hash(await readFile(new URL('../src/'+name+'.js',import.meta.url),'utf8'));return{sha256:hash(modules),modules};}
function options(){
  const selected={seeds:[74193,3],adaptiveSeconds:120,performanceSeconds:20,output:fileURLToPath(new URL('../docs/cardinal-evaluation-v07.json',import.meta.url))};
  for(let i=2;i<process.argv.length;i+=2){const flag=process.argv[i],value=process.argv[i+1];if(value===undefined)throw new Error(`Missing value for ${flag}`);
    if(flag==='--output')selected.output=resolve(value);
    else if(flag==='--seeds'){selected.seeds=value.split(',').map(Number);assert(selected.seeds.length&&selected.seeds.every(n=>Number.isInteger(n)&&n>=0&&n<=0xffffffff),'Seeds must be uint32.');selected.seeds=[...new Set(selected.seeds)];}
    else if(flag==='--adaptive-seconds'){selected.adaptiveSeconds=Number(value);assert(selected.adaptiveSeconds>=30&&selected.adaptiveSeconds<=900);}
    else if(flag==='--performance-seconds'){selected.performanceSeconds=Number(value);assert(selected.performanceSeconds>=1&&selected.performanceSeconds<=120);}
    else throw new Error(`Unknown option ${flag}`);
  }return selected;
}
function seededState(seed){const state=freshState();state.environment=createEnvironment(seed,{mode:'discovery'});state.agents=['aster','mira'].map(id=>createNpc({id,seed,mode:'discovery'}));state.npc=state.agents[0];state.cardinal=createCardinal();return state;}
const runtimeFactory=(state,options)=>new PopulationRuntime(state,{...options,cardinal:false});
function factory({state,proposal,seeds,horizonSeconds}){return createCardinalExperiment(state,proposal,{runtimeFactory,seeds,horizonSeconds,shadowStep:.25,sourceFingerprint:source.sha256});}
function completePending(manager){let chunks=0;while(manager.cardinal.pending&&chunks++<100000)manager.work(8);assert(!manager.cardinal.pending,'Bounded experiment must finish.');return chunks;}
function noOracle(state){
  const observations=state.agents.map(actor=>decisionObservation(actor));
  for(const observation of observations){const data=JSON.stringify(observation);assert(!/"(?:cardinal|worldRules|physiology|energyKcal|plantGrowthMultiplier|species|materialType)"/.test(data),'Private supervisor/engine fields leaked into inhabitant observation.');}
  return true;
}
function performanceProbe(seed,seconds){
  const state=seededState(seed),coverage=ecologyCoverage(state.environment.ecology),before=measureCardinalWorld(state);
  assert(Object.values(coverage.quadrants).every(value=>value>0),'Every quadrant needs live ecological objects.');
  assert(coverage.bounds.minX<-17000&&coverage.bounds.maxX>17000&&coverage.bounds.minY<-17000&&coverage.bounds.maxY>17000,'Habitats must reach all four distant map edges.');
  assert(state.environment.ecology.plants.every(item=>canStand(item.position.x,item.position.y,item.scene)),'Plant placements must be traversable.');
  const runtime=runtimeFactory(state),frames=Math.round(seconds/CONFIG.fixedStep),samples=[];let peakStepMs=0;const began=performance.now();
  for(let frame=0;frame<frames;frame++){const start=performance.now();state.elapsed+=CONFIG.fixedStep;runtime.tick(CONFIG.fixedStep);const ms=performance.now()-start;peakStepMs=Math.max(peakStepMs,ms);samples.push(ms);}
  const wallMs=performance.now()-began,after=measureCardinalWorld(state);runtime.dispose();samples.sort((a,b)=>a-b);
  assert(Math.abs(after.ecology.balanceErrorKcal)<.01,'Distributed-world ecology must remain accounted.');
  assert(Math.abs(state.elapsed-state.environment.elapsed)<1e-6&&state.agents.every(n=>Math.abs(n.elapsed-state.elapsed)<1e-6),'All live clocks must align.');noOracle(state);
  return{seed,coverage,simulatedSeconds:state.elapsed,timestep:CONFIG.fixedStep,frames,wallMs:round(wallMs),meanStepMs:round(wallMs/frames),p95StepMs:round(samples[Math.floor(samples.length*.95)]),peakStepMs:round(peakStepMs),simulationToWallRatio:round(state.elapsed/(wallMs/1000)),interval:compareCardinalMetrics(before,after),privateObservationsExcluded:true,renderingMeasured:false};
}
function producerFixture(seed,{count=1,biomass=1200,moisture=.9}={}){
  const state=seededState(seed),ecology=state.environment.ecology;
  // Explicit isolated ecology fixture. This is not a fresh-world population or
  // evidence of human learning. Preserve one actual grass node and its physics.
  const grasses=ecology.plants.filter(plant=>plant.kind==='grass').slice(0,count);assert.equal(grasses.length,count);
  ecology.plants=grasses;ecology.animals=[];ecology.materials=[];ecology.detritus={massGrams:0,nutrients:10000,energyKcal:0};
  for(const grass of grasses){grass.biomassGrams=biomass;grass.moisture=moisture;grass.capacity=2500;}
  for(const key of Object.keys(ecology.ledger))ecology.ledger[key]=0;
  ecology.ledger.initialKcal=ecologyEnergy(ecology);state.agents=[];state.npc=null;
  state.environment.settings.hourOverride=14;state.environment.settings.weatherOverride='rainy';
  return state;
}
function causalActuatorProbe(seed,value){
  const state=producerFixture(seed),manager=new CardinalRuntime(state,{experimentFactory:factory,config:{experimentHorizonSeconds:900}}),before=invariantState(state),rulesBefore=getWorldRules(state.environment);
  const requested=manager.requestExperiment({parameter:'plantGrowthMultiplier',value},{reason:'Explicit isolated producer fixture: measure real growth, accounting and held-out utility; not human development.'});assert(requested.ok);
  manager.tick(.25);const chunks=completePending(manager),experiment=manager.cardinal.experiments.at(-1);assert(experiment?.pairs?.length===3);
  assert.equal(invariantState(state),before,'Experiments/interventions cannot mutate live bodies, memories, inventory or resources.');
  assert(experiment.pairs.every(pair=>Math.abs(pair.candidate.ecology.balanceErrorKcal)<.01&&pair.candidate.ecology.externalKcal===pair.control.ecology.externalKcal),'Growth must be accounted without outside energy.');
  const adopted=experiment.recommendation==='adopt';assert.equal(adopted,value>1,'Productive and destructive candidate fixtures must receive different measured decisions.');
  assert.equal(getWorldRules(state.environment).plantGrowthMultiplier,adopted?value:1,'Only an adopted candidate changes the actual world rule.');
  const learning=structuredClone(state.cardinal.learning),interventions=structuredClone(state.cardinal.interventions),result={seed,fixture:'One actual grass node, 1200/2500g, moisture .9, rainy fixed 14:00; no humans or animals; freshly reconstructed finite ledger.',candidate:value,horizonSeconds:900,shadowStep:.25,rulesBefore,rulesAfter:getWorldRules(state.environment),chunks,experiment:structuredClone(experiment),learning,interventions,liveAgentAndResourceStateUnchanged:true};
  if(adopted){const rolled=manager.rollbackLast();assert(rolled.ok);assert.equal(getWorldRules(state.environment).plantGrowthMultiplier,1);result.rollback={ok:true,rulesAfter:getWorldRules(state.environment),interventionStatus:state.cardinal.interventions.at(-1).status};}
  manager.dispose();return result;
}
function automaticActuatorProbe(seed){
  const state=producerFixture(seed,{count:10,biomass:45,moisture:1}),scheduling={observationSeconds:1,minHistorySeconds:2,experimentIntervalSeconds:1,experimentHorizonSeconds:900,shadowBudget:8},runtime=runtimeFactory(state),manager=new CardinalRuntime(state,{experimentFactory:factory,config:scheduling});
  const initial=measureCardinalWorld(state),rulesBefore=getWorldRules(state.environment);
  for(let frame=0;frame<40&&!state.cardinal.pending;frame++){state.elapsed+=.25;runtime.tick(.25);manager.tick(.25);}
  assert(state.cardinal.pending,'Low measured biomass must generate its own proposal.');
  const proposal=state.cardinal.proposals.at(-1);assert.equal(proposal.origin,'automatic');assert.equal(proposal.parameter,'plantGrowthMultiplier');assert.equal(proposal.context,'producer_depletion');
  const beforeShadow=invariantState(state),chunks=completePending(manager);assert.equal(invariantState(state),beforeShadow,'Automatic shadow work cannot replace live resources, bodies or knowledge.');
  const experiment=state.cardinal.experiments.at(-1);assert.equal(experiment.recommendation,'adopt','Actual paired producer improvement must meet the normal default utility threshold.');
  assert.equal(manager.config.minimumGain,CARDINAL_RULES.minimumGain);assert.equal(getWorldRules(state.environment).plantGrowthMultiplier,1.25);assert.equal(state.cardinal.interventions.at(-1).status,'applied');assert.equal(state.cardinal.learning.at(-1).accepted,1);
  const result={seed,fixture:'Ten actual grass nodes at 45/2500g and moisture1, no humans/animals/materials; fixed rainy14:00,10000 nutrient units and a reconstructed finite initial ledger. This intentionally depleted checkpoint is a causal producer stress fixture, not a fresh valley or human-learning trial.',scheduling,defaultAcceptanceThreshold:CARDINAL_RULES.minimumGain,acceptanceThresholdOverridden:false,initial,checkpointAt:state.elapsed,rulesBefore,rulesAfter:getWorldRules(state.environment),chunks,proposal:structuredClone(proposal),experiment:structuredClone(experiment),learning:structuredClone(state.cardinal.learning),interventions:structuredClone(state.cardinal.interventions),ownerProposalSupplied:false,liveResourcesUnchangedByExperiment:true};
  runtime.dispose();manager.dispose();return result;
}
function proposalComparison(state){
  const choose=keepLearning=>{const copy=structuredClone(state);copy.cardinal.pending=null;if(!keepLearning)copy.cardinal.learning=[];const manager=new CardinalRuntime(copy,{config:ADAPTIVE_CONFIG}),proposal=manager.propose();manager.dispose();return proposal;};
  const withLearning=choose(true),withoutLearning=choose(false);
  return{at:state.elapsed,completedExperiments:state.cardinal.experiments.length,context:withLearning?.context??withoutLearning?.context??null,withLearnedEvidence:withLearning?.parameter??null,withoutLearnedEvidence:withoutLearning?.parameter??null,different:withLearning?.parameter!==withoutLearning?.parameter,definition:'Counterfactual proposal selection at identical live state, retaining versus removing only completed Cardinal utility records; no experiment outcome is fabricated.'};
}
function adaptiveProbe(seed,seconds){
  let state=seededState(seed),runtime=runtimeFactory(state),manager=new CardinalRuntime(state,{experimentFactory:factory,config:ADAPTIVE_CONFIG});
  const before=measureCardinalWorld(state);assert(state.agents.every(actor=>!actor.discovery.techniques.length&&!actor.inventory.items.length&&!Object.keys(actor.memory.foods).length));
  const step=.25,frames=Math.round(seconds/step),decisionComparisons=[];let auditedWorkChunks=0;
  const run=frames=>{for(let frame=0;frame<frames;frame++){state.elapsed+=step;runtime.tick(step);manager.tick(step);if(state.cardinal.pending){const before=frame%16===0?invariantState(state):null,completed=state.cardinal.experiments.length;manager.work(8);if(before){assert.equal(invariantState(state),before,'Shadow work cannot change the live inhabitants/resources.');auditedWorkChunks++;}if(state.cardinal.experiments.length>completed)decisionComparisons.push(proposalComparison(state));}}};
  run(frames);completePending(manager);
  const beforeRestart={learning:structuredClone(state.cardinal.learning),experiments:state.cardinal.experiments.length,proposals:state.cardinal.proposals.length,settings:getWorldRules(state.environment),at:state.elapsed};
  console.log(`Automatic seed ${seed}: ${beforeRestart.experiments} completed windows, ${beforeRestart.learning.reduce((total,item)=>total+item.trials,0)} learned outcomes; ${state.cardinal.experiments.map(item=>`${item.proposalId} ${item.recommendation}: ${item.reason}`).join(' | ')}`);
  assert(beforeRestart.experiments>=2,'Adaptation probe must finish at least two real multi-seed windows.');
  assert(beforeRestart.learning.reduce((total,item)=>total+item.trials,0)>=2,'Completed measured outcomes must update utility estimates.');
  const policyComparison=proposalComparison(state);decisionComparisons.push(policyComparison);
  runtime.dispose();manager.dispose();state=validateSave(JSON.parse(JSON.stringify(state)));assert.deepEqual(state.cardinal.learning,beforeRestart.learning,'Persisted adaptation must survive validated restoration.');assert.deepEqual(getWorldRules(state.environment),beforeRestart.settings);
  runtime=runtimeFactory(state);manager=new CardinalRuntime(state,{experimentFactory:factory,config:ADAPTIVE_CONFIG});run(Math.round(30/step));completePending(manager);noOracle(state);
  const after=measureCardinalWorld(state),result={seed,scheduling:ADAPTIVE_CONFIG,liveTimestep:step,shadowTimestep:.25,initialWindowSeconds:seconds,resumedWindowSeconds:30,normalScheduling:CARDINAL_RULES,beforeRestart,afterRestart:{learning:structuredClone(state.cardinal.learning),experiments:state.cardinal.experiments.length,proposals:state.cardinal.proposals.length,at:state.elapsed},policyComparison,decisionComparisons,interval:compareCardinalMetrics(before,after),diagnoses:structuredClone(state.cardinal.diagnoses),proposals:structuredClone(state.cardinal.proposals),experiments:structuredClone(state.cardinal.experiments),interventions:structuredClone(state.cardinal.interventions),auditedWorkChunks,privateObservationsExcluded:true,humanAnswersSupplied:false,foodKnowledgeSupplied:false,liveModelUsed:false};
  runtime.dispose();manager.dispose();return result;
}

const selected=options(),source=await fingerprint(),started=performance.now(),performanceTrials=[],causalTrials=[],adaptationTrials=[],automaticActuatorTrials=[];
for(const seed of selected.seeds){performanceTrials.push(performanceProbe(seed,selected.performanceSeconds));console.log(`Distributed-world fixed-step probe completed: seed ${seed}.`);}
for(const candidate of [2.5,.25]){causalTrials.push(causalActuatorProbe(selected.seeds[0],candidate));console.log(`Actual paired producer experiment completed: candidate ${candidate}.`);}
for(const seed of selected.seeds){automaticActuatorTrials.push(automaticActuatorProbe(seed));console.log(`Fully automatic measured producer adjustment adopted: seed ${seed}.`);}
for(const seed of selected.seeds){adaptationTrials.push(adaptiveProbe(seed,selected.adaptiveSeconds));console.log(`Automatic multiwindow adaptation and validated restart completed: seed ${seed}.`);}
const finalSource=await fingerprint(),sourceUniform=source.sha256===finalSource.sha256;
const result={version:CONFIG.version,generatedAt:new Date().toISOString(),wallSeconds:round((performance.now()-started)/1000),sourceFingerprint:source,sourceUniform,seeds:selected.seeds,normalCardinalRules:CARDINAL_RULES,worldRuleLimits:WORLD_RULE_LIMITS,performanceTrials,causalTrials,automaticActuatorTrials,adaptationTrials,
  summary:{distributedWorlds:performanceTrials.length,allQuadrantsPopulated:performanceTrials.every(trial=>Object.values(trial.coverage.quadrants).every(Boolean)),causalAdoptions:causalTrials.filter(trial=>trial.experiment.recommendation==='adopt').length,causalRejections:causalTrials.filter(trial=>trial.experiment.recommendation==='reject').length,fullyAutomaticStressInterventions:automaticActuatorTrials.length,fullWorldAutomaticExperiments:adaptationTrials.reduce((n,trial)=>n+trial.experiments.length,0),fullWorldAutomaticInterventions:adaptationTrials.reduce((n,trial)=>n+trial.interventions.filter(item=>item.status==='applied').length,0),trialsWithLearnedSelectionDifferences:adaptationTrials.filter(trial=>trial.decisionComparisons.some(comparison=>comparison.different)).length,persistedLearningVerified:true,privateObservationBoundaryVerified:true},
  limitations:['The isolated producer fixtures test real engine growth, candidate/control causality, automatic and owner-requested application, and rollback. They contain no humans/animals and cannot establish human learning or population balance.','Full-world automatic probes accelerate Cardinal observation/history/experiment scheduling and use 30-second (0.2-game-hour) candidate horizons. The isolated automatic producer fixture retains the normal900-second horizon and normal0.01 acceptance threshold, with accelerated initial observation scheduling only. Neither establishes reliable long-term biological optimization.','Automatic live and shadow probes use a documented0.25-second timestep. The distribution/performance probe uses the native1/60-second timestep, but does not measure rendering or native UI latency.','Held-out seeds change future choices/weather at the same saved geometry and checkpoint; they are not independently generated worlds.','Only two default starting seeds and short windows are functional evidence. Long-term self-sufficiency, ecological balance, optimal policies and civilization development are unestablished.','Cardinal utility, diagnostics, candidate rules and safeguards are supplied structure. Persisted utility estimates affect candidate selection; no model weights or general world model are learned.','The evaluator supplies no food technique, human answer or live model. Human physiology, knowledge and inventories are outside the world-rule actuator boundary.','Original v0.6 discovery/ecological runs remain historical evidence and are not silently relabeled as tests of this Cardinal release.']};
await mkdir(dirname(selected.output),{recursive:true});await writeFile(selected.output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result.summary,null,2));assert(sourceUniform,'Runtime source changed during evaluation; output is diagnostic only. Rerun after source freeze.');
