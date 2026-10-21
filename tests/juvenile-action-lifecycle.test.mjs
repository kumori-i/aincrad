import test from 'node:test';
import assert from 'node:assert/strict';
import {createJuvenileFixture} from './fixtures/juvenile-interactions.mjs';
import {createNpc} from '../src/npc-state.js';
import {observeNpc,requestNpcAction,tickNpc,cancelNpcAction,collapseNpc} from '../src/npc.js';
import {requestDiscoveryAction,tickDiscoveryAction,primitiveDuration} from '../src/discovery-actions.js';
import {lookupEcologyObject,interactEcologyObject} from '../src/ecology.js';
import {beginSleep} from '../src/biology.js';
import {canStand,freshState,CAVE_OBJECTS} from '../src/world.js';
import {lineOfSight} from '../src/perception.js';


const clone=structuredClone,near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
function fixture(){
  const f=createJuvenileFixture({grown:true}),n=createNpc({mode:'discovery',seed:74193});
  n.position=[{...f.juvenile.position},...[[20,0],[-20,0],[0,20],[0,-20]].map(([x,y])=>({x:f.juvenile.position.x+x,y:f.juvenile.position.y+y}))]
    .find(p=>canStand(p.x,p.y,'valley')&&lineOfSight(p,f.juvenile.position));
  assert.ok(n.position);observeNpc(n,f.env);assert.ok(n.discovery.observations[f.juvenile.id]);
  assert.ok(f.juvenile.structureMassGrams>40);return {...f,n,request:{type:'strike',targetId:f.juvenile.id}};
}
function start(f,helper=false){assert.equal((helper?requestDiscoveryAction:requestNpcAction)(f.n,f.request,f.env).code,'ACTION_STARTED');return f.n.active;}
function finish(f){for(let i=0;f.n.active&&i<200;i++)tickNpc(f.n,.05,f.env);assert.equal(f.n.active,null);return f.n.lastResult;}
function disk(){let text=null;return {getItem:()=>text,setItem:(_,value)=>{text=value;},get text(){return text;}};}
function saveState(f){const s=freshState({connectedEcology:false});s.environment=f.env;s.elapsed=Math.max(f.env.elapsed,f.n.elapsed);s.agents[0]=f.n;s.npc=f.n;return s;}

// The copied ecology grows before this fresh body joins. These tests isolate the
// action/body clock against its fixed environment, as ordinary NPC unit fixtures do.
test('a real grown juvenile loses ten grams only after a complete paid NPC strike',()=>{
  const f=fixture(),before=clone(f.e),body=clone(f.n.physiology);start(f);
  for(let i=0;i<15;i++)tickNpc(f.n,.25,f.env);
  assert.deepEqual(f.e,before);near(f.n.active.worked,3.75);
  assert.equal(requestNpcAction(f.n,f.request,f.env).code,'ACTION_BUSY');
  const active=f.n.active;tickNpc(f.n,.25,f.env);near(f.juvenile.structureMassGrams,before.plants.find(p=>p.id===f.juvenile.id).structureMassGrams-10);
  assert.equal(f.n.active,null);assert.equal(f.n.lastResult.code,'object_damaged');near(f.n.lastResult.durationSeconds,4);
  assert.ok(f.n.physiology.totals.metabolizedKcal>body.totals.metabolizedKcal);
  const once=clone(f.e),events=f.n.memory.experience.filter(e=>e.type==='action').length;
  for(let i=0;i<20;i++)tickNpc(f.n,.25,f.env);assert.deepEqual(f.e,once);
  assert.equal(f.n.memory.experience.filter(e=>e.type==='action').length,events);
  f.n.active=active;assert.equal(tickDiscoveryAction(f.n,4,f.env),false);assert.equal(f.n.active,null);assert.deepEqual(f.e,once);
  const duration=primitiveDuration(f.n,'strike');assert.ok(duration<4);start(f);assert.deepEqual(f.e,once);finish(f);near(f.juvenile.structureMassGrams,once.plants.find(p=>p.id===f.juvenile.id).structureMassGrams-10);
  near(f.n.lastResult.durationSeconds,duration);
});

test('omitted and observing completion callbacks each settle the same action once',()=>{
  for(const observing of [false,true]){
    const f=fixture(),mass=f.juvenile.structureMassGrams;let calls=0;const active=start(f,true);
    const options=observing?{complete(n,request,result){calls++;assert.equal(n.active,active);assert.deepEqual(request,f.request);assert.equal(result.code,'object_damaged');}}:{};
    assert.equal(tickDiscoveryAction(f.n,4,f.env,options),true);near(f.juvenile.structureMassGrams,mass-10);assert.equal(f.n.active,null);
    assert.equal(tickDiscoveryAction(f.n,4,f.env,options),false);near(f.juvenile.structureMassGrams,mass-10);assert.equal(calls,observing?1:0);
  }
});

test('completion reentry and a throwing callback cannot repeat a physical completion',()=>{
  for(const throwing of [false,true]){
    const f=fixture(),mass=f.juvenile.structureMassGrams;const active=start(f,true);let calls=0;
    const run=()=>tickDiscoveryAction(f.n,4,f.env,{complete(){calls++;assert.equal(tickDiscoveryAction(f.n,4,f.env),false);assert.equal(f.n.active,active);if(throwing)throw new Error('completion fixture');}});
    if(throwing)assert.throws(run,/completion fixture/);else run();
    near(f.juvenile.structureMassGrams,mass-10);assert.equal(calls,1);assert.equal(f.n.active,null);
    f.n.active=active;assert.equal(tickDiscoveryAction(f.n,4,f.env),false);near(f.juvenile.structureMassGrams,mass-10);
  }
});

test('completion replacement survives cleanup and pays its own later work',()=>{
  const f=fixture(),mass=f.juvenile.structureMassGrams;const old=start(f,true);let replacement;
  tickDiscoveryAction(f.n,4,f.env,{complete(){f.n.active=null;replacement=start(f,true);assert.notEqual(replacement,old);}});
  assert.equal(f.n.active,replacement);near(replacement.worked,0);near(f.juvenile.structureMassGrams,mass-10);
  tickDiscoveryAction(f.n,3.75,f.env);near(f.juvenile.structureMassGrams,mass-10);tickDiscoveryAction(f.n,.25,f.env);near(f.juvenile.structureMassGrams,mass-20);
});

test('exertion reentry charges and completes only the outer action',()=>{
  const f=fixture(),mass=f.juvenile.structureMassGrams;start(f,true);let exertions=0,completions=0;
  tickDiscoveryAction(f.n,4,f.env,{exert(n,seconds,effort){exertions++;assert.equal(seconds,4);assert.equal(effort,2.2);assert.equal(tickDiscoveryAction(n,4,f.env),false);},complete(){completions++;}});
  near(f.juvenile.structureMassGrams,mass-10);assert.equal(exertions,1);assert.equal(completions,1);assert.equal(f.n.active,null);
});

test('exertion cancellation or replacement never commits the old action',()=>{
  for(const replace of [false,true]){
    const f=fixture(),before=clone(f.e),old=start(f,true);let replacement=null,completions=0;
    tickDiscoveryAction(f.n,4,f.env,{exert(){assert.equal(cancelNpcAction(f.n,'FIXTURE_INTERRUPTED'),true);if(replace){replacement=start(f,true);}},complete(){completions++;}});
    assert.deepEqual(f.e,before);assert.equal(f.n.active,replacement);assert.equal(completions,0);
    if(replace){assert.notEqual(replacement,old);near(replacement.worked,0);tickDiscoveryAction(f.n,4,f.env);near(f.juvenile.structureMassGrams,before.plants.find(p=>p.id===f.juvenile.id).structureMassGrams-10);}
  }
});

test('throwing exertion retires unpaid work and preserves any replacement',()=>{
  for(const replace of [false,true]){
    const f=fixture(),before=clone(f.e),old=start(f,true);let replacement=null;
    assert.throws(()=>tickDiscoveryAction(f.n,4,f.env,{exert(){if(replace){cancelNpcAction(f.n);replacement=start(f,true);}throw new Error('exertion fixture');}}),/exertion fixture/);
    assert.deepEqual(f.e,before);assert.equal(f.n.active,replacement);
    if(replace){assert.notEqual(replacement,old);near(replacement.worked,0);cancelNpcAction(f.n);}
    f.n.active=old;assert.equal(tickDiscoveryAction(f.n,.25,f.env),false);assert.equal(f.n.active,null);assert.deepEqual(f.e,before);
  }
});

test('invalid tick durations cannot advance work, call hooks or damage the target',()=>{
  const f=fixture();start(f,true);const before=clone(f.n),world=clone(f.e);let calls=0;
  for(const dt of [NaN,Infinity,-Infinity,0,-1,undefined])assert.equal(tickDiscoveryAction(f.n,dt,f.env,{exert(){calls++;},complete(){calls++;}}),false);
  assert.equal(calls,0);assert.deepEqual(f.n,before);assert.deepEqual(f.e,world);
});

test('actual cancellation and collapse before completion leave the target untouched',()=>{
  for(const collapse of [false,true]){
    const f=fixture(),before=clone(f.e);start(f);tickNpc(f.n,.25,f.env);
    if(collapse)collapseNpc(f.n,'fixture interruption');else cancelNpcAction(f.n);
    for(let i=0;i<20;i++)tickNpc(f.n,.25,f.env);assert.deepEqual(f.e,before);assert.equal(f.n.active,null);
  }
});

test('sleeping and collapsed bodies cannot admit a strike',()=>{
  for(const asleep of [false,true]){
    const f=fixture(),before=clone(f.e);if(asleep)beginSleep(f.n,{hours:1});else collapseNpc(f.n,'fixture');
    assert.equal(requestNpcAction(f.n,f.request,f.env).ok,false);assert.equal(f.n.active,null);assert.deepEqual(f.e,before);
  }
});

test('completion revalidates exact target scene, range, visibility and disappearance',()=>{
  for(const change of ['scene','range','blocked','gone']){
    const f=fixture();start(f);tickNpc(f.n,.25,f.env);const mass=f.juvenile.structureMassGrams;
    if(change==='scene')f.n.scene='amber';
    if(change==='range')f.n.position={x:f.juvenile.position.x+1000,y:f.juvenile.position.y};
    if(change==='blocked'){
      // Deliberate post-admission obstruction fixture, with actual cave collision.
      const o=CAVE_OBJECTS.find(o=>o.radius*o.scale<25);assert.ok(o);
      const r=o.radius*o.scale+12;f.n.scene=f.juvenile.scene='amber';f.n.position={x:o.x-r,y:o.y};f.juvenile.position={x:o.x+r,y:o.y};
      assert.ok(Math.hypot(f.n.position.x-f.juvenile.position.x,f.n.position.y-f.juvenile.position.y)<80);assert.equal(lineOfSight(f.n.position,f.juvenile.position,'amber'),false);
    }
    if(change==='gone'){for(let i=0;lookupEcologyObject(f.e,f.juvenile.id)&&i<8;i++)assert.equal(interactEcologyObject(f.e,f.juvenile.id,'strike',{actorId:'aster',position:f.n.position,power:4}).ok,true);assert.equal(lookupEcologyObject(f.e,f.juvenile.id),null);}
    const before=clone(f.e);finish(f);assert.equal(f.n.lastResult.ok,false);assert.deepEqual(f.e,before);
    if(change!=='gone')near(f.juvenile.structureMassGrams,mass);
  }
});


