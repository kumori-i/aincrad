import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CONFIG, SPAWN } from '../src/config.js';
import {
  OZARK_PREVIEW_PROFILE, OZARK_WALKING_PILOT_PROFILE,
  selectFreshGeometryProfile,
} from '../src/geometry-profile.js';
import { createOzarkWalkingPilot } from '../src/ozark-pilot-geometry.js';
import { previewGroundColor } from '../src/preview-ground-dispatch.js';
import { freshState } from '../src/world.js';
import { createOzarkPreviewPixelAdapter } from '../scripts/ozark-preview-pixels.mjs';

const profile = OZARK_WALKING_PILOT_PROFILE;
const geometry = createOzarkWalkingPilot(profile);
const preview = createOzarkPreviewPixelAdapter(OZARK_PREVIEW_PROFILE);

test('pilot identity is exact, distinct, unsaved, and bound to its explicit policy', () => {
  const { identity, ...payload } = profile;
  const digest = 'sha256:' + createHash('sha256')
    .update(JSON.stringify(payload)).digest('hex');
  assert.equal(identity, digest);
  assert.notEqual(identity, OZARK_PREVIEW_PROFILE.identity);
  assert.equal(profile.scope, 'fresh-session-unsaved');
  assert.equal(Object.isFrozen(geometry), true);
  assert.equal(Object.isFrozen(geometry.profile), true);
  assert.equal(Object.isFrozen(geometry.spawn), true);
  assert.equal(Object.isFrozen(geometry.bounds), true);
  assert.equal(createOzarkWalkingPilot(structuredClone(profile)).profile, profile);
  for (const altered of [
    OZARK_PREVIEW_PROFILE,
    { ...profile, identity: 'sha256:forged' },
    { ...profile, seed: 92741 },
    { ...profile, maxGrade: .031 },
    { ...profile, maxX: 601 },
    { ...profile, save: true },
    undefined,
  ]) assert.throws(() => createOzarkWalkingPilot(altered));
  assert.throws(() => selectFreshGeometryProfile(profile));
  assert.throws(() => freshState({ geometryProfile: profile }));
  assert.deepEqual(freshState().player, SPAWN);
});

test('one generated landform feeds the pilot paint, water and height samples', () => {
  for (const point of [
    geometry.spawn, { x: -1200, y: 0 }, { x: -11800, y: 11800 },
    { x: -12000, y: 10200 },
  ]) {
    const actual = geometry.sample(point.x, point.y);
    const approved = preview.sampleAtPixel(point.x, point.y);
    for (const key of [
      'elevation', 'surfaceWaterDistance', 'sinkholePondDistance',
      'watershedDistance', 'crestRise', 'habitat', 'drainage',
    ]) assert.equal(actual[key], approved[key], `${key} at ${JSON.stringify(point)}`);
    assert.equal(previewGroundColor(actual.paint).length, 3);
    assert.equal(Object.isFrozen(actual), true);
    assert.equal(Object.isFrozen(actual.nearestChannel), true);
  }
  assert.equal(geometry.sample(-1200, 0).paint, 'surface-water');
  assert.equal(geometry.sample(-11800, 11800).paint, 'internal-pond');
  assert.equal(geometry.sample(-12000, 10200).paint, 'divide');
  assert.throws(() => geometry.sample(19001, 0), RangeError);
});

test('real dry spawn and eastward route clear radius and pilot relative grade', () => {
  assert.deepEqual(geometry.spawn, SPAWN);
  assert.deepEqual(geometry.bounds,
    { minX: -1500, maxX: 600, minY: -900, maxY: 900 });
  assert.equal(CONFIG.playerRadius, 10);
  const start = geometry.classify(geometry.spawn.x, geometry.spawn.y);
  assert.equal(start.walkable, true);
  assert.ok(start.grade < profile.maxGrade);
  const actor = { ...geometry.spawn };
  for (let index = 0; index < 19; index += 1) {
    assert.ok(geometry.move(actor, 1, 0, .25) > 0);
    assert.equal(geometry.classify(actor.x, actor.y).walkable, true);
  }
  assert.ok(actor.x >= 0);
  assert.equal(actor.y, geometry.spawn.y);
  assert.equal(geometry.lineOfSight(geometry.spawn, actor), true);
});

test('disc and swept movement honor the bounded shallow reach, pond and pilot bounds', () => {
  assert.equal(geometry.classify(-1200, 0).reason, 'surface-water');
  assert.equal(geometry.classify(-11800, 11800).reason, 'internal-pond');
  // Hazard classification is available over approved samples even though the
  // pond lies far outside the one corridor authorized for walking.
  assert.equal(geometry.classify(13000, -6200).reason, 'outside-pilot-bounds');
  assert.equal(geometry.classify(-100, -1400, 10).reason,
    'outside-pilot-bounds');
  assert.equal(geometry.classify(-100, -1400, 14).reason, 'surface-water');
  assert.equal(geometry.classify(19000, 0).reason, 'outside-approved-bounds');

  const bank = { x: -1200, y: 600 };
  assert.equal(geometry.classify(bank.x, bank.y).walkable, true);
  for (let index = 0; index < 100; index += 1) geometry.move(bank, 0, -1, .25);
  const shallow = geometry.classify(bank.x, bank.y);
  assert.equal(shallow.reason, 'shallow-water');
  assert.ok(shallow.depthProxy <= profile.wadeMaxDepthProxy);
  assert.ok(geometry.sample(bank.x, bank.y).surfaceWaterDistance * profile.cellPixels <
    CONFIG.playerRadius);
  assert.ok(bank.y > 0, 'the actual surface-water footprint stops this route');
  const stoppedAtBank = { ...bank };
  assert.equal(geometry.move(bank, 0, -1, 900), 0);
  assert.deepEqual(bank, stoppedAtBank);

  const edge = { x: 0, y: 380 };
  for (let index = 0; index < 100; index += 1) geometry.move(edge, 1, 0, .25);
  assert.ok(edge.x <= geometry.bounds.maxX - CONFIG.playerRadius);
  assert.equal(geometry.classify(edge.x, edge.y).walkable, true);
  assert.equal(geometry.move(edge, 1, 0, 900), 0);
});

test('the pilot grade policy blocks an actual steep dry site but not the route', () => {
  const steep = { x: -1450, y: -850 };
  const site = geometry.sample(steep.x, steep.y);
  assert.ok(site.surfaceWaterDistance * profile.cellPixels > CONFIG.playerRadius);
  assert.ok(site.sinkholePondDistance * profile.cellPixels > CONFIG.playerRadius);
  const blocked = geometry.classify(steep.x, steep.y);
  assert.equal(blocked.reason, 'excessive-grade');
  assert.ok(blocked.grade > profile.maxGrade);
  assert.equal(geometry.move({ ...steep }, 1, 0, .25), 0);
  assert.equal(geometry.classify(geometry.spawn.x, geometry.spawn.y).walkable, true);
  assert.equal(geometry.classify(0, 380).walkable, true);
});

test('sight sees across water and local observation omits private source fields', () => {
  assert.equal(geometry.lineOfSight(
    { x: -1200, y: 300 }, { x: -1200, y: -300 }), true);
  assert.equal(geometry.lineOfSight(geometry.spawn, { x: 800, y: 380 }), false);
  assert.equal(geometry.lineOfSight(geometry.spawn, { x: NaN, y: 380 }), false);
  const observation = geometry.observe(geometry.spawn);
  assert.equal(observation.habitat, 'wet-terrace');
  assert.equal(observation.ground, 'dry-land');
  assert.equal(Object.isFrozen(observation), true);
  assert.equal(Object.isFrozen(observation.nearby), true);
  assert.ok(observation.nearby.length > 0 && observation.nearby.length <= 16);
  for (const near of observation.nearby) {
    assert.equal(Object.isFrozen(near), true);
    assert.deepEqual(Object.keys(near), ['direction', 'ground', 'habitat']);
  }
  for (const hidden of ['elevation', 'crestRise', 'surfaceWaterDistance',
    'sinkholePondDistance', 'terminalCell', 'drainage', 'nearestChannel']) {
    assert.equal(Object.hasOwn(observation, hidden), false);
    assert.ok(observation.nearby.every(near => !Object.hasOwn(near, hidden)));
  }
  assert.throws(() => geometry.observe({ x: -1200, y: 0 }), RangeError);
});
