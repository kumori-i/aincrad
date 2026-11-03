import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpc } from '../src/npc-state.js';
import { createEnvironment } from '../src/environment.js';
import { createEcology } from '../src/ecology.js';
import { canStand, distance } from '../src/world.js';
import { lineOfSight } from '../src/perception.js';
import { observeNpc, requestNpcAction, tickNpc } from '../src/npc.js';
import { discoveryDecision } from '../src/discovery.js';
import { DISCOVERY_RULES } from '../src/discovery-config.js';
import { OPTIONAL_MOTOR_TYPES, optionalMotorFeatures,
  rankOptionalMotorChoices } from '../src/optional-motor-features.js';
import { createOptionalMotorModel, copyOptionalMotorModel,
  optionalMotorProbability, updateOptionalMotorModel } from '../src/optional-motor-core.js';

// Fixed before any evaluation outcomes in docs/OPTIONAL-MOTOR-HELDOUT-PLAN.md.
// This is CPU-only engineered physical work, not an ordinary trajectory.
const SEEDS = [51001, 51002];
const VANTAGE_OFFSETS = [[-45, 0], [45, 0], [0, -45], [0, 45], [-60, 0], [60, 0]];
const WARMUP = ['grasp', 'pull', 'grasp', 'pull'];
const EVALUATION = ['inspect_object', 'grasp', 'pull', 'strike'];
const STEP = .05;
const MAX_STEPS = 700;
const RANDOM_SALT = 0x12d3a5;

function numericId(source) { return Number(source.id.slice('object:'.length)); }
function availableVantage(source) {
  for (const [dx, dy] of VANTAGE_OFFSETS) {
    const point = { x: source.position.x + dx, y: source.position.y + dy };
    if (canStand(point.x, point.y, 'valley') &&
        lineOfSight(point, source.position, 'valley') &&
        distance(point, source.position) <= DISCOVERY_RULES.reach) return point;
  }
  return null;
}
function setup(seed) {
  const actor = createNpc({ mode: 'discovery', seed });
  const environment = createEnvironment(seed);
  environment.ecology = createEcology(seed);
  const plants = [...environment.ecology.plants].sort((a, b) => numericId(a) - numericId(b));
  const bramble = plants.find(p => p.kind === 'bramble');
  if (!bramble) return { seed, status: 'bramble-unavailable' };
  const apple = plants.find(p => p.kind === 'apple_tree' &&
    distance(p.position, bramble.position) > 800);
  if (!apple) return { seed, status: 'distant-apple-unavailable', brambleId: bramble.id };
  const brambleVantage = availableVantage(bramble);
  if (!brambleVantage) return { seed, status: 'bramble-vantage-unavailable',
    brambleId: bramble.id, appleId: apple.id };
  const appleVantage = availableVantage(apple);
  if (!appleVantage) return { seed, status: 'apple-vantage-unavailable',
    brambleId: bramble.id, appleId: apple.id };
  actor.position = brambleVantage;
  observeNpc(actor, environment);
  return { seed, status: 'available', actor, environment, bramble, apple,
    brambleVantage, appleVantage };
}
function totalStock(environment) {
  // Attached plant fruit quantity only; this is not a complete material ledger.
  return environment.ecology.plants.reduce((sum, plant) =>
    sum + (Number.isFinite(plant.quantity) ? plant.quantity : 0), 0);
}
function physicalState(actor, environment) {
  return { kcal: actor.physiology.totals.metabolizedKcal,
    waterDeficitMl: actor.physiology.waterDeficitMl,
    plantQuantity: totalStock(environment), held: actor.inventory.items.length };
}
function snapshotDelta(before, after) {
  return { metabolizedKcal: after.kcal - before.kcal,
    waterDeficitMl: after.waterDeficitMl - before.waterDeficitMl,
    plantQuantity: after.plantQuantity - before.plantQuantity,
    held: after.held - before.held };
}

// An idle branch starts from the exact pre-action clone and advances the same
// number of physical ticks. It never receives the chosen action or its result.
function paidOnce(actor, environment, action) {
  const untouchedActor = structuredClone(actor), untouchedWorld = structuredClone(environment);
  const before = physicalState(actor, environment), previousId = actor.memory.experience.at(-1)?.id ?? 0;
  const feature = optionalMotorFeatures(actor, { action });
  const admission = requestNpcAction(actor, action, environment);
  const active = actor.active;
  let ticks = 0;
  if (active) for (; ticks < MAX_STEPS && actor.active; ticks++) tickNpc(actor, STEP, environment);
  for (let i = 0; i < ticks; i++) tickNpc(untouchedActor, STEP, untouchedWorld);
  const after = physicalState(actor, environment);
  const idle = physicalState(untouchedActor, untouchedWorld);
  const result = actor.lastResult;
  const event = actor.memory.experience.find(row => row.id === result?.eventId);
  const experiment = actor.discovery.experiments.find(row => row.actionId === result?.eventId);
  const paidComplete = !!feature && !!active && actor.active === null &&
    result?.eventId > previousId && event?.type === 'action' &&
    event.at === result.at && experiment?.at === result.at &&
    event.details.action?.type === action.type &&
    event.details.action?.targetId === action.targetId &&
    event.details.result?.code === result.code &&
    event.details.result?.ok === result.ok &&
    event.details.result?.durationSeconds === result.durationSeconds &&
    experiment?.primitive === action.type && experiment.targetId === action.targetId &&
    experiment.code === result.code && experiment.ok === result.ok &&
    experiment.durationSeconds === result.durationSeconds &&
    Number.isFinite(active.seconds) && Number.isFinite(result.durationSeconds) &&
    Math.abs(result.durationSeconds - active.seconds) <= 1e-8;
  const status = !active ? 'admission-censored' : actor.active ? 'unfinished-censored' :
    paidComplete ? 'paid-complete' : 'completion-censored';
  return { action: { ...action }, status, code: active ? result?.code ?? null : admission.code,
    outcome: paidComplete ? Number(result.ok) : null,
    actionId: paidComplete ? result.eventId : null,
    features: paidComplete ? feature : null,
    ticks, elapsedSeconds: ticks * STEP,
    paidSeconds: active ? result?.durationSeconds ?? 0 : 0,
    ...snapshotDelta(before, after), idleMetabolizedKcal: idle.kcal - before.kcal,
    excessKcal: after.kcal - idle.kcal,
    waterDeficitAfterMl: after.waterDeficitMl,
    plantQuantityAfter: after.plantQuantity, heldAfter: after.held };
}

function frequencies() { return { n: 0, yes: 0, byType: Object.create(null) }; }
function updateFrequency(frequency, type, outcome) {
  frequency.n++; frequency.yes += outcome;
  const row = frequency.byType[type] ??= { n: 0, yes: 0 };
  row.n++; row.yes += outcome;
}
function laplace(row) { return (row.yes + 1) / (row.n + 2); }
function frozenPriors(frequency) {
  const byType = Object.fromEntries(OPTIONAL_MOTOR_TYPES.map(type =>
    [type, laplace(frequency.byType[type] ?? { n: 0, yes: 0 })]));
  return Object.freeze({ pooled: laplace(frequency), byType: Object.freeze(byType) });
}
function score(rows, field) {
  const valid = rows.filter(row => row.status === 'paid-complete' &&
    (row.outcome === 0 || row.outcome === 1) && Number.isFinite(row.predictions?.[field]));
  if (!valid.length) return { n: 0, brier: null, logLoss: null };
  const brier = valid.reduce((sum, row) =>
    sum + (row.predictions[field] - row.outcome) ** 2, 0) / valid.length;
  const logLoss = valid.reduce((sum, row) => {
    // Bound only the logarithm in the metric; the frozen probabilities stand.
    const p = Math.min(1 - 1e-12, Math.max(1e-12, row.predictions[field]));
    return sum - (row.outcome ? Math.log(p) : Math.log1p(-p));
  }, 0) / valid.length;
  return { n: valid.length, brier, logLoss };
}
function scores(rows) {
  const fields = ['model', 'noUpdate', 'pooled', 'perPrimitive'];
  const measure = sample => Object.fromEntries(fields.map(field => [field, score(sample, field)]));
  return { overall: measure(rows),
    byPrimitive: Object.fromEntries(EVALUATION.map(type =>
      [type, measure(rows.filter(row => row.action.type === type))])) };
}
function objectChoices(choices) {
  return choices.map((choice, index) => ({ choice, index }))
    .filter(({ choice }) => OPTIONAL_MOTOR_TYPES.includes(choice.action?.type));
}
function fixedRandomIndex(seed, choices) {
  const eligible = objectChoices(choices);
  if (!eligible.length) return null;
  // Exactly one independent LCG draw from evaluation seed XOR fixed salt.
  // Never read the actor's policy RNG or any physical outcome to choose it.
  const state = (Math.imul((seed ^ RANDOM_SALT) >>> 0, 1664525) + 1013904223) >>> 0;
  return eligible[Math.floor(state / 4294967296 * eligible.length)].index;
}
function policyChoices(seed, actor, environment, model, examples, priors) {
  const definitions = [
    ['authored', () => null],
    ['numeric', (self, choices) => rankOptionalMotorChoices(self, choices, model, examples)],
    ['noUpdate', (_self, choices) => rankOptionalMotorChoices(_self, choices,
      createOptionalMotorModel(), 0)],
    ['frequency', (_self, choices) => {
      let best = -Infinity, index = null;
      for (const { choice, index: i } of objectChoices(choices)) {
        const p = priors.byType[choice.action.type];
        if (p > best) { best = p; index = i; }
      }
      return index;
    }],
    ['firstEligible', (_self, choices) => objectChoices(choices)[0]?.index ?? null],
    ['independentRandom', (_self, choices) => fixedRandomIndex(seed, choices)],
  ];
  const rows = definitions.map(([name, choose]) => {
    const ownActor = structuredClone(actor), ownWorld = structuredClone(environment);
    let callbackCalls = 0, candidateCount = null, candidateSnapshot = null;
    const decision = discoveryDecision(ownActor, { handlingCuriosity: false,
      chooseOptional(choices) {
        callbackCalls++; candidateCount = choices.length;
        candidateSnapshot = structuredClone(choices);
        return choose(ownActor, choices);
      } });
    const result = paidOnce(ownActor, ownWorld, decision.action);
    const { features: _features, ...physical } = result;
    return { name, selectedNeed: decision.need, action: decision.action,
      callbackCalls, candidateCount, candidateSnapshot, ...physical };
  });
  const exposed = rows.filter(row => row.callbackCalls > 0);
  for (const row of exposed) {
    assert.equal(row.callbackCalls, 1, 'The optional seam is entered once per branch');
    assert.deepEqual(row.candidateSnapshot, exposed[0].candidateSnapshot,
      'Every exposed branch sees the same frozen candidate actions and order');
  }
  return { exposure: exposed.length === rows.length ? 'optional-exposed' :
    'preempted-insufficient', rows: rows.map(({ candidateSnapshot, ...row }) => row) };
}

function evaluateSeed(seed) {
  const setupResult = setup(seed);
  if (setupResult.status !== 'available') return setupResult;
  const { actor, environment, bramble, apple, brambleVantage, appleVantage } = setupResult;
  let model = createOptionalMotorModel();
  const frequency = frequencies(), warmup = [], trained = new Set();
  for (const type of WARMUP) {
    const trial = paidOnce(actor, environment, { type, targetId: bramble.id });
    warmup.push({ ...trial, features: undefined });
    if (trial.status === 'paid-complete') {
      assert.ok(!trained.has(trial.actionId), 'Each own action receipt trains at most once');
      trained.add(trial.actionId);
      model = updateOptionalMotorModel(model, trial.features, trial.outcome).model;
      updateFrequency(frequency, type, trial.outcome);
    }
    observeNpc(actor, environment);
  }
  const warmupTotals = { elapsedSeconds: warmup.reduce((sum, row) => sum + row.elapsedSeconds, 0),
    metabolizedKcal: warmup.reduce((sum, row) => sum + row.metabolizedKcal, 0),
    idleMetabolizedKcal: warmup.reduce((sum, row) => sum + row.idleMetabolizedKcal, 0),
    examples: frequency.n };
  assert.equal(actor.discovery.observations[apple.id], undefined,
    'The held-out apple has not even been observed during bramble warmup');
  // This authored teleport is setup only. It does not generate a move receipt,
  // route knowledge, or a claim that the agent learned to reach this region.
  actor.position = { ...appleVantage };
  observeNpc(actor, environment);
  const priorAppleTrials = Object.keys(actor.discovery.trials).filter(key =>
    key.startsWith(`${apple.id}|`));
  assert.deepEqual(priorAppleTrials, []);
  assert.ok(!actor.discovery.experiments.some(row => row.targetId === apple.id));
  assert.ok(!actor.discovery.effects.some(row => row.objectId === apple.id));
  assert.ok(!actor.discovery.techniques.some(row => row.sourceId === apple.id));

  const frozenModel = copyOptionalMotorModel(model), priors = frozenPriors(frequency);
  const frozen = EVALUATION.map(type => {
    const action = { type, targetId: apple.id };
    const features = optionalMotorFeatures(actor, { action });
    return { action, features,
      predictions: features ? Object.freeze({
        model: optionalMotorProbability(frozenModel, features),
        noUpdate: .5, pooled: priors.pooled, perPrimitive: priors.byType[type],
      }) : null };
  });
  // All four probabilities and feature vectors are frozen before any branch is
  // paid. Every held-out action receives an exact pre-action actor/world clone.
  const evaluation = frozen.map(({ action, features, predictions }) => {
    const ownActor = structuredClone(actor), ownWorld = structuredClone(environment);
    const trial = paidOnce(ownActor, ownWorld, action);
    return { ...trial, features: undefined, vectorAvailable: !!features, predictions };
  });
  assert.deepEqual(model, frozenModel, 'Held-out outcomes never update the model');
  assert.equal(frequency.n, warmupTotals.examples,
    'Held-out outcomes never update the frozen frequency controls');
  const policyComparison = policyChoices(seed, actor, environment, frozenModel,
    frequency.n, priors);
  return { seed, status: 'available', setup: { brambleId: bramble.id,
    appleId: apple.id, separation: distance(bramble.position, apple.position),
    brambleVantage, appleVantage, repositioning: 'unpaid authored setup' },
    warmup, warmupTotals, frozenPredictions: frozen.map(({ action, features,
      predictions }) => ({ type: action.type, vectorAvailable: !!features, predictions })),
    evaluation, scores: scores(evaluation), policyExposure: policyComparison.exposure,
    policies: policyComparison.rows };
}

test('fixed two-seed distant-instance motor evaluation retains all outcomes and costs', () => {
  const cases = SEEDS.map(evaluateSeed);
  assert.deepEqual(cases.map(row => row.seed), SEEDS);
  for (const row of cases) {
    if (row.status !== 'available') continue; // Unavailable is recorded, never replaced.
    assert.equal(row.warmup.length, 4);
    assert.equal(row.evaluation.length, 4);
    assert.equal(row.policies.length, 6);
    assert.equal(row.policyExposure, 'optional-exposed',
      'One-step policy comparison requires all six identical candidate sets');
    assert.ok(row.setup.separation > 800);
    assert.ok(row.evaluation.every(action => action.features === undefined));
    assert.ok(row.policies.every(branch => Number.isFinite(branch.metabolizedKcal) &&
      Number.isFinite(branch.idleMetabolizedKcal) &&
      Number.isFinite(branch.waterDeficitAfterMl) &&
      Number.isFinite(branch.plantQuantityAfter) && Number.isInteger(branch.heldAfter)));
    assert.deepEqual(row.policies.find(branch => branch.name === 'noUpdate')?.action,
      row.policies.find(branch => branch.name === 'authored')?.action,
      'Cold no-update abstention keeps the exact authored action');
  }
  assert.ok(cases.some(row => row.status === 'available'),
    'At least one predeclared case must produce a physical comparison');
  // This is a complete fixed-case report, not a success criterion for any
  // model, policy, survival effect, visual transfer, or other source instance.
  console.log('OPTIONAL_MOTOR_HELDOUT_ENGINEERING', JSON.stringify(cases));
});
