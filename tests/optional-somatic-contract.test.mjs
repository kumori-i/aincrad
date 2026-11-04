import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpc } from '../src/npc-state.js';
import { bodySignals } from '../src/interoception.js';
import { exertPhysiology, harmPhysiology, ingestMaterial,
  projectPhysiology, tickPhysiology } from '../src/biology.js';
import { AGGREGATE_RESOLUTIONS, createAggregateSomaticProbe }
  from './fixtures/aggregate-somatic-probe.mjs';

// Engineered fixture only. Exact health is evaluator state and a hypothetical
// high-resolution transducer input, not a currently available agent sensation.
const STEP = .1, HORIZON = 120;
const COMFORT = Object.freeze({ hour: 10, feltTemperature: 18, sheltered: true });
function actor({ health = 100, waterDeficitMl = 250 } = {}) {
  const value = createNpc({ mode: 'discovery', seed: 74193 });
  Object.assign(value.physiology, { health, waterDeficitMl });
  projectPhysiology(value);
  return value;
}
function swallow(value, { toxicity = 0, digestHours = .1, objectId = 'object:1' } = {}) {
  const result = ingestMaterial(value, { massGrams: 30, energyKcal: 95 / 6,
    waterMl: 153 / 6, digestHours, toxicity },
  { objectId, actionId: value.physiology.nextId, provenance: 'sampled' });
  assert.equal(result.ok, true);
}
function trace(value, { beforeTick = () => {}, resolutions = AGGREGATE_RESOLUTIONS } = {}) {
  const probes = resolutions.map(resolution => createAggregateSomaticProbe(value, resolution));
  for (const probe of probes) probe.observe(value);
  const initialHealth = value.physiology.health;
  let firstNetDropAt = null;
  const firstWorseningAt = resolutions.map(() => null);
  for (let i = 0; i < HORIZON / STEP; i++) {
    const previousHealth = value.physiology.health;
    beforeTick(value, i);
    value.elapsed += STEP;
    tickPhysiology(value, STEP, COMFORT);
    if (firstNetDropAt === null && value.physiology.health < previousHealth)
      firstNetDropAt = value.elapsed;
    probes.forEach((probe, index) => {
      const row = probe.observe(value);
      if (row.status === 'worsening' && firstWorseningAt[index] === null)
        firstWorseningAt[index] = value.elapsed;
    });
  }
  return { statuses: probes.map(probe => probe.read().status),
    firstNetDropAt, firstWorseningAt,
    healthChange: value.physiology.health - initialHealth,
    pain: bodySignals(value).pain };
}

test('predeclared source-blind sweep retains unresolved harm at held-out dose, delay and starting-health scales', () => {
  const rows = [];
  for (const health of [100, 92]) for (const digestHours of [.1, 2])
    for (const toxicity of [.25, .75]) {
      const value = actor({ health });
      swallow(value, { toxicity, digestHours });
      const result = trace(value);
      rows.push({ health, digestHours, toxicity, ...result });
      assert.equal(result.pain, 'none');
      if (digestHours === 2) assert.ok(value.physiology.stomach.some(item => item.harm > 0),
        'private evaluator state proves real slow harm even when aggregate healing masks it');
      assert.ok(result.healthChange <= 0 || health === 92,
        'healing may offset mild harm below the health cap');
      assert.deepEqual(result.statuses.slice(1), ['unresolved', 'unresolved'],
        'coarser test-only resolutions miss every held-out small dose');
      if (result.firstWorseningAt[0] !== null)
        assert.ok(result.firstWorseningAt[0] >= result.firstNetDropAt,
          'the hypothetical transducer cannot report before physical harm');
    }
  assert.equal(rows.find(row => row.health === 100 && row.digestHours === .1 &&
    row.toxicity === .75).statuses[0], 'worsening');
  assert.equal(rows.find(row => row.health === 100 && row.digestHours === 2 &&
    row.toxicity === .25).statuses[0], 'unresolved');
  console.log('SOMATIC_TEST_ONLY_SWEEP', JSON.stringify(rows.map(row => ({
    health: row.health, digestHours: row.digestHours, toxicity: row.toxicity,
    statuses: row.statuses, firstNetDropAt: row.firstNetDropAt,
    firstWorseningAt: row.firstWorseningAt,
  }))));
});

test('no intake, safe taste and matched exertion do not manufacture a health-worsening label', () => {
  for (const kind of ['no-intake', 'safe-taste', 'safe-taste-with-exertion']) {
    const value = actor();
    if (kind !== 'no-intake') swallow(value);
    const result = trace(value, { beforeTick: kind === 'safe-taste-with-exertion'
      ? current => exertPhysiology(current, STEP, .25) : () => {} });
    assert.deepEqual(result.statuses, ['unresolved', 'unresolved', 'unresolved']);
    assert.equal(result.firstNetDropAt, null);
    assert.equal(result.pain, 'none');
  }
});

test('non-food contact injury and deprivation can trigger the same aggregate status', () => {
  const contact = actor();
  const contactResult = trace(contact, { beforeTick(current, i) {
    if (i === 100) assert.equal(harmPhysiology(current, .1, { stimulus: 'contact' }).ok, true);
  } });
  assert.equal(contact.physiology.totals.ingestedKcal, 0);
  assert.equal(contactResult.statuses[0], 'worsening');
  assert.equal(contactResult.statuses[1], 'unresolved');
  assert.equal(contactResult.pain, 'none');
  assert.ok(contactResult.firstWorseningAt[0] >= contactResult.firstNetDropAt);

  const dehydrated = actor({ waterDeficitMl: 4000 });
  const dehydrationResult = trace(dehydrated);
  assert.equal(dehydrated.physiology.totals.ingestedKcal, 0);
  assert.equal(dehydrationResult.statuses[0], 'worsening');
  assert.equal(dehydrationResult.pain, 'none');
  assert.ok(dehydrationResult.firstWorseningAt[0] >= dehydrationResult.firstNetDropAt);
});

test('small real injury followed by healing can finish unresolved, never safe', () => {
  const value = actor({ health: 95 });
  const result = trace(value, { beforeTick(current, i) {
    if (i === 10) assert.equal(harmPhysiology(current, .02, { stimulus: 'contact' }).ok, true);
  } });
  assert.ok(result.firstNetDropAt !== null,
    'the internal body did experience damage before recovery');
  assert.ok(result.healthChange > 0,
    'later aggregate healing can mask the small earlier injury');
  assert.deepEqual(result.statuses, ['unresolved', 'unresolved', 'unresolved']);
  assert.equal(result.pain, 'none');
});

test('overlapping foods and changed private source metadata cannot alter an aggregate readout', () => {
  const left = actor(), right = actor();
  swallow(left, { objectId: 'object:1' });
  swallow(left, { objectId: 'object:2', toxicity: .75 });
  swallow(right, { objectId: 'object:2' });
  swallow(right, { objectId: 'object:1', toxicity: .75 });
  right.physiology.feedback.push({ effect: 'discomfort', objectId: 'object:999' });
  right.feelings.relief = 1;
  const a = trace(left), b = trace(right);
  assert.deepEqual(a, b);
  assert.equal(a.pain, 'none');
  assert.equal(a.statuses[0], 'worsening');
  assert.notDeepEqual(left.physiology.feedback.map(item => item.objectId),
    right.physiology.feedback.map(item => item.objectId));
});

test('one-tick noise is filtered, but gradual observation drift can imitate physical harm', () => {
  const make = () => ({ id: 'aster', epoch: 0, lifecycle: 'AWAKE', elapsed: 0,
    physiology: { health: 100 } });
  const oneTick = make(), flicker = createAggregateSomaticProbe(oneTick, .05);
  flicker.observe(oneTick);
  for (const health of [100, 99.94, 100, 100]) {
    oneTick.elapsed += STEP; oneTick.physiology.health = health;
    flicker.observe(oneTick);
  }
  assert.equal(flicker.read().status, 'pending');

  const drifting = make(), drift = createAggregateSomaticProbe(drifting, .05);
  drift.observe(drifting);
  for (const health of [99.98, 99.96, 99.94, 99.92, 99.90, 99.88]) {
    drifting.elapsed += STEP; drifting.physiology.health = health;
    drift.observe(drifting);
  }
  assert.equal(drift.read().status, 'worsening',
    'without a measured noise floor this high-resolution option has false crossings');
});

test('time-based dwell prevents dense samples from manufacturing instant worsening', () => {
  const results = [];
  for (const dt of [.01, .05, .1, .25]) {
    const value = { id: 'aster', epoch: 0, lifecycle: 'AWAKE', elapsed: 0,
      physiology: { health: 100 } };
    const probe = createAggregateSomaticProbe(value, .05);
    probe.observe(value);
    value.elapsed += dt;
    value.physiology.health = 99.9;
    let detectedAt = null;
    for (let i = 0; i < 100; i++) {
      const row = probe.observe(value);
      if (row.status === 'worsening') { detectedAt = value.elapsed; break; }
      value.elapsed += dt;
    }
    assert.ok(detectedAt !== null);
    assert.ok(detectedAt - dt >= .25 - 1e-8,
      'the physical crossing must persist for the fixed minimum duration');
    assert.ok(detectedAt - dt <= .5 + 1e-8,
      'sampling up to the allowed gap bounds detection latency');
    results.push(detectedAt - dt);
  }
  assert.ok(Math.max(...results) - Math.min(...results) <= .25 + 1e-8);
});

test('gaps, body replacement, simulated reopen and cap censor a bounded session', () => {
  const value = actor(), probe = createAggregateSomaticProbe(value, .05);
  assert.deepEqual(probe.observe(value), Object.freeze({ status: 'pending', censorReason: null, samples: 1 }));
  const first = probe.read();
  assert.deepEqual(first, probe.read());
  assert.ok(Object.isFrozen(first));
  value.elapsed += .5;
  assert.equal(probe.observe(value).censorReason, 'missing-observation');
  assert.equal(probe.read().status, 'censored');

  const owner = actor(), replaced = createAggregateSomaticProbe(owner, .05);
  replaced.observe(owner);
  const copiedActor = structuredClone(owner);
  copiedActor.elapsed += STEP;
  assert.equal(replaced.observe(copiedActor).censorReason, 'identity-or-lifecycle');
  assert.equal(createAggregateSomaticProbe(copiedActor, .05).read().status, 'pending');
  assert.equal('aggregateSomaticProbe' in copiedActor, false);

  const dense = actor(), capped = createAggregateSomaticProbe(dense, .05);
  capped.observe(dense);
  for (let i = 1; i <= 7200; i++) {
    dense.elapsed += .00001;
    assert.equal(capped.observe(dense).status, 'pending');
  }
  dense.elapsed += .00001;
  assert.equal(capped.observe(dense).censorReason, 'sample-cap');
  assert.equal(capped.read().samples, 7201);
});
