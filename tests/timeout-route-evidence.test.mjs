import { readFileSync } from 'node:fs';
import { distance } from '../src/world.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, NPC_RULES } from '../src/config.js';
import { createNpc } from '../src/npc-state.js';
import { createEnvironment, tickEnvironment } from '../src/environment.js';
import { OZARK_WORLD_PROFILE, createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { bindOzarkWorldAgent } from '../src/ozark-agent-world.js';
import { observeNpc, requestNpcAction, tickNpc } from '../src/npc.js';
import { discoveryDecision } from '../src/discovery.js';
import { NpcController } from '../src/controller.js';
import { noteTimeoutRoutePaid, finishTimeoutRouteEvidence, timeoutRouteBlocks, timeoutDirection } from '../src/timeout-route-evidence.js';
import { knownRoute, createKnownRouteIndex } from '../src/navigation.js';
import { tileKey, tilePoint, rememberedCells, rememberedEdges } from '../src/perception.js';
import { tickOzarkEcology } from '../src/ozark-ecology.js';
import { recordEvent } from '../src/npc-memory.js';
import { createOzarkState, writeOzarkSave, loadOzarkSave, OZARK_SAVE_KEY } from '../src/ozark-save.js';

function fixture({speed=1,drift=0,wall=30,jitter=false}={}){
  const actor=createNpc({id:'aster',mode:'discovery',seed:1});actor.position={x:0,y:0};
  const environment=createEnvironment(1,{mode:'discovery',populate:false});
  environment.ecology={plants:[],animals:[],materials:[]};
  const calls=[],control={wall,speed,drift,fraction:1,occluded:false,ground:'dry-ground',freeze:false};let count=0;
  const geometry={fundedAdvance:true,profile:OZARK_WORLD_PROFILE,bounds:{minX:-19000,maxX:19000,minY:-14200,maxY:14200},
    canOccupy:()=>true,classify:()=>({walkable:true,reason:'dry-ground'}),
    sample:()=>({paint:'oak-pine-woodland',canopy:0,light:1,elevation:200,habitat:'meadow'}),
    observe:()=>({ground:control.ground,nearby:[]}),groundAt:()=>control.ground,
    lineOfSight:()=>!control.occluded,
    advance(position,dx,dy,dt,sprint=false,mode='walk',funding){
      const before={...position},length=Math.hypot(dx,dy);const paid=length?(funding?funding(dt*control.fraction,1):dt*control.fraction):0;if(length)count++;
      if(length&&paid>0&&!control.freeze){
        const travel=jitter?(count%2?1:-1):CONFIG.walkSpeed*paid*control.speed;
        const x=position.x+dx/length*travel,y=position.y+dy/length*travel;
        if(x<=control.wall){position.x=x;position.y=y;}
      }
      const inputDx=position.x-before.x,inputDy=position.y-before.y;
      position.x+=control.drift*dt;
      const motion={paidSeconds:paid,inputDx,inputDy,distance:Math.hypot(position.x-before.x,position.y-before.y),driftDistance:Math.abs(control.drift*dt),waterSeconds:control.drift?dt:0,swimSeconds:0,climbSeconds:0,fallRiskSeconds:0,effortSeconds:paid};
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
function opposed(){return fixture({wall:Infinity,speed:.2,drift:-CONFIG.walkSpeed*.2});}
function failTwice(f){for(let i=0;i<2;i++)assert.equal(runAction(f).code,'ACTION_TIMEOUT');return timeoutRouteBlocks(f.actor);}
test('two actual funded opposed-current timeouts change next route, without blocking reverse',()=>{
  const f=opposed(),n=f.actor,energy=n.physiology.availableEnergyKcal;
  assert.equal(runAction(f).code,'ACTION_TIMEOUT');assert.equal(timeoutRouteBlocks(n),null);
  assert.equal(runAction(f).code,'ACTION_TIMEOUT');const blocks=timeoutRouteBlocks(n);
  assert.ok(blocks?.has('0,0>1,0'));assert.ok(n.physiology.availableEnergyKcal<energy);
  assert.deepEqual(n.memory.blockedEdges,{});
  const normal=knownRoute(n.memory.cells,n.position,{x:80,y:0});
  const changed=knownRoute(n.memory.cells,n.position,{x:80,y:0},30,{},n.elapsed,null,blocks);
  assert.notDeepEqual(changed,normal);
  assert.equal(requestNpcAction(n,{type:'move',target:{x:80,y:0}},f.environment).code,'STARTED');
  assert.notDeepEqual(n.active.route[0],normal[0]);
  n.active=null;
  n.position={x:80,y:0};n.navigationAnchor=null;
  assert.equal(runAction(f,{type:'move',target:{x:0,y:0}}).code,'ARRIVED');
});
test('one transient failure followed by success cannot form a pair',()=>{
  const f=opposed();runAction(f);assert.equal(runAction(f,{type:'move',target:{x:-80,y:0}}).code,'ARRIVED');
  f.actor.position={x:0,y:0};f.actor.navigationAnchor=null;runAction(f);assert.equal(timeoutRouteBlocks(f.actor),null);
});
test('short deadlines and unfunded attempts do not establish preference',()=>{
  const f=opposed();for(let i=0;i<2;i++)runAction(f,{type:'move',target:{x:80,y:0},duration:1});assert.equal(timeoutRouteBlocks(f.actor),null);
  const g=opposed();g.actor.physiology.availableEnergyKcal=0;
  for(let i=0;i<2&&g.actor.lifecycle==='AWAKE';i++){const r=requestNpcAction(g.actor,{type:'move',target:{x:80,y:0}},g.environment);if(r.code==='STARTED')for(let k=0;k<1000&&g.actor.active;k++)tickNpc(g.actor,1/60,g.environment);}
  assert.equal(timeoutRouteBlocks(g.actor),null);
});
test('actor-local runtime evidence cannot transfer through clones or another actor',()=>{
  const f=opposed();assert.ok(failTwice(f));const g=opposed();g.actor.memory=structuredClone(f.actor.memory);assert.equal(timeoutRouteBlocks(g.actor),null);assert.equal(timeoutRouteBlocks(structuredClone(f.actor)),null);
});
for(const change of ['expiry','distance','epoch','scene','discovery','clock','receipt'])test(`evidence invalidates on ${change}`,()=>{
  const f=opposed();assert.ok(failTwice(f));const n=f.actor;
  if(change==='expiry')n.elapsed+=60;
  if(change==='distance')n.position.x+=161;
  if(change==='epoch')n.epoch++;
  if(change==='scene')n.scene='elsewhere';
  if(change==='discovery')n.discovery=structuredClone(n.discovery);
  if(change==='clock')n.elapsed=0;
  if(change==='receipt')n.memory.experience=[];
  assert.equal(timeoutRouteBlocks(n),null);
});
test('urgent hunger and recent personally experienced contact bypass preference',()=>{
  const f=opposed();assert.ok(failTwice(f));const n=f.actor;n.physiology.satietyHours=0;n.physiology.hoursSinceMeal=20;assert.equal(timeoutRouteBlocks(n),null);
  const g=opposed();assert.ok(failTwice(g));recordEvent(g.actor,'condition',{code:'CONTACT_INJURY',provenance:'experienced contact',scene:g.actor.scene});assert.equal(timeoutRouteBlocks(g.actor),null);
});
test('per-waypoint payment cannot be pooled, and same-tile endpoints are excluded',()=>{
  for(const sameTile of [false,true]){
    const f=opposed(),n=f.actor;
    for(let i=0;i<2;i++){
      const active={request:{type:'move'},index:0,startedAt:n.elapsed,expiresAt:n.elapsed+12};
      noteTimeoutRoutePaid(n,active,{x:0,y:0},{x:80,y:0},10);
      active.index=1;
      noteTimeoutRoutePaid(n,active,{x:0,y:0},{x:sameTile?10:80,y:0},sameTile?10:2);
      n.elapsed+=12;const event=recordEvent(n,'action',{result:{ok:false,code:'ACTION_TIMEOUT'}});finishTimeoutRouteEvidence(n,active,event);
    }
    assert.equal(timeoutRouteBlocks(n),null);
  }
});
test('lazy and direct directed queries agree, ordinary frozen behavior remains separate',()=>{
  const f=opposed(),n=f.actor;const blocks=failTwice(f),index=createKnownRouteIndex(n.memory.cells,n.position,{},n.elapsed,null,blocks);
  for(const to of [{x:80,y:0},{x:-80,y:0},{x:0,y:80}])assert.deepEqual(index.route(to),knownRoute(n.memory.cells,n.position,to,30,{},n.elapsed,null,blocks));
});

test('slow but meaningful net progress does not establish timeout evidence',()=>{
  const f=fixture({wall:Infinity,speed:.03});
  for(let i=0;i<2;i++){assert.equal(runAction(f,{type:'move',target:{x:160,y:0}}).code,'ACTION_TIMEOUT');assert.equal(timeoutRouteBlocks(f.actor),null);}
});
test('partial physical funding cannot establish the eight-second paid threshold',()=>{
  const f=opposed();f.control.fraction=.25;f.control.drift=-CONFIG.walkSpeed*.2*.25;
  for(let i=0;i<2;i++)assert.equal(runAction(f).code,'ACTION_TIMEOUT');assert.equal(timeoutRouteBlocks(f.actor),null);
});
test('earlier physical waypoints do not fund final waypoint evidence',()=>{
  const f=fixture({wall:Infinity,speed:.06}),n=f.actor;
  assert.equal(requestNpcAction(n,{type:'move',target:{x:160,y:0}},f.environment).code,'STARTED');
  for(let i=0;n.active&&i<1000;i++){
    if(n.active.index>=1){f.control.speed=.2;f.control.drift=-30;}
    tickNpc(n,1/60,f.environment);
  }
  assert.equal(n.lastResult.code,'ACTION_TIMEOUT');assert.equal(timeoutRouteBlocks(n),null);
  assert.equal(runAction(f,{type:'move',target:{x:160,y:0}}).code,'ACTION_TIMEOUT');assert.equal(timeoutRouteBlocks(n),null);
});
test('real save codec roundtrip cannot restore session-only preference (authored plumbing)',()=>{
  const geometry=createOzarkWorldGeometry(),state=createOzarkState(geometry),n=state.agents[0];
  for(const a of state.agents)bindOzarkWorldAgent(a,geometry,state);
  for(let i=0;i<2;i++){
    const active={request:{type:'move'},index:0,startedAt:n.elapsed,expiresAt:n.elapsed+12};
    noteTimeoutRoutePaid(n,active,n.position,{x:n.position.x+80,y:n.position.y},8);
    n.elapsed+=12;const event=recordEvent(n,'action',{action:{type:'move'},result:{ok:false,code:'ACTION_TIMEOUT',durationSeconds:12},startPosition:{...n.position}});
    finishTimeoutRouteEvidence(n,active,event);
  }
  assert.ok(timeoutRouteBlocks(n));state.elapsed=state.environment.elapsed=n.elapsed;
  state.environment.ecology.elapsed=n.elapsed;state.environment.ecology.pending=0;
  for(const a of state.agents)a.elapsed=n.elapsed;
  const values=new Map(),disk={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
  assert.equal(writeOzarkSave(disk,state,geometry),true);
  const bytes=disk.getItem(OZARK_SAVE_KEY),opened=loadOzarkSave(disk,geometry);assert.equal(opened.blocked,false,opened.error);
  const restored=opened.state.agents[0];bindOzarkWorldAgent(restored,geometry,opened.state);
  assert.equal(timeoutRouteBlocks(restored),null);assert.deepEqual(restored.memory.blockedEdges,{});assert.equal(disk.getItem(OZARK_SAVE_KEY),bytes);
});

test('resource final-tail and initial anchor checks honor direction, not reversed travel',()=>{
  const source=readFileSync(new URL('../src/npc.js',import.meta.url),'utf8');
  const start=source.indexOf('function observedResourceRoute('),end=source.indexOf('export function requestNpcAction',start);
  const route=new Function('rememberedCells','rememberedEdges','distance','tilePoint','tileKey','CONFIG','NPC_RULES','knownRoute','timeoutRouteBlocks','timeoutDirection',source.slice(start,end)+';return observedResourceRoute;')(rememberedCells,rememberedEdges,distance,tilePoint,tileKey,CONFIG,NPC_RULES,knownRoute,timeoutRouteBlocks,timeoutDirection);
  const f=opposed(),n=f.actor;assert.ok(failTwice(f));
  n.position={x:0,y:0};n.navigationAnchor=null;
  n.memory.cells=Object.fromEntries(Object.entries(n.memory.cells).filter(([key])=>['0,0','1,0'].includes(key)));
  assert.equal(route(n,{x:80,y:0}),null,'no alternate graph path or appended tail may evade direction');
  const anchored=knownRoute(n.memory.cells,n.position,{x:80,y:0},30,{},n.elapsed,'1,0',timeoutRouteBlocks(n));
  assert.equal(anchored,null,'initial anchor snap cannot evade direction');
  n.position={x:80,y:0};n.navigationAnchor=null;assert.ok(route(n,{x:0,y:0}));
});
test('expiry restores direct admission and the older supporting receipt cannot outlive its bound',()=>{
  const f=opposed(),n=f.actor;assert.ok(failTwice(f));
  n.elapsed+=49;assert.equal(timeoutRouteBlocks(n),null);
  assert.deepEqual(knownRoute(n.memory.cells,n.position,{x:80,y:0},30,{},n.elapsed,null,timeoutRouteBlocks(n)),knownRoute(n.memory.cells,n.position,{x:80,y:0}));
});

for(const separation of [40,41,100])test(`completion positions must remain within 40 units: ${separation}`,()=>{
  const f=opposed(),n=f.actor;
  // Authored session-plumbing control isolates pairing; physical funding has
  // separate action-engine coverage above. Origins and targets stay identical.
  for(let attempt=0;attempt<2;attempt++){
    n.position={x:0,y:0};
    const active={request:{type:'move'},index:0,startedAt:n.elapsed,expiresAt:n.elapsed+12};
    noteTimeoutRoutePaid(n,active,n.position,{x:80,y:0},8);
    n.elapsed+=12;n.position={x:attempt?-separation:0,y:0};
    const event=recordEvent(n,'action',{action:{type:'move'},result:{ok:false,code:'ACTION_TIMEOUT',durationSeconds:12}});
    finishTimeoutRouteEvidence(n,active,event);
  }
  assert.equal(Boolean(timeoutRouteBlocks(n)),separation<=40);
});
