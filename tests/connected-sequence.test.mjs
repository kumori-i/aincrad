// NEW reconstruction controls: authored paid encounters, never an ordinary cohort.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createOzarkWorldGeometry} from '../src/ozark-world-geometry.js';
import {createOzarkState,writeOzarkSave,loadOzarkSave} from '../src/ozark-save.js';
import {bindOzarkWorldAgent} from '../src/ozark-agent-world.js';
import {observeNpc,requestNpcAction,tickNpc,cancelNpcAction} from '../src/npc.js';
import {processDiscoveryFeedback,discoveryDecision} from '../src/discovery.js';
import {projectPhysiology,exertPhysiology} from '../src/biology.js';
import {SocialCoordinator} from '../src/social.js';
import {NpcController} from '../src/controller.js';
import {lookupEcologyObject} from '../src/ecology.js';
import {tickDiscoveryAction} from '../src/discovery-actions.js';
import {connectedSequenceStatus,preferConnectedSequence,issueConnectedSequence,receiveConnectedSequence,CONNECTED_SEQUENCE_REASON} from '../src/connected-sequence.js';
const geometry=createOzarkWorldGeometry();
function fixture({read=false}={}){
 const state=createOzarkState(geometry,{communicationSeed:99001}),n=state.agents[0],e=state.environment;
 state.agents.forEach(a=>bindOzarkWorldAgent(a,geometry,state));
 const source=e.ecology.plants.find(p=>p.kind==='grass');source.position={x:400,y:720};n.position={...source.position};
 const comfortable=()=>{Object.assign(n.physiology,{availableEnergyKcal:1300,satietyHours:3,waterDeficitMl:0,stamina:90,fatigue:10,sleepPressure:10});projectPhysiology(n);observeNpc(n,e);};comfortable();
 const advance=seconds=>{for(let t=0;t<seconds-1e-8;t+=.25){if(read)connectedSequenceStatus(n);const dt=Math.min(.25,seconds-t);state.elapsed+=dt;e.elapsed=e.ecology.elapsed=state.elapsed;for(const actor of state.agents)tickNpc(actor,dt,e);processDiscoveryFeedback(n,{foodLearning:false});}};
 const finish=request=>{const admitted=requestNpcAction(n,request,e);for(let i=0;i<200&&n.active;i++)advance(.25);assert.equal(n.active,null);return admitted.ok?n.lastResult:admitted;};
 const pull=()=>{assert.equal(finish({type:'pull',targetId:source.id}).code,'piece_detached');return n.inventory.items.at(-1);};
 const train=(type='strike',count=2)=>{for(let i=0;i<count;i++){const id=pull();assert.equal(finish({type,targetId:id}).ok,true);if(type!=='release')finish({type:'release',targetId:id});comfortable();}};
 // Explicit permit helper isolates authority tests. Real chooser tests below do not use it.
 const choose=()=>{const q=connectedSequenceStatus(n)?.question;if(!q)return null;const c={action:{type:q.type,targetId:q.outputId},score:8};if(!preferConnectedSequence(n,[c]))return null;assert.equal(issueConnectedSequence(n,c.action),true);return c.action;};
 return {state,n,e,source,comfortable,advance,finish,pull,train,choose};
}
test('two own paid nonfood episodes learn later exact-source strike feasibility',()=>{
 const f=fixture();f.train();const id=f.pull(),s=connectedSequenceStatus(f.n);
 assert.equal(s.question.outputId,id);assert.equal(s.question.type,'strike');assert.equal(s.episodes.length,2);assert.equal(new Set(s.episodes.map(e=>e.outputId)).size,2);
 assert.ok(s.episodes.every(e=>!e.uncertain&&e.nextAt>e.firstAt&&e.seconds>0&&e.costCoverage==='A-and-next-handling-only'&&e.firstEffort&&e.nextEffort));
 const before=f.n.physiology.totals.metabolizedKcal;assert.equal(f.finish(f.choose()).ok,true);assert.equal(connectedSequenceStatus(f.n).question.phase,'completed');assert.ok(f.n.physiology.totals.metabolizedKcal>before);assert.equal(f.n.physiology.totals.ingestedKcal,0);assert.equal(f.n.discovery.techniques.length,0);assert.equal(f.choose(),null);
});
test('release history learns release rather than a supplied strike recipe',()=>{
 const f=fixture();f.train('release');const id=f.pull();assert.equal(f.finish(f.choose()).code,'object_released');assert.ok(!f.n.inventory.items.includes(id));assert.equal(f.n.physiology.totals.ingestedKcal,0);
});
test('one episode, other identical-looking source and forged history do not qualify',()=>{
 const f=fixture();f.train('strike',1);f.pull();assert.equal(f.choose(),null);
 const g=fixture();g.train();const other=g.e.ecology.plants.find(p=>p.kind==='grass'&&p!==g.source);g.n.position={...other.position};g.comfortable();assert.equal(g.finish({type:'pull',targetId:other.id}).ok,true);assert.equal(g.choose(),null);
 const h=fixture();receiveConnectedSequence(h.n,{});h.n.discovery.experiments=structuredClone(g.n.discovery.experiments);assert.equal(h.choose(),null);
});
test('interposed inspection and paid failed handling remain uncertain evidence',()=>{
 for(const action of ['inspect_object','pull']){const f=fixture();for(let i=0;i<2;i++){const id=f.pull();f.finish({type:action,targetId:id});f.finish({type:'strike',targetId:id});f.finish({type:'release',targetId:id});}f.pull();assert.equal(f.choose(),null);assert.ok(connectedSequenceStatus(f.n).episodes.some(e=>e.uncertain));}
});
test('cancellation and failed dispatch cannot become clean continuity',()=>{
 for(const mode of ['cancel','reject','social']){const f=fixture();f.train('strike',1);const id=f.pull();
  if(mode==='cancel'){requestNpcAction(f.n,{type:'strike',targetId:id},f.e);f.advance(.25);cancelNpcAction(f.n);}
  if(mode==='reject'){f.n.lifecycle='COLLAPSED';assert.equal(requestNpcAction(f.n,{type:'strike',targetId:id},f.e).ok,false);f.n.lifecycle='AWAKE';}
  if(mode==='social'){const c=new NpcController(f.n,{environment:f.e});c.perform({type:'say',text:'test'});c.dispose();}
  f.finish({type:'strike',targetId:id});f.finish({type:'release',targetId:id});f.pull();assert.equal(f.choose(),null);assert.ok(connectedSequenceStatus(f.n).episodes.some(e=>e.uncertain));
 }
});
test('care at selection, dispatch and active work never grants unsafe continuation',()=>{
 for(const at of ['selection','dispatch','work']){const f=fixture();f.train();f.pull();const r=at==='selection'?null:f.choose();if(at==='work'){requestNpcAction(f.n,r,f.e);f.advance(.25);}f.n.physiology.waterDeficitMl=5000;projectPhysiology(f.n);
  if(at==='selection')assert.equal(f.choose(),null);else if(at==='dispatch')assert.equal(f.finish(r).code,'CONNECTED_SEQUENCE_STALE');else{f.advance(.25);assert.equal(f.n.active,null);assert.equal(f.n.lastResult.code,'CONNECTED_SEQUENCE_STALE');}
  f.comfortable();if(at!=='selection')assert.equal(f.choose(),null);
 }
});
test('source/output/epoch replacement rejects authority at dispatch and work',()=>{
 for(const what of ['source','output','epoch'])for(const active of [false,true]){const f=fixture();f.train();const id=f.pull(),r=f.choose();if(active){requestNpcAction(f.n,r,f.e);f.advance(.25);}if(what==='epoch')f.n.epoch++;else{const field=what==='source'?'plants':'materials',target=what==='source'?f.source.id:id;f.e.ecology[field]=f.e.ecology[field].map(o=>o.id===target?{...o}:o);}
  if(active){f.advance(.25);assert.equal(f.n.lastResult.code,'CONNECTED_SEQUENCE_STALE');}else assert.equal(f.finish(r).code,'CONNECTED_SEQUENCE_STALE');assert.equal(f.choose(),null);
 }
});
test('observed replacement then original restoration cannot revive ready, issued or working authority',()=>{
 for(const phase of ['ready','issued','working']){const f=fixture();f.train();f.pull();const r=phase==='ready'?null:f.choose();if(phase==='working'){requestNpcAction(f.n,r,f.e);f.advance(.25);}const originals=f.e.ecology.plants;f.e.ecology.plants=originals.map(p=>p===f.source?{...p}:p);observeNpc(f.n,f.e);assert.equal(connectedSequenceStatus(f.n).question.phase,'retired');f.e.ecology.plants=originals;
  if(phase==='working'){f.advance(.25);assert.equal(f.n.lastResult.code,'CONNECTED_SEQUENCE_STALE');}else if(phase==='issued')assert.equal(f.finish(r).code,'CONNECTED_SEQUENCE_STALE');else assert.equal(f.choose(),null);
 }
});
test('changed physical appearance or walking context rejects dispatch and active continuation',()=>{
 for(const what of ['appearance','context'])for(const active of [false,true]){const f=fixture();f.train();const id=f.pull(),r=f.choose();if(active){requestNpcAction(f.n,r,f.e);f.advance(.25);}if(what==='appearance')lookupEcologyObject(f.e.ecology,id).spoiled=true;else f.n.thermal.wetness=100;
  if(active){f.advance(.25);assert.equal(f.n.lastResult.code,'CONNECTED_SEQUENCE_STALE');}else assert.equal(f.finish(r).code,'CONNECTED_SEQUENCE_STALE');
 }
});
test('cloned and mutated requests cannot claim canonical learned execution',()=>{
 const f=fixture();f.train();f.pull();const r=f.choose();f.finish({...r});assert.notEqual(connectedSequenceStatus(f.n).question.phase,'completed');assert.equal(f.choose(),null);
 const g=fixture();g.train();g.pull();const mutated=g.choose();mutated.type='pull';assert.equal(g.finish(mutated).code,'CONNECTED_SEQUENCE_STALE');
});
test('controller forwards original one-use permission',()=>{
 const f=fixture();f.train();f.pull();const c=new NpcController(f.n,{environment:f.e});assert.equal(c.perform(f.choose()).code,'ACTION_STARTED');while(f.n.active)f.advance(.25);assert.equal(connectedSequenceStatus(f.n).question.phase,'completed');c.dispose();
});
test('observer reads remain detached and preserve world actor and RNG parity',()=>{
 const a=fixture(),b=fixture({read:true});for(const f of [a,b]){f.train();f.pull();const before=structuredClone(f.n),s=connectedSequenceStatus(f.n);for(let i=0;i<20;i++)assert.deepEqual(connectedSequenceStatus(f.n),s);assert.deepEqual(f.n,before);assert.throws(()=>s.question.phase='fake');f.finish(f.choose());}assert.deepEqual(a.n,b.n);assert.deepEqual(a.e,b.e);
});
test('save/reload cannot reconstruct private learning or live permission',()=>{
 const f=fixture();f.train();f.pull();let raw=null;assert.equal(writeOzarkSave({getItem:()=>raw,setItem:(_k,v)=>{raw=v;}},f.state,geometry),true);const opened=loadOzarkSave({getItem:()=>raw},geometry);assert.equal(opened.blocked,false);assert.equal(connectedSequenceStatus(opened.state.agents[0]),null);
});
test('custody loss rejects dispatch and active continuation',()=>{
 for(const active of [false,true]){const f=fixture();f.train();const id=f.pull(),r=f.choose();if(active){requestNpcAction(f.n,r,f.e);f.advance(.25);}lookupEcologyObject(f.e.ecology,id).heldBy='mira';if(active){f.advance(.25);assert.equal(f.n.lastResult.code,'CONNECTED_SEQUENCE_STALE');}else assert.equal(f.finish(r).ok,false);assert.notEqual(connectedSequenceStatus(f.n).question.phase,'completed');}
});
test('epoch retirement cannot renew an already consumed source admission',()=>{
 const f=fixture();f.train('release');f.pull();f.finish(f.choose());f.n.epoch++;f.train('release');f.pull();assert.equal(f.choose(),null);assert.equal(connectedSequenceStatus(f.n).admissions,1);
});
test('unreliable episode ages in last-four window without deleting failed public receipt',()=>{
 const f=fixture();let id=f.pull();f.finish({type:'pull',targetId:id});f.finish({type:'release',targetId:id});f.train('strike',3);assert.equal(connectedSequenceStatus(f.n).episodes.length,4);assert.ok(connectedSequenceStatus(f.n).episodes.some(e=>e.uncertain));id=f.pull();assert.equal(f.choose(),null);f.finish({type:'strike',targetId:id});f.finish({type:'release',targetId:id});assert.ok(connectedSequenceStatus(f.n).episodes.every(e=>!e.uncertain));f.pull();assert.ok(f.choose());assert.ok(f.n.memory.experience.some(r=>r.details?.result?.code==='nothing_detached'));
});
test('sixteen-method eviction cannot renew source admission',()=>{
 const f=fixture();f.train('release');f.pull();f.finish(f.choose());const sources=f.e.ecology.plants.filter(p=>p.kind==='grass'&&p!==f.source).slice(0,16);assert.equal(sources.length,16);
 for(const source of sources){f.n.position={...source.position};f.comfortable();for(let i=0;i<2;i++){assert.equal(f.finish({type:'pull',targetId:source.id}).ok,true);f.finish({type:'release',targetId:f.n.inventory.items.at(-1)});f.comfortable();}}
 assert.equal(connectedSequenceStatus(f.n).methods,16);assert.ok(connectedSequenceStatus(f.n).episodes.every(e=>e.sourceId!==f.source.id));f.n.position={...f.source.position};f.comfortable();f.train('release');f.pull();assert.equal(f.choose(),null);assert.equal(connectedSequenceStatus(f.n).admissions,1);
});
test('actual voluntary handoff retires donor continuity without teaching receiver production',()=>{
 const f=fixture();f.train();const id=f.pull(),peer=f.state.agents[1];peer.position={...f.n.position};observeNpc(peer,f.e);const social=new SocialCoordinator({communicationMode:'legacy',getAgents:()=>f.state.agents,getCommunity:()=>f.state.community,getEnvironment:()=>f.e});
 try{const offer=social.action(f.n,{type:'offer_food',targetId:peer.id,objectId:id});assert.equal(offer.code,'FOOD_OFFERED');assert.equal(social.action(peer,{type:'accept_food',offerId:offer.offerId}).code,'ACTION_STARTED');while(peer.active)f.advance(.25);assert.equal(lookupEcologyObject(f.e.ecology,id).heldBy,peer.id);assert.equal(f.choose(),null);assert.equal(connectedSequenceStatus(peer)?.methods??0,0);}finally{social.dispose();}
});
test('real optional competition may choose inspection and retire continuation',()=>{
 const f=fixture();f.train('release');f.pull();observeNpc(f.n,f.e);const decision=discoveryDecision(f.n,{foodLearning:false});assert.notEqual(decision.reason,CONNECTED_SEQUENCE_REASON);assert.equal(decision.action.type,'inspect_object');assert.equal(decision.action.targetId,f.source.id);assert.equal(connectedSequenceStatus(f.n).question.phase,'ready');f.finish(decision.action);assert.equal(f.choose(),null);
});
test('real chooser selects learned release after paid familiarity without injected scores or candidates',()=>{
 const f=fixture();f.train('release');observeNpc(f.n,f.e);
 const nearby=Object.values(f.n.discovery.observations).filter(o=>Math.hypot(o.position.x-f.n.position.x,o.position.y-f.n.position.y)<=80);
 for(const o of nearby)assert.equal(f.finish({type:'inspect_object',targetId:o.id}).ok,true);
 f.comfortable();const id=f.pull();observeNpc(f.n,f.e);const decision=discoveryDecision(f.n,{foodLearning:false});assert.equal(decision.reason,CONNECTED_SEQUENCE_REASON,JSON.stringify(decision));assert.deepEqual(decision.action,{type:'release',targetId:id});const c=new NpcController(f.n,{environment:f.e});assert.equal(c.perform(decision.action).code,'ACTION_STARTED');while(f.n.active)f.advance(.25);assert.equal(connectedSequenceStatus(f.n).question.phase,'completed');assert.equal(f.n.lastResult.code,'object_released');assert.ok(f.n.lastResult.durationSeconds>0);c.dispose();
});

test('appearance changes between production and handling cannot become clean matching episodes',()=>{
 const f=fixture();for(let i=0;i<2;i++){const id=f.pull();lookupEcologyObject(f.e.ecology,id).spoiled=true;assert.equal(f.finish({type:'strike',targetId:id}).ok,true);f.finish({type:'release',targetId:id});f.comfortable();}
 f.pull();assert.equal(f.choose(),null);assert.ok(connectedSequenceStatus(f.n).episodes.every(e=>e.uncertain));
});
test('final paid-slice reentrant revocation prevents physical release and completion',()=>{
 const f=fixture();f.train('release');const id=f.pull(),r=f.choose();assert.equal(requestNpcAction(f.n,r,f.e).code,'ACTION_STARTED');
 let result;const active=f.n.active;
 tickDiscoveryAction(f.n,active.seconds,f.e,{exert:(n,seconds,effort)=>{exertPhysiology(n,seconds,effort);const originals=f.e.ecology.plants;f.e.ecology.plants=originals.map(p=>p===f.source?{...p}:p);observeNpc(f.n,f.e);f.e.ecology.plants=originals;},complete:(_n,_r,r)=>{result=r;f.n.active=null;return r;}});
 assert.equal(result.code,'CONNECTED_SEQUENCE_STALE');assert.ok(result.durationSeconds>0,'actual paid slice is retained, not inferred from the callback');assert.ok(f.n.inventory.items.includes(id));assert.equal(lookupEcologyObject(f.e.ecology,id).heldBy,f.n.id);assert.notEqual(connectedSequenceStatus(f.n).question.phase,'completed');
});
