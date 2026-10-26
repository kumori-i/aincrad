import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { createNpc } from '../src/npc-state.js';
import { requestNpcAction } from '../src/npc.js';
import { projectPhysiology } from '../src/biology.js';


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
  assert.equal(actor.nourishment, before.nourishment, 'water contributes transient gut fullness, never food satisfaction');
  assert.equal(actor.physiology.satietyHours, before.physiology.satietyHours);
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



test('a refused empty discovery drink does not change derived or physical body state', () => {
  const actor = createNpc({ mode: 'discovery' });
  actor.flask.water = 0;
  const before = structuredClone(actor);
  const result = requestNpcAction(actor, { type: 'drink' });
  assert.equal(result.code, 'EMPTY_FLASK');
  assert.deepEqual(actor.physiology, before.physiology);
  assert.equal(actor.nourishment, before.nourishment);
});
