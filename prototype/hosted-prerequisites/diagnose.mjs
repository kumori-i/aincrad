/** Read-only prerequisite metadata. No subprocesses, installs or application imports. */
import fs from 'node:fs';
import { lstat, stat, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const REPO = 'kumori-i/aincrad', BRANCH = 'refs/heads/diagnostic/hosted-display-prerequisites';
export const BEFORE = '7451d71fc78505da38229e2c1e3ff8d139aed809';
export const TOOLS = Object.freeze(['Xvfb', 'xauth', 'xdpyinfo']);
export const PACKAGES = Object.freeze(['xvfb', 'xauth', 'x11-utils']);
export const LIMIT = Object.freeze({ deadlineMs: 15000, totalBytes: 335544320, status: 16777216, list: 1048576, event: 1048576, source: 262144, node: 268435456, report: 16384 });
const HERE = dirname(fileURLToPath(import.meta.url)), SOURCE = 'prototype/hosted-prerequisites', WORKFLOW = '.github/workflows/hosted-prerequisites.yml';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const requireThat = (ok, code = 'INVALID') => { if (!ok) { const e = new Error('diagnostic-boundary'); e.code = code; throw e; } };
const NAMES = Object.freeze(['Error', 'TypeError', 'RangeError', 'SyntaxError', 'AbortError']);
const CODES = Object.freeze(['ENOENT', 'EACCES', 'EPERM', 'EIO', 'ENOTDIR', 'ELOOP', 'EMFILE', 'ERR_INVALID_ARG_TYPE', 'ABORT_ERR', 'LIMIT', 'DEADLINE', 'INVALID', 'CHANGED']);
const OPS = Object.freeze(['admission', 'event', 'os', 'source', 'node', 'tool-lstat', 'tool-realpath', 'tool-stat', 'package-status', 'package-list', 'output']);
function property(value, name) { try { const v = value?.[name]; return typeof v === 'string' || v === undefined ? v : null; } catch { return null; } }
export function diagnostic(error, operation) {
  const name = property(error, 'name'), code = property(error, 'code');
  return { operation: OPS.includes(operation) ? operation : 'admission', name: NAMES.includes(name) ? name : 'OtherError', code: code === undefined ? 'NONE' : CODES.includes(code) ? code : 'OTHER' };
}
export function systemPath(path) {
  return typeof path === 'string' && path.length <= 256 && /^\/(?:usr\/(?:local\/)?(?:bin|sbin|lib|lib64|libexec)|bin|sbin|lib|lib64|opt\/hostedtoolcache\/node)\/[A-Za-z0-9._/+:-]+$/.test(path) && resolve(path) === path;
}
export function argumentsFor(args) {
  requireThat(args.length === 3 && args[0] === '--diagnose');
  const script = /^--expected-script=([a-f0-9]{64})$/.exec(args[1]), commit = /^--expected-commit=([a-f0-9]{40})$/.exec(args[2]);
  requireThat(script && commit); return { script: script[1], commit: commit[1] };
}
export function admit(env, host, commit, event) {
  requireThat(host.platform === 'linux' && host.arch === 'x64' && Number.isInteger(host.uid) && host.uid > 0 && /^v22\.(?:1[2-9]|[2-9][0-9])\.\d+$/.test(host.version));
  requireThat(env.GITHUB_ACTIONS === 'true' && env.GITHUB_REPOSITORY === REPO && env.GITHUB_REF === BRANCH && env.GITHUB_EVENT_NAME === 'push' && env.GITHUB_RUN_ATTEMPT === '1' && env.GITHUB_SHA === commit);
  requireThat(env.RUNNER_ENVIRONMENT === 'github-hosted' && env.RUNNER_OS === 'Linux' && env.RUNNER_ARCH === 'X64' && env.ImageOS === 'ubuntu22');
  requireThat(/^\d+$/.test(env.GITHUB_RUN_ID || '') && /^[A-Za-z0-9_.-]{1,100}$/.test(env.ImageVersion || ''));
  for (const name of ['NODE_OPTIONS', 'LD_PRELOAD', 'LD_LIBRARY_PATH']) requireThat(!env[name]);
  if (event !== undefined) requireThat(event?.before === BEFORE && event.after === commit && event.after !== event.before && event.ref === BRANCH && event.created === false && event.deleted === false && event.forced === false && event.repository?.full_name === REPO && event.repository.private === false);
}
export function budget({ signal, deadlineAt = Date.now() + LIMIT.deadlineMs, now = Date.now, maxBytes = LIMIT.totalBytes } = {}) {
  let bytes = 0;
  const check = () => { requireThat(!signal?.aborted && now() < deadlineAt, 'DEADLINE'); };
  return { signal, check, charge(n) { check(); bytes += n; requireThat(bytes <= maxBytes, 'LIMIT'); },
    async wait(promise) {
      let timer, abort;
      try {
        check(); const gate = new Promise((_, reject) => {
          const fail = () => { const e = new Error('deadline'); e.code = 'DEADLINE'; reject(e); };
          timer = setTimeout(fail, Math.max(1, deadlineAt - now()));
          if (signal) { abort = fail; signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) fail(); }
        });
        const value = await Promise.race([promise, gate]); check(); return value;
      } catch (error) { void Promise.resolve(promise).catch(() => {}); throw error; }
      finally { clearTimeout(timer); if (abort) signal.removeEventListener('abort', abort); }
    } };
}
export async function boundedRead(path, limit, b, retain = true) {
  b.check(); const before = await b.wait(lstat(path)); requireThat(before.isFile() && !before.isSymbolicLink() && before.size >= 0 && before.size <= limit, 'LIMIT');
  const same = entry => entry.isFile() && entry.size === before.size && entry.ino === before.ino && entry.dev === before.dev && entry.mtimeMs === before.mtimeMs;
  let file, closing = false;
  const opened = fs.promises.open(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW).then(async handle => {
    if (closing) { await handle.close(); requireThat(false, 'DEADLINE'); }
    file = handle; return handle;
  });
  const chunks = [], hash = createHash('sha256'), buffer = Buffer.alloc(Math.min(65536, before.size + 1)); let bytes = 0;
  try {
    await b.wait(opened); requireThat(same(await b.wait(file.stat())), 'CHANGED');
    for (;;) {
      const { bytesRead } = await b.wait(file.read(buffer, 0, Math.min(buffer.length, before.size + 1 - bytes), bytes));
      if (!bytesRead) break; bytes += bytesRead; requireThat(bytes <= limit && bytes <= before.size, 'LIMIT');
      b.charge(bytesRead); const part = buffer.subarray(0, bytesRead); hash.update(part); if (retain) chunks.push(Buffer.from(part));
    }
    requireThat(bytes === before.size && same(await b.wait(file.stat())) && same(await b.wait(lstat(path))), 'CHANGED');
    return { data: retain ? Buffer.concat(chunks) : null, bytes, sha256: hash.digest('hex') };
  } finally {
    closing = true;
    if (file) await b.wait(file.close());
  }
}
export function parseStatus(text) {
  requireThat(Buffer.byteLength(text) <= LIMIT.status, 'LIMIT'); const selected = new Map();
  const paragraphs = text.split('\n\n'); requireThat(paragraphs.length <= 30000, 'LIMIT');
  for (const stanza of paragraphs) {
    const names = [...stanza.matchAll(/^Package: ([^\n]+)$/gm)];
    if (!names.some(match => PACKAGES.includes(match[1]))) continue;
    const name = names[0][1];
    requireThat(names.length === 1 && !selected.has(name));
    const field = key => { const values = [...stanza.matchAll(new RegExp(`^${key}: ([^\\n]+)$`, 'gm'))]; requireThat(values.length === 1); return values[0][1]; };
    const status = field('Status'), version = field('Version');
    requireThat(/^(?:unknown|install|hold|deinstall|purge) (?:ok|reinstreq) (?:not-installed|config-files|half-installed|unpacked|half-configured|triggers-awaited|triggers-pending|installed)$/.test(status));
    requireThat(/^[A-Za-z0-9.+:~\-]{1,128}$/.test(version)); selected.set(name, { package: name, status, version });
  }
  return PACKAGES.map(name => selected.get(name) || { package: name, status: 'not-listed', version: null });
}
export function listMembership(text, paths) {
  requireThat(Buffer.byteLength(text) <= LIMIT.list, 'LIMIT'); const lines = text.split('\n'); requireThat(lines.length <= 20000, 'LIMIT');
  return paths.filter(path => lines.includes(path));
}
export async function toolRow(name, io, b) {
  requireThat(TOOLS.includes(name)); const expectedPath = `/usr/bin/${name}`;
  const row = { tool: name, expectedPath, exists: null, type: null, resolvedPath: null }; let operation = 'tool-lstat';
  try {
    const entry = await b.wait(io.lstat(expectedPath)); row.exists = true; row.type = entry.isSymbolicLink() ? 'symlink' : entry.isFile() ? 'file' : 'other';
    operation = 'tool-realpath'; const resolved = await b.wait(io.realpath(expectedPath)); requireThat(systemPath(resolved));
    operation = 'tool-stat'; const target = await b.wait(io.stat(resolved));
    let again, resolvedAgain;
    try { again = await b.wait(io.lstat(expectedPath)); resolvedAgain = await b.wait(io.realpath(expectedPath)); }
    catch (error) { if (['ENOENT', 'ENOTDIR', 'ELOOP'].includes(property(error, 'code'))) requireThat(false, 'CHANGED'); throw error; }
    requireThat(['dev', 'ino', 'mode', 'uid', 'size', 'mtimeMs', 'ctimeMs'].every(key => entry[key] === again[key]) && resolvedAgain === resolved, 'CHANGED');
    row.resolvedPath = resolved;
    row.targetType = target.isFile() ? 'file' : 'other'; row.uid = target.uid; row.mode = target.mode & 0o7777; row.bytes = target.size;
  } catch (error) { row.error = diagnostic(error, operation); if (operation === 'tool-lstat' && row.error.code === 'ENOENT') row.exists = false; }
  return row;
}
const REAL = Object.freeze({ here: HERE, lstat, stat, realpath, read: boundedRead,
  host: () => ({ uid: process.getuid?.(), platform: process.platform, arch: process.arch, version: process.version, executable: process.execPath }) });
export async function collect(options, env = process.env, io = REAL, b = budget()) {
  let operation = 'admission', report = null;
  try {
    const host = io.host(); admit(env, host, options.commit);
    operation = 'event'; const event = JSON.parse((await io.read(env.GITHUB_EVENT_PATH, LIMIT.event, b)).data); admit(env, host, options.commit, event);
    operation = 'os'; const os = (await io.read(await b.wait(io.realpath('/etc/os-release')), 16384, b)).data.toString(); requireThat(/^ID=ubuntu$/m.test(os) && /^VERSION_ID="22\.04"$/m.test(os));
    operation = 'source'; const root = resolve(io.here, '../..'); requireThat(io.here === join(root, SOURCE) && await b.wait(io.realpath(root)) === root);
    const script = await io.read(join(io.here, 'diagnose.mjs'), LIMIT.source, b); requireThat(script.sha256 === options.script);
    const proposed = await io.read(join(io.here, 'workflow.proposed.yml'), LIMIT.source, b), installed = await io.read(join(root, WORKFLOW), LIMIT.source, b); requireThat(proposed.sha256 === installed.sha256);
    operation = 'node'; const executable = await b.wait(io.realpath(host.executable)); requireThat(systemPath(executable)); const node = await io.read(executable, LIMIT.node, b, false);
    report = { version: 1, status: 'observed', source: { commit: options.commit, scriptSha256: script.sha256, workflowSha256: installed.sha256 },
      github: { repository: REPO, ref: BRANCH, before: BEFORE, after: options.commit, runId: env.GITHUB_RUN_ID, runAttempt: 1, imageOS: env.ImageOS, imageVersion: env.ImageVersion, runnerEnvironment: 'github-hosted', runnerOS: 'Linux', runnerArch: 'X64' },
      node: { version: host.version, executable, bytes: node.bytes, sha256: node.sha256 }, tools: [], packages: [],
      boundary: { processLaunches: 0, installs: 0, nativeLaunches: 0, simulationStarted: false, artifactUpload: false, historicalVmDiagnosis: false } };
    for (const name of TOOLS) report.tools.push(await toolRow(name, io, b));
    operation = 'package-status'; report.packages = parseStatus((await io.read('/var/lib/dpkg/status', LIMIT.status, b)).data.toString());
    const paths = [...new Set(report.tools.flatMap(r => [r.expectedPath, ...(r.resolvedPath ? [r.resolvedPath] : [])]))];
    operation = 'package-list';
    for (const row of report.packages) {
      row.ownership = [];
      for (const variant of ['', ':amd64']) {
        const record = { databaseEntry: `${row.package}${variant}.list`, present: null, owns: [] };
        try { record.owns = listMembership((await io.read(`/var/lib/dpkg/info/${record.databaseEntry}`, LIMIT.list, b)).data.toString(), paths); record.present = true; }
        catch (error) { record.error = diagnostic(error, operation); if (record.error.code === 'ENOENT') record.present = false; }
        row.ownership.push(record);
      }
    }
    b.check(); return report;
  } catch (error) { return { ...(report || { version: 1 }), status: 'unavailable', error: diagnostic(error, operation), nativeStarted: false }; }
}
export async function runEntry(args, { env = process.env, io = REAL, write = line => process.stdout.write(line) } = {}) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), LIMIT.deadlineMs); let report;
  try { report = await collect(argumentsFor(args), env, io, budget({ signal: controller.signal })); }
  catch (error) { report = { version: 1, status: 'unavailable', error: diagnostic(error, 'admission'), nativeStarted: false }; }
  finally { clearTimeout(timer); }
  let encoded = JSON.stringify(report);
  if (Buffer.byteLength(encoded) > LIMIT.report) { report = { version: 1, status: 'unavailable', error: { operation: 'output', name: 'Error', code: 'LIMIT' }, nativeStarted: false }; encoded = JSON.stringify(report); }
  write(`PREREQUISITE_REPORT ${encoded}\n`); return { report, exitCode: report.status === 'observed' ? 0 : 1 };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = (await runEntry(process.argv.slice(2))).exitCode;
