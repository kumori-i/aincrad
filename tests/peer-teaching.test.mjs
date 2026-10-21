import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CONFIG, SOCIAL_RULES } from '../src/config.js';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { OZARK_SAVE_KEY, createOzarkState, writeOzarkSave, loadOzarkSave } from '../src/ozark-save.js';
import { bindOzarkWorldAgent } from '../src/ozark-agent-world.js';
import { observeNpc, requestNpcAction, tickNpc } from '../src/npc.js';
import { tickEnvironment } from '../src/environment.js';
import { tickOzarkEcology } from '../src/ozark-ecology.js';
import { SocialCoordinator, validateCommunity } from '../src/social.js';
import { NpcController } from '../src/controller.js';
import { discoveryDecision, processDiscoveryFeedback, recordDiscoveryReport } from '../src/discovery.js';
import { validateNpc, recordEvent } from '../src/npc-memory.js';
import { retainedProofIntegrityError } from '../src/proof-retention.js';
import { PEER_TEACHING_WINDOW_SECONDS, peerTeachingLabel } from '../src/peer-teaching.js';

const geometry=createOzarkWorldGeometry();
const clone=structuredClone;
// Static, explicit encounter exposure, not a claim about autonomous survival or
// travel. Both bodies and action durations are real; ecology is not advanced.
function fixture({nativeEcology=false}={}){
  const state=createOzarkState(geometry),[a,b]=state.agents,e=state.environment;
  const source=[...e.ecology.plants].filter(p=>p.kind==='apple_tree'&&p.quantity>2).sort((x,y)=>Math.hypot(x.position.x-geometry.spawn.x,x.position.y-geometry.spawn.y)-Math.hypot(y.position.x-geometry.spawn.x,y.position.y-geometry.spawn.y)).find(p=>geometry.canOccupy(p.position.x+45,p.position.y,CONFIG.playerRadius));
  assert.ok(source);state.elapsed=e.elapsed=60;if(nativeEcology)e.ecology.elapsed=60;
  for(const n of [a,b]){n.elapsed=60;n.position={x:source.position.x+45,y:source.position.y};bindOzarkWorldAgent(n,geometry,state);observeNpc(n,e);}
  const social=new SocialCoordinator({getAgents:()=>state.agents,getCommunity:()=>state.community,getEnvironment:()=>e});
  const ca=new NpcController(a,{environment:e,social}),cb=new NpcController(b,{environment:e,social});
  function advance(seconds){for(let remaining=seconds;remaining>1e-8;){const dt=Math.min(.1,remaining);tickEnvironment(e,dt);state.elapsed=e.elapsed;if(nativeEcology)tickOzarkEcology(e.ecology,dt,e,state.agents,{},geometry);for(const n of state.agents)tickNpc(n,dt,e);for(const n of state.agents)processDiscoveryFeedback(n);remaining-=dt;}}
  function finish(n,action){const result=requestNpcAction(n,action,e);if(result.code==='ACTION_STARTED')for(let i=0;n.active&&i<400;i++)advance(.1);assert.equal(n.active,null);return n.lastResult||result;}
  function learn(){assert.equal(finish(a,{type:'pull',targetId:source.id}).ok,true);assert.equal(finish(a,{type:'sample',targetId:a.inventory.items[0]}).ok,true);advance(90);assert.equal(a.discovery.techniques.length,1);observeNpc(a,e);observeNpc(b,e);return a.discovery.techniques[0];}
  function teach(){const t=learn(),action=social.discoveryDialogue(a);assert.equal(action.techniqueId,t.id);const result=ca.perform(action);assert.equal(result.code,'SAID');return b.discovery.reports.find(r=>r.teaching);}
  return {state,a,b,e,source,social,ca,cb,advance,finish,learn,teach};
}
const restored=n=>validateNpc(JSON.parse(JSON.stringify(n)),{canStandAt:(x,y)=>geometry.canOccupy(x,y,CONFIG.playerRadius)});
const disk=()=>{const map=new Map();return{getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value)};};

test('actual controller teaches a naive peer who pays for the exact procedure before own evidence',()=>{
  const f=fixture(),{a,b,source,ca,cb,state}=f;
  const report=f.teach();assert.ok(report);assert.equal(report.sourceId,'aster');assert.equal(report.channel,'peer');assert.equal(report.teaching.sourceObjectId,source.id);
  assert.deepEqual(report.proposed,[{type:'pull',targetId:source.id},{type:'sample',targetId:source.id}]);
  assert.deepEqual(b.discovery.techniques,[]);assert.deepEqual(b.discovery.effects,[]);assert.deepEqual(b.discovery.practice,{});assert.equal(b.stats.independentMeals,0);assert.deepEqual(report.evidence,[]);
  assert.equal(state.community.messages.at(-1).teaching.sourceObjectId,source.id);
  const first=discoveryDecision(b),start=b.elapsed,metabolism=b.physiology.totals.metabolizedKcal,quantity=source.quantity;
  assert.deepEqual(first.action,{type:'pull',targetId:source.id});assert.match(first.reason,/taught by aster/);
  assert.equal(cb.perform(first.action).code,'ACTION_STARTED');while(b.active)f.advance(.1);
  assert.ok(b.elapsed-start>=4.9);assert.ok(b.physiology.totals.metabolizedKcal>metabolism);assert.equal(source.quantity,quantity-1);
  const material=b.inventory.items[0];assert.ok(material);assert.notEqual(material,a.inventory.items[0]);assert.equal(report.proposed[1].targetId,material);assert.equal(report.cursor,1);assert.equal(b.discovery.techniques.length,0);
  const second=discoveryDecision(b);assert.deepEqual(second.action,{type:'sample',targetId:material});cb.perform(second.action);while(b.active)f.advance(.1);
  assert.equal(report.teaching.state,'waiting');assert.equal(report.status,'unverified');assert.equal(b.discovery.techniques.length,0);f.advance(90);
  assert.equal(report.status,'supported');assert.equal(report.teaching.state,'complete');assert.equal(b.discovery.techniques.length,1);assert.equal(b.stats.independentMeals,1);
  assert.ok(report.evidence.every(id=>b.discovery.experiments.some(e=>e.id===id)));assert.equal(retainedProofIntegrityError(b),null);
  assert.match(peerTeachingLabel(report,b.elapsed),/my own bodily experience/);ca.dispose();cb.dispose();
});

test('sender needs retained acquisition, sampling and delayed effect closure, not forged fields',()=>{
  for(const damage of ['unknown','revised','acquisition','sample','effect']){
    const f=fixture(),t=f.learn();
    if(damage==='revised')t.confidence='revised';
    if(damage==='acquisition')f.a.memory.experience=f.a.memory.experience.filter(e=>e.details.action?.type!=='pull');
    if(damage==='sample')f.a.memory.experience=f.a.memory.experience.filter(e=>e.details.action?.type!=='sample');
    if(damage==='effect'){f.a.physiology.feedback=[];f.a.memory.experience=f.a.memory.experience.filter(e=>e.details.code!=='DISCOVERY_EFFECT');}
    const result=f.social.action(f.a,{type:'say',targetId:'mira',text:'Try the method I used.',techniqueId:damage==='unknown'?'technique:fake':t.id});
    assert.equal(result.code,'TECHNIQUE_NOT_ESTABLISHED',damage);assert.equal(f.state.community.messages.length,0);assert.equal(f.b.discovery.reports.length,0);
    f.ca.dispose();f.cb.dispose();
  }
});

test('teaching delivery still requires real nearby awake contact and prevents repeated speech',()=>{
  const f=fixture(),t=f.learn(),action={type:'say',targetId:'mira',text:'Try my reported method.',techniqueId:t.id};
  f.b.scene='refuge';assert.equal(f.ca.perform(action).code,'PEER_OUT_OF_REACH');f.b.scene='valley';
  f.b.position.x+=SOCIAL_RULES.peerRange+1;assert.equal(f.ca.perform(action).code,'PEER_OUT_OF_REACH');f.b.position={...f.a.position};
  f.b.active={request:{type:'sleep'}};assert.equal(f.ca.perform(action).code,'PEER_UNAVAILABLE');f.b.active=null;
  assert.equal(f.ca.perform(action).code,'SAID');assert.equal(f.ca.perform(action).code,'CONVERSATION_COOLDOWN');
  f.advance(36);assert.equal(f.ca.perform(action).code,'REPEATED_CONVERSATION');assert.equal(f.b.discovery.reports.filter(r=>r.teaching).length,1);
  f.ca.dispose();f.cb.dispose();
});

test('unknown listener source remains attributed inert testimony, never copied perception',()=>{
  const f=fixture(),t=f.learn();f.b.discovery.observations={};
  const before=clone(f.b.memory.cells);assert.equal(f.ca.perform({type:'say',targetId:'mira',text:'Try this source.',techniqueId:t.id}).ok,true);
  const r=f.b.discovery.reports.find(r=>r.teaching);assert.deepEqual(r.proposed,[]);assert.equal(r.teaching.state,'unavailable');assert.deepEqual(f.b.discovery.observations,{});assert.deepEqual(f.b.memory.cells,before);
  assert.equal(f.b.discovery.techniques.length,0);f.ca.dispose();f.cb.dispose();
});

test('physical refusal ends the attempt without declaring the food report false',()=>{
  const f=fixture(),r=f.teach();f.e.ecology.plants=f.e.ecology.plants.filter(p=>p!==f.source);
  assert.equal(f.finish(f.b,{type:'pull',targetId:f.source.id}).code,'OBJECT_GONE');
  assert.equal(r.teaching.state,'unavailable');assert.equal(r.status,'unverified');assert.equal(r.cursor,2);assert.equal(f.b.discovery.techniques.length,0);
  const b=restored(f.b),rr=b.discovery.reports.find(r=>r.teaching);assert.equal(rr.status,'unverified');assert.equal(rr.teaching.state,'unavailable');
  f.ca.dispose();f.cb.dispose();
});

test('old advice, full hands and adverse own knowledge do not force a taught trial',()=>{
  for(const scenario of ['expired','capacity','adverse']){
    const f=fixture(),r=f.teach();
    if(scenario==='expired')r.teaching.receivedAt=f.b.elapsed-PEER_TEACHING_WINDOW_SECONDS;
    if(scenario==='capacity')f.b.inventory.items=['object:900001','object:900002','object:900003','object:900004'];
    if(scenario==='adverse')f.b.discovery.techniques.push({sourceId:f.source.id,confidence:'revised',steps:[{type:'pull',targetId:'$source'},{type:'sample',targetId:'$material'}],evidence:[],successes:0,failures:1});
    const decision=discoveryDecision(f.b);assert.doesNotMatch(decision.reason,/taught by aster/,scenario);assert.equal(r.status,'unverified');
    f.ca.dispose();f.cb.dispose();
  }
});

test('valid teaching round-trips before, after acquisition, and after pending and recognized samples',()=>{
  const f=fixture({nativeEcology:true}),storage=disk();f.teach();
  const verify=()=>{
    const before=f.b.discovery.reports.find(r=>r.teaching),copy=restored(f.b);assert.deepEqual(copy.discovery.reports.find(r=>r.teaching),before);
    assert.deepEqual(validateCommunity(clone(f.state.community)).messages,f.state.community.messages);
    const wrote=writeOzarkSave(storage,f.state,geometry);if(!wrote){const {npc,...raw}=f.state;storage.setItem(OZARK_SAVE_KEY,JSON.stringify(raw));assert.fail(loadOzarkSave(storage,geometry).error);}assert.equal(wrote,true);const reopened=loadOzarkSave(storage,geometry);assert.equal(reopened.blocked,false,reopened.error);
    assert.deepEqual(reopened.state.agents[1].discovery.reports.find(r=>r.teaching),before);return copy;
  };
  verify();f.finish(f.b,discoveryDecision(f.b).action);const copy=verify();assert.equal(copy.discovery.reports.find(r=>r.teaching).cursor,1);
  f.finish(f.b,discoveryDecision(f.b).action);verify();f.advance(90);verify();f.ca.dispose();f.cb.dispose();
});

test('missing or forged receiver progress cannot replay acquisition or invent supported status',()=>{
  const f=fixture(),r=f.teach();f.finish(f.b,discoveryDecision(f.b).action);
  for(const mutate of [n=>{n.discovery.reports.find(r=>r.teaching).evidence=[];},n=>{n.discovery.reports.find(r=>r.teaching).evidence=[999999];},n=>{n.discovery.reports.find(r=>r.teaching).cursor=0;},n=>{n.discovery.reports.find(r=>r.teaching).teaching.acquisition='strike';}]){
    const raw=clone(f.b);mutate(raw);const n=restored(raw),report=n.discovery.reports.find(row=>row.id===r.id);
    assert.ok(!report.teaching||report.teaching.state==='unavailable');assert.equal(report.proposed.length,0);assert.equal(report.status,'unverified');
  }
  const raw=clone(f.b);raw.discovery.reports[0].status='supported';raw.discovery.reports[0].teaching.execute='shell';const n=restored(raw),rr=n.discovery.reports[0];assert.equal(rr.status,'unverified');assert.equal(rr.teaching.execute,undefined);assert.equal(rr.cursor,1);
  f.ca.dispose();f.cb.dispose();
});

test('effect identities survive actual controller speech and field-note paths without teaching a fake routine',()=>{
  const f=fixture();f.learn();const effect=f.a.discovery.effects.find(e=>e.effect==='sustained');
  assert.equal(f.ca.perform({type:'say',targetId:'mira',text:'This is my own experienced effect.',effectId:effect.id,offline:true}).ok,true);
  assert.ok(f.b.discovery.reports.some(r=>r.objectId===effect.objectId));assert.equal(f.b.discovery.reports.some(r=>r.proposed.length),false);
  assert.equal(f.ca.perform({type:'write_note',title:'My experience',text:'I experienced relief after this sample.',effectId:effect.id,offline:true}).ok,true);
  assert.equal(f.state.community.notes[0].effectClaims[0].experienceId,effect.id);f.ca.dispose();f.cb.dispose();
});

test('teaching UI labels explicitly separate reported procedure from experienced outcome',()=>{
  const source=readFileSync(new URL('../src/npc-panel.js',import.meta.url),'utf8');assert.match(source,/nearby · taught procedure/);assert.match(source,/Taught by/);assert.match(source,/peerTeachingLabel/);
});

test('restart during an unfinished acquisition disables teaching instead of replaying it',()=>{
  const f=fixture(),r=f.teach(),quantity=f.source.quantity;
  assert.equal(f.cb.perform(discoveryDecision(f.b).action).code,'ACTION_STARTED');f.advance(.2);
  assert.equal(r.cursor,0);assert.deepEqual(r.evidence,[]);
  const n=restored(f.b),report=n.discovery.reports.find(row=>row.id===r.id);
  assert.equal(n.active,null);assert.equal(report.teaching.state,'unavailable');assert.deepEqual(report.proposed,[]);assert.equal(f.source.quantity,quantity);
  assert.equal(n.stats.independentMeals,0);f.ca.dispose();f.cb.dispose();
});

test('tagged teaching speech cannot misrepresent a verified routine or bypass dedup with new prose',()=>{
  const f=fixture(),t=f.learn();
  const result=f.ca.perform({type:'say',targetId:'mira',text:'I killed a rabbit and it is guaranteed safe.',techniqueId:t.id});
  assert.doesNotMatch(result.message.text,/killed|rabbit|guaranteed safe/);assert.match(result.message.text,new RegExp(t.sourceId));assert.match(result.message.text,/not a promise/);
  f.advance(36);assert.equal(f.ca.perform({type:'say',targetId:'mira',text:'Completely different claim.',techniqueId:t.id}).code,'REPEATED_CONVERSATION');
  f.ca.dispose();f.cb.dispose();
});

test('small exact-target kill and catch hints propose attempts, never outcomes or food proof',()=>{
  const f=fixture();
  for(const [verb,type] of [['kill','strike'],['catch','catch']]){
    const sent=f.social.postUserMessage(`${verb} ${f.source.id}`,{to:'mira'}),r=f.b.discovery.reports.find(r=>r.messageId===sent.message.id);
    assert.deepEqual(r.proposed,[{type,targetId:f.source.id}]);assert.equal(r.status,'unverified');assert.deepEqual(r.evidence,[]);
    assert.equal(f.b.discovery.techniques.length,0);assert.equal(f.b.discovery.practice[type],undefined);
    const reply=f.social.discoveryDialogue(f.b);assert.match(reply.text,/can fail/);assert.match(reply.text,/no outcome or food benefit is guaranteed/);
  }
  const unbound=restored(f.b);assert.deepEqual(recordDiscoveryReport(unbound,`catch ${f.source.id}`,{sourceId:'human'}).proposed,[],'a disabled primitive cannot be taught by words');
  f.ca.dispose();f.cb.dispose();
});

test('vague animal advice is explicitly unresolved instead of consulting a global prey oracle',()=>{
  const f=fixture(),before=clone(f.b.discovery.observations);
  const sent=f.social.postUserMessage('You can kill the animals.',{to:'mira'}),r=f.b.discovery.reports.find(r=>r.messageId===sent.message.id);
  assert.deepEqual(r.proposed,[]);assert.deepEqual(f.b.discovery.observations,before);assert.deepEqual(f.b.discovery.techniques,[]);
  const reply=f.social.discoveryDialogue(f.b);assert.match(reply.text,/cannot identify a specific observed target/);assert.match(reply.text,/unique visible description/);
  f.ca.dispose();f.cb.dispose();
});
