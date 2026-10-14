import test from 'node:test';
import assert from 'node:assert/strict';
import { BODY_RULES, NPC_PRESETS, NPC_RULES } from '../src/config.js';
import { createNpc } from '../src/npc-state.js';
import { bodySignals, sensedEnvironment } from '../src/interoception.js';
import { createEnvironment, tickEnvironment } from '../src/environment.js';
import { canStand, distance } from '../src/world.js';
import { lineOfSight, rememberedCells } from '../src/perception.js';
import { observeNpc, requestNpcAction, tickNpc, collapseNpc, rescueNpc } from '../src/npc.js';

function advance(npc,env,seconds,step=.25){
  const frames=Math.ceil(seconds/step);
  for(let i=0;i<frames;i++){const dt=Math.min(step,seconds-i*step);tickEnvironment(env,dt);tickNpc(npc,dt,env);}
}
function comfortable(){const env=createEnvironment();env.settings.hourOverride=10;env.settings.weatherOverride='cloudy';return env;}

test('two fixed identities start on dry banks in view, with independent physical stores and memory',()=>{
  const a=createNpc(),m=createNpc({id:'mira'}),unknown=createNpc({id:'unapproved'});
  assert.equal(a.version,3);assert.equal(a.name,'Aster');assert.equal(m.id,'mira');assert.equal(m.name,'Mira');assert.equal(unknown.id,'aster');
  for(const n of [a,m]){assert.ok(canStand(n.position.x,n.position.y,n.scene));assert.equal(n.energy,BODY_RULES.initialEnergy);assert.equal(n.stamina,100);assert.equal(n.bodyMode,'awake');}
  assert.ok(lineOfSight(a.position,m.position));assert.notEqual(a.position,m.position);assert.notEqual(a.memory,m.memory);assert.notEqual(a.thermal,m.thermal);assert.notEqual(a.cognition,m.cognition);
  m.nourishment=20;assert.equal(a.nourishment,85);
});

test('bodily awareness uses sensations, including boundaries, without percentages or numerical telemetry',()=>{
  const n=createNpc();assert.equal(bodySignals(n).hunger,'content');assert.equal(bodySignals(n).thirst,'quenched');
  n.nourishment=56;n.hydration=44;n.stamina=12;n.fatigue=55;n.sleepPressure=65;n.health=65;n.thermal.wetness=80;n.sensation.feltTemperature=30;
  const signals=bodySignals(n);assert.equal(signals.hunger,'peckish');assert.equal(signals.thirst,'thirsty');assert.equal(signals.stamina,'winded');assert.equal(signals.fatigue,'weary');assert.equal(signals.sleepiness,'sleepy');assert.equal(signals.pain,'hurting');assert.equal(signals.wetness,'soaked');assert.equal(signals.thermal,'hot');
  for(const word of Object.values(signals)){assert.equal(typeof word,'string');assert.equal(/[0-9%]/.test(word),false);}
  n.sensation.feltTemperature=18;n.thermal.hot=70;assert.equal(bodySignals(n).thermal,'overheated');n.thermal.hot=0;n.thermal.cold=45;assert.equal(bodySignals(n).thermal,'shivering');
  n.nourishment=0;assert.equal(bodySignals(n).hunger,'faint with hunger');assert.equal(bodySignals(n).overall,'urgent');
  collapseNpc(n);assert.equal(bodySignals(n).overall,'unconscious');
});

test('thermal warning sensations distinguish accumulated bodily strain from ambient warmth and cold',()=>{
  const n=createNpc();
  for(const [strain,ambient,ordinary,warning,critical] of [
    ['hot',30,'hot','overheated','dangerously hot'],
    ['cold',5,'cold','shivering','dangerously cold'],
  ]){
    n.thermal.hot=0;n.thermal.cold=0;n.sensation.feltTemperature=ambient;
    assert.equal(bodySignals(n).thermal,ordinary);assert.equal(sensedEnvironment(n).warmth,ordinary);
    n.thermal[strain]=NPC_RULES.thermalWarning-.01;assert.equal(bodySignals(n).thermal,ordinary);
    n.thermal[strain]=NPC_RULES.thermalWarning;assert.equal(bodySignals(n).thermal,warning);
    n.sensation.feltTemperature=18;assert.equal(bodySignals(n).thermal,warning);assert.equal(sensedEnvironment(n).warmth,'comfortable');
    n.thermal[strain]=NPC_RULES.criticalThermal-.01;assert.equal(bodySignals(n).thermal,warning);
    n.thermal[strain]=NPC_RULES.criticalThermal;assert.equal(bodySignals(n).thermal,critical);
    const observation=observeNpc(n,comfortable());assert.equal(observation.body.thermal,critical);
    assert.ok(Object.values(observation.body).every(word=>typeof word==='string'&&!/[0-9%]/.test(word)));
    n.thermal[strain]=NPC_RULES.thermalWarning-.01;assert.equal(bodySignals(n).thermal,'comfortable');
  }
});

test('local perception exposes only qualitative body and environment descriptions while preserving spatial affordances',()=>{
  const n=createNpc(),env=comfortable(),observation=observeNpc(n,env);
  assert.ok(observation.cells.length);assert.ok(observation.sources.length);assert.equal(observation.body.hunger,'content');assert.equal(observation.environment.timeOfDay,'morning');
  for(const key of ['hydration','nourishment','health','thermal','feelings','sensation','energy','stamina','fatigue','sleepPressure'])assert.equal(key in observation,false,key);
  assert.ok(Object.values(observation.body).every(v=>typeof v==='string'));assert.ok(Object.values(observation.environment).every(v=>typeof v==='string'));
  assert.equal(typeof n.sensation.feltTemperature,'number');n.sensation.hour=23;n.sensation.wind=3;assert.equal(sensedEnvironment(n).timeOfDay,'night');assert.equal(sensedEnvironment(n).wind,'gusty');
});

test('actual movement spends stamina and energy and adds fatigue; a real meal restores available energy',()=>{
  const n=createNpc(),env=comfortable();observeNpc(n,env);
  const target=Object.values(rememberedCells(n)).find(c=>c.walkable&&distance(c,n.position)>120&&distance(c,n.position)<180);
  assert.ok(target);const before={energy:n.energy,stamina:n.stamina,fatigue:n.fatigue};assert.equal(requestNpcAction(n,{type:'move',target},env).code,'STARTED');advance(n,env,.5);
  assert.ok(n.stamina<before.stamina);assert.ok(n.energy<before.energy);assert.ok(n.fatigue>before.fatigue);assert.equal(bodySignals(n).activity,'walking');
  n.active=null;n.bodyMode='awake';n.energy=40;n.nourishment=30;n.inventory.apples.push({foodId:'apple:trail-orchard',collectedAt:0,eventId:null});
  const meal=requestNpcAction(n,{type:'eat'},env);assert.equal(meal.code,'ATE');assert.equal(n.energy,40+45*BODY_RULES.mealEnergyPerNourishment);assert.equal(n.nourishment,75);assert.equal(n.stats.independentMeals,0);
});

test('rest replenishes stamina and relieves fatigue but sleep also relieves sleep pressure; both consume survival reserves',()=>{
  const rest=createNpc(),sleep=createNpc(),er=comfortable(),es=comfortable();
  for(const n of [rest,sleep]){n.energy=40;n.stamina=20;n.fatigue=60;n.sleepPressure=60;}
  assert.equal(requestNpcAction(rest,{type:'rest',seconds:4},er).code,'STARTED');assert.equal(requestNpcAction(sleep,{type:'sleep',seconds:4},es).code,'STARTED');assert.equal(rest.bodyMode,'resting');assert.equal(bodySignals(sleep).activity,'sleeping');
  advance(rest,er,4);advance(sleep,es,4);
  assert.equal(rest.lastResult.code,'RESTED');assert.equal(sleep.lastResult.code,'SLEPT');assert.equal(rest.active,null);assert.equal(sleep.bodyMode,'awake');assert.ok(rest.stamina>20);assert.ok(rest.fatigue<60);assert.ok(rest.sleepPressure>60);assert.ok(sleep.sleepPressure<60);assert.ok(sleep.fatigue<rest.fatigue);assert.ok(sleep.energy>rest.energy);
  for(const n of [rest,sleep]){assert.ok(n.hydration<85);assert.ok(n.nourishment<85);assert.equal(n.lifecycle,'AWAKE');}
  assert.ok(Math.abs(rest.hydration-sleep.hydration)<1e-8);assert.ok(Math.abs(rest.nourishment-sleep.nourishment)<1e-8);
});

test('hunger, thirst, exposure and injury wake or reject sleeping before critical risk',()=>{
  for(const cause of ['hunger','thirst','exposure','injury']){
    const n=createNpc(),env=comfortable();assert.equal(requestNpcAction(n,{type:'sleep',seconds:12},env).code,'STARTED');
    if(cause==='hunger')n.nourishment=BODY_RULES.restInterruptReserve+.01;if(cause==='thirst')n.hydration=BODY_RULES.restInterruptReserve+.01;if(cause==='exposure')n.thermal.hot=BODY_RULES.restInterruptThermal+2;if(cause==='injury')n.health=BODY_RULES.restInterruptHealth-1;
    tickNpc(n,.25,env);assert.equal(n.lastResult.code,'REST_INTERRUPTED',cause);assert.equal(n.active,null);assert.equal(n.bodyMode,'awake');assert.equal(n.nextDecisionAt,n.elapsed);
    assert.equal(requestNpcAction(n,{type:'rest',seconds:1},env).code,'UNSAFE_TO_REST',cause);
  }
});

test('body and rest timers depend on unpaused simulation time, independently of step frequency',()=>{
  const a=createNpc(),b=createNpc(),ea=comfortable(),eb=comfortable();
  for(const n of [a,b]){n.stamina=10;n.fatigue=50;n.sleepPressure=60;requestNpcAction(n,{type:'sleep',seconds:12});}
  advance(a,ea,8,1/60);advance(b,eb,8,.25);
  for(const field of ['energy','stamina','fatigue','sleepPressure','hydration','nourishment'])assert.ok(Math.abs(a[field]-b[field])<1e-7,field);
  const frozen=JSON.stringify(a);tickNpc(a,0,ea);tickNpc(a,NaN,ea);assert.equal(JSON.stringify(a),frozen);assert.ok(a.active);assert.ok(Math.abs(a.elapsed-8)<1e-8);
  assert.ok(Math.abs(a.nourishment-(85-NPC_PRESETS.normal.nourishmentDepletionPerSecond*8))<1e-8);
});

test('rest durations are bounded, collapse cancels sleep and rescue gives partial bodily relief without supplies or credit',()=>{
  const n=createNpc();for(const seconds of [0,-1,13,Infinity,NaN]){assert.equal(requestNpcAction(n,{type:'sleep',seconds}).code,'INVALID_REQUEST');assert.equal(n.active,null);}
  assert.equal(requestNpcAction(n,{type:'sleep',seconds:12}).code,'STARTED');n.energy=0;n.stamina=0;n.fatigue=100;n.sleepPressure=100;
  collapseNpc(n,'starvation');assert.equal(n.active,null);assert.equal(n.lastResult.code,'COLLAPSED');assert.equal(rescueNpc(n).ok,true);assert.equal(rescueNpc(n).ok,false);
  assert.ok(n.energy>0&&n.energy<100);assert.ok(n.stamina>0&&n.stamina<100);assert.ok(n.fatigue>0&&n.fatigue<100);assert.ok(n.sleepPressure>0&&n.sleepPressure<100);assert.equal(n.inventory.apples.length,0);assert.equal(n.stats.independentMeals,0);assert.equal(n.stats.independentDrinks,0);
});
