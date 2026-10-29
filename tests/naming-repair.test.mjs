const historicalClone=value=>legacyFixture(globalThis.structuredClone(value));
import { legacyFixture } from './fixtures/legacy-communication.mjs';
// These tests preserve the explicit historical English/naming channel.
const createOzarkState=(...args)=>legacyFixture(rawcreateOzarkState(...args));
const loadOzarkSave=(...args)=>legacyFixture(rawloadOzarkSave(...args));
import { chooseOwnName } from '../src/naming-state.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, SOCIAL_RULES } from '../src/config.js';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { createOzarkState as rawcreateOzarkState, writeOzarkSave, loadOzarkSave as rawloadOzarkSave, OZARK_SAVE_KEY } from '../src/ozark-save.js';
import { bindOzarkWorldAgent } from '../src/ozark-agent-world.js';
import { observeNpc, requestNpcAction, tickNpc } from '../src/npc.js';
import { SocialCoordinator } from '../src/social.js';
import { recordGrounding, resolveName, validLexicon } from '../src/naming-state.js';

const geometry=createOzarkWorldGeometry();
const storage=()=>{const map=new Map();return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};};
function fixture(){
  let lineOfSight=true,listenerView='ambiguous';
  const g=Object.freeze({...geometry,lineOfSight:(...args)=>lineOfSight&&geometry.lineOfSight(...args)});
  const state=createOzarkState(g),[a,b]=state.agents,e=state.environment;
  state.elapsed=e.elapsed=e.ecology.elapsed=60;
  const source=e.ecology.plants.find(p=>p.kind==='apple_tree'&&p.quantity>0&&
    e.ecology.plants.filter(o=>Math.hypot(o.position.x-p.position.x,o.position.y-p.position.y)<=12).length===1&&
    [45,65].every(dx=>geometry.canOccupy(p.position.x+dx,p.position.y,CONFIG.playerRadius)&&geometry.lineOfSight({x:p.position.x+dx,y:p.position.y},p.position)));
  assert.ok(source);
  for(const [n,dx] of [[a,45],[b,65]]){n.elapsed=60;n.position={x:source.position.x+dx,y:source.position.y};bindOzarkWorldAgent(n,g,state);observeNpc(n,e);}
  const social=new SocialCoordinator({communicationMode:'legacy',getAgents:()=>state.agents,getEnvironment:()=>e,getCommunity:()=>state.community});
  const advance=seconds=>{for(let t=0;t<seconds-1e-8;t+=.1){e.elapsed+=.1;state.elapsed=e.elapsed;e.ecology.elapsed=e.elapsed;for(const n of state.agents)tickNpc(n,.1,e);}};
  for(let i=0;i<4&&!a.lexicon?.own.length;i++){
    assert.equal(requestNpcAction(a,{type:'inspect_object',targetId:source.id},e).code,'ACTION_STARTED');
    for(let j=0;a.active&&j<50;j++)advance(.1);
    assert.equal(a.lastResult.code,'OBJECT_OBSERVED');
    // Explicit legacy-save fixture; no seeded names in current production.
    chooseOwnName(a,a.discovery.experiments.at(-1),{objectId:source.id,at:a.elapsed,scene:a.scene,actorPosition:{...a.position},objectPosition:{...source.position}});
  }
  assert.equal(a.lexicon.own.length,1);
  // Deliberate sensory test double, not naturally occurring extra world objects:
  // the listener's patch alone is ambiguous until explicitly made unique.
  const visible=social.naming.visible.bind(social.naming);
  social.naming.visible=n=>{
    const rows=visible(n);
    if(n!==b||listenerView==='unique')return rows;
    if(listenerView==='none')return [];
    const target=rows.find(o=>o.id===source.id);
    return target?[...rows,{...target,id:'object:999999'}]:rows;
  };
  const step=()=>social.naming.tick();
  const pump=(seconds,done=()=>false)=>{for(let t=0;t<seconds-1e-8&&!done();t+=.1){advance(.1);step();}};
  return {state,a,b,e,source,social,g,advance,step,pump,own:a.lexicon.own[0],
    view:v=>listenerView=v,los:v=>lineOfSight=v};
}
const receipt=f=>f.a.lexicon.repairReceipts?.[0];
const binding=f=>f.b.lexicon?.heard.find(r=>r.speakerId===f.a.id&&r.token===f.own.token&&r.objectId===f.source.id);
function physical(f){return historicalClone(f.state.agents.map(n=>({rng:n.rng,inventory:n.inventory,physiology:n.physiology,
  active:n.active,experiments:n.discovery.experiments,practice:n.discovery.practice,effects:n.discovery.effects,techniques:n.discovery.techniques,
  actions:n.memory.experience.filter(e=>e.type==='action')})));}
function originalRequest(f){
  f.step();assert.equal(f.own.announcedTo.length,1);assert.equal(binding(f),undefined);
  assert.equal(receipt(f),undefined,'silence and ambiguous pointing alone do not solicit repair');
  f.advance(SOCIAL_RULES.speechCooldown+.2);f.step();
  assert.equal(f.own.checkedWith.length,1);assert.equal(receipt(f),undefined);
}
function clarify(f){
  originalRequest(f);const before=physical(f);f.advance(.1);const afterTime=physical(f);f.step();
  assert.deepEqual(physical(f),afterTime,'speech itself cannot mutate physical evidence');
  assert.ok(receipt(f)?.clarification,'an actual unresolved request must produce listener clarification');
  assert.equal(receipt(f).repoint,null);assert.equal(receipt(f).retry,null);
  assert.equal(receipt(f).requestId,f.own.checkedWith[0].event.messageId);
  assert.deepEqual(Object.keys(receipt(f).clarification).sort(),['at','messageId','scene']);
  assert.deepEqual(f.a.lexicon.repairReceipts,f.b.lexicon.repairReceipts);
  assert.equal(f.social.naming.opportunityCount(),0,'clarification is not grounding');
  assert.ok(afterTime[0].physiology.totals.metabolizedKcal>=before[0].physiology.totals.metabolizedKcal);
}
function repoint(f){
  f.pump(SOCIAL_RULES.speechCooldown+1,()=>!!receipt(f)?.repoint);
  assert.ok(receipt(f).repoint);assert.equal(receipt(f).retry,null,'pointing is not a word-only check');
}
function complete(f){f.pump(8,()=>!!binding(f)?.confirmation);assert.ok(binding(f)?.confirmation);}

for(const initial of ['ambiguous','none'])test(`actual unresolved ${initial} listener observation requests one bounded repair`,()=>{
  const f=fixture();f.view(initial);clarify(f);
  const clarification=historicalClone(receipt(f).clarification);
  for(let i=0;i<4;i++)f.step();
  assert.deepEqual(receipt(f).clarification,clarification,'same-time duplicate processing cannot emit again');
  f.view('unique');repoint(f);
  assert.equal(binding(f).confirmation,null);assert.equal(f.social.naming.opportunityCount(),1);
  complete(f);
  const r=receipt(f),c=binding(f).confirmation;
  assert.ok(r.clarification.at<r.repoint.at&&r.repoint.at<r.retry.at);
  assert.deepEqual(c.request,r.retry);assert.notDeepEqual(c.request,f.own.checkedWith[0].event);
  assert.ok(c.request.at<c.selection.at&&c.selection.at<c.confirmation.at);
  assert.equal(f.own.announcedTo.length,1);assert.equal(f.own.checkedWith.length,1);
  assert.equal(f.a.lexicon.repairReceipts.length,1);assert.equal(f.social.naming.pendingCount(),0);
  assert.equal(validLexicon(f.a.lexicon,f.a),true);assert.equal(validLexicon(f.b.lexicon,f.b),true);
  const count=f.state.community.nextId;f.advance(130);f.step();assert.equal(f.state.community.nextId,count,'completed repair does not refresh its budget');
});

test('persistently ambiguous re-point consumes repair but does not bind or retry',()=>{
  const f=fixture();clarify(f);repoint(f);
  assert.equal(binding(f),undefined);assert.equal(receipt(f).retry,null);
  assert.equal(f.social.naming.opportunityCount(),0);assert.equal(f.social.naming.pendingCount(),0);
  const receipts=historicalClone(f.a.lexicon.repairReceipts),count=f.state.community.nextId;
  f.view('unique');f.advance(130);f.step();
  assert.deepEqual(f.a.lexicon.repairReceipts,receipts);assert.equal(f.state.community.nextId,count);
});

test('a re-point is current sight, not remembered or transmitted old coordinates',()=>{
  const f=fixture();clarify(f);f.view('unique');
  const old={...f.source.position};f.source.position={x:old.x+3,y:old.y};repoint(f);
  assert.deepEqual(receipt(f).repoint.objectPosition,f.source.position);
  assert.notDeepEqual(receipt(f).repoint.objectPosition,f.own.checkedWith[0].event.objectPosition);
  complete(f);
});

test('unseen owner target cannot be re-pointed from retained request geometry',()=>{
  const f=fixture();clarify(f);f.view('unique');f.source.position.x+=1000;
  f.pump(121);assert.equal(receipt(f).repoint,null);assert.equal(receipt(f).retry,null);
  assert.equal(binding(f),undefined);assert.equal(f.social.naming.pendingCount(),0);
});

test('conflicting retained homonyms are not overwritten by a successful local re-point',()=>{
  const f=fixture();clarify(f);f.view('unique');
  const other=f.social.naming.visible(f.b).find(o=>o.id!==f.source.id&&Math.hypot(o.position.x-f.a.position.x,o.position.y-f.a.position.y)<200);
  assert.ok(other);
  // Deliberate locally valid conflicting lexical testimony, not a claim that
  // the owner's one-word generator emitted two names for one token.
  f.advance(.1);
  const message=f.social.naming.emit(f.a,f.b,'Conflicting lexical test testimony.');
  const event=f.social.naming.evidence(message,f.a,f.b,other);
  assert.ok(recordGrounding(f.b,f.a.id,f.own.token,other.id,event));
  repoint(f);
  assert.equal(resolveName(f.b,f.own.token,f.a.id,[f.source.id]),null);
  assert.equal(receipt(f).retry,null);assert.equal(f.social.naming.opportunityCount(),0);
  assert.equal(f.b.lexicon.heard.some(r=>r.objectId===other.id),true);
  assert.equal(f.b.lexicon.heard.some(r=>r.confirmation),false);
});

for(const phase of ['request','clarification','repoint','retry','selection','confirmation'])test(`restart after ${phase} preserves consumed budgets without replay`,()=>{
  const f=fixture();
  if(phase==='request')originalRequest(f);else clarify(f);
  if(['repoint','retry','selection','confirmation'].includes(phase)){f.view('unique');repoint(f);}
  if(['retry','selection','confirmation'].includes(phase))f.pump(3,()=>!!receipt(f).retry);
  if(phase==='selection'){
    const count=f.state.community.nextId;f.pump(3,()=>f.state.community.nextId>count);
    assert.equal(binding(f).confirmation,null);
  }
  if(phase==='confirmation')complete(f);
  const disk=storage();assert.equal(writeOzarkSave(disk,f.state,f.g),true,phase);
  const saved=JSON.parse(disk.getItem(OZARK_SAVE_KEY));
  const loaded=loadOzarkSave(disk,f.g);assert.equal(loaded.blocked,false,loaded.error);
  const state=loaded.state;
  assert.deepEqual(state.agents.map(n=>n.lexicon),saved.agents.map(n=>n.lexicon));
  const expected=historicalClone(state.agents.map(n=>n.lexicon));
  for(const n of state.agents){bindOzarkWorldAgent(n,f.g,state);observeNpc(n,state.environment);}
  const social=new SocialCoordinator({communicationMode:'legacy',getAgents:()=>state.agents,getEnvironment:()=>state.environment,getCommunity:()=>state.community});
  assert.equal(social.naming.pendingCount(),0);assert.equal(social.naming.opportunityCount(),0);
  const count=state.community.nextId;
  // No runtime phase exists to advance. Sample fresh speech eligibility and
  // original-horizon boundaries without resensing the entire world at 10 Hz.
  social.naming.tick();
  for(const seconds of [35.2,85,10]){
    for(let t=0;t<seconds-1e-8;t+=.1){state.environment.elapsed+=.1;state.environment.ecology.elapsed=state.environment.elapsed;state.elapsed=state.environment.elapsed;for(const n of state.agents)tickNpc(n,.1,state.environment);}
    social.naming.tick();
  }
  assert.deepEqual(state.agents.map(n=>n.lexicon),expected);assert.equal(state.community.nextId,count);
  social.dispose();f.social.dispose();
});

for(const interruption of ['range','los','unsafe','food','replacement','epoch','disposal'])test(`${interruption} cancels repair before cooldown without consuming an unspoken re-point`,()=>{
  const f=fixture();clarify(f);const count=f.state.community.nextId;
  if(interruption==='range')f.b.position.x+=600;
  if(interruption==='los')f.los(false);
  if(interruption==='unsafe')f.b.physiology.waterDeficitMl=5000;
  if(interruption==='food')f.social.foodSharing.holding=()=>true;
  if(interruption==='replacement')f.state.agents[1]={...f.b};
  if(interruption==='epoch')f.b.epoch++;
  if(interruption==='disposal')f.social.naming.dispose();
  f.step();assert.equal(f.social.naming.pendingCount(),0);assert.equal(f.social.naming.opportunityCount(),0);
  assert.equal(receipt(f).repoint,null);assert.equal(f.state.community.nextId,count);
});

test('repair receipts survive speech compaction and reject altered cross-agent correspondence',()=>{
  const f=fixture();clarify(f);f.view('unique');repoint(f);complete(f);
  for(const n of f.state.agents)n.social.heard=[];
  f.state.community.messages=[];
  const disk=storage();assert.equal(writeOzarkSave(disk,f.state,f.g),true);
  const original=disk.getItem(OZARK_SAVE_KEY);
  assert.equal(loadOzarkSave(disk,f.g).blocked,false);
  const mutations=[
    s=>delete s.agents[1].lexicon.repairReceipts,
    s=>s.agents[0].lexicon.repairReceipts[0].clarification.objectId=f.source.id,
    s=>s.agents[0].lexicon.repairReceipts[0].requestId='message:999999',
    s=>s.agents[0].lexicon.repairReceipts.push(historicalClone(s.agents[0].lexicon.repairReceipts[0])),
    s=>s.agents[0].lexicon.repairReceipts[0].retry.at=s.agents[0].lexicon.repairReceipts[0].clarification.at,
  ];
  for(const mutate of mutations){const raw=JSON.parse(original);mutate(raw);const bytes=JSON.stringify(raw);disk.setItem(OZARK_SAVE_KEY,bytes);assert.equal(loadOzarkSave(disk,f.g).blocked,true);assert.equal(disk.getItem(OZARK_SAVE_KEY),bytes);}
});

test('the 120-second repair horizon stays anchored to the original request',()=>{
  const f=fixture();originalRequest(f);
  f.advance(119);f.step();assert.ok(receipt(f)?.clarification);
  const count=f.state.community.nextId;f.view('unique');f.advance(1.1);f.step();
  assert.equal(f.social.naming.pendingCount(),0);assert.equal(receipt(f).repoint,null);
  assert.equal(f.state.community.nextId,count);
});

test('a fresh retry that loses its referent cannot open a second clarification budget',()=>{
  const f=fixture();clarify(f);f.view('unique');repoint(f);
  f.pump(3,()=>!!receipt(f).retry);assert.ok(receipt(f).retry);
  const before=historicalClone(f.a.lexicon.repairReceipts),count=f.state.community.nextId;
  f.view('none');f.advance(1.1);f.step();
  assert.equal(binding(f).confirmation,null);assert.equal(f.social.naming.pendingCount(),0);
  f.view('unique');f.pump(40);
  assert.deepEqual(f.a.lexicon.repairReceipts,before);assert.equal(f.state.community.nextId,count);
});

test('a grounded introduction losing listener sight after the actual request can clarify without accelerated speech',()=>{
  const f=fixture();f.view('unique');f.step();assert.ok(binding(f));
  f.pump(3,()=>f.own.checkedWith.length===1);assert.equal(f.own.checkedWith.length,1);
  // The actual word-only request already exists. Loss of the visual candidate
  // ends acceleration, but must not erase the listener's received question.
  f.view('none');const priorSpeech=f.e.elapsed;f.b.social.lastSpokeAt=priorSpeech;
  f.advance(.1);f.step();assert.equal(receipt(f),undefined);assert.equal(f.social.naming.opportunityCount(),0);
  f.pump(SOCIAL_RULES.speechCooldown+1,()=>!!receipt(f));assert.ok(receipt(f)?.clarification);
  assert.ok(receipt(f).clarification.at-priorSpeech>=SOCIAL_RULES.speechCooldown);
  f.view('unique');repoint(f);complete(f);
  assert.equal(f.b.lexicon.heard.length,1,'re-grounding preserves the existing personal binding');
});

test('repair follow-ups leave an ongoing paid action, physical learning and policy RNG alone',()=>{
  const f=fixture();clarify(f);f.view('unique');repoint(f);
  assert.equal(requestNpcAction(f.b,{type:'wait',seconds:5},f.e).code,'STARTED');
  const active=f.b.active,before=physical(f);
  complete(f);
  assert.equal(f.b.active,active,'naming does not hold or cancel paid work');
  for(const [index,n] of f.state.agents.entries()){
    assert.equal(n.rng,before[index].rng);assert.deepEqual(n.inventory,before[index].inventory);
    assert.deepEqual(n.discovery.practice,before[index].practice);assert.deepEqual(n.discovery.effects,before[index].effects);
    assert.deepEqual(n.discovery.techniques,before[index].techniques);
  }
  f.advance(3);assert.equal(f.b.active,null);assert.equal(f.b.lastResult.ok,true);
  assert.equal(f.b.memory.experience.some(e=>e.details?.result?.code==='PRIORITY_CHANGED'),false);
});
