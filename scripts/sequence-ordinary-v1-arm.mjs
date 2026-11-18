// Dedicated continuous arm. No local invocation, retry or reload path.
import assert from 'node:assert/strict';
import {writeFileSync,readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {SEQUENCE_ORDINARY_V1 as P} from './sequence-ordinary-v1-protocol.mjs';
import {createSequenceScopeCollector,createSequenceStatusInterner} from './sequence-ordinary-v1-collector.mjs';
import {validateSequenceArm,harnessHash} from './sequence-ordinary-v1-evidence.mjs';
import {createEvidenceJournal,createReceiptCollector} from './choice-diagnostic-v2-evidence.mjs';
import {sourceFingerprint} from './producer-retest-ci-source.mjs';
import {sha256,comparableHash,NORMALIZED_PATHS} from './producer-retest-ci-namespace.mjs';
const a=validateSequenceArm(process.argv.slice(2)),root=resolve(a.root),harnessRoot=resolve(a.harnessRoot),url=pathToFileURL(root+'/');
assert.equal(sourceFingerprint(root),a.source);assert.equal(harnessHash(harnessRoot),a.harness);
writeFileSync(a.tag+'.started.json',JSON.stringify({protocol:P,mode:a.mode,commit:process.env.GITHUB_SHA,runId:process.env.GITHUB_RUN_ID,at:new Date().toISOString()}),{flag:'wx'});
const journal=createEvidenceJournal(a.tag+'.events.jsonl');let runtime;
try{
 const {CONFIG}=await import(new URL('src/config.js',url));assert.equal(CONFIG.fixedStep,P.fixedStep);
 const {createOzarkWorldGeometry}=await import(new URL('src/ozark-world-geometry.js',url));
 const {createOzarkState,writeOzarkSave,OZARK_SAVE_KEY}=await import(new URL('src/ozark-save.js',url));
 const {bindOzarkWorldAgent}=await import(new URL('src/ozark-agent-world.js',url));
 const {PopulationRuntime}=await import(new URL('src/population.js',url));
 const {bodySignals}=await import(new URL('src/interoception.js',url));
 const cycle=await import(new URL('src/procedure-cycle.js',url)),inquiry=await import(new URL('src/producer-inquiry.js',url));
 const hasSequence=existsSync(resolve(root,'src/connected-sequence.js'));assert.equal(hasSequence,a.mode==='candidate');
 const sequence=hasSequence?await import(new URL('src/connected-sequence.js',url)):null;
 const geometry=createOzarkWorldGeometry(),state=createOzarkState(geometry,{communicationSeed:a.seed});
 for(const [i,n]of state.agents.entries()){n.rng=a.seed+i;bindOzarkWorldAgent(n,geometry,state);}
 const initialRaw=JSON.stringify(state),initialSha256=sha256(initialRaw),initialComparableSha256=comparableHash(state);
 writeFileSync(a.tag+'.initial.json',initialRaw,{flag:'wx'});if(a.initial)assert.equal(initialComparableSha256,a.initial);
 const collector=createSequenceScopeCollector(state,{steps:P.steps,fixedStep:P.fixedStep,describe:bodySignals});
 const receipts=new Map(state.agents.map(n=>[n,createReceiptCollector(n)]));
 const rows=[],snapshots=[],choices=[],inquiryTransitions=[],sequenceTransitions=[],sequenceStatuses=[],epochTransitions=[],activeOccupancySeconds={},sequenceReadCounts=Object.fromEntries(state.agents.map(n=>[n.id,0]));
 const internStatus=createSequenceStatusInterner();
 const lastChoices=new WeakMap(),lastInquiry=new WeakMap(),lastSequence=new WeakMap();
 const emit=(kind,payload,into)=>{journal.append(kind,payload);into.push(payload);};
 const selected=n=>({run:structuredClone(n.discovery.run??null),runSourceId:n.discovery.techniques.find(t=>t.id===n.discovery.run?.techniqueId)?.sourceId??null});
 const snapshot=n=>({actor:n.id,at:n.elapsed,position:{...n.position},lifecycle:n.lifecycle,epoch:n.epoch,body:bodySignals(n),physiology:{availableEnergyKcal:n.physiology.availableEnergyKcal,storedEnergyKcal:n.physiology.storedEnergyKcal,waterDeficitMl:n.physiology.waterDeficitMl,health:n.physiology.health,condition:n.physiology.condition,stamina:n.physiology.stamina,fatigue:n.physiology.fatigue,sleepPressure:n.physiology.sleepPressure,totals:{...n.physiology.totals},outsideAssistance:{...n.physiology.outsideAssistance}},stats:{...n.stats},rng:n.rng,...selected(n),cycle:cycle.procedureCycleStatus(n),active:n.active?structuredClone(n.active.request):null});
 let completedSteps=0;
 const capture=(n,force=false)=>{
  for(const e of receipts.get(n)())emit('receipt',{actor:n.id,...e},rows);
  const q=inquiry.producerInquiryStatus(n),key=JSON.stringify(q);
  if(key!==lastInquiry.get(n)){lastInquiry.set(n,key);emit('inquiry',{actor:n.id,at:n.elapsed,status:structuredClone(q),activeRequest:n.active?structuredClone(n.active.request):null},inquiryTransitions);}
  if(sequence){sequenceReadCounts[n.id]++;const status=sequence.connectedSequenceStatus(n),key=JSON.stringify([n.epoch,status]);if(force||key!==lastSequence.get(n)||status?.question?.phase==='working'){
   const interned=internStatus(status);if(interned.entry)emit('sequence-status',interned.entry,sequenceStatuses);
   lastSequence.set(n,key);emit('sequence',{actor:n.id,worldId:state.worldLineage.instanceId,incarnation:state.worldLineage.agents.find(x=>x.agentId===n.id).serial,at:n.elapsed,tick:completedSteps,epoch:n.epoch,receiptSerial:n.memory.nextId-1,statusHash:interned.hash,activeStartedAt:n.active?.startedAt??null,activePaidSeconds:n.active?.worked??null,body:bodySignals(n),activeRequest:n.active?structuredClone(n.active.request):null},sequenceTransitions);
  }}
  const status=cycle.procedureCycleStatus(n);
  if(status?.choice&&status.choice!==lastChoices.get(n)){lastChoices.set(n,status.choice);emit('choice',{actor:n.id,...selected(n),activeRequest:n.active?structuredClone(n.active.request):null,...structuredClone(status.choice),methods:status.methods,pending:status.pending,intent:status.intent},choices);}
 };
 for(const n of state.agents){activeOccupancySeconds[n.id]={};capture(n);emit('snapshot',snapshot(n),snapshots);}
 runtime=new PopulationRuntime(state,{cardinal:false});let failure=null,coverage=null;const start=performance.now();
 try{
  for(let step=1;step<=P.steps;step++){
   state.elapsed+=CONFIG.fixedStep;runtime.tick(CONFIG.fixedStep);completedSteps++;
   try{for(const row of collector.capture(state,step))emit('epoch',row,epochTransitions);}catch(error){journal.append('coverage-failure',{completedSteps,message:String(error.message)});throw error;}
   for(const n of state.agents){
    capture(n);const action=n.physiology.sleep.state==='sleeping'?'sleeping':n.active?.request?.type||'idle';
    activeOccupancySeconds[n.id][action]=(activeOccupancySeconds[n.id][action]||0)+CONFIG.fixedStep;
    if(step%60===0)emit('snapshot',snapshot(n),snapshots);
   }
   if(step%60===0)journal.append('progress',{completedSteps});
  }
  coverage=collector.finish();
 }catch(error){failure={phase:'tick-or-observation',message:String(error?.stack||error)};}
 // Terminal capture is not counted as another completed tick or resumed coverage.
 for(const n of state.agents){try{capture(n,true);emit('snapshot',snapshot(n),snapshots);}catch(error){failure??={phase:'terminal',message:String(error?.stack||error)};}}
 const sourceAfter=sourceFingerprint(root);if(sourceAfter!==a.source||harnessHash(harnessRoot)!==a.harness)failure??={phase:'source',message:'Source changed'};
 let saveRaw=null,saveValid=false;
 if(!failure){saveValid=writeOzarkSave({getItem:k=>k===OZARK_SAVE_KEY?saveRaw:null,setItem:(k,v)=>{if(k===OZARK_SAVE_KEY)saveRaw=v;}},state,geometry);if(saveRaw)writeFileSync(a.tag+'.save.json',saveRaw,{flag:'wx'});if(!saveValid)failure={phase:'save',message:'Invalid final save'};}
 const status=failure?'partial-or-invalid':'completed';journal.append('terminal',{completedSteps,status});journal.close();
 const result={protocol:P.id,mode:a.mode,pair:a.pair,seed:a.seed,seconds:P.seconds,completedSteps,status,failure,normalizationPaths:NORMALIZED_PATHS,source:a.source,sourceAfter,harnessSha256:a.harness,initialSha256,initialComparableSha256,saveValid,saveSha256:saveRaw?sha256(saveRaw):null,saveComparableSha256:saveRaw?comparableHash(JSON.parse(saveRaw)):null,journalSha256:sha256(readFileSync(a.tag+'.events.jsonl')),coverage,rows,snapshots,choices,inquiryTransitions,sequenceTransitions,sequenceStatuses,epochTransitions,sequenceReadCounts,activeOccupancySeconds,agents:state.agents.map(n=>JSON.parse(JSON.stringify(n))),wallSeconds:(performance.now()-start)/1000,node:process.version,platform:process.platform,arch:process.arch};
 writeFileSync(a.tag+'.json',JSON.stringify(result),{flag:'wx'});console.log(JSON.stringify({mode:a.mode,status,completedSteps,wallSeconds:result.wallSeconds}));if(failure)process.exitCode=1;
}catch(error){writeFileSync(a.tag+'.failed.json',JSON.stringify({message:String(error?.stack||error),retryAllowed:false}),{flag:'wx'});throw error;}
finally{journal.close();if(runtime)try{runtime.dispose();}catch(error){writeFileSync(a.tag+'.cleanup.json',JSON.stringify({message:String(error?.stack||error)}),{flag:'wx'});process.exitCode=1;}}
