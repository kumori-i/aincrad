import test from 'node:test';
import assert from 'node:assert/strict';
import { generateOzarkPreview } from '../scripts/ozark-preview-model.mjs';
import { createOzarkPreviewSampler } from '../scripts/ozark-preview-geometry.mjs';
import {
  createOzarkPreviewPixelProfile,
  createOzarkPreviewPixelAdapter,
} from '../scripts/ozark-preview-pixels.mjs';

const settings = { seed: 74193, centerX: 0, centerY: 0, cellPixels: 400 };
const profile = createOzarkPreviewPixelProfile(settings);
const descriptor = generateOzarkPreview(settings.seed);

function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} differs from ${expected}`);
}

test('explicit offline profile binds the generated geometry and transform', () => {
  assert.equal(profile.kind, 'ozark-preview-pixels-v1');
  assert.equal(profile.scope, 'offline-fresh-world-only');
  assert.equal(profile.samplerContract, 'ozark-continuous-sampler-v2');
  assert.match(profile.descriptorSha256, /^sha256:[a-f0-9]{64}$/);
  assert.match(profile.identity, /^sha256:[a-f0-9]{64}$/);
  assert.equal(profile.descriptorSha256,
    'sha256:87301ee9f224b4afa734ffb55e25a76bdb85fdc09597c618ada0cbab1d348706');
  assert.equal(profile.identity,
    'sha256:2939db9ac490343dddbe8881988fedba094c2d85fd33c6b34dbd06547d772cd7');
  assert.deepEqual(createOzarkPreviewPixelProfile({ ...settings }), profile);
  assert.equal(createOzarkPreviewPixelAdapter(structuredClone(profile)).profile.identity,
    profile.identity);
  assert.notEqual(createOzarkPreviewPixelProfile({ ...settings, seed: 92741 }).identity,
    profile.identity);
  assert.notEqual(createOzarkPreviewPixelProfile({ ...settings, cellPixels: 401 }).identity,
    profile.identity);
  assert.notEqual(createOzarkPreviewPixelProfile({ ...settings, centerX: 1 }).identity,
    profile.identity);
});

test('sample-center corners, fractional coordinates and inverse mapping agree with sampler', () => {
  const adapter = createOzarkPreviewPixelAdapter(profile);
  assert.deepEqual(adapter.pixelBounds,
    { minX: -19000, maxX: 19000, minY: -14200, maxY: 14200 });
  assert.deepEqual(adapter.relativeToPixel(0, 0), { x: -19000, y: -14200 });
  assert.deepEqual(adapter.relativeToPixel(95, 71), { x: 19000, y: 14200 });
  assert.deepEqual(adapter.pixelToRelative(-19000, -14200), { x: 0, y: 0 });
  assert.deepEqual(adapter.pixelToRelative(19000, 14200), { x: 95, y: 71 });
  const sampler = createOzarkPreviewSampler(descriptor);
  for (const [x, y] of [[0, 0], [95, 71], [24.25, 33.75], [47.5, 35.5]]) {
    const pixel = adapter.relativeToPixel(x, y);
    const relative = adapter.pixelToRelative(pixel.x, pixel.y);
    near(relative.x, x);
    near(relative.y, y);
    assert.deepEqual(adapter.sampleAtPixel(pixel.x, pixel.y), sampler.sample(x, y));
  }
  assert.equal(adapter.sampleAtPixel(0, 0).drainage,
    sampler.sample(47.5, 35.5).drainage);
});

test('strict bounds reject outside and nonfinite queries without clamping', () => {
  const adapter = createOzarkPreviewPixelAdapter(profile);
  for (const [x, y] of [[-19000.001, 0], [19000.001, 0], [0, -14200.001],
    [0, 14200.001], [NaN, 0], [0, Infinity], [undefined, 0]]) {
    assert.throws(() => adapter.pixelToRelative(x, y));
    assert.throws(() => adapter.sampleAtPixel(x, y));
  }
  for (const [x, y] of [[-0.001, 0], [95.001, 0], [0, -0.001], [0, 71.001],
    [Infinity, 0], [0, NaN]]) {
    assert.throws(() => adapter.relativeToPixel(x, y));
  }
});

test('malformed transforms, seeds and profiles fail closed', () => {
  for (const patch of [
    { seed: -1 }, { seed: 2 ** 32 }, { seed: 1.2 }, { seed: undefined },
    { centerX: NaN }, { centerY: Infinity }, { centerX: 6000 },
    { cellPixels: 0 }, { cellPixels: -1 }, { cellPixels: 1.5 },
    { cellPixels: 1000 }, { cellPixels: Infinity },
  ]) {
    assert.throws(() => createOzarkPreviewPixelProfile({ ...settings, ...patch }));
  }
  assert.throws(() => createOzarkPreviewPixelProfile());
  assert.throws(() => createOzarkPreviewPixelProfile({ ...settings, save: {} }));
  assert.throws(() => createOzarkPreviewPixelAdapter());
  assert.throws(() => createOzarkPreviewPixelAdapter({ ...profile, kind: 'legacy-world' }));
  assert.throws(() => createOzarkPreviewPixelAdapter({ ...profile, scope: 'saved-world' }));
  assert.throws(() => createOzarkPreviewPixelAdapter({ ...profile,
    samplerContract: 'ozark-continuous-sampler-v1',
    identity: 'sha256:11a1c7d6d89f9aa86c499b7b97818513a218402d18ca01cfb5fecddb7a96dfcd',
  }));
  assert.throws(() => createOzarkPreviewPixelAdapter({ ...profile, identity: 'sha256:forged' }));
  assert.throws(() => createOzarkPreviewPixelAdapter({ ...profile, centerX: 1 }));
  assert.throws(() => createOzarkPreviewPixelAdapter({ ...profile, descriptorSha256: 'sha256:forged' }));
  assert.throws(() => createOzarkPreviewPixelAdapter({ ...profile, save: {} }));
  const inherited = Object.assign(Object.create({ identity: profile.identity }), profile);
  delete inherited.identity;
  assert.throws(() => createOzarkPreviewPixelAdapter(inherited));
});

test('adapter retains immutable profile values after caller mutation', () => {
  const supplied = structuredClone(profile);
  const adapter = createOzarkPreviewPixelAdapter(supplied);
  const before = adapter.sampleAtPixel(0, 0);
  supplied.centerX = 1000;
  supplied.cellPixels = 1;
  supplied.identity = 'forged';
  assert.deepEqual(adapter.pixelBounds,
    { minX: -19000, maxX: 19000, minY: -14200, maxY: 14200 });
  assert.deepEqual(adapter.relativeToPixel(47.5, 35.5), { x: 0, y: 0 });
  assert.deepEqual(adapter.sampleAtPixel(0, 0), before);
  assert.equal(adapter.profile.identity, profile.identity);
});

test('another seed has its own profile and preserves separate internal pond semantics', () => {
  const noSinkhole = createOzarkPreviewPixelAdapter(createOzarkPreviewPixelProfile({
    ...settings, seed: 5,
  }));
  const site = noSinkhole.sampleAtPixel(0, 0);
  assert.equal(site.sinkholePondDistance, null);
  assert.notEqual(noSinkhole.profile.identity, profile.identity);
  assert.notEqual(noSinkhole.profile.descriptorSha256, profile.descriptorSha256);
});
