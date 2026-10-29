const historicalClone=value=>legacyFixture(globalThis.structuredClone(value));
import { legacyFixture } from './fixtures/legacy-communication.mjs';
// These tests preserve the explicit historical English/naming channel.
const createOzarkState=(...args)=>legacyFixture(rawcreateOzarkState(...args));
const loadOzarkSave=(...args)=>legacyFixture(rawloadOzarkSave(...args));
const validateNpc=(...args)=>legacyFixture(rawvalidateNpc(...args));
import test from 'node:test';
import assert from 'node:assert/strict';
import { NpcController } from '../src/controller.js';
import { CONFIG } from '../src/config.js';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { OZARK_SAVE_KEY, createOzarkState as rawcreateOzarkState, writeOzarkSave, loadOzarkSave as rawloadOzarkSave } from '../src/ozark-save.js';
import { bindOzarkWorldAgent } from '../src/ozark-agent-world.js';
import { observeNpc, requestNpcAction, tickNpc } from '../src/npc.js';
import { tickEnvironment } from '../src/environment.js';
import { tickOzarkEcology, bindOzarkEcology } from '../src/ozark-ecology.js';
import { SocialCoordinator } from '../src/social.js';
import { discoveryDecision, processDiscoveryFeedback, recordPeerTechnique, rememberDirectDiscoveryObject } from '../src/discovery.js';
import { validateNpc as rawvalidateNpc } from '../src/npc-memory.js';
import { retainedProofIntegrityError } from '../src/proof-retention.js';
import { METHOD_TRIAL_LIMIT } from '../src/method-transfer-state.js';

const geometry=createOzarkWorldGeometry(),clone=value=>legacyFixture(historicalClone(value));
// Fixed encounter exposure, not autonomous travel. Both sources are existing,
// finite ecology objects with distinct locations, not clones or free materials.
function pair(state){
  const plants=state.environment.ecology.plants.filter(p=>p.kind==='apple_tree'&&p.quantity>2);
  for(const source of plants)for(const target of plants){
    const distance=Math.hypot(source.position.x-target.position.x,source.position.y-target.position.y);
    const a={x:source.position.x+45,y:source.position.y},b={x:target.position.x+45,y:target.position.y};
    if(distance>120&&distance<300&&[a,b].every(p=>geometry.canOccupy(p.x,p.y,CONFIG.playerRadius))&&geometry.lineOfSight(a,b))return {source,target};
  }
  assert.fail('Fixed distinct-source encounter missing');
}
function world(raw=null){
  const disk=storage();let state;
  if(raw){const {npc,...saved}=clone(raw);disk.setItem(OZARK_SAVE_KEY,JSON.stringify(saved));const loaded=loadOzarkSave(disk,geometry);assert.equal(loaded.blocked,false,loaded.error);state=loaded.state;}else state=createOzarkState(geometry);
  const [a,b]=state.agents,e=state.environment,{source,target}=pair(state);
  if(!raw){state.elapsed=e.elapsed=e.ecology.elapsed=60;for(const n of [a,b])n.elapsed=60;a.position={x:source.position.x+45,y:source.position.y};b.position={x:target.position.x+45,y:target.position.y};}
  bindOzarkEcology(e.ecology,geometry);
  for(const n of [a,b]){bindOzarkWorldAgent(n,geometry,state);observeNpc(n,e);}
  const social=new SocialCoordinator({communicationMode:'legacy',getAgents:()=>state.agents,getCommunity:()=>state.community,getEnvironment:()=>e});
  const advance=seconds=>{for(let left=seconds;left>1e-8;){const dt=Math.min(.1,left);tickEnvironment(e,dt);state.elapsed=e.elapsed;tickOzarkEcology(e.ecology,dt,e,state.agents,{},geometry);for(const n of state.agents){tickNpc(n,dt,e);processDiscoveryFeedback(n);}left-=dt;}};
  const finish=(n,action)=>{const result=requestNpcAction(n,action,e);if(result.code==='ACTION_STARTED')for(let i=0;n.active&&i<400;i++)advance(.1);assert.equal(n.active,null);return result.code==='ACTION_STARTED'?n.lastResult:result;};
  const teach=()=>{observeNpc(a,e);observeNpc(b,e);const t=a.discovery.techniques[0];assert.ok(t);const r=social.action(a,{type:'say',targetId:'mira',text:'Share my retained method.',techniqueId:t.id});assert.equal(r.code,'SAID');return b.discovery.reports.findLast(r=>r.teaching);};
  return {state,disk,a,b,e,source,target,social,advance,finish,teach};
}
const storage=()=>{const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v)};};
// One fixed teacher training history is reused across every ablation/guard.
const training=world();
assert.equal(training.finish(training.a,{type:'pull',targetId:training.source.id}).ok,true);
assert.equal(training.finish(training.a,{type:'sample',targetId:training.a.inventory.items[0]}).ok,true);
training.advance(90);assert.equal(training.a.discovery.techniques.length,1);
const trained=clone(training.state);training.social.dispose();
const restore=n=>validateNpc(clone(n),{canStandAt:(x,y)=>geometry.canOccupy(x,y,CONFIG.playerRadius)});

test('verified method binds a different local source and only paid own feedback establishes recipient knowledge',()=>{
  const f=world(trained),{a,b,target,source}=f,quantity=target.quantity;
  const report=f.teach();assert.notEqual(source.id,target.id);assert.notDeepEqual(source.position,target.position);
  assert.equal(report.teaching.sourceObjectId,source.id);assert.equal(report.teaching.transfer.targetObjectId,target.id);
  assert.equal(f.state.community.messages.at(-1).teaching.transfer.targetObjectId,undefined,'speech never binds a remote listener target');
  assert.deepEqual(report.proposed,[{type:'pull',targetId:target.id},{type:'sample',targetId:target.id}]);
  assert.deepEqual(b.discovery.effects,[]);assert.deepEqual(b.discovery.techniques,[]);assert.deepEqual(b.discovery.practice,{});assert.equal(b.stats.independentMeals,0);assert.equal(target.quantity,quantity);
  const first=discoveryDecision(b);assert.deepEqual(first.action,{type:'pull',targetId:target.id});assert.match(first.reason,/similar-looking/);
  const at=b.elapsed,cost=b.physiology.totals.metabolizedKcal;assert.equal(f.finish(b,first.action).ok,true);assert.ok(b.elapsed-at>=4.9);assert.ok(b.physiology.totals.metabolizedKcal>cost);assert.equal(target.quantity,quantity-1);
  const material=b.inventory.items[0];assert.equal(report.proposed[1].targetId,material);assert.notEqual(material,a.inventory.items[0]);assert.equal(b.discovery.techniques.length,0);
  assert.deepEqual(discoveryDecision(b).action,{type:'sample',targetId:material});assert.equal(f.finish(b,discoveryDecision(b).action).ok,true);assert.equal(report.status,'unverified');assert.equal(report.teaching.state,'waiting');f.advance(90);
  assert.equal(report.status,'supported');assert.equal(b.discovery.techniques[0].sourceId,target.id);assert.equal(b.stats.independentMeals,1);assert.equal(retainedProofIntegrityError(b),null);f.social.dispose();
});

test('matched ablation keeps teacher experience, recipient state and geometry fixed; communication is the treatment',()=>{
  const snapshots=[];
  for(const condition of ['matched baseline','retained teacher without usable speech','retained teacher with method']){
    const f=world(trained),before=clone({body:f.b.physiology,inventory:f.b.inventory,position:f.b.position,source:f.source,target:f.target,teacher:f.a.discovery.techniques});
    if(condition==='retained teacher with method')f.teach();
    else if(condition==='retained teacher without usable speech')assert.equal(f.social.action(f.a,{type:'say',targetId:'mira',text:'I am here.'}).code,'SAID');
    snapshots.push(before);const decision=discoveryDecision(f.b);
    if(condition==='retained teacher with method'){assert.deepEqual(decision.action,{type:'pull',targetId:f.target.id});assert.match(decision.reason,/similar-looking/);}
    else assert.doesNotMatch(decision.reason,/reported method|taught by/);
    // No success-rate or sample-efficiency claim: this is a fixed decision test,
    // and ordinary curiosity may independently choose the same physical action.
    assert.deepEqual(f.b.discovery.techniques,[]);assert.equal(f.b.stats.independentMeals,0);f.social.dispose();
  }
  assert.deepEqual(snapshots[0],snapshots[1]);assert.deepEqual(snapshots[1],snapshots[2]);
});

test('zero or ambiguous local cue matches consume one admission and cannot be refreshed by new speech or report eviction',()=>{
  for(const scenario of ['incompatible','ambiguous','stale','range']){
    const f=world(trained);observeNpc(f.a,f.e);observeNpc(f.b,f.e);
    const source=f.a.discovery.observations[f.source.id],teaching={version:1,sourceObjectId:f.source.id,senderTechniqueId:f.a.discovery.techniques[0].id,acquisition:'pull',receivedAt:f.b.elapsed,state:'ready',transfer:{version:1,cues:Object.fromEntries(['shape','color','texture'].map(k=>[k,source.appearance[k]])),observedAt:f.a.elapsed}};
    if(scenario==='incompatible')f.b.discovery.observations[f.target.id].appearance.color='a different visible color';
    if(scenario==='ambiguous'){const o=clone(f.b.discovery.observations[f.target.id]);o.id='object:900001';rememberDirectDiscoveryObject(f.b,o);}
    if(scenario==='stale'){f.b=restore(f.b);f.state.agents[1]=f.b;}
    if(scenario==='range')f.b.position={x:f.target.position.x+100,y:f.target.position.y};
    const options={sourceId:'aster',channel:'peer',messageId:'message:trial1'};
    const r=recordPeerTechnique(f.b,'A reported local method.',teaching,options);assert.equal(r.teaching.state,'unavailable',scenario);assert.deepEqual(r.proposed,[]);assert.equal(f.b.discovery.methodTrials.length,1);
    f.b.discovery.reports=[];f.b.position={x:f.target.position.x+45,y:f.target.position.y};bindOzarkWorldAgent(f.b,geometry,f.state);observeNpc(f.b,f.e);
    const again=recordPeerTechnique(f.b,'New wording, same method.',{...teaching,senderTechniqueId:'technique:aster:new',receivedAt:f.b.elapsed},{...options,messageId:'message:trial2'});assert.equal(again.teaching.state,'unavailable',scenario);assert.deepEqual(again.proposed,[]);assert.equal(f.b.discovery.methodTrials.length,1);f.social.dispose();
  }
});

test('one method admission persists across restart and bounded ledger saturation fails closed',()=>{
  const f=world(trained),r=f.teach();const copy=restore(f.b);assert.deepEqual(copy.discovery.methodTrials,f.b.discovery.methodTrials);assert.equal(copy.discovery.reports.find(x=>x.id===r.id).teaching.transfer.targetObjectId,f.target.id);
  copy.discovery.reports=[];f.state.agents[1]=copy;bindOzarkWorldAgent(copy,geometry,f.state);observeNpc(copy,f.e);
  const again=recordPeerTechnique(copy,r.text,{...r.teaching,transfer:{...r.teaching.transfer,targetObjectId:undefined}},{sourceId:'aster',channel:'peer',messageId:'message:again'});
  assert.equal(again,null,'explicit malformed target is rejected');
  const transfer=clone(r.teaching);delete transfer.transfer.targetObjectId;
  const repeated=recordPeerTechnique(copy,r.text,transfer,{sourceId:'aster',channel:'peer',messageId:'message:again2'});assert.equal(repeated.teaching.state,'unavailable');
  const n=world(trained);n.b.discovery.methodTrials=Array.from({length:METHOD_TRIAL_LIMIT},(_,i)=>({senderId:'aster',sourceObjectId:`object:${900000+i}`,acquisition:'pull'}));const blocked=n.teach();assert.equal(blocked.teaching.state,'unavailable');assert.equal(n.b.discovery.methodTrials.length,METHOD_TRIAL_LIMIT);assert.equal(writeOzarkSave(n.disk,n.state,geometry),true);assert.equal(loadOzarkSave(n.disk,geometry).blocked,false);f.social.dispose();n.social.dispose();
});

test('full hands, prior source-linked adverse feedback and urgent care do not receive a transfer action',()=>{
  for(const scenario of ['capacity','prior-adverse','linked-adverse','pain','depleted']){
    const f=world(trained),r=f.teach();
    if(scenario==='capacity')f.b.inventory.items=['object:900001','object:900002','object:900003','object:900004'];
    if(scenario==='prior-adverse')f.b.discovery.techniques.push({sourceId:f.target.id,confidence:'revised',steps:[{type:'pull',targetId:'$source'},{type:'sample',targetId:'$material'}],evidence:[],successes:0,failures:1});
    if(scenario==='linked-adverse'){
      // A policy guard fixture, not fabricated learning or physical evidence.
      f.b.discovery.experiments.push({id:900,primitive:'pull',targetId:f.target.id,materialId:'object:900001',ok:true},{id:901,primitive:'sample',targetId:'object:900001',ok:true,actionId:901,ingestionId:'ingestion:900'});
      f.b.discovery.effects.push({objectId:'object:900001',effect:'discomfort',actionId:901,ingestionId:'ingestion:900',pain:'aching'});
    }
    if(scenario==='pain')f.b.physiology.health=60;
    if(scenario==='depleted')f.b.energy=0;
    const decision=discoveryDecision(f.b);assert.doesNotMatch(decision.reason,/reported method/,scenario);assert.equal(r.status,'unverified');assert.equal(r.cursor,0);f.social.dispose();
  }
});

test('wrong order cannot advance report; restart during acquisition cancels without replay or duplicate debit',()=>{
  const f=world(trained),r=f.teach(),quantity=f.target.quantity;
  assert.equal(f.finish(f.b,{type:'sample',targetId:f.target.id}).ok,false);assert.equal(r.cursor,0);assert.deepEqual(r.evidence,[]);
  assert.equal(requestNpcAction(f.b,{type:'pull',targetId:f.target.id},f.e).code,'ACTION_STARTED');f.advance(.2);
  const n=restore(f.b),rr=n.discovery.reports.find(x=>x.id===r.id);assert.equal(n.active,null);assert.equal(rr.teaching.state,'unavailable');assert.deepEqual(rr.proposed,[]);assert.equal(f.target.quantity,quantity);assert.equal(n.stats.independentMeals,0);assert.equal(n.discovery.methodTrials.length,1);f.social.dispose();
});

test('strict schema-12 save retains report, paid acquisition and own feedback; malformed transfer fails closed',()=>{
  const f=world(trained),r=f.teach(),disk=f.disk;
  const check=()=>{assert.equal(writeOzarkSave(disk,f.state,geometry),true);const read=loadOzarkSave(disk,geometry);assert.equal(read.blocked,false,read.error);assert.deepEqual(read.state.agents[1].discovery.reports.find(x=>x.id===r.id),r);assert.deepEqual(read.state.agents[1].discovery.methodTrials,f.b.discovery.methodTrials);};
  check();f.finish(f.b,discoveryDecision(f.b).action);check();f.finish(f.b,discoveryDecision(f.b).action);check();f.advance(90);check();
  const saved=disk.getItem(OZARK_SAVE_KEY);r.teaching.transfer.cues.species='forbidden';assert.equal(writeOzarkSave(disk,f.state,geometry),false);assert.equal(disk.getItem(OZARK_SAVE_KEY),saved);const corrupted=JSON.parse(saved);corrupted.agents[1].discovery.reports.find(x=>x.id===r.id).teaching.transfer.cues.species='forbidden';const bad=storage();bad.setItem(OZARK_SAVE_KEY,JSON.stringify(corrupted));assert.equal(loadOzarkSave(bad,geometry).blocked,true);f.social.dispose();
});

test('hearing a method does not authorize a relay, and losing the acquired item cannot sample remotely',()=>{
  const f=world(trained),r=f.teach();
  const relay=f.social.action(f.b,{type:'say',targetId:'aster',text:'I heard this was safe.',techniqueId:r.teaching.senderTechniqueId});assert.equal(relay.code,'TECHNIQUE_NOT_ESTABLISHED');
  assert.equal(f.finish(f.b,discoveryDecision(f.b).action).ok,true);const material=f.b.inventory.items[0];assert.equal(r.cursor,1);
  assert.equal(f.finish(f.b,{type:'release',targetId:material}).ok,true);const decision=discoveryDecision(f.b);assert.doesNotMatch(decision.reason,/reported method/);assert.equal(r.cursor,1);assert.equal(f.b.discovery.techniques.length,0);assert.equal(f.b.stats.independentMeals,0);f.social.dispose();
});


test('fixed 60-second controller trajectory plus 60-second feedback window reports matched ablations without a success advantage assertion',t=>{
  const outcomes=[];
  for(const condition of ['matched baseline','retained teacher without usable speech','retained teacher with method']){
    const f=world(trained),before=f.b.physiology.totals.metabolizedKcal,start=f.b.elapsed;
    if(condition==='retained teacher with method')f.teach();
    else if(condition==='retained teacher without usable speech')assert.equal(f.social.action(f.a,{type:'say',targetId:'mira',text:'I am here.'}).code,'SAID');
    // Only the initial communication differs. No later conversations introduce
    // extra information; the ordinary recipient controller owns every choice.
    const controller=new NpcController(f.b,{communicationMode:'legacy',environment:f.e});
    for(let step=0;step<1200;step++){
      const dt=.1;tickEnvironment(f.e,dt);f.state.elapsed=f.e.elapsed;tickOzarkEcology(f.e.ecology,dt,f.e,f.state.agents,{},geometry);tickNpc(f.a,dt,f.e);processDiscoveryFeedback(f.a);
      if(step<600)controller.tick(dt);else{tickNpc(f.b,dt,f.e);processDiscoveryFeedback(f.b);}
    }
    const experiments=f.b.discovery.experiments;
    outcomes.push({condition,choiceSeconds:60,totalSeconds:Number((f.b.elapsed-start).toFixed(3)),actions:experiments.map(e=>({primitive:e.primitive,targetId:e.targetId,ok:e.ok,code:e.code})),paidActionSeconds:experiments.filter(e=>e.ok).reduce((sum,e)=>sum+e.durationSeconds,0),samples:experiments.filter(e=>e.primitive==='sample'&&e.ok).length,meals:f.b.stats.independentMeals,effects:f.b.discovery.effects.map(e=>({effect:e.effect,objectId:e.objectId})),techniques:f.b.discovery.techniques.map(x=>x.sourceId),metabolizedKcal:Number((f.b.physiology.totals.metabolizedKcal-before).toFixed(6))});
    assert.equal(retainedProofIntegrityError(f.b),null);assert.equal(writeOzarkSave(f.disk,f.state,geometry),true,'diagnostic must preserve strict physical/evidence save validity');controller.dispose();f.social.dispose();
  }
  t.diagnostic(JSON.stringify({scope:'supplied fixed encounter; actual ordinary controller; no information-matched ordinary-message control; no comparative learning claim',outcomes}));
});

test('private source stock cannot affect sensory method admission, but physical pull can lawfully fail',()=>{
  const outputs=[];
  for(const empty of [false,true]){
    const f=world(trained);observeNpc(f.a,f.e);observeNpc(f.b,f.e);const original=f.target.quantity;
    // Change hidden stock after the identical sighting, without publishing a
    // changed count. The policy must not consult authoritative stock to bind.
    if(empty)f.target.quantity=0;
    const technique=f.a.discovery.techniques[0];assert.equal(f.social.action(f.a,{type:'say',targetId:'mira',text:'Share my method.',techniqueId:technique.id}).code,'SAID');
    const report=f.b.discovery.reports.findLast(r=>r.teaching),decision=discoveryDecision(f.b);outputs.push({proposed:clone(report.proposed),action:decision.action});
    const result=f.finish(f.b,decision.action);
    if(empty){assert.equal(result.ok,false);assert.equal(report.teaching.state,'unavailable');assert.equal(report.status,'unverified');assert.equal(f.b.inventory.items.length,0);assert.equal(f.target.quantity,0);}
    else{assert.equal(result.ok,true);assert.equal(f.target.quantity,original-1);}
    f.social.dispose();
  }
  assert.deepEqual(outputs[0],outputs[1]);
});

test('actual local occlusion blocks an otherwise fresh matching sensory candidate',()=>{
  const f=world(trained),r=f.teach(),teaching=clone(r.teaching);delete teaching.transfer.targetObjectId;
  const target=f.e.ecology.plants.find(p=>p.id==='object:453');assert.ok(target);
  // Search a bounded ring of lawful local viewpoints rather than mocking LOS.
  const ring=Array.from({length:48},(_,i)=>({x:target.position.x+75*Math.cos(i*Math.PI/24),y:target.position.y+75*Math.sin(i*Math.PI/24)})).filter(p=>geometry.canOccupy(p.x,p.y,CONFIG.playerRadius));
  const clear=ring.find(p=>geometry.lineOfSight(p,target.position)),blocked=ring.find(p=>!geometry.lineOfSight(p,target.position));assert.ok(clear);assert.ok(blocked);
  f.b.discovery.methodTrials=[];f.b.discovery.reports=[];f.b.position=clear;observeNpc(f.b,f.e);assert.ok(f.b.discovery.observations[target.id]);f.b.position=blocked;
  const report=recordPeerTechnique(f.b,r.text,teaching,{sourceId:'aster',channel:'peer',messageId:'message:occluded'});assert.equal(report.teaching.state,'unavailable');assert.deepEqual(report.proposed,[]);f.social.dispose();
});

test('stale-at-send cues and duplicate executable method reports are rejected as current-save corruption',()=>{
  const f=world(trained),report=f.teach();assert.equal(writeOzarkSave(f.disk,f.state,geometry),true);const saved=f.disk.getItem(OZARK_SAVE_KEY);
  for(const mutate of [raw=>{raw.agents[1].discovery.reports.find(r=>r.id===report.id).teaching.transfer.observedAt=report.teaching.receivedAt-8;},raw=>{const duplicate=clone(raw.agents[1].discovery.reports.find(r=>r.id===report.id));duplicate.id+=':duplicate';duplicate.messageId+=':duplicate';raw.agents[1].discovery.reports.push(duplicate);},raw=>{raw.community.messages.find(m=>m.teaching?.transfer).teaching.transfer.observedAt=report.teaching.receivedAt-8;}]){
    const raw=JSON.parse(saved);mutate(raw);const bad=storage(),bytes=JSON.stringify(raw);bad.setItem(OZARK_SAVE_KEY,bytes);assert.equal(loadOzarkSave(bad,geometry).blocked,true);assert.equal(bad.getItem(OZARK_SAVE_KEY),bytes);
  }
  f.social.dispose();
});
