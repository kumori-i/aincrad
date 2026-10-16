import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CONFIG, NPC_RULES, CAVE_SPAWN, CAVE_EXIT} from '../src/config.js';
import {BIOLOGY_RULES} from '../src/biology-config.js';
import {DISCOVERY_RULES} from '../src/discovery-config.js';
import {createNpc} from '../src/npc-state.js';
import {observeNpc, requestNpcAction, tickNpc} from '../src/npc.js';
import {createEnvironment} from '../src/environment.js';
import {createEcology, lookupEcologyObject, ecologyEnergy} from '../src/ecology.js';
import {freshState, canStand, distance} from '../src/world.js';
import {discoveryDecision} from '../src/discovery.js';
import {cognitiveAction, searchBounds, searchReturn} from '../src/cognition.js';
import {knownRoute} from '../src/navigation.js';
import {rememberedCells, tileKey} from '../src/perception.js';
import {bodySignals} from '../src/interoception.js';
import {loadSave, writeSave} from '../src/save.js';

// Bounded selection/lifecycle fixtures, not autonomous migration or survival trials.
// The corridor is a deliberately retained subset of actual local perception.
// Repositioning while arranging it does not claim a naturally learned trajectory.
const HOME = {x:276,y:760};
const OUTWARD_START = {x:4320,y:1600};
const OUTWARD_END = {x:4640,y:1600};
const CORRIDOR_KEYS = ['54,20','55,20','56,20','57,20','58,20'];
const clone = value => structuredClone(value);
const near = (actual, expected, tolerance=1e-9) => assert.ok(Math.abs(actual-expected)<=tolerance,
  `expected ${expected}, received ${actual}`);
let pristineEcology;
const ecologyFixture = () => clone(pristineEcology ??= createEcology(CONFIG.seed));
const moveDecision = target => ({action:{type:'move',target},reason:'I can investigate another locally observed patch of terrain.',need:'understanding',provider:'discovery-learner'});
const waitDecision = {action:{type:'wait',seconds:5},reason:'I am allowing time for changes and sensations before another bounded experiment.',need:'understanding',provider:'discovery-learner'};

function retainObservedCorridor(n,e,{keepObjects=false}={}) {
  n.position={...OUTWARD_START};
  const observed=observeNpc(n,e);
  for(const key of CORRIDOR_KEYS)assert.ok(observed.cells.some(c=>c.key===key&&c.walkable),`actual visible walkable cell ${key}`);
  n.memory.cells=Object.fromEntries(CORRIDOR_KEYS.map(key=>[key,n.memory.cells[key]]));
  if(!keepObjects)n.discovery.observations={};
  n.navigationAnchor=null;
  return observed;
}
function corridorFixture(seed=74193) {
  const n=createNpc({mode:'discovery',seed}),e=createEnvironment();
  n.position={...HOME};observeNpc(n,e);
  const observed=retainObservedCorridor(n,e);
  return {n,e,observed};
}
function remoteObjectFixture({n=createNpc({mode:'discovery',seed:74193}),e=null}={}) {
  e??=createEnvironment(CONFIG.seed,{mode:'discovery',populate:false});e.ecology??=ecologyFixture();
  n.position={...HOME};observeNpc(n,e);
  // Pin a real deterministic ecology object, then prove current visibility.
  const object=lookupEcologyObject(e.ecology,'object:18');
  assert.ok(object);assert.equal(object.kind,'apple_tree');
  assert.ok(distance(HOME,object.position)>DISCOVERY_RULES.searchRadius);
  n.position={x:object.position.x+40,y:object.position.y};
  assert.ok(canStand(n.position.x,n.position.y,'valley'));
  const observed=observeNpc(n,e);
  assert.ok(observed.objects.some(o=>o.id===object.id));
  n.discovery.observations={[object.id]:n.discovery.observations[object.id]};
  // Isolate the within-reach object trial from frontier competition.
  n.memory.cells={};
  return {n,e,object,observed};
}
function finish(n,e,action,limit=900) {
  const validated=cognitiveAction(n,action);assert.ok(validated,'cognitive admission');
  const started=requestNpcAction(n,validated,e);assert.ok(started.ok,started.code);
  for(let steps=0;n.active&&steps<limit;steps++)tickNpc(n,1/60,e);
  assert.equal(n.active,null,'action terminated within the bounded test window');
  assert.ok(n.lastResult?.ok,n.lastResult?.code);return n.lastResult;
}
function pathLength(n,route) {return route.reduce((sum,p,i)=>sum+distance(i?route[i-1]:n.position,p),0);}

// These expected decisions/RNG values were generated with the exact pre-change
// src/discovery.js from commit 0c3c319355c566cc6d618355a2fb2fd0d42a292b,
// SHA-256 9c20347c4e888ddff372ead11d38a44cd3b7f1e7397d691ce64e46fca15f574e.
// They are frozen values, not expectations obtained from the candidate or HEAD.
for(const [seed,target,rng] of [
  [1,{x:4640,y:1600},3027450565],
  [3,{x:4640,y:1600},3345418727],
  [74193,{x:4480,y:1600},99226005],
])test(`nonbinding original-policy frontier decision and RNG stay exact (seed ${seed})`,()=>{
  const {n}=corridorFixture(seed);n.discovery.search.home={...n.position};
  const before=clone(n.memory);
  assert.deepEqual(discoveryDecision(n),moveDecision(target));assert.equal(n.rng,rng);
  assert.deepEqual(n.memory,before,'selection must not add world knowledge or failed edges');
});

test('changing only saved home leaves discovery decisions/RNG identical and preserves home',()=>{
  for(const fixture of [corridorFixture,remoteObjectFixture]){
    const original=fixture().n;
    const homes=[HOME,OUTWARD_START,{x:-20000,y:-20000},{x:20000,y:20000},null];
    let expectedDecision,expectedState;
    for(const home of homes){
      const n=clone(original);n.discovery.search.home=clone(home);
      const decision=discoveryDecision(n);assert.deepEqual(n.discovery.search.home,home);
      const normalized=clone(n);normalized.discovery.search.home=null;
      if(expectedDecision){assert.deepEqual(decision,expectedDecision);assert.deepEqual(normalized,expectedState);}
      else{expectedDecision=decision;expectedState=normalized;}
    }
  }
});

test('actual perception admits an outward action that physically completes with elapsed work',()=>{
  const {n,e,observed}=corridorFixture();
  const before={position:{...n.position},home:clone(n.discovery.search.home),elapsed:n.elapsed,
    kcal:n.physiology.totals.metabolizedKcal,water:n.physiology.totals.waterLostMl};
  assert.ok(distance(before.position,HOME)<DISCOVERY_RULES.searchRadius);
  const decision=discoveryDecision(n);assert.deepEqual(decision,moveDecision({x:4480,y:1600}));
  assert.ok(distance(decision.action.target,HOME)>DISCOVERY_RULES.searchRadius);
  assert.ok(observed.cells.some(c=>c.key===tileKey(decision.action.target)));
  const result=finish(n,e,decision.action);
  assert.equal(result.code,'ARRIVED');assert.equal(result.action,'move');
  assert.ok(distance(n.position,decision.action.target)<3);
  assert.ok(distance(n.position,HOME)>DISCOVERY_RULES.searchRadius);
  assert.ok(distance(n.position,HOME)>distance(before.position,HOME));
  assert.ok(result.distance>150);assert.ok(result.durationSeconds>1&&result.durationSeconds<NPC_RULES.maxActionSeconds);
  near(n.elapsed-before.elapsed,result.durationSeconds);
  assert.ok(n.physiology.totals.metabolizedKcal>before.kcal);
  assert.ok(n.physiology.totals.waterLostMl>before.water);
  assert.deepEqual(n.discovery.search.home,before.home);
  assert.ok(n.memory.experience.some(e=>e.type==='action'&&e.details.action?.type==='move'&&e.details.result?.code==='ARRIVED'));
});

test('a real currently visible remote ecology object remains eligible for a completed experiment',()=>{
  const {n,e,object,observed}=remoteObjectFixture();
  assert.ok(observed.objects.some(o=>o.id===object.id));
  assert.equal(lookupEcologyObject(e.ecology,object.id),object);
  const beforeRng=n.rng,decision=discoveryDecision(n);
  assert.deepEqual(decision,{action:{type:'inspect_object',targetId:object.id},reason:'An unfamiliar object and an untested body operation offer an experiment; I do not yet know the consequence.',need:'understanding',provider:'discovery-learner'});
  assert.notEqual(n.rng,beforeRng);assert.equal(n.rng,99226005);
  const nearHome=clone(n);nearHome.rng=beforeRng;nearHome.discovery.search.home={...n.position};
  assert.deepEqual(discoveryDecision(nearHome),decision);assert.equal(nearHome.rng,n.rng,'frozen original nonbinding object RNG');
  const quantity=object.quantity,kcal=n.physiology.totals.metabolizedKcal;
  const result=finish(n,e,decision.action);
  assert.equal(result.code,'OBJECT_OBSERVED');assert.ok(result.durationSeconds>0);
  assert.ok(n.physiology.totals.metabolizedKcal>kcal);assert.equal(object.quantity,quantity);
  assert.ok(n.discovery.experiments.some(x=>x.ok&&x.targetId===object.id&&x.primitive==='inspect_object'));
  assert.equal(n.discovery.techniques.length,0,'visibility and inspection do not install food knowledge');
});

test('blocked observed edges prevent policy selection and authoritative requests',()=>{
  const {n,e}=corridorFixture();
  n.memory.blockedEdges['54,20>55,20']={observedAt:n.elapsed,retryAfter:n.elapsed+60};
  const memory=clone(n.memory);
  assert.deepEqual(discoveryDecision(n),waitDecision);assert.deepEqual(n.memory,memory);
  const action={type:'move',target:OUTWARD_END};assert.deepEqual(cognitiveAction(n,action),action);
  assert.equal(requestNpcAction(n,action,e).code,'NO_KNOWN_ROUTE');assert.equal(n.active,null);
  assert.deepEqual(n.position,OUTWARD_START);
  const expired=clone(n);expired.elapsed=60;
  assert.equal(discoveryDecision(expired).action.type,'move','expired evidence allows reconsideration');
});

test('unobserved and disconnected endpoints do not become routes or new knowledge',()=>{
  for(const kind of ['empty','disconnected','unwalkable']){
    const {n,e}=corridorFixture();
    if(kind==='empty')n.memory.cells={};
    else if(kind==='disconnected')delete n.memory.cells['55,20'];
    else for(const cell of Object.values(n.memory.cells))if(cell.key!=='54,20')cell.walkable=false;
    const before=clone(n.memory.cells);
    assert.deepEqual(discoveryDecision(n),waitDecision,kind);assert.deepEqual(n.memory.cells,before);
    const action={type:'move',target:OUTWARD_END};
    assert.equal(Boolean(cognitiveAction(n,action)),kind==='disconnected');
    assert.equal(requestNpcAction(n,action,e).code,kind==='disconnected'?'NO_KNOWN_ROUTE':'UNOBSERVED_TARGET');
    assert.equal(n.active,null);assert.deepEqual(n.position,OUTWARD_START);
  }
});

test('other-scene terrain and remote object memories cannot supply current-scene affordances',()=>{
  const {n,e,object}=remoteObjectFixture();
  n.scene='refuge';n.position={...CAVE_SPAWN};n.memory.caveCells={};n.memory.caveExits={};
  const target={x:1280,y:1600},key=tileKey(target);
  n.memory.cells[key]={key,...target,scene:'valley',walkable:true,terrain:'remembered',visits:0,observedAt:n.elapsed};
  assert.ok(n.discovery.observations[object.id]);assert.equal(n.discovery.observations[object.id].scene,'valley');
  assert.deepEqual(discoveryDecision(n),waitDecision);
  assert.equal(cognitiveAction(n,{type:'move',target}),null);
  assert.equal(requestNpcAction(n,{type:'move',target},e).code,'UNOBSERVED_TARGET');
  assert.equal(n.active,null);assert.deepEqual(Object.keys(rememberedCells(n)),[]);
});

// Abstract remembered cave-map contracts: a U-shaped detour has endpoints near
// the body but a long complete route. These cells are deliberate unit inputs,
// not a claim that the U is a naturally observed or physically traversable cave.
function detourFixture(width=480) {
  const n=createNpc({mode:'discovery',seed:74193});n.scene='refuge';n.position={x:1280,y:1280};
  n.physiology.hoursSinceMeal=8;n.memory.caveExits.refuge={...CAVE_EXIT,observedAt:0};
  const cells=n.memory.caveCells.refuge={};n.memory.caveEdges.refuge={};
  const add=(x,y)=>{const key=tileKey({x,y});cells[key]={key,x,y,scene:'refuge',walkable:true,terrain:'remembered',visits:0,observedAt:0};};
  for(let x=1280;x>=1280-width;x-=80)add(x,1280);
  for(let y=1360;y<=1600;y+=80)add(1280-width,y);
  for(let x=1280-width+80;x<=1280;x+=80)add(x,1600);
  return n;
}

test('full route length rejects an attractive nearby endpoint beyond the action budget',()=>{
  const n=detourFixture(800),target={x:1280,y:1600};
  assert.equal(distance(n.position,target),320);
  assert.equal(knownRoute(rememberedCells(n),n.position,target),null,'24-edge route is 1920 units, beyond nominal 1800');
  const before=clone(n.memory);
  assert.deepEqual(discoveryDecision(n),waitDecision);assert.deepEqual(n.memory,before);
  assert.equal(requestNpcAction(n,{type:'move',target}).code,'NO_KNOWN_ROUTE');
});

for(const constraint of ['slow body','learned travel cost'])test(`${constraint} refuses the same nominally legal full detour accepted by an alert body`,()=>{
  const healthy=detourFixture(),limited=clone(healthy),target={x:1280,y:1600};
  const route=knownRoute(rememberedCells(healthy),healthy.position,target);
  assert.ok(route);assert.equal(pathLength(healthy,route),1280);
  assert.deepEqual(discoveryDecision(healthy),{action:{type:'move',target},reason:'I remember this route toward the opening.',need:'survival',provider:'discovery-learner'});
  if(constraint==='slow body'){
    limited.physiology.sleep.inertiaHours=.25;assert.equal(bodySignals(limited).sleepiness,'groggy');
    assert.ok(pathLength(limited,route)>CONFIG.walkSpeed*BIOLOGY_RULES.exhaustionWalkMultiplier*(NPC_RULES.maxActionSeconds-1));
  }else{
    limited.cognition.travel={samples:8,secondsPerUnit:.025};
    assert.ok(pathLength(limited,route)>1/limited.cognition.travel.secondsPerUnit*(NPC_RULES.maxActionSeconds-1));
  }
  const before=clone(limited.memory),rng=limited.rng;
  assert.deepEqual(discoveryDecision(limited),waitDecision);
  assert.deepEqual(limited.memory,before);assert.equal(limited.rng,rng);
  assert.deepEqual(knownRoute(rememberedCells(limited),limited.position,target),route,'nominal topology did not change');
});

function fileStorage(path) {return {getItem:key=>{assert.equal(key,CONFIG.saveKey);return readFileSync(path,'utf8');},setItem:(key,value)=>{assert.equal(key,CONFIG.saveKey);writeFileSync(path,value);}};}
function reopen(state,check) {
  const directory=mkdtempSync(join(tmpdir(),'aincrad-local-exploration-')),path=join(directory,'save.json');
  try{
    assert.equal(writeSave(fileStorage(path),state),true);
    const text=readFileSync(path,'utf8'),json=JSON.parse(text);
    assert.equal(json.npc,undefined,'only canonical actors are serialized');
    const reopened=loadSave(fileStorage(path));assert.equal(reopened.exists,true);assert.equal(reopened.blocked,false);assert.equal(reopened.error,null);
    check(reopened.state,json);
    assert.equal(writeSave(fileStorage(path),reopened.state),true);
    const again=loadSave(fileStorage(path));assert.equal(again.blocked,false);
    assert.deepEqual(again.state.environment.ecology,reopened.state.environment.ecology);
  }finally{rmSync(directory,{recursive:true,force:true});}
}

test('fresh JSON write/reopen preserves empty knowledge, next decision/RNG and finite ecology',()=>{
  const state=freshState(),ecology=clone(state.environment.ecology);
  reopen(state,(restored,json)=>{
    assert.deepEqual(restored.environment.ecology,ecology);
    assert.deepEqual(json.agents[0].discovery.search,{home:null,startedAt:0});
    assert.deepEqual(restored.agents.map(n=>n.id),['aster','mira']);
    for(let i=0;i<2;i++){
      const live=clone(state.agents[i]),saved=restored.agents[i];
      assert.deepEqual(saved.discovery,live.discovery);
      assert.deepEqual(discoveryDecision(saved),discoveryDecision(live));assert.equal(saved.rng,live.rng);
    }
    assert.equal(restored.environment.ecology.nextId,ecology.nextId);
  });
});

test('actual depleted ecology and outward next decision/RNG survive JSON disk reopen without refilling',()=>{
  const state=freshState(),n=state.agents[0],e=state.environment;
  const {object}=remoteObjectFixture({n,e}),beforeQuantity=object.quantity;
  finish(n,e,{type:'pull',targetId:object.id});assert.equal(object.quantity,beforeQuantity-1);
  const materialId=n.inventory.items[0];assert.ok(lookupEcologyObject(e.ecology,materialId));
  finish(n,e,{type:'release',targetId:materialId});assert.equal(n.inventory.items.length,0);
  for(let i=0;i<540;i++)tickNpc(n,1/60,e); // Expire current visibility without erasing its evidence.
  const retained=clone(n.discovery.observations);
  retainObservedCorridor(n,e);n.discovery.observations=retained;
  n.rng=74193;state.elapsed=e.elapsed=n.elapsed;
  const ecology=clone(e.ecology),energy=ecologyEnergy(e.ecology),home=clone(n.discovery.search.home);
  const expected=clone(n),decision=discoveryDecision(expected);
  assert.deepEqual(decision,moveDecision({x:4480,y:1600}));
  assert.deepEqual(home,HOME);assert.equal(expected.rng,99226005);
  reopen(state,(restored,json)=>{
    const saved=restored.agents[0];
    assert.deepEqual(restored.environment.ecology,ecology,'no stocks, objects, populations, IDs or regional allocations change');
    assert.equal(ecologyEnergy(restored.environment.ecology),energy);
    assert.equal(lookupEcologyObject(restored.environment.ecology,object.id).quantity,beforeQuantity-1);
    assert.deepEqual(lookupEcologyObject(restored.environment.ecology,materialId),lookupEcologyObject(e.ecology,materialId));
    assert.deepEqual(saved.discovery.search.home,home);
    assert.deepEqual(Object.keys(saved.discovery).sort(),Object.keys(n.discovery).sort(),'no new saved graph or policy fields');
    assert.deepEqual(Object.keys(json.agents[0].discovery.search).sort(),['home','startedAt']);
    assert.deepEqual(discoveryDecision(saved),decision);assert.equal(saved.rng,expected.rng);
    assert.deepEqual(saved.position,n.position);assert.equal(saved.elapsed,n.elapsed);
  });
});

test('observed cave exit behavior and its unchanged RNG still complete the real scene transition',()=>{
  const n=createNpc({mode:'discovery',seed:74193}),e=createEnvironment();
  n.scene='refuge';n.position={...CAVE_SPAWN};n.physiology.hoursSinceMeal=8;
  const observation=observeNpc(n,e);assert.ok(observation.exit);assert.ok(Object.keys(rememberedCells(n)).length>0);
  const expected={action:{type:'exit_shelter'},reason:'My body needs something outside this refuge.',need:'survival',provider:'discovery-learner'};
  // This is another frozen successful original-policy decision, with no RNG draw.
  assert.deepEqual(discoveryDecision(n),expected);assert.equal(n.rng,74193);
  const result=finish(n,e,expected.action);assert.equal(result.code,'EXITED_SHELTER');assert.equal(n.scene,'valley');
});

test('legacy actors retain their own supplied home radius and return policy',()=>{
  const n=createNpc({mode:'legacy',seed:74193});
  n.position={x:1600,y:0};n.memory.exploration.origin={x:0,y:0};
  for(let x=0;x<=20;x++){const key=`${x},0`;n.memory.cells[key]={key,x:x*80,y:0,scene:'valley',walkable:true,terrain:'remembered',visits:0,observedAt:0};}
  const bounds=searchBounds(n);assert.equal(bounds.radius,1000);assert.deepEqual(bounds.home,{x:0,y:0});
  const action=searchReturn(n);assert.equal(n.cognition.search.returning,true);assert.equal(action.type,'move');
  assert.ok(distance(action.target,bounds.home)<distance(n.position,bounds.home));
  assert.equal(n.mode,undefined);assert.equal(n.discovery,undefined);assert.equal(n.rng,74193);
});
