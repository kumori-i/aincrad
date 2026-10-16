// Read-only ground colors for an isolated design fixture. This does not select
// playable terrain, collision, perception, objects, or saved-world geometry.
import { OZARK_PREVIEW_GEOMETRY, OZARK_PREVIEW_PROFILE } from './geometry-profile.js';

// The approved descriptor has 96 × 72 sample centers. Its provisional 400 px
// transform puts only their center-to-center rectangle inside this source.
const APPROVED_BOUNDS = Object.freeze({
  minX: -19000, maxX: 19000, minY: -14200, maxY: 14200,
});
const HABITAT_COLORS = Object.freeze({
  'dry-rocky-glade': '#b1ad78',
  'open-clearing': '#c7bb89',
  'oak-pine-woodland': '#799466',
  'shaded-cove': '#426c61',
  'wet-terrace': '#73a47c',
  'river-channel': '#9ab9a4',
  'spring-seep': '#79a99d',
  'sinkhole-basin': '#8b9a83',
});
const PAINT_COLORS = Object.freeze({
  ...HABITAT_COLORS,
  'surface-water': '#347e9b',
  'internal-pond': '#607d76',
  divide: '#e6c79d',
});
const RGB = Object.freeze(Object.fromEntries(Object.entries(PAINT_COLORS).map(
  ([paint, hex]) => [paint, Object.freeze([
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ])],
)));
const SITE_KEYS = [
  'elevation', 'moisture', 'canopy', 'light', 'habitat', 'substrate',
  'drainage', 'terminalCell', 'surfaceWaterDistance', 'nearestChannel',
  'sinkholePondDistance', 'watershedDistance', 'crestRise',
];

function exactDataRecord(value, expected) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Reflect.ownKeys(value);
  const expectedKeys = Object.keys(expected);
  return keys.length === expectedKeys.length && expectedKeys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.hasOwn(descriptor, 'value') &&
      Object.is(descriptor.value, expected[key]);
  });
}

function exactKeys(value, keys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      Reflect.ownKeys(value).length !== keys.length) return false;
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.hasOwn(descriptor, 'value');
  });
}

function checkedSite(site) {
  if (!exactKeys(site, SITE_KEYS) ||
      !Object.hasOwn(HABITAT_COLORS, site.habitat) ||
      typeof site.substrate !== 'string' || !site.substrate ||
      !['surface', 'internal', 'divide'].includes(site.drainage) ||
      !Number.isFinite(site.elevation) ||
      !['moisture', 'canopy', 'light'].every((key) =>
        Number.isFinite(site[key]) && site[key] >= 0 && site[key] <= 1) ||
      !Number.isFinite(site.surfaceWaterDistance) ||
      !Number.isFinite(site.sinkholePondDistance) ||
      !(site.watershedDistance === null ||
        (Number.isFinite(site.watershedDistance) && site.watershedDistance >= 0)) ||
      !Number.isFinite(site.crestRise) || site.crestRise < 0 ||
      (site.watershedDistance === null &&
        (site.crestRise !== 0 || site.drainage === 'divide')) ||
      (site.drainage === 'divide' && site.watershedDistance !== 0) ||
      (site.drainage === 'divide' ? site.terminalCell !== null :
        !Number.isInteger(site.terminalCell) || site.terminalCell < 0 ||
        site.terminalCell >= 96 * 72) ||
      !exactKeys(site.nearestChannel, ['kind', 'id']) ||
      !['main', 'tributary', 'spring-outflow', 'spring-pool'].includes(
        site.nearestChannel.kind) ||
      typeof site.nearestChannel.id !== 'string' || !site.nearestChannel.id) {
    throw new TypeError('Malformed approved preview ground sample');
  }
  return site;
}

/** Exact RGB triplet from the approved preview palette, returned as a copy. */
export function previewGroundColor(paint) {
  if (!Object.hasOwn(RGB, paint)) throw new TypeError('Unknown preview ground paint');
  return [...RGB[paint]];
}

/**
 * Bind an offline pixel adapter to the one approved preview identity. The
 * caller supplies the adapter; this browser-safe module checks its immutable
 * profile, bounds, interface and sample shape, but cannot independently prove
 * arbitrary injected function code. It does not authorize production use.
 */
export function createOzarkPreviewGroundSource(selection, adapter) {
  if (selection !== OZARK_PREVIEW_GEOMETRY) {
    throw new TypeError('Expected exact Ozark preview geometry selection');
  }
  if (adapter === null || typeof adapter !== 'object' ||
      !Object.isFrozen(adapter) ||
      !exactKeys(adapter, ['profile', 'pixelBounds', 'relativeToPixel',
        'pixelToRelative', 'sampleAtPixel']) ||
      !Object.isFrozen(adapter.profile) ||
      !Object.isFrozen(adapter.pixelBounds) ||
      !exactDataRecord(adapter.profile, OZARK_PREVIEW_PROFILE) ||
      !exactDataRecord(adapter.pixelBounds, APPROVED_BOUNDS) ||
      typeof adapter.relativeToPixel !== 'function' ||
      typeof adapter.pixelToRelative !== 'function' ||
      typeof adapter.sampleAtPixel !== 'function') {
    throw new TypeError('Expected validated approved Ozark pixel adapter');
  }
  // Snapshot the immutable adapter's method and bounds. A caller cannot widen
  // the fixture by replacing its profile or rectangle after this check.
  const sampleAtPixel = adapter.sampleAtPixel.bind(adapter);
  return Object.freeze({
    profile: OZARK_PREVIEW_PROFILE,
    pixelBounds: APPROVED_BOUNDS,
    sample(x, y) {
      if (!Number.isFinite(x) || !Number.isFinite(y) ||
          x < APPROVED_BOUNDS.minX || x > APPROVED_BOUNDS.maxX ||
          y < APPROVED_BOUNDS.minY || y > APPROVED_BOUNDS.maxY) {
        throw new RangeError('Outside approved preview sample-center rectangle');
      }
      const site = checkedSite(sampleAtPixel(x, y));
      const paint = site.surfaceWaterDistance <= 0 ? 'surface-water' :
        site.sinkholePondDistance <= 0 ? 'internal-pond' :
          site.watershedDistance !== null && site.watershedDistance <= 0.5 ?
            'divide' : site.habitat;
      return {
        paint, elevation: site.elevation, moisture: site.moisture,
        canopy: site.canopy, light: site.light, habitat: site.habitat,
        substrate: site.substrate, drainage: site.drainage,
        terminalCell: site.terminalCell,
        surfaceWaterDistance: site.surfaceWaterDistance,
        nearestChannel: { kind: site.nearestChannel.kind, id: site.nearestChannel.id },
        sinkholePondDistance: site.sinkholePondDistance,
        watershedDistance: site.watershedDistance,
        crestRise: site.crestRise,
      };
    },
  });
}
