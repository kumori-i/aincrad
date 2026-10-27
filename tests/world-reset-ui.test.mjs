import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { OZARK_SAVE_KEY } from '../src/ozark-save.js';
import { installWorldReset } from '../src/world-reset-ui.js';
const geometry = createOzarkWorldGeometry();
class Element {
  constructor(id) { this.id = id; this.handlers = {}; this.disabled = false; this.checked = false; this.hidden = false; this.textContent = ''; }
  addEventListener(type, fn) { (this.handlers[type] ??= []).push(fn); }
  async fire(type, options = {}) { const event = { currentTarget: this, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...options }; for (const fn of this.handlers[type] || []) fn(event); return event; }
  focus() { this.focused = true; }
  showModal() { this.open = true; }
  close() { this.open = false; }
}
function setup(options = {}) {
  const nodes = new Map(); const document = new Element('document');
  document.getElementById = id => { if (!nodes.has(id)) nodes.set(id, new Element(id)); return nodes.get(id); };
  const $ = document.getElementById;
  const values = new Map([[OZARK_SAVE_KEY, '{broken']]); const events = []; let writes = 0;
  const storage = { getItem: key => values.get(key) ?? null, setItem(key, value) { writes++; events.push('write'); values.set(key, value); } };
  const api = installWorldReset({ document, storage, geometry, previous: () => null,
    freeze: () => events.push('freeze'), release: () => events.push('release'), retire: () => events.push('retire'),
    reload: () => events.push('reload'), exportCurrentWorld: async raw => { events.push(['backup', raw]); return { ok: true }; }, ...options });
  return { $, document, values, storage, events, api, writes: () => writes,
    open: async (id = 'reset-world') => $(id).fire('click'),
    acknowledge: async () => { $('reset-acknowledge').checked = true; await $('reset-acknowledge').fire('change'); } };
}
const settled = () => new Promise(resolve => setImmediate(resolve));

test('confirmation defaults safe; cancel and Escape leave bytes intact and return focus', async () => {
  for (const escape of [false, true]) {
    const f = setup(); await f.open('recovery-reset-world');
    assert.equal(f.$('reset-confirm').disabled, true); assert.equal(f.$('reset-cancel').focused, true);
    await f.$('reset-confirm').fire('click'); assert.equal(f.writes(), 0);
    if (escape) { const e = await f.document.fire('keydown', { key: 'Escape' }); assert(e.prevented && e.stopped); }
    else await f.$('reset-cancel').fire('click');
    assert.deepEqual(f.events, ['freeze', 'release']); assert.equal(f.api.active(), false);
    assert.equal(f.$('recovery-reset-world').focused, true); assert.equal(f.values.get(OZARK_SAVE_KEY), '{broken');
  }
});

test('explicit no-backup confirmation retires before one write and repeated clicks do nothing', async () => {
  const f = setup(); await f.open(); await f.open(); await f.acknowledge();
  await f.$('reset-confirm').fire('click'); await f.$('reset-confirm').fire('click'); await f.$('reset-cancel').fire('click');
  assert.deepEqual(f.events, ['freeze', 'retire', 'write', 'reload']); assert.equal(f.writes(), 1);
  assert.equal(JSON.parse(f.values.get(OZARK_SAVE_KEY)).elapsed, 0);
});

test('backup success exports exact malformed bytes then replaces', async () => {
  const f = setup(); await f.open(); await f.$('reset-backup-confirm').fire('click'); await settled();
  assert.deepEqual(f.events, ['freeze', ['backup', '{broken'], 'retire', 'write', 'reload']);
});

test('backup cancellation or failure never silently falls through to reset', async () => {
  for (const exportCurrentWorld of [async () => ({ ok: false, canceled: true }), async () => ({ ok: false }), async () => { throw new Error('disk'); }]) {
    const f = setup({ exportCurrentWorld }); await f.open(); await f.$('reset-backup-confirm').fire('click'); await settled();
    assert.equal(f.writes(), 0); assert.deepEqual(f.events, ['freeze']);
    assert.equal(f.$('reset-cancel').disabled, false); await f.$('reset-cancel').fire('click');
    assert.equal(f.values.get(OZARK_SAVE_KEY), '{broken');
  }
});

test('pending backup blocks repeated confirms; late newer save aborts commit', async () => {
  let finish; const f = setup({ exportCurrentWorld: () => new Promise(resolve => { finish = resolve; }) });
  await f.open(); await f.$('reset-backup-confirm').fire('click');
  await f.$('reset-backup-confirm').fire('click');
  assert.equal(f.api.active(), true); assert.equal(f.$('reset-cancel').disabled, false);
  f.values.set(OZARK_SAVE_KEY, 'newer'); finish({ ok: true }); await settled();
  assert.equal(f.writes(), 0); assert.equal(f.values.get(OZARK_SAVE_KEY), 'newer');
  assert.deepEqual(f.events, ['freeze', 'retire']); assert.match(f.$('reset-status').textContent, /changed after confirmation/);
});

test('preparation read failure disables destructive actions and remains cancellable', async () => {
  const f = setup({ storage: { getItem() { throw new Error('read'); }, setItem() { assert.fail('write'); } } });
  await f.open(); assert.equal(f.$('reset-confirm').disabled, true); assert.equal(f.$('reset-backup-confirm').disabled, true);
  await f.$('reset-cancel').fire('click'); assert.deepEqual(f.events, ['freeze', 'release']);
});

test('reload failure leaves terminal session stopped with truthful replacement notice', async () => {
  const f = setup({ reload: () => { throw new Error('reload'); } }); await f.open(); await f.acknowledge();
  await f.$('reset-confirm').fire('click'); assert.equal(f.writes(), 1);
  assert.match(f.$('reset-status').textContent, /was replaced, but reopening failed/);
  assert.equal(f.$('reset-cancel').disabled, true); assert.equal(f.$('reset-reload').hidden, false);
  await f.$('reset-reload').fire('click');
  assert.match(f.$('reset-status').textContent, /Reopening failed.*old session remains stopped/);
  assert.equal(f.writes(), 1);
});

test('retirement failure never writes or enables old-session cancellation', async () => {
  const f = setup({ retire: () => { throw new Error('dispose'); } }); await f.open(); await f.acknowledge();
  await f.$('reset-confirm').fire('click'); assert.equal(f.writes(), 0); assert.equal(f.$('reset-cancel').disabled, true);
});

test('runtime central guard covers saves, simulation and terminal disposal', async () => {
  const source = await readFile(new URL('../src/ozark-world-main.js', import.meta.url), 'utf8');
  assert.match(source, /function save\(explicit = false\)\s*\{\s*if \(resetHeld \|\| resetRetired/);
  assert.match(source, /running: started && !paused && !loaded.blocked && !resetHeld && !resetRetired/);
  assert.match(source, /clearInterval\(simulationTimer\); population\?\.dispose\(\)/);
  assert.match(source, /pagehide[^\n]*save\(\)/); assert.match(source, /beforeunload[^\n]*save\(\)/);
});


test('Escape and Cancel during pending export preserve cancel intent through success or failure', async () => {
  for (const gesture of ['escape', 'button']) for (const outcome of ['success', 'failure']) {
    let resolve, reject;
    const f = setup({ exportCurrentWorld: () => new Promise((yes, no) => { resolve = yes; reject = no; }) });
    await f.open(); await f.$('reset-backup-confirm').fire('click');
    assert.equal(f.$('reset-cancel').disabled, false);
    if (gesture === 'escape') await f.document.fire('keydown', { key: 'Escape' });
    else await f.$('reset-cancel').fire('click');
    assert.equal(f.api.active(), true);
    assert.equal(f.$('reset-cancel').disabled, true);
    assert.match(f.$('reset-status').textContent, /Reset canceled/);
    assert.deepEqual(f.events, ['freeze']);
    await f.$('reset-backup-confirm').fire('click');
    if (outcome === 'success') resolve({ ok: true }); else reject(new Error('write failed'));
    await settled();
    assert.equal(f.api.active(), false); assert.equal(f.writes(), 0);
    assert.equal(f.values.get(OZARK_SAVE_KEY), '{broken');
    assert.deepEqual(f.events, ['freeze', 'release']);
    assert.equal(f.$('reset-world').focused, true);
  }
});
