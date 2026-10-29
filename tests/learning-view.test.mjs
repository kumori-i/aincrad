import test from 'node:test';
import assert from 'node:assert/strict';
import { renderLearningView } from '../src/learning-view.js';
class Node {constructor(tag,doc){this.tag=tag;this.ownerDocument=doc;this.children=[];this.dataset={};this.textContent='';}append(n){this.children.push(n);}replaceChildren(){this.children=[];this.scrollTop=0;}focus(){this.ownerDocument.activeElement=this;}setAttribute(){}getContext(){return {clearRect(){},createImageData(){return{data:new Uint8ClampedArray(1024)};},putImageData(){}};}get text(){return this.textContent+' '+this.children.map(c=>c.text).join(' ');}}
const document={createElement(tag){return new Node(tag,this);}};
test('Learning view shows literal events and observer-only labels without mutation or invented reply',()=>{
  const root=new Node('div',document),event={id:4,emittedAt:12,senderId:'aster',receiverId:'mira',tokens:[1,4],status:'pending',action:'strike',senderPixels:Array(768).fill(20),receiverPixels:Array(768).fill(40),senderObservedAt:10,receiverObservedAt:12,reward:null};
  const snapshot={elapsed:13,exchanges:1,pending:1,observationEvents:[event]},before=structuredClone(snapshot);
  renderLearningView(root,snapshot,'mira');assert.match(root.text,/Observer annotations, not agent speech/);assert.match(root.text,/1 · 4/);assert.match(root.text,/pending · selected action: strike/);assert.match(root.text,/no supplied English translation/);assert.deepEqual(snapshot,before);
  assert.equal(root.children.filter(c=>c.dataset.learningEvent==='4').length,1);
  event.status='interrupted';event.endedAt=14;renderLearningView(root,snapshot,'mira');assert.match(root.text,/interrupted/);assert.equal(root.children.filter(c=>c.dataset.learningEvent==='4').length,1);
  renderLearningView(root,snapshot,'other');assert.match(root.text,/No symbol exchange/);assert.doesNotMatch(root.text,/1 · 4/);
});
test('unavailable data clears old events and explicitly preserves survival independence',()=>{const root=new Node('div',document);renderLearningView(root,null,'aster','offline');assert.match(root.text,/unavailable.*offline Survival continues/);});

test('refresh retains diagnostics expansion, summary focus and scroll without changing learner data',()=>{
  const root=new Node('div',document),snapshot={elapsed:1,gates:{optional:2},observationEvents:[]};
  renderLearningView(root,snapshot,'aster');
  const details=root.children.find(c=>c.tag==='details'),summary=details.children[0];
  details.open=true;summary.focus();root.scrollTop=120;
  snapshot.elapsed=2;snapshot.gates.optional=3;const before=structuredClone(snapshot);
  renderLearningView(root,snapshot,'aster');
  assert.equal(root.children.find(c=>c.tag==='details'),details,'Same disclosure DOM node survives refresh');
  assert.equal(details.open,true);assert.equal(document.activeElement,summary);assert.equal(root.scrollTop,120);assert.match(details.text,/optional: 3/);assert.deepEqual(snapshot,before);
  details.open=false;renderLearningView(root,snapshot,'aster');assert.equal(details.open,false,'User collapse is preserved too');
  details.open=true;renderLearningView(root,null,'aster','temporary error');renderLearningView(root,snapshot,'aster');assert.equal(root.children.find(c=>c.tag==='details'),details);assert.equal(details.open,true,'Temporary unavailability does not reset disclosure');
});
