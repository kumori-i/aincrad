import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, CAVE_SPAWN } from '../src/config.js';
import { freshState as createWorldState, canStand } from '../src/world.js';
const freshState=()=>createWorldState({mode:'legacy'});
import { PopulationRuntime } from '../src/population.js';
import { validateSave, writeSave, loadSave } from '../src/save.js';
import { createNpc } from '../src/npc-state.js';
import { observeNpc, requestNpcAction, collapseNpc } from '../src/npc.js';
import { foodSource } from '../src/resources.js';
import { updateCognition } from '../src/cognition.js';

function storage(){const records=new Map();return {getItem:key=>records.get(key)??null,setItem:(key,value)=>records.set(key,value)};}
const waitingProvider=()=>({kind:'local-learner',decide:()=>({action:{type:'wait',seconds:5}})});
function step(runtime,seconds){const frames=Math.round(seconds*60);for(let frame=0;frame<frames;frame++){runtime.state.elapsed+=1/60;runtime.tick(1/60);}}

test('a new world has two independent characters and one historical Aster alias',()=>{
  const state=freshState();assert.equal(state.version,8);assert.deepEqual(state.agents.map(n=>n.id),['aster','mira']);assert.equal(state.npc,state.agents[0]);assert.equal(state.selectedAgentId,'aster');
  assert.notEqual(state.agents[0].position,state.agents[1].position);assert.notEqual(state.agents[0].memory,state.agents[1].memory);assert.notEqual(state.agents[0].inventory,state.agents[1].inventory);
  assert.notDeepEqual(state.agents[0].position,state.agents[1].position);
  for(const npc of state.agents)assert.ok(canStand(npc.position.x,npc.position.y,npc.scene));
  state.agents[0].memory.lessons.push({verified:'Aster alone'});assert.equal(state.agents[1].memory.lessons.length,0);
});

test('legacy v1 through v3 saves retain Aster progress and add fresh Mira',()=>{
  for(const version of [1,2,3]){
    const aster=createNpc(),environment=freshState().environment;observeNpc(aster,environment);const water=Object.values(aster.memory.sources).find(source=>Math.hypot(source.x-aster.position.x,source.y-aster.position.y)<=80);assert.ok(water);
    for(let cycle=0;cycle<2;cycle++){aster.hydration=25;assert.ok(requestNpcAction(aster,{type:'fill_flask',sourceId:water.id},environment).ok);assert.ok(requestNpcAction(aster,{type:'drink'},environment).ok);}
    assert.ok(aster.memory.skills.length);const acquired=aster.memory.skills.map(skill=>skill.id);aster.version=version;aster.scene='refuge';aster.position={...CAVE_SPAWN};aster.elapsed=321;aster.hydration=62;aster.stats.independentDrinks=7;aster.memory.lessons=[{at:320,verified:'The flask contains collected water.',hypothesis:'Another spring may exist.'}];
    const migrated=validateSave({version,npc:aster,elapsed:321});assert.equal(migrated.version,8);assert.equal(migrated.npc,migrated.agents[0]);assert.equal(migrated.npc.scene,'refuge');assert.deepEqual(migrated.npc.position,CAVE_SPAWN);assert.equal(migrated.npc.hydration,62);assert.equal(migrated.npc.stats.independentDrinks,7);assert.equal(migrated.npc.memory.lessons[0].verified,aster.memory.lessons[0].verified);
    assert.deepEqual(migrated.npc.memory.skills.map(skill=>skill.id),acquired);assert.equal(migrated.agents[1].id,'mira');assert.equal(migrated.agents[1].elapsed,321);assert.equal(migrated.agents[1].hydration,createNpc({id:'mira'}).hydration);assert.equal(migrated.agents[1].stats.independentDrinks,0);assert.equal(migrated.agents[1].memory.lessons.length,0);assert.equal(migrated.environment.elapsed,321);
  }
});

test('population saves preserve independent bodies, cave progress, selection, and shared resources',()=>{
  const state=freshState();state.elapsed=123;state.environment.elapsed=123;state.environment.foodStocks[0].stock=0;
  state.agents[0].nourishment=51;state.agents[1].nourishment=77;state.agents[1].scene='refuge';state.agents[1].position={...CAVE_SPAWN};state.agents[1].stats.independentMeals=4;state.selectedAgentId='mira';
  const store=storage();assert.ok(writeSave(store,state));const disk=JSON.parse(store.getItem(CONFIG.saveKey));assert.equal('npc' in disk,false);assert.equal(disk.agents.length,2);const saved=loadSave(store);assert.ok(saved.exists);assert.equal(saved.state.npc,saved.state.agents[0]);assert.equal(saved.state.agents[0].nourishment,51);assert.equal(saved.state.agents[1].nourishment,77);assert.equal(saved.state.agents[1].scene,'refuge');assert.equal(saved.state.agents[1].stats.independentMeals,4);assert.equal(saved.state.selectedAgentId,'mira');assert.equal(saved.state.environment.foodStocks[0].stock,0);
});

test('duplicate identities, unknown characters, and invalid selection are repaired without shared memory',()=>{
  const mira=createNpc({id:'mira'});mira.health=76;
  const state=validateSave({version:4,agents:[mira,{...mira,health:1},{...mira,id:'intruder'}],selectedAgentId:'intruder',unexpected:'discard'});
  assert.deepEqual(state.agents.map(n=>n.id),['aster','mira']);assert.equal(state.agents[1].health,76);assert.equal(state.selectedAgentId,'aster');assert.equal('unexpected' in state,false);assert.notEqual(state.agents[0].memory,state.agents[1].memory);
});

test('explicit historical npc replacements override only Aster and preserve Mira',()=>{
  const state=freshState();state.agents[1].health=75;const replacement=createNpc();replacement.health=63;state.npc=replacement;
  const restored=validateSave(state,{restoring:false});assert.equal(restored.npc.health,63);assert.equal(restored.agents[1].health,75);assert.equal(restored.npc,restored.agents[0]);
});

test('a new character joins an existing world clock without retroactive physiological depletion',()=>{
  const aster=createNpc();aster.elapsed=1200;aster.hydration=61;
  const state=validateSave({version:3,elapsed:1200,npc:aster}),mira=state.agents[1],fresh=createNpc({id:'mira'});
  assert.equal(state.npc.elapsed,1200);assert.equal(state.npc.hydration,61);assert.equal(mira.elapsed,1200);assert.equal(mira.lifecycleAt,1200);assert.equal(mira.nextDecisionAt,1200);assert.equal(mira.bodyFeedback.since,1200);assert.equal(mira.modelBudget.since,1200);
  for(const key of ['hydration','nourishment','health','energy','stamina','fatigue','sleepPressure'])assert.equal(mira[key],fresh[key],key);
  const runtime=new PopulationRuntime(state,{providerFactory:waitingProvider});step(runtime,2);assert.ok(Math.abs(mira.elapsed-1202)<1e-8);assert.ok(Math.abs(state.environment.elapsed-1202)<1e-8);runtime.dispose();
});

test('migration and human contact use personal elapsed time for belonging rather than freezing at world time',()=>{
  const aster=createNpc();aster.elapsed=50;const state=validateSave({version:3,elapsed:1200,npc:aster});
  state.environment.settings.hourOverride=8;state.environment.settings.weatherOverride='cloudy';
  const runtime=new PopulationRuntime(state,{providerFactory:waitingProvider}),mira=state.agents[1],restoredAster=state.npc;
  assert.equal(mira.cognition.bornAt,1200);assert.equal(updateCognition(mira).drives.belonging.tension,'quiet');
  assert.ok(runtime.social.postHuman('Hello, you can keep exploring while I am away.','mira').ok);assert.equal(mira.social.lastContactAt,1200);
  // Isolate the motivation clock from body depletion; physiology remains safe.
  mira.elapsed+=200;state.elapsed+=200;state.environment.elapsed+=200;
  assert.notEqual(updateCognition(mira).drives.belonging.tension,'quiet');
  assert.ok(runtime.social.postHuman('Hello Aster.','aster').ok);assert.equal(restoredAster.social.lastContactAt,50);
  restoredAster.elapsed+=200;assert.notEqual(updateCognition(restoredAster).drives.belonging.tension,'quiet');runtime.dispose();
});

test('one shared clock advances both independent bodies exactly once and pauses without mutation',()=>{
  const state=freshState(),runtime=new PopulationRuntime(state,{providerFactory:waitingProvider});const before=state.agents.map(n=>({hydration:n.hydration,nourishment:n.nourishment}));
  step(runtime,3);assert.ok(Math.abs(state.environment.elapsed-3)<1e-10);
  for(const [index,npc] of state.agents.entries()){assert.ok(Math.abs(npc.elapsed-3)<1e-10);assert.ok(npc.hydration<before[index].hydration);assert.ok(npc.nourishment<before[index].nourishment);}
  const snapshot=JSON.stringify(state);runtime.tick(0);runtime.tick(NaN);assert.equal(JSON.stringify(state),snapshot);runtime.dispose();runtime.tick(1/60);assert.equal(JSON.stringify(state),snapshot);
});

test('pending inference and collapse of one character do not stop the other body',()=>{
  const state=freshState(),runtime=new PopulationRuntime(state,{providerFactory:npc=>npc.id==='aster'?{kind:'local-model',decide:()=>new Promise(()=>{}),cancel(){}}:waitingProvider()});
  step(runtime,2);assert.ok(runtime.controller('aster').pending);assert.ok(state.agents[1].elapsed>1.9);const hydration=state.agents[1].hydration;collapseNpc(state.agents[0],'test');step(runtime,2);assert.equal(state.agents[0].lifecycle,'COLLAPSED');assert.ok(state.agents[1].hydration<hydration);assert.equal(state.agents[1].lifecycle,'AWAKE');runtime.dispose();
});

test('two characters compete for actual finite apples without copying each other inventory',()=>{
  const state=freshState(),source=foodSource('apple:trail-orchard',state.environment);state.environment.foodStocks.find(s=>s.id===source.id).stock=1;
  for(const npc of state.agents){npc.position={x:source.x,y:source.y};observeNpc(npc,state.environment);}
  assert.ok(requestNpcAction(state.agents[0],{type:'gather_food',foodId:source.id},state.environment).ok);assert.equal(requestNpcAction(state.agents[1],{type:'gather_food',foodId:source.id},state.environment).code,'FOOD_DEPLETED');assert.equal(state.agents[0].inventory.apples.length,1);assert.equal(state.agents[1].inventory.apples.length,0);assert.equal(foodSource(source.id,state.environment).stock,0);
});

test('provider factories create separate clients and targeted cancellation leaves the peer untouched',()=>{
  const state=freshState(),clients=new Map(),runtime=new PopulationRuntime(state,{providerFactory:npc=>{const client={...waitingProvider(),cancelled:0,cancel(){this.cancelled++;}};clients.set(npc.id,client);return client;}});
  assert.notEqual(runtime.controller('aster').provider,runtime.controller('mira').provider);runtime.cancel('aster');assert.equal(clients.get('aster').cancelled,1);assert.equal(clients.get('mira').cancelled,0);runtime.setProviderFactory(undefined);assert.equal(runtime.controller('aster').provider.kind,'local-learner');assert.equal(runtime.controller('mira').provider.kind,'local-learner');runtime.dispose();
});

test('unsupported future population saves stay intact and report incompatibility',()=>{
  const store=storage();store.setItem(CONFIG.saveKey,'{"version":99,"agents":[]}');const loaded=loadSave(store);assert.equal(loaded.exists,false);assert.ok(loaded.error);assert.equal(store.getItem(CONFIG.saveKey),'{"version":99,"agents":[]}');
});
