/** Pure, explicitly SYNTHETIC evidence. No fixture, seed, world or outcome run. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { assessLaterPredictionQuality } from '../scripts/lib/reusable-prediction-gates.mjs';
import { VALIDATION_PROTOCOL, VALIDATION_CENSUS, VALIDATION_PHYSICAL_PLAN, VALIDATION_INDICATORS, PHYSICAL_MATRIX,
  validationEvidenceKey, createValidationCensus, assessValidationCensus, assessPairedPhysicalForecast,
  assessPhysicalCompletion, compareOldMealSchedules, aggregateValidationQuality, assessOldMealAttribution,
  assessDelayedHarm, assessReleaseComparisons, assessChannelAdmission, assessSourceOrderReplay, assessSmallPortion,
} from '../scripts/lib/reusable-validation-evidence.mjs';

const clone = value => structuredClone(value);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const statuses = ['success', 'failure', 'refused', 'interrupted'];
const syntheticEvent = (id = 1, at = 30, ingestion = 2, effect = 'sustained') => ({ id: `feedback:${id}`, at,
  ingestionId: `ingestion:${ingestion}`, objectId: 'object:2', actionId: ingestion, provenance: 'sampled', effect, thirst: 'unchanged' });
function syntheticAction(plan = VALIDATION_PHYSICAL_PLAN[0]) {
  const operation = plan.operation, actionId = plan.slot + 1;
  const submittedAt = 10 + plan.slot * 2, completedAt = submittedAt + 1;
  const features = { operation, appearance: { shape: 'round', color: 'red', texture: 'smooth', motion: 'still', size: 'small', smell: 'sweet' },
    relation: operation === 'wait' ? 'unknown' : operation === 'grasp' ? 'reach' : 'held', workBand: '1', freeSlotBand: '1', countBand: '1' };
  const effects = Object.fromEntries(VALIDATION_INDICATORS.filter(i => !statuses.includes(i)).map(i => [i, PHYSICAL_MATRIX[operation].excluded.includes(i) ? null : false]));
  if (operation === 'sample') effects.exposure = true;
  const p = value => ({ mean: value === null ? null : Number(value), known: value !== null, support: [], range: [0, 1] });
  const model = { features, effects: Object.fromEntries(Object.entries(effects).map(([k, v]) => [k, p(v)])),
    completion: Object.fromEntries(statuses.map(k => [k, p(k === 'success')])) };
  return { synthetic: true, runId: plan.runId, slot: plan.slot, operation, actionId, featuresHash: hash(features), predictedAt: submittedAt, submittedAt, completedAt,
    online: clone(model), frozen: clone(model), receipt: { seq: actionId, at: submittedAt, completedAt,
      request: { type: operation, ...(operation === 'wait' ? {} : { targetId: 'object:2' }) },
      outcome: { ok: true, actionId, code: operation === 'sample' ? 'SWALLOWED' : 'SYNTHETIC_COMPLETION', ...(operation === 'sample' ? { ingestionId: 'ingestion:2' } : {}) } },
    receiptUpdate: { sequence: actionId, at: completedAt, durationSeconds: 1, features: clone(features), completion: 'success', effects } };
}
function syntheticBiology() {
  const event = { ...syntheticEvent(1, 30), actionId: 1 };
  const positive = { online: .7, frozen: 0, eventAt: 30, event,
    proof: { sourceSeq: 1, at: 30, ingestionId: 'ingestion:2', objectId: 'object:2', actionId: 1 } };
  const forecasts = Object.fromEntries(['online', 'frozen'].map(arm => [arm, { ageSeconds: 0, horizonSeconds: 600,
    channels: Object.fromEntries(['F', 'W', 'H'].map(c => [c, { probability: c === 'F' ? positive[arm] : 0,
      unknownBins: [1, 2], unsupported: true, rates: [], epistemicRange: [0, 1] }])) }]));
  return { synthetic: true, runId: 'Q1-fresh-followup', sourceRunId: 'P1-fresh-prefix', evidenceClass: 'physical-advancement', origin: 'new-ingestion', clusterId: 'apple-common-history', forecasts,
    ingestionId: 'ingestion:2', trainingIngestionId: 'ingestion:1', actionId: 1, materialId: 'object:2', trainingMaterialId: 'object:2', trainingFeedbackAt: 5,
    predictedAt: 10, submittedAt: 10, swallowedAt: 11, followedThroughAt: 611, horizonSeconds: 600, continuous: true, proofsRetained: true,
    channels: { F: positive, W: { online: 0, frozen: 0, eventAt: null }, H: { online: 0, frozen: 0, eventAt: null } } };
}
function syntheticQuality() {
  return { biological: [syntheticBiology()], physical: VALIDATION_PHYSICAL_PLAN.flatMap(p => assessPhysicalCompletion(syntheticAction(p)).cells),
    census: VALIDATION_CENSUS.map(r => ({ runId: r.runId, status: 'passed' })) };
}

test('frozen census is exactly ordered 16 runs, 50 actions, 38 quality receipts and 323 mandatory cells', () => {
  assert.equal(VALIDATION_CENSUS.length, 16);
  assert.equal(VALIDATION_CENSUS.reduce((n, r) => n + r.actions.length, 0), 50);
  assert.equal(VALIDATION_PHYSICAL_PLAN.length, 38);
  assert.equal(VALIDATION_PHYSICAL_PLAN.reduce((n, r) => n + r.mandatoryIndicators.length, 0), 323);
  assert.equal(VALIDATION_PHYSICAL_PLAN.reduce((n, r) => n + r.structuralUnknownIndicators.length, 0), 57);
  assert.equal(VALIDATION_PHYSICAL_PLAN.filter(r => r.runId.startsWith('C')).reduce((n, r) => n + r.mandatoryIndicators.length, 0), 134);
  assert.equal(VALIDATION_PHYSICAL_PLAN.filter(r => r.runId.startsWith('H')).reduce((n, r) => n + r.mandatoryIndicators.length, 0), 180);
  assert.deepEqual(VALIDATION_CENSUS[1].requires, ['T0-common-apple']);
  assert.equal(VALIDATION_CENSUS.at(-1).parent, 'A1');
  assert.throws(() => { VALIDATION_CENSUS[0].actions.push('sample'); }, TypeError);
  assert.throws(() => { PHYSICAL_MATRIX.wait.required[0] = 'held'; }, TypeError);
  assert.equal(VALIDATION_PROTOCOL.qualityImprovement, .20); assert.equal(VALIDATION_PROTOCOL.physicalDegradation, .02);
});

test('partial/blocked census preserves absent metrics, dependencies and immutable plan', () => {
  const rows = createValidationCensus([{ runId: 'T0-common-apple', status: 'unavailable', reason: 'synthetic blocker', metrics: { observedActions: 2 } }]);
  assert.equal(rows[0].started, true); assert.equal(rows[1].status, 'blocked'); assert.equal(rows[1].started, false);
  assert.equal(rows[1].metrics, null); assert.equal(rows[15].blocker.reason, 'synthetic blocker');
  assert.equal(assessValidationCensus([]).status, 'pending');
  assert.equal(assessValidationCensus([{ runId: 'P1-fresh-prefix', status: 'running' }]).status, 'failed');
  assert.throws(() => createValidationCensus([{ runId: 'T0-common-apple', status: 'failed' }, { runId: 'P1-fresh-prefix', status: 'passed' }]), /predecessor/);
  assert.throws(() => createValidationCensus([{ runId: 'T0-common-apple', status: 'passed', started: false }]), /start flag/);
  const immutablePlan = createValidationCensus([{ runId: 'T0-common-apple', status: 'running', actions: [], parent: 'fabricated' }]);
  assert.equal(immutablePlan[0].actions.length, 9); assert.equal(immutablePlan[0].parent, 'new-apple');
});

test('pre-command physical guard stops on missing/unknown paired cells without scoring structural exclusions', () => {
  const input = syntheticAction(), good = assessPairedPhysicalForecast(input);
  assert.equal(good.status, 'passed'); assert.equal(good.cells.length, 10); assert.equal(good.mandatoryCells, 9);
  assert.equal(good.cells.find(c => c.indicator === 'unchanged').labelState, 'structural-unknown');
  for (const mutate of [i => { i.online.effects.held.known = false; }, i => { i.frozen.completion.failure.mean = null; },
    i => { delete i.frozen.effects.output; }, i => { i.online.effects.exposure.mean = NaN; }]) {
    const i = syntheticAction(); mutate(i); assert.equal(assessPairedPhysicalForecast(i).status, 'unavailable');
  }
  const changed = syntheticAction(); changed.frozen.features.workBand = '0'; assert.equal(assessPairedPhysicalForecast(changed).status, 'failed');
  assert.equal(assessPairedPhysicalForecast({ ...input, runId: 'B1-small-exhausted' }).status, 'failed');
  assert.deepEqual(input, syntheticAction());
});

test('completion labels are exactly sensor Booleans tied to real action/sequence/time', () => {
  const good = assessPhysicalCompletion(syntheticAction()); assert.equal(good.status, 'passed');
  assert.equal(good.cells.find(c => c.indicator === 'exposure').outcome, 1);
  for (const mutate of [i => { i.actionId = 'action:1'; }, i => { i.receipt.outcome.actionId = 5; },
    i => { i.receiptUpdate.sequence++; }, i => { i.predictedAt = 10.5; }, i => { i.receiptUpdate.effects.unchanged = false; },
    i => { i.receipt.outcome.ok = false; }]) {
    const i = syntheticAction(); mutate(i); assert.equal(assessPhysicalCompletion(i).status, 'failed');
  }
  for (const mutate of [i => { i.receiptUpdate.effects.exposure = null; }, i => { delete i.receiptUpdate; }, i => { i.receiptUpdate.completion = 'unknown'; }]) {
    const i = syntheticAction(); mutate(i); const r = assessPhysicalCompletion(i); assert.equal(r.status, 'unavailable');
    assert.ok(r.cells.some(c => c.required && c.labelState === 'unknown'));
  }
});

test('full pure quality keeps real ID collisions across worlds and exactly the original row-wise equations', () => {
  const q = syntheticQuality(), original = clone(q), r = aggregateValidationQuality(q);
  const p1 = q.physical.find(p => p.runId === 'P1-fresh-prefix' && p.slot === 0);
  assert.equal(p1.actionId, q.biological[0].actionId);
  assert.equal(p1.receiptProof.targetId, q.biological[0].materialId);
  assert.equal(p1.receiptProof.ingestionId, q.biological[0].ingestionId);
  assert.equal(p1.receiptProof.completionCode, 'SWALLOWED'); assert.equal(p1.receiptProof.completionOk, true);
  assert.equal(p1.completedAt, q.biological[0].swallowedAt);
  assert.equal(r.status, 'passed'); assert.equal(r.expectedPhysicalCells, 323); assert.equal(r.resolvedPhysicalCells, 323);
  assert.equal(r.structuralUnknownCells, 57); assert.equal(r.independentIngestions, 1); assert.equal(r.materialClusters, 1);
  assert.equal(r.physicalOnlineBrier, 0); assert.equal(r.physicalDegradation, 0);
  assert.equal(r.biologicalOnlineBrier, (.7 - 1) ** 2 / 3); assert.equal(r.biologicalFrozenBrier, 1 / 3);
  const single = assessLaterPredictionQuality({ biological: q.biological, physical: q.physical.filter(p => p.runId === 'P1-fresh-prefix' && p.required) });
  assert.equal(r.biologicalOnlineBrier, single.biologicalOnlineBrier); assert.equal(r.relativeBiologicalImprovement, single.relativeBiologicalImprovement);
  assert.notEqual(validationEvidenceKey('C1-early-inspect', 1, 'held'), validationEvidenceKey('C2-early-wait', 1, 'held'));
  assert.deepEqual(q, original); assert.equal(r.continuingAllowed, false); assert.equal(r.originalResourceAdmissionPassed, false);
});

test('self-consistent biological IDs still must identify the actual retained P1 slot-0 swallow', () => {
  const withPositiveProofs = (r, update) => {
    for (const p of Object.values(r.channels)) if (p.eventAt !== null) { update(p.proof); update(p.event); }
  };
  for (const mutate of [
    r => { r.actionId = 2; withPositiveProofs(r, p => { p.actionId = 2; }); },
    r => { r.actionId = 999; withPositiveProofs(r, p => { p.actionId = 999; }); },
    r => { r.ingestionId = 'ingestion:999'; withPositiveProofs(r, p => { p.ingestionId = 'ingestion:999'; }); },
    r => { r.materialId = r.trainingMaterialId = 'object:999'; withPositiveProofs(r, p => { p.objectId = 'object:999'; }); },
    r => {
      r.actionId = 999; r.ingestionId = 'ingestion:999'; r.materialId = r.trainingMaterialId = 'object:999';
      withPositiveProofs(r, p => { p.actionId = 999; p.ingestionId = 'ingestion:999'; p.objectId = 'object:999'; });
    },
  ]) {
    const q = syntheticQuality(); mutate(q.biological[0]);
    const r = aggregateValidationQuality(q);
    assert.equal(r.status, 'failed'); assert.ok(r.failures.some(s => /actual P1 slot-0 receipt/.test(s)));
    assert.equal(r.biologicalOnlineBrier, null); assert.equal(r.physicalOnlineBrier, null);
    assert.equal(r.relativeBiologicalImprovement, null); assert.equal(r.independentIngestions, 0); assert.deepEqual(r.biologicalRows, []);
  }
});

test('quality issuance, submission and swallow clocks must match P1 exactly even when individually plausible', () => {
  for (const mutate of [
    q => { q.biological[0].predictedAt = 9; },
    q => { q.biological[0].submittedAt = 10.25; },
    q => { q.biological[0].swallowedAt = 11.25; q.biological[0].followedThroughAt = 611.25; },
    q => { for (const p of q.physical.filter(p => p.runId === 'P1-fresh-prefix')) p.predictedAt = 9; },
    q => { for (const p of q.physical.filter(p => p.runId === 'P1-fresh-prefix')) { p.submittedAt = 10.25; p.receiptProof.submittedAt = 10.25; } },
    q => { for (const p of q.physical.filter(p => p.runId === 'P1-fresh-prefix')) { p.completedAt = 11.25; p.receiptProof.completedAt = 11.25; } },
  ]) {
    const q = syntheticQuality(); mutate(q); const r = aggregateValidationQuality(q);
    assert.equal(r.status, 'failed'); assert.ok(r.failures.some(s => /actual P1 slot-0 receipt/.test(s)));
    assert.equal(r.biologicalOnlineBrier, null); assert.equal(r.physicalOnlineBrier, null);
  }
});

test('quality cannot use a missing, failed or non-swallow P1 receipt, or fabricate the sensor new-exposure label', () => {
  for (const [field, value, expected] of [
    ['targetId', null, 'unavailable'], ['ingestionId', null, 'unavailable'], ['completionCode', null, 'unavailable'],
    ['completionOk', false, 'failed'], ['completionCode', 'NOT_SWALLOWED', 'failed'],
    ['targetId', 'object:999', 'failed'], ['ingestionId', 'ingestion:999', 'failed'],
  ]) {
    const q = syntheticQuality();
    for (const p of q.physical.filter(p => p.runId === 'P1-fresh-prefix')) p.receiptProof[field] = value;
    const r = aggregateValidationQuality(q); assert.equal(r.status, expected); assert.equal(r.biologicalOnlineBrier, null); assert.equal(r.independentIngestions, 0);
  }
  for (const indicator of ['exposure', 'success']) {
    const q = syntheticQuality(), cell = q.physical.find(p => p.runId === 'P1-fresh-prefix' && p.indicator === indicator);
    cell.outcome = 0; cell.sensorLabel = false;
    const r = aggregateValidationQuality(q); assert.equal(r.status, 'unavailable'); assert.equal(r.biologicalOnlineBrier, null);
  }
  const missing = syntheticQuality(); missing.physical = missing.physical.filter(p => p.runId !== 'P1-fresh-prefix');
  assert.equal(aggregateValidationQuality(missing).status, 'unavailable');
});

test('quality rejects duplicates, copied/replay/berry rows, changed receipts and changed issued forecasts', () => {
  for (const mutate of [q => q.physical.push(clone(q.physical[0])), q => { q.physical[2].origin = 'inherited'; },
    q => { q.physical[2].evidenceClass = 'factual-replay'; }, q => { q.physical[2].runId = 'B1-small-exhausted'; },
    q => { q.physical[2].receiptProof.actionId++; }, q => { q.physical[2].online = .1; },
    q => { q.biological[0].sourceRunId = 'C1-early-inspect'; }, q => { q.biological[0].channels.F.event.effect = 'discomfort'; }]) {
    const q = syntheticQuality(); mutate(q); const r = aggregateValidationQuality(q); assert.equal(r.status, 'failed'); assert.equal(r.physicalOnlineBrier, null);
  }
});

test('missing/unknown/censored cells or incomplete controls never become a subset score or zero', () => {
  for (const mutate of [q => q.physical.pop(), q => { q.physical[2].outcome = null; }, q => { q.physical[2].onlineKnown = false; },
    q => { q.physical[2].censored = true; }, q => { q.biological[0].followedThroughAt = 610.99; },
    q => { q.biological[0].continuous = false; }, q => { q.biological[0].proofsRetained = false; }, q => q.biological.push(clone(q.biological[0])),
    q => { q.census.pop(); }]) {
    const q = syntheticQuality(); mutate(q); const r = aggregateValidationQuality(q); assert.equal(r.status, 'unavailable');
    assert.equal(r.biologicalOnlineBrier, null); assert.equal(r.physicalOnlineBrier, null); assert.equal(r.relativeBiologicalImprovement, null);
  }
  const absent = syntheticQuality(); delete absent.biological[0].channels.H.eventAt;
  assert.equal(aggregateValidationQuality(absent).status, 'failed');
});

test('biological prospective clock/horizon/proof checks and frozen zero denominator are strict', () => {
  for (const mutate of [r => { r.predictedAt = 10.1; }, r => { r.predictedAt = 5; }, r => { r.ingestionId = r.trainingIngestionId; },
    r => { r.horizonSeconds = 601; }, r => { r.channels.F.eventAt = 11; }, r => { r.channels.F.eventAt = 611.01; },
    r => { r.channels.F.proof.sourceSeq = 2; }, r => { r.channels.F.proof.ingestionId = 'ingestion:3'; }]) {
    const q = syntheticQuality(); mutate(q.biological[0]); assert.equal(aggregateValidationQuality(q).status, 'failed');
  }
  const q = syntheticQuality(); q.biological[0].channels.F.frozen = 1; q.biological[0].forecasts.frozen.channels.F.probability = 1;
  const zero = aggregateValidationQuality(q); assert.equal(zero.status, 'unavailable'); assert.equal(zero.relativeBiologicalImprovement, null);
});

test('20 percent biological and .02 absolute physical thresholds are unchanged', () => {
  const bad = syntheticQuality(); bad.biological[0].channels.F.online = .1; bad.biological[0].forecasts.online.channels.F.probability = .1;
  assert.equal(aggregateValidationQuality(bad).status, 'failed');
  for (const [degradation, expected] of [[.019, 'passed'], [.021, 'failed']]) {
    const q = syntheticQuality();
    for (const p of q.physical.filter(p => p.required)) {
      p.online = p.outcome ? 1 - Math.sqrt(degradation) : Math.sqrt(degradation); p.forecastSupport.online.mean = p.online;
    }
    const r = aggregateValidationQuality(q); assert.equal(r.status, expected); assert.ok(Math.abs(r.physicalDegradation - degradation) < 1e-12);
  }
});

test('schedule comparison reports immediate mismatches and missing due callbacks, not timestamp normalization', () => {
  const first = syntheticEvent(1, 20, 1), second = syntheticEvent(2, 30, 2);
  const bindings = [{ ingestionId: 'ingestion:1', objectId: 'object:2', actionId: 1, swallowedAt: 1 }, { ingestionId: 'ingestion:2', objectId: 'object:2', actionId: 2, swallowedAt: 11 }];
  const input = { reference: [first, second], actual: [clone(first)], throughAt: 20, bindings };
  assert.equal(compareOldMealSchedules(input).status, 'pending');
  assert.equal(compareOldMealSchedules({ ...input, throughAt: 30 }).status, 'unavailable');
  const changed = clone(input); changed.actual[0].thirst = 'easing'; assert.equal(compareOldMealSchedules(changed).status, 'unavailable');
  assert.equal(compareOldMealSchedules({ ...input, actual: [first, second], throughAt: 90, referenceComplete: true, actualComplete: true }).status, 'passed');
  assert.equal(compareOldMealSchedules({ ...input, actual: [first, first] }).status, 'failed');
  assert.equal(compareOldMealSchedules({ ...input, actual: [second, first], throughAt: 90 }).status, 'failed');
});

test('source-order replay checks full original state and dispatch order, and counts no examples', () => {
  const events = [syntheticEvent(1, 20), syntheticEvent(2, 30)], state = { synthetic: true, model: { row: [1, 2] }, sensor: { admitted: 3 }, ledger: { owner: 2 } };
  const q = { events, referenceState: state, chronological: { dispatchOrder: [[20, 1], [30, 2]], finalState: clone(state) },
    duplicated: { dispatchOrder: [[20, 1], [20, 1], [30, 2], [30, 2]], finalState: clone(state) }, reordered: { dispatchOrder: [[20, 1], [30, 2]], finalState: clone(state) } };
  assert.equal(assessSourceOrderReplay(q).status, 'passed'); assert.equal(assessSourceOrderReplay(q).independentExamples, 0);
  const order = clone(q); order.reordered.dispatchOrder.reverse(); assert.equal(assessSourceOrderReplay(order).status, 'unavailable');
  const wrong = clone(q); wrong.duplicated.finalState.ledger.owner = 3; assert.equal(assessSourceOrderReplay(wrong).status, 'failed');
  assert.equal(assessSourceOrderReplay().status, 'failed');
});

test('partial guard option checks one known attribution case without declaring all cases complete', () => {
  const action = syntheticAction(VALIDATION_PHYSICAL_PLAN.find(p => p.runId === 'C1-early-inspect'));
  const f = { D: { F: 0, W: 0, H: 0 }, usedD: { F: 0, W: 0, H: 0 }, durationSeconds: 1,
    physical: { features: action.online.features, T: { known: true, mean: 1 }, E: { known: true, mean: .1 } } };
  const c = { runId: action.runId, actionId: 2, operation: action.operation, submittedAt: 10, completedAt: 11, queryAt: 12,
    prospective: false, featuresHash: action.featuresHash, sourceReceiptRef: 'a'.repeat(64), before: { online: f, frozen: clone(f) },
    after: { online: clone(f), frozen: clone(f) }, pending: { online: { B: { F: .3, W: 0 } } } };
  assert.equal(assessOldMealAttribution([c]).status, 'unavailable');
  const partial = assessOldMealAttribution([c], { partial: true }); assert.equal(partial.status, 'passed'); assert.equal(partial.complete, false);
  const bad = clone(c); bad.after.online.D.F = null; assert.notEqual(assessOldMealAttribution([bad], { partial: true }).status, 'passed');
});

test('missing harm/release/admission/control evidence never defaults to a pass', () => {
  for (const assess of [assessDelayedHarm, assessReleaseComparisons]) assert.equal(assess([]).status, 'unavailable');
  assert.equal(assessChannelAdmission({}).status, 'unavailable');
  assert.notEqual(assessSmallPortion({}).status, 'passed');
});

function syntheticHarm() {
  const fixedQuery = { appearance: syntheticAction().online.features.appearance, digestion: 'settled', ageSeconds: 0, horizonSeconds: 600,
    reported: { F: false, W: false, H: false }, censored: { F: false, W: false, H: false }, exactSupport: { F: true, W: false, H: false } };
  const f = probability => ({ channels: { H: { probability } } });
  return { synthetic: true, runId: 'H1-chronological', ingestionId: 'ingestion:2', objectId: 'object:2', swallowedAt: 11, harmAt: 70,
    proof: { benefitEvent: syntheticEvent(1, 30), harmEvent: syntheticEvent(2, 70, 2, 'discomfort'), retained: true, admittedH: 1 },
    fixedQuery, groupQuery: { ...clone(fixedQuery), exactSupport: { F: false, W: false, H: false } }, fixedQueryHashBefore: hash(fixedQuery), fixedQueryHashAfter: hash(fixedQuery),
    onlineBefore: f(.1), onlineAfter: f(.3), groupBefore: f(.2), groupAfter: f(.3), pendingAfter: { channels: { H: { active: false, probability: 0 } } },
    maskSnapshot: { at: 71, ready: true, ordinary: true, candidates: [{ action: { type: 'wait', seconds: 5 } }] },
    unrelated: ['wait', 'inspect_object'].map(operation => ({ operation, forecast: { D: { H: 0 } } })) };
}
test('delayed harm requires own earlier benefit, unchanged new-exposure query, strict increase and exact safety mask', () => {
  const good = syntheticHarm(); assert.equal(assessDelayedHarm([good], { partial: true }).status, 'passed');
  for (const mutate of [c => { c.proof.benefitEvent.ingestionId = 'ingestion:1'; }, c => { c.proof.benefitEvent.at = 70; },
    c => { c.onlineAfter.channels.H.probability = .1; }, c => { c.groupAfter.channels.H.probability = .19; },
    c => { c.fixedQuery.reported.H = true; }, c => { c.maskSnapshot.candidates.push({ action: { type: 'sample', targetId: 'object:2' } }); },
    c => { c.unrelated[0].forecast.D.H = .01; }, c => { c.pendingAfter.channels.H.active = true; }, c => { c.groupQuery.digestion = 'empty'; }]) {
    const c = syntheticHarm(); mutate(c); assert.equal(assessDelayedHarm([c], { partial: true }).status, 'failed');
  }
  const h2 = syntheticHarm(); h2.runId = 'H2-reopen'; h2.handling = { reopenedAt: 61, beforeHash: 'a'.repeat(64), afterHash: 'a'.repeat(64) };
  assert.equal(assessDelayedHarm([h2], { partial: true }).status, 'passed');
  h2.handling.reopenedAt = 70; assert.equal(assessDelayedHarm([h2], { partial: true }).status, 'unavailable');
  const h3 = syntheticHarm(); h3.runId = 'H3-operation-at-H'; h3.handling = { submittedAt: 67, completedAt: 72 };
  assert.equal(assessDelayedHarm([h3], { partial: true }).status, 'passed');
  h3.handling.completedAt = 70; assert.equal(assessDelayedHarm([h3], { partial: true }).status, 'unavailable');
});

function syntheticRelease() {
  const f = utility => ({ scorable: true, utility, D: { F: 0, W: 0, H: 0 }, usedD: { F: 0, W: 0, H: 0 },
    physical: { effects: { released: { known: true, mean: 1 } }, conditional: { capacity: { effects: { released: { known: true, mean: 1 } } } } } });
  return { synthetic: true, runId: 'H1-chronological', queryAt: 30,
    receipt: { at: 10, completedAt: 11, request: { type: 'release', targetId: 'object:2' }, outcome: { ok: true, actionId: 4 } },
    beforeStock: { held: ['object:2'], freeSlots: 0 }, afterStock: { held: [], freeSlots: 1 }, selectionDraws: [.5, .5, .5, .5],
    root: { ready: true, candidates: ['release', 'inspect_object'].map(type => ({ action: { type, targetId: 'object:2' } })) },
    release: { online: f(-.01), frozen: f(-.01) }, inspect: { online: f(-.02), frozen: f(-.02) } };
}
test('release uses actual held/slot effect, known learned released marginals and complete comparison', () => {
  assert.equal(assessReleaseComparisons([syntheticRelease()], { partial: true }).status, 'passed');
  for (const mutate of [c => { c.afterStock.freeSlots = 2; }, c => { c.afterStock.held = ['object:2']; },
    c => { c.release.online.physical.conditional.capacity.effects.released.mean = .9; }, c => { c.release.online.utility = -.03; },
    c => { c.inspect.online.D.F = .1; }]) {
    const c = syntheticRelease(); mutate(c); assert.equal(assessReleaseComparisons([c], { partial: true }).status, 'failed');
  }
  const c = syntheticRelease(); c.release.frozen.physical.effects.released.known = false;
  assert.equal(assessReleaseComparisons([c], { partial: true }).status, 'unavailable');
});

function syntheticAdmission() {
  const appearance = syntheticAction().online.features.appearance, tuple = ['shape', 'color', 'texture', 'motion', 'size', 'smell'].map(k => appearance[k]);
  const keys = [JSON.stringify(['e']), JSON.stringify(['em', tuple]), JSON.stringify(['ed', tuple, 'settled'])];
  const cells = () => Array.from({ length: 3 }, () => Array.from({ length: 4 }, () => ({ events: 0, riskSeconds: 0 })));
  const exposures = [1, 2].map(i => ({ id: `ingestion:${i}`, objectId: 'object:2', actionId: i, seq: i, at: i,
    appearance, body: { digestion: 'settled' }, admitted: 0, censored: 0, channelProof: {}, riskThroughAt: [i, i, i] }));
  const before = { sensor: { exposures, events: [] }, memory: { ingestions: exposures.map(e => ({ ...e, channels: 0, creditBlocked: false })) },
    model: { keys, rows: keys.map((_, key) => ({ key, type: 'exposure', cells: cells() })) }, admission: {} };
  const after = clone(before); after.sensor.exposures[1].admitted = 1; after.sensor.exposures[1].channelProof[0] = { sourceSeq: 1, at: 30 };
  after.memory.ingestions[1].channels = 1; after.memory.ingestions[1].channelProof[0] = { sourceSeq: 1, at: 30 };
  after.sensor.events.push({ sourceSeq: 1, at: 30, ingestionId: 'ingestion:2', objectId: 'object:2', actionId: 2, channels: 1 });
  for (const row of after.model.rows) row.cells[0][0].events++;
  const numericalUpdates = [{ ingestionId: 'ingestion:2', update: { increments: [{ channel: 'F', bin: 0, riskSeconds: 28, events: 1, censored: 0 }] } }];
  return { synthetic: true, event: syntheticEvent(1, 30), at: 30, before, after, numericalUpdates };
}
test('channel admission permits pooled-row updates once but rejects sibling labels and duplicate events', () => {
  const good = syntheticAdmission(); assert.equal(assessChannelAdmission(good).status, 'passed');
  for (const mutate of [c => { c.after.sensor.exposures[0].admitted = 1; }, c => { c.after.memory.ingestions[0].channels = 1; },
    c => { c.after.sensor.events.push(clone(c.after.sensor.events[0])); }, c => { c.after.model.rows[0].cells[0][0].events++; },
    c => { c.numericalUpdates[0].ingestionId = 'ingestion:1'; }, c => { c.after.sensor.exposures[0].riskThroughAt[0] = 31; },
    c => { c.after.model.rows.push({ type: 'physical', key: 9 }); }]) {
    const c = syntheticAdmission(); mutate(c); assert.equal(assessChannelAdmission(c).status, 'failed');
  }
  assert.deepEqual(good, syntheticAdmission());
});

test('a genuine no-noticeable-change callback supplies no F/W/H label and is not a missing-F failure', () => {
  const c = syntheticAdmission(); c.event.effect = 'no noticeable change'; c.after = clone(c.before); c.numericalUpdates = [];
  const r = assessChannelAdmission(c); assert.equal(r.status, 'passed'); assert.equal(r.admittedChannels, 0);
  c.after.model.rows[0].cells[0][0].events++;
  assert.equal(assessChannelAdmission(c).status, 'failed');
});

function syntheticBramble() {
  const portion = (id, at, submittedAt, transferredGrams, remainingGrams) => ({ ingestionId: `ingestion:${id}`, actionId: id, materialId: 'object:2', swallowedAt: at, transferredGrams, remainingGrams,
    receipt: { at: submittedAt, completedAt: at, request: { type: 'sample', targetId: 'object:2' }, outcome: { actionId: id, ingestionId: `ingestion:${id}`, code: 'SWALLOWED', ok: true } } });
  return { synthetic: true, runId: 'B1-small-exhausted', evidenceClass: 'physical-advancement', clusterId: 'bramble-control', materialId: 'object:2', naturalInitialGrams: 35,
    sourceKind: 'bramble', stockEdited: false, portions: [portion(1, 10, 9, 30, 5), portion(2, 72, 71, 5, 0)], exhaustedFromWorld: true, exhaustedFromInventory: true,
    nextMask: { ready: true, candidates: [{ action: { type: 'wait' } }] }, continuous: true, proofsRetained: true, followedThroughAt: 672, channels: { F: null, W: null, H: null } };
}
test('separate natural small portion can produce no F; exhaustion, horizon and no third swallow remain explicit', () => {
  const good = assessSmallPortion(syntheticBramble()); assert.equal(good.status, 'passed'); assert.equal(good.appleQualityWeight, 0); assert.equal(good.finalPortionFRequired, false);
  for (const mutate of [e => { e.naturalInitialGrams = 36; }, e => { e.portions[0].remainingGrams = 4; }, e => { e.portions[1].transferredGrams = 0; },
    e => { e.portions[1].receipt.at = 65; }, e => { e.nextMask.candidates.push({ action: { type: 'sample', targetId: 'object:2' } }); }]) {
    const e = syntheticBramble(); mutate(e); assert.equal(assessSmallPortion(e).status, 'failed');
  }
  const censored = syntheticBramble(); censored.followedThroughAt = 671.99; assert.equal(assessSmallPortion(censored).status, 'unavailable');
  const omitted = syntheticBramble(); delete omitted.channels.H; assert.equal(assessSmallPortion(omitted).status, 'unavailable');
});
