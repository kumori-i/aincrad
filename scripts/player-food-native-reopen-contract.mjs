import assert from 'node:assert/strict';

/** Check every durable ecology field across the actual save and reopening.
 * Animal feelings and action progress are explicitly session-only projections.
 */
export function assertDurableFoodReopen(live, saved, reopened) {
  const durable = structuredClone(live);
  for (const animal of durable.animals) {
    delete animal.feelings;
    animal.actionHours = 0;
  }
  assert.deepEqual(saved, durable,
    'The saved ecology must retain every physical stock, identity and ledger field');
  assert.deepEqual(reopened, saved,
    'Finite food stocks and ledger resume exactly from saved bytes');
}

/** The existing restart contract retires unresolved inquiries when the saved
 * witness carries interrupted work. The public observation remains on disk.
 */
export function assertWitnessInquiriesReopen(live, saved, reopened, sourceId) {
  assert.equal(live.length, 2);
  assert.equal(saved.length, live.length);
  assert.equal(reopened.length, live.length);
  assert.deepEqual(saved.map(actor => actor.discovery.inquiries),
    live.map(actor => actor.discovery.inquiries),
    'The saved world must retain each exact player observation');
  let playerWitnesses = 0;
  for (let i = 0; i < saved.length; i++) {
    const witness = saved[i];
    assert.equal(witness.id, live[i].id);
    assert.equal(reopened[i].id, witness.id);
    for (const inquiry of witness.discovery.inquiries) if (inquiry.actorId === 'player') {
      playerWitnesses++;
      assert.equal(inquiry.sourceId, sourceId,
        'A player observation stays bound to its actual remaining portion');
      assert.equal(inquiry.retired, false);
      assert.deepEqual(inquiry.attempts, [],
        'A witnessed player swallow is not an agent self-trial');
    }
    const interrupted = Boolean(witness.interrupted || witness.active);
    const expected = witness.discovery.inquiries.map(inquiry => {
      const completedSample = inquiry.attempts.some(id =>
        witness.discovery.experiments.some(experiment =>
          experiment.id === id && experiment.primitive === 'sample' && experiment.ok));
      return interrupted && !completedSample ?
        { ...inquiry, retired: true, attempts: [] } : inquiry;
    });
    assert.deepEqual(reopened[i].discovery.inquiries, expected,
      'Restart preserves witnessed facts and retires unresolved inquiries after interrupted work');
  }
  assert.ok(playerWitnesses > 0, 'The paid player swallow needs a real witness');
}
