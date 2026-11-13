import test from 'node:test';
import assert from 'node:assert/strict';
import {PopulationRuntime} from '../src/population.js';
import {createOzarkState,writeOzarkSave,loadOzarkSave,getOzarkSaveFailure,getOzarkSaveValidationFailure,OZARK_SAVE_KEY} from '../src/ozark-save.js';
import {createOzarkWorldGeometry} from '../src/ozark-world-geometry.js';
import {bindOzarkWorldAgent} from '../src/ozark-agent-world.js';
import {bindOzarkEcology} from '../src/ozark-ecology.js';
import {requestNpcAction} from '../src/npc.js';
import {hasActionProvenance,enableActionProvenance,beginActionRequest,endActionRequest,recordActionCompletion,drainActionProvenance,disposeActionProvenance} from '../src/action-provenance-observer.js';
const geometry=createOzarkWorldGeometry();
function make(template=createOzarkState(geometry,{communicationSeed:211})){
 const state=structuredClone(template);state.npc=state.agents[0];bindOzarkEcology(state.environment.ecology,geometry);for(const n of state.agents)bindOzarkWorldAgent(n,geometry,state);
 return {state,runtime:new PopulationRuntime(state,{cardinal:false})};
}
function disk(){const values=new Map();return {getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};}
test('runtime default is off; explicit start/drain/stop does not change state',()=>{
 const {state,runtime}=make();assert.equal(runtime.drainActionCapture(),null);assert.ok(state.agents.every(n=>!hasActionProvenance(n)));const before=structuredClone(state);
 runtime.startActionCapture();assert.deepEqual(state,before);assert.throws(()=>runtime.startActionCapture(),/already/);const rows=runtime.drainActionCapture();assert.equal(rows.length,2);assert.ok(rows.every(r=>r.capture.rows.length===0));assert.equal(runtime.stopActionCapture().length,2);assert.equal(runtime.stopActionCapture(),null);assert.deepEqual(state,before);runtime.dispose();
});
test('dispose removes owned capture and prevents restart, without saving final payload',()=>{
 const {state,runtime}=make();runtime.startActionCapture();requestNpcAction(state.agents[0],{type:'wait',seconds:1},state.environment);runtime.dispose();assert.ok(state.agents.every(n=>!hasActionProvenance(n)));assert.equal(runtime.drainActionCapture(),null);assert.throws(()=>runtime.startActionCapture(),/disposed/);runtime.dispose();
});
test('ownership conflict and stale session cleanup never steal external captures',()=>{
 const {state,runtime}=make(),n=state.agents[1];enableActionProvenance(n);assert.throws(()=>runtime.startActionCapture(),/owned/);assert.equal(hasActionProvenance(state.agents[0]),false);disposeActionProvenance(n);runtime.startActionCapture();disposeActionProvenance(n);const replacement=enableActionProvenance(n);const stopped=runtime.stopActionCapture();assert.equal(stopped[1].capture,null);assert.equal(hasActionProvenance(n),true);runtime.dispose();assert.equal(hasActionProvenance(n),true);disposeActionProvenance(n,replacement);
});
test('invalid options leave every actor disabled',()=>{const {state,runtime}=make();assert.throws(()=>runtime.startActionCapture({capacity:0}),/capacity/);assert.ok(state.agents.every(n=>!hasActionProvenance(n)));runtime.dispose();});
test('privacy projection does not retain text, images, arbitrary nested payloads or getters',()=>{
 const n={id:'aster',epoch:0,elapsed:0,scene:'valley',position:{x:1,y:2},active:null};enableActionProvenance(n);const scope=beginActionRequest(n,{secret:'PRIVATE'});let reads=0;
 const request={type:'move',target:{x:3,y:4,caption:'PRIVATE'},text:'PRIVATE',pixels:[1,2],get duration(){reads++;throw Error('getter');}};
 const active=n.active={request,route:[request.target],index:0};endActionRequest(n,scope,{ok:true,code:'STARTED',text:'PRIVATE',nested:{password:'PRIVATE'}});n.active=null;
 recordActionCompletion(n,active,request,{ok:true,code:'ARRIVED',trajectory:[{secret:'PRIVATE'}]}, {id:9});const capture=drainActionProvenance(n);assert.equal(reads,0);assert.equal(JSON.stringify(capture).includes('PRIVATE'),false);assert.deepEqual(capture.rows.at(-1).request.target,{x:3,y:4});disposeActionProvenance(n);
});
test('save bytes and reopened capture state are identical with diagnostics enabled',()=>{
 const da=disk(),db=disk(),seed=createOzarkState(geometry);assert.equal(writeOzarkSave(da,seed,geometry),true);db.setItem(OZARK_SAVE_KEY,da.getItem(OZARK_SAVE_KEY));
 const sa=loadOzarkSave(da,geometry).state,sb=loadOzarkSave(db,geometry).state;for(const state of [sa,sb]){bindOzarkEcology(state.environment.ecology,geometry);for(const n of state.agents)bindOzarkWorldAgent(n,geometry,state);}const a={state:sa,runtime:new PopulationRuntime(sa,{cardinal:false})},b={state:sb,runtime:new PopulationRuntime(sb,{cardinal:false})};a.runtime.startActionCapture();
 for(const pair of [a,b])assert.equal(requestNpcAction(pair.state.agents[0],{type:'wait',seconds:5},pair.state.environment).code,'STARTED');
 for(let i=0;i<60;i++){for(const pair of [a,b]){pair.state.elapsed+=1/60;pair.runtime.tick(1/60);}assert.deepEqual(a.state,b.state);}
 assert.equal(writeOzarkSave(da,a.state,geometry),true,JSON.stringify([getOzarkSaveFailure(a.state),getOzarkSaveValidationFailure(a.state)]));assert.equal(writeOzarkSave(db,b.state,geometry),true);assert.equal(da.getItem(OZARK_SAVE_KEY),db.getItem(OZARK_SAVE_KEY));const capture=a.runtime.drainActionCapture()[0].capture;assert.ok(capture.rows.length>0);assert.ok(capture.activeToken);
 const opened=loadOzarkSave(da,geometry);assert.equal(opened.blocked,false);assert.ok(opened.state.agents.every(n=>!hasActionProvenance(n)));assert.equal(/capture-|actionProvenance|actionCaptures/.test(da.getItem(OZARK_SAVE_KEY)),false);a.runtime.dispose();b.runtime.dispose();
});
test('short full-population lifecycle capture preserves exact state and RNG each tick',()=>{
 const a=make(),b=make(a.state);a.runtime.startActionCapture();for(let i=0;i<120;i++){for(const pair of [a,b]){pair.state.elapsed+=1/60;pair.runtime.tick(1/60);}assert.deepEqual(a.state,b.state);for(const row of a.runtime.drainActionCapture()){assert.equal(row.capture.counters.errors,0);assert.equal(row.capture.counters.dropped,0);}}
 const before=structuredClone(a.state);a.runtime.stopActionCapture();assert.deepEqual(a.state,before);a.runtime.dispose();b.runtime.dispose();
});
test('disabled request path does not clone observer data',()=>{
 const {state,runtime}=make(),original=globalThis.structuredClone;globalThis.structuredClone=()=>{throw Error('observer clone unexpectedly called');};
 try{assert.equal(requestNpcAction(state.agents[0],{type:'wait',seconds:1},state.environment).code,'STARTED');}finally{globalThis.structuredClone=original;runtime.dispose();}
});
