// Offline numeric policies for the physically grounded character-message
// channel. This module has no world, identity, authority, object-ID or critic
// input. The runtime adapter binds sampled trajectories to one-use handles.

export const CHARACTER_CORE = Object.freeze({
  features: 48, hidden: 16, letters: 26, eos: 26, maxLetters: 6,
  learningRate: .01, gradientClip: 1, baselineRetention: .95,
  replayCapacity: 128, replayPrior: 3, demonstrationMatch: .04,
  demonstrationGap: .02,
});
export const CHARACTER_RANDOM_PROTOCOL = 'character-weyl-fmix32-v1';
export const CHARACTER_RANDOM_PURPOSES = Object.freeze({
  senderInit: 11, senderSample: 12, listenerInit: 13,
  listenerChoice: 14, listenerReplay: 15,
  sequencePair: 16, sequenceTarget: 17, sequenceOrder: 18,
});

const C = CHARACTER_CORE;
const WEYL = 0x9e3779b9;
const UINT32_MAX = 0xffffffff;
const own = (value, key) => Object.hasOwn(value, key);
const uint32 = value => Number.isInteger(value) && value >= 0 && value <= UINT32_MAX;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const layouts = Object.freeze({
  sender: Object.freeze({Wx: C.hidden*C.features, b0: C.hidden,
    Wh: C.hidden*C.hidden, E: C.letters*C.hidden, bh: C.hidden,
    Wo: (C.letters+1)*C.hidden, bo: C.letters+1}),
  listener: Object.freeze({Wh: C.hidden*C.hidden, E: C.letters*C.hidden,
    bh: C.hidden, Wv: C.hidden*C.features, bv: C.hidden}),
});

function fmix32(value) {
  value ^= value >>> 16; value = Math.imul(value, 0x85ebca6b);
  value ^= value >>> 13; value = Math.imul(value, 0xc2b2ae35);
  value ^= value >>> 16; return value >>> 0;
}

export function initialCharacterRandomState({seed, identity=0, purpose} = {}) {
  if (!uint32(seed) || !uint32(identity) || !own(CHARACTER_RANDOM_PURPOSES, purpose))
    throw new TypeError('Expected uint32 seed/identity and a character RNG purpose');
  return fmix32(seed ^ fmix32(CHARACTER_RANDOM_PURPOSES[purpose]) ^ fmix32(identity ^ WEYL));
}

export function nextCharacterRandom(state) {
  if (!uint32(state)) throw new TypeError('Expected a uint32 character RNG state');
  const nextState = (state + WEYL) >>> 0;
  return {value: fmix32(nextState)/4294967296, state: nextState};
}

function parameters(kind, seed, identity) {
  if (!uint32(seed) || !uint32(identity)) throw new TypeError('Expected uint32 model seed/identity');
  let state = initialCharacterRandomState({seed, identity,
    purpose: kind === 'sender' ? 'senderInit' : 'listenerInit'});
  const result = {};
  for (const [name, length] of Object.entries(layouts[kind])) {
    const values = new Float64Array(length);
    if (!name.startsWith('b')) for (let i=0; i<length; i++) {
      const draw = nextCharacterRandom(state); state = draw.state;
      values[i] = (draw.value*2-1)*.05;
    }
    result[name] = values;
  }
  return result;
}

export function createSenderParameters({seed, identity=0} = {}) {
  return parameters('sender', seed, identity);
}

export function createListenerParameters({seed, identity=0} = {}) {
  return parameters('listener', seed, identity);
}

function validateParameters(kind, value) {
  const layout = layouts[kind];
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Reflect.ownKeys(value).length !== Object.keys(layout).length)
    throw new TypeError(`Invalid ${kind} parameter fields`);
  for (const [name, length] of Object.entries(layout)) {
    const values = value[name];
    if (!own(value, name) || !(values instanceof Float64Array || Array.isArray(values)) ||
        values.length !== length || Array.from(values).some(v => !finite(v) || Math.abs(v) > 1e6))
      throw new TypeError(`Invalid ${kind} parameter ${name}`);
  }
  return value;
}

function copiedParameters(kind, value) {
  validateParameters(kind, value);
  return Object.fromEntries(Object.keys(layouts[kind]).map(name => [name, Float64Array.from(value[name])]));
}

export function copySenderParameters(value) { return copiedParameters('sender', value); }
export function copyListenerParameters(value) { return copiedParameters('listener', value); }

function features(input) {
  if (!(Array.isArray(input) || input instanceof Float64Array || input instanceof Float32Array) ||
      input.length !== C.features || Array.from(input).some(v => !finite(v) || v < 0 || v > 1))
    throw new TypeError('Expected 48 finite own-view RGB features in [0,1]');
  return Float64Array.from(input);
}

function candidates(input) {
  if (!Array.isArray(input) || input.length !== 2)
    throw new TypeError('Expected two own-view candidates');
  return input.map(features);
}

function normalized(input) { return Float64Array.from(input, value => value*2-1); }

function messageTokens(message) {
  if (typeof message !== 'string' || !/^[a-z]{1,6}$/.test(message))
    throw new TypeError('Expected one to six visible lowercase letters');
  return Array.from(message, letter => letter.charCodeAt(0)-97);
}

function trajectoryParts(trajectory) {
  if (!trajectory || typeof trajectory !== 'object' || Array.isArray(trajectory) ||
      Reflect.ownKeys(trajectory).length !== 2 || !own(trajectory, 'features') ||
      !own(trajectory, 'tokens') || !Array.isArray(trajectory.tokens))
    throw new TypeError('Invalid sampled sender trajectory');
  const input = features(trajectory.features), tokens = trajectory.tokens;
  const hasEos = tokens.at(-1) === C.eos;
  const letters = hasEos ? tokens.length-1 : tokens.length;
  if (letters < 1 || letters > C.maxLetters || (hasEos && letters === C.maxLetters) ||
      (!hasEos && letters !== C.maxLetters) ||
      tokens.length > C.maxLetters+1 ||
      tokens.slice(0, letters).some(t => !Number.isInteger(t) || t < 0 || t >= C.letters) ||
      hasEos && tokens.length !== letters+1)
    throw new TypeError('Invalid sender decisions or forced-cap termination');
  return {input, tokens: tokens.slice(), letters, hasEos};
}

// The log values are computed against the maximum, so a 2000-logit gap keeps
// its finite log probability even when its ordinary probability underflows.
export function stableSoftmax(logits, masked=[]) {
  if (!(Array.isArray(logits) || logits instanceof Float64Array) || !logits.length ||
      logits.length > C.letters+1 || !Array.isArray(masked) || masked.length > logits.length ||
      Array.from(logits).some(v => !finite(v)) ||
      masked.some(i => !Number.isInteger(i) || i < 0 || i >= logits.length) ||
      new Set(masked).size !== masked.length)
    throw new TypeError('Expected finite logits and valid mask indices');
  const excluded = new Set(masked);
  let maximum = -Infinity;
  for (let i=0; i<logits.length; i++) if (!excluded.has(i)) maximum = Math.max(maximum, logits[i]);
  if (!Number.isFinite(maximum)) throw new TypeError('Softmax has no available token');
  const exponentials = new Float64Array(logits.length);
  let total = 0;
  for (let i=0; i<logits.length; i++) if (!excluded.has(i)) {
    exponentials[i] = Math.exp(logits[i]-maximum); total += exponentials[i];
  }
  const probabilities = Array.from(exponentials, value => value/total);
  const logProbabilities = Array.from(logits, (value, i) =>
    excluded.has(i) ? -Infinity : value-maximum-Math.log(total));
  return {probabilities, logProbabilities};
}

function affine(matrix, rows, columns, vector, bias) {
  const output = new Float64Array(rows);
  for (let i=0; i<rows; i++) {
    let value = bias[i];
    for (let j=0; j<columns; j++) value += matrix[i*columns+j]*vector[j];
    if (!Number.isFinite(value)) throw new TypeError('Nonfinite numeric policy activation');
    output[i] = value;
  }
  return output;
}

function tanhAffine(matrix, rows, columns, vector, bias, embedding, letter) {
  const output = affine(matrix, rows, columns, vector, bias);
  for (let i=0; i<rows; i++) output[i] = Math.tanh(output[i]+(embedding ? embedding[letter*rows+i] : 0));
  return output;
}

function senderInitial(model, input) {
  return tanhAffine(model.Wx, C.hidden, C.features, normalized(input), model.b0);
}

function senderNext(model, hidden, letter) {
  return tanhAffine(model.Wh, C.hidden, C.hidden, hidden, model.bh, model.E, letter);
}

function senderStep(model, hidden, first) {
  const logits = affine(model.Wo, C.letters+1, C.hidden, hidden, model.bo);
  return stableSoftmax(logits, first ? [C.eos] : []);
}

export function senderNextTokenDistribution(model, ownFeatures, prefix='') {
  validateParameters('sender', model);
  const input = features(ownFeatures);
  if (typeof prefix !== 'string' || !/^[a-z]{0,5}$/.test(prefix))
    throw new TypeError('Expected a prefix of at most five visible letters');
  let hidden = senderInitial(model, input);
  for (const letter of prefix) hidden = senderNext(model, hidden, letter.charCodeAt(0)-97);
  const step = senderStep(model, hidden, prefix.length === 0);
  return {probabilities: step.probabilities.slice(), logProbabilities: step.logProbabilities.slice()};
}

function sampleIndex(probabilities, randomValue) {
  let cumulative = 0;
  for (let i=0; i<probabilities.length; i++) {
    cumulative += probabilities[i];
    if (randomValue < cumulative) return i;
  }
  return probabilities.findLastIndex(value => value > 0); // rounding only
}

export function sampleSender(model, ownFeatures, randomState) {
  validateParameters('sender', model);
  const input = features(ownFeatures);
  let hidden = senderInitial(model, input), state = randomState;
  const tokens = [];
  for (let index=0; index<C.maxLetters+1; index++) {
    const {probabilities} = senderStep(model, hidden, index === 0);
    const draw = nextCharacterRandom(state); state = draw.state;
    const token = sampleIndex(probabilities, draw.value);
    tokens.push(token);
    if (token === C.eos || tokens.length === C.maxLetters) break;
    hidden = senderNext(model, hidden, token);
  }
  const message = String.fromCharCode(...tokens.filter(token => token !== C.eos).map(token => token+97));
  return {message, trajectory: {features: Array.from(input), tokens: tokens.slice()}, randomState: state};
}

function senderTrace(model, trajectory) {
  validateParameters('sender', model);
  const {input, tokens} = trajectoryParts(trajectory);
  const hidden = [senderInitial(model, input)], steps = [];
  let logProbability = 0;
  for (let i=0; i<tokens.length; i++) {
    const step = senderStep(model, hidden[i], i === 0);
    logProbability += step.logProbabilities[tokens[i]];
    steps.push(step);
    if (i < tokens.length-1) hidden.push(senderNext(model, hidden[i], tokens[i]));
  }
  return {input, tokens, hidden, steps, logProbability};
}

export function senderLogProbability(model, trajectory) {
  return senderTrace(model, trajectory).logProbability;
}

function zeros(kind) {
  return Object.fromEntries(Object.entries(layouts[kind]).map(([name, length]) =>
    [name, new Float64Array(length)]));
}

export function senderGradient(model, trajectory, advantage) {
  if (!finite(advantage) || Math.abs(advantage) > 2)
    throw new TypeError('Expected finite sender advantage in [-2,2]');
  const trace = senderTrace(model, trajectory), gradient = zeros('sender');
  let nextPre = null;
  for (let t=trace.tokens.length-1; t>=0; t--) {
    const h = trace.hidden[t], token = trace.tokens[t], probs = trace.steps[t].probabilities;
    const dh = new Float64Array(C.hidden);
    for (let k=0; k<=C.letters; k++) {
      const derivative = advantage*(probs[k]-(k === token ? 1 : 0));
      gradient.bo[k] += derivative;
      for (let j=0; j<C.hidden; j++) {
        gradient.Wo[k*C.hidden+j] += derivative*h[j];
        dh[j] += model.Wo[k*C.hidden+j]*derivative;
      }
    }
    if (nextPre) {
      for (let i=0; i<C.hidden; i++) {
        gradient.bh[i] += nextPre[i];
        gradient.E[token*C.hidden+i] += nextPre[i];
        for (let j=0; j<C.hidden; j++) {
          gradient.Wh[i*C.hidden+j] += nextPre[i]*h[j];
          dh[j] += model.Wh[i*C.hidden+j]*nextPre[i];
        }
      }
    }
    nextPre = Float64Array.from(dh, (value, j) => value*(1-h[j]*h[j]));
  }
  const x = normalized(trace.input);
  for (let i=0; i<C.hidden; i++) {
    gradient.b0[i] = nextPre[i];
    for (let j=0; j<C.features; j++) gradient.Wx[i*C.features+j] = nextPre[i]*x[j];
  }
  return {gradient, loss: -advantage*trace.logProbability,
    logProbability: trace.logProbability};
}

export function applyClippedGradient(kind, model, rawGradient) {
  if (!own(layouts, kind)) throw new TypeError('Unknown numeric policy kind');
  validateParameters(kind, model);
  if (!rawGradient || typeof rawGradient !== 'object' || Array.isArray(rawGradient) ||
      Reflect.ownKeys(rawGradient).length !== Object.keys(layouts[kind]).length)
    throw new TypeError('Invalid numeric gradient fields');
  // Scale before squaring: even a finite but extreme supplied gradient must
  // receive a true global clip instead of overflow turning its update into 0.
  let largest = 0, scaledSquares = 1;
  for (const [name, length] of Object.entries(layouts[kind])) {
    const values = rawGradient[name];
    if (!own(rawGradient, name) || !(values instanceof Float64Array || Array.isArray(values)) || values.length !== length)
      throw new TypeError(`Invalid numeric gradient ${name}`);
    for (const value of values) {
      if (!finite(value)) throw new TypeError(`Nonfinite numeric gradient ${name}`);
      const magnitude = Math.abs(value);
      if (magnitude > largest) {
        scaledSquares = 1+scaledSquares*(largest/magnitude)**2;
        largest = magnitude;
      } else if (magnitude > 0) scaledSquares += (magnitude/largest)**2;
    }
  }
  const scaledNorm = Math.sqrt(scaledSquares);
  const gradientNorm = largest*scaledNorm;
  const clipScale = gradientNorm > C.gradientClip ? C.gradientClip/gradientNorm : 1;
  const updated = copiedParameters(kind, model);
  for (const name of Object.keys(layouts[kind])) {
    for (let i=0; i<updated[name].length; i++) {
      const clipped = gradientNorm > C.gradientClip ?
        rawGradient[name][i]/largest/scaledNorm : rawGradient[name][i];
      updated[name][i] -= C.learningRate*clipped;
    }
  }
  validateParameters(kind, updated);
  return {model: updated, gradientNorm, clipScale};
}

export function trainSender(model, trajectory, {reward, baseline} = {}) {
  if (reward !== 1 && reward !== -1) throw new TypeError('Only observed match/mismatch rewards train the sender');
  if (!finite(baseline) || baseline < -1 || baseline > 1)
    throw new TypeError('Expected a finite sender baseline in [-1,1]');
  const advantage = reward-baseline;
  const result = senderGradient(model, trajectory, advantage);
  const step = applyClippedGradient('sender', model, result.gradient);
  return {...step, baseline: C.baselineRetention*baseline+(1-C.baselineRetention)*reward,
    advantage, logProbabilityBefore: result.logProbability,
    logProbabilityAfter: senderLogProbability(step.model, trajectory)};
}

function listenerTrace(model, message, ownCandidates) {
  validateParameters('listener', model);
  const tokens = messageTokens(message), pair = candidates(ownCandidates);
  const hidden = [new Float64Array(C.hidden)];
  for (const letter of tokens)
    hidden.push(tanhAffine(model.Wh, C.hidden, C.hidden, hidden.at(-1), model.bh, model.E, letter));
  const final = hidden.at(-1);
  const visual = pair.map(input => tanhAffine(model.Wv, C.hidden, C.features, normalized(input), model.bv));
  const scores = visual.map(z => {
    let score = 0;
    for (let j=0; j<C.hidden; j++) score += final[j]*z[j]/4;
    return score;
  });
  const distribution = stableSoftmax(scores);
  return {tokens, pair, hidden, visual, scores, ...distribution};
}

export function listenerDistribution(model, message, ownCandidates, {hasDemonstration=false} = {}) {
  if (typeof hasDemonstration !== 'boolean') throw new TypeError('Expected a demonstration gate');
  if (!hasDemonstration) {
    validateParameters('listener', model); messageTokens(message); candidates(ownCandidates);
    return {scores: [0,0], probabilities: [.5,.5]};
  }
  const result = listenerTrace(model, message, ownCandidates);
  return {scores: result.scores.slice(), probabilities: result.probabilities.slice()};
}

export function sampleListener(model, message, ownCandidates, randomState, options={}) {
  const distribution = listenerDistribution(model, message, ownCandidates, options);
  const draw = nextCharacterRandom(randomState);
  return {choice: sampleIndex(distribution.probabilities, draw.value),
    probabilities: distribution.probabilities, randomState: draw.state};
}

function validExample(example) {
  if (!example || typeof example !== 'object' || Array.isArray(example) ||
      Reflect.ownKeys(example).length !== 3 || !own(example, 'message') ||
      !own(example, 'candidates') || !own(example, 'label') ||
      (example.label !== 0 && example.label !== 1))
    throw new TypeError('Expected a numeric own-view demonstrated example');
  messageTokens(example.message); candidates(example.candidates);
  return example;
}

export function listenerCrossEntropy(model, example) {
  validExample(example);
  return -listenerTrace(model, example.message, example.candidates).logProbabilities[example.label];
}

export function listenerGradient(model, example) {
  validExample(example);
  const trace = listenerTrace(model, example.message, example.candidates);
  const gradient = zeros('listener'), final = trace.hidden.at(-1);
  let dh = new Float64Array(C.hidden);
  for (let candidate=0; candidate<2; candidate++) {
    const dscore = trace.probabilities[candidate]-(candidate === example.label ? 1 : 0);
    const z = trace.visual[candidate], x = normalized(trace.pair[candidate]);
    for (let i=0; i<C.hidden; i++) {
      dh[i] += dscore*z[i]/4;
      const dzPre = dscore*final[i]/4*(1-z[i]*z[i]);
      gradient.bv[i] += dzPre;
      for (let j=0; j<C.features; j++) gradient.Wv[i*C.features+j] += dzPre*x[j];
    }
  }
  for (let t=trace.tokens.length; t>=1; t--) {
    const h = trace.hidden[t], previous = trace.hidden[t-1], letter = trace.tokens[t-1];
    const before = new Float64Array(C.hidden);
    for (let i=0; i<C.hidden; i++) {
      const dpre = dh[i]*(1-h[i]*h[i]);
      gradient.bh[i] += dpre;
      gradient.E[letter*C.hidden+i] += dpre;
      for (let j=0; j<C.hidden; j++) {
        gradient.Wh[i*C.hidden+j] += dpre*previous[j];
        before[j] += model.Wh[i*C.hidden+j]*dpre;
      }
    }
    dh = before;
  }
  return {gradient, loss: -trace.logProbabilities[example.label]};
}

export function trainListenerBatch(model, examples) {
  if (!Array.isArray(examples) || examples.length < 1 || examples.length > C.replayPrior+1)
    throw new TypeError('Expected one new example plus at most three prior examples');
  const sum = zeros('listener');
  let lossBefore = 0;
  for (const example of examples) {
    const result = listenerGradient(model, example);
    lossBefore += result.loss;
    for (const name of Object.keys(sum))
      for (let i=0; i<sum[name].length; i++) sum[name][i] += result.gradient[name][i]/examples.length;
  }
  const step = applyClippedGradient('listener', model, sum);
  return {...step, lossBefore: lossBefore/examples.length,
    lossAfter: examples.reduce((total, example) => total+listenerCrossEntropy(step.model, example),0)/examples.length};
}

export function classifyOwnDemonstration(ownCandidates, demonstratedFeatures) {
  const pair = candidates(ownCandidates), observed = features(demonstratedFeatures);
  const distances = pair.map(input => {
    let sum = 0;
    for (let i=0; i<C.features; i++) sum += (input[i]-observed[i])**2;
    return Math.sqrt(sum/C.features);
  });
  const matches = distances.map((distance, index) => distance <= C.demonstrationMatch ? index : -1)
    .filter(index => index >= 0);
  if (matches.length !== 1) return null;
  const index = matches[0];
  return distances[1-index]-distances[index] > C.demonstrationGap ? index : null;
}

export function samplePriorExampleIndices(historyLength, randomState, count=C.replayPrior) {
  if (!Number.isInteger(historyLength) || historyLength < 0 || historyLength > C.replayCapacity ||
      !Number.isInteger(count) || count < 0 || count > C.replayPrior || !uint32(randomState))
    throw new TypeError('Invalid bounded private replay request');
  const indices = Array.from({length: historyLength}, (_, index) => index);
  let state = randomState;
  for (let i=0; i<Math.min(count, historyLength); i++) {
    const draw = nextCharacterRandom(state); state = draw.state;
    const j = i+Math.floor(draw.value*(historyLength-i));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return {indices: indices.slice(0,Math.min(count, historyLength)), randomState: state};
}
