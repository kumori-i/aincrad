import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpc } from '../src/npc-state.js';
import { createEnvironment, validateEnvironment } from '../src/environment.js';
import { CAVES, CAVE_EXIT } from '../src/config.js';
import { proposeFiniteChoice } from '../scripts/lib/finite-temporal-policy.mjs';
import { finitePublicView } from '../scripts/lib/finite-temporal-driver.mjs';
import { createCommunity } from '../src/social.js';
import { canStand } from '../src/world.js';
import { PopulationRuntime } from '../src/population.js';
import { observeNpc, cancelNpcAction, collapseNpc } from '../src/npc.js';
import { projectPhysiology } from '../src/biology.js';
import { discoveryDecision } from '../src/discovery.js';
import { FiniteTemporalDriver } from '../scripts/lib/finite-temporal-driver.mjs';
import { serializeFiniteCheckpoint, restoreFiniteCheckpoint } from '../scripts/lib/finite-temporal-checkpoint.mjs';
const DT=1/60,SOURCE='b'.repeat(64),copy=v=>structuredClone(v);
const initial=createEnvironment(74193,{mode:'discovery'}),tree=initial.ecology.plants.find(p=>p.kind==='apple_tree');
function state(){
 const n=createNpc({mode:'discovery',seed:74193});n.position=[45,-45].map(dx=>({x:tree.position.x+dx,y:tree.position.y})).find(p=>canStand(p.x,p.y,'valley'));assert.ok(n.position);
 return {elapsed:0,simulationMode:'discovery',environment:copy(initial),agents:[n],npc:n,community:createCommunity(),cardinal:null};
}
function step(driver,seconds){for(let i=0;i<Math.round(seconds/DT);i++)driver.step(DT);}
function act(driver,action){
 while(driver.npc.elapsed<driver.npc.nextDecisionAt)driver.step(DT);
 assert.equal(driver.submit(action),true);let frames=0;
 while(driver.npc.active&&frames++<10000)driver.step(DT);
 assert.equal(driver.npc.active,null);assert.equal(driver.pending,null);return driver.memory.receipts.at(-1);
}
function normalized(n){const out=copy(n);delete out.discovery.temporal;return out;}

test('optional ordinary proposal preserves original opportunities and defers only its RNG commit',()=>{
 const s=state();observeNpc(s.npc,s.environment);const a=copy(s.npc),b=copy(s.npc),before=a.rng;
 const p=discoveryDecision(a,{foodLearning:false,ordinaryProposal:true}),repeat=discoveryDecision(a,{foodLearning:false,ordinaryProposal:true});
 assert.ok(p.ordinary);assert.equal(a.rng,before);assert.deepEqual(p,repeat);
 const legacy=discoveryDecision(b,{foodLearning:false});assert.equal(b.rng,p.ordinary.rngAfter);
 const objects=p.ordinary.choices.filter(c=>c.action.type!=='wait').sort((a,b)=>b.score-a.score);
 assert.deepEqual(objects[0].action,legacy.action);a.rng=b.rng;assert.deepEqual(a,b);
});
test('real legacy-driver integration preserves ordinary actor and full world through work and movement',()=>{
 const a=state(),b=copy(a);b.npc=b.agents[0];const reference=new PopulationRuntime(a,{cardinal:false,discoveryFoodLearning:false});
 reference.controller(a.npc.id).social=null;reference.social={observe(){},tick(){}};
 const driver=new FiniteTemporalDriver(b,{arm:'legacy-test'});
 for(let frame=0;frame<1200;frame++){
  a.elapsed+=DT;reference.tick(DT);driver.step(DT);
  if(frame%120===0){assert.deepEqual(normalized(b.npc),a.npc);assert.deepEqual(b.environment,a.environment);}
 }
 assert.ok(driver.submissions>1);assert.ok(driver.outcomes>0);assert.equal(driver.unsubmitted,0);
 reference.dispose();driver.dispose();
});
test('small real-controller contract trace binds each automatic submission to its own actual result',()=>{
 const events=[],driver=new FiniteTemporalDriver(state(),{sink:e=>events.push(e)});step(driver,8);
 assert.ok(events.some(e=>e.type==='submission'&&e.ordinary));
 for(const outcome of events.filter(e=>e.type==='outcome')){
  const submitted=events.find(e=>e.type==='submission'&&e.seq===outcome.seq);assert.ok(submitted);assert.deepEqual(outcome.action,submitted.action);
  assert.equal(driver.memory.receipts.find(r=>r.seq===outcome.seq).outcome.actionId,outcome.actionId);
 }
 for(const e of events.filter(e=>e.choice))assert.ok(!e.choice.key.includes('object:'));
 assert.equal(driver.unsubmitted,0);driver.dispose();
});
test('actual immediate rest refusal commits one zero-work receipt; busy guard commits nothing',()=>{
 const driver=new FiniteTemporalDriver(state(),{automatic:false}),n=driver.npc;n.physiology.availableEnergyKcal=0;projectPhysiology(n);
 assert.equal(driver.submit({type:'rest',seconds:5},{need:'rest'}),true);const refused=driver.memory.receipts.at(-1);
 assert.equal(refused.outcome.code,'UNSAFE_TO_REST');assert.equal(refused.outcome.exertion,undefined);assert.equal(driver.memory.open.reward[4],0);
 assert.ok(n.nextDecisionAt>n.elapsed);assert.equal(driver.selector.choices,0);
 const guarded=copy(driver.memory);assert.equal(driver.submit({type:'wait',seconds:5}),false);assert.deepEqual(driver.memory,guarded);
 while(n.elapsed<n.nextDecisionAt)driver.step(DT);assert.equal(driver.submit({type:'wait',seconds:5}),true);const before=copy(driver.memory),selector=copy(driver.selector);
 assert.equal(driver.submit({type:'pull',targetId:tree.id}),false);assert.deepEqual(driver.memory,before);assert.deepEqual(driver.selector,selector);driver.dispose();
});
test('partial real work cancellation records only performed effort and leaves no fictional success',()=>{
 const driver=new FiniteTemporalDriver(state(),{automatic:false});assert.equal(driver.submit({type:'strike',targetId:tree.id}),true);step(driver,.5);
 assert.ok(cancelNpcAction(driver.npc,'PRIORITY_CHANGED'));driver.captureCompletion();const r=driver.memory.receipts.at(-1);
 assert.equal(r.outcome.ok,false);assert.equal(r.outcome.code,'PRIORITY_CHANGED');assert.ok(r.outcome.workedSeconds>0&&r.outcome.workedSeconds<1);
 assert.ok(driver.memory.open.reward[4]>0);assert.equal(driver.pending,null);driver.dispose();
});
test('scripted actual acquisition and delayed feedback are captured at biology time, including idle reopen',()=>{
 const driver=new FiniteTemporalDriver(state(),{automatic:false}),n=driver.npc;n.physiology.hoursSinceMeal=12;projectPhysiology(n);
 const pull=act(driver,{type:'pull',targetId:tree.id}),material=pull.outcome.materialId;
 assert.ok(material);act(driver,{type:'sample',targetId:material});
 // This is a scripted integration fixture, never the autonomous feasibility arm.
 while(n.elapsed<53){driver.step(DT);}assert.equal(n.active,null);
 const text=serializeFiniteCheckpoint({state:driver.state,selector:driver.selector,driver:driver.checkpointDriver(),arm:'online',sourceFingerprint:SOURCE});
 const restored=restoreFiniteCheckpoint(text,{expectedArm:'online',expectedSourceFingerprint:SOURCE});
 const reopened=new FiniteTemporalDriver(restored.state,{...restored,automatic:false});
 assert.deepEqual(reopened.memory,driver.memory);assert.deepEqual(reopened.npc.physiology,n.physiology);
 for(let i=0;i<600;i++){driver.step(DT);reopened.step(DT);}
 assert.ok(driver.memory.totals[0]>0);assert.deepEqual(reopened.memory,driver.memory);assert.deepEqual(reopened.npc.physiology,n.physiology);
 assert.deepEqual(reopened.selector,driver.selector);
 // Existing engine restoration discards this animal-only transient signal.
 // All other world fields, including complete animal physiology, stay exact.
 const withoutAnimalRelief=env=>{const e=copy(env);for(const a of e.ecology.animals)delete a.feelings;return e;};
 assert.deepEqual(withoutAnimalRelief(reopened.state.environment),withoutAnimalRelief(driver.state.environment));
 driver.dispose();reopened.dispose();
});
test('unfinished interaction reopen censors its interval instead of training zero unobserved work',()=>{
 const driver=new FiniteTemporalDriver(state(),{automatic:false});driver.submit({type:'strike',targetId:tree.id});step(driver,.5);
 const seq=driver.pending.seq,text=serializeFiniteCheckpoint({state:driver.state,selector:driver.selector,driver:driver.checkpointDriver(),arm:'online',sourceFingerprint:SOURCE});
 const restored=restoreFiniteCheckpoint(text,{expectedArm:'online',expectedSourceFingerprint:SOURCE}),reopened=new FiniteTemporalDriver(restored.state,{...restored,automatic:false});
 assert.equal(restored.pendingDisposition.status,'interrupted');assert.equal(reopened.memory.open,null);assert.equal(reopened.memory.receipts.find(r=>r.seq===seq).outcome,undefined);
 assert.equal(reopened.pending,null);assert.equal(reopened.memory.historyCensored,true);reopened.submit({type:'wait',seconds:5});
 assert.ok(!reopened.memory.model.transitions.some(t=>t.seq===seq));driver.dispose();reopened.dispose();
});
test('diagnostic sink failure cannot interrupt authoritative collapse transitions',()=>{
 const a=new FiniteTemporalDriver(state(),{automatic:false}),b=new FiniteTemporalDriver(state(),{automatic:false,sink:e=>{if(e.type==='outcome')throw new Error('test sink');}});
 for(const d of [a,b]){d.submit({type:'strike',targetId:tree.id});step(d,.2);collapseNpc(d.npc,'test injury');d.captureCompletion();}
 assert.equal(b.npc.lifecycle,'COLLAPSED');assert.equal(b.npc.stats.collapses,1);assert.deepEqual(b.npc,a.npc);assert.equal(b.diagnosticError,'test sink');
 a.dispose();b.dispose();
});

test('existing environment validator omits animal relief without changing authoritative body state',()=>{
 const s=state(),animal=s.environment.ecology.animals[0];animal.feelings={relief:.2};
 const out=validateEnvironment(s.environment);assert.equal(out.ecology.animals[0].feelings,undefined);
 assert.deepEqual(out.ecology.animals[0].physiology,animal.physiology);
});

test('real shelter epochs are accepted care outcomes without ordinary selector draws',()=>{
 const s=state(),cave=CAVES.find(c=>c.id==='refuge');s.npc.position={x:cave.x,y:cave.y+55};
 const d=new FiniteTemporalDriver(s,{automatic:false}),rng=d.selector.rng;
 const entered=act(d,{type:'enter_shelter',shelterId:cave.id});assert.equal(entered.outcome.code,'ENTERED_SHELTER');
 assert.equal(d.npc.scene,cave.id);assert.equal(d.controller.epoch,d.npc.epoch);assert.equal(d.selector.choices,0);assert.equal(d.selector.rng,rng);
 d.npc.position={...CAVE_EXIT};observeNpc(d.npc,d.state.environment);
 const exited=act(d,{type:'exit_shelter'});assert.equal(exited.outcome.code,'EXITED_SHELTER');assert.equal(d.npc.scene,'valley');
 assert.equal(d.controller.epoch,d.npc.epoch);assert.equal(d.memory.model.transitions[0].nextSeq,exited.seq);d.dispose();
});
test('stale proposal and real scheduler guard spend no selector phase or ledger successor',()=>{
 const d=new FiniteTemporalDriver(state(),{automatic:false});observeNpc(d.npc,d.state.environment);
 const o=discoveryDecision(d.npc,{foodLearning:false,ordinaryProposal:true}).ordinary;
 const p=proposeFiniteChoice(finitePublicView(d.npc),d.memory,d.selector,o);d.step(DT);
 const m=copy(d.memory),selector=copy(d.selector),rng=d.npc.rng;
 assert.throws(()=>d.submit(p.selected.action,{proposal:p,opportunity:o}),/Stale/);
 assert.deepEqual(d.memory,m);assert.deepEqual(d.selector,selector);assert.equal(d.npc.rng,rng);assert.equal(d.npc.active,null);d.dispose();
});
test('trace on/off leaves automatic physical state, learning and RNG exactly equal',()=>{
 const a=new FiniteTemporalDriver(state()),events=[],b=new FiniteTemporalDriver(state(),{sink:e=>{events.push(e);if(e.action)e.action.type='tampered';}});
 for(let i=0;i<600;i++){a.step(DT);b.step(DT);}
 assert.ok(events.length);assert.deepEqual(b.npc,a.npc);assert.deepEqual(b.state.environment,a.state.environment);assert.deepEqual(b.selector,a.selector);a.dispose();b.dispose();
});
test('real sleeping feedback belongs to sleep at emission; interrupted reopen consumes it without invented completion',()=>{
 const d=new FiniteTemporalDriver(state(),{automatic:false}),n=d.npc;n.physiology.hoursSinceMeal=12;projectPhysiology(n);
 const material=act(d,{type:'pull',targetId:tree.id}).outcome.materialId;act(d,{type:'sample',targetId:material});
 n.physiology.fatigue=80;n.physiology.sleepPressure=90;projectPhysiology(n);
 while(n.elapsed<n.nextDecisionAt)d.step(DT);assert.equal(d.submit({type:'sleep',seconds:1200},{need:'rest'}),true);
 const seq=d.pending.seq;step(d,30);assert.equal(n.physiology.sleep.state,'sleeping');
 const text=serializeFiniteCheckpoint({state:d.state,selector:d.selector,driver:d.checkpointDriver(),arm:'online',sourceFingerprint:SOURCE});
 const r=restoreFiniteCheckpoint(text,{expectedArm:'online',expectedSourceFingerprint:SOURCE}),b=new FiniteTemporalDriver(r.state,{...r,automatic:false});
 const updates=d.memory.model.updateCount;assert.equal(b.memory.open,null);assert.equal(b.npc.physiology.sleep.state,'sleeping');
 for(let i=0;i<2400;i++){d.step(DT);b.step(DT);}
 assert.ok(d.memory.events.length);assert.ok(d.memory.events.every(e=>e.owner===seq));assert.equal(n.discovery.effects.length,0);
 assert.equal(b.memory.events.length,0);assert.ok(b.memory.censoredEvents>0);assert.deepEqual(b.memory.ingestions,d.memory.ingestions);
 assert.deepEqual(b.npc.physiology,n.physiology);assert.equal(b.memory.model.updateCount,updates);assert.equal(d.memory.model.updateCount,updates);
 assert.equal(b.memory.receipts.find(r=>r.seq===seq).outcome,undefined);d.dispose();b.dispose();
});

test('invalid physical step cannot desynchronize the shared clocks',()=>{
 const d=new FiniteTemporalDriver(state(),{automatic:false}),before=copy(d.state);
 for(const dt of [0,-1,.5,Infinity,NaN])assert.throws(()=>d.step(dt),/physical step/);
 assert.deepEqual(d.state,before);d.dispose();
});


test('contact cancellation bookkeeping is included in added-decision timing',()=>{
 const s=state(),n=s.npc,predator=s.environment.ecology.animals.find(a=>a.species==='bobcat');
 const near=[{x:n.position.x+18,y:n.position.y},{x:n.position.x-18,y:n.position.y},{x:n.position.x,y:n.position.y+18}].find(p=>canStand(p.x,p.y,'valley'));assert.ok(near);
 // Controlled actual contact, not an autonomous ecological outcome.
 predator.position={...near};Object.assign(predator.physiology,{availableEnergyKcal:10,storedEnergyKcal:0,waterDeficitMl:0,hoursSinceMeal:12});projectPhysiology(predator);
 s.environment.ecology.animals=[predator];s.environment.ecology.plants=[];
 let clock=0,cancellations=0;const d=new FiniteTemporalDriver(s,{now:()=>clock});
 assert.equal(d.submit({type:'wait',seconds:5}),true);
 const capture=d.captureCompletion.bind(d);d.captureCompletion=()=>{
  const contact=d.pending&&!d.npc.active&&d.npc.lastResult?.code==='CONTACT_ESCAPE';
  if(contact){clock+=7;cancellations++;}capture();
 };
 for(let i=0;i<240&&!cancellations;i++)d.step(DT);
 assert.equal(cancellations,1);assert.ok(d.timings.decisions.includes(7));assert.ok(d.npc.memory.experience.some(e=>e.details?.code==='CONTACT_INJURY'));
 assert.equal(d.selector.choices,0);d.dispose();
});
