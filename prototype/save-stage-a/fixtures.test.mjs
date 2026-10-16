/** Correctness tests only; this file contains no performance measurements. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CONFIG } from '../../src/config.js';
import { loadSave, writeSave } from '../../src/save.js';
import { canStandOutside } from '../../src/world.js';
import { ECOLOGY_SPECIES } from '../../src/ecology-config.js';
import { plantSuitability } from '../../src/ecology-regions.js';
import { lifecycleError } from '../../src/plant-lifecycle-state.js';
import { PopulationRuntime } from '../../src/population.js';
import { DEFAULTS, PLAN_SHA256, SOURCE_IDENTITY, ROOT, sha256, crc32c, extractSavePuts, canonicalText, constructPhysicalCap, freezePair, assertStrictState, buildFixtures, differences } from './build-fixtures.mjs';

const read = path => readFile(join(DEFAULTS.output, path));
const manifest = JSON.parse(await read('manifest.json'));
const fixture = id => manifest.fixtures.find(item => item.id === id);
const json = async path => JSON.parse(await read(path));
const original = await json(manifest.sources.recorded900s.path);
const pairs = Object.fromEntries(await Promise.all(manifest.fixtures.map(async entry => [entry.id, { A: await read(entry.pairs.A.path), B: await read(entry.pairs.B.path) }])));

test('input manifest pins the approved plan and exact stable tree without conflating commits', async () => {
  assert.equal(sha256(await readFile(join(ROOT, manifest.plan.path))), PLAN_SHA256);
  assert.deepEqual(manifest.sourceIdentity, SOURCE_IDENTITY);
  assert.notEqual(SOURCE_IDENTITY.approvedMergedMain, SOURCE_IDENTITY.localCommit);
  assert.equal(manifest.measurementsRun, false); assert.equal(manifest.simulationStepsRun, 0);
  assert.equal(manifest.fixtures.length, 4);
  for (const source of Object.values(manifest.stableSourceFiles)) {
    const bytes = await readFile(join(ROOT, source.path));
    assert.equal(sha256(bytes), source.sha256); assert.equal(bytes.length, source.bytes);
  }
});

test('all retained source files and both frozen members have independent exact byte hashes', async () => {
  for (const source of Object.values(manifest.sources)) {
    const bytes = await read(source.path);
    assert.equal(sha256(bytes), source.sha256); assert.equal(bytes.length, source.bytes);
  }
  for (const entry of manifest.fixtures) {
    for (const arm of ['A', 'B']) {
      assert.equal(sha256(pairs[entry.id][arm]), entry.pairs[arm].sha256);
      assert.equal(pairs[entry.id][arm].length, entry.pairs[arm].bytes);
    }
    assert.notEqual(entry.pairs.A.sha256, entry.pairs.B.sha256);
  }
});

test('each A/B pair differs only in selectedAgentId and preserves exactly two actors', () => {
  for (const entry of manifest.fixtures) {
    const a = JSON.parse(pairs[entry.id].A), b = JSON.parse(pairs[entry.id].B);
    assert.deepEqual(differences(a, b), [{ path: '/selectedAgentId', before: 'aster', after: 'mira' }]);
    assert.deepEqual(a.agents.map(actor => actor.id), ['aster', 'mira']);
    assert.deepEqual(b.agents.map(actor => actor.id), ['aster', 'mira']);
    assert.equal(Object.hasOwn(a, 'npc'), false);
    assertStrictState(a); assertStrictState(b);
  }
});

test('actual stable write and load are compatible with every frozen canonical byte string', () => {
  for (const entry of manifest.fixtures) for (const arm of ['A', 'B']) {
    const text = pairs[entry.id][arm].toString('utf8'), raw = JSON.parse(text);
    assert.equal(canonicalText(raw), text);
    const loaded = loadSave({ getItem: key => { assert.equal(key, CONFIG.saveKey); return text; } });
    assert.equal(loaded.blocked, false); assert.equal(loaded.exists, true); assert.equal(loaded.error, null);
    assert.equal(sha256(JSON.stringify(loaded.state)), entry.pairs[arm].restoredStateSha256);
    assert.equal(sha256(canonicalText(loaded.state)), entry.pairs[arm].restoredRewriteSha256);
    assert.deepEqual(loaded.state.environment.ecology, raw.environment.ecology);
  }
});

test('source canonicalization is explicitly disclosed and does not alter recorded physical stocks', () => {
  const record = JSON.parse(pairs['recorded-900s'].A), native = fixture('native-juvenile');
  assert.deepEqual(record.environment.ecology, original.environment.ecology);
  assert.deepEqual(fixture('recorded-900s').canonicalization, [{ path: '/agents/0/interrupted', before: true, after: { absent: true } }]);
  assert.deepEqual(native.canonicalization, []);
  assert.deepEqual(fixture('physical-cap').canonicalization, fixture('recorded-900s').canonicalization);
  assert.deepEqual(record.agents, JSON.parse(pairs['physical-cap'].A).agents);
});

test('retained native LevelDB save matches the actual original reopen checkpoint with no simulation tick', async () => {
  const log = await read(manifest.sources.nativeLog.path), expected = await json(manifest.sources.nativeExpected.path);
  const records = extractSavePuts(log), native = fixture('native-juvenile');
  const record = records.find(row => row.sequence === native.nativeExtraction.sequence);
  assert.ok(record); assert.equal(records.length, native.nativeExtraction.totalSavePuts);
  assert.equal(sha256(record.text), manifest.sources.nativeSaved.sha256);
  const loaded = loadSave({ getItem: () => record.text }), runtime = new PopulationRuntime(loaded.state);
  const checkpoint = JSON.parse(JSON.stringify(loaded.state)); runtime.dispose();
  assert.deepEqual(checkpoint, expected.expected);
  const ecology = checkpoint.environment.ecology;
  assert.equal(ecology.plants.find(plant => plant.id === expected.grownId).stage, 'juvenile');
  assert.equal(ecology.plants.find(plant => plant.id === expected.seedlingId).stage, 'seedling');
  assert.ok(ecology.materials.find(material => material.id === expected.materialId).massGrams > 0);
  assert.ok(ecology.materials.find(material => material.id === expected.deferredId).nextGerminationAt > ecology.elapsed);
  assert.equal(native.nativeExtraction.sequence, '2');
  assert.equal(native.nativeExtraction.ignoredLaterSaves[0].sequence, '5');
});

test('LevelDB extraction validates CRCs and rejects corruption, incomplete logs, and unknown types', async () => {
  assert.equal(crc32c(Buffer.from('123456789')), 0xe3069283);
  const log = await read(manifest.sources.nativeLog.path);
  const corrupt = Buffer.from(log); corrupt[40] ^= 1;
  assert.throws(() => extractSavePuts(corrupt), /CRC32C/);
  assert.throws(() => extractSavePuts(log.subarray(0, log.length - 1)), /Truncated|Incomplete/);
  const unknownType = Buffer.from(log); unknownType[6] = 99;
  assert.throws(() => extractSavePuts(unknownType), /Unsupported LevelDB record type/);
});

test('artificial cap construction is deterministic, exact, and leaves input and actors untouched', () => {
  const before = JSON.stringify(original), first = constructPhysicalCap(original), second = constructPhysicalCap(original);
  assert.equal(JSON.stringify(original), before);
  assert.deepEqual(first, second);
  assert.deepEqual(first.state.agents, original.agents);
  assert.deepEqual(first.audit.counts, { plants: 768, animals: 256, materials: 256 });
  assert.equal(first.construction.demographicCapExcess.total, 8);
  assert.deepEqual(first.construction.targetSpeciesCounts, { rabbit: 200, bobcat: 16, fox: 40 });
  assert.equal(canonicalText({ ...first.state, selectedAgentId: 'aster' }), pairs['physical-cap'].A.toString('utf8'));
  assert.deepEqual(first.construction, fixture('physical-cap').construction);
});

test('every new stock has a unique ID, declared valid producer location, and preserved original ledgers', () => {
  const stress = JSON.parse(pairs['physical-cap'].A), ecology = stress.environment.ecology;
  const construction = fixture('physical-cap').construction;
  const objects = [...ecology.plants, ...ecology.animals, ...ecology.materials];
  assert.equal(new Set(objects.map(object => object.id)).size, objects.length);
  for (const added of construction.additions.plants) {
    const plant = ecology.plants.find(object => object.id === added.id);
    assert.ok(canStandOutside(plant.position.x, plant.position.y, 10));
    assert.ok(plantSuitability(plant.kind, plant.position));
  }
  for (const added of construction.additions.animals) {
    const animal = ecology.animals.find(object => object.id === added.id);
    assert.ok(canStandOutside(animal.position.x, animal.position.y, ECOLOGY_SPECIES[animal.species].radius));
  }
  for (const { producerId, producerRadius, constructed } of construction.additions.materials) {
    const producer = objects.find(object => object.id === producerId);
    assert.deepEqual(constructed.position, producer.position);
    assert.ok(canStandOutside(constructed.position.x, constructed.position.y, producerRadius));
    assert.equal(constructed.seedOpportunity, false); assert.equal(constructed.heldBy, null);
  }
  assert.deepEqual(ecology.regions, original.environment.ecology.regions);
  assert.deepEqual(ecology.detritus, original.environment.ecology.detritus);
  assert.deepEqual(ecology.lifecycle, original.environment.ecology.lifecycle);
  assert.deepEqual(differences(original.environment.ecology.ledger, ecology.ledger).map(row => row.path), ['/initialKcal']);
});

test('strict v8 rejects duplicate IDs, invalid producer coordinates, and over-cap physical data without writes', () => {
  for (const mutate of [
    state => { state.environment.ecology.plants[1].id = state.environment.ecology.plants[0].id; },
    state => { state.environment.ecology.materials[0].position = { x: CONFIG.halfSize * 2, y: 0 }; },
    state => { state.environment.ecology.plants.push(structuredClone(state.environment.ecology.plants[0])); },
  ]) {
    const state = JSON.parse(pairs['physical-cap'].A); mutate(state);
    assert.ok(lifecycleError(state.environment.ecology));
    let writes = 0;
    assert.equal(writeSave({ setItem() { writes++; } }, state), false); assert.equal(writes, 0);
    assert.equal(loadSave({ getItem: () => JSON.stringify(state) }).blocked, true);
  }
});

test('continuous alternation avoids identical-value writes across cold, warmup, and measured phases', () => {
  assert.equal(manifest.measurementPreconditions.perSamplePreseed, false);
  assert.equal(manifest.measurementPreconditions.settlingMs, 500);
  for (const entry of manifest.fixtures) {
    let prior = entry.pairs.B.sha256;
    for (let i = 0; i < 25; i++) {
      const requested = entry.pairs[i % 2 === 0 ? 'A' : 'B'].sha256;
      assert.notEqual(prior, requested); prior = requested;
    }
  }
});

test('deterministic rebuild reproduces every frozen byte and manifest with no source or performance run', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'aincrad-stage-a-fixture-test-'));
  try {
    const result = await buildFixtures({ output: temporary });
    assert.deepEqual(result.manifest, manifest);
    for (const entry of manifest.fixtures) for (const arm of ['A', 'B']) assert.deepEqual(await readFile(join(temporary, entry.pairs[arm].path)), pairs[entry.id][arm]);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('missing actual native source fails closed instead of synthesizing a replacement', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'aincrad-stage-a-missing-test-'));
  try {
    await assert.rejects(buildFixtures({ output: temporary, nativeProfile: join(temporary, 'absent') }), /Stop and ask.*never regenerate or fabricate/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
