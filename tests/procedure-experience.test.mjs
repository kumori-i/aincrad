import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createProcedureExperience as view } from '../src/procedure-experience.js';

// Structural receipt fixtures, not survival outcomes or forged runtime learning.
function actor() { return { id: 'aster', epoch: 1, mode: 'discovery', elapsed: 1000,
  memory: { experience: [] }, discovery: { experiments: [], effects: [] } }; }
function action(n, primitive, targetId, at, extra = {}, duration = 2) {
  const id = n.memory.experience.length + 1;
  const result = { ok: true, code: 'OK', durationSeconds: duration,
    handling: { source: 'experienced', effort: 'rising', activeActionSeconds: duration }, ...extra };
  n.memory.experience.push({ id, at, type: 'action', details: { action: { type: primitive, targetId }, result } });
  const e = { id, actionId: id, at, primitive, targetId, ok: true, code: 'OK', ...extra };
  n.discovery.experiments.push(e); return e;
}
function effect(n, s, kind = 'sustained', at = 60, recognizedAt = 65) {
  const e = { id: `effect:${n.discovery.effects.length + 1}`, actionId: s.actionId,
    objectId: s.targetId, ingestionId: s.ingestionId, at, effect: kind, source: 'experienced',
    hunger: kind === 'sustained' ? 'easing' : 'unchanged', energy: kind === 'sustained' ? 'easing' : 'unchanged',
    thirst: kind === 'water relief' ? 'easing' : 'unchanged', pain: kind === 'discomfort' ? 'aching' : 'none' };
  const id = n.memory.experience.length + 1;
  n.memory.experience.push({ id, at: recognizedAt, type: 'condition', details: { code: 'DISCOVERY_EFFECT', feedback: { ...e } } });
  n.discovery.effects.push({ ...e, proofEventId: id });
}
function fixture(kind = 'sustained') {
  const n = actor(); action(n, 'pull', 'object:10', 10, { materialId: 'object:20' });
  const s = action(n, 'sample', 'object:20', 15, { ingestionId: 'ingestion:1' });
  if (kind) effect(n, s, kind); return n;
}
test('original timing, per-need outcomes, bounded lower costs and uncertainty remain separate', () => {
  const n = fixture(), before = structuredClone(n), v = view(n), e = v.episodes[0], s = e.samples[0];
  assert.equal(e.proofStatus, 'retained-direct-chain'); assert.equal(e.status, 'observed-relevant-relief');
  assert.equal(s.acquisitionToSampleSeconds, 5); assert.equal(s.observedEffects[0].sampleToEffectSeconds, 45);
  assert.equal(s.observedEffects[0].sampleToRecognitionSeconds, 50); assert.equal(s.observedEffects[0].recognizedAt, 65);
  assert.equal(e.observedNeeds.thirst[0].observation, 'unchanged');
  assert.equal(e.observedCost.observedActionDurationLowerBoundSeconds, 4);
  assert.equal(e.observedCost.observedHandlingDurationLowerBoundSeconds, 4);
  assert.equal(e.remainingCost, 'unknown'); assert.equal(e.futureAdequacy, 'unknown'); assert.equal(e.completion, 'unknown');
  assert.equal(e.admissionContext, 'unknown'); assert.deepEqual(n, before); assert.ok(Object.isFrozen(s.observedEffects[0]));
});
test('water is not hunger or energy relief, and timeout is not failure', () => {
  const n = fixture('water relief'); assert.equal(view(n).episodes[0].status, 'observed-other-effect');
  assert.equal(view(n).episodes[0].observedNeeds.hunger[0].observation, 'unchanged');
  n.discovery.effects = []; n.elapsed = 1e9; n.discovery.samplesPending = {};
  assert.equal(view(n).episodes[0].samples[0].status, 'unresolved');
  assert.equal(view(n).episodes[0].completion, 'unknown');
});
test('later adverse original recognition stays visible alongside prior relief', () => {
  const n = fixture(); effect(n, n.discovery.experiments[1], 'discomfort', 80, 85);
  assert.equal(view(n).episodes[0].status, 'observed-adverse');
  assert.deepEqual(view(n).episodes[0].samples[0].observedEffects.map(e => e.effect), ['sustained', 'discomfort']);
});
test('reacquisition is its own episode, not an earlier producer attribution', () => {
  const n = fixture(null); action(n, 'release', 'object:20', 20); action(n, 'grasp', 'object:20', 25);
  const s = action(n, 'sample', 'object:20', 30, { ingestionId: 'ingestion:2' }); effect(n, s);
  const es = view(n).episodes;
  assert.equal(es[0].samples.length, 1); assert.equal(es[1].acquisition.type, 'grasp');
  assert.equal(es[1].acquisition.targetId, 'object:20'); assert.equal(es[1].samples[0].actionId, s.actionId);
});
test('retired acquisition or continuity leaves exact item evidence, not restored ancestry', () => {
  const n = fixture(); n.memory.experience.shift(); n.discovery.experiments.shift();
  const e = view(n).episodes[0]; assert.equal(e.acquisition, null); assert.equal(e.proofStatus, 'exact-item-only');
  assert.equal(e.samples[0].acquisitionToSampleSeconds, null); assert.equal(e.status, 'observed-relevant-relief');
  n.discovery.experiments = []; assert.deepEqual(view(n).episodes, []);
});
test('missing intervening event invalidates direct chain without erasing exact effects', () => {
  const n = actor(); action(n, 'pull', 'object:10', 10, { materialId: 'object:20' });
  action(n, 'inspect_object', 'object:99', 12); const s = action(n, 'sample', 'object:20', 15, { ingestionId: 'ingestion:1' });
  effect(n, s); n.memory.experience.splice(1, 1);
  assert.equal(view(n).episodes[1].proofStatus, 'exact-item-only');
});
test('duplicate and misbound receipts cannot establish effect ownership', () => {
  const cases = [n => n.memory.experience.push(structuredClone(n.memory.experience[2])),
    n => n.discovery.effects.push(structuredClone(n.discovery.effects[0])),
    n => n.discovery.experiments.push(structuredClone(n.discovery.experiments[1])),
    n => { n.discovery.effects[0].objectId = 'object:999'; },
    n => { n.memory.experience[2].details.feedback.hunger = 'unchanged'; },
    n => { n.discovery.effects[0].proofEventId = 1; },
    n => { n.discovery.experiments[1].ingestionId = 'ingestion:99'; },
    n => { n.discovery.experiments[1].materialId = null; }];
  for (const mutate of cases) { const n = fixture(); mutate(n); const v = view(n);
    assert.ok(v.episodes.every(e => e.status !== 'observed-relevant-relief')); assert.equal(v.evidenceGaps.unverifiedEffects, n.discovery.effects.length); }
});
test('future knowledge and donor-only histories are excluded', () => {
  const a = fixture(), b = actor(); b.id = 'mira'; b.discovery.effects = structuredClone(a.discovery.effects);
  assert.deepEqual(view(b).episodes, []); assert.equal(view(b).evidenceGaps.unverifiedEffects, 1);
  a.elapsed = 64; assert.equal(view(a).episodes[0].status, 'unresolved');
  a.elapsed = 14; assert.equal(view(a).episodes[0].samples.length, 0);
});
test('oversized inputs fail before row inspection; hidden fields are not read', () => {
  const n = fixture(); Object.defineProperty(n, 'physiology', { get() { throw new Error('hidden'); } });
  Object.defineProperty(n.discovery, 'techniques', { get() { throw new Error('policy'); } });
  assert.equal(view(n).status, 'assessed');
  n.discovery.effects = new Array(65); Object.defineProperty(n.discovery.effects, 0, { get() { throw new Error('row'); } });
  assert.equal(view(n).reason, 'input-bounds');
});
test('unknown/invalid durations do not invent burden; no effect of call on serialization', () => {
  const n = fixture(); delete n.memory.experience[0].details.result.handling;
  n.memory.experience[0].details.result.durationSeconds = 10000;
  const before = JSON.stringify(n), v = view(n);
  assert.equal(v.episodes[0].observedCost.observedActionDurationLowerBoundSeconds, 2);
  assert.equal(v.episodes[0].observedCost.observedHandlingDurationLowerBoundSeconds, 2);
  assert.equal(JSON.stringify(n), before);
});
test('no runtime entrypoint consumes this descriptive view', async () => {
  for (const f of await readdir(new URL('../src/', import.meta.url))) {
    if (!f.endsWith('.js') || f.startsWith('procedure-')) continue;
    const text = await readFile(new URL(`../src/${f}`, import.meta.url), 'utf8');
    assert.equal(/procedure-experience|procedure-receipts|createProcedureExperience/.test(text), false, f);
  }
});

test('fresh physical receipts produce the same next decision with or without projection', async () => {
  const { createNpc } = await import('../src/npc-state.js');
  const { createEnvironment, tickEnvironment } = await import('../src/environment.js');
  const { requestNpcAction, tickNpc, observeNpc } = await import('../src/npc.js');
  const { discoveryDecision, processDiscoveryFeedback } = await import('../src/discovery.js');
  const { canStand } = await import('../src/world.js');
  const { lineOfSight } = await import('../src/perception.js');
  const n = createNpc({ mode: 'discovery', seed: 74193 }), env = createEnvironment(74193, { mode: 'discovery' });
  // Species is fixture setup only, never passed to the descriptive reducer.
  const plant = env.ecology.plants.find(p => p.kind === 'apple_tree');
  n.position = [[45, 0], [-45, 0], [0, 45], [0, -45]].map(([x, y]) => ({ x: plant.position.x + x, y: plant.position.y + y }))
    .find(p => canStand(p.x, p.y, 'valley') && lineOfSight(p, plant.position));
  assert.ok(n.position); observeNpc(n, env);
  const tick = () => { tickEnvironment(env, .1); tickNpc(n, .1, env); processDiscoveryFeedback(n); };
  const finish = (type, targetId) => {
    assert.equal(requestNpcAction(n, { type, targetId }, env).code, 'ACTION_STARTED');
    for (let i = 0; n.active && i < 200; i++) tick();
    assert.equal(n.active, null); assert.equal(n.lastResult.ok, true);
  };
  finish('pull', plant.id); finish('sample', n.inventory.items[0]);
  for (let i = 0; !n.discovery.effects.length && i < 900; i++) tick();
  assert.ok(n.discovery.effects.length);
  const before = JSON.stringify(n), v = view(n);
  assert.equal(v.status, 'assessed'); assert.equal(v.episodes[0].proofStatus, 'retained-direct-chain');
  assert.equal(v.episodes[0].samples[0].observedEffects[0].recognitionId, n.discovery.effects[0].proofEventId);
  assert.equal(JSON.stringify(n), before);
  const untouched = structuredClone(n), inspected = structuredClone(n); view(inspected);
  assert.deepEqual(discoveryDecision(inspected, env), discoveryDecision(untouched, env));
  assert.deepEqual(inspected, untouched);
});

test('maximum supported ledger stays bounded and detached', () => {
  const n = actor();
  for (let i = 0; i < 80; i++) {
    action(n, 'grasp', `object:${i + 1}`, i * 3);
    const s = action(n, 'sample', `object:${i + 1}`, i * 3 + 1, { ingestionId: `ingestion:${i + 1}` });
    if (i < 64) effect(n, s, 'water relief', i * 3 + 2, i * 3 + 2);
  }
  const v = view(n); assert.equal(v.episodes.length, 80);
  assert.equal(v.episodes.reduce((sum, e) => sum + e.samples.length, 0), 80);
  assert.equal(v.episodes.flatMap(e => e.samples.flatMap(s => s.observedEffects)).length, 64);
  n.discovery.effects[0].thirst = 'unchanged'; assert.equal(v.episodes[0].observedNeeds.thirst[0].observation, 'easing');
});


test('contradictory grasp material cannot establish direct ancestry', () => {
  const n = actor(); action(n, 'grasp', 'object:20', 10, { materialId: 'object:999' });
  const s = action(n, 'sample', 'object:20', 15, { ingestionId: 'ingestion:1' }); effect(n, s);
  const v = view(n); assert.equal(v.evidenceGaps.rejectedExperiments, 1);
  assert.equal(v.episodes.length, 1); assert.equal(v.episodes[0].acquisition, null);
  assert.equal(v.episodes[0].proofStatus, 'exact-item-only');
});
