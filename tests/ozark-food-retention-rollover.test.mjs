import test from 'node:test';
import assert from 'node:assert/strict';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { loadOzarkSave, writeOzarkSave, getOzarkSaveValidationFailure, getOzarkSaveFailure, OZARK_SAVE_KEY } from '../src/ozark-save.js';
import { bindOzarkWorldAgent } from '../src/ozark-agent-world.js';
import { requestNpcAction, tickNpc, observeNpc } from '../src/npc.js';
import { processDiscoveryFeedback } from '../src/discovery.js';
import { recordEvent } from '../src/npc-memory.js';
import { retainedProofIntegrityError } from '../src/proof-retention.js';
import { DISCOVERY_RULES } from '../src/discovery-config.js';
import { NPC_RULES } from '../src/config.js';

// Bounded engineering fixture: positioning, elapsed time and body needs are authored.
// Actions and digestive feedback are genuine. Ecology is held static while both
// actor clocks advance; this is neither autonomous survival nor native desktop QA.
function fixture() {
  const bytes = new Map(), storage = { getItem: key => bytes.get(key) ?? null,
    setItem: (key, value) => bytes.set(key, value) };
  const geometry = createOzarkWorldGeometry();
  const state = loadOzarkSave(storage, geometry, { communicationSeed: 211 }).state;
  const actor = state.agents[0];
  for (const npc of state.agents) bindOzarkWorldAgent(npc, geometry, state);
  const source = state.environment.ecology.plants.find(row => row.kind === 'apple_tree' && row.quantity > 0);
  actor.position = [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2].map(angle => ({
    x: source.position.x + 45 * Math.cos(angle), y: source.position.y + 45 * Math.sin(angle),
  })).find(point => geometry.canOccupy(point.x, point.y));
  assert.ok(actor.position);
  actor.physiology.waterDeficitMl = 1000;
  actor.physiology.hoursSinceMeal = 12;
  actor.physiology.satietyHours = 0;
  // Start late enough for the authored location to fit the codec's reachable
  // observation bound. No journey or autonomous discovery is claimed.
  state.elapsed = state.environment.elapsed = state.environment.ecology.elapsed = 1200;
  for (const npc of state.agents) npc.elapsed = state.elapsed;
  observeNpc(actor, state.environment);
  const initialSaved = writeOzarkSave(storage, state, geometry);
  assert.equal(initialSaved, true, JSON.stringify(getOzarkSaveValidationFailure(state)));
  const tick = () => {
    state.elapsed += .25;
    state.environment.elapsed = state.environment.ecology.elapsed = state.elapsed;
    for (const npc of state.agents) tickNpc(npc, .25, state.environment);
    processDiscoveryFeedback(actor);
  };
  const act = action => {
    assert.equal(requestNpcAction(actor, action, state.environment).code, 'ACTION_STARTED');
    for (let i = 0; i < 1200 && actor.active; i++) tick();
    assert.equal(actor.active, null);
    assert.equal(actor.lastResult.ok, true, actor.lastResult.code);
    return actor.lastResult;
  };
  return { bytes, storage, geometry, state, actor, source, tick, act };
}

function closure(actor) {
  assert.equal(retainedProofIntegrityError(actor), null);
  return actor.discovery.effects.map(effect => {
    const sample = actor.discovery.experiments.find(row => row.actionId === effect.actionId && row.ingestionId === effect.ingestionId);
    const action = actor.memory.experience.find(row => row.id === effect.actionId);
    const condition = actor.memory.experience.find(row => row.id === effect.proofEventId);
    assert.equal(sample?.primitive, 'sample');
    assert.equal(sample?.ok, true);
    assert.equal(sample?.targetId, effect.objectId);
    assert.ok(sample.durationSeconds > 0);
    assert.ok(effect.at > sample.at, 'effect is delayed after actual swallowing');
    assert.equal(action?.details.result.ingestionId, effect.ingestionId);
    assert.equal(condition?.details.feedback.id, effect.id);
    return structuredClone({ effect, sample, action, condition });
  });
}

test('earned real own food effects survive full evidence buffers and repeated current-world save/reopen', () => {
  const f = fixture(), { actor, state, source, act, tick } = f;
  const originalStock = source.quantity;
  const materialId = act({ type: 'pull', targetId: source.id }).materialId;
  assert.ok(materialId);
  assert.equal(source.quantity, originalStock - 1);
  act({ type: 'sample', targetId: materialId });
  for (let i = 0; i < 120 * 4 && !actor.discovery.effects.some(row => row.effect === 'sustained'); i++) tick();
  assert.ok(actor.discovery.effects.some(row => row.effect === 'sustained'));
  const initial = closure(actor);
  for (let i = 0; i < 190; i++) act({ type: 'inspect_object', targetId: source.id });
  for (let i = 0; i < 450; i++) recordEvent(actor, 'decision', { summary: 'Bounded engineering history pressure.' });
  assert.equal(actor.discovery.experiments.length, DISCOVERY_RULES.maxExperiments);
  assert.equal(actor.memory.experience.length, NPC_RULES.maxExperience);
  const earned = closure(actor);
  for (const original of initial) assert.deepEqual(earned.find(row => row.effect.id === original.effect.id), original);
  // Further genuine feedback may arrive while the paid inspections advance time.
  assert.deepEqual(state.agents[1].discovery.effects, []);
  const body = structuredClone(actor.physiology), rng = actor.rng;
  const saved = writeOzarkSave(f.storage, state, f.geometry);
  assert.equal(saved, true, JSON.stringify(getOzarkSaveValidationFailure(state)));
  assert.deepEqual(actor.physiology, body, 'saving does not advance biology');
  assert.equal(actor.rng, rng, 'saving does not draw policy randomness');
  for (let i = 0; i < 2; i++) {
    const opened = loadOzarkSave(f.storage, f.geometry);
    assert.equal(opened.blocked, false, opened.error);
    assert.deepEqual(closure(opened.state.agents[0]), earned);
    assert.deepEqual(opened.state.agents[0].physiology, body);
    assert.equal(opened.state.agents[0].rng, rng);
    assert.deepEqual(opened.state.agents[1].discovery.effects, [], 'peer never inherits own food proof');
    assert.equal(writeOzarkSave(f.storage, opened.state, f.geometry), true);
  }
  const good = f.storage.getItem(OZARK_SAVE_KEY);
  const tracked = loadOzarkSave(f.storage, f.geometry).state;
  for (const corrupt of [
    raw => { raw.agents[0].memory.experience = raw.agents[0].memory.experience.filter(row => row.id !== earned[0].effect.actionId); },
    // Copying only effect claims supplies no recipient-owned causal receipts.
    raw => { raw.agents[1].discovery.effects = structuredClone(raw.agents[0].discovery.effects); },
  ]) {
    const raw = JSON.parse(good); corrupt(raw);
    const broken = JSON.stringify(raw); f.storage.setItem(OZARK_SAVE_KEY, broken);
    const opened = loadOzarkSave(f.storage, f.geometry);
    assert.equal(opened.blocked, true);
    assert.equal(f.storage.getItem(OZARK_SAVE_KEY), broken, 'invalid proof protects original bytes');
    assert.equal(writeOzarkSave(f.storage, tracked, f.geometry), false);
    assert.equal(getOzarkSaveFailure(tracked), 'stored-value-changed');
    assert.equal(f.storage.getItem(OZARK_SAVE_KEY), broken);
  }
});
