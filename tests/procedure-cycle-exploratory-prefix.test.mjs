import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures/procedure-cycle.mjs';
import {orderProcedureCandidates,procedureEligibilityDiagnostics,procedureCycleStatus,setProcedureDiagnostics} from '../src/procedure-cycle.js';

// Engineering boundary control, NOT a replay of an ordinary seed or evidence
// that agents independently choose these repetitions. Setup has five finite
// source pieces. No private method/outcome rows or receipt IDs are authored.
test('paid exploratory prelude remains uncertain until ordinary bounded episode retention ages it out',()=>{
 const f=fixture({exploratoryFirst:true}),n=f.n;
 const actions=n.memory.experience.filter(r=>r.type==='action');
 const acquired=actions.find(r=>r.details.action.type==='pull'&&r.details.action.targetId===f.a.id&&r.details.result.ok);
 assert.ok(acquired);const material=acquired.details.result.materialId;
 const sample=actions.find(r=>r.id>acquired.id&&r.details.action.type==='sample'&&r.details.action.targetId===material&&r.details.result.ok);
 const prelude=actions.filter(r=>r.id>acquired.id&&r.id<sample.id&&r.details.action.targetId===material);
 assert.deepEqual(prelude.map(r=>[r.details.action.type,r.details.result.code]),[['inspect_object','OBJECT_OBSERVED'],['pull','nothing_detached']]);
 const extraPaid=prelude.reduce((sum,r)=>sum+r.details.result.durationSeconds,0);
 assert.ok(extraPaid>0);for(const r of prelude)assert.equal(r.details.result.handling.activeActionSeconds,r.details.result.durationSeconds);
 assert.ok(n.discovery.effects.some(e=>e.objectId===material&&e.ingestionId===sample.details.result.ingestionId&&e.effect==='sustained'&&e.energy==='easing'&&e.pain==='none'));
 setProcedureDiagnostics(n,true);
 const inspect=()=>{
  f.prepareContext();f.prepare();
  const candidates=[f.a.id,f.piece].map(id=>n.discovery.techniques.find(t=>t.sourceId===id));assert.ok(candidates.every(Boolean));
  const result=orderProcedureCandidates(n,candidates,()=>0);
  return {candidates,result,diagnostic:procedureEligibilityDiagnostics(n)};
 };
 const assertBlocked=episodes=>{
  const x=inspect();assert.deepEqual(x.result,x.candidates);assert.equal(x.diagnostic.reason,'insufficient-known-prefix');
  assert.deepEqual(x.diagnostic.gates,[{index:0,reason:'outcome-unreliable',sourceId:f.a.id,primitive:'pull',episodes,firstUnreliable:{uncertain:true,effect:'sustained',energy:'easing',pain:'none'}}]);
  assert.deepEqual(procedureCycleStatus(n).choice.quotes,[]);
  const before=JSON.stringify(n);for(let i=0;i<10;i++)assert.equal(procedureEligibilityDiagnostics(n),x.diagnostic);assert.equal(JSON.stringify(n),before);
 };
 const repeatClean=()=>{
  f.prepareContext();f.at(f.a.position);assert.equal(f.finish({type:'pull',targetId:f.a.id}).code,'piece_detached');
  const id=n.inventory.items.at(-1);assert.equal(f.finish({type:'sample',targetId:id}).code,'SWALLOWED');
  const ingestion=n.memory.experience.filter(r=>r.type==='action'&&r.details.action.type==='sample'&&r.details.action.targetId===id).at(-1).details.result.ingestionId;
  f.advance(100);assert.ok(n.discovery.effects.some(e=>e.objectId===id&&e.ingestionId===ingestion&&e.effect==='sustained'));
  assert.equal(f.finish({type:'release',targetId:id}).code,'object_released');return ingestion;
 };
 assertBlocked(2); // One exploratory and one clean episode from fixture.
 const repetitions=[];repetitions.push(repeatClean());assertBlocked(3);
 repetitions.push(repeatClean());assertBlocked(4);
 repetitions.push(repeatClean());
 assert.equal(new Set(repetitions).size,3,'Distinct paid ingestions, not duplicate feedback');
 const x=inspect();assert.equal(x.diagnostic.reason,'ordered-known-prefix');assert.equal(x.diagnostic.prefixLength,2);
 assert.deepEqual(x.diagnostic.gates.map(g=>g.reason),['quoted','quoted']);assert.equal(procedureCycleStatus(n).choice.quotes.length,2);
 assert.ok(n.memory.experience.some(r=>r.id===prelude[1].id&&r.details.result.ok===false),'No ledger deletion to obtain a quote');
 console.log('authored-exploratory-window',JSON.stringify({extraPaidSeconds:extraPaid,blockedAtEpisodes:[2,3,4],cleanRepetitions:repetitions.length,knownPrefix:x.diagnostic.prefixLength}));
});
