import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, SPAWN } from '../src/config.js';
import {
  LEGACY_GEOMETRY, OZARK_PREVIEW_PROFILE, selectFreshGeometryProfile,
} from '../src/geometry-profile.js';
import { createOzarkPreviewTraversalFixture } from '../src/preview-traversal-fixture.js';
import { freshState } from '../src/world.js';
import {
  createOzarkPreviewPixelAdapter, createOzarkPreviewPixelProfile,
} from '../scripts/ozark-preview-pixels.mjs';

const adapter = createOzarkPreviewPixelAdapter(OZARK_PREVIEW_PROFILE);
const selection = selectFreshGeometryProfile(OZARK_PREVIEW_PROFILE);
const fixture = createOzarkPreviewTraversalFixture(selection, adapter);
const radius = CONFIG.playerRadius;

test('fixture requires the exact approved preview source and leaves legacy startup alone', () => {
  assert.equal(Object.isFrozen(fixture), true);
  assert.equal(fixture.profile, OZARK_PREVIEW_PROFILE);
  assert.throws(() => createOzarkPreviewTraversalFixture(LEGACY_GEOMETRY, adapter));
  assert.throws(() => createOzarkPreviewTraversalFixture({ ...selection }, adapter));
  const otherProfile = createOzarkPreviewPixelProfile({
    seed: 92741, centerX: 0, centerY: 0, cellPixels: 400,
  });
  const otherAdapter = createOzarkPreviewPixelAdapter(otherProfile);
  assert.throws(() => createOzarkPreviewTraversalFixture(selection, otherAdapter));
  assert.throws(() => freshState({ geometryProfile: OZARK_PREVIEW_PROFILE }), /not playable/);
  assert.deepEqual(freshState().player, SPAWN);
  assert.equal(selectFreshGeometryProfile(), LEGACY_GEOMETRY);
});

test('drawn-footprint classifier accounts for actor radius in preview pixels', () => {
  const cases = [
    [{ x: 13000, y: -6200 }, 'provisional-dry', 'drawn-footprint-clear'],
    [{ x: 200, y: -1400 }, 'blocked', 'surface-water-footprint'],
    [{ x: -11800, y: 11800 }, 'blocked', 'internal-pond-footprint'],
    [{ x: -12000, y: 10200 }, 'provisional-dry', 'drawn-footprint-clear'],
    // The center is dry, but its 9.3 px river clearance is below a 10 px disc.
    [{ x: -96, y: -1400 }, 'blocked', 'surface-water-footprint'],
    [{ x: -19000, y: 0 }, 'blocked', 'outside-preview-bounds'],
  ];
  for (const [point, status, reason] of cases) {
    const result = fixture.classifyFootprint(point, radius);
    assert.equal(result.status, status, JSON.stringify(point));
    assert.equal(result.reason, reason, JSON.stringify(point));
    assert.equal(Object.isFrozen(result), true);
  }
  const dry = fixture.classifyFootprint({ x: 13000, y: -6200 }, radius);
  assert.equal(dry.watershedContact, false);
  assert.equal(dry.topographicPassability, 'unverified');
  const divide = fixture.classifyFootprint({ x: -12000, y: 10200 }, radius);
  assert.equal(divide.watershedContact, true);
  assert.equal(divide.watershedDistancePixels, 0);
  assert.ok(divide.crestRise > 0);
  assert.equal(divide.topographicPassability, 'unverified');
  assert.equal(fixture.classifyFootprint({ x: -100, y: -1400 }, 10).status,
    'provisional-dry');
  assert.equal(fixture.classifyFootprint({ x: -100, y: -1400 }, 14).reason,
    'surface-water-footprint');
  for (const invalid of [0, -1, Infinity, NaN, 401]) {
    assert.throws(() => fixture.classifyFootprint(SPAWN, invalid), /radius/);
  }
  assert.throws(() => fixture.classifyFootprint({ x: NaN, y: 0 }, radius), /finite/);
  assert.throws(() => fixture.classifyFootprint({ x: 0, y: Infinity }, radius), /finite/);
});

test('explicit bounded spawn candidates choose the first provisional dry site', () => {
  const wet = { x: 200, y: -1400 };
  const pond = { x: -11800, y: 11800 };
  const divide = { x: -12000, y: 10200 };
  const dry = { x: 13000, y: -6200 };
  const choice = fixture.chooseDrySpawn([wet, pond, SPAWN, divide, dry], radius);
  assert.equal(choice.status, 'provisional-dry');
  assert.equal(choice.reason, 'drawn-footprint-clear');
  assert.deepEqual(choice.point, SPAWN);
  assert.equal(choice.index, 2);
  assert.equal(Object.isFrozen(choice.point), true);
  assert.equal(choice.watershedContact, false);
  assert.equal(choice.topographicPassability, 'unverified');
  assert.deepEqual(fixture.chooseDrySpawn([SPAWN, dry], radius).point, SPAWN);
  const rimChoice = fixture.chooseDrySpawn([wet, pond, divide], radius);
  assert.deepEqual(rimChoice.point, divide);
  assert.equal(rimChoice.index, 2);
  assert.equal(rimChoice.watershedContact, true);
  assert.ok(rimChoice.crestRise > 0);
  assert.equal(rimChoice.topographicPassability, 'unverified');
  assert.deepEqual(fixture.chooseDrySpawn([wet, pond], radius), {
    status: 'blocked', reason: 'no-dry-candidate', point: null, index: -1,
  });
  assert.equal(fixture.chooseDrySpawn([], radius).reason, 'no-dry-candidate');
  assert.throws(() => fixture.chooseDrySpawn(Array(65).fill(SPAWN), radius), /bounded/);
  assert.throws(() => fixture.chooseDrySpawn([null], radius), /finite/);
});

test('local straight segment checks drawn water between dry endpoints', () => {
  const dry = fixture.checkStraightSegment(SPAWN, { x: 0, y: 380 }, radius);
  assert.equal(dry.status, 'provisional-clear');
  assert.equal(dry.reason, 'drawn-footprint-clear');
  assert.equal(dry.sampleCount, 137);
  assert.equal(dry.watershedContact, false);
  assert.equal(dry.topographicPassability, 'unverified');
  assert.equal(fixture.checkStraightSegment(SPAWN, { x: 0, y: 380 }, 14).status,
    'provisional-clear');

  const from = { x: -1200, y: -800 };
  const to = { x: -1200, y: 600 };
  assert.equal(fixture.classifyFootprint(from, radius).status, 'provisional-dry');
  assert.equal(fixture.classifyFootprint(to, radius).status, 'provisional-dry');
  const crossing = fixture.checkStraightSegment(from, to, radius);
  assert.equal(crossing.status, 'blocked');
  assert.match(crossing.reason, /surface-water/);
  assert.match(fixture.checkStraightSegment(from, to, 14).reason, /surface-water/);
  assert.ok(crossing.sampleIndex > 0 && crossing.sampleIndex < crossing.sampleCount - 1);
  assert.equal(Object.isFrozen(crossing.at), true);

  // Endpoints can each clear a disc but still lack the margin needed to
  // certify every point between finite route probes.
  const closeFrom = { x: -99, y: -1400 };
  const closeTo = { x: -97, y: -1400 };
  assert.equal(fixture.classifyFootprint(closeFrom, radius).status, 'provisional-dry');
  assert.equal(fixture.classifyFootprint(closeTo, radius).status, 'provisional-dry');
  assert.equal(fixture.checkStraightSegment(closeFrom, closeTo, radius).reason,
    'surface-water-margin');

  assert.equal(fixture.checkStraightSegment(SPAWN, SPAWN, radius).status,
    'provisional-clear');
  const watershedCrossing = fixture.checkStraightSegment(
    { x: -12000, y: 9800 }, { x: -12000, y: 10600 }, radius,
  );
  assert.equal(watershedCrossing.status, 'provisional-clear');
  assert.equal(watershedCrossing.watershedContact, true);
  assert.equal(watershedCrossing.minSampledWatershedDistancePixels, 0);
  assert.ok(watershedCrossing.maxSampledCrestRise > 0);
  assert.equal(watershedCrossing.topographicPassability, 'unverified');
  assert.throws(() => fixture.checkStraightSegment(SPAWN,
    { x: SPAWN.x + 1601, y: SPAWN.y }, radius), /length/);
  assert.throws(() => fixture.checkStraightSegment(SPAWN,
    { x: SPAWN.x + 100, y: SPAWN.y }, .01), /sample count/);
});
