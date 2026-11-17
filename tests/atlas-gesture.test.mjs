import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { atlasEventPoint, installAtlasGesture } from '../src/atlas-gesture.js';

// Event mocks only: these tests neither start a world nor instantiate Canvas.
class Target {
  handlers = new Map();
  addEventListener(type, handler) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(handler);
  }
  removeEventListener(type, handler) { this.handlers.get(type)?.delete(handler); }
  fire(type, overrides = {}) {
    const event = { pointerId: 1, isPrimary: true, button: type === 'pointermove' ? -1 : 0,
      buttons: type === 'pointerup' ? 0 : 1, clientX: 100, clientY: 100,
      currentTarget: this, preventDefault() { this.prevented = true; }, ...overrides };
    if (type === 'lostpointercapture') this.captures?.delete(event.pointerId);
    for (const handler of [...(this.handlers.get(type) || [])]) handler(event);
    return event;
  }
  focus() {}
  querySelector() { return new Target(); }
}
class Atlas extends Target {
  width = 1000;
  height = 640;
  rect = { left: 0, top: 0, width: 1000, height: 640 };
  captures = new Set();
  captureCalls = [];
  getBoundingClientRect() { return this.rect; }
  setPointerCapture(id) {
    this.captureCalls.push(['set', id]);
    if (this.captureMode === 'throw') throw new Error('inactive pointer');
    if (this.captureMode === 'ignore') return;
    this.captures.add(id);
    if (this.captureMode === 'throw-after-set') throw new Error('capture failed');
  }
  hasPointerCapture(id) {
    if (this.queryFails) throw new Error('detached target');
    return this.captures.has(id);
  }
  releasePointerCapture(id) {
    this.captureCalls.push(['release', id]);
    if (this.releaseFails) throw new Error('ended pointer');
    this.captures.delete(id);
    // Exercise reentrancy, even though native capture events may be deferred.
    this.fire('lostpointercapture', { pointerId: id });
    this.onRelease?.();
  }
}
function setup() {
  const atlas = new Atlas(), pans = [], clicks = [];
  const state = { enabled: true };
  const api = installAtlasGesture({ atlas, enabled: () => state.enabled,
    onPan: (dx, dy) => pans.push([dx, dy]), onClick: point => clicks.push(point) });
  return { atlas, pans, clicks, state, api };
}
const click = atlas => { atlas.fire('pointerdown'); atlas.fire('pointerup'); };

test('event coordinates use the displayed canvas scale and offset, allowing captured moves outside', () => {
  const atlas = new Atlas();
  atlas.rect = { left: 10, top: 20, width: 500, height: 320 };
  assert.deepEqual(atlasEventPoint(atlas, { clientX: 110, clientY: 70 }), { x: 200, y: 100 });
  assert.deepEqual(atlasEventPoint(atlas, { clientX: -10, clientY: 350 }), { x: -40, y: 660 });
});

test('coordinate conversion rejects invalid events, zero/invalid dimensions and numeric overflow', () => {
  for (const key of ['clientX', 'clientY']) for (const value of [NaN, Infinity, -Infinity, undefined, '100']) {
    const atlas = new Atlas();
    assert.equal(atlasEventPoint(atlas, { clientX: 100, clientY: 100, [key]: value }), null);
  }
  for (const key of ['left', 'top', 'width', 'height']) for (const value of [NaN, Infinity, undefined]) {
    const atlas = new Atlas(); atlas.rect[key] = value;
    assert.equal(atlasEventPoint(atlas, { clientX: 100, clientY: 100 }), null);
  }
  for (const target of ['rect', 'canvas']) for (const key of ['width', 'height'])
    for (const value of [0, -1, NaN, Infinity]) {
      const atlas = new Atlas(); (target === 'rect' ? atlas.rect : atlas)[key] = value;
      assert.equal(atlasEventPoint(atlas, { clientX: 100, clientY: 100 }), null);
    }
  const atlas = new Atlas(); atlas.rect.width = Number.MIN_VALUE;
  assert.equal(atlasEventPoint(atlas, { clientX: 100, clientY: 100 }), null);
});

test('stationary and within-threshold clicks fire once at release and retire capture first', () => {
  for (const distance of [0, 1, 2]) {
    const f = setup(); f.atlas.fire('pointerdown');
    f.atlas.fire('pointermove', { clientX: 100 + distance });
    f.atlas.onRelease = () => f.atlas.fire('pointerup');
    f.atlas.fire('pointerup', { clientX: 100 + distance });
    f.atlas.fire('pointerup');
    assert.deepEqual(f.clicks, [{ x: 100 + distance, y: 100 }]);
    assert.deepEqual(f.pans, []);
    assert.deepEqual(f.atlas.captureCalls, [['set', 1], ['release', 1]]);
    assert.equal(f.atlas.captures.size, 0);
  }
});

test('many one-pixel moves become a drag without creating a waypoint click', () => {
  const f = setup(); f.atlas.fire('pointerdown');
  for (let x = 101; x <= 110; x++) f.atlas.fire('pointermove', { clientX: x });
  f.atlas.fire('pointerup', { clientX: 110 });
  assert.deepEqual(f.pans, Array.from({ length: 8 }, () => [1, 0]));
  assert.deepEqual(f.clicks, []);
});

test('diagonal and negative displacement crosses the threshold; pan uses only the last-point delta', () => {
  const f = setup(); f.atlas.fire('pointerdown');
  f.atlas.fire('pointermove', { clientX: 99, clientY: 99 });
  f.atlas.fire('pointermove', { clientX: 98, clientY: 98 });
  f.atlas.fire('pointermove', { clientX: 90, clientY: 95 });
  f.atlas.fire('pointermove', { clientX: 90, clientY: 95 });
  f.atlas.fire('pointerup', { clientX: 90, clientY: 95 });
  assert.deepEqual(f.pans, [[-1, -1], [-8, -3]]);
  assert.deepEqual(f.clicks, []);
});

test('a drag returning to its origin stays a drag; bounded jitter remains a click', () => {
  const f = setup(); f.atlas.fire('pointerdown');
  f.atlas.fire('pointermove', { clientX: 110 });
  f.atlas.fire('pointermove'); f.atlas.fire('pointerup');
  assert.deepEqual(f.pans, [[10, 0], [-10, 0]]); assert.deepEqual(f.clicks, []);
  f.atlas.fire('pointerdown');
  for (let i = 0; i < 20; i++) f.atlas.fire('pointermove', { clientX: i % 2 ? 99 : 101 });
  f.atlas.fire('pointerup');
  assert.deepEqual(f.clicks, [{ x: 100, y: 100 }]);
});

test('release displacement cannot become a click when no final pointermove was delivered', () => {
  for (const moves of [[], [101, 102]]) {
    const f = setup(); f.atlas.fire('pointerdown');
    for (const x of moves) f.atlas.fire('pointermove', { clientX: x });
    f.atlas.fire('pointerup', { clientX: 103 });
    assert.deepEqual(f.clicks, []); assert.equal(f.atlas.captures.size, 0);
  }
});

test('one owner ignores other pointers, duplicate downs and their cancellation or release', () => {
  const f = setup(); f.atlas.fire('pointerdown');
  f.atlas.fire('pointerdown', { clientX: 400 });
  f.atlas.fire('pointerdown', { pointerId: 2 });
  for (const type of ['pointermove', 'pointercancel', 'lostpointercapture', 'pointerup'])
    f.atlas.fire(type, { pointerId: 2, clientX: 500 });
  f.atlas.fire('pointerup'); f.atlas.fire('pointerup', { pointerId: 2 });
  assert.deepEqual(f.clicks, [{ x: 100, y: 100 }]);
  assert.deepEqual(f.pans, []);
  assert.deepEqual(f.atlas.captureCalls, [['set', 1], ['release', 1]]);
});

test('nonprimary pointers, other buttons, invalid IDs and off-canvas starts cannot own a gesture', () => {
  for (const overrides of [{ isPrimary: false }, { isPrimary: undefined }, { button: 1 }, { button: 2 },
    { buttons: 0 }, { buttons: 3 }, { pointerId: NaN }, { pointerId: -1 }, { pointerId: 1.5 },
    { pointerId: undefined }, { clientX: -1 }, { clientX: 1001 }, { clientY: -1 }, { clientY: 641 }]) {
    const f = setup(); f.atlas.fire('pointerdown', overrides); f.atlas.fire('pointerup');
    assert.deepEqual(f.atlas.captureCalls, []); assert.deepEqual(f.clicks, []);
    click(f.atlas); assert.equal(f.clicks.length, 1);
  }
});

test('lost primary/button state cancels instead of leaving a pending click', () => {
  for (const [type, overrides] of [['pointermove', { buttons: 0 }], ['pointermove', { buttons: 2 }],
    ['pointermove', { buttons: 3 }], ['pointermove', { isPrimary: false }],
    ['pointerup', { button: 2 }], ['pointerup', { buttons: 1 }], ['pointerup', { isPrimary: false }]]) {
    const f = setup(); f.atlas.fire('pointerdown'); f.atlas.fire(type, overrides);
    f.atlas.fire('pointerup'); assert.deepEqual(f.clicks, []);
    assert.equal(f.atlas.captures.size, 0);
  }
});

test('cancel, lost capture and explicit invalidation reject all stale events and allow a new gesture', () => {
  for (const interruption of ['pointercancel', 'lostpointercapture', 'cancel']) {
    const f = setup(); f.atlas.fire('pointerdown');
    if (interruption === 'cancel') { f.api.cancel(); f.api.cancel(); }
    else f.atlas.fire(interruption);
    f.atlas.fire('pointermove', { clientX: 105 }); f.atlas.fire('pointerup');
    assert.deepEqual(f.pans, []); assert.deepEqual(f.clicks, []);
    assert.equal(f.atlas.captures.size, 0);
    click(f.atlas); assert.equal(f.clicks.length, 1);
  }
});

test('capture acquisition, query and release errors fail closed without throwing or retaining click authority', () => {
  for (const mode of ['throw', 'ignore', 'throw-after-set', 'missing-set', 'query-fails']) {
    const f = setup(); f.atlas.captureMode = mode;
    if (mode === 'missing-set') f.atlas.setPointerCapture = undefined;
    if (mode === 'query-fails') f.atlas.queryFails = true;
    assert.doesNotThrow(() => { f.atlas.fire('pointerdown'); f.atlas.fire('pointerup'); });
    assert.deepEqual(f.clicks, []);
    f.api.cancel(); f.atlas.fire('pointerup'); assert.deepEqual(f.clicks, []);
  }
  for (const queryFails of [false, true]) {
    const f = setup(); f.atlas.fire('pointerdown');
    f.atlas.queryFails = queryFails; f.atlas.releaseFails = true;
    assert.doesNotThrow(() => f.api.cancel());
    f.atlas.queryFails = false; f.atlas.releaseFails = false;
    f.atlas.fire('pointerup'); assert.deepEqual(f.clicks, []);
    click(f.atlas); assert.equal(f.clicks.length, 1);
  }
});

test('capture loss detected before its notification also cancels move and release', () => {
  for (const type of ['pointermove', 'pointerup']) {
    const f = setup(); f.atlas.fire('pointerdown'); f.atlas.captures.clear();
    f.atlas.fire(type); f.atlas.fire('pointerup');
    assert.deepEqual(f.clicks, []); assert.deepEqual(f.pans, []);
  }
});

test('invalid coordinates or hidden dimensions during a gesture invalidate rather than resume later', () => {
  for (const type of ['pointermove', 'pointerup']) for (const invalid of ['x', 'y', 'size']) {
    const f = setup(); f.atlas.fire('pointerdown');
    if (invalid === 'size') f.atlas.rect.width = 0;
    f.atlas.fire(type, invalid === 'x' ? { clientX: NaN } : invalid === 'y' ? { clientY: Infinity } : {});
    f.atlas.rect.width = 1000;
    f.atlas.fire('pointerup'); assert.deepEqual(f.clicks, []); assert.deepEqual(f.pans, []);
    click(f.atlas); assert.equal(f.clicks.length, 1);
  }
});

test('captured drags may pan beyond the element but an outside release cannot click', () => {
  const f = setup(); f.atlas.fire('pointerdown');
  f.atlas.fire('pointermove', { clientX: -100 });
  f.atlas.fire('pointerup', { clientX: -100 });
  assert.deepEqual(f.pans, [[-200, 0]]); assert.deepEqual(f.clicks, []);
  f.atlas.fire('pointerdown', { clientX: 0 });
  f.atlas.fire('pointerup', { clientX: -1 }); assert.deepEqual(f.clicks, []);
});

test('availability gates every phase, and disposal removes listeners and pending input', () => {
  for (const type of ['pointermove', 'pointerup']) {
    const f = setup(); f.state.enabled = false; click(f.atlas);
    assert.deepEqual(f.atlas.captureCalls, []);
    f.state.enabled = true; f.atlas.fire('pointerdown'); f.state.enabled = false;
    f.atlas.fire(type); f.state.enabled = true; f.atlas.fire('pointerup');
    assert.deepEqual(f.clicks, []); click(f.atlas); assert.equal(f.clicks.length, 1);
  }
  const f = setup(); f.atlas.fire('pointerdown'); f.api.dispose(); f.api.dispose();
  f.atlas.fire('pointerup'); click(f.atlas);
  assert.deepEqual(f.clicks, []); assert.equal(f.atlas.captures.size, 0);
  assert.equal([...f.atlas.handlers.values()].reduce((n, handlers) => n + handlers.size, 0), 0);
});

const main = await readFile(new URL('../src/ozark-world-main.js', import.meta.url), 'utf8');
function section(start, end) {
  const from = main.indexOf(start), to = main.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Missing integration section: ${start}`);
  return main.slice(from, to);
}
function mainInput() {
  const atlas = new Atlas(), window = new Target(), document = new Target(), nodes = new Map();
  const calls = { pan: [], center: [], zoom: [], saves: 0, updates: 0, fit: 0, timerStops: 0 };
  nodes.set('atlas-map', atlas); document.hidden = false;
  let nativeActive, reset;
  window.aincradAgent = { onWindowActive: callback => { nativeActive = callback; } };
  const context = { window, document, atlasEventPoint, installAtlasGesture, atlasGesture: null,
    $: id => { if (!nodes.has(id)) nodes.set(id, new Target()); return nodes.get(id); },
    started: true, panel: 'map', paused: false, windowFocused: true, resetHeld: false, resetRetired: false,
    loaded: { blocked: false }, state: { waypoint: null }, keys: new Set(['KeyW']), anim: { moving: true },
    storage: {}, simulationTimer: 42, performance: { now: () => 100 }, clock: { reset() {} },
    hide() {}, show() {}, cancelPlayerFood() {}, cancelPlayerLesson() {},
    playerFoodController: null, playerLessonController: null, communicationInspector: null,
    communicationLearning: null, population: null, npcPanel: null,
    clearInterval: () => { calls.timerStops++; }, installWorldReset: options => { reset = options; },
    geometry: { canOccupy: () => true },
    renderer: { atlasPan: (x, y) => calls.pan.push([x, y]), atlasMarkerAt: () => null,
      atlasPoint: (x, y) => ({ x, y }), atlasCenter: id => calls.center.push(id),
      atlasZoom: (...args) => calls.zoom.push(args), atlasFit: () => { calls.fit++; }, resize() {} },
    updateAtlas: () => { calls.updates++; }, save: () => { calls.saves++; },
  };
  // Execute the actual production callbacks with inert dependencies. Do not
  // import main: its top-level world generation, timers and rendering are excluded.
  vm.runInNewContext([
    section('function closePanel()', 'function updateAtlas()'),
    section('installWorldReset({', "$('open-map').addEventListener"),
    section("window.addEventListener('keydown'", '// Local test hooks exist'),
  ].join('\n'), context, { filename: 'ozark-world-main-input-only.js' });
  return { atlas, window, document, context, calls, reset, nativeActive };
}

test('main integration: click saves one occupiable waypoint; marker centers without saving', () => {
  const f = mainInput(); click(f.atlas);
  assert.deepEqual(f.context.state.waypoint, { x: 100, y: 100 });
  assert.equal(f.calls.saves, 1); assert.equal(f.calls.updates, 1);
  f.context.renderer.atlasMarkerAt = () => 'aster'; click(f.atlas);
  assert.deepEqual(f.calls.center, ['aster']); assert.equal(f.calls.saves, 1);
  f.context.renderer.atlasMarkerAt = () => null;
  f.context.geometry.canOccupy = () => false; click(f.atlas); assert.equal(f.calls.saves, 1);
  f.context.geometry.canOccupy = () => true; f.context.renderer.atlasPoint = () => null;
  click(f.atlas); assert.equal(f.calls.saves, 1);
});

test('main integration: gradual drag pans without changing or saving an existing waypoint', () => {
  const f = mainInput(), waypoint = { x: 500, y: 600 }; f.context.state.waypoint = waypoint;
  f.atlas.fire('pointerdown');
  for (let x = 101; x <= 108; x++) f.atlas.fire('pointermove', { clientX: x });
  f.atlas.fire('pointerup', { clientX: 108 });
  assert.equal(f.context.state.waypoint, waypoint); assert.equal(f.calls.saves, 0);
  assert.equal(f.calls.pan.length, 6); assert.equal(f.calls.updates, 6);
});

test('main integration: blur, visibility, native activation, panels, pause and reset discard stale pointerup', () => {
  const scenarios = [
    f => { f.window.fire('blur'); f.window.fire('focus'); },
    f => { f.document.hidden = true; f.document.fire('visibilitychange');
      f.document.hidden = false; f.document.fire('visibilitychange'); },
    f => { f.nativeActive(false); f.nativeActive(true); },
    f => { f.context.closePanel(); f.context.openPanel('map'); },
    f => { f.context.openPanel('help'); f.context.openPanel('map'); },
    f => { f.context.setPause(true); f.context.setPause(false); f.context.openPanel('map'); },
    f => { f.reset.freeze(); f.reset.release(); f.context.setPause(false); f.context.openPanel('map'); },
  ];
  for (const interrupt of scenarios) {
    const f = mainInput(); f.atlas.fire('pointerdown'); interrupt(f);
    f.atlas.fire('pointerup');
    assert.equal(f.calls.saves, 0); assert.equal(f.context.state.waypoint, null);
    assert.equal(f.atlas.captures.size, 0); assert.equal(f.context.keys.size, 0);
    assert.equal(f.context.anim.moving, false);
    click(f.atlas); assert.equal(f.calls.saves, 1);
  }
});

test('main integration: page exit saves retain existing behavior but do not retain click authority', () => {
  for (const type of ['pagehide', 'beforeunload']) {
    const f = mainInput(); f.atlas.fire('pointerdown'); f.window.fire(type);
    assert.equal(f.calls.saves, 1); assert.equal(f.atlas.captures.size, 0);
    f.atlas.fire('pointerup'); assert.equal(f.calls.saves, 1); assert.equal(f.context.state.waypoint, null);
  }
});

test('main integration: terminal reset retires input, while unavailable map states never start it', () => {
  const f = mainInput(); f.atlas.fire('pointerdown'); f.reset.retire();
  f.atlas.fire('pointerup'); click(f.atlas);
  assert.equal(f.calls.saves, 0); assert.equal(f.atlas.captures.size, 0); assert.equal(f.calls.timerStops, 1);
  for (const disable of [g => { g.context.started = false; }, g => { g.context.panel = null; },
    g => { g.context.panel = 'help'; }, g => { g.context.resetHeld = true; },
    g => { g.context.resetRetired = true; }, g => { g.context.loaded.blocked = true; },
    g => { g.context.windowFocused = false; }, g => { g.document.hidden = true; }]) {
    const g = mainInput(); disable(g); click(g.atlas);
    assert.equal(g.calls.saves, 0); assert.deepEqual(g.atlas.captureCalls, []);
  }
});

test('main integration: wheel/button zoom, fit, centering and explicit waypoint clearing remain intact', () => {
  const f = mainInput();
  const wheel = f.atlas.fire('wheel', { deltaY: -100 });
  assert.equal(wheel.prevented, true);
  assert.deepEqual(f.calls.zoom, [[Math.exp(.15), 100, 100]]);
  for (const id of ['atlas-zoom-in', 'atlas-zoom-out', 'atlas-fit', 'atlas-center-you',
    'atlas-center-aster', 'atlas-center-mira']) f.context.$(id).fire('click');
  assert.deepEqual(f.calls.zoom.slice(1), [[1.35], [1 / 1.35]]);
  assert.equal(f.calls.fit, 1); assert.deepEqual(f.calls.center, ['you', 'aster', 'mira']);
  f.context.state.waypoint = { x: 1, y: 2 }; f.atlas.fire('pointerdown');
  assert.equal(f.atlas.fire('contextmenu').prevented, true);
  f.atlas.fire('pointerup'); assert.equal(f.context.state.waypoint, null); assert.equal(f.calls.saves, 1);
});

test('main integration: transform controls invalidate pending gestures, including while paused', () => {
  const transforms = [
    f => f.atlas.fire('wheel', { deltaY: -100 }),
    f => f.window.fire('resize'),
    ...['atlas-zoom-in', 'atlas-zoom-out', 'atlas-fit', 'atlas-center-you',
      'atlas-center-aster', 'atlas-center-mira'].map(id => f => f.context.$(id).fire('click')),
    ...['Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract'].map(code => f => f.window.fire('keydown', { code })),
  ];
  for (const paused of [false, true]) for (const transform of transforms) {
    const f = mainInput(); f.context.paused = paused;
    f.atlas.fire('pointerdown'); transform(f); f.atlas.fire('pointerup');
    assert.equal(f.calls.saves, 0); assert.equal(f.context.state.waypoint, null);
    assert.equal(f.atlas.captures.size, 0);
    click(f.atlas); assert.equal(f.calls.saves, 1);
  }
});

test('main integration: invalid and unavailable wheel/context events cannot change the map or save', () => {
  const f = mainInput();
  for (const deltaY of [NaN, Infinity, -Infinity, undefined, 1e10, -1e10]) f.atlas.fire('wheel', { deltaY });
  f.atlas.fire('wheel', { deltaY: 100, clientX: NaN });
  f.atlas.rect.width = 0; f.atlas.fire('wheel', { deltaY: 100 }); f.atlas.rect.width = 1000;
  assert.deepEqual(f.calls.zoom, []);
  const waypoint = { x: 10, y: 20 }; f.context.state.waypoint = waypoint; f.context.closePanel();
  f.atlas.fire('wheel', { deltaY: 100 }); f.atlas.fire('contextmenu');
  assert.deepEqual(f.calls.zoom, []); assert.equal(f.context.state.waypoint, waypoint);
  assert.equal(f.calls.saves, 0);
});
