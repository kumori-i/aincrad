import test from 'node:test';
import assert from 'node:assert/strict';
import {JUVENILE_RULES as R, seedTransfer, juvenileGrowth, juvenileLoss, juvenileStrikeLoss} from '../src/plant-lifecycle.js';
const apple = {massGrams:180, energyKcal:95, waterMl:153};
const conditions = {days:1, moisture:.5, daylight:1, soilNutrients:100};
test('seed transfer preserves each material stock without changing the source', () => {
  const before = structuredClone(apple), result = seedTransfer(apple);
  assert.equal(result.transferred.massGrams, 2);
  for (const key of Object.keys(apple)) assert.equal(result.transferred[key] + result.remaining[key], apple[key]);
  assert.deepEqual(apple, before);
});
test('insufficient or malformed source cannot create a seed', () => {
  for (const value of [null, {...apple,massGrams:1}, {...apple,energyKcal:NaN}, {...apple,waterMl:181}]) assert.equal(seedTransfer(value),null);
});
test('exact final seed exhausts each source property', () => {
  assert.deepEqual(seedTransfer({massGrams:2,energyKcal:1,waterMl:1.5}).remaining,{massGrams:0,energyKcal:0,waterMl:0});
});
test('growth has explicit external inputs and local abstract soil cost', () => {
  const result = juvenileGrowth(seedTransfer(apple).transferred, conditions);
  assert.deepEqual(result, {input:{massGrams:4,energyKcal:2,waterMl:2.8},nutrientCost:.016});
});
test('soil, light, drought and juvenile capacity bound growth', () => {
  const seed = seedTransfer(apple).transferred;
  for (const override of [{soilNutrients:0},{daylight:0},{moisture:0},{days:0}]) assert.equal(juvenileGrowth(seed,{...conditions,...override}).input.massGrams,0);
  assert.equal(juvenileGrowth(seed,{...conditions,soilNutrients:.004}).input.massGrams,1);
  assert.equal(juvenileGrowth({massGrams:R.maxMassGrams,energyKcal:50,waterMl:100},conditions).input.massGrams,0);
});
test('drought transfers proportional stock and exact terminal remainder', () => {
  const seed = seedTransfer(apple).transferred;
  const loss = juvenileLoss(seed,{days:1,moisture:0});
  for (const key of Object.keys(seed)) assert.equal(loss.remaining[key]+loss.lost[key],seed[key]);
  assert.equal(loss.terminal,false);
  const terminal=juvenileLoss(seed,{days:100,moisture:0});
  assert.deepEqual(terminal.lost,seed); assert.deepEqual(terminal.remaining,{massGrams:0,energyKcal:0,waterMl:0}); assert.equal(terminal.terminal,true);
});
test('healthy juvenile loses no stock; invalid conditions are rejected', () => {
  const seed=seedTransfer(apple).transferred;
  assert.deepEqual(juvenileLoss(seed,{days:1,moisture:1}).remaining,seed);
  assert.equal(juvenileLoss(seed,{days:-1,moisture:0}),null);
  assert.equal(juvenileGrowth(seed,{...conditions,daylight:Infinity}),null);
});

test('zero-duration tiny stock is preserved and overflow cannot enter growth', () => {
  const tiny={massGrams:.01,energyKcal:.005,waterMl:.007};
  assert.deepEqual(juvenileLoss(tiny,{days:0,moisture:0}).remaining,tiny);
  assert.equal(juvenileLoss(tiny,{days:0,moisture:0}).terminal,false);
  assert.equal(juvenileGrowth(tiny,{...conditions,days:Number.MAX_VALUE}),null);
  assert.equal(juvenileGrowth(tiny,{...conditions,days:Number.MAX_VALUE,daylight:0}).input.massGrams,0);
});
test('bounded juvenile lifecycle closes finite energy and mass input accounts', () => {
  const transfer=seedTransfer(apple), initial=transfer.transferred;
  let current={...initial}, soil=.1, externalMass=0, externalEnergy=0, externalWater=0;
  for(let step=0;step<120;step++){
    const growth=juvenileGrowth(current,{...conditions,days:1/24,soilNutrients:soil});
    soil-=growth.nutrientCost;
    for(const key of Object.keys(current))current[key]+=growth.input[key];
    externalMass+=growth.input.massGrams;externalEnergy+=growth.input.energyKcal;externalWater+=growth.input.waterMl;
  }
  assert.ok(soil>=-1e-12);
  assert.ok(Math.abs(externalMass*R.nutrientsPerGram+soil-.1)<1e-12);
  const released={massGrams:0,energyKcal:0,waterMl:0};
  for(let step=0;step<10000;step++){
    const loss=juvenileLoss(current,{days:.25,moisture:0});
    for(const key of Object.keys(current))released[key]+=loss.lost[key];
    current=loss.remaining;
    if(loss.terminal)break;
  }
  assert.equal(current.massGrams,0);
  for(const [key,input]of Object.entries({massGrams:externalMass,energyKcal:externalEnergy,waterMl:externalWater})){
    assert.ok(Math.abs(released[key]-initial[key]-input)<1e-10,key);
  }
});

test('constant drought retention composes across equal elapsed-time partitions', () => {
  const seed=seedTransfer(apple).transferred;
  const one=juvenileLoss(seed,{days:20,moisture:0});
  let split={...seed};
  for(let day=0;day<20;day++)split=juvenileLoss(split,{days:1,moisture:0}).remaining;
  for(const key of Object.keys(seed))assert.ok(Math.abs(one.remaining[key]-split[key])<1e-12,key);
  assert.equal(one.terminal,false);
  assert.ok(one.remaining.massGrams>R.terminalMassGrams);
});

test('strike planning removes ten grams per finite power capped at four, without mutation', () => {
  const current={massGrams:100,energyKcal:51,waterMl:73},before=structuredClone(current);
  for(const [power,mass] of [[0,0],[.25,2.5],[1,10],[2,20],[4,40],[5,40],[Number.MAX_VALUE,40]]){
    const plan=juvenileStrikeLoss(current,{power}),f=mass/current.massGrams;
    assert.deepEqual(plan.lost,{massGrams:mass,energyKcal:current.energyKcal*f,waterMl:current.waterMl*f});
    for(const key of Object.keys(current))assert.equal(plan.remaining[key]+plan.lost[key],current[key]);
    assert.equal(plan.terminal,false);
  }
  assert.deepEqual(juvenileStrikeLoss(current),juvenileStrikeLoss(current,{power:1}));
  assert.deepEqual(current,before);
});

test('invalid strike power and invalid structural stocks fail closed', () => {
  for(const power of [-1,NaN,Infinity,-Infinity,'1',null,{},true])assert.equal(juvenileStrikeLoss(apple,{power}),null);
  for(const current of [null,{...apple,massGrams:-1},{...apple,energyKcal:NaN},{...apple,waterMl:181},{...apple,massGrams:Infinity}])assert.equal(juvenileStrikeLoss(current),null);
});

test('strike threshold consumes the exact terminal remnant but preserves zero-power stock', () => {
  for(const current of [{massGrams:2,energyKcal:95/90,waterMl:1.7},{massGrams:10.05,energyKcal:5.123,waterMl:7.341},{massGrams:.01,energyKcal:.003,waterMl:.007}]){
    const plan=juvenileStrikeLoss(current);
    assert.equal(plan.terminal,true);assert.deepEqual(plan.lost,current);assert.deepEqual(plan.remaining,{massGrams:0,energyKcal:0,waterMl:0});
    const zero=juvenileStrikeLoss(current,{power:0});assert.equal(zero.terminal,false);assert.deepEqual(zero.remaining,current);assert.deepEqual(zero.lost,{massGrams:0,energyKcal:0,waterMl:0});
  }
  const retained=juvenileStrikeLoss({massGrams:10.25,energyKcal:5,waterMl:7});
  assert.equal(retained.terminal,false);assert.equal(retained.remaining.massGrams,.25);
  assert.deepEqual(juvenileStrikeLoss({massGrams:0,energyKcal:0,waterMl:0}),{lost:{massGrams:0,energyKcal:0,waterMl:0},remaining:{massGrams:0,energyKcal:0,waterMl:0},terminal:false});
});

test('repeated strikes exhaust finite stock exactly once without negative or extra properties', () => {
  const initial={massGrams:143.07,energyKcal:71.123,waterMl:100.777},sum={massGrams:0,energyKcal:0,waterMl:0};
  let current={...initial},deaths=0;
  for(let i=0;i<30;i++){
    const loss=juvenileStrikeLoss({...current,hidden:'discarded'},{power:1});
    for(const key of Object.keys(sum)){sum[key]+=loss.lost[key];assert.ok(loss.remaining[key]>=0);}
    assert.deepEqual(Object.keys(loss.lost),Object.keys(sum));assert.deepEqual(Object.keys(loss.remaining),Object.keys(sum));
    current=loss.remaining;deaths+=Number(loss.terminal);
  }
  assert.equal(deaths,1);assert.deepEqual(current,{massGrams:0,energyKcal:0,waterMl:0});
  for(const key of Object.keys(sum))assert.ok(Math.abs(sum[key]-initial[key])<1e-12,key);
});
