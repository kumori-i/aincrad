import test from 'node:test';
import assert from 'node:assert/strict';
import { baselineOptions, evaluateOzarkWaterStart } from
  '../scripts/evaluate-ozark-water.mjs';

test('bounded options reject oversized or ambiguous evaluation runs', () => {
  assert.deepEqual(baselineOptions(['--seconds', '300', '--seeds',
    '74193,74203']).seeds, [74193, 74203]);
  assert.throws(() => baselineOptions(['--seconds', '1800', '--seeds',
    '1,2,3,4,5,6']), /budget/i);
  assert.throws(() => baselineOptions(['--seconds', '1', '--seeds',
    '74193,74193']), /distinct/);
  assert.throws(() => baselineOptions(['--seconds', '0']), /Seconds/);
});

test('canonical two-agent baseline preserves a negative outcome and exact save proof deterministically', () => {
  const first = evaluateOzarkWaterStart(74193, 2);
  const second = evaluateOzarkWaterStart(74193, 2);
  assert.deepEqual(second, first);
  assert.equal(first.historicalBytesPreserved, true);
  assert.equal(first.loadProofValidated, true);
  assert.deepEqual(first.agents.map(agent => agent.id), ['aster', 'mira']);
  assert.deepEqual(first.agents.map(agent => agent.outcome),
    ['no-source-observed', 'no-source-observed']);
  assert.ok(first.agents.every(agent => agent.observedSourceCount === 0 &&
    agent.fills === 0 && agent.drinks === 0 && agent.proofError === null));
});
