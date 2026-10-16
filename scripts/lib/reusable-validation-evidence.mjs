/** Frozen-protocol accounting only. No fixture construction, world tick or training.
 * Every argument is owner evidence, never an observation offered to an agent.
 */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual as same } from 'node:util';
import { REUSABLE_GATES } from './reusable-prediction-gates.mjs';

const copy = value => structuredClone(value);
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const finite = value => Number.isFinite(value) && value >= 0;
const positive = value => Number.isSafeInteger(value) && value > 0 && value <= 1e9;
const probability = value => finite(value) && value <= 1;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const realId = (value, prefix) => typeof value === 'string' && new RegExp(`^${prefix}:[1-9]\\d{0,9}$`).test(value) && positive(Number(value.slice(prefix.length + 1)));
const result = (failures = [], unavailable = [], values = {}, pending = false) => ({
  status: failures.length ? 'failed' : unavailable.length ? 'unavailable' : pending ? 'pending' : 'passed',
  passed: !failures.length && !unavailable.length && !pending, failures, unavailable, ...values,
});
const CHANNELS = freeze(['F', 'W', 'H']);
const STATUSES = freeze(['success', 'failure', 'refused', 'interrupted']);
export const VALIDATION_INDICATORS = freeze(['unchanged', 'held', 'released', 'output', 'exposure', 'route', ...STATUSES]);
const matrix = excluded => ({ required: VALIDATION_INDICATORS.filter(x => !excluded.includes(x)), excluded });
export const PHYSICAL_MATRIX = freeze({
  sample: matrix(['unchanged']), inspect_object: matrix(['unchanged']), strike: matrix(['unchanged']), release: matrix(['unchanged']),
  grasp: matrix(['unchanged', 'output']), wait: matrix(['unchanged', 'held']),
});
export const VALIDATION_PROTOCOL = freeze({
  version: 1, protocolSha256: '6932769d221eb7ba33958dee5d48fb9d8cb9294a7f409157824a1cd2de834423',
  maxRuns: 16, maxActions: 50, qualityReceipts: 38, mandatoryPhysicalCells: 323,
  structuralUnknownCells: 57, biologicalIngestions: 1, biologicalChannels: CHANNELS,
  horizonSeconds: REUSABLE_GATES.horizonSeconds, qualityImprovement: REUSABLE_GATES.qualityImprovement,
  physicalDegradation: REUSABLE_GATES.physicalDegradation, tolerance: REUSABLE_GATES.invarianceTolerance,
  flags: { continuingAllowed: false, autonomy: false, mainPromotion: false, originalResourceAdmissionPassed: false, terminal: false },
});
const definitions = [
  ['T0-common-apple', 'new-apple', ['pull', 'inspect_object', 'strike', 'release', 'grasp', 'wait', 'sample', 'wait', 'wait']],
  ['P1-fresh-prefix', 'A0', ['sample']],
  ...[['C1-early-inspect', 'inspect_object'], ['C2-early-wait', 'wait'], ['C3-early-strike', 'strike'], ['C4-early-release', 'release'],
    ['C5-late-release', 'release'], ['C6-late-strike', 'strike'], ['C7-late-wait', 'wait'], ['C8-late-inspect', 'inspect_object']].map(([id, op]) => [id, 'A1', [op, 'wait']]),
  ...['H1-chronological', 'H2-reopen', 'H3-operation-at-H', 'H4-competing-duplicate'].map(id => [id, 'A0', ['sample', 'release', 'grasp', 'inspect_object', 'wait', ...(id === 'H3-operation-at-H' ? ['wait'] : [])]]),
  ['B1-small-exhausted', 'new-bramble', ['pull', 'sample', 'sample']],
  ['Q1-fresh-followup', 'A1', []],
];
export const VALIDATION_CENSUS = freeze(definitions.map(([runId, parent, operations], index) => ({
  order: index + 1, runId, parent, requires: index ? [definitions[index - 1][0]] : [],
  clusterId: runId.startsWith('B1-') ? 'bramble-control' : 'apple-common-history',
  physicalHistory: runId.startsWith('C') || runId.startsWith('Q1') ? 'P1-A1' : runId.startsWith('H') ? 'T0-A0-aged-handling' : runId,
  actions: operations.map((operation, slot) => ({ slot, operation, seconds: operation === 'wait' ? 5 : null,
    quality: /^(P1|C[1-8]|H[1-4])-/.test(runId),
    mandatoryIndicators: /^(P1|C[1-8]|H[1-4])-/.test(runId) ? PHYSICAL_MATRIX[operation].required : [],
    structuralUnknownIndicators: /^(P1|C[1-8]|H[1-4])-/.test(runId) ? PHYSICAL_MATRIX[operation].excluded : [] })),
})));
export const VALIDATION_PHYSICAL_PLAN = freeze(VALIDATION_CENSUS.flatMap(run => run.actions.filter(a => a.quality).map(a => ({ runId: run.runId, clusterId: run.clusterId, ...a }))));
const planned = (runId, slot) => VALIDATION_PHYSICAL_PLAN.find(p => p.runId === runId && p.slot === slot);
const runPlan = runId => VALIDATION_CENSUS.find(p => p.runId === runId);
export const validationEvidenceKey = (runId, actionId, indicator) => JSON.stringify([runId, actionId, indicator]);

/** Complete census, including explicit absent metrics for never-started runs.
 * An external supervisor supplies actual statuses; this helper never runs a case.
 */
export function createValidationCensus(records = []) {
  if (!Array.isArray(records)) throw new TypeError('Census records must be an array.');
  const map = new Map();
  for (const r of records) {
    if (!runPlan(r?.runId) || map.has(r.runId) || !['not-started', 'running', 'passed', 'failed', 'unavailable', 'censored', 'blocked'].includes(r.status))
      throw new TypeError('Invalid, duplicate or undeclared census entry.');
    map.set(r.runId, r);
  }
  let blocker = null, prior = null;
  return VALIDATION_CENSUS.map(p => {
    const r = map.get(p.runId);
    if (blocker && r && !['blocked', 'not-started'].includes(r.status)) throw new TypeError('A run started after the required predecessor stopped.');
    if (r && !['not-started', 'blocked'].includes(r.status) && prior && prior.status !== 'passed') throw new TypeError('Run order or dependency violation.');
    const status = blocker ? 'blocked' : r?.status ?? 'not-started';
    const started = !['not-started', 'blocked'].includes(status);
    if (r?.started !== undefined && r.started !== started) throw new TypeError('Census start flag contradicts status.');
    const row = { ...copy(r || {}), ...copy(p), runId: p.runId, status, started,
      blocker: blocker ? copy(blocker) : null, metrics: started ? copy(r?.metrics ?? null) : null };
    if (['failed', 'unavailable', 'censored', 'blocked'].includes(status) && !blocker)
      blocker = { runId: p.runId, status, reason: r?.reason ?? 'Required evidence unavailable.' };
    prior = row; return row;
  });
}
export function assessValidationCensus(records) {
  let census;
  try { census = createValidationCensus(records); } catch (e) { return result([e.message]); }
  const failure = census.find(r => ['failed', 'unavailable', 'censored', 'blocked'].includes(r.status));
  return result(failure?.status === 'failed' ? [`${failure.runId}: ${failure.reason ?? 'failed'}`] : [],
    failure && failure.status !== 'failed' ? [`${failure.runId}: ${failure.reason ?? failure.status}`] : [],
    { census, completedRuns: census.filter(r => r.status === 'passed').length, ...VALIDATION_PROTOCOL.flags }, !failure && census.some(r => r.status !== 'passed'));
}

/** raw online/frozen values are unmodified predictPhysical outputs. */
export function assessPairedPhysicalForecast(input = {}) {
  const failures = [], unavailable = [], p = planned(input.runId, input.slot), cells = [];
  if (!p || p.operation !== input.operation) return result(['Undeclared post-freeze action slot.'], [], { cells });
  if (!finite(input.predictedAt) || !hash(input.featuresHash) || !input.online?.features || !input.frozen?.features ||
      digest(input.online.features) !== input.featuresHash || digest(input.frozen.features) !== input.featuresHash ||
      input.online.features.operation !== p.operation) failures.push('Missing or unequal saved prospective features/time.');
  for (const indicator of VALIDATION_INDICATORS) {
    const required = p.mandatoryIndicators.includes(indicator), section = STATUSES.includes(indicator) ? 'completion' : 'effects';
    const a = input.online?.[section]?.[indicator], b = input.frozen?.[section]?.[indicator];
    const resolved = a?.known === true && b?.known === true && probability(a.mean) && probability(b.mean);
    if (required && !resolved) unavailable.push(`Missing paired ${indicator} forecast before ${input.runId}/${input.slot}.`);
    cells.push({ runId: input.runId, slot: input.slot, operation: input.operation, clusterId: p.clusterId,
      indicator, required, predictedAt: input.predictedAt ?? null, featuresHash: input.featuresHash ?? null,
      online: a?.mean ?? null, frozen: b?.mean ?? null, onlineKnown: a?.known === true, frozenKnown: b?.known === true,
      forecastSupport: { online: copy(a ?? null), frozen: copy(b ?? null) },
      labelState: required ? 'not-observed' : 'structural-unknown', outcome: null });
  }
  return result(failures, unavailable, { cells, mandatoryCells: p.mandatoryIndicators.length, structuralUnknownCells: p.structuralUnknownIndicators.length });
}

/** receipt is the real ledger receipt; receiptUpdate is the real sensor output.
 * This function does not reconstruct effects from result codes or absence.
 */
export function assessPhysicalCompletion(input = {}) {
  const forecast = assessPairedPhysicalForecast(input), failures = [...forecast.failures], unavailable = [...forecast.unavailable];
  const r = input.receipt, u = input.receiptUpdate;
  if (!positive(input.actionId) || !positive(r?.seq) || r?.outcome?.actionId !== input.actionId || r?.request?.type !== input.operation ||
      !finite(input.submittedAt) || !finite(input.completedAt) || input.predictedAt > input.submittedAt || input.submittedAt > input.completedAt ||
      r?.at !== input.submittedAt || r?.completedAt !== input.completedAt || input.completedAt - input.submittedAt > 30)
    failures.push('Physical receipt ID, operation or prospective timing mismatch.');
  if (!u) unavailable.push('Actual sensor receipt labels are missing.');
  else if (u.sequence !== r?.seq || u.at !== input.completedAt || !same(u.features, input.online?.features) ||
      u.durationSeconds !== input.completedAt - input.submittedAt) failures.push('Sensor labels are not bound to this real receipt and saved features.');
  if (u && !STATUSES.includes(u.completion)) unavailable.push('The mandatory completion status is unresolved.');
  if (STATUSES.includes(u?.completion) && r?.outcome && (u.completion === 'success') !== (r.outcome.ok === true)) failures.push('Sensor completion status contradicts the real receipt.');
  const cells = forecast.cells.map(cell => {
    const label = STATUSES.includes(cell.indicator) ? STATUSES.includes(u?.completion) ? u.completion === cell.indicator : null : u?.effects?.[cell.indicator];
    if (cell.required && typeof label !== 'boolean') unavailable.push(`Missing actual ${cell.indicator} label at completion.`);
    if (!cell.required && label !== null && label !== undefined) failures.push(`Structurally excluded ${cell.indicator} unexpectedly resolved.`);
    return { ...cell, actionId: input.actionId ?? null, evidenceClass: 'physical-advancement', origin: 'new-action',
      submittedAt: input.submittedAt ?? null, completedAt: input.completedAt ?? null, sensorSequence: u?.sequence ?? null,
      outcome: cell.required && typeof label === 'boolean' ? Number(label) : null,
      sensorLabel: cell.required && typeof label === 'boolean' ? label : null,
      labelState: !cell.required ? 'structural-unknown' : typeof label === 'boolean' ? 'resolved' : 'unknown',
      receiptProof: r ? { seq: r.seq, actionId: r.outcome?.actionId ?? null, operation: r.request?.type,
        targetId: r.request?.targetId ?? null, ingestionId: r.outcome?.ingestionId ?? null,
        completionOk: r.outcome?.ok ?? null, completionCode: r.outcome?.code ?? null,
        submittedAt: r.at, completedAt: r.completedAt } : null };
  });
  return result(failures, unavailable, { cells, mandatoryCells: forecast.mandatoryCells, structuralUnknownCells: forecast.structuralUnknownCells });
}

const channelsFor = event => (event?.effect === 'sustained' ? 1 : 0) | (event?.thirst === 'easing' ? 2 : 0) | (event?.effect === 'discomfort' ? 4 : 0);
function validEvent(event) {
  return realId(event?.id, 'feedback') && realId(event?.ingestionId, 'ingestion') && realId(event?.objectId, 'object') &&
    positive(event?.actionId) && finite(event?.at) && event?.provenance === 'sampled' &&
    (event.sourceSeq === undefined || event.sourceSeq === Number(event.id.slice(9)));
}
function checkedEvents(events, bindings, failures) {
  if (!Array.isArray(events)) { failures.push('Missing exact callback list.'); return []; }
  let previous = null; const ids = new Set();
  for (const e of events) {
    const seq = Number(e?.id?.slice?.(9));
    if (!validEvent(e) || ids.has(e?.id) || previous && (e.at < previous.at || seq <= Number(previous.id.slice(9)))) failures.push('Invalid, duplicate or out-of-order authoritative event.');
    if (Array.isArray(bindings) && !bindings.some(b => b?.ingestionId === e?.ingestionId && b?.objectId === e?.objectId && b?.actionId === e?.actionId && finite(b?.swallowedAt) && e?.at > b.swallowedAt)) failures.push('Old-meal callback lacks its exact ingestion binding.');
    ids.add(e?.id); previous = e;
  }
  return events.filter(validEvent); // Invalid entries already make the assessment fail.
}
/** Compare as each callback arrives; a missing due event is known at throughAt.
 * Do not include owner-local unrelated-action IDs in these biological records.
 */
export function compareOldMealSchedules({ reference, actual, throughAt, referenceComplete = false, actualComplete = false, bindings } = {}) {
  const failures = [], unavailable = [];
  if (!finite(throughAt) || !Array.isArray(bindings) || bindings.length !== 2 || bindings.some(b => !realId(b?.ingestionId, 'ingestion')) || new Set(bindings.map(b => b.ingestionId)).size !== 2)
    return result(['Missing exact two-ingestion schedule boundary/bindings.']);
  const ref = checkedEvents(reference, bindings, failures), rows = checkedEvents(actual, bindings, failures);
  const a = ref.filter(e => e.at <= throughAt), b = rows.filter(e => e.at <= throughAt);
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (!same(a[i], b[i])) unavailable.push(`Old-meal schedule mismatch at callback ${i}.`);
  if (a.length !== b.length) unavailable.push('An authoritative old-meal callback is missing or additional at the current boundary.');
  return result(failures, unavailable, { matchedEvents: Math.min(a.length, b.length), throughAt, independentMaterialExamples: 0 }, !(referenceComplete && actualComplete));
}

/** Exactly one genuinely new P1 swallow, followed only in Q1; no pooled copies. */
function biologicalScores(rows, failures, unavailable) {
  if (!Array.isArray(rows) || rows.length !== 1) { unavailable.push('Exactly one held-out apple ingestion is required.'); return null; }
  const r = rows[0];
  if (!r || r.runId !== 'Q1-fresh-followup' || r.sourceRunId !== 'P1-fresh-prefix' || r.evidenceClass !== 'physical-advancement' ||
      r.origin !== 'new-ingestion' || r.clusterId !== 'apple-common-history' || !realId(r.ingestionId, 'ingestion') ||
      !realId(r.trainingIngestionId, 'ingestion') || r.ingestionId === r.trainingIngestionId || !realId(r.materialId, 'object') ||
      r.trainingMaterialId !== r.materialId || !positive(r.actionId) || !finite(r.trainingFeedbackAt) || !finite(r.predictedAt) ||
      !finite(r.submittedAt) || !finite(r.swallowedAt) || r.predictedAt <= r.trainingFeedbackAt || r.predictedAt > r.submittedAt ||
      r.submittedAt >= r.swallowedAt || r.horizonSeconds !== 600) { failures.push('Invalid prospective later-ingestion lineage, identity or timing.'); return null; }
  if (r.continuous !== true || r.proofsRetained !== true || !finite(r.followedThroughAt) || r.followedThroughAt < r.swallowedAt + 600 || r.censored === true)
    unavailable.push('The sole biological quality horizon is incomplete, censored or lacks retained proofs.');
  const scores = [];
  for (const c of CHANNELS) {
    const p = r.channels?.[c];
    if (!p || !probability(p.online) || !probability(p.frozen) || p.censored === true) { unavailable.push(`Missing or censored ${c} probability/outcome.`); continue; }
    for (const arm of ['online', 'frozen']) {
      const f = r.forecasts?.[arm], channel = f?.channels?.[c];
      if (!f || f.ageSeconds !== 0 || f.horizonSeconds !== 600 || channel?.probability !== p[arm] || !Array.isArray(channel?.unknownBins) ||
          typeof channel?.unsupported !== 'boolean' || !Array.isArray(channel?.rates) || !same(channel?.epistemicRange, [0, 1]))
        unavailable.push(`Missing or changed original ${arm}/${c} exposure forecast and uncertainty metadata.`);
    }
    let outcome;
    if (p.eventAt === null) {
      if (p.event != null || p.proof != null) { failures.push(`A ${c} no-event label contradicts its retained event/proof.`); continue; }
      if (r.continuous !== true || r.proofsRetained !== true || !finite(r.followedThroughAt) || r.followedThroughAt < r.swallowedAt + 600) { unavailable.push(`Unresolved ${c} horizon zero.`); continue; }
      outcome = 0;
    } else {
      const proof = p.proof, event = p.event;
      if (!finite(p.eventAt) || p.eventAt <= r.swallowedAt || p.eventAt > r.swallowedAt + 600 || !positive(proof?.sourceSeq) ||
          proof?.at !== p.eventAt || proof?.ingestionId !== r.ingestionId || proof?.objectId !== r.materialId || proof?.actionId !== r.actionId ||
          !validEvent(event) || Number(event.id.slice(9)) !== proof.sourceSeq || event.at !== p.eventAt || event.ingestionId !== r.ingestionId ||
          event.objectId !== r.materialId || event.actionId !== r.actionId || !(channelsFor(event) & (1 << CHANNELS.indexOf(c)))) {
        failures.push(`Invalid ${c} event identity/time proof.`); continue;
      }
      outcome = 1;
    }
    scores.push({ runId: r.runId, sourceRunId: r.sourceRunId, ingestionId: r.ingestionId, materialId: r.materialId, clusterId: r.clusterId,
      channel: c, outcome, onlineBrier: (p.online - outcome) ** 2, frozenBrier: (p.frozen - outcome) ** 2 });
  }
  return scores.length === 3 ? scores : null;
}

/** Same row-wise Brier equations as assessLaterPredictionQuality, with immutable
 * operation coverage and collision-safe keys; never combine IDs by remapping.
 * No formal metrics exist until every run/control and every cell is complete.
 */
export function aggregateValidationQuality({ biological, physical, census } = {}) {
  const failures = [], unavailable = [], seen = new Set(), slots = new Map(), scored = [];
  const censusResult = assessValidationCensus(census ?? []);
  if (censusResult.status !== 'passed') unavailable.push('The declared controls/census are not all passed.');
  let biology = biologicalScores(biological, failures, unavailable);
  if (!Array.isArray(physical)) unavailable.push('Missing complete prospective physical coverage.');
  for (const row of Array.isArray(physical) ? physical : []) {
    const p = planned(row?.runId, row?.slot), key = validationEvidenceKey(row?.runId, row?.actionId, row?.indicator);
    if (!p || p.operation !== row.operation || row.evidenceClass !== 'physical-advancement' || row.origin !== 'new-action' || row.clusterId !== p.clusterId ||
        !VALIDATION_INDICATORS.includes(row.indicator) || !positive(row.actionId)) { failures.push('An inherited, replay, control or undeclared physical row entered apple quality.'); continue; }
    if (seen.has(key)) { failures.push('Duplicate real run/action/indicator evidence.'); continue; } seen.add(key);
    const slotKey = JSON.stringify([row.runId, row.slot]);
    if (!slots.has(slotKey)) slots.set(slotKey, { actionId: row.actionId, indicators: new Set(), row });
    const slot = slots.get(slotKey);
    if (slot.actionId !== row.actionId || slot.indicators.has(row.indicator)) failures.push('Multiple receipts or repeated indicators occupy one declared slot.');
    if (['featuresHash', 'predictedAt', 'submittedAt', 'completedAt', 'sensorSequence'].some(k => slot.row[k] !== row[k]) || !same(slot.row.receiptProof, row.receiptProof))
      failures.push('Cells of one receipt disagree on their prospective issuance or actual completion.');
    slot.indicators.add(row.indicator);
    const required = p.mandatoryIndicators.includes(row.indicator), proof = row.receiptProof;
    if (row.required !== required || !finite(row.predictedAt) || !finite(row.submittedAt) || !finite(row.completedAt) ||
        row.predictedAt > row.submittedAt || row.submittedAt > row.completedAt || row.completedAt - row.submittedAt > 30 || !hash(row.featuresHash) ||
        !positive(row.sensorSequence) || proof?.seq !== row.sensorSequence || proof?.actionId !== row.actionId || proof?.operation !== row.operation ||
        proof?.submittedAt !== row.submittedAt || proof?.completedAt !== row.completedAt) failures.push('Invalid physical label provenance or mandatory-cell classification.');
    if (!required) {
      if (row.labelState !== 'structural-unknown' || row.outcome !== null || row.sensorLabel !== null) failures.push('A structural unknown was converted into a quality label.');
      continue;
    }
    if (row.onlineKnown !== true || row.frozenKnown !== true || !probability(row.online) || !probability(row.frozen) ||
        ![0, 1].includes(row.outcome) || row.labelState !== 'resolved' || row.censored === true) {
      unavailable.push(`Unresolved mandatory cell ${key}.`); continue;
    }
    if (row.forecastSupport?.online?.mean !== row.online || row.forecastSupport?.frozen?.mean !== row.frozen ||
        row.forecastSupport?.online?.known !== true || row.forecastSupport?.frozen?.known !== true) failures.push('Scored probabilities differ from their retained issued forecasts.');
    if (typeof row.sensorLabel !== 'boolean' || Number(row.sensorLabel) !== row.outcome) failures.push('Scored physical label differs from its retained sensor Boolean.');
    scored.push({ ...row, onlineBrier: (row.online - row.outcome) ** 2, frozenBrier: (row.frozen - row.outcome) ** 2 });
  }
  for (const p of VALIDATION_PHYSICAL_PLAN) {
    const slot = slots.get(JSON.stringify([p.runId, p.slot]));
    if (!slot || VALIDATION_INDICATORS.some(i => !slot.indicators.has(i))) unavailable.push(`Incomplete visible coverage for ${p.runId}/${p.slot}.`);
  }
  for (const run of VALIDATION_CENSUS) {
    const receipts = run.actions.filter(a => a.quality).map(a => slots.get(JSON.stringify([run.runId, a.slot]))?.row).filter(Boolean);
    for (let i = 1; i < receipts.length; i++) if (receipts[i].submittedAt < receipts[i - 1].completedAt || receipts[i].sensorSequence <= receipts[i - 1].sensorSequence)
      failures.push('Branch-local physical receipts violate the declared sequential clock/order.');
  }
  // The quality ingestion is the exact new P1 sample, not merely an internally
  // consistent biological record. Bind to the retained actual P1 slot-0 receipt
  // and its sensor labels before exposing any held-out scores or ingestion count.
  const p1 = slots.get(JSON.stringify(['P1-fresh-prefix', 0]))?.row, swallow = p1?.receiptProof;
  const later = Array.isArray(biological) && biological.length === 1 ? biological[0] : null;
  const p1Labels = scored.filter(r => r.runId === 'P1-fresh-prefix' && r.slot === 0);
  if (!p1 || !realId(swallow?.targetId, 'object') || !realId(swallow?.ingestionId, 'ingestion') ||
      typeof swallow?.completionOk !== 'boolean' || typeof swallow?.completionCode !== 'string') {
    unavailable.push('Missing retained P1 slot-0 physical swallow binding.'); biology = null;
  } else if (swallow.completionOk !== true || swallow.completionCode !== 'SWALLOWED' || swallow.operation !== 'sample') {
    failures.push('The held-out quality source is not an actual successful P1 sample swallow.'); biology = null;
  } else if (later && (later.sourceRunId !== p1.runId || later.actionId !== p1.actionId || later.actionId !== swallow.actionId ||
      later.ingestionId !== swallow.ingestionId || later.materialId !== swallow.targetId || later.predictedAt !== p1.predictedAt ||
      later.submittedAt !== p1.submittedAt || later.submittedAt !== swallow.submittedAt ||
      later.swallowedAt !== p1.completedAt || later.swallowedAt !== swallow.completedAt)) {
    failures.push('Biological quality identity or issuance/swallow times do not match the actual P1 slot-0 receipt.'); biology = null;
  }
  if (!['exposure', 'success'].every(indicator => p1Labels.some(r => r.indicator === indicator && r.outcome === 1 && r.sensorLabel === true))) {
    unavailable.push('The P1 physical sensor must prove both successful completion and a new exposure.'); biology = null;
  }
  if (scored.length !== 323 || slots.size !== 38) unavailable.push('The mandatory 38-receipt/323-cell physical denominator is incomplete.');
  const values = { expectedPhysicalReceipts: 38, expectedPhysicalCells: 323, observedPhysicalReceipts: slots.size, resolvedPhysicalCells: scored.length,
    structuralUnknownCells: [...slots.values()].reduce((n, s) => n + [...s.indicators].filter(i => PHYSICAL_MATRIX[s.row.operation].excluded.includes(i)).length, 0),
    independentIngestions: biology ? 1 : 0, materialClusters: biology ? 1 : 0, biologicalRows: biology ?? [],
    biologicalOnlineBrier: null, biologicalFrozenBrier: null, physicalOnlineBrier: null, physicalFrozenBrier: null,
    relativeBiologicalImprovement: null, physicalDegradation: null, statusBrier: null, effectBrier: null,
    untestedCategories: ['new-identity', 'distinct-appearance', 'conflicting-population', 'delayed-tail'], ...VALIDATION_PROTOCOL.flags };
  if (!failures.length && !unavailable.length) {
    const mean = (rows, field) => rows.reduce((n, r) => n + r[field], 0) / rows.length;
    values.biologicalOnlineBrier = mean(biology, 'onlineBrier'); values.biologicalFrozenBrier = mean(biology, 'frozenBrier');
    values.physicalOnlineBrier = mean(scored, 'onlineBrier'); values.physicalFrozenBrier = mean(scored, 'frozenBrier');
    for (const [name, rows] of [['statusBrier', scored.filter(r => STATUSES.includes(r.indicator))], ['effectBrier', scored.filter(r => !STATUSES.includes(r.indicator))]])
      values[name] = { cells: rows.length, online: mean(rows, 'onlineBrier'), frozen: mean(rows, 'frozenBrier') };
    if (values.biologicalFrozenBrier === 0) unavailable.push('The frozen biological-error denominator is zero.');
    else {
      values.relativeBiologicalImprovement = 1 - values.biologicalOnlineBrier / values.biologicalFrozenBrier;
      values.physicalDegradation = values.physicalOnlineBrier - values.physicalFrozenBrier;
      if (values.relativeBiologicalImprovement < REUSABLE_GATES.qualityImprovement) failures.push('Later-ingestion Brier improvement is below 20%.');
      if (values.physicalDegradation > REUSABLE_GATES.physicalDegradation) failures.push('Resolved physical Brier degradation exceeds 0.02.');
    }
  }
  return result(failures, unavailable, values);
}

const zero = value => Number.isFinite(value) && Math.abs(value) <= REUSABLE_GATES.invarianceTolerance;
function caseSet(cases, expected, failures, unavailable, partial = false) {
  if (!Array.isArray(cases)) { unavailable.push('Missing declared cases.'); return []; }
  const ids = new Set();
  for (const c of cases) {
    if (!expected.includes(c?.runId) || ids.has(c?.runId)) failures.push('Duplicate or undeclared gate case.');
    ids.add(c?.runId);
  }
  if (!cases.length || !partial && expected.some(id => !ids.has(id))) unavailable.push('Not all declared cases have evidence.');
  return cases.filter(c => c && typeof c === 'object');
}
export function assessOldMealAttribution(cases, { partial = false } = {}) {
  const failures = [], unavailable = [];
  for (const c of caseSet(cases, VALIDATION_CENSUS.filter(r => /^C[1-8]-/.test(r.runId)).map(r => r.runId), failures, unavailable, partial)) {
    if (planned(c?.runId, 0)?.operation !== c?.operation || !positive(c.actionId) || !finite(c.submittedAt) || !finite(c.completedAt) ||
        c.submittedAt >= c.completedAt || !finite(c.queryAt) || c.queryAt < c.completedAt || c.prospective !== false || !hash(c.sourceReceiptRef) || !hash(c.featuresHash))
      failures.push('Invalid experienced-receipt attribution provenance.');
    for (const arm of ['online', 'frozen']) for (const phase of ['before', 'after']) {
      const f = c[phase]?.[arm];
      if (!f || !CHANNELS.every(k => Number.isFinite(f.D?.[k])) || !f.physical?.features || digest(f.physical.features) !== c.featuresHash)
        unavailable.push(`${c.runId} lacks known ${phase}/${arm} D on its original features.`);
    }
    if (!(Number.isFinite(c.pending?.online?.B?.F) && Number.isFinite(c.pending?.online?.B?.W) &&
        (c.pending.online.B.F > 0 || c.pending.online.B.W > 0))) unavailable.push(`${c.runId} lacks the required positive pending F/W baseline.`);
    const f = c.after?.online;
    if (f && CHANNELS.some(k => !zero(f.D?.[k]) || !zero(f.usedD?.[k]))) failures.push(`${c.runId} transfers old-meal biological value into the unrelated action.`);
    if (!f?.physical?.T?.known || !f?.physical?.E?.known || !finite(f.durationSeconds) ||
        !Number.isFinite(f.physical.T.mean) || !Number.isFinite(f.physical.E.mean)) unavailable.push(`${c.runId} lacks separately observed time/work costs.`);
  }
  return result(failures, unavailable, { complete: !partial && !failures.length && !unavailable.length, independentNewMaterialExamples: 0,
    sharedMaterialClusters: !failures.length && !unavailable.length ? 1 : null, bookkeepingCases: Array.isArray(cases) ? cases.length : 0 });
}

export function assessDelayedHarm(cases, { partial = false } = {}) {
  const failures = [], unavailable = [], deltas = [];
  for (const c of caseSet(cases, VALIDATION_CENSUS.filter(r => /^H[1-4]-/.test(r.runId)).map(r => r.runId), failures, unavailable, partial)) {
    const h = c.proof?.harmEvent, b = c.proof?.benefitEvent, q = c.fixedQuery;
    if (!realId(c.ingestionId, 'ingestion') || !realId(c.objectId, 'object') || !finite(c.swallowedAt) || !finite(c.harmAt) ||
        !validEvent(h) || !validEvent(b) || h.ingestionId !== c.ingestionId || b.ingestionId !== c.ingestionId ||
        h.objectId !== c.objectId || b.objectId !== c.objectId || h.actionId !== b.actionId || h.at !== c.harmAt ||
        !(channelsFor(h) & 4) || !(channelsFor(b) & 3) || !(c.swallowedAt < b.at && b.at < h.at && h.at <= c.swallowedAt + 600))
      failures.push('H must follow an earlier own F/W on the exact genuine aged-ingestion binding.');
    if (c.proof?.retained !== true || c.proof?.admittedH !== 1) unavailable.push(`${c.runId} lacks one retained, admitted H proof.`);
    if (!q || q.ageSeconds !== 0 || q.horizonSeconds !== 600 || !CHANNELS.every(k => q.reported?.[k] === false && q.censored?.[k] === false) ||
        !CHANNELS.every(k => typeof q.exactSupport?.[k] === 'boolean') || !['shape', 'color', 'texture', 'motion', 'size', 'smell'].every(k => typeof q.appearance?.[k] === 'string') ||
        !['unknown', 'empty', 'settled', 'full', 'overfull'].includes(q.digestion) ||
        !hash(c.fixedQueryHashBefore) || c.fixedQueryHashBefore !== digest(q) || c.fixedQueryHashBefore !== c.fixedQueryHashAfter)
      failures.push('The pre-H/post-H exposure query is missing or changed.');
    if (!same(c.groupQuery, { ...q, exactSupport: { F: false, W: false, H: false } })) failures.push('The fixed pooled-conflict query is missing or changes unrelated fields.');
    const before = c.onlineBefore?.channels?.H?.probability, after = c.onlineAfter?.channels?.H?.probability;
    const gb = c.groupBefore?.channels?.H?.probability, ga = c.groupAfter?.channels?.H?.probability;
    if (![before, after, gb, ga].every(probability)) unavailable.push('Missing fixed-query H probabilities.');
    else {
      deltas.push({ runId: c.runId, delta: after - before });
      if (!(after > before)) failures.push(`${c.runId} fixed new-exposure H probability did not increase.`);
      if (ga < gb - REUSABLE_GATES.invarianceTolerance) failures.push(`${c.runId} diluted pooled H after harm.`);
    }
    const mask = c.maskSnapshot;
    if (!mask || !Array.isArray(mask.candidates) || mask.ready !== true || mask.ordinary !== true || !finite(mask.at) || mask.at < c.harmAt || mask.at > c.swallowedAt + 600)
      unavailable.push(`${c.runId} lacks the next authoritative scheduled mask.`);
    else if (mask.candidates.some(x => x.action?.type === 'sample' && x.action?.targetId === c.objectId)) failures.push(`${c.runId} permits the forbidden exact-item sample after H.`);
    if (!Array.isArray(c.unrelated) || !['wait', 'inspect_object'].every(op => c.unrelated.some(x => x.operation === op))) unavailable.push('Missing unrelated wait/inspect H projections.');
    for (const x of c.unrelated ?? []) if (!zero(x.forecast?.D?.H)) failures.push('Unrelated operation acquired nonzero or unknown D_H.');
    if (c.pendingAfter?.channels?.H?.active !== false || c.pendingAfter?.channels?.H?.probability !== 0) failures.push('The already reported live H channel must be inactive; it is not the fixed new-exposure query.');
    if (c.runId === 'H2-reopen' && (!finite(c.handling?.reopenedAt) || c.handling.reopenedAt < c.swallowedAt + 50 ||
        c.handling.reopenedAt >= c.swallowedAt + 50 + 1 / 60 + 1e-9 || c.handling.reopenedAt >= c.harmAt ||
        !hash(c.handling.beforeHash) || c.handling.beforeHash !== c.handling.afterHash)) unavailable.push('The declared before-H same-clock reopen is unproved.');
    if (c.runId === 'H3-operation-at-H' && (!finite(c.handling?.submittedAt) || !finite(c.handling?.completedAt) ||
        c.handling.submittedAt < c.swallowedAt + 56 || !(c.handling.submittedAt < c.harmAt && c.harmAt < c.handling.completedAt))) unavailable.push('Genuine H did not occur during the declared unrelated wait.');
  }
  return result(failures, unavailable, { complete: !partial && !failures.length && !unavailable.length, fixedQueryHIncreases: deltas, independentNewMaterialExamples: 0,
    sharedMaterialClusters: !failures.length && !unavailable.length ? 1 : null, handlingCases: Array.isArray(cases) ? cases.length : 0 });
}

export function assessReleaseComparisons(cases, { partial = false } = {}) {
  const failures = [], unavailable = [];
  for (const c of caseSet(cases, VALIDATION_CENSUS.filter(r => /^H[1-4]-/.test(r.runId)).map(r => r.runId), failures, unavailable, partial)) {
    const r = c.receipt, target = r?.request?.targetId, before = c.beforeStock, after = c.afterStock;
    if (!realId(target, 'object') || r?.request?.type !== 'release' || r?.outcome?.ok !== true || !positive(r?.outcome?.actionId) ||
        !finite(r?.at) || !finite(r?.completedAt) || r.completedAt <= r.at || !finite(c.queryAt) || c.queryAt < r.completedAt)
      failures.push('Missing actual completed release receipt.');
    if (!Array.isArray(before?.held) || !Array.isArray(after?.held) || !Number.isSafeInteger(before?.freeSlots) || !Number.isSafeInteger(after?.freeSlots) ||
        !before.held.includes(target) || after.held.includes(target) || after.freeSlots - before.freeSlots !== 1)
      failures.push('Release did not prove removal of the exact held ID and one free slot.');
    if (!same(c.selectionDraws, [.5, .5, .5, .5]) || !Array.isArray(c.root?.candidates) || c.root.ready !== true ||
        !['release', 'inspect_object'].every(op => c.root.candidates.some(x => x.action?.type === op && x.action?.targetId === target))) unavailable.push('Missing matched authoritative release/inspect root.');
    for (const arm of ['online', 'frozen']) {
      const release = c.release?.[arm], inspect = c.inspect?.[arm];
      for (const v of [release?.physical?.effects?.released, release?.physical?.conditional?.capacity?.effects?.released]) {
        if (v?.known !== true || !probability(v.mean)) unavailable.push(`Unknown ${arm} release effect.`);
        else if (Math.abs(v.mean - 1) > REUSABLE_GATES.invarianceTolerance) failures.push('Learned release/capacity released indicator is not one.');
      }
      if (!release?.scorable || !inspect?.scorable || !Number.isFinite(release?.utility) || !Number.isFinite(inspect?.utility)) unavailable.push('Release or inspect is unscorable.');
      else if (release.utility < inspect.utility - REUSABLE_GATES.invarianceTolerance) failures.push('Release ranks below continued nonproductive inspection.');
      for (const f of [release, inspect]) if (!CHANNELS.every(k => zero(f?.D?.[k]) && zero(f?.usedD?.[k]))) failures.push('Old-meal biological value leaked into a handling comparison.');
    }
  }
  return result(failures, unavailable, { complete: !partial && !failures.length && !unavailable.length, comparisons: Array.isArray(cases) ? cases.length : 0,
    independentNewMaterialExamples: 0, sharedMaterialClusters: !failures.length && !unavailable.length ? 1 : null });
}

/** Resolves callback copies only; it never feeds report rows to a live sensor. */
export function assessChannelAdmission({ event, at, before, after, numericalUpdates } = {}) {
  const failures = [], unavailable = [];
  if (!validEvent(event) || at !== event?.at || [before, after].some(s => !Array.isArray(s?.sensor?.exposures) || !Array.isArray(s?.sensor?.events) ||
      !Array.isArray(s?.memory?.ingestions) || !Array.isArray(s?.model?.rows) || !Array.isArray(s?.model?.keys)))
    return result([], ['Missing resolved genuine callback snapshots.']);
  const seq = Number(event.id.slice(9)), prior = before.sensor.exposures?.find(e => e.id === event.ingestionId), next = after.sensor.exposures?.find(e => e.id === event.ingestionId);
  if (!prior || !next || prior.objectId !== event.objectId || next.objectId !== event.objectId || prior.actionId !== event.actionId ||
      next.actionId !== event.actionId || !(prior.at < at)) return result(['Callback exposure binding mismatch.']);
  if (!before.memory.ingestions.some(i => i.id === event.ingestionId && i.objectId === event.objectId && i.actionId === event.actionId) ||
      !after.memory.ingestions.some(i => i.id === event.ingestionId && i.objectId === event.objectId && i.actionId === event.actionId))
    return result(['Missing canonical ledger ingestion for the callback.']);
  const bits = channelsFor(event) & ~prior.admitted;
  if (next.admitted !== (prior.admitted | bits) || next.censored !== prior.censored) failures.push('Exact exposure channel admission/censor mismatch.');
  if (!bits && !same(next.channelProof, prior.channelProof)) failures.push('A no-new-channel callback invented a proof.');
  for (let c = 0; c < 3; c++) if (bits & (1 << c)) {
    if (!same(next.channelProof?.[c], { sourceSeq: seq, at })) failures.push('Missing exact per-ingestion channel proof.');
  }
  for (const old of before.memory.ingestions ?? []) {
    const newer = after.memory.ingestions?.find(i => i.id === old.id);
    if (!newer || ['objectId', 'actionId', 'seq', 'at', 'creditBlocked'].some(k => newer[k] !== old[k])) failures.push('Ledger ingestion binding changed during a callback.');
    if (old.id !== event.ingestionId && (!same(old.channelProof, newer?.channelProof) || old.channels !== newer?.channels)) failures.push('A competing ledger ingestion acquired another exposure event.');
    if (old.id === event.ingestionId && (newer?.channels !== (old.channels | bits) || [0, 1, 2].some(c => bits & (1 << c) && !same(newer.channelProof?.[c], { sourceSeq: seq, at })))) failures.push('Ledger and sensor channel proofs disagree.');
  }
  for (const old of before.sensor.exposures ?? []) if (old.id !== event.ingestionId) {
    const newer = after.sensor.exposures?.find(e => e.id === old.id);
    if (!newer || newer.admitted !== old.admitted || newer.censored !== old.censored || !same(newer.channelProof, old.channelProof)) failures.push('A biological callback changed another ingestion admission or proof.');
    if (!Array.isArray(newer?.riskThroughAt) || newer.riskThroughAt.some((t, i) => !finite(t) || t < old.riskThroughAt[i] || t > at)) failures.push('The competing exposure has an invalid independent risk watermark.');
    if ((after.sensor.events ?? []).filter(e => e.ingestionId === old.id).length !== (before.sensor.events ?? []).filter(e => e.ingestionId === old.id).length) failures.push('A competing ingestion acquired an event.');
  }
  const oldEvents = before.sensor.events ?? [], newEvents = after.sensor.events ?? [];
  if (bits ? newEvents.length !== oldEvents.length + 1 || !same(newEvents.slice(0, -1), oldEvents) ||
      newEvents.at(-1)?.sourceSeq !== seq || newEvents.at(-1)?.ingestionId !== event.ingestionId || newEvents.at(-1)?.channels !== bits : !same(newEvents, oldEvents))
    failures.push('Sensor event identity/count disagrees with the actual newly admitted channels.');
  if (!same(before.model.rows?.filter(r => r.type === 'physical'), after.model.rows?.filter(r => r.type === 'physical'))) failures.push('A biological callback changed physical-head rows.');
  if (!Array.isArray(numericalUpdates)) unavailable.push('Missing exposure-bound numerical updates.');
  else {
    for (let c = 0; c < 3; c++) {
      const updates = numericalUpdates.flatMap(x => (x.update?.increments ?? []).map(i => ({ ...i, ingestionId: x.ingestionId })));
      const own = updates.filter(i => i.channel === CHANNELS[c] && i.ingestionId === event.ingestionId).reduce((n, i) => n + i.events, 0);
      if (own !== Number(Boolean(bits & (1 << c))) || updates.some(i => i.ingestionId !== event.ingestionId && i.events !== 0)) failures.push('Event numerical updates were omitted, duplicated or transferred.');
    }
    const keys = new Set([...before.model.keys ?? [], ...after.model.keys ?? []]);
    const index = model => new Map((model.rows ?? []).filter(r => r.type === 'exposure').map(r => [model.keys[r.key], r]));
    const a = index(before.model), b = index(after.model);
    const appearance = ['shape', 'color', 'texture', 'motion', 'size', 'smell'].map(k => prior.appearance?.[k]);
    const applicable = new Set([JSON.stringify(['e']), JSON.stringify(['em', appearance]), JSON.stringify(['ed', appearance, prior.body?.digestion])]);
    for (const k of keys) if (a.has(k) || b.has(k)) for (let c = 0; c < 3; c++) {
      const count = row => row?.cells?.[c]?.reduce((n, cell) => n + cell.events, 0) ?? 0;
      const expected = applicable.has(k) && bits & (1 << c) ? 1 : 0;
      if (count(b.get(k)) - count(a.get(k)) !== expected) failures.push('Shared numerical hierarchy did not update each applicable event row exactly once.');
    }
    if ([...applicable].some(k => !b.has(k))) unavailable.push('Missing applicable pooled exposure row.');
  }
  return result(failures, unavailable, { sourceSeq: seq, ingestionId: event.ingestionId, admittedChannels: bits });
}

/** Producer performs real copied-consumer replay, this checks full final states. */
export function assessSourceOrderReplay({ events, referenceState, chronological, duplicated, reordered } = {}) {
  const failures = [], unavailable = [];
  const rows = checkedEvents(events, undefined, failures), order = rows.map(e => [e.at, Number(e.id.slice(9))]);
  if (!rows.length || !referenceState) unavailable.push('Missing original callback/reference state evidence.');
  const expectedDuplicate = order.flatMap(x => [x, x]);
  for (const [name, replay, expected] of [['chronological', chronological, order], ['duplicated', duplicated, expectedDuplicate], ['reordered', reordered, order]]) {
    if (!replay?.finalState || !same(replay.dispatchOrder, expected)) unavailable.push(`Missing ${name} full-state replay with original dispatch order.`);
  }
  if (chronological?.finalState && (!same(chronological.finalState, referenceState) || !same(chronological.finalState, duplicated?.finalState) || !same(chronological.finalState, reordered?.finalState))) failures.push('Duplicate or reversed-container replay changed canonical final state.');
  return result(failures, unavailable, { independentExamples: 0, callbacks: rows.length, equalTimeReordering: 'source-sequence-preserved-only' });
}

export function assessSmallPortion(evidence = {}) {
  const failures = [], unavailable = [], e = evidence;
  if (e.runId !== 'B1-small-exhausted' || e.evidenceClass !== 'physical-advancement' || e.clusterId !== 'bramble-control' ||
      !realId(e.materialId, 'object') || e.naturalInitialGrams !== 35 || e.sourceKind !== 'bramble' || e.stockEdited !== false)
    failures.push('Invalid separate natural bramble-control provenance.');
  if (!Array.isArray(e.portions) || e.portions.length !== 2 || e.portions.some(p => !p || typeof p !== 'object')) return result(failures, ['Exactly two genuine finite portions are required.']);
  const [first, second] = e.portions;
  for (const p of e.portions) {
    if (!realId(p.ingestionId, 'ingestion') || !positive(p.actionId) || !finite(p.swallowedAt) || !finite(p.transferredGrams) ||
        !finite(p.remainingGrams) || p.materialId !== e.materialId || p.receipt?.request?.type !== 'sample' || p.receipt?.request?.targetId !== e.materialId ||
        p.receipt?.outcome?.actionId !== p.actionId || p.receipt?.outcome?.ingestionId !== p.ingestionId ||
        p.receipt?.outcome?.code !== 'SWALLOWED' || p.receipt?.outcome?.ok !== true || p.receipt?.completedAt !== p.swallowedAt)
      failures.push('Small-portion transfer lacks exact real swallow provenance.');
  }
  if (first.ingestionId === second.ingestionId || first.actionId === second.actionId || second.swallowedAt <= first.swallowedAt + 60 ||
      !finite(second.receipt?.at) || second.receipt.at < first.swallowedAt + 60 || second.receipt.at > first.swallowedAt + 62 ||
      Math.abs(first.transferredGrams - 30) > 1e-9 || Math.abs(first.remainingGrams - 5) > 1e-9 ||
      !(second.transferredGrams > 0 && second.transferredGrams < 30) || Math.abs(second.remainingGrams) > 1e-9)
    failures.push('The natural 30 g / positive final small portion / exhaustion sequence is not proved.');
  if (e.exhaustedFromWorld !== true || e.exhaustedFromInventory !== true || e.nextMask?.ready !== true || !Array.isArray(e.nextMask?.candidates)) unavailable.push('Missing actual exhausted-stock removal and next scheduled mask.');
  else if (e.nextMask.candidates.some(c => c.action?.type === 'sample' && c.action.targetId === e.materialId)) failures.push('Exhausted material still has a sample opportunity.');
  if (e.continuous !== true || e.proofsRetained !== true || !finite(e.followedThroughAt) || e.followedThroughAt < second.swallowedAt + 600) unavailable.push('The separate small-portion follow-up is censored or incomplete.');
  if (!e.channels || !CHANNELS.every(c => Object.hasOwn(e.channels, c) && (e.channels[c] === null || validEvent(e.channels[c]) &&
      e.channels[c].ingestionId === second.ingestionId && e.channels[c].objectId === e.materialId && e.channels[c].actionId === second.actionId &&
      e.channels[c].at > second.swallowedAt && e.channels[c].at <= second.swallowedAt + 600 && channelsFor(e.channels[c]) & (1 << CHANNELS.indexOf(c))))) unavailable.push('Missing explicit small-portion channel outcomes.');
  return result(failures, unavailable, { appleQualityWeight: 0, independentControlMaterials: !failures.length && !unavailable.length ? 1 : null, finalPortionFRequired: false });
}
