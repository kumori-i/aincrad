import test from 'node:test';
import assert from 'node:assert/strict';
import { createLexicon, validLexicon, chooseOwnName, recordGrounding, resolveName, confirmReference, lexicalLabels, markNameAnnounced, markReferenceRequested, recordRepairStep, validRepairCorrespondence, validNameToken, OWN_NAME_LIMIT, HEARD_NAME_LIMIT } from '../src/naming-state.js';
const clone=structuredClone;
function npc(id='aster',seed=42){return {id,seed,rng:123,elapsed:100,scene:'valley',position:{x:0,y:0},discovery:{experiments:[]},memory:{experience:[]}};}
function encounter(n,objectId='object:1',experimentId=1){
  const e={id:experimentId,actionId:experimentId,primitive:'inspect_object',targetId:objectId,ok:true,code:'OBJECT_OBSERVED',at:n.elapsed,durationSeconds:1.8};
  n.discovery.experiments.push(e);
  n.memory.experience.push({id:e.actionId,type:'action',at:e.at,details:{action:{type:e.primitive,targetId:e.targetId},result:{ok:true,code:e.code,durationSeconds:e.durationSeconds,handling:{source:'experienced',activeActionSeconds:e.durationSeconds,effort:'steady'}}}});
  return {e,sight:{objectId,at:n.elapsed,scene:'valley',actorPosition:{...n.position},objectPosition:{x:20,y:0}}};
}
function named(n=npc(),objectId='object:1'){
  for(let i=1;i<=10;i++){const {e,sight}=encounter(n,objectId,i);const row=chooseOwnName(n,e,sight);if(row)return {n,row};}
  assert.fail('bounded fixed seed did not name encounter');
}
const event=(num,at=num)=>({messageId:`message:${num}`,at,scene:'valley',speakerPosition:{x:0,y:0},listenerPosition:{x:10,y:0},objectPosition:{x:20,y:0}});
const confirmation=()=>({request:event(2,102),selection:event(3,103),confirmation:event(4,104)});

function repairFixture(){
  const {n:a,row}=named(),b=npc('mira');a.elapsed=b.elapsed=220;
  assert.equal(markNameAnnounced(a,row,b.id,event(1,101)),true);
  const request=event(2,105);assert.equal(markReferenceRequested(a,row,b.id,request),true);
  const clarification={messageId:'message:3',at:106,scene:'valley'};
  return {a,b,row,request,clarification};
}
test('repair receipts are optional, mirrored, bounded emissions with no positional clarification',()=>{
  const f=repairFixture(),{a,b,row,request,clarification}=f;
  assert.equal(Object.hasOwn(a.lexicon,'repairReceipts'),false);
  assert.equal(recordRepairStep(a,b,row.token,request,'clarification',clarification),true);
  assert.equal(validRepairCorrespondence([a,b]),true);
  assert.deepEqual(a.lexicon.repairReceipts,b.lexicon.repairReceipts);
  assert.deepEqual(Object.keys(a.lexicon.repairReceipts[0].clarification),['messageId','at','scene']);
  assert.equal(recordRepairStep(a,b,row.token,request,'clarification',clarification),false);
  assert.equal(recordRepairStep(a,b,row.token,request,'retry',event(5,108)),false);
  assert.equal(recordRepairStep(a,b,row.token,request,'repoint',event(4,107)),true);
  assert.equal(recordRepairStep(a,b,row.token,request,'repoint',event(5,108)),false);
  assert.equal(recordRepairStep(a,b,row.token,request,'retry',event(5,108)),false,'pointing alone is not grounding');
  const binding=recordGrounding(b,a.id,row.token,row.objectId,event(4,107));assert.ok(binding);
  assert.equal(recordRepairStep(a,b,row.token,request,'retry',event(5,108)),true);
  assert.equal(confirmReference(b,binding,{request:event(5,108),selection:event(6,109),confirmation:event(7,110)}),true);
  assert.equal(validLexicon(a.lexicon,a),true);assert.equal(validLexicon(b.lexicon,b),true);
  assert.equal(validRepairCorrespondence([a,b]),true);
  assert.equal(a.lexicon.own[0],row,'do not invalidate live owner row');
  assert.equal(b.lexicon.heard[0],binding,'do not invalidate live binding');
  assert.equal(recordRepairStep(a,b,row.token,request,'retry',event(8,111)),false);
  assert.equal(row.announcedTo.length,1);assert.equal(row.checkedWith.length,1);
});
test('malformed repairs fail closed without changing valid prior state',()=>{
  for(const mutate of [e=>e.objectId='object:1',e=>e.objectPosition={x:20,y:0},e=>e.at=105,e=>e.messageId='message:2',e=>e.at=225,e=>e.scene='elsewhere']){
    const {a,b,row,request,clarification}=repairFixture(),before=clone(a.lexicon);mutate(clarification);
    assert.equal(recordRepairStep(a,b,row.token,request,'clarification',clarification),false);
    assert.deepEqual(a.lexicon,before);assert.equal(b.lexicon,undefined);
  }
  const {a,b,row,request,clarification}=repairFixture();
  assert.equal(recordRepairStep(a,b,row.token,request,'clarification',clarification),true);
  const original=clone(a.lexicon);
  for(const mutate of [r=>r.listenerId='aster',r=>r.requestId='message:1',r=>r.extra=true,r=>r.clarification.objectId='object:1',r=>r.repoint=event(3,107),r=>r.retry=event(5,108)]){
    const raw=clone(original);mutate(raw.repairReceipts[0]);assert.equal(validLexicon(raw,a),false);
  }
  const duplicate=clone(original);duplicate.repairReceipts.push(clone(duplicate.repairReceipts[0]));assert.equal(validLexicon(duplicate,a),false);
  b.lexicon.repairReceipts[0].clarification.at=106.5;
  assert.equal(validLexicon(b.lexicon,b),true);assert.equal(validRepairCorrespondence([a,b]),false);
});
test('position-free receipts survive compaction; contradictory retained sender and missing counterpart fail',()=>{
  const {a,b,row,request,clarification}=repairFixture();
  assert.equal(recordRepairStep(a,b,row.token,request,'clarification',clarification),true);
  a.memory.experience=[];a.discovery.experiments=[];a.social={heard:[]};b.social={heard:[]};
  assert.equal(validLexicon(a.lexicon,a),true);assert.equal(validLexicon(b.lexicon,b),true);
  assert.equal(validRepairCorrespondence([a,b]),true);
  a.social.heard=[{id:'message:3',at:106,channel:'peer',senderId:'aster',recipientId:'mira'}];
  assert.equal(validLexicon(a.lexicon,a),false);
  a.social.heard=[];delete b.lexicon.repairReceipts;assert.equal(validRepairCorrespondence([a,b]),false);
});
test('repair aliases are exact, horizon is original-request anchored, and later conflicts remain historical',()=>{
  const {a,b,row,request,clarification}=repairFixture();
  assert.equal(recordRepairStep(a,b,row.token,request,'clarification',clarification),true);
  assert.equal(recordRepairStep(a,b,row.token,request,'repoint',event(4,107)),true);
  const binding=recordGrounding(b,a.id,row.token,row.objectId,event(4,107));assert.ok(binding);
  const altered=clone(b.lexicon);altered.repairReceipts[0].repoint.objectPosition.x++;
  assert.equal(validLexicon(altered,b),false,'matching IDs with different geometry are not aliases');
  a.elapsed=b.elapsed=230;
  assert.equal(recordRepairStep(a,b,row.token,request,'retry',event(5,225)),false,'deadline is not reset by re-point');
  assert.equal(recordRepairStep(a,b,row.token,request,'retry',event(5,108)),true);
  assert.ok(recordGrounding(b,a.id,row.token,'object:999',event(6,109)));
  assert.equal(resolveName(b,row.token,a.id,[row.objectId]),null,'new conflict remains visible');
  assert.equal(validLexicon(b.lexicon,b),true);
  assert.equal(validRepairCorrespondence([a,b]),true,'later ambiguity does not erase a consumed historical retry');
});
test('old binding cannot authorize retry after a re-point outside listener sight',()=>{
  const {a,b,row,request,clarification}=repairFixture();
  assert.ok(recordGrounding(b,a.id,row.token,row.objectId,event(1,101)));
  assert.equal(recordRepairStep(a,b,row.token,request,'clarification',clarification),true);
  const distant={...event(4,107),speakerPosition:{x:0,y:0},listenerPosition:{x:-390,y:0},objectPosition:{x:390,y:0}};
  assert.equal(recordRepairStep(a,b,row.token,request,'repoint',distant),true,'unresolved pointing still spends its budget');
  const before=clone(a.lexicon.repairReceipts);
  assert.equal(recordRepairStep(a,b,row.token,request,'retry',event(5,108)),false);
  assert.deepEqual(a.lexicon.repairReceipts,before);
  const forged=clone(a.lexicon);forged.repairReceipts[0].retry=event(5,108);
  assert.equal(validLexicon(forged,a),false);
});
