#!/usr/bin/env node
/** Fixed sequential census; every physical case has one owned child and deadline. */
import { spawn } from 'node:child_process';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { armChildStop, guardChildSetup } from './run-finite-headless.mjs';
import { VALIDATION_CENSUS } from './lib/reusable-validation-evidence.mjs';
import { readValidationPreflight, VALIDATION_PREFLIGHT } from './lib/reusable-validation-preflight.mjs';
import { parseValidationArguments, VALIDATION_LIMITS } from './lib/reusable-validation-guards.mjs';
const SELF = fileURLToPath(import.meta.url), ROOT = resolve(dirname(SELF), '..');
const EVALUATOR = resolve(ROOT, 'scripts/evaluate-prediction-validation.mjs');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const idOf = r => r.id || r.runId;
async function preserved(path) {
  try { const bytes = await readFile(path); return { path, available: true, bytes: bytes.length, sha256: hash(bytes) }; }
  catch (error) { return { path, available: false, error: String(error.code || error.message).slice(0, 200) }; }
}
export async function preservedValidationRun(output, { processCensored = false } = {}) {
  const report = await preserved(resolve(output, 'report.json')), trace = await preserved(resolve(output, 'trace.jsonl'));
  const stopState = await preserved(resolve(output, 'stop.json')), exports = await preserved(resolve(output, 'exports.json'));
  let value = null;
  if (report.available) try { value = JSON.parse(await readFile(report.path, 'utf8')); } catch (error) { report.parseError = String(error.message).slice(0, 200); }
  const blobEvidence = { verified: false, files: [], error: null };
  if (exports.available) try {
    const packed = JSON.parse(await readFile(exports.path, 'utf8'));
    if (packed.transport !== 'sha256-files-v1' || !packed.blobs || typeof packed.blobs !== 'object' || Array.isArray(packed.blobs))
      throw new Error('Missing canonical blob transport');
    for (const [sha256, proof] of Object.entries(packed.blobs)) {
      if (!/^[a-f0-9]{64}$/.test(sha256) || proof?.sha256 !== sha256 || proof.path !== `blobs/${sha256}.json`)
        throw new Error('Invalid blob evidence reference');
      const actual = await preserved(resolve(output, proof.path)); blobEvidence.files.push(actual);
      if (!actual.available || actual.sha256 !== sha256 || actual.bytes !== proof.bytes) throw new Error('Missing or damaged evidence blob');
    }
    blobEvidence.verified = true;
  } catch (error) { blobEvidence.error = String(error.message).slice(0, 240); }
  const attempted = Boolean(value?.startedAt || trace.available || stopState.available);
  const completeProofs = !processCensored && value?.protocol === VALIDATION_PREFLIGHT.protocol && value.resourceCensored === false && value.finishedAt &&
    trace.available && value.trace?.sha256 === trace.sha256 && value.trace.bytes === trace.bytes &&
    exports.available && value.exports?.sha256 === exports.sha256 && blobEvidence.verified;
  const complete = completeProofs && stopState.available && value.stop?.available === true &&
    value.stop.sha256 === stopState.sha256 && value.stop.bytes === stopState.bytes &&
    ['passed', 'failed', 'unavailable'].includes(value.status);
  const verifiedNeverStarted = Boolean(completeProofs && value.status === 'blocked' && value.evidence?.stop?.neverStarted === true &&
    value.stop?.available === false && !stopState.available && stopState.error === 'ENOENT');
  return { report, trace, stopState, exports, blobEvidence, verifiedNeverStarted, rawStatus: value?.status ?? null,
    classification: verifiedNeverStarted ? 'blocked' : complete ? 'completed' : attempted ? 'censored' : 'blocked',
    passed: Boolean(complete && value.status === 'passed' && exports.available && value.exports?.sha256 === exports.sha256 && blobEvidence.verified),
    finalStateAvailable: stopState.available, metricsReconstructed: false, finalStateReconstructed: false };
}
export function validationSupervisorCaseStatus(child, preserved) {
  if (child.status === 'finished' && preserved.passed) return 'passed';
  if (preserved.verifiedNeverStarted && !child.trigger && !child.setupError && !child.persistenceError) return 'blocked';
  if (preserved.classification === 'censored' || child.trigger || child.setupError || child.persistenceError) return 'censored';
  if (['failed', 'unavailable'].includes(preserved.rawStatus)) return preserved.rawStatus;
  return child.status === 'failed' ? 'failed' : 'blocked';
}
/** Cleanup is installed before any post-spawn await. Only this child is signaled. */
export async function runOwnedValidationChild({ args, persist = async () => {}, onState = () => {},
  spawnChild = () => spawn(process.execPath, [EVALUATOR, ...args], { cwd: ROOT, stdio: 'inherit' }),
  now = () => performance.now(), deadlineMs = VALIDATION_LIMITS.childMs, graceMs = VALIDATION_LIMITS.graceMs,
  pollMs = 1000, signals = process } = {}) {
  if (!Number.isFinite(deadlineMs) || !Number.isFinite(graceMs) || graceMs < 0 || deadlineMs <= graceMs) throw new Error('Invalid owned-child deadline');
  const start = now(), state = { status: 'starting', trigger: null, retries: 0, pid: null, source: EVALUATOR };
  const child = spawnChild(); state.pid = child.pid ?? null; state.status = 'running';
  let finished = false, polling = false, grace = null, childError = null;
  const closed = new Promise(resolve => {
    child.once('error', error => { childError = String(error.message); });
    child.once('close', (code, signal) => { finished = true; resolve({ code, signal, ...(childError ? { error: childError } : {}) }); });
  });
  const snapshot = async () => { state.wallMs = now() - start; onState(state); await persist(); };
  const trigger = reason => {
    if (finished || state.trigger) return Promise.resolve();
    state.trigger = { reason, atMs: now() - start, signal: 'SIGTERM', hardDeadlineMs: deadlineMs }; onState(state);
    const stopping = armChildStop(child, () => finished, snapshot, { graceMs,
      onHardKill: () => { state.trigger.hardKill = true; state.trigger.hardKillAtMs = now() - start; onState(state); },
      onWriteError: error => { state.persistenceError = String(error.message).slice(0, 240); } });
    grace = stopping.timer; return stopping.recorded;
  };
  const stop = reason => { try { void trigger(reason).catch(() => child.kill('SIGKILL')); } catch { child.kill('SIGKILL'); } };
  const deadline = setTimeout(() => stop('absolute owned-case deadline'), Math.max(0, deadlineMs - graceMs - (now() - start)));
  const interrupt = () => stop('supervisor interrupted');
  signals.once('SIGINT', interrupt); signals.once('SIGTERM', interrupt);
  const timer = setInterval(async () => {
    if (finished || polling || state.trigger) return;
    polling = true;
    try { await snapshot(); } catch (error) { await trigger(`persistence failed: ${String(error.message).slice(0, 180)}`); }
    finally { polling = false; }
  }, pollMs);
  let setupError = null;
  try { await guardChildSetup(child, closed, snapshot); }
  catch (error) { setupError = String(error.message); state.setupError = setupError; }
  const outcome = await closed;
  clearTimeout(deadline); clearInterval(timer); if (grace) clearTimeout(grace);
  signals.removeListener('SIGINT', interrupt); signals.removeListener('SIGTERM', interrupt);
  while (polling) await new Promise(resolve => setTimeout(resolve, 5));
  state.status = state.trigger ? 'censored-process' : outcome.code === 0 && !setupError ? 'finished' : 'failed';
  state.outcome = outcome; state.wallMs = now() - start; onState(state);
  try { await persist(); } catch (error) { state.persistenceError = String(error.message).slice(0, 240); state.status = 'failed'; }
  return state;
}
export async function main(argv = process.argv.slice(2)) {
  const options = parseValidationArguments(argv), statusPath = `${options.output}.supervisor.json`;
  const status = { version: 1, kind: 'scripted-prediction-validation-supervisor', protocol: VALIDATION_PREFLIGHT.protocol,
    startedAt: new Date().toISOString(), status: 'starting', options, retries: 0, autonomy: false,
    mainPromotion: false, continuingAllowed: false, originalResourceAdmissionPassed: false, terminal: false,
    supervisorSha256: hash(await readFile(SELF)), limits: VALIDATION_LIMITS,
    census: VALIDATION_CENSUS.map(r => ({ runId: idOf(r), status: 'not-started', finalStateAvailable: false,
      stopState: { path: resolve(options.output, idOf(r), 'stop.json'), available: false, reason: 'Case has not started' } })) };
  await writeFile(statusPath, `${JSON.stringify(status, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  let writes = Promise.resolve();
  const persist = () => {
    const bytes = `${JSON.stringify(status, null, 2)}\n`, pending = `${statusPath}.${process.pid}.next`;
    const work = async () => { await writeFile(pending, bytes, { flag: 'w', mode: 0o600 }); await rename(pending, statusPath); };
    writes = writes.then(work, work); return writes;
  };
  try {
    const admitted = await readValidationPreflight(options.preflight, { root: ROOT });
    status.preflight = { path: admitted.path, sha256: admitted.sha256, sources: admitted.sources, executionSources: admitted.executionSources };
    await mkdir(options.output, { recursive: false });
    const predecessors = []; status.status = 'running'; await persist();
    for (const row of status.census) {
      const output = resolve(options.output, row.runId), inputPath = resolve(options.output, `${row.runId}.inputs.json`);
      await writeFile(inputPath, `${JSON.stringify({ version: 1, protocol: VALIDATION_PREFLIGHT.protocol, runId: row.runId,
        preflightSha256: admitted.sha256, predecessors }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      row.status = 'running'; row.startedAt = new Date().toISOString();
      const child = await runOwnedValidationChild({ args: ['--preflight', options.preflight, '--output', output, '--run-id', row.runId, '--inputs', inputPath],
        persist, onState: value => { row.child = structuredClone(value); } });
      row.preserved = await preservedValidationRun(output, { processCensored: Boolean(child.trigger || child.setupError || child.persistenceError) });
      row.finalStateAvailable = row.preserved.finalStateAvailable; row.stopState = row.preserved.stopState;
      row.rawStatus = row.preserved.rawStatus;
      row.status = validationSupervisorCaseStatus(child, row.preserved);
      row.finishedAt = new Date().toISOString();
      if (child.status !== 'finished' || !row.preserved.passed) {
        status.status = 'stopped'; status.stoppedAtRun = row.runId;
        for (const later of status.census.slice(status.census.indexOf(row) + 1)) { later.status = 'blocked'; later.reason = `Prior case ${row.runId} did not pass`; }
        await persist(); break;
      }
      predecessors.push({ runId: row.runId, report: { path: row.preserved.report.path, sha256: row.preserved.report.sha256 },
        exports: { path: row.preserved.exports.path, sha256: row.preserved.exports.sha256 } });
      await persist();
    }
    if (status.census.every(r => r.status === 'passed')) status.status = 'finished';
  } catch (error) {
    status.status = 'blocked'; status.error = String(error.stack || error);
    for (const row of status.census) if (row.status === 'not-started') { row.status = 'blocked'; row.reason = 'Supervisor admission or persistence failed'; }
    throw error;
  } finally { status.finishedAt = new Date().toISOString(); await persist(); }
  process.exitCode = status.status === 'finished' ? 0 : 2; return status;
}
if (process.argv[1] && resolve(process.argv[1]) === SELF) {
  try { await main(); } catch (error) { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 2; }
}
