import test from 'node:test';
import assert from 'node:assert/strict';
import { saveFailureMessage } from '../src/save-failure-message.js';

test('save diagnostics expose bounded categories without exception or saved content', () => {
  for (const code of ['untracked-state','stored-value-changed','live-validation','serialization','save-too-large','storage-read','quota-write','storage-write','readback-verification']) {
    assert.match(saveFailureMessage(code), /^World not saved: /);
    assert.match(saveFailureMessage(code), /no automatic reset or cleanup/);
    assert.doesNotMatch(saveFailureMessage(code), /previous.*preserved|world is corrupt/i);
  }
  const secret = 'private journal: arbitrary exception';
  assert.doesNotMatch(saveFailureMessage(secret), /private journal|arbitrary exception/);
  assert.equal(saveFailureMessage(secret), saveFailureMessage(null));
  assert.match(saveFailureMessage('quota-write'), /quota limit.*not verified/);
  assert.match(saveFailureMessage('live-validation'), /live world failed strict save validation/);
});
