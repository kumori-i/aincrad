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
import { successfulDiscoveryActionCompletion } from '../src/discovery-actions.js';

const near = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} differs from ${expected}`);

// One authored engineering continuation, not a scientific cohort or native
// desktop persistence test. At this checkpoint the fruit was actually released.
// A held-item sample would prove less: here a fresh paid grasp is required too.
// Reopen only restores/binds the saved actors and advances normal population
// ticks. It injects no body state, inventory, memories, choices or actions.
function verifyReopenedFruitReuse(storage, geometry, id, oldSample) {
  const opened = loadOzarkSave(storage, geometry);
  assert.equal(opened.blocked, false, opened.error);
  const state = opened.state, npc = state.agents[1], ecology = state.environment.ecology;
  for (const actor of state.agents) bindOzarkWorldAgent(actor, geometry, state);
  assert.equal(npc.active, null);
  assert.equal(npc.discovery.run, null, 'A saved active procedure is not resumed');
  const fruit = lookupEcologyObject(ecology, id);
  assert.equal(fruit.heldBy, null);
  assert.equal(npc.inventory.items.includes(id), false);
  assert.ok(fruit.massGrams > DISCOVERY_RULES.sampleGrams);
  const snapshot = actor => structuredClone({position: actor.position,
    elapsed: actor.elapsed, discovery: actor.discovery, physiology: actor.physiology,
    inventory: actor.inventory, nextReceiptId: actor.memory.nextId});
  const baseline = snapshot(npc), firstNewReceiptId = npc.memory.nextId;
  const before = {elapsed: state.elapsed, mass: fruit.massGrams,
    energy: fruit.energyKcal, removed: ecology.ledger.humanRemovedKcal};
  const choices = [], actions = [];
  const population = new PopulationRuntime(state, {cardinal: false,
    experimentalDiscovery: {
      decision: (actor, result) => {
        if (actor === npc) choices.push({action: structuredClone(result.action),
          reason: result.reason});
      },
      performed: (actor, action, result, active) => {
        if (actor === npc && active) actions.push({active, choice: choices.at(-1)});
      },
    }});
  let ticks = 0, grasp = null, sample = null, feedback = null, depletion = null;
  try {
    // No-time control: construction and zero time cannot fabricate a new trial.
    population.tick(0);
    assert.deepEqual(snapshot(npc), baseline);
    assert.deepEqual({elapsed: state.elapsed, mass: fruit.massGrams,
      energy: fruit.energyKcal, removed: ecology.ledger.humanRemovedKcal}, before);
    assert.deepEqual(choices, []);
    const fresh = row => row.targetId === id && row.ok &&
      row.actionId >= firstNewReceiptId && row.at > baseline.elapsed;
    // Predeclared bound: 180 simulation seconds, as in the original lesson.
    for (; ticks < 1800;) {
      const prior = {mass: fruit.massGrams, energy: fruit.energyKcal,
        ingested: npc.physiology.totals.ingestedKcal,
        removed: ecology.ledger.humanRemovedKcal};
      state.elapsed += .1;
      population.tick(.1);
      ticks++;
      if (!grasp) {
        grasp = npc.discovery.experiments.find(row => fresh(row) && row.primitive === 'grasp');
        if (grasp) {
          assert.equal(fruit.heldBy, npc.id);
          assert.ok(npc.inventory.items.includes(id));
        }
      }
      if (!sample) {
        sample = npc.discovery.experiments.find(row => fresh(row) && row.primitive === 'sample');
        if (sample) {
          assert.ok(grasp && grasp.actionId < sample.actionId && grasp.at < sample.at);
          assert.equal(fruit.heldBy, npc.id);
          assert.ok(npc.inventory.items.includes(id));
          depletion = {mass: prior.mass - fruit.massGrams,
            energy: prior.energy - fruit.energyKcal,
            expectedEnergy: prior.energy * DISCOVERY_RULES.sampleGrams / prior.mass,
            ingested: npc.physiology.totals.ingestedKcal - prior.ingested,
            removed: ecology.ledger.humanRemovedKcal - prior.removed};
          assert.equal(npc.discovery.effects.some(effect =>
            effect.ingestionId === sample.ingestionId), false,
          'A new physical swallow still precedes its own delayed feedback');
        }
      }
      if (sample) {
        feedback = npc.discovery.effects.find(effect => effect.effect === 'sustained' &&
          effect.source === 'experienced' && effect.objectId === id &&
          effect.actionId === sample.actionId && effect.ingestionId === sample.ingestionId);
        if (feedback) break;
      }
    }
    assert.ok(sample, 'The ordinary reopened runtime must finish a new grasp and sample');
    assert.notEqual(sample.actionId, oldSample.actionId);
    assert.notEqual(sample.ingestionId, oldSample.ingestionId);
    for (const trial of [grasp, sample]) {
      const receipt = npc.memory.experience.find(event => event.id === trial.actionId);
      assert.equal(receipt.type, 'action');
      assert.equal(receipt.at, trial.at);
      assert.equal(receipt.details.action.type, trial.primitive);
      assert.equal(receipt.details.action.targetId, id);
      assert.equal(receipt.details.result.ok, true);
      assert.equal(receipt.details.result.durationSeconds, trial.durationSeconds);
      if (trial === sample) assert.equal(receipt.details.result.ingestionId, sample.ingestionId);
      const certified = actions.map(row => ({...row,
        proof: successfulDiscoveryActionCompletion(npc, row.active)}))
        .find(row => row.proof?.eventId === trial.actionId);
      assert.ok(certified, `${trial.primitive} needs a fresh runtime-only paid-work witness`);
      near(certified.proof.worked, trial.durationSeconds);
      assert.ok(certified.proof.worked > 0);
      assert.deepEqual(certified.choice.action, {type: trial.primitive, targetId: id});
      assert.equal(certified.choice.reason,
        'I am repeating an operation sequence supported by my own bodily feedback.');
    }
    near(depletion.mass, DISCOVERY_RULES.sampleGrams);
    assert.ok(depletion.energy > 0);
    near(depletion.energy, depletion.expectedEnergy);
    near(depletion.ingested, depletion.energy);
    near(depletion.removed, depletion.energy);
    assert.ok(feedback && feedback.at > sample.at,
      'The new receipt must earn its own later benefit, not reuse the old effect');
    const recognition = npc.memory.experience.find(row => row.id === feedback.proofEventId);
    assert.equal(recognition.type, 'condition');
    assert.ok(recognition.at >= feedback.at);
    assert.equal(recognition.details.code, 'DISCOVERY_EFFECT');
    assert.equal(recognition.details.feedback.objectId, id);
    assert.equal(recognition.details.feedback.effect, 'sustained');
    assert.equal(recognition.details.feedback.actionId, sample.actionId);
    assert.equal(recognition.details.feedback.ingestionId, sample.ingestionId);
  } finally {population.dispose();}

  // Same-save mechanism control: retain all real memories, body and ownership.
  // Disabling food learning disables its policy use, not curiosity or digestion.
  // Run the same bounded duration; do not assert that no action of any kind occurs.
  const control = loadOzarkSave(storage, geometry);
  assert.equal(control.blocked, false, control.error);
  const controlNpc = control.state.agents[1], controlChoices = [];
  for (const actor of control.state.agents) bindOzarkWorldAgent(actor, geometry, control.state);
  assert.deepEqual(snapshot(controlNpc), baseline);
  const controlPopulation = new PopulationRuntime(control.state, {cardinal: false,
    discoveryFoodLearning: false,
    experimentalDiscovery: {decision: (actor, result) => {
      if (actor === controlNpc) controlChoices.push(structuredClone(result));
    }}});
  try {
    for (let i = 0; i < ticks; i++) {
      control.state.elapsed += .1;
      controlPopulation.tick(.1);
    }
    assert.ok(controlChoices.length > 0, 'The control runtime actually makes decisions');
    assert.equal(controlChoices.some(choice => choice.reason ===
      'I am repeating an operation sequence supported by my own bodily feedback.'), false);
    const controlTrials = controlNpc.discovery.experiments.filter(row =>
      row.targetId === id && row.at > baseline.elapsed && row.actionId >= firstNewReceiptId);
    assert.deepEqual(controlTrials, [],
      'This same-save control does not retry the exact fruit during the matched window');
    return {sourceId: id, reopenedAt: baseline.elapsed, elapsedSeconds: ticks * .1,
      oldSample, grasp, sample, feedback, depletion,
      controlDecisions: controlChoices.length, controlExactFruitTrials: controlTrials.length};
  } finally {controlPopulation.dispose();}
}

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

test('visible player eating supports own learning and autonomous fruit reuse after reopen; occluded eating cannot create its inquiry', t => {
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
        const savedFruit = lookupEcologyObject(f.ecology, id);
        assert.equal(savedFruit.heldBy, null,
          'The ordinary controller released the fruit before delayed support arrived');
        assert.equal(f.mira.inventory.items.includes(id), false);
        assert.ok(f.mira.discovery.experiments.some(row => row.primitive === 'release' &&
          row.targetId === id && row.ok && row.at > ownSample.at),
        'The unheld checkpoint must follow a real personal release');
        assert.equal(writeOzarkSave(storage, f.state, f.geometry), true);
        assert.ok(data.get(OZARK_SAVE_KEY));
        const reopened = loadOzarkSave(storage, f.geometry);
        assert.equal(reopened.blocked, false, reopened.error);
        assert.deepEqual(lookupEcologyObject(reopened.state.environment.ecology, id), savedFruit,
          'Reopen preserves the actual fruit, including its unheld ownership and remaining stock');
        assert.deepEqual(reopened.state.agents[1].discovery.techniques.find(t => t.sourceId === id),
          original, 'The personally earned exact-source proof survives reopening');
        t.diagnostic(`Reopened exact-fruit reuse: ${JSON.stringify(
          verifyReopenedFruitReuse(storage, f.geometry, id, ownSample))}`);
      }
    } finally {f.dispose();}
  }
});
