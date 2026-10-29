import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installCommunicationInspector } from '../src/communication-inspector.js';
class Element {
  constructor() { this.handlers = {}; this.value = ''; this.width = this.height = 16; }
  addEventListener(type, fn) { (this.handlers[type] ??= []).push(fn); }
  removeEventListener(type, fn) { this.handlers[type] = this.handlers[type].filter(f => f !== fn); }
  fire(type, options = {}) { const e = { preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...options }; for (const fn of this.handlers[type] || []) fn(e); return e; }
  focus() { this.focused = true; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  getBoundingClientRect() { return { width: 800, height: 450 }; }
  getContext() { return { clearRect() {}, createImageData: () => ({ data: new Uint8ClampedArray(1024) }), putImageData() {} }; }
}
function fixture(options = {}) {
  const nodes = new Map(), window = new Element(), frames = new Map(), draws = [];
  const $ = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  $('communication-follow').value = 'aster';
  let paused = true, nextId = 0, reads = 0;
  const state = { elapsed: 2200, selectedAgentId: 'aster', agents: [{ id: 'aster', rng: 421 }] };
  const data = { elapsed: 2200, exchanges: 3, updates: 1, pending: 2, relief: 1, effortExpiry: 1, discomfort: 0, agents: [{ id: 'aster', hunger: 65, thirst: 80, energy: 70 }], gates: { optional: 4, noSource: 2, eligible: 2 } };
  const learning = { snapshot() { reads++; return structuredClone(data); }, dispose() { throw Error('Inspector cannot retire learning'); }, tick() { throw Error('Inspector cannot tick learning'); } };
  window.requestAnimationFrame = fn => { frames.set(++nextId, fn); return nextId; };
  window.cancelAnimationFrame = id => frames.delete(id);
  window.setInterval = () => { throw Error('Inspector cannot own a simulation timer'); };
  const api = installCommunicationInspector({ document: { getElementById: $ }, window, state, geometry: {}, getLearning: () => learning,
    isPaused: () => paused, setPaused: value => { paused = value; }, createRenderer: () => ({ resize() {}, draw(value) { draws.push(value); } }), ...options });
  return { $, window, frames, draws, state, data, learning, api, reads: () => reads, paint() { const pending = [...frames.values()]; frames.clear(); for (const fn of pending) fn(); } };
}
test('same-world inspector reopen, reads and follow preserve agents, pending learning and clock', () => {
  const f = fixture(), before = structuredClone(f.state), model = structuredClone(f.data);
  for (let i = 0; i < 3; i++) {
    assert(f.api.open()); assert(!f.api.open()); f.paint();
    f.$('communication-follow').value = 'mira'; f.$('communication-follow').fire('change');
    assert.equal(f.draws.at(-1).selectedAgentId, 'mira');
    assert.equal(f.api.status().snapshot.pending, 2);
    f.api.close(); assert.equal(f.frames.size, 0); assert(!f.api.active());
  }
  assert(f.reads() >= 3); assert.deepEqual(f.state, before); assert.deepEqual(f.data, model);
  assert.equal(f.state.elapsed, 2200, 'No experiment limit or second clock');
  f.api.dispose(); assert(!f.api.open());
});
test('Escape and button control only main pause; save shortcut remains available', () => {
  const f = fixture(); f.api.open();
  const e = f.window.fire('keydown', { code: 'Escape' }); assert(e.prevented && e.stopped); assert(!f.api.status().paused);
  f.window.fire('keydown', { code: 'Escape', repeat: true }); assert(!f.api.status().paused);
  f.$('communication-pause').fire('click'); assert(f.api.status().paused);
  const save = f.window.fire('keydown', { code: 'KeyS', ctrlKey: true }); assert(!save.prevented && !save.stopped);
  assert(f.window.fire('keydown', { code: 'KeyN' }).stopped);
  f.$('communication-pause').fire('click'); f.api.close(); assert(!f.api.status().paused, 'Closing does not pause or resume main world');
});
test('loaded world values and outcome/gate distinctions remain visible without pretending success', () => {
  const f = fixture(); f.api.open();
  assert.match(f.$('communication-elapsed').textContent, /2200 simulation seconds · main world clock/);
  assert.match(f.$('communication-bodies').textContent, /food 65.0\/100, water 80.0\/100/);
  assert.match(f.$('communication-counts').textContent, /1 relief · 0 discomfort · 1 effort-only expiries/);
  assert.match(f.$('communication-gates').textContent, /no source experience 2/);
  assert.match(f.$('communication-outcome').textContent, /No communication benefit/);
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /acquired visual associations save locally per individual/);
  assert.match(html, /Bodies, survival memories and acquired visual associations save locally/);
  assert.doesNotMatch(html, /id="communication-(?:start|stop|seed|enabled|speed)"/);
  f.api.dispose();
});
test('unavailable learner and display failure are visible without touching survival', () => {
  const f = fixture({ getLearning: () => null, getError: () => 'Pixel sensor unavailable.' }); f.api.open();
  assert.match(f.$('communication-status').textContent, /Communication learning unavailable.*Pixel sensor unavailable/);
  f.api.close();
  const broken = fixture({ getLearning: () => ({ snapshot() { throw Error('fixture'); } }) }); broken.api.open();
  assert.match(broken.$('communication-status').textContent, /could not refresh/); broken.api.dispose();
  const denied = fixture({ canOpen: () => false }); assert(!denied.api.open()); assert.equal(denied.frames.size, 0);
});

test('losing an attached learner clears previous successful diagnostic values', () => {
  let available = true;
  const f = fixture({ getLearning: () => available ? { snapshot: () => ({ elapsed: 123, exchanges: 7, latest: { tokens: [1,2], senderId: 'aster', receiverId: 'mira', status: 'attributed', reward: 1 } }) } : null });
  f.api.open(); assert.match(f.$('communication-message').textContent, /aster/);
  available = false; f.api.refresh();
  assert.equal(f.api.status().snapshot, null);
  for (const id of ['communication-message', 'communication-counts', 'communication-elapsed']) assert.match(f.$(id).textContent, /Unavailable/);
  f.api.dispose();
});
test('production shortcut opens the existing NPC Learning tab without a modal, renderer or new timer',()=>{
  let opened=0,visible=false;
  const f=fixture({openLearning(){opened++;visible=true;},closeLearning(){visible=false;},learningVisible:()=>visible,createRenderer(){throw Error('No duplicate renderer');}});
  const before=structuredClone(f.state);assert(f.api.open());assert.equal(opened,1);assert(f.api.active());assert.equal(f.frames.size,0);assert.equal(f.$('communication-dialog').open,undefined);assert.equal(f.api.status().paused,true);
  f.api.close();assert(!f.api.active());assert.deepEqual(f.state,before);f.api.dispose();assert(!f.api.open());
});
