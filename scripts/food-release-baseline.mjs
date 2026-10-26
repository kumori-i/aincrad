/** Packaged generated baseline evidence; no engine execution or user-save access. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
export const BASELINE_IDENTITY=Object.freeze({runtimeSha256:'ebaef37d61a50d994a0dbcb7e6e5a1c2a064c6c7e952a6de0dc4337e3c98b788',reportSha256:'fa2718a3d3ba585e4a8b68a31446cf8fde72c4af6abc2c2fa20e7510a8755716',fixtureSha256:'14ac52c10c93edcdde65f4fc1bb6b9c2c5d768f5d8de52436099e07034d2e6b2',auditSha256:'a05e6cbd4b86e73d8402a2b6f2192487f3c9a960976c4f68e081ad12010a6632'});
const hash=x=>createHash('sha256').update(x).digest('hex');
const nonnegative=new Set(['massGrams','energyKcal','remainingMassGrams','remainingKcal','remainingWaterMl','originalMassGrams','originalKcal','originalWaterMl','availableEnergyKcal','storedEnergyKcal','waterDeficitMl','ingestedKcal','absorbedKcal','metabolizedKcal','discardedKcal','ingestedWaterMl','absorbedWaterMl','waterLostMl']);
export function assertFiniteReleaseData(value,key='root'){
  if(typeof value==='number')assert.ok(Number.isFinite(value)&&(!nonnegative.has(key)||value>=0),`Invalid raw ${key}`);
  else if(Array.isArray(value))for(const row of value)assertFiniteReleaseData(row,key);
  else if(value&&typeof value==='object')for(const [child,row]of Object.entries(value))assertFiniteReleaseData(row,child);
}
// Exactly the pre-existing v4 comparison normalization, not new exclusions.
export function releaseComparableState(value){const copy=structuredClone(value);for(const n of copy.agents||[]){delete n.physiology.satietyHours;for(const key of ['nourishment','feelings'])delete n[key];for(const event of n.memory.experience)if(event.type==='observation'&&event.at===0)delete event.details.nourishment;}delete copy.npc;return copy;}
export function validateReleaseBaseline(fixture,audit){
  assertFiniteReleaseData(fixture);assertFiniteReleaseData(audit);
  assert.equal(hash(JSON.stringify(fixture)+'\n'),BASELINE_IDENTITY.fixtureSha256);assert.equal(hash(JSON.stringify(audit,null,2)+'\n'),BASELINE_IDENTITY.auditSha256);
  assert.deepEqual(Object.keys(fixture).sort(),['schemaVersion','kind','originalReport','baselineSource','baselineTrial','initialStateEvidence','initialState'].sort());
  assert.equal(fixture.schemaVersion,1);assert.equal(fixture.kind,'food-release-baseline');
  assert.equal(fixture.originalReport.sha256,BASELINE_IDENTITY.reportSha256);assert.equal(fixture.originalReport.status,'failed');
  assert.equal(fixture.baselineSource.sha256,BASELINE_IDENTITY.runtimeSha256);assert.equal(hash(JSON.stringify(fixture.baselineSource.files)),BASELINE_IDENTITY.runtimeSha256);
  assert.equal(hash(JSON.stringify(fixture.baselineSource)),'570422439c1c59aa975a465a780b54ce12020eba7d21b094aefe8701b8ba75f8');
  const trial=fixture.baselineTrial;assert.equal(trial.kind,'controlled');assert.equal(trial.arm,'baseline');assert.equal(trial.seed,74193);assert.equal(trial.seconds,600);assert.equal(trial.gameHours,4);assert.equal(trial.sourceSha256,BASELINE_IDENTITY.runtimeSha256);
  assert.equal(hash(JSON.stringify(trial)),'a54edc7fe1f6450cecea52450a1681d371b52705cd1328d5c59735cc614f9322');
  assert.ok(trial.agents.length===1&&trial.agents[0].id==='aster');
  for(const key of ['finiteEcologyTransfer','noExternalEcologyEnergy','unchangedSource'])assert.equal(trial.checks[key],true);
  for(const key of ['energyConserved','noPhysicalAssistance','materialReceiptsComplete','materialIntakeBounded'])assert.equal(trial.agents[0].checks[key],true);
  assert.equal(fixture.initialStateEvidence.sourceCommit,'49f476d93028566c7ab60110aa97776724446ced');assert.equal(fixture.initialStateEvidence.kind,'reconstructed-frozen-main-start');
  const raw=hash(JSON.stringify(fixture.initialState)),normalized=hash(JSON.stringify(releaseComparableState(fixture.initialState)));
  assert.equal(raw,'8d7c4a8f6562facd64f0bfa83981bfde72aad3c283aa584e622b89e8f21f472e');assert.equal(raw,trial.initialStateSha256);assert.equal(raw,fixture.initialStateEvidence.rawSha256);
  assert.equal(normalized,'b04d005900e94c0a54727b3ff5f02028ffa7cfe640dcefd9c5541aa3b6b6acb5');assert.equal(normalized,fixture.initialStateEvidence.matchedPhysicalStartSha256);
  assert.equal(audit.fixtureSha256,BASELINE_IDENTITY.fixtureSha256);assert.equal(audit.originalReportSha256,BASELINE_IDENTITY.reportSha256);assert.equal(audit.originalReportStatus,'failed');assert.equal(audit.baselineTrialCanonicalSha256,hash(JSON.stringify(trial)));assert.equal(audit.baselineSourceCanonicalSha256,hash(JSON.stringify(fixture.baselineSource)));assert.equal(audit.initialStateCanonicalSha256,raw);assert.equal(audit.originalRecordedInitialStateSha256,raw);assert.equal(audit.releaseNormalizedStartSha256,normalized);assert.equal(audit.originalRecordedNormalizedStartSha256,trial.matchedPhysicalStartSha256);
  return {fixture,audit,normalizedStartSha256:normalized};
}
export async function loadReleaseBaseline(){
  const [fixtureBytes,auditBytes]=await Promise.all([readFile(new URL('../tests/fixtures/food-release/baseline-controlled.json',import.meta.url)),readFile(new URL('../tests/fixtures/food-release/baseline-extraction-audit.json',import.meta.url))]);
  assert.equal(hash(fixtureBytes),BASELINE_IDENTITY.fixtureSha256,'Packaged baseline fixture changed');assert.equal(hash(auditBytes),BASELINE_IDENTITY.auditSha256,'Packaged extraction audit changed');
  return validateReleaseBaseline(JSON.parse(fixtureBytes),JSON.parse(auditBytes));
}
