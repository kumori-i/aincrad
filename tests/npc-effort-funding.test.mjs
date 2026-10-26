import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpc } from '../src/npc-state.js';
import { createEnvironment, tickEnvironment } from '../src/environment.js';
import { observeNpc, requestNpcAction, tickNpc, cancelNpcAction, rescueNpc } from '../src/npc.js';
import { requestSharedDiscoveryGrasp, tickDiscoveryAction } from '../src/discovery-actions.js';
import { fundNpcEffort, npcEffortCost, npcWorkAllowance } from '../src/npc-effort-funding.js';
import { createPhysiology, exertPhysiology, projectPhysiology } from '../src/biology.js';
import { DISCOVERY_RULES } from '../src/discovery-config.js';
import { lookupEcologyObject } from '../src/ecology.js';
import { validateNpc } from '../src/npc-memory.js';
import { discoveryDecision } from '../src/discovery.js';
import { canStand } from '../src/world.js';
import { lineOfSight } from '../src/perception.js';
import { restUnsafe } from '../src/interoception.js';

const near=(a,b,tolerance=1e-8)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} != ${b}`);
let initial;
function fixture() {
  if(!initial){
    const n=createNpc({mode:'discovery',seed:74193}),e=createEnvironment(74193,{mode:'discovery'});
    const plant=e.ecology.plants.find(p=>p.kind==='apple_tree');
    n.position=[[45,0],[-45,0],[0,45],[0,-45]].map(([x,y])=>({x:plant.position.x+x,y:plant.position.y+y}))
      .find(p=>canStand(p.x,p.y,'valley')&&lineOfSight(p,plant.position));
    assert.ok(n.position);observeNpc(n,e);initial={n,e,plant};
  }
  return structuredClone(initial);
}
function setEnergy(n,available=0,stored=0) {
  Object.assign(n.physiology,{availableEnergyKcal:available,storedEnergyKcal:stored});
  n.physiology.stomach=[];projectPhysiology(n);
}
function begin(f,type='pull',targetId=f.plant.id) {
  assert.equal(requestNpcAction(f.n,{type,targetId},f.e).code,'ACTION_STARTED');return f.n.active;
}
function directFinish(f,type,targetId=f.plant.id) {
  const active=begin(f,type,targetId);tickDiscoveryAction(f.n,active.seconds,f.e,{complete(n,request,result){n.lastResult=result;}});
  assert.equal(f.n.active,null);return f.n.lastResult;
}
function heldFixture() {
  const f=fixture();assert.equal(directFinish(f,'pull').ok,true);f.item=f.n.inventory.items[0];return f;
}
function bodyTick(f,dt=.1) {tickEnvironment(f.e,dt);tickNpc(f.n,dt,f.e);}
function stock(f) {return JSON.stringify({ecology:f.e.ecology,inventory:f.n.inventory,stomach:f.n.physiology.stomach});}

for(const ratio of [0,.5,1])test(`funding ${ratio} of requested effort scales all effort physiology exactly`,()=>{
  const n=createNpc({mode:'discovery'}),seconds=2,effort=1.6,cost=npcEffortCost(seconds,effort);
  setEnergy(n,cost*ratio);const expected=structuredClone(n),before=n.physiology.totals.metabolizedKcal;
  if(ratio)exertPhysiology(expected,seconds*ratio,effort);
  const paid=fundNpcEffort(n,seconds,effort);
  near(paid.paidSeconds,seconds*ratio);near(paid.paidKcal,cost*ratio);
  near(n.physiology.totals.metabolizedKcal-before,cost*ratio);
  assert.deepEqual(n.physiology,expected.physiology);
});

test('human opt-in never changes animal or legacy-player abstractions and invalid work is inert',()=>{
  for(const n of [{mode:'discovery',physiology:createPhysiology('rabbit')},createNpc()]){
    const before=structuredClone(n);assert.deepEqual(fundNpcEffort(n,2),{paidSeconds:0,paidKcal:0});assert.deepEqual(n,before);
  }
  const n=createNpc({mode:'discovery'}),before=structuredClone(n);
  for(const seconds of [NaN,Infinity,0,-1])assert.equal(fundNpcEffort(n,seconds).paidSeconds,0);
  assert.deepEqual(n,before);
  assert.equal(fundNpcEffort(n,1,1,()=>({paidSeconds:1})).paidSeconds,0,'a hook return is not a debit');
  assert.deepEqual(n,before);
});

test('fixed allowance is finite, includes a reserve-funded sample, and never grows on repeated ticks',()=>{
  near(npcWorkAllowance(3.5,.35),13.533333333333333);near(npcWorkAllowance(5,1.5),50);
  near(npcWorkAllowance(4,2.2),54.93333333333333);assert.equal(npcWorkAllowance(100,5),90);
  const f=fixture();setEnergy(f.n);const active=begin(f),deadline=active.expiresAt,before=stock(f);
  for(let i=0;f.n.active&&i<201;i++){tickDiscoveryAction(f.n,.25,f.e);assert.equal(active.expiresAt,deadline);}
  assert.equal(f.n.active,null,'a frozen absolute clock cannot keep unpaid work active forever');
  assert.equal(active.worked,0);assert.equal(f.n.elapsed,0);assert.equal(stock(f),before);
  assert.equal(f.n.discovery.practice.pull,undefined,'unreported retries earn no practice');
});

for(const type of DISCOVERY_RULES.primitives)test(`${type} cannot mutate finite stock before its full paid work`,()=>{
  const f=['grasp','release','sample'].includes(type)?heldFixture():fixture();
  if(type==='grasp')assert.equal(directFinish(f,'release',f.item).ok,true);
  const target=f.item||f.plant.id;setEnergy(f.n,npcEffortCost(DISCOVERY_RULES.durations[type],DISCOVERY_RULES.effort[type])*.5);
  const active=begin(f,type,target),before=stock(f),spent=f.n.physiology.totals.metabolizedKcal;
  tickDiscoveryAction(f.n,active.seconds,f.e);
  near(active.worked,active.seconds*.5);assert.equal(stock(f),before);
  const partial=active.worked;
  tickDiscoveryAction(f.n,.1,f.e);near(active.worked,partial);assert.equal(stock(f),before);
  f.n.physiology.availableEnergyKcal=npcEffortCost(active.seconds*.5,DISCOVERY_RULES.effort[type]);
  let result;tickDiscoveryAction(f.n,active.seconds*.5,f.e,{complete(n,request,value){result=value;}});
  assert.equal(f.n.active,null);near(result.durationSeconds,active.seconds);
  near(f.n.physiology.totals.metabolizedKcal-spent,npcEffortCost(active.seconds,DISCOVERY_RULES.effort[type]));
  const completed=stock(f);f.n.active=active;assert.equal(tickDiscoveryAction(f.n,10,f.e),false);assert.equal(stock(f),completed);
});

test('reserve-funded sample finishes after real elapsed mobilization, never before paid work',()=>{
  const f=heldFixture();setEnergy(f.n,0,1000);const active=begin(f,'sample',f.item),before=lookupEcologyObject(f.e.ecology,f.item).massGrams;
  let elapsed=0;while(f.n.active&&elapsed<15){bodyTick(f,.05);elapsed+=.05;if(active.worked<active.seconds-1e-8)assert.equal(lookupEcologyObject(f.e.ecology,f.item).massGrams,before);}
  assert.equal(f.n.active,null);assert.equal(f.n.lastResult.code,'SWALLOWED');near(active.worked,3.5);
  assert.ok(elapsed>=6.5&&elapsed<6.7,`${elapsed} seconds`);assert.equal(lookupEcologyObject(f.e.ecology,f.item).massGrams,before-30);
  assert.equal(f.n.physiology.outsideAssistance.count,0);assert.equal(f.n.discovery.practice.sample.successes,1);
});

test('zero available energy and stores still advance world clock and basal harm but produce no work',()=>{
  const f=fixture();setEnergy(f.n);const active=begin(f),quantity=f.plant.quantity,health=f.n.health;
  while(f.n.active&&f.n.elapsed<51)bodyTick(f,.25);
  assert.equal(f.n.lastResult.code,'ACTION_TIMEOUT');assert.equal(f.n.lastResult.durationSeconds,0);
  assert.equal(active.worked,0);assert.equal(f.plant.quantity,quantity);assert.equal(f.n.inventory.items.length,0);
  near(f.n.elapsed,50);near(f.e.elapsed,50);assert.ok(f.n.health<health);
  assert.equal(f.n.physiology.totals.metabolizedKcal,0);assert.equal(f.n.discovery.practice.pull.successes,0);
});

test('partial timeout and cancel report only funded effort and cannot replay output',()=>{
  for(const how of ['timeout','cancel']){
    const f=fixture();setEnergy(f.n,npcEffortCost(.75,1.5));const active=begin(f);bodyTick(f,.25);bodyTick(f,.25);bodyTick(f,.25);
    const paid=active.worked,quantity=f.plant.quantity;
    if(how==='cancel')cancelNpcAction(f.n);else while(f.n.active)bodyTick(f,.25);
    near(f.n.lastResult.handling.activeActionSeconds,paid);assert.equal(f.n.lastResult.ok,false);
    assert.equal(f.plant.quantity,quantity);assert.equal(f.n.discovery.practice.pull.successes,0);
    const total=f.n.physiology.totals.metabolizedKcal;f.n.active=active;assert.equal(tickDiscoveryAction(f.n,5,f.e),false);
    near(f.n.physiology.totals.metabolizedKcal,total);assert.equal(f.plant.quantity,quantity);
  }
});

test('throwing, cancelling and reentering payment hooks cannot double-charge or complete unreturned work',()=>{
  for(const how of ['throw','cancel','reenter']){
    const f=fixture(),active=begin(f),before=f.n.physiology.totals.metabolizedKcal;
    const run=()=>tickDiscoveryAction(f.n,.5,f.e,{exert(n,seconds,effort){
      assert.equal(tickDiscoveryAction(n,.5,f.e),false);exertPhysiology(n,seconds,effort);
      if(how==='throw')throw new Error('funding fixture');if(how==='cancel')cancelNpcAction(n);
    }});
    if(how==='throw')assert.throws(run,/funding fixture/);else run();
    near(f.n.physiology.totals.metabolizedKcal-before,npcEffortCost(.5,1.5));
    near(active.worked,how==='reenter'?.5:0);assert.equal(f.n.inventory.items.length,0);
    if(how==='reenter')cancelNpcAction(f.n);
    f.n.active=active;assert.equal(tickDiscoveryAction(f.n,5,f.e),false);
    near(f.n.physiology.totals.metabolizedKcal-before,npcEffortCost(.5,1.5));
  }
});

test('save validation interrupts partial work, preserving debits without success or a restored payment witness',()=>{
  const f=fixture(),active=begin(f);tickDiscoveryAction(f.n,.5,f.e);
  const before=f.n.physiology.totals.metabolizedKcal,quantity=f.plant.quantity;
  const restored=validateNpc(JSON.parse(JSON.stringify(f.n)));
  assert.equal(restored.active,null);near(restored.physiology.totals.metabolizedKcal,before);
  assert.equal(restored.discovery.practice.pull?.successes||0,0);assert.equal(f.plant.quantity,quantity);
  restored.active=structuredClone(active);assert.equal(tickDiscoveryAction(restored,5,f.e),false);assert.equal(restored.active,null);
  assert.equal(restored.inventory.items.length,0);near(restored.physiology.totals.metabolizedKcal,before);
});

for(const gap of [1.8,1.8-1e-5])test(`matching procedure clips inspect work at ${gap} seconds and distinguishes exact completion`,()=>{
  const f=fixture();f.n.elapsed=100;f.n.discovery.run={startedAt:100+gap-90,awaiting:true,expectedType:'inspect_object',expectedId:f.plant.id};
  const active=begin(f,'inspect_object');near(active.expiresAt,100+gap);
  let result;f.n.elapsed=102;tickDiscoveryAction(f.n,2,f.e,{complete(n,request,value){result=value;}});
  near(active.worked,gap);assert.equal(result.ok,gap===1.8);assert.equal(result.code,gap===1.8?'OBJECT_OBSERVED':'ACTION_TIMEOUT');
  if(gap<1.8)assert.equal(f.n.discovery.run,null);
});

test('unrelated interaction does not inherit another learned step deadline',()=>{
  const f=fixture();f.n.elapsed=100;f.n.discovery.run={startedAt:10,awaiting:true,expectedType:'sample',expectedId:'object:999'};
  const active=begin(f);near(active.expiresAt,150);cancelNpcAction(f.n);
});

test('revoked shared-grasp consent terminates before another paid slice or ownership transfer',()=>{
  const f=heldFixture(),donor=f.n,receiver=createNpc({id:'mira',mode:'discovery'});receiver.position={...donor.position};observeNpc(receiver,f.e);
  let consent=true;assert.equal(requestSharedDiscoveryGrasp(receiver,donor,f.item,f.e,()=>consent).code,'ACTION_STARTED');
  tickDiscoveryAction(receiver,.5,f.e);const spent=receiver.physiology.totals.metabolizedKcal;consent=false;
  let result;tickDiscoveryAction(receiver,3,f.e,{complete(n,request,value){result=value;}});
  assert.equal(result.code,'SHARING_INTERRUPTED');assert.equal(receiver.active,null);near(receiver.physiology.totals.metabolizedKcal,spent);
  assert.equal(lookupEcologyObject(f.e.ecology,f.item).heldBy,donor.id);assert.deepEqual(receiver.inventory.items,[]);
});

test('rejected rest still chooses bounded awake wait and mobilizes a conserved budget',()=>{
  const f=fixture();setEnergy(f.n,40,1000);Object.assign(f.n.physiology,{fatigue:80,sleepPressure:90,hoursSinceMeal:12});projectPhysiology(f.n);
  assert.equal(restUnsafe(f.n),true);assert.equal(requestNpcAction(f.n,{type:'rest',seconds:5},f.e).code,'UNSAFE_TO_REST');
  assert.deepEqual(discoveryDecision(f.n).action,{type:'wait',seconds:5});
  const total=f.n.physiology.availableEnergyKcal+f.n.physiology.storedEnergyKcal+f.n.physiology.totals.metabolizedKcal;
  assert.equal(requestNpcAction(f.n,discoveryDecision(f.n).action,f.e).code,'STARTED');
  for(let i=0;i<20;i++)bodyTick(f,.25);
  assert.equal(f.n.lastResult.code,'WAITED');near(f.n.physiology.availableEnergyKcal,41);near(f.n.physiology.storedEnergyKcal,1000-130/30);
  near(f.n.physiology.availableEnergyKcal+f.n.physiology.storedEnergyKcal+f.n.physiology.totals.metabolizedKcal,total);
});

test('urgent water choice and zero-effort drinking remain available while depleted',()=>{
  const f=fixture();setEnergy(f.n);f.n.physiology.waterDeficitMl=3000;f.n.flask.water=1;projectPhysiology(f.n);
  const choice=discoveryDecision(f.n).action;assert.equal(choice.type,'drink');const spent=f.n.physiology.totals.metabolizedKcal;
  assert.equal(requestNpcAction(f.n,choice,f.e).ok,true);near(f.n.physiology.totals.metabolizedKcal,spent);assert.equal(f.n.physiology.availableEnergyKcal,0);
});

test('depleted collapse and rescue are separate, attributed once, and never grant work success',()=>{
  const f=fixture();setEnergy(f.n);f.n.physiology.health=.0001;projectPhysiology(f.n);begin(f);bodyTick(f,.25);
  assert.equal(f.n.lifecycle,'COLLAPSED');assert.equal(f.n.stats.collapses,1);assert.equal(f.n.lastResult.code,'COLLAPSED');
  assert.equal(f.n.physiology.outsideAssistance.count,0);assert.equal(f.n.inventory.items.length,0);
  assert.equal(rescueNpc(f.n).ok,true);assert.equal(f.n.physiology.outsideAssistance.count,1);assert.ok(f.n.physiology.outsideAssistance.energyKcal>0);
  const assistance=structuredClone(f.n.physiology.outsideAssistance);assert.equal(rescueNpc(f.n).code,'ALREADY_RESCUED');
  assert.deepEqual(f.n.physiology.outsideAssistance,assistance);assert.equal(f.n.stats.independentMeals,0);
});

test('a matching procedure deadline also clears the admitted run when direct ticks keep the absolute clock frozen',()=>{
  const f=fixture();f.n.elapsed=100;setEnergy(f.n);
  f.n.discovery.run={startedAt:10.5,awaiting:true,expectedType:'pull',expectedId:f.plant.id};
  const active=begin(f);near(active.expiresAt,100.5);
  tickDiscoveryAction(f.n,.5,f.e);assert.equal(f.n.active,null);assert.equal(active.worked,0);
  assert.equal(f.n.discovery.run,null,'runtime expiry must retire its matching run, too');
});

test('a skipped absolute-clock deadline cannot be filled retroactively with a new paid slice',()=>{
  const f=fixture(),active=begin(f),before=f.n.physiology.totals.metabolizedKcal,quantity=f.plant.quantity;
  f.n.elapsed=active.expiresAt+10;let result;
  tickDiscoveryAction(f.n,.25,f.e,{complete(n,request,value){result=value;}});
  assert.equal(result.code,'ACTION_TIMEOUT');assert.equal(active.worked,0);
  near(f.n.physiology.totals.metabolizedKcal,before);assert.equal(f.plant.quantity,quantity);
});

for(const failure of ['OUT_OF_REACH','HANDS_FULL','OBJECT_GONE'])test(`fully paid work still respects ${failure} without fabricated output`,()=>{
  const f=fixture(),active=begin(f);tickDiscoveryAction(f.n,active.seconds/2,f.e);
  const quantity=f.plant.quantity;
  if(failure==='OUT_OF_REACH')f.n.position.x+=1000;
  if(failure==='HANDS_FULL')f.n.inventory.items=['object:990001','object:990002','object:990003','object:990004'];
  if(failure==='OBJECT_GONE')f.e.ecology.plants=f.e.ecology.plants.filter(p=>p.id!==f.plant.id);
  const before=stock(f);let result;tickDiscoveryAction(f.n,active.seconds/2,f.e,{complete(n,request,value){result=value;}});
  assert.equal(result.code,failure);assert.equal(result.ok,false);near(result.durationSeconds,active.seconds);
  assert.equal(stock(f),before);assert.equal(f.plant.quantity,quantity);
});

test('finite catch cannot capture on partial payment, then captures once after its paid remainder',async()=>{
  const { createOzarkWorldGeometry, OZARK_WORLD_PROFILE }=await import('../src/ozark-world-geometry.js');
  const { createOzarkEcology }=await import('../src/ozark-ecology.js');
  const { bindOzarkWorldAgent }=await import('../src/ozark-agent-world.js');
  const { createCommunity }=await import('../src/social.js');
  const { CONFIG }=await import('../src/config.js');
  const geometry=createOzarkWorldGeometry(),e=createEnvironment(74193,{mode:'discovery',populate:false});
  e.ecology=createOzarkEcology(geometry,74193,0,{finiteAquatic:true});
  const n=createNpc({mode:'discovery',id:'aster',seed:74193});
  const fish=[...e.ecology.aquatic.fish].sort((a,b)=>Math.hypot(a.position.x-geometry.spawn.x,a.position.y-geometry.spawn.y)-Math.hypot(b.position.x-geometry.spawn.x,b.position.y-geometry.spawn.y)||a.id.localeCompare(b.id))[0];
  let bank;
  for(let r=2;r<=80&&!bank;r+=2)for(let i=0;i<32;i++){
    const angle=i*Math.PI/16,p={x:fish.position.x+Math.cos(angle)*r,y:fish.position.y+Math.sin(angle)*r};
    if(geometry.classify(p.x,p.y,CONFIG.playerRadius).reason==='dry-ground'&&geometry.lineOfSight(p,fish.position)){bank=p;break;}
  }
  assert.ok(bank);n.position=bank;
  const state={version:12,features:{plantLifecycle:1,finiteAquatic:2,worldStructures:1},geometryIdentity:OZARK_WORLD_PROFILE.identity,
    simulationMode:'discovery',elapsed:0,scene:'valley',player:{...geometry.spawn},agents:[n],npc:n,environment:e,community:createCommunity()};
  bindOzarkWorldAgent(n,geometry,state);observeNpc(n,e);setEnergy(n,npcEffortCost(2,1.5));
  assert.equal(requestNpcAction(n,{type:'catch',targetId:fish.id},e).code,'ACTION_STARTED');const active=n.active,before=JSON.stringify(e.ecology);
  tickDiscoveryAction(n,4,e);near(active.worked,2);assert.equal(JSON.stringify(e.ecology),before);assert.deepEqual(n.inventory.items,[]);
  n.physiology.availableEnergyKcal=npcEffortCost(2,1.5);let result;
  tickDiscoveryAction(n,2,e,{complete(actor,request,value){result=value;}});
  assert.equal(result.ok,true);assert.deepEqual(n.inventory.items,[fish.id]);assert.equal(lookupEcologyObject(e.ecology,fish.id).kind,'fish_specimen');
  const completed=JSON.stringify(e.ecology),paid=n.physiology.totals.metabolizedKcal;
  n.active=active;assert.equal(tickDiscoveryAction(n,5,e),false);assert.equal(JSON.stringify(e.ecology),completed);near(n.physiology.totals.metabolizedKcal,paid);
});

test('sub-tolerance work still requires a positive physical debit, not a forged hook receipt',()=>{
  for(const seconds of [1e-12,1e-10,1e-8]){
    const n=createNpc({mode:'discovery'}),before=structuredClone(n);
    assert.deepEqual(fundNpcEffort(n,seconds,1,()=>({paidSeconds:seconds,paidKcal:npcEffortCost(seconds)})),{paidSeconds:0,paidKcal:0});
    assert.deepEqual(n,before);
  }
});

test('a hook cannot certify more positive work than it actually debited even within numeric tolerance',()=>{
  const n=createNpc({mode:'discovery'}),seconds=1e-8;
  const result=fundNpcEffort(n,seconds,1,(actor,duration,effort)=>exertPhysiology(actor,duration*.5,effort));
  assert.deepEqual(result,{paidSeconds:0,paidKcal:0},'a mismatched custom payer fails closed rather than certifying an incomplete slice');
  assert.ok(n.physiology.totals.metabolizedKcal>0&&n.physiology.totals.metabolizedKcal<=npcEffortCost(seconds)*.5001);
});

test('zero and partial paid cancellations report certified work rather than elapsed waiting',()=>{
  for(const paid of [0,.25]){
    const f=fixture();setEnergy(f.n,npcEffortCost(paid,1.5));const active=begin(f);
    tickDiscoveryAction(f.n,1,f.e);f.n.elapsed=2;active.worked=999;
    assert.equal(cancelNpcAction(f.n),true);near(f.n.lastResult.durationSeconds,paid);
    if(paid)near(f.n.lastResult.handling.activeActionSeconds,paid);else assert.equal(f.n.lastResult.handling,undefined);
    assert.equal(f.n.discovery.practice.pull?.successes||0,0);assert.equal(f.n.inventory.items.length,0);
  }
});
