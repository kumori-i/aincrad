import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhysiology, validatePhysiology, projectPhysiology, ingestMaterial, ingestWater, tickPhysiology } from '../src/biology.js';
import { simulationSeconds } from '../src/biology-config.js';
import { bodySignals } from '../src/interoception.js';
import { createNpc } from '../src/npc-state.js';
import { createEnvironment,tickEnvironment } from '../src/environment.js';
import { tickEcology,lookupEcologyObject } from '../src/ecology.js';
import { requestNpcAction,tickNpc,observeNpc } from '../src/npc.js';
import { canStand } from '../src/world.js';
import { processDiscoveryFeedback,discoveryDecision } from '../src/discovery.js';
import { recordEvent } from '../src/npc-memory.js';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { createOzarkState,writeOzarkSave,loadOzarkSave,OZARK_SAVE_KEY } from '../src/ozark-save.js';
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const actor=()=>projectPhysiology({mode:'discovery',lifecycle:'AWAKE',elapsed:0,physiology:createPhysiology('human',{hoursSinceMeal:9,satietyHours:0}),thermal:{hot:0,cold:0,wetness:0}});
const portion=g=>({massGrams:g,energyKcal:95*g/180,waterMl:153*g/180,digestHours:2});
function advance(a,hours){for(let h=0;h<hours-1e-10;h+=.01){const dt=simulationSeconds(Math.min(.01,hours-h));a.elapsed+=dt;tickPhysiology(a,dt,{hour:10,feltTemperature:18,sheltered:true});}}

test('appetite dose/time matrix is separate from physical energy and water fullness',()=>{
  for(const grams of [0,30,90,180]){
    const a=actor(),opening=a.physiology.availableEnergyKcal+a.physiology.storedEnergyKcal;
    if(grams)assert.equal(ingestMaterial(a,portion(grams)).ok,true);
    close(a.nourishment,grams/180*4/6*100); // No next tick or manual projection needed.
    for(let hour=1;hour<=3;hour++){
      advance(a,1);close(a.nourishment,Math.max(0,grams/180*4-hour)/6*100);
      close(a.physiology.totals.metabolizedKcal,100*hour);
      close(a.physiology.totals.absorbedKcal,95*grams/180*Math.min(1,hour/2));
      const f=a.physiology;close(f.availableEnergyKcal+f.storedEnergyKcal+f.stomach.reduce((s,i)=>s+i.remainingKcal,0)+f.totals.metabolizedKcal+f.totals.discardedKcal,opening+95*grams/180);
      if(grams===180)assert.equal(bodySignals(a).hunger,hour<=2?'content':'peckish');
    }
  }
  const water=actor(),dry=actor();assert.equal(ingestWater(water,500).ok,true);projectPhysiology(water);
  close(water.nourishment,0);assert.equal(bodySignals(water).hunger,bodySignals(dry).hunger);
  assert.notEqual(bodySignals(water).digestion,bodySignals(dry).digestion);
  advance(water,1);advance(dry,1);close(water.nourishment,dry.nourishment);close(water.physiology.totals.absorbedKcal,0);
});

test('same-time split and mixed-water doses agree; cap and load never replay credits',()=>{
  const whole=actor(),split=actor(),mixed=actor();ingestMaterial(whole,portion(180));
  for(let i=0;i<6;i++)ingestMaterial(split,portion(30));
  ingestMaterial(mixed,{...portion(180),massGrams:680,waterMl:653});
  close(whole.physiology.satietyHours,split.physiology.satietyHours);close(whole.physiology.satietyHours,mixed.physiology.satietyHours);
  advance(whole,1);advance(split,1);advance(mixed,1);close(whole.physiology.satietyHours,split.physiology.satietyHours);close(whole.physiology.satietyHours,mixed.physiology.satietyHours);
  const saved=structuredClone(whole.physiology);assert.deepEqual(validatePhysiology(saved),saved);assert.deepEqual(validatePhysiology(validatePhysiology(saved)),saved);
  const full=actor();ingestMaterial(full,portion(360));close(full.physiology.satietyHours,6);
  const before=JSON.stringify(full.physiology);assert.equal(ingestMaterial(full,portion(1400)).code,'TOO_FULL');assert.equal(JSON.stringify(full.physiology),before);
  const animal=createPhysiology('rabbit');assert.equal(Object.hasOwn(animal,'satietyHours'),false);assert.deepEqual(validatePhysiology(animal),animal);
});

test('accepted ingestion projects atomically; projection is inert and refusal leaves all state unchanged',()=>{
  const a=actor();a.rng=74193;
  const elapsed=a.elapsed,rng=a.rng;
  assert.equal(ingestMaterial(a,portion(90)).ok,true);close(a.nourishment,100/3);
  assert.equal(a.elapsed,elapsed);assert.equal(a.rng,rng);assert.equal(a.physiology.feedback.length,0);
  close(a.physiology.totals.absorbedKcal,0);close(a.physiology.totals.metabolizedKcal,0);
  const committed=JSON.stringify(a);projectPhysiology(a);projectPhysiology(a);assert.equal(JSON.stringify(a),committed);
  assert.equal(ingestMaterial(a,portion(1500)).code,'TOO_FULL');assert.equal(JSON.stringify(a),committed);
  assert.equal(ingestMaterial(a,{massGrams:0}).code,'INVALID_MATERIAL');assert.equal(JSON.stringify(a),committed);
  assert.equal(ingestWater(a,500).ok,true);close(a.nourishment,100/3);
});

test('toxic ingestion retains delayed discomfort and never credits a receipt twice',()=>{
  const a=actor();const r=ingestMaterial(a,{...portion(30),toxicity:1},{objectId:'object:1',actionId:1,provenance:'sampled'});assert.equal(r.ok,true);close(a.physiology.satietyHours,2/3);assert.equal(a.physiology.feedback.length,0);
  advance(a,.2);assert.equal(a.physiology.feedback[0].effect,'discomfort');close(a.physiology.satietyHours,2/3-.2);
  const f=validatePhysiology(a.physiology);assert.deepEqual(f.feedback,a.physiology.feedback);close(f.satietyHours,a.physiology.satietyHours);
});

function fixture(){const n=createNpc({mode:'discovery',seed:74193}),e=createEnvironment(74193,{mode:'discovery'}),plant=e.ecology.plants.find(p=>p.kind==='apple_tree'&&p.quantity>0);n.position=[{x:plant.position.x+45,y:plant.position.y},{x:plant.position.x-45,y:plant.position.y}].find(p=>canStand(p.x,p.y,'valley'));assert.ok(n.position);n.physiology.hoursSinceMeal=9;n.physiology.satietyHours=0;projectPhysiology(n);observeNpc(n,e);return{n,e,plant};}
function tick(f,seconds=1/60){for(let i=0;i<Math.ceil(seconds*60);i++){tickEnvironment(f.e,1/60);tickEcology(f.e.ecology,1/60,f.e,[f.n]);tickNpc(f.n,1/60,f.e);processDiscoveryFeedback(f.n,{recordEffect:effect=>recordEvent(f.n,'condition',{code:'DISCOVERY_EFFECT',feedback:effect})});}}
function act(f,action){const r=requestNpcAction(f.n,action,f.e);assert.equal(r.code,'ACTION_STARTED');for(let i=0;i<1200&&f.n.active;i++)tick(f);assert.equal(f.n.active,null);assert.equal(f.n.lastResult.ok,true);}

test('paid finite whole apple is six actual portions with costs and delayed absorption',t=>{
  const f=fixture(),p=f.n.physiology,opening=p.availableEnergyKcal+p.storedEnergyKcal,stock=f.plant.quantity;
  act(f,{type:'pull',targetId:f.plant.id});const id=f.n.inventory.items[0];
  for(let i=0;i<6;i++)act(f,{type:'sample',targetId:id});
  assert.equal(lookupEcologyObject(f.e.ecology,id),null);assert.equal(f.n.inventory.items.includes(id),false);close(f.plant.quantity,stock-1);close(p.totals.ingestedKcal,95);close(f.e.ecology.ledger.humanRemovedKcal,95);
  assert.ok(p.totals.metabolizedKcal>0);assert.ok(p.totals.absorbedKcal<95);assert.ok(p.satietyHours<4&&p.satietyHours>3.7);
  const atCompletion=p.satietyHours;close(f.n.nourishment,atCompletion/6*100);
  const actionReceipt=f.n.memory.experience.find(e=>e.id===f.n.lastResult.eventId);
  close(actionReceipt.details.nourishment,f.n.nourishment);
  const metrics=()=>({elapsedSimulationSeconds:f.n.elapsed,foodSatisfaction:f.n.nourishment,satietyHours:p.satietyHours,ingestedKcal:p.totals.ingestedKcal,absorbedKcal:p.totals.absorbedKcal,pendingKcal:p.stomach.reduce((s,i)=>s+i.remainingKcal,0),discardedKcal:p.totals.discardedKcal,spentKcal:p.totals.metabolizedKcal,reserveChangeKcal:p.availableEnergyKcal+p.storedEnergyKcal-opening});
  const snapshots=[{gameHoursAfterLastBite:0,...metrics()}];
  for(let hour=1;hour<=3;hour++){tick(f,150);snapshots.push({gameHoursAfterLastBite:hour,...metrics()});close(p.satietyHours,Math.max(0,atCompletion-hour));close(p.availableEnergyKcal+p.storedEnergyKcal+p.stomach.reduce((s,i)=>s+i.remainingKcal,0)+p.totals.metabolizedKcal+p.totals.discardedKcal,opening+95);}
  close(p.totals.absorbedKcal+p.totals.discardedKcal,95);assert.ok(p.totals.discardedKcal<.005);assert.equal(p.outsideAssistance.count,0);t.diagnostic(JSON.stringify({assay:'paid-six-bite-whole-apple',snapshots}));
});

test('content appetite with waning energy motivates supported eating but never skips necessary rest',()=>{
  const f=fixture();act(f,{type:'pull',targetId:f.plant.id});const id=f.n.inventory.items[0];
  for(let k=1;k<=2;k++){act(f,{type:'sample',targetId:id});for(let i=0;i<24000&&new Set(f.n.discovery.effects.filter(x=>x.objectId===id&&x.effect==='sustained').map(x=>x.ingestionId)).size<k;i++)tick(f);}
  f.n.physiology.satietyHours=4;f.n.physiology.availableEnergyKcal=700;projectPhysiology(f.n);assert.equal(bodySignals(f.n).hunger,'content');assert.equal(bodySignals(f.n).energy,'waning');
  assert.deepEqual(discoveryDecision(f.n).action,{type:'sample',targetId:id});
  f.n.physiology.availableEnergyKcal=120;projectPhysiology(f.n);assert.equal(bodySignals(f.n).hunger,'content');
  f.n.physiology.fatigue=80;projectPhysiology(f.n);assert.equal(discoveryDecision(f.n).action.type,'rest');
  f.n.physiology.fatigue=5;f.n.physiology.sleepPressure=90;projectPhysiology(f.n);assert.equal(discoveryDecision(f.n).action.type,'sleep');
});

test('schema12 missing human appetite migrates narrowly and malformed explicit values remain protected',()=>{
  const geometry=createOzarkWorldGeometry(),state=createOzarkState(geometry),values=new Map(),disk={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
  ingestMaterial(state.agents[0],portion(30),{provenance:'fixture'});projectPhysiology(state.agents[0]);
  assert.equal(writeOzarkSave(disk,state,geometry),true);const original=JSON.parse(disk.getItem(OZARK_SAVE_KEY));
  const old=structuredClone(original);for(const n of old.agents)delete n.physiology.satietyHours;
  disk.setItem(OZARK_SAVE_KEY,JSON.stringify(old));const bytes=disk.getItem(OZARK_SAVE_KEY),opened=loadOzarkSave(disk,geometry);assert.equal(opened.blocked,false,opened.error);assert.equal(disk.getItem(OZARK_SAVE_KEY),bytes);
  for(let i=0;i<2;i++){const {satietyHours,...rest}=opened.state.agents[i].physiology;assert.deepEqual(rest,old.agents[i].physiology);close(satietyHours,Math.max(0,6-old.agents[i].physiology.hoursSinceMeal));}
  assert.equal(writeOzarkSave(disk,opened.state,geometry),true);assert.equal(loadOzarkSave(disk,geometry).blocked,false);
  for(const boundary of [0,6]){const raw=structuredClone(original);for(const n of raw.agents)n.physiology.satietyHours=boundary;disk.setItem(OZARK_SAVE_KEY,JSON.stringify(raw));const loaded=loadOzarkSave(disk,geometry);assert.equal(loaded.blocked,false,loaded.error);for(const n of loaded.state.agents)assert.equal(n.physiology.satietyHours,boundary);}
  for(const index of [0,1])for(const invalid of [null,'4',-1,7]){const raw=structuredClone(original);raw.agents[index].physiology.satietyHours=invalid;const bytes=JSON.stringify(raw);disk.setItem(OZARK_SAVE_KEY,bytes);assert.equal(loadOzarkSave(disk,geometry).blocked,true);assert.equal(disk.getItem(OZARK_SAVE_KEY),bytes);}
});
