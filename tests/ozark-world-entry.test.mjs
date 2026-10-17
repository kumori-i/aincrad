import test from 'node:test';
import assert from 'node:assert/strict';
import { bootEntry, entryModuleFor } from '../src/entry.js';

test('the persistent Ozark world has an exact separate entry route', async () => {
  const requests = [];
  const load = async path => { requests.push(path); return { path }; };
  assert.deepEqual(await bootEntry('?ozarkWorld=1', load),
    { path: './ozark-world-main.js' });
  assert.deepEqual(await bootEntry('?test=1&ozarkWorld=1', load),
    { path: './ozark-world-main.js' });
  assert.deepEqual(await bootEntry('?test=1&ozarkPilot=1', load),
    { path: './ozark-pilot-main.js' });
  for (const search of ['', '?test=1', '?ozarkWorld=0',
    '?ozarkWorld=1&test=1', '?test=1&ozarkWorld=1&extra=1',
    '?test=1&ozarkWorld=1&ozarkWorld=1']) {
    assert.equal(entryModuleFor(search), './main.js');
  }
  assert.deepEqual(requests, [
    './ozark-world-main.js', './ozark-world-main.js', './ozark-pilot-main.js',
  ]);
});
