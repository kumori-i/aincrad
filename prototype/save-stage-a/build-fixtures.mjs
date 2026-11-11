/** Stage A input preparation only. No simulation steps or performance measurements.
 * Stable production modules remain untouched. Run from this immutable source tree:
 *   node prototype/save-stage-a/build-fixtures.mjs
 * The retained native LevelDB log is read directly, never opened by Chromium.
 */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, resolve, relative, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CONFIG } from '../../src/config.js';
import { freshState, canStandOutside } from '../../src/world.js';
import { writeSave, loadSave, validateSave } from '../../src/save.js';
import { ecologyEnergy } from '../../src/ecology.js';
import { ECOLOGY_RULES, ECOLOGY_SPECIES, ECOLOGY_MATERIALS } from '../../src/ecology-config.js';
import { plantSuitability, regionalResourceAudit } from '../../src/ecology-regions.js';
import { lifecycleError, lifecycleStockAudit, freshMaterialLifecycle } from '../../src/plant-lifecycle-state.js';
import { PopulationRuntime } from '../../src/population.js';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const PLAN_SHA256 = '7fff23a90c08d88e55a87e108c90c13cc1bc6ae04f78e6701c853112af0cf265';
export const SOURCE_IDENTITY = Object.freeze({
  approvedMergedMain: '1f20f401f720b61069dcea06d10cc4e885e0b1f6',
  exactTree: '6154cd156ed0ef1dbf873fefb7ab1d7b9fa3b970',
  localCommit: '6730da16732b3dc93685b47e573a2b14320707d9',
  relation: 'Approved PLAN identifies merged main; local feature commit has the identical tracked tree. Commit hashes are deliberately not equated.',
});
export const DEFAULTS = Object.freeze({
  output: resolve(ROOT, 'test-results/stable-save-stage-a/inputs'),
  recorded: resolve(ROOT, '../aincrad-world/test-results/plant-baseline/juvenile-save.json'),
  baselineReport: resolve(ROOT, '../aincrad-world/test-results/plant-baseline/result.json'),
  nativeProfile: '/tmp/aincrad-plant-desktop-t9f0uF',
  nativeReport: resolve(ROOT, '../evidence/aincrad-world/release/reports/plant-desktop/result.json'),
  evidenceManifest: resolve(ROOT, '../evidence/aincrad-world/manifest.json'),
});
export const sha256 = value => createHash('sha256').update(value).digest('hex');
const plain = value => JSON.parse(JSON.stringify(value));
const descriptor = (path, content) => ({ path, sha256: sha256(content), bytes: Buffer.byteLength(content) });
const withoutSelection = value => { const copy = structuredClone(value); delete copy.selectedAgentId; return copy; };

export function differences(before, after, path = '', out = []) {
  if (Object.is(before, after)) return out;
  if (before && after && typeof before === 'object' && typeof after === 'object') {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) differences(before[key], after[key], `${path}/${key}`, out);
  } else out.push({ path, before: before === undefined ? { absent: true } : before, after: after === undefined ? { absent: true } : after });
  return out;
}

// LevelDB's portable log format uses masked Castagnoli CRC32C over type+payload.
export function crc32c(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0x82f63b78 : 0);
  }
  return (~crc) >>> 0;
}
const maskedCrc = bytes => { const crc = crc32c(bytes); return (((crc >>> 15) | (crc << 17)) + 0xa282ead8) >>> 0; };
export function readLeveldbLog(bytes) {
  assert.ok(Buffer.isBuffer(bytes));
  const records = [];
  let fragments = null;
  for (let offset = 0; offset < bytes.length;) {
    const blockEnd = Math.min(bytes.length, (Math.floor(offset / 32768) + 1) * 32768);
    if (blockEnd - offset < 7) { assert.ok(bytes.subarray(offset, blockEnd).every(v => v === 0), 'Nonzero LevelDB trailer'); offset = blockEnd; continue; }
    const checksum = bytes.readUInt32LE(offset), length = bytes.readUInt16LE(offset + 4), type = bytes[offset + 6];
    if (!checksum && !length && !type) { assert.ok(bytes.subarray(offset, blockEnd).every(v => v === 0)); offset = blockEnd; continue; }
    assert.ok([1, 2, 3, 4].includes(type), 'Unsupported LevelDB record type');
    assert.ok(offset + 7 + length <= blockEnd, 'Truncated LevelDB record');
    const payload = bytes.subarray(offset + 7, offset + 7 + length);
    assert.equal(maskedCrc(Buffer.concat([Buffer.from([type]), payload])), checksum, 'LevelDB CRC32C mismatch');
    if (type === 1) { assert.equal(fragments, null); records.push(Buffer.from(payload)); }
    else if (type === 2) { assert.equal(fragments, null); fragments = [payload]; }
    else { assert.ok(fragments, 'Missing first LevelDB fragment'); fragments.push(payload); if (type === 4) { records.push(Buffer.concat(fragments)); fragments = null; } }
    offset += 7 + length;
  }
  assert.equal(fragments, null, 'Incomplete LevelDB logical record');
  return records;
}
export function extractSavePuts(logBytes) {
  const saves = [];
  for (const record of readLeveldbLog(logBytes)) {
    assert.ok(record.length >= 12, 'Truncated LevelDB write batch');
    const sequence = record.readBigUInt64LE(0), count = record.readUInt32LE(8);
    let cursor = 12;
    const field = () => {
      let length = 0, shift = 0, terminal = false;
      for (let n = 0; n < 5; n++) {
        assert.ok(cursor < record.length, 'Truncated LevelDB varint');
        const byte = record[cursor++]; length += (byte & 127) * 2 ** shift;
        if (!(byte & 128)) { terminal = true; break; } shift += 7;
      }
      assert.ok(terminal && length <= record.length - cursor, 'Invalid LevelDB field length');
      const bytes = record.subarray(cursor, cursor + length); cursor += length; return bytes;
    };
    for (let index = 0; index < count; index++) {
      assert.ok(cursor < record.length);
      const type = record[cursor++]; assert.ok(type === 0 || type === 1, 'Unsupported LevelDB batch operation');
      const key = field(), value = type === 1 ? field() : null;
      const expectedKey = Buffer.concat([Buffer.from('_aincrad://app\0'), Buffer.from([1]), Buffer.from(CONFIG.saveKey)]);
      if (value && key.equals(expectedKey)) {
        assert.ok(value[0] === 0 || value[0] === 1, 'Unknown Chromium DOMString encoding');
        if (value[0] === 0) assert.equal((value.length - 1) % 2, 0);
        const text = value.subarray(1).toString(value[0] === 1 ? 'latin1' : 'utf16le');
        JSON.parse(text);
        saves.push({ sequence: String(sequence + BigInt(index)), batchSequence: String(sequence), batchIndex: index, keyHex: key.toString('hex'), encoding: value[0] === 1 ? 'latin1' : 'utf16le', text });
      }
    }
    assert.equal(cursor, record.length, 'Trailing bytes in LevelDB write batch');
  }
  return saves;
}

/** Capture exactly the stable writer's text; no substitute serializer. */
export function canonicalText(state) {
  const before = JSON.stringify(state);
  let text, writes = 0;
  assert.equal(writeSave({ setItem(key, value) { assert.equal(key, CONFIG.saveKey); writes++; text = value; } }, state), true, 'Stable writeSave rejected fixture');
  assert.equal(writes, 1);
  assert.equal(JSON.stringify(state), before, 'Stable writer mutated source');
  return text;
}
export function energyError(ecology) {
  const ledger = ecology.ledger;
  return ledger.initialKcal + ledger.photosynthesisKcal + ledger.externalKcal - ecologyEnergy(ecology) - ledger.humanRemovedKcal - ledger.metabolizedKcal - ledger.decomposedKcal - ledger.discardedKcal;
}
export function assertStrictState(state) {
  assert.equal(state.version, 8); assert.deepEqual(state.features, { plantLifecycle: 1 });
  assert.deepEqual(state.agents.map(actor => actor.id), ['aster', 'mira']);
  assert.equal(lifecycleError(state.environment.ecology), null);
  const validated = validateSave(state, { restoring: false });
  assert.notEqual(validated.saveBlocked, true);
  assert.deepEqual(validated.environment.ecology, state.environment.ecology, 'v8 canonical validator repaired physical fields');
  const ecology = state.environment.ecology, objects = [...ecology.plants, ...ecology.animals, ...ecology.materials];
  assert.equal(new Set(objects.map(object => object.id)).size, objects.length);
  assert.ok(objects.every(object => Number(object.id.slice(7)) < ecology.nextId));
  assert.ok(Math.abs(energyError(ecology)) < 1e-6);
  for (const error of Object.values(lifecycleStockAudit(ecology)).slice(1)) assert.ok(Math.abs(error) < 1e-6);
  const regional = regionalResourceAudit(ecology);
  for (const key of ['maxRegionalMassError', 'maxRegionalEnergyError', 'maxRegionalSoilError', 'soilBalanceError']) assert.ok(Math.abs(regional[key]) < 1e-6);
  return { counts: { plants: ecology.plants.length, animals: ecology.animals.length, materials: ecology.materials.length }, energyErrorKcal: energyError(ecology), lifecycle: lifecycleStockAudit(ecology), regional };
}

/** Deliberately artificial initial-stock construction, never an ecological run. */
export function constructPhysicalCap(recorded) {
  const state = structuredClone(recorded), e = state.environment.ecology, original = structuredClone(e);
  assert.equal(e.plants.some(p => p.lifecycleStage !== 'established'), false, 'Recorded source unexpectedly contains juvenile plants');
  const additions = { plants: [], animals: [], materials: [] };
  let gridCursor = 0;
  const occupied = new Set([...e.plants, ...e.animals, ...e.materials].map(o => `${o.position.x},${o.position.y}`));
  const point = (radius, kind) => {
    while (gridCursor < 280 ** 2) {
      const n = gridCursor++, candidate = { x: -19000 + (n % 280) * 137, y: -19000 + Math.floor(n / 280) * 137 };
      const key = `${candidate.x},${candidate.y}`;
      if (!occupied.has(key) && canStandOutside(candidate.x, candidate.y, radius) && (!kind || plantSuitability(kind, candidate))) { occupied.add(key); return candidate; }
    }
    throw new Error('Deterministic stress placement exhausted; no fallback relocation allowed');
  };
  const nextId = () => `object:${e.nextId++}`;
  const grass = original.plants.find(p => p.kind === 'grass'); assert.ok(grass);
  while (e.plants.length < ECOLOGY_RULES.maxPlants) {
    const copy = { ...structuredClone(grass), id: nextId(), position: point(10, 'grass') };
    e.plants.push(copy); additions.plants.push({ id: copy.id, copiedFrom: grass.id, overrides: { id: copy.id, position: copy.position } });
  }
  // Species caps govern ordinary births/initialization, not v8 storage validation.
  // 200 rabbits + 16 bobcats + 40 foxes deliberately fills the 256 storage cap.
  const targetSpeciesCounts = { rabbit: 200, bobcat: 16, fox: 40 };
  for (const [species, target] of Object.entries(targetSpeciesCounts)) {
    const template = original.animals.find(a => a.species === species); assert.ok(template);
    assert.ok(e.animals.filter(a => a.species === species).length <= target);
    while (e.animals.filter(a => a.species === species).length < target) {
      const position = point(ECOLOGY_SPECIES[species].radius);
      const overrides = { id: nextId(), position, homePosition: { ...position }, targetId: null, targetPosition: null, targetKind: null, actionHours: 0, activity: template.bodyMode === 'sleeping' ? 'sleeping' : template.bodyMode === 'resting' ? 'resting' : 'idle' };
      const copy = { ...structuredClone(template), ...overrides };
      e.animals.push(copy); additions.animals.push({ id: copy.id, species, copiedFrom: template.id, overrides });
    }
  }
  const producerKinds = { apple: 'apple_tree', berry: 'bramble', grass: 'grass' };
  const types = Object.keys(ECOLOGY_MATERIALS);
  while (e.materials.length < ECOLOGY_RULES.maxMaterials) {
    const index = additions.materials.length, materialType = types[index % types.length], spec = ECOLOGY_MATERIALS[materialType];
    const producers = materialType === 'flesh' ? original.animals : original.plants.filter(p => p.kind === producerKinds[materialType]);
    assert.ok(producers.length);
    const producer = producers[Math.floor(index / types.length) % producers.length];
    const copy = { id: nextId(), kind: 'material', materialType, scene: producer.scene, position: { ...producer.position }, heldBy: null, massGrams: spec.massGrams, energyKcal: spec.energyKcal, waterMl: spec.waterMl, createdAt: e.elapsed, ageHours: 0, spoiled: false, digestHours: spec.digestHours, toxicity: spec.toxicity || 0, ...freshMaterialLifecycle(false) };
    e.materials.push(copy); additions.materials.push({ producerId: producer.id, producerRadius: producer.species ? ECOLOGY_SPECIES[producer.species].radius : 10, constructed: copy });
  }
  // Retain all existing cumulative flows; add only new finite stock to initialKcal.
  const addedEnergyKcal = ecologyEnergy(e) - ecologyEnergy(original);
  e.ledger.initialKcal = original.ledger.initialKcal + addedEnergyKcal;
  assert.deepEqual(state.agents, recorded.agents, 'Stress construction changed recorded actors');
  assert.deepEqual(e.plants.slice(0, original.plants.length), original.plants);
  assert.deepEqual(e.animals.slice(0, original.animals.length), original.animals);
  assert.deepEqual(e.materials.slice(0, original.materials.length), original.materials);
  const audit = assertStrictState(state);
  assert.deepEqual(audit.counts, { plants: 768, animals: 256, materials: 256 });
  return { state, construction: {
    classification: 'Artificial finite initial-stock storage-cap fixture; not ecological succession, reachable population, or maximum actor-history size.',
    actors: 'Exactly the two recorded 900-second actors, with no knowledge/history/physiology edits.',
    simulationSteps: 0, deterministicPlacement: 'Row-major 280 by 280 candidate grid: x=-19000+137*(n%280), y=-19000+137*floor(n/280); unique new plant/animal coordinates; exact species radius and plant suitability checks.',
    originalObjectsPreserved: true, originalCounts: { plants: original.plants.length, animals: original.animals.length, materials: original.materials.length },
    targetSpeciesCounts, ordinarySpeciesCaps: Object.fromEntries(Object.entries(ECOLOGY_SPECIES).map(([name, spec]) => [name, spec.maxPopulation])),
    demographicCapExcess: { rabbit: 8, total: 8, reason: 'The preregistered global storage cap is 256 whereas ordinary species caps sum to 248. Eight artificial rabbits exceed the ordinary demographic cap; stable v8 validation accepts the explicitly constructed initial stock.' },
    plantConstruction: 'Append copies of one retained established grass stock. Only object ID and suitable position differ. No juvenile or lifecycle ledger is fabricated.',
    animalConstruction: 'Append retained species-body copies with new IDs and valid unique positions. Reset only the explicitly listed navigation/activity fields. Original animals remain byte-for-byte unchanged.',
    materialConstruction: 'Append fixed finite full-unit apple/berry/grass/flesh stock from ECOLOGY_MATERIALS at exact retained producer coordinates. New materials are ground/unheld, unspoiled, age zero, created at ecology time, and have no seed opportunity. No detach/consume action or experiential evidence is fabricated.',
    energyRebase: { formula: 'new initialKcal = old initialKcal + ecologyEnergy(after additions) - ecologyEnergy(before additions); all historical flow ledgers retained', beforeInitialKcal: original.ledger.initialKcal, addedEnergyKcal, afterInitialKcal: e.ledger.initialKcal, beforeEnergyErrorKcal: energyError(original), afterEnergyErrorKcal: energyError(e) },
    unchanged: ['all actors', 'all clocks', 'RNG and seed', 'Cardinal', 'existing objects and ownership', 'regional soil/litter', 'lifecycle accounting', 'birth/death counters', 'all other global flow counters'],
    nextId: { before: original.nextId, after: e.nextId }, additions,
  }, audit };
}

export function freezePair(source) {
  const sourcePlain = plain(source); delete sourcePlain.npc;
  const pair = {};
  for (const [arm, selectedAgentId] of [['A', 'aster'], ['B', 'mira']]) {
    const input = structuredClone(source); input.selectedAgentId = selectedAgentId;
    const text = canonicalText(input), state = JSON.parse(text);
    assertStrictState(state);
    assert.equal(canonicalText(state), text, 'Frozen canonical text is not an idempotent stable writer input');
    const loaded = loadSave({ getItem(key) { assert.equal(key, CONFIG.saveKey); return text; } });
    assert.equal(loaded.exists, true); assert.equal(loaded.blocked, false); assert.equal(loaded.error, null);
    assert.deepEqual(loaded.state, validateSave(state), 'Actual loadSave differs from stable canonical restart');
    assert.deepEqual(loaded.state.environment.ecology, state.environment.ecology, 'Restart changed physical ecology');
    const restoredRewrite = canonicalText(loaded.state);
    pair[arm] = { text, state, sha256: sha256(text), bytes: Buffer.byteLength(text), restoredStateSha256: sha256(JSON.stringify(loaded.state)), restoredRewriteSha256: sha256(restoredRewrite), restoredRewriteBytes: Buffer.byteLength(restoredRewrite) };
  }
  assert.deepEqual(withoutSelection(pair.A.state), withoutSelection(pair.B.state));
  assert.notEqual(pair.A.sha256, pair.B.sha256);
  const normalizedSource = { ...sourcePlain, selectedAgentId: 'aster' };
  return { pair, canonicalization: differences(normalizedSource, pair.A.state) };
}

async function preservedSource(output, name, sourcePath, bytes) {
  const destination = join('sources', name); await mkdir(join(output, 'sources'), { recursive: true });
  await writeFile(join(output, destination), bytes);
  return { originalPath: sourcePath, ...descriptor(destination, bytes) };
}
export async function buildFixtures(options = {}) {
  const settings = { ...DEFAULTS, ...options }, output = resolve(settings.output);
  const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
  assert.equal(git('rev-parse', `${SOURCE_IDENTITY.localCommit}^{tree}`), SOURCE_IDENTITY.exactTree);
  // Prototype-only commits may advance HEAD; the original tracked source must
  // still match the approved exact tree, including any working-tree changes.
  assert.equal(git('diff', SOURCE_IDENTITY.localCommit, '--name-only', '--', '.', ':!prototype'), '', 'Stable baseline source changed');
  const plan = await readFile(join(ROOT, 'prototype/save-stage-a/PLAN.md'));
  assert.equal(sha256(plan), PLAN_SHA256);
  const recordedBytes = await readFile(settings.recorded), baselineReportBytes = await readFile(settings.baselineReport), nativeReportBytes = await readFile(settings.nativeReport), evidenceManifestBytes = await readFile(settings.evidenceManifest);
  const baselineReport = JSON.parse(baselineReportBytes), nativeReport = JSON.parse(nativeReportBytes), evidenceManifest = JSON.parse(evidenceManifestBytes);
  const measuredRecorded = baselineReport.measurements.find(item => item.name === 'juvenile');
  assert.equal(sha256(recordedBytes), measuredRecorded.saveSha256);
  assert.equal(recordedBytes.length, measuredRecorded.saveBytes);
  assert.equal(baselineReport.nativeInputSeconds, 900);
  assert.equal(nativeReport.passed, true); assert.equal(nativeReport.wholeCheckpointEqual, true);
  assert.equal(sha256(nativeReportBytes), evidenceManifest['release/reports/plant-desktop/result.json'].sha256);
  const expectedPath = join(settings.nativeProfile, 'expected.json'), runnerPath = join(settings.nativeProfile, 'runner.cjs'), logPath = join(settings.nativeProfile, 'profile/Local Storage/leveldb/000003.log');
  let expectedBytes, runnerBytes, logBytes;
  try { [expectedBytes, runnerBytes, logBytes] = await Promise.all([readFile(expectedPath), readFile(runnerPath), readFile(logPath)]); }
  catch (error) { throw new Error(`Retained actual native juvenile source is missing. Stop and ask for its profile/expected artifact; never regenerate or fabricate it. ${error.message}`); }
  const expected = JSON.parse(expectedBytes), savePuts = extractSavePuts(logBytes);
  const matching = savePuts.filter(record => {
    const loaded = loadSave({ getItem: () => record.text });
    if (loaded.blocked) return false;
    // Reproduce only the original retained checkpoint's initialization. No tick.
    const runtime = new PopulationRuntime(loaded.state), checkpoint = plain(loaded.state); runtime.dispose();
    return JSON.stringify(checkpoint) === JSON.stringify(expected.expected);
  });
  assert.equal(matching.length, 1, 'Need exactly one native saved record matching the retained exact reopen checkpoint');
  const nativeRecord = matching[0], native = JSON.parse(nativeRecord.text);
  assert.deepEqual(expected.fixture, nativeReport.fixture); assert.equal(expected.growthSteps, nativeReport.growthSteps);
  const e = native.environment.ecology;
  assert.equal(e.plants.find(p => p.id === expected.grownId).structureMassGrams, nativeReport.grownMassGrams);
  assert.equal(e.plants.find(p => p.id === expected.seedlingId).structureMassGrams, nativeReport.seedlingMassGrams);
  assert.ok(e.materials.find(m => m.id === expected.materialId).massGrams > 0);
  assert.ok(e.materials.find(m => m.id === expected.deferredId).nextGerminationAt > e.elapsed);
  await mkdir(output, { recursive: true });
  const sources = {};
  for (const [key, name, path, bytes] of [
    ['recorded900s', 'recorded-900s-original.json', settings.recorded, recordedBytes],
    ['baselineReport', 'recorded-900s-original-report.json', settings.baselineReport, baselineReportBytes],
    ['nativeSaved', 'native-juvenile-original.json', `${logPath}#sequence=${nativeRecord.sequence}`, nativeRecord.text],
    ['nativeLog', 'native-profile-000003.log', logPath, logBytes],
    ['nativeExpected', 'native-expected.json', expectedPath, expectedBytes],
    ['nativeRunner', 'native-runner.cjs', runnerPath, runnerBytes],
    ['nativeReport', 'native-original-report.json', settings.nativeReport, nativeReportBytes],
    ['evidenceManifest', 'original-evidence-manifest.json', settings.evidenceManifest, evidenceManifestBytes],
  ]) sources[key] = await preservedSource(output, name, path, bytes);
  const recorded = JSON.parse(recordedBytes), stress = constructPhysicalCap(recorded);
  const entries = [
    { id: 'fresh-v8', state: freshState(), source: { kind: 'freshState()', seed: CONFIG.seed }, interventions: ['Canonical stable fresh v8 construction; zero simulation steps.'] },
    { id: 'recorded-900s', state: recorded, source: sources.recorded900s, interventions: ['Retained whole-population 900-second source. No simulation rerun, object edit, or history augmentation.'] },
    { id: 'native-juvenile', state: native, source: sources.nativeSaved, interventions: ['Read-only extraction of actual native saved text; no physical fixture rerun.'], originalNativeFixture: { ...expected.fixture, growthSteps: expected.growthSteps, sourceFingerprint: nativeReport.sourceFingerprint, explicitSteps: ['Original fixture retained one established apple tree and removed all animals; rebased initial energy after reduction.', 'Original fixture fixed noon/clear weather and made three four-day ecology/environment age-clock jumps.', 'Original fixture used accepted finite detachment, 30 g ingestion, release, seed transfer, and 28,394 half-second growth steps with actor bodies not advanced.', 'Original fixture placed the deferred apple at an unsuitable dry location.', 'Original fixture aligned world/actor clocks, positioned both actors and spectator, and began Mira sleep for five hours before the actual save.'] }, nativeExtraction: { retainedProfile: settings.nativeProfile, sequence: nativeRecord.sequence, batchSequence: nativeRecord.batchSequence, batchIndex: nativeRecord.batchIndex, encoding: nativeRecord.encoding, keyHex: nativeRecord.keyHex, checksumVerified: true, matchingSavedRecords: matching.length, totalSavePuts: savePuts.length, matchedExpectedCheckpointExactlyAfterBaselineInitialization: true, ignoredLaterSaves: savePuts.filter(record => record !== nativeRecord).map(({ text, ...record }) => ({ ...record, ...descriptor('retained native log record', text) })) } },
    { id: 'physical-cap', state: stress.state, source: sources.recorded900s, interventions: ['Declared artificial finite initial-stock construction below; no ordinary ecological outcome claim.'], construction: stress.construction },
  ];
  const fixtures = [];
  for (const entry of entries) {
    const { state, ...metadata } = entry, frozen = freezePair(state), pairs = {};
    for (const arm of ['A', 'B']) {
      const { text, state: ignoredState, ...checks } = frozen.pair[arm], path = `${entry.id}-${arm}.json`;
      await writeFile(join(output, path), text); pairs[arm] = { path, ...checks };
    }
    fixtures.push({ ...metadata, pairs, canonicalization: frozen.canonicalization, selectedAgentOnlyDifference: true, independentOppositeHashes: true, audit: assertStrictState(frozen.pair.A.state), actorHistorySha256: sha256(JSON.stringify(frozen.pair.A.state.agents)) });
  }
  assert.deepEqual(fixtures.find(f => f.id === 'recorded-900s').canonicalization, [{ path: '/agents/0/interrupted', before: true, after: { absent: true } }]);
  assert.deepEqual(fixtures.find(f => f.id === 'native-juvenile').canonicalization, []);
  assert.equal(fixtures.find(f => f.id === 'physical-cap').actorHistorySha256, fixtures.find(f => f.id === 'recorded-900s').actorHistorySha256);
  const manifest = {
    formatVersion: 1, stage: 'A frozen inputs only', measurementsRun: false, simulationStepsRun: 0,
    plan: { path: 'prototype/save-stage-a/PLAN.md', sha256: PLAN_SHA256 }, sourceIdentity: SOURCE_IDENTITY,
    stableSourceFiles: Object.fromEntries(await Promise.all(['src/save.js', 'src/ecology.js', 'src/plant-lifecycle-state.js', 'src/ecology-config.js', 'src/ecology-regions.js', 'src/world.js'].map(async path => [path, descriptor(path, await readFile(join(ROOT, path)))]))),
    builder: descriptor('prototype/save-stage-a/build-fixtures.mjs', await readFile(fileURLToPath(import.meta.url))),
    canonicalizationPolicy: 'Each frozen A/B text was captured from stable writeSave before any measurement. Exact source differences are listed; the pair differs only in selectedAgentId. Actual loadSave, stable restart, physical preservation, rewrite compatibility, and writer idempotence are asserted. No pre-measurement hidden state edits or learner/history augmentation.',
    sources, fixtures,
    measurementPreconditions: { preseed: 'B once per arm/session', settlingMs: 500, alternatingSequence: 'A/B continuously across 1 cold + 4 warmups + 20 measured saves', perSamplePreseed: false, requiredBeforeMeasuredCommit: 'Retain prior-text and requested-text SHA256 outside timed windows; assert they differ.', sessionsPerFixture: 2, secondSessionReversesArmOrder: true },
    limitations: ['No performance measurement or native physical rerun was executed by this builder.', 'Artificial global-cap stock exceeds ordinary summed species demographic limits by eight explicitly declared rabbits.', 'The exact merged-main mapping is anchored to approved PLAN; local Git verifies the original local commit/tree and no stable tracked changes outside prototype, not a locally absent merge commit object.', 'Stable load/rewrite may normalize active commands and transient flags; this is baseline restart behavior, not uninterrupted-command resumption.'],
  };
  const manifestText = JSON.stringify(manifest, null, 2) + '\n'; await writeFile(join(output, 'manifest.json'), manifestText);
  return { output, manifest, manifestSha256: sha256(manifestText) };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const result = await buildFixtures({ output: process.argv[2] ? resolve(process.argv[2]) : DEFAULTS.output });
  console.log(JSON.stringify({ output: relative(ROOT, result.output), manifestSha256: result.manifestSha256, measurementsRun: false, fixtures: result.manifest.fixtures.map(({ id, pairs, audit }) => ({ id, pairs, counts: audit.counts })) }, null, 2));
}
