import { bindCommunicationMode } from '../src/communication-mode.js';
// Explicit historical testimony tests; physical-only cases retain grounded defaults.
const recordClaim=(npc,...args)=>{bindCommunicationMode(npc,'legacy');return legacyrecordClaim(npc,...args);};
import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpc } from '../src/npc-state.js';
import { observeNpc, requestNpcAction, tickNpc } from '../src/npc.js';
import { recordEvent, validateNpc } from '../src/npc-memory.js';
import { NpcController, LocalLearnerProvider, DesktopModelProvider, decisionObservation, needPriorities } from '../src/controller.js';
import { createEnvironment } from '../src/environment.js';
import { foodSource, shelterSource } from '../src/resources.js';
import { canStand, distance } from '../src/world.js';
import { createCognition, updateCognition, recordClaim as legacyrecordClaim, cognitiveObservation, localPlan, adoptPlan, progressPlan, cancelPlan, explorationFrontier, searchBounds, estimatedWalkingSpeed } from '../src/cognition.js';

function byFood(n,env){const f=foodSource('apple:trail-orchard',env);for(const [dx,dy] of [[0,0],[8,0],[-8,0],[0,8]])if(canStand(f.x+dx,f.y+dy)){n.position={x:f.x+dx,y:f.y+dy};break;}observeNpc(n,env);return f;}
function threeObservations(){return {goal:'Check my surroundings before deciding what they mean.',need:'understanding',steps:[{type:'observe'},{type:'observe'},{type:'observe'}],completion:'Consider the new evidence.'};}

test('model observation reveals sensations and discrete supplies without hidden physiological telemetry',()=>{
 const n=createNpc(),env=createEnvironment();byFood(n,env);n.nourishment=35;requestNpcAction(n,{type:'gather_food',foodId:'apple:trail-orchard'},env);requestNpcAction(n,{type:'eat'},env);
 recordEvent(n,'condition',{hydration:56,nourishment:44,health:90,energy:30,stamina:60,fatigue:55,sleepPressure:40,thermal:{hot:37},feelings:{thirst:.56},temperature:29});
 const o=decisionObservation(n);assert.equal(typeof o.condition.body.hunger,'string');assert.equal(typeof o.condition.senses.warmth,'string');assert.equal(o.condition.inventory.apples,0);assert.ok(['empty','some','full'].includes(o.condition.inventory.flask));
 const forbidden=new Set(['hydration','nourishment','health','energy','stamina','fatigue','sleepPressure','thermal','feelings','sensation','temperature','feltTemperature','hydrationGain','nourishmentGain','riskCost','experiencedTemperature']);
 function visit(v){if(v&&typeof v==='object')for(const [key,value] of Object.entries(v)){assert.ok(!(forbidden.has(key)&&typeof value==='number'),`Numeric physiology leaked through ${key}`);visit(value);}}visit(o);assert.equal(o.physiologicalPriorities,undefined);assert.equal(o.fullMap,undefined);
 assert.ok(o.knownFoods.length<10);assert.equal(o.recentExperience.at(-1).hydration,undefined);
});
test('reported resource claims remain unverified until a later actual local observation corrects them',()=>{
 const n=createNpc(),env=createEnvironment(),f=byFood(n,env);n.elapsed=10;const claim=recordClaim(n,{subject:f.name,kind:'resource',resourceId:f.id,text:'I heard that this orchard is empty.',available:false},{sourceId:'human'});
 assert.equal(claim.status,'unverified');assert.equal(claim.source,'reported');assert.equal(n.memory.foods[f.id].available,true);
 n.elapsed=11;observeNpc(n,env);updateCognition(n);assert.equal(claim.status,'contradicted');assert.equal(claim.confidence,'revised');assert.ok(claim.evidence.some(e=>e.source==='observed'&&e.agrees===false));
 const unknown=recordClaim(n,{subject:'Unseen spring',resourceId:'pond:unseen:0',kind:'resource',text:'A spring is far away.',position:{x:12000,y:12000},available:true},{sourceId:'mira'});assert.equal(unknown.status,'unverified');assert.equal(n.memory.sources['pond:unseen:0'],undefined);
});
test('renewal hypotheses use observed empty-to-full visits rather than the hidden world timer',()=>{
 const n=createNpc(),env=createEnvironment(),f=byFood(n,env);updateCognition(n);n.elapsed=10;Object.assign(n.memory.foods[f.id],{stock:0,available:false,observedAt:10});updateCognition(n);
 n.elapsed=110;Object.assign(n.memory.foods[f.id],{stock:3,available:true,observedAt:110});updateCognition(n);
 const p=n.cognition.predictions.find(p=>p.subject===`renewal:${f.id}`);assert.deepEqual(p.observedIntervals,[100]);assert.equal(p.confidence,'tentative');assert.ok(n.cognition.beliefs.some(b=>b.source==='inferred'));
 assert.equal('renewAt' in decisionObservation(n).knownFoods[0],false);assert.match(p.expectation,/uncertain/);
});
test('travel forecasts improve from actual successful action durations',()=>{
 const n=createNpc();recordEvent(n,'action',{action:{type:'move'},result:{ok:true,distance:300,durationSeconds:4}});updateCognition(n);assert.equal(n.cognition.travel.samples,1);assert.ok(n.cognition.travel.secondsPerUnit>1/150);
});
test('persistent model plan advances only on terminal outcomes and leaves its broader goal unverified',()=>{
 const n=createNpc(),env=createEnvironment();const controller=new NpcController(n,{environment:env});assert.ok(adoptPlan(n,threeObservations()));const id=n.cognition.plan.id;
 const first=progressPlan(n);assert.equal(first.type,'observe');assert.equal(n.cognition.plan.cursor,0);assert.equal(progressPlan(n),null);
 requestNpcAction(n,first,env);assert.equal(progressPlan(n).type,'observe');assert.equal(n.cognition.plan.cursor,1);
 const saved=validateNpc(JSON.parse(JSON.stringify(n)));assert.equal(saved.cognition.plan.id,id);assert.equal(saved.cognition.plan.cursor,1);assert.equal(saved.cognition.plan.awaiting,false);assert.equal(saved.cognition.plan.status,'active');
 for(let i=0;i<3;i++){const action=progressPlan(saved);if(action)requestNpcAction(saved,action,env);}
 assert.equal(saved.cognition.plan.status,'completed');assert.match(saved.cognition.plan.outcome,/requires verification/);controller.dispose();
});
test('failed actions and urgent sensations interrupt a persistent exploration intention',()=>{
 const n=createNpc(),env=createEnvironment(),controller=new NpcController(n,{environment:env});assert.ok(adoptPlan(n,threeObservations()));progressPlan(n);recordEvent(n,'action',{action:{type:'observe'},result:{ok:false,code:'ROUTE_BLOCKED'}});n.lastResult={ok:false,code:'ROUTE_BLOCKED',eventId:n.memory.experience.at(-1).id};assert.equal(progressPlan(n),null);assert.equal(n.cognition.plan.status,'interrupted');
 adoptPlan(n,threeObservations());n.nourishment=10;controller.tick(.1);assert.equal(n.cognition.plan.status,'interrupted');controller.dispose();
});
test('offline trip preparation precedes frontier travel and the return route has a real travel budget',()=>{
 const n=createNpc(),env=createEnvironment(),controller=new NpcController(n,{environment:env});byFood(n,env);n.flask.water=1;const prep=localPlan(n);assert.ok(prep);assert.equal(prep.need,'safety');assert.ok(prep.steps.some(a=>a.type==='gather_food'));assert.ok(!prep.steps.some(a=>a.type==='move'&&a.target));
 requestNpcAction(n,{type:'gather_food',foodId:'apple:trail-orchard'},env);requestNpcAction(n,{type:'gather_food',foodId:'apple:trail-orchard'},env);n.flask.water=1;n.elapsed=30;n.cognition.lastPlanAt=0;
 const frontier=explorationFrontier(n);assert.ok(frontier);const trip=localPlan(n);assert.equal(trip.need,'understanding');const p=adoptPlan(n,trip,{supplied:true});assert.ok(p.budget.returnSeconds>0);assert.ok(p.returnRoute.points.length>1);assert.ok(p.budget.maxSeconds<=90);assert.equal(p.steps.at(-1).type,'move');assert.ok(distance(p.steps.at(-1).target,n.position)<1);controller.dispose();
});
test('pretending to finish preparation or exploration does not satisfy physical postconditions',()=>{
 const n=createNpc();observeNpc(n);adoptPlan(n,{...threeObservations(),verification:'prepare'},{supplied:true});n.cognition.plan.cursor=3;progressPlan(n);assert.equal(n.cognition.plan.status,'interrupted');assert.equal(n.inventory.apples.length,0);
});
test('unanswered human questions do not pause bodily care or lock the controller',()=>{
 const n=createNpc(),env=createEnvironment();byFood(n,env);requestNpcAction(n,{type:'gather_food',foodId:'apple:trail-orchard'},env);let asks=0;
 const social={observe:()=>({peers:[],journal:[],notes:[],pendingQuestion:{status:'pending'}}),maybeDialogue:()=>asks===0?{type:'ask_human',topic:'world',text:'Where else could I look?'}:null,action:()=>{asks++;return {ok:true,code:'ASKED_HUMAN',waitingRequired:false};}};
 const controller=new NpcController(n,{communicationMode:'legacy',environment:env,social});n.nextDecisionAt=0;controller.tick(.1);assert.equal(asks,1);n.nourishment=10;for(let i=0;i<70;i++)controller.tick(1/60);assert.equal(n.stats.independentMeals,1);assert.equal(n.lifecycle,'AWAKE');assert.ok(n.elapsed>1);controller.dispose();
});
test('two identities and their body and cognitive state survive bounded save validation',()=>{
 const a=createNpc(),m=createNpc({id:'mira'});m.energy=36;m.stamina=49;m.fatigue=32;m.sleepPressure=61;recordClaim(m,{text:'This is Mira’s own question.',subject:'My journey'},{sourceId:'human'});
 const restored=validateNpc(JSON.parse(JSON.stringify(m)));assert.equal(restored.id,'mira');assert.equal(restored.name,'Mira');assert.equal(restored.energy,36);assert.equal(restored.sleepPressure,61);assert.equal(restored.cognition.beliefs.length,1);assert.equal(a.cognition.beliefs.length,0);
 const legacy=JSON.parse(JSON.stringify(a));legacy.version=2;delete legacy.cognition;delete legacy.energy;const migrated=validateNpc(legacy);assert.equal(migrated.id,'aster');assert.equal(migrated.version,3);assert.equal(migrated.energy,85);assert.deepEqual(migrated.cognition,createCognition());
});
test('all drives remain concurrent without relationships gating curiosity',()=>{
 const n=createNpc();observeNpc(n);updateCognition(n);n.elapsed=250;const view=cognitiveObservation(n);assert.equal(view.drives.length,8);assert.equal(view.drives.find(d=>d.name==='understanding').tension,'strong');assert.equal(view.drives.find(d=>d.name==='belonging').tension,'strong');assert.equal(Object.keys(n.social.relationships).length,0);
});
test('restarting a trip retains its original return place and elapsed travel budget',()=>{
 const n=createNpc(),env=createEnvironment(),controller=new NpcController(n,{environment:env});const origin={...n.position},frontier=explorationFrontier(n);assert.ok(frontier);
 const p=adoptPlan(n,{goal:'Inspect nearby unknown terrain, then return.',need:'understanding',verification:'explore',steps:[{type:'move',target:frontier.target},{type:'observe'},{type:'move',target:origin}]},{supplied:true});assert.ok(p);let steps=0;
 while(n.cognition.plan.cursor===0&&steps++<1000)controller.tick(1/60);
 assert.equal(n.cognition.plan.cursor,1);assert.ok(distance(n.position,origin)>100);const budget=n.cognition.plan.budget.maxSeconds;
 const restored=validateNpc(JSON.parse(JSON.stringify(n)));assert.deepEqual(restored.cognition.plan.origin.position,origin);assert.equal(restored.cognition.plan.budget.maxSeconds,budget);assert.equal(restored.cognition.plan.startedAt,p.startedAt);assert.ok(restored.cognition.plan.budget.remainingSeconds<budget);
 const savedPlan=restored.cognition.plan,resumed=new NpcController(restored,{environment:env});for(let i=0;i<1600&&savedPlan.status==='active';i++)resumed.tick(1/60);
 assert.equal(restored.cognition.plan.status,'completed');assert.equal(restored.cognition.plan.goalVerified,true);assert.ok(distance(restored.position,origin)<80);controller.dispose();resumed.dispose();
});
test('a slow model cannot keep a hungry character from using carried food',()=>{
 const n=createNpc(),env=createEnvironment();byFood(n,env);requestNpcAction(n,{type:'gather_food',foodId:'apple:trail-orchard'},env);n.nourishment=35;n.nextDecisionAt=0;let cancelled=0;
 const controller=new NpcController(n,{environment:env,provider:{kind:'local-model',decide:()=>new Promise(()=>{}),cancel(){cancelled++;}}});for(let i=0;i<230;i++)controller.tick(1/60);
 assert.equal(n.stats.independentMeals,1);assert.ok(cancelled>=1);assert.equal(n.lifecycle,'AWAKE');controller.dispose();
});
test('resting yields to sensed hunger and each model client cancels only its own identity',()=>{
 const n=createNpc(),env=createEnvironment();byFood(n,env);requestNpcAction(n,{type:'gather_food',foodId:'apple:trail-orchard'},env);n.nourishment=24;n.energy=10;n.stamina=5;assert.equal(new LocalLearnerProvider().decide(n).action.type,'eat');
 const cancellations=[],bridge={decide:()=>Promise.resolve({action:{type:'observe'}}),cancel:id=>cancellations.push(id)};new DesktopModelProvider(bridge,'fixture','mira').cancel();assert.deepEqual(cancellations,['mira']);
});
test('model budget fallback retains grounded conversation rather than disabling social cognition',()=>{
 const n=createNpc();n.modelBudget.calls=60;let offered=0,delivered=0,modelCalls=0;
 const social={observe:()=>({peers:[],journal:[],notes:[],pendingQuestion:null}),maybeDialogue:()=>{offered++;return {type:'journal_reply',text:'I can keep exploring while you are away.'};},action:()=>{delivered++;return {ok:true,code:'REPLIED_JOURNAL'};}};
 const controller=new NpcController(n,{communicationMode:'legacy',social,provider:{kind:'local-model',decide(){modelCalls++;return {action:{type:'observe'}};},cancel(){}}});controller.tick(.1);
 assert.equal(modelCalls,0);assert.equal(offered,1);assert.equal(delivered,1);assert.equal(n.lastResult.code,'REPLIED_JOURNAL');assert.equal(n.memory.experience.find(e=>e.type==='decision').details.provider,'local-learner');controller.dispose();
});
test('unknown-food fallback search has a home radius and return deadline without an explicit plan',()=>{
 const n=createNpc({id:'mira',seed:3}),controller=new NpcController(n),home={...n.cognition.home.position};assert.equal(Object.keys(n.memory.foods).length,0);assert.equal(n.cognition.plan,null);
 n.position={x:-600,y:0};assert.ok(canStand(n.position.x,n.position.y));n.elapsed=30;observeNpc(n);n.cognition.search={startedAt:0,returning:false};const decision=new LocalLearnerProvider().decide(n);
 assert.equal(decision.need,'safety');assert.equal(decision.action.type,'move');assert.ok(distance(decision.action.target,home)<distance(n.position,home));assert.equal(n.cognition.search.returning,true);
 n.position=home;n.cognition.search={startedAt:null,returning:false};observeNpc(n);const frontier=explorationFrontier(n);assert.ok(frontier);assert.ok(distance(frontier.target,home)<searchBounds(n).radius);controller.dispose();
});
test('remembered dangerous weather supports sustained shelter instead of repeated enter-exit chatter',()=>{
 const n=createNpc(),env=createEnvironment(),controller=new NpcController(n,{environment:env});requestNpcAction(n,{type:'fill_flask',sourceId:'pond:spring:4'},env);byFood(n,env);requestNpcAction(n,{type:'gather_food',foodId:'apple:trail-orchard'},env);requestNpcAction(n,{type:'gather_food',foodId:'apple:trail-orchard'},env);
 const shelter=shelterSource('refuge');n.position={x:shelter.x,y:shelter.y};env.settings.hourOverride=14;env.settings.weatherOverride='clear';n.elapsed=1;observeNpc(n,env);updateCognition(n);n.thermal.hot=60;requestNpcAction(n,{type:'enter_shelter',shelterId:shelter.id},env);
 for(let i=0;i<120*60;i++)controller.tick(1/60);
 const actions=n.memory.experience.filter(e=>e.type==='action');assert.equal(n.scene,'refuge');assert.equal(actions.filter(e=>e.details.result?.code==='EXITED_SHELTER').length,0);assert.equal(n.stats.collapses,0);assert.ok(n.stats.independentMeals>0);controller.dispose();
});
test('a supply departure is committed long enough to gather food, with a danger override',()=>{
 const n=createNpc(),env=createEnvironment();env.settings.hourOverride=14;env.settings.weatherOverride='clear';const shelter=shelterSource('refuge');n.position={x:shelter.x,y:shelter.y};observeNpc(n,env);updateCognition(n);requestNpcAction(n,{type:'enter_shelter',shelterId:shelter.id},env);n.nourishment=35;
 const controller=new NpcController(n,{environment:env});for(let i=0;i<120&&n.scene!=='valley';i++)controller.tick(1/60);assert.equal(n.scene,'valley');n.elapsed+=1;observeNpc(n,env);updateCognition(n);assert.ok(n.cognition.shelterState.departureUntil>n.elapsed);
 const next=new LocalLearnerProvider().decide(n);assert.notEqual(next.action?.type,'enter_shelter');assert.equal(next.need,'food');n.thermal.hot=90;const danger=new LocalLearnerProvider().decide(n);assert.equal(danger.need,'thermal');controller.dispose();
});
test('felt thermal warning overrides a supply departure before exposure becomes critical',()=>{
 const n=createNpc(),env=createEnvironment(),s=shelterSource('refuge');n.position={x:s.x,y:s.y};env.settings.hourOverride=14;observeNpc(n,env);updateCognition(n);n.nourishment=35;n.cognition.shelterState.departureUntil=n.elapsed+45;
 const ambient=needPriorities(n).thermal;assert.equal(ambient,1.8);n.thermal.hot=55;assert.equal(needPriorities(n).thermal,6);const decision=new LocalLearnerProvider().decide(n);assert.equal(decision.need,'thermal');assert.equal(decision.action.type,'enter_shelter');
});
test('warning recovery in shelter precedes another supply trip, with an imminent-deprivation alternative',()=>{
 const n=createNpc(),env=createEnvironment(),s=shelterSource('refuge');n.position={x:s.x,y:s.y};observeNpc(n,env);updateCognition(n);requestNpcAction(n,{type:'enter_shelter',shelterId:s.id},env);n.nourishment=15;n.thermal.cold=60;
 const recovery=new LocalLearnerProvider().decide(n);assert.equal(recovery.action.type,'wait');assert.equal(recovery.need,'thermal');n.nourishment=0;n.health=30;n.thermal.cold=79;
 const panic=new LocalLearnerProvider().decide(n);assert.equal(panic.action.type,'exit_shelter');assert.equal(panic.need,'food');
});
test('a remembered available refuge is not blacklisted because an earlier approach failed',()=>{
 const n=createNpc(),env=createEnvironment(),s=shelterSource('refuge');n.position={x:s.x,y:s.y};observeNpc(n,env);updateCognition(n);n.memory.shelters.refuge.retryAfter=n.elapsed+30;n.thermal.cold=70;
 const decision=new LocalLearnerProvider().decide(n);assert.equal(decision.need,'thermal');assert.equal(decision.action.type,'enter_shelter');assert.equal(decision.action.shelterId,'refuge');
});
function rememberedTrailGrid(n){
 n.position={x:0,y:0};n.memory.cells={};for(let x=0;x<=15;x++)for(let y=0;y<=12;y++)n.memory.cells[`${x},${y}`]={key:`${x},${y}`,x:x*80,y:y*80,walkable:canStand(x*80,y*80),terrain:'remembered',visits:0,observedAt:0};
 const food=foodSource('apple:trail-orchard');n.memory.foods[food.id]={...food,scene:'valley',observedAt:0,retryAfter:0};return food;
}
test('felt exhaustion stages a food approach within the physical action budget',()=>{
 const n=createNpc(),food=rememberedTrailGrid(n);n.nourishment=10;n.stamina=5;assert.equal(estimatedWalkingSpeed(n),97.5);const decision=new LocalLearnerProvider().decide(n);
 assert.equal(decision.need,'food');assert.equal(decision.action.type,'move');assert.ok(decision.action.target);assert.equal(decision.action.foodId,undefined);assert.ok(distance(decision.action.target,n.position)<370);assert.ok(distance(decision.action.target,food)<distance(n.position,food));
});
test('a bounded movement timeout with real progress retains resource availability and can continue immediately',()=>{
 const n=createNpc(),food=rememberedTrailGrid(n);requestNpcAction(n,{type:'move',foodId:food.id,duration:.7});for(let i=0;i<10&&n.active;i++)tickNpc(n,.1);
 assert.equal(n.lastResult.code,'ACTION_TIMEOUT');assert.ok(n.lastResult.distance>40);assert.equal(n.memory.foods[food.id].available,true);assert.equal(n.memory.foods[food.id].retryAfter,n.elapsed);assert.equal(n.stats.invalidActions,0);
});
test('critical carried relief precedes a return-home commitment',()=>{
 const n=createNpc(),env=createEnvironment(),controller=new NpcController(n,{environment:env});requestNpcAction(n,{type:'fill_flask',sourceId:'pond:spring:4'},env);byFood(n,env);requestNpcAction(n,{type:'gather_food',foodId:'apple:trail-orchard'},env);n.cognition.search={startedAt:0,returning:true};n.nourishment=0;n.health=30;
 assert.equal(new LocalLearnerProvider().decide(n).action.type,'eat');requestNpcAction(n,{type:'eat'},env);n.hydration=0;assert.equal(new LocalLearnerProvider().decide(n).action.type,'drink');controller.dispose();
});
