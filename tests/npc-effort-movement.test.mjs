import { discoveryDecision } from '../src/discovery.js';
import { recordEvent } from '../src/npc-memory.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { createNpc } from '../src/npc-state.js';
import { createEnvironment } from '../src/environment.js';
import { createOzarkWorldGeometry, OZARK_WORLD_PROFILE } from '../src/ozark-world-geometry.js';
import { bindOzarkWorldAgent } from '../src/ozark-agent-world.js';
import { tickNpc, observeNpc, requestNpcAction } from '../src/npc.js';
import { projectPhysiology } from '../src/biology.js';
import { npcEffortCost, markNpcRunTravel } from '../src/npc-effort-funding.js';
import { NpcController } from '../src/controller.js';

const geometry=createOzarkWorldGeometry();
const near=(a,b,t=1e-8)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
function fixture(position={x:-680,y:380}) {
  const n=createNpc({id:'aster',mode:'discovery'}),e=createEnvironment(1,{mode:'discovery',populate:false});
  e.ecology={plants:[],animals:[],materials:[]};n.position={...position};
  e.settings.hourOverride=10;e.settings.weatherOverride='cloudy';
  bindOzarkWorldAgent(n,geometry,{geometryIdentity:OZARK_WORLD_PROFILE.identity,agents:[n]});
  return {n,e};
}
function empty(n) {n.physiology.availableEnergyKcal=0;n.physiology.storedEnergyKcal=0;n.physiology.stomach=[];projectPhysiology(n);}
// Explicit low-level motor fixture: not claimed as controller route selection.
function motor(n,type='move',target={x:n.position.x+80,y:n.position.y},deadline=12) {
  n.active={request:{type,target},route:[target],index:0,startedAt:n.elapsed,expiresAt:n.elapsed+deadline,
    startPosition:{...n.position},startScene:n.scene,startRisk:n.riskCost,startWetness:n.thermal.wetness,
    startStamina:n.stamina,startFatigue:n.fatigue,blockedFor:0,travelled:0,forwardProgress:0,attemptedDistance:0,
    waterSeconds:0,swimSeconds:0,climbSeconds:0,fallRiskSeconds:0,passiveDriftSeconds:0};
  return n.active;
}

test('empty dry-ground NPC has no propulsion or purposeful evidence while its clock and basal harm continue',()=>{
  const {n,e}=fixture();empty(n);const start={...n.position},a=motor(n),health=n.health;
  tickNpc(n,.25,e);
  assert.deepEqual(n.position,start);assert.equal(a.forwardProgress,0);assert.equal(a.attemptedDistance,0);
  assert.equal(n.elapsed,.25);assert.ok(n.health<health);assert.equal(n.physiology.totals.metabolizedKcal,0);
});

test('half affordable motor time pays exactly its displacement after unchanged basal use',()=>{
  const {n,e}=fixture();empty(n);const dt=.25,pace=.55,paid=dt*pace/2;
  n.physiology.availableEnergyKcal=100*dt/150+npcEffortCost(paid);projectPhysiology(n);
  const before=n.physiology.availableEnergyKcal,start={...n.position},a=motor(n);
  tickNpc(n,dt,e);
  near(n.position.x-start.x,CONFIG.walkSpeed*paid);near(a.attemptedDistance,CONFIG.walkSpeed*paid);
  near(n.physiology.totals.metabolizedKcal,before);near(n.physiology.availableEnergyKcal,0);
});

test('unfunded deep-water walk and swim retain the full passive frame without free progress',()=>{
  for(const type of ['move','swim']) {
    const {n,e}=fixture({x:-1200,y:220});empty(n);const a=motor(n,type),expected={...n.position};
    // Input time retains its original exhausted partition, followed by remainder.
    geometry.advance(expected,0,0,.25*.55,false);geometry.advance(expected,0,0,.25*.45,false);
    tickNpc(n,.25,e);
    near(n.position.x,expected.x);near(n.position.y,expected.y);near(a.waterSeconds,.25);
    assert.equal(a.forwardProgress,0);assert.equal(a.attemptedDistance,0);assert.equal(a.swimSeconds,0);
    assert.ok(n.thermal.wetness>=4.5-1e-8);
  }
});

test('waypoint, finished-route and expired movement early returns cannot suppress passive current',()=>{
  for(const kind of ['waypoint','finished','expired']) {
    const {n,e}=fixture({x:-1200,y:220});empty(n);const a=motor(n,'swim');
    if(kind==='waypoint')a.route=[{...n.position}];
    if(kind==='finished')a.route=[];
    if(kind==='expired')a.expiresAt=n.elapsed;
    const expected={...n.position};geometry.advance(expected,0,0,.25,false);
    tickNpc(n,.25,e);near(n.position.x,expected.x);near(n.position.y,expected.y);near(a.waterSeconds,.25);
    assert.equal(a.attemptedDistance,0);
  }
});

test('exhausted final deadline slice clips elapsed time before pace and still times out',()=>{
  const {n,e}=fixture();n.physiology.stamina=5;projectPhysiology(n);
  const a=motor(n,'move',undefined,.05),start={...n.position};
  tickNpc(n,.25,e);
  near(n.position.x-start.x,CONFIG.walkSpeed*.05*.55);near(a.attemptedDistance,CONFIG.walkSpeed*.05*.55);
  assert.equal(n.lastResult.code,'ACTION_TIMEOUT');
});

test('run-owned travel keeps its original deadline through controller sanitization; unrelated travel does not',()=>{
  for(const owned of [true,false]) {
    const {n,e}=fixture({x:0,y:0});observeNpc(n,e);
    const controller=new NpcController(n,{environment:e});
    n.discovery.run={startedAt:-89.9,techniqueId:'fixture',cursor:0,awaiting:false};
    const request={type:'move',target:{x:80,y:0}};
    if(owned)markNpcRunTravel(n,request);
    try {
      assert.equal(controller.perform(request).code,'STARTED');
      near(n.active.expiresAt,owned?.1:12);
      if(owned){tickNpc(n,.25,e);assert.equal(n.lastResult.code,'ACTION_TIMEOUT');assert.equal(n.discovery.run,null);}
    } finally {controller.dispose();}
  }
});

test('depleted movement stays bounded across fixed-step partitions without unpaid distance',()=>{
  for(const dt of [1/30,1/60,1/120]) {
    const {n,e}=fixture();empty(n);const start={...n.position};motor(n,'move',undefined,.4);
    for(let i=0;n.active&&i<100;i++)tickNpc(n,dt,e);
    assert.equal(n.active,null);assert.equal(n.lastResult.code,'ACTION_TIMEOUT');assert.deepEqual(n.position,start);
    // Terminal elapsed may include one normal caller step, never an extra motor slice.
    assert.ok(n.elapsed>=.4-1e-9&&n.elapsed<=.4+dt+1e-8);
  }
});

test('experienced contact still selects escape while an empty body cannot execute it for free',()=>{
  const {n,e}=fixture({x:0,y:0});const controller=new NpcController(n,{environment:e});empty(n);
  const sourceId='object:99999',sourcePosition={x:-40,y:0};
  n.discovery.observations[sourceId]={id:sourceId,position:sourcePosition,observedAt:n.elapsed};
  recordEvent(n,'condition',{code:'CONTACT_INJURY',provenance:'experienced contact',scene:n.scene,sourceId,sourcePosition});
  const choice=discoveryDecision(n),start={...n.position};assert.equal(choice.need,'safety');assert.equal(choice.action.type,'move');
  try {assert.equal(controller.perform(choice.action).code,'STARTED');tickNpc(n,.25,e);assert.deepEqual(n.position,start);assert.equal(n.active.attemptedDistance,0);}
  finally {controller.dispose();}
});
