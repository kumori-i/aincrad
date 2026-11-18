import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, choice } from './fixtures/procedure-cycle.mjs';
import { lookupEcologyObject } from '../src/ecology.js';
import { discoveryDecision } from '../src/discovery.js';
import { procedureCycleStatus } from '../src/procedure-cycle.js';
import { bodySignals } from '../src/interoception.js';
import { projectPhysiology, ingestMaterial, procedureFeedbackWitness } from '../src/biology.js';

// Authored action-boundary challenge, not an autonomous survival experiment.
// Procedures and their work/outcomes are earned through the shared real engine.
test('active food intent yields to an actual drink and resumes with the same deadline and no care-work credit',()=>{
 const f=fixture();f.soak();f.prepare();
 const first=choice(f),run=f.n.discovery.run;
 assert.equal(first.result.action.type,'move');assert.ok(run);
 const deadline=procedureCycleStatus(f.n).intent.deadline;
 assert.equal(f.finish(first.result.action).code,'ARRIVED');
 const spent=procedureCycleStatus(f.n).intent.spent;assert.ok(spent>0);
 // Authored physiological challenge, projected through the real body model.
 f.n.physiology.waterDeficitMl=500;f.n.flask.water=.5;projectPhysiology(f.n);
 assert.equal(bodySignals(f.n).thirst,'dry mouth');
 const care=discoveryDecision(f.n);assert.equal(care.need,'water');assert.equal(care.action.type,'drink');
 assert.equal(f.finish(care.action).code,'DRANK');
 assert.equal(f.n.discovery.run,run);
 for(let i=0;i<80&&bodySignals(f.n).thirst!=='quenched';i++)f.advance(.25);
 assert.equal(bodySignals(f.n).thirst,'quenched');
 assert.equal(procedureCycleStatus(f.n).intent.spent,spent,'drinking/digesting water is not food-procedure work');
 assert.equal(procedureCycleStatus(f.n).intent.deadline,deadline);
 // An authored unrelated paid movement shares the current public run pointer,
 // but lacks that run's admission-bound request identity. It must not be
 // credited as food work. This is not a policy-selected water-route claim.
 const expenditure=f.n.physiology.totals.metabolizedKcal;
 const otherMove=f.finish({type:'move',target:{x:240,y:720}});
 assert.equal(otherMove.ok,true,JSON.stringify(otherMove));
 assert.ok(f.n.physiology.totals.metabolizedKcal>expenditure);
 assert.equal(f.n.discovery.run,run);
 assert.equal(procedureCycleStatus(f.n).intent.spent,spent);
 const resumed=discoveryDecision(f.n);assert.equal(resumed.need,'food');
 assert.equal(f.n.discovery.run,run);assert.equal(run.startedAt+90,deadline);
 assert.ok(['move','pull','grasp','sample'].includes(resumed.action.type));
 assert.ok(f.n.elapsed<deadline);
 console.log('care-resume',JSON.stringify({start:run.startedAt,deadline,resumedAt:f.n.elapsed,spent,action:resumed.action.type}));
});

test('genuine unrelated delayed relief cannot resolve a newly sampled procedure',()=>{
 const f=fixture();f.prepare();
 let decision=choice(f).result,run=f.n.discovery.run;assert.ok(run);
 let sampled=false;
 for(let i=0;i<16&&!sampled;i++){
  const result=f.finish(decision.action);assert.equal(result.ok,true,JSON.stringify(result));
  sampled=decision.action.type==='sample';
  if(!sampled)decision=discoveryDecision(f.n);
 }
 assert.ok(sampled);assert.equal(procedureCycleStatus(f.n).pending,1);
 const methods=procedureCycleStatus(f.n).methods;
 // A separate authored bodily input is physically digested, never a fabricated
 // feedback row or a credited source acquisition. It resolves earlier than the
 // pending source sample and must not stand in for that sample's outcome.
 const unrelated=ingestMaterial(f.n,{massGrams:10,energyKcal:80,waterMl:0,digestHours:.05},{objectId:'object:999999',actionId:999999,source:'authored unrelated input'});
 assert.equal(unrelated.ok,true);
 for(let i=0;i<80&&!f.n.physiology.feedback.some(e=>e.ingestionId===unrelated.ingestionId&&e.effect==='sustained');i++)f.advance(.25);
 const event=f.n.physiology.feedback.find(e=>e.ingestionId===unrelated.ingestionId&&e.effect==='sustained');
 assert.ok(event);assert.ok(procedureFeedbackWitness(f.n,event));
 assert.equal(procedureCycleStatus(f.n).pending,1);
 assert.equal(procedureCycleStatus(f.n).methods,methods);
 assert.equal(procedureCycleStatus(f.n).intent.phase,'await');
 console.log('unrelated-relief',JSON.stringify({at:f.n.elapsed,pending:procedureCycleStatus(f.n).pending,intent:procedureCycleStatus(f.n).intent}));
});

test('care delay cannot reset an expired food intent into the same run',()=>{
 const f=fixture();f.prepare();const first=choice(f),run=f.n.discovery.run;
 const deadline=procedureCycleStatus(f.n).intent.deadline;
 assert.equal(first.result.need,'food');
 // Advance real body ticks without executing the outstanding approach.
 // Persistent current thirst keeps care ahead of the food action boundary.
 f.n.physiology.waterDeficitMl=500;f.n.flask.water=.5;projectPhysiology(f.n);
 const care=discoveryDecision(f.n);assert.equal(care.action.type,'drink');f.finish(care.action);
 while(f.n.elapsed<=deadline)f.advance(.25);
 // Restore only authored nonurgent starting needs, never learned evidence.
 f.needs();const next=discoveryDecision(f.n);
 assert.notEqual(f.n.discovery.run,run);
 assert.equal(run.startedAt+90,deadline);
 assert.ok(!f.n.discovery.run||f.n.discovery.run.startedAt>run.startedAt);
 console.log('expired-intent',JSON.stringify({deadline,at:f.n.elapsed,next:next.action.type,status:procedureCycleStatus(f.n).intent}));
});


test('a physically adverse new sample revises the exact supported method without fabricated feedback',()=>{
 const f=fixture();f.soak();f.at({x:380,y:740});
 assert.equal(f.finish({type:'move',target:{x:400,y:720}}).code,'ARRIVED');
 f.prepare();assert.equal(choice(f).source,f.piece,'the earned fast-pace choice initially prefers grasp');
 f.n.discovery.run=null;f.needs();f.at(f.b.position);
 assert.equal(f.finish({type:'grasp',targetId:f.piece}).code,'object_held');
 // Authored physical contamination before ingestion, not a changed digestive
 // record, sensation, method confidence or feedback label. The actual sample
 // consumes this material and biology must produce its own adverse result.
 const material=lookupEcologyObject(f.e.ecology,f.piece);assert.ok(material);
 material.toxicity=.3;
 assert.equal(f.finish({type:'sample',targetId:f.piece}).code,'SWALLOWED');
 const ingestionId=f.n.lastResult.ingestionId;assert.ok(ingestionId);
 for(let i=0;i<480&&!f.n.physiology.feedback.some(e=>e.ingestionId===ingestionId&&e.effect==='discomfort');i++)f.advance(.25);
 const event=f.n.physiology.feedback.find(e=>e.ingestionId===ingestionId&&e.effect==='discomfort');
 assert.ok(event);assert.ok(procedureFeedbackWitness(f.n,event));
 const method=f.n.discovery.techniques.find(t=>t.sourceId===f.piece&&t.steps[0]?.type==='grasp');
 assert.equal(method.confidence,'revised');
 assert.equal(f.finish({type:'release',targetId:f.piece}).code,'object_released');
 f.prepare();const after=choice(f);
 assert.notEqual(after.source,f.piece);
 console.log('contrary-outcome',JSON.stringify({source:f.piece,event:event.effect,confidence:method.confidence,next:after.source,action:after.result.action.type}));
 // This verifies retained exact-method caution through real action/biology. It
 // does not isolate new private ordering from the pre-existing revision gate.
});
