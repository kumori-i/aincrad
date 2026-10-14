import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, NPC_RULES, NPC_PRESETS, CAVES, CAVE_EXIT, CAVE_SPAWN } from '../src/config.js';
import { createNpc } from '../src/npc-state.js';
import { createEnvironment, tickEnvironment, environmentConditions } from '../src/environment.js';
import { canStand, distance } from '../src/world.js';
import { foodSource, shelterSource } from '../src/resources.js';
import { rememberedCells, rememberedEdges, lineOfSight } from '../src/perception.js';
import { observeNpc, requestNpcAction, tickNpc, rescueNpc, collapseNpc, cancelNpcAction, bodyRisk } from '../src/npc.js';
import { validateSave, writeSave, loadSave } from '../src/save.js';
import { freshState } from '../src/world.js';
import { recordEvent } from '../src/npc-memory.js';

const storage=()=>{const map=new Map();return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};};
function advance(npc,env,seconds,step=.1){for(let t=0;t<seconds;t+=step){const dt=Math.min(step,seconds-t);tickEnvironment(env,dt);tickNpc(npc,dt,env);}}
function foodFixture(nourishment=25){const npc=createNpc(),env=createEnvironment(),source=foodSource('apple:trail-orchard',env);npc.position={x:source.x,y:source.y};npc.nourishment=nourishment;observeNpc(npc,env);return {npc,env,source};}
function shelterFixture(){const npc=createNpc(),env=createEnvironment(),shelter=shelterSource('refuge');npc.position={x:shelter.x,y:shelter.y};observeNpc(npc,env);return {npc,env,shelter};}

test('food depletes twice as often as water and body integration is frame-rate independent and paused',()=>{
  const a=createNpc(),b=createNpc(),ea=createEnvironment(),eb=createEnvironment();
  ea.settings.hourOverride=12;eb.settings.hourOverride=12;ea.settings.weatherOverride='cloudy';eb.settings.weatherOverride='cloudy';
  advance(a,ea,10,1/60);advance(b,eb,10,.25);
  for(const key of ['hydration','nourishment','health','riskCost'])assert.ok(Math.abs(a[key]-b[key])<(key==='riskCost'?1e-6:1e-7),key);
  assert.ok(NPC_PRESETS.normal.nourishmentDepletionPerSecond>NPC_PRESETS.normal.depletionPerSecond);
  const body=JSON.stringify(a);tickNpc(a,0,ea);tickNpc(a,NaN,ea);assert.equal(JSON.stringify(a),body);
});
test('warning and critical body risk teach consequences before bodily injury and collapse',()=>{
  const npc=createNpc(),env=createEnvironment();npc.nourishment=NPC_RULES.hungerWarning+1;const comfortableRisk=bodyRisk(npc);
  advance(npc,env,3);assert.ok(npc.nourishment<NPC_RULES.hungerWarning);assert.ok(npc.riskCost>0);assert.ok(npc.stats.warningSeconds>0);assert.equal(npc.health,100);assert.equal(npc.stats.collapses,0);
  assert.ok(npc.memory.experience.some(e=>e.details.code==='HUNGER_WARNING'));
  npc.nourishment=NPC_RULES.criticalNourishment-.5;assert.ok(bodyRisk(npc)>comfortableRisk*2);
  advance(npc,env,2);assert.ok(npc.stats.criticalSeconds>0);assert.ok(npc.memory.experience.some(e=>e.details.code==='BODY_FEEDBACK'&&e.details.riskCost>0));assert.equal(npc.lifecycle,'AWAKE');
});
test('zero reserves damage health gradually rather than instantly killing Aster',()=>{
  const npc=createNpc(),env=createEnvironment();npc.nourishment=0;npc.hydration=80;
  advance(npc,env,1);assert.equal(npc.lifecycle,'AWAKE');assert.ok(npc.health<100&&npc.health>98);assert.ok(npc.stats.injuries>0);
  npc.health=.01;tickNpc(npc,.1,env);assert.equal(npc.lifecycle,'COLLAPSED');assert.equal(npc.collapseCause,'starvation');
});
test('actual apples are finite, gathered separately, carried in bounded inventory and consumed for nourishment',()=>{
  const {npc,env,source}=foodFixture();const initial=npc.nourishment,stock=source.stock;assert.equal('renewAt' in observeNpc(npc,env).foods[0],false);requestNpcAction(npc,{type:'inspect',foodId:source.id},env);assert.equal('renewAt' in npc.memory.foods[source.id],false);
  const gathered=requestNpcAction(npc,{type:'gather_food',foodId:source.id},env);assert.equal(gathered.code,'GATHERED_FOOD');assert.equal(npc.nourishment,initial);assert.equal(foodSource(source.id,env).stock,stock-1);assert.equal(npc.inventory.apples[0].eventId,gathered.eventId);
  const meal=requestNpcAction(npc,{type:'eat'},env);assert.equal(meal.code,'ATE');assert.equal(meal.nourishmentGain,45);assert.equal(npc.inventory.apples.length,0);assert.equal(npc.stats.independentMeals,1);assert.ok(npc.feelings.relief>0);assert.equal(requestNpcAction(npc,{type:'eat'},env).code,'NO_FOOD');
  for(let i=0;i<stock-1;i++)assert.equal(requestNpcAction(npc,{type:'gather_food',foodId:source.id},env).ok,true);
  assert.equal(requestNpcAction(npc,{type:'gather_food',foodId:source.id},env).code,'FOOD_DEPLETED');assert.equal(npc.memory.foods[source.id].available,false);
});
test('apple top-ups do not farm useful meal credit and full bodies do not consume supplies',()=>{
  const {npc,env,source}=foodFixture(99.8);requestNpcAction(npc,{type:'gather_food',foodId:source.id},env);assert.equal(requestNpcAction(npc,{type:'eat'},env).independent,false);assert.equal(npc.stats.independentMeals,0);
  requestNpcAction(npc,{type:'gather_food',foodId:source.id},env);const before=npc.inventory.apples.length;assert.equal(requestNpcAction(npc,{type:'eat'},env).code,'ALREADY_NOURISHED');assert.equal(npc.inventory.apples.length,before);
});
test('full inventory rejects gathering without consuming physical stock',()=>{
  const {npc,env,source}=foodFixture();for(let i=0;i<3;i++)requestNpcAction(npc,{type:'gather_food',foodId:source.id},env);
  const other=foodSource('apple:mint-grove',env);npc.position={x:other.x,y:other.y};observeNpc(npc,env);const stock=foodSource(other.id,env).stock;
  assert.equal(requestNpcAction(npc,{type:'gather_food',foodId:other.id},env).code,'INVENTORY_FULL');assert.equal(foodSource(other.id,env).stock,stock);assert.equal(npc.inventory.apples.length,NPC_RULES.foodCapacity);
});
test('distant remembered food cannot leak depletion and unobserved resources cannot be targeted',()=>{
  const {npc,env,source}=foodFixture();npc.position={x:source.x+300,y:source.y};env.foodStocks.find(s=>s.id===source.id).stock=0;
  assert.equal(requestNpcAction(npc,{type:'gather_food',foodId:source.id},env).code,'OUT_OF_REACH');assert.equal(npc.memory.foods[source.id].available,true);
  assert.equal(requestNpcAction(npc,{type:'move',foodId:'apple:oldwood'},env).code,'UNKNOWN_FOOD');
});
test('cave entry and exit belong to Aster, use local observations, and preserve separate scene maps',()=>{
  const {npc,env,shelter}=shelterFixture();const valley=rememberedCells(npc),edges=rememberedEdges(npc);assert.ok(npc.memory.shelters[shelter.id]);assert.equal('shelteredTemperature' in npc.memory.shelters[shelter.id],false);assert.equal('experiencedTemperature' in npc.memory.shelters[shelter.id],false);assert.equal('shelteredTemperature' in requestNpcAction(npc,{type:'inspect',shelterId:shelter.id},env).resource,false);
  assert.equal(requestNpcAction(npc,{type:'enter_shelter',shelterId:shelter.id},env).code,'ENTERED_SHELTER');assert.equal(npc.scene,'refuge');assert.deepEqual(npc.position,CAVE_SPAWN);assert.equal(npc.memory.shelters[shelter.id].experiencedTemperature,18);assert.ok(Object.keys(rememberedCells(npc)).length>0);assert.notEqual(rememberedCells(npc),valley);assert.notEqual(rememberedEdges(npc),edges);
  const observation=observeNpc(npc,env);assert.deepEqual(observation.exit,{...CAVE_EXIT,observedAt:npc.elapsed});assert.deepEqual(npc.memory.caveExits.refuge,{...CAVE_EXIT,observedAt:npc.elapsed});assert.equal(observation.sources.length,0);assert.equal(observation.foods.length,0);assert.equal(observation.shelters.length,0);for(const cell of observation.cells)assert.equal(cell.scene,'refuge');
  assert.equal(requestNpcAction(npc,{type:'gather_food',foodId:'apple:trail-orchard'},env).code,'UNKNOWN_FOOD');
  assert.equal(requestNpcAction(npc,{type:'exit_shelter'},env).code,'EXITED_SHELTER');assert.equal(npc.scene,'valley');assert.equal(rememberedCells(npc),valley);assert.ok(canStand(npc.position.x,npc.position.y,'valley'));assert.ok(distance(npc.position,CAVES.find(c=>c.id==='refuge'))<110);
});
test('heat and wet windy cold produce functional discomfort while caves provide actual thermal relief only',()=>{
  const hot=createNpc(),hotEnv=createEnvironment();hotEnv.settings.hourOverride=14;hotEnv.settings.weatherOverride='clear';hot.position={x:300,y:760};advance(hot,hotEnv,40);assert.ok(hot.thermal.hot>0);assert.ok(hot.feelings.heat>0);assert.ok(hot.sensation.feltTemperature>NPC_RULES.hotComfortMax);
  const {npc,env,shelter}=shelterFixture();env.settings.hourOverride=4;env.settings.weatherOverride='rainy';npc.thermal.wetness=80;advance(npc,env,30);assert.ok(npc.thermal.cold>0);assert.ok(npc.feelings.cold>0);const cold=npc.thermal.cold,nourishment=npc.nourishment,hydration=npc.hydration;
  assert.equal(requestNpcAction(npc,{type:'enter_shelter',shelterId:shelter.id},env).ok,true);assert.equal(environmentConditions(env,npc).feltTemperature,18);advance(npc,env,10);assert.ok(npc.thermal.cold<cold);assert.equal(npc.sensation.sheltered,true);assert.ok(npc.nourishment<nourishment);assert.ok(npc.hydration<hydration);
});
test('cause-aware rescue is scene-safe, idempotent, does not refill supplies or grant meal progress',()=>{
  const {npc,env,shelter}=shelterFixture();requestNpcAction(npc,{type:'enter_shelter',shelterId:shelter.id},env);npc.nourishment=0;npc.hydration=0;npc.thermal.cold=100;npc.health=0;collapseNpc(npc,'starvation');const position={...npc.position};
  assert.equal(rescueNpc(npc).ok,true);assert.equal(rescueNpc(npc).ok,false);assert.equal(npc.scene,'refuge');assert.deepEqual(npc.position,position);assert.ok(npc.health>0&&npc.health<100);assert.ok(npc.nourishment>0&&npc.nourishment<100);assert.ok(npc.hydration>0&&npc.hydration<100);assert.equal(npc.inventory.apples.length,0);assert.equal(npc.flask.water,0);assert.equal(npc.stats.independentMeals,0);
});
test('body, scene maps and depleted resources survive save/restart without executing arbitrary fields',()=>{
  const state=freshState(),{npc,env,shelter}=shelterFixture();state.npc=npc;state.environment=env;requestNpcAction(npc,{type:'enter_shelter',shelterId:shelter.id},env);npc.thermal.hot=30;npc.nourishment=25;npc.health=78;env.foodStocks[0].stock=0;state.elapsed=17;env.elapsed=17;npc.elapsed=17;
  const store=storage();assert.equal(writeSave(store,state),true);const restored=loadSave(store).state;assert.equal(restored.npc.scene,'refuge');assert.equal(restored.npc.nourishment,25);assert.equal(restored.npc.health,78);assert.equal(restored.npc.thermal.hot,30);assert.equal(restored.environment.foodStocks[0].stock,0);assert.ok(Object.keys(restored.npc.memory.caveCells.refuge).length>0);
  const old=validateSave({version:2,elapsed:100,npc:{...npc,version:1,scene:'valley',position:{x:276,y:760}}});assert.equal(old.version,4);assert.equal(old.npc.id,'aster');assert.ok(Number.isFinite(old.npc.nourishment));assert.equal(old.environment.elapsed,100);
});
test('cave perception respects walls and interruption creates a real bounded action outcome',()=>{
  const {npc,env,shelter}=shelterFixture();requestNpcAction(npc,{type:'enter_shelter',shelterId:shelter.id},env);assert.equal(lineOfSight(CAVE_SPAWN,{x:0,y:0},'refuge'),false);
  requestNpcAction(npc,{type:'wait',seconds:5},env);assert.equal(cancelNpcAction(npc),true);assert.equal(npc.active,null);assert.equal(npc.lastResult.code,'PRIORITY_CHANGED');assert.equal(cancelNpcAction(npc),false);
});

test('Aster moves through observed cave tiles with the same authoritative collision rules',()=>{
  const {npc,env,shelter}=shelterFixture();requestNpcAction(npc,{type:'enter_shelter',shelterId:shelter.id},env);
  const target=Object.values(rememberedCells(npc)).find(c=>c.walkable&&distance(c,npc.position)>80&&distance(c,npc.position)<150);
  assert.ok(target);assert.equal(requestNpcAction(npc,{type:'move',target:{x:target.x,y:target.y}},env).code,'STARTED');advance(npc,env,4);
  assert.equal(npc.lastResult.code,'ARRIVED');assert.ok(distance(npc.position,target)<4);assert.ok(canStand(npc.position.x,npc.position.y,'refuge'));
});
test('bounded experience retains evidence for carried supplies across restart',()=>{
  const {npc,env,source}=foodFixture();requestNpcAction(npc,{type:'gather_food',foodId:source.id},env);const gatherEventId=npc.inventory.apples[0].eventId;
  for(let i=0;i<NPC_RULES.maxExperience+20;i++)recordEvent(npc,'condition',{code:'BODY_FEEDBACK',riskCost:1});
  assert.ok(npc.memory.experience.length<=NPC_RULES.maxExperience);assert.ok(npc.memory.experience.some(e=>e.id===gatherEventId));
  const state=freshState();state.npc=npc;state.environment=env;const store=storage();writeSave(store,state);assert.equal(loadSave(store).state.npc.inventory.apples.length,1);
});
