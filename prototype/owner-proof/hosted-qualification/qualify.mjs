/** Standalone hosted qualification. Imports and tests never launch Xvfb or Electron. */
import fs from 'node:fs';
import { readFile, writeFile, mkdir, mkdtemp, realpath, lstat, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomInt } from 'node:crypto';
import { cpus, totalmem, release } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { createRequire } from 'node:module';
import { ownedProcess, checkedCommand, successful } from './supervisor.mjs';
import { createBudget, hashFile, readBounded, runtimeInventory, signalOptions } from './bounded-io.mjs';
import { probeX11Setup } from './x11-setup.mjs';
export { createBudget, hashFile, readBounded, runtimeInventory, signalOptions } from './bounded-io.mjs';
const p = createRequire(import.meta.url)('./policy.cjs');
const HERE = dirname(fileURLToPath(import.meta.url));

// The real CLI always uses this adapter. Tests may inject read-only filesystem
// fixtures through the exported function only; no CLI/env/config selector exists.
const PREFLIGHT_HOST = Object.freeze({ here: HERE, realpath, readFile, readBounded, hashFile,
  host: () => ({ uid: process.getuid?.(), platform: process.platform, arch: process.arch, nodeVersion: process.version,
    execPath: process.execPath, kernel: release(), cpuModel: cpus()[0]?.model || 'unavailable', logicalCpus: cpus().length, memoryBytes: totalmem() }) });

export function parseArguments(args) {
  p.demand(args.length === 3 && ['--preflight', '--qualify'].includes(args[0]), 'explicit-mode-required');
  const manifest = /^--expected-manifest=([a-f0-9]{64})$/.exec(args[1]), commit = /^--expected-commit=([a-f0-9]{40})$/.exec(args[2]);
  p.demand(manifest && commit, 'expected-identities-required'); return { mode: args[0], manifest: manifest[1], commit: commit[1] };
}
export function assertNoTcpListener(text4, text6, displayNumber) {
  p.demand(Number.isInteger(displayNumber) && displayNumber >= 100 && displayNumber < 500, 'display-number');
  for (const text of [text4, text6]) {
    p.demand(typeof text === 'string' && text.length <= 1048576 && /local_address/.test(text), 'tcp-observation-unavailable');
    for (const line of text.trim().split('\n').slice(1)) {
      const f = line.trim().split(/\s+/); p.demand(f.length >= 4 && /^[0-9A-F]+:[0-9A-F]{4}$/i.test(f[1]) && /^[0-9A-F]{2}$/i.test(f[3]), 'tcp-observation-malformed');
      p.demand(!(parseInt(f[1].split(':').at(-1), 16) === 6000 + displayNumber && f[3] === '0A'), 'x-tcp-listener-present');
    }
  }
  return { checkedIpv4: true, checkedIpv6: true, port: 6000 + displayNumber, listening: false };
}
export async function preflight(options, env = process.env, budget = createBudget(), adapter = PREFLIGHT_HOST) {
  let operation = 'preflight-host';
  try {
    const host = adapter.host(), here = adapter.here;
    p.assertEnvironment(env, host.uid, host.platform, host.arch); p.assertGithub(env, options.commit); p.assertNode(host.nodeVersion);
    operation = 'preflight-event';
    const event = p.pushTransition(JSON.parse(await adapter.readBounded(env.GITHUB_EVENT_PATH, p.LIMIT.eventBytes, budget)), options.commit);
    operation = 'preflight-os';
    p.assertOs((await adapter.readBounded(await budget.wait(adapter.realpath('/etc/os-release')), 16384, budget)).toString('utf8'));
    operation = 'preflight-location';
    const root = resolve(here, '../../..'); p.demand(here === join(root, p.DESTINATION) && await budget.wait(adapter.realpath(root)) === root, 'qualified-source-location');
    operation = 'preflight-manifest';
    const manifestBytes = await adapter.readBounded(join(here, 'SOURCE-MANIFEST.json'), p.LIMIT.config, budget);
    p.demand(p.sha256(manifestBytes) === options.manifest, 'source-manifest-hash-mismatch'); const manifest = p.sourceManifest(manifestBytes);
    operation = 'preflight-sources';
    for (const file of manifest.files) { const bytes = await adapter.readBounded(join(here, file.path), p.LIMIT.sourceFile, budget); p.demand(bytes.length === file.bytes && p.sha256(bytes) === file.sha256, 'source-file-mismatch'); }
    operation = 'preflight-packages';
    for (const [name, hash] of Object.entries(p.PACKAGES)) p.demand(p.sha256(await adapter.readBounded(join(root, name), 1048576, budget)) === hash, 'package-lock-or-metadata-mismatch');
    operation = 'preflight-workflow';
    const actualWorkflow = await adapter.readBounded(join(root, p.WORKFLOW), p.LIMIT.sourceFile, budget), proposedWorkflow = await adapter.readBounded(join(here, 'workflow.proposed.yml'), p.LIMIT.sourceFile, budget);
    p.demand(actualWorkflow.equals(proposedWorkflow), 'published-workflow-differs');
    operation = 'preflight-tools';
    const tools = [];
    for (const entry of p.TOOLS) {
      const resolved = await budget.wait(adapter.realpath(entry)), row = await adapter.hashFile(resolved, 536870912, budget);
      p.demand(row.uid === 0 && (row.mode & 0o022) === 0 && (row.mode & 0o111) !== 0, 'preinstalled-display-tool-unavailable');
      tools.push({ entry, resolved, ...row });
    }
    operation = 'preflight-kernel-settings';
    const kernelSettings = {};
    for (const [name, file] of [['unprivilegedUsernsClone', '/proc/sys/kernel/unprivileged_userns_clone'], ['apparmorRestrictUnprivilegedUserns', '/proc/sys/kernel/apparmor_restrict_unprivileged_userns'], ['maxUserNamespaces', '/proc/sys/user/max_user_namespaces']]) {
      try { const value = (await budget.wait(adapter.readFile(file, { encoding: 'utf8', ...signalOptions(budget.signal) }))).trim(); p.demand(/^\d+$/.test(value), 'kernel-value-unavailable'); kernelSettings[name] = value; }
      catch (error) { if (error.code === 'ENOENT') kernelSettings[name] = 'absent'; else throw error; }
    }
    operation = 'preflight-runner-temp';
    p.demand(typeof env.RUNNER_TEMP === 'string' && await budget.wait(adapter.realpath(env.RUNNER_TEMP)) === env.RUNNER_TEMP, 'runner-temp-unavailable');
    operation = 'preflight-node';
    return { root, manifest, report: { version: 1, status: 'preflight-qualified', sourceCommit: options.commit, sourceManifestSha256: options.manifest,
      workflowSha256: p.sha256(actualWorkflow), packages: p.PACKAGES, tools, kernelSettings, node: { version: host.nodeVersion, executable: await budget.wait(adapter.realpath(host.execPath)), ...await adapter.hashFile(await budget.wait(adapter.realpath(host.execPath)), 536870912, budget) },
      host: { platform: host.platform, arch: host.arch, uid: host.uid, kernel: host.kernel, cpuModel: host.cpuModel, logicalCpus: host.logicalCpus, memoryBytes: host.memoryBytes },
      github: { transition: event, runnerEnvironment: env.RUNNER_ENVIRONMENT, runnerOS: env.RUNNER_OS, runnerArch: env.RUNNER_ARCH, repository: p.REPO, ref: p.BRANCH, event: 'push', runId: env.GITHUB_RUN_ID, runAttempt: 1, imageOS: env.ImageOS, imageVersion: env.ImageVersion },
      boundary: { applicationStarted: false, simulationStarted: false, timingStarted: false, artifactUpload: false, osChanges: false } } };
  } catch (error) { throw p.annotateFailure(error, operation); }
}

function summary(result) { return { code: result.code, signal: result.signal, reason: result.reason, launchError: result.launchError, exitConfirmed: result.exitConfirmed, closeConfirmed: result.closeConfirmed, outputBytes: result.outputBytes,
  stdoutSha256: p.sha256(Buffer.from(result.stdout)), stderrSha256: p.sha256(Buffer.from(result.stderr)), cleanup: result.cleanup }; }
async function absent(file) { try { await lstat(file); return false; } catch (error) { if (error.code === 'ENOENT') return true; throw error; } }
async function removeAuthority(file) { if (!file) return { created: false, removed: true }; try { await unlink(file); } catch (error) { if (error.code !== 'ENOENT') return { created: true, removed: false }; } return { created: true, removed: await absent(file) }; }

// Readiness is filesystem/liveness polling only. No client connection is retried.
export async function waitForOwnedDisplaySocket(number, owner, budget, io = { lstat, sleep, uid: process.getuid?.() }) {
  p.demand(Number.isInteger(number) && number >= 100 && number < 500 && owner && typeof owner.isRunning === 'function', 'owned-display-input');
  const path = `/tmp/.X11-unix/X${number}`;
  for (let polls = 1; polls <= 20; polls++) {
    budget.check(); p.demand(owner.isRunning() === true, 'owned-display-not-live');
    try {
      const st = await budget.wait(io.lstat(path));
      p.demand(st.isSocket() && !st.isSymbolicLink() && st.uid === io.uid, 'owned-display-socket-mismatch');
      p.demand(owner.isRunning() === true, 'owned-display-not-live');
      return { path, polls, dev: st.dev, ino: st.ino, uid: st.uid, mode: st.mode & 0o7777 };
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (polls < 20) await budget.wait(io.sleep(100));
  }
  throw new Error('owned-display-socket-unavailable');
}

export async function qualify(options) {
  const startedAt = new Date().toISOString(), owned = [], report = { version: 1, status: 'unavailable', startedAt, reason: null, preflight: null, display: null, native: null, cleanup: [], screenshot: null };
  const controller = new AbortController(), budget = createBudget({ signal: controller.signal });
  let unexpectedDisplayExit = false, deliberateCleanup = false;
  let dir = null, auth = null, timer = null, aborted = null, runtimeRoot = null, inventoryBefore = null;
  const stop = reason => { aborted ||= reason; controller.abort(); for (const item of owned) void item.close(reason); };
  const onInt = () => stop('qualification-interrupted'), onTerm = () => stop('qualification-interrupted');
  process.once('SIGINT', onInt); process.once('SIGTERM', onTerm);
  const guard = () => { p.demand(!aborted, aborted || 'qualification-aborted'); budget.check(); };
  let picture = null, operation = 'qualification-preflight';
  try {
    timer = setTimeout(() => stop('qualification-timeout'), p.LIMIT.totalMs);
    const pre = await preflight(options, process.env, budget); report.preflight = pre.report; guard();
    operation = 'runtime-inventory';
    runtimeRoot = join(pre.root, 'node_modules/electron/dist'); p.demand(await budget.wait(realpath(runtimeRoot)) === runtimeRoot, 'electron-runtime-alias');
    const executable = join(runtimeRoot, 'electron'); inventoryBefore = await runtimeInventory(runtimeRoot, budget); guard();
    p.demand(inventoryBefore.some(f => f.path === 'electron' && (f.mode & 0o111) !== 0), 'electron-executable-unavailable');
    report.runtime = { expectedElectron: '44.7.0', files: inventoryBefore, inventorySha256: p.sha256(Buffer.from(JSON.stringify(inventoryBefore))) };
    operation = 'temporary-files';
    dir = await mkdtemp(join(process.env.RUNNER_TEMP, 'aincrad-hosted-qualification-')); await fs.promises.chmod(dir, 0o700);
    const codeRoot = join(dir, 'code'), profile = join(dir, 'profile'), runtimeDir = join(dir, 'runtime');
    for (const file of [codeRoot, profile, runtimeDir]) await mkdir(file, { mode: 0o700 });
    const code = [];
    for (const name of p.RUNTIME_FILES) { const descriptor = pre.manifest.files.find(d => d.path === name); await writeFile(join(codeRoot, name), p.realFile(join(HERE, name)), { flag: 'wx', mode: 0o400 }); code.push(descriptor); }
    p.verifyCode(codeRoot, code); guard();
    let number = null;
    for (let i = 0; i < 32; i++) { const n = randomInt(100, 500); if (await absent(`/tmp/.X${n}-lock`) && await absent(`/tmp/.X11-unix/X${n}`)) { number = n; break; } }
    p.demand(number !== null, 'unoccupied-display-unavailable');
    auth = join(dir, 'Xauthority');
    await writeFile(auth, '', { flag: 'wx', mode: 0o600 });
    const env = { PATH: '/usr/bin:/bin', HOME: dir, TMPDIR: dir, XDG_RUNTIME_DIR: runtimeDir, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', DISPLAY: `:${number}`, XAUTHORITY: auth };
    const cookie = randomBytes(16).toString('hex');
    operation = 'display-authority';
    const xauth = await checkedCommand('/usr/bin/xauth', ['-q', '-f', auth], { env, input: `add :${number} MIT-MAGIC-COOKIE-1 ${cookie}\n`, deadlineMs: 3000 }, owned);
    p.demand(successful(xauth), 'xauthority-setup-unavailable'); guard();
    const args = [`:${number}`, '-screen', '0', '1440x900x24', '-dpi', '96', '-auth', auth, '-nolisten', 'tcp', '-noreset'];
    guard();
    operation = 'display-start';
    const display = ownedProcess('/usr/bin/Xvfb', args, { env, deadlineMs: 35000 }); owned.push(display);
    display.child?.once('exit', () => { if (!deliberateCleanup) unexpectedDisplayExit = true; });
    operation = 'display-admission';
    report.display = { backend: 'preinstalled-Xvfb', displayNumber: number,
      args: args.map(a => a === auth ? '[private-authority]' : a), readiness: null, setup: null };
    const readiness = await waitForOwnedDisplaySocket(number, display, budget); report.display.readiness = readiness;
    const secret = Buffer.from(cookie, 'hex');
    try { report.display.setup = await probeX11Setup({ displayNumber: number, socketPath: readiness.path, cookie: secret, ownedServer: display, signal: controller.signal }); }
    finally { secret.fill(0); }
    p.demand(report.display.setup.status === 'qualified', 'x-display-setup-unavailable'); guard();
    const socketAfter = await budget.wait(lstat(readiness.path));
    p.demand(socketAfter.isSocket() && !socketAfter.isSymbolicLink() && socketAfter.dev === readiness.dev && socketAfter.ino === readiness.ino && socketAfter.uid === readiness.uid, 'owned-display-socket-changed');
    const tcp = assertNoTcpListener(await readFile('/proc/net/tcp', 'utf8'), await readFile('/proc/net/tcp6', 'utf8'), number);
    Object.assign(report.display, { width: report.display.setup.width, height: report.display.setup.height, tcp,
      authMode: (await lstat(auth)).mode & 0o777, cookieFreeDenied: true, xauth: summary(xauth) });
    p.demand(report.display.authMode === 0o600, 'authority-mode-unavailable');
    const config = { version: 1, codeRoot, profile, result: join(dir, 'native-result.json'), capture: join(dir, 'capture.png'), code, expectedElectron: '44.7.0' };
    const configPath = join(dir, 'config.json'); await writeFile(configPath, `${JSON.stringify(config)}\n`, { flag: 'wx', mode: 0o400 });
    operation = 'native-launch';
    guard(); const electron = await checkedCommand(executable, [join(codeRoot, 'electron-main.cjs'), `--qualification-config=${configPath}`, '--ozone-platform=x11', '--disable-gpu'], { env, deadlineMs: p.LIMIT.electronMs }, owned);
    operation = 'native-evidence';
    report.electronProcess = summary(electron);
    if (await absent(config.result)) throw new Error('native-result-unavailable');
    const nativeBytes = p.realFile(config.result, p.LIMIT.json); report.native = JSON.parse(nativeBytes); report.nativeSha256 = p.sha256(nativeBytes);
    p.demand(successful(electron) && report.native.version === 1 && report.native.status === 'qualified' && report.native.applicationStarted === false && report.native.simulationStarted === false && report.native.timingStarted === false, 'native-qualification-unavailable');
    p.validatePage(report.native.page); p.validateSandbox({ preload: report.native.preload, ...report.native.sandbox });
    picture = p.realFile(config.capture, p.LIMIT.png); const encoded = p.encodeScreenshot(picture);
    p.demand(encoded.sha256 === report.native.capture.pngSha256, 'screenshot-hash-mismatch');
    report.screenshot = { bytes: encoded.bytes, sha256: encoded.sha256, width: 1440, height: 900, encoding: 'base64-in-numbered-log-lines' };
    guard(); p.demand(display.isRunning(), 'display-exited-during-qualification');
    operation = 'post-preflight';
    const post = await preflight(options, process.env, budget); p.demand(JSON.stringify(post.report.tools) === JSON.stringify(pre.report.tools) && post.report.sourceManifestSha256 === pre.report.sourceManifestSha256 && post.report.workflowSha256 === pre.report.workflowSha256 && JSON.stringify(post.report.node) === JSON.stringify(pre.report.node), 'prerequisites-changed-during-qualification');
    p.verifyCode(codeRoot, code); guard(); p.demand(display.isRunning() && !unexpectedDisplayExit, 'display-exited-during-qualification'); report.status = 'qualified';
  } catch (error) { report.reason = 'qualification-prerequisite-or-evidence-unavailable'; report.diagnostic = p.diagnostic(error, operation); report.status = 'unavailable'; }
  finally {
    // The original deadline remains active through the post-cleanup runtime inventory.
    // Only owned-group and cookie cleanup get a separate bounded five-second tail.
    deliberateCleanup = true;
    const cleanupBudget = createBudget({ deadlineAt: Date.now() + p.LIMIT.cleanupMs });
    try {
      report.cleanup = await cleanupBudget.wait(Promise.all([...owned].reverse().map(child => child.close())));
      report.authorityCleanup = { normal: await cleanupBudget.wait(removeAuthority(auth)) };
      if (report.cleanup.some(c => !c.groupGone || !c.exited) || !report.authorityCleanup.normal.removed) throw new Error('owned-cleanup-unavailable');
    } catch (error) { report.status = 'unavailable'; report.reason ||= 'owned-cleanup-unavailable'; report.cleanupDiagnostic = p.diagnostic(error, 'owned-cleanup'); }
    if (runtimeRoot && inventoryBefore) {
      try { const after = await runtimeInventory(runtimeRoot, budget); report.runtime.unchangedAfter = JSON.stringify(after) === JSON.stringify(inventoryBefore); if (!report.runtime.unchangedAfter) throw new Error(); }
      catch (error) { report.status = 'unavailable'; report.reason ||= 'runtime-verification-unavailable'; report.postVerificationDiagnostic = p.diagnostic(error, 'runtime-post-verification'); }
    }
    if (unexpectedDisplayExit) { report.status = 'unavailable'; report.reason ||= 'display-exited-during-qualification'; }
    if (aborted) { report.status = 'unavailable'; report.reason ||= aborted; }
    try { budget.check(); } catch (error) { report.status = 'unavailable'; report.reason ||= 'qualification-deadline-or-budget-unavailable'; report.deadlineDiagnostic = p.diagnostic(error, 'qualification-deadline'); }
    clearTimeout(timer); process.off('SIGINT', onInt); process.off('SIGTERM', onTerm);
    report.inventoryBudget = { ...budget.used, maxEntries: 4096, maxBytes: 2147483648, maxDepth: 12, deadlineMs: p.LIMIT.totalMs, cleanupTailMs: p.LIMIT.cleanupMs };
    report.finishedAt = new Date().toISOString();
  }
  const resultBytes = Buffer.from(JSON.stringify(report));
  if (resultBytes.length > p.LIMIT.json) return { report: { version: 1, status: 'unavailable', reason: 'report-limit', originalBytes: resultBytes.length, originalSha256: p.sha256(resultBytes) }, picture: null };
  return { report, picture: report.status === 'qualified' ? picture : null };
}
export function logResult(report, picture, write = text => process.stdout.write(text)) {
  const bytes = Buffer.from(JSON.stringify(report)); p.demand(bytes.length <= p.LIMIT.json, 'report-log-limit');
  write(`QUALIFICATION_REPORT ${bytes.toString('utf8')}\n`);
  if (picture) { const encoded = p.encodeScreenshot(picture); write(`QUALIFICATION_PNG_MANIFEST ${JSON.stringify({ bytes: encoded.bytes, sha256: encoded.sha256, chunks: encoded.chunks.length, encoding: encoded.encoding })}\n`);
    encoded.chunks.forEach((chunk, index) => write(`QUALIFICATION_PNG ${index + 1}/${encoded.chunks.length} ${chunk}\n`)); }
}

// Shared standalone entry path: tests exercise this exact parser, preflight,
// failure formatting and logging route without launching a child process.
export async function runEntry(args, { env = process.env, budget, adapter = PREFLIGHT_HOST, write = text => process.stdout.write(text) } = {}) {
  let report, picture = null;
  try {
    const options = parseArguments(args);
    if (options.mode === '--preflight') report = (await preflight(options, env, budget, adapter)).report;
    else {
      p.demand(adapter === PREFLIGHT_HOST && env === process.env && budget === undefined, 'fixture-adapter-preflight-only');
      ({ report, picture } = await qualify(options));
    }
  } catch (error) { report = { version: 1, status: 'unavailable', reason: 'preflight-unavailable', diagnostic: p.diagnostic(error, 'entry'), nativeStarted: false }; }
  logResult(report, picture, write);
  return { report, exitCode: ['qualified', 'preflight-qualified'].includes(report.status) ? 0 : 1 };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = (await runEntry(process.argv.slice(2))).exitCode;
}
