/** Pure preregistered increment-A evidence checks. No simulation or training. */
import { TEMPORAL_OPERATIONS } from "../../src/temporal-returns.js";
export const REUSABLE_GATES = Object.freeze({ version: 1, nuisanceQueries: 16,
  forecastIncrease: .05, rankMargin: .05, invarianceTolerance: 1e-9,
  qualityImprovement: .20, physicalDegradation: .02, horizonSeconds: 600,
  actorBytes: 1024 * 1024, p95ExclusiveMs: 50, returnedDecisionMs: 1000,
  wallSeconds: 300 });
const finite = n => Number.isFinite(n);
const probability = n => finite(n) && n >= 0 && n <= 1;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const id = (v, prefix) => typeof v === 'string' && new RegExp(`^${prefix}:[1-9]\\d{0,8}$`).test(v);
const hash = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const selectedAction = a => a && typeof a === 'object' && !Array.isArray(a) &&
  TEMPORAL_OPERATIONS.includes(a.type) &&
  (a.targetId === undefined || id(a.targetId, 'object'));
const support = v => v && ['F', 'W', 'H'].every(k => typeof v[k] === 'boolean');
const mean = values => values.reduce((sum, n) => sum + n, 0) / values.length;
const result = (failures, unavailable = [], values = {}) => ({
  status: failures.length ? 'failed' : unavailable.length ? 'unavailable' : 'passed',
  passed: !failures.length && !unavailable.length, failures, unavailable, ...values,
});

/** Sixteen sensitivity queries are ONE earned-update example, never 16 outcomes. */
export function assessSameMaterialReuse(evidence) {
  const failures = [], unavailable = [], g = REUSABLE_GATES;
  if (!evidence || !Array.isArray(evidence.queries) || evidence.queries.length !== g.nuisanceQueries)
    return result(['Exactly sixteen preregistered nuisance queries are required.']);
  const proof = evidence.proof;
  if (!proof || proof.channel !== 'F' || !id(proof.materialId, 'object') || !id(proof.ingestionId, 'ingestion') ||
      !Number.isSafeInteger(proof.actionId) || proof.actionId < 1 ||
      !finite(proof.swallowedAt) || !finite(proof.feedbackAt) ||
      proof.feedbackAt <= proof.swallowedAt || proof.feedbackAt - proof.swallowedAt >= 180)
    failures.push('The cold fixture requires an exact genuine F report before exposure age 180 seconds.');
  if (evidence.priorFoodEvents !== 0) failures.push('The cold fixture must contain no prior F events.');
  if (!(finite(evidence.durationSeconds) && evidence.durationSeconds > 0 && evidence.durationSeconds <= 30))
    failures.push('The actual exposure-creating command must finish within thirty seconds.');
  if (evidence.remainingMaterialId !== proof?.materialId || evidence.transformed !== false)
    failures.push('Reuse must concern the exact unchanged remaining material.');
  if (evidence.remainingObserved !== true || evidence.sampleEligible !== true || evidence.comparisonEligible !== true)
    unavailable.push('A currently observed eligible same-item and comparison opportunity is missing.');
  if (evidence.remainingFinitePortion !== true) unavailable.push('The real finite material has no remaining eligible portion.');
  if (!hash(evidence.frozenParametersBefore) || !hash(evidence.frozenParametersAfter) ||
      evidence.frozenParametersBefore !== evidence.frozenParametersAfter)
    failures.push('The matched frozen predictor parameters changed.');
  if (!support(evidence.supportOnline) || !support(evidence.supportFrozen) || evidence.supportOnline.F !== true ||
      !same(evidence.supportOnline, evidence.supportFrozen))
    failures.push('Online and frozen comparisons received different factual support.');
  const increases = [], margins = [];
  for (const [index, q] of evidence.queries.entries()) {
    if (!q || !['beforeSelected', 'afterSelected', 'frozenSelectedBefore', 'frozenSelectedAfter'].every(k => selectedAction(q[k])) ||
        q.selectionMode !== 'exploitation' || !Array.isArray(q.selectionDraws) || q.selectionDraws.length !== 4 ||
        q.selectionDraws.some(v => !finite(v) || v < 0 || v >= 1) || q.selectionDraws[1] < .2 || !same(q.selectionDraws, evidence.queries[0]?.selectionDraws)) {
      failures.push(`Query ${index} lacks explicit exploitation selection provenance.`); continue;
    }
    const values = [q.beforeFood, q.afterFood, q.frozenBeforeFood, q.frozenAfterFood,
      q.beforeSampleUtility, q.beforeComparisonUtility, q.afterSampleUtility, q.afterComparisonUtility];
    if (values.some(v => !finite(v))) { failures.push(`Query ${index} has unavailable/nonfinite predictions.`); continue; }
    increases.push(q.afterFood - q.beforeFood);
    margins.push(q.afterSampleUtility - q.afterComparisonUtility);
    if (q.afterFood - q.beforeFood < g.forecastIncrease - g.invarianceTolerance)
      failures.push(`Query ${index} failed the frozen 0.05 forecast increase.`);
    if (Math.abs(q.frozenAfterFood - q.frozenBeforeFood) > g.invarianceTolerance ||
        !same(q.frozenSelectedBefore, q.frozenSelectedAfter))
      failures.push(`Query ${index} changed the frozen numerical prediction or choice.`);
    if (q.maskChanged !== false || q.rngChanged !== false || q.modelMutated !== false) failures.push(`Query ${index} lacks unchanged masks, RNG or prediction parameters.`);
  }
  if (increases.length === g.nuisanceQueries) {
    for (const field of ['beforeFood', 'afterFood', 'beforeSampleUtility', 'afterSampleUtility']) {
      const values = evidence.queries.map(q => q[field]);
      if (Math.max(...values) - Math.min(...values) > g.invarianceTolerance)
        failures.push(`Nuisance queries changed ${field}.`);
    }
  }
  const isTargetSample = a => a?.type === 'sample' && a.targetId === evidence.remainingMaterialId;
  if (!evidence.queries.some(q => !isTargetSample(q.beforeSelected) &&
      isTargetSample(q.afterSelected) &&
      q.afterSampleUtility - q.afterComparisonUtility >= g.rankMargin - g.invarianceTolerance &&
      q.beforeSampleUtility <= q.beforeComparisonUtility))
    failures.push('No genuine same-snapshot exploitation preference changed with the required margin.');
  return result(failures, unavailable, { independentEarnedExamples: 1,
    sensitivityQueries: evidence.queries.length, forecastIncreases: increases, utilityMargins: margins });
}

/** Positive outcomes may resolve early; no-event labels require a full horizon.
 * The input rows are later ingestions, never queries or the training ingestion. */
export function assessLaterPredictionQuality({ biological, physical }) {
  const failures = [], unavailable = [], g = REUSABLE_GATES;
  if (!Array.isArray(biological) || !biological.length || !Array.isArray(physical) || !physical.length)
    return result([], ['Later-ingestion and resolved physical prediction observations are required.']);
  const online = [], frozen = [], rows = [], independent = new Set();
  for (const row of biological) {
    if (!row || !id(row.ingestionId, 'ingestion') || !id(row.trainingIngestionId, 'ingestion') ||
        row.ingestionId === row.trainingIngestionId || !id(row.materialId, 'object') ||
        row.trainingMaterialId !== row.materialId || !finite(row.trainingFeedbackAt) || row.trainingFeedbackAt < 0 ||
        !finite(row.swallowedAt) || !finite(row.predictedAt) || row.predictedAt > row.swallowedAt ||
        row.predictedAt <= row.trainingFeedbackAt || row.swallowedAt <= row.trainingFeedbackAt ||
        row.horizonSeconds !== g.horizonSeconds) { failures.push('Invalid later-ingestion prediction provenance.'); continue; }
    if (independent.has(row.ingestionId)) { failures.push('A later ingestion was counted more than once.'); continue; }
    independent.add(row.ingestionId);
    const scores = [];
    for (const c of ['F', 'W', 'H']) {
      const p = row.channels?.[c];
      if (!p || !probability(p.online) || !probability(p.frozen)) { unavailable.push(`Missing ${c} probability for ${row.ingestionId}.`); continue; }
      let outcome;
      if (p.eventAt !== null && p.eventAt !== undefined) {
        if (!finite(p.eventAt) || p.eventAt <= row.swallowedAt || p.eventAt > row.swallowedAt + g.horizonSeconds)
          { failures.push('Outcome timestamp is outside its declared ingestion horizon.'); continue; }
        outcome = 1;
      } else if (row.continuous === true && finite(row.followedThroughAt) && row.followedThroughAt >= row.swallowedAt + g.horizonSeconds) outcome = 0;
      else { unavailable.push(`Right-censored ${c} outcome for ${row.ingestionId}.`); continue; }
      const a = (p.online - outcome) ** 2, b = (p.frozen - outcome) ** 2;
      online.push(a); frozen.push(b); scores.push({ channel: c, outcome, onlineBrier: a, frozenBrier: b });
    }
    rows.push({ ingestionId: row.ingestionId, materialId: row.materialId, scores });
  }
  const physicalOnline = [], physicalFrozen = [], physicalIds = new Set();
  for (const row of physical) {
    if (!row || !probability(row.online) || !probability(row.frozen) || ![0, 1].includes(row.outcome) ||
        !finite(row.predictedAt) || !finite(row.completedAt) || row.predictedAt > row.completedAt ||
        !Number.isSafeInteger(row.actionId) || row.actionId < 1 ||
        !['unchanged', 'held', 'released', 'output', 'exposure', 'route', 'success', 'failure', 'refused', 'interrupted'].includes(row.indicator)) {
      unavailable.push('An unresolved or unsupported physical outcome cannot supply a Brier label.'); continue;
    }
    const physicalId = `${row.actionId}:${row.indicator}`;
    if (physicalIds.has(physicalId)) { failures.push('A physical action/indicator was counted more than once.'); continue; }
    physicalIds.add(physicalId);
    physicalOnline.push((row.online - row.outcome) ** 2);
    physicalFrozen.push((row.frozen - row.outcome) ** 2);
  }
  const values = { biologicalRows: rows, independentIngestions: independent.size,
    materialClusters: new Set(biological.map(r => r.materialId)).size,
    biologicalOnlineBrier: online.length ? mean(online) : null,
    biologicalFrozenBrier: frozen.length ? mean(frozen) : null,
    physicalOnlineBrier: physicalOnline.length ? mean(physicalOnline) : null,
    physicalFrozenBrier: physicalFrozen.length ? mean(physicalFrozen) : null };
  if (online.length !== biological.length * 3 || !physicalOnline.length) unavailable.push('Required prediction categories are not fully observed.');
  if (values.biologicalFrozenBrier === 0) unavailable.push('The frozen biological-error denominator is zero.');
  if (!unavailable.length && !failures.length) {
    values.relativeBiologicalImprovement = 1 - values.biologicalOnlineBrier / values.biologicalFrozenBrier;
    values.physicalDegradation = values.physicalOnlineBrier - values.physicalFrozenBrier;
    if (values.relativeBiologicalImprovement < g.qualityImprovement) failures.push('Later-ingestion Brier improvement is below 20%.');
    if (values.physicalDegradation > g.physicalDegradation) failures.push('Resolved physical Brier degradation exceeds 0.02.');
  }
  return result(failures, unavailable, values);
}

export function checkPredictionRuntime({ returnedDecisionMs, wallSeconds, actorBytes }) {
  const failures = [];
  if (!finite(returnedDecisionMs) || returnedDecisionMs < 0 || returnedDecisionMs > REUSABLE_GATES.returnedDecisionMs) failures.push('Returned added-decision ceiling exceeded or unavailable.');
  if (!finite(wallSeconds) || wallSeconds < 0 || wallSeconds > REUSABLE_GATES.wallSeconds) failures.push('Fixture wall-time ceiling exceeded or unavailable.');
  if (!Number.isSafeInteger(actorBytes) || actorBytes < 0 || actorBytes > REUSABLE_GATES.actorBytes) failures.push('Whole encoded actor budget exceeded or unavailable.');
  return result(failures);
}
