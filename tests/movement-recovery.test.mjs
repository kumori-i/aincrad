import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { createNpc } from '../src/npc-state.js';
import { createEnvironment, tickEnvironment } from '../src/environment.js';
import { OZARK_WORLD_PROFILE, createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { bindOzarkWorldAgent } from '../src/ozark-agent-world.js';
import { observeNpc, requestNpcAction, tickNpc } from '../src/npc.js';
import { discoveryDecision } from '../src/discovery.js';
import { NpcController } from '../src/controller.js';
import { motorStalled, resetMotorWindow, recoveryChoice, isRecovery } from '../src/movement-recovery.js';
import { tickOzarkEcology } from '../src/ozark-ecology.js';
import { recordEvent } from '../src/npc-memory.js';
import { createOzarkState, writeOzarkSave, loadOzarkSave, OZARK_SAVE_KEY } from '../src/ozark-save.js';

function fixture({speed=1,drift=0,wall=30,jitter=false}={}){
  const actor=createNpc({id:'aster',mode:'discovery',seed:1});actor.position={x:0,y:0};
  const environment=createEnvironment(1,{mode:'discovery',populate:false});
  environment.ecology={plants:[],animals:[],materials:[]};
  const calls=[],control={wall,occluded:false,ground:'dry-ground',freeze:false};let count=0;
  const geometry={profile:OZARK_WORLD_PROFILE,bounds:{minX:-19000,maxX:19000,minY:-14200,maxY:14200},
    canOccupy:()=>true,classify:()=>({walkable:true,reason:'dry-ground'}),
    sample:()=>({paint:'oak-pine-woodland',canopy:0,light:1,elevation:200,habitat:'meadow'}),
    observe:()=>({ground:control.ground,nearby:[]}),groundAt:()=>control.ground,
    lineOfSight:()=>!control.occluded,
    advance(position,dx,dy,dt,sprint=false,mode='walk'){
      const before={...position},length=Math.hypot(dx,dy);count++;
      if(length&&!control.freeze){
        const travel=jitter?(count%2?1:-1):CONFIG.walkSpeed*dt*speed;
        const x=position.x+dx/length*travel,y=position.y+dy/length*travel;
        if(x<=control.wall){position.x=x;position.y=y;}
      }
      position.x+=drift*dt;
      const motion={distance:Math.hypot(position.x-before.x,position.y-before.y),driftDistance:Math.abs(drift*dt),waterSeconds:drift?dt:0,swimSeconds:0,climbSeconds:0,fallRiskSeconds:0,effortSeconds:dt};
      calls.push({dx,dy,before,after:{...position},dt,mode,...motion});return motion;
    }};
  bindOzarkWorldAgent(actor,geometry,{geometryIdentity:OZARK_WORLD_PROFILE.identity,agents:[actor]});
  observeNpc(actor,environment);return{actor,environment,geometry,calls,control};
}
function runAction(f,request={type:'move',target:{x:80,y:0}},dt=1/60){
  assert.equal(requestNpcAction(f.actor,request,f.environment).code,'STARTED');
  for(let count=0;f.actor.active&&count<30000;count++)tickNpc(f.actor,dt,f.environment);
  assert.equal(f.actor.active,null);return f.actor.lastResult;
}
function blocked(){const f=fixture();assert.equal(runAction(f).code,'ROUTE_BLOCKED');observeNpc(f.actor,f.environment);return f;}
const ordinary={type:'move',target:{x:0,y:80}};

 test('paid-time motor windows reject no progress and jitter across frame partitions',()=>{
  for(const dt of [1/30,1/60,1/120,1/240])for(const type of ['none','jitter','creep']){
    const active={};let stopped=0;
    for(let i=0;i<Math.ceil(1/dt)+2;i++)if(motorStalled(active,dt,150*dt,type==='none'?0:type==='jitter'?(i%2?-.4:.4):150*dt*.01)){stopped=(i+1)*dt;break;}
    assert.ok(Math.abs(stopped-1)<1e-8,`${type} at ${dt}`);
  }
  for(const ratio of [.05,.35,1]){const active={};for(let i=0;i<600;i++)assert.equal(motorStalled(active,1/120,150/120,150/120*ratio),false);}
});

test('waypoints reset only their own motor window and short partial attempts do not invent a stall',()=>{
  const active={};for(let i=0;i<59;i++)assert.equal(motorStalled(active,1/60,2.5,0),false);
  resetMotorWindow(active);
  for(let i=0;i<59;i++)assert.equal(motorStalled(active,1/60,2.5,0),false);
  assert.equal(motorStalled(active,1/60,2.5,0),true);
  const f=fixture({wall:0});const result=runAction(f,{type:'move',target:{x:80,y:0},duration:.4});
  assert.equal(result.code,'ACTION_TIMEOUT');assert.equal(result.durationSeconds<.5,true);
  assert.deepEqual(f.actor.memory.blockedEdges,{});
});

test('real action receipts detect paid blockage independently of frame size without rejecting slow travel',()=>{
  for(const dt of [1/30,1/60,1/120]){
    const f=fixture({wall:0}),result=runAction(f,undefined,dt);
    assert.equal(result.code,'ROUTE_BLOCKED');assert.ok(Math.abs(result.durationSeconds-1)<1e-8);
    assert.equal(result.movement.progress,'negligible');
    assert.ok(f.calls.reduce((n,c)=>n+c.dt,0)>=1-1e-8);
  }
  const slow=fixture({wall:Infinity,speed:.05});
  assert.equal(runAction(slow,{type:'move',target:{x:80,y:0},duration:12},1/240).code,'ARRIVED');
  const tiny=fixture({wall:Infinity});
  assert.equal(runAction(tiny,{type:'move',target:{x:80,y:0},duration:.1}).code,'ACTION_TIMEOUT');
  assert.ok(tiny.actor.position.x>0);assert.deepEqual(tiny.actor.memory.blockedEdges,{});
});

test('exhaustion measures paid motor time, and ordinary multi-waypoint detours still arrive',()=>{
  const tired=fixture({wall:0});tired.actor.physiology.stamina=5;
  const result=runAction(tired,{type:'move',target:{x:80,y:0},duration:10});
  assert.equal(result.code,'ROUTE_BLOCKED');assert.ok(result.durationSeconds>1.5);
  const paid=tired.calls.filter(c=>c.dx||c.dy).reduce((sum,c)=>sum+c.dt,0);
  assert.ok(paid>=1-1e-8&&paid<1.02);
  const detour=fixture({wall:Infinity});
  assert.equal(runAction(detour,{type:'move',target:{x:80,y:80}}).code,'ARRIVED');
  assert.deepEqual(detour.actor.memory.blockedEdges,{});
});

test('passive current and alternating jitter cannot hide unsuccessful locomotion',()=>{
  const drift=fixture({wall:-1,drift:3});
  assert.equal(runAction(drift).code,'ROUTE_BLOCKED');assert.ok(drift.actor.position.x>0);
  assert.equal(recoveryChoice(drift.actor,ordinary,'understanding'),null);
  const jitter=fixture({wall:Infinity,jitter:true});
  assert.equal(runAction(jitter).code,'ROUTE_BLOCKED');assert.ok(Math.abs(jitter.actor.position.x)<2);
});

test('an actual failed walk proposes one short paid retreat through ordinary controller action admission',()=>{
  const f=blocked(),a=f.actor,receipt=a.lastResult.eventId,position={...a.position},fatigue=a.physiology.fatigue;
  const anchor=a.navigationAnchor;
  const action=recoveryChoice(a,ordinary,'understanding');assert.ok(action);assert.equal(action.duration,.75);
  assert.ok(Math.hypot(action.target.x-position.x,action.target.y-position.y)>=12);
  assert.notEqual(action.target.x%80,0,'own trail point is deliberately not an arbitrary coarse center');
  const controller=new NpcController(a,{environment:f.environment});
  assert.equal(controller.perform(action).code,'STARTED');assert.equal(isRecovery(a.active),true);
  assert.deepEqual(a.position,position,'admission never teleports');
  for(let i=0;a.active&&i<100;i++)tickNpc(a,1/60,f.environment);
  assert.equal(a.lastResult.code,'ARRIVED');assert.ok(a.lastResult.eventId>receipt);
  assert.equal(a.navigationAnchor,anchor,'a non-center retreat cannot certify reaching its coarse tile center');
  assert.ok(a.position.x<position.x-9);assert.ok(a.physiology.fatigue>fatigue);
  assert.equal(recoveryChoice(a,ordinary,'understanding'),null);
  assert.equal(requestNpcAction(a,action,f.environment).code,'UNOBSERVED_TARGET','same coordinates cannot replay the consumed exception');
  controller.dispose();
});

test('a non-center retreat cannot fabricate reaching the next coarse route center',()=>{
  const f=fixture({wall:140}),a=f.actor;
  assert.equal(runAction(f,{type:'move',target:{x:160,y:0}}).code,'ROUTE_BLOCKED');
  assert.equal(a.navigationAnchor,'1,0');
  observeNpc(a,f.environment);const action=recoveryChoice(a,ordinary,'understanding');assert.ok(action);
  assert.equal(Math.round(action.target.x/80),2,'retreat point belongs to the not-yet-reached center160');
  assert.equal(runAction(f,action).code,'ARRIVED');
  assert.equal(a.navigationAnchor,'1,0','only a reached ordinary center may replace the anchor');
});

test('the known left forest detour remains physically executable after an actual paid recovery',()=>{
  const a=createNpc({id:'aster',mode:'discovery',seed:1});a.position={x:240,y:3120};
  const geometry=createOzarkWorldGeometry(),environment=createEnvironment(1,{mode:'discovery',populate:false});
  environment.ecology={plants:[],animals:[],materials:[]};
  bindOzarkWorldAgent(a,geometry,{geometryIdentity:OZARK_WORLD_PROFILE.identity,agents:[a]});
  const f={actor:a,environment};observeNpc(a,environment);
  assert.equal(runAction(f,{type:'move',target:{x:240,y:3200}}).code,'ROUTE_BLOCKED');
  observeNpc(a,environment);const decision=discoveryDecision(a);
  assert.equal(decision.action.duration,.75);
  assert.equal(runAction(f,decision.action).code,'ARRIVED');assert.ok(a.lastResult.distance>9);
  observeNpc(a,environment);
  assert.equal(runAction(f,{type:'move',target:{x:0,y:3200}}).code,'ARRIVED');
  assert.ok(a.lastResult.distance>200);assert.ok(geometry.canOccupy(a.position.x,a.position.y));
});

test('a failed retreat has finite paid duration, does not poison a reverse coarse edge, and does not rearm',()=>{
  const f=blocked(),a=f.actor,action=recoveryChoice(a,ordinary,'understanding'),edges=structuredClone(a.memory.blockedEdges);
  assert.ok(action);f.control.freeze=true;
  const result=runAction(f,action);assert.equal(result.code,'ACTION_TIMEOUT');assert.ok(result.durationSeconds<.8);
  assert.deepEqual(a.memory.blockedEdges,edges);
  observeNpc(a,f.environment);assert.equal(recoveryChoice(a,ordinary,'understanding'),null);
});

test('urgent care, contact, water, stale or occluded evidence revoke recovery; voluntary actions are never replaced',()=>{
  for(const mutate of [f=>{f.actor.physiology.waterDeficitMl=5000;},f=>{f.control.ground='deep-water';},f=>{f.control.occluded=true;},f=>{f.actor.elapsed+=6;},f=>{f.actor.epoch++;},f=>{f.actor.memory.experience=[];},f=>{recordEvent(f.actor,'condition',{code:'CONTACT_INJURY',provenance:'experienced contact',scene:f.actor.scene});}]){
    const f=blocked();assert.ok(recoveryChoice(f.actor,ordinary,'understanding'));mutate(f);
    assert.equal(recoveryChoice(f.actor,ordinary,'understanding'),null);
  }
  const f=blocked();for(const action of [{type:'wait',seconds:2},{type:'rest',seconds:2},{type:'sleep',seconds:2},{type:'grasp',targetId:'object:1'},{type:'drink'}])assert.equal(recoveryChoice(f.actor,action,'understanding'),null);
  assert.equal(recoveryChoice(f.actor,ordinary,'safety'),null);
  const action=recoveryChoice(f.actor,ordinary,'understanding');assert.ok(action);
  assert.equal(requestNpcAction(f.actor,action,f.environment).code,'STARTED');
  const p={...f.actor.position};f.actor.physiology.waterDeficitMl=5000;tickNpc(f.actor,1/60,f.environment);
  assert.equal(f.actor.lastResult.code,'PRIORITY_CHANGED');assert.deepEqual(f.actor.position,p);
});

test('ordinary voluntary stationary actions produce no blocked movement or retreat',()=>{
  for(const type of ['wait','rest','sleep']){
    const f=fixture();const result=runAction(f,{type,seconds:2});
    assert.notEqual(result.code,'ROUTE_BLOCKED');assert.deepEqual(f.actor.memory.blockedEdges,{});
    assert.equal(recoveryChoice(f.actor,ordinary,'understanding'),null);
  }
});

test('flat-ground resistance does not claim a visible slope or automatically select climbing',()=>{
  const f=blocked();f.actor.memory.cells=Object.fromEntries(Object.entries(f.actor.memory.cells).filter(([,c])=>Math.hypot(c.x-f.actor.position.x,c.y-f.actor.position.y)<150));
  const decision=discoveryDecision(f.actor);
  assert.notEqual(decision.action.type,'climb');
  assert.doesNotMatch(decision.reason,/observed slope/);
});

test('real forest blockage yields a paid retreat and saved evidence never restores its live authority',()=>{
  const geometry=createOzarkWorldGeometry(),state=createOzarkState(geometry),actor=state.agents[0];
  // A controlled scene at a reachable later time, not a fresh-spawn survival claim.
  actor.position={x:240,y:3120};state.elapsed=state.environment.elapsed=242.25;
  state.environment.ecology.elapsed=242;state.environment.ecology.pending=.25;
  for(const agent of state.agents){agent.elapsed=state.elapsed;bindOzarkWorldAgent(agent,geometry,state);}
  const tick=()=>{state.elapsed+=1/60;tickEnvironment(state.environment,1/60);tickOzarkEcology(state.environment.ecology,1/60,state.environment,state.agents,{},geometry);for(const agent of state.agents)tickNpc(agent,1/60,state.environment);};
  observeNpc(actor,state.environment);
  assert.equal(requestNpcAction(actor,{type:'move',target:{x:240,y:3200}},state.environment).code,'STARTED');
  for(let i=0;actor.active&&i<300;i++)tick();
  assert.equal(actor.lastResult.code,'ROUTE_BLOCKED');
  assert.ok(actor.position.y>3120&&actor.position.y<3200);
  observeNpc(actor,state.environment);
  const action=recoveryChoice(actor,{type:'move',target:{x:240,y:3120}},'understanding');assert.ok(action);
  const values=new Map(),disk={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
  assert.equal(writeOzarkSave(disk,state,geometry),true,loadOzarkSave({getItem:()=>JSON.stringify({...state,npc:undefined})},geometry).error);
  const bytes=disk.getItem(OZARK_SAVE_KEY),opened=loadOzarkSave(disk,geometry);
  assert.equal(opened.blocked,false,opened.error);
  const restored=opened.state.agents[0];bindOzarkWorldAgent(restored,geometry,opened.state);observeNpc(restored,opened.state.environment);
  assert.equal(recoveryChoice(restored,ordinary,'understanding'),null,'earned receipt is not a fresh trail');
  assert.equal(requestNpcAction(restored,action,opened.state.environment).code,'UNOBSERVED_TARGET');
  assert.equal(disk.getItem(OZARK_SAVE_KEY),bytes);
  const before={...actor.position},oldReceipt=actor.lastResult.eventId;
  const controller=new NpcController(actor,{environment:state.environment});
  const chosen=discoveryDecision(actor);
  assert.deepEqual(chosen.action,action,'ordinary autonomous movement selection proposes the retreat');
  assert.equal(controller.perform(chosen.action).code,'STARTED');assert.equal(isRecovery(actor.active),true);
  assert.equal(writeOzarkSave(disk,state,geometry),true,'an in-flight retreat remains a valid interruptible ordinary move');
  const interrupted=loadOzarkSave(disk,geometry);assert.equal(interrupted.blocked,false,interrupted.error);
  const resumed=interrupted.state.agents[0];bindOzarkWorldAgent(resumed,geometry,interrupted.state);
  assert.equal(resumed.active,null);assert.equal(resumed.lastResult.eventId,oldReceipt,'reopening does not fabricate arrival');
  observeNpc(resumed,interrupted.state.environment);assert.equal(recoveryChoice(resumed,ordinary,'understanding'),null);
  for(let i=0;actor.active&&i<100;i++)tick();
  assert.equal(actor.lastResult.code,'ARRIVED');assert.ok(actor.position.y<before.y-9);
  assert.equal(geometry.classify(actor.position.x,actor.position.y).walkable,true);
  assert.ok(actor.lastResult.durationSeconds>0);assert.ok(actor.lastResult.distance>9);
  controller.dispose();
});
