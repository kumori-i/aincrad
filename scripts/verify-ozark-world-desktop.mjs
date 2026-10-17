/** Actual Electron QA for the separate, persistent whole-map Ozark world.
 * Every process uses a fresh /tmp test profile. The synthetic original save is
 * created inside that profile and must retain its exact bytes throughout. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApplication } from './build.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const scratch = await mkdtemp(join(tmpdir(), 'aincrad-ozark-world-native-'));
const outputRoot = resolve(root, 'test-results/ozark-world-desktop');
await mkdir(outputRoot, { recursive: true });
const output = await mkdtemp(join(outputRoot, 'run-'));
const built = await buildApplication();
const context = { root, scratch, output,
  sourceFingerprint: built.sourceFingerprint };
const harness = join(scratch, 'runner.cjs');
await writeFile(harness, `
const { app, session } = require('electron');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const context = ${JSON.stringify(context)};
const phase = process.argv.find(arg => arg.startsWith('--phase='))?.slice(8);
const digest = raw => createHash('sha256').update(raw).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const page = (win, fn) => win.webContents.executeJavaScript('(' + fn.toString() + ')()');
const snapshot = win => win.webContents.executeJavaScript('window.__ozarkWorld.snapshot()');
let running = false;
const deadline = setTimeout(() => {
  console.error('Ozark world native QA timed out during ' + phase);
  app.exit(1);
}, 180000);

async function waitFor(win, expression, label, timeoutMs = 40000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      if (await win.webContents.executeJavaScript(expression)) return;
    } catch { /* A deliberate route switch can replace the frame. */ }
    await delay(100);
  }
  throw new Error('Timed out waiting for ' + label + ' at ' + win.webContents.getURL());
}

async function switchToOzark(win) {
  assert.match(win.webContents.getURL(), /^aincrad:\\/\\/app\\/index\\.html\\?test=1$/);
  const bridge = await page(win, function bridgePresent() {
    return typeof window.aincradWorld?.open === 'function' &&
      !document.getElementById('welcome-ozark').classList.contains('hidden');
  });
  assert.equal(bridge, true, 'original test route exposes the explicit world switch');
  // The invoked native bridge owns navigation. Its renderer promise can be
  // destroyed by that navigation, so wait for the new frame instead.
  const load = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Ozark route did not load')), 40000);
    win.webContents.once('did-finish-load', () => { clearTimeout(timer); resolve(); });
  });
  void win.webContents.executeJavaScript("void window.aincradWorld.open('ozark'); true")
    .catch(() => {});
  await load;
  await waitFor(win, 'Boolean(window.__ozarkWorld)', 'Ozark test hook');
  assert.match(win.webContents.getURL(), /^aincrad:\\/\\/app\\/index\\.html\\?test=1&ozarkWorld=1$/);
  assert.equal(await win.webContents.executeJavaScript('typeof window.__aincrad'),
    'undefined', 'Ozark did not boot the historical runtime');
}

async function capture(win, name, waitMs = 160) {
  await delay(waitMs);
  const image = await win.webContents.capturePage();
  const size = image.getSize();
  const png = image.toPNG();
  assert.ok(size.width >= 800 && size.height >= 600 && png.length > 10000,
    'Expected a nonempty, actual Electron screenshot: ' + name);
  const file = path.join(context.output, name);
  await fs.writeFile(file, png);
  return { file, bytes: png.length, width: size.width, height: size.height };
}

function evidenceCount(agent) {
  return {
    knownWaterSources: Object.keys(agent.memory.sources).length,
    observations: Object.keys(agent.discovery.observations).length,
    experiments: agent.discovery.experiments.length,
    effects: agent.discovery.effects.length,
    experience: agent.memory.experience.length,
    feedback: agent.physiology.feedback.length,
  };
}

function assertEarlierEvidence(before, after, label) {
  for (const [id, source] of Object.entries(before.memory.sources)) {
    const current = after.memory.sources[id];
    assert.ok(current, label + ' lost a physical water source ' + id);
    const { observedAt: priorAt, ...prior } = source;
    const { observedAt: currentAt, ...restored } = current;
    assert.deepEqual(restored, prior,
      label + ' changed a previously observed physical water source');
    assert.ok(currentAt >= priorAt && currentAt <= after.elapsed,
      label + ' gave a water source an invalid new observation time');
  }
  for (const key of ['experiments', 'effects', 'seenFeedback'])
    assert.deepEqual(after.discovery[key], before.discovery[key],
      label + ' changed learned ' + key + ' during write/load');
  // The controller's first local perception can refresh observedAt for an
  // object still within sight at the same saved simulation time. Its earlier
  // sensory contents must remain intact; this is not a learned action proof.
  for (const [id, observation] of Object.entries(before.discovery.observations)) {
    const current = after.discovery.observations[id];
    assert.ok(current, label + ' lost observed object ' + id);
    const { observedAt: priorAt, ...priorSenses } = observation;
    const { observedAt: currentAt, ...currentSenses } = current;
    assert.deepEqual(currentSenses, priorSenses,
      label + ' changed prior sensory content for ' + id);
    assert.ok(currentAt >= priorAt && currentAt <= after.elapsed,
      label + ' gave an observed object an invalid new time');
  }
  for (const key of ['stomach', 'feedback'])
    assert.deepEqual(after.physiology[key], before.physiology[key],
      label + ' changed physical ' + key + ' during write/load');
  assert.deepEqual(after.memory.experience.slice(0, before.memory.experience.length),
    before.memory.experience,
    label + ' lost or changed an earlier action receipt during write/load');
}

async function writePhase(win) {
  await waitFor(win, 'Boolean(window.__aincrad)', 'original test hook');
  const oldRaw = await page(win, function seedOriginal() {
    if (!window.__aincrad.save()) throw new Error('Could not save the synthetic original world');
    return localStorage.getItem('aincrad.save.v1');
  });
  assert.ok(oldRaw.length > 1000, 'Expected a substantive synthetic original save');
  const oldHash = digest(oldRaw);
  await switchToOzark(win);
  const initial = await snapshot(win);
  assert.equal(initial.blocked, false, 'Fresh Ozark world should open');
  assert.equal(initial.started, false);
  assert.match(initial.geometryIdentity, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(initial.agents.map(agent => agent.id), ['aster', 'mira']);
  assert.ok(initial.agents.every(agent =>
    agent.memory.skills.length === 0 && agent.discovery.techniques.length === 0 &&
    Object.values(agent.memory.cells).length <= 128 &&
    Object.values(agent.memory.cells).every(cell =>
      Math.hypot(cell.x - agent.position.x, cell.y - agent.position.y) <= 700)),
  'A fresh actor received distant route knowledge or a preloaded technique');
  assert.ok(initial.ecology?.plants > 0 && initial.ecology?.animals > 0,
    'Whole-map ecology was not created');
  assert.equal(await win.webContents.executeJavaScript('window.__ozarkWorld.start()'), true,
    'Starting the fresh world must first save its separate slot');
  win.focus();
  await delay(500);
  const beforeInput = await snapshot(win);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'D' });
  await delay(600);
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'D' });
  const afterInput = await snapshot(win);
  assert.ok(afterInput.player.x > beforeInput.player.x + 2,
    'Native keyboard movement did not move the Ozark player');
  assert.equal(await win.webContents.executeJavaScript('window.__ozarkWorld.step(6)'), true,
    'The Ozark test clock could not advance both agents and ecology');
  const activeScreenshot = await capture(win, 'world-active.png');
  const map = await page(win, function inspectMap() {
    document.getElementById('open-map').click();
    const panel = document.getElementById('map-panel');
    const canvas = document.getElementById('atlas-map');
    const g = canvas.getContext('2d');
    const colors = new Set();
    for (let y = 8; y < canvas.height; y += 23)
      for (let x = 8; x < canvas.width; x += 23) {
        const rgba = g.getImageData(x, y, 1, 1).data;
        colors.add(Array.from(rgba).join(','));
      }
    const before = document.getElementById('atlas-zoom-label').textContent;
    document.getElementById('atlas-zoom-in').click();
    const after = document.getElementById('atlas-zoom-label').textContent;
    return { visible: !panel.classList.contains('hidden'), width: canvas.width,
      height: canvas.height, colors: colors.size, before, after,
      agentButtons: ['aster', 'mira'].every(id =>
        Boolean(document.getElementById('atlas-center-' + id))) };
  });
  assert.equal(map.visible, true);
  assert.ok(map.width > 300 && map.height > 200 && map.colors >= 8,
    'Full-map terrain did not render into the atlas canvas');
  assert.equal(map.agentButtons, true, 'Both agents need whole-map controls');
  assert.notEqual(map.after, map.before, 'The whole-map zoom control did not respond');
  const mapScreenshot = await capture(win, 'whole-map.png');
  await win.webContents.executeJavaScript("document.getElementById('close-map').click() ");
  assert.equal(await win.webContents.executeJavaScript(
    "window.__ozarkWorld.step(3,0,1,'walk')"), true,
  'The physical walk before checkpoint failed');
  await win.webContents.executeJavaScript(
    "window.dispatchEvent(new KeyboardEvent('keydown',{code:'Escape'}))");
  assert.equal((await snapshot(win)).paused, true, 'Escape did not pause Ozark');
  assert.equal(await win.webContents.executeJavaScript('window.__ozarkWorld.save()'), true,
    'Ozark save failed at the native checkpoint');
  const checkpoint = await page(win, function checkpointPage() {
    return { raw: localStorage.getItem('aincrad.ozark.v1'),
      old: localStorage.getItem('aincrad.save.v1'),
      snapshot: window.__ozarkWorld.snapshot(),
      fatal: !document.getElementById('fatal').classList.contains('hidden') };
  });
  assert.equal(checkpoint.fatal, false, 'Ozark renderer displayed a fatal error');
  assert.equal(checkpoint.old, oldRaw, 'Ozark world changed original bytes');
  const disk = JSON.parse(checkpoint.raw);
  assert.equal(disk.version, 9);
  assert.equal(disk.geometryIdentity, initial.geometryIdentity);
  assert.equal(disk.environment.ecology.geometryIdentity, initial.geometryIdentity);
  assert.deepEqual(disk.agents.map(agent => agent.id), ['aster', 'mira']);
  assert.deepEqual(disk.playerBody, checkpoint.snapshot.playerBody);
  assert.ok(disk.playerBody.effort > 0 && disk.playerBody.stamina < 100,
    'The native checkpoint did not retain non-default exertion');
  assert.ok(disk.elapsed > 6 && disk.player.x > initial.player.x + 2,
    'The saved world did not retain native movement and elapsed time');
  const plants = disk.environment.ecology.plants.map(plant => plant.position);
  const extent = { minX: Math.min(...plants.map(p => p.x)),
    maxX: Math.max(...plants.map(p => p.x)),
    minY: Math.min(...plants.map(p => p.y)),
    maxY: Math.max(...plants.map(p => p.y)) };
  assert.ok(extent.maxX - extent.minX > 20000 &&
    extent.maxY - extent.minY > 14000,
    'Ecology was not placed over the full Ozark watershed');
  const proof = disk.agents.map(evidenceCount);
  assert.ok(proof.some(row => row.experience > 0 || row.observations > 0),
    'Neither agent retained any autonomous observation or action evidence');
  const expected = {
    oldHash, ozarkHash: digest(checkpoint.raw), oldLength: oldRaw.length,
    geometryIdentity: initial.geometryIdentity, checkpoint: checkpoint.snapshot,
    proof, ecology: checkpoint.snapshot.ecology, plantExtent: extent,
    nativeMovement: afterInput.player.x - beforeInput.player.x,
    map, screenshots: [activeScreenshot, mapScreenshot],
  };
  await fs.writeFile(path.join(context.scratch, 'checkpoint.json'),
    JSON.stringify(expected));
  await session.defaultSession.flushStorageData();
  console.log('PASS: native Ozark route, both agents, full-map ecology, movement, map, and isolated write.');
}

async function reopenPhase(win) {
  await waitFor(win, 'Boolean(window.__aincrad)', 'reopened original test hook');
  const expected = JSON.parse(await fs.readFile(
    path.join(context.scratch, 'checkpoint.json'), 'utf8'));
  const oldBefore = await win.webContents.executeJavaScript(
    "localStorage.getItem('aincrad.save.v1')");
  assert.equal(digest(oldBefore), expected.oldHash,
    'Original save bytes changed across closed-process restart');
  assert.equal(oldBefore.length, expected.oldLength);
  await switchToOzark(win);
  const reopened = await snapshot(win);
  assert.equal(reopened.blocked, false, 'Reopened Ozark world is protected unexpectedly');
  assert.equal(reopened.started, false, 'A closed world must not simulate on boot');
  assert.equal(reopened.geometryIdentity, expected.geometryIdentity);
  assert.deepEqual(reopened.player, expected.checkpoint.player,
    'Player position did not survive the separate-profile disk restart');
  assert.deepEqual(reopened.playerBody, expected.checkpoint.playerBody,
    'Player bodily state did not survive the separate-profile disk restart');
  assert.equal(reopened.elapsed, expected.checkpoint.elapsed,
    'Closed time or load changed the simulation clock');
  for (const [index, agent] of reopened.agents.entries()) {
    const earlier = expected.checkpoint.agents[index];
    assert.equal(agent.id, earlier.id);
    assert.deepEqual(agent.position, earlier.position,
      agent.id + ' position changed across disk restart');
    assertEarlierEvidence(earlier, agent, agent.id);
  }
  assert.deepEqual(reopened.ecology, expected.ecology,
    'Ecology object counts changed across disk restart');
  const raw = await page(win, function readReopenedBytes() {
    return { ozark: localStorage.getItem('aincrad.ozark.v1'),
      old: localStorage.getItem('aincrad.save.v1'),
      fatal: !document.getElementById('fatal').classList.contains('hidden') };
  });
  assert.equal(raw.fatal, false, 'Reopened Ozark renderer displayed a fatal error');
  assert.equal(digest(raw.ozark), expected.ozarkHash,
    'Ozark disk bytes changed merely by loading the world');
  assert.equal(digest(raw.old), expected.oldHash,
    'Original save bytes changed merely by opening Ozark');
  assert.equal(await win.webContents.executeJavaScript('window.__ozarkWorld.start()'), true,
    'Reopened Ozark world could not resume');
  const reopenedScreenshot = await capture(win, 'world-reopened.png', 850);
  const minimapColors = await page(win, function inspectMinimap() {
    const canvas = document.getElementById('minimap');
    const g = canvas.getContext('2d');
    const colors = new Set();
    for (let y = 4; y < canvas.height; y += 13)
      for (let x = 4; x < canvas.width; x += 13)
        colors.add(Array.from(g.getImageData(x, y, 1, 1).data).join(','));
    return colors.size;
  });
  assert.ok(minimapColors >= 4, 'Reopened world minimap remained unrendered');
  await win.webContents.executeJavaScript(
    "window.dispatchEvent(new KeyboardEvent('keydown',{code:'Escape'}))");
  assert.equal((await snapshot(win)).paused, true);
  assert.equal(await win.webContents.executeJavaScript('window.__ozarkWorld.save()'), true);
  const beforeReturn = await win.webContents.executeJavaScript(
    "localStorage.getItem('aincrad.ozark.v1')");
  const originalLoad = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Original route did not load')), 40000);
    win.webContents.once('did-finish-load', () => { clearTimeout(timer); resolve(); });
  });
  void win.webContents.executeJavaScript(
    "document.getElementById('pause-original').click(); true").catch(() => {});
  await originalLoad;
  await waitFor(win, 'Boolean(window.__aincrad)', 'original route after returning');
  assert.match(win.webContents.getURL(), /^aincrad:\\/\\/app\\/index\\.html\\?test=1$/);
  const afterReturn = await page(win, function readBothAfterReturn() {
    return { old: localStorage.getItem('aincrad.save.v1'),
      ozark: localStorage.getItem('aincrad.ozark.v1') };
  });
  assert.equal(digest(afterReturn.old), expected.oldHash,
    'Returning to the original world changed its saved bytes');
  assert.equal(afterReturn.ozark, beforeReturn,
    'Returning to the original world changed Ozark saved bytes');
  const report = {
    passed: true, unpackagedElectron: true, isolatedFreshTempProfile: true,
    twoIndependentProcesses: true, nativeKeyboardMovement: true,
    separateHistoricalKeyBytesPreserved: true, ozarkDiskBytesUnchangedOnLoad: true,
    exactPlayerBodyAndClockRestored: true,
    earlierAgentProofAndPhysicalFeedbackRetained: true,
    fullMapRenderedAndZoomed: true, bothAgentsPresent: true,
    returnToOriginalPreservesBothKeys: true,
    sourceFingerprint: context.sourceFingerprint,
    geometryIdentity: expected.geometryIdentity, ecology: expected.ecology,
    plantExtent: expected.plantExtent, agentEvidence: expected.proof,
    nativeMovement: expected.nativeMovement, atlas: expected.map,
    reopenedMinimapColors: minimapColors,
    oldSaveSha256: expected.oldHash, ozarkSaveSha256: expected.ozarkHash,
    profile: path.join(context.scratch, 'profile'),
    screenshots: [...expected.screenshots, reopenedScreenshot],
  };
  await fs.writeFile(path.join(context.output, 'result.json'),
    JSON.stringify(report, null, 2) + '\\n');
  await session.defaultSession.flushStorageData();
  console.log('PASS: exact saved identity, player body, agent evidence, and both keys survive a closed-process restart.');
}

app.on('browser-window-created', (_event, win) => {
  win.webContents.once('did-finish-load', () => {
    if (running) return;
    running = true;
    (phase === 'write' ? writePhase(win) : reopenPhase(win))
      .then(() => { clearTimeout(deadline); app.quit(); })
      .catch(error => { console.error(error); clearTimeout(deadline); app.exit(1); });
  });
});
require(path.join(context.root, 'dist/desktop/main.cjs'));
`);

const electron = createRequire(import.meta.url)('electron');
for (const phase of ['write', 'reopen']) {
  const flags = [harness, '--test', `--test-profile=${join(scratch, 'profile')}`,
    `--phase=${phase}`];
  if (process.platform === 'linux') flags.push('--ozone-platform=headless', '--disable-gpu');
  if (process.getuid?.() === 0) flags.push('--no-sandbox');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const status = await new Promise((resolveStatus, reject) => {
    const child = spawn(electron, flags, { cwd: root, stdio: 'inherit', env });
    child.on('error', reject);
    child.on('exit', (code, signal) => resolveStatus({ code, signal }));
  });
  assert.deepEqual(status, { code: 0, signal: null },
    `Native ${phase} failed. Disposable data retained at ${scratch}`);
}
const result = JSON.parse(await readFile(join(output, 'result.json'), 'utf8'));
assert.equal(result.passed, true);
console.log(JSON.stringify({ result: join(output, 'result.json'),
  screenshots: result.screenshots.map(item => item.file),
  disposableProfile: result.profile,
  oldSaveSha256: result.oldSaveSha256,
  ozarkSaveSha256: result.ozarkSaveSha256 }, null, 2));
