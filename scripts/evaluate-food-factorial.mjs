/** Preregistered diagnostic only; see docs/food-balance/FACTORIAL-PROTOCOL.md.
 * node scripts/evaluate-food-factorial.mjs --output /tmp/NEW-report.json
 * No horizons, seeds, or overlay choices are tunable here. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, open } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..'), STEP=1/60, SEED=74193;
const ORIGINAL='/tmp/food-balance-protocol-v2.json';
const ORIGINAL_SHA='fa2718a3d3ba585e4a8b68a31446cf8fde72c4af6abc2c2fa20e7510a8755716';
const PROTOCOL=resolve(ROOT,'docs/food-balance/FACTORIAL-PROTOCOL.md');
const ROOTS={baseline:'/tmp/aincrad-food-baseline',combined:'/tmp/aincrad-food-v2',satietyOnly:'/tmp/aincrad-food-satiety-only-v2',careOnly:'/tmp/aincrad-food-care-only-v2'};
const hash=x=>createHash('sha256').update(x).digest('hex');
const sum=(rows,key)=>rows.reduce((v,row)=>v+(row[key]||0),0);
const copy=x=>structuredClone(x);
async function fingerprint(root){
  const files={};
  async function walk(dir){for(const entry of (await readdir(resolve(root,dir),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const name=`${dir}/${entry.name}`;if(entry.isDirectory())await walk(name);else if(entry.name.endsWith('.js'))files[name]=hash(await readFile(resolve(root,name)));}}
  await walk('src');for(const name of ['package.json','package-lock.json'])files[name]=hash(await readFile(resolve(root,name)));
  return {sha256:hash(JSON.stringify(files)),files};
}
function comparableState(state){const value=copy(state);for(const n of value.agents){delete n.physiology.satietyHours;delete n.nourishment;delete n.feelings;}delete value.npc;return value;}
function completedAction(event){return {at:event.at,id:event.id,action:copy(event.details.action||{}),result:copy(event.details.result||{})};}
function firstDifference(a,b,project=x=>x){for(let i=0;i<Math.max(a.length,b.length);i++)if(JSON.stringify(project(a[i]))!==JSON.stringify(project(b[i])))return {ordinal:i+1,left:a[i]??null,right:b[i]??null};return null;}
async function run(job){
  assert.equal((await fingerprint(job.root)).sha256,job.source.sha256);
  const names=['config','ozark-world-geometry','ozark-save','ozark-agent-world','population','interoception'];
  const api=Object.fromEntries(await Promise.all(names.map(async name=>[name,await import(pathToFileURL(resolve(job.root,`src/${name}.js`)).href)])));
  assert.equal(api.config.CONFIG.fixedStep,STEP);assert.equal(api.config.CONFIG.dayRealSeconds,3600);
  const geometry=api['ozark-world-geometry'].createOzarkWorldGeometry(),state=api['ozark-save'].createOzarkState(geometry);
  for(const n of state.agents){assert.deepEqual(n.position,geometry.agentSpawns[n.id]);n.seed=SEED;n.rng=SEED;assert.equal(n.inventory.items.length,0);assert.equal(n.discovery.techniques.length,0);api['ozark-agent-world'].bindOzarkWorldAgent(n,geometry,state);}
  const runtime=new api.population.PopulationRuntime(state,{cardinal:false});
  const initialStateSha256=hash(JSON.stringify(state)),matchedPhysicalStartSha256=hash(JSON.stringify(comparableState(state)));
  const snapshot=n=>{const f=n.physiology;return {at:n.elapsed,totals:copy(f.totals),reservesKcal:f.availableEnergyKcal+f.storedEnergyKcal,availableEnergyKcal:f.availableEnergyKcal,storedEnergyKcal:f.storedEnergyKcal,pendingKcal:sum(f.stomach,'remainingKcal'),gutMassGrams:sum(f.stomach,'remainingMassGrams'),gutInputs:f.stomach.length,health:f.health,condition:f.condition,fatigue:f.fatigue,sleepPressure:f.sleepPressure,stamina:f.stamina,waterDeficitMl:f.waterDeficitMl,clockHours:f.clockHours,hoursSinceMeal:f.hoursSinceMeal,sleep:copy(f.sleep),foodbar:n.nourishment,satietyHours:f.satietyHours??null,body:api.interoception.bodySignals(n),assistance:copy(f.outsideAssistance),rescues:n.stats.rescues,collapses:n.stats.collapses,position:copy(n.position)};};
  const records=new Map(state.agents.map(n=>[n.id,{id:n.id,opening:snapshot(n),hourly:[],events:[],feedback:[],otherEvents:[],decisions:[],activeSeconds:{},digestionSeconds:{},hungerSeconds:{},lastEventId:0,inertLoggingChecks:0}]));
  let globalOrdinal=0;
  for(const n of state.agents){const controller=runtime.controller(n.id),perform=controller.perform;
    controller.perform=function(raw){
      const before=JSON.stringify(n),r=records.get(n.id),latest=n.memory.experience.filter(e=>e.type==='decision').at(-1);
      const held=n.inventory.items.map(id=>({id,positiveIngestionIds:[...new Set(n.discovery.effects.filter(effect=>effect.objectId===id&&effect.effect==='sustained'&&effect.source==='experienced'&&n.discovery.experiments.some(sample=>sample.primitive==='sample'&&sample.ok&&sample.targetId===id&&sample.actionId===effect.actionId&&sample.ingestionId===effect.ingestionId&&effect.at>=sample.at&&n.memory.experience.some(event=>event.type==='action'&&event.id===sample.actionId&&event.details.action?.type==='sample'&&event.details.action?.targetId===id&&event.details.result?.ok&&event.details.result?.ingestionId===sample.ingestionId))).map(effect=>effect.ingestionId))],pendingAt:n.discovery.samplesPending[id]??null,adverse:n.discovery.effects.filter(e=>e.objectId===id&&e.effect==='discomfort').map(e=>({id:e.id,at:e.at,ingestionId:e.ingestionId,actionId:e.actionId}))}));
      const row={actor:n.id,actorOrdinal:r.decisions.length+1,globalOrdinal:++globalOrdinal,at:n.elapsed,action:copy(raw),reason:n.decision,latestDecisionReceipt:latest?{id:latest.id,at:latest.at,details:copy(latest.details)}:null,reasonFreshness:latest&&latest.at===n.elapsed&&latest.details.summary===n.decision?'same-tick-matching-receipt':'stale-or-unattributed',body:api.interoception.bodySignals(n),privateBody:snapshot(n),scene:n.scene,position:copy(n.position),rng:n.rng,held,pending:copy(n.discovery.samplesPending),adverseEffects:n.discovery.effects.filter(e=>e.effect==='discomfort').map(e=>({id:e.id,objectId:e.objectId,at:e.at,ingestionId:e.ingestionId})),techniques:n.discovery.techniques.map(t=>({id:t.id,sourceId:t.sourceId,confidence:t.confidence,successes:t.successes,failures:t.failures})),rememberedWaterSources:Object.values(n.memory.sources).map(s=>({id:s.id,available:s.available,retryAfter:s.retryAfter,observedAt:s.observedAt})),rememberedFoodSources:n.discovery.techniques.map(t=>({id:t.sourceId,observation:copy(n.discovery.observations[t.sourceId]??null),lastAcquisitionTrials:Object.entries(n.discovery.trials||{}).filter(([key])=>key===`${t.sourceId}|pull`||key===`${t.sourceId}|grasp`).map(([key,value])=>({key,...copy(value)}))}))};
      r.decisions.push(row);assert.equal(JSON.stringify(n),before,'Read-only decision logging changed actor/RNG/memory/run');r.inertLoggingChecks++;
      return perform.call(this,raw);
    };
  }
  const openingRemoved=state.environment.ecology.ledger.humanRemovedKcal,openingExternal=state.environment.ecology.ledger.externalKcal||0,started=Date.now();
  function collect(n){const r=records.get(n.id),body=api.interoception.bodySignals(n),active=n.physiology.sleep.state==='sleeping'?'sleeping':n.active?.request?.type||'idle';r.activeSeconds[active]=(r.activeSeconds[active]||0)+STEP;r.digestionSeconds[body.digestion]=(r.digestionSeconds[body.digestion]||0)+STEP;r.hungerSeconds[body.hunger]=(r.hungerSeconds[body.hunger]||0)+STEP;
    for(const event of n.memory.experience){if(event.id<=r.lastEventId)continue;r.lastEventId=event.id;if(event.type==='action')r.events.push(completedAction(event));else if(event.type==='condition'&&event.details.code==='DISCOVERY_EFFECT')r.feedback.push(copy(event.details.feedback));else if(event.type!=='decision')r.otherEvents.push(copy(event));}
  }
  try{for(let step=1;step<=job.seconds*60;step++){state.elapsed+=STEP;runtime.tick(STEP);for(const n of state.agents){collect(n);if(step%9000===0){const r=records.get(n.id);r.hourly.push({...snapshot(n),activeSeconds:copy(r.activeSeconds),digestionSeconds:copy(r.digestionSeconds),hungerSeconds:copy(r.hungerSeconds)});}}}}finally{runtime.dispose();}
  const agents=state.agents.map(n=>{const r=records.get(n.id);delete r.lastEventId;const closing=snapshot(n),delta=Object.fromEntries(Object.keys(closing.totals).map(k=>[k,closing.totals[k]-r.opening.totals[k]])),residual=r.opening.reservesKcal+r.opening.pendingKcal+delta.ingestedKcal-closing.reservesKcal-closing.pendingKcal-delta.metabolizedKcal-delta.discardedKcal;
    return {...r,closing,delta,reserveChangeKcal:closing.reservesKcal-r.opening.reservesKcal,energyResidualKcal:residual,absorbedToSpent:delta.absorbedKcal/delta.metabolizedKcal,outcomes:r.events.reduce((out,e)=>(out[e.result.code]=(out[e.result.code]||0)+1,out),{}),collisionEvents:r.events.filter(e=>/BLOCK|COLLISION|STUCK|CONTACT/.test(e.result.code||'')||e.result.movement?.progress==='negligible'),sharingEvents:r.events.filter(e=>/share|offer|give|accept|ask_food/.test(e.action.type||'')||e.result.code?.includes('TRANSFER')),checks:{energyConserved:Math.abs(residual)<1e-6,noAssistance:JSON.stringify(closing.assistance)===JSON.stringify(r.opening.assistance)&&closing.rescues===r.opening.rescues,inertLogging:r.inertLoggingChecks===r.decisions.length}};});
  const removed=state.environment.ecology.ledger.humanRemovedKcal-openingRemoved;
  return {arm:job.arm,seconds:job.seconds,seed:SEED,sourceSha256:job.source.sha256,initialStateSha256,matchedPhysicalStartSha256,agents,checks:{finiteTransfer:Math.abs(removed-sum(agents.map(a=>a.delta),'ingestedKcal'))<1e-6,noExternalEcologyEnergy:(state.environment.ecology.ledger.externalKcal||0)===openingExternal,unchangedSource:(await fingerprint(job.root)).sha256===job.source.sha256},wallSeconds:(Date.now()-started)/1000};
}
if(!isMainThread){try{parentPort.postMessage({result:await run(workerData)});}catch(error){parentPort.postMessage({error:error.stack||String(error)});}}
else{
  assert.equal(process.argv.length,4,'Only --output NEW-PATH is accepted.');assert.equal(process.argv[2],'--output');const outputPath=resolve(process.argv[3]);assert.notEqual(outputPath,ORIGINAL);
  const originalBytes=await readFile(ORIGINAL);assert.equal(hash(originalBytes),ORIGINAL_SHA);const original=JSON.parse(originalBytes);
  const sources=Object.fromEntries(await Promise.all(Object.entries(ROOTS).map(async([key,root])=>[key,await fingerprint(root)])));
  assert.equal(sources.baseline.sha256,original.baselineSource.sha256);assert.equal(sources.combined.sha256,original.candidateSource.sha256);
  assert.deepEqual(sources.satietyOnly.files,{...sources.combined.files,'src/discovery.js':sources.baseline.files['src/discovery.js']});
  assert.deepEqual(sources.careOnly.files,{...sources.baseline.files,'src/discovery.js':sources.combined.files['src/discovery.js']});
  const frozen={originalSha256:ORIGINAL_SHA,evaluatorSha256:hash(await readFile(fileURLToPath(import.meta.url))),protocolSha256:hash(await readFile(PROTOCOL)),roots:ROOTS,sources};
  const output=await open(outputPath,'wx'),report={schemaVersion:1,purpose:'one-seed factorial diagnosis, not acceptance',status:'running',startedAt:new Date().toISOString(),frozen,initialComparisonExclusions:['human physiology.satietyHours','derived actor nourishment','derived actor feelings','redundant state.npc alias'],trials:[],failures:[],prefixChecks:[],contrasts:[],firstDivergences:[]};
  const persist=async()=>{await output.truncate(0);await output.write(JSON.stringify(report,null,2)+'\n',0,'utf8');};await persist();
  const jobs=[{arm:'baseline',seconds:400},{arm:'combined',seconds:400},{arm:'satietyOnly',seconds:900},{arm:'careOnly',seconds:900}].map(job=>({...job,root:ROOTS[job.arm],source:sources[job.arm]}));
  // Sequential batches of two bound concurrency; each worker has isolated module state.
  for(let index=0;index<jobs.length;index+=2){await Promise.all(jobs.slice(index,index+2).map(async job=>{
    try{const trial=await new Promise((res,rej)=>{const worker=new Worker(new URL(import.meta.url),{workerData:job});let response=null,failure=null;worker.on('message',message=>{response=message;});worker.on('error',error=>{failure=error;});worker.on('exit',code=>{if(failure)rej(failure);else if(response?.error)rej(Error(response.error));else if(code===0&&response?.result)res(response.result);else rej(Error(`Worker exited ${code} without result`));});});report.trials.push(trial);console.log(`${job.arm}: ${trial.agents.map(a=>`${a.id} ${(100*a.absorbedToSpent).toFixed(2)}% absorbed/spent`).join(', ')}`);}catch(error){report.failures.push({arm:job.arm,error:error.stack||String(error)});}
  }));await persist();}
  const prior=arm=>original.trials.find(t=>t.kind==='ordinary'&&t.seed===SEED&&t.arm===(arm==='combined'?'candidate':'baseline'));
  for(const arm of ['baseline','combined']){const replay=report.trials.find(t=>t.arm===arm),old=prior(arm);if(!replay)continue;
    for(const a of replay.agents){const expected=old.agents.find(n=>n.id===a.id).events.filter(e=>e.at<=replay.agents[0].closing.at),difference=firstDifference(expected,a.events);report.prefixChecks.push({arm,actor:a.id,boundarySimulationSeconds:replay.agents[0].closing.at,expectedActions:expected.length,actualActions:a.events.length,equal:difference===null,difference,initialStateEqual:old.initialStateSha256===replay.initialStateSha256,physicalStartEqual:old.matchedPhysicalStartSha256===replay.matchedPhysicalStartSha256});}
  }
  const cells={baseline:prior('baseline'),combined:prior('combined'),satietyOnly:report.trials.find(t=>t.arm==='satietyOnly'),careOnly:report.trials.find(t=>t.arm==='careOnly')};
  if(Object.values(cells).every(Boolean))for(const id of ['aster','mira']){
    const actors=Object.fromEntries(Object.entries(cells).map(([arm,trial])=>[arm,trial.agents.find(a=>a.id===id)]));
    for(let hour=1;hour<=6;hour++){const metrics=Object.fromEntries(Object.entries(actors).map(([arm,a])=>{const s=a.hourly[hour-1],o=a.opening;return [arm,{absorbedKcal:s.totals.absorbedKcal-o.totals.absorbedKcal,spentKcal:s.totals.metabolizedKcal-o.totals.metabolizedKcal,ingestedKcal:s.totals.ingestedKcal-o.totals.ingestedKcal,reserveChangeKcal:s.reservesKcal-o.reservesKcal,pendingKcal:s.pendingKcal,health:s.health,condition:s.condition,foodbar:s.foodbar,body:s.body,assistance:s.assistance,restSeconds:s.activeSeconds?.rest??null,sleepSeconds:s.activeSeconds?.sleeping??null}];}));
      const contrasts={};for(const key of ['absorbedKcal','spentKcal','ingestedKcal','reserveChangeKcal'])contrasts[key]={satietyMinusBaseline:metrics.satietyOnly[key]-metrics.baseline[key],careMinusBaseline:metrics.careOnly[key]-metrics.baseline[key],combinedMinusBaseline:metrics.combined[key]-metrics.baseline[key],interaction:metrics.combined[key]-metrics.satietyOnly[key]-metrics.careOnly[key]+metrics.baseline[key]};
      report.contrasts.push({actor:id,hour,metrics,contrasts});
    }
  }
  for(const [left,right] of [['baseline','combined'],['baseline','satietyOnly'],['baseline','careOnly'],['combined','satietyOnly'],['combined','careOnly'],['satietyOnly','careOnly']]){const l=report.trials.find(t=>t.arm===left),r=report.trials.find(t=>t.arm===right);if(!l||!r)continue;const horizon=Math.min(l.seconds,r.seconds);
    const globalTrace=trial=>trial.agents.flatMap(a=>a.decisions).filter(d=>d.at<=horizon).sort((a,b)=>a.globalOrdinal-b.globalOrdinal);report.firstDivergences.push({left,right,scope:'global requested order',horizon,requested:firstDifference(globalTrace(l),globalTrace(r),d=>d?{actor:d.actor,at:d.at,action:d.action}:null)});
    for(const id of ['aster','mira']){const a=l.agents.find(n=>n.id===id),b=r.agents.find(n=>n.id===id);report.firstDivergences.push({left,right,actor:id,horizon,requested:firstDifference(a.decisions.filter(d=>d.at<=horizon),b.decisions.filter(d=>d.at<=horizon),d=>d?{at:d.at,action:d.action}:null),completed:firstDifference(a.events.filter(e=>e.at<=horizon),b.events.filter(e=>e.at<=horizon),e=>e?{at:e.at,action:e.action,ok:e.result.ok,code:e.result.code}:null)});}
  }
  const expectedPhysical=prior('baseline').matchedPhysicalStartSha256;report.physicalStartsMatch=report.trials.every(t=>t.matchedPhysicalStartSha256===expectedPhysical);
  for(const [arm,root]of Object.entries(ROOTS))if((await fingerprint(root)).sha256!==sources[arm].sha256)report.failures.push({arm,error:'Frozen source changed'});
  if(hash(await readFile(ORIGINAL))!==ORIGINAL_SHA||hash(await readFile(PROTOCOL))!==frozen.protocolSha256||hash(await readFile(fileURLToPath(import.meta.url)))!==frozen.evaluatorSha256)report.failures.push({error:'Original report, protocol or evaluator changed'});
  const all=x=>Object.values(x).every(Boolean);report.status=!report.failures.length&&report.trials.length===4&&report.physicalStartsMatch&&report.prefixChecks.length===4&&report.prefixChecks.every(p=>p.equal&&p.initialStateEqual&&p.physicalStartEqual)&&report.trials.every(t=>all(t.checks)&&t.agents.every(a=>all(a.checks)))?'completed-diagnostic':'failed-diagnostic';
  report.limitations=['One seed; interacting agents do not identify an actor-local causal mechanism.','Existing full baseline/combined are reused, not rerun; only their 400-second prefixes receive new decision instrumentation.','Old full reports lack hourly rest/sleep durations: null is missing evidence, not zero. New arms retain hourly durations; old full-run durations remain in original report.','No acceptance claim or after-result tuning. All per-agent factorial cells and failures are retained.','Private numeric bodies are developer-only evidence and are never injected into policy observations.'];report.completedAt=new Date().toISOString();await persist();await output.close();if(report.status==='failed-diagnostic')process.exitCode=1;console.log(`Saved ${report.status} to ${outputPath}`);
}
