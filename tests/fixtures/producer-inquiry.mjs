import assert from 'node:assert/strict';
import {createOzarkWorldGeometry} from '../../src/ozark-world-geometry.js';
import {createOzarkState} from '../../src/ozark-save.js';
import {bindOzarkEcology} from '../../src/ozark-ecology.js';
import {bindOzarkWorldAgent} from '../../src/ozark-agent-world.js';
import {observeNpc,requestNpcAction,tickNpc} from '../../src/npc.js';
import {processDiscoveryFeedback,freshMethodAppearance} from '../../src/discovery.js';
import {bodySignals} from '../../src/interoception.js';
import {projectPhysiology} from '../../src/biology.js';
import {producerExperiment,producerInquiryStatus} from '../../src/producer-inquiry.js';
import {distance} from '../../src/world.js';
import {DISCOVERY_RULES} from '../../src/discovery-config.js';
const geometry=createOzarkWorldGeometry();
// Authored physical fixture, not an ordinary autonomous encounter. Outcomes and
// the producer/material relation are earned through the actual paid engine.
export function producerFixture({cloneFeedback=false,train=true}={}){
 const state=createOzarkState(geometry),n=state.agents[0],e=state.environment;bindOzarkEcology(e.ecology,geometry);bindOzarkWorldAgent(n,geometry,state);
 const source=e.ecology.plants.find(p=>p.kind==='apple_tree');Object.assign(source,{position:{x:400,y:720},quantity:8});n.position={...source.position};observeNpc(n,e);
 const needs=()=>{Object.assign(n.physiology,{availableEnergyKcal:700,waterDeficitMl:0,stamina:90,fatigue:10,sleepPressure:10,satietyHours:1.5});projectPhysiology(n);};needs();
 const advance=(seconds,step=.25)=>{for(let t=0;t<seconds-1e-8;t+=step){tickNpc(n,Math.min(step,seconds-t),e);if(cloneFeedback)n.physiology.feedback=n.physiology.feedback.map(p=>({...p}));processDiscoveryFeedback(n);}};
 const finish=action=>{const r=requestNpcAction(n,action,e);for(let i=0;i<1000&&n.active;i++)advance(.25);assert.equal(n.active,null);return n.lastResult||r;};
 const ready=()=>{for(let i=0;i<600&&!producerInquiryStatus(n)?.questions.length;i++)advance(.25);needs();observeNpc(n,e);return producerInquiryStatus(n);};
 const choose=(overrides={})=>producerExperiment(n,{body:bodySignals(n),local:id=>!!freshMethodAppearance(n,id)&&distance(n.position,n.discovery.observations[id].position)<=DISCOVERY_RULES.reach,eligible:id=>n.inventory.items.includes(id)&&!['full','overfull'].includes(bodySignals(n).digestion),blocked:()=>false,...overrides});
 let item=null;
 if(train){assert.equal(finish({type:'pull',targetId:source.id}).code,'piece_detached');item=n.inventory.items.at(-1);assert.equal(finish({type:'release',targetId:item}).code,'object_released');assert.equal(finish({type:'grasp',targetId:item}).code,'object_held');assert.equal(finish({type:'sample',targetId:item}).code,'SWALLOWED');ready();}
 return {state,n,e,source,item,advance,finish,ready,choose,needs,geometry};
}
