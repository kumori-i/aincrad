#!/usr/bin/env node
/** Increment-A synthetic resource admission only. Importing performs no work.
 * --smoke is always non-admitting. --quiet-window is a caller assertion of an
 * explicitly approved quiet window, not authority to start an experiment.
 * No world is generated, stepped, replenished, sampled or treated as evidence.
 */
import assert from 'node:assert/strict';
import { open, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { cpus, loadavg, totalmem, freemem, platform, release } from 'node:os';
import { createNpc } from '../src/npc-state.js';
import { createTemporalLedger, beginTemporalDecision, advanceTemporalClock, completeTemporalDecision,
  recordTemporalFeedback, validateTemporalLedger } from '../src/temporal-ledger.js';
import { temporalContext, temporalKey, temporalIntegral } from '../src/temporal-returns.js';
import { prepareTemporalStorage, encodeTemporalWire, temporalUtf8Bytes } from '../src/temporal-storage.js';
import { FINITE_TEMPORAL_PROFILE, applyTemporalCapacity, checkTemporalCapacity } from '../src/temporal-capacity.js';
import { createFiniteSelector } from './lib/finite-temporal-policy.mjs';
import { createReusableOutcomeModel, validateReusableOutcomeModel, reusableModelDiagnostics,
  applyReusableLabels, updatePhysicalReceipt, updatePhysicalInterval, createReusableModelSession,
  PHYSICAL_EFFECTS, PHYSICAL_COMPLETIONS, REUSABLE_MODEL } from './lib/reusable-outcome-model.mjs';
import { createReusableOutcomeSensor, observeReusableMaterials, observeReusableSubmission,
  observeReusableCompletion, snapshotReusableFeedback, recordReusableFeedback, advanceReusableSensor,
  noteReusableNativeClock, reusableCandidateFeatures, reusableMaterialSupport,
  validateReusableOutcomeSensor, reusableExposureUpdateBinding } from './lib/reusable-outcome-sensor.mjs';
import { ReusablePredictionFixture, reusablePredictionActorEnvelope, reusableActorBytes,
  reusableCombinedDictionaryBudget } from './lib/reusable-prediction-fixture.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SELF = fileURLToPath(import.meta.url);
const clone = value => structuredClone(value);
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const flags = bits => ({ F: Boolean(bits & 1), W: Boolean(bits & 2), H: Boolean(bits & 4) });
const fields = ['shape', 'color', 'texture', 'motion', 'size', 'smell'];
const unknownAppearance = Object.fromEntries(fields.map(k => [k, 'unknown']));
const proofHash = value => hash(JSON.stringify(value));
const sessions = new WeakMap();
export const RESOURCE_PROTOCOL = Object.freeze({ schemaVersion: 1, kind: 'reusable-prediction-resource-benchmark',
  designSha256: '8ca160becf1a67f7e33986a4435c4d06cb5666e28570a776031dff676e77b0d6',
  actorBytes: 1024 * 1024, p95Ms: 50, decisionMaxMs: 1000, minimumSamples: 200, minimumWarmups: 40,
  fullSamples: 240, fullWarmups: 40, cases: Object.freeze(['cold', 'full-cap-known', 'full-cap-unknown']) });

export function resourceStats(values) {
  if (!Array.isArray(values) || Array.from(values).some(v => !Number.isFinite(v) || v < 0)) throw new TypeError('Invalid timing samples');
  const sorted = [...values].sort((a, b) => a - b), quantile = p => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? null;
  return { n: values.length, p50: quantile(.5), p95: quantile(.95), p99: quantile(.99), max: sorted.at(-1) ?? null,
    mean: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null };
}

/** UTF-8, never JS code-unit length. Encoding must not silently sanitize input. */
export function checkedActorSize(input) {
  const before = proofHash(input), encoded = reusablePredictionActorEnvelope(input);
  const raw = { ...encoded, finite: { ...encoded.finite, actor: input.actor } };
  const result = { rawActorAndMetadataBytes: temporalUtf8Bytes(raw), encodedActorAndMetadataBytes: temporalUtf8Bytes(encoded) };
  assert.equal(proofHash(input), before, 'Actor measurement mutated its supplied evidence');
  assert.equal(result.encodedActorAndMetadataBytes, reusableActorBytes(input));
  if (result.encodedActorAndMetadataBytes > RESOURCE_PROTOCOL.actorBytes) {
    const error = new Error('Complete encoded actor exceeds the unchanged 1 MiB gate');
    error.code = 'REUSABLE_ACTOR_BUDGET'; error.measurement = result; throw error;
  }
  return result;
}

/** Evaluator preflight. Recompute statistics; do not trust a claimed pass field. */
export function evaluateResourceAdmission(report, { expectedSources } = {}) {
  const failures = [], reject = message => failures.push(message);
  if (!report || report.schemaVersion !== 1 || report.kind !== RESOURCE_PROTOCOL.kind) return { passed: false, failures: ['Invalid resource report schema'] };
  if (report.smoke !== false || report.quietWindow !== true) reject('Smoke or unapproved full profile is non-admitting');
  if (report.partial !== false || report.failure || !Array.isArray(report.failures) || report.failures.length) reject('Incomplete or failed resource report');
  if (!report.sourcesBefore || !report.sourcesAfter || proofHash(report.sourcesBefore) !== proofHash(report.sourcesAfter)) reject('Sources changed or were not checked before and after');
  if (report.sourcesBefore?.designSha256 !== RESOURCE_PROTOCOL.designSha256) reject('Frozen design fingerprint mismatch');
  if (expectedSources && proofHash(expectedSources) !== proofHash(report.sourcesBefore)) reject('Runtime/model/sensor/harness/docs fingerprint differs from preflight');
  if (!/^[a-f0-9]{64}$/.test(report.sourcesBefore?.runtimeSource || '') || !/^[a-f0-9]{64}$/.test(report.sourcesBefore?.benchmarkSource || '') || !Array.isArray(report.sourcesBefore?.files) || !report.sourcesBefore.files.length) reject('Missing exact source manifest');
  if (report.legacyInteractiveGate?.status !== 'failed-preserved' || report.legacyInteractiveGate?.p95LimitMs !== 5) reject('Original failed 5 ms gate was not preserved');
  const cases = Array.isArray(report.cases) ? report.cases : [];
  if (cases.length !== RESOURCE_PROTOCOL.cases.length || new Set(cases.map(c => c?.name)).size !== RESOURCE_PROTOCOL.cases.length) reject('Required resource profiles are missing or duplicated');
  for (const name of RESOURCE_PROTOCOL.cases) {
    const c = cases.find(row => row?.name === name); if (!c) { reject(`${name}: missing`); continue; }
    const raw = c.rawTimingsMs?.added;
    if (!Number.isSafeInteger(c.measuredSamples) || c.measuredSamples < 200 || !Number.isSafeInteger(c.warmupSamples) || c.warmupSamples < 40 || !Array.isArray(raw) || raw.length !== c.measuredSamples) { reject(`${name}: insufficient/malformed warmed samples`); continue; }
    let stats; try { stats = resourceStats(raw); } catch { reject(`${name}: invalid raw timings`); continue; }
    if (!(stats.p95 < 50)) reject(`${name}: added decision p95 is not below 50 ms`);
    if (!(stats.max <= 1000) || !Array.isArray(c.checkedDecisionMs) || c.checkedDecisionMs.length !== c.measuredSamples + c.warmupSamples + 1 || Array.from(c.checkedDecisionMs).some(n => !Number.isFinite(n) || n < 0 || n > 1000)) reject(`${name}: checked cold/warm/tail maximum exceeded or missing`);
    if (!Number.isSafeInteger(c.encodedActorAndMetadataBytes) || c.encodedActorAndMetadataBytes < 1 || c.encodedActorAndMetadataBytes > 1048576) reject(`${name}: invalid or oversized complete actor`);
    if (c.inputUnchanged !== true || c.predictionInputUnchanged !== true || c.parameterUpdateWorkOmitted !== false || c.skippedRequiredUpdates !== 0) reject(`${name}: incomplete/changed prediction or update workload`);
    for (const metric of ['nativeSensor', 'boundarySensor', 'feedbackSensor', 'labels', 'predictionAndSelection', 'serialization', 'byteGuard', 'reset']) {
      if (!Array.isArray(c.rawTimingsMs?.[metric]) || c.rawTimingsMs[metric].length !== c.measuredSamples || Array.from(c.rawTimingsMs[metric]).some(n => !Number.isFinite(n) || n < 0)) reject(`${name}: missing ${metric} measurements`);
    }
    if (name !== 'cold') {
      const counts = c.fixtureCounts || {};
      for (const [key, value] of Object.entries({ physicalRows: 192, physicalRowsWithReceiptSupport: 192, physicalPrimaryRowsWithNonzeroCosts: 188,
        exposureRows: 64, rows: 256, sensorExposures: 64, sensorReceipts: 384, numericalExposureAdmissions: 64, legacyReceipts: 384,
        legacyIngestions: 64, legacyRows: 256, legacyTransitions: 128, legacyKeys: 256, combinedDictionaryEntries: 512 })) if (counts[key] !== value) reject(`${name}: incomplete cap stress ${key}`);
      if (!(counts.combinedDictionaryBytes >= 262100 && counts.combinedDictionaryBytes <= 262144)) reject(`${name}: combined dictionary bytes not stressed near full cap`);
      if (!Array.isArray(c.sampleProofs) || c.sampleProofs.length !== c.measuredSamples || Array.from(c.sampleProofs).some(p => !p || p.exposureBatches !== 64 || p.appliedExposureBatches !== 64 || p.retainedKnownUpdates !== 1 || p.closedIntervalUpdates !== 1 || p.unknownCapacityRefused !== (name === 'full-cap-unknown') || p.unknownLegacyContextRefused !== (name === 'full-cap-unknown'))) reject(`${name}: missing full retained-known update/refusal proofs`);
      if (!Array.isArray(c.feedbackProofs) || c.feedbackProofs.length !== c.measuredSamples || Array.from(c.feedbackProofs).some(p => !p || p.available !== true || p.appliedExposureBatches !== 64 || p.deniedBatches !== 0 || p.newlyAdmittedWaterReports !== 1 || p.emittedPhysicalEvents !== 0)) reject(`${name}: missing complete new-feedback overhead proofs`);
    }
  }
  if (!Array.isArray(report.sensorCases) || report.sensorCases.length !== 3 || Array.from(report.sensorCases).some(c => !c || !Number.isSafeInteger(c.measuredSamples) || c.measuredSamples < 200 || !Number.isSafeInteger(c.warmupSamples) || c.warmupSamples < 40)) reject('Missing warmed native-sensor overhead profile');
  return { passed: failures.length === 0, failures };
}

export function parseResourceArguments(argv) {
  let smoke = false, quietWindow = false, out = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--smoke') smoke = true;
    else if (argv[i] === '--quiet-window') quietWindow = true;
    else if (argv[i] === '--out' && argv[i + 1] && !argv[i + 1].startsWith('--')) out = argv[++i];
    else throw new TypeError(`Unknown or incomplete resource option: ${argv[i]}`);
  }
  if (smoke && quietWindow) throw new TypeError('Choose smoke OR an explicitly approved quiet window');
  if (!smoke && !quietWindow) throw new TypeError('Full measurement requires --quiet-window after explicit authorization');
  return { smoke, quietWindow, samples: smoke ? 1 : 240, warmups: smoke ? 0 : 40,
    out: resolve(out || `/tmp/reusable-prediction-resource-${Date.now()}-${process.pid}.json`) };
}

async function filesUnder(path) {
  const entries = await readdir(path, { withFileTypes: true });
  return (await Promise.all(entries.map(e => e.isDirectory() ? filesUnder(resolve(path, e.name)) : [resolve(path, e.name)]))).flat();
}
export async function resourceSources(root = ROOT) {
  const paths = [...await filesUnder(resolve(root, 'src')), ...await filesUnder(resolve(root, 'scripts/lib')),
    ...await filesUnder(resolve(root, 'docs')), resolve(root, 'scripts/measure-reusable-prediction.mjs'), resolve(root, 'package.json'), resolve(root, 'package-lock.json')];
  const files = await Promise.all(paths.map(async path => ({ path: relative(root, path).replaceAll('\\', '/'), sha256: hash(await readFile(path)) })));
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { runtimeSource: hash(files.map(f => `${f.path}\0${f.sha256}\n`).join('')),
    benchmarkSource: files.find(f => f.path === 'scripts/measure-reusable-prediction.mjs').sha256,
    designSha256: files.find(f => f.path === 'docs/DESIGN-reusable-outcome-prediction.md').sha256,
    preregSha256: files.find(f => f.path === 'docs/PREREG-reusable-outcome-prediction.md').sha256, files };
}
export const fingerprintPredictionSources = resourceSources;

function paddedAppearances(prefix, count, units) {
  return Array.from({ length: count }, (_, i) => Object.fromEntries(fields.map((field, j) => {
    const base = j ? 'public' : `${prefix}-${i}`, add = Math.min(100 - base.length, units); units -= add;
    return [field, base + '界'.repeat(add)];
  })));
}
function feature(appearance = unknownAppearance, operation = 'sample', workBand = operation === 'sample' ? 'unknown' : '0') {
  return { operation, appearance, relation: operation === 'wait' ? 'unknown' : 'held', workBand,
    freeSlotBand: '1', countBand: operation === 'wait' ? 'unknown' : '2+' };
}
function physicalKeys(f) {
  const a = fields.map(k => f.appearance[k]);
  return [['p', f.operation, f.relation], ['m', f.operation, f.relation, a], ['w', f.operation, f.relation, a, f.workBand],
    ['capacity', f.operation, f.relation, f.freeSlotBand], ['count', f.operation, f.countBand]].map(JSON.stringify);
}
function modelPlan(units) {
  // Fill unused material-feature rows first. Then increase actual synthetic
  // exposure appearances, so the combined dictionary approaches its exact cap.
  const appearances = paddedAppearances('fixture', 91, units), filler = appearances.slice(0, 60), observed = appearances.slice(60);
  const features = [feature(unknownAppearance, 'wait'), ...observed.map(a => feature(a)), ...filler.map(a => feature(a)), feature(observed[0], 'sample', '1'), feature(observed[0], 'sample', '2..3')];
  const physical = [...new Set(features.flatMap(physicalKeys))];
  const exposure = [JSON.stringify(['e']), ...observed.flatMap(a => [JSON.stringify(['em', fields.map(k => a[k])]), JSON.stringify(['ed', fields.map(k => a[k]), 'empty'])]), JSON.stringify(['ed', fields.map(k => observed[0][k]), 'full'])];
  const body = temporalContext({ body: { hunger: 'hungry', thirst: 'thirsty', digestion: 'empty' } }).body;
  const legacyKeys = [...Array.from({ length: 224 }, (_, i) => temporalKey({ appearance: { shape: `legacy-synthetic-${i}` }, relation: 'unknown', body }, 'wait')),
    ...observed.map(appearance => temporalKey({ appearance, relation: 'held', body }, 'sample')),
    temporalKey({ appearance: observed[0], relation: 'held', body: { ...body, digestion: 'full' } }, 'sample')];
  return { observed, physical, exposure, features, legacyKeys,
    bytes: temporalUtf8Bytes([...physical, ...exposure]) + temporalUtf8Bytes(legacyKeys) };
}
function saturatedModelPlan() {
  let lo = 0, hi = 91 * 6 * 100;
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (modelPlan(mid).bytes <= REUSABLE_MODEL.dictionaryBytes) lo = mid; else hi = mid - 1; }
  const plan = modelPlan(lo); assert.equal(plan.physical.length, 192); assert.equal(plan.exposure.length, 64); assert.ok(plan.bytes >= 262100); return plan;
}
const moment = () => ({ n: 0, sum: 0, sumSq: 0 });
function allocatePhysicalRows(plan) {
  const model = createReusableOutcomeModel(); model.keys = [...plan.physical];
  model.rows = model.keys.map((_, key) => ({ key, type: 'physical', receipts: 0, intervals: 0,
    completion: Object.fromEntries(PHYSICAL_COMPLETIONS.map(c => [c, 0])), effects: Object.fromEntries(PHYSICAL_EFFECTS.map(c => [c, { n: 0, yes: 0 }])),
    duration: moment(), T: moment(), E: moment(), lastReceiptSeq: 0, lastIntervalSeq: 0 }));
  return validateReusableOutcomeModel(model);
}

/** Fabricated labels ONLY for resource stress, never a physical fixture. */
export function createSyntheticResourceFixture(name = 'full-cap-known') {
  if (!RESOURCE_PROTOCOL.cases.includes(name)) throw new TypeError('Unknown synthetic resource profile');
  const full = name !== 'cold', plan = full ? saturatedModelPlan() : { observed: [unknownAppearance] };
  const memory = createTemporalLedger({ capacityProfile: FINITE_TEMPORAL_PROFILE.name });
  // Build factual synthetic statistics with compact unused rows. Expand their
  // immutable key strings only after setup; all TIMED copies use full key bytes.
  const compactPlan = full ? modelPlan(0) : null;
  if (full) assert.deepEqual(compactPlan.observed, plan.observed);
  const model = full ? allocatePhysicalRows(compactPlan) : createReusableOutcomeModel();
  const baseAt = full ? compactPlan.features.length * 60 : 0;
  if (full) {
    // Explicitly fabricated older prehistory populates EVERY physical row. The
    // first retained ledger receipt starts after these independent stream IDs;
    // discarded old proofs are never recreated or represented as physical data.
    for (const [i, features] of compactPlan.features.entries()) {
      const sequence = i + 1;
      updatePhysicalReceipt(model, { sequence, at: i * 60 + 30, features, completion: 'failure',
        effects: Object.fromEntries(PHYSICAL_EFFECTS.map(effect => [effect, effect === 'unchanged'])), durationSeconds: 30 });
      updatePhysicalInterval(model, { sequence, at: sequence * 60, features, T: temporalIntegral(0, 60), E: temporalIntegral(0, 60, 1 / 3) });
    }
    memory.nextSeq = compactPlan.features.length + 1; memory.historyCensored = true; memory.model.historyCensored = true;
    advanceTemporalClock(memory, baseAt);
  }
  const sensor = createReusableOutcomeSensor({ at: baseAt });
  const admission = { deniedSubmissions: 0, deniedBatches: 0, lastDenial: null, exposures: [] };
  const setupLabels = labels => {
    applyReusableLabels(model, labels);
    for (const row of labels.exposureUpdates) {
      const ingestionId = reusableExposureUpdateBinding(row); assert.ok(ingestionId, 'Synthetic labels retain real sensor provenance');
      let state = admission.exposures.find(e => e.ingestionId === ingestionId);
      if (row.ingestions === 1) { assert.equal(state, undefined); state = { ingestionId, birthSequence: row.sequence, lastSequence: row.sequence, admitted: true, censored: 0 }; admission.exposures.push(state); }
      assert.ok(state); state.lastSequence = row.sequence;
    }
  };
  const actor = createNpc({ id: 'aster', mode: 'discovery', seed: 74193 }); actor.discovery.temporal = memory;
  const view = { at: baseAt, scene: 'valley', position: { x: 0, y: 0 }, reach: 60, capacity: 2, held: ['object:900000000'],
    body: temporalContext({ body: { hunger: 'hungry', thirst: 'thirsty', digestion: 'empty' } }).body,
    objects: Array.from({ length: full ? 64 : 1 }, (_, i) => ({ id: `object:${900000000 + i}`, appearance: clone(plan.observed[i % plan.observed.length]), count: 4, scene: 'valley', position: { x: i % 10, y: 0 }, observedAt: baseAt })) };
  observeReusableMaterials(sensor, { view, observationAt: baseAt, observedIds: view.objects.map(o => o.id) });
  if (full) {
    for (let i = 0; i < 384; i++) {
      const sampling = i >= 320, object = view.objects[(i - 320 + 64) % 64];
      view.held = [sampling ? object.id : view.objects[0].id]; view.body.digestion = i === 382 ? 'full' : 'empty';
      const action = sampling ? { type: 'sample', targetId: object.id } : { type: 'wait', seconds: 5 };
      const context = { appearance: sampling ? object.appearance : { shape: `legacy-synthetic-${i % 224}` }, relation: sampling ? 'held' : 'unknown', body: view.body };
      const seq = beginTemporalDecision(memory, { at: baseAt, action, context });
      setupLabels(observeReusableSubmission(sensor, { memory, seq, view }));
      assert.ok(completeTemporalDecision(memory, { seq, at: baseAt, actionId: i + 1,
        result: { ok: true, code: sampling ? 'SWALLOWED' : 'WAITED', durationSeconds: 0, ...(sampling ? { ingestionId: `ingestion:${i - 319}` } : {}) } }));
      const completionLabels = observeReusableCompletion(sensor, { memory, seq, view });
      try { setupLabels(completionLabels); }
      catch (error) { error.message += ` (synthetic setup receipt ${seq}: ${JSON.stringify(completionLabels.receiptUpdates[0]?.features)})`; throw error; }
    }
    // Exactly 128 synthetic retained events; W remains pending for every one of
    // the 64 exposures. F does not close H. These are not biological discoveries.
    for (let channel = 0; channel < 2; channel++) {
      view.at = baseAt + channel + 1; advanceTemporalClock(memory, view.at);
      for (const [index, ing] of memory.ingestions.entries()) {
        const event = { id: `feedback:${channel * 64 + index + 1}`, at: view.at, provenance: 'sampled', ingestionId: ing.id,
          objectId: ing.objectId, actionId: ing.actionId, effect: channel ? 'discomfort' : 'sustained' };
        const before = snapshotReusableFeedback(memory, event); recordTemporalFeedback(memory, event, { now: view.at });
        setupLabels(recordReusableFeedback(sensor, { before, memory, event, now: view.at }));
      }
    }
    for (let i = 0; i < 192; i++) model.keys[i] = plan.physical[i];
    assert.equal(memory.contextKeys.length, 256);
    assert.deepEqual(new Set(memory.contextKeys), new Set(plan.legacyKeys));
    assert.ok(temporalUtf8Bytes(memory.contextKeys) + temporalUtf8Bytes(model.keys) >= 262100);
  }
  view.held = [view.objects[0].id]; view.body.digestion = 'empty'; actor.elapsed = view.at;
  actor.inventory.items = [...view.held]; actor.discovery.observations = Object.fromEntries(view.objects.map(o => [o.id, clone(o)]));
  actor.memory.nextId = 385; actor.physiology.nextId = 129;
  const result = { name, actor, model, sensor, selector: createFiniteSelector(1729), driver: { senseAt: view.at, epoch: actor.epoch, pending: null }, view,
    admission };
  assert.deepEqual(validateTemporalLedger(memory, view.at), memory, 'Synthetic old proof graph must be losslessly canonical');
  assert.deepEqual(validateReusableOutcomeModel(model, view.at), model);
  assert.deepEqual(validateReusableOutcomeSensor(sensor, { memory, view, at: view.at, continuous: true }), sensor);
  if (full) assert.deepEqual([model.rows.length, model.rows.filter(r => r.type === 'physical').length, model.rows.filter(r => r.type === 'exposure').length,
    sensor.exposures.length, sensor.receipts.length, memory.receipts.length, memory.ingestions.length, memory.model.rows.length, memory.model.transitions.length, memory.contextKeys.length], [256, 192, 64, 64, 384, 384, 64, 256, 128, 256]);
  return result;
}

function fixtureCounts(f) {
  const memory = f.actor.discovery.temporal;
  return { ...reusableModelDiagnostics(f.model), sensorExposures: f.sensor.exposures.length, sensorReceipts: f.sensor.receipts.length,
    numericalExposureAdmissions: f.admission.exposures.length,
    physicalRowsWithReceiptSupport: f.model.rows.filter(r => r.type === 'physical' && r.receipts > 0).length,
    physicalPrimaryRowsWithNonzeroCosts: f.model.rows.filter(r => r.type === 'physical' && r.T.sum > 0 && r.E.sum > 0 && r.duration.sum > 0).length,
    sensorEvents: f.sensor.events.length, sensorMaterials: f.sensor.materials.length, legacyReceipts: memory.receipts.length,
    legacyIngestions: memory.ingestions.length, legacyRows: memory.model.rows.length, legacyTransitions: memory.model.transitions.length,
    legacyEvents: memory.events.length, legacyKeys: memory.contextKeys.length, legacyDictionaryBytes: checkTemporalCapacity(memory, FINITE_TEMPORAL_PROFILE).dictionaryBytes,
    combinedDictionaryEntries: memory.contextKeys.length + f.model.keys.length,
    combinedDictionaryBytes: temporalUtf8Bytes(memory.contextKeys) + temporalUtf8Bytes(f.model.keys) };
}
const measured = fn => { const start = performance.now(), result = fn(); return { result, ms: performance.now() - start }; };
function resetFixture(fixture) {
  const f = clone(fixture); applyTemporalCapacity(f.actor.discovery.temporal, FINITE_TEMPORAL_PROFILE);
  prepareTemporalStorage(f.actor.discovery.temporal, f.actor.discovery.temporal.contextKeys);
  const session = createReusableModelSession(f.model, f.actor.elapsed); f.model = session.snapshot(); sessions.set(f, session); return f;
}
export const prepareResourceFixtureCopy = resetFixture;
function syntheticHarness(f) {
  // The prototype supplies exactly the real bookkeeping transaction, without
  // calling its constructor, creating a world, or exposing request/step methods.
  const harness = Object.create(ReusablePredictionFixture.prototype);
  const session = sessions.get(f) || createReusableModelSession(f.model, f.actor.elapsed);
  f.model = session.snapshot(); sessions.set(f, session);
  Object.assign(harness, { npc: f.actor, sensor: f.sensor, admission: f.admission,
    selector: f.selector, sensorEnabled: true, predictionArm: 'online', now: () => performance.now(),
    predictionTimings: { native: [], batches: [], decisions: [] }, sink: null });
  Object.defineProperty(harness, 'model', { get: () => f.model, set: value => { f.model = value; } });
  Object.defineProperty(harness, 'modelSession', { get: () => sessions.get(f), set: value => sessions.set(f, value) });
  return harness;
}
function predictions(f, harness) {
  const memory = f.actor.discovery.temporal;
  const actions = [{ type: 'wait', seconds: 5 }, { type: 'sample', targetId: f.view.held[0] },
    ...f.view.objects.filter(o => !f.view.held.includes(o.id)).map(o => ({ type: 'inspect_object', targetId: o.id }))];
  const candidates = actions.map(action => {
    const support = action.targetId ? reusableMaterialSupport(f.sensor, { memory, view: f.view, objectId: action.targetId }) : {};
    return { action, features: reusableCandidateFeatures(f.sensor, { memory, view: f.view, action }), eligibility: true,
      bindingsValid: true, exactSupport: { F: support.F === true, W: support.W === true, H: support.H === true } };
  });
  const exposures = f.sensor.exposures.map(e => ({ appearance: clone(e.appearance), digestion: e.body.digestion, ageSeconds: f.view.at - e.at,
    reported: flags(e.admitted), censored: flags(e.censored), exactSupport: flags(e.admitted) }));
  let rng = f.selector.rng; const draws = Array.from({ length: 4 }, () => { rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0; return rng / 4294967296; });
  const snapshot = freeze({ at: f.view.at, ready: true, view: clone(f.view), candidates, exposures });
  const result = harness.predict(snapshot, f.model, { draws });
  return { ...result, nextRng: rng, candidateCount: candidates.length };
}

/** Complete added bookkeeping/feature/lookup/selection/update batch on a copy. */
export function runSyntheticAddedDecision(f) {
  const start = performance.now(), memory = f.actor.discovery.temporal, at = f.view.at + 1, harness = syntheticHarness(f);
  let excludedMs = 0;
  const outside = fn => { const t = performance.now(), result = fn(); excludedMs += performance.now() - t; return result; };
  f.actor.elapsed = f.view.at = at; advanceTemporalClock(memory, at);
  const native = measured(() => noteReusableNativeClock(f.sensor, { at }));
  const boundary = measured(() => advanceReusableSensor(f.sensor, { memory, at, continuous: true }));
  const beforeExposureSequence = f.model.cursors.exposure.sequence;
  const labels = measured(() => harness.applyLabels(boundary.result));
  const appliedExposureBatches = f.model.cursors.exposure.sequence - beforeExposureSequence;
  const beforePrediction = outside(() => proofHash({ model: f.model, sensor: f.sensor, memory, selector: f.selector, view: f.view }));
  const prediction = measured(() => predictions(f, harness));
  const afterPrediction = outside(() => proofHash({ model: f.model, sensor: f.sensor, memory, selector: f.selector, view: f.view }));
  outside(() => assert.equal(afterPrediction, beforePrediction, 'Prediction/selection mutated unchanged evidence'));
  f.selector.rng = prediction.result.nextRng; f.selector.choices++;
  const updateStart = performance.now(), excludedBeforeUpdate = excludedMs, seq = memory.nextSeq;
  const known = reusableCandidateFeatures(f.sensor, { memory, view: f.view, action: { type: 'wait', seconds: 5 } });
  // Canonical SYNTHETIC submission/completion labels. There is deliberately no
  // requestNpcAction/world call and no claim that this wait occurred physically.
  const context = f.name === 'cold' ? {} : temporalContext({ appearance: { shape: 'legacy-synthetic-0' }, relation: 'unknown', body: f.view.body });
  const action = { type: 'wait', seconds: 5 };
  const beforeInterval = f.model.cursors.interval.sequence;
  reusableCombinedDictionaryBudget({ memory, model: f.model, reservedContextKey: temporalKey(context, 'wait') });
  beginTemporalDecision(memory, { at, context, action });
  const intervalLabels = observeReusableSubmission(f.sensor, { memory, seq, view: f.view }); harness.applyLabels(intervalLabels);
  const closedIntervalUpdates = intervalLabels.intervalUpdates.filter(row => row.sequence > beforeInterval && row.sequence <= f.model.cursors.interval.sequence).length;
  completeTemporalDecision(memory, { seq, at, actionId: seq + 1, result: { ok: true, code: 'WAITED', durationSeconds: 0 } });
  harness.applyLabels(observeReusableCompletion(f.sensor, { memory, seq, view: f.view }));
  const retainedKnownUpdates = Number(f.model.cursors.receipt.sequence === seq);
  let refused = false, legacyRefused = false;
  if (f.name === 'full-cap-unknown') {
    const original = outside(() => proofHash(f.model)), beforeDenied = f.admission.deniedBatches;
    harness.applyLabels({ exposureUpdates: [], intervalUpdates: [], receiptUpdates: [{ sequence: seq + 1, at,
      features: { ...known, appearance: { ...known.appearance, shape: 'unseen-resource-capacity-probe' } }, completion: 'refused', effects: {}, durationSeconds: 0 }] });
    refused = f.admission.deniedBatches === beforeDenied + 1;
    try { reusableCombinedDictionaryBudget({ memory, model: f.model, reservedContextKey: temporalKey({ appearance: { shape: 'unseen-resource-capacity-probe' } }, 'wait') }); }
    catch (error) { if (error.code !== 'REUSABLE_COMBINED_CAPACITY') throw error; legacyRefused = true; harness.capacityDenied('submission', error); }
    outside(() => { assert.ok(refused && legacyRefused, 'Full-cap new contexts must refuse allocation'); assert.equal(proofHash(f.model), original); });
  }
  const labelUpdateMs = labels.ms + performance.now() - updateStart - (excludedMs - excludedBeforeUpdate);
  const wallMs = performance.now() - start, addedMs = wallMs - excludedMs;
  return { ms: addedMs, wallWithEvaluatorChecksMs: wallMs, excludedEvaluatorChecksMs: excludedMs,
    nativeSensor: native.ms, boundarySensor: boundary.ms, labels: labelUpdateMs, predictionAndSelection: prediction.ms,
    proof: { exposureBatches: boundary.result.exposureUpdates.length, appliedExposureBatches,
      retainedKnownUpdates, closedIntervalUpdates, unknownCapacityRefused: refused, unknownLegacyContextRefused: legacyRefused, candidateCount: prediction.result.candidateCount,
      predictionInputUnchanged: beforePrediction === afterPrediction, selectedIndex: prediction.result.choice.selectedIndex, selectorDraws: prediction.result.choice.committedDrawCount } };
}

/** One new synthetic channel report through the actual native callback adapter.
 * Measured separately from the decision batch, never a physical/safety assay. */
export function runSyntheticFeedbackBoundary(f) {
  if (!f.sensor.exposures.length) return { ms: 0, available: false, appliedExposureBatches: 0, emittedPhysicalEvents: 0 };
  const memory = f.actor.discovery.temporal, at = f.view.at + 1, ing = memory.ingestions[0];
  f.actor.elapsed = f.view.at = at; advanceTemporalClock(memory, at);
  f.actor.physiology.feedback = [{ id: `feedback:${memory.feedbackCursor + 1}`, at, provenance: 'sampled',
    ingestionId: ing.id, objectId: ing.objectId, actionId: ing.actionId, thirst: 'easing' }];
  const before = f.model.cursors.exposure.sequence, harness = syntheticHarness(f);
  const result = measured(() => harness.captureFeedback());
  return { ms: result.ms, available: true, appliedExposureBatches: f.model.cursors.exposure.sequence - before,
    newlyAdmittedWaterReports: f.sensor.totals[1], retainedEvents: f.sensor.events.length,
    deniedBatches: f.admission.deniedBatches, emittedPhysicalEvents: 0 };
}

export async function runResourceMeasurement(options) {
  const { smoke, quietWindow, samples, warmups, out } = options;
  if (samples !== (smoke ? 1 : 240) || warmups !== (smoke ? 0 : 40) || smoke === quietWindow) throw new TypeError('Invalid fixed measurement profile');
  // Exclusive reservation prevents replacement of any previous result, including
  // negative evidence and a prior partial report. Only this owned handle rewrites.
  const handle = await open(out, 'wx');
  const report = { schemaVersion: 1, kind: RESOURCE_PROTOCOL.kind, startedAt: new Date().toISOString(), smoke, quietWindow,
    partial: true, failures: [], cases: [], sensorCases: [], sourceClassification: 'synthetic-resource-only-never-physical-or-biological-evidence',
    legacyInteractiveGate: { status: 'failed-preserved', p95LimitMs: 5, previousEvidence: 'PR #9 and original finite-temporal resource output are unchanged', measuredAgain: false },
    methodology: { noWorldGeneration: true, noPhysicalTicks: true, noAutonomy: true, nativeSensor: 'The exact native O(1) acknowledgment is timed separately; full continuous-boundary risk/label work is in every added-decision sample.',
      workload: 'Synthetic canonical full-cap evidence with explicitly fabricated older prehistory populating all192 physical rows (188 primary rows have nonzero duration/T/E;4 conditional rows correctly omit costs), followed by384 retained receipts. All64 retained exposures each update an open W process. All128 synthetic F/H events remain fabricated resource history. Separate copied callback samples deliver one additional synthetic W report through actual native captureFeedback and numerical admission.',
      candidateSet: 'A synthetic public projection containing one held sample, wait and63 reachable inspect targets. It exercises feature lookup and the unchanged four-draw choice helper; it establishes no real mask/physical opportunity gate.',
      saveCost: 'Serialization separately measures the complete experimental actor-envelope encoder plus JSON.stringify. The raw/encoded UTF8 budget guard and immutability hashes are separately timed. No full-world save, production persistence I/O, rendered frame rate or native physical fixture cost is claimed.',
      exclusions: ['Fixture generation and strict canonical validation', 'Copied-input reset plus explicit owned immutable model session validation/cache construction (reported)', 'Serialization and UTF8 admission (reported)', 'SHA/equality checks, source hashing and report writes'],
      limitations: ['Cloud CPU/load only, no laptop or interactive claim', 'Synthetic cap stress is not an autonomous episode, physical action or biological discovery', 'Combined dictionaries retain256 old and256 new keys, sum UTF8<=256KiB with no fictional deduplication', 'Sampled process RSS/heap include report and fixture copies, not an isolated actor peak'] },
    hardware: { node: process.version, v8: process.versions.v8, platform: platform(), release: release(), arch: process.arch,
      cpu: cpus()[0]?.model, logicalCpus: cpus().length, totalMemoryBytes: totalmem(), freeMemoryBytesAtStart: freemem(), loadAverageAtStart: loadavg(), execArgv: process.execArgv }, memory: [] };
  const save = async () => { await handle.truncate(0); await handle.write(`${JSON.stringify(report, null, 2)}\n`, 0, 'utf8'); await handle.sync(); };
  const memoryPoint = label => report.memory.push({ label, ...process.memoryUsage() });
  const started = performance.now();
  try {
    await save(); report.sourcesBefore = await resourceSources(); assert.equal(report.sourcesBefore.designSha256, RESOURCE_PROTOCOL.designSha256);
    const legacyPath = 'docs/finite-temporal/interactive-gate-summary.json', legacyBytes = await readFile(resolve(ROOT, legacyPath)), legacy = JSON.parse(legacyBytes);
    assert.equal(legacy.originalInteractiveGate, 'FAILED'); assert.equal(legacy.gates.passed, false); assert.equal(legacy.gates.maxAddedDecisionP95Ms, 5);
    report.legacyInteractiveGate.originalEvidence = { path: legacyPath, sha256: hash(legacyBytes), originalInteractiveGate: legacy.originalInteractiveGate,
      gates: legacy.gates, cases: legacy.cases.map(c => ({ name: c.name, arm: c.arm, addedDecisionMs: c.addedDecisionMs, encodedActorAndMetadataBytes: c.encodedActorAndMetadataBytes, gatePassed: c.gatePassed })) };
    memoryPoint('start'); await save();
    for (const name of RESOURCE_PROTOCOL.cases) {
      const setup = measured(() => createSyntheticResourceFixture(name)), fixture = setup.result, inputHash = proofHash(fixture);
      const c = { name, measuredSamples: 0, warmupSamples: warmups, fixtureSetupMs: setup.ms, fixtureCounts: fixtureCounts(fixture), fixtureHash: inputHash,
        parameterUpdateWorkOmitted: false, skippedRequiredUpdates: 0, inputUnchanged: false, predictionInputUnchanged: true,
        rawTimingsMs: { added: [], nativeSensor: [], boundarySensor: [], feedbackSensor: [], labels: [], predictionAndSelection: [], serialization: [], byteGuard: [], reset: [] }, checkedDecisionMs: [], sampleProofs: [], feedbackProofs: [] };
      report.inProgressCase = c; await save();
      const sizeInput = { ...fixture, sourceFingerprint: report.sourcesBefore.runtimeSource };
      Object.assign(c, checkedActorSize(sizeInput));
      for (let i = -1; i < warmups + samples; i++) {
        c.currentIteration = i;
        const reset = measured(() => resetFixture(fixture)), f = reset.result;
        const result = runSyntheticAddedDecision(f); c.checkedDecisionMs.push(result.ms);
        c.lastCheckedDecision = result;
        if (i === -1) c.coldDecisionMs = result.ms;
        if (!smoke && result.ms > 1000) throw new Error(`${name}: checked single added decision exceeds1000 ms`);
        const feedback = runSyntheticFeedbackBoundary(resetFixture(fixture));
        const input = { ...f, sourceFingerprint: report.sourcesBefore.runtimeSource };
        const serialized = measured(() => JSON.stringify(reusablePredictionActorEnvelope(input)));
        const byteGuard = measured(() => checkedActorSize(input));
        assert.equal(Buffer.byteLength(serialized.result, 'utf8'), byteGuard.result.encodedActorAndMetadataBytes);
        c.encodedActorAndMetadataBytes = Math.max(c.encodedActorAndMetadataBytes, byteGuard.result.encodedActorAndMetadataBytes);
        c.rawActorAndMetadataBytes = Math.max(c.rawActorAndMetadataBytes, byteGuard.result.rawActorAndMetadataBytes);
        if (i >= warmups) {
          c.rawTimingsMs.added.push(result.ms); c.rawTimingsMs.reset.push(reset.ms); c.rawTimingsMs.serialization.push(serialized.ms);
          c.rawTimingsMs.byteGuard.push(byteGuard.ms);
          c.rawTimingsMs.feedbackSensor.push(feedback.ms); c.feedbackProofs.push(feedback);
          for (const key of ['nativeSensor', 'boundarySensor', 'labels', 'predictionAndSelection']) c.rawTimingsMs[key].push(result[key]);
          c.sampleProofs.push(result.proof); c.measuredSamples++;
          c.skippedRequiredUpdates += result.proof.exposureBatches - result.proof.appliedExposureBatches + (1 - result.proof.retainedKnownUpdates);
          c.predictionInputUnchanged &&= result.proof.predictionInputUnchanged;
        }
        if (i % 10 === 0) { memoryPoint(`${name}/${i}`); await save(); }
      }
      c.inputUnchanged = proofHash(fixture) === inputHash; assert.ok(c.inputUnchanged); c.timingsMs = Object.fromEntries(Object.entries(c.rawTimingsMs).map(([key, values]) => [key, resourceStats(values)]));
      report.cases.push(c); delete report.inProgressCase;
      report.sensorCases.push({ name, measuredSamples: samples, warmupSamples: warmups,
        nativeAcknowledgmentMs: c.timingsMs.nativeSensor, continuousBoundaryMs: c.timingsMs.boundarySensor, appliedLabelMs: c.timingsMs.labels,
        newFeedbackCaptureMs: c.timingsMs.feedbackSensor, callbackProofs: c.feedbackProofs,
        note: 'Exact harness-native acknowledgment plus actual sensor bookkeeping functions; no additional physiology or observation tick.' });
      await save();
      process.stderr.write(`${name}: ${samples} samples, p95=${c.timingsMs.added.p95.toFixed(3)} ms, actor=${c.encodedActorAndMetadataBytes} bytes${smoke ? ' (NON-ADMITTING SMOKE)' : ''}\n`);
      if (!smoke && c.timingsMs.added.p95 >= 50) throw new Error(`${name}: added-decision p95 is not below50 ms`);
    }
    report.partial = false;
  } catch (error) {
    report.failure = { code: error.code || null, message: String(error.message || error), stack: error.stack,
      ...(error.measurement ? { measurement: error.measurement } : {}) }; report.failures.push(report.failure); report.partial = true;
  } finally {
    try { report.sourcesAfter = await resourceSources(); } catch (error) { report.failures.push({ message: `Final source hash failed: ${error.message}` }); }
    if (report.sourcesBefore && report.sourcesAfter && proofHash(report.sourcesBefore) !== proofHash(report.sourcesAfter)) report.failures.push({ message: 'Exact sources changed during measurement' });
    report.finishedAt = new Date().toISOString(); report.wallMs = performance.now() - started; memoryPoint('finished');
    report.hardware.loadAverageAtEnd = loadavg(); report.hardware.freeMemoryBytesAtEnd = freemem();
    report.peakSampledRssBytes = Math.max(...report.memory.map(m => m.rss)); report.peakSampledHeapUsedBytes = Math.max(...report.memory.map(m => m.heapUsed));
    report.gates = evaluateResourceAdmission(report); report.rawEvidenceSha256 = proofHash({ cases: report.cases, inProgressCase: report.inProgressCase });
    await save(); await handle.close();
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) {
  try {
    const options = parseResourceArguments(process.argv.slice(2)), report = await runResourceMeasurement(options);
    process.stdout.write(`${JSON.stringify({ output: options.out, smoke: options.smoke, passed: report.gates.passed,
      failure: report.failure || null, cases: report.cases.map(c => ({ name: c.name, p95: c.timingsMs.added.p95, actorBytes: c.encodedActorAndMetadataBytes })) }, null, 2)}\n`);
    if (report.failure || !options.smoke && !report.gates.passed) process.exitCode = 2;
  } catch (error) { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 2; }
}
