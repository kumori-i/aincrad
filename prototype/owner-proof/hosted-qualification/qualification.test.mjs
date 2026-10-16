import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { readFile, mkdtemp, writeFile, mkdir, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { ownedProcess, groupGone, successful } from './supervisor.mjs';
import { parseArguments, assertNoTcpListener, logResult, hashFile, createBudget, runtimeInventory, readBounded, signalOptions, runEntry } from './qualify.mjs';
const p = createRequire(import.meta.url)('./policy.cjs');
const hash = 'a'.repeat(64), commit = 'b'.repeat(40);
const copy = value => JSON.parse(JSON.stringify(value));
function github() { return { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: p.REPO, GITHUB_EVENT_NAME: 'push', GITHUB_REF: p.BRANCH, GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: commit, GITHUB_RUN_ID: '123', ImageOS: 'ubuntu22', ImageVersion: '20261004.149.1', RUNNER_ENVIRONMENT: 'github-hosted', RUNNER_OS: 'Linux', RUNNER_ARCH: 'X64' }; }
function status(pid, ppid, nnp, seccomp) { return `Pid:\t${pid}\nPPid:\t${ppid}\nUid:\t1001 1001 1001 1001\nGid:\t1001 1001 1001 1001\nNSpid:\t${pid} 4\nNoNewPrivs:\t${nnp}\nSeccomp:\t${seccomp}\nSeccomp_filters:\t1\nCapInh:\t0000000000000000\nCapPrm:\t0000000000000000\nCapEff:\t0000000000000000\nCapBnd:\t00000000a80425fb\nCapAmb:\t0000000000000000\n`; }
function sandbox() {
  return { preload: { sandboxed: true, contextIsolated: true, type: 'renderer', pid: 4 },
    main: { pid: 120, status: p.parseStatus(status(120, 100, 0, 0)), argv: ['/fixed/electron', '/fixed/electron-main.cjs'], namespaces: { user: 'user:[1]', pid: 'pid:[2]', net: 'net:[3]' }, executable: '/fixed/electron' },
    renderer: { pid: 150, status: p.parseStatus(status(150, 130, 1, 2)), argv: ['/fixed/electron', '--type=renderer'], namespaces: { user: 'user:[11]', pid: 'pid:[12]', net: 'net:[13]' }, executable: '/fixed/electron', startIdentityBefore: '150:9000', startIdentityAfter: '150:9000' } };
}
function page() { return { width: 1440, height: 900, dpr: 1, canvasWidth: 1440, canvasHeight: 900, canvasRectWidth: 1440, canvasRectHeight: 900, nodeAbsent: true, rafCount: 2,
  probeOutcomes: { evalDenied: true, inlineDidNotExecute: true, fetchDenied: true, workerDenied: true },
  violations: [['script-src', 'eval'], ['script-src-elem', 'inline'], ['connect-src', `${p.ORIGIN}/probe.json`], ['worker-src', `${p.ORIGIN}/probe-worker.js`]].map(([effectiveDirective, blockedURI]) => ({ effectiveDirective, blockedURI, originalPolicy: p.CSP, disposition: 'enforce' })) }; }
function bitmap() { const b = Buffer.alloc(1440 * 900 * 4); for (const { x, y, rgb } of p.PIXELS) { const i = (y * 1440 + x) * 4; b[i] = rgb[2]; b[i + 1] = rgb[1]; b[i + 2] = rgb[0]; b[i + 3] = 255; } return b; }

// All child processes below are EventEmitter doubles; no native or shell executable is invoked.
function fakeChild(pid = 4242) { const c = new EventEmitter(); c.pid = pid; c.stdout = new PassThrough(); c.stderr = new PassThrough(); c.stdin = new PassThrough(); return c; }
function fakeClock() { const pending = []; return { pending, schedule(fn, ms) { const t = { fn, ms, active: true }; pending.push(t); return t; }, unschedule(t) { if (t) t.active = false; }, fire(ms) { const t = pending.find(t => t.active && t.ms === ms); assert.ok(t); t.active = false; t.fn(); } }; }

test('explicit CLI gate and immutable identities are mandatory', () => {
  assert.equal(parseArguments(['--qualify', `--expected-manifest=${hash}`, `--expected-commit=${commit}`]).mode, '--qualify');
  for (const args of [[], ['--qualify'], ['--timing', `--expected-manifest=${hash}`, `--expected-commit=${commit}`], ['--qualify', `--expected-manifest=${hash}`, `--expected-commit=${commit}`, '--retry'], ['--qualify', '--expected-manifest=latest', `--expected-commit=${commit}`]]) assert.throws(() => parseArguments(args));
});
test('only exact first-attempt repository branch push is admitted', () => {
  assert.doesNotThrow(() => p.assertGithub(github(), commit));
  for (const [key, value] of [['GITHUB_REPOSITORY', 'other/aincrad'], ['GITHUB_REF', 'refs/heads/main'], ['GITHUB_EVENT_NAME', 'pull_request'], ['GITHUB_RUN_ATTEMPT', '2'], ['GITHUB_ACTIONS', 'false'], ['ImageOS', 'ubuntu24'], ['ImageVersion', ''], ['GITHUB_SHA', 'c'.repeat(40)], ['RUNNER_ENVIRONMENT', 'self-hosted'], ['RUNNER_OS', 'Windows'], ['RUNNER_ARCH', 'ARM64']]) { const e = github(); e[key] = value; assert.throws(() => p.assertGithub(e, commit)); }
});
test('host requirements and security environment fail closed', () => {
  assert.doesNotThrow(() => p.assertEnvironment({}, 1001, 'linux', 'x64'));
  for (const args of [[{}, 0, 'linux', 'x64'], [{}, 1001, 'win32', 'x64'], [{}, 1001, 'linux', 'arm64'], ...p.BAD_ENV.map(key => [{ [key]: '1' }, 1001, 'linux', 'x64'])]) assert.throws(() => p.assertEnvironment(...args));
  p.assertOs('ID=ubuntu\nVERSION_ID="22.04"\n'); assert.throws(() => p.assertOs('ID=ubuntu\nVERSION_ID="24.04"\n'));
  p.assertNode('v22.12.0'); p.assertNode('v22.23.3'); for (const v of ['v22.11.0', 'v24.1.0', '22.23.3']) assert.throws(() => p.assertNode(v));
});
test('sandbox weakening, headless and forced-scaling arguments are refused', () => {
  for (const arg of ['--no-sandbox', '--disable-setuid-sandbox', '--disable-seccomp-filter-sandbox', '--disable-namespace-sandbox', '--disable-gpu-sandbox', '--disable-web-security', '--remote-debugging-port=9222', '--remote-debugging-pipe', '--headless', '--ozone-platform=headless', '--single-process', '--no-zygote', '--force-device-scale-factor=1']) assert.equal(p.badArg(arg), true, arg);
  assert.equal(p.badArg('--ozone-platform=x11'), false); assert.equal(p.badArg('--disable-gpu'), false);
});
test('combined runtime sandbox evidence passes only with every declared mechanism', () => {
  assert.equal(p.validateSandbox(sandbox()), true);
  const mutations = [s => s.preload.sandboxed = false, s => s.preload.contextIsolated = false, s => s.renderer.status.Seccomp = '0', s => s.renderer.status.NoNewPrivs = '0',
    s => s.renderer.status.CapEff = '0001', s => s.renderer.status.CapPrm = '0001', s => s.renderer.status.CapAmb = '0001', s => s.renderer.status.Uid = '0 0 0 0',
    s => s.renderer.argv.push('--no-sandbox'), s => s.renderer.argv = [], s => s.renderer.executable = '/other/electron', s => s.renderer.pid = 151,
    s => s.renderer.startIdentityAfter = '150:9001', s => s.renderer.namespaces.user = null, s => s.renderer.namespaces.pid = s.main.namespaces.pid, s => s.renderer.namespaces.net = s.main.namespaces.net,
    s => s.renderer.namespaces.user = s.main.namespaces.user, s => s.preload.pid = 987654, s => s.renderer.status.NSpid = null, s => s.renderer.status.NSpid = '151 4', s => s.renderer.status.NSpid = '150', s => s.renderer.status.NSpid = '150 0', s => s.renderer.status.NSpid = '150 04', s => s.renderer.status.NSpid = '150 999999999999999999', s => s.renderer.status.NSpid = '150 4\n1', s => s.renderer.status.NSpid = '150 ' + '4 '.repeat(33).trim()];
  for (const mutate of mutations) { const s = sandbox(); mutate(s); assert.throws(() => p.validateSandbox(s)); }
});
test('process status missing fields and invalid values cannot manufacture evidence', () => {
  assert.equal(p.parseStatus(status(150, 120, 1, 2)).Seccomp, '2');
  assert.throws(() => p.parseStatus('Seccomp: 2\n')); assert.throws(() => p.parseStatus(status(150, 120, 1, 2).replace('CapEff:', 'Other:')));
});
test('exact display geometry and explicit auth denial are required', () => {
  assert.deepEqual(p.dimensions('dimensions: 1440x900 pixels'), { width: 1440, height: 900 });
  for (const text of ['dimensions: 1x1 pixels', 'dimensions: 1440x901 pixels', 'unavailable']) assert.throws(() => p.dimensions(text));
  const r = { code: 1, signal: null, reason: null, stderr: 'Authorization required, but no authorization protocol specified' };
  assert.equal(p.cookieDenial(r), true);
  for (const change of [{ code: 0 }, { signal: 'SIGKILL' }, { reason: 'process-deadline' }, { stderr: 'Cannot open display' }]) assert.equal(p.cookieDenial({ ...r, ...change }), false);
});
test('TCP evidence checks both families and refuses a listener or malformed observation', () => {
  const header = ' sl local_address rem_address st\n';
  assert.equal(assertNoTcpListener(header, header, 100).listening, false);
  const listener = `${header} 0: 00000000:17D4 00000000:0000 0A 00\n`; // 6100
  assert.throws(() => assertNoTcpListener(listener, header, 100)); assert.throws(() => assertNoTcpListener(header, listener, 100));
  assert.throws(() => assertNoTcpListener('', header, 100)); assert.throws(() => assertNoTcpListener(header, header, 99));
});
test('CSP probes need actual exact enforced policy events, not transport failures', () => {
  assert.equal(p.validatePage(page()), true);
  const mutations = [v => v.violations = [], v => v.violations[0].originalPolicy = "default-src 'self'", v => v.violations[0].disposition = 'report',
    v => v.violations[2].blockedURI = 'https://example.com/', v => v.violations[3].effectiveDirective = 'connect-src', v => v.probeOutcomes.workerDenied = false,
    v => v.nodeAbsent = false, v => v.dpr = 2, v => v.width = 1, v => v.canvasWidth = 1, v => v.rafCount = 0, v => v.extra = true];
  for (const mutate of mutations) { const value = page(); mutate(value); assert.throws(() => p.validatePage(value)); }
});
test('protocol admits only fixed exact local asset URLs', () => {
  assert.equal(p.asset(`${p.ORIGIN}/page.html`), 'page.html'); assert.equal(p.asset(`${p.ORIGIN}/probe.json`), 'probe.json');
  for (const url of ['https://example.com', `${p.ORIGIN}/../page.html`, `${p.ORIGIN}/page.html?x=1`, `${p.ORIGIN}/%70age.html`, `${p.ORIGIN}/preload.cjs`, `${p.ORIGIN}/page.html#x`]) assert.equal(p.asset(url), null);
});
test('native raster evidence rejects blank, incorrect color or incorrect dimensions', () => {
  assert.equal(p.analyzeBitmap(bitmap(), 1440, 900).nonblank, true);
  assert.throws(() => p.analyzeBitmap(Buffer.alloc(1440 * 900 * 4), 1440, 900));
  assert.throws(() => p.analyzeBitmap(bitmap(), 1, 1)); const b = bitmap(); b[(8 * 1440 + 8) * 4] ^= 1; assert.throws(() => p.analyzeBitmap(b, 1440, 900));
});
test('PNG logs are bounded numbered base64 and reconstruct original bytes exactly', () => {
  const bytes = Buffer.alloc(10000, 73); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  const encoded = p.encodeScreenshot(bytes); assert.ok(encoded.chunks.every(c => c.length <= 6144)); assert.deepEqual(Buffer.from(encoded.chunks.join(''), 'base64'), bytes);
  const lines = []; logResult({ version: 1, status: 'qualified' }, bytes, s => lines.push(s)); assert.match(lines[0], /^QUALIFICATION_REPORT /); assert.match(lines[1], /^QUALIFICATION_PNG_MANIFEST /);
  assert.throws(() => p.encodeScreenshot(Buffer.alloc(65537))); assert.throws(() => p.encodeScreenshot(Buffer.alloc(9))); assert.throws(() => logResult({ data: 'x'.repeat(p.LIMIT.json) }, null, () => {}));
});
test('source manifest requires exact file census, package identity and hashes', () => {
  const good = { version: 1, destination: p.DESTINATION, files: p.SOURCE_FILES.map(path => ({ path, bytes: 1, sha256: hash })), packages: p.PACKAGES };
  assert.equal(p.sourceManifest(Buffer.from(JSON.stringify(good))).files.length, p.SOURCE_FILES.length);
  for (const mutate of [v => v.files.pop(), v => v.files.reverse(), v => v.files[0].path = '../bad', v => v.files[0].sha256 = 'bad', v => v.packages['package.json'] = hash, v => v.extra = true]) { const v = copy(good); mutate(v); assert.throws(() => p.sourceManifest(Buffer.from(JSON.stringify(v)))); }
});
test('frozen code is exact and fingerprint reads are bounded', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qualification-unit-'));
  try {
    const code = [];
    for (const name of p.RUNTIME_FILES) { const bytes = Buffer.from(`fixture:${name}`); await writeFile(join(dir, name), bytes); code.push({ path: name, bytes: bytes.length, sha256: p.sha256(bytes) }); }
    p.verifyCode(dir, code); const row = await hashFile(join(dir, 'page.js')); assert.equal(row.sha256, code.find(r => r.path === 'page.js').sha256);
    await writeFile(join(dir, 'page.js'), 'changed'); assert.throws(() => p.verifyCode(dir, code)); await assert.rejects(hashFile(join(dir, 'page.js'), 1));
  } finally { await rm(dir, { recursive: true }); }
});
test('only positive ESRCH proves an owned process group absent', async () => {
  assert.deepEqual(await groupGone(4242, { signal() { const e = new Error(); e.code = 'ESRCH'; throw e; } }), { gone: true, reason: null });
  assert.equal((await groupGone(4242, { signal() {} })).gone, false);
  assert.equal((await groupGone(4242, { signal() { const e = new Error(); e.code = 'EPERM'; throw e; } })).gone, false);
  assert.equal((await groupGone(0, { signal() { throw new Error('must-not-call'); } })).gone, false);
});
test('owned supervision uses detached groups, input through stdin and bounded cleanup', async () => {
  const child = fakeChild(), clock = fakeClock(), signals = []; let group = true, optionsSeen;
  const proc = ownedProcess('/fixed/tool', ['arg'], { env: { PATH: '/usr/bin' }, input: 'private-cookie\n', deadlineMs: 100,
    spawn(_cmd, _args, options) { optionsSeen = options; queueMicrotask(() => { child.stdout.write('done'); child.emit('exit', 0, null); queueMicrotask(() => child.emit('close', 0, null)); }); return child; },
    signal(pid, sig) { signals.push([pid, sig]); if (!group) { const e = new Error(); e.code = 'ESRCH'; throw e; } if (sig === 'SIGTERM') group = false; },
    delay: async () => {}, schedule: clock.schedule, unschedule: clock.unschedule });
  const result = await proc.result, cleanup = await proc.close(); assert.equal(optionsSeen.detached, true); assert.equal(child.stdin.read().toString(), 'private-cookie\n');
  assert.equal(result.stdout, 'done'); assert.equal(cleanup.groupGone, true); assert.ok(signals.every(([pid]) => pid === -4242)); assert.equal(successful({ ...result, cleanup }), true);
});
test('output overflow stops the owned process and cannot pass', async () => {
  const child = fakeChild(), clock = fakeClock(); let group = true;
  const proc = ownedProcess('/fixed/tool', [], { env: {}, deadlineMs: 100, outputLimit: 4, spawn: () => child,
    signal(_pid, sig) { if (!group) { const e = new Error(); e.code = 'ESRCH'; throw e; } if (sig === 'SIGTERM') { group = false; queueMicrotask(() => { child.emit('exit', null, 'SIGTERM'); queueMicrotask(() => child.emit('close', null, 'SIGTERM')); }); } },
    delay: async () => {}, schedule: clock.schedule, unschedule: clock.unschedule });
  child.stderr.write('too much'); const result = await proc.result, cleanup = await proc.close(); assert.equal(result.reason, 'process-output-limit'); assert.equal(result.stderr, ''); assert.equal(successful({ ...result, cleanup }), false);
});
test('deadline escalates only its owned group and unconfirmed exit is unavailable', async () => {
  const child = fakeChild(), clock = fakeClock(), signals = []; let group = true;
  const proc = ownedProcess('/fixed/tool', [], { env: {}, deadlineMs: 100, spawn: () => child,
    signal(pid, sig) { signals.push([pid, sig]); if (!group) { const e = new Error(); e.code = 'ESRCH'; throw e; } if (sig === 'SIGKILL') group = false; },
    delay: async () => {}, schedule: clock.schedule, unschedule: clock.unschedule });
  clock.fire(100); clock.fire(1500); const result = await proc.result, cleanup = await proc.close(); assert.equal(result.reason, 'process-deadline'); assert.equal(result.exitConfirmed, false);
  assert.equal(successful({ ...result, cleanup }), false); assert.ok(signals.some(([, sig]) => sig === 'SIGKILL')); assert.ok(signals.every(([pid]) => pid === -4242));
});
test('launch error and inaccessible group cleanup remain unavailable', async () => {
  const child = fakeChild(), clock = fakeClock();
  const proc = ownedProcess('/fixed/missing', [], { env: {}, deadlineMs: 100, spawn() { queueMicrotask(() => child.emit('error', new Error('missing'))); return child; },
    signal() { const e = new Error(); e.code = 'EPERM'; throw e; }, delay: async () => {}, schedule: clock.schedule, unschedule: clock.unschedule });
  const result = await proc.result, cleanup = await proc.close(); assert.equal(result.launchError, true); assert.equal(cleanup.groupGone, false); assert.equal(successful({ ...result, cleanup }), false);
});
test('workflow proposal has only literal branch push, read token, no uploads or OS modification', async () => {
  const yaml = await readFile(new URL('./workflow.proposed.yml', import.meta.url), 'utf8');
  assert.ok(yaml.includes(`branches: ['${p.BRANCH.slice('refs/heads/'.length)}']`)); assert.match(yaml, /contents: read/); assert.match(yaml, /persist-credentials: false/); assert.match(yaml, /runs-on: ubuntu-22\.04/);
  assert.match(yaml, /github\.run_attempt == 1/); assert.ok(yaml.includes(`github.event.before == '${p.EXPECTED_BEFORE}'`)); assert.match(yaml, /github\.event\.after == github\.sha/); assert.match(yaml, /github\.event\.forced == false/); assert.match(yaml, /npm ci --no-audit --no-fund/);
  assert.doesNotMatch(yaml, /^\s*(pull_request|workflow_dispatch|schedule):/m); assert.doesNotMatch(yaml, /upload-artifact|download-artifact|actions\/cache|apt-get|\bsudo\b|sysctl|chmod|chown|no-sandbox|pull_request_target/);
});
test('runtime entry points are self-contained and never import owner/world modules', async () => {
  for (const name of ['qualify.mjs', 'supervisor.mjs', 'electron-main.cjs', 'preload.cjs', 'page.js']) {
    const source = await readFile(new URL(`./${name}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /(?:from\s+|require\()["']\.\.\//); assert.doesNotMatch(source, /startOwnedDummyDisplay|reserveTiming|run\.mjs|stageARoot|PopulationRuntime|SimulationClock|workCardinal/);
  }
  const preload = await readFile(new URL('./preload.cjs', import.meta.url), 'utf8'); assert.doesNotMatch(preload, /require\(['"](?:node:)?(?:fs|child_process)/); assert.match(preload, /qualification-report-already-submitted/);
});


test('exit cannot freeze output before late data and close', async () => {
  const child = fakeChild(), clock = fakeClock(); let group = true, resolved = false;
  const proc = ownedProcess('/fixed/tool', [], { env: {}, deadlineMs: 1000, spawn: () => child,
    signal(_pid, sig) { if (!group) { const e = new Error(); e.code = 'ESRCH'; throw e; } if (sig === 'SIGTERM') group = false; },
    delay: async () => {}, schedule: clock.schedule, unschedule: clock.unschedule });
  proc.result.then(() => { resolved = true; });
  child.emit('exit', 0, null); await Promise.resolve(); assert.equal(resolved, false); assert.equal(proc.isRunning(), false);
  child.stdout.write('late-output'); child.emit('close', 0, null);
  const result = await proc.result, cleanup = await proc.close(); assert.equal(result.stdout, 'late-output'); assert.equal(result.closeConfirmed, true); assert.equal(successful({ ...result, cleanup }), true);
});
test('late output overflow after exit invalidates result and drain grace is bounded', async () => {
  for (const close of [true, false]) {
    const child = fakeChild(), clock = fakeClock(); let group = true;
    const proc = ownedProcess('/fixed/tool', [], { env: {}, deadlineMs: 1000, outputLimit: 4, spawn: () => child,
      signal(_pid, sig) { if (!group) { const e = new Error(); e.code = 'ESRCH'; throw e; } if (sig === 'SIGTERM') group = false; },
      delay: async () => {}, schedule: clock.schedule, unschedule: clock.unschedule });
    child.emit('exit', 0, null);
    if (close) { child.stderr.write('x'.repeat(25)); child.emit('close', 0, null); }
    else clock.fire(500);
    const result = await proc.result, cleanup = await proc.close();
    assert.equal(result.reason, close ? 'process-output-limit' : 'process-output-close-unconfirmed'); assert.equal(successful({ ...result, cleanup }), false);
    if (close) assert.equal(result.outputBytes, 25);
  }
});


test('exact push transition rejects new pushes, creation, force, deletion and unrelated repositories', () => {
  const event = { before: p.EXPECTED_BEFORE, after: commit, ref: p.BRANCH, created: false, deleted: false, forced: false, repository: { full_name: p.REPO, private: false }, commits: [{ message: 'unretained' }], sender: { login: 'unretained' } };
  const selected = p.pushTransition(event, commit); assert.equal(selected.before, p.EXPECTED_BEFORE); assert.equal('commits' in selected, false); assert.equal('sender' in selected, false);
  for (const mutate of [v => v.before = commit, v => v.after = 'c'.repeat(40), v => v.created = true, v => v.deleted = true, v => v.forced = true, v => delete v.forced, v => v.ref = 'refs/heads/main', v => v.repository.private = true, v => v.repository.full_name = 'other/repo']) {
    const value = copy(event); mutate(value); assert.throws(() => p.pushTransition(value, commit));
  }
});
test('namespace PID chain is bounded, ordered host-to-inner, and tied to preload getpid', () => {
  assert.deepEqual(p.namespacePids('150\t24 4'), [150, 24, 4]); const good = sandbox(); good.renderer.status.NSpid = '150 24 4'; assert.equal(p.validateSandbox(good), true);
  for (const text of ['', null, '0', '-1', '1e3', '150 4  ', '150 2147483648', '150\n4', '150 ' + Array(33).fill('4').join(' ')]) assert.throws(() => p.namespacePids(text));
});
test('shared inventory byte, entry and depth budgets reject synthetic oversized trees', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qualification-budget-'));
  try {
    await writeFile(join(dir, 'one'), '1234'); await writeFile(join(dir, 'two'), '5678');
    await assert.rejects(runtimeInventory(dir, createBudget({ maxBytes: 7 })), /inventory-byte-limit/);
    await assert.rejects(runtimeInventory(dir, createBudget({ maxEntries: 2 })), /inventory-entry-limit/);
    await mkdir(join(dir, 'a/b/c'), { recursive: true }); await writeFile(join(dir, 'a/b/c/item'), 'x');
    await assert.rejects(runtimeInventory(dir, createBudget({ maxDepth: 2 })), /inventory-depth-limit/);
    const shared = createBudget({ maxBytes: 9 }); await runtimeInventory(dir, shared);
    await assert.rejects(runtimeInventory(dir, shared), /inventory-byte-limit/); // after-verification shares, never resets
  } finally { await rm(dir, { recursive: true }); }
});
test('pending read is aborted and destroyed without native execution', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qualification-abort-'));
  try {
    const file = join(dir, 'file'); await writeFile(file, 'x'); const controller = new AbortController(), stream = new PassThrough();
    const budget = createBudget({ signal: controller.signal });
    await assert.rejects(hashFile(file, 100, budget, () => { queueMicrotask(() => controller.abort()); return stream; }), /inventory-aborted/);
    assert.equal(stream.destroyed, true);
    await assert.rejects(hashFile(file, 100, budget), /inventory-aborted/);
  } finally { await rm(dir, { recursive: true }); }
});
test('post-verification and a pending read retain the original deadline', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qualification-deadline-')); let now = 0;
  try {
    const file = join(dir, 'file'); await writeFile(file, 'x'); const budget = createBudget({ deadlineAt: 100, now: () => now });
    await runtimeInventory(dir, budget); now = 100;
    await assert.rejects(runtimeInventory(dir, budget), /inventory-deadline/);
    const stream = new PassThrough(); const pending = createBudget({ deadlineAt: Date.now() + 25 });
    await assert.rejects(hashFile(file, 100, pending, () => stream), /inventory-deadline/); assert.equal(stream.destroyed, true);
    await assert.rejects(readBounded(file, 0), /fingerprint-file-unavailable/);
  } finally { await rm(dir, { recursive: true }); }
});
test('bounded same-FD source read rejects growth and never reads past initial size plus one', async () => {
  const fs = createRequire(import.meta.url)('node:fs'), dir = await mkdtemp(join(tmpdir(), 'qualification-growth-'));
  try {
    const file = join(dir, 'file'); await writeFile(file, 'a'); let bytesRequested = 0;
    const io = { ...fs, readSync(fd, buffer, offset, length, position) { bytesRequested += length; const n = fs.readSync(fd, buffer, offset, length, position); fs.writeFileSync(file, 'x'.repeat(100)); return n; } };
    assert.throws(() => p.realFile(file, 1000, io), /file-changed-during-read/); assert.ok(bytesRequested <= 3);
  } finally { await rm(dir, { recursive: true }); }
});
test('terminal supervision cannot recreate timers from late error, exit or bytes', async () => {
  const child = fakeChild(), clock = fakeClock();
  const proc = ownedProcess('/fixed/tool', [], { env: {}, deadlineMs: 1000, spawn: () => child, signal() { const e = new Error(); e.code = 'ESRCH'; throw e; }, delay: async () => {}, schedule: clock.schedule, unschedule: clock.unschedule });
  child.emit('error', new Error('launch')); await proc.result; const count = clock.pending.length;
  child.emit('exit', 0, null); child.stderr.write('late'); child.stdin.emit('error', new Error('late'));
  assert.equal(proc.isRunning(), false); assert.equal(clock.pending.length, count); assert.equal(clock.pending.some(t => t.active), false); await proc.close();
});


async function standaloneFixture() {
  const root = await mkdtemp(join(tmpdir(), 'qualification-preflight-'));
  const here = join(root, p.DESTINATION), original = dirname(fileURLToPath(import.meta.url)), repository = resolve(original, '../../..');
  await mkdir(here, { recursive: true }); await mkdir(join(root, '.github/workflows'), { recursive: true }); await mkdir(join(root, 'runner-temp'));
  const files = [];
  for (const name of p.SOURCE_FILES) { const bytes = await readFile(join(original, name)); await writeFile(join(here, name), bytes); files.push({ path: name, bytes: bytes.length, sha256: p.sha256(bytes) }); }
  for (const name of Object.keys(p.PACKAGES)) await writeFile(join(root, name), await readFile(join(repository, name)));
  const workflow = await readFile(join(original, 'workflow.proposed.yml')); await writeFile(join(here, 'workflow.proposed.yml'), workflow); await writeFile(join(root, p.WORKFLOW), workflow);
  const manifest = Buffer.from(JSON.stringify({ version: 1, destination: p.DESTINATION, files, packages: p.PACKAGES })); await writeFile(join(here, 'SOURCE-MANIFEST.json'), manifest);
  await writeFile(join(root, 'os-release'), 'ID=ubuntu\nVERSION_ID="22.04"\n');
  const mappings = new Map([['/etc/os-release', join(root, 'os-release')]]);
  const kernels = ['/proc/sys/kernel/unprivileged_userns_clone', '/proc/sys/kernel/apparmor_restrict_unprivileged_userns', '/proc/sys/user/max_user_namespaces'];
  for (let n = 0; n < kernels.length; n++) { const file = join(root, `kernel-${n}`); await writeFile(file, `${n === 1 ? 0 : 1}\n`); mappings.set(kernels[n], file); }
  // Synthetic binary metadata belongs only to the injected read-only adapter.
  // Bytes and hashes use real bounded filesystem reads; no executable is launched
  // and no file ownership or permissions are changed for this fixture.
  const binary = join(root, 'binary'); await writeFile(binary, 'fixture binary bytes'); for (const tool of p.TOOLS) mappings.set(tool, binary);
  const event = join(root, 'event.json'); await writeFile(event, JSON.stringify({ before: p.EXPECTED_BEFORE, after: commit, ref: p.BRANCH, created: false, deleted: false, forced: false, repository: { full_name: p.REPO, private: false }, commits: [{ message: 'do-not-retain-event-details' }] }));
  const reads = [], env = { ...github(), GITHUB_EVENT_PATH: event, RUNNER_TEMP: join(root, 'runner-temp') };
  const adapter = { here, host: () => ({ uid: 1001, platform: 'linux', arch: 'x64', nodeVersion: 'v22.12.0', execPath: binary, kernel: 'fixture', cpuModel: 'fixture', logicalCpus: 4, memoryBytes: 17179869184 }),
    realpath: file => realpath(mappings.get(file) || file), readBounded,
    hashFile: async (...args) => ({ ...await hashFile(...args), uid: 0, mode: 0o755 }),
    readFile(file, options) { reads.push({ file, options }); return readFile(mappings.get(file) || file, options); } };
  return { root, adapter, env, reads, kernels, mappings, args: ['--preflight', `--expected-manifest=${p.sha256(manifest)}`, `--expected-commit=${commit}`] };
}

test('standalone entry uses real filesystem preflight with omitted and valid abort signals', async () => {
  const fixture = await standaloneFixture();
  try {
    // Reproduce the original Node failure on a harmless fixture, then prove the
    // same standalone entry path reaches all kernel reads with its default budget.
    await assert.rejects(readFile(fixture.mappings.get(fixture.kernels[0]), { encoding: 'utf8', signal: null }), { code: 'ERR_INVALID_ARG_TYPE' });
    assert.deepEqual(signalOptions(null), {}); assert.deepEqual(signalOptions(undefined), {});
    for (const valid of [false, true]) {
      fixture.reads.length = 0; const lines = [], controller = new AbortController();
      const result = await runEntry(fixture.args, { env: fixture.env, adapter: fixture.adapter, ...(valid ? { budget: createBudget({ signal: controller.signal }) } : {}), write: line => lines.push(line) });
      assert.equal(result.exitCode, 0); assert.equal(result.report.status, 'preflight-qualified'); assert.equal(fixture.reads.length, 3);
      for (const { options } of fixture.reads) { assert.equal(Object.hasOwn(options, 'signal'), valid); if (valid) assert.equal(options.signal, controller.signal); }
      assert.deepEqual(result.report.kernelSettings, { unprivilegedUsernsClone: '1', apparmorRestrictUnprivilegedUserns: '0', maxUserNamespaces: '1' });
      assert.equal(result.report.boundary.applicationStarted, false); assert.equal(result.report.boundary.simulationStarted, false); assert.equal(result.report.boundary.timingStarted, false);
      assert.equal(lines.length, 1); assert.match(lines[0], /^QUALIFICATION_REPORT /); assert.doesNotMatch(lines[0], /do-not-retain-event-details/);
    }
  } finally { await rm(fixture.root, { recursive: true }); }
});
test('standalone entry fails closed when its real filesystem kernel read is aborted', async () => {
  const fixture = await standaloneFixture(), controller = new AbortController(), original = fixture.adapter.readFile;
  try {
    fixture.adapter.readFile = (file, options) => { controller.abort(); return original(file, options); };
    const result = await runEntry(fixture.args, { env: fixture.env, adapter: fixture.adapter, budget: createBudget({ signal: controller.signal }), write() {} });
    assert.equal(result.exitCode, 1); assert.equal(result.report.status, 'unavailable'); assert.equal(result.report.nativeStarted, false);
    assert.equal(fixture.reads.length, 1); assert.equal(fixture.reads[0].options.signal, controller.signal);
    assert.equal(result.report.diagnostic.operation, 'preflight-kernel-settings');
    assert.ok(['Error', 'AbortError'].includes(result.report.diagnostic.errorName));
  } finally { await rm(fixture.root, { recursive: true }); }
});
test('standalone preflight errors disclose only fixed operation and allowlisted name/code', async () => {
  const fixture = await standaloneFixture();
  try {
    fixture.adapter.readFile = () => { throw Object.assign(new TypeError('secret-token /private/path arbitrary stderr'), { code: 'ERR_INVALID_ARG_TYPE', path: '/private/path', credential: 'secret-token' }); };
    const lines = [], result = await runEntry(fixture.args, { env: fixture.env, adapter: fixture.adapter, write: line => lines.push(line) });
    assert.equal(result.exitCode, 1); assert.deepEqual(result.report.diagnostic, { operation: 'preflight-kernel-settings', errorName: 'TypeError', errorCode: 'ERR_INVALID_ARG_TYPE' });
    assert.doesNotMatch(lines.join(''), /secret-token|private\/path|arbitrary stderr|credential|stack/);
    assert.ok(Buffer.byteLength(JSON.stringify(result.report.diagnostic)) < 256);
    assert.deepEqual(p.diagnostic({ name: 'secret-name', code: 'secret-code', message: 'secret-message' }, 'secret-operation'), { operation: 'entry', errorName: 'OtherError', errorCode: 'OTHER' });
    assert.deepEqual(p.diagnostic(new Error('secret-message')), { operation: 'entry', errorName: 'Error', errorCode: 'NONE' });
  } finally { await rm(fixture.root, { recursive: true }); }
});
test('fixture adapter cannot reach the native mode and CLI has no fixture selector', async () => {
  const lines = [], result = await runEntry(['--qualify', `--expected-manifest=${hash}`, `--expected-commit=${commit}`], { adapter: {}, write: line => lines.push(line) });
  assert.equal(result.exitCode, 1); assert.equal(result.report.nativeStarted, false); assert.equal(result.report.diagnostic.operation, 'entry');
  assert.throws(() => parseArguments(['--preflight', `--expected-manifest=${hash}`, `--expected-commit=${commit}`, '--fixture=/private/path']));
  const source = await readFile(new URL('./qualify.mjs', import.meta.url), 'utf8');
  assert.match(source, /process\.exitCode = \(await runEntry\(process\.argv\.slice\(2\)\)\)\.exitCode/);
  assert.doesNotMatch(source, /process\.env\.(?:TEST|FIXTURE|ADAPTER)|error\.message/);
});


test('diagnostics snapshot changing name/code accessors once before allowlisting', () => {
  let names = 0, codes = 0;
  const error = { get name() { return ++names === 1 ? 'TypeError' : 'secret-name'; }, get code() { return ++codes === 1 ? 'EACCES' : 'secret-code'; } };
  const wrapped = p.annotateFailure(error, 'preflight-kernel-settings');
  const expected = { operation: 'preflight-kernel-settings', errorName: 'TypeError', errorCode: 'EACCES' };
  assert.deepEqual(p.diagnostic(wrapped), expected); assert.deepEqual(p.diagnostic(wrapped), expected);
  assert.equal(names, 1); assert.equal(codes, 1); assert.doesNotMatch(JSON.stringify(p.diagnostic(wrapped)), /secret/);
});
test('diagnostics contain throwing accessors and do not coerce object values', () => {
  let names = 0, codes = 0;
  const error = { get name() { names++; throw new Error('secret-name'); }, get code() { codes++; throw new Error('secret-code'); } };
  assert.deepEqual(p.diagnostic(error, 'preflight-tools'), { operation: 'preflight-tools', errorName: 'OtherError', errorCode: 'OTHER' });
  assert.equal(names, 1); assert.equal(codes, 1);
  const value = { toString() { throw new Error('must-not-coerce'); } };
  assert.deepEqual(p.diagnostic({ name: value, code: value }), { operation: 'entry', errorName: 'OtherError', errorCode: 'OTHER' });
  assert.deepEqual(p.diagnostic({ get name() { throw new Error('secret'); }, code: 'ENOENT' }), { operation: 'entry', errorName: 'OtherError', errorCode: 'ENOENT' });
});
