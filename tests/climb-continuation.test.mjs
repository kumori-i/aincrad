import test from 'node:test';
import assert from 'node:assert/strict';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { createOzarkState } from '../src/ozark-save.js';
import { bindOzarkWorldAgent, ozarkFiniteAquaticAgent } from '../src/ozark-agent-world.js';
import { observeNpc, tickNpc } from '../src/npc.js';
import { NpcController } from '../src/controller.js';
import { discoveryDecision } from '../src/discovery.js';
import { successfulClimbHeading } from '../src/traversal-evidence.js';
import { CONFIG } from '../src/config.js';
const geometry=createOzarkWorldGeometry();
// Authored starting placement on actual Ozark terrain, not an autonomous study.
// No geometry, movement, observation, outcome, or paid-effort override is used.
function fixture(){
  const state=createOzarkState(geometry),actor=state.agents[0];
  actor.position={x:-12000,y:9790};actor.physiology.waterDeficitMl=0;
  bindOzarkWorldAgent(actor,geometry,state);observeNpc(actor,state.environment);
  const controller=new NpcController(actor,{environment:state.environment});
  return {state,actor,controller};
}
function complete(f){
  for(let i=0;i<150&&f.actor.active;i++)tickNpc(f.actor,CONFIG.fixedStep,f.state.environment);
  assert.equal(f.actor.active,null);
  observeNpc(f.actor,f.state.environment);
  return f.actor.memory.experience.filter(e=>e.type==='action').at(-1);
}
function firstClimb(f){
  f.controller.tick(CONFIG.fixedStep);
  assert.deepEqual(f.actor.active?.request,{type:'climb',target:{x:-12000,y:9840}});
  const receipt=complete(f);
  assert.equal(receipt.details.result.code,'ARRIVED');
  assert.equal(receipt.details.result.movement.traversal,'climbing');
  assert.ok(receipt.details.result.durationSeconds>0);
  return receipt;
}

test('own actual climbing success supports an optional paid continuation; subsequent slip stops it',()=>{
  const f=fixture();try{
    assert.equal(ozarkFiniteAquaticAgent(f.actor),true);firstClimb(f);
    assert.equal(geometry.observe(f.actor.position).ground,'steep-ground');
    const choice=discoveryDecision(f.actor);
    assert.equal(choice.need,'understanding');assert.equal(choice.action.type,'climb');
    assert.ok(choice.action.target.y>f.actor.position.y);
    f.actor.nextDecisionAt=f.actor.elapsed;f.controller.tick(CONFIG.fixedStep);
    assert.deepEqual(f.actor.active?.request,choice.action,'ordinary controller admits the same optional continuation');
    const outcome=complete(f);
    assert.equal(outcome.details.result.code,'SLIPPED','new target was not assumed safe');
    assert.equal(successfulClimbHeading(f.actor),null,'later failure supersedes prior success');
    assert.notEqual(discoveryDecision(f.actor).action.type,'climb');
  }finally{f.controller.dispose();}
});

test('learning disabled, another actor, departed approach, expiry and eviction cannot borrow the continuation',()=>{
  const f=fixture();try{
    const e=firstClimb(f),n=f.actor;
    assert.deepEqual(successfulClimbHeading(n),{x:0,y:1});
    n.learning=false;assert.equal(successfulClimbHeading(n),null);
    assert.notEqual(discoveryDecision(n).action.type,'climb');n.learning=true;
    assert.equal(successfulClimbHeading(f.state.agents[1]),null);
    const p={...n.position};n.position.x+=21;assert.equal(successfulClimbHeading(n),null);n.position=p;
    n.scene='elsewhere';assert.equal(successfulClimbHeading(n),null);n.scene='valley';
    n.elapsed=e.at+90;assert.equal(successfulClimbHeading(n),null);n.elapsed=e.at;
    n.memory.experience=n.memory.experience.filter(row=>row!==e);assert.equal(successfulClimbHeading(n),null);
  }finally{f.controller.dispose();}
});

test('command success without actual climbing or progress and ambiguous newer evidence mean unknown',()=>{
  const f=fixture();try{
    const e=firstClimb(f),n=f.actor,r=e.details.result;
    for(const patch of [{durationSeconds:0},{movement:{...r.movement,traversal:'walking'}},
      {movement:{...r.movement,traversal:'wading'}},{movement:{...r.movement,progress:'negligible'}},
      {movement:{...r.movement,effort:'steady'}}]){
      e.details.result={...r,...patch};assert.equal(successfulClimbHeading(n),null);
    }e.details.result=r;
    const newer=structuredClone(e);newer.id+=1;newer.at+=.01;n.elapsed=newer.at;
    newer.details.result={ok:true,code:'ARRIVED'};n.memory.experience.push(newer);
    assert.equal(successfulClimbHeading(n),null);
    n.memory.experience.pop();const twin=structuredClone(e);n.memory.experience.push(twin);
    assert.equal(successfulClimbHeading(n),null);n.memory.experience.reverse();assert.equal(successfulClimbHeading(n),null);
  }finally{f.controller.dispose();}
});

test('urgent drink remains prior to successful climbing curiosity',()=>{
  const f=fixture();try{
    firstClimb(f);f.actor.physiology.waterDeficitMl=1200;f.actor.flask.water=.2;
    assert.equal(discoveryDecision(f.actor).action.type,'drink');
  }finally{f.controller.dispose();}
});

test('necessary rest and nearby object experiments stay prior to continuation',()=>{
  const f=fixture();try{
    firstClimb(f);const n=f.actor;
    n.physiology.stamina=8;n.physiology.fatigue=80;
    assert.equal(discoveryDecision(n).need,'rest');
    n.physiology.stamina=100;n.physiology.fatigue=0;
    // Authored placement of an existing physical plant, not fabricated memory.
    // Tests priority only; it is not a natural ecological encounter.
    const plant=f.state.environment.ecology.plants.find(p=>p.kind==='grass');
    assert.ok(plant);plant.position={x:n.position.x+20,y:n.position.y};
    f.state.environment.ecology.plants=[...f.state.environment.ecology.plants]; // Rebuild the ordinary spatial index after fixture placement.
    const sensed=observeNpc(n,f.state.environment);
    assert.ok(sensed.objects.some(o=>o.id===plant.id));
    const choice=discoveryDecision(n);
    assert.notEqual(choice.action.type,'climb');
    assert.equal(choice.action.targetId,plant.id);
    assert.ok(successfulClimbHeading(n),'priority test still has genuine climb support');
  }finally{f.controller.dispose();}
});
