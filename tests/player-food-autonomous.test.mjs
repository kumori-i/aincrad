import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, NPC_RULES } from '../src/config.js';
import { DISCOVERY_RULES } from '../src/discovery-config.js';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { createOzarkState, loadOzarkSave, writeOzarkSave, OZARK_SAVE_KEY } from '../src/ozark-save.js';
import { bindOzarkWorldAgent } from '../src/ozark-agent-world.js';
import { createPlayerFoodController } from '../src/player-food.js';
import { PopulationRuntime } from '../src/population.js';
import { tickNpc } from '../src/npc.js';
import { observationalInquiries } from '../src/observational-learning.js';
import { lookupEcologyObject } from '../src/ecology.js';

const near = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} differs from ${expected}`);

// The authored opening keeps policies still only during the short player
// lesson. After release, PopulationRuntime owns every NPC decision and action.
// No controller action is issued, and no food knowledge is inserted.
function lesson({occluded}) {
  const base = createOzarkWorldGeometry();
  let sight = true;
  const geometry = Object.freeze({ ...base,
    lineOfSight: (from, to) => sight && base.lineOfSight(from, to) });
  const state = createOzarkState(geometry, {communicationSeed: 211});
  const ecology = state.environment.ecology;
  const [aster, mira] = state.agents;
  let plant, point;
  for (const candidate of ecology.plants.filter(row => row.kind === 'apple_tree' &&
    row.quantity > 2 && row.stage === 'ripe').sort((a, b) =>
    Math.hypot(a.position.x - 276, a.position.y - 760) -
    Math.hypot(b.position.x - 276, b.position.y - 760))) {
    point = Array.from({length: 16}, (_, i) => ({
      x: candidate.position.x + 48 * Math.cos(i * Math.PI / 8),
      y: candidate.position.y + 48 * Math.sin(i * Math.PI / 8),
    })).find(p => geometry.canOccupy(p.x, p.y, CONFIG.playerRadius) &&
      geometry.lineOfSight(p, candidate.position));
    if (point) { plant = candidate; break; }
  }
  assert.ok(plant, 'The declared seed must have one reachable ripe apple tree');
  state.player = {...point};
  state.elapsed = state.environment.elapsed = ecology.elapsed = 60;
  for (const npc of state.agents) {
    npc.elapsed = 60;
    npc.position = {...point};
    bindOzarkWorldAgent(npc, geometry, state);
    assert.equal(npc.active, null);
    assert.deepEqual(npc.discovery.inquiries, []);
    assert.deepEqual(npc.discovery.experiments, []);
    assert.deepEqual(npc.discovery.effects, []);
    assert.deepEqual(npc.discovery.techniques, []);
    assert.deepEqual(npc.inventory.items, []);
  }
  const decisions = [];
  const population = new PopulationRuntime(state, {cardinal: false,
    experimentalDiscovery: {decision: (npc, result) => {
      if (npc === mira) decisions.push({action: structuredClone(result.action),
        reason: result.reason});
    }}});
  const player = createPlayerFoodController(state, geometry);
  const dt = .1;
  const stagedStep = () => {
    state.elapsed += dt;
    state.environment.elapsed = ecology.elapsed = state.elapsed;
    const result = player.tick(dt);
    for (const npc of state.agents) tickNpc(npc, dt, state.environment);
    return result;
  };
  const finish = (type, id) => {
    assert.equal(player.start(type, id).code, 'ACTION_STARTED');
    for (let i = 0; i < 120; i++) {
      const result = stagedStep();
      if (result) {
        assert.equal(result.ok, true, `${type}: ${result.code}`);
        assert.ok(result.durationSeconds > 0 && result.paidKcal > 0);
        return result;
      }
    }
    assert.fail(`${type} did not complete`);
  };
  return {state,ecology,geometry,aster,mira,plant,player,population,finish,decisions,
    setSight: value => {sight = value;},
    tickAutonomous: () => {state.elapsed += dt;player.tick(dt);population.tick(dt);},
    dispose: () => {player.dispose();population.dispose();}};
}

test('visible player eating can lead to an autonomous paid own trial; occluded eating cannot create its inquiry', () => {
  let visiblePhysical = null;
  for (const occluded of [false, true]) {
    const f = lesson({occluded});
    try {
      const stock = f.plant.quantity;
      const pulled = f.finish('pull', f.plant.id);
      assert.equal(f.plant.quantity, stock - 1);
      const id = pulled.materialId;
      const held = lookupEcologyObject(f.ecology, id);
      assert.ok(held && held.heldBy === 'player');
      const before = {mass: held.massGrams, energy: held.energyKcal,
        ingested: f.state.playerFood.physiology.totals.ingestedKcal,
        removed: f.ecology.ledger.humanRemovedKcal};
      assert.ok(before.mass > DISCOVERY_RULES.sampleGrams);
      f.setSight(!occluded);
      const sampled = f.finish('sample', id);
      assert.ok(sampled.ingestionId);
      f.setSight(true);
      const remainder = lookupEcologyObject(f.ecology, id);
      assert.equal(remainder, held, 'Sampling preserves the exact remaining portion');
      near(remainder.massGrams, before.mass - DISCOVERY_RULES.sampleGrams);
      near(remainder.energyKcal,
        before.energy * (1 - DISCOVERY_RULES.sampleGrams / before.mass));
      const swallowed = before.energy - remainder.energyKcal;
      near(f.state.playerFood.physiology.totals.ingestedKcal - before.ingested, swallowed);
      near(f.ecology.ledger.humanRemovedKcal - before.removed, swallowed);
      const retained = {mass: remainder.massGrams, energy: remainder.energyKcal};
      f.finish('release', id);
      assert.equal(remainder.heldBy, null);
      assert.equal(f.state.playerFood.inventory.items.length, 0);
      near(remainder.massGrams, retained.mass);
      near(remainder.energyKcal, retained.energy);
      const physical = {plantQuantity: f.plant.quantity,
        remainderMass: remainder.massGrams, remainderEnergy: remainder.energyKcal,
        playerIngested: f.state.playerFood.physiology.totals.ingestedKcal};
      if (visiblePhysical) assert.deepEqual(physical, visiblePhysical);
      else visiblePhysical = physical;
      const initial = observationalInquiries(f.mira).filter(q => q.actorId === 'player');
      assert.equal(initial.length, occluded ? 0 : 1);
      if (!occluded) {
        assert.equal(initial[0].sourceId, id);
        assert.equal(initial[0].status, 'uncertain');
        assert.deepEqual(initial[0].ownAttempts, []);
      }

      f.state.player = {...f.geometry.spawn};
      f.tickAutonomous();
      assert.equal(f.decisions.length, 1);
      if (occluded) {
        assert.ok(!f.decisions[0].reason.startsWith('I saw another body consume from this exact source.'));
      } else {
        assert.ok(f.decisions[0].reason.startsWith('I saw another body consume from this exact source.'));
        assert.deepEqual(f.decisions[0].action, {type: 'grasp', targetId: id});
        assert.equal(f.mira.active?.request?.type, 'grasp');
        assert.equal(f.mira.active?.request?.targetId, id);
      }
      let sampleBeforeFeedback = false;
      for (let i = 1; i < 1800; i++) {
        f.tickAutonomous();
        if (!occluded && !sampleBeforeFeedback) {
          const pending = observationalInquiries(f.mira).find(q =>
            q.actorId === 'player' && q.sourceId === id);
          if (pending?.ownAttempts.some(row => row.primitive === 'sample' && row.ok)) {
            assert.equal(pending.status, 'waiting');
            assert.deepEqual(pending.ownEffects, [],
              'The physical swallow precedes delayed personal feedback');
            assert.equal(f.mira.discovery.techniques.some(t => t.sourceId === id), false,
              'Seeing the player and swallowing is not yet personal benefit proof');
            sampleBeforeFeedback = true;
          }
        }
        if (!occluded && observationalInquiries(f.mira).some(q =>
          q.actorId === 'player' && q.sourceId === id && q.status === 'supported')) break;
      }
      const own = observationalInquiries(f.mira).find(q =>
        q.actorId === 'player' && q.sourceId === id);
      if (occluded) {
        assert.equal(own, undefined, 'Later sight cannot replay an unseen swallow');
      } else {
        assert.equal(sampleBeforeFeedback, true);
        assert.equal(own.status, 'supported');
        for (const primitive of ['grasp', 'sample']) {
          const paid = own.ownAttempts.find(row => row.primitive === primitive && row.ok);
          assert.ok(paid, `Autonomous ${primitive} must be the agent's own trial`);
          assert.ok(paid.durationSeconds > 0);
          assert.equal(paid.targetId, id);
        }
        assert.ok(f.decisions.some(row =>
          row.action.type === 'sample' && row.action.targetId === id),
        'The ordinary controller must choose the agent sample too');
        const ownSample = own.ownAttempts.find(row => row.primitive === 'sample' && row.ok);
        assert.ok(own.ownEffects.some(row =>
          row.effect === 'sustained' && row.source === 'experienced' &&
          row.actionId === ownSample.actionId && row.ingestionId === ownSample.ingestionId &&
          row.at > ownSample.at));
        const original = f.mira.discovery.techniques.find(t => t.sourceId === id);
        assert.ok(original, 'Own delayed benefit creates an exact-source technique');
        assert.deepEqual(original.steps, [
          {type: 'grasp', targetId: '$source'},
          {type: 'sample', targetId: '$material'},
        ]);

        // A second personally seen tree with matching supplied appearance
        // does not turn the detached-fruit lesson into a tree pull procedure.
        const other = f.ecology.plants.find(plant => plant.id !== f.plant.id &&
          plant.kind === 'apple_tree' && plant.stage === 'ripe' && plant.quantity > 2 &&
          Math.hypot(plant.position.x - f.plant.position.x,
            plant.position.y - f.plant.position.y) < NPC_RULES.visionRadius);
        assert.ok(other, 'The controlled world contains another nearby ripe apple tree');
        const firstView = f.mira.discovery.observations[f.plant.id];
        const otherView = f.mira.discovery.observations[other.id];
        assert.ok(firstView && otherView,
          'Both distinct trees entered the agent’s ordinary personal observation ledger');
        assert.deepEqual(Object.fromEntries(['shape', 'color', 'texture'].map(key =>
          [key, firstView.appearance[key]])),
        Object.fromEntries(['shape', 'color', 'texture'].map(key =>
          [key, otherView.appearance[key]])),
        'Matching supplied appearance cues do not link a detached-fruit bite to a tree pull');
        assert.equal(f.mira.discovery.techniques.some(t => t.sourceId === f.plant.id ||
          t.sourceId === other.id), false);

        const data = new Map();
        const storage = {getItem: key => data.get(key) ?? null,
          setItem: (key, value) => data.set(key, value)};
        assert.equal(writeOzarkSave(storage, f.state, f.geometry), true);
        assert.ok(data.get(OZARK_SAVE_KEY));
        const reopened = loadOzarkSave(storage, f.geometry);
        assert.equal(reopened.blocked, false, reopened.error);
        assert.deepEqual(reopened.state.agents[1].discovery.techniques.find(t => t.sourceId === id),
          original, 'The personally earned exact-source proof survives reopening');
      }
    } finally {f.dispose();}
  }
});
