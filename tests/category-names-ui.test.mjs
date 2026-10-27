import test from 'node:test';
import assert from 'node:assert/strict';
import { renderCategoryNames, renderObjectName, renderMessageNames, modelNamingStatus, namingRequestStatus, vocabularyDisplaySignature } from '../src/npc-panel.js';
import { namingProposal, beginNamingProposal, acceptNamingProposal, recordCategoryGrounding, objectName } from '../src/category-names.js';
import { ingestVisualSamples } from '../src/visual-group-memory.js';
import { createNpc } from '../src/npc-state.js';
import { createCommunity, SocialCoordinator } from '../src/social.js';
class TextNode {
  constructor(){this.textContent='';this.children=[];this.dataset={};}
  append(node){this.children.push(node);}
  get text(){return [this.textContent,...this.children.map(n=>n.text)].join('\n');}
  set innerHTML(_){throw Error('Category UI must use literal text');}
}
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
const cues={shape:'tuft narrow blades',color:'green',texture:'fibrous'};
const object=(n,id=675,appearance=cues)=>({id:`object:${id}`,scene:'valley',position:{...n.position},appearance});
function actor(id='aster'){
  const n=createNpc({id,mode:'discovery'});n.position={x:0,y:0};
  for(const at of [0,1]){n.elapsed=at;ingestVisualSamples(n,[object(n),object(n,669),object(n,672)]);}
  return n;
}
function named(){const n=actor(),request=namingProposal(n);assert.ok(request);assert.equal(beginNamingProposal(n,request),true);assert.equal(acceptNamingProposal(n,request,{token:'velora',model:'mock-ui-only'}),true);return n;}
function render(fn,n,...args){const old=globalThis.document;globalThis.document={createElement:()=>new TextNode()};try{const out=new TextNode();fn(out,n,...args);return out;}finally{if(old===undefined)delete globalThis.document;else globalThis.document=old;}}
test('category UI shows one tentative model word with exact local members and supplied-rule limits',()=>{
  const n=named(),before=structuredClone(n),out=render(renderCategoryNames,freeze(n));
  assert.deepEqual(n,before);assert.match(out.text,/“velora”/);assert.match(out.text,/Model-proposed for my own observations · mock-ui-only/);
  assert.match(out.text,/supplied exact shape, color and texture rule, not discovered species/);
  assert.match(out.text,/never transfers food benefit, safety or actions/);
  assert.match(out.text,/More than one matching individual/);
  const entry=out.children.find(row=>row.dataset.categoryToken);
  assert.equal(entry.children.filter(row=>row.dataset.categoryMember).length,3);
  for(const id of ['object:675','object:669','object:672'])assert.match(out.text,new RegExp(id));
  assert.equal(entry.children.filter(row=>row.dataset.categoryVisibility==='current').length,3);
  const restored=render(renderCategoryNames,freeze(structuredClone(n)));
  assert.doesNotMatch(restored.text,/current ordinary visual sample/);assert.match(restored.text,/remembered only/);
});
test('listener vocabulary presentation attributes its own grounded example without copying speaker extension',()=>{
  const a=named(),b=actor('mira');b.discovery.visualSamples.records=b.discovery.visualSamples.records.filter(r=>r.objectId==='object:669');
  const event={messageId:'message:1',at:1,scene:'valley',speakerPosition:{...a.position},listenerPosition:{...b.position},objectPosition:{...b.position}};
  assert.equal(recordCategoryGrounding(a,b,a.categoryNames.own[0],'object:669',event),true);
  const before=structuredClone(b),out=render(renderCategoryNames,freeze(b),[{id:'aster',name:'Aster'}]);
  assert.deepEqual(b,before);assert.match(out.text,/Heard from Aster · grounded in my own local example/);
  assert.match(out.text,/Grounding example: object:669/);assert.doesNotMatch(out.text,/object:675|object:672|mock-ui-only/);
});
test('old text stays unchanged and annotation is explicitly current, exact, bounded and actor-local',()=>{
  const n=named(),historical='I sampled object:675 before any naming proposal.',before=structuredClone(n);
  const out=render(renderMessageNames,freeze(n),historical);
  assert.equal(historical,'I sampled object:675 before any naming proposal.');assert.deepEqual(n,before);
  assert.match(out.text,/Current label: “velora”/);assert.match(out.text,/Exact individual: object:675/);
  assert.match(out.text,/not evidence the name was known at the time/);
  assert.equal(render(renderMessageNames,actor('mira'),historical).text.trim(),'');
  assert.equal(render(renderMessageNames,n,'object:675 object:675').children.filter(r=>r.dataset.currentObjectName).length,1);
});
test('missing and changed evidence suspend current labels without erasing the old proposed word',()=>{
  const n=named();n.elapsed=2;ingestVisualSamples(n,[object(n,669,{...cues,color:'brown'}),object(n,672,{shape:'tuft'}),object(n,675,{...cues,texture:'smooth'})]);
  assert.equal(objectName(n,'object:675'),null);
  const out=render(renderCategoryNames,freeze(n));assert.match(out.text,/“velora”/);assert.match(out.text,/No retained matching members/);
  assert.equal(out.children.find(r=>r.dataset.categoryToken).children.filter(r=>r.dataset.categoryMember).length,0);
  const reference=render(renderObjectName,n,'object:675',{historical:true});assert.match(reference.text,/Exact individual: object:675/);assert.doesNotMatch(reference.text,/velora/);
});
test('malformed vocabulary has no labels and status does not imply a successful inference',()=>{
  const n=named();n.categoryNames.ownerId='mira';assert.equal(render(renderCategoryNames,n).text.trim(),'');
  assert.match(modelNamingStatus(false),/New model-chosen names are paused/);assert.match(modelNamingStatus(false),/No seeded naming fallback/);
  assert.match(modelNamingStatus(true),/Proposals may abstain or fail/);assert.match(modelNamingStatus(false,false),/desktop application/);
  assert.match(namingRequestStatus({state:'pending'}),/no word has been adopted/);assert.match(namingRequestStatus({state:'unavailable'}),/failed; no fallback/);
  assert.match(namingRequestStatus({state:'not-adopted'}),/abstained/);assert.match(namingRequestStatus({state:'discarded'}),/stale/);
});
test('new experience notes and ordinary conversation use names while their exact effect stays unchanged',()=>{
  const n=named();n.elapsed=130;n.discovery.effects.push({id:'effect:test',objectId:'object:675',effect:'sustained'});
  const community=createCommunity(),environment={elapsed:n.elapsed},social=new SocialCoordinator({getAgents:()=>[n],getCommunity:()=>community,getEnvironment:()=>environment});
  const before=structuredClone(n.discovery.effects);
  // Isolate prose selection; this is not a physical-effect proof fixture.
  social.observe=()=>({peers:[],notes:[],pendingHumanTurn:null});
  const note=social.discoveryDialogue(n);assert.equal(note.type,'write_note');assert.match(note.title,/“velora” \(object:675\)/);
  assert.match(note.text,/After sampling “velora” \(object:675\)/);assert.match(note.text,/other materials and future conditions remain untested/);
  assert.deepEqual(n.discovery.effects,before);
  social.observe=()=>({peers:[],notes:[],pendingHumanTurn:{id:'message:1',text:'What have you learned?'}});
  const reply=social.discoveryDialogue(n);assert.equal(reply.type,'journal_reply');assert.match(reply.text,/“velora” \(object:675\)/);assert.deepEqual(n.discovery.effects,before);
  social.dispose();
});

test('conversation annotations refresh for selected owner and revised membership, not repeated sample times',()=>{
  const n=named(),first=vocabularyDisplaySignature(n);
  assert.notEqual(vocabularyDisplaySignature(actor('mira')),first);
  n.elapsed=2;ingestVisualSamples(n,[object(n),object(n,669),object(n,672)]);
  assert.equal(vocabularyDisplaySignature(n),first,'repeated unchanged samples need no textual redraw');
  n.elapsed=3;ingestVisualSamples(n,[object(n,675,{...cues,color:'brown'})]);
  assert.notEqual(vocabularyDisplaySignature(n),first);
});
