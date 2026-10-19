/** Finite Electron QA actions. Main loads this only in an unpackaged --test
 * launch with explicit, disposable original and recovered profile roots. */
const assert = require('node:assert/strict');
const { createHash, createHmac, randomBytes } = require('node:crypto');
const { constants, realpathSync } = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SAVE_KEY = 'aincrad.save.v1';
const MAX_INPUT = 16 * 1024 * 1024;
const MAX_BACKUP = 24 * 1024 * 1024;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function inside(pathApi, directory, location) {
  const suffix = pathApi.relative(directory, location);
  return suffix === '' || suffix !== '..' && !suffix.startsWith(`..${pathApi.sep}`) &&
    !pathApi.isAbsolute(suffix);
}
function qaPathError(operation, pathClass, stage) {
  // These values are fixed call-site labels. Never include a path, basename,
  // drive, or raw filesystem error in public CI diagnostics.
  const error = new Error(`Native QA ${operation} path rejected (class=${pathClass}; stage=${stage}); ` +
    'a direct disposable scratch file is required.');
  error.qaPathRejection = true;
  return error;
}
function ordinaryRealpath(location, platform) {
  if (platform !== 'win32') return location;
  // Trusted realpath implementations may return a Windows namespace spelling.
  // Caller-supplied namespace paths are rejected below, before any metadata.
  if (/^\\\\\?\\UNC\\/i.test(location)) return `\\\\${location.slice(8)}`;
  if (/^\\\\\?\\[a-z]:\\/i.test(location)) return location.slice(4);
  return location;
}
function canonicalQaPath(location, platform, resolve = realpathSync) {
  // Test profile routing uses realpathSync for the trusted temp root. Keep
  // its spelling through the QA parent and file checks on Windows, where the
  // asynchronous implementation can expand an 8.3 component differently.
  return ordinaryRealpath(resolve(location), platform);
}
function samePath(pathApi, first, second) {
  return pathApi.relative(first, second) === '';
}
function windowsPathClass(location) {
  const backslashes = location.replaceAll('/', '\\');
  if (/^\\\\[?.]\\/.test(backslashes)) return 'namespace';
  if (backslashes.startsWith('\\\\')) return 'unc';
  return null;
}
function windowsQaParentDiagnostic({ candidate, temporary, syncTemp, physicalTemp,
  scratch, rebasedParent, routeTempRoot }, key) {
  const win = path.win32;
  const digest = value => createHmac('sha256', key).update(value).digest('hex').slice(0, 12);
  const parts = value => {
    const normalized = win.normalize(value), root = win.parse(normalized).root;
    return { normalized, root, segments: normalized.slice(root.length).split(win.sep).filter(Boolean) };
  };
  const signature = value => {
    if (typeof value !== 'string' || value.length > 2048) return { available: false };
    const { normalized, root, segments } = parts(value);
    const indices = segments.length <= 12 ? segments.map((_, index) => index) :
      [...Array(6).keys(), ...Array(6).keys()].map((index, position) =>
        position < 6 ? index : segments.length - 6 + index);
    const leaf = segments.at(-1) || '';
    return {
      rootKind: /^\\\\[?.]\\/.test(root) ? 'namespace' :
        root.startsWith('\\\\') ? 'unc' : /^[a-z]:\\$/i.test(root) ? 'drive' : 'other',
      rootId: digest(root.toLowerCase()),
      pathId: digest(normalized), foldedPathId: digest(normalized.toLowerCase()),
      depth: Math.min(segments.length, 255), omitted: segments.length - indices.length,
      leafClass: /^aincrad-recovered-native-[a-z0-9_-]{6,64}$/i.test(leaf) ? 'qa-scratch' : 'other',
      components: indices.map(index => {
        const segment = segments[index];
        return [index, Math.min(segment.length, 255), digest(segment),
          digest(segment.toLowerCase()), /~[0-9](?:\.|$)/.test(segment) ? 1 : 0];
      }),
    };
  };
  const relation = (first, second) => {
    if (typeof first !== 'string' || typeof second !== 'string' ||
        first.length > 2048 || second.length > 2048) return { available: false };
    const a = parts(first), b = parts(second);
    const sameRoot = a.root.toLowerCase() === b.root.toLowerCase();
    const foldedEqual = a.normalized.toLowerCase() === b.normalized.toLowerCase();
    let firstFoldMismatch = sameRoot ? Math.min(a.segments.length, b.segments.length) : -1;
    if (sameRoot) for (let index = 0; index < Math.min(a.segments.length, b.segments.length); index++) {
      if (a.segments[index].toLowerCase() !== b.segments[index].toLowerCase()) {
        firstFoldMismatch = index; break;
      }
    }
    return { sameRoot, exact: a.normalized === b.normalized, foldedEqual,
      firstFoldMismatch: foldedEqual ? null : Math.min(firstFoldMismatch, 255) };
  };
  const suppliedParent = win.dirname(candidate);
  // The harness creates config-N.json directly in aincrad-recovered-native-*.
  // This parent is only a hint for its Node-side temp root, never an authority.
  const hostTempHint = /^aincrad-recovered-native-[a-z0-9_-]{6,64}$/i.test(
    win.basename(suppliedParent)) ? win.dirname(suppliedParent) : null;
  return {
    event: 'native-qa-scratch-parent', version: 1, operation: 'config', stage: 'lexical',
    paths: {
      routeTemp: signature(routeTempRoot), driverTemp: signature(temporary),
      hostTempHint: signature(hostTempHint), syncTemp: signature(syncTemp),
      asyncTemp: signature(physicalTemp), suppliedParent: signature(suppliedParent),
      expectedScratch: signature(scratch), rebasedParent: signature(rebasedParent),
    },
    relations: {
      routeToDriverTemp: relation(routeTempRoot, temporary),
      hostHintToDriverTemp: relation(hostTempHint, temporary),
      syncToAsyncTemp: relation(syncTemp, physicalTemp),
      suppliedToExpectedScratch: relation(suppliedParent, scratch),
      rebasedToExpectedScratch: relation(rebasedParent, scratch),
    },
  };
}
async function resolveQaFile(location, scratch, operation, options = {}) {
  const platform = options.platform || process.platform;
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const fileSystem = options.fileSystem || fs;
  const canonical = value => canonicalQaPath(value, platform, options.syncRealpath || realpathSync);
  const temporary = pathApi.resolve(options.tempDirectory || os.tmpdir());
  if (typeof location !== 'string' || !pathApi.isAbsolute(location))
    throw qaPathError(operation, 'relative', 'lexical');
  if (platform === 'win32') {
    const special = windowsPathClass(location);
    if (special) throw qaPathError(operation, special, 'lexical');
  }
  const candidate = pathApi.resolve(location);
  const trustedScratch = ordinaryRealpath(pathApi.resolve(scratch), platform);
  const lexicalTemp = inside(pathApi, temporary, candidate);
  const lexicalScratch = inside(pathApi, trustedScratch, candidate);
  if (!lexicalTemp && !lexicalScratch) {
    const otherDrive = platform === 'win32' &&
      !samePath(pathApi, pathApi.parse(temporary).root, pathApi.parse(candidate).root);
    throw qaPathError(operation, otherDrive ? 'other-drive' : 'outside-temp', 'lexical');
  }
  const basename = pathApi.basename(candidate);
  if (platform === 'win32' &&
      (basename.includes(':') || /[. ]$/.test(basename) ||
       /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(basename)))
    throw qaPathError(operation, 'special-name', 'lexical');
  let physicalTemp;
  try { physicalTemp = canonical(temporary); }
  catch { throw qaPathError(operation, 'trusted-temp', 'root'); }
  const relative = lexicalTemp ? pathApi.relative(temporary, candidate) :
    pathApi.relative(trustedScratch, candidate);
  const rebased = lexicalTemp ? pathApi.join(physicalTemp, relative) :
    pathApi.join(trustedScratch, relative);
  const parent = pathApi.dirname(rebased);
  if (!samePath(pathApi, parent, trustedScratch)) {
    if (platform === 'win32' && operation === 'config' &&
        /^config-[1-9][0-9]{0,3}\.json$/i.test(basename) &&
        /^aincrad-recovered-native-[a-z0-9_-]{6,64}$/i.test(pathApi.basename(pathApi.dirname(candidate))) &&
        (options.diagnosticSink || process.platform === 'win32')) {
      // Only the fixed OS temp root is read for this diagnostic. Failures here
      // cannot change the existing path rejection or reveal raw filesystem errors.
      try {
        let asyncTemp = null;
        try { asyncTemp = ordinaryRealpath(await fileSystem.realpath(temporary), platform); } catch {}
        const line = JSON.stringify(windowsQaParentDiagnostic({ candidate, temporary,
          syncTemp: physicalTemp, physicalTemp: asyncTemp, scratch: trustedScratch,
          rebasedParent: parent,
          routeTempRoot: options.routeTempRoot }, options.diagnosticKey || randomBytes(32)));
        (options.diagnosticSink || console.error)(`Native QA scratch diagnostic: ${line}`);
      } catch {}
    }
    throw qaPathError(operation, 'parent-mismatch', 'lexical');
  }
  if (!inside(pathApi, physicalTemp, parent))
    throw qaPathError(operation, 'outside-temp', 'physical');
  // A lexical match alone is insufficient on case-sensitive Windows volumes.
  // Check each existing suffix component, then the physical parent identity.
  let cursor = physicalTemp;
  try {
    for (const segment of pathApi.relative(physicalTemp, parent).split(pathApi.sep)) {
      if (!segment) continue;
      cursor = pathApi.join(cursor, segment);
      if ((await fileSystem.lstat(cursor)).isSymbolicLink())
        throw qaPathError(operation, 'symlink-parent', 'physical');
    }
    const physicalParent = canonical(parent);
    const physicalScratch = canonical(scratch);
    if (pathApi.normalize(pathApi.dirname(physicalParent)) !== pathApi.normalize(physicalTemp) ||
        pathApi.normalize(physicalParent) !== pathApi.normalize(physicalScratch))
      throw qaPathError(operation, 'parent-mismatch', 'physical');
  } catch (error) {
    if (error?.qaPathRejection) throw error;
    throw qaPathError(operation, 'unresolved-parent', 'physical');
  }
  return pathApi.join(scratch, basename);
}
async function readFixedFile(location, root, limit, operation = 'input') {
  if (typeof location !== 'string' || !path.isAbsolute(location) ||
      path.dirname(location) !== root)
    throw qaPathError(operation, 'parent-mismatch', 'read');
  let handle;
  try {
    // The scratch parent can change after resolveQaFile. Recheck it before
    // opening a child, and again after reading, against the same canonical
    // temp spelling used by profile routing and resolveQaFile.
    const expectedRoot = path.join(canonicalQaPath(os.tmpdir(), process.platform),
      path.basename(root));
    const rootBefore = await fs.lstat(root);
    if (!rootBefore.isDirectory() || rootBefore.isSymbolicLink() ||
        path.normalize(canonicalQaPath(root, process.platform)) !== path.normalize(expectedRoot))
      throw qaPathError(operation, 'changed-or-alias', 'read');
    const entry = await fs.lstat(location);
    if (!entry.isFile() || entry.isSymbolicLink() || entry.size < 1 || entry.size > limit)
      throw qaPathError(operation, 'unbounded-or-alias', 'read');
    handle = await fs.open(location, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const original = await handle.stat();
    if (!original.isFile() || original.size < 1 || original.size > limit ||
        original.dev !== entry.dev || original.ino !== entry.ino)
      throw qaPathError(operation, 'unbounded-or-alias', 'read');
    const bytes = Buffer.alloc(original.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    const extra = await handle.read(Buffer.alloc(1), 0, 1, bytes.length);
    const after = await handle.stat();
    const physicalFile = canonicalQaPath(location, process.platform);
    const physicalParent = canonicalQaPath(path.dirname(location), process.platform);
    const current = await fs.stat(location);
    const rootAfter = await fs.lstat(root);
    const expectedFile = path.join(physicalParent, path.basename(location));
    const exactParent = path.normalize(path.dirname(physicalFile)) === path.normalize(physicalParent);
    if (offset !== bytes.length || extra.bytesRead !== 0 || after.size !== original.size ||
        !after.isFile() || !current.isFile() || !rootAfter.isDirectory() ||
        rootAfter.isSymbolicLink() || rootAfter.dev !== rootBefore.dev ||
        rootAfter.ino !== rootBefore.ino ||
        after.dev !== original.dev || after.ino !== original.ino ||
        current.dev !== original.dev || current.ino !== original.ino || !exactParent ||
        path.normalize(physicalParent) !== path.normalize(expectedRoot) ||
        path.normalize(physicalFile) !== path.normalize(expectedFile))
      throw qaPathError(operation, 'changed-or-alias', 'read');
    return bytes;
  } catch (error) {
    if (error?.qaPathRejection) throw error;
    throw qaPathError(operation, 'unresolved-file', 'read');
  } finally { if (handle) await handle.close(); }
}

function validateConfig(config, scratch, profileRoute) {
  if (!config || typeof config !== 'object' || Array.isArray(config) || config.version !== 1 ||
      !['inspect', 'seed', 'stage', 'export-stage', 'commit', 'hold', 'same-process-reload',
        'fault-import', 'fault-stage', 'resume', 'open-from-original',
        'ozark-self-edge-write', 'ozark-self-edge-reopen'].includes(config.action))
    throw new Error('Invalid finite native QA action.');
  const allowed = new Set(['version', 'action', 'output', 'rawFile', 'expectedSha256',
    'backupFile', 'waitMs', 'screenshotFile', 'faultKind', 'buttonId', 'progressFile',
    'profileOpenFault']);
  if (Object.keys(config).some(key => !allowed.has(key))) throw new Error('Unknown native QA configuration key.');
  if (config.action.startsWith('ozark-self-edge-')) {
    if (profileRoute.kind !== 'original' ||
        Object.keys(config).some(key => !['version', 'action', 'output', 'screenshotFile'].includes(key)))
      throw new Error('Ozark self-edge QA requires an original disposable profile and fixed synthetic inputs.');
  }
  if (typeof config.output !== 'string' || !path.isAbsolute(config.output) ||
      path.dirname(config.output) !== scratch)
    throw qaPathError('output', 'invalid-or-parent', 'validation');
  if (config.screenshotFile !== undefined &&
      (typeof config.screenshotFile !== 'string' || !path.isAbsolute(config.screenshotFile) ||
       path.dirname(config.screenshotFile) !== scratch || !config.screenshotFile.endsWith('.png')))
    throw qaPathError('screenshotFile', 'invalid-or-parent-or-extension', 'validation');
  if(config.progressFile !== undefined &&
      (typeof config.progressFile !== 'string'||!path.isAbsolute(config.progressFile)||
       path.dirname(config.progressFile)!==scratch))
    throw qaPathError('progressFile', 'invalid-or-parent', 'validation');
  if (config.waitMs !== undefined && (!Number.isInteger(config.waitMs) || config.waitMs < 0 || config.waitMs > 12000))
    throw new Error('Invalid native QA wait.');
  if (config.action === 'seed' && (typeof config.rawFile !== 'string' ||
      !/^[0-9a-f]{64}$/.test(config.expectedSha256))) throw new Error('Seed needs exact raw bytes and SHA-256.');
  if (config.action === 'stage' && typeof config.backupFile !== 'string')
    throw new Error('Stage needs an exact raw backup file.');
  if (config.action === 'export-stage' &&
      (typeof config.backupFile !== 'string' || !config.backupFile.endsWith('.json') ||
       !/^[0-9a-f]{64}$/.test(config.expectedSha256)))
    throw new Error('Native export needs a direct scratch JSON destination and exact raw SHA-256.');
  if (config.action === 'fault-stage' &&
      (typeof config.backupFile !== 'string' ||
       !['after-slot-mkdir', 'before-manifest'].includes(config.faultKind)))
    throw new Error('Invalid finite publication fault.');
  if (config.action === 'fault-import' &&
      !['quota', 'write-throw', 'write-ignored', 'readback-corrupt',
        'restart-reject', 'restart-exit'].includes(config.faultKind))
    throw new Error('Invalid finite import fault.');
  if(config.action==='open-from-original'&&
      !['recovery-open','welcome-open-copy','pause-open-copy'].includes(config.buttonId))
    throw new Error('Invalid original Open button.');
  if(config.action==='open-from-original'&&config.buttonId==='pause-open-copy'&&
      typeof config.progressFile!=='string')
    throw new Error('Pause Open needs a disposable progress record.');
  if(config.profileOpenFault!==undefined&&
      (config.action!=='open-from-original'||config.buttonId!=='pause-open-copy'||
       !['delay','reject'].includes(config.profileOpenFault)))
    throw new Error('Invalid finite profile-open fault.');
  for (const key of ['rawFile', 'backupFile']) if (config[key] !== undefined &&
      (typeof config[key] !== 'string' || !path.isAbsolute(config[key]) ||
       path.dirname(config[key]) !== scratch))
    throw qaPathError(key, 'invalid-or-parent', 'validation');
}

const rendererState = async win => win.webContents.executeJavaScript(`(() => ({
  raw: localStorage.getItem(${JSON.stringify(SAVE_KEY)}),
  runtime: {present: Boolean(window.__aincrad), elapsed: window.__aincrad?.snapshot?.().elapsed ?? null},
  ui: {
    recoveryVisible: !document.getElementById('recovery-panel')?.classList.contains('hidden'),
    importVisible: !document.getElementById('recovery-import')?.classList.contains('hidden'),
    activeCopyLabel: document.getElementById('active-profile-label')?.textContent ?? '',
    welcomeProfileLabel: document.getElementById('welcome-profile-label')?.textContent ?? '',
    diagnosis: document.getElementById('recovery-diagnosis')?.textContent ?? '',
    recoveryTitle: document.getElementById('recovery-title')?.textContent ?? '',
    recoveryStatus: document.getElementById('recovery-status')?.textContent ?? ''
  }
}))()`);

async function waitForBoot(win, limitMs = 20000) {
  const deadline = Date.now() + limitMs;
  let view;
  while (Date.now() < deadline) {
    view = await rendererState(win);
    if (view.ui.welcomeProfileLabel && view.ui.welcomeProfileLabel !== 'Checking saved world…')
      return view;
    await pause(100);
  }
  throw new Error(`Renderer profile preflight did not finish: ${JSON.stringify(view?.ui || {})}`);
}

async function inspect({ app, win, session, recoveredProfile }) {
  const view = await rendererState(win);
  const raw = view.raw;
  const parsed = raw === null ? null : JSON.parse(raw);
  return {
    paths: { userData: app.getPath('userData'), sessionData: app.getPath('sessionData'),
      storagePath: session.defaultSession.storagePath },
    status: await recoveredProfile.status(),
    save: { sha256: raw === null ? null : sha256(Buffer.from(raw, 'utf8')),
      byteLength: raw === null ? 0 : Buffer.byteLength(raw, 'utf8') },
    runtime: view.runtime, ui: view.ui,
    worldElapsed: parsed?.elapsed ?? null,
    actors: parsed?.agents?.map(actor => ({ id: actor.id, physiology: actor.physiology,
      effects: actor.discovery?.effects })) ?? [],
  };
}

// Fixed synthetic Ozark actions reuse the existing sandboxed world-switch and
// save hooks. No caller-supplied code, save key, fixture path or state is accepted.
async function ozarkSelfEdge({ win, action }) {
  const preferences = win.webContents.getLastWebPreferences();
  assert.equal(preferences.sandbox, true);
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.nodeIntegration, false);
  const writing = action === 'ozark-self-edge-write';
  const { syntheticOzarkSelfEdge, evidence } = await import(
    pathToFileURL(path.resolve(__dirname, 'ozark-self-edge-fixture.mjs')).href);
  const fixture = syntheticOzarkSelfEdge();
  const expected = JSON.parse(fixture.raw);
  const before = await win.webContents.executeJavaScript(`(() => ({
    original: localStorage.getItem('aincrad.save.v1'),
    ozark: localStorage.getItem('aincrad.ozark.v1')
  }))()`);
  let original = before.original;
  let seed = before.ozark;
  if (writing) {
    assert.equal(original, null, 'write phase requires a fresh original slot');
    assert.equal(seed, null, 'write phase requires a fresh Ozark slot');
    assert.equal(await win.webContents.executeJavaScript('window.__aincrad.save()'), true);
    original = await win.webContents.executeJavaScript("localStorage.getItem('aincrad.save.v1')");
    assert.ok(typeof original === 'string' && original.length > 1000,
      'the historical-key control is a real generated original save');
    // Whitespace is valid save data. The production writer must replace these
    // bytes with its canonical representation; a seed/readback alone cannot pass.
    seed = JSON.stringify(expected, null, 2);
    await win.webContents.executeJavaScript(
      `localStorage.setItem('aincrad.ozark.v1', ${JSON.stringify(seed)})`);
  } else {
    assert.ok(typeof original === 'string' && original.length > 1000);
    assert.ok(typeof seed === 'string' && seed.length > 1000);
    assert.ok(seed === fixture.raw, 'reopen starts with the exact native checkpoint bytes');
  }
  assert.match(win.webContents.getURL(), /^aincrad:\/\/app\/index\.html\?test=1$/);
  void win.webContents.executeJavaScript("void window.aincradWorld.open('ozark'); true")
    .catch(() => {}); // Native navigation may replace the invoking frame.
  const deadline = Date.now() + 20000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      ready = win.webContents.getURL() === 'aincrad://app/index.html?test=1&ozarkWorld=1' &&
        await win.webContents.executeJavaScript('Boolean(window.__ozarkWorld)');
      if (ready) break;
    } catch { /* Wait for the native route change to finish. */ }
    await pause(100);
  }
  assert.equal(ready, true, 'native world switch reached the Ozark runtime');
  const snapshot = await win.webContents.executeJavaScript('window.__ozarkWorld.snapshot()');
  assert.equal(snapshot.blocked, false, 'real self-edge opens through the application validator');
  assert.equal(snapshot.started, false, 'no simulation runs during persistence QA');
  assert.equal(snapshot.elapsed, expected.elapsed);
  assert.deepEqual(snapshot.player, expected.player);
  assert.deepEqual(snapshot.playerBody, expected.playerBody);
  assert.equal(snapshot.geometryIdentity, expected.geometryIdentity);
  assert.deepEqual(snapshot.agents.map(actor => actor.id), ['aster', 'mira']);
  // Snapshot omits inventory; disk assertions below cover the complete proof.
  for (const [index, actor] of snapshot.agents.entries()) {
    const { items: _items, ...proof } = evidence(expected.agents[index]);
    const { items: _absent, ...actual } = evidence({ ...actor, inventory: {} });
    assert.deepEqual(actual, proof, 'live runtime retained exact body and action evidence');
  }
  assert.deepEqual(snapshot.agents[0].memory.blockedEdges[fixture.edgeKey],
    { observedAt: fixture.receipt.at, retryAfter: fixture.receipt.at + 60 });
  assert.ok(snapshot.agents[0].memory.experience.some(event =>
    JSON.stringify(event) === JSON.stringify(fixture.receipt)), 'actual blocked action receipt survived boot');
  if (writing) {
    assert.equal(await win.webContents.executeJavaScript('window.__ozarkWorld.save()'), true,
      'the real app writer must accept its loaded self-edge state');
    assert.equal((await win.webContents.executeJavaScript('window.__ozarkWorld.snapshot()')).saveStatus,
      'Ozark world saved locally');
  }
  const after = await win.webContents.executeJavaScript(`(() => ({
    original: localStorage.getItem('aincrad.save.v1'),
    ozark: localStorage.getItem('aincrad.ozark.v1'),
    snapshot: window.__ozarkWorld.snapshot(),
    fatal: !document.getElementById('fatal').classList.contains('hidden'),
    originalRuntime: typeof window.__aincrad
  }))()`);
  assert.equal(after.fatal, false);
  assert.equal(after.originalRuntime, 'undefined');
  assert.ok(after.original === original, 'opening and saving Ozark preserve exact original bytes');
  assert.ok(after.ozark === fixture.raw, 'native write/reopen preserves the exact canonical fixture');
  assert.deepEqual(JSON.parse(after.ozark), expected, 'all saved proof and physiology remain exact');
  assert.deepEqual({ ...after.snapshot, saveStatus: snapshot.saveStatus }, snapshot,
    'saving or inspecting must not change live evidence or the frozen clock');
  if (writing) assert.ok(after.ozark !== seed, 'actual app write changed seeded bytes');
  else assert.ok(after.ozark === seed, 'reopen never reseeds or rewrites storage');
  return { pid: process.pid, sha256: sha256(Buffer.from(after.ozark, 'utf8')),
    seedSha256: sha256(Buffer.from(seed, 'utf8')), byteLength: Buffer.byteLength(after.ozark, 'utf8'),
    originalSha256: sha256(Buffer.from(original, 'utf8')), edgeKey: fixture.edgeKey,
    edge: snapshot.agents[0].memory.blockedEdges[fixture.edgeKey], receipt: fixture.receipt,
    snapshot, fullSavedEvidenceSha256: sha256(Buffer.from(JSON.stringify(expected.agents.map(evidence)))),
    sandboxed: true, appWrite: writing };
}

async function writeResult(file, value) {
  const handle = await fs.open(file, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
}

async function capture(win, file) {
  const png = (await win.webContents.capturePage()).toPNG();
  if (png.length < 100 || png.length > 8 * 1024 * 1024)
    throw new Error('Native QA screenshot is empty or oversized.');
  const handle = await fs.open(file, 'wx', 0o600);
  try { await handle.writeFile(png); await handle.sync(); }
  finally { await handle.close(); }
}

async function reloadRenderer(win) {
  const completed = new Promise((resolve, reject) => {
    win.webContents.once('did-finish-load', resolve);
    win.webContents.once('did-fail-load', (_event, code, description) =>
      reject(new Error(`QA renderer reload failed (${code}): ${description}`)));
  });
  win.webContents.reload();
  await completed;
  await pause(700); // allow the module's asynchronous profile preflight to render
}

async function installStorageFault(win, kind) {
  const script = `(() => {
    const kind = ${JSON.stringify(kind)}, key = ${JSON.stringify(SAVE_KEY)};
    const originalSet = Storage.prototype.setItem, originalGet = Storage.prototype.getItem;
    let afterWrite = false;
    Storage.prototype.setItem = function(name, value) {
      if (name === key) {
        if (kind === 'quota') throw new DOMException('Injected disposable quota failure', 'QuotaExceededError');
        if (kind === 'write-throw') throw new Error('Injected disposable write failure');
        if (kind === 'write-ignored') return undefined;
        if (kind === 'readback-corrupt') {
          const result = originalSet.call(this, name, value);
          afterWrite = true;
          return result;
        }
      }
      return originalSet.call(this, name, value);
    };
    Storage.prototype.getItem = function(name) {
      if (name === key && kind === 'readback-corrupt' && afterWrite) return 'injected-readback-corruption';
      return originalGet.call(this, name);
    };
    window.__aincradQaRestoreStorage = () => {
      Storage.prototype.setItem = originalSet;
      Storage.prototype.getItem = originalGet;
      delete window.__aincradQaRestoreStorage;
    };
    return true;
  })()`;
  assert.equal(await win.webContents.executeJavaScript(script), true);
}

async function waitForFaultMessage(win, kind, limitMs = 12000) {
  const patterns = {
    quota: /quota/i, 'write-throw': /write failure/i,
    'write-ignored': /read back exactly/i, 'readback-corrupt': /read back exactly/i,
    'restart-reject': /restart failure/i,
  };
  const deadline = Date.now() + limitMs;
  let view;
  while (Date.now() < deadline) {
    view = await rendererState(win);
    if (patterns[kind].test(view.ui.recoveryStatus) && /remains paused/i.test(view.ui.recoveryStatus))
      return view;
    await pause(100);
  }
  throw new Error(`The injected ${kind} did not reach the paused UI: ${JSON.stringify(view?.ui || {})}`);
}

async function runNativeProfileQa({ app, win, session, profileRoute, rawSaveBackup, recoveredProfile,
  setRestartFault, setPublicationFault, setProfileOpenFault, configPath, routeTempRoot }) {
  assert.equal(app.isPackaged, false, 'native QA is unavailable in packages');
  assert.equal(profileRoute.isTest, true);
  assert.equal(profileRoute.usesTestPaths, true);
  const original = path.resolve(profileRoute.originalPath), copy = path.resolve(profileRoute.copyPath);
  const scratch = path.dirname(original);
  assert.equal(path.dirname(copy), scratch, 'both disposable profile roots share one scratch directory');
  assert.notEqual(original, copy);
  configPath = await resolveQaFile(configPath, scratch, 'config', { routeTempRoot });
  const config = JSON.parse((await readFixedFile(configPath, scratch, 4096, 'config')).toString('utf8'));
  for (const key of ['output', 'rawFile', 'backupFile', 'screenshotFile', 'progressFile'])
    if (typeof config[key] === 'string') config[key] = await resolveQaFile(config[key], scratch, key);
  validateConfig(config, scratch, profileRoute);
  let result = { ok: false, action: config.action };
  try {
    await waitForBoot(win);
    if (config.action.startsWith('ozark-self-edge-')) {
      result.ozark = await ozarkSelfEdge({ win, action: config.action });
    } else if (config.action === 'seed') {
      assert.equal(profileRoute.kind, 'original');
      const bytes = await readFixedFile(config.rawFile, scratch, MAX_INPUT, 'rawFile');
      assert.equal(sha256(bytes), config.expectedSha256, 'seed raw SHA-256');
      const raw = bytes.toString('utf8');
      assert.deepEqual(Buffer.from(raw, 'utf8'), bytes, 'seed raw UTF-8 round-trip');
      await win.webContents.executeJavaScript(`localStorage.setItem(${JSON.stringify(SAVE_KEY)}, ${JSON.stringify(raw)})`);
      const readback = await win.webContents.executeJavaScript(`localStorage.getItem(${JSON.stringify(SAVE_KEY)})`);
      assert.equal(readback, raw);
      await session.defaultSession.flushStorageData();
    } else if (config.action === 'export-stage') {
      const { dialog } = require('electron');
      const backupPath = config.backupFile;
      if (profileRoute.kind === 'original') {
        assert.equal((await recoveredProfile.status()).phase, 'none');
        await assert.rejects(fs.lstat(backupPath), { code: 'ENOENT' });
        const before = await rendererState(win);
        assert.equal(sha256(Buffer.from(before.raw, 'utf8')), config.expectedSha256);
        const prior = dialog.showSaveDialog;
        try {
          dialog.showSaveDialog = async () => ({ canceled: false, filePath: backupPath });
          await win.webContents.executeJavaScript(`document.getElementById('recovery-backup').click()`);
          const deadline = Date.now() + 12000;
          let view;
          do {
            await pause(100);
            view = await rendererState(win);
          } while (!/Verified raw backup:/i.test(view.ui.recoveryStatus) && Date.now() < deadline);
          assert.match(view.ui.recoveryStatus, /Verified raw backup:/i,
            'the protected Export control completed the native dialog transaction');
        } finally { dialog.showSaveDialog = prior; }
        const exported = JSON.parse((await readFixedFile(backupPath, scratch, MAX_BACKUP, 'backupFile')).toString('utf8'));
        assert.equal(exported.format, 'aincrad.raw-save-backup.v1');
        assert.equal(exported.saveKey, SAVE_KEY);
        assert.equal(exported.sha256, config.expectedSha256);
        assert.equal(exported.byteLength, Buffer.byteLength(before.raw, 'utf8'));
        assert.equal(Buffer.from(exported.rawUtf8Base64, 'base64').toString('utf8'), before.raw);
        assert.equal((await rendererState(win)).raw, before.raw,
          'native export leaves original raw save untouched');
        const canCreate = await win.webContents.executeJavaScript(
          `!document.getElementById('recovery-create').disabled`);
        assert.equal(canCreate, true, 'native export issued the product staging ticket');
        await win.webContents.executeJavaScript(`document.getElementById('recovery-create').click()`);
        return; // The product stages, opens, and relaunches into the copy.
      }
      assert.equal(profileRoute.kind, 'recovered');
      const exported = JSON.parse((await readFixedFile(backupPath, scratch, MAX_BACKUP, 'backupFile')).toString('utf8'));
      assert.equal(exported.sha256, config.expectedSha256);
      assert.equal((await recoveredProfile.status()).phase, 'pending');
      result.exportStage = { ok: true, backupSha256: exported.sha256,
        byteLength: exported.byteLength };
    } else if (config.action === 'stage' || config.action === 'fault-stage') {
      assert.equal(profileRoute.kind, 'original');
      await readFixedFile(config.backupFile, scratch, MAX_BACKUP, 'backupFile');
      await rawSaveBackup.selectTestBackup(config.backupFile);
      const raw = await win.webContents.executeJavaScript(`localStorage.getItem(${JSON.stringify(SAVE_KEY)})`);
      assert.equal(typeof raw, 'string', 'original raw save');
      const digest = sha256(Buffer.from(raw, 'utf8'));
      if (config.action === 'fault-stage') {
        assert.equal(typeof setPublicationFault, 'function');
        setPublicationFault(config.faultKind);
      }
      result.stage = await win.webContents.executeJavaScript(
        `window.aincradProfile.createRecoveredCopy(${JSON.stringify(raw)}, ${JSON.stringify(digest)})`);
    } else if (config.action === 'same-process-reload') {
      assert.equal(profileRoute.kind, 'recovered');
      assert.equal((await recoveredProfile.status()).phase, 'pending');
      const before = await rendererState(win);
      assert.equal(before.raw, null, 'same-process probe begins with an empty recovered save key');
      const staged = await recoveredProfile.stagedRaw();
      const { prepareLegacyPendingMigration } = await import(
        pathToFileURL(path.resolve(__dirname, '../src/save.js')).href);
      const migration = prepareLegacyPendingMigration(staged.raw);
      assert.equal(migration.ok, true, migration.reason);
      const candidate = migration.candidate;
      await win.webContents.executeJavaScript(
        `localStorage.setItem(${JSON.stringify(SAVE_KEY)}, ${JSON.stringify(candidate)})`);
      assert.equal(await win.webContents.executeJavaScript(
        `localStorage.getItem(${JSON.stringify(SAVE_KEY)})`), candidate);
      await session.defaultSession.flushStorageData();
      await reloadRenderer(win);
      const attempted = await win.webContents.executeJavaScript(`(async () => {
        try { await window.aincradProfile.markReady(); return { accepted: true }; }
        catch (error) { return { accepted: false, reason: String(error?.message || error) }; }
      })()`);
      assert.equal(attempted.accepted, false, 'markReady must reject a renderer reload in the same process');
      assert.match(attempted.reason, /closed.process restart/i);
      const blocked = await inspect({ app, win, session, recoveredProfile });
      assert.equal(blocked.status.phase, 'pending');
      assert.equal(blocked.runtime.present, false);
      assert.equal(blocked.save.sha256, sha256(Buffer.from(candidate, 'utf8')));
      // Restore the empty pending key only in this disposable copy so the
      // subsequent process can exercise the explicit product import button.
      await win.webContents.executeJavaScript(`localStorage.removeItem(${JSON.stringify(SAVE_KEY)})`);
      assert.equal(await win.webContents.executeJavaScript(
        `localStorage.getItem(${JSON.stringify(SAVE_KEY)})`), null);
      await session.defaultSession.flushStorageData();
      await reloadRenderer(win);
      const cleared = await inspect({ app, win, session, recoveredProfile });
      assert.equal(cleared.status.phase, 'pending');
      assert.equal(cleared.save.sha256, null);
      assert.equal(cleared.runtime.present, false);
      result.sameProcessReload = { rejected: true, reason: attempted.reason,
        candidateSha256: sha256(Buffer.from(candidate, 'utf8')) };
    } else if (config.action === 'commit') {
      assert.equal(profileRoute.kind, 'recovered');
      const status = await recoveredProfile.status();
      if (status.phase === 'pending') {
        const view = await rendererState(win);
        if (view.raw === null) {
          assert.equal(view.ui.importVisible, true,
            `pending import button is visible: ${JSON.stringify(view.ui)}`);
          await win.webContents.executeJavaScript(`document.getElementById('recovery-import').click()`);
          // The product imports, flushes, and relaunches. The same gated QA
          // action resumes after both native restarts and records ready state.
          return;
        }
        // Pending with candidate is automatically marked ready by the renderer.
        return;
      }
      assert.equal(status.phase, 'ready', 'copy must become ready after native restart');
      const view = await rendererState(win);
      assert.equal(view.runtime.present, true, 'ready copy starts its runtime');
      result.commit = { ok: true };
    } else if (config.action === 'fault-import') {
      assert.equal(profileRoute.kind, 'recovered');
      assert.equal((await recoveredProfile.status()).phase, 'pending');
      const initial = await rendererState(win);
      assert.equal(initial.raw, null, 'fault import begins with an empty copy save key');
      assert.equal(initial.ui.importVisible, true, 'fault import button is visible');
      const kind = config.faultKind;
      if (['quota', 'write-throw', 'write-ignored', 'readback-corrupt'].includes(kind))
        await installStorageFault(win, kind);
      else {
        assert.equal(typeof setRestartFault, 'function');
        setRestartFault(kind === 'restart-reject' ? 'reject' : 'exit');
      }
      await win.webContents.executeJavaScript(`document.getElementById('recovery-import').click()`);
      if (kind === 'restart-exit') return; // Native main exits with code 86 before flush/relaunch.
      const failed = await waitForFaultMessage(win, kind);
      if (['quota', 'write-throw', 'write-ignored', 'readback-corrupt'].includes(kind))
        await win.webContents.executeJavaScript(`window.__aincradQaRestoreStorage()`);
      if (kind === 'restart-reject') setRestartFault(null);
      const checked = await inspect({ app, win, session, recoveredProfile });
      const written = ['readback-corrupt', 'restart-reject'].includes(kind);
      assert.equal(checked.status.phase, 'pending');
      assert.equal(checked.runtime.present, false);
      assert.equal(checked.ui.recoveryVisible, true);
      assert.equal(written, checked.save.sha256 !== null, 'copy key reflects the injection point');
      result.fault = { kind, paused: true, candidateWritten: written,
        uiMessage: failed.ui.recoveryStatus };
    } else if (config.action === 'resume') {
      assert.equal(profileRoute.kind, 'recovered');
      const status = await recoveredProfile.status();
      if (status.phase === 'pending') {
        const view = await rendererState(win);
        if (view.raw !== null) return; // Renderer attests the candidate then relaunches.
        result.resume = { phase: 'pending-empty' };
      } else {
        assert.equal(status.phase, 'ready');
        const view = await rendererState(win);
        assert.equal(view.runtime.present, true);
        result.resume = { phase: 'ready' };
      }
    } else if(config.action==='open-from-original'){
      const status=await recoveredProfile.status();
      if(profileRoute.kind==='original'){
        assert.equal(status.available,true,'a recovered copy is available to open');
        const button=config.buttonId;
        let started=null,progressed=null;
        if(button==='pause-open-copy'){
          started=await win.webContents.executeJavaScript(`(() => {
            document.getElementById('begin').click();
            window.dispatchEvent(new KeyboardEvent('keydown',{code:'Escape',key:'Escape',bubbles:true}));
            return {runtime:Boolean(window.__aincrad),
              pauseVisible:!document.getElementById('pause-panel').classList.contains('hidden'),
              buttonVisible:!document.getElementById('pause-open-copy').classList.contains('hidden'),
              before:JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)})).elapsed};
          })()`);
          assert.equal(started.runtime,true);
          assert.equal(started.pauseVisible,true);
          assert.equal(started.buttonVisible,true);
          progressed=await win.webContents.executeJavaScript(`(() => {
            window.__aincrad.step(3);
            return window.__aincrad.snapshot().elapsed;
          })()`);
          assert.ok(progressed>started.before,'unsaved original progress precedes pause Open');
          if(config.profileOpenFault){
            assert.equal(typeof setProfileOpenFault,'function');
            setProfileOpenFault(config.profileOpenFault);
          }
          if(!config.profileOpenFault)
            await writeResult(config.progressFile,{before:started.before,expectedElapsed:progressed});
        }else{
          const visible=await win.webContents.executeJavaScript(
            `!document.getElementById(${JSON.stringify(button)}).classList.contains('hidden')`);
          assert.equal(visible,true,`${button} is visible on ordinary original startup`);
        }
        await win.webContents.executeJavaScript(
          `document.getElementById(${JSON.stringify(button)}).click()`);
        if(button==='pause-open-copy'&&config.profileOpenFault){
          await pause(250);
          const during=await win.webContents.executeJavaScript(`(() => ({
            elapsed:window.__aincrad.snapshot().elapsed,
            savedElapsed:JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)})).elapsed,
            raw:localStorage.getItem(${JSON.stringify(SAVE_KEY)}),
            paused:window.__aincrad.metrics().paused,
            status:document.getElementById('pause-copy-status').textContent
          }))()`);
          assert.equal(during.elapsed,progressed,'world freezes after opening starts');
          assert.equal(during.savedElapsed,progressed,'pause Open saved the latest progression');
          if(config.profileOpenFault==='delay'){
            await win.webContents.executeJavaScript(`(() => {
              document.getElementById('resume').click();
              window.dispatchEvent(new KeyboardEvent('keydown',{code:'Escape',key:'Escape',bubbles:true}));
            })()`);
            await pause(350);
            const still=await win.webContents.executeJavaScript(`(() => ({
              elapsed:window.__aincrad.snapshot().elapsed,
              raw:localStorage.getItem(${JSON.stringify(SAVE_KEY)}),
              paused:window.__aincrad.metrics().paused
            }))()`);
            assert.equal(still.elapsed,progressed,'resume controls cannot advance a switching world');
            assert.equal(still.raw,during.raw,'the original save cannot change during slow Open');
            assert.equal(still.paused,true,'slow Open retains pause');
            await writeResult(config.progressFile,{before:started.before,
              expectedElapsed:progressed,duringRawSha256:sha256(Buffer.from(during.raw,'utf8')),
              delayedOpenQuiesced:true});
          }else{
            const deadline=Date.now()+8000;
            let statusText=during.status;
            while(!/Injected test profile-open failure/i.test(statusText)&&Date.now()<deadline){
              await pause(100);
              statusText=await win.webContents.executeJavaScript(
                `document.getElementById('pause-copy-status').textContent`);
            }
            assert.match(statusText,/Injected test profile-open failure/i);
            setProfileOpenFault(null);
            const resumed=await win.webContents.executeJavaScript(`(() => {
              document.getElementById('resume').click();
              window.__aincrad.step(1);
              const after=window.__aincrad.snapshot().elapsed;
              const saved=window.__aincrad.save();
              return {after,saved,paused:window.__aincrad.metrics().paused};
            })()`);
            assert.equal(resumed.paused,false,'failed Open restores resume controls');
            assert.equal(resumed.saved,true,'failed Open restores saving');
            assert.ok(resumed.after>progressed,'failed Open restores progression');
            await writeResult(config.progressFile,{before:started.before,
              expectedElapsed:resumed.after,openRejected:true});
            result.openFromOriginal={buttonId:button,rejected:true};
          }
        }
        if(config.profileOpenFault==='reject'){
          // This fault must remain in the original process; no route change.
        }else return; // Product relaunches into recovered mode with the same gated QA action.
      }
      if(profileRoute.kind==='recovered'){
        result.openFromOriginal={buttonId:config.buttonId,routed:true};
        if(config.progressFile)result.openFromOriginal.progress=JSON.parse(
          (await readFixedFile(config.progressFile,scratch,4096,'progressFile')).toString('utf8'));
      }
    }
    result = { ...result, ...(await inspect({ app, win, session, recoveredProfile })), ok: true };
    if (config.waitMs) {
      if (config.action === 'hold') await writeResult(config.output, result);
      await pause(config.waitMs);
      result.afterWait = await inspect({ app, win, session, recoveredProfile });
      // For hold, the first result signals that the lock is held.
    }
    if (config.screenshotFile) {
      await capture(win, config.screenshotFile);
      result.screenshotFile = config.screenshotFile;
    }
    if (config.action !== 'hold') await writeResult(config.output, result);
    await session.defaultSession.flushStorageData();
    app.quit();
  } catch (error) {
    result = { ...result, ok: false, error: error?.stack || String(error) };
    try {
      const view = await rendererState(win);
      result.diagnostic = { status: await recoveredProfile.status(), ui: view.ui,
        saveSha256: view.raw === null ? null : sha256(Buffer.from(view.raw, 'utf8')),
        runtime: view.runtime };
      const failurePng = path.join(scratch, `${path.basename(config.output)}.failure.png`);
      await capture(win, failurePng);
      result.failureScreenshot = failurePng;
    } catch (diagnosticError) {
      result.diagnosticError = String(diagnosticError?.message || diagnosticError);
    }
    try { await writeResult(config.output, result); } catch {}
    console.error('Native profile QA failed:', result.error);
    app.exit(1);
  }
}

module.exports = { runNativeProfileQa, resolveQaFile, readFixedFile };
