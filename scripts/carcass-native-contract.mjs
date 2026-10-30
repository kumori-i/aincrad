/** Harness-only contracts. These functions are also serialized into the
 * sandboxed renderer; they never replace the application's save/boot guards. */
import { cp, lstat, mkdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

export function nativeSourceIdentity(root) {
  const git = (...args) => execFileSync('git', args, {cwd:root,encoding:'utf8'}).trim();
  return {commit:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}'),
    worktreeStatus:git('status','--porcelain')};
}


export async function canonicalApplicationRoot(scratch, fs = { mkdir, realpath }) {
  const requested = join(scratch, 'app');
  await fs.mkdir(requested, { recursive: true });
  // macOS temporary directories can use /var and /private/var aliases. The unchanged application protocol
  // compares its lexical renderer root with realpath(asset), so build/load the
  // temporary app by its canonical path. Keep the profile argument under the
  // original os.tmpdir spelling required by the separate profile validator.
  return fs.realpath(requested);
}

export function captureNativeChild(spawn, executable, args, options, onStdout, onStderr) {
  return new Promise(resolve => {
    const child = spawn(executable, args, options);
    let stdout = '', stderr = '', spawnError = null;
    child.stdout?.on('data', bytes => { stdout += bytes; onStdout(bytes); });
    child.stderr?.on('data', bytes => { stderr += bytes; onStderr(bytes); });
    child.on('error', error => { spawnError = error; });
    // exit may precede the final pipe output. close also follows spawn error.
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr, spawnError }));
  });
}

export async function archiveNativeProfile(profile, destination) {
  const skipped = [];
  await cp(profile, destination, { recursive: true, force: false, errorOnExist: true,
    filter: async source => {
      const info = await lstat(source), keep = info.isDirectory() || info.isFile();
      if (!keep) skipped.push(source);
      return keep;
    } });
  return { regularFilesAndDirectoriesOnly: true, skipped };
}

export function installEmptyCurrentSlot(storage, { key, inputRaw }) {
  if (key !== 'aincrad.world.v2') throw new Error('Only the current world slot is supported');
  if (storage.getItem(key) !== null) throw new Error('Disposable current world slot unexpectedly occupied');
  storage.setItem(key, inputRaw);
  if (storage.getItem(key) !== inputRaw) throw new Error('Disposable current fixture did not read back exactly');
  return storage.getItem(key);
}

export function currentRouteSnapshot(window, document) {
  return { url:window.location.href, hook:Boolean(window.__ozarkWorld),
    retiredWorldBridge:typeof window.aincradWorld !== 'undefined',
    retiredProfileBridge:typeof window.aincradProfile !== 'undefined',
    chooserPresent:Boolean(document.getElementById('welcome')),
    snapshot:window.__ozarkWorld?.snapshot() };
}
export function assertCurrentRoute(result) {
  if(result.url !== 'aincrad://app/index.html?test=1' || !result.hook ||
    result.retiredWorldBridge || result.retiredProfileBridge || result.chooserPresent ||
    result.snapshot?.blocked !== false || result.snapshot.started !== false ||
    result.snapshot.version !== 12 || result.snapshot.features?.plantLifecycle !== 1 ||
    result.snapshot.features?.finiteAquatic !== 2 || result.snapshot.features?.worldStructures !== 1 ||
    result.snapshot.features?.characterMessages !== 2 ||
    Reflect.ownKeys(result.snapshot.features).length !== 4)
    throw new Error('The sole current-world test runtime was not ready');
}
