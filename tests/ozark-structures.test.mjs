import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createOzarkStructures, OZARK_STRUCTURES_CONTRACT, landscapeCrown, landscapeSun } from '../src/ozark-structures.js';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';

const rectangle = { left: -2400, top: -2400, right: 2400, bottom: 2400 };
function terrain(habitat = 'oak-pine-woodland', overrides = {}) {
  return Object.freeze({
    bounds: Object.freeze({ minX: -20000, minY: -20000, maxX: 20000, maxY: 20000 }),
    profile: Object.freeze({ seed: 74193, cellPixels: 400 }),
    spawn: Object.freeze({ x: 0, y: 0 }), agentSpawns: Object.freeze({ aster: { x: 150, y: 150 } }),
    sample: () => ({ habitat, surfaceWaterDistance: 20, sinkholePondDistance: null }),
    classify: () => ({ walkable: true, reason: 'dry-ground' }), ...overrides,
  });
}

test('structures are deterministic, immutable, spatially bounded and independent of query order', () => {
  const base = terrain(), before = JSON.stringify(base), first = createOzarkStructures(base);
  const expected = first.objectsInRect(rectangle);
  assert.equal(first.profileContract, OZARK_STRUCTURES_CONTRACT);
  assert.ok(Object.isFrozen(first) && Object.isFrozen(expected));
  // Changing this layout requires a new physical contract, not a silent
  // alteration of the trees and rocks under an existing saved identity.
  assert.equal(expected.length, 1765);
  assert.equal(createHash('sha256').update(JSON.stringify(expected)).digest('hex'),
    '1e235701025036b9af47515a66a53475ad75f92828907c0099b1824cc6db9575');
  assert.equal(new Set(expected.map(object => object.id)).size, expected.length);
  for (const object of expected) {
    assert.ok(Object.isFrozen(object));
    assert.ok(object.x >= rectangle.left && object.x <= rectangle.right &&
      object.y >= rectangle.top && object.y <= rectangle.bottom);
    assert.deepEqual(Object.keys(object).sort(), ['habitat', 'id', 'kind', 'radius', 'scale', 'variant', 'x', 'y']);
  }
  // Evict the original chunks; regeneration must preserve every byte.
  for (let cy = -34; cy <= 33; cy++) for (let cx = -34; cx <= 33; cx++) {
    if (cx >= -4 && cx <= 4 && cy >= -4 && cy <= 4) continue;
    first.objectsInRect({ left: cx * 600, top: cy * 600,
      right: cx * 600 + 599, bottom: cy * 600 + 599 });
  }
  assert.deepEqual(first.objectsInRect(rectangle), expected);
  assert.deepEqual(createOzarkStructures(base).objectsInRect(rectangle), expected);
  assert.deepEqual(first.objectsInRect({ left: 21000, top: 21000, right: 22000, bottom: 22000 }), []);
  assert.equal(JSON.stringify(base), before);
});

test('habitat rules produce dense real woodland and cove trees, sparse clearings, and glade rocks only', () => {
  const counts = {};
  for (const habitat of ['oak-pine-woodland', 'shaded-cove', 'wet-terrace', 'open-clearing', 'dry-rocky-glade']) {
    const objects = createOzarkStructures(terrain(habitat)).objectsInRect(rectangle);
    counts[habitat] = { trees: objects.filter(object => object.kind !== 'rock').length,
      rocks: objects.filter(object => object.kind === 'rock').length };
    if (habitat === 'shaded-cove') assert.ok(objects.filter(object => object.kind === 'oak').length > counts[habitat].trees * .8);
  }
  assert.ok(counts['oak-pine-woodland'].trees > counts['wet-terrace'].trees * 3);
  assert.ok(counts['wet-terrace'].trees > counts['open-clearing'].trees * 2);
  assert.ok(counts['shaded-cove'].trees > counts['oak-pine-woodland'].trees);
  assert.equal(counts['dry-rocky-glade'].trees, 0);
  assert.ok(counts['dry-rocky-glade'].rocks > 300);
  for (const habitat of ['river-channel', 'sinkhole-basin', 'desert', 'unknown']) {
    assert.deepEqual(createOzarkStructures(terrain(habitat)).objectsInRect(rectangle), []);
  }
});

test('actual Ozark structures respect dry footprints, bank margins, habitats, spawns and open lanes', () => {
  const base = createOzarkWorldGeometry(), structures = base.structures;
  const objects = structures.objectsInRect({ left: -9000, top: -7000, right: 9000, bottom: 7000 });
  assert.equal(objects.length, 10554);
  assert.equal(createHash('sha256').update(JSON.stringify(objects)).digest('hex'),
    '4947794263f965acdc425cb88dc55a68b5150fa3066e3ec9a1f76c5da052db35');
  const spawns = [base.spawn, ...Object.values(base.agentSpawns)];
  for (const object of objects) {
    const footprint = object.radius * object.scale, site = base.sample(object.x, object.y);
    assert.equal(site.habitat, object.habitat);
    const footing = base.classify(object.x, object.y, footprint + 12);
    assert.equal(footing.walkable, false);
    assert.equal(footing.reason, object.kind === 'rock' ? 'solid-rock' : 'tree-trunk');
    assert.ok(footing.grade <= base.profile.walkGrade);
    assert.ok(site.surfaceWaterDistance * base.profile.cellPixels >= 240 + footprint);
    if (site.sinkholePondDistance !== null) assert.ok(site.sinkholePondDistance * base.profile.cellPixels >= 240 + footprint);
    for (const spawn of spawns) assert.ok(Math.hypot(object.x - spawn.x, object.y - spawn.y) >= 130 + footprint);
    for (const coordinate of [object.x, object.y]) assert.ok(Math.abs(coordinate - Math.round(coordinate / 600) * 600) >= 24 + footprint);
    if (site.habitat === 'dry-rocky-glade') assert.equal(object.kind, 'rock');
  }
});

test('the same trunk and rock records block collision and sight without overlapping one another', () => {
  const structures = createOzarkStructures(terrain());
  const objects = structures.objectsInRect(rectangle);
  for (const kind of ['oak', 'pine', 'rock']) {
    const object = objects.find(candidate => candidate.kind === kind);
    assert.ok(object, `expected ${kind}`);
    assert.equal(structures.obstruction(object.x, object.y, 10), object);
    const r = object.radius * object.scale;
    assert.ok(structures.blocksSight({ x: object.x - r - 1, y: object.y }, { x: object.x + r + 1, y: object.y }));
    assert.equal(structures.blocksSight({ x: object.x - 2, y: object.y + r + 1 }, { x: object.x + 2, y: object.y + r + 1 }), false);
    assert.equal(structures.obstruction(object.x, object.y + r + 1, 0), null);
  }
  assert.equal(structures.obstruction(0, 0, 10), null);
  assert.equal(structures.blocksSight({ x: -2300, y: 0 }, { x: 2300, y: 0 }), false);
  for (const object of objects) {
    for (const other of structures.objectsInRect({ left: object.x - 60, right: object.x + 60,
      top: object.y - 60, bottom: object.y + 60 })) {
      if (other.id === object.id) continue;
      assert.ok(Math.hypot(object.x - other.x, object.y - other.y) >= object.radius * object.scale + other.radius * other.scale);
    }
  }
});

test('generation never places structures in water or on nonwalkable grades; queries validate inputs', () => {
  assert.deepEqual(createOzarkStructures(terrain('oak-pine-woodland', {
    sample: () => ({ habitat: 'oak-pine-woodland', surfaceWaterDistance: .1, sinkholePondDistance: null }),
  })).objectsInRect(rectangle), []);
  assert.deepEqual(createOzarkStructures(terrain('oak-pine-woodland', {
    classify: () => ({ walkable: false, reason: 'excessive-grade' }),
  })).objectsInRect(rectangle), []);
  assert.throws(() => createOzarkStructures({}), TypeError);
  const structures = createOzarkStructures(terrain());
  assert.throws(() => structures.objectsInRect({ ...rectangle, left: NaN }), TypeError);
  assert.throws(() => structures.objectsInRect({ ...rectangle, right: -5000 }), TypeError);
  assert.throws(() => structures.obstruction(0, 0, -1), TypeError);
  assert.throws(() => structures.blocksSight({ x: NaN, y: 0 }, { x: 0, y: 0 }), TypeError);
});

test('continuous channel and pond approaches retain three navigation cells of solid-free clearance', () => {
  for (const [surfaceWaterDistance, sinkholePondDistance] of [[.5, null], [20, .5]]) {
    const structures = createOzarkStructures(terrain('oak-pine-woodland', {
      sample: () => ({ habitat: 'oak-pine-woodland', surfaceWaterDistance, sinkholePondDistance }),
    }));
    assert.deepEqual(structures.objectsInRect(rectangle), [], '200-unit approaches contain no blocking trunks or rocks');
  }
  const outsideApproach = createOzarkStructures(terrain('oak-pine-woodland', {
    sample: () => ({ habitat: 'oak-pine-woodland', surfaceWaterDistance: .75, sinkholePondDistance: null }),
  }));
  assert.ok(outsideApproach.objectsInRect(rectangle).length > 1000,
    'dense woodland remains outside the finite approach band');
});

test('canopy and shade require actual tree crowns, not habitat labels, rocks or night darkness', () => {
  for (const base of [terrain('desert'), terrain('dry-rocky-glade'), terrain('oak-pine-woodland', {
    classify: () => ({ walkable: false, reason: 'excessive-grade' }),
  })]) {
    const structures = createOzarkStructures(base);
    for (const point of [{ x: 0, y: 0 }, { x: 350, y: 350 }, { x: -530, y: -870 }]) {
      assert.equal(structures.canopyAt(point.x, point.y), 0);
      for (const hour of [0, 6, 8, 12, 16, 18, 23]) assert.equal(structures.shadowAt(point.x, point.y, hour), 0);
    }
  }
  assert.equal(landscapeCrown({ kind: 'rock', scale: 1 }), null);
});

test('the same actual crown casts moving solar shade while overhead canopy persists all night', () => {
  const tree = createOzarkStructures(terrain()).objectsInRect(rectangle).find(object => object.kind === 'oak');
  // Isolate one already-canonical tree so other trees cannot mask its movement.
  const isolated = createOzarkStructures(terrain('unknown', {
    sample: (x, y) => ({ habitat: x === tree.x && y === tree.y ? 'oak-pine-woodland' : 'unknown',
      surfaceWaterDistance: 20, sinkholePondDistance: null }),
  }));
  assert.deepEqual(isolated.objectsInRect(rectangle), [tree]);
  const crown = landscapeCrown(tree), canopy = isolated.canopyAt(tree.x, tree.y);
  assert.equal(canopy, crown.cover);
  assert.equal(isolated.canopyAt(tree.x + crown.radiusX + 1, tree.y), 0);
  const projections = [];
  for (const hour of [8, 12, 16]) {
    const sun = landscapeSun(hour), shift = crown.height * sun.lengthFactor;
    const point = { x: tree.x + sun.dx * shift, y: tree.y + sun.dy * shift };
    projections.push(point);
    assert.ok(Math.abs(isolated.shadowAt(point.x, point.y, hour) - crown.cover * sun.strength) < 1e-12);
    assert.equal(isolated.canopyAt(tree.x, tree.y), canopy);
  }
  assert.ok(projections[0].x < tree.x && projections[2].x > tree.x);
  assert.ok(Math.hypot(projections[0].x - tree.x, projections[0].y - tree.y) >
    Math.hypot(projections[1].x - tree.x, projections[1].y - tree.y) * 3);
  assert.equal(isolated.shadowAt(projections[0].x, projections[0].y, 16), 0);
  assert.equal(isolated.shadowAt(projections[2].x, projections[2].y, 8), 0);
  for (const hour of [0, 6, 18, 23]) {
    assert.equal(isolated.shadowAt(tree.x, tree.y, hour), 0);
    for (const point of projections) assert.equal(isolated.shadowAt(point.x, point.y, hour), 0);
    assert.equal(isolated.canopyAt(tree.x, tree.y), canopy);
  }
});

test('solar helpers wrap a local day, use unit shadow directions and reject invalid inputs', () => {
  for (const hour of [7, 8, 12, 16, 17]) {
    const sun = landscapeSun(hour);
    assert.ok(Object.isFrozen(sun) && sun.daylight);
    assert.ok(Math.abs(Math.hypot(sun.dx, sun.dy) - 1) < 1e-12);
    assert.ok(sun.strength > 0 && sun.strength <= 1);
    assert.deepEqual(landscapeSun(hour + 24), sun);
    assert.deepEqual(landscapeSun(hour - 24), sun);
  }
  const structures = createOzarkStructures(terrain());
  assert.throws(() => landscapeSun(NaN), TypeError);
  assert.throws(() => landscapeCrown({ kind: 'oak', scale: 0 }), TypeError);
  assert.throws(() => structures.canopyAt(Infinity, 0), TypeError);
  assert.throws(() => structures.shadowAt(0, 0, NaN), TypeError);
});

test('scattered repeat checks reuse lazy chunks instead of rebuilding a small rolling window', () => {
  let samples = 0;
  const structures = createOzarkStructures(terrain('oak-pine-woodland', {
    sample: () => { samples++; return { habitat: 'oak-pine-woodland',
      surfaceWaterDistance: 20, sinkholePondDistance: null }; },
  }));
  assert.equal(samples, 0, 'construction is lazy');
  const queries = [];
  for (let y = -18000; y <= 18000; y += 1200) for (let x = -18000; x <= 18000; x += 1200) {
    queries.push({ left: x + 10, top: y + 10, right: x + 100, bottom: y + 100 });
  }
  for (const query of queries) structures.objectsInRect(query);
  const initialSamples = samples;
  assert.ok(initialSamples > 128 * 36);
  for (const query of queries) structures.objectsInRect(query);
  assert.equal(samples, initialSamples, 'the same scattered validation pass needs no regeneration');
});

test('allocation-free point queries retain exactly the public record coverage order and math', () => {
  const structures = createOzarkStructures(terrain());
  const objects = structures.objectsInRect(rectangle);
  function reference(x, y, hour) {
    const sun = hour === undefined ? null : landscapeSun(hour);
    if (sun && !sun.daylight) return 0;
    let uncovered = 1;
    for (const object of objects) {
      const crown = landscapeCrown(object);
      if (!crown) continue;
      const shift = sun ? crown.height * sun.lengthFactor : 0;
      const dx = (x - object.x - (sun ? sun.dx * shift : 0)) / crown.radiusX;
      const dy = (y - object.y - (sun ? sun.dy * shift : 0)) / crown.radiusY;
      const distanceSquared = dx ** 2 + dy ** 2;
      if (distanceSquared >= 1) continue;
      uncovered *= 1 - crown.cover * Math.min(1, (1 - distanceSquared) / .25);
    }
    return (1 - uncovered) * (sun ? sun.strength : 1);
  }
  for (let y = -1700; y <= 1700; y += 419) for (let x = -1700; x <= 1700; x += 431) {
    assert.ok(Math.abs(structures.canopyAt(x, y) - reference(x, y)) < 1e-12);
    for (const hour of [0, 7, 12, 17]) {
      assert.ok(Math.abs(structures.shadowAt(x, y, hour) - reference(x, y, hour)) < 1e-12);
    }
  }
  const mutable = { kind: 'oak', scale: 1 }, before = landscapeCrown(mutable);
  mutable.scale = 2;
  assert.equal(landscapeCrown(mutable).radiusX, before.radiusX * 2);
});
