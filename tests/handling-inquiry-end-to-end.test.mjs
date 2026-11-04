import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { DISCOVERY_RULES } from '../src/discovery-config.js';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { createOzarkState } from '../src/ozark-save.js';
import { bindOzarkWorldAgent } from '../src/ozark-agent-world.js';
import { observeNpc, requestNpcAction, tickNpc } from '../src/npc.js';
import { discoveryDecision, freshMethodAppearance, processDiscoveryFeedback } from '../src/discovery.js';
import { HANDLING_QUESTION } from '../src/handling-inquiry.js';
import { priorAdverseSource } from '../src/observational-learning.js';
import { PopulationRuntime } from '../src/population.js';
import { lookupEcologyObject } from '../src/ecology.js';

const baseGeometry = createOzarkWorldGeometry();
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7,
  `${actual} differs from ${expected}`);

// Authored engineering encounter, not autonomous travel or a world cohort.
// Test setup uses object kinds to choose two existing plants; no kind or food
// label is copied into an agent's memory or used by its decision policy.
function sources(state) {
  const plants = state.environment.ecology.plants.filter(plant =>
    plant.kind === 'apple_tree' && plant.quantity > 2);
  for (const first of plants) for (const second of plants) {
    const separation = Math.hypot(first.position.x - second.position.x,
      first.position.y - second.position.y);
    const firstPoint = {x: first.position.x + 45, y: first.position.y};
    const secondPoint = {x: second.position.x + 45, y: second.position.y};
    if (separation > 120 && separation < 260 &&
        [firstPoint, secondPoint].every(point =>
          baseGeometry.canOccupy(point.x, point.y, CONFIG.playerRadius)) &&
        baseGeometry.lineOfSight(firstPoint, first.position) &&
        baseGeometry.lineOfSight(secondPoint, first.position) &&
        baseGeometry.lineOfSight(secondPoint, second.position)) {
      return {first, second, firstPoint, secondPoint};
    }
  }
  assert.fail('The declared physical world has no qualifying two-source encounter');
}

function encounter({priorPull = true, harmful = false} = {}) {
  let sight = true;
  const geometry = Object.freeze({...baseGeometry,
    lineOfSight: (...args) => sight && baseGeometry.lineOfSight(...args)});
  const state = createOzarkState(geometry, {communicationSeed: 211});
  const ecology = state.environment.ecology;
  const [actor] = state.agents;
  const {first, second, firstPoint, secondPoint} = sources(state);
  state.elapsed = state.environment.elapsed = ecology.elapsed = 60;
  for (const npc of state.agents) {
    npc.elapsed = 60;
    bindOzarkWorldAgent(npc, geometry, state);
  }
  const step = () => {
    state.elapsed += .1;
    state.environment.elapsed = ecology.elapsed = state.elapsed;
    for (const npc of state.agents) tickNpc(npc, .1, state.environment);
  };
  const pay = (action) => {
    const admission = requestNpcAction(actor, action, state.environment);
    assert.equal(admission.code, 'ACTION_STARTED', JSON.stringify(action));
    for (let i = 0; actor.active && i < 120; i++) step();
    assert.equal(actor.active, null, `${action.type} did not finish`);
    return actor.lastResult;
  };
  actor.position = {...firstPoint};
  observeNpc(actor, state.environment);
  let firstMaterial = null;
  if (priorPull) {
    const pulled = pay({type: 'pull', targetId: first.id});
    assert.equal(pulled.code, 'piece_detached');
    firstMaterial = pulled.materialId;
    if (harmful) {
      const fruit = lookupEcologyObject(ecology, firstMaterial);
      // An explicitly engineered hazardous portion. The actor receives no
      // toxicity field or safety label; only its own paid delayed sensation.
      fruit.toxicity = .6;
      fruit.spoiled = true;
      assert.equal(pay({type: 'sample', targetId: firstMaterial}).code, 'SWALLOWED');
      for (let i = 0; i < 300; i++) step();
      processDiscoveryFeedback(actor);
      assert.ok(actor.discovery.effects.some(effect =>
        effect.objectId === firstMaterial && effect.effect === 'discomfort' &&
        effect.source === 'experienced'),
      `The adverse control needs real delayed feedback: ${JSON.stringify({
        feedback: actor.physiology.feedback, effects: actor.discovery.effects,
        stomach: actor.physiology.stomach,
      })}`);
    }
    assert.equal(pay({type: 'release', targetId: firstMaterial}).code,
      'object_released');
  }
  actor.position = {...secondPoint};
  observeNpc(actor, state.environment);
  assert.ok(freshMethodAppearance(actor, second.id));
  if (priorPull) assert.ok(freshMethodAppearance(actor, first.id));
  assert.equal(pay({type: 'grasp', targetId: second.id}).code,
    'object_still_attached');
  return {state, actor, ecology, first, second, firstMaterial,
    setSight(value) { sight = value; }};
}

test('own handling contrast leads to one ordinary paid cross-source pull, then only independently chosen sampling can teach food', t => {
  const scene = encounter();
  const {state, actor, ecology, second} = scene;
  const question = actor.discovery.handlingQuestions[0];
  assert.ok(question);
  assert.notEqual(scene.first.id, second.id);
  assert.deepEqual(freshMethodAppearance(actor, scene.first.id)?.cues,
    freshMethodAppearance(actor, second.id)?.cues);
  assert.equal(question.priorSourceId, scene.first.id);
  assert.equal(question.sourceId, second.id);
  assert.deepEqual(actor.discovery.techniques, []);
  assert.deepEqual(actor.discovery.effects, []);
  const choices = [];
  const before = {quantity: second.quantity,
    cost: actor.physiology.totals.metabolizedKcal,
    removed: ecology.ledger.humanRemovedKcal};
  const runtime = new PopulationRuntime(state, {cardinal: false,
    experimentalDiscovery: {decision: (npc, result) => {
      if (npc === actor) choices.push({at: npc.elapsed,
        action: structuredClone(result.action), reason: result.reason});
    }}});
  let pulled = null, sample = null, feedback = null, material = null;
  let materialBeforeSample = null;
  try {
    // Normal controller owns every NPC choice and action after the authored
    // training actions. No optional-action hook or NPC request is injected.
    for (let ticks = 0; ticks < 1800; ticks++) {
      state.elapsed += .1;
      runtime.tick(.1);
      if (!pulled) {
        pulled = actor.discovery.experiments.find(event =>
          event.primitive === 'pull' && event.targetId === second.id &&
          event.id > question.failedId);
        if (pulled) {
          material = lookupEcologyObject(ecology, pulled.materialId);
          assert.equal(pulled.code, 'piece_detached');
          assert.ok(material);
          assert.equal(material.heldBy, actor.id);
          assert.equal(second.quantity, before.quantity - 1);
          assert.ok(actor.physiology.totals.metabolizedKcal > before.cost);
          assert.equal(ecology.ledger.humanRemovedKcal, before.removed,
            'Detachment alone does not ingest food');
          assert.deepEqual(actor.discovery.effects, []);
          assert.deepEqual(actor.discovery.techniques, []);
          materialBeforeSample = {mass: material.massGrams,
            energy: material.energyKcal};
        }
      }
      if (pulled && !sample) {
        sample = actor.discovery.experiments.find(event =>
          event.primitive === 'sample' && event.targetId === pulled.materialId &&
          event.id > pulled.id && event.ok);
        if (sample) {
          assert.ok(sample.ingestionId);
          assert.ok(actor.physiology.totals.ingestedKcal > 0);
          close(materialBeforeSample.mass - material.massGrams,
            DISCOVERY_RULES.sampleGrams);
          assert.ok(material.energyKcal < materialBeforeSample.energy);
        }
      }
      if (sample && !feedback) {
        feedback = actor.discovery.effects.find(effect =>
          effect.objectId === pulled.materialId &&
          effect.actionId === sample.actionId &&
          effect.ingestionId === sample.ingestionId &&
          effect.source === 'experienced');
        if (feedback) break;
      }
    }
    assert.ok(choices.some(row => row.reason === HANDLING_QUESTION &&
      row.action.type === 'pull' && row.action.targetId === second.id),
    'The ordinary policy, not the test, must select the analogous pull');
    assert.ok(pulled, 'The selected pull must physically finish');
    assert.ok(sample, 'The ordinary policy must independently sample the new material in this fixed encounter');
    assert.ok(feedback, 'That sample must earn a later own bodily effect');
    const action = actor.memory.experience.find(row => row.id === pulled.actionId);
    assert.equal(action?.details.action?.type, 'pull');
    assert.equal(action.details.action.targetId, second.id);
    assert.equal(action.details.result.materialId, pulled.materialId);
    assert.ok(pulled.durationSeconds >= DISCOVERY_RULES.durations.pull *
      DISCOVERY_RULES.minimumCostMultiplier);
    assert.equal(question.state, 'completed');
    assert.equal(question.attemptId, pulled.id);
    assert.ok(choices.some(row => row.action.type === 'sample' &&
      row.action.targetId === pulled.materialId),
    'The sample must be an independent normal-controller choice');
    assert.ok(feedback.at > sample.at,
      'A sampled portion needs its own delayed bodily feedback');
    assert.equal(feedback.effect, 'sustained');
    const sampleReceipt = actor.memory.experience.find(row =>
      row.id === sample.actionId);
    assert.equal(sampleReceipt?.details.result?.ingestionId, sample.ingestionId);
    const proof = actor.memory.experience.find(row =>
      row.id === feedback.proofEventId);
    assert.equal(proof?.details.code, 'DISCOVERY_EFFECT');
    assert.equal(proof.details.feedback.actionId, sample.actionId);
    assert.equal(proof.details.feedback.ingestionId, sample.ingestionId);
    const earned = actor.discovery.techniques.find(row =>
      row.sourceId === second.id && row.evidence.includes(pulled.id) &&
      row.evidence.includes(sample.id));
    assert.ok(earned, 'The new source needs its own pull, taste and feedback');
    assert.deepEqual(earned.steps.map(row => row.type), ['pull', 'sample']);
    close(before.quantity - second.quantity, 1);
    t.diagnostic(JSON.stringify({autonomousPull: true, autonomousSample: true,
      delayedFeedback: true, secondsObserved: actor.elapsed - question.at}));
  } finally { runtime.dispose(); }
});

test('no own successful pull, personally adverse prior material and occluded sight do not authorize handling analogy', () => {
  const noPrior = encounter({priorPull: false});
  assert.deepEqual(noPrior.actor.discovery.handlingQuestions, []);
  assert.notEqual(discoveryDecision(noPrior.actor).reason, HANDLING_QUESTION);

  const adverse = encounter({harmful: true});
  assert.ok(adverse.actor.discovery.handlingQuestions.length === 1,
    'Paid physical grasp may record a question even when later choice is vetoed');
  assert.equal(priorAdverseSource(adverse.actor.discovery, adverse.first.id), true);
  assert.notEqual(discoveryDecision(adverse.actor).reason, HANDLING_QUESTION);

  const occluded = encounter();
  assert.ok(occluded.actor.discovery.handlingQuestions.length === 1);
  occluded.setSight(false);
  assert.equal(freshMethodAppearance(occluded.actor, occluded.second.id), null);
  assert.notEqual(discoveryDecision(occluded.actor).reason, HANDLING_QUESTION);
});
