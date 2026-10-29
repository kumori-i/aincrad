import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderLearningView } from '../src/learning-view.js';
class Node {constructor(tag,doc){this.tag=tag;this.ownerDocument=doc;this.children=[];this.dataset={};this.textContent='';}append(n){this.children.push(n);}replaceChildren(){const contains=(node,target)=>node===target||node.children.some(child=>contains(child,target));if(contains(this,this.ownerDocument.activeElement))this.ownerDocument.activeElement=null;this.children=[];this.scrollTop=0;}focus(){this.ownerDocument.activeElement=this;}setAttribute(){}get text(){return this.textContent+' '+this.children.map(n=>n.text).join(' ');}}
const document={createElement(tag){return new Node(tag,this);}};
const root=()=>new Node('div',document);
const observer=()=>({version:1,body:{satietyHours:0,satietyMaximumHours:6,satietyPercent:0,availableEnergyKcal:320,storedEnergyKcal:83000,ingestedKcal:114,absorbedKcal:43.8,metabolizedKcal:1684,foodFeedbackEvents:8},counters:{evictedRecords:9,droppedNotes:4,rejectedNotes:1},records:[{sequence:1,epoch:0,at:12,status:'selected',requestedNeed:'food',actualNeed:'food',requestedType:'sample',actualType:'rest',phases:{urgentFood:'visited',ordinaryFood:'not-visited',learnedRun:'entered',optional:'not-visited'},notes:[{code:'sample:composite-blocked',count:1},{code:'food:urgent-candidates',count:0}]}]});
const communication={phase:'private-visual-association',agents:[{id:'mira',name:'Mira',hunger:0,thirst:80,energy:90}],observationEvents:[]};
test('zero Satiety is distinct from available fuel; feedback events are not whole meals; render is read-only',()=>{
 const node=root(),snapshot=observer(),before=structuredClone(snapshot);renderLearningView(node,communication,'mira','',[],snapshot);
 assert.match(node.text,/Satiety: 0.0 \/ 6.0 modeled game hours/);assert.match(node.text,/Available fuel: 320.0 kcal · stored reserves: 83000.0 kcal/);
 assert.match(node.text,/114.0 kcal ingested · 43.8 kcal absorbed · 1684.0 kcal spent/);assert.match(node.text,/8 food-sampling\/feedback events \(legacy counter; not whole meals\)/);
 assert.match(node.text,/Mira: Satiety 0.0\/100/);assert.doesNotMatch(node.text,/last meal|last swallow|8 meals|Mira: food/);assert.deepEqual(snapshot,before);
 snapshot.body.availableEnergyKcal=999;assert.doesNotMatch(node.text,/999/,'DOM retains no live data alias');
});
test('selected vs requested and unvisited vs failed are distinct, finite codes cannot render arbitrary prose',()=>{
 const node=root(),snapshot=observer();snapshot.records[0].notes.push({code:'eat the red apple',count:1},{code:'run:missing-or-expired',count:1});snapshot.records[0].actualNeed='SECRET';
 renderLearningView(node,communication,'mira','',[],snapshot);
 assert.match(node.text,/selected action: rest. Requested need: food · requested action: sample/);
 assert.match(node.text,/Urgent food: reached; branch not entered · ordinary food: not visited \(not a failure\)/);
 assert.match(node.text,/Learned run missing, revised or expired/);assert.match(node.text,/Composite sampling gate blocked \(subreason not recorded\)/);assert.match(node.text,/filtered candidates · count 0/);assert.doesNotMatch(node.text,/SECRET|eat the red apple/);
});
test('bounded disclosures retain expansion/focus and render when communication unavailable',()=>{
 const node=root(),snapshot=observer();snapshot.records=Array.from({length:64},(_,i)=>({...snapshot.records[0],sequence:i+1}));
 renderLearningView(node,communication,'mira','',[],snapshot);
 const details=node.children.find(n=>n.dataset.survivalDiagnostics);assert.equal(details.children[1].children.filter(n=>n.dataset.survivalDecision).length,8);
 assert.match(details.text,/Latest 8 of 64 retained/);assert.match(details.text,/9 older records evicted · 4 notes truncated · 1 invalid notes omitted/);
 details.open=true;details.children[0].focus();node.scrollTop=120;
 renderLearningView(node,null,'mira','offline',[],snapshot);assert.equal(node.children.find(n=>n.dataset.survivalDiagnostics),details);assert.equal(details.open,true);assert.equal(document.activeElement,details.children[0]);assert.equal(node.scrollTop,120);assert.match(node.text,/Communication learning unavailable\. offline/);assert.match(node.text,/Available fuel: 320.0/);
});
test('panel supplies selected actor diagnostics separately; existing engine IDs and historical labels stay intact',()=>{
 const source=readFileSync(new URL('../src/npc-panel.js',import.meta.url),'utf8'),html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(source,/survivalDecisionSnapshot\(getNpc\(\)\)/);assert.match(html,/modeled appetite duration, not stomach fullness or stored energy/);assert.match(html,/id="npc-nourishment"/);
 const node=root();renderLearningView(node,{...communication,phase:'historical'},'mira');assert.match(node.text,/Mira: food 0.0/);assert.doesNotMatch(node.text,/Survival observer/);
});
