import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,choice} from './fixtures/procedure-cycle.mjs';
import {procedureCycleStatus,orderProcedureCandidates,reassessProcedureOutcomes} from '../src/procedure-cycle.js';
import {observeNpc,requestNpcAction,tickNpc,cancelNpcAction} from '../src/npc.js';
import {lookupEcologyObject} from '../src/ecology.js';
const fast=f=>{f.soak();f.at({x:380,y:740});assert.equal(f.finish({type:'move',target:{x:400,y:720}}).code,'ARRIVED');f.prepare();};

test('same-ID replacement retires exact-source authority only when actually observed',()=>{
 const f=fixture();fast(f);assert.equal(choice(f).source,f.piece);
 const old=f.e.ecology.materials.find(x=>x.id===f.piece);
 f.e.ecology.materials=f.e.ecology.materials.map(x=>x===old?structuredClone(old):x);
 assert.notEqual(lookupEcologyObject(f.e.ecology,f.piece),old);
 assert.equal(procedureCycleStatus(f.n).methods,2,'no hidden lifecycle probe from diagnostics');
 f.at({x:5000,y:5000});assert.ok(!observeNpc(f.n,f.e).objects.some(x=>x.id===f.piece));
 assert.equal(procedureCycleStatus(f.n).methods,2,'unseen replacement is not globally detected');
 f.at(f.b.position);assert.ok(observeNpc(f.n,f.e).objects.some(x=>x.id===f.piece));
 assert.equal(procedureCycleStatus(f.n).methods,1);
 f.prepare();assert.equal(choice(f).source,f.a.id);
 // A separately pending old-source ingestion cannot resurrect retired source evidence.
 f.at(f.a.position);assert.equal(f.finish({type:'pull',targetId:f.a.id}).code,'piece_detached');
 assert.equal(f.finish({type:'sample',targetId:f.n.inventory.items.at(-1)}).code,'SWALLOWED');
 assert.equal(procedureCycleStatus(f.n).pending,1);
 f.e.ecology.plants=f.e.ecology.plants.map(x=>x===f.a?structuredClone(f.a):x);
 assert.notEqual(lookupEcologyObject(f.e.ecology,f.a.id),f.a);
 observeNpc(f.n,f.e);assert.equal(procedureCycleStatus(f.n).pending,0);
 assert.equal(procedureCycleStatus(f.n).methods,0);
 f.advance(100);assert.equal(procedureCycleStatus(f.n).methods,0);
 f.needs();f.at(f.a.position);assert.equal(f.finish({type:'pull',targetId:f.a.id}).code,'piece_detached');
 const held=f.n.inventory.items.at(-1);assert.equal(f.finish({type:'sample',targetId:held}).code,'SWALLOWED');
 assert.equal(procedureCycleStatus(f.n).pending,1);
 const material=lookupEcologyObject(f.e.ecology,held);
 f.e.ecology.materials=f.e.ecology.materials.map(x=>x===material?structuredClone(material):x);
 observeNpc(f.n,f.e);assert.equal(procedureCycleStatus(f.n).pending,0,'replacement of pulled material retires pending even with unchanged source tree');
 f.advance(100);assert.equal(procedureCycleStatus(f.n).methods,0);
});

test('unknown candidates, failure priority, full hands and mismatched context preserve existing order',()=>{
 const f=fixture();fast(f);const learned=choice(f);assert.equal(learned.source,f.piece);
 const a=f.n.discovery.techniques.find(t=>t.sourceId===f.a.id),b=f.n.discovery.techniques.find(t=>t.sourceId===f.piece);
 const route=t=>learned.status.choice.quotes.find(q=>q.sourceId===t.sourceId)?.routeLength;
 const sameQuote={...a,id:'authored-comparator-tie'};
 assert.deepEqual(orderProcedureCandidates(f.n,[sameQuote,a],route),[sameQuote,a],'exact ties preserve original ordering');
 const unknown={...a,sourceId:'object:999999'};
 for(const candidates of [[unknown,a,b],[a,unknown,b],[{...a,failures:a.failures+1},b]])assert.deepEqual(orderProcedureCandidates(f.n,candidates,route),candidates);
 const items=f.n.inventory.items;f.n.inventory.items=['object:990001','object:990002','object:990003','object:990004'];
 assert.deepEqual(orderProcedureCandidates(f.n,[a,b],route),[a,b]);f.n.inventory.items=items;
 // Drying is real body evolution, not edited qualitative labels.
 f.at({x:200,y:720});f.advance(60);assert.deepEqual(orderProcedureCandidates(f.n,[a,b],route),[a,b]);
});

test('repeated diagnostic inspection cannot change private evidence or activated choices',()=>{
 const results=[];
 for(const inspectCycle of [false,true]){
  const f=fixture({inspectCycle});fast(f);const before=JSON.stringify(f.n),status=procedureCycleStatus(f.n);
  for(let i=0;i<20;i++)assert.deepEqual(procedureCycleStatus(f.n),status);
  assert.equal(JSON.stringify(f.n),before);
  const selected=choice(f);results.push({selected:selected.result,status:selected.status,source:selected.source,rng:f.n.rng});
  assert.throws(()=>{selected.status.choice.quotes[0].seconds=0;},TypeError);
  const now=f.n.elapsed,prior=f.n.memory;
  f.n.elapsed=now+20;if(inspectCycle)procedureCycleStatus(f.n);
  f.n.elapsed=now+10;assert.deepEqual(procedureCycleStatus(f.n),selected.status,'diagnostic future read does not advance retirement clock');
  f.n.memory={};if(inspectCycle)assert.equal(procedureCycleStatus(f.n),null);
  f.n.memory=prior;assert.deepEqual(procedureCycleStatus(f.n),selected.status,'diagnostic mismatch read cannot retire authentic state');

 }
 assert.deepEqual(results[0],results[1]);
});

test('genuine policy scope changes retire private history and restoration cannot revive it',async()=>{
 const {createOzarkWorldGeometry}=await import('../src/ozark-world-geometry.js');
 const {createOzarkState}=await import('../src/ozark-save.js');
 const {bindOzarkEcology}=await import('../src/ozark-ecology.js');
 const {bindOzarkWorldAgent}=await import('../src/ozark-agent-world.js');
 const {requestNpcAction,tickNpc}=await import('../src/npc.js');
 const geometry=createOzarkWorldGeometry();
 for(const field of ['epoch','memory','discovery','physiology','scene','ecology','elapsed']){
  const state=createOzarkState(geometry),n=state.agents[0],e=state.environment;
  bindOzarkEcology(e.ecology,geometry);const tree=e.ecology.plants.find(p=>p.kind==='apple_tree');tree.position={x:400,y:720};
  n.position={...tree.position};bindOzarkWorldAgent(n,geometry,state);observeNpc(n,e);
  requestNpcAction(n,{type:'pull',targetId:tree.id},e);for(let i=0;i<100&&n.active;i++)tickNpc(n,.25,e);
  assert.equal(n.lastResult.code,'piece_detached');assert.ok(procedureCycleStatus(n));
  const owner=field==='ecology'?e:n,previous=owner[field];
  owner[field]=field==='epoch'?previous+1:field==='scene'?'elsewhere':field==='elapsed'?-1:{};
  reassessProcedureOutcomes(n);assert.equal(procedureCycleStatus(n),null,field);
  owner[field]=previous;assert.equal(procedureCycleStatus(n),null,`${field} restoration does not revive private authority`);
 }
});

test('changed paid movement request or transient scope cannot silently preserve a known pace',()=>{
 for(const mutation of ['target','epoch']){
 const f=fixture();fast(f);assert.equal(choice(f).source,f.piece);
 f.n.discovery.run=null;f.soak();f.at({x:380,y:740});
 assert.equal(requestNpcAction(f.n,{type:'move',target:{x:400,y:720}},f.e).code,'STARTED');
 const epoch=f.n.epoch;if(mutation==='epoch')f.n.epoch++;
 tickNpc(f.n,1/60,f.e);assert.ok(f.n.active);
 if(mutation==='target')f.n.active.request.target.x+=1;else f.n.epoch=epoch;
 assert.equal(cancelNpcAction(f.n),true);
 f.prepare();const selected=choice(f);assert.equal(selected.source,f.a.id);
 assert.deepEqual(selected.status?.choice?.quotes??[],[]);
 }
});
