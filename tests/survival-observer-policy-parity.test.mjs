import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createOzarkState} from '../src/ozark-save.js';
import {createOzarkWorldGeometry} from '../src/ozark-world-geometry.js';
import {bindOzarkWorldAgent} from '../src/ozark-agent-world.js';
import {bindOzarkEcology} from '../src/ozark-ecology.js';
import {observeNpc,requestNpcAction,tickNpc} from '../src/npc.js';
import {ingestMaterial,projectPhysiology} from '../src/biology.js';
import {recordMotorTrail,finishMotorEvidence} from '../src/movement-recovery.js';
import {survivalDecisionSnapshot} from '../src/survival-decision-observer.js';
import {CONFIG} from '../src/config.js';
import {lookupEcologyObject} from '../src/ecology.js';
import {processDiscoveryFeedback} from '../src/discovery.js';
const source=await readFile(new URL('../src/discovery.js',import.meta.url),'utf8');
const seams=JSON.parse(await readFile(new URL('./fixtures/survival-observer-seams.json',import.meta.url),'utf8'));
// Preserve the frozen seam fixture. The new policy sits between an observer
// note and its historical loop context; retain that policy in BOTH arms.
const capacityContext="\n    const approach=capacityApproach(npc,candidates);\n    if(approach)return wrap(approach,'I can carry my possessions toward a remembered method that brought relief, then reconsider space only when its source is nearby.','food');";
const capacitySeams=seams.filter(seam=>seam.after.includes('food:ordinary-candidates'));
assert.equal(capacitySeams.length,1,'one historical ordinary-candidate observer seam');
for(const seam of capacitySeams){
 assert.equal(seam.before,'\n    for(const technique of candidates){\n','exact frozen pre-observer loop context');
 assert.equal(seam.after.split('\n    for(').length-1,1,'one loop context to expand');
 seam.before=capacityContext+seam.before;
 seam.after=seam.after.replace('\n    for(',capacityContext+'\n    for(');
 assert.equal(seam.before.split(capacityContext).length-1,1);
 assert.equal(seam.after.split(capacityContext).length-1,1);
 assert.equal(source.split(seam.after).length-1,1,'one expanded seam in current source');
}
// Intent tracking is current policy, not an observer seam. Preserve it in
// both reconstructed arms without editing the historical seam fixture.
const intentSeams=seams.filter(seam=>seam.before==='const d=memory(npc),run=d.run;if(!run)return null;');
assert.equal(intentSeams.length,1,'one historical learned-run admission seam');
for(const seam of intentSeams){
 const context='const d=memory(npc),run=d.run;';
 assert.equal(seam.before.split(context).length-1,1);
 assert.equal(seam.after.split(context).length-1,1);
 seam.before=seam.before.replace(context,context+'intendProcedure(npc,run);');
 seam.after=seam.after.replace(context,context+'intendProcedure(npc,run);');
}
assert.ok(seams.some(s=>s.after.includes('markFoodRunChoice')),
  'food-run observation seams remain in the exact policy reconstruction');
const sha=s=>createHash('sha256').update(s).digest('hex');
let original=source;
for(const {before,after} of seams.slice().reverse()){
 assert.equal(original.split(after).length-1,1,'each reverse seam occurs exactly once');original=original.replace(after,before);
}
// Both arms retain the same current policy, including the bounded remembered
// route detour, urgent pending-source guard, receipt-grounded drink retry and
// custody-grounded capacity release/approach and personal procedure ordering.
// The private procedure state and bounded producer-retest inquiry remain
// identical current-policy dependencies in both observer arms.
// This intentional policy change
// remains present in both observer arms.
// Reverse only the survival and food-run observer seams. This
// source pin changes when an intentional policy change changes both arms; the
// frozen closer-choice oracle remains in lazy-route-admission.test.mjs.
// Same-source motor recall is policy authority, retained in BOTH imports below.
// Its exact added import/decision block is removed only to prove historical ancestry.
const motorImport="import {motorRecallExperiment,MOTOR_RECALL_REASON} from './motor-recall.js';\n";
const motorDecision="  const recall=handlingCuriosity&&motorRecallExperiment(npc,{body,local:id=>localMethodSource(npc,id),blocked:(type,id)=>recentlyFailed(npc,type,id)||availabilityBlocked(npc,type,id)});\n  if(recall)return wrap(recall,MOTOR_RECALL_REASON);\n";
const handlingAnchor='  if(handling)return wrap(handling,HANDLING_QUESTION);\n';
assert.equal(original.split(motorImport).length-1,1,'one motor policy import');
assert.equal(original.split(motorDecision).length-1,1,'one motor policy decision block');
assert.equal(original.split(handlingAnchor).length-1,1,'one exact restoration anchor');
const historical=original.replace(motorImport,'').replace(motorDecision,'');
assert.equal(motorImport+historical.replace(handlingAnchor,handlingAnchor+motorDecision),original,'exact motor policy seam roundtrip');
assert.equal(sha(historical),'a6877e6d3b19c04ce6a375f96debbb2eb5dabe7b5c5e7220578fa75506a8a7a1','unchanged historical observer-free policy before motor recall');
assert.equal(sha(original),'a1de1467d7375a87d44ee7e2ca13dbf3a32ac6c5e9817cb9683dd02a437d9918','exact current policy with observer seams reversed, not a rewritten approximation');
let reapplied=original;for(const {before,after} of seams){assert.equal(reapplied.split(before).length-1,1);reapplied=reapplied.replace(before,after);}assert.equal(reapplied,source);
function url(s){return `data:text/javascript;base64,${Buffer.from(s).toString('base64')}`;}
function absolute(s){return s.replace(/from '(\.\/[^']+)'/g,(_,p)=>`from '${new URL(`../src/${p.slice(2)}`,import.meta.url).href}'`);}
const baseline=await import(url(absolute(original))),enabled=await import(url(absolute(source)));
const observerUrl=new URL('../src/survival-decision-observer.js',import.meta.url).href;
const exports=['beginSurvivalDecision','noteSurvivalDecision','noteCurrentSurvivalDecision','finishSurvivalDecision','closeSurvivalDecision'];
const failures=[];
for(const broken of exports){
 const shimSource=`import * as real from '${observerUrl}';let calls=0;export const hits=()=>calls;${exports.map(name=>`export function ${name}(...args){${name===broken?"calls++;throw new Error('injected observer failure');":`return real.${name}(...args);`}}`).join('\n')}`;
 const shim=await import(url(shimSource));
 const replacement=url(shimSource),needle="'./survival-decision-observer.js'";assert.equal(source.split(needle).length-1,1);
 const module=await import(url(absolute(source.replace(needle,JSON.stringify(replacement)))));failures.push({name:broken,module,shim});
}
// Independent actor/ecology clones and distinct geometry instances. No simulation
// clock advances in the original matrix, policy fitting, outcomes search or
// native/cohort execution. The added capacity fixture explicitly pays work.
const geometryA=createOzarkWorldGeometry(),geometryB=createOzarkWorldGeometry(),template=createOzarkState(geometryA);
for(const n of template.agents){bindOzarkWorldAgent(n,geometryA,template);observeNpc(n,template.environment);}
function clone(geometry,input=template){const state=structuredClone(input);bindOzarkEcology(state.environment.ecology,geometry);for(const n of state.agents)bindOzarkWorldAgent(n,geometry,state);return {state,n:state.agents[0]};}
function detached(value){if(!value||typeof value!=='object')return typeof value==='function'?'[function]':value;const out=Array.isArray(value)?[]:{};for(const [k,d] of Object.entries(Object.getOwnPropertyDescriptors(value))){if(k==='length'&&Array.isArray(value))continue;out[k]=Object.hasOwn(d,'value')?detached(d.value):'[accessor]';}return out;}
function held(n,{urgent=false,pending=false,harm=false}={}){const id=Object.keys(n.discovery.observations)[0];assert.ok(id);n.inventory.items=[id];n.discovery.effects=[{objectId:id,effect:harm?'discomfort':'sustained',at:n.elapsed}];n.physiology.satietyHours=urgent?0:.5;n.physiology.hoursSinceMeal=urgent?20:8;if(pending)n.discovery.samplesPending[id]=n.elapsed;return id;}
// Authored engineering setup, with a real admission refusal and its canonical
// action receipt. No hand-written failure record, learned outcome or slot oracle
// is supplied to policy. Advancing elapsed here tests the exact retry boundary,
// not a naturally evolved digestion interval.
function refusedDrink({n,state},{urgent=false,age=0}={}){
 n.physiology.waterDeficitMl=urgent?3500:500;n.flask.water=1;
 for(let i=0;i<24;i++)assert.equal(ingestMaterial(n,{massGrams:1,energyKcal:0,waterMl:0,digestHours:24},{source:'authored observer parity fixture'}).ok,true);
 projectPhysiology(n);assert.equal(requestNpcAction(n,{type:'drink'},state.environment).code,'TOO_FULL');
 n.elapsed+=age;return {handlingCuriosity:false};
}
// Authored bounded encounter; supplied positions/appetite, real paid actions
// and delayed effects. This is not an ordinary cohort or frozen science oracle.
let capacityPrepared;
const capacityFixture=()=>capacityPrepared||=(buildCapacity());
function attach(state) {
  const n=state.agents[0],env=state.environment;
  bindOzarkEcology(env.ecology,geometryA);
  for(const actor of state.agents)bindOzarkWorldAgent(actor,geometryA,state);
  const clock=()=>{state.elapsed=env.elapsed=env.ecology.elapsed=env.elapsed+.1;};
  const tick=()=>{clock();for(const actor of state.agents)tickNpc(actor,.1,env);processDiscoveryFeedback(n);};
  const settle=()=>{for(let i=0;n.active&&i<400;i++)tick();assert.equal(n.active,null);return n.lastResult;};
  const pay=action=>{assert.equal(requestNpcAction(n,action,env).code,'ACTION_STARTED',JSON.stringify(action));const result=settle();assert.equal(result.ok,true,JSON.stringify(result));return result;};
  const until=predicate=>{for(let i=0;!predicate()&&i<1500;i++)tick();assert.ok(predicate(),'personal delayed effect is required');};
  const at=id=>{const p=lookupEcologyObject(env.ecology,id);n.position={x:p.position.x+45,y:p.position.y};observeNpc(n,env);};
  const appetite=(hours=20)=>{n.physiology.hoursSinceMeal=hours;n.physiology.satietyHours=0;n.physiology.waterDeficitMl=0;projectPhysiology(n);};
  return {state,n,env,clock,tick,settle,pay,until,at,appetite};
}

function buildCapacity(){
const state=createOzarkState(geometryA,{communicationSeed:211});
state.elapsed=state.environment.elapsed=state.environment.ecology.elapsed=60;
for(const [i,n] of state.agents.entries()){n.elapsed=60;n.rng=211+i;}
const f=attach(state),trees=f.env.ecology.plants.filter(p=>p.kind==='apple_tree'&&p.quantity>5);
let good,bystander;
outer:for(const a of trees)for(const b of trees){const gap=Math.hypot(a.position.x-b.position.x,a.position.y-b.position.y);
 if(gap>120&&gap<260&&[a,b].every(p=>geometryA.canOccupy(p.position.x+45,p.position.y,CONFIG.playerRadius)&&geometryA.lineOfSight({x:p.position.x+45,y:p.position.y},p.position))){good=a.id;bystander=b.id;break outer;}}
assert.ok(good);f.at(good);
const positive=f.pay({type:'pull',targetId:good}).materialId;
f.pay({type:'sample',targetId:positive});
f.until(()=>f.n.discovery.effects.some(e=>e.objectId===positive&&e.effect==='sustained'));
f.appetite();

// Explicit fixture-controlled release, not an autonomous disposal decision.
f.pay({type:'release',targetId:positive});
f.at(bystander);const unknown=[];for(let i=0;i<4;i++)unknown.push(f.pay({type:'pull',targetId:bystander}).materialId);
f.pay({type:'sample',targetId:unknown[0]});
f.at(good);f.appetite();
assert.equal(f.n.inventory.items.length,4);


return {state:structuredClone(f.state),good,unknown,positive};}

function capacityConfigure(f,{distant=false}={}){
 if(distant){const source=lookupEcologyObject(f.state.environment.ecology,capacityFixture().good);f.n.position={x:source.position.x+160,y:source.position.y};}
 f.n.physiology.hoursSinceMeal=10;f.n.physiology.satietyHours=0;projectPhysiology(f.n);
 f.freshCapacityObjects=observeNpc(f.n,f.state.environment).objects;return {handlingCuriosity:false};
}
const scenarios=[
 {name:'real earned capacity local release',capacity:true,expectedType:'release',expectedNeed:'food',configure:f=>capacityConfigure(f)},
 {name:'real earned capacity carried approach',capacity:true,expectedType:'move',expectedNeed:'food',configure:f=>capacityConfigure(f,{distant:true})},
 {name:'optional default',configure:()=>({handlingCuriosity:false})},
 {name:'early thirsty drink',expectedType:'drink',configure:({n})=>{n.physiology.waterDeficitMl=2000;n.flask.water=100;return {handlingCuriosity:false};}},
 {name:'actual drink refusal waits',expectedType:'wait',expectedNeed:'water',configure:f=>refusedDrink(f)},
 {name:'actual drink refusal normal expiry permits retry',expectedType:'drink',configure:f=>refusedDrink(f,{age:10})},
 {name:'actual drink refusal urgent interval remains bounded',expectedType:'wait',expectedNeed:'water',configure:f=>refusedDrink(f,{urgent:true,age:1.99})},
 {name:'actual drink refusal urgent expiry permits retry',expectedType:'drink',configure:f=>refusedDrink(f,{urgent:true,age:2})},
 {name:'early rest',expectedType:'rest',configure:({n})=>{n.physiology.stamina=5;return {handlingCuriosity:false};}},
 {name:'ordinary held relief',expectedType:'sample',expectedNote:'enter:ordinary-food',configure:({n})=>{held(n);return {handlingCuriosity:false};}},
 {name:'urgent held relief',expectedType:'sample',expectedNote:'enter:urgent-food',configure:({n})=>{held(n,{urgent:true});return {handlingCuriosity:false};}},
 {name:'pending sampling feedback',expectedNote:'sample:feedback-wait',configure:({n})=>{held(n,{pending:true});return {handlingCuriosity:false};}},
 {name:'adverse sampling',expectedNote:'sample:composite-blocked',configure:({n})=>{held(n,{harm:true});return {handlingCuriosity:false};}},
 {name:'learned expired run',expectedNote:'run:missing-or-expired',configure:({n})=>{n.discovery.run={techniqueId:'missing',startedAt:n.elapsed-100,cursor:0,awaiting:false};return {handlingCuriosity:false};}},
 {name:'learned current run',expectedNeed:'food',expectedNotes:['run:action','run:travel'],configure:({n})=>{const id=Object.keys(n.discovery.observations)[0];n.discovery.techniques=[{id:'fixture-technique',sourceId:id,confidence:'supported',successes:1,failures:0,steps:[{type:'inspect_object',targetId:'$source'}]}];n.discovery.run={techniqueId:'fixture-technique',startedAt:n.elapsed,cursor:0,awaiting:false};return {handlingCuriosity:false};}},
 {name:'learned run loses its own source observation',expectedNote:'run:missing-or-expired',configure:({n})=>{const id=Object.keys(n.discovery.observations)[0];n.discovery.techniques=[{id:'fixture-unseen',sourceId:id,confidence:'supported',successes:1,failures:0,steps:[{type:'inspect_object',targetId:'$source'}]}];n.discovery.run={techniqueId:'fixture-unseen',startedAt:n.elapsed,cursor:0,awaiting:false};delete n.discovery.observations[id];return {handlingCuriosity:false};}},
 {name:'ordinary food at held capacity',expectedPhase:['ordinaryFood','entered'],expectedNote:'food:ordinary-candidates',configure:({n})=>{n.inventory.items=Object.keys(n.discovery.observations).slice(0,4);assert.equal(n.inventory.items.length,4);n.physiology.satietyHours=.5;return {handlingCuriosity:false};}},
 {name:'learned source without observed route',expectedNote:'run:route-missing',configure:({n})=>{const id=Object.keys(n.discovery.observations)[0];n.discovery.observations[id].position={x:n.position.x+500,y:n.position.y};n.memory.cells={};n.discovery.techniques=[{id:'fixture-route',sourceId:id,confidence:'supported',successes:1,failures:0,steps:[{type:'inspect_object',targetId:'$source'}]}];n.discovery.run={techniqueId:'fixture-route',startedAt:n.elapsed,cursor:0,awaiting:false};return {handlingCuriosity:false};}},
 // Deliberately supplied UNIT motor evidence, not a claim of a paid walk/native
 // run. The actual recoveryChoice implementation must perform the substitution.
 {name:'actual recovery substitution from synthetic motor evidence',expectedType:'move',expectedNeed:'understanding',recovery:true,configure:({n})=>{const before={x:n.position.x-16,y:n.position.y},active={request:{type:'move'}},event={id:999,type:'action',at:n.elapsed,details:{result:{code:'ROUTE_BLOCKED'}}};recordMotorTrail(n,active,before,{distance:16,waterSeconds:0,driftDistance:0});n.memory.experience.push(event);finishMotorEvidence(n,active,event);return {handlingCuriosity:false,optionalAction:()=>({type:'move',target:{x:n.position.x+80,y:n.position.y}})};}},
 {name:'original optional callback exception',throws:true,configure:(_f,track)=>({handlingCuriosity:false,optionalAction(){track.optional++;throw new TypeError('original optional callback exception');}})},
 {name:'returned action type accessor',configure:(_f,track)=>({handlingCuriosity:false,optionalAction(){track.optional++;return {get type(){track.getter++;return 'wait';},seconds:2};}})},
 {name:'original action accessor exception',throws:true,configure:(_f,track)=>({handlingCuriosity:false,optionalAction(){track.optional++;return {get type(){track.getter++;throw new RangeError('original action accessor exception');}};}})},
];
function execute(module,scenario,geometry){const f=clone(geometry,scenario.capacity?capacityFixture().state:template),track={optional:0,getter:0},options=scenario.configure(f,track);
 // Each dynamic variant owns an independent sensory WeakMap. Forward only
 // the exact object array returned by actual perception, not retained rows
 // whose timestamps may match an earlier position at the same clock tick.
 if(scenario.capacity){assert.ok(Array.isArray(f.freshCapacityObjects));for(const o of f.freshCapacityObjects)module.rememberDirectDiscoveryObject(f.n,o);}
 let result,error=null;try{result=module.discoveryDecision(f.n,options);}catch(e){error={name:e.name,message:e.message};}return {value:{result:detached(result),error,state:detached(f.state),track},n:f.n};}
for(const scenario of scenarios)test(`observer parity: ${scenario.name}`,()=>{
 const expected=execute(baseline,scenario,geometryA);if(scenario.throws)assert.ok(expected.value.error);else assert.equal(expected.value.error,null);if(scenario.expectedType)assert.equal(expected.value.result.action.type,scenario.expectedType,'declared fixture reaches intended return');if(scenario.expectedNeed)assert.equal(expected.value.result.need,scenario.expectedNeed);if(scenario.recovery)assert.equal(expected.value.result.action.duration,.75,'real recoveryChoice replaces requested action');
 for(const variant of [{name:'enabled',module:enabled},...failures]){const actual=execute(variant.module,scenario,geometryB);assert.deepEqual(actual.value,expected.value,variant.name+' preserves complete result/error/actor/ecology/RNG and getter reads');if(variant.name==='enabled'){const audit=survivalDecisionSnapshot(actual.n);assert.equal(audit.active,false,'finally closes observer on every return/error');if(scenario.expectedNote)assert.ok(audit.records.at(-1).notes.some(n=>n.code===scenario.expectedNote),'declared fixture reaches '+scenario.expectedNote);const r=audit.records.at(-1);if(scenario.expectedNotes)assert.ok(r.notes.some(n=>scenario.expectedNotes.includes(n.code)),'actual learned-run step');if(scenario.expectedPhase)assert.equal(r.phases[scenario.expectedPhase[0]],scenario.expectedPhase[1]);if(scenario.absentNote)assert.ok(!r.notes.some(n=>n.code===scenario.absentNote),'unvisited candidate filter not counted');if(scenario.recovery){assert.equal(r.requestedType,'move');assert.equal(r.actualType,'move');assert.equal(r.requestedNeed,'understanding');assert.equal(r.actualNeed,'understanding');}}}
});
test('every injected observer boundary was actually reached by the fixed parity matrix',()=>{for(const f of failures)assert.ok(f.shim.hits()>0,f.name);});
test('failed observer snapshot cannot perturb future choice or state',()=>{
 const left=clone(geometryA),right=clone(geometryB);assert.deepEqual(enabled.discoveryDecision(left.n,{handlingCuriosity:false}),enabled.discoveryDecision(right.n,{handlingCuriosity:false}));const proxy=new Proxy(right.n,{getPrototypeOf(){throw Error('snapshot-only failure');}});assert.equal(survivalDecisionSnapshot(proxy),null);assert.deepEqual(enabled.discoveryDecision(left.n,{handlingCuriosity:false}),enabled.discoveryDecision(right.n,{handlingCuriosity:false}));assert.deepEqual(left.state,right.state);
});
