import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { freshState } from '../src/world.js';
import { createNpc } from '../src/npc-state.js';
import { createEnvironment, tickEnvironment } from '../src/environment.js';

import { PopulationRuntime } from '../src/population.js';
import { SocialCoordinator, validateCommunity } from '../src/social.js';
const storage=()=>{const m=new Map();return {getItem:key=>m.get(key)??null,setItem:(key,v)=>m.set(key,v)};};
const socialFor=state=>new SocialCoordinator({communicationMode:'legacy',getAgents:()=>state.agents,getCommunity:()=>state.community,getEnvironment:()=>state.environment});

test('new expeditions use discovery actors and one authoritative ecosystem, while historical fixtures are explicit',()=>{
  const state=freshState();assert.equal(state.version,8);assert.equal(state.simulationMode,'discovery');assert.equal(state.environment.mode,'discovery');assert.ok(state.environment.ecology);assert.equal('ecology' in state,false);
  for(const npc of state.agents){assert.equal(npc.version,4);assert.equal(npc.mode,'discovery');assert.ok(npc.physiology);assert.ok(npc.discovery);assert.equal(npc.discovery.techniques.length,0);assert.equal(npc.discovery.effects.length,0);assert.equal(npc.inventory.apples.length,0);}
  assert.deepEqual(state.environment.foodStocks,[]);assert.equal(createEnvironment().ecology,undefined);assert.equal(freshState({mode:'legacy'}).simulationMode,'legacy');
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
