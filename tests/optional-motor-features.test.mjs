import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpc } from '../src/npc-state.js';
import { createEnvironment } from '../src/environment.js';
import { createEcology } from '../src/ecology.js';
import { observeNpc } from '../src/npc.js';
import { discoveryDecision } from '../src/discovery.js';
import { DISCOVERY_RULES } from '../src/discovery-config.js';
import { projectPhysiology } from '../src/biology.js';
import { OPTIONAL_MOTOR_TYPES, optionalMotorFeatures, rankOptionalMotorChoices } from '../src/optional-motor-features.js';
import { createOptionalMotorModel } from '../src/optional-motor-core.js';

test('numeric optional features project genuine locally admitted choices',()=>{
  const actor=createNpc({mode:'discovery',seed:74193});
  const environment=createEnvironment({seed:74193});
  environment.ecology=createEcology(74193);
  environment.ecology.plants=environment.ecology.plants.filter(p=>['object:1','object:4'].includes(p.id));
  environment.ecology.animals=[];environment.ecology.materials=[];
  actor.position={x:400,y:1080};observeNpc(actor,environment);
  let choices=null;
  discoveryDecision(actor,{handlingCuriosity:false,chooseOptional:rows=>{choices=rows;return null;}});
  assert.ok(choices?.length>2);
  assert.deepEqual(OPTIONAL_MOTOR_TYPES,DISCOVERY_RULES.allPrimitives);
  for(const choice of choices){
    const features=optionalMotorFeatures(actor,choice);
    if(choice.action.type==='move'){assert.equal(features,null);continue;}
    assert.ok(features instanceof Float64Array);
    assert.equal(features.length,12);
    assert.equal(features.slice(0,7).reduce((sum,value)=>sum+value,0),1);
    assert.ok([...features].every(value=>Number.isFinite(value)&&value>=0&&value<=1));
  }
});

test('opaque target identity and authored score cannot become model input',()=>{
  const actor={position:{x:0,y:0},scene:'valley',elapsed:12,
    inventory:{items:[]},discovery:{observations:{
      'object:1':{position:{x:40,y:0},scene:'valley',observedAt:10},
      'object:999':{position:{x:40,y:0},scene:'valley',observedAt:10},
    },trials:{'object:1|pull':{attempts:2,failures:1},
      'object:999|pull':{attempts:2,failures:1}}}};
  const before=structuredClone(actor);
  const first=optionalMotorFeatures(actor,{action:{type:'pull',targetId:'object:1'},
    get score(){throw Error('authored score is forbidden');}});
  const other=optionalMotorFeatures(actor,{action:{type:'pull',targetId:'object:999'},score:1e9});
  assert.deepEqual(first,other);
  assert.deepEqual(actor,before);
  first[3]=0;
  assert.equal(other[3],1,'feature arrays are defensive copies');
});

test('stale, unseen, invalid and unsupported choices abstain',()=>{
  const actor={position:{x:0,y:0},scene:'valley',elapsed:12,
    inventory:{items:[]},discovery:{observations:{'object:1':{
      position:{x:10,y:0},scene:'valley',observedAt:3}},trials:{}}};
  const choice={action:{type:'pull',targetId:'object:1'}};
  assert.equal(optionalMotorFeatures(actor,choice),null);
  actor.discovery.observations['object:1'].observedAt=12;
  assert.equal(optionalMotorFeatures(actor,{action:{type:'move',target:{x:5,y:0}}}),null);
  assert.equal(optionalMotorFeatures(actor,{action:{type:'pull',targetId:'__proto__'}}),null);
  actor.discovery.trials['object:1|pull']={attempts:1,failures:2};
  assert.equal(optionalMotorFeatures(actor,choice),null);
});

test('prototype ranker abstains cold or over cap without reading authored scores',()=>{
  const actor={position:{x:0,y:0},scene:'valley',elapsed:1,
    inventory:{items:[]},discovery:{observations:{'object:1':{
      position:{x:10,y:0},scene:'valley',observedAt:1}},trials:{}}};
  const choice={action:{type:'pull',targetId:'object:1'},
    get score(){throw Error('authored score leaked');}};
  const model=createOptionalMotorModel();
  assert.equal(rankOptionalMotorChoices(actor,[choice],model,0),null);
  assert.equal(rankOptionalMotorChoices(actor,Array(65).fill(choice),model,4),null);
  assert.equal(rankOptionalMotorChoices(actor,[{action:{type:'move'}}],model,4),null);
  assert.equal(rankOptionalMotorChoices(actor,[choice],model,4),0);
  assert.equal(rankOptionalMotorChoices(actor,[choice],{weights:new Float64Array(1)},4),null);
});

test('urgent bodily care returns before an optional model can inspect choices',()=>{
  const actor=createNpc({mode:'discovery',seed:74193});
  let calls=0;
  const options={chooseOptional(){calls++;return 0;}};
  actor.physiology.waterDeficitMl=1000;
  actor.flask.water=200;
  projectPhysiology(actor);
  assert.equal(discoveryDecision(actor,options).action.type,'drink');
  assert.equal(calls,0);
  actor.physiology.waterDeficitMl=0;
  actor.physiology.sleepPressure=95;
  actor.physiology.fatigue=80;
  projectPhysiology(actor);
  assert.ok(['sleep','rest'].includes(discoveryDecision(actor,options).action.type));
  assert.equal(calls,0);
});
