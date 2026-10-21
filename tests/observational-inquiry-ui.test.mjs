import test from 'node:test';
import assert from 'node:assert/strict';
import { renderObservationalInquiries } from '../src/npc-panel.js';

class TextNode {
  constructor(tag) { this.tag = tag; this.textContent = ''; this.children = []; this.dataset = {}; }
  append(node) { this.children.push(node); }
  get text() { return [this.textContent, ...this.children.map(n => n.text)].join('\n'); }
  set innerHTML(_) { throw new Error('Inquiry rendering must use text, not HTML'); }
}
function fixture({ attempts = [], effects = [], retired = false } = {}) {
  return { elapsed: 1, discovery: {
    inquiries: [{ sourceId: 'object:1', actorId: 'aster', at: 1, attempts: attempts.map(a => a.id), retired }],
    observations: { 'object:1': { appearance: { color: 'red', shape: 'round' } } },
    experiments: attempts, effects, techniques: [],
  } };
}
function render(npc, agents = [{ id: 'aster', name: 'Aster' }]) {
  const previous = globalThis.document;
  globalThis.document = { createElement: tag => new TextNode(tag) };
  try { const node = new TextNode('div'); renderObservationalInquiries(node, npc, agents); return node; }
  finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
}
const acquire = { id: 1, primitive: 'pull', targetId: 'object:1', materialId: 'object:2', ok: true, code: 'PULLED' };
const sample = { id: 2, primitive: 'sample', targetId: 'object:2', ok: true, code: 'SAMPLED', actionId: 'action:2', ingestionId: 'ingestion:2' };
const effect = effect => ({ effect, objectId: 'object:2', actionId: sample.actionId, ingestionId: sample.ingestionId });

test('inquiry panel separates a witness from own tests without mutating state', () => {
  const npc = fixture(), before = structuredClone(npc), node = render(npc);
  assert.match(node.text, /Witnessed Aster consume/);
  assert.match(node.text, /Observation alone does not establish benefit/);
  assert.match(node.text, /No own experiment retained/);
  assert.match(node.text, /A test can wait for bodily care or access/);
  assert.match(node.text, /Could a small sample from this exact source ease my hunger\?/);
  assert.doesNotMatch(node.text, /calories|kcal|species|proficiency/i);
  assert.deepEqual(npc, before);
  assert.equal(render({}).text.trim(), '');
});

test('failed acquisition is unavailable, not contradicted food benefit', () => {
  const attempts = ['grasp', 'pull'].map((primitive, i) => ({ id: i + 1, primitive, ok: false, code: 'OUT_OF_REACH' }));
  const node = render(fixture({ attempts }));
  assert.match(node.text, /Procedure unavailable · food benefit remains untested/);
  assert.match(node.text, /Own experiment: Grasp · attempt failed/);
  assert.match(node.text, /A failed physical attempt does not contradict food benefit/);
  assert.doesNotMatch(node.text, /Own adverse bodily feedback/);
});

test('own sample waits for matching feedback and adverse feedback remains explicit', () => {
  const attempts = [acquire, sample];
  assert.match(render(fixture({ attempts })).text, /awaiting bodily feedback/);
  assert.match(render(fixture({ attempts, effects: [effect('sustained')] })).text, /benefit supported by own bodily feedback/);
  assert.match(render(fixture({ attempts, effects: [effect('sustained'), effect('discomfort')] })).text, /Own adverse bodily feedback · do not assume this is beneficial or safe/);
  assert.match(render(fixture({ attempts, effects: [effect('refreshing')] })).text, /did not establish hunger benefit/);
  assert.match(render(fixture({ retired: true })).text, /Older evidence retired/);
});

test('panel renders untrusted names and descriptions only as literal text', () => {
  const npc = fixture();
  npc.discovery.observations['object:1'].appearance.color = '<img src=x onerror=alert(1)>';
  const node = render(npc, [{ id: 'aster', name: '<script>alert(1)</script>' }]);
  assert.match(node.text, /<script>alert\(1\)<\/script>/);
  assert.match(node.text, /<img src=x onerror=alert\(1\)>/);
  assert.ok(node.children.every(n => ['p', 'div'].includes(n.tag)));
});

test('four bounded rows prioritize pending questions without changing historical order', () => {
  const npc = fixture();
  npc.discovery.inquiries = Array.from({ length: 16 }, (_, i) => ({ ...npc.discovery.inquiries[0], sourceId: `object:${i + 1}`, retired: i !== 0 }));
  const before = structuredClone(npc), node = render(npc);
  const entries = node.children.filter(n => n.dataset.inquirySource);
  assert.equal(entries.length, 4);
  assert.equal(entries[0].dataset.inquirySource, 'object:1');
  assert.match(node.text, /Showing 4 of 16 retained questions/);
  assert.deepEqual(npc, before);
});


test('expired and prior-adverse questions explain why another test is not pending', () => {
  const expired = fixture(); expired.elapsed = 302;
  const expiredNode = render(expired);
  assert.match(expiredNode.text, /Experiment window elapsed · no conclusion about food benefit/);
  assert.doesNotMatch(expiredNode.text, /A test can wait/);
  assert.equal(expiredNode.children.find(n => n.dataset.inquirySource).dataset.inquiryStatus, 'expired');
  const adverse = fixture();
  adverse.discovery.techniques.push({ sourceId: 'object:1', confidence: 'revised' });
  const before = structuredClone(adverse), node = render(adverse);
  assert.match(node.text, /Earlier own adverse experience with this source prevents a new observation-led test/);
  assert.doesNotMatch(node.text, /A test can wait/);
  assert.deepEqual(adverse, before);
});
