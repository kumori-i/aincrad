import test from 'node:test';
import assert from 'node:assert/strict';
import { freshState, canStand } from '../src/world.js';
import { DISCOVERY_RULES } from '../src/discovery-config.js';
import { requestNpcAction, tickNpc, observeNpc } from '../src/npc.js';
import { discoveryDecision, processDiscoveryFeedback } from '../src/discovery.js';
import { validateNpc } from '../src/npc-memory.js';
import { compactProofRetention } from '../src/proof-retention.js';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { loadOzarkSave, writeOzarkSave, OZARK_SAVE_KEY } from '../src/ozark-save.js';
import { bindOzarkWorldAgent } from '../src/ozark-agent-world.js';

function nearAppleTree() {
  const state = freshState(), actor = state.agents[0], environment = state.environment;
  const tree = environment.ecology.plants.find(row => row.kind === 'apple_tree' && row.quantity > 0);
  assert.ok(tree);
  actor.position = [
    { x: tree.position.x + 45, y: tree.position.y },
    { x: tree.position.x - 45, y: tree.position.y },
    { x: tree.position.x, y: tree.position.y + 45 },
    { x: tree.position.x, y: tree.position.y - 45 },
  ].find(point => canStand(point.x, point.y, 'valley'));
  assert.ok(actor.position);
  observeNpc(actor, environment);
  assert.ok(actor.discovery.observations[tree.id]);
  return { actor, environment, tree };
}

function paid(actor, environment, action) {
  assert.equal(requestNpcAction(actor, action, environment).code, 'ACTION_STARTED');
  for (let i = 0; i < 1000 && actor.active; i++) tickNpc(actor, 1 / 60, environment);
  assert.equal(actor.active, null);
  assert.equal(actor.lastResult?.ok, true);
}

test('a still-observed trial keeps genuine cumulative paid history across proof rollover and reopen', () => {
  const { actor, environment, tree } = nearAppleTree();
  for (let i = 0; i < 3; i++) paid(actor, environment, { type: 'inspect_object', targetId: tree.id });
  const key = `${tree.id}|inspect_object`;
  const [oldest] = actor.discovery.experiments.filter(row => row.targetId === tree.id && row.primitive === 'inspect_object');
  assert.equal(actor.discovery.trials[key].attempts, 3);
  // Emulate normal optional log rollover; the paid outcomes above were real.
  actor.discovery.experiments = actor.discovery.experiments.filter(row => row.id !== oldest.id);
  actor.memory.experience = actor.memory.experience.filter(row => row.id !== oldest.actionId);
  assert.equal(compactProofRetention(actor).ok, true);
  assert.equal(actor.discovery.experiments.filter(row => row.targetId === tree.id).length, 2);
  assert.equal(actor.discovery.trials[key].attempts, 3, 'retained firsthand sight keeps the optional cumulative summary');
  const reopened = validateNpc(structuredClone(actor));
  assert.deepEqual(reopened.discovery.trials[key], actor.discovery.trials[key]);
  assert.deepEqual(reopened.discovery.practice, actor.discovery.practice);
});

test('a retained receipt key displaced at the 768-key cap is restored before deterministic optional eviction', () => {
  const { actor } = nearAppleTree();
  // Unit-authored, bounded optional sightings isolate the dictionary policy;
  // the one proof key below has an exact linked action receipt and experiment.
  actor.discovery.observations = {};
  actor.discovery.trials = {};
  const trial = { attempts: 1, successes: 1, failures: 0, seconds: 1, lastAt: 0,
    lastCode: 'GRASPED', lastOk: true };
  for (let i = 0; i < DISCOVERY_RULES.maxObjects; i++) {
    const id = `object:${600000 + i}`;
    actor.discovery.observations[id] = { id, scene: 'valley', position: { ...actor.position }, appearance: {}, observedAt: 0 };
    for (const type of DISCOVERY_RULES.primitives) actor.discovery.trials[`${id}|${type}`] = { ...trial };
  }
  assert.equal(Object.keys(actor.discovery.trials).length, 768);
  const targetId = 'object:900001', actionId = actor.memory.nextId++, id = actor.discovery.nextId++;
  actor.memory.experience.push({ id: actionId, at: 0, type: 'action',
    details: { action: { type: 'inspect_object', targetId }, result: { ok: true, code: 'INSPECTED' } } });
  actor.discovery.experiments.push({ id, actionId, at: 0, primitive: 'inspect_object', targetId,
    ok: true, code: 'INSPECTED', durationSeconds: 1 });
  const evicted = 'object:600000|grasp';
  const rng = actor.rng, eventId = actor.memory.nextId, experimentId = actor.discovery.nextId;
  const plan = compactProofRetention(actor);
  assert.equal(plan.ok, true, plan.reason);
  assert.deepEqual(actor.discovery.trials[`${targetId}|inspect_object`], {
    attempts: 1, successes: 1, failures: 0, seconds: 1, lastAt: 0, lastCode: 'INSPECTED', lastOk: true,
  });
  assert.equal(actor.discovery.trials[evicted], undefined, 'lexically first optional tie is retired');
  assert.equal(Object.keys(actor.discovery.trials).length, 768);
  assert.equal(actor.discovery.observations['object:600000']?.id, 'object:600000', 'sight itself is not retired');
  assert.deepEqual([actor.rng, actor.memory.nextId, actor.discovery.nextId], [rng, eventId, experimentId]);
  const reopened = validateNpc(structuredClone(actor));
  assert.deepEqual(reopened.discovery.trials, actor.discovery.trials);
  assert.deepEqual(reopened.discovery.practice, actor.discovery.practice);
});

test('unit-authored revised veto stays sticky while real positive proof normalizes', () => {
  const { actor, environment, tree } = nearAppleTree();
  paid(actor, environment, { type: 'pull', targetId: tree.id });
  const materialId = actor.inventory.items.at(-1);
  assert.ok(materialId);
  actor.physiology.hoursSinceMeal = 12;
  actor.physiology.satietyHours = 0;
  paid(actor, environment, { type: 'sample', targetId: materialId });
  let technique;
  for (let i = 0; i < 7200 && !technique; i++) {
    tickNpc(actor, 1 / 60, environment);
    processDiscoveryFeedback(actor);
    technique = actor.discovery.techniques.find(row => row.sourceId === tree.id);
  }
  assert.ok(technique, 'real paid ingestion and delayed personal feedback created the tentative technique');
  // Unit-authored adverse status tests only the sticky veto during compaction;
  // this test does not purport to generate a second harmful bodily experience.
  technique.confidence = 'revised';
  technique.successes = 999;
  assert.equal(compactProofRetention(actor).ok, true);
  technique = actor.discovery.techniques.find(row => row.sourceId === tree.id);
  assert.equal(technique.confidence, 'revised');
  assert.equal(technique.successes, 1, 'aggregate claim is reduced to its one retained positive chain');
  const reopened = validateNpc(structuredClone(actor));
  assert.deepEqual(reopened.discovery.techniques.find(row => row.id === technique.id), technique);
});

test('normalization does not change the next optional decision or RNG on reopen', () => {
  const { actor, environment, tree } = nearAppleTree();
  paid(actor, environment, { type: 'inspect_object', targetId: tree.id });
  const key = `${tree.id}|inspect_object`;
  delete actor.discovery.observations[tree.id];
  assert.equal(compactProofRetention(actor).ok, true);
  assert.equal(actor.discovery.trials[key]?.attempts, 1);
  const reopened = validateNpc(structuredClone(actor));
  const live = structuredClone(actor);
  const actionA = discoveryDecision(live), actionB = discoveryDecision(reopened);
  assert.deepEqual(actionB, actionA);
  assert.equal(reopened.rng, live.rng);
  assert.notEqual(live.rng, actor.rng, 'the comparison includes an actual optional random draw');
  assert.deepEqual(reopened.discovery.trials, live.discovery.trials);
  assert.deepEqual(reopened.discovery.techniques, live.discovery.techniques);
});

test('current Ozark save keeps the reconciled paid trial after occupied-disk reopen', () => {
  const bytes = new Map();
  const storage = { getItem: key => bytes.get(key) ?? null,
    setItem: (key, value) => bytes.set(key, value) };
  const geometry = createOzarkWorldGeometry();
  const state = loadOzarkSave(storage, geometry, { communicationSeed: 211 }).state;
  const actor = state.agents[0];
  for (const npc of state.agents) bindOzarkWorldAgent(npc, geometry, state);
  const source = state.environment.ecology.plants.find(plant =>
    plant.id === 'object:674' && Math.hypot(plant.position.x - actor.position.x,
      plant.position.y - actor.position.y) < DISCOVERY_RULES.reach);
  assert.ok(source, 'declared seed and spawn provide one reachable existing plant');
  observeNpc(actor, state.environment);
  const tick = () => {
    state.elapsed += 1 / 60;
    state.environment.elapsed = state.environment.ecology.elapsed = state.elapsed;
    for (const npc of state.agents) tickNpc(npc, 1 / 60, state.environment);
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.equal(requestNpcAction(actor, { type: 'inspect_object', targetId: source.id },
      state.environment).code, 'ACTION_STARTED');
    for (let i = 0; i < 300 && actor.active; i++) tick();
    assert.equal(actor.active, null);
    assert.equal(actor.lastResult?.ok, true);
  }
  const key = `${source.id}|inspect_object`, first = actor.discovery.experiments.find(row =>
    row.targetId === source.id && row.primitive === 'inspect_object');
  assert.equal(actor.discovery.trials[key].attempts, 2);
  // An authored FIFO rollover removes the oldest optional receipt, not the
  // actual paid action or source from the original physical history.
  delete actor.discovery.observations[source.id];
  actor.discovery.experiments = actor.discovery.experiments.filter(row => row.id !== first.id);
  actor.memory.experience = actor.memory.experience.filter(row => row.id !== first.actionId);
  assert.equal(compactProofRetention(actor).ok, true);
  assert.equal(actor.discovery.trials[key].attempts, 1);
  assert.equal(writeOzarkSave(storage, state, geometry), true);
  assert.equal(typeof bytes.get(OZARK_SAVE_KEY), 'string');
  const opened = loadOzarkSave(storage, geometry);
  assert.equal(opened.blocked, false, opened.error);
  assert.deepEqual(opened.state.agents[0].discovery.trials[key], actor.discovery.trials[key]);
  assert.deepEqual(opened.state.agents[0].discovery.practice, actor.discovery.practice);
});
