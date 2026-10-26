import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';

const geometry = createOzarkWorldGeometry();
const near = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b} (tolerance ${tolerance})`);
const dry = { x: -680, y: 380 }, deep = { x: -1200, y: 220 };
const climber = { x: -12000, y: 9790 };
function attempt(start, { dx = 1, dy = 0, dt = .25, mode = 'walk', funding } = {}) {
  const actor = { ...start };
  const result = geometry.advance(actor, dx, dy, dt, false, mode, funding);
  return { actor, result };
}
const stripFunding = ({ paidSeconds, inputDx, inputDy, ...result }) => result;

test('opt-in funding preserves the fully paid input partition and legacy receipt schema', () => {
  assert.equal(geometry.fundedAdvance, true);
  for (const [start, mode, dx, dy] of [[dry, 'walk', 1, 0], [deep, 'swim', 0, 1], [climber, 'climb', 0, 1]]) {
    const legacy = attempt(start, { mode, dx, dy });
    const calls = [];
    const funded = attempt(start, { mode, dx, dy, funding: (seconds, effort) => { calls.push({ seconds, effort }); return seconds; } });
    assert.deepEqual(funded.actor, legacy.actor);
    assert.deepEqual(stripFunding(funded.result), legacy.result);
    near(calls.reduce((sum, c) => sum + c.seconds, 0), .25);
    near(funded.result.paidSeconds, .25);
    assert.equal(calls.length, 30);
    assert.equal('paidSeconds' in legacy.result, false);
  }
});

test('zero and half funding scale only purposeful dry-ground motion and effort', () => {
  for (const ratio of [0, .5, 1]) {
    const { actor, result } = attempt(dry, { funding: seconds => seconds * ratio });
    near(actor.x - dry.x, CONFIG.walkSpeed * .25 * ratio);
    near(actor.y, dry.y);
    near(result.paidSeconds, .25 * ratio);
    near(result.effortSeconds, .25 * ratio);
    near(result.inputDx, actor.x - dry.x);
    near(result.inputDy, 0);
  }
  for (const payment of [undefined, null, NaN, Infinity, -1, '0.25']) {
    const { actor, result } = attempt(dry, { funding: () => payment });
    assert.deepEqual(actor, dry);
    assert.equal(result.paidSeconds, 0);
  }
  assert.deepEqual(attempt(dry, { funding: null }).actor, dry);
  near(attempt(dry, { funding: () => 100 }).result.paidSeconds, .25);
});

test('unfunded swimming and rejected walking preserve full-time passive current without propulsion', () => {
  assert.equal(geometry.classify(deep.x, deep.y, 10, 'swim').reason, 'swimming');
  const idle = attempt(deep, { dx: 0, dy: 0 });
  assert.ok(idle.result.driftDistance > 0);
  for (const mode of ['walk', 'swim']) {
    const zero = attempt(deep, { mode, funding: () => 0 });
    assert.deepEqual(zero.actor, idle.actor);
    near(zero.result.waterSeconds, .25);
    near(zero.result.driftDistance, idle.result.driftDistance);
    assert.equal(zero.result.inputDx, 0);
    assert.equal(zero.result.inputDy, 0);
    assert.equal(zero.result.swimSeconds, 0);
  }
  const calls = [];
  const rejected = attempt(deep, { funding: (seconds, effort) => { calls.push(effort); return seconds; } });
  assert.deepEqual(rejected.actor, idle.actor);
  assert.ok(calls.every(effort => effort === 1));
  near(rejected.result.effortSeconds, .25);
  assert.equal(rejected.result.inputDx, 0);
  assert.equal(rejected.result.swimSeconds, 0);
});

test('terrain effort is priced before each input slice including a dry-to-wade boundary', () => {
  const actor = { x: -1200, y: 400 }, efforts = new Set();
  let paid = 0, charged = 0, accounted = 0;
  for (let i = 0; i < 12; i++) {
    const result = geometry.advance(actor, 0, -1, .25, false, 'walk', (seconds, effort) => {
      efforts.add(effort); paid += seconds; charged += seconds * effort; return seconds;
    });
    accounted += result.effortSeconds;
  }
  assert.deepEqual([...efforts].sort(), [1, 1.6]);
  near(paid, 3); near(charged, accounted);
  const swimCosts = [];
  attempt(deep, { mode: 'swim', dt: geometry.profile.motionStep, funding: (seconds, effort) => { swimCosts.push(effort); return seconds / 2; } });
  assert.ok(swimCosts.every(effort => effort === 2.6));
  const climbCosts = [];
  for (let i = 0, a = { ...climber }; i < 12; i++) geometry.advance(a, 0, 1, .25, false, 'climb', (seconds, effort) => { climbCosts.push(effort); return seconds; });
  assert.ok(climbCosts.includes(2));
});

test('paid resisted boundary attempts cannot tunnel and unfunded climb cannot accumulate slip risk', () => {
  const edge = { x: 18990, y: -13000 };
  const blocked = attempt(edge, { funding: seconds => seconds / 2 });
  assert.deepEqual(blocked.actor, edge);
  near(blocked.result.paidSeconds, .125); near(blocked.result.effortSeconds, .125);
  assert.equal(blocked.result.inputDx, 0);
  const tree = geometry.structures.objectsInRect({ left: 500, top: 3100, right: 580, bottom: 3170 }).find(object => object.id === 'structure:5:31');
  assert.ok(tree);
  const start = { x: tree.x - tree.radius * tree.scale - CONFIG.playerRadius - .01, y: tree.y };
  const trunk = attempt(start, { funding: seconds => seconds });
  assert.deepEqual(trunk.actor, start);
  near(trunk.result.paidSeconds, .25);
  const zero = attempt(climber, { dy: 1, dx: 0, mode: 'climb', funding: () => 0 });
  assert.deepEqual(zero.actor, climber);
  assert.equal(zero.result.climbSeconds, 0);
  assert.equal(zero.result.fallRiskSeconds, 0);
});

test('funded dry motion and passive current are stable across fixed-step partitions', () => {
  function run(start, mode, ratio, parts) {
    const actor = { ...start }; let paid = 0;
    for (let i = 0; i < parts; i++) paid += geometry.advance(actor, 1, 0, .25 / parts, false, mode, seconds => seconds * ratio).paidSeconds;
    return { actor, paid };
  }
  for (const [start, mode, ratio] of [[dry, 'walk', .5], [deep, 'swim', 0]]) {
    const base = run(start, mode, ratio, 1);
    for (const parts of [2, 4, 30, 60]) {
      const fine = run(start, mode, ratio, parts);
      near(fine.paid, base.paid);
      // Dry clear movement is exact; current sampling uses an internal-step
      // spatial tolerance, not a claim of exact nonlinear-flow integration.
      const tolerance = ratio ? 1e-8 : geometry.profile.currentMaxSpeed * geometry.profile.motionStep;
      near(fine.actor.x, base.actor.x, tolerance);
      near(fine.actor.y, base.actor.y, tolerance);
    }
  }
});

test('half-funded wade, climb and swim slices pay their terrain multiplier without losing passive time', () => {
  const starts = [{ position: deep, mode: 'swim', effort: 2.6 }];
  for (const [initial, mode, direction, wanted] of [[{ x: -1200, y: 400 }, 'walk', -1, 1.6], [climber, 'climb', 1, 2]]) {
    const actor = { ...initial }; let found;
    for (let i = 0; i < 12 && !found; i++) geometry.advance(actor, 0, direction, .25, false, mode, (seconds, effort) => {
      if (effort === wanted && !found) found = { position: { ...actor }, mode, effort };
      return seconds;
    });
    assert.ok(found); starts.push(found);
  }
  for (const { position, mode, effort } of starts) {
    const dt = geometry.profile.motionStep;
    const result = attempt(position, { mode, dt, dx: 0, dy: 1, funding: (seconds, price) => {
      assert.equal(price, effort); return seconds / 2;
    } }).result;
    near(result.paidSeconds, dt / 2);
    near(result.effortSeconds, dt * effort / 2);
    if (mode === 'swim') near(result.swimSeconds, dt / 2);
    if (effort === 1.6 || mode === 'swim') near(result.waterSeconds, dt);
  }
});
