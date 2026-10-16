// Offline, opt-in coordinates for a fresh-world design preview. This module is
// not imported by the game and supplies no terrain, collision, or save rules.
import { createHash } from 'node:crypto';
import { generateOzarkPreview } from './ozark-preview-model.mjs';
import { createOzarkPreviewSampler } from './ozark-preview-geometry.mjs';

const KIND = 'ozark-preview-pixels-v1';
const SCOPE = 'offline-fresh-world-only';
const SAMPLER_CONTRACT = 'ozark-continuous-sampler-v2';
const HALF_SIZE = 24000; // Current logical-pixel envelope; not a playable boundary.
const PROFILE_KEYS = [
  'kind', 'scope', 'samplerContract', 'seed', 'centerX', 'centerY',
  'cellPixels', 'descriptorSha256', 'identity',
];
const TRANSFORM_KEYS = ['seed', 'centerX', 'centerY', 'cellPixels'];

function hasExactOwnKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function digest(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function checkedFrame(seed, centerX, centerY, cellPixels, width, height) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff ||
      !Number.isSafeInteger(centerX) || !Number.isSafeInteger(centerY) ||
      !Number.isSafeInteger(cellPixels) || cellPixels <= 0) {
    throw new TypeError('Expected an unsigned preview seed and integer pixel transform');
  }
  const halfWidth = (width - 1) * cellPixels / 2;
  const halfHeight = (height - 1) * cellPixels / 2;
  const bounds = {
    minX: centerX - halfWidth, maxX: centerX + halfWidth,
    minY: centerY - halfHeight, maxY: centerY + halfHeight,
  };
  if (!Object.values(bounds).every(Number.isFinite) ||
      bounds.minX < -HALF_SIZE || bounds.maxX > HALF_SIZE ||
      bounds.minY < -HALF_SIZE || bounds.maxY > HALF_SIZE ||
      bounds.minX >= bounds.maxX || bounds.minY >= bounds.maxY) {
    throw new RangeError('Preview sample centers must fit in the logical-pixel envelope');
  }
  return Object.freeze(bounds);
}

// Only sampler-relevant data goes into the geometry digest. The descriptor is
// generated here, so callers cannot substitute an old or hand-edited layout.
function geometryRecord(descriptor) {
  return [
    descriptor.previewVersion, descriptor.seed, descriptor.width, descriptor.height,
    descriptor.cells.map(cell => [
      cell.x, cell.y, cell.height, cell.moisture, cell.canopy, cell.light,
      cell.habitat, cell.substrate, cell.drainage, cell.flowTo,
    ]),
    [descriptor.outlet.cell, descriptor.outlet.name],
    descriptor.mainChannel,
    descriptor.tributaries.map(branch => [branch.id, branch.cells]),
    [descriptor.spring.poolCell, descriptor.spring.branchCells],
    descriptor.sinkhole === null ? null :
      [descriptor.sinkhole.cell, descriptor.sinkhole.radius, descriptor.sinkhole.kind],
  ];
}

function build(seed, centerX, centerY, cellPixels) {
  // Generate a private descriptor and let the sampler validate its graph and
  // feature paths before naming this geometry.
  const descriptor = generateOzarkPreview(seed);
  const sampler = createOzarkPreviewSampler(descriptor);
  const bounds = checkedFrame(seed, centerX, centerY, cellPixels,
    descriptor.width, descriptor.height);
  const descriptorSha256 = digest(geometryRecord(descriptor));
  const identity = digest([
    KIND, SCOPE, SAMPLER_CONTRACT, descriptorSha256,
    centerX, centerY, cellPixels,
  ]);
  const profile = Object.freeze({
    kind: KIND, scope: SCOPE, samplerContract: SAMPLER_CONTRACT,
    seed, centerX, centerY, cellPixels, descriptorSha256, identity,
  });
  return { profile, sampler, bounds, width: descriptor.width, height: descriptor.height };
}

/** Name one provisional pixel transform and the exact generated design behind it. */
export function createOzarkPreviewPixelProfile(settings) {
  if (!hasExactOwnKeys(settings, TRANSFORM_KEYS)) {
    throw new TypeError('Expected an explicit offline preview seed and pixel transform');
  }
  return build(settings.seed, settings.centerX, settings.centerY, settings.cellPixels).profile;
}

/** Require an explicit, current profile before any pixel query is possible. */
export function createOzarkPreviewPixelAdapter(profile) {
  if (!hasExactOwnKeys(profile, PROFILE_KEYS) ||
      profile.kind !== KIND || profile.scope !== SCOPE ||
      profile.samplerContract !== SAMPLER_CONTRACT) {
    throw new TypeError('Expected an explicit offline Ozark pixel profile');
  }
  const built = build(profile.seed, profile.centerX, profile.centerY, profile.cellPixels);
  if (PROFILE_KEYS.some(key => profile[key] !== built.profile[key])) {
    throw new TypeError('Preview pixel profile identity does not match generated geometry');
  }
  const { bounds, width, height, sampler } = built;
  const relativeToPixel = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y) ||
        x < 0 || x > width - 1 || y < 0 || y > height - 1) {
      throw new RangeError('Outside preview sample-center coordinates');
    }
    return { x: bounds.minX + x * built.profile.cellPixels,
      y: bounds.minY + y * built.profile.cellPixels };
  };
  const pixelToRelative = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y) ||
        x < bounds.minX || x > bounds.maxX ||
        y < bounds.minY || y > bounds.maxY) {
      throw new RangeError('Outside preview pixel sample-center bounds');
    }
    return { x: (x - bounds.minX) / built.profile.cellPixels,
      y: (y - bounds.minY) / built.profile.cellPixels };
  };
  return Object.freeze({
    profile: built.profile,
    pixelBounds: bounds,
    relativeToPixel,
    pixelToRelative,
    sampleAtPixel(x, y) {
      const relative = pixelToRelative(x, y);
      return sampler.sample(relative.x, relative.y);
    },
  });
}
