import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { SCRIPTED_PREDICTION_PREFLIGHT, checkScriptedPredictionPreflightShape,
  requireOriginalPredictionManifest, readScriptedPredictionPreflight, scriptedPredictionExecutionSources } from '../scripts/lib/scripted-prediction-preflight.mjs';
import { resourceSources } from '../scripts/measure-reusable-prediction.mjs';
import { WATCHDOG, armChildStop, guardChildSetup } from '../scripts/run-finite-headless.mjs';
import { SCRIPTED_PREDICTION_SCHEDULE, parseScriptedPredictionOptions, scriptedPredictionWatchdogState,
  preservedScriptedPredictionCensus, main } from '../scripts/run-scripted-prediction.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sha = letter => letter.repeat(64);
const sources = { runtimeSource: sha('a'), files: [{ path: 'src/unchanged.js', sha256: sha('b') }] };
const evaluatorSha256 = sha('c');
const executionSources = { supervisorSha256: sha('d'),
  watchdogHelperSha256: SCRIPTED_PREDICTION_PREFLIGHT.originalWatchdogHelperSha256,
  protocolTestsSha256: sha('f'), evaluatorTestsSha256: sha('e') };
function valid() {
  return { version: 1, kind: SCRIPTED_PREDICTION_PREFLIGHT.kind, protocol: SCRIPTED_PREDICTION_PREFLIGHT.protocol,
    scope: 'scripted-prediction-only', gate: 'gate1-only', maximumRuns: 1,
    autonomy: false, mainPromotion: false, readiness: false, continuation: false, retry: false,
    sources, evaluatorSha256, executionSources,
    correctness: SCRIPTED_PREDICTION_PREFLIGHT.requiredChecks.map(name => ({ name, passed: true })),
    review: { status: 'cleared', runtimeSource: sources.runtimeSource, evaluatorSha256, executionSources },
    originalFailure: { path: 'original-negative.json', sha256: SCRIPTED_PREDICTION_PREFLIGHT.originalReportSha256 } };
}

test('separate protocol requires one fixed script and exact source/review/test declarations', () => {
  assert.equal(checkScriptedPredictionPreflightShape(valid(), sources, evaluatorSha256, executionSources), true);
  for (const mutate of [v => { v.version++; }, v => { v.kind = 'reusable-prediction-preflight'; },
    v => { v.protocol = 'reusable-outcome-increment-a'; }, v => { v.scope = 'autonomous'; },
    v => { v.gate = 'gate2'; }, v => { v.maximumRuns = 2; },
    ...['autonomy', 'mainPromotion', 'readiness', 'continuation', 'retry'].map(key => v => { v[key] = true; }),
    v => { delete v.retry; }, v => { v.sources = {}; }, v => { v.evaluatorSha256 = sha('0'); },
    v => { v.executionSources.supervisorSha256 = sha('0'); }, v => { v.executionSources.watchdogHelperSha256 = sha('0'); },
    v => { v.executionSources.protocolTestsSha256 = sha('0'); }, v => { v.executionSources.evaluatorTestsSha256 = sha('0'); },
    v => { v.correctness.pop(); },
    v => { v.correctness[0].passed = false; }, v => { v.correctness[1].name = v.correctness[0].name; },
    v => { v.review.status = 'pending'; }, v => { v.review.runtimeSource = sha('0'); },
    v => { v.review.evaluatorSha256 = sha('0'); }, v => { v.review.executionSources = {}; },
    v => { v.originalFailure.sha256 = sha('0'); }, v => { delete v.originalFailure; }]) {
    const raw = structuredClone(valid()); mutate(raw);
    assert.throws(() => checkScriptedPredictionPreflightShape(raw, sources, evaluatorSha256, executionSources));
  }
});

test('all original manifest bytes must survive; additive files alone are allowed', () => {
  const current = structuredClone(sources); current.files.push({ path: 'scripts/lib/new.mjs', sha256: sha('c') });
  assert.equal(requireOriginalPredictionManifest(sources, current), true);
  for (const mutate of [v => { v.files.shift(); }, v => { v.files[0].sha256 = sha('0'); },
    v => { v.files.push(v.files[0]); }, v => { v.files[0].path = '../src/unchanged.js'; },
    v => { v.files[0].path = '/absolute'; }, v => { v.files[0].sha256 = 'invalid'; },
    v => { delete v.files; }]) {
    const next = structuredClone(current); mutate(next);
    assert.throws(() => requireOriginalPredictionManifest(sources, next));
  }
});

test('original strict validator and original watchdog helper remain byte-identical', async () => {
  for (const [path, sha256] of [
    ['scripts/lib/reusable-prediction-preflight.mjs', 'c8f91b65239bcd8538efa5b76df7f17f5f07a5f80224fce9e20ca42c1b92818b'],
    ['scripts/measure-reusable-prediction.mjs', '403ddd2a4c9a7c881f14fcf33ba8d5314f1cdb221fc690148661271ef9730197'],
    ['scripts/run-finite-headless.mjs', 'd893107b26ccd40bfd2bf62409ffdc8a4097a4935b3daef5fd4489d47f913e1f'],
  ]) assert.equal(hash(await readFile(resolve(ROOT, path))), sha256, path);
});

test('preflight binds outer supervisor, original helper and protocol tests independently', async () => {
  const result = await scriptedPredictionExecutionSources(ROOT);
  assert.deepEqual(result, {
    supervisorSha256: hash(await readFile(resolve(ROOT, 'scripts/run-scripted-prediction.mjs'))),
    watchdogHelperSha256: hash(await readFile(resolve(ROOT, 'scripts/run-finite-headless.mjs'))),
    protocolTestsSha256: hash(await readFile(resolve(ROOT, 'tests/scripted-prediction-protocol.test.mjs'))),
    evaluatorTestsSha256: hash(await readFile(resolve(ROOT, 'tests/scripted-prediction-evaluator.test.mjs'))),
  });
});

test('missing, changed correctness/review or unpinned negative evidence fails read-only admission', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'scripted-preflight-'));
  try {
    const evaluatorPath = resolve(ROOT, 'scripts/evaluate-reusable-prediction.mjs'), preflight = join(dir, 'preflight.json');
    const raw = valid(); raw.sources = await resourceSources(ROOT);
    raw.evaluatorSha256 = hash(await readFile(evaluatorPath)); raw.executionSources = await scriptedPredictionExecutionSources(ROOT);
    await writeFile(join(dir, 'checks.log'), 'pure checks only\n');
    const evidence = { path: 'checks.log', sha256: hash('pure checks only\n') };
    raw.correctness = raw.correctness.map(row => ({ ...row, evidence }));
    raw.review = { status: 'cleared', runtimeSource: raw.sources.runtimeSource, evaluatorSha256: raw.evaluatorSha256,
      executionSources: raw.executionSources, evidence };
    await writeFile(preflight, JSON.stringify(raw));
    await assert.rejects(readScriptedPredictionPreflight(preflight, { evaluatorPath, root: ROOT }), /ENOENT/);
    await writeFile(join(dir, 'original-negative.json'), JSON.stringify({ gates: { passed: false } }));
    await assert.rejects(readScriptedPredictionPreflight(preflight, { evaluatorPath, root: ROOT }), /Artifact changed/);
    await writeFile(join(dir, 'checks.log'), 'changed\n');
    await assert.rejects(readScriptedPredictionPreflight(preflight, { evaluatorPath, root: ROOT }), /Artifact changed: checks.log/);
    await assert.rejects(access(join(dir, 'trace.jsonl')));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('supervisor has exactly one fixed job and no executable, argument, seed or deadline override', () => {
  assert.deepEqual(SCRIPTED_PREDICTION_SCHEDULE, [{ id: 'scripted-prediction-use-v1-gate1-seed74193', gate: 'gate1-only', seed: 74193 }]);
  assert.ok(parseScriptedPredictionOptions(['--preflight', 'p', '--output', 'o']).output.endsWith('/o'));
  for (const args of [[], ['--preflight', 'p'], ['--preflight', 'p', '--output', 'o', '--script', 'arbitrary'],
    ['--preflight', 'p', '--output', 'o', '--argv', 'anything'], ['--preflight', 'p', '--output', 'o', '--seed', '2'],
    ['--preflight', 'p', '--output', 'o', '--timeout', '999999'], ['--preflight', 'p', '--output', 'o', '--protocol', 'other'],
    ['--preflight', 'p', '--preflight', 'q', '--output', 'o']]) assert.throws(() => parseScriptedPredictionOptions(args));
});

test('watchdog has an absolute 315-second startup-plus-run deadline without report resets', () => {
  for (const elapsed of [0, 1, 1000, 250000, 314999]) {
    const state = scriptedPredictionWatchdogState(elapsed);
    assert.equal(state.beganAt, 0); assert.equal(state.deadlineAt, 315000); assert.equal(state.expired, false);
  }
  assert.equal(scriptedPredictionWatchdogState(315000).expired, true);
  assert.equal(scriptedPredictionWatchdogState(400000).expired, true);
  assert.equal(WATCHDOG.graceMs, 15000);
  for (const bad of [-1, NaN, Infinity, '0']) assert.throws(() => scriptedPredictionWatchdogState(bad));
});

test('reused stop helper preserves the default 15-second grace exactly', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const signals = [], child = { kill: signal => { signals.push(signal); } };
  const stopping = armChildStop(child, () => false, async () => {});
  await stopping.recorded;
  assert.deepEqual(signals, ['SIGTERM']); context.mock.timers.tick(14999);
  assert.deepEqual(signals, ['SIGTERM']); context.mock.timers.tick(1);
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
  clearTimeout(stopping.timer); context.mock.timers.reset();
});

test('invalid admission is blocked before child spawn and exclusive sidecar is never replaced', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'scripted-supervisor-blocked-'));
  try {
    const preflight = join(dir, 'invalid.json'), output = join(dir, 'untouched');
    await writeFile(preflight, JSON.stringify({ version: 99 }));
    await assert.rejects(main(['--preflight', preflight, '--output', output]), /Wrong protocol/);
    await assert.rejects(access(output));
    const path = `${output}.supervisor.json`, bytes = await readFile(path), report = JSON.parse(bytes);
    assert.equal(report.status, 'blocked'); assert.equal(report.child, null); assert.equal(report.retries, 0);
    assert.equal(report.scheduled.length, 1); assert.equal(report.scheduled[0].classification, 'blocked');
    assert.equal(report.scheduled[0].finalStateAvailable, false);
    await assert.rejects(main(['--preflight', preflight, '--output', output]), { code: 'EEXIST' });
    assert.deepEqual(await readFile(path), bytes);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a blocked new attempt cannot adopt or edit an existing output directory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'scripted-existing-output-'));
  try {
    const output = await mkdtemp(join(dir, 'old-')), preflight = join(dir, 'invalid.json');
    await writeFile(preflight, '{"version":99}');
    const prior = '{"startedAt":"before","finishedAt":"before","status":"passed","gate":{"passed":true}}';
    await writeFile(join(output, 'report.json'), prior); await writeFile(join(output, 'stop.json'), 'old stop');
    await assert.rejects(main(['--preflight', preflight, '--output', output]), /Output directory already exists/);
    const sidecar = JSON.parse(await readFile(`${output}.supervisor.json`, 'utf8'));
    assert.equal(sidecar.status, 'blocked'); assert.equal(sidecar.child, null);
    assert.equal(sidecar.scheduled[0].classification, 'blocked'); assert.equal(sidecar.scheduled[0].stopState.available, false);
    assert.equal(await readFile(join(output, 'report.json'), 'utf8'), prior);
    assert.equal(await readFile(join(output, 'stop.json'), 'utf8'), 'old stop');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('preserved one-job census distinguishes blocked, censored and completed without invented stop evidence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'scripted-census-'));
  try {
    let census = await preservedScriptedPredictionCensus(dir);
    assert.equal(census.scheduled.length, 1); assert.equal(census.scheduled[0].classification, 'blocked');
    assert.equal(census.scheduled[0].stopState.available, false);
    await writeFile(join(dir, 'trace.jsonl'), 'partial trace\n');
    await writeFile(join(dir, 'report.json'), JSON.stringify({ startedAt: 'now', status: 'running' }));
    census = await preservedScriptedPredictionCensus(dir);
    assert.equal(census.scheduled[0].classification, 'censored'); assert.equal(census.scheduled[0].finalStateAvailable, false);
    await writeFile(join(dir, 'report.json'), JSON.stringify({ startedAt: 'now', finishedAt: 'later', status: 'passed', gate: { passed: true } }));
    census = await preservedScriptedPredictionCensus(dir);
    assert.equal(census.scheduled[0].classification, 'censored');
    await writeFile(join(dir, 'stop.json'), '{"testOnly":true}\n');
    const before = await readFile(join(dir, 'stop.json'));
    census = await preservedScriptedPredictionCensus(dir);
    assert.equal(census.scheduled[0].classification, 'completed'); assert.equal(census.scheduled[0].stopState.sha256, hash(before));
    assert.equal(census.metricsReconstructed, false); assert.equal(census.finalStateReconstructed, false);
    assert.deepEqual(await readFile(join(dir, 'stop.json')), before);
    await writeFile(join(dir, 'report.json'), JSON.stringify({ startedAt: 'now', finishedAt: 'later', status: 'failed',
      gate: { passed: false }, resourceCensored: false }));
    census = await preservedScriptedPredictionCensus(dir);
    assert.equal(census.scheduled[0].classification, 'completed'); assert.equal(census.scheduled[0].rawStatus, 'failed');
    census = await preservedScriptedPredictionCensus(dir, { processCensored: true });
    assert.equal(census.scheduled[0].classification, 'censored');
    await writeFile(join(dir, 'report.json'), JSON.stringify({ startedAt: 'now', finishedAt: 'later', status: 'failed',
      gate: { passed: false }, resourceCensored: true }));
    census = await preservedScriptedPredictionCensus(dir);
    assert.equal(census.scheduled[0].classification, 'censored'); assert.equal(census.scheduled[0].resourceCensored, true);
    assert.equal(census.scheduled[0].rawStatus, 'failed'); assert.equal(census.scheduled[0].stopState.available, true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('reused setup guard kills only its owned child when sidecar setup fails', { timeout: 5000 }, async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  const closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  try {
    await assert.rejects(guardChildSetup(child, closed, async () => { throw new Error('injected setup write failure'); }), /setup write failure/);
    assert.equal((await closed).signal, 'SIGKILL'); assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
  } finally { child.kill('SIGKILL'); }
});

test('reused stop escalation survives later write failure and a SIGTERM-ignoring owned child', { timeout: 5000 }, async () => {
  const child = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000)"],
    { stdio: ['ignore', 'pipe', 'ignore'] });
  let finished = false, writeErrors = 0, stopping;
  const closed = new Promise(resolve => child.once('close', (code, signal) => { finished = true; resolve({ code, signal }); }));
  try {
    await once(child.stdout, 'data');
    stopping = armChildStop(child, () => finished, async () => { throw new Error('injected periodic write failure'); },
      { graceMs: 25, onWriteError: () => { writeErrors++; } });
    await stopping.recorded; assert.equal(writeErrors, 1); assert.equal((await closed).signal, 'SIGKILL');
    assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
  } finally { if (stopping) clearTimeout(stopping.timer); child.kill('SIGKILL'); }
});

test('unresolved persistence cannot prevent the owned-child kill timer', { timeout: 5000 }, async () => {
  const child = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000)"],
    { stdio: ['ignore', 'pipe', 'ignore'] });
  let finished = false, stopping;
  const closed = new Promise(resolve => child.once('close', (code, signal) => { finished = true; resolve({ code, signal }); }));
  try {
    await once(child.stdout, 'data');
    stopping = armChildStop(child, () => finished, () => new Promise(() => {}), { graceMs: 25 });
    assert.equal((await closed).signal, 'SIGKILL'); assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
  } finally { if (stopping) clearTimeout(stopping.timer); child.kill('SIGKILL'); }
});
