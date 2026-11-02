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
