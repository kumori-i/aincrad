import { bindCommunicationMode } from '../src/communication-mode.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { createNpc } from '../src/npc-state.js';
import { createEnvironment } from '../src/environment.js';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { createOzarkState } from '../src/ozark-save.js';
import { bindOzarkWorldAgent } from '../src/ozark-agent-world.js';
import { observeNpc, requestNpcAction, tickNpc } from '../src/npc.js';
import { discoveryDecision } from '../src/discovery.js';
import { explorationFrontier, recordClaim } from '../src/cognition.js';
import { bodySignals } from '../src/interoception.js';
import { rememberedCells, rememberedEdges } from '../src/perception.js';
import { knownRoute } from '../src/navigation.js';

const geometry = createOzarkWorldGeometry();

function freshOzark({ position, deficitMl = 500, guardGeometry = false } = {}) {
  const state = createOzarkState(geometry);
  const actor = state.agents[0];
  if (position) actor.position = { ...position };
  actor.physiology.waterDeficitMl = deficitMl;
  let forbidPrivateProbe = false;
  const world = guardGeometry ? Object.freeze({ ...geometry,
    sample(...args) {
      if (forbidPrivateProbe) throw new Error('decision sampled private terrain');
      return geometry.sample(...args);
    },
    classify(...args) {
      if (forbidPrivateProbe) throw new Error('decision classified private terrain');
      return geometry.classify(...args);
    },
  }) : geometry;
  bindOzarkWorldAgent(actor, world, state);
  const observation = observeNpc(actor, state.environment);
  return { actor, state, observation,
    forbidPrivateProbe: () => { forbidPrivateProbe = true; } };
}

test('dry mouth with no known bank selects a locally observed, admitted survey route', () => {
  const { actor, observation, forbidPrivateProbe } = freshOzark({ guardGeometry: true });
  assert.equal(bodySignals(actor).thirst, 'dry mouth');
  assert.deepEqual(observation.sources, []);
  assert.deepEqual(actor.memory.sources, {});
  const frontier = explorationFrontier(actor, { reportedHints: false });
  assert.ok(frontier, 'the actor has a bounded observed frontier');
  forbidPrivateProbe();
  const decision = discoveryDecision(actor);
  assert.equal(decision.provider, 'discovery-learner');
  assert.equal(decision.need, 'water');
  assert.deepEqual(decision.action, { type: 'move', target: frontier.target });
  assert.ok(observation.cells.some(cell => cell.x === frontier.target.x &&
    cell.y === frontier.target.y), 'the target was in this actor’s actual sight');
  assert.ok(knownRoute(rememberedCells(actor), actor.position, frontier.target,
    30, rememberedEdges(actor), actor.elapsed, actor.navigationAnchor));
  assert.deepEqual(actor.memory.sources, {}, 'a survey does not invent a source');
});

test('an unverified position report does not steer Ozark water survey', () => {
  const { actor, observation } = freshOzark();
  assert.deepEqual(observation.sources, []);
  const before = discoveryDecision(actor).action;
  const frontierBefore = explorationFrontier(actor, { reportedHints: false });
  assert.deepEqual(before, { type: 'move', target: frontierBefore.target });
  bindCommunicationMode(actor,'legacy'); // Historical testimony must not become a water coordinate.
  recordClaim(actor, { kind: 'route', text: 'Water may be far beyond the valley.',
    position: { x: 18000, y: 13000 }, available: true }, { sourceId: 'human' });
  assert.equal(actor.cognition.beliefs.at(-1).status, 'unverified');
  assert.notDeepEqual(explorationFrontier(actor).target, frontierBefore.target,
    'the report would bias a generic frontier search');
  assert.deepEqual(explorationFrontier(actor, { reportedHints: false }).target,
    frontierBefore.target);
  assert.deepEqual(discoveryDecision(actor).action, before);
  assert.deepEqual(actor.memory.sources, {});
});

test('an exhausted dry-mouth actor cares for the body before surveying', () => {
  const { actor, observation } = freshOzark();
  assert.deepEqual(observation.sources, []);
  actor.physiology.stamina = 8;
  actor.physiology.fatigue = 80;
  assert.equal(bodySignals(actor).thirst, 'dry mouth');
  assert.equal(bodySignals(actor).fatigue, 'exhausted');
  const decision = discoveryDecision(actor);
  assert.equal(decision.need, 'rest');
  assert.ok(['rest', 'sleep'].includes(decision.action.type));
});

test('ravenous hunger keeps a dry-mouth survey from preempting food trials', () => {
  const { actor, observation } = freshOzark();
  actor.physiology.hoursSinceMeal = 20;actor.physiology.satietyHours=Math.max(0,6-20);
  assert.equal(bodySignals(actor).hunger, 'ravenous');
  assert.equal(bodySignals(actor).thirst, 'dry mouth');
  assert.deepEqual(observation.sources, []);
  assert.ok(observation.objects.length > 0);
  const decision = discoveryDecision(actor);
  assert.notEqual(decision.need, 'water');
});

test('a genuinely observed but unavailable bank does not stop the water survey', () => {
  const { actor, state, observation } = freshOzark({
    position: { x: -1700, y: 0 },
  });
  assert.ok(observation.sources.length > 0);
  state.environment.unavailableSources = observation.sources.map(source => source.id);
  const updated = observeNpc(actor, state.environment);
  assert.ok(updated.sources.length > 0);
  assert.ok(updated.sources.every(source => source.available === false));
  assert.ok(Object.values(actor.memory.sources).every(source =>
    source.available === false));
  const frontier = explorationFrontier(actor, { reportedHints: false });
  assert.ok(frontier);
  const decision = discoveryDecision(actor);
  assert.equal(decision.need, 'water');
  assert.deepEqual(decision.action, { type: 'move', target: frontier.target });
});

test('a second observed bank can be approached when the nearest has no remembered route', () => {
  const { actor, observation } = freshOzark({
    position: { x: -1120, y: 400 },
  });
  const first = observation.sources.find(source =>
    source.id === 'ozark-water:-15:4');
  const second = observation.sources.find(source =>
    source.id === 'ozark-water:-17:6');
  assert.ok(first && second, 'both banks were actually seen');
  assert.ok(Math.hypot(first.x - actor.position.x, first.y - actor.position.y) <
    Math.hypot(second.x - actor.position.x, second.y - actor.position.y));
  // Keep only firsthand sightings and a remembered dry corridor south and
  // west. Forgetting cells cannot certify an unseen crossing to the first bank.
  const points = [[-1120, 400], [-1120, 480], [-1200, 480],
    [-1280, 480], [-1360, 480]];
  actor.memory.cells = Object.fromEntries(points.map(([x, y]) => {
    const key = `${x / 80},${y / 80}`;
    assert.equal(observation.cells.find(cell => cell.key === key)?.terrain,
      'dry-ground');
    return [key, actor.memory.cells[key]];
  }));
  actor.memory.sources = Object.fromEntries([first, second].map(source =>
    [source.id, actor.memory.sources[source.id]]));
  const decision = discoveryDecision(actor);
  assert.equal(decision.need, 'water');
  assert.deepEqual(decision.action, { type: 'move',
    target: { x: second.x, y: second.y } });
});

test('a locally seen bank is approached, collected, and drunk at dry mouth', () => {
  const { actor, state, observation } = freshOzark({
    position: { x: -1120, y: 400 },
  });
  assert.equal(bodySignals(actor).thirst, 'dry mouth');
  assert.ok(observation.sources.length > 0);
  const approach = discoveryDecision(actor);
  assert.equal(approach.need, 'water');
  assert.equal(approach.action.type, 'move');
  assert.equal(requestNpcAction(actor, approach.action, state.environment).code,
    'STARTED');
  for (let step = 0; step < 300 && actor.active; step++)
    tickNpc(actor, CONFIG.fixedStep, state.environment);
  assert.equal(actor.lastResult.code, 'ARRIVED');
  observeNpc(actor, state.environment);
  const fill = discoveryDecision(actor);
  assert.equal(fill.need, 'water');
  assert.equal(fill.action.type, 'fill_flask');
  assert.ok(actor.memory.sources[fill.action.sourceId]);
  assert.equal(requestNpcAction(actor, fill.action, state.environment).code,
    'COLLECTED');
  const drink = discoveryDecision(actor);
  assert.equal(drink.need, 'water');
  assert.deepEqual(drink.action, { type: 'drink' });
  assert.equal(requestNpcAction(actor, drink.action, state.environment).code,
    'DRANK');
  assert.equal(actor.stats.independentDrinks, 1);
});

test('a real swim that ends on dry land does not trigger another learned swim', () => {
  const { actor, state } = freshOzark({
    position: { x: -920, y: -500 }, deficitMl: 250,
  });
  assert.equal(geometry.observe(actor.position).ground, 'deep-water');
  assert.equal(requestNpcAction(actor, { type: 'swim',
    target: { x: -960, y: -560 } }, state.environment).code, 'STARTED');
  for (let step = 0; step < 300 && actor.active; step++)
    tickNpc(actor, CONFIG.fixedStep, state.environment);
  const swim = actor.memory.experience.filter(event =>
    event.type === 'action' && event.details.action?.type === 'swim').at(-1);
  assert.equal(swim?.details.result?.ok, true);
  assert.equal(swim.details.result.movement.traversal, 'swimming');
  assert.equal(geometry.observe(actor.position).ground, 'dry-land');
  const observed = observeNpc(actor, state.environment);
  assert.ok(observed.cells.some(cell => cell.terrain === 'surface-water' &&
    Math.hypot(cell.x - actor.position.x, cell.y - actor.position.y) <= 160));
  assert.notEqual(discoveryDecision(actor).action.type, 'swim');

  const curious = freshOzark({ position: { x: -960, y: -560 }, deficitMl: 250 });
  assert.equal(geometry.observe(curious.actor.position).ground, 'dry-land');
  assert.equal(curious.actor.memory.experience.some(event => event.type === 'action'),
    false);
  assert.equal(discoveryDecision(curious.actor).action.type, 'swim',
    'firsthand curiosity remains available without prior terrain results');
});

test('legacy discovery dry mouth keeps its existing experiment priority', () => {
  const actor = createNpc({ id: 'aster', mode: 'discovery', seed: 7 });
  const environment = createEnvironment(7, { mode: 'discovery' });
  actor.physiology.waterDeficitMl = 500;
  observeNpc(actor, environment);
  assert.equal(bodySignals(actor).thirst, 'dry mouth');
  const decision = discoveryDecision(actor);
  assert.equal(decision.need, 'understanding');
  assert.equal(decision.provider, 'discovery-learner');
  assert.equal(decision.action.type, 'move');
});
