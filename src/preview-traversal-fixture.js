// Bounded, offline diagnostics for the approved *drawn* Ozark footprints.
// These are not playable collision, physical water, depth, or navigation rules.
import { createOzarkPreviewGroundSource } from './preview-ground-dispatch.js';

const MAX_RADIUS_PIXELS = 400;
const MAX_SPAWN_CANDIDATES = 64;
const MAX_LOCAL_SEGMENT_PIXELS = 1600;
const MAX_ROUTE_SAMPLES = 4096;

function checkedPoint(point) {
  if (point === null || typeof point !== 'object' || Array.isArray(point) ||
      !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new TypeError('Expected finite preview pixel point');
  }
  return { x: point.x, y: point.y };
}

function checkedRadius(radiusPixels) {
  if (!Number.isFinite(radiusPixels) || radiusPixels <= 0 ||
      radiusPixels > MAX_RADIUS_PIXELS) {
    throw new RangeError('Expected positive bounded preview actor radius in pixels');
  }
  return radiusPixels;
}

/**
 * An explicit fresh-world fixture, requiring the exact approved selection and
 * pixel adapter through the existing ground source gate. A positive result
 * clears the drawn water footprints only. The watershed edge is hydrologic
 * geometry, not a collision wall; its crest has no calibrated playable slope
 * limit. Report contact and crest evidence without claiming passability.
 */
export function createOzarkPreviewTraversalFixture(selection, adapter) {
  const ground = createOzarkPreviewGroundSource(selection, adapter);
  const { pixelBounds, profile } = ground;
  const cellPixels = profile.cellPixels;

  function inspect(point, radiusPixels, routeMarginPixels = 0) {
    const { x, y } = checkedPoint(point);
    const radius = checkedRadius(radiusPixels);
    if (x - radius < pixelBounds.minX || x + radius > pixelBounds.maxX ||
        y - radius < pixelBounds.minY || y + radius > pixelBounds.maxY) {
      return Object.freeze({ status: 'blocked', reason: 'outside-preview-bounds' });
    }
    const site = ground.sample(x, y);
    // Both signed distances are Euclidean in relative cells. Converting by
    // the pinned pixel scale gives a conservative disc/segment clearance test.
    const surface = site.surfaceWaterDistance * cellPixels;
    const pond = site.sinkholePondDistance * cellPixels;
    if (surface <= radius) {
      return Object.freeze({ status: 'blocked', reason: 'surface-water-footprint' });
    }
    if (pond <= radius) {
      return Object.freeze({ status: 'blocked', reason: 'internal-pond-footprint' });
    }
    if (surface <= radius + routeMarginPixels) {
      return Object.freeze({ status: 'blocked', reason: 'surface-water-margin' });
    }
    if (pond <= radius + routeMarginPixels) {
      return Object.freeze({ status: 'blocked', reason: 'internal-pond-margin' });
    }
    const watershedDistancePixels = site.watershedDistance === null ? null :
      site.watershedDistance * cellPixels;
    return Object.freeze({
      status: 'provisional-dry', reason: 'drawn-footprint-clear',
      watershedContact: watershedDistancePixels !== null &&
        watershedDistancePixels <= radius + routeMarginPixels,
      watershedDistancePixels, crestRise: site.crestRise,
      topographicPassability: 'unverified',
    });
  }

  return Object.freeze({
    profile,
    classifyFootprint(point, radiusPixels) {
      return inspect(point, radiusPixels);
    },
    chooseDrySpawn(candidates, radiusPixels) {
      checkedRadius(radiusPixels);
      if (!Array.isArray(candidates) || candidates.length > MAX_SPAWN_CANDIDATES) {
        throw new RangeError('Expected a bounded explicit preview spawn candidate list');
      }
      for (let index = 0; index < candidates.length; index += 1) {
        const point = checkedPoint(candidates[index]);
        const result = inspect(point, radiusPixels);
        if (result.status === 'provisional-dry') {
          return Object.freeze({
            status: 'provisional-dry', reason: 'drawn-footprint-clear',
            point: Object.freeze(point), index,
            watershedContact: result.watershedContact,
            watershedDistancePixels: result.watershedDistancePixels,
            crestRise: result.crestRise,
            topographicPassability: 'unverified',
          });
        }
      }
      return Object.freeze({ status: 'blocked', reason: 'no-dry-candidate', point: null, index: -1 });
    },
    checkStraightSegment(from, to, radiusPixels) {
      const start = checkedPoint(from);
      const end = checkedPoint(to);
      const radius = checkedRadius(radiusPixels);
      const length = Math.hypot(end.x - start.x, end.y - start.y);
      if (!Number.isFinite(length) || length > MAX_LOCAL_SEGMENT_PIXELS) {
        throw new RangeError('Preview segment exceeds local fixture length');
      }
      const steps = length === 0 ? 0 : Math.ceil(length / (radius / 2));
      if (steps + 1 > MAX_ROUTE_SAMPLES) {
        throw new RangeError('Preview segment exceeds bounded sample count');
      }
      const sampleCount = steps + 1;
      const halfStep = steps === 0 ? 0 : length / steps / 2;
      let watershedContact = false;
      let maxSampledCrestRise = 0;
      let minSampledWatershedDistancePixels = null;
      for (let index = 0; index < sampleCount; index += 1) {
        const fraction = steps === 0 ? 0 : index / steps;
        const point = {
          x: start.x + (end.x - start.x) * fraction,
          y: start.y + (end.y - start.y) * fraction,
        };
        // Signed distance to each drawn water footprint is 1-Lipschitz. A
        // margin of half the actual step covers the gaps between probes.
        const result = inspect(point, radius, halfStep);
        if (result.status !== 'provisional-dry') {
          return Object.freeze({
            status: 'blocked', reason: result.reason,
            at: Object.freeze(point), sampleIndex: index, sampleCount,
          });
        }
        watershedContact ||= result.watershedContact;
        maxSampledCrestRise = Math.max(maxSampledCrestRise, result.crestRise);
        if (result.watershedDistancePixels !== null) {
          minSampledWatershedDistancePixels = minSampledWatershedDistancePixels === null ?
            result.watershedDistancePixels :
            Math.min(minSampledWatershedDistancePixels, result.watershedDistancePixels);
        }
      }
      return Object.freeze({
        status: 'provisional-clear', reason: 'drawn-footprint-clear',
        sampleCount, watershedContact, maxSampledCrestRise,
        minSampledWatershedDistancePixels, topographicPassability: 'unverified',
      });
    },
  });
}
