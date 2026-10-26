/** Single combined-runtime own-source caution capability, NOT a causal comparison.
 * Frozen controls are passed explicitly; see --help. No runtime imports this file.
 * 300 s exposure + 900 s drain; seed74193; actual paid checkpoint; no old checkpoint normalization.
 */
import assert from 'node:assert/strict';
import { BASELINE_IDENTITY, loadReleaseBaseline } from './food-release-baseline.mjs';
import { createHash } from 'node:crypto';
import { readFile, readdir, open } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..'),STEP=1/60;
const ADDENDUM=resolve(ROOT,'docs/food-system/ACCEPTANCE.md');
const BUDGET=resolve(ROOT,'scripts/evaluate-food-release-budget.mjs');
const hash=x=>createHash('sha256').update(x).digest('hex'),copy=x=>structuredClone(x);
export function finiteNonnegative(value,label='measurement'){assert.ok(Number.isFinite(value)&&value>=0,`Invalid ${label}`);return value;}
export function sumMeasured(rows,key){assert.ok(Array.isArray(rows));return rows.reduce((v,row)=>v+finiteNonnegative(row?.[key],key),0);}
export function physicalStock(object,key){return object==null?0:finiteNonnegative(object[key],key);}
const sum=sumMeasured;
async function fingerprint(root){const files={};async function walk(dir){for(const entry of (await readdir(resolve(root,dir),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const name=`${dir}/${entry.name}`;if(entry.isDirectory())await walk(name);else if(entry.name.endsWith('.js'))files[name]=hash(await readFile(resolve(root,name)));}}await walk('src');for(const name of ['package.json','package-lock.json'])files[name]=hash(await readFile(resolve(root,name)));return {sha256:hash(JSON.stringify(files)),files};}
// Single current-runtime capability: no old checkpoint or causal comparison.
async function run(job){
  assert.equal((await fingerprint(job.root)).sha256,job.source.sha256);
  const names=['config','npc-state','environment','ecology','npc','biology','discovery','npc-memory','interoception'];
  const api=Object.fromEntries(await Promise.all(names.map(async name=>[name,await import(pathToFileURL(resolve(job.root,`src/${name}.js`)).href)])));
  const completion=await import(pathToFileURL(resolve(job.root,'src/discovery-completion.js')).href);
  const caution=await import(pathToFileURL(resolve(job.root,'src/food-source-caution.js')).href);
  const proof=await import(pathToFileURL(resolve(job.root,'src/receipt-proof.js')).href);
  assert.equal(api.config.CONFIG.fixedStep,STEP);assert.equal(api.config.CONFIG.dayRealSeconds,3600);
  const n=api['npc-state'].createNpc({id:'aster',mode:'discovery',seed:74193}),e=api.environment.createEnvironment(74193,{mode:'discovery'}),animal=e.ecology.animals[0];assert.ok(animal);
  const assistance={bodyBefore:copy(n.physiology),bodyFixture:{availableEnergyKcal:700,hoursSinceMeal:12,satietyHours:0},positionBefore:copy(n.position),stagedStrikes:[],sourceAging:null,scheduledPaidActions:[],suppressedDecisions:[],boundaryCancellations:[]};
  n.position=copy(animal.position);n.physiology.availableEnergyKcal=700;n.physiology.hoursSinceMeal=12;n.physiology.satietyHours=0;api.biology.projectPhysiology(n);
  for(let i=0;i<4;i++){const result=api.ecology.interactEcologyObject(e.ecology,animal.id,'strike',{actorId:n.id,position:n.position,power:4});assistance.stagedStrikes.push({targetId:animal.id,power:4,result:copy(result)});}
  const sourceId=assistance.stagedStrikes.map(s=>s.result.resultObjectId).find(Boolean),source=api.ecology.lookupEcologyObject(e.ecology,sourceId);assert.ok(source?.kind==='carcass');
  assistance.sourceAging={sourceId,before:{ageHours:source.ageHours,spoiled:source.spoiled,massGrams:source.massGrams,energyKcal:source.energyKcal},ageHours:72,spoiled:true};source.ageHours=72;source.spoiled=true;
  api.npc.observeNpc(n,e);const startingState={n:copy(n),e:copy(e)},opening=copy(n.physiology),openingRemoved=e.ecology.ledger.humanRemovedKcal,openingExternal=e.ecology.ledger.externalKcal;
  const events=[],feedback=[],decisions=[],attempts=[],inputs=new Map(),pieces=new Set(),pieceInitialStocks={},ecologyDecayByPiece={},hourly=[],shortcutActivations=[],cautionOpportunities=[];
  let stage='setup',lastEvent=0,firstPhysiologicalDamage=null,firstDiscomfort=null,setupFailure=null,checkpoint=null,checkpointMassBalance=null,firstCautionProof=null,exposureFailure=null,completedExposure=false,nextDecision=0;
  const body=()=>{const f=n.physiology;for(const value of Object.values(f.totals))finiteNonnegative(value,'physiology total');for(const key of ['availableEnergyKcal','storedEnergyKcal'])finiteNonnegative(f[key],key);return {at:n.elapsed,totals:copy(f.totals),availableEnergyKcal:f.availableEnergyKcal,storedEnergyKcal:f.storedEnergyKcal,reservesKcal:f.availableEnergyKcal+f.storedEnergyKcal,pendingKcal:sum(f.stomach,'remainingKcal'),gutMassGrams:sum(f.stomach,'remainingMassGrams'),gutInputs:f.stomach.length,health:f.health,condition:f.condition,satietyHours:f.satietyHours,foodbar:n.nourishment,body:api.interoception.bodySignals(n),outsideAssistance:copy(f.outsideAssistance),rescues:n.stats.rescues,collapses:n.stats.collapses,grossToxicHarm:sum([...inputs.values()],'grossHarm')};};
  function trackInputs(rows){for(const item of rows){for(const key of ['originalMassGrams','originalKcal','harm'])finiteNonnegative(item[key],key);let row=inputs.get(item.id);if(!row){row={ingestionId:item.id,objectId:item.objectId,actionId:item.actionId,at:item.at,stage,originalMassGrams:item.originalMassGrams,originalKcal:item.originalKcal,toxicity:item.toxicity,digestHours:item.digestHours,grossHarm:0,lastHarm:0};inputs.set(item.id,row);}const delta=item.harm-row.lastHarm;assert.ok(delta>=-1e-10,'Per-input cumulative harm moved backwards');row.grossHarm+=Math.max(0,delta);row.lastHarm=item.harm;if(delta>0&&firstPhysiologicalDamage===null)firstPhysiologicalDamage={at:n.elapsed,ingestionId:item.id,objectId:item.objectId,stage};}}
  function collect(){for(const event of n.memory.experience){if(event.id<=lastEvent)continue;lastEvent=event.id;
    if(event.type==='condition'&&event.details.code==='DISCOVERY_EFFECT'){feedback.push(copy(event.details.feedback));if(event.details.feedback.effect==='discomfort'&&firstDiscomfort===null)firstDiscomfort={at:n.elapsed,receiptAt:event.at,eventId:event.id,feedback:copy(event.details.feedback),stage,ingestedGrams:sum([...inputs.values()].filter(input=>pieces.has(input.objectId)),'originalMassGrams'),ingestedKcal:n.physiology.totals.ingestedKcal,grossHarm:sum([...inputs.values()],'grossHarm')};}
    if(event.type==='action'){events.push({id:event.id,at:event.at,stage,action:copy(event.details.action),result:copy(event.details.result),afterDiscomfort:firstDiscomfort!==null});const action=event.details.action,result=event.details.result;if(action?.type==='pull'&&result?.ok&&result.materialId){pieces.add(result.materialId);const piece=api.ecology.lookupEcologyObject(e.ecology,result.materialId);if(piece)pieceInitialStocks[result.materialId]={massGrams:piece.massGrams,energyKcal:piece.energyKcal,waterMl:piece.waterMl,toxicity:piece.toxicity,spoiled:piece.spoiled,digestHours:piece.digestHours,at:event.at};}}
  }}
  function tick(){const before=[...n.physiology.stomach];api.environment.tickEnvironment(e,STEP);
    // Measure physical piece loss across ecology ONLY, before any NPC swallow.
    const beforeEcology=[...pieces].map(id=>({id,item:api.ecology.lookupEcologyObject(e.ecology,id)})).filter(row=>row.item).map(({id,item})=>({id,massGrams:item.massGrams,energyKcal:item.energyKcal}));
    api.ecology.tickEcology(e.ecology,STEP,e,[n]);
    for(const old of beforeEcology){const now=api.ecology.lookupEcologyObject(e.ecology,old.id),massLoss=old.massGrams-physicalStock(now,'massGrams'),energyLoss=old.energyKcal-physicalStock(now,'energyKcal');assert.ok(massLoss>=-1e-9&&energyLoss>=-1e-9,'Held flesh gained stock during ecology');const measured=ecologyDecayByPiece[old.id]??={massGrams:0,energyKcal:0,measuredSteps:0,firstAt:n.elapsed,lastAt:n.elapsed};measured.massGrams+=massLoss;measured.energyKcal+=energyLoss;measured.measuredSteps++;measured.lastAt=n.elapsed+STEP;}
    api.npc.tickNpc(n,STEP,e);
    // References remain live even if digestion removed their rows this step.
    trackInputs(before);trackInputs(n.physiology.stomach);
    api.discovery.processDiscoveryFeedback(n,{recordEffect:effect=>api['npc-memory'].recordEvent(n,'condition',{code:'DISCOVERY_EFFECT',feedback:effect})});collect();
  }
  function request(action,reason,need,scheduled=false){const row={at:n.elapsed,stage,action:copy(action),reason,need,afterDiscomfort:firstDiscomfort!==null,sourceRevised:n.discovery.techniques.some(t=>t.sourceId===sourceId&&t.confidence==='revised'),body:api.interoception.bodySignals(n)};const result=api.npc.requestNpcAction(n,action,e);row.startResult=copy(result);attempts.push(row);if(scheduled)assistance.scheduledPaidActions.push(copy(row));collect();return result;}
  function paid(action){const result=request(action,'Explicit paid setup operation','setup',true);assert.equal(result.code,'ACTION_STARTED');for(let i=0;i<1200&&n.active;i++)tick();assert.equal(n.active,null);assert.equal(n.lastResult.ok,true);}
  const validated=()=>proof.validateLedgers({now:n.elapsed,receiptsInput:n.memory.experience,experimentsInput:n.discovery.experiments,effectsInput:n.discovery.effects});
  const positives=id=>new Set(validated().effects.filter(row=>row.valid&&row.effect.objectId===id&&row.effect.effect==='sustained').map(row=>row.effect.ingestionId)).size;
  paid({type:'pull',targetId:sourceId});const firstPiece=n.inventory.items[0];assert.ok(firstPiece);assert.equal(pieceInitialStocks[firstPiece].massGrams,100);
  for(let count=1;count<=2;count++){
    if(firstDiscomfort){setupFailure='Adverse recognition preceded the required two positive outcomes';break;}
    paid({type:'sample',targetId:firstPiece});
    for(let i=0;i<24000&&positives(firstPiece)<count&&!firstDiscomfort;i++)tick();
    if(firstDiscomfort||positives(firstPiece)<count){setupFailure=firstDiscomfort?'Adverse recognition preceded the required two positive outcomes':'Two positive outcomes were not reached within the fixed setup bound';break;}
  }
  const openingBody=body();
  if(!setupFailure){assert.equal(positives(firstPiece),2);assert.ok(n.inventory.items.includes(firstPiece));const remaining=api.ecology.lookupEcologyObject(e.ecology,firstPiece).massGrams,ingested=sum([...inputs.values()].filter(row=>row.objectId===firstPiece),'originalMassGrams'),decayed=ecologyDecayByPiece[firstPiece]?.massGrams||0;checkpointMassBalance={initialMassGrams:pieceInitialStocks[firstPiece].massGrams,actualIngestedMassGrams:ingested,independentlyMeasuredEcologyDecayGrams:decayed,remainingMassGrams:remaining,residualGrams:pieceInitialStocks[firstPiece].massGrams-ingested-decayed-remaining,toleranceGrams:1e-7};assert.ok(remaining>0&&remaining<=40+1e-7);assert.ok(Math.abs(checkpointMassBalance.residualGrams)<=1e-7,'Initial piece minus actual swallowed and independently measured ecology decay must equal remaining');checkpoint={n:copy(n),e:copy(e)};
    {const start=n.elapsed;stage='feeding';nextDecision=start;
    for(let step=0;step<18000;step++){
      if(!n.active&&n.lifecycle==='AWAKE'&&n.elapsed>=nextDecision){const before=JSON.stringify(n),decision=api.discovery.discoveryDecision(n),action=decision.action;
        // The learner runs exactly once; only subsequent evidence collection is read-only.
        const afterChoice=JSON.stringify(n),pending=n.discovery.experiments.filter(a=>a.primitive==='pull'&&a.targetId===sourceId&&a.materialId&&n.discovery.samplesPending[a.materialId]!==undefined&&n.elapsed-n.discovery.samplesPending[a.materialId]<45).map(a=>({sourceActionId:a.actionId,materialId:a.materialId,pendingAt:n.discovery.samplesPending[a.materialId],held:n.inventory.items.includes(a.materialId),positives:positives(a.materialId),finish:n.discovery.experiments.find(x=>x.targetId===a.materialId&&x.finishedMaterial===true)??null}));
        const witnessed=pending.filter(p=>p.finish&&completion?.witnessedMaterialCompletion(n,p.finish));
        const entry={at:n.elapsed,fromCheckpoint:n.elapsed-start,action:copy(action),reason:decision.reason,need:decision.need,body:api.interoception.bodySignals(n),privateBody:body(),held:[...n.inventory.items],pending:copy(n.discovery.samplesPending),pendingPriorPieces:copy(pending),afterDiscomfort:firstDiscomfort!==null,sourceRevised:n.discovery.techniques.some(t=>t.sourceId===sourceId&&t.confidence==='revised')};
        if(action.type==='pull'&&action.targetId===sourceId&&decision.need==='food'&&pending.length&&witnessed.length&&decision.reason.startsWith('Past sampling of this object')){entry.completionShortcutActivated=true;shortcutActivations.push(copy(entry));}
        entry.cautionedHeldIds=n.inventory.items.filter(id=>pieces.has(id)&&caution.experiencedFoodSourceCaution(n,id));
        if(entry.afterDiscomfort&&entry.cautionedHeldIds.length){
          const adverse=validated().effects.filter(row=>row.valid&&row.effect.effect==='discomfort'&&pieces.has(row.effect.objectId));
          assert.ok(adverse.length,'Caution needs retained canonical own adverse proof');
          if(!firstCautionProof)firstCautionProof={at:n.elapsed,actor:copy(n),validatedAdverse:copy(adverse),sourceId,heldIds:[...entry.cautionedHeldIds]};
          cautionOpportunities.push({at:n.elapsed,heldIds:[...entry.cautionedHeldIds],chosenAction:copy(action),need:decision.need,adverseActionIds:adverse.map(row=>row.sample.actionId)});
        }
        assert.equal(JSON.stringify(n),afterChoice,'Diagnostic logging changed actor after its one learner call');void before;
        const travel=['move','swim','climb'].includes(action.type),foreign=action.targetId&&action.targetId!==sourceId&&!pieces.has(action.targetId);
        entry.suppressed=!!(travel||foreign);decisions.push(entry);
        if(entry.afterDiscomfort&&action.type==='sample'&&pieces.has(action.targetId)){
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
  const materialBudgets=Object.entries(pieceInitialStocks).map(([id,stock])=>{const swallowed=allInputs.filter(input=>input.objectId===id),remaining=api.ecology.lookupEcologyObject(e.ecology,id),decay=ecologyDecayByPiece[id]||{massGrams:0,energyKcal:0};return {id,stock,swallowedMassGrams:sum(swallowed,'originalMassGrams'),swallowedKcal:sum(swallowed,'originalKcal'),ingestionIds:swallowed.map(input=>input.ingestionId),decay:copy(decay),remainingMassGrams:physicalStock(remaining,'massGrams'),remainingKcal:physicalStock(remaining,'energyKcal'),massResidualGrams:stock.massGrams-sum(swallowed,'originalMassGrams')-decay.massGrams-(physicalStock(remaining,'massGrams')),energyResidualKcal:stock.energyKcal-sum(swallowed,'originalKcal')-decay.energyKcal-(physicalStock(remaining,'energyKcal'))};});
  const receipted=allInputs.every(input=>events.some(event=>event.id===input.actionId&&event.at===input.at&&event.result.ok===true&&event.result.ingestionId===input.ingestionId&&(pieces.has(input.objectId)?event.action.type==='sample'&&event.action.targetId===input.objectId&&Number.isFinite(event.result.durationSeconds)&&event.result.durationSeconds>0&&Math.abs(event.result.handling?.activeActionSeconds-event.result.durationSeconds)<=1e-8:event.action.type==='drink'&&input.originalKcal===0)));
  const postDiscomfortDecisions=decisions.filter(d=>d.afterDiscomfort),careRepeats=postDiscomfortDecisions.filter(d=>d.need==='food'&&(d.action.type==='pull'&&d.action.targetId===sourceId||d.action.type==='sample'&&pieces.has(d.action.targetId))),genericFeedingAfterDiscomfort=postDiscomfortDecisions.filter(d=>d.need!=='food'&&['sample','pull'].includes(d.action.type));
  const postHarmSourceSampleChoices=postDiscomfortDecisions.filter(d=>d.action.type==='sample'&&pieces.has(d.action.targetId));
  return {arm:'combined',firstCautionProof,exposureFailure,completedExposure,cautionOpportunities,postHarmSourceSampleChoices,sourceSha256:job.source.sha256,setupStatus:setupFailure?'ineligible':'eligible',setupFailure,startingState,checkpoint,checkpointMassBalance,ecologyDecayByPiece,assistance,sourceId,firstPiece,openingBody,closing,delta,events,feedback,decisions,attempts,hourly,inputs:allInputs,pieceInitialStocks,materialBudgets,firstPhysiologicalDamage,firstDiscomfort,shortcutActivations,postDiscomfortDecisions,careRepeats,genericFeedingAfterDiscomfort,energyResidualKcal:residual,finalTechniques:copy(n.discovery.techniques),finalPending:copy(n.discovery.samplesPending),checks:{pieceStocksReconciled:materialBudgets.every(row=>[row.stock.massGrams,row.stock.energyKcal,row.swallowedMassGrams,row.swallowedKcal,row.decay.massGrams,row.decay.energyKcal,row.remainingMassGrams,row.remainingKcal,row.massResidualGrams,row.energyResidualKcal].every(Number.isFinite)&&Math.abs(row.massResidualGrams)<=1e-7&&Math.abs(row.energyResidualKcal)<=1e-6),allIngestionsReceipted:receipted,paidSampleMaterialBudgets:materialBudgets.every(row=>row.swallowedMassGrams<=row.stock.massGrams+1e-6&&row.swallowedKcal<=row.stock.energyKcal+1e-6&&new Set(row.ingestionIds).size===row.ingestionIds.length),energyConserved:[opening.availableEnergyKcal,opening.storedEnergyKcal,sum(opening.stomach,'remainingKcal'),delta.ingestedKcal,closing.reservesKcal,closing.pendingKcal,delta.metabolizedKcal,delta.discardedKcal,residual].every(Number.isFinite)&&Math.abs(residual)<=1e-6,finiteHumanTransfer:Math.abs(e.ecology.ledger.humanRemovedKcal-openingRemoved-delta.ingestedKcal)<1e-6,noUnrecordedPhysicalAssistance:JSON.stringify(n.physiology.outsideAssistance)===JSON.stringify(opening.outsideAssistance)&&n.stats.rescues===0&&e.ecology.ledger.externalKcal===openingExternal,gutsEmpty:completedExposure&&!setupFailure&&n.physiology.stomach.length===0,zeroPostDisconfirmationCareRepeats:careRepeats.length===0,zeroPostDisconfirmationSourceSampleChoices:postHarmSourceSampleChoices.length===0,unchangedSource:(await fingerprint(job.root)).sha256===job.source.sha256}};
}

export const PHYSICAL_CHECKS=Object.freeze(['pieceStocksReconciled','allIngestionsReceipted','paidSampleMaterialBudgets','energyConserved','finiteHumanTransfer','noUnrecordedPhysicalAssistance','unchangedSource']);
export function classifyCapability(result,failures=[]){
  if(failures.length||!result||PHYSICAL_CHECKS.some(k=>result.checks?.[k]!==true)||result.exposureFailure)return 'failed';
  if(result.setupStatus==='eligible'&&(result.checks.zeroPostDisconfirmationSourceSampleChoices!==true||result.checks.zeroPostDisconfirmationCareRepeats!==true||result.checks.gutsEmpty!==true))return 'failed';
  if(result.setupStatus!=='eligible'||!result.completedExposure||!result.checkpoint||!result.firstDiscomfort||!result.firstPhysiologicalDamage||!result.firstCautionProof||!result.cautionOpportunities?.length||!result.shortcutActivations?.length)return 'inconclusive';
  return 'completed-combined-capability';
}
export const CONTROL_IDENTITY=Object.freeze({baselineRuntimeSha256:'ebaef37d61a50d994a0dbcb7e6e5a1c2a064c6c7e952a6de0dc4337e3c98b788',evaluatorSha256:'58a462dc234da318a37f32e4eb7d1e8b24c274055cd5a692c3a29e63ea6ee8c3',protocolSha256:'33ffd1557e25330a3bcf2cfbdda86ea9ea95d8a4b20b2a5133aaaeae11809928',priorSha256:'fa2718a3d3ba585e4a8b68a31446cf8fde72c4af6abc2c2fa20e7510a8755716'});
const CONTROL_TRIAL_CHECKS=['finiteEcologyTransfer','noExternalEcologyEnergy','unchangedSource'];
const CONTROL_ACTOR_CHECKS=['energyConserved','noPhysicalAssistance','materialReceiptsComplete','materialIntakeBounded'];
export function validateFrozenInputs(manifest,{source,protocolSha256,evaluatorSha256,control,commit,tree,originalBaselineTrial,originalBaselineSource}){
  assert.match(commit,/^[a-f0-9]{40}$/);assert.match(tree,/^[a-f0-9]{40}$/);
  assert.equal(manifest.commit,commit,'Frozen commit mismatch');assert.equal(manifest.tree,tree,'Frozen tree mismatch');
  assert.deepEqual(manifest.runtime,source,'Frozen full runtime manifest mismatch');assert.equal(source.sha256,'d68d8146a91467f80f62fd2e5645df3e5c91578a648f8206b27ebc4e869f092d');
  assert.equal(manifest.protocolSha256,protocolSha256,'Frozen protocol mismatch');assert.equal(protocolSha256,CONTROL_IDENTITY.protocolSha256);
  assert.equal(manifest.evaluatorSha256,evaluatorSha256,'Frozen evaluator mismatch');assert.deepEqual(manifest.releaseEvaluators,{budgetSha256:CONTROL_IDENTITY.evaluatorSha256,capabilitySha256:evaluatorSha256});
  assert.deepEqual(manifest.baselineIdentity,BASELINE_IDENTITY);assert.deepEqual(manifest.controlIdentity,CONTROL_IDENTITY,'Release budget/specification and original main must remain frozen');
  assert.equal(control.baselineFixtureSha256,BASELINE_IDENTITY.fixtureSha256);assert.deepEqual(control.frozen?.baselineIdentity,BASELINE_IDENTITY);assert.equal(control.schemaVersion,5);assert.deepEqual(control.sourceIdentity,{commit,tree});assert.deepEqual(control.frozen?.releaseEvaluators,manifest.releaseEvaluators);assert.equal(control.phase,'controlled');assert.deepEqual(control.failures,[]);
  assert.equal(control.status,'controlled-passed','Combined known-food gate must pass first');
  assert.equal(control.baselineSource?.sha256,CONTROL_IDENTITY.baselineRuntimeSha256);assert.deepEqual(control.baselineSource,originalBaselineSource,'Original baseline source manifest differs');
  assert.equal(control.evaluatorSha256,CONTROL_IDENTITY.evaluatorSha256);assert.equal(control.protocolSha256,CONTROL_IDENTITY.protocolSha256);assert.equal(control.priorSha256,CONTROL_IDENTITY.priorSha256);
  assert.deepEqual(control.candidateSource,source,'Controlled report is from another runtime');
  assert.ok(control.trials?.length===1&&control.comparisons?.length===1);
  const trial=control.trials[0],comparison=control.comparisons[0];
  assert.equal(trial.kind,'controlled');assert.equal(trial.arm,'combined-release');assert.equal(trial.seed,74193);assert.equal(trial.seconds,600);assert.equal(trial.gameHours,4);assert.equal(trial.sourceSha256,source.sha256);
  assert.equal(comparison.kind,'controlled');assert.equal(comparison.seed,74193);assert.equal(comparison.matchedPhysicalStart,true);
  for(const key of CONTROL_TRIAL_CHECKS)assert.equal(trial.checks?.[key],true,key);
  assert.ok(Array.isArray(trial.agents)&&trial.agents.length===1&&Array.isArray(comparison.agents)&&comparison.agents.length===1);
  const actor=trial.agents[0],paired=comparison.agents[0];assert.equal(actor.id,'aster');assert.equal(paired.id,actor.id);assert.equal(paired.baseline?.id,actor.id);assert.deepEqual(paired.baseline,originalBaselineTrial.agents.find(a=>a.id===actor.id),'Original baseline actor differs');
  for(const key of CONTROL_ACTOR_CHECKS)assert.equal(actor.checks?.[key],true,key);
  assert.ok(Number.isFinite(actor.energyDebtKcal)&&Number.isFinite(paired.baseline.energyDebtKcal)&&Number.isFinite(paired.energyDebtDeltaKcal));
  assert.ok(Math.abs(actor.energyDebtKcal-(finiteNonnegative(actor.delta?.metabolizedKcal)-finiteNonnegative(actor.delta?.absorbedKcal)))<=1e-8,'Debt must match actual totals');
  assert.ok(Math.abs(paired.energyDebtDeltaKcal-(actor.energyDebtKcal-paired.baseline.energyDebtKcal))<=1e-8,'Comparison debt mismatch');
  assert.ok(Array.isArray(actor.hourly)&&actor.hourly.length===4);
  const earlier=actor.hourly.at(-3),lateAbsorbed=finiteNonnegative(actor.closing?.totals?.absorbedKcal)-finiteNonnegative(earlier.totals?.absorbedKcal),lateSpent=finiteNonnegative(actor.closing?.totals?.metabolizedKcal)-finiteNonnegative(earlier.totals?.metabolizedKcal);
  assert.ok(Number.isFinite(actor.lastTwoHoursAbsorbedToSpent)&&lateSpent>0&&lateAbsorbed>=0);
  assert.ok(Math.abs(actor.lastTwoHoursAbsorbedToSpent-lateAbsorbed/lateSpent)<=1e-10,'Late ratio must match actual totals');
  assert.equal(paired.checks?.energyDebtNotWorse,actor.energyDebtKcal<=paired.baseline.energyDebtKcal+1e-6);assert.equal(paired.checks?.energyDebtNotWorse,true);
  assert.equal(paired.checks?.lateEnergyBalance,actor.lastTwoHoursAbsorbedToSpent>=1);assert.equal(paired.checks?.lateEnergyBalance,true);
  return true;
}
function identity(){const git=(...args)=>execFileSync('git',args,{cwd:ROOT,encoding:'utf8'}).trim();return {commit:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}'),status:git('status','--porcelain','--untracked-files=normal')};}
async function main(){
  const required=['manifest','manifest-sha256','protocol-sha256','expected-runtime','controlled-report','controlled-sha256','output'];
  if(process.argv.length===3&&process.argv[2]==='--help'){console.log('Usage: node scripts/evaluate-food-combined-capability.mjs '+required.map(k=>`--${k} VALUE`).join(' ')+'\nManifest schema: {commit,tree,runtime:{sha256,files},protocolSha256,evaluatorSha256,controlIdentity,baselineIdentity:{runtimeSha256,reportSha256,fixtureSha256,auditSha256},releaseEvaluators:{budgetSha256,capabilitySha256}}. New exclusive output path; clean committed source required.');return;}
  assert.equal((process.argv.length-2)%2,0);const options={};
  for(let i=2;i<process.argv.length;i+=2){const key=process.argv[i].replace(/^--/,'');assert.ok(process.argv[i].startsWith('--')&&required.includes(key)&&!Object.hasOwn(options,key),'Unknown or duplicate option');options[key]=process.argv[i+1];}
  for(const key of required)assert.ok(options[key],`Missing --${key}`);
  for(const key of ['manifest-sha256','protocol-sha256','expected-runtime','controlled-sha256'])assert.match(options[key],/^[a-f0-9]{64}$/);
  const manifestPath=resolve(options.manifest),controlPath=resolve(options['controlled-report']),outputPath=resolve(options.output);
  assert.ok(![manifestPath,controlPath,ADDENDUM,BUDGET,fileURLToPath(import.meta.url)].includes(outputPath),'Output must not replace input');
  const [manifestBytes,controlBytes,protocolBytes,evaluatorBytes]=await Promise.all([readFile(manifestPath),readFile(controlPath),readFile(ADDENDUM),readFile(fileURLToPath(import.meta.url))]);
  assert.equal(hash(manifestBytes),options['manifest-sha256']);assert.equal(hash(controlBytes),options['controlled-sha256']);assert.equal(hash(protocolBytes),options['protocol-sha256']);
  const source=await fingerprint(ROOT);assert.equal(source.sha256,options['expected-runtime']);const id=identity();assert.equal(id.status,'','Source must be clean and committed before the assay');
  assert.equal(hash(await readFile(BUDGET)),CONTROL_IDENTITY.evaluatorSha256,'Release budget evaluator changed');
  const manifest=JSON.parse(manifestBytes),control=JSON.parse(controlBytes),packaged=await loadReleaseBaseline(),originalBaselineTrial=packaged.fixture.baselineTrial;
  validateFrozenInputs(manifest,{source,protocolSha256:hash(protocolBytes),evaluatorSha256:hash(evaluatorBytes),control,...id,originalBaselineTrial,originalBaselineSource:packaged.fixture.baselineSource});
  const frozen={...manifest,manifestPath,manifestSha256:hash(manifestBytes),baselineIdentity:BASELINE_IDENTITY,controlledReportPath:controlPath,controlledReportSha256:hash(controlBytes)};
  const output=await open(outputPath,'wx');
  const report={schemaVersion:5,sourceIdentity:{commit:id.commit,tree:id.tree},status:'running',purpose:'Single combined-runtime own-source caution capability, not comparative safety or causal effect',startedAt:new Date().toISOString(),frozen,trials:[],failures:[],limitations:['Explicit body/position fixture and finite staged carcass conversion/aging are assistance, not earned hunting.','Two paid personal benefits precede adverse recognition; setup cannot be retuned or repaired.','No old differing-runtime checkpoint comparison, copied learning, or normalized state.','Only travel and unrelated-target choices are suppressed; all implicated decisions remain visible.','Initial exposure and cumulative toxic harm remain risks despite later caution.','One assisted fixed-seed horizon is not autonomous survival or safety.','Peer-warning delivery is validated separately by the actual encounter/ablation fixture.','No native UI/close-reopen acceptance is implied by this Node evaluator.']};
  const persist=async()=>{await output.truncate(0);await output.write(JSON.stringify(report,null,2)+'\n',0,'utf8');};await persist();
  try{
    const result=await new Promise((res,rej)=>{const worker=new Worker(new URL(import.meta.url),{workerData:{root:ROOT,source}});let message;worker.on('message',m=>{message=m;});worker.on('error',rej);worker.on('exit',code=>{if(code||!message)rej(Error(`Worker exit ${code}`));else if(message.error)rej(Error(message.error));else res(message.result);});});
    report.trials.push({...result,arm:'combined-release'}); // Release metadata only; worker physics unchanged.
  }catch(error){report.failures.push({error:error.stack||String(error)});}
  try{
    assert.deepEqual(identity(),id,'Committed source identity changed during run');assert.deepEqual(await fingerprint(ROOT),source);
    assert.deepEqual(await loadReleaseBaseline(),packaged);assert.equal(hash(await readFile(manifestPath)),frozen.manifestSha256);assert.equal(hash(await readFile(controlPath)),frozen.controlledReportSha256);
    assert.equal(hash(await readFile(BUDGET)),CONTROL_IDENTITY.evaluatorSha256);assert.equal(hash(await readFile(ADDENDUM)),frozen.protocolSha256);assert.equal(hash(await readFile(fileURLToPath(import.meta.url))),frozen.evaluatorSha256);
  }catch(error){report.failures.push({error:error.stack||String(error)});}
  report.status=classifyCapability(report.trials[0],report.failures);report.completedAt=new Date().toISOString();await persist();await output.close();
  console.log(`Saved ${report.status} to ${outputPath}`);if(report.status!=='completed-combined-capability')process.exitCode=1;
}
if(!isMainThread){try{parentPort.postMessage({result:await run(workerData)});}catch(error){parentPort.postMessage({error:error.stack||String(error)});}}
else if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
