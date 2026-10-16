import test from 'node:test';
import assert from 'node:assert/strict';
import { createTemporalLedger, beginTemporalDecision, advanceTemporalClock, completeTemporalDecision, recordTemporalFeedback } from '../src/temporal-ledger.js';
import { temporalKey } from '../src/temporal-returns.js';
import { createFiniteSelector, validateFiniteSelector, finiteChoiceContext, proposeFiniteChoice, commitFiniteChoice, completeFiniteFocus, interruptFiniteFocus } from '../scripts/lib/finite-temporal-policy.mjs';
const copy = value => structuredClone(value);
function fixture() {
 const memory=createTemporalLedger(), selector=createFiniteSelector(1729);
 const view={at:0,scene:'valley',position:{x:0,y:0},reach:80,held:[],body:{hunger:'peckish',thirst:'dry mouth',energy:'steady',stamina:'easy breathing',fatigue:'fresh',pain:'none',digestion:'empty'},senses:{warmth:'comfortable',shelter:'open air'},objects:[1,2,3,4].map(n=>({id:`object:${n}`,scene:'valley',position:{x:n*10,y:0},observedAt:0,appearance:{shape:n===1?'branching':'round',color:'green',texture:'rough'}}))};
 return {memory,selector,view};
}
function record(f,action,result={ok:true,code:'OBSERVED'},duration=1){
 const at=f.memory.clockAt,seq=beginTemporalDecision(f.memory,{at,action,context:{}});
 advanceTemporalClock(f.memory,at+duration);
 assert.ok(completeTemporalDecision(f.memory,{seq,at:at+duration,actionId:seq,result:{durationSeconds:duration,...result}}));
 f.view.at=at+duration;f.view.objects.forEach(o=>o.observedAt=f.view.at);return f.memory.receipts.at(-1);
}
const choice=(type,targetId)=>({action:{type,...(targetId?{targetId}:{seconds:5})}});
const opportunity=(f,choices)=>({at:f.view.at,choices});
const context=(f,type,targetId)=>finiteChoiceContext(f.view,f.memory,choice(type,targetId),f.selector.focus);

test('missing sensory count remains unknown and no coordinates or IDs enter canonical keys',()=>{
 const f=fixture();const c=context(f,'pull','object:1');assert.equal(c.countBand,'unknown');
 const key=temporalKey(c,'pull');assert.ok(!key.includes('object:1'));assert.ok(!key.includes('position'));
 f.view.objects[0].count=0;assert.equal(context(f,'pull','object:1').countBand,'0');
 f.view.objects[0].count=1;assert.equal(context(f,'pull','object:1').countBand,'1');
 f.view.objects[0].count=20;assert.equal(context(f,'pull','object:1').countBand,'2+');
});
test('one-hop producing action joins material history, not unrelated parent actions',()=>{
 const f=fixture();record(f,{type:'inspect_object',targetId:'object:1'});record(f,{type:'pull',targetId:'object:1'},{ok:true,code:'DETACHED',materialId:'object:2'});f.view.held=['object:2'];
 const c=context(f,'sample','object:2');assert.deepEqual(c.history,[{operation:'pull',outcome:'success'}]);assert.equal(c.workBand,'1');assert.equal(c.relation,'held');
 assert.deepEqual(context(f,'pull','object:1').history.map(h=>h.operation),['inspect_object','pull']);
});
test('own exposure is exact material or its proved source, never its sibling',()=>{
 const f=fixture();record(f,{type:'pull',targetId:'object:1'},{ok:true,code:'DETACHED',materialId:'object:2'});
 record(f,{type:'sample',targetId:'object:2'},{ok:true,code:'SWALLOWED',ingestionId:'ingestion:1'});
 record(f,{type:'pull',targetId:'object:1'},{ok:true,code:'DETACHED',materialId:'object:3'});
 for(const target of ['object:1','object:2'])assert.equal(context(f,'inspect_object',target).exposures[0].scope,'own');
 assert.equal(context(f,'inspect_object','object:3').exposures[0].scope,'other');
 assert.deepEqual(context(f,'pull','object:1').history.map(h=>h.operation),['pull','pull']);
});
test('release and regrasp replace the old source association without erasing exact-item exposure',()=>{
 const f=fixture();record(f,{type:'pull',targetId:'object:1'},{ok:true,code:'DETACHED',materialId:'object:2'});
 record(f,{type:'release',targetId:'object:2'});record(f,{type:'grasp',targetId:'object:2'},{ok:true,code:'GRASPED',materialId:'object:2'});
 record(f,{type:'sample',targetId:'object:2'},{ok:true,code:'SWALLOWED',ingestionId:'ingestion:1'});
 assert.equal(context(f,'pull','object:1').exposures[0].scope,'other');assert.equal(context(f,'sample','object:2').exposures[0].scope,'own');
 assert.deepEqual(context(f,'sample','object:2').history.map(h=>h.operation),['grasp','sample']);
});
test('receipt loss censors source relation; no inferred ancestry from appearance or IDs',()=>{
 const f=fixture();const acquisition=record(f,{type:'pull',targetId:'object:1'},{ok:true,code:'DETACHED',materialId:'object:2'});
 record(f,{type:'sample',targetId:'object:2'},{ok:true,code:'SWALLOWED',ingestionId:'ingestion:1'});
 f.memory.receipts=f.memory.receipts.filter(r=>r.seq!==acquisition.seq);f.memory.historyCensored=true;
 assert.equal(context(f,'pull','object:1').exposures[0].scope,'other');assert.equal(context(f,'sample','object:2').historyCensored,true);
});
test('coarse public state and relational renaming preserve context keys',()=>{
 const f=fixture();record(f,{type:'pull',targetId:'object:1'},{ok:true,code:'DETACHED',materialId:'object:2'});
 record(f,{type:'sample',targetId:'object:2'},{ok:true,code:'SWALLOWED',ingestionId:'ingestion:1'});f.view.held=['object:2'];
 const expected=temporalKey(context(f,'sample','object:2'),'sample');
 const renamed=JSON.parse(JSON.stringify(f).replaceAll('object:1','object:91').replaceAll('object:2','object:72'));
 assert.equal(temporalKey(context(renamed,'sample','object:72'),'sample'),expected);
 renamed.view.position.x+=100;renamed.view.objects.forEach(o=>o.position.x+=100);
 assert.equal(temporalKey(context(renamed,'sample','object:72'),'sample'),expected);
});
test('wait has unknown appearance and movement only gets its actual observed binding',()=>{
 const f=fixture();assert.equal(context(f,'wait').appearance.shape,'unknown');
 const move={action:{type:'move',target:{x:200,y:100}},bindingId:'object:1'};
 assert.equal(finiteChoiceContext(f.view,f.memory,move).appearance.shape,'branching');
 delete move.bindingId;const c=finiteChoiceContext(f.view,f.memory,move);assert.equal(c.appearance.shape,'unknown');assert.equal(c.relation,'route');
});
test('proposals are pure and deterministic; commit consumes exactly four separate RNG draws once',()=>{
 const f=fixture(),o=opportunity(f,[choice('pull','object:1'),choice('wait')]),before=copy(f);
 const a=proposeFiniteChoice(f.view,f.memory,f.selector,o),b=proposeFiniteChoice(f.view,f.memory,f.selector,o);
 assert.deepEqual(a,b);assert.deepEqual(f,before);assert.ok(Object.isFrozen(a.selected.action));
 let rng=f.selector.rng;for(let i=0;i<4;i++)rng=(Math.imul(rng,1664525)+1013904223)>>>0;
 commitFiniteChoice(f.selector,a);assert.equal(f.selector.rng,rng);assert.equal(f.selector.choices,1);
 assert.throws(()=>commitFiniteChoice(f.selector,a),/duplicate/);assert.throws(()=>commitFiniteChoice(f.selector,b),/Stale/);
});
test('known learned utility competes directly with movement, unknown rows cannot exploit zero',()=>{
 const f=fixture(),o=opportunity(f,[choice('pull','object:1'),{action:{type:'move',target:{x:200,y:0}}},choice('wait')]);
 // Find a deterministic non-epsilon decision; this is a selector unit fixture, not a physical trial.
 for(let seed=0;seed<100;seed++){
  f.selector=createFiniteSelector(seed);const p=proposeFiniteChoice(f.view,f.memory,f.selector,o);
  f.memory.model.rows=p.candidates.slice(0,2).map((r,i)=>({key:r.key,q:[0,0,0,i===0?10:1,0],visits:1,updates:1,lastAt:0}));
  const learned=proposeFiniteChoice(f.view,f.memory,f.selector,o);if(!learned.exploring){assert.equal(learned.selected.action.type,'move');assert.equal(learned.selected.known,true);return;}
 }
 assert.fail('non-epsilon draw expected');
});
test('same candidate masks and selector draws apply to zero, immediate and online tables',()=>{
 const f=fixture(),o=opportunity(f,[choice('pull','object:1'),choice('wait')]);const first=proposeFiniteChoice(f.view,f.memory,f.selector,o);
 const states=[];for(const reward of [0,1,2]){const m=copy(f.memory),s=copy(f.selector);m.model.rows=first.candidates.map(r=>({key:r.key,q:[reward,0,0,0,0],visits:1,updates:1,lastAt:0}));const p=proposeFiniteChoice(f.view,m,s,o);assert.deepEqual(p.candidates.map(c=>c.action),first.candidates.map(c=>c.action));commitFiniteChoice(s,p);states.push(s.rng);}
 assert.equal(new Set(states).size,1);
});
test('focus transfers only real acquisition outputs, preserving deadline and consumed budget',()=>{
 const f=fixture();f.selector.focus={objectId:'object:1',startedAt:0,used:3};
 const pulled=record(f,{type:'pull',targetId:'object:1'},{ok:true,code:'DETACHED',materialId:'object:2'});f.view.held=['object:2'];completeFiniteFocus(f.selector,pulled,f.view);
 assert.deepEqual(f.selector.focus,{objectId:'object:2',parentId:'object:1',proofSeq:pulled.seq,startedAt:0,used:3});
 assert.equal(context(f,'sample','object:2').outputOfFocus,true);
 const sample=record(f,{type:'sample',targetId:'object:2'},{ok:true,code:'SWALLOWED',ingestionId:'ingestion:1'});completeFiniteFocus(f.selector,sample,f.view);assert.equal(f.selector.focus.startedAt,0);
 const release=record(f,{type:'release',targetId:'object:2'});f.view.held=[];completeFiniteFocus(f.selector,release,f.view);assert.equal(f.selector.focus,null);
});
test('eight-choice/elapsed focus expires, and real care interruption clears it',()=>{
 const f=fixture(),o=opportunity(f,[choice('wait')]);f.selector.focus={objectId:'object:1',startedAt:0,used:8};
 const p=proposeFiniteChoice(f.view,f.memory,f.selector,o);commitFiniteChoice(f.selector,p);assert.equal(f.selector.focus.used,1);
 f.view.at=31;f.view.objects.forEach(o=>o.observedAt=31);const late=proposeFiniteChoice(f.view,f.memory,f.selector,opportunity(f,[choice('wait')]));commitFiniteChoice(f.selector,late);assert.equal(f.selector.focus.startedAt,31);
 interruptFiniteFocus(f.selector);assert.equal(f.selector.focus,null);
});
test('selector reopen preserves zero RNG, focus proof and next exact proposal without learning',()=>{
 const f=fixture();f.selector=createFiniteSelector(0);f.selector.focus={objectId:'object:1',startedAt:0,used:0};
 const r=record(f,{type:'pull',targetId:'object:1'},{ok:true,code:'DETACHED',materialId:'object:2'});f.view.held=['object:2'];completeFiniteFocus(f.selector,r,f.view);
 const restored=validateFiniteSelector(copy(f.selector),f.view,f.memory),o=opportunity(f,[choice('sample','object:2'),choice('wait')]);
 assert.deepEqual(proposeFiniteChoice(f.view,f.memory,restored,o),proposeFiniteChoice(f.view,f.memory,f.selector,o));
 assert.throws(()=>validateFiniteSelector({...restored,rng:NaN},f.view,f.memory));
 assert.throws(()=>validateFiniteSelector({...restored,focus:{...restored.focus,proofSeq:999}},f.view,f.memory));
 assert.throws(()=>validateFiniteSelector({...restored,focus:{...restored.focus,startedAt:99}},f.view,f.memory));
});

test('projected exposure truncation marks context censored even before ledger eviction',()=>{
 const f=fixture();const first=record(f,{type:'sample',targetId:'object:2'},{ok:true,code:'SWALLOWED',ingestionId:'ingestion:1'});
 assert.equal(recordTemporalFeedback(f.memory,{id:'feedback:1',at:1,objectId:'object:2',actionId:first.seq,ingestionId:'ingestion:1',provenance:'sampled',effect:'sustained'},{now:1}),true);
 advanceTemporalClock(f.memory,700);f.view.at=700;
 for(let i=2;i<=25;i++)record(f,{type:'sample',targetId:'object:3'},{ok:true,code:'SWALLOWED',ingestionId:`ingestion:${i}`});
 assert.equal(f.memory.ingestions.length,25);assert.equal(f.memory.historyCensored,false);assert.equal(f.memory.model.historyCensored,false);
 const c=context(f,'sample','object:2');assert.equal(c.historyCensored,true);
 assert.ok(c.exposures.every(e=>e.age==='<45'&&e.channels===0));assert.ok(!c.exposures.some(e=>e.age==='>600'&&e.channels===1));
});

test('saved transferred focus cannot resurrect a superseded acquisition or release',()=>{
 for(const regrasp of [false,true]){
  const f=fixture(),pull=record(f,{type:'pull',targetId:'object:1'},{ok:true,code:'DETACHED',materialId:'object:2'});
  const old={objectId:'object:2',parentId:'object:1',proofSeq:pull.seq,startedAt:0,used:3};
  record(f,{type:'release',targetId:'object:2'});
  if(regrasp)record(f,{type:'grasp',targetId:'object:2'},{ok:true,code:'GRASPED',materialId:'object:2'});
  f.selector.focus=old;f.view.held=regrasp?['object:2']:[];
  assert.throws(()=>validateFiniteSelector(f.selector,f.view,f.memory),/Unproved/);
  assert.equal(context(f,'sample','object:2').outputOfFocus,false);
 }
});
