import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpc } from '../src/npc-state.js';
import { observationalExperiment, observationalInquiries } from '../src/observational-learning.js';
import { validInquiries } from '../src/observational-inquiry-state.js';

// Small synthetic ledgers exercise projection/selection/validation contracts.
// These are not physical-ingestion or autonomous-learning evidence; those use
// the real actions and delayed feedback in observational-learning.test.mjs.
function inquiry(sourceId, at, attempts = []) {
  return { sourceId, actorId: 'mira', at, actorPosition: { x: 0, y: 0 },
    sourcePosition: { x: 0, y: 0 }, attempts, retired: false };
}
function fixture() {
  const npc = createNpc({ id: 'aster', mode: 'discovery' });
  npc.elapsed = 400;
  npc.inventory.items = ['object:22'];
  npc.discovery.inquiries = [inquiry('object:11', 0, [1, 2]), inquiry('object:22', 399, [3])];
  npc.discovery.experiments = [
    { id: 1, at: 1, primitive: 'grasp', targetId: 'object:11', ok: true },
    { id: 2, at: 2, primitive: 'sample', targetId: 'object:11', ok: true,
      ingestionId: 'ingestion:1', actionId: 2 },
    { id: 3, at: 399, primitive: 'grasp', targetId: 'object:22', ok: true },
  ];
  const gates = { body: { digestion: 'empty', stamina: 'steady', energy: 'steady', pain: 'none' },
    eligible: () => true, blocked: () => false, currentlySeen: () => true };
  return { npc, gates };
}

test('expired unresolved feedback cannot starve a later acquired inquiry trial', () => {
  const { npc, gates } = fixture();
  assert.equal(observationalInquiries(npc)[0].status, 'waiting');
  assert.deepEqual(observationalExperiment(npc, gates), { type: 'sample', targetId: 'object:22' });
  assert.equal(npc.discovery.effects.length, 0, 'selection cannot create bodily proof');
});

test('own revised source dominates a later uncertain consumption cue', () => {
  const { npc, gates } = fixture();
  npc.discovery.techniques = [{ sourceId: 'object:22', confidence: 'revised' }];
  const q = observationalInquiries(npc)[1];
  assert.equal(q.status, 'uncertain');
  assert.equal(q.priorAdverse, true);
  assert.equal(observationalExperiment(npc, gates), null);
});

test('old unattempted inquiry expires without inventing a negative bodily finding', () => {
  const { npc, gates } = fixture();
  npc.discovery.inquiries = [inquiry('object:33', 0)];
  const before = structuredClone(npc.discovery);
  const q = observationalInquiries(npc)[0];
  assert.equal(q.status, 'expired');
  assert.deepEqual(q.ownEffects, []);
  assert.match(q.deferredReason, /too old/);
  assert.equal(observationalExperiment(npc, gates), null);
  assert.deepEqual(npc.discovery, before, 'projection and rejection are read-only');
});

test('inquiry validator rejects a sample link without its own prior matching acquisition', () => {
  const { npc } = fixture();
  npc.discovery.inquiries = [inquiry('object:11', 0, [2])];
  assert.equal(validInquiries(npc.discovery.inquiries, npc.discovery, npc.elapsed, npc.id), false);
  npc.discovery.inquiries[0].attempts = [1, 2];
  assert.equal(validInquiries(npc.discovery.inquiries, npc.discovery, npc.elapsed, npc.id), true);
});

test('inquiry validator rejects reversed chronology and wrong-source sample links', () => {
  const { npc } = fixture();
  npc.discovery.inquiries = [inquiry('object:11', 0, [2, 1])];
  assert.equal(validInquiries(npc.discovery.inquiries, npc.discovery, npc.elapsed, npc.id), false);
  npc.discovery.experiments.push({ id: 4, at: 400, primitive: 'sample',
    targetId: 'object:11', ok: true, actionId: 4, ingestionId: 'ingestion:2' });
  npc.discovery.inquiries = [inquiry('object:22', 399, [3, 4])];
  assert.equal(validInquiries(npc.discovery.inquiries, npc.discovery, npc.elapsed, npc.id), false);
});

test('model inquiry bridge rejects nested payloads hidden inside scalar evidence fields', async () => {
  const { createRequire } = await import('node:module');
  const { decisionObservation } = await import('../src/controller.js');
  const { validateObservation } = createRequire(import.meta.url)('../desktop/model-provider.cjs');
  const npc = createNpc({ id: 'aster', mode: 'discovery' });
  const raw = decisionObservation(npc);
  const attempt = { id: 1, at: 0, primitive: 'grasp', targetId: 'object:22',
    ok: true, code: 'object_grasped', durationSeconds: 1, actionId: 1 };
  const effect = { id: 'feedback:1', at: 0, objectId: 'object:22', actionId: 1,
    ingestionId: 'ingestion:1', effect: 'sustained', hunger: 'easing', thirst: 'unchanged',
    energy: 'unchanged', pain: 'none', source: 'experienced', proofEventId: 2 };
  raw.discovery.inquiries = [{ ...inquiry('object:22', 0, [1]),
    deferredReason: null, question: 'Could a small sample from this exact source ease my hunger?',
    status: 'uncertain', provenance: 'witnessed consumption', priorAdverse: false,
    ownAttempts: [attempt], ownEffects: [effect] }];
  assert.doesNotThrow(() => validateObservation(raw));
  for (const field of ['id', 'at', 'durationSeconds', 'actionId', 'materialId', 'resultObjectId', 'ingestionId']) {
    const bad = structuredClone(raw);
    bad.discovery.inquiries[0].ownAttempts[0][field] = { arbitrary: { nested: 'payload' } };
    assert.throws(() => validateObservation(bad), undefined, `attempt ${field} must be scalar`);
  }
  for (const field of ['id', 'at', 'actionId', 'ingestionId', 'hunger', 'thirst', 'energy', 'pain', 'proofEventId']) {
    const bad = structuredClone(raw);
    bad.discovery.inquiries[0].ownEffects[0][field] = { arbitrary: { nested: 'payload' } };
    assert.throws(() => validateObservation(bad), undefined, `effect ${field} must be scalar`);
  }
});
