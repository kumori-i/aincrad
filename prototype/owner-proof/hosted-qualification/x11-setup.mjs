/** Fixed, owned Unix display; connection setup only. Importing this module opens nothing.
 * Wire schema: https://xorg.freedesktop.org/archive/X11R7.7/doc/xproto/x11protocol.html#Connection_Setup
 * Refusal text: Xorg os/auth.c, CheckAuthorization (empty authorization protocol).
 */
import { Socket } from 'node:net';

export const X11_LIMIT = Object.freeze({ replyBytes: 65536, exchangeMs: 1500, cleanupMs: 250, sequenceMs: 6000 });
const AUTH = Buffer.from('MIT-MAGIC-COOKIE-1', 'ascii');
const DENIAL = Buffer.from('Authorization required, but no authorization protocol specified\n', 'ascii');
const STAGES = Object.freeze(['authenticated-first', 'cookie-free', 'authenticated-recheck']);
const USED = new WeakSet();
const REASONS = new Set(['input', 'sequence-used', 'server-not-live', 'aborted', 'deadline', 'socket-error', 'socket-close', 'cleanup', 'truncated', 'oversize', 'extra-data', 'malformed', 'version', 'authenticate', 'unexpected-status', 'authorization-reason', 'dimensions', 'internal']);
const fail = code => { const error = new Error(`x11-setup-${code}`); error.code = code; throw error; };
const demand = (ok, code = 'malformed') => { if (!ok) fail(code); };
const pad4 = n => (n + 3) & ~3;
const contiguousBits = n => {
  if (n === 0) return 0;
  while (!(n & 1)) n >>>= 1;
  let count = 0; while (n & 1) { count++; n >>>= 1; }
  return n === 0 ? count : 0;
};
const safeReason = error => { try { const code = error?.code; return REASONS.has(code) ? code : 'internal'; } catch { return 'internal'; } };
const REAL = Object.freeze({ createSocket: () => new Socket({ allowHalfOpen: true }), now: () => performance.now(), schedule: setTimeout, unschedule: clearTimeout });

export function encodeSetup(cookie = null) {
  demand(cookie === null || (Buffer.isBuffer(cookie) && cookie.length === 16), 'input');
  const name = cookie === null ? Buffer.alloc(0) : AUTH, data = cookie ?? Buffer.alloc(0);
  const packet = Buffer.alloc(12 + pad4(name.length) + pad4(data.length));
  packet[0] = 0x6c; packet.writeUInt16LE(11, 2); packet.writeUInt16LE(name.length, 6); packet.writeUInt16LE(data.length, 8);
  name.copy(packet, 12); data.copy(packet, 12 + pad4(name.length)); return packet;
}

/** Parse every declared screen/depth/visual record; unused protocol padding is not required to be zero. */
export function parseSetupReply(bytes, authenticated) {
  demand(Buffer.isBuffer(bytes) && bytes.length >= 8 && bytes.length <= X11_LIMIT.replyBytes && typeof authenticated === 'boolean');
  const length = 8 + bytes.readUInt16LE(6) * 4;
  demand(bytes.length === length, bytes.length < length ? 'truncated' : 'extra-data');
  if (bytes[0] === 2) fail('authenticate');
  demand(bytes[0] === 0 || bytes[0] === 1, 'unexpected-status');
  demand(bytes.readUInt16LE(2) === 11 && bytes.readUInt16LE(4) === 0, 'version');
  if (bytes[0] === 0) {
    demand(!authenticated, 'unexpected-status');
    const n = bytes[1]; demand(length === 8 + pad4(n));
    demand(bytes.subarray(8, 8 + n).equals(DENIAL), 'authorization-reason');
    return { setupStatus: 'Failed', cookieFreeDenied: true, authorizationReason: 'missing-authorization-protocol' };
  }
  demand(authenticated, 'unexpected-status'); demand(bytes.length >= 40);
  const u16 = n => bytes.readUInt16LE(n), u32 = n => bytes.readUInt32LE(n);
  const vendorLength = u16(24), formatsCount = bytes[29], formats = new Map();
  demand(u32(12) <= 0x1fffffff && u32(16) <= 0x1fffffff && contiguousBits(u32(16)) >= 18 && (u32(12) & u32(16)) === 0 && u16(26) >= 4096);
  demand(bytes[28] === 1 && formatsCount > 0 && formatsCount <= 32);
  demand(bytes[30] <= 1 && bytes[31] <= 1 && [8, 16, 32].includes(bytes[32]) && [8, 16, 32].includes(bytes[33]));
  demand(bytes[32] <= bytes[33]);
  demand(bytes[34] >= 8 && bytes[35] >= bytes[34]);
  let offset = 40;
  const take = count => { demand(Number.isSafeInteger(count) && count >= 0 && offset + count <= bytes.length, 'truncated'); const start = offset; offset += count; return start; };
  take(pad4(vendorLength));
  for (let n = 0; n < formatsCount; n++) {
    const at = take(8), depth = bytes[at], bpp = bytes[at + 1], pad = bytes[at + 2];
    demand(depth >= 1 && depth <= 32 && [1, 4, 8, 16, 24, 32].includes(bpp) && bpp >= depth && [8, 16, 32].includes(pad) && !formats.has(depth));
    demand(bpp !== 1 || pad === bytes[33]);
    formats.set(depth, bpp);
  }
  demand(formats.has(1));
  const screen = take(40), rootVisual = u32(screen + 32), rootDepth = bytes[screen + 38], depthCount = bytes[screen + 39];
  const width = u16(screen + 20), height = u16(screen + 22);
  demand(width === 1440 && height === 900 && rootDepth === 24, 'dimensions');
  demand(u32(screen) !== 0 && u32(screen + 4) !== 0 && rootVisual !== 0 && u16(screen + 24) > 0 && u16(screen + 26) > 0);
  demand(u16(screen + 28) > 0 && u16(screen + 30) >= u16(screen + 28) && bytes[screen + 36] <= 2 && bytes[screen + 37] <= 1);
  demand(depthCount > 0 && depthCount <= 32 && formats.has(rootDepth));
  const depths = new Set(), visuals = new Map(); let rootFound = false;
  for (let n = 0; n < depthCount; n++) {
    const at = take(8), depth = bytes[at], count = u16(at + 2);
    demand(formats.has(depth) && !depths.has(depth)); depths.add(depth);
    demand(count <= Math.floor((bytes.length - offset) / 24), 'truncated');
    const depthVisuals = new Set();
    for (let v = 0; v < count; v++) {
      const visual = take(24), id = u32(visual), kind = bytes[visual + 4];
      demand(id !== 0 && !depthVisuals.has(id) && kind <= 5 && bytes[visual + 5] > 0 && bytes[visual + 5] <= 32 && u16(visual + 6) > 0);
      depthVisuals.add(id);
      const definition = [kind, bytes[visual + 5], u16(visual + 6)];
      if (kind === 4 || kind === 5) {
        const r = u32(visual + 8), g = u32(visual + 12), b = u32(visual + 16);
        demand(contiguousBits(r) > 0 && contiguousBits(g) > 0 && contiguousBits(b) > 0 && !(r & g) && !(r & b) && !(g & b));
        definition.push(r, g, b);
      }
      const prior = visuals.get(id);
      demand(!prior || (prior.length === definition.length && prior.every((value, index) => value === definition[index])));
      visuals.set(id, definition);
      if (id === rootVisual && depth === rootDepth) rootFound = true;
    }
  }
  demand(rootFound && depths.has(1) && depths.has(rootDepth)); demand(offset === bytes.length, 'extra-data');
  return { setupStatus: 'Success', width, height, rootDepth, screens: 1, formats: formatsCount, depths: depthCount, visuals: visuals.size };
}

function live(owner) { try { return owner.isRunning() === true; } catch { return false; } }
const ignoreLateError = () => {};
function absorbUntilClose(socket) {
  // A timed-out destroy may finish later. Keep only harmless handlers, with no
  // packet, result or stage references, until the transport confirms closure.
  socket.on('error', ignoreLateError);
  socket.once('close', () => socket.off('error', ignoreLateError));
}

function exchange(stage, packet, path, owner, signal, sequenceDeadline, io) {
  return new Promise(resolve => {
    const deadline = Math.min(io.now() + X11_LIMIT.exchangeMs, sequenceDeadline), expired = () => io.now() >= deadline;
    const row = { stage, status: 'unavailable', reason: null, setupStatus: null, requestBytes: packet.length, replyBytes: 0, serverLiveBefore: live(owner), serverLiveAfter: false, closeConfirmed: false };
    const bytes = Buffer.alloc(X11_LIMIT.replyBytes);
    let socket, timer, cleanupTimer, done = false, stopping = false, connected = false, written = false, ending = false, ended = false, candidate = null, expected = null;
    const finish = () => {
      if (done) return; done = true; io.unschedule(timer); io.unschedule(cleanupTimer); signal?.removeEventListener('abort', onAbort);
      if (socket) {
        for (const [name, handler] of Object.entries(handlers)) socket.off(name, handler);
        if (!row.closeConfirmed) absorbUntilClose(socket);
      }
      row.serverLiveAfter = live(owner);
      if (!row.serverLiveAfter) row.reason ||= 'server-not-live';
      if (expired()) row.reason ||= 'deadline';
      if (!row.reason && candidate && row.closeConfirmed && ended) { Object.assign(row, candidate); row.status = stage === 'cookie-free' ? 'denied' : 'accepted'; }
      else row.reason ||= 'socket-close';
      packet.fill(0); bytes.fill(0); resolve(Object.freeze(row));
    };
    const stop = reason => {
      if (done) return; row.reason ||= reason;
      if (stopping) return; stopping = true; io.unschedule(timer);
      cleanupTimer = io.schedule(finish, X11_LIMIT.cleanupMs);
      try { if (socket) socket.destroy(); else finish(); } catch { row.reason = 'cleanup'; finish(); }
    };
    const onAbort = () => stop('aborted');
    const handlers = {
      connect() {
        if (done || stopping) return;
        if (expired()) return stop('deadline');
        if (connected || !live(owner)) return stop(connected ? 'malformed' : 'server-not-live');
        if (expired()) return stop('deadline');
        connected = true; written = true;
        try { socket.write(packet, error => { if (error) stop('socket-error'); }); } catch { stop('socket-error'); }
      },
      data(chunk) {
        if (done || stopping) return;
        if (expired()) return stop('deadline');
        if (!written || !Buffer.isBuffer(chunk)) return stop('malformed');
        if (!live(owner)) return stop('server-not-live');
        if (expired()) return stop('deadline');
        if (chunk.length > X11_LIMIT.replyBytes - row.replyBytes) { row.replyBytes = X11_LIMIT.replyBytes + 1; return stop('oversize'); }
        chunk.copy(bytes, row.replyBytes); row.replyBytes += chunk.length;
        try {
          if (row.replyBytes >= 8 && expected === null) {
            row.setupStatus = ['Failed', 'Success', 'Authenticate'][bytes[0]] ?? 'Unknown'; expected = 8 + bytes.readUInt16LE(6) * 4;
            demand(expected <= X11_LIMIT.replyBytes, 'oversize');
          }
          if (expected === null || row.replyBytes < expected) return;
          demand(row.replyBytes === expected && !candidate, 'extra-data');
          candidate = parseSetupReply(bytes.subarray(0, expected), stage !== 'cookie-free');
          if (expired()) return stop('deadline');
          ending = true; socket.end(); // FIN only: no request bytes follow setup.
        } catch (error) { stop(safeReason(error)); }
      },
      end() { if (done || stopping) return; if (expired()) return stop('deadline'); ended = true; if (!ending || !candidate) stop('truncated'); },
      error() { stop('socket-error'); },
      close(hadError) {
        if (done) return; row.closeConfirmed = true;
        if (hadError) row.reason ||= 'socket-error';
        if (!candidate) row.reason ||= 'truncated';
        finish();
      }
    };
    if (!row.serverLiveBefore) { row.reason = 'server-not-live'; finish(); return; }
    if (signal?.aborted) { row.reason = 'aborted'; finish(); return; }
    const remaining = deadline - io.now();
    if (remaining <= 0) { row.reason = 'deadline'; finish(); return; }
    try {
      socket = io.createSocket(); for (const [name, handler] of Object.entries(handlers)) socket.on(name, handler);
      timer = io.schedule(() => stop('deadline'), remaining); signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) { stop('aborted'); return; }
      if (expired()) { stop('deadline'); return; }
      socket.connect({ path });
    } catch { stop('socket-error'); }
  });
}

/** One attempt per owned process handle, including failed admission. Test adapters cannot be selected by CLI or environment. */
export async function probeX11Setup(options, io = REAL) {
  const exchanges = [], result = { status: 'unavailable', stage: 'admission', reason: null, exchanges };
  let secret;
  try {
    demand(options && typeof options === 'object' && options.ownedServer && typeof options.ownedServer === 'object' && typeof options.ownedServer.isRunning === 'function', 'input');
    const owner = options.ownedServer;
    demand(!USED.has(owner), 'sequence-used'); USED.add(owner);
    demand(Object.keys(options).every(key => ['displayNumber', 'socketPath', 'cookie', 'ownedServer', 'signal'].includes(key)), 'input');
    const { displayNumber, socketPath, cookie, signal } = options;
    demand(Number.isInteger(displayNumber) && displayNumber >= 100 && displayNumber < 500, 'input');
    const path = `/tmp/.X11-unix/X${displayNumber}`; demand(socketPath === path, 'input');
    demand(Buffer.isBuffer(cookie) && cookie.length === 16 && (signal == null || signal instanceof AbortSignal), 'input');
    demand(live(owner), 'server-not-live'); demand(!signal?.aborted, 'aborted');
    secret = Buffer.from(cookie); const deadline = io.now() + X11_LIMIT.sequenceMs;
    for (const stage of STAGES) {
      result.stage = stage;
      const row = await exchange(stage, encodeSetup(stage === 'cookie-free' ? null : secret), path, owner, signal, deadline, io); exchanges.push(row);
      if (row.status === 'unavailable') { result.reason = row.reason; return result; }
    }
    demand(live(owner), 'server-not-live'); demand(!signal?.aborted, 'aborted'); demand(io.now() < deadline, 'deadline');
    return { ...result, status: 'qualified', stage: 'complete', reason: null, displayNumber, width: 1440, height: 900, cookieFreeDenied: true, requestsAfterSetup: 0 };
  } catch (error) { result.reason = safeReason(error); return result; }
  finally { secret?.fill(0); }
}
