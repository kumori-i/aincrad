import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { createOzarkState } from '../src/ozark-save.js';
import { bindOzarkWorldAgent } from '../src/ozark-agent-world.js';
import { npcEffortCost } from '../src/npc-effort-funding.js';
import { createPlayerLessonController, PLAYER_LESSON_ACTION } from '../src/player-lesson-action.js';

const base = createOzarkWorldGeometry();
const close = (a,b) => Math.abs(a-b) < 1e-8;

// A single real ecology object at authored valid positions isolates the public
// point/parser contract. These unit crops are numeric fixtures, not Canvas proof.
function fixture({crop = true, failDelivery = false} = {}) {
  let blockedObserver = false, currentCrop = crop;
  let state;
  const geometry = Object.freeze({...base, lineOfSight(from,to) {
    if(blockedObserver && state?.agents?.some(actor =>
      actor.position.x === from.x && actor.position.y === from.y)) return false;
    return base.lineOfSight(from,to);
  }});
  state = createOzarkState(geometry,{communicationSeed:211});
  const ecology = state.environment.ecology;
  let source, places;
  for(const plant of ecology.plants.filter(row => row.kind === 'apple_tree' && row.stage === 'ripe')) {
    for(const side of [1,-1]) {
      const p={x:plant.position.x+side*45,y:plant.position.y};
      const a={x:p.x+side*24,y:p.y+18},b={x:p.x+side*29,y:p.y-18};
      if([p,a,b].every(pos => base.canOccupy(pos.x,pos.y,CONFIG.playerRadius) &&
          base.lineOfSight(pos,plant.position)) &&
          base.lineOfSight(a,p) && base.lineOfSight(b,p)) {
        source=plant;places={p,a,b};break;
      }
    }
    if(source)break;
  }
  assert.ok(source,'The declared fixed world has a suitable real point scene');
  ecology.plants=[source];ecology.animals=[];ecology.materials=[];ecology.aquatic=null;
  state.player={...places.p};
  for(const [actor,position] of state.agents.map((actor,i)=>[actor,i?places.b:places.a])) {
    actor.position={...position};bindOzarkWorldAgent(actor,geometry,state);
  }
  const lessons=[];
  const sensor={captureVisible(npc,world,id) {
    assert.equal(world,state);assert.equal(id,source.id);
    return currentCrop?{at:npc.elapsed,epoch:npc.epoch,
      pixels:Array(768).fill(127),features:Array(48).fill(npc.id==='aster'?.2:.8)}:null;
  }};
  const controller=createPlayerLessonController({state,geometry,pixelSensor:sensor,
    getLineage:()=>state.worldLineage,onLessons:rows=>{
      if(failDelivery)throw new Error('simulated bank rejection');
      lessons.push(rows);
    }});
  function tick() {
    state.elapsed+=CONFIG.fixedStep;
    ecology.elapsed=state.environment.elapsed=state.elapsed;
    for(const actor of state.agents)actor.elapsed=state.elapsed;
    return controller.tickPaid(CONFIG.fixedStep) || controller.observePaidStep();
  }
  function finish() {
    for(let i=0;i<200;i++){const result=tick();if(result)return result;}
    assert.fail('The fixed physical point must finish or interrupt');
  }
  return {state,ecology,source,geometry,controller,lessons,tick,finish,
    blockObserver:value=>{blockedObserver=value;},crop:value=>{currentCrop=value;},
    dispose:()=>controller.dispose()};
}

test('player point pays actual effort and credits only continuous own-view recipients once',()=>{
  const f=fixture();
  try{
    const energy=f.state.playerFood.physiology.availableEnergyKcal;
    const ledger=f.state.playerFood.physiology.totals.metabolizedKcal;
    const offered=f.controller.visibleOptions();
    assert.deepEqual(Object.keys(offered[0]).sort(),['appearance','distance','targetId']);
    assert.equal(offered[0].targetId,f.source.id);
    offered[0].appearance.color='fake';
    assert.notEqual(f.controller.visibleOptions()[0].appearance.color,'fake');
    assert.equal(f.controller.start('apple',f.source.id).code,'ACTION_STARTED');
    assert.equal(f.controller.start('apple',f.source.id).code,'ACTION_BUSY');
    f.state.elapsed+=CONFIG.fixedStep;
    for(const actor of f.state.agents)actor.elapsed=f.state.elapsed;
    assert.equal(f.controller.tickPaid(CONFIG.fixedStep),null);
    const pose=f.controller.publicPose();
    assert.ok(pose && close(Math.hypot(pose.tip.x-pose.origin.x,
      pose.tip.y-pose.origin.y),24));
    assert.equal(pose.scene,'valley');
    assert.equal(f.controller.observePaidStep(),null);
    assert.equal(f.controller.observePaidStep(),null,'A paid interval is consumed once');
    const result=f.finish();
    assert.deepEqual({ok:result.ok,code:result.code,word:result.word,
      recipients:result.recipients,censored:result.censored},
    {ok:true,code:'POINT_COMPLETED',word:'apple',recipients:2,censored:0});
    assert.ok(close(result.durationSeconds,PLAYER_LESSON_ACTION.seconds));
    assert.ok(close(result.paidKcal,npcEffortCost(1.8,.25)));
    assert.ok(close(energy-f.state.playerFood.physiology.availableEnergyKcal,result.paidKcal));
    assert.ok(close(f.state.playerFood.physiology.totals.metabolizedKcal-ledger,result.paidKcal));
    assert.equal(f.lessons.length,1);
    assert.deepEqual(f.lessons[0].map(row=>Object.keys(row).sort()),[
      ['agentId','features','serial','word'],['agentId','features','serial','word']]);
    assert.deepEqual(f.lessons[0].map(row=>row.agentId),['aster','mira']);
    assert.deepEqual(f.lessons[0].map(row=>row.word),['apple','apple']);
    assert.equal(f.controller.publicPose(),null);
    assert.equal(f.controller.observePaidStep(),null);
    assert.equal(f.controller.cancel(),null);
    assert.equal(f.lessons.length,1);
  }finally{f.dispose();}
});

test('occlusion, ambiguous local referents and no fresh crop never create a lesson',()=>{
  for(const mode of ['occluded','ambiguous','no-crop']){
    const f=fixture();
    try{
      assert.equal(f.controller.start('tree',f.source.id).ok,true);
      if(mode==='occluded')f.blockObserver(true);
      if(mode==='ambiguous')f.ecology.plants.push({...f.source,id:'object:999999',
        position:{x:f.source.position.x+(f.source.position.x-f.state.player.x)*.6,
          y:f.source.position.y+(f.source.position.y-f.state.player.y)*.6}});
      if(mode==='no-crop')f.crop(false);
      const result=f.finish();
      assert.equal(result.ok,true,mode);
      assert.equal(result.recipients,0,mode);
      assert.equal(result.censored,2,mode);
      assert.equal(f.lessons.length,0,mode);
    }finally{f.dispose();}
  }
});

test('invalid input, target movement, avatar movement, cancellation and stale callbacks fail closed',()=>{
  const f=fixture();
  try{
    const energy=f.state.playerFood.physiology.availableEnergyKcal;
    const ledger=f.state.playerFood.physiology.totals.metabolizedKcal;
    let coerced=false;
    const hostile={toString(){coerced=true;throw new Error('coercion');}};
    for(const word of ['', 'APPLE', 'apples!', 'toolong', 'a b', 'é',
      null, true, false, new String('tree'), Symbol('tree'), hostile])
      assert.equal(f.controller.start(word,f.source.id).code,'INVALID_WORD');
    assert.equal(coerced,false,'Invalid input cannot run caller coercion');
    assert.equal(f.controller.snapshot().active,null);
    assert.equal(f.state.playerFood.physiology.availableEnergyKcal,energy);
    assert.equal(f.state.playerFood.physiology.totals.metabolizedKcal,ledger);
    assert.equal(f.controller.start('tree','object:invalid').code,'INVALID_TARGET');
    assert.equal(f.controller.start('tree',f.source.id).ok,true);
    f.tick();
    const paid=f.controller.snapshot().active.worked;
    assert.ok(paid>0);
    const stopped=f.controller.cancel();
    assert.equal(stopped.code,'ACTION_INTERRUPTED');
    assert.ok(close(stopped.durationSeconds,paid));
    assert.equal(f.controller.cancel(),null);
    assert.equal(f.controller.observePaidStep(),null);
    assert.equal(f.lessons.length,0);
    assert.equal(f.controller.start('tree',f.source.id).ok,true);
    f.source.position.x+=1;
    assert.equal(f.tick().code,'TARGET_CHANGED');
    f.source.position.x-=1;
    assert.equal(f.controller.start('tree',f.source.id).ok,true);
    f.ecology.plants[0]={...f.source,position:{...f.source.position}};
    assert.equal(f.tick().code,'TARGET_CHANGED',
      'A same-ID replacement cannot inherit the selected object');
    f.ecology.plants[0]=f.source;
    assert.equal(f.controller.start('tree',f.source.id).ok,true);
    const originalPlayer=f.state.player;
    f.state.player={...originalPlayer};
    assert.equal(f.tick().code,'ACTION_INTERRUPTED',
      'A copied player position cannot resume action authority');
    f.state.player=originalPlayer;
    assert.equal(f.controller.start('tree',f.source.id).ok,true);
    f.state.player.x+=1;
    assert.equal(f.tick().code,'ACTION_INTERRUPTED');
    assert.equal(f.lessons.length,0);
  }finally{f.dispose();}
});

test('missing observation, recipient replacement and changed lineage cannot authorize a label',()=>{
  const f=fixture();
  try{
    assert.equal(f.controller.start('tree',f.source.id).ok,true);
    f.state.elapsed+=CONFIG.fixedStep;
    for(const actor of f.state.agents)actor.elapsed=f.state.elapsed;
    assert.equal(f.controller.tickPaid(CONFIG.fixedStep),null);
    f.state.elapsed+=CONFIG.fixedStep;
    assert.equal(f.controller.tickPaid(CONFIG.fixedStep).code,'OBSERVATION_MISSING');
    assert.equal(f.controller.start('tree',f.source.id).ok,true);
    f.state.agents[0].epoch++;
    const seen=f.finish();
    assert.equal(seen.ok,true);
    assert.equal(seen.recipients,1);
    assert.deepEqual(f.lessons[0].map(row=>row.agentId),['mira']);
    assert.equal(f.controller.start('tree',f.source.id).ok,true);
    f.state.worldLineage.agents[1].serial++;
    assert.equal(f.finish().code,'LINEAGE_CHANGED');
    assert.equal(f.lessons.length,1);
  }finally{f.dispose();}
});

test('a delayed first paid sample cannot backfill unseen time',()=>{
  const f=fixture();
  try{
    assert.equal(f.controller.start('tree',f.source.id).ok,true);
    f.state.elapsed+=CONFIG.fixedStep*2;
    f.ecology.elapsed=f.state.environment.elapsed=f.state.elapsed;
    for(const actor of f.state.agents)actor.elapsed=f.state.elapsed;
    assert.equal(f.controller.tickPaid(CONFIG.fixedStep),null);
    assert.equal(f.controller.observePaidStep(),null);
    const result=f.finish();
    assert.equal(result.ok,true);
    assert.equal(result.recipients,0);
    assert.equal(result.censored,2);
    assert.equal(f.lessons.length,0);
  }finally{f.dispose();}
});

test('one coarse paid callback cannot stand in for continuous fixed-step sight',()=>{
  const f=fixture();
  try{
    assert.equal(f.controller.start('tree',f.source.id).ok,true);
    f.state.elapsed+=CONFIG.fixedStep*2;
    f.ecology.elapsed=f.state.environment.elapsed=f.state.elapsed;
    for(const actor of f.state.agents)actor.elapsed=f.state.elapsed;
    assert.equal(f.controller.tickPaid(CONFIG.fixedStep*2),null);
    assert.equal(f.controller.observePaidStep(),null);
    const result=f.finish();
    assert.equal(result.ok,true);
    assert.equal(result.recipients,0);
    assert.equal(f.lessons.length,0);
  }finally{f.dispose();}
});

test('an individual replacement cannot inherit that individual\'s unfinished lesson',()=>{
  const f=fixture();
  try{
    assert.equal(f.controller.start('tree',f.source.id).ok,true);
    f.tick();
    f.state.agents[0]={...f.state.agents[0],position:{...f.state.agents[0].position}};
    const result=f.finish();
    assert.equal(result.ok,true);
    assert.equal(result.recipients,1);
    assert.equal(result.censored,1);
    assert.deepEqual(f.lessons[0].map(row=>row.agentId),['mira']);
  }finally{f.dispose();}
});

test('bank rejection is reported after physical completion and never retried',()=>{
  const f=fixture({failDelivery:true});
  try{
    assert.equal(f.controller.start('tree',f.source.id).ok,true);
    const result=f.finish();
    assert.equal(result.ok,true,'The physical point was paid despite bank rejection');
    assert.equal(result.code,'POINT_COMPLETED_LESSON_REJECTED');
    assert.equal(result.recipients,0);
    assert.equal(result.censored,2);
    assert.equal(f.controller.observePaidStep(),null);
    assert.equal(f.lessons.length,0);
  }finally{f.dispose();}
});

test('disposal and non-awake recipients leave no authority or lesson',()=>{
  const f=fixture();
  f.state.agents[0].lifecycle='COLLAPSED';
  assert.equal(f.controller.start('tree',f.source.id).ok,true);
  const result=f.finish();
  assert.equal(result.recipients,1);
  assert.deepEqual(f.lessons[0].map(row=>row.agentId),['mira']);
  assert.equal(f.controller.start('tree',f.source.id).ok,true);
  f.dispose();
  assert.equal(f.controller.publicPose(),null);
  assert.equal(f.controller.tickPaid(CONFIG.fixedStep),null);
  assert.equal(f.controller.start('tree',f.source.id).ok,false);
});
