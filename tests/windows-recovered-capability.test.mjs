import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import profile from '../desktop/recovered-profile.cjs';

const {
  COPY_FLAG,
  assertRecoveredCopySupported,
  resolveProfileRoute,
  createRecoveredProfileManager,
} = profile;
const raw = JSON.stringify({ version: 8, world: 'protected original' });
const digest = createHash('sha256').update(raw).digest('hex');
const unavailable = /unavailable on Windows/i;

async function disposableProfiles(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aincrad-capability-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const appData = path.join(root, 'appData');
  const original = path.join(appData, 'Aincrad');
  const copy = path.join(appData, 'Aincrad-Recovered-Proof-v1');
  await fs.mkdir(original, { recursive: true });
  const originalFile = path.join(original, 'original-sentinel');
  await fs.writeFile(originalFile, 'original bytes', { mode: 0o600 });
  return { appData, original, copy, originalFile };
}

test('Windows original route reports unsupported recovery and direct recovered route is refused', async t => {
  const f = await disposableProfiles(t);
  const inputs = { isPackaged: false, appDataPath: f.appData,
    defaultUserDataPath: f.original, platform: 'win32' };
  const original = resolveProfileRoute({ ...inputs, argv: ['electron', 'app'] });
  assert.equal(original.kind, 'original');
  assert.equal(original.userDataPath, f.original);
  assert.equal(original.recoveredCopySupported, false);
  assert.throws(() => resolveProfileRoute({ ...inputs, argv: ['electron', 'app', COPY_FLAG] }), unavailable);
  const forbiddenTestRoot = path.join(path.dirname(os.tmpdir()), 'aincrad-never-route');
  assert.throws(() => resolveProfileRoute({ ...inputs,
    argv: ['electron', 'app', '--test', `--test-profile=${forbiddenTestRoot}`, COPY_FLAG] }), unavailable,
  'unsupported recovered mode must be refused before selecting or validating a test profile path');
  assert.equal(await fs.readFile(f.originalFile, 'utf8'), 'original bytes');
  await assert.rejects(fs.lstat(f.copy), { code: 'ENOENT' });
  assert.throws(() => assertRecoveredCopySupported('win32'), unavailable);
});

test('Windows manager refuses creation without reserving an empty copy slot', async t => {
  const f = await disposableProfiles(t);
  const manager = createRecoveredProfileManager({ kind: 'original',
    originalPath: f.original, copyPath: f.copy, platform: 'win32' });
  const before = await manager.status();
  assert.equal(before.phase, 'none');
  assert.equal(before.recoveredCopySupported, false);
  await assert.rejects(manager.create(raw, digest), unavailable);
  await assert.rejects(fs.lstat(f.copy), { code: 'ENOENT' });
  assert.equal(await fs.readFile(f.originalFile, 'utf8'), 'original bytes');
});

test('Windows manager leaves an occupied partial slot unready and unchanged', async t => {
  const f = await disposableProfiles(t);
  await fs.mkdir(f.copy);
  const sentinel = path.join(f.copy, 'partial-source');
  await fs.writeFile(sentinel, 'partial bytes', { mode: 0o600 });
  const original = createRecoveredProfileManager({ kind: 'original',
    originalPath: f.original, copyPath: f.copy, platform: 'win32' });
  const recovered = createRecoveredProfileManager({ kind: 'recovered',
    originalPath: f.original, copyPath: f.copy, platform: 'win32' });
  assert.equal((await original.status()).recoveredCopySupported, false);
  await assert.rejects(original.create(raw, digest), unavailable);
  await assert.rejects(recovered.stagedRaw(), unavailable);
  await assert.rejects(recovered.markReady(), unavailable);
  assert.equal((await recovered.status()).phase, 'invalid');
  assert.deepEqual(await fs.readdir(f.copy), ['partial-source']);
  assert.equal(await fs.readFile(sentinel, 'utf8'), 'partial bytes');
  assert.equal(await fs.readFile(f.originalFile, 'utf8'), 'original bytes');
});

test('an unsafe disabled copy slot cannot block the ordinary Windows original route', async t => {
  const f = await disposableProfiles(t);
  await fs.symlink(f.original, f.copy, process.platform === 'win32' ? 'junction' : 'dir');
  const route = resolveProfileRoute({ argv: ['electron', 'app'], isPackaged: false,
    appDataPath: f.appData, defaultUserDataPath: f.original, platform: 'win32' });
  assert.equal(route.kind, 'original');
  assert.equal(route.userDataPath, f.original);
  assert.equal(route.recoveredCopySupported, false);
  const manager = createRecoveredProfileManager({ ...route, platform: 'win32' });
  assert.equal((await manager.status()).phase, 'invalid');
  assert.equal(await fs.readFile(f.originalFile, 'utf8'), 'original bytes');
  assert.throws(() => resolveProfileRoute({ argv: ['electron', 'app', COPY_FLAG], isPackaged: false,
    appDataPath: f.appData, defaultUserDataPath: f.original, platform: 'win32' }), unavailable);
});

test('supported platform keeps the ordinary recovered route and capability', async t => {
  const f = await disposableProfiles(t);
  const inputs = { isPackaged: false, appDataPath: f.appData,
    defaultUserDataPath: f.original, platform: 'linux' };
  const original = resolveProfileRoute({ ...inputs, argv: ['electron', 'app'] });
  const recovered = resolveProfileRoute({ ...inputs, argv: ['electron', 'app', COPY_FLAG] });
  assert.equal(original.recoveredCopySupported, true);
  assert.equal(recovered.recoveredCopySupported, true);
  assert.equal(recovered.kind, 'recovered');
  assert.equal(recovered.userDataPath, f.copy);
  assert.equal(assertRecoveredCopySupported('linux'), undefined);
  const manager = createRecoveredProfileManager({ kind: 'original',
    originalPath: f.original, copyPath: f.copy, platform: 'linux' });
  assert.equal((await manager.status()).recoveredCopySupported, true);
});
