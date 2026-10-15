import test from 'node:test';
import assert from 'node:assert/strict';
import { freshState } from '../src/world.js';
import { CardinalRuntime,createCardinal,validateCardinal,cardinalDiagnostics } from '../src/cardinal.js';
import { getWorldRules,applyWorldRules } from '../src/world-rules.js';
import { ecologyEnergy } from '../src/ecology.js';
import { measureCardinalWorld,compareCardinalMetrics } from '../src/cardinal-metrics.js';

const clone=value=>JSON.parse(JSON.stringify(value));
function state(){const s=freshState();s.cardinal=createCardinal();return s;}
function advanceTime(s,seconds){s.elapsed+=seconds;s.environment.elapsed+=seconds;}
function evidence(s,proposal,{gain=.03,passed=true,recommendation='adopt',holdout=true}={}){
  const before=measureCardinalWorld(s),after=clone(before);after.at+=900;after.humans.spentKcal+=100;after.humans.absorbedKcal+=100;
  const interval=compareCardinalMetrics(before,after),rules=clone(s.environment.worldRules);
  return{version:1,status:'completed',proposal:clone(proposal),recommendation,pairs:[11,22,...(holdout?[33]:[])].map((seed,i)=>({seed,role:i===2?'holdout':'training',gain,passed,reasons:passed?[]:['human_health_regression'],control:clone(interval),candidate:clone(interval),checkpointFingerprint:'abcdef01',controlUtility:{score:.5,components:{nutrition:.5},weights:{nutrition:.25}},candidateUtility:{score:.53,components:{nutrition:.6},weights:{nutrition:.25}},rulesBefore:rules,rulesAfter:rules})),provenance:{paired:true,cardinalDisabled:true,controlFrozen:true,snapshotFingerprint:'01234567',snapshotHashAlgorithm:'fnv1a32',physiologyFingerprint:'abcdef12',sourceVersion:'0.7.0',rulesBefore:rules,seeds:[11,22,33],horizonSeconds:900,shadowStep:.25,requiredSteps:21600,maxTotalSteps:250000,steps:21600,checkpointAt:s.elapsed,completedAt:s.elapsed+900}};
}
function queued(s,options={}){
  let runner;
  const runtime=new CardinalRuntime(s,{experimentFactory:({proposal})=>runner={done:false,result:evidence(s,proposal,options),work(budget){this.budget=budget;this.done=true;return{steps:24};},cancel(){this.cancelled=true;},serialize(){return{provenance:{requiredSteps:21600}};}}});
  const request=runtime.requestExperiment({parameter:'plantGrowthMultiplier',value:1.25},{reason:'Unit test of the evidence gate.'});assert.equal(request.ok,true);runtime.tick(.25);return{runtime,getRunner:()=>runner,proposal:request.proposal};
}

test('Cardinal defaults to discovery adaptation and legacy cannot enable it',()=>{
  const s=state(),runtime=new CardinalRuntime(s);assert.equal(s.cardinal.mode,'adaptive');
  const old=freshState({mode:'legacy'});delete old.cardinal;const legacy=new CardinalRuntime(old);assert.equal(old.cardinal.mode,'observe');assert.equal(legacy.setMode('adaptive').code,'CARDINAL_REQUIRES_DISCOVERY_WORLD');assert.equal(legacy.setMode('off').ok,true);runtime.dispose();legacy.dispose();
});
test('off and observe modes do not modify world rules or inhabitants',()=>{
  const s=state(),rules=clone(getWorldRules(s.environment)),agents=clone(s.agents),runtime=new CardinalRuntime(s);runtime.setMode('off');runtime.tick(30);assert.equal(s.cardinal.observations.length,0);runtime.setMode('observe');runtime.tick(.25);advanceTime(s,120);s.agents[0].physiology.totals.metabolizedKcal=100;runtime.tick(.25);
  assert.equal(s.cardinal.diagnoses.some(d=>d.code==='NUTRITION_DEFICIT'),true);assert.deepEqual(getWorldRules(s.environment),rules);agents[0].physiology.totals.metabolizedKcal=100;assert.deepEqual(s.agents,agents);assert.equal(s.cardinal.proposals.length,0);
});
test('an accounting defect suspends even queued world experiments',()=>{
  const s=state();s.environment.ecology.ledger.initialKcal+=100;let calls=0;const runtime=new CardinalRuntime(s,{experimentFactory:()=>{calls++;throw new Error('Must not run');}});assert.equal(runtime.requestExperiment({parameter:'plantGrowthMultiplier',value:1.25}).ok,true);runtime.tick(.25);assert.equal(calls,0);assert.equal(s.cardinal.pending,null);assert.equal(getWorldRules(s.environment).plantGrowthMultiplier,1);
});
test('incremental work uses an explicit time and step budget and validated proof changes only a world rule',()=>{
  const s=state(),agents=clone(s.agents),ecology=clone(s.environment.ecology),{runtime,getRunner}=queued(s);assert.equal(s.cardinal.pending.progress,0);runtime.work(7);
  assert.deepEqual(getRunner().budget,{maxSteps:24,maxMilliseconds:7});assert.equal(getWorldRules(s.environment).plantGrowthMultiplier,1.25);assert.deepEqual(s.agents,agents);assert.deepEqual(s.environment.ecology,ecology);assert.equal(s.cardinal.interventions.length,1);assert.equal(s.cardinal.learning[0].accepted,1);assert.equal(s.cardinal.monitor.interventionId,s.cardinal.interventions[0].id);
});
test('missing holdout, unsafe evidence, and negative gains cannot change live rules',()=>{
  for(const options of [{holdout:false},{passed:false},{gain:-.01}]){
    const s=state(),{runtime}=queued(s,options);runtime.work();assert.equal(getWorldRules(s.environment).plantGrowthMultiplier,1);assert.equal(s.cardinal.interventions.length,0);assert.equal(s.cardinal.experiments.at(-1).recommendation,'reject');
  }
});
test('completed unsafe comparisons teach rejection while unfinished evidence teaches nothing',()=>{
  const s=state(),{runtime}=queued(s,{passed:false});runtime.work();assert.equal(s.cardinal.learning[0].trials,1);assert.equal(s.cardinal.learning[0].rejected,1);assert.equal(s.cardinal.learning[0].accepted,0);assert.ok(s.cardinal.learning[0].meanGain<0);assert.equal(getWorldRules(s.environment).plantGrowthMultiplier,1);
});
test('mismatched proposal or unfinished evidence cannot authorize a change',()=>{
  for(const mutate of [result=>result.proposal.parameter='fruitYieldMultiplier',result=>result.status='cancelled',result=>result.provenance.cardinalDisabled=false]){
    const s=state(),{runtime,getRunner}=queued(s);mutate(getRunner().result);runtime.work();assert.equal(getWorldRules(s.environment).plantGrowthMultiplier,1);assert.equal(s.cardinal.learning.length,0);
  }
});
test('a nutrition hypothesis cannot adopt for unused biomass alone',()=>{
  const s=state(),{runtime,getRunner,proposal}=queued(s);proposal.context='nutrition_gap';getRunner().result.proposal.context='nutrition_gap';runtime.work();assert.equal(getWorldRules(s.environment).plantGrowthMultiplier,1);assert.match(s.cardinal.experiments.at(-1).reason,/measured problem/);assert.equal(s.cardinal.learning[0].meanGain,0);
});
test('one animal route defect does not disable an unrelated climate experiment',()=>{
  const s=state(),runtime=new CardinalRuntime(s,{config:{observationSeconds:1,minHistorySeconds:2}});s.agents.forEach(a=>{a.thermal.hot=40;});const animal=s.environment.ecology.animals[0];animal.activity='moving';animal.targetPosition={x:20000,y:20000};runtime.observe();for(let i=0;i<3;i++){advanceTime(s,1);runtime.observe();}assert.equal(runtime.currentStalls.animals,1);assert.equal(runtime.context(),'thermal_exposure');assert.equal(runtime.propose().parameter,'temperatureOffsetC');
});
test('a changed live baseline rejects a successful experiment without recording an adopted intervention',()=>{
  const s=state(),{runtime}=queued(s);applyWorldRules(s.environment,{plantGrowthMultiplier:1.5});runtime.work();assert.equal(getWorldRules(s.environment).plantGrowthMultiplier,1.5);assert.equal(s.cardinal.proposals[0].status,'stale');assert.equal(s.cardinal.learning[0].accepted,0);assert.equal(s.cardinal.interventions.length,0);
});
test('applied rules can roll back while body, inventory, and evidence remain unchanged',()=>{
  const s=state(),{runtime}=queued(s);runtime.work();const agents=clone(s.agents);assert.equal(runtime.rollbackLast().ok,true);assert.equal(getWorldRules(s.environment).plantGrowthMultiplier,1);assert.deepEqual(s.agents,agents);assert.equal(s.cardinal.interventions[0].status,'rolled_back');assert.equal(runtime.rollbackLast().code,'NO_INTERVENTION_TO_ROLL_BACK');
});
test('live regression rolls a rule back, but observation mode never changes rules',()=>{
  const s=state(),{runtime}=queued(s);runtime.work();s.agents[0].physiology.health=70;advanceTime(s,30);runtime.tick(.25);assert.equal(getWorldRules(s.environment).plantGrowthMultiplier,1);assert.ok(s.cardinal.diagnoses.some(d=>d.code==='AUTOMATIC_ROLLBACK'));assert.equal(s.cardinal.learning[0].trials,s.cardinal.learning[0].accepted+s.cardinal.learning[0].rejected);assert.equal(s.cardinal.learning[0].accepted,0);assert.ok(s.cardinal.learning[0].meanGain<0);
  const s2=state(),q=queued(s2);q.runtime.work();q.runtime.setMode('observe');s2.agents[0].physiology.health=70;advanceTime(s2,30);q.runtime.tick(.25);assert.equal(getWorldRules(s2.environment).plantGrowthMultiplier,1.25);
});
test('repeated stationary movement is diagnosed before resource changes are proposed',()=>{
  const s=state(),runtime=new CardinalRuntime(s,{config:{observationSeconds:1,minHistorySeconds:2,experimentIntervalSeconds:1}});s.agents[0].active={request:{type:'move',target:{x:10000,y:10000}}};
  for(let i=0;i<4;i++){runtime.tick(.25);advanceTime(s,1);}assert.equal(runtime.context(),'blocked_motion');assert.ok(s.cardinal.diagnoses.some(d=>d.code==='BLOCKED_MOTION'));assert.equal(s.cardinal.proposals.length,0);
});
test('hypothesis utility selects another candidate after unsuccessful evidence',()=>{
  const s=state(),runtime=new CardinalRuntime(s,{config:{observationSeconds:1,minHistorySeconds:2}});runtime.observe();advanceTime(s,2);s.agents[0].physiology.totals.metabolizedKcal=100;runtime.observe();const first=runtime.propose();assert.equal(first.context,'nutrition_gap');runtime.learn(first,0,false);first.status='rejected';const next=runtime.propose();assert.notEqual(next.parameter,first.parameter);assert.equal(s.cardinal.learning[0].trials,1);
});
test('exhausted nutrition hypotheses fall back to another observed problem',()=>{
  const s=state(),runtime=new CardinalRuntime(s,{config:{observationSeconds:1,minHistorySeconds:2}});s.agents[0].thermal.hot=40;runtime.observe();advanceTime(s,2);s.agents[0].physiology.totals.metabolizedKcal=100;runtime.observe();
  for(const parameter of ['fruitYieldMultiplier','plantGrowthMultiplier'])s.cardinal.learning.push({context:'nutrition_gap',parameter,direction:1,trials:3,accepted:0,rejected:3,meanGain:0,m2:0,lastAt:s.elapsed});
  assert.equal(runtime.context(),'nutrition_gap');const proposal=runtime.propose();assert.equal(proposal.context,'thermal_exposure');assert.equal(proposal.parameter,'temperatureOffsetC');
});
test('retired hypotheses can be tested again after the world has had time to change',()=>{
  const s=state(),runtime=new CardinalRuntime(s,{config:{observationSeconds:1,minHistorySeconds:2,hypothesisRetrySeconds:4}});runtime.observe();advanceTime(s,2);s.agents[0].physiology.totals.metabolizedKcal=100;runtime.observe();
  for(const parameter of ['fruitYieldMultiplier','plantGrowthMultiplier'])s.cardinal.learning.push({context:'nutrition_gap',parameter,direction:1,trials:3,accepted:0,rejected:3,meanGain:0,m2:0,lastAt:s.elapsed});assert.equal(runtime.propose(),null);
  for(let i=0;i<2;i++){advanceTime(s,2);s.agents[0].physiology.totals.metabolizedKcal+=100;runtime.observe();}assert.equal(runtime.propose().context,'nutrition_gap');assert.equal(s.cardinal.interventions.length,0);
});
test('observed dry soil permits an autonomous rainfall hypothesis',()=>{
  const s=state(),runtime=new CardinalRuntime(s,{config:{observationSeconds:1,minHistorySeconds:2}});s.environment.ecology.plants.forEach(p=>{p.moisture=.1;});runtime.observe();advanceTime(s,2);runtime.observe();const proposal=runtime.propose();assert.equal(proposal.context,'dry_soil');assert.equal(proposal.parameter,'rainfallMultiplier');assert.equal(proposal.to,1.25);
});
test('thermal wind proposals cool hot exposure and reduce wind during cold exposure',()=>{
  for(const hot of [true,false]){
    const s=state(),runtime=new CardinalRuntime(s,{config:{observationSeconds:1,minHistorySeconds:2}});s.agents[0].thermal[hot?'hot':'cold']=40;applyWorldRules(s.environment,{temperatureOffsetC:hot?-6:6});runtime.observe();advanceTime(s,2);runtime.observe();const proposal=runtime.propose();assert.equal(proposal.context,'thermal_exposure');assert.equal(proposal.parameter,'windMultiplier');assert.equal(proposal.to,hot?1.2:.8);
  }
});
test('new births amid depleted forage permit a lower reproduction hypothesis without deleting animals',()=>{
  const s=state(),runtime=new CardinalRuntime(s,{config:{observationSeconds:1,minHistorySeconds:2}});s.environment.ecology.plants.filter(p=>p.kind==='grass').forEach(p=>{p.biomassGrams=p.capacity*.2;});s.environment.ecology.ledger.initialKcal=ecologyEnergy(s.environment.ecology);const animals=clone(s.environment.ecology.animals);runtime.observe();advanceTime(s,2);s.environment.ecology.births++;runtime.observe();const proposal=runtime.propose();assert.equal(proposal.context,'producer_depletion');assert.equal(proposal.parameter,'animalReproductionMultiplier');assert.equal(proposal.to,.8);assert.deepEqual(s.environment.ecology.animals,animals);assert.equal(s.cardinal.interventions.length,0);
});
test('completed evidence survives allowlisted save validation and running work is interrupted on restoration',()=>{
  const s=state(),{runtime}=queued(s);runtime.work();const restored=validateCardinal(clone(s.cardinal),{restoring:true});assert.deepEqual(restored,s.cardinal);const e=restored.experiments[0];assert.equal(e.provenance.sourceVersion,'0.7.0');assert.equal(e.provenance.snapshotFingerprint,'01234567');assert.equal(e.pairs[0].control.after.humans.waterDebtFraction,cardinalDiagnostics(s).humans.waterDebtFraction);
  const pending=state(),q=queued(pending);assert.ok(pending.cardinal.pending);const loaded=validateCardinal(clone(pending.cardinal),{restoring:true});assert.equal(loaded.pending,null);assert.equal(loaded.proposals[0].status,'interrupted');q.runtime.dispose();
});
test('state validation strips executable, unknown and unbounded data',()=>{
  const c=createCardinal(),raw={...c,status:'x'.repeat(1000),execute:'danger',learning:[{parameter:'health',meanGain:999}],observations:Array.from({length:100},()=>({at:10,humans:{healthMean:100,unknown:1},animals:{species:{rabbit:1,dragon:400}},resources:{},ecology:{ledger:{}}}))};
  const restored=validateCardinal(raw);assert.equal(restored.execute,undefined);assert.equal(restored.status.length,80);assert.equal(restored.learning.length,0);assert.equal(restored.observations.length,48);assert.equal(restored.observations[0].animals.species.dragon,undefined);assert.equal(restored.observations[0].humans.unknown,undefined);const counters=validateCardinal({...c,learning:[{parameter:'plantGrowthMultiplier',trials:2,accepted:10,rejected:500,meanGain:1,m2:0}]}).learning[0];assert.equal(counters.accepted,2);assert.equal(counters.rejected,0);
});
