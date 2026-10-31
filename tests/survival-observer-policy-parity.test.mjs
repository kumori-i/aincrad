import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createOzarkState} from '../src/ozark-save.js';
import {createOzarkWorldGeometry} from '../src/ozark-world-geometry.js';
import {bindOzarkWorldAgent} from '../src/ozark-agent-world.js';
import {bindOzarkEcology} from '../src/ozark-ecology.js';
import {observeNpc} from '../src/npc.js';
import {recordMotorTrail,finishMotorEvidence} from '../src/movement-recovery.js';
import {survivalDecisionSnapshot} from '../src/survival-decision-observer.js';
const source=await readFile(new URL('../src/discovery.js',import.meta.url),'utf8');
const seams=JSON.parse(await readFile(new URL('./fixtures/survival-observer-seams.json',import.meta.url),'utf8'));
const sha=s=>createHash('sha256').update(s).digest('hex');
let original=source;
for(const {before,after} of seams.slice().reverse()){
 assert.equal(original.split(after).length-1,1,'each reverse seam occurs exactly once');original=original.replace(after,before);
}
// The neutral optional motor choice belongs to the policy under comparison in
// both arms; only observer seams are reversed to obtain this exact baseline.
assert.equal(sha(original),'9bf8516e5c00b12e5386672c6f85f7d34d3edf97d3345abbfa50f82256b7da5f','exact pre-observer policy, not a rewritten approximation');
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
// clock advances, policy fitting, outcomes search or native/cohort execution.
const geometryA=createOzarkWorldGeometry(),geometryB=createOzarkWorldGeometry(),template=createOzarkState(geometryA);
for(const n of template.agents){bindOzarkWorldAgent(n,geometryA,template);observeNpc(n,template.environment);}
function clone(geometry){const state=structuredClone(template);bindOzarkEcology(state.environment.ecology,geometry);for(const n of state.agents)bindOzarkWorldAgent(n,geometry,state);return {state,n:state.agents[0]};}
function detached(value){if(!value||typeof value!=='object')return typeof value==='function'?'[function]':value;const out=Array.isArray(value)?[]:{};for(const [k,d] of Object.entries(Object.getOwnPropertyDescriptors(value))){if(k==='length'&&Array.isArray(value))continue;out[k]=Object.hasOwn(d,'value')?detached(d.value):'[accessor]';}return out;}
function held(n,{urgent=false,pending=false,harm=false}={}){const id=Object.keys(n.discovery.observations)[0];assert.ok(id);n.inventory.items=[id];n.discovery.effects=[{objectId:id,effect:harm?'discomfort':'sustained',at:n.elapsed}];n.physiology.satietyHours=urgent?0:.5;n.physiology.hoursSinceMeal=urgent?20:8;if(pending)n.discovery.samplesPending[id]=n.elapsed;return id;}
const scenarios=[
 {name:'optional default',configure:()=>({handlingCuriosity:false})},
 {name:'early thirsty drink',expectedType:'drink',configure:({n})=>{n.physiology.waterDeficitMl=2000;n.flask.water=100;return {handlingCuriosity:false};}},
 {name:'early rest',expectedType:'rest',configure:({n})=>{n.physiology.stamina=5;return {handlingCuriosity:false};}},
 {name:'ordinary held relief',expectedType:'sample',expectedNote:'enter:ordinary-food',configure:({n})=>{held(n);return {handlingCuriosity:false};}},
 {name:'urgent held relief',expectedType:'sample',expectedNote:'enter:urgent-food',configure:({n})=>{held(n,{urgent:true});return {handlingCuriosity:false};}},
 {name:'pending sampling feedback',expectedNote:'sample:feedback-wait',configure:({n})=>{held(n,{pending:true});return {handlingCuriosity:false};}},
 {name:'adverse sampling',expectedNote:'sample:composite-blocked',configure:({n})=>{held(n,{harm:true});return {handlingCuriosity:false};}},
 {name:'learned expired run',expectedNote:'run:missing-or-expired',configure:({n})=>{n.discovery.run={techniqueId:'missing',startedAt:n.elapsed-100,cursor:0,awaiting:false};return {handlingCuriosity:false};}},
 {name:'learned current run',expectedNeed:'food',expectedNotes:['run:action','run:travel'],configure:({n})=>{const id=Object.keys(n.discovery.observations)[0];n.discovery.techniques=[{id:'fixture-technique',sourceId:id,confidence:'supported',successes:1,failures:0,steps:[{type:'inspect_object',targetId:'$source'}]}];n.discovery.run={techniqueId:'fixture-technique',startedAt:n.elapsed,cursor:0,awaiting:false};return {handlingCuriosity:false};}},
 {name:'ordinary food at held capacity',expectedPhase:['ordinaryFood','entered'],absentNote:'food:ordinary-candidates',configure:({n})=>{n.inventory.items=Object.keys(n.discovery.observations).slice(0,4);assert.equal(n.inventory.items.length,4);n.physiology.satietyHours=.5;return {handlingCuriosity:false};}},
 {name:'learned source without observed route',expectedNote:'run:route-missing',configure:({n})=>{const id=Object.keys(n.discovery.observations)[0];n.discovery.observations[id].position={x:n.position.x+500,y:n.position.y};n.memory.cells={};n.discovery.techniques=[{id:'fixture-route',sourceId:id,confidence:'supported',successes:1,failures:0,steps:[{type:'inspect_object',targetId:'$source'}]}];n.discovery.run={techniqueId:'fixture-route',startedAt:n.elapsed,cursor:0,awaiting:false};return {handlingCuriosity:false};}},
 // Deliberately supplied UNIT motor evidence, not a claim of a paid walk/native
 // run. The actual recoveryChoice implementation must perform the substitution.
 {name:'actual recovery substitution from synthetic motor evidence',expectedType:'move',expectedNeed:'understanding',recovery:true,configure:({n})=>{const before={x:n.position.x-16,y:n.position.y},active={request:{type:'move'}},event={id:999,type:'action',at:n.elapsed,details:{result:{code:'ROUTE_BLOCKED'}}};recordMotorTrail(n,active,before,{distance:16,waterSeconds:0,driftDistance:0});n.memory.experience.push(event);finishMotorEvidence(n,active,event);return {handlingCuriosity:false,optionalAction:()=>({type:'move',target:{x:n.position.x+80,y:n.position.y}})};}},
 {name:'original optional callback exception',throws:true,configure:(_f,track)=>({handlingCuriosity:false,optionalAction(){track.optional++;throw new TypeError('original optional callback exception');}})},
 {name:'returned action type accessor',configure:(_f,track)=>({handlingCuriosity:false,optionalAction(){track.optional++;return {get type(){track.getter++;return 'wait';},seconds:2};}})},
 {name:'original action accessor exception',throws:true,configure:(_f,track)=>({handlingCuriosity:false,optionalAction(){track.optional++;return {get type(){track.getter++;throw new RangeError('original action accessor exception');}};}})},
];
function execute(module,scenario,geometry){const f=clone(geometry),track={optional:0,getter:0},options=scenario.configure(f,track);let result,error=null;try{result=module.discoveryDecision(f.n,options);}catch(e){error={name:e.name,message:e.message};}return {value:{result:detached(result),error,state:detached(f.state),track},n:f.n};}
for(const scenario of scenarios)test(`observer parity: ${scenario.name}`,()=>{
 const expected=execute(baseline,scenario,geometryA);if(scenario.throws)assert.ok(expected.value.error);else assert.equal(expected.value.error,null);if(scenario.expectedType)assert.equal(expected.value.result.action.type,scenario.expectedType,'declared fixture reaches intended return');if(scenario.expectedNeed)assert.equal(expected.value.result.need,scenario.expectedNeed);if(scenario.recovery)assert.equal(expected.value.result.action.duration,.75,'real recoveryChoice replaces requested action');
 for(const variant of [{name:'enabled',module:enabled},...failures]){const actual=execute(variant.module,scenario,geometryB);assert.deepEqual(actual.value,expected.value,variant.name+' preserves complete result/error/actor/ecology/RNG and getter reads');if(variant.name==='enabled'){const audit=survivalDecisionSnapshot(actual.n);assert.equal(audit.active,false,'finally closes observer on every return/error');if(scenario.expectedNote)assert.ok(audit.records.at(-1).notes.some(n=>n.code===scenario.expectedNote),'declared fixture reaches '+scenario.expectedNote);const r=audit.records.at(-1);if(scenario.expectedNotes)assert.ok(r.notes.some(n=>scenario.expectedNotes.includes(n.code)),'actual learned-run step');if(scenario.expectedPhase)assert.equal(r.phases[scenario.expectedPhase[0]],scenario.expectedPhase[1]);if(scenario.absentNote)assert.ok(!r.notes.some(n=>n.code===scenario.absentNote),'unvisited candidate filter not counted');if(scenario.recovery){assert.equal(r.requestedType,'move');assert.equal(r.actualType,'move');assert.equal(r.requestedNeed,'understanding');assert.equal(r.actualNeed,'understanding');}}}
});
test('every injected observer boundary was actually reached by the fixed parity matrix',()=>{for(const f of failures)assert.ok(f.shim.hits()>0,f.name);});
test('failed observer snapshot cannot perturb future choice or state',()=>{
 const left=clone(geometryA),right=clone(geometryB);assert.deepEqual(enabled.discoveryDecision(left.n,{handlingCuriosity:false}),enabled.discoveryDecision(right.n,{handlingCuriosity:false}));const proxy=new Proxy(right.n,{getPrototypeOf(){throw Error('snapshot-only failure');}});assert.equal(survivalDecisionSnapshot(proxy),null);assert.deepEqual(enabled.discoveryDecision(left.n,{handlingCuriosity:false}),enabled.discoveryDecision(right.n,{handlingCuriosity:false}));assert.deepEqual(left.state,right.state);
});
