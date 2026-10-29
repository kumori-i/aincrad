import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installCommunicationExperiment, paintCommunicationPixels } from '../src/communication-experiment-ui.js';
class Element {
  constructor() { this.handlers = {}; this.value = ''; this.width = this.height = 16; }
  addEventListener(type, fn) { (this.handlers[type] ??= []).push(fn); }
  removeEventListener(type, fn) { this.handlers[type] = this.handlers[type].filter(f => f !== fn); }
  fire(type, options = {}) { const e = { preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...options }; for (const fn of this.handlers[type] || []) fn(e); return e; }
  focus() { this.focused = true; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  getBoundingClientRect() { return { width: 800, height: 450 }; }
  getContext() { return { clearRect() {}, createImageData: () => ({ data: new Uint8ClampedArray(1024) }), putImageData: image => { this.image = image; } }; }
}
function fixture(overrides = {}) {
  const nodes = new Map(), window = new Element();
  const $ = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  const document = { getElementById: $ };
  $('communication-seed').value = '1'; $('communication-enabled').checked = true;
  $('communication-speed').value = '1'; $('communication-follow').value = 'aster';
  const timers = new Map(), frames = new Map(), sessions = [], sensors = [], events = [], draws = [];
  let time = 0, nextId = 0;
  window.setInterval = fn => { timers.set(++nextId, fn); return nextId; };
  window.clearInterval = id => timers.delete(id);
  window.requestAnimationFrame = fn => { frames.set(++nextId, fn); return nextId; };
  window.cancelAnimationFrame = id => frames.delete(id);
  const api = installCommunicationExperiment({ document, window, geometry: Object.freeze({}), now: () => time,
    onEnter: () => events.push('enter'), onExit: () => events.push('exit'),
    createPixelSensor: () => { const sensor = { disposed: 0, dispose() { this.disposed++; } }; sensors.push(sensor); return sensor; },
    createExperiment: options => { const session = { options, elapsed: 0, disposed: 0, state: { selectedAgentId: 'aster' }, tick(dt) { this.elapsed += dt; }, snapshot() { return { elapsed: this.elapsed }; }, dispose() { this.disposed++; } }; sessions.push(session); return session; },
    createRenderer: () => ({ resize() {}, draw(state) { draws.push(state); } }), ...overrides });
  return { api, $, window, events, sessions, sensors, timers, frames, draws,
    advance(dt) { time += dt; for (const fn of timers.values()) fn(); },
    paint() { const pending = [...frames.values()]; frames.clear(); for (const fn of pending) fn(); } };
}
test('entry is opt-in, fresh, unsaved and disposable; closure never resumes ordinary world', async () => {
  const f = fixture(); assert.equal(f.sessions.length, 0); assert(f.api.open());
  assert.deepEqual(f.events, ['enter']); assert(await f.api.start());
  assert.equal(f.sessions[0].options.seed, 1); assert.equal(f.sessions[0].options.enabled, true);
  assert.deepEqual(Object.keys(f.sessions[0].options).sort(), ['enabled', 'geometry', 'pixelSensor', 'seed']);
  f.$('communication-enabled').checked = false; f.$('communication-seed').value = '42';
  assert(await f.api.start()); assert.equal(f.sessions[0].disposed, 1); assert.equal(f.sensors[0].disposed, 1);
  assert.equal(f.sessions[1].options.enabled, false); assert.equal(f.sessions[1].options.seed, 42);
  f.api.close(); assert.equal(f.sessions[1].disposed, 1); assert.equal(f.timers.size, 0); assert.equal(f.frames.size, 0);
  assert.deepEqual(f.events, ['enter', 'exit']); assert(!f.api.active()); assert(f.$('open-communication').focused);
});
test('Escape is isolated and clock is independent of rendering with no resume catch-up', async () => {
  const f = fixture(); f.api.open(); await f.api.start(); f.advance(0); f.advance(.5);
  const before = f.sessions[0].elapsed; assert(before > .45); assert.equal(f.draws.length, 0);
  const e = f.window.fire('keydown', { code: 'Escape' }); assert(e.prevented && e.stopped); assert(f.api.status().paused);
  f.window.fire('keydown', { code: 'Escape', repeat: true }); assert(f.api.status().paused);
  f.advance(100); assert.equal(f.sessions[0].elapsed, before);
  f.window.fire('keydown', { code: 'Escape' }); f.advance(10); assert.equal(f.sessions[0].elapsed, before);
  f.advance(.5); assert(f.sessions[0].elapsed > before);
  const save = f.window.fire('keydown', { code: 'KeyS', ctrlKey: true }); assert(save.prevented && save.stopped);
  f.$('communication-follow').value = 'mira'; f.paint(); assert.equal(f.draws[0].selectedAgentId, 'mira'); assert.equal(f.sessions[0].state.selectedAgentId, 'aster');
  f.api.dispose();
});
test('closed pending creation retires stale actors and never leaks a timer', async () => {
  let resolve; const pending = new Promise(r => { resolve = r; });
  const f = fixture({ createExperiment: () => pending }); f.api.open(); const starting = f.api.start();
  await new Promise(r => setImmediate(r)); assert(f.api.status().busy); f.api.close();
  const old = { state: {}, tick() {}, snapshot: () => ({}), disposed: 0, dispose() { this.disposed++; } };
  resolve(old); assert.equal(await starting, false); assert.equal(old.disposed, 1); assert.equal(f.sensors[0].disposed, 1); assert.equal(f.timers.size, 0);
});
test('invalid seeds and start errors fail without touching ordinary state', async () => {
  const f = fixture({ createExperiment() { throw new Error('fixture'); } }); f.api.open();
  f.$('communication-seed').value = '-1'; assert.equal(await f.api.start(), false); assert.equal(f.sensors.length, 0);
  f.$('communication-seed').value = '1'; assert.equal(await f.api.start(), false); assert.equal(f.sensors[0].disposed, 1);
  assert(f.api.active()); assert(!f.api.status().running); assert.match(f.$('communication-status').textContent, /could not start/); f.api.close();
});
test('cap pauses; pagehide retires while retaining save guard; cannot open outside pause', async () => {
  const denied = fixture({ canOpen: () => false }); assert(!denied.api.open()); denied.api.dispose();
  const f = fixture(); f.api.open(); await f.api.start(); f.sessions[0].elapsed = 1800; f.advance(0); assert(f.api.status().paused);
  f.paint(); f.window.fire('keydown', { code: 'Escape' }); assert(f.api.status().paused);
  f.window.fire('pagehide'); assert(f.api.active()); assert.equal(f.sessions[0].disposed, 1); assert.equal(f.timers.size, 0); f.api.dispose();
});
test('pixel display accepts only RGB crops and preserves channel values', () => {
  const canvas = new Element(), pixels = new Uint8Array(768); pixels.set([17, 81, 233]);
  assert(paintCommunicationPixels(canvas, pixels)); assert.deepEqual([...canvas.image.data.slice(0, 4)], [17, 81, 233, 255]);
  assert(!paintCommunicationPixels(canvas, [1, 2, 3])); assert(!paintCommunicationPixels(canvas, Array(768).fill(NaN)));
});
test('isolated UI stays available to tests while main world uses a non-owning inspector', () => {
  const main = readFileSync(new URL('../src/ozark-world-main.js', import.meta.url), 'utf8');
  assert.doesNotMatch(main, /if \(communicationExperiment\?\.active\(\) \|\| resetHeld/);
  assert.match(main, /installCommunicationInspector/);
  assert.match(main, /canOpen: \(\) => started && paused/);
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<dialog id="communication-dialog"/); assert.match(html, /ONE WORLD · LEARNING INSPECTOR/);
  const ui = readFileSync(new URL('../src/communication-experiment-ui.js', import.meta.url), 'utf8');
  assert.doesNotMatch(ui, /localStorage|writeOzarkSave|loadOzarkSave/);
});

test('real runtime numeric body contract remains visible to the owner', async () => {
  const f = fixture(); f.api.open(); await f.api.start();
  f.sessions[0].snapshot = () => ({elapsed: 2, agents: [{id:'aster',name:'Aster',hunger:71.25,thirst:83,energy:62,meals:1,drinks:2,collapses:0}]});
  f.paint();
  assert.match(f.$('communication-bodies').textContent, /food 71.3\/100, water 83.0\/100, energy 62.0\/100/);
  f.api.dispose();
});
