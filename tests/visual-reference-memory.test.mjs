import test from 'node:test';
import assert from 'node:assert/strict';
import {createVisualReferenceMemory,VISUAL_REFERENCE_MEMORY_LIMITS as L} from '../src/visual-reference-memory.js';
const flat=x=>Array(48).fill(x);
const axis=i=>Array.from({length:48},(_,j)=>i===j?1:0);
function commit(m,features){const p=m.planPair(features);assert.equal(p.ok,true,p.reason);const c=m.commitPair(p.plan);assert.equal(c.ok,true,c.reason);return c;}
function receiver(){const memory=createVisualReferenceMemory(),partner=Object.freeze({});memory.reconcilePartners([partner]);return {memory,partner};}

test('atomic private sender anchors use stable distinct arbitrary symbols without preflight/snapshot effects',()=>{
 const a=createVisualReferenceMemory({symbolSeed:42}),b=createVisualReferenceMemory({symbolSeed:42});
 for(let i=0;i<20;i++){assert.equal(a.planPair([flat(0),flat(.2)]).ok,true);assert.equal(a.snapshot().counts.anchors,0);}
 const x=commit(a,[flat(0),flat(.2)]),y=commit(b,[flat(0),flat(.2)]);
 assert.deepEqual(x,y);assert.notEqual(x.symbols[0],x.symbols[1]);assert.equal(x.allocated,2);
 const next=commit(a,[flat(.2),flat(0)]);assert.deepEqual(next.symbols,x.symbols.slice().reverse());assert.equal(next.allocated,0);
 assert.deepEqual(a.snapshot(),b.snapshot());
 const other=commit(createVisualReferenceMemory({symbolSeed:43}),[flat(0),flat(.2)]);assert.notDeepEqual(other.symbols,x.symbols);
});
test('sender preflight rejects gray boundaries, same symbol and prospective loss of uniqueness atomically',()=>{
 const m=createVisualReferenceMemory();commit(m,[flat(0),flat(.2)]);
 for(const input of [[flat(.06),flat(.4)],[flat(.08),flat(.4)],[flat(0),flat(.01)]])assert.equal(m.planPair(input).ok,false);
 assert.equal(m.snapshot().counts.anchors,2);
 const near=createVisualReferenceMemory();commit(near,[flat(0),flat(.3)]);
 assert.equal(near.planPair([flat(.035),flat(.081)]).reason,'ambiguous-prospective-anchor');
 assert.equal(near.snapshot().counts.anchors,2);
 const fresh=createVisualReferenceMemory();assert.equal(fresh.planPair([flat(0),flat(.08)]).ok,false,'Novel threshold is strictly greater than .08');
 assert.equal(fresh.snapshot().counts.anchors,0);
});
test('sender exact opaque plans defend arrays, cannot be copied, replayed, cross-owned or reused after revision',()=>{
 const m=createVisualReferenceMemory(),a=flat(0),b=flat(.2),p=m.planPair([a,b]),stale=m.planPair([flat(.4),flat(.6)]);
 a.fill(1);b.fill(1);assert.equal(m.commitPair({...p.plan}).reason,'unknown-plan');
 assert.equal(createVisualReferenceMemory().commitPair(p.plan).reason,'unknown-plan');
 assert.equal(m.commitPair(p.plan).ok,true);assert.equal(m.commitPair(p.plan).reason,'unknown-plan');
 assert.equal(m.commitPair(stale.plan).reason,'stale-plan');assert.equal(m.commitPair(stale.plan).reason,'unknown-plan');
 assert.deepEqual(m.snapshot().anchors.map(a=>a.features[0]),[0,.2]);
 const snapshot=m.snapshot();snapshot.anchors[0].features.fill(1);snapshot.anchors.length=0;
 assert.equal(m.snapshot().counts.anchors,2);assert.equal(m.snapshot().anchors[0].features[0],0);
});
test('16 immutable anchors saturate without symbol recycling or partial allocation',()=>{
 const m=createVisualReferenceMemory();for(let i=0;i<16;i+=2)commit(m,[axis(i),axis(i+1)]);
 const before=m.snapshot();assert.equal(new Set(before.anchors.map(a=>a.symbol)).size,16);
 assert.equal(m.planPair([axis(16),axis(17)]).reason,'anchor-capacity');
 assert.equal(m.planPair([axis(0),axis(16)]).reason,'anchor-capacity');assert.deepEqual(m.snapshot(),before);
 assert.equal(commit(m,[axis(0),axis(15)]).allocated,0);assert.deepEqual(m.snapshot(),before);
 const partial=createVisualReferenceMemory();for(let i=0;i<14;i+=2)commit(partial,[axis(i),axis(i+1)]);commit(partial,[axis(0),axis(14)]);
 assert.equal(partial.planPair([axis(15),axis(16)]).ok,false);assert.equal(partial.snapshot().counts.anchors,15);
});
test('receiver requires exactly one matching candidate and runner margin, never merely best rank',()=>{
 const {memory:m,partner:p}=receiver();assert.equal(m.choose(p,7,[flat(0),flat(.2)]).reason,'unknown-symbol');
 assert.equal(m.observe(p,7,flat(0)).outcome,'new-exemplar');
 assert.deepEqual(m.choose(p,7,[flat(0),flat(.2)]).index,0);
 assert.equal(m.choose(p,7,[flat(.2),flat(0)]).index,1);
 assert.equal(m.choose(p,7,[flat(.005),flat(.03)]).index,null,'Both match even though margin exceeds .02');
 assert.equal(m.choose(p,7,[flat(.035),flat(.05)]).index,null,'One matches but runner margin is too narrow');
 assert.equal(m.choose(p,7,[flat(.04),flat(.2)]).index,0,'Match includes exact .04 boundary');
 assert.equal(m.choose(p,7,[flat(.041),flat(.2)]).index,null);
 assert.equal(m.choose(p,7,[flat(.04),flat(.06)]).index,0,'Runner margin includes exact .02 boundary');
 assert.equal(m.choose(p,7,[flat(.04),flat(.059999)]).index,null);
 assert.equal(m.choose(p,7,[flat(.5),flat(.6)]).index,null);
 assert.equal(m.choose(p,7,[flat(.01),flat(.01)]).index,null);
});
test('receiver retains own examples, supports dedup, abstains gray and permanently conflicts on fifth novel',()=>{
 const {memory:m,partner:p}=receiver(),f=flat(0);m.observe(p,2,f);f.fill(1);
 assert.equal(m.observe(p,2,flat(.04)).outcome,'support');
 assert.equal(m.observe(p,2,flat(.06)).outcome,'gray-zone');assert.equal(m.observe(p,2,flat(.08)).outcome,'gray-zone');
 for(const x of [.2,.4,.6])assert.equal(m.observe(p,2,flat(x)).outcome,'new-exemplar');
 const before=m.snapshot();assert.equal(before.counts.examples,4);assert.equal(before.partners[0].entries[0].support,5);
 assert.equal(m.choose(p,2,[flat(.01),flat(.21)]).index,null,'Examples matching different candidates remain ambiguous');
 assert.equal(m.observe(p,2,flat(.8)).outcome,'capacity-conflict');assert.equal(m.snapshot().counts.examples,4);
 assert.equal(m.observe(p,2,flat(0)).outcome,'already-conflicted');assert.equal(m.choose(p,2,[flat(0),flat(.9)]).reason,'conflicted');
 assert.deepEqual(m.snapshot().partners[0].entries[0].examples,before.partners[0].entries[0].examples);
 before.partners[0].entries[0].examples[0].fill(1);assert.equal(m.snapshot().partners[0].entries[0].examples[0][0],0);
});
test('multiple own exemplars near the same candidate can still yield one unique candidate',()=>{
 const {memory:m,partner:p}=receiver();m.observe(p,3,flat(0));m.observe(p,3,flat(.081));
 // Different visual examples need not collapse into a drifting centroid.
 assert.equal(m.choose(p,3,[flat(.02),flat(.9)]).index,0);
 assert.equal(m.snapshot().counts.examples,2);
});
test('current opaque partner reconciliation bounds storage and cannot inherit reused textual IDs',()=>{
 const m=createVisualReferenceMemory(),p={id:'same'},replacement={id:'same'};
 assert.equal(m.observe(p,0,flat(0)).outcome,'unknown-partner');m.reconcilePartners([p]);m.observe(p,0,flat(0));
 m.reconcilePartners([replacement]);assert.equal(m.snapshot().counts.partners,0);assert.equal(m.choose(replacement,0,[flat(0),flat(1)]).reason,'unknown-symbol');
 assert.equal(m.choose(p,0,[flat(0),flat(1)]).reason,'unknown-partner');m.reconcilePartners([p]);assert.equal(m.choose(p,0,[flat(0),flat(1)]).reason,'unknown-symbol');
 m.observe(p,0,flat(0));assert.equal(m.retirePartner(p),true);assert.equal(m.snapshot().counts.partners,0);
 assert.throws(()=>m.reconcilePartners(['same']),TypeError);
 assert.equal(m.observe(p,0,flat(0)).outcome,'unknown-partner');
});
test('invalid feature/symbol inputs cannot allocate memory, and symbol storage is bounded to 64',()=>{
 assert.throws(()=>createVisualReferenceMemory({symbolSeed:-1}),TypeError);const {memory:m,partner:p}=receiver();
 for(const f of [[],Array(48),flat(NaN),flat(Infinity),flat(-.1),flat(1.1),new Float32Array(48)]){
  assert.equal(m.planPair([f,flat(.2)]).ok,false);assert.equal(m.observe(p,0,f).outcome,'invalid-input');assert.equal(m.choose(p,0,[f,flat(.2)]).index,null);
 }
 for(const s of [-1,64,1.5,NaN,'0'])assert.equal(m.observe(p,s,flat(0)).outcome,'invalid-input');
 for(let s=0;s<64;s++)m.observe(p,s,flat(0));assert.equal(m.snapshot().counts.entries,L.symbols);
 assert.equal(m.snapshot().counts.anchors,0,'Receiver evidence never allocates sender anchors');
});
