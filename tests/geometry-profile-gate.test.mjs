import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { freshState } from '../src/world.js';


import {
  LEGACY_GEOMETRY, OZARK_PREVIEW_GEOMETRY, OZARK_PREVIEW_PROFILE,
  selectFreshGeometryProfile,
} from '../src/geometry-profile.js';
import { createOzarkPreviewPixelProfile } from '../scripts/ozark-preview-pixels.mjs';

function storage(raw = null) {
  const values = new Map();
  if (raw !== null) values.set(CONFIG.saveKey, raw);
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test('production pin matches the approved offline geometry, but remains nonplayable', () => {
  const generated = createOzarkPreviewPixelProfile({
    seed: 74193, centerX: 0, centerY: 0, cellPixels: 400,
  });
  assert.deepEqual(OZARK_PREVIEW_PROFILE, generated);
  assert.equal(selectFreshGeometryProfile(), LEGACY_GEOMETRY);
  assert.equal(selectFreshGeometryProfile(structuredClone(generated)), OZARK_PREVIEW_GEOMETRY);
  assert.equal(OZARK_PREVIEW_GEOMETRY.playable, false);
  assert.throws(() => freshState({ geometryProfile: generated }), /not playable/);
});

test('unknown or malformed geometry requests fail before a world is constructed', () => {
  for (const candidate of [
    null, false, 'ozark', {},
    { ...OZARK_PREVIEW_PROFILE, identity: 'sha256:forged' },
    { ...OZARK_PREVIEW_PROFILE,
      samplerContract: 'ozark-continuous-sampler-v1',
      identity: 'sha256:11a1c7d6d89f9aa86c499b7b97818513a218402d18ca01cfb5fecddb7a96dfcd',
    },
    { ...OZARK_PREVIEW_PROFILE, seed: 5 },
    { ...OZARK_PREVIEW_PROFILE, scope: 'playable' },
    { ...OZARK_PREVIEW_PROFILE, geometryProfile: 'legacy' },
    undefined,
  ]) {
    assert.throws(() => freshState({ geometryProfile: candidate }));
    assert.throws(() => selectFreshGeometryProfile(candidate));
  }
});








