import test from 'node:test';
import assert from 'node:assert/strict';
import { createOzarkWorldGeometry, OZARK_WORLD_PROFILE } from '../src/ozark-world-geometry.js';
import { createOzarkEcology, tickOzarkEcology } from '../src/ozark-ecology.js';
import { OZARK_SAVE_KEY, OZARK_SAVE_VERSION, createOzarkState, loadOzarkSave, writeOzarkSave } from '../src/ozark-save.js';
import { bindOzarkWorldAgent, ozarkFiniteAquaticAgent } from '../src/ozark-agent-world.js';
import { measureCardinalWorld } from '../src/cardinal-metrics.js';
import { ecologyEnergy, renderEcology, describeEcologyObject, consumeEcologyMaterial, interactEcologyObject } from '../src/ecology.js';
import { aquaticEnergy } from '../src/aquatic-state.js';
import { captureAquaticFish, pullAquaticTissue } from '../src/aquatic-ecology.js';
import { rememberDirectDiscoveryObject } from '../src/discovery.js';
import { ECOLOGY_MATERIALS } from '../src/ecology-config.js';
import { drawEcologyObject } from '../src/art.js';
import { heldAquaticSprites } from '../src/ozark-world-renderer.js';

const geometry = createOzarkWorldGeometry();
const storage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value) };
};
function canonicalFresh() {
  const disk = storage(), state = createOzarkState(geometry);
  assert.equal(writeOzarkSave(disk, state, geometry), true);
  return { disk, state, raw: JSON.parse(disk.getItem(OZARK_SAVE_KEY)) };
}
function protectedBytes(raw) {
  const disk = storage(), bytes = JSON.stringify(raw);
  disk.setItem(OZARK_SAVE_KEY, bytes);
  const reopened = loadOzarkSave(disk, geometry);
  assert.equal(reopened.blocked, true, 'malformed payload must block');
  assert.equal(reopened.state, null);
  assert.equal(disk.getItem(OZARK_SAVE_KEY), bytes, 'invalid original bytes must remain intact');
}

test('fresh current exact aquatic envelope and stock survive schema roundtrip without refilling', () => {
  const { disk, state, raw } = canonicalFresh();
  assert.equal(OZARK_SAVE_VERSION, 11);
  assert.equal(raw.version, 11);
  assert.deepEqual(raw.features, { plantLifecycle: 1, finiteAquatic: 1, worldStructures: 1 });
  assert.equal(raw.environment.ecology.aquatic.version, 1);
  assert.ok(raw.environment.ecology.aquatic.fish.length > 0);
  const reopened = loadOzarkSave(disk, geometry);
  assert.equal(reopened.blocked, false, reopened.error);
  assert.deepEqual(reopened.state.environment.ecology, state.environment.ecology);
  assert.equal(writeOzarkSave(disk, reopened.state, geometry), true);
  assert.deepEqual(JSON.parse(disk.getItem(OZARK_SAVE_KEY)), raw);
  // This is schema/codec coverage only, not Electron disk-close/reopen proof.
});

test('retired schema in the current slot is protected, while old keys are never read or changed',()=>{
 const {raw}=canonicalFresh();
 for(const version of [9,10]) {const old=structuredClone(raw);old.version=version;protectedBytes(old);}
 const disk=storage();disk.setItem('aincrad.ozark.v1','retired bytes');disk.setItem('aincrad.save.v1','original bytes');
 const current=loadOzarkSave(disk,geometry);assert.equal(current.exists,false);assert.equal(current.blocked,false);
 assert.equal(writeOzarkSave(disk,current.state,geometry),true);
 assert.equal(disk.getItem('aincrad.ozark.v1'),'retired bytes');assert.equal(disk.getItem('aincrad.save.v1'),'original bytes');
});

test('version, feature, payload, physical location, and cross-array identity mismatches protect bytes', () => {
  const { raw } = canonicalFresh();
  for (const change of [
    value => { value.version = 12; },
    value => { value.version = 9; },
    value => { value.features = { plantLifecycle: 1 }; },
    value => { value.features.finiteAquatic = 2; },
    value => { value.features.unrecognized = 1; },
    value => { delete value.environment.ecology.aquatic; },
    value => { value.environment.ecology.aquatic.fish[0].position = { ...geometry.spawn }; },
    value => { value.environment.ecology.aquatic.fish[0].id = value.environment.ecology.plants[0].id; },
    value => { value.environment.ecology.aquatic.ledger.initialKcal++; },
  ]) {
    const bad = structuredClone(raw); change(bad); protectedBytes(bad);
  }
  for (const change of [
    value => { value.environment.ecology.aquatic = structuredClone(raw.environment.ecology.aquatic); },
    value => { value.environment.ecology.fish = []; },
    value => { value.environment.ecology.materials.push({ materialType: 'fish_tissue' }); },
    value => { value.agents[0].active = { request: { type: 'catch' } }; },
    value => { value.agents[0].discovery.practice.catch = { successes: 0, failures: 0, seconds: 0 }; },
  ]) {
    const old = structuredClone(raw); old.version = 9; old.features = { plantLifecycle: 1 }; change(old); protectedBytes(old);
  }
});

test('compare-and-swap still refuses replacement by a stale aquatic state', () => {
  const { disk, state } = canonicalFresh();
  const newer = disk.getItem(OZARK_SAVE_KEY) + ' ';
  disk.setItem(OZARK_SAVE_KEY, newer);
  assert.equal(writeOzarkSave(disk, state, geometry), false);
  assert.equal(disk.getItem(OZARK_SAVE_KEY), newer);
});

test('interrupted catch restores as one cancellation, never a completed or replayable capture', () => {
  const { disk, state } = canonicalFresh();
  const before = structuredClone(state.environment.ecology.aquatic);
  state.agents[0].active = { kind: 'interaction', request: {
    type: 'catch', targetId: before.fish[0].id }, seconds: 4, worked: 2 };
  assert.equal(writeOzarkSave(disk, state, geometry), true);
  const opened = loadOzarkSave(disk, geometry);
  assert.equal(opened.blocked, false, opened.error);
  assert.equal(opened.state.agents[0].active, null);
  assert.deepEqual(opened.state.environment.ecology.aquatic, before);
  const cancellations = actor => actor.memory.experience.filter(event =>
    event.details?.result?.code === 'RESTART_INTERRUPTED');
  assert.equal(cancellations(opened.state.agents[0]).length, 1);
  assert.equal(writeOzarkSave(disk, opened.state, geometry), true);
  const again = loadOzarkSave(disk, geometry);
  assert.equal(again.blocked, false, again.error);
  assert.equal(cancellations(again.state.agents[0]).length, 1);
  assert.deepEqual(again.state.environment.ecology.aquatic, before);
});

test('Cardinal energy explicitly includes all live fish and no unknown plant gets berry energy', () => {
  const state = createOzarkState(geometry), ecology = state.environment.ecology;
  const metrics = measureCardinalWorld(state);
  assert.equal(metrics.aquatic.liveCount, ecology.aquatic.fish.length);
  assert.equal(metrics.aquatic.liveKcal, aquaticEnergy(ecology));
  assert.ok(Math.abs(metrics.ecology.remainingKcal - ecologyEnergy(ecology)) < 1e-7);
  assert.ok(Math.abs(metrics.ecology.balanceErrorKcal) < 1e-7);
  for (const key of ['massErrorGrams', 'energyErrorKcal', 'waterErrorMl'])
    assert.ok(Math.abs(metrics.aquatic[key]) < 1e-7);
  const diagnostic = { environment: { ecology: {
    plants: [{ kind: 'fish', quantity: 10 }], animals: [], materials: [],
  } } };
  assert.equal(measureCardinalWorld(diagnostic).resources.availableKcal, 0);
});

function renderCalls(object, time = 0) {
  const calls = [];
  const g = { save() {}, restore() {}, translate(...x) { calls.push(['translate', ...x]); },
    scale(...x) { calls.push(['scale', ...x]); },
    fillRect(...x) { calls.push(['rect', this.fillStyle, ...x]); } };
  drawEcologyObject(g, object, time);
  return calls;
}

test('live fish, whole body, bare residue, and detached tissue have distinct read-only art', () => {
  const forms = [
    { kind: 'fish', facing: { x: 1, y: 0 }, activity: 'moving' },
    { kind: 'fish_specimen', stage: 'fresh', quantity: 1 },
    { kind: 'fish_specimen', stage: 'bare', quantity: 0 },
    { kind: 'material', materialType: 'fish_tissue', stage: 'fresh' },
  ].map(value => ({ id: 'object:1', x: 12, y: 20, ...value }));
  const before = structuredClone(forms);
  const drawings = forms.map(value => JSON.stringify(renderCalls(value)));
  assert.equal(new Set(drawings).size, forms.length);
  assert.deepEqual(forms, before);
  assert.deepEqual(renderCalls(forms[0], 0).find(row => row[0] === 'translate'),
    renderCalls(forms[0], 8).find(row => row[0] === 'translate'));
});

test('projection draws only authoritative live fish and physical held objects, never remembered ghosts', () => {
  const state = createOzarkState(geometry), ecology = state.environment.ecology;
  const before = structuredClone(ecology);
  const sprites = renderEcology(ecology).filter(row => row.kind === 'fish');
  assert.deepEqual(sprites.map(row => row.id), ecology.aquatic.fish.map(row => row.id));
  assert.deepEqual(sprites.map(row => row.position), ecology.aquatic.fish.map(row => row.position));
  assert.deepEqual(ecology, before);
  const actor = state.agents[0];
  actor.inventory.items = ['object:99999', 'object:99998'];
  assert.deepEqual(heldAquaticSprites(state, actor), []);
  const material = { id: 'object:99999', kind: 'fish_specimen', materialType: 'fish_body',
    heldBy: actor.id, scene: actor.scene, fishTissue: { massGrams: 0 } };
  ecology.materials.push(material);
  assert.equal(heldAquaticSprites(state, actor).length, 1);
  assert.equal(heldAquaticSprites(state, actor)[0].stage, 'bare');
  assert.equal(heldAquaticSprites(state, actor)[0].quantity, 0);
  material.heldBy = 'mira';
  assert.deepEqual(heldAquaticSprites(state, actor), []);
});

// These deliberately use low-level transfer plus explicit native-shaped proof
// records to falsify the save boundary. They are NOT paid-controller evidence.
function ownedAquaticFixture({ pull = false } = {}) {
  const state = createOzarkState(geometry), disk = storage();
  const ecology = state.environment.ecology, actor = state.agents[0];
  state.elapsed = state.environment.elapsed = ecology.elapsed = 100;
  for (const inhabitant of state.agents) inhabitant.elapsed = 100;
  const fishId = ecology.aquatic.fish[0].id;
  function receipt(type, targetId, result, duration) {
    const eventId = actor.memory.nextId++, experimentId = actor.discovery.nextId++;
    actor.memory.experience.push({ id: eventId, at: actor.elapsed, type: 'action',
      details: { action: { type, targetId }, result: { ok: true, code: result.code,
        materialId: result.materialId, durationSeconds: duration,
        handling: { source: 'experienced', activeActionSeconds: duration, effort: 'rising' } } } });
    actor.discovery.experiments.push({ id: experimentId, at: actor.elapsed,
      primitive: type, targetId, ok: true, code: result.code,
      materialId: result.materialId, durationSeconds: duration, actionId: eventId });
    actor.inventory.items.push(result.materialId);
    rememberDirectDiscoveryObject(actor, describeEcologyObject(ecology, result.materialId,
      { actorId: actor.id }));
  }
  const caught = captureAquaticFish(ecology, fishId, actor.id, actor.position);
  assert.equal(caught.ok, true); receipt('catch', fishId, caught, 4);
  let tissueId = null;
  if (pull) {
    const portion = pullAquaticTissue(ecology, fishId, actor.id, actor.position);
    assert.equal(portion.ok, true); receipt('pull', fishId, portion, 5);
    tissueId = portion.materialId;
    rememberDirectDiscoveryObject(actor, describeEcologyObject(ecology, fishId, { actorId: actor.id }));
    // Physical export only. No fake ingestion or learned bodily effect.
    assert.equal(consumeEcologyMaterial(ecology, tissueId, 30 / 80, { actorId: actor.id }).ok, true);
  }
  assert.equal(writeOzarkSave(disk, state, geometry), true);
  return { state, disk, fishId, tissueId, raw: JSON.parse(disk.getItem(OZARK_SAVE_KEY)), receipt };
}

test('physical whole ownership, bare residue, and partial tissue preserve exact identity and stock', () => {
  const { state, disk, fishId, tissueId } = ownedAquaticFixture({ pull: true });
  const reopened = loadOzarkSave(disk, geometry);
  assert.equal(reopened.blocked, false, reopened.error);
  assert.deepEqual(reopened.state.environment.ecology, state.environment.ecology);
  const materials = reopened.state.environment.ecology.materials;
  assert.equal(materials.find(item => item.id === fishId).fishTissue.massGrams, 0);
  assert.equal(materials.find(item => item.id === tissueId).massGrams, 50);
  assert.deepEqual(reopened.state.agents[0].inventory.items, [fishId, tissueId]);
});

test('save refuses ownership theft, unlisted objects, missing acquisitions, forged timing, and wrong lineage', () => {
  const { raw, fishId, tissueId } = ownedAquaticFixture({ pull: true });
  for (const mutate of [
    value => { value.environment.ecology.materials.find(item => item.id === fishId).heldBy = 'mira'; },
    value => { value.agents[1].inventory.items.push(fishId); },
    value => { value.agents[0].inventory.items = [tissueId]; },
    value => { value.agents[0].discovery.experiments.shift(); },
    value => { value.agents[0].memory.experience[0].details.result.handling.activeActionSeconds = 1; },
    value => { value.agents[0].memory.experience[0].details.result.durationSeconds = 0; },
    value => { delete value.agents[0].memory.experience[0].details.result.handling; },
    value => {
      value.agents[0].discovery.experiments[0].code = 'OBJECT_OBSERVED';
      value.agents[0].memory.experience[0].details.result.code = 'OBJECT_OBSERVED';
    },
    value => {
      value.agents[0].discovery.experiments[1].targetId = 'object:1';
      value.agents[0].memory.experience[1].details.action.targetId = 'object:1';
    },
  ]) {
    const bad = structuredClone(raw); mutate(bad); protectedBytes(bad);
  }
});


test('idle terminal aquatic decay clears physical ownership before an immediate strict save', () => {
  const { state, disk, tissueId, fishId } = ownedAquaticFixture({ pull: true });
  const ecology = state.environment.ecology, actor = state.agents[0];
  const tissue = ecology.materials.find(item => item.id === tissueId);
  assert.equal(consumeEcologyMaterial(ecology, tissueId, 1 - .1000001 / tissue.massGrams,
    { actorId: actor.id }).ok, true);
  tissue.ageHours = 72; tissue.spoiled = true;
  state.elapsed = state.environment.elapsed = ecology.elapsed = 11000;
  for (const human of state.agents) human.elapsed = 11000;
  assert.equal(actor.active, null);
  tickOzarkEcology(ecology, .5, state.environment, state.agents);
  state.elapsed = state.environment.elapsed = 11000.5;
  for (const human of state.agents) human.elapsed = 11000.5;
  assert.equal(ecology.materials.some(item => item.id === tissueId), false);
  assert.deepEqual(actor.inventory.items, [fishId]);
  assert.equal(writeOzarkSave(disk, state, geometry), true,
    'the next autosave must not depend on another actor interaction');
  assert.equal(loadOzarkSave(disk, geometry).blocked, false);
});

test('old ordinary material terminal decay also clears dangling possession in a finite world', () => {
  const { state, disk, fishId, receipt } = ownedAquaticFixture();
  const ecology = state.environment.ecology, actor = state.agents[0];
  state.elapsed = state.environment.elapsed = ecology.elapsed = 11000;
  for (const human of state.agents) human.elapsed = 11000;
  const source = ecology.plants.find(item => item.quantity > 0);
  assert.ok(source);
  actor.position = { ...source.position };
  rememberDirectDiscoveryObject(actor, describeEcologyObject(ecology, source.id));
  const detached = interactEcologyObject(ecology, source.id, 'pull', {
    actorId: actor.id, position: actor.position, inventory: actor.inventory.items });
  assert.equal(detached.ok, true);
  receipt('pull', source.id, detached, 5);
  const material = ecology.materials.find(item => item.id === detached.materialId);
  assert.equal(consumeEcologyMaterial(ecology, material.id,
    1 - .1000001 / material.massGrams, { actorId: actor.id }).ok, true);
  material.ageHours = ECOLOGY_MATERIALS[material.materialType].spoilDays * 24;
  material.spoiled = true;
  tickOzarkEcology(ecology, .5, state.environment, state.agents);
  state.elapsed = state.environment.elapsed = 11000.5;
  for (const human of state.agents) human.elapsed = 11000.5;
  assert.equal(ecology.materials.some(item => item.id === detached.materialId), false);
  assert.deepEqual(actor.inventory.items, [fishId]);
  assert.equal(writeOzarkSave(disk, state, geometry), true);
  assert.equal(loadOzarkSave(disk, geometry).blocked, false);
});
