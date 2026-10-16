import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createValidationResourceGuard, parseValidationArguments, finalizeValidationReport } from '../scripts/lib/reusable-validation-guards.mjs';
import { checkValidationPreflightShape, VALIDATION_PREFLIGHT as P } from '../scripts/lib/reusable-validation-preflight.mjs';
import { runOwnedValidationChild, preservedValidationRun, validationSupervisorCaseStatus } from '../scripts/run-prediction-validation.mjs';
const hex = 'a'.repeat(64);
function admission() {
  const sources = { runtimeSource: hex }, executionSources = { sha256: hex, files: [{ path: 'scripts/run-finite-headless.mjs', sha256: P.watchdogSha256 }, { path: 'scripts/evaluate-reusable-prediction.mjs', sha256: P.originalEvaluatorSha256 }] };
  return { expected: { sources, executionSources, protocolSha256: P.protocolSha256 }, raw: {
    version: 1, kind: P.kind, protocol: P.protocol, protocolSha256: P.protocolSha256, sources, executionSources,
    scope: 'one-shot-scripted-validation-bundle', maximumRuns: 16, maximumActions: 50, autonomy: false,
    mainPromotion: false, readiness: false, retry: false, continuation: false,
    executionApproval: { status: 'approved-one-shot', protocolSha256: P.protocolSha256, runtimeSource: hex, executionSource: hex },
    correctness: P.requiredChecks.map(name => ({ name, passed: true })), review: { status: 'cleared', runtimeSource: hex, executionSource: hex },
    originalFailure: { sha256: P.originalReportSha256 }, originalGate1Report: { sha256: P.originalGate1ReportSha256 }, originalGate1Stop: { sha256: P.originalGate1StopSha256 },
  } };
}
test('validation admission requires distinct exact-source approval, failed artifacts and immutable scope', () => {
  const { raw, expected } = admission(); assert.equal(checkValidationPreflightShape(raw, expected), true);
  for (const change of [r => delete r.executionApproval, r => r.originalFailure.sha256 = hex,
    r => r.maximumRuns = 17, r => r.retry = true, r => r.review.runtimeSource = 'b'.repeat(64),
    r => r.correctness.pop(), r => r.protocolSha256 = hex, r => r.originalGate1Stop.sha256 = hex]) {
    const bad = structuredClone(raw); change(bad); assert.throws(() => checkValidationPreflightShape(bad, expected));
  }
});
test('CLI cannot select alternate protocol, retry, generic executable or duplicate option', () => {
  const good = parseValidationArguments(['--preflight', 'p', '--output', 'o']); assert.ok(good.preflight.endsWith('/p'));
  for (const args of [[], ['--preflight', 'p'], ['--preflight', 'p', '--output', 'o', '--retry', '1'],
    ['--preflight', 'p', '--output', 'o', '--output', 'x'], ['--exe', 'node', '--output', 'o']]) assert.throws(() => parseValidationArguments(args));
  assert.equal(parseValidationArguments(['--preflight', 'p', '--output', 'o', '--run-id', 'T0-common-apple', '--inputs', 'i'], { child: true })['run-id'], 'T0-common-apple');
});
const fake = () => ({ npc: { elapsed: 0 }, admission: { deniedSubmissions: 0, deniedBatches: 0 } });
test('resource guard includes whole returned segments, explicit decision work and final actor size', () => {
  let clock = 0, bytes = 100; const f = fake();
  const g = createValidationResourceGuard({ now: () => clock, startedAt: 0, measureActor: () => ({ actorBytes: bytes }) });
  g.boundary({ kind: 'setup-before' }, null); clock = 4000; g.boundary({ kind: 'setup-after' }, f);
  assert.equal(g.state.returnedSegments.checked, 0); clock = 4010; g.boundary({ kind: 'frame', returnedDecisionMs: 10 }, f);
  assert.equal(g.state.maximumReturnedDecisionMs, 10); assert.equal(g.state.returnedSegments.maxMs, 10);
  bytes = 1048577; assert.throws(() => g.measure('stop'), /1 MiB/); assert.equal(g.state.resourceCensored, true);
});
test('resource guard rejects time reversal, delayed return, capacity denial and wall deadline', () => {
  for (const mode of ['reverse', 'segment', 'decision', 'wall', 'capacity']) {
    let clock = 10; const f = fake(), g = createValidationResourceGuard({ now: () => clock, startedAt: 0, measureActor: () => ({ actorBytes: 10 }) });
    g.boundary({ kind: 'frame' }, f);
    if (mode === 'capacity') f.admission.deniedBatches = 1;
    clock = mode === 'reverse' ? 9 : mode === 'segment' ? 1011 : mode === 'wall' ? 300001 : 11;
    assert.throws(() => g.boundary({ kind: 'frame', ...(mode === 'decision' ? { returnedDecisionMs: 1001 } : {}) }, f));
  }
});
test('report finalization accounts for a deadline crossed during durable final write', () => {
  let at = 299, writes = 0; const report = { status: 'passed', resourceCensored: false };
  finalizeValidationReport(report, { elapsedSeconds: () => at, persist: () => { writes++; at = 301; } });
  assert.equal(report.status, 'censored'); assert.equal(report.resourceCensored, true); assert.equal(writes, 2);
});
async function childTest(fn) {
  let child;
  try { await fn(() => child = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], { stdio: 'ignore' })); }
  finally { if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
}
test('owned child cannot survive initial supervisor persistence failure', { timeout: 5000 }, async () => childTest(async spawnChild => {
  const result = await runOwnedValidationChild({ spawnChild, args: [], persist: async () => { throw new Error('initial disk failure'); },
    signals: new EventEmitter(), deadlineMs: 1000, graceMs: 30, pollMs: 100 });
  assert.equal(result.status, 'failed'); assert.match(result.setupError, /initial disk failure/); assert.ok(result.outcome.signal);
}));
test('later persistence failure keeps owned-child termination and escalation alive', { timeout: 5000 }, async () => childTest(async spawnChild => {
  let writes = 0;
  const result = await runOwnedValidationChild({ spawnChild, args: [], persist: async () => { if (++writes > 1) throw new Error('later disk failure'); },
    signals: new EventEmitter(), deadlineMs: 1500, graceMs: 40, pollMs: 120 });
  assert.ok(result.trigger); assert.match(result.trigger.reason, /persistence failed/); assert.ok(result.outcome.signal); assert.ok(result.persistenceError);
}));
test('absolute owned-case deadline cannot be extended by successful sidecar writes', { timeout: 5000 }, async () => childTest(async spawnChild => {
  const result = await runOwnedValidationChild({ spawnChild, args: [], persist: async () => {}, signals: new EventEmitter(),
    deadlineMs: 180, graceMs: 30, pollMs: 20 });
  assert.equal(result.status, 'censored-process'); assert.equal(result.trigger.reason, 'absolute owned-case deadline'); assert.equal(result.retries, 0);
}));
test('preserved census never turns missing stop evidence or resource censoring into completion', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'validation-census-'));
  try {
    assert.equal((await preservedValidationRun(dir)).classification, 'blocked');
    await writeFile(join(dir, 'report.json'), JSON.stringify({ status: 'passed', startedAt: 'x', finishedAt: 'y', resourceCensored: false }));
    assert.equal((await preservedValidationRun(dir)).classification, 'censored');
    await writeFile(join(dir, 'stop.json'), '{}');
    assert.equal((await preservedValidationRun(dir, { processCensored: true })).classification, 'censored');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('artifact transport hashes exact strings and rejects conflicts or fake IDs', async () => {
  const { mergeValidationArtifacts } = await import('../scripts/evaluate-prediction-validation.mjs');
  const { createHash } = await import('node:crypto'); const digest = x => createHash('sha256').update(x).digest('hex');
  const text = '{"checkpoint":"synthetic transport only"}', model = { version: 1, rows: [] }, blob = '{"public":"fixture"}';
  const target = {}; const delta = { checkpoints: { A0: { text, sha256: digest(text), lineage: ['T0-common-apple'] } },
    models: { MF: { value: model, sha256: digest(JSON.stringify(model)) } }, blobs: { [digest(blob)]: blob } };
  mergeValidationArtifacts(target, delta); mergeValidationArtifacts(target, delta); assert.deepEqual(target, delta);
  assert.throws(() => mergeValidationArtifacts(target, { checkpoints: { A0: { text: '{}', sha256: digest('{}') } } }), /Conflicting/);
  assert.throws(() => mergeValidationArtifacts({}, { blobs: { [hex]: blob } }), /Invalid/);
  assert.throws(() => mergeValidationArtifacts({}, JSON.parse('{"__proto__":{}}')), /Reserved/);
});
test('prerequisite transport requires full passed prefix and existing untampered trace/stop/export bytes', async () => {
  const { readValidationInputs } = await import('../scripts/evaluate-prediction-validation.mjs');
  const { createHash } = await import('node:crypto'); const digest = x => createHash('sha256').update(x).digest('hex');
  const dir = await mkdtemp(join(tmpdir(), 'validation-input-'));
  try {
    const sources = { runtimeSource: hex }, executionSources = { sha256: hex }, admitted = { sha256: hex, sources, executionSources,
      retainedBindings: { complete: true, objectIds: [], sourceHashes: [hex] } };
    const stop = '{}', trace = '{"type":"synthetic transport test"}\n', exported = '{"transport":"sha256-files-v1","blobs":{}}\n';
    const report = { runId: 'prior', status: 'passed', resourceCensored: false, finishedAt: 'x', preflight: { sha256: hex },
      sourcesAfter: sources, executionSourcesAfter: executionSources, terminal: false, continuingAllowed: false,
      stop: { available: true, path: 'stop.json', sha256: digest(stop) }, trace: { path: 'trace.jsonl', sha256: digest(trace) },
      exports: { sha256: digest(exported) }, evidence: { synthetic: true } };
    for (const [file, text] of [['stop.json', stop], ['trace.jsonl', trace], ['exports.json', exported]]) await writeFile(join(dir, file), text);
    const reportText = JSON.stringify(report); await writeFile(join(dir, 'report.json'), reportText);
    const input = { version: 1, protocol: P.protocol, runId: 'next', preflightSha256: hex,
      predecessors: [{ runId: 'prior', report: { path: 'report.json', sha256: digest(reportText) }, exports: { path: 'exports.json', sha256: digest(exported) } }] };
    const path = join(dir, 'input.json'); await writeFile(path, JSON.stringify(input));
    const census = [{ runId: 'prior' }, { runId: 'next' }];
    const value = await readValidationInputs(path, 'next', admitted, { census }); assert.equal(value.artifacts.predecessors.prior.status, 'passed');
    await writeFile(join(dir, 'trace.jsonl'), 'tampered');
    await assert.rejects(readValidationInputs(path, 'next', admitted, { census }), /changed/);
    input.predecessors = []; await writeFile(path, JSON.stringify(input));
    await assert.rejects(readValidationInputs(path, 'next', admitted, { census }), /complete ordered/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('supervisor census cannot label a censored or failed child passed from a stale raw result', () => {
  const raw = { passed: false, classification: 'censored', rawStatus: 'passed' };
  assert.equal(validationSupervisorCaseStatus({ status: 'censored-process', trigger: {} }, raw), 'censored');
  assert.equal(validationSupervisorCaseStatus({ status: 'failed' }, { ...raw, classification: 'completed' }), 'failed');
  assert.equal(validationSupervisorCaseStatus({ status: 'finished' }, { passed: true, classification: 'completed', rawStatus: 'passed' }), 'passed');
});

test('frame-after uses the 15-second cadence while explicit query/command boundaries sample', () => {
  const f = fake(), g = createValidationResourceGuard({ now: () => 0, measureActor: () => ({ actorBytes: 10 }) });
  g.boundary({ kind: 'setup-after' }, f);
  for (let i = 1; i <= 100; i++) { f.npc.elapsed = i / 60; g.boundary({ kind: 'frame-after' }, f); }
  assert.equal(g.state.samples.length, 1);
  f.npc.elapsed = 15; g.boundary({ kind: 'frame-after' }, f); assert.equal(g.state.samples.length, 2);
  g.boundary({ kind: 'query-after' }, f); g.boundary({ kind: 'command-after' }, f); assert.equal(g.state.samples.length, 4);
});
test('combined root plus forecasts cannot hide behind individually short pure queries', () => {
  const g = createValidationResourceGuard({ now: () => 0, measureActor: () => ({ actorBytes: 10 }) });
  g.boundary({ kind: 'query-after', returnedDecisionMs: 600 }, fake());
  assert.throws(() => g.boundary({ kind: 'combined-decision-after', returnedDecisionMs: 600, combinedDecisionMs: 1200 }, fake()), /Combined/);
  assert.equal(g.state.maximumCombinedDecisionMs, 1200);
});
test('run-keyed schedules and controls merge independently and reject conflicting rewrites', async () => {
  const { mergeValidationArtifacts } = await import('../scripts/evaluate-prediction-validation.mjs');
  const target = {};
  mergeValidationArtifacts(target, { schedules: { C1: [1] }, controls: { C1: { passed: true } } });
  mergeValidationArtifacts(target, { schedules: { C2: [2] }, controls: { C2: { passed: true } } });
  assert.deepEqual(Object.keys(target.schedules), ['C1', 'C2']);
  assert.throws(() => mergeValidationArtifacts(target, { schedules: { C1: [9] } }), /Conflicting/);
});
test('durable blob transport preserves failure-prefix bodies once and resolves inherited references', async () => {
  const { createValidationBlobWriter, packValidationArtifacts, unpackValidationArtifacts } = await import('../scripts/evaluate-prediction-validation.mjs');
  const { createHash } = await import('node:crypto'); const digest = x => createHash('sha256').update(x).digest('hex');
  const dir = await mkdtemp(join(tmpdir(), 'validation-blobs-'));
  try {
    const writer = createValidationBlobWriter(dir), text = '{"checkpoint":"synthetic only"}', sha256 = digest(text);
    writer.put({ sha256, text, bytes: Buffer.byteLength(text) });
    // A child killed before a returned result still leaves the exact referenced body.
    assert.equal(await readFile(join(dir, `blobs/${sha256}.json`), 'utf8'), text);
    const model = { version: 1, rows: [] }, modelText = JSON.stringify(model), modelSha = digest(modelText);
    const delta = { checkpoints: { A0: { text, sha256, lineage: [] } }, models: { MF: { value: model, sha256: modelSha } },
      blobs: { [sha256]: text, [modelSha]: modelText }, controls: { C1: { status: 'failed' } } };
    const packed = packValidationArtifacts(delta, writer);
    assert.equal(packed.checkpoints.A0.text, undefined); assert.equal(packed.models.MF.value, undefined);
    assert.equal((await readdir(join(dir, 'blobs'))).length, 2);
    assert.deepEqual(await unpackValidationArtifacts(packed, dir), delta);
    const inherited = { transport: 'sha256-files-v1', checkpoints: packed.checkpoints, models: {}, blobs: {} };
    assert.equal((await unpackValidationArtifacts(inherited, dir, delta.blobs)).checkpoints.A0.text, text);
    await writeFile(join(dir, `blobs/${sha256}.json`), 'bad');
    await assert.rejects(unpackValidationArtifacts(packed, dir), /differ/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('completed census requires valid trace and stop hash/byte proofs', async () => {
  const { createHash } = await import('node:crypto'); const digest = x => createHash('sha256').update(x).digest('hex');
  const dir = await mkdtemp(join(tmpdir(), 'validation-final-proof-'));
  try {
    const stop = '{}', trace = '{}\n', exp = '{"transport":"sha256-files-v1","blobs":{}}';
    const report = { protocol: P.protocol, startedAt: 'x', finishedAt: 'y', resourceCensored: false, status: 'passed',
      stop: { available: true, bytes: 2, sha256: digest(stop) }, trace: { bytes: 3, sha256: digest(trace) }, exports: { sha256: digest(exp) } };
    for (const [name, text] of [['stop.json', stop], ['trace.jsonl', trace], ['exports.json', exp]]) await writeFile(join(dir, name), text);
    const save = () => writeFile(join(dir, 'report.json'), JSON.stringify(report));
    await save(); assert.equal((await preservedValidationRun(dir)).passed, true);
    report.stop.sha256 = hex; await save(); assert.equal((await preservedValidationRun(dir)).classification, 'censored');
    report.stop.sha256 = digest(stop); report.trace.bytes = 99; await save(); assert.equal((await preservedValidationRun(dir)).classification, 'censored');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('last-case completion verifies the referenced raw blob bodies, not only export manifest hash', async () => {
  const { createHash } = await import('node:crypto'); const digest = x => createHash('sha256').update(x).digest('hex');
  const { createValidationBlobWriter } = await import('../scripts/evaluate-prediction-validation.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'validation-blob-final-'));
  try {
    const writer = createValidationBlobWriter(dir), text = '{"evidence":true}', sha256 = digest(text);
    writer.put({ sha256, text });
    const exp = JSON.stringify({ transport: 'sha256-files-v1', blobs: writer.files }), stop = '{}', trace = '{}\n';
    const report = { protocol: P.protocol, startedAt: 'x', finishedAt: 'y', resourceCensored: false, status: 'passed',
      stop: { available: true, bytes: 2, sha256: digest(stop) }, trace: { bytes: 3, sha256: digest(trace) }, exports: { sha256: digest(exp) } };
    for (const [name, value] of [['stop.json', stop], ['trace.jsonl', trace], ['exports.json', exp], ['report.json', JSON.stringify(report)]]) await writeFile(join(dir, name), value);
    assert.equal((await preservedValidationRun(dir)).passed, true);
    await writeFile(join(dir, writer.files[sha256].path), 'corrupt');
    const bad = await preservedValidationRun(dir); assert.equal(bad.passed, false); assert.equal(bad.classification, 'censored'); assert.equal(validationSupervisorCaseStatus({status: 'finished'}, bad), 'censored'); assert.match(bad.blobEvidence.error, /damaged/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('verified never-started physical cases remain blocked, without hiding damaged or attempted runs', async () => {
  const { createHash } = await import('node:crypto'); const digest = x => createHash('sha256').update(x).digest('hex');
  const dir = await mkdtemp(join(tmpdir(), 'validation-never-started-'));
  try {
    const trace = '{}\n', exp = '{"transport":"sha256-files-v1","blobs":{}}';
    const report = { protocol: P.protocol, startedAt: 'x', finishedAt: 'y', resourceCensored: false, status: 'blocked',
      evidence: {stop: {neverStarted: true}}, stop: {available: false}, trace: {bytes: 3, sha256: digest(trace)}, exports: {sha256: digest(exp)} };
    const save = () => writeFile(join(dir, 'report.json'), JSON.stringify(report));
    await writeFile(join(dir, 'trace.jsonl'), trace); await writeFile(join(dir, 'exports.json'), exp); await save();
    const valid = await preservedValidationRun(dir); assert.equal(valid.classification, 'blocked'); assert.equal(valid.verifiedNeverStarted, true);
    assert.equal(validationSupervisorCaseStatus({status: 'failed'}, valid), 'blocked');
    assert.equal((await preservedValidationRun(dir, {processCensored: true})).classification, 'censored');
    delete report.evidence.stop.neverStarted; await save(); assert.equal((await preservedValidationRun(dir)).classification, 'censored');
    report.evidence.stop.neverStarted = true; report.trace.sha256 = hex; await save(); assert.equal((await preservedValidationRun(dir)).classification, 'censored');
    report.trace.sha256 = digest(trace); await save(); await writeFile(join(dir, 'stop.json'), '{}');
    assert.equal((await preservedValidationRun(dir)).classification, 'censored');
  } finally { await rm(dir, {recursive: true, force: true}); }
});
