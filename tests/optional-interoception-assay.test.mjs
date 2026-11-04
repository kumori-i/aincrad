import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpc } from '../src/npc-state.js';
import { bodySignals } from '../src/interoception.js';
import { ingestMaterial, exertPhysiology, projectPhysiology,
  harmPhysiology, tickPhysiology, validatePhysiology } from '../src/biology.js';
import { gameHours } from '../src/biology-config.js';
import { createEnvironment } from '../src/environment.js';
import { lookupEcologyObject } from '../src/ecology.js';
import { canStand } from '../src/world.js';
import { lineOfSight } from '../src/perception.js';
import { observeNpc, requestNpcAction, tickNpc } from '../src/npc.js';

// Development assay only: most controls directly author physiological inputs;
// one separate engineered fixture completes real paid pull/sample actions.
// Neither is a training label, world cohort, or replacement for the private
// action/ingestion proof chain.
const STEP = .1, HORIZON = 120, TICKS = HORIZON / STEP;
const comfortable = Object.freeze({ hour: 10, feltTemperature: 18, sheltered: true });
const SENSE_KEYS = ['hunger', 'thirst', 'energy', 'pain'];
const ORDER = Object.freeze({
  hunger: ['content', 'peckish', 'hungry', 'ravenous', 'faint with hunger'],
  thirst: ['quenched', 'dry mouth', 'thirsty', 'parched', 'desperate thirst'],
  energy: ['steady', 'waning', 'low', 'depleted'],
  pain: ['none', 'aching', 'hurting', 'severe'],
});
function actor({ satietyHours = .9, availableEnergyKcal = 400,
  waterDeficitMl = 1000, health = 100 } = {}) {
  const value = createNpc({ mode: 'discovery', seed: 74193 });
  Object.assign(value.physiology, { satietyHours, availableEnergyKcal, waterDeficitMl, health });
  projectPhysiology(value);
  return value;
}
function sensed(value) {
  const body = bodySignals(value);
  return Object.freeze(Object.fromEntries(SENSE_KEYS.map(key => [key, body[key]])));
}
function taste(value, toxicity = 0) {
  const result = ingestMaterial(value, { massGrams: 30, energyKcal: 95 / 6,
    waterMl: 153 / 6, digestHours: 2, toxicity },
  { objectId: 'object:1', actionId: 1, provenance: 'sampled' });
  assert.equal(result.ok, true);
}
function advance(value, { effort = 0 } = {}) {
  const baseline = sensed(value), startEnergy = value.energy;
  const counts = Object.fromEntries(SENSE_KEYS.map(key => [key, { better: 0, worse: 0 }]));
  for (let i = 0; i < TICKS; i++) {
    value.elapsed += STEP;
    if (effort) exertPhysiology(value, STEP, effort);
    tickPhysiology(value, STEP, comfortable);
    const now = sensed(value);
    for (const key of SENSE_KEYS) {
      const rank = ORDER[key].indexOf(now[key]);
      const original = ORDER[key].indexOf(baseline[key]);
      if (rank < original) counts[key].better++;
      else if (rank > original) counts[key].worse++;
    }
  }
  return { baseline, final: sensed(value), counts,
    projectedEnergyDelta: value.energy - startEnergy };
}

// This authored physical fixture checks the existing signal limit after real
// funded actions. The object intervention is evaluator-only; no agent receives
// toxicity or the other branch's state. It is not an ordinary-world cohort.
function paidTaste(toxicity) {
  const value = createNpc({ mode: 'discovery', seed: 74193 });
  const environment = createEnvironment(74193, { mode: 'discovery' });
  const plant = environment.ecology.plants.find(row => row.kind === 'apple_tree' && row.quantity > 0);
  assert.ok(plant);
  value.position = [[45, 0], [-45, 0], [0, 45], [0, -45]]
    .map(([x, y]) => ({ x: plant.position.x + x, y: plant.position.y + y }))
    .find(point => canStand(point.x, point.y, 'valley') && lineOfSight(point, plant.position));
  assert.ok(value.position);
  observeNpc(value, environment);
  const finish = (type, targetId) => {
    assert.equal(requestNpcAction(value, { type, targetId }, environment).code, 'ACTION_STARTED');
    for (let i = 0; value.active && i < 200; i++) tickNpc(value, STEP, environment);
    assert.equal(value.active, null);
    assert.equal(value.lastResult.ok, true);
    return value.lastResult;
  };
  finish('pull', plant.id);
  const materialId = value.inventory.items[0];
  assert.ok(materialId);
  const material = lookupEcologyObject(environment.ecology, materialId);
  assert.ok(material);
  Object.assign(material, { toxicity, digestHours: .1 });
  const beforeSample = value.physiology.totals.absorbedKcal;
  const result = finish('sample', materialId);
  assert.equal(result.delayed, true);
  assert.equal(value.physiology.totals.absorbedKcal, beforeSample);
  assert.ok(result.handling?.activeActionSeconds > 0);
  return { value, environment, result };
}

test('no intake can raise projected energy by reserve mobilization, while a real taste digests slowly', () => {
  const unfed = actor(), fed = actor();
  const before = sensed(fed);
  taste(fed);
  assert.equal(fed.physiology.totals.absorbedKcal, 0,
    'the immediate appetite projection is not absorbed energy');
  assert.equal(sensed(fed).energy, before.energy);
  const noIntake = advance(unfed), withTaste = advance(fed);
  assert.ok(noIntake.projectedEnergyDelta > 0,
    'reserve mobilization alone makes raw projected energy rise');
  assert.ok(withTaste.projectedEnergyDelta > noIntake.projectedEnergyDelta);
  assert.ok(fed.physiology.totals.absorbedKcal > 0);
  assert.equal(unfed.physiology.totals.absorbedKcal, 0);
  assert.equal(withTaste.baseline.energy, noIntake.baseline.energy);
  assert.equal(withTaste.final.energy, noIntake.final.energy,
    'the existing coarse energy category cannot resolve this small delayed dose');
  assert.equal(noIntake.counts.energy.better, 0);
  assert.equal(withTaste.counts.energy.better, 0);
  assert.ok(withTaste.counts.hunger.worse > noIntake.counts.hunger.worse,
    'post-swallow appetite baseline can make honest food appear worse later');
  console.log('INTEROCEPTION_DEVELOPMENT', JSON.stringify({
    noIntake: { energyDelta: noIntake.projectedEnergyDelta,
      energyCategory: noIntake.final.energy },
    smallTaste: { energyDelta: withTaste.projectedEnergyDelta,
      energyCategory: withTaste.final.energy,
      worseHungerSamples: withTaste.counts.hunger.worse },
  }));
});

test('mixed exertion reverses the raw trend despite the same delayed absorption', () => {
  const idle = actor(), working = actor();
  taste(idle); taste(working);
  const idleTrend = advance(idle), exertedTrend = advance(working, { effort: .25 });
  assert.ok(Math.abs(idle.physiology.totals.absorbedKcal -
    working.physiology.totals.absorbedKcal) < 1e-8);
  assert.ok(idleTrend.projectedEnergyDelta > 0);
  assert.ok(exertedTrend.projectedEnergyDelta < 0);
  assert.deepEqual(idleTrend.final, exertedTrend.final,
    'coarse categories hide the extra work even while the numeric trend flips');
});

test('mild toxic harm is real but below the present pain category resolution', () => {
  const safe = actor(), harmful = actor();
  taste(safe); taste(harmful, 1);
  const safeTrend = advance(safe), harmfulTrend = advance(harmful);
  assert.ok(harmful.physiology.health < safe.physiology.health);
  assert.equal(safeTrend.final.pain, 'none');
  assert.equal(harmfulTrend.final.pain, 'none');
  assert.equal(harmfulTrend.counts.pain.worse, 0);
  assert.ok(harmful.physiology.feedback.some(row => row.effect === 'discomfort'),
    'private engine evidence establishes that missing pain is not safety');
});

test('real paid safe and mildly toxic tastes remain pain-indistinguishable while harm arrives later', () => {
  const safe = paidTaste(0), harmful = paidTaste(1);
  assert.deepEqual(sensed(safe.value), sensed(harmful.value));
  assert.equal(safe.result.handling.activeActionSeconds, harmful.result.handling.activeActionSeconds);
  const safeStartHealth = safe.value.physiology.health;
  let firstHealthLossAt = null;
  for (let i = 0; i < TICKS; i++) {
    tickNpc(safe.value, STEP, safe.environment);
    tickNpc(harmful.value, STEP, harmful.environment);
    if (firstHealthLossAt === null && harmful.value.physiology.health < safe.value.physiology.health)
      firstHealthLossAt = (i + 1) * STEP;
    assert.deepEqual(sensed(safe.value), sensed(harmful.value),
      'the available qualitative channels do not sense this small difference');
  }
  assert.ok(firstHealthLossAt > 0 && firstHealthLossAt <= HORIZON);
  assert.equal(safe.value.physiology.health, safeStartHealth);
  assert.ok(harmful.value.physiology.health < safe.value.physiology.health);
  assert.equal(bodySignals(harmful.value).pain, 'none');
  assert.ok(harmful.value.physiology.feedback.some(row => row.effect === 'discomfort'),
    'private feedback can detect the injury, but cannot become this independent sensor');
  assert.equal(safe.value.physiology.totals.absorbedKcal,
    harmful.value.physiology.totals.absorbedKcal);
});

test('a separate physical injury can worsen health without an intake cause or a pain-band crossing', () => {
  const uninjured = actor(), injured = actor();
  const before = sensed(injured);
  const impact = harmPhysiology(injured, .1, { stimulus: 'contact' });
  assert.equal(impact.ok, true);
  assert.equal(injured.physiology.totals.ingestedKcal, 0);
  assert.deepEqual(sensed(injured), before);
  const plain = advance(uninjured), hurt = advance(injured);
  assert.deepEqual(plain.final, hurt.final);
  assert.equal(hurt.counts.pain.worse, 0);
  assert.ok(injured.physiology.health < uninjured.physiology.health);
});

test('two concurrent tastes can yield the same body categories with opposite source assignments', () => {
  const left = actor(), right = actor();
  for (const [value, sourceOrder] of [[left, ['a', 'b']], [right, ['b', 'a']]]) {
    for (const [index, source] of sourceOrder.entries()) {
      const result = ingestMaterial(value, { massGrams: 30, energyKcal: 95 / 6,
        waterMl: 153 / 6, digestHours: .1, toxicity: index },
      { objectId: `object:${source === 'a' ? 1 : 2}`, actionId: index + 1, provenance: 'sampled' });
      assert.equal(result.ok, true);
    }
  }
  assert.deepEqual(sensed(left), sensed(right));
  const leftTrend = advance(left), rightTrend = advance(right);
  assert.deepEqual(leftTrend, rightTrend);
  assert.equal(leftTrend.final.pain, 'none');
  assert.notDeepEqual(left.physiology.feedback.map(row => row.objectId),
    right.physiology.feedback.map(row => row.objectId),
    'private per-item evidence differs even though the aggregate body projection does not');
});

test('small harm stays below felt resolution across fixed tick sizes and repeated reads add no memory', () => {
  for (const dt of [.05, .1, .2, .25]) {
    const value = actor(); taste(value, 1);
    const baselineHealth = value.physiology.health;
    let firstInternalLossAt = null;
    const count = Math.round(HORIZON / dt);
    for (let i = 0; i < count; i++) {
      value.elapsed += dt;
      tickPhysiology(value, dt, comfortable);
      if (firstInternalLossAt === null && value.physiology.health < baselineHealth)
        firstInternalLossAt = (i + 1) * dt;
      const beforeRead = structuredClone(value);
      const first = sensed(value), second = sensed(value);
      assert.deepEqual(first, second);
      assert.deepEqual(value, beforeRead, 'reading cannot append a hidden sensory history');
      assert.equal(first.pain, 'none');
    }
    assert.ok(firstInternalLossAt > 0 && firstInternalLossAt <= HORIZON);
    assert.ok(value.physiology.health < baselineHealth,
      `private aggregate health changes at ${dt}s ticks, but the actor's pain band does not`);
    assert.equal('optionalBodilySensation' in value, false);
  }
});

test('tiny near-threshold body variation can flip a categorical endpoint', () => {
  const offset = gameHours(HORIZON);
  const a = actor({ satietyHours: 1 + offset - .000001 });
  const b = actor({ satietyHours: 1 + offset + .000001 });
  const left = advance(a), right = advance(b);
  assert.equal(left.final.hunger, 'hungry');
  assert.equal(right.final.hunger, 'peckish');
  assert.ok(Math.abs(a.physiology.satietyHours - b.physiology.satietyHours) < .00001);
  assert.ok(left.counts.hunger.worse !== right.counts.hunger.worse);
});

test('a fixed three-sample hysteresis filters a one-tick category flicker but cannot add resolution', () => {
  const accepted = rows => {
    let streak = 0;
    for (const row of rows) {
      if (row === null) return 'censored';
      streak = row === 'hungry' ? streak + 1 : 0;
      if (streak === 3) return 'worse';
    }
    return 'no-sustained-crossing';
  };
  assert.equal(accepted(['peckish', 'hungry', 'peckish', 'peckish']),
    'no-sustained-crossing');
  assert.equal(accepted(['peckish', 'hungry', 'hungry', 'hungry']), 'worse');
  assert.equal(accepted(['peckish', 'hungry', null, 'hungry']), 'censored');
  assert.equal(accepted(['peckish', 'peckish', 'peckish', 'peckish']),
    'no-sustained-crossing');
});

test('source and effect metadata cannot alter a source-blind bodily trajectory', () => {
  const a = actor(); taste(a);
  const b = structuredClone(a);
  Object.assign(b.physiology.stomach[0], {
    objectId: 'object:999', actionId: 999, provenance: 'foreign',
  });
  b.physiology.feedback.push({ effect: 'sustained', hunger: 'easing' });
  b.feelings.relief = 1;
  assert.deepEqual(sensed(a), sensed(b));
  const left = advance(a), right = advance(b);
  assert.deepEqual(left, right);
});

test('physiology validation roundtrips without a speculative trend or outcome field', () => {
  const a = actor(); taste(a);
  advance(a);
  const raw = JSON.parse(JSON.stringify(a.physiology));
  const restored = validatePhysiology(raw, { elapsed: a.elapsed });
  assert.deepEqual(restored, a.physiology);
  assert.equal('optionalSensoryWindow' in raw, false);
  assert.equal('optionalSensoryWindow' in restored, false);
});
