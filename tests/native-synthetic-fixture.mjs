/** A generated, non-private protected save for cross-platform native import QA.
 * It has one fully proven learned effect and a separate pending sample receipt
 * with no experiment. Both physical transfers use the real body/action paths.
 * No historical world bytes or private fixture are included in this module. */
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { canStand, freshState } from '../src/world.js';
import { ingestMaterial, projectPhysiology } from '../src/biology.js';
import { requestNpcAction, tickNpc, observeNpc } from '../src/npc.js';
import { processDiscoveryFeedback } from '../src/discovery.js';
import { retainedEffectProofError } from '../src/proof-retention.js';
import { loadSave, prepareLegacyPendingMigration, validateSave } from '../src/save.js';

function finish(actor, environment, action) {
  const started = requestNpcAction(actor, action, environment);
  if (started.code === 'ACTION_STARTED')
    for (let i = 0; i < 1000 && actor.active; i++) tickNpc(actor, 1 / 60, environment);
  assert.equal(actor.active, null, 'synthetic physical action finished');
  const result = actor.lastResult || started;
  assert.equal(result.ok, true, `synthetic ${action.type} action succeeded`);
  return result;
}

function addProvenEffect(state, actor) {
  const environment = state.environment;
  const plant = environment.ecology.plants.find(row => row.kind === 'apple_tree' && row.quantity > 0);
  assert.ok(plant, 'synthetic world has a physical apple tree');
  actor.position = [
    { x: plant.position.x + 45, y: plant.position.y },
    { x: plant.position.x - 45, y: plant.position.y },
    { x: plant.position.x, y: plant.position.y + 45 },
    { x: plant.position.x, y: plant.position.y - 45 },
  ].find(point => canStand(point.x, point.y, 'valley'));
  assert.ok(actor.position, 'synthetic actor can stand beside apple tree');
  observeNpc(actor, environment);
  assert.ok(actor.discovery.observations[plant.id], 'apple tree was actually observed');
  finish(actor, environment, { type: 'pull', targetId: plant.id });
  const materialId = actor.inventory.items[0];
  const material = environment.ecology.materials.find(row => row.id === materialId);
  assert.ok(material, 'pull created a physical material');
  material.energyKcal = 0;
  actor.physiology.waterDeficitMl = 1000;
  finish(actor, environment, { type: 'sample', targetId: materialId });
  let effect;
  for (let i = 0; i < 120 * 60 && !effect; i++) {
    tickNpc(actor, 1 / 60, environment);
    processDiscoveryFeedback(actor);
    effect = actor.discovery.effects.find(row => row.effect === 'water relief');
  }
  assert.ok(effect, 'body emitted a learned water-relief effect');
  const sample = actor.discovery.experiments.find(row =>
    row.actionId === effect.actionId && row.ingestionId === effect.ingestionId);
  const action = actor.memory.experience.find(row => row.id === effect.actionId);
  const proof = actor.memory.experience.find(row => row.id === effect.proofEventId);
  assert.equal(sample?.primitive, 'sample');
  assert.equal(sample?.ok, true);
  assert.equal(sample?.targetId, effect.objectId);
  assert.equal(action?.details.action.targetId, effect.objectId);
  assert.equal(action?.details.result.ingestionId, effect.ingestionId);
  assert.equal(action?.at, sample?.at);
  assert.equal(proof?.details.code, 'DISCOVERY_EFFECT');
  assert.equal(proof?.details.feedback.id, effect.id);
  assert.equal(proof?.details.feedback.at, effect.at);
  assert.equal(proof?.details.feedback.source, 'experienced');
  assert.equal(retainedEffectProofError(actor), null);
  return effect;
}

export function syntheticProtectedRaw() {
  const generated = freshState();
  const sampler = generated.agents.find(row => row.id === 'aster');
  if (!sampler) throw new Error('Synthetic fixture has no Aster actor.');
  const learnedEffect = addProvenEffect(generated, sampler);
  // Match the persisted envelope before introducing the historical orphan;
  // validation removes optional live-only sensory/cache fields.
  const state = validateSave(generated);
  const actor = state.agents.find(row => row.id === 'aster');
  assert.equal(state.saveBlocked, undefined, 'completed learned proof can be saved');
  assert.ok(actor.discovery.effects.some(row => row.id === learnedEffect.id));
  assert.equal(retainedEffectProofError(actor), null);
  const objectId = 'object:900001';
  const actionId = actor.memory.nextId++;
  const at = actor.elapsed;
  const result = ingestMaterial(actor,
    { massGrams: 30, energyKcal: 16, waterMl: 24, digestHours: 2 },
    { source: 'sampled', objectId, actionId, at });
  if (!result.ok || result.code !== 'SWALLOWED')
    throw new Error('Synthetic fixture did not physically ingest material.');
  projectPhysiology(actor);
  actor.memory.experience.push({
    id: actionId, at, type: 'action',
    details: { action: { type: 'sample', targetId: objectId }, result },
  });

  // The alias is an in-memory convenience, not part of the v8 save envelope.
  const { npc: _alias, ...saved } = state;
  const raw = JSON.stringify(saved);
  const values = new Map([[CONFIG.saveKey, raw]]);
  const disk = { getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value) };
  if (loadSave(disk).blocked !== true || disk.getItem(CONFIG.saveKey) !== raw)
    throw new Error('Synthetic fixture is not protected without a write.');
  const prepared = prepareLegacyPendingMigration(raw);
  if (!prepared.ok || prepared.report.migrations.length !== 1 ||
      prepared.report.migrations[0].actorId !== 'aster' ||
      prepared.report.migrations[0].ingestionId !== result.ingestionId ||
      !JSON.parse(prepared.candidate).agents[0].discovery.effects.some(row =>
        row.id === learnedEffect.id && row.proofEventId === learnedEffect.proofEventId))
    throw new Error(`Synthetic fixture cannot be strictly migrated: ${prepared.reason || 'unknown reason'}`);
  return raw;
}
