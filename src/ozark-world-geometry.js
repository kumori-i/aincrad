// Versioned physical geometry for the single playable Ozark world.
// The descriptor remains private to physical rules. Perception exposes only
// local qualitative observations, never the drainage graph or a safe route.
import { CONFIG, SPAWN, STARTER_NPC_SPAWN, SECOND_NPC_SPAWN } from './config.js';
import { OZARK_PREVIEW_PROFILE } from './geometry-profile.js';
import { generateOzarkPreview } from './ozark-preview-model.js';
import { createOzarkPreviewSampler } from './ozark-preview-geometry.js';
import { createOzarkStructures } from './ozark-structures.js';

const PROFILE_PAYLOAD = Object.freeze({
  kind: 'ozark-world-v1',
  scope: 'playable-fresh-and-restored',
  samplerContract: 'ozark-continuous-sampler-v2',
  policyContract: 'ozark-whole-map-traversal-v1',
  seed: 74193,
  descriptorSha256: OZARK_PREVIEW_PROFILE.descriptorSha256,
  centerX: 0, centerY: 0, cellPixels: 400,
  minX: -19000, maxX: 19000, minY: -14200, maxY: 14200,
  playerSpawnX: -680, playerSpawnY: 380,
  asterSpawnX: 276, asterSpawnY: 760,
  miraSpawnX: 300, miraSpawnY: 920,
  walkGrade: 0.06, climbGrade: 0.16, fallRiskGrade: 0.12,
  eyeHeight: 3, sightRange: 400,
  depthSpan: 100, wadeMaxDepthProxy: 0.5, swimMaxDepthProxy: 8,
  wadeWalkMultiplier: 0.65, swimSpeedMultiplier: 0.38,
  climbSpeedMultiplier: 0.55, currentMaxSpeed: 28,
  motionStep: 1 / 120,
});

// Digest of JSON.stringify(PROFILE_PAYLOAD). The focused identity test checks
// this at build time; the browser needs no cryptographic or network service.
export const OZARK_WORLD_PROFILE = Object.freeze({
  ...PROFILE_PAYLOAD,
  identity: 'sha256:8f029100a4af44c415d9d5079d002e1bc34ca45d6a58803494385bc030b8ddc3',
});

const PROFILE = OZARK_WORLD_PROFILE;
const BOUNDS = Object.freeze({
  minX: PROFILE.minX, maxX: PROFILE.maxX,
  minY: PROFILE.minY, maxY: PROFILE.maxY,
});
const SPAWNS = Object.freeze({
  aster: Object.freeze({ x: PROFILE.asterSpawnX, y: PROFILE.asterSpawnY }),
  mira: Object.freeze({ x: PROFILE.miraSpawnX, y: PROFILE.miraSpawnY }),
});
const PLAYER_SPAWN = Object.freeze({ x: PROFILE.playerSpawnX, y: PROFILE.playerSpawnY });
const DIRECTIONS = Object.freeze([
  ['north', 0, -1], ['northeast', Math.SQRT1_2, -Math.SQRT1_2],
  ['east', 1, 0], ['southeast', Math.SQRT1_2, Math.SQRT1_2],
  ['south', 0, 1], ['southwest', -Math.SQRT1_2, Math.SQRT1_2],
  ['west', -1, 0], ['northwest', -Math.SQRT1_2, -Math.SQRT1_2],
]);
const MODES = Object.freeze(['walk', 'climb', 'swim']);

const finitePoint = point => point !== null && typeof point === 'object' &&
  Number.isFinite(point.x) && Number.isFinite(point.y);

function inside(x, y, margin = 0) {
  return Number.isFinite(x) && Number.isFinite(y) &&
    x - margin >= BOUNDS.minX && x + margin <= BOUNDS.maxX &&
    y - margin >= BOUNDS.minY && y + margin <= BOUNDS.maxY;
}

function actorRadius(radius) {
  if (!Number.isFinite(radius) || radius <= 0 || radius > 100) {
    throw new RangeError('Expected an actor radius in (0, 100] logical pixels');
  }
  return radius;
}

function movementMode(mode) {
  if (!MODES.includes(mode)) throw new TypeError('Unknown Ozark movement mode');
  return mode;
}

function segmentDistanceSquared(x, y, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const fraction = Math.max(0, Math.min(1,
    ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return (x - ax - fraction * dx) ** 2 + (y - ay - fraction * dy) ** 2;
}

let canonical;

/** Construct once per process; the returned geometry and policy are immutable. */
export function createOzarkWorldGeometry({ structures = true } = {}) {
  if (structures !== true) throw new TypeError('Aincrad has one structural Ozark world');
  if (canonical) return canonical;
  let structuralLayer = null;
  if (CONFIG.playerRadius !== 10 || CONFIG.walkSpeed !== 150 ||
      SPAWN.x !== PLAYER_SPAWN.x || SPAWN.y !== PLAYER_SPAWN.y ||
      STARTER_NPC_SPAWN.x !== SPAWNS.aster.x || STARTER_NPC_SPAWN.y !== SPAWNS.aster.y ||
      SECOND_NPC_SPAWN.x !== SPAWNS.mira.x || SECOND_NPC_SPAWN.y !== SPAWNS.mira.y) {
    throw new Error('Ozark physical policy requires its pinned actor dimensions and spawns');
  }
  const descriptor = generateOzarkPreview(PROFILE.seed);
  if (descriptor.previewVersion !== 1 || descriptor.width !== 96 ||
      descriptor.height !== 72 || descriptor.seed !== PROFILE.seed) {
    throw new Error('Ozark descriptor no longer matches the playable policy');
  }
  const sampler = createOzarkPreviewSampler(descriptor);
  const cellPoint = index => descriptor.cells[index];
  const paths = [
    { kind: 'main', id: 'main', cells: descriptor.mainChannel },
    ...descriptor.tributaries.map(branch => ({
      kind: 'tributary', id: branch.id, cells: branch.cells,
    })),
    { kind: 'spring-outflow', id: 'spring-outflow', cells: descriptor.spring.branchCells },
    { kind: 'spring-pool', id: 'spring-pool', cells: descriptor.spring.branchCells.slice(0, 2) },
  ];
  const channelSegments = paths.map(path => Object.freeze({
    kind: path.kind, id: path.id,
    segments: Object.freeze(path.cells.slice(1).map((index, position) => {
      const from = cellPoint(path.cells[position]), to = cellPoint(index);
      const length = Math.hypot(to.x - from.x, to.y - from.y);
      return Object.freeze({
        ax: from.x, ay: from.y, bx: to.x, by: to.y,
        direction: Object.freeze({ x: (to.x - from.x) / length,
          y: (to.y - from.y) / length }),
      });
    })),
  }));

  function raw(x, y) {
    if (!inside(x, y)) throw new RangeError('Outside approved Ozark sample-center bounds');
    return sampler.sample((x - BOUNDS.minX) / PROFILE.cellPixels,
      (y - BOUNDS.minY) / PROFILE.cellPixels);
  }

  function downstreamDirection(x, y, nearest) {
    const path = channelSegments.find(row =>
      row.kind === nearest.kind && row.id === nearest.id);
    if (!path) throw new Error('Ozark sampler returned an unknown channel');
    const rx = (x - BOUNDS.minX) / PROFILE.cellPixels;
    const ry = (y - BOUNDS.minY) / PROFILE.cellPixels;
    let best = Infinity, direction = null;
    for (const segment of path.segments) {
      const distance = segmentDistanceSquared(rx, ry,
        segment.ax, segment.ay, segment.bx, segment.by);
      if (distance < best) {
        best = distance;
        direction = segment.direction;
      }
    }
    return direction;
  }

  function paintFor(site) {
    if (site.surfaceWaterDistance <= 0) return 'surface-water';
    if (site.sinkholePondDistance !== null && site.sinkholePondDistance <= 0)
      return 'internal-pond';
    if (site.watershedDistance !== null && site.watershedDistance <= .5)
      return 'divide';
    return site.habitat;
  }

  function depthProxy(distance, radius) {
    return Math.max(0, (radius - distance * PROFILE.cellPixels) / PROFILE.depthSpan);
  }

  function waterContact(site, radius) {
    if (site.surfaceWaterDistance * PROFILE.cellPixels <= radius) {
      return { kind: 'surface', depthProxy: depthProxy(site.surfaceWaterDistance, radius) };
    }
    if (site.sinkholePondDistance !== null &&
        site.sinkholePondDistance * PROFILE.cellPixels <= radius) {
      return { kind: 'pond', depthProxy: depthProxy(site.sinkholePondDistance, radius) };
    }
    return null;
  }

  function sampleTerrain(x, y) {
    const site = raw(x, y);
    const paint = paintFor(site);
    const waterBand = paint === 'surface-water' || paint === 'internal-pond' ?
      depthProxy(paint === 'surface-water' ? site.surfaceWaterDistance :
        site.sinkholePondDistance, CONFIG.playerRadius) <= PROFILE.wadeMaxDepthProxy ?
        'shallow-water' : 'deep-water' : null;
    const currentDirection = paint === 'surface-water' ?
      downstreamDirection(x, y, site.nearestChannel) : null;
    return Object.freeze({ ...site,
      nearestChannel: Object.freeze({ ...site.nearestChannel }),
      paint, waterBand,
      currentCue: currentDirection ? 'downstream' : null,
      currentDirection,
    });
  }

  function sample(x, y) {
    const site = sampleTerrain(x, y);
    if (!structuralLayer) return site;
    const canopy = structuralLayer.canopyAt(x, y);
    // Recover open-sky aspect potential from the authored descriptor, then
    // apply only real crown coverage. This is stable sky access, not sunshine.
    const skyLight = Math.max(0, Math.min(1, site.light + .75 * site.canopy));
    return Object.freeze({ ...site, canopy, light: Math.max(0, skyLight - .75 * canopy) });
  }

  function lightAt(point, hour) {
    if (!finitePoint(point) || !inside(point.x, point.y)) throw new RangeError('Light requires an in-bounds point');
    const canopy = structuralLayer.canopyAt(point.x, point.y);
    const shade = structuralLayer.shadowAt(point.x, point.y, hour);
    return Object.freeze({ canopy, shade });
  }

  function localGrade(x, y, radius, site) {
    const probe = Math.min(radius, 20);
    // The actor's valid footprint includes every probe. Never query beyond the
    // sample-center rectangle while classifying a position at its edge.
    let steepest = 0;
    for (const [dx, dy] of [[probe, 0], [-probe, 0], [0, probe], [0, -probe]]) {
      steepest = Math.max(steepest,
        Math.abs(raw(x + dx, y + dy).elevation - site.elevation) / probe);
    }
    return steepest;
  }

  /** Physical footprint and grade. A mode is an attempted motion, not a skill. */
  function classifyTerrain(x, y, radius = CONFIG.playerRadius, mode = 'walk') {
    const r = actorRadius(radius);
    movementMode(mode);
    if (!inside(x, y, r)) return Object.freeze({
      walkable: false, reason: 'outside-approved-bounds', mode,
    });
    const site = raw(x, y);
    const water = waterContact(site, r);
    const grade = localGrade(x, y, r, site);
    if (water) {
      const currentDirection = water.kind === 'surface' ?
        downstreamDirection(x, y, site.nearestChannel) : null;
      const currentCue = currentDirection ? 'downstream' : null;
      if (water.depthProxy > PROFILE.swimMaxDepthProxy) return Object.freeze({
        walkable: false, reason: 'over-deep-water', mode,
        waterKind: water.kind, depthProxy: water.depthProxy, grade,
      });
      if (water.depthProxy > PROFILE.wadeMaxDepthProxy) {
        return Object.freeze({
          walkable: mode === 'swim',
          reason: mode === 'swim' ? 'swimming' :
            water.kind === 'pond' ? 'internal-pond' : 'deep-water',
          mode, waterKind: water.kind, depthProxy: water.depthProxy, grade,
          currentCue, currentDirection,
        });
      }
      if (grade > (mode === 'climb' ? PROFILE.climbGrade : PROFILE.walkGrade) &&
          mode !== 'swim') return Object.freeze({
        walkable: false, reason: 'excessive-grade', mode,
        waterKind: water.kind, depthProxy: water.depthProxy, grade,
      });
      return Object.freeze({
        walkable: true, reason: 'shallow-water', mode,
        waterKind: water.kind, depthProxy: water.depthProxy, grade,
        currentCue, currentDirection,
      });
    }
    const limit = mode === 'climb' ? PROFILE.climbGrade : PROFILE.walkGrade;
    if (grade > limit) return Object.freeze({
      walkable: false, reason: 'excessive-grade', mode, grade,
    });
    return Object.freeze({ walkable: true,
      reason: grade > PROFILE.walkGrade ? 'steep-ground' : 'dry-ground',
      mode, grade,
    });
  }

  function classify(x, y, radius = CONFIG.playerRadius, mode = 'walk') {
    const terrain = classifyTerrain(x, y, radius, mode);
    if (!terrain.walkable || !structuralLayer) return terrain;
    const obstacle = structuralLayer.obstruction(x, y, radius);
    return obstacle ? Object.freeze({ ...terrain, walkable: false,
      reason: obstacle.kind === 'rock' ? 'solid-rock' : 'tree-trunk' }) : terrain;
  }

  // Save validation must retain an actor who was actually climbing or
  // swimming. A valid occupied footprint is not necessarily walkable on foot.
  function canOccupy(x, y, radius = CONFIG.playerRadius) {
    return MODES.some(mode => classify(x, y, radius, mode).walkable);
  }

  function clearSweep(from, to, radius, mode) {
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const halfStep = length / 2;
    const midpoint = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    const sites = [from, midpoint, to].map(point =>
      classify(point.x, point.y, radius + halfStep, mode));
    const blocked = sites.find(site => !site.walkable);
    if (blocked) return blocked;
    if (length === 0) return sites[0];
    // A local height check catches narrow crest rises between otherwise
    // passable endpoints. Submerged travel is not a terrain climb.
    const points = [from, midpoint, to];
    const heights = points.map(point => raw(point.x, point.y).elevation);
    const limit = mode === 'climb' ? PROFILE.climbGrade : PROFILE.walkGrade;
    for (let index = 1; index < points.length; index += 1) {
      if (mode === 'swim' &&
          (sites[index].reason === 'swimming' ||
           sites[index - 1].reason === 'swimming')) continue;
      const grade = Math.abs(heights[index] - heights[index - 1]) / halfStep;
      if (grade > limit) return { walkable: false, reason: 'excessive-grade', grade };
    }
    return sites[2];
  }

  function sweptAxes(actor, vx, vy, mode) {
    const start = { x: actor.x, y: actor.y };
    const steps = Math.max(1,
      Math.ceil(Math.hypot(vx, vy) / (CONFIG.playerRadius * .5)));
    let blocked = null;
    for (let index = 0; index < steps; index += 1) {
      const nextX = { x: actor.x + vx / steps, y: actor.y };
      const xSite = clearSweep(actor, nextX, CONFIG.playerRadius, mode);
      if (xSite.walkable) actor.x = nextX.x;
      else blocked = xSite;
      const nextY = { x: actor.x, y: actor.y + vy / steps };
      const ySite = clearSweep(actor, nextY, CONFIG.playerRadius, mode);
      if (ySite.walkable) actor.y = nextY.y;
      else blocked = ySite;
    }
    return { distance: Math.hypot(actor.x - start.x, actor.y - start.y), blocked };
  }

  function isWater(footing) {
    return footing.reason === 'shallow-water' || footing.reason === 'swimming';
  }

  /** Fixed internal slices keep outcomes stable across caller time partitions. */
  function advance(actor, dx, dy, dt, sprint = false, mode = 'walk') {
    movementMode(mode);
    const zero = Object.freeze({ distance: 0, driftDistance: 0,
      waterSeconds: 0, swimSeconds: 0, climbSeconds: 0,
      blockedClimbSeconds: 0, fallRiskSeconds: 0, effortSeconds: 0,
      depthProxy: null, footing: null, currentCue: null, mode });
    if (!finitePoint(actor) || !Number.isFinite(dx) || !Number.isFinite(dy) ||
        !Number.isFinite(dt) || dt <= 0) return zero;
    // A body already in deep water still drifts while idle or unconscious.
    // This grants no intentional swimming to a default walking request.
    const passiveSwim = mode === 'walk' && dx === 0 && dy === 0 &&
      !classify(actor.x, actor.y).walkable &&
      classify(actor.x, actor.y, CONFIG.playerRadius, 'swim').reason === 'swimming';
    const physicalMode = passiveSwim ? 'swim' : mode;
    if (!classify(actor.x, actor.y, CONFIG.playerRadius, physicalMode).walkable)
      return zero;
    const duration = Math.min(dt, .25);
    const slices = Math.max(1, Math.ceil(duration / PROFILE.motionStep));
    const seconds = duration / slices;
    const inputLength = Math.hypot(dx, dy);
    const inputX = inputLength > 0 ? dx / inputLength : 0;
    const inputY = inputLength > 0 ? dy / inputLength : 0;
    const start = { x: actor.x, y: actor.y };
    let driftDistance = 0, waterSeconds = 0, swimSeconds = 0;
    let climbSeconds = 0, blockedClimbSeconds = 0, fallRiskSeconds = 0;
    let effortSeconds = 0;
    for (let index = 0; index < slices; index += 1) {
      const before = classify(actor.x, actor.y, CONFIG.playerRadius, physicalMode);
      let blocked = null;
      if (inputLength > 0) {
        const swimming = before.reason === 'swimming';
        const climbing = physicalMode === 'climb' && before.grade > PROFILE.walkGrade;
        const speedFactor = swimming ? PROFILE.swimSpeedMultiplier :
          climbing ? PROFILE.climbSpeedMultiplier :
            before.reason === 'shallow-water' ? PROFILE.wadeWalkMultiplier : 1;
        const speed = CONFIG.walkSpeed * (sprint && !swimming && !climbing ?
          CONFIG.sprintMultiplier : 1) * speedFactor;
        blocked = sweptAxes(actor, inputX * speed * seconds,
          inputY * speed * seconds, physicalMode).blocked;
        effortSeconds += seconds * (swimming ? 2.6 :
          climbing ? 2 : before.reason === 'shallow-water' ? 1.6 : 1);
      }
      const afterInput = classify(actor.x, actor.y, CONFIG.playerRadius, physicalMode);
      if (afterInput.currentDirection && isWater(afterInput)) {
        const currentSpeed = PROFILE.currentMaxSpeed * Math.min(1,
          afterInput.depthProxy / PROFILE.wadeMaxDepthProxy);
        const drift = sweptAxes(actor,
          afterInput.currentDirection.x * currentSpeed * seconds,
          afterInput.currentDirection.y * currentSpeed * seconds, physicalMode);
        driftDistance += drift.distance;
      }
      const after = classify(actor.x, actor.y, CONFIG.playerRadius, physicalMode);
      if (isWater(before) || isWater(afterInput) || isWater(after)) waterSeconds += seconds;
      if ([before, afterInput, after].some(footing => footing.reason === 'swimming'))
        swimSeconds += seconds;
      if (physicalMode === 'climb' && inputLength > 0 &&
          [before, afterInput, after].some(footing => footing.grade > PROFILE.walkGrade))
        climbSeconds += seconds;
      if (physicalMode === 'climb' && blocked?.reason === 'excessive-grade') {
        blockedClimbSeconds += seconds;
        if (blocked.grade >= PROFILE.fallRiskGrade) fallRiskSeconds += seconds;
      }
    }
    const footing = classify(actor.x, actor.y, CONFIG.playerRadius, physicalMode);
    return Object.freeze({
      distance: Math.hypot(actor.x - start.x, actor.y - start.y),
      driftDistance, waterSeconds, swimSeconds, climbSeconds,
      blockedClimbSeconds, fallRiskSeconds, effortSeconds,
      depthProxy: footing.depthProxy ?? 0,
      footing: footing.reason, currentCue: footing.currentCue ?? null, mode,
    });
  }

  function move(actor, dx, dy, dt, sprint = false, mode = 'walk') {
    return advance(actor, dx, dy, dt, sprint, mode).distance;
  }

  function lineOfSight(from, to) {
    if (!finitePoint(from) || !finitePoint(to) ||
        !inside(from.x, from.y) || !inside(to.x, to.y)) return false;
    const start = raw(from.x, from.y), end = raw(to.x, to.y);
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(1, Math.ceil(length / 20));
    for (let index = 1; index < steps; index += 1) {
      const fraction = index / steps;
      const x = from.x + (to.x - from.x) * fraction;
      const y = from.y + (to.y - from.y) * fraction;
      const sightLine = (start.elevation + PROFILE.eyeHeight) * (1 - fraction) +
        (end.elevation + PROFILE.eyeHeight) * fraction;
      if (raw(x, y).elevation > sightLine) return false;
    }
    return !structuralLayer || !structuralLayer.blocksSight(from, to);
  }

  function groundName(point, site) {
    const water = waterContact(site, CONFIG.playerRadius);
    if (water) return water.depthProxy <= PROFILE.wadeMaxDepthProxy ?
      'shallow-water' : water.kind === 'pond' ? 'deep-pond' : 'deep-water';
    const grade = localGrade(point.x, point.y, CONFIG.playerRadius, site);
    return grade > PROFILE.walkGrade ? 'steep-ground' : 'dry-land';
  }

  function observe(point) {
    if (!finitePoint(point) || !canOccupy(point.x, point.y)) {
      throw new RangeError('Ozark observation requires a physically reachable position');
    }
    const site = raw(point.x, point.y);
    const nearby = [];
    for (const range of [200, PROFILE.sightRange]) {
      for (const [direction, dx, dy] of DIRECTIONS) {
        const at = { x: point.x + dx * range, y: point.y + dy * range };
        if (!inside(at.x, at.y) || !lineOfSight(point, at)) continue;
        const seen = raw(at.x, at.y);
        nearby.push(Object.freeze({
          direction, ground: groundName(at, seen), habitat: seen.habitat,
        }));
      }
    }
    const water = waterContact(site, CONFIG.playerRadius);
    return Object.freeze({
      habitat: site.habitat, ground: groundName(point, site),
      currentCue: water?.kind === 'surface' ? 'downstream' : null,
      nearby: Object.freeze(nearby),
    });
  }

  // The structural policy is selected only for an explicitly versioned fresh
  // world. Generation reads terrain-only classification to avoid recursion.
  if (structures) structuralLayer = createOzarkStructures(Object.freeze({
    profile: PROFILE, bounds: BOUNDS, spawn: PLAYER_SPAWN,
    agentSpawns: SPAWNS, sample: sampleTerrain, classify: classifyTerrain,
  }));

  for (const [name, point] of [['player', PLAYER_SPAWN],
    ...Object.entries(SPAWNS)]) {
    const standing = classify(point.x, point.y);
    if (!standing.walkable || standing.reason !== 'dry-ground') {
      throw new Error(`Ozark ${name} spawn is no longer dry and passable`);
    }
  }
  const result = Object.freeze({
    profile: PROFILE, bounds: BOUNDS, spawn: PLAYER_SPAWN,
    agentSpawns: SPAWNS, sample, cartographicSample: sampleTerrain, classify, canOccupy, advance, move,
    lineOfSight, observe,
    ...(structures ? { structureVersion: 1,
      structureContract: structuralLayer.profileContract, structures: structuralLayer, lightAt } : {}),
  });
  canonical = result;
  return result;
}
