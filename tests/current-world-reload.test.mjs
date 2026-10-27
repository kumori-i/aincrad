import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
const source = await readFile(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
const trustSource = source.match(/  function trusted\(event\)\{[\s\S]*?\n  \}/)[0];
const handleSource = source.match(/  const handle=[^\n]+/)[0];
const routeSource = source.match(/  handle\('aincrad:current-world-reload',\(\)=>\{[\s\S]*?\n  \}\);/)[0];
function fixture(fail = null) {
  const calls = [], callbacks = new Map();
  const step = name => { calls.push(name); if (name === fail) throw new Error(name + ' failed'); };
  const frame = { url: 'aincrad://app/index.html' };
  const sender = { mainFrame: frame, reload: () => step('reload') };
  const win = { webContents: sender, isDestroyed: () => false };
  runInNewContext(trustSource + '\n' + handleSource + '\n' + routeSource, {
    URL, win, ipcMain: { handle: (name, callback) => callbacks.set(name, callback) },
    modelService: { cancel: () => step('cancel') },
    session: { defaultSession: { flushStorageData: () => step('flush') } },
  });
  return { calls, frame, sender, invoke: callbacks.get('aincrad:current-world-reload') };
}

test('main-owned reload cancels providers and flushes storage before fixed-window reload, without navigation relaxation', async () => {
  const f = fixture();
  assert.equal((await f.invoke({ sender: f.sender, senderFrame: f.frame }, 'https://untrusted.invalid')).ok, true);
  assert.deepEqual(f.calls, ['cancel', 'flush', 'reload']);
  assert.match(source, /on\('will-navigate',e=>e.preventDefault\(\)\)/);
  assert.doesNotMatch(routeSource, /loadURL|args|raw|url\)/);
});

test('reload denies foreign origin, subframe and unrelated window before any action', async () => {
  for (const kind of ['origin', 'subframe', 'window']) {
    const f = fixture();
    const event = { sender: f.sender, senderFrame: f.frame };
    if (kind === 'origin') f.frame.url = 'https://app/index.html';
    if (kind === 'subframe') event.senderFrame = { url: f.frame.url };
    if (kind === 'window') event.sender = { mainFrame: f.frame };
    await assert.rejects(f.invoke(event), /Untrusted/);
    assert.deepEqual(f.calls, []);
  }
});

test('cancel, flush and reload failures reject without proceeding to later steps', async () => {
  for (const [fail, expected] of [['cancel',['cancel']],['flush',['cancel','flush']],['reload',['cancel','flush','reload']]]) {
    const f = fixture(fail);
    await assert.rejects(f.invoke({ sender: f.sender, senderFrame: f.frame }), new RegExp(fail + ' failed'));
    assert.deepEqual(f.calls, expected);
  }
});
