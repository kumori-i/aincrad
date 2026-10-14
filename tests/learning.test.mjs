import test from 'node:test';
import assert from 'node:assert/strict';
import {createNpc} from '../src/npc-state.js';
import {NpcController,LocalLearnerProvider,decisionObservation,needPriorities} from '../src/controller.js';
import {recordEvent,validateNpc,learningCostTick,learnedValue,policyContext} from '../src/npc-memory.js';
import {observeNpc,requestNpcAction,tickNpc,bodyRisk} from '../src/npc.js';
import {foodSource,waterSource,shelterSource} from '../src/resources.js';
import {createEnvironment} from '../src/environment.js';
import {canStand} from '../src/world.js';

function near(n,resource){for(const [x,y] of [[8,0],[0,8],[-8,0],[0,-8],[0,0]])if(canStand(resource.x+x,resource.y+y)){n.scene='valley';n.position={x:resource.x+x,y:resource.y+y};observeNpc(n);return;}throw new Error('Fixture must stand on physical ground');}
function learnWater(n){const s=waterSource('pond:spring:0');near(n,s);n.hydration=35;requestNpcAction(n,{type:'fill_flask',sourceId:s.id});requestNpcAction(n,{type:'drink'});n.flask.water=0;n.hydration=50;return s;}
function collectApple(n,env={}){const food=foodSource('apple:trail-orchard',env);near(n,food);observeNpc(n,env);assert.equal(requestNpcAction(n,{type:'gather_food',foodId:food.id},env).code,'GATHERED_FOOD');return food;}

test('urgent hunger competes with and outweighs an acquired water procedure',()=>{
 const n=createNpc(),source=learnWater(n);collectApple(n);near(n,source);n.nourishment=15;n.hydration=55;
 assert.ok(n.memory.skills.some(s=>s.need==='water'));assert.ok(needPriorities(n).food>needPriorities(n).water);
 const decision=new LocalLearnerProvider().decide(n);assert.equal(decision.action.type,'eat');assert.equal(decision.skillId,undefined);
});
test('an acquired water procedure does not bypass a configured model decision',async()=>{
 const n=createNpc();learnWater(n);n.nextDecisionAt=0;let called=0;
 const provider={kind:'local-model',decide:()=>{called++;return Promise.resolve({action:{type:'wait',seconds:1},reason:'Explicit fixture choice'});},cancel(){}};
 const controller=new NpcController(n,{provider});controller.tick(.1);assert.equal(called,1);assert.equal(n.skillRun,null);await new Promise(r=>setImmediate(r));controller.tick(.1);assert.equal(n.active.request.type,'wait');controller.dispose();
});
test('continuous warning and critical costs change experience before collapse, including during a wait',()=>{
 const n=createNpc();n.nourishment=35;n.hydration=80;requestNpcAction(n,{type:'wait',seconds:5});const context=policyContext(n),health=n.health;
 for(let i=0;i<10;i++)tickNpc(n,.1);
 assert.equal(n.lifecycle,'AWAKE');assert.equal(n.health,health);assert.ok(n.riskCost>0);assert.ok(n.memory.values[`${context}::wait`].value<0);assert.ok(learnedValue(n,{type:'wait'}).value<0);
 const warningRisk=bodyRisk(n);n.nourishment=10;assert.ok(bodyRisk(n)>warningRisk*2);
});
test('continuous credit follows elapsed seconds rather than action frequency',()=>{
 const a=createNpc(),b=createNpc();for(const n of [a,b]){n.nourishment=25;requestNpcAction(n,{type:'wait',seconds:5});}
 for(let i=0;i<100;i++)learningCostTick(a,.01,.01);for(let i=0;i<10;i++)learningCostTick(b,.1,.1);
 assert.ok(Math.abs(learnedValue(a,{type:'wait'}).value-learnedValue(b,{type:'wait'}).value)<.002);
});
test('useful gathering and eating produce a bounded evidence-backed food template and retain provenance',()=>{
 const n=createNpc(),env=createEnvironment();n.nourishment=35;collectApple(n,env);const gatherId=n.inventory.apples[0].eventId;
 const result=requestNpcAction(n,{type:'eat'},env);assert.equal(result.independent,true);assert.ok(n.memory.skills.some(s=>s.id==='food-gather-eat'));
 const skill=n.memory.skills.find(s=>s.need==='food');assert.equal(skill.status,'candidate');assert.ok(skill.supportingExperience.includes(gatherId));assert.match(skill.recognition,/provided/);assert.ok(n.memory.effects.eat.nourishment>0);
 const restored=validateNpc(JSON.parse(JSON.stringify(n)));assert.equal(restored.memory.skills.find(s=>s.need==='food').status,'candidate');assert.equal(restored.stats.independentMeals,1);
});
test('shelter learning credits actual recovery and repeated comfortable visits do not fabricate new success',()=>{
 const n=createNpc(),s=shelterSource('refuge'),env=createEnvironment();near(n,s);n.thermal.hot=60;
 assert.equal(requestNpcAction(n,{type:'enter_shelter',shelterId:s.id},env).code,'ENTERED_SHELTER');for(let i=0;i<100;i++)tickNpc(n,.1,env);
 const skill=n.memory.skills.find(s=>s.need==='thermal');assert.ok(skill);assert.match(skill.recognition,/provided/);const successes=skill.successes;
 n.thermal.hot=0;for(let i=0;i<100;i++)tickNpc(n,.1,env);assert.equal(skill.successes,successes);assert.ok(n.memory.shelters.refuge.relief>=15);
});
test('a more urgent actionable need interrupts a running activity with recorded consequences',()=>{
 const n=createNpc();collectApple(n);n.nourishment=10;n.hydration=90;const controller=new NpcController(n);requestNpcAction(n,{type:'wait',seconds:5});controller.tick(.1);
 assert.ok(n.memory.experience.some(e=>e.details.result?.code==='PRIORITY_CHANGED'));assert.equal(n.active,null);assert.equal(n.lastResult.code,'ATE');assert.equal(n.stats.invalidActions,0);controller.dispose();
});
test('changed need context invalidates delayed model decisions',async()=>{
 const n=createNpc();let resolve;const provider={kind:'local-model',decide:()=>new Promise(r=>resolve=r),cancel(){}};const controller=new NpcController(n,{provider});controller.tick(.1);const oldResolve=resolve;n.nourishment=5;controller.tick(.1);
 oldResolve({action:{type:'wait',seconds:5},reason:'Old comfortable observation'});await new Promise(r=>setImmediate(r));assert.equal(controller.readyDecision,null);assert.equal(n.active,null);assert.ok(n.stats.staleResponses>=1);controller.dispose();
});
test('model observations expose body, current-scene remembered tiles and only discovered resource locations',()=>{
 const n=createNpc();observeNpc(n);const observation=decisionObservation(n);assert.equal(observation.condition.nourishment,undefined);assert.equal(typeof observation.condition.body.hunger,'string');assert.ok(observation.condition.senses);assert.ok(observation.knownFoods.length<Object.keys(createEnvironment().foodStocks||{}).length||observation.knownFoods.length<10);assert.equal('fullMap' in observation,false);
 const s=shelterSource('refuge');near(n,s);requestNpcAction(n,{type:'enter_shelter',shelterId:s.id});const cave=decisionObservation(n);assert.equal(cave.condition.scene,'refuge');assert.ok(cave.knownTiles.every(c=>c.terrain.startsWith('cave')));assert.ok(cave.knownSources.every(source=>source.distance===null));
});
test('save validation rejects forged inventory evidence and preserves bounded genuine apples',()=>{
 const n=createNpc();const food=collectApple(n),raw=JSON.parse(JSON.stringify(n));raw.inventory.apples.push({foodId:food.id,collectedAt:0,eventId:999999});raw.thermal.wetness=73;
 const restored=validateNpc(raw);assert.equal(restored.inventory.apples.length,1);assert.equal(restored.thermal.wetness,73);
 raw.memory.skills.push({id:'food-gather-eat',steps:[{type:'gather_food',foodId:'$foodId'},{type:'execute',code:'arbitrary'}],supportingExperience:[1,2]});assert.equal(validateNpc(raw).memory.skills.length,0);
});
test('tiny food top-ups and repeated mapped observations do not create useful-relief value or skill credit',()=>{
 const n=createNpc();collectApple(n);n.nourishment=99.9;requestNpcAction(n,{type:'eat'});assert.equal(n.stats.independentMeals,0);assert.equal(n.memory.skills.length,0);assert.equal(n.memory.effects.eat,undefined);
 const before=n.memory.explorationCredit;for(let i=0;i<20;i++)requestNpcAction(n,{type:'observe'});assert.equal(n.memory.explorationCredit,before);
});
test('food policy conserves whole apples and offers preparation within bounded carrying capacity',()=>{
 const n=createNpc();collectApple(n);n.nourishment=80;
 for(let i=0;i<12;i++)assert.notEqual(new LocalLearnerProvider().decide(n).action?.type,'eat');
 n.nourishment=65;const prepare=new LocalLearnerProvider().decide(n);assert.equal(prepare.action.type,'gather_food');assert.equal(prepare.action.foodId,'apple:trail-orchard');
 n.nourishment=45;assert.equal(new LocalLearnerProvider().decide(n).action.type,'eat');
});
test('out-of-range cave exits are approached over observed terrain before exiting',()=>{
 const n=createNpc();n.scene='refuge';n.position={x:1160,y:1440};n.nourishment=15;n.hydration=80;const controller=new NpcController(n);let moved=false;
 for(let i=0;i<600&&n.scene!=='valley';i++){controller.tick(1/60);moved ||= n.active?.request.type==='move';}
 assert.ok(moved);assert.equal(n.scene,'valley');assert.equal(n.memory.experience.some(e=>e.details.action?.type==='exit_shelter'&&e.details.result?.code==='OUT_OF_REACH'),false);controller.dispose();
});
test('crossing from thermal warning into critical strain invalidates pending model context',async()=>{
 const n=createNpc();n.thermal.hot=60;let resolve;const provider={kind:'local-model',decide:()=>new Promise(r=>resolve=r),cancel(){}};const controller=new NpcController(n,{provider});controller.tick(.1);const oldResolve=resolve;n.thermal.hot=90;controller.tick(.1);
 oldResolve({action:{type:'wait',seconds:5},reason:'Stale exposure state'});await new Promise(r=>setImmediate(r));assert.equal(controller.readyDecision,null);assert.ok(n.stats.staleResponses>=1);controller.dispose();
});
test('unmet urgent exposure favors searching actual observed frontiers over unrelated top-ups',()=>{
 const n=createNpc();observeNpc(n);n.hydration=50;n.flask.water=1;n.nourishment=70;n.thermal.hot=70;
 assert.deepEqual(n.memory.shelters,{});const decision=new LocalLearnerProvider().decide(n);
 assert.equal(decision.action.type,'move');assert.ok(decision.action.target);assert.equal(decision.need,'thermal');assert.deepEqual(n.memory.shelters,{});
});
