import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CONFIG } from '../src/config.js';
import { OZARK_PREVIEW_PROFILE, OZARK_WALKING_PILOT_PROFILE } from '../src/geometry-profile.js';
import { generateOzarkPreview } from '../src/ozark-preview-model.js';
import { createOzarkPreviewPixelAdapter } from '../scripts/ozark-preview-pixels.mjs';
import { OZARK_WORLD_PROFILE, createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';

const geometry = createOzarkWorldGeometry();
const preview = createOzarkPreviewPixelAdapter(OZARK_PREVIEW_PROFILE);
const near = (actual, expected, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

test('playable identity pins the approved descriptor, full bounds, spawns, and rules', () => {
  const { identity, ...payload } = OZARK_WORLD_PROFILE;
  assert.equal(identity, 'sha256:' + createHash('sha256')
    .update(JSON.stringify(payload)).digest('hex'));
  assert.notEqual(identity, OZARK_PREVIEW_PROFILE.identity);
  assert.notEqual(identity, OZARK_WALKING_PILOT_PROFILE.identity);
  assert.equal(OZARK_WORLD_PROFILE.descriptorSha256,
    OZARK_PREVIEW_PROFILE.descriptorSha256);
  assert.equal(OZARK_WORLD_PROFILE.scope, 'playable-fresh-and-restored');
  assert.deepEqual(geometry.bounds,
    { minX: -19000, maxX: 19000, minY: -14200, maxY: 14200 });
  assert.deepEqual(geometry.spawn, { x: -680, y: 380 });
  assert.deepEqual(geometry.agentSpawns,
    { aster: { x: 276, y: 760 }, mira: { x: 300, y: 920 } });
  assert.strictEqual(createOzarkWorldGeometry(), geometry);
  for (const value of [geometry, geometry.profile, geometry.bounds,
    geometry.spawn, geometry.agentSpawns, geometry.agentSpawns.aster,
    geometry.agentSpawns.mira]) assert.equal(Object.isFrozen(value), true);
});

test('one continuous approved sampler controls all map pixels and physical bounds', () => {
  for (const point of [
    { x: -19000, y: -14200 }, { x: 19000, y: 14200 },
    geometry.spawn, geometry.agentSpawns.aster,
    { x: -1200, y: 240 }, { x: -11800, y: 11800 },
    { x: 13000, y: -6200 },
  ]) {
    const actual = geometry.sample(point.x, point.y);
    const approved = preview.sampleAtPixel(point.x, point.y);
    for (const key of ['elevation', 'surfaceWaterDistance',
      'sinkholePondDistance', 'watershedDistance', 'crestRise',
      'habitat', 'drainage', 'substrate']) {
      assert.equal(actual[key], approved[key], `${key} at ${JSON.stringify(point)}`);
    }
    assert.equal(Object.isFrozen(actual), true);
    assert.equal(Object.isFrozen(actual.nearestChannel), true);
  }
  assert.throws(() => geometry.sample(-19000.1, 0), RangeError);
  assert.throws(() => geometry.sample(0, 14200.1), RangeError);
  assert.equal(geometry.classify(-19000, 0).reason, 'outside-approved-bounds');
  assert.equal(geometry.classify(19000, 0).walkable, false);
  assert.equal(geometry.canOccupy(19000, 0), false);
  assert.equal(geometry.lineOfSight(geometry.spawn, { x: 19001, y: 380 }), false);
});

test('all three fresh starts and separated whole-map sites are dry and passable', () => {
  assert.equal(CONFIG.playerRadius, 10);
  for (const point of [geometry.spawn, ...Object.values(geometry.agentSpawns),
    { x: 13000, y: -6200 }, { x: -18000, y: -13000 },
    { x: 18000, y: 13000 }]) {
    assert.equal(geometry.classify(point.x, point.y).reason, 'dry-ground');
    assert.equal(geometry.canOccupy(point.x, point.y), true);
  }
  const actor = { ...geometry.spawn };
  for (let index = 0; index < 19; index += 1)
    assert.ok(geometry.move(actor, 1, 0, .25) > 0);
  assert.ok(actor.x >= 0);
  assert.equal(actor.y, geometry.spawn.y);
  assert.equal(geometry.lineOfSight(geometry.spawn, actor), true);
});

test('offline coarse physical graph spans both riverbanks and remote map regions', () => {
  // This test graph is never handed to an actor. It is a coarse production
  // geometry audit, not evidence that an inhabitant knows or can follow it.
  const width = 96, height = 72;
  const occupied = new Uint8Array(width * height);
  const point = (x, y) => ({ x: -19000 + x * 400, y: -14200 + y * 400 });
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const p = point(x, y);
      occupied[y * width + x] = Number(geometry.canOccupy(p.x, p.y));
    }
  }
  const visited = new Uint8Array(width * height);
  const start = 36 * width + 46;
  const queue = [start];
  visited[start] = 1;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor], x = index % width;
    const y = Math.floor(index / width);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, next = ny * width + nx;
      if (nx < 1 || nx >= width - 1 || ny < 1 || ny >= height - 1 ||
          visited[next] || !occupied[next]) continue;
      let clear = true;
      for (const fraction of [.25, .5, .75]) {
        const p = point(x + dx * fraction, y + dy * fraction);
        if (!geometry.canOccupy(p.x, p.y)) { clear = false; break; }
      }
      if (clear) { visited[next] = 1; queue.push(next); }
    }
  }
  assert.ok(queue.length >= 6400, `coarse connected centers: ${queue.length}`);
  for (const [x, y] of [[2, 3], [93, 3], [2, 68], [93, 68]]) {
    assert.equal(visited[y * width + x], 1,
      `remote region ${x},${y} disconnected from start`);
  }
});

test('every channel permits an attempted wade or swim, with local downstream current', () => {
  const shallow = geometry.classify(-1200, 240);
  assert.equal(shallow.reason, 'shallow-water');
  assert.equal(shallow.currentCue, 'downstream');
  near(shallow.currentDirection.x, Math.SQRT1_2);
  near(shallow.currentDirection.y, -Math.SQRT1_2);
  assert.equal(geometry.classify(-1200, 220).reason, 'deep-water');
  assert.equal(geometry.classify(-1200, 220, 10, 'swim').reason, 'swimming');
  assert.equal(geometry.canOccupy(-1200, 220), true);
  assert.equal(geometry.sample(-1200, 220).waterBand, 'deep-water');
  assert.equal(geometry.classify(-11800, 11800).reason, 'internal-pond');
  assert.equal(geometry.classify(-11800, 11800, 10, 'swim').reason, 'swimming');
  assert.equal(geometry.sample(-11800, 11800).currentDirection, null);
  assert.equal(geometry.sample(-11800, 11800).currentCue, null);
  const actor = { x: -1200, y: 400 };
  let swimSeconds = 0, waterSeconds = 0;
  for (let index = 0; index < 600; index += 1) {
    const motion = geometry.advance(actor, 0, -1, 1 / 60, false, 'swim');
    swimSeconds += motion.swimSeconds;
    waterSeconds += motion.waterSeconds;
    assert.equal(geometry.canOccupy(actor.x, actor.y), true);
  }
  assert.ok(swimSeconds > 0);
  assert.ok(waterSeconds >= swimSeconds);
  assert.ok(actor.y < -300, `swimmer did not reach the far bank: ${actor.y}`);
  const walking = { x: -1200, y: 400 };
  for (let index = 0; index < 600; index += 1)
    geometry.advance(walking, 0, -1, 1 / 60);
  assert.equal(geometry.classify(walking.x, walking.y).reason, 'shallow-water');
  assert.ok(walking.y > actor.y + 300);
});

test('tributaries and spring pool use their own authored downstream edges', () => {
  const descriptor = generateOzarkPreview(OZARK_WORLD_PROFILE.seed);
  for (const [kind, path] of [
    ['tributary', descriptor.tributaries[0].cells],
    ['tributary', descriptor.tributaries[1].cells],
    ['spring-pool', descriptor.spring.branchCells],
  ]) {
    const from = descriptor.cells[path[0]], to = descriptor.cells[path[1]];
    const site = geometry.sample(-19000 + from.x * 400, -14200 + from.y * 400);
    assert.equal(site.paint, 'surface-water');
    assert.equal(site.nearestChannel.kind, kind);
    near(site.currentDirection.x, (to.x - from.x) /
      Math.hypot(to.x - from.x, to.y - from.y));
    near(site.currentDirection.y, (to.y - from.y) /
      Math.hypot(to.x - from.x, to.y - from.y));
  }
  const spring = descriptor.cells[descriptor.spring.branchCells[1]];
  assert.equal(geometry.sample(-19000 + spring.x * 400,
    -14200 + spring.y * 400).nearestChannel.kind, 'spring-outflow');
});

test('climbing is explicit and reports effort and blocked steep-footing fall risk', () => {
  assert.equal(geometry.classify(-12000, 9800).reason, 'excessive-grade');
  assert.equal(geometry.classify(-12000, 9800, 10, 'climb').reason, 'steep-ground');
  assert.equal(geometry.canOccupy(-12000, 9800), true);
  assert.equal(geometry.classify(-12000, 9900, 10, 'climb').walkable, false);
  const actor = { x: -12000, y: 9790 };
  let climbSeconds = 0, effortSeconds = 0, fallRiskSeconds = 0;
  for (let index = 0; index < 120; index += 1) {
    const result = geometry.advance(actor, 0, 1, 1 / 60, false, 'climb');
    climbSeconds += result.climbSeconds;
    effortSeconds += result.effortSeconds;
    fallRiskSeconds += result.fallRiskSeconds;
    assert.equal(geometry.classify(actor.x, actor.y, 10, 'climb').walkable, true);
  }
  assert.ok(climbSeconds > 0);
  assert.ok(effortSeconds > 2);
  assert.ok(fallRiskSeconds > 0);
  assert.ok(actor.y < 9900);
});

test('modeled current drifts idle bodies and remains stable across caller partitions', () => {
  const run = step => {
    const actor = { x: -1200, y: 270 };
    let waterSeconds = 0, driftDistance = 0;
    for (let index = 0; index < Math.round(1 / step); index += 1) {
      const result = geometry.advance(actor, 0, 1, step);
      waterSeconds += result.waterSeconds;
      driftDistance += result.driftDistance;
    }
    return { actor, waterSeconds, driftDistance };
  };
  const sixty = run(1 / 60), oneTwenty = run(1 / 120);
  near(sixty.actor.x, oneTwenty.actor.x);
  near(sixty.actor.y, oneTwenty.actor.y);
  near(sixty.waterSeconds, oneTwenty.waterSeconds);
  near(sixty.driftDistance, oneTwenty.driftDistance);
  assert.ok(sixty.driftDistance > 0);
  const unconscious = { x: -1200, y: 220 };
  const before = { ...unconscious };
  const drift = geometry.advance(unconscious, 0, 0, .25);
  assert.ok(drift.driftDistance > 0);
  assert.ok(unconscious.x > before.x && unconscious.y < before.y);
});

test('local observation reveals qualitative ground but no hidden map or route fields', () => {
  const observation = geometry.observe(geometry.spawn);
  assert.equal(observation.ground, 'dry-land');
  assert.ok(observation.nearby.length > 0 && observation.nearby.length <= 16);
  assert.equal(Object.isFrozen(observation), true);
  assert.equal(Object.isFrozen(observation.nearby), true);
  for (const row of observation.nearby) {
    assert.equal(Object.isFrozen(row), true);
    assert.deepEqual(Object.keys(row), ['direction', 'ground', 'habitat']);
  }
  for (const hidden of ['elevation', 'crestRise', 'surfaceWaterDistance',
    'sinkholePondDistance', 'terminalCell', 'drainage', 'nearestChannel',
    'depthProxy', 'currentDirection', 'walkable']) {
    assert.equal(Object.hasOwn(observation, hidden), false);
    assert.ok(observation.nearby.every(row => !Object.hasOwn(row, hidden)));
  }
  assert.equal(geometry.observe({ x: -1200, y: 220 }).ground, 'deep-water');
  assert.throws(() => geometry.observe({ x: 19000, y: 0 }), RangeError);
});

test('ground-only query exactly matches observation across occupied terrain and moving positions', () => {
  const cases = [
    [geometry.spawn, 'dry-land'],
    [{ x: -12000, y: 9800 }, 'steep-ground'],
    [{ x: -1200, y: 240 }, 'shallow-water'],
    [{ x: -1200, y: 220 }, 'deep-water'],
    [{ x: -11800, y: 11800 }, 'deep-pond'],
  ];
  for (const [point, expected] of cases) {
    assert.equal(geometry.groundAt(point), expected);
    assert.equal(geometry.groundAt(point), geometry.observe(point).ground);
  }
  // Whole-map samples include authored river, tributary, spring and pond edges.
  for (let y = -13400; y <= 13400; y += 1200) {
    for (let x = -18200; x <= 18200; x += 1200) {
      const point = { x, y };
      if (geometry.canOccupy(x, y))
        assert.equal(geometry.groundAt(point), geometry.observe(point).ground);
    }
  }
  const point = { x: -1200, y: 400 }, seen = new Set();
  for (let i = 0; i < 240; i++) {
    geometry.advance(point, 0, -1, 1 / 60, false, 'swim');
    const ground = geometry.groundAt(point);
    assert.equal(ground, geometry.observe(point).ground);
    seen.add(ground);
  }
  assert.ok(seen.has('shallow-water'));
  assert.ok(seen.has('deep-water'));
});

test('ground-only query preserves observation errors for invalid and unreachable positions', () => {
  const structures = geometry.structures.objectsInRect({ left: -9000, top: -7000, right: 9000, bottom: 7000 });
  const blocked = ['oak', 'pine', 'rock'].map(kind => structures.find(o => o.kind === kind));
  const points = [undefined, null, false, 3, 'point', {}, { x: 0 },
    { x: NaN, y: 0 }, { x: 0, y: Infinity }, { x: '0', y: 0 },
    { x: 19000, y: 0 }, { x: -19000, y: 0 }, { x: 0, y: 14200 },
    { x: 0, y: -14200 }, { x: 19001, y: 0 }, { x: -12000, y: 9900 },
    ...blocked.map(o => ({ x: o.x, y: o.y }))];
  for (const point of points) {
    for (const query of [geometry.observe, geometry.groundAt]) {
      assert.throws(() => query(point), {
        name: 'RangeError', message: 'Ozark observation requires a physically reachable position',
      });
    }
  }
});

// Existing observe can grade a remote boundary ray outside the map. The local
// query must not perform that unrelated remote work or change observe itself.
test('ground-only query accepts valid local ground even when a remote observation ray reaches the map edge', () => {
  const point = { x: -18600, y: -13800 };
  assert.equal(geometry.canOccupy(point.x, point.y), true);
  assert.equal(geometry.groundAt(point), 'dry-land');
  assert.throws(() => geometry.observe(point), {name:'RangeError', message:'Outside approved Ozark sample-center bounds'});
});
