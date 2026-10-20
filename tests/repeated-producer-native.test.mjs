import test from 'node:test';
import assert from 'node:assert/strict';
import { discoveryDecision } from '../src/discovery.js';
import { retainedProofIntegrityError } from '../src/proof-retention.js';
import { projectPhysiology } from '../src/biology.js';
import { bodySignals } from '../src/interoception.js';
import { requestNpcAction } from '../src/npc.js';
import { lookupEcologyObject } from '../src/ecology.js';
import { createOzarkState, writeOzarkSave, loadOzarkSave } from '../src/ozark-save.js';
import { geometry, fixture, tick, act, place, comfortableHungry, pendingIdentity, sourcePending,
  waitForOwnSustained } from './fixtures/repeated-producer-pending.mjs';

const clone = structuredClone;

// Written and run red before the production contrast. Positive food evidence
// comes solely from the deterministic native physical fixture.
test('two independent native returns admit an ordinary learned pull during a genuine source wait', () => {
  const f = fixture(), { n, source, technique } = f;
  const pending = clone(n.discovery.samplesPending), gut = pendingIdentity(n);
  const effects = clone(n.discovery.effects), credit = technique.successes;
  assert.equal(new Set(f.chains.map(c => c.materialId)).size, 2);
  assert.equal(new Set(f.chains.map(c => c.acquisition.eventId)).size, 2);
  assert.equal(new Set(f.chains.map(c => c.sample.ingestionId)).size, 2);
  assert.equal(sourcePending(n, source.id), true);
  assert.ok(n.elapsed - pending[f.chains.at(-1).materialId] < 45);
  const decision = discoveryDecision(n);
  assert.equal(decision.need, 'food');
  assert.deepEqual(decision.action, { type: 'pull', targetId: source.id });
  assert.equal(n.discovery.run.techniqueId, technique.id);
  assert.equal(n.discovery.run.cursor, 0);
  assert.equal(n.discovery.run.pendingProducerExemption, true);
  assert.deepEqual(n.discovery.samplesPending, pending);
  assert.deepEqual(pendingIdentity(n), gut);
  assert.deepEqual(n.discovery.effects, effects);
  assert.equal(technique.successes, credit);
});

test('the contrast buys a new paid acquisition and uncertain first sample, not free relief', () => {
  const f = fixture(), { n, source, technique } = f;
  const credit = technique.successes, meals = n.stats.independentMeals;
  const before = clone(n.discovery.samplesPending), gut = pendingIdentity(n);
  const decision = discoveryDecision(n);
  assert.deepEqual(decision.action, { type: 'pull', targetId: source.id });
  const acquired = act(f, decision.action);
  assert.equal(acquired.ok, true);
  assert.ok(acquired.durationSeconds > 0);
  assert.ok(acquired.handling.activeActionSeconds > 0);
  assert.equal(f.chains.some(c => c.materialId === acquired.materialId), false);
  assert.equal(n.inventory.items.length, 1);
  assert.equal(n.discovery.run.cursor, 1);
  assert.equal(n.discovery.run.pendingProducerExemption, undefined);
  assert.equal(n.discovery.effects.some(e => e.objectId === acquired.materialId), false);
  assert.equal(technique.successes, credit);
  assert.deepEqual(n.discovery.samplesPending, before);
  assert.deepEqual(pendingIdentity(n), gut);
  const next = discoveryDecision(n);
  assert.deepEqual(next.action, { type: 'sample', targetId: acquired.materialId });
  const sample = act(f, next.action);
  assert.equal(sample.ok, true);
  assert.ok(sample.durationSeconds > 0);
  assert.ok(sample.handling.activeActionSeconds > 0);
  assert.equal(technique.successes, credit);
  assert.equal(n.stats.independentMeals, meals);
  assert.equal(n.discovery.effects.some(e => e.objectId === acquired.materialId), false);
  assert.ok(pendingIdentity(n).some(p => p.id === sample.ingestionId && p.actionId === sample.eventId));
  const effect = waitForOwnSustained(f, sample);
  assert.equal(effect.objectId, acquired.materialId);
  assert.equal(effect.ingestionId, sample.ingestionId);
  assert.equal(effect.actionId, sample.eventId);
  assert.equal(retainedProofIntegrityError(n), null);
});

test('a repeated producer does not authorize an early second sample of its newborn material', () => {
  const f = fixture(), { n, source } = f;
  const first = discoveryDecision(n);
  assert.deepEqual(first.action, { type: 'pull', targetId: source.id });
  const acquired = act(f, first.action), next = discoveryDecision(n);
  assert.deepEqual(next.action, { type: 'sample', targetId: acquired.materialId });
  const sample = act(f, next.action);
  const pending = clone(n.discovery.samplesPending), gut = pendingIdentity(n);
  assert.ok(n.elapsed - pending[acquired.materialId] < 45);
  assert.equal(n.discovery.effects.some(e => e.objectId === acquired.materialId), false);
  const decision = discoveryDecision(n);
  assert.notDeepEqual(decision.action, { type: 'sample', targetId: acquired.materialId });
  assert.deepEqual(n.discovery.samplesPending, pending);
  assert.deepEqual(pendingIdentity(n), gut);
  assert.equal(n.discovery.experiments.filter(e => e.ingestionId === sample.ingestionId).length, 1);
  assert.equal(retainedProofIntegrityError(n), null);
});

test('one acquired return and the learning ablation retain the original source wait', () => {
  for (const mode of ['one-return', 'ablation', 'no-learned-technique']) {
    const f = fixture({ returns: mode === 'one-return' ? 1 : 2 }), { n, source } = f;
    if (mode === 'no-learned-technique') n.discovery.techniques = [];
    const pending = clone(n.discovery.samplesPending), gut = pendingIdentity(n);
    assert.equal(sourcePending(n, source.id), true);
    const decision = discoveryDecision(n, { foodLearning: mode !== 'ablation' });
    assert.notEqual(decision.need, 'food', mode);
    assert.equal(n.discovery.run, null, mode);
    assert.deepEqual(n.discovery.samplesPending, pending);
    assert.deepEqual(pendingIdentity(n), gut);
  }
});

test('ordinary water, sleep, rest, content and fullness gates retain priority', () => {
  for (const kind of ['water', 'sleep', 'rest', 'content', 'full']) {
    const f = fixture(), { n, source } = f;
    if (kind === 'water') { n.physiology.waterDeficitMl = 4000; n.flask.water = .5; }
    if (kind === 'sleep') n.physiology.sleepPressure = 99;
    if (kind === 'rest') n.physiology.stamina = 5;
    if (kind === 'content') n.physiology.hoursSinceMeal = 1;
    if (kind === 'full') for (const p of n.physiology.stomach) p.remainingMassGrams = 1000;
    projectPhysiology(n);
    assert.equal(sourcePending(n, source.id), true);
    const before = clone(n.discovery.samplesPending), gut = pendingIdentity(n);
    const decision = discoveryDecision(n);
    assert.notEqual(decision.need, 'food', kind);
    if (kind === 'water') assert.equal(decision.action.type, 'drink');
    if (kind === 'sleep') assert.equal(decision.action.type, 'sleep');
    if (kind === 'rest') assert.equal(decision.action.type, 'rest');
    assert.deepEqual(n.discovery.samplesPending, before);
    assert.deepEqual(pendingIdentity(n), gut);
  }
});

test('loss of retained proof during spare-hand approach abandons only the unstarted acquisition', () => {
  for (const stage of ['approach', 'at-acquisition']) {
    const f = fixture(), { n, source, technique } = f;
    place(f, { x: source.position.x + 280, y: source.position.y });
    const first = discoveryDecision(n);
    assert.equal(first.need, 'food');
    assert.equal(first.action.type, 'move');
    assert.equal(act(f, first.action).ok, true);
    const run = n.discovery.run, credit = clone(technique);
    if (stage === 'at-acquisition') place(f, { x: source.position.x + 20, y: source.position.y });
    n.memory.experience = n.memory.experience.filter(e => e.id !== f.chains[0].effect.proofEventId);
    const held = [...n.inventory.items], pending = clone(n.discovery.samplesPending), gut = pendingIdentity(n);
    assert.equal(sourcePending(n, source.id), true);
    const decision = discoveryDecision(n);
    assert.notEqual(decision.need, 'food', stage);
    assert.notEqual(n.discovery.run, run, stage);
    assert.equal(n.discovery.run, null, stage);
    assert.deepEqual(n.inventory.items, held);
    assert.deepEqual(n.discovery.samplesPending, pending);
    assert.deepEqual(pendingIdentity(n), gut);
    assert.deepEqual(technique, credit, 'retirement is not a failed physical technique');
  }
});

test('a source wait that has cleared no longer needs the repeated-proof exception', () => {
  const f = fixture(), { n, source } = f;
  place(f, { x: source.position.x + 280, y: source.position.y });
  assert.equal(discoveryDecision(n).action.type, 'move');
  const run = n.discovery.run;
  // Time and digestion really advance. No pending timestamp is cleared or moved.
  tick(f, 46);
  comfortableHungry(n);
  place(f, { x: source.position.x + 20, y: source.position.y });
  n.memory.experience = n.memory.experience.filter(e => e.id !== f.chains[0].acquisition.eventId);
  assert.equal(sourcePending(n, source.id), false);
  const decision = discoveryDecision(n);
  assert.deepEqual(decision.action, { type: 'pull', targetId: source.id });
  assert.equal(n.discovery.run, run);
});

test('after real acquisition, proof retirement does not add a first-sample cancellation rule', () => {
  const f = fixture(), { n, source, technique } = f;
  const first = discoveryDecision(n);
  assert.deepEqual(first.action, { type: 'pull', targetId: source.id });
  const result = act(f, first.action), credit = clone(technique);
  assert.equal(n.discovery.run.cursor, 1);
  n.memory.experience = n.memory.experience.filter(e => e.id !== f.chains[0].effect.proofEventId);
  assert.equal(sourcePending(n, source.id), true);
  assert.deepEqual(discoveryDecision(n).action, { type: 'sample', targetId: result.materialId });
  assert.deepEqual(technique, credit);
});

test('full hands still pay the existing real release before a pending-source acquisition', () => {
  const f = fixture({ fullHands: true }), { n, source, technique } = f;
  assert.equal(bodySignals(n).hunger, 'peckish');
  const held = [...n.inventory.items], credit = clone(technique), pending = clone(n.discovery.samplesPending), gut = pendingIdentity(n);
  const decision = discoveryDecision(n);
  assert.equal(decision.need, 'food');
  assert.equal(decision.action.type, 'release');
  assert.ok(held.includes(decision.action.targetId));
  assert.equal(n.discovery.run.cursor, 0);
  assert.deepEqual(n.inventory.items, held);
  assert.deepEqual(n.discovery.samplesPending, pending);
  assert.deepEqual(pendingIdentity(n), gut);
  const material = lookupEcologyObject(f.e.ecology, decision.action.targetId), mass = material.massGrams;
  const released = act(f, decision.action);
  assert.equal(released.code, 'object_released');
  assert.ok(released.durationSeconds > 0);
  assert.ok(released.handling.activeActionSeconds > 0);
  assert.equal(n.inventory.items.length, 3);
  assert.equal(material.heldBy, null);
  assert.equal(material.massGrams, mass);
  assert.equal(n.discovery.run.cursor, 0);
  assert.equal(sourcePending(n, source.id), true);
  const next = discoveryDecision(n);
  assert.deepEqual(next.action, { type: 'pull', targetId: source.id });
  const acquired = act(f, next.action);
  assert.equal(acquired.ok, true);
  assert.ok(acquired.durationSeconds > 0);
  assert.ok(acquired.handling.activeActionSeconds > 0);
  assert.equal(n.inventory.items.length, 4);
  assert.equal(n.inventory.items.includes(decision.action.targetId), false);
  assert.equal(n.discovery.run.cursor, 1);
  assert.equal(n.discovery.run.pendingProducerExemption, undefined);
  assert.deepEqual(technique, credit);
  assert.equal(retainedProofIntegrityError(n), null);
});

test('full-handed approach revalidates retained support before paying for release', () => {
  const f = fixture({ fullHands: true }), { n, source, technique } = f;
  place(f, { x: source.position.x + 280, y: source.position.y });
  const first = discoveryDecision(n);
  assert.equal(first.need, 'food');
  assert.equal(first.action.type, 'move');
  assert.equal(act(f, first.action).ok, true);
  place(f, { x: source.position.x + 20, y: source.position.y });
  n.memory.experience = n.memory.experience.filter(e => e.id !== f.chains[0].effect.proofEventId);
  const held = [...n.inventory.items], credit = clone(technique), pending = clone(n.discovery.samplesPending), gut = pendingIdentity(n);
  assert.equal(sourcePending(n, source.id), true);
  const decision = discoveryDecision(n);
  assert.notEqual(decision.need, 'food');
  assert.notEqual(decision.action.type, 'release');
  assert.equal(n.discovery.run, null);
  assert.deepEqual(n.inventory.items, held);
  assert.deepEqual(n.discovery.samplesPending, pending);
  assert.deepEqual(pendingIdentity(n), gut);
  assert.deepEqual(technique, credit);
});

test('native save and reopen clear an unfinished exempt release but preserve pending physical identities', () => {
  const f = fixture({ fullHands: true }), { n, e } = f;
  const decision = discoveryDecision(n);
  assert.equal(decision.action.type, 'release');
  assert.equal(n.discovery.run.pendingProducerExemption, true);
  assert.equal(requestNpcAction(n, decision.action, e).code, 'ACTION_STARTED');
  tick(f, .2);
  assert.ok(n.active);
  assert.equal(n.discovery.run.cursor, 0);
  const donor = decision.action.targetId, held = [...n.inventory.items],
    pending = clone(n.discovery.samplesPending), gut = pendingIdentity(n), effects = clone(n.discovery.effects);
  const rows = new Map(), disk = {
    getItem: key => rows.get(key) ?? null,
    setItem: (key, value) => rows.set(key, value),
  };
  // Register the raw-state boundary exactly as the existing save tests do.
  const savable = Object.assign(createOzarkState(geometry), f.state);
  assert.equal(writeOzarkSave(disk, savable, geometry), true);
  assert.ok(rows.size > 0);
  const loaded = loadOzarkSave(disk, geometry);
  assert.equal(loaded.blocked, false, loaded.error);
  const restored = loaded.state.agents[0];
  assert.equal(restored.active, null);
  assert.equal(restored.discovery.run, null);
  assert.equal(Object.hasOwn(restored.discovery, 'pendingProducerExemption'), false);
  assert.deepEqual(restored.inventory.items, held);
  assert.equal(lookupEcologyObject(loaded.state.environment.ecology, donor).heldBy, restored.id);
  assert.deepEqual(restored.discovery.samplesPending, pending);
  assert.deepEqual(pendingIdentity(restored), gut);
  assert.deepEqual(restored.discovery.effects, effects);
  assert.equal(retainedProofIntegrityError(restored), null);
});

test('third-return adverse or uncertain own evidence stops an unstarted exemption, including before release', () => {
  for (const fullHands of [false, true]) for (const malformed of [false, true]) {
    const f = fixture({ returns: 3, fullHands }), { n, source, technique } = f;
    place(f, { x: source.position.x + 280, y: source.position.y });
    const first = discoveryDecision(n);
    assert.equal(first.need, 'food');
    assert.equal(first.action.type, 'move');
    assert.equal(act(f, first.action).ok, true);
    if (fullHands) place(f, { x: source.position.x + 20, y: source.position.y });
    const effect = n.discovery.effects.find(e => e.id === f.chains[2].effect.id);
    const receipt = n.memory.experience.find(e => e.id === effect.proofEventId);
    // Explicit adversarial negative-evidence mutation, never a manufactured
    // positive. The first two independently earned favorable chains remain
    // untouched; this models newly available contrary evidence from return #3.
    effect.effect = receipt.details.feedback.effect = 'discomfort';
    effect.pain = receipt.details.feedback.pain = 'aching';
    if (malformed) receipt.details.feedback.pain = 'severe';
    assert.equal(n.discovery.effects.filter(e => f.chains.slice(0, 2).some(c => c.effect.id === e.id) &&
      e.effect === 'sustained').length, 2);
    const held = [...n.inventory.items], credit = clone(technique),
      pending = clone(n.discovery.samplesPending), gut = pendingIdentity(n);
    assert.equal(sourcePending(n, source.id), true);
    const decision = discoveryDecision(n);
    assert.notEqual(decision.need, 'food', `${fullHands}:${malformed}`);
    if (fullHands) assert.notEqual(decision.action.type, 'release');
    assert.equal(n.discovery.run, null);
    assert.deepEqual(n.inventory.items, held);
    assert.deepEqual(n.discovery.samplesPending, pending);
    assert.deepEqual(pendingIdentity(n), gut);
    assert.deepEqual(technique, credit, 'denying an exemption must not invent a failed action');
  }
});

test('native absence, depletion and unreachable remembered routes do not become free acquisition', () => {
  for (const kind of ['absent', 'depleted', 'no-route']) {
    const f = fixture(), { n, source } = f;
    if (kind === 'absent') {
      f.e.ecology.plants = f.e.ecology.plants.filter(p => p.id !== source.id);
      assert.equal(act(f, { type: 'inspect_object', targetId: source.id }).code, 'OBJECT_GONE');
    }
    if (kind === 'depleted') {
      source.quantity = 0; // Explicit depletion surprise, never added stock.
      assert.equal(act(f, { type: 'pull', targetId: source.id }).code, 'nothing_detached');
    }
    if (kind === 'no-route') {
      place(f, { x: source.position.x + 280, y: source.position.y });
      n.memory.cells = {};
    }
    const held = [...n.inventory.items], pending = clone(n.discovery.samplesPending), gut = pendingIdentity(n);
    assert.equal(sourcePending(n, source.id), true);
    assert.notEqual(discoveryDecision(n).need, 'food', kind);
    assert.equal(n.discovery.run, null);
    assert.deepEqual(n.inventory.items, held);
    assert.deepEqual(n.discovery.samplesPending, pending);
    assert.deepEqual(pendingIdentity(n), gut);
  }
});

test('new native acquisition failure leaves finite matter and learned credit honest', () => {
  const f = fixture(), { n, source, technique } = f;
  const decision = discoveryDecision(n);
  assert.deepEqual(decision.action, { type: 'pull', targetId: source.id });
  const prior = clone(technique), effects = clone(n.discovery.effects), pending = clone(n.discovery.samplesPending), gut = pendingIdentity(n);
  source.quantity = 0; // Surprising actual exhaustion after the decision.
  const result = act(f, decision.action);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'nothing_detached');
  assert.equal(n.discovery.run, null);
  assert.equal(n.inventory.items.length, 0);
  assert.deepEqual(technique, prior);
  assert.deepEqual(n.discovery.effects, effects);
  assert.deepEqual(n.discovery.samplesPending, pending);
  assert.deepEqual(pendingIdentity(n), gut);
  assert.equal(retainedProofIntegrityError(n), null);
});
