import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { createOzarkState, writeOzarkSave, loadOzarkSave, OZARK_SAVE_KEY } from '../src/ozark-save.js';
import { bindOzarkWorldAgent } from '../src/ozark-agent-world.js';
import { observeNpc, requestNpcAction, tickNpc } from '../src/npc.js';
import { tickEnvironment } from '../src/environment.js';
import { lookupEcologyObject } from '../src/ecology.js';
import { PopulationRuntime } from '../src/population.js';
import { discoveryDecision, processDiscoveryFeedback } from '../src/discovery.js';
import { experiencedFoodSourceCaution } from '../src/food-source-caution.js';
import { projectPhysiology } from '../src/biology.js';
import { receivedMaterialCaution } from '../src/food-warning.js';
import { validateDiscoveryMemory } from '../src/discovery-state.js';

const geometry=createOzarkWorldGeometry();
// Deterministic physical-capability fixture, not an autonomous survival trial.
// Encounter placement and (for harm) a spoiled finite item are supplied. All
// extraction, ingestion, action receipts and bodily feedback are genuinely paid.
function fixture({spoiled=false,communicationMode='grounded'}={}){
 const state=createOzarkState(geometry),[a,b]=state.agents,e=state.environment;
 const source=e.ecology.plants.find(p=>p.kind==='apple_tree'&&p.quantity>2&&geometry.canOccupy(p.position.x+45,p.position.y,CONFIG.playerRadius));
 assert.ok(source);state.elapsed=e.elapsed=e.ecology.elapsed=60;
 for(const npc of state.agents){npc.elapsed=60;npc.position={x:source.position.x+45,y:source.position.y};bindOzarkWorldAgent(npc,geometry,state);observeNpc(npc,e);}
 const runtime=new PopulationRuntime(state,{cardinal:false,...(communicationMode==='legacy'?{communicationMode}:{})});assert.equal(runtime.communicationMode,communicationMode);
 function advance(seconds){for(let t=0;t<seconds-1e-8;t+=.1){tickEnvironment(e,.1);state.elapsed=e.elapsed;e.ecology.elapsed=e.elapsed;for(const npc of state.agents){tickNpc(npc,.1,e);processDiscoveryFeedback(npc);}}}
 function finish(npc,action){const started=requestNpcAction(npc,action,e);assert.equal(started.code,'ACTION_STARTED');for(let i=0;npc.active&&i<400;i++)advance(.1);assert.equal(npc.active,null);assert.equal(npc.lastResult.ok,true);return npc.lastResult;}
 const acquired=finish(a,{type:'pull',targetId:source.id}),item=acquired.materialId;
 assert.ok(item);if(spoiled){const material=lookupEcologyObject(e.ecology,item);material.spoiled=true;material.ageHours=12*24;}
 finish(a,{type:'sample',targetId:item});advance(100);
 return {state,a,b,e,source,item,runtime,advance,finish};
}
function noPeerReports(f,effect){
 assert.equal(f.runtime.social.action(f.a,{type:'say',targetId:f.b.id,text:'claim',effectId:effect.id,offline:true}).code,'LEGACY_LANGUAGE_DISABLED');
 f.runtime.social.tick(.1);f.runtime.social.observe(f.b);
 assert.deepEqual(f.state.community.messages,[]);assert.deepEqual(f.b.discovery.reports,[]);
 assert.deepEqual(f.b.discovery.effects,[]);assert.deepEqual(f.b.discovery.techniques,[]);
}

test('grounded default retains own adverse exact-material and exact-source avoidance without peer warning transmission',()=>{
 const f=fixture({spoiled:true});try{
   const effect=f.a.discovery.effects.find(row=>row.objectId===f.item&&row.effect==='discomfort');assert.ok(effect);
   assert.equal(experiencedFoodSourceCaution(f.a,f.item),true);
   const next=f.finish(f.a,{type:'pull',targetId:f.source.id}).materialId;assert.notEqual(next,f.item);
   assert.equal(experiencedFoodSourceCaution(f.a,next),true,'new finite piece from own harmful acquisition source remains cautious');
   observeNpc(f.a,f.e);
   const decision=discoveryDecision(f.a,{foodLearning:false,handlingCuriosity:false,chooseOptional:choices=>{
     assert.equal(choices.some(row=>row.action.type==='sample'&&[f.item,next].includes(row.action.targetId)),false);
     return 0;
   }});
   assert.equal(decision.action.type==='sample'&&[f.item,next].includes(decision.action.targetId),false);
   noPeerReports(f,effect);
 }finally{f.runtime.dispose();}
});

test('grounded default retains personally earned extraction-and-sampling technique and uses its own relief',()=>{
 const f=fixture();try{
   const proof=validateDiscoveryMemory(f.a.discovery,f.a),effect=proof.effects.find(row=>row.objectId===f.item&&row.effect==='sustained');assert.ok(effect);
   const technique=proof.techniques.find(row=>row.sourceId===f.source.id);assert.ok(technique);
   assert.deepEqual(technique.steps.map(step=>step.type),['pull','sample']);
   // Supplied appetite isolates reuse; it does not supply the learned result.
   f.a.physiology.hoursSinceMeal=8;f.a.physiology.satietyHours=0;observeNpc(f.a,f.e);
   assert.deepEqual(discoveryDecision(f.a).action,{type:'sample',targetId:f.item});
   noPeerReports(f,effect);
   assert.ok(validateDiscoveryMemory(f.a.discovery,f.a).techniques.some(row=>row.id===technique.id));
 }finally{f.runtime.dispose();}
});


test('a genuinely delivered saved warning is inert in grounded decisions but remains effective in explicit legacy control',()=>{
 const f=fixture({spoiled:true,communicationMode:'legacy'}),runtimes=[];try{
   const effect=f.a.discovery.effects.find(row=>row.objectId===f.item&&row.effect==='discomfort');assert.ok(effect);
   const spoken=f.runtime.social.action(f.a,{type:'say',targetId:f.b.id,text:'placeholder',effectId:effect.id,offline:true});
   assert.equal(spoken.code,'SAID');assert.ok(spoken.message.warning);
   f.finish(f.a,{type:'release',targetId:f.item});observeNpc(f.b,f.e);
   f.finish(f.b,{type:'grasp',targetId:f.item});observeNpc(f.b,f.e);
   f.b.physiology.hoursSinceMeal=12;projectPhysiology(f.b);
   assert.ok(receivedMaterialCaution(f.b,f.item));
   const rows=new Map(),storage={getItem:key=>rows.get(key)??null,setItem:(key,value)=>rows.set(key,value)};
   assert.equal(writeOzarkSave(storage,f.state,geometry),true);
   const raw=storage.getItem(OZARK_SAVE_KEY);
   const branch=(communicationMode,removeReport=false)=>{
     const loaded=loadOzarkSave(storage,geometry);assert.equal(loaded.blocked,false,loaded.error);
     const state=loaded.state,actor=state.agents[1];
     const runtime=new PopulationRuntime(state,{cardinal:false,communicationMode});runtimes.push(runtime);
     const report=actor.discovery.reports.find(row=>row.warning);assert.ok(report,'valid archived warning survives restore');
     assert.deepEqual(report.warning,spoken.message.warning);
     if(removeReport)actor.discovery.reports=actor.discovery.reports.filter(row=>!row.warning);
     return {actor,decision:discoveryDecision(actor),caution:receivedMaterialCaution(actor,f.item)};
   };
   const legacy=branch('legacy'),grounded=branch('grounded'),without=branch('grounded',true);
   assert.ok(legacy.caution);assert.equal(grounded.caution,null);
   assert.notDeepEqual(legacy.decision.action,{type:'sample',targetId:f.item});
   assert.deepEqual(grounded.decision.action,{type:'sample',targetId:f.item},'physical witnessed-consumption opportunity remains; archived testimony cannot choose for the agent');
   assert.deepEqual(grounded.decision,without.decision,'removing valid archived caution has no effect in grounded mode');
   assert.deepEqual(grounded.actor.discovery.effects,[]);assert.deepEqual(grounded.actor.discovery.techniques,[]);
   assert.equal(storage.getItem(OZARK_SAVE_KEY),raw,'checking modes never rewrites the saved archive');
 }finally{for(const runtime of runtimes)runtime.dispose();f.runtime.dispose();}
});
