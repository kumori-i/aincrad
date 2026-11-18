import test from 'node:test';
import assert from 'node:assert/strict';
import {createChoiceDiagnosticCollector,validateChoiceDiagnostic} from '../scripts/choice-diagnostic-v2-collector.mjs';
import {analyzeChoiceDiagnosticPair} from '../scripts/choice-diagnostic-v2-analyze.mjs';
import {CHOICE_DIAGNOSTIC_V2 as P} from '../scripts/choice-diagnostic-v2-protocol.mjs';
import {sha256,comparableHash} from '../scripts/producer-retest-ci-namespace.mjs';
const uuid='00000000-0000-4000-8000-000000000001';
const world=()=>({worldLineage:{instanceId:uuid,agents:[{agentId:'a',serial:7}]},visualReference:{worldId:uuid},characterMessages:{worldId:uuid},playerLessons:{worldId:uuid},agents:[{id:'a',elapsed:1,discovery:{},memory:{},physiology:{},epoch:0}]});
const diag=(serial=1)=>({serial,at:.1,candidateCount:2,prefixLength:0,reason:'insufficient-known-prefix',gates:[{index:0,reason:'outcome-not-repeated',sourceId:678,primitive:'pull',episodes:1}]});
test('collector preserves separate incarnation/diagnostic identities and raw inputs',()=>{
 const w=world(),d={...diag(),worldId:'untrusted',actorId:'other',incarnation:999,tick:999},before=JSON.stringify({w,d}),c=createChoiceDiagnosticCollector(w,{enabled:true,steps:2});
 c.capture(w,1,[d]);c.capture(w,2,[d]);const result=c.finish();
 assert.equal(result.rows.length,1);assert.equal(result.rows[0].incarnation,7);assert.equal(result.rows[0].serial,1);assert.equal(result.rows[0].worldId,uuid);assert.equal(result.rows[0].actorId,'a');assert.equal(result.rows[0].tick,1);
 assert.equal(JSON.stringify({w,d}),before);assert.equal(result.rows[0].gates.length,1,'unreached candidate stays absent');
 result.rows[0].gates=[];assert.equal(d.gates.length,1);assert.throws(()=>c.finish());
});
test('gaps, rollback, vanished snapshot and changed identity irreversibly invalidate coverage',()=>{
 for(const mutate of [
  (w,c)=>c.capture(w,2,[diag()]),
  (w,c)=>c.capture(w,1,[diag(2)]),
  (w,c)=>{c.capture(w,1,[diag()]);c.capture(w,2,[null]);},
  (w,c)=>{c.capture(w,1,[diag()]);c.capture(w,2,[{...diag(),at:.2}]);},
  (w,c)=>{w.worldLineage.agents[0].serial++;c.capture(w,1,[diag()]);},
  (w,c)=>{w.agents[0]={...w.agents[0]};c.capture(w,1,[diag()]);},
  (w,c)=>{w.agents[0].memory={};c.capture(w,1,[diag()]);},
  (w,c)=>{c.capture(w,1,[diag()]);w.agents[0].elapsed=.5;c.capture(w,2,[diag()]);},
  (w,c)=>{w.worldLineage.instanceId='changed';c.capture(w,1,[diag()]);},
 ]){const w=world(),c=createChoiceDiagnosticCollector(w,{enabled:true,steps:2});assert.throws(()=>mutate(w,c));assert.throws(()=>c.finish());}
 const w=world(),c=createChoiceDiagnosticCollector(w,{enabled:true,steps:2});c.capture(w,1,[null]);assert.throws(()=>c.finish());
});
test('disabled collector refuses diagnostics; barrier validation never invents later probes',()=>{
 const w=world(),c=createChoiceDiagnosticCollector(w,{enabled:false,steps:1});assert.throws(()=>c.capture(w,1,[diag()]));
 assert.throws(()=>validateChoiceDiagnostic({...diag(),gates:[...diag().gates,{index:1,reason:'quoted'}]}));
 assert.doesNotThrow(()=>validateChoiceDiagnostic({...diag(),prefixLength:1,gates:[{index:0,reason:'quoted',sourceId:1,primitive:'pull'},{index:1,reason:'quoted',sourceId:2,primitive:'pull'},{index:1,reason:'effort-barrier'}]}));
 assert.throws(()=>validateChoiceDiagnostic({...diag(),reason:'ordered-known-prefix'}));
});
function pair(){
 const w=world(),raw=JSON.stringify(w),common={protocol:P.id,seed:P.seed,seconds:P.seconds,completedSteps:P.steps,status:'completed',source:P.runtimeSource,sourceAfter:P.runtimeSource,harnessSha256:'a'.repeat(64),failure:null,saveValid:true,initialRaw:raw,saveRaw:raw,initialSha256:sha256(raw),saveSha256:sha256(raw),initialComparableSha256:comparableHash(w),saveComparableSha256:comparableHash(w),rows:[],snapshots:[{actor:'a'}],agents:[{id:'a'}],choices:[],inquiryTransitions:[],activeOccupancySeconds:{a:{idle:1200}}};
 return [{...structuredClone(common),mode:'off',diagnostics:{enabled:false,coverage:'complete',steps:P.steps,rows:[]}},
 {...structuredClone(common),mode:'on',diagnostics:{enabled:true,coverage:'complete',steps:P.steps,rows:[{worldId:uuid,actorId:'a',incarnation:7,tick:6,...diag()}]}}];
}
test('analyzer proves byte/hash/parity requirements separately from outcome',()=>{
 const arms=pair(),before=JSON.stringify(arms),r=analyzeChoiceDiagnosticPair(...arms);assert.equal(r.status,'observer-parity-passed');assert.equal(r.comparableSets,0);assert.equal(JSON.stringify(arms),before);
 for(const mutate of [a=>a[1].saveRaw+=' ',a=>a[1].rows.push({}),a=>a[1].sourceAfter='b'.repeat(64),a=>a[1].harnessSha256='b'.repeat(64),a=>a[1].completedSteps--,a=>a[1].diagnostics.rows[0].incarnation++,a=>a[1].diagnostics.rows[0].serial++,a=>a[1].diagnostics.coverage='partial',a=>delete a[0].choices]){
  const p=pair();mutate(p);assert.throws(()=>analyzeChoiceDiagnosticPair(...p));
 }
});

function rewriteWorld(arm,field,mutate){const w=JSON.parse(arm[field+'Raw']);mutate(w);arm[field+'Raw']=JSON.stringify(w);arm[field+'Sha256']=sha256(arm[field+'Raw']);arm[field+'ComparableSha256']=comparableHash(w);}
test('matching malformed parity fields cannot masquerade as equality',()=>{
 for(const field of ['rows','snapshots','agents','choices','inquiryTransitions','activeOccupancySeconds'])for(const value of [null,1,'same',false]){
  const arms=pair();for(const a of arms)a[field]=value;assert.throws(()=>analyzeChoiceDiagnosticPair(...arms),field+String(value));
 }
 for(const mutate of [a=>a.rows=[null],a=>a.snapshots=[],a=>a.agents=[{id:'other'}],a=>a.activeOccupancySeconds={a:null},a=>a.activeOccupancySeconds={a:{idle:-1}}]){
  const arms=pair();arms.forEach(mutate);assert.throws(()=>analyzeChoiceDiagnosticPair(...arms));
 }
});
test('raw hash-consistent malformed initial/save lineage is rejected',()=>{
 for(const field of ['initial','save'])for(const mutate of [
  w=>w.worldLineage.agents.push({...w.worldLineage.agents[0]}),
  w=>w.agents.push({...w.agents[0]}),
  w=>w.worldLineage.agents[0].agentId='',
  w=>w.worldLineage.agents[0].serial=0,
  w=>{w.agents.push({id:'b'});w.worldLineage.agents.push({agentId:'b',serial:7});},
  w=>w.agents[0].id='other',
  w=>{w.agents=[];w.worldLineage.agents=[];},
 ]){const arms=pair();for(const a of arms)rewriteWorld(a,field,mutate);assert.throws(()=>analyzeChoiceDiagnosticPair(...arms));}
 const arms=pair();for(const a of arms)rewriteWorld(a,'save',w=>w.worldLineage.agents[0].serial++);assert.throws(()=>analyzeChoiceDiagnosticPair(...arms),/lineage changed/);
});
test('gate grammar rejects impossible reasons, counts, indices and suffixes',()=>{
 const quoted=index=>({index,reason:'quoted',sourceId:index+1,primitive:'pull'});
 for(const mutate of [
  d=>d.candidateCount=1,d=>d.gates[0].index=-1,d=>d.gates[0].index=.5,d=>d.gates[0].index=2,
  d=>{d.reason='full-capacity';d.candidateCount=1;d.gates=[];},
  d=>{d.gates=[quoted(0)];d.prefixLength=1;},
  d=>{d.gates=[quoted(0),{index:0,reason:'effort-barrier'}];},
  d=>d.gates=[{index:0,reason:'failure-barrier'}],
  d=>d.gates[0].episodes=2,
  d=>d.gates=[{index:0,reason:'motor-not-repeated',sourceId:1,primitive:'pull',acquire:2,sample:2}],
  d=>d.gates=[{index:0,reason:'motor-unreliable',sourceId:1,primitive:'pull',acquire:1,sample:2}],
 ]){const d=diag();mutate(d);assert.throws(()=>validateChoiceDiagnostic(d));}
 assert.doesNotThrow(()=>validateChoiceDiagnostic({...diag(),reason:'ordered-known-prefix',prefixLength:2,gates:[quoted(0),quoted(1)]}));
 assert.doesNotThrow(()=>validateChoiceDiagnostic({...diag(),prefixLength:1,gates:[quoted(0),{index:1,reason:'failure-barrier'}]}));
});
