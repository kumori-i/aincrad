/**
 * Owner-only preregistered finite-temporal evaluator. Importing this file runs no trial.
 *
 * node scripts/evaluate-finite-temporal.mjs --stage plain --preflight gates.json --output NEW_DIRECTORY
 * node scripts/evaluate-finite-temporal.mjs --stage cohort --preflight gates.json --plain-report PRIOR/report.json --output NEW_DIRECTORY
 * node scripts/evaluate-finite-temporal.mjs --stage headless-diagnostic-v1 --preflight headless-gates.json --output NEW_DIRECTORY
 *
 * No seed, duration, arm, body, start-selection or policy overrides are accepted.
 * Output is an exclusive new directory, with atomic report.json, append-only owner
 * traces and exact stop-state evidence. Nothing in this file feeds owner data back
 * into the policy. An external preflight attests existing test/review evidence;
 * this evaluator does not invent correctness or benchmark clearance.
 *
 * Preflight schema: {schemaVersion:1,kind:'finite-temporal-preflight',
 * source:{runtimeSource,evaluatorSource},
 * correctness:{passed:true,checks:[{name,passed:true,evidence:{path,sha256}}]},
 * review:{status:'cleared',evidence:{path,sha256}},budget:{path,sha256}}.
 * Paths resolve relative to the preflight file. Every evidence file is hashed.
 * REQUIRED_CORRECTNESS below lists the exact check names. Budget must be a full
 * finite-temporal-resource-benchmark report with all nine fixed cases passing.
 *
 * Separate headless preflight: kind:'finite-temporal-headless-preflight',
 * protocol:'headless-diagnostic-v1', the same current source/correctness/review
 * fields, evaluatorTests:{path,sha256}, originalBudget:{path,sha256}, and
 * originalEvaluator:{path,sha256}. The last two artifacts are hard-pinned below.
 * It retains the original interactive FAIL and uses a distinct <50 ms admission.
 * External parent-process watchdog is required for non-returning synchronous calls;
 * this process checks >1000 ms decisions only after return and a 300 s arm deadline.
 * Hard-killed evidence is only the last durable prefix; no restart/retry is allowed.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { openSync, closeSync, writeSync, fsyncSync, readFileSync, renameSync } from 'node:fs';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { createNpc } from '../src/npc-state.js';
import { createEnvironment } from '../src/environment.js';
import { createCommunity } from '../src/social.js';
import { canStand } from '../src/world.js';
import { lineOfSight } from '../src/perception.js';
import { DISCOVERY_RULES } from '../src/discovery-config.js';
import { encodeTemporalWire, temporalUtf8Bytes } from '../src/temporal-storage.js';
import { FINITE_TEMPORAL_PROFILE, checkTemporalCapacity } from '../src/temporal-capacity.js';
import { FiniteTemporalDriver } from './lib/finite-temporal-driver.mjs';
import { FINITE_CHECKPOINT } from './lib/finite-temporal-checkpoint.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = value => createHash('sha256').update(value).digest('hex');
const digest = value => hash(JSON.stringify(value));
const copy = value => structuredClone(value);
const sum = (rows, field) => rows.reduce((total, row) => total + (row[field] || 0), 0);
const finite = value => Number.isFinite(value) && value >= 0;
const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const PROTOCOL = Object.freeze({
  name: 'finite-temporal-v1', version: 1, physicalSeed: 74193, nativeStepSeconds: 1 / 60,
  distance: 45, directions: ['east', 'west', 'north', 'south'],
  arms: ['online', 'no-bootstrap', 'frozen-zero'],
  plain: { seconds: 600, approaches: 1, selectorSeeds: [1729] },
  cohort: { seconds: 900, approaches: 2, selectorSeeds: [1729, 8191, 65537] },
  trajectoryEverySeconds: 1, resourceEverySeconds: 15, persistEverySeconds: 30,
  actorBytes: 1024 * 1024, episodeAddedDecisionP95Ms: 5, tolerance: 1e-6,
});
export const HEADLESS_PROTOCOL = Object.freeze({
  name: 'headless-diagnostic-v1', version: 1, physicalSeed: 74193, nativeStepSeconds: 1 / 60,
  distance: 45, directions: ['east', 'west', 'north', 'south'],
  arms: ['online', 'no-bootstrap', 'frozen-zero'], seconds: 600, approaches: 1, selectorSeeds: [1729],
  capacityProfile: 'finite-temporal-v1', actorBytes: 1024 * 1024,
  admissionP95ExclusiveMs: 50, maximumReturnedDecisionMs: 1000, wallBudgetSecondsPerArm: 300,
  originalEvaluatorSha256: 'bb71b76ba84a1522569973284fc816d1c44781ab84c1bd5b217a0d9963fc513e',
  originalBudgetSha256: 'eabb0c3b890d9c946ce69192cffea9f4adf389bd39c363bafa94c34358efe2e4',
  originalInteractiveGatePassed: false, cohortProgressionAllowed: false,
  externalParentWatchdogRequired: true, restartAfterExternalHardKillAllowed: false,
});
export const REQUIRED_CORRECTNESS = Object.freeze([
  'no-work-and-canceled-work', 'ledger-and-return-math', 'old-meal-confounding',
  'opaque-id-renaming', 'known-unknown-saturation', 'proposal-commit-rng',
  'forced-care-sleep-feedback', 'over-400-decisions-proof-eviction-reopen',
  'unknown-context-gaps', 'malformed-future-history', 'legacy-controller-parity',
  'no-default-runtime-change', 'checkpoint-and-actor-budget',
]);
const LIMITATIONS = [
  'Controlled physical placement 45 units from the first existing fruit source; owner-only source identity is never given to the policy. This is not autonomous source discovery or a survival claim.',
  'Fresh default discovery body, one cold-start actor, unchanged copied seed-74193 world and resources in every trial. No intervention, handoff, nutrition label, LLM, dialogue or Cardinal.',
  'Each arm has shared candidate construction, foodLearning:false, care, masks and four selector draws per actual ordinary submission. Frozen-zero omits parameter training work; ordinary harm aversion remains.',
  'Complete requests, results and biological events retain original IDs and timestamps. Trace order breaks equal-timestamp ties. Owner trajectories and material/source diagnostics never enter policy inputs.',
  'Observed continuation is not causal credit proof; F does not rule out later harm. W and additional beneficial portions are reported separately.',
  'Stops are continuing/right-censored. No terminal update, extra completion or physiological rollback occurs. Cleanup happens only after stop evidence has been written.',
  'Conservative protocol clarification before autonomy: actual-episode added-decision p95 must be <=5 ms over all captured decisions, including cold/tail samples and owner sink overhead. Timing failures finish the fixed horizon when otherwise safe, remain reported, and block cohort progression. A short episode does not invent decisions to reach 200 samples; the separate preflight still requires >=200 warmed benchmark submissions.',
  'Timings are this cloud CPU only; per-tick sensor work and owner trace/measurement overhead are disclosed separately. No desktop responsiveness or laptop performance claim.',
];

export function parseOptions(argv) {
  const out = {};
  const keys = new Map([['--stage', 'stage'], ['--output', 'output'], ['--preflight', 'preflight'], ['--plain-report', 'plainReport']]);
  for (let i = 0; i < argv.length; i += 2) {
    const key = keys.get(argv[i]), value = argv[i + 1];
    assert.ok(key && value && !value.startsWith('--'), `Unknown, duplicate or missing option: ${argv[i]}`);
    assert.ok(!Object.hasOwn(out, key), `Duplicate option: ${argv[i]}`);
    out[key] = key === 'stage' ? value : resolve(value);
  }
  assert.ok(['plain', 'cohort', HEADLESS_PROTOCOL.name].includes(out.stage), 'Explicit --stage plain, cohort or headless-diagnostic-v1 is required.');
  assert.ok(out.output && out.preflight, '--output NEW_DIRECTORY and --preflight FILE are required.');
  assert.equal(Boolean(out.plainReport), out.stage === 'cohort', 'Only cohort requires --plain-report.');
  return out;
}
export function expectedTrials(stage) {
  assert.ok(['plain', 'cohort', HEADLESS_PROTOCOL.name].includes(stage));
  const spec = stage === HEADLESS_PROTOCOL.name ? HEADLESS_PROTOCOL : PROTOCOL[stage];
  return Array.from({ length: spec.approaches }, (_, approachIndex) => spec.selectorSeeds.flatMap(selectorSeed => PROTOCOL.arms.map(arm => ({
    id: `${stage}-approach${approachIndex + 1}-seed${selectorSeed}-${arm}`,
    approachIndex, selectorSeed, arm, seconds: spec.seconds, physicalSeed: PROTOCOL.physicalSeed, status: 'pending',
  })))).flat();
}
async function treeFiles(root, directory) {
  const files = [];
  for (const entry of await readdir(resolve(root, directory), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await treeFiles(root, path));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`Unexpected source entry: ${path}`);
  }
  return files;
}
export async function fingerprintSources(root = ROOT) {
  const paths = [...await treeFiles(root, 'src'), ...await treeFiles(root, 'scripts/lib'), 'package.json', 'package-lock.json'].sort();
  const files = [];
  for (const path of paths) files.push({ path, sha256: hash(await readFile(resolve(root, path))) });
  const runtimeSource = hash(files.map(row => `${row.path}\0${row.sha256}\n`).join(''));
  const evaluatorSource = hash(await readFile(resolve(root, 'scripts/evaluate-finite-temporal.mjs')));
  return { runtimeSource, evaluatorSource, frozenSource: digest({ runtimeSource, evaluatorSource }), files };
}
export function selectApproaches(source, count, collision = canStand, visible = lineOfSight) {
  assert.ok(source?.position && count >= 1 && count <= 2, 'Missing first fruit source.');
  const p = source.position, d = PROTOCOL.distance;
  const offsets = [{ x: d, y: 0 }, { x: -d, y: 0 }, { x: 0, y: -d }, { x: 0, y: d }];
  const directions = offsets.map((offset, index) => {
    const position = { x: p.x + offset.x, y: p.y + offset.y };
    return { direction: PROTOCOL.directions[index], position, collisionValid: collision(position.x, position.y, 'valley'),
      inReach: Math.hypot(offset.x, offset.y) <= DISCOVERY_RULES.reach, lineOfSight: visible(position, p, 'valley') };
  });
  const selected = directions.filter(row => row.collisionValid).slice(0, count);
  const failFixture = message => { const error = new Error(message); error.fixtureEvidence = { directions, selected }; throw error; };
  if (selected.length !== count) failFixture('Too few fixed collision-valid approaches; no replacement fixture is permitted.');
  if (!selected.every(row => row.inReach && row.lineOfSight)) failFixture('Selected collision-valid approach is unreachable; do not skip it.');
  return { directions, selected };
}
export function compactTraceEvent(event) {
  const out = copy(event);
  if (out.type === 'submission' || out.type === 'outcome') {
    out.request = out.action;
    delete out.action;
    assert.ok(out.request?.type, 'Every action event must retain its full actual request.');
  }
  if (out.choice?.candidates) {
    const candidates = out.choice.candidates;
    const groups = {};
    for (const row of candidates) {
      const key = row.action.type;
      const group = groups[key] ||= { count: 0, known: 0, minUtility: null, maxUtility: null };
      group.count++; group.known += Number(row.known === true);
      if (Number.isFinite(row.utility)) {
        group.minUtility = group.minUtility === null ? row.utility : Math.min(group.minUtility, row.utility);
        group.maxUtility = group.maxUtility === null ? row.utility : Math.max(group.maxUtility, row.utility);
      }
    }
    out.choice.candidateSummary = { count: candidates.length, sha256: digest(candidates), groups };
    delete out.choice.candidates;
  }
  return out;
}

/** Strict causal postprocessing of complete owner receipts, independent of bounded policy memory. */
export class EvidenceMetrics {
  constructor() {
    this.submissions = new Map(); this.completed = new Set(); this.actionIds = new Set(); this.feedbackIds = new Map();
    this.acquisitions = new Map(); this.latestAcquisitions = new Map(); this.acquisitionHistory = []; this.swallows = new Map(); this.firstSamples = new Map(); this.harmedItems = new Set();
    this.releases = []; this.primitives = {}; this.channels = { F: 0, W: 0, H: 0 };
    this.ordinary = 0; this.known = 0; this.exploring = 0; this.unmatchedFeedback = 0; this.order = 0;
  }
  ingest(event) {
    const e = event.request ? event : compactTraceEvent(event), order = ++this.order;
    if (e.type === 'submission') {
      assert.ok(Number.isInteger(e.seq) && !this.submissions.has(e.seq), 'Duplicate submission sequence.');
      this.submissions.set(e.seq, { ...copy(e), order });
      const stats = this.primitives[e.request.type] ||= { requests: 0, completions: 0, successes: 0, failures: 0, zeroWorkRefusals: 0, positiveWorkCompletions: 0, workedSeconds: 0, completedDurationSeconds: 0, productiveSuccesses: 0 };
      stats.requests++;
      if (e.ordinary) { this.ordinary++; this.known += Number(e.choice?.known === true); this.exploring += Number(e.choice?.exploring === true); }
    } else if (e.type === 'outcome') {
      const request = this.submissions.get(e.seq), result = e.result;
      assert.ok(request && !this.completed.has(e.seq), 'Missing or duplicated completion submission.');
      assert.deepEqual(e.request, request.request, 'Completion request differs from actual submission.');
      assert.ok(e.at >= request.at && result && result.action === e.request.type, 'Invalid result action or chronology.');
      assert.ok(Number.isInteger(e.actionId) && !this.actionIds.has(e.actionId), 'Missing or duplicate authoritative action ID.');
      this.actionIds.add(e.actionId); this.completed.add(e.seq);
      const stats = this.primitives[e.request.type], worked = result.workedSeconds || 0, duration = result.durationSeconds || 0;
      stats.completions++; stats.successes += Number(result.ok === true); stats.failures += Number(result.ok !== true);
      stats.workedSeconds += worked; stats.completedDurationSeconds += duration;
      stats.positiveWorkCompletions += Number(worked > 0);
      stats.zeroWorkRefusals += Number(!result.ok && worked === 0 && duration === 0);
      const productive = ['OBJECT_OBSERVED', 'object_observed', 'object_held', 'piece_detached', 'SWALLOWED', 'object_released', 'object_recoiled', 'object_stopped_moving'].includes(result.code);
      stats.productiveSuccesses += Number(result.ok === true && productive);
      if (!result.ok) return;
      const receipt = { seq: e.seq, at: e.at, actionId: e.actionId, request: copy(e.request), order };
      if (['pull', 'grasp'].includes(e.request.type)) {
        const materialId = result.materialId || (e.request.type === 'grasp' ? e.request.targetId : null);
        if (materialId) {
          const acquisition = { ...receipt, materialId }; this.acquisitionHistory.push(acquisition);
          this.latestAcquisitions.set(materialId, acquisition);
          if (!this.acquisitions.has(materialId)) this.acquisitions.set(materialId, acquisition);
        }
      }
      if (e.request.type === 'sample' && result.code === 'SWALLOWED') {
        assert.ok(result.ingestionId && !this.swallows.has(result.ingestionId), 'Missing or duplicate successful ingestion.');
        const materialId = e.request.targetId, acquisition = this.latestAcquisitions.get(materialId) || null;
        const swallow = { ...receipt, materialId, ingestionId: result.ingestionId, acquisition, F: null, W: null, H: null };
        this.swallows.set(result.ingestionId, swallow);
        if (!this.firstSamples.has(materialId)) this.firstSamples.set(materialId, swallow);
      }
      if (e.request.type === 'release') this.releases.push({ ...receipt, materialId: e.request.targetId,
        beforeAnySample: !this.firstSamples.has(e.request.targetId), afterHarm: this.harmedItems.has(e.request.targetId) });
    } else if (e.type === 'feedback') {
      const f = e.event;
      assert.ok(f?.id && e.at === f.at, 'Feedback must preserve original engine emission time.');
      if (this.feedbackIds.has(f.id)) { assert.equal(this.feedbackIds.get(f.id), digest(f), 'Conflicting repeated feedback ID.'); return; }
      this.feedbackIds.set(f.id, digest(f));
      const swallow = this.swallows.get(f.ingestionId);
      if (!swallow || f.provenance !== 'sampled' || f.objectId !== swallow.materialId || f.actionId !== swallow.actionId || f.at < swallow.at) { this.unmatchedFeedback++; return; }
      const channels = [...(f.effect === 'sustained' ? ['F'] : []), ...(f.effect === 'water relief' || f.thirst === 'easing' ? ['W'] : []), ...(f.effect === 'discomfort' ? ['H'] : [])];
      for (const channel of channels) if (!swallow[channel]) {
        swallow[channel] = { eventId: f.id, at: f.at, order }; this.channels[channel]++;
        if (channel === 'H') this.harmedItems.add(swallow.materialId);
      }
    }
  }
  finish(stopAt) {
    assert.ok(finite(stopAt));
    const acquired = [...this.acquisitions.values()], swallows = [...this.swallows.values()];
    const chain = (swallow, channel) => ({ materialId: swallow.materialId, ingestionId: swallow.ingestionId,
      acquisition: copy(swallow.acquisition), firstAcquisition: copy(this.acquisitions.get(swallow.materialId)), sample: { seq: swallow.seq, actionId: swallow.actionId, at: swallow.at },
      feedback: copy(swallow[channel]) });
    const channelMetrics = channel => {
      const complete = swallows.filter(s => s.acquisition && s[channel]);
      const first = new Map(); for (const s of complete) if (!first.has(s.materialId)) first.set(s.materialId, s);
      return { distinctMaterials: first.size, beneficialPortions: complete.length, additionalBeneficialPortions: complete.length - first.size,
        chains: [...first.values()].map(s => chain(s, channel)),
        sampleLatencies: swallows.map(s => ({ materialId: s.materialId, ingestionId: s.ingestionId, sampleAt: s.at,
          seconds: (s[channel]?.at ?? stopAt) - s.at, rightCensored: !s[channel], acquired: Boolean(s.acquisition) })) };
    };
    const F = channelMetrics('F'), W = channelMetrics('W');
    return { primaryCompletionCount: F.distinctMaterials, F, W, channels: { ...this.channels },
      distinctAcquiredMaterials: acquired.length, acquisitionHistory: copy(this.acquisitionHistory), successfulAcquisitionReceipts: Object.entries(this.primitives).filter(([k]) => ['pull', 'grasp'].includes(k)).reduce((n, [, v]) => n + v.successes, 0),
      acquisitionToFirstSample: acquired.map(a => { const s = swallows.find(s => s.materialId === a.materialId && s.at >= a.at && s.order > a.order); return { materialId: a.materialId, acquisitionSeq: a.seq, acquisitionAt: a.at,
        sampleSeq: s?.seq ?? null, seconds: (s?.at ?? stopAt) - a.at, rightCensored: !s }; }),
      timeToFirstAcquisition: { seconds: acquired[0]?.at ?? stopAt, rightCensored: acquired.length === 0 },
      timeToFirstSample: { seconds: swallows[0]?.at ?? stopAt, rightCensored: swallows.length === 0 },
      distinctSampledMaterials: this.firstSamples.size, successfulSwallows: swallows.length,
      repeatedValidSamples: swallows.length - this.firstSamples.size,
      discomfortIngestions: swallows.filter(s => s.H).map(s => ({ materialId: s.materialId, ingestionId: s.ingestionId, sampleActionId: s.actionId, feedback: copy(s.H) })),
      distinctDiscomfortIngestions: swallows.filter(s => s.H).length,
      releases: copy(this.releases), releasesBeforeAnySample: this.releases.filter(r => r.beforeAnySample).length,
      releasesAfterHarm: this.releases.filter(r => r.afterHarm).length,
      primitiveWork: copy(this.primitives), productivePrimitiveDiversity: Object.values(this.primitives).filter(v => v.productiveSuccesses > 0).length,
      productivePrimitiveDefinition: 'Successful observation, held acquisition, detachment, swallow, release, recoil or stopped movement; object_struck alone is excluded. This is an evaluator description, not a reward.',
      choices: { ordinary: this.ordinary, known: this.known, unknown: this.ordinary - this.known,
        unknownFraction: this.ordinary ? 1 - this.known / this.ordinary : null, exploring: this.exploring },
      submissions: this.submissions.size, completions: this.completed.size, pendingSubmissionSeqs: [...this.submissions.keys()].filter(seq => !this.completed.has(seq)),
      unmatchedFeedback: this.unmatchedFeedback };
  }
}
export function timingSummary(values) {
  if (!values.length) return { n: 0, mean: null, p50: null, p95: null, p99: null, max: null };
  assert.ok(values.every(finite)); const ordered = [...values].sort((a, b) => a - b);
  const quantile = fraction => ordered[Math.max(0, Math.ceil(ordered.length * fraction) - 1)];
  return { n: values.length, mean: values.reduce((a, b) => a + b, 0) / values.length, p50: quantile(.5), p95: quantile(.95), p99: quantile(.99), max: ordered.at(-1) };
}
export function episodeTimingGate(values) {
  const summary = timingSummary(values);
  return { summary, limitP95Ms: PROTOCOL.episodeAddedDecisionP95Ms, passed: summary.n > 0 && summary.p95 <= PROTOCOL.episodeAddedDecisionP95Ms,
    fewerThan200Decisions: summary.n < 200, warmupExcluded: 0, ownerSinkOverheadIncluded: true,
    interpretation: 'All actual episode decisions, including cold and tail samples. No manufactured decisions or sink-average subtraction; separate preflight establishes the >=200 warmed-sample benchmark gate.' };
}
export function validateBudgetReport(budget, source) {
  assert.equal(budget?.schemaVersion, 1); assert.equal(budget.kind, 'finite-temporal-resource-benchmark');
  assert.equal(budget.smoke, false, 'Smoke measurements cannot admit autonomy.');
  assert.ok(typeof budget.finishedAt === 'string' && Number.isFinite(Date.parse(budget.finishedAt)), 'Budget must be completed.');
  assert.ok(isHash(budget.source?.benchmarkSource), 'Missing measured benchmark fingerprint.');
  assert.equal(budget.source?.runtimeSource, source.runtimeSource, 'Budget runtime source mismatch.');
  assert.equal(budget.source?.evaluatorSource, source.evaluatorSource, 'Budget evaluator source mismatch.');
  assert.ok(budget.gates?.passed === true && budget.gates.minimumMeasuredSubmissions === 200 && budget.gates.maxAddedDecisionP95Ms === 5 && budget.gates.maxEncodedActorBytes === PROTOCOL.actorBytes);
  assert.equal(budget.cases?.length, 9, 'All three fixed capacities and three arms must be measured.');
  const names = new Set();
  for (const row of budget.cases) {
    assert.ok(PROTOCOL.arms.includes(row.arm) && ['cold', 'full-cap-known', 'full-cap-unknown'].includes(row.name) && !names.has(`${row.name}|${row.arm}`)); names.add(`${row.name}|${row.arm}`);
    assert.ok(row.measuredSubmissions >= 200 && row.warmupSubmissions >= 40 && row.addedDecisionMs?.n >= 200 && row.addedDecisionMs.p95 <= 5 && finite(row.addedDecisionMs.p95));
    assert.ok(finite(row.encodedActorAndMetadataBytes) && row.encodedActorAndMetadataBytes <= PROTOCOL.actorBytes && row.gatePassed === true);
    assert.equal(row.parameterUpdateWorkOmitted, row.arm === 'frozen-zero');
    for (const [raw, summary] of [['added', 'addedDecisionMs'], ['construction', 'legacyConstructionMs'], ['combined', 'combinedDecisionMs']]) {
      assert.equal(row.rawTimingsMs?.[raw]?.length, row.measuredSubmissions, 'Missing actual warmed timing samples.');
      assert.deepEqual(row[summary], timingSummary(row.rawTimingsMs[raw]), 'Timing summary does not match measured samples.');
    }
    assert.equal(row.sampleProofs?.length, row.measuredSubmissions, 'Every measured submission needs a proof.');
    assert.ok(finite(row.validationAndSerializeMs) && finite(row.restoreValidationMs));
    for (const summary of [row.checkpoint?.serializeMs, row.checkpoint?.restoreMs, row.checkpoint?.eventLoopGapMs,
      row.productionSave?.withTemporalMs, row.productionSave?.baselineMs, row.productionSave?.withTemporalEventLoopGapMs, row.productionSave?.baselineEventLoopGapMs]) {
      assert.ok(summary?.n > 0 && finite(summary.p95) && finite(summary.max), 'Missing paired save/frame-gap or generation/validation timing.');
    }
  }
  for (const arm of PROTOCOL.arms) assert.equal(budget.cases.filter(c => c.arm === arm).length, 3);
  for (const [field, countField, warmupField] of [['sensorCases', 'measuredTicks', 'warmupTicks'], ['sensorCompletionCases', 'measuredBoundaries', 'warmupBoundaries']]) {
    assert.equal(budget[field]?.length, 2, 'Separate cold/full-cap-known native and completion sensor measurements are required.');
    assert.deepEqual(budget[field].map(row => row.name).sort(), ['cold', 'full-cap-known']);
    for (const row of budget[field]) {
      assert.ok(row[countField] >= 200 && row[warmupField] >= 40);
      assert.equal(row.rawMs?.sensor?.length, row[countField]);
      assert.deepEqual(row.sensorPhaseMs, timingSummary(row.rawMs.sensor));
      if (field === 'sensorCompletionCases') {
        assert.equal(row.actualOutcome?.code, 'WAITED'); assert.ok(row.actualOutcome.eventId > 0);
        assert.equal(row.actualPhysicalSubmissions, 1); assert.equal(row.actualPhysicalOutcomes, 1);
        assert.ok(row.physicalSeconds >= 5 && row.physicalSeconds < 5.1 && finite(row.validationMs));
      }
    }
  }
  assert.equal(budget.rawEvidenceSha256, digest(budget.cases.map(c => ({ name: c.name, arm: c.arm, rawTimingsMs: c.rawTimingsMs, sampleProofs: c.sampleProofs }))), 'Benchmark raw-evidence fingerprint mismatch.');
  return true;
}
/** Explicit alternate diagnostic admission; the original failed budget is never mutated. */
export function validateHeadlessBudgetReport(budget, source) {
  assert.equal(budget?.schemaVersion, 1); assert.equal(budget.kind, 'finite-temporal-resource-benchmark');
  assert.equal(budget.smoke, false, 'Smoke measurements cannot admit autonomy.');
  assert.ok(typeof budget.finishedAt === 'string' && Number.isFinite(Date.parse(budget.finishedAt)), 'Budget must be completed.');
  assert.ok(isHash(budget.source?.benchmarkSource), 'Missing measured benchmark fingerprint.');
  assert.equal(budget.source?.runtimeSource, source.runtimeSource, 'Budget runtime source mismatch.');
  assert.equal(budget.source?.evaluatorSource, HEADLESS_PROTOCOL.originalEvaluatorSha256, 'Historical evaluator source mismatch.');
  assert.ok(budget.gates?.passed === false && budget.gates.minimumMeasuredSubmissions === 200 && budget.gates.maxAddedDecisionP95Ms === 5 && budget.gates.maxEncodedActorBytes === PROTOCOL.actorBytes);
  assert.equal(budget.cases?.length, 9, 'All three fixed capacities and three arms must be measured.');
  const names = new Set();
  for (const row of budget.cases) {
    assert.ok(PROTOCOL.arms.includes(row.arm) && ['cold', 'full-cap-known', 'full-cap-unknown'].includes(row.name) && !names.has(`${row.name}|${row.arm}`)); names.add(`${row.name}|${row.arm}`);
    assert.ok(row.measuredSubmissions >= 200 && row.warmupSubmissions >= 40 && row.addedDecisionMs?.n >= 200 && row.addedDecisionMs.p95 < HEADLESS_PROTOCOL.admissionP95ExclusiveMs && finite(row.addedDecisionMs.p95));
    assert.ok(finite(row.encodedActorAndMetadataBytes) && row.encodedActorAndMetadataBytes <= PROTOCOL.actorBytes );
    assert.equal(row.gatePassed, row.addedDecisionMs.p95 <= 5 && row.encodedActorAndMetadataBytes <= PROTOCOL.actorBytes, 'Original case gate result was altered.');
    assert.equal(row.parameterUpdateWorkOmitted, row.arm === 'frozen-zero');
    for (const [raw, summary] of [['added', 'addedDecisionMs'], ['construction', 'legacyConstructionMs'], ['combined', 'combinedDecisionMs']]) {
      assert.equal(row.rawTimingsMs?.[raw]?.length, row.measuredSubmissions, 'Missing actual warmed timing samples.');
      assert.deepEqual(row[summary], timingSummary(row.rawTimingsMs[raw]), 'Timing summary does not match measured samples.');
    }
    assert.equal(row.sampleProofs?.length, row.measuredSubmissions, 'Every measured submission needs a proof.');
    assert.ok(finite(row.validationAndSerializeMs) && finite(row.restoreValidationMs));
    for (const summary of [row.checkpoint?.serializeMs, row.checkpoint?.restoreMs, row.checkpoint?.eventLoopGapMs,
      row.productionSave?.withTemporalMs, row.productionSave?.baselineMs, row.productionSave?.withTemporalEventLoopGapMs, row.productionSave?.baselineEventLoopGapMs]) {
      assert.ok(summary?.n > 0 && finite(summary.p95) && finite(summary.max), 'Missing paired save/frame-gap or generation/validation timing.');
    }
  }
  for (const arm of PROTOCOL.arms) assert.equal(budget.cases.filter(c => c.arm === arm).length, 3);
  for (const [field, countField, warmupField] of [['sensorCases', 'measuredTicks', 'warmupTicks'], ['sensorCompletionCases', 'measuredBoundaries', 'warmupBoundaries']]) {
    assert.equal(budget[field]?.length, 2, 'Separate cold/full-cap-known native and completion sensor measurements are required.');
    assert.deepEqual(budget[field].map(row => row.name).sort(), ['cold', 'full-cap-known']);
    for (const row of budget[field]) {
      assert.ok(row[countField] >= 200 && row[warmupField] >= 40);
      assert.equal(row.rawMs?.sensor?.length, row[countField]);
      assert.deepEqual(row.sensorPhaseMs, timingSummary(row.rawMs.sensor));
      if (field === 'sensorCompletionCases') {
        assert.equal(row.actualOutcome?.code, 'WAITED'); assert.ok(row.actualOutcome.eventId > 0);
        assert.equal(row.actualPhysicalSubmissions, 1); assert.equal(row.actualPhysicalOutcomes, 1);
        assert.ok(row.physicalSeconds >= 5 && row.physicalSeconds < 5.1 && finite(row.validationMs));
      }
    }
  }
  assert.equal(budget.rawEvidenceSha256, digest(budget.cases.map(c => ({ name: c.name, arm: c.arm, rawTimingsMs: c.rawTimingsMs, sampleProofs: c.sampleProofs }))), 'Benchmark raw-evidence fingerprint mismatch.');
  assert.ok(budget.cases.some(row => row.addedDecisionMs.p95 > 5), 'The original interactive timing failure must remain visible.');
  return { protocol: HEADLESS_PROTOCOL.name, admitted: true, admissionP95ExclusiveMs: HEADLESS_PROTOCOL.admissionP95ExclusiveMs,
    originalInteractiveGatePassed: false, originalGates: copy(budget.gates), originalCaseResults: budget.cases.map(row => ({ name: row.name, arm: row.arm, p95Ms: row.addedDecisionMs.p95, encodedActorAndMetadataBytes: row.encodedActorAndMetadataBytes, originalGatePassed: row.gatePassed })),
    cohortProgressionAllowed: false };
}
async function verifiedArtifact(reference, base) {
  assert.ok(reference && typeof reference.path === 'string' && isHash(reference.sha256), 'Missing externally recorded evidence artifact.');
  const path = resolve(base, reference.path), bytes = await readFile(path);
  assert.equal(hash(bytes), reference.sha256, `Evidence fingerprint mismatch: ${path}`);
  return { path, sha256: reference.sha256, bytes };
}
async function readPreflight(path, source) {
  const bytes = await readFile(path), p = JSON.parse(bytes), base = dirname(path);
  assert.equal(p.schemaVersion, 1); assert.equal(p.kind, 'finite-temporal-preflight');
  assert.equal(p.source?.runtimeSource, source.runtimeSource); assert.equal(p.source?.evaluatorSource, source.evaluatorSource);
  assert.equal(p.correctness?.passed, true); assert.equal(p.review?.status, 'cleared');
  assert.equal(p.correctness.checks?.length, REQUIRED_CORRECTNESS.length);
  const evidence = [];
  for (const name of REQUIRED_CORRECTNESS) {
    const matches = p.correctness.checks.filter(row => row.name === name);
    assert.equal(matches.length, 1, `Missing/duplicate externally reviewed gate: ${name}`); assert.equal(matches[0].passed, true);
    const file = await verifiedArtifact(matches[0].evidence, base); evidence.push({ name, path: file.path, sha256: file.sha256 });
  }
  const review = await verifiedArtifact(p.review.evidence, base), budget = await verifiedArtifact(p.budget, base);
  const budgetReport = JSON.parse(budget.bytes); validateBudgetReport(budgetReport, source);
  assert.equal(budgetReport.source.benchmarkSource, hash(await readFile(resolve(ROOT, 'scripts/measure-finite-temporal.mjs'))), 'Benchmark implementation changed since measurement.');
  return { path, sha256: hash(bytes), correctness: evidence, review: { path: review.path, sha256: review.sha256 }, budget: { path: budget.path, sha256: budget.sha256 }, verified: true };
}
export function validateHeadlessArtifactReferences(preflight) {
  assert.equal(preflight.originalBudget?.sha256, HEADLESS_PROTOCOL.originalBudgetSha256, 'Original failed budget artifact must be preserved unchanged.');
  assert.equal(preflight.originalEvaluator?.sha256, HEADLESS_PROTOCOL.originalEvaluatorSha256, 'Historical evaluator artifact must be preserved unchanged.');
  return true;
}
export async function readHeadlessPreflight(path, source) {
  const bytes = await readFile(path), p = JSON.parse(bytes), base = dirname(path);
  assert.equal(p.schemaVersion, 1); assert.equal(p.kind, 'finite-temporal-headless-preflight'); assert.equal(p.protocol, HEADLESS_PROTOCOL.name);
  assert.equal(p.source?.runtimeSource, source.runtimeSource); assert.equal(p.source?.evaluatorSource, source.evaluatorSource);
  assert.equal(p.correctness?.passed, true); assert.equal(p.review?.status, 'cleared');
  assert.equal(p.correctness.checks?.length, REQUIRED_CORRECTNESS.length);
  const evidence = [];
  for (const name of REQUIRED_CORRECTNESS) {
    const matches = p.correctness.checks.filter(row => row.name === name);
    assert.equal(matches.length, 1, `Missing/duplicate externally reviewed gate: ${name}`); assert.equal(matches[0].passed, true);
    const file = await verifiedArtifact(matches[0].evidence, base); evidence.push({ name, path: file.path, sha256: file.sha256 });
  }
  const review = await verifiedArtifact(p.review.evidence, base), evaluatorTests = await verifiedArtifact(p.evaluatorTests, base);
  validateHeadlessArtifactReferences(p);
  const budget = await verifiedArtifact(p.originalBudget, base), originalEvaluator = await verifiedArtifact(p.originalEvaluator, base);
  const budgetReport = JSON.parse(budget.bytes), admission = validateHeadlessBudgetReport(budgetReport, source);
  assert.equal(budgetReport.source.benchmarkSource, hash(await readFile(resolve(ROOT, 'scripts/measure-finite-temporal.mjs'))), 'Benchmark implementation changed since measurement.');
  return { path, sha256: hash(bytes), correctness: evidence, review: { path: review.path, sha256: review.sha256 }, evaluatorTests: { path: evaluatorTests.path, sha256: evaluatorTests.sha256 }, originalEvaluator: { path: originalEvaluator.path, sha256: originalEvaluator.sha256 }, originalBudget: { path: budget.path, sha256: budget.sha256 }, admission, verified: true };
}
export function compareCohort(trials) {
  const expected = expectedTrials('cohort'), pairs = [];
  for (let approachIndex = 0; approachIndex < 2; approachIndex++) for (const selectorSeed of PROTOCOL.cohort.selectorSeeds) {
    const group = trials.filter(t => t.approachIndex === approachIndex && t.selectorSeed === selectorSeed);
    const online = group.find(t => t.arm === 'online');
    for (const arm of ['no-bootstrap', 'frozen-zero']) {
      const control = group.find(t => t.arm === arm), valid = online?.status === 'completed' && control?.status === 'completed';
      pairs.push({ approachIndex, selectorSeed, control: arm, valid,
        ...(valid ? { countDifference: online.metrics.primaryCompletionCount - control.metrics.primaryCompletionCount,
          absorbedKcalDifference: online.energy.absorbedKcal - control.energy.absorbedKcal,
          collapseDifference: online.safety.collapses - control.safety.collapses,
          discomfortIngestionDifference: online.metrics.distinctDiscomfortIngestions - control.metrics.distinctDiscomfortIngestions,
          minimumHealthDifference: online.safety.minimumHealth - control.safety.minimumHealth,
          safetyPassed: online.safety.collapses <= control.safety.collapses && online.metrics.distinctDiscomfortIngestions <= control.metrics.distinctDiscomfortIngestions && online.safety.minimumHealth + PROTOCOL.tolerance >= control.safety.minimumHealth } : {}) });
    }
  }
  const complete = trials.length === expected.length && expected.every(e => trials.filter(t => t.id === e.id && t.status === 'completed').length === 1);
  const wins = Array.from({ length: 2 }, (_, approachIndex) => PROTOCOL.cohort.selectorSeeds.filter(selectorSeed => pairs.filter(p => p.approachIndex === approachIndex && p.selectorSeed === selectorSeed).every(p => p.valid && p.countDifference > 0)).length).reduce((a, b) => a + b, 0);
  const absorbed = Object.fromEntries(PROTOCOL.arms.map(arm => [arm, trials.filter(t => t.arm === arm && t.status === 'completed').reduce((n, t) => n + t.energy.absorbedKcal, 0)]));
  const winsByControl = Object.fromEntries(['no-bootstrap', 'frozen-zero'].map(arm => [arm, pairs.filter(p => p.control === arm && p.valid && p.countDifference > 0).length]));
  const pooledAbsorptionPassed = ['no-bootstrap', 'frozen-zero'].every(arm => absorbed.online + PROTOCOL.tolerance >= absorbed[arm]);
  return { complete, pairs, matchedStartsBeatingBothControls: wins, matchedStartWinsByControl: winsByControl, pooledAbsorbedKcal: absorbed, pooledAbsorptionPassed,
    allPairSafetyPassed: pairs.every(p => p.valid && p.safetyPassed), promisingDevelopmentGatePassed: complete && Object.values(winsByControl).every(count => count >= 4) && pooledAbsorptionPassed && pairs.every(p => p.safetyPassed) };
}

/** Pure checked-after-return limits; they cannot interrupt a blocked synchronous call. */
export function headlessRuntimeLimits({ returnedDecisionMs = null, wallSeconds }) {
  assert.ok(finite(wallSeconds) && (returnedDecisionMs === null || finite(returnedDecisionMs)));
  const decisionExceeded = returnedDecisionMs !== null && returnedDecisionMs > HEADLESS_PROTOCOL.maximumReturnedDecisionMs;
  const wallExceeded = wallSeconds > HEADLESS_PROTOCOL.wallBudgetSecondsPerArm;
  return { stopped: decisionExceeded || wallExceeded, decisionExceeded, wallExceeded,
    returnedDecisionMs, wallSeconds, maximumReturnedDecisionMs: HEADLESS_PROTOCOL.maximumReturnedDecisionMs,
    wallBudgetSeconds: HEADLESS_PROTOCOL.wallBudgetSecondsPerArm, checkedAfterReturn: true };
}
export function compareHeadlessTrials(trials) {
  const expected = expectedTrials(HEADLESS_PROTOCOL.name);
  const matchingInitialStates = trials.length === 3 && trials.every(t => isHash(t.initialStateSha256)) ? new Set(trials.map(t => t.initialStateSha256)).size === 1 : null;
  const complete = matchingInitialStates === true && trials.length === 3 && expected.every(e => trials.filter(t => t.id === e.id && t.status === 'completed' && t.elapsedSeconds === 600 && Math.abs(t.stopAt - 600) <= 1e-6 && Object.values(t.checks || {}).length > 0 && Object.values(t.checks).every(v => v === true)).length === 1);
  const online = trials.find(t => t.arm === 'online');
  return { protocol: HEADLESS_PROTOCOL.name, allThreeCompleted: complete, matchingInitialStates, comparisonEligible: complete,
    originalInteractiveGatePassed: false, cohortProgressionAllowed: false,
    interpretation: 'One controlled diagnostic start only. No development-cohort, interactive-responsiveness or efficacy claim follows.',
    pairs: complete ? ['no-bootstrap', 'frozen-zero'].map(arm => {
      const control = trials.find(t => t.arm === arm);
      return { control: arm, primaryCountDifference: online.metrics.primaryCompletionCount - control.metrics.primaryCompletionCount,
        absorbedKcalDifference: online.energy.absorbedKcal - control.energy.absorbedKcal,
        collapseDifference: online.safety.collapses - control.safety.collapses,
        discomfortIngestionDifference: online.metrics.distinctDiscomfortIngestions - control.metrics.distinctDiscomfortIngestions,
        minimumHealthDifference: online.safety.minimumHealth - control.safety.minimumHealth };
    }) : [],
  };
}

function atomicJson(path, value) {
  const temporary = `${path}.next`, fd = openSync(temporary, 'w', 0o600);
  try { writeSync(fd, JSON.stringify(value, null, 2) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temporary, path); const directory = openSync(dirname(path), 'r'); try { fsyncSync(directory); } finally { closeSync(directory); }
}
function traceWriter(path) {
  const fd = openSync(path, 'wx', 0o600), rolling = createHash('sha256'); let lines = 0, bytes = 0, closed = false;
  return { append(value) { const line = JSON.stringify({ traceOrder: ++lines, ...value }) + '\n'; const size = Buffer.byteLength(line); writeSync(fd, line); rolling.update(line); bytes += size; },
    sync() { if (!closed) fsyncSync(fd); }, summary() { return { path, sha256: rolling.copy().digest('hex'), lines, bytes }; },
    close() { if (!closed) { fsyncSync(fd); closeSync(fd); closed = true; } } };
}
export function isContactInjuryEvent(event) {
  return event?.type === 'condition' && event.details?.code === 'CONTACT_INJURY';
}
function physicalSnapshot(driver, sourceId) {
  const n = driver.npc, f = n.physiology, e = driver.state.environment.ecology;
  const source = e.plants.find(p => p.id === sourceId);
  return { at: n.elapsed, position: copy(n.position), scene: n.scene, lifecycle: n.lifecycle, held: [...n.inventory.items],
    health: f.health, condition: f.condition, availableEnergyKcal: f.availableEnergyKcal, storedEnergyKcal: f.storedEnergyKcal,
    reservesKcal: f.availableEnergyKcal + f.storedEnergyKcal, waterDeficitMl: f.waterDeficitMl,
    fatigue: f.fatigue, sleepPressure: f.sleepPressure, stamina: f.stamina, sleep: copy(f.sleep),
    pendingKcal: sum(f.stomach, 'remainingKcal'), pendingWaterMl: sum(f.stomach, 'remainingWaterMl'), pendingMassGrams: sum(f.stomach, 'remainingMassGrams'),
    totals: copy(f.totals), assistance: copy(f.outsideAssistance), collapses: n.stats.collapses, rescues: n.stats.rescues,
    totalInjuryTotal: n.stats.injuries, sourceQuantity: source?.quantity ?? null,
    ecologyLedger: copy(e.ledger), materials: { count: e.materials.length, massGrams: sum(e.materials, 'massGrams'), energyKcal: sum(e.materials, 'energyKcal'), waterMl: sum(e.materials, 'waterMl') } };
}
function encodedEvidence(driver, source) {
  const n = driver.npc, actor = { ...n, discovery: { ...n.discovery, temporal: encodeTemporalWire(driver.memory) } };
  const header = { format: FINITE_CHECKPOINT.format, version: FINITE_CHECKPOINT.version, profile: { ...FINITE_TEMPORAL_PROFILE }, arm: driver.arm,
    sourceFingerprint: source.runtimeSource, selector: copy(driver.selector), driver: driver.checkpointDriver() };
  const { npc, ...state } = driver.state;
  return { actorBytes: temporalUtf8Bytes({ ...header, actor }), envelope: { ...header, state: { ...state, agents: [actor] } } };
}
function learningSnapshot(driver) {
  const m = driver.memory;
  return { rows: m.model.rows.length, contexts: m.contextKeys.length, dictionaryBytes: temporalUtf8Bytes(m.contextKeys), replay: m.model.transitions.length,
    receipts: m.receipts.length, ingestions: m.ingestions.length, exposureSummaries: Math.min(24, m.ingestions.length), events: m.events.length,
    saturated: m.model.saturated || m.storage.saturated, rowSaturated: m.model.saturated, contextSaturated: m.storage.saturated,
    contextOverflows: m.storage.overflows, historyCensored: m.historyCensored, modelHistoryCensored: m.model.historyCensored,
    censoredEvents: m.censoredEvents, rejectedEvents: m.rejectedEvents, channelsOwned: [...m.totals], updateCount: m.model.updateCount,
    unknownContextReceipts: m.receipts.filter(r => r.unknownContext).length, openInterval: copy(m.open), numericalGuard: m.model.numericalGuard };
}
export function energyChecks(opening, closing) {
  const delta = Object.fromEntries(Object.keys(opening.totals).map(key => [key, closing.totals[key] - opening.totals[key]]));
  const energyResidualKcal = opening.reservesKcal + opening.pendingKcal + delta.ingestedKcal - closing.reservesKcal - closing.pendingKcal - delta.metabolizedKcal - delta.discardedKcal;
  const finiteTransferResidualKcal = closing.ecologyLedger.humanRemovedKcal - opening.ecologyLedger.humanRemovedKcal - delta.ingestedKcal;
  const noAssistance = [opening, closing].every(s => s.assistance.count === 0 && s.assistance.energyKcal === 0 && s.assistance.waterMl === 0 && s.rescues === 0 && s.ecologyLedger.externalKcal === 0);
  return { swallowedKcal: delta.ingestedKcal, swallowedWaterMl: delta.ingestedWaterMl, absorbedKcal: delta.absorbedKcal, absorbedWaterMl: delta.absorbedWaterMl,
    spentKcal: delta.metabolizedKcal, discardedKcal: delta.discardedKcal, pendingOpeningKcal: opening.pendingKcal, pendingClosingKcal: closing.pendingKcal,
    reserveChangeKcal: closing.reservesKcal - opening.reservesKcal, waterDeficitChangeMl: closing.waterDeficitMl - opening.waterDeficitMl,
    energyResidualKcal, finiteTransferResidualKcal,
    checks: { energyConservation: Math.abs(energyResidualKcal) <= PROTOCOL.tolerance, finiteTransfer: Math.abs(finiteTransferResidualKcal) <= PROTOCOL.tolerance, noAssistance } };
}
export async function verifyPlainReport(path, source) {
  const bytes = await readFile(path), p = JSON.parse(bytes);
  assert.equal(p.kind, 'finite-temporal-evaluation'); assert.equal(p.schemaVersion, 1); assert.equal(p.stage, 'plain'); assert.equal(p.status, 'completed');
  assert.deepEqual(p.protocol, PROTOCOL); assert.equal(p.sourceBefore?.runtimeSource, source.runtimeSource); assert.equal(p.sourceBefore?.evaluatorSource, source.evaluatorSource);
  assert.equal(p.sourceAfter?.frozenSource, source.frozenSource); assert.equal(p.preflight?.verified, true); assert.equal(p.matchingInitialStates, true);
  const preflight = await verifiedArtifact(p.preflight, dirname(path)); await readPreflight(preflight.path, source);
  assert.equal(p.trials?.length, 3);
  for (const expected of expectedTrials('plain')) {
    const trial = p.trials.find(t => t.id === expected.id); assert.ok(trial && trial.status === 'completed' && Object.values(trial.checks).every(v => v === true));
    assert.equal(trial.elapsedSeconds, 600, 'Plain gate requires the full fixed duration.');
    for (const key of ['arm', 'selectorSeed', 'approachIndex', 'seconds', 'physicalSeed']) assert.equal(trial[key], expected[key], 'Plain trial does not match preregistration.');
    assert.equal(trial.resources?.episodeTiming?.passed, true);
    assert.deepEqual(trial.resources.episodeTiming, episodeTimingGate(trial.resources.timing.rawAddedDecisionMs));
    assert.equal(trial.sourceBefore, source.frozenSource); assert.equal(trial.sourceAfter, source.frozenSource);
    assert.ok(Math.abs(trial.stopAt - 600) <= 1e-6);
    const file = await verifiedArtifact(trial.trace, dirname(path));
    const observed = new EvidenceMetrics(); let firstPhysical = null, lastPhysical = null, stopped = false;
    for (const line of file.bytes.toString('utf8').trim().split('\n')) if (line) {
      const event = JSON.parse(line); observed.ingest(event);
      if (event.type === 'physicalSnapshot') { firstPhysical ||= event.snapshot; lastPhysical = event.snapshot; }
      if (event.type === 'trialStop') { assert.equal(event.terminal, false); assert.equal(event.status, 'completed'); stopped = true; }
    }
    assert.ok(firstPhysical && lastPhysical && stopped && Math.abs(lastPhysical.at - 600) <= 1e-6);
    assert.deepEqual(firstPhysical, trial.opening); assert.deepEqual(lastPhysical, trial.closing);
    assert.ok(Object.values(energyChecks(firstPhysical, lastPhysical).checks).every(Boolean));
    assert.equal(observed.finish(lastPhysical.at).primaryCompletionCount, trial.metrics.primaryCompletionCount);
    await verifiedArtifact(trial.stopEvidence, dirname(path));
  }
  assert.equal(new Set(p.trials.map(t => t.initialStateSha256)).size, 1, 'Plain arms did not share exact initial state.');
  const online = p.trials.find(t => t.arm === 'online'), file = await verifiedArtifact(online.trace, dirname(path)), metrics = new EvidenceMetrics();
  for (const line of file.bytes.toString('utf8').trim().split('\n')) if (line) metrics.ingest(JSON.parse(line));
  const actual = metrics.finish(600);
  assert.ok(actual.primaryCompletionCount > 0, 'Cohort requires an online exact acquisition → swallow → same-ingestion sustained-F chain.');
  assert.equal(actual.primaryCompletionCount, online.metrics.primaryCompletionCount, 'Plain summary does not match its original evidence.');
  return { path, sha256: hash(bytes), verified: true, onlinePrimaryCompletionCount: actual.primaryCompletionCount };
}

async function runTrial(job, fixture, source, output, onPartial, isInterrupted, headless = false) {
  const row = { ...job, status: 'running', direction: fixture.approach.direction, sourceBefore: source.frozenSource, startedAt: new Date().toISOString() };
  const trace = traceWriter(resolve(output, `${job.id}.owner.jsonl`)), metrics = new EvidenceMetrics();
  const timed = { added: [], construction: [], combined: [], sensors: [], traceSink: [], measure: [] };
  let driver, opening, lastSnapshot, sampledPeakActorBytes = 0, peakWorldBytes = 0, peakHeapBytes = 0, peakRssBytes = 0, minimumHealth = Infinity, observationId = 0;
  let actualRestSeconds = 0, actualSleepSeconds = 0, collapsedSeconds = 0, totalInjuryAmount = 0, contactInjuryEventCount = 0, firstSaturationAt = null;
  const activeSeconds = {}, resources = [], totalInjuries = [], startWall = performance.now();
  const enforceHeadlessLimits = (returnedDecisionMs = null) => {
    if (!headless) return;
    const limits = headlessRuntimeLimits({ returnedDecisionMs, wallSeconds: (performance.now() - startWall) / 1000 });
    if (limits.stopped) { row.headlessStop = limits; const error = new Error('Headless diagnostic resource ceiling reached; preserve a censored partial trial without retry.'); error.code = 'HEADLESS_RESOURCE_STOP'; throw error; }
  };
  const sink = event => { const start = performance.now(), compact = compactTraceEvent(event); trace.append(compact); metrics.ingest(compact); timed.traceSink.push(performance.now() - start); };
  const snapshot = () => {
    const s = physicalSnapshot(driver, fixture.source.id); trace.append({ type: 'physicalSnapshot', at: s.at, snapshot: s }); lastSnapshot = s;
    minimumHealth = Math.min(minimumHealth, s.health); return s;
  };
  const resource = () => {
    const start = performance.now(), encoded = encodedEvidence(driver, source), bytes = temporalUtf8Bytes(encoded.envelope), mem = process.memoryUsage(), learning = learningSnapshot(driver);
    sampledPeakActorBytes = Math.max(sampledPeakActorBytes, encoded.actorBytes); peakWorldBytes = Math.max(peakWorldBytes, bytes); peakHeapBytes = Math.max(peakHeapBytes, mem.heapUsed); peakRssBytes = Math.max(peakRssBytes, mem.rss);
    const item = { at: driver.npc.elapsed, episodeTiming: episodeTimingGate(timed.added), actorBytes: encoded.actorBytes, wholeWorldEnvelopeBytes: bytes, heapUsedBytes: mem.heapUsed, rssBytes: mem.rss, learning,
      addedDecisionMs: timingSummary(timed.added), legacyConstructionMs: timingSummary(timed.construction), combinedDecisionMs: timingSummary(timed.combined), sensorTickMs: timingSummary(timed.sensors) };
    if (learning.saturated && firstSaturationAt === null) firstSaturationAt = item.at;
    resources.push(item); trace.append({ type: 'resourceSnapshot', at: item.at, snapshot: item }); timed.measure.push(performance.now() - start);
    assert.ok(encoded.actorBytes <= PROTOCOL.actorBytes, 'Complete encoded actor exceeds 1 MiB; trial is invalid and retained.');
    checkTemporalCapacity(driver.memory, FINITE_TEMPORAL_PROFILE);
  };
  try {
    const actor = createNpc({ mode: 'discovery', seed: PROTOCOL.physicalSeed }); actor.position = copy(fixture.approach.position);
    const state = { elapsed: 0, simulationMode: 'discovery', environment: copy(fixture.environment), agents: [actor], npc: actor, community: createCommunity(), cardinal: null };
    row.initialStateSha256 = digest({ actor, environment: state.environment, community: state.community });
    row.initialBodySha256 = digest(actor.physiology); row.initialWorldSha256 = digest(state.environment); row.initialSourceSha256 = digest(fixture.source);
    trace.append({ type: 'initialConditions', at: 0, source: copy(fixture.source), approach: copy(fixture.approach), initialStateSha256: row.initialStateSha256,
      body: copy(actor.physiology), worldSha256: row.initialWorldSha256, noAlterationsExceptPlacement: true });
    driver = new FiniteTemporalDriver(state, { arm: job.arm, selectorSeed: job.selectorSeed, sink });
    opening = snapshot(); row.opening = opening; observationId = actor.memory.nextId; resource();
    await onPartial({ ...row, trace: trace.summary(), progressSeconds: 0 });
    const frames = job.seconds * 60;
    for (let frame = 0; frame < frames; frame++) {
      if (isInterrupted()) throw new Error('Evaluation interrupted; no synthetic completion or terminal update.');
      enforceHeadlessLimits();
      const n = driver.npc, active = n.active?.request.type || 'idle', previousSubmissions = driver.submissions;
      const lengths = Object.fromEntries(Object.entries(driver.timings).map(([key, a]) => [key, a.length]));
      activeSeconds[active] = (activeSeconds[active] || 0) + PROTOCOL.nativeStepSeconds;
      if (n.active?.request.type === 'rest') actualRestSeconds += PROTOCOL.nativeStepSeconds;
      if (n.physiology.sleep.state === 'sleeping') actualSleepSeconds += PROTOCOL.nativeStepSeconds;
      if (n.lifecycle === 'COLLAPSED') collapsedSeconds += PROTOCOL.nativeStepSeconds;
      const priorInjuries = n.stats.injuries;
      driver.step(PROTOCOL.nativeStepSeconds);
      minimumHealth = Math.min(minimumHealth, n.physiology.health);
      // Driver emits one sensor timing per actor tick; keep every sample rather than only its bounded diagnostic tail.
      if (driver.timings.sensors.length) timed.sensors.push(driver.timings.sensors.at(-1));
      if (driver.submissions > previousSubmissions) {
        timed.added.push(driver.timings.decisions.at(-1));
        if (driver.timings.construction.length > lengths.construction || driver.timings.construction.length === 4096 && driver.timings.combined.length === 4096) {
          timed.construction.push(driver.timings.construction.at(-1)); timed.combined.push(driver.timings.combined.at(-1));
        }
      }
      // stats.injuries is gross accumulated injury from all physiology damage, not contact-only damage.
      const injury = n.stats.injuries - priorInjuries;
      if (injury > 0) { const event = { at: n.elapsed, amount: injury, healthAfter: n.physiology.health }; totalInjuryAmount += injury; totalInjuries.push(event); trace.append({ type: 'totalInjuryAmount', ...event }); }
      for (const event of n.memory.experience) if (event.id >= observationId && event.type === 'condition') {
        if (isContactInjuryEvent(event)) contactInjuryEventCount++;
        trace.append({ type: 'condition', at: event.at, event: copy(event) });
      }
      observationId = n.memory.nextId;
      enforceHeadlessLimits(driver.submissions > previousSubmissions ? driver.timings.decisions.at(-1) : null);
      if ((frame + 1) % 60 === 0 || frame + 1 === frames) snapshot();
      // Actor bytes are checked after every submitted decision as well as the fixed resource interval.
      if (driver.submissions > previousSubmissions) {
        const start = performance.now(), encoded = encodedEvidence(driver, source); sampledPeakActorBytes = Math.max(sampledPeakActorBytes, encoded.actorBytes); timed.measure.push(performance.now() - start);
        assert.ok(encoded.actorBytes <= PROTOCOL.actorBytes, 'Complete encoded actor exceeds 1 MiB; trial is invalid and retained.');
      }
      if ((frame + 1) % (PROTOCOL.resourceEverySeconds * 60) === 0 || frame + 1 === frames) resource();
      if ((frame + 1) % (PROTOCOL.persistEverySeconds * 60) === 0) {
        trace.sync(); await onPartial({ ...row, trace: trace.summary(), progressSeconds: (frame + 1) / 60, partialMetrics: metrics.finish(n.elapsed), sampledPeakActorBytes });
      }
      if ((frame + 1) % 60 === 0) await yieldTurn();
    }
    enforceHeadlessLimits();
    row.status = 'completed'; row.elapsedSeconds = job.seconds;
  } catch (error) { row.status = isInterrupted() ? 'interrupted' : error.code === 'HEADLESS_RESOURCE_STOP' ? 'resource-stopped' : 'invalid'; row.error = { message: String(error.message || error), stack: String(error.stack || error) }; }
  finally {
    // Stop evidence is captured before cleanup. Do not close the learner's open interval or invent a successor.
    if (driver) {
      try {
        const stop = snapshot(), finalLearning = learningSnapshot(driver); row.stopAt = stop.at; row.closing = stop;
        if (headless && row.elapsedSeconds === undefined) row.elapsedSeconds = stop.at;
        const stopPath = resolve(output, `${job.id}.stop.json`);
        atomicJson(stopPath, { at: stop.at, terminal: false, state: driver.state, selector: driver.selector, driver: driver.checkpointDriver(), learning: finalLearning });
        row.stopEvidence = { path: stopPath, sha256: hash(readFileSync(stopPath)) };
        const stopMeasureStart = performance.now();
        try { sampledPeakActorBytes = Math.max(sampledPeakActorBytes, encodedEvidence(driver, source).actorBytes); }
        catch (error) { row.status = 'invalid'; row.stopEncodingError = String(error.stack || error); }
        timed.measure.push(performance.now() - stopMeasureStart);
        row.metrics = metrics.finish(stop.at); row.energy = energyChecks(opening, stop);
        row.safety = { minimumHealth, collapses: stop.collapses - opening.collapses, totalInjuryAmount, totalInjuries, contactInjuryEventCount,
          injuryInterpretation: 'Gross accumulated injury across all physiology damage; CONTACT_INJURY events are counted separately. The engine condition receipt does not expose exact contact-only damage.', actualRestSeconds, actualSleepSeconds, collapsedSeconds };
        row.activeSeconds = activeSeconds; row.sourceDepletion = { openingQuantity: opening.sourceQuantity, closingQuantity: stop.sourceQuantity, quantityChange: stop.sourceQuantity === null ? null : stop.sourceQuantity - opening.sourceQuantity };
        row.resources = { sampledPeakActorBytes,
          actorByteSampling: 'At initialization, after each actual submission, every 15 simulated seconds, and at the final pre-cleanup stop. Measured admission and sampled peak only; not a universal per-tick size bound.', peakWholeWorldEnvelopeBytes: peakWorldBytes, peakHeapBytes, peakRssBytes, firstSaturationAt, episodeTiming: episodeTimingGate(timed.added),
          ...(headless ? { episodeTimingRole: 'Original 5 ms gate is descriptive only in headless-diagnostic-v1; it cannot authorize cohort progression.', headlessLimits: row.headlessStop || headlessRuntimeLimits({ returnedDecisionMs: timed.added.length ? Math.max(...timed.added) : null, wallSeconds: (performance.now() - startWall) / 1000 }) } : {}),
          finalLearning, samples: resources,
          timing: { addedDecisionMs: timingSummary(timed.added), legacyConstructionMs: timingSummary(timed.construction), combinedDecisionMs: timingSummary(timed.combined),
            sensorTickMs: timingSummary(timed.sensors), ownerTraceSinkMs: timingSummary(timed.traceSink), ownerMeasurementMs: timingSummary(timed.measure),
            rawAddedDecisionMs: [...timed.added], rawOwnerTraceSinkMs: [...timed.traceSink],
            notes: (headless ? 'Separate headless diagnostic: the original 5 ms episode p95 is reported descriptively, not used as this phase admission; >1000 ms returned decisions and the 300 s arm deadline stop and censor the trial. No cohort progression. ' : '') + 'Driver added/combined timers include synchronous owner trace sink work. Actor/whole-world measurement runs after the native tick and is reported separately. Actual-episode p95 includes every captured decision, cold samples, tails and owner sink costs, with no warmup removal or overhead subtraction. The ordinary plain/cohort stages must also pass the conservative <=5 ms gate; smaller-than-200 episode samples are explicitly labeled and do not replace the separately warmed preflight. Timing failure does not truncate the fixed horizon.' } };
        row.checks = { ...row.energy.checks, actorCapacity: sampledPeakActorBytes <= PROTOCOL.actorBytes, ...(headless ? { headlessResourceLimits: !row.resources.headlessLimits.stopped } : { actualEpisodeTiming: row.resources.episodeTiming.passed }), noUnexpectedUnsubmitted: driver.unsubmitted === 0,
          noDiagnosticFailure: !driver.diagnosticError, noNumericalGuard: !driver.memory.model.numericalGuard,
          clockAgreement: Math.abs(driver.state.elapsed - driver.npc.elapsed) <= 1e-6 && Math.abs(driver.state.environment.elapsed - driver.npc.elapsed) <= 1e-6,
          singleActor: driver.state.agents.length === 1, noModelCalls: driver.npc.stats.modelCalls === 0, noCardinal: driver.runtime.cardinal === null };
        if (row.status === 'completed' && !Object.values(row.checks).every(Boolean)) { row.status = 'invalid'; row.error = { message: 'One or more preserved trial integrity checks failed.' }; }
      } catch (error) { row.status = 'invalid'; row.finalizationError = String(error.stack || error); }
      driver.dispose();
    }
    row.completedAt = new Date().toISOString(); row.wallSeconds = (performance.now() - startWall) / 1000;
    // Charge setup, stepping and final evidence serialization to the arm wall budget.
    if (headless) {
      const finalLimits = headlessRuntimeLimits({ returnedDecisionMs: timed.added.length ? Math.max(...timed.added) : null, wallSeconds: row.wallSeconds });
      if (finalLimits.stopped) {
        row.headlessStop ||= finalLimits;
        if (row.status === 'completed') row.status = 'resource-stopped';
        row.error ||= { message: 'Headless diagnostic resource ceiling reached during the arm, including stop finalization; result remains censored.' };
        if (row.resources) row.resources.headlessLimits = row.headlessStop;
        if (row.checks) row.checks.headlessResourceLimits = false;
      }
    }
    trace.append({ type: headless ? 'physicalStopPendingFinalResourceCheck' : 'trialStop', at: row.stopAt ?? 0,
      status: headless ? row.status === 'completed' ? 'horizon-reached' : row.status : row.status, terminal: false,
      ...(headless ? { finalResourceEligibilityPending: true } : {}), error: row.error || row.finalizationError || null }); trace.close(); row.trace = trace.summary();
  }
  row.sourceAfter = (await fingerprintSources()).frozenSource;
  if (row.sourceAfter !== source.frozenSource) { row.status = 'invalid'; row.error = { message: 'Frozen runtime or evaluator changed during this trial.' }; }
  if (headless) {
    // Final returned-trial boundary includes closed/flushed traces and source hashing.
    row.wallSeconds = (performance.now() - startWall) / 1000;
    const finalLimits = headlessRuntimeLimits({ returnedDecisionMs: timed.added.length ? Math.max(...timed.added) : null, wallSeconds: row.wallSeconds });
    if (finalLimits.stopped) {
      row.headlessStop ||= finalLimits;
      if (row.status === 'completed') row.status = 'resource-stopped';
      row.error ||= { message: 'Headless diagnostic resource ceiling reached at final returned-trial boundary; preserved evidence remains censored.' };
      if (row.checks) row.checks.headlessResourceLimits = false;
    }
    if (row.resources) row.resources.headlessLimits = row.headlessStop || finalLimits;
    row.censored = row.status !== 'completed';
    row.finalResourceCheck = finalLimits;
  }
  return row;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv), headless = options.stage === HEADLESS_PROTOCOL.name;
  await mkdir(options.output, { mode: 0o700 }); // exclusive: never replace or resume evidence
  const reportPath = resolve(options.output, 'report.json');
  const report = { schemaVersion: 1, kind: 'finite-temporal-evaluation', stage: options.stage, status: 'running',
    startedAt: new Date().toISOString(), protocol: copy(headless ? HEADLESS_PROTOCOL : PROTOCOL), options, limitations: headless ? [
      ...LIMITATIONS.filter(text => !text.startsWith('Conservative protocol clarification')),
      'Separate headless diagnostic after the preserved original interactive resource gate failed. All three fixed 600-second trials must complete for any comparison; no cohort progression or interactive/main-enabling claim is permitted.',
      'Fixed native 1/60-second physics is independent of wall time. Returned added decisions above 1000 ms or 300 seconds total wall per arm stop with censored partial evidence; no retry. An external parent-process watchdog handles non-returning calls and must block remaining arms after hard kill.',
    ] : LIMITATIONS, trials: expectedTrials(options.stage), failures: [] };
  if (headless) report.originalInteractiveGate = { passed: false, originalBudgetSha256: HEADLESS_PROTOCOL.originalBudgetSha256, cohortProgressionAllowed: false };
  const persist = () => atomicJson(reportPath, report); persist();
  let interrupted = false; const interrupt = () => { interrupted = true; };
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  try {
    const source = await fingerprintSources(); report.sourceBefore = source; persist();
    report.preflight = headless ? await readHeadlessPreflight(options.preflight, source) : await readPreflight(options.preflight, source);
    if (headless) {
      report.headlessAdmission = report.preflight.admission;
      report.originalInteractiveGate = { passed: false, originalGates: report.preflight.admission.originalGates, originalCaseResults: report.preflight.admission.originalCaseResults, originalBudget: report.preflight.originalBudget, originalEvaluator: report.preflight.originalEvaluator, cohortProgressionAllowed: false };
    }
    if (options.stage === 'cohort') report.plainGate = await verifyPlainReport(options.plainReport, source);
    const environment = createEnvironment(PROTOCOL.physicalSeed, { mode: 'discovery' });
    const firstSource = environment.ecology.plants.find(p => ['apple_tree', 'bramble'].includes(p.kind));
    const approaches = selectApproaches(firstSource, headless ? HEADLESS_PROTOCOL.approaches : PROTOCOL[options.stage].approaches);
    report.fixture = { source: copy(firstSource), approaches, worldSha256: digest(environment), physicalPlacement: true, bodyOverrides: {}, resourceOverrides: {} }; persist();
    for (let i = 0; i < report.trials.length; i++) {
      if (interrupted) throw new Error('Interrupted before next scheduled trial.');
      assert.equal((await fingerprintSources()).frozenSource, source.frozenSource, 'Source changed before scheduled trial.');
      const job = report.trials[i], fixture = { source: firstSource, environment, approach: approaches.selected[job.approachIndex] };
      report.trials[i] = await runTrial(job, fixture, source, options.output, async partial => { report.trials[i] = partial; persist(); }, () => interrupted, headless);
      const completed = report.trials[i];
      if (completed.status !== 'completed') report.failures.push({ trialId: completed.id, error: completed.error || completed.finalizationError });
      persist();
      assert.equal(completed.sourceAfter, source.frozenSource, 'Frozen source mismatch; remaining trials are blocked.');
    }
    const matched = new Map();
    for (const trial of report.trials) if (trial.initialStateSha256) {
      const key = `${trial.approachIndex}/${trial.selectorSeed}`;
      if (matched.has(key)) assert.equal(trial.initialStateSha256, matched.get(key), 'Arms must share an exact initial world/body/community state.');
      else matched.set(key, trial.initialStateSha256);
    }
    report.matchingInitialStates = headless && !report.trials.every(t => isHash(t.initialStateSha256)) ? null : true;
    if (headless) report.headlessComparison = compareHeadlessTrials(report.trials);
    else if (options.stage === 'cohort') report.developmentComparison = compareCohort(report.trials);
    else report.plainGate = { correctnessAndBudgetVerified: true, onlineAcquisitionSampleSustainedF: report.trials.some(t => t.arm === 'online' && t.status === 'completed' && t.metrics.primaryCompletionCount > 0),
      allTrialsValid: report.trials.every(t => t.status === 'completed') };
    report.status = report.failures.length ? 'failed' : 'completed';
  } catch (error) {
    report.status = interrupted ? 'interrupted' : 'failed'; report.failures.push({ phase: 'evaluation', message: String(error.message || error), stack: String(error.stack || error) });
    if (error.fixtureEvidence) report.failedFixture = error.fixtureEvidence;
    for (const trial of report.trials) if (['pending', 'running'].includes(trial.status)) { trial.status = trial.status === 'pending' ? 'blocked' : 'invalid'; trial.blocker = String(error.message || error); }
  } finally {
    try { report.sourceAfter = await fingerprintSources(); if (report.sourceBefore && report.sourceAfter.frozenSource !== report.sourceBefore.frozenSource) { report.status = 'failed'; report.failures.push({ phase: 'source-freeze', message: 'Runtime or evaluator fingerprint changed.' }); } }
    catch (error) { report.status = 'failed'; report.failures.push({ phase: 'source-freeze', message: String(error.message || error) }); }
    report.completedAt = new Date().toISOString(); persist(); process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
  }
  console.log(`Preserved ${report.trials.length} scheduled trials (${report.status}) in ${reportPath}`);
  if (report.status !== 'completed') process.exitCode = 1;
  return report;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(String(error.stack || error)); process.exitCode = 1; });
}
