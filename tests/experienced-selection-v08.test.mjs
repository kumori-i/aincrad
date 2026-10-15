import test from 'node:test';
import assert from 'node:assert/strict';
import {createSelectionMemory,recordSelectionWork,validateSelectionMemory,experiencedConsequences,selectionScores,chooseSelection,configureSelection,selectionPolicy,selectionUpdates} from '../src/discovery-selection.js';
import {createNpc} from '../src/npc-state.js';
import {validateNpc,recordEvent} from '../src/npc-memory.js';
const candidate=(type,id='object:900')=>({action:{type,targetId:id}});
function work(model,id,type,seconds,exertion='light',fatigue='fresh'){
  const action={type,targetId:'object:1'},result={ok:true,code:'OBJECT_OBSERVED',durationSeconds:seconds,exertion,exertionContext:fatigue},event={id,at:id*10,type:'action',details:{action,result}};
  return {model:recordSelectionWork(model,action,result,event),event};
}
function trained(reverse=false){let m=createSelectionMemory();for(let i=1;i<=4;i++){work(m,i,'strike',reverse?1:8,reverse?'light':'strenuous');work(m,i+4,'inspect_object',reverse?8:1,reverse?'strenuous':'light');}return m;}
const chain=()=>({experiments:[{id:1,actionId:11,at:1,primitive:'pull',targetId:'object:1',materialId:'object:2',ok:true},{id:2,actionId:12,at:2,primitive:'sample',targetId:'object:2',ingestionId:'ingestion:1',ok:true},{id:3,actionId:13,at:3,primitive:'sample',targetId:'object:2',ingestionId:'ingestion:2',ok:true}],effects:[{objectId:'object:2',actionId:12,ingestionId:'ingestion:1',at:20,effect:'sustained'},{objectId:'object:2',actionId:13,ingestionId:'ingestion:2',at:21,effect:'sustained'}]});

test('experienced costs transfer to unseen opaque IDs and reverse with actual work, not operation names',()=>{
  const options=[candidate('inspect_object'),candidate('strike')];
  assert.equal(chooseSelection(trained(),options,{},()=>0).action.type,'inspect_object');
  assert.equal(chooseSelection(trained(true),options,{},()=>0).action.type,'strike');
  assert.equal(selectionScores(trained(),[candidate('sample')])[0].selection.benefit,0);
});
test('sparse fatigue context backs off, then four observations support context-specific cost',()=>{
  const m=trained();for(let i=20;i<23;i++)work(m,i,'strike',1,'light','tired');
  assert.ok(selectionScores(m,[candidate('strike')],{fatigue:'tired'})[0].selection.seconds>1);
  work(m,23,'strike',1,'light','tired');assert.equal(selectionScores(m,[candidate('strike')],{fatigue:'tired'})[0].selection.seconds,1);
});
test('exact delayed effects deduplicate sample/channel and acquisition association without a global reward',()=>{
  const {experiments,effects}=chain();effects.push({...effects[0]},{...effects[0],effect:'water relief'},{...effects[0],effect:'discomfort'});
  const c=experiencedConsequences(experiments,effects);
  assert.deepEqual(c['object:2|sample'],{attempts:2,food:2,water:1,harm:1});
  assert.deepEqual(c['object:1|pull'],{attempts:1,food:1,water:1,harm:1});
  assert.equal(c['object:999|sample'],undefined);
  const cold=experiencedConsequences(experiments,effects,{foodLearning:false});assert.equal(cold['object:2|sample'].food,0);assert.equal(cold['object:2|sample'].harm,1);
});
test('unmatched IDs, pre-action effects, ambient comfort and accepted no-change do not confer utility',()=>{
  const {experiments,effects}=chain();const bad=[{...effects[0],objectId:'object:9'},{...effects[0],actionId:99},{...effects[0],ingestionId:'ingestion:9'},{...effects[0],at:0},{...effects[0],effect:'comfortable'}];
  experiments.push({id:4,actionId:14,primitive:'strike',targetId:'object:1',ok:true,code:'OBJECT_STRUCK'});
  const c=experiencedConsequences(experiments,bad);for(const v of Object.values(c))assert.equal(v.food+v.water+v.harm,0);
});
test('need weights gate nourishment but never erase harm; source and same-looking new item remain distinct',()=>{
  const {experiments,effects}=chain();effects.push({...effects[0],effect:'discomfort'});const consequences=experiencedConsequences(experiments,effects),m=createSelectionMemory();
  const hungry=selectionScores(m,[candidate('sample','object:2'),candidate('sample','object:3')],{hunger:'hungry',consequences});assert.equal(hungry[0].selection.benefit,0);assert.equal(hungry[1].selection.benefit,0);
  assert.equal(selectionScores(m,[candidate('sample','object:2')],{consequences})[0].selection.benefit,-1);
});
test('one in eight eligible opportunities retains delayed-payoff operations even after costly observations',()=>{
  const m=trained(),options=[candidate('inspect_object'),candidate('strike')];const picks=Array.from({length:16},()=>chooseSelection(m,options,{},()=>.999).action.type);
  assert.equal(picks[7],'strike');assert.equal(picks[15],'strike');assert.equal(picks.filter(x=>x==='strike').length,2);
  m.choices=1e9;m.phase=7;assert.equal(chooseSelection(m,options,{},()=>.999).action.type,'strike');assert.equal(chooseSelection(m,options,{},()=>.999).action.type,'inspect_object');
});
test('save estimates are reconstructed from exact action proof, never trusted saved means',()=>{
  const m=createSelectionMemory(),{event}=work(m,1,'strike',3,'moderate');m.values.strike.seconds=1e8;
  const restored=validateSelectionMemory(m,[event]);assert.equal(restored.values.strike.seconds,3);assert.deepEqual(validateSelectionMemory(restored,[event]),restored);
  for(const change of [{durationSeconds:2},{exertion:'light'},{fatigue:'tired'},{at:0},{actionId:2},{targetId:'object:2'},{operation:'pull'}]){
    const raw=structuredClone(m);Object.assign(raw.records[0],change);assert.equal(validateSelectionMemory(raw,[event]).records.length,0);
  }
  assert.equal(validateSelectionMemory(m,[]).records.length,0);
});
test('old, malformed, duplicate and zero-valued metadata restore conservatively and stay bounded',()=>{
  for(const raw of [null,{},[],{version:2},{version:1,records:{},choices:NaN,phase:9}])assert.deepEqual(validateSelectionMemory(raw),createSelectionMemory());
  const m=createSelectionMemory(),events=[];for(let i=1;i<=110;i++)events.push(work(m,i,'inspect_object',1).event);assert.equal(m.records.length,96);
  m.records.push(m.records.at(-1));m.choices=0;m.phase=0;const restored=validateSelectionMemory(m,events);assert.equal(restored.choices,0);assert.equal(restored.phase,0);assert.equal(new Set(restored.records.map(r=>r.actionId)).size,restored.records.length);
  assert.equal(recordSelectionWork({version:1,records:null},{},{},{id:0}).records.length,0);
});
test('runtime controls leave perception and saved experience untouched, freeze estimates, and cannot be enabled by a save',()=>{
  const n=createNpc({mode:'discovery'});n.discovery.selection=trained();const {experiments,effects}=chain();n.discovery.experiments=experiments;n.discovery.effects=effects;
  n.elapsed=30;const before=JSON.stringify(n.discovery);configureSelection(n,'frozen');const frozen=selectionPolicy(n,{});work(n.discovery.selection,30,'strike',.2);assert.equal(frozen.model.values.strike.count,4);assert.equal(selectionUpdates(n),false);
  configureSelection(n,'cold');assert.deepEqual(selectionPolicy(n,{}).model.records,[]);assert.deepEqual(selectionPolicy(n,{}).consequences,{});
  configureSelection(n,'shuffled');assert.equal(selectionPolicy(n,{}).model.values.inspect_object.count,5);assert.equal(n.discovery.selection.values.strike.count,5);
  configureSelection(n,'learned');assert.equal(selectionUpdates(n),true);assert.equal(selectionPolicy(n,{}).model,n.discovery.selection);
  configureSelection(n,'baseline');assert.equal(selectionPolicy(n,{}),null);assert.ok(before.includes('records'));
  const restored=validateNpc(JSON.parse(JSON.stringify(n)));assert.equal(selectionPolicy(restored,{}),null);
});
test('food association ablation suppresses frozen and shuffled positive values but retains negative feedback',()=>{
  const n=createNpc({mode:'discovery'}),{experiments,effects}=chain();effects.push({...effects[0],effect:'discomfort'});n.discovery.experiments=experiments;n.discovery.effects=effects;
  n.elapsed=30;for(const mode of ['frozen','shuffled']){configureSelection(n,mode,{foodLearning:false});const c=selectionPolicy(n,{}).consequences;assert.equal(Object.values(c).reduce((s,r)=>s+r.food+r.water,0),0);assert.ok(Object.values(c).some(r=>r.harm));}
});
test('worked-action evidence remains available through unrelated event rotation and reopen',()=>{
  const n=createNpc({mode:'discovery'});n.discovery.selection=createSelectionMemory();const action={type:'strike',targetId:'object:1'},result={ok:true,code:'OBJECT_STRUCK',durationSeconds:3,exertion:'moderate',exertionContext:'fresh'};
  const event=recordEvent(n,'action',{action,result});recordSelectionWork(n.discovery.selection,action,result,event);
  for(let i=0;i<450;i++)recordEvent(n,'decision',{summary:'Unrelated bounded choice'});
  assert.ok(n.memory.experience.some(e=>e.id===event.id));const restored=validateNpc(JSON.parse(JSON.stringify(n)));assert.deepEqual(restored.discovery.selection,n.discovery.selection);
});
test('matching future-dated work proof is rejected and zero RNG survives reopen',()=>{
  const m=createSelectionMemory(),{event}=work(m,1,'strike',3);assert.equal(validateSelectionMemory(m,[event],event.at-1).records.length,0);
  const restored=validateSelectionMemory(m,[event],event.at);assert.equal(restored.rng,0);assert.equal(restored.choices,0);
});
test('selector uses its saved stream with fixed draws and never consumes actor/navigation RNG',()=>{
  const n=createNpc({mode:'discovery'});n.discovery.selection=trained();const before=n.rng;configureSelection(n,'learned');const m=selectionPolicy(n,{}).model;
  const a=structuredClone(m),b=structuredClone(m);a.phase=0;b.phase=7;chooseSelection(a,[candidate('strike'),candidate('inspect_object')],{});chooseSelection(b,[candidate('strike'),candidate('inspect_object')],{});
  assert.equal(a.rng,b.rng);assert.equal(n.rng,before);assert.notEqual(a.rng,0);
  const resumed=validateSelectionMemory(a,[]);assert.equal(resumed.rng,a.rng);
});
test('unconfigured and baseline actors do not collect or protect new selector work',()=>{
  const n=createNpc({mode:'discovery'});assert.equal(selectionUpdates(n),false);configureSelection(n,'baseline');assert.equal(selectionUpdates(n),false);assert.equal(n.discovery.selection,undefined);
});
test('turning positive food learning off after a frozen checkpoint cannot reuse captured positive utility',()=>{
  const n=createNpc({mode:'discovery'}),{experiments,effects}=chain();n.discovery.experiments=experiments;n.discovery.effects=effects;n.elapsed=30;configureSelection(n,'frozen');
  assert.ok(Object.values(selectionPolicy(n,{}).consequences).some(r=>r.food));
  assert.equal(Object.values(selectionPolicy(n,{}, {foodLearning:false}).consequences).reduce((s,r)=>s+r.food+r.water,0),0);
});
test('real completed failed work trains the model, zero-work failure does not, and actual save proof survives',async()=>{
  const {createEnvironment}=await import('../src/environment.js'),{observeNpc,requestNpcAction,tickNpc}=await import('../src/npc.js'),{canStand}=await import('../src/world.js');
  const n=createNpc({mode:'discovery',seed:74193}),e=createEnvironment(74193,{mode:'discovery'}),plant=e.ecology.plants.find(p=>p.kind==='apple_tree');
  n.position=[{x:plant.position.x+45,y:plant.position.y},{x:plant.position.x-45,y:plant.position.y}].find(p=>canStand(p.x,p.y,'valley'));observeNpc(n,e);configureSelection(n,'learned');
  assert.equal(requestNpcAction(n,{type:'grasp',targetId:plant.id},e).code,'ACTION_STARTED');for(let i=0;i<300&&n.active;i++)tickNpc(n,1/60,e);
  assert.equal(n.lastResult.ok,false);assert.equal(n.discovery.selection.values.grasp.count,1);assert.ok(Math.abs(n.discovery.selection.values.grasp.seconds-2.5)<1e-12);assert.equal(n.discovery.practice.grasp.seconds,0);
  const before=structuredClone(n.discovery.selection);assert.equal(requestNpcAction(n,{type:'sample',targetId:plant.id},e).code,'NOT_HELD');assert.deepEqual(n.discovery.selection,before);
  const saved=validateNpc(JSON.parse(JSON.stringify(n)));assert.deepEqual(saved.discovery.selection,before);assert.deepEqual(saved.physiology,n.physiology);
});
test('future action, effect and acquisition records cannot become present utility in learned or frozen controls',()=>{
  const {experiments,effects}=chain();assert.deepEqual(experiencedConsequences(experiments,effects,{elapsed:0}),{});
  assert.equal(experiencedConsequences(experiments,effects,{elapsed:10})['object:2|sample'].food,0);
  const changed=structuredClone(experiments);changed[0].at=25;const c=experiencedConsequences(changed,effects,{elapsed:30});assert.equal(c['object:1|pull'].food,0);assert.equal(c['object:2|sample'].food,2);
  for(const mode of ['frozen','shuffled']){const n=createNpc({mode:'discovery'});n.elapsed=1;n.discovery.experiments=experiments;n.discovery.effects=effects;configureSelection(n,mode);assert.equal(Object.values(selectionPolicy(n,{}).consequences).reduce((s,r)=>s+r.food+r.water+r.harm,0),0);}
});
test('duplicated ingestion identity across different saved action IDs cannot multiply a consequence channel',()=>{
  const {experiments,effects}=chain();experiments[2].ingestionId='ingestion:1';effects[1].ingestionId='ingestion:1';effects.push({...effects[1],effect:'water relief'},{...effects[1],effect:'discomfort'});
  const c=experiencedConsequences(experiments,effects);assert.deepEqual(c['object:2|sample'],{attempts:2,food:1,water:1,harm:1});assert.deepEqual(c['object:1|pull'],{attempts:1,food:1,water:1,harm:1});
  experiments[2].targetId='object:3';effects[1].objectId='object:3';const other=experiencedConsequences(experiments,effects);assert.equal(Object.entries(other).filter(([k])=>k.endsWith('|sample')).reduce((s,[,r])=>s+r.food,0),1);
});
test('real second-piece transfer reuses motor experience but supplies no food belief from identical appearance',async()=>{
  const {createEnvironment,tickEnvironment}=await import('../src/environment.js'),{observeNpc,requestNpcAction,tickNpc}=await import('../src/npc.js'),{canStand}=await import('../src/world.js'),{processDiscoveryFeedback}=await import('../src/discovery.js'),{tickEcology}=await import('../src/ecology.js');
  const n=createNpc({mode:'discovery',seed:74193}),e=createEnvironment(74193,{mode:'discovery'}),plant=e.ecology.plants.find(p=>p.kind==='apple_tree');
  n.position=[{x:plant.position.x+45,y:plant.position.y},{x:plant.position.x-45,y:plant.position.y}].find(p=>canStand(p.x,p.y,'valley'));observeNpc(n,e);configureSelection(n,'learned');
  const tick=()=>{tickEnvironment(e,1/60);tickEcology(e.ecology,1/60,e,[n]);tickNpc(n,1/60,e);processDiscoveryFeedback(n);};
  const act=action=>{assert.equal(requestNpcAction(n,action,e).code,'ACTION_STARTED');for(let i=0;i<1000&&n.active;i++)tick();assert.equal(n.lastResult.ok,true);};
  act({type:'pull',targetId:plant.id});const first=n.inventory.items[0],appearance=structuredClone(n.discovery.observations[first].appearance);act({type:'sample',targetId:first});
  for(let i=0;i<9000&&!n.discovery.effects.some(x=>x.objectId===first&&x.effect==='sustained');i++)tick();assert.ok(n.discovery.effects.some(x=>x.objectId===first&&x.effect==='sustained'));
  act({type:'release',targetId:first});act({type:'pull',targetId:plant.id});const second=n.inventory.items[0];assert.notEqual(first,second);assert.deepEqual(n.discovery.observations[second].appearance,appearance);
  const consequences=experiencedConsequences(n.discovery.experiments,n.discovery.effects,{elapsed:n.elapsed});assert.equal(consequences[`${first}|sample`].food,1);assert.equal(consequences[`${second}|sample`],undefined);
  const score=selectionScores(n.discovery.selection,[candidate('sample',second)],{hunger:'hungry',consequences})[0];assert.equal(score.selection.benefit,0);assert.ok(score.selection.seconds>0);assert.equal(score.selection.seconds,n.discovery.selection.values.sample.seconds/n.discovery.selection.values.sample.count);
});
test('restore permanently discards future proof so advancing and reopening cannot resurrect utility',()=>{
  const n=createNpc({mode:'discovery'});n.elapsed=20;const action={type:'sample',targetId:'object:1'},result={ok:true,code:'SWALLOWED',ingestionId:'ingestion:1',durationSeconds:3};const event=recordEvent(n,'action',{action,result});
  const effect={id:'feedback:fixture',at:30,objectId:'object:1',actionId:event.id,ingestionId:'ingestion:1',effect:'sustained',source:'experienced'};n.elapsed=30;const proof=recordEvent(n,'condition',{code:'DISCOVERY_EFFECT',feedback:effect});effect.proofEventId=proof.id;
  n.discovery.experiments=[{id:1,at:20,primitive:'sample',targetId:'object:1',ok:true,code:'SWALLOWED',durationSeconds:3,actionId:event.id,ingestionId:'ingestion:1'}];n.discovery.effects=[effect];n.elapsed=10;
  let restored=validateNpc(JSON.parse(JSON.stringify(n)));assert.equal(restored.discovery.experiments.length,0);assert.equal(restored.discovery.effects.length,0);restored.elapsed=40;restored=validateNpc(JSON.parse(JSON.stringify(restored)));
  for(const mode of ['learned','frozen','shuffled']){configureSelection(restored,mode);const consequences=experiencedConsequences(restored.discovery.experiments,restored.discovery.effects,{elapsed:restored.elapsed});assert.deepEqual(selectionPolicy(restored,consequences).consequences,{});}
  // A past valid sample does not legitimize a future effect either.
  n.elapsed=25;restored=validateNpc(JSON.parse(JSON.stringify(n)));assert.equal(restored.discovery.experiments.length,1);assert.equal(restored.discovery.effects.length,0);restored.elapsed=40;assert.equal(validateNpc(JSON.parse(JSON.stringify(restored))).discovery.effects.length,0);
});
test('future already-experienced physiology feedback cannot re-enter discovery after restoration',async()=>{
  const {processDiscoveryFeedback}=await import('../src/discovery.js');const n=createNpc({mode:'discovery'});n.elapsed=20;
  const action={type:'sample',targetId:'object:1'},result={ok:true,code:'SWALLOWED',ingestionId:'ingestion:1',durationSeconds:3},event=recordEvent(n,'action',{action,result});
  n.discovery.experiments=[{id:1,at:20,primitive:'sample',targetId:'object:1',ok:true,code:'SWALLOWED',durationSeconds:3,actionId:event.id,ingestionId:'ingestion:1'}];n.elapsed=25;
  n.physiology.feedback=[{id:'feedback:bad',at:30,objectId:'object:1',actionId:event.id,ingestionId:'ingestion:1',effect:'sustained',provenance:'sampled'}];const physical=structuredClone(n.physiology);physical.feedback=[];
  let restored=validateNpc(JSON.parse(JSON.stringify(n)));assert.deepEqual(restored.physiology,physical);processDiscoveryFeedback(restored);assert.equal(restored.discovery.effects.length,0);restored.elapsed=40;processDiscoveryFeedback(restored);restored=validateNpc(JSON.parse(JSON.stringify(restored)));assert.equal(restored.discovery.effects.length,0);assert.equal(restored.physiology.feedback.length,0);
  for(const mode of ['learned','frozen']){configureSelection(restored,mode);const c=experiencedConsequences(restored.discovery.experiments,restored.discovery.effects,{elapsed:restored.elapsed});assert.equal(Object.values(selectionPolicy(restored,c).consequences).reduce((s,v)=>s+v.food,0),0);}
});
