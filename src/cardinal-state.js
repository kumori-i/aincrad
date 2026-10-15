import { CARDINAL_RULES as R, CARDINAL_ACTUATORS, CARDINAL_MODES } from './cardinal-config.js';
import { validateWorldRules } from './world-rules.js';
const finite=(v,f=0)=>Number.isFinite(v)?v:f;
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,finite(v,lo)));
const text=(v,max=240)=>typeof v==='string'?v.slice(0,max):'';
const id=v=>typeof v==='string'&&/^cardinal:[a-z]+:\d{1,9}$/.test(v)?v:null;
const numberFields=(raw,keys)=>Object.fromEntries(keys.map(k=>[k,clamp(raw?.[k],-1e15,1e15)]));
const humanKeys=['count','healthMean','minimumHealth','fatigueMean','waterDebtMl','waterDebtFraction','thermalStrain','energyStoredKcal','absorbedKcal','spentKcal','absorbedWaterMl','waterLostMl','assistanceKcal','assistanceWaterMl','rescues','collapses','criticalSeconds','groundedPractice','learnedTechniques','routeStalls'];
const animalKeys=['count','speciesCount','healthMean','waterDebtMl','waterDebtFraction','energyStoredKcal','routeStalls','absorbedKcal','spentKcal','absorbedWaterMl','waterLostMl'];
const resourceKeys=['biomassGrams','fruitUnits','availableKcal','plantCount','meanMoisture','biomassCapacityGrams','biomassFraction'];
const ledgerKeys=['initialKcal','photosynthesisKcal','humanRemovedKcal','metabolizedKcal','decomposedKcal','discardedKcal','birthTransferredKcal','externalKcal','waterConsumedMl','animalAbsorbedKcal','animalAbsorbedWaterMl','animalWaterLostMl'];
const intervalKeys=['seconds','nutritionRatio','independentAbsorbedKcal','spentKcal','waterBurden','assistanceKcal','assistanceWaterMl','reserveDeltaKcal','waterDebtDeltaMl','criticalHours','score','healthLoss','deaths','collapses','rescues','speciesLoss','balanceErrorKcal','practiceGain','techniqueGain','gameHours','waterCoverageRatio','independentWaterMl','stallSeconds','meanFatigue','meanThermalStrain','minimumHealth'];
export function cleanCardinalMetrics(raw){
  if(!raw||typeof raw!=='object')return null;
  const out={version:1,at:clamp(raw.at,0,1e12),humans:numberFields(raw.humans,humanKeys),animals:{...numberFields(raw.animals,animalKeys),species:{}},resources:numberFields(raw.resources,resourceKeys),ecology:{...numberFields(raw.ecology,['remainingKcal','balanceErrorKcal','births','deaths']),ledger:numberFields(raw.ecology?.ledger,ledgerKeys)}};
  for(const key of ['rabbit','fox','bobcat'])out.animals.species[key]=clamp(raw.animals?.species?.[key],0,10000);
  return out;
}
export function cleanCardinalInterval(raw){
  if(!raw||typeof raw!=='object')return null;
  const out={...numberFields(raw,intervalKeys)};
  for(const key of ['before','after'])if(raw[key])out[key]=cleanCardinalMetrics(raw[key]);
  for(const key of ['humans','animals','resources','ecology'])if(raw[key]&&typeof raw[key]==='object'){
    const allowed=key==='humans'?[...humanKeys,...intervalKeys]:key==='animals'?[...animalKeys,...intervalKeys,'deaths','speciesLoss']:key==='resources'?resourceKeys:['photosynthesisKcal','externalKcal','balanceErrorKcal','births','deaths'];
    out[key]=numberFields(raw[key],allowed);
  }
  return out;
}
function proposal(raw){
  if(!id(raw?.id)||!Object.hasOwn(CARDINAL_ACTUATORS,raw?.parameter))return null;
  const a=CARDINAL_ACTUATORS[raw.parameter];
  return{id:raw.id,at:clamp(raw.at,0,1e12),parameter:raw.parameter,from:clamp(raw.from,a.min,a.max),to:clamp(raw.to,a.min,a.max),reason:text(raw.reason),context:text(raw.context,80),status:['queued','running','adopted','rejected','interrupted','stale'].includes(raw.status)?raw.status:'queued',origin:raw.origin==='owner'?'owner':'automatic'};
}
function diagnosis(raw){return id(raw?.id)?{id:raw.id,at:clamp(raw.at,0,1e12),code:text(raw.code,80),severity:['info','warning','critical'].includes(raw.severity)?raw.severity:'info',summary:text(raw.summary,400),evidence:numberFields(raw.evidence,Object.keys(raw.evidence||{}).filter(k=>/^[a-zA-Z][a-zA-Z0-9]{0,39}$/.test(k)).slice(0,12))}:null;}
const cleanUtility=raw=>{if(!raw||typeof raw!=='object')return null;const keys=['nutrition','hydration','health','fatigue','thermal','critical','movement','animalNutrition','diversity','resources','practice'];return{score:clamp(raw.score,-10,10),components:numberFields(raw.components,keys),weights:numberFields(raw.weights,keys)};};
const fingerprint=v=>typeof v==='string'&&/^[a-fA-F0-9]{1,80}$/.test(v)?v:'';
export function cleanCardinalExperiment(raw){
  if(!id(raw?.id)||!id(raw?.proposalId))return null;
  const pairs=(Array.isArray(raw.pairs)?raw.pairs:[]).slice(0,6).filter(p=>Number.isInteger(p?.seed)&&['training','holdout'].includes(p.role)&&Number.isFinite(p.gain)).map(p=>({seed:p.seed>>>0,role:p.role,gain:clamp(p.gain,-1e6,1e6),passed:p.passed===true,improved:p.improved===true,reasons:(Array.isArray(p.reasons)?p.reasons:[]).slice(0,8).map(v=>text(v,160)),control:cleanCardinalInterval(p.control),candidate:cleanCardinalInterval(p.candidate),controlUtility:cleanUtility(p.controlUtility),candidateUtility:cleanUtility(p.candidateUtility),checkpointFingerprint:fingerprint(p.checkpointFingerprint),rulesBefore:validateWorldRules(p.rulesBefore),rulesAfter:validateWorldRules(p.rulesAfter)}));
  const p=raw.provenance||{};
  return{id:raw.id,proposalId:raw.proposalId,at:clamp(raw.at,0,1e12),status:['completed','failed','cancelled','budget_exhausted'].includes(raw.status)?raw.status:'failed',recommendation:raw.recommendation==='adopt'?'adopt':'reject',meanGain:clamp(raw.meanGain,-1e6,1e6),trainingGain:clamp(raw.trainingGain,-1e6,1e6),holdoutGain:clamp(raw.holdoutGain,-1e6,1e6),reason:text(raw.reason,400),pairs,provenance:{paired:p.paired===true,cardinalDisabled:p.cardinalDisabled===true,controlFrozen:p.controlFrozen===true,snapshotFingerprint:fingerprint(p.snapshotFingerprint),snapshotHashAlgorithm:p.snapshotHashAlgorithm==='fnv1a32'?'fnv1a32':'unknown',sourceVersion:text(p.sourceVersion,80),sourceFingerprint:fingerprint(p.sourceFingerprint),sourceFingerprintAlgorithm:p.sourceFingerprintAlgorithm==='sha256'?'sha256':'unavailable',physiologyFingerprint:fingerprint(p.physiologyFingerprint),rulesBefore:validateWorldRules(p.rulesBefore),checkpointAt:clamp(p.checkpointAt,0,1e12),horizonSeconds:clamp(p.horizonSeconds,0,1e8),shadowStep:clamp(p.shadowStep,0,1),requiredSteps:clamp(p.requiredSteps,0,1e10),maxTotalSteps:clamp(p.maxTotalSteps,0,1e10),seeds:(Array.isArray(p.seeds)?p.seeds:[]).filter(Number.isInteger).slice(0,6).map(v=>v>>>0),seedMeaning:text(p.seedMeaning,240),steps:clamp(p.steps,0,1e10),completedAt:clamp(p.completedAt,0,1e12)}};
}
export function createCardinal({enabled=true,mode=enabled?'adaptive':'off'}={}){
  return{version:R.version,mode:CARDINAL_MODES.includes(mode)?mode:'adaptive',nextId:1,status:'observing',lastObservationAt:-R.observationSeconds,lastExperimentAt:-R.experimentIntervalSeconds,observations:[],diagnoses:[],proposals:[],experiments:[],interventions:[],learning:[],pending:null,monitor:null};
}
export function validateCardinal(raw,{enabled=true,restoring=false}={}){
  const out=createCardinal({enabled});if(!raw||raw.version!==R.version)return out;
  out.mode=CARDINAL_MODES.includes(raw.mode)?raw.mode:out.mode;out.status=text(raw.status,80)||'observing';out.nextId=clamp(Math.floor(finite(raw.nextId,1)),1,999999999);
  out.lastObservationAt=clamp(raw.lastObservationAt,-R.observationSeconds,1e12);out.lastExperimentAt=clamp(raw.lastExperimentAt,-R.experimentIntervalSeconds,1e12);
  out.observations=(Array.isArray(raw.observations)?raw.observations:[]).slice(-R.maxObservations).map(cleanCardinalMetrics).filter(Boolean);
  out.diagnoses=(Array.isArray(raw.diagnoses)?raw.diagnoses:[]).slice(-R.maxDiagnoses).map(diagnosis).filter(Boolean);
  out.proposals=(Array.isArray(raw.proposals)?raw.proposals:[]).slice(-R.maxProposals).map(proposal).filter(Boolean);
  const proposalIds=new Set(out.proposals.map(p=>p.id));
  out.experiments=(Array.isArray(raw.experiments)?raw.experiments:[]).slice(-R.maxExperiments).map(cleanCardinalExperiment).filter(e=>e&&proposalIds.has(e.proposalId));
  out.interventions=(Array.isArray(raw.interventions)?raw.interventions:[]).slice(-R.maxInterventions).filter(v=>id(v?.id)&&proposalIds.has(v.proposalId)&&Object.hasOwn(CARDINAL_ACTUATORS,v.parameter)).map(v=>{const a=CARDINAL_ACTUATORS[v.parameter];return{id:v.id,at:clamp(v.at,0,1e12),proposalId:v.proposalId,parameter:v.parameter,before:clamp(v.before,a.min,a.max),after:clamp(v.after,a.min,a.max),revision:clamp(v.revision,0,1e9),status:v.status==='rolled_back'?'rolled_back':'applied',reason:text(v.reason,400)};});
  out.learning=(Array.isArray(raw.learning)?raw.learning:[]).slice(-R.maxLearning).filter(v=>Object.hasOwn(CARDINAL_ACTUATORS,v?.parameter)).map(v=>{const trials=clamp(Math.floor(finite(v.trials)),0,1e9),accepted=clamp(Math.floor(finite(v.accepted)),0,trials);return{context:text(v.context,80),parameter:v.parameter,direction:v.direction===-1?-1:1,trials,accepted,rejected:trials-accepted,meanGain:trials?clamp(v.meanGain,-1e6,1e6):0,m2:trials>1?clamp(v.m2,0,1e15):0,lastAt:clamp(v.lastAt,0,1e12)};});
  if(raw.pending&&id(raw.pending.id)&&proposalIds.has(raw.pending.proposalId))out.pending={id:raw.pending.id,proposalId:raw.pending.proposalId,startedAt:clamp(raw.pending.startedAt,0,1e12),progress:clamp(raw.pending.progress,0,1)};
  if(raw.monitor&&id(raw.monitor.interventionId)&&out.interventions.some(v=>v.id===raw.monitor.interventionId&&v.status==='applied'))out.monitor={interventionId:raw.monitor.interventionId,startedAt:clamp(raw.monitor.startedAt,0,1e12),before:cleanCardinalMetrics(raw.monitor.before)};
  const savedIds=[...out.diagnoses,...out.proposals,...out.experiments,...out.interventions].map(v=>Number(v.id.split(':').at(-1))).filter(Number.isFinite);out.nextId=Math.min(999999999,Math.max(out.nextId,...savedIds.map(v=>v+1)));
  if(restoring&&out.pending){const p=out.proposals.find(p=>p.id===out.pending.proposalId);if(p)p.status='interrupted';out.diagnoses.push({id:`cardinal:diagnosis:${out.nextId++}`,at:Math.max(out.pending.startedAt,out.lastObservationAt,0),code:'EXPERIMENT_INTERRUPTED',severity:'info',summary:'An unfinished copied-world experiment was discarded on restoration. No unfinished result was applied.',evidence:{}});out.diagnoses=out.diagnoses.slice(-R.maxDiagnoses);out.pending=null;out.status='observing';}
  return out;
}
