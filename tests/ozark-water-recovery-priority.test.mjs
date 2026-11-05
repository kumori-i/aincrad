import test from 'node:test';
import assert from 'node:assert/strict';
import { createOzarkState } from '../src/ozark-save.js';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { bindOzarkWorldAgent } from '../src/ozark-agent-world.js';
import { observeNpc, requestNpcAction, tickNpc } from '../src/npc.js';
import { discoveryDecision, processDiscoveryFeedback } from '../src/discovery.js';
import { bodySignals, restUnsafe } from '../src/interoception.js';
import { projectPhysiology } from '../src/biology.js';
const geometry=createOzarkWorldGeometry();
function fixture(){
  const state=createOzarkState(geometry),actor=state.agents[0];
  bindOzarkWorldAgent(actor,geometry,state);
  actor.position={x:-1120,y:400};actor.physiology.waterDeficitMl=500;
  actor.physiology.fatigue=55;projectPhysiology(actor);
  assert.ok(observeNpc(actor,state.environment).sources.length);
  assert.equal(bodySignals(actor).thirst,'dry mouth');assert.equal(restUnsafe(actor),false);
  return {actor,state};
}
function waterTravel(actor){const d=discoveryDecision(actor);assert.equal(d.need,'water');assert.equal(d.action.type,'move');return d;}
test('mild thirst defers remote observed-water travel for existing safe muscle recovery',()=>{
  const {actor}=fixture();const d=discoveryDecision(actor);assert.equal(d.need,'rest');assert.equal(d.action.type,'rest');
});
test('mild thirst defers remote observed-water travel for existing safe sleep',()=>{
  const {actor}=fixture();actor.physiology.fatigue=10;actor.physiology.sleepPressure=75;projectPhysiology(actor);
  assert.equal(bodySignals(actor).sleepiness,'sleepy');assert.equal(discoveryDecision(actor).action.type,'sleep');
});
for(const [label,deficit] of [['thirsty',1000],['parched',2000],['desperate thirst',3500]])test(`${label} still selects remembered-water travel before recovery`,()=>{
  const {actor}=fixture();actor.physiology.waterDeficitMl=deficit;projectPhysiology(actor);assert.equal(bodySignals(actor).thirst,label);waterTravel(actor);
});
test('fresh mild-thirst actor still travels; carried water is drunk immediately despite fatigue',()=>{
  const {actor}=fixture();actor.physiology.fatigue=10;projectPhysiology(actor);waterTravel(actor);
  actor.physiology.fatigue=55;actor.flask.water=1;projectPhysiology(actor);assert.equal(discoveryDecision(actor).action.type,'drink');
});
test('nearby actually observed water is filled before recovery without adding a journey',()=>{
  const {actor,state}=fixture();const source=Object.values(actor.memory.sources).sort((a,b)=>Math.hypot(a.x-actor.position.x,a.y-actor.position.y)-Math.hypot(b.x-actor.position.x,b.y-actor.position.y))[0];
  // Authored placement isolates near collection, not a claimed autonomous route.
  actor.position={x:source.x,y:source.y};observeNpc(actor,state.environment);
  const d=discoveryDecision(actor);assert.equal(d.action.type,'fill_flask');assert.equal(d.need,'water');
});
for(const [label,configure] of [
  ['low available energy',n=>{n.physiology.availableEnergyKcal=1;}],
  ['severe thermal exposure',n=>{n.thermal.cold=70;}],
  ['poor health',n=>{n.physiology.health=20;}],
])test(`unsafe recovery (${label}) does not suppress remembered-water travel`,()=>{
  const {actor}=fixture();configure(actor);projectPhysiology(actor);assert.equal(restUnsafe(actor),true);waterTravel(actor);
});
test('an actual recent rest refusal still permits water travel when safety has not qualitatively improved',()=>{
  const {actor,state}=fixture();
  actor.thermal.cold=65;projectPhysiology(actor);
  const refusal=requestNpcAction(actor,{type:'rest',seconds:5},state.environment);assert.equal(refusal.code,'UNSAFE_TO_REST');
  const before=bodySignals(actor);actor.thermal.cold=64.99;projectPhysiology(actor);
  assert.equal(restUnsafe(actor),false);assert.deepEqual(bodySignals(actor),before);waterTravel(actor);
  actor.elapsed+=60;assert.equal(discoveryDecision(actor).action.type,'rest');
});
for(const mode of ['fatigue','sleep'])test(`real paid walk crosses ${mode} threshold; mild thirst then yields to admitted recovery`,()=>{
  const {actor,state}=fixture();actor.physiology.fatigue=mode==='fatigue'?49.999:10;
  if(mode==='sleep')actor.physiology.sleepPressure=60+(actor.physiology.circadianAlertness||0)*12-.001;
  projectPhysiology(actor);const before=bodySignals(actor),spent=actor.physiology.totals.metabolizedKcal,start=actor.elapsed;
  assert.equal(requestNpcAction(actor,{type:'move',target:{x:-1120,y:480}},state.environment).code,'STARTED');
  for(let i=0;i<300&&actor.active;i++)tickNpc(actor,1/60,state.environment);
  assert.equal(actor.active,null);assert.equal(actor.lastResult.code,'ARRIVED');assert.ok(actor.elapsed>start);assert.ok(actor.physiology.totals.metabolizedKcal>spent);
  observeNpc(actor,state.environment);const after=bodySignals(actor);
  assert.equal(before[mode==='fatigue'?'fatigue':'sleepiness'],mode==='fatigue'?'tired':'drowsy');
  assert.equal(after[mode==='fatigue'?'fatigue':'sleepiness'],mode==='fatigue'?'weary':'sleepy');assert.equal(after.thirst,'dry mouth');
  const d=discoveryDecision(actor);assert.equal(d.action.type,mode==='fatigue'?'rest':'sleep');
  const admission=requestNpcAction(actor,d.action,state.environment);assert.equal(admission.ok,true);assert.ok(actor.active);
  tickNpc(actor,1/60,state.environment);assert.equal(actor.active.request.type,d.action.type);
});

test('mild-water travel deferral leaves urgent personally learned held food ahead of recovery',()=>{
  const {actor,state}=fixture(),plant=state.environment.ecology.plants.find(p=>p.kind==='apple_tree'&&p.quantity>0);
  // Authored placements isolate priority. The food evidence itself is earned.
  actor.position={x:plant.position.x+45,y:plant.position.y};actor.physiology.fatigue=10;observeNpc(actor,state.environment);
  const paid=action=>{assert.equal(requestNpcAction(actor,action,state.environment).code,'ACTION_STARTED');for(let i=0;i<1200&&actor.active;i++)tickNpc(actor,1/60,state.environment);assert.equal(actor.active,null);assert.equal(actor.lastResult.ok,true);};
  paid({type:'pull',targetId:plant.id});const id=actor.inventory.items.at(-1);paid({type:'sample',targetId:id});
  for(let i=0;i<5400;i++){tickNpc(actor,1/60,state.environment);processDiscoveryFeedback(actor);}
  assert.ok(actor.discovery.effects.some(e=>e.objectId===id&&e.effect==='sustained'));
  actor.position={x:-1120,y:400};actor.physiology.waterDeficitMl=500;actor.physiology.hoursSinceMeal=20;actor.physiology.satietyHours=0;actor.physiology.fatigue=55;projectPhysiology(actor);observeNpc(actor,state.environment);
  assert.equal(restUnsafe(actor),false);assert.ok(['ravenous','faint with hunger'].includes(bodySignals(actor).hunger));
  const d=discoveryDecision(actor);assert.equal(d.need,'food');assert.deepEqual(d.action,{type:'sample',targetId:id});
});
