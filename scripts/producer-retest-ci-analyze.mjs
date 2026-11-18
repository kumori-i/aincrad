// Read-only frozen-pair validator and trace organizer. No simulation imports.
// Contract: manifest.baseline.sha256 and manifest.candidate.sha256 pin runtime
// fingerprints. Exact input paths are explicit; outputs use exclusive create.
// A trace bundle is NOT activation. Human review must establish a matching
// decision -> canonical pulling/sampling phase -> paid action receipt -> exact
// new material/ingestion -> genuine feedback chain, and compare baseline.
// Missing transient issued snapshots are unobserved, not proof of no choice.
import assert from 'node:assert/strict';
import {PRODUCER_RETEST_CI_PROTOCOL as P} from './producer-retest-ci-protocol.mjs';
import {readFileSync,writeFileSync} from 'node:fs';
import {NORMALIZED_PATHS,comparableHash,sha256} from './producer-retest-ci-namespace.mjs';
const [baselinePath,candidatePath,manifestPath,outputPath]=process.argv.slice(2);
assert.ok(baselinePath&&candidatePath&&manifestPath&&outputPath,'Expected baseline.json candidate.json manifest.json NEW-output.json');
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const manifest=read(manifestPath),runs={baseline:read(baselinePath),candidate:read(candidatePath)};
for(const [arm,path] of [['baseline',baselinePath],['candidate',candidatePath]]){
 const r=runs[arm],expected=manifest[arm]?.sha256;assert.equal(expected,arm==='baseline'?P.baselineSource:P.candidateSource);assert.match(expected??'',/^[a-f0-9]{64}$/,'Manifest must pin '+arm+'.sha256');
 assert.equal(r.protocol,'producer-retest-ci-v1');assert.deepEqual(r.normalizationPaths,NORMALIZED_PATHS);
 assert.equal(r.seed,77201);assert.equal(r.seconds,1200);assert.equal(r.completedSteps,72000);assert.equal(r.status,'completed');assert.equal(r.failure,null);
 assert.equal(r.source,expected);assert.equal(r.sourceAfter,expected);assert.equal(r.saveValid,true);
 assert.ok(path.endsWith('.json'));
 const rawInitial=readFileSync(path.slice(0,-5)+'.initial.json','utf8'),rawSave=readFileSync(path.slice(0,-5)+'.save.json','utf8');
 assert.equal(sha256(rawInitial),r.rawInitialStateSha256);assert.equal(comparableHash(JSON.parse(rawInitial)),r.initialStateSha256);
 assert.equal(sha256(rawSave),r.saveSha256);assert.equal(comparableHash(JSON.parse(rawSave)),r.comparableSaveSha256);
 for(const k of ['rows','snapshots','inquiryTransitions','agents'])assert.ok(Array.isArray(r[k]),k);
 assert.deepEqual(r.agents.map(n=>n.id).sort(),['aster','mira']);
}
assert.equal(runs.baseline.initialStateSha256,runs.candidate.initialStateSha256);
const fields=['availableEnergyKcal','storedEnergyKcal','waterDeficitMl','health','condition','stamina','fatigue','sleepPressure'];
const stats=['collapses','rescues','injuries','warningSeconds','criticalSeconds','invalidActions','repeatedInvalid','independentDrinks','independentMeals'];
const pick=(o,keys)=>Object.fromEntries(keys.map(k=>[k,o?.[k]??null]));
for(const r of Object.values(runs))for(const n of r.agents){for(const k of fields)assert.ok(Number.isFinite(n.physiology[k]),'Finite outcome '+k);for(const k of stats)assert.ok(Number.isFinite(n.stats[k]),'Finite stat '+k);}
const end=n=>({physiology:pick(n.physiology,fields),totals:n.physiology.totals,outsideAssistance:n.physiology.outsideAssistance,stats:pick(n.stats,stats)});
const outcomes=runs.candidate.agents.map(c=>{const b=runs.baseline.agents.find(n=>n.id===c.id);assert.ok(b,'Same actor set');return {actor:c.id,baseline:end(b),candidate:end(c),candidateMinusBaseline:Object.fromEntries(fields.map(k=>[k,c.physiology[k]-b.physiology[k]]))};});
const questionText='Pulling this source produced a piece whose later sample brought relief. Could a new piece do so?';
function traceBundles(r){
 const groups=new Map();
 for(const t of r.inquiryTransitions)for(const q of t.status?.questions??[]){
  const key=JSON.stringify([t.actor,q.sourceId,q.at]);if(!groups.has(key))groups.set(key,{actor:t.actor,sourceId:q.sourceId,admittedAt:q.at,deadline:q.deadline,priorMaterialId:q.priorMaterialId,transitions:[]});
  groups.get(key).transitions.push({at:t.at,phase:q.phase,materialId:q.materialId,activeRequest:t.activeRequest,terminal:!!t.terminal});
 }
 return [...groups.values()].map(q=>{
  const rows=r.rows.filter(e=>e.actor===q.actor),materials=new Set(q.transitions.map(t=>t.materialId).filter(Boolean));
  const window=e=>e.at>=q.admittedAt-1e-6&&e.at<=q.deadline+1e-6;
  const decisions=rows.filter(e=>e.type==='decision'&&window(e)&&e.details?.summary===questionText);
  const pulls=rows.filter(e=>e.type==='action'&&window(e)&&e.details?.action?.type==='pull'&&e.details.action.targetId===q.sourceId);
  const samples=rows.filter(e=>e.type==='action'&&window(e)&&e.details?.action?.type==='sample'&&materials.has(e.details.action.targetId));
  const ingestions=new Set(samples.map(e=>e.details.result?.ingestionId).filter(Boolean));
  const feedback=rows.filter(e=>e.type==='condition'&&e.details?.code==='DISCOVERY_EFFECT'&&ingestions.has(e.details.feedback?.ingestionId)&&samples.some(a=>a.id===e.details.feedback.actionId&&a.details.action.targetId===e.details.feedback.objectId));
  const paid=rows=>rows.filter(e=>e.details.result?.ok===true&&e.details.result?.durationSeconds>0&&e.details.result?.handling?.source==='experienced'&&e.details.result.handling.activeActionSeconds===e.details.result.durationSeconds);
  const canonicalPull=q.transitions.filter(t=>t.phase==='pulling'&&t.activeRequest?.type==='pull'&&t.activeRequest.targetId===q.sourceId);
  const canonicalSample=q.transitions.filter(t=>t.phase==='sampling'&&t.activeRequest?.type==='sample'&&materials.has(t.activeRequest.targetId));
  return {...q,observedPhases:[...new Set(q.transitions.map(t=>t.phase))],decisions,canonicalPull,canonicalSample,pullReceipts:pulls,sampleReceipts:samples,successfulPaidPulls:paid(pulls),successfulPaidSamples:paid(samples),exactIngestionFeedback:feedback,
   terminalTechniques:r.agents.find(n=>n.id===q.actor)?.discovery?.techniques.filter(t=>t.sourceId===q.sourceId)??[],
   interpretation:'Manual linkage review required. Matching source/time alone is not inquiry attribution. Require canonical phase and decision, exact successful paid receipt/material, and exact actionId/ingestion feedback. unavailable/retired and ordinary preemption must not receive inquiry credit.'};
 });
}
const result={status:'pair-integrity-passed',protocol:'producer-retest-ci-v1',seed:77201,seconds:1200,outcomes,
 normalizedFinalSavesEqual:runs.baseline.comparableSaveSha256===runs.candidate.comparableSaveSha256,
 rawFinalSavesEqual:runs.baseline.saveSha256===runs.candidate.saveSha256,
 baselineInquiries:traceBundles(runs.baseline),candidateInquiries:traceBundles(runs.candidate),
 limits:'No automated activation or benefit verdict. This one pair cannot establish generalization, reliable survival or learned rule invention. Retained-map sizes are not cumulative events; sampled occupancy is not paid work. Review care/assistance/harm, cancellation and provenance before progression. No continuation or tuning based on these outcomes.'};
writeFileSync(outputPath,JSON.stringify(result,null,2),{flag:'wx'});
console.log(JSON.stringify({status:result.status,candidateTraceBundles:result.candidateInquiries.length,activation:'requires-independent-trace-review'}));
