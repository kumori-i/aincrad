// Production identity gate only. Neither this module nor its preview branch
// supplies terrain or authorizes a running world.
export const LEGACY_GEOMETRY = Object.freeze({
  kind: 'aincrad-legacy', playable: true,
});

// Pinned to the approved offline design and provisional pixel adapter. A
// playable geometry will require a distinct contract and saved-world identity.
export const OZARK_PREVIEW_PROFILE = Object.freeze({
  kind: 'ozark-preview-pixels-v1',
  scope: 'offline-fresh-world-only',
  samplerContract: 'ozark-continuous-sampler-v2',
  seed: 74193,
  centerX: 0,
  centerY: 0,
  cellPixels: 400,
  descriptorSha256: 'sha256:87301ee9f224b4afa734ffb55e25a76bdb85fdc09597c618ada0cbab1d348706',
  identity: 'sha256:2939db9ac490343dddbe8881988fedba094c2d85fd33c6b34dbd06547d772cd7',
});

export const OZARK_PREVIEW_GEOMETRY = Object.freeze({
  kind: 'ozark-preview',
  identity: OZARK_PREVIEW_PROFILE.identity,
  playable: false,
});

/** Explicit fresh-world request; absence always selects the existing world. */
export function selectFreshGeometryProfile(request) {
  if (arguments.length === 0) return LEGACY_GEOMETRY;
  if (request === null || typeof request !== 'object' || Array.isArray(request) ||
      Reflect.ownKeys(request).length !== Reflect.ownKeys(OZARK_PREVIEW_PROFILE).length ||
      Object.entries(OZARK_PREVIEW_PROFILE).some(([key, value]) =>
        !Object.hasOwn(request, key) || request[key] !== value)) {
    throw new TypeError('Unrecognized fresh-world geometry profile');
  }
  return OZARK_PREVIEW_GEOMETRY;
}
