import test from 'node:test';
import assert from 'node:assert/strict';
import { renderHandlingInquiries, renderObservationalInquiries } from '../src/npc-panel.js';
import { HANDLING_QUESTION } from '../src/handling-inquiry.js';

class TextNode {
  constructor(tag) { this.tag = tag; this.textContent = ''; this.children = []; this.dataset = {}; }
  append(node) { this.children.push(node); }
  get text() { return [this.textContent, ...this.children.map(n => n.text)].join('\n'); }
  set innerHTML(_) { throw new Error('Handling inquiry rendering must use literal text'); }
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function fixture(state = 'pending', outcome = 'piece_detached') {
  const experiments = [
    { id: 1, actionId: 1, at: 5, durationSeconds: 5, primitive: 'pull', targetId: 'object:1', ok: true, code: 'piece_detached', materialId: 'object:11' },
    { id: 2, actionId: 2, at: 7.5, durationSeconds: 2.5, primitive: 'grasp', targetId: 'object:2', ok: false, code: 'object_still_attached' },
  ];
  if (state === 'completed') experiments.push({ id: 3, actionId: 3, at: 12.5, durationSeconds: 5, primitive: 'pull', targetId: 'object:2', ok: outcome === 'piece_detached', code: outcome, ...(outcome === 'piece_detached' ? { materialId: 'object:12' } : {}) });
  return { id: 'mira', elapsed: 15, memory: { experience: experiments.map(e => ({ id: e.actionId, at: e.at, type: 'action', details: {
    action: { type: e.primitive, targetId: e.targetId },
    result: { ok: e.ok, code: e.code, durationSeconds: e.durationSeconds, ...(e.materialId ? { materialId: e.materialId } : {}), handling: { source: 'experienced', activeActionSeconds: e.durationSeconds, effort: 'rising' } },
  } })) }, discovery: {
    handlingQuestions: [{ actorId: 'mira', sourceId: 'object:2', priorSourceId: 'object:1', at: 7.5,
      cues: { color: 'brown', shape: 'branching', texture: 'rough' }, state,
      failedId: state === 'retired' ? null : 2, priorId: state === 'retired' ? null : 1, attemptId: state === 'completed' ? 3 : null }],
    handlingAdmissions: ['object:2'],
    observations: { 'object:1': { appearance: { color: 'brown', shape: 'branching' } }, 'object:2': { appearance: { color: 'green', shape: 'branching' } } },
    experiments, effects: [], techniques: [], inquiries: [],
  } };
}
function render(npc, { witnessed = false } = {}) {
  const previous = globalThis.document;
  globalThis.document = { createElement: tag => new TextNode(tag) };
  try {
    const node = new TextNode('div');
    if (witnessed) renderObservationalInquiries(node, npc, [{ id: 'aster', name: 'Aster' }]);
    renderHandlingInquiries(node, npc);
    return node;
  } finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
}

test('own handling panel reads frozen state without selecting actions or implying food proof', () => {
  const npc = fixture(), before = structuredClone(npc), node = render(freeze(npc));
  assert.ok(node.text.includes(HANDLING_QUESTION));
  for (const phrase of ['Own handling questions', 'Own prior motor result', 'not witnessed consumption or heard advice',
    'Similar appearance is uncertain', 'does not establish safety, food benefit or a shared category', 'No sampling is implied', 'pulling this source is not yet tested']) assert.ok(node.text.includes(phrase), phrase);
  assert.deepEqual(npc, before);
  assert.equal(render({}).text.trim(), '');
  assert.doesNotMatch(node.text, /calories|kcal|species|proficiency|supported by own bodily feedback/i);
  assert.equal(node.children.find(n => n.dataset.handlingInquirySource).dataset.handlingInquiryStatus, 'uncertain');
  assert.ok(node.text.includes('Current source (object:2)'));
  assert.ok(node.text.includes('Remembered source (object:1)'));
});

test('handling statuses describe actual motor results and never promote detachment to a meal', () => {
  for (const [state, outcome, status, phrase] of [
    ['attempting', '', 'attempting', 'Own pull attempt selected · no outcome inferred'],
    ['completed', 'piece_detached', 'detached', 'something detached; no food benefit established'],
    ['completed', 'nothing_detached', 'did-not-detach', 'nothing detached; no food conclusion'],
    ['completed', 'OUT_OF_REACH', 'unavailable', 'no new outcome inferred'],
    ['unavailable', '', 'unavailable', 'Pull unavailable or question window elapsed'],
    ['retired', '', 'retired', 'Question retired · no new test implied'],
  ]) {
    const npc = fixture(state, outcome), before = structuredClone(npc), node = render(freeze(npc));
    assert.equal(node.children.find(n => n.dataset.handlingInquirySource).dataset.handlingInquiryStatus, status);
    assert.ok(node.text.includes(phrase), phrase);
    assert.deepEqual(npc, before);
  }
  const expired = fixture(); expired.elapsed = 310;
  assert.equal(render(freeze(expired)).children.find(n => n.dataset.handlingInquirySource).dataset.handlingInquiryStatus, 'unavailable');
  const retired = render(freeze(fixture('retired')));
  assert.match(retired.text, /full original proof is no longer retained/);
  assert.match(retired.text, /not a currently verified motor result/);
  assert.doesNotMatch(retired.text, /Own prior motor result:/);
});

test('own motor and witnessed consumption questions retain separate provenance', () => {
  const npc = fixture();
  npc.discovery.inquiries = [{ sourceId: 'object:3', actorId: 'aster', at: 5, attempts: [], retired: false }];
  const node = render(freeze(npc), { witnessed: true });
  assert.match(node.text, /Observation-led questions/);
  assert.match(node.text, /Witnessed Aster consume from this exact source/);
  assert.match(node.text, /Own handling questions/);
  const own = node.children.find(n => n.dataset.handlingInquirySource);
  assert.match(own.text, /Own prior motor result/);
  assert.doesNotMatch(own.text, /Witnessed Aster|Could a small sample/);
});

test('handling descriptions render as literal text, not executable markup', () => {
  const npc = fixture();
  npc.discovery.observations['object:1'].appearance.color = '<script>alert(1)</script>';
  npc.discovery.observations['object:2'].appearance.color = '<img src=x onerror=alert(1)>';
  const node = render(freeze(npc));
  assert.ok(node.text.includes('Remembered source (object:1): <script>alert(1)</script>'));
  assert.ok(node.text.includes('Current source (object:2): <img src=x onerror=alert(1)>'));
  assert.ok(node.children.every(n => ['p', 'div'].includes(n.tag)));
});

test('four handling rows prioritize pending attempts without changing memory order', () => {
  const npc = fixture(), first = npc.discovery.handlingQuestions[0];
  npc.discovery.handlingQuestions = Array.from({ length: 16 }, (_, i) => ({ ...first, sourceId: `object:${i + 2}`,
    state: i ? 'retired' : 'pending', ...(i ? { failedId: null, priorId: null, attemptId: null } : {}) }));
  const before = structuredClone(npc), node = render(freeze(npc));
  const entries = node.children.filter(n => n.dataset.handlingInquirySource);
  assert.equal(entries.length, 4);
  assert.equal(entries[0].dataset.handlingInquirySource, 'object:2');
  assert.match(node.text, /Showing 4 of 16 retained handling questions/);
  assert.deepEqual(npc, before);
});


test('undersized forged motor duration cannot display successful detachment', () => {
  const npc = fixture('completed');
  npc.discovery.experiments.at(-1).durationSeconds = 2;
  const result = npc.memory.experience.at(-1).details.result;
  result.durationSeconds = result.handling.activeActionSeconds = 2;
  const node = render(freeze(npc));
  assert.equal(node.children.find(n => n.dataset.handlingInquirySource).dataset.handlingInquiryStatus, 'unavailable');
  assert.doesNotMatch(node.text, /Own pull result · something detached/);
});
