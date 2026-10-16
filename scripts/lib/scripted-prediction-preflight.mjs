/** Separate admission for ONE frozen Gate 1 script after the original resource
 * gate failed. File reads only: no world, benchmark or assay is constructed. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateResourceAdmission, resourceSources, resourceStats } from '../measure-reusable-prediction.mjs';
import { verifyPredictionArtifact, PREDICTION_PREFLIGHT } from './reusable-prediction-preflight.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fail = message => { throw new Error(`Scripted prediction preflight: ${message}`); };
export const SCRIPTED_PREDICTION_PREFLIGHT = Object.freeze({ version: 1,
  kind: 'scripted-prediction-preflight', protocol: 'scripted-prediction-use-v1',
  requiredChecks: Object.freeze([...PREDICTION_PREFLIGHT.requiredChecks, 'scripted-protocol', 'owned-child-watchdog']),
  originalReportSha256: '1750246f089497c235f4beb0fc4b9c193fe3db28aba3b43bb2942dc315e5cffd',
  originalRuntimeSource: '371350b4145da83296b0b672a1e5420b0f92202efa4b05c2c72bf8c5408ceb88',
  originalWatchdogHelperSha256: 'd893107b26ccd40bfd2bf62409ffdc8a4097a4935b3daef5fd4489d47f913e1f',
  originalSourceFiles: 131,
});

/** These outer files are not covered by resourceSources' existing manifest. */
export async function scriptedPredictionExecutionSources(root = ROOT) {
  const paths = { supervisorSha256: 'scripts/run-scripted-prediction.mjs',
    watchdogHelperSha256: 'scripts/run-finite-headless.mjs',
    protocolTestsSha256: 'tests/scripted-prediction-protocol.test.mjs',
    evaluatorTestsSha256: 'tests/scripted-prediction-evaluator.test.mjs' };
  return Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([name, path]) =>
    [name, hash(await readFile(resolve(root, path)))])));
}

export function checkScriptedPredictionPreflightShape(raw, sources, evaluatorSha256, executionSources) {
  if (!raw || raw.version !== 1 || raw.kind !== SCRIPTED_PREDICTION_PREFLIGHT.kind ||
      raw.protocol !== SCRIPTED_PREDICTION_PREFLIGHT.protocol) fail('Wrong protocol');
  if (!hex(sources?.runtimeSource) || !same(raw.sources, sources) || !hex(evaluatorSha256) || raw.evaluatorSha256 !== evaluatorSha256 ||
      !executionSources || Object.keys(executionSources).length !== 4 ||
      ['supervisorSha256', 'watchdogHelperSha256', 'protocolTestsSha256', 'evaluatorTestsSha256'].some(key => !hex(executionSources[key])) ||
      !same(raw.executionSources, executionSources)) fail('Current source fingerprint differs from frozen checks');
  if (executionSources.watchdogHelperSha256 !== SCRIPTED_PREDICTION_PREFLIGHT.originalWatchdogHelperSha256)
    fail('Original owned-child watchdog helper changed');
  if (raw.scope !== 'scripted-prediction-only' || raw.gate !== 'gate1-only' || raw.maximumRuns !== 1 ||
      ['autonomy', 'mainPromotion', 'readiness', 'continuation', 'retry'].some(key => raw[key] !== false))
    fail('Scope must be one fixed Gate 1 script without autonomy, readiness, retries or continuation');
  const rows = raw.correctness;
  if (!Array.isArray(rows) || rows.length !== SCRIPTED_PREDICTION_PREFLIGHT.requiredChecks.length ||
      new Set(rows.map(row => row?.name)).size !== rows.length ||
      SCRIPTED_PREDICTION_PREFLIGHT.requiredChecks.some(name => !rows.some(row => row?.name === name && row.passed === true)))
    fail('Required exact-source correctness checks missing or failed');
  if (raw.review?.status !== 'cleared' || raw.review.runtimeSource !== sources.runtimeSource ||
      raw.review.evaluatorSha256 !== evaluatorSha256 || !same(raw.review.executionSources, executionSources))
    fail('Independent exact-source review is missing');
  if (raw.originalFailure?.sha256 !== SCRIPTED_PREDICTION_PREFLIGHT.originalReportSha256)
    fail('Original failed resource report must retain its pinned hash');
  return true;
}

/** Additive files are allowed. No original manifest entry may disappear/change. */
export function requireOriginalPredictionManifest(original, current) {
  if (!Array.isArray(original?.files) || !original.files.length || !Array.isArray(current?.files))
    fail('Missing original/current source manifest');
  const manifest = rows => {
    const result = new Map();
    for (const row of rows) {
      if (!row || typeof row.path !== 'string' || !row.path || row.path.startsWith('/') ||
          row.path.split('/').some(part => !part || part === '.' || part === '..') ||
          row.path.includes('\\') || !hex(row.sha256) || result.has(row.path)) fail('Malformed source manifest');
      result.set(row.path, row.sha256);
    }
    return result;
  };
  const before = manifest(original.files), after = manifest(current.files);
  for (const [path, sha256] of before) if (after.get(path) !== sha256) fail(`Original source changed or missing: ${path}`);
  return true;
}

export async function readScriptedPredictionPreflight(path, { evaluatorPath, root = ROOT } = {}) {
  const absolute = resolve(path), base = dirname(absolute), bytes = await readFile(absolute), raw = JSON.parse(bytes);
  const sources = await resourceSources(root), evaluatorSha256 = hash(await readFile(evaluatorPath));
  const executionSources = await scriptedPredictionExecutionSources(root);
  checkScriptedPredictionPreflightShape(raw, sources, evaluatorSha256, executionSources);
  const artifacts = [];
  for (const row of raw.correctness) artifacts.push({ name: row.name, ...await verifyPredictionArtifact(row.evidence, base) });
  artifacts.push({ name: 'independent-review', ...await verifyPredictionArtifact(raw.review.evidence, base) });
  const originalArtifact = await verifyPredictionArtifact(raw.originalFailure, base);
  artifacts.push({ name: 'original-failed-resource-admission', ...originalArtifact });
  const report = JSON.parse(originalArtifact.contents), originalSources = report.sourcesBefore;
  if (originalSources?.runtimeSource !== SCRIPTED_PREDICTION_PREFLIGHT.originalRuntimeSource ||
      originalSources?.files?.length !== SCRIPTED_PREDICTION_PREFLIGHT.originalSourceFiles ||
      !same(originalSources, report.sourcesAfter)) fail('Original before/after source evidence is not preserved');
  requireOriginalPredictionManifest(originalSources, sources);
  const resourceGate = evaluateResourceAdmission(report, { expectedSources: originalSources });
  if (resourceGate.passed || report.gates?.passed !== false || report.partial !== true ||
      report.legacyInteractiveGate?.status !== 'failed-preserved') fail('Original negative admission was not preserved');
  const cases = report.cases.map(row => ({ name: row.name, status: 'measured',
    addedDecisionMs: resourceStats(row.rawTimingsMs.added), encodedActorAndMetadataBytes: row.encodedActorAndMetadataBytes }));
  const known = cases.find(row => row.name === 'full-cap-known');
  if (!known || !(known.addedDecisionMs.p95 >= 50) || cases.some(row => row.name === 'full-cap-unknown'))
    fail('Original full-cap failure and unrun unknown case are not preserved');
  cases.push({ name: 'full-cap-unknown', status: 'not-run', reason: 'Stopped at the original full-cap-known resource gate failure' });
  const originalFailure = { report: { path: originalArtifact.path, sha256: originalArtifact.sha256, bytes: originalArtifact.bytes },
    runtimeSource: originalSources.runtimeSource, sourceFiles: originalSources.files.length, allOriginalFilesUnchanged: true,
    sourceClassification: report.sourceClassification,
    status: 'failed-preserved', passed: false, p95LimitMs: 50, failures: resourceGate.failures,
    failure: report.failure, cases, legacyInteractiveGate: report.legacyInteractiveGate };
  return { path: absolute, sha256: hash(bytes), protocol: SCRIPTED_PREDICTION_PREFLIGHT.protocol,
    sources, evaluatorSha256, executionSources, resourceGate, originalFailure,
    scriptedAdmission: { status: 'admitted-for-one-scripted-gate1', originalResourceAdmissionPassed: false,
      maximumRuns: 1, retry: false, continuation: false, autonomy: false, readiness: false, mainPromotion: false },
    artifacts: artifacts.map(({ contents, ...artifact }) => artifact), legacyInteractiveGate: report.legacyInteractiveGate };
}
