import test from 'node:test';
import assert from 'node:assert/strict';
import { freshState, canStand } from '../src/world.js';
import { PopulationRuntime } from '../src/population.js';
import { requestNpcAction, tickNpc, observeNpc } from '../src/npc.js';
import { processDiscoveryFeedback } from '../src/discovery.js';
import { recordEvent } from '../src/npc-memory.js';
import { projectPhysiology, isSleeping } from '../src/biology.js';
import { bodySignals, sensedEnvironment } from '../src/interoception.js';
import { lookupEcologyObject, ecologyEnergy } from '../src/ecology.js';
import { writeSave, loadSave } from '../src/save.js';
import {
  createTemporalLedger, beginTemporalDecision, advanceTemporalClock,
  completeTemporalDecision, recordTemporalFeedback,
} from '../src/temporal-ledger.js';
import { trainTemporalReturns, temporalPrediction } from '../src/temporal-returns.js';

// Scripted sensor/update feasibility only, never an autonomous learning result.
// Fresh finite world; Aster begins legally beside existing stock, hungry after
// 12 game hours. No materials, calories, water or recipes are inserted. Only the
// focal chooser is suppressed. Mira, ecology and the shared clock keep running.
const DT = 1 / 60;
const BETA = Math.log(2) / 300;
const F_FRAME = 3239, W_FRAME = 3475, END_FRAME = 3495;
const discount = seconds => Math.exp(-BETA * seconds);
const integral = (from, to, rate = 1) => rate * (Math.exp(-BETA * from) - Math.exp(-BETA * to)) / (60 * BETA);
const copy = value => structuredClone(value);
function close(actual, expected, label = 'value', tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${label}: ${actual} != ${expected}`);
}
function contextFor(f, action) {
  const n = f.n, m = n.discovery.temporal, object = n.discovery.observations[action.targetId];
  const history = m.receipts.filter(r => r.request.targetId === action.targetId && r.outcome).slice(-2)
    .map(r => ({ operation: r.request.type, outcome: r.outcome.ok ? 'success' : 'physical failure' }));
  const attempts = m.receipts.filter(r => r.request.targetId === action.targetId && r.outcome?.durationSeconds > 0).length;
  const workBand = attempts < 2 ? String(attempts) : attempts < 4 ? '2..3' : attempts < 8 ? '4..7' : attempts < 16 ? '8..15' : '16+';
  return {
    body: bodySignals(n), ...sensedEnvironment(n),
    appearance: { ...object?.appearance, motion: object?.motion },
    relation: action.targetId ? n.inventory.items.includes(action.targetId) ? 'held' : 'reach' : undefined,
    heldCount: n.inventory.items.length,
    countBand: object ? object.count === 0 ? '0' : object.count === 1 ? '1' : '2+' : undefined,
    history, workBand,
    exposures: m.ingestions.map(i => ({
      scope: i.objectId === action.targetId ? 'own' : 'other',
      age: n.elapsed - i.at < 45 ? '<45' : n.elapsed - i.at < 180 ? '45..180' : n.elapsed - i.at < 600 ? '180..600' : '>600',
      count: 1, channels: i.channels,
    })),
    historyCensored: m.historyCensored,
  };
}

function attachFixture(state) {
  const f = { state, n: state.agents[0], frame: Math.round(state.elapsed * 60), pending: null, emitted: [] };
  assert.ok(f.n.discovery.temporal, 'only this fixture attaches the optional ledger');
  f.runtime = new PopulationRuntime(state, { cardinal: false, discoveryFoodLearning: false });
  const controller = f.runtime.controller(f.n.id);
  controller.tick = dt => {
    const n = f.n, m = n.discovery.temporal;
    const previousIds = new Set(n.physiology.feedback.map(e => e.id));
    tickNpc(n, dt, state.environment);
    advanceTemporalClock(m, n.elapsed);
    // Capture at biology emission, before the ordinary awake-only processing.
    for (const event of n.physiology.feedback.filter(e => !previousIds.has(e.id))) {
      close(event.at, n.elapsed, 'feedback emitted on this physical frame');
      f.emitted.push(copy(event));
      assert.equal(recordTemporalFeedback(m, event, { now: n.elapsed }), true);
    }
    captureCompletion(f);
    if (isSleeping(n) || n.lifecycle !== 'AWAKE') return;
    processDiscoveryFeedback(n, { foodLearning: false, recordEffect: feedback => recordEvent(n, 'condition', { code: 'DISCOVERY_EFFECT', feedback }) });
    if (n.elapsed - controller.senseAt >= 1) {
      observeNpc(n, state.environment);
      controller.senseAt = n.elapsed;
    }
  };
  return f;
}

function captureCompletion(f) {
  const pending = f.pending, result = f.n.lastResult;
  if (!pending || f.n.active || !result || result.eventId <= pending.previousEventId) return;
  const event = f.n.memory.experience.find(e => e.id === result.eventId && e.type === 'action');
  assert.ok(event, 'completion must bind the actual engine action event');
  assert.equal(event.details.action.type, pending.action.type);
  assert.equal(event.details.action.targetId, pending.action.targetId);
  assert.equal(completeTemporalDecision(f.n.discovery.temporal, {
    seq: pending.seq, at: f.n.elapsed, actionId: event.id, result,
  }), true);
  f.pending = null;
}

function step(f, frames = 1) {
  for (let i = 0; i < frames; i++) {
    f.state.elapsed += DT;
    f.runtime.tick(DT);
    f.frame++;
  }
}
function stepTo(f, frame) {
  assert.ok(frame >= f.frame, 'physical fixture never reverses time');
  step(f, frame - f.frame);
}
function submit(f, action, { scheduler = true } = {}) {
  assert.equal(f.n.active, null);
  assert.equal(f.pending, null);
  if (scheduler) while (f.n.elapsed < f.n.nextDecisionAt) step(f);
  const seq = beginTemporalDecision(f.n.discovery.temporal, { at: f.n.elapsed, context: contextFor(f, action), action });
  f.pending = { seq, action: copy(action), previousEventId: f.n.lastResult?.eventId || 0 };
  const requested = requestNpcAction(f.n, action, f.state.environment);
  assert.equal(requested.ok, true, `${action.type}: ${requested.code}`);
  captureCompletion(f);
  return seq;
}
function act(f, action, options) {
  const seq = submit(f, action, options);
  for (let frames = 0; f.n.active && frames < 1200; frames++) step(f);
  assert.equal(f.n.active, null, 'short command must physically finish');
  assert.equal(f.pending, null);
  const receipt = f.n.discovery.temporal.receipts.find(r => r.seq === seq);
  assert.equal(receipt.outcome.ok, true);
  return receipt;
}

let initialMeal;
function postSwallow() {
  if (!initialMeal) {
    const state = freshState(), n = state.agents[0], ecology = state.environment.ecology;
    const tree = ecology.plants.find(p => p.kind === 'apple_tree' && p.quantity > 0);
    n.position = [45, -45].map(dx => ({ x: tree.position.x + dx, y: tree.position.y })).find(p => canStand(p.x, p.y, 'valley'));
    assert.ok(n.position);
    n.physiology.hoursSinceMeal = 12;
    projectPhysiology(n);
    n.discovery.temporal = createTemporalLedger();
    const initialBody = copy(n.physiology), initialStock = tree.quantity;
    const f = attachFixture(state);
    const pull = act(f, { type: 'pull', targetId: tree.id });
    close(pull.outcome.durationSeconds, 5);
    assert.equal(tree.quantity, initialStock - 1);
    const materialId = n.inventory.items[0], material = lookupEcologyObject(ecology, materialId), before = copy(material);
    assert.equal(material.heldBy, n.id);
    // These first two external fixture commands are explicitly back-to-back.
    // All subsequent action-chain requests honor the genuine scheduler delay.
    const sample = act(f, { type: 'sample', targetId: materialId }, { scheduler: false });
    close(sample.outcome.durationSeconds, 3.5);
    close(n.elapsed, 8.5);
    close(before.massGrams - material.massGrams, 30, 'finite swallowed mass');
    close(before.energyKcal - material.energyKcal, 95 / 6, 'finite swallowed energy');
    close(before.waterMl - material.waterMl, 25.5, 'finite swallowed water');
    assert.equal(sample.outcome.code, 'SWALLOWED');
    assert.equal(n.physiology.stomach.length, 1);
    const gut = n.physiology.stomach[0];
    assert.equal(gut.actionId, sample.outcome.actionId);
    assert.equal(gut.id, sample.outcome.ingestionId);
    assert.equal(gut.objectId, materialId);
    assert.deepEqual(n.discovery.temporal.totals, [0, 0, 0]);
    const unrelated = Object.values(n.discovery.observations).find(o => o.id !== tree.id && o.id !== materialId &&
      Math.hypot(o.position.x - n.position.x, o.position.y - n.position.y) <= 80 && ecology.plants.some(p => p.id === o.id));
    assert.ok(unrelated, 'a separately observed stationary target is available');
    initialMeal = { state: copy(state), initialBody, materialBefore: before, materialId, treeId: tree.id, initialStock, unrelatedId: unrelated.id };
    f.runtime.dispose();
  }
  const { state, ...fixtureDetails } = copy(initialMeal);
  return Object.assign(attachFixture(state), fixtureDetails);
}

function reopen(f) {
  const records = new Map(), storage = { getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, value) };
  const before = copy(f.n.discovery.temporal);
  assert.equal(writeSave(storage, f.state), true);
  const result = loadSave(storage);
  assert.equal(result.error, null);
  assert.equal(result.exists, true);
  assert.deepEqual(result.state.npc.discovery.temporal.model, before.model, 'save/reopen never adds a sweep or visit');
  assert.deepEqual(result.state.npc.discovery.temporal.open, before.open, 'open interval survives without fabricating an outcome');
  return attachFixture(result.state);
}

function assertBiologicalLedger(f) {
  const m = f.n.discovery.temporal, feedback = f.n.physiology.feedback;
  assert.deepEqual(m.totals, [1, 1, 0]);
  assert.equal(m.events.length, 2);
  assert.deepEqual(m.events.map(e => e.channels), [1, 2]);
  close(m.events[0].at, F_FRAME * DT, 'native sustained report time');
  close(m.events[1].at, W_FRAME * DT, 'native water report time');
  for (const event of m.events) {
    const biological = feedback.find(e => e.id === event.id);
    assert.ok(biological);
    for (const key of ['at', 'ingestionId', 'objectId', 'actionId']) assert.equal(event[key], biological[key], key);
    assert.equal(event.sourceSeq, Number(biological.id.slice(9)));
    const owner = m.receipts.find(r => r.seq === event.owner), next = m.receipts.find(r => r.seq === owner.seq + 1);
    assert.ok(owner.at <= event.at && (!next || event.at <= next.at));
    assert.ok(owner.order < event.order && (!next || event.order < next.order));
  }
  assert.equal(m.ingestions.length, 1);
  assert.equal(m.ingestions[0].channels, 3);
  assert.equal(m.rejectedEvents, 0);
  assert.equal(m.censoredEvents, 0);
}

function assertFiniteBalance(f) {
  const p = f.n.physiology, t = p.totals, initial = f.initialBody;
  const held = lookupEcologyObject(f.state.environment.ecology, f.materialId), gut = p.stomach[0];
  assert.ok(held && gut);
  close(held.massGrams + gut.originalMassGrams, f.materialBefore.massGrams, 'source/ingestion mass transfer');
  close(gut.originalMassGrams, 30);
  close(gut.remainingMassGrams / gut.originalMassGrams, gut.remainingKcal / gut.originalKcal, 'remaining matter fraction');
  close(t.ingestedKcal, t.absorbedKcal + t.discardedKcal + gut.remainingKcal, 'digestive energy balance');
  close(t.ingestedWaterMl, t.absorbedWaterMl + t.discardedWaterMl + gut.remainingWaterMl, 'digestive water balance');
  close(held.energyKcal + t.ingestedKcal, f.materialBefore.energyKcal, 'finite material energy');
  close(held.waterMl + t.ingestedWaterMl, f.materialBefore.waterMl, 'finite material water');
  close(p.availableEnergyKcal + p.storedEnergyKcal, initial.availableEnergyKcal + initial.storedEnergyKcal + t.absorbedKcal - t.metabolizedKcal, 'whole-body energy balance');
  close(p.waterDeficitMl, initial.waterDeficitMl + t.waterLostMl - t.absorbedWaterMl, 'whole-body water balance');
  assert.ok(t.metabolizedKcal > t.absorbedKcal, 'one small portion is not a survival or energy-sufficiency result');
  const e = f.state.environment.ecology, l = e.ledger;
  close(l.humanRemovedKcal, f.state.agents.reduce((sum, actor) => sum + actor.physiology.totals.ingestedKcal, 0), 'all human withdrawals reach actual ingestion totals');
  assert.deepEqual(p.outsideAssistance, { energyKcal: 0, waterMl: 0, count: 0 });
  close(ecologyEnergy(e), l.initialKcal + l.photosynthesisKcal + l.externalKcal - l.humanRemovedKcal - l.metabolizedKcal - l.decomposedKcal - l.discardedKcal, 'whole finite-ecology energy balance', 1e-8);
  close(f.state.elapsed, f.state.environment.elapsed, 'shared environment clock');
  for (const actor of f.state.agents) close(actor.elapsed, f.state.elapsed, `${actor.id} clock`);
  assert.ok(f.state.agents[1].memory.experience.some(e => e.type === 'action'), 'Mira continues ordinary actions');
}

test('native finite-source delayed feedback crosses more than twelve real decisions and matches analytic return', () => {
  const f = postSwallow();
  try {
    for (let i = 0; i < 24; i++) act(f, i % 2 ? { type: 'wait', seconds: .25 } : { type: 'inspect_object', targetId: f.unrelatedId });
    const m = f.n.discovery.temporal;
    assert.ok(f.frame < F_FRAME, 'all 24 unrelated operations precede delayed food feedback');
    for (let i = 2; i < m.receipts.length; i++) assert.ok(m.receipts[i].at - m.receipts[i - 1].completedAt >= .65 - 1e-10, 'real scheduler delay is retained');
    stepTo(f, END_FRAME);
    const boundary = submit(f, { type: 'observe' });
    assert.equal(f.frame, END_FRAME);
    assertBiologicalLedger(f);
    assertFiniteBalance(f);
    assert.equal(m.model.updateCount, 0, 'clock, receipt and feedback capture do not train implicitly');
    assert.equal(m.model.transitions.length, 26);
    assert.ok(m.events.every(e => e.owner > 14), 'reward remains at the late interval, never moved back to swallowing');
    const first = m.model.transitions[0], tail = m.receipts.find(r => r.seq === boundary);
    const expected = [discount(m.events[0].at), discount(m.events[1].at), 0, integral(0, f.n.elapsed), 0];
    for (const r of m.receipts.filter(r => r.outcome?.exertion)) {
      const rank = { light: 1 / 3, moderate: 2 / 3, strenuous: 1 }[r.outcome.exertion];
      expected[4] += integral(r.completedAt - r.outcome.durationSeconds, r.completedAt, rank);
    }
    const beforeEvents = copy(m.events), beforeTotals = copy(m.totals);
    const trained = trainTemporalReturns(m.model);
    assert.equal(trained.targets, 8 * m.model.transitions.length);
    const prediction = temporalPrediction(m.model, first.key), learnedFraction = 1 - .8 ** 8;
    expected.forEach((v, channel) => close(prediction.q[channel], learnedFraction * v, `analytical first-row channel ${channel}`));
    assert.equal(temporalPrediction(m.model, tail.key).visits, 0, 'actual open successor is not trained');
    assert.equal(m.model.rows.find(r => r.key === tail.key).updates, 0);
    trainTemporalReturns(m.model);
    assert.deepEqual(m.events, beforeEvents);
    assert.deepEqual(m.totals, beforeTotals, 'replay cannot manufacture another biological event');
  } finally { f.runtime.dispose(); }
});

test('save one native frame before feedback preserves admission, body state and open-interval semantics', () => {
  const f = postSwallow();
  let restored;
  try {
    stepTo(f, F_FRAME - 1);
    assert.equal(f.n.physiology.feedback.length, 0);
    restored = reopen(f);
    assert.deepEqual(restored.n.physiology, f.n.physiology);
    step(f); step(restored);
    assert.equal(f.n.physiology.feedback.length, 1);
    assert.deepEqual(restored.n.physiology.feedback, f.n.physiology.feedback);
    assert.deepEqual(restored.n.discovery.temporal, f.n.discovery.temporal);
    stepTo(f, END_FRAME); stepTo(restored, END_FRAME);
    assertBiologicalLedger(restored);
    assert.deepEqual(restored.n.physiology, f.n.physiology);
    assert.deepEqual(restored.n.discovery.temporal, f.n.discovery.temporal);
    assert.equal(restored.n.discovery.temporal.model.updateCount, 0);
  } finally { f.runtime.dispose(); restored?.runtime.dispose(); }
});

test('real forced sleep captures feedback at emission across reopen before awake discovery processing', () => {
  const f = postSwallow();
  let restored;
  try {
    // Explicit copied-body fatigue fixture. Sleep itself is an authoritative
    // 1,200-second request with actual onset and physical arousal rules.
    f.n.physiology.fatigue = 80; f.n.physiology.sleepPressure = 90; projectPhysiology(f.n);
    const sleepSeq = submit(f, { type: 'sleep', seconds: 1200 });
    trainTemporalReturns(f.n.discovery.temporal.model);
    step(f, 30 * 60);
    assert.equal(f.n.physiology.sleep.state, 'sleeping');
    assert.equal(f.n.active.request.type, 'sleep');
    restored = reopen(f);
    assert.equal(restored.n.active, null, 'existing persistence cancels the command, not the biological sleep');
    assert.equal(restored.n.physiology.sleep.state, 'sleeping');
    assert.ok(restored.n.memory.experience.some(e => e.details.result?.code === 'RESTART_INTERRUPTED'));
    const updates = f.n.discovery.temporal.model.updateCount;
    step(f, 40 * 60); step(restored, 40 * 60);
    for (const branch of [f, restored]) {
      assert.equal(branch.n.physiology.sleep.state, 'sleeping');
      assert.equal(branch.n.discovery.effects.length, 0, 'awake-only discovery processing has not happened');
      assertBiologicalLedger(branch);
      assert.ok(branch.n.discovery.temporal.events.every(e => e.owner === sleepSeq));
      assert.equal(branch.n.discovery.temporal.open.seq, sleepSeq);
      assert.equal(branch.n.discovery.temporal.receipts.find(r => r.seq === sleepSeq).outcome, undefined);
      assert.equal(branch.n.discovery.temporal.model.updateCount, updates, 'open sleep and restore add no training');
    }
    assert.deepEqual(restored.n.physiology, f.n.physiology);
    assert.deepEqual(restored.n.discovery.temporal, f.n.discovery.temporal);
    assertFiniteBalance(f);
  } finally { f.runtime.dispose(); restored?.runtime.dispose(); }
});

test('matched unrelated inspect and wait share old-meal positive return at a common physical boundary', () => {
  const base = postSwallow();
  let inspect, wait;
  try {
    stepTo(base, 3150); // 52.5 seconds, before both old-ingestion reports.
    inspect = attachFixture(copy(base.state)); wait = attachFixture(copy(base.state));
    const inspectReceipt = act(inspect, { type: 'inspect_object', targetId: base.unrelatedId });
    const waitReceipt = act(wait, { type: 'wait', seconds: 5 });
    for (const f of [inspect, wait]) {
      stepTo(f, END_FRAME);
      submit(f, { type: 'observe' });
      assert.equal(f.frame, END_FRAME);
      assertBiologicalLedger(f);
      trainTemporalReturns(f.n.discovery.temporal.model);
    }
    const a = temporalPrediction(inspect.n.discovery.temporal.model, inspectReceipt.key).q;
    const b = temporalPrediction(wait.n.discovery.temporal.model, waitReceipt.key).q;
    assert.deepEqual(inspect.n.physiology.feedback, wait.n.physiology.feedback);
    for (const channel of [0, 1, 2, 3]) close(a[channel], b[channel], `matched old-meal channel ${channel}`);
    assert.ok(a[0] > 0 && a[1] > 0, 'both unrelated operations predict the same already-pending meal');
    assert.ok(a[4] > b[4]);
    assert.equal(b[4], 0);
    assert.notEqual(inspectReceipt.outcome.durationSeconds, waitReceipt.outcome.durationSeconds);
    assert.ok(inspect.n.physiology.totals.metabolizedKcal > wait.n.physiology.totals.metabolizedKcal);
    // Shared boundary means equal elapsed T despite unequal command duration.
    close(a[3], (1 - .8 ** 8) * integral(0, 5.75));
    const positiveUtility = q => q[0] + q[1] - 4 * q[2];
    close(positiveUtility(a), positiveUtility(b), 'no spurious unrelated-operation positive preference');
  } finally { base.runtime.dispose(); inspect?.runtime.dispose(); wait?.runtime.dispose(); }
});

test('two finite pending portions retain separate benefit identities and later harmful surprise across reopen', () => {
  const f = postSwallow();
  let restored;
  try {
    // Explicit copied-world initial material-age intervention for this assay.
    // The first swallowed portion stays fresh; only the remaining held piece is
    // aged before the second real swallow. Composition and stock are unchanged.
    const material = lookupEcologyObject(f.state.environment.ecology, f.materialId);
    material.ageHours = 288; material.spoiled = true;
    const sample = act(f, { type: 'sample', targetId: f.materialId });
    assert.equal(sample.outcome.code, 'SWALLOWED');
    assert.equal(f.n.physiology.stomach.length, 2);
    const [fresh, aged] = f.n.physiology.stomach;
    assert.notEqual(fresh.id, aged.id);
    assert.ok(material.massGrams + fresh.originalMassGrams + aged.originalMassGrams < f.materialBefore.massGrams, 'aged held matter really decays into regional detritus during work');
    close(fresh.originalMassGrams + aged.originalMassGrams, 60, 'two finite physical portions');
    stepTo(f, 63 * 60);
    assert.deepEqual(f.n.discovery.temporal.totals, [2, 2, 0]);
    assert.deepEqual(f.n.discovery.temporal.ingestions.map(i => i.channels), [3, 3]);
    restored = reopen(f);
    stepTo(f, 75 * 60); stepTo(restored, 75 * 60);
    assert.deepEqual(restored.n.physiology, f.n.physiology);
    assert.deepEqual(restored.n.discovery.temporal, f.n.discovery.temporal);
    const memory = f.n.discovery.temporal;
    assert.deepEqual(memory.totals, [2, 2, 1]);
    const surprise = memory.events.find(e => e.channels === 4);
    assert.ok(surprise);
    assert.equal(surprise.ingestionId, aged.id);
    assert.equal(surprise.actionId, aged.actionId);
    assert.ok(memory.events.filter(e => e.ingestionId === aged.id && e.channels !== 4).every(e => e.at < surprise.at));
    assert.equal(memory.ingestions.find(i => i.id === fresh.id).channels, 3);
    assert.equal(memory.ingestions.find(i => i.id === aged.id).channels, 7);
    const biological = f.n.physiology.feedback.find(e => e.id === surprise.id);
    assert.equal(biological.effect, 'discomfort');
    assert.equal(biological.thirst, 'easing');
    assert.equal(surprise.channels, 4, 'combined water message cannot re-credit the earlier water channel');
    const p = f.n.physiology, totals = p.totals;
    close(totals.ingestedKcal, totals.absorbedKcal + totals.discardedKcal + p.stomach.reduce((n, g) => n + g.remainingKcal, 0));
    close(totals.ingestedWaterMl, totals.absorbedWaterMl + totals.discardedWaterMl + p.stomach.reduce((n, g) => n + g.remainingWaterMl, 0));
    const ecology = f.state.environment.ecology, l = ecology.ledger;
    close(ecologyEnergy(ecology), l.initialKcal + l.photosynthesisKcal + l.externalKcal - l.humanRemovedKcal - l.metabolizedKcal - l.decomposedKcal - l.discardedKcal, 'whole ecology includes real held-material decay into detritus', 1e-8);
    close(l.humanRemovedKcal, f.state.agents.reduce((sum, actor) => sum + actor.physiology.totals.ingestedKcal, 0));
    assert.deepEqual(p.outsideAssistance, { energyKcal: 0, waterMl: 0, count: 0 });
  } finally { f.runtime.dispose(); restored?.runtime.dispose(); }
});
