#!/usr/bin/env node
/** Exactly one declared case. The separate supervisor owns ordered progression. */
import { openSync, writeSync, fsyncSync, closeSync, renameSync, mkdirSync } from 'node:fs';
import { readFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { cpus, loadavg } from 'node:os';
import { resourceSources } from './measure-reusable-prediction.mjs';
import { readValidationPreflight, validationExecutionSources, VALIDATION_PREFLIGHT } from './lib/reusable-validation-preflight.mjs';
import { parseValidationArguments, createValidationResourceGuard, finalizeValidationReport } from './lib/reusable-validation-guards.mjs';
import { VALIDATION_CENSUS } from './lib/reusable-validation-evidence.mjs';
import { runValidationCase } from './lib/reusable-validation-producer.mjs';
const SELF = fileURLToPath(import.meta.url), ROOT = resolve(dirname(SELF), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const idOf = row => row.id || row.runId;
const errorRecord = error => ({ code: error?.code ?? null, message: String(error?.message || error), stack: error?.stack ?? null });
function writeOwned(path, text, exclusive = true) {
  const fd = openSync(path, exclusive ? 'wx' : 'w', 0o600);
  try { writeSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
}
async function readPinned(row, base, { parse = true } = {}) {
  if (!row || typeof row.path !== 'string' || !/^[a-f0-9]{64}$/.test(row.sha256 || '')) throw new Error('Missing input file proof');
  const path = resolve(base, row.path), bytes = await readFile(path);
  if (hash(bytes) !== row.sha256) throw new Error(`Input file changed: ${path}`);
  return { path, sha256: row.sha256, value: parse ? JSON.parse(bytes) : null };
}
export function mergeValidationArtifacts(target, delta) {
  if (!delta || typeof delta !== 'object' || Array.isArray(delta)) throw new Error('Invalid shared artifact delta');
  for (const [key, value] of Object.entries(delta)) {
    if (['__proto__', 'constructor', 'prototype', 'predecessors', 'retainedBindings'].includes(key)) throw new Error('Reserved shared artifact field');
    if (['schedules', 'controls'].includes(key)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid run-keyed artifact map');
      target[key] ??= {};
      for (const [name, entry] of Object.entries(value)) {
        if (!/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(name) || ['constructor', 'prototype'].includes(name)) throw new Error('Invalid run-keyed artifact name');
        if (Object.hasOwn(target[key], name) && !same(target[key][name], entry)) throw new Error('Conflicting run-keyed artifact');
        target[key][name] = structuredClone(entry);
      }
    } else if (key === 'blobs') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid content-addressed blob map');
      target.blobs ??= {};
      for (const [sha, text] of Object.entries(value)) {
        if (!/^[a-f0-9]{64}$/.test(sha) || typeof text !== 'string' || hash(text) !== sha) throw new Error('Invalid content-addressed blob');
        if (Object.hasOwn(target.blobs, sha) && target.blobs[sha] !== text) throw new Error('Conflicting content-addressed blob');
        target.blobs[sha] = text;
      }
    } else if (['checkpoints', 'models'].includes(key)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid artifact map');
      target[key] ??= {};
      for (const [name, entry] of Object.entries(value)) {
        if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)) throw new Error('Invalid shared artifact name');
        if (Object.hasOwn(target[key], name) && !same(target[key][name], entry)) throw new Error(`Conflicting shared artifact: ${key}.${name}`);
        if (!entry || !/^[a-f0-9]{64}$/.test(entry.sha256 || '')) throw new Error('Unhashed shared artifact');
        const bytes = key === 'checkpoints' ? entry.text : JSON.stringify(entry.value);
        if (typeof bytes !== 'string' || hash(bytes) !== entry.sha256) throw new Error('Shared artifact contents differ from hash');
        target[key][name] = structuredClone(entry);
      }
    } else {
      if (Object.hasOwn(target, key) && !same(target[key], value)) throw new Error(`Conflicting shared metadata: ${key}`);
      target[key] = structuredClone(value);
    }
  }
  return target;
}
/** Durable content is written before any reference can reach the trace. */
export function createValidationBlobWriter(output, { prior = {}, write = writeOwned } = {}) {
  const directory = resolve(output, 'blobs'); mkdirSync(directory, { recursive: false });
  const files = {}, known = new Set(Object.keys(prior)); let bytes = 0;
  const put = ({ sha256, text, bytes: declaredBytes }) => {
    const size = typeof text === 'string' ? Buffer.byteLength(text) : -1;
    if (!/^[a-f0-9]{64}$/.test(sha256 || '') || size < 0 || hash(text) !== sha256 ||
        declaredBytes !== undefined && declaredBytes !== size) throw new Error('Invalid incremental evidence blob');
    if (known.has(sha256)) return files[sha256] || null;
    const path = `blobs/${sha256}.json`; write(resolve(output, path), text);
    files[sha256] = { path, sha256, bytes: size }; bytes += size; known.add(sha256);
    return files[sha256];
  };
  return { put, files, get bytes() { return bytes; }, get count() { return Object.keys(files).length; } };
}
/** In-memory producer API remains unchanged; disk transport stores each body once. */
export function packValidationArtifacts(delta, writer) {
  mergeValidationArtifacts({}, delta);
  const packed = { ...delta, transport: 'sha256-files-v1', blobs: {} };
  for (const [sha256, text] of Object.entries(delta.blobs || {})) {
    writer.put({ sha256, text });
    if (writer.files[sha256]) packed.blobs[sha256] = writer.files[sha256];
  }
  for (const kind of ['checkpoints', 'models']) {
    packed[kind] = {};
    for (const [name, value] of Object.entries(delta[kind] || {})) {
      const text = kind === 'checkpoints' ? value.text : JSON.stringify(value.value);
      writer.put({ sha256: value.sha256, text });
      if (writer.files[value.sha256]) packed.blobs[value.sha256] = writer.files[value.sha256];
      const { text: omittedText, value: omittedValue, ...metadata } = value;
      packed[kind][name] = { ...metadata, encoding: kind === 'checkpoints' ? 'utf8' : 'json' };
    }
  }
  return packed;
}
export async function unpackValidationArtifacts(packed, base, prior = {}) {
  if (packed?.transport !== 'sha256-files-v1') throw new Error('Missing deduplicated artifact transport');
  const { transport, ...delta } = packed; delta.blobs = {};
  for (const [sha256, proof] of Object.entries(packed.blobs || {})) {
    if (proof.sha256 !== sha256 || proof.path !== `blobs/${sha256}.json`) throw new Error('Invalid evidence blob reference');
    const bytes = await readFile(resolve(base, proof.path));
    if (hash(bytes) !== sha256 || bytes.length !== proof.bytes) throw new Error('Evidence blob bytes differ');
    delta.blobs[sha256] = bytes.toString('utf8');
  }
  for (const kind of ['checkpoints', 'models']) {
    delta[kind] = {};
    for (const [name, entry] of Object.entries(packed[kind] || {})) {
      const text = delta.blobs[entry.sha256] ?? prior[entry.sha256];
      if (typeof text !== 'string' || hash(text) !== entry.sha256 || entry.encoding !== (kind === 'checkpoints' ? 'utf8' : 'json'))
        throw new Error('Missing canonical artifact body');
      const { encoding, ...metadata } = entry;
      delta[kind][name] = { ...metadata, ...(kind === 'checkpoints' ? { text } : { value: JSON.parse(text) }) };
    }
  }
  mergeValidationArtifacts({}, delta); return delta;
}
/** Each prerequisite is a complete, same-source successful child, never a guess. */
export async function readValidationInputs(path, runId, admitted, { census = VALIDATION_CENSUS } = {}) {
  const bytes = await readFile(path), raw = JSON.parse(bytes), index = census.findIndex(r => idOf(r) === runId);
  if (index < 0 || raw.version !== 1 || raw.protocol !== VALIDATION_PREFLIGHT.protocol || raw.runId !== runId ||
      raw.preflightSha256 !== admitted.sha256 || !Array.isArray(raw.predecessors) || raw.predecessors.length !== index)
    throw new Error('Input manifest is not the complete ordered prerequisite prefix');
  const artifacts = { predecessors: {}, retainedBindings: structuredClone(admitted.retainedBindings) }, proofs = [];
  for (let i = 0; i < index; i++) {
    const row = raw.predecessors[i], expected = idOf(census[i]);
    if (row.runId !== expected) throw new Error('Prerequisite order differs');
    const report = await readPinned(row.report, dirname(path)), r = report.value;
    if (r.runId !== expected || r.status !== 'passed' || r.resourceCensored !== false || !r.finishedAt ||
        r.preflight?.sha256 !== admitted.sha256 || !same(r.sourcesAfter, admitted.sources) || !same(r.executionSourcesAfter, admitted.executionSources) ||
        r.terminal !== false || r.continuingAllowed !== false || !r.stop?.available)
      throw new Error(`Prerequisite ${expected} is not a complete exact-source pass`);
    await readPinned(r.stop, dirname(report.path), { parse: false });
    await readPinned(r.trace, dirname(report.path), { parse: false });
    const exported = await readPinned(row.exports, dirname(path));
    if (r.exports?.sha256 !== exported.sha256) throw new Error('Report/export proof differs');
    mergeValidationArtifacts(artifacts, await unpackValidationArtifacts(exported.value, dirname(exported.path), artifacts.blobs));
    artifacts.predecessors[expected] = { status: 'passed', evidence: r.evidence };
    proofs.push({ runId: expected, report: { path: report.path, sha256: report.sha256 }, exports: { path: exported.path, sha256: exported.sha256 } });
  }
  return { artifacts, proof: { path: resolve(path), sha256: hash(bytes), predecessors: proofs } };
}
export async function runValidationEvaluation(options, { now = () => performance.now(), runCase = runValidationCase } = {}) {
  const start = now(), elapsed = () => (now() - start) / 1000;
  const admitted = await readValidationPreflight(options.preflight, { root: ROOT });
  const runId = options['run-id'];
  const inputs = await readValidationInputs(options.inputs, runId, admitted);
  await mkdir(options.output, { recursive: false });
  const reportPath = resolve(options.output, 'report.json'), tracePath = resolve(options.output, 'trace.jsonl');
  const trace = openSync(tracePath, 'wx', 0o600); let traceOrder = 0, traceBytes = 0, result = null;
  const blobWriter = createValidationBlobWriter(options.output, { prior: inputs.artifacts.blobs });
  const report = { version: 1, kind: 'scripted-prediction-validation-case', protocol: VALIDATION_PREFLIGHT.protocol,
    runId, startedAt: new Date().toISOString(), status: 'running', preflight: admitted, inputs: inputs.proof,
    autonomy: false, mainPromotion: false, continuingAllowed: false, originalResourceAdmissionPassed: false, terminal: false,
    resourceCensored: false, ownerEvidence: { inputSerializedBytes: Buffer.byteLength(JSON.stringify(inputs.artifacts)),
      memoryScope: 'Process-wide sampled heap/RSS, not isolated incremental owner allocation',
      startMemory: process.memoryUsage(), memorySamples: [] }, hardware: { node: process.version, cpu: cpus()[0]?.model, logicalCpus: cpus().length, loadAtStart: loadavg() } };
  const persist = () => { const temp = `${reportPath}.next`; writeOwned(temp, `${JSON.stringify(report, null, 2)}\n`, false); renameSync(temp, reportPath); };
  const sink = row => { const text = `${JSON.stringify({ traceOrder: ++traceOrder, ...row })}\n`; writeSync(trace, text); traceBytes += Buffer.byteLength(text); };
  const blob = value => { const proof = blobWriter.put(value); if (proof) { sink({ type: 'durable-blob', ...proof }); fsyncSync(trace); } };
  const ownerSample = () => { const value = { at: guard.fixture?.npc.elapsed ?? null, memory: process.memoryUsage(),
    newBlobBytes: blobWriter.bytes, newBlobCount: blobWriter.count, traceBytes }; report.ownerEvidence.memorySamples.push(value); return value; };
  const guard = createValidationResourceGuard({ sourceFingerprint: admitted.sources.runtimeSource, now, startedAt: start,
    onSample: row => { sink({ type: 'resource-snapshot', ...row, ownerEvidence: ownerSample() }); fsyncSync(trace); persist(); } });
  report.resources = guard.state;
  try {
    persist(); guard.checkWall();
    result = await runCase({ runId, sourceFingerprint: admitted.sources.runtimeSource, artifacts: inputs.artifacts,
      hooks: { boundary: guard.boundary, sink, blob }, now });
    if (!result || !['passed', 'failed', 'unavailable', 'censored', 'blocked'].includes(result.status)) throw new Error('Producer omitted an explicit result status');
    report.status = result.status; report.reasons = result.reasons; report.evidence = result.evidence;
    report.resourceCensored = result.status === 'censored';
    {
      const delta = packValidationArtifacts(result.artifacts || {}, blobWriter);
      const contents = `${JSON.stringify(delta)}\n`, path = resolve(options.output, 'exports.json'); writeOwned(path, contents);
      report.exports = { path: 'exports.json', bytes: Buffer.byteLength(contents), sha256: hash(contents) };
    }
  } catch (error) {
    report.error = errorRecord(error); report.status = error.code === 'VALIDATION_UNAVAILABLE' ? 'unavailable' :
      error.code === 'VALIDATION_RESOURCE_CEILING' ? 'censored' : 'failed';
  } finally {
    const fixture = guard.fixture;
    if (fixture) {
      try {
        guard.measure('stop');
        const text = fixture.checkpoint({ sourceFingerprint: admitted.sources.runtimeSource });
        writeOwned(resolve(options.output, 'stop.json'), text);
        report.stop = { available: true, path: 'stop.json', bytes: Buffer.byteLength(text), sha256: hash(text), at: fixture.npc.elapsed, terminal: false };
      } catch (error) { report.stop = { available: false, error: errorRecord(error) }; report.status = guard.state.resourceCensored ? 'censored' : 'failed'; }
      try { fixture.dispose(); } catch (error) { report.disposalError = errorRecord(error); report.status = 'failed'; }
    } else report.stop = { available: false, reason: 'No physical fixture was constructed' };
    try {
      [report.sourcesAfter, report.executionSourcesAfter] = await Promise.all([resourceSources(ROOT), validationExecutionSources(ROOT)]);
      if (!same(report.sourcesAfter, admitted.sources) || !same(report.executionSourcesAfter, admitted.executionSources)) throw new Error('Frozen sources changed during the case');
    } catch (error) { report.sourceError = errorRecord(error); report.status = 'failed'; }
    report.resourceCensored ||= guard.state.resourceCensored;
    if (report.resourceCensored) report.status = 'censored';
    report.ownerEvidence.final = ownerSample();
    report.finishedAt = new Date().toISOString(); report.hardware.loadAtEnd = loadavg();
    sink({ type: 'stop', status: report.status, at: fixture?.npc.elapsed ?? null, terminal: false, biologicalFollowupMayContinue: true });
    fsyncSync(trace); closeSync(trace);
    const bytes = await readFile(tracePath); report.trace = { path: 'trace.jsonl', sha256: hash(bytes), bytes: bytes.length, rows: traceOrder };
    finalizeValidationReport(report, { elapsedSeconds: elapsed, persist });
  }
  return report;
}
if (process.argv[1] && resolve(process.argv[1]) === SELF) {
  try {
    const options = parseValidationArguments(process.argv.slice(2), { child: true });
    const report = await runValidationEvaluation(options);
    process.stdout.write(`${JSON.stringify({ runId: report.runId, status: report.status, wallSeconds: report.wallSeconds, resourceCensored: report.resourceCensored })}\n`);
    if (report.status !== 'passed') process.exitCode = 2;
  } catch (error) { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 2; }
}
