/** Deterministic synthetic/public-data tests only. No world, seed-74193 assay,
 * biological advancement, action submission or resource benchmark is executed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createNpc } from '../src/npc-state.js';
import { discoveryDecision } from '../src/discovery.js';
import { bodySignals, sensedEnvironment } from '../src/interoception.js';
import { createTemporalLedger } from '../src/temporal-ledger.js';
import { temporalContext } from '../src/temporal-returns.js';
import { createReusableOutcomeSensor, reusableMaterialSupport, reusableCandidateFeatures } from '../scripts/lib/reusable-outcome-sensor.mjs';
import { createReusableOutcomeModel, updatePhysicalReceipt, updatePhysicalInterval, updateExposure } from '../scripts/lib/reusable-outcome-model.mjs';
import { VALIDATION_PROJECTIONS, captureValidationProjectionInput, projectValidationPublicRoot,
  buildValidationProjectionBatch, evaluateValidationProjectionBatch, predictValidationPublicSnapshot } from '../scripts/lib/reusable-validation-projections.mjs';

const copy = structuredClone;
const shape = { shape: 'round', color: 'red', texture: 'smooth', motion: 'still', size: 'small', smell: 'sweet' };
const targetId = 'object:17', unrelatedTargetId = 'object:18';
const flags = n => ({ F: Boolean(n & 1), W: Boolean(n & 2), H: Boolean(n & 4) });
const emptySupport = { ...flags(0), applicable: false, unknown: true, firsthand: { F: 0, W: 0, H: 0 }, generation: null };
const draws = [.5, .5, .5, .5];
const bindingCensus = { complete: true, scope: 'all-retained-physical-and-evidence-bindings',
  objectIds: [targetId, unrelatedTargetId], sourceHashes: ['a'.repeat(64)] };

function dataFixture({ pendingAt = null, harm = false } = {}) {
  const view = { at: 60, scene: 'valley', position: { x: 10, y: 20 }, reach: 80, capacity: 4, held: [targetId],
    body: { hunger: 'content', thirst: 'quenched', energy: 'steady', stamina: 'easy breathing',
      fatigue: 'fresh', pain: 'none', digestion: 'empty', thermal: 'comfortable', sleepiness: 'alert' },
    senses: { warmth: 'comfortable', shelter: 'open air' },
    objects: [targetId, unrelatedTargetId].map((id, i) => ({ id, scene: 'valley', position: { x: 10 + i, y: 20 },
      appearance: copy(shape), count: 2, observedAt: 60 })) };
  const proof = { eventId: 1, sourceSeq: 1, at: 57, ingestionId: 'ingestion:1' };
  const memory = { nextSeq: 2, creditBlocked: false, historyCensored: false, model: { historyCensored: false },
    receipts: [{ seq: 1, at: 10, completedAt: 12, request: { type: 'sample', targetId },
      outcome: { ok: true, code: 'SWALLOWED', actionId: 1, ingestionId: 'ingestion:1', workedSeconds: 2, durationSeconds: 2 } }],
    ingestions: [{ id: 'ingestion:1', objectId: targetId, seq: 1, actionId: 1, at: 12, channels: 1,
      creditBlocked: false, channelProof: [copy(proof), null, null] }] };
  const sensor = { materials: view.objects.map(o => ({ objectId: o.id, appearance: copy(shape), generation: 0, known: true, lastSeenAt: 60 })),
    exposures: [{ id: 'ingestion:1', objectId: targetId, seq: 1, actionId: 1, at: 12,
      appearance: copy(shape), generation: 0, stateProved: true, body: { digestion: 'empty' },
      admitted: 1, censored: 0, channelProof: [copy(proof), null, null] }] };
  const discovery = { observations: Object.fromEntries(view.objects.map(o => [o.id, copy(o)])),
    experiments: [{ id: 1, at: 12, primitive: 'sample', targetId, ok: true, code: 'SWALLOWED', actionId: 1, ingestionId: 'ingestion:1' }],
    trials: { [`${targetId}|sample`]: { attempts: 1, failures: 0, lastAt: 12, lastOk: true, lastCode: 'SWALLOWED' } },
    effects: [{ objectId: targetId, effect: harm ? 'discomfort' : 'sustained', at: 57, ingestionId: 'ingestion:1', actionId: 1 }],
    samplesPending: pendingAt === null ? {} : { [targetId]: pendingAt }, reports: [] };
  const actions = [
    ...['inspect_object', 'release', ...(!harm && (pendingAt === null || view.at - pendingAt >= 45) ? ['sample'] : []), 'strike'].map(type => ({ type, targetId })),
    ...['inspect_object', 'grasp', 'pull', 'strike'].map(type => ({ type, targetId: unrelatedTargetId })),
    { type: 'wait', seconds: 5 },
  ];
  const selector = { rng: 17, choices: 1, focus: { objectId: targetId, startedAt: 55, used: 1 } };
  const candidates = actions.map((action, index) => {
    const support = action.targetId ? reusableMaterialSupport(sensor, { memory, view, objectId: action.targetId }) : copy(emptySupport);
    return { index, action, score: index / 16, context: temporalContext({ body: view.body }),
      features: reusableCandidateFeatures(sensor, { memory, view, action }), eligibility: true, bindingsValid: true,
      exactSupport: { F: support.F, W: support.W, H: support.H }, support, focus: action.targetId === targetId };
  });
  const snapshot = { at: 60, epoch: 0, nextSeq: 2, ready: true, ordinary: true, need: 'understanding', reason: '', view,
    selector, previewSelector: copy(selector), draws: copy(draws),
    opportunity: { at: 60, epoch: 0, rngBefore: 17, rngAfter: 19, choices: candidates.map(({ action, score }) => ({ action: copy(action), score })) },
    candidates, exposures: sensor.exposures.map(e => ({ appearance: copy(e.appearance), digestion: e.body.digestion,
      ageSeconds: 60 - e.at, reported: flags(e.admitted), censored: flags(e.censored), exactSupport: flags(e.admitted) })) };
  const args = { snapshot, discovery, memory, sensor, retainedBindings: copy(bindingCensus) };
  return { ...args, input: captureValidationProjectionInput(args) };
}

function trainedModel(fixture) {
  const model = createReusableOutcomeModel();
  for (const [index, c] of fixture.snapshot.candidates.entries()) {
    updatePhysicalReceipt(model, { sequence: index + 1, at: index + 1, features: c.features,
      completion: 'success', effects: { exposure: c.action.type === 'sample', released: c.action.type === 'release' }, durationSeconds: 2 });
    updatePhysicalInterval(model, { sequence: index + 1, at: index + 1, features: c.features, T: .1, E: .05 });
  }
  updateExposure(model, { sequence: 1, at: 10, appearance: shape, digestion: 'empty', ingestions: 1, increments: [] });
  updateExposure(model, { sequence: 2, at: 40, appearance: shape, digestion: 'empty', ingestions: 0,
    increments: ['F', 'W', 'H'].map(channel => ({ channel, bin: 0, riskSeconds: 30, events: Number(channel === 'F'), censored: 0 })) });
  return model;
}

const row = (result, kind, value) => result.conditions.find(r => r.condition.kind === kind && r.condition.value === value);
const candidate = (result, type, id = targetId) => result.snapshot.candidates.find(c => c.action.type === type && c.action.targetId === id);

test('unchanged synthetic root/order/masks/features/support are retained byte-for-byte and deeply immutable', () => {
  const f = dataFixture(), before = JSON.stringify(f), result = projectValidationPublicRoot(f.input);
  assert.equal(result.status, 'available', JSON.stringify(result.reasons));
  assert.deepEqual(result.snapshot, f.snapshot);
  assert.equal(result.parity.passed, true); assert.equal(result.physicalAuthority, false);
  assert.equal(JSON.stringify(f), before);
  assert.throws(() => { result.snapshot.candidates[0].score = 999; }, TypeError);
  const broken = copy(f.input); broken.native.candidates.reverse();
  assert.equal(projectValidationPublicRoot(broken).status, 'unavailable');
});

test('source-native discoveryDecision parity on a default-body non-assay synthetic actor, with no tick or submission', () => {
  const actor = createNpc({ mode: 'discovery', seed: 17 });
  actor.inventory.items = [targetId];
  actor.discovery.observations[targetId] = { id: targetId, scene: actor.scene,
    position: copy(actor.position), appearance: copy(shape), observedAt: 0, count: 2 };
  const memory = createTemporalLedger(), sensor = createReusableOutcomeSensor(), before = copy(actor);
  const native = discoveryDecision(copy(actor), { foodLearning: false, ordinaryProposal: true });
  assert.ok(native.ordinary);
  const view = { at: 0, scene: actor.scene, position: copy(actor.position), reach: 80, capacity: 4,
    held: [targetId], body: bodySignals(actor), senses: sensedEnvironment(actor), objects: Object.values(actor.discovery.observations) };
  const selector = { rng: 11, choices: 0, focus: null };
  const snapshot = { at: 0, epoch: 0, nextSeq: 1, ready: true, ordinary: true, view, opportunity: native.ordinary,
    selector, previewSelector: copy(selector), draws, exposures: [],
    candidates: native.ordinary.choices.map((c, index) => ({ ...copy(c), index, context: temporalContext(),
      features: reusableCandidateFeatures(sensor, { memory, view, action: c.action }), eligibility: true,
      bindingsValid: true, exactSupport: flags(0), support: c.action.targetId ? reusableMaterialSupport(sensor,
        { memory, view, objectId: targetId }) : copy(emptySupport), focus: false })) };
  const input = captureValidationProjectionInput({ snapshot, discovery: actor.discovery, memory, sensor, retainedBindings: bindingCensus });
  const result = projectValidationPublicRoot(input);
  assert.equal(result.status, 'available', JSON.stringify(result.reasons));
  assert.deepEqual(result.snapshot.candidates, snapshot.candidates);
  assert.deepEqual(result.snapshot.opportunity, native.ordinary);
  assert.deepEqual(actor, before);
});

test('exact eight pairs plus eight reserved query identities and 48 model projections; H conflict stays pending', () => {
  const f = dataFixture(), model = trainedModel(f), original = JSON.stringify({ input: f.input, model });
  const result = evaluateValidationProjectionBatch({ input: f.input, onlineModel: model, frozenModel: copy(model), targetId });
  assert.equal(result.status, 'available', JSON.stringify(result.conditions.filter(r => r.status !== 'available')));
  assert.equal(result.conditions.length, 24); assert.equal(result.evaluations, 48);
  assert.equal(result.assessment.status, 'passed', JSON.stringify(result.assessment));
  assert.equal(result.assessment.physicalConflictStatus, 'pending');
  assert.deepEqual([...new Set(result.conditions.slice(0, 16).map(r => r.condition.kind))], VALIDATION_PROJECTIONS.pairs);
  assert.deepEqual(result.conditions.slice(16).map(r => r.queryTargetId), VALIDATION_PROJECTIONS.freshIds);
  assert.equal(result.harmConflict.status, 'pending'); assert.equal(result.physicalObservations, 0);
  assert.equal(result.biologicalQualityWeight, 0); assert.equal(result.physicalQualityWeight, 0);
  assert.equal(result.invariance.unchanged, true); assert.deepEqual(result.invariance.before, result.invariance.after);
  assert.equal(JSON.stringify({ input: f.input, model }), original);
  assert.deepEqual(result.schema.changedAppearance, { ...shape, smell: 'sour' });
  assert.equal(result.schema.changedGeneration, 1); assert.equal(result.schema.unrelatedTargetId, unrelatedTargetId);
});

test('held/reach and free/full capacity change only declared relations and preserve all ordered native route provenance', () => {
  const f = dataFixture(), batch = buildValidationProjectionBatch(f.input, { targetId });
  const held = row(batch, 'held-reach', 'held'), reach = row(batch, 'held-reach', 'reach');
  assert.ok(candidate(held, 'sample')); assert.ok(candidate(held, 'release')); assert.equal(candidate(held, 'grasp'), undefined);
  assert.ok(candidate(reach, 'grasp')); assert.equal(candidate(reach, 'sample'), undefined); assert.equal(candidate(reach, 'release'), undefined);
  assert.equal(candidate(reach, 'grasp').score, null); assert.equal(candidate(reach, 'grasp').nativeScoreProvenance, null);
  const free = row(batch, 'capacity', 1), full = row(batch, 'capacity', 0);
  assert.ok(candidate(free, 'grasp', unrelatedTargetId)); assert.equal(candidate(full, 'grasp', unrelatedTargetId), undefined);
  assert.equal(candidate(free, 'sample').features.freeSlotBand, '1'); assert.equal(candidate(full, 'sample').features.freeSlotBand, '0');
  assert.deepEqual(full.snapshot.view.held, f.snapshot.view.held);
  assert.equal(full.snapshot.projectedInventory.unspecifiedOccupiedSlots, 3);
  assert.deepEqual(full.provenance, f.input.provenance);
});

test('no-sample removes associated support/history without rewriting parameters; pending map changes do not transfer proof', () => {
  const f = dataFixture(), batch = buildValidationProjectionBatch(f.input, { targetId });
  const none = row(batch, 'sample-history', 'none'), kept = row(batch, 'sample-history', 'retained');
  assert.deepEqual(candidate(none, 'sample').exactSupport, flags(0)); assert.equal(none.snapshot.exposures.length, 0);
  assert.equal(kept.snapshot.exposures.length, 1); assert.equal(candidate(kept, 'sample').exactSupport.F, true);
  const own = row(batch, 'pending-binding', 'own'), other = row(batch, 'pending-binding', 'other');
  assert.equal(own.publicFacts.projectedPending.at, 12); assert.equal(other.publicFacts.projectedPending.at, 12);
  assert.equal(own.publicFacts.projectedPending.sourceIngestionId, 'ingestion:1');
  assert.equal(other.publicFacts.projectedPending.objectId, unrelatedTargetId);
  assert.deepEqual(other.publicFacts.memory.ingestions, f.memory.ingestions);
  assert.deepEqual(other.publicFacts.support, own.publicFacts.support);
  assert.ok(candidate(own, 'sample'), 'elapsed 48 seconds is not retimed to fabricate a pending mask');
});

test('changed appearance/generation invalidates exact support and relevant work leaves other operations unchanged', () => {
  const batch = buildValidationProjectionBatch(dataFixture().input, { targetId });
  const retained = row(batch, 'appearance-generation', 'retained'), changed = row(batch, 'appearance-generation', 'changed');
  assert.equal(candidate(retained, 'sample').exactSupport.F, true);
  assert.deepEqual(candidate(changed, 'sample').exactSupport, flags(0));
  assert.equal(candidate(changed, 'sample').features.appearance.smell, 'sour');
  assert.equal(candidate(changed, 'sample').support.generation, 1);
  assert.deepEqual(changed.publicFacts.memory.ingestions, retained.publicFacts.memory.ingestions);
  const zero = row(batch, 'operation-work', '0'), one = row(batch, 'operation-work', '1');
  assert.equal(candidate(zero, 'inspect_object').features.workBand, '0'); assert.equal(candidate(one, 'inspect_object').features.workBand, '1');
  assert.deepEqual(candidate(zero, 'sample').features, candidate(one, 'sample').features);
  assert.deepEqual(zero.publicFacts.memory.receipts, one.publicFacts.memory.receipts);
});

test('hunger weights change utility by exactly used-D weighting while fullness removes sample opportunities', () => {
  const f = dataFixture(), model = trainedModel(f), result = evaluateValidationProjectionBatch({ input: f.input, onlineModel: model, frozenModel: model, targetId });
  const content = row(result, 'hunger', 'content'), hungry = row(result, 'hunger', 'hungry');
  const ci = content.snapshot.candidates.findIndex(c => c.action.type === 'sample'), hi = hungry.snapshot.candidates.findIndex(c => c.action.type === 'sample');
  const a = content.online.forecasts[ci], b = hungry.online.forecasts[hi];
  assert.equal(a.weights.F, .5); assert.equal(b.weights.F, 2); assert.deepEqual(a.D, b.D);
  assert.ok(Math.abs((b.utility - a.utility) - 1.5 * a.usedD.F) < 1e-12);
  assert.ok(candidate(row(result, 'digestion', 'empty'), 'sample'));
  assert.equal(candidate(row(result, 'digestion', 'full'), 'sample'), undefined);
  assert.equal(row(result, 'digestion', 'full').exposureQuery.digestion, 'full');
});

test('eight fresh identities preserve pooled points and public physical features, with no inherited proof, benefit exploitation or safety', () => {
  const f = dataFixture(), model = trainedModel(f), result = evaluateValidationProjectionBatch({ input: f.input, onlineModel: model, frozenModel: model, targetId });
  const rows = result.conditions.slice(16), base = candidate(row(result, 'sample-history', 'retained'), 'sample');
  for (const projected of rows) {
    const c = candidate(projected, 'sample', projected.queryTargetId), at = projected.snapshot.candidates.indexOf(c), forecast = projected.online.forecasts[at];
    assert.deepEqual(c.features, base.features);
    assert.deepEqual(c.exactSupport, flags(0)); assert.deepEqual(c.support.firsthand, { F: 0, W: 0, H: 0 });
    assert.equal(forecast.usedD.F, 0); assert.equal(forecast.usedD.W, 0); assert.equal(forecast.safe, false);
    for (const channel of ['F', 'W', 'H']) {
      assert.deepEqual(projected.online.exposure.channels[channel].epistemicRange, [0, 1]);
      assert.equal(projected.online.exposure.channels[channel].probability, rows[0].online.exposure.channels[channel].probability);
    }
    assert.deepEqual(projected.publicFacts.memory.receipts, f.memory.receipts);
    assert.deepEqual(projected.publicFacts.exposures, f.sensor.exposures);
  }
});

test('missing fields/census, collisions, parity differences, hidden care/route dependencies and configuration changes fail closed', () => {
  const f = dataFixture();
  assert.equal(captureValidationProjectionInput({ ...f, discovery: { ...f.discovery, trials: undefined } }).status, 'unavailable');
  const noCensus = captureValidationProjectionInput({ ...f, retainedBindings: undefined });
  const a = evaluateValidationProjectionBatch({ input: noCensus, onlineModel: createReusableOutcomeModel(), frozenModel: createReusableOutcomeModel(), targetId });
  assert.equal(a.status, 'unavailable'); assert.equal(a.conditions.length, 24); assert.equal(a.evaluations, 0);
  const collision = copy(f.input); collision.retainedBindings.objectIds.push('object:99000003');
  assert.equal(row(buildValidationProjectionBatch(collision, { targetId }), 'fresh-identity', 'object:99000003').status, 'unavailable');
  const wrong = copy(f.input); wrong.native.candidates[0].features.workBand = '1';
  assert.equal(projectValidationPublicRoot(wrong).status, 'unavailable');
  const badSupport = copy(f); badSupport.snapshot.candidates.at(-1).exactSupport.F = true;
  assert.equal(projectValidationPublicRoot(captureValidationProjectionInput(badSupport)).status, 'unavailable');
  assert.equal(buildValidationProjectionBatch(f.input, { targetId, changedAppearance: { ...shape, color: 'blue' } }).status, 'unavailable');
  const care = { ...f.snapshot, ordinary: false };
  assert.equal(captureValidationProjectionInput({ ...f, snapshot: care }).status, 'unavailable');
  const cave = copy(f.input); cave.facts.view.scene = cave.native.view.scene = 'cave:1';
  assert.equal(projectValidationPublicRoot(cave, { kind: 'hunger', value: 'hungry', targetId }).status, 'unavailable');
});

test('exact harm and global refusal remain authoritative public masks; old retained failure cannot override newer aggregate success', () => {
  const harmed = dataFixture({ harm: true });
  const result = projectValidationPublicRoot(harmed.input);
  assert.equal(result.status, 'available'); assert.equal(candidate(result, 'sample'), undefined);
  assert.ok(result.masks.find(m => m.action.type === 'sample' && m.action.targetId === targetId).reasons.includes('exact-harm'));
  const f = dataFixture({ pendingAt: 59 });
  assert.equal(projectValidationPublicRoot(f.input).status, 'available');
  assert.equal(candidate(projectValidationPublicRoot(f.input), 'sample'), undefined);
  const recent = copy(f);
  recent.discovery.experiments.push({ at: 50, primitive: 'inspect_object', targetId, ok: false });
  recent.discovery.trials[`${targetId}|inspect_object`] = { lastAt: 59, lastOk: true };
  assert.equal(projectValidationPublicRoot(captureValidationProjectionInput(recent)).status, 'available');
});

test('duplicate native routes retain distinct order, scores and binding provenance without new route queries', () => {
  const f = dataFixture(), wait = f.snapshot.candidates.pop(), action = { type: 'move', target: { x: 100, y: 100 } };
  for (const [i, bindingId] of [unrelatedTargetId, undefined].entries()) {
    const support = bindingId ? reusableMaterialSupport(f.sensor, { memory: f.memory, view: f.snapshot.view, objectId: bindingId }) : copy(emptySupport);
    f.snapshot.candidates.push({ index: f.snapshot.candidates.length, action: copy(action), ...(bindingId ? { bindingId } : {}),
      score: 2 + i, reason: `native route ${i}`, context: temporalContext(),
      features: reusableCandidateFeatures(f.sensor, { memory: f.memory, view: f.snapshot.view, action }),
      eligibility: true, bindingsValid: true, exactSupport: flags(0), support, focus: false });
  }
  wait.index = f.snapshot.candidates.length; f.snapshot.candidates.push(wait);
  f.snapshot.opportunity.choices = f.snapshot.candidates.map(({ action, score, reason, bindingId }) =>
    ({ action: copy(action), score, ...(reason ? { reason } : {}), ...(bindingId ? { bindingId } : {}) }));
  const input = captureValidationProjectionInput(f), unchanged = projectValidationPublicRoot(input);
  assert.equal(unchanged.status, 'available', JSON.stringify(unchanged.reasons));
  assert.deepEqual(unchanged.snapshot, f.snapshot);
  const projected = projectValidationPublicRoot(input, { kind: 'hunger', value: 'hungry', targetId });
  const routes = projected.snapshot.candidates.filter(c => c.action.type === 'move');
  assert.equal(routes.length, 2); assert.equal(routes[0].bindingId, unrelatedTargetId); assert.equal(routes[1].bindingId, undefined);
  assert.deepEqual(routes.map(c => c.nativeScoreProvenance.score), [2, 3]);
  assert.deepEqual(routes.map(c => c.reason), ['native route 0', 'native route 1']);
  assert.ok(routes.every(c => c.score === null));
  assert.deepEqual(projected.provenance.nativeRoutes, input.provenance.nativeRoutes);
});

test('missing baseline geometry remains unknown when a fresh query identity newly unmasks it', () => {
  const f = dataFixture();
  // Every unheld object primitive is independently masked. Native absence can
  // no longer prove whether the object was visible/in reach.
  for (const type of ['inspect_object', 'grasp', 'pull', 'strike']) {
    f.discovery.trials[`${unrelatedTargetId}|${type}`] = { lastAt: 59, lastOk: false, attempts: 1 };
  }
  f.snapshot.candidates = f.snapshot.candidates.filter(c => c.action.targetId !== unrelatedTargetId).map((c, index) => ({ ...c, index }));
  f.snapshot.opportunity.choices = f.snapshot.candidates.map(({ action, score }) => ({ action, score }));
  const captured = captureValidationProjectionInput(f);
  assert.equal(captured.geometry[unrelatedTargetId].eligible, null);
  assert.equal(projectValidationPublicRoot(captured).status, 'available');
  // Do not invent geometry or a native action when source provenance is absent.
  const projected = projectValidationPublicRoot(captured, { kind: 'fresh-identity', targetId: unrelatedTargetId, value: 'object:99000001' });
  assert.equal(projected.status, 'unavailable');
  assert.ok(projected.reasons.some(reason => reason.includes('unknown-native-geometry')));
});

test('adapter source has no native/physiology/geometry/execution imports; frozen protocol/design hashes stay pinned', async () => {
  const source = await readFile(new URL('../scripts/lib/reusable-validation-projections.mjs', import.meta.url), 'utf8');
  for (const denied of ['src/world.js', 'src/biology.js', 'src/interoception.js', 'src/discovery.js', 'reusable-prediction-fixture.mjs', 'Math.random(', 'lineOfSight(', 'Math.hypot(', '.step(', '.submit(']) assert.ok(!source.includes(denied), denied);
  for (const [file, expected] of [['PREREG-scripted-prediction-validation-v1.md', VALIDATION_PROJECTIONS.protocolSha256],
    ['DESIGN-reusable-outcome-prediction.md', '8ca160becf1a67f7e33986a4435c4d06cb5666e28570a776031dff676e77b0d6']]) {
    const data = await readFile(new URL(`../docs/${file}`, import.meta.url));
    assert.equal(createHash('sha256').update(data).digest('hex'), expected);
  }
});

test('direct paired prediction is pure and retains full native root even when outcome heads are unknown', () => {
  const f = dataFixture(), model = createReusableOutcomeModel(), before = copy(model);
  const answer = predictValidationPublicSnapshot(f.snapshot, model);
  assert.equal(answer.forecasts.length, f.snapshot.candidates.length); assert.deepEqual(model, before);
  assert.ok(answer.forecasts.every(forecast => forecast.scorable === false));
  assert.ok(answer.choice.exploring); assert.deepEqual(answer.choice.draws, draws);
});
