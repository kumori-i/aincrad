import test from 'node:test';
import assert from 'node:assert/strict';
import { createOzarkState } from '../src/ozark-save.js';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { bindOzarkWorldAgent } from '../src/ozark-agent-world.js';
import { requestNpcAction, tickNpc, observeNpc } from '../src/npc.js';
import { discoveryDecision, processDiscoveryFeedback, rememberDiscoveryObservation } from '../src/discovery.js';
import { cognitiveAction } from '../src/cognition.js';
import { projectPhysiology } from '../src/biology.js';
import { tickEnvironment } from '../src/environment.js';
import { CONFIG } from '../src/config.js';
import { NpcController } from '../src/controller.js';
import { foodRunSnapshot } from '../src/food-run-observer.js';

// Authored actor placements isolate a current-main Ozark decision seam; the
// sources, geometry, funded actions, ecology, digestion and learner are real.
function earnTrees(count = 1, { release = true } = {}) {
  const geometry = createOzarkWorldGeometry();
  const state = createOzarkState(geometry, { communicationSeed: 211 });
  const npc = state.agents[0], environment = state.environment;
  bindOzarkWorldAgent(npc, geometry, state);
  const trees = environment.ecology.plants.filter(p => p.kind === 'apple_tree' && p.quantity > 2 &&
    geometry.canOccupy(p.position.x + 45, p.position.y, CONFIG.playerRadius)).slice(0, count);
  assert.equal(trees.length, count);
  function tick() {
    tickEnvironment(environment, .1);
    state.elapsed = environment.elapsed;
    environment.ecology.elapsed = environment.elapsed;
    tickNpc(npc, .1, environment);
    processDiscoveryFeedback(npc);
  }
  function finish(action) {
    const start = requestNpcAction(npc, action, environment);
    assert.equal(start.code, 'ACTION_STARTED', `paid ${action.type} should be admitted`);
    for (let i = 0; i < 400 && npc.active; i++) tick();
    assert.equal(npc.active, null);
    return npc.lastResult;
  }
  const materials = [];
  for (const tree of trees) {
    npc.position = { x: tree.position.x + 45, y: tree.position.y };
    assert.ok(observeNpc(npc, environment).objects.some(o => o.id === tree.id), 'source personally visible');
    assert.equal(finish({ type: 'pull', targetId: tree.id }).ok, true);
    const material = npc.inventory.items.at(-1);
    assert.ok(material);
    const sample = finish({ type: 'sample', targetId: material });
    assert.equal(sample.ok, true);
    for (let i = 0; i < 1_000 && !npc.discovery.effects.some(e =>
      e.effect === 'sustained' && e.ingestionId === sample.ingestionId); i++) {
      tick();
    }
    assert.ok(npc.discovery.effects.some(e =>
      e.effect === 'sustained' && e.ingestionId === sample.ingestionId), 'own delayed feedback');
    assert.ok(npc.discovery.techniques.some(t => t.sourceId === tree.id), 'own earned technique');
    materials.push(material);
    if (release) assert.equal(finish({ type: 'release', targetId: material }).ok, true);
  }
  return { npc, environment, trees, materials, tick, finish };
}
function hungry(npc) {
  npc.physiology.hoursSinceMeal = 20;
  npc.physiology.satietyHours = 0;
  npc.physiology.waterDeficitMl = 0;
  projectPhysiology(npc);
}
function runFor(npc, sourceId, cursor = 0, materialId = null) {
  const technique = npc.discovery.techniques.find(t => t.sourceId === sourceId);
  assert.ok(technique);
  npc.discovery.run = { techniqueId: technique.id, cursor, materialId,
    awaiting: false, startedAt: npc.elapsed };
  return technique;
}
function evictFirstSource(npc, lost, available) {
  // Neutral fixture rows exercise the bounded visual ledger only. They are
  // neither physical resources nor earned food/technique evidence.
  rememberDiscoveryObservation(npc, Array.from({ length: 125 }, (_, i) => ({
    id: `object:${9_000 + i}`, scene: 'valley', position: { x: npc.position.x + i, y: npc.position.y },
    appearance: { shape: 'small', color: 'brown' },
  })));
  assert.equal(Object.keys(npc.discovery.observations).length, 128);
  assert.equal(npc.discovery.observations[lost], undefined);
  assert.ok(npc.discovery.observations[available]);
}

test('lost personal source observation retires a food run and leaves another earned source available', () => {
  const { npc, environment, trees, tick } = earnTrees(2);
  const [lost, available] = trees.map(t => t.id);
  const lostTechnique = runFor(npc, lost);
  evictFirstSource(npc, lost, available);
  assert.ok(npc.discovery.techniques.some(t => t.id === lostTechnique.id), 'technique proof remains');
  hungry(npc);

  const decision = discoveryDecision(npc);
  assert.deepEqual(decision.action, { type: 'pull', targetId: available },
    'a stale run must not request an object absent from its own retained view');
  assert.notEqual(npc.discovery.run?.techniqueId, lostTechnique.id);
  const observed = foodRunSnapshot(npc);
  assert.equal(observed.runEnds.unavailable, 1, 'the lost run has a terminal observer record');
  assert.equal(observed.stages.acquisition.reach.unknown, 0, 'no unknown-source action was selected');
  assert.ok(cognitiveAction(npc, decision.action), 'the ordinary action normalizer can admit the alternative');
  const controller = new NpcController(npc, { environment, deferInitialObservation: true });
  try {
    const beforeCost = npc.physiology.totals.metabolizedKcal;
    assert.equal(controller.perform(decision.action).code, 'ACTION_STARTED');
    for (let i = 0; i < 400 && npc.active; i++) tick();
    assert.equal(npc.lastResult.ok, true, 'the alternative pays for its own physical acquisition');
    assert.equal(npc.lastResult.eventId > 0, true);
    assert.ok(npc.lastResult.durationSeconds > 0);
    assert.ok(npc.physiology.totals.metabolizedKcal > beforeCost);
  } finally { controller.dispose(); }
});

test('a recent physical rejection cannot keep a run alive after its source observation is lost', () => {
  const { npc, environment, trees } = earnTrees(2);
  const [lost, available] = trees.map(t => t.id);
  // This real engine rejection supplies a recent per-source failed trial. The
  // authored run below isolates ordering of that trial and visual-memory loss.
  const rejection = requestNpcAction(npc, { type: 'pull', targetId: lost }, environment);
  assert.equal(rejection.ok, false);
  assert.equal(rejection.code, 'OUT_OF_REACH');
  assert.equal(npc.active, null);
  assert.equal(npc.discovery.trials[`${lost}|pull`].lastOk, false);
  const stale = runFor(npc, lost);
  evictFirstSource(npc, lost, available);
  hungry(npc);

  const decision = discoveryDecision(npc);
  assert.deepEqual(decision.action, { type: 'pull', targetId: available });
  assert.notEqual(npc.discovery.run?.techniqueId, stale.id);
  assert.equal(foodRunSnapshot(npc).runEnds.unavailable, 1);
  assert.equal(foodRunSnapshot(npc).stages.acquisition.reach.unknown, 0);
});

test('an observed source still admits its earned paid step without changing the decision', () => {
  const { npc, trees } = earnTrees();
  const source = trees[0].id;
  runFor(npc, source);
  hungry(npc);
  const beforeRng = npc.rng;
  const decision = discoveryDecision(npc);
  assert.deepEqual(decision.action, { type: 'pull', targetId: source });
  assert.ok(cognitiveAction(npc, decision.action));
  assert.equal(npc.discovery.run.awaiting, true);
  assert.equal(npc.rng, beforeRng, 'ordinary earned reuse draws no extra curiosity RNG');
});

test('a physically held material remains a valid learned next step if its visual row is missing', () => {
  const { npc, trees, materials, finish } = earnTrees(1, { release: false });
  const material = materials[0];
  runFor(npc, trees[0].id, 1, material);
  delete npc.discovery.observations[material];
  npc.physiology.hoursSinceMeal = 2;
  npc.physiology.satietyHours = 4;
  npc.physiology.waterDeficitMl = 0;
  projectPhysiology(npc);
  const decision = discoveryDecision(npc);
  assert.deepEqual(decision.action, { type: 'sample', targetId: material });
  assert.ok(cognitiveAction(npc, decision.action), 'held identity is enough to normalize this step');
  assert.equal(finish(decision.action).code, 'SWALLOWED');
});

test('urgent bodily care keeps precedence over an unresolved source observation', () => {
  const { npc, trees } = earnTrees();
  runFor(npc, trees[0].id);
  delete npc.discovery.observations[trees[0].id];
  npc.physiology.waterDeficitMl = 3_000;
  projectPhysiology(npc);
  const decision = discoveryDecision(npc);
  assert.equal(decision.need, 'water', 'felt thirst retains care priority with an empty flask');
  assert.equal(npc.discovery.run?.awaiting ?? false, false);
});
