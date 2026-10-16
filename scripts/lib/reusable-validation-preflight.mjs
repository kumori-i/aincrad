/** Read-only admission for the separately authorized remaining-gate bundle.
 * Original negative resource admission and all scientific source bytes survive.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resourceSources, evaluateResourceAdmission } from '../measure-reusable-prediction.mjs';
import { verifyPredictionArtifact } from './reusable-prediction-preflight.mjs';
import { requireOriginalPredictionManifest } from './scripted-prediction-preflight.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hex = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const fail = message => { throw new Error(`Validation preflight: ${message}`); };
export const VALIDATION_PREFLIGHT = Object.freeze({
  version: 1, kind: 'scripted-prediction-validation-preflight', protocol: 'scripted-prediction-validation-v1',
  protocolSha256: '6932769d221eb7ba33958dee5d48fb9d8cb9294a7f409157824a1cd2de834423',
  originalReportSha256: '1750246f089497c235f4beb0fc4b9c193fe3db28aba3b43bb2942dc315e5cffd',
  originalRuntimeSource: '371350b4145da83296b0b672a1e5420b0f92202efa4b05c2c72bf8c5408ceb88',
  originalSourceFiles: 131,
  originalGate1ReportSha256: '614b3581f164942c9ca3db7e6bbaa98dc2227154aa73cd82b9b5ef69fe5c8fd4',
  originalGate1StopSha256: '0974652719a0fa5d963bbaab214eed4883553d4f2511bc82c42dcb9ae554afa5',
  originalEvaluatorSha256: '9e153715457406e40b9883154e562dcd60e1b7e69d52c73c4ec117dc7f42be74',
  watchdogSha256: 'd893107b26ccd40bfd2bf62409ffdc8a4097a4935b3daef5fd4489d47f913e1f',
  requiredChecks: Object.freeze(['projection-adapter', 'case-producer', 'evidence-aggregation', 'validation-guards', 'full-check', 'build']),
});
export const VALIDATION_OUTER_PATHS = Object.freeze([
  'scripts/evaluate-prediction-validation.mjs', 'scripts/run-prediction-validation.mjs',
  'scripts/run-finite-headless.mjs', 'scripts/evaluate-reusable-prediction.mjs', 'tests/reusable-validation-projections.test.mjs',
  'tests/reusable-validation-producer.test.mjs', 'tests/reusable-validation-evidence.test.mjs',
  'tests/reusable-validation-guards.test.mjs',
]);
export async function validationExecutionSources(root = ROOT) {
  const files = await Promise.all(VALIDATION_OUTER_PATHS.map(async path => ({ path, sha256: hash(await readFile(resolve(root, path))) })));
  return { sha256: hash(files.map(r => `${r.path}\0${r.sha256}\n`).join('')), files };
}
export function checkValidationPreflightShape(raw, { sources, executionSources, protocolSha256 } = {}) {
  const p = VALIDATION_PREFLIGHT;
  if (!raw || raw.version !== p.version || raw.kind !== p.kind || raw.protocol !== p.protocol) fail('Wrong protocol');
  if (protocolSha256 !== p.protocolSha256 || raw.protocolSha256 !== p.protocolSha256) fail('Frozen protocol differs');
  if (!hex(sources?.runtimeSource) || !same(raw.sources, sources) || !hex(executionSources?.sha256) || !same(raw.executionSources, executionSources)) fail('Exact implementation sources differ');
  if (executionSources.files?.find(r => r.path === 'scripts/run-finite-headless.mjs')?.sha256 !== p.watchdogSha256) fail('Owned-child helper changed');
  if (executionSources.files?.find(r => r.path === 'scripts/evaluate-reusable-prediction.mjs')?.sha256 !== p.originalEvaluatorSha256) fail('Original returned-work guard changed');
  if (raw.scope !== 'one-shot-scripted-validation-bundle' || raw.maximumRuns !== 16 || raw.maximumActions !== 50 ||
      ['autonomy', 'mainPromotion', 'readiness', 'retry', 'continuation'].some(k => raw[k] !== false)) fail('Scope differs from the bounded census');
  if (raw.executionApproval?.status !== 'approved-one-shot' || raw.executionApproval.protocolSha256 !== p.protocolSha256 ||
      raw.executionApproval.runtimeSource !== sources.runtimeSource || raw.executionApproval.executionSource !== executionSources.sha256)
    fail('Final exact-source execution approval is missing');
  const rows = raw.correctness;
  if (!Array.isArray(rows) || rows.length !== p.requiredChecks.length || new Set(rows.map(r => r?.name)).size !== rows.length ||
      p.requiredChecks.some(name => !rows.some(r => r?.name === name && r.passed === true))) fail('Required deterministic correctness evidence is missing');
  if (raw.review?.status !== 'cleared' || raw.review.runtimeSource !== sources.runtimeSource || raw.review.executionSource !== executionSources.sha256) fail('Exact-source independent implementation review is missing');
  if (raw.originalFailure?.sha256 !== p.originalReportSha256 || raw.originalGate1Report?.sha256 !== p.originalGate1ReportSha256 ||
      raw.originalGate1Stop?.sha256 !== p.originalGate1StopSha256) fail('Original result hashes must remain pinned');
  return true;
}
export async function readValidationPreflight(path, { root = ROOT } = {}) {
  const absolute = resolve(path), bytes = await readFile(absolute), raw = JSON.parse(bytes), base = dirname(absolute);
  const [sources, executionSources, protocol] = await Promise.all([resourceSources(root), validationExecutionSources(root),
    readFile(resolve(root, 'docs/PREREG-scripted-prediction-validation-v1.md'))]);
  checkValidationPreflightShape(raw, { sources, executionSources, protocolSha256: hash(protocol) });
  const artifacts = [];
  for (const row of raw.correctness) artifacts.push({ name: row.name, ...await verifyPredictionArtifact(row.evidence, base) });
  for (const [name, evidence] of [['review', raw.review.evidence], ['execution-approval', raw.executionApproval.evidence],
    ['original-gate1-report', raw.originalGate1Report], ['original-gate1-stop', raw.originalGate1Stop]])
    artifacts.push({ name, ...await verifyPredictionArtifact(evidence, base) });
  const original = await verifyPredictionArtifact(raw.originalFailure, base), report = JSON.parse(original.contents), originalSources = report.sourcesBefore;
  if (originalSources?.runtimeSource !== VALIDATION_PREFLIGHT.originalRuntimeSource || originalSources.files?.length !== 131 ||
      !same(originalSources, report.sourcesAfter)) fail('Original frozen source evidence differs');
  requireOriginalPredictionManifest(originalSources, sources);
  const resourceGate = evaluateResourceAdmission(report, { expectedSources: originalSources });
  if (resourceGate.passed || report.gates?.passed !== false || report.partial !== true || report.legacyInteractiveGate?.status !== 'failed-preserved' ||
      report.cases?.some(c => c.name === 'full-cap-unknown')) fail('Original resource failure/unrun case is not preserved');
  artifacts.push({ name: 'original-failed-resource', ...original });
  const bindingArtifacts = artifacts.filter(r => ['original-gate1-report', 'original-gate1-stop'].includes(r.name));
  const objectIds = [...new Set(bindingArtifacts.flatMap(r => [...r.contents.matchAll(/\bobject:[0-9]{1,9}\b/g)].map(m => m[0])))].sort();
  const retainedBindings = { complete: true, scope: 'all-retained-physical-and-evidence-bindings',
    objectIds, sourceHashes: bindingArtifacts.map(r => r.sha256), extraction: 'Conservative object-ID string census of both pinned original artifacts; producer also unions current physical/evidence state' };
  return { path: absolute, sha256: hash(bytes), protocol: VALIDATION_PREFLIGHT.protocol,
    sources, executionSources, protocolSha256: hash(protocol), retainedBindings,
    artifacts: artifacts.map(({ contents, ...r }) => r),
    originalResourceAdmissionPassed: false, originalResourceFailures: resourceGate.failures,
    maximumRuns: 16, maximumActions: 50, retry: false, continuation: false, autonomy: false, mainPromotion: false };
}
