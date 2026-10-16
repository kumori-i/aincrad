/** Research-only, finite validation dispatcher. Importing this module does no work.
 * One invocation owns ONE declared case. It never reads files, launches a child,
 * retries a recipe, runs a successor, changes the original artifacts, or enables
 * autonomy. The caller supplies admitted artifacts and synchronous durable hooks.
 * Physical availability has NOT been established by implementation/harness tests.
 */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { createEnvironment } from '../../src/environment.js';
import { createNpc } from '../../src/npc-state.js';
import { createCommunity } from '../../src/social.js';
import { canStand } from '../../src/world.js';
import { lineOfSight } from '../../src/perception.js';
import { isSleeping } from '../../src/biology.js';
import { lookupEcologyObject } from '../../src/ecology.js';
import { DISCOVERY_RULES } from '../../src/discovery-config.js';
import { ReusablePredictionFixture, REUSABLE_FIXTURE, createReusablePredictionFixture,
  reopenReusablePredictionFixture, ageRemainingReusableMaterial } from './reusable-prediction-fixture.mjs';
import { forecastCandidate, forecastExposure, forecastPending, createReusableModelSession } from './reusable-outcome-model.mjs';
import { reusableExposureUpdateBinding, reusableMaterialSupport, snapshotReusableFeedback, recordReusableFeedback } from './reusable-outcome-sensor.mjs';
import { recordTemporalFeedback } from '../../src/temporal-ledger.js';
import { VALIDATION_CENSUS } from './reusable-validation-evidence.mjs';

const copy = x => structuredClone(x);
const freeze = x => { if (x && typeof x === 'object' && !Object.isFrozen(x)) { Object.values(x).forEach(freeze); Object.freeze(x); } return x; };
const sha = text => createHash('sha256').update(text).digest('hex');
const hash = x => sha(JSON.stringify(x));
const fingerprint = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const EPS = 1e-9, DT = REUSABLE_FIXTURE.nativeStepSeconds;
const channels = ['F', 'W', 'H'];
const flags = bits => Object.fromEntries(channels.map((c, i) => [c, Boolean(bits & (1 << i))]));
const zeroFlags = () => ({ F: false, W: false, H: false });
const action = (type, targetId) => type === 'wait' ? { type, seconds: 5 } : { type, targetId };

export const VALIDATION_PRODUCER = freeze({ version: 1,
  protocolFingerprint: '6932769d221eb7ba33958dee5d48fb9d8cb9294a7f409157824a1cd2de834423',
  seed: 74193, nativeStepSeconds: DT, draws: [.5, .5, .5, .5], physicalAvailability: 'untested',
  maxSubmissions: 50, readyWatchdogSeconds: 2, shortActionWatchdogSeconds: 30,
  runWallMs: 300000, returnedWorkMs: 1000,
  cases: [
    { runId: 'T0-common-apple', parent: null, operations: ['pull', 'inspect_object', 'strike', 'release', 'grasp', 'wait', 'sample', 'wait', 'wait'] },
    { runId: 'P1-fresh-prefix', parent: 'A0', operations: ['sample'] },
    ...['inspect_object', 'wait', 'strike', 'release', 'release', 'strike', 'wait', 'inspect_object'].map((operation, i) => ({
      runId: `C${i + 1}-${i < 4 ? 'early' : 'late'}-${operation === 'inspect_object' ? 'inspect' : operation}`,
      parent: 'A1', operations: [operation, 'wait'], triggerAgeSeconds: i < 4 ? 20 : 35, endpointAgeSeconds: 90,
      referenceRun: i < 4 ? 'C1-early-inspect' : 'C5-late-release' })),
    ...['chronological', 'reopen', 'operation-at-H', 'competing-duplicate'].map((name, i) => ({
      runId: `H${i + 1}-${name}`, parent: 'A0', operations: ['sample', 'release', 'grasp', 'inspect_object', 'wait', ...(i === 2 ? ['wait'] : [])] })),
    { runId: 'B1-small-exhausted', parent: null, operations: ['pull', 'sample', 'sample'] },
    { runId: 'Q1-fresh-followup', parent: 'A1', operations: [] },
  ] });

/** Independent declarations must agree before any physical fixture is created. */
export function assertValidationDispatch(census = VALIDATION_CENSUS) {
  const producer = VALIDATION_PRODUCER.cases.map(c => ({ runId: c.runId, operations: c.operations }));
  const expected = Array.isArray(census) ? census.map(c => ({ runId: c.runId, operations: c.actions?.map(a => a.operation) })) : null;
  if (!isDeepStrictEqual(producer, expected) || producer.length !== 16 || producer.reduce((n, c) => n + c.operations.length, 0) !== 50)
    throw new TypeError('Producer dispatch differs from the frozen evidence census.');
  return freeze({ runs: 16, submissions: 50, matched: true });
}

function stop(reason, status = 'unavailable', code = 'VALIDATION_UNAVAILABLE') {
  const e = new Error(reason); e.validationStatus = status; e.code = code; throw e;
}
function synchronous(fn, args, name) {
  const value = fn(...args);
  if (value && typeof value.then === 'function') stop(`${name} must return synchronously.`, 'failed', 'VALIDATION_ASYNC_HOOK');
  return value;
}

/** Content addressing is byte exact for checkpoints, sameMaterialHash-compatible
 * JSON serialization for models/public data. References never rename real IDs. */
export function createValidationBlobStore(prior = {}, onBlob = null) {
  const blobs = Object.create(null);
  const put = (kind, value, encoding = 'json') => {
    if (!['json', 'utf8'].includes(encoding) || encoding === 'utf8' && typeof value !== 'string') throw new TypeError('Invalid immutable artifact encoding.');
    const text = encoding === 'utf8' ? value : JSON.stringify(value);
    if (text === undefined) throw new TypeError('Undefined evidence cannot be stored.');
    const sha256 = sha(text), ref = freeze({ sha256, kind, encoding, bytes: Buffer.byteLength(text) });
    if (!Object.hasOwn(blobs, sha256) && !Object.hasOwn(prior, sha256)) {
      if (onBlob) synchronous(onBlob, [{ sha256, text, bytes: Buffer.byteLength(text), kind, encoding }], 'Durable blob hook');
      blobs[sha256] = text;
    }
    return ref;
  };
  const get = ref => {
    if (!ref || !fingerprint(ref.sha256)) throw new TypeError('A verified content-addressed artifact is required.');
    const stored = blobs[ref.sha256] ?? prior[ref.sha256];
    if (typeof stored === 'string') {
      if (sha(stored) !== ref.sha256 || ref.bytes !== undefined && Buffer.byteLength(stored) !== ref.bytes) throw new TypeError('Artifact bytes do not match the supplied hash.');
      return freeze(ref.encoding === 'utf8' ? stored : JSON.parse(stored));
    }
    const entry = stored || ref;
    const value = Object.hasOwn(entry, 'value') ? entry.value : entry.text;
    const encoding = entry.encoding || ref.encoding || (typeof value === 'string' ? 'utf8' : 'json');
    const text = encoding === 'utf8' ? value : JSON.stringify(value);
    if (typeof text !== 'string' || sha(text) !== ref.sha256 || ref.bytes !== undefined && Buffer.byteLength(text) !== ref.bytes)
      throw new TypeError('Artifact bytes do not match the supplied hash.');
    return freeze(copy(value));
  };
  return { put, get, export: () => freeze(copy(blobs)) };
}

/** The one separately declared bramble setup; never an alternate apple source. */
export function createValidationBrambleFixture(options = {}) {
  const environment = createEnvironment(74193, { mode: 'discovery' });
  const source = environment.ecology.plants.find(p => p.kind === 'bramble' && p.quantity > 0);
  if (!source?.position) stop('The first existing positive-quantity bramble is absent.');
  const approaches = [[45, 0, 'east'], [-45, 0, 'west'], [0, -45, 'north'], [0, 45, 'south']].map(([x, y, direction]) => {
    const position = { x: source.position.x + x, y: source.position.y + y };
    return { direction, position, collisionValid: canStand(position.x, position.y, 'valley'),
      inReach: Math.hypot(x, y) <= DISCOVERY_RULES.reach, lineOfSight: lineOfSight(position, source.position, 'valley') };
  });
  const approach = approaches.find(p => p.collisionValid);
  if (!approach || !approach.inReach || !approach.lineOfSight) stop('The first collision-valid bramble approach is not reachable and visible.');
  const npc = createNpc({ id: 'aster', mode: 'discovery', seed: 74193 });
  npc.position = copy(approach.position);
  const state = { elapsed: 0, simulationMode: 'discovery', environment, agents: [npc], npc, community: createCommunity(), cardinal: null };
  const fixture = new ReusablePredictionFixture(state, options);
  fixture.owner = freeze({ physicalSeed: 74193, sourceId: source.id, source: copy(source), approach, approaches,
    bodyOverrides: {}, resourceOverrides: {}, setup: 'first-positive-bramble' });
  return fixture;
}

/** Immutable, privileged accounting; never supplied as a learner observation. */
export function captureValidationStock(fixture, materialId = null) {
  const e = fixture.state.environment.ecology, n = fixture.npc;
  const material = materialId ? lookupEcologyObject(e, materialId) : null;
  return freeze({ at: n.elapsed, materialId, material: material ? copy(material) : null,
    held: [...n.inventory.items], capacity: n.inventory.capacity, freeSlots: n.inventory.capacity - n.inventory.items.length,
    source: fixture.owner?.sourceId ? copy(lookupEcologyObject(e, fixture.owner.sourceId)) : null,
    ledger: copy(e.ledger), detritus: copy(e.detritus), regions: copy(e.regions || []),
    body: copy(n.physiology), ecologyAt: e.elapsed, outsideAssistancePermitted: false });
}

const ready = f => !f.npc.active && !f.pending && f.npc.lifecycle === 'AWAKE' && !isSleeping(f.npc) && f.npc.elapsed >= f.npc.nextDecisionAt;
const scheduled = f => ready(f) && f.sensor.observationAt === f.npc.elapsed && f.controller.senseAt === f.npc.elapsed;
const protection = f => ({ state: f.state, model: f.model, sensor: f.sensor, selector: f.selector, admission: f.admission, driver: f.checkpointDriver() });
const rngState = f => ({ actor: f.npc.rng, selector: f.selector.rng, environment: f.state.environment.rng ?? null, ecology: f.state.environment.ecology.rng ?? null });
const bookkeeping = f => ({ memory: copy(f.memory), sensor: copy(f.sensor), model: f.model, admission: copy(f.admission) });

/** Owner-only collision proof. This complete ID census never enters a model. */
export function completeRetainedBindings(original, fixture, artifacts = {}) {
  if (original?.complete !== true || original.scope !== 'all-retained-physical-and-evidence-bindings' ||
      !Array.isArray(original.objectIds) || !Array.isArray(original.sourceHashes) || original.sourceHashes.length < 2 || !original.sourceHashes.every(fingerprint))
    stop('The complete pinned-original object binding census is missing.');
  const ids = new Set(original.objectIds);
  for (const value of [protection(fixture), artifacts]) for (const match of JSON.stringify(value).matchAll(/object:\d{1,9}(?!\d)/g)) ids.add(match[0]);
  return freeze({ complete: true, scope: original.scope, objectIds: [...ids].sort(), sourceHashes: [...original.sourceHashes],
    extraction: 'Conservative union of pinned originals, complete retained current state and prior artifact/evidence bindings; owner-only collision proof.' });
}

/** Replays real callback windows, not an invented continuous physical trajectory.
 * Intervening genuine pre-states are retained explicitly. Every consumer receives
 * only the exact existing event at its original ledger clock. No engine tick,
 * observation, synthetic receipt, new event, or learning label is manufactured.
 */
export function replayValidationCallbackWindows(callbacks) {
  if (!Array.isArray(callbacks) || !callbacks.length || callbacks.some(c => !c.before || !c.after || !c.event)) stop('Genuine pre/post callback windows are missing.');
  const ordered = [...callbacks].sort((a, b) => a.event.at - b.event.at || Number(a.event.id.slice(9)) - Number(b.event.id.slice(9)));
  const dispatch = (input, duplicate) => {
    const rows = [...input].sort((a, b) => a.event.at - b.event.at || Number(a.event.id.slice(9)) - Number(b.event.id.slice(9)));
    const dispatchOrder = [], states = [];
    for (const row of rows) {
      const c = Object.create(ReusablePredictionFixture.prototype);
      c.npc = { elapsed: row.event.at, discovery: { temporal: copy(row.before.memory) } };
      c.sensor = copy(row.before.sensor); c.model = copy(row.before.model); c.admission = copy(row.before.admission);
      c.modelSession = createReusableModelSession(c.model, row.event.at); c.model = c.modelSession.snapshot();
      c.predictionArm = 'online'; c.sensorEnabled = true; c.reservedContextKey = null;
      c.now = () => 0; c.predictionTimings = { native: [], bookkeeping: [], batches: [], decisions: [] }; c.emit = () => {};
      for (let n = 0; n < (duplicate ? 2 : 1); n++) {
        const event = copy(row.event); dispatchOrder.push([event.at, Number(event.id.slice(9))]);
        const before = snapshotReusableFeedback(c.memory, event);
        recordTemporalFeedback(c.memory, event, { now: event.at });
        c.applyLabels(recordReusableFeedback(c.sensor, { before, memory: c.memory, event, now: event.at }));
      }
      const after = bookkeeping(c);
      if (!isDeepStrictEqual(after, row.after)) stop('A copied callback consumer differs from the genuine canonical post-state.', 'failed', 'VALIDATION_REPLAY');
      states.push(after);
    }
    return { dispatchOrder, finalState: { callbacks: states, independentWindows: true } };
  };
  return freeze({ evidenceClass: 'factual-replay-control', independentExamples: 0,
    coverage: 'Exact retained boundary-local consumer states; no separately free-running continuous replay is claimed.',
    events: ordered.map(c => copy(c.event)), referenceState: { callbacks: ordered.map(c => copy(c.after)), independentWindows: true },
    chronological: dispatch(ordered, false), duplicated: dispatch(ordered, true), reordered: dispatch([...ordered].reverse(), false) });
}

/**
 * artifacts: {blobs, checkpoints:{Apre,A0,A1}, models:{MF,MA}, materialId,
 *   firstIngestion,freshIngestion,t1,prospective,predecessors:[{runId,status}],
 *   schedules:{[referenceRun]:{events,throughAt,complete}},projection,retainedBindings}
 * A checkpoint entry is {ref,lineage}; model entries are refs. Returned
 * artifactsDelta uses the same shape. Exported blobs plus inherited blobs resolve
 * every reference. Only a passed predecessor delta may be admitted by the caller.
 * hooks.boundary(event,fixture,{frozenModel}) and hooks.sink(record) are sync.
 * runtime injection is for deterministic synthetic harness tests, never alternate
 * real recipes/seeds. No fixture construction occurs until admission is checked.
 */
export async function runValidationCase({ runId, sourceFingerprint, artifacts = {}, hooks = {}, runtime = {}, now: suppliedNow } = {}) {
  const plan = VALIDATION_PRODUCER.cases.find(p => p.runId === runId);
  if (!plan || !fingerprint(sourceFingerprint)) throw new TypeError('A declared run ID and verified source fingerprint are required.');
  if (typeof hooks.boundary !== 'function') throw new TypeError('A synchronous owner boundary hook is required.');
  if (hooks.sink !== undefined && typeof hooks.sink !== 'function') throw new TypeError('Invalid evidence sink.');
  if (hooks.blob !== undefined && typeof hooks.blob !== 'function') throw new TypeError('Invalid durable blob hook.');
  const now = runtime.now || suppliedNow || (() => performance.now()), started = now();
  let retainedBlobBytes = 0, retainedBlobCount = 0, cumulativeOwnerCallbackMs = 0;
  const store = createValidationBlobStore(artifacts.blobs || {}, info => {
    if (hooks.blob) { const t = now(); try { synchronous(hooks.blob, [freeze(info)], 'Durable blob hook'); } finally { cumulativeOwnerCallbackMs += now() - t; } }
    retainedBlobBytes += info.bytes; retainedBlobCount++;
  });
  let fixture = null, frozenModel = null, previousReturn = started, previousNow = started, frames = 0, decisionMs = 0, totalQueryComputeMs = 0, previousBoundaryKind = null;
  let phase = 'admission', materialId = plan.parent ? artifacts.materialId || null : null, pendingFeedback = null, receiptLabels = new Map();
  let feedbackActive = false, pendingNumericalIndex = 0;
  let nativeOwnerStop = null;
  let status = 'running', reason = null, code = null, sinkFailed = false, stopping = false;
  const evidence = { version: 1, runId, evidenceClass: 'physical-advancement', sourceFingerprint,
    protocolFingerprint: VALIDATION_PRODUCER.protocolFingerprint, physicalAvailabilityPrior: 'untested',
    actions: [], events: [], callbacks: [], numericalUpdates: [], queries: [], stocks: [], phases: [], checkpoints: {},
    controls: {}, resource: { frames: 0, wallMs: 0, maximumReturnedWorkMs: 0, maximumDecisionMs: 0 } };
  const artifactsDelta = { checkpoints: {}, models: {}, schedules: {}, controls: {} };
  // The frozen native emit catches sink exceptions and retains only their text.
  // Keep the first original owner exception out of band, then rethrow after the
  // native call whether it returns normally or replaces it with a generic error.
  const nativeCall = fn => {
    if (nativeOwnerStop) throw nativeOwnerStop;
    let result;
    try { result = fn(); } catch (error) { throw nativeOwnerStop || error; }
    if (nativeOwnerStop) throw nativeOwnerStop;
    return result;
  };
  const record = row => {
    const complete = freeze({ runId, ...copy(row) });
    if (hooks.sink && !sinkFailed) {
      const t = now();
      try { synchronous(hooks.sink, [complete], 'Evidence sink'); }
      catch (e) { sinkFailed = true; throw e; }
      finally { cumulativeOwnerCallbackMs += now() - t; }
    }
    return complete;
  };
  const boundary = (kind, detail = {}) => {
    if (!stopping && nativeOwnerStop) throw nativeOwnerStop;
    const current = now();
    if (!Number.isFinite(current) || current < previousNow) stop('The resource clock is not monotonic.', 'failed', 'VALIDATION_CLOCK');
    // Conservative: trace/blob callbacks between owner boundaries stay included.
    // Only the explicit boundary callback itself is excluded from this segment.
    const returnedWorkMs = current - previousReturn;
    const worldSetup = previousBoundaryKind === 'setup-before' && kind === 'setup-after';
    previousNow = current;
    evidence.resource = { frames, wallMs: current - started,
      maximumReturnedWorkMs: Math.max(evidence.resource.maximumReturnedWorkMs, worldSetup ? 0 : returnedWorkMs),
      maximumDecisionMs: Math.max(evidence.resource.maximumDecisionMs, decisionMs),
      setupWorkMs: worldSetup ? returnedWorkMs : evidence.resource.setupWorkMs ?? null };
    if (!stopping && (current - started > VALIDATION_PRODUCER.runWallMs || !worldSetup && returnedWorkMs > VALIDATION_PRODUCER.returnedWorkMs || decisionMs > VALIDATION_PRODUCER.returnedWorkMs))
      stop('The frozen wall-time or returned-work ceiling was exceeded.', 'censored', 'VALIDATION_RESOURCE_LIMIT');
    const response = synchronous(hooks.boundary, [freeze({ runId, kind, phase, at: fixture?.npc.elapsed ?? null,
      frames, monotonicMs: current, elapsedMs: current - started, returnedWorkMs, returnedDecisionMs: decisionMs,
      cumulativeOwnerCallbackMs,
      ownerRetention: { uniqueBlobBytes: retainedBlobBytes, uniqueBlobCount: retainedBlobCount, accounting: 'UTF-8 serialized bytes; not a per-tick heap bound' }, ...copy(detail) }), fixture, { frozenModel }], 'Owner boundary');
    previousReturn = now();
    if (!Number.isFinite(previousReturn) || previousReturn < current) stop('The resource clock reversed inside a callback.', 'failed', 'VALIDATION_CLOCK');
    previousNow = previousReturn;
    previousBoundaryKind = kind;
    if (!stopping && (response === false || response?.stop)) stop(response?.reason || 'The owner stopped this case.', response?.status || 'unavailable', 'VALIDATION_OWNER_STOP');
    if (!stopping && fixture?.diagnosticError) stop(`Native diagnostic capture failed: ${fixture.diagnosticError}`, 'failed', 'VALIDATION_SINK');
    if (!stopping && (fixture?.admission?.deniedBatches || fixture?.admission?.deniedSubmissions)) stop('Native capacity admission denied work; preserve its prefix.', 'unavailable', 'VALIDATION_CAPACITY');
  };
  const setPhase = value => { phase = value; evidence.phases.push(record({ type: 'phase', phase, at: fixture?.npc.elapsed ?? null })); };
  const stash = (kind, value, encoding) => store.put(kind, value, encoding);
  const stock = label => { const value = (runtime.captureStock || captureValidationStock)(fixture, materialId); const ref = stash('stock-body-accounting', value); evidence.stocks.push({ label, at: fixture.npc.elapsed, ref }); return value; };
  const requireAssessment = (assessment, name) => {
    const reasons = [...assessment?.reasons || [], ...assessment?.unavailable || [], ...assessment?.failures || []];
    if (!assessment || assessment.status !== 'passed') stop(`${name}: ${(reasons.length ? reasons : [assessment?.reason || 'required evidence unavailable']).join('; ')}`,
      ['failed', 'censored', 'blocked'].includes(assessment?.status) ? assessment.status : 'unavailable', 'VALIDATION_REQUIRED_CHECK');
    return assessment;
  };
  let checks, projection;
  const pure = (label, fn) => {
    boundary('query-before', { label });
    const before = { state: hash(protection(fixture)), rng: hash(rngState(fixture)), model: hash(fixture.model), frozen: frozenModel ? hash(frozenModel) : null };
    const t = now(), value = synchronous(fn, [], 'Pure query'); decisionMs = now() - t;
    totalQueryComputeMs += decisionMs;
    const after = { state: hash(protection(fixture)), rng: hash(rngState(fixture)), model: hash(fixture.model), frozen: frozenModel ? hash(frozenModel) : null };
    const item = { label, at: fixture.npc.elapsed, evidenceClass: 'pure-public-projection', before, after, ref: stash('query-result', value) };
    evidence.queries.push(record(item));
    if (!isDeepStrictEqual(before, after)) stop(`${label} mutated world, model, factual state, or RNG.`, 'failed', 'VALIDATION_QUERY_MUTATION');
    boundary('query-after', { label, returnedDecisionMs: decisionMs }); return value;
  };
  const root = label => pure(label, () => fixture.candidateSnapshot({ draws: VALIDATION_PRODUCER.draws }));
  const combinedDecision = (constructionMs, label) => {
    decisionMs += constructionMs;
    boundary('combined-decision-after', { label, combinedDecisionMs: decisionMs, constructionMs });
  };
  const combinedScope = (queryStart, label, detail = {}) => {
    decisionMs = totalQueryComputeMs - queryStart;
    boundary('combined-decision-after', { label, combinedDecisionMs: decisionMs, ...detail });
  };
  const requireTarget = (snapshot, type, id = materialId) => {
    if (!snapshot.ready || !snapshot.ordinary) stop('The current authoritative opportunity is not an ordinary ready root.');
    const i = snapshot.candidates.findIndex(c => isDeepStrictEqual(c.action, action(type, id)) && c.eligibility === true && c.bindingsValid === true);
    if (i < 0) stop(`The first eligible scheduled opportunity masks ${type} for ${id || 'no target'}; no later substitute is permitted.`);
    if (type !== 'wait') {
      const object = snapshot.view.objects.find(o => o.id === id);
      if (!object || object.observedAt !== fixture.sensor.observationAt || fixture.sensor.observationAt !== fixture.npc.elapsed)
        stop('The required target is not current at this scheduled observation.');
    }
    return i;
  };
  const oldSchedule = () => evidence.events.filter(e => e.type === 'feedback' && (artifacts.firstIngestion?.id === e.event.ingestionId || artifacts.freshIngestion?.id === e.event.ingestionId))
    .map(e => ({ ...copy(e.event), sourceSeq: Number(e.event.id.slice('feedback:'.length)) }));
  const compareSchedule = complete => {
    if (!runId.startsWith('C') || runId === plan.referenceRun) return;
    const reference = artifacts.schedules?.[plan.referenceRun];
    if (!reference) stop('The prior block-reference schedule is missing.');
    const result = checks.compareOldMealSchedules({ reference: reference.events, actual: oldSchedule(),
      throughAt: Math.min(fixture.npc.elapsed, artifacts.t1 + 90), referenceComplete: true, actualComplete: complete,
      bindings: [artifacts.firstIngestion, artifacts.freshIngestion].map(i => ({ ingestionId: i.id, objectId: i.objectId, actionId: i.actionId, swallowedAt: i.at })) });
    if (result.status !== 'pending') requireAssessment(result, 'Incremental old-meal schedule');
    evidence.controls.schedule = result;
  };
  const captureNativeEvent = event => {
    evidence.events.push(record({ type: event.type, at: event.at, event: copy(event.event ?? null), nativeRef: stash('native-callback', event) }));
    if (event.type === 'prediction-labels') for (const row of event.labels.receiptUpdates) receiptLabels.set(row.sequence, copy(row));
    if (event.type === 'feedback') {
      const after = bookkeeping(fixture);
      const row = { event: copy(event.event), at: event.at, beforeRef: pendingFeedback ? stash('bookkeeping', pendingFeedback) : null,
        afterRef: stash('bookkeeping', after), active: copy(fixture.npc.active), sourceRunId: runId,
        evidenceClass: 'physical-advancement' };
      const updates = evidence.numericalUpdates.slice(pendingNumericalIndex).map(u => ({ ingestionId: u.ingestionId, update: u.label }));
      row.numericalUpdates = updates;
      row.admission = checks.assessChannelAdmission({ event: event.event, at: event.at, before: pendingFeedback, after, numericalUpdates: updates });
      evidence.callbacks.push(record(row)); pendingFeedback = after; pendingNumericalIndex = evidence.numericalUpdates.length;
      requireAssessment(row.admission, 'Exact biological callback admission');
      if (runId.startsWith('C') && runId !== plan.referenceRun) {
        const expected = artifacts.schedules?.[plan.referenceRun]?.events, actual = oldSchedule();
        if (!expected || actual.some((e, i) => !isDeepStrictEqual(e, expected[i]))) stop('Old-meal schedule has an immediate known event mismatch.');
      }
      if (runId === 'H4-competing-duplicate') {
        const replay = replayValidationCallbackWindows([{ ...row, before: store.get(row.beforeRef), after }]);
        const assessment = checks.assessSourceOrderReplay(replay);
        evidence.controls.duplicateBoundaries ||= []; evidence.controls.duplicateBoundaries.push({ replayRef: stash('factual-replay', replay), assessment });
        requireAssessment(assessment, 'Exact duplicate callback at its native event boundary');
      }
    }
  };
  const nativeSink = event => {
    if (nativeOwnerStop) throw nativeOwnerStop;
    try { return captureNativeEvent(event); }
    catch (error) { nativeOwnerStop = error; throw error; }
  };
  const installCapture = f => {
    fixture = f;
    // The frozen fixture deliberately filters/copies non-birth exposure rows
    // before numerical admission. WeakMap provenance belongs to the ORIGINAL
    // sensor object, so preserve it only within this exact applyLabels call.
    // Sequence and all other fields are checked; a pooled appearance/key is
    // never an identity source. A stack-like restoration preserves nested calls.
    let exposureScope = null;
    const apply = f.applyLabels;
    if (typeof apply === 'function') f.applyLabels = function (labels) {
      const previousScope = exposureScope, currentScope = new Map();
      for (const row of labels?.exposureUpdates || []) {
        const ingestionId = reusableExposureUpdateBinding(row);
        if (!Number.isSafeInteger(row.sequence) || currentScope.has(row.sequence) || !ingestionId)
          stop('A native exposure batch lacks an unambiguous original sensor binding.', 'failed', 'VALIDATION_EXPOSURE_PROVENANCE');
        currentScope.set(row.sequence, { ingestionId, original: row });
      }
      exposureScope = currentScope;
      try { return apply.call(this, labels); } finally { exposureScope = previousScope; }
    };
    const capture = f.captureFeedback;
    f.captureFeedback = function (...args) {
      feedbackActive = this.npc.physiology.feedback.some(e => Number(e.id.slice('feedback:'.length)) > this.memory.feedbackCursor);
      if (feedbackActive) { pendingFeedback = bookkeeping(this); pendingNumericalIndex = evidence.numericalUpdates.length; }
      try { return capture.apply(this, args); } finally { feedbackActive = false; }
    };
    const admit = f.admitNumericalLabel;
    if (typeof admit === 'function') f.admitNumericalLabel = function (update, row) {
      const before = this.model;
      let binding = reusableExposureUpdateBinding(row);
      if (Array.isArray(row.increments)) {
        const retained = exposureScope?.get(row.sequence);
        const { increments, ...numericalFields } = row;
        const { increments: originalIncrements, ...originalFields } = retained?.original || {};
        // Admission may remove censored channels, but cannot add/reorder/change
        // any original increment or any remaining row field.
        let cursor = 0;
        const subset = Array.isArray(originalIncrements) && increments.every(increment => {
          while (cursor < originalIncrements.length && !isDeepStrictEqual(increment, originalIncrements[cursor])) cursor++;
          return cursor++ < originalIncrements.length;
        });
        if (!retained || binding !== null && binding !== retained.ingestionId || !isDeepStrictEqual(numericalFields, originalFields) || !subset)
          stop('A copied numerical exposure row lost its exact original sensor provenance.', 'failed', 'VALIDATION_EXPOSURE_PROVENANCE');
        binding = retained.ingestionId;
      }
      const admitted = admit.call(this, update, row);
      if (feedbackActive && row.increments) evidence.numericalUpdates.push(record({ type: 'biological-numerical-update', at: row.at,
        ingestionId: binding, label: copy(row), admitted, beforeRef: stash('model', before), afterRef: stash('model', this.model),
        physicalBeforeHash: hash(before.rows.filter(r => r.type === 'physical')), physicalAfterHash: hash(this.model.rows.filter(r => r.type === 'physical')) }));
      return admitted;
    };
    return f;
  };
  const step = () => {
    boundary('frame-before'); const beforeAt = fixture.npc.elapsed;
    nativeCall(() => fixture.step(DT)); frames++;
    if (Math.abs(fixture.npc.elapsed - beforeAt - DT) > EPS) stop('The native fixture did not advance exactly one 1/60-second step.', 'failed');
    if (runId === 'T0-common-apple' && !frozenModel && fixture.sensor.totals[0] > 0) stop('F arrived before the common all-head freeze.');
    boundary('frame-after');
    if (runId.startsWith('C') && fixture.npc.elapsed <= artifacts.t1 + 90 + EPS) compareSchedule(false);
  };
  const advanceTo = at => {
    if (!Number.isFinite(at) || at < fixture.npc.elapsed - EPS) stop('Invalid forward-only native endpoint.', 'failed');
    while (fixture.npc.elapsed + 1e-10 < at) step();
  };
  const opportunity = (trigger = fixture.npc.elapsed, absoluteEnd = Infinity) => {
    if (!Number.isFinite(trigger)) stop('Missing declared opportunity trigger.', 'failed');
    const deadline = Math.min(Math.max(trigger, fixture.npc.nextDecisionAt, fixture.npc.elapsed) + 2, absoluteEnd);
    while (!(fixture.npc.elapsed + 1e-10 >= trigger && scheduled(fixture))) {
      if (fixture.npc.elapsed + DT > deadline + EPS) stop('The first current scheduler-ready observation was not reached within the fixed opportunity watchdog.');
      step();
    }
    return fixture.npc.elapsed;
  };
  const checkpoint = name => {
    boundary('checkpoint-before', { name });
    const text = fixture.checkpoint(), ref = stash('checkpoint', text, 'utf8');
    const lineage = { runId, parent: plan.parent, parentRef: plan.parent ? artifacts.checkpoints?.[plan.parent]?.ref?.sha256 ?? artifacts.checkpoints?.[plan.parent]?.sha256 ?? null : null,
      at: fixture.npc.elapsed, actualIds: { materialId, ingestionIds: fixture.memory.ingestions.map(i => i.id) }, sourceFingerprint };
    const entry = freeze({ ref, lineage }); evidence.checkpoints[name] = entry; artifactsDelta.checkpoints[name] = { text, sha256: ref.sha256, lineage };
    boundary('checkpoint-after', { name, sha256: ref.sha256, bytes: ref.bytes }); return entry;
  };
  const pendingQueries = snapshot => ({ online: forecastPending(fixture.model, snapshot.exposures), frozen: forecastPending(frozenModel, snapshot.exposures) });
  const candidateQueries = (snapshot, index, savedFeatures = null) => {
    const candidate = snapshot.candidates[index];
    const query = { features: savedFeatures || candidate.features, eligibility: candidate.eligibility, bindingsValid: candidate.bindingsValid,
      currentSensations: snapshot.view.body, exactSupport: candidate.exactSupport };
    return { online: (runtime.forecastCandidate || forecastCandidate)(fixture.model, query),
      frozen: (runtime.forecastCandidate || forecastCandidate)(frozenModel, query) };
  };
  const doAction = (type, targetId = materialId, { atCurrent = false, beforeSubmit = null, completeBy = Infinity } = {}) => {
    const slot = evidence.actions.length;
    if (plan.operations[slot] !== type) stop('The submitted action would exceed or change the frozen case recipe.', 'failed', 'VALIDATION_RECIPE');
    if (!atCurrent) opportunity(fixture.npc.elapsed, completeBy);
    if (!scheduled(fixture)) stop('A submission would bypass the scheduled native opportunity.');
    const queryStart = totalQueryComputeMs;
    const snapshot = root(`command-${slot}-native-root`), constructionMs = decisionMs, index = requireTarget(snapshot, type, targetId), candidate = snapshot.candidates[index];
    const requested = action(type, targetId), featuresHash = hash(candidate.features), beforeStock = stock(`command-${slot}-before`);
    const paired = frozenModel ? pure(`command-${slot}-paired-forecast`, () => candidateQueries(snapshot, index)) : null;
    const combinedDecisionMs = constructionMs + (paired ? decisionMs : 0);
    decisionMs = combinedDecisionMs;
    boundary('combined-decision-after', { slot, combinedDecisionMs, constructionMs });
    const scoring = /^(P1|C[1-8]|H[1-4])-/.test(runId);
    if (scoring) {
      const coverage = checks.assessPairedPhysicalForecast({ runId, slot, operation: type, predictedAt: fixture.npc.elapsed,
        online: paired.online.physical, frozen: paired.frozen.physical, featuresHash });
      evidence.controls.forecastCoverage ||= []; evidence.controls.forecastCoverage.push({ slot, ref: stash('prospective-coverage', coverage) });
      requireAssessment(coverage, 'Mandatory prospective physical cells');
    }
    if (beforeSubmit) synchronous(beforeSubmit, [{ snapshot, index, candidate, paired }], 'Prospective issuance');
    combinedScope(queryStart, `command-${slot}-all-prospective-queries`, { slot, constructionMs });
    const row = { runId, slot, operation: type, request: requested, featuresHash, featuresRef: stash('public-features', candidate.features),
      snapshotRef: stash('native-root', snapshot), pairedRef: paired ? stash('paired-action-forecast', paired) : null,
      models: { online: stash('model', fixture.model), frozen: frozenModel ? stash('model', frozenModel) : null },
      predictedAt: fixture.npc.elapsed, submittedAt: null, completedAt: null, actionId: null, receiptRef: null, beforeStockRef: stash('stock-body-accounting', beforeStock) };
    evidence.actions.push(row);
    boundary('command-before', { slot, action: requested });
    const seq = fixture.memory.nextSeq, at = fixture.npc.elapsed;
    row.submittedAt = at;
    if (!nativeCall(() => fixture.submit(requested))) stop('The masked request was not accepted by the unchanged native submission path.');
    const normalDuration = fixture.npc.active?.seconds ?? (fixture.npc.active ? fixture.npc.active.expiresAt - at : 0);
    if (!Number.isFinite(normalDuration) || normalDuration < 0) stop('The actual native operation duration is missing.');
    const deadline = Math.min(at + Math.min(normalDuration + 2, 30), completeBy);
    while (fixture.pending || fixture.npc.active) {
      if (fixture.npc.elapsed + DT > deadline + EPS) stop('The declared short action did not complete within its native-duration watchdog.');
      step();
    }
    const receipt = fixture.memory.receipts.find(r => r.seq === seq), label = receiptLabels.get(seq);
    row.completedAt = receipt?.completedAt ?? null; row.actionId = receipt?.outcome?.actionId ?? null;
    row.receiptRef = receipt ? stash('receipt', receipt) : null; row.receiptUpdateRef = label ? stash('receipt-update', label) : null;
    const afterStock = stock(`command-${slot}-after`); row.afterStockRef = stash('stock-body-accounting', afterStock);
    boundary('command-after', { slot, action: requested, receiptSeq: seq, actionId: row.actionId });
    if (!receipt || !isDeepStrictEqual(receipt.request, requested) || receipt.at !== at || receipt.completedAt !== fixture.npc.elapsed || !Number.isSafeInteger(row.actionId))
      stop('No matching genuine authoritative completion receipt exists.');
    if (scoring) {
      const assessment = checks.assessPhysicalCompletion({ runId, slot, operation: type, actionId: row.actionId, predictedAt: row.predictedAt,
        submittedAt: at, completedAt: receipt.completedAt, featuresHash, online: paired.online.physical, frozen: paired.frozen.physical, receiptUpdate: label, receipt });
      row.coverageRef = stash('physical-coverage', assessment); requireAssessment(assessment, 'Mandatory factual physical cells');
    }
    if (receipt.outcome?.ok !== true) stop('The required physical opportunity failed, was refused, or was interrupted; its receipt is retained.');
    record({ type: 'completed-action', row });
    return { row, receipt, label, snapshot, candidate, paired, beforeStock, afterStock };
  };
  const requireMaterial = ({ held = true, sameExposure = null } = {}) => {
    const material = (runtime.lookupMaterial || ((f, id) => lookupEcologyObject(f.state.environment.ecology, id)))(fixture, materialId);
    if (!material || !(material.massGrams > 0) || held && (!fixture.npc.inventory.items.includes(materialId) || material.heldBy !== fixture.npc.id)) stop('The exact finite remaining material is unavailable.');
    if (sameExposure) {
      const m = fixture.sensor.materials.find(x => x.objectId === materialId), e = fixture.sensor.exposures.find(x => x.id === sameExposure.id);
      if (!m?.known || !e || m.generation !== e.generation || !isDeepStrictEqual(m.appearance, e.appearance)) stop('The required observed material signature/generation changed or is unknown.');
    }
    return material;
  };
  const ingestionFrom = result => {
    const { receipt, beforeStock, afterStock } = result;
    const ing = fixture.memory.ingestions.find(i => i.id === receipt.outcome.ingestionId && i.seq === receipt.seq && i.actionId === receipt.outcome.actionId && i.objectId === materialId && i.at === receipt.completedAt);
    const portion = fixture.npc.physiology.stomach.find(i => i.id === ing?.id);
    const exposure = fixture.sensor.exposures.find(e => e.id === ing?.id);
    if (receipt.outcome.code !== 'SWALLOWED' || !ing || ing.creditBlocked || !portion || !(portion.originalMassGrams > 0) || !exposure)
      stop('The successful sample lacks its exact ingestion, finite portion, or sensor binding.');
    const beforeMass = beforeStock.material?.massGrams, afterMass = afterStock.material?.massGrams ?? 0;
    const naturalLoss = beforeMass - afterMass - portion.originalMassGrams;
    if (!Number.isFinite(naturalLoss) || naturalLoss < -EPS) stop('The actual finite material transfer cannot be balanced.', 'failed');
    const transfer = { ingestion: copy(ing), portion: copy(portion), exposure: copy(exposure), beforeMass, afterMass, naturalLoss,
      energyKcal: portion.originalKcal, waterMl: portion.originalWaterMl, beforeStockRef: result.row.beforeStockRef, afterStockRef: result.row.afterStockRef };
    evidence.controls.transfers ||= []; evidence.controls.transfers.push(transfer);
    return copy(ing);
  };
  const proofFor = (ing, channel) => {
    const bit = 1 << channels.indexOf(channel), current = fixture.memory.ingestions.find(i => i.id === ing.id), exposure = fixture.sensor.exposures.find(e => e.id === ing.id);
    const proof = current?.channelProof?.[channels.indexOf(channel)], event = fixture.sensor.events.find(e => e.ingestionId === ing.id && e.objectId === ing.objectId && e.actionId === ing.actionId && (e.channels & bit));
    if (!current || current.creditBlocked || fixture.memory.creditBlocked || !exposure || exposure.censored & bit) return null;
    return proof && event && (current.channels & bit) && (exposure.admitted & bit) && isDeepStrictEqual(exposure.channelProof[channels.indexOf(channel)], proof) && proof.at === event.at && proof.sourceSeq === event.sourceSeq
      ? freeze({ channel, ingestionId: ing.id, objectId: ing.objectId, actionId: ing.actionId, swallowedAt: ing.at, at: proof.at, sourceSeq: proof.sourceSeq, event: copy(event), proof: copy(proof) }) : null;
  };
  const ensureContinuous = ing => {
    const exposure = fixture.sensor.exposures.find(e => e.id === ing.id), current = fixture.memory.ingestions.find(i => i.id === ing.id);
    if (!current || current.creditBlocked || fixture.memory.creditBlocked || !exposure || exposure.censored || fixture.sensor.integrityFailure ||
        channels.some((c, i) => (exposure.admitted & (1 << i)) && !proofFor(ing, c)))
      stop('Required continuous exposure/proof retention was lost; unresolved channels are censored.', 'censored', 'VALIDATION_CENSORED');
  };
  const follow = (ing, endpoint) => { while (fixture.npc.elapsed + 1e-10 < endpoint) { step(); ensureContinuous(ing); } ensureContinuous(ing); };

  try {
    boundary('admission-before');
    assertValidationDispatch();
    const prior = VALIDATION_PRODUCER.cases.slice(0, VALIDATION_PRODUCER.cases.indexOf(plan));
    for (const p of prior) if ((Array.isArray(artifacts.predecessors) ? artifacts.predecessors.find(x => x.runId === p.runId) : artifacts.predecessors?.[p.runId])?.status !== 'passed') stop(`Required predecessor ${p.runId} has not passed; this case never started.`, 'blocked', 'VALIDATION_PREDECESSOR');
    checks = runtime.checks || await import('./reusable-validation-evidence.mjs');
    projection = runtime.projection || await import('./reusable-validation-projections.mjs');
    boundary('admission-after');
    if (plan.parent) {
      if (!artifacts.checkpoints?.[plan.parent] || !artifacts.models?.MF) stop('Required immutable parent checkpoint and all-head frozen model are missing.', 'blocked');
      frozenModel = store.get(artifacts.models.MF);
    }
    boundary('setup-before');
    const options = { sourceFingerprint, predictionArm: 'online', sensorEnabled: true, sink: nativeSink, now };
    if (plan.parent) {
      const input = artifacts.checkpoints[plan.parent];
      const parentRef = input.ref || { sha256: input.sha256, encoding: 'utf8', text: input.text };
      evidence.parent = { ref: { sha256: parentRef.sha256, encoding: 'utf8' }, lineage: copy(input.lineage) }; const text = store.get(parentRef);
      nativeCall(() => installCapture((runtime.reopen || reopenReusablePredictionFixture)(text, { expectedSourceFingerprint: sourceFingerprint, expectedPredictionArm: 'online', sink: nativeSink, now })));
    } else nativeCall(() => installCapture((runId === 'B1-small-exhausted' ? runtime.createBramble || createValidationBrambleFixture : runtime.createApple || createReusablePredictionFixture)(options)));
    if (fixture.automatic !== false || fixture.predictionArm !== 'online' || fixture.sensorEnabled !== true || fixture.sourceFingerprint !== sourceFingerprint)
      stop('Only the unchanged, nonautomatic, continuously monitored online fixture is allowed.', 'failed');
    if (!plan.parent && (fixture.owner?.physicalSeed !== 74193 || Object.keys(fixture.owner.bodyOverrides || {}).length || Object.keys(fixture.owner.resourceOverrides || {}).length || fixture.memory.ingestions.length))
      stop('The declared cold default-body/source setup was not preserved.', 'failed');
    evidence.ownerRef = stash('owner-setup', fixture.owner ?? null); stock('setup');
    boundary('setup-after');

    if (runId === 'T0-common-apple') {
      setPhase('common-nine-action-prefix');
      const pull = doAction('pull', fixture.owner.sourceId); materialId = pull.receipt.outcome.materialId;
      if (typeof materialId !== 'string' || materialId === fixture.owner.sourceId) stop('The pull has no distinct actual material output.');
      requireMaterial();
      const inspect = doAction('inspect_object'), strike = doAction('strike');
      if (!strike.afterStock.material || ['id', 'materialType', 'massGrams', 'energyKcal', 'waterMl', 'spoiled'].some(k => !isDeepStrictEqual(strike.beforeStock.material?.[k], strike.afterStock.material[k])) || strike.receipt.outcome.ingestionId || strike.receipt.outcome.materialId)
        stop('The declared held-material strike transformed/exhausted stock or created another identity.');
      const release = doAction('release');
      if (release.afterStock.held.includes(materialId) || release.afterStock.freeSlots !== release.beforeStock.freeSlots + 1) stop('Release did not genuinely free exactly one held slot.');
      doAction('grasp'); requireMaterial(); doAction('wait');
      const sample = doAction('sample'), ing = ingestionFrom(sample);
      doAction('wait'); doAction('wait');
      if (fixture.sensor.totals[0] !== 0) stop('F arrived before the prescribed common freeze.');
      for (let i = 0; i < evidence.actions.length - 1; i++) {
        const receipt = store.get(evidence.actions[i].receiptRef), next = store.get(evidence.actions[i + 1].receiptRef);
        if (!fixture.sensor.receipts.find(r => r.seq === receipt.seq)?.interval || !fixture.memory.model.transitions.find(t => t.seq === receipt.seq && t.nextSeq === next.seq && t.endAt === next.at))
          stop('A prior common physical interval was not closed by its actual successor.');
      }
      setPhase('common-all-head-freeze'); frozenModel = freeze(copy(fixture.model));
      const frozenRef = stash('model', frozenModel); artifactsDelta.models.MF = { value: frozenModel, sha256: frozenRef.sha256 }; evidence.freeze = { at: fixture.npc.elapsed, modelRef: frozenRef };
      boundary('freeze'); checkpoint('Apre');
      setPhase('common-first-F');
      while (!proofFor(ing, 'F') && fixture.npc.elapsed < ing.at + 180) { step(); ensureContinuous(ing); }
      const proof = proofFor(ing, 'F'); if (!proof || proof.at - ing.at >= 180) stop('No genuine first F strictly before age 180 seconds.');
      opportunity(proof.at, ing.at + 182);
      const snapshot = root('common-post-F-native-root'); requireTarget(snapshot, 'sample'); requireMaterial({ sameExposure: ing });
      if (!fixture.npc.physiology.stomach.some(i => i.id === ing.id)) stop('The first ingestion is no longer physically pending.');
      artifactsDelta.materialId = materialId; artifactsDelta.firstIngestion = ing;
      artifactsDelta.models.MA = { value: fixture.model, sha256: stash('model', fixture.model).sha256 }; evidence.controls.firstF = proof;
      checkpoint('A0');
      void inspect;
    } else if (runId === 'P1-fresh-prefix') {
      setPhase('pure-Gate-2-batch');
      if (!scheduled(fixture)) stop('A0 is not the retained current eligible scheduled boundary.');
      const snapshot = root('A0-native-root'), constructionMs = decisionMs; requireTarget(snapshot, 'sample'); requireMaterial({ sameExposure: artifacts.firstIngestion });
      if (!fixture.npc.physiology.stomach.some(i => i.id === artifacts.firstIngestion?.id)) stop('A0 lacks its physically pending original ingestion.');
      const bindings = completeRetainedBindings(artifacts.retainedBindings, fixture, artifacts);
      const projectionInput = projection.captureValidationProjectionInput({ snapshot, discovery: fixture.npc.discovery, memory: fixture.memory, sensor: fixture.sensor, retainedBindings: bindings });
      const batch = pure('Gate-2-24-conditions-48-evaluations', () => projection.evaluateValidationProjectionBatch({ input: projectionInput,
        onlineModel: fixture.model, frozenModel, targetId: materialId, ...artifacts.projection }));
      combinedDecision(constructionMs, 'Gate-2-root-plus-paired-batch');
      evidence.controls.gate2 = batch; requireAssessment(batch.assessment || batch, 'Gate 2 public projection batch');
      setPhase('fresh-prospective-sample');
      let prospective;
      const sampled = doAction('sample', materialId, { atCurrent: true, beforeSubmit: ({ snapshot: s, candidate }) => {
        const query = freeze({ appearance: copy(candidate.features.appearance), digestion: s.view.body.digestion, ageSeconds: 0, horizonSeconds: 600,
          reported: zeroFlags(), censored: zeroFlags(), exactSupport: copy(candidate.exactSupport) });
        prospective = pure('fresh-six-prospective-biological-probabilities', () => ({ runId, issuedAt: fixture.npc.elapsed, query,
          online: (runtime.forecastExposure || forecastExposure)(fixture.model, query), frozen: (runtime.forecastExposure || forecastExposure)(frozenModel, query),
          onlineModelRef: stash('model', fixture.model), frozenModelRef: stash('model', frozenModel), snapshotRef: stash('native-root', s), evidenceClass: 'pure-public-projection' }));
      } });
      const ing = ingestionFrom(sampled);
      if (ing.id === artifacts.firstIngestion.id || fixture.npc.physiology.stomach.filter(i => [ing.id, artifacts.firstIngestion.id].includes(i.id)).length !== 2)
        stop('P1 did not retain two distinct physically pending ingestion bindings.');
      if (fixture.sensor.events.some(e => e.ingestionId === ing.id)) stop('Fresh feedback preceded the A1 checkpoint boundary.');
      const exposure = fixture.sensor.exposures.find(e => e.id === ing.id);
      artifactsDelta.freshIngestion = ing; artifactsDelta.t1 = ing.at;
      artifactsDelta.prospective = freeze({ ...prospective, ingestionId: ing.id, objectId: ing.objectId, actionId: ing.actionId, swallowedAt: ing.at,
        actualSwallowDigestion: exposure.body.digestion, approximationChanged: prospective.query.digestion !== exposure.body.digestion });
      checkpoint('A1');
    } else if (runId.startsWith('C')) {
      setPhase('old-meal-fixed-trigger');
      if (!Number.isFinite(artifacts.t1)) stop('A1 swallow time is missing.', 'blocked');
      opportunity(artifacts.t1 + plan.triggerAgeSeconds);
      const result = doAction(plan.operations[0], materialId, { atCurrent: true });
      if (fixture.memory.ingestions.length !== 2 || result.receipt.outcome.ingestionId) stop('An unrelated operation changed the two-ingestion census.');
      setPhase('experienced-receipt-attribution'); opportunity();
      const snapshot = root('experienced-receipt-current-root'), constructionMs = decisionMs;
      const query = { features: result.candidate.features, eligibility: true, bindingsValid: true, currentSensations: snapshot.view.body, exactSupport: result.candidate.exactSupport };
      const attribution = pure('experienced-receipt-retrospective-query', () => ({ runId, operation: result.row.operation, actionId: result.row.actionId,
        submittedAt: result.row.submittedAt, completedAt: result.row.completedAt, queryAt: fixture.npc.elapsed, featuresHash: result.row.featuresHash,
        before: result.paired, after: { online: (runtime.forecastCandidate || forecastCandidate)(fixture.model, query), frozen: (runtime.forecastCandidate || forecastCandidate)(frozenModel, query) },
        pending: pendingQueries(snapshot), prospective: false, sourceReceiptRef: result.row.receiptRef.sha256 }));
      combinedDecision(constructionMs, 'experienced-receipt-root-plus-paired-query');
      evidence.controls.attribution = attribution; requireAssessment(checks.assessOldMealAttribution([attribution], { partial: true }), 'Old-meal attribution');
      setPhase('old-meal-common-endpoint'); advanceTo(artifacts.t1 + 90); compareSchedule(true);
      opportunity(); doAction('wait', undefined, { atCurrent: true });
      artifactsDelta.schedules[runId] = { events: oldSchedule().filter(e => e.at <= artifacts.t1 + 90), throughAt: artifacts.t1 + 90, complete: true };
      artifactsDelta.controls[runId] = { attribution, callbacks: copy(evidence.callbacks) };
      if (runId === 'C4-early-release' || runId === 'C8-late-inspect') {
        const block = VALIDATION_PRODUCER.cases.filter(p => p.referenceRun === plan.referenceRun);
        const reference = artifacts.schedules[plan.referenceRun];
        evidence.controls.scheduleBlock = block.map(p => {
          const actual = p.runId === runId ? artifactsDelta.schedules[runId] : artifacts.schedules[p.runId];
          const assessment = checks.compareOldMealSchedules({ reference: reference.events, actual: actual.events, throughAt: artifacts.t1 + 90,
            referenceComplete: true, actualComplete: true, bindings: [artifacts.firstIngestion, artifacts.freshIngestion].map(i => ({ ingestionId: i.id, objectId: i.objectId, actionId: i.actionId, swallowedAt: i.at })) });
          requireAssessment(assessment, 'Completed old-meal schedule block'); return { runId: p.runId, assessment };
        });
      }
      if (runId === 'C8-late-inspect') {
        const cases = VALIDATION_PRODUCER.cases.filter(p => p.runId.startsWith('C')).map(p => p.runId === runId ? attribution : predecessorEvidence(p.runId).controls.attribution);
        requireAssessment(checks.assessOldMealAttribution(cases), 'Complete eight-case old-meal attribution');
        evidence.controls.sourceOrder = [];
        for (const p of VALIDATION_PRODUCER.cases.filter(p => p.runId.startsWith('C'))) {
          const callbacks = p.runId === runId ? evidence.callbacks : predecessorEvidence(p.runId).callbacks;
          const replay = replayValidationCallbackWindows(callbacks.map(c => ({ ...c, before: store.get(c.beforeRef), after: store.get(c.afterRef) })));
          const assessment = checks.assessSourceOrderReplay(replay);
          evidence.controls.sourceOrder.push({ sourceRunId: p.runId, replayRef: stash('factual-replay', replay), assessment });
          requireAssessment(assessment, 'Genuine source-order callback replay');
        }
      }
      checkpoint(`${runId}-stop`);
    } else if (runId.startsWith('H')) {
      // The remaining branches use exactly the same helper paths, never act().
      await runHarmCase();
    } else if (runId === 'B1-small-exhausted') {
      await runBrambleCase();
    } else if (runId === 'Q1-fresh-followup') {
      setPhase('held-out-600-second-observation');
      if (!artifacts.prospective || artifacts.prospective.ingestionId !== artifacts.freshIngestion?.id || artifacts.prospective.swallowedAt !== artifacts.t1)
        stop('The immutable pre-submission P1 forecast binding is missing.', 'blocked');
      follow(artifacts.freshIngestion, artifacts.t1 + 600);
      const observation = horizonObservation(artifacts.freshIngestion, artifacts.t1 + 600);
      const p = artifacts.prospective, fresh = artifacts.freshIngestion;
      const training = predecessorEvidence('T0-common-apple').controls.firstF;
      const biological = { runId, sourceRunId: 'P1-fresh-prefix', evidenceClass: 'physical-advancement', origin: 'new-ingestion',
        clusterId: 'apple-common-history', ingestionId: fresh.id, trainingIngestionId: artifacts.firstIngestion.id,
        materialId, trainingMaterialId: artifacts.firstIngestion.objectId, actionId: fresh.actionId,
        trainingFeedbackAt: training.at, predictedAt: p.issuedAt, submittedAt: predecessorEvidence('P1-fresh-prefix').actions[0].submittedAt,
        swallowedAt: fresh.at, horizonSeconds: 600, continuous: true, proofsRetained: true,
        followedThroughAt: fixture.sensor.clockAt, censored: false, forecasts: { online: p.online, frozen: p.frozen },
        channels: Object.fromEntries(channels.map(c => {
          const proof = proofFor(fresh, c), valid = proof && proof.at > fresh.at && proof.at <= fresh.at + 600;
          const event = valid ? evidence.callbacks.find(x => x.event.ingestionId === fresh.id && Number(x.event.id.slice(9)) === proof.sourceSeq)?.event : null;
          if (valid && !event) stop('A positive quality label lacks its original retained native event.', 'censored');
          return [c, { online: p.online.channels[c].probability, frozen: p.frozen.channels[c].probability, eventAt: valid ? proof.at : null,
            proof: valid ? { sourceSeq: proof.sourceSeq, at: proof.at, ingestionId: fresh.id, objectId: fresh.objectId, actionId: fresh.actionId } : null,
            event: event ? copy(event) : null, censored: false }];
        })) };
      evidence.controls.biological = biological; evidence.controls.biologicalObservation = observation;
      artifactsDelta.controls.Q1 = evidence.controls.biological; checkpoint('Q1-stop');
    }
    if (evidence.actions.length !== plan.operations.length) stop('The declared action census was not completed.', 'unavailable');
    if (evidence.actions.some(a => a.completedAt === null)) stop('A declared action lacks completion.', 'unavailable');
    stock('endpoint');
    if (runId === 'Q1-fresh-followup') {
      const physical = Object.values(artifacts.predecessors).flatMap(p => p.evidence.actions || []).filter(a => a.coverageRef)
        .flatMap(a => store.get(a.coverageRef).cells);
      const census = VALIDATION_PRODUCER.cases.map(p => ({ runId: p.runId, status: 'passed' }));
      const quality = pure('complete-prespecified-quality-census', () => checks.aggregateValidationQuality({ physical,
        biological: [evidence.controls.biological], census }));
      evidence.controls.quality = quality; requireAssessment(quality, 'Complete prospective biological/physical quality');
      artifactsDelta.controls.quality = quality;
    }
    status = 'passed';
  } catch (e) {
    status = e.validationStatus || (['VALIDATION_RESOURCE_CEILING', 'VALIDATION_RESOURCE_LIMIT'].includes(e.code) ? 'censored' : e.code === 'VALIDATION_UNAVAILABLE' || e.code?.includes('CAPACITY') ? 'unavailable' : 'failed'); reason = String(e.message || e); code = e.code || 'VALIDATION_EXCEPTION';
  } finally {
    stopping = true;
    try { boundary('stop-before', { status, reason }); } catch (e) { if (status === 'passed') { status = 'failed'; reason = String(e.message || e); code = 'VALIDATION_STOP_HOOK'; } }
    if (fixture) {
      try {
        const text = fixture.checkpoint(); evidence.stop = { checkpointRef: stash('checkpoint', text, 'utf8'), at: fixture.npc.elapsed, terminal: false };
      } catch (e) { evidence.stop = { checkpointRef: null, checkpointMissing: true, at: fixture.npc.elapsed, reason: String(e.message || e), terminal: false }; if (status === 'passed') { status = 'failed'; reason = 'Final checkpoint serialization failed.'; code = 'VALIDATION_STOP_SERIALIZATION'; } }
      try { stock('stop'); } catch (e) { evidence.stop.accountingError = String(e.message || e); if (status === 'passed') { status = 'failed'; reason = 'Final stock/body accounting failed.'; } }
    } else evidence.stop = { checkpointRef: null, checkpointMissing: true, neverStarted: true, terminal: false };
    try { boundary('stop-after', { status, reason }); } catch (e) { evidence.stop.boundaryError = String(e.message || e); if (status === 'passed') { status = 'failed'; reason = 'Final boundary failed.'; } }
    if (now() - started > VALIDATION_PRODUCER.runWallMs && status === 'passed') { status = 'censored'; reason = 'Stop serialization/finalization exceeded the total per-run wall ceiling.'; code = 'VALIDATION_RESOURCE_LIMIT'; }
  }
  artifactsDelta.blobs = store.export();
  evidence.resource.ownerRetention = { uniqueBlobBytes: retainedBlobBytes, uniqueBlobCount: retainedBlobCount,
    accounting: 'UTF-8 serialized unique content bytes; JS object/string/index overhead and peak heap are not bounded by this number.' };
  return freeze({ runId, status, reason, reasons: reason ? [reason] : [], code, evidence, artifacts: artifactsDelta,
    continuingAllowed: false, autonomy: false, mainPromotion: false, originalResourceAdmissionPassed: false, terminal: false });

  function horizonObservation(ing, endpoint) {
    ensureContinuous(ing);
    const exposure = fixture.sensor.exposures.find(e => e.id === ing.id);
    const reports = evidence.callbacks.map(c => c.event).filter(e => e.ingestionId === ing.id);
    const labels = Object.fromEntries(channels.map(c => {
      const proof = proofFor(ing, c);
      return [c, proof && proof.at > ing.at && proof.at <= endpoint ? 1 : 0];
    }));
    if (fixture.sensor.clockAt < endpoint || fixture.npc.elapsed < endpoint || exposure.censored) stop('Incomplete continuous fixed-horizon observation.', 'censored');
    return { runId, ingestionId: ing.id, objectId: ing.objectId, actionId: ing.actionId, swallowedAt: ing.at, endpoint,
      observedThrough: fixture.sensor.clockAt, continuous: true, censored: false, labels, reports,
      outOfHorizon: reports.filter(e => e.at > endpoint), exposureRef: stash('exposure', exposure), lifetimeSafetyClaim: false };
  }

  function predecessorEvidence(id) {
    const value = artifacts.predecessors?.[id]?.evidence;
    if (!value) stop(`The passed predecessor ${id} has no resolved retained evidence.`, 'blocked');
    return value;
  }

  async function runHarmCase() {
    setPhase('sole-aged-material-intervention');
    if (materialId !== 'object:855') stop('The permitted age intervention is bound only to the actual object:855.');
    requireMaterial(); const before = stock('intervention-before');
    const intervention = (runtime.ageMaterial || ageRemainingReusableMaterial)(fixture, materialId);
    const after = stock('intervention-after'); evidence.controls.intervention = { intervention, beforeRef: stash('stock-body-accounting', before), afterRef: stash('stock-body-accounting', after) };
    opportunity(fixture.npc.elapsed + DT);
    const sampled = doAction('sample', materialId, { atCurrent: true }), ing = ingestionFrom(sampled), th = ing.at;
    const exposure = fixture.sensor.exposures.find(e => e.id === ing.id), publicView = fixture.observe();
    const support = (runtime.materialSupport || reusableMaterialSupport)(fixture.sensor, { memory: fixture.memory, view: publicView, objectId: materialId });
    const fixedQuery = freeze({ appearance: copy(exposure.appearance), digestion: exposure.body.digestion, ageSeconds: 0, horizonSeconds: 600,
      reported: zeroFlags(), censored: zeroFlags(), exactSupport: { F: support.F, W: support.W, H: support.H } });
    evidence.controls.fixedHarmQueryRef = stash('fixed-harm-query', fixedQuery);
    setPhase('aged-common-release-recipe');
    const release = doAction('release', materialId, { completeBy: th + 600 });
    if (release.afterStock.held.includes(materialId) || release.afterStock.freeSlots !== release.beforeStock.freeSlots + 1) stop('The aged recipe release did not free exactly one real slot.');
    doAction('grasp', materialId, { completeBy: th + 600 }); requireMaterial();
    const inspect = doAction('inspect_object', materialId, { completeBy: th + 600 });
    if (!(inspect.receipt.completedAt > inspect.receipt.at) || inspect.receipt.outcome.ingestionId || inspect.receipt.outcome.materialId) stop('Aged inspection is not the required costly nonproductive manipulation.');
    doAction('wait', undefined, { completeBy: th + 600 });
    opportunity(fixture.npc.elapsed, th + 600);
    const snapshot = root('aged-release-comparison-native-root'), constructionMs = decisionMs, r = requireTarget(snapshot, 'release'), i = requireTarget(snapshot, 'inspect_object');
    const comparison = pure('aged-release-v-inspect', () => ({ runId, queryAt: fixture.npc.elapsed,
      release: { ...candidateQueries(snapshot, r), candidate: snapshot.candidates[r] },
      inspect: { ...candidateQueries(snapshot, i), candidate: snapshot.candidates[i] }, pending: pendingQueries(snapshot),
      receipt: release.receipt, beforeStock: release.beforeStock, afterStock: release.afterStock, root: snapshot, selectionDraws: [...VALIDATION_PRODUCER.draws] }));
    combinedDecision(constructionMs, 'release-root-plus-paired-comparison');
    evidence.controls.releaseComparison = comparison; requireAssessment(checks.assessReleaseComparisons([comparison], { partial: true }), 'Required release comparison');
    let handling = null;
    setPhase('aged-handling-variant');
    if (runId === 'H2-reopen') {
      if (fixture.npc.elapsed > th + 50 + DT) stop('The required pre-H reopen frame passed during the common recipe.');
      advanceTo(th + 50); if (proofFor(ing, 'H')) stop('H already arrived before the declared reopen.');
      boundary('reopen-before'); const saved = fixture.checkpoint(), at = fixture.npc.elapsed;
      const pre = { model: hash(fixture.model), sensor: hash(fixture.sensor), ledger: hash(fixture.memory), checkpointRef: stash('checkpoint', saved, 'utf8') };
      fixture.dispose();
      nativeCall(() => installCapture((runtime.reopen || reopenReusablePredictionFixture)(saved, { expectedSourceFingerprint: sourceFingerprint, expectedPredictionArm: 'online', sink: nativeSink, now })));
      const post = { model: hash(fixture.model), sensor: hash(fixture.sensor), ledger: hash(fixture.memory) };
      evidence.controls.reopen = { at, before: pre, after: post, noExtraObservation: true };
      handling = { reopenedAt: at, beforeHash: hash({ model: pre.model, sensor: pre.sensor, ledger: pre.ledger }), afterHash: hash(post) };
      if (fixture.npc.elapsed !== at || pre.model !== post.model || pre.sensor !== post.sensor || pre.ledger !== post.ledger) stop('Same-clock reopen changed retained numerical/factual evidence.', 'failed');
      boundary('reopen-after');
    } else if (runId === 'H3-operation-at-H') {
      if (proofFor(ing, 'H')) stop('H arrived before the one declared unrelated handling operation.');
      opportunity(th + 56, th + 600);
      const result = doAction('wait', undefined, { atCurrent: true, completeBy: th + 600 });
      handling = { submittedAt: result.row.submittedAt, completedAt: result.row.completedAt };
      const callback = evidence.callbacks.find(c => c.event.ingestionId === ing.id && c.event.effect === 'discomfort');
      if (!callback || callback.at < result.row.submittedAt || callback.at > result.row.completedAt || callback.active?.request?.type !== 'wait') stop('Genuine aged H did not occur during the one five-second handling wait.');
    }
    setPhase('aged-genuine-delayed-H');
    while (!proofFor(ing, 'H') && fixture.npc.elapsed + DT <= th + 600 + EPS) { step(); ensureContinuous(ing); }
    const harm = proofFor(ing, 'H'), earlier = [proofFor(ing, 'F'), proofFor(ing, 'W')].filter(Boolean).filter(p => p.at < harm?.at);
    if (!harm || !earlier.length) stop('The aged ingestion has no genuine H strictly after its own earlier F/W.');
    opportunity(harm.at, th + 600);
    const harmQueryStart = totalQueryComputeMs, maskSnapshot = root('post-H-next-proposal-native-root');
    if (maskSnapshot.candidates.some(c => c.action.type === 'sample' && c.action.targetId === materialId && c.eligibility)) stop('The exact harmed material remains sample-eligible.', 'failed');
    const update = evidence.numericalUpdates.find(u => u.ingestionId === ing.id && u.at === harm.at && u.label.increments.some(x => x.channel === 'H' && x.events === 1));
    if (!update?.admitted) stop('The genuine H lacks its single admitted numerical update.');
    const beforeModel = store.get(update.beforeRef), afterModel = store.get(update.afterRef), groupQuery = { ...copy(fixedQuery), exactSupport: zeroFlags() };
    const unrelated = pure('post-H-unrelated-projections', () => maskSnapshot.candidates.filter(c => ['wait', 'inspect_object'].includes(c.action.type)).map(c => ({ operation: c.action.type,
      forecast: (runtime.forecastCandidate || forecastCandidate)(fixture.model, { features: c.features, eligibility: c.eligibility, bindingsValid: c.bindingsValid, currentSensations: maskSnapshot.view.body, exactSupport: c.exactSupport }) })));
    const harmCase = pure('fixed-query-pre-post-H', () => ({ runId, ingestionId: ing.id, objectId: ing.objectId, swallowedAt: th, harmAt: harm.at, fixedQuery, groupQuery,
      onlineBefore: (runtime.forecastExposure || forecastExposure)(beforeModel, fixedQuery), onlineAfter: (runtime.forecastExposure || forecastExposure)(afterModel, fixedQuery),
      groupBefore: (runtime.forecastExposure || forecastExposure)(beforeModel, groupQuery), groupAfter: (runtime.forecastExposure || forecastExposure)(afterModel, groupQuery),
      pendingAfter: forecastExposure(fixture.model, { ...copy(fixedQuery), ageSeconds: fixture.npc.elapsed - th, reported: flags(fixture.sensor.exposures.find(e => e.id === ing.id).admitted) }),
      proof: { harmEvent: evidence.callbacks.find(c => c.event.ingestionId === ing.id && Number(c.event.id.slice(9)) === harm.sourceSeq)?.event,
        benefitEvent: evidence.callbacks.find(c => c.event.ingestionId === ing.id && Number(c.event.id.slice(9)) === earlier[0].sourceSeq)?.event, admittedH: 1, retained: true },
      fixedQueryHashBefore: hash(fixedQuery), fixedQueryHashAfter: hash(fixedQuery), handling,
      earlierBenefits: earlier, numericalUpdate: update, maskSnapshot, unrelated }));
    combinedScope(harmQueryStart, 'post-H-root-unrelated-and-fixed-query');
    evidence.controls.harm = harmCase; requireAssessment(checks.assessDelayedHarm([harmCase], { partial: true }), 'Delayed harm admission/conditioning');
    const sibling = predecessorEvidence('P1-fresh-prefix').controls.gate2.conditions.find(c => c.condition?.kind === 'fresh-identity' && c.condition.value === 'object:99000001');
    if (!sibling?.snapshot) stop('The retained Gate 2 sibling conflict query is missing.');
    const conflict = pure('retained-fresh-sibling-pre-post-H', () => ({ snapshot: sibling.snapshot,
      sourceRunId: 'P1-fresh-prefix', sourceCondition: sibling.condition,
      before: projection.predictValidationPublicSnapshot(sibling.snapshot, beforeModel), after: projection.predictValidationPublicSnapshot(sibling.snapshot, afterModel) }));
    combinedScope(harmQueryStart, 'post-H-root-unrelated-fixed-and-conflict-queries');
    const sampleIndex = sibling.snapshot.candidates.findIndex(c => c.action.type === 'sample' && c.action.targetId === 'object:99000001');
    if (sampleIndex < 0) stop('The retained fresh sibling has no declared sampling projection.');
    const a = conflict.before.forecasts[sampleIndex], b = conflict.after.forecasts[sampleIndex];
    if (![a, b].every(f => f.safe === false && channels.every(c => f.exactSupport[c] === false) && Math.abs(f.usedD.F) <= EPS && Math.abs(f.usedD.W) <= EPS) ||
        b.exposure.channels.H.probability < a.exposure.channels.H.probability - EPS)
      stop('A fresh sibling acquired transferred safety/support or diluted H after genuine conflicting feedback.', 'failed');
    evidence.controls.physicalConflict = { status: 'passed', ref: stash('fixed-sibling-conflict', conflict),
      pureProjection: true, independentExamples: 0, nativeExactItemExcluded: true };
    if (runId === 'H4-competing-duplicate') {
      const replay = replayValidationCallbackWindows(evidence.callbacks.map(c => ({ ...c, before: store.get(c.beforeRef), after: store.get(c.afterRef) })));
      const assessed = checks.assessSourceOrderReplay(replay);
      evidence.controls.replay = { ref: stash('factual-replay', replay), assessment: assessed }; requireAssessment(assessed, 'Competing duplicate callbacks');
      const previous = VALIDATION_PRODUCER.cases.filter(p => p.runId.startsWith('H')).map(p => p.runId === runId ? { harm: harmCase, releaseComparison: comparison } : predecessorEvidence(p.runId).controls);
      requireAssessment(checks.assessDelayedHarm(previous.map(c => c.harm)), 'Complete four-case delayed harm');
      requireAssessment(checks.assessReleaseComparisons(previous.map(c => c.releaseComparison)), 'Complete four-case release comparisons');
      for (const p of VALIDATION_PRODUCER.cases.filter(p => p.runId.startsWith('H') && p.runId !== runId))
        requireAssessment(predecessorEvidence(p.runId).controls.physicalConflict, 'Prior physical-conflict clause');
      evidence.controls.gate2PhysicalConflict = { status: 'passed', requiredRuns: VALIDATION_PRODUCER.cases.filter(p => p.runId.startsWith('H')).map(p => p.runId), independentExamples: 0 };
    }
    ensureContinuous(ing); artifactsDelta.controls[runId] = { harm: harmCase, releaseComparison: comparison, callbacks: copy(evidence.callbacks) };
    checkpoint(`${runId}-stop`);
  }

  async function runBrambleCase() {
    setPhase('natural-small-material');
    const pull = doAction('pull', fixture.owner.sourceId); materialId = pull.receipt.outcome.materialId; requireMaterial();
    const initial = stock('natural-35-gram-output'); if (Math.abs(initial.material.massGrams - 35) > EPS) stop('The natural bramble output is not exactly 35 grams.');
    const first = doAction('sample'), ing1 = ingestionFrom(first), transfer1 = evidence.controls.transfers.at(-1);
    if (Math.abs(transfer1.portion.originalMassGrams - 30) > EPS || Math.abs(transfer1.afterMass - 5) > EPS || Math.abs(transfer1.naturalLoss) > EPS)
      stop('The natural first portion was not 30 grams with exactly 5 grams remaining.');
    setPhase('small-second-portion-at-age-60'); opportunity(ing1.at + 60);
    const second = doAction('sample', materialId, { atCurrent: true }), ing2 = ingestionFrom(second), transfer2 = evidence.controls.transfers.at(-1);
    if (!(transfer2.portion.originalMassGrams > 0 && transfer2.portion.originalMassGrams < 30) || second.afterStock.material || second.afterStock.held.includes(materialId))
      stop('The second real small portion failed to exhaust/remove the material.');
    opportunity(); const snapshot = root('exhausted-material-native-mask');
    if (snapshot.candidates.some(c => c.action.type === 'sample' && c.action.targetId === materialId && c.eligibility)) stop('The exhausted material remains sample-eligible.', 'failed');
    setPhase('small-portion-complete-horizon'); follow(ing2, ing2.at + 600); ensureContinuous(ing1);
    const observation = horizonObservation(ing2, ing2.at + 600);
    const small = { runId, evidenceClass: 'physical-advancement', clusterId: 'bramble-control', materialId,
      naturalInitialGrams: initial.material.massGrams, sourceKind: 'bramble', stockEdited: false,
      portions: [transfer1, transfer2].map((t, index) => ({ ingestionId: t.ingestion.id, actionId: t.ingestion.actionId, materialId,
        swallowedAt: t.ingestion.at, transferredGrams: t.portion.originalMassGrams, remainingGrams: t.afterMass,
        receipt: index === 0 ? first.receipt : second.receipt })),
      exhaustedFromWorld: second.afterStock.material === null, exhaustedFromInventory: !second.afterStock.held.includes(materialId),
      nextMask: snapshot, continuous: true, proofsRetained: true, followedThroughAt: fixture.sensor.clockAt,
      channels: Object.fromEntries(channels.map(c => { const proof = proofFor(ing2, c); return [c, proof && proof.at <= ing2.at + 600
        ? evidence.callbacks.find(x => x.event.ingestionId === ing2.id && Number(x.event.id.slice(9)) === proof.sourceSeq)?.event ?? null : null]; })),
      first: transfer1, second: transfer2, observation, independentQualityWeight: 0, extraSampleSubmissions: 0, sourceRef: evidence.ownerRef };
    evidence.controls.smallPortion = small; requireAssessment(checks.assessSmallPortion(small), 'Natural small-portion exhaustion');
    artifactsDelta.controls.B1 = small; checkpoint('B1-stop');
  }
}
