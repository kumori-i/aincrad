// New frozen ordinary development comparison. This is not a historical cohort.
// Run only after gate approval; never retry/overwrite a started named run.
import {writeFileSync,readFileSync,readdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {NORMALIZED_PATHS,comparableHash} from './producer-retest-ci-namespace.mjs';
import {validateArmArguments,sourceFingerprint} from './producer-retest-ci-source.mjs';
validateArmArguments(process.argv.slice(2));
const [rootArg,tag,seedArg,expectedSource,expectedInitial]=process.argv.slice(2),seed=Number(seedArg),seconds=1200;
if(!rootArg||!tag||seed!==77201||!expectedSource)throw Error('Expected frozen checkout, new output tag, seed77201, and source hash.');
const rootPath=resolve(rootArg),root=pathToFileURL(rootPath+'/');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fingerprint=()=>sourceFingerprint(rootPath);
if(fingerprint()!==expectedSource)throw Error('Source mismatch before run.');
writeFileSync(tag+'.started.json',JSON.stringify({seed,seconds,source:expectedSource,at:new Date().toISOString()}),{flag:'wx'});
const {CONFIG}=await import(new URL('src/config.js',root));
if(CONFIG.fixedStep!==1/60)throw Error('Unexpected fixed step.');
const {createOzarkWorldGeometry}=await import(new URL('src/ozark-world-geometry.js',root));
const {createOzarkState,writeOzarkSave,OZARK_SAVE_KEY}=await import(new URL('src/ozark-save.js',root));
const {bindOzarkWorldAgent}=await import(new URL('src/ozark-agent-world.js',root));
const {PopulationRuntime}=await import(new URL('src/population.js',root));
const {bodySignals}=await import(new URL('src/interoception.js',root));
const cycle=existsSync(resolve(rootPath,'src/procedure-cycle.js'))?await import(new URL('src/procedure-cycle.js',root)):null;
const inquiry=existsSync(resolve(rootPath,'src/producer-inquiry.js'))?await import(new URL('src/producer-inquiry.js',root)):null;
const inquiryTransitions=[],inquirySeen=new WeakMap();
const geometry=createOzarkWorldGeometry(),state=createOzarkState(geometry,{communicationSeed:seed});
for(let i=0;i<state.agents.length;i++){const n=state.agents[i];n.rng=seed+i;bindOzarkWorldAgent(n,geometry,state);}
const rawInitialState=JSON.stringify(state),rawInitialStateSha256=hash(rawInitialState),initialStateSha256=comparableHash(state);
writeFileSync(tag+'.initial.json',rawInitialState,{flag:'wx'});
if(expectedInitial&&initialStateSha256!==expectedInitial)throw Error('Paired initial state mismatch before simulation.');
const runtime=new PopulationRuntime(state,{cardinal:false}),rows=[],seen=new Map(),snapshots=[],choices=[],lastChoices=new WeakMap(),activeSeconds={};
const selectedRun=n=>({run:structuredClone(n.discovery.run??null),runSourceId:n.discovery.techniques.find(t=>t.id===n.discovery.run?.techniqueId)?.sourceId??null});
const snap=n=>({actor:n.id,...selectedRun(n),at:n.elapsed,position:{...n.position},lifecycle:n.lifecycle,body:bodySignals(n),thermal:{...n.thermal},
 physiology:{availableEnergyKcal:n.physiology.availableEnergyKcal,storedEnergyKcal:n.physiology.storedEnergyKcal,waterDeficitMl:n.physiology.waterDeficitMl,
 health:n.physiology.health,condition:n.physiology.condition,stamina:n.physiology.stamina,fatigue:n.physiology.fatigue,sleepPressure:n.physiology.sleepPressure,
 totals:{...n.physiology.totals},outsideAssistance:{...n.physiology.outsideAssistance}},stats:{...n.stats},cycle:cycle?.procedureCycleStatus(n)??null,
 active:n.active?{request:structuredClone(n.active.request),startedAt:n.active.startedAt,expiresAt:n.active.expiresAt}:null});
for(const n of state.agents){snapshots.push(snap(n));activeSeconds[n.id]={};}
function captureInquiry(n){
  const question=inquiry?.producerInquiryStatus(n)??null,questionKey=JSON.stringify(question);
  if(questionKey!==inquirySeen.get(n)){inquirySeen.set(n,questionKey);inquiryTransitions.push({actor:n.id,at:n.elapsed,status:structuredClone(question),activeRequest:n.active?structuredClone(n.active.request):null});}
}
const start=performance.now();let step=0,completedSteps=0,failure=null;
try{for(;step<seconds*60;step++){
 state.elapsed+=CONFIG.fixedStep;runtime.tick(CONFIG.fixedStep);completedSteps++;
 for(const n of state.agents){
  for(const e of n.memory.experience)if(e.id>(seen.get(n.id)||0))rows.push({actor:n.id,...structuredClone(e)});
  seen.set(n.id,n.memory.experience.at(-1)?.id||0);
  const action=n.physiology.sleep.state==='sleeping'?'sleeping':n.active?.request?.type||'idle';
  activeSeconds[n.id][action]=(activeSeconds[n.id][action]||0)+CONFIG.fixedStep;
  captureInquiry(n);
  const status=cycle?.procedureCycleStatus(n);
  if(status?.choice&&status.choice!==lastChoices.get(n)){lastChoices.set(n,status.choice);choices.push({actor:n.id,...selectedRun(n),activeRequest:n.active?structuredClone(n.active.request):null,...structuredClone(status.choice),methods:status.methods,pending:status.pending,intent:status.intent});}
  if((step+1)%60===0)snapshots.push(snap(n));
 }
}}catch(error){failure={phase:'tick',message:String(error?.stack||error)};}
// Capture all terminal evidence BEFORE cleanup, including an interrupted tick.
for(const n of state.agents){
 captureInquiry(n);
 for(const e of n.memory.experience)if(e.id>(seen.get(n.id)||0))rows.push({actor:n.id,...structuredClone(e)});
 snapshots.push(snap(n));
}
let sourceAfter=null;
try{sourceAfter=fingerprint();if(sourceAfter!==expectedSource)failure??={phase:'source',message:'Source changed during run; evidence invalid.'};}
catch(error){failure??={phase:'source',message:String(error?.stack||error)};}
let raw=null,saveValid=null;
if(!failure)try{
 saveValid=writeOzarkSave({getItem:key=>key===OZARK_SAVE_KEY?raw:null,setItem:(key,value)=>{if(key===OZARK_SAVE_KEY)raw=value;}},state,geometry);
 if(raw)writeFileSync(tag+'.save.json',raw,{flag:'wx'});
 if(!saveValid)failure={phase:'save',message:'Completed run did not produce a valid save.'};
}catch(error){failure={phase:'save',message:String(error?.stack||error)};}
const result={inquiryTransitions,protocol:'producer-retest-ci-v1',normalizationPaths:NORMALIZED_PATHS,label:'ordinary headless producer-retest pilot; no transfer, reliable survival or learned rule-invention claim',seed,seconds,attemptedSteps:Math.min(step+1,seconds*60),completedSteps,
 status:failure?'partial-or-invalid':'completed',failure,source:expectedSource,sourceAfter,initialStateSha256,rawInitialStateSha256,
 nodeVersion:process.version,platform:process.platform,arch:process.arch,wallSeconds:(performance.now()-start)/1000,saveValid,saveSha256:raw?hash(raw):null,comparableSaveSha256:raw?comparableHash(JSON.parse(raw)):null,
 agents:state.agents.map(n=>({id:n.id,physiology:structuredClone(n.physiology),discovery:structuredClone(n.discovery),stats:structuredClone(n.stats),cycle:cycle?.procedureCycleStatus(n)??null,inquiry:inquiry?.producerInquiryStatus(n)??null})),
 rows,snapshots,choices,activeOccupancySeconds:activeSeconds};
try{writeFileSync(tag+'.json',JSON.stringify(result),{flag:'wx'});}
finally{try{runtime.dispose();}catch(error){writeFileSync(tag+'.cleanup.json',JSON.stringify({message:String(error?.stack||error)}),{flag:'wx'});}}
console.log(JSON.stringify({tag,seed,seconds,status:result.status,completedSteps,wallSeconds:result.wallSeconds,saveValid,choices:choices.length,changed:choices.filter(c=>JSON.stringify(c.before)!==JSON.stringify(c.after)).length}));
if(failure)process.exitCode=1;
