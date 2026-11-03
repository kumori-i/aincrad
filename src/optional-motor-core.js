/**
 * A session-only numeric predictor of result.ok for one personally paid,
 * completed optional motor experiment. Admission and completion are separate
 * authority checks performed by the caller. It knows no world, object,
 * food, agent, receipt, or authored choice score. The caller owns all causal
 * admission and must never turn an uncompleted action into a training target.
 *
 * Features 0..6 are exactly one primitive bit; 7..11 are bounded local numeric
 * context. Feature construction and action authority belong outside this core.
 */
export const OPTIONAL_MOTOR_FEATURE_COUNT = 12;
const PRIMITIVE_FEATURE_COUNT = 7;
const MAX_ABS_PARAMETER = 1e6;
const LEARNING_RATE = .05;
const MAX_GRADIENT_NORM = 1;

function features(value) {
  if (!(value instanceof Float64Array) || value.length !== OPTIONAL_MOTOR_FEATURE_COUNT) {
    throw new TypeError('Optional motor features must be a 12-value Float64Array');
  }
  let selected = 0;
  for (let i = 0; i < value.length; i++) {
    if (!Number.isFinite(value[i]) || value[i] < 0 || value[i] > 1) {
      throw new RangeError('Optional motor features must be finite values in [0, 1]');
    }
    if (i < PRIMITIVE_FEATURE_COUNT) {
      if (value[i] !== 0 && value[i] !== 1) throw new RangeError('Optional motor primitive feature must be a bit');
      selected += value[i];
    }
  }
  if (selected !== 1) throw new RangeError('Optional motor features need one primitive');
  return value;
}

function model(value) {
  if (!value || !(value.weights instanceof Float64Array) ||
      value.weights.length !== OPTIONAL_MOTOR_FEATURE_COUNT ||
      !Number.isFinite(value.bias) || Math.abs(value.bias) > MAX_ABS_PARAMETER) {
    throw new TypeError('Invalid optional motor model');
  }
  for (const weight of value.weights) {
    if (!Number.isFinite(weight) || Math.abs(weight) > MAX_ABS_PARAMETER) {
      throw new RangeError('Optional motor parameter is non-finite or out of range');
    }
  }
  return value;
}

function target(value) {
  if (value !== 0 && value !== 1) throw new TypeError('Optional motor target must be 0 or 1');
  return value;
}

function logit(validModel, validFeatures) {
  let value = validModel.bias;
  for (let i = 0; i < OPTIONAL_MOTOR_FEATURE_COUNT; i++) {
    value += validModel.weights[i] * validFeatures[i];
  }
  return value;
}

function sigmoid(value) {
  if (value >= 0) return 1 / (1 + Math.exp(-value));
  const exponential = Math.exp(value);
  return exponential / (1 + exponential);
}

function softplus(value) {
  return Math.max(0, value) + Math.log1p(Math.exp(-Math.abs(value)));
}

function boundedParameter(value) {
  return Math.max(-MAX_ABS_PARAMETER, Math.min(MAX_ABS_PARAMETER, value));
}

export function createOptionalMotorModel() {
  return { weights: new Float64Array(OPTIONAL_MOTOR_FEATURE_COUNT), bias: 0 };
}

export function copyOptionalMotorModel(value) {
  const valid = model(value);
  return { weights: new Float64Array(valid.weights), bias: valid.bias };
}

export function optionalMotorProbability(value, input) {
  return sigmoid(logit(model(value), features(input)));
}

/** Central-difference-friendly derivative of stable binary cross entropy. */
export function optionalMotorGradient(value, input, outcome) {
  const validModel = model(value), validFeatures = features(input), y = target(outcome);
  const score = logit(validModel, validFeatures);
  const probability = sigmoid(score);
  const error = probability - y;
  const weights = new Float64Array(OPTIONAL_MOTOR_FEATURE_COUNT);
  let squaredNorm = error * error; // bias
  for (let i = 0; i < weights.length; i++) {
    weights[i] = error * validFeatures[i];
    squaredNorm += weights[i] * weights[i];
  }
  return {
    weights,
    bias: error,
    probability,
    loss: softplus(y === 1 ? -score : score),
    gradientNorm: Math.sqrt(squaredNorm),
  };
}

/** Fixed-rate clipped SGD; neither the input model nor features are mutated. */
export function updateOptionalMotorModel(value, input, outcome) {
  const gradient = optionalMotorGradient(value, input, outcome);
  const next = copyOptionalMotorModel(value);
  const scale = gradient.gradientNorm > MAX_GRADIENT_NORM
    ? MAX_GRADIENT_NORM / gradient.gradientNorm : 1;
  for (let i = 0; i < next.weights.length; i++) {
    next.weights[i] = boundedParameter(next.weights[i] - LEARNING_RATE * scale * gradient.weights[i]);
  }
  next.bias = boundedParameter(next.bias - LEARNING_RATE * scale * gradient.bias);
  model(next);
  return { model: next, probability: gradient.probability, loss: gradient.loss,
    gradientNorm: gradient.gradientNorm, gradientScale: scale };
}
