import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, ENV_RULES, PONDS, APPLE_PATCHES, STARTER_NPC_SPAWN, CAVES } from '../src/config.js';
import { canStandOutside, waterDistance, HABITAT_TRAILS, moveActor, distance, objectsInRect } from '../src/world.js';
import { createEnvironment, tickEnvironment, validateEnvironment, environmentConditions, dailyTemperature, ambientEcology, environmentHour } from '../src/environment.js';
import { waterSource, nearbyWaterSources, foodSource, nearbyFoodSources, gatherFood, shelterSource, nearbyShelters } from '../src/resources.js';

test('fresh Aster habitat has a dry bank and observed reachable water without preloading food', () => {
  assert.ok(canStandOutside(STARTER_NPC_SPAWN.x, STARTER_NPC_SPAWN.y));
  const sources = nearbyWaterSources(STARTER_NPC_SPAWN, 80);
  assert.ok(sources.some(s => s.id === 'pond:spring:4'));
  assert.equal(nearbyFoodSources(STARTER_NPC_SPAWN).length, 0);
  for (const pond of PONDS) {
    assert.equal(canStandOutside(pond.x, pond.y), false);
    const sources = Array.from({ length: 8 }, (_, i) => waterSource(`pond:${pond.id}:${i}`)).filter(Boolean);
    assert.ok(sources.length >= 2, `${pond.id} requires alternate physical banks`);
    for (const s of sources) { assert.ok(canStandOutside(s.x, s.y)); assert.ok(waterDistance(s.x, s.y) > 12 && waterDistance(s.x, s.y) < 65); }
  }
});

test('food patches and all supplied habitat trail segments are physically walkable', () => {
  for (const patch of APPLE_PATCHES) assert.ok(foodSource(`apple:${patch.id}`), `unreachable food ${patch.id}`);
  for (const [ax, ay, bx, by] of HABITAT_TRAILS) {
    const actor = { x: ax, y: ay }, time = distance(actor, { x: bx, y: by }) / CONFIG.walkSpeed;
    for (let i = 0; i < Math.ceil(time / CONFIG.fixedStep); i++) moveActor(actor, bx - actor.x, by - actor.y, CONFIG.fixedStep);
    assert.ok(distance(actor, { x: bx, y: by }) < 3, `blocked habitat trail ${ax},${ay} to ${bx},${by}`);
  }
  const refuge = shelterSource('refuge'); assert.ok(refuge);
  const route = [[276,760],[276,470],[880,470],[880,700],[1750,1050],[2680,1840],[2800,1535]];
  const seconds = route.slice(1).reduce((n, [x, y], i) => n + distance({ x, y }, { x: route[i][0], y: route[i][1] }) / CONFIG.walkSpeed, 0);
  assert.ok(seconds >= 15 && seconds <= 30, `refuge route ${seconds}s`);
  assert.equal(nearbyShelters(refuge, 10)[0].id, 'refuge');
});

test('seeded weather and renewal advance only with positive simulation time and agree across timestep partitions', () => {
  const a = createEnvironment(74193), b = createEnvironment(74193);
  gatherFood('apple:trail-orchard', a, 3); gatherFood('apple:trail-orchard', b, 3);
  const before = structuredClone(a); tickEnvironment(a, 0); tickEnvironment(a, -1); tickEnvironment(a, NaN);
  assert.deepEqual(a, before);
  tickEnvironment(a, 730);
  for (let i = 0; i < 730; i++) tickEnvironment(b, 1);
  assert.deepEqual(a, b);
  assert.equal(environmentHour(a), (8 + 730 / 3600 * 24) % 24);
  const kinds = new Set(); const c = createEnvironment(3);
  for (let i = 0; i < 30; i++) { tickEnvironment(c, ENV_RULES.weatherSeconds); kinds.add(c.weather.kind); }
  assert.equal(kinds.size, 4);
});

test('day curve peaks at 2 PM, cools at night, and weather changes felt conditions', () => {
  assert.equal(dailyTemperature(14), ENV_RULES.maximumTemperature);
  assert.equal(dailyTemperature(4), ENV_RULES.minimumTemperature);
  assert.ok(dailyTemperature(2) < dailyTemperature(13));
  const env = createEnvironment(); env.settings.hourOverride = 14; env.settings.weatherOverride = 'clear';
  const point = { x: 5000, y: 0, scene: 'valley' }, clear = environmentConditions(env, point);
  env.settings.weatherOverride = 'windy'; const windy = environmentConditions(env, point);
  env.settings.weatherOverride = 'rainy'; const rain = environmentConditions(env, point);
  assert.ok(windy.feltTemperature < clear.feltTemperature);
  assert.ok(rain.raining); assert.ok(rain.airTemperature < clear.airTemperature);
  assert.ok(environmentConditions(env, { ...point, thermal: { wetness: 100 } }).feltTemperature < rain.feltTemperature);
  const cave = environmentConditions(env, { position: { x: 1320, y: 1510 }, scene: 'refuge', thermal: { wetness: 100 } });
  assert.equal(cave.feltTemperature, 18); assert.equal(cave.wind, 0); assert.equal(cave.raining, false); assert.equal(cave.sheltered, true);
  assert.equal(environmentConditions(env, { ...point, scene: 'forged' }).sheltered, false);
});

test('physical tree canopies provide daytime shade', () => {
  const env = createEnvironment(); env.settings.hourOverride = 14; env.settings.weatherOverride = 'clear';
  const trees = objectsInRect(4000, 3500, 2200, 2200).filter(o => o.kind !== 'rock');
  assert.ok(trees.length);
  const tree = trees[0], p = { x: tree.x + 55 * tree.scale, y: tree.y };
  assert.equal(environmentConditions(env, p).shade, true);
});

test('food collection depletes physical stocks, rejects arbitrary sources/amounts, and renews after ten active minutes', () => {
  const env = createEnvironment(), id = 'apple:trail-orchard';
  assert.equal(gatherFood(id, env, 4).ok, false);
  assert.equal(gatherFood('apple:unknown', env).code, 'UNKNOWN_SOURCE');
  assert.deepEqual(gatherFood(id, env, 2), { ok: true, amount: 2, remaining: 1, code: 'GATHERED' });
  assert.equal(gatherFood(id, env, 3).amount, 1);
  assert.equal(foodSource(id, env).available, false);
  assert.equal(gatherFood(id, env).code, 'RESOURCE_DEPLETED');
  tickEnvironment(env, ENV_RULES.foodRenewalSeconds - 1); assert.equal(foodSource(id, env).stock, 0);
  tickEnvironment(env, 1); assert.equal(foodSource(id, env).stock, 3);
});

test('environment persistence preserves bounded seed, overrides and depleted stocks while rejecting untrusted fields', () => {
  const env = createEnvironment(19); tickEnvironment(env, 77); gatherFood('apple:mint-grove', env, 2);
  env.settings.hourOverride = 2; env.settings.weatherOverride = 'windy';
  assert.deepEqual(validateEnvironment(JSON.parse(JSON.stringify(env)), { elapsed: 77 }), env);
  const bad = validateEnvironment({ seed: 3, elapsed: Infinity, settings: { hourOverride: 99, weatherOverride: 'script' }, weather: { kind: 'script' }, foodStocks: [{ id: 'apple:trail-orchard', stock: 10000, renewAt: 1e99 }, { id: 'unknown', stock: 4 }], exec: 'unsafe' });
  assert.equal(bad.elapsed, 0); assert.equal(bad.settings.hourOverride, null); assert.equal(bad.settings.weatherOverride, null);
  assert.equal(bad.foodStocks.length, APPLE_PATCHES.length); assert.equal(bad.foodStocks[0].stock, 3); assert.ok(!('exec' in bad));
  assert.deepEqual(nearbyWaterSources({ position: STARTER_NPC_SPAWN, scene: CAVES[0].id }), []);
  assert.deepEqual(nearbyFoodSources({ position: STARTER_NPC_SPAWN, scene: 'refuge' }), []);
});

test('ambient animals fish and plants are seeded bounded and clock-driven without food mutations', () => {
  const env = createEnvironment(), before = structuredClone(env), a = ambientEcology(STARTER_NPC_SPAWN, 1800, env);
  assert.deepEqual(a, ambientEcology(STARTER_NPC_SPAWN, 1800, env));
  assert.ok(a.length <= 160); assert.ok(a.some(e => e.kind === 'fish')); assert.ok(a.some(e => ['rabbit','deer','bird'].includes(e.kind)));
  assert.ok(a.some(e => e.kind === 'flowers')); assert.deepEqual(env, before);
  tickEnvironment(env, 12); assert.notDeepEqual(ambientEcology(STARTER_NPC_SPAWN, 1800, env), a);
  assert.deepEqual(ambientEcology({ position: { x: 1320, y: 1510 }, scene: 'refuge' }, 1800, env), []);
});
