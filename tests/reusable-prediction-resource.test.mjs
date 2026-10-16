import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { temporalUtf8Bytes } from '../src/temporal-storage.js';
import { validateReusableOutcomeModel } from '../scripts/lib/reusable-outcome-model.mjs';
import { reusableCombinedDictionaryBudget } from '../scripts/lib/reusable-prediction-fixture.mjs';
import { RESOURCE_PROTOCOL, resourceStats, parseResourceArguments, evaluateResourceAdmission,
  checkedActorSize, createSyntheticResourceFixture, runSyntheticAddedDecision, runSyntheticFeedbackBoundary, prepareResourceFixtureCopy,
  runResourceMeasurement, resourceSources, fingerprintPredictionSources } from '../scripts/measure-reusable-prediction.mjs';

// Synthetic structural/resource regressions only. No world, autonomous episode,
// physical request, biological assay or admitting benchmark is run by this file.
const clone = x => structuredClone(x), fingerprint = 'a'.repeat(64);
const ROOT = resolve(import.meta.dirname, '..');
function passingReport() {
  const sources = { runtimeSource: fingerprint, benchmarkSource: fingerprint, designSha256: RESOURCE_PROTOCOL.designSha256,
    preregSha256: fingerprint, files: [{ path: 'scripts/measure-reusable-prediction.mjs', sha256: fingerprint }] };
  const counts = { physicalRows: 192, exposureRows: 64, rows: 256, sensorExposures: 64, sensorReceipts: 384,
    legacyReceipts: 384, legacyIngestions: 64, legacyRows: 256, legacyTransitions: 128, legacyKeys: 256,
    combinedDictionaryEntries: 512, combinedDictionaryBytes: 262140, numericalExposureAdmissions: 64,
    physicalRowsWithReceiptSupport: 192, physicalPrimaryRowsWithNonzeroCosts: 188 };
  return { schemaVersion: 1, kind: RESOURCE_PROTOCOL.kind, smoke: false, quietWindow: true, partial: false, failures: [],
    sourcesBefore: sources, sourcesAfter: clone(sources), legacyInteractiveGate: { status: 'failed-preserved', p95LimitMs: 5 },
    cases: RESOURCE_PROTOCOL.cases.map(name => ({ name, measuredSamples: 200, warmupSamples: 40, fixtureCounts: clone(counts),
      encodedActorAndMetadataBytes: 1048576, inputUnchanged: true, predictionInputUnchanged: true, parameterUpdateWorkOmitted: false, skippedRequiredUpdates: 0,
      rawTimingsMs: Object.fromEntries(['added', 'nativeSensor', 'boundarySensor', 'feedbackSensor', 'labels', 'predictionAndSelection', 'serialization', 'byteGuard', 'reset'].map(k => [k, Array(200).fill(k === 'added' ? 49.9 : 1)])),
      checkedDecisionMs: Array(241).fill(49.9), sampleProofs: Array.from({ length: 200 }, () => ({ exposureBatches: 64, appliedExposureBatches: 64,
        retainedKnownUpdates: 1, closedIntervalUpdates: 1, unknownCapacityRefused: name === 'full-cap-unknown', unknownLegacyContextRefused: name === 'full-cap-unknown' })),
      feedbackProofs: Array.from({ length: 200 }, () => ({ available: true, appliedExposureBatches: 64, deniedBatches: 0, newlyAdmittedWaterReports: 1, emittedPhysicalEvents: 0 })) })),
    sensorCases: RESOURCE_PROTOCOL.cases.map(name => ({ name, measuredSamples: 200, warmupSamples: 40 })) };
}
let saturated;
function fullFixture() { saturated ||= createSyntheticResourceFixture('full-cap-known'); return saturated; }
function copyFixture(value) {
  return prepareResourceFixtureCopy(value);
}

test('resource module is import-safe and exports exact source preflight', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./scripts/measure-reusable-prediction.mjs'); console.log('import-only');"], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, 'import-only\n'); assert.equal(result.stderr, '');
  assert.equal(fingerprintPredictionSources, resourceSources);
});

test('CLI fixes full sample/warmup profile and never admits smoke', () => {
  assert.deepEqual([parseResourceArguments(['--smoke']).samples, parseResourceArguments(['--smoke']).warmups], [1, 0]);
  assert.deepEqual([parseResourceArguments(['--quiet-window']).samples, parseResourceArguments(['--quiet-window']).warmups], [240, 40]);
  for (const args of [[], ['--smoke', '--quiet-window'], ['--samples', '199'], ['--quiet-window', '--warmup', '0'], ['--out']]) assert.throws(() => parseResourceArguments(args));
  const report = passingReport(); report.smoke = true; assert.equal(evaluateResourceAdmission(report).passed, false);
});

test('resource statistics use nearest-rank p95 and reject malformed samples', () => {
  assert.deepEqual(resourceStats([]), { n: 0, p50: null, p95: null, p99: null, max: null, mean: null });
  assert.equal(resourceStats(Array.from({ length: 200 }, (_, i) => i + 1)).p95, 190);
  for (const raw of [[NaN], [Infinity], [-1], '1', [undefined]]) assert.throws(() => resourceStats(raw));
});

test('full gate recomputes p95, checks every maximum and preserves strict boundary', () => {
  const report = passingReport(); assert.equal(evaluateResourceAdmission(report, { expectedSources: report.sourcesBefore }).passed, true);
  for (const change of [r => { r.cases[0].rawTimingsMs.added.fill(50); }, r => { r.cases[0].checkedDecisionMs[0] = 1000.01; },
    r => { r.cases[0].rawTimingsMs.added[0] = 1000.01; }, r => { r.cases[0].encodedActorAndMetadataBytes++; },
    r => { r.cases[0].measuredSamples = 199; }, r => { r.cases[0].warmupSamples = 39; }]) {
    const bad = clone(report); change(bad); assert.equal(evaluateResourceAdmission(bad).passed, false);
  }
  const boundary = clone(report); boundary.cases[0].checkedDecisionMs[0] = 1000; assert.equal(evaluateResourceAdmission(boundary).passed, true);
});

test('preflight rejects incomplete, stale, malformed and under-stressed profiles', () => {
  const report = passingReport();
  for (const change of [r => { r.partial = true; }, r => { r.failures.push({ message: 'original error' }); }, r => { r.cases.pop(); },
    r => { r.cases[2] = clone(r.cases[1]); }, r => { r.sourcesAfter.runtimeSource = 'b'.repeat(64); },
    r => { r.legacyInteractiveGate.status = 'passed'; }, r => { r.cases[1].fixtureCounts.physicalRows = 191; },
    r => { r.cases[1].fixtureCounts.combinedDictionaryBytes = 250000; }, r => { r.cases[1].fixtureCounts.combinedDictionaryEntries = 768; },
    r => { r.cases[1].sampleProofs[0].appliedExposureBatches = 1; }, r => { r.cases[1].sampleProofs[0].closedIntervalUpdates = 0; },
    r => { r.cases[2].sampleProofs[0].unknownLegacyContextRefused = false; }, r => { r.cases[1].skippedRequiredUpdates = 63; },
    r => { r.cases[0].rawTimingsMs.labels = []; }, r => { r.cases[0].rawTimingsMs.added[0] = NaN; },
    r => { r.cases[0].inputUnchanged = false; }, r => { r.sensorCases = []; }, r => { r.cases = {}; }, r => { r.cases[1].sampleProofs[0] = null; },
    r => { r.cases[1].feedbackProofs[0].appliedExposureBatches = 1; }, r => { r.cases[0].checkedDecisionMs = Array(241); }]) {
    const bad = clone(report); change(bad); assert.equal(evaluateResourceAdmission(bad).passed, false);
  }
  assert.equal(evaluateResourceAdmission(report, { expectedSources: { ...report.sourcesBefore, benchmarkSource: 'b'.repeat(64) } }).passed, false);
  assert.equal(evaluateResourceAdmission(null).passed, false);
});

test('whole-actor UTF8 boundary includes raw ordinary fields without mutation', () => {
  const f = createSyntheticResourceFixture('cold'); f.actor.resourceTestPadding = '';
  const input = { ...f, sourceFingerprint: fingerprint }, initial = clone(input), base = checkedActorSize(input);
  assert.deepEqual(input, initial);
  const remaining = 1048576 - base.encodedActorAndMetadataBytes;
  f.actor.resourceTestPadding = '界'.repeat(Math.floor(remaining / 3)) + 'a'.repeat(remaining % 3);
  const exact = checkedActorSize(input); assert.equal(exact.encodedActorAndMetadataBytes, 1048576);
  assert.ok(JSON.stringify(input).length < temporalUtf8Bytes(input), 'Unicode fixture must distinguish bytes from code units');
  f.actor.resourceTestPadding += 'é'; const before = JSON.stringify(input);
  assert.throws(() => checkedActorSize(input), error => error.code === 'REUSABLE_ACTOR_BUDGET' && error.measurement.encodedActorAndMetadataBytes === 1048578);
  assert.equal(JSON.stringify(input), before, 'Rejected size must not trim source actor');
});

test('combined dictionary guard counts both arrays and rejects impossible old512 plus new256', () => {
  const memory = { contextKeys: Array.from({ length: 256 }, (_, i) => `old-${i}`) }, model = { keys: Array.from({ length: 256 }, (_, i) => `new-${i}`) };
  assert.equal(reusableCombinedDictionaryBudget({ memory, model }).keys, 512);
  memory.contextKeys.push(...Array.from({ length: 256 }, (_, i) => `extra-${i}`)); const original = clone(memory);
  assert.throws(() => reusableCombinedDictionaryBudget({ memory, model }), e => e.code === 'REUSABLE_COMBINED_CAPACITY'); assert.deepEqual(memory, original);
  const shared = 'same-string'; assert.equal(reusableCombinedDictionaryBudget({ memory: { contextKeys: [shared] }, model: { keys: [shared] } }).keys, 2);
  const oversize = { contextKeys: ['界'.repeat(87381)] };
  assert.throws(() => reusableCombinedDictionaryBudget({ memory: oversize, model: { keys: [] } }), e => e.code === 'REUSABLE_COMBINED_CAPACITY');
});

test('full synthetic cap fixture is canonical and stresses every declared limit', () => {
  const f = fullFixture(), memory = f.actor.discovery.temporal, before = JSON.stringify(f);
  assert.deepEqual([f.model.rows.length, f.model.rows.filter(r => r.type === 'physical').length, f.model.rows.filter(r => r.type === 'exposure').length], [256, 192, 64]);
  assert.equal(f.model.rows.filter(r => r.type === 'physical' && r.receipts > 0).length, 192);
  assert.equal(f.model.rows.filter(r => r.type === 'physical' && r.T.sum > 0 && r.E.sum > 0 && r.duration.sum > 0).length, 188);
  assert.deepEqual([f.sensor.exposures.length, f.sensor.receipts.length, f.sensor.events.length, memory.receipts.length, memory.ingestions.length,
    memory.model.rows.length, memory.model.transitions.length, memory.contextKeys.length], [64, 384, 128, 384, 64, 256, 128, 256]);
  const dictionary = reusableCombinedDictionaryBudget({ memory, model: f.model }); assert.equal(dictionary.keys, 512); assert.ok(dictionary.dictionaryBytes >= 262100);
  assert.deepEqual(validateReusableOutcomeModel(f.model, f.view.at), f.model);
  const size = checkedActorSize({ ...f, sourceFingerprint: fingerprint }); assert.ok(size.encodedActorAndMetadataBytes <= 1048576);
  assert.ok(size.rawActorAndMetadataBytes > size.encodedActorAndMetadataBytes); assert.equal(JSON.stringify(f), before);
});

test('full retained-known and unknown batches apply all64 exposures and closed T/E once', () => {
  const original = fullFixture(), before = JSON.stringify(original);
  for (const name of ['full-cap-known', 'full-cap-unknown']) {
    const f = copyFixture(original); f.name = name;
    const result = runSyntheticAddedDecision(f);
    assert.equal(result.proof.exposureBatches, 64); assert.equal(result.proof.appliedExposureBatches, 64);
    assert.equal(result.proof.closedIntervalUpdates, 1); assert.equal(result.proof.retainedKnownUpdates, 1);
    assert.equal(result.proof.predictionInputUnchanged, true); assert.equal(result.proof.selectorDraws, 4);
    assert.equal(result.proof.unknownCapacityRefused, name === 'full-cap-unknown');
    assert.equal(result.proof.unknownLegacyContextRefused, name === 'full-cap-unknown');
    assert.equal(f.model.rows.length, 256); assert.equal(f.actor.discovery.temporal.contextKeys.length, 256);
  }
  assert.equal(JSON.stringify(original), before);
});

test('new-feedback overhead uses actual adapter and updates all64 retained exposures', () => {
  const original = fullFixture(), before = JSON.stringify(original), f = copyFixture(original);
  const result = runSyntheticFeedbackBoundary(f);
  assert.equal(result.available, true); assert.equal(result.appliedExposureBatches, 64);
  assert.equal(result.newlyAdmittedWaterReports, 1); assert.equal(result.deniedBatches, 0);
  assert.equal(result.retainedEvents, 128); assert.equal(result.emittedPhysicalEvents, 0);
  assert.equal(f.admission.exposures.length, 64); assert.ok(f.admission.exposures.every(e => e.admitted && e.censored === 0));
  assert.deepEqual(validateReusableOutcomeModel(f.model, f.view.at), f.model); assert.equal(JSON.stringify(original), before);
});

test('new-only output refuses to overwrite completed or partial evidence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'prediction-resource-test-'));
  try {
    const out = join(directory, 'negative.json'); await writeFile(out, '{"partial":true,"failedOriginal5ms":true}\n');
    await assert.rejects(runResourceMeasurement({ ...parseResourceArguments(['--smoke']), out }), e => e.code === 'EEXIST');
    assert.equal(await readFile(out, 'utf8'), '{"partial":true,"failedOriginal5ms":true}\n');
    await assert.rejects(runResourceMeasurement({ smoke: false, quietWindow: true, samples: 199, warmups: 40, out }), /fixed measurement profile/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
