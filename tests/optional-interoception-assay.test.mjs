import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpc } from '../src/npc-state.js';
import { bodySignals } from '../src/interoception.js';
import { ingestMaterial, exertPhysiology, projectPhysiology,
  tickPhysiology, validatePhysiology } from '../src/biology.js';
import { gameHours } from '../src/biology-config.js';

// Development assay only: directly authored physiological inputs isolate what
// an actor can feel. They are NOT paid food trials, training labels, a world
// cohort, or a replacement for the private action/ingestion proof chain.
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
