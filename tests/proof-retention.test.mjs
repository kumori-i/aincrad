import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freshState, canStand } from '../src/world.js';
import { CAVES, CONFIG, NPC_RULES } from '../src/config.js';
import { BIOLOGY_RULES } from '../src/biology-config.js';
import { DISCOVERY_RULES } from '../src/discovery-config.js';
import { requestNpcAction, tickNpc, observeNpc } from '../src/npc.js';
import { processDiscoveryFeedback, discoveryDecision } from '../src/discovery.js';
import { recordEvent } from '../src/npc-memory.js';
import { beginSleep, wakePhysiology, projectPhysiology } from '../src/biology.js';
import { loadSave, writeSave, saveProtectionReason, validateSave } from '../src/save.js';
import { PROOF_RETENTION_BOUNDS, planProofRetention, applyProofRetention, retainedEffectProofError } from '../src/proof-retention.js';

const archiveRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../handoff/recovered/evidence/extracted');
const archivedBaseline = resolve(archiveRoot, 'measured-v1/seed74193-baseline');

function fixture() {
  const state = freshState(), npc = state.agents[0], environment = state.environment;
  const plant = environment.ecology.plants.find(item => item.kind === 'apple_tree' && item.quantity > 0);
  assert.ok(plant);
  npc.position = [
    { x: plant.position.x + 45, y: plant.position.y },
    { x: plant.position.x - 45, y: plant.position.y },
    { x: plant.position.x, y: plant.position.y + 45 },
    { x: plant.position.x, y: plant.position.y - 45 },
  ].find(point => canStand(point.x, point.y, 'valley'));
  assert.ok(npc.position);
  observeNpc(npc, environment);
  assert.ok(npc.discovery.observations[plant.id]);
  return { state, npc, environment, plant };
}

function finish(npc, environment, action) {
  const started = requestNpcAction(npc, action, environment);
  if (started.code === 'ACTION_STARTED') {
    for (let i = 0; i < 1000 && npc.active; i++) tickNpc(npc, 1 / 60, environment);
  }
  assert.equal(npc.active, null);
  return npc.lastResult || started;
}

function sampleFixture(kind = 'ordinary') {
  const world = fixture();
  const { npc, environment, plant } = world;
  assert.equal(finish(npc, environment, { type: 'pull', targetId: plant.id }).ok, true);
  const id = npc.inventory.items[0], material = environment.ecology.materials.find(item => item.id === id);
  assert.ok(material);
  if (kind === 'water relief') {
    material.energyKcal = 0;
    npc.physiology.waterDeficitMl = 1000;
  } else if (kind === 'discomfort') {
    material.energyKcal = 0;
    material.waterMl = 0;
    material.toxicity = 1;
  } else if (kind === 'no noticeable change') {
    material.energyKcal = 0;
    material.waterMl = 0;
    material.toxicity = 0;
    material.digestHours = .05;
  } else {
    npc.physiology.hoursSinceMeal = 12;
  }
  assert.equal(finish(npc, environment, { type: 'sample', targetId: id }).ok, true);
  const sample = npc.discovery.experiments.findLast(row => row.primitive === 'sample' && row.targetId === id);
  assert.ok(sample);
  return { ...world, id, sample };
}

function awaitEffect(npc, environment, effect, maxSeconds = 120, process = true) {
  for (let i = 0; i < maxSeconds * 60; i++) {
    tickNpc(npc, 1 / 60, environment);
    if (process) processDiscoveryFeedback(npc);
    const found = npc.discovery.effects.find(row => row.effect === effect);
    if (found) return found;
  }
  assert.fail(`real ${effect} feedback did not arrive`);
}

function awaitFeedback(npc, environment, effect, maxSeconds = 120) {
  for (let i = 0; i < maxSeconds * 60; i++) {
    tickNpc(npc, 1 / 60, environment);
    const found = npc.physiology.feedback.find(row => row.effect === effect);
    if (found) return found;
  }
  assert.fail(`real ${effect} feedback did not arrive`);
}

function assertCompleteEffect(npc, effect) {
  const sample = npc.discovery.experiments.find(row => row.actionId === effect.actionId && row.ingestionId === effect.ingestionId);
  const action = npc.memory.experience.find(row => row.id === effect.actionId);
  const proof = npc.memory.experience.find(row => row.id === effect.proofEventId);
  assert.ok(sample, 'original sample experiment is retained');
  assert.equal(sample.primitive, 'sample');
  assert.equal(sample.ok, true);
  assert.equal(sample.targetId, effect.objectId);
  assert.equal(action?.details.action.targetId, effect.objectId);
  assert.equal(action?.details.result.ingestionId, effect.ingestionId);
  assert.equal(action?.at, sample.at);
  assert.equal(proof?.details.code, 'DISCOVERY_EFFECT');
  assert.equal(proof?.details.feedback.id, effect.id);
  assert.equal(proof?.details.feedback.at, effect.at);
  assert.equal(proof?.details.feedback.source, 'experienced');
  assert.equal(retainedEffectProofError(npc), null);
}

function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test('proof budget derives from current fixed caps and stages within both buffers', () => {
  assert.equal(PROOF_RETENTION_BOUNDS.pending, BIOLOGY_RULES.maxDigestiveInputs + BIOLOGY_RULES.maxFeedback);
  assert.equal(PROOF_RETENTION_BOUNDS.experiments, 157);
  assert.equal(PROOF_RETENTION_BOUNDS.experience, 320);
  assert.equal(PROOF_RETENTION_BOUNDS.stagedExperiments, 158);
  assert.equal(PROOF_RETENTION_BOUNDS.stagedExperience, 321);
  assert.equal(PROOF_RETENTION_BOUNDS.experience, NPC_RULES.maxExperience - 80);
  assert.equal(PROOF_RETENTION_BOUNDS.heldObservations, DISCOVERY_RULES.capacity);
  assert.equal(CAVES.length, 4);
});

for (const kind of ['water relief', 'sustained', 'discomfort', 'no noticeable change']) {
  test(`real sampled ${kind} keeps its exact action, ingestion and condition proof`, () => {
    const { npc, environment, sample } = sampleFixture(kind);
    const effect = awaitEffect(npc, environment, kind);
    assert.equal(effect.ingestionId, sample.ingestionId);
    assert.equal(effect.actionId, sample.actionId);
    assertCompleteEffect(npc, effect);
    processDiscoveryFeedback(npc);
    assert.equal(npc.discovery.effects.filter(row => row.id === effect.id).length, 1, 'duplicate delivery is inert');
  });
}

test('real water effect and its exact proof survive both capped logs and write/load', () => {
  const { state, npc, environment, plant } = sampleFixture('water relief');
  const effect = awaitEffect(npc, environment, 'water relief');
  const before = structuredClone(effect);
  for (let i = 0; i < 190; i++) assert.equal(finish(npc, environment, { type: 'inspect_object', targetId: plant.id }).ok, true);
  for (let i = 0; i < 500; i++) recordEvent(npc, 'decision', { summary: 'Unrelated bounded history.' });
  assert.equal(npc.discovery.experiments.length, DISCOVERY_RULES.maxExperiments);
  assert.equal(npc.memory.experience.length, NPC_RULES.maxExperience);
  assertCompleteEffect(npc, before);
  const disk = storage();
  assert.equal(writeSave(disk, state), true);
  const loaded = loadSave(disk);
  assert.equal(loaded.blocked, false);
  assert.deepEqual(loaded.state.agents[0].discovery.effects.find(row => row.id === before.id), before);
  assertCompleteEffect(loaded.state.agents[0], before);
});

test('save refuses uncommitted staged row and observation caps before validation can trim proof', () => {
  const { state, npc, environment, plant } = sampleFixture('water relief');
  const effect = awaitEffect(npc, environment, 'water relief');
  assertCompleteEffect(npc, effect);
  assert.equal(finish(npc, environment, { type: 'inspect_object', targetId: plant.id }).ok, true);
  const inspect = npc.discovery.experiments.at(-1);
  const receipt = npc.memory.experience.find(row => row.id === inspect.actionId);
  const base = structuredClone(state);
  const check = raw => {
    const disk = storage(), bytes = JSON.stringify(raw);
    disk.setItem(CONFIG.saveKey, bytes);
    assert.ok(saveProtectionReason(raw));
    assert.equal(loadSave(disk).blocked, true);
    assert.equal(writeSave(disk, raw), false);
    assert.equal(writeSave(disk, validateSave(raw)), false);
    assert.equal(disk.getItem(CONFIG.saveKey), bytes);
  };
  const stagedExperiments = structuredClone(base), a = stagedExperiments.agents[0];
  while (a.discovery.experiments.length <= DISCOVERY_RULES.maxExperiments) {
    const actionId = a.memory.nextId++, experimentId = a.discovery.nextId++;
    a.memory.experience.push({ ...receipt, id: actionId });
    a.discovery.experiments.push({ ...inspect, id: experimentId, actionId });
  }
  assert.equal(a.discovery.experiments.length, DISCOVERY_RULES.maxExperiments + 1);
  check(stagedExperiments);
  const stagedExperience = structuredClone(base), b = stagedExperience.agents[0];
  while (b.memory.experience.length <= NPC_RULES.maxExperience)
    b.memory.experience.push({ id: b.memory.nextId++, at: b.elapsed, type: 'decision', details: {} });
  assert.equal(b.memory.experience.length, NPC_RULES.maxExperience + 1);
  check(stagedExperience);
  const stagedObservations = structuredClone(base), c = stagedObservations.agents[0];
  for (let i = 0; Object.keys(c.discovery.observations).length <= DISCOVERY_RULES.maxObjects; i++) {
    const id = `object:${900000 + i}`;
    c.discovery.observations[id] = { id, scene: 'valley', position: { x: 0, y: 0 }, appearance: {}, observedAt: c.elapsed };
  }
  check(stagedObservations);
});

test('a historical orphan effect protects original save bytes on load and direct validation', () => {
  const { state, npc, environment } = sampleFixture('water relief');
  const effect = awaitEffect(npc, environment, 'water relief');
  npc.discovery.experiments = npc.discovery.experiments.filter(row => row.actionId !== effect.actionId);
  const bytes = JSON.stringify(state), disk = storage();
  disk.setItem(CONFIG.saveKey, bytes);
  const loaded = loadSave(disk);
  assert.equal(loaded.blocked, true);
  assert.match(loaded.error, /original save has been preserved/i);
  assert.equal(loaded.state.saveBlocked, true);
  assert.equal(writeSave(disk, loaded.state), false);
  assert.equal(disk.getItem(CONFIG.saveKey), bytes);
  const direct = validateSave(state);
  assert.equal(direct.saveBlocked, true);
  assert.equal(writeSave(disk, direct), false);
  assert.equal(disk.getItem(CONFIG.saveKey), bytes);
});

test('orphaned sampled stomach or unseen feedback protects exact historical bytes', () => {
  for (const stage of ['stomach', 'unseen feedback']) {
    const { state, npc, environment, sample } = sampleFixture('water relief');
    if (stage === 'unseen feedback') {
      awaitFeedback(npc, environment, 'water relief');
      for (let i = 0; i < 1600 && npc.physiology.stomach.length; i++) tickNpc(npc, .25, environment);
      assert.equal(npc.physiology.stomach.length, 0);
      assert.ok(npc.physiology.feedback.some(row => row.ingestionId === sample.ingestionId));
    } else assert.ok(npc.physiology.stomach.some(row => row.id === sample.ingestionId));
    npc.memory.experience = npc.memory.experience.filter(row => row.id !== sample.actionId);
    assert.match(saveProtectionReason(state), /incomplete or depends on an older feedback queue/i);
    const bytes = JSON.stringify(state), disk = storage();
    disk.setItem(CONFIG.saveKey, bytes);
    assert.equal(loadSave(disk).blocked, true);
    assert.equal(writeSave(disk, state), false);
    assert.equal(disk.getItem(CONFIG.saveKey), bytes);
  }
});

test('a held item with missing original acquisition or sensory identity protects save bytes', () => {
  for (const missing of ['acquisition', 'observation']) {
    const { state, npc, environment, plant } = fixture();
    assert.equal(finish(npc, environment, { type: 'pull', targetId: plant.id }).ok, true);
    const id = npc.inventory.items[0];
    assert.ok(npc.discovery.observations[id]);
    if (missing === 'acquisition') npc.discovery.experiments = npc.discovery.experiments.filter(row => row.materialId !== id);
    else delete npc.discovery.observations[id];
    const bytes = JSON.stringify(state), disk = storage();
    disk.setItem(CONFIG.saveKey, bytes);
    assert.equal(loadSave(disk).blocked, true);
    assert.equal(writeSave(disk, state), false);
    assert.equal(disk.getItem(CONFIG.saveKey), bytes);
  }
});

test('feedback callback reentry and failure never replay a physical sample or invent an effect', () => {
  const { npc, environment, sample } = sampleFixture('water relief');
  const emitted = awaitFeedback(npc, environment, 'water relief');
  const originalInput = npc.physiology.totals.ingestedWaterMl;
  const originalActions = npc.memory.experience.filter(row => row.id === sample.actionId).length;
  assert.throws(() => processDiscoveryFeedback(npc, {
    recordEffect: effect => {
      recordEvent(npc, 'condition', { code: 'DISCOVERY_EFFECT', feedback: effect });
      throw new Error('callback failed after original receipt');
    },
  }), /callback failed/);
  assert.equal(npc.discovery.effects.length, 0);
  assert.equal(npc.discovery.seenFeedback.includes(emitted.id), false);
  assert.equal(npc.physiology.totals.ingestedWaterMl, originalInput);
  assert.equal(npc.memory.experience.filter(row => row.id === sample.actionId).length, originalActions);
  for (let i = 0; i < 60 * 8; i++) tickNpc(npc, 1 / 60, environment);
  let callbackCount = 0;
  processDiscoveryFeedback(npc, {
    recordEffect: effect => {
      callbackCount++;
      processDiscoveryFeedback(npc, { recordEffect: () => assert.fail('reentry must be inert') });
      const proof = recordEvent(npc, 'condition', { code: 'DISCOVERY_EFFECT', feedback: effect });
      recordEvent(npc, 'decision', { summary: 'Bounded nested bookkeeping.' });
      return proof;
    },
  });
  assert.equal(callbackCount, 1);
  const effect = npc.discovery.effects.find(row => row.id === emitted.id);
  assert.ok(effect);
  assert.equal(effect.at, emitted.at);
  assert.ok(npc.memory.experience.find(row => row.id === effect.proofEventId).at > effect.at);
  assertCompleteEffect(npc, effect);
  processDiscoveryFeedback(npc);
  assert.equal(npc.discovery.effects.filter(row => row.id === emitted.id).length, 1);
});

test('sleep-delayed recognition remains exact after the physiology feedback FIFO rolls over', () => {
  const { state, npc, environment } = sampleFixture('water relief');
  assert.equal(beginSleep(npc, { hours: 2 }).ok, true);
  const emitted = awaitFeedback(npc, environment, 'water relief');
  assert.notEqual(npc.physiology.sleep.state, 'awake');
  for (let i = 0; i < 60 * 8; i++) tickNpc(npc, 1 / 60, environment);
  wakePhysiology(npc, 'distress');
  processDiscoveryFeedback(npc);
  const effect = npc.discovery.effects.find(row => row.id === emitted.id);
  assert.ok(effect);
  const receipt = npc.memory.experience.find(row => row.id === effect.proofEventId);
  assert.ok(receipt.at > emitted.at, 'recognition time is later than physiological emission');
  assert.equal(receipt.details.feedback.at, emitted.at);
  npc.physiology.feedback = Array.from({ length: BIOLOGY_RULES.maxFeedback }, (_, i) => ({
    id: `feedback:fixture:${i}`, ingestionId: '', at: npc.elapsed, objectId: null,
    actionId: null, provenance: 'fixture', effect: 'no noticeable change',
    hunger: 'unchanged', thirst: 'unchanged', energy: 'unchanged', pain: 'none',
  }));
  assertCompleteEffect(npc, effect);
  const disk = storage();
  assert.equal(writeSave(disk, state), true);
  assertCompleteEffect(loadSave(disk).state.agents[0], effect);
});

test('forged action, result, object, ingestion, timestamp and condition provenance links protect knowledge', () => {
  const { state, npc, environment } = sampleFixture('water relief');
  const original = awaitEffect(npc, environment, 'water relief');
  const alter = [
    ['action target', (actor, sample, action) => { action.details.action.targetId = 'object:999999'; }],
    ['action result', (actor, sample, action) => { action.details.result.ok = false; }],
    ['action ingestion', (actor, sample, action) => { action.details.result.ingestionId = 'ingestion:999999'; }],
    ['sample identity', (actor, sample) => { sample.targetId = 'object:999999'; }],
    ['sample result', (actor, sample) => { sample.ok = false; }],
    ['sample timestamp', (actor, sample) => { sample.at += 1; }],
    ['effect object', actor => { actor.discovery.effects[0].objectId = 'object:999999'; }],
    ['effect ingestion', actor => { actor.discovery.effects[0].ingestionId = 'ingestion:999999'; }],
    ['effect timestamp', (actor, sample) => { actor.discovery.effects[0].at = sample.at - 1; }],
    ['proof identity', actor => { actor.discovery.effects[0].proofEventId = 999999; }],
    ['proof provenance', (actor, sample, action, proof) => { proof.details.feedback.source = 'reported'; }],
    ['proof embedded timestamp', (actor, sample, action, proof) => { proof.details.feedback.at += 1; }],
    ['proof receipt chronology', (actor, sample, action, proof) => { proof.at = actor.discovery.effects[0].at - 1; }],
  ];
  for (const [name, mutate] of alter) {
    const actor = structuredClone(npc);
    const sample = actor.discovery.experiments.find(row => row.actionId === original.actionId);
    const action = actor.memory.experience.find(row => row.id === original.actionId);
    const proof = actor.memory.experience.find(row => row.id === original.proofEventId);
    mutate(actor, sample, action, proof);
    assert.ok(retainedEffectProofError(actor), `${name} must fail original proof inspection`);
    assert.ok(saveProtectionReason({ ...state, agents: [actor], npc: actor }), `${name} must protect disk bytes`);
  }
  for (const kind of ['action', 'experiment']) {
    const actor = structuredClone(npc);
    if (kind === 'action') actor.memory.experience.push(structuredClone(actor.memory.experience.find(row => row.id === original.actionId)));
    else actor.discovery.experiments.push(structuredClone(actor.discovery.experiments.find(row => row.actionId === original.actionId)));
    assert.ok(retainedEffectProofError(actor), `duplicate ${kind} ID must fail closed`);
  }
});

test('malformed optional owner rows produce fixed planner reasons without throwing', () => {
  const { npc, environment } = sampleFixture('water relief');
  awaitEffect(npc, environment, 'water relief');
  for (const [field, container] of [['reports', 'discovery'], ['techniques', 'discovery'], ['skills', 'memory']]) {
    const actor = structuredClone(npc);
    actor[container][field] = [null];
    const result = planProofRetention(actor);
    assert.equal(result.ok, false, field);
    assert.equal(result.reason, 'malformed-proof-input');
  }
});

test('archived failed L/C/R snapshots retain exact original failure and protect the raw L bytes', {
  skip: !existsSync(resolve(archivedBaseline, 'checkpoint-error-l.json.gz')),
}, () => {
  const hashes = {
    l: 'fe97662ecd148335446499d014aa2d867880f333a2abc13e7f44511a358395c9',
    c: 'c2700da5de7265eba97536e691d2956e1f9256bd18a1093ba343a526ecacf9bf',
    r: '0f2ed070cef68b1aac76323a4dafe24e98f5e9d1a194f82cd9d7ccf081ef156d',
  };
  const snapshots = {};
  for (const [key, expected] of Object.entries(hashes)) {
    const archive = readFileSync(resolve(archivedBaseline, `checkpoint-error-${key}.json.gz`));
    assert.equal(createHash('sha256').update(archive).digest('hex'), expected, `${key} archived bytes`);
    const text = gunzipSync(archive).toString('utf8');
    snapshots[key] = { text, state: JSON.parse(text) };
  }
  const losses = JSON.parse(readFileSync(resolve(archiveRoot, 'retained-baseline-summary.json'))).failure.checkpoint.losses;
  assert.equal(losses.length, 4);
  for (const loss of losses) {
    const hasEffect = snapshot => snapshot.state.agents.find(actor => actor.id === loss.actorId).discovery.effects
      .some(effect => effect.id === loss.effect.id);
    assert.equal(hasEffect(snapshots.l), true);
    assert.equal(hasEffect(snapshots.c), false);
    assert.equal(hasEffect(snapshots.r), false);
  }
  assert.ok(saveProtectionReason(snapshots.l.state));
  assert.equal(saveProtectionReason(snapshots.c.state), null);
  assert.equal(saveProtectionReason(snapshots.r.state), null);
  const disk = storage();
  disk.setItem(CONFIG.saveKey, snapshots.l.text);
  assert.equal(loadSave(disk).blocked, true);
  assert.equal(writeSave(disk, snapshots.l.state), false);
  assert.equal(disk.getItem(CONFIG.saveKey), snapshots.l.text);
  const modeForged = structuredClone(snapshots.l.state);
  for (const actor of modeForged.agents) actor.mode = 'legacy';
  if (modeForged.npc) modeForged.npc.mode = 'legacy';
  const forgedBytes = JSON.stringify(modeForged);
  disk.setItem(CONFIG.saveKey, forgedBytes);
  assert.ok(saveProtectionReason(modeForged), 'the discovery envelope controls proof inspection');
  assert.equal(loadSave(disk).blocked, true);
  assert.equal(writeSave(disk, modeForged), false);
  assert.equal(disk.getItem(CONFIG.saveKey), forgedBytes);
});

test('65 real water effects retire only the oldest effect and preserve all 64 surviving proofs', () => {
  const { npc, environment, plant } = fixture();
  // This bounded stress fixture supplies enough physical fruit for 65 original
  // pull→sample transfers. Each outcome still comes from the real body callback.
  plant.quantity = 66;
  const ids = [];
  for (let i = 0; i < DISCOVERY_RULES.maxEffects + 1; i++) {
    assert.equal(finish(npc, environment, { type: 'pull', targetId: plant.id }).ok, true);
    const id = npc.inventory.items.at(-1), material = environment.ecology.materials.find(row => row.id === id);
    assert.ok(material);
    material.energyKcal = 0;
    material.waterMl = material.massGrams;
    material.digestHours = .15;
    npc.physiology.waterDeficitMl = 1000;
    assert.equal(finish(npc, environment, { type: 'sample', targetId: id }).ok, true);
    const sample = npc.discovery.experiments.findLast(row => row.primitive === 'sample' && row.targetId === id);
    assert.ok(sample);
    let effect = null;
    for (let j = 0; j < 600 && !effect; j++) {
      tickNpc(npc, .25, environment);
      processDiscoveryFeedback(npc);
      effect = npc.discovery.effects.find(row => row.ingestionId === sample.ingestionId && row.effect === 'water relief');
    }
    assert.ok(effect, `physical portion ${i + 1} produced water relief`);
    ids.push(effect.id);
    for (let j = 0; j < 40 && npc.physiology.stomach.some(row => row.id === sample.ingestionId); j++) tickNpc(npc, .25, environment);
    assert.equal(npc.physiology.stomach.some(row => row.id === sample.ingestionId), false);
    assert.equal(finish(npc, environment, { type: 'release', targetId: id }).ok, true);
  }
  assert.equal(npc.discovery.effects.length, DISCOVERY_RULES.maxEffects);
  assert.equal(npc.discovery.effects.some(effect => effect.id === ids[0]), false);
  assert.deepEqual(npc.discovery.effects.map(effect => effect.id), ids.slice(1));
  assert.ok(npc.discovery.experiments.length <= DISCOVERY_RULES.maxExperiments);
  assert.ok(npc.memory.experience.length <= NPC_RULES.maxExperience);
  for (const effect of npc.discovery.effects) assertCompleteEffect(npc, effect);
  const firstPlan = planProofRetention(npc), rng = npc.rng;
  assert.equal(firstPlan.ok, true);
  assert.ok(firstPlan.diagnostics.scannedExperiments <= PROOF_RETENTION_BOUNDS.scannedExperiments);
  assert.ok(firstPlan.diagnostics.scannedExperience <= PROOF_RETENTION_BOUNDS.scannedExperience);
  assert.equal(applyProofRetention(npc, firstPlan), true);
  const secondPlan = planProofRetention(npc);
  assert.equal(secondPlan.ok, true);
  assert.equal(secondPlan.diagnostics.removedExperiments, 0);
  assert.equal(secondPlan.diagnostics.removedExperience, 0);
  assert.deepEqual(secondPlan.retirements, []);
  assert.equal(npc.rng, rng);
});

test('a source technique keeps an alternate complete real witness when its oldest effect retires', () => {
  const { state, npc, environment, id, sample: first } = sampleFixture('ordinary');
  let firstEffect = awaitEffect(npc, environment, 'sustained');
  assertCompleteEffect(npc, firstEffect);
  for (let i = 0; i < 1600 && npc.physiology.stomach.some(row => row.id === first.ingestionId); i++) {
    tickNpc(npc, .25, environment);
    processDiscoveryFeedback(npc);
  }
  assert.equal(npc.physiology.stomach.some(row => row.id === first.ingestionId), false);
  npc.physiology.hoursSinceMeal = 12;
  assert.equal(finish(npc, environment, { type: 'sample', targetId: id }).ok, true);
  const second = npc.discovery.experiments.findLast(row => row.primitive === 'sample');
  assert.notEqual(second.ingestionId, first.ingestionId);
  let secondEffect = null;
  for (let i = 0; i < 6000 && !secondEffect; i++) {
    tickNpc(npc, 1 / 60, environment);
    processDiscoveryFeedback(npc);
    secondEffect = npc.discovery.effects.find(row => row.ingestionId === second.ingestionId && row.effect === 'sustained');
  }
  assert.ok(secondEffect);
  const technique = npc.discovery.techniques.find(row => row.evidence.includes(first.id) && row.evidence.includes(second.id));
  assert.ok(technique);
  // Model a completed FIFO retirement of the first effect bundle. The second
  // chain is an original physical acquisition, sample and body callback.
  npc.discovery.effects = npc.discovery.effects.filter(row => row.ingestionId !== first.ingestionId);
  npc.discovery.experiments = npc.discovery.experiments.filter(row => row.id !== first.id);
  npc.memory.experience = npc.memory.experience.filter(row => row.id !== first.actionId && row.id !== firstEffect.proofEventId);
  const plan = planProofRetention(npc);
  assert.equal(plan.ok, true);
  assert.equal(applyProofRetention(npc, plan), true);
  const retained = npc.discovery.techniques.find(row => row.id === technique.id);
  assert.ok(retained);
  assert.ok(retained.evidence.includes(second.id));
  assert.equal(retained.evidence.includes(first.id), false);
  assertCompleteEffect(npc, secondEffect);
  for (let i = 0; i < 1600 && npc.physiology.stomach.some(row => row.id === second.ingestionId); i++) {
    tickNpc(npc, .25, environment);
    processDiscoveryFeedback(npc);
  }
  assert.equal(npc.physiology.stomach.some(row => row.id === second.ingestionId), false);
  npc.physiology.hoursSinceMeal = 12;
  projectPhysiology(npc);
  npc.discovery.run = null;
  const beforeAction = discoveryDecision(npc).action;
  assert.deepEqual(beforeAction, { type: 'sample', targetId: id });
  const disk = storage();
  assert.equal(writeSave(disk, state), true);
  const reopened = loadSave(disk).state.agents[0];
  assertCompleteEffect(reopened, secondEffect);
  assert.deepEqual(discoveryDecision(reopened).action, beforeAction, 'effect-driven held sampling remains eligible');
  const normalized = reopened.discovery.techniques.find(row => row.id === technique.id);
  assert.ok(normalized);
  assert.equal(retained.successes, 2, 'two genuine live sustained portions were counted');
  assert.equal(normalized.successes, 1, 'restore derives only one retained complete witness');
  assert.equal(retained.confidence, 'supported');
  assert.equal(normalized.confidence, 'tentative');
});
