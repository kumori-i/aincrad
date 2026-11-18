import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, choice } from './fixtures/procedure-cycle.mjs';
import { procedureCycleStatus,procedureWalkingContext,receiveProcedureAction,receiveProcedureMovement } from '../src/procedure-cycle.js';
test('genuine motor magnitude changes a complete remote method choice, with separately earned outcomes',()=>{
 const outcomes=[];
 for(const pace of ['dry','wading']){
  const f=fixture();assert.equal(procedureCycleStatus(f.n).methods,2);assert.equal(procedureCycleStatus(f.n).pending,0);
  assert.equal(procedureCycleStatus(f.n).movement,0,'uncommanded river drift during soaking grants no paid movement evidence');
  const before=procedureCycleStatus(f.n);receiveProcedureAction(f.n,{});receiveProcedureMovement(f.n,{});assert.deepEqual(procedureCycleStatus(f.n),before);
  f.soak();f.prepare();const absent=choice(f);assert.equal(absent.source,f.a.id,'without authentic movement the nearest incumbent stays');
  f.soak();f.at(pace==='dry'?{x:380,y:740}:{x:-1220,y:260});
  assert.equal(f.finish({type:'move',target:pace==='dry'?{x:400,y:720}:{x:-1200,y:240}}).code,'ARRIVED');
  assert.equal(procedureWalkingContext(f.n),'walk:ordinary:soaked');f.prepare();
  const learned=choice(f);console.log('mechanism',pace,JSON.stringify({choice:learned.status.choice,source:learned.source,pull:f.a.id,grasp:f.piece}));
  assert.equal(learned.status.choice.quotes.length,2);
  outcomes.push({pace,source:learned.source,pull:f.a.id,grasp:f.piece,quotes:learned.status.choice.quotes});
 }
 assert.equal(outcomes[0].source,outcomes[0].grasp,'fast personally measured walking favors farther cheaper grasp');
 assert.equal(outcomes[1].source,outcomes[1].pull,'slow personally measured walking favors nearer pull on unchanged current geometry');
 assert.deepEqual(outcomes[0].quotes.map(q=>q.handling),outcomes[1].quotes.map(q=>q.handling),'identical authentic motor training in both arms');
 assert.deepEqual(outcomes[0].quotes.map(q=>q.routeLength),outcomes[1].quotes.map(q=>q.routeLength),'same current routes; history changes pace magnitude only');
});

test('cancelled paid sample poisons the prefix and motor quote instead of disappearing',()=>{
 for(const cancelSample of [true,'first-hook','later-hook','changed-target','throw-hook']){
 const f=fixture({cancelSample});
 f.soak();f.at({x:380,y:740});assert.equal(f.finish({type:'move',target:{x:400,y:720}}).code,'ARRIVED');
 f.prepare();const learned=choice(f);
 assert.equal(learned.source,f.a.id);
 assert.deepEqual(learned.status.choice.quotes,[]);
 }
});

test('copied delayed outcomes cannot activate learned ordering even with genuine motor history',()=>{
 const f=fixture({cloneFeedback:true});
 assert.equal(procedureCycleStatus(f.n).methods,0);
 f.soak();f.at({x:380,y:740});assert.equal(f.finish({type:'move',target:{x:400,y:720}}).code,'ARRIVED');
 f.prepare();const learned=choice(f);
 assert.equal(learned.source,f.a.id);
 assert.deepEqual(learned.status.choice.quotes,[]);
});
