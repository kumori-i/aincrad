import { CONFIG } from './config.js';
import { BIOLOGY_RULES, BIOLOGY_PROFILES } from './biology-config.js';
import { applyWorldRules, getWorldRule } from './world-rules.js';
import { createCardinalMetricTracker, scoreCardinalMetrics } from './cardinal-metrics.js';

const PARAMETERS=Object.freeze(['plantGrowthMultiplier','fruitYieldMultiplier','animalForagingRangeMultiplier','animalReproductionMultiplier','temperatureOffsetC','rainfallMultiplier','windMultiplier','seasonLengthMultiplier']);
const finite=(value,fallback=0)=>Number.isFinite(value)?value:fallback;
const clone=value=>structuredClone(value);
const now=()=>globalThis.performance?.now?.() ?? Date.now();
const text=(value,length=600)=>typeof value==='string'?value.slice(0,length):'';
const hash=value=>{let out=2166136261;for(const char of JSON.stringify(value)??'null'){out^=char.charCodeAt(0);out=Math.imul(out,16777619);}return(out>>>0).toString(16).padStart(8,'0');};
const withoutRules=state=>{const copy=clone(state);if(copy.environment)delete copy.environment.worldRules;return copy;};
const epsilon=1e-7;

function proposalData(proposal) {
  return {id:text(proposal?.id,100),parameter:text(proposal?.parameter,80),from:proposal?.from,to:proposal?.to,
    reason:text(proposal?.reason),context:text(proposal?.context,200),at:finite(proposal?.at)};
}
function challengeState(snapshot, seed) {
  const state=clone(snapshot);
  // Challenge seeds alter future stochastic choices, never object placement,
  // remembered evidence, body reserves, or the current clock of the checkpoint.
  if(state.environment){state.environment.seed=seed;if(state.environment.ecology)state.environment.ecology.seed=seed;}
  for(const [index,actor] of (state.agents||[]).entries())actor.rng=(seed ^ Math.imul(index+1,2654435761))>>>0;
  state.npc=state.agents?.find(actor=>actor.id==='aster') || state.agents?.[0] || null;
  return state;
}
function branch(runtimeFactory,state,seed,role) {
  const runtime=runtimeFactory(state,{cardinal:false,experiment:true,seed,role});
  if(!runtime || (typeof runtime.step!=='function'&&typeof runtime.tick!=='function'))throw new Error('Shadow runtime must implement step(dt) or tick(dt).');
  return {state,runtime,tracker:createCardinalMetricTracker(state)};
}
function stepBranch(item,dt) {
  if(typeof item.runtime.step==='function')item.runtime.step(dt);
  else {item.state.elapsed=finite(item.state.elapsed)+dt;item.runtime.tick(dt);}
  item.tracker.sample(item.state,dt);
}
function dispose(item){try{item?.runtime?.dispose?.();}catch{/* Cancellation must dispose the other replica too. */}}

function comparePair(control,candidate,{minimumGain,context,parameter,from,to}) {
  const controlUtility=scoreCardinalMetrics(control),candidateUtility=scoreCardinalMetrics(candidate),gain=candidateUtility.score-controlUtility.score;
  const reasons=[];
  const ch=control.after.humans,nh=candidate.after.humans,ca=control.after.animals,na=candidate.after.animals;
  if(!Number.isFinite(gain))reasons.push('non_finite_measurement');
  if(candidate.seconds+epsilon<control.seconds || Math.abs(candidate.seconds-control.seconds)>epsilon)reasons.push('unequal_observation_windows');
  if(nh.count!==ch.count)reasons.push('human_population_changed');
  if(nh.healthMean<ch.healthMean-2 || (candidate.humans.minimumHealth??nh.minimumHealth)<(control.humans.minimumHealth??ch.minimumHealth)-3)reasons.push('human_health_regression');
  if(candidate.humans.collapses>control.humans.collapses || candidate.humans.rescues>control.humans.rescues)reasons.push('more_collapses_or_rescues');
  if(candidate.humans.assistanceKcal>control.humans.assistanceKcal+epsilon || candidate.humans.assistanceWaterMl>control.humans.assistanceWaterMl+epsilon)reasons.push('more_outside_assistance');
  if(nh.waterDebtFraction>ch.waterDebtFraction+.005)reasons.push('human_dehydration_regression');
  if(candidate.humans.criticalSeconds>control.humans.criticalSeconds+Math.max(1,control.seconds*.01*ch.count))reasons.push('more_critical_exposure');
  const fewerBirths=Math.max(0,control.ecology.births-candidate.ecology.births);
  const controlledFertility=parameter==='animalReproductionMultiplier'&&to<from&&candidate.ecology.deaths<=control.ecology.deaths&&ca.count-na.count<=fewerBirths;
  if(na.speciesCount<ca.speciesCount || (!controlledFertility&&na.count<ca.count-Math.max(1,Math.floor(ca.count*.1))))reasons.push('animal_population_regression');
  if(parameter==='animalReproductionMultiplier'&&to<from&&candidate.ecology.deaths>control.ecology.deaths)reasons.push('animal_mortality_regression');
  if(ca.count && na.count && na.healthMean<ca.healthMean-5)reasons.push('animal_health_regression');
  if(na.waterDebtFraction>ca.waterDebtFraction+.01)reasons.push('animal_dehydration_regression');
  if(Math.abs(control.ecology.balanceErrorKcal)>.01 || Math.abs(candidate.ecology.balanceErrorKcal)>.01)reasons.push('unaccounted_ecosystem_energy');
  if(candidate.ecology.externalKcal>control.ecology.externalKcal+epsilon)reasons.push('more_external_resource_energy');
  if(context==='nutrition_gap' && !(candidate.humans.independentAbsorbedKcal-control.humans.independentAbsorbedKcal>Math.max(.1,control.humans.spentKcal*.005) && candidate.humans.nutritionRatio>control.humans.nutritionRatio+.005))reasons.push('nutrition_gap_not_improved');
  return {gain,passed:reasons.length===0,reasons,controlUtility,candidateUtility,improved:gain>=minimumGain};
}

/**
 * Paired shadow experiment. No PopulationRuntime import: the owner injects an
 * offline runtime with Cardinal disabled, preventing recursive experiments.
 * advance/work execute a bounded amount of synchronous work; rendering and
 * foreground life can run between calls. Replicas never share the live world.
 */
export function createCardinalExperiment(snapshot, rawProposal, options={}) {
  const proposal=proposalData(rawProposal),snapshotFingerprint=hash(snapshot),sourceVersion=text(options.sourceVersion||CONFIG.version,80);
  const sourceFingerprint=/^[a-f0-9]{64}$/i.test(options.sourceFingerprint||'')?options.sourceFingerprint.toLowerCase():'';
  const horizonSeconds=Math.max(.25,Math.min(CONFIG.dayRealSeconds*2,finite(options.horizonSeconds,900)));
  const shadowStep=[.1,.25].includes(options.shadowStep)?options.shadowStep:.25;
  const baseSeed=(snapshot?.environment?.seed??CONFIG.seed)>>>0;
  const seeds=[...new Set((Array.isArray(options.seeds)?options.seeds:[baseSeed,(baseSeed+1009)>>>0,(baseSeed+65537)>>>0]).filter(seed=>Number.isInteger(seed)&&seed>=0&&seed<=4294967295))].slice(0,5);
  const frames=Math.ceil(horizonSeconds/shadowStep),requiredSteps=frames*2*seeds.length;
  const maxTotalSteps=Math.max(1,Math.min(400000,Math.floor(finite(options.maxTotalSteps,250000))));
  const minimumGain=Math.max(.00001,Math.min(.1,finite(options.minimumGain,.001)));
  const provenance={paired:true,cardinalDisabled:true,controlFrozen:true,snapshotFingerprint,snapshotHashAlgorithm:'fnv1a32',sourceVersion,sourceFingerprint,sourceFingerprintAlgorithm:sourceFingerprint?'sha256':'unavailable',
    physiologyFingerprint:hash({BIOLOGY_RULES,BIOLOGY_PROFILES}),rulesBefore:clone(snapshot?.environment?.worldRules||{}),
    checkpointAt:finite(snapshot?.elapsed),horizonSeconds,shadowStep,requiredSteps,maxTotalSteps,seeds:[...seeds],seedMeaning:'Future choices and weather vary; copied geometry, bodies, evidence and starting time are retained.',steps:0,completedAt:null};
  const pairs=[];
  let pairIndex=0,frame=0,active=null,done=false,result=null,cancelled=false;
  let source=null;
  const runtimeFactory=options.runtimeFactory;
  function finish(status,reason) {
    dispose(active?.control);dispose(active?.candidate);active=null;done=true;
    provenance.completedAt=provenance.checkpointAt+(status==='completed'?horizonSeconds:Math.min(horizonSeconds,frame*shadowStep));
    const training=pairs.filter(pair=>pair.role==='training'),holdout=pairs.filter(pair=>pair.role==='holdout');
    const meanGain=training.length?training.reduce((total,pair)=>total+pair.gain,0)/training.length:0;
    const evidenceComplete=status==='completed'&&pairs.length===seeds.length&&training.length>=2&&holdout.length>=1;
    const adopt=evidenceComplete&&pairs.every(pair=>pair.passed)&&training.every(pair=>pair.gain>=minimumGain)&&holdout.every(pair=>pair.gain>=0)&&meanGain>=minimumGain;
    result={version:1,proposal:clone(proposal),status,recommendation:adopt?'adopt':'reject',reason:reason||(adopt?'Replicated training gains and held-out safety passed.':'The comparison did not establish a repeatable, safe benefit.'),
      meanGain,minimumGain,pairs:clone(pairs),provenance:clone(provenance),cancelled};
    source=null;
    return result;
  }
  function openPair() {
    const seed=seeds[pairIndex],baseline=challengeState(source,seed),candidate=clone(baseline),control=clone(baseline);
    const initialFingerprint=hash(control);
    if(hash(candidate)!==initialFingerprint)throw new Error('Replicas have different initial checkpoints.');
    const immutable=hash(withoutRules(candidate));
    const revision=candidate.environment?.worldRules?.revision;
    const change=applyWorldRules(candidate.environment,{[proposal.parameter]:proposal.to},{expectedRevision:revision});
    if(!change?.ok || Math.abs(getWorldRule(candidate.environment,proposal.parameter)-proposal.to)>epsilon)throw new Error(`Candidate rule rejected: ${change?.code||'invalid_rule'}`);
    if(hash(withoutRules(candidate))!==immutable)throw new Error('Rule application altered private bodies, memories or resources.');
    let controlBranch=null,candidateBranch=null;
    try {controlBranch=branch(runtimeFactory,control,seed,'control');candidateBranch=branch(runtimeFactory,candidate,seed,'candidate');}
    catch(error){dispose(controlBranch);dispose(candidateBranch);throw error;}
    active={control:controlBranch,candidate:candidateBranch,seed,initialFingerprint,rulesBefore:clone(control.environment.worldRules),rulesAfter:clone(candidate.environment.worldRules)};frame=0;
  }
  function closePair() {
    const control=active.control.tracker.finish(active.control.state),candidate=active.candidate.tracker.finish(active.candidate.state);
    const comparison=comparePair(control,candidate,{minimumGain,context:proposal.context,parameter:proposal.parameter,from:proposal.from,to:proposal.to});
    if(hash(active.control.state.environment.worldRules)!==hash(active.rulesBefore))comparison.reasons.push('control_rules_changed');
    if(hash(active.candidate.state.environment.worldRules)!==hash(active.rulesAfter))comparison.reasons.push('candidate_rules_changed');
    comparison.passed=comparison.reasons.length===0;
    pairs.push({seed:active.seed,role:pairIndex===seeds.length-1?'holdout':'training',control,candidate,...comparison,
      checkpointFingerprint:active.initialFingerprint,rulesBefore:clone(source.environment.worldRules),rulesAfter:active.rulesAfter});
    dispose(active.control);dispose(active.candidate);active=null;pairIndex++;
    if(pairIndex>=seeds.length)finish('completed');
  }
  try {
    if(!snapshot || snapshot.simulationMode!=='discovery' || !snapshot.environment?.ecology)throw new Error('Experiments require a discovery ecosystem checkpoint.');
    if(typeof runtimeFactory!=='function')throw new Error('An offline shadow runtime factory is required.');
    if(!PARAMETERS.includes(proposal.parameter)||!Number.isFinite(proposal.from)||!Number.isFinite(proposal.to)||proposal.from===proposal.to)throw new Error('Only one validated environmental parameter may change.');
    if(Math.abs(getWorldRule(snapshot.environment,proposal.parameter)-proposal.from)>epsilon)throw new Error('Proposal does not match checkpoint rules.');
    if(seeds.length<3)throw new Error('Two distinct training seeds and a separate held-out seed are required.');
    if(requiredSteps>maxTotalSteps)throw new Error('Experiment exceeds the total shadow-step budget.');
    source=clone(snapshot);
  } catch(error) {finish('failed',String(error.message||error).slice(0,300));}

  const api={
    get done(){return done;}, get result(){return result;},
    advance(maxSteps=32,{maxMilliseconds=8}={}) {
      if(done)return {done,result,steps:0};
      const budget=Math.max(2,Math.min(1024,Math.floor(finite(maxSteps,32)))),milliseconds=Math.max(.1,Math.min(8,finite(maxMilliseconds,8)));
      const started=now();let work=0;
      try {
        while(!done&&work+2<=budget) {
          if(provenance.steps+2>maxTotalSteps){finish('failed','Total shadow-step budget exhausted.');break;}
          if(!active)openPair();
          const dt=Math.min(shadowStep,horizonSeconds-frame*shadowStep);
          stepBranch(active.control,dt);stepBranch(active.candidate,dt);frame++;work+=2;provenance.steps+=2;
          if(frame>=frames)closePair();
          if(now()-started>=milliseconds)break;
        }
      } catch(error) {finish('failed',String(error.message||error).slice(0,300));}
      return {done,result,steps:work};
    },
    work(budget=32){return typeof budget==='number'?api.advance(budget):api.advance(budget?.maxSteps??32,{maxMilliseconds:budget?.maxMilliseconds??8});},
    cancel(reason='Experiment interrupted; no live change was applied.') {if(done)return result;cancelled=true;return finish('cancelled',text(reason,300));},
    serialize() {
      // Current replicas are deliberately ephemeral. A restored pending job is
      // interrupted and tested anew; this metadata must never claim completion.
      return {version:1,proposal:clone(proposal),status:done?result.status:'running',checkpoint:{source:snapshotFingerprint,at:provenance.checkpointAt,pairIndex,frame,seed:seeds[pairIndex]??null},
        provenance:clone(provenance),completedPairs:clone(pairs),result:done?clone(result):null,resumable:false};
    },
  };
  return api;
}
