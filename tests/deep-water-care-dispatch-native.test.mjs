import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, NPC_RULES } from '../src/config.js';
import { discoveryDecision } from '../src/discovery.js';
import { createNpc } from '../src/npc-state.js';
import { createEnvironment } from '../src/environment.js';
import { freshState } from '../src/world.js';
import { shelterSource } from '../src/resources.js';
import { projectPhysiology } from '../src/biology.js';
import { NpcController } from '../src/controller.js';
import { PopulationRuntime } from '../src/population.js';
import { contactEscape } from '../src/discovery.js';
import { bodySignals } from '../src/interoception.js';
import { collapseNpc, observeNpc, requestNpcAction, tickNpc } from '../src/npc.js';
import { baselineDecision, terrainDecision } from './fixtures/deep-water-policy-reference.mjs';
import { makeCareFixture, cloneCareFixture, keepObservedSource,
  runNativeAction, refreshObservation, POSITIONS } from './fixtures/deep-water-care-dispatch.mjs';

const bankReason = 'I feel deep water under me and can see a nearer patch toward the bank.';
const waterMove = target => ({ action: { type: 'move', target },
  reason: 'I am approaching remembered water.', need: 'water', provider: 'discovery-learner' });
const wrappedTerrain = choice => ({ ...choice, provider: 'discovery-learner' });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function assertDecisionParity(fixture) {
  const control = cloneCareFixture(fixture);
  fixture.setDecisionGuard(true); control.setDecisionGuard(true);
  const expected = baselineDecision(control.actor);
  assert.deepEqual(discoveryDecision(fixture.actor), expected);
  assert.deepEqual(fixture.state, control.state, 'complete world/actor/RNG parity');
  return expected;
}

test('real deep river: an existing admissible bank safety swim overrides only remembered-water movement', () => {
  const f = makeCareFixture({ guardDecision: true });
  assert.equal(f.geometry.observe(f.actor.position).ground, 'deep-water');
  assert.equal(bodySignals(f.actor).thirst, 'dry mouth');
  assert.equal(f.actor.flask.water, 0);
  assert.deepEqual(f.actor.memory.skills, []);
  assert.equal(f.actor.memory.experience.some(event => event.type === 'action'), false);
  const source = f.actor.memory.sources['ozark-water:-14:3'];
  assert.ok(f.observation.sources.some(row => row.id === source.id));
  assert.ok(distance(f.actor.position, source) > NPC_RULES.collectionRange);
  const expected = terrainDecision(f.actor);
  assert.deepEqual(expected, { action: { type: 'swim', target: { x: -1120, y: 240 } },
    reason: bankReason, need: 'safety' });
  const control = cloneCareFixture(f);
  assert.deepEqual(baselineDecision(control.actor), waterMove({ x: -1120, y: 240 }));
  const beforeQueries = f.calls.observe.length;
  assert.deepEqual(discoveryDecision(f.actor), wrappedTerrain(expected));
  assert.deepEqual(f.state, control.state, 'override introduces no actor/world/RNG mutation');
  assert.equal(f.calls.observe.length - beforeQueries, 1, 'one dispatch helper query');
});

test('the unchanged native swim pays time and effort for intentional progress; blocked walking is only adrift', () => {
  const swimmer = makeCareFixture(), walker = cloneCareFixture(swimmer);
  const safety = terrainDecision(swimmer.actor);
  const selected = discoveryDecision(swimmer.actor);
  assert.deepEqual(selected, wrappedTerrain(safety));
  const baseline = baselineDecision(walker.actor);
  const swim = runNativeAction(swimmer, selected.action, { seconds: .5 });
  const walk = runNativeAction(walker, baseline.action, { seconds: .5 });
  assert.equal(swim.admission.code, 'STARTED');
  assert.equal(walk.admission.code, 'STARTED');
  assert.ok(swim.elapsed > 0 && swim.metrics.effortSeconds > 0);
  assert.ok(swim.metrics.swimSeconds > 0);
  assert.ok(swim.active.forwardProgress > 5, 'native ledger excludes all passive drift');
  assert.ok(swim.metrics.intentionalDistance > 5);
  assert.ok(swimmer.actor.physiology.totals.metabolizedKcal > swim.before.metabolizedKcal);
  assert.ok(swimmer.actor.physiology.stamina < swim.before.stamina);
  assert.ok(walk.metrics.driftDistance > 0);
  assert.equal(walk.active.forwardProgress, 0);
  assert.equal(walk.active.swimSeconds, 0);
  assert.ok(distance(walker.actor.position, walk.before.position) > 0);
  for (let i = 0; i < 45 && walker.actor.active; i++) {
    tickNpc(walker.actor, CONFIG.fixedStep, walker.environment);
  }
  assert.equal(walker.actor.lastResult.code, 'ROUTE_BLOCKED');
  assert.equal(walker.actor.lastResult.movement.progress, 'negligible');
  assert.equal(walker.actor.lastResult.movement.traversal, 'adrift');
});

test('native deep-pond curiosity and subsequent heading remain available without inventing a water source or route', () => {
  const f = makeCareFixture({ position: POSITIONS.deepPond });
  assert.equal(f.geometry.observe(f.actor.position).ground, 'deep-pond');
  assert.deepEqual(f.observation.sources, []);
  assert.deepEqual(f.actor.memory.sources, {});
  assert.equal(Object.values(f.actor.memory.cells).some(cell => cell.walkable), false);
  const first = assertDecisionParity(f);
  assert.equal(first.action.type, 'swim');
  assert.equal(first.need, 'understanding');
  const motion = runNativeAction(f, first.action, { seconds: 2, untilComplete: true });
  assert.equal(motion.admission.code, 'STARTED');
  assert.equal(motion.receipt.code, 'ARRIVED');
  assert.equal(motion.receipt.movement.traversal, 'swimming');
  assert.ok(motion.metrics.intentionalDistance > 20);
  assert.equal(motion.metrics.driftDistance, 0);
  refreshObservation(f);
  assert.equal(f.geometry.observe(f.actor.position).ground, 'deep-pond');
  const next = terrainDecision(f.actor);
  assert.equal(next.need, 'safety');
  assert.match(next.reason, /continues that heading/);
  assertDecisionParity(f);
});

test('passive drift is followed by a decision from current deep footing, not the previous coordinate', () => {
  const f = makeCareFixture();
  const drift = runNativeAction(f, { type: 'wait', seconds: .5 },
    { seconds: .5, untilComplete: true });
  assert.ok(distance(drift.before.position, f.actor.position) > 5);
  assert.ok(drift.metrics.driftDistance > 0);
  refreshObservation(f);
  keepObservedSource(f, 'ozark-water:-17:6');
  assert.equal(f.geometry.observe(f.actor.position).ground, 'deep-water');
  const expected = terrainDecision(f.actor), control = cloneCareFixture(f);
  assert.equal(expected.need, 'safety');
  assert.equal(baselineDecision(control.actor).action.type, 'move');
  f.setDecisionGuard(true);
  const before = f.calls.observe.length;
  assert.deepEqual(discoveryDecision(f.actor), wrappedTerrain(expected));
  assert.deepEqual(f.calls.observe.slice(before), [{ ...f.actor.position }]);
  assert.deepEqual(f.state, control.state);
});

test('actual arrival on dry land stops the override despite a genuine preceding swimming receipt', () => {
  const f = makeCareFixture({ position: POSITIONS.riverExit });
  const action = terrainDecision(f.actor).action;
  const result = runNativeAction(f, action, { seconds: 5, untilComplete: true });
  assert.equal(result.receipt.code, 'ARRIVED');
  assert.equal(result.receipt.movement.traversal, 'swimming');
  assert.equal(f.geometry.observe(f.actor.position).ground, 'dry-land');
  refreshObservation(f);
  keepObservedSource(f, 'ozark-water:-9:-10');
  const decision = assertDecisionParity(f);
  assert.equal(decision.action.type, 'move');
  assert.equal(decision.need, 'water');
});

for (const [name, position, sourceId, wetness] of [
  ['dry land', POSITIONS.dry, 'ozark-water:-9:-10', 0],
  ['soaked but dry land', POSITIONS.dry, 'ozark-water:-9:-10', 100],
  ['genuinely shallow water', POSITIONS.shallow, 'ozark-water:-17:6', 50],
]) test(`${name} does not promote an available curiosity swim over water care`, () => {
  const f = makeCareFixture({ position, sourceId });
  f.actor.thermal.wetness = wetness;
  const curiosity = terrainDecision(f.actor);
  assert.equal(curiosity.action.type, 'swim');
  assert.equal(curiosity.need, 'understanding');
  const decision = assertDecisionParity(f);
  assert.equal(decision.action.type, 'move');
  assert.equal(decision.need, 'water');
});

test('carried drinking remains ahead of deep-water safety and uses the native ingestion receipt', () => {
  const f = makeCareFixture();
  f.actor.flask.water = .5;
  assert.equal(terrainDecision(f.actor).need, 'safety');
  const decision = assertDecisionParity(f);
  assert.deepEqual(decision.action, { type: 'drink' });
  f.setDecisionGuard(false);
  const beforeDeficit = f.actor.physiology.waterDeficitMl;
  const result = requestNpcAction(f.actor, decision.action, f.environment);
  assert.equal(result.code, 'DRANK');
  assert.equal(result.delayed, true);
  assert.equal(result.hydrationGain, 0);
  assert.equal(f.actor.flask.water, 0);
  assert.equal(f.actor.physiology.waterDeficitMl, beforeDeficit,
    'ingestion does not fabricate immediate absorbed relief');
  assert.ok(f.actor.physiology.stomach.some(portion => portion.remainingWaterMl > 0));
});

test('a genuinely in-range source keeps native collection and then drinking ahead of safety', () => {
  const f = makeCareFixture({ position: POSITIONS.riverExit });
  assert.equal(f.geometry.observe(f.actor.position).ground, 'deep-water');
  assert.equal(terrainDecision(f.actor).need, 'safety');
  const decision = assertDecisionParity(f);
  assert.deepEqual(decision.action,
    { type: 'fill_flask', sourceId: 'ozark-water:-12:-7' });
  f.setDecisionGuard(false);
  assert.equal(requestNpcAction(f.actor, decision.action, f.environment).code, 'COLLECTED');
  const drink = discoveryDecision(f.actor);
  assert.deepEqual(drink.action, { type: 'drink' });
  assert.equal(requestNpcAction(f.actor, drink.action, f.environment).code, 'DRANK');
  assert.equal(f.actor.stats.independentDrinks, 1);
});

test('policy selection never guarantees availability or admits an unobserved native swim', () => {
  const f = makeCareFixture({ position: POSITIONS.riverExit });
  const decision = discoveryDecision(f.actor);
  assert.equal(decision.action.type, 'fill_flask');
  f.environment.unavailableSources = [decision.action.sourceId];
  assert.equal(requestNpcAction(f.actor, decision.action, f.environment).code, 'SOURCE_UNAVAILABLE');
  assert.equal(f.actor.flask.water, 0);
  const target = { x: -960, y: -560 };
  delete f.actor.memory.cells['-12,-7'];
  assert.equal(requestNpcAction(f.actor, { type: 'swim', target }, f.environment).code, 'UNOBSERVED_TARGET');
  assert.deepEqual(f.actor.position, POSITIONS.riverExit);
});

test('genuine preceding river motion keeps existing heading, breathing-hard, and strained bank choices unchanged', () => {
  const original = makeCareFixture();
  const motion = runNativeAction(original,
    { type: 'swim', target: { x: -1200, y: 80 } }, { seconds: 5, untilComplete: true });
  assert.equal(motion.receipt.code, 'ARRIVED');
  assert.equal(motion.receipt.movement.traversal, 'swimming');
  refreshObservation(original);
  assert.equal(original.geometry.observe(original.actor.position).ground, 'deep-water');
  const cases = [
    ['easy breathing', actor => {}, 'stamina', 'easy breathing', { x: -1200, y: -80 }],
    ['breathing hard', actor => { actor.physiology.stamina = 45; }, 'stamina', 'breathing hard', { x: -1200, y: -80 }],
    ['winded', actor => { actor.physiology.stamina = 20; }, 'stamina', 'winded', { x: -1040, y: 80 }],
    ['exhausted', actor => { actor.physiology.stamina = 8; }, 'stamina', 'exhausted', { x: -1040, y: 80 }],
    ['depleted', actor => { actor.physiology.availableEnergyKcal = 0; actor.physiology.storedEnergyKcal = 0; }, 'energy', 'depleted', { x: -1040, y: 80 }],
    ['severe pain', actor => { actor.physiology.health = 35; }, 'pain', 'severe', { x: -1040, y: 80 }],
  ];
  for (const [name, arrange, signal, value, target] of cases) {
    const f = cloneCareFixture(original);
    arrange(f.actor); projectPhysiology(f.actor);
    assert.equal(bodySignals(f.actor)[signal], value, name);
    const expected = terrainDecision(f.actor);
    assert.equal(expected.need, 'safety', name);
    assert.deepEqual(expected.action, { type: 'swim', target }, name);
    assert.match(expected.reason, name === 'easy breathing' || name === 'breathing hard'
      ? /continues that heading/ : /toward the bank/, name);
    const control = cloneCareFixture(f);
    assert.equal(baselineDecision(control.actor).action.type, 'move', name);
    f.setDecisionGuard(true);
    assert.deepEqual(discoveryDecision(f.actor), wrappedTerrain(expected), name);
    assert.deepEqual(f.state, control.state, `${name}: world/actor/RNG unchanged`);
  }
});

test('native legacy contact retains decision priority and active-action interruption', () => {
  // Ozark animals do not currently attack humans. Exercise the unchanged real
  // contact authority in the existing legacy ecology, rather than fabricate
  // an Ozark contact event or broaden this dispatch correction.
  const actor = createNpc({ mode: 'discovery', seed: 25 });
  const environment = createEnvironment(25, { mode: 'discovery' });
  const refuge = shelterSource('refuge');
  actor.position = { x: refuge.x, y: refuge.y };
  const predator = environment.ecology.animals.find(animal => animal.species === 'bobcat');
  assert.ok(predator);
  predator.position = { x: actor.position.x + 18, y: actor.position.y };
  Object.assign(predator.physiology, { availableEnergyKcal: 10,
    storedEnergyKcal: 0, waterDeficitMl: 0, hoursSinceMeal: 12 });
  projectPhysiology(predator);
  environment.ecology.animals = [predator];
  environment.ecology.plants = [];
  observeNpc(actor, environment);
  assert.equal(requestNpcAction(actor, { type: 'wait', seconds: 5 }, environment).code, 'STARTED');
  const state = freshState({ mode: 'legacy' });
  Object.assign(state, { simulationMode: 'discovery', environment,
    agents: [actor], npc: actor, elapsed: actor.elapsed, cardinal: null });
  const runtime = new PopulationRuntime(state, { cardinal: false });
  try {
    for (let i = 0; i < 180 && !actor.memory.experience.some(event =>
      event.details?.code === 'CONTACT_INJURY'); i++) runtime.tick(CONFIG.fixedStep);
  } finally { runtime.dispose(); }
  const injury = actor.memory.experience.find(event => event.details?.code === 'CONTACT_INJURY');
  assert.equal(injury?.details.provenance, 'experienced contact');
  assert.ok(actor.memory.experience.some(event =>
    event.type === 'action' && event.details.result?.code === 'CONTACT_ESCAPE'));
  assert.equal(actor.active?.goal, 'escape-contact');
  actor.physiology.waterDeficitMl = 3600;
  actor.flask.water = .5;
  const escape = contactEscape(actor);
  assert.ok(escape);
  const control = structuredClone(actor);
  const decision = discoveryDecision(actor);
  assert.deepEqual(decision, baselineDecision(control));
  assert.deepEqual(actor, control);
  assert.equal(decision.need, 'safety');
  assert.deepEqual(decision.action, escape.action);
  assert.match(decision.reason, /contact I actually experienced/);
});

test('deep-water dispatch does not introduce sleep, collapse, or active-rest interruption', () => {
  for (const type of ['rest', 'sleep']) {
    const f = makeCareFixture();
    assert.equal(terrainDecision(f.actor).need, 'safety');
    assert.equal(requestNpcAction(f.actor, { type, seconds: 30 }, f.environment).code, 'STARTED');
    const controller = new NpcController(f.actor,
      { environment: f.environment, deferInitialObservation: true });
    try { controller.tick(.25); } finally { controller.dispose(); }
    assert.equal(f.actor.active?.request.type, type);
    assert.equal(f.actor.memory.experience.some(event => event.type === 'decision'), false);
    assert.ok(distance(f.actor.position, POSITIONS.deepRiver) > 0,
      'unchanged passive current is not suppressed while resting or sleeping');
  }
  const f = makeCareFixture();
  const safety = terrainDecision(f.actor);
  collapseNpc(f.actor, 'controlled lifecycle regression');
  assert.equal(requestNpcAction(f.actor, safety.action, f.environment).code, 'UNCONSCIOUS');
  const controller = new NpcController(f.actor,
    { environment: f.environment, deferInitialObservation: true });
  try { controller.tick(.25); } finally { controller.dispose(); }
  assert.equal(f.actor.lifecycle, 'COLLAPSED');
  assert.equal(f.actor.active, null);
  assert.equal(f.actor.memory.experience.some(event => event.type === 'decision'), false);
});
