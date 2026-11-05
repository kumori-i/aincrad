import test from 'node:test';
import assert from 'node:assert/strict';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { createOzarkState } from '../src/ozark-save.js';
import { bindOzarkWorldAgent, ozarkFiniteAquaticAgent } from '../src/ozark-agent-world.js';
import { observeNpc, requestNpcAction, tickNpc } from '../src/npc.js';
import { NpcController } from '../src/controller.js';
import { discoveryDecision } from '../src/discovery.js';
import { CONFIG } from '../src/config.js';
import { unproductiveClimbApproach } from '../src/traversal-evidence.js';

// Authored engineering fixture: a visible divide resists paid climbing.
// This is not an autonomous survival or natural terrain learning study.
const real=createOzarkWorldGeometry();
function fixture(){
  const state=createOzarkState(real),actor=state.agents[0];
  actor.position={x:0,y:0};actor.physiology.waterDeficitMl=0;
  const geometry=Object.freeze({...real,canOccupy:()=>true,
    classify:()=>({walkable:true,reason:'dry-ground'}),
    sample:(x,y)=>({paint:x===80&&y===0?'divide':'oak-pine-woodland'}),
    observe:()=>({ground:'dry-land',nearby:[]}),lineOfSight:()=>true,
    advance(_actor,dx,dy,dt,_sprint,mode,funding){
      const paid=(dx||dy)?(funding?funding(dt,2):dt):0;
      return {paidSeconds:paid,inputDx:0,inputDy:0,distance:0,driftDistance:0,
        waterSeconds:0,swimSeconds:0,climbSeconds:mode==='climb'?paid:0,
        fallRiskSeconds:0,effortSeconds:paid*2};
    }});
  bindOzarkWorldAgent(actor,geometry,state);observeNpc(actor,state.environment);
  return {actor,state};
}
function paidFailure(f){
  const c=new NpcController(f.actor,{environment:f.state.environment});
  try{
    c.tick(CONFIG.fixedStep);
    assert.deepEqual(f.actor.active?.request,{type:'climb',target:{x:80,y:0}});
    for(let i=0;i<150&&f.actor.active;i++)tickNpc(f.actor,CONFIG.fixedStep,f.state.environment);
    assert.equal(f.actor.active,null);
  }finally{c.dispose();}
  return f.actor.memory.experience.filter(e=>e.type==='action').at(-1);
}
function later(f,seconds=91){f.actor.elapsed+=seconds;observeNpc(f.actor,f.state.environment);}

test('paid unproductive climb changes a later ordinary finite-aquatic controller choice',()=>{
  const f=fixture();assert.equal(ozarkFiniteAquaticAgent(f.actor),true);
  const receipt=paidFailure(f);
  assert.equal(receipt.details.result.code,'ROUTE_BLOCKED');
  assert.equal(receipt.details.result.movement.traversal,'climbing');
  assert.equal(receipt.details.result.movement.progress,'negligible');
  assert.ok(receipt.details.result.durationSeconds>=1-1e-8);
  later(f);
  const c=new NpcController(f.actor,{environment:f.state.environment});
  try{c.tick(CONFIG.fixedStep);assert.notEqual(f.actor.active?.request.type,'climb');}
  finally{c.dispose();}
  const naive=fixture();later(naive);
  assert.equal(discoveryDecision(naive.actor).action.type,'climb');
});

test('retained evidence is target, scene, approach and actor specific; eviction or expiry means unknown',()=>{
  const f=fixture(),e=paidFailure(f),n=f.actor,target={x:80,y:0};later(f);
  assert.equal(unproductiveClimbApproach(n,target),true);
  assert.equal(unproductiveClimbApproach(n,{x:80,y:80}),false);
  n.position={x:0,y:40};assert.equal(unproductiveClimbApproach(n,target),false);
  n.position={x:0,y:0};n.scene='elsewhere';assert.equal(unproductiveClimbApproach(n,target),false);n.scene='valley';
  assert.equal(unproductiveClimbApproach(f.state.agents[1],target),false);
  n.learning=false;assert.equal(unproductiveClimbApproach(n,target),false);n.learning=true;
  n.memory.experience=n.memory.experience.filter(row=>row!==e);
  assert.equal(unproductiveClimbApproach(n,target),false);
  assert.equal(discoveryDecision(n).action.type,'climb');
  n.memory.experience.push(e);n.elapsed=e.at+300;
  assert.equal(unproductiveClimbApproach(n,target),false);
});

test('command names, zero-cost rejection, progress and passive motion are not unproductive paid climbing',()=>{
  const f=fixture(),e=paidFailure(f),n=f.actor;later(f);const target={x:80,y:0},r=e.details.result;
  for(const change of [{durationSeconds:0},{ok:true},{code:'UNOBSERVED_TARGET'},
    {movement:{...r.movement,traversal:'walking'}},{movement:{...r.movement,traversal:'adrift'}},
    {movement:{...r.movement,progress:'steady'}},{movement:{...r.movement,effort:'steady'}}]){
    e.details.result={...r,...change};assert.equal(unproductiveClimbApproach(n,target),false);
  }
  e.details.result=r;
});

test('existing global short cooldown and urgent bodily needs remain prior',()=>{
  const f=fixture();paidFailure(f);
  f.actor.position={x:0,y:40};observeNpc(f.actor,f.state.environment);
  assert.notEqual(discoveryDecision(f.actor).action.type,'climb','global recent-terrain gate remains');
  f.actor.position={x:0,y:0};later(f);
  f.actor.physiology.waterDeficitMl=1200;f.actor.flask.water=.2;
  assert.equal(discoveryDecision(f.actor).action.type,'drink');
});


test('newer matching paid outcome clears older restraint; later failure can renew it',()=>{
  const f=fixture(),first=paidFailure(f),n=f.actor,target={x:80,y:0};later(f);
  const success=structuredClone(first);success.id+=10;success.at+=1;
  Object.assign(success.details.result,{ok:true,code:'ARRIVED',movement:{...success.details.result.movement,progress:'steady',resistance:'free'}});
  n.memory.experience.push(success);
  assert.equal(unproductiveClimbApproach(n,target),false);
  const laterFailure=structuredClone(first);laterFailure.id+=11;laterFailure.at+=2;n.memory.experience.push(laterFailure);
  assert.equal(unproductiveClimbApproach(n,target),true);
});

test('actual Ozark grade produces paid climbing and a retained unproductive slip, not a synthetic terrain label',()=>{
  const state=createOzarkState(real),actor=state.agents[0];
  // Boundary reached in existing structural-movement geometry, still occupiable.
  actor.position={x:-12000,y:9885.25};bindOzarkWorldAgent(actor,real,state);
  observeNpc(actor,state.environment);const target={x:-12000,y:9920};
  assert.equal(requestNpcAction(actor,{type:'climb',target},state.environment).code,'STARTED');
  for(let i=0;i<150&&actor.active;i++)tickNpc(actor,CONFIG.fixedStep,state.environment);
  const receipt=actor.memory.experience.filter(e=>e.type==='action').at(-1);
  assert.equal(receipt.details.result.code,'SLIPPED');
  assert.equal(receipt.details.result.movement.traversal,'climbing');
  assert.equal(receipt.details.result.movement.progress,'negligible');
  assert.ok(receipt.details.result.durationSeconds>=.5);
  actor.elapsed+=91;
  assert.equal(unproductiveClimbApproach(actor,target),true);
});


test('tied conflicting outcomes and incomplete newer evidence mean unknown, independently of order',()=>{
  const f=fixture(),first=paidFailure(f),n=f.actor,target={x:80,y:0};later(f);
  const conflict=structuredClone(first);conflict.details.result.ok=true;conflict.details.result.code='ARRIVED';
  n.memory.experience.push(conflict);
  assert.equal(unproductiveClimbApproach(n,target),false);
  n.memory.experience.reverse();assert.equal(unproductiveClimbApproach(n,target),false);
  n.memory.experience=n.memory.experience.filter(e=>e!==conflict);
  const incomplete=structuredClone(first);incomplete.id+=1;incomplete.at+=1;
  incomplete.details.result={ok:true,code:'ARRIVED',startScene:'valley',scene:'valley'};
  n.memory.experience.push(incomplete);assert.equal(unproductiveClimbApproach(n,target),false);
  delete incomplete.details.startPosition;assert.equal(unproductiveClimbApproach(n,target),false);
});
