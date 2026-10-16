// A fresh, unsaved walking and shallow-wading experiment over the approved
// Ozark landform. The sampler is constructed here, never supplied by a caller.
// Depth is a short signed-distance proxy and current is an authored path cue;
// neither is surveyed bathymetry or a hydrodynamics model.
import { CONFIG, SPAWN } from './config.js';
import { OZARK_WALKING_PILOT_PROFILE } from './geometry-profile.js';
import { generateOzarkPreview } from './ozark-preview-model.js';
import { createOzarkPreviewSampler } from './ozark-preview-geometry.js';

const PROFILE = OZARK_WALKING_PILOT_PROFILE;
const SAMPLE_BOUNDS = Object.freeze({
  minX: -19000, maxX: 19000, minY: -14200, maxY: 14200,
});
const PILOT_BOUNDS = Object.freeze({
  minX: PROFILE.minX, maxX: PROFILE.maxX,
  minY: PROFILE.minY, maxY: PROFILE.maxY,
});
const PILOT_SPAWN = Object.freeze({ x: -680, y: 380 });
const WADE_BOUNDS = Object.freeze({
  minX: PROFILE.wadeMinX, maxX: PROFILE.wadeMaxX,
  minY: PROFILE.wadeMinY, maxY: PROFILE.wadeMaxY,
});
const MOTION_STEP = 1 / 120;
const DIRECTIONS = Object.freeze([
  ['north', 0, -1], ['northeast', Math.SQRT1_2, -Math.SQRT1_2],
  ['east', 1, 0], ['southeast', Math.SQRT1_2, Math.SQRT1_2],
  ['south', 0, 1], ['southwest', -Math.SQRT1_2, Math.SQRT1_2],
  ['west', -1, 0], ['northwest', -Math.SQRT1_2, -Math.SQRT1_2],
]);

function exactProfile(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Reflect.ownKeys(value);
  const expected = Object.keys(PROFILE);
  return keys.length === expected.length && expected.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.hasOwn(descriptor, 'value') &&
      Object.is(descriptor.value, PROFILE[key]);
  });
}

const finitePoint = point => point !== null && typeof point === 'object' &&
  Number.isFinite(point.x) && Number.isFinite(point.y);

function inside(point, bounds, margin = 0) {
  return finitePoint(point) &&
    point.x - margin >= bounds.minX && point.x + margin <= bounds.maxX &&
    point.y - margin >= bounds.minY && point.y + margin <= bounds.maxY;
}

function checkedRadius(radius) {
  if (!Number.isFinite(radius) || radius <= 0 || radius > 400) {
    throw new RangeError('Expected a positive pilot actor radius of at most 400 pixels');
  }
  return radius;
}

/**
 * The new identity covers the approved descriptor, coordinate transform,
 * corridor, and pilot-only relative grade/sight policy. It authorizes no save.
 */
export function createOzarkWalkingPilot(profile) {
  if (!exactProfile(profile)) {
    throw new TypeError('Unrecognized unsaved Ozark walking pilot identity');
  }
  if (SPAWN.x !== PILOT_SPAWN.x || SPAWN.y !== PILOT_SPAWN.y ||
      CONFIG.playerRadius !== 10 || CONFIG.walkSpeed !== 150) {
    throw new Error('Walking pilot requires its reviewed spawn, radius, and speed');
  }
  const descriptor = generateOzarkPreview(PROFILE.seed);
  if (descriptor.previewVersion !== 1 || descriptor.width !== 96 ||
      descriptor.height !== 72 || descriptor.seed !== PROFILE.seed) {
    throw new Error('Walking pilot descriptor dimensions changed');
  }
  const sampler = createOzarkPreviewSampler(descriptor);
  // The selected reach lies beside these two consecutive main-channel cells.
  // Bind the cue to the validated downhill path rather than inventing an
  // arbitrary screen direction. A changed path fails closed until reviewed.
  const from = descriptor.cells[descriptor.mainChannel[PROFILE.currentFromMainIndex]];
  const to = descriptor.cells[descriptor.mainChannel[PROFILE.currentToMainIndex]];
  if (PROFILE.currentToMainIndex !== PROFILE.currentFromMainIndex + 1 ||
      from?.x !== 44 || from.y !== 36 || to?.x !== 45 || to.y !== 35 ||
      from.flowTo !== descriptor.mainChannel[PROFILE.currentToMainIndex]) {
    throw new Error('Wading current no longer follows the reviewed main-channel reach');
  }
  const flowLength = Math.hypot(to.x - from.x, to.y - from.y);
  const currentDirection = Object.freeze({
    x: (to.x - from.x) / flowLength,
    y: (to.y - from.y) / flowLength,
  });

  function raw(x, y) {
    if (!inside({ x, y }, SAMPLE_BOUNDS)) {
      throw new RangeError('Outside the approved Ozark sample-center rectangle');
    }
    return sampler.sample((x - SAMPLE_BOUNDS.minX) / PROFILE.cellPixels,
      (y - SAMPLE_BOUNDS.minY) / PROFILE.cellPixels);
  }

  function paintFor(site) {
    if (site.surfaceWaterDistance <= 0) return 'surface-water';
    if (site.sinkholePondDistance !== null && site.sinkholePondDistance <= 0)
      return 'internal-pond';
    if (site.watershedDistance !== null && site.watershedDistance <= 0.5)
      return 'divide';
    return site.habitat;
  }

  function footprintDepth(site, radius) {
    return Math.max(0,
      (radius - site.surfaceWaterDistance * PROFILE.cellPixels) / PROFILE.wadeDepthSpan);
  }

  function selectedReach(x, y, radius, site) {
    return inside({ x, y }, WADE_BOUNDS, radius) &&
      site.nearestChannel.kind === 'main';
  }

  function sample(x, y) {
    const site = raw(x, y);
    const paintedWater = site.surfaceWaterDistance <= 0;
    const inReach = paintedWater &&
      selectedReach(x, y, CONFIG.playerRadius, site);
    const waterBand = paintedWater ? !inReach ? 'unassessed-water' :
      footprintDepth(site, CONFIG.playerRadius) <= PROFILE.wadeMaxDepthProxy ?
        'shallow-water' : 'deep-water' : null;
    return Object.freeze({
      ...site, nearestChannel: Object.freeze({ ...site.nearestChannel }),
      paint: paintFor(site),
      waterBand,
      currentCue: waterBand === 'shallow-water' ? 'downstream' : null,
      currentDirection: waterBand === 'shallow-water' ? currentDirection : null,
    });
  }

  // A central, four-direction difference measures the steepest local rise in
  // relative height units per logical pixel. The threshold is chosen for this
  // corridor: the approved spawn-to-east route is about 0.021, while the dry
  // northwest patch near (-1450,-850) is about 0.039. It is a pilot traversal
  // policy, not a surveyed physical grade or a universal climbing ability.
  function localGrade(x, y, radius, site) {
    const probe = Math.max(5, Math.min(radius, 20));
    let steepest = 0;
    for (const [dx, dy] of [[probe, 0], [-probe, 0], [0, probe], [0, -probe]]) {
      steepest = Math.max(steepest,
        Math.abs(raw(x + dx, y + dy).elevation - site.elevation) / probe);
    }
    return steepest;
  }

  function classify(x, y, radius = CONFIG.playerRadius) {
    const r = checkedRadius(radius);
    if (!inside({ x, y }, SAMPLE_BOUNDS, r)) {
      return Object.freeze({ walkable: false, reason: 'outside-approved-bounds' });
    }
    const site = raw(x, y);
    // Hazard inspection precedes the smaller walking bound. The sole wade
    // exception is a radius-aware, shallow part of the reviewed main reach.
    const waterContact = site.surfaceWaterDistance * PROFILE.cellPixels <= r;
    if (waterContact && (!selectedReach(x, y, r, site) ||
        footprintDepth(site, r) > PROFILE.wadeMaxDepthProxy)) {
      return Object.freeze({ walkable: false, reason: 'surface-water' });
    }
    if (site.sinkholePondDistance !== null &&
        site.sinkholePondDistance * PROFILE.cellPixels <= r)
      return Object.freeze({ walkable: false, reason: 'internal-pond' });
    if (!inside({ x, y }, PILOT_BOUNDS, r))
      return Object.freeze({ walkable: false, reason: 'outside-pilot-bounds' });
    const grade = localGrade(x, y, r, site);
    if (grade > PROFILE.maxGrade)
      return Object.freeze({ walkable: false, reason: 'excessive-grade', grade });
    if (waterContact) {
      return Object.freeze({ walkable: true, reason: 'shallow-water', grade,
        depthProxy: footprintDepth(site, r), currentCue: 'downstream' });
    }
    return Object.freeze({ walkable: true, reason: 'dry-ground', grade });
  }

  function clearSweep(from, to, radius) {
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const halfStep = length / 2;
    const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    // Signed water distances are 1-Lipschitz. Extra half-step clearance at
    // both ends and the midpoint covers unsampled water between probes.
    for (const point of [from, mid, to]) {
      if (!classify(point.x, point.y, radius + halfStep).walkable) return false;
    }
    const heights = [from, mid, to].map(point => raw(point.x, point.y).elevation);
    const half = length / 2;
    return half === 0 ||
      (Math.abs(heights[1] - heights[0]) / half <= PROFILE.maxGrade &&
       Math.abs(heights[2] - heights[1]) / half <= PROFILE.maxGrade);
  }

  function sweptAxes(actor, vx, vy) {
    const start = { x: actor.x, y: actor.y };
    const distance = Math.hypot(vx, vy);
    const steps = Math.max(1, Math.ceil(distance / (CONFIG.playerRadius * .5)));
    for (let index = 0; index < steps; index += 1) {
      const nextX = { x: actor.x + vx / steps, y: actor.y };
      if (clearSweep(actor, nextX, CONFIG.playerRadius)) actor.x = nextX.x;
      const nextY = { x: actor.x, y: actor.y + vy / steps };
      if (clearSweep(actor, nextY, CONFIG.playerRadius)) actor.y = nextY.y;
    }
    return Math.hypot(actor.x - start.x, actor.y - start.y);
  }

  // Fixed internal time slices keep the speed/current integration close when
  // callers partition the same elapsed time differently. The authored current
  // is only a small push along the selected downhill channel segment. Both
  // intentional motion and drift go through the same swept collision checks.
  function advance(actor, dx, dy, dt, sprint = false) {
    const zero = Object.freeze({ distance: 0, driftDistance: 0, waterSeconds: 0,
      depthProxy: null, footing: null, currentCue: null });
    if (!finitePoint(actor) || !Number.isFinite(dx) || !Number.isFinite(dy) ||
        !Number.isFinite(dt) || dt <= 0 ||
        !classify(actor.x, actor.y, CONFIG.playerRadius).walkable) return zero;
    const duration = Math.min(dt, .25);
    const slices = Math.max(1, Math.ceil(duration / MOTION_STEP));
    const seconds = duration / slices;
    const inputLength = Math.hypot(dx, dy);
    const inputX = inputLength > 0 ? dx / inputLength : 0;
    const inputY = inputLength > 0 ? dy / inputLength : 0;
    const start = { x: actor.x, y: actor.y };
    let driftDistance = 0;
    let waterSeconds = 0;
    for (let index = 0; index < slices; index += 1) {
      const before = classify(actor.x, actor.y, CONFIG.playerRadius);
      if (inputLength > 0) {
        const speed = CONFIG.walkSpeed * (sprint ? CONFIG.sprintMultiplier : 1) *
          (before.reason === 'shallow-water' ? PROFILE.wadeWalkMultiplier : 1);
        sweptAxes(actor, inputX * speed * seconds, inputY * speed * seconds);
      }
      const afterInput = classify(actor.x, actor.y, CONFIG.playerRadius);
      if (afterInput.reason === 'shallow-water') {
        const currentSpeed = PROFILE.wadeCurrentMaxSpeed *
          afterInput.depthProxy / PROFILE.wadeMaxDepthProxy;
        driftDistance += sweptAxes(actor,
          currentDirection.x * currentSpeed * seconds,
          currentDirection.y * currentSpeed * seconds);
      }
      const after = classify(actor.x, actor.y, CONFIG.playerRadius);
      if (before.reason === 'shallow-water' ||
          afterInput.reason === 'shallow-water' ||
          after.reason === 'shallow-water') waterSeconds += seconds;
    }
    const footing = classify(actor.x, actor.y, CONFIG.playerRadius);
    return Object.freeze({
      distance: Math.hypot(actor.x - start.x, actor.y - start.y),
      driftDistance, waterSeconds,
      depthProxy: footing.depthProxy ?? 0,
      footing: footing.reason,
      currentCue: footing.currentCue ?? null,
    });
  }

  function move(actor, dx, dy, dt, sprint = false) {
    return advance(actor, dx, dy, dt, sprint).distance;
  }

  function lineOfSight(from, to) {
    if (!inside(from, PILOT_BOUNDS) || !inside(to, PILOT_BOUNDS)) return false;
    const start = raw(from.x, from.y), end = raw(to.x, to.y);
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(1, Math.ceil(length / 12));
    for (let index = 1; index < steps; index += 1) {
      const fraction = index / steps;
      const point = { x: from.x + (to.x - from.x) * fraction,
        y: from.y + (to.y - from.y) * fraction };
      if (!inside(point, PILOT_BOUNDS)) return false;
      const sightLine = (start.elevation + PROFILE.eyeHeight) * (1 - fraction) +
        (end.elevation + PROFILE.eyeHeight) * fraction;
      if (raw(point.x, point.y).elevation > sightLine) return false;
    }
    return true;
  }

  function groundName(point, site) {
    if (site.sinkholePondDistance !== null && site.sinkholePondDistance <= 0)
      return 'internal-pond';
    const standing = classify(point.x, point.y, CONFIG.playerRadius);
    if (standing.reason === 'shallow-water') return 'shallow-water';
    if (site.surfaceWaterDistance <= 0) return 'surface-water';
    if (standing.reason === 'surface-water') return 'water-edge';
    if (standing.reason === 'internal-pond') return 'pond-edge';
    return standing.reason === 'excessive-grade' ? 'steep-ground' : 'dry-land';
  }

  function observe(point) {
    if (!inside(point, PILOT_BOUNDS) ||
        !classify(point.x, point.y, CONFIG.playerRadius).walkable) {
      throw new RangeError('Pilot observation requires a reachable position');
    }
    const site = raw(point.x, point.y), nearby = [];
    for (const range of [200, PROFILE.sightRange]) {
      for (const [direction, dx, dy] of DIRECTIONS) {
        const at = { x: point.x + dx * range, y: point.y + dy * range };
        if (!inside(at, PILOT_BOUNDS) || !lineOfSight(point, at)) continue;
        const seen = raw(at.x, at.y);
        nearby.push(Object.freeze({
          direction, ground: groundName(at, seen), habitat: seen.habitat,
        }));
      }
    }
    return Object.freeze({
      habitat: site.habitat, ground: groundName(point, site),
      currentCue: classify(point.x, point.y, CONFIG.playerRadius).currentCue ?? null,
      nearby: Object.freeze(nearby),
    });
  }

  // Fail closed if the fixed starting point or promised local eastward route
  // no longer clears the same policy that will govern actual movement.
  if (!classify(PILOT_SPAWN.x, PILOT_SPAWN.y).walkable) {
    throw new Error('Walking pilot spawn is no longer dry and passable');
  }
  for (let x = PILOT_SPAWN.x; x < 0; x += 5) {
    if (!clearSweep({ x, y: PILOT_SPAWN.y },
      { x: Math.min(x + 5, 0), y: PILOT_SPAWN.y }, CONFIG.playerRadius)) {
      throw new Error('Walking pilot corridor is no longer continuous');
    }
  }
  return Object.freeze({
    profile: PROFILE, spawn: PILOT_SPAWN, bounds: PILOT_BOUNDS,
    sample, classify, move, advance, lineOfSight, observe,
  });
}
