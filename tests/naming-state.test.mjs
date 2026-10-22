import test from 'node:test';
import assert from 'node:assert/strict';
import { createLexicon, validLexicon, chooseOwnName, recordGrounding, resolveName, confirmReference, lexicalLabels, markNameAnnounced, markReferenceRequested, validNameToken, OWN_NAME_LIMIT, HEARD_NAME_LIMIT } from '../src/naming-state.js';
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

test('paid completed own encounter chooses supplied token without physical RNG or type dependence',()=>{
  const {n,row}=named(),before=123;
  assert.equal(n.rng,before);assert.ok(validNameToken(row.token));assert.equal(validLexicon(n.lexicon,n),true);
  const a=npc(),b=npc();a.hiddenSpecies='tree';b.hiddenSpecies='fish';
  assert.equal(named(a,'object:7').row.token,named(b,'object:901').row.token);
  assert.notEqual(named(npc('aster')).row.token,named(npc('mira')).row.token);
  assert.equal(lexicalLabels(n)[0].status,'owner-chosen');
});
test('inspection is required; malformed, unpaid, stale, foreign and duplicate outcomes never reroll',()=>{
  for(const alter of [f=>f.e.ok=false,f=>f.n.memory.experience=[],f=>f.n.memory.experience[0].details.action.targetId='object:2',f=>f.e.durationSeconds=0,f=>f.sight.at--,f=>f.sight.actorPosition.x=1,f=>delete f.n.memory.experience[0].details.result.handling]){
    const n=npc(),data=encounter(n);alter({n,...data});assert.equal(chooseOwnName(n,data.e,data.sight),null);assert.equal(n.lexicon,undefined);
  }
  const n=npc();const {e,sight}=encounter(n);chooseOwnName(n,e,sight);const state=clone(n.lexicon);
  chooseOwnName(n,e,sight);assert.deepEqual(n.lexicon,state);
});
test('heard association is source qualified, synonym tolerant, duplicate idempotent and conflict preserving',()=>{
  const n=npc('mira');recordGrounding(n,'aster','lumava','object:1',event(1,90));const original=clone(n.lexicon);
  recordGrounding(n,'aster','lumava','object:1',event(2,91));assert.deepEqual(n.lexicon,original);
  assert.equal(resolveName(n,'lumava','aster',['object:1']),'object:1');assert.equal(resolveName(n,'lumava','aster',[]),null);
  recordGrounding(n,'aster','savumi','object:1',event(2,91));assert.equal(resolveName(n,'savumi','aster',['object:1']),'object:1');
  recordGrounding(n,'aster','lumava','object:2',event(3,92));assert.equal(resolveName(n,'lumava','aster',['object:1']),null);assert.equal(resolveName(n,'lumava',null,['object:1','object:2']),null);
  assert.equal(validLexicon(n.lexicon,n),true);
});
test('same words without valid gesture evidence cannot create association',()=>{
  const n=npc('mira');
  for(const bad of [{}, {...event(1),scene:'hidden'}, {...event(1),at:101}, {...event(1),objectPosition:{x:999,y:0}}, {...event(1),messageId:'message:0'}])assert.equal(recordGrounding(n,'aster','lumava','object:1',bad),null);
  for(const token of ['constructor','prototype','object','grasp','fish','This','foo bar','lo','a'.repeat(17),'lumava\n'])assert.equal(validNameToken(token),false);
  assert.equal(n.lexicon,undefined);
});
test('three separate later reference events confirm once, but prose and duplicate messages do not',()=>{
  const n=npc('mira');n.elapsed=104;const row=recordGrounding(n,'aster','lumava','object:1',event(1,100));
  assert.equal(confirmReference(n,row,{...confirmation(),selection:event(3,102)}),false);
  assert.equal(confirmReference(n,row,confirmation()),true);const saved=clone(n.lexicon);assert.equal(confirmReference(n,row,confirmation()),false);assert.deepEqual(n.lexicon,saved);
  assert.equal(lexicalLabels(n)[0].status,'confirmed');assert.equal(validLexicon(n.lexicon,n),true);
});
test('names persist independently of old sensory/action rows without recreating sight',()=>{
  const {n,row}=named();n.memory.experience=[];n.discovery={observations:{}};
  assert.equal(validLexicon(n.lexicon,n),true);assert.equal(resolveName(n,row.token,n.id,[]),null);assert.deepEqual(n.discovery.observations,{});
  assert.equal(resolveName(n,row.token,n.id,[row.objectId]),row.objectId);
  assert.equal(resolveName(n,row.token,n.id,['object:2']),null);
});
test('bounded non-evicting saturation cannot discard conflicts into false certainty',()=>{
  const n=npc('mira');
  for(let i=1;i<=HEARD_NAME_LIMIT;i++)assert.ok(recordGrounding(n,'aster',i===1?'lumava':`mava${String.fromCharCode(97+Math.floor(i/26))}${String.fromCharCode(97+i%26)}`,`object:${i}`,event(i,i)));
  assert.equal(resolveName(n,'lumava','aster',['object:1']),'object:1');const retained=clone(n.lexicon.heard);assert.equal(recordGrounding(n,'aster','lumava','object:99',event(99,99)),null);
  assert.equal(n.lexicon.saturated,true);assert.deepEqual(n.lexicon.heard,retained);assert.equal(validLexicon(n.lexicon,n),true);assert.equal(resolveName(n,'lumava','aster',['object:1']),null);
  const own=npc();for(let i=1;i<=100;i++){const f=encounter(own,`object:${i}`,i);chooseOwnName(own,f.e,f.sight);}
  assert.equal(own.lexicon.own.length,OWN_NAME_LIMIT);assert.equal(validLexicon(own.lexicon,own),true);
});
test('strict metadata rejects corrupt bytes, extraneous fields, owners, RNG, choices and geometry',()=>{
  const {n}=named();
  for(const alter of [s=>s.ownerId='mira',s=>s.rng++,s=>s.extra=1,s=>s.counter++,s=>s.own[0].token='arbitrary',s=>s.own[0].encounter.actionId=0,s=>s.own[0].encounter.objectPosition.x=Infinity,s=>s.own[0].encounter.objectId='object:99',s=>s.considered.push(1)]){
    const raw=clone(n.lexicon);alter(raw);assert.equal(validLexicon(raw,n),false);
  }
  assert.equal(validLexicon(n.lexicon,n,{pointValid:()=>false}),false);
});
test('speaker announcement and request admissions persist without replay or invented confirmation',()=>{
  const {n,row}=named();n.elapsed=110;
  assert.equal(markReferenceRequested(n,row,'mira',event(2,105)),false);
  assert.equal(markNameAnnounced(n,row,'mira',event(1,101)),true);
  assert.equal(markNameAnnounced(n,row,'mira',event(2,102)),false);
  assert.equal(markReferenceRequested(n,row,'mira',event(2,105)),true);
  assert.equal(markReferenceRequested(n,row,'mira',event(3,106)),false);
  const loaded=clone(n.lexicon);assert.equal(validLexicon(loaded,n),true);assert.equal(loaded.own[0].checkedWith.length,1);assert.deepEqual(loaded.heard,[]);
});

test('still-retained action and speech contradictions fail closed; compaction alone does not',()=>{
  const {n,row}=named();const receipt=n.memory.experience.find(r=>r.id===row.encounter.actionId);receipt.details.result.ok=false;
  assert.equal(validLexicon(n.lexicon,n),false);n.memory.experience=[];assert.equal(validLexicon(n.lexicon,n),true);
  n.discovery={experiments:[{id:row.encounter.experimentId,targetId:'object:99'}]};assert.equal(validLexicon(n.lexicon,n),false);
  const listener=npc('mira');const heard=recordGrounding(listener,'aster','lumava','object:1',event(1,90));
  listener.social={heard:[{id:'message:1',at:90,senderId:'aster',recipientId:'mira',channel:'peer'}]};assert.equal(validLexicon(listener.lexicon,listener),true);
  listener.social.heard[0].senderId='mira';assert.equal(validLexicon(listener.lexicon,listener),false);
  listener.social.heard=[];assert.equal(validLexicon(listener.lexicon,listener),true);assert.equal(heard.confirmation,null);
});
test('source-qualified homonyms resolve independently while bare word remains ambiguous',()=>{
  const {n,row}=named();recordGrounding(n,'mira',row.token,'object:99',event(1,90));
  assert.equal(resolveName(n,row.token,null,[row.objectId,'object:99']),null);
  assert.equal(resolveName(n,row.token,'aster',[row.objectId]),row.objectId);
  assert.equal(resolveName(n,row.token,'mira',['object:99']),'object:99');
});

test('word-only request needs no listener target sight until selection and confirmation',()=>{
  const n=npc('mira');n.elapsed=104;const row=recordGrounding(n,'aster','lumava','object:1',event(1,100));
  const proof=confirmation();proof.request.speakerPosition={x:390,y:0};proof.request.listenerPosition={x:780,y:0};
  // Speaker still sees target and listener. Listener cannot yet see target.
  assert.equal(confirmReference(n,row,proof),true);assert.equal(validLexicon(n.lexicon,n),true);
  const other=npc('mira');other.elapsed=104;const otherRow=recordGrounding(other,'aster','lumava','object:1',event(1,100));
  const invalid=clone(proof);invalid.selection.listenerPosition={x:780,y:0};assert.equal(confirmReference(other,otherRow,invalid),false);
});
