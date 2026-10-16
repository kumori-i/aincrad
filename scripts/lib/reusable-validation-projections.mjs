/** Research-only, data-only Gate 2 adapter. No native actor/world is accepted.
 *
 * Native discoveryDecision remains the only authority for physical submission.
 * Its unchanged root supplies geometry, routes, order and score/RNG provenance.
 * This adapter never calls geometry, draws RNG, observes, advances, trains, or
 * constructs a physical receipt. Unknown public dependencies fail closed.
 *
 * Capacity projections change an explicit public occupied-slot count, retaining
 * the complete known object universe; unspecified slot occupants are NOT new
 * object identities/opportunities. This is a counterfactual mask input only.
 */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { DISCOVERY_RULES } from '../../src/discovery-config.js';
import { reusableMaterialSupport } from './reusable-outcome-sensor.mjs';
import { forecastCandidate, forecastPending, forecastExposure, chooseMatched,
  reusableAppearance } from './reusable-outcome-model.mjs';

const copy = value => structuredClone(value);
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
};
const same = isDeepStrictEqual;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const id = value => typeof value === 'string' && /^object:\d{1,9}$/.test(value);
const own = (value, key) => Object.hasOwn(value, key);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const channels = () => ({ F: false, W: false, H: false });
const band = n => n < 2 ? String(n) : n < 4 ? '2..3' : n < 8 ? '4..7' : n < 16 ? '8..15' : '16+';
const countBand = n => Number.isFinite(n) && n >= 0 ? n === 0 ? '0' : n === 1 ? '1' : '2+' : 'unknown';
const actionKey = action => JSON.stringify(action);
const appearance = object => reusableAppearance({ ...object?.appearance,
  ...(object?.motion === undefined ? {} : { motion: object.motion }) });
const emptySupport = generation => ({ ...channels(), applicable: false, unknown: true,
  firsthand: { F: 0, W: 0, H: 0 }, generation });
const PRIMITIVES = DISCOVERY_RULES.primitives;
const FIELDS = ['shape', 'color', 'texture', 'motion', 'size', 'smell'];

export const VALIDATION_PROJECTIONS = freeze({ version: 1,
  kind: 'research-only-public-projection-adapter',
  protocolSha256: '6932769d221eb7ba33958dee5d48fb9d8cb9294a7f409157824a1cd2de834423',
  pairs: ['held-reach', 'capacity', 'sample-history', 'pending-binding',
    'appearance-generation', 'operation-work', 'hunger', 'digestion'],
  freshIds: Array.from({ length: 8 }, (_, i) => `object:${99000001 + i}`),
  draws: [.5, .5, .5, .5], conditions: 24, evaluations: 48,
  physicalAuthority: 'unchanged native discoveryDecision; adapter never authorizes submission',
});

function unavailable(reasons, extra = {}) {
  return freeze({ status: 'unavailable', evidenceClass: 'pure-public-projection',
    adapterOutput: true, physicalAuthority: false, reasons: [...new Set(reasons)], ...extra });
}

function recentlyFailed(facts, type, targetId) {
  const trial = facts.discovery.trials[`${targetId}|${type}`];
  const recent = facts.discovery.experiments.filter(e => e.targetId === targetId && e.primitive === type).at(-1);
  if (trial && trial.lastAt >= (recent?.at ?? -1)) {
    if (typeof trial.lastOk === 'boolean') return !trial.lastOk && facts.view.at - trial.lastAt < 60;
    if (trial.lastAt > (recent?.at ?? -1)) return false;
  }
  return Boolean(recent && !recent.ok && facts.view.at - recent.at < 60);
}

function localReasons(facts, object, type) {
  const reasons = [], held = facts.view.held.includes(object.id), d = facts.discovery;
  if (!held && object.scene !== facts.view.scene) reasons.push('different-scene');
  if (!(facts.view.at - object.observedAt < 8)) reasons.push('stale-observation');
  if (['release', 'sample'].includes(type) && !held) reasons.push('not-held');
  if (['grasp', 'pull'].includes(type) && held) reasons.push('already-held');
  if (['grasp', 'pull'].includes(type) && facts.occupiedSlots >= DISCOVERY_RULES.capacity) reasons.push('capacity-full');
  if (recentlyFailed(facts, type, object.id)) reasons.push('recent-operation-failure');
  if (type === 'sample') {
    if (['full', 'overfull'].includes(facts.view.body.digestion)) reasons.push('fullness');
    if (Object.entries(d.trials).some(([key, t]) => key.endsWith('|sample') && t.lastOk === false &&
      t.lastCode === 'TOO_FULL' && facts.view.at - t.lastAt < 60) || d.experiments.some(e =>
      e.primitive === 'sample' && !e.ok && e.code === 'TOO_FULL' && facts.view.at - e.at < 60)) reasons.push('recent-global-too-full');
    if (d.effects.some(e => e.objectId === object.id && e.effect === 'discomfort')) reasons.push('exact-harm');
    // The frozen fixture always uses foodLearning:false: no positive-support bypass.
    if (d.samplesPending[object.id] !== undefined &&
      facts.view.at - d.samplesPending[object.id] < DISCOVERY_RULES.feedbackWaitSeconds) reasons.push('own-pending');
  }
  return reasons;
}

function workBand(facts, targetId, operation) {
  if (!targetId) return '0';
  if (facts.workOverrides?.[`${targetId}|${operation}`] !== undefined) return facts.workOverrides[`${targetId}|${operation}`];
  const memory = facts.memory;
  if (memory.historyCensored || memory.model.historyCensored || memory.receipts[0]?.seq > 1) return 'unknown';
  return band(memory.receipts.filter(r => r.seq < memory.nextSeq && r.request.type === operation &&
    r.request.targetId === targetId && r.outcome?.workedSeconds > 0).length);
}

function features(facts, action, geometry) {
  const object = facts.view.objects.find(o => o.id === action.targetId);
  return { operation: action.type, appearance: appearance(object),
    relation: action.type === 'move' ? 'route' : action.targetId ? facts.view.held.includes(action.targetId) ? 'held' :
      geometry[action.targetId]?.eligible === true ? 'reach' : 'unknown' : 'unknown',
    workBand: workBand(facts, action.targetId, action.type),
    freeSlotBand: countBand(Math.max(0, facts.view.capacity - facts.occupiedSlots)),
    countBand: object ? countBand(object.count) : 'unknown' };
}

function exposureQueries(facts) {
  return facts.exposures.map(e => ({ appearance: copy(e.appearance), digestion: e.body.digestion,
    ageSeconds: facts.view.at - e.at, reported: { F: Boolean(e.admitted & 1), W: Boolean(e.admitted & 2), H: Boolean(e.admitted & 4) },
    censored: { F: Boolean(e.censored & 1), W: Boolean(e.censored & 2), H: Boolean(e.censored & 4) },
    exactSupport: { F: Boolean(e.admitted & 1), W: Boolean(e.admitted & 2), H: Boolean(e.admitted & 4) } }));
}

/** Retain only public source data, never an actor, body reserve or world state.
 * retainedBindings is an exhaustive ID census produced by the evidence owner:
 * {complete:true,scope:'all-retained-physical-and-evidence-bindings',objectIds,
 *  sourceHashes}. Missing completeness makes fresh identity projections unavailable.
 */
export function captureValidationProjectionInput({ snapshot, discovery, memory, sensor, retainedBindings } = {}) {
  const missing = [];
  if (!record(snapshot) || !record(snapshot.view) || !Array.isArray(snapshot.candidates)) missing.push('missing-native-public-snapshot');
  for (const key of ['experiments', 'effects', 'reports']) if (!Array.isArray(discovery?.[key])) missing.push(`missing-public-discovery-${key}`);
  for (const key of ['trials', 'samplesPending', 'observations']) if (!record(discovery?.[key])) missing.push(`missing-public-discovery-${key}`);
  for (const key of ['receipts', 'ingestions']) if (!Array.isArray(memory?.[key])) missing.push(`missing-public-memory-${key}`);
  if (!Number.isSafeInteger(memory?.nextSeq) || typeof memory?.historyCensored !== 'boolean' ||
    typeof memory?.creditBlocked !== 'boolean' || typeof memory?.model?.historyCensored !== 'boolean') missing.push('missing-public-history-coverage');
  if (!Array.isArray(sensor?.materials) || !Array.isArray(sensor?.exposures)) missing.push('missing-public-material-exposure-bindings');
  if (missing.length) return unavailable(missing);
  const view = snapshot.view;
  if (!Array.isArray(view.objects) || !Array.isArray(view.held) || !record(view.body) ||
    !Number.isFinite(view.at) || view.capacity !== DISCOVERY_RULES.capacity ||
    ['hunger', 'thirst', 'energy', 'stamina', 'fatigue', 'pain', 'digestion'].some(k => typeof view.body[k] !== 'string') ||
    view.held.length > DISCOVERY_RULES.capacity ||
    view.objects.some(o => !id(o.id) || !Number.isFinite(o.observedAt) || o.observedAt > view.at) ||
    new Set(view.objects.map(o => o.id)).size !== view.objects.length ||
    new Set(view.held).size !== view.held.length || view.held.some(x => !id(x))) return unavailable(['incomplete-public-object-or-capacity-facts']);
  if (!snapshot.ordinary || !record(snapshot.opportunity)) return unavailable(['native-care-or-nonordinary-root']);
  if (snapshot.ready !== true) return unavailable(['native-scheduler-not-ready']);
  if (!Array.isArray(snapshot.opportunity.choices) || !same(snapshot.opportunity.choices.map(c => c.action), snapshot.candidates.map(c => c.action)) ||
    snapshot.candidates.some((c, i) => c.index !== i || Object.entries(snapshot.opportunity.choices[i]).some(([k, v]) => !same(c[k], v)))) return unavailable(['native-root-opportunity-mismatch']);
  if (snapshot.opportunity.at !== view.at || !Number.isInteger(snapshot.opportunity.rngBefore) || !Number.isInteger(snapshot.opportunity.rngAfter) ||
    !record(snapshot.selector) || !record(snapshot.previewSelector) || !Array.isArray(snapshot.draws) || snapshot.draws.length !== 4) return unavailable(['missing-native-clock-score-or-draw-provenance']);
  if (!same(view.objects.map(o => o.id), Object.keys(discovery.observations))) return unavailable(['public-object-order-mismatch']);
  if (discovery.reports.some(r => r.sourceId === 'human' && r.status === 'unverified' && r.cursor < r.proposed?.length)) return unavailable(['human-report-dependency-outside-adapter']);
  const facts = { view: copy(view), occupiedSlots: view.held.length,
    discovery: Object.fromEntries(['experiments', 'effects', 'reports', 'trials', 'samplesPending'].map(k => [k, copy(discovery[k])])),
    memory: { receipts: copy(memory.receipts), ingestions: copy(memory.ingestions), nextSeq: memory.nextSeq,
      creditBlocked: memory.creditBlocked, historyCensored: memory.historyCensored,
      model: { historyCensored: memory.model.historyCensored } },
    materials: copy(sensor.materials), exposures: copy(sensor.exposures), support: {}, workOverrides: {} };
  const geometry = {};
  if (sensor.exposures.some(e => !Number.isFinite(e.at) || e.at > view.at || !record(e.body) ||
    typeof e.body.digestion !== 'string' || !Number.isInteger(e.admitted) || e.admitted < 0 || e.admitted > 7 ||
    !Number.isInteger(e.censored) || e.censored < 0 || e.censored > 7) ||
    !same(snapshot.exposures, exposureQueries(facts))) return unavailable(['pending-public-exposure-parity-failed']);
  for (const object of view.objects) {
    const rows = snapshot.candidates.filter(c => c.action.targetId === object.id && PRIMITIVES.includes(c.action.type));
    const held = view.held.includes(object.id), somePubliclyAllowed = PRIMITIVES.some(type => !localReasons(facts, object, type).length);
    geometry[object.id] = { eligible: held ? true : rows.length ? true : somePubliclyAllowed ? false : null,
      source: held ? 'public-held-bypass' : rows.length ? 'native-root-membership' : somePubliclyAllowed ?
        'native-absence-with-publicly-unmasked-primitive' : 'unavailable-masked-geometry' };
    try { facts.support[object.id] = reusableMaterialSupport(sensor, { memory, view, objectId: object.id }); }
    catch { return unavailable(['incomplete-public-exact-support-proofs']); }
  }
  const input = { status: 'available', version: 1, native: copy(snapshot), facts, geometry,
    retainedBindings: retainedBindings ? copy(retainedBindings) : null,
    provenance: { nativeRootHash: hash(snapshot), publicFactsHash: hash(facts),
      nativeRoutes: copy(snapshot.candidates.filter(c => c.action.type === 'move')),
      rngBefore: snapshot.opportunity.rngBefore, rngAfter: snapshot.opportunity.rngAfter,
      selector: copy(snapshot.selector), draws: copy(snapshot.draws) } };
  return freeze(input);
}

function rootActions(input, facts, geometry) {
  const actions = [], masks = [], unknown = [];
  for (const object of facts.view.objects) for (const type of PRIMITIVES) {
    const reasons = localReasons(facts, object, type), g = geometry[object.id];
    if (!reasons.length && g?.eligible === null) unknown.push(`${object.id}:${type}:unknown-native-geometry`);
    if (g?.eligible !== true) reasons.push(g?.eligible === false ? 'native-geometric-exclusion' : 'unknown-native-geometry');
    const eligible = reasons.length === 0;
    masks.push({ action: { type, targetId: object.id }, eligible, reasons });
    if (eligible) actions.push({ type, targetId: object.id });
  }
  // Routes remain exactly the native suffix, without selection/reordering/geometry.
  for (const candidate of input.native.candidates) if (!PRIMITIVES.includes(candidate.action.type)) {
    if (!['move', 'wait'].includes(candidate.action.type)) unknown.push(`unsupported-native-operation:${candidate.action.type}`);
    actions.push(copy(candidate.action));
    masks.push({ action: copy(candidate.action), eligible: true, reasons: [], source: 'retained-native-root' });
  }
  return { actions, masks, unknown };
}

function baseline(input) {
  if (input?.status !== 'available') return unavailable(input?.reasons || ['missing-captured-public-input']);
  if (hash(input.native) !== input.provenance.nativeRootHash || hash(input.facts) !== input.provenance.publicFactsHash) return unavailable(['captured-public-input-hash-mismatch']);
  const root = rootActions(input, input.facts, input.geometry), reasons = [...root.unknown];
  if (!same(root.actions, input.native.candidates.map(c => c.action))) reasons.push('unchanged-full-root-or-order-parity-failed');
  for (const c of input.native.candidates) {
    if (!same(c.features, features(input.facts, c.action, input.geometry))) reasons.push(`unchanged-feature-parity-failed:${actionKey(c.action)}`);
    const targetId = c.action.targetId || c.bindingId;
    if (targetId && !same(c.support, input.facts.support[targetId])) reasons.push(`unchanged-support-parity-failed:${targetId}`);
    const support = targetId ? input.facts.support[targetId] : emptySupport(null);
    if (!same(c.exactSupport, { F: support.F, W: support.W, H: support.H })) reasons.push('unchanged-exact-channel-support-parity-failed');
    if (c.eligibility !== input.native.ready || c.bindingsValid !== (!targetId || input.facts.view.objects.some(o => o.id === targetId))) reasons.push('unchanged-eligibility-or-binding-parity-failed');
  }
  if (reasons.length) return unavailable(reasons, { masks: root.masks });
  return { status: 'available', masks: root.masks, parity: { passed: true, fullRoot: true,
    order: true, publicMasks: true, features: true, support: true,
    nativeGeometryRetained: true, nativeRootHash: input.provenance.nativeRootHash } };
}

function dropSampleHistory(facts, targetId) {
  const sampleIds = new Set(facts.discovery.experiments.filter(e => e.targetId === targetId && e.primitive === 'sample').map(e => e.ingestionId));
  facts.discovery.experiments = facts.discovery.experiments.filter(e => !(e.targetId === targetId && e.primitive === 'sample'));
  facts.discovery.effects = facts.discovery.effects.filter(e => e.objectId !== targetId && !sampleIds.has(e.ingestionId));
  delete facts.discovery.trials[`${targetId}|sample`]; delete facts.discovery.samplesPending[targetId];
  facts.memory.receipts = facts.memory.receipts.filter(r => !(r.request.targetId === targetId && r.request.type === 'sample'));
  facts.memory.ingestions = facts.memory.ingestions.filter(e => e.objectId !== targetId);
  facts.exposures = facts.exposures.filter(e => e.objectId !== targetId);
  facts.support[targetId] = emptySupport(facts.support[targetId].generation);
}

function allIds(value, found = new Set()) {
  if (typeof value === 'string') { for (const match of value.matchAll(/object:\d{1,9}(?!\d)/g)) found.add(match[0]); }
  else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { allIds(key, found); allIds(child, found); }
  return found;
}

/** Only the declared two-valued relations and eight reserved identities exist.
 * Unknown condition names/values and unsupported route/care dependencies fail.
 */
export function projectValidationPublicRoot(input, condition = { kind: 'unchanged' }) {
  const checked = baseline(input);
  if (checked.status !== 'available') return checked;
  if (condition.kind === 'unchanged') return freeze({ status: 'available', evidenceClass: 'pure-public-projection',
    adapterOutput: true, physicalAuthority: false, condition: copy(condition), snapshot: copy(input.native),
    publicFacts: copy(input.facts), masks: checked.masks, parity: checked.parity,
    provenance: copy(input.provenance), changedFields: [], nativeMetadataUnknown: [] });
  const { targetId } = condition, facts = copy(input.facts), geometry = copy(input.geometry), changes = [], reasons = [];
  let object = facts.view.objects.find(o => o.id === targetId), queryTargetId = targetId;
  if (!object || !VALIDATION_PROJECTIONS.pairs.includes(condition.kind) && condition.kind !== 'fresh-identity') return unavailable(['unsupported-condition-or-missing-target'], { condition: copy(condition) });
  const mark = (...fields) => changes.push(...fields);
  switch (condition.kind) {
    case 'held-reach': {
      if (!['held', 'reach'].includes(condition.value)) { reasons.push('invalid-held-reach-value'); break; }
      if (input.provenance.nativeRoutes.some(c => c.bindingId === targetId)) { reasons.push('changed-relation-requires-native-route-recomputation'); break; }
      const wasHeld = facts.view.held.includes(targetId), held = condition.value === 'held';
      if (held && !wasHeld && facts.occupiedSlots >= DISCOVERY_RULES.capacity) { reasons.push('held-projection-has-no-free-slot'); break; }
      facts.view.held = facts.view.held.filter(x => x !== targetId); if (held) facts.view.held.push(targetId);
      facts.occupiedSlots += Number(held) - Number(wasHeld);
      // This explicit relation is assumed in a query, never tested by geometry.
      if (held !== wasHeld) { object.scene = facts.view.scene; object.position = copy(facts.view.position); }
      geometry[targetId] = { eligible: true, source: 'declared-counterfactual-observed-reach' };
      // Keep the genuine observation clock; a relation projection is no refresh.
      mark('view.held', 'occupiedSlots', 'target.scene', 'target.position', 'target.relation'); break;
    }
    case 'capacity':
      if (![0, 1].includes(condition.value)) reasons.push('invalid-free-slot-value');
      else {
        facts.occupiedSlots = DISCOVERY_RULES.capacity - condition.value;
        if (facts.occupiedSlots < facts.view.held.length) reasons.push('projected-capacity-contradicts-known-held-identities');
        mark('occupiedSlots', 'freeSlotBand', 'acquisition-masks');
      }
      break;
    case 'sample-history':
      if (!['none', 'retained'].includes(condition.value)) reasons.push('invalid-sample-history-value');
      else if (!facts.discovery.experiments.some(e => e.targetId === targetId && e.primitive === 'sample' && e.ok)) reasons.push('no-retained-own-successful-sample');
      else if (condition.value === 'none') { dropSampleHistory(facts, targetId); mark('target.sample-history', 'target.exact-support', 'target.pending-exposures', 'target.sample-work'); }
      break;
    case 'pending-binding': {
      if (!['own', 'other'].includes(condition.value)) { reasons.push('invalid-pending-binding-value'); break; }
      const other = condition.unrelatedTargetId;
      const exposure = facts.exposures.find(e => e.objectId === targetId && ((e.admitted | e.censored) & 7) !== 7);
      if (!exposure || !id(other) || other === targetId || !facts.view.objects.some(o => o.id === other)) { reasons.push('missing-retained-pending-record-or-unrelated-target'); break; }
      const to = condition.value === 'own' ? targetId : other;
      // Exact proof/support stays factual and separate; this projected record is
      // only a pending-mask binding, not a reissued receipt or transferred proof.
      facts.projectedPending = { sourceIngestionId: exposure.id, at: exposure.at, objectId: to,
        sourceObjectId: targetId, sourceRecordHash: hash(exposure), assumedBinding: true };
      delete facts.discovery.samplesPending[targetId];
      if (own(facts.discovery.samplesPending, other) && facts.discovery.samplesPending[other] !== exposure.at) reasons.push('competing-pending-binding-not-overwritten');
      else { facts.discovery.samplesPending[to] = exposure.at; mark('projectedPending', 'discovery.samplesPending'); }
      break;
    }
    case 'appearance-generation':
      if (!['retained', 'changed'].includes(condition.value)) reasons.push('invalid-appearance-generation-value');
      else if (condition.value === 'changed') {
        const a = condition.changedAppearance, generation = facts.support[targetId].generation;
        if (!record(a) || Object.keys(a).length !== 6 || FIELDS.some(k => typeof a[k] !== 'string' || !a[k].length) ||
          same(a, appearance(object)) || !Number.isSafeInteger(generation) || condition.changedGeneration !== generation + 1) reasons.push('missing-explicit-different-six-field-signature-or-next-generation');
        else {
          try { object.appearance = { ...object.appearance, ...reusableAppearance(a) }; } catch { reasons.push('invalid-projected-appearance'); break; }
          if (own(object, 'motion')) object.motion = a.motion;
          const material = facts.materials.find(m => m.objectId === targetId);
          if (!material) { reasons.push('missing-retained-material-generation'); break; }
          material.appearance = copy(a); material.generation = condition.changedGeneration;
          facts.support[targetId] = emptySupport(condition.changedGeneration);
          mark('target.appearance', 'target.motion', 'target.generation', 'target.exact-support');
        }
      }
      break;
    case 'operation-work':
      if (!['0', '1'].includes(condition.value) || !PRIMITIVES.includes(condition.operation)) reasons.push('invalid-relevant-operation-work-projection');
      else {
        facts.workOverrides[`${targetId}|${condition.operation}`] = condition.value;
        facts.projectedWork = { targetId, operation: condition.operation, band: condition.value,
          assumedPublicWork: true, factualReceiptAdded: false };
        mark(`workOverrides.${targetId}|${condition.operation}`, 'projectedWork');
      }
      break;
    case 'hunger':
      if (!['content', 'hungry'].includes(condition.value)) reasons.push('invalid-hunger-value');
      else if (facts.view.scene !== 'valley') reasons.push('hunger-projection-has-unresolved-cave-care-route');
      else { facts.view.body.hunger = condition.value; mark('view.body.hunger'); }
      break;
    case 'digestion':
      if (!['empty', 'full'].includes(condition.value)) reasons.push('invalid-digestion-value');
      else { facts.view.body.digestion = condition.value; mark('view.body.digestion', 'sample-fullness-mask'); }
      break;
    case 'fresh-identity': {
      const fresh = condition.value, binding = input.retainedBindings;
      if (!VALIDATION_PROJECTIONS.freshIds.includes(fresh) || binding?.complete !== true ||
        binding.scope !== 'all-retained-physical-and-evidence-bindings' || !Array.isArray(binding.objectIds) ||
        binding.objectIds.some(x => !id(x)) || !Array.isArray(binding.sourceHashes) || !binding.sourceHashes.length ||
        binding.sourceHashes.some(x => !/^[a-f0-9]{64}$/.test(x))) { reasons.push('missing-complete-retained-binding-census'); break; }
      if (allIds({ native: input.native, facts: input.facts, retainedBindings: binding }).has(fresh)) { reasons.push('fresh-query-identity-collides-with-retained-binding'); break; }
      if (input.provenance.nativeRoutes.some(c => c.bindingId === targetId)) { reasons.push('fresh-identity-has-unresolved-native-route-binding'); break; }
      // Replace only the query subject. Old actual history/exposures remain bound
      // to the original identity; no sample receipt or support is renamed.
      object.id = fresh; facts.view.held = facts.view.held.map(x => x === targetId ? fresh : x);
      geometry[fresh] = { ...geometry[targetId], source: 'declared-query-identity-same-public-relation' };
      delete geometry[targetId]; facts.support[fresh] = emptySupport(null);
      // Match the declared PUBLIC work feature without copying any old receipt
      // to the new identity or claiming that this query supplied physical work.
      for (const operation of PRIMITIVES) facts.workOverrides[`${fresh}|${operation}`] = workBand(input.facts, targetId, operation);
      facts.projectedWork = { sourceObjectId: targetId, targetId: fresh,
        assumedPublicWork: true, factualReceiptAdded: false, samePublicFeatures: true };
      queryTargetId = fresh; mark('query-target-identity', 'view.held-query-binding', 'target.exact-support', 'projectedWork');
      break;
    }
  }
  if (reasons.length) return unavailable(reasons, { condition: copy(condition), parity: checked.parity });
  const root = rootActions(input, facts, geometry);
  if (root.unknown.length) return unavailable(root.unknown, { condition: copy(condition), masks: root.masks, parity: checked.parity });
  const nativeByKey = new Map();
  for (const c of input.native.candidates) {
    const key = actionKey(c.action);
    if (!nativeByKey.has(key)) nativeByKey.set(key, []);
    nativeByKey.get(key).push(c);
  }
  const candidates = root.actions.map((action, index) => {
    const native = nativeByKey.get(actionKey(action))?.shift(), target = action.targetId || native?.bindingId;
    const support = target ? facts.support[target] || emptySupport(null) : emptySupport(null);
    const sameTargetNative = input.native.candidates.find(c => c.action.targetId === (target === queryTargetId ? targetId : target));
    return { ...(native ? copy(native) : {}), index, action: copy(action), score: null,
      nativeScoreProvenance: native ? { nativeIndex: native.index, score: native.score ?? null,
        samePhysicalSnapshotOnly: true } : null,
      // Do not present a partly edited legacy context as a coherent native one.
      // Complete public counterfactual facts and reusable features are retained.
      context: null, nativeContextProvenance: native ? copy(native.context) : null,
      contextCounterfactualComplete: false,
      features: features(facts, action, geometry), eligibility: input.native.ready,
      bindingsValid: !target || facts.view.objects.some(o => o.id === target),
      exactSupport: { F: support.F, W: support.W, H: support.H }, support: copy(support),
      focus: native?.focus ?? sameTargetNative?.focus ?? (input.native.previewSelector?.focus?.objectId === target),
      adapterOutput: true, nativeMetadataUnknown: ['counterfactual-legacy-score', 'counterfactual-legacy-context',
        ...(!native ? ['native-candidate-metadata'] : [])] };
  });
  const exposures = exposureQueries(facts);
  const snapshot = { ...copy(input.native), view: facts.view, candidates, exposures,
    opportunity: null, adapterOutput: true, counterfactual: true,
    selectorProvenanceOnly: true,
    focusScaffoldSource: 'fixed native candidate focus; fresh identity uses its matched source public feature',
    projectedInventory: { capacity: DISCOVERY_RULES.capacity, occupiedSlots: facts.occupiedSlots,
      knownHeldIds: copy(facts.view.held), unspecifiedOccupiedSlots: facts.occupiedSlots - facts.view.held.length },
    nativeOpportunityProvenance: copy(input.native.opportunity) };
  return freeze({ status: 'available', evidenceClass: 'pure-public-projection', adapterOutput: true,
    physicalAuthority: false, condition: copy(condition), queryTargetId, snapshot, publicFacts: facts,
    masks: root.masks, parity: checked.parity, changedFields: changes,
    provenance: copy(input.provenance), nativeMetadataUnknown: ['counterfactual-legacy-score', 'new-opportunity-native-metadata'] });
}

/** Pure paired-model query, also usable on an actual frozen public snapshot. */
export function predictValidationPublicSnapshot(snapshot, model) {
  const forecasts = snapshot.candidates.map(c => forecastCandidate(model, { features: c.features,
    eligibility: c.eligibility, bindingsValid: c.bindingsValid, currentSensations: snapshot.view.body, exactSupport: c.exactSupport }));
  const pending = forecastPending(model, snapshot.exposures);
  const choice = snapshot.ready && snapshot.candidates.length ? chooseMatched(snapshot.candidates, forecasts,
    { draws: [...VALIDATION_PROJECTIONS.draws] }) : null;
  return freeze({ at: snapshot.at, forecasts, pending, choice, adapterOutput: snapshot.adapterOutput === true });
}

function assessProjectionResults(conditions, invariance) {
  const checks = [], unavailableReasons = [];
  const check = (name, passed) => checks.push({ name, passed: passed === true });
  const find = (kind, value) => conditions.find(r => r.condition.kind === kind && r.condition.value === value);
  const atTarget = (row, type) => row.snapshot.candidates.find(c => c.action.targetId === row.queryTargetId && c.action.type === type);
  const allFalse = value => ['F', 'W', 'H'].every(c => value[c] === false);
  const held = find('held-reach', 'held'), reach = find('held-reach', 'reach');
  check('unchanged-native-full-root-order-mask-parity', conditions.every(r => r.parity.passed));
  check('fixed-24-condition-census', conditions.length === 24 && VALIDATION_PROJECTIONS.pairs.every(kind => conditions.filter(r => r.condition.kind === kind).length === 2));
  check('immutable-input-model-and-rng', same(invariance.before, invariance.after));
  check('held-reach-public-mask-distinction', Boolean(atTarget(held, 'release')) && !atTarget(reach, 'release') && !atTarget(reach, 'sample') &&
    !atTarget(held, 'grasp') && Boolean(atTarget(reach, 'grasp')));
  check('free-full-capacity-mask-and-feature-distinction', [0, 1].every(value => {
    const r = find('capacity', value);
    return r.snapshot.candidates.every(c => c.features.freeSlotBand === String(value)) &&
      (value !== 0 || r.snapshot.candidates.every(c => !['grasp', 'pull'].includes(c.action.type)));
  }));
  const none = find('sample-history', 'none'), retained = find('sample-history', 'retained');
  check('no-sample-removes-associated-exact-support', allFalse(none.publicFacts.support[none.queryTargetId]) &&
    none.publicFacts.exposures.every(e => e.objectId !== none.queryTargetId));
  check('retained-sample-history-is-factual', retained.publicFacts.discovery.experiments.some(e =>
    e.targetId === retained.queryTargetId && e.primitive === 'sample' && e.ok));
  const ownPending = find('pending-binding', 'own'), otherPending = find('pending-binding', 'other');
  check('pending-binding-retains-record-time-and-proof', ownPending.publicFacts.projectedPending.at === otherPending.publicFacts.projectedPending.at &&
    ownPending.publicFacts.projectedPending.sourceRecordHash === otherPending.publicFacts.projectedPending.sourceRecordHash &&
    ownPending.publicFacts.projectedPending.objectId !== otherPending.publicFacts.projectedPending.objectId &&
    same(ownPending.publicFacts.memory.ingestions, otherPending.publicFacts.memory.ingestions) &&
    same(ownPending.publicFacts.support, otherPending.publicFacts.support));
  const transformed = find('appearance-generation', 'changed'), old = find('appearance-generation', 'retained');
  check('different-signature-invalidates-old-exact-support', allFalse(transformed.publicFacts.support[transformed.queryTargetId]) &&
    transformed.publicFacts.support[transformed.queryTargetId].generation === old.publicFacts.support[old.queryTargetId].generation + 1);
  const work0 = find('operation-work', '0'), work1 = find('operation-work', '1');
  const w0 = atTarget(work0, 'inspect_object'), w1 = atTarget(work1, 'inspect_object');
  if (!w0 || !w1) unavailableReasons.push('relevant-operation-is-not-a-public-opportunity');
  else check('relevant-work-query-keys-stay-distinct', w0.features.workBand === '0' && w1.features.workBand === '1' &&
    same({ ...w0.features, workBand: '1' }, w1.features));
  check('other-operation-work-features-held-fixed', work0.snapshot.candidates.every(c => {
    const counterpart = work1.snapshot.candidates.find(d => actionKey(d.action) === actionKey(c.action));
    return c.action.type === 'inspect_object' && c.action.targetId === work0.queryTargetId || Boolean(counterpart && same(c.features, counterpart.features));
  }));
  const content = find('hunger', 'content'), hungry = find('hunger', 'hungry');
  for (const arm of ['online', 'frozen']) {
    const ci = content.snapshot.candidates.findIndex(c => c.action.type === 'sample' && c.action.targetId === content.queryTargetId);
    const hi = hungry.snapshot.candidates.findIndex(c => c.action.type === 'sample' && c.action.targetId === hungry.queryTargetId);
    const a = content[arm].forecasts[ci], b = hungry[arm].forecasts[hi];
    if (!a || !b || a.utility === null || b.utility === null) unavailableReasons.push(`${arm}-hunger-utility-comparison-is-unscorable`);
    else check(`${arm}-need-weight-only-utility-change`, a.weights.F === .5 && b.weights.F === 2 && same(a.D, b.D) &&
      same(a.physical, b.physical) && Math.abs((b.utility - a.utility) - 1.5 * a.usedD.F) <= 1e-9);
  }
  check('fullness-mask-and-digestion-condition-retained', find('digestion', 'full').snapshot.candidates.every(c => c.action.type !== 'sample') &&
    find('digestion', 'empty').exposureQuery.digestion === 'empty' && find('digestion', 'full').exposureQuery.digestion === 'full');
  const fresh = conditions.filter(r => r.condition.kind === 'fresh-identity');
  check('exact-eight-fresh-identities', same(fresh.map(r => r.queryTargetId), VALIDATION_PROJECTIONS.freshIds));
  const sourceSample = atTarget(retained, 'sample');
  if (!sourceSample) unavailableReasons.push('source-sample-feature-comparison-unavailable');
  else check('fresh-identities-retain-matched-public-physical-features', fresh.every(r => {
    const c = atTarget(r, 'sample'); return Boolean(c && same(c.features, sourceSample.features));
  }));
  for (const arm of ['online', 'frozen']) check(`${arm}-fresh-pooled-points-without-firsthand-benefit-or-safety`, fresh.every(r => {
    const c = atTarget(r, 'sample'), index = r.snapshot.candidates.indexOf(c), forecast = r[arm].forecasts[index];
    if (!c || !forecast) return false;
    return allFalse(c.exactSupport) && ['F', 'W', 'H'].every(ch => c.support.firsthand[ch] === 0 &&
      r[arm].exposure.channels[ch].firsthand === false && same(r[arm].exposure.channels[ch].epistemicRange, [0, 1]) &&
      r[arm].exposure.channels[ch].probability === fresh[0][arm].exposure.channels[ch].probability) &&
      forecast.usedD.F === 0 && forecast.usedD.W === 0 && forecast.safe === false;
  }));
  return { status: checks.some(c => !c.passed) ? 'failed' : unavailableReasons.length ? 'unavailable' : 'passed',
    scope: 'Gate 2 pure public projection clauses only; physical conflict clause still pending',
    checks, unavailableReasons, physicalConflictStatus: 'pending',
    pendingMaskAgeSeconds: ownPending.snapshot.at - ownPending.publicFacts.projectedPending.at,
    pendingMaskActive: ownPending.snapshot.at - ownPending.publicFacts.projectedPending.at < DISCOVERY_RULES.feedbackWaitSeconds };
}

export function buildValidationProjectionBatch(input, { targetId, unrelatedTargetId, changedAppearance,
  changedGeneration, workOperation = 'inspect_object' } = {}) {
  const target = input?.facts?.view.objects.find(o => o.id === targetId);
  const current = target ? appearance(target) : null;
  const fixedOther = input?.facts?.view.objects.find(o => o.id !== targetId)?.id;
  const fixedAppearance = current ? { ...current, smell: current.smell === 'sour' ? 'sweet' : 'sour' } : null;
  const generation = input?.facts?.support[targetId]?.generation;
  const fixedGeneration = Number.isSafeInteger(generation) ? generation + 1 : null;
  const configurationMismatch = (unrelatedTargetId !== undefined && unrelatedTargetId !== fixedOther) ||
    (changedAppearance !== undefined && !same(changedAppearance, fixedAppearance)) ||
    (changedGeneration !== undefined && changedGeneration !== fixedGeneration) || workOperation !== 'inspect_object';
  unrelatedTargetId = fixedOther; changedAppearance = fixedAppearance; changedGeneration = fixedGeneration;
  const definitions = [
    ['held-reach', ['held', 'reach']], ['capacity', [1, 0]], ['sample-history', ['none', 'retained']],
    ['pending-binding', ['own', 'other']], ['appearance-generation', ['retained', 'changed']],
    ['operation-work', ['0', '1']], ['hunger', ['content', 'hungry']], ['digestion', ['empty', 'full']],
  ];
  const conditions = definitions.flatMap(([kind, values]) => values.map(value => ({ kind, value, targetId,
    ...(kind === 'pending-binding' ? { unrelatedTargetId } : {}),
    ...(kind === 'appearance-generation' && value === 'changed' ? { changedAppearance, changedGeneration } : {}),
    ...(kind === 'operation-work' ? { operation: workOperation } : {}) })))
    .concat(VALIDATION_PROJECTIONS.freshIds.map(value => ({ kind: 'fresh-identity', value, targetId })));
  const parity = projectValidationPublicRoot(input), results = conditions.map(condition => configurationMismatch ?
    unavailable(['batch-configuration-differs-from-pinned-prospective-schema'], { condition }) : projectValidationPublicRoot(input, condition));
  return freeze({ status: parity.status === 'available' && results.every(r => r.status === 'available') ? 'available' : 'unavailable',
    evidenceClass: 'pure-public-projection', adapterOutput: true, physicalObservations: 0,
    expectedConditions: 24, expectedEvaluations: 48, parity, conditions: results,
    schema: { targetId, unrelatedTargetId, changedAppearance, changedGeneration, workOperation },
    harmConflict: { status: 'pending', requiredRuns: ['H1-chronological', 'H2-reopen', 'H3-operation-at-H', 'H4-competing-duplicate'],
      reason: 'Physical conflict evidence is only admitted from the later authorized genuine H cases.' } });
}

export function evaluateValidationProjectionBatch({ input, onlineModel, frozenModel, ...options } = {}) {
  const before = { input: hash(input), onlineModel: hash(onlineModel), frozenModel: hash(frozenModel),
    nativeRng: hash(input?.provenance || null) };
  const batch = buildValidationProjectionBatch(input, options);
  if (!same(input?.native?.draws, VALIDATION_PROJECTIONS.draws)) return unavailable(['native-snapshot-does-not-retain-fixed-four-draws'], { batch,
    assessment: { status: 'unavailable', reasons: ['native-snapshot-does-not-retain-fixed-four-draws'], physicalConflictStatus: 'pending' },
    invariance: { before, after: copy(before) }, evaluations: 0 });
  // Fail the whole batch before scoring any incomplete condition; preserve all
  // 24 unavailable/available records rather than quietly reducing the census.
  if (batch.status !== 'available') return freeze({ ...batch, evaluations: 0,
    assessment: { status: 'unavailable', reasons: batch.conditions.flatMap(r => r.reasons || []), physicalConflictStatus: 'pending' },
    invariance: { before, after: { input: hash(input), onlineModel: hash(onlineModel),
      frozenModel: hash(frozenModel), nativeRng: hash(input?.provenance || null) } } });
  const conditions = batch.conditions.map(projected => {
    const queryObject = projected.snapshot.view.objects.find(o => o.id === projected.queryTargetId);
    const support = projected.publicFacts.support[projected.queryTargetId];
    const exposureQuery = { appearance: appearance(queryObject), digestion: projected.snapshot.view.body.digestion,
      ageSeconds: 0, horizonSeconds: 600, reported: channels(), censored: channels(),
      exactSupport: { F: support.F, W: support.W, H: support.H } };
    const queried = { ...projected, exposureQuery,
      online: { ...predictValidationPublicSnapshot(projected.snapshot, onlineModel), exposure: forecastExposure(onlineModel, exposureQuery) },
      frozen: { ...predictValidationPublicSnapshot(projected.snapshot, frozenModel), exposure: forecastExposure(frozenModel, exposureQuery) } };
    const conditionAfter = { input: hash(input), onlineModel: hash(onlineModel), frozenModel: hash(frozenModel), nativeRng: hash(input.provenance) };
    if (!same(before, conditionAfter)) throw new Error('A public projection changed its source/model/RNG provenance.');
    return { ...queried, projectionHashes: { snapshot: hash(projected.snapshot), publicFacts: hash(projected.publicFacts) },
      invariance: { scope: 'captured public input, numerical models and retained native RNG provenance',
        before: copy(before), after: conditionAfter, unchanged: true } };
  });
  const after = { input: hash(input), onlineModel: hash(onlineModel), frozenModel: hash(frozenModel), nativeRng: hash(input.provenance) };
  if (!same(before, after)) throw new Error('Public projection mutated its immutable source/model/RNG provenance.');
  return freeze({ ...batch, conditions, evaluations: 48, biologicalQualityWeight: 0, physicalQualityWeight: 0,
    assessment: assessProjectionResults(conditions, { before, after }),
    invariance: { before, after, unchanged: true },
    limits: ['counterfactual adapter output only', 'native physical roots remain authoritative',
      'native legacy scores for newly projected opportunities are unknown', 'no population calibration or safety conclusion'] });
}
