'use strict';
// This is a fixed standalone qualification page, never the application or owner proof.
const fs = require('node:fs');
const path = require('node:path');
const p = require('./policy.cjs');
function readProc(pid) {
  p.demand(Number.isInteger(pid) && pid > 1, 'os-pid-unavailable');
  const base = `/proc/${pid}`;
  const identity = () => {
    const value = fs.readFileSync(`${base}/stat`, 'utf8');
    const end = value.lastIndexOf(')'); p.demand(end > 0, 'proc-stat-unavailable');
    const fields = value.slice(end + 2).trim().split(/\s+/);
    p.demand(/^\d+$/.test(fields[19] || ''), 'proc-start-unavailable');
    return `${pid}:${fields[19]}`; // Field 22, starttime. The comm field may contain spaces.
  };
  const startIdentityBefore = identity();
  const statusText = fs.readFileSync(`${base}/status`, 'utf8'); p.demand(statusText.length <= 65536, 'proc-status-size');
  const status = p.parseStatus(statusText), argvBytes = fs.readFileSync(`${base}/cmdline`);
  p.demand(argvBytes.length <= 65536, 'proc-cmdline-size');
  const argv = argvBytes.toString('utf8').split('\0').filter(Boolean), namespaces = {};
  const unavailable = [];
  for (const kind of ['user', 'pid', 'net']) { try { namespaces[kind] = fs.readlinkSync(`${base}/ns/${kind}`); } catch { namespaces[kind] = null; unavailable.push(`namespace-${kind}`); } }
  let executable = null; try { executable = fs.realpathSync(`${base}/exe`); } catch { unavailable.push('executable'); }
  return { pid, status, argv, namespaces, executable, unavailable, startIdentityBefore, startIdentityAfter: identity() };
}

async function main() {
  p.assertEnvironment(process.env, process.getuid?.(), process.platform, process.arch);
  p.demand(!process.argv.some(p.badArg), 'unsafe-native-argv');
  const values = process.argv.filter(a => a.startsWith('--qualification-config='));
  p.demand(values.length === 1, 'native-config-count');
  const configPath = values[0].slice('--qualification-config='.length);
  const configBytes = p.realFile(configPath, p.LIMIT.config), config = p.validateConfig(JSON.parse(configBytes));
  p.demand(__filename === path.join(config.codeRoot, 'electron-main.cjs') && require.resolve('./policy.cjs') === path.join(config.codeRoot, 'policy.cjs'), 'native-entrypoint-mismatch');
  p.demand(fs.realpathSync(config.profile) === config.profile && fs.readdirSync(config.profile).length === 0, 'profile-not-private-empty');
  const frozen = new Map(config.code.map(d => [d.path, p.realFile(path.join(config.codeRoot, d.path))]));
  const { app, BrowserWindow, Menu, protocol, session, ipcMain, screen } = require('electron');
  let win, ending = false, reportReceived = false, preload = null, timer;
  const record = { version: 1, status: 'unavailable', reason: null, policy: p.CSP, expectedElectron: config.expectedElectron,
    actualElectron: process.versions.electron, actualChrome: process.versions.chrome, configSha256: p.sha256(configBytes),
    applicationStarted: false, simulationStarted: false, timingStarted: false, preload: null, page: null, sandbox: null, native: null, capture: null };
  function finish(reason) {
    if (ending) return; ending = true; clearTimeout(timer);
    record.reason = reason;
    try { p.verifyCode(config.codeRoot, config.code); }
    catch { record.reason = 'source-changed-during-native'; }
    record.status = record.reason ? 'unavailable' : 'qualified';
    try {
      const bytes = Buffer.from(`${JSON.stringify(record)}\n`); p.demand(bytes.length <= p.LIMIT.json, 'native-report-limit');
      fs.writeFileSync(config.result, bytes, { flag: 'wx', mode: 0o600 });
    } catch { record.status = 'unavailable'; }
    app.exit(record.status === 'qualified' ? 0 : 1);
  }
  process.once('SIGTERM', () => finish('native-interrupted')); process.once('SIGINT', () => finish('native-interrupted'));
  process.on('uncaughtException', () => finish('native-uncaught')); process.on('unhandledRejection', () => finish('native-rejection'));
  timer = setTimeout(() => finish('native-startup-timeout'), 15000);
  try {
    p.demand(process.versions.electron === '44.7.0', 'electron-version-mismatch');
    app.enableSandbox();
    app.setName('Aincrad isolated hosted qualification'); app.setPath('userData', config.profile); app.setPath('sessionData', config.profile);
    protocol.registerSchemesAsPrivileged([{ scheme: 'qualification', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
    await app.whenReady(); if (ending) return;
    Menu.setApplicationMenu(null);
    const ses = session.defaultSession;
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false)); ses.setPermissionCheckHandler(() => false);
    ses.on('will-download', event => event.preventDefault());
    ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel: p.asset(details.url) === null }));
    await protocol.handle('qualification', request => {
      const name = p.asset(request.url);
      if (!name || !['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 404 });
      const bytes = name === 'probe.json' ? Buffer.from('{"probe":true}') : name === 'probe-worker.js' ? Buffer.from('postMessage("unexpected-worker-execution")') : frozen.get(name);
      const type = name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : name.endsWith('.json') ? 'application/json' : 'application/javascript';
      return new Response(request.method === 'HEAD' ? null : new Uint8Array(bytes), { headers: { 'Content-Type': `${type}; charset=utf-8`, 'Content-Security-Policy': p.CSP,
        'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' } });
    });
    const display = screen.getAllDisplays().find(d => d.bounds.width === 1440 && d.bounds.height === 900 && d.scaleFactor === 1);
    p.demand(display, 'native-display-unavailable');
    win = new BrowserWindow({ width: 1440, height: 900, x: display.bounds.x, y: display.bounds.y, useContentSize: true, frame: false,
      show: true, resizable: false, maximizable: false, fullscreenable: false, autoHideMenuBar: true, backgroundColor: '#112233',
      webPreferences: { preload: path.join(config.codeRoot, 'preload.cjs'), sandbox: true, contextIsolation: true,
        nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false, webSecurity: true,
        allowRunningInsecureContent: false, backgroundThrottling: false, webviewTag: false, devTools: false, spellcheck: false, navigateOnDragDrop: false } });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    for (const name of ['will-navigate', 'will-redirect', 'will-frame-navigate', 'will-attach-webview']) win.webContents.on(name, event => event.preventDefault());
    for (const name of ['render-process-gone', 'preload-error', 'did-fail-load']) win.webContents.on(name, () => finish(`native-${name}`));
    win.on('closed', () => { if (!ending) finish('native-window-closed'); });
    const trusted = event => event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame && event.senderFrame.url === `${p.ORIGIN}/page.html`;
    ipcMain.on('qualification:preload', (event, value, ...extra) => {
      try { p.demand(trusted(event) && !ending && preload === null && extra.length === 0 && JSON.stringify(value).length <= 1024, 'preload-channel'); p.exact(value, ['sandboxed', 'contextIsolated', 'type', 'pid'], 'preload'); preload = value; }
      catch { finish('preload-evidence-unavailable'); }
    });
    ipcMain.handle('qualification:report', async (event, value, ...extra) => {
      try {
        p.demand(trusted(event) && !ending && !reportReceived && extra.length === 0, 'page-channel'); reportReceived = true;
        p.demand(JSON.stringify(value).length <= 16384, 'page-report-limit'); p.validatePage(value);
        record.page = value; record.preload = preload;
        p.demand(preload !== null, 'preload-report-missing');
        const rendererPid = win.webContents.getOSProcessId();
        record.sandbox = { main: readProc(process.pid), renderer: null };
        record.sandbox.renderer = readProc(rendererPid);
        const mainEvidence = record.sandbox.main, renderer = record.sandbox.renderer;
        p.validateSandbox({ preload, renderer, main: mainEvidence });
        p.demand(renderer.executable === fs.realpathSync(process.execPath), 'native-binary-mismatch');
        const content = win.getContentSize(), matching = screen.getDisplayMatching(win.getBounds());
        p.demand(content[0] === 1440 && content[1] === 900 && matching.scaleFactor === 1 && win.isVisible() && !win.isMinimized(), 'native-content-unavailable');
        const picture = await win.webContents.capturePage(); if (ending) return { accepted: false };
        p.demand(!picture.isEmpty(), 'native-capture-empty');
        const size = picture.getSize(), bitmap = picture.toBitmap();
        const pixels = p.analyzeBitmap(bitmap, size.width, size.height), png = picture.toPNG(); p.encodeScreenshot(png);
        fs.writeFileSync(config.capture, png, { flag: 'wx', mode: 0o600 });
        record.preload = preload; record.page = value; record.sandbox = { main: mainEvidence, renderer, observedAt: new Date().toISOString(),
          interpretation: 'Correlated runtime flags, renderer process seccomp/capabilities and distinct user, PID and network namespaces; not a proof against all sandbox escapes.' };
        record.native = { content, scaleFactor: matching.scaleFactor, visible: win.isVisible(), minimized: win.isMinimized(), bounds: win.getBounds() };
        record.capture = { ...pixels, pngBytes: png.length, pngSha256: p.sha256(png) };
        finish(null); return { accepted: true };
      } catch (error) { finish(/^[a-z0-9-]{1,100}$/.test(error.message || '') ? error.message : 'native-evidence-unavailable'); return { accepted: false }; }
    });
    await win.loadURL(`${p.ORIGIN}/page.html`);
  } catch (error) { finish(/^[a-z0-9-]{1,100}$/.test(error.message || '') ? error.message : 'native-startup-unavailable'); }
}
main().catch(() => { process.stderr.write('qualification-native-entry-unavailable\n'); process.exitCode = 1; });
