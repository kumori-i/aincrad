// Predeclared 2026-10-20, before executing the encounter acceptance scenario:
// seeds 74193, 74194, 74195; use each untouched fresh aquatic world. Select the
// initial fish nearest the human spawn (distance, then ID), and the closest
// actually dry/LOS bank found by a deterministic 2px ring / 32-angle scan within
// 80px. Place Aster there once, with its ordinary fresh body and no memory,
// learned answers, testimony, prior attempts or supplied procedure. This is a
// fixture exposure, not evidence of autonomous travel. Run only native
// discoveryDecision/requestNpcAction, native observation and fish/environment
// ticks for 600 unpaused seconds; do not pin either actor or fish, remove other
// visible objects, block care or alter coefficients. Report every seed outcome.
// Gate: independently chosen catch -> held pull -> sample -> delayed effect,
// then earned resampling of that same held tissue within the same600s bound;
// retained food proof must remain exact-specimen pull -> sample, never catch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CONFIG } from '../src/config.js';
import { DISCOVERY_RULES } from '../src/discovery-config.js';
import { createOzarkWorldGeometry, OZARK_WORLD_PROFILE } from '../src/ozark-world-geometry.js';
import { createOzarkEcology } from '../src/ozark-ecology.js';
import { createEnvironment } from '../src/environment.js';
import { createNpc } from '../src/npc-state.js';
import { createCommunity } from '../src/social.js';
import { bindOzarkWorldAgent } from '../src/ozark-agent-world.js';
import { observeNpc, requestNpcAction, tickNpc, cancelNpcAction } from '../src/npc.js';
import { requestDiscoveryAction, tickDiscoveryAction } from '../src/discovery-actions.js';
import { discoveryPrimitives, recentDiscoveryAim, discoveryDecision, processDiscoveryFeedback } from '../src/discovery.js';
import { validateNpc, recordEvent } from '../src/npc-memory.js';
import { cognitiveAction, adoptPlan } from '../src/cognition.js';
import { retainedProofIntegrityError } from '../src/proof-retention.js';
import { createProcedureExperience } from '../src/procedure-experience.js';
import { describeEcologyObject, lookupEcologyObject } from '../src/ecology.js';
import { validCaptureExperiment } from '../src/discovery-state.js';
import { PopulationRuntime } from '../src/population.js';
import { bodySignals } from '../src/interoception.js';

const geometry=createOzarkWorldGeometry();
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
function nearestBank(position){
  for(let r=2;r<=80;r+=2)for(let i=0;i<32;i++){
    const angle=i*Math.PI/16,p={x:position.x+Math.cos(angle)*r,y:position.y+Math.sin(angle)*r};
    if(geometry.classify(p.x,p.y,CONFIG.playerRadius).reason==='dry-ground'&&geometry.lineOfSight(p,position))return p;
  }
  return null;
}
function fixture(seed=74193,{observe=true}={}){
  const environment=createEnvironment(seed,{mode:'discovery',populate:false});
  environment.ecology=createOzarkEcology(geometry,seed,0,{finiteAquatic:true});
  const agents=['aster','mira'].map(id=>{const npc=createNpc({id,mode:'discovery',seed});npc.position={...geometry.agentSpawns[id]};return npc;});
  const state={version:11,features:{plantLifecycle:1,finiteAquatic:1,worldStructures:1},
    geometryIdentity:OZARK_WORLD_PROFILE.identity,simulationMode:'discovery',elapsed:0,scene:'valley',
    player:{...geometry.spawn},agents,npc:agents[0],environment,community:createCommunity()};
  const fish=[...environment.ecology.aquatic.fish].sort((a,b)=>dist(a.position,geometry.spawn)-dist(b.position,geometry.spawn)||a.id.localeCompare(b.id))[0];
  {assert.ok(fish,'fresh stock exists');const bank=nearestBank(fish.position);assert.ok(bank,'predeclared bank scan succeeds');agents[0].position=bank;}
  for(const npc of agents)bindOzarkWorldAgent(npc,geometry,state);
  if(observe)observeNpc(agents[0],environment);
  return {state,npc:agents[0],environment,fish};
}
// These guard/receipt fixtures intentionally tick only the actor. They are not
// evidence of native catchability; the separate policy trial ticks the world.
function finishStatic({npc,environment},action){
  const started=requestNpcAction(npc,action,environment);
  if(started.code==='ACTION_STARTED')for(let i=0;i<1000&&npc.active;i++)tickNpc(npc,1/60,environment);
  return npc.lastResult||started;
}

test('catch and held pull are feature scoped, with no recipe or nutrition oracle',()=>{
  const f=fixture();assert.ok(discoveryPrimitives(f.npc).includes('catch'));
  assert.equal(f.npc.discovery.techniques.length,0);
  const sensory=JSON.stringify(f.npc.discovery.observations[f.fish.id]);
  for(const word of ['phenotype','energyKcal','waterMl','fishTissue','materialType','edible'])assert.equal(sensory.includes(word),false,word);
});

test('capture stays direct-only and cannot enter a persistent multistep cognitive plan',()=>{
  const f=fixture(),before=JSON.stringify(f.npc);
  assert.equal(adoptPlan(f.npc,{goal:'Try a physical sequence.',need:'competence',steps:[
    {type:'inspect_object',targetId:f.fish.id},{type:'catch',targetId:f.fish.id},{type:'wait',seconds:1}]}),null);
  assert.equal(JSON.stringify(f.npc),before,'rejection leaves actor and plan evidence unchanged');
  assert.deepEqual(cognitiveAction(f.npc,{type:'catch',targetId:f.fish.id}),{type:'catch',targetId:f.fish.id});
});

test('catch requires a fresh firsthand observation, not saved memory or supplied aim',()=>{
  const f=fixture();assert.deepEqual(recentDiscoveryAim(f.npc,f.fish.id),f.fish.position);
  const raw=JSON.parse(JSON.stringify(f.npc)),restored=validateNpc(raw,{canStandAt:(x,y)=>geometry.canOccupy(x,y,CONFIG.playerRadius)});
  f.state.agents[0]=restored;bindOzarkWorldAgent(restored,geometry,f.state);
  assert.equal(recentDiscoveryAim(restored,f.fish.id),null);
  assert.equal(requestNpcAction(restored,{type:'catch',targetId:f.fish.id,aim:f.fish.position},f.environment).code,'FRESH_OBSERVATION_REQUIRED');
  f.npc.elapsed=DISCOVERY_RULES.catchObservationMaxAge+.01;
  assert.equal(requestNpcAction(f.npc,{type:'catch',targetId:f.fish.id},f.environment).code,'FRESH_OBSERVATION_REQUIRED');
  observeNpc(f.npc,f.environment);f.npc.discovery.observations[f.fish.id].position.x+=1;
  assert.equal(recentDiscoveryAim(f.npc,f.fish.id),null,'mutating memory cannot change runtime aim');
});

test('paid same-ID catch establishes ownership only; retention and restore preserve its exact receipt',()=>{
  const f=fixture(),result=finishStatic(f,{type:'catch',targetId:f.fish.id});
  assert.equal(result.ok,true);assert.equal(result.materialId,f.fish.id);assert.ok(Math.abs(result.durationSeconds-4)<1e-8);
  assert.equal(f.npc.inventory.items.filter(id=>id===f.fish.id).length,1);
  assert.equal(lookupEcologyObject(f.environment.ecology,f.fish.id).kind,'fish_specimen');
  assert.equal(f.npc.discovery.techniques.length,0);
  const catchAction=f.npc.discovery.experiments.find(e=>e.primitive==='catch');assert.ok(catchAction);
  for(let i=0;i<650;i++)recordEvent(f.npc,'debug',{code:'UNRELATED'});
  assert.ok(f.npc.discovery.experiments.some(e=>e.id===catchAction.id));
  assert.ok(f.npc.memory.experience.some(e=>e.id===catchAction.actionId));
  assert.equal(retainedProofIntegrityError(f.npc),null);
  const restored=validateNpc(JSON.parse(JSON.stringify(f.npc)),{canStandAt:(x,y)=>geometry.canOccupy(x,y,CONFIG.playerRadius)});
  assert.deepEqual(restored.inventory.items,[f.fish.id]);assert.equal(restored.discovery.techniques.length,0);
  const episode=createProcedureExperience(f.npc).episodes.find(e=>e.acquisition?.type==='catch');
  assert.equal(episode.proofStatus,'retained-acquisition-only');assert.deepEqual(episode.samples,[]);
  assert.ok(Math.abs(episode.observedCost.observedActionDurationLowerBoundSeconds-4)<1e-8);
});

test('capture identity and exact timed receipt are mandatory ownership proof',()=>{
  const f=fixture();finishStatic(f,{type:'catch',targetId:f.fish.id});
  const original=f.npc.discovery.experiments.find(e=>e.primitive==='catch');
  for(const patch of [{materialId:'object:99999999'},{durationSeconds:0},{durationSeconds:31}])assert.equal(validCaptureExperiment({...original,...patch}),false);
  const broken=JSON.parse(JSON.stringify(f.npc));broken.memory.experience.find(e=>e.id===original.actionId).details.result.durationSeconds=3;
  assert.equal(retainedProofIntegrityError(broken),'incomplete-held-provenance');
  const restored=validateNpc(broken,{canStandAt:(x,y)=>geometry.canOccupy(x,y,CONFIG.playerRadius)});
  assert.deepEqual(restored.inventory.items,[]);
});

test('new sightings during paid catch cannot retarget the fixed original aim',()=>{
  const f=fixture();assert.equal(requestNpcAction(f.npc,{type:'catch',targetId:f.fish.id},f.environment).code,'ACTION_STARTED');
  const neighbor=f.environment.ecology.aquatic.fish.find(other=>other!==f.fish&&dist(other.position,f.fish.position)>12&&dist(other.position,f.npc.position)<80);
  assert.ok(neighbor);f.fish.position={...neighbor.position};observeNpc(f.npc,f.environment);
  for(let i=0;i<300&&f.npc.active;i++)tickNpc(f.npc,1/60,f.environment);
  assert.equal(f.npc.lastResult.ok,false);assert.equal(f.npc.lastResult.code,'fish_missed');
  assert.ok(Math.abs(f.npc.lastResult.durationSeconds-4)<1e-8);assert.equal(f.npc.inventory.items.length,0);
  assert.equal(f.environment.ecology.aquatic.ledger.captureMisses,1);
});

test('copied/restarted catch has no runtime work witness and cannot dispatch the fish',()=>{
  const f=fixture();requestNpcAction(f.npc,{type:'catch',targetId:f.fish.id},f.environment);
  const beforeResult=structuredClone(f.npc.lastResult),beforeExperience=structuredClone(f.npc.memory.experience);
  f.npc.active=JSON.parse(JSON.stringify(f.npc.active));
  assert.equal(tickDiscoveryAction(f.npc,4,f.environment),false,'H1 rejects a foreign command before work or completion');
  assert.equal(f.npc.active,null);assert.deepEqual(f.npc.lastResult,beforeResult);
  assert.deepEqual(f.npc.memory.experience,beforeExperience,'a copied command cannot invent a receipt');
  assert.equal(f.npc.inventory.items.length,0);
  assert.equal(lookupEcologyObject(f.environment.ecology,f.fish.id).kind,'fish');
});

test('cancelled original catch object cannot be reattached to revive its runtime witness',()=>{
  const f=fixture();requestNpcAction(f.npc,{type:'catch',targetId:f.fish.id},f.environment);
  const active=f.npc.active;tickNpc(f.npc,.1,f.environment);assert.equal(cancelNpcAction(f.npc),true);
  f.npc.active=active;assert.equal(tickDiscoveryAction(f.npc,4,f.environment),false);
  assert.equal(f.npc.active,null);assert.equal(f.npc.inventory.items.length,0);
  assert.equal(lookupEcologyObject(f.environment.ecology,f.fish.id).kind,'fish');
});

test('completion rechecks awake shore and hands; a reentrant callback cannot catch twice',()=>{
  for(const changed of ['water','asleep','hands']){
    const f=fixture();requestNpcAction(f.npc,{type:'catch',targetId:f.fish.id},f.environment);
    if(changed==='water')f.npc.position={...f.fish.position};
    if(changed==='asleep')f.npc.lifecycle='COLLAPSED';
    if(changed==='hands')f.npc.inventory.items=['object:90000001','object:90000002','object:90000003','object:90000004'];
    let outcome;tickDiscoveryAction(f.npc,4,f.environment,{complete:(_n,_a,result)=>{outcome=result;}});
    assert.equal(outcome.ok,false,changed);assert.equal(outcome.durationSeconds,4);
    assert.equal(lookupEcologyObject(f.environment.ecology,f.fish.id).kind,'fish');
  }
  const f=fixture();requestDiscoveryAction(f.npc,{type:'catch',targetId:f.fish.id},f.environment);
  const active=f.npc.active;let calls=0;
  tickDiscoveryAction(f.npc,4,f.environment,{complete:()=>{calls++;assert.equal(tickDiscoveryAction(f.npc,4,f.environment),false);}});
  f.npc.active=active;assert.equal(tickDiscoveryAction(f.npc,4,f.environment),false);
  assert.equal(calls,1);assert.equal(f.environment.ecology.aquatic.ledger.captures,1);
});

test('generic held-object menu can choose pull without a food benefit and suppresses held grasp',()=>{
  const f=fixture();finishStatic(f,{type:'catch',targetId:f.fish.id});
  finishStatic(f,{type:'inspect_object',targetId:f.fish.id});
  // Isolated menu-unit projection: keep only this actually owned observation,
  // with no supplied technique, benefit, recipe, label or physical mutation.
  f.npc.discovery.observations={[f.fish.id]:f.npc.discovery.observations[f.fish.id]};
  f.npc.memory.cells={};const offered=new Set();
  for(let i=0;i<80;i++)offered.add(discoveryDecision(f.npc).action.type);
  assert.ok(offered.has('pull'));assert.equal(offered.has('grasp'),false);assert.equal(offered.has('catch'),false);
  assert.equal(f.npc.discovery.techniques.length,0);
  f.state.version=9;f.state.features={plantLifecycle:1};bindOzarkWorldAgent(f.npc,geometry,f.state);
  const old=new Set();for(let i=0;i<80;i++)old.add(discoveryDecision(f.npc).action.type);
  assert.equal(old.has('pull'),false);assert.equal(old.has('catch'),false);
});

test('held specimen is generically pullable, bare remains depleted, and only pull/sample earns food evidence',()=>{
  const f=fixture();finishStatic(f,{type:'catch',targetId:f.fish.id});
  assert.equal(finishStatic(f,{type:'sample',targetId:f.fish.id}).ok,false,'whole specimen cannot be swallowed');
  assert.equal(finishStatic(f,{type:'pull',targetId:f.fish.id}).ok,true);
  const tissueId=f.npc.inventory.items.find(id=>id!==f.fish.id);assert.ok(tissueId);
  assert.equal(describeEcologyObject(f.environment.ecology,f.fish.id,{actorId:f.npc.id}).count,0);
  assert.equal(f.npc.discovery.observations[f.fish.id].count,0);
  assert.equal(finishStatic(f,{type:'sample',targetId:tissueId}).ok,true);
  for(let i=0;i<1200;i++)tickNpc(f.npc,.1,f.environment);
  processDiscoveryFeedback(f.npc);
  assert.ok(f.npc.discovery.effects.some(e=>e.objectId===tissueId&&e.effect==='sustained'));
  assert.ok(f.npc.discovery.techniques.some(t=>t.sourceId===f.fish.id&&t.steps[0].type==='pull'));
  assert.equal(f.npc.discovery.techniques.some(t=>t.steps[0].type==='catch'||t.steps.length!==2),false);
  const forged=JSON.parse(JSON.stringify(f.npc)),earned=forged.discovery.techniques[0];
  forged.discovery.techniques.push({...earned,id:'forged-catch',steps:[{type:'catch',targetId:'$source'},{type:'sample',targetId:'$material'}]},
    {...earned,id:'forged-three-step',steps:[{type:'catch',targetId:'$source'},...earned.steps]});
  const restored=validateNpc(forged,{canStandAt:(x,y)=>geometry.canOccupy(x,y,CONFIG.playerRadius)});
  assert.deepEqual(restored.discovery.techniques.map(t=>t.id),[earned.id],'capture or three-step food grammars cannot restore');

  // A fresh bare-residue observation must not reopen a depleted learned pull.
  observeNpc(f.npc,f.environment);
  for(let i=0;i<10;i++)assert.notDeepEqual(discoveryDecision(f.npc).action,{type:'pull',targetId:f.fish.id});
});

let beforeArbitration;
async function preArbitrationPolicy(){
  if(beforeArbitration)return beforeArbitration;
  const source=readFileSync(new URL('../src/discovery.js',import.meta.url),'utf8');
  const current="  if(traversal&&(!ozarkFiniteAquaticAgent(npc)||traversal.need!=='understanding'))return wrap(traversal.action,traversal.reason,traversal.need);";
  const fallback="  if(traversal&&!choices.length)return wrap(traversal.action,traversal.reason,traversal.need);\n";
  assert.equal(source.split(current).length,2);assert.equal(source.split(fallback).length,2);
  const baseline=source.replace(current,'  if(traversal)return wrap(traversal.action,traversal.reason,traversal.need);').replace(fallback,'');
  const imports=baseline.replace(/from '(\.\/[^']+)'/g,(_,path)=>`from '${new URL(`../src/${path.slice(2)}`,import.meta.url).href}'`);
  beforeArbitration=await import(`data:text/javascript;base64,${Buffer.from(imports).toString('base64')}`);return beforeArbitration;
}
function cloneFixture(f){
  const state=structuredClone(f.state);for(const actor of state.agents)bindOzarkWorldAgent(actor,geometry,state);
  return {state,npc:state.agents[0],environment:state.environment};
}
test('optional terrain deferral preserves urgent deep-water safety',async()=>{
  const before=await preArbitrationPolicy();
  for(const seed of [74193,74194,74195]){
    const f=fixture(seed),control=cloneFixture(f);before.rememberDiscoveryObservation(control.npc,Object.values(control.npc.discovery.observations));
    const old=before.discoveryDecision(control.npc),current=discoveryDecision(f.npc);
    console.log('AQUATIC_PRECEDENCE '+JSON.stringify({seed,before:old,after:current}));
    assert.equal(old.action.type,'swim');assert.equal(old.need,'understanding');
    assert.ok(DISCOVERY_RULES.allPrimitives.includes(current.action.type),'generic local motor trial is no longer starved');
  }
  const f=fixture();f.npc.position={x:-1200,y:220};observeNpc(f.npc,f.environment);
  const control=cloneFixture(f);before.rememberDiscoveryObservation(control.npc,Object.values(control.npc.discovery.observations));
  const expected=before.discoveryDecision(control.npc),actual=discoveryDecision(f.npc);
  assert.equal(expected.need,'safety');assert.equal(expected.action.type,'swim');assert.deepEqual(actual,expected);
  assert.deepEqual(f.state,control.state,'deep-water escape retains complete state and RNG');
});

function nativeEncounter(seed){
  const f=fixture(seed,{observe:false}),runtime=new PopulationRuntime(f.state,{cardinal:false});
  const initialPosition={...f.fish.position},startPosition={...f.npc.position},events=[],decisions=[],seen=new Set();
  const totals=structuredClone(f.npc.physiology.totals);let motion=false,completed=false,earned=false,chain=null,travelPixels=0,lastPosition={...f.npc.position};
  for(let i=0;i<600*60;i++){
    runtime.tick(1/60);f.state.elapsed=f.environment.elapsed;travelPixels+=dist(lastPosition,f.npc.position);lastPosition={...f.npc.position};
    const live=f.environment.ecology.aquatic.fish.find(fish=>fish.id===f.fish.id);
    if(live&&dist(live.position,initialPosition)>0.01)motion=true;
    for(const event of f.npc.memory.experience)if(!seen.has(event.id)){seen.add(event.id);if(event.type==='action')events.push(structuredClone(event));else if(event.type==='decision')decisions.push(structuredClone(event));}
    const catches=events.filter(e=>e.details.action?.type==='catch'&&e.details.result?.ok);
    earned=false;
    for(const capture of catches){
      const pull=events.find(e=>e.id>capture.id&&e.details.action?.type==='pull'&&e.details.action.targetId===capture.details.action.targetId&&e.details.result?.ok);
      if(!pull)continue;
      const tissueId=pull.details.result.materialId,effect=f.npc.discovery.effects.find(e=>e.objectId===tissueId&&e.effect==='sustained');
      const sample=effect&&events.find(e=>e.id===effect.actionId&&e.id>pull.id&&e.details.action?.type==='sample'&&e.details.action.targetId===tissueId&&e.details.result?.ok);
      let repeat=null,repeatStartedAt=null,repeatDecision=null;
      for(const candidate of sample?events.filter(e=>e.id>sample.id&&e.at-(e.details.result?.durationSeconds||0)+1e-8>=effect.at&&e.details.action?.type==='sample'&&e.details.action.targetId===tissueId&&e.details.result?.ok):[]){
        const startedAt=candidate.at-candidate.details.result.durationSeconds;
        const decision=decisions.find(e=>e.id<candidate.id&&Math.abs(e.at-startedAt)<1e-6&&e.at+1e-8>=effect.at&&e.details.provider==='discovery-learner'&&/earlier portion of this held object brought bodily relief|previous portion of this held material brought relief/.test(e.details.summary));
        if(decision){repeat=candidate;repeatStartedAt=startedAt;repeatDecision=decision;break;}
      }
      if(repeatDecision){chain={fishId:capture.details.action.targetId,tissueId,catchActionId:capture.id,pullActionId:pull.id,sampleActionId:sample.id,effectId:effect.id,effectAt:effect.at,repeatSampleActionId:repeat.id,repeatSampleAt:repeat.at,repeatStartedAt,repeatDecisionId:repeatDecision.id,repeatReason:repeatDecision.details.summary};completed=true;break;}
    }
    earned=Boolean(chain&&f.npc.discovery.techniques.some(t=>t.sourceId===chain.fishId&&t.steps.length===2&&t.steps[0].type==='pull'&&t.steps[1].type==='sample'));
    if(completed&&earned)break;
  }
  const attempts=events.filter(e=>e.details.action?.type==='catch'),captures=attempts.filter(e=>e.details.result?.ok);
  const result={seed,scenario:'fixed local-encounter fixture, not autonomous travel',completed,earned,chain,motion,
    elapsed:f.npc.elapsed,startPosition,endPosition:{...f.npc.position},body:bodySignals(f.npc),
    catchAttempts:attempts.map(e=>({at:e.at,ok:e.details.result.ok,code:e.details.result.code,duration:e.details.result.durationSeconds||0})),
    captures:captures.length,fishPulls:events.filter(e=>e.details.action?.type==='pull'&&e.details.result?.ok&&captures.some(c=>c.details.action.targetId===e.details.action.targetId)).length,
    samples:events.filter(e=>e.details.action?.type==='sample'&&e.details.result?.ok).length,
    effects:f.npc.discovery.effects.map(e=>({objectId:e.objectId,effect:e.effect,at:e.at})),
    swallowedKcal:f.npc.physiology.totals.ingestedKcal-totals.ingestedKcal,
    absorbedKcal:f.npc.physiology.totals.absorbedKcal-totals.absorbedKcal,
    humanMetabolizedKcal:f.npc.physiology.totals.metabolizedKcal-totals.metabolizedKcal,
    worldFishSwallowedKcal:f.environment.ecology.aquatic.ledger.humanIngestedKcal,
    firstActions:events.slice(0,20).map(e=>({at:e.at,type:e.details.action?.type,targetId:e.details.action?.targetId,code:e.details.result?.code})),
    techniques:f.npc.discovery.techniques.map(t=>({sourceId:t.sourceId,steps:t.steps})),
    travelPixels,netDisplacementPixels:dist(startPosition,f.npc.position)};
  runtime.dispose();return result;
}
// Native acceptance is separately invocable so baseline guard tests remain
// quick. Since 2026-10-21 it is a nonblocking diagnostic, not a capability-release
// gate. Its original fixed trials and success assertion remain unchanged.
test('predeclared native autonomous local encounter and two fixed replications', {skip:process.env.AINCRAD_NATIVE_AQUATIC!=='1'},()=>{
  const fixedSeeds=[74193,74194,74195],requested=process.env.AINCRAD_NATIVE_AQUATIC_SEED;
  const seeds=requested?[Number(requested)]:fixedSeeds;assert.ok(seeds.every(seed=>fixedSeeds.includes(seed)),'only predeclared replication seeds');
  const results=[];for(const seed of seeds){const result=nativeEncounter(seed);results.push(result);console.log('AQUATIC_NATIVE_RESULT '+JSON.stringify(result));}
  assert.ok(results.every(r=>r.motion),'normal fish motion ran in all encounters');
  const primary=results.find(r=>r.seed===74193);if(primary)assert.equal(primary.completed&&primary.earned,true,'primary fixed scenario must earn native catch/pull/sample/effect and same-tissue resampling');
});
