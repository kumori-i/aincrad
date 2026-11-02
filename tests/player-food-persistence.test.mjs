import test from 'node:test';
import assert from 'node:assert/strict';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { CONFIG } from '../src/config.js';
import { createOzarkState, loadOzarkSave, getOzarkSaveFailure, OZARK_SAVE_KEY,
  writeOzarkSave } from '../src/ozark-save.js';
import { interactEcologyObject } from '../src/ecology.js';
import { validatePlayerFoodState } from '../src/player-food-state.js';
import { createPlayerFoodController } from '../src/player-food.js';
import { bindOzarkWorldAgent } from '../src/ozark-agent-world.js';
import { PopulationRuntime } from '../src/population.js';
import { observeNpc, requestNpcAction } from '../src/npc.js';
import { assertWitnessInquiriesReopen } from '../scripts/player-food-native-reopen-contract.mjs';

const geometry = createOzarkWorldGeometry();
const storage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value) };
};
function savedWorld() {
  const disk = storage(), state = createOzarkState(geometry, {communicationSeed: 211});
  assert.equal(writeOzarkSave(disk, state, geometry), true);
  return {disk, state, raw: JSON.parse(disk.getItem(OZARK_SAVE_KEY))};
}
function heldFruit() {
  const {disk, state} = savedWorld();
  const plant = state.environment.ecology.plants.find(row =>
    ['apple_tree', 'bramble'].includes(row.kind) && row.stage === 'ripe' &&
    row.quantity > 0 && geometry.canOccupy(row.position.x, row.position.y));
  assert.ok(plant, 'the fixed world supplies a real reachable ripe plant');
  state.player = {...plant.position};
  const result = interactEcologyObject(state.environment.ecology, plant.id, 'pull',
    {actorId: 'player', position: state.player, scene: 'valley',
      inventory: state.playerFood.inventory.items});
  assert.equal(result.ok, true);
  state.playerFood.inventory.items.push(result.materialId);
  assert.equal(writeOzarkSave(disk, state, geometry), true);
  return {disk, state, materialId: result.materialId,
    raw: JSON.parse(disk.getItem(OZARK_SAVE_KEY))};
}

test('fresh food state is bounded, independent, and reset by a new world', () => {
  const a = createOzarkState(geometry, {communicationSeed: 211});
  const b = createOzarkState(geometry, {communicationSeed: 211});
  assert.equal(a.features.playerFood, 1);
  assert.equal(a.playerFood.version, 1);
  assert.deepEqual(a.playerFood.inventory.items, []);
  assert.equal(a.playerFood.physiology.profile, 'human');
  assert.equal(a.playerFood.physiology.health, a.playerBody.health);
  assert.equal(a.playerFood.physiology.stamina, a.playerBody.stamina);
  assert.deepEqual(a.playerFood, b.playerFood);
  assert.notStrictEqual(a.playerFood, b.playerFood);
  assert.notStrictEqual(a.playerFood.physiology, b.playerFood.physiology);
  assert.deepEqual(a.agents.map(actor => actor.inventory.items), [[], []]);
  assert.ok(validatePlayerFoodState(a.playerFood, 0, a.playerBody));
});

test('complete historical four-feature save migrates only in memory and retains learner evidence', () => {
  const {disk, raw} = savedWorld();
  delete raw.features.playerFood;
  delete raw.playerFood;
  const previous = JSON.stringify(raw);
  disk.setItem(OZARK_SAVE_KEY, previous);
  const opened = loadOzarkSave(disk, geometry);
  assert.equal(opened.blocked, false, opened.error);
  assert.equal(opened.exists, true);
  assert.equal(disk.getItem(OZARK_SAVE_KEY), previous, 'load never writes occupied bytes');
  assert.equal(opened.state.features.playerFood, 1);
  assert.deepEqual(opened.state.playerFood.inventory.items, []);
  assert.equal(opened.state.playerFood.physiology.health, raw.playerBody.health);
  assert.equal(opened.state.playerFood.physiology.stamina, raw.playerBody.stamina);
  for (const field of ['worldLineage', 'visualReference', 'characterMessages'])
    assert.deepEqual(opened.state[field], raw[field]);
  assert.equal(writeOzarkSave(disk, opened.state, geometry), true);
  const current = JSON.parse(disk.getItem(OZARK_SAVE_KEY));
  assert.equal(current.features.playerFood, 1);
  assert.deepEqual(current.playerFood, opened.state.playerFood);
  for (const field of ['worldLineage', 'visualReference', 'characterMessages'])
    assert.deepEqual(current[field], raw[field]);
});

test('real detached fruit ownership survives current save and does not copy agent knowledge', () => {
  const {disk, state, materialId, raw} = heldFruit();
  assert.equal(raw.environment.ecology.materials.find(row => row.id === materialId).heldBy,
    'player');
  assert.deepEqual(raw.playerFood.inventory.items, [materialId]);
  assert.deepEqual(state.agents.map(actor => actor.inventory.items), [[], []]);
  const opened = loadOzarkSave(disk, geometry);
  assert.equal(opened.blocked, false, opened.error);
  assert.deepEqual(opened.state.playerFood.inventory.items, [materialId]);
  assert.equal(opened.state.environment.ecology.materials.find(row =>
    row.id === materialId).heldBy, 'player');
  assert.deepEqual(opened.state.agents.map(actor => actor.inventory.items), [[], []]);
  assert.equal(writeOzarkSave(disk, opened.state, geometry), true);
  const reset = createOzarkState(geometry, {communicationSeed: 211});
  assert.deepEqual(reset.playerFood.inventory.items, []);
  assert.equal(reset.environment.ecology.materials.some(row =>
    row.heldBy === 'player'), false);
});

test('real player observation survives idle save; unrelated interrupted work retires unresolved inquiries', () => {
  const disk = storage(), state = createOzarkState(geometry, {communicationSeed: 211});
  const ecology = state.environment.ecology;
  const source = ecology.plants.filter(plant => plant.kind === 'apple_tree' &&
    plant.stage === 'ripe' && plant.quantity > 2 &&
    geometry.canOccupy(plant.position.x + 45, plant.position.y, CONFIG.playerRadius) &&
    geometry.lineOfSight({x: plant.position.x + 45, y: plant.position.y}, plant.position))
    .sort((a, b) =>
      Math.hypot(a.position.x - geometry.agentSpawns.aster.x,
        a.position.y - geometry.agentSpawns.aster.y) -
      Math.hypot(b.position.x - geometry.agentSpawns.aster.x,
        b.position.y - geometry.agentSpawns.aster.y))[0];
  assert.ok(source);
  const point = {x: source.position.x + 45, y: source.position.y};
  state.player = {...point};
  for (const npc of state.agents) {
    npc.position = {...point};
    bindOzarkWorldAgent(npc, geometry, state);
  }
  const population = new PopulationRuntime(state, {cardinal: false});
  const player = createPlayerFoodController(state, geometry);
  try {
    const finish = (type, targetId) => {
      assert.equal(player.start(type, targetId).code, 'ACTION_STARTED');
      for (let i = 0; i < 1000; i++) {
        state.elapsed += CONFIG.fixedStep;
        state.environment.elapsed = ecology.elapsed = state.elapsed;
        for (const npc of state.agents) npc.elapsed = state.elapsed;
        const result = player.tick(CONFIG.fixedStep);
        if (result) { assert.equal(result.ok, true, `${type}: ${result.code}`); return result; }
      }
      assert.fail(`${type} did not complete its paid work`);
    };
    const portion = finish('pull', source.id).materialId;
    finish('sample', portion);
    finish('release', portion);
    for (const npc of state.agents) {
      assert.equal(npc.active, null);
      assert.deepEqual(npc.discovery.inquiries.map(q =>
        ({actorId: q.actorId, sourceId: q.sourceId, attempts: q.attempts, retired: q.retired})),
      [{actorId: 'player', sourceId: portion, attempts: [], retired: false}]);
      assert.deepEqual(npc.discovery.experiments, [], 'The witness has no copied self-trial');
    }
    assert.equal(writeOzarkSave(disk, state, geometry), true, getOzarkSaveFailure(state));
    const idleBytes = disk.getItem(OZARK_SAVE_KEY);
    const idleRaw = JSON.parse(idleBytes);
    const idle = loadOzarkSave(disk, geometry);
    assert.equal(idle.blocked, false, idle.error);
    assertWitnessInquiriesReopen(state.agents, idleRaw.agents, idle.state.agents, portion);
    assert.deepEqual(idle.state.agents.map(n => n.discovery.inquiries),
      state.agents.map(n => n.discovery.inquiries),
      'An idle save retains the exact player-origin inquiry');
    assert.deepEqual(idle.state.agents.map(n => n.discovery.experiments), [[], []]);
    for (const change of [
      q => { q.actorId = 'ghost'; },
      q => { q.actorId = 'aster'; },
      q => { q.sourceId = 'object:invalid'; },
    ]) {
      const bad = structuredClone(idleRaw);
      change(bad.agents[0].discovery.inquiries[0]);
      const bytes = JSON.stringify(bad);
      assert.notEqual(bytes, idleBytes);
      disk.setItem(OZARK_SAVE_KEY, bytes);
      const rejected = loadOzarkSave(disk, geometry);
      assert.equal(rejected.blocked, true, `accepted invalid witness identity: ${change}`);
      assert.equal(disk.getItem(OZARK_SAVE_KEY), bytes);
    }
    disk.setItem(OZARK_SAVE_KEY, idleBytes);
    observeNpc(state.agents[0], state.environment);
    assert.equal(requestNpcAction(state.agents[0],
      {type: 'inspect_object', targetId: source.id}, state.environment).code,
    'ACTION_STARTED', 'The unrelated inspection is physically in progress');
    assert.equal(state.agents[1].active, null);
    assert.equal(writeOzarkSave(disk, state, geometry), true);
    const interruptedRaw = JSON.parse(disk.getItem(OZARK_SAVE_KEY));
    assert.equal(interruptedRaw.agents[0].interrupted, true);
    assert.equal(Boolean(interruptedRaw.agents[1].interrupted), false);
    const interrupted = loadOzarkSave(disk, geometry);
    assert.equal(interrupted.blocked, false, interrupted.error);
    assertWitnessInquiriesReopen(state.agents, interruptedRaw.agents,
      interrupted.state.agents, portion);
    assert.equal(interrupted.state.agents[0].discovery.inquiries[0].retired, true);
    assert.equal(interrupted.state.agents[1].discovery.inquiries[0].retired, false);
    assert.deepEqual(interrupted.state.agents.map(n => n.active), [null, null],
      'No pending inspection authority resumes after reopening');
    assert.ok(interrupted.state.agents[0].memory.experience.some(event =>
      event.details?.result?.code === 'RESTART_INTERRUPTED'));
    assert.deepEqual(interrupted.state.agents.map(n => n.discovery.experiments), [[], []],
      'The witnessed player swallow never becomes a personal food result');
  } finally {
    player.dispose();
    population.dispose();
  }
});

test('feature and extension mismatch, malformed nutrition, and body divergence protect bytes', () => {
  const {disk, state, raw} = savedWorld();
  const corruptions = [
    r => { delete r.playerFood; },
    r => { delete r.features.playerFood; },
    r => { r.features.playerFood = 2; },
    r => { r.playerFood.version = 2; },
    r => { delete r.playerFood.inventory; },
    r => { r.playerFood.futureAuthority = true; },
    r => { r.playerFood.inventory.items = ['object:1', 'object:1']; },
    r => { r.playerFood.inventory.items = ['object:1', 'object:2', 'object:3',
      'object:4', 'object:5']; },
    r => { r.playerFood.inventory.items = ['object:0001']; },
    r => { r.playerFood.physiology.stamina = 99; },
    r => { r.playerFood.physiology.health = 99; },
    r => { delete r.playerFood.physiology.storedEnergyKcal; },
    r => { r.playerFood.physiology.availableEnergyKcal = null; },
    r => { r.playerFood.physiology.stomach = Array(1000).fill({}); },
    r => { r.playerFood.physiology.feedback = Array(1000).fill({}); },
  ];
  for (const change of corruptions) {
    const candidate = structuredClone(raw);
    change(candidate);
    const bytes = JSON.stringify(candidate);
    assert.notEqual(bytes, JSON.stringify(raw));
    disk.setItem(OZARK_SAVE_KEY, bytes);
    const opened = loadOzarkSave(disk, geometry);
    assert.equal(opened.blocked, true, `accepted changed bytes: ${change}`);
    assert.equal(opened.state, null);
    assert.equal(writeOzarkSave(disk, state, geometry), false);
    assert.equal(disk.getItem(OZARK_SAVE_KEY), bytes);
  }
  // A syntactically valid JSON number can still decode to an infinite value.
  const infinite = JSON.stringify(raw).replace(/"availableEnergyKcal":[^,]+/,
    '"availableEnergyKcal":1e999');
  assert.notEqual(infinite, JSON.stringify(raw));
  disk.setItem(OZARK_SAVE_KEY, infinite);
  assert.equal(loadOzarkSave(disk, geometry).blocked, true);
  assert.equal(disk.getItem(OZARK_SAVE_KEY), infinite);
});

test('held materials require exact one-to-one physical player ownership', () => {
  const {disk, state, raw, materialId} = heldFruit();
  const changes = [
    r => { r.playerFood.inventory.items = []; },
    r => { r.environment.ecology.materials.find(row => row.id === materialId).heldBy = null; },
    r => { r.environment.ecology.materials.find(row => row.id === materialId).heldBy = 'aster'; },
    r => { r.agents[0].inventory.items.push(materialId); },
    r => { r.environment.ecology.materials.find(row => row.id === materialId).materialType = 'grass'; },
  ];
  for (const change of changes) {
    const candidate = structuredClone(raw);
    change(candidate);
    const bytes = JSON.stringify(candidate);
    disk.setItem(OZARK_SAVE_KEY, bytes);
    assert.equal(loadOzarkSave(disk, geometry).blocked, true,
      `accepted changed physical ownership: ${change}`);
    assert.equal(writeOzarkSave(disk, state, geometry), false);
    assert.equal(disk.getItem(OZARK_SAVE_KEY), bytes);
  }
});
