import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpc } from '../src/npc-state.js';
import { validateNpc } from '../src/npc-memory.js';
import { ingestMaterial } from '../src/biology.js';
import { createTemporalLedger } from '../src/temporal-ledger.js';

test('experimental restore rejects malformed raw feedback clocks before physiology normalizes them', () => {
  for (const at of [-1, NaN, Infinity, undefined, null, '1', 11]) {
    const n = createNpc({ mode: 'discovery' });
    n.elapsed = 10; n.discovery.temporal = createTemporalLedger();
    const swallowed = ingestMaterial(n, { massGrams: 30, energyKcal: 10, waterMl: 20 }, { objectId: 'object:1', actionId: 1, at: 9, source: 'sampled' });
    assert.equal(swallowed.ok, true);
    const stomach = structuredClone(n.physiology.stomach), totals = structuredClone(n.physiology.totals);
    n.physiology.feedback = [{ id: 'feedback:2', ingestionId: swallowed.ingestionId, objectId: 'object:1', actionId: 1, at, effect: 'sustained', provenance: 'sampled' }];
    const restored = validateNpc(n);
    assert.deepEqual(restored.physiology.feedback, [], String(at));
    assert.deepEqual(restored.physiology.stomach, stomach, 'physical pending material is untouched');
    assert.deepEqual(restored.physiology.totals, totals, 'accounted mass/energy/water is untouched');
    assert.equal(restored.discovery.temporal.feedbackCursor, 2, 'raw rejected source identity is durably consumed');
    restored.elapsed = 100;
    const twice = validateNpc(restored);
    assert.deepEqual(twice.physiology.feedback, []);
    assert.equal(twice.discovery.temporal.feedbackCursor, 2);
  }
});
