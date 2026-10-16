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

// A distinct, bounded wading experiment. This identity is session-only and
// deliberately remains unsupported by freshState and the version 8 save path.
// Its height units are relative: maxGrade is rise in those units per logical
// world pixel, calibrated only to the chosen pilot corridor. The water depth
// proxy is derived from the sampled signed channel distance, not surveyed
// bathymetry, and the current is an authored downstream cue, not hydrodynamics.
export const OZARK_WALKING_PILOT_PROFILE = Object.freeze({
  kind: 'ozark-wading-pilot-v2',
  scope: 'fresh-session-unsaved',
  samplerContract: 'ozark-continuous-sampler-v2',
  policyContract: 'bounded-shallow-wading-v1',
  seed: 74193,
  centerX: 0,
  centerY: 0,
  cellPixels: 400,
  descriptorSha256: OZARK_PREVIEW_PROFILE.descriptorSha256,
  minX: -1500,
  maxX: 600,
  minY: -900,
  maxY: 900,
  maxGrade: 0.03,
  eyeHeight: 3,
  sightRange: 400,
  wadeMinX: -1280,
  wadeMaxX: -1120,
  wadeMinY: 180,
  wadeMaxY: 390,
  wadeDepthSpan: 100,
  wadeMaxDepthProxy: 0.5,
  wadeWalkMultiplier: 0.65,
  wadeCurrentMaxSpeed: 18,
  currentFromMainIndex: 44,
  currentToMainIndex: 45,
  identity: 'sha256:c66f06db089776c00c363e8f76d43ca50560ab739760cb7a510ad3422b3c0cfe',
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
