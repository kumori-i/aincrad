import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { bootEntry, entryModuleFor } from '../src/entry.js';

test('only the exact isolated pilot query bypasses ordinary startup', async () => {
  assert.equal(entryModuleFor('?test=1&ozarkPilot=1'), './ozark-pilot-main.js');
  for (const query of [
    '', '?test=1', '?ozarkPilot=1', '?test=0&ozarkPilot=1',
    '?ozarkPilot=1&test=1', '?test=1&ozarkPilot=1&extra=1',
    '?test=1&ozarkPilot=1&ozarkPilot=1', undefined,
  ]) assert.equal(entryModuleFor(query), './main.js');
  const loaded = [];
  const load = async path => { loaded.push(path); return { path }; };
  assert.deepEqual(await bootEntry('', load), { path: './main.js' });
  assert.deepEqual(await bootEntry('?test=1&ozarkPilot=1', load),
    { path: './ozark-pilot-main.js' });
  assert.deepEqual(loaded, ['./main.js', './ozark-pilot-main.js']);
});

test('desktop entry is singular and the pilot contains no save or profile boot', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const pilot = await readFile(new URL('../src/ozark-pilot-main.js', import.meta.url), 'utf8');
  const desktop = await readFile(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  assert.deepEqual([...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)]
    .map(match => match[1]), ['./src/entry.js']);
  assert.doesNotMatch(pilot, /(?:localStorage|loadSave|writeSave|inspectProfileBoot|from ['"]\.\/main\.js['"])/);
  assert.match(desktop, /PILOT_REQUESTED&&\(SMOKE\|\|app\.isPackaged\|\|/);
  assert.match(desktop, /!process\.argv\.includes\('--test'\)/);
  assert.match(desktop, /!process\.argv\.some\(value=>value\.startsWith\('--test-profile='\)\)/);
  assert.match(desktop, /profileRoute\.kind!=='original'/);
  assert.match(desktop, /\?test=1&ozarkPilot=1/);
});

test('pilot starts fresh and walks without touching profile or storage APIs', async () => {
  const previous = new Map();
  for (const name of ['window', 'document', 'performance', 'setInterval',
    'requestAnimationFrame']) previous.set(name,
    Object.getOwnPropertyDescriptor(globalThis, name));
  const events = new Map();
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) {
      const classes = new Set(['hidden']);
      const listeners = new Map();
      elements.set(id, {
        textContent: '', classList: {
          add: name => classes.add(name), remove: name => classes.delete(name),
          contains: name => classes.has(name),
          toggle: (name, force) => {
            if (force ?? !classes.has(name)) classes.add(name);
            else classes.delete(name);
          },
        },
        addEventListener: (name, handler) => listeners.set(name, handler),
        dispatch: (name, event) => listeners.get(name)?.(event),
        querySelector: () => ({ textContent: '' }),
        focus() {},
        getContext: () => ({}),
      });
    }
    return elements.get(id);
  };
  let now = 0;
  let tick;
  const browser = {
    location: { search: '?test=1&ozarkPilot=1' },
    innerWidth: 800, innerHeight: 600, devicePixelRatio: 1,
    addEventListener: (name, handler) => events.set(name, handler),
  };
  Object.defineProperty(browser, 'localStorage', {
    get() { assert.fail('pilot read local storage'); },
  });
  Object.defineProperty(browser, 'aincradProfile', {
    get() { assert.fail('pilot opened a saved profile'); },
  });
  const doc = {
    getElementById: element,
    createElement: () => ({ getContext: () => ({}) }),
    querySelector: () => ({ classList: { add() {} } }),
    querySelectorAll: () => [],
    addEventListener() {},
    activeElement: null,
  };
  try {
    for (const [name, value] of Object.entries({
      window: browser, document: doc, performance: { now: () => now },
      setInterval: callback => { tick = callback; return 1; },
      requestAnimationFrame: () => 1,
    })) Object.defineProperty(globalThis, name,
      { configurable: true, writable: true, value });
    await import('../src/ozark-pilot-main.js');
    assert.equal(typeof browser.__ozarkPilot?.start, 'function');
    const before = browser.__ozarkPilot.snapshot();
    assert.equal(before.started, false);
    assert.equal(before.paused, false);
    assert.equal(before.observation.ground, 'dry-land');
    assert.match(before.profileIdentity, /^sha256:[a-f0-9]{64}$/);
    assert.equal(element('save-status').textContent, 'Unsaved wading pilot');
    browser.__ozarkPilot.start();
    assert.equal(browser.__ozarkPilot.snapshot().started, true);
    events.get('keydown')({ code: 'KeyD', preventDefault() {},
      ctrlKey: false, metaKey: false, altKey: false });
    now += 1000 / 60; tick();
    now += 1000 / 60; tick();
    assert.ok(browser.__ozarkPilot.snapshot().player.x > before.player.x);
    const dryEvidence = browser.__ozarkPilot.snapshot().lastActionEvidence;
    assert.equal(dryEvidence.action.type, 'move');
    assert.equal(dryEvidence.result.code, 'MOVED');
    assert.equal(dryEvidence.result.resistance, 'free');
    assert.ok(dryEvidence.result.displacement.x > 0);
    const press = code => events.get('keydown')({ code, preventDefault() {},
      ctrlKey: false, metaKey: false, altKey: false });
    const release = code => events.get('keyup')({ code });
    const advance = () => { now += 1000 / 60; tick(); };
    release('KeyD');
    press('KeyA');
    for (let index = 0; index < 300 &&
        browser.__ozarkPilot.snapshot().player.x > -1195; index += 1) advance();
    release('KeyA');
    assert.ok(browser.__ozarkPilot.snapshot().player.x <= -1195,
      'the dry route should reach the main-channel bank');
    press('KeyW');
    for (let index = 0; index < 120 &&
        browser.__ozarkPilot.snapshot().observation.ground !== 'shallow-water'; index += 1) {
      advance();
    }
    release('KeyW');
    const wading = browser.__ozarkPilot.snapshot();
    assert.equal(wading.observation.ground, 'shallow-water');
    assert.equal(wading.observation.currentCue, 'downstream');
    assert.ok(wading.wetness > 0 && wading.effort > 0);
    assert.equal(wading.lastActionEvidence.afterObservation.ground, 'shallow-water');
    assert.equal(wading.lastActionEvidence.result.wetness, 'wetter');
    assert.equal(wading.lastActionEvidence.result.effort, 'rising');
    assert.doesNotMatch(JSON.stringify(wading.lastActionEvidence),
      /depthProxy|inputTravel|requestedTravel|waterSeconds|currentDirection/);
    assert.equal(wading.lastActionEvidence.at, wading.elapsed);
    assert.ok(wading.lastActionEvidence.startedAt < wading.lastActionEvidence.at);
    for (let index = 0; index < 12; index += 1) advance();
    const drifting = browser.__ozarkPilot.snapshot();
    assert.ok(drifting.player.x > wading.player.x && drifting.player.y < wading.player.y,
      'the authored current can move an idle actor');
    assert.ok(drifting.elapsed > drifting.lastActionEvidence.at,
      'an idle drift must not masquerade as the previous attempted action');
    assert.deepEqual(drifting.lastActionEvidence, wading.lastActionEvidence);
    events.get('blur')();
    for (let index = 0; index < 30; index += 1) advance();
    const unfocused = browser.__ozarkPilot.snapshot();
    assert.deepEqual(unfocused.player, drifting.player,
      'focus loss should pause input and modeled current together');
    assert.equal(unfocused.wetness, drifting.wetness);
    assert.equal(unfocused.effort, drifting.effort);
    assert.equal(unfocused.elapsed, drifting.elapsed);
    events.get('focus')();
    press('KeyS');
    for (let index = 0; index < 120 &&
        browser.__ozarkPilot.snapshot().observation.ground !== 'dry-land'; index += 1) {
      advance();
    }
    release('KeyS');
    const ashore = browser.__ozarkPilot.snapshot();
    assert.equal(ashore.observation.ground, 'dry-land');
    assert.ok(ashore.wetness > 0, 'wetness should remain after leaving water');
    events.get('keydown')({ code: 'KeyS', ctrlKey: true, preventDefault() {} });
    assert.equal(element('save-status').textContent, 'Unsaved wading pilot');
    events.get('keydown')({ code: 'Escape', repeat: false,
      preventDefault() {} });
    assert.equal(browser.__ozarkPilot.snapshot().paused, true);
  } finally {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});
