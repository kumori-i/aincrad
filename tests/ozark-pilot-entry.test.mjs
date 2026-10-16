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
    assert.equal(element('save-status').textContent, 'Unsaved walking pilot');
    browser.__ozarkPilot.start();
    assert.equal(browser.__ozarkPilot.snapshot().started, true);
    events.get('keydown')({ code: 'KeyD', preventDefault() {},
      ctrlKey: false, metaKey: false, altKey: false });
    now += 1000 / 60; tick();
    now += 1000 / 60; tick();
    assert.ok(browser.__ozarkPilot.snapshot().player.x > before.player.x);
    events.get('keydown')({ code: 'KeyS', ctrlKey: true, preventDefault() {} });
    assert.equal(element('save-status').textContent, 'Unsaved walking pilot');
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
