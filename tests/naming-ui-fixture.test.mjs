import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createNamingUiFixture, continueNamingUiFixture, verifyInterruptedNamingUiFixture } from '../scripts/naming-ui-fixture.mjs';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { loadOzarkSave, writeOzarkSave } from '../src/ozark-save.js';
import { lexicalLabels } from '../src/naming-state.js';
const base = new URL('../', import.meta.url);
let fixturePromise;
const fixture = () => fixturePromise ??= createNamingUiFixture(base);
const storageFor = f => { const m = new Map([[f.saveKey, f.raw]]); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
test('staged naming native fixture uses paid encounter, local grounding and separate later reference', async () => {
  const f = await fixture(), storage = storageFor(f), geometry = createOzarkWorldGeometry();
  assert.equal(f.summary.status, 'heard-grounded'); assert.ok(f.summary.inspections >= 1 && f.summary.inspections <= 4);
  assert.ok(f.summary.after.elapsed > f.summary.before.elapsed); assert.ok(f.summary.after.energy > f.summary.before.energy);
  const loaded = loadOzarkSave(storage, geometry); assert.equal(loaded.blocked, false, loaded.error);
  const listener = loaded.state.agents.find(n => n.id === f.summary.actorId);
  assert.equal(lexicalLabels(listener)[0].status, 'heard-grounded');
  const completed = await continueNamingUiFixture(base, storage);
  assert.equal(completed.summary.status, 'confirmed'); assert.equal(completed.summary.pendingAtClose, 0);
  const reopened = loadOzarkSave(storage, geometry); assert.equal(reopened.blocked, false, reopened.error);
  const heard = reopened.state.agents.find(n => n.id === f.summary.actorId).lexicon.heard[0];
  assert.ok(heard.grounding.at < heard.confirmation.request.at);
  assert.ok(heard.confirmation.request.at < heard.confirmation.selection.at);
  assert.ok(heard.confirmation.selection.at < heard.confirmation.confirmation.at);
  assert.equal(writeOzarkSave(storage, reopened.state, geometry), true);
});
test('native pending naming checkpoint does not confirm or replay on restart with fresh sight', async () => {
  const f = await fixture(), storage = storageFor(f);
  const interrupted = await continueNamingUiFixture(base, storage, 'interrupt');
  assert.equal(interrupted.summary.status, 'heard-grounded'); assert.ok(interrupted.summary.pendingAtClose > 0);
  const bytes = storage.getItem(f.saveKey), verified = await verifyInterruptedNamingUiFixture(base, storage);
  assert.equal(verified.noReplayAfterFreshSight, true); assert.equal(verified.confirmedCount, 0);
  assert.equal(storage.getItem(f.saveKey), bytes);
});
test('naming phases retain existing isolated sandboxed native coverage', () => {
  const source = readFileSync(new URL('../scripts/verify-aquatic-desktop.mjs', import.meta.url), 'utf8');
  for (const phrase of ['naming-write', 'naming-reopen', 'naming-confirmed-reopen', 'naming-interrupted-write', 'naming-interrupted-reopen',
    'naming-grounded.png', 'naming-confirmed.png', 'naming-interrupted.png', 'naming-result.json', 'verifyInterruptedNamingUiFixture',
    'prefs.sandbox,true', 'handling-completed-reopen', 'method-tested-reopen', 'social-reopen']) assert.ok(source.includes(phrase), phrase);
});
