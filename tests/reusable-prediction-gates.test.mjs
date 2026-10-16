import test from 'node:test';
import assert from 'node:assert/strict';
import { assessSameMaterialReuse, assessLaterPredictionQuality, checkPredictionRuntime } from '../scripts/lib/reusable-prediction-gates.mjs';
const copy = x => structuredClone(x);
function reuse() {
  return { proof: { channel: 'F', materialId: 'object:2', ingestionId: 'ingestion:1', actionId: 2, swallowedAt: 10, feedbackAt: 55 },
    priorFoodEvents: 0, durationSeconds: 3.5, remainingMaterialId: 'object:2', transformed: false,
    remainingObserved: true, sampleEligible: true, comparisonEligible: true, remainingFinitePortion: true,
    frozenParametersBefore: 'a'.repeat(64), frozenParametersAfter: 'a'.repeat(64),
    supportOnline: { F: true, W: false, H: false }, supportFrozen: { F: true, W: false, H: false },
    queries: Array.from({ length: 16 }, () => ({ beforeFood: 0, afterFood: .4, frozenBeforeFood: 0, frozenAfterFood: 0,
      beforeSampleUtility: -.01, beforeComparisonUtility: -.005, afterSampleUtility: .19, afterComparisonUtility: -.005,
      beforeSelected: { type: 'wait', seconds: 5 }, afterSelected: { type: 'sample', targetId: 'object:2' },
      frozenSelectedBefore: { type: 'wait', seconds: 5 }, frozenSelectedAfter: { type: 'wait', seconds: 5 },
      selectionMode: 'exploitation', selectionDraws: [.5, .5, .5, .5], maskChanged: false, rngChanged: false, modelMutated: false })) };
}
function quality() {
  return { biological: [{ ingestionId: 'ingestion:2', trainingIngestionId: 'ingestion:1', materialId: 'object:2',
    trainingMaterialId: 'object:2', trainingFeedbackAt: 55,
    predictedAt: 60, swallowedAt: 60, followedThroughAt: 660, horizonSeconds: 600, continuous: true,
    channels: { F: { online: .7, frozen: 0, eventAt: 105 }, W: { online: .7, frozen: 0, eventAt: 110 }, H: { online: 0, frozen: 0, eventAt: null } } }],
    physical: [{ actionId: 5, indicator: 'exposure', predictedAt: 56, completedAt: 60, online: 1, frozen: 1, outcome: 1 }] };
}
test('reuse needs one genuine earned update, sixteen invariant queries and identical factual controls', () => {
  const good = reuse(), result = assessSameMaterialReuse(good);
  assert.equal(result.passed, true); assert.equal(result.independentEarnedExamples, 1);
  assert.deepEqual(good, reuse());
  for (const mutate of [e => { e.queries.pop(); }, e => { e.queries[3].afterFood = .01; },
    e => { e.queries[4].afterFood = .41; }, e => { e.supportFrozen.F = false; },
    e => { e.frozenParametersAfter = 'changed'; }, e => { e.queries[5].modelMutated = true; },
    e => { e.queries.forEach(q => { q.beforeSelected = { type: 'sample', targetId: 'object:2' }; }); }, e => { e.proof.channel = 'W'; },
    e => { e.queries.forEach(q => { q.afterSelected = { type: 'inspect_object', targetId: 'object:2' }; }); },
    e => { e.remainingMaterialId = 'object:3'; }, e => { e.transformed = true; }]) {
    const bad = reuse(); mutate(bad); assert.equal(assessSameMaterialReuse(bad).status, 'failed');
  }
  for (const field of ['frozenParametersBefore', 'supportOnline']) {
    const bad = reuse(); delete bad[field]; assert.equal(assessSameMaterialReuse(bad).status, 'failed');
  }
  for (const key of ['beforeSelected', 'afterSelected', 'frozenSelectedBefore', 'frozenSelectedAfter', 'selectionMode', 'selectionDraws']) {
    const bad = reuse(); bad.queries.forEach(q => { delete q[key]; });
    assert.equal(assessSameMaterialReuse(bad).status, 'failed');
  }
  const exploratory = reuse(); exploratory.queries[0].selectionDraws[1] = .1;
  assert.equal(assessSameMaterialReuse(exploratory).status, 'failed');
  const exploitation = reuse(); exploitation.queries.forEach(q => { q.selectionDraws = [.1,.8,.5,.5]; });
  assert.equal(assessSameMaterialReuse(exploitation).status, 'passed');
  const differing = reuse(); differing.queries[1].selectionDraws[2] = .7;
  assert.equal(assessSameMaterialReuse(differing).status, 'failed');
  const unknown = reuse(); unknown.queries[0].beforeSelected = { type: 'fake' };
  assert.equal(assessSameMaterialReuse(unknown).status, 'failed');
  const absent = reuse(); delete absent.queries[0].modelMutated;
  assert.equal(assessSameMaterialReuse(absent).status, 'failed');
});
test('finite depletion and genuine mask absence are unavailable rather than replaced successes', () => {
  for (const field of ['remainingObserved', 'sampleEligible', 'comparisonEligible', 'remainingFinitePortion']) {
    const e = reuse(); e[field] = false; assert.equal(assessSameMaterialReuse(e).status, 'unavailable');
  }
});
test('quality uses genuinely later ingestions, event-horizon probabilities and resolved physical labels', () => {
  const q = quality(), r = assessLaterPredictionQuality(q);
  assert.equal(r.passed, true); assert.equal(r.independentIngestions, 1); assert.equal(r.materialClusters, 1);
  assert.ok(r.relativeBiologicalImprovement > .2); assert.equal(r.physicalDegradation, 0);
  assert.deepEqual(q, quality());
  const repeated = quality(); repeated.biological.push(copy(repeated.biological[0]));
  assert.equal(assessLaterPredictionQuality(repeated).status, 'failed');
  const training = quality(); training.biological[0].ingestionId = 'ingestion:1';
  assert.equal(assessLaterPredictionQuality(training).status, 'failed');
  const future = quality(); future.biological[0].predictedAt = 106;
  assert.equal(assessLaterPredictionQuality(future).status, 'failed');
  for (const field of ['trainingIngestionId', 'trainingMaterialId', 'trainingFeedbackAt']) {
    const bad = quality(); delete bad.biological[0][field]; assert.equal(assessLaterPredictionQuality(bad).status, 'failed');
  }
  const duplicate = quality(); duplicate.physical.push(copy(duplicate.physical[0]));
  assert.equal(assessLaterPredictionQuality(duplicate).status, 'failed');
});
test('no-event harm needs complete follow-up and frozen-zero error denominator cannot invent improvement', () => {
  const censored = quality(); censored.biological[0].followedThroughAt = 659.99;
  assert.equal(assessLaterPredictionQuality(censored).status, 'unavailable');
  const gap = quality(); gap.biological[0].continuous = false;
  assert.equal(assessLaterPredictionQuality(gap).status, 'unavailable');
  const zero = quality(); zero.biological[0].channels.F.frozen = 1; zero.biological[0].channels.W.frozen = 1;
  assert.equal(assessLaterPredictionQuality(zero).status, 'unavailable');
  const worse = quality(); worse.biological[0].channels.F.online = 0; worse.biological[0].channels.W.online = 0;
  assert.equal(assessLaterPredictionQuality(worse).status, 'failed');
  const cost = quality(); cost.physical[0].online = .5;
  assert.equal(assessLaterPredictionQuality(cost).status, 'failed');
});
test('resource ceilings reject nonfinite, missing, wall overrun and full actor overflow', () => {
  const v = { returnedDecisionMs: 1000, wallSeconds: 300, actorBytes: 1048576 };
  assert.equal(checkPredictionRuntime(v).passed, true);
  for (const [key, value] of [['returnedDecisionMs', 1000.1], ['wallSeconds', 300.1], ['actorBytes', 1048577], ['returnedDecisionMs', NaN], ['wallSeconds', undefined]])
    assert.equal(checkPredictionRuntime({ ...v, [key]: value }).passed, false);
});
