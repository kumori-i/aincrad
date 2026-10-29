const historicalClone=value=>legacyFixture(globalThis.structuredClone(value));
import { legacyFixture } from './fixtures/legacy-communication.mjs';
// These tests preserve the explicit historical English/naming channel.
const createNpc=(...args)=>legacyFixture(rawcreateNpc(...args));
import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpc as rawcreateNpc } from '../src/npc-state.js';
import { NpcController, DesktopModelProvider, LocalLearnerProvider, decisionObservation } from '../src/controller.js';
import { ingestVisualSamples } from '../src/visual-group-memory.js';
import { namingProposal } from '../src/category-names.js';
import { beginSleep } from '../src/biology.js';
import { createEnvironment } from '../src/environment.js';
import { createEcology } from '../src/ecology.js';
import { canStand } from '../src/world.js';
import { createRequire } from 'node:module';
const {ModelService}=createRequire(import.meta.url)('../desktop/model-provider.cjs');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const reply={token:'velari',model:'scripted-naming-controller-mock'};
const cues={shape:'tuft with narrow blades',color:'green',texture:'fibrous'};
function fixture(){
  const n=createNpc({mode:'discovery'}),calls=[];let cancelled=0;
  const provider={kind:'local-model',label:'Scripted naming fixture, not live inference',proposeName(request){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});calls.push({request,resolve,reject});return promise;},cancel(){cancelled++;}};
  const c=new NpcController(n,{communicationMode:'legacy',provider,deferInitialObservation:true});
  const sample=(at=2,id=675,appearance=cues)=>{n.elapsed=at;ingestVisualSamples(n,[{id:`object:${id}`,appearance,scene:n.scene,position:{...n.position}}]);};
  sample(1);sample(2);
  return {n,c,calls,sample,provider,cancelled:()=>cancelled};
}
const physical=n=>historicalClone({physiology:n.physiology,inventory:n.inventory,effects:n.discovery.effects,techniques:n.discovery.techniques,experiments:n.discovery.experiments,practice:n.discovery.practice});

test('desktop provider forwards only the naming evidence through the dedicated bridge',async()=>{
  let received,cancelled;const bridge={proposeName:request=>{received=request;return reply;},cancel:id=>cancelled=id};
  const p=new DesktopModelProvider(bridge),request={agentId:'mira'};
  assert.deepEqual(await p.proposeName(request),reply);assert.equal(received,request);p.cancel();assert.equal(cancelled,'mira');
});

test('scripted controller proposal consumes one admission, waits for ordinary sensing, and never mutates physical evidence',async()=>{
  const f=fixture(),before=physical(f.n);assert.ok(namingProposal(f.n));f.c.maybeName();f.c.maybeName();
  assert.equal(f.calls.length,1);assert.equal(f.n.categoryNames.admissions.length,1);assert.equal(f.c.namingStatus.state,'pending');
  f.n.elapsed=2.5;f.calls[0].resolve(reply);await turn();
  assert.equal(f.n.categoryNames.own.length,0,'async callback cannot create a sensory receipt or adopt between senses');
  assert.equal(f.c.namingPending.received,true);
  f.sample(3);f.c.finishNaming();assert.equal(f.c.namingStatus.state,'accepted');assert.equal(f.n.categoryNames.own[0].token,'velari');
  assert.equal(f.n.categoryNames.own[0].model,reply.model);assert.deepEqual(physical(f.n),before);f.c.dispose();
});

test('ordinary controller perception applies a mid-sense reply on the next sense step while bodily time continues',async()=>{
  const n=createNpc({mode:'discovery',seed:74193}),e=createEnvironment({seed:74193});e.ecology=createEcology(74193);
  const plant=e.ecology.plants.find(p=>p.kind==='apple_tree');assert.ok(plant);
  e.ecology.plants=[plant];e.ecology.animals=[];e.ecology.materials=[];
  n.position=[{x:plant.position.x+45,y:plant.position.y},{x:plant.position.x-45,y:plant.position.y}].find(p=>canStand(p.x,p.y,'valley'));assert.ok(n.position);n.nextDecisionAt=1e8;
  let resolve,calls=0;const provider={kind:'local-model',proposeName:()=>{calls++;return new Promise(r=>resolve=r);},cancel(){}};
  const c=new NpcController(n,{communicationMode:'legacy',provider,environment:e});
  for(let i=0;i<30&&!c.namingPending;i++)c.tick(.05);
  assert.equal(calls,1);const sense=c.senseAt,metabolic=n.physiology.totals.metabolizedKcal;
  for(let i=0;i<5;i++)c.tick(.05);assert.ok(n.elapsed>sense);assert.equal(c.senseAt,sense);
  resolve(reply);await turn();assert.equal(n.categoryNames.own.length,0);
  for(let i=0;i<30&&!n.categoryNames.own.length;i++)c.tick(.05);
  assert.equal(n.categoryNames.own.length,1);assert.ok(c.senseAt>sense);assert.ok(n.physiology.totals.metabolizedKcal>metabolic);
  assert.equal(n.discovery.experiments.length,0);assert.equal(calls,1);c.dispose();
});

test('cancel, disposal, provider/actor/epoch changes, sleep, learning-off and expiry reject late naming replies',async()=>{
  for(const [name,change] of [
    ['cancel',f=>f.c.cancel()],['dispose',f=>f.c.dispose()],['provider',f=>f.c.setProvider(new LocalLearnerProvider())],
    ['epoch',f=>f.n.epoch++],['actor',f=>f.c.npc=createNpc({mode:'discovery'})],['sleep',f=>f.n.active={request:{type:'sleep'}}],
    ['learning',f=>f.n.learning=false],['expiry',f=>f.n.elapsed+=61],
  ]){
    const f=fixture();f.c.maybeName();change(f);f.calls[0].resolve(reply);await turn();f.c.finishNaming();
    assert.equal(f.n.categoryNames.own.length,0,name);assert.equal(f.c.namingPending,null,name);f.c.dispose();
  }
});

test('expired or newly sleeping pending work is cancelled during ticks before a slow provider replies',async()=>{
  for(const interrupt of [f=>f.n.elapsed+=61,f=>beginSleep(f.n,{hours:1})]){
    const f=fixture();f.c.maybeName();interrupt(f);f.n.nextDecisionAt=1e8;
    f.c.tick(.05);assert.equal(f.c.namingPending,null);assert.ok(f.cancelled()>0);
    f.calls[0].resolve(reply);await turn();assert.equal(f.n.categoryNames.own.length,0);f.c.dispose();
  }
});

test('a queued response is revoked before application by cancel/reset and changed ordinary cue evidence',async()=>{
  for(const change of [f=>f.c.cancel(),f=>{f.sample(3,675,{...cues,color:'brown'});f.sample(4,675,cues);f.sample(5,675,cues);}]){
    const f=fixture();f.c.maybeName();f.calls[0].resolve(reply);await turn();assert.equal(f.c.namingPending.received,true);
    change(f);f.c.finishNaming();assert.equal(f.n.categoryNames.own.length,0);f.c.dispose();
  }
});

test('errors, abstention and action-bearing replies never invent names or physical authority',async()=>{
  for(const result of ['error',{token:null,model:reply.model},{...reply,action:{type:'sample'}}]){
    const f=fixture(),before=physical(f.n);f.c.maybeName();
    if(result==='error')f.calls[0].reject(new Error('Scripted service unavailable'));else f.calls[0].resolve(result);
    await turn();f.sample(3);f.c.finishNaming();assert.equal(f.n.categoryNames.own.length,0);assert.deepEqual(physical(f.n),before);
    f.sample(70);f.c.maybeName();assert.equal(f.calls.length,1,'failed/abstained evidence cannot retry inside its persisted cooldown');f.c.dispose();
  }
});

test('temporary inference failure retries the same observed category only after persisted cooldown',async()=>{
  const f=fixture();f.c.maybeName();f.calls[0].reject(new Error('Scripted temporary outage'));await turn();
  f.sample(301);f.c.maybeName();assert.equal(f.calls.length,1);
  f.sample(302);f.c.maybeName();assert.equal(f.calls.length,2);assert.equal(f.n.categoryNames.admissions.length,1);
  f.calls[1].resolve(reply);await turn();f.sample(303);f.c.finishNaming();assert.equal(f.n.categoryNames.own[0].token,'velari');f.c.dispose();
});

test('no provider and disabled learning consume no admissions; different evidence is throttled at 60 simulation seconds',async()=>{
  for(const change of [f=>f.c.setProvider(new LocalLearnerProvider()),f=>f.n.learning=false]){
    const f=fixture();change(f);f.c.maybeName();assert.equal(f.calls.length,0);assert.equal(f.n.categoryNames,undefined);f.c.dispose();
  }
  const f=fixture();f.c.maybeName();f.calls[0].resolve(reply);await turn();f.sample(3);f.c.finishNaming();
  const different={...cues,color:'silver'};f.sample(4,676,different);f.sample(5,676,different);f.c.maybeName();assert.equal(f.calls.length,1);
  f.sample(61,676,different);f.c.maybeName();assert.equal(f.calls.length,1);f.sample(62,676,different);f.c.maybeName();assert.equal(f.calls.length,2);
  f.c.dispose();f.calls[1].resolve({...reply,token:'seluni'});await turn();assert.equal(f.n.categoryNames.own.length,1);
});

test('naming and optional journal messages use the same local-model call budget',async()=>{
  const f=fixture(),input=namingProposal(f.n);
  const service=new ModelService({config:{enabled:true,model:'scripted-shared-budget-mock',maxCallsPerHour:1},fetchImpl:async()=>new Response(JSON.stringify({choices:[{message:{content:'{"token":"velari"}'}}]}))});
  assert.equal((await service.proposeName(input)).token,'velari');await assert.rejects(service.decide(decisionObservation(f.n)),/budget/);f.c.dispose();
});
