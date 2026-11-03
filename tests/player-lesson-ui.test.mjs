import test from 'node:test';
import assert from 'node:assert/strict';
import {renderLearningView} from '../src/learning-view.js';
import {createFreshPlayerLessons, learnPlayerLesson} from '../src/player-lesson-bank.js';
import {createPlayerLessonEvaluation,recordPlayerLessonEvaluation,
  playerLessonEvaluationSnapshot} from '../src/player-lesson-evaluation.js';

class Node {
  constructor(tag, ownerDocument) {
    this.tag = tag; this.ownerDocument = ownerDocument;
    this.children = []; this.dataset = {}; this._text = ''; this.scrollTop = 0;
  }
  set textContent(value) { this._text = value; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  append(child) { this.children.push(child); }
  replaceChildren() { this.children = []; this._text = ''; }
}

test('Learning view separates player word examples from private character messages', () => {
  const lineage = {version:2,instanceId:'550e8400-e29b-41d4-a716-446655440000',
    nextSerial:3,agents:[{agentId:'aster',serial:1},{agentId:'mira',serial:2}]};
  let bank = createFreshPlayerLessons(lineage);
  const first=learnPlayerLesson(bank,{agentId:'aster',serial:1,word:'nava',
    features:Array(48).fill(.2)});
  bank=first.bank;
  bank = learnPlayerLesson(bank,{agentId:'mira',serial:2,word:'tomi',
    features:Array(48).fill(.8)}).bank;
  const scores=playerLessonEvaluationSnapshot(recordPlayerLessonEvaluation(
    createPlayerLessonEvaluation(lineage),{agentId:'aster',serial:1,
      prequential:first.prequential}));
  const before = structuredClone(bank);
  const doc = {createElement(tag) { return new Node(tag,this); }};
  const aster = new Node('div',doc), mira = new Node('div',doc);
  renderLearningView(aster,null,'aster','',[],null,bank,lineage,scores);
  renderLearningView(mira,null,'mira','',[],null,bank,lineage);
  assert.match(aster.textContent,/Player word examples \(separate from character messages\)/);
  assert.match(aster.textContent,/nava · 1 own-image example/);
  assert.match(aster.textContent,/1 completed own-image examples; 0 prior-known word comparisons/);
  assert.match(aster.textContent,/Frozen uniform-choice expectation: 0\.00 correct/);
  assert.match(aster.textContent,/Training stream only; no held-out score/);
  assert.doesNotMatch(aster.textContent,/tomi · 1 own-image example/);
  assert.match(mira.textContent,/tomi · 1 own-image example/);
  assert.doesNotMatch(mira.textContent,/nava · 1 own-image example/);
  assert.deepEqual(bank,before,'Observer refresh must not change private examples');
  const replaced = structuredClone(lineage);
  replaced.nextSerial=4;
  replaced.agents[0].serial=3;
  renderLearningView(aster,null,'aster','',[],null,bank,replaced,scores);
  assert.doesNotMatch(aster.textContent,/nava · 1 own-image example/,
    'A replacement individual cannot see retired examples before the next save');
  assert.match(aster.textContent,/No completed player word lesson/);
  assert.doesNotMatch(aster.textContent,/1 completed own-image examples/,
    'A replacement individual cannot see retired session scores');
});
