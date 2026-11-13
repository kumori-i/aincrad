import test from 'node:test';
import assert from 'node:assert/strict';
import {deferDrinkRetry} from '../src/ingestion-retry.js';
import {createOzarkState} from '../src/ozark-save.js';
import {createOzarkWorldGeometry} from '../src/ozark-world-geometry.js';
import {bindOzarkWorldAgent} from '../src/ozark-agent-world.js';
import {bindOzarkEcology} from '../src/ozark-ecology.js';
import {requestNpcAction,observeNpc} from '../src/npc.js';
import {discoveryDecision,contactEscape} from '../src/discovery.js';
import {ingestMaterial,projectPhysiology} from '../src/biology.js';
import {recordEvent} from '../src/npc-memory.js';
const refusal=(id=1)=>({id,type:'action',at:10,details:{action:{type:'drink'},result:{ok:false,code:'TOO_FULL'}}});
function fixture(position){
 const geometry=createOzarkWorldGeometry(),state=createOzarkState(geometry,{communicationSeed:211}),n=state.agents[0];
 if(position)n.position={...position};n.physiology.waterDeficitMl=500;n.flask.water=1;
 for(let i=0;i<24;i++)assert.equal(ingestMaterial(n,{massGrams:1,energyKcal:0,waterMl:0,digestHours:24},{source:'authored safety fixture'}).ok,true);
 bindOzarkWorldAgent(n,geometry,state);projectPhysiology(n);observeNpc(n,state.environment);
 assert.equal(requestNpcAction(n,{type:'drink'},state.environment).code,'TOO_FULL');return {n,state,geometry};
}
test('missing or compacted refusal proof permits reassessment; later different drink supersedes',()=>{
 assert.equal(deferDrinkRetry([],11,'dry mouth'),false);
 const e=refusal(),other={id:2,type:'action',at:11,details:{action:{type:'drink'},result:{ok:false,code:'EMPTY_FLASK'}}};
 assert.equal(deferDrinkRetry([e,other],11,'dry mouth'),false);
 assert.equal(deferDrinkRetry([{id:2,type:'action',at:11,details:{action:{type:'inspect_object'},result:{ok:true}}}],11,'dry mouth'),false);
 assert.equal(deferDrinkRetry([e],9,'dry mouth'),false);
});
test('receipt helper is read-only and has no actor or physiology input',()=>{
 const e=Object.freeze({id:1,type:'action',at:10,details:Object.freeze({action:Object.freeze({type:'drink'}),result:Object.freeze({ok:false,code:'TOO_FULL'})})});
 const rows=Object.freeze([e]);assert.equal(deferDrinkRetry(rows,11,'dry mouth'),true);assert.equal(deferDrinkRetry(rows,20,'dry mouth'),false);
 const {n}=fixture(),rng=n.rng,before=structuredClone(n.physiology);assert.equal(discoveryDecision(n).action.type,'wait');assert.equal(n.rng,rng);assert.deepEqual(n.physiology,before);
});
test('epoch change alone does not erase retained bodily refusal, proof removal does',()=>{
 const {n}=fixture();n.epoch++;assert.equal(discoveryDecision(n).action.type,'wait');
 n.memory.experience=n.memory.experience.filter(e=>!(e.type==='action'&&e.details?.action?.type==='drink'));
 assert.equal(discoveryDecision(n).action.type,'drink');
});
test('experienced contact escape takes precedence over deferred drinking',()=>{
 const {n}=fixture();recordEvent(n,'condition',{code:'CONTACT_INJURY',provenance:'experienced contact',scene:n.scene,sourceId:'object:674',sourcePosition:{x:n.position.x-30,y:n.position.y}});
 const escape=contactEscape(n);assert.ok(escape,'authored contact requires an observed route');const d=discoveryDecision(n);assert.equal(d.need,'safety');assert.deepEqual(d.action,escape.action);
});
test('authored nearby refuge and cave exit selections precede deferred waiting',()=>{
 const {n}=fixture();n.thermal.hot=80;n.memory.shelters={fixture:{id:'fixture',x:n.position.x,y:n.position.y}};
 assert.equal(discoveryDecision(n).action.type,'enter_shelter');
 n.thermal.hot=0;n.scene='fixture-cave';n.memory.caveExits[n.scene]={...n.position};
 assert.equal(discoveryDecision(n).action.type,'exit_shelter');
});
test('actual observed deep-water terrain escape precedes deferred waiting',()=>{
 const {n}=fixture({x:-1200,y:220});const d=discoveryDecision(n);assert.equal(d.need,'safety');assert.notEqual(d.action.type,'wait');assert.notEqual(d.action.type,'drink');
});
