/** Pure evaluator/postprocessing tests. No autonomous episode or resource benchmark runs here. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  PROTOCOL, HEADLESS_PROTOCOL, REQUIRED_CORRECTNESS, parseOptions, expectedTrials, selectApproaches,
  validateHeadlessBudgetReport, validateHeadlessArtifactReferences, headlessRuntimeLimits, compareHeadlessTrials,
  compactTraceEvent, EvidenceMetrics, timingSummary, episodeTimingGate, isContactInjuryEvent, validateBudgetReport, compareCohort, energyChecks,
} from '../scripts/evaluate-finite-temporal.mjs';

const copy = value => structuredClone(value);
const SOURCE = { runtimeSource: 'a'.repeat(64), evaluatorSource: 'b'.repeat(64) };
function recorder() {
  const metrics = new EvidenceMetrics(); let seq = 0, actionId = 0, time = 0, feedbackId = 0;
  const act = (request, result, at = ++time) => {
    time = at; const id = ++seq;
    metrics.ingest({ type: 'submission', seq: id, at, action: request, ordinary: false });
    metrics.ingest({ type: 'outcome', seq: id, at, action: request, actionId: ++actionId, result: { action: request.type, ok: true, durationSeconds: 1, workedSeconds: 1, ...result } });
    return actionId;
  };
  const feedback = (ingestionId, objectId, sampleActionId, effect = 'sustained', at = ++time, extra = {}) => {
    time = at; const event = { id: `feedback:${++feedbackId}`, at, ingestionId, objectId, actionId: sampleActionId, provenance: 'sampled', effect, ...extra };
    metrics.ingest({ type: 'feedback', at, admitted: false, event }); return event;
  };
  return { metrics, act, feedback };
}
function budgetFixture() {
  const stats = timingSummary(Array(200).fill(1));
  const report = { schemaVersion: 1, kind: 'finite-temporal-resource-benchmark', smoke: false,
    finishedAt: '2026-10-16T00:00:00Z', source: { ...SOURCE, benchmarkSource: 'c'.repeat(64) },
    gates: { minimumMeasuredSubmissions: 200, maxAddedDecisionP95Ms: 5, maxEncodedActorBytes: 1048576, passed: true },
    sensorCases: ['cold', 'full-cap-known'].map(name => ({ name, measuredTicks: 200, warmupTicks: 40, sensorPhaseMs: stats, rawMs: { sensor: Array(200).fill(1) } })),
    sensorCompletionCases: ['cold', 'full-cap-known'].map(name => ({ name, measuredBoundaries: 200, warmupBoundaries: 40, sensorPhaseMs: stats, rawMs: { sensor: Array(200).fill(1) }, actualOutcome: { code: 'WAITED', eventId: 1 }, actualPhysicalSubmissions: 1, actualPhysicalOutcomes: 1, physicalSeconds: 5, validationMs: 1 })),
    cases: ['cold', 'full-cap-known', 'full-cap-unknown'].flatMap(name => PROTOCOL.arms.map(arm => ({ name, arm, measuredSubmissions: 200, warmupSubmissions: 40,
      parameterUpdateWorkOmitted: arm === 'frozen-zero', addedDecisionMs: stats, legacyConstructionMs: stats, combinedDecisionMs: stats,
      rawTimingsMs: { added: Array(200).fill(1), construction: Array(200).fill(1), combined: Array(200).fill(1) },
      sampleProofs: Array(200).fill({ syntheticTestProof: true }), validationAndSerializeMs: 1, restoreValidationMs: 1,
      checkpoint: { serializeMs: stats, restoreMs: stats, eventLoopGapMs: stats },
      productionSave: { withTemporalMs: stats, baselineMs: stats, withTemporalEventLoopGapMs: stats, baselineEventLoopGapMs: stats },
      encodedActorAndMetadataBytes: 1048576, gatePassed: true }))) };
  report.rawEvidenceSha256 = createHash('sha256').update(JSON.stringify(report.cases.map(c => ({ name: c.name, arm: c.arm, rawTimingsMs: c.rawTimingsMs, sampleProofs: c.sampleProofs })))).digest('hex');
  return report;
}
function cohortFixture() {
  return expectedTrials('cohort').map((job, i) => ({ ...job, status: 'completed',
    metrics: { primaryCompletionCount: job.arm === 'online' && i < 12 ? 2 : 1, distinctDiscomfortIngestions: 0 },
    energy: { absorbedKcal: 12 }, safety: { collapses: 0, minimumHealth: 100 } }));
}

test('CLI pins both stages and rejects seed, arm, duration, duplicate and implicit-stage overrides', () => {
  const plain = parseOptions(['--stage', 'plain', '--preflight', 'gates.json', '--output', 'new-output']);
  assert.equal(plain.stage, 'plain'); assert.ok(plain.output.endsWith('/new-output'));
  assert.equal(parseOptions(['--stage', 'cohort', '--preflight', 'gates.json', '--output', 'new-output', '--plain-report', 'plain.json']).stage, 'cohort');
  for (const extra of [['--seed', '2'], ['--seconds', '1'], ['--arm', 'online'], ['--stage', 'cohort']]) assert.throws(() => parseOptions(['--stage', 'plain', '--preflight', 'g', '--output', 'o', ...extra]));
  assert.throws(() => parseOptions(['--preflight', 'g', '--output', 'o']));
  assert.throws(() => parseOptions(['--stage', 'cohort', '--preflight', 'g', '--output', 'o']));
  assert.throws(() => parseOptions(['--stage', 'plain', '--preflight', 'g', '--output', 'o', '--plain-report', 'p']));
});
test('fixed schedule retains exactly three plain and eighteen cohort arms with no held-out seeds', () => {
  const plain = expectedTrials('plain'), cohort = expectedTrials('cohort');
  assert.equal(plain.length, 3); assert.equal(cohort.length, 18);
  assert.deepEqual([...new Set(plain.map(t => t.selectorSeed))], [1729]);
  assert.deepEqual([...new Set(cohort.map(t => t.selectorSeed))], [1729, 8191, 65537]);
  assert.ok(plain.every(t => t.seconds === 600 && t.physicalSeed === 74193 && t.status === 'pending'));
  assert.ok(cohort.every(t => t.seconds === 900 && t.physicalSeed === 74193 && t.status === 'pending'));
  assert.equal(new Set(cohort.map(t => t.id)).size, 18); assert.equal(REQUIRED_CORRECTNESS.length, 13);
});
test('fixture picks first collision-valid E/W/N/S offsets and cannot replace an occluded choice', () => {
  const source = { position: { x: 100, y: 100 } };
  const result = selectApproaches(source, 2, (x, y) => x !== 145, () => true);
  assert.deepEqual(result.directions.map(r => r.direction), ['east', 'west', 'north', 'south']);
  assert.deepEqual(result.selected.map(r => r.direction), ['west', 'north']);
  assert.deepEqual(result.selected[0].position, { x: 55, y: 100 });
  assert.throws(() => selectApproaches(source, 2, x => x === 55, () => true), /Too few/);
  assert.throws(() => selectApproaches(source, 1, () => true, from => from.x !== 145), /do not skip/);
});
test('owner trace retains full requests distinct from result.action and bounds repeated candidate keys', () => {
  const event = { type: 'submission', at: 0, seq: 1, action: { type: 'enter_shelter', shelterId: 'refuge' }, choice: {
    context: { focus: true }, key: 'selected-key', utility: 1, known: true, candidates: Array.from({ length: 200 }, (_, i) => ({ action: { type: 'wait', seconds: 5 }, key: `long-key-${i}`, utility: i, known: false })) } };
  const compact = compactTraceEvent(event);
  assert.deepEqual(compact.request, event.action); assert.equal(compact.action, undefined); assert.equal(compact.choice.candidates, undefined);
  assert.equal(compact.choice.candidateSummary.count, 200); assert.equal(compact.choice.candidateSummary.sha256.length, 64);
  assert.equal(compact.choice.candidateSummary.groups.wait.count, 200); assert.equal(compact.choice.key, 'selected-key');
  assert.ok(JSON.stringify(compact).length < 700); assert.equal(event.choice.candidates.length, 200);
  const result = compactTraceEvent({ type: 'outcome', action: { type: 'sample', targetId: 'object:2' }, result: { action: 'sample', code: 'SWALLOWED' } });
  assert.equal(result.request.targetId, 'object:2'); assert.equal(result.result.action, 'sample');
});
test('primary counts exact physical material once across portions and release/regrasp, without learner admission', () => {
  const r = recorder();
  r.act({ type: 'pull', targetId: 'object:1' }, { materialId: 'object:2', code: 'piece_detached' }, 1);
  const first = r.act({ type: 'sample', targetId: 'object:2' }, { ingestionId: 'ingestion:1', code: 'SWALLOWED' }, 2);
  r.feedback('ingestion:1', 'object:2', first, 'sustained', 3);
  r.act({ type: 'release', targetId: 'object:2' }, { code: 'object_released' }, 4);
  const regrasp = r.act({ type: 'grasp', targetId: 'object:2' }, { materialId: 'object:2', code: 'object_held' }, 5);
  const second = r.act({ type: 'sample', targetId: 'object:2' }, { ingestionId: 'ingestion:2', code: 'SWALLOWED' }, 6);
  r.feedback('ingestion:2', 'object:2', second, 'sustained', 7, { thirst: 'easing' });
  const m = r.metrics.finish(10);
  assert.equal(m.primaryCompletionCount, 1); assert.equal(m.F.beneficialPortions, 2); assert.equal(m.F.additionalBeneficialPortions, 1);
  assert.equal(m.repeatedValidSamples, 1); assert.equal(m.distinctAcquiredMaterials, 1); assert.equal(m.acquisitionHistory.length, 2);
  assert.equal(m.W.chains[0].acquisition.actionId, regrasp); assert.equal(m.W.chains[0].acquisition.request.targetId, 'object:2');
  assert.equal(m.W.chains[0].firstAcquisition.request.targetId, 'object:1'); assert.equal(m.acquisitionToFirstSample[0].seconds, 1);
});
test('matching ingestion, physical material and exact sample action ID are all required', () => {
  const r = recorder(); r.act({ type: 'pull', targetId: 'object:1' }, { materialId: 'object:2' }, 1);
  const sample = r.act({ type: 'sample', targetId: 'object:2' }, { ingestionId: 'ingestion:1', code: 'SWALLOWED' }, 2);
  r.feedback('ingestion:other', 'object:2', sample, 'sustained', 3);
  r.feedback('ingestion:1', 'object:3', sample, 'sustained', 4);
  r.feedback('ingestion:1', 'object:2', sample + 1, 'sustained', 5);
  r.feedback('ingestion:1', 'object:2', sample, 'sustained', 6, { provenance: 'assisted' });
  assert.equal(r.metrics.finish(10).primaryCompletionCount, 0); assert.equal(r.metrics.finish(10).unmatchedFeedback, 4);
  r.feedback('ingestion:1', 'object:2', sample, 'sustained', 7);
  assert.equal(r.metrics.finish(10).primaryCompletionCount, 1);
});
test('later acquisition never retroactively attributes an earlier swallow or old feedback', () => {
  const r = recorder(), sample = r.act({ type: 'sample', targetId: 'object:2' }, { ingestionId: 'ingestion:1', code: 'SWALLOWED' }, 1);
  r.act({ type: 'grasp', targetId: 'object:2' }, { materialId: 'object:2' }, 2);
  r.feedback('ingestion:1', 'object:2', sample, 'sustained', 3);
  const result = r.metrics.finish(10);
  assert.equal(result.primaryCompletionCount, 0); assert.equal(result.channels.F, 1);
  assert.equal(result.acquisitionToFirstSample[0].rightCensored, true); assert.equal(result.acquisitionToFirstSample[0].seconds, 8);
});
test('F and W remain separate; discomfort plus water and repeated feedback count each ingestion/channel once', () => {
  const r = recorder(); r.act({ type: 'pull', targetId: 'object:1' }, { materialId: 'object:2' }, 1);
  const sample = r.act({ type: 'sample', targetId: 'object:2' }, { ingestionId: 'ingestion:1', code: 'SWALLOWED' }, 2);
  const event = r.feedback('ingestion:1', 'object:2', sample, 'discomfort', 3, { thirst: 'easing' });
  r.metrics.ingest({ type: 'feedback', at: event.at, admitted: true, event });
  r.feedback('ingestion:1', 'object:2', sample, 'water relief', 4);
  r.act({ type: 'release', targetId: 'object:2' }, { code: 'object_released' }, 5);
  const m = r.metrics.finish(10);
  assert.deepEqual(m.channels, { F: 0, W: 1, H: 1 }); assert.equal(m.W.distinctMaterials, 1); assert.equal(m.primaryCompletionCount, 0);
  assert.equal(m.distinctDiscomfortIngestions, 1); assert.equal(m.releasesAfterHarm, 1); assert.equal(m.releasesBeforeAnySample, 0);
});
test('censoring records zero-acquisition cases and unfinished sample channels without inventing a terminal', () => {
  const r = recorder(); r.act({ type: 'pull', targetId: 'object:1' }, { materialId: 'object:2' }, 2);
  r.act({ type: 'release', targetId: 'object:2' }, { code: 'object_released' }, 3);
  r.act({ type: 'pull', targetId: 'object:1' }, { materialId: 'object:3' }, 4);
  r.act({ type: 'sample', targetId: 'object:3' }, { ingestionId: 'ingestion:1', code: 'SWALLOWED' }, 6);
  r.metrics.ingest({ type: 'submission', seq: 5, at: 9, action: { type: 'wait', seconds: 5 }, ordinary: true, choice: { known: false, exploring: true } });
  const m = r.metrics.finish(10);
  assert.deepEqual(m.pendingSubmissionSeqs, [5]); assert.equal(m.releasesBeforeAnySample, 1);
  assert.equal(m.acquisitionToFirstSample[0].rightCensored, true); assert.equal(m.acquisitionToFirstSample[0].seconds, 8);
  assert.equal(m.F.sampleLatencies[0].rightCensored, true); assert.equal(m.F.sampleLatencies[0].seconds, 4);
  assert.equal(m.W.sampleLatencies[0].rightCensored, true); assert.equal(m.choices.unknownFraction, 1);
  assert.equal(m.primaryCompletionCount, 0); assert.deepEqual(r.metrics.finish(10), m, 'finishing is inert');
});
test('real work, completed duration and immediate zero-work refusals remain distinct', () => {
  const r = recorder();
  r.act({ type: 'rest', seconds: 30 }, { ok: false, code: 'UNSAFE_TO_REST', workedSeconds: 0, durationSeconds: 0 }, 1);
  r.act({ type: 'strike', targetId: 'object:1' }, { ok: false, code: 'CONTACT_ESCAPE', workedSeconds: .3, durationSeconds: .3 }, 2);
  r.act({ type: 'strike', targetId: 'object:1' }, { ok: true, code: 'object_struck', workedSeconds: 2, durationSeconds: 2 }, 3);
  const m = r.metrics.finish(10);
  assert.equal(m.primitiveWork.rest.zeroWorkRefusals, 1); assert.equal(m.primitiveWork.strike.zeroWorkRefusals, 0);
  assert.equal(m.primitiveWork.strike.workedSeconds, 2.3); assert.equal(m.primitiveWork.strike.positiveWorkCompletions, 2);
  assert.equal(m.productivePrimitiveDiversity, 0, 'striking unchanged terrain is not declared useful');
});
test('conflicting IDs or mutated request evidence fail rather than silently becoming normal outcomes', () => {
  const r = recorder();
  r.metrics.ingest({ type: 'submission', seq: 1, at: 1, action: { type: 'pull', targetId: 'object:1' } });
  assert.throws(() => r.metrics.ingest({ type: 'outcome', seq: 1, at: 2, action: { type: 'pull', targetId: 'object:3' }, actionId: 1, result: { ok: true, action: 'pull' } }), /differs/);
  assert.throws(() => r.metrics.ingest({ type: 'submission', seq: 1, at: 2, action: { type: 'wait', seconds: 5 } }), /Duplicate/);
});
test('resource summaries report exact nearest-rank tails and budget rejects smoke, weak or wrong-source evidence', () => {
  assert.equal(timingSummary(Array.from({ length: 200 }, (_, i) => i + 1)).p95, 190);
  assert.equal(timingSummary([]).p95, null);
  assert.equal(validateBudgetReport(budgetFixture(), SOURCE), true);
  for (const modify of [b => { b.smoke = true; }, b => { b.source = { ...SOURCE, runtimeSource: 'c'.repeat(64) }; }, b => { b.cases[0].measuredSubmissions = 199; },
    b => { b.cases[0].addedDecisionMs.p95 = 5.00001; }, b => { b.cases[0].encodedActorAndMetadataBytes++; }, b => { b.cases[0].warmupSubmissions = 0; },
    b => { b.cases[0].name = 'chosen-better-case'; }, b => { b.cases[0].rawTimingsMs.added[0] = 9; }, b => { b.sensorCases = []; }, b => { b.cases.pop(); }, b => { b.gates.passed = false; }]) {
    const b = budgetFixture(); modify(b); assert.throws(() => validateBudgetReport(b, SOURCE));
  }
});
test('contact injury counts require actual CONTACT_INJURY condition receipts, separate from gross physiology injury', () => {
  assert.equal(isContactInjuryEvent({ type: 'condition', details: { code: 'CONTACT_INJURY' } }), true);
  assert.equal(isContactInjuryEvent({ type: 'condition', details: { code: 'DISCOVERY_EFFECT', feedback: { effect: 'discomfort' } } }), false);
  assert.equal(isContactInjuryEvent({ type: 'condition', details: { code: 'DEHYDRATION' } }), false);
  assert.equal(isContactInjuryEvent({ type: 'action', details: { code: 'CONTACT_INJURY' } }), false);
  assert.equal(isContactInjuryEvent({ stats: { injuries: 10 } }), false);
});
test('actual episode timing gate retains cold/tail and sink-inclusive samples without manufacturing warmup decisions', () => {
  const short = episodeTimingGate([1, 2, 5]);
  assert.equal(short.passed, true); assert.equal(short.fewerThan200Decisions, true);
  assert.equal(short.summary.n, 3); assert.equal(short.warmupExcluded, 0); assert.equal(short.ownerSinkOverheadIncluded, true);
  assert.equal(episodeTimingGate([1, 2, 5.01]).passed, false);
  assert.equal(episodeTimingGate([]).passed, false);
  const cold = Array(200).fill(1); cold.fill(6, 0, 11);
  assert.equal(episodeTimingGate(cold).passed, false, 'cold samples are not silently removed');
});
test('cohort requires four matched wins, pooled absorption and every safety pair, with explicit effect sizes', () => {
  const trials = cohortFixture(), result = compareCohort(trials);
  assert.equal(result.promisingDevelopmentGatePassed, true); assert.equal(result.matchedStartsBeatingBothControls, 4); assert.equal(result.pairs.length, 12);
  for (const mutate of [ts => { ts[0].safety.collapses = 1; }, ts => { ts[0].safety.minimumHealth = 99.99; }, ts => { ts[0].metrics.distinctDiscomfortIngestions = 1; },
    ts => { ts[0].energy.absorbedKcal = 11; }, ts => { ts[0].metrics.primaryCompletionCount = 1; }, ts => { ts[0].status = 'invalid'; }]) {
    const ts = copy(trials); mutate(ts); assert.equal(compareCohort(ts).promisingDevelopmentGatePassed, false);
  }
  const tolerated = copy(trials); tolerated[0].safety.minimumHealth -= 5e-7; tolerated[0].energy.absorbedKcal -= 5e-7;
  assert.equal(compareCohort(tolerated).promisingDevelopmentGatePassed, true);
});
test('cohort allows each control to lose on different sets of four matched starts', () => {
  const trials = cohortFixture();
  for (const trial of trials) {
    const start = trial.approachIndex * 3 + PROTOCOL.cohort.selectorSeeds.indexOf(trial.selectorSeed);
    trial.metrics.primaryCompletionCount = trial.arm === 'online' ? 2 : trial.arm === 'no-bootstrap' ? start < 4 ? 1 : 3 : start >= 2 ? 1 : 3;
  }
  const result = compareCohort(trials);
  assert.deepEqual(result.matchedStartWinsByControl, { 'no-bootstrap': 4, 'frozen-zero': 4 });
  assert.equal(result.matchedStartsBeatingBothControls, 2);
  assert.equal(result.promisingDevelopmentGatePassed, true, 'preregistered per-control four-of-six gate does not require identical winning starts');
});
test('energy accounting separates swallowed, pending, absorbed, spent and reserves with 1e-6 residual gate', () => {
  const opening = { reservesKcal: 100, pendingKcal: 10, waterDeficitMl: 100,
    totals: { ingestedKcal: 0, ingestedWaterMl: 0, absorbedKcal: 0, absorbedWaterMl: 0, metabolizedKcal: 0, discardedKcal: 0 },
    ecologyLedger: { humanRemovedKcal: 0, externalKcal: 0 }, assistance: { count: 0, energyKcal: 0, waterMl: 0 }, rescues: 0 };
  const closing = copy(opening); closing.reservesKcal = 105; closing.pendingKcal = 13; closing.totals = { ...opening.totals, ingestedKcal: 20, absorbedKcal: 17, metabolizedKcal: 12 }; closing.ecologyLedger.humanRemovedKcal = 20;
  const e = energyChecks(opening, closing); assert.equal(e.energyResidualKcal, 0); assert.equal(e.swallowedKcal, 20); assert.equal(e.absorbedKcal, 17); assert.equal(e.pendingClosingKcal, 13); assert.equal(e.spentKcal, 12);
  assert.deepEqual(e.checks, { energyConservation: true, finiteTransfer: true, noAssistance: true });
  closing.reservesKcal += 2e-6; assert.equal(energyChecks(opening, closing).checks.energyConservation, false);
  closing.assistance.count = 1; assert.equal(energyChecks(opening, closing).checks.noAssistance, false);
});
test('missing preflight creates durable blocked rows for every expected trial and never launches an episode', async () => {
  const parent = await mkdtemp(resolve(tmpdir(), 'finite-evaluator-gate-')), output = resolve(parent, 'new');
  try {
    const child = spawnSync(process.execPath, ['scripts/evaluate-finite-temporal.mjs', '--stage', 'cohort', '--preflight', resolve(parent, 'missing.json'), '--plain-report', resolve(parent, 'missing-plain.json'), '--output', output], { cwd: resolve(import.meta.dirname, '..'), encoding: 'utf8' });
    assert.equal(child.status, 1);
    const result = JSON.parse(await readFile(resolve(output, 'report.json'), 'utf8'));
    assert.equal(result.status, 'failed'); assert.equal(result.trials.length, 18); assert.ok(result.trials.every(t => t.status === 'blocked'));
    assert.equal(result.fixture, undefined); assert.equal(result.trials.some(t => t.trace), false);
    const again = spawnSync(process.execPath, ['scripts/evaluate-finite-temporal.mjs', '--stage', 'plain', '--preflight', 'missing', '--output', output], { cwd: resolve(import.meta.dirname, '..'), encoding: 'utf8' });
    assert.equal(again.status, 1); assert.equal(JSON.parse(await readFile(resolve(output, 'report.json'), 'utf8')).trials.length, 18, 'existing output is never overwritten');
  } finally { await rm(parent, { recursive: true, force: true }); }
});


function headlessBudgetFixture(p95 = 6) {
  const budget = budgetFixture();
  budget.source.evaluatorSource = HEADLESS_PROTOCOL.originalEvaluatorSha256;
  budget.gates.passed = false;
  const row = budget.cases[3];
  row.rawTimingsMs.added = Array(row.measuredSubmissions).fill(p95);
  row.addedDecisionMs = timingSummary(row.rawTimingsMs.added);
  row.gatePassed = p95 <= 5;
  budget.rawEvidenceSha256 = createHash('sha256').update(JSON.stringify(budget.cases.map(c => ({ name: c.name, arm: c.arm, rawTimingsMs: c.rawTimingsMs, sampleProofs: c.sampleProofs })))).digest('hex');
  return budget;
}
test('headless diagnostic has an explicit separate three-arm stage and cannot accept cohort progression flags', () => {
  const options = parseOptions(['--stage', HEADLESS_PROTOCOL.name, '--preflight', 'headless.json', '--output', 'new-output']);
  assert.equal(options.stage, 'headless-diagnostic-v1');
  const jobs = expectedTrials(options.stage);
  assert.equal(jobs.length, 3);
  assert.deepEqual(jobs.map(j => j.arm), ['online', 'no-bootstrap', 'frozen-zero']);
  assert.ok(jobs.every(j => j.seconds === 600 && j.selectorSeed === 1729 && j.physicalSeed === 74193 && j.approachIndex === 0));
  assert.equal(HEADLESS_PROTOCOL.nativeStepSeconds, 1 / 60); assert.equal(HEADLESS_PROTOCOL.capacityProfile, 'finite-temporal-v1');
  assert.equal(HEADLESS_PROTOCOL.cohortProgressionAllowed, false);
  assert.throws(() => parseOptions(['--stage', HEADLESS_PROTOCOL.name, '--preflight', 'g', '--output', 'o', '--plain-report', 'plain.json']));
  assert.equal(expectedTrials('plain').length, 3); assert.equal(expectedTrials('cohort').length, 18);
});
test('headless alternate admission retains original failed budget and leaves strict 5 ms rejection unchanged', () => {
  const budget = headlessBudgetFixture(), before = copy(budget);
  assert.throws(() => validateBudgetReport(budget, { ...SOURCE, evaluatorSource: HEADLESS_PROTOCOL.originalEvaluatorSha256 }));
  const admission = validateHeadlessBudgetReport(budget, SOURCE);
  assert.equal(admission.admitted, true); assert.equal(admission.originalInteractiveGatePassed, false);
  assert.equal(admission.originalGates.passed, false); assert.equal(admission.cohortProgressionAllowed, false);
  assert.equal(admission.originalCaseResults[3].originalGatePassed, false);
  assert.deepEqual(budget, before, 'original failed report is never rewritten into a passing copy');
  assert.throws(() => validateHeadlessBudgetReport(budgetFixture(), SOURCE), 'an originally passing report is not this diagnostic provenance');
});
test('headless admission uses strict below-50 ms and unchanged one-MiB thresholds', () => {
  assert.equal(validateHeadlessBudgetReport(headlessBudgetFixture(49.999), SOURCE).admitted, true);
  assert.throws(() => validateHeadlessBudgetReport(headlessBudgetFixture(50), SOURCE));
  assert.throws(() => validateHeadlessBudgetReport(headlessBudgetFixture(50.001), SOURCE));
  const tooBig = headlessBudgetFixture(); tooBig.cases[3].encodedActorAndMetadataBytes = 1048577;
  assert.throws(() => validateHeadlessBudgetReport(tooBig, SOURCE));
  const changedOriginal = headlessBudgetFixture(); changedOriginal.cases[3].gatePassed = true;
  assert.throws(() => validateHeadlessBudgetReport(changedOriginal, SOURCE), /altered/);
  const changedSource = headlessBudgetFixture(); changedSource.source.evaluatorSource = SOURCE.evaluatorSource;
  assert.throws(() => validateHeadlessBudgetReport(changedSource, SOURCE), /Historical/);
});
test('headless provenance pins both original failed bytes and the historical evaluator artifact', () => {
  const preflight = { originalBudget: { sha256: HEADLESS_PROTOCOL.originalBudgetSha256 }, originalEvaluator: { sha256: HEADLESS_PROTOCOL.originalEvaluatorSha256 } };
  assert.equal(validateHeadlessArtifactReferences(preflight), true);
  for (const field of ['originalBudget', 'originalEvaluator']) {
    const altered = copy(preflight); altered[field].sha256 = 'f'.repeat(64);
    assert.throws(() => validateHeadlessArtifactReferences(altered), /preserved unchanged/);
  }
});
test('headless resource stop checks include final-frame decisions and wall deadlines, with deterministic physics unchanged', () => {
  assert.equal(headlessRuntimeLimits({ returnedDecisionMs: 1000, wallSeconds: 299.999 }).stopped, false);
  const slowFinalDecision = headlessRuntimeLimits({ returnedDecisionMs: 1000.001, wallSeconds: 200 });
  assert.equal(slowFinalDecision.stopped, true); assert.equal(slowFinalDecision.decisionExceeded, true); assert.equal(slowFinalDecision.checkedAfterReturn, true);
  assert.equal(headlessRuntimeLimits({ returnedDecisionMs: 1, wallSeconds: 300 }).wallExceeded, false);
  assert.equal(headlessRuntimeLimits({ returnedDecisionMs: 1, wallSeconds: 300.001 }).wallExceeded, true);
  assert.equal(headlessRuntimeLimits({ returnedDecisionMs: null, wallSeconds: 301 }).stopped, true, 'setup or finalization without another decision is charged');
  const beforeFinalization = headlessRuntimeLimits({ returnedDecisionMs: 1, wallSeconds: 299.9 });
  const afterTraceCloseAndSourceHash = headlessRuntimeLimits({ returnedDecisionMs: 1, wallSeconds: 300.1 });
  assert.equal(beforeFinalization.stopped, false); assert.equal(afterTraceCloseAndSourceHash.stopped, true, 'returned-trial finalization crossing cannot remain completed');
  assert.equal(HEADLESS_PROTOCOL.nativeStepSeconds, PROTOCOL.nativeStepSeconds);
  assert.equal(HEADLESS_PROTOCOL.restartAfterExternalHardKillAllowed, false);
  assert.equal(HEADLESS_PROTOCOL.externalParentWatchdogRequired, true);
});
test('headless comparisons require all three complete trials and never turn absent or partial evidence into zero efficacy', () => {
  const trials = expectedTrials(HEADLESS_PROTOCOL.name).map(job => ({ ...job, status: 'completed', elapsedSeconds: 600, stopAt: 600,
    initialStateSha256: 'a'.repeat(64), checks: { actorCapacity: true, headlessResourceLimits: true }, metrics: { primaryCompletionCount: job.arm === 'online' ? 1 : 0, distinctDiscomfortIngestions: 0 },
    energy: { absorbedKcal: 5 }, safety: { collapses: 0, minimumHealth: 100 } }));
  assert.equal(compareHeadlessTrials(trials).comparisonEligible, true);
  assert.equal(compareHeadlessTrials(trials).cohortProgressionAllowed, false);
  for (const status of ['pending', 'blocked', 'resource-stopped', 'interrupted', 'invalid']) {
    const partial = copy(trials); partial[0].status = status; delete partial[0].metrics;
    const result = compareHeadlessTrials(partial);
    assert.equal(result.comparisonEligible, false); assert.deepEqual(result.pairs, []);
  }
  assert.equal(compareHeadlessTrials(trials.slice(0, 2)).comparisonEligible, false);
  const missingInitial = copy(trials); delete missingInitial[0].initialStateSha256;
  assert.equal(compareHeadlessTrials(missingInitial).matchingInitialStates, null);
  assert.equal(compareHeadlessTrials(missingInitial).comparisonEligible, false);
});
