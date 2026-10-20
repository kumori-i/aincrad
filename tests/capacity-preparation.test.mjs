import test from 'node:test';
import assert from 'node:assert/strict';
import { createOzarkState, writeOzarkSave, loadOzarkSave } from '../src/ozark-save.js';
import { lookupEcologyObject } from '../src/ecology.js';
import { observeNpc, requestNpcAction, cancelNpcAction } from '../src/npc.js';
import { projectPhysiology } from '../src/biology.js';
import { bodySignals } from '../src/interoception.js';
import { discoveryDecision, recordDiscoveryReport } from '../src/discovery.js';
import { validateNpc } from '../src/npc-memory.js';
import { retainedProofIntegrityError } from '../src/proof-retention.js';
import { distance } from '../src/world.js';

import { geometry, fixture, tick, act, place, comfortableHungry, pendingIdentity } from './fixtures/capacity-preparation.mjs';
const clone=structuredClone;
function prepare(f) {
  const d=discoveryDecision(f.n);assert.equal(d.need,'food');assert.equal(d.action.type,'release');
  assert.equal(d.reason,'I have put this held object down and picked it up before. I can try putting it down here to make room for the source sequence that previously brought bodily relief.');
  return d;
}

// Written before production changes. All positive evidence above is generated
// through native physical actions and the actor's own delayed recognition.
test('one paid preparation restores an earned acquisition, new sampling, and own later feedback',()=>{
  const f=fixture(),{n,e,source}=f,donor=n.inventory.items.at(-1),pending=clone(n.discovery.samplesPending),gut=pendingIdentity(n);
  const technique=n.discovery.techniques.find(t=>t.sourceId===source.id),credit=technique.successes,meals=n.stats.independentMeals;
  const decision=prepare(f);assert.equal(decision.action.targetId,donor);assert.equal(n.discovery.run.cursor,0);
  assert.deepEqual(n.discovery.samplesPending,pending);assert.deepEqual(pendingIdentity(n),gut);
  const material=lookupEcologyObject(e.ecology,donor),mass=material.massGrams,position={...n.position};
  const released=act(f,decision.action);assert.equal(released.code,'object_released');assert.ok(released.durationSeconds>0);assert.ok(released.handling.activeActionSeconds>0);
  assert.equal(n.inventory.items.length,3);assert.equal(n.discovery.run.cursor,0);assert.equal(n.discovery.run.materialId,null);
  assert.equal(material.heldBy,null);assert.deepEqual(material.position,position);assert.equal(material.id,donor);assert.equal(material.massGrams,mass);
  assert.equal(technique.successes,credit);assert.equal(n.stats.independentMeals,meals);assert.deepEqual(pendingIdentity(n),gut);
  assert.deepEqual(discoveryDecision(n).action,{type:'pull',targetId:source.id});const pulled=act(f,{type:'pull',targetId:source.id});assert.equal(pulled.ok,true);
  const newId=pulled.materialId;assert.equal(n.discovery.run.cursor,1);assert.equal(n.discovery.run.materialId,newId);assert.notEqual(newId,donor);
  assert.deepEqual(discoveryDecision(n).action,{type:'sample',targetId:newId});const sampled=act(f,{type:'sample',targetId:newId});assert.equal(sampled.ok,true);
  assert.equal(technique.successes,credit);assert.equal(n.stats.independentMeals,meals);
  for(let i=0;i<1200&&!n.discovery.effects.some(e=>e.objectId===newId&&e.effect==='sustained');i++)tick(f);
  const effect=n.discovery.effects.find(e=>e.objectId===newId&&e.effect==='sustained');assert.ok(effect);assert.equal(effect.ingestionId,sampled.ingestionId);assert.equal(effect.actionId,sampled.eventId);
  assert.equal(retainedProofIntegrityError(n),null);assert.ok(lookupEcologyObject(e.ecology,donor));
});

test('full-handed approach pays for movement before selecting a release at acquisition reach',()=>{
  const f=fixture(),{n,source}=f;place(f,{x:source.position.x+280,y:source.position.y});
  const before=n.inventory.items.slice();const first=discoveryDecision(n);assert.equal(first.need,'food');assert.equal(first.action.type,'move');assert.deepEqual(n.inventory.items,before);
  for(let i=0;i<8;i++) { const decision=i===0?first:discoveryDecision(n);if(decision.action.type==='release'){assert.ok(distance(n.position,source.position)<=80);return;}assert.equal(decision.action.type,'move');assert.equal(act(f,decision.action).ok,true);observeNpc(n,f.e); }
  assert.fail('observed route should reach the acquisition boundary');
});

test('missing or mismatched handling witnesses cannot authorize purposeful preparation',()=>{
  for(const damage of ['all-release','grasp-receipt','release-receipt','source-proof','ablation']) {
    const f=fixture(),{n}=f;
    if(damage==='all-release')n.discovery.experiments=n.discovery.experiments.filter(e=>e.primitive!=='release');
    if(damage==='grasp-receipt')for(const e of n.memory.experience)if(e.details.action?.type==='grasp')e.details.result.materialId='object:999999';
    if(damage==='release-receipt')for(const e of n.memory.experience)if(e.details.action?.type==='release')e.at+=1;
    if(damage==='source-proof')n.discovery.effects=[];
    const decision=discoveryDecision(n,{foodLearning:damage!=='ablation'});assert.notEqual(decision.need,'food',damage);assert.equal(n.discovery.run,null,damage);
  }
});

test('existing eligible held relief wins before preparation and after an approach starts',()=>{
  const f=fixture(),{n,source}=f;
  // Earn a new exact-item benefit physically, then refill the fourth slot by
  // grasping an actually released, previously handled item. No effect is seeded.
  const donor=n.inventory.items[0];assert.equal(act(f,{type:'release',targetId:donor}).ok,true);
  assert.equal(act(f,{type:'pull',targetId:source.id}).ok,true);const food=n.inventory.items.at(-1);assert.equal(act(f,{type:'sample',targetId:food}).ok,true);
  for(let i=0;i<1200&&!n.discovery.effects.some(e=>e.objectId===food&&e.effect==='sustained');i++)tick(f);
  assert.ok(n.discovery.effects.some(e=>e.objectId===food&&e.effect==='sustained'));comfortableHungry(n);observeNpc(n,f.e);
  assert.deepEqual(discoveryDecision(n).action,{type:'sample',targetId:food});
  n.discovery.run={techniqueId:n.discovery.techniques.find(t=>t.sourceId===source.id).id,cursor:0,materialId:null,awaiting:false,startedAt:n.elapsed};
  assert.deepEqual(discoveryDecision(n).action,{type:'sample',targetId:food},'a live acquisition cannot park newly useful food');
});

test('release failure or cancellation never advances or penalizes the learned technique',()=>{
  for(const mode of ['cancel','ownership']) {
    const f=fixture(),{n,e}=f,d=prepare(f),t=n.discovery.techniques.find(t=>t.id===n.discovery.run.techniqueId),before=clone(t);
    assert.equal(requestNpcAction(n,d.action,e).code,'ACTION_STARTED');tick(f,.2);
    if(mode==='cancel')assert.equal(cancelNpcAction(n),true);
    else {lookupEcologyObject(e.ecology,d.action.targetId).heldBy='mira';for(let i=0;i<50&&n.active;i++)tick(f);}
    assert.equal(n.lastResult.ok,false);assert.deepEqual(t,before);assert.equal(n.inventory.items.length,4);
    if(n.discovery.run)assert.equal(n.discovery.run.cursor,0);
    for(let i=0;i<4;i++)assert.notEqual(discoveryDecision(n).need,'food','no immediate second preparatory donor');
  }
});

test('urgent care, source feedback and availability gates retain priority over preparation',()=>{
  for(const kind of ['water','sleep','rest','content','full','revised','gone','pending-source','no-route']) {
    const f=fixture(),{n,source}=f;
    if(kind==='water'){n.physiology.waterDeficitMl=4000;n.flask.water=.5;projectPhysiology(n);}
    if(kind==='sleep'){n.physiology.sleepPressure=99;projectPhysiology(n);}
    if(kind==='rest'){n.physiology.stamina=5;projectPhysiology(n);}
    if(kind==='content'){n.physiology.hoursSinceMeal=1;projectPhysiology(n);}
    if(kind==='full'){for(const p of n.physiology.stomach)p.remainingMassGrams=1000;projectPhysiology(n);}
    if(kind==='revised')n.discovery.techniques[0].confidence='revised';
    if(kind==='gone'){source.quantity=0;assert.equal(act(f,{type:'pull',targetId:source.id}).code,'HANDS_FULL');const id=n.inventory.items[0];act(f,{type:'release',targetId:id});assert.equal(act(f,{type:'pull',targetId:source.id}).code,'nothing_detached');act(f,{type:'grasp',targetId:id});}
    if(kind==='pending-source'){const e=n.discovery.experiments.find(e=>e.primitive==='pull'&&e.targetId===source.id);n.discovery.samplesPending[e.materialId]=n.elapsed;}
    if(kind==='no-route'){place(f,{x:source.position.x+300,y:source.position.y});n.memory.cells={};}
    const d=discoveryDecision(n);assert.notEqual(d.need,'food',kind);
  }
});

test('a prepared slot is not consumed by novelty and a second slot is never prepared in the same run',()=>{
  const f=fixture(),{n}=f,d=prepare(f);assert.equal(act(f,d.action).ok,true);
  const run=n.discovery.run;assert.equal(run.cursor,0);
  // External refill is an explicitly adversarial fixture, through the same paid
  // physical primitive; it must not authorize a second preparation in this run.
  assert.equal(act(f,{type:'grasp',targetId:d.action.targetId}).ok,true);assert.equal(n.inventory.items.length,4);
  const next=discoveryDecision(n);assert.notEqual(next.need,'food');assert.equal(n.discovery.run?.cursor??0,0);
});

test('native placement remains ordinary same-ID finite matter, recoverable and not reserved',()=>{
  const f=fixture(),{n,e}=f,d=prepare(f);assert.equal(act(f,d.action).ok,true);const material=lookupEcologyObject(e.ecology,d.action.targetId),mass=material.massGrams;
  assert.equal(act(f,{type:'grasp',targetId:d.action.targetId}).ok,true);assert.equal(material.heldBy,n.id);assert.equal(material.massGrams,mass);
  assert.equal(act(f,{type:'release',targetId:d.action.targetId}).ok,true);
  const other=f.state.agents[1];other.position={...n.position};observeNpc(other,e);const g={...f,n:other};assert.equal(act(g,{type:'grasp',targetId:d.action.targetId}).ok,true);
  assert.equal(act(f,{type:'grasp',targetId:d.action.targetId}).code,'HELD_BY_ANOTHER');assert.equal(material.heldBy,other.id);assert.equal(material.massGrams,mass);
});

test('restore clears preparation while preserving released matter and pending digestion without new schema',()=>{
  const f=fixture(),{n,e}=f,d=prepare(f);assert.equal(act(f,d.action).ok,true);const pending=clone(n.discovery.samplesPending),gut=pendingIdentity(n),donor=d.action.targetId;
  const rows=new Map(),disk={getItem:key=>rows.get(key)??null,setItem:(key,value)=>rows.set(key,value)};
  const savable=Object.assign(createOzarkState(geometry),f.state);
  assert.equal(writeOzarkSave(disk,savable,geometry),true);const restored=loadOzarkSave(disk,geometry);assert.equal(restored.blocked,false,restored.error);
  const actor=restored.state.agents[0];assert.equal(actor.discovery.run,null);assert.deepEqual(actor.discovery.samplesPending,pending);assert.deepEqual(pendingIdentity(actor),gut);
  assert.equal(lookupEcologyObject(restored.state.environment.ecology,donor).heldBy,null);assert.equal(retainedProofIntegrityError(actor),null);
  assert.equal(Object.hasOwn(actor.discovery,'preparedPlacement'),false);
});

test('current sensed wet footing and unknown legacy footing never authorize preparation',()=>{
  const f=fixture(),{n,source}=f;
  // Explicit sensory-location fixture: the remembered goal is presented nearby
  // while the actual body is on reachable wet footing. No action is executed.
  const wet={x:-1200,y:240};assert.notEqual(geometry.observe(wet).ground,'dry-land');place(f,wet);
  n.discovery.observations[source.id].position={...wet};
  assert.notEqual(discoveryDecision(n).need,'food');assert.equal(n.discovery.run,null);
  const old=validateNpc(JSON.parse(JSON.stringify(fixture().n)));
  assert.notEqual(discoveryDecision(old).need,'food','no exact fresh dry legacy footing witness');
});

test('full-hands admission without a donor witness does not invent travel toward the source',()=>{
  const f=fixture(),{n,source}=f;place(f,{x:source.position.x+280,y:source.position.y});
  n.discovery.experiments=n.discovery.experiments.filter(e=>e.primitive!=='release');
  const d=discoveryDecision(n);assert.notEqual(d.need,'food');assert.equal(n.discovery.run,null);
});

test('preparation revalidates source waits, held evidence, need and its unchanged 90-second bound',()=>{
  for(const change of ['pending-source','missing-witness','content','expiry','revised']) {
    const f=fixture(),{n,source}=f;place(f,{x:source.position.x+280,y:source.position.y});assert.equal(discoveryDecision(n).action.type,'move');
    const run=n.discovery.run;place(f,{x:source.position.x+20,y:source.position.y});
    if(change==='pending-source'){const p=n.discovery.experiments.find(e=>e.primitive==='pull'&&e.targetId===source.id);n.discovery.samplesPending[p.materialId]=n.elapsed;}
    if(change==='missing-witness')n.discovery.experiments=n.discovery.experiments.filter(e=>e.primitive!=='release');
    if(change==='content'){n.physiology.hoursSinceMeal=1;projectPhysiology(n);}
    if(change==='expiry'){run.startedAt=n.elapsed-91;n.physiology.hoursSinceMeal=1;projectPhysiology(n);}
    if(change==='revised')n.discovery.techniques.find(t=>t.id===run.techniqueId).confidence='revised';
    assert.notEqual(discoveryDecision(n).need,'food',change);assert.notEqual(n.discovery.run,run,change);
  }
});

test('an active sampling action is not replaced or interrupted to prepare capacity',()=>{
  const f=fixture(),{n,e}=f,id=n.inventory.items[0];assert.equal(requestNpcAction(n,{type:'sample',targetId:id},e).code,'ACTION_STARTED');
  const active=n.active,held=n.inventory.items.slice();discoveryDecision(n);assert.equal(n.active,active);assert.deepEqual(n.inventory.items,held);assert.equal(n.discovery.run,null);
  cancelNpcAction(n);
});

test('urgent hunger and depleted-after-refused-rest retain their existing food admission modes',()=>{
  for(const mode of ['ravenous','depleted-content']) {
    const f=fixture(),{n}=f;
    if(mode==='ravenous'){n.physiology.hoursSinceMeal=20;projectPhysiology(n);assert.equal(bodySignals(n).hunger,'ravenous');}
    else {Object.assign(n.physiology,{hoursSinceMeal:1,availableEnergyKcal:40,storedEnergyKcal:0});projectPhysiology(n);assert.equal(bodySignals(n).hunger,'content');assert.equal(bodySignals(n).energy,'depleted');assert.equal(act(f,{type:'rest',seconds:5}).code,'UNSAFE_TO_REST');}
    const d=prepare(f);assert.equal(d.action.targetId,n.inventory.items.at(-1));
  }
});

test('preparation does not turn a source acquisition failure into food evidence or donor recovery',()=>{
  const f=fixture(),{n,source}=f,d=prepare(f);assert.equal(act(f,d.action).ok,true);const t=n.discovery.techniques.find(t=>t.sourceId===source.id),prior=clone(t),donor=d.action.targetId;
  assert.deepEqual(discoveryDecision(n).action,{type:'pull',targetId:source.id});source.quantity=0; // Explicit finite-stock exhaustion surprise.
  assert.equal(act(f,{type:'pull',targetId:source.id}).code,'nothing_detached');assert.equal(n.discovery.run,null);assert.deepEqual(t,prior);
  assert.equal(lookupEcologyObject(f.e.ecology,donor).heldBy,null);assert.equal(n.inventory.items.length,3);assert.equal(retainedProofIntegrityError(n),null);
});


test('a genuinely free prepared slot ignores tempting testimony and novelty while acquisition is pending',()=>{
  const f=fixture(),{n}=f,d=prepare(f);assert.equal(act(f,d.action).ok,true);observeNpc(n,f.e);
  assert.equal(discoveryDecision(n).action.type,'pull');assert.equal(n.discovery.run.awaiting,true);assert.equal(n.inventory.items.length,3);
  recordDiscoveryReport(n,`grasp ${d.action.targetId}`,{sourceId:'human',messageId:'capacity-distractor'});
  const before=clone(n.discovery.samplesPending),cursor=n.discovery.run.cursor;
  for(let i=0;i<8;i++){const next=discoveryDecision(n);assert.ok(!['pull','grasp'].includes(next.action.type));assert.equal(n.inventory.items.length,3);assert.equal(n.discovery.run.cursor,cursor);}
  assert.deepEqual(n.discovery.samplesPending,before);
});

test('the newest donor refusal cannot be bypassed until the existing refusal interval expires',()=>{
  const f=fixture(),{n,e}=f,d=prepare(f),donor=d.action.targetId;
  assert.equal(requestNpcAction(n,d.action,e).code,'ACTION_STARTED');tick(f,.1);cancelNpcAction(n);
  const failedAt=n.elapsed;
  for(let i=0;i<10;i++)assert.notEqual(discoveryDecision(n).need,'food');
  tick(f,59);comfortableHungry(n);observeNpc(n,e);assert.ok(n.elapsed-failedAt<60);assert.notEqual(discoveryDecision(n).need,'food');
  tick(f,1.1);comfortableHungry(n);observeNpc(n,e);assert.equal(prepare(f).action.targetId,donor);
});

test('source disappearance learned during an approach prevents unnecessary placement',()=>{
  const f=fixture(),{n,source}=f;place(f,{x:source.position.x+280,y:source.position.y});assert.equal(discoveryDecision(n).action.type,'move');
  // Explicit missing-source fixture. Only the native failed inspection supplies
  // the actor with this change; the policy never reads the private ecology list.
  f.e.ecology.plants=f.e.ecology.plants.filter(p=>p.id!==source.id);
  assert.equal(act(f,{type:'inspect_object',targetId:source.id}).code,'OBJECT_GONE');
  const held=n.inventory.items.slice();assert.notEqual(discoveryDecision(n).need,'food');assert.deepEqual(n.inventory.items,held);assert.equal(n.discovery.run,null);
});

test('save during a paid but unfinished release restores neither completion nor an active preparation',()=>{
  const f=fixture(),{n,e}=f,d=prepare(f),donor=d.action.targetId;
  assert.equal(requestNpcAction(n,d.action,e).code,'ACTION_STARTED');tick(f,.2);assert.ok(n.active);
  const rows=new Map(),disk={getItem:key=>rows.get(key)??null,setItem:(key,value)=>rows.set(key,value)},savable=Object.assign(createOzarkState(geometry),f.state);
  assert.equal(writeOzarkSave(disk,savable,geometry),true);const loaded=loadOzarkSave(disk,geometry);assert.equal(loaded.blocked,false,loaded.error);
  const restored=loaded.state.agents[0];assert.equal(restored.active,null);assert.equal(restored.discovery.run,null);
  assert.ok(restored.inventory.items.includes(donor));assert.equal(lookupEcologyObject(loaded.state.environment.ecology,donor).heldBy,restored.id);
  assert.deepEqual(restored.discovery.experiments,n.discovery.experiments);assert.deepEqual(pendingIdentity(restored),pendingIdentity(n));
});

test('own relief arriving during a real source approach preempts placement of any held object',()=>{
  const f=fixture(),{n,source}=f,other=f.e.ecology.plants.find(p=>p.id==='object:675');
  assert.equal(act(f,{type:'release',targetId:n.inventory.items[0]}).ok,true);place(f,{x:other.position.x+20,y:other.position.y});
  assert.equal(act(f,{type:'pull',targetId:other.id}).ok,true);const food=n.inventory.items.at(-1);assert.equal(act(f,{type:'sample',targetId:food}).ok,true);
  place(f,{x:source.position.x+280,y:source.position.y});comfortableHungry(n);const first=discoveryDecision(n);assert.equal(first.action.type,'move');assert.equal(n.discovery.run.techniqueId,n.discovery.techniques.find(t=>t.sourceId===source.id).id);
  assert.equal(act(f,first.action).ok,true);
  for(let i=0;i<1200&&!n.discovery.effects.some(e=>e.objectId===food&&e.effect==='sustained');i++)tick(f);
  assert.ok(n.discovery.effects.some(e=>e.objectId===food&&e.effect==='sustained'));comfortableHungry(n);observeNpc(n,f.e);
  const held=n.inventory.items.slice();assert.deepEqual(discoveryDecision(n).action,{type:'sample',targetId:food});assert.deepEqual(n.inventory.items,held);
});


test('future or ambiguous recognition receipts cannot authorize capacity preparation',()=>{
  for(const damage of ['future','duplicate']) {
    const f=fixture(),{n}=f;
    for(const effect of n.discovery.effects.filter(e=>e.effect==='sustained')) {
      const receipt=n.memory.experience.find(e=>e.id===effect.proofEventId);
      if(damage==='future')receipt.at=n.elapsed+1;else n.memory.experience.push(clone(receipt));
    }
    assert.notEqual(discoveryDecision(n).need,'food',damage);assert.equal(n.discovery.run,null);
  }
});

test('donor choice uses retained handling recency, not pending age or hidden material value',()=>{
  const f=fixture(),{n,e}=f,expected=n.inventory.items.at(-1);
  for(const [index,id] of n.inventory.items.entries()) {
    const m=lookupEcologyObject(e.ecology,id);m.energyKcal=index*10000;m.materialType=index%2?'apple':'grass';
    n.discovery.samplesPending[id]=n.elapsed-index*100;
    n.discovery.observations[id].appearance={shape:`arbitrary ${4-index}`,color:'unrated'};
  }
  assert.equal(prepare(f).action.targetId,expected);
});

test('a full-hand candidate lacking source proof cannot conceal a later independently earned source',()=>{
  const f=fixture(),{n}=f,t=n.discovery.techniques[0];
  n.discovery.techniques.unshift({...clone(t),id:'unsupported-first-candidate',evidence:[]});
  const d=prepare(f);assert.equal(n.discovery.run.techniqueId,t.id);assert.equal(d.action.targetId,n.inventory.items.at(-1));
});

test('matching but internally contradictory grasp ancestry cannot authorize preparation',()=>{
  for(const materialId of ['object:999999',null,'']) {
  const f=fixture(),{n}=f,t=n.discovery.techniques[0];
  const acquired=n.discovery.experiments.find(e=>t.evidence.includes(e.id)&&e.primitive==='pull');
  const sample=n.discovery.experiments.find(e=>t.evidence.includes(e.id)&&e.primitive==='sample');
  const action=n.memory.experience.find(e=>e.id===acquired.actionId);
  // Deliberately corrupt both sides identically: simple receipt equality is not
  // enough when grasp's claimed material contradicts its same-ID motor meaning.
  acquired.primitive='grasp';acquired.targetId=sample.targetId;acquired.materialId=materialId;
  action.details.action={type:'grasp',targetId:sample.targetId};action.details.result.materialId=acquired.materialId;
  t.sourceId=sample.targetId;t.steps[0].type='grasp';
  assert.equal(action.details.result.materialId,acquired.materialId);assert.equal(action.details.action.targetId,acquired.targetId);
  assert.notEqual(discoveryDecision(n).need,'food');assert.equal(n.discovery.run,null);
  }
});


test("overlapping sample action and ingestion identities cannot borrow another portion's relief",()=>{
  for(const damage of ['borrowed-action','borrowed-ingestion']) {
    const f=fixture(),{n}=f,t=n.discovery.techniques[0];
    const sample=n.discovery.experiments.find(e=>t.evidence.includes(e.id)&&e.primitive==='sample');
    const other=n.discovery.experiments.find(e=>e.primitive==='sample'&&e.actionId!==sample.actionId);assert.ok(other);
    const effect=n.discovery.effects.find(e=>e.actionId===sample.actionId&&e.effect==='sustained');assert.ok(effect);
    n.discovery.effects=[effect];
    if(damage==='borrowed-action'){
      effect.actionId=other.actionId;n.memory.experience.find(e=>e.id===effect.proofEventId).details.feedback.actionId=other.actionId;
    }else{
      sample.ingestionId=other.ingestionId;n.memory.experience.find(e=>e.id===sample.actionId).details.result.ingestionId=other.ingestionId;
    }
    assert.notEqual(discoveryDecision(n).need,'food',damage);assert.equal(n.discovery.run,null);
  }
});


test('duplicate successful-sample ingestion identities invalidate even mutually matching copied proof',()=>{
  const f=fixture(),{n}=f,t=n.discovery.techniques[0];
  const sample=n.discovery.experiments.find(e=>t.evidence.includes(e.id)&&e.primitive==='sample');
  const other=n.discovery.experiments.find(e=>e.primitive==='sample'&&e.actionId!==sample.actionId);assert.ok(other);
  const effect=n.discovery.effects.find(e=>e.actionId===sample.actionId&&e.effect==='sustained');assert.ok(effect);n.discovery.effects=[effect];
  sample.ingestionId=other.ingestionId;n.memory.experience.find(e=>e.id===sample.actionId).details.result.ingestionId=other.ingestionId;
  effect.ingestionId=other.ingestionId;n.memory.experience.find(e=>e.id===effect.proofEventId).details.feedback.ingestionId=other.ingestionId;
  assert.notEqual(discoveryDecision(n).need,'food');assert.equal(n.discovery.run,null);
});

test('absent grasp material identity cannot conceal a defined contradictory action receipt',()=>{
  // Synthetic identity-corruption contract, not new evidence of physical learning.
  for(const receiptMaterialId of [undefined,null,'']) {
    const f=fixture(),{n}=f,t=n.discovery.techniques[0];
    const acquired=n.discovery.experiments.find(e=>t.evidence.includes(e.id)&&e.primitive==='pull');
    const sample=n.discovery.experiments.find(e=>t.evidence.includes(e.id)&&e.primitive==='sample');
    const action=n.memory.experience.find(e=>e.id===acquired.actionId);
    acquired.primitive='grasp';acquired.targetId=sample.targetId;delete acquired.materialId;
    action.details.action={type:'grasp',targetId:sample.targetId};delete action.details.result.materialId;
    if(receiptMaterialId!==undefined)action.details.result.materialId=receiptMaterialId;
    t.sourceId=sample.targetId;t.steps[0].type='grasp';
    const decision=discoveryDecision(n);
    if(receiptMaterialId===undefined)assert.equal(decision.action.type,'release','coherent legacy absent-ID grasp reaches preparation');
    else {assert.notEqual(decision.need,'food');assert.equal(n.discovery.run,null);}
  }
});
