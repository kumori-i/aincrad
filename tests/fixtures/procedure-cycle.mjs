import assert from 'node:assert/strict';
import {bindOzarkEcology} from '../../src/ozark-ecology.js';
import {createOzarkWorldGeometry} from '../../src/ozark-world-geometry.js';
import {createOzarkState} from '../../src/ozark-save.js';
import {bindOzarkWorldAgent} from '../../src/ozark-agent-world.js';
import {observeNpc,requestNpcAction,tickNpc,cancelNpcAction} from '../../src/npc.js';
import {discoveryDecision,processDiscoveryFeedback} from '../../src/discovery.js';
import {procedureCycleStatus,procedureWalkingContext,receiveProcedureAction,receiveProcedureMovement} from '../../src/procedure-cycle.js';
import {projectPhysiology,exertPhysiology} from '../../src/biology.js';
import {tickDiscoveryAction} from '../../src/discovery-actions.js';
const geometry=createOzarkWorldGeometry();
// Authored finite sources and starting conditions. Every motor/payment, portion,
// wetness transition and delayed effect below comes from the real bound engine.
export function fixture({cancelSample=false,cloneFeedback=false,inspectCycle=false}={}){
 const state=createOzarkState(geometry),n=state.agents[0],e=state.environment;bindOzarkEcology(e.ecology,geometry);
 const [a,b]=e.ecology.plants.filter(p=>p.kind==='apple_tree').slice(0,2);
 Object.assign(a,{position:{x:400,y:720},quantity:4});Object.assign(b,{position:{x:600,y:720},quantity:4});
 n.position={x:400,y:720};bindOzarkWorldAgent(n,geometry,state);observeNpc(n,e);
 const advance=(seconds,step=.25)=>{for(let t=0;t<seconds-1e-8;t+=step){tickNpc(n,Math.min(step,seconds-t),e);if(cloneFeedback)n.physiology.feedback=n.physiology.feedback.map(event=>({...event}));processDiscoveryFeedback(n);if(inspectCycle){procedureCycleStatus(n);procedureCycleStatus(n);}}};
 const at=position=>{n.position={...position};n.navigationAnchor=null;observeNpc(n,e);};
 const finish=action=>{const result=requestNpcAction(n,action,e);for(let i=0;i<4000&&n.active;i++)advance(action.type==='move'?1/60:.25,action.type==='move'?1/60:.25);assert.equal(n.active,null);return n.lastResult||result;};
 const needs=()=>{Object.assign(n.physiology,{availableEnergyKcal:700,waterDeficitMl:0,stamina:90,fatigue:10,sleepPressure:10,satietyHours:1.5});projectPhysiology(n);};
 const soak=()=>{needs();at({x:-1220,y:260});advance(6);assert.equal(procedureWalkingContext(n),'walk:ordinary:soaked');};
 const sample=id=>{if(cancelSample){const kind=cancelSample;cancelSample=false;requestNpcAction(n,{type:'sample',targetId:id},e);if(kind!=='first-hook'&&kind!=='throw-hook')advance(.5);assert.ok(n.active);if(kind==='throw-hook'){assert.throws(()=>tickDiscoveryAction(n,.25,e,{exert(actor,seconds,effort){exertPhysiology(actor,seconds,effort);throw Error('procedure fixture throw');}}),/procedure fixture throw/);cancelNpcAction(n);}else if(kind==='changed-target'){n.active.request.targetId='object:999999';cancelNpcAction(n);}else if(kind==='first-hook'||kind==='later-hook')tickDiscoveryAction(n,.25,e,{exert(actor,seconds,effort){exertPhysiology(actor,seconds,effort);cancelNpcAction(actor);}});else cancelNpcAction(n);}
 assert.equal(finish({type:'sample',targetId:id}).code,'SWALLOWED');advance(100);assert.equal(finish({type:'release',targetId:id}).code,'object_released');};
 // Real repeated grasp of this exact remaining piece, not manufactured material.
 soak();at(b.position);assert.equal(finish({type:'pull',targetId:b.id}).code,'piece_detached');const piece=n.inventory.items.at(-1);assert.equal(finish({type:'release',targetId:piece}).code,'object_released');
 // Interleave operations to avoid presenting practice chronology as source cost.
 for(let i=0;i<2;i++){
   soak();at(a.position);assert.equal(finish({type:'pull',targetId:a.id}).code,'piece_detached');sample(n.inventory.items.at(-1));
   soak();at(b.position);assert.equal(finish({type:'grasp',targetId:piece}).code,'object_held');sample(piece);
 }
 const prepare=()=>{needs();n.discovery.run=null;at({x:200,y:720});};
 return {n,e,a,b,piece,advance,at,finish,needs,soak,prepare};
}
export function choice(f){const result=discoveryDecision(f.n);return {result,status:procedureCycleStatus(f.n),source:f.n.discovery.techniques.find(t=>t.id===f.n.discovery.run?.techniqueId)?.sourceId};}
