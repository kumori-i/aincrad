import test from 'node:test';
import assert from 'node:assert/strict';
import { SAME_MATERIAL_ASSAY, sameMaterialHash, sameMaterialNuisanceQueries,
  runSameMaterialAssay } from '../scripts/lib/reusable-same-material-assay.mjs';

// Data-only producer contract mocks. No world creation, physical engine tick,
// actual ingestion, outcome assay, parameter fitting, or hidden biology occurs.
const SOURCE = 'a'.repeat(64), MATERIAL = 'object:2', copy = x => structuredClone(x);
const appearance = { shape: 'round', color: 'red', texture: 'smooth', motion: 'still', size: 'small', smell: 'faint' };
const support = { F: true, W: false, H: false };
function root(at = 20) {
  const view = { at, body: { hunger: 'content', thirst: 'quenched', digestion: 'settled' }, held: [MATERIAL],
    capacity: 4, objects: [{ id: MATERIAL, observedAt: at, appearance }], senses: { warmth: 'comfortable', shelter: 'open air' } };
  return { at, view, ready: true, ordinary: true, need: 'understanding', exposures: [], selector: { rng: 1 },
    candidates: [{ type: 'sample', targetId: MATERIAL }, { type: 'inspect_object', targetId: MATERIAL }, { type: 'wait', seconds: 5 }].map((action, index) => ({
      index, action, eligibility: true, bindingsValid: true, exactSupport: copy(support), focus: false,
      support: { ...support, generation: 0, applicable: true },
      features: { operation: action.type, appearance, relation: action.targetId ? 'held' : 'unknown', workBand: '1', freeSlotBand: '2+', countBand: '1' },
      context: { focus: false, outputOfFocus: false, history: [], exposures: [{ scope: 'own', age: '<45', channels: 1, count: 1 }],
        workBand: '1', heldCount: 1, body: copy(view.body), appearance: copy(appearance), relation: action.targetId ? 'held' : 'unknown' },
    })) };
}
function mockFactory(options = {}) {
  let fixture;
  const createFixture = args => {
    let latestReceipt = null, postWaitFrames = 0;
    const material = { id: MATERIAL, position: { x: 0, y: 0 }, scene: 'valley', massGrams: 100, heldBy: 'aster' };
    const memory = { nextSeq: 1, receipts: [], ingestions: [], creditBlocked: false, model: { transitions: [] } };
    const sensor = { totals: [0, 0, 0], observationAt: null, receipts: [], exposures: [], events: [],
      materials: [{ objectId: MATERIAL, appearance: copy(appearance), known: true, generation: 0, lastSeenAt: 0 }] };
    const npc = { id: 'aster', elapsed: 0, nextDecisionAt: 0, active: null, lifecycle: 'AWAKE', rng: 7, inventory: { items: [] }, discovery: { temporal: memory } };
    fixture = { automatic: false, predictionArm: 'online', sourceFingerprint: args.sourceFingerprint, npc, memory, sensor,
      state: { elapsed: 0, agents: [npc], environment: { ecology: { plants: [], animals: [], materials: [material] } } },
      owner: { physicalSeed: 74193, sourceId: 'object:1', bodyOverrides: {}, resourceOverrides: {} },
      selector: { rng: 1729, focus: null }, admission: { deniedSubmissions: 0, deniedBatches: 0 },
      model: { rows: [], cold: true, cursors: { interval: { sequence: 0 } } }, commandLog: [], snapshotCalls: 0,
      checkpointDriver() { return { senseAt: sensor.observationAt, pending: null }; },
      act(action) {
        this.commandLog.push(copy(action));
        if (options.throwAction === action.type) throw new Error('Mock command error');
        this.step(); // Exercise producer frame-boundary interception, never physics.
        const at = latestReceipt ? latestReceipt.completedAt + .65 : 0;
        const duration = action.type === 'pull' ? 5 : action.type === 'inspect_object' ? 1.8 : action.type === 'sample' ? 3.5 : action.seconds;
        const seq = memory.nextSeq++, receipt = { seq, at, completedAt: at + duration, request: copy(action),
          outcome: { ok: options.failAction !== action.type, code: 'DONE', actionId: seq, durationSeconds: duration } };
        if (latestReceipt) {
          sensor.receipts.find(r => r.seq === latestReceipt.seq).interval = !options.unclosed;
          memory.model.transitions.push({ seq: latestReceipt.seq, nextSeq: seq, endAt: at, reward: [0, 0, 0, at - latestReceipt.at, 0] });
          this.model.cursors.interval.sequence = latestReceipt.seq;
        }
        if (action.type === 'pull') { receipt.outcome.materialId = MATERIAL; npc.inventory.items.push(MATERIAL); }
        if (action.type === 'sample') {
          receipt.outcome.code = 'SWALLOWED'; receipt.outcome.ingestionId = 'ingestion:1'; material.massGrams = options.exhausted ? 0 : 75;
          const ingestion = { id: 'ingestion:1', objectId: MATERIAL, actionId: seq, seq, at: receipt.completedAt, channels: 0, channelProof: {}, creditBlocked: false };
          memory.ingestions.push(ingestion); sensor.exposures.push({ ...copy(ingestion), generation: 0, appearance: copy(appearance), admitted: 0, censored: 0 });
        }
        npc.elapsed = receipt.completedAt; npc.nextDecisionAt = npc.elapsed + .65; this.state.elapsed = npc.elapsed;
        sensor.receipts.push({ seq, completed: true, interval: false }); memory.receipts.push(receipt); latestReceipt = receipt;
        args.sink({ type: 'mock-receipt', at: npc.elapsed, receipt });
        if (options.earlyFood && this.commandLog.length === 5) sensor.totals[0] = 1;
        return copy(receipt);
      },
      step() {
        if (this.commandLog.length < 5 || !memory.ingestions.length) return;
        postWaitFrames++; npc.elapsed += 1; this.state.elapsed = npc.elapsed;
        sensor.observationAt = npc.elapsed; sensor.materials[0].lastSeenAt = npc.elapsed;
        if (postWaitFrames === 2 && !options.noFood) {
          const ing = memory.ingestions[0], at = npc.elapsed, proof = { sourceSeq: 1, at };
          ing.channels = 1; ing.channelProof[0] = proof;
          sensor.exposures[0].admitted = 1; sensor.exposures[0].channelProof[0] = copy(proof);
          sensor.events.push({ sourceSeq: 1, at, ingestionId: ing.id, objectId: MATERIAL, actionId: ing.actionId, channels: 1 });
          sensor.totals[0] = 1; this.model.cold = false;
          args.sink({ type: 'mock-feedback', at, proof });
        }
      },
      candidateSnapshot({ draws } = {}) {
        assert.deepEqual(draws, SAME_MATERIAL_ASSAY.draws); this.snapshotCalls++; if (options.mutatingSnapshot) npc.rng++; const snapshot = root(npc.elapsed);
        if (options.masked) snapshot.candidates = snapshot.candidates.filter(c => c.action.type !== 'sample');
        return Object.freeze(snapshot);
      },
      predict(snapshot, model, { draws }) {
        const forecasts = snapshot.candidates.map(c => {
          const sample = c.action.type === 'sample', inspect = c.action.type === 'inspect_object';
          const utility = sample ? model.cold ? -.08 : .42 : inspect ? -.04 : options.strongerWait ? -.03 : -.1;
          return { D: { F: sample && !model.cold ? .5 : 0, W: 0, H: 0 }, B: { F: 0, W: 0, H: 0 },
            eligibility: true, scorable: !options.noComparison || sample, utility,
            exposure: { channels: { H: { epistemicRange: [0, 1], tailUncertain: true } } } };
        });
        const index = forecasts.reduce((best, f, index) => f.utility > forecasts[best].utility ? index : best, 0);
        if (options.mutatingPredictor) npc.rng++;
        return { forecasts, pending: { B: { F: 0, W: 0, H: 0 } }, choice: { selectedIndex: index,
          selected: snapshot.candidates[index], exploring: false, committedDrawCount: 4, draws: copy(draws) } };
      },
      dispose() { this.disposed = true; },
    };
    return fixture;
  };
  return { createFixture, get fixture() { return fixture; } };
}
function run(options = {}, extra = {}) {
  const factory = mockFactory(options), calls = [], events = [];
  const output = runSameMaterialAssay({ sourceFingerprint: SOURCE, createFixture: factory.createFixture,
    now: () => 10, onBoundary: info => { calls.push(info); }, onEvent: event => events.push(event), ...extra });
  return { ...output, calls, events, mock: factory.fixture };
}

test('import exports frozen pre-outcome script; requires fingerprint and resource callback before factory use', () => {
  assert.deepEqual(SAME_MATERIAL_ASSAY.commands.map(c => c.type), ['pull', 'inspect_object', 'sample', 'wait', 'wait']);
  assert.deepEqual(SAME_MATERIAL_ASSAY.draws, [.5, .5, .5, .5]); assert.ok(Object.isFrozen(SAME_MATERIAL_ASSAY.commands));
  let called = false;
  assert.throws(() => runSameMaterialAssay({ sourceFingerprint: 'bad', createFixture: () => { called = true; } }), /fingerprint/);
  assert.throws(() => runSameMaterialAssay({ sourceFingerprint: SOURCE, createFixture: () => { called = true; } }), /callback/);
  assert.equal(called, false);
});

test('16 nuisance projections preserve causal features, own summaries, actual pending facts, masks and order', () => {
  const snapshot = root(), before = sameMaterialHash(snapshot), variants = sameMaterialNuisanceQueries(snapshot, MATERIAL);
  assert.equal(variants.length, 16); assert.equal(new Set(variants.map(v => sameMaterialHash(v.snapshot))).size, 16);
  for (const v of variants) {
    assert.ok(Object.isFrozen(v.snapshot)); assert.deepEqual(v.snapshot.view, snapshot.view); assert.deepEqual(v.snapshot.exposures, snapshot.exposures);
    for (const [i, c] of v.snapshot.candidates.entries()) {
      assert.deepEqual(c.action, snapshot.candidates[i].action); assert.deepEqual(c.features, snapshot.candidates[i].features);
      assert.deepEqual(c.exactSupport, support); assert.equal(c.eligibility, true);
      assert.deepEqual(c.context.exposures.filter(e => e.scope === 'own'), snapshot.candidates[i].context.exposures);
      assert.equal(c.context.workBand, '1'); assert.equal(c.context.heldCount, 1);
    }
  }
  assert.equal(sameMaterialHash(snapshot), before);
});

test('data-only producer mock preserves all candidates, four selections, exact proof and unchanged hashes', () => {
  const out = run(); assert.equal(out.result.status, 'passed', JSON.stringify(out.result));
  assert.equal(out.fixture, out.mock); assert.equal(out.continuingAllowed, true); assert.equal(out.mock.disposed, undefined);
  assert.equal(out.mock.snapshotCalls, 1); assert.deepEqual(out.mock.commandLog.map(a => a.type), ['pull', 'inspect_object', 'sample', 'wait', 'wait']);
  assert.equal(out.evidence.queries.length, 16); assert.equal(out.evidence.proof.ingestionId, 'ingestion:1');
  assert.equal(out.evidence.frozenParametersBefore, out.evidence.frozenParametersAfter); assert.equal(out.frozenModel.cold, true); assert.equal(out.mock.model.cold, false);
  assert.deepEqual(out.evidence.physicalMass.map(m => m.massGrams), [100, 75, 75]);
  for (const q of out.evidence.queries) {
    assert.equal(q.beforeSelected.type, 'inspect_object'); assert.equal(q.afterSelected.type, 'sample');
    assert.deepEqual(q.frozenSelectedBefore, q.frozenSelectedAfter); assert.equal(q.selectionMode, 'exploitation');
    assert.equal(q.snapshot.candidates.length, 3); assert.equal(q.forecasts.after.forecasts.length, 3);
    assert.equal(q.stateHashes.before, q.stateHashes.after); assert.equal(q.rngHashes.before, q.rngHashes.after);
    assert.deepEqual(q.forecasts.after.forecasts[0].exposure.channels.H.epistemicRange, [0, 1]);
  }
  assert.equal(out.calls.filter(c => c.kind === 'command-before').length, 5);
  assert.equal(out.calls.filter(c => c.kind === 'frame-before').length, out.calls.filter(c => c.kind === 'frame-after').length);
  assert.ok(out.events.length >= 6); assert.equal(out.calls.filter(c => c.kind === 'snapshot-after').length, 1);
  out.fixture.dispose();
});

for (const [name, options] of [['failed command', { failAction: 'pull' }], ['exhausted portion', { exhausted: true }],
  ['unclosed real cost', { unclosed: true }], ['early F', { earlyFood: true }], ['missing F', { noFood: true }],
  ['native sample mask', { masked: true }], ['missing supported comparison', { noComparison: true }]]) {
  test(`${name} is unavailable, preserves the stop fixture, and never substitutes a recipe`, () => {
    const out = run(options); assert.equal(out.result.status, 'unavailable', JSON.stringify(out.result));
    assert.equal(out.continuingAllowed, false); assert.equal(out.fixture, out.mock); assert.equal(out.mock.disposed, undefined);
    assert.ok(out.evidence.stop); assert.ok(out.mock.commandLog.length <= 5); assert.ok(out.mock.snapshotCalls <= 1);
  });
}

test('owner frame-boundary stop retains partial evidence and stops immediately', () => {
  let frames = 0; const out = run({}, { onBoundary: info => { if (info.kind === 'frame-before' && ++frames === 2) return { stop: true, reason: 'owner-byte-budget' }; } });
  assert.equal(out.result.status, 'unavailable'); assert.equal(out.evidence.stop.reason, 'owner-byte-budget');
  assert.equal(out.mock.commandLog.length, 2); assert.equal(out.evidence.receipts.length, 1); assert.equal(out.fixture, out.mock);
});

test('pure query mutation fails rather than being relabeled a learning advantage', () => {
  const out = run({ mutatingPredictor: true }); assert.equal(out.result.status, 'failed');
  assert.equal(out.evidence.queries.length, 1); assert.equal(out.evidence.queries[0].rngChanged, true);
});

test('nonmonotonic and excessive resource clocks stop without a physical factory run', () => {
  let n = 10, calls = 0;
  const result = runSameMaterialAssay({ sourceFingerprint: SOURCE, onBoundary() {}, now: () => n--,
    createFixture() { calls++; } });
  assert.equal(result.result.status, 'failed'); assert.equal(calls, 0);
  let current = 0;
  const wall = runSameMaterialAssay({ sourceFingerprint: SOURCE, onBoundary() {}, now: () => { current += 300001; return current; },
    createFixture() { calls++; } });
  assert.equal(wall.result.status, 'failed'); assert.equal(calls, 0);
});


test('each ranking uses the strongest other eligible scorable candidate, including a non-inspect winner', () => {
  const out = run({ strongerWait: true }); assert.equal(out.result.status, 'passed');
  for (const q of out.evidence.queries) {
    assert.equal(q.comparisonBefore.action.type, 'wait'); assert.equal(q.comparisonAfter.action.type, 'wait');
    assert.equal(q.beforeComparisonUtility, -.03); assert.equal(q.afterComparisonUtility, -.03);
  }
});

test('first actual query resource timing includes root construction plus forecast and choose', () => {
  let time = 0; const out = run({}, { now: () => ++time }); assert.equal(out.result.status, 'passed');
  const first = out.calls.find(c => c.kind === 'prediction-after' && c.label === 'query-0-before');
  assert.ok(first.constructionMs > 0); assert.ok(first.predictionMs > 0);
  assert.equal(first.returnedDecisionMs, first.constructionMs + first.predictionMs);
  assert.equal(out.evidence.snapshotStateHashes.before, out.evidence.snapshotStateHashes.after);
  assert.equal(out.evidence.snapshotRngHashes.before, out.evidence.snapshotRngHashes.after);
});

test('actual root construction mutation is rejected before any matched projection', () => {
  const out = run({ mutatingSnapshot: true }); assert.equal(out.result.status, 'failed');
  assert.equal(out.evidence.queries.length, 0); assert.match(out.evidence.stop.reason, /root construction/);
});


test('an unavailable comparison preserves the attempted complete candidate forecasts', () => {
  const out = run({ noComparison: true }); assert.equal(out.result.status, 'unavailable');
  assert.equal(out.evidence.queries.length, 1);
  assert.equal(out.evidence.queries[0].snapshot.candidates.length, 3);
  assert.equal(out.evidence.queries[0].forecasts.after.forecasts.length, 3);
  assert.equal(out.evidence.queries[0].comparisonAfter, null);
});
