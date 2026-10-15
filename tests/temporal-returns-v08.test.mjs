import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TEMPORAL_LIMITS,
  createTemporalReturns,
  temporalKey,
  temporalContext,
  decodeTemporalKey,
  temporalPrediction,
  temporalDiscount,
  temporalIntegral,
  appendTemporalTransition,
  trainTemporalReturns,
  validateTemporalReturns,
} from '../src/temporal-returns.js';

// These are equation-level fixtures, not autonomous behavior or physiological
// evidence. Expected values use the preregistered constants independently of
// the implementation's discount/integral helpers.
const ALPHA = 0.2;
const SWEEPS = 8;
const BETA = Math.log(2) / 300;
const LEARNED_FRACTION = 1 - 0.8 ** 8;
const ZERO = [0, 0, 0, 0, 0];
const copy = value => structuredClone(value);
const approximately = (actual, expected, message = '') => {
  assert.ok(Number.isFinite(actual), `${message}: expected a finite result, got ${actual}`);
  assert.ok(Math.abs(actual - expected) <= 1e-11 * Math.max(1, Math.abs(expected)),
    `${message}: expected ${expected}, got ${actual}`);
};
const vectorApproximately = (actual, expected, message = '') => {
  assert.equal(actual.length, 5);
  expected.forEach((value, channel) => approximately(actual[channel], value, `${message}, channel ${channel}`));
};

// Generate distinct states using only public categorical sensations. No opaque
// object, ingestion, action or species ID supplies any key dimension.
function context(index = 0) {
  const choices = {
    hunger: ['content', 'peckish', 'hungry', 'ravenous', 'faint with hunger'],
    thirst: ['quenched', 'dry mouth', 'thirsty', 'parched', 'desperate thirst'],
    energy: ['steady', 'waning', 'low', 'depleted'],
    stamina: ['easy breathing', 'breathing hard', 'winded', 'exhausted'],
    fatigue: ['fresh', 'tired', 'weary', 'exhausted'],
    pain: ['none', 'aching', 'hurting', 'severe'],
  };
  const body = { digestion: 'settled' };
  for (const [name, labels] of Object.entries(choices)) {
    body[name] = labels[index % labels.length];
    index = Math.floor(index / labels.length);
  }
  return {
    body,
    appearance: { shape: 'round', color: 'red-green', texture: 'smooth', motion: 'still', smell: 'sweet' },
    warmth: 'comfortable', shelter: 'open air', relation: 'held', heldCount: 1,
    focus: true, outputOfFocus: false, countBand: '1', workBand: '0',
    history: [], exposures: [], historyCensored: false,
  };
}
const key = (index = 0, operation = 'wait') => temporalKey(context(index), operation);
function transition(overrides = {}) {
  return { seq: 1, nextSeq: 2, startAt: 0, endAt: 1, key: key(0), nextKey: key(1), reward: [...ZERO], ...overrides };
}
function append(model, record) {
  assert.equal(appendTemporalTransition(model, record), true, `admit completed transition ${record.seq}`);
}
function learnedRow(rowKey, q, overrides = {}) {
  return { key: rowKey, q: [...q], visits: 1, updates: 1, lastAt: 0, ...overrides };
}
function delayedChain(length) {
  const model = createTemporalReturns();
  const dt = 300 / length;
  for (let i = 0; i < length; i++) {
    append(model, transition({
      seq: i + 1, nextSeq: i + 2, startAt: i * dt, endAt: (i + 1) * dt,
      key: key(i), nextKey: key(i + 1),
      // One event occurs at t=300. Its own interval return is already discounted
      // from the last interval's start, before backward propagation.
      reward: [i === length - 1 ? Math.exp(-BETA * dt) : 0, 0, 0, 0, 0],
    }));
  }
  return model;
}

for (const length of [32, 128]) {
  test(`${length}-link delayed return propagates the full 300-second target in eight sweeps`, () => {
    const model = delayedChain(length);
    const retained = copy(model.transitions);
    const result = trainTemporalReturns(model);
    assert.deepEqual(result, { targets: 8 * length, updatedRows: 8 * length });
    assert.equal(model.updateCount, 8);
    assert.equal(TEMPORAL_LIMITS.alpha, ALPHA);
    assert.equal(TEMPORAL_LIMITS.sweeps, SWEEPS);
    approximately(temporalPrediction(model, key(0)).q[0], 0.41611392, 'analytical starting prediction');
    for (let i = 0; i < length; i++) {
      const expected = LEARNED_FRACTION * Math.exp(-BETA * (300 - i * 300 / length));
      vectorApproximately(temporalPrediction(model, key(i)).q, [expected, 0, 0, 0, 0], `state ${i}`);
      assert.equal(temporalPrediction(model, key(i)).visits, 1, 'replay never creates another experience');
      assert.equal(model.rows.find(row => row.key === key(i)).updates, 8);
    }
    assert.deepEqual(temporalPrediction(model, key(length)), { q: [...ZERO], visits: 0, known: false });
    assert.deepEqual(model.transitions, retained, 'training does not reissue or rewrite interval rewards');
  });
}

test('all five channels bootstrap from the one actual submitted successor', () => {
  const model = createTemporalReturns();
  const actual = key(1, 'rest');
  const alternatives = [key(2, 'sample'), key(3, 'release')];
  const actualQ = [2, 3, 5, 7, 11];
  const reward = [0.1, 0.2, 0.3, 0.4, 0.5];
  model.rows.push(learnedRow(actual, actualQ));
  model.rows.push(learnedRow(alternatives[0], [100, 0, 100, 0, 100]));
  model.rows.push(learnedRow(alternatives[1], [0, 100, 0, 100, 0]));
  append(model, transition({ nextKey: actual, endAt: 300, reward }));
  const untouched = copy(model.rows.filter(row => row.key !== key(0)));
  trainTemporalReturns(model);
  vectorApproximately(temporalPrediction(model, key(0)).q,
    reward.map((r, c) => LEARNED_FRACTION * (r + 0.5 * actualQ[c])));
  assert.deepEqual(model.rows.filter(row => row.key !== key(0)), untouched);
});

test('repeated rows average their full-return targets and update once per sweep', () => {
  const model = createTemporalReturns();
  const same = key(0);
  append(model, transition({ key: same, nextKey: same, startAt: 0, endAt: 0, reward: [1, 2, 3, 4, 5] }));
  append(model, transition({ seq: 2, nextSeq: 3, key: same, nextKey: same, startAt: 0, endAt: 0, reward: [3, 6, 9, 12, 15] }));
  // Each frozen sweep targets Q + (first reward + 2*second reward)/2.
  // This is deliberately continuing, so the actual self-successor is not a
  // fabricated zero-return terminal state.
  const result = trainTemporalReturns(model);
  assert.deepEqual(result, { targets: 16, updatedRows: 8 });
  vectorApproximately(temporalPrediction(model, same).q, [1, 2, 3, 4, 5].map(v => 8 * 0.2 * 3.5 * v));
  assert.equal(temporalPrediction(model, same).visits, 2);
  assert.equal(model.rows[0].updates, 8);
});

test('disconnected retained segments read one frozen prediction snapshot per sweep', () => {
  const model = createTemporalReturns();
  append(model, transition({ startAt: 0, endAt: 0 }));
  // Missing submission 2 breaks retained continuity. A must read B's previous
  // sweep forecast, not B's just-updated forecast or the next record's return.
  append(model, transition({ seq: 3, nextSeq: 4, startAt: 1, endAt: 1, key: key(1), nextKey: key(2), reward: [1, 2, 3, 4, 5] }));
  trainTemporalReturns(model);
  const delayed = 1 - 0.8 ** 8 - 8 * 0.2 * 0.8 ** 7;
  vectorApproximately(temporalPrediction(model, key(0)).q, [1, 2, 3, 4, 5].map(v => v * delayed));
  vectorApproximately(temporalPrediction(model, key(1)).q, [1, 2, 3, 4, 5].map(v => v * LEARNED_FRACTION));
});

test('discounted time/work integration is invariant to interval splitting', () => {
  assert.equal(temporalDiscount(0), 1);
  approximately(temporalDiscount(300), 0.5);
  approximately(temporalIntegral(0, 300), 2.5 / Math.log(2));
  for (const rate of [0, 1 / 3, 2 / 3, 1]) {
    for (const [a, b, c] of [[0, 0, 300], [0, 17.25, 300], [2.5, 80.125, 901], [0, 1e-9, 1e-8]]) {
      approximately(temporalIntegral(a, c, rate), temporalIntegral(a, b, rate) + temporalIntegral(b, c, rate));
      approximately(temporalIntegral(a, c, rate),
        temporalIntegral(a, b, rate) + Math.exp(-BETA * b) * temporalIntegral(0, c - b, rate));
      approximately(temporalDiscount(b - a) * temporalDiscount(c - b), temporalDiscount(c - a));
    }
  }
  for (const t of [0, 25, 300]) {
    assert.equal(temporalIntegral(t, t), 0);
    assert.equal(temporalIntegral(t, t, 1 / 3), 0, 'zero work duration cannot acquire exertion cost');
  }
  for (const args of [[-1, 2], [2, 1], [0, Infinity], [NaN, 1], [0, 1, -1], [0, 1, NaN]]) {
    assert.throws(() => temporalIntegral(...args), TypeError);
  }
});

test('bootstrap-disabled control keeps identical evidence and update budgets', () => {
  const online = delayedChain(32);
  const immediate = copy(online);
  const evidence = copy(online.transitions);
  assert.deepEqual(trainTemporalReturns(online), trainTemporalReturns(immediate, { mode: 'immediate' }));
  assert.equal(temporalPrediction(immediate, key(0)).q[0], 0);
  approximately(temporalPrediction(online, key(0)).q[0], 0.41611392);
  vectorApproximately(temporalPrediction(immediate, key(31)).q, temporalPrediction(online, key(31)).q);
  assert.deepEqual(immediate.transitions, evidence);
  assert.deepEqual(online.transitions, evidence);
  assert.deepEqual(immediate.rows.map(({ visits, updates }) => ({ visits, updates })),
    online.rows.map(({ visits, updates }) => ({ visits, updates })));
});

function permutationFixture() {
  const model = createTemporalReturns();
  const positive = [[1, 0, 0], [0, 2, 0], [0, 0, 3], [0, 0, 0]];
  for (let i = 0; i < positive.length; i++) {
    append(model, transition({ seq: i + 1, nextSeq: i + 2, key: key(i), nextKey: key(i + 1),
      startAt: i * 30, endAt: (i + 1) * 30,
      reward: [...positive[i], temporalIntegral(0, 30), temporalIntegral(0, 30, i / 3)] }));
  }
  return model;
}

test('permutation changes complete F/W/H vectors but preserves every real record and T/E target', () => {
  const online = permutationFixture();
  const permuted = copy(online);
  const actualRecords = copy(online.transitions);
  const rewardView = actualRecords.map(record => record.reward.slice(0, 3)).reverse();
  const viewBefore = copy(rewardView);
  const onlineResult = trainTemporalReturns(online);
  const permutedResult = trainTemporalReturns(permuted, { mode: 'permuted', rewardView });
  assert.deepEqual(permutedResult, onlineResult);
  assert.deepEqual(permuted.transitions, actualRecords);
  assert.deepEqual(online.transitions, actualRecords);
  assert.deepEqual(rewardView, viewBefore);
  for (let i = 0; i < 4; i++) {
    assert.deepEqual(temporalPrediction(permuted, key(i)).q.slice(3), temporalPrediction(online, key(i)).q.slice(3));
  }
  assert.notDeepEqual(temporalPrediction(permuted, key(0)).q.slice(0, 3), temporalPrediction(online, key(0)).q.slice(0, 3));
  const expected = rewardView.reduce((sum, r, i) => sum + r[0] * Math.exp(-BETA * i * 30), 0) * LEARNED_FRACTION;
  approximately(temporalPrediction(permuted, key(0)).q[0], expected);
});

test('permuted control requires a valid complete-vector permutation, including multiplicity', () => {
  const original = permutationFixture();
  const valid = original.transitions.map(record => record.reward.slice(0, 3));
  const invalid = [
    null, [], valid.slice(1), [...valid, [0, 0, 0]],
    Array(4), valid.map((v, i) => i === 0 ? Array(3) : [...v]),
    valid.map((v, i) => i === 0 ? [1, 0] : [...v]),
    valid.map((v, i) => i === 0 ? [NaN, 0, 0] : [...v]),
    valid.map((v, i) => i === 0 ? [-1, 0, 0] : [...v]),
    valid.map((v, i) => i === 0 ? [Infinity, 0, 0] : [...v]),
    valid.map((v, i) => i === 0 ? [10001, 0, 0] : [...v]),
    // Well-shaped but invented reward is not a learner-only permutation.
    valid.map((v, i) => i === 0 ? [0.5, 0, 0] : [...v]),
    // Only observed vectors, but dropping the zero and doubling food is invalid.
    [[1, 0, 0], [0, 2, 0], [0, 0, 3], [1, 0, 0]],
    // Independent channel shuffles destroy observed complete-vector structure.
    [[1, 2, 0], [0, 0, 0], [0, 0, 3], [0, 0, 0]],
  ];
  for (const [index, rewardView] of invalid.entries()) {
    const model = copy(original);
    assert.throws(() => trainTemporalReturns(model, { mode: 'permuted', rewardView }), TypeError, `invalid view ${index}`);
    assert.deepEqual(model, original, `rejection ${index} must precede any prediction update`);
  }
});

test('frozen controls preserve both zero initialization and learned checkpoints exactly', () => {
  for (const learned of [false, true]) {
    const model = delayedChain(32);
    if (learned) trainTemporalReturns(model);
    const before = copy(model);
    for (let call = 0; call < 3; call++) {
      assert.deepEqual(trainTemporalReturns(model, { mode: 'frozen' }), { targets: 0, updatedRows: 0 });
      assert.deepEqual(model, before);
    }
  }
});

test('learned row parameters persist when more than 512 recent transitions rotate out', () => {
  const model = createTemporalReturns();
  append(model, transition({ reward: [1, 2, 3, 4, 5] }));
  trainTemporalReturns(model);
  const oldRow = copy(model.rows.find(row => row.key === key(0)));
  for (let i = 1; i <= 530; i++) {
    append(model, transition({ seq: i + 1, nextSeq: i + 2, startAt: i, endAt: i + 1, key: key(i), nextKey: key(i + 1) }));
  }
  assert.equal(model.transitions.length, 512);
  assert.equal(model.transitions[0].seq, 20);
  assert.equal(model.historyCensored, true);
  assert.deepEqual(model.rows.find(row => row.key === key(0)), oldRow);
  assert.equal(appendTemporalTransition(model, transition()), false, 'rotated evidence is still duplicate history');
  const result = trainTemporalReturns(model);
  assert.equal(result.targets, 4096);
  assert.deepEqual(model.rows.find(row => row.key === key(0)), oldRow);
  const restored = validateTemporalReturns(JSON.parse(JSON.stringify(model)), 531);
  assert.deepEqual(restored, model, 'reopen restores durable predictions, never retrains the retained tail');
});

test('restore is a deep, exact, no-update round trip including integer zeros', () => {
  assert.deepEqual(validateTemporalReturns(createTemporalReturns(), 0), createTemporalReturns());
  const model = delayedChain(32);
  trainTemporalReturns(model);
  model.rows.push(learnedRow(key(200), ZERO, { visits: 0, updates: 0, lastAt: 0 }));
  const raw = JSON.parse(JSON.stringify(model));
  const restored = validateTemporalReturns(raw, 300);
  assert.deepEqual(restored, raw);
  assert.notEqual(restored.rows, raw.rows);
  assert.notEqual(restored.rows[0].q, raw.rows[0].q);
  assert.notEqual(restored.transitions[0].reward, raw.transitions[0].reward);
  const before = copy(raw);
  temporalPrediction(restored, key(0)).q[0] = 999;
  assert.deepEqual(restored, before, 'prediction vectors are not mutable aliases into parameters');
  raw.rows[0].q[0] = 999;
  raw.transitions[0].reward[0] = 999;
  assert.deepEqual(restored, before);
});

test('malformed and duplicate live records cannot mutate visits, cursor or predictions', () => {
  const model = createTemporalReturns();
  const good = transition();
  const invalid = [
    null, {}, { ...good, seq: 0 }, { ...good, seq: 1.5 }, { ...good, nextSeq: 1 },
    { ...good, nextSeq: NaN }, { ...good, seq: Number.MAX_SAFE_INTEGER + 1, nextSeq: Number.MAX_SAFE_INTEGER + 2 },
    { ...good, startAt: -1 }, { ...good, endAt: -1 },
    { ...good, startAt: 2, endAt: 1 }, { ...good, endAt: Infinity },
    { ...good, reward: Array(5) }, { ...good, reward: [0, 0, , 0, 0] },
    { ...good, reward: [0, 0, 0, 0] }, { ...good, reward: [0, 0, 0, 0, 0, 0] },
    { ...good, reward: [-1, 0, 0, 0, 0] }, { ...good, reward: [NaN, 0, 0, 0, 0] },
    { ...good, reward: [10001, 0, 0, 0, 0] }, { ...good, key: '{}' },
    { ...good, key: ` ${good.key}` }, { ...good, nextKey: JSON.stringify(['sample', { private: 'unvalidated' }]) },
  ];
  const empty = copy(model);
  for (const record of invalid) {
    assert.equal(appendTemporalTransition(model, record), false);
    assert.deepEqual(model, empty);
  }
  append(model, good);
  const once = copy(model);
  good.reward[0] = 123;
  assert.deepEqual(model, once, 'admission copies caller-owned rewards');
  assert.equal(appendTemporalTransition(model, transition({ reward: [8, 7, 6, 5, 4] })), false);
  assert.deepEqual(model, once);
});

test('live admission rejects overlapping chronology just as restore does', () => {
  const model = createTemporalReturns();
  append(model, transition({ startAt: 10, endAt: 20 }));
  const before = copy(model);
  assert.equal(appendTemporalTransition(model, transition({ seq: 2, nextSeq: 3, startAt: 19, endAt: 21, key: key(1), nextKey: key(2) })), false);
  assert.deepEqual(model, before);
  append(model, transition({ seq: 2, nextSeq: 3, startAt: 20, endAt: 20, key: key(1), nextKey: key(2) }));
  assert.deepEqual(validateTemporalReturns(model, 20), model, 'equal-time ordered submissions remain valid');
});

test('restore rejects malformed, duplicate and future parameters/history durably', () => {
  const raw = createTemporalReturns();
  raw.lastClosedSeq = 9;
  raw.updateCount = 0;
  raw.rows = [
    learnedRow(key(0), ZERO, { visits: 0, updates: 0, lastAt: 0 }),
    learnedRow(key(0), [9, 9, 9, 9, 9]),
    learnedRow(key(1), [NaN, 0, 0, 0, 0]),
    learnedRow(key(2), [-1, 0, 0, 0, 0]),
    learnedRow(key(3), ZERO, { lastAt: 11 }),
    learnedRow(key(4), ZERO, { visits: -1 }),
    learnedRow(key(5), ZERO, { updates: 0.5 }),
    learnedRow(` ${key(6)}`, ZERO),
    learnedRow(key(7), [10001, 0, 0, 0, 0], { visits: 1e10, updates: 1e10 }),
    learnedRow(key(8), Array(5)),
    learnedRow(key(9), [0, 0, , 0, 0]),
  ];
  raw.rows[9].q = Array(5);
  raw.rows[10].q = [0, 0, , 0, 0];
  raw.transitions = [
    transition({ endAt: 1 }),
    transition({ reward: [9, 9, 9, 9, 9] }),
    transition({ seq: 2, nextSeq: 3, startAt: 0, endAt: 2 }),
    transition({ seq: 3, nextSeq: 4, startAt: 2, endAt: 3, reward: [-1, 0, 0, 0, 0] }),
    transition({ seq: 4, nextSeq: 5, startAt: 4, endAt: 5 }),
    transition({ seq: 9, nextSeq: 10, startAt: 9, endAt: 11 }),
    transition({ seq: 10, nextSeq: 11, startAt: 9, endAt: 10 }),
  ];
  const restored = validateTemporalReturns(raw, 10);
  assert.deepEqual(restored.rows.map(row => row.key), [key(0), key(7)]);
  assert.deepEqual(restored.rows[0], raw.rows[0]);
  assert.deepEqual(restored.rows[1].q, [10000, 0, 0, 0, 0]);
  assert.equal(restored.rows[1].visits, 1e9);
  assert.equal(restored.rows[1].updates, 1e9);
  assert.equal(restored.numericalGuard, true, 'clamping is disclosed, not silently confidence');
  assert.deepEqual(restored.transitions.map(record => record.seq), [1, 4]);
  assert.equal(restored.updateCount, 0);
  const reopened = validateTemporalReturns(JSON.parse(JSON.stringify(restored)), 100);
  assert.deepEqual(reopened, restored, 'future history removed now cannot reappear when the clock catches up');
  assert.equal(appendTemporalTransition(reopened, raw.transitions[5]), false, 'cursor prevents re-presented rejected history');
});

test('public keys ignore opaque identities, hidden physiology, provenance IDs and unlisted fields', () => {
  const publicContext = context(4);
  publicContext.history = [{ operation: 'pull', outcome: 'success' }, { operation: 'sample', outcome: 'refused' }];
  publicContext.exposures = [{ scope: 'own', age: '45..180', channels: 1, count: 1 }];
  const decorated = copy(publicContext);
  Object.assign(decorated, { id: 'object:12', targetId: 'object:12', sourceId: 'object:7', ingestionId: 'ingestion:45',
    species: 'apple', nutrition: 95, massGrams: 180, health: 100, expectedReward: 1,
    physiology: { availableEnergyKcal: 999, stomach: [{ energyKcal: 50 }] },
    futureFeedback: 'sustained', privateMemory: ['test oracle'] });
  Object.assign(decorated.body, { availableEnergyKcal: 100, waterDeficitMl: 300, health: 17 });
  Object.assign(decorated.appearance, { species: 'apple', edible: true, nutrition: 95, details: 'private answer', sound: 'rustling' });
  Object.assign(decorated.history[0], { actionId: 12, objectId: 'object:12', progress: 0.8 });
  Object.assign(decorated.exposures[0], { ingestionId: 'ingestion:45', objectId: 'object:12', expectedFood: 1 });
  assert.equal(temporalKey(decorated, 'sample'), temporalKey(publicContext, 'sample'));
  decorated.id = decorated.targetId = 'object:987';
  decorated.sourceId = 'object:654';
  decorated.ingestionId = 'ingestion:999';
  assert.equal(temporalKey(decorated, 'sample'), temporalKey(publicContext, 'sample'));
  assert.notEqual(temporalKey(publicContext, 'sample'), temporalKey(publicContext, 'release'));
  assert.notEqual(temporalKey({ ...publicContext, relation: 'reach' }, 'sample'), temporalKey(publicContext, 'sample'));
  assert.notEqual(temporalKey({ ...publicContext, historyCensored: true }, 'sample'), temporalKey(publicContext, 'sample'));
  assert.throws(() => temporalKey(publicContext, 'eat_known_food'), TypeError);
});

test('key normalization preserves unknown and actual exposed-channel distinctions', () => {
  const a = context(0);
  a.exposures = [
    { scope: 'own', age: '45..180', channels: 1, count: 1 },
    { scope: 'other', age: '<45', channels: 0, count: 1 },
    { scope: 'own', age: '45..180', channels: 1, count: 1 },
  ];
  const b = copy(a);
  b.exposures = [a.exposures[1], { scope: 'own', age: '45..180', channels: 1, count: 2 }];
  assert.equal(temporalKey(a, 'wait'), temporalKey(b, 'wait'));
  b.exposures[1].channels = 3;
  assert.notEqual(temporalKey(a, 'wait'), temporalKey(b, 'wait'), 'earlier food and later water remain distinguishable');
  assert.notEqual(temporalKey({ history: [{ operation: 'strike', outcome: 'unknown' }] }, 'wait'),
    temporalKey({ history: [{ operation: 'strike', outcome: 'physical failure' }] }, 'wait'));
  assert.notEqual(temporalKey({}, 'wait'), temporalKey({ appearance: { shape: 'round' } }, 'wait'));
});

test('row-cap overflow remains unknown while durable rows are retained unchanged', () => {
  const model = createTemporalReturns();
  model.rows = Array.from({ length: 4096 }, (_, i) => learnedRow(key(i), [1, 2, 3, 4, 5]));
  const originalRows = copy(model.rows);
  const overflow = key(4096);
  const nextUnknown = key(4097);
  append(model, transition({ key: overflow, nextKey: nextUnknown }));
  assert.equal(model.saturated, true);
  assert.equal(model.rows.length, 4096);
  assert.deepEqual(temporalPrediction(model, overflow), { q: [...ZERO], visits: 0, known: false });
  assert.deepEqual(temporalPrediction(model, nextUnknown), { q: [...ZERO], visits: 0, known: false });
  assert.deepEqual(trainTemporalReturns(model), { targets: 8, updatedRows: 0 });
  assert.deepEqual(model.rows, originalRows);
  assert.deepEqual(temporalPrediction(model, overflow), { q: [...ZERO], visits: 0, known: false });
  // This pure predictor has no chooser. Unknown must remain explicit so a later
  // chooser cannot mistake overflow's zero vector for learned zero-cost value.
  const restored = validateTemporalReturns(JSON.parse(JSON.stringify(model)), 1);
  assert.deepEqual(restored, model);
  assert.equal(temporalPrediction(restored, overflow).known, false);
});


test('sequence admission cannot become duplicate experience after cursor restoration', () => {
  for (const seq of [999999999, 1000000000, 1000000001, Number.MAX_SAFE_INTEGER - 1]) {
    const model = createTemporalReturns();
    const record = transition({ seq, nextSeq: seq + 1, reward: [1, 0, 0, 0, 0] });
    const admitted = appendTemporalTransition(model, record);
    if (!admitted) {
      // A declared bounded sequence space may reject this record, but must do so
      // atomically. An accepted record must survive reopen without cursor loss.
      assert.deepEqual(model, createTemporalReturns());
      continue;
    }
    const restored = validateTemporalReturns(JSON.parse(JSON.stringify(model)), 1);
    assert.deepEqual(restored, model, `accepted sequence ${seq} must round-trip`);
    assert.equal(appendTemporalTransition(restored, record), false, `sequence ${seq} cannot be experienced twice`);
    assert.deepEqual(restored, model);
  }
});


test('compact keys losslessly preserve every public field and reject noncanonical encodings', () => {
  const raw = {
    body: { hunger: 'hungry', thirst: 'thirsty', energy: 'low', stamina: 'winded', fatigue: 'weary', pain: 'aching', digestion: 'full' },
    appearance: Object.fromEntries(['shape', 'color', 'texture', 'motion', 'size', 'smell'].map(k => [k, `${k}:語\"\\`.repeat(20)])),
    warmth: 'cold', shelter: 'sheltered', relation: 'held', focus: true, outputOfFocus: true,
    heldCount: 4, countBand: '2+', workBand: '8..15', historyCensored: true,
    history: [{ operation: 'pull', outcome: 'physical failure' }, { operation: 'sample', outcome: 'success' }],
    exposures: ['own', 'other'].flatMap(scope => ['<45', '45..180', '180..600', '>600'].flatMap(age =>
      Array.from({ length: 8 }, (_, channels) => ({ scope, age, channels, count: 1 + channels % 2 })))),
  };
  const encoded = temporalKey(raw, 'sample');
  assert.deepEqual(decodeTemporalKey(encoded), { operation: 'sample', context: temporalContext(raw) });
  for (const mutate of [a => a.push('extra'), a => a[0] = 2, a => a[2].push('extra'),
    a => a[6] = '3'.repeat(64), a => a[6] = '0'.repeat(63), a => a[7] = 1]) {
    const altered = JSON.parse(encoded); mutate(altered);
    assert.equal(decodeTemporalKey(JSON.stringify(altered)), null);
  }
});

test('one-pass exposure accumulation preserves ordered capped counts for duplicate and malformed observations', () => {
  let seed = 74193;
  const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  const values = [undefined, null, NaN, Infinity, -1, -0, 0, 1, 2, 3, 1.5, '1', Number.MAX_SAFE_INTEGER];
  for (let trial = 0; trial < 256; trial++) {
    const exposures = Array.from({length: random(180)}, () => ({
      scope: ['own', 'other', 'invalid', null][random(4)],
      age: ['<45', '45..180', '180..600', '>600', null][random(5)],
      channels: values[random(values.length)], count: values[random(values.length)],
    }));
    const expected = [];
    for (const scope of ['own', 'other']) for (const age of ['<45', '45..180', '180..600', '>600']) for (let channels = 0; channels < 8; channels++) {
      const count = exposures.filter(e => e.scope === scope && e.age === age && e.channels === channels)
        .reduce((n, e) => n + (Number.isSafeInteger(e.count) && e.count >= 0 ? Math.min(2, e.count) : 0), 0);
      if (count) expected.push({scope, age, channels, count: Math.min(2, count)});
    }
    assert.deepEqual(temporalContext({exposures}).exposures, expected);
  }
});
