import { bindCommunicationMode } from '../src/communication-mode.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderGroundedNames } from '../src/npc-panel.js';
import { createLexicon, recordGrounding, confirmReference, chooseOwnName } from '../src/naming-state.js';
class TextNode {
  constructor() { this.textContent = ''; this.children = []; this.dataset = {}; }
  append(node) { this.children.push(node); }
  get text() { return [this.textContent, ...this.children.map(n => n.text)].join('\n'); }
  set innerHTML(_) { throw new Error('Naming UI must use literal text'); }
}
function freeze(x) { if (x && typeof x === 'object') { Object.values(x).forEach(freeze); Object.freeze(x); } return x; }
const event = (id, at) => ({ messageId: `message:${id}`, at, scene: 'valley', speakerPosition: { x: 0, y: 0 }, listenerPosition: { x: 10, y: 0 }, objectPosition: { x: 20, y: 0 } });
function fixture(confirmed = false) {
  const n = { id: 'mira', seed: 12, elapsed: 50, discovery: { observations: {} } }; bindCommunicationMode(n,'legacy'); n.lexicon = createLexicon(n);
  const binding = recordGrounding(n, 'aster', 'ralumi', 'object:17', event(1, 10)); assert.ok(binding);
  if (confirmed) assert.equal(confirmReference(n, binding, { request: event(2, 20), selection: event(3, 30), confirmation: event(4, 40) }), true);
  return n;
}
function render(n) {
  const old = globalThis.document; globalThis.document = { createElement: () => new TextNode() };
  try { const node = new TextNode(); renderGroundedNames(node, n, [{ id: 'aster', name: 'Aster' }]); return node; }
  finally { if (old === undefined) delete globalThis.document; else globalThis.document = old; }
}
test('selected-agent names distinguish grounded and confirmed reference without restoring sight', () => {
  for (const confirmed of [false, true]) {
    const n = fixture(confirmed), before = structuredClone(n), node = render(freeze(n));
    assert.deepEqual(n, before); assert.match(node.text, /ralumi · object:17/);
    assert.match(node.text, /Personal names, not shared categories or food knowledge/);
    assert.match(node.text, /Sensory record unavailable; the name does not restore sight/);
    assert.match(node.text, confirmed ? /Confirmed reference · I used Aster’s name/ : /Heard and locally grounded · Aster’s name; later reference not confirmed/);
    assert.equal(node.children.find(x => x.dataset.namingObject).dataset.namingStatus, confirmed ? 'confirmed' : 'heard-grounded');
  }
  assert.equal(render({}).text.trim(), '');
});
test('names preserve source-qualified synonyms, literal descriptions and bounded presentation', () => {
  const n = fixture(); n.discovery.observations['object:17'] = { appearance: { shape: '<img onerror=alert(1)>' } };
  for (let i = 2; i <= 12; i++) recordGrounding(n, 'aster', `ralum${String.fromCharCode(97 + i)}`, `object:${i + 20}`, event(i, i));
  const node = render(freeze(n)); assert.equal(node.children.filter(x => x.dataset.namingObject).length, 8);
  assert.match(node.text, /Showing 8 of 12 retained names/);
  const one = fixture(); one.discovery.observations['object:17'] = n.discovery.observations['object:17'];
  assert.match(render(freeze(one)).text, /<img onerror=alert\(1\)>/);
});
test('conflicts outside eight visible rows remain explicit even after historical confirmation', () => {
  const n = fixture(true);
  for (let i = 5; i < 14; i++) recordGrounding(n, 'aster', `nopa${String.fromCharCode(97 + i)}`, `object:${100 + i}`, event(i, i + 30));
  assert.ok(recordGrounding(n, 'aster', 'ralumi', 'object:99', event(15, 49)));
  const node = render(freeze(n));
  assert.match(node.text, /Conflicting referents for this speaker’s word; reference is currently ambiguous/);
  assert.equal(node.children.some(x => x.dataset.namingObject === 'object:17'), false);
});

test('owner-chosen names remain separate from peer-grounded or confirmed names', () => {
  const n = { id: 'mira', seed: 12, elapsed: 10, scene: 'valley', position: { x: 0, y: 0 }, memory: { experience: [] }, discovery: { observations: {}, experiments: [] } };
  bindCommunicationMode(n,'legacy');
  let own;
  for (let i = 1; i <= 4 && !own; i++) {
    n.elapsed = 10 + i;
    const e = { id: i, actionId: i, at: n.elapsed, durationSeconds: 1.8, primitive: 'inspect_object', targetId: 'object:19', ok: true, code: 'OBJECT_OBSERVED' };
    n.discovery.experiments.push(e);
    n.memory.experience.push({ id: i, at: n.elapsed, type: 'action', details: { action: { type: e.primitive, targetId: e.targetId }, result: { ok: true, code: e.code, durationSeconds: 1.8, handling: { source: 'experienced', activeActionSeconds: 1.8, effort: 'rising' } } } });
    own = chooseOwnName(n, e, { objectId: e.targetId, at: n.elapsed, scene: 'valley', actorPosition: { x: 0, y: 0 }, objectPosition: { x: 20, y: 0 } });
  }
  assert.ok(own); const node = render(freeze(n));
  assert.match(node.text, /Chosen by me after my own encounter/);
  assert.doesNotMatch(node.text, /Heard and locally grounded|Confirmed reference/);
  assert.equal(node.children.find(x => x.dataset.namingObject).dataset.namingStatus, 'owner-chosen');
});
