#!/usr/bin/env node
/**
 * Evaluator-only resource benchmark, NOT an autonomous physical experiment.
 *
 * node scripts/measure-finite-temporal.mjs --smoke --out /tmp/finite-budget-smoke.json
 * node scripts/measure-finite-temporal.mjs --quiet-window --out /tmp/finite-budget.json
 *
 * Saturated temporal histories below are synthetic canonical stress fixtures.
 * They establish allocation/lookup/update cost only, never biological evidence.
 * Actual observed opportunities and actual authoritative request submissions use
 * the unmodified public driver. Every sample is a separate copied-state reset;
 * actions are submitted, not completed, and resets are never treated as outcomes.
 */
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { cpus, loadavg, totalmem, freemem, platform, release } from 'node:os';
import { createNpc } from '../src/npc-state.js';
import { recordEvent } from '../src/npc-memory.js';
import { createEnvironment } from '../src/environment.js';
import { createCommunity } from '../src/social.js';
import { canStand, freshState } from '../src/world.js';
import { discoveryDecision } from '../src/discovery.js';
import { PopulationRuntime } from '../src/population.js';
import { writeSave } from '../src/save.js';
import { createTemporalLedger, beginTemporalDecision, completeTemporalDecision, advanceTemporalClock, recordTemporalFeedback, validateTemporalLedger } from '../src/temporal-ledger.js';
import { temporalKey, decodeTemporalKey } from '../src/temporal-returns.js';
import { prepareTemporalStorage, admitTemporalContext, encodeTemporalWire, temporalUtf8Bytes } from '../src/temporal-storage.js';
import { FINITE_TEMPORAL_PROFILE, applyTemporalCapacity, checkTemporalCapacity } from '../src/temporal-capacity.js';
import { FiniteTemporalDriver, finitePublicView } from './lib/finite-temporal-driver.mjs';
import { createFiniteSelector, proposeFiniteChoice, finiteChoiceContext } from './lib/finite-temporal-policy.mjs';
import { serializeFiniteCheckpoint, restoreFiniteCheckpoint, FINITE_CHECKPOINT } from './lib/finite-temporal-checkpoint.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SELF = fileURLToPath(import.meta.url), copy = value => structuredClone(value);
const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const freeze = value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const SUMMARY = 'I am testing an available action using predicted experienced consequences and bounded exploration.';
const ARMS = ['online', 'no-bootstrap', 'frozen-zero'];
const CASES = ['cold', 'full-cap-known', 'full-cap-unknown'];
const args = process.argv.slice(2), option = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const smoke = args.includes('--smoke'), output = option('--out', '/tmp/finite-temporal-budget.json');
const samples = Number(option('--samples', smoke ? '1' : '240'));
const warmup = Number(option('--warmup', smoke ? '0' : '60'));
const saves = Number(option('--save-samples', smoke ? '1' : '9'));
if (!smoke && !args.includes('--quiet-window')) throw new Error('Heavy measurement requires an explicitly approved quiet window: pass --quiet-window.');
assert.ok(Number.isInteger(samples) && samples >= (smoke ? 1 : 200) && samples <= 5000, 'Invalid measured sample count');
assert.ok(Number.isInteger(warmup) && warmup >= (smoke ? 0 : 40) && warmup <= 1000, 'At least 40 warmups required');
assert.ok(Number.isInteger(saves) && saves >= 1 && saves <= 50);
const stats = values => { const sorted = [...values].sort((a, b) => a - b), q = p => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? null; return { n: sorted.length, p50: q(.5), p95: q(.95), p99: q(.99), max: sorted.at(-1) ?? null, mean: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null }; };
const measured = fn => { const start = performance.now(), result = fn(); return { result, ms: performance.now() - start }; };
const memoryPoints = [], memoryPoint = label => { const p = { label, ...process.memoryUsage() }; memoryPoints.push(p); return p; };
function counts(m) { return { rows: m.model.rows.length, transitions: m.model.transitions.length, receipts: m.receipts.length, ingestions: m.ingestions.length, events: m.events.length, ...checkTemporalCapacity(m, FINITE_TEMPORAL_PROFILE), distinctReplayKeys: new Set(m.model.transitions.map(row => row.key)).size, updateableReplayKeys: new Set(m.model.transitions.filter(t => m.model.rows.some(r => r.key === t.key)).map(t => t.key)).size, modelSaturated: m.model.saturated, storageSaturated: m.storage.saturated, overflows: m.storage.overflows, historyCensored: m.historyCensored, modelHistoryCensored: m.model.historyCensored, censoredEvents: m.censoredEvents, rejectedEvents: m.rejectedEvents, creditBlocked: m.creditBlocked }; }
async function filesUnder(path) { const entries = await readdir(path, { withFileTypes: true }); const nested = await Promise.all(entries.map(e => e.isDirectory() ? filesUnder(resolve(path, e.name)) : [resolve(path, e.name)])); return nested.flat(); }
async function sources() {
  const paths = [...await filesUnder(resolve(ROOT, 'src')), ...await filesUnder(resolve(ROOT, 'scripts/lib')), resolve(ROOT, 'package.json'), resolve(ROOT, 'package-lock.json')].sort((a, b) => relative(ROOT, a).localeCompare(relative(ROOT, b), 'en'));
  const files = await Promise.all(paths.map(async p => ({ path: relative(ROOT, p).replaceAll('\\', '/'), sha256: hash(await readFile(p)) })));
  // Plain codepoint ordering is shared with the autonomous evaluator.
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const runtimeSource = hash(files.map(f => `${f.path}\0${f.sha256}\n`).join(''));
  let evaluatorSource = null;
  try { evaluatorSource = hash(await readFile(resolve(ROOT, 'scripts/evaluate-finite-temporal.mjs'))); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  return { runtimeSource, benchmarkSource: hash(await readFile(SELF)), evaluatorSource, files };
}

/** Deliberately fake resource history: timestamps/IDs/receipts are canonical but
 * the 384 retained records (386 generated) and 128 feedback payloads did NOT happen physically. */
function stressMemory(view, opportunity, known) {
  const prototype = createTemporalLedger({ capacityProfile: FINITE_TEMPORAL_PROFILE.name });
  prototype.historyCensored = true; prototype.model.historyCensored = true;
  prototype.ingestions = Array.from({ length: 64 }, (_, i) => ({ id: `ingestion:${i + 1}`, objectId: `object:${900000000 + i}`, seq: 323 + i, at: 0, channels: 7 }));
  const seeds = new Map();
  if (known) for (const candidate of opportunity.choices) for (const focus of [null, candidate.action.targetId || candidate.bindingId ? { objectId: candidate.action.targetId || candidate.bindingId } : null]) {
    const context = finiteChoiceContext(view, prototype, candidate, focus);
    seeds.set(temporalKey(context, candidate.action.type), { context, type: candidate.action.type });
  }
  assert.ok(seeds.size < 128, 'Unexpectedly broad known-key fixture');
  const actualKeyCount = seeds.size;
  for (let i = 0; seeds.size < 192; i++) {
    const context = { appearance: { shape: `synthetic-capacity-row-${i}` }, historyCensored: true };
    seeds.set(temporalKey(context, 'wait'), { context, type: 'wait' });
  }
  const sampleContexts = Array.from({ length: 64 }, (_, i) => ({ type: 'sample', context: { appearance: { shape: `synthetic-sample-${i}` }, historyCensored: true } }));
  const contexts = [...seeds.values(), ...sampleContexts], m = createTemporalLedger({ capacityProfile: FINITE_TEMPORAL_PROFILE.name });
  let feedback = 0;
  for (let i = 0; i < 386; i++) {
    const sampling = i >= 322;
    // Put every eventual replay key in the durable rows first. One refused
    // 257th row precedes (and is evicted from) the final 128-key replay window.
    const source = i < 256 ? contexts[i] : i === 256 ? { type: 'wait', context: { appearance: { shape: 'synthetic-row-overflow' } } } : sampling ? sampleContexts[i - 322] : contexts[i - 257];
    const action = source.type === 'wait' ? { type: 'wait', seconds: 5 } : source.type === 'move' ? { type: 'move', target: { x: 0, y: 0 } } : { type: source.type, targetId: `object:${900000000 + (sampling ? i - 322 : i)}` };
    const seq = beginTemporalDecision(m, { at: 0, context: source.context, action });
    assert.ok(completeTemporalDecision(m, { seq, at: 0, actionId: i + 1, result: sampling ? { ok: true, code: 'SWALLOWED', ingestionId: `ingestion:${i - 321}`, durationSeconds: 0 } : { ok: false, code: 'SYNTHETIC_RESOURCE_FIXTURE', durationSeconds: 0 } }));
    if (sampling) for (const kind of ['benefit', 'harm']) {
      const event = { id: `feedback:${++feedback}`, at: 0, ingestionId: `ingestion:${i - 321}`, objectId: action.targetId, actionId: i + 1, provenance: 'sampled', effect: kind === 'benefit' ? 'sustained' : 'discomfort', ...(kind === 'benefit' ? { thirst: 'easing' } : {}) };
      assert.ok(recordTemporalFeedback(m, event, { now: 0 }));
    }
  }
  for (let i = 0; m.contextKeys.length < 512; i++) assert.ok(admitTemporalContext(m, temporalKey({ appearance: { shape: `synthetic-dictionary-only-${i}` } }, 'wait')), '512 keys must fit dictionary byte cap');
  assert.equal(admitTemporalContext(m, temporalKey({ appearance: { shape: 'synthetic-capacity-overflow-probe' } }, 'wait')), false);
  assert.deepEqual(validateTemporalLedger(m, 0), m, 'Synthetic stress proof graph must be exactly canonical, not normalized into validity');
  assert.deepEqual([m.model.rows.length, m.model.transitions.length, m.receipts.length, m.ingestions.length, m.events.length, m.contextKeys.length], [256, 128, 384, 64, 128, 512]);
  const retained = new Set(m.model.rows.map(row => row.key));
  assert.equal(new Set(m.model.transitions.map(row => row.key)).size, 128, 'Stress all 128 distinct replay update keys');
  assert.ok(m.model.transitions.every(row => retained.has(row.key) && retained.has(row.nextKey)), 'Every replay key and successor must have a retained durable row');
  return { memory: m, actualKeyCount };
}
function stateWith(actor, environment) { return { elapsed: actor.elapsed, simulationMode: 'discovery', environment, agents: [actor], npc: actor, community: createCommunity(), cardinal: null }; }
function reset(driver, actor, selector) {
  const n = driver.npc, cloned = copy(actor);
  for (const key of Object.keys(n)) delete n[key]; Object.assign(n, cloned);
  applyTemporalCapacity(n.discovery.temporal, FINITE_TEMPORAL_PROFILE);
  // Copied ledgers lose WeakMap caches. Restoration/cache initialization is reset
  // setup, not work a persistent decision pays. Its cost is recorded separately.
  prepareTemporalStorage(n.discovery.temporal, n.discovery.temporal.contextKeys);
  driver.selector = copy(selector); driver.pending = null; driver.controller.senseAt = 0; driver.controller.epoch = n.epoch;
}
function decision(driver, opportunity) {
  // Same public projection/proposal/record/submission path as tickActor. All of
  // this is inside added-work timing, including immediate receipt capture and
  // actual interval closure/profile admission/eight-sweep training in submit.
  driver.captureFeedback(); driver.captureCompletion();
  const proposal = proposeFiniteChoice(finitePublicView(driver.npc), driver.memory, driver.selector, opportunity);
  driver.npc.decision = SUMMARY;
  recordEvent(driver.npc, 'decision', { provider: 'discovery-learner', summary: SUMMARY });
  assert.ok(driver.submit(proposal.selected.action, { proposal, opportunity, context: proposal.selected.context, reason: SUMMARY }));
  return proposal;
}
function nextRng(seed) { for (let i = 0; i < 4; i++) seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; }
function checkpointInput(driver, fingerprint) { return { state: driver.state, selector: driver.selector, driver: driver.checkpointDriver(), arm: driver.arm, sourceFingerprint: fingerprint }; }
function exactActorBytes(text) { const { state, ...metadata } = JSON.parse(text); return temporalUtf8Bytes({ ...metadata, actor: state.agents[0] }); }
async function eventLoopOperation(fn) { await new Promise(resolve => setImmediate(resolve)); const start = performance.now(); const next = new Promise(resolve => setImmediate(() => resolve(performance.now() - start))); const result = measured(fn); return { ...result, eventLoopGapMs: await next }; }

const startedAt = new Date().toISOString(), startSource = await sources(), started = performance.now();
const report = {
  schemaVersion: 1, kind: 'finite-temporal-resource-benchmark', startedAt, smoke, source: startSource,
  hardware: { node: process.version, v8: process.versions.v8, platform: platform(), release: release(), arch: process.arch, cpu: cpus()[0]?.model, logicalCpus: cpus().length, totalMemoryBytes: totalmem(), freeMemoryBytesAtStart: freemem(), loadAverageAtStart: loadavg(), execArgv: process.execArgv },
  methodology: {
    classification: 'Controlled copied-state request-submission microbenchmark; no autonomous episode and no physiological success claim.',
    syntheticHistory: 'Full-cap fixtures retain 384 synthetic canonical receipts from 386 generated submissions, with 128 distinct durable replay update keys; they contain synthetic, ingestion proofs, biological events and prediction contexts. None establishes an actual acquisition, swallow or biological benefit. They measure only bounded memory access, admission and return-update work.',
    physicalOpportunity: 'One development world seed 74193, default cold body, first existing fruit source (apple_tree or bramble) and first collision-valid 45-unit east/west/north/south approach. Real constructor observation; complete immutable opportunity list with original order/scores/routes. Same genuine observed set in all arms and stress cases.',
    timedAddedWork: 'Flush feedback/completion; finitePublicView; all candidate contexts/keys/value lookup; four-draw proposal; decision event; actual cognitive normalization and authoritative driver.submit; selector/opportunity RNG commit; profile/dictionary/receipt admission; previous interval close; immediate completion capture; full scheduled training. No runtime optimization or cap changes.',
    legacyConstruction: 'Timed separately on an independently copied identical pre-action actor. Compared exactly with the frozen opportunity set each time. Combined is the same-sample construction + added-work sum, excluding reset setup.',
    excluded: ['Single ecology generation, initial controller observation and fixture construction/validation', 'Per-copy actor cloning, profile reattachment and WeakMap dictionary-cache reconstruction (separately reported)', 'Opportunity snapshot deep freeze, equality checks and post-submission assertions', 'Source and evidence hashing, JSON report formatting, checkpoints and save measurements', 'No physical action completion or elapsed episode occurs inside request timings; every copied active action is discarded as setup reset, never credited as an outcome'],
    sensors: 'Separate native 1/60-second no-decision physical trace, paired with ordinary PopulationRuntime and same world/body; driver timings directly expose sensor phase. Scheduled observation/biology/environment remain in paired total native-step timings. No autonomous choice or completed-food claim.',
    saveFrameGap: 'Production synchronous writeSave paired with identical full-game state minus temporal memory. In-memory storage sink excludes disk/IPC. setImmediate delay measures event-loop blocking, not rendered Electron frame rate.',
    limitations: ['Cloud CPU and current system load only; no laptop budget or smooth-frame claim', 'Warmed JIT but independent reset snapshots, not a continuing learned trajectory', 'Synthetic stress records all use timestamp zero, so their discount gaps are zero; this is a cap/lookup/update workload, not a worst-case timing bound over every numeric trajectory', 'Finite source is not exhausted or physically sampled by the synthetic memory fixture', 'The initial cold-body opportunity has no held-item sample/release choices and the synthetic IDs do not match source lineage; saturated counts therefore admit this fixture only, not worst-case later learned-policy latency', 'This actor-size admission is a measured fixture result, not a bound on every future ordinary NPC memory'],
  },
  gates: { minimumMeasuredSubmissions: 200, maxAddedDecisionP95Ms: 5, maxEncodedActorBytes: FINITE_CHECKPOINT.actorBytes, passed: false }, cases: [],
};
try {
memoryPoint('before-generation');
const generation = measured(() => createEnvironment(74193, { mode: 'discovery' })), environment = generation.result;
report.generationMs = generation.ms;
const tree = environment.ecology.plants.find(p => ['apple_tree', 'bramble'].includes(p.kind)); assert.ok(tree);
const actor = createNpc({ mode: 'discovery', seed: 74193 });
actor.position = [{ x: 45, y: 0 }, { x: -45, y: 0 }, { x: 0, y: -45 }, { x: 0, y: 45 }].map(d => ({ x: tree.position.x + d.x, y: tree.position.y + d.y })).find(p => canStand(p.x, p.y, 'valley')); assert.ok(actor.position);
const setup = measured(() => new FiniteTemporalDriver(stateWith(actor, environment), { automatic: false })), original = setup.result;
const construction = measured(() => discoveryDecision(original.npc, { foodLearning: false, ordinaryProposal: true }));
assert.ok(construction.result.ordinary, 'Expected ordinary actual opportunity');
const opportunity = freeze(copy(construction.result.ordinary)), baseActor = copy(original.npc), observedView = finitePublicView(baseActor);
const opportunityHash = hash(opportunity), environmentHash = hash(environment), bodyHash = hash(baseActor.physiology);
report.fixture = { seed: 74193, sourceId: tree.id, sourcePosition: tree.position, position: actor.position, bodyHash, environmentHash, opportunityHash, opportunity, observedObjectCount: observedView.objects.length, constructorMs: setup.ms, initialConstructionMs: construction.ms };
original.dispose(); freeze(environment);
const fixtureSetup = measured(() => CASES.map(name => { const n = copy(baseActor), stress = name === 'cold' ? null : stressMemory(observedView, opportunity, name === 'full-cap-known'); if (stress) { n.discovery.temporal = stress.memory; n.memory.nextId = 513; n.physiology.nextId = 513; } return { name, actor: n, actualKeyCount: stress?.actualKeyCount || 0 }; }));
report.fixtureSetupMs = fixtureSetup.ms;
memoryPoint('fixtures-ready');

for (const fixture of fixtureSetup.result) for (const arm of ARMS) {
  const d = new FiniteTemporalDriver(stateWith(copy(fixture.actor), environment), { arm, automatic: false, driver: { senseAt: 0, epoch: fixture.actor.epoch, pending: null } });
  reset(d, fixture.actor, createFiniteSelector(1729));
  const validation = measured(() => { assert.deepEqual(validateTemporalLedger(d.memory, d.npc.elapsed), d.memory); return serializeFiniteCheckpoint(checkpointInput(d, startSource.runtimeSource)); });
  const restored = measured(() => restoreFiniteCheckpoint(validation.result, { expectedArm: arm, expectedSourceFingerprint: startSource.runtimeSource }));
  assert.deepEqual(restored.result.state.npc.discovery.temporal, d.memory);
  const fixtureCounts = counts(d.memory), fixtureMemoryHash = hash(d.memory);
  const { state: unusedInitialState, ...actorEnvelopeHeader } = JSON.parse(validation.result);
  const raw = { added: [], construction: [], combined: [], reset: [] }, actions = {}, selection = { known: 0, unknown: 0, exploring: 0, started: 0, immediate: 0 }, sampleProofs = [];
  report.inProgressCase = { name: fixture.name, arm, fixtureCounts, fixtureMemoryHash, measuredSubmissionsRequested: samples, warmupSubmissions: warmup, rawTimingsMs: raw, sampleProofs, selection, actions, originalCheckpoint: validation.result };
  let selector = createFiniteSelector(1729), peakActorBytes = exactActorBytes(validation.result), lastCheckpoint = validation.result;
  for (let i = 0; i < warmup + samples; i++) {
    const setupMs = measured(() => reset(d, fixture.actor, selector)).ms;
    const constructionActor = copy(fixture.actor);
    const built = measured(() => discoveryDecision(constructionActor, { foodLearning: false, ordinaryProposal: true }));
    assert.deepEqual(built.result.ordinary, opportunity, 'Opportunity changed during copied-state benchmark');
    report.inProgressCase.currentIteration = i; report.inProgressCase.currentActor = d.npc; report.inProgressCase.currentSelector = d.selector;
    const before = { rowUpdates: d.memory.model.rows.reduce((sum, row) => sum + row.updates, 0), actorRng: d.npc.rng, selector: copy(d.selector), nextSeq: d.memory.nextSeq, updates: d.memory.model.updateCount, feedback: hash(d.npc.physiology.feedback) };
    const added = measured(() => decision(d, opportunity)), proposal = added.result;
    assert.equal(d.selector.rng, nextRng(before.selector.rng)); assert.equal(d.selector.choices, before.selector.choices + 1); assert.equal(d.npc.rng, opportunity.rngAfter);
    assert.equal(d.memory.nextSeq, before.nextSeq + 1); assert.equal(d.npc.elapsed, 0); assert.equal(hash(d.npc.physiology.feedback), before.feedback, 'Unexpected synchronous biology at submission');
    assert.equal(d.memory.model.updateCount - before.updates, arm === 'frozen-zero' ? 0 : 8);
    assert.equal(hash(opportunity), opportunityHash); checkTemporalCapacity(d.memory, FINITE_TEMPORAL_PROFILE);
    const updatedRowsPerSweep = arm === 'frozen-zero' ? 0 : (d.memory.model.rows.reduce((sum, row) => sum + row.updates, 0) - before.rowUpdates) / 8;
    if (fixture.name !== 'cold') assert.equal(updatedRowsPerSweep, arm === 'frozen-zero' ? 0 : 128, 'Every one of the 128 distinct retained replay rows must update in each sweep');
    const receipt = d.memory.receipts.at(-1); assert.deepEqual(receipt.request, proposal.selected.action); assert.ok(d.npc.active || receipt.outcome);
    if (fixture.name === 'full-cap-known') assert.ok(proposal.selected.known, 'Known stress case must actually select a retained visited row');
    if (fixture.name === 'full-cap-unknown') { assert.equal(proposal.selected.known, false); assert.equal(receipt.unknownContext, true); }
    if (i >= warmup) {
      raw.added.push(added.ms); raw.construction.push(built.ms); raw.combined.push(added.ms + built.ms); raw.reset.push(setupMs);
      selection[proposal.selected.known ? 'known' : 'unknown']++; selection.exploring += Number(proposal.exploring); selection[d.npc.active ? 'started' : 'immediate']++;
      actions[proposal.selected.action.type] = (actions[proposal.selected.action.type] || 0) + 1;
      sampleProofs.push({ updatedRowsPerSweep, selectorRngBefore: before.selector.rng, selectorRngAfter: d.selector.rng, choice: proposal.selected.index, action: proposal.selected.action, known: proposal.selected.known, exploring: proposal.exploring, receiptSeq: receipt.seq, unknownContext: receipt.unknownContext === true, active: Boolean(d.npc.active), outcome: receipt.outcome || null });
    }
    // Exact encoded complete actor + envelope metadata, every sample. Encoding
    // and size checks are evaluation overhead outside the decision timer.
    const actorWire = { ...d.npc, discovery: { ...d.npc.discovery, temporal: encodeTemporalWire(d.memory) } };
    peakActorBytes = Math.max(peakActorBytes, temporalUtf8Bytes({ ...actorEnvelopeHeader, selector: d.selector, driver: d.checkpointDriver(), actor: actorWire }));
    if (peakActorBytes > FINITE_CHECKPOINT.actorBytes) { report.capacityFailure = { name: fixture.name, arm, iteration: i, encodedActorAndMetadataBytes: peakActorBytes }; throw new Error('Actual actor exceeded the preregistered admission gate'); }
    selector = { version: 1, rng: d.selector.rng, choices: d.selector.choices, focus: null }; // Each physical copy has no prior focus.
    if (i % 25 === 0) memoryPoint(`${fixture.name}/${arm}/${i}`);
  }
  lastCheckpoint = serializeFiniteCheckpoint(checkpointInput(d, startSource.runtimeSource));
  const result = { name: fixture.name, arm, parameterUpdateWorkOmitted: arm === 'frozen-zero', measuredSubmissions: samples, warmupSubmissions: warmup, fixtureCounts, fixtureMemoryHash, retainedRealOpportunityKeys: fixture.actualKeyCount, addedDecisionMs: stats(raw.added), legacyConstructionMs: stats(raw.construction), combinedDecisionMs: stats(raw.combined), excludedResetMs: stats(raw.reset), encodedActorAndMetadataBytes: Math.max(peakActorBytes, exactActorBytes(lastCheckpoint)), checkpointBytes: Buffer.byteLength(lastCheckpoint), validationAndSerializeMs: validation.ms, restoreValidationMs: restored.ms, selection, actions, finalCounts: counts(d.memory), finalMemoryHash: hash(d.memory), rawTimingsMs: raw, sampleProofs, checkpoint: {}, productionSave: {}, gatePassed: false };
  // Save measurements use the validated initial snapshot, not an interrupted
  // command. This avoids conflating restart normalization with serializer cost.
  reset(d, fixture.actor, createFiniteSelector(1729));
  const cp = { serialize: [], restore: [], eventLoopGap: [] };
  for (let i = 0; i < saves; i++) {
    const encoded = await eventLoopOperation(() => serializeFiniteCheckpoint(checkpointInput(d, startSource.runtimeSource)));
    cp.serialize.push(encoded.ms); cp.eventLoopGap.push(encoded.eventLoopGapMs);
    cp.restore.push(measured(() => restoreFiniteCheckpoint(encoded.result, { expectedArm: arm, expectedSourceFingerprint: startSource.runtimeSource })).ms);
  }
  result.checkpoint = { serializeMs: stats(cp.serialize), restoreMs: stats(cp.restore), eventLoopGapMs: stats(cp.eventLoopGap), rawMs: cp, bytes: Buffer.byteLength(validation.result) };
  const game = freshState({ mode: 'discovery', populateEcology: false }); game.environment = environment; game.cardinal = null; game.agents = [copy(fixture.actor), createNpc({ id: 'mira', mode: 'discovery' })]; game.npc = game.agents[0];
  const baseline = copy(game); delete baseline.agents[0].discovery.temporal; baseline.npc = baseline.agents[0];
  const paired = { withTemporal: [], baseline: [], withTemporalGap: [], baselineGap: [], emptyGap: [], delta: [] }; let fullBytes = 0, baselineBytes = 0;
  for (let i = 0; i < saves; i++) {
    const empty = await eventLoopOperation(() => {}); paired.emptyGap.push(empty.eventLoopGapMs);
    const run = async (state, kind) => { let encoded = ''; const p = await eventLoopOperation(() => { assert.ok(writeSave({ setItem(key, value) { encoded = value; } }, state), 'Production save rejected fixture'); }); paired[kind].push(p.ms); paired[`${kind}Gap`].push(p.eventLoopGapMs); return Buffer.byteLength(encoded); };
    if (i % 2) { fullBytes = await run(game, 'withTemporal'); baselineBytes = await run(baseline, 'baseline'); } else { baselineBytes = await run(baseline, 'baseline'); fullBytes = await run(game, 'withTemporal'); }
    paired.delta.push(paired.withTemporal.at(-1) - paired.baseline.at(-1));
  }
  result.productionSave = { withTemporalBytes: fullBytes, baselineBytes, addedBytes: fullBytes - baselineBytes, withTemporalMs: stats(paired.withTemporal), baselineMs: stats(paired.baseline), pairedAddedMs: stats(paired.delta), withTemporalEventLoopGapMs: stats(paired.withTemporalGap), baselineEventLoopGapMs: stats(paired.baselineGap), emptyEventLoopGapMs: stats(paired.emptyGap), rawMs: paired };
  result.gatePassed = !smoke && samples >= 200 && result.addedDecisionMs.p95 <= 5 && result.encodedActorAndMetadataBytes <= FINITE_CHECKPOINT.actorBytes;
  report.cases.push(result); delete report.inProgressCase; d.dispose();
  await writeFile(output, `${JSON.stringify({ ...report, partial: true }, null, 2)}\n`);
  process.stderr.write(`${fixture.name}/${arm}: ${samples} measured, added p95=${result.addedDecisionMs.p95.toFixed(3)} ms, actor=${result.encodedActorAndMetadataBytes} bytes${smoke ? ' (SMOKE ONLY)' : ''}\n`);
}

// Sensor overhead is outside decision work, so expose it rather than hide it.
report.sensorCases = [];
for (const fixture of fixtureSetup.result.filter(f => f.name !== 'full-cap-unknown')) {
  const a = copy(fixture.actor), b = copy(fixture.actor); a.nextDecisionAt = b.nextDecisionAt = 1000; delete b.discovery.temporal;
  const d = new FiniteTemporalDriver(stateWith(a, copy(environment)), { automatic: false, driver: { senseAt: 0, epoch: a.epoch, pending: null } });
  const baselineState = stateWith(b, copy(environment)), baseline = new PopulationRuntime(baselineState, { cardinal: false, discoveryFoodLearning: false });
  baseline.controller(b.id).social = null; baseline.social = { observe() {}, tick() {} }; baseline.controller(b.id).senseAt = 0;
  const sensor = [], full = [], normal = [], delta = [], n = smoke ? 1 : 240, w = smoke ? 0 : 40;
  for (let i = 0; i < w + n; i++) {
    const real = () => measured(() => d.step(1 / 60)).ms;
    const control = () => measured(() => { baselineState.elapsed += 1 / 60; baseline.tick(1 / 60); }).ms;
    let x, y; if (i % 2) { x = real(); y = control(); } else { y = control(); x = real(); }
    if (i >= w) { sensor.push(d.timings.sensors.at(-1)); full.push(x); normal.push(y); delta.push(x - y); }
  }
  assert.equal(d.submissions, 0); assert.equal(d.npc.active, null); assert.equal(b.active, null);
  const normalizedA = copy(d.npc), normalizedB = copy(b); delete normalizedA.discovery.temporal;
  assert.deepEqual(normalizedA, normalizedB, 'Paired no-decision sensor trace must preserve ordinary actor');
  assert.deepEqual(d.state.environment, baselineState.environment, 'Paired native sensor worlds diverged');
  report.sensorCases.push({ name: fixture.name, measuredTicks: n, warmupTicks: w, dt: 1 / 60, sensorPhaseMs: stats(sensor), adapterNativeStepMs: stats(full), baselineNativeStepMs: stats(normal), pairedNativeStepDeltaMs: stats(delta), rawMs: { sensor, full, normal, delta }, physicalSeconds: d.npc.elapsed, emittedBiologicalEvents: d.npc.physiology.feedback.length, limitation: 'Default body with no new digestive input; this trace measures quiet/retained-history sensors, not a worst-case newly emitted ingestion-feedback burst.' });
  d.dispose(); baseline.dispose();
}
// Replay the sensor boundary of an actually completed scripted wait. This is
// isolated copied-state instrumentation, not a new autonomous physical episode.
report.sensorCompletionCases = [];
for (const fixture of fixtureSetup.result.filter(f => f.name !== 'full-cap-unknown')) {
  let completedActor = null;
  const preparation = performance.now();
  const physical = new FiniteTemporalDriver(stateWith(copy(fixture.actor), copy(environment)), { automatic: false, driver: { senseAt: 0, epoch: fixture.actor.epoch, pending: null }, sink: event => { if (event.type === 'outcome') completedActor = copy(physical.npc); } });
  const request = { type: 'wait', seconds: 5 };
  const context = finiteChoiceContext(finitePublicView(physical.npc), physical.memory, { action: request }, null);
  assert.ok(physical.submit(request, { context }));
  let precedingMemory, precedingPending;
  while (physical.npc.active) {
    if (physical.npc.elapsed >= 4.9) { precedingMemory = copy(physical.memory); precedingPending = copy(physical.pending); }
    physical.step(1 / 60); assert.ok(physical.npc.elapsed < 5.1, 'Scripted wait did not complete on schedule');
  }
  assert.ok(completedActor && precedingMemory && precedingPending);
  assert.equal(completedActor.lastResult.code, 'WAITED');
  // The actual sensor calls consumed this real completion already. Replace only
  // their temporal state by its captured immediately preceding state to measure
  // that same boundary repeatedly. Body/result/world evidence remains untouched.
  completedActor.discovery.temporal = precedingMemory;
  const d = new FiniteTemporalDriver(stateWith(copy(completedActor), copy(physical.state.environment)), { automatic: false, driver: { senseAt: physical.controller.senseAt, epoch: completedActor.epoch, pending: precedingPending } });
  const valid = measured(() => serializeFiniteCheckpoint(checkpointInput(d, startSource.runtimeSource)));
  const preparationMs = performance.now() - preparation;
  const sensor = [], resetMs = [], n = smoke ? 1 : 240, w = smoke ? 0 : 40;
  for (let i = 0; i < w + n; i++) {
    const resetTime = measured(() => { reset(d, completedActor, createFiniteSelector(1729)); d.pending = copy(precedingPending); }).ms;
    const measurement = measured(() => { advanceTemporalClock(d.memory, d.npc.elapsed); d.captureFeedback(); d.captureCompletion(); });
    assert.equal(d.pending, null); assert.equal(d.memory.receipts.at(-1).outcome.code, 'WAITED');
    assert.equal(d.memory.receipts.at(-1).outcome.actionId, completedActor.lastResult.eventId);
    if (i >= w) { sensor.push(measurement.ms); resetMs.push(resetTime); }
  }
  report.sensorCompletionCases.push({ name: fixture.name, measuredBoundaries: n, warmupBoundaries: w, preparationMs, validationMs: valid.ms, sensorPhaseMs: stats(sensor), excludedResetMs: stats(resetMs), rawMs: { sensor, reset: resetMs }, actualOutcome: completedActor.lastResult, physicalSeconds: physical.npc.elapsed, actualPhysicalSubmissions: physical.submissions, actualPhysicalOutcomes: physical.outcomes, explanation: 'One actual scripted five-second wait was completed with native shared-world stepping. Repeated measurements replay only the exact observed post-body/pre-sensor completion boundary on copies; synthetic stress histories are still not biological evidence.' });
  physical.dispose(); d.dispose();
}
assert.equal(hash(environment), environmentHash, 'Submission benchmark mutated the source physical environment');
const finalSource = await sources(); assert.deepEqual(finalSource, startSource, 'Sources changed during measurement; result cannot authorize a frozen run');
memoryPoint('finished');
report.finishedAt = new Date().toISOString(); report.wallMs = performance.now() - started;
report.hardware.loadAverageAtEnd = loadavg(); report.hardware.freeMemoryBytesAtEnd = freemem();
report.memory = { snapshots: memoryPoints, peakSampledHeapUsedBytes: Math.max(...memoryPoints.map(m => m.heapUsed)), peakSampledHeapTotalBytes: Math.max(...memoryPoints.map(m => m.heapTotal)), peakSampledRssBytes: Math.max(...memoryPoints.map(m => m.rss)), caveat: 'Whole evaluator process, including source buffers, copied fixtures, report arrays and serialization. Sampled maxima are not a proven transient peak or isolated runtime memory requirement; garbage collection is not forced.' };
report.gates.passed = !smoke && report.cases.length === ARMS.length * CASES.length && report.cases.every(c => c.gatePassed);
report.rawEvidenceSha256 = hash(report.cases.map(c => ({ name: c.name, arm: c.arm, rawTimingsMs: c.rawTimingsMs, sampleProofs: c.sampleProofs })));
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ output, smoke, gatePassed: report.gates.passed, runtimeSource: startSource.runtimeSource, cases: report.cases.map(c => ({ name: c.name, arm: c.arm, p95: c.addedDecisionMs.p95, bytes: c.encodedActorAndMetadataBytes })), wallMs: report.wallMs }, null, 2)}\n`);
if (!smoke && !report.gates.passed) process.exitCode = 2;

} catch (error) {
  report.finishedAt = new Date().toISOString(); report.gates.passed = false;
  report.failure = { message: String(error.message || error), stack: error.stack };
  report.memoryAtFailure = process.memoryUsage(); report.partial = true;
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  throw error;
}
