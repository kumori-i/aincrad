import {normalizeActorChangeMemory} from './fixtures/change-memory-namespace.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,choice} from './fixtures/procedure-cycle.mjs';
import {orderProcedureCandidates,procedureCycleStatus,setProcedureDiagnostics,procedureEligibilityDiagnostics,retireProcedureHistory} from '../src/procedure-cycle.js';
import {DISCOVERY_RULES} from '../src/discovery-config.js';
import {projectPhysiology} from '../src/biology.js';
const candidates=f=>[f.a.id,f.piece].map(sourceId=>f.n.discovery.techniques.find(t=>t.sourceId===sourceId));
function run(f,cs,route=()=>0){orderProcedureCandidates(f.n,cs,route);return procedureEligibilityDiagnostics(f.n);}
test('opt-in diagnostic reader cannot create state; no-state snapshot is immutable and contains no identities',()=>{
 const n={elapsed:0,epoch:0,discovery:{},physiology:{}};
 assert.equal(procedureEligibilityDiagnostics(n),null);assert.equal(procedureCycleStatus(n),null);
 setProcedureDiagnostics(n,true);assert.equal(procedureEligibilityDiagnostics(n),null);
 const cs=[{},{}];assert.equal(orderProcedureCandidates(n,cs,()=>{throw Error('unreached');}),cs);
 const d=procedureEligibilityDiagnostics(n);assert.equal(d.reason,'no-state');assert.equal(d.serial,1);assert.deepEqual(d.gates,[]);
 assert.throws(()=>d.gates.push({}));assert.throws(()=>d.reason='other');assert.equal(procedureCycleStatus(n),null);
 for(const field of ['id','scene','memory','epoch','elapsed']){const old=n[field];n[field]=field==='elapsed'?-1:field==='epoch'?1:'different';assert.equal(procedureEligibilityDiagnostics(n),null,field);n[field]=old;assert.equal(procedureEligibilityDiagnostics(n),d);}
 setProcedureDiagnostics(n,false);assert.equal(procedureEligibilityDiagnostics(n),null);
});
test('actual early gates, quote barriers and opt-in parity with real earned history',()=>{
 const f=fixture();f.soak();f.prepare();const cs=candidates(f);assert.ok(cs.every(Boolean));
 let calls=0;const route=()=>{calls++;return 0;};
 const before=JSON.stringify(f.n),off=orderProcedureCandidates(f.n,cs,route),offStatus=procedureCycleStatus(f.n),offCalls=calls;
 assert.equal(procedureEligibilityDiagnostics(f.n),null);
 setProcedureDiagnostics(f.n,true);calls=0;const on=orderProcedureCandidates(f.n,cs,route);
 assert.deepEqual(on,off);assert.deepEqual(procedureCycleStatus(f.n),offStatus);assert.equal(calls,offCalls);assert.equal(JSON.stringify(f.n),before);
 let d=procedureEligibilityDiagnostics(f.n);assert.equal(d.reason,'ordered-known-prefix');assert.deepEqual(d.gates.map(g=>g.reason),['quoted','quoted']);
 const serial=d.serial;for(let i=0;i<10;i++)assert.equal(procedureEligibilityDiagnostics(f.n),d);assert.equal(d.serial,serial);
 assert.equal(run(f,[cs[0]]).reason,'less-than-two');
 const inventory=f.n.inventory.items;f.n.inventory.items=Array(DISCOVERY_RULES.capacity).fill('authored-capacity');assert.equal(run(f,cs).reason,'full-capacity');f.n.inventory.items=inventory;
 d=run(f,[{...cs[0],sourceId:'unearned'},cs[1]],()=>{throw Error('route must not be reached');});assert.equal(d.gates[0].reason,'outcome-missing');assert.equal(d.gates.length,1);
 d=run(f,cs,()=>NaN);assert.equal(d.gates[0].reason,'route-unavailable');
 d=run(f,cs,()=>1);assert.equal(d.gates[0].reason,'movement-context-missing');
 d=run(f,[cs[0],{...cs[1],failures:(cs[0].failures??0)+1}]);assert.deepEqual(d.gates.map(g=>g.reason),['quoted','failure-barrier']);
 Object.assign(f.n.physiology,{availableEnergyKcal:2000,satietyHours:3});projectPhysiology(f.n);
 d=run(f,cs);assert.equal(d.gates[0].reason,'body-not-relevant');
 f.needs();f.n.wetness=0;
 // Body/context changes use actual projection, never private method injection.
 retireProcedureHistory(f.n);assert.equal(procedureEligibilityDiagnostics(f.n),null);assert.equal(run(f,cs).reason,'no-state');
});
test('genuine cancelled sampling is reported as unreliable outcome, without probing later methods',()=>{
 const f=fixture({cancelSample:true});f.soak();f.prepare();setProcedureDiagnostics(f.n,true);
 const d=run(f,candidates(f),()=>{throw Error('unreached');});assert.equal(d.gates[0].reason,'outcome-unreliable');assert.equal(d.gates.length,1);
});

test('diagnostic inspection is pure across temporary scope mismatch and rollback',()=>{
 const f=fixture();f.soak();f.prepare();const n=f.n,cs=candidates(f);
 setProcedureDiagnostics(n,true);run(f,cs);const d=procedureEligibilityDiagnostics(n),status=procedureCycleStatus(n),before=JSON.stringify(n);
 for(const field of ['epoch','memory','discovery','physiology','scene','elapsed']){
  const old=n[field];n[field]=field==='elapsed'?-1:field==='epoch'?old+1:field==='scene'?'other':{};
  assert.equal(procedureEligibilityDiagnostics(n),null,field);
  n[field]=old;assert.equal(procedureEligibilityDiagnostics(n),d,`${field}: read must not delete snapshot`);
  assert.deepEqual(procedureCycleStatus(n),status);
 }
 const now=n.elapsed;n.elapsed=now+20;assert.equal(procedureEligibilityDiagnostics(n),d);n.elapsed=now+10;assert.equal(procedureEligibilityDiagnostics(n),d,'future inspection cannot move retirement clock');n.elapsed=now;
 assert.equal(JSON.stringify(n),before);
 n.epoch++;orderProcedureCandidates(n,cs,()=>{throw Error('unreached');});n.epoch--;
 assert.equal(procedureCycleStatus(n),null,'actual policy scope loss retires authority');
 assert.equal(procedureEligibilityDiagnostics(n),null,'new scope snapshot cannot masquerade as restored scope');
});

test('throwing diagnostic storage cannot affect ordered choices, route calls, RNG or private policy state',()=>{
 const f=fixture();f.soak();f.prepare();const n=f.n,cs=candidates(f);
 let calls=0;const route=()=>{calls++;return 0;};
 const baseline=orderProcedureCandidates(n,cs,route),expectedCalls=calls,status=procedureCycleStatus(n),before=JSON.stringify(n),rng=n.rng;
 setProcedureDiagnostics(n,true);
 const freeze=Object.freeze;
 // Fault only the observer's diagnostic gate or final snapshot allocation;
 // policy choices/quotes and real engine state retain normal Object.freeze.
 for(const target of ['gate','snapshot']){
  let injected=0;calls=0;
  Object.freeze=value=>{
   if(value&&typeof value==='object'&&(target==='gate'&&Object.hasOwn(value,'reason')&&Object.hasOwn(value,'index')||target==='snapshot'&&Object.hasOwn(value,'serial')&&Object.hasOwn(value,'evaluation'))){injected++;throw Error('injected diagnostic allocation failure');}
   return freeze(value);
  };
  try{assert.deepEqual(orderProcedureCandidates(n,cs,route),baseline);}finally{Object.freeze=freeze;}
  assert.ok(injected>0,target);assert.equal(calls,expectedCalls);assert.equal(n.rng,rng);assert.equal(JSON.stringify(n),before);assert.deepEqual(procedureCycleStatus(n),status);
 }
});


test('independent authored arms retain identical activated discovery actions and private evidence',()=>{
 const outputs=[];
 for(const enabled of [false,true]){
  const f=fixture();setProcedureDiagnostics(f.n,enabled);f.soak();f.at({x:380,y:740});
  assert.equal(f.finish({type:'move',target:{x:400,y:720}}).code,'ARRIVED');f.prepare();
  const selected=choice(f);assert.equal(selected.source,f.piece);
  if(enabled){const d=procedureEligibilityDiagnostics(f.n);assert.equal(d.reason,'ordered-known-prefix');assert.equal(d.prefixLength,2);}
  else assert.equal(procedureEligibilityDiagnostics(f.n),null);
  outputs.push({selected,actor:normalizeActorChangeMemory(structuredClone(f.n),f.state),rng:f.n.rng});
 }
 assert.deepEqual(outputs[0],outputs[1]);
});
