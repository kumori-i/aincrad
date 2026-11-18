// Pure analyzer: raw bytes are inputs, never overwritten or normalized in place.
import assert from 'node:assert/strict';
import {CHOICE_DIAGNOSTIC_V2 as P} from './choice-diagnostic-v2-protocol.mjs';
import {sha256,comparableHash,NORMALIZED_PATHS} from './producer-retest-ci-namespace.mjs';
import {validateChoiceDiagnostic,validateChoiceWorldScope} from './choice-diagnostic-v2-collector.mjs';
export function analyzeChoiceDiagnosticPair(off,on){
 const scopes=new Map();
 for(const [arm,mode]of [[off,'off'],[on,'on']]){
  assert.equal(arm.protocol,P.id);assert.equal(arm.mode,mode);assert.equal(arm.seed,P.seed);
  assert.equal(arm.seconds,P.seconds);assert.equal(arm.completedSteps,P.steps);assert.equal(arm.status,'completed');
  assert.equal(arm.source,P.runtimeSource);assert.equal(arm.sourceAfter,P.runtimeSource);
  assert.match(arm.harnessSha256??'',/^[a-f0-9]{64}$/);assert.equal(arm.failure,null);
  const worlds={};
  for(const field of ['initial','save']){
   assert.equal(typeof arm[field+'Raw'],'string');assert.equal(sha256(arm[field+'Raw']),arm[field+'Sha256']);
   worlds[field]=JSON.parse(arm[field+'Raw']);
   assert.equal(comparableHash(worlds[field]),arm[field+'ComparableSha256']);
  }
  const scope=validateChoiceWorldScope(worlds.initial);
  assert.deepEqual(validateChoiceWorldScope(worlds.save),scope,'Saved actor lineage changed');scopes.set(mode,scope);
  for(const field of ['rows','snapshots','agents','choices','inquiryTransitions']){
   assert.ok(Array.isArray(arm[field]),'Parity field must be an array');
   assert.ok(arm[field].every(x=>x!==null&&typeof x==='object'&&!Array.isArray(x)),'Parity entries must be records');
  }
  assert.ok(arm.snapshots.length>0);
  assert.deepEqual(arm.agents.map(a=>a.id).sort(),scope.actors.map(a=>a.actorId));
  const occupancy=arm.activeOccupancySeconds;assert.ok(occupancy!==null&&typeof occupancy==='object'&&!Array.isArray(occupancy));
  assert.deepEqual(Object.keys(occupancy).sort(),scope.actors.map(a=>a.actorId));
  for(const counts of Object.values(occupancy)){assert.ok(counts!==null&&typeof counts==='object'&&!Array.isArray(counts));for(const n of Object.values(counts))assert.ok(Number.isFinite(n)&&n>=0);}
  assert.equal(arm.saveValid,true);assert.equal(arm.diagnostics.enabled,mode==='on');
  assert.equal(arm.diagnostics.coverage,'complete');assert.equal(arm.diagnostics.steps,P.steps);
 }
 assert.equal(off.harnessSha256,on.harnessSha256);
 for(const field of ['initialComparableSha256','saveComparableSha256','rows','snapshots','agents','choices','inquiryTransitions','activeOccupancySeconds']){
  assert.ok(Object.hasOwn(off,field)&&Object.hasOwn(on,field),'Missing parity field');assert.deepEqual(off[field],on[field],field);
 }
 assert.deepEqual(off.diagnostics.rows,[]);assert.ok(Array.isArray(on.diagnostics.rows));
 const expected=new Map(scopes.get('on').actors.map(a=>[a.actorId,a.incarnation]));
 const seen=new Map(),counts={},reachedGateReasons={};
 for(const d of on.diagnostics.rows){
  validateChoiceDiagnostic(d);assert.equal(d.worldId,scopes.get('on').worldId);assert.equal(d.serial>0,true);
  // Incarnation is carried separately below; diagnostic serial is NOT lineage serial.
  assert.ok(expected.has(d.actorId));assert.equal(d.incarnation,expected.get(d.actorId));
  const previous=seen.get(d.actorId);assert.equal(d.serial,(previous?.serial??0)+1);
  assert.ok(Number.isSafeInteger(d.tick)&&d.tick>=1&&d.tick<=P.steps&&(!previous||d.tick>previous.tick));
  assert.ok(d.at<=P.seconds&&(!previous||d.at>=previous.at));seen.set(d.actorId,d);
  counts[d.reason]=(counts[d.reason]??0)+1;
  for(const g of d.gates)reachedGateReasons[g.reason]=(reachedGateReasons[g.reason]??0)+1;
 }
 return {protocol:P.id,status:'observer-parity-passed',seed:P.seed,normalizationPaths:[...NORMALIZED_PATHS],entryReasons:counts,reachedGateReasons,
  comparableSets:on.diagnostics.rows.filter(d=>d.prefixLength>=2).length,
  limitations:'Only reached gates; later candidates and downstream gates are unknown. No improvement, benefit, transfer or reliable survival conclusion.'};
}
