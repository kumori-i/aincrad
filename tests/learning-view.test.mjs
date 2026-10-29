import test from 'node:test';
import { readFileSync } from 'node:fs';
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
test('unavailable data clears old events and reports the error without claiming play continues',()=>{
  const root=new Node('div',document);
  renderLearningView(root,{elapsed:1,exchanges:1,observationEvents:[{id:9,senderId:'aster',receiverId:'mira',tokens:[4,2],status:'pending'}]},'aster');
  renderLearningView(root,null,'aster','offline');
  assert.match(root.text,/Communication learning unavailable\. offline/);
  assert.doesNotMatch(root.text,/4 · 2|Survival continues independently/);
});

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


test('native sharing reopen assertion executes against current Learning DOM and rejects invented activity',()=>{
  const source=readFileSync(new URL('../scripts/verify-renewable-sharing-desktop.mjs',import.meta.url),'utf8');
  const start=source.indexOf('function (receiverId) {',source.indexOf('const learning ='));
  const end=source.indexOf('}).toString()',start);
  assert.ok(start>=0&&end>start);
  const inline=source.slice(start,end+1);
  const reference={phase:'private-visual-association',elapsed:42,exchanges:0,pending:0,updates:0,observationEvents:[]};
  const root=new Node('div',document);
  const render=()=>renderLearningView(root,reference,'mira');
  const elements={
    'npc-panel':{classList:{contains:()=>false}},
    'npc-select':{value:'',dispatchEvent:render},
    'npc-tab-conversation':{click:render},
    'journal-messages':{get textContent(){return root.text;}},
    'npc-name':{textContent:'Mira'},
  };
  const fakeDocument={getElementById:id=>elements[id]};
  const run=Function('window','document','Event','return ('+inline+')')(
    {__ozarkWorld:{communicationSnapshot:()=>reference}},fakeDocument,class Event{});
  const result=run('mira');
  assert.match(result.text,/No reference attempt involving this agent yet/);
  assert.match(result.text,/Observer annotations, not agent speech/);
  assert.equal(result.reference,reference);
  for(const key of ['exchanges','pending','updates']){
    reference[key]=1;assert.throws(()=>run('mira'),/must not invent reference activity/);reference[key]=0;
  }
  reference.observationEvents=[{senderId:'other',receiverId:'another'}];
  assert.throws(()=>run('mira'),/must not invent reference activity/,'Hidden foreign-agent events must fail too');
  reference.observationEvents=[];reference.phase='historical-symbol-path';
  assert.throws(()=>run('mira'),/current empty reference state/,'Old empty wording is not the current main path');
});

test('private association inspector distinguishes evidence, exploration and reference correctness without bodily reward claims',()=>{
  const root=new Node('div',document),snapshot={phase:'private-visual-association',elapsed:20,opportunities:4,exchanges:2,observed:1,correct:0,censored:1,pending:0,matchedChoices:0,exploratoryChoices:2,correctionAttempts:1,evidenceAdditions:1,supportUpdates:0,conflicts:0,correctionAbstentions:0,
    learners:[{agentId:'mira',anchors:[],counts:{anchors:0,entries:1,examples:1,conflicts:0}}],
    observationEvents:[{id:1,phase:'private-visual-association',senderId:'aster',receiverId:'mira',tokens:[3,2],status:'observed',action:'inspect_object',reward:null,choiceMode:'uniform-exploration',choiceReason:'unknown-symbol',correction:'new-exemplar',referenceCorrect:false,observedSeconds:1.7,demonstrationPixels:Array(768).fill(25),demonstrationObservedAt:3.8}]};
  const before=structuredClone(snapshot);renderLearningView(root,snapshot,'mira');
  assert.match(root.text,/1 new visual exemplars/);assert.match(root.text,/2 uniform exploratory choices/);
  assert.match(root.text,/independent reference critic: different/);assert.match(root.text,/not bodily relief or sickness/);
  assert.match(root.text,/private visual associations save locally per individual.*after app reopen/i);
  assert.match(root.text,/fresh or reset worlds and replacement individuals start empty/i);
  assert.match(root.text,/own post-choice demonstration/);
  assert.doesNotMatch(root.text,/positive|negative|no learning updates/);assert.deepEqual(snapshot,before);
});
