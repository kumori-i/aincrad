import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, NPC_RULES } from '../src/config.js';
import { OZARK_WORLD_PROFILE } from '../src/ozark-world-geometry.js';
import { createNpc } from '../src/npc-state.js';
import { createEnvironment } from '../src/environment.js';
import { environmentConditions } from '../src/environment.js';
import { observeNpc, requestNpcAction, tickNpc, collapseNpc, rescueNpc } from '../src/npc.js';
import { actorLineOfSight } from '../src/perception.js';
import { bindOzarkWorldAgent, ozarkAgentWorld, ozarkPersistentWorldAgent, ozarkAgentSensation } from '../src/ozark-agent-world.js';
import { bindOzarkEcology } from '../src/ozark-ecology.js';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { NpcController, decisionObservation } from '../src/controller.js';
import { discoveryDecision } from '../src/discovery.js';
import { createOzarkState } from '../src/ozark-save.js';
import { PopulationRuntime } from '../src/population.js';

function fixture() {
  const aster=createNpc({id:'aster',mode:'discovery',seed:1});
  const mira=createNpc({id:'mira',mode:'discovery',seed:2});
  aster.position={x:0,y:0};
  mira.position={x:800,y:0};
  const state={geometryIdentity:OZARK_WORLD_PROFILE.identity,agents:[aster,mira]};
  const calls={sample:[],classify:[],advance:[]};
  const geometry=Object.freeze({
    fundedAdvance:true,profile:OZARK_WORLD_PROFILE,
    bounds:{minX:-19000,maxX:19000,minY:-14200,maxY:14200},
    classify(x,y){calls.classify.push({x,y});return {walkable:Number.isFinite(x)&&Number.isFinite(y)&&x<900&&!(x>=120&&x<=280),reason:x>=120&&x<=280?'deep-water':'dry-ground'};},
    canOccupy(x,y){return Number.isFinite(x)&&Number.isFinite(y)&&x<900;},
    sample(x,y){calls.sample.push({x,y});return {paint:[160,240].includes(x)?'surface-water':'oak-pine-woodland',canopy:.8,light:.1,elevation:200,habitat:'shaded-cove'};},
    observe(point){return {ground:point.x>=120&&point.x<=280?'deep-water':'dry-land',nearby:[]};},
    lineOfSight(from,to){return !(from.x===0&&to.x===0&&to.y===160);},
    advance(actor,dx,dy,dt,sprint=false,mode='walk',funding){calls.advance.push({x:actor.x,y:actor.y,dx,dy,dt,mode});
      const d=Math.hypot(dx,dy),paid=d?(funding?funding(dt,mode==='swim'?2.6:1):dt):0,speed=CONFIG.walkSpeed*Math.min(paid,.25);
      if(d){actor.x+=dx/d*speed;actor.y+=dy/d*speed;}
      const waterSeconds=actor.x>=120&&actor.x<=280?dt:0;
      return {paidSeconds:paid,inputDx:d?dx/d*speed:0,inputDy:d?dy/d*speed:0,distance:d?speed:0,driftDistance:0,waterSeconds,
        swimSeconds:mode==='swim'&&waterSeconds?paid:0,climbSeconds:0,
        fallRiskSeconds:0,effortSeconds:paid*(mode==='swim'?2.6:1)};
    },
  });
  const environment=createEnvironment(3,{mode:'discovery',populate:false});
  environment.ecology={elapsed:0,plants:[
    {id:'object:1',kind:'grass',scene:'valley',position:{x:80,y:0},moisture:.5,biomassGrams:100},
    {id:'object:2',kind:'grass',scene:'valley',position:{x:0,y:160},moisture:.5,biomassGrams:100},
    {id:'object:3',kind:'grass',scene:'valley',position:{x:880,y:0},moisture:.5,biomassGrams:100},
  ],animals:[],materials:[]};
  return {aster,mira,state,geometry,environment,calls};
}

test('full-world binding preserves each restored actor and rejects another world identity',()=>{
  const f=fixture();
  f.aster.elapsed=42;
  f.aster.memory.experience.push({id:1,at:41,type:'action',details:{action:{type:'move'},result:{ok:false,code:'ROUTE_BLOCKED'}}});
  f.aster.memory.nextId=2;
  f.aster.thermal.wetness=37;
  f.aster.physiology.fatigue=12;
  f.aster.discovery.search.home={x:24,y:32};
  const before=structuredClone(f.aster);
  assert.throws(()=>bindOzarkWorldAgent(f.aster,f.geometry,{...f.state,geometryIdentity:'wrong'}));
  assert.throws(()=>bindOzarkWorldAgent(f.aster,f.geometry,{...f.state,agents:[f.mira]}));
  assert.deepEqual(f.aster,before);
  assert.equal(bindOzarkWorldAgent(f.aster,f.geometry,f.state),f.aster);
  assert.deepEqual(f.aster,before,'binding must not reset restored body, position, or evidence');
  assert.equal(ozarkAgentWorld(f.aster),f.geometry);
  assert.equal(ozarkPersistentWorldAgent(f.aster),true);
  assert.equal(ozarkAgentWorld(f.mira),null);
  assert.equal(ozarkPersistentWorldAgent(f.mira),false);
  assert.equal(bindOzarkWorldAgent(f.mira,f.geometry,f.state),f.mira);
  assert.equal(ozarkAgentWorld(f.mira),f.geometry);
  const blocked=fixture();blocked.mira.position={x:950,y:0};
  assert.throws(()=>bindOzarkWorldAgent(blocked.mira,blocked.geometry,blocked.state),/reachable/);
  const swimmer=fixture();swimmer.aster.position={x:100,y:0};
  const waterGeometry={...swimmer.geometry,
    classify(){return {walkable:false,reason:'deep-water'};},
    canOccupy(){return true;}};
  assert.equal(bindOzarkWorldAgent(swimmer.aster,waterGeometry,swimmer.state),swimmer.aster,
    'a restored swimming position must not be reset because walking there is impossible');
  assert.deepEqual(swimmer.aster.position,{x:100,y:0});
});

test('both agents see only their local Ozark cells and ecology, without private geometry values or legacy sources',()=>{
  const f=fixture();
  bindOzarkWorldAgent(f.aster,f.geometry,f.state);
  bindOzarkWorldAgent(f.mira,f.geometry,f.state);
  const first=observeNpc(f.aster,f.environment);
  const second=observeNpc(f.mira,f.environment);
  assert.deepEqual(first.objects.map(o=>o.id),['object:1']);
  assert.deepEqual(second.objects.map(o=>o.id),['object:3']);
  assert.equal(first.cells.some(c=>c.x===0&&c.y===160),false,'occluded tile stays unseen');
  assert.equal(first.cells.find(c=>c.x===160&&c.y===0)?.terrain,'surface-water');
  assert.equal(first.cells.find(c=>c.x===160&&c.y===0)?.walkable,true,
    'a visually seen river is attemptable, not certified safe');
  for(const observation of [first,second]){
    assert.deepEqual(observation.sources,[]);
    assert.deepEqual(observation.shelters,[]);
    assert.ok(observation.cells.every(c=>Math.hypot(c.x-observation.position.x,c.y-observation.position.y)<=NPC_RULES.visionRadius));
    assert.doesNotMatch(JSON.stringify(observation),/depthProxy|surfaceWaterDistance|currentDirection|grade|cave-mouth/);
  }
  assert.equal(actorLineOfSight(f.aster,f.aster.position,{x:0,y:160}),false);
  assert.equal(actorLineOfSight(f.mira,f.mira.position,{x:880,y:0}),true);
  assert.notDeepEqual(Object.keys(f.aster.memory.cells),Object.keys(f.mira.memory.cells));
});

test('a full-world move is admitted from one actor\'s observed cells and uses the bound geometry',()=>{
  const f=fixture();
  bindOzarkWorldAgent(f.aster,f.geometry,f.state);
  bindOzarkWorldAgent(f.mira,f.geometry,f.state);
  observeNpc(f.aster,f.environment);
  observeNpc(f.mira,f.environment);
  assert.equal(requestNpcAction(f.aster,{type:'move',target:{x:80,y:0}},f.environment).code,'STARTED');
  for(let step=0;step<80&&f.aster.active;step++)tickNpc(f.aster,CONFIG.fixedStep,f.environment);
  assert.equal(f.aster.active,null);
  assert.equal(f.aster.lastResult.code,'ARRIVED');
  assert.ok(f.calls.advance.length>0);
  assert.deepEqual(f.mira.position,{x:800,y:0},'the other body remains independent');
  assert.equal(f.mira.memory.experience.some(e=>e.type==='action'),false);
  assert.equal(f.aster.lastResult.movement.footing,'dry-ground');
});

test('a locally seen Ozark ecology object is inspectable through Ozark line of sight',()=>{
  const f=fixture();
  bindOzarkWorldAgent(f.aster,f.geometry,f.state);
  observeNpc(f.aster,f.environment);
  assert.equal(requestNpcAction(f.aster,{type:'inspect_object',targetId:'object:2'},f.environment).code,
    'UNKNOWN_OBJECT','a hidden plant cannot be named from unseen ecology');
  assert.equal(requestNpcAction(f.aster,{type:'inspect_object',targetId:'object:1'},f.environment).code,
    'ACTION_STARTED');
  for(let step=0;step<180&&f.aster.active;step++)tickNpc(f.aster,CONFIG.fixedStep,f.environment);
  assert.equal(f.aster.active,null);
  assert.equal(f.aster.lastResult.code,'OBJECT_OBSERVED');
  assert.equal(f.aster.memory.experience.at(-1).details.action.targetId,'object:1');
});

test('persistent Ozark canopy shade reaches the actor',()=>{
  const f=fixture();
  f.environment.ecology.ozarkEcologyVersion=1;
  f.environment.ecology.geometryIdentity=OZARK_WORLD_PROFILE.identity;
  bindOzarkEcology(f.environment.ecology,f.geometry);
  bindOzarkWorldAgent(f.aster,f.geometry,f.state);
  const local=environmentConditions(f.environment,{position:f.aster.position,scene:'valley',wetness:0});
  assert.equal(local.shade,true);
  assert.deepEqual(ozarkAgentSensation(f.aster,f.environment),local);
  assert.equal(observeNpc(f.aster,f.environment).environment.shade,'shaded');
});

test('full-world swim is bounded physical movement with exertion and no hidden depth in its receipt',()=>{
  const f=fixture();bindOzarkWorldAgent(f.aster,f.geometry,f.state);
  observeNpc(f.aster,f.environment);
  assert.equal(requestNpcAction(f.aster,{type:'swim',sourceId:'pond',target:{x:160,y:0}},f.environment).code,'INVALID_REQUEST');
  assert.equal(requestNpcAction(f.aster,{type:'swim',target:{x:880,y:0}},f.environment).code,'UNOBSERVED_TARGET');
  const energy=f.aster.physiology.availableEnergyKcal;
  assert.equal(requestNpcAction(f.aster,{type:'swim',target:{x:160,y:0}},f.environment).code,'STARTED');
  for(let i=0;i<120&&f.aster.active;i++)tickNpc(f.aster,CONFIG.fixedStep,f.environment);
  assert.equal(f.aster.lastResult.code,'ARRIVED');
  assert.equal(f.aster.lastResult.action,'swim');
  assert.equal(f.aster.lastResult.movement.traversal,'swimming');
  assert.ok(f.aster.thermal.wetness>0);
  assert.ok(f.aster.physiology.availableEnergyKcal<energy);
  assert.ok(f.calls.advance.some(call=>call.mode==='swim'));
  assert.doesNotMatch(JSON.stringify(f.aster.lastResult.movement),/depthProxy|grade|currentDirection|swimSeconds/);
});

test('a resisted climb can slip, injure the body and finish with a truthful receipt',()=>{
  const f=fixture();
  const blocked=Object.freeze({...f.geometry,
    advance(_actor,_dx,_dy,dt,_sprint,mode,funding){
      const paid=(_dx||_dy)?(funding?funding(dt,2):dt):0;
      f.calls.advance.push({mode,dt});
      return {paidSeconds:paid,inputDx:0,inputDy:0,distance:0,driftDistance:0,waterSeconds:0,swimSeconds:0,climbSeconds:0,
        fallRiskSeconds:mode==='climb'?paid:0,effortSeconds:2*paid};
    },
  });
  bindOzarkWorldAgent(f.aster,blocked,f.state);observeNpc(f.aster,f.environment);
  const health=f.aster.health;
  assert.equal(requestNpcAction(f.aster,{type:'climb',target:{x:80,y:0}},f.environment).code,'STARTED');
  for(let i=0;i<100&&f.aster.active;i++)tickNpc(f.aster,CONFIG.fixedStep,f.environment);
  assert.equal(f.aster.lastResult.code,'SLIPPED');
  assert.equal(f.aster.lastResult.action,'climb');
  assert.ok(f.aster.health<health);
  assert.ok(f.aster.memory.experience.some(event=>event.type==='condition'&&event.details.code==='CLIMB_SLIP'));
  assert.ok(f.calls.advance.some(call=>call.mode==='climb'));
});

test('a first local divide sighting permits a bounded climb experiment without a grade lookup',()=>{
  const f=fixture();
  const divide=Object.freeze({...f.geometry,sample(x,y){f.calls.sample.push({x,y});return {paint:x===80?'divide':'oak-pine-woodland'};}});
  bindOzarkWorldAgent(f.aster,divide,f.state);observeNpc(f.aster,f.environment);
  assert.equal(f.aster.memory.cells['1,0'].terrain,'visible-divide');
  const classifyCalls=f.calls.classify.length;
  const choice=discoveryDecision(f.aster);
  assert.deepEqual(choice.action,{type:'climb',target:{x:80,y:0}});
  assert.equal(f.calls.classify.length,classifyCalls,'the choice did not query hidden physical grade');
});

test('offline controller turns an actual blocked walk receipt into a swim request',()=>{
  const f=fixture();
  const water=Object.freeze({...f.geometry,
    advance(actor,dx,dy,dt,_sprint,mode,funding){
      const paid=(dx||dy)?(funding?funding(dt,mode==='swim'?2.6:1):dt):0;
      f.calls.advance.push({x:actor.x,y:actor.y,mode});
      if(mode==='walk'&&dx>0&&actor.x>=105)return {paidSeconds:paid,inputDx:0,inputDy:0,distance:0,driftDistance:0,waterSeconds:0,swimSeconds:0,climbSeconds:0,fallRiskSeconds:0,effortSeconds:paid};
      const d=Math.hypot(dx,dy),step=Math.min(d,CONFIG.walkSpeed*paid);
      if(d){actor.x+=dx/d*step;actor.y+=dy/d*step;}
      const wet=actor.x>=120&&actor.x<=280?dt:0;
      return {paidSeconds:paid,inputDx:d?dx/d*step:0,inputDy:d?dy/d*step:0,distance:step,driftDistance:0,waterSeconds:wet,swimSeconds:mode==='swim'&&wet?paid:0,climbSeconds:0,fallRiskSeconds:0,effortSeconds:paid*(mode==='swim'?2.6:1)};
    },
  });
  bindOzarkWorldAgent(f.aster,water,f.state);
  const controller=new NpcController(f.aster,{environment:f.environment});
  try{
    assert.ok(decisionObservation(f.aster).terrainActions.swim);
    assert.equal(requestNpcAction(f.aster,{type:'move',target:{x:160,y:0}},f.environment).code,'STARTED');
    for(let i=0;i<300&&f.aster.lastResult?.code!=='ROUTE_BLOCKED';i++)controller.tick(CONFIG.fixedStep);
    const blocked=f.aster.memory.experience.filter(e=>e.type==='action').at(-1);
    assert.equal(blocked.details.result.code,'ROUTE_BLOCKED');
    assert.deepEqual(blocked.details.result.blockedTarget,{x:160,y:0});
    for(let i=0;i<180&&f.aster.active?.request.type!=='swim';i++)controller.tick(CONFIG.fixedStep);
    assert.equal(f.aster.active?.request.type,'swim');
    for(let i=0;i<180&&f.aster.active;i++)controller.tick(CONFIG.fixedStep);
    assert.equal(f.aster.memory.experience.filter(e=>e.type==='action').at(-1).details.action.type,'swim');
    assert.equal(f.aster.lastResult.movement.traversal,'swimming');
  }finally{controller.dispose();}
});

test('a blocked walk in deep water still receives passive current without claiming swimming',()=>{
  const f=fixture();
  const deep=Object.freeze({...f.geometry,
    advance(actor,dx,dy,dt,_sprint,mode,funding){
      const paid=(dx||dy)?(funding?funding(dt,mode==='swim'?2.6:1):dt):0;
      f.calls.advance.push({dx,dy,mode});
      const drift=30*dt;actor.x+=drift;
      return {paidSeconds:paid,inputDx:0,inputDy:0,distance:drift,driftDistance:drift,waterSeconds:dt,swimSeconds:0,climbSeconds:0,fallRiskSeconds:0,effortSeconds:paid};
    },
  });
  bindOzarkWorldAgent(f.aster,deep,f.state);observeNpc(f.aster,f.environment);
  assert.equal(requestNpcAction(f.aster,{type:'move',target:{x:80,y:0}},f.environment).code,'STARTED');
  tickNpc(f.aster,CONFIG.fixedStep,f.environment);
  assert.equal(f.aster.position.x,.5);
  assert.equal(f.aster.active.forwardProgress,0);
  assert.equal(f.calls.advance.length,1,'the funded resisted slice integrates current once');
  for(let i=0;i<120&&f.aster.active;i++)tickNpc(f.aster,CONFIG.fixedStep,f.environment);
  assert.equal(f.aster.lastResult.code,'ROUTE_BLOCKED');
  assert.equal(f.aster.lastResult.movement.traversal,'adrift');
});

test('a collapsed full-world swimmer is recovered only after a bounded swept path to walkable footing',()=>{
  const geometry=createOzarkWorldGeometry(),aster=createNpc({id:'aster',mode:'discovery',seed:7});
  aster.position={x:-1400,y:-320};
  assert.equal(geometry.classify(aster.position.x,aster.position.y).reason,'deep-water');
  bindOzarkWorldAgent(aster,geometry,{geometryIdentity:OZARK_WORLD_PROFILE.identity,agents:[aster]});
  collapseNpc(aster,'test injury');
  assert.equal(rescueNpc(aster).code,'RESCUED');
  assert.equal(geometry.classify(aster.position.x,aster.position.y).walkable,true);
  const receipt=aster.memory.experience.find(e=>e.type==='rescue');
  assert.equal(receipt.details.recoveryMode,'swept swim');
  assert.ok(receipt.details.recoveryTravel>0);
});

test('autonomous river crossing continues its experienced heading across locally observed water',()=>{
  const geometry=createOzarkWorldGeometry(),aster=createNpc({id:'aster',mode:'discovery',seed:1});
  const environment=createEnvironment(1,{mode:'discovery',populate:false});
  environment.ecology={plants:[],animals:[],materials:[]};
  aster.position={x:-1200,y:400};
  bindOzarkWorldAgent(aster,geometry,{geometryIdentity:OZARK_WORLD_PROFILE.identity,agents:[aster]});
  const controller=new NpcController(aster,{environment});
  try{
    assert.equal(requestNpcAction(aster,{type:'move',target:{x:-1200,y:160}},environment).code,'STARTED');
    for(let i=0;i<2100&&aster.position.y>=-300;i++)controller.tick(CONFIG.fixedStep);
    assert.ok(aster.position.y< -300,'the agent made progress across the modeled channel');
    const actions=aster.memory.experience.filter(e=>e.type==='action');
    assert.equal(actions[0].details.result.code,'ROUTE_BLOCKED');
    assert.ok(actions.filter(e=>e.details.action.type==='swim'&&e.details.result.movement?.traversal==='swimming').length>=4);
    assert.ok(actions.every(e=>!JSON.stringify(e.details.result).match(/depthProxy|currentDirection|grade/)));
  }finally{controller.dispose();}
});

test('Ozark population construction leaves restored agent evidence untouched until its first tick',()=>{
  const geometry=createOzarkWorldGeometry(),state=createOzarkState(geometry);
  for(const actor of state.agents){bindOzarkWorldAgent(actor,geometry,state);observeNpc(actor,state.environment);}
  const before=state.agents.map(actor=>structuredClone(actor));
  const population=new PopulationRuntime(state);
  try{
    assert.deepEqual(state.agents,before);
    population.tick(CONFIG.fixedStep);
    assert.ok(state.agents.every(actor=>actor.elapsed>0));
  }finally{population.dispose();}
});
