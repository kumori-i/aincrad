import { PROCEDURE_RECEIPT_LIMITS as L, validateLedgers, timing, effort, continuity,
  freeze, time, objectId, ingestionId, bounded, adverseEffect } from './procedure-receipts.js';

// A fresh, bounded projection of one actor's canonical retained records. Never
// cached or persisted. Policy intentionally does not import this module.
const unknown = () => ({ completion: 'unknown', remainingCost: 'unknown',
  futureAdequacy: 'unknown', futureRelief: 'unknown', futureHarm: 'unknown',
  availability: 'unknown', historicalCoverage: 'unknown' });
const identity = e => ({ actionId: e.actionId, experimentId: e.id, at: e.at,
  type: e.primitive, targetId: e.targetId });
const unavailable = reason => freeze({ version: 1, status: 'unavailable', reason, episodes: [] });
function observedStatus(effects) {
  if (effects.some(adverseEffect)) return 'observed-adverse';
  if (effects.some(e => e.hunger === 'easing' || e.energy === 'easing')) return 'observed-relevant-relief';
  return effects.length ? 'observed-other-effect' : 'unresolved';
}
function costs(actions, receipts) {
  const durations = [], handling = [];
  for (const e of actions) {
    const receipt = receipts.get(e.actionId), d = timing(receipt, e.id), h = effort(receipt, e.id);
    if (d) durations.push(d);
    if (h) handling.push(h);
  }
  return { durations, handling,
    observedActionDurationLowerBoundSeconds: durations.reduce((n, d) => n + d.activeActionSeconds, 0),
    observedHandlingDurationLowerBoundSeconds: handling.reduce((n, h) => n + h.activeActionSeconds, 0),
    coverage: 'retained-linked-actions-only', allInCost: 'unknown' };
}
/** No world, physiology, source-stock, technique counters, or lifecycle clock input. */
export function createProcedureExperience(npc) {
  try {
    const now = npc?.elapsed, d = npc?.discovery;
    if (npc?.mode !== 'discovery' || typeof npc.id !== 'string' || !npc.id.length || npc.id.length > 80 || !time(now))
      return unavailable('invalid-actor');
    const receiptsInput = npc?.memory?.experience, experimentsInput = d?.experiments, effectsInput = d?.effects;
    if (!bounded(receiptsInput, L.receipts) || !bounded(experimentsInput, L.experiments) || !bounded(effectsInput, L.effects))
      return unavailable('input-bounds');
    const ledger = validateLedgers({ now, receiptsInput, experimentsInput, effectsInput });
    const { receipts } = ledger;
    // Reject falsey malformed optional identities, not just nonmatching values.
    const experiments = ledger.experiments.filter(e => {
      const r = receipts.get(e.actionId).details.result;
      return (e.materialId === undefined || objectId(e.materialId)) &&
        (e.ingestionId === undefined || ingestionId(e.ingestionId)) &&
        e.materialId === r.materialId && e.ingestionId === r.ingestionId &&
        (e.primitive !== 'grasp' || e.materialId === undefined || e.materialId === e.targetId) &&
        (e.primitive !== 'sample' || !e.ok || ingestionId(e.ingestionId));
    });
    const validActions = new Set(experiments.map(e => e.actionId));
    const proofCounts = new Map();
    for (const e of effectsInput) proofCounts.set(e?.proofEventId, (proofCounts.get(e?.proofEventId) || 0) + 1);
    const effects = ledger.effects.filter(e => e.valid && validActions.has(e.sample.actionId) && proofCounts.get(e.effect.proofEventId) === 1);
    const acquisitions = experiments.filter(e => e.ok && (e.primitive === 'grasp' || e.primitive === 'pull' && objectId(e.materialId)));
    const material = e => e.primitive === 'grasp' ? e.targetId : e.materialId;
    const episodes = acquisitions.map(e => ({ acquisition: identity(e), materialId: material(e), samples: [],
      proofStatus: 'retained-acquisition-only', admissionContext: 'unknown', ...unknown() }));
    const byAcquisition = new Map(acquisitions.map((e, i) => [e.actionId, episodes[i]]));
    for (const sample of experiments.filter(e => e.primitive === 'sample' && e.ok)) {
      // Latest own handling episode wins, never an earlier producer through a
      // later unrelated grasp. Missing intervening receipts leave chain unknown.
      const acquired = acquisitions.filter(e => e.actionId < sample.actionId && e.id < sample.id && e.at <= sample.at && material(e) === sample.targetId).at(-1);
      const intact = acquired && continuity(acquired, sample, receipts);
      let episode = intact ? byAcquisition.get(acquired.actionId) : null;
      if (!episode) {
        episode = { acquisition: null, materialId: sample.targetId, samples: [],
          proofStatus: 'exact-item-only', admissionContext: 'unknown', ...unknown() };
        episodes.push(episode);
      } else episode.proofStatus = 'retained-direct-chain';
      const observedEffects = effects.filter(e => e.sample.actionId === sample.actionId).map(({ effect: e, recognition: r }) => ({
        id: e.id, recognitionId: r.id, effect: e.effect, effectAt: e.at, recognizedAt: r.at,
        sampleToEffectSeconds: e.at - sample.at, sampleToRecognitionSeconds: r.at - sample.at,
        hunger: e.hunger, thirst: e.thirst, energy: e.energy, pain: e.pain,
      })).sort((a, b) => a.recognitionId - b.recognitionId);
      episode.samples.push({ ...identity(sample), ingestionId: sample.ingestionId,
        acquisitionToSampleSeconds: intact ? sample.at - acquired.at : null,
        status: observedStatus(observedEffects), observedEffects,
        // Even positive recognition does not establish completion or adequacy.
        ...unknown() });
    }
    for (const episode of episodes) {
      const ids = new Set([episode.acquisition?.actionId, ...episode.samples.map(e => e.actionId)]);
      episode.observedCost = costs(experiments.filter(e => ids.has(e.actionId)), receipts);
      episode.status = observedStatus(episode.samples.flatMap(e => e.observedEffects));
      episode.observedNeeds = Object.fromEntries(['hunger', 'thirst', 'energy'].map(need => [need,
        episode.samples.flatMap(s => s.observedEffects.map(e => ({ actionId: s.actionId, ingestionId: s.ingestionId,
          recognitionId: e.recognitionId, at: e.recognizedAt, observation: e[need] })))]));
    }
    return freeze({ version: 1, status: 'assessed', actorId: npc.id,
      actorEpoch: Number.isSafeInteger(npc.epoch) ? npc.epoch : null, observedAt: now,
      ownership: 'supplied-actor-canonical-ledger', episodes,
      evidenceGaps: { rejectedExperiments: experimentsInput.length - experiments.length,
        unverifiedEffects: effectsInput.length - effects.length }, ...unknown() });
  } catch { return unavailable('evidence-error'); }
}
