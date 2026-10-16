import { CAVES, NPC_RULES } from './config.js';
import { BIOLOGY_RULES } from './biology-config.js';
import { DISCOVERY_RULES } from './discovery-config.js';
import { cleanSensoryObject, objectId } from './discovery-state.js';

// These are derived obligations, not additional persisted buffers. A biological
// feedback append must finish its own FIFO trim before entering this module.
const pendingLimit = BIOLOGY_RULES.maxDigestiveInputs + BIOLOGY_RULES.maxFeedback;
export const PROOF_RETENTION_BOUNDS = Object.freeze({
  pending: pendingLimit,
  experiments: pendingLimit + DISCOVERY_RULES.maxEffects + DISCOVERY_RULES.capacity + 1,
  experience: DISCOVERY_RULES.maxExperiments + pendingLimit + DISCOVERY_RULES.maxEffects + 1 + 1 + CAVES.length + 2,
  stagedExperiments: pendingLimit + DISCOVERY_RULES.maxEffects + DISCOVERY_RULES.capacity + 2,
  stagedExperience: DISCOVERY_RULES.maxExperiments + pendingLimit + DISCOVERY_RULES.maxEffects + 1 + 1 + CAVES.length + 3,
  scannedExperiments: DISCOVERY_RULES.maxExperiments + 1,
  scannedExperience: NPC_RULES.maxExperience + 2,
  owners: DISCOVERY_RULES.maxEffects + 1 + DISCOVERY_RULES.maxTechniques + 1 + DISCOVERY_RULES.maxReports + 1 + NPC_RULES.maxSkills + pendingLimit,
  heldObservations: DISCOVERY_RULES.capacity,
});
if (PROOF_RETENTION_BOUNDS.stagedExperiments > DISCOVERY_RULES.maxExperiments ||
    PROOF_RETENTION_BOUNDS.stagedExperience > NPC_RULES.maxExperience ||
    DISCOVERY_RULES.capacity > DISCOVERY_RULES.maxObjects) throw new Error('Unsupported effect-proof retention bounds');

const positiveId = value => Number.isInteger(value) && value > 0;
const ingestionId = value => typeof value === 'string' && /^ingestion:\d+$/.test(value);
const effectsAllowed = new Set(['sustained', 'water relief', 'discomfort', 'no noticeable change']);
const time = value => Number.isFinite(value) && value >= 0;
const array = value => Array.isArray(value) ? value : [];
const numericId = value => typeof value === 'number' ? value : Number(String(value ?? '').match(/(\d+)$/)?.[1] || 0);
const originalPlans = new WeakMap();

function uniqueIndex(rows, key) {
  const index = new Map();
  for (const row of rows) {
    const id = row?.[key];
    if (!positiveId(id) || index.has(id)) return null;
    index.set(id, row);
  }
  return index;
}

// Keep the existing action/sample cross-check exact. In particular, an action
// with the same target or result text is not a substitute for the original ID.
function validExperiment(experiment, receipt) {
  return positiveId(experiment?.id) && positiveId(experiment.actionId) && time(experiment.at) &&
    DISCOVERY_RULES.primitives.includes(experiment.primitive) && objectId(experiment.targetId) &&
    receipt?.type === 'action' && receipt.at === experiment.at &&
    receipt.details?.action?.type === experiment.primitive && receipt.details.action.targetId === experiment.targetId &&
    receipt.details.result?.ok === experiment.ok && typeof experiment.ok === 'boolean' &&
    receipt.details.result?.code === experiment.code &&
    (receipt.details.result?.materialId || undefined) === (experiment.materialId || undefined) &&
    (receipt.details.result?.ingestionId || undefined) === (experiment.ingestionId || undefined);
}
function matchingSample(effect, samples) {
  const sample = samples.get(effect?.actionId);
  return objectId(effect?.objectId) && positiveId(effect.actionId) && ingestionId(effect.ingestionId) &&
    effectsAllowed.has(effect.effect) && time(effect.at) && sample?.primitive === 'sample' && sample.ok &&
    sample.targetId === effect.objectId && sample.ingestionId === effect.ingestionId && effect.at >= sample.at ? sample : null;
}
function conditionMatches(effect, receipt) {
  const feedback = receipt?.details?.feedback;
  return receipt?.type === 'condition' && time(receipt.at) && receipt.at >= effect.at &&
    receipt.details?.code === 'DISCOVERY_EFFECT' &&
    feedback?.id === effect.id && feedback.ingestionId === effect.ingestionId && feedback.actionId === effect.actionId &&
    feedback.effect === effect.effect && feedback.objectId === effect.objectId && feedback.source === 'experienced' &&
    feedback.at === effect.at;
}
function feedbackMatches(effect, feedback) {
  return feedback?.id === effect.id && feedback.ingestionId === effect.ingestionId && feedback.actionId === effect.actionId &&
    feedback.effect === effect.effect && feedback.objectId === effect.objectId && feedback.provenance === 'sampled' && feedback.at === effect.at;
}
function indexes(npc) {
  const experience = array(npc.memory?.experience), experiments = array(npc.discovery?.experiments);
  if (experience.length > PROOF_RETENTION_BOUNDS.scannedExperience || experiments.length > PROOF_RETENTION_BOUNDS.scannedExperiments) return null;
  const events = uniqueIndex(experience, 'id'), byId = uniqueIndex(experiments, 'id'), byAction = uniqueIndex(experiments, 'actionId');
  if (!events || !byId || !byAction) return null;
  const valid = new Map(experiments.filter(e => validExperiment(e, events.get(e.actionId))).map(e => [e.id, e]));
  return { events, valid, samples: new Map([...valid.values()].map(e => [e.actionId, e])) };
}

/** Read-only durability inspection; never treats the separate physiology queue
 * as a replacement for an original recognition receipt. The receipt's outer
 * time may be later than the embedded feedback time (e.g. recognition on wake). */
export function retainedEffectProofError(npc) {
  if (npc?.mode !== 'discovery') return null;
  const rows = array(npc.discovery?.effects);
  if (rows.length > DISCOVERY_RULES.maxEffects + 1) return 'malformed-proof-input';
  const index = indexes(npc);
  if (!index) return 'malformed-proof-input';
  const identities = new Set();
  for (const effect of rows) {
    if (typeof effect?.id !== 'string' || !effect.id || identities.has(effect.id)) return 'malformed-proof-input';
    identities.add(effect.id);
    if (!matchingSample(effect, index.samples)) return 'incomplete-learned-provenance';
    if (!conditionMatches(effect, index.events.get(effect.proofEventId))) {
      return array(npc.physiology?.feedback).some(f => feedbackMatches(effect, f)) ?
        'queue-dependent-learned-provenance' : 'incomplete-learned-provenance';
    }
  }
  return null;
}

/** Inspect the raw actor before the save validator can discard a held item or
 * a pending portion. This does not retire optional reports or learned routines. */
export function retainedProofIntegrityError(npc) {
  const effectError = retainedEffectProofError(npc);
  if (effectError || npc?.mode !== 'discovery') return effectError;
  // The live planner may inspect one staged completion and two linked events.
  // A persisted save has no such transaction: validators slice to the ordinary
  // caps, so accepting staged arrays here could erase their oldest proof.
  if (!Array.isArray(npc.discovery?.experiments) || !Array.isArray(npc.discovery?.effects) ||
      !Array.isArray(npc.memory?.experience) ||
      npc.discovery.experiments.length > DISCOVERY_RULES.maxExperiments ||
      npc.discovery.effects.length > DISCOVERY_RULES.maxEffects ||
      npc.memory.experience.length > NPC_RULES.maxExperience ||
      Object.keys(npc.discovery.observations || {}).length > DISCOVERY_RULES.maxObjects ||
      array(npc.discovery.reports).length > DISCOVERY_RULES.maxReports ||
      array(npc.discovery.techniques).length > DISCOVERY_RULES.maxTechniques ||
      array(npc.memory.skills).length > NPC_RULES.maxSkills ||
      array(npc.physiology?.stomach).length > BIOLOGY_RULES.maxDigestiveInputs ||
      array(npc.physiology?.feedback).length > BIOLOGY_RULES.maxFeedback)
    return 'uncommitted-proof-retirement';
  const index = indexes(npc);
  if (!index) return 'malformed-proof-input';
  const seen = new Set(array(npc.discovery?.seenFeedback));
  const pending = [...array(npc.physiology?.stomach).map(row => ({ row, stomach: true })),
    ...array(npc.physiology?.feedback).filter(row => !seen.has(row?.id)).map(row => ({ row, stomach: false }))];
  if (pending.length > pendingLimit) return 'malformed-proof-input';
  const identities = new Map();
  for (const { row, stomach } of pending) {
    if (!positiveId(row?.actionId) && row?.provenance !== 'sampled') continue;
    const id = stomach ? row?.id : row?.ingestionId;
    if (!ingestionId(id) || !positiveId(row?.actionId) || !time(row.at)) return 'incomplete-pending-provenance';
    const receipt = index.events.get(row.actionId);
    if (receipt?.type !== 'action' || receipt.details?.result?.ok !== true ||
        receipt.details.result.ingestionId !== id ||
        (stomach ? receipt.at !== row.at : receipt.at > row.at)) return 'incomplete-pending-provenance';
    const identity = `${row.actionId}|${row.objectId ?? ''}|${row.provenance ?? ''}`;
    if (identities.has(id) && identities.get(id) !== identity) return 'malformed-proof-input';
    identities.set(id, identity);
    if (row.provenance === 'sampled') {
      const sample = index.samples.get(row.actionId);
      if (!sample || sample.primitive !== 'sample' || !sample.ok ||
          sample.targetId !== row.objectId || sample.ingestionId !== id) return 'incomplete-pending-provenance';
    }
  }
  const held = array(npc.inventory?.items);
  if (held.length > DISCOVERY_RULES.capacity || new Set(held).size !== held.length) return 'malformed-proof-input';
  for (const id of held) {
    const observation = npc.discovery?.observations?.[id];
    if (!objectId(id) || observation?.id !== id || !cleanSensoryObject(observation) ||
        ![...index.valid.values()].some(e => e.ok &&
          (e.primitive === 'pull' && e.materialId === id || e.primitive === 'grasp' && e.targetId === id)))
      return 'incomplete-held-provenance';
  }
  if (npc.flask?.fillEventId != null) {
    const fill = index.events.get(npc.flask.fillEventId);
    if (fill?.type !== 'action' || fill.details?.action?.type !== 'fill_flask' ||
        fill.details?.result?.ok !== true) return 'incomplete-physical-provenance';
  }
  return null;
}

/** Select only existing genuine observations. Selection reserves at most four
 * held identities, then uses recency; survivor insertion order stays unchanged. */
export function retainHeldObservations(npc, observations = npc.discovery?.observations || {}) {
  const entries = Object.entries(observations).filter(([id, observation]) => id === observation?.id && cleanSensoryObject(observation));
  const held = new Set(array(npc.inventory?.items).filter(objectId).slice(0, DISCOVERY_RULES.capacity));
  const selected = new Set(entries.filter(([id]) => held.has(id)).map(([id]) => id));
  const recent = entries.map((entry, order) => ({ entry, order })).sort((a, b) =>
    b.entry[1].observedAt - a.entry[1].observedAt || a.order - b.order);
  for (const { entry: [id] } of recent) {
    if (selected.size >= DISCOVERY_RULES.maxObjects) break;
    selected.add(id);
  }
  return Object.fromEntries(entries.filter(([id]) => selected.has(id)));
}

function retirement(owner, reason) {
  return { kind: owner.kind, id: owner.row.id, index: owner.index, reason };
}
function ownerTime(owner) {
  if (time(owner.row.at)) return owner.row.at;
  const earned = array(owner.row.validation).find(v => time(v?.at));
  return earned?.at ?? 0;
}
const ownerOrder = (a, b) => a.priority - b.priority || ownerTime(a) - ownerTime(b) || numericId(a.row.id) - numericId(b.row.id) || a.index - b.index;

/** Pure bounded planning. Only synchronous completed links belong here. Pass
 * the one completed action and, if necessary, its one nested bookkeeping event
 * as stagingEventIds; never invoke between ingestion and action registration. */
export function planProofRetention(npc, { stagingEventIds = [] } = {}) {
  const d = npc?.discovery, m = npc?.memory;
  const source = { experience: array(m?.experience), experiments: array(d?.experiments), effects: array(d?.effects),
    reports: array(d?.reports), techniques: array(d?.techniques), skills: array(m?.skills), observations: d?.observations || {} };
  const diagnostics = { scannedExperiments: Math.min(source.experiments.length, PROOF_RETENTION_BOUNDS.scannedExperiments),
    scannedExperience: Math.min(source.experience.length, PROOF_RETENTION_BOUNDS.scannedExperience),
    pending: 0, hardExperiments: 0, hardExperience: 0, owners: 0, retirements: 0, closureChecks: 0,
    keptExperiments: 0, keptExperience: 0, removedExperiments: 0, removedExperience: 0 };
  const fail = reason => ({ ok: false, reason, diagnostics });
  const shaped = rows => rows.every(row => row && typeof row === 'object' && !Array.isArray(row));
  if (npc?.mode !== 'discovery') return fail('not-discovery');
  if (!d || !m || ['experiments','effects','reports','techniques'].some(k => !Array.isArray(d[k])) ||
      !Array.isArray(m.experience) || !Array.isArray(m.skills) || !Array.isArray(stagingEventIds) ||
      ![source.experience,source.experiments,source.effects,source.reports,source.techniques,source.skills].every(shaped) ||
      stagingEventIds.length > 2 || source.experiments.length > PROOF_RETENTION_BOUNDS.scannedExperiments ||
      source.experience.length > PROOF_RETENTION_BOUNDS.scannedExperience || source.effects.length > DISCOVERY_RULES.maxEffects + 1 ||
      source.reports.length > DISCOVERY_RULES.maxReports + 1 || source.techniques.length > DISCOVERY_RULES.maxTechniques + 1 ||
      source.skills.length > NPC_RULES.maxSkills || array(npc.physiology?.stomach).length > BIOLOGY_RULES.maxDigestiveInputs ||
      array(npc.physiology?.feedback).length > BIOLOGY_RULES.maxFeedback || array(npc.inventory?.items).length > DISCOVERY_RULES.capacity)
    return fail('malformed-proof-input');
  const index = indexes(npc);
  if (!index) return fail('malformed-proof-input');
  const { events, valid, samples } = index;
  const retainedEffects = source.effects.slice(-DISCOVERY_RULES.maxEffects), effectsBySample = new Map();
  const effectIds = new Set();
  const hardExperiments = new Set(), hardEvents = new Set(), retirements = [], owners = [];
  const keepExperiment = (experiment, experiments = hardExperiments, experience = hardEvents) => {
    experiments.add(experiment.id); experience.add(experiment.actionId);
  };
  for (const effect of retainedEffects) {
    if (typeof effect?.id !== 'string' || !effect.id || effectIds.has(effect.id)) return fail('malformed-proof-input');
    effectIds.add(effect.id);
    const sample = matchingSample(effect, samples);
    if (!sample) return fail('incomplete-learned-provenance');
    if (!conditionMatches(effect, events.get(effect.proofEventId))) return fail(
      array(npc.physiology?.feedback).some(f => feedbackMatches(effect, f)) ? 'queue-dependent-learned-provenance' : 'incomplete-learned-provenance');
    keepExperiment(sample); hardEvents.add(effect.proofEventId);
    const matching = effectsBySample.get(sample.id) || []; matching.push(effect); effectsBySample.set(sample.id, matching);
  }
  for (let i = 0; i < source.effects.length - retainedEffects.length; i++)
    retirements.push(retirement({ kind: 'effect', row: source.effects[i], index: i }, 'effect-fifo'));

  // The stomach and unseen FIFO feedback own exact ingestion identities. The
  // per-object behavioural marker and elapsed waiting period are irrelevant.
  const pending = new Map(), pendingSamples = new Map(), seen = new Set(array(d.seenFeedback));
  const pendingInputs = [...array(npc.physiology?.stomach).map(row => ({ row, stomach: true })),
    ...array(npc.physiology?.feedback).filter(row => !seen.has(row?.id)).map(row => ({ row, stomach: false }))];
  for (const { row, stomach } of pendingInputs) {
    const id = stomach ? row?.id : row?.ingestionId;
    // Historic non-action inputs do not manufacture a memory obligation.
    if (!positiveId(row?.actionId) && row?.provenance !== 'sampled') continue;
    if (!ingestionId(id) || !positiveId(row?.actionId)) return fail('incomplete-pending-provenance');
    const receipt = events.get(row.actionId), result = receipt?.details?.result;
    if (receipt?.type !== 'action' || result?.ok !== true || result.ingestionId !== id ||
        !time(row.at) || (stomach ? receipt.at !== row.at : receipt.at > row.at)) return fail('incomplete-pending-provenance');
    const identity = `${id}|${row.actionId}|${row.objectId ?? ''}|${row.provenance ?? ''}`;
    if (pending.has(id) && pending.get(id) !== identity) return fail('malformed-proof-input');
    pending.set(id, identity); hardEvents.add(receipt.id);
    if (row.provenance === 'sampled') {
      const sample = samples.get(row.actionId);
      if (!sample || sample.primitive !== 'sample' || !sample.ok || sample.targetId !== row.objectId || sample.ingestionId !== id)
        return fail('incomplete-pending-provenance');
      keepExperiment(sample); pendingSamples.set(id, sample);
    }
  }
  diagnostics.pending = pending.size;
  if (pending.size > pendingLimit) return fail('malformed-proof-input');

  const acquisitions = [...valid.values()].filter(e => e.ok && (e.primitive === 'pull' || e.primitive === 'grasp'));
  const acquired = (id, before = null) => acquisitions.filter(e =>
    (e.materialId === id || e.primitive === 'grasp' && e.targetId === id) &&
    (!before || e.id < before.id && e.at <= before.at)).at(-1);
  const observations = retainHeldObservations(npc, source.observations);
  const held = new Set(array(npc.inventory?.items));
  if (held.size !== array(npc.inventory?.items).length) return fail('malformed-proof-input');
  for (const id of held) {
    const acquisition = acquired(id);
    if (!objectId(id) || !observations[id] || !acquisition) return fail('incomplete-held-provenance');
    keepExperiment(acquisition);
  }
  if (npc.flask?.fillEventId != null) {
    const fill = events.get(npc.flask.fillEventId);
    if (fill?.type !== 'action' || fill.details?.action?.type !== 'fill_flask' || fill.details?.result?.ok !== true)
      return fail('incomplete-physical-provenance');
    hardEvents.add(fill.id);
  }
  const rest = source.experience.filter(e => e.type === 'action' && ['rest','sleep'].includes(e.details?.action?.type)).at(-1);
  if (rest) hardEvents.add(rest.id);
  for (const shelter of CAVES) {
    const entry = source.experience.filter(e => e.type === 'action' && e.details?.action?.type === 'enter_shelter' &&
      e.details.action.shelterId === shelter.id && e.details.result?.ok === true).at(-1);
    if (entry) hardEvents.add(entry.id);
  }
  for (const id of stagingEventIds) {
    if (!positiveId(id) || !events.has(id)) return fail('malformed-staging');
    hardEvents.add(id);
    const experiment = samples.get(id); if (experiment) keepExperiment(experiment);
  }
  if (new Set(stagingEventIds).size !== stagingEventIds.length || stagingEventIds.filter(id => samples.has(id)).length > 1)
    return fail('malformed-staging');
  diagnostics.hardExperiments = hardExperiments.size; diagnostics.hardExperience = hardEvents.size;
  if (hardExperiments.size > PROOF_RETENTION_BOUNDS.experiments || hardEvents.size > PROOF_RETENTION_BOUNDS.experience)
    return fail('unsupported-hard-closure');

  const addOwner = (kind, row, order, priority, experimentIds = [], eventIds = [], supported = true) => {
    const owner = { kind, row, index: order, priority, experiments: new Set(), experience: new Set(), active: supported };
    for (const id of experimentIds) { const experiment = valid.get(id); if (!experiment) owner.active = false; else keepExperiment(experiment, owner.experiments, owner.experience); }
    for (const id of eventIds) { if (!events.has(id)) owner.active = false; else owner.experience.add(id); }
    owners.push(owner);
    if (!owner.active) retirements.push(retirement(owner, 'unsupported-owner'));
    return owner;
  };
  for (const [i, report] of source.reports.entries()) {
    const evidence = array(report?.evidence), proposed = array(report?.proposed);
    if (evidence.length > 12 || proposed.length > 6) return fail('malformed-proof-input');
    const supported = proposed.every(step => observations[step?.targetId]) &&
      (report.status !== 'supported' || evidence.some(id => effectsBySample.get(id)?.some(e => e.effect === 'sustained'))) &&
      (report.status !== 'contradicted' || evidence.some(id => valid.get(id)?.ok === false || effectsBySample.get(id)?.some(e => e.effect === 'discomfort')));
    addOwner('report', report, i, 0, evidence, [], supported);
  }
  for (const [i, skill] of source.skills.entries()) {
    const supporting = array(skill?.supportingExperience), validation = array(skill?.validation);
    if (supporting.length > 36 || validation.length > 16) return fail('malformed-proof-input');
    addOwner('skill', skill, i, 1, [], [...supporting, ...validation.map(v => v.eventId)], supporting.length >= 2);
  }
  for (const [i, technique] of source.techniques.entries()) {
    const evidence = array(technique?.evidence), steps = array(technique?.steps);
    if (evidence.length > 16) return fail('malformed-proof-input');
    const supported = objectId(technique?.sourceId) && steps.length === 2 && steps[0]?.targetId === '$source' &&
      steps[1]?.type === 'sample' && steps[1]?.targetId === '$material' && evidence.some(id => {
        const sample = valid.get(id);
        return sample?.primitive === 'sample' && sample.ok && effectsBySample.get(id)?.some(e => e.effect === 'sustained') &&
          evidence.some(acquisitionId => { const acquisition = valid.get(acquisitionId); return acquisition?.ok &&
            acquisition.id < sample.id && acquisition.at <= sample.at && acquisition.targetId === technique.sourceId &&
            steps[0]?.type === acquisition.primitive && (acquisition.primitive === 'pull' && acquisition.materialId === sample.targetId ||
              acquisition.primitive === 'grasp' && acquisition.targetId === sample.targetId); });
      });
    // An older witness may have gone missing while a second complete chain
    // remains. Keep that same learned owner with only its still genuine rows.
    const survivingEvidence = evidence.filter(id => valid.has(id));
    const row = survivingEvidence.length === evidence.length ? technique : { ...technique, evidence: survivingEvidence };
    addOwner('technique', row, i, 2, survivingEvidence, [], Boolean(supported));
  }
  let optionalIndex = 0;
  for (const sample of pendingSamples.values()) {
    const acquisition = acquired(sample.targetId, sample);
    if (acquisition) addOwner('acquisition', acquisition, optionalIndex++, 3, [acquisition.id]);
  }
  diagnostics.owners = owners.length + source.effects.length;
  if (diagnostics.owners > PROOF_RETENTION_BOUNDS.owners) return fail('malformed-proof-input');
  const closure = () => {
    diagnostics.closureChecks++;
    const experiments = new Set(hardExperiments), experience = new Set(hardEvents);
    for (const owner of owners) if (owner.active) {
      for (const id of owner.experiments) experiments.add(id);
      for (const id of owner.experience) experience.add(id);
    }
    return { experiments, experience };
  };
  let selected = closure();
  for (const owner of owners.filter(o => o.active &&
    (o.kind !== 'report' || o.row.cursor > 0 || o.experiments.size || o.experience.size)).sort(ownerOrder)) {
    if (selected.experiments.size <= DISCOVERY_RULES.maxExperiments && selected.experience.size <= NPC_RULES.maxExperience) break;
    owner.active = false; retirements.push(retirement(owner, 'capacity')); selected = closure();
  }
  if (selected.experiments.size > DISCOVERY_RULES.maxExperiments || selected.experience.size > NPC_RULES.maxExperience)
    return fail('unsupported-hard-closure');

  // The remaining budget retains newest unowned complete experiment/action
  // bundles, then newest detail rows. Rejected bundle receipts are not resurrected
  // as arbitrary history; shared independently-owned receipts remain protected.
  for (let i = source.experiments.length - 1; i >= 0; i--) {
    const experiment = source.experiments[i];
    if (!valid.has(experiment.id) || selected.experiments.has(experiment.id)) continue;
    if (selected.experiments.size < DISCOVERY_RULES.maxExperiments &&
        (selected.experience.has(experiment.actionId) || selected.experience.size < NPC_RULES.maxExperience))
      keepExperiment(experiment, selected.experiments, selected.experience);
  }
  const omittedReceipts = new Set(source.experiments.filter(e => !selected.experiments.has(e.id)).map(e => e.actionId));
  for (let i = source.experience.length - 1; i >= 0 && selected.experience.size < NPC_RULES.maxExperience; i--) {
    const event = source.experience[i]; if (!omittedReceipts.has(event.id)) selected.experience.add(event.id);
  }
  const keptOwners = kind => new Set(owners.filter(o => o.kind === kind && o.active).map(o => o.index));
  const reports = keptOwners('report'), techniques = keptOwners('technique'), skills = keptOwners('skill');
  const kept = { experience: source.experience.filter(e => selected.experience.has(e.id)),
    experiments: source.experiments.filter(e => selected.experiments.has(e.id)), effects: retainedEffects,
    reports: source.reports.filter((_, i) => reports.has(i)),
    techniques: owners.filter(o => o.kind === 'technique' && techniques.has(o.index)).map(o => o.row),
    skills: source.skills.filter((_, i) => skills.has(i)), observations };
  Object.assign(diagnostics, { retirements: retirements.length, keptExperiments: kept.experiments.length,
    keptExperience: kept.experience.length, removedExperiments: source.experiments.length - kept.experiments.length,
    removedExperience: source.experience.length - kept.experience.length });
  const plan = { ok: true, reason: retirements.length ? 'owners-retired' : 'retained', kept, retirements, diagnostics };
  originalPlans.set(plan, { npc, source });
  return plan;
}

/** One synchronous commit. Does not allocate an event ID, change physical state,
 * normalize counters, create observations, or cancel an already-started action. */
export function applyProofRetention(npc, plan) {
  if (!plan?.ok) return false;
  const original = originalPlans.get(plan);
  if (original?.npc !== npc || npc.memory.experience !== original.source.experience || npc.discovery.experiments !== original.source.experiments)
    return false;
  const { kept } = plan;
  npc.memory.experience = kept.experience; npc.memory.skills = kept.skills;
  for (const key of ['experiments','effects','reports','techniques','observations']) npc.discovery[key] = kept[key];
  if (npc.discovery.run && !kept.techniques.some(t => t.id === npc.discovery.run.techniqueId)) npc.discovery.run = null;
  originalPlans.delete(plan);
  return true;
}
export function compactProofRetention(npc, options) {
  const plan = planProofRetention(npc, options);
  if (plan.ok) applyProofRetention(npc, plan);
  return plan;
}
