import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile, rm, lstat, stat, realpath, symlink, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { REPO, BRANCH, BEFORE, TOOLS, PACKAGES, LIMIT, argumentsFor, admit, diagnostic, systemPath, budget, boundedRead, parseStatus, listMembership, toolRow, runEntry } from './diagnose.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex'), commit = 'a'.repeat(40);
const host = () => ({ uid: 1001, platform: 'linux', arch: 'x64', version: 'v22.23.3', executable: '/usr/bin/node' });
const env = () => ({ GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: REPO, GITHUB_REF: BRANCH, GITHUB_EVENT_NAME: 'push', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: commit, GITHUB_RUN_ID: '123', RUNNER_ENVIRONMENT: 'github-hosted', RUNNER_OS: 'Linux', RUNNER_ARCH: 'X64', ImageOS: 'ubuntu22', ImageVersion: '20261012.322.1' });
const event = () => ({ before: BEFORE, after: commit, ref: BRANCH, created: false, deleted: false, forced: false, repository: { full_name: REPO, private: false } });
const stanza = (name, version = '1:1.2-3ubuntu4') => `Package: ${name}\nStatus: install ok installed\nVersion: ${version}\nDescription: unretained-secret-description\n`;

test('admission is exact Ubuntu22 hosted first-attempt normal transition', () => {
  admit(env(), host(), commit, event());
  for (const [key, value] of [['GITHUB_RUN_ATTEMPT', '2'], ['GITHUB_REF', 'refs/heads/main'], ['GITHUB_REPOSITORY', 'other/repo'], ['RUNNER_ENVIRONMENT', 'self-hosted'], ['RUNNER_OS', 'Windows'], ['RUNNER_ARCH', 'ARM64'], ['ImageOS', 'ubuntu24'], ['NODE_OPTIONS', '--require=secret']]) assert.throws(() => admit({ ...env(), [key]: value }, host(), commit, event()));
  for (const change of [{ before: commit }, { after: BEFORE }, { created: true }, { deleted: true }, { forced: true }, { repository: { full_name: REPO, private: true } }]) assert.throws(() => admit(env(), host(), commit, { ...event(), ...change }));
  assert.throws(() => admit(env(), { ...host(), uid: 0 }, commit, event())); assert.throws(() => admit(env(), { ...host(), version: 'v24.1.0' }, commit, event()));
});
test('entry arguments have no arbitrary path or probe selectors', () => {
  assert.equal(argumentsFor(['--diagnose', `--expected-script=${'b'.repeat(64)}`, `--expected-commit=${commit}`]).commit, commit);
  for (const args of [[], ['--run'], ['--diagnose', '--expected-script=latest', `--expected-commit=${commit}`], ['--diagnose', `--expected-script=${'b'.repeat(64)}`, `--expected-commit=${commit}`, '--install']]) assert.throws(() => argumentsFor(args));
});
test('diagnostics snapshot getters once and never expose raw error content', () => {
  let name = 0, code = 0; const e = { get name() { return ++name === 1 ? 'TypeError' : 'secret'; }, get code() { return ++code === 1 ? 'ENOENT' : 'secret'; }, message: '/secret/path' };
  assert.deepEqual(diagnostic(e, 'tool-lstat'), { operation: 'tool-lstat', name: 'TypeError', code: 'ENOENT' }); assert.equal(name, 1); assert.equal(code, 1);
  assert.deepEqual(diagnostic({ get name() { throw new Error('secret'); }, get code() { throw new Error('secret'); } }, 'secret'), { operation: 'admission', name: 'OtherError', code: 'OTHER' });
});
test('only bounded normalized system paths may be reported', () => {
  for (const value of ['/usr/bin/Xvfb', '/usr/lib/xorg/Xvfb', '/opt/hostedtoolcache/node/22.23.3/x64/bin/node']) assert.equal(systemPath(value), true);
  for (const value of ['/home/runner/secret', '/usr/bin/../secret', '/usr/bin/a\nsecret', '/usr/bin/' + 'x'.repeat(256), '/tmp/x']) assert.equal(systemPath(value), false);
});
test('package status selects only fixed identities and rejects malformed or duplicated records', () => {
  const result = parseStatus(stanza('unrelated') + '\n' + stanza('xvfb') + '\n' + stanza('xauth'));
  assert.equal(result.length, 3); assert.equal(result[2].status, 'not-listed'); assert.doesNotMatch(JSON.stringify(result), /unretained|unrelated/);
  assert.throws(() => parseStatus(stanza('xvfb') + '\n' + stanza('xvfb'))); assert.throws(() => parseStatus(stanza('xvfb').replace('install ok installed', 'secret-status')));
  assert.throws(() => parseStatus(stanza('xvfb', '/secret/version'))); assert.throws(() => parseStatus('x'.repeat(LIMIT.status + 1)));
  for (const name of PACKAGES) {
    assert.throws(() => parseStatus(stanza('unrelated') + `Package: ${name}\n`), { code: 'INVALID' });
    assert.throws(() => parseStatus(stanza(name) + 'Package: unrelated\n'), { code: 'INVALID' });
  }
});
test('package ownership filters fixed expected/resolved names and bounds input', () => {
  assert.deepEqual(listMembership('/usr/bin/xdpyinfo\n/private/secret\n', ['/usr/bin/xdpyinfo', '/usr/bin/Xvfb']), ['/usr/bin/xdpyinfo']);
  assert.throws(() => listMembership('x'.repeat(LIMIT.list + 1), []));
});
test('bounded real filesystem reads reject excess size, symlinks and aborts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'prerequisite-io-'));
  try {
    const file = join(dir, 'file'); await writeFile(file, 'abc'); const result = await boundedRead(file, 3, budget()); assert.equal(result.sha256, sha('abc'));
    await assert.rejects(boundedRead(file, 2, budget())); await assert.rejects(boundedRead(file, 3, budget({ maxBytes: 2 })));
    await symlink(file, join(dir, 'link')); await assert.rejects(boundedRead(join(dir, 'link'), 3, budget()));
    const controller = new AbortController(); controller.abort(); await assert.rejects(boundedRead(file, 3, budget({ signal: controller.signal })));
    await assert.rejects(budget({ deadlineAt: Date.now() + 10 }).wait(new Promise(() => {})), { code: 'DEADLINE' });
  } finally { await rm(dir, { recursive: true }); }
});
test('bounded reads reject same-size A-to-B-to-A pathname replacement and close the opened descriptor', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'prerequisite-race-')), file = join(dir, 'file'), other = join(dir, 'other'), saved = join(dir, 'saved');
  const open = fs.promises.open; let handle;
  try {
    await writeFile(file, 'AAA'); await writeFile(other, 'BBB');
    const patched = t.mock.method(fs.promises, 'open', async (path, flags) => {
      await rename(file, saved); await rename(other, file); handle = await open(path, flags);
      await rename(file, other); await rename(saved, file); return handle;
    });
    await assert.rejects(boundedRead(file, 3, budget()), { code: 'CHANGED' }); patched.mock.restore();
    assert.equal(await readFile(file, 'utf8'), 'AAA'); await assert.rejects(handle.stat(), { code: 'EBADF' });
  } finally { t.mock.restoreAll(); await handle?.close(); await rm(dir, { recursive: true }); }
});
test('bounded reads verify the descriptor after reading and close on read error or deadline', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'prerequisite-close-')), file = join(dir, 'file'), open = fs.promises.open;
  try {
    for (const mode of ['changed', 'error', 'deadline']) {
      await writeFile(file, 'abc'); let handle, expired = false, statCalls = 0;
      const patched = t.mock.method(fs.promises, 'open', async (...args) => {
        handle = await open(...args); const read = handle.read.bind(handle), fstat = handle.stat.bind(handle);
        t.mock.method(handle, 'stat', async () => { const result = await fstat(); if (mode === 'changed' && ++statCalls === 2) result.ino++; return result; });
        t.mock.method(handle, 'read', async (...args) => {
          if (mode === 'error') throw Object.assign(new Error('unretained'), { code: 'EIO' });
          const result = await read(...args); if (mode === 'deadline') expired = true; return result;
        });
        return handle;
      });
      const b = budget({ now: () => expired ? 20000 : 0, deadlineAt: 10000 });
      await assert.rejects(boundedRead(file, 3, b), { code: mode === 'changed' ? 'CHANGED' : mode === 'error' ? 'EIO' : 'DEADLINE' });
      patched.mock.restore(); assert.equal(handle.fd, -1); await handle.close();
    }
  } finally { t.mock.restoreAll(); await rm(dir, { recursive: true }); }
});
test('a descriptor delivered after an aborted open is still closed', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'prerequisite-late-open-')), file = join(dir, 'file'), open = fs.promises.open, controller = new AbortController();
  let handle, release, closed;
  try {
    await writeFile(file, 'abc');
    const didClose = new Promise(resolve => { closed = resolve; });
    t.mock.method(fs.promises, 'open', async (...args) => {
      handle = await open(...args); const close = handle.close.bind(handle);
      t.mock.method(handle, 'close', async () => { await close(); closed(); });
      controller.abort(); await new Promise(resolve => { release = resolve; }); return handle;
    });
    await assert.rejects(boundedRead(file, 3, budget({ signal: controller.signal })), { code: 'DEADLINE' });
    release(); await didClose; assert.equal(handle.fd, -1);
  } finally { release?.(); t.mock.restoreAll(); await handle?.close(); await rm(dir, { recursive: true }); }
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'prerequisite-entry-')), here = join(root, 'prototype/hosted-prerequisites'), paths = new Map(), reads = [];
  await mkdir(here, { recursive: true }); await mkdir(join(root, '.github/workflows'), { recursive: true });
  const put = async (logical, text) => { const local = join(root, `fixture-${paths.size}`); await writeFile(local, text); paths.set(logical, local); };
  await writeFile(join(here, 'diagnose.mjs'), 'reviewed-script'); await writeFile(join(here, 'workflow.proposed.yml'), 'reviewed-workflow'); await writeFile(join(root, '.github/workflows/hosted-prerequisites.yml'), 'reviewed-workflow');
  await put('/etc/os-release', 'ID=ubuntu\nVERSION_ID="22.04"\n'); await put('/usr/bin/node', 'synthetic-node-bytes');
  await put('/event.json', JSON.stringify({ ...event(), commits: [{ message: 'secret-commit-details' }] }));
  for (const name of TOOLS) await put(`/usr/bin/${name}`, `synthetic-${name}`);
  await put('/var/lib/dpkg/status', PACKAGES.map(n => stanza(n)).join('\n'));
  for (let n = 0; n < PACKAGES.length; n++) await put(`/var/lib/dpkg/info/${PACKAGES[n]}.list`, `/usr/bin/${TOOLS[n]}\n/private/secret\n`);
  const local = path => paths.get(path) || (path.startsWith(root + '/') ? path : join(root, 'absent'));
  const io = { here, host, lstat: path => lstat(local(path)), stat: path => stat(local(path)), realpath: path => paths.has(path) ? Promise.resolve(path) : realpath(path),
    read: (path, limit, b, retain) => { reads.push(path); return boundedRead(local(path), limit, b, retain); } };
  return { root, here, paths, reads, io, environment: { ...env(), GITHUB_EVENT_PATH: '/event.json' }, args: ['--diagnose', `--expected-script=${sha('reviewed-script')}`, `--expected-commit=${commit}`] };
}
test('shared standalone entry collects real fixture files with selected metadata only', async () => {
  const f = await fixture();
  try {
    const logs = [], { report, exitCode } = await runEntry(f.args, { env: f.environment, io: f.io, write: line => logs.push(line) });
    assert.equal(exitCode, 0); assert.equal(report.tools.length, 3); assert.equal(report.packages.length, 3); assert.equal(report.node.sha256, sha('synthetic-node-bytes'));
    assert.ok(report.tools.every(r => r.exists && r.type === 'file' && r.resolvedPath === r.expectedPath));
    for (let n = 0; n < 3; n++) { assert.deepEqual(report.packages[n].ownership[0].owns, [`/usr/bin/${TOOLS[n]}`]); assert.equal(report.packages[n].ownership[1].present, false); }
    assert.equal(report.boundary.processLaunches, 0); assert.equal(report.boundary.historicalVmDiagnosis, false);
    assert.equal(logs.length, 1); assert.ok(Buffer.byteLength(logs[0]) <= LIMIT.report + 32); assert.doesNotMatch(logs[0], /secret|synthetic-node-bytes/);
    assert.equal(f.reads.filter(path => path.startsWith('/var/lib/dpkg/info/')).length, 6);
  } finally { await rm(f.root, { recursive: true }); }
});
test('missing fixed tool is an explicit observation, never a launch or repair', async () => {
  const f = await fixture();
  try {
    await rm(f.paths.get('/usr/bin/xdpyinfo'));
    const { report } = await runEntry(f.args, { env: f.environment, io: f.io, write() {} });
    const row = report.tools[2]; assert.equal(row.exists, false); assert.equal(row.error.operation, 'tool-lstat'); assert.equal(row.error.code, 'ENOENT'); assert.equal(row.resolvedPath, null);
    assert.equal(report.boundary.installs, 0); assert.equal(report.boundary.nativeLaunches, 0);
  } finally { await rm(f.root, { recursive: true }); }
});
test('broken or outside-system resolution retains existence without leaking target', async () => {
  const f = await fixture();
  try {
    const row = await toolRow('Xvfb', { ...f.io, realpath: async () => '/home/runner/private-secret' }, budget());
    assert.equal(row.exists, true); assert.equal(row.resolvedPath, null); assert.deepEqual(row.error, { operation: 'tool-realpath', name: 'Error', code: 'INVALID' });
    const missing = Object.assign(new Error('/secret'), { code: 'ENOENT' }); const broken = await toolRow('Xvfb', { ...f.io, realpath: async () => { throw missing; } }, budget());
    assert.equal(broken.exists, true); assert.equal(broken.error.operation, 'tool-realpath'); assert.equal(broken.error.code, 'ENOENT');
  } finally { await rm(f.root, { recursive: true }); }
});
test('tool metadata rejects a changed link after statting its resolved target', async () => {
  const f = await fixture(), expected = '/usr/bin/Xvfb', link = f.paths.get(expected), a = join(f.root, 'target-a'), b = join(f.root, 'target-b');
  try {
    await writeFile(a, 'AAA'); await writeFile(b, 'BBB'); await rm(link); await symlink(a, link);
    let statPath;
    const io = { ...f.io,
      realpath: async path => path === expected ? (await realpath(link)) === a ? '/usr/lib/xorg/Xvfb-A' : '/usr/lib/xorg/Xvfb-B' : f.io.realpath(path),
      stat: async path => { statPath = path; const value = await stat(a); await rm(link); await symlink(b, link); return value; } };
    const row = await toolRow('Xvfb', io, budget());
    assert.equal(statPath, '/usr/lib/xorg/Xvfb-A'); assert.equal(row.exists, true); assert.equal(row.type, 'symlink'); assert.equal(row.resolvedPath, null);
    assert.deepEqual(row.error, { operation: 'tool-stat', name: 'Error', code: 'CHANGED' });
    for (const key of ['targetType', 'uid', 'mode', 'bytes']) assert.equal(Object.hasOwn(row, key), false);
  } finally { await rm(f.root, { recursive: true }); }
});
test('tool read denial exposes only bounded codes and no unverified attributes', async () => {
  const f = await fixture();
  try {
    const denied = () => { throw Object.assign(new Error('/private/secret'), { code: 'EACCES' }); };
    const entry = await toolRow('Xvfb', { ...f.io, lstat: denied }, budget()); assert.equal(entry.exists, null); assert.equal(entry.error.code, 'EACCES');
    const target = await toolRow('Xvfb', { ...f.io, stat: denied }, budget()); assert.equal(target.exists, true); assert.equal(target.error.code, 'EACCES');
    assert.equal(target.resolvedPath, null); assert.equal(Object.hasOwn(target, 'bytes'), false); assert.doesNotMatch(JSON.stringify([entry, target]), /private|secret/);
  } finally { await rm(f.root, { recursive: true }); }
});
test('source mismatch and package DB failure fail closed with bounded safe diagnostics', async () => {
  const f = await fixture();
  try {
    let result = await runEntry([f.args[0], `--expected-script=${'b'.repeat(64)}`, f.args[2]], { env: f.environment, io: f.io, write() {} });
    assert.equal(result.exitCode, 1); assert.equal(result.report.error.operation, 'source');
    await rm(f.paths.get('/var/lib/dpkg/status')); result = await runEntry(f.args, { env: f.environment, io: f.io, write() {} });
    assert.equal(result.exitCode, 1); assert.equal(result.report.error.operation, 'package-status'); assert.equal(result.report.tools.length, 3);
  } finally { await rm(f.root, { recursive: true }); }
});
test('proposed workflow is single branch transition, read-only token and no software setup', async () => {
  const yaml = await readFile(new URL('./workflow.proposed.yml', import.meta.url), 'utf8');
  assert.ok(yaml.includes(`branches: ['${BRANCH.slice(11)}']`)); assert.ok(yaml.includes(`github.event.before == '${BEFORE}'`));
  assert.match(yaml, /github\.run_attempt == 1/); assert.match(yaml, /github\.event\.forced == false/); assert.match(yaml, /contents: read/); assert.match(yaml, /persist-credentials: false/); assert.match(yaml, /runs-on: ubuntu-22\.04/);
  assert.doesNotMatch(yaml, /upload-artifact|actions\/cache|setup-node|npm ci|apt-get|sudo|workflow_dispatch|pull_request:/);
  const source = await readFile(new URL('./diagnose.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /child_process|execFile|spawn\(|readdir|process\.env\.(?:TEST|FIXTURE)|error\.message|error\.stack/);
  assert.match(source, /process\.exitCode = \(await runEntry\(process\.argv\.slice\(2\)\)\)\.exitCode/);
});
