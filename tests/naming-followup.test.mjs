import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG,SOCIAL_RULES } from '../src/config.js';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { createOzarkState,writeOzarkSave,loadOzarkSave,OZARK_SAVE_KEY } from '../src/ozark-save.js';
import { bindOzarkWorldAgent } from '../src/ozark-agent-world.js';
import { observeNpc,requestNpcAction,tickNpc } from '../src/npc.js';
import { SocialCoordinator } from '../src/social.js';
import { NpcController } from '../src/controller.js';
import { motorStalled } from '../src/movement-recovery.js';
import { resolvePoint } from '../src/naming-runtime.js';
import { validLexicon,resolveName } from '../src/naming-state.js';
import { contactEscape } from '../src/discovery.js';
import { recordEvent } from '../src/npc-memory.js';
const geometry=createOzarkWorldGeometry();
function fixture({unique=true,legacyGround=false}={}){
  let visible=true,groundOverride=null;
  const g=Object.freeze({...geometry,groundAt:point=>groundOverride??(legacyGround?geometry.observe(point).ground:geometry.groundAt(point)),lineOfSight:(...args)=>visible&&geometry.lineOfSight(...args)});
  const state=createOzarkState(g),[a,b]=state.agents,e=state.environment;
  state.elapsed=e.elapsed=e.ecology.elapsed=60;
  const source=e.ecology.plants.find(p=>p.kind==='apple_tree'&&p.quantity>0&&
    (!unique||e.ecology.plants.filter(o=>Math.hypot(o.position.x-p.position.x,o.position.y-p.position.y)<=12).length===1)&&
    [45,65].every(dx=>geometry.canOccupy(p.position.x+dx,p.position.y,CONFIG.playerRadius)&&geometry.lineOfSight({x:p.position.x+dx,y:p.position.y},p.position)));
  assert.ok(source);
  for(const [n,dx] of [[a,45],[b,65]]){n.elapsed=60;n.position={x:source.position.x+dx,y:source.position.y};bindOzarkWorldAgent(n,g,state);observeNpc(n,e);}
  const social=new SocialCoordinator({getAgents:()=>state.agents,getEnvironment:()=>e,getCommunity:()=>state.community});
  const advance=seconds=>{for(let t=0;t<seconds-1e-8;t+=.1){e.elapsed+=.1;state.elapsed=e.elapsed;e.ecology.elapsed=e.elapsed;for(const n of state.agents)tickNpc(n,.1,e);}};
  const inspect=n=>{assert.equal(requestNpcAction(n,{type:'inspect_object',targetId:source.id},e).code,'ACTION_STARTED');for(let i=0;n.active&&i<50;i++)advance(.1);assert.equal(n.lastResult.code,'OBJECT_OBSERVED');};
  const name=n=>{for(let i=0;i<4&&!n.lexicon?.own.length;i++)inspect(n);assert.equal(n.lexicon.own.length,1);return n.lexicon.own[0];};
  const step=()=>social.naming.tick();
  return {state,a,b,e,source,social,advance,inspect,name,step,g,setVisible:v=>visible=v,setGround:v=>groundOverride=v};
}
const storage=()=>{const map=new Map();return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};};
function physical(f){return structuredClone(f.state.agents.map(n=>({rng:n.rng,inventory:n.inventory,physiology:n.physiology,experiments:n.discovery.experiments,practice:n.discovery.practice,effects:n.discovery.effects,techniques:n.discovery.techniques})));}
function confirm(f){f.advance(SOCIAL_RULES.speechCooldown+.2);f.step();assert.equal(f.social.naming.pendingCount(),1);f.advance(.1);f.step();f.advance(SOCIAL_RULES.speechCooldown+.2);f.step();}



function grounded(){const f=fixture();f.name(f.a);f.step();assert.equal(f.social.naming.opportunityCount(),1);return f;}
function fastConfirm(f){for(let i=0;i<40;i++){f.advance(.1);f.step();if(f.b.lexicon.heard[0].confirmation)return;}assert.fail('no confirmation');}

test('bounded follow-up timing completes independent name reference without pausing either body',()=>{
  const f=grounded(),before=physical(f);fastConfirm(f);
  const c=f.b.lexicon.heard[0].confirmation;
  assert.ok(c.request.at-f.b.lexicon.heard[0].grounding.at>=1);
  assert.ok(c.selection.at-c.request.at>=1);assert.ok(c.confirmation.at-c.selection.at>=1);
  assert.equal(f.social.naming.opportunityCount(),0);assert.equal(f.social.naming.pendingCount(),0);
  assert.equal(f.social.naming.chooseAttention,undefined,'no controller hold API');
  assert.deepEqual(f.b.inventory.items,[]);assert.deepEqual(f.b.discovery.effects,[]);
  assert.deepEqual(f.b.discovery.practice,before[1].practice);
  assert.ok(f.e.elapsed>f.b.lexicon.heard[0].grounding.at);
  assert.equal(f.social.naming.ready(f.a),false,'global cooldown applies after exchange');
});
test('speaking does not cancel or hold an ordinary paid action or fabricate motor progress',()=>{
  const f=grounded();assert.equal(requestNpcAction(f.b,{type:'wait',seconds:5},f.e).code,'STARTED');
  const active=f.b.active,motor={};assert.equal(motorStalled(motor,.6,60,0),false);
  fastConfirm(f);assert.equal(f.b.active,active,'ongoing action unchanged');
  assert.equal(motorStalled(motor,.4,40,0),true,'unrelated motor evidence not reset');
  f.advance(3);assert.equal(f.b.active,null);assert.equal(f.b.lastResult.ok,true);
  assert.equal(f.b.memory.experience.some(e=>e.details?.result?.code==='PRIORITY_CHANGED'),false);
});
test('ordinary controllers complete follow-up while body and action time continue',()=>{
  const f=grounded(),controllers=f.state.agents.map(n=>new NpcController(n,{environment:f.e,social:f.social}));
  const born=f.e.elapsed,before=f.state.agents.map(n=>n.physiology.totals.metabolizedKcal);
  for(let i=0;i<240&&!f.b.lexicon.heard[0].confirmation;i++){
    f.e.elapsed+=1/60;f.state.elapsed=f.e.elapsed;f.e.ecology.elapsed=f.e.elapsed;
    for(const c of controllers)c.tick(1/60);f.social.tick(1/60);
  }
  assert.ok(f.b.lexicon.heard[0].confirmation);
  for(const [i,n]of f.state.agents.entries()){assert.equal(n.elapsed,f.e.elapsed);assert.ok(n.physiology.totals.metabolizedKcal>before[i]);}
  assert.ok(f.e.elapsed-born>=3);controllers.forEach(c=>c.dispose());
});
test('safety, loss of local referent and food handover end accelerated opportunity',()=>{
  for(const reason of ['thirst','contact','sleep','water','range','sight','object','food']){
    const f=grounded();
    if(reason==='thirst'){f.a.physiology.waterDeficitMl=5000;f.a.memory.sources={};}
    if(reason==='contact')recordEvent(f.a,'condition',{code:'CONTACT_INJURY',provenance:'experienced contact',scene:f.a.scene});
    if(reason==='sleep')f.a.lifecycle='COLLAPSED';
    if(reason==='water')f.setGround('deep-water');
    if(reason==='range')f.b.position.x+=600;
    if(reason==='sight')f.setVisible(false);
    if(reason==='object')f.source.position.x+=1000;
    if(reason==='food')f.social.foodSharing.holding=n=>n===f.b;
    f.step();assert.equal(f.social.naming.opportunityCount(),0,reason);
    assert.equal(f.b.lexicon.heard[0].confirmation,null,reason);
  }
});
test('unrelated speech spacing is respected, expiry cannot renew or grant more follow-up turns',()=>{
  const f=grounded();f.advance(.8);f.b.social.lastSpokeAt=f.e.elapsed;
  f.advance(.3);f.step();assert.equal(f.a.lexicon.own[0].checkedWith.length,0);
  f.advance(.8);f.step();assert.equal(f.a.lexicon.own[0].checkedWith.length,1);
  f.advance(8);f.step();assert.equal(f.social.naming.opportunityCount(),0);assert.equal(f.social.naming.pendingCount(),0);
  assert.equal(f.b.lexicon.heard[0].confirmation,null);
  const messages=f.state.community.messages.length;
  f.advance(36);f.step();assert.equal(f.state.community.messages.length,messages,'consumed request is not retried');
});
test('restart drops continuation and consumed request without replaying confirmation',()=>{
  for(const requested of [false,true]){
    const f=grounded();if(requested){f.advance(1.1);f.step();assert.equal(f.a.lexicon.own[0].checkedWith.length,1);}
    const disk=storage();assert.equal(writeOzarkSave(disk,f.state,f.g),true);
    const loaded=loadOzarkSave(disk,f.g);assert.equal(loaded.blocked,false,loaded.error);
    const state=loaded.state,social=new SocialCoordinator({getAgents:()=>state.agents,getEnvironment:()=>state.environment,getCommunity:()=>state.community});
    assert.equal(social.naming.opportunityCount(),0);assert.equal(social.naming.pendingCount(),0);
    assert.equal(state.agents[1].lexicon.heard[0].confirmation,null);
    assert.equal(state.agents[0].lexicon.own[0].checkedWith.length,requested?1:0);
    f.social.dispose();assert.equal(f.social.naming.opportunityCount(),0);
  }
});

test('ordinary speech cooldown still avoids full referent sensing outside a continuation',()=>{
  const f=grounded();f.social.naming.dispose();
  const social=new SocialCoordinator({getAgents:()=>f.state.agents,getEnvironment:()=>f.e,getCommunity:()=>f.state.community});
  let calls=0;const original=social.naming.visible.bind(social.naming);social.naming.visible=n=>{calls++;return original(n);};
  social.naming.tick();assert.equal(calls,0);assert.equal(social.naming.opportunityCount(),0);
});
