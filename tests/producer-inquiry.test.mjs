import test from 'node:test';import assert from 'node:assert/strict';
import {producerFixture} from './fixtures/producer-inquiry.mjs';
import {producerInquiryStatus,receiveProducerAction} from '../src/producer-inquiry.js';
import {observeNpc} from '../src/npc.js';
import {NpcController} from '../src/controller.js';
import {discoveryDecision} from '../src/discovery.js';
import {projectPhysiology} from '../src/biology.js';
test('own production association across regrasp motivates one new paid test, never a fabricated source technique',()=>{
 const f=producerFixture();let status=producerInquiryStatus(f.n);assert.equal(status.questions.length,1);assert.equal(status.questions[0].phase,'ready');assert.equal(f.n.discovery.techniques.some(t=>t.sourceId===f.source.id),false);
 const before=status;receiveProducerAction(f.n,{});assert.deepEqual(producerInquiryStatus(f.n),before);
 const request=f.choose();assert.deepEqual(request,{type:'pull',targetId:f.source.id});assert.equal(f.choose(),null);assert.equal(f.finish(request).code,'piece_detached');
 status=producerInquiryStatus(f.n);assert.equal(status.questions[0].phase,'sample-ready');const material=status.questions[0].materialId;assert.notEqual(material,f.item);
 f.needs();observeNpc(f.n,f.e);const sample=f.choose();assert.deepEqual(sample,{type:'sample',targetId:material});assert.equal(f.finish(sample).code,'SWALLOWED');assert.equal(producerInquiryStatus(f.n).questions[0].phase,'waiting');
 f.advance(100);assert.equal(producerInquiryStatus(f.n).questions[0].phase,'complete');assert.ok(f.n.discovery.techniques.some(t=>t.sourceId===f.source.id));assert.equal(producerInquiryStatus(f.n).admissions,1);assert.equal(f.choose(),null);
});
test('restored or cloned biological feedback does not admit producer authority',()=>{const f=producerFixture({cloneFeedback:true});assert.equal(producerInquiryStatus(f.n).questions.length,0);assert.equal(f.choose(),null);});

test('ordinary controller normalization preserves only the authentic inquiry request and food ablation suppresses selection',()=>{
 const f=producerFixture(),controller=new NpcController(f.n,{environment:f.e});
 const comfortable=()=>{Object.assign(f.n.physiology,{availableEnergyKcal:2200,satietyHours:3,waterDeficitMl:0,stamina:90,fatigue:10,sleepPressure:10});projectPhysiology(f.n);observeNpc(f.n,f.e);};
 comfortable();const before=producerInquiryStatus(f.n);discoveryDecision(f.n,{foodLearning:false});assert.deepEqual(producerInquiryStatus(f.n),before);
 const first=discoveryDecision(f.n);assert.equal(first.reason.includes('Could a new piece'),true);assert.equal(first.action.type,'pull');assert.equal(controller.perform(first.action).code,'ACTION_STARTED');while(f.n.active)f.advance(.25);
 assert.equal(producerInquiryStatus(f.n).questions[0].phase,'sample-ready');comfortable();const next=discoveryDecision(f.n);assert.equal(next.action.type,'sample');assert.equal(next.reason.includes('Could a new piece'),true);assert.equal(controller.perform(next.action).code,'ACTION_STARTED');while(f.n.active)f.advance(.25);
 assert.equal(producerInquiryStatus(f.n).questions[0].phase,'waiting');f.advance(100);assert.equal(producerInquiryStatus(f.n).questions[0].phase,'complete');controller.dispose();
});
test('an interposed ordinary sample consumes continuation without claiming inquiry execution',()=>{
 const f=producerFixture();const first=f.choose();f.finish(first);const q=producerInquiryStatus(f.n).questions[0];assert.equal(q.phase,'sample-ready');f.finish({type:'sample',targetId:q.materialId});assert.equal(producerInquiryStatus(f.n).questions[0].phase,'unavailable');assert.equal(f.choose(),null);
});

test('a directly earned producer technique leaves no missing link for the optional inquiry',()=>{
 const f=producerFixture({train:false});assert.equal(f.finish({type:'pull',targetId:f.source.id}).code,'piece_detached');const item=f.n.inventory.items.at(-1);assert.equal(f.finish({type:'sample',targetId:item}).code,'SWALLOWED');f.ready();assert.ok(f.n.discovery.techniques.some(t=>t.sourceId===f.source.id&&t.steps[0].type==='pull'));assert.equal(f.choose(),null);assert.equal(producerInquiryStatus(f.n).questions[0].phase,'retired');
});
