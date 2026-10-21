import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import { canonicalApplicationRoot, captureNativeChild, archiveNativeProfile, installEmptyCurrentSlot, currentRouteSnapshot,
  assertCurrentRoute } from '../scripts/carcass-native-contract.mjs';
const key='aincrad.world.v2';
const storage = entries => {
 const rows=new Map(entries),writes=[];
 return {rows,writes,getItem:key=>rows.has(key)?rows.get(key):null,
  setItem(key,value){writes.push([key,value]);rows.set(key,value);}};
};
test('current fixture installation refuses occupied slots and leaves unrelated bytes untouched',()=>{
 for(const bytes of ['', 'existing world']) {
  const local=storage([[key,bytes],['unrelated','keep']]);
  assert.throws(()=>installEmptyCurrentSlot(local,{key,inputRaw:'fixture'}),/occupied/);
  assert.deepEqual(local.writes,[]);
 }
 const local=storage([['unrelated','keep']]);
 assert.equal(installEmptyCurrentSlot(local,{key,inputRaw:'fixture'}),'fixture');
 assert.equal(local.getItem('unrelated'),'keep');
 assert.throws(()=>installEmptyCurrentSlot(storage([]),{key:'retired',inputRaw:'fixture'}));
});
test('serialized current route contract rejects retired bridges, choosers and invalid current saves',()=>{
 const assertRoute=vm.runInNewContext('('+assertCurrentRoute.toString()+')');
 const valid={url:'aincrad://app/index.html?test=1',hook:true,retiredWorldBridge:false,
  retiredProfileBridge:false,chooserPresent:false,snapshot:{blocked:false,started:false,
   version:12,features:{plantLifecycle:1,finiteAquatic:2,worldStructures:1}}};
 assertRoute(valid);
 for(const patch of [{hook:false},{retiredWorldBridge:true},{retiredProfileBridge:true},
  {chooserPresent:true},{url:'aincrad://app/index.html?ozarkWorld=1'},
  {snapshot:{...valid.snapshot,version:10}},{snapshot:{...valid.snapshot,blocked:true}}])
   assert.throws(()=>assertRoute({...valid,...patch}));
});

test('only the application root is canonicalized; the temp profile spelling is retained', async () => {
  const scratch = '/disposable/alias/ac-h1-test', calls = [];
  const canonical = await canonicalApplicationRoot(scratch, {
    mkdir: async (...args) => calls.push(['mkdir', ...args]),
    realpath: async value => { calls.push(['realpath', value]); return '/canonical/temp/ac-h1-test/app'; },
  });
  assert.equal(canonical, '/canonical/temp/ac-h1-test/app');
  assert.equal(join(scratch, 'p-0'), join('/disposable/alias/ac-h1-test', 'p-0'));
  assert.deepEqual(calls, [['mkdir', join(scratch, 'app'), { recursive: true }],
    ['realpath', join(scratch, 'app')]]);
  // Exact production containment rule, with the Windows 8.3 behavior already
  // documented in native-profile-qa-driver.test.mjs. This is a path model,
  // not a claim that the prior native failure captured a 403.
  const alias = 'C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\ac-h1-test\\app\\renderer';
  const long = alias.replace('RUNNER~1', 'runneradmin'), asset = win32.join(long, 'index.html');
  assert.equal(win32.relative(alias, asset).startsWith('..'), true);
  assert.equal(win32.relative(long, asset).startsWith('..'), false);
});

test('process capture waits for close, retains spawn errors and drains final output', async () => {
  for (const fails of [false, true]) {
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    const output = [], errors = [], failure = new Error('synthetic spawn error');
    let settled = false;
    const pending = captureNativeChild(() => child, 'unused', [], {},
      bytes => output.push(String(bytes)), bytes => errors.push(String(bytes)))
      .then(result => { settled = true; return result; });
    if (fails) child.emit('error', failure);
    child.emit('exit', fails ? null : 0);
    await Promise.resolve(); assert.equal(settled, false);
    child.stdout.emit('data', Buffer.from('final output'));
    child.stderr.emit('data', Buffer.from('diagnostic'));
    child.emit('close', fails ? null : 0, null);
    const result = await pending;
    assert.equal(result.spawnError, fails ? failure : null);
    assert.equal(result.stdout, 'final output'); assert.equal(result.stderr, 'diagnostic');
    assert.deepEqual(output, ['final output']); assert.deepEqual(errors, ['diagnostic']);
  }
});

test('profile evidence copies only regular files/directories, never replacing existing evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ac-h1-archive-'));
  try {
    const profile = join(root, 'profile'), archive = join(root, 'archive');
    await mkdir(join(profile, 'Local Storage'), { recursive: true });
    await writeFile(join(profile, 'Local Storage', 'bytes'), 'exact synthetic saved bytes');
    // Directory junction creation works without Windows symlink privilege.
    await mkdir(join(root, 'outside')); await writeFile(join(root, 'outside', 'not-profile'), 'exclude');
    await symlink(join(root, 'outside'), join(profile, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
    const result = await archiveNativeProfile(profile, archive);
    assert.equal(result.regularFilesAndDirectoriesOnly, true);
    assert.deepEqual(result.skipped, [join(profile, 'link')]);
    assert.deepEqual(await readdir(archive), ['Local Storage']);
    assert.equal(await readFile(join(archive, 'Local Storage', 'bytes'), 'utf8'), 'exact synthetic saved bytes');
    await assert.rejects(archiveNativeProfile(profile, archive));
    assert.equal(await readFile(join(profile, 'Local Storage', 'bytes'), 'utf8'), 'exact synthetic saved bytes');
    assert.equal(await readFile(join(archive, 'Local Storage', 'bytes'), 'utf8'), 'exact synthetic saved bytes');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('prepare-only runner retains synchronous native bootstrap and strict production profile routing', async () => {
  const output = await mkdtemp(join(tmpdir(), 'ac-h1-check-'));
  let scratch;
  try {
    const prepared = spawnSync(process.execPath, ['scripts/verify-carcass-desktop.mjs', '--prepare-only', '--output', output],
      { encoding: 'utf8', timeout: 120000 });
    assert.equal(prepared.status, 0, prepared.stderr);
    const report = JSON.parse(await readFile(join(output, 'prepared.json'), 'utf8')); scratch = report.scratch;
    assert.equal(report.nativeExecutionPerformed, false);
    const syntax = spawnSync(process.execPath, ['--check', report.harness], { encoding: 'utf8' });
    assert.equal(syntax.status, 0, syntax.stderr);
    const require = createRequire(import.meta.url), app = new EventEmitter(), loaded = [];
    app.exit = code => { throw new Error('Unexpected exit ' + code); };
    const stub = name => name === 'electron' ? { app, session: {} }
      : name.endsWith('main.cjs') ? loaded.push(name) : require(name);
    stub.resolve = require.resolve;
    vm.runInNewContext(await readFile(report.harness, 'utf8'), {
      require: stub, process: { argv: ['runner', '--phase=write', '--stage=relation'] },
      console, setTimeout: () => 1, clearTimeout() {},
    });
    assert.equal(loaded.length, 1, 'Production main must load synchronously before app ready');
    const pathEvidence = JSON.parse(await readFile(join(output, 'relation-write-app-path.json'), 'utf8'));
    assert.equal(pathEvidence.protocolWouldReject, false);
    const { resolveProfileRoute } = require('../desktop/profile-route.cjs');
    for (let index = 0; index < 3; index++) {
      const route = resolveProfileRoute({ argv: ['--test', '--test-profile=' + join(scratch, 'p-' + index)],
        isPackaged: false, appDataPath: join(tmpdir(), 'product-data-unread'),
        defaultUserDataPath: join(tmpdir(), 'product-profile-unread') });
      assert.equal(route.isTest,true); assert.ok(route.userDataPath.endsWith('p-'+index));
    }
  } finally {
    await rm(output, { recursive: true, force: true });
    if (scratch) await rm(scratch, { recursive: true, force: true });
  }
});
