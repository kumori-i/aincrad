import test from 'node:test';
import assert from 'node:assert/strict';
import { CommunicationLearner, COMMUNICATION_LEARNING as C } from '../src/communication-learning.js';

const pixels = offset => Array.from({length: 48}, (_, i) => ((i * 7 + offset) % 31) / 30);
const body = [.25, .5, -.25, 0], outcome = [1, 0, 0, -.5];
const candidates = () => [
  {pixels: pixels(1), motor: 1}, {pixels: pixels(8), motor: 4}, {pixels: pixels(16), motor: 6},
];
const sum = xs => xs.reduce((a, b) => a + b, 0);
const close = (a, b, tolerance = 1e-12) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);

test('fresh symbol policies are deterministic, independent and bounded', () => {
  const a = new CommunicationLearner(123), b = new CommunicationLearner(123), c = new CommunicationLearner(124);
  assert.deepEqual(a.diagnostics(), b.diagnostics());
  assert.notEqual(a.diagnostics().sender.fingerprint, c.diagnostics().sender.fingerprint);
  assert.notEqual(a.diagnostics().sender.fingerprint, a.diagnostics().receiver.fingerprint);
  const before = b.diagnostics(), e = a.emit(pixels(0), body, outcome);
  assert.equal(e.tokens.length, 2); assert.ok(e.tokens.every(x => Number.isInteger(x) && x >= 0 && x < 8));
  assert.equal(e.messageIndex, e.tokens[0] * 8 + e.tokens[1]);
  assert.deepEqual(Object.keys(e.trace), []); assert.equal(Object.isFrozen(e.trace), true);
  a.learnSender(e.trace, 1);
  assert.deepEqual(b.diagnostics(), before);
  assert.ok(a.diagnostics().sender.parameters < 10000);
  assert.ok(a.diagnostics().receiver.parameters < 10000);
});

test('positive REINFORCE increases sampled sender probability and reaches both layers', () => {
  const model = new CommunicationLearner(42), before = model.diagnostics();
  const prior = model.senderProbabilities(pixels(4), body, outcome);
  const e = model.emit(pixels(4), body, outcome);
  assert.equal(model.learnSender(e.trace, .8), true);
  const after = model.senderProbabilities(pixels(4), body, outcome);
  assert.ok(after[e.messageIndex] > prior[e.messageIndex]);
  assert.notEqual(model.diagnostics().sender.encoderFingerprint, before.sender.encoderFingerprint);
  assert.notEqual(model.diagnostics().sender.fingerprint, before.sender.fingerprint);
  assert.equal(model.diagnostics().receiver.fingerprint, before.receiver.fingerprint);
  assert.ok(model.diagnostics().sender.gradientNorm > 0);
  close(model.diagnostics().sender.baseline, .8 * (1 - C.baselineDecay));
});

test('positive receiver credit raises selected probability and changes the visual encoder', () => {
  const model = new CommunicationLearner(42), before = model.diagnostics(), observations = candidates();
  const prior = model.receiverProbabilities(observations, body, 29), choice = model.choose(observations, body, 29);
  assert.equal(model.learnReceiver(choice.trace, 1), true);
  const after = model.receiverProbabilities(observations, body, 29);
  assert.ok(after[choice.index] > prior[choice.index]);
  assert.notEqual(model.diagnostics().receiver.encoderFingerprint, before.receiver.encoderFingerprint);
  assert.equal(model.diagnostics().sender.fingerprint, before.sender.fingerprint);
  close(sum(after), 1); assert.ok(after.every(p => p > 0 && p < 1));
});

test('negative credit reduces sampled action probability without supervised labels', () => {
  const model = new CommunicationLearner(1), observations = candidates();
  const senderBefore = model.senderProbabilities(pixels(5), body, outcome), e = model.emit(pixels(5), body, outcome);
  model.learnSender(e.trace, -1);
  assert.ok(model.senderProbabilities(pixels(5), body, outcome)[e.messageIndex] < senderBefore[e.messageIndex]);
  const prior = model.receiverProbabilities(observations, body, 19), choice = model.choose(observations, body, 19);
  model.learnReceiver(choice.trace, -1);
  assert.ok(model.receiverProbabilities(observations, body, 19)[choice.index] < prior[choice.index]);
});

test('receiver scores permute with candidates; fixed message has no hidden sender stream', () => {
  const a = new CommunicationLearner(9), b = new CommunicationLearner(9), observations = candidates();
  const p = a.receiverProbabilities(observations, body, 13), order = [2, 0, 1];
  const q = a.receiverProbabilities(order.map(i => observations[i]), body, 13);
  order.forEach((i, j) => close(q[j], p[i]));
  for (let i = 0; i < 50; i++) { const e = a.emit(pixels(i), body, outcome); a.discard(e.trace); }
  assert.deepEqual(a.receiverProbabilities(observations, body, null), b.receiverProbabilities(observations, body, null));
  assert.equal(a.choose(observations, body, null).index, b.choose(observations, body, null).index);
  assert.notDeepEqual(a.receiverProbabilities(observations, body, null), a.receiverProbabilities(observations, body, 0));
});

test('traces reject replay, forgery, wrong roles, foreign learners and old pending choices', () => {
  const a = new CommunicationLearner(33), b = new CommunicationLearner(33), observations = candidates();
  assert.equal(a.discard(undefined), false); assert.equal(a.discard(null), false);
  const e = a.emit(pixels(7), body, outcome), choice = a.choose(observations, body, e.messageIndex);
  assert.equal(b.learnSender(e.trace, 1), false);
  assert.equal(a.learnSender({}, 1), false);
  assert.equal(a.learnSender(choice.trace, 1), false);
  assert.equal(a.learnReceiver(e.trace, 1), false);
  assert.equal(a.learnSender(e.trace, 1), true);
  const saved = a.diagnostics();
  assert.equal(a.learnSender(e.trace, 1), false); assert.deepEqual(a.diagnostics(), saved);
  const next = a.choose(observations, body, e.messageIndex);
  assert.equal(a.learnReceiver(choice.trace, 1), false);
  assert.equal(a.discard(next.trace), true);
  assert.equal(a.discard(next.trace), false);
  assert.equal(a.learnReceiver(next.trace, 1), false);
  const last = a.emit(pixels(3), body, outcome);
  a.dispose(); assert.equal(a.learnSender(last.trace, 1), false);
  assert.equal(a.diagnostics().pendingSender, false); assert.equal(a.diagnostics().pendingReceiver, false);
  assert.throws(() => a.emit(pixels(3), body, outcome), /disposed/);
  assert.throws(() => a.choose(observations, body, null), /disposed/);
});

test('policy boundary accepts numeric sensory channels only and rejects malformed values', () => {
  for (const seed of [-1, 1.5, NaN, Infinity, 2 ** 32, '1']) assert.throws(() => new CommunicationLearner(seed));
  const model = new CommunicationLearner(0);
  for (const p of [[], pixels(0).slice(1), [...pixels(0), 0], pixels(0).map(() => NaN), pixels(0).map(() => 1.1), 'red']) {
    assert.throws(() => model.emit(p, body, outcome));
  }
  for (const values of [[0, 0, 0], [0, 0, 0, 2], [0, 0, 0, NaN], [0, 0, 0, '1']]) {
    assert.throws(() => model.emit(pixels(0), values, outcome));
    assert.throws(() => model.emit(pixels(0), body, values));
  }
  for (const msg of [-1, 64, 3.5, NaN, undefined, '12']) assert.throws(() => model.choose(candidates(), body, msg));
  assert.throws(() => model.choose([candidates()[0]], body, null));
  assert.throws(() => model.choose(Array.from({length: 9}, () => candidates()[0]), body, null));
  for (const changed of [{...candidates()[0], id: 'object:3'}, {...candidates()[0], motor: 'pull'}, {...candidates()[0], motor: 8}, {...candidates()[0], position: {x: 0, y: 0}}]) {
    assert.throws(() => model.choose([changed, candidates()[1]], body, null));
  }
  const e = model.emit(pixels(0), body, outcome);
  for (const reward of [NaN, Infinity, 1.1, -1.1, '1']) assert.throws(() => model.learnSender(e.trace, reward));
  assert.equal(model.learnSender(e.trace, 0), true);
});

test('read-only probability audits do not consume randomness or retain caller input', () => {
  const a = new CommunicationLearner(11), b = new CommunicationLearner(11), observations = candidates();
  const input = pixels(4), inputSnapshot = [...input];
  for (let i = 0; i < 5; i++) { a.senderProbabilities(input, body, outcome); a.receiverProbabilities(observations, body, null); }
  assert.deepEqual(a.diagnostics(), b.diagnostics());
  const e = a.emit(input, body, outcome), other = b.emit(input, body, outcome);
  assert.equal(e.messageIndex, other.messageIndex);
  input.fill(0); observations[0].pixels.fill(0);
  assert.equal(a.learnSender(e.trace, .5), true); assert.equal(b.learnSender(other.trace, .5), true);
  assert.deepEqual(a.diagnostics().sender, b.diagnostics().sender);
  assert.notDeepEqual(input, inputSnapshot);
});

test('bounded learning stays finite through repeated signed updates', () => {
  const model = new CommunicationLearner(710), observations = candidates();
  for (let i = 0; i < 300; i++) {
    const e = model.emit(pixels(i), body, outcome), c = model.choose(observations, body, e.messageIndex);
    const reward = i % 3 ? 1 : -1;
    model.learnSender(e.trace, reward); model.learnReceiver(c.trace, reward);
  }
  const d = model.diagnostics();
  assert.equal(d.senderUpdates, 300); assert.equal(d.receiverUpdates, 300);
  assert.equal(d.sender.finite, true); assert.equal(d.receiver.finite, true);
  assert.equal(d.pendingSender, false); assert.equal(d.pendingReceiver, false);
  close(sum(model.senderProbabilities(pixels(3), body, outcome)), 1);
  close(sum(model.receiverProbabilities(observations, body, null)), 1);
});
