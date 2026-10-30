import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHARACTER_CORE as C,
  CHARACTER_RANDOM_PURPOSES,
  applyClippedGradient,
  classifyOwnDemonstration,
  copyListenerParameters,
  copySenderParameters,
  createListenerParameters,
  createSenderParameters,
  initialCharacterRandomState,
  listenerCrossEntropy,
  listenerDistribution,
  listenerGradient,
  nextCharacterRandom,
  sampleListener,
  samplePriorExampleIndices,
  sampleSender,
  senderGradient,
  senderLogProbability,
  senderNextTokenDistribution,
  stableSoftmax,
  trainListenerBatch,
  trainSender,
} from '../src/character-message-core.js';
import {initialReferenceRandomStates} from '../src/visual-reference-random.js';

const flat = value => Array(C.features).fill(value);
const pixels = phase => Array.from({length:C.features}, (_, i) =>
  .08 + .84*((i*13 + phase*17) % 47)/46);
const sender = () => createSenderParameters({seed:419, identity:7});
const listener = () => createListenerParameters({seed:823, identity:11});
const example = () => ({message:'abca', candidates:[pixels(1),pixels(9)], label:1});
const near = (actual, expected, tolerance=2e-6) =>
  assert(Math.abs(actual-expected) <= tolerance,
    `expected ${actual} near ${expected}; difference ${Math.abs(actual-expected)}`);
const parameterSnapshot = model => Object.fromEntries(Object.entries(model).map(
  ([key, values]) => [key, Array.from(values)]));
const norm = model => Math.hypot(...Object.values(model).flatMap(values => Array.from(values)));

function central(model, copy, family, index, objective, delta=1e-5) {
  const positive = copy(model), negative = copy(model);
  positive[family][index] += delta;
  negative[family][index] -= delta;
  return (objective(positive)-objective(negative))/(2*delta);
}

function checkGradient(model, copy, gradient, objective, probes) {
  for (const [family, indices] of Object.entries(probes)) {
    assert(indices.some(index => Math.abs(gradient[family][index]) > 1e-12),
      `${family} must receive a nonzero gradient in this fixture`);
    for (const index of indices) {
      const numerical = central(model, copy, family, index, objective);
      near(gradient[family][index], numerical, 2e-6 + 2e-4*Math.abs(numerical));
    }
  }
}

test('sender reverse gradient matches central differences through letters, recurrence and EOS', () => {
  const model = sender(), trajectory = {features:pixels(4),tokens:[0,1,0,C.eos]};
  const advantage = .7;
  const result = senderGradient(model, trajectory, advantage);
  near(result.loss, -advantage*senderLogProbability(model, trajectory), 1e-12);
  checkGradient(model, copySenderParameters, result.gradient,
    candidate => -advantage*senderLogProbability(candidate, trajectory), {
      Wx:[0, C.features+13, 7*C.features+47], b0:[0,7],
      Wh:[0, 3*C.hidden+7, 15*C.hidden+15],
      E:[0, C.hidden+3, 7], bh:[0,9],
      Wo:[0, 2*C.hidden+4, C.eos*C.hidden+5], bo:[0,1,C.eos],
    });
  assert.equal(result.gradient.E[3*C.hidden],0,'Unused letters have no embedding gradient');
});

test('six-letter forced cap has exactly six sampled decisions and no post-cap EOS action', () => {
  const model = sender(), trajectory = {features:pixels(5),tokens:[0,1,2,3,4,5]};
  let prefix = '', expected = 0;
  for (const token of trajectory.tokens) {
    const step = senderNextTokenDistribution(model, trajectory.features, prefix);
    expected += step.logProbabilities[token];
    prefix += String.fromCharCode(97+token);
  }
  near(senderLogProbability(model, trajectory), expected, 1e-12);
  const advantage = -.6, gradient = senderGradient(model, trajectory, advantage).gradient;
  checkGradient(model, copySenderParameters, gradient,
    candidate => -advantage*senderLogProbability(candidate, trajectory), {
      Wh:[3*C.hidden+7], E:[2*C.hidden+4, 5*C.hidden+3],
      Wo:[C.eos*C.hidden+2], bo:[C.eos],
    });
  assert.throws(() => senderLogProbability(model,
    {features:trajectory.features,tokens:[...trajectory.tokens,C.eos]}), TypeError);
  assert.throws(() => senderLogProbability(model,
    {features:trajectory.features,tokens:[C.eos]}), TypeError);
});

test('controlled EOS logits produce an early one-letter stop or a six-letter forced cap', () => {
  const high = sender(), low = copySenderParameters(high), own = pixels(5);
  high.bo[C.eos] = 100;
  low.bo[C.eos] = -100;
  const state = initialCharacterRandomState({seed:842,purpose:'senderSample'});
  const short = sampleSender(high,own,state), capped = sampleSender(low,own,state);
  assert.equal(short.message.length,1);
  assert.equal(short.trajectory.tokens.length,2);
  assert.equal(short.trajectory.tokens.at(-1),C.eos);
  assert.equal(capped.message.length,C.maxLetters);
  assert.equal(capped.trajectory.tokens.length,C.maxLetters);
  assert(!capped.trajectory.tokens.includes(C.eos));
});

test('listener visual and recurrent gradients match central differences for its own candidates', () => {
  const model = listener(), item = example();
  const result = listenerGradient(model,item);
  near(result.loss,listenerCrossEntropy(model,item),1e-12);
  checkGradient(model, copyListenerParameters, result.gradient,
    candidate => listenerCrossEntropy(candidate,item), {
      Wh:[0, 7*C.hidden+2, 15*C.hidden+15],
      E:[0, C.hidden+4, 2*C.hidden+1], bh:[0,11],
      Wv:[0, 7*C.features+23, 15*C.features+47], bv:[0,11],
    });
  assert.equal(result.gradient.E[3*C.hidden],0,'Unused letters have no embedding gradient');
});

test('softmax remains finite for extreme finite logits and masks EOS before the first letter', () => {
  const extreme = stableSoftmax([1000,-1000,1000]);
  assert.deepEqual(extreme.probabilities,[.5,0,.5]);
  assert(extreme.logProbabilities.every(Number.isFinite));
  near(extreme.logProbabilities[1],-2000-Math.log(2),1e-10);
  const masked = stableSoftmax([1000,-1000,1000],[0,2]);
  assert.deepEqual(masked.probabilities,[0,1,0]);
  assert.equal(masked.logProbabilities[0],-Infinity);
  for (const bad of [[NaN,0],[Infinity,0],[-Infinity,0]])
    assert.throws(() => stableSoftmax(bad),TypeError);
  assert.throws(() => stableSoftmax([0,1],[0,1]),TypeError);
  assert.throws(() => stableSoftmax(Array(28).fill(0)),TypeError,
    'The exported softmax must reject unbounded token inventories');
  const first = senderNextTokenDistribution(sender(),pixels(3));
  assert.equal(first.probabilities[C.eos],0);
  assert.equal(first.logProbabilities[C.eos],-Infinity);
  near(first.probabilities.reduce((total,p) => total+p,0),1,1e-14);
});

test('one supervised update lowers frozen listener CE; observed match and mismatch move trajectory likelihood oppositely', () => {
  const original = listener(), item = example(), before = parameterSnapshot(original);
  const trained = trainListenerBatch(original,[item]);
  assert(trained.lossAfter < trained.lossBefore);
  assert.deepEqual(parameterSnapshot(original),before,'Training must not mutate caller weights');
  const model = sender(), trajectory = {features:pixels(6),tokens:[2,3,C.eos]};
  const positive = trainSender(model,trajectory,{reward:1,baseline:0});
  const negative = trainSender(model,trajectory,{reward:-1,baseline:0});
  assert(positive.logProbabilityAfter > positive.logProbabilityBefore);
  assert(negative.logProbabilityAfter < negative.logProbabilityBefore);
  near(positive.baseline,.05,1e-15);
  near(negative.baseline,-.05,1e-15);
  assert.throws(() => trainSender(model,trajectory,{reward:0,baseline:0}),TypeError,
    'Censored feedback must not be converted into a training reward');
  assert.deepEqual(parameterSnapshot(model),parameterSnapshot(sender()));
});

test('four identical listener examples give the same averaged update as one example', () => {
  const model = listener(), item = example();
  const once = trainListenerBatch(model,[item]);
  const four = trainListenerBatch(model,[item,item,item,item]);
  near(once.lossBefore,four.lossBefore,1e-14);
  near(once.lossAfter,four.lossAfter,1e-14);
  near(once.gradientNorm,four.gradientNorm,1e-14);
  for (const name of Object.keys(model))
    for (let i=0;i<model[name].length;i++) near(once.model[name][i],four.model[name][i],1e-14);
});

test('one global gradient norm clips the entire model; all updates and copies remain isolated', () => {
  const original = sender(), before = parameterSnapshot(original);
  const gradient = senderGradient(original,
    {features:pixels(2),tokens:[0,C.eos]},1).gradient;
  for (const values of Object.values(gradient)) values.fill(0);
  gradient.Wx[0] = 3; gradient.bo[0] = 4;
  const step = applyClippedGradient('sender',original,gradient);
  near(step.gradientNorm,5,1e-14);
  near(step.clipScale,.2,1e-14);
  near(step.model.Wx[0]-original.Wx[0],-.006,1e-14);
  near(step.model.bo[0]-original.bo[0],-.008,1e-14);
  near(norm(Object.fromEntries(Object.entries(step.model).map(([key,values]) =>
    [key,values.map((value,i) => value-original[key][i])]))),C.learningRate,1e-14);
  assert.deepEqual(parameterSnapshot(original),before);
  gradient.Wx[0] = 0; step.model.Wx[0] = 0;
  assert.deepEqual(parameterSnapshot(original),before);
  assert.throws(() => applyClippedGradient('listener',original,gradient),TypeError);
});

test('an extreme finite raw gradient still makes a finite nonzero clipped update', () => {
  const model = sender(), gradient = senderGradient(model,
    {features:pixels(2),tokens:[0,C.eos]},1).gradient;
  for (const values of Object.values(gradient)) values.fill(0);
  gradient.Wx[0] = 1e308;
  const step = applyClippedGradient('sender',model,gradient);
  assert(Number.isFinite(step.gradientNorm));
  assert(Number.isFinite(step.clipScale) && step.clipScale > 0);
  near(step.model.Wx[0]-model.Wx[0],-C.learningRate,1e-14);
  assert(Number.isFinite(step.model.Wx[0]));
});

test('purpose-separated uint32 RNG states and sampled continuation are exact', () => {
  const legacy = initialReferenceRandomStates(123);
  const states = Object.keys(CHARACTER_RANDOM_PURPOSES).map(purpose =>
    initialCharacterRandomState({seed:0xffffffff,identity:0x80000000,purpose}));
  assert.deepEqual(Object.keys(CHARACTER_RANDOM_PURPOSES),[
    'senderInit','senderSample','listenerInit','listenerChoice','listenerReplay',
    'sequencePair','sequenceTarget','sequenceOrder']);
  assert.equal(new Set(states).size,states.length);
  for (const state of states) {
    const draw = nextCharacterRandom(state);
    assert(draw.value>=0 && draw.value<1);
    assert.deepEqual(draw,nextCharacterRandom(state),'Draws are pure and replayable');
  }
  const model = sender(), own = pixels(7);
  const initial = initialCharacterRandomState({seed:123,identity:9,purpose:'senderSample'});
  const first = sampleSender(model,own,initial);
  const checkpoint = first.randomState;
  const second = sampleSender(model,own,checkpoint);
  senderNextTokenDistribution(model,own); senderLogProbability(model,second.trajectory);
  assert.deepEqual(sampleSender(model,own,checkpoint),second);
  assert.deepEqual(sampleSender(model,own,initial),first);
  assert.match(first.message,/^[a-z]{1,6}$/);
  assert.deepEqual(first.trajectory.tokens.map(token => String.fromCharCode(token+97)).join('')
    .replace(String.fromCharCode(C.eos+97),''),first.message);
  const replayState = initialCharacterRandomState({seed:123,identity:9,purpose:'listenerReplay'});
  const replay = samplePriorExampleIndices(128,replayState);
  assert.deepEqual(samplePriorExampleIndices(128,replayState),replay);
  assert.equal(new Set(replay.indices).size,3);
  assert(replay.indices.every(i => i>=0 && i<128));
  for (const purpose of ['sequencePair','sequenceTarget','sequenceOrder'])
    nextCharacterRandom(initialCharacterRandomState({seed:123,purpose}));
  assert.deepEqual(initialReferenceRandomStates(123),legacy,
    'Sequence selection uses separate states and cannot consume any legacy stream');
});

test('listener is exactly uniform until this partner has a valid demonstration; candidate order is equivariant afterward', () => {
  const model = listener(), pair = [pixels(1),pixels(9)];
  const prior = listenerDistribution(model,'abca',pair);
  assert.deepEqual(prior,{scores:[0,0],probabilities:[.5,.5]});
  const state = initialCharacterRandomState({seed:21,purpose:'listenerChoice'});
  const sampled = sampleListener(model,'abca',pair,state);
  const draw = nextCharacterRandom(state);
  assert.equal(sampled.choice,draw.value<.5?0:1);
  assert.equal(sampled.randomState,draw.state);
  const normal = listenerDistribution(model,'abca',pair,{hasDemonstration:true});
  const swapped = listenerDistribution(model,'abca',[pair[1],pair[0]],{hasDemonstration:true});
  for (let i=0;i<2;i++) {
    near(normal.scores[i],swapped.scores[1-i],1e-14);
    near(normal.probabilities[i],swapped.probabilities[1-i],1e-14);
  }
  normal.probabilities[0] = 10;
  assert(listenerDistribution(model,'abca',pair,{hasDemonstration:true}).probabilities[0]<1);
});

test('own pixels and message prefixes affect distributions without a finite word inventory', () => {
  const model = sender(), one = senderNextTokenDistribution(model,pixels(1));
  const two = senderNextTokenDistribution(model,pixels(13));
  const prefixed = senderNextTokenDistribution(model,pixels(1),'ab');
  const alternate = senderNextTokenDistribution(model,pixels(1),'zy');
  assert(one.probabilities.some((p,i) => Math.abs(p-two.probabilities[i])>1e-9));
  assert(prefixed.probabilities.some((p,i) => Math.abs(p-alternate.probabilities[i])>1e-9));
  assert.equal(prefixed.probabilities.length,C.letters+1);
  assert.equal(senderNextTokenDistribution(model,pixels(1),'abcde').probabilities.length,C.letters+1);
  assert.throws(() => senderNextTokenDistribution(model,pixels(1),'abcdef'),TypeError);
});

test('demonstration labels use only unique own-crop distances and a strict runner gap', () => {
  assert.equal(classifyOwnDemonstration([flat(0),flat(.06)],flat(.02)),null,
    'A runner at the 0.02 boundary is censored');
  assert.equal(classifyOwnDemonstration([flat(0),flat(.061)],flat(.02)),0,
    'A runner beyond the strict gap may label the unique matching crop');
  assert.equal(classifyOwnDemonstration([flat(0),flat(.2)],flat(.04)),0);
  assert.equal(classifyOwnDemonstration([flat(0),flat(.2)],flat(.041)),null);
  assert.equal(classifyOwnDemonstration([flat(0),flat(.03)],flat(0)),null);
  assert.equal(classifyOwnDemonstration([flat(0),flat(.085)],flat(.035)),null);
  assert.equal(classifyOwnDemonstration([flat(0),flat(.096)],flat(.035)),0);
  assert.equal(classifyOwnDemonstration([flat(.2),flat(0)],flat(0)),1);
});

test('shape, bounds and finiteness validation reject malformed work before any update', () => {
  const model = sender(), own = pixels(1), state = initialCharacterRandomState({seed:1,purpose:'senderSample'});
  for (const bad of [[],flat(NaN),flat(Infinity),flat(-.01),flat(1.01),new Float64Array(47)])
    assert.throws(() => sampleSender(model,bad,state),TypeError);
  for (const message of ['', 'aZ','abcdefg','é'])
    assert.throws(() => listenerDistribution(listener(),message,[own,own]),TypeError);
  const invalid = copySenderParameters(model); invalid.Wx[0] = NaN;
  assert.throws(() => sampleSender(invalid,own,state),TypeError);
  const inherited = Object.assign(Object.create(model),
    Object.fromEntries(Array.from({length:Object.keys(model).length},(_,i)=>[`unused${i}`,i])));
  assert.throws(() => sampleSender(inherited,own,state),TypeError);
  assert.throws(() => trainSender(model,{features:own,tokens:[0,C.eos]},
    {reward:1,baseline:Infinity}),TypeError);
  assert.throws(() => initialCharacterRandomState({seed:-1,purpose:'senderInit'}),TypeError);
  assert.throws(() => nextCharacterRandom(-1),TypeError);
  const original = parameterSnapshot(model), copied = copySenderParameters(model);
  copied.Wx[0] += 1;
  assert.deepEqual(parameterSnapshot(model),original);
  const emitted = sampleSender(model,own,state);
  const recorded = emitted.trajectory.features[0]; own[0] = 1-own[0];
  assert.equal(emitted.trajectory.features[0],recorded);
  assert.throws(() => trainListenerBatch(listener(),[]),TypeError);
  assert.throws(() => trainListenerBatch(listener(),Array(5).fill(example())),TypeError);
  assert.equal(trainListenerBatch(listener(),Array(4).fill(example())).model.E.length,C.letters*C.hidden);
  assert.throws(() => samplePriorExampleIndices(129,state),TypeError);
  assert.throws(() => samplePriorExampleIndices(128,state,4),TypeError);
});
