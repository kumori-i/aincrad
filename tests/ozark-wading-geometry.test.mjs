import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { OZARK_WALKING_PILOT_PROFILE as profile } from '../src/geometry-profile.js';
import { createOzarkWalkingPilot } from '../src/ozark-pilot-geometry.js';
import { generateOzarkPreview } from '../src/ozark-preview-model.js';

const geometry = createOzarkWalkingPilot(profile);
const near = (actual, expected, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

test('v2 identity pins the bounded authored wading policy and downstream path', () => {
  const { identity, ...payload } = profile;
  assert.equal(identity, 'sha256:' + createHash('sha256')
    .update(JSON.stringify(payload)).digest('hex'));
  assert.equal(profile.kind, 'ozark-wading-pilot-v2');
  assert.equal(profile.scope, 'fresh-session-unsaved');
  assert.equal(profile.wadeMaxDepthProxy, .5);
  assert.equal(profile.wadeDepthSpan, 100);
  const descriptor = generateOzarkPreview(profile.seed);
  const from = descriptor.cells[descriptor.mainChannel[profile.currentFromMainIndex]];
  const to = descriptor.cells[descriptor.mainChannel[profile.currentToMainIndex]];
  assert.deepEqual([from.x, from.y, to.x, to.y], [44, 36, 45, 35]);
  const shallow = geometry.sample(-1200, 240);
  assert.equal(shallow.paint, 'surface-water');
  assert.equal(shallow.waterBand, 'shallow-water');
  assert.equal(shallow.currentCue, 'downstream');
  assert.equal(Object.isFrozen(shallow.currentDirection), true);
  near(shallow.currentDirection.x, Math.SQRT1_2);
  near(shallow.currentDirection.y, -Math.SQRT1_2);
});

test('reachable bank enters shallow water, and deep core and other water remain blocked', () => {
  const actor = { ...geometry.spawn };
  for (let index = 0; index < 210; index += 1) geometry.move(actor, -1, 0, 1 / 60);
  near(actor.x, -1205);
  near(actor.y, 380);
  for (let index = 0; index < 80; index += 1) geometry.advance(actor, 0, -1, 1 / 60);
  assert.equal(geometry.classify(actor.x, actor.y).reason, 'shallow-water');
  assert.ok(geometry.classify(actor.x, actor.y).depthProxy <= .5);
  assert.ok(actor.y < 280, `actor never entered painted water: ${actor.y}`);
  for (let index = 0; index < 100; index += 1) geometry.advance(actor, 0, 1, 1 / 60);
  assert.equal(geometry.classify(actor.x, actor.y).reason, 'dry-ground');

  near(geometry.classify(-1200, 240).depthProxy, .402943725, 1e-6);
  assert.equal(geometry.classify(-1200, 220).reason, 'surface-water');
  assert.equal(geometry.sample(-1200, 220).waterBand, 'deep-water');
  assert.equal(geometry.classify(-1400, 450).reason, 'surface-water');
  assert.equal(geometry.sample(-1400, 450).waterBand, 'unassessed-water');
  assert.equal(geometry.classify(-11800, 11800).reason, 'internal-pond');
  assert.equal(geometry.sample(-11800, 11800).waterBand, null);
});

test('idle current displaces downstream but swept collision keeps deep water and bounds closed', () => {
  const actor = { x: -1200, y: 270 };
  const start = { ...actor };
  let waterSeconds = 0;
  let driftDistance = 0;
  for (let index = 0; index < 120; index += 1) {
    const step = geometry.advance(actor, 0, 0, 1 / 60);
    waterSeconds += step.waterSeconds;
    driftDistance += step.driftDistance;
    assert.ok(geometry.classify(actor.x, actor.y).walkable);
    assert.ok(step.depthProxy <= .5);
  }
  near(waterSeconds, 2);
  assert.ok(driftDistance > 5);
  assert.ok(actor.x > start.x && actor.y < start.y);
  const towardCore = { x: -1200, y: 240 };
  for (let index = 0; index < 180; index += 1) {
    geometry.advance(towardCore, 0, -1, 1 / 60);
    const footing = geometry.classify(towardCore.x, towardCore.y);
    assert.ok(footing.walkable);
    assert.ok(footing.depthProxy <= .5);
    assert.ok(towardCore.x >= geometry.bounds.minX + 10);
    assert.ok(towardCore.y >= geometry.bounds.minY + 10);
  }
  assert.notEqual(geometry.classify(towardCore.x, towardCore.y).reason,
    'surface-water');
});

test('fixed internal slices preserve current, position and contact time across caller steps', () => {
  const run = step => {
    const actor = { x: -1200, y: 270 };
    let waterSeconds = 0;
    let driftDistance = 0;
    for (let index = 0; index < Math.round(1 / step); index += 1) {
      const result = geometry.advance(actor, 0, 1, step);
      waterSeconds += result.waterSeconds;
      driftDistance += result.driftDistance;
    }
    return { actor, waterSeconds, driftDistance };
  };
  const sixty = run(1 / 60);
  const oneTwenty = run(1 / 120);
  near(sixty.actor.x, oneTwenty.actor.x);
  near(sixty.actor.y, oneTwenty.actor.y);
  near(sixty.waterSeconds, oneTwenty.waterSeconds);
  near(sixty.driftDistance, oneTwenty.driftDistance);
  assert.ok(sixty.waterSeconds > 0 && sixty.waterSeconds < 1);
  assert.equal(geometry.classify(sixty.actor.x, sixty.actor.y).reason, 'dry-ground');
});

test('local observation reports seen footing and current qualitatively only', () => {
  const shallow = geometry.observe({ x: -1200, y: 240 });
  assert.equal(shallow.ground, 'shallow-water');
  assert.equal(shallow.currentCue, 'downstream');
  assert.equal(geometry.observe(geometry.spawn).currentCue, null);
  const hidden = ['depthProxy', 'currentDirection', 'surfaceWaterDistance',
    'elevation', 'drainage', 'terminalCell', 'nearestChannel'];
  for (const key of hidden) {
    assert.equal(Object.hasOwn(shallow, key), false);
    assert.ok(shallow.nearby.every(nearby => !Object.hasOwn(nearby, key)));
  }
  assert.ok(shallow.nearby.every(nearby =>
    Object.keys(nearby).join(',') === 'direction,ground,habitat'));
  assert.throws(() => geometry.observe({ x: -1200, y: 220 }), RangeError);
});
