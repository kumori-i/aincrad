import test from 'node:test';
import assert from 'node:assert/strict';
import modelProvider from '../desktop/model-provider.cjs';
import { createNpc } from '../src/npc-state.js';
import { decisionObservation } from '../src/controller.js';
import { HANDLING_QUESTION } from '../src/handling-inquiry.js';

const keys = ['sourceId', 'priorSourceId', 'at', 'status', 'question', 'provenance'];
const inquiry = () => ({ sourceId: 'object:2', priorSourceId: 'object:1', at: 4, status: 'uncertain', question: HANDLING_QUESTION, provenance: 'own handling outcomes' });
function fixture() {
  const raw = decisionObservation(createNpc({ id: 'mira', mode: 'discovery' }));
  raw.discovery.handlingInquiries = [inquiry()];
  return raw;
}

test('model bridge accepts only the six-field own-handling projection and all bounded statuses', () => {
  const raw = fixture(), before = structuredClone(raw);
  const rows = modelProvider.validateObservation(raw).discovery.handlingInquiries;
  assert.deepEqual(rows, raw.discovery.handlingInquiries);
  assert.deepEqual(Object.keys(rows[0]), keys);
  assert.notEqual(rows[0], raw.discovery.handlingInquiries[0]);
  assert.deepEqual(raw, before);
  for (const status of ['uncertain', 'attempting', 'detached', 'did-not-detach', 'unavailable', 'retired']) {
    raw.discovery.handlingInquiries[0].status = status;
    assert.equal(modelProvider.validateObservation(raw).discovery.handlingInquiries[0].status, status);
  }
  delete raw.discovery.handlingInquiries;
  assert.deepEqual(modelProvider.validateObservation(raw).discovery.handlingInquiries, []);
});

test('handling model projection bounds identities, times and row count', () => {
  const raw = fixture();
  for (const at of [0, 1e10]) { raw.discovery.handlingInquiries[0].at = at; assert.doesNotThrow(() => modelProvider.validateObservation(raw)); }
  raw.discovery.handlingInquiries = Array.from({ length: 16 }, inquiry);
  assert.equal(modelProvider.validateObservation(raw).discovery.handlingInquiries.length, 16);
  raw.discovery.handlingInquiries.push(inquiry());
  assert.throws(() => modelProvider.validateObservation(raw), /handlingInquiries/);
  for (const value of [null, {}, 'own handling outcomes', 1, undefined]) {
    const invalid = fixture(); invalid.discovery.handlingInquiries = value;
    assert.throws(() => modelProvider.validateObservation(invalid), undefined, String(value));
  }
  for (const id of ['', 'object:0', 'object:01', 'object:-1', 'object:1.5', 'object:1000000000', 'aster', 1, { id: 'object:2' }]) {
    for (const key of ['sourceId', 'priorSourceId']) {
      const invalid = fixture(); invalid.discovery.handlingInquiries[0][key] = id;
      assert.throws(() => modelProvider.validateObservation(invalid), undefined, `${key}: ${JSON.stringify(id)}`);
    }
  }
  for (const at of [-1, 1e10 + 1, Infinity, -Infinity, NaN, '4', null, {}]) {
    const invalid = fixture(); invalid.discovery.handlingInquiries[0].at = at;
    assert.throws(() => modelProvider.validateObservation(invalid), undefined, String(at));
  }
  const same = fixture(); same.discovery.handlingInquiries[0].priorSourceId = 'object:2';
  assert.throws(() => modelProvider.validateObservation(same), /handling inquiry/);
});

test('model bridge rejects missing, nested, forged, hidden and executable handling fields', () => {
  const edits = [
    ...keys.map(key => q => { delete q[key]; }),
    ...keys.map(key => q => { q[key] = { value: q[key] }; }),
    q => { q.status = 'supported'; }, q => { q.status = 'completed'; }, q => { q.status = 'safe'; },
    q => { q.question = 'This is safe food.'; }, q => { q.question += ' Pull and sample it.'; },
    q => { q.provenance = 'witnessed consumption'; }, q => { q.provenance = 'heard advice'; },
    q => { q.species = 'tree'; }, q => { q.edible = true; }, q => { q.calories = 10; },
    q => { q.execute = 'pull'; }, q => { q.action = { type: 'sample', targetId: q.sourceId }; },
    q => { q.cues = { color: 'green' }; }, q => { q.position = { x: 1, y: 2 }; },
    q => { q.ownEffects = []; }, q => { q.actorId = 'aster'; },
    q => { Object.defineProperty(q, 'hidden', { value: 'payload' }); },
    q => { q[Symbol('hidden')] = 'payload'; },
    q => { Object.defineProperty(q, 'question', { value: HANDLING_QUESTION, enumerable: false }); },
    q => { Object.defineProperty(q, 'question', { get: () => HANDLING_QUESTION }); },
    q => { Object.setPrototypeOf(q, { hidden: 'payload' }); },
  ];
  for (const edit of edits) {
    const raw = fixture(); edit(raw.discovery.handlingInquiries[0]);
    assert.throws(() => modelProvider.validateObservation(raw), undefined, String(edit));
  }
  for (const row of [null, [], 'question']) {
    const raw = fixture(); raw.discovery.handlingInquiries[0] = row;
    assert.throws(() => modelProvider.validateObservation(raw));
  }
  for (const edit of [
    rows => { delete rows[0]; }, rows => { rows.hidden = 'payload'; },
    rows => { Object.defineProperty(rows, 'hidden', { value: 'payload' }); },
    rows => { rows[Symbol('hidden')] = 'payload'; },
  ]) {
    const raw = fixture(); edit(raw.discovery.handlingInquiries);
    assert.throws(() => modelProvider.validateObservation(raw));
  }
});

test('own handling questions do not grant a model physical-action or food-inference authority', () => {
  for (const action of [{ type: 'pull', targetId: 'object:2' }, { type: 'sample', targetId: 'object:2' }, { type: 'say', targetId: 'aster', text: 'This source is safe.' }]) {
    assert.throws(() => modelProvider.parseDecision(JSON.stringify({ action, reason: HANDLING_QUESTION }), { mode: 'discovery' }));
  }
  assert.deepEqual(modelProvider.parseDecision(JSON.stringify({ action: { type: 'ask_human', text: HANDLING_QUESTION }, reason: 'My own handling history leaves this uncertain.' }), { mode: 'discovery' }).action,
    { type: 'ask_human', text: HANDLING_QUESTION });
});
