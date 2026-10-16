import test from 'node:test';
import assert from 'node:assert/strict';
import {JUVENILE_RULES as R, seedTransfer, juvenileGrowth, juvenileLoss} from '../src/plant-lifecycle.js';
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
