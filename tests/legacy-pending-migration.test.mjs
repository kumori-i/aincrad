import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { freshState } from '../src/world.js';
import { CONFIG } from '../src/config.js';
import { ingestMaterial, projectPhysiology, tickPhysiology } from '../src/biology.js';
import { validateEnvironment } from '../src/environment.js';
import { processDiscoveryFeedback } from '../src/discovery.js';
import { loadSave, prepareLegacyPendingMigration, writeSave } from '../src/save.js';
import { applyProofRetention, planProofRetention, retainedEffectProofError, retainedProofIntegrityError } from '../src/proof-retention.js';

const marker = 'legacy-sampled-unproven';
const snapshotDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../task/evidence/aincrad-snapshots');
const copyHashes = Object.freeze({
  '000038.log': 'a7da17b1ca57f23e30246fa7e92c82520d7d39a724be138114f3d1d3c00c2c37',
  '000040.log': 'f4af7468ced4c254a529be83dfd92a2553589827a488b1e899ca645d9114b2d9',
  '000042.log': 'cce5453421ab4171634cb8d5ce232b1cf9dd1f496ad15064aee9756c96b27e2c',
  '000045.log': '0f549cf6a64ca52ecea88bc9fedfc562472c44cc514ecd57af5c2beeb22bdd6c',
});

function storage(value = null) {
  const values = new Map(value === null ? [] : [[CONFIG.saveKey, value]]);
  return { getItem: key => values.get(key) ?? null, setItem: (key, next) => values.set(key, next) };
}

function serialized(state) {
  const { npc: historicalAlias, ...saved } = state;
  return JSON.stringify(saved);
}

// A real digestive transfer paired with a genuine-shaped sample action but no
// experiment. Only the explicit migration path may reinterpret this history.
function orphanFixture() {
  const state = freshState({connectedEcology:false}), actor = state.agents[0], objectId = 'object:900001';
  const actionId = actor.memory.nextId++;
  const result = ingestMaterial(actor,
    { massGrams: 30, energyKcal: 16, waterMl: 24, digestHours: 2 },
    { source: 'sampled', objectId, actionId, at: actor.elapsed });
  assert.equal(result.code, 'SWALLOWED');
  projectPhysiology(actor);
  actor.memory.experience.push({ id: actionId, at: actor.elapsed, type: 'action',
    details: { action: { type: 'sample', targetId: objectId }, result } });
  return { raw: JSON.parse(serialized(state)), actionId, ingestionId: result.ingestionId, objectId };
}
function advanceFixtureTime(state, actor, seconds) {
  actor.elapsed += seconds;
  state.elapsed += seconds;
  state.environment = validateEnvironment(state.environment,
    { elapsed: state.elapsed, mode: state.simulationMode });
}

function readVarint(buffer, offset) {
  let value = 0, scale = 1;
  for (let i = 0; i < 8; i++) {
    assert.ok(offset < buffer.length, 'complete LevelDB varint');
    const byte = buffer[offset++];
    value += (byte & 0x7f) * scale;
    if (!(byte & 0x80)) return { value, offset };
    scale *= 128;
  }
  assert.fail('oversized LevelDB varint');
}

function copiedSave(file) {
  const bytes = readFileSync(resolve(snapshotDir, file));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), copyHashes[file], 'unaltered private copy');
  const records = [];
  let position = 0, fragments = [];
  while (position < bytes.length) {
    const remaining = 32768 - position % 32768;
    if (remaining < 7) { position += remaining; continue; }
    const length = bytes.readUInt16LE(position + 4), kind = bytes[position + 6];
    if (length === 0 && kind === 0) { position += remaining; continue; }
    assert.ok(length <= remaining - 7, 'bounded LevelDB record');
    const fragment = bytes.subarray(position + 7, position + 7 + length);
    position += 7 + length;
    if (kind === 1) records.push(fragment);
    else if (kind === 2) fragments = [fragment];
    else if (kind === 3) fragments.push(fragment);
    else if (kind === 4) { fragments.push(fragment); records.push(Buffer.concat(fragments)); fragments = []; }
    else assert.fail(`unexpected LevelDB record type ${kind}`);
  }
  assert.equal(fragments.length, 0, 'complete LevelDB writebatch');
  for (const batch of records) {
    let at = 12;
    const entries = batch.readUInt32LE(8);
    for (let i = 0; i < entries; i++) {
      const kind = batch[at++];
      const keyLength = readVarint(batch, at); at = keyLength.offset;
      const key = batch.subarray(at, at + keyLength.value); at += keyLength.value;
      if (kind === 0) continue;
      assert.equal(kind, 1, 'LevelDB put');
      const valueLength = readVarint(batch, at); at = valueLength.offset;
      const value = batch.subarray(at, at + valueLength.value); at += valueLength.value;
      if (key.toString('utf8').endsWith(`\0\x01${CONFIG.saveKey}`)) {
        assert.equal(value[0], 1, 'Chromium UTF-8 Local Storage value');
        return value.subarray(1).toString('utf8');
      }
    }
  }
  assert.fail('copied WAL contains no Aincrad save value');
}

function extractSourceArchive(archive, destination) {
  let at = 0;
  while (at + 512 <= archive.length) {
    const header = archive.subarray(at, at + 512);
    const name = header.subarray(0, 100).toString('utf8').split('\0')[0];
    if (!name) return;
    const size = Number.parseInt(header.subarray(124, 136).toString('ascii').split('\0')[0].trim(), 8) || 0;
    const path = resolve(destination, name);
    assert.ok(path.startsWith(`${destination}/`) || path.startsWith(`${destination}\\`), 'archive remains in scratch directory');
    if (name.endsWith('/')) mkdirSync(path, { recursive: true });
    else {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, archive.subarray(at + 512, at + 512 + size));
    }
    at += 512 + Math.ceil(size / 512) * 512;
  }
  assert.fail('truncated exact-base source archive');
}

test('explicit migration keeps body state, marks only physical history, and survives repeated write/load', () => {
  const { raw, actionId, ingestionId } = orphanFixture();
  const original = serialized(raw), disk = storage(original);
  assert.equal(loadSave(disk).blocked, true);
  assert.equal(disk.getItem(CONFIG.saveKey), original, 'ordinary load never changes original bytes');
  const result = prepareLegacyPendingMigration(original);
  assert.equal(result.ok, true, result.reason);
  assert.deepEqual(result.report.migrations.map(({ actorId, ingestionId: id, actionId: action }) => [actorId, id, action]),
    [['aster', ingestionId, actionId]]);
  const candidate = JSON.parse(result.candidate), before = structuredClone(raw.agents[0].physiology);
  before.stomach[0].provenance = marker;
  assert.deepEqual(candidate.agents[0].physiology, before, 'migration cannot change physical amounts or counters');
  assert.equal(candidate.features.legacyPendingPhysicalOnly, 1);
  assert.equal(prepareLegacyPendingMigration(result.candidate).ok, false,
    'an already marked world cannot receive a second migration');
  assert.deepEqual(candidate.agents[0].discovery.effects, raw.agents[0].discovery.effects);
  assert.deepEqual(candidate.agents[0].discovery.experiments, raw.agents[0].discovery.experiments);
  assert.equal(retainedProofIntegrityError(candidate.agents[0]), null);
  assert.equal(planProofRetention(candidate.agents[0]).ok, true);
  disk.setItem(CONFIG.saveKey, result.candidate);
  for (let i = 0; i < 2; i++) {
    const opened = loadSave(disk);
    assert.equal(opened.blocked, false);
    assert.deepEqual(opened.state.agents[0].physiology, before);
    assert.equal(writeSave(disk, opened.state), true);
    assert.equal(JSON.parse(disk.getItem(CONFIG.saveKey)).features.legacyPendingPhysicalOnly, 1);
  }
  assert.equal(loadSave(disk).state.agents[0].physiology.stomach[0].provenance, marker);
  assert.equal(disk.getItem(CONFIG.saveKey) === original, false, 'only the explicit caller commits candidate bytes');
});

test('marked digestion emits delayed feedback without invented learning or changed absorption', () => {
  const { raw } = orphanFixture(), result = prepareLegacyPendingMigration(serialized(raw));
  assert.equal(result.ok, true, result.reason);
  const disk = storage(result.candidate), actor = loadSave(disk).state.agents[0];
  const prior = structuredClone({ effects: actor.discovery.effects, experiments: actor.discovery.experiments,
    reports: actor.discovery.reports, techniques: actor.discovery.techniques, stats: actor.stats,
    totals: actor.physiology.totals });
  actor.elapsed += 90;
  tickPhysiology(actor, 90);
  const feedback = actor.physiology.feedback.find(row => row.provenance === marker);
  assert.ok(feedback, 'existing stomach contents still produce physical feedback');
  assert.ok(actor.physiology.totals.absorbedKcal > prior.totals.absorbedKcal);
  assert.ok(actor.physiology.totals.absorbedWaterMl > prior.totals.absorbedWaterMl);
  processDiscoveryFeedback(actor);
  assert.ok(actor.discovery.seenFeedback.includes(feedback.id));
  for (const key of ['effects', 'experiments', 'reports', 'techniques']) assert.deepEqual(actor.discovery[key], prior[key], key);
  assert.equal(actor.stats.independentMeals, prior.stats.independentMeals);
  assert.equal(retainedEffectProofError(actor), null);
  assert.equal(retainedProofIntegrityError(actor), null);
});

test('marked unseen feedback keeps its exact receipt after the stomach drains, then the flag stays sticky', () => {
  const prepared = prepareLegacyPendingMigration(serialized(orphanFixture().raw));
  assert.equal(prepared.ok, true, prepared.reason);
  const disk = storage(prepared.candidate), state = loadSave(disk).state, actor = state.agents[0];
  advanceFixtureTime(state, actor, 350);
  tickPhysiology(actor, 350);
  assert.equal(actor.physiology.stomach.length, 0, 'physical digestion completed');
  const unseen = actor.physiology.feedback.filter(row => row.provenance === marker &&
    !actor.discovery.seenFeedback.includes(row.id));
  assert.ok(unseen.length > 0);
  const receiptId = unseen[0].actionId;
  const plan = planProofRetention(actor);
  assert.equal(plan.ok, true, plan.reason);
  assert.ok(actor.memory.experience.some(row => row.id === receiptId));
  assert.equal(writeSave(disk, state), true);
  const reopened = loadSave(disk);
  assert.equal(reopened.blocked, false);
  assert.ok(reopened.state.agents[0].memory.experience.some(row => row.id === receiptId));
  processDiscoveryFeedback(reopened.state.agents[0]);
  assert.equal(reopened.state.agents[0].discovery.effects.length, 0);
  assert.equal(writeSave(disk, reopened.state), true);
  const finished = JSON.parse(disk.getItem(CONFIG.saveKey));
  assert.equal(finished.features.legacyPendingPhysicalOnly, 1, 'older builds remain locked out after marker drains');
  assert.equal(finished.agents[0].physiology.stomach.length, 0);
  assert.ok(finished.agents[0].physiology.feedback.every(row => row.provenance === marker));
  const seenActor = reopened.state.agents[0];
  for (let i = 0; i < 400; i++) seenActor.memory.experience.push({
    id: seenActor.memory.nextId++, at: seenActor.elapsed + i, type: 'decision',
    details: { summary: 'Later bounded history' },
  });
  const rollover = planProofRetention(seenActor);
  assert.equal(rollover.ok, true, rollover.reason);
  assert.equal(rollover.kept.experience.length, 400);
  assert.equal(rollover.kept.experience.some(row => row.id === receiptId), false,
    'seen feedback releases its former pending receipt to normal FIFO retirement');
  assert.equal(applyProofRetention(seenActor, rollover), true);
  assert.equal(writeSave(disk, reopened.state), true);
  assert.equal(loadSave(disk).blocked, false);
});

test('a forged persisted marker needs its sticky guard and its original exact sample receipt', () => {
  const prepared = prepareLegacyPendingMigration(serialized(orphanFixture().raw));
  assert.equal(prepared.ok, true, prepared.reason);
  const cases = [
    ['missing feature guard', s => { delete s.features.legacyPendingPhysicalOnly; }],
    ['zero action ID', s => { s.agents[0].physiology.stomach[0].actionId = 0; }],
    ['wrong action type', s => { s.agents[0].memory.experience[0].details.action.type = 'inspect_object'; }],
    ['wrong target', s => { s.agents[0].memory.experience[0].details.action.targetId = 'object:9'; }],
    ['wrong result', s => { s.agents[0].memory.experience[0].details.result.code = 'DONE'; }],
    ['present sample experiment', s => {
      const actor = s.agents[0], receipt = actor.memory.experience[0], row = actor.physiology.stomach[0];
      actor.discovery.experiments.push({ id: actor.discovery.nextId++, at: receipt.at, primitive: 'sample',
        targetId: row.objectId, ok: true, code: 'SWALLOWED', durationSeconds: 1,
        actionId: receipt.id, ingestionId: row.id });
    }],
  ];
  for (const [name, change] of cases) {
    const forged = JSON.parse(prepared.candidate);
    change(forged);
    const disk = storage(JSON.stringify(forged));
    assert.equal(loadSave(disk).blocked, true, name);
    assert.equal(writeSave(disk, forged), false, name);
    assert.equal(disk.getItem(CONFIG.saveKey), JSON.stringify(forged), `${name}: exact disk bytes preserved`);
    if (name !== 'missing feature guard') assert.equal(planProofRetention(forged.agents[0]).ok, false, name);
  }
});

test('marked feedback without a stomach still rejects conflicting seen feedback for that ingestion', () => {
  const prepared = prepareLegacyPendingMigration(serialized(orphanFixture().raw));
  assert.equal(prepared.ok, true, prepared.reason);
  const state = loadSave(storage(prepared.candidate)).state, actor = state.agents[0];
  advanceFixtureTime(state, actor, 350);
  tickPhysiology(actor, 350);
  assert.equal(actor.physiology.stomach.length, 0);
  const pending = actor.physiology.feedback.find(row => row.provenance === marker);
  assert.ok(pending);
  const forged = { ...pending, id: 'feedback:999999', objectId: 'object:999999', provenance: 'sampled' };
  actor.physiology.feedback.push(forged);
  actor.discovery.seenFeedback.push(forged.id);
  const bytes = serialized(state), disk = storage(bytes);
  assert.equal(loadSave(disk).blocked, true);
  assert.equal(writeSave(disk, state), false);
  assert.equal(disk.getItem(CONFIG.saveKey), bytes);
});

test('marked unseen feedback cannot claim one ingestion for two sample actions after stomach drains', () => {
  const prepared = prepareLegacyPendingMigration(serialized(orphanFixture().raw));
  assert.equal(prepared.ok, true, prepared.reason);
  const state = loadSave(storage(prepared.candidate)).state, actor = state.agents[0];
  advanceFixtureTime(state, actor, 350);
  tickPhysiology(actor, 350);
  assert.equal(actor.physiology.stomach.length, 0);
  const pending = actor.physiology.feedback.find(row => row.provenance === marker);
  assert.ok(pending);
  const actionId = actor.memory.nextId++, objectId = 'object:999998';
  actor.memory.experience.push({ id: actionId, at: 0, type: 'action',
    details: { action: { type: 'sample', targetId: objectId },
      result: { ok: true, code: 'SWALLOWED', ingestionId: pending.ingestionId } } });
  actor.physiology.feedback.push({ ...pending, id: 'feedback:999998', actionId, objectId });
  const bytes = serialized(state), disk = storage(bytes);
  assert.equal(loadSave(disk).blocked, true);
  assert.equal(writeSave(disk, state), false);
  assert.equal(disk.getItem(CONFIG.saveKey), bytes);
});

test('the exact-base older reader rejects the permanent migrated-world feature', async t => {
  const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const base = '8be0f5649dd32c9ab74d517572b319139bcf3074';
  try { execFileSync('git', ['cat-file', '-e', `${base}^{commit}`], { cwd: repository }); }
  catch { t.skip('exact base commit unavailable in this checkout'); return; }
  const scratch = mkdtempSync(resolve(tmpdir(), 'aincrad-old-reader-'));
  try {
    const archive = execFileSync('git', ['archive', '--format=tar', base, 'src'],
      { cwd: repository, maxBuffer: 32 * 1024 * 1024 });
    extractSourceArchive(archive, scratch);
    writeFileSync(resolve(scratch, 'package.json'), '{"type":"module"}');
    const old = await import(pathToFileURL(resolve(scratch, 'src/save.js')).href);
    const flagged = JSON.parse(serialized(freshState({connectedEcology:false})));
    flagged.features.legacyPendingPhysicalOnly = 1;
    const bytes = JSON.stringify(flagged), disk = storage(bytes);
    const refused = old.loadSave(disk);
    assert.equal(refused.blocked, true);
    assert.match(refused.error, /unsupported rules or a newer version/i);
    assert.equal(old.writeSave(disk, flagged), false);
    assert.equal(disk.getItem(CONFIG.saveKey), bytes);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

test('migration preflight rejects forged receipts, invalid physical rows and unsupported effects', () => {
  const fixture = orphanFixture();
  const cases = [
    ['missing receipt', s => { s.agents[0].memory.experience = []; }],
    ['wrong actor', s => { s.agents[1].memory.experience.push(s.agents[0].memory.experience.pop()); }],
    ['wrong action type', s => { s.agents[0].memory.experience[0].details.action.type = 'inspect_object'; }],
    ['wrong target', s => { s.agents[0].memory.experience[0].details.action.targetId = 'object:9'; }],
    ['unsuccessful action', s => { s.agents[0].memory.experience[0].details.result.ok = false; }],
    ['wrong result code', s => { s.agents[0].memory.experience[0].details.result.code = 'DONE'; }],
    ['wrong result ingestion', s => { s.agents[0].memory.experience[0].details.result.ingestionId = 'ingestion:999'; }],
    ['wrong receipt time', s => { s.agents[0].memory.experience[0].at += 1; }],
    ['duplicate receipt', s => { s.agents[0].memory.experience.push(structuredClone(s.agents[0].memory.experience[0])); }],
    ['zero action ID', s => { s.agents[0].physiology.stomach[0].actionId = 0; }],
    ['present invalid experiment', s => { s.agents[0].discovery.experiments.push({ id: 1, actionId: fixture.actionId,
      at: 0, primitive: 'sample', targetId: fixture.objectId, ok: false, code: 'SWALLOWED', ingestionId: fixture.ingestionId }); }],
    ['effect cites missing sample', s => { s.agents[0].discovery.effects.push({ id: 'feedback:999', at: 1,
      objectId: fixture.objectId, actionId: fixture.actionId, ingestionId: fixture.ingestionId,
      effect: 'sustained', source: 'experienced', proofEventId: 999 }); }],
    ['out of bounds body', s => { s.agents[0].physiology.stomach[0].remainingKcal = 1e9; }],
    ['invalid actor position', s => { s.agents[0].position = { x: 1e9, y: 1e9 }; }],
    ['invalid actor scene', s => { s.agents[0].scene = 'unknown-cave'; }],
    ['invalid player position', s => { s.player = { x: 1e9, y: 1e9 }; }],
    ['invalid world scene', s => { s.scene = 'unknown-cave'; }],
    ['invalid ecology stock', s => { s.environment.ecology.plants[0].quantity = -1; }],
    ['mismatched unseen feedback', s => { s.agents[0].physiology.feedback.push({ id: 'feedback:999',
      ingestionId: fixture.ingestionId, at: 1, objectId: 'object:999', actionId: fixture.actionId,
      provenance: 'sampled', effect: 'water relief', hunger: 'unchanged', thirst: 'easing',
      energy: 'unchanged', pain: 'none' }); }],
  ];
  for (const [name, change] of cases) {
    const raw = structuredClone(fixture.raw), text = serialized(raw), disk = storage(text);
    change(raw);
    const forged = serialized(raw);
    disk.setItem(CONFIG.saveKey, forged);
    assert.equal(prepareLegacyPendingMigration(forged).ok, false, name);
    assert.equal(loadSave(disk).blocked, true, name);
    assert.equal(disk.getItem(CONFIG.saveKey), forged, `${name}: raw bytes unchanged`);
  }
});

test('the copied 000045 world migrates only Mira’s pending portion and preserves every learned effect', {
  skip: !existsSync(resolve(snapshotDir, '000045.log')),
}, () => {
  const original = copiedSave('000045.log'), before = JSON.parse(original), disk = storage(original);
  assert.equal(loadSave(disk).blocked, true);
  const result = prepareLegacyPendingMigration(original);
  assert.equal(result.ok, true, result.reason);
  assert.deepEqual(result.report.migrations.map(({ actorId, ingestionId, actionId, objectId }) =>
    [actorId, ingestionId, actionId, objectId]), [['mira', 'ingestion:4690', 40916, 'object:2936']]);
  assert.deepEqual(result.report.restartEvents.map(({ actorId, code }) => [actorId, code]),
    [['aster', 'RESTART_INTERRUPTED'], ['mira', 'RESTART_INTERRUPTED']]);
  assert.deepEqual(result.report.retiredEvents.map(({ actorId, id }) => [actorId, id]),
    [['aster', 14903], ['mira', 40430]], 'only unreferenced history retires at the 400-row cap');
  const after = JSON.parse(result.candidate);
  assert.equal(after.features.legacyPendingPhysicalOnly, 1);
  for (const id of ['aster', 'mira']) {
    const oldActor = before.agents.find(actor => actor.id === id), newActor = after.agents.find(actor => actor.id === id);
    const oldBody = structuredClone(oldActor.physiology);
    if (id === 'mira') oldBody.stomach.find(row => row.id === 'ingestion:4690').provenance = marker;
    assert.deepEqual(newActor.physiology, oldBody, `${id} full physical body and totals`);
    assert.deepEqual(newActor.discovery.effects, oldActor.discovery.effects, `${id} full learned effects`);
    assert.equal(retainedEffectProofError(newActor), null);
    assert.equal(retainedProofIntegrityError(newActor), null);
    assert.equal(planProofRetention(newActor).ok, true, `${id} closure remains satisfiable`);
  }
  const marked = after.agents.find(actor => actor.id === 'mira').physiology.stomach.find(row => row.id === 'ingestion:4690');
  assert.equal(marked.remainingMassGrams, 1.9377777777783192);
  assert.equal(marked.remainingKcal, 1.0519365079371843);
  assert.equal(marked.remainingWaterMl, 1.5502222222223991);
  disk.setItem(CONFIG.saveKey, result.candidate);
  const reopened = loadSave(disk);
  assert.equal(reopened.blocked, false);
  assert.equal(writeSave(disk, reopened.state), true);
  const twice = loadSave(disk);
  assert.equal(twice.blocked, false);
  for (const id of ['aster', 'mira']) {
    const oldActor = before.agents.find(actor => actor.id === id), newActor = twice.state.agents.find(actor => actor.id === id);
    assert.deepEqual(newActor.discovery.effects, oldActor.discovery.effects, `${id} effects through write/load`);
    assert.equal(retainedEffectProofError(newActor), null);
  }
});

test('earlier copied worlds remain ordinary loads with unchanged learned effects', {
  skip: ['000038.log', '000040.log', '000042.log'].some(file => !existsSync(resolve(snapshotDir, file))),
}, () => {
  for (const file of ['000038.log', '000040.log', '000042.log']) {
    const original = copiedSave(file), raw = JSON.parse(original), loaded = loadSave(storage(original));
    assert.equal(loaded.blocked, false, file);
    for (const id of ['aster', 'mira'])
      assert.deepEqual(loaded.state.agents.find(actor => actor.id === id).discovery.effects,
        raw.agents.find(actor => actor.id === id).discovery.effects, `${file}: ${id}`);
  }
});
