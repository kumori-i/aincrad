import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { freshState } from '../src/world.js';
import { createNpc } from '../src/npc-state.js';
import { createEnvironment, tickEnvironment } from '../src/environment.js';
import { validateSave, writeSave, loadSave } from '../src/save.js';
import { PopulationRuntime } from '../src/population.js';
import { SocialCoordinator, validateCommunity } from '../src/social.js';
const storage=()=>{const m=new Map();return {getItem:key=>m.get(key)??null,setItem:(key,v)=>m.set(key,v)};};
const socialFor=state=>new SocialCoordinator({getAgents:()=>state.agents,getCommunity:()=>state.community,getEnvironment:()=>state.environment});

test('new expeditions use discovery actors and one authoritative ecosystem, while historical fixtures are explicit',()=>{
  const state=freshState();assert.equal(state.version,5);assert.equal(state.simulationMode,'discovery');assert.equal(state.environment.mode,'discovery');assert.ok(state.environment.ecology);assert.equal('ecology' in state,false);
  for(const npc of state.agents){assert.equal(npc.version,4);assert.equal(npc.mode,'discovery');assert.ok(npc.physiology);assert.ok(npc.discovery);assert.equal(npc.discovery.techniques.length,0);assert.equal(npc.discovery.effects.length,0);assert.equal(npc.inventory.apples.length,0);}
  assert.deepEqual(state.environment.foodStocks,[]);assert.equal(createEnvironment().ecology,undefined);assert.equal(freshState({mode:'legacy'}).simulationMode,'legacy');
});

test('saved discovery world retains independent physiology, evidence, ecology and message provenance once',()=>{
  const state=freshState(),social=socialFor(state);state.selectedAgentId='mira';state.elapsed=12;state.environment.elapsed=12;
  const post=social.postHuman('Try pulling and then sampling object:1, if you can reach it.','aster');assert.ok(post.ok);
  assert.ok(social.action(state.agents[0],{type:'journal_reply',text:'I can compare that suggestion with my experience.',replyTo:post.message.id,model:true}).ok);
  const store=storage();assert.ok(writeSave(store,state));const disk=JSON.parse(store.getItem(CONFIG.saveKey));assert.equal('npc' in disk,false);assert.equal('ecology' in disk,false);assert.ok(disk.environment.ecology);assert.equal(disk.agents.length,2);
  const loaded=loadSave(store);assert.equal(loaded.exists,true);assert.equal(loaded.state.simulationMode,'discovery');assert.equal(loaded.state.npc,loaded.state.agents[0]);assert.equal(loaded.state.selectedAgentId,'mira');assert.equal(loaded.state.community.messages.at(-1).model,true);
  assert.notEqual(loaded.state.agents[0].physiology,loaded.state.agents[1].physiology);assert.notEqual(loaded.state.agents[0].discovery,loaded.state.agents[1].discovery);
  assert.ok(loaded.state.agents[0].discovery.reports.some(report=>report.messageId===post.message.id&&report.status==='unverified'));assert.equal(loaded.state.agents[0].discovery.techniques.length,0);
});

test('v1-v4 saves preserve prior rules and facts instead of relabeling them cold-start discoveries',()=>{
  for(const version of [1,2,3,4]){
    const npc=createNpc();npc.elapsed=44;npc.hydration=57;npc.memory.lessons.push({at:43,verified:'An old acquired water routine.',hypothesis:'Another source may exist.'});
    const state=validateSave({version,elapsed:44,npc,environment:createEnvironment()});assert.equal(state.version,5);assert.equal(state.simulationMode,'legacy');assert.equal(state.npc.hydration,57);assert.equal(state.npc.memory.lessons[0].verified,npc.memory.lessons[0].verified);assert.equal(state.environment.ecology,undefined);assert.equal(state.agents[1].elapsed,44);
  }
});

test('future and unreadable saves remain protected from automatic writes until explicit new expedition',()=>{
  for(const raw of ['{"version":99,"precious":"progress"}','{broken']){
    const store=storage();store.setItem(CONFIG.saveKey,raw);const loaded=loadSave(store);assert.ok(loaded.error);assert.equal(loaded.blocked,true);assert.equal(writeSave(store,loaded.state),false);assert.equal(store.getItem(CONFIG.saveKey),raw);assert.equal(writeSave(store,freshState()),true);assert.equal(loadSave(store).exists,true);
  }
});

test('discovery environment never refills historical apple stocks on the old timer',()=>{
  const env=createEnvironment(CONFIG.seed,{mode:'discovery'});env.foodStocks=[{id:'apple:trail-orchard',stock:0,renewAt:600}];tickEnvironment(env,601);assert.equal(env.foodStocks[0].stock,0);assert.equal(env.elapsed,601);
});

test('discovery runtime advances one ecology and both bodies through the single clock',()=>{
  const state=freshState(),runtime=new PopulationRuntime(state);const before=state.agents.map(npc=>npc.elapsed);
  for(let i=0;i<60;i++){state.elapsed+=1/60;runtime.tick(1/60);}
  assert.ok(Math.abs(state.environment.elapsed-1)<1e-8);for(const [i,npc] of state.agents.entries())assert.ok(Math.abs(npc.elapsed-before[i]-1)<1e-8);
  const snapshot=JSON.stringify(state);runtime.tick(0);runtime.tick(NaN);assert.equal(JSON.stringify(state),snapshot);runtime.dispose();
});

test('sleep does not reveal peers, physical notes or unread journal and bounded queued advice reaches awake characters',()=>{
  const state=freshState(),social=socialFor(state),npc=state.agents[0];state.agents[1].position={x:npc.position.x,y:npc.position.y+30};
  const note=social.action(state.agents[1],{type:'write_note',title:'Unknown materials',text:'I have not tested these.',beliefIds:[]});assert.ok(note.ok);
  npc.active={request:{type:'sleep'}};
  for(let i=0;i<20;i++)assert.ok(social.postHuman(`Suggestion ${i}: investigate cautiously.`,'aster').ok);
  const sleeping=social.observe(npc);assert.deepEqual(sleeping.peers,[]);assert.deepEqual(sleeping.notes,[]);assert.deepEqual(sleeping.journal,[]);assert.equal(sleeping.pendingHumanTurn,null);assert.equal(npc.social.heard.filter(m=>m.senderId==='human').length,0);assert.equal(npc.discovery.reports.length,0);
  npc.active=null;social.observe(npc);assert.equal(npc.social.journalSeen.filter(id=>state.community.messages.some(m=>m.id===id&&m.senderId==='human')).length,20);assert.ok(npc.discovery.reports.some(report=>report.text.includes('Suggestion 19')));assert.equal(npc.discovery.techniques.length,0);
});

test('discovery offline dialogue contains no supplied food methods, and model prose does not become evidence',()=>{
  const state=freshState(),social=socialFor(state),npc=state.agents[0];state.agents[1].position={x:npc.position.x,y:npc.position.y+30};
  npc.memory.foods.forged={id:'apple:trail-orchard',name:'Trail Orchard',observedAt:1,available:true};
  const speech=social.maybeDialogue(npc);assert.ok(speech);assert.doesNotMatch(speech.text,/apples|orchard|hunt|forage|climb/i);
  assert.ok(social.action(npc,speech).ok);assert.equal(state.agents[1].discovery.effects.length,0);assert.equal(state.agents[1].discovery.techniques.length,0);
  const message=social.postHuman('Hello Aster.','aster').message;
  assert.ok(social.action(npc,{type:'journal_reply',text:'Apples restore energy; pull them.',replyTo:message.id,model:true}).ok);
  assert.equal(npc.discovery.effects.length,0);assert.equal(npc.discovery.techniques.length,0);assert.equal(state.agents[1].discovery.reports.length,0);
  assert.equal(validateCommunity(state.community).messages.at(-1).model,true);
});

test('physiological sleep and its remaining duration survive a restart without reading queued human advice',async()=>{
  const {beginSleep,isSleeping}=await import('../src/biology.js');
  const state=freshState(),npc=state.agents[0],social=socialFor(state);assert.ok(beginSleep(npc,{hours:4}).ok);
  social.postHuman('When you wake, inspect object:1.','aster');const store=storage();assert.ok(writeSave(store,state));const loaded=loadSave(store).state;
  assert.ok(isSleeping(loaded.agents[0]));assert.equal(loaded.agents[0].physiology.sleep.remainingHours,4);assert.equal(loaded.agents[0].discovery.reports.length,0);assert.deepEqual(socialFor(loaded).observe(loaded.agents[0]).peers,[]);
});

test('held materials persist once and ownership repairs never duplicate or destroy their remaining resource',async()=>{
  const {observeNpc,requestNpcAction,tickNpc}=await import('../src/npc.js');const {canStand}=await import('../src/world.js');
  const state=freshState(),npc=state.agents[0],plant=state.environment.ecology.plants.find(p=>p.kind==='bramble'&&p.quantity>0);
  assert.ok(plant);const near=[{x:plant.position.x+45,y:plant.position.y},{x:plant.position.x,y:plant.position.y+45},plant.position].find(p=>canStand(p.x,p.y));assert.ok(near);npc.position={...near};observeNpc(npc,state.environment);
  assert.ok(requestNpcAction(npc,{type:'pull',targetId:plant.id},state.environment).ok);
  for(let i=0;i<48&&npc.active;i++)tickNpc(npc,.25,state.environment);
  assert.equal(npc.inventory.items.length,1);const id=npc.inventory.items[0],material=state.environment.ecology.materials.find(m=>m.id===id);assert.equal(material.heldBy,npc.id);
  const store=storage();assert.ok(writeSave(store,state));const restored=loadSave(store).state;assert.deepEqual(restored.agents[0].inventory.items,[id]);assert.equal(restored.environment.ecology.materials.filter(m=>m.id===id).length,1);assert.equal(restored.environment.ecology.materials.find(m=>m.id===id).heldBy,'aster');
  const tampered=JSON.parse(store.getItem(CONFIG.saveKey));tampered.environment.ecology.materials.find(m=>m.id===id).heldBy='mira';const repaired=validateSave(tampered);assert.deepEqual(repaired.agents[0].inventory.items,[]);const putDown=repaired.environment.ecology.materials.find(m=>m.id===id);assert.equal(putDown.heldBy,null);assert.equal(putDown.massGrams,material.massGrams);assert.equal(putDown.energyKcal,material.energyKcal);assert.equal(putDown.scene,repaired.agents[1].scene);
});

test('peer and field-note sampling reports transfer an experienced hypothesis without granting technique proficiency',async()=>{
  const {observeNpc,requestNpcAction,tickNpc}=await import('../src/npc.js');const {processDiscoveryFeedback}=await import('../src/discovery.js');const {canStand}=await import('../src/world.js');
  const state=freshState(),[npc,peer]=state.agents,social=socialFor(state),plant=state.environment.ecology.plants.find(p=>p.kind==='bramble'&&p.quantity>0);
  npc.position=[{x:plant.position.x+45,y:plant.position.y},{x:plant.position.x,y:plant.position.y+45},plant.position].find(p=>canStand(p.x,p.y));observeNpc(npc,state.environment);
  assert.ok(requestNpcAction(npc,{type:'pull',targetId:plant.id},state.environment).ok);for(let i=0;i<48&&npc.active;i++)tickNpc(npc,.25,state.environment);
  const item=npc.inventory.items[0];assert.ok(requestNpcAction(npc,{type:'sample',targetId:item},state.environment).ok);for(let i=0;i<40&&npc.active;i++)tickNpc(npc,.25,state.environment);
  for(let i=0;i<800&&npc.discovery.effects.length===0;i++){tickNpc(npc,.25,state.environment);processDiscoveryFeedback(npc);}const effect=npc.discovery.effects.at(-1);assert.ok(effect);
  peer.position={x:npc.position.x,y:npc.position.y+20};const share=social.maybeDialogue(npc);assert.equal(share.type,'say');assert.equal(share.effectId,effect.id);assert.ok(social.action(npc,share).ok);
  const report=peer.discovery.reports.find(r=>r.sourceId==='aster'&&r.objectId===item);assert.ok(report);assert.equal(report.status,'unverified');assert.deepEqual(report.proposed,[]);assert.equal(peer.discovery.effects.length,0);assert.equal(peer.discovery.techniques.length,0);
  const note=social.action(npc,{type:'write_note',title:'Sampling experience',text:share.text,effectId:effect.id,beliefIds:[],offline:true});assert.ok(note.ok);assert.equal(note.note.effectClaims[0].objectId,item);assert.ok(social.action(peer,{type:'read_note',noteId:note.note.id}).ok);assert.ok(peer.discovery.reports.some(r=>r.channel==='note'&&r.objectId===item&&r.status==='unverified'));assert.equal(peer.discovery.techniques.length,0);
  const store=storage();assert.ok(writeSave(store,state));const restored=loadSave(store).state;assert.ok(restored.agents[1].discovery.reports.some(r=>r.channel==='note'&&r.objectId===item));assert.equal(restored.community.notes[0].effectClaims[0].objectId,item);
});

test('unknown simulation modes and future nested rules preserve disk data rather than resetting a recognized schema',()=>{
  for(const change of [state=>state.simulationMode='future-world',state=>state.environment.ecology.version=99,state=>state.agents[0].version=99,state=>state.agents[0].physiology.version=99,state=>state.agents[0].discovery.version=99,state=>{state.simulationMode='legacy';state.agents[0].version=99;}]){
    const raw=freshState();change(raw);const store=storage(),encoded=JSON.stringify(raw);store.setItem(CONFIG.saveKey,encoded);const loaded=loadSave(store);assert.ok(loaded.error);assert.equal(loaded.blocked,true);assert.equal(writeSave(store,loaded.state),false);assert.equal(store.getItem(CONFIG.saveKey),encoded);assert.equal(writeSave(store,raw),false);
  }
});

test('actual predator contact interrupts human sleep, records sensed injury and charges ensuing movement energy',async()=>{
  const {requestNpcAction,observeNpc}=await import('../src/npc.js');const {projectPhysiology,isSleeping}=await import('../src/biology.js');const {canStand}=await import('../src/world.js');
  const state=freshState(),npc=state.agents[0],predator=state.environment.ecology.animals.find(a=>a.species==='bobcat');
  const near=[{x:npc.position.x+18,y:npc.position.y},{x:npc.position.x,y:npc.position.y+18},{x:npc.position.x-18,y:npc.position.y}].find(p=>canStand(p.x,p.y));assert.ok(near);predator.position={...near};predator.physiology.availableEnergyKcal=10;predator.physiology.storedEnergyKcal=0;predator.physiology.waterDeficitMl=0;predator.physiology.hoursSinceMeal=12;projectPhysiology(predator);
  // This is an explicit developer fixture for a depleted predator with no local
  // alternative. The ordinary ecosystem is neither removed nor starved in play.
  state.environment.ecology.animals=[predator];state.environment.ecology.plants=[];state.environment.ecology.materials=[];
  observeNpc(npc,state.environment);const runtime=new PopulationRuntime(state);assert.ok(requestNpcAction(npc,{type:'sleep',seconds:600},state.environment).ok);npc.physiology.sleep.state='sleeping';npc.physiology.sleep.hours=2;npc.physiology.sleep.depth=1;projectPhysiology(npc);assert.ok(isSleeping(npc));
  const start={...npc.position},fatigue=npc.fatigue;
  for(let i=0;i<240;i++){state.elapsed+=1/60;runtime.tick(1/60);}
  assert.ok(npc.stats.injuries>0);assert.equal(isSleeping(npc),false);assert.ok(npc.physiology.sleep.inertiaHours>0);assert.ok(npc.fatigue>fatigue);
  const injury=npc.memory.experience.find(event=>event.type==='condition'&&event.details.code==='CONTACT_INJURY');assert.ok(injury);assert.equal(injury.details.objectId,predator.id);assert.equal(injury.details.sourceId,predator.id);assert.equal(injury.details.scene,'valley');assert.equal(typeof injury.details.body.energy,'string');for(const key of ['species','diet','damage','health','energyKcal'])assert.equal(key in injury.details,false);
  assert.ok(npc.memory.experience.some(event=>event.details.result?.code==='REST_INTERRUPTED'));assert.ok(Math.hypot(npc.position.x-start.x,npc.position.y-start.y)>1,'an observed route allows an actual attempt to move away');const {BIOLOGY_PROFILES,gameHours}=await import('../src/biology-config.js');const basalUpperBound=BIOLOGY_PROFILES.human.basalKcalPerDay/24*gameHours(4);assert.ok(npc.physiology.totals.metabolizedKcal>basalUpperBound+.01,'escape movement charges energy in addition to baseline metabolism');
  runtime.dispose();
});
