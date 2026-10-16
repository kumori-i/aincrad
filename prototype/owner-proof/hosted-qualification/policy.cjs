'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const VERSION = 1;
const REPO = 'kumori-i/aincrad';
const EXPECTED_BEFORE = '184064bb125fc103efe474779bcae949d5ab5d69';
const BRANCH = 'refs/heads/proof/owner-hosted-qualification-v2';
const DESTINATION = 'prototype/owner-proof/hosted-qualification';
const WORKFLOW = '.github/workflows/owner-hosted-qualification.yml';
const ORIGIN = 'qualification://app';
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; worker-src 'none'; child-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const SOURCE_FILES = Object.freeze(['README.md', 'policy.cjs', 'supervisor.mjs', 'bounded-io.mjs', 'qualify.mjs', 'electron-main.cjs', 'preload.cjs', 'page.html', 'page.js', 'page.css', 'qualification.test.mjs']);
const RUNTIME_FILES = Object.freeze(['policy.cjs', 'electron-main.cjs', 'preload.cjs', 'page.html', 'page.js', 'page.css']);
const ASSETS = Object.freeze(['page.html', 'page.js', 'page.css', 'probe.json', 'probe-worker.js']);
const TOOLS = Object.freeze(['/usr/bin/Xvfb', '/usr/bin/xauth', '/usr/bin/xdpyinfo']);
const PACKAGES = Object.freeze({ 'package.json': 'b718e97c0bbec952d54f7415842f3cba79cf1b932e6ab209ddec2c386a104757', 'package-lock.json': '2161fd575eb609e16bd67b38862425df95dff7490f12ce03739f432a648125e7' });
const LIMIT = Object.freeze({ json: 131072, png: 65536, config: 16384, sourceFile: 262144, childOutput: 262144, electronMs: 20000, totalMs: 45000, cleanupMs: 5000, eventBytes: 1048576, capturePixels: 1440 * 900 });
const BAD_ENV = Object.freeze(['NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE', 'ELECTRON_DISABLE_SANDBOX', 'CHROME_DEVEL_SANDBOX', 'ELECTRON_EXTRA_LAUNCH_ARGS', 'LD_PRELOAD', 'LD_LIBRARY_PATH']);
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function demand(ok, reason) { if (!ok) throw new Error(reason); }
// Diagnostics deliberately never copy an error message, stack, path or arbitrary property.
const DIAGNOSTIC_OPERATIONS = Object.freeze(['entry', 'preflight-host', 'preflight-event', 'preflight-os', 'preflight-location', 'preflight-manifest', 'preflight-sources', 'preflight-packages', 'preflight-workflow', 'preflight-tools', 'preflight-kernel-settings', 'preflight-runner-temp', 'preflight-node', 'qualification-preflight', 'runtime-inventory', 'temporary-files', 'display-authority', 'display-start', 'display-admission', 'native-launch', 'native-evidence', 'post-preflight', 'owned-cleanup', 'runtime-post-verification', 'qualification-deadline']);
const DIAGNOSTIC_NAMES = Object.freeze(['Error', 'TypeError', 'RangeError', 'SyntaxError', 'AbortError']);
const DIAGNOSTIC_CODES = Object.freeze(['ENOENT', 'EACCES', 'EPERM', 'EIO', 'EISDIR', 'ENOTDIR', 'EMFILE', 'ENFILE', 'ELOOP', 'ENOSPC', 'EINVAL', 'ERR_INVALID_ARG_TYPE', 'ERR_OUT_OF_RANGE', 'ABORT_ERR']);
const annotatedFailures = new WeakMap();
function diagnosticProperty(error, key) {
  try { const value = error?.[key]; return typeof value === 'string' || value === undefined ? value : null; }
  catch { return null; }
}
function diagnostic(error, operation = 'entry') {
  if (error && typeof error === 'object' && annotatedFailures.has(error)) return { ...annotatedFailures.get(error) };
  // Snapshot each accessor once, guard failures, and retain primitive values only.
  const name = diagnosticProperty(error, 'name'), code = diagnosticProperty(error, 'code');
  return { operation: DIAGNOSTIC_OPERATIONS.includes(operation) ? operation : 'entry',
    errorName: DIAGNOSTIC_NAMES.includes(name) ? name : 'OtherError',
    errorCode: code === undefined ? 'NONE' : DIAGNOSTIC_CODES.includes(code) ? code : 'OTHER' };
}
function annotateFailure(error, operation) {
  const wrapper = new Error('qualification-operation-failed');
  annotatedFailures.set(wrapper, Object.freeze(diagnostic(error, operation))); return wrapper;
}
function exact(value, names, label) { demand(value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).sort().join('|') === [...names].sort().join('|'), `${label}-shape`); }
function badArg(arg) { return /^--(?:no-sandbox|disable-sandbox|disable-setuid-sandbox|disable-gpu-sandbox|disable-seccomp-filter-sandbox|disable-namespace-sandbox|disable-web-security|no-zygote|single-process|in-process-gpu|allow-file-access-from-files|ignore-certificate-errors|remote-debugging[^=]*|headless)(?:=|$)/.test(arg) || /^--ozone-platform=(?!x11$)/.test(arg) || /^--force-device-scale-factor(?:=|$)/.test(arg); }
function assertEnvironment(env, uid, platform, arch) {
  demand(platform === 'linux' && arch === 'x64' && Number.isInteger(uid) && uid > 0, 'nonroot-linux-x64-required');
  for (const name of BAD_ENV) demand(!env[name], 'unsupported-environment-override');
}
function assertGithub(env, expectedCommit) {
  demand(env.GITHUB_ACTIONS === 'true' && env.GITHUB_REPOSITORY === REPO && env.GITHUB_EVENT_NAME === 'push' && env.GITHUB_REF === BRANCH && env.GITHUB_RUN_ATTEMPT === '1', 'github-scope-or-attempt-mismatch');
  demand(/^[a-f0-9]{40}$/.test(expectedCommit || '') && env.GITHUB_SHA === expectedCommit, 'github-commit-mismatch');
  demand(env.RUNNER_ENVIRONMENT === 'github-hosted' && env.RUNNER_OS === 'Linux' && env.RUNNER_ARCH === 'X64', 'github-hosted-runner-required');
  demand(/^\d+$/.test(env.GITHUB_RUN_ID || '') && env.ImageOS === 'ubuntu22' && /^[A-Za-z0-9_.-]{1,100}$/.test(env.ImageVersion || ''), 'github-image-identity-missing');
}
function pushTransition(value, expectedCommit) {
  demand(value && typeof value === 'object' && !Array.isArray(value), 'push-event-shape');
  demand(value.before === EXPECTED_BEFORE && value.after === expectedCommit && /^[a-f0-9]{40}$/.test(expectedCommit || '') && value.before !== value.after, 'push-transition-mismatch');
  demand(value.ref === BRANCH && value.created === false && value.deleted === false && value.forced === false, 'push-transition-mode');
  demand(value.repository?.full_name === REPO && value.repository.private === false, 'push-event-repository');
  // Return only approved fields, never the event payload or commit descriptions.
  return { before: value.before, after: value.after, ref: value.ref, created: false, deleted: false, forced: false, repository: { full_name: REPO, private: false } };
}
function namespacePids(value) {
  demand(typeof value === 'string' && value.length <= 351 && /^[1-9][0-9]{0,9}(?:[ \t]+[1-9][0-9]{0,9}){0,31}$/.test(value), 'namespace-pids-unavailable');
  const values = value.split(/[ \t]+/).map(Number);
  demand(values.every(n => Number.isSafeInteger(n) && n <= 2147483647), 'namespace-pids-unavailable'); return values;
}
function assertOs(text) { demand(/^ID=ubuntu$/m.test(text) && /^VERSION_ID="22\.04"$/m.test(text), 'ubuntu-22-04-required'); }
function assertNode(version) { const m = /^v(\d+)\.(\d+)\.(\d+)$/.exec(version); demand(m && +m[1] === 22 && +m[2] >= 12, 'preinstalled-node-22-12-or-later-required'); }
function sourceManifest(bytes) {
  demand(bytes.length <= LIMIT.config, 'source-manifest-size');
  const value = JSON.parse(bytes);
  exact(value, ['version', 'destination', 'files', 'packages'], 'source-manifest');
  demand(value.version === VERSION && value.destination === DESTINATION && JSON.stringify(value.packages) === JSON.stringify(PACKAGES), 'source-manifest-identity');
  demand(Array.isArray(value.files) && value.files.length === SOURCE_FILES.length && value.files.map(x => x.path).join('|') === SOURCE_FILES.join('|'), 'source-census');
  for (const item of value.files) { exact(item, ['path', 'bytes', 'sha256'], 'source'); demand(Number.isSafeInteger(item.bytes) && item.bytes > 0 && item.bytes <= LIMIT.sourceFile && digest(item.sha256), 'source-descriptor'); }
  return value;
}
function realFile(file, maxBytes = LIMIT.sourceFile, io = fs) {
  demand(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= 1048576, 'file-read-limit');
  demand(path.isAbsolute(file) && io.realpathSync(file) === file, 'file-path-alias');
  const st = io.lstatSync(file); demand(st.isFile() && !st.isSymbolicLink() && st.size > 0 && st.size <= maxBytes, 'file-type-or-size');
  const fd = io.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const actual = io.fstatSync(fd); demand(actual.dev === st.dev && actual.ino === st.ino && actual.size === st.size && actual.mtimeMs === st.mtimeMs, 'file-race');
    const buffer = Buffer.alloc(st.size + 1); let count = 0;
    while (count < buffer.length) { const n = io.readSync(fd, buffer, count, buffer.length - count, count); if (!n) break; count += n; }
    const after = io.fstatSync(fd);
    demand(count === st.size && after.size === st.size && after.ino === st.ino && after.dev === st.dev && after.mtimeMs === st.mtimeMs, 'file-changed-during-read');
    return buffer.subarray(0, count);
  } finally { io.closeSync(fd); }
}
function verifyCode(root, descriptors) {
  demand(fs.realpathSync(root) === root, 'code-root-alias');
  for (const item of descriptors) { demand(RUNTIME_FILES.includes(item.path), 'untrusted-code-member'); const bytes = realFile(path.join(root, item.path)); demand(bytes.length === item.bytes && sha256(bytes) === item.sha256, 'code-hash-mismatch'); }
  demand(descriptors.length === RUNTIME_FILES.length && new Set(descriptors.map(d => d.path)).size === RUNTIME_FILES.length, 'code-census');
}
function parseStatus(text) {
  const fields = {};
  for (const key of ['Pid', 'PPid', 'Uid', 'Gid', 'NSpid', 'NoNewPrivs', 'Seccomp', 'Seccomp_filters', 'CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb']) {
    const found = new RegExp(`^${key}:\\s*([^\\n]+)$`, 'm').exec(text); fields[key] = found ? found[1].trim() : null;
  }
  for (const key of ['Pid', 'PPid', 'NoNewPrivs', 'Seccomp']) demand(/^\d+$/.test(fields[key] || ''), 'proc-status-missing');
  demand(/^\d+(?:\s+\d+){3}$/.test(fields.Uid || '') && /^\d+(?:\s+\d+){3}$/.test(fields.Gid || ''), 'proc-identity-missing');
  for (const key of ['CapPrm', 'CapEff', 'CapAmb']) demand(/^[a-fA-F0-9]+$/.test(fields[key] || ''), 'proc-capabilities-missing');
  return fields;
}
function validateNamespace(value, kind) { demand(new RegExp(`^${kind}:\\[\\d+\\]$`).test(value || ''), 'namespace-unavailable'); }
function validateSandbox({ preload, renderer, main }) {
  exact(preload, ['sandboxed', 'contextIsolated', 'type', 'pid'], 'preload');
  demand(preload.sandboxed === true && preload.contextIsolated === true && preload.type === 'renderer' && Number.isSafeInteger(preload.pid) && preload.pid > 0, 'preload-sandbox-unavailable');
  demand(Number(renderer.status.Pid) === renderer.pid && renderer.pid !== main.pid && Number(main.status.Pid) === main.pid, 'renderer-pid-mismatch');
  const pids = namespacePids(renderer.status.NSpid);
  demand(pids.length >= 2 && pids[0] === renderer.pid && pids.at(-1) === preload.pid, 'preload-renderer-pid-mismatch');
  demand(renderer.status.Uid.split(/\s+/).every(v => +v > 0) && main.status.Uid.split(/\s+/).every(v => +v > 0), 'root-process-unavailable');
  demand(renderer.status.Seccomp === '2' && renderer.status.NoNewPrivs === '1', 'renderer-seccomp-unavailable');
  for (const key of ['CapPrm', 'CapEff', 'CapAmb']) demand(/^0+$/.test(renderer.status[key]), 'renderer-capabilities-unavailable');
  demand(renderer.argv.includes('--type=renderer') && !renderer.argv.some(badArg) && !main.argv.some(badArg), 'renderer-argv-unavailable');
  for (const kind of ['user', 'pid', 'net']) {
    validateNamespace(renderer.namespaces[kind], kind); validateNamespace(main.namespaces[kind], kind);
    demand(renderer.namespaces[kind] !== main.namespaces[kind], `renderer-${kind}-namespace-unavailable`);
  }
  demand(renderer.startIdentityBefore === renderer.startIdentityAfter && renderer.startIdentityBefore, 'renderer-identity-changed');
  demand(renderer.executable === main.executable && path.isAbsolute(renderer.executable), 'renderer-executable-mismatch');
  return true;
}
function dimensions(text) { const m = /dimensions:\s+(\d+)x(\d+) pixels/.exec(text); demand(m && +m[1] === 1440 && +m[2] === 900, 'display-dimensions-unavailable'); return { width: 1440, height: 900 }; }
function cookieDenial(result) { return Number.isInteger(result.code) && result.code !== 0 && !result.signal && !result.reason && /Authorization required|Invalid MIT-MAGIC-COOKIE|No protocol specified/i.test(result.stderr); }
function asset(url) { for (const name of ASSETS) if (url === `${ORIGIN}/${name}`) return name; return null; }
function validatePage(value) {
  exact(value, ['width', 'height', 'dpr', 'canvasWidth', 'canvasHeight', 'canvasRectWidth', 'canvasRectHeight', 'nodeAbsent', 'violations', 'probeOutcomes', 'rafCount'], 'page');
  demand(value.width === 1440 && value.height === 900 && value.dpr === 1 && value.canvasWidth === 1440 && value.canvasHeight === 900 && value.canvasRectWidth === 1440 && value.canvasRectHeight === 900, 'page-viewport-unavailable');
  demand(value.nodeAbsent === true && Number.isInteger(value.rafCount) && value.rafCount >= 2 && value.rafCount <= 4, 'page-node-or-draw-unavailable');
  exact(value.probeOutcomes, ['evalDenied', 'inlineDidNotExecute', 'fetchDenied', 'workerDenied'], 'probe-outcomes');
  demand(Object.values(value.probeOutcomes).every(v => v === true), 'csp-probe-executed');
  demand(Array.isArray(value.violations) && value.violations.length >= 4 && value.violations.length <= 16, 'csp-evidence-missing');
  for (const e of value.violations) { exact(e, ['effectiveDirective', 'blockedURI', 'originalPolicy', 'disposition'], 'violation'); demand(e.originalPolicy === CSP && e.disposition === 'enforce', 'csp-policy-mismatch'); }
  const required = [['script-src', 'eval'], ['script-src-elem', 'inline'], ['connect-src', `${ORIGIN}/probe.json`], ['worker-src', `${ORIGIN}/probe-worker.js`]];
  for (const [directive, uri] of required) demand(value.violations.some(e => e.effectiveDirective === directive && e.blockedURI === uri), 'csp-exact-denial-missing');
  return true;
}
const PIXELS = Object.freeze([{ x: 8, y: 8, rgb: [231, 76, 60] }, { x: 1432, y: 8, rgb: [46, 204, 113] }, { x: 8, y: 892, rgb: [52, 152, 219] }, { x: 1432, y: 892, rgb: [241, 196, 15] }, { x: 720, y: 450, rgb: [155, 89, 182] }]);
function analyzeBitmap(bytes, width, height) {
  demand(width === 1440 && height === 900 && Buffer.isBuffer(bytes) && bytes.length === LIMIT.capturePixels * 4, 'capture-raster-unavailable');
  for (const { x, y, rgb } of PIXELS) { const p = (y * width + x) * 4; demand(bytes[p] === rgb[2] && bytes[p + 1] === rgb[1] && bytes[p + 2] === rgb[0] && bytes[p + 3] === 255, 'capture-pixel-mismatch'); }
  return { width, height, bytes: bytes.length, sampledKnownPixels: PIXELS.length, nonblank: true, format: 'BGRA' };
}
function validateConfig(value) {
  exact(value, ['version', 'codeRoot', 'profile', 'result', 'capture', 'code', 'expectedElectron'], 'native-config');
  demand(value.version === 1 && value.expectedElectron === '44.7.0', 'native-version');
  for (const k of ['codeRoot', 'profile', 'result', 'capture']) demand(typeof value[k] === 'string' && path.isAbsolute(value[k]) && path.resolve(value[k]) === value[k], 'native-path');
  demand(path.dirname(value.result) === path.dirname(value.capture) && value.result === path.join(path.dirname(value.result), 'native-result.json') && value.capture === path.join(path.dirname(value.result), 'capture.png'), 'native-output');
  demand(path.dirname(value.profile) === path.dirname(value.result) && path.basename(value.profile) === 'profile' && path.dirname(value.codeRoot) === path.dirname(value.result) && path.basename(value.codeRoot) === 'code', 'native-layout');
  demand(Array.isArray(value.code), 'native-code'); verifyCode(value.codeRoot, value.code); return value;
}
function encodeScreenshot(bytes) {
  demand(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= LIMIT.png && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'png-size-or-type');
  const base64 = bytes.toString('base64'), chunks = [];
  for (let i = 0; i < base64.length; i += 6144) chunks.push(base64.slice(i, i + 6144));
  return { bytes: bytes.length, sha256: sha256(bytes), encoding: 'base64', chunks };
}
module.exports = { VERSION, REPO, BRANCH, EXPECTED_BEFORE, DESTINATION, WORKFLOW, ORIGIN, CSP, SOURCE_FILES, RUNTIME_FILES, ASSETS, TOOLS, PACKAGES, LIMIT, BAD_ENV, PIXELS,
  DIAGNOSTIC_OPERATIONS, DIAGNOSTIC_NAMES, DIAGNOSTIC_CODES, diagnostic, annotateFailure, sha256, digest, demand, exact, badArg, assertEnvironment, assertGithub, pushTransition, namespacePids, assertOs, assertNode, sourceManifest, realFile, verifyCode, parseStatus, validateSandbox, dimensions, cookieDenial, asset, validatePage, analyzeBitmap, validateConfig, encodeScreenshot };
