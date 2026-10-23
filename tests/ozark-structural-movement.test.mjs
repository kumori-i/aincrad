import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { loadOzarkSave, writeOzarkSave } from '../src/ozark-save.js';
import { blockedMove, evidence } from './ozark-self-edge-fixture.mjs';

const geometry = createOzarkWorldGeometry();
const dt = 1 / 60;
const origin = { x: 527.477507991225, y: 3120.0000031694867 };
const formerlyTrapped = { x: 527.9482587463335, y: 3120.0000031694867 };
const tree = geometry.structures.objectsInRect({ left: 500, top: 3100,
  right: 580, bottom: 3170 }).find(object => object.id === 'structure:5:31');
const near = (actual, expected, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

function attempt(start, dx, dy, seconds = dt, sprint = false, mode = 'walk') {
  const actor = { ...start };
  const result = geometry.advance(actor, dx, dy, seconds, sprint, mode);
  return { actor, result };
}

test('ordinary diagonal entry cannot physically lock a legal departure from a tree patch', () => {
  assert.equal(geometry.classify(origin.x, origin.y).reason, 'dry-ground');
  const entry = attempt(origin, 560 - origin.x, 3200 - origin.y);
  assert.ok(entry.result.distance > 0 && entry.result.distance < 1);
  near(entry.actor.x, formerlyTrapped.x);
  near(entry.actor.y, formerlyTrapped.y);
  assert.equal(geometry.classify(entry.actor.x, entry.actor.y).walkable, true);
  for (const [dx, dy] of [[-1, 0], [0, -1], [-1, -1], [-1, 1]]) {
    const { actor, result } = attempt(entry.actor, dx, dy);
    near(result.distance, CONFIG.walkSpeed * dt);
    near(result.effortSeconds, dt);
    assert.equal(geometry.classify(actor.x, actor.y).walkable, true);
  }
  // The correction does not permit motion into the trunk or erase its cost.
  for (const [dx, dy] of [[1, 0], [0, 1], [1, 1]]) {
    const { actor, result } = attempt(entry.actor, dx, dy);
    assert.deepEqual(actor, entry.actor);
    assert.equal(result.distance, 0);
    near(result.effortSeconds, dt);
  }
});

test('near-trunk departure and X-then-Y sliding work on either side without tunneling', () => {
  const reach = tree.radius * tree.scale + CONFIG.playerRadius;
  for (const side of [-1, 1]) {
    const start = { x: tree.x + side * (reach + .01), y: tree.y };
    assert.equal(geometry.classify(start.x, start.y).walkable, true);
    const outward = attempt(start, side, 0);
    near(outward.actor.x - start.x, side * CONFIG.walkSpeed * dt);
    near(outward.result.effortSeconds, dt);
    const inward = attempt(start, -side, 0);
    assert.deepEqual(inward.actor, start);
    near(inward.result.effortSeconds, dt);
    const slide = attempt(start, -side, 1);
    assert.equal(slide.actor.x, start.x, 'blocked X stays fixed while Y can slide');
    near(slide.actor.y - start.y, CONFIG.walkSpeed * dt * Math.SQRT1_2);
    assert.equal(geometry.classify(slide.actor.x, slide.actor.y).walkable, true);
    near(slide.result.effortSeconds, dt);
    const long = attempt(start, -side, 0, 100, true);
    assert.deepEqual(long.actor, start, 'a clamped long sprint cannot cross the solid circle');
    near(long.result.effortSeconds, .25);
    for (const mode of ['climb', 'swim']) {
      const blocked = attempt(start, -side, 0, .25, true, mode);
      assert.deepEqual(blocked.actor, start, `${mode} does not bypass dry-ground solids`);
      near(blocked.result.effortSeconds, .25);
      near(attempt(start, side, 0, dt, false, mode).result.distance, CONFIG.walkSpeed * dt);
    }
  }
});

test('clear departures agree across time partitions; contact error stays within one internal step', () => {
  const run = (start, dx, dy, parts, duration = dt) => {
    const actor = { ...start };
    let effortSeconds = 0;
    for (let index = 0; index < parts; index++) {
      effortSeconds += geometry.advance(actor, dx, dy, duration / parts).effortSeconds;
      assert.equal(geometry.classify(actor.x, actor.y).walkable, true);
    }
    return { actor, effortSeconds };
  };
  for (const [dx, dy] of [[-1, 0], [0, -1], [-1, -1], [-1, 1]]) {
    const coarse = run(formerlyTrapped, dx, dy, 1);
    for (const parts of [2, 4, 16]) {
      const fine = run(formerlyTrapped, dx, dy, parts);
      near(fine.actor.x, coarse.actor.x);
      near(fine.actor.y, coarse.actor.y);
      near(fine.effortSeconds, coarse.effortSeconds);
    }
  }
  // Collision rejects complete axis substeps rather than snapping to contact.
  // For this straight approach, subdivision can change the final clearance by
  // at most one 1/120-second walking step (1.25 px), not create a physical lock.
  const start = { x: tree.x - tree.radius * tree.scale - CONFIG.playerRadius - 8,
    y: tree.y };
  const coarse = run(start, 1, 0, 1, .1);
  for (const parts of [2, 12, 96]) {
    const fine = run(start, 1, 0, parts, .1);
    near(fine.actor.x, coarse.actor.x, CONFIG.walkSpeed * geometry.profile.motionStep);
    near(fine.actor.y, coarse.actor.y);
    near(fine.effortSeconds, .1);
    near(attempt(fine.actor, -1, 0).result.distance, CONFIG.walkSpeed * dt);
  }
});

test('terrain boundaries, deep water, blocked grades and paid climbing remain authoritative', () => {
  for (const [point, mode] of [
    [{ x: -1200, y: 220 }, 'walk'],
    [{ x: -12000, y: 9900 }, 'climb'],
    [{ x: 19000, y: 0 }, 'walk'],
    [{ x: tree.x, y: tree.y }, 'walk'],
  ]) {
    const { actor, result } = attempt(point, -1, 1, dt, false, mode);
    assert.deepEqual(actor, point);
    assert.equal(result.distance, 0);
    assert.equal(result.effortSeconds, 0, 'illegal starts are not movement attempts');
  }
  const walker = { x: -1200, y: 400 };
  const climber = { x: -12000, y: 9790 };
  let climbEffort = 0, fallRisk = 0;
  for (let index = 0; index < 120; index++) {
    geometry.advance(walker, 0, -1, dt);
    assert.equal(geometry.classify(walker.x, walker.y).walkable, true);
    const result = geometry.advance(climber, 0, 1, dt, false, 'climb');
    climbEffort += result.effortSeconds;
    fallRisk += result.fallRiskSeconds;
    assert.equal(geometry.classify(climber.x, climber.y, 10, 'climb').walkable, true);
  }
  assert.equal(geometry.classify(walker.x, walker.y).reason, 'shallow-water');
  assert.ok(climbEffort > 2 && fallRisk > 0);
  const edge = { x: 18990, y: -13000 };
  assert.equal(geometry.classify(edge.x, edge.y).walkable, true);
  const boundary = attempt(edge, 1, 0);
  assert.deepEqual(boundary.actor, edge);
  near(boundary.result.effortSeconds, dt);
});

test('malformed movement and unreachable starts remain unchanged and fail closed', () => {
  for (const actor of [undefined, null, false, 3, 'point', {}, { x: 0 },
    { x: NaN, y: 0 }, { x: 0, y: Infinity }, { x: '0', y: 0 }]) {
    const before = structuredClone(actor);
    const result = geometry.advance(actor, 1, 0, dt);
    assert.deepEqual(actor, before);
    assert.equal(result.distance, 0);
    assert.equal(result.effortSeconds, 0);
  }
  for (const [dx, dy, seconds] of [[NaN, 0, dt], [0, Infinity, dt],
    [1, 0, NaN], [1, 0, Infinity], [1, 0, 0], [1, 0, -1]]) {
    const { actor, result } = attempt(formerlyTrapped, dx, dy, seconds);
    assert.deepEqual(actor, formerlyTrapped);
    assert.equal(result.distance, 0);
    assert.equal(result.effortSeconds, 0);
  }
  const idle = attempt(formerlyTrapped, 0, 0);
  assert.deepEqual(idle.actor, formerlyTrapped);
  assert.equal(idle.result.effortSeconds, 0);
  assert.throws(() => attempt(formerlyTrapped, 1, 0, dt, false, 'teleport'), TypeError);
});

test('a current save retains near-trunk position, clock and actual failed-movement history', () => {
  const fixture = blockedMove(formerlyTrapped, { x: 560, y: 3120 });
  const { state, actor, disk } = fixture;
  near(actor.position.x, formerlyTrapped.x);
  near(actor.position.y, formerlyTrapped.y, 1e-5);
  state.player = { ...formerlyTrapped };
  const before = evidence(actor), elapsed = state.elapsed;
  assert.ok(before.experience.some(event => event.type === 'action' &&
    event.details.result.code === 'ROUTE_BLOCKED'));
  assert.equal(writeOzarkSave(disk, state, geometry), true);
  const reopened = loadOzarkSave(disk, geometry);
  assert.equal(reopened.blocked, false, reopened.error);
  assert.deepEqual(evidence(reopened.state.agents[0]), before);
  assert.deepEqual(reopened.state.player, formerlyTrapped);
  assert.equal(reopened.state.elapsed, elapsed);
  assert.equal(reopened.state.agents[0].active, null);
  for (const point of [reopened.state.player, reopened.state.agents[0].position]) {
    const result = geometry.advance(point, -1, 0, dt);
    near(result.distance, CONFIG.walkSpeed * dt);
    near(result.effortSeconds, dt);
    assert.equal(geometry.classify(point.x, point.y).walkable, true);
  }
});
