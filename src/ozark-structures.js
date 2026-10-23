// Immutable, non-food landscape geometry for the current Ozark world.
// Rendering, collision and sight use these same records. This versioned layer
// is independent of mutable ecology stocks and never migrates old saves.
export const OZARK_STRUCTURES_CONTRACT = 'ozark-biome-structures-v1';

const CELL = 100;
const CHUNK = 600;
const CELLS_PER_CHUNK = CHUNK / CELL;
// The bounded world intersects 64 * 48 = 3,072 chunks. Keep its lazily visited
// chunks resident so scattered ecology/save checks do not rebuild the same
// immutable landscape. The hard bound also covers larger test geometries.
const CACHE_LIMIT = 4096;
const MAX_RADIUS = 23 * 1.24;
const MAX_CROWN_RADIUS = 96 * 1.24;
const MAX_CROWN_HEIGHT = 138 * 1.24;
const CORRIDOR_HALF_WIDTH = 24;
// Keep a continuous riparian approach band spanning three normal navigation
// cells (80 units each), plus each solid footprint. A narrow visual shoreline
// margin allowed trees/rocks to sever locally observed grid approaches to water.
const BANK_CLEARANCE = 240;
const SPAWN_CLEARANCE = 130;
const EMPTY = Object.freeze([]);
const crownCache = new WeakMap();
// Tree and rock probabilities are deliberately separate from food ecology.
// No fallback vegetation is allowed for unknown habitats (including deserts).
const HABITATS = Object.freeze({
  'oak-pine-woodland': Object.freeze({ trees: .88, rocks: .045, pine: .52 }),
  'shaded-cove': Object.freeze({ trees: .97, rocks: .025, pine: .06 }),
  'wet-terrace': Object.freeze({ trees: .20, rocks: .055, pine: .08 }),
  'spring-seep': Object.freeze({ trees: .15, rocks: .15, pine: .06 }),
  'open-clearing': Object.freeze({ trees: .055, rocks: .09, pine: .30 }),
  'dry-rocky-glade': Object.freeze({ trees: 0, rocks: .39, pine: 0 }),
});

function hash(x, y, seed) {
  let value = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ seed;
  value = Math.imul(value ^ value >>> 13, 1274126177);
  return ((value ^ value >>> 16) >>> 0) / 4294967296;
}
const finitePoint = point => point && Number.isFinite(point.x) && Number.isFinite(point.y);
const corridorDistance = coordinate => Math.abs(coordinate - Math.round(coordinate / CHUNK) * CHUNK);

/** Ground-plane crown extent and crown elevation, in logical world units.
 * These derive from the same oak/pine scale as the structural sprites, without
 * changing the saved structural layout or adding fields to its records.
 */
export function landscapeCrown(object) {
  if (!object || !['oak', 'pine'].includes(object.kind)) return null;
  const cached = crownCache.get(object);
  if (cached) return cached;
  if (!Number.isFinite(object.scale) || object.scale <= 0) {
    throw new TypeError('Expected a positive physical tree scale');
  }
  const pine = object.kind === 'pine', scale = object.scale;
  const crown = Object.freeze({ radiusX: (pine ? 80 : 96) * scale,
    radiusY: (pine ? 56 : 68) * scale,
    height: (pine ? 138 : 130) * scale, cover: pine ? .76 : .88 });
  // Only immutable descriptors can retain derived dimensions. Public callers
  // with mutable preview records still receive dimensions from their new scale.
  if (Object.isFrozen(object)) crownCache.set(object, crown);
  return crown;
}

/** A shared local solar model, not an astronomical/date simulation.
 * dx/dy point along the cast ground shadow, opposite the sun. Morning shadows
 * fall west, evening shadows east, and noon shadows are short and northward.
 * Render and physical shade must use this same projection and strength.
 */
export function landscapeSun(hour) {
  if (!Number.isFinite(hour)) throw new TypeError('Expected a finite solar hour');
  const localHour = ((hour % 24) + 24) % 24;
  if (localHour <= 6 || localHour >= 18) return Object.freeze({
    daylight: false, dx: 0, dy: 0, lengthFactor: 0, strength: 0,
  });
  const angle = (localHour - 6) / 12 * Math.PI, elevation = Math.sin(angle);
  const x = -Math.cos(angle), y = -.28 - .35 * elevation;
  const length = Math.hypot(x, y);
  return Object.freeze({ daylight: true, dx: x / length, dy: y / length,
    lengthFactor: .16 + 1.84 * (1 - elevation), strength: .78 * Math.sqrt(elevation) });
}

function crownCoverage(x, y, centerX, centerY, crown) {
  const distanceSquared = ((x - centerX) / crown.radiusX) ** 2 +
    ((y - centerY) / crown.radiusY) ** 2;
  if (distanceSquared >= 1) return 0;
  // A bounded soft edge represents gaps around the edge of a leafy crown.
  return crown.cover * Math.min(1, (1 - distanceSquared) / .25);
}

function distanceToSegmentSquared(point, from, to) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  const fraction = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
    ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared));
  return (point.x - from.x - fraction * dx) ** 2 +
    (point.y - from.y - fraction * dy) ** 2;
}

/** Construct with the terrain-only geometry, not a wrapper calling this layer.
 * The caller must pin profileContract in a new saved physical-world identity.
 * radius is an unscaled trunk/rock radius, matching the historical art records;
 * the actual solid footprint is radius * scale. Fresh ecology must be placed
 * through the combined terrain/structure classifier, after this layer exists.
 */
export function createOzarkStructures(baseGeometry) {
  const bounds = baseGeometry?.bounds, profile = baseGeometry?.profile;
  if (!bounds || !['minX', 'maxX', 'minY', 'maxY'].every(key => Number.isFinite(bounds[key])) ||
      bounds.minX >= bounds.maxX || bounds.minY >= bounds.maxY ||
      !Number.isInteger(profile?.seed) || profile.seed < 0 || profile.seed > 0xffffffff ||
      !Number.isFinite(profile.cellPixels) || profile.cellPixels <= 0 ||
      typeof baseGeometry.sample !== 'function' || typeof baseGeometry.classify !== 'function' ||
      !finitePoint(baseGeometry.spawn) ||
      Object.values(baseGeometry.agentSpawns || {}).some(point => !finitePoint(point))) {
    throw new TypeError('Structures require a bounded, seeded terrain-only Ozark geometry');
  }
  const seed = profile.seed;
  const spawns = [baseGeometry.spawn, ...Object.values(baseGeometry.agentSpawns || {})];
  const cache = new Map();

  function generate(cx, cy) {
    // A maximum 20-unit jitter leaves at least 60 units between adjacent
    // candidates. Even the two largest rocks cannot overlap across cells.
    const x = Math.round((cx + .3 + hash(cx, cy, seed ^ 1949) * .4) * CELL / 2) * 2;
    const y = Math.round((cy + .3 + hash(cx, cy, seed ^ 4721) * .4) * CELL / 2) * 2;
    if (x < bounds.minX + MAX_RADIUS + 12 || x > bounds.maxX - MAX_RADIUS - 12 ||
        y < bounds.minY + MAX_RADIUS + 12 || y > bounds.maxY - MAX_RADIUS - 12) return null;
    const site = baseGeometry.sample(x, y), rules = HABITATS[site.habitat];
    if (!rules) return null;
    const roll = hash(cx, cy, seed ^ 12863);
    if (roll >= rules.trees + rules.rocks) return null;
    const kind = roll >= rules.trees ? 'rock' :
      hash(cx, cy, seed ^ 3827) < rules.pine ? 'pine' : 'oak';
    const scale = .82 + hash(cx, cy, seed ^ 3948) * .42;
    const radius = kind === 'rock' ? 23 : 16;
    const footprint = radius * scale;
    // Connected structure-free lanes preserve maneuvering space, not a promise
    // of a traversable watershed: water and steep grades remain authoritative.
    if (corridorDistance(x) < CORRIDOR_HALF_WIDTH + footprint ||
        corridorDistance(y) < CORRIDOR_HALF_WIDTH + footprint ||
        spawns.some(point => Math.hypot(point.x - x, point.y - y) < SPAWN_CLEARANCE + footprint)) return null;
    const water = Math.min(site.surfaceWaterDistance,
      site.sinkholePondDistance == null ? Infinity : site.sinkholePondDistance) * profile.cellPixels;
    if (!(water >= BANK_CLEARANCE + footprint) ||
        baseGeometry.classify(x, y, footprint + 12, 'walk').reason !== 'dry-ground') return null;
    return Object.freeze({ id: `structure:${cx}:${cy}`, kind, x, y,
      radius, scale, variant: Math.floor(hash(cx, cy, seed ^ 8816) * 6), habitat: site.habitat });
  }

  function chunk(cx, cy) {
    const key = `${cx},${cy}`;
    if (cache.has(key)) {
      const value = cache.get(key);
      cache.delete(key); cache.set(key, value);
      return value;
    }
    const objects = [];
    for (let y = 0; y < CELLS_PER_CHUNK; y++) for (let x = 0; x < CELLS_PER_CHUNK; x++) {
      const object = generate(cx * CELLS_PER_CHUNK + x, cy * CELLS_PER_CHUNK + y);
      if (object) objects.push(object);
    }
    const value = Object.freeze(objects);
    cache.set(key, value);
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
    return value;
  }

  // Internal point queries visit only intersecting cached chunks. Avoid
  // allocating/freezing a result array for every movement or canopy sample.
  // The row/chunk/object order matches the public query exactly.
  function visitRect(left, top, right, bottom, visitor) {
    left = Math.max(bounds.minX, left); right = Math.min(bounds.maxX, right);
    top = Math.max(bounds.minY, top); bottom = Math.min(bounds.maxY, bottom);
    if (left > right || top > bottom) return false;
    for (let cy = Math.floor(top / CHUNK); cy <= Math.floor(bottom / CHUNK); cy++) {
      for (let cx = Math.floor(left / CHUNK); cx <= Math.floor(right / CHUNK); cx++) {
        for (const object of chunk(cx, cy)) {
          if (object.x >= left && object.x <= right && object.y >= top && object.y <= bottom &&
              visitor(object) === true) return true;
        }
      }
    }
    return false;
  }

  // Rectangles select centers, not canopy extents. Renderers supply their normal
  // sprite padding; collision and sight supply the maximum physical radius.
  function objectsInRect(rectangle) {
    if (!rectangle || !['left', 'top', 'right', 'bottom'].every(key => Number.isFinite(rectangle[key])) ||
        rectangle.left > rectangle.right || rectangle.top > rectangle.bottom) {
      throw new TypeError('Expected finite ordered structure query bounds');
    }
    const objects = [];
    visitRect(rectangle.left, rectangle.top, rectangle.right, rectangle.bottom,
      object => { objects.push(object); });
    return objects.length ? Object.freeze(objects) : EMPTY;
  }

  function obstruction(x, y, radius = 10) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius) || radius < 0) {
      throw new TypeError('Expected a finite nonnegative structure query footprint');
    }
    const reach = radius + MAX_RADIUS;
    let found = null;
    visitRect(x - reach, y - reach, x + reach, y + reach, object => {
      if (Math.hypot(object.x - x, object.y - y) >= radius + object.radius * object.scale) return false;
      found = object; return true;
    });
    return found;
  }

  // Exact swept circle against the same solid footprints as obstruction().
  // Expanding the start circle by movement length can reject a legal departure
  // from a nearby trunk, even when the entire segment moves away from it.
  function sweptObstruction(from, to, radius = 10) {
    if (!finitePoint(from) || !finitePoint(to) || !Number.isFinite(radius) || radius < 0) {
      throw new TypeError('Expected finite sweep endpoints and a nonnegative footprint');
    }
    if (from.x === to.x && from.y === to.y) return obstruction(from.x, from.y, radius);
    const reach = radius + MAX_RADIUS;
    const dx = to.x - from.x, dy = to.y - from.y;
    const lengthSquared = dx * dx + dy * dy;
    // Outside-world queries are useful, but an unrepresentable squared length
    // or radius must fail closed rather than let NaN/Infinity miss a collider.
    if (!Number.isFinite(lengthSquared) || lengthSquared === 0 || !Number.isFinite(reach * reach)) {
      throw new RangeError('Structure sweep exceeds representable segment or footprint arithmetic');
    }
    let found = null;
    visitRect(Math.min(from.x, to.x) - reach, Math.min(from.y, to.y) - reach,
      Math.max(from.x, to.x) + reach, Math.max(from.y, to.y) + reach, object => {
        const extent = radius + object.radius * object.scale;
        const projection = (object.x - from.x) * dx + (object.y - from.y) * dy;
        if (!Number.isFinite(projection)) {
          throw new RangeError('Structure sweep exceeds representable projection arithmetic');
        }
        // At either endpoint, use the point classifier's exact floating-point
        // convention too. Squared rounding must not reject a legal departure.
        const overlaps = projection <= 0 ?
          Math.hypot(object.x - from.x, object.y - from.y) < extent :
          projection >= lengthSquared ?
            Math.hypot(object.x - to.x, object.y - to.y) < extent :
            distanceToSegmentSquared(object, from, to) < extent ** 2;
        if (!overlaps) return false;
        found = object; return true;
      });
    return found;
  }

  function blocksSight(from, to) {
    if (!finitePoint(from) || !finitePoint(to)) throw new TypeError('Expected finite sight endpoints');
    return visitRect(Math.min(from.x, to.x) - MAX_RADIUS, Math.min(from.y, to.y) - MAX_RADIUS,
      Math.max(from.x, to.x) + MAX_RADIUS, Math.max(from.y, to.y) + MAX_RADIUS,
      object => distanceToSegmentSquared(object, from, to) < (object.radius * object.scale) ** 2);
  }

  function crownCoverAt(x, y, sun = null) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new TypeError('Expected a finite crown query point');
    if (sun && !sun.daylight) return 0;
    const reach = MAX_CROWN_RADIUS + (sun ? MAX_CROWN_HEIGHT * sun.lengthFactor : 0);
    let uncovered = 1;
    visitRect(x - reach, y - reach, x + reach, y + reach, object => {
      const crown = landscapeCrown(object);
      if (!crown) return;
      const shift = sun ? crown.height * sun.lengthFactor : 0;
      const coverage = crownCoverage(x, y, object.x + (sun ? sun.dx * shift : 0),
        object.y + (sun ? sun.dy * shift : 0), crown);
      uncovered *= 1 - coverage;
    });
    return (1 - uncovered) * (sun ? sun.strength : 1);
  }

  // Canopy is overhead cover from actual immutable tree crowns, not the
  // descriptor's potential vegetation and not a quantity that vanishes at dusk.
  function canopyAt(x, y) { return crownCoverAt(x, y); }
  // Physical solar shade is separate: those same crowns are projected across
  // the ground as the sun moves, and produce no solar shade during the night.
  function shadowAt(x, y, hour) { return crownCoverAt(x, y, landscapeSun(hour)); }

  return Object.freeze({ profileContract: OZARK_STRUCTURES_CONTRACT,
    objectsInRect, obstruction, sweptObstruction, blocksSight, canopyAt, shadowAt });
}
