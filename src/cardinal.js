import { CONFIG } from './config.js';
import { CARDINAL_RULES as R, CARDINAL_ACTUATORS, CARDINAL_MODES } from './cardinal-config.js';
import { createCardinal,validateCardinal,cleanCardinalMetrics,cleanCardinalExperiment } from './cardinal-state.js';
import { measureCardinalWorld } from './cardinal-metrics.js';
import { getWorldRules,applyWorldRules } from './world-rules.js';
export { createCardinal,validateCardinal } from './cardinal-state.js';
export { CARDINAL_RULES,CARDINAL_ACTUATORS } from './cardinal-config.js';
const finite=(v,f=0)=>Number.isFinite(v)?v:f;
const bounded=(array,value,max)=>{array.push(value);if(array.length>max)array.splice(0,array.length-max);return value;};
const mean=values=>values.length?values.reduce((n,v)=>n+v,0)/values.length:0;
const elapsed=state=>Math.max(0,finite(state?.environment?.elapsed,finite(state?.elapsed)));
const shortText=(v,max=400)=>String(v||'').slice(0,max);
const equal=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<1e-9;
const identifier=(s,kind)=>`cardinal:${kind}:${s.nextId++}`;
function actualConfig(raw={}){
  const result={...R};
  for(const key of ['observationSeconds','minHistorySeconds','experimentIntervalSeconds','experimentHorizonSeconds','hypothesisRetrySeconds','monitoringSeconds'])if(Number.isFinite(raw[key])&&raw[key]>0)result[key]=Math.min(raw[key],1e7);
  if(Number.isFinite(raw.shadowBudget)&&raw.shadowBudget>0)result.shadowBudget=Math.min(256,Math.floor(raw.shadowBudget));
  if(Number.isFinite(raw.minimumGain)&&raw.minimumGain>=.00001&&raw.minimumGain<=.1)result.minimumGain=raw.minimumGain;
  return result;
}
/** Exact developer diagnostics are deliberately separate from NPC perception. */
export function cardinalDiagnostics(state){const metrics=measureCardinalWorld(state),plants=state?.environment?.ecology?.plants||[],grass=plants.filter(p=>p.kind==='grass');metrics.resources.meanMoisture=plants.length?plants.reduce((n,p)=>n+finite(p.moisture),0)/plants.length:0;metrics.resources.biomassCapacityGrams=grass.reduce((n,p)=>n+finite(p.capacity),0);metrics.resources.biomassFraction=metrics.resources.biomassCapacityGrams?metrics.resources.biomassGrams/metrics.resources.biomassCapacityGrams:0;return cleanCardinalMetrics(metrics);}

/** A bounded, evidence-driven world steward. It has no reference to an agent action API. */
export class CardinalRuntime {
  constructor(state,{experimentFactory,getRules=getWorldRules,applyRules=applyWorldRules,config={}}={}){
    this.state=state;this.experimentFactory=experimentFactory;this.getRules=getRules;this.applyRules=applyRules;
    this.config=actualConfig(config);this.runner=null;this.disposed=false;this.motion=new Map();
    state.cardinal??=createCardinal({mode:state.simulationMode==='discovery'?'adaptive':'observe'});
    this.cardinal=state.cardinal;
    if(this.cardinal.pending){
      const p=this.cardinal.proposals.find(v=>v.id===this.cardinal.pending.proposalId);if(p)p.status='interrupted';
      this.cardinal.pending=null;this.cardinal.status='observing';
      this.diagnose('EXPERIMENT_INTERRUPTED','info','An unfinished copied-world experiment was interrupted. No unfinished result was applied.');
    }
  }
  diagnose(code,severity,summary,evidence={}){
    const c=this.cardinal,at=elapsed(this.state),recent=c.diagnoses.findLast?.(d=>d.code===code);
    if(recent&&at-recent.at<this.config.observationSeconds*2)return recent;
    return bounded(c.diagnoses,{id:identifier(c,'diagnosis'),at,code,severity,summary:shortText(summary),evidence:Object.fromEntries(Object.entries(evidence).filter(([,v])=>Number.isFinite(v)).slice(0,12))},R.maxDiagnoses);
  }
  setMode(mode){
    if(mode==='auto')mode='adaptive';if(mode==='adaptive'&&this.state.simulationMode!=='discovery')return{ok:false,code:'CARDINAL_REQUIRES_DISCOVERY_WORLD'};if(!CARDINAL_MODES.includes(mode))return{ok:false,code:'INVALID_CARDINAL_MODE'};
    if(mode!=='adaptive')this.cancel('Mode changed; unfinished experiment discarded.');
    this.cardinal.mode=mode;this.cardinal.status=mode==='off'?'off':mode==='observe'?'observing':this.runner?'experimenting':'observing';
    return{ok:true,mode};
  }
  cancel(reason='Unfinished copied-world experiment discarded.'){
    this.runner?.cancel?.();this.runner=null;
    const c=this.cardinal;if(c.pending){const p=c.proposals.find(v=>v.id===c.pending.proposalId);if(p)p.status='interrupted';c.pending=null;this.diagnose('EXPERIMENT_INTERRUPTED','info',reason);}
    c.status=c.mode==='off'?'off':'observing';
  }
  dispose(){if(this.disposed)return;this.cancel('World runtime closed; unfinished copied-world experiment discarded.');this.disposed=true;}
  probeMotion(snapshot){
    let humanStalls=0,animalStalls=0;const at=snapshot.at,seen=new Set();
    for(const actor of [...(this.state.agents||[]),...(this.state.environment?.ecology?.animals||[])]){
      const key=actor.id;if(typeof key!=='string'||!actor.position)continue;seen.add(key);
      const previous=this.motion.get(key),moving=actor.species?['moving','chasing','fleeing'].includes(actor.activity):actor.active?.request?.type==='move';
      const target=actor.targetPosition||actor.active?.request?.target;
      const distant=!target||Math.hypot(target.x-actor.position.x,target.y-actor.position.y)>65;
      const unchanged=previous&&previous.scene===actor.scene&&Math.hypot(previous.x-actor.position.x,previous.y-actor.position.y)<5;
      const stalledSeconds=moving&&distant&&unchanged?previous.stalledSeconds+Math.max(0,at-previous.at):0;
      if(stalledSeconds>=this.config.minHistorySeconds){if(actor.species)animalStalls++;else humanStalls++;}
      this.motion.set(key,{x:actor.position.x,y:actor.position.y,scene:actor.scene,at,stalledSeconds});
    }
    for(const key of this.motion.keys())if(!seen.has(key))this.motion.delete(key);
    this.currentStalls={humans:humanStalls,animals:animalStalls};
    snapshot.humans.routeStalls=Math.max(snapshot.humans.routeStalls,humanStalls);
    snapshot.animals.routeStalls=Math.max(snapshot.animals.routeStalls,animalStalls);
  }
  observe(){
    const c=this.cardinal,snapshot=cardinalDiagnostics(this.state);this.probeMotion(snapshot);
    bounded(c.observations,snapshot,R.maxObservations);c.lastObservationAt=snapshot.at;
    if(Math.abs(snapshot.ecology.balanceErrorKcal)>.1)this.diagnose('ECOLOGY_ACCOUNTING','critical','Ecological energy accounting is inconsistent. World experiments are suspended until the engine is checked.',{errorKcal:snapshot.ecology.balanceErrorKcal});
    if(this.currentStalls.humans+this.currentStalls.animals>0)this.diagnose('BLOCKED_MOTION','warning','Repeated movement without displacement suggests a route or collision defect. Adding resources could conceal it.',{humans:this.currentStalls.humans,animals:this.currentStalls.animals});
    if(snapshot.resources.biomassCapacityGrams>0&&snapshot.resources.biomassFraction<.3)this.diagnose('PRODUCER_DEPLETION','warning','Available grass biomass is low relative to its physical capacity. Growth, rainfall and population pressure can be tested without adding free food.',{biomassFraction:snapshot.resources.biomassFraction});
    if(snapshot.resources.plantCount>0&&snapshot.resources.meanMoisture<.25)this.diagnose('DRY_SOIL','warning','Measured soil moisture is low; rainfall is a testable world hypothesis.',{meanMoisture:snapshot.resources.meanMoisture});
    if(snapshot.humans.thermalStrain>20)this.diagnose('THERMAL_EXPOSURE','warning','Humans are accumulating thermal strain. Climate and wind changes require copied-world evidence.',{thermalStrain:snapshot.humans.thermalStrain});
    const older=c.observations.find(v=>snapshot.at-v.at>=this.config.minHistorySeconds&&snapshot.at-v.at<this.config.minHistorySeconds+this.config.observationSeconds*2);
    if(older){
      const spent=snapshot.humans.spentKcal-older.humans.spentKcal,absorbed=snapshot.humans.absorbedKcal-older.humans.absorbedKcal,ratio=spent>0?absorbed/spent:1;
      if(spent>10&&ratio<.75)this.diagnose('NUTRITION_DEFICIT','warning','Observed independent intake is below expenditure. Experiments will distinguish production opportunities from an unlearned technique.',{nutritionRatio:ratio,spentKcal:spent,absorbedKcal:absorbed});
      if(snapshot.animals.count<older.animals.count)this.diagnose('ANIMAL_DECLINE','warning','Animal numbers declined; copied-world controls will test habitat access before changing reproduction.',{before:older.animals.count,after:snapshot.animals.count});
      if(snapshot.humans.rescues>older.humans.rescues||snapshot.humans.assistanceKcal>older.humans.assistanceKcal)this.diagnose('OUTSIDE_ASSISTANCE','warning','Survival included outside assistance. This is counted separately from independent sustainability.',{rescues:snapshot.humans.rescues-older.humans.rescues,assistanceKcal:snapshot.humans.assistanceKcal-older.humans.assistanceKcal});
    }
    this.monitor(snapshot);return snapshot;
  }
  requestExperiment(action,{reason='Owner-requested world experiment.'}={}){
    const c=this.cardinal,parameter=action?.parameter,value=action?.value??action?.to,limits=CARDINAL_ACTUATORS[parameter],rules=this.getRules(this.state.environment)||{};
    if(!limits||!Number.isFinite(value)||value<limits.min||value>limits.max)return{ok:false,code:'INVALID_CARDINAL_ACTUATOR'};
    if(!Number.isFinite(rules[parameter])||equal(rules[parameter],value))return{ok:false,code:'NO_WORLD_RULE_CHANGE'};
    if(c.pending||c.proposals.some(p=>p.status==='queued'))return{ok:false,code:'EXPERIMENT_ALREADY_QUEUED'};
    const proposal=bounded(c.proposals,{id:identifier(c,'proposal'),at:elapsed(this.state),parameter,from:rules[parameter],to:value,reason:shortText(reason),context:'owner_requested',status:'queued',origin:'owner'},R.maxProposals);
    return{ok:true,proposal};
  }
  contexts(){
    const c=this.cardinal,latest=c.observations.at(-1);if(!latest)return[];
    if(Math.abs(latest.ecology.balanceErrorKcal)>.1)return['accounting_defect'];
    const old=c.observations.find(v=>latest.at-v.at>=this.config.minHistorySeconds&&latest.at-v.at<this.config.minHistorySeconds+this.config.observationSeconds*2);if(!old)return[];
    const contexts=[],spent=latest.humans.spentKcal-old.humans.spentKcal,absorbed=latest.humans.absorbedKcal-old.humans.absorbedKcal;
    if(spent>10&&absorbed/spent<.75&&!this.currentStalls?.humans)contexts.push('nutrition_gap');
    if(!this.currentStalls?.animals&&(latest.animals.count<old.animals.count||latest.animals.waterDebtMl>Math.max(500,latest.animals.count*150)))contexts.push('animal_habitat_pressure');
    if(latest.resources.biomassGrams<old.resources.biomassGrams*.75||latest.resources.biomassCapacityGrams>0&&latest.resources.biomassFraction<.3)contexts.push('producer_depletion');
    if(latest.resources.plantCount>0&&latest.resources.meanMoisture<.25)contexts.push('dry_soil');
    const thermal=(this.state.agents||[]).reduce((max,a)=>Math.max(max,finite(a.thermal?.hot),finite(a.thermal?.cold)),0);
    if(thermal>20)contexts.push('thermal_exposure');
    if((this.currentStalls?.humans||0)+(this.currentStalls?.animals||0)>0)contexts.push('blocked_motion');return contexts;
  }
  context(){return this.contexts()[0]||null;}
  propose(){
    const c=this.cardinal,contexts=this.contexts();if(!contexts.length||contexts[0]==='accounting_defect')return null;
    const rules=this.getRules(this.state.environment)||{},latest=c.observations.at(-1),old=c.observations.find(v=>latest.at-v.at>=this.config.minHistorySeconds&&latest.at-v.at<this.config.minHistorySeconds+this.config.observationSeconds*2);
    const reproductionPressure=old&&latest.ecology.births>old.ecology.births&&(latest.resources.biomassFraction<.3||latest.resources.biomassGrams<old.resources.biomassGrams*.95||latest.animals.waterDebtFraction>.04);
    for(const context of contexts){
      if(context==='blocked_motion')continue;let candidates=[];
      const add=(parameter,direction,reason)=>{const a=CARDINAL_ACTUATORS[parameter],from=rules[parameter];if(!a||!Number.isFinite(from))return;const to=Math.round(Math.max(a.min,Math.min(a.max,from+a.step*direction))*10000)/10000;if(equal(from,to))return;const evidence=c.learning.find(l=>l.context===context&&l.parameter===parameter&&l.direction===direction);const uncertainty=1/Math.sqrt(1+(evidence?.trials||0));candidates.push({context,parameter,from,to,reason,evidence,rank:(evidence?.meanGain||0)+uncertainty*.04});};
      if(context==='nutrition_gap'){
        add('fruitYieldMultiplier',1,'Test whether future fruit production improves independent intake without teaching a technique.');
        add('plantGrowthMultiplier',1,'Test whether producer regrowth improves food access without increasing outside assistance.');
      }else if(context==='producer_depletion'){
        add('plantGrowthMultiplier',1,'Test regrowth against a frozen-rule control while preserving finite ecological accounting.');
        if(latest.resources.meanMoisture<.55)add('rainfallMultiplier',1,'Test whether rain replenishes dry soil and reduces producer depletion without ecological or physiological harm.');
        if(reproductionPressure)add('animalReproductionMultiplier',-1,'New births coincide with depleted forage. Test reduced future reproduction while preserving the health and diversity of existing animals.');
      }else if(context==='dry_soil')add('rainfallMultiplier',1,'Test whether a small increase in rainfall improves measured soil moisture and sustained production.');
      else if(context==='animal_habitat_pressure'){
        add('animalForagingRangeMultiplier',1,'Test whether a larger animal search range improves feeding and water balance without a navigation stall.');
        if(reproductionPressure)add('animalReproductionMultiplier',-1,'New births coincide with habitat pressure. Test fewer future births against animal health, deaths and resource recovery.');
      }else if(context==='thermal_exposure'){
        const hot=(this.state.agents||[]).reduce((n,a)=>n+finite(a.thermal?.hot),0),cold=(this.state.agents||[]).reduce((n,a)=>n+finite(a.thermal?.cold),0);
        add('temperatureOffsetC',hot>=cold?-1:1,'Test a small climate adjustment against unchanged exposure, including ecological costs.');
        add('windMultiplier',hot>=cold?1:-1,'Test cooling wind during heat exposure, or reduced wind during cold exposure, against actual thermal strain.');
      }
      // Learning retires unsuccessful hypotheses in one context without hiding other problems.
      candidates=candidates.filter(v=>!v.evidence||v.evidence.trials<3||v.evidence.meanGain>this.config.minimumGain||latest.at-v.evidence.lastAt>=this.config.hypothesisRetrySeconds).sort((a,b)=>b.rank-a.rank||a.parameter.localeCompare(b.parameter));
      const selected=candidates[0];if(!selected)continue;
      return bounded(c.proposals,{id:identifier(c,'proposal'),at:elapsed(this.state),parameter:selected.parameter,from:selected.from,to:selected.to,reason:selected.reason,context:selected.context,status:'queued',origin:'automatic'},R.maxProposals);
    }
    this.diagnose('NO_EFFECTIVE_WORLD_INTERVENTION','warning','The available tested hypotheses have not helped the current problems. Cardinal will keep observing rather than inventing a successful intervention.');return null;
  }
  start(proposal){
    const c=this.cardinal,current=this.getRules(this.state.environment)?.[proposal.parameter];
    if(!equal(current,proposal.from)){proposal.status='stale';this.diagnose('STALE_PROPOSAL','info','A proposal was discarded because its baseline rule changed.');return false;}
    if(typeof this.experimentFactory!=='function'){this.diagnose('EXPERIMENT_RUNNER_UNAVAILABLE','warning','Copied-world experiment execution is unavailable; no live world change was made.');return false;}
    const seed=(this.state.environment?.seed??CONFIG.seed)>>>0,salt=(Math.imul(c.nextId,2654435761))>>>0;
    const seeds=[(seed^salt)>>>0,(seed^salt^0x9e3779b9)>>>0,(seed^salt^0x85ebca6b)>>>0];
    try{
      const runner=this.experimentFactory({state:this.state,proposal:{...proposal},seeds,horizonSeconds:this.config.experimentHorizonSeconds});
      if(!runner||typeof runner.work!=='function')throw new Error('Invalid experiment runner');
      this.runnerMetadata=runner.serialize?.()?.provenance||{};this.runnerSteps=0;this.runner=runner;proposal.status='running';c.pending={id:identifier(c,'experiment'),proposalId:proposal.id,startedAt:elapsed(this.state),progress:0};c.lastExperimentAt=elapsed(this.state);c.status='experimenting';return true;
    }catch(error){proposal.status='rejected';c.lastExperimentAt=elapsed(this.state);this.diagnose('EXPERIMENT_FAILED','warning',`Copied-world setup failed: ${shortText(error?.message,180)}. No live rule changed.`);return false;}
  }
  tick(dt){
    if(this.disposed||!Number.isFinite(dt)||dt<=0)return;
    const c=this.cardinal,at=elapsed(this.state);if(c.mode==='off'){c.status='off';return;}
    if(at-c.lastObservationAt+1e-8>=this.config.observationSeconds)this.observe();
    if(this.state.simulationMode!=='discovery'||c.mode!=='adaptive'||this.runner||at-c.lastExperimentAt<this.config.experimentIntervalSeconds)return;
    if(Math.abs(c.observations.at(-1)?.ecology.balanceErrorKcal||0)>.1)return;
    // An applied rule gets a live observation window before another automatic change.
    if(c.monitor)return;
    const proposal=c.proposals.find(p=>p.status==='queued')||this.propose();if(proposal)this.start(proposal);
  }
  work(budget=this.config.shadowBudget){
    if(this.disposed||!this.runner||this.cardinal.mode!=='adaptive')return{running:false};
    const runner=this.runner,c=this.cardinal;
    try{
      const work=runner.work({maxSteps:24,maxMilliseconds:Math.max(.5,Math.min(8,finite(budget,this.config.shadowBudget)))});
      this.runnerSteps+=Math.max(0,finite(work?.steps));
      const progress=finite(runner.progress,this.runnerMetadata?.requiredSteps?this.runnerSteps/this.runnerMetadata.requiredSteps:c.pending?.progress||0);if(c.pending)c.pending.progress=Math.max(0,Math.min(1,progress));
      if(runner.done){const result=runner.result;this.runner=null;this.complete(result);runner.cancel?.();return{running:false,done:true};}
      return{running:true,progress:c.pending?.progress||0};
    }catch(error){const proposal=c.proposals.find(p=>p.id===c.pending?.proposalId);if(proposal)proposal.status='rejected';runner.cancel?.();this.runner=null;c.pending=null;c.status='observing';this.diagnose('EXPERIMENT_FAILED','warning',`Copied-world execution failed: ${shortText(error?.message,180)}. No live rule changed.`);return{running:false,error:'EXPERIMENT_FAILED'};}
  }
  complete(result){
    const c=this.cardinal,pending=c.pending,proposal=c.proposals.find(p=>p.id===pending?.proposalId);c.pending=null;c.status='observing';if(!proposal)return;
    const pairs=Array.isArray(result?.pairs)?result.pairs.filter(p=>Number.isInteger(p?.seed)&&['training','holdout'].includes(p.role)&&Number.isFinite(p.gain)):[];
    const training=pairs.filter(p=>p.role==='training'),holdout=pairs.filter(p=>p.role==='holdout');
    const trainingGain=mean(training.map(p=>p.gain)),holdoutGain=mean(holdout.map(p=>p.gain)),meanGain=mean(pairs.map(p=>p.gain));
    const provenance=result?.provenance||{},matching=result?.proposal?.id===proposal.id&&result?.proposal?.parameter===proposal.parameter&&equal(result?.proposal?.from,proposal.from)&&equal(result?.proposal?.to,proposal.to),valid=matching&&result?.status==='completed'&&provenance.controlFrozen===true&&provenance.paired===true&&provenance.cardinalDisabled===true&&Number.isFinite(provenance.horizonSeconds)&&provenance.horizonSeconds>0&&new Set(pairs.map(p=>p.seed)).size>=3&&training.length>=2&&holdout.length>=1&&pairs.every(p=>p.control&&p.candidate&&typeof p.passed==='boolean');
    const safe=pairs.every(p=>p.passed===true);
    const contextGain=pair=>{
      const control=pair.control,candidate=pair.candidate;
      if(proposal.context==='nutrition_gap'){const calories=finite(candidate?.humans?.independentAbsorbedKcal)-finite(control?.humans?.independentAbsorbedKcal),coverage=finite(candidate?.humans?.nutritionRatio)-finite(control?.humans?.nutritionRatio);return Math.min(calories/Math.max(.1,finite(control?.humans?.spentKcal)*.005),coverage/.005);}
      if(proposal.context==='animal_habitat_pressure')return Math.max(finite(candidate?.animals?.nutritionRatio)-finite(control?.animals?.nutritionRatio),finite(control?.after?.animals?.waterDebtFraction)-finite(candidate?.after?.animals?.waterDebtFraction));
      if(proposal.context==='producer_depletion')return Math.max(finite(candidate?.ecology?.photosynthesisKcal)-finite(control?.ecology?.photosynthesisKcal),finite(candidate?.after?.resources?.biomassGrams)-finite(control?.after?.resources?.biomassGrams));
      if(proposal.context==='dry_soil')return finite(candidate?.after?.resources?.meanMoisture)-finite(control?.after?.resources?.meanMoisture);
      if(proposal.context==='thermal_exposure')return finite(control?.humans?.meanThermalStrain,control?.after?.humans?.thermalStrain)-finite(candidate?.humans?.meanThermalStrain,candidate?.after?.humans?.thermalStrain);
      return 1;
    };
    const targeted=training.every(pair=>contextGain(pair)>1e-8)&&holdout.every(pair=>contextGain(pair)>=-1e-8);
    const adopt=valid&&safe&&targeted&&result.recommendation==='adopt'&&trainingGain>=this.config.minimumGain&&holdoutGain>=-this.config.maximumHoldoutLoss&&pairs.every(p=>p.gain>=-this.config.maximumHoldoutLoss);
    const reason=!valid?'Experiment evidence was incomplete or malformed.':!safe?'A completed comparison failed a safety check; its rejection informs future choices.':!targeted?'The candidate did not improve the measured problem named by its hypothesis.':adopt?'Training comparisons improved and the held-out comparison passed without hidden assistance.':shortText(result?.reason)||'The candidate did not improve the paired comparisons enough.';
    const experiment=cleanCardinalExperiment({id:pending.id,proposalId:proposal.id,at:elapsed(this.state),status:result?.status,recommendation:adopt?'adopt':'reject',meanGain,trainingGain,holdoutGain,reason,pairs,provenance});
    bounded(c.experiments,experiment,R.maxExperiments);
    proposal.status=adopt?'adopted':'rejected';
    if(!adopt){if(valid)this.learn(proposal,!safe?Math.min(-this.config.minimumGain,meanGain):targeted?meanGain:Math.min(0,meanGain),false);return;}
    const current=this.getRules(this.state.environment)?.[proposal.parameter];
    if(!equal(current,proposal.from)){proposal.status='stale';experiment.recommendation='reject';experiment.reason='Live baseline changed while replicas were running; no intervention applied.';this.learn(proposal,meanGain,false);return;}
    const before=cardinalDiagnostics(this.state),applied=this.applyRules(this.state.environment,{[proposal.parameter]:proposal.to},{expectedRevision:this.state.environment?.worldRules?.revision});
    if(!applied?.ok){proposal.status='rejected';experiment.recommendation='reject';experiment.reason=`World-rule validation rejected this change: ${shortText(applied?.code,80)}`;this.learn(proposal,meanGain,false);return;}
    const actual=this.getRules(this.state.environment)?.[proposal.parameter];if(!equal(actual,proposal.to)){proposal.status='rejected';this.diagnose('ACTUATOR_FAILED','critical','The world-rule actuator did not return the validated value.');return;}
    this.learn(proposal,meanGain,true);
    const intervention=bounded(c.interventions,{id:identifier(c,'intervention'),at:elapsed(this.state),proposalId:proposal.id,parameter:proposal.parameter,before:proposal.from,after:proposal.to,revision:finite(applied.revision),status:'applied',reason},R.maxInterventions);
    c.monitor={interventionId:intervention.id,startedAt:elapsed(this.state),before};c.status='monitoring';
  }
  learn(proposal,gain,accepted){
    const c=this.cardinal,direction=proposal.to>proposal.from?1:-1;let record=c.learning.find(v=>v.context===proposal.context&&v.parameter===proposal.parameter&&v.direction===direction);
    if(!record)record=bounded(c.learning,{context:proposal.context,parameter:proposal.parameter,direction,trials:0,accepted:0,rejected:0,meanGain:0,m2:0,lastAt:0},R.maxLearning);
    record.trials++;const delta=gain-record.meanGain;record.meanGain+=delta/record.trials;record.m2+=delta*(gain-record.meanGain);record[accepted?'accepted':'rejected']++;record.lastAt=elapsed(this.state);
  }
  monitor(snapshot){
    const c=this.cardinal,watch=c.monitor;if(!watch||c.mode!=='adaptive')return;
    const watched=c.interventions.find(v=>v.id===watch.interventionId);if(!watched||!equal(this.getRules(this.state.environment)?.[watched.parameter],watched.after)){c.monitor=null;c.status='observing';this.diagnose('INTERVENTION_OVERRIDDEN','info','A monitored world rule was changed outside this intervention. Cardinal preserved that newer setting.');return;}
    const old=watch.before;if(!old){c.monitor=null;return;}
    const loss=old.humans.minimumHealth-snapshot.humans.minimumHealth,assistance=snapshot.humans.assistanceKcal-old.humans.assistanceKcal;
    if(loss>=this.config.rollbackHealthLoss||assistance>this.config.rollbackAssistanceIncrease||snapshot.humans.collapses>old.humans.collapses||Math.abs(snapshot.ecology.balanceErrorKcal)>.1){
      this.rollbackLast({automatic:true,reason:'Live monitoring detected worsening health, additional rescue assistance, collapse, or an ecological accounting error.'});return;
    }
    if(snapshot.at-watch.startedAt>=this.config.monitoringSeconds){c.monitor=null;c.status='observing';this.diagnose('INTERVENTION_MONITORED','info','The live observation window completed. Long-term sustainability remains a separate question.');}
  }
  rollbackLast({automatic=false,reason='Owner requested rollback of the latest world-rule intervention.'}={}){
    const c=this.cardinal,intervention=[...c.interventions].reverse().find(v=>v.status==='applied');if(!intervention)return{ok:false,code:'NO_INTERVENTION_TO_ROLL_BACK'};
    const current=this.getRules(this.state.environment)?.[intervention.parameter];if(!equal(current,intervention.after))return{ok:false,code:'WORLD_RULE_CHANGED_SINCE_INTERVENTION'};
    const result=this.applyRules(this.state.environment,{[intervention.parameter]:intervention.before},{expectedRevision:this.state.environment?.worldRules?.revision});if(!result?.ok)return result;
    intervention.status='rolled_back';intervention.reason=`${intervention.reason} Rollback: ${shortText(reason,220)}`;c.monitor=null;c.status='observing';
    const p=c.proposals.find(v=>v.id===intervention.proposalId),record=p&&c.learning.find(v=>v.context===p.context&&v.parameter===p.parameter&&v.direction===(p.to>p.from?1:-1));
    if(automatic&&record){
      const tested=c.experiments.find(v=>v.proposalId===p.id),previousGain=finite(tested?.meanGain),replacement=-this.config.minimumGain,n=Math.max(1,record.trials),oldMean=record.meanGain;
      record.meanGain=oldMean+(replacement-previousGain)/n;record.m2=n<=1?0:Math.max(0,record.m2+(replacement-previousGain)*(replacement+previousGain-oldMean-record.meanGain));
      if(record.accepted>0){record.accepted--;record.rejected++;}else{record.trials++;record.rejected++;}record.lastAt=elapsed(this.state);
    }
    this.diagnose(automatic?'AUTOMATIC_ROLLBACK':'OWNER_ROLLBACK',automatic?'warning':'info',reason,{before:intervention.after,after:intervention.before});return{ok:true,intervention};
  }
}
