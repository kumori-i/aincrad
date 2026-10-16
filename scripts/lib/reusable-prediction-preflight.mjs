/** Pure/file-read admission for the frozen, owner-scripted increment-A assays.
 * Reading a preflight never constructs a world or runs a fixture. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { evaluateResourceAdmission, resourceSources } from '../measure-reusable-prediction.mjs';

export const PREDICTION_PREFLIGHT = Object.freeze({ version: 1, kind: 'reusable-prediction-preflight',
  protocol: 'reusable-outcome-increment-a', requiredChecks: Object.freeze([
    'model-sensor-gates', 'native-harness', 'assay-producer', 'full-check', 'build',
  ]) });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const hex = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function fail(message) { throw new Error(`Prediction preflight: ${message}`); }
export async function verifyPredictionArtifact(ref, base) {
  if (!ref || typeof ref.path !== 'string' || !ref.path || !hex(ref.sha256)) fail('Missing artifact path/hash');
  const path = resolve(base, ref.path), bytes = await readFile(path);
  if (hash(bytes) !== ref.sha256) fail(`Artifact changed: ${ref.path}`);
  return { path, sha256: ref.sha256, bytes: bytes.length, contents: bytes.toString('utf8') };
}
export function checkPredictionPreflightShape(raw, currentSources, evaluatorSha256) {
  if (!raw || raw.version !== 1 || raw.kind !== PREDICTION_PREFLIGHT.kind || raw.protocol !== PREDICTION_PREFLIGHT.protocol)
    fail('Wrong protocol');
  if (!same(raw.sources, currentSources) || !hex(evaluatorSha256) || raw.evaluatorSha256 !== evaluatorSha256)
    fail('Source fingerprint differs from frozen checks');
  if (raw.scope !== 'scripted-prediction-only' || raw.autonomy !== false || raw.mainPromotion !== false)
    fail('Scope is not the authorized bounded assay');
  const rows = raw.correctness;
  if (!Array.isArray(rows) || rows.length !== PREDICTION_PREFLIGHT.requiredChecks.length ||
      new Set(rows.map(r => r?.name)).size !== rows.length ||
      PREDICTION_PREFLIGHT.requiredChecks.some(name => !rows.some(r => r?.name === name && r.passed === true)))
    fail('Required frozen correctness checks missing or failed');
  if (raw.review?.status !== 'cleared' || raw.review.runtimeSource !== currentSources.runtimeSource ||
      raw.review.evaluatorSha256 !== evaluatorSha256) fail('Independent exact-source review is missing');
  return true;
}
export async function readPredictionPreflight(path, { evaluatorPath, root } = {}) {
  const absolute = resolve(path), base = dirname(absolute), bytes = await readFile(absolute);
  const raw = JSON.parse(bytes), sources = await resourceSources(root);
  const evaluatorSha256 = hash(await readFile(evaluatorPath));
  checkPredictionPreflightShape(raw, sources, evaluatorSha256);
  const artifacts = [];
  for (const row of raw.correctness) artifacts.push({ name: row.name, ...await verifyPredictionArtifact(row.evidence, base) });
  artifacts.push({ name: 'independent-review', ...await verifyPredictionArtifact(raw.review.evidence, base) });
  const budget = await verifyPredictionArtifact(raw.resource, base); artifacts.push({ name: 'resource', ...budget });
  const report = JSON.parse(budget.contents), resourceGate = evaluateResourceAdmission(report, { expectedSources: sources });
  if (!resourceGate.passed) fail(`Original resource admission failed: ${resourceGate.failures.join('; ')}`);
  return { path: absolute, sha256: hash(bytes), sources, evaluatorSha256, resourceGate,
    artifacts: artifacts.map(({ contents, ...r }) => r), legacyInteractiveGate: report.legacyInteractiveGate };
}
