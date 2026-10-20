/** Harness-only contracts. These functions are also serialized into the
 * sandboxed renderer; they never replace the application's save/boot guards. */
import { cp, lstat, mkdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';

export async function canonicalApplicationRoot(scratch, fs = { mkdir, realpath }) {
  const requested = join(scratch, 'app');
  await fs.mkdir(requested, { recursive: true });
  // Windows TEMP can use an 8.3 alias. The unchanged application protocol
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

export function installEmptySlots(storage, { oldKey, key, oldSentinel, inputRaw }) {
  if (storage.getItem(oldKey) !== null)
    throw new Error('Disposable original slot unexpectedly occupied');
  if (storage.getItem(key) !== null)
    throw new Error('Disposable Ozark slot unexpectedly occupied');
  storage.setItem(oldKey, oldSentinel);
  storage.setItem(key, inputRaw);
  if (storage.getItem(oldKey) !== oldSentinel || storage.getItem(key) !== inputRaw)
    throw new Error('Disposable fixture slots did not read back exactly');
  return storage.getItem(key);
}

export async function ordinaryRouteSnapshot(window, document) {
  const element = id => document.getElementById(id);
  return {
    url: window.location.href,
    playHook: Boolean(window.__aincrad),
    worldBridge: typeof window.aincradWorld?.open === 'function',
    profile: await window.aincradProfile?.status(),
    recoveryVisible: Boolean(element('recovery-panel') &&
      !element('recovery-panel').classList.contains('hidden')),
    recoveryTitle: element('recovery-title')?.textContent,
    recoveryDiagnosis: element('recovery-diagnosis')?.textContent,
    beginDisabled: element('begin')?.disabled,
    recoveryOzarkVisible: Boolean(element('recovery-ozark') &&
      !element('recovery-ozark').classList.contains('hidden')),
  };
}

export function assertOrdinaryRoute(snapshot, phase) {
  if (!['write', 'read'].includes(phase)) throw new Error('Unknown native phase');
  if (snapshot.url !== 'aincrad://app/index.html?test=1' || !snapshot.worldBridge ||
      snapshot.profile?.kind !== 'original' || snapshot.profile.phase !== 'none' ||
      snapshot.profile.available !== false ||
      typeof snapshot.profile.recoveredCopySupported !== 'boolean')
    throw new Error('Native original profile/route was not ready');
  if (phase === 'write') {
    if (!snapshot.playHook || snapshot.recoveryVisible || snapshot.beginDisabled)
      throw new Error('An empty disposable original profile did not initialize normally');
  } else if (snapshot.playHook || !snapshot.recoveryVisible || !snapshot.beginDisabled ||
      snapshot.recoveryTitle !== 'Your original world needs recovery.' ||
      !snapshot.recoveryDiagnosis || !snapshot.recoveryOzarkVisible) {
    throw new Error('The occupied invalid original slot was not protected by recovery');
  }
}
