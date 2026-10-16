import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { DISCOVERY_RULES } from '../src/discovery-config.js';
import { LocalLearnerProvider } from '../src/controller.js';
import { bodyFeatures, learnedValue, learningCostTick, policyContext, updateValue } from '../src/npc-memory.js';
import { createNpc } from '../src/npc-state.js';
import { loadSave, writeSave } from '../src/save.js';
import { freshState } from '../src/world.js';

const categories = [
  'observe', 'inspect', 'move_explore', 'move_source', 'move_food', 'move_shelter',
  'fill_flask', 'drink', 'wait', 'gather_food', 'eat', 'enter_shelter',
  'exit_shelter', 'rest', 'sleep', 'say', 'ask_human', 'journal_reply',
  'write_note', 'read_note', ...DISCOVERY_RULES.primitives,
];
const featureNames = [
  'thirst', 'hunger', 'thermal', 'injured', 'water', 'food', 'sheltered',
  'knownWater', 'knownFood', 'knownShelter',
];
const validKeys = new Set(categories.flatMap(category =>
  featureNames.map(feature => `${category}:${feature}`)));

function storage(initial = null) {
  const values = new Map(initial === null ? [] : [[CONFIG.saveKey, initial]]);
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

function positiveBody(actor) {
  actor.hydration = 50;
  actor.nourishment = 50;
  actor.thermal.hot = 50;
  actor.health = 50;
  actor.flask.water = 1;
  actor.inventory.apples = [{ foodId: 'test:food' }];
  actor.scene = 'refuge';
  actor.memory.sources = { spring: { available: true } };
  actor.memory.foods = { fruit: { available: true } };
  actor.memory.shelters = { refuge: {} };
  assert.deepEqual(Object.keys(bodyFeatures(actor)), featureNames);
  assert.ok(Object.values(bodyFeatures(actor)).every(value => value > 0));
}

function assertBoundedFeatures(actor) {
  const entries = Object.entries(actor.memory.features);
  assert.ok(entries.length <= 144, `${entries.length} live feature entries exceed the saved cap`);
  for (const [key, value] of entries) {
    assert.ok(validKeys.has(key), `unexpected generated feature key ${key}`);
    assert.ok(Number.isFinite(value) && value >= -8 && value <= 8,
      `${key} must have a finite, bounded weight`);
    assert.notEqual(value, 0, `${key} stores no information as an exact zero`);
  }
}

test('exact-zero and absent features have identical scores, action choice and RNG', () => {
  const absent = createNpc({ seed: 418 });
  absent.hydration = 51;
  absent.nourishment = 63;
  absent.thermal.hot = 18;
  const zeros = structuredClone(absent);
  zeros.memory.features = Object.fromEntries([...validKeys].map(key => [key, 0]));
  assert.equal(validKeys.size, 260);
  for (const category of categories)
    assert.deepEqual(learnedValue(absent, { type: category }),
      learnedValue(zeros, { type: category }), category);
  const provider = new LocalLearnerProvider();
  assert.deepEqual(provider.decide(absent), provider.decide(zeros));
  assert.equal(absent.rng, zeros.rng);
});

test('a complete ten-feature credit retires the oldest nonzero weights only after learning', () => {
  const actor = createNpc({ mode: 'discovery' });
  positiveBody(actor);
  const oldKeys = [...validKeys].filter(key => !key.startsWith('strike:')).slice(0, 144);
  actor.memory.features = Object.fromEntries(oldKeys.map((key, index) => [key, (index + 1) / 100]));
  const techniques = actor.discovery.techniques = [
    { id: 'unchanged-technique', successes: 7, failures: 2 },
  ];
  actor.discovery.practice = { pull: { successes: 5, failures: 1, seconds: 12 } };
  const counters = structuredClone({ techniques, practice: actor.discovery.practice });

  updateValue(actor, 'bounded', 'strike', 8);

  const newKeys = featureNames.map(feature => `strike:${feature}`);
  assert.deepEqual(Object.keys(actor.memory.features), [...oldKeys.slice(10), ...newKeys],
    'ten newly credited nonzero entries survive together; the oldest ten retire live');
  const signals = bodyFeatures(actor);
  for (const feature of featureNames)
    assert.equal(actor.memory.features[`strike:${feature}`], 0.5 * signals[feature]);
  assertBoundedFeatures(actor);
  assert.deepEqual({ techniques: actor.discovery.techniques, practice: actor.discovery.practice }, counters,
    'bounded value learning does not award or change technique proficiency');
});

test('an already oversized valid nonzero map forgets oldest weights during the next credit', () => {
  const actor = createNpc({ mode: 'discovery' });
  positiveBody(actor);
  const oldKeys = [...validKeys].filter(key => !key.startsWith('strike:')).slice(0, 150);
  actor.memory.features = Object.fromEntries(oldKeys.map((key, index) => [key, (index + 1) / 100]));
  assert.equal(Object.keys(actor.memory.features).length, 150);

  updateValue(actor, 'bounded', 'strike', 8);

  const newKeys = featureNames.map(feature => `strike:${feature}`);
  assert.deepEqual(Object.keys(actor.memory.features), [...oldKeys.slice(16), ...newKeys],
    'the live learner, rather than save validation, retires the oldest 16 of 160 nonzero keys');
  assertBoundedFeatures(actor);
});

test('one outer cost batch commits both credits together before FIFO retirement', () => {
  const actor = createNpc({ mode: 'discovery' });
  positiveBody(actor);
  const oldKeys = [...validKeys].filter(key =>
    !key.startsWith('observe:') && !key.startsWith('wait:')).slice(0, 144);
  actor.memory.features = Object.fromEntries(oldKeys.map((key, index) => [key, (index + 1) / 100]));
  actor.elapsed = 5;
  actor.active = { context: 'bounded', request: { type: 'observe' } };
  actor.memory.experience.push({ id: 1, at: 4, type: 'action', details: {
    action: { type: 'wait' }, context: 'bounded', result: { ok: true },
  } });

  // Observe replacement or retirement boundaries, without depending on the
  // internal representation used to calculate the individual feature weights.
  const mutations = [];
  let raw = actor.memory.features;
  const wrap = object => new Proxy(object, {
    set(target, key, value) {
      if (!Object.hasOwn(target, key)) mutations.push({ kind: 'add', key });
      return Reflect.set(target, key, value);
    },
    deleteProperty(target, key) {
      mutations.push({ kind: 'retire', key });
      return Reflect.deleteProperty(target, key);
    },
  });
  let view = wrap(raw);
  Object.defineProperty(actor.memory, 'features', {
    configurable: true, enumerable: true,
    get: () => view,
    set(next) {
      mutations.push({ kind: 'replace' });
      raw = next;
      view = wrap(next);
    },
  });
  try {
    learningCostTick(actor, 1, 1);
  } finally {
    Object.defineProperty(actor.memory, 'features', {
      configurable: true, enumerable: true, writable: true, value: raw,
    });
  }

  const newKeys = ['observe', 'wait'].flatMap(category =>
    featureNames.map(feature => `${category}:${feature}`));
  assert.deepEqual(Object.keys(actor.memory.features), [...oldKeys.slice(20), ...newKeys],
    'both ten-feature credits form one bounded outer learning batch');
  const boundary = mutations.findIndex(row => row.kind === 'replace' || row.kind === 'retire');
  assert.ok(boundary >= 0, 'an over-cap batch must retire or replace the feature map');
  const additions = mutations.filter(row => row.kind === 'add' && newKeys.includes(row.key));
  if (additions.length) {
    assert.equal(additions.length, 20);
    assert.ok(mutations.slice(0, boundary).filter(row =>
      row.kind === 'add' && newKeys.includes(row.key)).length === 20,
    'retirement must wait for both credits to finish');
  } else {
    assert.equal(mutations.filter(row => row.kind === 'replace').length, 1,
      'a batched replacement happens once after both credits');
  }
  assertBoundedFeatures(actor);
});

test('marked write and reload preserve every retained weight and learned score exactly', () => {
  const disk = storage(), initial = freshState();
  initial.features.legacyPendingPhysicalOnly = 1;
  assert.equal(writeSave(disk, initial), true);
  const opened = loadSave(disk);
  assert.equal(opened.blocked, false, opened.error);
  const world = opened.state, actor = world.agents[0];
  const oldKeys = [...validKeys].filter(key => !key.startsWith('strike:')).slice(0, 143);
  actor.memory.features = Object.fromEntries(oldKeys.map((key, index) => [key, (index + 1) / 100]));
  updateValue(actor, policyContext(actor), 'strike', 8);
  assertBoundedFeatures(actor);
  const expectedWeights = structuredClone(actor.memory.features);
  const expectedValues = structuredClone(actor.memory.values);
  const actions = [{ type: 'strike' }, { type: 'wait' }, { type: 'sample' },
    { type: 'move', target: { x: 0, y: 0 } }];
  const scores = actions.map(action => learnedValue(actor, action));
  const rng = actor.rng;
  assert.equal(writeSave(disk, world), true,
    'the marked continuity guard accepts a map already bounded during learning');
  const reopened = loadSave(disk);
  assert.equal(reopened.blocked, false, reopened.error);
  const restored = reopened.state.agents[0];
  assert.deepEqual(restored.memory.features, expectedWeights);
  assert.deepEqual(restored.memory.values, expectedValues);
  assert.deepEqual(actions.map(action => learnedValue(restored, action)), scores);
  assert.equal(restored.rng, rng);
  assert.deepEqual(restored.discovery.techniques, actor.discovery.techniques);
  assert.deepEqual(restored.discovery.practice, actor.discovery.practice);
});

test('malformed exact-zero feature remains visible and cannot launder a marked save', () => {
  const disk = storage(), initial = freshState();
  initial.features.legacyPendingPhysicalOnly = 1;
  assert.equal(writeSave(disk, initial), true);
  const opened = loadSave(disk);
  assert.equal(opened.blocked, false, opened.error);
  const world = opened.state, actor = world.agents[0];
  const originalBytes = disk.getItem(CONFIG.saveKey);
  actor.memory.features['unknown-category:thirst'] = 0;
  updateValue(actor, policyContext(actor), 'wait', 2);
  assert.equal(Object.hasOwn(actor.memory.features, 'unknown-category:thirst'), true,
    'exact-zero pruning must not hide malformed pre-existing learned data');
  assert.equal(writeSave(disk, world), false);
  assert.equal(disk.getItem(CONFIG.saveKey), originalBytes,
    'the original marked disk bytes remain protected');
});
