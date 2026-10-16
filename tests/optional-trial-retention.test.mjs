import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../src/config.js';
import { DISCOVERY_RULES } from '../src/discovery-config.js';
import { deriveDiscoveryPractice } from '../src/discovery-state.js';
import { freshState } from '../src/world.js';
import { PopulationRuntime } from '../src/population.js';
import { learnedValue } from '../src/npc-memory.js';
import { loadSave, prepareLegacyPendingMigration, saveProtectionReason, writeSave } from '../src/save.js';
import { compactProofRetention, retainedProofIntegrityError } from '../src/proof-retention.js';
import { syntheticProtectedRaw } from './native-synthetic-fixture.mjs';

const snapshot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../task/evidence/aincrad-snapshots/000045.log');
const snapshotSha256 = '0f549cf6a64ca52ecea88bc9fedfc562472c44cc514ecd57af5c2beeb22bdd6c';
function disk(raw) {
  const values = new Map([[CONFIG.saveKey, raw]]);
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
function varint(bytes, start) {
  let value = 0, scale = 1, at = start;
  for (let i = 0; i < 8; i++) {
    assert.ok(at < bytes.length);
    const byte = bytes[at++]; value += (byte & 127) * scale;
    if (!(byte & 128)) return [value, at];
    scale *= 128;
  }
  assert.fail('oversized LevelDB varint');
}
function copied000045() {
  const bytes = readFileSync(snapshot);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), snapshotSha256);
  const records = [];
  let at = 0, fragments = [];
  while (at < bytes.length) {
    const remaining = 32768 - at % 32768;
    if (remaining < 7) { at += remaining; continue; }
    const length = bytes.readUInt16LE(at + 4), kind = bytes[at + 6];
    if (!length && !kind) { at += remaining; continue; }
    assert.ok(length <= remaining - 7);
    const part = bytes.subarray(at + 7, at + 7 + length); at += 7 + length;
    if (kind === 1) records.push(part);
    else if (kind === 2) fragments = [part];
    else if (kind === 3) fragments.push(part);
    else if (kind === 4) { fragments.push(part); records.push(Buffer.concat(fragments)); fragments = []; }
    else assert.fail(`unexpected LevelDB record ${kind}`);
  }
  assert.equal(fragments.length, 0);
  for (const batch of records) {
    let offset = 12;
    for (let i = 0; i < batch.readUInt32LE(8); i++) {
      const kind = batch[offset++];
      let length; [length, offset] = varint(batch, offset);
      const key = batch.subarray(offset, offset + length); offset += length;
      if (kind === 0) continue;
      assert.equal(kind, 1);
      [length, offset] = varint(batch, offset);
      const value = batch.subarray(offset, offset + length); offset += length;
      if (key.toString('utf8').endsWith(`\0\x01${CONFIG.saveKey}`)) {
        assert.equal(value[0], 1);
        return value.subarray(1).toString('utf8');
      }
    }
  }
  assert.fail('copied WAL has no Aincrad save');
}

const trial = { attempts: 1, successes: 1, failures: 0, seconds: 1, lastAt: 0,
  lastCode: 'GRASPED', lastOk: true };
test('live compaction drops only ownerless optional trials within fixed caps', () => {
  const actor = freshState().agents[0];
  const observed = 'object:900001', supported = 'object:900002', expired = 'object:900003';
  actor.discovery.observations[observed] = { id: observed, scene: 'valley',
    position: { x: 0, y: 0 }, appearance: {}, observedAt: actor.elapsed };
  actor.discovery.trials = Object.fromEntries([[`${observed}|grasp`, { ...trial }],
    [`${supported}|grasp`, { ...trial }], [`${expired}|grasp`, { ...trial }]]);
  for (let i = 0; i < 765; i++) actor.discovery.trials[`object:${900100 + i}|grasp`] = { ...trial };
  assert.equal(Object.keys(actor.discovery.trials).length, 768);
  const actionId = actor.memory.nextId++, experimentId = actor.discovery.nextId++;
  actor.memory.experience.push({ id: actionId, at: actor.elapsed, type: 'action',
    details: { action: { type: 'grasp', targetId: supported },
      result: { ok: true, code: 'GRASPED' } } });
  actor.discovery.experiments.push({ id: experimentId, actionId, at: actor.elapsed,
    primitive: 'grasp', targetId: supported, ok: true, code: 'GRASPED', durationSeconds: 1 });
  const active = actor.active = { request: { type: 'rest' } };
  const nextId = actor.memory.nextId;
  const plan = compactProofRetention(actor);
  assert.equal(plan.ok, true, plan.reason);
  assert.equal(actor.discovery.trials[`${expired}|grasp`], undefined);
  assert.ok(actor.discovery.trials[`${observed}|grasp`], 'observation alone retains its trial');
  assert.ok(actor.discovery.trials[`${supported}|grasp`], 'experiment alone retains its trial');
  assert.equal(Object.keys(actor.discovery.trials).length, 2);
  assert.deepEqual(actor.discovery.practice,
    deriveDiscoveryPractice(actor.discovery.experiments, actor.discovery.trials));
  assert.equal(actor.active, active, 'compaction does not cancel the in-flight action');
  assert.equal(actor.discovery.run, null);
  assert.equal(actor.memory.nextId, nextId, 'optional retirement allocates no receipt');
  assert.ok(actor.discovery.experiments.length <= DISCOVERY_RULES.maxExperiments);
});

test('a forged retained trial cannot be erased by optional-trial compaction', () => {
  const prepared = prepareLegacyPendingMigration(syntheticProtectedRaw());
  assert.equal(prepared.ok, true, prepared.reason);
  const storage = disk(prepared.candidate), opened = loadSave(storage);
  assert.equal(opened.blocked, false);
  const actor = opened.state.agents[0];
  const key = Object.keys(actor.discovery.trials).find(entry => {
    const [id, type] = entry.split('|');
    return actor.discovery.observations[id] &&
      actor.discovery.experiments.some(row => row.targetId === id && row.primitive === type);
  });
  assert.ok(key, 'a genuine observation and experiment anchor a trial');
  actor.discovery.trials[key].attempts = -1;
  const active = actor.active = { request: { type: 'rest' } };
  const before = storage.getItem(CONFIG.saveKey);
  const plan = compactProofRetention(actor);
  assert.equal(plan.ok, true, plan.reason);
  assert.equal(actor.discovery.trials[key].attempts, -1, 'forged retained data is not forgiven by retirement');
  assert.equal(actor.active, active, 'in-flight bodily action stays active');
  assert.equal(writeSave(storage, opened.state), false);
  assert.equal(storage.getItem(CONFIG.saveKey), before, 'the last valid disk bytes remain untouched');
});

test('copied 000045 retires the orphaned grasp trial only after its last experiment, with unchanged body and proof', {
  skip: !existsSync(snapshot),
}, () => {
  const prepared = prepareLegacyPendingMigration(copied000045());
  assert.equal(prepared.ok, true, prepared.reason);
  const storage = disk(prepared.candidate), opened = loadSave(storage);
  assert.equal(opened.blocked, false, opened.error);
  const world = opened.state, mira = world.agents.find(actor => actor.id === 'mira');
  const key = 'object:2767|grasp', experimentId = 11343;
  assert.equal(mira.discovery.observations['object:2767'], undefined, 'observation already rotated out at load');
  assert.ok(mira.discovery.experiments.some(row => row.id === experimentId), 'last experiment exists at load');
  assert.ok(mira.discovery.trials[key], 'matching experiment keeps the trial at load');
  assert.equal(writeSave(storage, world), true, 'the candidate writes before live ticks');
  const inFlight = structuredClone(world.agents[0]);
  const technique = inFlight.discovery.techniques[0];
  assert.ok(technique, 'copied Aster has a proven retained technique');
  const run = inFlight.discovery.run = { techniqueId: technique.id, cursor: 0, awaiting: true };
  const runPlan = compactProofRetention(inFlight);
  assert.equal(runPlan.ok, true, runPlan.reason);
  assert.equal(inFlight.discovery.run, run, 'optional retirement does not cancel a proven in-flight run');
  const before = world.agents.map(actor => ({ id: actor.id,
    nonzeroFeatureKeys: Object.entries(actor.memory.features).filter(([,weight]) => weight !== 0).map(([feature]) => feature),
    effects: structuredClone(actor.discovery.effects),
    proofs: actor.discovery.effects.map(effect => ({
      sample: structuredClone(actor.discovery.experiments.find(row => row.actionId === effect.actionId)),
      action: structuredClone(actor.memory.experience.find(row => row.id === effect.actionId)),
      condition: structuredClone(actor.memory.experience.find(row => row.id === effect.proofEventId)),
    })) }));
  const runtime = new PopulationRuntime(world);
  let retirementAt = null;
  try {
    for (let tick = 0; tick < 180; tick++) {
      world.elapsed += CONFIG.fixedStep;
      runtime.tick(CONFIG.fixedStep);
      if (tick === 0) {
        for (const actor of world.agents) {
          assert.ok(Object.keys(actor.memory.features).length <= 144, `${actor.id} bounded after first tick`);
          for (const expected of before.find(row => row.id === actor.id).nonzeroFeatureKeys)
            assert.ok(Object.hasOwn(actor.memory.features, expected), `${actor.id} retains ${expected}`);
        }
        assert.equal(writeSave(storage, world), true, 'first live tick saves without dropping learned weights');
      }
      const experimentExists = mira.discovery.experiments.some(row => row.id === experimentId);
      if (experimentExists) assert.ok(mira.discovery.trials[key], `retained while experiment exists at tick ${tick}`);
      else if (retirementAt === null) {
        retirementAt = (tick + 1) * CONFIG.fixedStep;
        assert.equal(mira.discovery.trials[key], undefined, 'trial retires synchronously with last experiment');
      }
    }
  } finally { runtime.dispose(); }
  assert.ok(retirementAt !== null && retirementAt <= 3, 'three-second run reaches the FIFO retirement');
  assert.equal(retainedProofIntegrityError(mira), null);
  assert.equal(saveProtectionReason(world), null);
  const actions = [{ type: 'grasp' }, { type: 'pull' }, { type: 'inspect_object' },
    { type: 'move' }, { type: 'wait' }];
  const learned = world.agents.map(actor => ({ id: actor.id,
    features: structuredClone(actor.memory.features), values: structuredClone(actor.memory.values),
    scores: actions.map(action => learnedValue(actor, action)) }));
  assert.equal(writeSave(storage, world), true, 'live proof and learner weights save together');
  const restored = loadSave(storage);
  assert.equal(restored.blocked, false, restored.error);
  for (const expected of before) {
    const actor = restored.state.agents.find(row => row.id === expected.id);
    const live = world.agents.find(row => row.id === expected.id);
    const weights = learned.find(row => row.id === expected.id);
    assert.deepEqual(actor.physiology, live.physiology);
    assert.deepEqual(actor.discovery.effects, expected.effects);
    assert.deepEqual(actor.memory.features, weights.features, `${actor.id} exact learned weights`);
    assert.deepEqual(actor.memory.values, weights.values, `${actor.id} exact learned values`);
    assert.deepEqual(actions.map(action => learnedValue(actor, action)), weights.scores,
      `${actor.id} exact learned scores`);
    for (const feature of expected.nonzeroFeatureKeys)
      assert.ok(Object.hasOwn(actor.memory.features, feature), `${actor.id} persists ${feature}`);
    for (const proof of expected.proofs) {
      assert.deepEqual(actor.discovery.experiments.find(row => row.id === proof.sample.id), proof.sample);
      assert.deepEqual(actor.memory.experience.find(row => row.id === proof.action.id), proof.action);
      assert.deepEqual(actor.memory.experience.find(row => row.id === proof.condition.id), proof.condition);
    }
  }
});

test('copied 000045 keeps body and effect proof through 3600 fixed steps with explicit count normalization', {
  skip: !existsSync(snapshot),
}, () => {
  const prepared = prepareLegacyPendingMigration(copied000045());
  assert.equal(prepared.ok, true, prepared.reason);
  const storage = disk(prepared.candidate), opened = loadSave(storage);
  assert.equal(opened.blocked, false, opened.error);
  const world = opened.state, runtime = new PopulationRuntime(world, { cardinal: false });
  const originalEffects = world.agents.map(actor => ({ id: actor.id,
    proofs: actor.discovery.effects.map(effect => ({ id: effect.id,
      actionId: effect.actionId, proofEventId: effect.proofEventId })) }));
  try {
    for (let tick = 0; tick < 3600; tick++) {
      world.elapsed += CONFIG.fixedStep;
      runtime.tick(CONFIG.fixedStep);
    }
  } finally { runtime.dispose(); }
  assert.equal(saveProtectionReason(world), null);
  for (const actor of world.agents)assert.equal(retainedProofIntegrityError(actor), null);
  const mira = world.agents.find(actor => actor.id === 'mira');
  const first = 'object:2765|sample', second = 'object:2763|sample';
  assert.equal(mira.discovery.trials[first].attempts, 3);
  assert.equal(mira.discovery.trials[first].successes, 3);
  assert.equal(mira.discovery.trials[second].attempts, 3);
  assert.equal(mira.discovery.trials[second].successes, 3);
  assert.equal(mira.discovery.techniques[7].successes, 11);
  assert.equal(writeSave(storage, world), true, '60-second marked write succeeds');
  const reopened = loadSave(storage);
  assert.equal(reopened.blocked, false, reopened.error);
  for (const actor of world.agents) {
    const saved = reopened.state.agents.find(row => row.id === actor.id);
    assert.ok(saved);
    for (const field of ['scene','position','elapsed','flask','inventory','thermal',
      'lifecycle','lifecycleAt','collapseCause','feelings','stats','hydration',
      'nourishment','energy','stamina','fatigue','sleepPressure','health','bodyMode','physiology'])
      assert.deepEqual(saved[field], actor[field], `${actor.id} ${field}`);
    const sensation = structuredClone(actor.sensation);
    delete sensation.rain; delete sensation.rainfall;
    assert.deepEqual(saved.sensation, sensation, `${actor.id} persisted sensation`);
    assert.deepEqual(saved.discovery.effects, actor.discovery.effects, `${actor.id} effects`);
    assert.deepEqual(saved.discovery.experiments, actor.discovery.experiments, `${actor.id} samples`);
    for (const effect of actor.discovery.effects) {
      const sample = actor.discovery.experiments.find(row => row.actionId === effect.actionId);
      assert.ok(sample, `${actor.id} sample for ${effect.id}`);
      assert.deepEqual(saved.discovery.experiments.find(row => row.id === sample.id), sample);
      for (const id of [effect.actionId,effect.proofEventId]) {
        const receipt = actor.memory.experience.find(row => row.id === id);
        assert.ok(receipt, `${actor.id} receipt ${id}`);
        assert.deepEqual(saved.memory.experience.find(row => row.id === id), receipt);
      }
    }
    for (const proof of originalEffects.find(row => row.id === actor.id).proofs)
      assert.ok(saved.discovery.effects.some(effect => effect.id === proof.id &&
        effect.actionId === proof.actionId && effect.proofEventId === proof.proofEventId),
      `${actor.id} original effect ${proof.id}`);
    assert.deepEqual(saved.memory.features, actor.memory.features, `${actor.id} learned weights`);
  }
  const savedMira = reopened.state.agents.find(actor => actor.id === 'mira');
  const expectedTrials = structuredClone(mira.discovery.trials);
  Object.assign(expectedTrials[first], { attempts: 1, successes: 1, seconds: 1.9250000000000003 });
  Object.assign(expectedTrials[second], { attempts: 2, successes: 2, seconds: 3.8500000000000005 });
  assert.deepEqual(savedMira.discovery.trials, expectedTrials, 'only explained trial aggregates normalize');
  const expectedTechniques = structuredClone(mira.discovery.techniques);
  expectedTechniques[7].successes = 8;
  assert.deepEqual(savedMira.discovery.techniques, expectedTechniques,
    'technique structure and evidence stay exact while retained-witness count normalizes');
  const savedBytes = storage.getItem(CONFIG.saveKey);
  mira.discovery.techniques[7].evidence[0] = -1;
  assert.equal(writeSave(storage, world), false, 'unrelated technique evidence mutation remains blocked');
  assert.equal(storage.getItem(CONFIG.saveKey), savedBytes);
});

// This longer probe and its prior first-save failure are retained for follow-up.
// The old marked-write counter guard caused that failure. That guard exceeded
// the approved effect-proof contract. The
// scoped acceptance above is 3600 fixed steps, not 900 simulated seconds.
test('copied 000045 retains live physical state and every learned effect through 900 seconds of saves', {
  skip: 'Extended probe outside the approved 3600-step acceptance; prior red result is preserved',
}, () => {
  const prepared = prepareLegacyPendingMigration(copied000045());
  assert.equal(prepared.ok, true, prepared.reason);
  const storage = disk(prepared.candidate), opened = loadSave(storage);
  assert.equal(opened.blocked, false, opened.error);
  const world = opened.state, runtime = new PopulationRuntime(world, { cardinal: false });
  const originalProofs = world.agents.map(actor => ({ id: actor.id,
    effects: actor.discovery.effects.map(effect => ({ actionId: effect.actionId,
      proofEventId: effect.proofEventId })) }));
  try {
    for (let tick = 0; tick < 900 * 60; tick++) {
      world.elapsed += CONFIG.fixedStep;
      runtime.tick(CONFIG.fixedStep);
      if ((tick + 1) % (60 * 60) !== 0) continue;
      const minute = (tick + 1) / 60;
      assert.equal(writeSave(storage, world), true, `copied historical world saves at ${minute}s`);
      const reopened = loadSave(storage);
      assert.equal(reopened.blocked, false, `${minute}s: ${reopened.error}`);
      for (const actor of world.agents) {
        const saved = reopened.state.agents.find(row => row.id === actor.id);
        assert.ok(saved);
        for (const key of ['physiology', 'hydration', 'nourishment', 'energy',
          'health', 'flask', 'inventory'])
          assert.deepEqual(saved[key], actor[key], `${actor.id} ${key} at ${minute}s`);
        assert.deepEqual(saved.discovery.effects, actor.discovery.effects,
          `${actor.id} exact effects at ${minute}s`);
        assert.deepEqual(saved.memory.features, actor.memory.features,
          `${actor.id} exact learned weights at ${minute}s`);
        for (const effect of actor.discovery.effects) {
          assert.ok(actor.discovery.experiments.some(row => row.actionId === effect.actionId),
            `${actor.id} live sample for effect at ${minute}s`);
          for (const id of [effect.actionId, effect.proofEventId]) {
            const receipt = actor.memory.experience.find(row => row.id === id);
            assert.ok(receipt, `${actor.id} live effect receipt ${id} at ${minute}s`);
            assert.deepEqual(saved.memory.experience.find(row => row.id === id), receipt);
          }
        }
        for (const proof of originalProofs.find(row => row.id === actor.id).effects)
          assert.ok(saved.discovery.effects.some(effect =>
            effect.actionId === proof.actionId && effect.proofEventId === proof.proofEventId),
          `${actor.id} original effect ${proof.actionId} survives ${minute}s`);
      }
    }
  } finally { runtime.dispose(); }
});
