/** Evaluator-only, single-actor checkpoints. Never imported by the game save path. */
import { isDeepStrictEqual } from 'node:util';
import { validateNpc, recordEvent, policyContext } from '../../src/npc-memory.js';
import { validateEnvironment } from '../../src/environment.js';
import { validateCommunity } from '../../src/social.js';
import { ECOLOGY_RULES } from '../../src/ecology-config.js';
import { BIOLOGY_RULES } from '../../src/biology-config.js';
import { NPC_RULES } from '../../src/config.js';
import { DISCOVERY_RULES } from '../../src/discovery-config.js';
import { projectPhysiology } from '../../src/biology.js';
import { DRIVE_NAMES } from '../../src/cognition.js';
import { FINITE_TEMPORAL_PROFILE, resolveTemporalCapacity, checkTemporalCapacity, applyTemporalCapacity } from '../../src/temporal-capacity.js';
import { encodeTemporalWire, decodeTemporalWire, temporalUtf8Bytes, TEMPORAL_STORAGE } from '../../src/temporal-storage.js';
import { validateFiniteSelector } from './finite-temporal-policy.mjs';

export const FINITE_CHECKPOINT = Object.freeze({
  format: 'aincrad-finite-temporal-checkpoint', version: 1, actorBytes: 1024 * 1024,
});
const ARMS = new Set(['online', 'no-bootstrap', 'frozen-zero']);
const ACTIONS = new Set(['inspect_object', 'grasp', 'release', 'pull', 'sample', 'strike', 'move', 'wait', 'rest', 'sleep', 'observe', 'enter_shelter', 'exit_shelter', 'fill_flask', 'drink']);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const uint = (value, maximum = 1e9) => Number.isSafeInteger(value) && value >= 0 && value <= maximum;
const time = (value, elapsed, minimum = 0) => Number.isFinite(value) && value >= minimum && value <= elapsed;
const fingerprint = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const objectId = value => typeof value === 'string' && /^object:\d{1,9}$/.test(value);
const clone = value => structuredClone(value);
const json = value => JSON.parse(JSON.stringify(value));
function fail(message, code = 'FINITE_CHECKPOINT') { const error = new Error(message); error.code = code; throw error; }
function keys(value, allowed, name) {
  if (!record(value) || Object.keys(value).some(key => !allowed.includes(key)) || allowed.some(key => !Object.hasOwn(value, key))) fail(`Invalid ${name} fields.`);
}
function array(value, maximum, name) {
  if (!Array.isArray(value) || value.length > maximum) fail(`Invalid or oversized ${name}.`);
}
function changedPath(a, b, path = '') {
  if (isDeepStrictEqual(a, b)) return null;
  if (!record(a) && !Array.isArray(a) || !record(b) && !Array.isArray(b)) return path;
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const changed = changedPath(a[key], b[key], path ? `${path}.${key}` : key);
    if (changed !== null) return changed;
  }
  return path;
}
function unchanged(before, after, label) {
  const path = changedPath(json(before), json(after));
  if (path !== null) fail(`${label} is not canonical at ${path}; original checkpoint must be retained.`);
}
// Evidence clocks are past/present facts. Future scheduling fields (expiresAt,
// nextDecisionAt, retryAfter, departureUntil) deliberately are not in this set.
const EVIDENCE_CLOCKS = new Set(['at', 'observedAt', 'completedAt', 'startedAt', 'lastAt', 'updatedAt', 'emptyAt', 'bornAt', 'collectedAt', 'experiencedAt', 'askedAt', 'answeredAt', 'lastContactAt', 'lastSpokeAt', 'lastAskedAt', 'lastJournalAt', 'lastNoteAt', 'lastKnowledgeAt', 'lastAttemptAt', 'lifecycleAt', 'since', 'startAt', 'endAt', 'accountedUntil']);
function evidenceClocks(value, elapsed, path = '') {
  if (typeof value === 'number' && !Number.isFinite(value)) fail(`Nonfinite checkpoint number at ${path}.`);
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    const next = path ? `${path}.${key}` : key;
    if (EVIDENCE_CLOCKS.has(key) && entry !== null && entry !== undefined && !time(entry, elapsed)) fail(`Invalid or future evidence clock at ${next}.`);
    evidenceClocks(entry, elapsed, next);
  }
}
function physiology(raw, elapsed, profile) {
  if (!record(raw) || raw.version !== BIOLOGY_RULES.version || raw.profile !== profile) fail('Unsupported physiology schema.');
  array(raw.stomach, BIOLOGY_RULES.maxDigestiveInputs, 'digestive inputs');
  array(raw.feedback, BIOLOGY_RULES.maxFeedback, 'physiology feedback');
  for (const row of [...raw.stomach, ...raw.feedback]) if (!record(row) || !time(row.at, elapsed)) fail('Invalid or future biological evidence clock.');
}
/** Check schema and raw cardinalities before a default validator can replace or slice them. */
function checkState(state) {
  if (!record(state) || state.simulationMode !== 'discovery' || !time(state.elapsed, 3600 * 100000) ||
      !Array.isArray(state.agents) || state.agents.length !== 1 || state.cardinal !== null) fail('A finite checkpoint requires one discovery actor and no Cardinal.');
  const n = state.agents[0], env = state.environment;
  if (!record(n) || n.version !== 4 || n.mode !== 'discovery' || !['aster', 'mira'].includes(n.id) ||
      n.elapsed !== state.elapsed || !uint(n.rng, 0xffffffff) || !uint(n.epoch) || !record(n.discovery) ||
      n.discovery.version !== 1 || n.cognition?.version !== 1 || n.social?.version !== 1) fail('Unsupported actor schema, RNG or shared clock.');
  if (state.npc !== undefined && state.npc !== n && !isDeepStrictEqual(state.npc, n)) fail('Conflicting single-actor alias.');
  physiology(n.physiology, n.elapsed, 'human');
  evidenceClocks(n, n.elapsed, 'actor');
  // This evidence map is keyed by opaque object IDs, not clock field names.
  if (!record(n.discovery.samplesPending) || Object.entries(n.discovery.samplesPending).some(([id, at]) => !objectId(id) || !time(at, n.elapsed))) fail('Invalid or future pending-sample clock.');
  if (!time(n.discovery.lastDialogueAt, n.elapsed, -60)) fail('Invalid or future discovery dialogue clock.');
  if (!record(n.memory) || !uint(n.memory.nextId) || n.memory.nextId < 1) fail('Invalid actor event cursor.');
  array(n.memory.experience, NPC_RULES.maxExperience, 'ordinary experiences');
  array(n.inventory?.items, DISCOVERY_RULES.capacity, 'held objects');
  for (const [field, maximum] of [['experiments', DISCOVERY_RULES.maxExperiments], ['effects', DISCOVERY_RULES.maxEffects], ['reports', DISCOVERY_RULES.maxReports], ['techniques', DISCOVERY_RULES.maxTechniques], ['seenFeedback', 128]]) array(n.discovery[field], maximum, `discovery ${field}`);
  if (!record(env) || env.schemaVersion !== 3 || env.mode !== 'discovery' || env.elapsed !== state.elapsed ||
      !uint(env.seed, 0xffffffff) || env.worldRules?.version !== 1) fail('Unsupported environment schema or shared clock.');
  const ecology = env.ecology;
  if (!record(ecology) || ecology.version !== ECOLOGY_RULES.version || ecology.distributionVersion !== 3 || ecology.regionalVersion !== 1 ||
      !time(ecology.elapsed, state.elapsed) || !time(ecology.pending, ECOLOGY_RULES.stepSeconds) ||
      Math.abs(ecology.elapsed + ecology.pending - state.elapsed) > 1e-6) fail('Unsupported ecology schema or clock.');
  for (const [field, maximum] of [['plants', ECOLOGY_RULES.maxPlants], ['animals', ECOLOGY_RULES.maxAnimals], ['materials', ECOLOGY_RULES.maxMaterials], ['regions', ECOLOGY_RULES.habitatGridSize ** 2]]) array(ecology[field], maximum, `ecology ${field}`);
  if (ecology.regions.length !== ECOLOGY_RULES.habitatGridSize ** 2) fail('Incomplete regional ecology.');
  for (const animal of ecology.animals) physiology(animal?.physiology, ecology.elapsed, animal?.species);
  evidenceClocks(env, state.elapsed, 'environment');
  evidenceClocks(state.community, state.elapsed, 'community');
  if (state.community?.version !== 1) fail('Unsupported community schema.');
  checkTemporalCapacity(n.discovery.temporal, FINITE_TEMPORAL_PROFILE);
  return n;
}
function temporalClocks(memory, elapsed) {
  if (!time(memory.clockAt, elapsed)) fail('Invalid or future temporal clock.');
  for (const row of memory.receipts) {
    if (!time(row.at, memory.clockAt) || row.completedAt !== undefined && !time(row.completedAt, memory.clockAt, row.at)) fail('Invalid or future receipt clock.');
  }
  for (const row of memory.model.rows) if (!time(row.lastAt, memory.clockAt)) fail('Invalid or future forecast clock.');
  for (const row of memory.model.transitions) if (!time(row.startAt, memory.clockAt) || !time(row.endAt, memory.clockAt, row.startAt)) fail('Invalid or future replay clock.');
  for (const row of [...memory.ingestions, ...memory.events]) if (!time(row.at, memory.clockAt)) fail('Invalid or future temporal evidence clock.');
  for (const row of memory.ingestions) {
    if (!record(row.channelProof) || Object.keys(row.channelProof).some(key => !['0', '1', '2'].includes(key))) fail('Invalid ingestion channel proofs.');
    for (const proof of Object.values(row.channelProof)) if (!time(proof?.at, memory.clockAt, row.at)) fail('Invalid or future channel proof clock.');
  }
  if (memory.open && (!time(memory.open.startAt, memory.clockAt) || !time(memory.open.accountedUntil, memory.clockAt, memory.open.startAt))) fail('Invalid or future open interval clock.');
}
function action(raw) {
  if (!record(raw) || !ACTIONS.has(raw.type) || Object.keys(raw).some(key => !['type', 'targetId', 'target', 'seconds', 'sourceId', 'shelterId', 'duration'].includes(key))) fail('Invalid pending request.');
  if (raw.targetId !== undefined && !objectId(raw.targetId)) fail('Invalid pending target.');
  if (raw.target !== undefined && (!record(raw.target) || Object.keys(raw.target).length !== 2 || !Number.isFinite(raw.target.x) || !Number.isFinite(raw.target.y) || Math.abs(raw.target.x) > 24000 || Math.abs(raw.target.y) > 24000)) fail('Invalid pending destination.');
  for (const field of ['sourceId', 'shelterId']) if (raw[field] !== undefined && (typeof raw[field] !== 'string' || !raw[field].length || raw[field].length > 70)) fail('Invalid pending resource.');
  for (const field of ['seconds', 'duration']) if (raw[field] !== undefined && (!Number.isFinite(raw[field]) || raw[field] <= 0 || raw[field] > 1800)) fail('Invalid pending duration.');
  return clone(raw);
}
function driverState(raw, n, memory) {
  keys(raw, ['senseAt', 'epoch', 'pending'], 'driver');
  if (!time(raw.senseAt, n.elapsed, -1) || !uint(raw.epoch) || raw.epoch !== n.epoch) fail('Invalid driver observation schedule or epoch.');
  let pending = null;
  if (raw.pending !== null) {
    keys(raw.pending, ['seq', 'action', 'previousEventId'], 'pending command');
    const p = raw.pending, request = action(p.action), receipt = memory.receipts.find(row => row.seq === p.seq);
    // The core ledger's bounded projection intentionally omits resource IDs and
    // durations above 1,200 seconds; retain the full normalized driver request.
    const projectedSeconds = request.seconds <= 1200 ? request.seconds : undefined;
    if (!uint(p.seq) || p.seq < 1 || p.seq !== memory.nextSeq - 1 || !uint(p.previousEventId) || p.previousEventId >= n.memory.nextId ||
        !receipt || receipt.outcome || receipt.request.type !== request.type ||
        ['targetId', 'target'].some(key => !isDeepStrictEqual(receipt.request[key], request[key])) ||
        !isDeepStrictEqual(receipt.request.seconds, projectedSeconds)) fail('Pending command does not bind its incomplete submission receipt.');
    pending = { seq: p.seq, action: request, previousEventId: p.previousEventId };
  }
  if ((n.active || n.interrupted) && !pending) fail('Interrupted or active command has no matching driver proof.');
  if (n.active && !isDeepStrictEqual(action(n.active.request), pending.action)) fail('Active command has no matching driver proof.');
  if (pending && !n.active && !n.interrupted) {
    const result = n.lastResult, event = n.memory.experience.find(row => row.id === result?.eventId && row.type === 'action');
    const consumed = ['ok', 'code', 'durationSeconds', 'workedSeconds', 'materialId', 'ingestionId', 'exertion'];
    if (!event || !uint(result.eventId) || result.eventId <= pending.previousEventId || event.at !== n.elapsed || result.at !== event.at || result.action !== pending.action.type ||
        !isDeepStrictEqual(action(event.details?.action), pending.action) || consumed.some(key => !isDeepStrictEqual(event.details?.result?.[key], result[key]))) fail('Idle pending command has no authoritative completion to capture.');
  }
  if (n.skillRun) fail('Skills are not supported by the finite experiment.');
  return { senseAt: raw.senseAt, epoch: raw.epoch, pending };
}
function selectorState(raw, n, memory) {
  keys(raw, ['version', 'rng', 'choices', 'focus'], 'selector');
  if (raw.focus !== null && (!record(raw.focus) || Object.keys(raw.focus).some(key => !['objectId', 'startedAt', 'used', 'parentId', 'proofSeq'].includes(key)))) fail('Invalid finite focus fields.');
  return validateFiniteSelector(raw, { at: n.elapsed }, memory);
}
function actorBudget(envelope, actor = envelope.state.agents[0]) {
  const { state, ...metadata } = envelope;
  const bytes = temporalUtf8Bytes({ ...metadata, actor });
  if (bytes > FINITE_CHECKPOINT.actorBytes) fail('Complete encoded actor and checkpoint policy state exceed the 1 MiB experiment gate.', 'FINITE_ACTOR_BUDGET');
  return bytes;
}
function metadata(arm, sourceFingerprint) {
  if (!ARMS.has(arm) || !fingerprint(sourceFingerprint)) fail('Invalid arm or source fingerprint.');
  return { format: FINITE_CHECKPOINT.format, version: FINITE_CHECKPOINT.version, profile: { ...FINITE_TEMPORAL_PROFILE }, arm, sourceFingerprint };
}
/** Explicit live-to-disk differences in the existing engine, not a repair mask.
 * Restore does not use these allowances: saved data must already be canonical.
 * Everything not listed here, including complete physical stores and evidence
 * array lengths, must survive normal validation exactly.
 */
function expectedLiveActor(raw, memory) {
  const n = json({ ...raw, discovery: { ...raw.discovery, temporal: memory } });
  if (n.active) { n.active = null; n.interrupted = true; }
  // Compatibility body fields are deterministic projections; private physiology
  // is compared in full and cannot acquire missing defaults through this step.
  projectPhysiology(n);
  if (Object.hasOwn(n.sensation, 'rain')) {
    if (typeof n.sensation.rain !== 'boolean' || n.sensation.rain !== n.sensation.raining) fail('Invalid redundant rain sensation.');
    delete n.sensation.rain;
  }
  if (Object.hasOwn(n.sensation, 'rainfall')) {
    if (!Number.isFinite(n.sensation.rainfall) || n.sensation.rainfall < 0 || !n.sensation.raining && n.sensation.rainfall !== 0) fail('Invalid redundant rainfall sensation.');
    delete n.sensation.rainfall;
  }
  for (const [scene, cells] of [['valley', n.memory.cells], ...Object.entries(n.memory.caveCells)]) {
    for (const cell of Object.values(cells)) if (Object.hasOwn(cell, 'scene')) {
      if (cell.scene !== scene) fail('Conflicting remembered cell scene.');
      delete cell.scene;
    }
  }
  for (const [table, kind] of [['sources', 'water'], ['shelters', 'shelter']]) {
    for (const source of Object.values(n.memory[table])) if (Object.hasOwn(source, 'kind')) {
      if (source.kind !== kind) fail('Conflicting remembered resource kind.');
      delete source.kind;
    }
  }
  // Newly observed shelters have no earned relief yet. The production save
  // representation adds these empty counters, never positive relief or proof.
  for (const shelter of Object.values(n.memory.shelters)) {
    for (const field of ['relief', 'reliefCredit']) if (shelter[field] === undefined) shelter[field] = 0;
    if (shelter.creditedEntryId === undefined) shelter.creditedEntryId = null;
  }
  const c = n.cognition;
  if (!time(c.lastUpdateAt, n.elapsed, -1) || !record(c.drives)) fail('Invalid derived cognition cache.');
  for (const [name, drive] of Object.entries(c.drives)) {
    if (!DRIVE_NAMES.includes(name) || !record(drive) || Object.keys(drive).length !== 2 ||
        !['quiet', 'present', 'strong', 'urgent'].includes(drive.tension) || typeof drive.reason !== 'string' || drive.reason.length > 600) fail('Invalid derived drive cache.');
  }
  c.drives = {}; c.lastUpdateAt = -1;
  for (const belief of c.beliefs) {
    for (const field of ['observedAt', 'emptyAt']) if (belief[field] === undefined) belief[field] = 0;
    for (const evidence of belief.evidence) {
      for (const field of ['sourceId', 'resourceId', 'channel', 'messageId']) if (evidence[field] === undefined || evidence[field] === null) evidence[field] = '';
    }
  }
  return n;
}
function expectedLiveEnvironment(raw) {
  const env = json(raw);
  for (const animal of env.ecology.animals) if (animal.feelings && Object.hasOwn(animal.feelings, 'relief')) {
    if (!Number.isFinite(animal.feelings.relief) || animal.feelings.relief < 0 || animal.feelings.relief > 1) fail('Invalid animal relief signal.');
    delete animal.feelings.relief;
    if (Object.keys(animal.feelings).length === 0) delete animal.feelings;
  }
  return env;
}
function canonicalState(raw, restoring) {
  const n = checkState(raw), memory = decodeTemporalWire(n.discovery.temporal);
  temporalClocks(memory, n.elapsed);
  let actor = validateNpc(clone(n), { restoring: false });
  if (n.interrupted === true) actor.interrupted = true;
  const decodedActor = { ...n, discovery: { ...n.discovery, temporal: memory } };
  if (restoring && n.active !== null) fail('Wire checkpoint must contain a canceled command marker, not a live command.');
  unchanged(restoring ? decodedActor : expectedLiveActor(n, memory), actor, 'Actor/body/evidence');
  const environment = validateEnvironment(clone(raw.environment), { elapsed: raw.elapsed, mode: 'discovery' });
  unchanged(restoring ? raw.environment : expectedLiveEnvironment(raw.environment), environment, 'Environment');
  const community = validateCommunity(clone(raw.community));
  unchanged(raw.community, community, 'Community');
  if (restoring) {
    const expected = clone(actor);
    if (n.interrupted === true) {
      delete expected.interrupted;
      recordEvent(expected, 'action', { action: { type: 'wait' }, result: { ok: false, code: 'RESTART_INTERRUPTED' }, context: policyContext(expected), startPosition: expected.position });
      expected.decision = 'An interrupted action was cancelled on restart; my experience is retained.';
    }
    actor = validateNpc(clone(n), { restoring: true });
    unchanged(expected, actor, 'Restored interruption state');
  }
  // Every canonical field is checked, not merely temporal history: damaged body
  // or world data must never be silently replenished, dropped, clamped or sliced.
  unchanged(memory, actor.discovery.temporal, 'Temporal history');
  checkTemporalCapacity(actor.discovery.temporal, FINITE_TEMPORAL_PROFILE);
  temporalClocks(actor.discovery.temporal, actor.elapsed);
  applyTemporalCapacity(actor.discovery.temporal, FINITE_TEMPORAL_PROFILE);
  const state = {
    elapsed: raw.elapsed, simulationMode: 'discovery', environment,
    agents: [actor], community, cardinal: null,
  };
  state.npc = actor;
  checkState(state);
  return state;
}
/** Encode only validated state. No training, admission, trimming or mutation of the input. */
export function serializeFiniteCheckpoint({ state, selector, driver, arm, sourceFingerprint }) {
  const header = metadata(arm, sourceFingerprint), rawActor = checkState(state), memory = decodeTemporalWire(rawActor.discovery.temporal);
  const validatedDriver = driverState(driver, rawActor, memory), validatedSelector = selectorState(selector, rawActor, memory);
  // A raw ordinary actor that cannot fit even without its temporal payload must
  // fail the byte gate before a text/array normalizer could shrink it.
  actorBudget({ ...header, state, selector: validatedSelector, driver: validatedDriver }, { ...rawActor, discovery: { ...rawActor.discovery, temporal: null } });
  const canonical = canonicalState(state, false), actor = canonical.agents[0];
  const encoded = { ...actor, discovery: { ...actor.discovery, temporal: encodeTemporalWire(actor.discovery.temporal) } };
  const { npc, ...withoutAlias } = canonical;
  const envelope = { ...header, state: { ...withoutAlias, agents: [encoded] }, selector: validatedSelector, driver: validatedDriver };
  // Count ordinary memory as supplied too: normalization may not rescue a failed size gate.
  actorBudget(envelope, { ...rawActor, discovery: { ...rawActor.discovery, temporal: encoded.discovery.temporal } });
  actorBudget(envelope);
  return JSON.stringify(envelope);
}
/** Decode the experiment envelope, never validateSave (which inserts a second actor). */
export function restoreFiniteCheckpoint(text, { expectedArm, expectedSourceFingerprint } = {}) {
  if (typeof text !== 'string') fail('Checkpoint input must be its original JSON text.');
  let raw;
  try { raw = JSON.parse(text); } catch { fail('Invalid checkpoint JSON; original text must be retained.'); }
  keys(raw, ['format', 'version', 'profile', 'arm', 'sourceFingerprint', 'state', 'selector', 'driver'], 'checkpoint envelope');
  if (raw.format !== FINITE_CHECKPOINT.format || raw.version !== FINITE_CHECKPOINT.version) fail('Unsupported finite checkpoint format.');
  if (!record(raw.profile)) fail('Checkpoint must include the complete named capacity profile.');
  resolveTemporalCapacity(raw.profile);
  metadata(raw.arm, raw.sourceFingerprint);
  if (!ARMS.has(expectedArm) || !fingerprint(expectedSourceFingerprint) || raw.arm !== expectedArm || raw.sourceFingerprint !== expectedSourceFingerprint) fail('Checkpoint arm or source fingerprint does not match the experiment.');
  keys(raw.state, ['elapsed', 'simulationMode', 'environment', 'agents', 'community', 'cardinal'], 'checkpoint state');
  const rawActor = checkState(raw.state);
  if (rawActor.discovery.temporal.encoding !== TEMPORAL_STORAGE.encoding) fail('A checkpoint requires the canonical temporal wire encoding.');
  actorBudget(raw);
  const memory = decodeTemporalWire(rawActor.discovery.temporal);
  const driver = driverState(raw.driver, rawActor, memory), selector = selectorState(raw.selector, rawActor, memory);
  const interrupted = Boolean(rawActor.active || rawActor.interrupted || rawActor.skillRun);
  const state = canonicalState(raw.state, true), n = state.agents[0];
  const canonicalSelector = selectorState(selector, n, n.discovery.temporal);
  let pendingDisposition = null;
  if (driver.pending && interrupted) {
    pendingDisposition = { status: 'interrupted', interrupted: true, reason: 'RESTART_INTERRUPTED', ...clone(driver.pending) };
    driver.pending = null;
  } else if (driver.pending) pendingDisposition = { status: 'pending', interrupted: false, ...clone(driver.pending) };
  driver.epoch = n.epoch;
  driverState(driver, n, n.discovery.temporal);
  // Restoration records the game's interruption, but never gives the learner completion/work credit.
  const encoded = { ...n, discovery: { ...n.discovery, temporal: encodeTemporalWire(n.discovery.temporal) } };
  actorBudget({ ...raw, selector: canonicalSelector, driver }, encoded);
  return { state, selector: canonicalSelector, driver, arm: raw.arm, profile: FINITE_TEMPORAL_PROFILE, pendingDisposition };
}
