import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OPTIONAL_MOTOR_FEATURE_COUNT,
  createOptionalMotorModel,
  copyOptionalMotorModel,
  optionalMotorProbability,
  optionalMotorGradient,
  updateOptionalMotorModel,
} from '../src/optional-motor-core.js';

function input(primitive = 2, context = [.3, .5, .2, .1, 1]) {
  const vector = new Float64Array(OPTIONAL_MOTOR_FEATURE_COUNT);
  vector[primitive] = 1;
  vector.set(context, 7);
  return vector;
}

test('cold numeric predictor is neutral and validates the full bounded interface', () => {
  const fresh = createOptionalMotorModel(), x = input();
  assert.equal(optionalMotorProbability(fresh, x), .5);
  assert.equal(optionalMotorGradient(fresh, x, 1).loss, Math.log(2));
  assert.throws(() => optionalMotorProbability(fresh, Array.from(x)), /Float64Array/);
  assert.throws(() => optionalMotorProbability(fresh, new Float64Array(11)), /12-value/);
  for (const [index, invalid] of [[0, .5], [7, NaN], [8, Infinity], [9, -1], [10, 1.01]]) {
    const bad = input(); bad[index] = invalid;
    assert.throws(() => optionalMotorProbability(fresh, bad), /feature|primitive/);
  }
  const two = input(); two[1] = 1;
  assert.throws(() => optionalMotorProbability(fresh, two), /one primitive/);
  const none = input(); none[2] = 0;
  assert.throws(() => optionalMotorProbability(fresh, none), /one primitive/);
  for (const invalid of [-1, .5, 2, NaN, '1']) {
    assert.throws(() => optionalMotorGradient(fresh, x, invalid), /target/);
  }
  assert.throws(() => optionalMotorProbability({ weights: new Float64Array(11), bias: 0 }, x), /model/);
  const broken = copyOptionalMotorModel(fresh); broken.weights[0] = NaN;
  assert.throws(() => optionalMotorProbability(broken, x), /parameter/);
});

test('all parameter gradients match central differences, including inactive primitive weights', () => {
  const x = input(3, [.25, .45, .65, .15, 1]);
  const model = createOptionalMotorModel();
  for (let i = 0; i < model.weights.length; i++) model.weights[i] = (i - 5) * .037;
  model.bias = -.16;
  const step = 1e-6;
  for (const outcome of [0, 1]) {
    const analytic = optionalMotorGradient(model, x, outcome);
    const loss = m => optionalMotorGradient(m, x, outcome).loss;
    for (let i = 0; i < model.weights.length; i++) {
      const plus = copyOptionalMotorModel(model), minus = copyOptionalMotorModel(model);
      plus.weights[i] += step; minus.weights[i] -= step;
      const numeric = (loss(plus) - loss(minus)) / (2 * step);
      assert.ok(Math.abs(numeric - analytic.weights[i]) < 1e-9,
        `outcome ${outcome}, weight ${i}: ${numeric} versus ${analytic.weights[i]}`);
    }
    const plus = copyOptionalMotorModel(model), minus = copyOptionalMotorModel(model);
    plus.bias += step; minus.bias -= step;
    const numeric = (loss(plus) - loss(minus)) / (2 * step);
    assert.ok(Math.abs(numeric - analytic.bias) < 1e-9);
  }
});

test('extreme finite logits have finite probability, loss, gradient and update', () => {
  const x = input(0, [1, 1, 1, 1, 1]);
  for (const sign of [-1, 1]) {
    const model = createOptionalMotorModel();
    model.weights[0] = sign * 1e6;
    model.bias = sign * 1e6;
    for (const outcome of [0, 1]) {
      const gradient = optionalMotorGradient(model, x, outcome);
      assert.ok(Number.isFinite(gradient.probability));
      assert.ok(Number.isFinite(gradient.loss));
      assert.ok(Number.isFinite(gradient.gradientNorm));
      assert.ok(gradient.weights.every(Number.isFinite));
      const next = updateOptionalMotorModel(model, x, sign > 0 ? 0 : 1);
      assert.ok(Number.isFinite(next.loss));
      assert.ok(next.model.weights.every(Number.isFinite));
    }
    const correctlyPredicted = updateOptionalMotorModel(model, x, sign > 0 ? 1 : 0);
    assert.deepEqual(correctlyPredicted.model, model,
      'A saturated correctly predicted result has zero gradient');
  }
});

test('an update at the accepted parameter boundary remains bounded', () => {
  const x = input(0, [1, 1, 0, 0, 0]);
  const model = createOptionalMotorModel();
  model.weights[0] = 1e6;
  model.weights[7] = -1e6;
  model.weights[8] = -1e6;
  const next = updateOptionalMotorModel(model, x, 1);
  assert.equal(next.model.weights[0], 1e6);
  assert.ok(next.model.weights[7] > -1e6);
  assert.ok(next.model.weights[8] > -1e6);
  assert.equal(model.weights[7], -1e6, 'The input state remains untouched');
  assert.ok(Number.isFinite(next.loss));
});

test('positive and negative paid outcomes move likelihood in opposite directions without aliases', () => {
  const base = createOptionalMotorModel(), x = input(4);
  const positive = updateOptionalMotorModel(base, x, 1);
  const negative = updateOptionalMotorModel(base, x, 0);
  assert.ok(optionalMotorProbability(positive.model, x) > .5);
  assert.ok(optionalMotorProbability(negative.model, x) < .5);
  assert.equal(optionalMotorProbability(base, x), .5);
  assert.equal(x[4], 1);
  positive.model.weights[4] = 7;
  assert.equal(base.weights[4], 0);
  assert.equal(negative.model.weights[4] < 0, true);
});

test('global norm clipping bounds one SGD update and short gradients stay unclipped', () => {
  const base = createOptionalMotorModel(), all = input(1, [1, 1, 1, 1, 1]);
  const clipped = updateOptionalMotorModel(base, all, 1);
  assert.ok(clipped.gradientNorm > 1);
  assert.equal(clipped.gradientScale, 1 / clipped.gradientNorm);
  const length = Math.hypot(clipped.model.bias - base.bias,
    ...clipped.model.weights.map((weight, i) => weight - base.weights[i]));
  assert.ok(Math.abs(length - .05) < 1e-14);
  const short = updateOptionalMotorModel(base, input(1, [0, 0, 0, 0, 0]), 1);
  assert.equal(short.gradientScale, 1);
  assert.ok(short.gradientNorm < 1);
});

test('copied state continues bit-for-bit with no RNG, history or input mutation', () => {
  const sequence = [[input(0), 1], [input(1, [.5, 0, 1, .3, 0]), 0],
    [input(0, [.2, .8, .4, 0, 1]), 1]];
  let first = createOptionalMotorModel();
  for (const [x, y] of sequence) first = updateOptionalMotorModel(first, x, y).model;
  let second = copyOptionalMotorModel(first);
  assert.notEqual(second.weights, first.weights);
  for (const [x, y] of sequence) {
    first = updateOptionalMotorModel(first, x, y).model;
    second = updateOptionalMotorModel(second, x, y).model;
  }
  assert.deepEqual(second, first);
  const detached = copyOptionalMotorModel(first);
  detached.weights[0] += 1;
  assert.notEqual(detached.weights[0], first.weights[0]);
});
