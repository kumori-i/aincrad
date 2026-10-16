/** Finite Electron QA actions. Main loads this only in an unpackaged --test
 * launch with explicit, disposable original and recovered profile roots. */
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { constants } = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SAVE_KEY = 'aincrad.save.v1';
const MAX_INPUT = 16 * 1024 * 1024;
const MAX_BACKUP = 24 * 1024 * 1024;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function inside(directory, location) {
  const suffix = path.relative(directory, location);
  return suffix === '' || suffix !== '..' && !suffix.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(suffix);
}
async function normalizeTempSpelling(location) {
  const lexical = path.resolve(location);
  const temp = path.resolve(os.tmpdir());
  if (!inside(temp, lexical)) return lexical;
  // Only the fixed OS temp root is resolved. Caller paths remain untouched
  // until a lexical direct-child check has accepted them.
  return path.join(await fs.realpath(temp), path.relative(temp, lexical));
}
async function readFixedFile(location, root, limit) {
  if (typeof location !== 'string' || !path.isAbsolute(location) ||
      path.dirname(location) !== root) throw new Error('QA input is not a direct disposable scratch file.');
  const entry = await fs.lstat(location);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size < 1 || entry.size > limit)
    throw new Error('QA input is not a bounded regular file.');
  const handle = await fs.open(location, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const original = await handle.stat();
    const bytes = await handle.readFile();
    if (!original.isFile() || bytes.length !== original.size ||
        await fs.realpath(location) !== path.join(await fs.realpath(path.dirname(location)), path.basename(location)))
      throw new Error('QA input changed or aliases another path.');
    return bytes;
  } finally { await handle.close(); }
}

function validateConfig(config, scratch, profileRoute) {
  if (!config || typeof config !== 'object' || Array.isArray(config) || config.version !== 1 ||
      !['inspect', 'seed', 'stage', 'export-stage', 'commit', 'hold', 'same-process-reload',
        'fault-import', 'fault-stage', 'resume', 'open-from-original'].includes(config.action))
    throw new Error('Invalid finite native QA action.');
  const allowed = new Set(['version', 'action', 'output', 'rawFile', 'expectedSha256',
    'backupFile', 'waitMs', 'screenshotFile', 'faultKind', 'buttonId', 'progressFile',
    'profileOpenFault']);
  if (Object.keys(config).some(key => !allowed.has(key))) throw new Error('Unknown native QA configuration key.');
  if (typeof config.output !== 'string' || !path.isAbsolute(config.output) ||
      path.dirname(config.output) !== scratch) throw new Error('QA output is not a direct disposable scratch file.');
  if (config.screenshotFile !== undefined &&
      (typeof config.screenshotFile !== 'string' || !path.isAbsolute(config.screenshotFile) ||
       path.dirname(config.screenshotFile) !== scratch || !config.screenshotFile.endsWith('.png')))
    throw new Error('QA screenshot is not a direct disposable scratch PNG.');
  if(config.progressFile !== undefined &&
      (typeof config.progressFile !== 'string'||!path.isAbsolute(config.progressFile)||
       path.dirname(config.progressFile)!==scratch))
    throw new Error('QA progress record is not a direct disposable scratch file.');
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
      (!path.isAbsolute(config[key]) || path.dirname(config[key]) !== scratch))
    throw new Error('QA data files must be direct disposable scratch files.');
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
  setRestartFault, setPublicationFault, setProfileOpenFault, configPath }) {
  assert.equal(app.isPackaged, false, 'native QA is unavailable in packages');
  assert.equal(profileRoute.isTest, true);
  assert.equal(profileRoute.usesTestPaths, true);
  const original = path.resolve(profileRoute.originalPath), copy = path.resolve(profileRoute.copyPath);
  const scratch = path.dirname(original);
  assert.equal(path.dirname(copy), scratch, 'both disposable profile roots share one scratch directory');
  assert.notEqual(original, copy);
  if (typeof configPath !== 'string' || !path.isAbsolute(configPath))
    throw new Error('Native QA config must have an absolute path.');
  configPath = await normalizeTempSpelling(configPath);
  if (path.dirname(configPath) !== scratch)
    throw new Error('Native QA config must be a direct disposable scratch file.');
  const config = JSON.parse((await readFixedFile(configPath, scratch, 4096)).toString('utf8'));
  for (const key of ['output', 'rawFile', 'backupFile', 'screenshotFile', 'progressFile']) if (typeof config[key] === 'string' &&
      path.isAbsolute(config[key])) config[key] = await normalizeTempSpelling(config[key]);
  validateConfig(config, scratch, profileRoute);
  let result = { ok: false, action: config.action };
  try {
    await waitForBoot(win);
    if (config.action === 'seed') {
      assert.equal(profileRoute.kind, 'original');
      const bytes = await readFixedFile(config.rawFile, scratch, MAX_INPUT);
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
        const exported = JSON.parse((await readFixedFile(backupPath, scratch, MAX_BACKUP)).toString('utf8'));
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
      const exported = JSON.parse((await readFixedFile(backupPath, scratch, MAX_BACKUP)).toString('utf8'));
      assert.equal(exported.sha256, config.expectedSha256);
      assert.equal((await recoveredProfile.status()).phase, 'pending');
      result.exportStage = { ok: true, backupSha256: exported.sha256,
        byteLength: exported.byteLength };
    } else if (config.action === 'stage' || config.action === 'fault-stage') {
      assert.equal(profileRoute.kind, 'original');
      await readFixedFile(config.backupFile, scratch, MAX_BACKUP);
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
          (await readFixedFile(config.progressFile,scratch,4096)).toString('utf8'));
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

module.exports = { runNativeProfileQa };
