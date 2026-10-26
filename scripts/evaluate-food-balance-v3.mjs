/** Frozen local-only food-balance protocol. No runtime imports this evaluator.
 * node scripts/evaluate-food-balance-v3.mjs --phase controlled --baseline-root PATH --output NEW.json
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
function comparableState(value){const copy=structuredClone(value);for(const n of copy.agents||[]){delete n.physiology.satietyHours;for(const key of ['nourishment','feelings'])delete n[key];for(const event of n.memory.experience)if(event.type==='observation'&&event.at===0)delete event.details.nourishment;}delete copy.npc;return copy;}
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
  const initialState=structuredClone(state);if(job.initialOnly)return {initialState,initialStateSha256,matchedPhysicalStartSha256};
  const decisions=[];
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
        else{const decision=api.discovery.discoveryDecision(n);action=decision.action;decisions.push({at:n.elapsed,action:structuredClone(action),reason:decision.reason,need:decision.need,body:bodySignals(n),pending:structuredClone(n.discovery.samplesPending),held:[...n.inventory.items],sourceObservation:structuredClone(n.discovery.observations[sourceId]),physiology:{availableEnergyKcal:n.physiology.availableEnergyKcal,gutMassGrams:sum(n.physiology.stomach,'remainingMassGrams')}});
          const allowed=action.type==='sample'&&n.inventory.items.includes(action.targetId)||action.type==='pull'&&action.targetId===sourceId||['wait','rest','sleep','drink','fill_flask'].includes(action.type);
          if(!allowed){assistance.suppressedDecisions.push({at:n.elapsed,action:structuredClone(action),reason:decision.reason});action=null;}
        }
        if(action){const result=requestNpcAction(n,action,e);if(scheduled)assistance.scheduledActions.push({at:n.elapsed,action:structuredClone(action),result:structuredClone(result)});}
        nextDecision=n.elapsed+.65;
      }
    }
    for(const n of state.agents){collect(n);if(step%9000===0)records.get(n.id).hourly.push({...snapshot(n),activeSeconds:structuredClone(records.get(n.id).activeSeconds),digestionSeconds:structuredClone(records.get(n.id).digestionSeconds),hungerSeconds:structuredClone(records.get(n.id).hungerSeconds)});}
  }}finally{runtime?.dispose();}
  const agents=state.agents.map(n=>{const r=records.get(n.id);delete r.lastEventId;const closing=snapshot(n),start=r.opening,delta=Object.fromEntries(Object.keys(closing.totals).map(k=>[k,closing.totals[k]-start.totals[k]]));
    const residual=start.reservesKcal+start.pendingKcal+delta.ingestedKcal-closing.reservesKcal-closing.pendingKcal-delta.metabolizedKcal-delta.discardedKcal;
    const twoHoursAgo=r.hourly.at(-3)||start,lateAbsorbed=closing.totals.absorbedKcal-twoHoursAgo.totals.absorbedKcal,lateSpent=closing.totals.metabolizedKcal-twoHoursAgo.totals.metabolizedKcal;
    return {...r,closing,delta,lastTwoHoursSwallowedKcal:closing.totals.ingestedKcal-twoHoursAgo.totals.ingestedKcal,lastTwoHoursAbsorbedKcal:lateAbsorbed,lastTwoHoursSpentKcal:lateSpent,reserveChangeKcal:closing.reservesKcal-start.reservesKcal,energyDebtKcal:delta.metabolizedKcal-delta.absorbedKcal,absorbedToSpent:delta.absorbedKcal/delta.metabolizedKcal,lastTwoHoursAbsorbedToSpent:lateAbsorbed/lateSpent,energyResidualKcal:residual,checks:{energyConserved:Math.abs(residual)<1e-6,noPhysicalAssistance:closing.assistance.count===start.assistance.count&&closing.assistance.energyKcal===start.assistance.energyKcal&&closing.assistance.waterMl===start.assistance.waterMl&&closing.rescues===start.rescues,materialReceiptsComplete:Object.values(r.materials).every(m=>m.missingPhysicalRows===0&&new Set(m.ingestionIds).size===m.sampleCount),materialIntakeBounded:Object.values(r.materials).filter(m=>m.sampleCount).every(m=>Number.isFinite(m.firstHeldMassGrams)&&Number.isFinite(m.firstHeldKcal)&&m.massGrams<=m.firstHeldMassGrams+1e-6&&m.ingestedKcal<=m.firstHeldKcal+1e-6)}};});
  const removed=state.environment.ecology.ledger.humanRemovedKcal-openingRemoved,ingested=sum(agents.map(a=>a.delta),'ingestedKcal');
  const checks={finiteEcologyTransfer:Math.abs(removed-ingested)<1e-6,noExternalEcologyEnergy:(state.environment.ecology.ledger.externalKcal||0)===openingExternal,unchangedSource:(await fingerprint(job.root)).sha256===source.sha256};
  return {kind:job.kind,arm:job.arm,seed:job.seed,seconds:steps*STEP,gameHours:steps*STEP/150,initialState,decisions,initialStateSha256,matchedPhysicalStartSha256,sourceSha256:source.sha256,assistance,agents,checks,removedKcal:removed,wallSeconds:(Date.now()-started)/1000};
}
if(!isMainThread){try{parentPort.postMessage({result:await run(workerData)});}catch(error){parentPort.postMessage({error:error.stack||String(error)});}}
else{
  const options={};for(let i=2;i<process.argv.length;i+=2){const k=process.argv[i],v=process.argv[i+1];assert.ok(v);options[k.slice(2)]=v;}
  assert.ok(['controlled','ordinary'].includes(options.phase));assert.ok(options.output&&options['baseline-root']);
  const priorPath='/tmp/food-balance-protocol-v2.json',priorBytes=await readFile(priorPath);
  assert.equal(hash(priorBytes),'fa2718a3d3ba585e4a8b68a31446cf8fde72c4af6abc2c2fa20e7510a8755716');const prior=JSON.parse(priorBytes);
  const source=await fingerprint(ROOT),baselineRoot=resolve(options['baseline-root']),baselineSource=await fingerprint(baselineRoot);
  assert.equal(baselineSource.sha256,prior.baselineSource.sha256);
  if(options.phase==='ordinary'){
    assert.ok(options['controlled-report']);const control=JSON.parse(await readFile(options['controlled-report']));
    assert.equal(control.status,'controlled-passed');assert.equal(control.candidateSource.sha256,source.sha256);
  }
  const output=await open(resolve(options.output),'wx');
  const report={schemaVersion:3,status:'running',phase:options.phase,startedAt:new Date().toISOString(),candidateSource:source,baselineSource,priorSha256:hash(priorBytes),protocolSha256:hash(await readFile(resolve(ROOT,'docs/food-balance/V3-PROTOCOL.md'))),evaluatorSha256:hash(await readFile(fileURLToPath(import.meta.url))),trials:[],comparisons:[],failures:[]};
  assert.equal(report.protocolSha256,'420ed0b1c122ce0cd7f6f519cc2f2f969bcb6b34b424dade8273288b669ef964');
  const persist=async()=>{await output.truncate(0);await output.write(JSON.stringify(report,null,2)+'\n',0,'utf8');};await persist();
  const workerRun=job=>new Promise((res,rej)=>{const w=new Worker(new URL(import.meta.url),{workerData:job});let message;w.on('message',m=>{message=m;});w.on('error',rej);w.on('exit',code=>{if(code||!message)rej(Error(`worker exit ${code}`));else if(message.error)rej(Error(message.error));else res(message.result);});});
  const scenarios=options.phase==='controlled'?[{kind:'controlled',seed:74193}]:[{kind:'ordinary',seed:74193},{kind:'ordinary',seed:74203}];
  for(const scenario of scenarios){
    try{
      const opening=await workerRun({...scenario,arm:'baseline',root:baselineRoot,source:baselineSource.sha256,initialOnly:true});
      const main=prior.trials.find(t=>t.kind===scenario.kind&&t.seed===scenario.seed&&t.arm==='baseline');
      assert.equal(opening.initialStateSha256,main.initialStateSha256,'reconstructed main start must match original');
      const candidate=await workerRun({...scenario,arm:'candidate-v3',root:ROOT,source:source.sha256});report.trials.push(candidate);
      const comparison={...scenario,baselineInitialState:opening.initialState,matchedPhysicalStart:opening.matchedPhysicalStartSha256===candidate.matchedPhysicalStartSha256,agents:[]};
      for(const c of candidate.agents){const b=main.agents.find(a=>a.id===c.id),v2=prior.trials.find(t=>t.kind===scenario.kind&&t.seed===scenario.seed&&t.arm==='candidate').agents.find(a=>a.id===c.id);comparison.agents.push({id:c.id,baseline:b,v2,energyDebtDeltaKcal:c.energyDebtKcal-b.energyDebtKcal,restSecondsDelta:(c.activeSeconds.rest||0)-(b.activeSeconds.rest||0),checks:{energyDebtNotWorse:c.energyDebtKcal<=b.energyDebtKcal+1e-6,lateEnergyBalance:c.lastTwoHoursAbsorbedToSpent>=1},reviewFlags:[...(c.delta.ingestedKcal<b.delta.ingestedKcal-1e-6?['less intake']:[]),...(c.energyDebtKcal>b.energyDebtKcal+1e-6?['more energy debt']:[]),...((c.activeSeconds.rest||0)<(b.activeSeconds.rest||0)?['less rest']:[]),...((c.activeSeconds.sleeping||0)<(b.activeSeconds.sleeping||0)?['less sleep']:[]),...(c.closing.health<b.closing.health-1e-6?['lower health']:[]),...(c.closing.condition<b.closing.condition-1e-6?['lower condition']:[]),...(c.closing.collapses>b.closing.collapses?['more collapses']:[])]});}
      report.comparisons.push(comparison);console.log(`${scenario.kind} ${scenario.seed}: ${candidate.agents.map(a=>`${a.id} late ratio ${a.lastTwoHoursAbsorbedToSpent}`).join(', ')}`);
    }catch(error){report.failures.push({...scenario,error:error.stack||String(error)});}await persist();
  }
  const all=object=>Object.values(object).every(Boolean);
  assert.equal((await fingerprint(ROOT)).sha256,source.sha256);assert.equal(hash(await readFile(fileURLToPath(import.meta.url))),report.evaluatorSha256);
  assert.equal(hash(await readFile(priorPath)),report.priorSha256);
  assert.equal((await fingerprint(baselineRoot)).sha256,baselineSource.sha256);
  assert.equal(hash(await readFile(resolve(ROOT,'docs/food-balance/V3-PROTOCOL.md'))),report.protocolSha256);
  const valid=!report.failures.length&&report.trials.length===scenarios.length&&report.trials.every(t=>all(t.checks)&&t.agents.every(a=>all(a.checks)))&&report.comparisons.every(c=>c.matchedPhysicalStart);
  const budget=report.comparisons.every(c=>c.agents.every(a=>all(a.checks)));
  report.status=!valid?'failed':options.phase==='controlled'?(budget?'controlled-passed':'controlled-failed'):'ordinary-diagnostics-complete';
  report.individualReviewRequired=report.comparisons.some(c=>c.agents.some(a=>a.reviewFlags.length));report.completedAt=new Date().toISOString();await persist();await output.close();
  if(!valid||options.phase==='controlled'&&!budget)process.exitCode=1;console.log(report.status);
}
