/** Frozen local-only food-balance protocol. No runtime imports this evaluator.
 * node scripts/evaluate-food-balance.mjs --baseline-root PATH --output NEW.json
 * Native fixed steps: controlled 4 game hours; canonical Ozark 6 game hours,
 * seeds 74193 and 74203, both agents. Horizons/seeds are intentionally not CLI tunables.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, open } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..'),STEP=1/60;
const hash=x=>createHash('sha256').update(x).digest('hex');
const sum=(rows,key)=>rows.reduce((v,row)=>v+(row[key]||0),0);
async function fingerprint(root){
  const entries={};
  async function walk(dir){for(const item of (await readdir(resolve(root,dir),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const name=`${dir}/${item.name}`;if(item.isDirectory())await walk(name);else if(item.name.endsWith('.js'))entries[name]=hash(await readFile(resolve(root,name)));}}
  await walk('src');for(const file of ['package.json','package-lock.json'])entries[file]=hash(await readFile(resolve(root,file)));
  return {sha256:hash(JSON.stringify(entries)),files:entries};
}
function comparableState(value){const copy=structuredClone(value);for(const n of copy.agents||[]){delete n.physiology.satietyHours;for(const key of ['nourishment','feelings'])delete n[key];}delete copy.npc;return copy;}
async function run(job){
  const source=await fingerprint(job.root);assert.equal(source.sha256,job.source);
  const names=['config','npc-state','environment','ecology','npc','biology','discovery','interoception','npc-memory','world','population','ozark-world-geometry','ozark-save','ozark-agent-world'];
  const api=Object.fromEntries(await Promise.all(names.map(async name=>[name,await import(pathToFileURL(resolve(job.root,`src/${name}.js`)).href)])));
  assert.equal(api.config.CONFIG.fixedStep,STEP);assert.equal(api.config.CONFIG.dayRealSeconds,3600);
  const {bodySignals}=api.interoception,{requestNpcAction,tickNpc,observeNpc}=api.npc;
  let state,runtime=null,sourceId=null,scheduledStage=0,nextDecision=0;
  const assistance={initialBodyFixture:null,initialPositionFixture:null,scheduledActions:[],suppressedDecisions:[]};
  if(job.kind==='ordinary'){
    const geometry=api['ozark-world-geometry'].createOzarkWorldGeometry();state=api['ozark-save'].createOzarkState(geometry);
    for(const n of state.agents){assert.deepEqual(n.position,geometry.agentSpawns[n.id]);n.seed=job.seed;n.rng=job.seed;assert.equal(n.inventory.items.length,0);assert.equal(n.discovery.techniques.length,0);api['ozark-agent-world'].bindOzarkWorldAgent(n,geometry,state);}
    runtime=new api.population.PopulationRuntime(state,{cardinal:false});
  }else{
    const n=api['npc-state'].createNpc({id:'aster',seed:job.seed,mode:'discovery'}),environment=api.environment.createEnvironment(job.seed,{mode:'discovery'});
    const plant=environment.ecology.plants.find(p=>p.kind==='apple_tree'&&p.quantity>0);assert.ok(plant);sourceId=plant.id;
    n.position=[{x:plant.position.x+45,y:plant.position.y},{x:plant.position.x-45,y:plant.position.y}].find(p=>api.world.canStand(p.x,p.y,'valley'));assert.ok(n.position);
    n.physiology.availableEnergyKcal=700;n.physiology.hoursSinceMeal=2;if(Object.hasOwn(n.physiology,'satietyHours'))n.physiology.satietyHours=4;
    api.biology.projectPhysiology(n);observeNpc(n,environment);state={agents:[n],environment,elapsed:0};
    assistance.initialBodyFixture={availableEnergyKcal:700,hoursSinceMeal:2,candidateSatietyHours:4};assistance.initialPositionFixture={sourceId,position:{...n.position},sourceQuantity:plant.quantity};
  }
  const initialStateSha256=hash(JSON.stringify(state)),matchedPhysicalStartSha256=hash(JSON.stringify(comparableState(state)));
  const snapshot=n=>{const f=n.physiology;return {at:n.elapsed,totals:structuredClone(f.totals),reservesKcal:f.availableEnergyKcal+f.storedEnergyKcal,availableEnergyKcal:f.availableEnergyKcal,storedEnergyKcal:f.storedEnergyKcal,pendingKcal:sum(f.stomach,'remainingKcal'),gutMassGrams:sum(f.stomach,'remainingMassGrams'),gutInputs:f.stomach.length,health:f.health,condition:f.condition,fatigue:f.fatigue,sleepPressure:f.sleepPressure,foodbar:n.nourishment,satietyHours:f.satietyHours??null,body:bodySignals(n),assistance:structuredClone(f.outsideAssistance),rescues:n.stats.rescues,collapses:n.stats.collapses,position:{...n.position}};};
  const records=new Map(state.agents.map(n=>[n.id,{id:n.id,opening:snapshot(n),hourly:[],events:[],feedback:[],activeSeconds:{},digestionSeconds:{},hungerSeconds:{},lastEventId:0,materials:{}}]));
  const openingRemoved=state.environment.ecology.ledger.humanRemovedKcal,openingExternal=state.environment.ecology.ledger.externalKcal||0;
  function collect(n){
    const r=records.get(n.id),body=bodySignals(n),activity=n.physiology.sleep.state==='sleeping'?'sleeping':n.active?.request?.type||'idle';
    r.activeSeconds[activity]=(r.activeSeconds[activity]||0)+STEP;r.digestionSeconds[body.digestion]=(r.digestionSeconds[body.digestion]||0)+STEP;r.hungerSeconds[body.hunger]=(r.hungerSeconds[body.hunger]||0)+STEP;
    for(const event of n.memory.experience){if(event.id<=r.lastEventId)continue;r.lastEventId=event.id;
      if(event.type==='condition'&&event.details.code==='DISCOVERY_EFFECT')r.feedback.push(structuredClone(event.details.feedback));
      if(event.type!=='action')continue;
      const action=event.details.action||{},result=event.details.result||{};
      r.events.push({at:event.at,id:event.id,action:structuredClone(action),result:structuredClone(result)});
      if(result.ok&&['pull','grasp','catch'].includes(action.type)){const id=result.materialId||action.targetId,item=api.ecology.lookupEcologyObject(state.environment.ecology,id);if(item&&Number.isFinite(item.massGrams)&&!r.materials[id])r.materials[id]={sampleCount:0,ingestedKcal:0,massGrams:0,ingestionIds:[],missingPhysicalRows:0,firstHeldMassGrams:item.massGrams,firstHeldKcal:item.energyKcal,firstHeldAt:event.at};}
      if(action.type==='sample'&&result.ok){const item=n.physiology.stomach.find(v=>v.id===result.ingestionId);const material=r.materials[action.targetId]??={sampleCount:0,ingestedKcal:0,massGrams:0,ingestionIds:[],missingPhysicalRows:0};material.sampleCount++;material.ingestionIds.push(result.ingestionId);if(item){material.ingestedKcal+=item.originalKcal;material.massGrams+=item.originalMassGrams;}else material.missingPhysicalRows++;}
    }
  }
  const started=Date.now(),steps=job.kind==='ordinary'?54000:36000;
  try{for(let step=1;step<=steps;step++){
    if(runtime){state.elapsed+=STEP;runtime.tick(STEP);}else{
      const n=state.agents[0],e=state.environment;state.elapsed+=STEP;api.environment.tickEnvironment(e,STEP);api.ecology.tickEcology(e.ecology,STEP,e,[n]);tickNpc(n,STEP,e);
      api.discovery.processDiscoveryFeedback(n,{recordEffect:effect=>api['npc-memory'].recordEvent(n,'condition',{code:'DISCOVERY_EFFECT',feedback:effect})});
      if(step%60===0)observeNpc(n,e);
      if(!n.active&&n.lifecycle==='AWAKE'&&n.elapsed>=nextDecision){
        let action,scheduled=false;
        if(scheduledStage===0){action={type:'pull',targetId:sourceId};scheduledStage=1;scheduled=true;}
        else if(scheduledStage===1){assert.ok(n.inventory.items[0],'Scheduled physical acquisition did not succeed');action={type:'sample',targetId:n.inventory.items[0]};scheduledStage=2;scheduled=true;}
        else{const decision=api.discovery.discoveryDecision(n);action=decision.action;
          const allowed=action.type==='sample'&&n.inventory.items.includes(action.targetId)||action.type==='pull'&&action.targetId===sourceId||['wait','rest','sleep','drink','fill_flask'].includes(action.type);
          if(!allowed){assistance.suppressedDecisions.push({at:n.elapsed,action:structuredClone(action),reason:decision.reason});action=null;}
        }
        if(action){const result=requestNpcAction(n,action,e);if(scheduled)assistance.scheduledActions.push({at:n.elapsed,action:structuredClone(action),result:structuredClone(result)});}
        nextDecision=n.elapsed+.65;
      }
    }
    for(const n of state.agents){collect(n);if(step%9000===0)records.get(n.id).hourly.push(snapshot(n));}
  }}finally{runtime?.dispose();}
  const agents=state.agents.map(n=>{const r=records.get(n.id);delete r.lastEventId;const closing=snapshot(n),start=r.opening,delta=Object.fromEntries(Object.keys(closing.totals).map(k=>[k,closing.totals[k]-start.totals[k]]));
    const residual=start.reservesKcal+start.pendingKcal+delta.ingestedKcal-closing.reservesKcal-closing.pendingKcal-delta.metabolizedKcal-delta.discardedKcal;
    const twoHoursAgo=r.hourly.at(-3)||start,lateAbsorbed=closing.totals.absorbedKcal-twoHoursAgo.totals.absorbedKcal,lateSpent=closing.totals.metabolizedKcal-twoHoursAgo.totals.metabolizedKcal;
    return {...r,closing,delta,reserveChangeKcal:closing.reservesKcal-start.reservesKcal,energyDebtKcal:delta.metabolizedKcal-delta.absorbedKcal,absorbedToSpent:delta.absorbedKcal/delta.metabolizedKcal,lastTwoHoursAbsorbedToSpent:lateAbsorbed/lateSpent,energyResidualKcal:residual,checks:{energyConserved:Math.abs(residual)<1e-6,noPhysicalAssistance:closing.assistance.count===start.assistance.count&&closing.assistance.energyKcal===start.assistance.energyKcal&&closing.assistance.waterMl===start.assistance.waterMl&&closing.rescues===start.rescues,materialReceiptsComplete:Object.values(r.materials).every(m=>m.missingPhysicalRows===0&&new Set(m.ingestionIds).size===m.sampleCount),materialIntakeBounded:Object.values(r.materials).filter(m=>m.sampleCount).every(m=>Number.isFinite(m.firstHeldMassGrams)&&Number.isFinite(m.firstHeldKcal)&&m.massGrams<=m.firstHeldMassGrams+1e-6&&m.ingestedKcal<=m.firstHeldKcal+1e-6)}};});
  const removed=state.environment.ecology.ledger.humanRemovedKcal-openingRemoved,ingested=sum(agents.map(a=>a.delta),'ingestedKcal');
  const checks={finiteEcologyTransfer:Math.abs(removed-ingested)<1e-6,noExternalEcologyEnergy:(state.environment.ecology.ledger.externalKcal||0)===openingExternal,unchangedSource:(await fingerprint(job.root)).sha256===source.sha256};
  return {kind:job.kind,arm:job.arm,seed:job.seed,seconds:steps*STEP,gameHours:steps*STEP/150,initialStateSha256,matchedPhysicalStartSha256,sourceSha256:source.sha256,assistance,agents,checks,removedKcal:removed,wallSeconds:(Date.now()-started)/1000};
}
if(!isMainThread){try{parentPort.postMessage({result:await run(workerData)});}catch(error){parentPort.postMessage({error:error.stack||String(error)});}}
else{
  const options={baselineRoot:null,output:null};for(let i=2;i<process.argv.length;i+=2){const k=process.argv[i],v=process.argv[i+1];assert.ok(v);if(k==='--baseline-root')options.baselineRoot=resolve(v);else if(k==='--output')options.output=resolve(v);else throw Error(`Unknown ${k}`);}assert.ok(options.baselineRoot&&options.output);
  const output=await open(options.output,'wx');const candidateSource=await fingerprint(ROOT),baselineSource=await fingerprint(options.baselineRoot);
  const report={schemaVersion:1,status:'running',startedAt:new Date().toISOString(),options,evaluatorSha256:hash(await readFile(fileURLToPath(import.meta.url))),protocolSha256:hash(await readFile(resolve(ROOT,'docs/food-balance/PROTOCOL.md'))),candidateSource,baselineSource,trials:[],failures:[],comparisons:[],limitations:['Controlled valley trial explicitly changes initial body and position, schedules first pull/taste, and suppresses travel/other-source actions; it is not autonomous foraging.','No added food, calories, known techniques or fabricated feedback. Suppressed decisions and scheduling assistance are separate from physical energy/water assistance.','Ordinary Ozark trials preserve canonical world seed/spawns and vary only both actor RNG streams. No Cardinal, food, body, position, or knowledge assistance.','A satisfaction display is not energy adequacy; appetite outcomes are reported separately from calorie-budget gates.','Fixed seeds and horizons are prospective; failed cases remain failures and are not retuned. Headless native simulation is not desktop UI or laptop performance verification.']};
  const persist=async()=>{await output.truncate(0);await output.write(JSON.stringify(report,null,2)+'\n',0,'utf8');};await persist();
  const scenarios=[{kind:'controlled',seed:74193},{kind:'ordinary',seed:74193},{kind:'ordinary',seed:74203}];
  for(const scenario of scenarios)for(const arm of ['baseline','candidate']){
    const job={...scenario,arm,root:arm==='baseline'?options.baselineRoot:ROOT,source:(arm==='baseline'?baselineSource:candidateSource).sha256};
    try{const result=await new Promise((res,rej)=>{const worker=new Worker(new URL(import.meta.url),{workerData:job});let received=false;worker.on('message',m=>{received=true;if(m.error)rej(Error(m.error));else res(m.result);});worker.on('error',rej);worker.on('exit',code=>{if(!received)rej(Error(`Worker exited ${code} without result`));});});report.trials.push(result);console.log(`${scenario.kind} ${scenario.seed} ${arm}: ${result.agents.map(a=>`${a.id} ${(a.absorbedToSpent*100).toFixed(1)}% absorbed/spent`).join(', ')}`);}catch(error){report.failures.push({...scenario,arm,error:error.stack||String(error)});}await persist();
  }
  for(const scenario of scenarios){const baseline=report.trials.find(t=>t.kind===scenario.kind&&t.seed===scenario.seed&&t.arm==='baseline'),candidate=report.trials.find(t=>t.kind===scenario.kind&&t.seed===scenario.seed&&t.arm==='candidate');if(!baseline||!candidate)continue;
    const comparison={...scenario,matchedPhysicalStart:baseline.matchedPhysicalStartSha256===candidate.matchedPhysicalStartSha256,agents:[]};
    for(const c of candidate.agents){const b=baseline.agents.find(a=>a.id===c.id);comparison.agents.push({id:c.id,energyDebtDeltaKcal:c.energyDebtKcal-b.energyDebtKcal,reserveLossDeltaKcal:b.reserveChangeKcal-c.reserveChangeKcal,absorbedToSpentDelta:c.absorbedToSpent-b.absorbedToSpent,restSecondsDelta:(c.activeSeconds.rest||0)-(b.activeSeconds.rest||0),sleepSecondsDelta:(c.activeSeconds.sleeping||0)-(b.activeSeconds.sleeping||0),checks:{energyDebtNotWorse:c.energyDebtKcal<=b.energyDebtKcal+1e-6,absorbedToSpentNotWorse:c.absorbedToSpent+1e-9>=b.absorbedToSpent,healthNotWorse:c.closing.health+1e-6>=b.closing.health,collapsesNotWorse:c.closing.collapses<=b.closing.collapses,...(scenario.kind==='controlled'?{lateEnergyBalance:c.lastTwoHoursAbsorbedToSpent>=1}: {})},reviewFlags:[...((c.activeSeconds.rest||0)<(b.activeSeconds.rest||0)?['less actual rest: inspect need and recovery']:[]),...((c.activeSeconds.sleeping||0)<(b.activeSeconds.sleeping||0)?['less actual sleep: inspect need and recovery']:[]),...(c.delta.ingestedKcal+1e-6<b.delta.ingestedKcal?['less actual intake']:[])]});}
    const aggregate=rows=>({absorbed:sum(rows.map(a=>a.delta),'absorbedKcal'),spent:sum(rows.map(a=>a.delta),'metabolizedKcal'),reserveChange:sum(rows,'reserveChangeKcal'),collapses:sum(rows.map(a=>({collapses:a.closing.collapses-a.opening.collapses})),'collapses')});
    const b=aggregate(baseline.agents),c=aggregate(candidate.agents);comparison.aggregate={baseline:b,candidate:c,checks:{absorbedToSpentNotWorse:c.absorbed/c.spent+1e-9>=b.absorbed/b.spent,reserveLossNotWorse:c.reserveChange+1e-6>=b.reserveChange,collapsesNotWorse:c.collapses<=b.collapses}};
    report.comparisons.push(comparison);
  }
  if((await fingerprint(ROOT)).sha256!==candidateSource.sha256||(await fingerprint(options.baselineRoot)).sha256!==baselineSource.sha256||hash(await readFile(fileURLToPath(import.meta.url)))!==report.evaluatorSha256)report.failures.push({error:'Sources or evaluator changed during protocol.'});
  const all=values=>Object.values(values).every(Boolean);report.status=!report.failures.length&&report.trials.length===6&&report.trials.every(t=>all(t.checks)&&t.agents.every(a=>all(a.checks)))&&report.comparisons.every(c=>c.matchedPhysicalStart&&all(c.aggregate.checks)&&(c.kind!=='controlled'||c.agents.every(a=>a.checks.lateEnergyBalance&&a.checks.energyDebtNotWorse)))?'completed':'failed';report.individualReviewRequired=report.comparisons.some(c=>c.agents.some(a=>!all(a.checks)||a.reviewFlags.length));report.completedAt=new Date().toISOString();await persist();await output.close();if(report.status==='failed')process.exitCode=1;console.log(`Saved ${report.status} protocol to ${options.output}`);
}
