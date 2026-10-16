import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { checkPredictionPreflightShape, verifyPredictionArtifact, PREDICTION_PREFLIGHT } from '../scripts/lib/reusable-prediction-preflight.mjs';
const hash = x => createHash('sha256').update(x).digest('hex');
const sources = { runtimeSource: 'a'.repeat(64), files: [] }, evaluatorSha256 = 'b'.repeat(64);
function valid() { return { version: 1, kind: PREDICTION_PREFLIGHT.kind, protocol: PREDICTION_PREFLIGHT.protocol,
  sources, evaluatorSha256, scope: 'scripted-prediction-only', autonomy: false, mainPromotion: false,
  correctness: PREDICTION_PREFLIGHT.requiredChecks.map(name => ({ name, passed: true })),
  review: { status: 'cleared', runtimeSource: sources.runtimeSource, evaluatorSha256 } }; }
test('preflight requires all exact-source frozen checks and bounded scope', () => {
  assert.equal(checkPredictionPreflightShape(valid(), sources, evaluatorSha256), true);
  for (const mutate of [v => { v.version = 2; }, v => { v.protocol = 'autonomy'; }, v => { v.correctness.pop(); },
    v => { v.correctness[0].passed = false; }, v => { v.correctness[1].name = v.correctness[0].name; },
    v => { v.review.status = 'pending'; }, v => { v.review.runtimeSource = 'c'.repeat(64); },
    v => { v.evaluatorSha256 = 'c'.repeat(64); }, v => { v.sources = {}; },
    v => { v.autonomy = true; }, v => { delete v.mainPromotion; }]) {
    const raw = structuredClone(valid()); mutate(raw); assert.throws(() => checkPredictionPreflightShape(raw, sources, evaluatorSha256));
  }
});
test('preflight artifact verification rejects absent, malformed and changed evidence without writes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'prediction-preflight-'));
  try {
    await writeFile(join(dir, 'check.txt'), 'checked\n');
    const ref = { path: 'check.txt', sha256: hash('checked\n') };
    assert.equal((await verifyPredictionArtifact(ref, dir)).contents, 'checked\n');
    await assert.rejects(verifyPredictionArtifact({ ...ref, sha256: '0'.repeat(64) }, dir));
    await assert.rejects(verifyPredictionArtifact({ ...ref, path: 'missing' }, dir));
    await assert.rejects(verifyPredictionArtifact({ path: 'check.txt' }, dir));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
