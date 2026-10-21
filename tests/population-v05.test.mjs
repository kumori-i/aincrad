import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, CAVE_SPAWN } from '../src/config.js';
import { freshState as createWorldState, canStand } from '../src/world.js';
const freshState=()=>createWorldState({mode:'legacy'});
import { PopulationRuntime } from '../src/population.js';

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


