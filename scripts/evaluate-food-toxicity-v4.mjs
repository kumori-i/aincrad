/** Fixed, assisted delayed-toxicity comparison; never runtime policy.
 * node scripts/evaluate-food-toxicity-v4.mjs --output /tmp/NEW.json
 * One worker at a time, frozen v3 then v4. Requires the approved controlled result.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, open } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..'),STEP=1/60;
const V3='/tmp/aincrad-food-v3', CONTROL='/tmp/food-v4-controlled.json', ORIGINAL='/tmp/food-balance-protocol-v2.json';
const PREVIOUS='/tmp/food-v3-toxicity-corrected.json', PREVIOUS_SHA='a4ea1345386d189d2d4828ecc087d9834da2675890140bec2bde1a5798ce17ac';
const ORIGINAL_SHA='fa2718a3d3ba585e4a8b68a31446cf8fde72c4af6abc2c2fa20e7510a8755716';
const PROTOCOL=resolve(ROOT,'docs/food-balance/V4-PROTOCOL.md'),ADDENDUM=resolve(ROOT,'docs/food-balance/V3-TOXICITY-ADDENDUM.md');
const EXPECTED={v3:'83f50c39330bfbc1ccb52b3df4e1e5310825b863deebfbfae98d9cbc2748dfa8',protocol:'85b8546f83b50ac2fce2990ba40d471ec660b5850963ce85eb319536eb4bfdf4',addendum:'6eaff22abee45f5d2230e4198e59ba7690aa68ea795865a6b0776f47b722726b'};
const hash=x=>createHash('sha256').update(x).digest('hex'),copy=x=>structuredClone(x);
const sum=(rows,key)=>rows.reduce((v,row)=>v+(row[key]||0),0);
async function fingerprint(root){const files={};async function walk(dir){for(const entry of (await readdir(resolve(root,dir),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const name=`${dir}/${entry.name}`;if(entry.isDirectory())await walk(name);else if(entry.name.endsWith('.js'))files[name]=hash(await readFile(resolve(root,name)));}}await walk('src');for(const name of ['package.json','package-lock.json'])files[name]=hash(await readFile(resolve(root,name)));return {sha256:hash(JSON.stringify(files)),files};}
function differences(a,b,path=''){if(Object.is(a,b))return[];if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return[{path,left:a===undefined?{absent:true}:a,right:b===undefined?{absent:true}:b}];return [...new Set([...Object.keys(a),...Object.keys(b)])].flatMap(key=>differences(a[key],b[key],`${path}/${key}`));}
// Exact independently earned checkpoint comparison: NO projection/cognitive exclusions.
async function run(job){
  assert.equal((await fingerprint(job.root)).sha256,job.source.sha256);
  const names=['config','npc-state','environment','ecology','npc','biology','discovery','npc-memory','interoception'];
  const api=Object.fromEntries(await Promise.all(names.map(async name=>[name,await import(pathToFileURL(resolve(job.root,`src/${name}.js`)).href)])));
  const completion=await import(pathToFileURL(resolve(job.root,'src/discovery-completion.js')).href);
  const caution=job.arm==='v4'?await import(pathToFileURL(resolve(job.root,'src/food-source-caution.js')).href):null;
  assert.equal(api.config.CONFIG.fixedStep,STEP);assert.equal(api.config.CONFIG.dayRealSeconds,3600);
  const n=api['npc-state'].createNpc({id:'aster',mode:'discovery',seed:74193}),e=api.environment.createEnvironment(74193,{mode:'discovery'}),animal=e.ecology.animals[0];assert.ok(animal);
  const assistance={bodyBefore:copy(n.physiology),bodyFixture:{availableEnergyKcal:700,hoursSinceMeal:12,satietyHours:0},positionBefore:copy(n.position),stagedStrikes:[],sourceAging:null,scheduledPaidActions:[],suppressedDecisions:[],boundaryCancellations:[]};
  n.position=copy(animal.position);n.physiology.availableEnergyKcal=700;n.physiology.hoursSinceMeal=12;n.physiology.satietyHours=0;api.biology.projectPhysiology(n);
  for(let i=0;i<4;i++){const result=api.ecology.interactEcologyObject(e.ecology,animal.id,'strike',{actorId:n.id,position:n.position,power:4});assistance.stagedStrikes.push({targetId:animal.id,power:4,result:copy(result)});}
  const sourceId=assistance.stagedStrikes.map(s=>s.result.resultObjectId).find(Boolean),source=api.ecology.lookupEcologyObject(e.ecology,sourceId);assert.ok(source?.kind==='carcass');
  assistance.sourceAging={sourceId,before:{ageHours:source.ageHours,spoiled:source.spoiled,massGrams:source.massGrams,energyKcal:source.energyKcal},ageHours:72,spoiled:true};source.ageHours=72;source.spoiled=true;
  api.npc.observeNpc(n,e);const startingState={n:copy(n),e:copy(e)},opening=copy(n.physiology),openingRemoved=e.ecology.ledger.humanRemovedKcal,openingExternal=e.ecology.ledger.externalKcal;
  const events=[],feedback=[],decisions=[],attempts=[],inputs=new Map(),pieces=new Set(),pieceInitialStocks={},ecologyDecayByPiece={},hourly=[],shortcutActivations=[],cautionOpportunities=[];
  let stage='setup',lastEvent=0,firstPhysiologicalDamage=null,firstDiscomfort=null,setupFailure=null,checkpoint=null,checkpointMassBalance=null,checkpointMismatch=null,exposureFailure=null,completedExposure=false,nextDecision=0;
  const body=()=>{const f=n.physiology;return {at:n.elapsed,totals:copy(f.totals),availableEnergyKcal:f.availableEnergyKcal,storedEnergyKcal:f.storedEnergyKcal,reservesKcal:f.availableEnergyKcal+f.storedEnergyKcal,pendingKcal:sum(f.stomach,'remainingKcal'),gutMassGrams:sum(f.stomach,'remainingMassGrams'),gutInputs:f.stomach.length,health:f.health,condition:f.condition,satietyHours:f.satietyHours,foodbar:n.nourishment,body:api.interoception.bodySignals(n),outsideAssistance:copy(f.outsideAssistance),rescues:n.stats.rescues,collapses:n.stats.collapses,grossToxicHarm:sum([...inputs.values()],'grossHarm')};};
  function trackInputs(rows){for(const item of rows){let row=inputs.get(item.id);if(!row){row={ingestionId:item.id,objectId:item.objectId,actionId:item.actionId,at:item.at,stage,originalMassGrams:item.originalMassGrams,originalKcal:item.originalKcal,toxicity:item.toxicity,digestHours:item.digestHours,grossHarm:0,lastHarm:0};inputs.set(item.id,row);}const delta=item.harm-row.lastHarm;assert.ok(delta>=-1e-10,'Per-input cumulative harm moved backwards');row.grossHarm+=Math.max(0,delta);row.lastHarm=item.harm;if(delta>0&&firstPhysiologicalDamage===null)firstPhysiologicalDamage={at:n.elapsed,ingestionId:item.id,objectId:item.objectId,stage};}}
  function collect(){for(const event of n.memory.experience){if(event.id<=lastEvent)continue;lastEvent=event.id;
    if(event.type==='condition'&&event.details.code==='DISCOVERY_EFFECT'){feedback.push(copy(event.details.feedback));if(event.details.feedback.effect==='discomfort'&&firstDiscomfort===null)firstDiscomfort={at:n.elapsed,receiptAt:event.at,eventId:event.id,feedback:copy(event.details.feedback),stage,ingestedGrams:sum([...inputs.values()].filter(input=>pieces.has(input.objectId)),'originalMassGrams'),ingestedKcal:n.physiology.totals.ingestedKcal,grossHarm:sum([...inputs.values()],'grossHarm')};}
    if(event.type==='action'){events.push({id:event.id,at:event.at,stage,action:copy(event.details.action),result:copy(event.details.result),afterDiscomfort:firstDiscomfort!==null});const action=event.details.action,result=event.details.result;if(action?.type==='pull'&&result?.ok&&result.materialId){pieces.add(result.materialId);const piece=api.ecology.lookupEcologyObject(e.ecology,result.materialId);if(piece)pieceInitialStocks[result.materialId]={massGrams:piece.massGrams,energyKcal:piece.energyKcal,waterMl:piece.waterMl,toxicity:piece.toxicity,spoiled:piece.spoiled,digestHours:piece.digestHours,at:event.at};}}
  }}
  function tick(){const before=[...n.physiology.stomach];api.environment.tickEnvironment(e,STEP);
    // Measure physical piece loss across ecology ONLY, before any NPC swallow.
    const beforeEcology=[...pieces].map(id=>({id,item:api.ecology.lookupEcologyObject(e.ecology,id)})).filter(row=>row.item).map(({id,item})=>({id,massGrams:item.massGrams,energyKcal:item.energyKcal}));
    api.ecology.tickEcology(e.ecology,STEP,e,[n]);
    for(const old of beforeEcology){const now=api.ecology.lookupEcologyObject(e.ecology,old.id),massLoss=old.massGrams-(now?.massGrams||0),energyLoss=old.energyKcal-(now?.energyKcal||0);assert.ok(massLoss>=-1e-9&&energyLoss>=-1e-9,'Held flesh gained stock during ecology');const measured=ecologyDecayByPiece[old.id]??={massGrams:0,energyKcal:0,measuredSteps:0,firstAt:n.elapsed,lastAt:n.elapsed};measured.massGrams+=massLoss;measured.energyKcal+=energyLoss;measured.measuredSteps++;measured.lastAt=n.elapsed+STEP;}
    api.npc.tickNpc(n,STEP,e);
    // References remain live even if digestion removed their rows this step.
    trackInputs(before);trackInputs(n.physiology.stomach);
    api.discovery.processDiscoveryFeedback(n,{recordEffect:effect=>api['npc-memory'].recordEvent(n,'condition',{code:'DISCOVERY_EFFECT',feedback:effect})});collect();
  }
  function request(action,reason,need,scheduled=false){const row={at:n.elapsed,stage,action:copy(action),reason,need,afterDiscomfort:firstDiscomfort!==null,sourceRevised:n.discovery.techniques.some(t=>t.sourceId===sourceId&&t.confidence==='revised'),body:api.interoception.bodySignals(n)};const result=api.npc.requestNpcAction(n,action,e);row.startResult=copy(result);attempts.push(row);if(scheduled)assistance.scheduledPaidActions.push(copy(row));collect();return result;}
  function paid(action){const result=request(action,'Explicit paid setup operation','setup',true);assert.equal(result.code,'ACTION_STARTED');for(let i=0;i<1200&&n.active;i++)tick();assert.equal(n.active,null);assert.equal(n.lastResult.ok,true);}
  const positives=id=>new Set(n.discovery.effects.filter(x=>x.objectId===id&&x.effect==='sustained'&&x.source==='experienced').map(x=>x.ingestionId)).size;
  paid({type:'pull',targetId:sourceId});const firstPiece=n.inventory.items[0];assert.ok(firstPiece);assert.equal(pieceInitialStocks[firstPiece].massGrams,100);
  for(let count=1;count<=2;count++){
    if(firstDiscomfort){setupFailure='Adverse recognition preceded the required two positive outcomes';break;}
    paid({type:'sample',targetId:firstPiece});
    for(let i=0;i<24000&&positives(firstPiece)<count&&!firstDiscomfort;i++)tick();
    if(firstDiscomfort||positives(firstPiece)<count){setupFailure=firstDiscomfort?'Adverse recognition preceded the required two positive outcomes':'Two positive outcomes were not reached within the fixed setup bound';break;}
  }
  const openingBody=body();
  if(!setupFailure){assert.equal(positives(firstPiece),2);assert.ok(n.inventory.items.includes(firstPiece));const remaining=api.ecology.lookupEcologyObject(e.ecology,firstPiece).massGrams,ingested=sum([...inputs.values()].filter(row=>row.objectId===firstPiece),'originalMassGrams'),decayed=ecologyDecayByPiece[firstPiece]?.massGrams||0;checkpointMassBalance={initialMassGrams:pieceInitialStocks[firstPiece].massGrams,actualIngestedMassGrams:ingested,independentlyMeasuredEcologyDecayGrams:decayed,remainingMassGrams:remaining,residualGrams:pieceInitialStocks[firstPiece].massGrams-ingested-decayed-remaining,toleranceGrams:1e-7};assert.ok(remaining>0&&remaining<=40+1e-7);assert.ok(Math.abs(checkpointMassBalance.residualGrams)<=1e-7,'Initial piece minus actual swallowed and independently measured ecology decay must equal remaining');checkpoint={n:copy(n),e:copy(e)};
    const startDiff=differences(job.expectedStartingState,startingState),checkpointDiff=differences(job.expectedCheckpoint,checkpoint);
    if(startDiff.length||checkpointDiff.length)checkpointMismatch={status:'invalid-checkpoint',startDifferences:startDiff,checkpointDifferences:checkpointDiff};
    // STOP BEFORE EXPOSURE on mismatch. Never copy/normalize learned state.
    if(!checkpointMismatch){const start=n.elapsed;stage='feeding';nextDecision=start;
    for(let step=0;step<18000;step++){
      if(!n.active&&n.lifecycle==='AWAKE'&&n.elapsed>=nextDecision){const before=JSON.stringify(n),decision=api.discovery.discoveryDecision(n),action=decision.action;
        // The learner runs exactly once; only subsequent evidence collection is read-only.
        const afterChoice=JSON.stringify(n),pending=n.discovery.experiments.filter(a=>a.primitive==='pull'&&a.targetId===sourceId&&a.materialId&&n.discovery.samplesPending[a.materialId]!==undefined&&n.elapsed-n.discovery.samplesPending[a.materialId]<45).map(a=>({sourceActionId:a.actionId,materialId:a.materialId,pendingAt:n.discovery.samplesPending[a.materialId],held:n.inventory.items.includes(a.materialId),positives:positives(a.materialId),finish:n.discovery.experiments.find(x=>x.targetId===a.materialId&&x.finishedMaterial===true)??null}));
        const witnessed=pending.filter(p=>p.finish&&completion?.witnessedMaterialCompletion(n,p.finish));
        const entry={at:n.elapsed,fromCheckpoint:n.elapsed-start,action:copy(action),reason:decision.reason,need:decision.need,body:api.interoception.bodySignals(n),privateBody:body(),held:[...n.inventory.items],pending:copy(n.discovery.samplesPending),pendingPriorPieces:copy(pending),afterDiscomfort:firstDiscomfort!==null,sourceRevised:n.discovery.techniques.some(t=>t.sourceId===sourceId&&t.confidence==='revised')};
        if(action.type==='pull'&&action.targetId===sourceId&&decision.need==='food'&&pending.length&&witnessed.length&&decision.reason.startsWith('Past sampling of this object')){entry.completionShortcutActivated=true;shortcutActivations.push(copy(entry));}
        entry.cautionedHeldIds=caution?n.inventory.items.filter(id=>caution.experiencedFoodSourceCaution(n,id)):[];
        if(entry.afterDiscomfort&&entry.cautionedHeldIds.length)cautionOpportunities.push({at:n.elapsed,heldIds:[...entry.cautionedHeldIds],chosenAction:copy(action),need:decision.need});
        assert.equal(JSON.stringify(n),afterChoice,'Diagnostic logging changed actor after its one learner call');void before;
        const travel=['move','swim','climb'].includes(action.type),foreign=action.targetId&&action.targetId!==sourceId&&!pieces.has(action.targetId);
        entry.suppressed=!!(travel||foreign);decisions.push(entry);
        if(job.arm==='v4'&&entry.afterDiscomfort&&action.type==='sample'&&pieces.has(action.targetId)){
          exposureFailure={status:'failed-incomplete',at:n.elapsed,choice:copy(entry),reason:'Post-adverse source sample choice; assay aborted before execution, NOT blocked by runtime guard'};
          break;
        }
        if(entry.suppressed)assistance.suppressedDecisions.push({at:n.elapsed,action:copy(action),reason:decision.reason,cause:travel?'travel':'other target'});else request(action,decision.reason,decision.need);
        nextDecision=n.elapsed+.65;
      }
      tick();if((step+1)%60===0)api.npc.observeNpc(n,e);if((step+1)%9000===0)hourly.push({fromCheckpoint:(step+1)*STEP,...body()});
    }
    if(!exposureFailure){assert.ok(Math.abs(n.elapsed-start-300)<1e-6);stage='drain';
    if(n.active&&['sample','pull','grasp','catch','strike'].includes(n.active.request.type)){const active=copy(n.active.request),at=n.elapsed;const canceled=api.npc.cancelNpcAction(n,'TOXICITY_EXPOSURE_BOUNDARY');assistance.boundaryCancellations.push({at,action:active,canceled});collect();}
    for(let step=0;step<54000;step++){tick();if((step+1)%9000===0)hourly.push({fromCheckpoint:300+(step+1)*STEP,...body()});}
    assert.ok(Math.abs(n.elapsed-start-1200)<1e-5);completedExposure=true;
    }
    }
  }
  const closing=body(),allInputs=[...inputs.values()],delta=Object.fromEntries(Object.keys(closing.totals).map(k=>[k,closing.totals[k]-opening.totals[k]]));
  const residual=opening.availableEnergyKcal+opening.storedEnergyKcal+sum(opening.stomach,'remainingKcal')+delta.ingestedKcal-closing.reservesKcal-closing.pendingKcal-delta.metabolizedKcal-delta.discardedKcal;
  const materialBudgets=Object.entries(pieceInitialStocks).map(([id,stock])=>{const swallowed=allInputs.filter(input=>input.objectId===id);return {id,stock,swallowedMassGrams:sum(swallowed,'originalMassGrams'),swallowedKcal:sum(swallowed,'originalKcal'),ingestionIds:swallowed.map(input=>input.ingestionId)};});
  const receipted=allInputs.every(input=>events.some(event=>event.id===input.actionId&&event.at===input.at&&event.result.ok===true&&event.result.ingestionId===input.ingestionId&&(pieces.has(input.objectId)?event.action.type==='sample'&&event.action.targetId===input.objectId:event.action.type==='drink'&&input.originalKcal===0)));
  const postDiscomfortDecisions=decisions.filter(d=>d.afterDiscomfort),careRepeats=postDiscomfortDecisions.filter(d=>d.need==='food'&&(d.action.type==='pull'&&d.action.targetId===sourceId||d.action.type==='sample'&&pieces.has(d.action.targetId))),genericFeedingAfterDiscomfort=postDiscomfortDecisions.filter(d=>d.need!=='food'&&['sample','pull'].includes(d.action.type));
  const postHarmSourceSampleChoices=postDiscomfortDecisions.filter(d=>d.action.type==='sample'&&pieces.has(d.action.targetId));
  return {arm:job.arm,checkpointMismatch,exposureFailure,completedExposure,cautionOpportunities,postHarmSourceSampleChoices,sourceSha256:job.source.sha256,setupStatus:checkpointMismatch?'invalid-checkpoint':setupFailure?'ineligible':'eligible',setupFailure,startingState,checkpoint,checkpointMassBalance,ecologyDecayByPiece,assistance,sourceId,firstPiece,openingBody,closing,delta,events,feedback,decisions,attempts,hourly,inputs:allInputs,pieceInitialStocks,materialBudgets,firstPhysiologicalDamage,firstDiscomfort,shortcutActivations,postDiscomfortDecisions,careRepeats,genericFeedingAfterDiscomfort,energyResidualKcal:residual,finalTechniques:copy(n.discovery.techniques),finalPending:copy(n.discovery.samplesPending),checks:{allIngestionsReceipted:receipted,paidSampleMaterialBudgets:materialBudgets.every(row=>row.swallowedMassGrams<=row.stock.massGrams+1e-6&&row.swallowedKcal<=row.stock.energyKcal+1e-6&&new Set(row.ingestionIds).size===row.ingestionIds.length),energyConserved:Math.abs(residual)<1e-6,finiteHumanTransfer:Math.abs(e.ecology.ledger.humanRemovedKcal-openingRemoved-delta.ingestedKcal)<1e-6,noUnrecordedPhysicalAssistance:n.physiology.outsideAssistance.count===opening.outsideAssistance.count&&n.stats.rescues===0&&e.ecology.ledger.externalKcal===openingExternal,gutsEmpty:completedExposure&&!setupFailure&&!checkpointMismatch&&n.physiology.stomach.length===0,zeroPostDisconfirmationCareRepeats:careRepeats.length===0,zeroPostDisconfirmationSourceSampleChoices:postHarmSourceSampleChoices.length===0,unchangedSource:(await fingerprint(job.root)).sha256===job.source.sha256}};
}
if(!isMainThread){try{parentPort.postMessage({result:await run(workerData)});}catch(error){parentPort.postMessage({error:error.stack||String(error)});}}
else{
  assert.equal(process.argv.length,4);assert.equal(process.argv[2],'--output');const outputPath=resolve(process.argv[3]);
  const originalBytes=await readFile(ORIGINAL);assert.equal(hash(originalBytes),ORIGINAL_SHA);
  const previousBytes=await readFile(PREVIOUS);assert.equal(hash(previousBytes),PREVIOUS_SHA);
  const previous=JSON.parse(previousBytes),oldV3=previous.trials.find(t=>t.arm==='v3');assert.ok(oldV3?.checkpoint);
  const controlBytes=await readFile(CONTROL),control=JSON.parse(controlBytes);assert.equal(control.status,'controlled-passed');
  const sources={v3:await fingerprint(V3),v4:await fingerprint(ROOT)};
  assert.equal(sources.v3.sha256,EXPECTED.v3);assert.equal(sources.v4.sha256,control.candidateSource.sha256);
  assert.equal(hash(await readFile(PROTOCOL)),EXPECTED.protocol);assert.equal(hash(await readFile(ADDENDUM)),EXPECTED.addendum);
  const frozen={sources,originalV2ReportSha256:ORIGINAL_SHA,previousV3ToxicitySha256:PREVIOUS_SHA,protocolSha256:EXPECTED.protocol,addendumSha256:EXPECTED.addendum,controlledReportSha256:hash(controlBytes),evaluatorSha256:hash(await readFile(fileURLToPath(import.meta.url)))};
  const output=await open(outputPath,'wx'),report={schemaVersion:1,status:'running',purpose:'fixed assisted matched v3/v4 delayed-toxicity comparison, not safety guarantee',startedAt:new Date().toISOString(),frozen,trials:[],failures:[],limitations:['Externally staged finite carcass conversion/aging and explicit initial-body fixture are assistance, not hunting or autonomous survival.','Two actual personal positive ingestions must precede adverse recognition; ineligible setup is not repaired or retuned.','No checkpoint exclusions or post-learning normalization. An invalid checkpoint stops that arm before exposure.','Only travel and other-target choices are suppressed; same-source generic and care choices remain in the record.','Pre-recognition exposure and gross harm remain risks even if later caution succeeds.','No runtime peer-warning integration is installed.','The experiment-capacity/retention change is part of treatment, not a single-variable claim.','Live completion authority is earned independently, never copied from the comparison checkpoint.']};
  const persist=async()=>{await output.truncate(0);await output.write(JSON.stringify(report,null,2)+'\n',0,'utf8');};await persist();
  for(const arm of ['v3','v4']){
    const baseline=report.trials.find(t=>t.arm==='v3');
    if(arm==='v4'&&(!baseline||baseline.setupStatus!=='eligible'||report.baselineReplayMatched!==true||!['allIngestionsReceipted','paidSampleMaterialBudgets','energyConserved','finiteHumanTransfer','noUnrecordedPhysicalAssistance','unchangedSource','gutsEmpty'].every(k=>baseline.checks[k]))){
      report.failures.push({arm,error:'Candidate not started: frozen-v3 replay failed or checkpoint ineligible'});break;
    }
    try{
      const result=await new Promise((res,rej)=>{
        const worker=new Worker(new URL(import.meta.url),{workerData:{arm,root:arm==='v3'?V3:ROOT,source:sources[arm],expectedStartingState:arm==='v3'?oldV3.startingState:baseline.startingState,expectedCheckpoint:arm==='v3'?oldV3.checkpoint:baseline.checkpoint}});
        let message;worker.on('message',m=>{message=m;});worker.on('error',rej);worker.on('exit',code=>{if(code||!message)rej(Error(`Worker exit ${code}`));else if(message.error)rej(Error(message.error));else res(message.result);});
      });
      report.trials.push(result);
      if(arm==='v3'){
        report.baselineReplayDifferences=['startingState','checkpoint','events','feedback','inputs','closing','firstDiscomfort','firstPhysiologicalDamage'].flatMap(key=>differences(oldV3[key],result[key],`/${key}`));
        // The sole added field is read-only v4 caution instrumentation, not state.
        const replayDecisions=result.decisions.map(({cautionedHeldIds,...decision})=>decision);
        report.baselineReplayDifferences.push(...differences(oldV3.decisions,replayDecisions,'/decisions'));
        report.baselineReplayMatched=report.baselineReplayDifferences.length===0;
      }
      console.log(`${arm}: ${result.setupStatus}, ${result.postHarmSourceSampleChoices.length} post-harm source samples, ${result.cautionOpportunities.length} caution opportunities, ${result.closing.grossToxicHarm} gross harm`);
    }catch(error){report.failures.push({arm,error:error.stack||String(error)});}
    await persist();
  }
  if(report.trials.length===2){
    const [b,c]=report.trials;
    report.completeHorizonComparison=b.completedExposure&&c.completedExposure;
    report.startDifferences=differences(b.startingState,c.startingState);
    report.checkpointDifferences=b.checkpoint&&c.checkpoint?differences(b.checkpoint,c.checkpoint):null;
    report.matchedCheckpoint=!!b.checkpoint&&!!c.checkpoint&&!report.startDifferences.length&&!report.checkpointDifferences.length;
    report.comparison={preDiscomfortMassDeltaGrams:b.firstDiscomfort&&c.firstDiscomfort?c.firstDiscomfort.ingestedGrams-b.firstDiscomfort.ingestedGrams:null,preDiscomfortEnergyDeltaKcal:b.firstDiscomfort&&c.firstDiscomfort?c.firstDiscomfort.ingestedKcal-b.firstDiscomfort.ingestedKcal:null,grossHarmDelta:c.closing.grossToxicHarm-b.closing.grossToxicHarm,healthDelta:c.closing.health-b.closing.health,baselineNegativeControlReproduced:b.postHarmSourceSampleChoices.length>0,candidateCompletionShortcutActivated:c.shortcutActivations.length>0,candidateCautionOpportunities:c.cautionOpportunities.length,candidatePostHarmSourceSampleChoices:c.postHarmSourceSampleChoices.length,ownHarmCareRepeats:c.careRepeats.length,genericPostDiscomfortFeedingChoices:c.genericFeedingAfterDiscomfort.length};
    report.parentRiskReviewRequired=true;
  }
  for(const arm of ['v3','v4'])if((await fingerprint(arm==='v3'?V3:ROOT)).sha256!==sources[arm].sha256)report.failures.push({arm,error:'Runtime source changed'});
  if(hash(await readFile(ORIGINAL))!==ORIGINAL_SHA||hash(await readFile(PREVIOUS))!==PREVIOUS_SHA||hash(await readFile(PROTOCOL))!==EXPECTED.protocol||hash(await readFile(ADDENDUM))!==EXPECTED.addendum||hash(await readFile(CONTROL))!==frozen.controlledReportSha256||hash(await readFile(fileURLToPath(import.meta.url)))!==frozen.evaluatorSha256)report.failures.push({error:'Frozen evidence/protocol/control/evaluator changed'});
  const eligible=report.trials.length===2&&report.trials.every(t=>t.setupStatus==='eligible');
  const physicalKeys=['allIngestionsReceipted','paidSampleMaterialBudgets','energyConserved','finiteHumanTransfer','noUnrecordedPhysicalAssistance','unchangedSource'];
  const integrity=report.trials.every(t=>physicalKeys.every(k=>t.checks[k]));
  const candidate=report.trials.find(t=>t.arm==='v4'),candidateFailure=!!candidate?.exposureFailure||candidate?.setupStatus==='eligible'&&(!candidate.checks.zeroPostDisconfirmationSourceSampleChoices||!candidate.checks.zeroPostDisconfirmationCareRepeats||!candidate.checks.gutsEmpty);
  report.status=report.failures.length||!integrity||candidateFailure?'failed':!eligible||!report.matchedCheckpoint||!report.baselineReplayMatched||!report.comparison?.baselineNegativeControlReproduced||!report.comparison?.candidateCompletionShortcutActivated||!report.comparison?.candidateCautionOpportunities||!report.trials.every(t=>t.checks.gutsEmpty)?'inconclusive':'completed-risk-assay';
  report.completedAt=new Date().toISOString();await persist();await output.close();if(report.status!=='completed-risk-assay')process.exitCode=1;console.log(`Saved ${report.status} to ${outputPath}`);
}
