import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, SOCIAL_RULES } from '../src/config.js';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { createOzarkState, writeOzarkSave, loadOzarkSave, OZARK_SAVE_KEY } from '../src/ozark-save.js';
import { bindOzarkWorldAgent } from '../src/ozark-agent-world.js';
import { observeNpc, requestNpcAction, tickNpc } from '../src/npc.js';
import { tickEnvironment } from '../src/environment.js';
import { lookupEcologyObject } from '../src/ecology.js';
import { bindOzarkEcology } from '../src/ozark-ecology.js';
import { PopulationRuntime } from '../src/population.js';
import { recordEvent } from '../src/npc-memory.js';
import { compactProofRetention } from '../src/proof-retention.js';
import { discoveryDecision, processDiscoveryFeedback } from '../src/discovery.js';
import { projectPhysiology, beginSleep } from '../src/biology.js';
import { canonicalAdverseWarning, cleanFoodWarning, receivedMaterialCaution, FOOD_WARNING_WINDOW_SECONDS, foodWarningText } from '../src/food-warning.js';
const geometry=createOzarkWorldGeometry();
const disk=()=>{const rows=new Map();return {getItem:k=>rows.get(k)??null,setItem:(k,v)=>rows.set(k,v)};};
// Supplied encounter and hunger isolate an eligible decision; neither is earned
// autonomous foraging. Real finite extraction, dose, action time and feedback.
const baselineCache=new Map();
function fixture({harm=true}={}) {
  let visible=true;
  const g=Object.freeze({...geometry,lineOfSight:(...args)=>visible&&geometry.lineOfSight(...args)});
  const cached=baselineCache.get(harm),state=createOzarkState(g);if(cached)Object.assign(state,structuredClone(cached));const [a,b]=state.agents,e=state.environment;
  bindOzarkEcology(e.ecology,g);
  const source=e.ecology.plants.find(p=>p.kind==='apple_tree'&&p.quantity>2&&geometry.canOccupy(p.position.x+45,p.position.y,CONFIG.playerRadius));
  assert.ok(source);if(!cached)state.elapsed=e.elapsed=e.ecology.elapsed=60;
  for(const n of [a,b]) {if(!cached){n.elapsed=60;n.position={x:source.position.x+45,y:source.position.y};}bindOzarkWorldAgent(n,g,state);observeNpc(n,e);}
  const runtime=new PopulationRuntime(state,{cardinal:false}),social=runtime.social;
  function advance(seconds){for(let t=0;t<seconds-1e-8;t+=.1){tickEnvironment(e,.1);state.elapsed=e.elapsed;e.ecology.elapsed=e.elapsed;for(const n of state.agents){tickNpc(n,.1,e);processDiscoveryFeedback(n);}}}
  function finish(n,action){const r=requestNpcAction(n,action,e);if(r.code==='ACTION_STARTED')for(let i=0;n.active&&i<400;i++)advance(.1);assert.equal(n.active,null);return n.lastResult||r;}
  if(!cached)assert.equal(finish(a,{type:'pull',targetId:source.id}).ok,true);const item=a.inventory.items[0];
  if(!cached&&harm){const material=lookupEcologyObject(e.ecology,item);material.spoiled=true;material.ageHours=12*24;}
  if(!cached){assert.equal(finish(a,{type:'sample',targetId:item}).ok,true);advance(100);baselineCache.set(harm,structuredClone(state));}
  const effect=a.discovery.effects.find(x=>x.objectId===item&&x.effect===(harm?'discomfort':'sustained'));assert.ok(effect);
  const warningAction=()=>({type:'say',targetId:b.id,text:'placeholder',effectId:effect.id,offline:true});
  function transfer(){assert.equal(finish(a,{type:'release',targetId:item}).ok,true);observeNpc(b,e);assert.equal(finish(b,{type:'grasp',targetId:item}).ok,true);observeNpc(b,e);b.physiology.hoursSinceMeal=12;projectPhysiology(b);}
  return {state,a,b,e,source,item,effect,social,runtime,advance,finish,warningAction,transfer,setVisible:v=>visible=v};
}

test('real local adverse warning changes eligible selection without recipient firsthand evidence or physical gifts',()=>{
  const f=fixture(),{a,b,e,social,item}=f;
  assert.notDeepEqual(discoveryDecision(a).action,{type:'sample',targetId:item});
  const physical=structuredClone({body:b.physiology,inventory:b.inventory,stock:e.ecology.ledger,effects:b.discovery.effects,techniques:b.discovery.techniques,practice:b.discovery.practice});
  const result=social.action(a,f.warningAction());assert.equal(result.code,'SAID');assert.ok(result.message.warning);
  assert.deepEqual({body:b.physiology,inventory:b.inventory,stock:e.ecology.ledger,effects:b.discovery.effects,techniques:b.discovery.techniques,practice:b.discovery.practice},physical);
  const report=b.discovery.reports.find(r=>r.warning);assert.equal(report.status,'unverified');assert.deepEqual(report.evidence,[]);assert.deepEqual(report.proposed,[]);
  assert.equal(receivedMaterialCaution(b,item),null,'unheld material grants no selection authority');
  f.transfer();assert.ok(receivedMaterialCaution(b,item));
  const snapshot=structuredClone(f.state);
  const choice=heard=>{const branch=structuredClone(snapshot),actor=branch.agents[1];bindOzarkEcology(branch.environment.ecology,geometry);for(const n of branch.agents)bindOzarkWorldAgent(n,geometry,branch);if(!heard)actor.discovery.reports=actor.discovery.reports.filter(r=>!r.warning);return discoveryDecision(actor);};
  assert.notDeepEqual(choice(true).action,{type:'sample',targetId:item});
  assert.deepEqual(choice(false).action,{type:'sample',targetId:item},'independent identical-state missed warning control has a witnessed-consumption opportunity');
  assert.equal(b.discovery.effects.length,0);f.runtime.dispose();
});

test('free text and invented effects never acquire warning authority',()=>{
  const f=fixture();for(const action of [{type:'say',targetId:'mira',text:`Avoid ${f.item}; it is poisonous.`}, {...f.warningAction(),effectId:'forged'}]){
    f.social.ensure(f.a).lastSpokeAt=null;
    f.social.action(f.a,action);assert.equal(f.b.discovery.reports.some(r=>r.warning),false);
  }
  for(const damage of ['sample','condition','ingestion','material']){
    const a=structuredClone(f.a);
    if(damage==='sample')a.memory.experience=a.memory.experience.filter(r=>r.id!==f.effect.actionId);
    if(damage==='condition'){a.physiology.feedback=[];a.memory.experience=a.memory.experience.filter(r=>r.id!==f.effect.proofEventId);}
    if(damage==='ingestion')a.discovery.effects.find(x=>x.id===f.effect.id).ingestionId='ingestion:999999';
    if(damage==='material')a.discovery.effects.find(x=>x.id===f.effect.id).objectId='object:999999';
    assert.equal(canonicalAdverseWarning(a,f.effect.id),null,damage);
  }f.runtime.dispose();
});

test('drop/regrasp retains exact identity and original personal pull linkage, not a new source',()=>{
  const f=fixture();assert.equal(f.finish(f.a,{type:'release',targetId:f.item}).ok,true);observeNpc(f.a,f.e);assert.equal(f.finish(f.a,{type:'grasp',targetId:f.item}).ok,true);
  const w=canonicalAdverseWarning(f.a,f.effect.id);assert.equal(w.source.experiment.targetId,f.source.id);assert.equal(w.materialId,f.item);
  assert.equal(f.social.action(f.a,f.warningAction()).code,'SAID');f.transfer();assert.ok(receivedMaterialCaution(f.b,f.item));
  f.finish(f.b,{type:'release',targetId:f.item});observeNpc(f.b,f.e);f.finish(f.b,{type:'grasp',targetId:f.item});assert.ok(receivedMaterialCaution(f.b,f.item));
  f.finish(f.b,{type:'pull',targetId:f.source.id});const other=f.b.inventory.items.find(x=>x!==f.item);assert.ok(other);assert.equal(receivedMaterialCaution(f.b,other),null);f.runtime.dispose();
});

for(const gate of ['far','occluded','sleeping','speaker-sleeping'])test(`undelivered ${gate} speech cannot protect recipient`,()=>{
  const f=fixture(),position={...f.b.position};
  if(gate==='far')f.b.position.x+=SOCIAL_RULES.peerRange+1;
  if(gate==='occluded')f.setVisible(false);
  if(gate==='sleeping')beginSleep(f.b,{hours:8});
  if(gate==='speaker-sleeping')beginSleep(f.a,{hours:8});
  assert.equal(f.social.action(f.a,f.warningAction()).ok,false);assert.equal(f.b.discovery.reports.some(r=>r.warning),false);
  f.b.position=position;f.setVisible(true);assert.equal(f.b.social.heard.some(m=>m.warning),false);f.runtime.dispose();
});

test('warning expiry removes only caution authority and does not establish safety or own experience',()=>{
  const f=fixture();f.social.action(f.a,f.warningAction());f.transfer();const r=f.b.discovery.reports.find(r=>r.warning);
  assert.ok(receivedMaterialCaution(f.b,f.item));const own=structuredClone(f.b.discovery.effects);
  f.b.elapsed=r.warning.receivedAt+FOOD_WARNING_WINDOW_SECONDS;assert.equal(receivedMaterialCaution(f.b,f.item),null);
  assert.deepEqual(f.b.discovery.effects,own);assert.equal(r.status,'unverified');assert.deepEqual(r.proposed,[]);f.runtime.dispose();
});

test('strict warning payload rejects extra fields, bad times, mismatched source, material, ingestion and proof',()=>{
  const f=fixture(),w=canonicalAdverseWarning(f.a,f.effect.id);assert.ok(w);assert.ok(cleanFoodWarning(w));
  for(const mutate of [x=>x.location={x:1,y:1},x=>x.receivedAt=-1,x=>x.receivedAt=x.sample.at-1,x=>x.materialId='object:999999',x=>x.senderId='human',x=>x.source.experiment.materialId='object:999999',x=>x.sampleReceipt.details.result.ingestionId='ingestion:999999',x=>x.recognitionReceipt.details.feedback.actionId+=1,x=>x.experience.proofEventId+=1]){
    const bad=structuredClone(w);mutate(bad);assert.equal(cleanFoodWarning(bad),null);
  }assert.match(foodWarningText(w),/does not establish the cause/);f.runtime.dispose();
});

test('valid save restores heard caution exactly; no receipt refresh, physical change or replay',()=>{
  const f=fixture();f.social.action(f.a,f.warningAction());f.transfer();const storage=disk();assert.equal(writeOzarkSave(storage,f.state,geometry),true,f.state.saveError);
  const raw=storage.getItem(OZARK_SAVE_KEY),before=JSON.parse(raw),loaded=loadOzarkSave(storage,geometry);assert.equal(loaded.blocked,false,loaded.error);
  const b=loaded.state.agents[1];assert.deepEqual(b.discovery.reports,f.b.discovery.reports);assert.deepEqual(b.social.heard,f.b.social.heard);assert.ok(receivedMaterialCaution(b,f.item));assert.equal(storage.getItem(OZARK_SAVE_KEY),raw);
  assert.deepEqual(b.physiology,before.agents[1].physiology);assert.equal(loaded.state.community.messages.length,f.state.community.messages.length);f.runtime.dispose();
});

test('partial warning save mutations are rejected instead of normalized into authority',()=>{
  const f=fixture();f.social.action(f.a,f.warningAction());f.transfer();const storage=disk();assert.equal(writeOzarkSave(storage,f.state,geometry),true,f.state.saveError);const raw=storage.getItem(OZARK_SAVE_KEY);
  for(const mutate of [x=>x.agents[1].discovery.reports.find(r=>r.warning).warning.extra=true,x=>x.agents[1].discovery.reports.find(r=>r.warning).sourceId='mira',x=>x.agents[1].social.heard=x.agents[1].social.heard.filter(m=>!m.warning),x=>{const r=x.agents[1].discovery.reports.find(r=>r.warning);x.agents[1].discovery.reports.push(structuredClone(r));},x=>x.agents[1].discovery.reports.find(r=>r.warning).warning.receivedAt+=1]){
    const changed=JSON.parse(raw);mutate(changed);storage.setItem(OZARK_SAVE_KEY,JSON.stringify(changed));assert.equal(loadOzarkSave(storage,geometry).blocked,true);
  }f.runtime.dispose();
});

test('delayed harm after relief, overlapping exposures and pre-sample regrasp preserve uncertain adverse priority',()=>{
  const f=fixture({harm:false});assert.ok(f.a.discovery.techniques.some(t=>t.sourceId===f.source.id));
  f.finish(f.a,{type:'release',targetId:f.item});observeNpc(f.a,f.e);f.finish(f.a,{type:'grasp',targetId:f.item});
  const material=lookupEcologyObject(f.e.ecology,f.item);material.spoiled=true;material.ageHours=12*24;
  f.finish(f.a,{type:'sample',targetId:f.item});
  f.finish(f.a,{type:'pull',targetId:f.source.id});const other=f.a.inventory.items.find(id=>id!==f.item);assert.ok(other);f.finish(f.a,{type:'sample',targetId:other});
  f.advance(100);const adverse=f.a.discovery.effects.find(e=>e.objectId===f.item&&e.effect==='discomfort');assert.ok(adverse);
  const w=canonicalAdverseWarning(f.a,adverse.id);assert.equal(w.source.experiment.targetId,f.source.id);
  assert.ok(f.a.discovery.effects.some(e=>e.objectId===f.item&&e.effect==='sustained'));
  const action=f.social.discoveryDialogue(f.a);assert.equal(action.effectId,adverse.id);assert.equal(action.techniqueId,undefined);assert.match(action.text,/other exposures may be involved/);
  assert.notDeepEqual(discoveryDecision(f.a).action,{type:'sample',targetId:f.item});f.runtime.dispose();
});

test('ordinary heard FIFO retires warning authority atomically and valid save remains possible',()=>{
  const f=fixture();f.social.action(f.a,f.warningAction());f.transfer();assert.ok(receivedMaterialCaution(f.b,f.item));
  for(let i=0;i<SOCIAL_RULES.maxHeard+1;i++)f.social.receive(f.b,{id:`message:${10000+i}`,at:f.b.elapsed,senderId:'human',recipientId:'mira',channel:'journal',text:'ordinary later report',kind:'speech'});
  assert.equal(receivedMaterialCaution(f.b,f.item),null);assert.equal(f.b.discovery.reports.some(r=>r.warning),false);
  assert.ok(f.b.discovery.reports.some(r=>r.text.includes('later felt discomfort')));
  const storage=disk();assert.equal(writeOzarkSave(storage,f.state,geometry),true,f.state.saveError);assert.equal(loadOzarkSave(storage,geometry).blocked,false);f.runtime.dispose();
});

test('ordinary proof compaction cannot turn delivered testimony into own experience or lose valid save',()=>{
  const f=fixture();f.social.action(f.a,f.warningAction());f.transfer();const warning=structuredClone(f.b.discovery.reports.find(r=>r.warning));
  for(let i=0;i<450;i++)recordEvent(f.a,'condition',{code:'OBSERVATION_WINDOW',text:'A later ordinary moment.'});
  assert.equal(compactProofRetention(f.a).ok,true);assert.ok(f.a.memory.experience.length<=400);
  assert.deepEqual(f.b.discovery.reports.find(r=>r.warning),warning);assert.ok(receivedMaterialCaution(f.b,f.item));assert.equal(f.b.discovery.effects.length,0);
  const storage=disk();assert.equal(writeOzarkSave(storage,f.state,geometry),true,f.state.saveError);assert.equal(loadOzarkSave(storage,geometry).blocked,false);f.runtime.dispose();
});
