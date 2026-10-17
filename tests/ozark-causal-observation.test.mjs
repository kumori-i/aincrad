import test from 'node:test';
import assert from 'node:assert/strict';
import { runCausalProbe } from '../scripts/verify-ozark-causal-observation.mjs';
import { createOzarkWalkingPilot } from '../src/ozark-pilot-geometry.js';
import { OZARK_WALKING_PILOT_PROFILE } from '../src/geometry-profile.js';

test('headless local evidence distinguishes dry, flow, entry, exit and low-progress attempts', () => {
  const first = runCausalProbe();
  const replay = runCausalProbe();
  assert.deepEqual(replay, first, 'the fixed scripted probe should replay exactly');
  assert.equal(first.status, 'passed');
  assert.equal(first.scope, 'scripted local observations and action outcomes; no learning');
  assert.ok(first.wading.assistedProgress > first.wading.opposedProgress);
  assert.deepEqual(first.transitions, { entered: 'shallow-water', exited: 'dry-land' });
  assert.equal(first.lowProgress.code, 'NEGLIGIBLE_PROGRESS');
  assert.equal(first.lowProgress.resistance, 'strong');
  assert.deepEqual(first.storageAccess, { reads: 0, writes: 0 });
  // Independent test oracle only: the probe above never reads this sampler.
  const geometry = createOzarkWalkingPilot(OZARK_WALKING_PILOT_PROFILE);
  assert.equal(geometry.sample(first.lowProgress.position.x,
    first.lowProgress.position.y - 10).waterBand, 'deep-water');
});
