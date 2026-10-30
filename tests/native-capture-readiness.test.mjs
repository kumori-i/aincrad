import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { captureWithReadiness, waitForCaptureFrames, conversationViewportEvidence } from '../scripts/native-capture-readiness.mjs';

const image = (size, empty = false) => ({ toPNG: () => Buffer.alloc(size, 7),
  getSize: () => ({ width: 1280, height: 800 }), isEmpty: () => empty });
const runCapture = Function('return (' + captureWithReadiness.toString() + ')')();
function fixture(images) {
  const records = [], state = { elapsed: 42, stock: 3, pending: true, saved: 'exact saved bytes' };
  let calls = 0, preparations = 0;
  return { records, state, calls: () => calls, preparations: () => preparations,
    options: { prepare: async () => { preparations++; return { readyState: 'complete' }; },
      capture: async () => images[Math.min(calls++, images.length - 1)],
      retain: async (png, metadata) => records.push({ png, metadata: structuredClone(metadata) }) } };
}

test('eventually ready retains exact rejected bytes and metadata without advancing fixture state', async () => {
  const f = fixture([image(0, true), image(10000), image(10001)]), before = structuredClone(f.state);
  const result = await runCapture(f.options);
  assert.equal(result.png.length, 10001); assert.equal(f.calls(), 3); assert.equal(f.preparations(), 3);
  assert.deepEqual(f.records.map(row => row.metadata.status), ['small-or-empty', 'small-or-empty', 'ready']);
  assert.deepEqual(f.records.map(row => row.png.length), [0, 10000, 10001]);
  assert.equal(f.records[1].png[0], 7); assert.equal(f.records[0].metadata.empty, true);
  assert.equal(f.records[1].metadata.width, 1280); assert.deepEqual(f.state, before);
});

test('persistent small and empty images fail at the bounded attempt count and retain all evidence', async () => {
  for (const bad of [image(10000), image(20000, true)]) {
    const f = fixture([bad]);
    await assert.rejects(runCapture(f.options), /after 4 attempts/);
    assert.equal(f.calls(), 4); assert.equal(f.records.length, 4);
    assert.ok(f.records.every(row => row.metadata.status === 'small-or-empty'));
  }
});

test('stalled readiness or capture times out, retains stage, and cannot later become success', async () => {
  for (const stage of ['readiness', 'capture']) {
    const f = fixture([image(20000)]);
    let release;
    f.options[stage === 'readiness' ? 'prepare' : 'capture'] = () => new Promise(resolve => { release = resolve; });
    await assert.rejects(runCapture({ ...f.options, timeoutMs: 20 }), /timed out/);
    assert.equal(f.records.length, 1); assert.equal(f.records[0].metadata.stage, stage);
    assert.equal(f.records[0].metadata.status, 'error'); assert.equal(f.records[0].png, undefined);
    release(stage === 'capture' ? image(20000) : {});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.records.length, 1); assert.ok(f.calls() <= 1);
  }
});

test('encoding past deadline fails and preserves captured bytes', async () => {
  const f = fixture([image(20000)]); let clock = 0;
  f.options.capture = async () => ({ ...image(20000), toPNG: () => { clock = 100; return Buffer.alloc(20000); } });
  await assert.rejects(runCapture({ ...f.options, timeoutMs: 100, now: () => clock }), /timed out/);
  assert.equal(f.records[0].png.length, 20000); assert.equal(f.records[0].metadata.status, 'error');
});

test('renderer and capture errors are not retried or masked', async () => {
  for (const stage of ['prepare', 'capture']) {
    const f = fixture([image(20000)]);
    f.options[stage] = async () => { throw new Error('original failure'); };
    await assert.rejects(runCapture(f.options), /original failure/);
    assert.equal(f.records.length, 1); assert.equal(f.records[0].metadata.status, 'error');
  }
});

test('readiness waits for optional refinement and two frames without ticking or saving state', async () => {
  for (const aquatic of [true, false]) {
    const events = [], state = { elapsed: 10, stocks: [1, 2], saved: 'unchanged' };
    const before = structuredClone(state);
    const ready = vm.runInNewContext('(' + waitForCaptureFrames.toString() + ')', {
      window: { __ozarkWorld: { state, tick: () => state.elapsed++, save: () => { state.saved = 'changed'; } },
        ...(aquatic ? { __aquaticQa: { state, settleDraw: async () => events.push('refine'),
          tick: () => state.elapsed++, save: () => { state.saved = 'changed'; },
          action: () => state.stocks.pop() } } : {}) },
      document: { readyState: 'complete', visibilityState: 'visible' },
      requestAnimationFrame: callback => { events.push('frame'); queueMicrotask(callback); },
    });
    assert.equal((await ready()).readyState, 'complete');
    assert.deepEqual(events, aquatic ? ['refine', 'frame', 'frame'] : ['frame', 'frame']);
    assert.deepEqual(state, before);
  }
});

function conversationDOM() {
  const area = (left, top, right, bottom) => ({ left, top, right, bottom, width: right - left, height: bottom - top });
  const nodes = new Map(), state = { covered: false, world: { elapsed: 42, learned: 1, saved: 'exact' } };
  const node = (id, bounds, parent = null) => {
    const value = { id, nodeType: 1, parentElement: parent, bounds, dataset: {}, hidden: false,
      classList: { contains(name) { return name === 'hidden' && value.hidden; } },
      getBoundingClientRect() { return this.bounds; },
      contains(other) { for (let current = other; current; current = current.parentElement) if (current === this) return true; return false; },
      getAttribute() { return null; }, querySelectorAll() { return []; }, querySelector() { return null; } };
    nodes.set(id, value); return value;
  };
  const app = node('app', area(0, 0, 1280, 800)); app.dataset.inspecting = 'true';
  const panel = node('npc-panel', area(900, 20, 1260, 780), app); panel.dataset.journalTab = 'conversation';
  const tab = node('npc-tab-conversation', area(930, 80, 1200, 120), panel);
  tab.getAttribute = name => name === 'aria-pressed' ? 'true' : null;
  const section = node('journal-conversation', area(920, 140, 1240, 740), panel);
  const journal = node('journal-messages', area(930, 180, 1230, 600), section);
  const entry = node('entry', area(940, 200, 1220, 390), journal); entry.dataset.learningEvent = '1';
  const emitted = node('emitted', area(960, 230, 1100, 250), entry); emitted.textContent = 'abc';
  const action = node('action', area(950, 280, 1190, 320), entry); action.textContent = 'recipient completed paid inspect_object';
  journal.querySelectorAll = selector => selector === 'article[data-learning-event]' ? [entry] : [];
  entry.querySelector = selector => selector === '[data-character-message="true"]' ? emitted : null;
  entry.querySelectorAll = selector => selector === 'p' ? [action] : [];
  for (const id of ['world-loading', 'pause-panel', 'recovery-panel']) node(id, area(0, 0, 1280, 800), app).hidden = true;
  const document = { getElementById: id => nodes.get(id) ?? null,
    elementFromPoint(x, y) {
      if (state.covered) return nodes.get('pause-panel');
      for (const candidate of [emitted, action, tab, journal, section, panel, app]) {
        const b = candidate.bounds;
        if (x >= b.left && x <= b.right && y >= b.top && y <= b.bottom) return candidate;
      }
      return null;
    } };
  const window = { innerWidth: 1280, innerHeight: 800,
    getComputedStyle: element => ({ display: element.hidden ? 'none' : 'block', visibility: 'visible', opacity: '1' }) };
  return { nodes, state, document, window, entry, emitted, action };
}

test('serialized Conversation readiness requires the visible exact message and recipient action without changing state', () => {
  const dom = conversationDOM(), before = structuredClone(dom.state.world);
  const inspect = vm.runInNewContext('(' + conversationViewportEvidence.toString() + ')');
  const evidence = inspect(dom.document, dom.window, { eventId: 1, message: 'abc', actionText: 'recipient completed paid inspect_object' });
  assert.deepEqual({ ...evidence.panel }, { left: 900, right: 1260, top: 20, bottom: 780, width: 360, height: 760 });
  assert.equal(evidence.message.left, 960); assert.equal(evidence.action.bottom, 320);
  assert.deepEqual(dom.state.world, before);
});

test('Conversation readiness rejects covered, hidden, offscreen and stale-message captures', () => {
  const inspect = vm.runInNewContext('(' + conversationViewportEvidence.toString() + ')');
  const witness = { eventId: 1, message: 'abc', actionText: 'recipient completed paid inspect_object' };
  for (const breakView of [
    dom => { dom.nodes.get('npc-panel').hidden = true; },
    dom => { dom.nodes.get('journal-conversation').hidden = true; },
    dom => { dom.nodes.get('pause-panel').hidden = false; },
    dom => { dom.nodes.get('journal-messages').bounds.right = 1400; },
    dom => { dom.state.covered = true; },
    dom => { dom.emitted.textContent = 'xyz'; },
    dom => { dom.action.bounds.top = 620; dom.action.bounds.bottom = 650; },
  ]) {
    const dom = conversationDOM(); breakView(dom);
    assert.throws(() => inspect(dom.document, dom.window, witness));
  }
});

test('harness preserves size assertion, sandbox, and source checks and retains attempts beside screenshots', async () => {
  const source = await readFile(new URL('../scripts/verify-aquatic-desktop.mjs', import.meta.url), 'utf8');
  assert.match(source, /assert\.ok\(png\.length > 10000\)/);
  assert.match(source, /disabling the Chromium sandbox is not permitted/);
  assert.match(source, /nativeSourceIdentity\(root\)/);
  assert.match(source, /assertCurrentRoute\(current\)/);
  assert.match(source, /name \+ '\.attempt-' \+ attempt\.attempt/);
  assert.match(source, /if \(bytes !== undefined\) await fs\.writeFile/);
  assert.ok(source.includes("assert.equal(process.argv.includes('--no-sandbox'),false)"));
});


test('prepared native runner executes readiness retries and persists original attempts to disk', async () => {
  const output = await mkdtemp(join(tmpdir(), 'aq-capture-test-'));
  try {
    const prepared = spawnSync(process.execPath, ['scripts/verify-aquatic-desktop.mjs', '--prepare-only'],
      { encoding: 'utf8', timeout: 120000, env: { ...process.env, AINCRAD_AQUATIC_QA_OUTPUT: output } });
    assert.equal(prepared.status, 0, prepared.stderr);
    const manifest = JSON.parse(prepared.stdout.trim());
    assert.equal(manifest.nativeExecutionPerformed, false);
    const source = await readFile(manifest.harness, 'utf8');
    assert.equal(spawnSync(process.execPath, ['--check', manifest.harness]).status, 0);
    const app = new EventEmitter(), require = createRequire(import.meta.url);
    const capture = vm.runInNewContext(source + '\ncapture;', {
      require: name => name === 'electron' ? { app, session: {} } :
        name.endsWith('main.cjs') ? {} : require(name),
      process: { argv: ['runner', '--phase=naming-reopen'] }, console, performance,
      setTimeout: (callback, ms) => ms === 600000 ? 0 : setTimeout(callback, ms), clearTimeout,
    });
    let attempts = 0, readiness = 0;
    const result = await capture({ webContents: {
      executeJavaScript: async expression => {
        readiness++; assert.match(expression, /requestAnimationFrame/);
        return { readyState: 'complete', visibilityState: 'visible' };
      },
      capturePage: async () => image(++attempts === 1 ? 123 : 20000),
    } }, 'checkpoint.png');
    assert.equal(result.captureAttempts, 2); assert.equal(readiness, 2);
    assert.equal((await readFile(join(manifest.output, 'checkpoint.png.attempt-1.png'))).length, 123);
    const rejected = JSON.parse(await readFile(join(manifest.output, 'checkpoint.png.attempt-1.json')));
    assert.equal(rejected.phase, 'naming-reopen'); assert.equal(rejected.status, 'small-or-empty');
    assert.equal(rejected.bytes, 123);
    assert.equal((await readFile(result.file)).length, 20000);
  } finally { await rm(output, { recursive: true, force: true }); }
});
