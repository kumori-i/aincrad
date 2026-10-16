/** Increment-A owner-scripted native-clock harness. Importing it runs no assay.
 * No production controller/save path imports this module. The original physics,
 * scheduler, ecological tick and chronological reward owner remain authoritative.
 */
import { isDeepStrictEqual } from 'node:util';
import { createNpc } from '../../src/npc-state.js';
import { createEnvironment } from '../../src/environment.js';
import { createCommunity } from '../../src/social.js';
import { canStand } from '../../src/world.js';
import { lineOfSight } from '../../src/perception.js';
import { cognitiveAction } from '../../src/cognition.js';
import { requestNpcAction } from '../../src/npc.js';
import { discoveryDecision } from '../../src/discovery.js';
import { isSleeping } from '../../src/biology.js';
import { DISCOVERY_RULES } from '../../src/discovery-config.js';
import { lookupEcologyObject } from '../../src/ecology.js';
import { beginTemporalDecision, recordTemporalFeedback } from '../../src/temporal-ledger.js';
import { temporalKey, trainTemporalReturns } from '../../src/temporal-returns.js';
import { encodeTemporalWire, temporalUtf8Bytes } from '../../src/temporal-storage.js';
import { FINITE_TEMPORAL_PROFILE } from '../../src/temporal-capacity.js';
import { FiniteTemporalDriver, finitePublicView } from './finite-temporal-driver.mjs';
import { finiteChoiceContext, interruptFiniteFocus, proposeFiniteChoice, commitFiniteChoice } from './finite-temporal-policy.mjs';
import { FINITE_CHECKPOINT, serializeFiniteCheckpoint, restoreFiniteCheckpoint } from './finite-temporal-checkpoint.mjs';
import { createReusableOutcomeModel, validateReusableOutcomeModel,
  updatePhysicalReceipt, updatePhysicalInterval, updateExposure,
  createReusableModelSession, reusableDictionaryDiagnostics,
  forecastCandidate, forecastPending, chooseMatched } from './reusable-outcome-model.mjs';
import { createReusableOutcomeSensor, validateReusableOutcomeSensor, snapshotReusableFeedback,
  recordReusableFeedback, observeReusableSubmission, observeReusableCompletion,
  observeReusableMaterials, advanceReusableSensor, beforeReusableProofEviction,
  noteReusableNativeClock, reusableCandidateFeatures, reusableMaterialSupport,
  reusableExposureUpdateBinding } from './reusable-outcome-sensor.mjs';

export const REUSABLE_FIXTURE = Object.freeze({ version: 1, seed: 74193, nativeStepSeconds: 1 / 60,
  actorBytes: 1024 * 1024, format: 'aincrad-reusable-prediction-checkpoint',
  designFingerprint: '8ca160becf1a67f7e33986a4435c4d06cb5666e28570a776031dff676e77b0d6' });
const copy = x => structuredClone(x);
const freeze = x => { if (x && typeof x === 'object') { Object.values(x).forEach(freeze); Object.freeze(x); } return x; };
const record = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const fingerprint = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const flags = bits => ({ F: Boolean(bits & 1), W: Boolean(bits & 2), H: Boolean(bits & 4) });
const sourceNumber = e => typeof e?.id === 'string' && /^feedback:[1-9]\d{0,9}$/.test(e.id) ? Number(e.id.slice(9)) : null;
function fail(message, code = 'REUSABLE_FIXTURE') { const error = new Error(message); error.code = code; throw error; }
function fields(value, names, label) {
  if (!record(value) || Object.keys(value).some(k => !names.includes(k)) || names.some(k => !Object.hasOwn(value, k))) fail(`Invalid ${label} fields; retain the original checkpoint.`);
}
function publicView(npc) { return { ...finitePublicView(npc), capacity: npc.inventory.capacity }; }
function ready(npc) { return !npc.active && npc.lifecycle === 'AWAKE' && !isSleeping(npc) && npc.elapsed >= npc.nextDecisionAt; }
function matchedSupport(sensor, memory, view, id) {
  return id ? reusableMaterialSupport(sensor, { memory, view, objectId: id }) :
    { F: false, W: false, H: false, applicable: false, unknown: true, firsthand: { F: 0, W: 0, H: 0 }, generation: null };
}
const emptyAdmission = () => ({ deniedSubmissions: 0, deniedBatches: 0, lastDenial: null, exposures: [] });
function validateAdmission(raw, at, sensor = null, model = null) {
  fields(raw, ['deniedSubmissions', 'deniedBatches', 'lastDenial', 'exposures'], 'capacity admission');
  if (['deniedSubmissions', 'deniedBatches'].some(k => !Number.isSafeInteger(raw[k]) || raw[k] < 0 || raw[k] > 1e9)) fail('Invalid admission counter.');
  if (raw.lastDenial !== null) {
    fields(raw.lastDenial, ['at', 'kind', 'code', 'keys', 'dictionaryBytes'], 'capacity denial');
    const r = raw.lastDenial;
    if (!Number.isFinite(r.at) || r.at < 0 || r.at > at || !['submission', 'batch'].includes(r.kind) ||
        !['REUSABLE_COMBINED_CAPACITY', 'REUSABLE_CAPACITY'].includes(r.code) ||
        !Number.isSafeInteger(r.keys) || r.keys < 0 || !Number.isSafeInteger(r.dictionaryBytes) || r.dictionaryBytes < 0) fail('Invalid capacity denial.');
  }
  if (!Array.isArray(raw.exposures) || raw.exposures.length > 64) fail('Invalid numerical exposure admission capacity.');
  const ids = new Set();
  for (const row of raw.exposures) {
    fields(row, ['ingestionId', 'birthSequence', 'lastSequence', 'admitted', 'censored'], 'numerical exposure admission');
    if (typeof row.ingestionId !== 'string' || !/^ingestion:[1-9]\d{0,9}$/.test(row.ingestionId) || ids.has(row.ingestionId) ||
        !Number.isSafeInteger(row.birthSequence) || row.birthSequence < 1 || !Number.isSafeInteger(row.lastSequence) ||
        row.lastSequence < row.birthSequence || row.lastSequence > 1e9 || typeof row.admitted !== 'boolean' ||
        !Number.isSafeInteger(row.censored) || row.censored < 0 || row.censored > 7 || !row.admitted && row.censored !== 7) fail('Invalid numerical exposure admission.');
    ids.add(row.ingestionId);
    if (sensor && (!sensor.exposures.some(e => e.id === row.ingestionId) || row.lastSequence > sensor.updateSequence)) fail('Unbound numerical exposure admission.');
    if (model && row.admitted && row.birthSequence > model.cursors.exposure.sequence) fail('Unproved numerical exposure birth.');
  }
  if (sensor && sensor.exposures.some(e => !ids.has(e.id))) fail('Missing numerical exposure admission; do not infer it from a pooled row.');
  return copy(raw);
}
/** The two dictionaries are physically separate, so repeated strings count twice.
 * Include each actual JSON array's delimiters, separators, escapes and UTF-8.
 */
export function reusableCombinedDictionaryBudget({ memory, model, reservedContextKey = null }) {
  const oldKeys = memory?.contextKeys || (memory?.encoding ? memory.keys : null), newKeys = model?.keys;
  if (!Array.isArray(oldKeys) || !Array.isArray(newKeys) || [...oldKeys, ...newKeys].some(k => typeof k !== 'string') ||
      reservedContextKey !== null && typeof reservedContextKey !== 'string') fail('Invalid combined dictionary inputs.');
  const legacy = reservedContextKey !== null && !oldKeys.includes(reservedContextKey) ? [...oldKeys, reservedContextKey] : oldKeys;
  const newBytes = Array.isArray(model.rows) ? reusableDictionaryDiagnostics(model).dictionaryBytes : temporalUtf8Bytes(newKeys);
  const result = { keys: legacy.length + newKeys.length, dictionaryBytes: temporalUtf8Bytes(legacy) + newBytes,
    legacyKeys: legacy.length, reusableKeys: newKeys.length, limitKeys: 512, limitBytes: 256 * 1024 };
  if (result.keys > result.limitKeys || result.dictionaryBytes > result.limitBytes) {
    const error = new Error('Combined legacy and reusable dictionaries exceed the frozen capacity; preserve all prior facts.');
    error.code = 'REUSABLE_COMBINED_CAPACITY'; error.dictionary = result; throw error;
  }
  return result;
}

/** Frozen owner setup, not a discovery or a seed/source search. No body overrides. */
export function createReusablePredictionState() {
  const environment = createEnvironment(REUSABLE_FIXTURE.seed, { mode: 'discovery' });
  const source = environment.ecology.plants.find(p => p.kind === 'apple_tree' && p.quantity > 0);
  if (!source?.position) fail('The fixed first positive-quantity source is unavailable.');
  const offsets = [[45, 0], [-45, 0], [0, -45], [0, 45]], names = ['east', 'west', 'north', 'south'];
  const approaches = offsets.map(([x, y], i) => {
    const position = { x: source.position.x + x, y: source.position.y + y };
    return { direction: names[i], position, collisionValid: canStand(position.x, position.y, 'valley'),
      inReach: Math.hypot(x, y) <= DISCOVERY_RULES.reach, lineOfSight: lineOfSight(position, source.position, 'valley') };
  });
  const approach = approaches.find(p => p.collisionValid);
  if (!approach || !approach.inReach || !approach.lineOfSight) fail('The first fixed collision-valid approach is unavailable; no replacement is permitted.');
  const npc = createNpc({ id: 'aster', mode: 'discovery', seed: REUSABLE_FIXTURE.seed });
  npc.position = copy(approach.position);
  const state = { elapsed: 0, simulationMode: 'discovery', environment, agents: [npc], npc, community: createCommunity(), cardinal: null };
  return { state, owner: freeze({ sourceId: source.id, source: copy(source), approach: copy(approach), approaches,
    physicalSeed: REUSABLE_FIXTURE.seed, bodyOverrides: {}, resourceOverrides: {} }) };
}

/** No autonomy. Every action comes from an explicit owner script. */
export class ReusablePredictionFixture extends FiniteTemporalDriver {
  constructor(state, { model = null, sensor = null, predictionArm = 'online', sensorEnabled = true,
    sourceFingerprint = null, selectorSeed = 1729, selector = null, driver = null,
    pendingDisposition = null, admission = null, sink = null, now = () => performance.now() } = {}) {
    if (!['online', 'frozen'].includes(predictionArm) || typeof sensorEnabled !== 'boolean' || sourceFingerprint !== null && !fingerprint(sourceFingerprint)) fail('Invalid experimental harness options.');
    // Defer a real completed-but-uncaptured pending receipt until the restored
    // sensor is attached. Interrupted commands retain the engine restart rules.
    super(state, { arm: 'frozen-zero', automatic: false, selectorSeed, selector, driver,
      pendingDisposition: pendingDisposition?.status === 'pending' ? null : pendingDisposition, sink, now });
    this.predictionArm = predictionArm; this.sensorEnabled = sensorEnabled; this.sourceFingerprint = sourceFingerprint;
    this.model = model ? validateReusableOutcomeModel(model, this.npc.elapsed) : createReusableOutcomeModel();
    this.modelSession = createReusableModelSession(this.model, this.npc.elapsed); this.model = this.modelSession.snapshot();
    this.sensor = sensor ? validateReusableOutcomeSensor(sensor, { memory: this.memory, view: publicView(this.npc), at: this.npc.elapsed, continuous: true }) : createReusableOutcomeSensor({ at: this.npc.elapsed });
    this.admission = validateAdmission(admission || emptyAdmission(), this.npc.elapsed, this.sensor, this.model);
    this.reservedContextKey = null;
    reusableCombinedDictionaryBudget({ memory: this.memory, model: this.model });
    // native: O(1) clock note; bookkeeping: all sensor/proof/batch construction
    // hooks excluding numerical updates; batches: numerical admission/update.
    this.predictionTimings = { native: [], bookkeeping: [], batches: [], decisions: [] };
    if (sensor && !isDeepStrictEqual(this.sensor, sensor)) fail('Saved sensor is not canonical; retain the original checkpoint.');
    if (pendingDisposition?.status === 'pending') this.captureCompletion();
  }
  get n() { return this.npc; }
  predictionTiming(kind, start) {
    const rows = this.predictionTimings?.[kind]; if (!rows) return;
    rows.push(this.now() - start); if (rows.length > 4096) rows.shift();
  }
  sensorBookkeeping(fn) {
    const start = this.now();
    try { return fn(); } finally { this.predictionTiming('bookkeeping', start); }
  }
  applyLabels(labels) {
    if (!this.sensorEnabled || !labels) return;
    const any = labels.receiptUpdates.length || labels.intervalUpdates.length || labels.exposureUpdates.length;
    if (!any) {
      if (this.sensor.integrityFailure) fail(`Unsupported sensor integrity condition: ${this.sensor.integrityFailure}`, 'REUSABLE_INTEGRITY');
      return;
    }
    const start = this.now(), numerical = [];
    // Independent factual streams commit label-by-label. A new physical row
    // cannot roll back a different exposure's already monitored risk interval.
    for (const [kind, rows, update] of [['receipt', labels.receiptUpdates, updatePhysicalReceipt],
      ['interval', labels.intervalUpdates, updatePhysicalInterval]]) {
      for (const row of rows) numerical.push({ kind, sequence: row.sequence,
        admitted: this.predictionArm === 'online' ? this.admitNumericalLabel(update, row) : false });
    }
    for (const row of labels.exposureUpdates) {
      const ingestionId = reusableExposureUpdateBinding(row);
      if (!ingestionId) fail('Numerical exposure label lost its canonical sensor provenance.', 'REUSABLE_INTEGRITY');
      let state = this.admission.exposures.find(e => e.ingestionId === ingestionId);
      if (state && row.sequence <= state.lastSequence) continue;
      if (row.ingestions === 1) {
        if (state) fail('Repeated numerical birth for one exposure.', 'REUSABLE_INTEGRITY');
        // A completed capture can first flush/censor the retiring exposure and
        // then admit its successor. Never retain more than the declared 64.
        this.pruneNumericalExposures();
        if (this.admission.exposures.length >= 64) fail('Numerical exposure admission capacity exhausted.');
        state = { ingestionId, birthSequence: row.sequence, lastSequence: row.sequence, admitted: false, censored: 7 };
        this.admission.exposures.push(state);
        if (this.predictionArm === 'online' && this.admitNumericalLabel(updateExposure, row)) { state.admitted = true; state.censored = 0; }
      } else {
        if (!state) fail('Missing numerical birth provenance for an exposure label.', 'REUSABLE_INTEGRITY');
        state.lastSequence = row.sequence;
        if (this.predictionArm === 'frozen') state.censored = 7;
        const increments = row.increments.filter(i => !(state.censored & (1 << ['F', 'W', 'H'].indexOf(i.channel))));
        if (state.admitted && increments.length && !this.admitNumericalLabel(updateExposure, { ...row, increments })) {
          for (const i of increments) state.censored |= 1 << ['F', 'W', 'H'].indexOf(i.channel);
        }
      }
      numerical.push({ kind: 'exposure', sequence: row.sequence, ingestionId, admitted: state.admitted, censored: state.censored });
    }
    this.pruneNumericalExposures();
    this.predictionTiming('batches', start);
    if (any) this.emit({ type: 'prediction-labels', at: this.npc.elapsed, predictionArm: this.predictionArm, labels, numerical });
    if (this.sensor.integrityFailure) fail(`Unsupported sensor integrity condition: ${this.sensor.integrityFailure}`, 'REUSABLE_INTEGRITY');
  }
  pruneNumericalExposures() {
    const ids = new Set(this.sensor.exposures.map(e => e.id));
    this.admission.exposures = this.admission.exposures.filter(e => ids.has(e.ingestionId));
  }
  admitNumericalLabel(update, row) {
    // Runtime-only ownership of immutable snapshots. Explicit parameter swaps
    // reconstruct/validate the cache; mutable caller objects are never trusted.
    if (!this.modelSession || this.modelSession.snapshot() !== this.model) {
      this.modelSession = createReusableModelSession(this.model, this.npc.elapsed); this.model = this.modelSession.snapshot();
    }
    const kind = update === updatePhysicalReceipt ? 'receipt' : update === updatePhysicalInterval ? 'interval' : update === updateExposure ? 'exposure' : null;
    if (!kind) fail('Unknown numerical label kind.');
    try {
      const result = this.modelSession.apply(kind, row, { admit: candidate =>
        reusableCombinedDictionaryBudget({ memory: this.memory, model: candidate, reservedContextKey: this.reservedContextKey }) });
      if (result.admitted) this.model = this.modelSession.snapshot();
      return result.admitted;
    } catch (error) {
      if (!['REUSABLE_COMBINED_CAPACITY', 'REUSABLE_CAPACITY'].includes(error.code)) throw error;
      this.capacityDenied('batch', error); return false;
    }
  }
  capacityDenied(kind, error) {
    const field = kind === 'submission' ? 'deniedSubmissions' : 'deniedBatches';
    if (this.admission[field] >= 1e9) fail('Capacity admission diagnostic counter exhausted.');
    const dictionary = error.dictionary || reusableCombinedDictionaryBudget({ memory: this.memory, model: this.model });
    this.admission[field]++;
    this.admission.lastDenial = { at: this.npc.elapsed, kind, code: error.code, keys: dictionary.keys, dictionaryBytes: dictionary.dictionaryBytes };
    this.emit({ type: 'prediction-capacity-denial', ...copy(this.admission.lastDenial) });
  }
  boundary() {
    if (this.sensorEnabled) this.applyLabels(this.sensorBookkeeping(() => advanceReusableSensor(this.sensor, { memory: this.memory, at: this.npc.elapsed, continuous: true })));
  }
  beforeEviction({ receiptSeqs = [], ingestionIds = [] } = {}) {
    if (this.sensorEnabled) this.applyLabels(this.sensorBookkeeping(() => beforeReusableProofEviction(this.sensor, { memory: this.memory, at: this.npc.elapsed, receiptSeqs, ingestionIds })));
  }
  captureFeedback() {
    if (!this.sensor || !this.sensorEnabled) return super.captureFeedback();
    const n = this.npc, memory = this.memory;
    for (const event of n.physiology.feedback) {
      const source = sourceNumber(event); if (source !== null && source <= memory.feedbackCursor) continue;
      if (event.at !== n.elapsed) fail('Native sensor missed the biological emission timestamp.');
      const before = this.sensorBookkeeping(() => snapshotReusableFeedback(memory, event));
      const admitted = recordTemporalFeedback(memory, event, { now: n.elapsed });
      // The ledger boolean concerns reward ownership, never label admission.
      this.applyLabels(this.sensorBookkeeping(() => recordReusableFeedback(this.sensor, { before, memory, event, now: n.elapsed })));
      this.emit({ type: 'feedback', at: n.elapsed, admitted, event });
    }
  }
  captureCompletion() {
    if (!this.sensor || !this.sensorEnabled) return super.captureCompletion();
    const p = this.pending, n = this.npc, r = n.lastResult;
    if (!p || n.active || !r || r.eventId <= p.previousEventId) return super.captureCompletion();
    this.boundary();
    if (p.action.type === 'sample' && r.ok === true && r.code === 'SWALLOWED' && r.ingestionId &&
      !this.memory.ingestions.some(i => i.id === r.ingestionId) && this.memory.ingestions.length >= FINITE_TEMPORAL_PROFILE.ingestions) {
      this.beforeEviction({ ingestionIds: [this.memory.ingestions[0].id] });
    }
    const seq = p.seq;
    super.captureCompletion();
    this.applyLabels(this.sensorBookkeeping(() => observeReusableCompletion(this.sensor, { memory: this.memory, seq, view: publicView(n) })));
  }
  tickActor(dt) {
    const senseAt = this.controller.senseAt;
    // Parent still owns tickNpc, biological-before-completion order, awake
    // discovery processing and its real ~1 s observation/cognition schedule.
    super.tickActor(dt);
    const start = this.now();
    noteReusableNativeClock(this.sensor, { at: this.npc.elapsed });
    this.predictionTiming('native', start);
    if (!this.sensorEnabled) return;
    if ((isSleeping(this.npc) || this.npc.lifecycle !== 'AWAKE') && this.sensor.materials.some(m => m.known)) {
      this.sensorBookkeeping(() => observeReusableMaterials(this.sensor, { view: publicView(this.npc), observationAt: this.sensor.observationAt ?? this.npc.elapsed, observedIds: [], continuous: false }));
    }
    if (this.controller.senseAt !== senseAt) {
      const view = publicView(this.npc), observationAt = this.controller.senseAt;
      this.sensorBookkeeping(() => observeReusableMaterials(this.sensor, { view, observationAt,
        observedIds: view.objects.filter(o => o.observedAt === observationAt).map(o => o.id), continuous: true }));
      this.boundary();
    }
  }
  /** Same authoritative submit sequence as the base driver, with hooks placed
   * before proof eviction and after the actual begin (before immediate outcome).
   * Policy proposals are intentionally not accepted: this is a scripted fixture.
   */
  submit(raw, { context = null, reason = '', need = 'understanding' } = {}) {
    const n = this.npc, memory = this.memory, c = this.controller, at = n.elapsed, epoch = n.epoch;
    if (!ready(n)) { this.unsubmitted++; return false; }
    if (this.pending) fail('Previous physical submission has no authoritative completion.');
    const action = cognitiveAction(n, raw);
    if (!action) fail('Scripted action failed common action normalization.');
    const view = freeze(publicView(n)), actualContext = context || finiteChoiceContext(view, memory, { action }, null), beforeId = n.lastResult?.eventId || 0;
    const contextKey = temporalKey(actualContext, action.type);
    try { reusableCombinedDictionaryBudget({ memory, model: this.model, reservedContextKey: contextKey }); }
    catch (error) {
      if (error.code !== 'REUSABLE_COMBINED_CAPACITY') throw error;
      this.capacityDenied('submission', error); this.unsubmitted++; return false;
    }
    // Reserve the actual old-ledger key while a decision-boundary label batch
    // attempts numerical admission. No request, RNG or ledger cursor is spent
    // if the upfront dictionary test fails.
    this.reservedContextKey = contextKey;
    try {
      this.boundary();
      const result = requestNpcAction(n, action, this.state.environment);
      if (n.elapsed !== at) fail('Submission advanced the physical clock.');
      const started = n.active && n.active.startedAt === at && isDeepStrictEqual(n.active.request, action);
      const immediate = !n.active && n.lastResult?.eventId > beforeId && n.lastResult.at === at && n.lastResult.action === action.type;
      if (!started && !immediate) {
        this.unsubmitted++; if (['ACTION_BUSY', 'ASLEEP', 'UNCONSCIOUS'].includes(result?.code)) return false;
        fail('No authoritative scripted submission.');
      }
      if (n.epoch !== epoch && !['enter_shelter', 'exit_shelter'].includes(action.type)) fail('Unexpected physical submission epoch change.');
      if (memory.receipts.length >= FINITE_TEMPORAL_PROFILE.receipts) this.beforeEviction({ receiptSeqs: [memory.receipts[0].seq] });
      interruptFiniteFocus(this.selector);
      const seq = beginTemporalDecision(memory, { at, context: actualContext, action });
      this.pending = { seq, action: copy(action), previousEventId: beforeId }; this.submissions++;
      if (this.sensorEnabled) this.applyLabels(this.sensorBookkeeping(() => observeReusableSubmission(this.sensor, { memory, seq, view })));
      this.emit({ type: 'submission', at, seq, action, need, reason, ordinary: false });
      this.captureCompletion();
      trainTemporalReturns(memory.model, { mode: 'frozen' });
      if (n.epoch !== c.epoch) { c.cancel(); c.epoch = n.epoch; n.discovery.run = null; interruptFiniteFocus(this.selector); }
      return true;
    } finally { this.reservedContextKey = null; }
  }
  /** Reads cached perception. It never calls observeNpc or spends a free sense. */
  observe() { return freeze(publicView(this.npc)); }
  stepFrames(frames = 1) {
    if (!Number.isSafeInteger(frames) || frames < 0) fail('Invalid native frame count.');
    for (let i = 0; i < frames; i++) this.step(REUSABLE_FIXTURE.nativeStepSeconds);
    return this.npc.elapsed;
  }
  stepUntil(at) {
    if (!Number.isFinite(at) || at < this.npc.elapsed) fail('Native fixture cannot reverse time.');
    while (this.npc.elapsed + 1e-10 < at) this.step(REUSABLE_FIXTURE.nativeStepSeconds);
    return this.npc.elapsed;
  }
  act(action, { maxFrames = 1200 * 60 + 120, ...options } = {}) {
    if (!Number.isSafeInteger(maxFrames) || maxFrames < 1) fail('Invalid scripted action watchdog.');
    let frames = 0;
    while (!ready(this.npc) && frames++ < maxFrames) this.step(REUSABLE_FIXTURE.nativeStepSeconds);
    if (!ready(this.npc)) fail('Scripted action could not reach a genuine scheduler opportunity.');
    const seq = this.memory.nextSeq;
    if (!this.submit(action, options)) fail('Scripted action was not submitted.');
    while (this.pending && frames++ < maxFrames) this.step(REUSABLE_FIXTURE.nativeStepSeconds);
    if (this.pending || this.npc.active) fail('Scripted action has not physically completed.');
    return freeze(copy(this.memory.receipts.find(r => r.seq === seq)));
  }
  /** Immutable actual root set. Existing masks/care are evaluated on a copy. */
  candidateSnapshot({ draws: suppliedDraws = null } = {}) {
    if (suppliedDraws !== null && (!Array.isArray(suppliedDraws) || suppliedDraws.length !== 4 ||
      suppliedDraws.some(d => !Number.isFinite(d) || d < 0 || d >= 1))) fail('Candidate preview requires exactly four unit-interval draws.');
    const start = this.now(), actor = copy(this.npc);
    const decision = discoveryDecision(actor, { foodLearning: false, ordinaryProposal: true });
    const view = publicView(actor), memory = this.memory, available = ready(this.npc);
    let rng = this.selector.rng;
    const nativeDraws = Array.from({ length: 4 }, () => { rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0; return rng / 4294967296; });
    const draws = suppliedDraws ? [...suppliedDraws] : nativeDraws;
    const previewSelector = copy(this.selector);
    if (decision.ordinary) {
      const preview = proposeFiniteChoice(view, memory, previewSelector, decision.ordinary);
      commitFiniteChoice(previewSelector, preview);
      // Keep the native validity/transfer-proof decision. Only an absent or
      // expired focus uses draw zero; owner-declared matched draws are preview
      // inputs and never commit the live selector or its RNG.
      const prior = this.selector.focus;
      const preserved = prior && isDeepStrictEqual(previewSelector.focus, { ...prior, used: prior.used + 1 });
      if (suppliedDraws && !preserved) {
        const eligible = view.objects.filter(o => view.held.includes(o.id) || o.scene === view.scene &&
          view.at - o.observedAt < 8 && Math.hypot(view.position.x - o.position.x, view.position.y - o.position.y) <= view.reach);
        previewSelector.focus = eligible.length ? { objectId: eligible[Math.floor(draws[0] * eligible.length)].id, startedAt: view.at, used: 1 } : null;
      }
    }
    const rows = decision.ordinary?.choices || (decision.action ? [{ action: decision.action, reason: decision.reason }] : []);
    const candidates = rows.map((candidate, index) => {
      const id = candidate.action.targetId || candidate.bindingId || null;
      const support = matchedSupport(this.sensor, memory, view, id);
      const context = finiteChoiceContext(view, memory, candidate, previewSelector.focus);
      return { index, ...copy(candidate), context, features: reusableCandidateFeatures(this.sensor, { memory, view, action: candidate.action }),
        eligibility: available, bindingsValid: !id || Boolean(view.objects.some(o => o.id === id)), exactSupport: { F: support.F, W: support.W, H: support.H },
        support, focus: context.focus || context.outputOfFocus };
    });
    const exposures = this.sensor.exposures.map(e => ({ appearance: copy(e.appearance), digestion: e.body.digestion,
      ageSeconds: view.at - e.at, reported: flags(e.admitted), censored: flags(e.censored), exactSupport: flags(e.admitted) }));
    const snapshot = freeze({ at: view.at, epoch: actor.epoch, nextSeq: memory.nextSeq, view, ready: available,
      ordinary: Boolean(decision.ordinary), need: decision.need, reason: decision.reason || '',
      opportunity: copy(decision.ordinary || null), selector: copy(this.selector), previewSelector, draws, candidates, exposures });
    this.predictionTiming('decisions', start); return snapshot;
  }
  /** Pure predictions on one saved public snapshot; no new sense or model update. */
  predict(snapshot = this.candidateSnapshot(), model = this.model, { draws = null } = {}) {
    const forecasts = snapshot.candidates.map(c => forecastCandidate(model, { features: c.features,
      eligibility: c.eligibility, bindingsValid: c.bindingsValid, currentSensations: snapshot.view.body, exactSupport: c.exactSupport }));
    const pending = forecastPending(model, snapshot.exposures);
    const choice = draws && snapshot.ready && snapshot.candidates.length ? chooseMatched(snapshot.candidates, forecasts, { draws }) : null;
    return freeze({ at: snapshot.at, forecasts, pending, choice });
  }
  freezeParameters() { this.predictionArm = 'frozen'; return freeze(copy(this.model)); }
  checkpoint(options = {}) { return serializeReusablePredictionCheckpoint(this, options); }
  serializeCheckpoint(options = {}) { return this.checkpoint(options); }
}

export function createReusablePredictionFixture(options = {}) {
  const { state, owner } = createReusablePredictionState();
  const fixture = new ReusablePredictionFixture(state, options);
  fixture.owner = owner; return fixture;
}

/** The single explicitly authorized copied-world material intervention.
 * It never refills stock, changes chemistry, moves an object, or supplies a label.
 */
export function ageRemainingReusableMaterial(fixture, objectId) {
  const material = lookupEcologyObject(fixture.state.environment.ecology, objectId);
  const prior = fixture.memory.ingestions.find(i => i.objectId === objectId && fixture.memory.receipts.some(r =>
    r.seq === i.seq && r.request.type === 'sample' && r.request.targetId === objectId && r.outcome?.ok &&
    r.outcome.code === 'SWALLOWED' && r.outcome.ingestionId === i.id && r.outcome.actionId === i.actionId));
  if (!material || !fixture.state.environment.ecology.materials.some(m => m.id === objectId) || material.heldBy !== fixture.npc.id ||
      !fixture.npc.inventory.items.includes(objectId) || !(material.massGrams > 0) || !prior ||
      !Number.isFinite(material.ageHours) || typeof material.spoiled !== 'boolean') fail('A genuinely remaining held finite material with its prior successful swallow proof is required.');
  const before = copy(material);
  material.ageHours = 288; material.spoiled = true;
  const after = copy(material);
  return freeze({ intervention: 'remaining-material-age-288h-existing-spoil', at: fixture.npc.elapsed, objectId, before, after });
}

/** Exact combined actor-only envelope used by the full encoder byte gate.
 * Resource fixtures may call this without constructing or ticking a world.
 */
export function reusablePredictionActorEnvelope({ actor, selector, driver, model, sensor, sourceFingerprint, predictionArm = 'online', sensorEnabled = true, admission = emptyAdmission() }) {
  if (!fingerprint(sourceFingerprint) || !['online', 'frozen'].includes(predictionArm) || typeof sensorEnabled !== 'boolean') fail('Invalid actor envelope metadata.');
  reusableCombinedDictionaryBudget({ memory: actor.discovery.temporal, model });
  admission = validateAdmission(admission, actor.elapsed);
  const encoded = { ...actor, discovery: { ...actor.discovery, temporal: encodeTemporalWire(actor.discovery.temporal) } };
  return { format: REUSABLE_FIXTURE.format, version: 1, designFingerprint: REUSABLE_FIXTURE.designFingerprint, predictionArm, sensorEnabled,
    model, sensor, admission, finite: { format: FINITE_CHECKPOINT.format, version: FINITE_CHECKPOINT.version, profile: { ...FINITE_TEMPORAL_PROFILE },
      arm: 'frozen-zero', sourceFingerprint, selector, driver, actor: encoded } };
}
export function reusableActorBytes(input) { return temporalUtf8Bytes(reusablePredictionActorEnvelope(input)); }

function combinedActorBytes(raw, actor = raw.finite.state.agents[0]) {
  const { finite, ...outer } = raw, { state, ...metadata } = finite;
  return temporalUtf8Bytes({ ...outer, finite: { ...metadata, actor } });
}
function enforceBudget(raw, actor) {
  const bytes = combinedActorBytes(raw, actor);
  if (bytes > REUSABLE_FIXTURE.actorBytes) fail('Whole encoded actor including legacy evidence, model and sensor exceeds 1 MiB; retain original source.', 'REUSABLE_ACTOR_BUDGET');
  return bytes;
}
/** Pure serialization: pending monitored intervals are saved, never flushed. */
export function serializeReusablePredictionCheckpoint(fixture, { sourceFingerprint = fixture.sourceFingerprint } = {}) {
  if (!fingerprint(sourceFingerprint)) fail('A verified source fingerprint is required for an experiment checkpoint.');
  const model = validateReusableOutcomeModel(fixture.model, fixture.npc.elapsed);
  const sensor = validateReusableOutcomeSensor(fixture.sensor, { memory: fixture.memory, view: publicView(fixture.npc), at: fixture.npc.elapsed, continuous: true });
  const admission = validateAdmission(fixture.admission, fixture.npc.elapsed, fixture.sensor, model);
  reusableCombinedDictionaryBudget({ memory: fixture.memory, model });
  if (!isDeepStrictEqual(sensor, fixture.sensor)) fail('Sensor validation would change live evidence; retain original source.');
  const finite = JSON.parse(serializeFiniteCheckpoint({ state: fixture.state, selector: fixture.selector,
    driver: fixture.checkpointDriver(), arm: 'frozen-zero', sourceFingerprint }));
  const raw = { format: REUSABLE_FIXTURE.format, version: 1, designFingerprint: REUSABLE_FIXTURE.designFingerprint,
    predictionArm: fixture.predictionArm, sensorEnabled: fixture.sensorEnabled, finite, model, sensor, admission };
  // Check supplied ordinary memory too: canonicalization cannot rescue size.
  const encodedActor = finite.state.agents[0];
  enforceBudget(raw, { ...fixture.npc, discovery: { ...fixture.npc.discovery, temporal: encodedActor.discovery.temporal } });
  enforceBudget(raw);
  return JSON.stringify(raw);
}
/** Strict separate envelope. No production save migration, reset, or repair. */
export function restoreReusablePredictionCheckpoint(text, { expectedSourceFingerprint, expectedPredictionArm } = {}) {
  if (typeof text !== 'string') fail('Checkpoint input must be its original JSON text.');
  let raw; try { raw = JSON.parse(text); } catch { fail('Invalid prediction checkpoint JSON; retain the original source.'); }
  fields(raw, ['format', 'version', 'designFingerprint', 'predictionArm', 'sensorEnabled', 'finite', 'model', 'sensor', 'admission'], 'prediction envelope');
  if (raw.format !== REUSABLE_FIXTURE.format || raw.version !== 1 || raw.designFingerprint !== REUSABLE_FIXTURE.designFingerprint ||
      !['online', 'frozen'].includes(raw.predictionArm) || typeof raw.sensorEnabled !== 'boolean' ||
      expectedPredictionArm !== undefined && expectedPredictionArm !== raw.predictionArm) fail('Checkpoint protocol/arm mismatch; retain original source.');
  if (!record(raw.finite) || !record(raw.finite.state) || !Array.isArray(raw.finite.state.agents) || !raw.finite.state.agents[0]) fail('Missing finite checkpoint.');
  reusableCombinedDictionaryBudget({ memory: raw.finite.state.agents[0].discovery?.temporal, model: raw.model });
  enforceBudget(raw);
  const restored = restoreFiniteCheckpoint(JSON.stringify(raw.finite), { expectedArm: 'frozen-zero', expectedSourceFingerprint });
  const n = restored.state.agents[0], model = validateReusableOutcomeModel(raw.model, n.elapsed);
  const sensor = validateReusableOutcomeSensor(raw.sensor, { memory: n.discovery.temporal, view: publicView(n), at: n.elapsed, continuous: true });
  const admission = validateAdmission(raw.admission, n.elapsed, sensor, model);
  if (!isDeepStrictEqual(sensor, raw.sensor)) fail('Restored sensor is not canonical; retain original source.');
  return { ...restored, model, sensor, admission, predictionArm: raw.predictionArm, sensorEnabled: raw.sensorEnabled,
    sourceFingerprint: expectedSourceFingerprint, actorBytes: enforceBudget(raw) };
}
export function reopenReusablePredictionFixture(text, options = {}) {
  const restored = restoreReusablePredictionCheckpoint(text, options);
  return new ReusablePredictionFixture(restored.state, { ...restored, sink: options.sink, now: options.now });
}
export function reusablePredictionActorBytes(text) {
  if (typeof text !== 'string') fail('Actor byte accounting needs the encoded checkpoint text.');
  const raw = JSON.parse(text);
  reusableCombinedDictionaryBudget({ memory: raw.finite?.state?.agents?.[0]?.discovery?.temporal, model: raw.model });
  return combinedActorBytes(raw);
}
