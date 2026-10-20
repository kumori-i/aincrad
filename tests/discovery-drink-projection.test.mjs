import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { createNpc } from '../src/npc-state.js';
import { requestNpcAction } from '../src/npc.js';
import { projectPhysiology } from '../src/biology.js';
import { loadSave, prepareLegacyPendingMigration, writeSave } from '../src/save.js';
import { syntheticProtectedRaw } from './native-synthetic-fixture.mjs';

test('native discovery drink projects fullness before its original receipt without advancing digestion or relief', () => {
  const actor = createNpc({ mode: 'discovery' });
  actor.flask.water = .25;
  actor.flask.provenance = null;
  projectPhysiology(actor);
  const before = structuredClone(actor), actionId = actor.memory.nextId;
  const result = requestNpcAction(actor, { type: 'drink' });
  const projected = structuredClone(actor);
  projectPhysiology(projected);

  assert.equal(result.code, 'DRANK');
  assert.equal(actor.nourishment, projected.nourishment);
  assert.ok(actor.nourishment > before.nourishment, 'already swallowed water contributes fullness');
  assert.equal(actor.hydration, before.hydration);
  assert.equal(result.hydrationGain, 0);
  assert.equal(result.delayed, true);
  assert.equal(result.independent, false);
  for (const key of ['clockHours', 'feedback', 'availableEnergyKcal', 'storedEnergyKcal'])
    assert.deepEqual(actor.physiology[key], before.physiology[key], key);
  assert.equal(actor.physiology.stomach.length, before.physiology.stomach.length + 1);
  const portion = actor.physiology.stomach.at(-1);
  assert.equal(portion.actionId, actionId);
  assert.equal(portion.id, result.ingestionId);
  assert.equal(portion.elapsedHours, 0);
  assert.equal(portion.absorbedWaterMl, 0);
  assert.equal(portion.absorbedKcal, 0);
  assert.equal(portion.remainingWaterMl, 250);
  assert.equal(actor.flask.water, 0);
  const receipt = actor.memory.experience.find(row => row.id === result.eventId);
  assert.equal(receipt.id, actionId);
  assert.equal(receipt.details.nourishment, actor.nourishment);
  assert.equal(actor.rng, before.rng);
  assert.equal(actor.stats.independentMeals, before.stats.independentMeals);
  assert.deepEqual(actor.discovery.effects, before.discovery.effects);
});

test('a marked world saves immediately after native drink without a repair tick or relaxed guard', () => {
  const prepared = prepareLegacyPendingMigration(syntheticProtectedRaw());
  assert.equal(prepared.ok, true, prepared.reason);
  const bytes = new Map([[CONFIG.saveKey, prepared.candidate]]);
  const disk = {
    getItem: key => bytes.get(key) ?? null,
    setItem: (key, value) => bytes.set(key, value),
  };
  const opened = loadSave(disk);
  assert.equal(opened.blocked, false);
  const state = opened.state, actor = state.agents[0];
  actor.flask.water = .25;
  actor.flask.provenance = null;
  assert.equal(writeSave(disk, state), true, 'fixture is strictly savable before drink');
  const result = requestNpcAction(actor, { type: 'drink' }, state.environment);
  assert.equal(result.code, 'DRANK');
  assert.equal(writeSave(disk, state), true, 'immediate strict save succeeds without a tick');
  const loaded = loadSave(disk);
  assert.equal(loaded.blocked, false, loaded.error);
  const restored = loaded.state.agents[0];
  for (const key of ['physiology', 'nourishment', 'hydration', 'flask', 'rng'])
    assert.deepEqual(restored[key], actor[key], key);
  assert.deepEqual(
    restored.memory.experience.find(row => row.id === result.eventId),
    actor.memory.experience.find(row => row.id === result.eventId),
  );
});

test('a refused empty discovery drink does not change derived or physical body state', () => {
  const actor = createNpc({ mode: 'discovery' });
  actor.flask.water = 0;
  const before = structuredClone(actor);
  const result = requestNpcAction(actor, { type: 'drink' });
  assert.equal(result.code, 'EMPTY_FLASK');
  assert.deepEqual(actor.physiology, before.physiology);
  assert.equal(actor.nourishment, before.nourishment);
});
