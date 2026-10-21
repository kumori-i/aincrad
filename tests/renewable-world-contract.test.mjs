import test from 'node:test';
import assert from 'node:assert/strict';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { OZARK_SAVE_KEY, OZARK_SAVE_VERSION, loadOzarkSave, writeOzarkSave } from '../src/ozark-save.js';
import { ozarkWorldMode } from '../src/ozark-world-features.js';

const geometry = createOzarkWorldGeometry();
const memory = entries => {
  const values = new Map(entries), reads = [];
  return { values, reads, getItem(key) { reads.push(key); return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); } };
};

test('renewable contract starts one fresh world without reading or replacing retired v1 bytes', () => {
  const old = '{"version":11,"retained":"previous world"}';
  const disk = memory([['aincrad.world.v1', old]]);
  const loaded = loadOzarkSave(disk, geometry);
  assert.equal(OZARK_SAVE_KEY, 'aincrad.world.v2');
  assert.equal(OZARK_SAVE_VERSION, 12);
  assert.equal(loaded.exists, false);
  assert.equal(loaded.blocked, false);
  assert.deepEqual(disk.reads, ['aincrad.world.v2']);
  assert.equal(loaded.state.environment.ecology.aquatic.version, 2);
  assert.equal(loaded.state.features.finiteAquatic, 2);
  assert.ok(ozarkWorldMode(loaded.state));
  assert.equal(writeOzarkSave(disk, loaded.state, geometry), true);
  assert.equal(disk.values.get('aincrad.world.v1'), old);
  assert.equal(disk.reads.includes('aincrad.world.v1'), false);
  const reopened = loadOzarkSave(disk, geometry);
  assert.equal(reopened.blocked, false, reopened.error);
  assert.deepEqual(reopened.state.environment.ecology, loaded.state.environment.ecology);
});

test('occupied corrupt v2 remains blocked and cannot fall back to a retired world', () => {
  const bytes = '{broken current save';
  const disk = memory([['aincrad.world.v1', '{"version":11}'], [OZARK_SAVE_KEY, bytes]]);
  const loaded = loadOzarkSave(disk, geometry);
  assert.equal(loaded.blocked, true);
  assert.equal(loaded.state, null);
  assert.deepEqual(disk.reads, [OZARK_SAVE_KEY]);
  assert.equal(disk.values.get(OZARK_SAVE_KEY), bytes);
});

test('renewable current writes retain exact-byte compare-and-swap protection', () => {
  const disk = memory(), loaded = loadOzarkSave(disk, geometry);
  assert.equal(writeOzarkSave(disk, loaded.state, geometry), true);
  const changed = disk.values.get(OZARK_SAVE_KEY) + ' ';
  disk.values.set(OZARK_SAVE_KEY, changed);
  assert.equal(writeOzarkSave(disk, loaded.state, geometry), false);
  assert.equal(disk.values.get(OZARK_SAVE_KEY), changed);
});
