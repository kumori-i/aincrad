import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { VALIDATION_PRODUCER, createValidationBlobStore, runValidationCase, completeRetainedBindings,
  replayValidationCallbackWindows, assertValidationDispatch } from '../scripts/lib/reusable-validation-producer.mjs';
import { ReusablePredictionFixture } from '../scripts/lib/reusable-prediction-fixture.mjs';
import { createReusableOutcomeModel, createReusableModelSession } from '../scripts/lib/reusable-outcome-model.mjs';
import { createReusableOutcomeSensor, observeReusableSubmission, observeReusableCompletion, observeReusableMaterials,
  snapshotReusableFeedback, recordReusableFeedback } from '../scripts/lib/reusable-outcome-sensor.mjs';
import { createTemporalLedger, beginTemporalDecision, advanceTemporalClock, completeTemporalDecision, recordTemporalFeedback } from '../src/temporal-ledger.js';
import { temporalContext } from '../src/temporal-returns.js';
import { assessPairedPhysicalForecast, assessChannelAdmission, VALIDATION_CENSUS } from '../scripts/lib/reusable-validation-evidence.mjs';

// Only deterministic injected fake clocks/worlds and small synthetic public-ledger
// rows. No native environment/fixture constructor, reserved physical case, seed
// assay, biological outcome experiment, benchmark, or cohort is invoked here.
const SOURCE = 'd'.repeat(64), clone = x => structuredClone(x);
const digest = x => createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex');
const appearance = { shape: 'round', color: 'red', texture: 'smooth', motion: 'still', size: 'small', smell: 'sweet' };
const passed = () => ({ status: 'passed', failures: [], unavailable: [] });
const mockChecks = { assessChannelAdmission: passed, assessPairedPhysicalForecast: passed, assessPhysicalCompletion: passed,
  assessOldMealAttribution: passed, assessDelayedHarm: passed, assessReleaseComparisons: passed, assessSmallPortion: passed,
  compareOldMealSchedules: passed, assessSourceOrderReplay: passed };

function fakeFixture(options, { masked = null, neverSense = false, earlyFood = false, refuse = false, neverComplete = false, initialMass = 180 } = {}) {
  const f = { automatic: false, predictionArm: 'online', sensorEnabled: true, sourceFingerprint: options.sourceFingerprint,
    owner: { physicalSeed: 74193, sourceId: 'object:1', bodyOverrides: {}, resourceOverrides: {} },
    model: createReusableOutcomeModel(), selector: { rng: 1 }, admission: { deniedSubmissions: 0, deniedBatches: 0, exposures: [] },
    sensor: { clockAt: 0, observationAt: null, totals: [0, 0, 0], materials: [], exposures: [], events: [], receipts: [] },
    memory: { nextSeq: 1, feedbackCursor: 0, receipts: [], ingestions: [], creditBlocked: false, model: { transitions: [] } },
    npc: { id: 'aster', elapsed: 0, nextDecisionAt: 0, active: null, lifecycle: 'AWAKE', rng: 1,
      inventory: { capacity: 2, items: [] }, physiology: { stomach: [], feedback: [], sleep: { state: 'awake' } }, discovery: {} },
    state: { environment: { ecology: { materials: [], rng: 1 }, rng: 1 }, elapsed: 0 },
    controller: { senseAt: -1 }, pending: null, frame: 0, steps: [], submissions: [], disposed: false, material: null,
    checkpointDriver() { return { senseAt: this.controller.senseAt, pending: clone(this.pending), epoch: 0 }; },
    checkpoint() { return JSON.stringify({ at: this.npc.elapsed, model: this.model, sensor: this.sensor, npc: this.npc, controller: this.controller, material: this.material, memory: this.memory }); },
    dispose() { this.disposed = true; },
    act() { throw new Error('Producer must never call act without an authoritative mask.'); },
    observe() { return this.candidateSnapshot().view; },
    candidateSnapshot() {
      const at = this.npc.elapsed, id = this.material?.id;
      const objects = [{ id: 'object:1', appearance, observedAt: this.sensor.observationAt, scene: 'valley', position: { x: 0, y: 0 }, count: 5 },
        ...(id ? [{ id, appearance, observedAt: this.sensor.observationAt, scene: 'valley', position: { x: 0, y: 0 }, count: 1 }] : [])];
      const actions = [{ type: 'pull', targetId: 'object:1' }, ...(id ? ['inspect_object', 'strike', 'release', 'grasp', 'sample'].map(type => ({ type, targetId: id })) : []), { type: 'wait', seconds: 5 }];
      const view = { at, objects, held: [...this.npc.inventory.items], body: { hunger: 'content', digestion: 'empty' }, capacity: 2, position: { x: 0, y: 0 }, scene: 'valley' };
      return { at, ready: true, ordinary: true, draws: [.5, .5, .5, .5], view,
        candidates: actions.filter(a => a.type !== masked).map((a, index) => ({ index, action: a, eligibility: true, bindingsValid: true,
          features: { operation: a.type, appearance, relation: 'held', workBand: '0', freeSlotBand: '1', countBand: '1' },
          exactSupport: { F: this.sensor.totals[0] > 0, W: false, H: false } })), exposures: [] };
    },
    submit(request) {
      this.submissions.push(clone(request)); const seq = this.memory.nextSeq++, at = this.npc.elapsed;
      if (seq > 1) { this.sensor.receipts.at(-1).interval = true; this.memory.model.transitions.push({ seq: seq - 1, nextSeq: seq, endAt: at }); }
      const receipt = { seq, at, request: clone(request), completedAt: null, outcome: null }; this.memory.receipts.push(receipt);
      this.sensor.receipts.push({ seq, completed: false, interval: false }); this.pending = { seq };
      this.npc.active = { request: clone(request), startedAt: at, seconds: request.type === 'wait' ? 5 : .05 };
      return true;
    },
    captureFeedback() {
      for (const event of this.npc.physiology.feedback) {
        const source = Number(event.id.slice(9)); if (source <= this.memory.feedbackCursor) continue;
        this.memory.feedbackCursor = source; const ing = this.memory.ingestions.find(i => i.id === event.ingestionId), exposure = this.sensor.exposures.find(e => e.id === ing.id);
        ing.channels |= 1; ing.channelProof[0] = { sourceSeq: source, at: event.at }; exposure.admitted |= 1; exposure.channelProof[0] = clone(ing.channelProof[0]);
        this.sensor.totals[0]++; this.sensor.events.push({ ingestionId: ing.id, objectId: ing.objectId, actionId: ing.actionId, sourceSeq: source, at: event.at, channels: 1 });
        options.sink({ type: 'feedback', at: event.at, event });
      }
    },
    step(dt) {
      assert.equal(dt, 1 / 60); this.steps.push(dt); this.frame++; this.npc.elapsed = this.frame / 60; this.state.elapsed = this.npc.elapsed; const at = this.npc.elapsed;
      const active = this.npc.active;
      if (active && !neverComplete && at + 1e-10 >= active.startedAt + active.seconds) {
        const receipt = this.memory.receipts.at(-1), request = active.request;
        receipt.completedAt = at; receipt.outcome = { actionId: receipt.seq, ok: !refuse, code: 'DONE' };
        if (request.type === 'pull') { this.material = { id: 'object:855', heldBy: 'aster', massGrams: initialMass, energyKcal: initialMass / 2, waterMl: initialMass * 2 / 3, materialType: 'apple', spoiled: false }; this.npc.inventory.items.push('object:855'); receipt.outcome.materialId = 'object:855'; }
        if (request.type === 'release') { this.npc.inventory.items = []; this.material.heldBy = null; }
        if (request.type === 'grasp') { this.npc.inventory.items = ['object:855']; this.material.heldBy = 'aster'; receipt.outcome.materialId = 'object:855'; }
        if (request.type === 'sample') {
          const grams = Math.min(30, this.material.massGrams);
          const id = `ingestion:${this.memory.ingestions.length + 1}`;
          const ing = { id, objectId: 'object:855', actionId: receipt.seq, seq: receipt.seq, at, creditBlocked: false, channelProof: {}, channels: 0 };
          this.memory.ingestions.push(ing); this.npc.physiology.stomach.push({ id, originalMassGrams: grams, originalKcal: grams / 2, originalWaterMl: grams * 2 / 3 });
          this.sensor.exposures.push({ ...clone(ing), admitted: 0, censored: 0, generation: 0, appearance, body: { digestion: 'empty' } });
          this.sensor.materials = [{ objectId: 'object:855', known: true, generation: 0, appearance }];
          this.material.massGrams -= grams; this.material.energyKcal -= grams / 2; this.material.waterMl -= grams * 2 / 3;
          if (this.material.massGrams === 0) { this.material = null; this.npc.inventory.items = []; }
          receipt.outcome.ingestionId = id; receipt.outcome.code = 'SWALLOWED';
        }
        this.sensor.receipts.at(-1).completed = true; this.npc.active = null; this.pending = null; this.npc.nextDecisionAt = at + .65;
        options.sink({ type: 'prediction-labels', at, labels: { receiptUpdates: [{ sequence: receipt.seq, at }], exposureUpdates: [], intervalUpdates: [] } });
      }
      const ing = this.memory.ingestions[0];
      if (ing && !this.npc.physiology.feedback.length && at >= ing.at + (earlyFood ? 1 : 20)) this.npc.physiology.feedback.push({ id: 'feedback:1', at, provenance: 'sampled', ingestionId: ing.id, objectId: ing.objectId, actionId: ing.actionId, effect: 'sustained' });
      this.captureFeedback();
      this.sensor.clockAt = at;
      if (!neverSense && this.frame % 60 === 0) { this.sensor.observationAt = at; this.controller.senseAt = at; }
    },
  };
  return f;
}
function harness(config = {}, overrides = {}) {
  let fixture, constructions = 0; const boundaries = [], sink = [];
  const runtime = { now: () => 0, checks: mockChecks, projection: {},
    createApple: options => { constructions++; fixture = fakeFixture(options, config); return fixture; },
    lookupMaterial: f => f.material,
    captureStock: (f, id) => ({ at: f.npc.elapsed, materialId: id, material: id && f.material ? clone(f.material) : null,
      held: [...f.npc.inventory.items], freeSlots: 2 - f.npc.inventory.items.length, body: clone(f.npc.physiology) }), ...overrides };
  const hooks = { boundary: e => { boundaries.push(e); }, sink: e => { sink.push(e); } };
  return { runtime, hooks, boundaries, sink, get fixture() { return fixture; }, get constructions() { return constructions; } };
}

function reopenFake(text, options, config = {}) {
  const f = fakeFixture({ ...options, sourceFingerprint: options.expectedSourceFingerprint }, config), saved = JSON.parse(text);
  Object.assign(f, { model: saved.model, sensor: saved.sensor, npc: saved.npc, controller: saved.controller, material: saved.material, memory: saved.memory });
  f.frame = Math.round(saved.at * 60); f.state.elapsed = saved.at; return f;
}
function fakeForecast(_model, query) {
  const value = { known: true, mean: 0, support: [], range: [0, 1] };
  return { physical: { features: clone(query.features), effects: Object.fromEntries(['held', 'released', 'output', 'exposure', 'route'].map(k => [k, clone(value)])),
    completion: Object.fromEntries(['success', 'failure', 'refused', 'interrupted'].map(k => [k, clone(value)])), T: value, E: value },
    D: { F: 0, W: 0, H: 0 }, usedD: { F: 0, W: 0, H: 0 }, durationSeconds: .05, exactSupport: query.exactSupport };
}
async function preparedApple() {
  const h = harness(), result = await runValidationCase({ runId: 'T0-common-apple', sourceFingerprint: SOURCE, ...h });
  assert.equal(result.status, 'passed', result.reason);
  const artifacts = clone(result.artifacts);
  artifacts.predecessors = { [result.runId]: { status: result.status, evidence: result.evidence } };
  artifacts.retainedBindings = { complete: true, scope: 'all-retained-physical-and-evidence-bindings', objectIds: [], sourceHashes: ['a'.repeat(64), 'b'.repeat(64)] };
  return { artifacts, result };
}
function mergeMockArtifacts(target, delta) {
  for (const [k, v] of Object.entries(delta)) {
    if (['checkpoints', 'models', 'schedules', 'controls', 'blobs'].includes(k)) Object.assign(target[k] ||= {}, clone(v));
    else target[k] = clone(v);
  }
}
async function preparedFresh() {
  const { artifacts } = await preparedApple();
  const result = await runValidationCase({ runId: 'P1-fresh-prefix', sourceFingerprint: SOURCE, artifacts, runtime: p1Runtime(), hooks: { boundary() {} } });
  assert.equal(result.status, 'passed', result.reason); mergeMockArtifacts(artifacts, result.artifacts);
  artifacts.predecessors[result.runId] = { status: result.status, evidence: result.evidence }; return { artifacts, result };
}
function p1Runtime(overrides = {}) {
  return { ...harness().runtime, reopen: reopenFake, forecastCandidate: fakeForecast,
    projection: { captureValidationProjectionInput: () => ({}), evaluateValidationProjectionBatch: () => ({ assessment: passed() }) }, ...overrides };
}

test('frozen finite census is exactly 16 ordered cases and 50 submitted actions', () => {
  assert.equal(VALIDATION_PRODUCER.cases.length, 16);
  assert.equal(VALIDATION_PRODUCER.cases.reduce((n, c) => n + c.operations.length, 0), 50);
  assert.deepEqual(VALIDATION_PRODUCER.cases[0].operations, ['pull', 'inspect_object', 'strike', 'release', 'grasp', 'wait', 'sample', 'wait', 'wait']);
  assert.deepEqual(VALIDATION_PRODUCER.cases.slice(2, 10).map(c => [c.operations[0], c.triggerAgeSeconds]),
    [['inspect_object', 20], ['wait', 20], ['strike', 20], ['release', 20], ['release', 35], ['strike', 35], ['wait', 35], ['inspect_object', 35]]);
  assert.equal(VALIDATION_PRODUCER.physicalAvailability, 'untested');
  assert.ok(Object.isFrozen(VALIDATION_PRODUCER.cases[0].operations));
  assert.deepEqual(assertValidationDispatch(), { runs: 16, submissions: 50, matched: true });
  const changed = clone(VALIDATION_CENSUS); changed[2].actions[0].operation = 'sample';
  assert.throws(() => assertValidationDispatch(changed), /differs/);
  assert.throws(() => assertValidationDispatch([...VALIDATION_CENSUS].reverse()), /differs/);
});

test('immutable blobs deduplicate exact bytes and verify all references', () => {
  const s = createValidationBlobStore(), model = { rows: [{ id: 'real-id' }] }, a = s.put('model', model), b = s.put('model', model);
  assert.deepEqual(a, b); assert.equal(Object.keys(s.export()).length, 1); model.rows[0].id = 'changed';
  assert.equal(s.get(a).rows[0].id, 'real-id'); assert.ok(Object.isFrozen(s.get(a)));
  const checkpoint = '{ "exact": true }', ref = s.put('checkpoint', checkpoint, 'utf8'); assert.equal(s.get(ref), checkpoint);
  assert.throws(() => createValidationBlobStore({ [a.sha256]: '{}' }).get(a), /hash/);
  assert.throws(() => s.get({ ...a, bytes: 0 }), /hash/);
});

test('failed predecessor blocks before fixture construction or any physical step', async () => {
  const h = harness(); const r = await runValidationCase({ runId: 'P1-fresh-prefix', sourceFingerprint: SOURCE, ...h });
  assert.equal(r.status, 'blocked'); assert.equal(h.constructions, 0); assert.equal(r.evidence.stop.neverStarted, true);
});

test('synthetic common case executes exact masked recipe and captures Apre/MF/A0/MA', async () => {
  const h = harness(); const r = await runValidationCase({ runId: 'T0-common-apple', sourceFingerprint: SOURCE, ...h });
  assert.equal(r.status, 'passed', r.reason); assert.equal(h.constructions, 1);
  assert.deepEqual(h.fixture.submissions.map(a => a.type), VALIDATION_PRODUCER.cases[0].operations);
  assert.equal(h.fixture.disposed, false, 'outer owner retains the live stop fixture');
  for (const name of ['Apre', 'A0']) { const cp = r.artifacts.checkpoints[name]; assert.equal(digest(cp.text), cp.sha256); assert.equal(cp.lineage.runId, r.runId); }
  for (const name of ['MF', 'MA']) assert.equal(digest(r.artifacts.models[name].value), r.artifacts.models[name].sha256);
  assert.equal(r.artifacts.materialId, 'object:855'); assert.equal(r.artifacts.firstIngestion.id, 'ingestion:1');
  assert.ok(r.evidence.freeze.at < r.evidence.controls.firstF.at);
  assert.ok(h.boundaries.some(e => e.kind === 'freeze')); assert.ok(h.boundaries.some(e => e.kind === 'frame-before'));
  assert.ok(Object.isFrozen(r.evidence.actions));
  assert.equal(r.continuingAllowed, false); assert.equal(r.terminal, false); assert.equal(r.originalResourceAdmissionPassed, false);
  for (let i = 1; i < r.evidence.actions.length; i++) assert.ok(r.evidence.actions[i].submittedAt - r.evidence.actions[i - 1].completedAt >= .65);
});

test('missing native mask preserves prefix and never tries another action or opportunity', async () => {
  const h = harness({ masked: 'strike' }); const r = await runValidationCase({ runId: 'T0-common-apple', sourceFingerprint: SOURCE, ...h });
  assert.equal(r.status, 'unavailable'); assert.deepEqual(h.fixture.submissions.map(a => a.type), ['pull', 'inspect_object']);
  assert.match(r.reason, /masks strike/); assert.ok(r.evidence.stop.checkpointRef); assert.equal(h.constructions, 1);
});

test('no scheduled observation stops at fixed two-second watchdog without a request', async () => {
  const h = harness({ neverSense: true }); const r = await runValidationCase({ runId: 'T0-common-apple', sourceFingerprint: SOURCE, ...h });
  assert.equal(r.status, 'unavailable'); assert.equal(h.fixture.submissions.length, 0); assert.ok(h.fixture.npc.elapsed <= 2 + 1e-9);
});

test('native short-action watchdog retains unresolved current prefix', async () => {
  const h = harness({ neverComplete: true }); const r = await runValidationCase({ runId: 'T0-common-apple', sourceFingerprint: SOURCE, ...h });
  assert.equal(r.status, 'unavailable'); assert.equal(h.fixture.submissions.length, 1); assert.ok(h.fixture.pending);
  assert.match(r.reason, /native-duration watchdog/); assert.equal(r.evidence.actions[0].completedAt, null);
});

test('genuine refused outcome is retained and never retried', async () => {
  const h = harness({ refuse: true }); const r = await runValidationCase({ runId: 'T0-common-apple', sourceFingerprint: SOURCE, ...h });
  assert.equal(r.status, 'unavailable'); assert.equal(h.fixture.submissions.length, 1); assert.ok(r.evidence.actions[0].receiptRef);
});

test('early F stops before freeze with no repaired training', async () => {
  const h = harness({ earlyFood: true }); const r = await runValidationCase({ runId: 'T0-common-apple', sourceFingerprint: SOURCE, ...h });
  assert.equal(r.status, 'unavailable'); assert.match(r.reason, /before the common all-head freeze/);
  assert.equal(r.artifacts.models.MF, undefined); assert.ok(h.fixture.submissions.length < 9);
});

test('pure native-root mutation is caught before physical submission', async () => {
  const h = harness({}, { createApple: options => { const f = fakeFixture(options); const original = f.candidateSnapshot; f.candidateSnapshot = function () { this.npc.rng++; return original.call(this); }; return f; } });
  const r = await runValidationCase({ runId: 'T0-common-apple', sourceFingerprint: SOURCE, ...h });
  assert.equal(r.status, 'failed'); assert.equal(r.code, 'VALIDATION_QUERY_MUTATION'); assert.equal(r.evidence.actions.length, 0);
});

test('asynchronous owner callback is rejected; no continuation is scheduled', async () => {
  const h = harness(); const r = await runValidationCase({ runId: 'T0-common-apple', sourceFingerprint: SOURCE, runtime: h.runtime, hooks: { boundary: () => Promise.resolve() } });
  assert.equal(r.status, 'failed'); assert.equal(r.code, 'VALIDATION_ASYNC_HOOK'); assert.equal(h.constructions, 0);
});

test('owner stop preserves first fixture without successor creation', async () => {
  const h = harness(); const r = await runValidationCase({ runId: 'T0-common-apple', sourceFingerprint: SOURCE, runtime: h.runtime,
    hooks: { boundary: e => e.kind === 'setup-after' ? { stop: true, reason: 'Synthetic stop' } : undefined } });
  assert.equal(r.status, 'unavailable'); assert.equal(h.constructions, 1); assert.equal(h.fixture.submissions.length, 0);
});

test('real native emit/step preserve an unavailable old-meal mismatch and its current prefix', async () => {
  const { artifacts } = await preparedFresh();
  artifacts.predecessors['C1-early-inspect'] = { status: 'passed', evidence: {} };
  artifacts.schedules = { 'C1-early-inspect': { events: [], throughAt: artifacts.t1 + 90, complete: true } };
  let f, ticks = 0;
  const runtime = p1Runtime({ reopen: (text, options) => {
    f = reopenFake(text, options); f.sink = options.sink; f.diagnosticError = null;
    // Execute the actual inherited emit and step. Only the tiny clock/event
    // source is synthetic; there is no PopulationRuntime or physical world.
    f.emit = ReusablePredictionFixture.prototype.emit;
    f.step = ReusablePredictionFixture.prototype.step;
    f.runtime = { tick(dt) {
      ticks++; f.npc.elapsed += dt; f.sensor.clockAt = f.npc.elapsed;
      const ing = artifacts.freshIngestion;
      f.emit({ type: 'feedback', at: f.npc.elapsed, event: { id: 'feedback:2', at: f.npc.elapsed,
        provenance: 'sampled', ingestionId: ing.id, objectId: ing.objectId, actionId: ing.actionId, effect: 'sustained' } });
    } };
    return f;
  } });
  const r = await runValidationCase({ runId: 'C2-early-wait', sourceFingerprint: SOURCE, artifacts, runtime, hooks: { boundary() {} } });
  assert.equal(r.status, 'unavailable', r.reason); assert.equal(r.code, 'VALIDATION_UNAVAILABLE');
  assert.equal(r.reason, 'Old-meal schedule has an immediate known event mismatch.');
  assert.equal(f.diagnosticError, r.reason, 'real emit swallowed the original exception into text');
  assert.equal(f.sink, null); assert.equal(ticks, 1); assert.deepEqual(f.submissions, []);
  assert.equal(r.evidence.events.filter(e => e.type === 'feedback').length, 1);
  assert.equal(r.evidence.callbacks.length, 1); assert.ok(r.evidence.stop.checkpointRef);
  assert.equal(r.evidence.stop.at, artifacts.t1 + 1 / 60);
});

for (const nativeBoundary of ['step', 'submit']) test(`real native emit preserves a typed resource stop after ${nativeBoundary}`, async () => {
  let f, nativeReturned = false, ticks = 0;
  const ownerError = Object.assign(new Error('Synthetic durable sink resource ceiling'), { code: 'VALIDATION_RESOURCE_CEILING' });
  const runtime = { ...harness().runtime, createApple: options => {
    f = fakeFixture(options); f.sink = options.sink; f.diagnosticError = null;
    f.emit = ReusablePredictionFixture.prototype.emit;
    if (nativeBoundary === 'step') {
      f.step = ReusablePredictionFixture.prototype.step;
      f.runtime = { tick(dt) { ticks++; f.npc.elapsed += dt; f.emit({ type: 'synthetic-native-event', at: f.npc.elapsed }); nativeReturned = true; } };
    } else {
      f.sensor.observationAt = 0; f.controller.senseAt = 0;
      const submit = f.submit;
      f.submit = function (request) { const accepted = submit.call(this, request); this.emit({ type: 'synthetic-native-event', at: this.npc.elapsed }); nativeReturned = true; return accepted; };
    }
    return f;
  } };
  const r = await runValidationCase({ runId: 'T0-common-apple', sourceFingerprint: SOURCE, runtime,
    hooks: { boundary() {}, sink: row => { if (row.type === 'synthetic-native-event') throw ownerError; } } });
  assert.equal(nativeReturned, true, 'real emit catches the owner exception');
  assert.equal(r.status, 'censored', r.reason); assert.equal(r.code, ownerError.code); assert.equal(r.reason, ownerError.message);
  assert.equal(f.diagnosticError, ownerError.message); assert.equal(f.sink, null); assert.ok(r.evidence.stop.checkpointRef);
  assert.equal(f.submissions.length, nativeBoundary === 'submit' ? 1 : 0);
  assert.equal(ticks, nativeBoundary === 'step' ? 1 : 0); assert.equal(f.steps.length, 0);
  assert.ok(f.pending || nativeBoundary === 'step', 'failed submission retains its pending native request without another step');
});

test('world setup is wall-only; a 1200ms setup is not a returned native-work failure', async () => {
  let time = 0; const h = harness({}, { now: () => time, createApple: options => { time += 1200; return fakeFixture(options); } });
  const r = await runValidationCase({ runId: 'T0-common-apple', sourceFingerprint: SOURCE, ...h });
  assert.equal(r.status, 'passed', r.reason); assert.equal(r.evidence.resource.setupWorkMs, 1200);
  assert.equal(r.evidence.resource.maximumReturnedWorkMs, 0);
});

test('synthetic P1 forecasts before its sole submission and saves exact swallow A1', async () => {
  const { artifacts } = await preparedApple(); let f;
  const r = await runValidationCase({ runId: 'P1-fresh-prefix', sourceFingerprint: SOURCE, artifacts,
    hooks: { boundary: (_e, fixture) => { if (fixture) f = fixture; } }, runtime: p1Runtime() });
  assert.equal(r.status, 'passed', r.reason); assert.deepEqual(f.submissions, [{ type: 'sample', targetId: 'object:855' }]);
  assert.equal(r.artifacts.freshIngestion.id, 'ingestion:2'); assert.equal(r.artifacts.prospective.ingestionId, 'ingestion:2');
  assert.ok(r.artifacts.prospective.issuedAt < r.artifacts.t1); assert.equal(r.artifacts.checkpoints.A1.lineage.at, r.artifacts.t1);
  assert.equal(r.artifacts.prospective.query.horizonSeconds, 600); assert.deepEqual(r.artifacts.prospective.query.reported, { F: false, W: false, H: false });
  assert.equal(f.npc.physiology.stomach.length, 2); assert.equal(f.submissions.length, 1);
});

test('unknown mandatory paired forecast stops P1 before spending any action', async () => {
  const { artifacts } = await preparedApple(); let f;
  const r = await runValidationCase({ runId: 'P1-fresh-prefix', sourceFingerprint: SOURCE, artifacts,
    hooks: { boundary: (_e, fixture) => { if (fixture) f = fixture; } },
    runtime: p1Runtime({ forecastCandidate: undefined, checks: { ...mockChecks, assessPairedPhysicalForecast } }) });
  assert.equal(r.status, 'unavailable', r.reason); assert.equal(f.submissions.length, 0);
  assert.ok(r.evidence.controls.forecastCoverage.length); assert.match(r.reason, /Missing paired/);
});

test('paired forecast duration is combined with root construction across boundaries', async () => {
  const { artifacts } = await preparedApple(); let time = 0, f;
  const runtime = p1Runtime({ now: () => time, reopen: (text, options) => {
    const fixture = reopenFake(text, options), original = fixture.candidateSnapshot;
    fixture.candidateSnapshot = function () { time += 600; return original.call(this); }; return fixture;
  }, forecastCandidate: (model, query) => { time += 300; return fakeForecast(model, query); } });
  const r = await runValidationCase({ runId: 'P1-fresh-prefix', sourceFingerprint: SOURCE, artifacts, runtime,
    hooks: { boundary: (_e, fixture) => { if (fixture) f = fixture; } } });
  assert.equal(r.status, 'censored'); assert.equal(r.code, 'VALIDATION_RESOURCE_LIMIT'); assert.equal(f.submissions.length, 0);
  assert.ok(r.evidence.resource.maximumDecisionMs >= 1200);
});

test('P1 combined timing includes its six biological forecasts before command', async () => {
  const { artifacts } = await preparedApple(); let time = 0, f;
  const runtime = p1Runtime({ now: () => time, reopen: (text, options) => {
    const fixture = reopenFake(text, options), original = fixture.candidateSnapshot;
    fixture.candidateSnapshot = function () { time += 300; return original.call(this); }; return fixture;
  }, forecastCandidate: (model, query) => { time += 100; return fakeForecast(model, query); },
  forecastExposure: () => { time += 300; return { channels: { F: { probability: 0 }, W: { probability: 0 }, H: { probability: 0 } } }; } });
  const r = await runValidationCase({ runId: 'P1-fresh-prefix', sourceFingerprint: SOURCE, artifacts, runtime,
    hooks: { boundary: (_e, fixture) => { if (fixture) f = fixture; } } });
  assert.equal(r.status, 'censored'); assert.equal(r.code, 'VALIDATION_RESOURCE_LIMIT'); assert.equal(f.submissions.length, 0);
  assert.ok(r.evidence.resource.maximumDecisionMs >= 1100);
});

test('blob hook receives verified bytes before referencing evidence is emitted', async () => {
  const h = harness(), saved = new Set();
  const visit = value => { if (value && typeof value === 'object') { if (value.sha256 && value.kind) assert.ok(saved.has(value.sha256)); for (const child of Object.values(value)) visit(child); } };
  const r = await runValidationCase({ runId: 'T0-common-apple', sourceFingerprint: SOURCE, runtime: h.runtime,
    hooks: { boundary() {}, blob(info) { assert.equal(digest(info.text), info.sha256); saved.add(info.sha256); }, sink: visit } });
  assert.equal(r.status, 'passed', r.reason); assert.ok(saved.size > 0);
  assert.equal(r.evidence.resource.ownerRetention.uniqueBlobCount, saved.size);
});

test('owner resource/unavailability error statuses survive the dispatcher', async () => {
  for (const [code, status] of [['VALIDATION_UNAVAILABLE', 'unavailable'], ['VALIDATION_RESOURCE_CEILING', 'censored']]) {
    const h = harness(); const r = await runValidationCase({ runId: 'T0-common-apple', sourceFingerprint: SOURCE, runtime: h.runtime,
      hooks: { boundary() { const error = new Error('Synthetic owner guard'); error.code = code; throw error; } } });
    assert.equal(r.status, status); assert.equal(h.constructions, 0);
  }
});

test('synthetic C1/C5 dispatch uses A1, exact early/late trigger and one closure wait', async () => {
  for (const [runId, trigger, operation] of [['C1-early-inspect', 20, 'inspect_object'], ['C5-late-release', 35, 'release']]) {
    const { artifacts } = await preparedFresh();
    for (const p of VALIDATION_PRODUCER.cases.slice(0, VALIDATION_PRODUCER.cases.findIndex(p => p.runId === runId))) artifacts.predecessors[p.runId] ||= { status: 'passed', evidence: {} };
    let f; const r = await runValidationCase({ runId, sourceFingerprint: SOURCE, artifacts, runtime: p1Runtime(), hooks: { boundary: (_e, fixture) => { if (fixture) f = fixture; } } });
    assert.equal(r.status, 'passed', r.reason); assert.deepEqual(f.submissions.map(a => a.type), [operation, 'wait']);
    assert.ok(r.evidence.actions[0].submittedAt >= artifacts.t1 + trigger);
    assert.ok(r.evidence.actions[0].submittedAt < artifacts.t1 + trigger + 2);
    assert.ok(r.evidence.actions[1].submittedAt >= artifacts.t1 + 90);
    assert.equal(f.npc.physiology.stomach.length, 2); assert.equal(f.memory.ingestions.length, 2);
  }
});

test('synthetic H1 does exactly one aged swallow/support recipe then stops on missing H', async () => {
  const { artifacts } = await preparedFresh();
  for (const p of VALIDATION_PRODUCER.cases.slice(0, 10)) artifacts.predecessors[p.runId] ||= { status: 'passed', evidence: {} };
  let f, interventions = 0; const runtime = p1Runtime({ ageMaterial: fixture => {
    interventions++; fixture.material.spoiled = true; fixture.material.ageHours = 288; return { intervention: 'synthetic-age-record', at: fixture.npc.elapsed };
  }, materialSupport: () => ({ F: false, W: false, H: false }) });
  const r = await runValidationCase({ runId: 'H1-chronological', sourceFingerprint: SOURCE, artifacts, runtime,
    hooks: { boundary: (_e, fixture) => { if (fixture) f = fixture; } } });
  assert.equal(r.status, 'unavailable', r.reason); assert.match(r.reason, /no genuine H/); assert.equal(interventions, 1);
  assert.deepEqual(f.submissions.map(a => a.type), ['sample', 'release', 'grasp', 'inspect_object', 'wait']);
  const second = r.evidence.controls.transfers[0].ingestion;
  assert.ok(f.npc.elapsed <= second.at + 600 + 1e-9); assert.equal(f.memory.ingestions.length, 2);
});

test('synthetic H2 reopens once at the fixed age; H3 submits only the one five-second handling wait', async () => {
  for (const runId of ['H2-reopen', 'H3-operation-at-H']) {
    const { artifacts } = await preparedFresh();
    for (const p of VALIDATION_PRODUCER.cases.slice(0, VALIDATION_PRODUCER.cases.findIndex(p => p.runId === runId))) artifacts.predecessors[p.runId] ||= { status: 'passed', evidence: {} };
    let f; const reopened = [], submitted = [];
    const runtime = p1Runtime({ reopen: (text, options) => { const fixture = reopenFake(text, options); reopened.push(fixture.npc.elapsed); const native = fixture.submit;
      fixture.submit = function (a) { submitted.push({ at: this.npc.elapsed, action: clone(a) }); return native.call(this, a); }; return fixture; },
    ageMaterial: fixture => { fixture.material.spoiled = true; fixture.material.ageHours = 288; return { at: fixture.npc.elapsed }; },
    materialSupport: () => ({ F: false, W: false, H: false }) });
    const r = await runValidationCase({ runId, sourceFingerprint: SOURCE, artifacts, runtime,
      hooks: { boundary: (_e, fixture) => { if (fixture) f = fixture; } } });
    assert.equal(r.status, 'unavailable', r.reason);
    const th = r.evidence.controls.transfers[0].ingestion.at;
    if (runId === 'H2-reopen') { assert.equal(reopened.length, 2); assert.ok(reopened[1] >= th + 50 && reopened[1] < th + 50 + 1 / 60 + 1e-9); assert.equal(submitted.length, 5); }
    else { assert.equal(reopened.length, 1); assert.equal(submitted.length, 6); assert.deepEqual(submitted.at(-1).action, { type: 'wait', seconds: 5 }); assert.ok(submitted.at(-1).at >= th + 56); assert.ok(f.npc.elapsed < th + 64); }
  }
});

test('synthetic B1 consumes natural 30g and final 5g with no third sample and full follow-up', async () => {
  const artifacts = { predecessors: Object.fromEntries(VALIDATION_PRODUCER.cases.slice(0, 14).map(p => [p.runId, { status: 'passed', evidence: {} }])) };
  let f; const h = harness({}, { createBramble: options => fakeFixture(options, { initialMass: 35 }) });
  const r = await runValidationCase({ runId: 'B1-small-exhausted', sourceFingerprint: SOURCE, artifacts, runtime: h.runtime,
    hooks: { boundary: (_e, fixture) => { if (fixture) f = fixture; } } });
  assert.equal(r.status, 'passed', r.reason); assert.deepEqual(f.submissions.map(a => a.type), ['pull', 'sample', 'sample']);
  assert.deepEqual(r.evidence.controls.smallPortion.portions.map(p => p.transferredGrams), [30, 5]);
  assert.equal(f.material, null); assert.deepEqual(f.npc.inventory.items, []);
  const last = r.evidence.controls.smallPortion.portions[1]; assert.ok(f.npc.elapsed >= last.swallowedAt + 600);
  assert.equal(r.evidence.controls.smallPortion.channels.F, null); assert.equal(r.artifacts.models.MF, undefined);
});

test('synthetic Q1 advances only exact A1 follow-up and stops if quality is inconclusive', async () => {
  const { artifacts } = await preparedFresh();
  for (const p of VALIDATION_PRODUCER.cases.slice(0, 15)) artifacts.predecessors[p.runId] ||= { status: 'passed', evidence: { actions: [] } };
  let f, assessed;
  const runtime = p1Runtime({ checks: { ...mockChecks, aggregateValidationQuality: input => { assessed = input; return { status: 'unavailable', unavailable: ['Synthetic frozen zero denominator'] }; } } });
  const r = await runValidationCase({ runId: 'Q1-fresh-followup', sourceFingerprint: SOURCE, artifacts, runtime,
    hooks: { boundary: (_e, fixture) => { if (fixture) f = fixture; } } });
  assert.equal(r.status, 'unavailable', r.reason); assert.deepEqual(f.submissions, []);
  assert.ok(f.npc.elapsed >= artifacts.t1 + 600 && f.npc.elapsed < artifacts.t1 + 600 + 1 / 60 + 1e-9);
  assert.equal(assessed.biological.length, 1); assert.equal(assessed.biological[0].ingestionId, artifacts.freshIngestion.id);
  assert.equal(assessed.biological[0].sourceRunId, 'P1-fresh-prefix'); assert.equal(assessed.biological[0].channels.H.eventAt, null);
  assert.deepEqual(assessed.biological[0].forecasts.online, artifacts.prospective.online);
});

test('owner-only identity census includes current hidden bindings without changing them', () => {
  const f = fakeFixture({ sourceFingerprint: SOURCE, sink() {} }); f.state.hiddenRetained = { id: 'object:99000001' }; const before = JSON.stringify(f.state);
  const c = completeRetainedBindings({ complete: true, scope: 'all-retained-physical-and-evidence-bindings', objectIds: ['object:8'], sourceHashes: ['a'.repeat(64), 'b'.repeat(64)] }, f);
  assert.ok(c.objectIds.includes('object:99000001')); assert.ok(c.objectIds.includes('object:8')); assert.equal(JSON.stringify(f.state), before);
  assert.throws(() => completeRetainedBindings({ complete: false }, f), /complete pinned-original/);
});

function syntheticCallback() {
  const memory = createTemporalLedger({ capacityProfile: 'finite-temporal-v1' }), sensor = createReusableOutcomeSensor();
  const c = Object.create(ReusablePredictionFixture.prototype);
  c.npc = { elapsed: 0, discovery: { temporal: memory } }; c.sensor = sensor; c.model = createReusableOutcomeModel();
  c.modelSession = createReusableModelSession(c.model, 0); c.model = c.modelSession.snapshot();
  c.admission = { deniedSubmissions: 0, deniedBatches: 0, lastDenial: null, exposures: [] };
  c.predictionArm = 'online'; c.sensorEnabled = true; c.reservedContextKey = null; c.now = () => 0; c.emit = () => {};
  c.predictionTimings = { native: [], bookkeeping: [], batches: [], decisions: [] };
  const view = { at: 0, held: ['object:1'], capacity: 2, body: { digestion: 'empty' }, objects: [{ id: 'object:1', appearance, observedAt: 0, count: 1 }] };
  observeReusableMaterials(sensor, { view, observationAt: 0, observedIds: ['object:1'] });
  const seq = beginTemporalDecision(memory, { at: 0, action: { type: 'sample', targetId: 'object:1' }, context: temporalContext({ appearance, body: view.body }) });
  c.applyLabels(observeReusableSubmission(sensor, { memory, seq, view }));
  advanceTemporalClock(memory, 1); view.at = 1; c.npc.elapsed = 1;
  completeTemporalDecision(memory, { seq, at: 1, actionId: 1, result: { ok: true, code: 'SWALLOWED', ingestionId: 'ingestion:1', durationSeconds: 1 } });
  c.applyLabels(observeReusableCompletion(sensor, { memory, seq, view }));
  advanceTemporalClock(memory, 31); c.npc.elapsed = 31;
  const before = clone({ memory, sensor, model: c.model, admission: c.admission });
  const event = { id: 'feedback:1', at: 31, provenance: 'sampled', ingestionId: 'ingestion:1', objectId: 'object:1', actionId: 1, effect: 'sustained', thirst: 'easing' };
  const feedbackBefore = snapshotReusableFeedback(memory, event); recordTemporalFeedback(memory, event, { now: 31 });
  c.applyLabels(recordReusableFeedback(sensor, { before: feedbackBefore, memory, event, now: 31 }));
  return { event, at: 31, before, after: clone({ memory, sensor, model: c.model, admission: c.admission }) };
}

test('synthetic exact callback replay and duplication equal genuine canonical post-state', () => {
  const callback = syntheticCallback(), saved = clone(callback), result = replayValidationCallbackWindows([callback]);
  assert.deepEqual(result.chronological.finalState, result.referenceState);
  assert.deepEqual(result.duplicated.finalState, result.referenceState);
  assert.deepEqual(result.reordered.finalState, result.referenceState);
  assert.deepEqual(result.duplicated.dispatchOrder, [[31, 1], [31, 1]]);
  assert.deepEqual(callback, saved); assert.equal(result.independentExamples, 0);
  const bad = clone(callback); bad.after.sensor.totals[0]++;
  assert.throws(() => replayValidationCallbackWindows([bad]), /canonical post-state/);
});

test('installed producer wrapper retains copied native-label identity for two same-appearance ingestions', async () => {
  // Genuine public-ledger/sensor consumers over explicitly synthetic rows. The
  // only fake native step advances this small ledger clock; no world is created.
  const memory = createTemporalLedger({ capacityProfile: 'finite-temporal-v1' }), sensor = createReusableOutcomeSensor();
  const f = Object.create(ReusablePredictionFixture.prototype);
  Object.assign(f, { npc: { id: 'aster', elapsed: 0, lifecycle: 'AWAKE', nextDecisionAt: 0, active: null, rng: 1,
    discovery: { temporal: memory }, inventory: { items: ['object:1'], capacity: 2 }, physiology: { sleep: { state: 'awake' }, feedback: [], stomach: [] } },
  sensor, model: createReusableOutcomeModel(), predictionArm: 'online', sensorEnabled: true, automatic: false,
  sourceFingerprint: SOURCE, selector: { rng: 1 }, controller: { senseAt: 0 }, pending: null,
  admission: { deniedSubmissions: 0, deniedBatches: 0, lastDenial: null, exposures: [] }, reservedContextKey: null,
  now: () => 0, predictionTimings: { native: [], bookkeeping: [], batches: [], decisions: [] },
  state: { elapsed: 0, environment: { ecology: {}, rng: 1 } }, diagnosticError: null, sink: null });
  f.modelSession = createReusableModelSession(f.model, 0); f.model = f.modelSession.snapshot();
  const view = { at: 0, held: ['object:1'], capacity: 2, body: { digestion: 'empty' }, objects: [{ id: 'object:1', appearance, observedAt: 0, count: 1 }] };
  observeReusableMaterials(sensor, { view, observationAt: 0, observedIds: ['object:1'] });
  for (let i = 1; i <= 2; i++) {
    const seq = beginTemporalDecision(memory, { at: view.at, action: { type: 'sample', targetId: 'object:1' }, context: temporalContext({ appearance, body: view.body }) });
    f.applyLabels(observeReusableSubmission(sensor, { memory, seq, view }));
    advanceTemporalClock(memory, i); view.at = i; f.npc.elapsed = i;
    completeTemporalDecision(memory, { seq, at: i, actionId: i, result: { ok: true, code: 'SWALLOWED', ingestionId: `ingestion:${i}`, durationSeconds: 1 } });
    f.applyLabels(observeReusableCompletion(sensor, { memory, seq, view }));
  }
  assert.deepEqual(sensor.exposures[0].appearance, sensor.exposures[1].appearance);
  const at = 31; f.npc.elapsed = at - 1 / 60; advanceTemporalClock(memory, f.npc.elapsed); sensor.clockAt = f.npc.elapsed;
  f.checkpointDriver = () => ({ pending: null, senseAt: f.controller.senseAt, epoch: 0 });
  f.checkpoint = () => JSON.stringify({ at: f.npc.elapsed, model: f.model, memory, sensor });
  f.step = dt => {
    f.npc.elapsed += dt; advanceTemporalClock(memory, f.npc.elapsed);
    f.npc.physiology.feedback = memory.ingestions.map((ingestion, index) => ({ id: `feedback:${index + 1}`, at: f.npc.elapsed,
      provenance: 'sampled', ingestionId: ingestion.id, objectId: ingestion.objectId, actionId: ingestion.actionId,
      effect: index === 0 ? 'sustained' : 'no noticeable change', thirst: index === 1 ? 'easing' : 'unchanged' }));
    f.captureFeedback(); sensor.clockAt = f.npc.elapsed;
  };
  const text = f.checkpoint(), frozen = clone(f.model), artifacts = {
    checkpoints: { A1: { text, sha256: digest(text), lineage: { runId: 'P1-fresh-prefix' } } },
    models: { MF: { value: frozen, sha256: digest(frozen) } }, materialId: 'object:1',
    firstIngestion: clone(memory.ingestions[0]), freshIngestion: clone(memory.ingestions[1]), t1: 2,
    prospective: { ingestionId: 'ingestion:2', swallowedAt: 2 },
    predecessors: Object.fromEntries(VALIDATION_PRODUCER.cases.slice(0, 15).map(p => [p.runId, { status: 'passed', evidence: {} }])) };
  const r = await runValidationCase({ runId: 'Q1-fresh-followup', sourceFingerprint: SOURCE, artifacts,
    runtime: { now: () => 0, checks: { ...mockChecks, assessChannelAdmission }, projection: {},
      reopen: (_text, options) => { f.sink = options.sink; return f; }, captureStock: () => ({ at: f.npc.elapsed }) },
    hooks: { boundary: e => e.kind === 'frame-after' ? { stop: true, reason: 'Synthetic callback boundary reached' } : undefined } });
  assert.equal(r.status, 'unavailable', r.reason); assert.match(r.reason, /Synthetic callback boundary reached/);
  assert.equal(r.evidence.callbacks.length, 2);
  for (const callback of r.evidence.callbacks) assert.equal(callback.admission.status, 'passed', JSON.stringify(callback.admission));
  assert.ok(r.evidence.numericalUpdates.every(u => ['ingestion:1', 'ingestion:2'].includes(u.ingestionId)));
  const positive = r.evidence.numericalUpdates.filter(u => u.label.increments.some(i => i.events > 0));
  assert.deepEqual(positive.map(u => u.ingestionId), ['ingestion:1', 'ingestion:2']);
  assert.equal(sensor.exposures[0].admitted, 1); assert.equal(sensor.exposures[1].admitted, 2);
  assert.equal(sensor.events.length, 2);
  const unchanged = JSON.stringify({ model: f.model, sensor, memory });
  assert.throws(() => f.applyLabels({ receiptUpdates: [], intervalUpdates: [], exposureUpdates: [clone(positive[0].label)] }), /unambiguous original sensor binding/);
  assert.equal(JSON.stringify({ model: f.model, sensor, memory }), unchanged, 'missing original provenance fails before state changes');
});
