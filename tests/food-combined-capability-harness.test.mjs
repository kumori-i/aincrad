import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { BASELINE_IDENTITY } from '../scripts/food-release-baseline.mjs';
import { classifyCapability, PHYSICAL_CHECKS, validateFrozenInputs, CONTROL_IDENTITY, finiteNonnegative, sumMeasured, physicalStock } from '../scripts/evaluate-food-combined-capability.mjs';

// Contract tests only: fabricated result objects test classification, NOT physical evidence.
function passing(){return {setupStatus:'eligible',completedExposure:true,checkpoint:{},firstDiscomfort:{},firstPhysiologicalDamage:{},firstCautionProof:{},cautionOpportunities:[{}],shortcutActivations:[{}],checks:Object.fromEntries([...PHYSICAL_CHECKS,'zeroPostDisconfirmationSourceSampleChoices','zeroPostDisconfirmationCareRepeats','gutsEmpty'].map(k=>[k,true]))};}
test('combined capability requires physical integrity and nonvacuous earned opportunity',()=>{
  assert.equal(classifyCapability(passing()),'completed-combined-capability');
  for(const key of PHYSICAL_CHECKS){const row=passing();row.checks[key]=false;assert.equal(classifyCapability(row),'failed',key);}
  for(const key of ['zeroPostDisconfirmationSourceSampleChoices','zeroPostDisconfirmationCareRepeats','gutsEmpty']){const row=passing();row.checks[key]=false;assert.equal(classifyCapability(row),'failed',key);}
  for(const key of ['checkpoint','firstDiscomfort','firstPhysiologicalDamage','firstCautionProof']){const row=passing();row[key]=null;assert.equal(classifyCapability(row),'inconclusive',key);}
  for(const key of ['cautionOpportunities','shortcutActivations']){const row=passing();row[key]=[];assert.equal(classifyCapability(row),'inconclusive',key);}
  const incomplete=passing();incomplete.completedExposure=false;assert.equal(classifyCapability(incomplete),'inconclusive');
  const missed=passing();missed.setupStatus='ineligible';assert.equal(classifyCapability(missed),'inconclusive');
  const failed=passing();failed.exposureFailure={};assert.equal(classifyCapability(failed),'failed');
  assert.equal(classifyCapability(passing(),[{error:'source changed'}]),'failed');
  assert.equal(classifyCapability(null),'failed');
});
function frozen(){
  const source={sha256:'d68d8146a91467f80f62fd2e5645df3e5c91578a648f8206b27ebc4e869f092d',files:{'src/x.js':'b'.repeat(64)}},commit='c'.repeat(40),tree='d'.repeat(40),protocolSha256=CONTROL_IDENTITY.protocolSha256,evaluatorSha256='f'.repeat(64);
  const actor={id:'aster',checks:{energyConserved:true,noPhysicalAssistance:true,materialReceiptsComplete:true,materialIntakeBounded:true},energyDebtKcal:10,delta:{metabolizedKcal:110,absorbedKcal:100},lastTwoHoursAbsorbedToSpent:1.1,hourly:[0,1,2,3].map(()=>({totals:{absorbedKcal:45,metabolizedKcal:60}})),closing:{totals:{absorbedKcal:100,metabolizedKcal:110}}};
  const releaseEvaluators={budgetSha256:CONTROL_IDENTITY.evaluatorSha256,capabilitySha256:evaluatorSha256};
  const control={baselineFixtureSha256:BASELINE_IDENTITY.fixtureSha256,schemaVersion:5,sourceIdentity:{commit,tree},frozen:{releaseEvaluators:structuredClone(releaseEvaluators),baselineIdentity:structuredClone(BASELINE_IDENTITY)},phase:'controlled',failures:[],status:'controlled-passed',candidateSource:structuredClone(source),baselineSource:{sha256:CONTROL_IDENTITY.baselineRuntimeSha256},evaluatorSha256:CONTROL_IDENTITY.evaluatorSha256,protocolSha256:CONTROL_IDENTITY.protocolSha256,priorSha256:CONTROL_IDENTITY.priorSha256,trials:[{kind:'controlled',arm:'combined-release',seed:74193,seconds:600,gameHours:4,sourceSha256:source.sha256,checks:{finiteEcologyTransfer:true,noExternalEcologyEnergy:true,unchangedSource:true},agents:[actor]}],comparisons:[{kind:'controlled',seed:74193,matchedPhysicalStart:true,agents:[{id:'aster',baseline:{id:'aster',energyDebtKcal:20},energyDebtDeltaKcal:-10,checks:{energyDebtNotWorse:true,lateEnergyBalance:true}}]}]};
  return {manifest:{commit,tree,runtime:structuredClone(source),protocolSha256,evaluatorSha256,baselineIdentity:structuredClone(BASELINE_IDENTITY),releaseEvaluators,controlIdentity:structuredClone(CONTROL_IDENTITY)},context:{source,commit,tree,protocolSha256,evaluatorSha256,control,originalBaselineSource:structuredClone(control.baselineSource),originalBaselineTrial:{agents:structuredClone(control.comparisons[0].agents.map(a=>a.baseline))}}};
}
test('full source, tree, protocol, evaluator and passed same-source controlled prerequisite are frozen',()=>{
  const good=frozen();assert.equal(validateFrozenInputs(good.manifest,good.context),true);
  for(const mutate of [f=>f.manifest.commit='0'.repeat(40),f=>f.manifest.tree='0'.repeat(40),f=>f.manifest.runtime.files['src/x.js']='0'.repeat(64),f=>f.manifest.protocolSha256='0'.repeat(64),f=>f.manifest.evaluatorSha256='0'.repeat(64),f=>f.context.control.status='controlled-failed',f=>f.context.control.candidateSource.sha256='0'.repeat(64),f=>f.context.control.trials=[],f=>f.context.control.trials[0].agents=[],f=>f.context.control.comparisons[0].agents=[],f=>f.context.control.comparisons[0].matchedPhysicalStart=false,f=>f.context.control.comparisons[0].agents[0].checks.lateEnergyBalance=false]){
    const f=frozen();mutate(f);assert.throws(()=>validateFrozenInputs(f.manifest,f.context));
  }
});
test('separate evaluator keeps fixed horizon, real engine calls, exclusive output and no legacy checkpoint matching',async()=>{
  const source=await readFile(new URL('../scripts/evaluate-food-combined-capability.mjs',import.meta.url),'utf8');
  for(const expected of ["seed:74193","i<1200&&n.active","i<24000&&positives",'step<18000','step<54000','nextDecision=n.elapsed+.65',"api.npc.requestNpcAction(n,action,e)","api.npc.tickNpc(n,STEP,e)","experiencedFoodSourceCaution(n,id)","witnessedMaterialCompletion(n,p.finish)","await open(outputPath,'wx')",'row.massResidualGrams)<=1e-7','Math.abs(residual)<=1e-6'])assert.ok(source.includes(expected),expected);
  assert.doesNotMatch(source,/expectedCheckpoint|expectedStartingState|baselineReplayMatched|oldV3|const V3=/);
  const standalone=await readFile(new URL('../scripts/evaluate-food-toxicity-v4.mjs',import.meta.url),'utf8');
  assert.match(standalone,/STOP BEFORE EXPOSURE on mismatch/);assert.match(standalone,/baselineReplayMatched/);
});

test('controlled prerequisite cannot substitute incomplete checks, changed identity or invented numeric gate results',()=>{
  const changes=[f=>delete f.manifest.controlIdentity,f=>f.context.control.schemaVersion=3,f=>f.context.control.phase='ordinary',f=>f.context.control.failures.push({error:'bad'}),f=>f.context.control.baselineSource.sha256='0'.repeat(64),f=>f.context.control.evaluatorSha256='0'.repeat(64),f=>f.context.control.protocolSha256='0'.repeat(64),f=>f.context.control.trials[0].sourceSha256='0'.repeat(64),f=>f.context.control.trials[0].seed=74203,f=>f.context.control.trials[0].seconds=599,f=>f.context.control.trials[0].gameHours=3,f=>f.context.control.trials[0].arm='v3',f=>delete f.context.control.trials[0].checks.finiteEcologyTransfer,f=>delete f.context.control.trials[0].agents[0].checks.materialReceiptsComplete,f=>f.context.control.trials[0].agents[0].id='mira',f=>f.context.control.comparisons[0].agents[0].baseline.id='mira',f=>f.context.control.comparisons[0].agents[0].energyDebtDeltaKcal=0,f=>f.context.control.trials[0].agents[0].energyDebtKcal=9,f=>f.context.control.trials[0].agents[0].lastTwoHoursAbsorbedToSpent=1.2,f=>f.context.control.trials[0].agents[0].hourly[1].totals.absorbedKcal=NaN,f=>f.context.control.trials[0].agents[0].delta.absorbedKcal=-1,f=>f.context.control.comparisons[0].agents[0].baseline.energyDebtKcal=100];
  for(const mutate of changes){const f=frozen();mutate(f);assert.throws(()=>validateFrozenInputs(f.manifest,f.context));}
});
test('raw nonfinite or missing quantities cannot be masked as zero in sums or existing physical objects',()=>{
  assert.equal(physicalStock(null,'massGrams'),0);assert.equal(sumMeasured([{massGrams:0},{massGrams:3}],'massGrams'),3);
  for(const bad of [NaN,Infinity,-Infinity,-1,undefined,null,'0']){
    assert.throws(()=>finiteNonnegative(bad));assert.throws(()=>sumMeasured([{massGrams:bad}],'massGrams'));assert.throws(()=>physicalStock({massGrams:bad},'massGrams'));
  }
  assert.throws(()=>physicalStock({},'massGrams'));assert.throws(()=>sumMeasured([{}],'massGrams'));
});

test('release capability rejects old-schema or old-specification results and binds both evaluator bytes',async()=>{
  for(const mutate of [f=>f.context.control.schemaVersion=4,f=>f.context.control.trials[0].arm='candidate-v4',f=>f.context.control.protocolSha256='85b8546f83b50ac2fce2990ba40d471ec660b5850963ce85eb319536eb4bfdf4',f=>f.context.control.evaluatorSha256='03e04759646fa2ac57702527a51243cb02b8bb52d991430d98143eae628b02b4',f=>f.context.control.sourceIdentity.tree='0'.repeat(40),f=>f.context.control.frozen.releaseEvaluators.capabilitySha256='0'.repeat(64),f=>f.manifest.releaseEvaluators.budgetSha256='0'.repeat(64),f=>f.context.control.baselineFixtureSha256='0'.repeat(64),f=>f.manifest.baselineIdentity.fixtureSha256='0'.repeat(64)]){const f=frozen();mutate(f);assert.throws(()=>validateFrozenInputs(f.manifest,f.context));}
  const hash=x=>createHash('sha256').update(x).digest('hex');
  assert.equal(hash(await readFile(new URL('../scripts/evaluate-food-release-budget.mjs',import.meta.url))),CONTROL_IDENTITY.evaluatorSha256);
  assert.equal(hash(await readFile(new URL('../docs/food-system/ACCEPTANCE.md',import.meta.url))),CONTROL_IDENTITY.protocolSha256);
  const source=await readFile(new URL('../scripts/evaluate-food-combined-capability.mjs',import.meta.url),'utf8');
  assert.equal(hash(source.slice(source.indexOf('async function run(job){'),source.indexOf('\nexport const PHYSICAL_CHECKS'))),'979b59689e17198c4ecdccd28b22c618eb258dee7df05a5bf471021e81d705d0','Release binding must not change the approved capability worker');
  assert.match(source,/loadReleaseBaseline/);assert.doesNotMatch(source,/original-report|const ORIGINAL='\/tmp/);
});
