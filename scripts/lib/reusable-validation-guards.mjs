/** Owner-side resource/argument guards. Importing never constructs a world. */
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createReturnedWorkGuard } from '../evaluate-reusable-prediction.mjs';
import { reusablePredictionActorEnvelope } from './reusable-prediction-fixture.mjs';

export const VALIDATION_LIMITS = Object.freeze({ actorBytes: 1048576, returnedMs: 1000, wallSeconds: 300,
  childMs: 315000, graceMs: 15000, sampledEverySeconds: 15 });
const SAMPLED_BOUNDARIES = new Set(['setup-before', 'setup-after', 'command-before', 'command-after',
  'query-before', 'query-after', 'reopen-before', 'reopen-after', 'checkpoint-before', 'checkpoint-after',
  'freeze', 'stop-before', 'stop-after']);
export function parseValidationArguments(argv, { child = false } = {}) {
  const out = {}, allowed = child ? ['preflight', 'output', 'run-id', 'inputs'] : ['preflight', 'output'];
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i]?.slice(2), value = argv[i + 1];
    if (!argv[i]?.startsWith('--') || !allowed.includes(name) || Object.hasOwn(out, name) || !value || value.startsWith('--'))
      throw new Error('Only explicit, unique validation options are accepted');
    out[name] = name === 'run-id' ? value : resolve(value);
  }
  if (allowed.some(name => !out[name])) throw new Error(`Required validation options: ${allowed.join(', ')}`);
  return out;
}
export function measureValidationActors(fixture, sourceFingerprint, frozenModel = null) {
  const envelope = reusablePredictionActorEnvelope({ actor: fixture.npc, selector: fixture.selector,
    driver: fixture.checkpointDriver(), model: fixture.model, sensor: fixture.sensor, admission: fixture.admission,
    sourceFingerprint, predictionArm: fixture.predictionArm, sensorEnabled: fixture.sensorEnabled });
  const online = Buffer.byteLength(JSON.stringify(envelope), 'utf8');
  // This is only size accounting. A frozen numerical snapshot plus the current
  // online admission state must never be presented as a restorable actor.
  const frozen = frozenModel === null ? null : Buffer.byteLength(JSON.stringify({ ...envelope, model: frozenModel }), 'utf8');
  return { onlineActorBytes: online, frozenAccountingBytes: frozen, actorBytes: Math.max(online, frozen ?? 0),
    frozenSnapshotOwnerBytes: frozenModel === null ? 0 : Buffer.byteLength(JSON.stringify(frozenModel), 'utf8'),
    frozenSubstitutionRestorable: false };
}
export function createValidationResourceGuard({ sourceFingerprint, now = () => performance.now(),
  startedAt = now(), measureActor = measureValidationActors, onSample = () => {} } = {}) {
  const segments = createReturnedWorkGuard({ now, ceilingMs: VALIDATION_LIMITS.returnedMs });
  const state = { sampledPeakActorBytes: 0, maximumReturnedDecisionMs: 0, maximumCombinedDecisionMs: 0, samples: [], violations: [],
    returnedSegments: segments.state, sampledWireOnly: true, resourceCensored: false };
  let fixture = null, frozenModel = null, lastResourceAt = -Infinity;
  const elapsed = () => (now() - startedAt) / 1000;
  const stop = message => {
    state.resourceCensored = true; state.violations.push({ at: fixture?.npc.elapsed ?? null, message });
    const error = new Error(message); error.code = 'VALIDATION_RESOURCE_CEILING'; throw error;
  };
  const checkWall = () => {
    const value = elapsed();
    if (!Number.isFinite(value) || value < 0 || value > VALIDATION_LIMITS.wallSeconds) stop('Run wall time exceeded 300 seconds or is invalid');
    return value;
  };
  const measure = (reason = 'stop') => {
    if (!fixture) return null;
    const value = measureActor(fixture, sourceFingerprint, frozenModel);
    if (!value || !Number.isSafeInteger(value.actorBytes) || value.actorBytes < 0) stop('Whole actor byte accounting is unavailable');
    const row = { at: fixture.npc.elapsed, reason, ...value }; state.samples.push(row);
    state.sampledPeakActorBytes = Math.max(state.sampledPeakActorBytes, value.actorBytes);
    lastResourceAt = fixture.npc.elapsed; onSample(row);
    if (value.actorBytes > VALIDATION_LIMITS.actorBytes) stop('Complete actor accounting exceeds 1 MiB');
    return row;
  };
  const boundary = (info, f, context = {}) => {
    try { segments.enter(info.kind); } catch (error) { stop(error.message); }
    if (f && fixture !== f) lastResourceAt = -Infinity;
    if (f) fixture = f;
    if (Object.hasOwn(context, 'frozenModel')) frozenModel = context.frozenModel;
    checkWall();
    if (info.returnedDecisionMs !== undefined) {
      const ms = info.returnedDecisionMs;
      if (!Number.isFinite(ms) || ms < 0) stop('Returned decision timing is invalid');
      state.maximumReturnedDecisionMs = Math.max(state.maximumReturnedDecisionMs, ms);
      if (ms > VALIDATION_LIMITS.returnedMs) stop('Returned decision exceeded 1000 ms');
    }
    if (info.combinedDecisionMs !== undefined) {
      const ms = info.combinedDecisionMs;
      if (!Number.isFinite(ms) || ms < 0) stop('Combined decision timing is invalid');
      state.maximumCombinedDecisionMs = Math.max(state.maximumCombinedDecisionMs, ms);
      if (ms > VALIDATION_LIMITS.returnedMs) stop('Combined root and forecast decision exceeded 1000 ms');
    }
    if (fixture?.diagnosticError) throw new Error(`Owner trace failed: ${fixture.diagnosticError}`);
    if (fixture && (fixture.admission.deniedSubmissions || fixture.admission.deniedBatches)) {
      const error = new Error('Capacity admission denial makes the declared prediction unavailable');
      error.code = 'VALIDATION_UNAVAILABLE'; throw error;
    }
    if (fixture && (fixture.npc.elapsed - lastResourceAt >= VALIDATION_LIMITS.sampledEverySeconds ||
      SAMPLED_BOUNDARIES.has(info.kind))) measure(info.kind);
    checkWall(); segments.leave(info.kind);
  };
  return { state, boundary, measure, checkWall, elapsed, get fixture() { return fixture; },
    get frozenModel() { return frozenModel; } };
}
/** Final report writes cannot turn a resource-truncated run into a pass. */
export function finalizeValidationReport(report, { elapsedSeconds, persist }) {
  const check = () => {
    const seconds = elapsedSeconds(); report.wallSeconds = Number.isFinite(seconds) ? seconds : null;
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > VALIDATION_LIMITS.wallSeconds) {
      report.status = 'censored'; report.resourceCensored = true;
      report.resourceFinalizationFailure = 'Finalization exceeded 300 seconds or has invalid time';
    }
  };
  check(); persist(); const before = report.wallSeconds; check();
  if (report.status === 'censored' || report.wallSeconds < before) {
    if (report.wallSeconds < before) { report.status = 'censored'; report.resourceCensored = true; report.resourceFinalizationFailure = 'Finalization clock reversed'; }
    persist();
  }
  return report;
}
