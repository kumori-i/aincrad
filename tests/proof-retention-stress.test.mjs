import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { freshState, canStand } from '../src/world.js';
import { createNpc } from '../src/npc-state.js';
import { requestNpcAction, tickNpc, observeNpc } from '../src/npc.js';
import { processDiscoveryFeedback } from '../src/discovery.js';
import { ingestMaterial, canIngestMaterial } from '../src/biology.js';
import { recordEvent } from '../src/npc-memory.js';
import { retainedProofIntegrityError } from '../src/proof-retention.js';
const proofIntegrityProblem=state=>state.agents.map(retainedProofIntegrityError).find(Boolean)||null;
import { ownExtractionOrigins } from '../src/food-source-caution.js';
import { BIOLOGY_RULES } from '../src/biology-config.js';
import { DISCOVERY_RULES } from '../src/discovery-config.js';
import { NPC_RULES, CAVES } from '../src/config.js';
import { planProofRetention, applyProofRetention, PROOF_RETENTION_BOUNDS } from '../src/proof-retention.js';

function worldFixture() {
  const state = freshState(), npc = state.agents[0], environment = state.environment;
  const plant = environment.ecology.plants.find(row => row.kind === 'apple_tree' && row.quantity > 0);
  assert.ok(plant);
  npc.position = [
    { x: plant.position.x + 45, y: plant.position.y },
    { x: plant.position.x - 45, y: plant.position.y },
    { x: plant.position.x, y: plant.position.y + 45 },
    { x: plant.position.x, y: plant.position.y - 45 },
  ].find(point => canStand(point.x, point.y, 'valley'));
  assert.ok(npc.position);
  observeNpc(npc, environment);
  return { state, npc, environment, plant };
}

function finish(npc, environment, action) {
  const started = requestNpcAction(npc, action, environment);
  if (started.code === 'ACTION_STARTED')
    for (let i = 0; i < 1000 && npc.active; i++) tickNpc(npc, 1 / 60, environment);
  assert.equal(npc.active, null);
  return npc.lastResult || started;
}

function completeEffect(npc, effect) {
  const sample = npc.discovery.experiments.find(row => row.actionId === effect.actionId);
  const action = npc.memory.experience.find(row => row.id === effect.actionId);
  const proof = npc.memory.experience.find(row => row.id === effect.proofEventId);
  assert.equal(sample?.primitive, 'sample');
  assert.equal(sample?.ingestionId, effect.ingestionId);
  assert.equal(action?.details.result.ingestionId, effect.ingestionId);
  assert.equal(proof?.details.code, 'DISCOVERY_EFFECT');
  assert.equal(proof?.details.feedback.id, effect.id);
  assert.equal(proof?.details.feedback.at, effect.at);
}

test('65 actual delayed feedback emissions roll the biological FIFO; 64 unseen links remain learnable', () => {
  const { state, npc, environment, plant } = worldFixture();
  // Additional stock exists only in this isolated physical-action fixture.
  plant.quantity = BIOLOGY_RULES.maxFeedback + 2;
  const emitted = [];
  for (let i = 0; i < BIOLOGY_RULES.maxFeedback + 1; i++) {
    assert.equal(finish(npc, environment, { type: 'pull', targetId: plant.id }).ok, true);
    const id = npc.inventory.items.at(-1);
    const material = environment.ecology.materials.find(row => row.id === id);
    assert.ok(material);
    material.energyKcal = 0;
    material.waterMl = material.massGrams;
    material.digestHours = .15;
    npc.physiology.waterDeficitMl = 1000;
    assert.equal(finish(npc, environment, { type: 'sample', targetId: id }).ok, true);
    const sample = npc.discovery.experiments.findLast(row => row.primitive === 'sample' && row.targetId === id);
    let feedback;
    for (let j = 0; j < 600 && !feedback; j++) {
      tickNpc(npc, .25, environment);
      feedback = npc.physiology.feedback.find(row => row.ingestionId === sample.ingestionId && row.effect === 'water relief');
    }
    assert.ok(feedback, `portion ${i + 1} emitted real delayed feedback`);
    emitted.push(feedback.id);
    for (let j = 0; j < 80 && npc.physiology.stomach.some(row => row.id === sample.ingestionId); j++) tickNpc(npc, .25, environment);
    assert.equal(npc.physiology.stomach.some(row => row.id === sample.ingestionId), false);
    assert.equal(finish(npc, environment, { type: 'release', targetId: id }).ok, true);
  }
  assert.equal(npc.discovery.effects.length, 0, 'recognition was deliberately delayed');
  assert.equal(npc.physiology.feedback.length, BIOLOGY_RULES.maxFeedback);
  assert.deepEqual(npc.physiology.feedback.map(row => row.id), emitted.slice(1));
  processDiscoveryFeedback(npc);
  assert.deepEqual(npc.discovery.effects.map(row => row.id), emitted.slice(1));
  for (const effect of npc.discovery.effects) completeEffect(npc, effect);
  assert.ok(npc.discovery.experiments.length <= DISCOVERY_RULES.maxExperiments);
  assert.ok(npc.memory.experience.length <= NPC_RULES.maxExperience);
  assert.equal(proofIntegrityProblem(state), null, `live proof error: ${npc.proofRetentionError}`);
});

test('24 real digestive input slots refuse only physical swallowing under full memory logs', () => {
  const { npc, environment, plant } = worldFixture();
  assert.equal(finish(npc, environment, { type: 'pull', targetId: plant.id }).ok, true);
  const id = npc.inventory.items[0], material = environment.ecology.materials.find(row => row.id === id);
  assert.ok(material);
  for (let i = 0; i < 180; i++) assert.equal(finish(npc, environment, { type: 'inspect_object', targetId: id }).ok, true);
  for (let i = 0; i < 450; i++) recordEvent(npc, 'decision', { summary: 'Unrelated capacity pressure' });
  assert.equal(npc.discovery.experiments.length, DISCOVERY_RULES.maxExperiments);
  assert.equal(npc.memory.experience.length, NPC_RULES.maxExperience);
  while (npc.physiology.stomach.length < BIOLOGY_RULES.maxDigestiveInputs)
    assert.equal(ingestMaterial(npc, { massGrams: 1, energyKcal: 0, waterMl: 0, digestHours: 24 }, { provenance: 'isolated body fixture' }).ok, true);
  assert.equal(canIngestMaterial(npc, { massGrams: DISCOVERY_RULES.sampleGrams }).code, 'TOO_FULL');
  const before = { mass: material.massGrams, kcal: material.energyKcal, removed: environment.ecology.ledger.humanRemovedKcal };
  assert.equal(finish(npc, environment, { type: 'sample', targetId: id }).code, 'TOO_FULL');
  assert.deepEqual({ mass: material.massGrams, kcal: material.energyKcal, removed: environment.ecology.ledger.humanRemovedKcal }, before);
  assert.equal(npc.inventory.items.includes(id), true);
  assert.equal(npc.discovery.trials[`${id}|sample`].lastOk, false);
  assert.equal(npc.proofRetentionError, undefined, 'memory capacity did not block the bodily action');
});

// A combinatorial proof-owner fixture isolates planner arithmetic from ecology.
// Every experiment has its original exact action receipt, every effect has its
// own matching condition receipt, and all ingestion identities are distinct.
function fullOwnerFixture() {
  const npc = createNpc({ mode: 'discovery' });
  npc.elapsed = 20000; // Synthetic receipts below are retained past events.
  npc.memory.experience = []; npc.memory.skills = [];
  npc.discovery.experiments = []; npc.discovery.effects = [];
  npc.discovery.reports = []; npc.discovery.techniques = [];
  npc.discovery.observations = {}; npc.discovery.seenFeedback = [];
  npc.physiology.stomach = []; npc.physiology.feedback = [];
  let nextEvent = 1, nextExperiment = 1, nextIngestion = 1;
  const event = (type, details, at = nextEvent) => {
    const row = { id: nextEvent++, at, type, details };
    npc.memory.experience.push(row); return row;
  };
  const experiment = (primitive, targetId, extra = {}) => {
    const result = { ok: true, code: primitive === 'pull' ? 'piece_detached' : primitive === 'grasp' ? 'object_held' : 'DONE', durationSeconds: 1, ...extra };
    const receipt = event('action', { action: { type: primitive, targetId }, result });
    const row = { id: nextExperiment++, at: receipt.at, primitive, targetId, ok: true, code: result.code,
      durationSeconds: 1, actionId: receipt.id, ...extra };
    npc.discovery.experiments.push(row); return row;
  };
  const sourceId = 'object:900000', held = Array.from({ length: DISCOVERY_RULES.capacity }, (_, i) => `object:${900001 + i}`);
  const acquisition = held.map(id => {
    npc.discovery.observations[id] = { id, scene: 'valley', position: { x: 0, y: 0 }, appearance: {}, observedAt: 1 };
    return experiment('pull', sourceId, { materialId: id });
  });
  // Four older held extraction origins, four newer unheld origins, and four
  // distinct latest held grasps must all remain hard owners simultaneously.
  const recentOrigins = Array.from({ length: DISCOVERY_RULES.capacity }, (_, i) =>
    experiment('pull', sourceId, { materialId: `object:${900010 + i}` }));
  const latestHeld = held.map(id => experiment('grasp', id));
  npc.inventory.items = held;
  const effects = [];
  for (let i = 0; i < DISCOVERY_RULES.maxEffects; i++) {
    const ingestionId = `ingestion:${nextIngestion++}`;
    const sample = experiment('sample', held[0], { ingestionId });
    const effect = { id: `feedback:${i + 1}`, at: sample.at + 1, objectId: held[0], actionId: sample.actionId,
      ingestionId, effect: 'sustained', source: 'experienced' };
    effects.push({ sample, effect });
  }
  for (const { effect } of effects) {
    const receipt = event('condition', { code: 'DISCOVERY_EFFECT', feedback: effect }, 10000 + nextEvent);
    effect.proofEventId = receipt.id;
    npc.discovery.effects.push(effect);
  }
  for (let i = 0; i < BIOLOGY_RULES.maxDigestiveInputs + BIOLOGY_RULES.maxFeedback; i++) {
    const ingestionId = `ingestion:${nextIngestion++}`;
    const sample = experiment('sample', held[0], { ingestionId });
    if (i < BIOLOGY_RULES.maxDigestiveInputs)
      npc.physiology.stomach.push({ id: ingestionId, objectId: held[0], actionId: sample.actionId,
        provenance: 'sampled', at: sample.at });
    else npc.physiology.feedback.push({ id: `feedback:pending:${i}`, ingestionId, objectId: held[0],
      actionId: sample.actionId, provenance: 'sampled', at: sample.at + 1 });
  }
  const staging = experiment('inspect_object', held[0]);
  const fill = event('action', { action: { type: 'fill_flask' }, result: { ok: true, code: 'FILLED' } });
  npc.flask.fillEventId = fill.id;
  event('action', { action: { type: 'sleep' }, result: { ok: true, code: 'SLEPT' } });
  for (const shelter of CAVES)
    event('action', { action: { type: 'enter_shelter', shelterId: shelter.id }, result: { ok: true, code: 'ENTERED' } });
  // Eight extra hard action receipts replace eight unowned detail rows so the
  // fixture still hits the same maximum scan budget, rather than exceeding it.
  const detail = Array.from({ length: 175 - 2 * DISCOVERY_RULES.capacity }, () => event('decision', { summary: 'bounded detail' }).id);
  for (let i = 0; i < DISCOVERY_RULES.maxReports; i++)
    npc.discovery.reports.push({ id: `report:${i + 1}`, at: i, status: 'unverified', proposed: [], evidence: [effects[i].sample.id] });
  for (let i = 0; i < NPC_RULES.maxSkills; i++)
    npc.memory.skills.push({ id: `skill:${i + 1}`, at: i, supportingExperience: detail.slice(i * 15, Math.min((i + 1) * 15, 174)), validation: [] });
  for (let i = 0; i < DISCOVERY_RULES.maxTechniques; i++)
    npc.discovery.techniques.push({ id: `technique:${i + 1}`, sourceId, at: i,
      steps: [{ type: 'pull', targetId: '$source' }, { type: 'sample', targetId: '$material' }],
      evidence: [acquisition[0].id, effects[i].sample.id] });
  npc.memory.nextId = nextEvent;
  npc.discovery.nextId = nextExperiment;
  return { npc, staging, acquisition, recentOrigins, latestHeld };
}

test('full distinct hard ownership fits 165 experiments and retires shared soft owners deterministically', () => {
  const { npc, staging, acquisition, recentOrigins, latestHeld } = fullOwnerFixture();
  assert.equal(PROOF_RETENTION_BOUNDS.experiments, 165);
  assert.equal(ownExtractionOrigins(npc).length, 2 * DISCOVERY_RULES.capacity);
  assert.deepEqual(ownExtractionOrigins(npc).slice(-DISCOVERY_RULES.capacity).map(e => e.id), recentOrigins.map(e => e.id));
  assert.equal(new Set([...acquisition, ...recentOrigins, ...latestHeld].map(e => e.actionId)).size, 3 * DISCOVERY_RULES.capacity);
  assert.equal(npc.discovery.experiments.length, PROOF_RETENTION_BOUNDS.experiments);
  assert.equal(npc.memory.experience.length, PROOF_RETENTION_BOUNDS.scannedExperience);
  assert.equal(npc.physiology.stomach.length, BIOLOGY_RULES.maxDigestiveInputs);
  assert.equal(npc.physiology.feedback.length, BIOLOGY_RULES.maxFeedback);
  const before = structuredClone({ effects: npc.discovery.effects, stomach: npc.physiology.stomach,
    feedback: npc.physiology.feedback, inventory: npc.inventory.items });
  const rng = npc.rng, started = performance.now();
  const plan = planProofRetention(npc, { stagingEventIds: [staging.actionId] });
  const elapsed = performance.now() - started;
  assert.equal(plan.ok, true, plan.reason);
  assert.equal(plan.diagnostics.hardExperiments, PROOF_RETENTION_BOUNDS.experiments);
  assert.ok(plan.diagnostics.hardExperience <= PROOF_RETENTION_BOUNDS.experience);
  assert.ok(plan.diagnostics.scannedExperiments <= PROOF_RETENTION_BOUNDS.scannedExperiments);
  assert.ok(plan.diagnostics.scannedExperience <= PROOF_RETENTION_BOUNDS.scannedExperience);
  assert.ok(plan.diagnostics.owners <= PROOF_RETENTION_BOUNDS.owners);
  assert.ok(plan.diagnostics.closureChecks <= PROOF_RETENTION_BOUNDS.owners + 1);
  assert.deepEqual(plan.retirements.filter(row => row.reason === 'capacity').map(row => row.kind),
    [...Array(DISCOVERY_RULES.maxReports).fill('report'), 'skill']);
  assert.ok(elapsed < 2000, `bounded planner took ${elapsed.toFixed(1)} ms`);
  assert.equal(applyProofRetention(npc, plan), true);
  assert.equal(npc.discovery.experiments.length, PROOF_RETENTION_BOUNDS.experiments);
  assert.equal(npc.memory.experience.length, NPC_RULES.maxExperience);
  for (const owner of [...acquisition, ...recentOrigins, ...latestHeld]) {
    assert.ok(npc.discovery.experiments.some(e => e.id === owner.id), `hard owner ${owner.id} retained`);
    assert.ok(npc.memory.experience.some(e => e.id === owner.actionId), `hard receipt ${owner.actionId} retained`);
  }
  assert.deepEqual({ effects: npc.discovery.effects, stomach: npc.physiology.stomach,
    feedback: npc.physiology.feedback, inventory: npc.inventory.items }, before);
  assert.equal(npc.rng, rng);
  const again = planProofRetention(npc);
  assert.equal(again.ok, true, again.reason);
  assert.equal(again.diagnostics.removedExperiments, 0);
  assert.equal(again.diagnostics.removedExperience, 0);
  assert.deepEqual(again.retirements, []);
});
