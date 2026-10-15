import test from 'node:test';
import assert from 'node:assert/strict';
import { freshState } from '../src/world.js';
import { requestNpcAction,tickNpc } from '../src/npc.js';
import { CONFIG } from '../src/config.js';
import { prepareSave,validateSave,writeSave } from '../src/save.js';
import { createTemporalLedger,beginTemporalDecision } from '../src/temporal-ledger.js';
import { encodeTemporalWire } from '../src/temporal-storage.js';
import { createSavePreparationProtocol,createSavePreparer,SAVE_PREPARATION } from '../src/save-preparation.js';

function formerPreparation(state){const{npc:alias,...saved}=validateSave(state,{restoring:false});for(const actor of saved.agents)if(actor.discovery?.temporal){actor.discovery.temporal=encodeTemporalWire(actor.discovery.temporal);saved.version=7;}return JSON.stringify(saved);}
const base=freshState();
test('pure preparation is byte-identical to previous synchronous save for both modes and temporal wire',()=>{
  for(const state of [structuredClone(base),freshState({mode:'legacy'})]){
    const before=structuredClone(state),expected=formerPreparation(state);
    assert.equal(prepareSave(state),expected);assert.deepEqual(state,before);
    let value;assert.equal(writeSave({setItem(key,text){assert.equal(key,CONFIG.saveKey);value=text;}},state),true);assert.equal(value,expected);
  }
  const state=structuredClone(base);for(const npc of state.agents){const memory=createTemporalLedger();beginTemporalDecision(memory,{at:0,context:{appearance:{shape:'observed'}},action:{type:'wait'}});npc.discovery.temporal=memory;}
  assert.equal(prepareSave(state),formerPreparation(state));assert.equal(JSON.parse(prepareSave(state)).version,7);
});
test('a real live action is untouched and keeps the previous serialized interruption contract',()=>{
  const state=structuredClone(base);assert.equal(requestNpcAction(state.npc,{type:'wait',seconds:5},state.environment).ok,true);tickNpc(state.npc,1/60,state.environment);state.elapsed=state.environment.elapsed=state.npc.elapsed;state.agents[1].elapsed=state.elapsed;assert.ok(state.npc.active);const before=structuredClone(state);assert.equal(prepareSave(state),formerPreparation(state));assert.deepEqual(state,before);assert.ok(state.npc.active);const saved=JSON.parse(prepareSave(state)).agents[0];assert.equal(saved.active,null);assert.equal(saved.interrupted,true);
});
test('protection and unsupported rules fail before any storage mutation',()=>{
  const blocked=structuredClone(base);Object.defineProperty(blocked,'saveBlocked',{value:true});let writes=0;
  assert.throws(()=>prepareSave(blocked),{code:'SAVE_BLOCKED'});assert.throws(()=>prepareSave(structuredClone(blocked),{blocked:true}),{code:'SAVE_BLOCKED'});
  for(const state of [blocked,{...base,version:999},{...base,environment:{...base.environment,worldRules:{version:999}}}])assert.equal(writeSave({setItem(){writes++;}},state),false);
  assert.equal(writes,0);
});
test('worker protocol holds capacity until matching release including failed results',()=>{
  const replies=[];let calls=0;const receive=createSavePreparationProtocol({send:r=>replies.push(r),prepare:(_state,{blocked})=>{calls++;if(blocked)throw Object.assign(Error(),{code:'SAVE_BLOCKED'});return '{}';},now:()=>1});
  const request={version:1,type:'prepare',id:1,epoch:3,blocked:false,state:{}};
  receive(request);assert.equal(replies.at(-1).ok,true);assert.equal(replies.at(-1).bytes,2);
  receive({...request,id:2});assert.equal(replies.at(-1).code,'BUSY');assert.equal(calls,1);
  receive({version:1,type:'release',id:1,epoch:4});receive({...request,id:3});assert.equal(replies.at(-1).code,'BUSY');
  receive({version:1,type:'release',id:1,epoch:3});receive({...request,id:4,blocked:true});assert.equal(replies.at(-1).code,'PROTECTED');
  receive({...request,id:5});assert.equal(replies.at(-1).code,'BUSY');assert.equal(calls,2);
});
test('fixed protocol rejects extra capabilities and malformed identity',()=>{
  const replies=[];let calls=0;const receive=createSavePreparationProtocol({send:r=>replies.push(r),prepare:()=>{calls++;return '{}';}});
  for(const value of [null,[],{version:2,id:1,epoch:1,type:'prepare'}, {version:1,id:0,epoch:1,type:'prepare'}])receive(value);
  assert.equal(replies.length,0);
  for(const patch of [{url:'https://example.invalid'}, {type:'commit'}, {blocked:'false'}])receive({version:1,id:1,epoch:1,type:'prepare',state:{},blocked:false,...patch});
  assert.equal(calls,0);assert.equal(replies.length,3);assert.ok(replies.every(r=>r.code==='INVALID_REQUEST'));
});
test('transport cap counts actual UTF-8 and never trims a prepared result',()=>{
  const replies=[];const receive=createSavePreparationProtocol({send:r=>replies.push(r),prepare:()=> '界'.repeat(Math.floor(SAVE_PREPARATION.maxBytes/3)+1)});
  receive({version:1,type:'prepare',id:1,epoch:1,blocked:false,state:{}});
  assert.equal(replies[0].code,'TOO_LARGE');assert.equal('text' in replies[0],false);
});
class FakeWorker{
  constructor(){this.events={};this.messages=[];this.terminated=false;}
  addEventListener(type,fn){this.events[type]=fn;}
  postMessage(value){this.messages.push(value);}
  terminate(){this.terminated=true;}
  reply(value){this.events.message({data:value});}
}
const good=(request)=>({version:1,type:'prepared',id:request.id,epoch:request.epoch,ok:true,text:'{}',bytes:2,prepareMs:1});
test('sender rejects a second request before posting or cloning and releases exactly once',async()=>{
  const worker=new FakeWorker(),client=createSavePreparer({workerFactory:()=>worker});
  const first=client.prepare(base,{epoch:2});await assert.rejects(client.prepare(base),{code:'BUSY'});assert.equal(worker.messages.length,1);
  worker.reply(good(worker.messages[0]));assert.equal((await first).epoch,2);assert.deepEqual(worker.messages[1],{version:1,type:'release',id:1,epoch:2});assert.equal(client.status().busy,false);client.dispose();
});
test('non-enumerable protection is checked before worker creation',async()=>{
  let created=0;const client=createSavePreparer({workerFactory:()=>{created++;return new FakeWorker();}}),state=structuredClone(base);Object.defineProperty(state,'saveBlocked',{value:true});
  await assert.rejects(client.prepare(state),{code:'PROTECTED'});await assert.rejects(client.prepare(base,{blocked:true}),{code:'PROTECTED'});assert.equal(created,0);client.dispose();
});
test('wrong epoch/ID and malformed result stop computation instead of exposing a stale text',async()=>{
  for(const patch of [{epoch:99},{id:99},{version:2},{bytes:Infinity},{bytes:0},{bytes:7},{text:123},{prepareMs:NaN}]){
    const worker=new FakeWorker(),client=createSavePreparer({workerFactory:()=>worker}),promise=client.prepare(base);worker.reply({...good(worker.messages[0]),...patch});await assert.rejects(promise,{code:'INVALID_REPLY'});assert.equal(worker.terminated,true);assert.equal(client.status().closed,true);
  }
});
test('worker errors, message errors, timeout and disposal reject a pending request without storage',async()=>{
  for(const kind of ['error','messageerror','dispose','timeout']){
    const worker=new FakeWorker(),client=createSavePreparer({workerFactory:()=>worker,timeoutMs:5}),promise=client.prepare(base);
    if(kind==='dispose')client.dispose();else if(kind!=='timeout')worker.events[kind]({preventDefault(){}});
    await assert.rejects(promise,{code:{error:'WORKER_FAILED',messageerror:'WORKER_MESSAGE_FAILED',dispose:'CLOSED',timeout:'TIMEOUT'}[kind]});assert.equal(worker.terminated,true);
  }
});
test('failed canonical preparation releases capacity and returns only allowlisted diagnostic',async()=>{
  const worker=new FakeWorker(),client=createSavePreparer({workerFactory:()=>worker}),promise=client.prepare(base);
  worker.reply({...good(worker.messages[0]),ok:false,code:'PROTECTED',text:undefined});await assert.rejects(promise,{code:'PROTECTED'});assert.equal(worker.messages[1].type,'release');assert.equal(client.status().busy,false);client.dispose();
});
test('postMessage clone failure is contained and terminates the worker',async()=>{
  const worker=new FakeWorker();worker.postMessage=()=>{throw Error('clone failed');};const client=createSavePreparer({workerFactory:()=>worker});
  await assert.rejects(client.prepare(base),{code:'WORKER_FAILED'});assert.equal(worker.terminated,true);
});
