import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, NPC_RULES } from '../src/config.js';
import { OZARK_WORLD_PROFILE, createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { ozarkWaterSource, nearbyOzarkWaterSources } from '../src/ozark-water-sources.js';
import { createOzarkState, loadOzarkSave, writeOzarkSave,
  OZARK_SAVE_KEY } from '../src/ozark-save.js';
import { bindOzarkWorldAgent } from '../src/ozark-agent-world.js';
import { observeNpc, requestNpcAction, tickNpc } from '../src/npc.js';
import { discoveryDecision } from '../src/discovery.js';
import { bodySignals } from '../src/interoception.js';

const geometry = createOzarkWorldGeometry();
const storage = () => {
  const bytes = new Map();
  return { getItem: key => bytes.get(key) ?? null,
    setItem: (key, value) => bytes.set(key, value) };
};
function setFixtureClock(state, elapsed) {
  state.elapsed = elapsed;
  state.environment.elapsed = elapsed;
  state.environment.ecology.elapsed = elapsed;
  for (const agent of state.agents) agent.elapsed = elapsed;
}

test('river, spring and internal pond sources are deterministic visible dry banks', () => {
  for (const [position, name] of [
    [{ x: -1120, y: 400 }, 'Riverbank'],
    [{ x: 5200, y: -5600 }, 'Spring bank'],
    [{ x: -11800, y: 11080 }, 'Sinkhole pond shore'],
  ]) {
    const sources = nearbyOzarkWaterSources(position, NPC_RULES.visionRadius,
      geometry);
    assert.ok(sources.some(source => source.name === name), name);
    assert.ok(sources.length <= 24);
    for (const source of sources) {
      assert.deepEqual(ozarkWaterSource(source.id, geometry), source);
      assert.ok(Math.hypot(source.x - position.x, source.y - position.y) <=
        NPC_RULES.visionRadius);
      assert.equal(geometry.lineOfSight(position, source), true);
      assert.equal(geometry.classify(source.x, source.y).reason, 'dry-ground');
      assert.ok(source.id.startsWith('ozark-water:'));
      assert.equal(Object.hasOwn(source, 'depthProxy'), false);
      assert.equal(Object.hasOwn(source, 'currentDirection'), false);
    }
  }
  assert.deepEqual(nearbyOzarkWaterSources(geometry.agentSpawns.aster, 80,
    geometry), [], 'distant water cannot enter an agent’s local observation');
  for (const id of ['river:east:1', 'pond:spring:1',
    'ozark-water:-015:4', 'ozark-water:-15:999', 'ozark-water:0:0']) {
    assert.equal(ozarkWaterSource(id, geometry), null);
  }
});

test('a physical bank hidden behind a sight obstruction is never discovered', () => {
  const local = {
    profile: OZARK_WORLD_PROFILE,
    bounds: geometry.bounds,
    sample: () => ({ surfaceWaterDistance: .08,
      sinkholePondDistance: null, nearestChannel: { kind: 'main' } }),
    classify: () => ({ reason: 'dry-ground' }),
    lineOfSight: (_from, to) => to.x <= 0,
  };
  assert.ok(ozarkWaterSource('ozark-water:1:0', local));
  const seen = nearbyOzarkWaterSources({ x: 0, y: 0 }, 80, local);
  assert.ok(seen.length > 0);
  assert.ok(seen.every(source => source.x <= 0));
  assert.equal(seen.some(source => source.id === 'ozark-water:1:0'), false);
});

test('thirsty Ozark agent observes a bank, approaches, fills and drinks through physical actions', () => {
  const disk = storage();
  const state = createOzarkState(geometry);
  setFixtureClock(state, 20);
  const aster = state.agents[0];
  aster.position = { x: -1120, y: 400 };
  aster.physiology.waterDeficitMl = 1500;
  for (const agent of state.agents)
    bindOzarkWorldAgent(agent, geometry, state);
  assert.deepEqual(aster.memory.sources, {});
  const observation = observeNpc(aster, state.environment);
  assert.equal(bodySignals(aster).thirst, 'thirsty');
  assert.ok(observation.sources.length > 0);
  assert.ok(observation.sources.every(source =>
    aster.memory.sources[source.id]?.observedAt === aster.elapsed));
  assert.equal(writeOzarkSave(disk, state, geometry), true);
  const reopened = loadOzarkSave(disk, geometry);
  assert.equal(reopened.blocked, false, reopened.error);
  assert.deepEqual(reopened.state.agents[0].memory.sources,
    aster.memory.sources, 'locally observed source identity survives strict save/load');
  const restored = reopened.state.agents[0];
  for (const agent of reopened.state.agents)
    bindOzarkWorldAgent(agent, geometry, reopened.state);
  const approach = discoveryDecision(restored).action;
  assert.equal(approach.type, 'move');
  assert.ok(observation.sources.some(source =>
    Math.hypot(source.x - approach.target.x,
      source.y - approach.target.y) <= NPC_RULES.tileSize));
  assert.equal(requestNpcAction(restored, approach,
    reopened.state.environment).code, 'STARTED');
  for (let step = 0; step < 300 && restored.active; step++)
    tickNpc(restored, CONFIG.fixedStep, reopened.state.environment);
  assert.equal(restored.lastResult.code, 'ARRIVED');
  observeNpc(restored, reopened.state.environment);
  const collect = discoveryDecision(restored).action;
  assert.equal(collect.type, 'fill_flask');
  assert.ok(restored.memory.sources[collect.sourceId]);
  assert.equal(requestNpcAction(restored, collect,
    reopened.state.environment).code, 'COLLECTED');
  assert.equal(restored.flask.water, 1);
  const drink = discoveryDecision(restored).action;
  assert.equal(drink.type, 'drink');
  assert.equal(requestNpcAction(restored, drink,
    reopened.state.environment).code, 'DRANK');
  assert.equal(restored.stats.independentDrinks, 1);
  assert.ok(restored.flask.water < 1);
  assert.ok(restored.physiology.stomach.some(item =>
    item.originalWaterMl > 0), 'hydration enters the normal delayed body path');
});

test('both approved spawns can reach a locally discovered bank within bounded walking', () => {
  const state = createOzarkState(geometry);
  for (const agent of state.agents)
    bindOzarkWorldAgent(agent, geometry, state);
  const routes = [
    [state.agents[0], [{ x: 480, y: 1040 }, { x: 720, y: 1280 },
      { x: 800, y: 1360 }]],
    [state.agents[1], [{ x: 480, y: 1120 }, { x: 720, y: 1280 },
      { x: 800, y: 1360 }]],
  ];
  for (const [agent, waypoints] of routes) {
    assert.deepEqual(agent.position, geometry.agentSpawns[agent.id]);
    agent.physiology.waterDeficitMl = 1500;
    assert.deepEqual(observeNpc(agent, state.environment).sources, []);
    for (const target of waypoints) {
      const local = observeNpc(agent, state.environment);
      assert.ok(local.cells.some(cell => cell.x === target.x &&
        cell.y === target.y), 'each next waypoint is locally observed');
      assert.equal(requestNpcAction(agent, { type: 'move', target },
        state.environment).code, 'STARTED');
      for (let step = 0; step < 240 && agent.active; step++)
        tickNpc(agent, CONFIG.fixedStep, state.environment);
      assert.equal(agent.lastResult.code, 'ARRIVED');
    }
    const local = observeNpc(agent, state.environment);
    assert.ok(local.sources.length > 0, 'a bank comes into local sight');
    assert.ok(agent.elapsed < 12, 'the route takes bounded walking time');
    const approach = discoveryDecision(agent).action;
    assert.equal(approach.type, 'move');
    assert.ok(local.sources.some(source =>
      Math.hypot(source.x - approach.target.x,
        source.y - approach.target.y) <= NPC_RULES.tileSize));
    assert.equal(requestNpcAction(agent, approach,
      state.environment).code, 'STARTED');
    for (let step = 0; step < 240 && agent.active; step++)
      tickNpc(agent, CONFIG.fixedStep, state.environment);
    assert.equal(agent.lastResult.code, 'ARRIVED');
    observeNpc(agent, state.environment);
    const collect = discoveryDecision(agent).action;
    assert.equal(collect.type, 'fill_flask');
    assert.equal(requestNpcAction(agent, collect,
      state.environment).code, 'COLLECTED');
    const drink = discoveryDecision(agent).action;
    assert.equal(drink.type, 'drink');
    assert.equal(requestNpcAction(agent, drink,
      state.environment).code, 'DRANK');
    assert.equal(agent.stats.independentDrinks, 1);
  }
});

test('forged, stale and historical source IDs cannot enter or replace Ozark save memory', () => {
  const disk = storage();
  const state = createOzarkState(geometry);
  setFixtureClock(state, 20);
  state.agents[0].position = { x: -1120, y: 400 };
  for (const agent of state.agents)
    bindOzarkWorldAgent(agent, geometry, state);
  observeNpc(state.agents[0], state.environment);
  assert.equal(writeOzarkSave(disk, state, geometry), true);
  const original = disk.getItem(OZARK_SAVE_KEY);
  const source = Object.values(state.agents[0].memory.sources)[0];
  const changed = { ...source };
  source.x += 80;
  assert.equal(writeOzarkSave(disk, state, geometry), false);
  assert.equal(disk.getItem(OZARK_SAVE_KEY), original);
  Object.assign(source, changed);
  source.observedAt = 21;
  assert.equal(writeOzarkSave(disk, state, geometry), false);
  assert.equal(disk.getItem(OZARK_SAVE_KEY), original);
  Object.assign(source, changed);
  state.agents[0].memory.sources['river:east:1'] = {
    ...source, id: 'river:east:1', name: 'Silverrun bank',
  };
  assert.equal(writeOzarkSave(disk, state, geometry), false);
  assert.equal(disk.getItem(OZARK_SAVE_KEY), original);
  delete state.agents[0].memory.sources['river:east:1'];
  assert.equal(writeOzarkSave(disk, state, geometry), true);
});

test('a canonical bank outside both starting sight cones cannot be forged at time zero', () => {
  const disk = storage(), state = createOzarkState(geometry);
  assert.equal(writeOzarkSave(disk, state, geometry), true);
  const raw = JSON.parse(disk.getItem(OZARK_SAVE_KEY));
  const source = ozarkWaterSource('ozark-water:-15:4', geometry);
  assert.ok(source);
  assert.ok(Math.hypot(source.x - geometry.agentSpawns.aster.x,
    source.y - geometry.agentSpawns.aster.y) > NPC_RULES.visionRadius);
  raw.agents[0].memory.sources[source.id] = {
    ...source, observedAt: 0, confidence: 'observed', retryAfter: 0,
  };
  const bytes = JSON.stringify(raw);
  disk.setItem(OZARK_SAVE_KEY, bytes);
  assert.equal(loadOzarkSave(disk, geometry).blocked, true);
  assert.equal(writeOzarkSave(disk, state, geometry), false);
  assert.equal(disk.getItem(OZARK_SAVE_KEY), bytes);
});

test('one second cannot produce remote Ozark source, cell or object sightings', () => {
  const disk = storage(), state = createOzarkState(geometry);
  setFixtureClock(state, 1);
  assert.equal(writeOzarkSave(disk, state, geometry), true);
  const good = JSON.parse(disk.getItem(OZARK_SAVE_KEY));
  const source = ozarkWaterSource('ozark-water:-15:4', geometry);
  assert.ok(source);
  const far = { x: 8000, y: 8000 }, paint = geometry.sample(far.x,
    far.y).paint;
  const terrain = paint === 'surface-water' ? 'surface-water' :
    paint === 'internal-pond' ? 'internal-pond' :
    paint === 'divide' ? 'visible-divide' : 'dry-ground';
  for (const change of [
    raw => { raw.agents[0].memory.sources[source.id] = {
      ...source, observedAt: 1, confidence: 'observed', retryAfter: 0,
    }; },
    raw => { raw.agents[0].memory.cells['100,100'] = {
      key: '100,100', ...far, scene: 'valley', terrain,
      walkable: terrain !== 'internal-pond', observedAt: 1, visits: 0,
    }; },
    raw => { raw.agents[0].discovery.observations['object:999999'] = {
      id: 'object:999999', scene: 'valley', position: far,
      appearance: {}, observedAt: 1,
    }; },
  ]) {
    const forged = structuredClone(good);
    change(forged);
    const bytes = JSON.stringify(forged);
    disk.setItem(OZARK_SAVE_KEY, bytes);
    assert.equal(loadOzarkSave(disk, geometry).blocked, true);
    assert.equal(writeOzarkSave(disk, state, geometry), false);
    assert.equal(disk.getItem(OZARK_SAVE_KEY), bytes);
  }
});

test('future or impossible Ozark map memory and historical sites protect saved bytes', () => {
  const disk = storage(), state = createOzarkState(geometry);
  for (const agent of state.agents)
    bindOzarkWorldAgent(agent, geometry, state);
  observeNpc(state.agents[0], state.environment);
  assert.equal(writeOzarkSave(disk, state, geometry), true);
  const good = JSON.parse(disk.getItem(OZARK_SAVE_KEY));
  const cellKey = Object.keys(good.agents[0].memory.cells)[0];
  assert.ok(cellKey);
  for (const change of [
    raw => { raw.agents[0].memory.cells[cellKey].observedAt = 999; },
    raw => { raw.agents[0].memory.cells[cellKey].x += NPC_RULES.tileSize; },
    raw => { raw.agents[0].memory.cells[cellKey].terrain = 'cave-floor'; },
    raw => {
      const point = { x: 8000, y: 8000 };
      const paint = geometry.sample(point.x, point.y).paint;
      const terrain = paint === 'surface-water' ? 'surface-water' :
        paint === 'internal-pond' ? 'internal-pond' :
        paint === 'divide' ? 'visible-divide' : 'dry-ground';
      raw.agents[0].memory.cells['100,100'] = {
        key: '100,100', ...point, scene: 'valley', terrain,
        walkable: terrain !== 'internal-pond', observedAt: 0, visits: 0,
      };
    },
    raw => { raw.agents[0].memory.blockedEdges['0,0>0,1'] = {
      observedAt: 999, retryAfter: 1059,
    }; },
    raw => { raw.agents[0].memory.shelters.refuge = {
      id: 'refuge', scene: 'valley', x: 0, y: 0,
    }; },
    raw => { raw.agents[0].memory.foods['apple:orchard'] = {
      id: 'apple:orchard', scene: 'valley', x: 0, y: 0,
    }; },
    raw => { raw.agents[0].memory.caveCells.refuge = {}; },
    raw => { raw.agents[0].memory.caveEdges.refuge = {}; },
    raw => { raw.agents[0].memory.caveExits.refuge = {}; },
  ]) {
    const forged = structuredClone(good);
    change(forged);
    const bytes = JSON.stringify(forged);
    disk.setItem(OZARK_SAVE_KEY, bytes);
    assert.equal(loadOzarkSave(disk, geometry).blocked, true);
    assert.equal(writeOzarkSave(disk, state, geometry), false);
    assert.equal(disk.getItem(OZARK_SAVE_KEY), bytes);
  }
});

test('fabricated legacy shelter memory cannot enter or exit an Ozark cave', () => {
  const state = createOzarkState(geometry), actor = state.agents[0];
  bindOzarkWorldAgent(actor, geometry, state);
  actor.memory.shelters.refuge = {
    id: 'refuge', scene: 'valley', x: actor.position.x,
    y: actor.position.y, available: true,
  };
  const position = { ...actor.position };
  assert.equal(requestNpcAction(actor, { type: 'enter_shelter',
    shelterId: 'refuge' }, state.environment).code, 'NO_OZARK_SHELTER');
  assert.equal(actor.scene, 'valley');
  assert.deepEqual(actor.position, position);
  assert.equal(requestNpcAction(actor, { type: 'inspect',
    shelterId: 'refuge' }, state.environment).code, 'NO_OZARK_SITE');
  actor.scene = 'refuge';
  assert.equal(requestNpcAction(actor, { type: 'exit_shelter' },
    state.environment).code, 'NO_OZARK_SHELTER');
  assert.equal(actor.scene, 'refuge');
  assert.deepEqual(actor.position, position);
});
