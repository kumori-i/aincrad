import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createNpc} from '../src/npc-state.js';
import {observeNpc,requestNpcAction,tickNpc} from '../src/npc.js';
import {decisionObservation} from '../src/controller.js';
import {bodySignals,sensedEnvironment} from '../src/interoception.js';
import {createEnvironment} from '../src/environment.js';
import {waterSource,foodSource,shelterSource} from '../src/resources.js';
import {canStand} from '../src/world.js';
const require=createRequire(import.meta.url);
const {validateObservation,parseDecision,ModelService}=require('../desktop/model-provider.cjs');
const observation=(id='aster')=>{const npc=createNpc();return {identity:{id,name:id==='mira'?'Mira':'Aster'},condition:{scene:'valley',lifecycle:'AWAKE',position:{x:276,y:760},body:bodySignals(npc),senses:sensedEnvironment(npc),inventory:{apples:0,capacity:3,flask:'empty'}}};};
const response=content=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(content)}}]}),{status:200});
const turn=()=>new Promise(resolve=>setImmediate(resolve));

test('the actual embodied observation crosses the model bridge using felt states only',()=>{
  const npc=createNpc();observeNpc(npc);
  const output=validateObservation(decisionObservation(npc));
  assert.equal(output.identity.id,'aster');
  assert.deepEqual(output.condition.body,bodySignals(npc));
  assert.equal('hydration' in output.condition,false);
  assert.equal('physiologicalPriorities' in output,false);
});

test('accumulated heat and cold warning cues cross the bridge without disclosing numerical strain',async()=>{
  const npc=createNpc();observeNpc(npc);
  for(const [side,cue] of [['hot','overheated'],['cold','shivering']]){
    npc.thermal.hot=side==='hot'?55:0;npc.thermal.cold=side==='cold'?55:0;
    const input=decisionObservation(npc),output=validateObservation(input);
    assert.equal(output.condition.body.thermal,cue);
    let sent;
    const service=new ModelService({config:{enabled:true,model:'scripted-test-mock'},fetchImpl:async(_url,options)=>{sent=JSON.parse(options.body);return response({action:{type:'observe'},reason:'Scripted thermal cue mock.'});}});
    await service.decide(input);const received=JSON.parse(sent.messages[1].content);
    assert.equal(received.condition.body.thermal,cue);assert.equal('hot' in received.condition.body,false);assert.equal('cold' in received.condition.body,false);
    assert.match(sent.messages[0].content,/overheated.*shivering/i);
  }
});

test('real learned food, water and shelter procedures remain usable without disclosing physical gain telemetry',()=>{
  const npc=createNpc(),environment=createEnvironment();
  const visit=resource=>{for(const [dx,dy] of [[0,0],[8,0],[0,8],[-8,0]])if(canStand(resource.x+dx,resource.y+dy,'valley')){npc.scene='valley';npc.position={x:resource.x+dx,y:resource.y+dy};observeNpc(npc,environment);return;}throw new Error('Fixture needs dry accessible ground.');};
  const water=waterSource('pond:spring:0');visit(water);npc.hydration=35;
  requestNpcAction(npc,{type:'fill_flask',sourceId:water.id},environment);requestNpcAction(npc,{type:'drink'},environment);
  const food=foodSource('apple:trail-orchard',environment);visit(food);npc.nourishment=35;
  requestNpcAction(npc,{type:'gather_food',foodId:food.id},environment);requestNpcAction(npc,{type:'eat'},environment);
  const shelter=shelterSource('refuge');visit(shelter);npc.thermal.hot=60;
  requestNpcAction(npc,{type:'enter_shelter',shelterId:shelter.id},environment);for(let i=0;i<100;i++)tickNpc(npc,.1,environment);
  assert.equal(npc.memory.skills.length,3);
  const output=validateObservation(decisionObservation(npc));
  assert.equal(output.skills.length,3);assert.equal(output.condition.scene,'refuge');
  for(const event of output.recentExperience)assert.equal('hydrationGain' in (event.result||{}),false);
});

test('exact reserves and body telemetry cannot leak through nested memories or cognition',()=>{
  for(const name of ['hydration','nourishment','health','energy','stamina','fatigue','temperature','riskCost','sleepPressure']){
    const input=observation();input.recentExperience=[{result:{[name]:56}}];
    assert.throws(()=>validateObservation(input),/telemetry/);
  }
  const nested=observation();nested.innerLife={beliefs:[{evidence:{body:{feelings:{hunger:.56}}}}]};
  assert.throws(()=>validateObservation(nested),/telemetry/);
  const disguised=observation();disguised.condition.body.hunger='56%';
  assert.throws(()=>validateObservation(disguised),/telemetry|qualitative/);
  assert.throws(()=>validateObservation({...observation(),identity:{id:'third-agent',name:'Unknown'}}),/identity/);
  assert.throws(()=>validateObservation({...observation(),social:{journal:Array.from({length:13},()=>({text:'fixture'}))}}),/journal/);
  const discrete=observation();discrete.knownFoods=[{id:'apple:trail',stock:3,x:880,y:700,observedAt:12,knownRouteSeconds:5}];
  assert.equal(validateObservation(discrete).knownFoods[0].stock,3);
});

test('bounded rest, peer speech, human questions, and notes remain data-only actions',()=>{
  for(const action of [{type:'rest',seconds:12},{type:'sleep',seconds:.25},{type:'say',targetId:'mira',text:'I found water.'},{type:'ask_human',text:'Have you seen another orchard?',topic:'food'},{type:'journal_reply',text:'I will check the orchard you mentioned.',replyTo:'message:human:1'},{type:'journal_reply',text:'Thank you for the suggestion.'},{type:'write_note',title:'Spring',text:'I drank here.',beliefIds:['belief:1']},{type:'read_note',noteId:'note:1'}])assert.deepEqual(parseDecision(JSON.stringify({action})).action,action);
  for(const action of [{type:'rest',seconds:13},{type:'sleep',seconds:0},{type:'say',targetId:'human',text:'hello'},{type:'say',targetId:'mira',text:'x'.repeat(601)},{type:'ask_human',text:'Question',topic:'x'.repeat(81)},{type:'journal_reply',text:'x'.repeat(601)},{type:'journal_reply',text:'Answer',replyTo:'x'.repeat(81)},{type:'journal_reply',text:'Answer',replyTo:{}},{type:'journal_reply',text:'Answer',targetId:'mira'},{type:'write_note',title:'Note',text:'Text',beliefIds:Array(9).fill('id')},{type:'read_note',noteId:'x'.repeat(81)},{type:'ask_human',text:'Question',command:'read file'},{type:'observe',script:'arbitrary'}])assert.throws(()=>parseDecision(JSON.stringify({action})));
});

test('plans contain three to six validated steps and cannot dictate physical outcomes',()=>{
  const plan={goal:'Prepare for the unfamiliar trail',need:'understanding',steps:[{type:'fill_flask',sourceId:'pond:spring:4'},{type:'gather_food',foodId:'apple:trail-orchard'},{type:'move',target:{x:500,y:700}}],completion:'I have inspected the trail and returned.',interrupt:'Return if thirsty or tired.'};
  assert.deepEqual(parseDecision(JSON.stringify({plan,reason:'fixture'})),{plan,reason:'fixture'});
  for(const invalid of [{...plan,steps:plan.steps.slice(0,2)},{...plan,steps:Array(7).fill({type:'observe'})},{...plan,need:'domination'},{...plan,completed:true},{...plan,steps:[...plan.steps.slice(0,2),{type:'exec',command:'shell'}]}])assert.throws(()=>parseDecision(JSON.stringify({plan:invalid})));
  assert.throws(()=>parseDecision(JSON.stringify({plan,action:{type:'observe'}})),/one action/);
});

test('scripted HTTP mock carries received human journal context and returns a bounded response without a new question',async()=>{
  const input=observation('mira');
  input.social={peers:[],journal:[{id:'message:1',at:10,senderId:'human',recipientId:'mira',channel:'journal',kind:'message',text:'Could you check the orchard?',replyTo:null}],notes:[],pendingQuestion:null};
  let sent;
  const service=new ModelService({config:{enabled:true,model:'scripted-test-mock'},fetchImpl:async(_url,options)=>{sent=JSON.parse(options.body);return response({action:{type:'journal_reply',text:'I will inspect it after getting water.',replyTo:'message:1'},reason:'Scripted mock response to an optional human message.'});}});
  const decision=await service.decide(input),received=JSON.parse(sent.messages[1].content);
  assert.equal(received.identity.id,'mira');assert.equal(received.social.journal[0].senderId,'human');
  assert.equal(decision.action.type,'journal_reply');assert.equal(decision.action.replyTo,'message:1');
  assert.match(sent.messages[0].content,/Journal_reply/);assert.match(sent.messages[0].content,/human may never answer/);
});

test('scripted HTTP mock serializes two characters, bounds each waiting slot and shares one call budget',async()=>{
  const started=[],resolvers=[];
  const service=new ModelService({config:{enabled:true,model:'scripted-test-mock',maxCallsPerHour:2},fetchImpl:(_url,options)=>{started.push(JSON.parse(JSON.parse(options.body).messages[1].content).identity.id);return new Promise(resolve=>resolvers.push(resolve));}});
  const first=service.decide(observation('aster'));
  const second=service.decide(observation('mira'));
  const third=service.decide(observation('aster'));
  const thirdRejected=assert.rejects(third,/budget/);
  await assert.rejects(service.decide(observation('aster')),/already.*waiting/);
  await assert.rejects(service.decide(observation('mira')),/already.*waiting/);
  assert.deepEqual(started,['aster']);assert.deepEqual(service.status().pendingAgentIds,['aster','mira']);
  resolvers.shift()(response({action:{type:'observe'},reason:'scripted mock Aster'}));
  await first;await turn();assert.deepEqual(started,['aster','mira']);
  resolvers.shift()(response({action:{type:'rest',seconds:1},reason:'scripted mock Mira'}));
  assert.equal((await second).action.type,'rest');await thirdRejected;
  assert.equal(service.status().callsThisHour,2);assert.equal(service.status().pending,false);
});

test('cancelling one character releases another even when a scripted mock ignores abort and returns stale output',async()=>{
  const started=[],resolvers=[];
  const service=new ModelService({config:{enabled:true,model:'scripted-test-mock'},fetchImpl:(_url,options)=>{started.push({id:JSON.parse(JSON.parse(options.body).messages[1].content).identity.id,signal:options.signal});return new Promise(resolve=>resolvers.push(resolve));}});
  const aster=service.decide(observation('aster')),asterRejected=assert.rejects(aster,/cancelled/);
  const mira=service.decide(observation('mira'));
  service.cancel('aster');await asterRejected;await turn();
  assert.equal(started[0].signal.aborted,true);assert.equal(started[1].id,'mira');assert.equal(started[1].signal.aborted,false);
  resolvers[0](response({action:{type:'wait',seconds:1},reason:'cancelled stale Aster result'}));await turn();
  assert.deepEqual(service.status().pendingAgentIds,['mira']);
  resolvers[1](response({action:{type:'ask_human',text:'Do apples return?'},reason:'scripted mock Mira'}));
  assert.equal((await mira).action.type,'ask_human');assert.equal(service.status().pending,false);
});

test('cancelling queued peer work leaves the current character active; cancelling all settles every promise',async()=>{
  const service=new ModelService({config:{enabled:true,model:'scripted-test-mock'},fetchImpl:()=>new Promise(()=>{})});
  const aster=service.decide(observation('aster')),asterRejected=assert.rejects(aster,/cancelled/);
  const mira=service.decide(observation('mira')),miraRejected=assert.rejects(mira,/cancelled/);
  service.cancel('mira');await miraRejected;
  assert.deepEqual(service.status().pendingAgentIds,['aster']);
  assert.throws(()=>service.cancel('third-agent'),/identity/);
  service.cancel();await asterRejected;assert.equal(service.status().pending,false);
});
