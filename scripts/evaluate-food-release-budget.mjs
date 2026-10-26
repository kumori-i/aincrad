/** Current release known-food budget. The historical v4 worker below is unchanged.
 * Explicit frozen inputs; controlled seed74193 and600simulationseconds only.
 * Run --help for the technical input contract. No runtime imports this evaluator.
 */
import assert from 'node:assert/strict';
import { BASELINE_IDENTITY, loadReleaseBaseline } from './food-release-baseline.mjs';
import { createHash } from 'node:crypto';
import { readFile, readdir, open } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..'),STEP=1/60;
const hash=x=>createHash('sha256').update(x).digest('hex');
const sum=(rows,key)=>rows.reduce((v,row)=>v+(row[key]||0),0);
function movementOutcomes(agent){const events=agent.events.filter(e=>['move','swim','climb'].includes(e.action?.type)),byCode={};for(const e of events)byCode[e.result.code]=(byCode[e.result.code]||0)+1;return {byCode,routeBlocked:byCode.ROUTE_BLOCKED||0,timeouts:byCode.ACTION_TIMEOUT||0,strongResistance:events.filter(e=>e.result.movement?.resistance==='strong').length,scope:'Completed movement/collision-related outcomes; individual physical contacts are not separately counted.'};}
function regressionFlags(c,b){return [...(c.delta.ingestedKcal<b.delta.ingestedKcal-1e-6?['less intake']:[]),...(c.energyDebtKcal>b.energyDebtKcal+1e-6?['more energy debt']:[]),...((c.activeSeconds.rest||0)<(b.activeSeconds.rest||0)?['less rest']:[]),...((c.activeSeconds.sleeping||0)<(b.activeSeconds.sleeping||0)?['less sleep']:[]),...(c.closing.health<b.closing.health-1e-6?['lower health']:[]),...(c.closing.condition<b.closing.condition-1e-6?['lower condition']:[]),...(c.closing.collapses>b.closing.collapses?['more collapses']:[]),...(movementOutcomes(c).routeBlocked>movementOutcomes(b).routeBlocked?['more blocked movement outcomes']:[])];}

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
    return {...r,closing,delta,movementOutcomes:movementOutcomes(r),lastTwoHoursSwallowedKcal:closing.totals.ingestedKcal-twoHoursAgo.totals.ingestedKcal,lastTwoHoursAbsorbedKcal:lateAbsorbed,lastTwoHoursSpentKcal:lateSpent,reserveChangeKcal:closing.reservesKcal-start.reservesKcal,energyDebtKcal:delta.metabolizedKcal-delta.absorbedKcal,absorbedToSpent:delta.absorbedKcal/delta.metabolizedKcal,lastTwoHoursAbsorbedToSpent:lateAbsorbed/lateSpent,energyResidualKcal:residual,checks:{energyConserved:Math.abs(residual)<1e-6,noPhysicalAssistance:closing.assistance.count===start.assistance.count&&closing.assistance.energyKcal===start.assistance.energyKcal&&closing.assistance.waterMl===start.assistance.waterMl&&closing.rescues===start.rescues,materialReceiptsComplete:Object.values(r.materials).every(m=>m.missingPhysicalRows===0&&new Set(m.ingestionIds).size===m.sampleCount),materialIntakeBounded:Object.values(r.materials).filter(m=>m.sampleCount).every(m=>Number.isFinite(m.firstHeldMassGrams)&&Number.isFinite(m.firstHeldKcal)&&m.massGrams<=m.firstHeldMassGrams+1e-6&&m.ingestedKcal<=m.firstHeldKcal+1e-6)}};});
  const removed=state.environment.ecology.ledger.humanRemovedKcal-openingRemoved,ingested=sum(agents.map(a=>a.delta),'ingestedKcal');
  const checks={finiteEcologyTransfer:Math.abs(removed-ingested)<1e-6,noExternalEcologyEnergy:(state.environment.ecology.ledger.externalKcal||0)===openingExternal,unchangedSource:(await fingerprint(job.root)).sha256===source.sha256};
  return {kind:job.kind,arm:job.arm,seed:job.seed,seconds:steps*STEP,gameHours:steps*STEP/150,initialState,decisions,initialStateSha256,matchedPhysicalStartSha256,sourceSha256:source.sha256,assistance,agents,checks,removedKcal:removed,wallSeconds:(Date.now()-started)/1000};
}

export const RELEASE_BUDGET_IDENTITY=Object.freeze({schemaVersion:5,arm:'combined-release',runtimeSha256:'d68d8146a91467f80f62fd2e5645df3e5c91578a648f8206b27ebc4e869f092d',protocolSha256:'33ffd1557e25330a3bcf2cfbdda86ea9ea95d8a4b20b2a5133aaaeae11809928',baselineRuntimeSha256:'ebaef37d61a50d994a0dbcb7e6e5a1c2a064c6c7e952a6de0dc4337e3c98b788',priorSha256:'fa2718a3d3ba585e4a8b68a31446cf8fde72c4af6abc2c2fa20e7510a8755716'});
const PROTOCOL=resolve(ROOT,'docs/food-system/ACCEPTANCE.md');
const CAPABILITY=resolve(ROOT,'scripts/evaluate-food-combined-capability.mjs');
export function parseReleaseBudgetOptions(args){
  const required=['manifest','manifest-sha256','protocol-sha256','expected-runtime','output'],options={};
  assert.equal(args.length%2,0,'Expected option/value pairs');
  for(let i=0;i<args.length;i+=2){const key=args[i].replace(/^--/,'');assert.ok(args[i].startsWith('--')&&required.includes(key)&&!Object.hasOwn(options,key),'Unknown or duplicate option');assert.ok(args[i+1]);options[key]=args[i+1];}
  for(const key of required)assert.ok(options[key],`Missing --${key}`);
  for(const key of ['manifest-sha256','protocol-sha256','expected-runtime'])assert.match(options[key],/^[a-f0-9]{64}$/);
  return options;
}
export function validateReleaseBudgetManifest(manifest,{source,baselineSource,commit,tree,protocolSha256,evaluatorSha256,capabilitySha256}){
  assert.match(commit,/^[a-f0-9]{40}$/);assert.match(tree,/^[a-f0-9]{40}$/);
  assert.equal(manifest.commit,commit);assert.equal(manifest.tree,tree);assert.deepEqual(manifest.runtime,source);assert.equal(source.sha256,RELEASE_BUDGET_IDENTITY.runtimeSha256);
  assert.equal(protocolSha256,RELEASE_BUDGET_IDENTITY.protocolSha256);assert.equal(manifest.protocolSha256,protocolSha256);
  assert.equal(manifest.evaluatorSha256,evaluatorSha256);assert.deepEqual(manifest.releaseEvaluators,{budgetSha256:evaluatorSha256,capabilitySha256});
  assert.equal(baselineSource.sha256,RELEASE_BUDGET_IDENTITY.baselineRuntimeSha256);
  assert.deepEqual(manifest.baselineIdentity,BASELINE_IDENTITY);
  return true;
}
function identity(){const git=(...args)=>execFileSync('git',args,{cwd:ROOT,encoding:'utf8'}).trim();return {commit:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}'),status:git('status','--porcelain','--untracked-files=normal')};}
async function main(){
  if(process.argv.length===3&&process.argv[2]==='--help'){console.log('Usage: node scripts/evaluate-food-release-budget.mjs --manifest FILE --manifest-sha256 SHA256 --protocol-sha256 SHA256 --expected-runtime SHA256 --output NEW_FILE\nManifest: {commit,tree,runtime:{sha256,files},protocolSha256,evaluatorSha256,releaseEvaluators:{budgetSha256,capabilitySha256},baselineIdentity:{runtimeSha256,reportSha256,fixtureSha256,auditSha256}}. The full baseline evidence and extraction audit are included in tests/fixtures/food-release/; no configurable seed, horizon or ordinary phase.');return;}
  const options=parseReleaseBudgetOptions(process.argv.slice(2)),manifestPath=resolve(options.manifest),outputPath=resolve(options.output);
  assert.ok(![manifestPath,PROTOCOL,CAPABILITY,fileURLToPath(import.meta.url)].includes(outputPath),'Output must be new, not an input');
  const [manifestBytes,protocolBytes,evaluatorBytes,capabilityBytes]=await Promise.all([readFile(manifestPath),readFile(PROTOCOL),readFile(fileURLToPath(import.meta.url)),readFile(CAPABILITY)]);
  const packaged=await loadReleaseBaseline(),baselineSource=packaged.fixture.baselineSource;
  assert.equal(hash(manifestBytes),options['manifest-sha256']);assert.equal(hash(protocolBytes),options['protocol-sha256']);
  const manifest=JSON.parse(manifestBytes),source=await fingerprint(ROOT),id=identity();
  assert.equal(id.status,'','Source must be clean and committed');assert.equal(source.sha256,options['expected-runtime']);
  validateReleaseBudgetManifest(manifest,{source,baselineSource,...id,protocolSha256:hash(protocolBytes),evaluatorSha256:hash(evaluatorBytes),capabilitySha256:hash(capabilityBytes)});
  const frozen={...manifest,manifestSha256:hash(manifestBytes),baselineIdentity:BASELINE_IDENTITY};
  const output=await open(outputPath,'wx'),report={schemaVersion:5,status:'running',phase:'controlled',startedAt:new Date().toISOString(),sourceIdentity:{commit:id.commit,tree:id.tree},frozen,candidateSource:source,baselineSource,priorSha256:BASELINE_IDENTITY.reportSha256,baselineFixtureSha256:BASELINE_IDENTITY.fixtureSha256,baselineEvidence:'Preserved measured baseline run; reconstructed raw start hash-verified against original record. No fresh600-second baseline replay.',protocolSha256:hash(protocolBytes),evaluatorSha256:hash(evaluatorBytes),trials:[],comparisons:[],failures:[],limitations:['Controlled fixed-seed known-source opportunity with disclosed body/position setup and first pull/taste schedule, not autonomous food discovery.','Travel and unrelated targets are suppressed and recorded, not evidence of safe exploration.','Finite source depletion and pending digestion remain; satisfaction is not energy adequacy or survival.','This release report is distinct from historical standalone protocols and does not retroactively certify their results.']};
  const persist=async()=>{await output.truncate(0);await output.write(JSON.stringify(report,null,2)+'\n',0,'utf8');};await persist();
  const workerRun=job=>new Promise((res,rej)=>{const w=new Worker(new URL(import.meta.url),{workerData:job});let message;w.on('message',m=>{message=m;});w.on('error',rej);w.on('exit',code=>{if(code||!message)rej(Error(`worker exit ${code}`));else if(message.error)rej(Error(message.error));else res(message.result);});});
  const scenario={kind:'controlled',seed:74193};
  try{
    const main=packaged.fixture.baselineTrial;
    const opening={initialState:packaged.fixture.initialState,initialStateSha256:main.initialStateSha256,matchedPhysicalStartSha256:packaged.normalizedStartSha256};
    assert.equal(hash(JSON.stringify(opening.initialState)),main.initialStateSha256);
    assert.equal(hash(JSON.stringify(comparableState(opening.initialState))),opening.matchedPhysicalStartSha256);
    const candidate=await workerRun({...scenario,arm:'combined-release',root:ROOT,source:source.sha256});report.trials.push(candidate);
    const comparison={...scenario,baselineInitialState:opening.initialState,matchedPhysicalStart:opening.matchedPhysicalStartSha256===candidate.matchedPhysicalStartSha256,agents:[]};
    for(const c of candidate.agents){const b=main.agents.find(a=>a.id===c.id);assert.ok(b);comparison.agents.push({id:c.id,baseline:b,energyDebtDeltaKcal:c.energyDebtKcal-b.energyDebtKcal,restSecondsDelta:(c.activeSeconds.rest||0)-(b.activeSeconds.rest||0),checks:{energyDebtNotWorse:c.energyDebtKcal<=b.energyDebtKcal+1e-6,lateEnergyBalance:c.lastTwoHoursAbsorbedToSpent>=1},reviewFlagsAgainst:'main',reviewFlags:regressionFlags(c,b),movementOutcomes:{main:movementOutcomes(b),candidate:movementOutcomes(c)}});}
    report.comparisons.push(comparison);
  }catch(error){report.failures.push({...scenario,error:error.stack||String(error)});}
  try{
    assert.deepEqual(identity(),id);assert.deepEqual(await fingerprint(ROOT),source);assert.deepEqual(await loadReleaseBaseline(),packaged);
    assert.equal(hash(await readFile(manifestPath)),frozen.manifestSha256);
    assert.equal(hash(await readFile(PROTOCOL)),report.protocolSha256);assert.equal(hash(await readFile(fileURLToPath(import.meta.url))),report.evaluatorSha256);assert.equal(hash(await readFile(CAPABILITY)),manifest.releaseEvaluators.capabilitySha256);
  }catch(error){report.failures.push({error:error.stack||String(error)});}
  const all=object=>Object.values(object).every(v=>v===true);
  const valid=!report.failures.length&&report.trials.length===1&&report.trials.every(t=>t.kind==='controlled'&&t.seed===74193&&t.arm==='combined-release'&&t.seconds===600&&t.gameHours===4&&t.sourceSha256===source.sha256&&['finiteEcologyTransfer','noExternalEcologyEnergy','unchangedSource'].every(k=>t.checks[k]===true)&&t.agents.length===1&&t.agents.every(a=>a.id==='aster'&&['energyConserved','noPhysicalAssistance','materialReceiptsComplete','materialIntakeBounded'].every(k=>a.checks[k]===true)))&&report.comparisons.length===1&&report.comparisons.every(c=>c.matchedPhysicalStart&&c.agents.length===1&&c.agents[0].id==='aster');
  const budget=report.comparisons.every(c=>c.agents.every(a=>all(a.checks)));
  report.status=!valid?'failed':budget?'controlled-passed':'controlled-failed';report.individualReviewRequired=report.comparisons.some(c=>c.agents.some(a=>a.reviewFlags.length));report.completedAt=new Date().toISOString();await persist();await output.close();
  if(!valid||!budget)process.exitCode=1;console.log(`Saved ${report.status} to ${outputPath}`);
}
if(!isMainThread){try{parentPort.postMessage({result:await run(workerData)});}catch(error){parentPort.postMessage({error:error.stack||String(error)});}}
else if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
