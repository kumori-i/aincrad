#!/usr/bin/env node
/** Frozen Gate1 only. Import-safe; no autonomy or progression to later gates.
 * node scripts/evaluate-reusable-prediction.mjs --preflight FILE --output NEW_DIR
 * Run under an owned-process external timeout: this synchronous native simulation
 * checks returned work/deadlines; it cannot interrupt a nonreturning operation.
 */
import { openSync, writeSync, fsyncSync, closeSync, readFileSync, renameSync } from 'node:fs';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { cpus, loadavg } from 'node:os';
import { readPredictionPreflight } from './lib/reusable-prediction-preflight.mjs';
import { readScriptedPredictionPreflight, scriptedPredictionExecutionSources } from './lib/scripted-prediction-preflight.mjs';
import { runSameMaterialAssay, SAME_MATERIAL_ASSAY } from './lib/reusable-same-material-assay.mjs';
import { reusableActorBytes } from './lib/reusable-prediction-fixture.mjs';
import { resourceSources } from './measure-reusable-prediction.mjs';
import { REUSABLE_GATES } from './lib/reusable-prediction-gates.mjs';
const SELF = fileURLToPath(import.meta.url), ROOT = resolve(dirname(SELF), '..');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonHash = x => digest(JSON.stringify(x));
const copy = x => structuredClone(x);
export function parsePredictionArguments(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i];
    if (!['--preflight', '--output', '--protocol'].includes(name) || result[name.slice(2)] || !argv[i + 1] || argv[i + 1].startsWith('--'))
      throw new Error(`Unknown, repeated or missing prediction option: ${name}`);
    const value = argv[++i];
    if (name === '--protocol' && value !== 'scripted-prediction-use-v1') throw new Error('Unsupported prediction protocol');
    result[name.slice(2)] = name === '--protocol' ? value : resolve(value);
  }
  if (!result.preflight || !result.output) throw new Error('A verified preflight and exclusive output directory are required');
  return result;
}
function writeOwned(path, value, exclusive = true) {
  const fd = openSync(path, exclusive ? 'wx' : 'w');
  try { writeSync(fd, value); fsyncSync(fd); } finally { closeSync(fd); }
}
function errorRecord(error) { return { code: error?.code || null, message: String(error?.message || error), stack: error?.stack || null }; }
/** Check both expensive final evidence work and the durable report write itself. */
export function finalizePredictionReport(report, { elapsedSeconds, persist }) {
  const failTime = (seconds, message) => {
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > REUSABLE_GATES.wallSeconds) {
      report.wallSeconds = Number.isFinite(seconds) ? seconds : null;
      report.resourceFinalizationFailure = message;
      report.status = 'failed'; report.continuingAllowed = false; report.resourceCensored = true;
    }
  };
  report.wallSeconds = elapsedSeconds();
  failTime(report.wallSeconds, 'Trace finalization exceeded300 seconds or has invalid time');
  report.wallMeasurement = 'wallSeconds is measured before the final report write; checked again after that write/fsync before return';
  persist();
  const after = elapsedSeconds();
  if (!Number.isFinite(after) || after < report.wallSeconds || after > REUSABLE_GATES.wallSeconds) {
    failTime(after < report.wallSeconds ? NaN : after, 'Final report write/fsync exceeded300 seconds or has invalid time');
    persist();
  }
  return report;
}
/** Owner-only conservative wall segments; no live actor instrumentation. */
export function createReturnedWorkGuard({ now = () => performance.now(), ceilingMs = REUSABLE_GATES.returnedDecisionMs } = {}) {
  let previous = null;
  const state = { maxMs: 0, from: null, to: null, checked: 0 };
  return {
    state,
    enter(kind) {
      const current = now();
      if (!Number.isFinite(current)) throw new Error('Invalid returned-work clock');
      if (previous && !(previous.kind === 'setup-before' && kind === 'setup-after')) {
        const elapsed = current - previous.at;
        if (!Number.isFinite(elapsed) || elapsed < 0) throw new Error('Returned-work clock moved backwards');
        state.checked++;
        if (elapsed > state.maxMs) Object.assign(state, { maxMs: elapsed, from: previous.kind, to: kind });
        if (elapsed > ceilingMs) throw new Error('Returned work segment exceeded1000 ms');
      }
    },
    leave(kind) {
      const at = now(); if (!Number.isFinite(at)) throw new Error('Invalid returned-work clock');
      previous = { at, kind };
    },
  };
}
export function retainProducerDecisionTiming(report, evidence) {
  const value = evidence?.resource?.maximumDecisionMs;
  if (Number.isFinite(value) && value >= 0)
    report.resources.maxReturnedDecisionMs = Math.max(report.resources.maxReturnedDecisionMs, value);
}
export async function runPredictionEvaluation({ preflight, output, protocol }) {
  // All source/evidence/resource checks happen before world construction.
  if (protocol !== undefined && protocol !== 'scripted-prediction-use-v1') throw new Error('Unsupported prediction protocol');
  const scripted = protocol === 'scripted-prediction-use-v1';
  const admitted = await (scripted ? readScriptedPredictionPreflight : readPredictionPreflight)(preflight, { evaluatorPath: SELF, root: ROOT });
  await mkdir(output, { recursive: false });
  const tracePath = resolve(output, 'trace.jsonl'), trace = openSync(tracePath, 'wx');
  let traceOrder = 0, fixture = null, result = null, lastResourceAt = -Infinity, frameNumber = 0;
  const workGuard = scripted ? createReturnedWorkGuard() : null;
  const started = performance.now(), reportPath = resolve(output, 'report.json'), resourceSamples = [];
  const report = { schemaVersion: 1, kind: scripted ? 'scripted-prediction-use-diagnostic' : 'reusable-same-material-assay', stage: 'gate1-only',
    startedAt: new Date().toISOString(), status: 'running', protocol: SAME_MATERIAL_ASSAY,
    resourceProtocol: protocol || 'reusable-outcome-increment-a',
    originalResourceAdmissionPassed: scripted ? false : true, continuingAllowed: false,
    preflight: admitted, noAutonomy: true, noMainPromotion: true, terminal: false,
    limitations: ['One physically earned material example; sixteen queries are sensitivity checks, not independent discoveries',
      'Biological outcomes continue after the preserved stop', 'Cloud CPU only; no interactive or laptop readiness claim',
      'Encoded actor sizes are sampled at setup, command/query boundaries, each15 simulation seconds and stop; not every clock tick',
      'A separate process timeout must preserve this durable prefix if an operation never returns'],
    hardware: { node: process.version, cpu: cpus()[0]?.model, logicalCpus: cpus().length, loadAtStart: loadavg() },
    resources: { samples: resourceSamples, sampledPeakActorBytes: 0, maxReturnedDecisionMs: 0, violations: [], timingScope: scripted ? 'Conservative whole returned work segments plus producer construction+forecast; callback persistence excluded from segments but included in total wall' : 'Producer construction+forecast', returnedWorkSegments: workGuard?.state || null },
    laterGates: { status: 'not-run', reason: 'This producer executes only the first preregistered gate; no automatic continuation.' } };
  const persist = () => {
    const pending = `${reportPath}.next`; writeOwned(pending, `${JSON.stringify(report, null, 2)}\n`, false); renameSync(pending, reportPath);
  };
  const event = row => { writeSync(trace, `${JSON.stringify({ traceOrder: ++traceOrder, ...row })}\n`); };
  const measure = (f, reason) => {
    const bytes = reusableActorBytes({ actor: f.npc, selector: f.selector, driver: f.checkpointDriver(), model: f.model,
      sensor: f.sensor, admission: f.admission, sourceFingerprint: admitted.sources.runtimeSource,
      predictionArm: f.predictionArm, sensorEnabled: f.sensorEnabled });
    const sample = { at: f.npc.elapsed, reason, actorBytes: bytes }; resourceSamples.push(sample);
    report.resources.sampledPeakActorBytes = Math.max(report.resources.sampledPeakActorBytes, bytes);
    lastResourceAt = f.npc.elapsed;
    if (bytes > REUSABLE_GATES.actorBytes) resourceStop('Whole encoded actor exceeds1 MiB');
    return sample;
  };
  const resourceStop = message => {
    report.resources.violations.push({ at: fixture?.npc.elapsed ?? null, message });
    const error = new Error(message); error.code = 'SCRIPTED_RESOURCE_CEILING'; throw error;
  };
  const boundary = (info, f) => {
    try { workGuard?.enter(info.kind); } catch (error) { resourceStop(error.message); }
    if (f) fixture = f;
    const wall = (performance.now() - started) / 1000;
    if (wall > REUSABLE_GATES.wallSeconds) resourceStop('Fixture exceeded300-second wall ceiling');
    if (Number.isFinite(info.returnedDecisionMs)) {
      report.resources.maxReturnedDecisionMs = Math.max(report.resources.maxReturnedDecisionMs, info.returnedDecisionMs);
      if (info.returnedDecisionMs > REUSABLE_GATES.returnedDecisionMs) resourceStop('Returned added decision exceeded1000 ms');
    }
    if (f?.diagnosticError) throw new Error(`Owner trace failed: ${f.diagnosticError}`);
    if (f && (f.admission.deniedSubmissions || f.admission.deniedBatches)) throw new Error('Capacity denial prevents further assay scoring');
    if (f && (f.npc.elapsed - lastResourceAt >= 15 || /command-after|prediction-after|setup-after|snapshot-after|parameters-frozen|gate-after/.test(info.kind || ''))) {
      event({ type: 'resource-snapshot', ...measure(f, info.kind) }); fsyncSync(trace); persist();
    }
    frameNumber = info.frames ?? frameNumber;
    workGuard?.leave(info.kind);
  };
  try {
    persist();
    result = runSameMaterialAssay({ sourceFingerprint: admitted.sources.runtimeSource, onBoundary: boundary, onEvent: event, now: () => performance.now() });
    fixture = result.fixture || fixture;
    report.gate = result.result; report.evidence = result.evidence;
    retainProducerDecisionTiming(report, result.evidence);
    report.status = result.result.status;
    report.continuingAllowed = !scripted && result.result.passed === true;
  } catch (error) {
    report.status = 'failed'; report.error = errorRecord(error); report.continuingAllowed = false;
  } finally {
    if (fixture) {
      try {
        measure(fixture, 'stop');
        const checkpoint = fixture.serializeCheckpoint({ sourceFingerprint: admitted.sources.runtimeSource });
        const path = resolve(output, 'stop.json'); writeOwned(path, checkpoint);
        report.stop = { path: 'stop.json', bytes: Buffer.byteLength(checkpoint), sha256: digest(checkpoint), at: fixture.npc.elapsed,
          active: copy(fixture.npc.active), pending: copy(fixture.pending), terminal: false };
      } catch (error) { report.stop = { available: false, error: errorRecord(error) }; report.status = 'failed'; report.continuingAllowed = false; }
      fixture.dispose();
    } else report.stop = { available: false, reason: 'No fixture was constructed.' };
    try {
      report.sourcesAfter = await resourceSources(ROOT);
      report.evaluatorSha256After = digest(await readFile(SELF));
      if (scripted) {
        report.executionSourcesAfter = await scriptedPredictionExecutionSources(ROOT);
        if (jsonHash(report.executionSourcesAfter) !== jsonHash(admitted.executionSources))
          throw new Error('Execution wrapper or protocol tests changed during physical assay');
      }
      if (jsonHash(report.sourcesAfter) !== jsonHash(admitted.sources) || report.evaluatorSha256After !== admitted.evaluatorSha256)
        throw new Error('Sources changed during physical assay');
    } catch (error) { report.sourceError = errorRecord(error); report.status = 'failed'; report.continuingAllowed = false; }
    report.wallSeconds = (performance.now() - started) / 1000;
    if (report.wallSeconds > REUSABLE_GATES.wallSeconds) {
      report.resourceFinalizationFailure = 'Total fixture wall time including finalization exceeded300 seconds';
      report.status = 'failed'; report.continuingAllowed = false;
    }
    report.resourceCensored = Boolean(report.resourceFinalizationFailure || report.error?.message?.match(/ceiling|exceeded|work segment/i) || report.resources.violations.length || result?.evidence?.stop?.code === 'REUSABLE_RUNTIME_LIMIT');
    report.frames = frameNumber; report.finishedAt = new Date().toISOString(); report.hardware.loadAtEnd = loadavg();
    event({ type: 'stop', status: report.status, at: fixture?.npc.elapsed ?? null, terminal: false, furtherBiologicalOutcomesRightCensored: true });
    fsyncSync(trace); closeSync(trace);
    const traceBytes = readFileSync(tracePath); report.trace = { path: 'trace.jsonl', bytes: traceBytes.length, sha256: digest(traceBytes), rows: traceOrder };
    finalizePredictionReport(report, { elapsedSeconds: () => (performance.now() - started) / 1000, persist });
  }
  return report;
}
if (process.argv[1] && resolve(process.argv[1]) === SELF) {
  try {
    const args = parsePredictionArguments(process.argv.slice(2)), report = await runPredictionEvaluation(args);
    process.stdout.write(`${JSON.stringify({ output: args.output, status: report.status, gate: report.gate, resources: { sampledPeakActorBytes: report.resources.sampledPeakActorBytes, maxReturnedDecisionMs: report.resources.maxReturnedDecisionMs, wallSeconds: report.wallSeconds } }, null, 2)}\n`);
    if (report.status !== 'passed') process.exitCode = 2;
  } catch (error) { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 2; }
}
