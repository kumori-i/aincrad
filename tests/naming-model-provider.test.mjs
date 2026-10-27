import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
const require=createRequire(import.meta.url);
const {ModelService,validateNamingProposal,parseNamingProposal,validateConfig}=require('../desktop/model-provider.cjs');
const cues={shape:'tuft with narrow blades',color:'green',texture:'fibrous'};
const evidence=(agentId='aster')=>({version:1,agentId,observedAt:2,example:{objectId:'object:675',cues:{...cues},times:[1,2]},lexicon:[],individualNames:[]});
const response=value=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(value)}}]}));
const turn=()=>new Promise(resolve=>setImmediate(resolve));

test('naming IPC keeps a strict bounded sensory-only payload, detached from caller state',()=>{
  const input=evidence(),result=validateNamingProposal(input);input.example.cues.color='pink';assert.equal(result.example.cues.color,'green');
  const withLexicon=evidence();withLexicon.lexicon=[{token:'velari',cues,source:'heard',speakerId:'mira'}];withLexicon.individualNames=[{token:'naluri',objectId:'object:7',speakerId:'aster'}];assert.deepEqual(validateNamingProposal(withLexicon),withLexicon);
  for(const mutate of [
    x=>x.species='hidden',x=>delete x.individualNames,x=>x.individualNames=Array(73).fill({token:'velari',objectId:'object:1',speakerId:'aster'}),
    x=>x.individualNames=[{token:'velari',objectId:'object:1',speakerId:'human'}],x=>x.individualNames=[{token:'velari',objectId:'object:1',speakerId:'aster',species:'hidden'}],
    x=>x.individualNames=Array(2).fill({token:'velari',objectId:'object:1',speakerId:'aster'}),x=>x.action={type:'sample'},x=>x.example.cues.edible=true,x=>x.example.cues.shape='x'.repeat(101),
    x=>x.example.cues.shape='bad\ncue',x=>x.example.cues={},x=>x.example.objectId='object:0',x=>x.agentId='human',
    x=>x.observedAt=-1,x=>x.observedAt=Infinity,x=>x.example.times=[2,1],x=>x.example.times=[2,2],x=>x.example.times=[1,3],
    x=>x.example.times=[0,1,2],x=>x.example.extra='hidden',x=>x.lexicon=Array(73).fill({token:'velari',cues,source:'own',speakerId:'aster'}),
    x=>x.lexicon=[{token:'velari',cues,source:'heard',speakerId:'aster'}],x=>x.lexicon=[{token:'velari',cues,source:'own',speakerId:'mira'}],
    x=>x.lexicon=[{token:'velari',cues:{...cues,materialKind:'hidden'},source:'own',speakerId:'aster'}],
    x=>x.lexicon=[{token:'velari',cues,source:'own',speakerId:'aster',action:'eat'}],
    x=>x.lexicon=Array(2).fill({token:'velari',cues,source:'own',speakerId:'aster'}),
  ]){const bad=evidence();mutate(bad);assert.throws(()=>validateNamingProposal(bad));}
  assert.throws(()=>validateConfig({enabled:true,model:'bad\nmodel'}),/model name/);
});

test('naming output admits only a token or explicit abstention, not explanations/actions/safety claims',()=>{
  assert.deepEqual(parseNamingProposal('{"token":"velari"}'),{token:'velari'});
  assert.deepEqual(parseNamingProposal('{"token":null}'),{token:null});
  for(const content of ['{}','null','[]','{"token":"Velari"}','{"token":"x"}','{"token":"constructor"}','{"token":"two words"}',
    '{"token":"velari","action":{"type":"sample"}}','{"token":"velari","safe":true}','{"token":"velari","model":"forged"}',
    '```json\n{"token":"velari"}\n```','x'.repeat(1025)])assert.throws(()=>parseNamingProposal(content));
});

test('scripted naming HTTP mock uses dedicated prompt, minimal evidence, JSON response and configured-model provenance',async()=>{
  let sent;
  const service=new ModelService({config:{enabled:true,model:'scripted-naming-mock',maxTokens:700},fetchImpl:async(url,options)=>{sent={url,options,body:JSON.parse(options.body)};return response({token:'velari'});}});
  const result=await service.proposeName(evidence());
  assert.deepEqual(result,{token:'velari',model:'scripted-naming-mock'});
  assert.equal(sent.url,'http://127.0.0.1:11434/v1/chat/completions');assert.equal(sent.options.redirect,'error');
  assert.equal(sent.body.model,'scripted-naming-mock');assert.equal(sent.body.max_tokens,96);assert.equal(sent.body.response_format.type,'json_object');
  assert.deepEqual(JSON.parse(sent.body.messages[1].content),evidence());
  assert.match(sent.body.messages[0].content,/pretrained associations are not evidence/);assert.match(sent.body.messages[0].content,/no actions or tools/);
  assert.match(sent.body.messages[0].content,/species, materials, food, edibility, safety/);assert.match(sent.body.messages[0].content,/abstain/);assert.match(sent.body.messages[0].content,/exact individuals, NOT categories/);
  assert.equal(service.status().callsThisHour,1);assert.equal(service.status().pending,false);
});

test('disabled model, invalid response and exhaustion never invent a fallback name',async()=>{
  let calls=0;const disabled=new ModelService({fetchImpl:async()=>{calls++;return response({token:'velari'});}});
  await assert.rejects(disabled.proposeName(evidence()),/No local model/);assert.equal(calls,0);
  const invalid=new ModelService({config:{enabled:true,model:'scripted-naming-mock'},fetchImpl:async()=>response({token:'velari',action:{type:'sample'}})});
  await assert.rejects(invalid.proposeName(evidence()),/only a short/);
  const abstain=new ModelService({config:{enabled:true,model:'scripted-naming-mock',maxCallsPerHour:1},fetchImpl:async()=>response({token:null})});
  assert.deepEqual(await abstain.proposeName(evidence()),{token:null,model:'scripted-naming-mock'});
  await assert.rejects(abstain.proposeName(evidence()),/budget/);
});

test('naming requests share one serialized budget, refuse same-character overlap and cancel queued work',async()=>{
  const resolvers=[],started=[];
  const service=new ModelService({config:{enabled:true,model:'scripted-naming-mock',maxCallsPerHour:2},fetchImpl:(_url,options)=>{started.push(JSON.parse(JSON.parse(options.body).messages[1].content).agentId);return new Promise(resolve=>resolvers.push(resolve));}});
  const a=service.proposeName(evidence()),b=service.proposeName(evidence('mira'));
  await assert.rejects(service.proposeName(evidence()),/already/);await assert.rejects(service.proposeName(evidence('mira')),/already/);
  assert.deepEqual(started,['aster']);resolvers[0](response({token:'velari'}));await a;await turn();assert.deepEqual(started,['aster','mira']);
  resolvers[1](response({token:'seluni'}));await b;assert.equal(service.status().callsThisHour,2);
  await assert.rejects(service.proposeName(evidence()),/budget/);
  const hanging=new ModelService({config:{enabled:true,model:'scripted-naming-mock'},fetchImpl:()=>new Promise(()=>{})});
  const first=hanging.proposeName(evidence()),firstRejected=assert.rejects(first,/cancelled/);
  const second=hanging.proposeName(evidence('mira')),secondRejected=assert.rejects(second,/cancelled/);
  hanging.cancel('mira');await secondRejected;assert.deepEqual(hanging.status().pendingAgentIds,['aster']);
  hanging.cancel();await firstRejected;assert.equal(hanging.status().pending,false);
});

test('timeout and reconfiguration reject naming even if transport ignores abort and later returns a token',async()=>{
  let complete;const service=new ModelService({config:{enabled:true,model:'scripted-old-mock',timeoutMs:1000},fetchImpl:()=>new Promise(resolve=>complete=resolve)});
  const call=service.proposeName(evidence());await assert.rejects(call,/timed out/);complete(response({token:'velari'}));await turn();
  assert.equal(service.status().pending,false);
  const again=service.proposeName(evidence()),rejected=assert.rejects(again,/cancelled/);
  service.configure({enabled:true,model:'scripted-new-mock'});await rejected;complete(response({token:'oldword'}));await turn();
  assert.equal(service.status().model,'scripted-new-mock');assert.equal(service.status().pending,false);
});


test('sandboxed preload exposes a fixed naming channel, not a generic IPC or host interface',async()=>{
  const exposed={},calls=[];
  runInNewContext(await readFile(new URL('../desktop/preload.cjs',import.meta.url),'utf8'),{
    require:name=>{assert.equal(name,'electron');return {contextBridge:{exposeInMainWorld:(name,value)=>exposed[name]=value},ipcRenderer:{invoke:(...args)=>{calls.push(args);return Promise.resolve({token:null,model:'scripted-preload-mock'});},on(){}}};},
  });
  const input=evidence();assert.deepEqual(await exposed.aincradAgent.proposeName(input),{token:null,model:'scripted-preload-mock'});
  assert.deepEqual(calls,[['aincrad:model-name',input]]);assert.equal(Object.isFrozen(exposed.aincradAgent),true);
  for(const field of ['invoke','send','require','exec','shell','filesystem'])assert.equal(exposed.aincradAgent[field],undefined);
});
