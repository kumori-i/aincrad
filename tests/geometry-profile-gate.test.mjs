import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { freshState } from '../src/world.js';
import { loadSave, saveProtectionReason, validateSave, writeSave } from '../src/save.js';
import { inspectProfileBoot } from '../src/recovered-profile-boot.js';
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

test('ordinary fresh and saved worlds keep legacy geometry with no new marker', async () => {
  const blank = storage();
  const status = {
    kind: 'original', phase: 'none', available: false,
    recoveredCopySupported: false, sourceSha256: null, createdAt: null,
  };
  const boot = await inspectProfileBoot({
    profileApi: { status: async () => status }, getStorage: () => blank,
    loadSave, prepareMigration: () => { throw new Error('unexpected migration'); },
    hashRaw: () => { throw new Error('unexpected hash'); }, saveKey: CONFIG.saveKey,
  });
  assert.equal(boot.gate, 'play');
  assert.equal(boot.loaded.exists, false);
  assert.equal(Object.hasOwn(boot.loaded.state, 'geometryProfile'), false);
  assert.equal(writeSave(blank, boot.loaded.state), true);
  const disk = JSON.parse(blank.getItem(CONFIG.saveKey));
  assert.equal(Object.hasOwn(disk, 'geometryProfile'), false);
  const reopened = loadSave(blank);
  assert.equal(reopened.blocked, false);
  assert.equal(reopened.exists, true);
  assert.equal(Object.hasOwn(reopened.state, 'geometryProfile'), false);
  assert.equal(selectFreshGeometryProfile(), LEGACY_GEOMETRY);
});

test('reserved geometry identity fields are protected with original bytes intact', () => {
  for (const extension of [
    { geometryProfile: OZARK_PREVIEW_PROFILE },
    { geometryProfile: { identity: 'forged' } },
    { geometryIdentity: 'future-profile' },
    { geometryIdentity: null },
    { geometryIdentity: 'legacy' },
  ]) {
    const marked = { ...freshState(), ...extension };
    const original = JSON.stringify(marked);
    const disk = storage(original);
    const opened = loadSave(disk);
    assert.equal(opened.blocked, true);
    assert.match(opened.error, /unsupported geometry identity/);
    assert.equal(disk.getItem(CONFIG.saveKey), original);
    assert.equal(writeSave(disk, marked), false);
    assert.equal(writeSave(disk, opened.state), false);
    assert.equal(disk.getItem(CONFIG.saveKey), original);
    assert.ok(saveProtectionReason(marked));
    assert.equal(validateSave(marked).saveBlocked, true);
  }
});

test('an unrelated unknown v8 envelope field retains legacy normalization behavior', () => {
  const state = freshState();
  const disk = storage(JSON.stringify({ ...state, futureDisplayNote: 'local note' }));
  const opened = loadSave(disk);
  assert.equal(opened.blocked, false);
  assert.equal(opened.exists, true);
  assert.equal(saveProtectionReason(opened.state), null);
  assert.equal(opened.state.scene, state.scene);
  assert.equal(Object.hasOwn(opened.state, 'futureDisplayNote'), false);
  assert.equal(writeSave(disk, opened.state), true);
  const saved = JSON.parse(disk.getItem(CONFIG.saveKey));
  assert.equal(Object.hasOwn(saved, 'futureDisplayNote'), false);
  assert.equal(Object.hasOwn(saved, 'geometryProfile'), false);
  assert.equal(Object.hasOwn(saved, 'geometryIdentity'), false);
});

test('a historical version 1 save still restores through legacy geometry', () => {
  const raw = JSON.stringify({ version: 1, elapsed: 73, futureDisplayNote: 'old metadata' });
  const disk = storage(raw);
  const opened = loadSave(disk);
  assert.equal(opened.blocked, false);
  assert.equal(opened.exists, true);
  assert.equal(opened.state.simulationMode, 'legacy');
  assert.equal(opened.state.elapsed, 73);
  assert.equal(Object.hasOwn(opened.state, 'futureDisplayNote'), false);
  assert.equal(disk.getItem(CONFIG.saveKey), raw);
  assert.equal(selectFreshGeometryProfile(), LEGACY_GEOMETRY);
});
