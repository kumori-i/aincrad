/** Bounded read-only inventory; no native launches and no unbounded directory materialization. */
import fs from 'node:fs';
import { realpath, lstat, opendir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const p = createRequire(import.meta.url)('./policy.cjs');

export function createBudget({ deadlineAt = Date.now() + p.LIMIT.totalMs, signal = null, now = Date.now,
  maxEntries = 4096, maxBytes = 2147483648, maxDepth = 12 } = {}) {
  p.demand(Number.isFinite(deadlineAt) && [maxEntries, maxBytes, maxDepth].every(n => Number.isSafeInteger(n) && n > 0), 'inventory-budget-invalid');
  const used = { entries: 0, bytes: 0 };
  const check = () => { p.demand(!signal?.aborted, 'inventory-aborted'); p.demand(now() < deadlineAt, 'inventory-deadline'); };
  const wait = async promise => {
    try { check(); } catch (error) { void Promise.resolve(promise).catch(() => {}); throw error; }
    let timer, onAbort;
    try {
      const gate = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('inventory-deadline')), Math.max(1, deadlineAt - now()));
        if (signal) { onAbort = () => reject(new Error('inventory-aborted')); signal.addEventListener('abort', onAbort, { once: true }); if (signal.aborted) onAbort(); }
      });
      const result = await Promise.race([promise, gate]); check(); return result;
    } finally { clearTimeout(timer); if (onAbort) signal.removeEventListener('abort', onAbort); }
  };
  return { check, wait, signal, used,
    entry(depth = 0) { check(); p.demand(depth <= maxDepth, 'inventory-depth-limit'); p.demand(++used.entries <= maxEntries, 'inventory-entry-limit'); },
    bytes(size) { check(); p.demand(Number.isSafeInteger(size) && size >= 0 && (used.bytes += size) <= maxBytes, 'inventory-byte-limit'); } };
}

async function observe(file, budget, limit) {
  budget.check(); const resolved = await budget.wait(realpath(file)), before = await budget.wait(lstat(file));
  p.demand(resolved === file && before.isFile() && !before.isSymbolicLink() && before.size > 0 && before.size <= limit, 'fingerprint-file-unavailable');
  return before;
}
async function consume(file, limit, budget, onBytes, streamFactory = fs.createReadStream) {
  budget.entry(); const before = await observe(file, budget, limit); let count = 0;
  const stream = streamFactory(file, { flags: fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW, ...(budget.signal ? { signal: budget.signal } : {}) });
  try {
    const iterator = stream[Symbol.asyncIterator]();
    for (;;) {
      budget.check(); const part = await budget.wait(iterator.next()); if (part.done) break;
      count += part.value.length; p.demand(count <= limit && count <= before.size, 'fingerprint-byte-limit');
      budget.bytes(part.value.length); onBytes(part.value);
    }
  } finally { stream.destroy(); }
  const after = await budget.wait(lstat(file)); budget.check();
  p.demand(count === before.size && after.size === before.size && after.ino === before.ino && after.dev === before.dev && after.mtimeMs === before.mtimeMs, 'fingerprint-file-changed');
  return { bytes: count, mode: before.mode & 0o7777, uid: before.uid };
}
export async function hashFile(file, limit = 536870912, budget = createBudget(), streamFactory = fs.createReadStream) {
  const hash = createHash('sha256'), row = await consume(file, limit, budget, bytes => hash.update(bytes), streamFactory);
  return { bytes: row.bytes, sha256: hash.digest('hex'), mode: row.mode, uid: row.uid };
}
export async function readBounded(file, limit, budget = createBudget()) {
  const chunks = []; await consume(file, limit, budget, bytes => chunks.push(bytes)); return Buffer.concat(chunks);
}
export async function runtimeInventory(root, budget = createBudget()) {
  const files = [];
  async function visit(prefix, depth) {
    budget.entry(depth); const directory = join(root, prefix);
    p.demand(await budget.wait(realpath(directory)) === directory, 'runtime-directory-alias');
    const opening = opendir(directory, { bufferSize: 16 }); let handle;
    try { handle = await budget.wait(opening); }
    catch (error) { void opening.then(h => h.close()).catch(() => {}); throw error; }
    const entries = [];
    try {
      for (;;) { const item = await budget.wait(handle.read()); if (!item) break; budget.entry(depth); entries.push(item); }
    } finally { await budget.wait(handle.close()); }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const item of entries) {
      budget.check(); p.demand(/^[A-Za-z0-9_.-]+$/.test(item.name) && !item.isSymbolicLink(), 'runtime-member-unavailable');
      const name = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.isDirectory()) await visit(name, depth + 1);
      else {
        p.demand(item.isFile(), 'runtime-file-unavailable'); const row = await hashFile(join(root, name), 536870912, budget);
        p.demand((row.mode & 0o6000) === 0, 'runtime-setid-unavailable'); files.push({ path: name, ...row });
        p.demand(files.length <= 512, 'runtime-file-census-limit');
      }
    }
  }
  await visit('', 0); budget.check(); return files;
}
