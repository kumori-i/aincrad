/** Owner-scripted Gate 1 producer. Importing this file performs no setup, tick,
 * ingestion, training, or outcome assay. Invoke only after resource admission.
 * Tests inject data-only fixtures; the production factory is never called there.
 */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { lookupEcologyObject } from '../../src/ecology.js';
import { createReusablePredictionFixture, REUSABLE_FIXTURE } from './reusable-prediction-fixture.mjs';
import { assessSameMaterialReuse, REUSABLE_GATES } from './reusable-prediction-gates.mjs';

const copy = value => structuredClone(value);
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const fingerprint = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const objectId = value => typeof value === 'string' && /^object:[1-9]\d{0,8}$/.test(value);
export const sameMaterialHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Frozen before any outcome run. It is a script, never an autonomous policy. */
export const SAME_MATERIAL_ASSAY = freeze({ version: 1, seed: 74193,
  designFingerprint: REUSABLE_FIXTURE.designFingerprint,
  source: 'first positive-quantity apple_tree in the fixed seed',
  approach: 'first collision-valid east, west, north, south offset at 45; require reach and line of sight',
  commands: [ { type: 'pull', target: 'fixed source' }, { type: 'inspect_object', target: 'actual held pull output' }, { type: 'sample', target: 'actual held pull output' },
    { type: 'wait', seconds: 5 }, { type: 'wait', seconds: 5 } ],
  comparisonPreparation: 'one actual held inspection supplies a genuinely cheaper completed comparison; its cost interval closes at sample submission; no biological hint',
  freeze: 'after second wait completes; inspect, sample and first wait intervals must be closed; no F yet',
  feedback: 'first genuine proved F before exposure age 180',
  opportunity: 'first scheduler-ready native scheduled observation after F; current exact held material; no retries of the root set',
  draws: [.5, .5, .5, .5], nuisanceQueries: 16,
  nuisanceFields: ['focus', 'history', 'unrelated old-exposure summary age', 'unrelated old-exposure summary channels'],
  stopping: 'first command/proof/admission failure, absent required opportunity, Gate 1 result, or owner resource stop',
  noAutonomy: true, noPhysicalIntervention: true,
});

/** Query-only counterfactual serialization. No feature, actual exposure, own
 * support, causal relation, transformation, sensation, mask or ordering changes.
 * The synthetic summary is explicitly nuisance context, NEVER sensor evidence.
 */
export function sameMaterialNuisanceQueries(snapshot, materialId) {
  if (!snapshot || !Array.isArray(snapshot.candidates) || !objectId(materialId)) throw new TypeError('An actual immutable root snapshot and exact material are required.');
  return freeze(Array.from({ length: 16 }, (_, index) => {
    const projected = copy(snapshot), bits = [0, 1, 2, 3].map(bit => Boolean(index & (1 << bit)));
    for (const candidate of projected.candidates) {
      const context = candidate.context || {};
      candidate.context = { ...context,
        focus: bits[0] && candidate.action.targetId === materialId,
        history: bits[1] ? [{ operation: 'wait', outcome: 'success' }, { operation: 'inspect_object', outcome: 'unknown' }] : [],
        exposures: [...(context.exposures || []).filter(e => e.scope !== 'other'),
          { scope: 'other', age: bits[2] ? '>600' : '180..600', channels: bits[3] ? 3 : 0, count: 1 }],
      };
      candidate.focus = candidate.context.focus || candidate.context.outputOfFocus === true;
    }
    return { index, nuisance: { focus: bits[0], history: bits[1], unrelatedOldAge: bits[2], unrelatedOldChannels: bits[3] }, snapshot: projected };
  }));
}

const unavailable = reason => ({ status: 'unavailable', passed: false, failures: [], unavailable: [reason] });
function stop(reason, status = 'unavailable', code = 'REUSABLE_ASSAY_UNAVAILABLE') {
  const error = new Error(reason); error.code = code; error.assayStatus = status; throw error;
}
function assertReceipt(receipt, action) {
  if (!receipt || !Number.isSafeInteger(receipt.seq) || !Number.isFinite(receipt.at) ||
      !Number.isFinite(receipt.completedAt) || receipt.completedAt < receipt.at ||
      !isDeepStrictEqual(receipt.request, action) || receipt.outcome?.ok !== true ||
      !Number.isSafeInteger(receipt.outcome.actionId) || receipt.outcome.actionId < 1)
    stop(`The scripted ${action.type} command has no matching successful authoritative receipt.`);
}
function finiteMaterial(fixture, id) {
  const material = lookupEcologyObject(fixture.state.environment.ecology, id);
  return { objectId: id, exists: Boolean(material), massGrams: Number.isFinite(material?.massGrams) ? material.massGrams : null,
    heldBy: material?.heldBy ?? null, held: fixture.npc.inventory.items.includes(id) };
}
function genuineFoodProof(fixture, ingestion) {
  const current = fixture.memory.ingestions.find(i => i.id === ingestion.id), e = fixture.sensor.events.find(e =>
    (e.channels & 1) && e.ingestionId === ingestion.id && e.objectId === ingestion.objectId && e.actionId === ingestion.actionId);
  const p = current?.channelProof?.[0];
  if (!e || !p || current.creditBlocked || fixture.memory.creditBlocked || p.sourceSeq !== e.sourceSeq || p.at !== e.at || !(current.channels & 1)) return null;
  const exposure = fixture.sensor.exposures.find(x => x.id === ingestion.id);
  if (!exposure || !(exposure.admitted & 1) || (exposure.censored & 1) || !isDeepStrictEqual(exposure.channelProof[0], p)) return null;
  return { channel: 'F', materialId: current.objectId, ingestionId: current.id, actionId: current.actionId,
    swallowedAt: current.at, feedbackAt: p.at, sourceSeq: p.sourceSeq, receiptSeq: current.seq,
    sensorEvent: copy(e), channelProof: copy(p), ingestion: copy(current) };
}
function protectionState(fixture) {
  return { state: fixture.state, model: fixture.model, sensor: fixture.sensor, selector: fixture.selector,
    driver: fixture.checkpointDriver(), admission: fixture.admission };
}
function allRng(fixture) {
  return { actor: fixture.npc.rng, selector: fixture.selector.rng, environment: fixture.state.environment.rng ?? null,
    ecology: fixture.state.environment.ecology.rng ?? null };
}
const strongestOther = (snapshot, prediction, targetIndex) => prediction.forecasts
  .map((forecast, index) => ({ index, action: snapshot.candidates[index].action, forecast }))
  .filter(row => row.index !== targetIndex && row.forecast.eligibility === true && row.forecast.scorable === true && Number.isFinite(row.forecast.utility))
  .sort((a, b) => b.forecast.utility - a.forecast.utility || a.index - b.index)[0] || null;

/** Run only when the owner has admitted this physical assay. onBoundary is a
 * synchronous stop/resource hook before and after EVERY native frame and command,
 * and at every prediction boundary. It receives monotonic elapsed milliseconds,
 * latest returned decision time, phase and frame count, plus the live fixture as
 * its second argument for complete-actor accounting. false/{stop:true} stops.
 * No callback is allowed to mutate the fixture. No retry, new seed, or refill.
 * A passed return retains the live online fixture for a separately authorized
 * later-ingestion probe. All results retain the fixture for stop serialization;
 * the caller owns disposal and must not advance a failed/unavailable fixture.
 */
export function runSameMaterialAssay({ sourceFingerprint, onBoundary, onEvent = null, now = () => performance.now(),
  createFixture = createReusablePredictionFixture } = {}) {
  if (!fingerprint(sourceFingerprint)) throw new TypeError('The caller must supply a full verified source fingerprint.');
  if (typeof onBoundary !== 'function') throw new TypeError('An owner resource/stop boundary callback is required.');
  if (typeof now !== 'function' || typeof createFixture !== 'function' || onEvent !== null && typeof onEvent !== 'function') throw new TypeError('Invalid assay dependencies.');
  const started = now(); let previousNow = started, fixture = null, originalStep = null, phase = 'setup', frames = 0, decisionMs = 0, constructionMs = 0;
  if (!Number.isFinite(started)) throw new TypeError('A finite monotonic clock is required.');
  const evidence = { version: 1, sourceFingerprint, designFingerprint: REUSABLE_FIXTURE.designFingerprint,
    protocol: SAME_MATERIAL_ASSAY, protocolFingerprint: sameMaterialHash(SAME_MATERIAL_ASSAY),
    owner: null, receipts: [], physicalMass: [], events: [], queries: [], phases: [], resource: { frames: 0, wallMs: 0, maximumDecisionMs: 0 } };
  const boundary = (kind, detail = {}) => {
    const current = now();
    if (!Number.isFinite(current) || current < previousNow) stop('The resource clock is not monotonic.', 'failed', 'REUSABLE_RESOURCE_CLOCK');
    previousNow = current;
    evidence.resource = { frames, wallMs: current - started, maximumDecisionMs: Math.max(evidence.resource.maximumDecisionMs, decisionMs) };
    if (current - started > REUSABLE_GATES.wallSeconds * 1000 || decisionMs > REUSABLE_GATES.returnedDecisionMs)
      stop('The preregistered wall-time or returned-decision ceiling was exceeded.', 'failed', 'REUSABLE_RUNTIME_LIMIT');
    const response = onBoundary(freeze({ kind, phase, at: fixture?.npc.elapsed ?? null, frames,
      monotonicMs: current, elapsedMs: current - started, returnedDecisionMs: decisionMs, ...detail }), fixture);
    if (response === false || response?.stop === true) stop(response?.reason || 'The owner resource/stop callback stopped this assay.', 'unavailable', 'REUSABLE_OWNER_STOP');
    if (fixture?.diagnosticError) stop(`Diagnostic capture failed: ${fixture.diagnosticError}`, 'failed');
    if (fixture?.admission?.deniedSubmissions || fixture?.admission?.deniedBatches)
      stop('Capacity admission denied a command or numerical update; retained facts do not establish this prediction.', 'unavailable', 'REUSABLE_ASSAY_ADMISSION');
  };
  const setPhase = next => { phase = next; evidence.phases.push({ phase, at: fixture?.npc.elapsed ?? null }); };
  const act = action => {
    boundary('command-before', { action });
    let receipt;
    try { receipt = fixture.act(action); } catch (error) {
      if (error.code === 'REUSABLE_FIXTURE' && /^Scripted action (could not reach|was not submitted|has not physically completed)/.test(error.message)) stop(error.message);
      throw error;
    }
    const prior = evidence.receipts.at(-1); evidence.receipts.push(copy(receipt));
    if (prior && receipt?.at - prior.completedAt < .65 - 1e-9) stop('The scripted command bypassed the genuine .65-second scheduler delay.', 'failed');
    boundary('command-after', { action, receiptSeq: receipt?.seq ?? null }); assertReceipt(receipt, action); return receipt;
  };
  const predict = (snapshot, model, label) => {
    boundary('prediction-before', { label }); const begin = now();
    const prediction = fixture.predict(snapshot, model, { draws: SAME_MATERIAL_ASSAY.draws });
    const predictionMs = now() - begin; decisionMs = predictionMs + (label.startsWith('query-0-') ? constructionMs : 0);
    boundary('prediction-after', { label, predictionMs, constructionMs: label.startsWith('query-0-') ? constructionMs : 0 }); return prediction;
  };
  let result, frozenModel = null, snapshot = null;
  try {
    boundary('setup-before');
    fixture = createFixture({ sourceFingerprint, predictionArm: 'online', sensorEnabled: true, now,
      sink: event => { evidence.events.push(copy(event)); if (onEvent) onEvent(copy(event)); } });
    if (!fixture || fixture.automatic !== false || fixture.predictionArm !== 'online' || fixture.sourceFingerprint !== sourceFingerprint)
      stop('The producer requires the owner-scripted online fixture.', 'failed');
    evidence.owner = copy(fixture.owner);
    if (evidence.owner?.physicalSeed !== SAME_MATERIAL_ASSAY.seed || !objectId(evidence.owner?.sourceId)) stop('The fixed owner setup is unavailable.');
    originalStep = fixture.step;
    fixture.step = function (dt) { boundary('frame-before'); const value = originalStep.call(this, dt); frames++; boundary('frame-after'); return value; };
    boundary('setup-after');
    if (fixture.sensor.totals[0] !== 0 || fixture.memory.ingestions.length) stop('The fixture is not the preregistered cold start.');
    evidence.priorFoodEvents = fixture.sensor.totals[0];
    setPhase('pull'); const pull = act({ type: 'pull', targetId: evidence.owner.sourceId });
    const materialId = pull.outcome.materialId;
    if (!objectId(materialId) || materialId === evidence.owner.sourceId || !fixture.npc.inventory.items.includes(materialId))
      stop('The actual pull did not create a distinct held material; no replacement is permitted.');
    const beforeMass = finiteMaterial(fixture, materialId); evidence.physicalMass.push({ phase: 'before-sample', at: fixture.npc.elapsed, ...beforeMass });
    if (!beforeMass.exists || !(beforeMass.massGrams > 0) || beforeMass.heldBy !== fixture.npc.id) stop('The real held output has no finite sample portion.');
    setPhase('prepare-comparison'); const inspect = act({ type: 'inspect_object', targetId: materialId });
    setPhase('sample'); const sample = act({ type: 'sample', targetId: materialId });
    const ingestion = fixture.memory.ingestions.find(i => i.seq === sample.seq && i.id === sample.outcome.ingestionId &&
      i.objectId === materialId && i.actionId === sample.outcome.actionId && i.at === sample.completedAt);
    if (sample.outcome.code !== 'SWALLOWED' || !ingestion || ingestion.creditBlocked || fixture.sensor.exposures.length !== 1)
      stop('The one actual sample has no exact canonical swallow and sensor proof.');
    evidence.sampleReceipt = copy(sample); evidence.ingestion = copy(ingestion);
    evidence.durationSeconds = sample.completedAt - sample.at;
    if (!(evidence.durationSeconds > 0 && evidence.durationSeconds <= 30)) stop('The actual sample duration does not meet the frozen assay condition.');
    const afterMass = finiteMaterial(fixture, materialId); evidence.physicalMass.push({ phase: 'after-sample', at: fixture.npc.elapsed, ...afterMass });
    if (!afterMass.exists || !(afterMass.massGrams > 0) || !(afterMass.massGrams < beforeMass.massGrams) || !afterMass.held)
      stop('No genuinely remaining finite portion of the same swallowed material is available.');
    setPhase('close-cost-intervals'); const wait1 = act({ type: 'wait', seconds: 5 }); const wait2 = act({ type: 'wait', seconds: 5 });
    for (const [receipt, successor] of [[inspect, sample], [sample, wait1], [wait1, wait2]]) {
      const sensorReceipt = fixture.sensor.receipts.find(r => r.seq === receipt.seq);
      const interval = fixture.memory.model.transitions.find(t => t.seq === receipt.seq && t.nextSeq === successor.seq && t.endAt === successor.at);
      if (!sensorReceipt?.completed || sensorReceipt.interval !== true || !interval ||
          fixture.model.cursors.interval.sequence < receipt.seq || !Number.isFinite(interval.reward?.[3]) || !Number.isFinite(interval.reward?.[4]))
        stop('The inspect, sample, or first wait physical-cost interval did not close with actual support.');
    }
    if (fixture.sensor.totals[0] !== 0) stop('F arrived before the prescribed physical-model freeze; the cold matched assay is unavailable.');
    setPhase('freeze-pre-feedback'); frozenModel = freeze(copy(fixture.model));
    evidence.frozenAt = fixture.npc.elapsed; evidence.frozenParametersBefore = sameMaterialHash(frozenModel);
    evidence.models = { frozenBefore: copy(frozenModel) };
    boundary('parameters-frozen');
    setPhase('await-genuine-F'); let proof = genuineFoodProof(fixture, ingestion);
    while (!proof && fixture.npc.elapsed < ingestion.at + 180) {
      fixture.step(REUSABLE_FIXTURE.nativeStepSeconds); proof = genuineFoodProof(fixture, ingestion);
    }
    if (!proof || proof.feedbackAt <= ingestion.at || proof.feedbackAt - ingestion.at >= 180)
      stop('No genuine F report before exposure age 180; no replacement ingestion or seed is permitted.');
    evidence.proof = proof;
    setPhase('await-current-observation');
    if (fixture.npc.lifecycle !== 'AWAKE') stop('No awake native post-feedback observation opportunity is available.');
    // No root-set polling or unscheduled perception. Public scheduled observation
    // and scheduler clocks determine the sole post-feedback query instant.
    while (fixture.sensor.observationAt === null || fixture.sensor.observationAt < proof.feedbackAt ||
      fixture.sensor.observationAt !== fixture.npc.elapsed || fixture.npc.elapsed < fixture.npc.nextDecisionAt || fixture.npc.active) {
      fixture.step(REUSABLE_FIXTURE.nativeStepSeconds);
    }
    const rootStateBefore = sameMaterialHash(protectionState(fixture)), rootRngBefore = sameMaterialHash(allRng(fixture));
    boundary('snapshot-before'); const snapshotStart = now(); snapshot = fixture.candidateSnapshot({ draws: SAME_MATERIAL_ASSAY.draws }); constructionMs = now() - snapshotStart; decisionMs = constructionMs;
    boundary('snapshot-after');
    evidence.snapshotStateHashes = { before: rootStateBefore, after: sameMaterialHash(protectionState(fixture)) };
    evidence.snapshotRngHashes = { before: rootRngBefore, after: sameMaterialHash(allRng(fixture)) };
    if (evidence.snapshotStateHashes.before !== evidence.snapshotStateHashes.after || evidence.snapshotRngHashes.before !== evidence.snapshotRngHashes.after)
      stop('Actual root construction changed state or RNG.', 'failed');
    evidence.snapshot = copy(snapshot); evidence.snapshotFingerprint = sameMaterialHash(snapshot);
    evidence.onlineParametersBefore = sameMaterialHash(fixture.model); evidence.models.onlineAfter = copy(fixture.model);
    evidence.physicalParameterHashes = { frozen: sameMaterialHash(frozenModel.rows.filter(r => r.type === 'physical')),
      online: sameMaterialHash(fixture.model.rows.filter(r => r.type === 'physical')) };
    if (evidence.physicalParameterHashes.frozen !== evidence.physicalParameterHashes.online) stop('Physical costs or effects changed after the prescribed matched freeze.', 'failed');
    const exact = snapshot.candidates.findIndex(c => c.action.type === 'sample' && c.action.targetId === materialId && c.eligibility === true);
    const object = snapshot.view.objects.find(o => o.id === materialId), material = fixture.sensor.materials.find(m => m.objectId === materialId);
    const exposure = fixture.sensor.exposures.find(e => e.id === ingestion.id);
    evidence.remainingMaterialId = materialId;
    evidence.remainingObserved = Boolean(object && object.observedAt === fixture.sensor.observationAt && material?.known && material.lastSeenAt === object.observedAt);
    evidence.sampleEligible = snapshot.ready === true && exact >= 0;
    evidence.transformed = !(material && exposure && material.generation === exposure.generation && isDeepStrictEqual(material.appearance, exposure.appearance));
    const remaining = finiteMaterial(fixture, materialId); evidence.physicalMass.push({ phase: 'post-feedback', at: snapshot.at, ...remaining });
    evidence.remainingFinitePortion = remaining.exists && remaining.held && remaining.massGrams > 0;
    if (!evidence.remainingObserved || !evidence.sampleEligible || !evidence.remainingFinitePortion || evidence.transformed)
      stop('The first genuine post-F opportunity lacks an unchanged, observed, eligible exact remaining portion; all native masks are preserved.');
    evidence.supportOnline = copy(snapshot.candidates[exact].exactSupport); evidence.supportFrozen = copy(evidence.supportOnline);
    if (evidence.supportOnline.F !== true) stop('The post-feedback snapshot lacks exact firsthand F support.');
    setPhase('matched-queries');
    const variants = sameMaterialNuisanceQueries(snapshot, materialId);
    for (const variant of variants) {
      const beforeState = sameMaterialHash(protectionState(fixture)), beforeRng = sameMaterialHash(allRng(fixture));
      const queryHash = sameMaterialHash(variant.snapshot), frozenBefore = sameMaterialHash(frozenModel), onlineBefore = sameMaterialHash(fixture.model);
      const before = predict(variant.snapshot, frozenModel, `query-${variant.index}-before`);
      const after = predict(variant.snapshot, fixture.model, `query-${variant.index}-after`);
      const frozenBeforePrediction = predict(variant.snapshot, frozenModel, `query-${variant.index}-frozen-before`);
      const frozenAfterPrediction = predict(variant.snapshot, frozenModel, `query-${variant.index}-frozen-after`);
      const comparisonBefore = strongestOther(variant.snapshot, before, exact), comparisonAfter = strongestOther(variant.snapshot, after, exact);
      evidence.comparisonEligible = Boolean(comparisonBefore && comparisonAfter);
      const selected = prediction => copy(prediction.choice?.selected?.action ?? null);
      const afterState = sameMaterialHash(protectionState(fixture)), afterRng = sameMaterialHash(allRng(fixture));
      const q = { index: variant.index, nuisance: copy(variant.nuisance),
        beforeSelected: selected(before), afterSelected: selected(after), frozenSelectedBefore: selected(frozenBeforePrediction), frozenSelectedAfter: selected(frozenAfterPrediction),
        selectionMode: [before, after, frozenBeforePrediction, frozenAfterPrediction].every(p => p.choice?.exploring === false && p.choice.committedDrawCount === 4 && isDeepStrictEqual(p.choice.draws, SAME_MATERIAL_ASSAY.draws)) ? 'exploitation' : 'unsupported',
        selectionDraws: [...SAME_MATERIAL_ASSAY.draws], beforeFood: before.forecasts[exact].D.F, afterFood: after.forecasts[exact].D.F,
        frozenBeforeFood: frozenBeforePrediction.forecasts[exact].D.F, frozenAfterFood: frozenAfterPrediction.forecasts[exact].D.F,
        beforeSampleUtility: before.forecasts[exact].utility, afterSampleUtility: after.forecasts[exact].utility,
        beforeComparisonUtility: comparisonBefore?.forecast.utility ?? null, afterComparisonUtility: comparisonAfter?.forecast.utility ?? null,
        comparisonBefore: comparisonBefore ? { index: comparisonBefore.index, action: copy(comparisonBefore.action) } : null,
        comparisonAfter: comparisonAfter ? { index: comparisonAfter.index, action: copy(comparisonAfter.action) } : null,
        maskChanged: queryHash !== sameMaterialHash(variant.snapshot), rngChanged: beforeRng !== afterRng,
        modelMutated: frozenBefore !== sameMaterialHash(frozenModel) || onlineBefore !== sameMaterialHash(fixture.model),
        stateHashes: { before: beforeState, after: afterState }, rngHashes: { before: beforeRng, after: afterRng },
        parameterHashes: { before: frozenBefore, after: onlineBefore, frozenAfter: sameMaterialHash(frozenModel), onlineAfter: sameMaterialHash(fixture.model) },
        snapshot: copy(variant.snapshot), forecasts: { before: copy(before), after: copy(after), frozenBefore: copy(frozenBeforePrediction), frozenAfter: copy(frozenAfterPrediction) } };
      evidence.queries.push(q);
      if (!evidence.comparisonEligible || !before.forecasts[exact].scorable || !after.forecasts[exact].scorable)
        stop('The actual eligible root set has no supported same-item/comparison ranking.');
      if (beforeState !== afterState || q.rngChanged || q.modelMutated || q.maskChanged) stop('A pure matched query changed state, RNG, masks, or model parameters.', 'failed');
    }
    evidence.frozenParametersAfter = sameMaterialHash(frozenModel); evidence.onlineParametersAfter = sameMaterialHash(fixture.model);
    setPhase('assess-gate-1'); boundary('gate-before'); result = assessSameMaterialReuse(evidence); boundary('gate-after');
  } catch (error) {
    result = error.assayStatus === 'failed' || !error.assayStatus
      ? { status: 'failed', passed: false, failures: [String(error.message)], unavailable: [] }
      : unavailable(String(error.message));
    evidence.stop = { phase, at: fixture?.npc.elapsed ?? null, code: error.code || 'REUSABLE_ASSAY_ERROR', reason: String(error.message) };
  } finally {
    if (fixture && originalStep) fixture.step = originalStep;
  }
  return { evidence: freeze(copy(evidence)), result: freeze(copy(result)), fixture, continuingAllowed: result.passed,
    frozenModel, snapshot, protocolFingerprint: evidence.protocolFingerprint };
}
