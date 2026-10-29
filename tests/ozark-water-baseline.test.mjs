import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
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
  let firstRaw=null,secondRaw=null;
  const first = evaluateOzarkWaterStart(74193, 2,raw=>{assert.equal(firstRaw,null);firstRaw=raw;});
  const second = evaluateOzarkWaterStart(74193, 2,raw=>{assert.equal(secondRaw,null);secondRaw=raw;});
  const {ozarkRawSha256:firstRawHash,...firstDeterministic}=first;
  const {ozarkRawSha256:secondRawHash,...secondDeterministic}=second;
  assert.match(firstRawHash,/^[0-9a-f]{64}$/);
  assert.match(secondRawHash,/^[0-9a-f]{64}$/);
  const sha256=raw=>createHash('sha256').update(raw).digest('hex');
  assert.equal(firstRawHash,sha256(firstRaw));
  assert.equal(secondRawHash,sha256(secondRaw));
  assert.notEqual(firstRawHash,secondRawHash,'Independent fresh-world saves have unique raw identities');
  assert.deepEqual(secondDeterministic,firstDeterministic);
  const firstSaved=JSON.parse(firstRaw),secondSaved=JSON.parse(secondRaw);
  assert.equal(firstSaved.worldLineage.instanceId,firstSaved.visualReference.worldId);
  assert.equal(secondSaved.worldLineage.instanceId,secondSaved.visualReference.worldId);
  assert.notEqual(firstSaved.worldLineage.instanceId,secondSaved.worldLineage.instanceId);
  for(const saved of [firstSaved,secondSaved]){
    saved.worldLineage.instanceId='<fresh-world-instance>';
    saved.visualReference.worldId='<fresh-world-instance>';
  }
  assert.deepEqual(secondSaved,firstSaved,
    'Full actual saved worlds retain exact policy, physical, RNG and evidence parity apart from unique instance identity');
  assert.equal(first.historicalBytesPreserved, true);
  assert.equal(first.loadProofValidated, true);
  assert.deepEqual(first.agents.map(agent => agent.id), ['aster', 'mira']);
  assert.deepEqual(first.agents.map(agent => agent.outcome),
    ['no-source-observed', 'no-source-observed']);
  assert.ok(first.agents.every(agent => agent.observedSourceCount === 0 &&
    agent.fills === 0 && agent.drinks === 0 && agent.proofError === null));
});
