import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createNpc} from '../src/npc-state.js';
import {observeNpc} from '../src/npc.js';
import {decisionObservation} from '../src/controller.js';
const require=createRequire(import.meta.url);
const {validateConfig,validateObservation,parseDecision,ModelService}=require('../desktop/model-provider.cjs');

test('model configuration admits bounded loopback endpoints and excludes credentials, remote hosts and arbitrary paths',()=>{assert.equal(validateConfig({enabled:true,model:'fixture',endpoint:'http://127.0.0.1:11434/v1'}).enabled,true);for(const endpoint of ['https://example.com:443/v1','file:///etc/passwd','http://127.0.0.1:11434/admin','http://token@localhost:11434/v1'])assert.throws(()=>validateConfig({endpoint}));assert.throws(()=>validateConfig({enabled:true,model:''}));});
test('model output is structured restricted actions, not executable host code',()=>{assert.deepEqual(parseDecision('{"action":{"type":"drink"},"reason":"fixture"}'),{action:{type:'drink'},reason:'fixture'});assert.throws(()=>parseDecision('{"action":{"type":"exec","command":"x"}}'));assert.throws(()=>parseDecision('I already drank.'));});
test('provider exercises the real HTTP request contract using an explicitly labeled fixture without live inference',async()=>{const n=createNpc();observeNpc(n);let sent;const service=new ModelService({config:{enabled:true,model:'scripted-test-mock'},fetchImpl:async(url,options)=>{sent={url,body:JSON.parse(options.body)};return new Response(JSON.stringify({choices:[{message:{content:'{"action":{"type":"observe"},"reason":"scripted mock fixture"}'}}]}),{status:200});}});const result=await service.decide(decisionObservation(n));assert.equal(result.action.type,'observe');assert.equal(sent.url,'http://127.0.0.1:11434/v1/chat/completions');assert.equal(sent.body.response_format.type,'json_object');assert.equal(sent.body.model,'scripted-test-mock');assert.equal(service.status().pending,false);});
test('provider call limits and cancellation bound inference independently of gameplay',async()=>{const n=createNpc();observeNpc(n);const observation=decisionObservation(n);const service=new ModelService({config:{enabled:true,model:'fixture',maxCallsPerHour:1},fetchImpl:async()=>new Response(JSON.stringify({choices:[{message:{content:'{"action":{"type":"wait","seconds":1}}'}}]}))});await service.decide(observation);await assert.rejects(service.decide(observation),/budget/);const hanging=new ModelService({config:{enabled:true,model:'fixture'},fetchImpl:(_url,{signal})=>new Promise((_r,reject)=>signal.addEventListener('abort',()=>reject(new Error('cancelled'))))});const call=hanging.decide(observation);hanging.cancel();await assert.rejects(call,/cancelled/);});


test('model decisions admit bounded food and shelter actions while rejecting mixed references and hidden host tools',()=>{
  assert.deepEqual(parseDecision('{"action":{"type":"gather_food","foodId":"apple:starter"}}').action,{type:'gather_food',foodId:'apple:starter'});
  assert.deepEqual(parseDecision('{"action":{"type":"enter_shelter","shelterId":"refuge"}}').action,{type:'enter_shelter',shelterId:'refuge'});
  assert.equal(parseDecision('{"skillId":"food-gather-eat","foodId":"apple:starter"}').foodId,'apple:starter');
  for(const raw of [
    {action:{type:'move',sourceId:'river:east:0',foodId:'apple:starter'}},
    {action:{type:'move',target:{x:Infinity,y:0}}},
    {action:{type:'wait',seconds:500}},
    {action:{type:'eat',foodId:'x'.repeat(71)}},
    {action:{type:'exec',command:'anything'}}
  ])assert.throws(()=>parseDecision(JSON.stringify(raw)));
});

test('model bridge retains joint priorities and bounded procedure candidates, excluding unrelated state',()=>{
 const n=createNpc();observeNpc(n);const input=decisionObservation(n);input.player={secret:true};
 const output=validateObservation(input);
 assert.deepEqual(output.physiologicalPriorities,input.physiologicalPriorities);
 assert.deepEqual(output.procedureCandidates,input.procedureCandidates);
 assert.equal(output.procedureUse,input.procedureUse);
 assert.equal('player' in output,false);
 assert.throws(()=>validateObservation({...input,procedureCandidates:Array.from({length:13},()=>({skillId:'fixture'}))}));
});
