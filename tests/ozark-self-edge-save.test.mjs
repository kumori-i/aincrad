import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { bindOzarkWorldAgent } from '../src/ozark-agent-world.js';
import { tickEnvironment } from '../src/environment.js';
import { tickOzarkEcology } from '../src/ozark-ecology.js';
import { observeNpc, requestNpcAction, tickNpc } from '../src/npc.js';
import { knownRoute, createKnownRouteIndex } from '../src/navigation.js';
import { tileKey } from '../src/perception.js';
import { OZARK_SAVE_KEY, createOzarkState, loadOzarkSave, writeOzarkSave } from '../src/ozark-save.js';

const geometry = createOzarkWorldGeometry();
const SAME_TILE_START = Object.freeze({
  x: 576.7451358360865, y: 2303.2548641639232,
});
const SAME_TILE_TARGET = Object.freeze({ x: 640, y: 2400 });
const HISTORICAL_BYTES = '{"protected":"historical world"}';

function storage() {
  const values = new Map([[CONFIG.saveKey, HISTORICAL_BYTES]]);
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

function blockedMove(from, target) {
  const state = createOzarkState(geometry), actor = state.agents[0];
  // A localized synthetic physical fixture, not a fresh survival replay. The
  // start is the first coarse-run self-edge's real location. No observations,
  // receipts, blocked edges or routes are imported from that run or fabricated.
  state.elapsed = state.environment.elapsed = 242.25;
  state.environment.ecology.elapsed = 242;
  state.environment.ecology.pending = .25;
  actor.position = { ...from };
  for (const agent of state.agents) {
    agent.elapsed = state.elapsed;
    bindOzarkWorldAgent(agent, geometry, state);
  }
  const disk = storage();
  assert.equal(writeOzarkSave(disk, state, geometry), true,
    'the physical fixture is valid before the movement attempt');
  const previousBytes = disk.getItem(OZARK_SAVE_KEY);
  const observation = observeNpc(actor, state.environment);
  assert.ok(observation.cells.some(cell => cell.key === tileKey(target)));
  assert.deepEqual(actor.memory.blockedEdges, {});
  assert.equal(requestNpcAction(actor, { type: 'move', target },
    state.environment).code, 'STARTED');
  const route = structuredClone(actor.active.route);
  let steps = 0;
  while (actor.active && steps < 120) {
    state.elapsed += CONFIG.fixedStep;
    tickEnvironment(state.environment, CONFIG.fixedStep);
    tickOzarkEcology(state.environment.ecology, CONFIG.fixedStep,
      state.environment, state.agents);
    for (const agent of state.agents)
      tickNpc(agent, CONFIG.fixedStep, state.environment);
    steps++;
  }
  assert.equal(actor.active, null, 'the native-tick action must terminate');
  const receipt = actor.memory.experience.find(event => event.type === 'action');
  assert.ok(receipt);
  assert.equal(receipt.details.result.code, 'ROUTE_BLOCKED');
  assert.equal(receipt.details.result.ok, false);
  assert.deepEqual(receipt.details.startPosition, from);
  assert.deepEqual(receipt.details.action, { type: 'move', target });
  assert.ok(Math.abs(receipt.details.result.durationSeconds -
    steps * CONFIG.fixedStep) < 1e-9,
    'fixture tick count and receipt duration agree within clock precision');
  return { state, actor, disk, previousBytes, route, receipt };
}

function evidence(actor) {
  return structuredClone({
    position: actor.position, blockedEdges: actor.memory.blockedEdges,
    experience: actor.memory.experience, observations: actor.discovery.observations,
    experiments: actor.discovery.experiments, effects: actor.discovery.effects,
    seenFeedback: actor.discovery.seenFeedback, stomach: actor.physiology.stomach,
    feedback: actor.physiology.feedback, items: actor.inventory.items,
  });
}

function roundTrip(fixture) {
  const { state, actor, disk, previousBytes } = fixture;
  const before = evidence(actor);
  assert.equal(writeOzarkSave(disk, state, geometry), true,
    'a physically generated blocked edge must be saveable');
  assert.notEqual(disk.getItem(OZARK_SAVE_KEY), previousBytes);
  assert.deepEqual(evidence(actor), before, 'saving must not repair live evidence');
  const stored = JSON.parse(disk.getItem(OZARK_SAVE_KEY)).agents[0];
  assert.deepEqual(evidence(stored), before);
  const loaded = loadOzarkSave(disk, geometry);
  assert.equal(loaded.blocked, false, loaded.error);
  assert.deepEqual(evidence(loaded.state.agents[0]), before,
    'reopening must preserve exact route evidence and its original receipt');
  assert.equal(disk.getItem(CONFIG.saveKey), HISTORICAL_BYTES);
  return loaded.state.agents[0];
}

test('native blocked snap within one observed tile survives Ozark save and route reuse', () => {
  const fixture = blockedMove(SAME_TILE_START, SAME_TILE_TARGET);
  const { actor, route, receipt } = fixture;
  const center = { x: 560, y: 2320 };
  assert.equal(geometry.classify(SAME_TILE_START.x, SAME_TILE_START.y).reason,
    'deep-water');
  assert.deepEqual(route[0], center);
  assert.equal(tileKey(SAME_TILE_START), tileKey(center));
  assert.deepEqual(receipt.details.result.blockedTarget, center);
  assert.equal(receipt.details.result.movement.traversal, 'adrift');
  assert.equal(receipt.details.result.movement.progress, 'negligible');
  assert.ok(receipt.details.result.distance > 0,
    'passive current displaced the body without purposeful progress');
  const key = '7,29>7,29';
  assert.deepEqual(actor.memory.blockedEdges, {
    [key]: { observedAt: receipt.at, retryAfter: receipt.at + 60 },
  });
  const nextRoute = npc => knownRoute(npc.memory.cells, npc.position,
    SAME_TILE_TARGET, 30, npc.memory.blockedEdges, npc.elapsed, npc.navigationAnchor);
  const expectedRoute = nextRoute(actor);
  assert.ok(expectedRoute);
  assert.deepEqual(expectedRoute[0], { x: 640, y: 2320 },
    'the real self-edge makes navigation choose another observed entry node');
  assert.deepEqual(knownRoute(actor.memory.cells, actor.position, SAME_TILE_TARGET,
    30, {}, actor.elapsed, actor.navigationAnchor)[0], center,
  'the comparison without this evidence retries the obstructed center');

  const restored = roundTrip(fixture);
  assert.equal(restored.navigationAnchor, actor.navigationAnchor);
  assert.deepEqual(nextRoute(restored), expectedRoute);
  assert.deepEqual(createKnownRouteIndex(restored.memory.cells, restored.position,
    restored.memory.blockedEdges, restored.elapsed, restored.navigationAnchor)
    .route(SAME_TILE_TARGET), expectedRoute);
  assert.deepEqual(knownRoute(restored.memory.cells, restored.position,
    SAME_TILE_TARGET, 30, restored.memory.blockedEdges,
    restored.memory.blockedEdges[key].retryAfter, restored.navigationAnchor)[0],
  center, 'the retained self-edge expires under the existing retry contract');
});

test('opposite physical directions retain the same lexicographically sorted different-cell edge', () => {
  const left = { x: 720, y: 2160 }, right = { x: 800, y: 2160 };
  for (const [from, to] of [[left, right], [right, left]]) {
    const fixture = blockedMove(from, to);
    assert.deepEqual(fixture.route[0], to);
    assert.notEqual(tileKey(from), tileKey(to));
    assert.deepEqual(Object.keys(fixture.actor.memory.blockedEdges), ['10,27>9,27'],
      'canonical ordering is lexicographic, independent of physical direction');
    roundTrip(fixture);
  }
});

test('malformed, reversed, out-of-bounds and future edges still protect exact Ozark bytes', () => {
  const fixture = blockedMove({ x: 720, y: 2160 }, { x: 800, y: 2160 });
  roundTrip(fixture);
  const { disk } = fixture, goodBytes = disk.getItem(OZARK_SAVE_KEY);
  const good = JSON.parse(goodBytes), elapsed = good.elapsed;
  const valid = { observedAt: elapsed, retryAfter: elapsed + 60 };
  const cases = [
    ['malformed key', '7,29:7,29', valid],
    ['noninteger key', '7.5,29>7.5,29', valid],
    ['reversed canonical order', '9,27>10,27', valid],
    ['past west boundary', '-238,29>-238,29', valid],
    ['past east boundary', '238,29>238,29', valid],
    ['past north boundary', '7,-178>7,-178', valid],
    ['past south boundary', '7,178>7,178', valid],
    ['negative observation', '7,29>7,29', { ...valid, observedAt: -1 }],
    ['future observation', '7,29>7,29', { ...valid, observedAt: elapsed + 1 }],
    ['negative retry', '7,29>7,29', { ...valid, retryAfter: -1 }],
    ['future retry', '7,29>7,29', { ...valid, retryAfter: elapsed + 61 }],
    ['missing timestamp', '7,29>7,29', { retryAfter: elapsed + 60 }],
    ['invalid edge record', '7,29>7,29', null],
  ];
  for (const [label, key, edge] of cases) {
    disk.setItem(OZARK_SAVE_KEY, goodBytes);
    const opened = loadOzarkSave(disk, geometry);
    assert.equal(opened.blocked, false, opened.error);
    opened.state.agents[0].memory.blockedEdges[key] = structuredClone(edge);
    assert.equal(writeOzarkSave(disk, opened.state, geometry), false, label);
    assert.equal(disk.getItem(OZARK_SAVE_KEY), goodBytes, label);

    const forged = structuredClone(good);
    forged.agents[0].memory.blockedEdges[key] = structuredClone(edge);
    const bytes = JSON.stringify(forged);
    disk.setItem(OZARK_SAVE_KEY, bytes);
    const rejected = loadOzarkSave(disk, geometry);
    assert.equal(rejected.blocked, true, label);
    assert.equal(rejected.state, null, label);
    assert.match(rejected.error, /invalid Ozark terrain or legacy-site memory/, label);
    assert.equal(disk.getItem(OZARK_SAVE_KEY), bytes, label);
    assert.equal(disk.getItem(CONFIG.saveKey), HISTORICAL_BYTES, label);
  }
});
