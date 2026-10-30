const historicalClone=value=>legacyFixture(globalThis.structuredClone(value));
import { legacyFixture } from './fixtures/legacy-communication.mjs';
// These tests preserve the explicit historical English/naming channel.
const createOzarkState=(...args)=>legacyFixture(rawcreateOzarkState(...args));
const loadOzarkSave=(...args)=>legacyFixture(rawloadOzarkSave(...args));
import { chooseOwnName } from '../src/naming-state.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG,SOCIAL_RULES } from '../src/config.js';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { createOzarkState as rawcreateOzarkState,writeOzarkSave,loadOzarkSave as rawloadOzarkSave,OZARK_SAVE_KEY } from '../src/ozark-save.js';
import { bindOzarkWorldAgent } from '../src/ozark-agent-world.js';
import { observeNpc,requestNpcAction,tickNpc } from '../src/npc.js';
import { SocialCoordinator } from '../src/social.js';
import { resolvePoint } from '../src/naming-runtime.js';
import { validLexicon,resolveName } from '../src/naming-state.js';
import { contactEscape } from '../src/discovery.js';
import { recordEvent } from '../src/npc-memory.js';
const geometry=createOzarkWorldGeometry();
function fixture({unique=true,legacyGround=false}={}){
  let visible=true;
  const g=Object.freeze({...geometry,groundAt:legacyGround?point=>geometry.observe(point).ground:geometry.groundAt,lineOfSight:(...args)=>visible&&geometry.lineOfSight(...args)});
  const state=createOzarkState(g),[a,b]=state.agents,e=state.environment;
  state.elapsed=e.elapsed=e.ecology.elapsed=60;
  const source=e.ecology.plants.find(p=>p.kind==='apple_tree'&&p.quantity>0&&
    (!unique||e.ecology.plants.filter(o=>Math.hypot(o.position.x-p.position.x,o.position.y-p.position.y)<=12).length===1)&&
    [45,65].every(dx=>geometry.canOccupy(p.position.x+dx,p.position.y,CONFIG.playerRadius)&&geometry.lineOfSight({x:p.position.x+dx,y:p.position.y},p.position)));
  assert.ok(source);
  for(const [n,dx] of [[a,45],[b,65]]){n.elapsed=60;n.position={x:source.position.x+dx,y:source.position.y};bindOzarkWorldAgent(n,g,state);observeNpc(n,e);}
  const social=new SocialCoordinator({communicationMode:'legacy',getAgents:()=>state.agents,getEnvironment:()=>e,getCommunity:()=>state.community});
  const advance=seconds=>{for(let t=0;t<seconds-1e-8;t+=.1){e.elapsed+=.1;state.elapsed=e.elapsed;e.ecology.elapsed=e.elapsed;for(const n of state.agents)tickNpc(n,.1,e);}};
  const inspect=n=>{assert.equal(requestNpcAction(n,{type:'inspect_object',targetId:source.id},e).code,'ACTION_STARTED');for(let i=0;n.active&&i<50;i++)advance(.1);assert.equal(n.lastResult.code,'OBJECT_OBSERVED');
    // Explicit legacy-save fixture only; production no longer seeds names.
    chooseOwnName(n,n.discovery.experiments.at(-1),{objectId:source.id,at:n.elapsed,scene:n.scene,actorPosition:{...n.position},objectPosition:{...source.position}});};
  const name=n=>{for(let i=0;i<4&&!n.lexicon?.own.length;i++)inspect(n);assert.equal(n.lexicon.own.length,1);return n.lexicon.own[0];};
  const step=()=>social.naming.tick();
  return {state,a,b,e,source,social,advance,inspect,name,step,g,setVisible:v=>visible=v};
}
const storage=()=>{const map=new Map();return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};};
function physical(f){return historicalClone(f.state.agents.map(n=>({rng:n.rng,inventory:n.inventory,physiology:n.physiology,experiments:n.discovery.experiments,practice:n.discovery.practice,effects:n.discovery.effects,techniques:n.discovery.techniques})));}
function confirm(f){f.advance(SOCIAL_RULES.speechCooldown+.2);f.step();assert.equal(f.social.naming.pendingCount(),1);f.advance(.1);f.step();f.advance(SOCIAL_RULES.speechCooldown+.2);f.step();}
function assertSameExceptWorldInstance(left,right,label){
  assert.equal(left.worldLineage.instanceId,left.visualReference.worldId,'Left world keeps its two lineage tags bound');
  assert.equal(right.worldLineage.instanceId,right.visualReference.worldId,'Right world keeps its two lineage tags bound');
  assert.equal(left.worldLineage.instanceId,left.characterMessages.worldId,'Left character state keeps its world binding');
  assert.equal(right.worldLineage.instanceId,right.characterMessages.worldId,'Right character state keeps its world binding');
  assert.notEqual(left.worldLineage.instanceId,right.worldLineage.instanceId,'Independent fresh worlds have unique instance IDs');
  const normalize=world=>{
    const copy=structuredClone(world);
    copy.worldLineage.instanceId='<fresh-world-instance>';
    copy.visualReference.worldId='<fresh-world-instance>';
    copy.characterMessages.worldId='<fresh-world-instance>';
    return copy;
  };
  assert.deepEqual(normalize(left),normalize(right),label);
}

test('legacy paid-encounter fixture preserves individual naming compatibility and physical RNG',()=>{
  const f=fixture();assert.equal(f.a.lexicon,undefined);const rng=f.a.rng,own=f.name(f.a);assert.equal(f.a.rng,rng);
  assert.equal(own.objectId,f.source.id);assert.equal(validLexicon(f.a.lexicon,f.a),true);
  const other=f.name(f.b);assert.notEqual(own.token,other.token);assert.equal(other.objectId,own.objectId);
});
test('local pointing grounds and a separate later word-only request selects and confirms, without physical rewards',()=>{
  const f=fixture(),own=f.name(f.a);const before=physical(f);f.step();assert.deepEqual(physical(f),before);
  const heard=f.b.lexicon.heard[0];assert.equal(heard.token,own.token);assert.equal(heard.objectId,own.objectId);assert.equal(heard.confirmation,null);
  assert.equal(f.social.naming.pendingCount(),0);confirm(f);assert.ok(heard.confirmation);
  assert.ok(heard.grounding.at<heard.confirmation.request.at);assert.ok(heard.confirmation.request.at<heard.confirmation.selection.at);assert.ok(heard.confirmation.selection.at<heard.confirmation.confirmation.at);
  assert.deepEqual(f.b.discovery.techniques,[]);assert.deepEqual(f.b.discovery.effects,[]);assert.deepEqual(f.b.inventory.items,[]);
  assert.equal(validLexicon(f.a.lexicon,f.a),true);assert.equal(validLexicon(f.b.lexicon,f.b),true);
});
test('same prose without structured gesture never supplies a lexical association',()=>{
  const f=fixture(),own=f.name(f.a);assert.equal(f.social.say(f.a,{targetId:f.b.id,text:`I call this individual ${own.token}.`,offline:true}).ok,true);
  assert.equal(f.b.lexicon,undefined);assert.equal(resolveName(f.b,own.token,f.a.id,[own.objectId]),null);
});
test('point-only and token-permutation controls preserve visible candidates but do not resolve a learned word',()=>{
  const f=fixture(),own=f.name(f.a),objects=f.social.naming.visible(f.b);
  assert.equal(resolvePoint(objects,f.source.position)?.id,f.source.id);assert.equal(resolveName(f.b,own.token,f.a.id,objects.map(o=>o.id)),null);
  f.step();assert.equal(resolveName(f.b,own.token,f.a.id,objects.map(o=>o.id)),own.objectId);
  assert.equal(resolveName(f.b,'zulava',f.a.id,objects.map(o=>o.id)),null);
  assert.equal(resolvePoint([...objects,{...objects.find(o=>o.id===f.source.id),id:'object:999999'}],f.source.position),null);
  assert.equal(resolvePoint([],f.source.position),null);
});
test('range, sleep, occlusion and urgent bodily care prevent lexical transport',()=>{
  for(const reason of ['range','sleep','occluded','urgent']){
    const f=fixture();f.name(f.a);
    if(reason==='range')f.b.position.x+=600;
    if(reason==='sleep')f.b.lifecycle='COLLAPSED';
    if(reason==='occluded')f.setVisible(false);
    if(reason==='urgent')f.b.physiology.waterDeficitMl=5000;
    f.step();assert.equal(f.b.lexicon,undefined,reason);
  }
});
test('event-time fresh sensing does not teach a vanished or moved target from stale memory',()=>{
  const f=fixture();f.name(f.a);f.source.position={x:f.source.position.x+1000,y:f.source.position.y};
  f.step();assert.equal(f.b.lexicon,undefined);
});
test('pending reference restart clears handshake, retains labels, and never completes or replays',()=>{
  const f=fixture(),own=f.name(f.a);f.step();f.advance(SOCIAL_RULES.speechCooldown+.2);f.step();assert.equal(f.social.naming.pendingCount(),1);
  const disk=storage();assert.equal(writeOzarkSave(disk,f.state,f.g),true);
  const loaded=loadOzarkSave(disk,f.g);assert.equal(loaded.blocked,false);
  const s=loaded.state,[a,b]=s.agents;
  assert.equal(b.lexicon.heard[0].confirmation,null);assert.equal(a.lexicon.own[0].checkedWith.length,1);
  assert.equal(resolveName(b,own.token,a.id,[]),null);
  const social=new SocialCoordinator({communicationMode:'legacy',getAgents:()=>s.agents,getEnvironment:()=>s.environment,getCommunity:()=>s.community});
  assert.equal(social.naming.pendingCount(),0);social.naming.tick();assert.equal(b.lexicon.heard[0].confirmation,null);
  f.social.dispose();assert.equal(f.social.naming.pendingCount(),0);
});
test('current corrupt naming bytes fail closed instead of silently repairing tokens or owners',()=>{
  const f=fixture();f.name(f.a);f.step();const disk=storage();assert.equal(writeOzarkSave(disk,f.state,f.g),true);
  const original=disk.getItem(OZARK_SAVE_KEY);
  for(const mutation of [s=>s.agents[0].lexicon.own[0].token='__proto__',s=>s.agents[1].lexicon.ownerId='aster',s=>s.agents[1].lexicon.heard[0].grounding.at+=1e6]){
    const raw=JSON.parse(original);mutation(raw);disk.setItem(OZARK_SAVE_KEY,JSON.stringify(raw));assert.equal(loadOzarkSave(disk,f.g).blocked,true);assert.equal(disk.getItem(OZARK_SAVE_KEY),JSON.stringify(raw));
  }
});

// Negative controlled sensory ambiguity, never a source of positive evidence.
test('speaker must independently resolve the returned gesture, not trust listener selected ID',()=>{
  const f=fixture();f.name(f.a);f.step();f.advance(SOCIAL_RULES.speechCooldown+.2);f.step();
  const visible=f.social.naming.visible.bind(f.social.naming);
  f.social.naming.visible=n=>{const rows=visible(n);return n===f.a?[...rows,{...rows.find(o=>o.id===f.source.id),id:'object:999999'}]:rows;};
  f.advance(.1);f.step();assert.equal(f.social.naming.pendingCount(),0);
  f.advance(SOCIAL_RULES.speechCooldown+.2);f.step();assert.equal(f.b.lexicon.heard[0].confirmation,null);
});
test('confirmed names survive observation eviction without rebuilding sight or action authority',()=>{
  const f=fixture(),own=f.name(f.a);f.step();confirm(f);
  const binding=historicalClone(f.b.lexicon);f.b.discovery.observations={};f.b.social.heard=[];
  assert.deepEqual(f.b.lexicon,binding);assert.equal(validLexicon(f.b.lexicon,f.b),true);
  assert.equal(resolveName(f.b,own.token,f.a.id,[]),null);
  const disk=storage();assert.equal(writeOzarkSave(disk,f.state,f.g),true);
  const loaded=loadOzarkSave(disk,f.g);assert.equal(loaded.blocked,false,loaded.error);
  assert.equal(loaded.state.agents[1].discovery.observations[own.objectId],undefined);
  assert.ok(loaded.state.agents[1].lexicon.heard[0].confirmation);
});

test('word-only request may precede listener sight; later personal selection and confirmation remain required',()=>{
  const f=fixture();f.name(f.a);f.step();
  const visible=f.social.naming.visible.bind(f.social.naming);
  let listenerSees=false;
  f.social.naming.visible=n=>n===f.b&&!listenerSees?[]:visible(n);
  f.advance(SOCIAL_RULES.speechCooldown+.2);f.step();assert.equal(f.social.naming.pendingCount(),1);
  listenerSees=true;f.advance(.1);f.step();f.advance(SOCIAL_RULES.speechCooldown+.2);f.step();
  assert.ok(f.b.lexicon.heard[0].confirmation);
});
test('rejected reference evidence never utters a successful confirmation',()=>{
  const f=fixture();f.name(f.a);f.step();f.advance(SOCIAL_RULES.speechCooldown+.2);f.step();f.advance(.1);f.step();
  f.b.lexicon.heard[0].grounding.at+=1000;
  const before=f.state.community.messages.length;f.advance(SOCIAL_RULES.speechCooldown+.2);f.step();
  assert.equal(f.state.community.messages.length,before);assert.equal(f.b.lexicon.heard[0].confirmation,null);
});

test('ambiguous pointing and clarified unresolved word retain consumed opportunities across restart',()=>{
  const f=fixture({unique:false});const own=f.name(f.a);
  assert.equal(resolvePoint(f.social.naming.visible(f.b),f.source.position),null);
  f.step();assert.equal(own.announcedTo.length,1);assert.equal(f.b.lexicon,undefined);
  f.advance(SOCIAL_RULES.speechCooldown+.2);f.step();assert.equal(own.checkedWith.length,1);assert.equal(f.social.naming.pendingCount(),1);
  f.advance(.1);f.step();assert.equal(f.social.naming.pendingCount(),1);assert.equal(f.b.lexicon.heard.length,0);
  assert.equal(f.b.lexicon.repairReceipts.length,1);
  const disk=storage();assert.equal(writeOzarkSave(disk,f.state,f.g),true);
  const loaded=loadOzarkSave(disk,f.g);assert.equal(loaded.blocked,false,loaded.error);f.social.dispose();
  const state=loaded.state;for(const n of state.agents){bindOzarkWorldAgent(n,f.g,state);observeNpc(n,state.environment);}
  const before=JSON.stringify(state.agents.map(n=>n.lexicon)),messages=state.community.messages.length;
  const social=new SocialCoordinator({communicationMode:'legacy',getAgents:()=>state.agents,getEnvironment:()=>state.environment,getCommunity:()=>state.community});
  for(let i=0;i<400;i++){state.environment.elapsed+=.1;state.environment.ecology.elapsed=state.environment.elapsed;state.elapsed=state.environment.elapsed;for(const n of state.agents)tickNpc(n,.1,state.environment);social.tick(.1);}
  assert.equal(JSON.stringify(state.agents.map(n=>n.lexicon)),before);assert.equal(state.community.messages.length,messages);assert.equal(social.naming.pendingCount(),0);
});

test('ground-only safety preserves full state and pending cancellation before cooldown in both phases', () => {
  for (const phase of ['select', 'confirm']) {
    for (const reason of ['none', 'shallow-water', 'deep-water', 'deep-pond', 'sleep', 'urgent', 'contact', 'range', 'occluded']) {
      const run = legacyGround => {
        const f = fixture({legacyGround});
        f.name(f.a); f.step(); f.advance(SOCIAL_RULES.speechCooldown + .2); f.step();
        assert.equal(f.social.naming.pendingCount(), 1);
        if (phase === 'confirm') { f.advance(.1); f.step(); }
        const positions = {'shallow-water':{x:-1200,y:240}, 'deep-water':{x:-1200,y:220}, 'deep-pond':{x:-11800,y:11800}};
        // Move both actors together so water, rather than range, interrupts.
        if (positions[reason]) for (const n of [f.a,f.b]) n.position = {...positions[reason]};
        if (reason === 'sleep') f.b.lifecycle = 'COLLAPSED';
        if (reason === 'urgent') f.b.physiology.waterDeficitMl = 5000;
        if (reason === 'contact') {
          // Controlled injection of the ordinary experienced-contact event;
          // escape still needs the actor's genuinely observed reachable cells.
          recordEvent(f.b, 'condition', {code:'CONTACT_INJURY', provenance:'experienced contact',
            scene:f.b.scene, sourceId:f.source.id, sourcePosition:{x:f.b.position.x-30,y:f.b.position.y}});
          assert.ok(contactEscape(f.b), 'contact fixture must have a real observed escape route');
        }
        if (reason === 'range') f.b.position.x += 600;
        if (reason === 'occluded') f.setVisible(false);
        // Neither selection nor confirmation is eligible yet, but safety must
        // still cancel immediately at this same simulation instant.
        f.a.social.lastSpokeAt = f.b.social.lastSpokeAt = f.e.elapsed;
        const messages = f.state.community.messages.length;
        f.step();
        assert.equal(f.social.naming.pendingCount(), reason === 'none' ? 1 : 0, `${phase}: ${reason}`);
        assert.equal(f.state.community.messages.length, messages);
        assert.equal(f.b.lexicon.heard[0].confirmation, null);
        const result = historicalClone(f.state);
        f.social.dispose();
        return result;
      };
      assertSameExceptWorldInstance(run(false),run(true),`${phase}: ${reason}`);
    }
  }
});

test('ground-only safety leaves the complete successful lexical protocol state unchanged', () => {
  const run = legacyGround => {
    const f = fixture({legacyGround}); f.name(f.a); f.step(); confirm(f);
    assert.ok(f.b.lexicon.heard[0].confirmation);
    const state = historicalClone(f.state); f.social.dispose(); return state;
  };
  assertSameExceptWorldInstance(run(false),run(true));
});

test('fresh ordinary paid encounters do not create seeded names when no local model is configured',()=>{
  const f=fixture();
  assert.equal(requestNpcAction(f.a,{type:'inspect_object',targetId:f.source.id},f.e).code,'ACTION_STARTED');
  for(let i=0;f.a.active&&i<50;i++)f.advance(.1);
  assert.equal(f.a.lastResult.code,'OBJECT_OBSERVED');
  assert.equal(f.a.lexicon,undefined);assert.equal(f.a.categoryNames,undefined);
  assert.ok(f.a.discovery.experiments.some(e=>e.primitive==='inspect_object'&&e.ok));
});
