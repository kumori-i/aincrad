import test from 'node:test';
import assert from 'node:assert/strict';
import { DISCOVERY_RULES } from '../src/discovery-config.js';
import { deriveDiscoveryPractice } from '../src/discovery-state.js';
import { freshState } from '../src/world.js';
import { compactProofRetention } from '../src/proof-retention.js';

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
