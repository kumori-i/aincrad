import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { freshState } from '../src/world.js';
import { loadSave, prepareLegacyPendingMigration, writeSave } from '../src/save.js';
import { inspectProfileBoot } from '../src/recovered-profile-boot.js';
import { PopulationRuntime } from '../src/population.js';
import { syntheticProtectedRaw } from './native-synthetic-fixture.mjs';

function storage(raw) {
  const values = new Map(raw === undefined ? [] : [[CONFIG.saveKey, raw]]);
  const writes = [];
  return { writes, getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { writes.push(value); values.set(key, value); } };
}

const prepared = prepareLegacyPendingMigration(syntheticProtectedRaw());
assert.equal(prepared.ok, true, prepared.reason);
const candidate = prepared.candidate;

test('marked ready copy protects exact bytes when actor, body, or learned evidence would be normalized away', async () => {
  const bad = [
    ['missing actors', raw => { raw.agents = []; }],
    ['duplicate actor', raw => { raw.agents[1] = structuredClone(raw.agents[0]); }],
    ['divergent Aster alias', raw => { raw.npc = structuredClone(raw.agents[0]); }],
    ['invalid player', raw => { raw.player = { x: 'bad', y: null }; }],
    ['negative stomach mass', raw => { raw.agents[0].physiology.stomach[0].remainingMassGrams = -1; }],
    ['missing physiology', raw => { delete raw.agents[0].physiology; }],
    ['forged learned effect', raw => { raw.agents[0].discovery.effects[0].thirst = 'forged'; }],
    ['missing Cardinal history', raw => { delete raw.cardinal; }],
    ['missing community history', raw => { delete raw.community; }],
    ['bad selected actor', raw => { raw.selectedAgentId = 'unknown'; }],
    ['missing social memory', raw => { delete raw.agents[0].social; }],
    ['missing cognition', raw => { delete raw.agents[0].cognition; }],
    ['invalid experience counter', raw => { raw.agents[0].memory.nextId = -1; }],
    ['sample receipt truncated by compaction', raw => {
      const pending = raw.agents[0].physiology.stomach[0];
      const receipt = raw.agents[0].memory.experience.find(row => row.id === pending.actionId);
      receipt.details = Object.fromEntries([
        ...Array.from({ length: 24 }, (_, i) => [`padding${i}`, i]),
        ...Object.entries(receipt.details),
      ]);
    }],
  ];
  const ready = { kind: 'recovered', phase: 'ready', available: true, recoveredCopySupported: true,
    sourceSha256: 'a'.repeat(64), createdAt: '2026-10-16T12:00:00.000Z' };
  for (const [name, alter] of bad) {
    const raw = JSON.parse(candidate);
    alter(raw);
    const original = JSON.stringify(raw), disk = storage(original);
    const loaded = loadSave(disk);
    assert.equal(loaded.blocked, true, name);
    assert.match(loaded.error, /preserved/i, `${name}: visible protection`);
    const boot = await inspectProfileBoot({ profileApi: { status: async () => ready },
      getStorage: () => disk, loadSave, saveKey: CONFIG.saveKey });
    assert.equal(boot.gate, 'blocked', `${name}: no recovered runtime`);
    assert.equal(writeSave(disk, raw), false, `${name}: malformed marked write refused`);
    assert.equal(disk.getItem(CONFIG.saveKey), original, `${name}: original bytes unchanged`);
    assert.deepEqual(disk.writes, [], `${name}: no write attempted`);
  }
});

test('genuine interrupted marked action reopens once and retains its proof', () => {
  const disk = storage(candidate), opened = loadSave(disk);
  assert.equal(opened.blocked, false);
  const actor = opened.state.agents[0];
  const before = actor.memory.experience.filter(row => row.details.result?.code === 'RESTART_INTERRUPTED').length;
  actor.active = { request: { type: 'rest' } };
  actor.bodyMode = 'resting';
  assert.equal(actor.physiology.sleep.state, 'awake', 'resting is the in-flight action mode');
  assert.equal(writeSave(disk, opened.state), true);
  const persisted = JSON.parse(disk.getItem(CONFIG.saveKey)).agents[0];
  assert.equal(persisted.interrupted, true);
  assert.equal(persisted.bodyMode, 'awake', 'cancelled rest resumes from its unchanged physiology');
  const restored = loadSave(disk);
  assert.equal(restored.blocked, false, restored.error);
  assert.equal(restored.state.agents[0].memory.experience.filter(row =>
    row.details.result?.code === 'RESTART_INTERRUPTED').length, before + 1);
  assert.deepEqual(restored.state.agents[0].physiology, actor.physiology);
  assert.deepEqual(restored.state.agents[0].discovery.effects, actor.discovery.effects);
  assert.equal(writeSave(disk, restored.state), true);
  const reopened = loadSave(disk);
  assert.equal(reopened.blocked, false, reopened.error);
  assert.equal(reopened.state.agents[0].memory.experience.filter(row =>
    row.details.result?.code === 'RESTART_INTERRUPTED').length, before + 1);
});

test('a marked world saves through 900 seconds of live simulation without losing body or effect proof', () => {
  const disk = storage(candidate), opened = loadSave(disk);
  assert.equal(opened.blocked, false);
  const world = opened.state, runtime = new PopulationRuntime(world, { cardinal: false });
  try {
    for (let tick = 0; tick < 900 * 60; tick++) {
      world.elapsed += 1 / 60;
      runtime.tick(1 / 60);
      if ((tick + 1) % (60 * 60) !== 0) continue;
      assert.equal(writeSave(disk, world), true, `autosave at ${(tick + 1) / 60}s`);
      const reopened = loadSave(disk);
      assert.equal(reopened.blocked, false, reopened.error);
      for (const actor of world.agents) {
        const saved = reopened.state.agents.find(row => row.id === actor.id);
        assert.ok(saved);
        for (const key of ['physiology', 'hydration', 'nourishment', 'energy', 'health', 'flask', 'inventory'])
          assert.deepEqual(saved[key], actor[key], `${actor.id} ${key} at ${(tick + 1) / 60}s`);
        assert.deepEqual(saved.discovery.effects, actor.discovery.effects);
        assert.deepEqual(saved.discovery.experiments, actor.discovery.experiments);
        for (const effect of actor.discovery.effects)
          for (const id of [effect.actionId, effect.proofEventId]) {
            const before = actor.memory.experience.find(row => row.id === id);
            assert.ok(before, `${actor.id} effect receipt ${id}`);
            assert.deepEqual(saved.memory.experience.find(row => row.id === id), before);
          }
      }
    }
  } finally { runtime.dispose(); }
});

test('a pending Cardinal experiment and an actor action restore through declared interruption receipts', () => {
  const disk = storage(candidate), opened = loadSave(disk);
  assert.equal(opened.blocked, false);
  const world = opened.state;
  world.agents[0].active = { request: { type: 'rest' } };
  world.cardinal.nextId = 3;
  world.cardinal.status = 'experimenting';
  world.cardinal.proposals.push({ id: 'cardinal:proposal:1', at: world.elapsed,
    parameter: 'rainfallMultiplier', from: 1, to: 1.25, reason: 'test pending work',
    context: 'owner_requested', status: 'running', origin: 'owner' });
  world.cardinal.pending = { id: 'cardinal:experiment:2',
    proposalId: 'cardinal:proposal:1', startedAt: world.elapsed, progress: .4 };
  assert.equal(writeSave(disk, world), true);
  const restored = loadSave(disk);
  assert.equal(restored.blocked, false, restored.error);
  assert.equal(restored.state.cardinal.pending, null);
  assert.equal(restored.state.cardinal.proposals[0].status, 'interrupted');
  assert.equal(restored.state.cardinal.diagnoses.at(-1).code, 'EXPERIMENT_INTERRUPTED');
  assert.equal(restored.state.agents[0].memory.experience.filter(row =>
    row.details.result?.code === 'RESTART_INTERRUPTED').length, 1);
  assert.equal(writeSave(disk, restored.state), true);
  assert.equal(loadSave(disk).blocked, false);
});

test('ordinary unmarked saves retain their historical missing-actor restore behavior', () => {
  const { npc: _alias, ...raw } = freshState();
  raw.agents = [];
  const disk = storage(JSON.stringify(raw));
  const loaded = loadSave(disk);
  assert.equal(loaded.blocked, false);
  assert.deepEqual(loaded.state.agents.map(actor => actor.id), ['aster', 'mira']);
});
