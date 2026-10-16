import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { X11_LIMIT, encodeSetup, parseSetupReply, probeX11Setup } from './x11-setup.mjs';

const cookie = () => Buffer.from('00112233445566778899aabbccddeeff', 'hex');
const options = (change = {}) => ({ displayNumber: 123, socketPath: '/tmp/.X11-unix/X123', cookie: cookie(), ownedServer: { isRunning: () => true }, ...change });
const refusal = (reason = 'Authorization required, but no authorization protocol specified\n') => {
  const text = Buffer.from(reason), bytes = Buffer.alloc(8 + ((text.length + 3) & ~3));
  bytes[1] = text.length; bytes.writeUInt16LE(11, 2); bytes.writeUInt16LE((bytes.length - 8) / 4, 6); text.copy(bytes, 8); return bytes;
};
function success(vendor = 'X.Org', depths = [1, 24]) {
  const vendorBytes = Buffer.from(vendor), formats = 40 + ((vendorBytes.length + 3) & ~3), screen = formats + 8 * depths.length;
  const b = Buffer.alloc(screen + 40 + depths.reduce((size, depth) => size + 8 + (depth >= 24 ? 24 : 0), 0));
  const formatOffsets = new Map(), depthOffsets = new Map(), visualOffsets = new Map();
  b[0] = 1; b.writeUInt16LE(11, 2); b.writeUInt16LE((b.length - 8) / 4, 6);
  b.writeUInt32LE(12101004, 8); b.writeUInt32LE(0x200000, 12); b.writeUInt32LE(0x1fffff, 16);
  b.writeUInt16LE(vendorBytes.length, 24); b.writeUInt16LE(65535, 26); b[28] = 1; b[29] = depths.length;
  b[32] = 32; b[33] = 32; b[34] = 8; b[35] = 255; vendorBytes.copy(b, 40);
  depths.forEach((depth, index) => { const at = formats + index * 8; formatOffsets.set(depth, at); b[at] = depth; b[at + 1] = depth === 24 ? 32 : depth; b[at + 2] = 32; });
  b.writeUInt32LE(0x50d, screen); b.writeUInt32LE(0x20, screen + 4); b.writeUInt32LE(0xffffff, screen + 8);
  b.writeUInt16LE(1440, screen + 20); b.writeUInt16LE(900, screen + 22); b.writeUInt16LE(381, screen + 24); b.writeUInt16LE(238, screen + 26);
  b.writeUInt16LE(1, screen + 28); b.writeUInt16LE(1, screen + 30); b.writeUInt32LE(0x21, screen + 32); b[screen + 38] = 24; b[screen + 39] = depths.length;
  let offset = screen + 40;
  for (const depth of depths) {
    depthOffsets.set(depth, offset); b[offset] = depth;
    if (depth >= 24) {
      b.writeUInt16LE(1, offset + 2); const visual = offset + 8; visualOffsets.set(depth, visual);
      b.writeUInt32LE(0x21, visual); b[visual + 4] = 4; b[visual + 5] = 8;
      b.writeUInt16LE(256, visual + 6); b.writeUInt32LE(0xff0000, visual + 8); b.writeUInt32LE(0x00ff00, visual + 12); b.writeUInt32LE(0x0000ff, visual + 16);
      offset += 24;
    }
    offset += 8;
  }
  return { bytes: b, screen, depth: depthOffsets.get(24), visual: visualOffsets.get(24), formatOffsets, depthOffsets, visualOffsets };
}
function clock() {
  let time = 0, id = 0; const timers = new Map();
  return { now: () => time, schedule: (fn, delay) => { timers.set(++id, { fn, at: time + delay }); return id; }, unschedule: id => timers.delete(id),
    advanceWithoutTimers(ms) { time += ms; },
    tick(ms) { const end = time + ms; for (;;) { const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!next) break; time = next[1].at; timers.delete(next[0]); next[1].fn(); } time = end; },
    count: () => timers.size };
}
class FakeSocket extends EventEmitter {
  constructor(script = {}) { super(); this.script = script; this.writes = []; this.ends = 0; this.destroys = 0; this.closed = false; }
  connect(value) { this.endpoint = value; if (this.script.connectThrow) throw new Error('private-connect-error'); queueMicrotask(() => { if (this.closed) return; if (this.script.connectError) this.emit('error', new Error('private-socket-error')); else if (!this.script.noConnect) this.emit('connect'); }); return this; }
  write(bytes, callback) {
    this.writes.push(Buffer.from(bytes)); this.packet = bytes;
    if (this.script.writeThrow) throw new Error('private-write-error');
    queueMicrotask(() => { if (this.closed) return; callback(this.script.writeError ? new Error('private-write-error') : null); this.script.onWrite?.(this);
      if (this.closed || this.script.writeError) return;
      for (const chunk of this.script.chunks || []) { if (this.closed) break; this.emit('data', chunk); }
      if (this.script.eof && !this.closed) { this.emit('end'); if (!this.closed) this.close(); }
    }); return true;
  }
  end(...args) { assert.equal(args.length, 0); this.ends++; this.script.onEnd?.(this);
    if (!this.script.noClose) queueMicrotask(() => { if (!this.closed) { this.emit('end'); this.close(this.script.closeError === true); } }); return this; }
  destroy() { this.destroys++; if (!this.script.stuckDestroy) queueMicrotask(() => this.close()); return this; }
  close(error = false) { if (!this.closed) { this.closed = true; this.emit('close', error); } }
}
function transport(scripts = [{ chunks: [success().bytes] }, { chunks: [refusal()] }, { chunks: [success().bytes] }]) {
  const time = clock(), sockets = [];
  return { sockets, time, io: { ...time, createSocket() { const socket = new FakeSocket(scripts[sockets.length]); sockets.push(socket); return socket; } } };
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const disposed = t => { assert.equal(t.time.count(), 0); for (const s of t.sockets) { assert.deepEqual(s.eventNames().sort(), s.closed ? [] : ['close', 'error']); if (s.packet) assert.ok(s.packet.every(b => b === 0)); } };

test('setup encoding is little-endian, padded, cookie-only or explicitly unauthenticated', () => {
  const secret = cookie(), packet = encodeSetup(secret);
  assert.equal(packet.length, 48); assert.equal(packet[0], 0x6c); assert.equal(packet.readUInt16LE(2), 11); assert.equal(packet.readUInt16LE(4), 0);
  assert.equal(packet.readUInt16LE(6), 18); assert.equal(packet.readUInt16LE(8), 16); assert.equal(packet.subarray(12, 30).toString(), 'MIT-MAGIC-COOKIE-1');
  assert.deepEqual([...packet.subarray(30, 32)], [0, 0]); assert.ok(packet.subarray(32).equals(secret)); assert.ok(secret.equals(cookie()));
  assert.equal(encodeSetup().toString('hex'), '6c000b000000000000000000');
  for (const bad of ['', secret.toString('hex'), Buffer.alloc(15), Buffer.alloc(17), new Uint8Array(16)]) assert.throws(() => encodeSetup(bad), { code: 'input' });
});
test('full success parser consumes padded vendors, formats, screen, depths and root visual', () => {
  for (const vendor of ['', 'A', 'AB', 'ABC', 'ABCD', 'X.Org']) {
    const f = success(vendor); const row = parseSetupReply(f.bytes, true);
    assert.deepEqual(row, { setupStatus: 'Success', width: 1440, height: 900, rootDepth: 24, screens: 1, formats: 2, depths: 2, visuals: 1 });
  }
  const f = success('A'); f.bytes[41] = 0xff; f.bytes[1] = 0xee; f.bytes[39] = 0xcc; f.bytes[f.visual + 23] = 0xbb;
  assert.equal(parseSetupReply(f.bytes, true).width, 1440); // unused bytes are unspecified by X11
});
test('depth one is required and consistent visual IDs may repeat across depths in either order', () => {
  assert.throws(() => parseSetupReply(success('X.Org', [24]).bytes, true), { code: 'malformed' });
  const missingDepth = success(); missingDepth.bytes[missingDepth.depthOffsets.get(1)] = 8;
  missingDepth.bytes[missingDepth.formatOffsets.get(1)] = 8; missingDepth.bytes[missingDepth.formatOffsets.get(1) + 1] = 8;
  assert.throws(() => parseSetupReply(missingDepth.bytes, true), { code: 'malformed' });
  for (const depths of [[1, 24, 32], [1, 32, 24], [1, 4, 8, 16, 24, 32]]) {
    const f = success('X.Org', depths); f.bytes[f.visualOffsets.get(32) + 23] = 0xab;
    const result = parseSetupReply(f.bytes, true); assert.equal(result.depths, depths.length); assert.equal(result.formats, depths.length); assert.equal(result.visuals, 1);
  }
  for (const field of [4, 5, 6, 8]) {
    const f = success('X.Org', [1, 24, 32]); f.bytes[f.visualOffsets.get(32) + field]++;
    assert.throws(() => parseSetupReply(f.bytes, true), { code: 'malformed' });
  }
  const wrongRoot = success('X.Org', [1, 32, 24]); wrongRoot.bytes.writeUInt32LE(0x22, wrongRoot.visual);
  assert.throws(() => parseSetupReply(wrongRoot.bytes, true), { code: 'malformed' });
  const f = success(), duplicate = Buffer.concat([f.bytes, f.bytes.subarray(f.visual, f.visual + 24)]);
  duplicate.writeUInt16LE((duplicate.length - 8) / 4, 6); duplicate.writeUInt16LE(2, f.depth + 2);
  assert.throws(() => parseSetupReply(duplicate, true), { code: 'malformed' });
});
test('resource masks, bitmap ordering and RGB masks follow the explicit setup constraints', () => {
  const edits = [
    b => b.writeUInt32LE(0x20000000, 12), b => b.writeUInt32LE(0x200fffff, 16), b => b.writeUInt32LE(0x1ffff, 16), b => b.writeUInt32LE(0x1ffffd, 16),
    b => { b[33] = 16; }, (b, f) => { b[f.formatOffsets.get(1) + 2] = 16; }, (b, f) => b.writeUInt32LE(0xfd0000, f.visual + 8)
  ];
  for (const edit of edits) { const f = success(); edit(f.bytes, f); assert.throws(() => parseSetupReply(f.bytes, true), { code: 'malformed' }); }
  const shifted = success(); shifted.bytes.writeUInt32LE(0, 12); shifted.bytes.writeUInt32LE(0x1ffff800, 16);
  assert.equal(parseSetupReply(shifted.bytes, true).setupStatus, 'Success');
});
test('only explicit exact missing-authorization failure qualifies the empty-auth exchange', () => {
  assert.equal(refusal().length, 72); assert.equal(parseSetupReply(refusal(), false).cookieFreeDenied, true);
  for (const reason of ['Authorization required', 'Invalid MIT-MAGIC-COOKIE-1 key', 'Authorization required, but no authorization protocol specified', 'Authorization required, but no authorization protocol specified\nprivate', '']) assert.throws(() => parseSetupReply(refusal(reason), false), { code: 'authorization-reason' });
  assert.throws(() => parseSetupReply(refusal(), true), { code: 'unexpected-status' }); assert.throws(() => parseSetupReply(success().bytes, false), { code: 'unexpected-status' });
});
test('wrong framing, versions, statuses, dimensions and inconsistent counted records reject', () => {
  const edits = [
    [b => { b[0] = 2; }, 'authenticate'], [b => { b[0] = 3; }, 'unexpected-status'], [b => b.writeUInt16LE(10, 2), 'version'], [b => b.writeUInt16LE(1, 4), 'version'],
    [(b, f) => b.writeUInt16LE(1439, f.screen + 20), 'dimensions'], [(b, f) => b.writeUInt16LE(901, f.screen + 22), 'dimensions'], [(b, f) => { b[f.screen + 38] = 32; }, 'dimensions'],
    [b => { b[28] = 2; }, 'malformed'], [b => { b[30] = 2; }, 'malformed'], [b => { b[32] = 7; }, 'malformed'], [b => { b[35] = 1; }, 'malformed'],
    [(b, f) => { b[f.screen - 7] = 8; }, 'malformed'], [(b, f) => b.writeUInt32LE(0, f.screen), 'malformed'], [(b, f) => { b[f.screen + 37] = 2; }, 'malformed'],
    [(b, f) => b.writeUInt16LE(2, f.depth + 2), 'truncated'], [(b, f) => { b[f.depth] = 8; }, 'malformed'], [(b, f) => { b[f.visual + 4] = 6; }, 'malformed'],
    [(b, f) => b.writeUInt32LE(0x22, f.screen + 32), 'malformed'], [(b, f) => b.writeUInt32LE(0xff0000, f.visual + 12), 'malformed']
  ];
  for (const [edit, code] of edits) { const f = success(); edit(f.bytes, f); assert.throws(() => parseSetupReply(f.bytes, true), { code }); }
  const full = success().bytes;
  for (let n = 0; n < full.length; n++) assert.throws(() => parseSetupReply(full.subarray(0, n), true));
  assert.throws(() => parseSetupReply(Buffer.concat([full, Buffer.alloc(4)]), true), { code: 'extra-data' });
  const surplus = Buffer.concat([full, Buffer.alloc(4)]); surplus.writeUInt16LE((surplus.length - 8) / 4, 6); assert.throws(() => parseSetupReply(surplus, true), { code: 'extra-data' });
});
test('exactly one auth/empty/auth sequence accepts arbitrarily fragmented setup replies and disposes every socket', async () => {
  const frames = [success().bytes, refusal(), success('AB').bytes];
  const t = transport(frames.map(frame => ({ chunks: [...frame].map(byte => Buffer.from([byte])) }))), input = options();
  const result = await probeX11Setup(input, t.io);
  assert.equal(result.status, 'qualified'); assert.equal(result.requestsAfterSetup, 0); assert.equal(t.sockets.length, 3);
  assert.deepEqual(result.exchanges.map(r => r.status), ['accepted', 'denied', 'accepted']);
  assert.deepEqual(result.exchanges.map(r => r.setupStatus), ['Success', 'Failed', 'Success']);
  for (const [i, s] of t.sockets.entries()) { assert.deepEqual(s.endpoint, { path: '/tmp/.X11-unix/X123' }); assert.equal(s.writes.length, 1); assert.ok(s.writes[0].equals(encodeSetup(i === 1 ? null : cookie()))); assert.equal(s.ends, 1); assert.equal(s.closed, true); }
  assert.ok(input.cookie.equals(cookie())); assert.doesNotMatch(JSON.stringify(result), /001122|MIT-MAGIC|X\.Org|Authorization required/); disposed(t);
  const again = await probeX11Setup(input, t.io); assert.equal(again.reason, 'sequence-used'); assert.equal(t.sockets.length, 3);
});
test('strict endpoint/cookie admission consumes valid owned handles even on failure', async () => {
  for (const change of [{ displayNumber: 99 }, { displayNumber: 500 }, { displayNumber: '123' }, { socketPath: '/tmp/.X11-unix/X124' }, { socketPath: '\0/tmp/.X11-unix/X123' }, { socketPath: 'localhost:123' }, { host: 'localhost', port: 6123 }, { cookie: cookie().toString('hex') }, { cookie: Buffer.alloc(15) }, { signal: {} }]) {
    const t = transport(), input = options(change); assert.equal((await probeX11Setup(input, t.io)).reason, 'input'); assert.equal(t.sockets.length, 0);
    assert.equal((await probeX11Setup({ ...options(), ownedServer: input.ownedServer }, t.io)).reason, 'sequence-used'); disposed(t);
  }
});
test('generic rejection or unexpected success stops at the negative stage and retains completed evidence', async () => {
  for (const frame of [refusal('server full'), success().bytes]) {
    const t = transport([{ chunks: [success().bytes] }, { chunks: [frame] }]); const result = await probeX11Setup(options(), t.io);
    assert.equal(result.status, 'unavailable'); assert.equal(result.stage, 'cookie-free'); assert.equal(result.exchanges.length, 2); assert.equal(result.exchanges[0].status, 'accepted');
    assert.equal(t.sockets.length, 2); disposed(t);
  }
});
test('premature EOF, advertised oversize, extra frames and late extra bytes are unavailable', async () => {
  const oversized = Buffer.alloc(8); oversized[0] = 1; oversized.writeUInt16LE(65535, 6);
  for (const script of [
    { chunks: [success().bytes.subarray(0, 6)], eof: true }, { chunks: [success().bytes.subarray(0, 80)], eof: true },
    { chunks: [oversized] }, { chunks: [Buffer.alloc(X11_LIMIT.replyBytes + 1)] },
    { chunks: [Buffer.concat([success().bytes, refusal()])] },
    { chunks: [success().bytes], onEnd: s => queueMicrotask(() => s.emit('data', Buffer.from([1]))) }
  ]) { const t = transport([script]); const result = await probeX11Setup(options(), t.io); assert.equal(result.status, 'unavailable'); assert.equal(result.exchanges.length, 1); assert.ok(['truncated', 'oversize', 'extra-data'].includes(result.reason)); disposed(t); }
});
test('connect/write/socket errors are bounded and raw messages never escape', async () => {
  for (const script of [{ connectThrow: true }, { connectError: true }, { writeThrow: true }, { writeError: true }]) {
    const t = transport([script]); const result = await probeX11Setup(options(), t.io); assert.equal(result.reason, 'socket-error'); assert.doesNotMatch(JSON.stringify(result), /private/); disposed(t);
  }
});
test('timeouts and aborts destroy owned sockets with a bounded cleanup tail', async () => {
  for (const script of [{ noConnect: true }, { chunks: [] }, { chunks: [success().bytes], noClose: true }, { noConnect: true, stuckDestroy: true }]) {
    const t = transport([script]), pending = probeX11Setup(options(), t.io); await flush(); t.time.tick(X11_LIMIT.exchangeMs); await flush(); t.time.tick(X11_LIMIT.cleanupMs); const result = await pending;
    assert.equal(result.reason, 'deadline'); assert.equal(t.sockets[0].destroys, 1); assert.equal(result.exchanges[0].closeConfirmed, !script.stuckDestroy); disposed(t);
  }
  const controller = new AbortController(), t = transport([{ chunks: [] }]), pending = probeX11Setup(options({ signal: controller.signal }), t.io);
  await flush(); controller.abort(); const result = await pending; assert.equal(result.reason, 'aborted'); assert.equal(t.sockets[0].destroys, 1); disposed(t);
  const early = new AbortController(); early.abort(); const inert = transport(); assert.equal((await probeX11Setup(options({ signal: early.signal }), inert.io)).reason, 'aborted'); assert.equal(inert.sockets.length, 0);
});
test('absolute exchange expiry rejects late valid reply or close before the timer callback runs', async () => {
  for (const phase of ['connect', 'reply', 'end', 'close']) {
    const script = phase === 'connect' ? { noConnect: true } : phase === 'reply' ? { chunks: [] } : { chunks: [success().bytes], noClose: true };
    const t = transport([script]), pending = probeX11Setup(options(), t.io); await flush();
    const socket = t.sockets[0];
    if (phase === 'close') socket.emit('end');
    t.time.advanceWithoutTimers(X11_LIMIT.exchangeMs + 1);
    if (phase === 'connect') socket.emit('connect');
    else if (phase === 'reply') socket.emit('data', success().bytes);
    else if (phase === 'end') socket.emit('end');
    socket.close();
    const result = await pending;
    assert.equal(result.status, 'unavailable'); assert.equal(result.reason, 'deadline'); assert.equal(result.exchanges.length, 1); assert.equal(t.sockets.length, 1);
    assert.equal(result.exchanges[0].closeConfirmed, true); disposed(t);
  }
});
test('late error and close after cleanup timeout cannot resume or mutate a completed stage', async () => {
  const t = transport([{ chunks: [success().bytes], noClose: true, stuckDestroy: true }]), pending = probeX11Setup(options(), t.io);
  await flush(); t.time.tick(X11_LIMIT.exchangeMs); await flush(); t.time.tick(X11_LIMIT.cleanupMs);
  const result = await pending, snapshot = JSON.stringify(result), socket = t.sockets[0];
  assert.equal(result.status, 'unavailable'); assert.equal(result.exchanges[0].closeConfirmed, false); assert.ok(Object.isFrozen(result.exchanges[0])); disposed(t);
  assert.doesNotThrow(() => { socket.emit('error', new Error('private-late-error')); socket.emit('data', refusal()); socket.close(); });
  await flush(); assert.equal(JSON.stringify(result), snapshot); assert.equal(t.sockets.length, 1); assert.equal(socket.writes.length, 1); assert.ok(socket.packet.every(b => b === 0)); disposed(t);
});
test('owned server must remain live before and after each exchange and sequence', async () => {
  const dead = transport(); assert.equal((await probeX11Setup(options({ ownedServer: { isRunning: () => false } }), dead.io)).reason, 'server-not-live'); assert.equal(dead.sockets.length, 0);
  for (const stage of [0, 1, 2]) {
    let running = true; const scripts = [{ chunks: [success().bytes] }, { chunks: [refusal()] }, { chunks: [success().bytes] }];
    scripts[stage].onEnd = () => { running = false; }; const t = transport(scripts);
    const result = await probeX11Setup(options({ ownedServer: { isRunning: () => running } }), t.io);
    assert.equal(result.reason, 'server-not-live'); assert.equal(result.exchanges.length, stage + 1); assert.equal(result.exchanges.at(-1).serverLiveAfter, false); disposed(t);
  }
});
test('close without EOF and error close cannot certify a setup', async () => {
  for (const script of [{ chunks: [success().bytes], onEnd: s => s.close() }, { chunks: [success().bytes], closeError: true }]) {
    const t = transport([script]); const result = await probeX11Setup(options(), t.io); assert.equal(result.status, 'unavailable'); assert.ok(['socket-close', 'socket-error'].includes(result.reason)); disposed(t);
  }
});
test('source exposes no command, TCP or environment-selected transport route', async () => {
  const source = await readFile(new URL('./x11-setup.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /child_process|execFile|spawn\(|process\.env|\.connect\([^)]*(?:host|port)|console\.|JSON\.stringify/);
  assert.match(source, /socket\.connect\(\{ path \}\)/); assert.match(source, /socket\.end\(\)/);
});
