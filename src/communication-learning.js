/** Small fresh online policies, not the Python lab's trained CNNs.
 * Fixed RGB pooling, motor channels and scalar reinforcement are supplied
 * architecture. This module never sees object identities, names or positions.
 * Two base-eight tokens encode one categorical message, not a grammar.
 */
export const COMMUNICATION_LEARNING = Object.freeze({
  pixels: 48, body: 4, outcome: 4, motors: 8, messages: 64,
  hidden: 16, maximumCandidates: 8, learningRate: .02,
  baselineDecay: .95, gradientLimit: 3, weightLimit: 8,
});
const C = COMMUNICATION_LEARNING;

function vector(value, size, name, lower = -1, upper = 1) {
  if (!(Array.isArray(value) || value instanceof Float32Array || value instanceof Float64Array) ||
      value.length !== size || !Array.from(value).every(x => Number.isFinite(x) && x >= lower && x <= upper)) {
    throw new TypeError(`${name} must contain ${size} bounded finite numbers`);
  }
  return Array.from(value);
}
function seedValue(value) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new TypeError('Expected a uint32 seed');
  return value >>> 0;
}
function randomStream(seed) {
  let state = seed >>> 0 || 0x9e3779b9;
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}
function softmax(scores) {
  const max = Math.max(...scores), values = scores.map(x => Math.exp(x - max));
  const sum = values.reduce((a, b) => a + b, 0);
  return values.map(x => x / sum);
}
function sampled(probabilities, random) {
  const draw = random(); let sum = 0;
  for (let i = 0; i < probabilities.length; i++) {
    sum += probabilities[i]; if (draw < sum) return i;
  }
  return probabilities.length - 1;
}
function network(inputs, outputs, random) {
  const initialized = (size, scale) => Float64Array.from({length: size}, () => (random() * 2 - 1) * scale);
  return {inputs, outputs,
    first: initialized(inputs * C.hidden, Math.sqrt(6 / (inputs + C.hidden))),
    hiddenBias: new Float64Array(C.hidden),
    second: initialized(C.hidden * outputs, Math.sqrt(6 / (C.hidden + outputs))),
    outputBias: new Float64Array(outputs)};
}
function forward(model, input) {
  const hidden = new Float64Array(C.hidden), output = new Float64Array(model.outputs);
  for (let h = 0; h < C.hidden; h++) {
    let total = model.hiddenBias[h];
    for (let i = 0; i < model.inputs; i++) total += model.first[h * model.inputs + i] * input[i];
    hidden[h] = Math.tanh(total);
  }
  for (let o = 0; o < model.outputs; o++) {
    let total = model.outputBias[o];
    for (let h = 0; h < C.hidden; h++) total += model.second[o * C.hidden + h] * hidden[h];
    output[o] = total;
  }
  return {input, hidden, output};
}
const fields = ['first', 'hiddenBias', 'second', 'outputBias'];
function gradients(model) { return Object.fromEntries(fields.map(key => [key, new Float64Array(model[key].length)])); }
function accumulate(model, saved, outputGradient, gradient) {
  for (let o = 0; o < model.outputs; o++) {
    gradient.outputBias[o] += outputGradient[o];
    for (let h = 0; h < C.hidden; h++) gradient.second[o * C.hidden + h] += outputGradient[o] * saved.hidden[h];
  }
  for (let h = 0; h < C.hidden; h++) {
    let value = 0;
    for (let o = 0; o < model.outputs; o++) value += model.second[o * C.hidden + h] * outputGradient[o];
    value *= 1 - saved.hidden[h] ** 2;
    gradient.hiddenBias[h] += value;
    for (let i = 0; i < model.inputs; i++) gradient.first[h * model.inputs + i] += value * saved.input[i];
  }
}
function update(model, gradient) {
  let squared = 0;
  for (const key of fields) for (const value of gradient[key]) squared += value * value;
  if (!Number.isFinite(squared)) throw new RangeError('Non-finite policy gradient');
  const norm = Math.sqrt(squared), scale = C.learningRate * Math.min(1, C.gradientLimit / Math.max(norm, 1e-12));
  // Ascend advantage * log probability. All gradients use pre-update weights.
  for (const key of fields) for (let i = 0; i < model[key].length; i++) {
    model[key][i] = Math.max(-C.weightLimit, Math.min(C.weightLimit, model[key][i] + gradient[key][i] * scale));
  }
  return norm;
}
function fingerprint(arrays) {
  // Lightweight mutation diagnostic only, not an artifact integrity hash.
  let hash = 2166136261;
  for (const values of arrays) {
    const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
    for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
function diagnostics(model) {
  return {fingerprint: fingerprint(fields.map(key => model[key])),
    encoderFingerprint: fingerprint([model.first, model.hiddenBias]),
    finite: fields.every(key => model[key].every(Number.isFinite)),
    parameters: fields.reduce((sum, key) => sum + model[key].length, 0)};
}
function senderInput(pixels, body, outcome) {
  return [...vector(pixels, C.pixels, 'Pixels', 0, 1),
    ...vector(body, C.body, 'Body'), ...vector(outcome, C.outcome, 'Outcome')];
}
function receiverInputs(candidates, body, message) {
  if (!Array.isArray(candidates) || candidates.length < 2 || candidates.length > C.maximumCandidates) {
    throw new TypeError('Expected two to eight numeric candidate observations');
  }
  const ownBody = vector(body, C.body, 'Body');
  if (message !== null && (!Number.isInteger(message) || message < 0 || message >= C.messages)) throw new TypeError('Invalid message');
  const encoded = new Array(C.messages).fill(0);
  if (message !== null) encoded[message] = 1;
  return candidates.map(candidate => {
    if (!candidate || Object.getPrototypeOf(candidate) !== Object.prototype ||
        Object.keys(candidate).length !== 2 || !Object.hasOwn(candidate, 'pixels') || !Object.hasOwn(candidate, 'motor') ||
        !Number.isInteger(candidate.motor) || candidate.motor < 0 || candidate.motor >= C.motors) {
      throw new TypeError('Candidates contain only pixels and a motor index');
    }
    const motors = new Array(C.motors).fill(0); motors[candidate.motor] = 1;
    return [...vector(candidate.pixels, C.pixels, 'Pixels', 0, 1), ...motors, ...ownBody, ...encoded];
  });
}

export class CommunicationLearner {
  #sender; #receiver; #senderRandom; #receiverRandom;
  #pendingSender = null; #pendingReceiver = null;
  #senderBaseline = 0; #receiverBaseline = 0;
  #counts = {emitted: 0, choices: 0, senderUpdates: 0, receiverUpdates: 0, discarded: 0};
  #disposed = false;
  #lastGradient = {sender: 0, receiver: 0};
  constructor(seed) {
    const value = seedValue(seed);
    this.#sender = network(C.pixels + C.body + C.outcome, C.messages, randomStream(value ^ 0xa341316c));
    this.#receiver = network(C.pixels + C.motors + C.body + C.messages, 1, randomStream(value ^ 0xc8013ea4));
    // Sampling cannot perturb initialization or another policy's random stream.
    this.#senderRandom = randomStream(value ^ 0xad90777d);
    this.#receiverRandom = randomStream(value ^ 0x7e95761e);
  }
  #awake() { if (this.#disposed) throw new Error('Communication learner is disposed'); }
  senderProbabilities(pixels, body, outcome) {
    this.#awake(); return softmax(Array.from(forward(this.#sender, senderInput(pixels, body, outcome)).output));
  }
  receiverProbabilities(candidates, body, messageIndexOrNull) {
    this.#awake(); return softmax(receiverInputs(candidates, body, messageIndexOrNull).map(input => forward(this.#receiver, input).output[0]));
  }
  emit(pixels, body, outcome) {
    this.#awake();
    const saved = forward(this.#sender, senderInput(pixels, body, outcome));
    const probabilities = softmax(Array.from(saved.output)), messageIndex = sampled(probabilities, this.#senderRandom);
    if (this.#pendingSender) this.#counts.discarded++;
    const trace = Object.freeze({});
    this.#pendingSender = {trace, saved, probabilities, index: messageIndex};
    this.#counts.emitted++;
    return {tokens: [Math.floor(messageIndex / 8), messageIndex % 8], messageIndex, trace};
  }
  choose(candidates, body, messageIndexOrNull) {
    this.#awake();
    const saved = receiverInputs(candidates, body, messageIndexOrNull).map(input => forward(this.#receiver, input));
    const probabilities = softmax(saved.map(value => value.output[0])), index = sampled(probabilities, this.#receiverRandom);
    if (this.#pendingReceiver) this.#counts.discarded++;
    const trace = Object.freeze({});
    this.#pendingReceiver = {trace, saved, probabilities, index};
    this.#counts.choices++;
    return {index, trace, probabilities: [...probabilities]};
  }
  #reward(reward) {
    if (!Number.isFinite(reward) || reward < -1 || reward > 1) throw new TypeError('Reward must be finite and within [-1, 1]');
  }
  learnSender(trace, reward) {
    if (this.#disposed || !this.#pendingSender || this.#pendingSender.trace !== trace) return false;
    this.#reward(reward);
    const pending = this.#pendingSender; this.#pendingSender = null;
    const advantage = reward - this.#senderBaseline, gradient = gradients(this.#sender);
    accumulate(this.#sender, pending.saved, pending.probabilities.map((p, i) => advantage * (Number(i === pending.index) - p)), gradient);
    this.#lastGradient.sender = update(this.#sender, gradient);
    this.#senderBaseline = C.baselineDecay * this.#senderBaseline + (1 - C.baselineDecay) * reward;
    this.#counts.senderUpdates++; return true;
  }
  learnReceiver(trace, reward) {
    if (this.#disposed || !this.#pendingReceiver || this.#pendingReceiver.trace !== trace) return false;
    this.#reward(reward);
    const pending = this.#pendingReceiver; this.#pendingReceiver = null;
    const advantage = reward - this.#receiverBaseline, gradient = gradients(this.#receiver);
    pending.saved.forEach((saved, i) => accumulate(this.#receiver, saved, [advantage * (Number(i === pending.index) - pending.probabilities[i])], gradient));
    this.#lastGradient.receiver = update(this.#receiver, gradient);
    this.#receiverBaseline = C.baselineDecay * this.#receiverBaseline + (1 - C.baselineDecay) * reward;
    this.#counts.receiverUpdates++; return true;
  }
  discard(trace) {
    if (this.#pendingSender && this.#pendingSender.trace === trace) { this.#pendingSender = null; this.#counts.discarded++; return true; }
    if (this.#pendingReceiver && this.#pendingReceiver.trace === trace) { this.#pendingReceiver = null; this.#counts.discarded++; return true; }
    return false;
  }
  diagnostics() {
    return {disposed: this.#disposed, ...this.#counts,
      pendingSender: !!this.#pendingSender, pendingReceiver: !!this.#pendingReceiver,
      sender: {...diagnostics(this.#sender), baseline: this.#senderBaseline, gradientNorm: this.#lastGradient.sender},
      receiver: {...diagnostics(this.#receiver), baseline: this.#receiverBaseline, gradientNorm: this.#lastGradient.receiver}};
  }
  dispose() {
    if (this.#pendingSender) this.#counts.discarded++;
    if (this.#pendingReceiver) this.#counts.discarded++;
    this.#pendingSender = null; this.#pendingReceiver = null; this.#disposed = true;
  }
}
