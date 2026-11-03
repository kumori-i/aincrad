import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpc } from '../src/npc-state.js';
import { createEnvironment } from '../src/environment.js';
import { canStand } from '../src/world.js';
import { lineOfSight } from '../src/perception.js';
import { bodySignals } from '../src/interoception.js';
import { relievePhysiology } from '../src/biology.js';
import { recordEvent } from '../src/npc-memory.js';
import { observeNpc, requestNpcAction, tickNpc } from '../src/npc.js';
import { processDiscoveryFeedback } from '../src/discovery.js';
import { beginOptionalSensoryWindow, observeOptionalSensoryWindow,
  cancelOptionalSensoryWindow, OPTIONAL_SENSORY_HORIZON_SECONDS } from './fixtures/optional-sensory-window.mjs';

// Authored physical geometry. Actions, stock, body costs and digestion remain
// genuine; these are engineering tests, not ordinary trajectory evidence.
function fixture() {
  const actor = createNpc({ mode: 'discovery', seed: 74193 });
  const environment = createEnvironment(74193, { mode: 'discovery' });
  const plant = environment.ecology.plants.find(row => row.kind === 'apple_tree');
  actor.position = [[45, 0], [-45, 0], [0, 45], [0, -45]]
    .map(([x, y]) => ({ x: plant.position.x + x, y: plant.position.y + y }))
    .find(point => canStand(point.x, point.y, 'valley') &&
      lineOfSight(point, plant.position));
  assert.ok(actor.position);
  observeNpc(actor, environment);
  return { actor, environment, plant };
}
function paid(actor, environment, type, targetId) {
  assert.equal(requestNpcAction(actor, { type, targetId }, environment).code, 'ACTION_STARTED');
  const active = actor.active;
  for (let i = 0; i < 200 && actor.active; i++) tickNpc(actor, .1, environment);
  assert.equal(actor.active, null);
  assert.equal(actor.lastResult.ok, true);
  assert.ok(actor.lastResult.durationSeconds >= active.seconds - 1e-8);
  return active;
}
function prepared() {
  const { actor, environment, plant } = fixture();
  const acquisition = paid(actor, environment, 'pull', plant.id);
  const material = actor.inventory.items[0];
  assert.ok(material);
  const sample = paid(actor, environment, 'sample', material);
  assert.ok(actor.lastResult.ingestionId);
  return { actor, environment, acquisition, sample, material };
}

test('only original paid personal acquisition and swallow open a bounded costed window', () => {
  const { actor, acquisition, sample } = prepared();
  const before = structuredClone(actor);
  assert.equal(beginOptionalSensoryWindow(structuredClone(actor), acquisition, sample), null);
  assert.equal(beginOptionalSensoryWindow(actor, structuredClone(acquisition), sample), null);
  assert.equal(beginOptionalSensoryWindow(actor, acquisition, structuredClone(sample)), null);
  const handle = beginOptionalSensoryWindow(actor, acquisition, sample);
  assert.ok(handle && Object.isFrozen(handle));
  assert.deepEqual(Object.keys(handle), []);
  const first = observeOptionalSensoryWindow(handle, actor);
  assert.equal(first.status, 'pending');
  assert.equal(first.targets, null);
  assert.ok(first.cost.paidActionSeconds > 0);
  assert.equal(first.cost.paidActionSeconds, first.cost.experiencedHandlingSeconds);
  assert.equal(first.cost.risingActions + first.cost.steadyActions, 2);
  assert.equal(first.cost.allInCost, 'unknown');
  assert.equal(JSON.stringify(first).includes('object:'), false);
  assert.equal(JSON.stringify(first).includes('ingestion:'), false);
  assert.equal(beginOptionalSensoryWindow(actor, acquisition, sample), null);
  assert.deepEqual(actor, before, 'starting and reading the shadow window cannot change the world actor');
});

test('real digestion window settles once from sensed categories, without changing learning or RNG', () => {
  const { actor, environment, acquisition, sample } = prepared();
  const untouched = structuredClone(actor), untouchedWorld = structuredClone(environment);
  const handle = beginOptionalSensoryWindow(actor, acquisition, sample);
  assert.ok(handle);
  let result, observationN = 0, observationNs = 0n;
  for (let i = 0; i < 1300 && result?.status !== 'complete'; i++) {
    tickNpc(actor, .1, environment);
    processDiscoveryFeedback(actor);
    tickNpc(untouched, .1, untouchedWorld);
    processDiscoveryFeedback(untouched);
    const started = process.hrtime.bigint();
    result = observeOptionalSensoryWindow(handle, actor);
    observationNs += process.hrtime.bigint() - started;
    observationN++;
  }
  assert.equal(result.status, 'complete');
  assert.equal(result.horizonSeconds, OPTIONAL_SENSORY_HORIZON_SECONDS);
  assert.deepEqual(Object.keys(result.targets).sort(),
    ['energyEased', 'hungerEased', 'painWorsened', 'thirstEased']);
  assert.ok(Object.values(result.targets).every(bit => bit === 0 || bit === 1));
  assert.deepEqual(observeOptionalSensoryWindow(handle, actor), result,
    'repeated reads do not extend a settled horizon');
  assert.deepEqual(actor, untouched);
  assert.deepEqual(environment, untouchedWorld);
  console.log('OPTIONAL_SENSORY_ENGINEERING', JSON.stringify({
    observationCalls: observationN,
    observationWallMs: Number(observationNs) / 1e6,
    targets: result.targets,
    cost: result.cost,
  }));
});

test('an early improvement never settles a positive episode before a later pain change', () => {
  const { actor, environment, acquisition, sample } = prepared();
  // Explicitly engineered body-category intervention to test temporal labels;
  // it is not a food effect, learner input, or ordinary trial.
  actor.physiology.satietyHours = 0;
  assert.notEqual(bodySignals(actor).hunger, 'content');
  const handle = beginOptionalSensoryWindow(actor, acquisition, sample);
  assert.ok(handle);
  tickNpc(actor, .1, environment);
  actor.physiology.satietyHours = 2.5;
  assert.equal(observeOptionalSensoryWindow(handle, actor).status, 'pending');
  for (let i = 0; i < 1299; i++) {
    tickNpc(actor, .1, environment);
    if (i === 80) actor.physiology.health = 80;
    const result = observeOptionalSensoryWindow(handle, actor);
    if (result.status === 'complete') {
      assert.equal(result.targets.hungerEased, 1);
      assert.equal(result.targets.painWorsened, 1);
      return;
    }
  }
  assert.fail('fixed horizon was not reached');
});

test('gaps, other actions, competing intake, cancellation and replacement censor rather than emit zero', () => {
  for (const reason of ['observation-gap', 'intervening-action',
    'competing-ingestion', 'identity-or-lifecycle', 'cancelled']) {
    const { actor, environment, acquisition, sample } = prepared();
    const handle = beginOptionalSensoryWindow(actor, acquisition, sample);
    assert.ok(handle);
    let result;
    if (reason === 'observation-gap') {
      for (let i = 0; i < 4; i++) tickNpc(actor, .1, environment);
      result = observeOptionalSensoryWindow(handle, actor);
    } else if (reason === 'intervening-action') {
      assert.equal(requestNpcAction(actor,
        { type: 'inspect_object', targetId: acquisition.request.targetId }, environment).code,
      'ACTION_STARTED');
      tickNpc(actor, .1, environment);
      result = observeOptionalSensoryWindow(handle, actor);
    } else if (reason === 'competing-ingestion') {
      tickNpc(actor, .1, environment);
      actor.physiology.stomach.push({ id: 'ingestion:unrelated' });
      result = observeOptionalSensoryWindow(handle, actor);
    } else if (reason === 'identity-or-lifecycle') {
      result = observeOptionalSensoryWindow(handle, structuredClone(actor));
    } else result = cancelOptionalSensoryWindow(handle);
    assert.equal(result.status, 'censored', reason);
    assert.equal(result.reason, reason);
    assert.equal(result.targets, null);
    assert.deepEqual(observeOptionalSensoryWindow(handle, actor), result);
  }
});

test('unpaid, copied, ambiguous and earlier competing meals cannot create a window', () => {
  const { actor, environment, acquisition, sample } = prepared();
  assert.equal(beginOptionalSensoryWindow(actor, null, sample), null);
  assert.equal(beginOptionalSensoryWindow(actor, acquisition, null), null);
  const previous = actor.physiology.stomach[0];
  actor.physiology.stomach.push({ ...previous, id: 'ingestion:older' });
  assert.equal(beginOptionalSensoryWindow(actor, acquisition, sample), null);
  actor.physiology.stomach.pop();
  const action = { type: 'inspect_object', targetId: acquisition.request.targetId };
  assert.equal(requestNpcAction(actor, action, environment).code, 'ACTION_STARTED');
  assert.equal(beginOptionalSensoryWindow(actor, acquisition, sample), null);
});

test('a delayed attachment cannot shift the predeclared post-swallow horizon', () => {
  const { actor, environment, acquisition, sample } = prepared();
  tickNpc(actor, .1, environment);
  assert.equal(beginOptionalSensoryWindow(actor, acquisition, sample), null);
});

test('outside events and lost event continuity are censored, not credited to food', () => {
  for (const event of ['CONTACT_INJURY', 'DEBUG_ASSIST', 'LOST_EVENT',
    'INJURY_COUNTER', 'OUTSIDE_ASSISTANCE']) {
    const { actor, environment, acquisition, sample } = prepared();
    const handle = beginOptionalSensoryWindow(actor, acquisition, sample);
    assert.ok(handle);
    tickNpc(actor, .1, environment);
    if (event === 'INJURY_COUNTER') actor.stats.injuries++;
    else if (event === 'OUTSIDE_ASSISTANCE') relievePhysiology(actor);
    else {
      recordEvent(actor, event === 'DEBUG_ASSIST' ? 'debug' : 'condition',
        { code: event, body: bodySignals(actor) });
      if (event === 'LOST_EVENT') actor.memory.experience.pop();
    }
    const result = observeOptionalSensoryWindow(handle, actor);
    assert.equal(result.status, 'censored', event);
    assert.equal(result.reason, event === 'LOST_EVENT' ? 'unretained-event' : 'unrelated-body-event');
    assert.equal(result.targets, null);
  }
});
