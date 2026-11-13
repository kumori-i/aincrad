import test from 'node:test';
import assert from 'node:assert/strict';
import {deferDrinkRetry} from '../src/ingestion-retry.js';
import {createOzarkState} from '../src/ozark-save.js';
import {createOzarkWorldGeometry} from '../src/ozark-world-geometry.js';
import {bindOzarkWorldAgent} from '../src/ozark-agent-world.js';
import {requestNpcAction,observeNpc,tickNpc} from '../src/npc.js';
import {discoveryDecision} from '../src/discovery.js';
import {ingestMaterial,projectPhysiology} from '../src/biology.js';
import {bodySignals} from '../src/interoception.js';
import {validateNpc} from '../src/npc-memory.js';
const receipt=(overrides={})=>({id:1,type:'action',at:10,details:{action:{type:'drink'},result:{ok:false,code:'TOO_FULL'}},...overrides});
test('receipt-only cooldown boundaries and urgent bounded interval',()=>{
 assert.equal(deferDrinkRetry([null],11,'dry mouth'),false);
 const e=[receipt()];for(const t of [10,11.99,19.999])assert.equal(deferDrinkRetry(e,t,'dry mouth'),true);
 assert.equal(deferDrinkRetry(e,20,'dry mouth'),false);assert.equal(deferDrinkRetry(e,11.999,'desperate thirst'),true);assert.equal(deferDrinkRetry(e,12,'desperate thirst'),false);
 for(const t of [9,NaN,Infinity])assert.equal(deferDrinkRetry(e,t,'dry mouth'),false);
 for(const r of [receipt({type:'claim'}),receipt({id:0}),receipt({at:NaN}),receipt({at:-1}),receipt({details:{action:{type:'sample'},result:{ok:false,code:'TOO_FULL'}}}),receipt({details:{action:{type:'drink'},result:{ok:true,code:'TOO_FULL'}}}),receipt({details:{action:{type:'drink'},result:{ok:false,code:'EMPTY_FLASK'}}})])assert.equal(deferDrinkRetry([r],11,'dry mouth'),false);
 assert.equal(deferDrinkRetry([receipt(),receipt()],11,'dry mouth'),false);
 const good=receipt({id:2,at:11,details:{action:{type:'drink'},result:{ok:true,code:'DRANK'}}});assert.equal(deferDrinkRetry([...e,good],12,'dry mouth'),false);
});
function fixture({massFull=false}={}){const geometry=createOzarkWorldGeometry(),state=createOzarkState(geometry,{communicationSeed:211}),n=state.agents[0];n.physiology.waterDeficitMl=500;n.flask.water=1;
 if(massFull)assert.equal(ingestMaterial(n,{massGrams:1400,energyKcal:0,waterMl:0,digestHours:24},{source:'authored engineering fixture'}).ok,true);
 else for(let i=0;i<24;i++)assert.equal(ingestMaterial(n,{massGrams:1,energyKcal:0,waterMl:0,digestHours:.05},{source:'authored engineering fixture'}).ok,true);
 bindOzarkWorldAgent(n,geometry,state);projectPhysiology(n);observeNpc(n,state.environment);return{geometry,state,n};}
test('actual count-cap refusal with settled digestion causes wait and preserves all pending inputs',()=>{
 const f=fixture(),{n,state}=f;assert.equal(bodySignals(n).digestion,'settled');assert.equal(discoveryDecision(n).action.type,'drink');const before=structuredClone(n.physiology);
 assert.equal(requestNpcAction(n,{type:'drink'},state.environment).code,'TOO_FULL');assert.deepEqual(n.physiology,before);
 for(let k=0;k<5;k++)assert.deepEqual(discoveryDecision(n).action,{type:'wait',seconds:1});assert.deepEqual(n.physiology,before);
 const restored=validateNpc(JSON.parse(JSON.stringify(n)));const restoredState={...f.state,agents:[restored,...f.state.agents.slice(1)],npc:restored};bindOzarkWorldAgent(restored,f.geometry,restoredState);assert.deepEqual(discoveryDecision(restored).action,{type:'wait',seconds:1});
 for(let i=0;i<605;i++)tickNpc(n,1/60,state.environment);
 assert.equal(n.physiology.stomach.length,0);assert.equal(discoveryDecision(n).action.type,'drink');assert.equal(requestNpcAction(n,{type:'drink'},state.environment).code,'DRANK');assert.equal(n.physiology.stomach.length,1);
});
test('mass-full refusal is also bounded, and ordinary success remains unchanged',()=>{
 const {n,state}=fixture({massFull:true});assert.equal(requestNpcAction(n,{type:'drink'},state.environment).code,'TOO_FULL');assert.deepEqual(discoveryDecision(n).action,{type:'wait',seconds:1});n.elapsed+=10;assert.equal(discoveryDecision(n).action.type,'drink');assert.equal(requestNpcAction(n,{type:'drink'},state.environment).code,'TOO_FULL');assert.equal(discoveryDecision(n).action.type,'wait');
 const g=createOzarkWorldGeometry(),s=createOzarkState(g,{communicationSeed:211}),a=s.agents[0];a.physiology.waterDeficitMl=500;a.flask.water=1;bindOzarkWorldAgent(a,g,s);projectPhysiology(a);assert.equal(discoveryDecision(a).action.type,'drink');assert.equal(requestNpcAction(a,{type:'drink'},s.environment).code,'DRANK');assert.equal(deferDrinkRetry(a.memory.experience,a.elapsed,bodySignals(a).thirst),false);
});
test('urgent thirst cannot bypass minimum refusal interval',()=>{const {n,state}=fixture();n.physiology.waterDeficitMl=3500;projectPhysiology(n);assert.equal(bodySignals(n).thirst,'desperate thirst');assert.equal(requestNpcAction(n,{type:'drink'},state.environment).code,'TOO_FULL');assert.equal(discoveryDecision(n).action.type,'wait');n.elapsed+=1.99;assert.equal(discoveryDecision(n).action.type,'wait');n.elapsed+=.02;assert.equal(discoveryDecision(n).action.type,'drink');});
