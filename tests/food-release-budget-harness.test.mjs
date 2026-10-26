import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { BASELINE_IDENTITY, loadReleaseBaseline, validateReleaseBaseline, assertFiniteReleaseData } from '../scripts/food-release-baseline.mjs';
import { RELEASE_BUDGET_IDENTITY, parseReleaseBudgetOptions, validateReleaseBudgetManifest } from '../scripts/evaluate-food-release-budget.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');

test('release budget preserves historical v4 worker bytes without editing original evaluator',async()=>{
  const original=await readFile(new URL('../scripts/evaluate-food-balance-v4.mjs',import.meta.url),'utf8'),current=await readFile(new URL('../scripts/evaluate-food-release-budget.mjs',import.meta.url),'utf8');
  assert.equal(hash(original),'03e04759646fa2ac57702527a51243cb02b8bb52d991430d98143eae628b02b4');
  const originalWorker=original.slice(original.indexOf('async function run(job){'),original.indexOf('if(!isMainThread)'));
  const currentWorker=current.slice(current.indexOf('async function run(job){'),current.indexOf('\nexport const RELEASE_BUDGET_IDENTITY'));
  assert.equal(currentWorker.trimEnd(),originalWorker.trimEnd());
  for(const name of ['function comparableState(value){','async function fingerprint(root){']){
    const start=original.indexOf(name),end=original.indexOf(name==='function comparableState(value){'?'async function run(job){':'function comparableState(value){',start);
    assert.ok(current.includes(original.slice(start,end)));
  }
  assert.equal(hash(await readFile(new URL('../docs/food-system/ACCEPTANCE.md',import.meta.url))),RELEASE_BUDGET_IDENTITY.protocolSha256);
  assert.equal(RELEASE_BUDGET_IDENTITY.schemaVersion,5);assert.equal(RELEASE_BUDGET_IDENTITY.arm,'combined-release');
  assert.match(current,/await open\(outputPath,'wx'\)/);assert.doesNotMatch(current,/v3ControlledSha256|v3OrdinarySha256|const priorPath='\/tmp/);
});
function args(){return ['--manifest','/inputs/manifest.json','--manifest-sha256','a'.repeat(64),'--protocol-sha256',RELEASE_BUDGET_IDENTITY.protocolSha256,'--expected-runtime',RELEASE_BUDGET_IDENTITY.runtimeSha256,'--output','/outputs/new.json'];}
test('release budget interface requires explicit inputs and cannot change seed, horizon or phase',()=>{
  assert.equal(parseReleaseBudgetOptions(args()).output,'/outputs/new.json');
  for(const bad of [args().slice(2),[...args(),'--phase','ordinary'],[...args(),'--seed','74203'],[...args(),'--seconds','1'],[...args(),'--output','overwrite.json'],[...args(),'--unknown','value'],[...args(),'--original-report','/private/report'],[...args(),'--baseline-root','/private/source'],args().slice(0,-1)])assert.throws(()=>parseReleaseBudgetOptions(bad));
});
function fixture(){const id=RELEASE_BUDGET_IDENTITY,context={source:{sha256:id.runtimeSha256,files:{'src/unit.js':'a'.repeat(64)}},baselineSource:{sha256:id.baselineRuntimeSha256},commit:'b'.repeat(40),tree:'c'.repeat(40),protocolSha256:id.protocolSha256,evaluatorSha256:'d'.repeat(64),capabilitySha256:'e'.repeat(64)};return {context,manifest:{commit:context.commit,tree:context.tree,runtime:structuredClone(context.source),protocolSha256:context.protocolSha256,evaluatorSha256:context.evaluatorSha256,releaseEvaluators:{budgetSha256:context.evaluatorSha256,capabilitySha256:context.capabilitySha256},baselineIdentity:structuredClone(BASELINE_IDENTITY)}};}
test('release budget freezes full source, final tree, specification, both evaluators and original baseline',()=>{
  const good=fixture();assert.equal(validateReleaseBudgetManifest(good.manifest,good.context),true);
  for(const mutate of [f=>f.manifest.commit='0'.repeat(40),f=>f.manifest.tree='0'.repeat(40),f=>f.manifest.runtime.files['src/unit.js']='0'.repeat(64),f=>f.context.source.sha256='0'.repeat(64),f=>f.manifest.protocolSha256='0'.repeat(64),f=>f.context.protocolSha256='85b8546f83b50ac2fce2990ba40d471ec660b5850963ce85eb319536eb4bfdf4',f=>f.manifest.evaluatorSha256='0'.repeat(64),f=>f.manifest.releaseEvaluators.capabilitySha256='0'.repeat(64),f=>f.context.baselineSource.sha256='0'.repeat(64),f=>f.manifest.baselineIdentity.reportSha256='0'.repeat(64)]){const f=fixture();mutate(f);assert.throws(()=>validateReleaseBudgetManifest(f.manifest,f.context));}
});

test('packaged baseline retains full measured trial and raw reconstructed start with honest original-failure provenance',async()=>{
  const {fixture,audit,normalizedStartSha256}=await loadReleaseBaseline();
  assert.equal(fixture.originalReport.status,'failed');assert.equal(audit.originalReportStatus,'failed');
  assert.equal(hash(JSON.stringify(fixture.initialState)),fixture.baselineTrial.initialStateSha256);
  assert.equal(normalizedStartSha256,'b04d005900e94c0a54727b3ff5f02028ffa7cfe640dcefd9c5541aa3b6b6acb5');
  assert.notEqual(normalizedStartSha256,fixture.baselineTrial.matchedPhysicalStartSha256,'Do not confuse the older normalization with approved v4 normalization');
  assert.ok(fixture.initialState.agents[0].memory.experience.length>0);assert.ok(fixture.baselineTrial.agents[0].events.length>0);
  assert.match(audit.method,/not a fresh replay/);assert.equal(fixture.initialStateEvidence.kind,'reconstructed-frozen-main-start');
  for(const mutate of [f=>f.schemaVersion=2,f=>f.extra=true,f=>f.originalReport.status='passed',f=>f.baselineTrial.agents[0].energyDebtKcal=0,f=>f.initialState.agents[0].physiology.availableEnergyKcal=NaN,f=>f.initialState.agents[0].physiology.storedEnergyKcal=-1]){const copy=structuredClone(fixture);mutate(copy);assert.throws(()=>validateReleaseBaseline(copy,audit));}
  const falseAudit=structuredClone(audit);falseAudit.method='Fresh rerun';assert.throws(()=>validateReleaseBaseline(fixture,falseAudit));
  for(const bad of [NaN,Infinity,-Infinity])assert.throws(()=>assertFiniteReleaseData({nested:{arbitrary:bad}}));
  assert.throws(()=>assertFiniteReleaseData({remainingKcal:-1}));assert.doesNotThrow(()=>assertFiniteReleaseData({position:{x:-100},energyDebtKcal:-1}));
});
