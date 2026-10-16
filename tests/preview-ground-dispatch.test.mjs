import test from 'node:test';
import assert from 'node:assert/strict';
import { createOzarkPreviewPixelAdapter, createOzarkPreviewPixelProfile } from
  '../scripts/ozark-preview-pixels.mjs';
import { LEGACY_GEOMETRY, OZARK_PREVIEW_GEOMETRY, OZARK_PREVIEW_PROFILE } from
  '../src/geometry-profile.js';
import { createOzarkPreviewGroundSource, previewGroundColor } from
  '../src/preview-ground-dispatch.js';

const adapter = createOzarkPreviewPixelAdapter(OZARK_PREVIEW_PROFILE);
const ground = createOzarkPreviewGroundSource(OZARK_PREVIEW_GEOMETRY, adapter);
const at = (x, y) => {
  const pixel = adapter.relativeToPixel(x, y);
  return ground.sample(pixel.x, pixel.y);
};

test('only the approved nonplayable selection and exact pixel profile open the fixture', () => {
  assert.deepEqual(ground.pixelBounds,
    { minX: -19000, maxX: 19000, minY: -14200, maxY: 14200 });
  assert.equal(ground.profile.identity, OZARK_PREVIEW_PROFILE.identity);
  assert.equal(ground.profile.seed, 74193);
  assert.equal(ground.profile.scope, 'offline-fresh-world-only');
  assert.throws(() => createOzarkPreviewGroundSource());
  assert.throws(() => createOzarkPreviewGroundSource(LEGACY_GEOMETRY, adapter));
  assert.throws(() => createOzarkPreviewGroundSource(
    { ...OZARK_PREVIEW_GEOMETRY }, adapter));
  assert.throws(() => createOzarkPreviewGroundSource(
    { ...OZARK_PREVIEW_GEOMETRY, playable: true }, adapter));
  assert.throws(() => createOzarkPreviewGroundSource(
    { ...OZARK_PREVIEW_GEOMETRY, identity: 'sha256:forged' }, adapter));
  assert.throws(() => createOzarkPreviewGroundSource(
    { ...OZARK_PREVIEW_GEOMETRY, extra: true }, adapter));
  assert.throws(() => createOzarkPreviewGroundSource(OZARK_PREVIEW_GEOMETRY, null));

  const otherSeed = createOzarkPreviewPixelAdapter(createOzarkPreviewPixelProfile({
    seed: 92741, centerX: 0, centerY: 0, cellPixels: 400,
  }));
  assert.throws(() => createOzarkPreviewGroundSource(OZARK_PREVIEW_GEOMETRY, otherSeed));
  assert.throws(() => createOzarkPreviewGroundSource(OZARK_PREVIEW_GEOMETRY,
    Object.freeze({ ...adapter, profile: { ...adapter.profile, identity: 'sha256:forged' } })));
  assert.throws(() => createOzarkPreviewGroundSource(OZARK_PREVIEW_GEOMETRY,
    Object.freeze({ ...adapter, profile: { ...adapter.profile } })));
  assert.throws(() => createOzarkPreviewGroundSource(OZARK_PREVIEW_GEOMETRY,
    Object.freeze({ ...adapter, pixelBounds: { ...adapter.pixelBounds, maxX: 19001 } })));
  assert.throws(() => createOzarkPreviewGroundSource(OZARK_PREVIEW_GEOMETRY,
    { ...adapter }));
  assert.throws(() => createOzarkPreviewGroundSource(OZARK_PREVIEW_GEOMETRY,
    Object.freeze({ ...adapter, sampleAtPixel: null })));
});

test('pixel queries cover only approved sample centers and reject malformed numbers', () => {
  for (const [x, y] of [[-19000, -14200], [19000, 14200], [0, 0]]) {
    assert.equal(typeof ground.sample(x, y).paint, 'string');
  }
  for (const [x, y] of [[-19000.01, 0], [19000.01, 0], [0, -14200.01],
    [0, 14200.01], [NaN, 0], [0, Infinity], [undefined, 0]]) {
    assert.throws(() => ground.sample(x, y), RangeError);
  }
});

test('approved fixed seed paints water, internal pond, divide and varied forest sites', () => {
  const river = at(48, 32);
  assert.equal(river.paint, 'surface-water');
  assert.equal(river.habitat, 'river-channel');
  assert.equal(river.drainage, 'surface');
  assert.ok(river.surfaceWaterDistance < 0);
  assert.equal(at(18, 65).paint, 'internal-pond');
  const divide = at(17.5, 61);
  assert.equal(divide.paint, 'divide');
  assert.equal(divide.drainage, 'divide');
  assert.equal(divide.terminalCell, null);
  assert.equal(divide.watershedDistance, 0);
  assert.ok(divide.crestRise > 0);
  const dryRim = at(17, 61);
  assert.equal(dryRim.paint, 'divide');
  assert.equal(dryRim.drainage, 'surface');
  assert.equal(dryRim.watershedDistance, 0.5);
  assert.equal(dryRim.crestRise, 0);
  assert.equal(at(0, 0).paint, 'oak-pine-woodland');
  assert.equal(at(17, 61).habitat, 'shaded-cove');
  assert.equal(at(48, 35).paint, 'wet-terrace');
  assert.equal(at(80, 20).paint, 'open-clearing');
});

test('sample results and nearest-channel records are fresh copies', () => {
  const point = adapter.relativeToPixel(48, 32);
  const a = ground.sample(point.x, point.y);
  const b = ground.sample(point.x, point.y);
  assert.notStrictEqual(a, b);
  assert.notStrictEqual(a.nearestChannel, b.nearestChannel);
  assert.deepEqual(a, b);
  assert.equal(a.watershedDistance, adapter.sampleAtPixel(point.x, point.y).watershedDistance);
  assert.equal(a.crestRise, adapter.sampleAtPixel(point.x, point.y).crestRise);
  a.paint = 'open-clearing';
  a.nearestChannel.id = 'forged';
  assert.equal(ground.sample(point.x, point.y).paint, 'surface-water');
  assert.equal(ground.sample(point.x, point.y).nearestChannel.id, 'main');
});

test('overlapping paint signals follow water, pond, divide, habitat precedence', () => {
  const base = adapter.sampleAtPixel(0, 0);
  const makeSource = (patch) => createOzarkPreviewGroundSource(OZARK_PREVIEW_GEOMETRY,
    Object.freeze({ ...adapter, sampleAtPixel: () => ({ ...base, ...patch }) }));
  assert.equal(makeSource({ surfaceWaterDistance: -0.1,
    sinkholePondDistance: -0.1, drainage: 'divide', terminalCell: null,
    watershedDistance: 0 })
    .sample(0, 0).paint, 'surface-water');
  assert.equal(makeSource({ surfaceWaterDistance: 0.1,
    sinkholePondDistance: -0.1, drainage: 'divide', terminalCell: null,
    watershedDistance: 0 })
    .sample(0, 0).paint, 'internal-pond');
  assert.equal(makeSource({ surfaceWaterDistance: 0.1,
    sinkholePondDistance: 0.1, drainage: 'divide', terminalCell: null,
    watershedDistance: 0 })
    .sample(0, 0).paint, 'divide');
  assert.equal(makeSource({ surfaceWaterDistance: 0.1,
    sinkholePondDistance: 0.1, watershedDistance: 0.25 })
    .sample(0, 0).paint, 'divide');
  assert.equal(makeSource({ surfaceWaterDistance: 0.1,
    sinkholePondDistance: 0.1 })
    .sample(0, 0).paint, base.habitat);
});

test('palette returns fresh RGB triplets from the approved design', () => {
  const expected = {
    'dry-rocky-glade': '#b1ad78', 'open-clearing': '#c7bb89',
    'oak-pine-woodland': '#799466', 'shaded-cove': '#426c61',
    'wet-terrace': '#73a47c', 'river-channel': '#9ab9a4',
    'spring-seep': '#79a99d', 'sinkhole-basin': '#8b9a83',
    'surface-water': '#347e9b', 'internal-pond': '#607d76', divide: '#e6c79d',
  };
  for (const [paint, hex] of Object.entries(expected)) {
    const color = previewGroundColor(paint);
    assert.equal(`#${color.map(value => value.toString(16).padStart(2, '0')).join('')}`, hex);
    color[0] = 0;
    assert.notEqual(previewGroundColor(paint)[0], 0);
  }
  assert.throws(() => previewGroundColor('water'));
  assert.throws(() => previewGroundColor(null));
});

test('malformed injected samples fail before painting', () => {
  const fake = Object.freeze({ ...adapter, sampleAtPixel: () => ({
    ...adapter.sampleAtPixel(0, 0), habitat: 'unsupported-habitat',
  }) });
  const source = createOzarkPreviewGroundSource(OZARK_PREVIEW_GEOMETRY, fake);
  assert.throws(() => source.sample(0, 0), TypeError);
  for (const patch of [
    { watershedDistance: -1 }, { watershedDistance: NaN },
    { crestRise: -1 }, { crestRise: Infinity },
    { drainage: 'divide', terminalCell: null, watershedDistance: 0.1 },
    { watershedDistance: null, crestRise: 1 },
  ]) {
    const malformed = createOzarkPreviewGroundSource(OZARK_PREVIEW_GEOMETRY,
      Object.freeze({ ...adapter, sampleAtPixel: () =>
        ({ ...adapter.sampleAtPixel(0, 0), ...patch }) }));
    assert.throws(() => malformed.sample(0, 0), TypeError);
  }
});
