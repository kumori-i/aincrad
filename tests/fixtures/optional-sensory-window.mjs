import { bodySignals } from '../../src/interoception.js';
import { discoveryActionCompletion, successfulDiscoveryActionCompletion } from '../../src/discovery-actions.js';
import { createProcedureExperience } from '../../src/procedure-experience.js';

// Experimental, session-only observation of a personally paid food episode.
// No production policy imports this module. It does not read nutrition, species,
// toxicity, effect tags, authored scores, or another actor's state.
export const OPTIONAL_SENSORY_HORIZON_SECONDS = 120;
export const OPTIONAL_SENSORY_MAX_GAP_SECONDS = .25;
const hunger = ['content', 'peckish', 'hungry', 'ravenous', 'faint with hunger'];
const thirst = ['quenched', 'dry mouth', 'thirsty', 'parched', 'desperate thirst'];
const energy = ['steady', 'waning', 'low', 'depleted'];
const pain = ['none', 'aching', 'hurting', 'severe'];
const usedSamples = new WeakSet();
const windows = new WeakMap();
const tolerance = 1e-8;

function categories(actor) {
  const signals = bodySignals(actor);
  const result = { hunger: signals.hunger, thirst: signals.thirst,
    energy: signals.energy, pain: signals.pain };
  if (hunger.indexOf(result.hunger) < 0 || thirst.indexOf(result.thirst) < 0 ||
      energy.indexOf(result.energy) < 0 || pain.indexOf(result.pain) < 0) return null;
  return result;
}
function cleanCost(episode, acquisitionId, sampleId, acquisitionWork, sampleWork) {
  const rows = episode.observedCost;
  if (rows?.coverage !== 'retained-linked-actions-only' || rows.allInCost !== 'unknown') return null;
  const ids = new Set([acquisitionId, sampleId]);
  const durations = rows.durations.filter(row => ids.has(row.actionId));
  const handling = rows.handling.filter(row => ids.has(row.actionId));
  if (durations.length !== 2 || handling.length !== 2 ||
      new Set(durations.map(row => row.actionId)).size !== 2 ||
      new Set(handling.map(row => row.actionId)).size !== 2) return null;
  for (const [id, work] of [[acquisitionId, acquisitionWork], [sampleId, sampleWork]]) {
    const duration = durations.find(row => row.actionId === id);
    const felt = handling.find(row => row.actionId === id);
    if (!duration?.ok || !felt?.ok || duration.activeActionSeconds + tolerance < work ||
        Math.abs(duration.activeActionSeconds - work) > tolerance ||
        Math.abs(felt.activeActionSeconds - work) > tolerance || felt.source !== 'experienced') return null;
  }
  return Object.freeze({ paidActionSeconds: acquisitionWork + sampleWork,
    experiencedHandlingSeconds: handling.reduce((sum, row) => sum + row.activeActionSeconds, 0),
    risingActions: handling.filter(row => row.effort === 'rising').length,
    steadyActions: handling.filter(row => row.effort === 'steady').length,
    allInCost: 'unknown' });
}
function view(state) {
  return Object.freeze({ status: state.status, reason: state.reason,
    horizonSeconds: OPTIONAL_SENSORY_HORIZON_SECONDS,
    cost: state.cost,
    targets: state.status === 'complete' ? Object.freeze({ ...state.targets }) : null });
}
function censor(state, reason) {
  state.status = 'censored'; state.reason = reason; state.targets = null;
  return view(state);
}

/**
 * Begin only after a real paid acquisition and paid swallow. The caller retains
 * both original runtime action objects; copied/saved actions have no WeakMap
 * completion authority. The private IDs verify the chain and never enter an
 * outcome feature. An absent or ambiguous chain cannot begin a value window.
 */
export function beginOptionalSensoryWindow(actor, acquisitionActive, sampleActive) {
  if (!actor || actor.mode !== 'discovery' || actor.lifecycle !== 'AWAKE' || actor.active ||
      !Number.isFinite(actor.elapsed) || !Number.isSafeInteger(actor.epoch) ||
      !sampleActive || usedSamples.has(sampleActive) || sampleActive === acquisitionActive) return null;
  const acquisition = successfulDiscoveryActionCompletion(actor, acquisitionActive);
  const sample = successfulDiscoveryActionCompletion(actor, sampleActive);
  const paidAcquisition = discoveryActionCompletion(actor, acquisitionActive);
  const paidSample = discoveryActionCompletion(actor, sampleActive);
  if (!acquisition || !sample || !paidAcquisition || !paidSample ||
      !['pull', 'grasp'].includes(acquisition.type) || sample.type !== 'sample' ||
      !(acquisition.worked > 0) || !(sample.worked > 0)) return null;
  const experience = createProcedureExperience(actor);
  if (experience.status !== 'assessed' || experience.actorId !== actor.id ||
      experience.actorEpoch !== actor.epoch) return null;
  const matches = experience.episodes.filter(episode =>
    episode.proofStatus === 'retained-direct-chain' &&
    episode.acquisition?.actionId === acquisition.eventId &&
    episode.samples.some(row => row.actionId === sample.eventId && row.ingestionId));
  if (matches.length !== 1) return null;
  const sampleRow = matches[0].samples.find(row => row.actionId === sample.eventId);
  if (Math.abs(actor.elapsed - sampleRow.at) > tolerance) return null;
  const ingestionId = sampleRow.ingestionId;
  // The gut identity is private censor authority, never a feature or target.
  // An earlier meal could otherwise create apparent post-sample relief.
  if (!Array.isArray(actor.physiology?.stomach) ||
      actor.physiology.stomach.length !== 1 || actor.physiology.stomach[0]?.id !== ingestionId) return null;
  const cost = cleanCost(matches[0], acquisition.eventId, sample.eventId,
    acquisition.worked, sample.worked);
  const baseline = categories(actor);
  const counts = [actor.stats?.injuries, actor.stats?.rescues,
    actor.physiology.outsideAssistance?.count];
  if (!cost || !baseline || !Number.isSafeInteger(actor.memory?.nextId) ||
      !Array.isArray(actor.memory?.experience) ||
      counts.some(value => !Number.isSafeInteger(value) || value < 0)) return null;
  usedSamples.add(sampleActive);
  const handle = Object.freeze({});
  windows.set(handle, { actor, epoch: actor.epoch, discovery: actor.discovery,
    physiology: actor.physiology, memory: actor.memory, startedAt: actor.elapsed,
    ingestionId, injuries: actor.stats?.injuries, rescues: actor.stats?.rescues,
    outsideAssistance: actor.physiology.outsideAssistance?.count,
    lastAt: actor.elapsed, lastEventId: actor.memory.nextId - 1,
    baseline, cost, status: 'pending', reason: null,
    targets: { hungerEased: 0, thirstEased: 0, energyEased: 0, painWorsened: 0 } });
  return handle;
}

/** One read per physical tick. Missing ticks, changed identity, or any later
 * action censor the entire window; an unseen period is never a zero target. */
export function observeOptionalSensoryWindow(handle, actor) {
  const state = windows.get(handle);
  if (!state) return null;
  if (state.status !== 'pending') return view(state);
  if (actor !== state.actor || actor.epoch !== state.epoch ||
      actor.discovery !== state.discovery || actor.physiology !== state.physiology ||
      actor.memory !== state.memory || actor.lifecycle !== 'AWAKE') return censor(state, 'identity-or-lifecycle');
  const at = actor.elapsed;
  if (!Number.isFinite(at) || at < state.lastAt - tolerance ||
      at > state.lastAt + OPTIONAL_SENSORY_MAX_GAP_SECONDS + tolerance) return censor(state, 'observation-gap');
  if (actor.active) return censor(state, 'intervening-action');
  if (!Array.isArray(actor.physiology.stomach) ||
      actor.physiology.stomach.some(item => item?.id !== state.ingestionId))
    return censor(state, 'competing-ingestion');
  if (actor.stats?.injuries !== state.injuries || actor.stats?.rescues !== state.rescues ||
      actor.physiology.outsideAssistance?.count !== state.outsideAssistance)
    return censor(state, 'unrelated-body-event');
  if (at <= state.lastAt + tolerance) return view(state);
  const rows = actor.memory.experience.filter(row => row?.id > state.lastEventId)
    .sort((a, b) => a.id - b.id);
  if (!Number.isSafeInteger(actor.memory.nextId) || rows.length !== actor.memory.nextId - 1 - state.lastEventId ||
      rows.some((row, index) => row.id !== state.lastEventId + index + 1)) return censor(state, 'unretained-event');
  if (rows.some(row => row.type === 'action')) return censor(state, 'intervening-action');
  if (rows.some(row => row.type !== 'condition' ||
      !['BODY_SIGNAL', 'BODY_FEEDBACK', 'DISCOVERY_EFFECT'].includes(row.details?.code) ||
      row.details.code === 'DISCOVERY_EFFECT' && row.details.feedback?.ingestionId !== state.ingestionId))
    return censor(state, 'unrelated-body-event');
  const current = categories(actor);
  if (!current) return censor(state, 'unavailable-sensation');
  state.targets.hungerEased ||= Number(hunger.indexOf(current.hunger) < hunger.indexOf(state.baseline.hunger));
  state.targets.thirstEased ||= Number(thirst.indexOf(current.thirst) < thirst.indexOf(state.baseline.thirst));
  state.targets.energyEased ||= Number(energy.indexOf(current.energy) < energy.indexOf(state.baseline.energy));
  state.targets.painWorsened ||= Number(pain.indexOf(current.pain) > pain.indexOf(state.baseline.pain));
  state.lastAt = at; state.lastEventId = actor.memory.nextId - 1;
  if (at + tolerance >= state.startedAt + OPTIONAL_SENSORY_HORIZON_SECONDS) state.status = 'complete';
  return view(state);
}

export function cancelOptionalSensoryWindow(handle) {
  const state = windows.get(handle);
  return state?.status === 'pending' ? censor(state, 'cancelled') : state ? view(state) : null;
}
