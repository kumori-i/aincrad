import { legacyFixture } from './fixtures/legacy-communication.mjs';
const historicalClone=value=>legacyFixture(globalThis.structuredClone(value));
const createNpc=(...args)=>legacyFixture(rawcreateNpc(...args));
const validateNpc=(...args)=>legacyFixture(rawvalidateNpc(...args));
const createOzarkState=(...args)=>legacyFixture(rawcreateOzarkState(...args));
const loadOzarkSave=(...args)=>legacyFixture(rawloadOzarkSave(...args));
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { createNpc as rawcreateNpc } from '../src/npc-state.js';
import { validateNpc as rawvalidateNpc } from '../src/npc-memory.js';
import { observeNpc, requestNpcAction, tickNpc } from '../src/npc.js';
import { discoveryDecision, processDiscoveryFeedback, recordDiscoveryReport,
  rememberDirectDiscoveryObject } from '../src/discovery.js';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { bindOzarkWorldAgent } from '../src/ozark-agent-world.js';
import { bindOzarkEcology, tickOzarkEcology } from '../src/ozark-ecology.js';
import { tickEnvironment } from '../src/environment.js';
import { OZARK_SAVE_KEY, createOzarkState as rawcreateOzarkState, loadOzarkSave as rawloadOzarkSave,
  writeOzarkSave } from '../src/ozark-save.js';
import { retainedProofIntegrityError } from '../src/proof-retention.js';

const clone = historicalClone;
const geometry = createOzarkWorldGeometry();
const unsupportedPlan = 'get close to the object, strike it repeatedly then gather the resulting object and eat it';

// Synthetic sensory records exercise only the grammar and binding boundary.
// They are not evidence of physical acquisition, practice or nourishment.
function grammarFixture() {
  const n = createNpc({ id: 'aster', mode: 'discovery', seed: 74193 });
  rememberDirectDiscoveryObject(n, {
    id: 'object:11', scene: n.scene, position: { ...n.position },
    appearance: { shape: 'round clusters', color: 'red', texture: 'rough' },
  });
  return n;
}

function report(n, text) {
  return recordDiscoveryReport(n, text, { sourceId: 'human', channel: 'journal' });
}

function assertInert(r, text, code) {
  assert.ok(r, 'testimony must remain available rather than disappearing');
  assert.equal(r.text, text.slice(0, 600));
  assert.deepEqual(r.hint, { version: 1, code });
  assert.deepEqual(r.proposed, []);
  assert.equal(r.cursor, 0);
  assert.deepEqual(r.evidence, []);
  assert.equal(r.status, 'unverified');
}

function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value) };
}

// Fixed local exposure uses an existing finite tree and actual shared physics.
// It does not claim autonomous travel, hunting or a general food strategy.
function worldFixture() {
  const state = createOzarkState(geometry), n = state.agents[0], e = state.environment;
  const source = e.ecology.plants.find(p => p.kind === 'apple_tree' && p.quantity > 2 &&
    geometry.canOccupy(p.position.x + 45, p.position.y, CONFIG.playerRadius) &&
    geometry.lineOfSight({ x: p.position.x + 45, y: p.position.y }, p.position));
  assert.ok(source);
  state.elapsed = e.elapsed = e.ecology.elapsed = 60;
  for (const actor of state.agents) actor.elapsed = 60;
  n.position = { x: source.position.x + 45, y: source.position.y };
  bindOzarkEcology(e.ecology, geometry);
  for (const actor of state.agents) bindOzarkWorldAgent(actor, geometry, state);
  observeNpc(n, e);
  assert.ok(n.discovery.observations[source.id]);
  function advance(seconds) {
    for (let left = seconds; left > 1e-8;) {
      const dt = Math.min(.1, left);
      tickEnvironment(e, dt); state.elapsed = e.elapsed;
      tickOzarkEcology(e.ecology, dt, e, state.agents, {}, geometry);
      for (const actor of state.agents) { tickNpc(actor, dt, e); processDiscoveryFeedback(actor); }
      left -= dt;
    }
  }
  function finish(action) {
    const started = requestNpcAction(n, action, e);
    if (started.code === 'ACTION_STARTED') {
      for (let i = 0; n.active && i < 500; i++) advance(.1);
      assert.equal(n.active, null, 'the paid action must really finish');
      return n.lastResult;
    }
    return started;
  }
  return { state, n, e, source, advance, finish, disk: storage() };
}

test('the complete requested hunting plan is retained but never reduced to a partial executable hint', () => {
  for (const text of [unsupportedPlan, unsupportedPlan.replace('the object', 'object:11')]) {
    const n = grammarFixture(), before = clone(n.discovery.observations);
    assertInert(report(n, text), text, 'unsupported');
    assert.deepEqual(n.discovery.observations, before);
    assert.deepEqual(n.discovery.experiments, []);
    assert.deepEqual(n.discovery.techniques, []);
    assert.deepEqual(n.discovery.effects, []);
    assert.deepEqual(n.discovery.practice, {});
    assert.equal(n.stats.independentMeals, 0);
  }
});

test('unsupported clauses, conditions, negation, repetition and result references reject the whole message', () => {
  const cases = [
    'get close to object:11 then strike it',
    'pull object:11 then cook it and eat it',
    'pull object:11 then eat it if it is safe',
    'if you are hungry, pull object:11 and eat it',
    'do not pull object:11',
    "don't pull object:11 then eat it",
    'pull object:11 and do not eat it',
    'strike object:11 repeatedly then eat it',
    'strike object:11 twice',
    'strike object:11 until it stops moving',
    'strike object:11 then pull the resulting object and eat it',
    'pull object:11 then eat the result',
    'pull object:11 because it is food',
    'pull object:11; eat it',
    'pull object:11 or eat it',
    'pull object:11 and',
    'pull object:11 then',
  ];
  for (const text of cases) assertInert(report(grammarFixture(), text), text, 'unsupported');
});

test('explicit single-target clauses accept bounded synonyms, polite wrappers and supported separators', () => {
  const cases = [
    ['pull object:11 then eat it', ['pull', 'sample']],
    ['inspect object:11 then strike object:11', ['inspect_object', 'strike']],
    ['Please pull object:11, then sample it.', ['pull', 'sample']],
    ['Can you pick up object:11 and drop it?', ['grasp', 'release']],
    ['Could you inspect object:11 and then taste it?', ['inspect_object', 'sample']],
    ['Would you look at object:11, hit it!', ['inspect_object', 'strike']],
    ['pluck object:11 and bite it', ['pull', 'sample']],
    ['take object:11 then release it', ['grasp', 'release']],
    ['kill object:11', ['strike']],
    ['inspect_object object:11', ['inspect_object']],
  ];
  for (const [text, types] of cases) {
    const n = grammarFixture(), r = report(n, text);
    assert.equal(r.text, text);
    assert.deepEqual(r.hint, { version: 1, code: 'accepted' }, text);
    assert.deepEqual(r.proposed, types.map(type => ({ type, targetId: 'object:11' })), text);
    assert.equal(r.status, 'unverified');
    assert.deepEqual(r.evidence, []);
    assert.deepEqual(n.discovery.practice, {});
    assert.deepEqual(n.discovery.techniques, []);
  }
});

test('six complete clauses are accepted but a seventh is not silently truncated', () => {
  const six = 'inspect object:11 then strike it then inspect it then pull it then sample it then release it';
  const r = report(grammarFixture(), six);
  assert.equal(r.hint.code, 'accepted');
  assert.equal(r.proposed.length, 6);
  const seven = `${six} then sample it`;
  assertInert(report(grammarFixture(), seven), seven, 'unsupported');
});

test('long input is checked before the retained text limit can hide an unsupported suffix', () => {
  const prefix = 'pull object:11';
  const text = `${prefix}${' '.repeat(600 - prefix.length)} then cook it`;
  assert.equal(text.slice(0, 600).trim(), prefix);
  assertInert(report(grammarFixture(), text), text, 'too_long');
});

test('target binding needs one observed identity or one uniquely matching permitted visual description', () => {
  const n = grammarFixture();
  const r = report(n, 'Pick the red fruit and eat it');
  assert.equal(r.hint.code, 'accepted');
  assert.deepEqual(r.proposed, [{ type: 'pull', targetId: 'object:11' },
    { type: 'sample', targetId: 'object:11' }]);
  const unknown = 'pull object:999999';
  assertInert(report(grammarFixture(), unknown), unknown, 'unresolved');
  const ambiguous = grammarFixture();
  rememberDirectDiscoveryObject(ambiguous, { ...clone(ambiguous.discovery.observations['object:11']),
    id: 'object:22' });
  assertInert(report(ambiguous, 'pull the red fruit'), 'pull the red fruit', 'unresolved');
  for (const text of ['pull object:11 then eat object:22', 'pull object:11 and object:22']) {
    assertInert(report(ambiguous, text), text, 'unsupported');
  }
});

test('pronouns can use only the actor own observed-target question, never a peer question or unknown ID', () => {
  for (const phrase of ['pull it', 'pull that', 'pull this', 'pull the object']) {
    const n = grammarFixture();
    assertInert(report(n, phrase), phrase, 'unresolved');
    n.social.heard = [{ senderId: 'mira', kind: 'question', text: 'What could I try with object:11?' }];
    assertInert(report(n, phrase), phrase, 'unresolved');
    n.social.heard = [{ senderId: n.id, kind: 'question', text: 'What could I try with object:11?' }];
    const r = report(n, phrase);
    assert.equal(r.hint.code, 'accepted', phrase);
    assert.deepEqual(r.proposed, [{ type: 'pull', targetId: 'object:11' }]);
    n.social.heard = [{ senderId: n.id, kind: 'question', text: 'What could I try with object:999999?' }];
    assertInert(report(n, phrase), phrase, 'unresolved');
  }
});

test('leading pronouns cannot borrow a target named only by a later clause', () => {
  const text = 'inspect it then strike object:11', n = grammarFixture();
  assertInert(report(n, text), text, 'unresolved');
  n.social.heard = [{ senderId: 'mira', kind: 'question', text: 'What could I try with object:11?' }];
  assertInert(report(n, text), text, 'unresolved');
  n.social.heard = [{ senderId: n.id, kind: 'question', text: 'What could I try with object:11?' }];
  const r = report(n, text);
  assert.equal(r.hint.code, 'accepted');
  assert.deepEqual(r.proposed, [{ type: 'inspect_object', targetId: 'object:11' },
    { type: 'strike', targetId: 'object:11' }]);
  rememberDirectDiscoveryObject(n, { ...clone(n.discovery.observations['object:11']), id: 'object:22' });
  n.social.heard = [{ senderId: n.id, kind: 'question', text: 'What could I try with object:22?' }];
  assertInert(report(n, text), text, 'unsupported');
});

test('post-pull steps cannot silently change an explicit source identity into acquired material', () => {
  const cases = [
    'pull object:11 then eat object:11',
    'pull object:11 then release object:11',
    'pull object:11 then eat the red fruit',
    'pull object:11 then pull it',
    'pull object:11 then strike it',
    'pull object:11 then grasp it',
    'pull object:11 then inspect it',
    'pull object:11 then eat it then pull it',
    'pull object:11 then eat it then strike object:11',
  ];
  for (const text of cases) assertInert(report(grammarFixture(), text), text, 'unsupported');
  const n = grammarFixture(), r = report(n, 'pull object:11 then eat it then release it');
  assert.equal(r.hint.code, 'accepted');
  assert.deepEqual(r.proposed, ['pull', 'sample', 'release'].map(type => ({ type, targetId: 'object:11' })));
});

test('a paid pull retargets accepted eat to the actual new material without words granting proof', () => {
  const f = worldFixture(), { n, source } = f;
  const r = report(n, `pull ${source.id} then eat it`), quantity = source.quantity;
  assert.equal(r.hint.code, 'accepted');
  assert.equal(r.status, 'unverified');
  assert.deepEqual(n.discovery.techniques, []);
  assert.deepEqual(n.discovery.effects, []);
  const decision = discoveryDecision(n), before = n.elapsed;
  const metabolism = n.physiology.totals.metabolizedKcal;
  assert.deepEqual(decision.action, { type: 'pull', targetId: source.id });
  assert.equal(f.finish(decision.action).ok, true);
  assert.ok(n.elapsed - before >= 4.9);
  assert.ok(n.physiology.totals.metabolizedKcal > metabolism);
  assert.equal(source.quantity, quantity - 1);
  const materialId = n.inventory.items[0];
  assert.ok(materialId);
  assert.notEqual(materialId, source.id);
  assert.equal(r.cursor, 1);
  assert.deepEqual(r.proposed[1], { type: 'sample', targetId: materialId });
  assert.deepEqual(discoveryDecision(n).action, r.proposed[1]);
  assert.equal(n.discovery.techniques.length, 0);
  assert.equal(f.finish(r.proposed[1]).ok, true);
  assert.equal(r.status, 'unverified');
  f.advance(90);
  assert.equal(r.status, 'supported');
  assert.equal(n.stats.independentMeals, 1);
  assert.equal(n.discovery.techniques.length, 1);
  assert.equal(retainedProofIntegrityError(n), null);
  assert.equal(writeOzarkSave(f.disk, f.state, geometry), true);
  const reopened = loadOzarkSave(f.disk, geometry);
  assert.equal(reopened.blocked, false, reopened.error);
  const restored = reopened.state.agents[0].discovery.reports.find(row => row.id === r.id);
  assert.equal(restored.text, r.text);
  assert.equal(restored.hint.code, 'restart');
  assert.deepEqual(restored.proposed, []);
  assert.deepEqual(restored.evidence, r.evidence);
  assert.equal(restored.status, 'supported');
});

test('writing a new hint leaves live execution unchanged but persisted and reopened testimony is inert', () => {
  const f = worldFixture(), r = report(f.n, `pull ${f.source.id} then eat it`);
  const live = clone(r);
  assert.equal(writeOzarkSave(f.disk, f.state, geometry), true);
  assert.deepEqual(r, live, 'saving cannot edit the running actor report');
  const stored = JSON.parse(f.disk.getItem(OZARK_SAVE_KEY)).agents[0].discovery.reports[0];
  assert.equal(stored.text, live.text);
  assert.equal(stored.hint.code, 'restart');
  assert.deepEqual(stored.proposed, []);
  const reopened = loadOzarkSave(f.disk, geometry);
  assert.equal(reopened.blocked, false, reopened.error);
  const restored = reopened.state.agents[0];
  bindOzarkWorldAgent(restored, geometry, reopened.state);
  observeNpc(restored, reopened.state.environment);
  assert.deepEqual(restored.discovery.reports[0].proposed, []);
  assert.equal(restored.discovery.reports[0].cursor, 0);
  assert.doesNotMatch(discoveryDecision(restored).reason, /reported method|suggested by a human/);
});

test('legacy saved partial plans never regain execution authority through restoration or another save', () => {
  const f = worldFixture(), text = unsupportedPlan.replace('the object', f.source.id);
  const r = report(f.n, text);
  // Simulate the old extractor's persisted output, not an authorized live hint.
  delete r.hint;
  r.proposed = [{ type: 'strike', targetId: f.source.id }, { type: 'sample', targetId: f.source.id }];
  const direct = validateNpc(clone(f.n), { canStandAt: (x, y) => geometry.canOccupy(x, y, CONFIG.playerRadius) });
  assertInert(direct.discovery.reports[0], text, 'legacy');
  assert.equal(writeOzarkSave(f.disk, f.state, geometry), true);
  // Also load the actual old disk shape. Testing only the new writer would
  // miss old pre-fix proposals that have not yet been canonicalized.
  const oldDisk = JSON.parse(f.disk.getItem(OZARK_SAVE_KEY));
  oldDisk.agents[0].discovery.reports = [clone(r)];
  f.disk.setItem(OZARK_SAVE_KEY, JSON.stringify(oldDisk));
  const reopened = loadOzarkSave(f.disk, geometry);
  assert.equal(reopened.blocked, false, reopened.error);
  assertInert(reopened.state.agents[0].discovery.reports[0], text, 'legacy');
  assert.equal(writeOzarkSave(f.disk, reopened.state, geometry), true);
  const second = loadOzarkSave(f.disk, geometry);
  assert.equal(second.blocked, false, second.error);
  assertInert(second.state.agents[0].discovery.reports[0], text, 'legacy');
});

test('unsupported and unresolved testimony retain their rejection reason across current-save round trips', () => {
  const f = worldFixture();
  const rejected = report(f.n, unsupportedPlan.replace('the object', f.source.id));
  const unresolved = report(f.n, 'pull object:999999');
  const tooLong = report(f.n, `${' '.repeat(600)}pull ${f.source.id}`);
  assert.equal(writeOzarkSave(f.disk, f.state, geometry), true);
  const opened = loadOzarkSave(f.disk, geometry);
  assert.equal(opened.blocked, false, opened.error);
  for (const original of [rejected, unresolved, tooLong]) {
    const restored = opened.state.agents[0].discovery.reports.find(r => r.id === original.id);
    assertInert(restored, original.text, original.hint.code);
  }
});

test('malformed optional hint metadata protects current bytes rather than resetting the world', () => {
  const f=worldFixture();report(f.n,`pull ${f.source.id} then eat it`);
  assert.equal(writeOzarkSave(f.disk,f.state,geometry),true);
  const original=JSON.parse(f.disk.getItem(OZARK_SAVE_KEY));
  for(const hint of [{version:2,code:'accepted'},{version:1,code:'execute'},{version:1,code:'accepted',script:'pull'},null]){
    const raw=clone(original);raw.agents[0].discovery.reports[0].hint=hint;
    const bytes=JSON.stringify(raw);f.disk.setItem(OZARK_SAVE_KEY,bytes);
    const opened=loadOzarkSave(f.disk,geometry);
    assert.equal(opened.blocked,true);assert.match(opened.error,/invalid human hint metadata/);
    assert.equal(f.disk.getItem(OZARK_SAVE_KEY),bytes);
  }
});
