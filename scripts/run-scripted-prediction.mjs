#!/usr/bin/env node
/** One owned-child run of the separately admitted fixed Gate 1 script. No game
 * construction, generic executable, retry, or evidence reconstruction here. */
import { spawn } from 'node:child_process';
import { access, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { armChildStop, guardChildSetup, WATCHDOG, parseWatchdogOptions } from './run-finite-headless.mjs';
import { readScriptedPredictionPreflight, scriptedPredictionExecutionSources, SCRIPTED_PREDICTION_PREFLIGHT } from './lib/scripted-prediction-preflight.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EVALUATOR = resolve(ROOT, 'scripts/evaluate-reusable-prediction.mjs');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const SCRIPTED_PREDICTION_SCHEDULE = Object.freeze([Object.freeze({
  id: 'scripted-prediction-use-v1-gate1-seed74193', gate: 'gate1-only', seed: 74193,
})]);
export const parseScriptedPredictionOptions = parseWatchdogOptions;

/** Absolute startup + execution deadline. No report/arm observation can reset it. */
export function scriptedPredictionWatchdogState(at) {
  if (!Number.isFinite(at) || at < 0) throw new TypeError('Invalid monotonic elapsed time');
  return { beganAt: 0, lastAt: at, deadlineAt: WATCHDOG.armOrStartupMs,
    expired: at >= WATCHDOG.armOrStartupMs, reason: 'absolute startup-plus-script deadline' };
}
async function preservedFile(path) {
  try { const bytes = await readFile(path); return { path, available: true, bytes: bytes.length, sha256: hash(bytes) }; }
  catch (error) { return { path, available: false, error: error.code || String(error.message).slice(0, 180) }; }
}
export async function preservedScriptedPredictionCensus(output, { processCensored = false } = {}) {
  const reportPath = resolve(output, 'report.json'), reportFile = await preservedFile(reportPath);
  let report = null;
  if (reportFile.available) {
    try { report = JSON.parse(await readFile(reportPath, 'utf8')); }
    catch (error) { reportFile.parseError = String(error.message).slice(0, 180); }
  }
  const trace = await preservedFile(resolve(output, 'trace.jsonl')), stopState = await preservedFile(resolve(output, 'stop.json'));
  const attempted = Boolean(report?.startedAt || trace.available || stopState.available);
  const complete = Boolean(!processCensored && report?.resourceCensored !== true && report?.finishedAt && report?.gate &&
    ['passed', 'failed', 'unavailable'].includes(report.status) && stopState.available);
  return { report: reportFile, scheduled: SCRIPTED_PREDICTION_SCHEDULE.map(job => ({ ...job,
    rawStatus: report?.status ?? null, resourceCensored: report?.resourceCensored ?? null, processCensored,
    classification: complete ? 'completed' : attempted ? 'censored' : 'blocked',
    trace, stopState, finalStateAvailable: stopState.available })), metricsReconstructed: false, finalStateReconstructed: false };
}

export async function main(argv = process.argv.slice(2)) {
  const start = performance.now(), elapsed = () => performance.now() - start;
  const options = parseScriptedPredictionOptions(argv), statusPath = `${options.output}.supervisor.json`;
  const status = { schemaVersion: 1, kind: 'scripted-prediction-process-supervisor',
    protocol: SCRIPTED_PREDICTION_PREFLIGHT.protocol, startedAt: new Date().toISOString(),
    limits: { totalStartupAndRunMs: WATCHDOG.armOrStartupMs, graceMs: WATCHDOG.graceMs, pollMs: WATCHDOG.pollMs },
    executionSources: await scriptedPredictionExecutionSources(ROOT), options, child: null, status: 'starting',
    scheduled: SCRIPTED_PREDICTION_SCHEDULE.map(job => ({ ...job, classification: 'blocked', finalStateAvailable: false,
      stopState: { path: resolve(options.output, 'stop.json'), available: false, reason: 'No child started; no stop evidence belongs to this attempt' } })),
    trigger: null, retries: 0, continuation: false, finalStateReconstructed: false };
  // The sidecar and evaluator directory must both be new. Never edit child files.
  await writeFile(statusPath, `${JSON.stringify(status, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  let writes = Promise.resolve();
  const persist = () => {
    const bytes = `${JSON.stringify(status, null, 2)}\n`, pending = `${statusPath}.${process.pid}.next`;
    const write = async () => { await writeFile(pending, bytes, { flag: 'wx', mode: 0o600 }); await rename(pending, statusPath); };
    writes = writes.then(write, write); return writes;
  };
  try {
    try { await access(options.output); throw new Error('Output directory already exists'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const admitted = await readScriptedPredictionPreflight(options.preflight, { evaluatorPath: EVALUATOR, root: ROOT });
    status.preflight = { path: admitted.path, sha256: admitted.sha256, runtimeSource: admitted.sources.runtimeSource,
      evaluatorSha256: admitted.evaluatorSha256, originalFailure: admitted.originalFailure, scriptedAdmission: admitted.scriptedAdmission };
    if (scriptedPredictionWatchdogState(elapsed()).expired) throw new Error('Absolute deadline expired during preflight; child not started');
  } catch (error) {
    status.status = 'blocked'; status.error = String(error.message); status.finishedAt = new Date().toISOString();
    status.wallMs = elapsed(); await persist(); throw error;
  }

  const child = spawn(process.execPath, [EVALUATOR, '--protocol', SCRIPTED_PREDICTION_PREFLIGHT.protocol,
    '--preflight', options.preflight, '--output', options.output], { cwd: ROOT, stdio: 'inherit' });
  let childError = null, finished = false, polling = false, grace = null;
  const closed = new Promise(resolve => {
    child.once('error', error => { childError = String(error.message); });
    child.once('close', (code, signal) => { finished = true; resolve({ code, signal, ...(childError ? { error: childError } : {}) }); });
  });
  status.child = { pid: child.pid ?? null }; status.status = 'running';
  const trigger = async reason => {
    if (status.trigger || finished) return;
    status.trigger = { reason, monotonicMs: elapsed(), signal: 'SIGTERM' };
    const stopping = armChildStop(child, () => finished, persist, {
      onHardKill: () => { status.trigger.hardKill = true; status.trigger.hardKillAtMs = elapsed(); },
      onWriteError: error => { status.persistenceError = String(error.message).slice(0, 240);
        process.stderr.write(`Scripted supervisor persistence failed: ${status.persistenceError}\n`); },
    });
    grace = stopping.timer; await stopping.recorded;
  };
  const stop = reason => { trigger(reason).catch(() => child.kill('SIGKILL')); };
  // Independent of any awaited sidecar write: an unresolved/failed write cannot
  // extend the child deadline or disable the helper's hard-kill escalation.
  const deadline = setTimeout(() => stop('absolute startup-plus-script deadline'), Math.max(0, WATCHDOG.armOrStartupMs - elapsed()));
  const external = () => stop('supervisor interrupted');
  process.once('SIGINT', external); process.once('SIGTERM', external);
  const timer = setInterval(async () => {
    if (finished || status.trigger || polling) return;
    polling = true;
    try { status.wallMs = elapsed(); await persist(); }
    catch (error) { await trigger(`periodic persistence failed: ${String(error.message).slice(0, 180)}`); }
    finally { polling = false; }
  }, WATCHDOG.pollMs);
  let setupError = null;
  try { await guardChildSetup(child, closed, persist); }
  catch (error) { setupError = error; status.setupError = String(error.message).slice(0, 240); }
  const outcome = await closed;
  clearTimeout(deadline); clearInterval(timer); if (grace) clearTimeout(grace);
  process.removeListener('SIGINT', external); process.removeListener('SIGTERM', external);
  while (polling) await new Promise(resolve => setTimeout(resolve, 10));
  status.status = status.trigger ? 'censored-process' : outcome.code === 0 ? 'finished' : 'failed';
  status.outcome = outcome; status.finishedAt = new Date().toISOString(); status.wallMs = elapsed();
  status.preserved = await preservedScriptedPredictionCensus(options.output, { processCensored: Boolean(status.trigger) });
  status.scheduled = status.preserved.scheduled;
  await persist();
  if (setupError) throw setupError;
  process.exitCode = status.trigger ? 3 : outcome.code ?? 1;
  return status;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(); }
  catch (error) { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 2; }
}
